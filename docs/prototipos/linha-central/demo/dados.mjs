// Gera os dados da demonstração: quadra A real (coordenadas locais, sem nome do cliente) + exemplos.
import { writeFileSync } from "node:fs";
import { carregar, calc } from "../base.mjs";
import { quadraParaMotor } from "../edilson.mjs";

const pr = carregar();
const res = calc(pr);
const r2 = (p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
const quadras = [];
{
  const q = res.quadras.find((x) => x.nome === "A");
  const { anel, tipos, refs, loc } = quadraParaMotor(q);
  quadras.push({
    id: "A", nome: "Quadra A", origem: "projeto real (estrada levantada + Rua 02 e Rua 03)", N: q.lotes.length,
    anel: anel.map(r2), tipos, refs: refs.map((x) => (x === "estrada" ? "estrada" : String(x))),
    ruas: { estrada: "Estrada (levantada)", a1: "Rua 02", a2: "Rua 03", a0: "Rua 01" },
    antes: q.lotes.map((l) => ({ id: l.id, area: l.area, anel: l.pol.ext.map((p) => r2(loc(p))), problemas: l.problemas })),
  });
}
function arco(c, r, a0, a1, passos) { const o = []; for (let i = 0; i <= passos; i++) { const a = a0 + ((a1 - a0) * i) / passos; o.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return o; }
function retangulo(w, h, R) {
  const p = [];
  p.push(...arco([w - R, R], R, -Math.PI / 2, 0, 9), ...arco([w - R, h - R], R, 0, Math.PI / 2, 9), ...arco([R, h - R], R, Math.PI / 2, Math.PI, 9), ...arco([R, R], R, Math.PI, 1.5 * Math.PI, 9));
  return p.map(([x, y]) => [x - w / 2, y - h / 2]);
}
const centrar = (a) => { const n = a.length, c = a.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]); return a.map((p) => [p[0] - c[0], p[1] - c[1]]); };
const ret = retangulo(200, 50, 6);
quadras.push({ id: "R", nome: "Retângulo", origem: "exemplo: 200 × 50 m, esquinas com raio de 6 m", N: 40, anel: ret.map(r2), tipos: ret.map(() => "rua"), refs: ret.map(() => "r") });
const trap = centrar([[0, 0], [220, 0], [220, 70], [0, 40]]);
quadras.push({ id: "T", nome: "Ruas que se abrem", origem: "exemplo: quadra de 40 a 70 m de largura", N: 44, anel: trap.map(r2), tipos: trap.map(() => "rua"), refs: ["r1", "r2", "r3", "r4"] });
const dob = centrar([[0, 0], [110, 0], [215, 38], [215, 95], [0, 55]]);
quadras.push({ id: "D", nome: "Rua com dobra", origem: "exemplo: a rua de baixo dobra 20° no meio da quadra", N: 44, anel: dob.map(r2), tipos: dob.map(() => "rua"), refs: ["r1", "r1", "r2", "r3", "r4"] });
writeFileSync(new URL("./dados.json", import.meta.url), JSON.stringify({ quadras, params: { profMin: pr.params.profundidadeMin, profPadrao: pr.params.profundidade, frenteMin: pr.params.frenteMin, areaMin: pr.params.areaMin } }));
console.log("ok", quadras.map((q) => `${q.id}:${q.anel.length}`).join(" "));
