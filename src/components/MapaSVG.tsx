// Mapa SVG do polígono: trechos coloridos por confrontante, vértices numerados.
// Gerado client-side a partir das coordenadas E/N — sem lib de mapa.
import { useMemo } from "react";
import type { Trecho, Vertice } from "../lib/types";

export const CORES = ["#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4", "#01796f", "#9a6324", "#800000", "#808000", "#000075"];

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
    const corDoVertice = (ordem: number): string => {
      if (tOrd.length === 0) return "#888";
      // trecho vigente: o último início <= ordem (no anel a partir do 1º trecho)
      let idx = -1;
      for (let i = 0; i < tOrd.length; i++) if (tOrd[i].vertice_inicio_ordem <= ordem) idx = i;
      if (idx < 0) idx = tOrd.length - 1; // antes do 1º início → último trecho do anel
      return CORES[idx % CORES.length];
    };
    return { pts, px, py, W, H, corDoVertice };
  }, [vertices, trechos]);

  const { pts, px, py, W, H, corDoVertice } = dados;
  if (pts.length < 3) return null;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mapa-svg" role="img" aria-label="Mapa do perímetro">
      {pts.map((p, i) => {
        const q = pts[(i + 1) % pts.length];
        return (
          <line key={`s${i}`} x1={px(p.x)} y1={py(p.y)} x2={px(q.x)} y2={py(q.y)}
            stroke={corDoVertice(p.v.ordem)} strokeWidth={2} />
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
