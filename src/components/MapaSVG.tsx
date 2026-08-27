// Mapa SVG do polígono: trechos coloridos por confrontante, vértices numerados.
// Gerado client-side a partir das coordenadas E/N — sem lib de mapa.
import { useMemo } from "react";
import type { Trecho, Vertice } from "../lib/types";
import { ehRioPorLimite, trechoDoVertice } from "../lib/trechos";

export const CORES = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#01796f", "#9a6324", "#800000", "#808000", "#000075"];

// as mesmas duas cores de faixa da planta (VERMELHO e AZUL_RIO em planta.ts)
export const COR_VIA = "#d40000";
export const COR_RIO = "#0d99e6";

interface Props {
  vertices: Vertice[];
  trechos: Trecho[];
  verticeInicial: number;
}

export function MapaSVG({ vertices, trechos, verticeInicial }: Props) {
  const dados = useMemo(() => {
    const vs = [...vertices].sort((a, b) => a.ordem - b.ordem);
    // V inseridos não têm E/N: interpola visualmente entre vizinhos
    const pts = vs.map((v, i) => {
      if (v.e !== null && v.n !== null) return { v, x: Number(v.e), y: Number(v.n) };
      const prev = vs[(i - 1 + vs.length) % vs.length];
      const next = vs[(i + 1) % vs.length];
      return { v, x: (Number(prev.e ?? 0) + Number(next.e ?? 0)) / 2, y: (Number(prev.n ?? 0) + Number(next.n ?? 0)) / 2 };
    });
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = 420, H = 420, PAD = 24;
    const esc = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1));
    const px = (x: number) => PAD + (x - minX) * esc;
    const py = (y: number) => H - PAD - (y - minY) * esc; // N cresce p/ cima
    const tOrd = [...trechos].sort((a, b) => a.vertice_inicio_ordem - b.vertice_inicio_ordem);
    const trechoDe = (ordem: number): Trecho | null => trechoDoVertice(tOrd, ordem);
    const corDoVertice = (ordem: number): string => {
      const t = trechoDe(ordem);
      return t ? CORES[tOrd.indexOf(t) % CORES.length] : "#888";
    };
    // centroide em coordenadas de tela, para jogar a linha da via para FORA
    const cx = pts.reduce((s, p) => s + px(p.x), 0) / pts.length;
    const cy = pts.reduce((s, p) => s + py(p.y), 0) / pts.length;
    return { pts, px, py, W, H, corDoVertice, trechoDe, cx, cy };
  }, [vertices, trechos]);

  const { pts, px, py, W, H, corDoVertice, trechoDe, cx, cy } = dados;
  if (pts.length < 3) return null;

  // Mesma construção da planta (planta.ts): duas paralelas deslocadas na normal
  // que aponta para fora do polígono. O que aparecer aqui é o que sai no PDF —
  // vermelhas para a faixa de domínio, AZUIS para o curso d'água (LN1), e rio
  // vence estrada, como lá.
  const viaDoSegmento = (i: number) => {
    const t = trechoDe(pts[i].v.ordem);
    const cor = ehRioPorLimite(t?.tipo_limite) ? COR_RIO : t?.eh_via ? COR_VIA : null;
    if (!cor) return null;
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ax = px(a.x), ay = py(a.y), bx = px(b.x), by = py(b.y);
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    if ((mx + nx * 5 - cx) ** 2 + (my + ny * 5 - cy) ** 2 < (mx - nx * 5 - cx) ** 2 + (my - ny * 5 - cy) ** 2) {
      nx = -nx; ny = -ny;
    }
    return { ax, ay, bx, by, nx, ny, cor };
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mapa-svg" role="img" aria-label="Mapa do perímetro">
      {pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return (
          <line key={`s${i}`} x1={px(p.x)} y1={py(p.y)} x2={px(q.x)} y2={py(q.y)}
            stroke={corDoVertice(p.v.ordem)} strokeWidth={2} />
        );
      })}
      {/* faixas: dupla vermelha (estrada) ou azul (rio, LN1), como sai na planta */}
      {pts.map((_, i) => {
        const via = viaDoSegmento(i);
        if (!via) return null;
        return (
          <g key={`via${i}`}>
            {[3, 6].map((off) => (
              <line key={off}
                x1={via.ax + via.nx * off} y1={via.ay + via.ny * off}
                x2={via.bx + via.nx * off} y2={via.by + via.ny * off}
                stroke={via.cor} strokeWidth={1.4} />
            ))}
          </g>
        );
      })}
      {pts.map((p) => (
        <g key={`v${p.v.ordem}`}>
          <circle cx={px(p.x)} cy={py(p.y)} r={p.v.ordem === verticeInicial ? 5 : p.v.tipo === "M" ? 4 : 2.5}
            fill={p.v.tipo === "V" ? "#000" : corDoVertice(p.v.ordem)}
            stroke={p.v.ordem === verticeInicial ? "#000" : "none"} strokeWidth={1.5} />
          {(p.v.tipo !== "P" || p.v.num_txt !== null && p.v.num_txt % 5 === 0) && (
            <text x={px(p.x) + 6} y={py(p.y) - 4} fontSize={9}>{p.v.num_txt ?? "V"}</text>
          )}
        </g>
      ))}
    </svg>
  );
}
