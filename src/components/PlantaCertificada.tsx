// Planta do CSV de exportação do SIGEF de uma parcela vizinha: o polígono
// certificado com os vértices clicáveis. O operador marca quais deles são a
// divisa com o imóvel que está sendo levantado; o parse-txt une os marcados ao
// TXT (ver _shared/certificados.ts).
//
// Só exibição: a projeção é local (fuso do centroide do CSV) e serve para
// desenhar. Quem calcula o que vai ao banco é o servidor.
import { useMemo, useRef } from "react";
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../supabase/functions/_shared/geo.ts";
import { lonLatDoVerticeSigef } from "../../supabase/functions/_shared/certificados.ts";
import type { VerticeSigef } from "../../supabase/functions/_shared/certificados.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

const COR_SEL = "#0E7A4F";
const COR_PONTO = "#33453C";
const COR_LINHA = "#9FBFAF";

const fmt = (v: number, dec: number) => v.toFixed(dec).replace(".", ",");

export function PlantaCertificada({ vertices, selecionados, onChange }: {
  vertices: VerticeSigef[];
  /** códigos dos vértices escolhidos */
  selecionados: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  // último ponto clicado: âncora do Shift+clique (sequência ao longo do anel)
  const ultimo = useRef<number | null>(null);

  const dados = useMemo(() => {
    const lonMed = vertices.reduce((s, v) => s + v.lon, 0) / (vertices.length || 1);
    const zone = Math.min(25, Math.max(18, Math.floor((lonMed + 180) / 6) + 1));
    const ud = utmDef(zone);
    const pts = vertices.map((v) => {
      const [lon, lat] = lonLatDoVerticeSigef(v);
      const [x, y] = proj(GEO_DEF, ud, [lon, lat]);
      return { v, x, y };
    });
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = 520, H = 440, PAD = 34;
    const esc = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1));
    const offX = (W - (maxX - minX) * esc) / 2, offY = (H - (maxY - minY) * esc) / 2;
    const px = (x: number) => offX + (x - minX) * esc;
    const py = (y: number) => H - offY - (y - minY) * esc; // N cresce p/ cima
    return { pts, px, py, W, H, zone };
  }, [vertices]);

  const { pts, px, py, W, H } = dados;
  if (pts.length < 3) return null;

  const n = vertices.length;
  const marcado = (i: number) => selecionados.has(vertices[i].codigo);

  function alternar(i: number, shift: boolean) {
    const novo = new Set(selecionados);
    if (shift && ultimo.current !== null && ultimo.current !== i) {
      // do último clicado até este, no sentido do anel do vizinho (INDICE crescente)
      let k = ultimo.current;
      for (let passos = 0; passos <= n; passos++) {
        novo.add(vertices[k].codigo);
        if (k === i) break;
        k = (k + 1) % n;
      }
    } else if (novo.has(vertices[i].codigo)) {
      novo.delete(vertices[i].codigo);
    } else {
      novo.add(vertices[i].codigo);
    }
    ultimo.current = i;
    onChange(novo);
  }

  const poligono = pts.map((p) => `${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");

  return (
    <div className="planta-cert">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Planta da parcela certificada — clique nos vértices da divisa comum">
        <polygon points={poligono} fill="rgba(14,122,79,0.06)" stroke={COR_LINHA} strokeWidth={1.5} strokeLinejoin="round" />
        {/* lados entre dois vértices marcados consecutivos: a divisa escolhida */}
        {pts.map((p, i) => {
          const j = (i + 1) % n;
          if (!marcado(i) || !marcado(j)) return null;
          return <line key={`d${i}`} x1={px(p.x)} y1={py(p.y)} x2={px(pts[j].x)} y2={py(pts[j].y)} stroke={COR_SEL} strokeWidth={4} strokeLinecap="round" />;
        })}
        {pts.map((p, i) => {
          const sel = marcado(i);
          return (
            <g key={p.v.codigo || i} className="ponto" role="checkbox" aria-checked={sel} tabIndex={0}
              aria-label={`${p.v.codigo} (vértice ${p.v.indice})`}
              onClick={(e) => alternar(i, e.shiftKey)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(i, e.shiftKey); } }}>
              <title>{p.v.codigo} · {p.v.tipo} · {p.v.metodo} · h {fmt(p.v.h, 2)} m{"\n"}{p.v.latGms} / {p.v.lonGms}</title>
              {/* alvo de clique maior que o ponto */}
              <circle cx={px(p.x)} cy={py(p.y)} r={11} fill="transparent" />
              <circle cx={px(p.x)} cy={py(p.y)} r={sel ? 6 : 4}
                fill={sel ? COR_SEL : p.v.tipo === "M" ? COR_PONTO : "#fff"}
                stroke={sel ? "#fff" : COR_PONTO} strokeWidth={sel ? 2 : 1.5} />
              <text x={px(p.x) + 8} y={py(p.y) - 6} fontSize={9.5} fill={sel ? COR_SEL : "#5B6B63"}
                fontWeight={sel ? 700 : 400} fontFamily="Fira Code, monospace">{p.v.indice}</text>
            </g>
          );
        })}
      </svg>

      <div className="lado">
        <div className="acoes-linha">
          <button type="button" onClick={() => onChange(new Set(vertices.map((v) => v.codigo)))}>Selecionar todos</button>
          <button type="button" className="fantasma" onClick={() => { ultimo.current = null; onChange(new Set()); }}>Limpar</button>
          <span className="sub" style={{ fontSize: 13 }}>{selecionados.size} de {n} vértice(s) escolhido(s)</span>
        </div>
        <p className="dica">
          Clique nos vértices da divisa comum, no desenho ou na lista. <b>Shift + clique</b> marca a
          sequência do último vértice clicado até este, seguindo a numeração do vizinho.
        </p>
        <div className="tabela-wrap">
          <table className="tabela-vertices">
            <thead>
              <tr><th></th><th>Nº</th><th>Código</th><th>Tipo</th><th>Método</th><th className="direita">σ (m)</th><th className="direita">h (m)</th><th>Latitude</th><th>Longitude</th></tr>
            </thead>
            <tbody>
              {vertices.map((v, i) => {
                const sel = marcado(i);
                return (
                  <tr key={v.codigo || i} className={sel ? "sel" : ""} onClick={(e) => alternar(i, e.shiftKey)}>
                    <td>
                      <input type="checkbox" checked={sel} aria-label={`Usar ${v.codigo}`}
                        onClick={(e) => { e.stopPropagation(); alternar(i, e.shiftKey); }} onChange={() => { /* onClick decide */ }} />
                    </td>
                    <td className="num">{v.indice}</td>
                    <td className="mono">{v.codigo}</td>
                    <td><span className={`chip ${v.tipo}`}>{v.tipo}</span></td>
                    <td className="mono">{v.metodo}</td>
                    <td className="mono direita">{fmt(Math.max(v.sigmaX, v.sigmaY), 3)}</td>
                    <td className="mono direita">{fmt(v.h, 2)}</td>
                    <td className="mono">{v.latGms}</td>
                    <td className="mono">{v.lonGms}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
