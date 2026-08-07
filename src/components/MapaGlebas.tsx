// Mapa interativo de edição das glebas.
//
// A primeira versão do editor pedia um clique por ponto, numa fileira de chips
// fora do desenho: montar uma gleba que acompanha 12 vértices do perímetro dava
// 12 cliques em botões que não diziam ONDE ficavam. Aqui o contorno é montado em
// cima da própria figura, e em bloco:
//
//   clique num vértice do perímetro ....... acrescenta aquele vértice
//   SHIFT + clique num vértice ............ acrescenta o TRECHO INTEIRO do
//                                           último ponto até ele, pelo caminho
//                                           mais curto do perímetro
//   arrastar sobre o vazio ................ retângulo de seleção: entram todos
//                                           os vértices dentro dele, na ordem
//                                           do perímetro
//   clique no vazio ....................... ponto livre naquela coordenada
//   arrastar uma alça ..................... move o ponto (gruda no vértice do
//                                           perímetro quando chega perto)
//   duplo clique numa alça ................ remove o ponto
//
// A conversão tela → E/N usa a matriz do próprio SVG (getScreenCTM), e não uma
// regra de três sobre o bounding box: com `preserveAspectRatio` o desenho ganha
// margens que uma regra de três ignoraria, e o ponto livre cairia deslocado.
import { useMemo, useRef, useState } from "react";
import type { Gleba, Trecho, Vertice } from "../lib/types";
import {
  acrescentarSemRepetir, grudarNoPerimetro, indiceNoPerimetro, mesmoPonto, trechoDoPerimetro,
} from "../lib/glebas";
import type { PontoAnel } from "../lib/glebas";
import { trechoDoVertice } from "../lib/trechos";
import { CORES } from "./MapaSVG";

const W = 560, H = 460, PAD = 30;
/** Raio (em px de tela) para uma alça arrastada grudar num vértice do perímetro. */
const RAIO_IMA = 12;

interface Props {
  vertices: Vertice[];
  /** Trechos de confrontação, só para desenhar as faixas de domínio em vermelho. */
  trechos: Trecho[];
  glebas: Gleba[];
  /** Índice da gleba que recebe os cliques. */
  ativa: number;
  onChange: (anel: [number, number][]) => void;
}

