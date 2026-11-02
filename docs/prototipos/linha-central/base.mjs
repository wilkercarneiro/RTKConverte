import { mkdirSync as _mk } from "node:fs";
const _OUT = new URL("../../../tests/out/linha-central/", import.meta.url);
_mk(_OUT, { recursive: true });
// Base comum: carrega o EDILSON (estado atual de produção ou outro JSON), calcula e desenha em SVG.
import { readFileSync, writeFileSync } from "node:fs";
import { calcular } from "../../../src/lib/loteamento/calculo.ts";
import { normalizarProjeto } from "../../../src/lib/loteamento/modelo.ts";
import { quinasDe, limparAnel } from "../../../src/lib/loteamento/geom.ts";

export const DIR = _OUT.pathname.replace(/^\/([A-Za-z]:)/, "$1");
const CORPUS = new URL("../../../tests/corpus-real/edilson/", import.meta.url);
const linhas = readFileSync(new URL("Arquivo_de_Coordenadas_Formatado.txt", CORPUS), "utf8").split(/\r?\n/).filter((l) => /^\d/.test(l));
const num = (s) => Number(s.replace(",", "."));
export const perimetro = {
  pts: linhas.map((l) => { const c = l.split(";"); return [num(c[1]), num(c[2])]; }),
  altitudes: linhas.map((l) => num(l.split(";")[3])),
  confrontantes: linhas.map((_, i) => (i >= 3 && i <= 14 ? "ESTRADA" : "DIVISA")),
};
export function carregar(arq = new URL("atual_2026-11-01.json", CORPUS)) {
  const b = JSON.parse(readFileSync(arq, "utf8"));
  return normalizarProjeto(b, b.nome, perimetro.pts.length);
}
export const calc = (pr) => calcular(pr, perimetro);

/** SVG de uma ou mais quadras (ou de tudo) com lotes, números, áreas e marcas extras. */
export function svg(res, nome, opts = {}) {
  const { quadras = null, destaque = new Set(), extras = [], largura = 1500, altura = 1100, rotulo = (l) => l.area.toFixed(0) } = opts;
  const qs = res.quadras.filter((q) => !quadras || quadras.includes(q.nome));
  const pts = qs.flatMap((q) => q.pol.ext);
  for (const e of extras) if (e.pts) pts.push(...e.pts);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const m = 8, x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, y0 = Math.min(...ys) - m, y1 = Math.max(...ys) + m;
  const esc = Math.min(largura / (x1 - x0), altura / (y1 - y0));
  const W = Math.round((x1 - x0) * esc), H = Math.round((y1 - y0) * esc);
  const X = (p) => ((p[0] - x0) * esc), Y = (p) => H - ((p[1] - y0) * esc);
  const path = (an) => "M" + an.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join("L") + "Z";
  const linha = (an) => "M" + an.map((p) => `${X(p).toFixed(1)},${Y(p).toFixed(1)}`).join("L");
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="background:#4a4a4a;font-family:Arial">`;
  for (const r of res.ruas) for (const p of r.pols) s += `<path d="${path(p.ext)}" fill="#6b6b6b"/>`;
  for (const q of qs) {
    s += `<path d="${path(q.pol.ext)}" fill="#3a3a3a" stroke="#bbb" stroke-width="1"/>`;
    for (const l of q.lotes) {
      const ruim = l.problemas.length > 0;
      s += `<path d="${path(l.pol.ext)}" fill="${destaque.has(l.id) ? "#d8f0e0" : ruim ? "#f6d4d4" : "#eeeeea"}" stroke="${ruim ? "#c00" : "#333"}" stroke-width="${ruim ? 1.6 : 0.8}"/>`;
    }
    for (const l of q.lotes) {
      const n = l.pol.ext.length;
      const c = l.pol.ext.reduce((a, p) => [a[0] + p[0] / n, a[1] + p[1] / n], [0, 0]);
      const fs = Math.max(7, Math.min(13, esc * 3.2));
      s += `<text x="${X(c).toFixed(1)}" y="${Y(c).toFixed(1)}" font-size="${fs}" text-anchor="middle" fill="#111">${l.numero}</text>`;
      s += `<text x="${X(c).toFixed(1)}" y="${(Y(c) + fs).toFixed(1)}" font-size="${fs * 0.8}" text-anchor="middle" fill="#555">${rotulo(l)}</text>`;
    }
    for (const cv of q.curvas ?? []) s += `<circle cx="${X(cv.pc)}" cy="${Y(cv.pc)}" r="2.5" fill="#0af"/><circle cx="${X(cv.pt)}" cy="${Y(cv.pt)}" r="2.5" fill="#0af"/>`;
    const cen = q.centro;
    s += `<text x="${X(cen)}" y="${Y(cen)}" font-size="34" fill="rgba(255,200,0,.35)" text-anchor="middle">${q.nome}</text>`;
  }
  for (const e of extras) {
    if (e.tipo === "linha") s += `<path d="${linha(e.pts)}" fill="none" stroke="${e.cor ?? "#f80"}" stroke-width="${e.w ?? 2.5}" ${e.tracejado ? 'stroke-dasharray="6 4"' : ""}/>`;
    if (e.tipo === "anel") s += `<path d="${path(e.pts)}" fill="${e.fill ?? "none"}" stroke="${e.cor ?? "#f80"}" stroke-width="${e.w ?? 1.5}"/>`;
    if (e.tipo === "ponto") for (const p of e.pts) s += `<circle cx="${X(p)}" cy="${Y(p)}" r="${e.r ?? 3.5}" fill="${e.cor ?? "#f80"}"/>`;
    if (e.tipo === "texto") s += `<text x="${X(e.pts[0])}" y="${Y(e.pts[0])}" font-size="${e.fs ?? 12}" fill="${e.cor ?? "#fff"}" text-anchor="middle">${e.texto}</text>`;
  }
  s += `</svg>`;
  writeFileSync(DIR + nome + ".svg", s);
  return DIR + nome + ".svg";
}

export const nQuinas = (an) => quinasDe(an).length;
export const nQuinasLimpo = (an) => { const l = limparAnel(an, 0.01); return quinasDe(l.length >= 3 ? l : an).length; };
