// Desenho SVG de um layout da linha central (para conferir no navegador).
import { writeFileSync } from "node:fs";

export function desenhar(arq, E, L, o = {}) {
  const { W = 1250, H = 920, titulo = "", ruas = [], antes = null } = o;
  const pts = [...E.anel, ...(antes ? antes.flatMap((a) => a) : [])];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const m = 6, x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, y0 = Math.min(...ys) - m, y1 = Math.max(...ys) + m;
  const esc = Math.min(W / (x1 - x0), (H - 40) / (y1 - y0));
  const X = (p) => (p[0] - x0) * esc, Y = (p) => 40 + (y1 - p[1]) * esc;
  const path = (an, fecha = true) => "M" + an.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join("L") + (fecha ? "Z" : "");
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#3d3f42;font-family:Arial">`;
  s += `<text x="12" y="26" font-size="17" fill="#fff">${titulo}</text>`;
  for (const r of ruas) s += `<path d="${path(r)}" fill="#6a6a6a"/>`;
  s += `<path d="${path(E.anel)}" fill="#2b2d30" stroke="#999" stroke-width="1"/>`;
  const fs = Math.max(8, Math.min(13, esc * 2.6));
  for (const l of L.lotes) {
    const q = l.quinas.length, ruim = q > 4 || (l.zona.startsWith("ponta") ? q > 4 : false);
    const cor = l.zona === "f1" ? "#e9f1e4" : l.zona === "f2" ? "#e4ecf3" : "#f3ecdf";
    s += `<path d="${path(l.anel)}" fill="${ruim ? "#f6d0d0" : cor}" stroke="${ruim ? "#c00" : "#333"}" stroke-width="${ruim ? 1.8 : 0.9}"/>`;
  }
  // linha central e junções
  if (L.C) s += `<path d="${path(L.C, false)}" fill="none" stroke="#ff8a00" stroke-width="3" stroke-dasharray="9 5"/>`;
  for (const v of L.C ?? []) s += `<rect x="${X(v) - 5}" y="${Y(v) - 5}" width="10" height="10" fill="#ff8a00" stroke="#fff" stroke-width="1.5" transform="rotate(45 ${X(v)} ${Y(v)})"/>`;
  for (const j of L.juncoes) s += `<circle cx="${X(j)}" cy="${Y(j)}" r="2.6" fill="#ffb347"/>`;
  // quinas reconhecidas (PI do arco em azul)
  for (const l of L.lotes) for (const q of l.quinas) if (q.arco) s += `<circle cx="${X(q.pi)}" cy="${Y(q.pi)}" r="3.2" fill="none" stroke="#2a9df4" stroke-width="1.6"/>`;
  for (const l of L.lotes) {
    const n = l.anel.length;
    const c = l.anel.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
    const nome = l.zona === "f1" ? `${l.ordem + 1}` : l.zona === "f2" ? `${l.ordem + 1}'` : `p${l.ordem + 1}`;
    s += `<text x="${X(c).toFixed(1)}" y="${(Y(c) - fs * 0.2).toFixed(1)}" font-size="${fs}" text-anchor="middle" fill="#111" font-weight="bold">${nome}</text>`;
    s += `<text x="${X(c).toFixed(1)}" y="${(Y(c) + fs * 0.95).toFixed(1)}" font-size="${fs * 0.82}" text-anchor="middle" fill="#444">${l.area.toFixed(1)}</text>`;
    if (o.giros && l.giroLat?.length) {
      const g = l.giroLat.filter(Number.isFinite).map((v) => v.toFixed(0) + "°").join(" ");
      s += `<text x="${X(c).toFixed(1)}" y="${(Y(c) + fs * 1.9).toFixed(1)}" font-size="${fs * 0.7}" text-anchor="middle" fill="#777">${g} q${l.quinas.length}</text>`;
    }
  }
  if (antes) for (const a of antes) s += `<path d="${path(a)}" fill="none" stroke="#ff4d4d" stroke-width="0.8" stroke-dasharray="3 3" opacity=".7"/>`;
  s += `</svg>`;
  writeFileSync(arq, s);
  return arq;
}