export function MapaGlebas({ vertices, trechos, glebas, ativa, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [arrasto, setArrasto] = useState<{ tipo: "alca"; i: number } | { tipo: "caixa"; x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const vs = vertices
      .filter((v) => v.e !== null && v.n !== null)
      .sort((a, b) => a.ordem - b.ordem)
      .map((v) => ({ v, x: Number(v.e), y: Number(v.n) }));
    if (vs.length < 3) return null;
    const xs = vs.map((p) => p.x), ys = vs.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const esc = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1));
    const px = (x: number) => PAD + (x - minX) * esc;
    const py = (y: number) => H - PAD - (y - minY) * esc;  // N cresce para cima
    return {
      vs, px, py,
      ex: (sx: number) => minX + (sx - PAD) / esc,
      ny: (sy: number) => minY + (H - PAD - sy) / esc,
      // centroide em coordenadas de tela, para jogar a linha da via para FORA
      cx: vs.reduce((s, p) => s + px(p.x), 0) / vs.length,
      cy: vs.reduce((s, p) => s + py(p.y), 0) / vs.length,
    };
  }, [vertices]);

  if (!geo) return <p className="sub">Sem vértices com coordenada plana para desenhar o mapa.</p>;
  const { vs, px, py, ex, ny, cx, cy } = geo;

  const anel = glebas[ativa]?.anel ?? [];
  const corAtiva = CORES[ativa % CORES.length];

  /** Ponto do evento em coordenadas do viewBox. */
  function paraSvg(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const svg = svgRef.current!;
    const p = svg.createSVGPoint();
    p.x = e.clientX; p.y = e.clientY;
    const m = svg.getScreenCTM();
    const r = m ? p.matrixTransform(m.inverse()) : p;
    return { x: r.x, y: r.y };
  }

  /** O perímetro como lista de pontos, para as funções puras de src/lib/glebas.ts */
  const perimetro: PontoAnel[] = vs.map((p) => [p.x, p.y]);

  const set = (a: PontoAnel[]) => onChange(a);
  const add = (e: number, n: number) => set([...anel, [e, n]]);

  /** SHIFT + clique: pega o trecho inteiro do último ponto até `destino`. */
  function addTrecho(destino: number) {
    const ultimo = anel.length ? indiceNoPerimetro(perimetro, anel[anel.length - 1]) : -1;
    if (ultimo < 0) { add(vs[destino].x, vs[destino].y); return; }
    const idx = trechoDoPerimetro(vs.length, ultimo, destino);
    set(acrescentarSemRepetir(anel, idx.map((i) => perimetro[i])));
  }

  /** Retângulo de seleção: todos os vértices dentro, na ordem do perímetro. */
  function addCaixa(c: { x0: number; y0: number; x1: number; y1: number }) {
    const x0 = Math.min(c.x0, c.x1), x1 = Math.max(c.x0, c.x1);
    const y0 = Math.min(c.y0, c.y1), y1 = Math.max(c.y0, c.y1);
    const dentro = vs
      .filter((p) => {
        const sx = px(p.x), sy = py(p.y);
        return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
      })
      .map((p) => [p.x, p.y] as PontoAnel);
    if (dentro.length) set(acrescentarSemRepetir(anel, dentro));
  }

  function moverAlca(i: number, sx: number, sy: number) {
    const grudado = grudarNoPerimetro(
      vs.map((p) => ({ x: px(p.x), y: py(p.y) })),
      { x: sx, y: sy },
      RAIO_IMA,
    );
    const alvo: PontoAnel = grudado ? [ex(grudado.x), ny(grudado.y)] : [ex(sx), ny(sy)];
    set(anel.map((p, k) => (k === i ? alvo : p)));
  }

  const caminho = (a: PontoAnel[]) => a.map((p, i) => `${i ? "L" : "M"}${px(p[0])},${py(p[1])}`).join(" ") + (a.length > 2 ? " Z" : "");

  return (
    <div className="mapa-glebas-wrap">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="mapa-glebas"
        role="application"
        aria-label="Mapa de edição das glebas"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const alvo = e.target as SVGElement;
          if (alvo.dataset.alca || alvo.dataset.vertice) return; // tratado no próprio elemento
          const { x, y } = paraSvg(e);
          setArrasto({ tipo: "caixa", x0: x, y0: y, x1: x, y1: y });
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!arrasto) return;
          const { x, y } = paraSvg(e);
          if (arrasto.tipo === "caixa") setArrasto({ ...arrasto, x1: x, y1: y });
          else moverAlca(arrasto.i, x, y);
        }}
        onPointerUp={(e) => {
          if (!arrasto) return;
          if (arrasto.tipo === "caixa") {
            const mexeu = Math.hypot(arrasto.x1 - arrasto.x0, arrasto.y1 - arrasto.y0) > 4;
            // arrastou = seleção em bloco; clique seco no vazio = ponto livre
            if (mexeu) addCaixa(arrasto);
            else add(ex(arrasto.x0), ny(arrasto.y0));
          }
          setArrasto(null);
          (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
        }}
      >
        {/* perímetro */}
        <polygon
          points={vs.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")}
          fill="#f3f6f4" stroke="#1f4fd8" strokeWidth={2}
        />

        {/* faixas de domínio, como saem na planta: sem elas o mapa não é
            reconhecível como a planta e o operador não confia no que está vendo */}
        {vs.map((p, i) => {
          const t = trechoDoVertice([...trechos].sort((a, b) => a.vertice_inicio_ordem - b.vertice_inicio_ordem), p.v.ordem);
          if (!t?.eh_via) return null;
          const q = vs[(i + 1) % vs.length];
          const ax = px(p.x), ay = py(p.y), bx = px(q.x), by = py(q.y);
          const len = Math.hypot(bx - ax, by - ay) || 1;
          let nx = -(by - ay) / len, nyy = (bx - ax) / len;
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          if ((mx + nx * 5 - cx) ** 2 + (my + nyy * 5 - cy) ** 2 < (mx - nx * 5 - cx) ** 2 + (my - nyy * 5 - cy) ** 2) {
            nx = -nx; nyy = -nyy;
          }
          return (
            <g key={`via${i}`} pointerEvents="none">
              {[3, 6].map((off) => (
                <line key={off} x1={ax + nx * off} y1={ay + nyy * off} x2={bx + nx * off} y2={by + nyy * off}
                  stroke="#d40000" strokeWidth={1.4} />
              ))}
            </g>
          );
        })}

        {/* glebas já montadas — a ativa em destaque */}
        {glebas.map((g, i) => g.anel.length >= 2 && (
          <path key={g.id ?? i} d={caminho(g.anel)}
            fill={CORES[i % CORES.length]} fillOpacity={i === ativa ? 0.22 : 0.1}
            stroke={CORES[i % CORES.length]} strokeWidth={i === ativa ? 2.4 : 1.4}
            strokeDasharray={i === ativa ? undefined : "6 4"}
            pointerEvents="none"
          />
        ))}

        {/* vértices do perímetro: alvos de clique */}
        {vs.map((p, i) => {
          const usado = anel.some((q) => mesmoPonto(q, [p.x, p.y]));
          return (
            <g key={`v${p.v.ordem}`}>
              <circle
                data-vertice="1"
                cx={px(p.x)} cy={py(p.y)} r={hover === i ? 7 : 4.5}
                fill={usado ? corAtiva : p.v.tipo === "M" ? "#1f4fd8" : "#fff"}
                stroke={usado ? corAtiva : "#1f4fd8"} strokeWidth={1.6}
                style={{ cursor: "pointer" }}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover((h) => (h === i ? null : h))}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  if (e.shiftKey) addTrecho(i);
                  else add(p.x, p.y);
                }}
              >
                <title>{`${p.v.codigo ?? p.v.num_txt ?? p.v.ordem} · shift+clique = trecho inteiro`}</title>
              </circle>
            </g>
          );
        })}

        {/* alças da gleba ativa */}
        {anel.map((p, i) => (
          <g key={`a${i}`}>
            <circle
              data-alca="1"
              cx={px(p[0])} cy={py(p[1])} r={6}
              fill="#fff" stroke={corAtiva} strokeWidth={2.4}
              style={{ cursor: "grab" }}
              onPointerDown={(e) => {
                e.stopPropagation();
                setArrasto({ tipo: "alca", i });
                (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
              }}
              onDoubleClick={(e) => { e.stopPropagation(); set(anel.filter((_, k) => k !== i)); }}
            >
              <title>{`ponto ${i + 1} · arraste para mover · duplo clique remove`}</title>
            </circle>
            <text x={px(p[0])} y={py(p[1]) - 9} fontSize={9} textAnchor="middle" fill={corAtiva} pointerEvents="none">
              {i + 1}
            </text>
          </g>
        ))}

        {/* retângulo de seleção */}
        {arrasto?.tipo === "caixa" && Math.hypot(arrasto.x1 - arrasto.x0, arrasto.y1 - arrasto.y0) > 4 && (
          <rect
            x={Math.min(arrasto.x0, arrasto.x1)} y={Math.min(arrasto.y0, arrasto.y1)}
            width={Math.abs(arrasto.x1 - arrasto.x0)} height={Math.abs(arrasto.y1 - arrasto.y0)}
            fill="#1f4fd8" fillOpacity={0.08} stroke="#1f4fd8" strokeDasharray="4 3" pointerEvents="none"
          />
        )}
      </svg>

      <p className="mapa-ajuda">
        <b>clique</b> num vértice para incluir · <b>shift+clique</b> pega o trecho inteiro ·
        <b> arraste no vazio</b> para selecionar vários · <b>clique no vazio</b> cria ponto livre ·
        <b> arraste a alça</b> para ajustar (gruda no vértice) · <b>duplo clique</b> remove
      </p>
    </div>
  );
}
