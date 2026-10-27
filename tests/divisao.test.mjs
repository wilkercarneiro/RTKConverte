// Motor da DIVISÃO EM PARTES IGUAIS (src/lib/divisao.ts).
//
// O que se lacra aqui é o que um herdeiro confere com régua na mão: cada parte
// com a área pedida, a soma fechando o imóvel, a divisa reta cruzando o
// perímetro em dois pontos só, e — quando há estrada — ninguém sem acesso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dividir, sugerirDivisoes } from "../src/lib/divisao.ts";
import { ANEL } from "./fixtures/salgada_velha.mjs";

const anelSalgada = ANEL.map(([, e, n]) => [e, n]);
const area = (pts) => {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
};
const total = area(anelSalgada);

test("divisão · 3 partes iguais na SALGADA VELHA: mesma área, somando o imóvel", () => {
  const r = sugerirDivisoes({ anel: anelSalgada, fracoes: [1, 1, 1] })[0];
  assert.ok(r?.ok, r?.motivo);
  assert.equal(r.partes.length, 3);
  for (const p of r.partes) assert.ok(Math.abs(p.areaM2 - total / 3) < 0.5, `parte com ${p.areaM2.toFixed(2)} m² (alvo ${(total / 3).toFixed(2)})`);
  const soma = r.partes.reduce((s, p) => s + p.areaM2, 0);
  assert.ok(Math.abs(soma - total) < 0.5);
  // 2 divisas, 4 pontos novos, e cada ponto novo está nas duas partes que ele separa
  assert.equal(r.divisas.length, 2);
  assert.equal(r.novos.length, 4);
  for (const nv of r.novos) {
    const donos = r.partes.filter((p) => p.anel.some((q) => q.e === nv.e && q.n === nv.n));
    assert.equal(donos.length, 2, "ponto de divisa pertence às duas partes vizinhas");
  }
  // todo vértice do perímetro está em alguma parte
  const usados = new Set(r.partes.flatMap((p) => p.anel.filter((q) => q.vertice !== undefined).map((q) => q.vertice)));
  assert.equal(usados.size, anelSalgada.length);
});

test("divisão · frações diferentes (meação 50% + dois filhos 25%)", () => {
  const r = sugerirDivisoes({ anel: anelSalgada, fracoes: [2, 1, 1] })[0];
  assert.ok(r.ok);
  const [a, b, c] = r.partes.map((p) => p.areaM2);
  assert.ok(Math.abs(a - total / 2) < 0.5 && Math.abs(b - total / 4) < 0.5 && Math.abs(c - total / 4) < 0.5);
});

test("divisão · com estrada, a sugestão dá frente para todos", () => {
  // lados 3→4 … 12→13 da fixture correm junto à ESTRADA VICINAL (M-4542 → M-4543)
  const estrada = anelSalgada.map((_, i) => i >= 3 && i < 5);
  const r = sugerirDivisoes({ anel: anelSalgada, fracoes: [1, 1, 1], estrada })[0];
  assert.ok(r.ok);
  for (const [k, p] of r.partes.entries()) assert.ok(p.frenteEstradaM >= 5, `parte ${k + 1} sem frente (${p.frenteEstradaM.toFixed(1)} m)`);
});

test("divisão · imóvel em L: direção que partiria uma parte em dois pedaços é recusada", () => {
  // L: 100×100 menos o quadrado de cima à direita
  const L = [[0, 0], [100, 0], [100, 50], [50, 50], [50, 100], [0, 100]];
  const horizontal = dividir({ anel: L, fracoes: [1, 1, 1, 1] }, 90);   // divisas leste–oeste
  // a divisa que passa acima de y=50 corta só o braço vertical: ok; mas em 45° há cortes com 4 cruzamentos?
  assert.ok(horizontal.ok, horizontal.motivo);
  for (const p of horizontal.partes) assert.ok(Math.abs(p.areaM2 - 7500 / 4) < 0.01);
  // U: em divisas norte–sul cortando os dois braços, a reta cruza 4 vezes
  const U = [[0, 0], [300, 0], [300, 100], [200, 100], [200, 30], [100, 30], [100, 100], [0, 100]];
  const ruim = dividir({ anel: U, fracoes: [1, 1] }, 90);
  assert.equal(ruim.ok, false);
  assert.match(ruim.motivo, /4 pontos/);
  const bom = sugerirDivisoes({ anel: U, fracoes: [1, 1] })[0];
  assert.ok(bom.ok);
  for (const p of bom.partes) assert.ok(Math.abs(p.areaM2 - area(U) / 2) < 0.01);
});

test("divisão · inverter troca a ponta onde nasce a parte 1", () => {
  const ent = { anel: anelSalgada, fracoes: [2, 1] };
  const a = dividir(ent, 30), b = dividir({ ...ent, inverter: true }, 30);
  assert.ok(a.ok && b.ok);
  assert.ok(Math.abs(a.partes[0].areaM2 - b.partes[0].areaM2) < 0.5, "a parte 1 continua com 2/3");
  const cx = (p) => p.anel.reduce((s, q) => s + q.e, 0) / p.anel.length;
  assert.notEqual(Math.round(cx(a.partes[0])), Math.round(cx(b.partes[0])), "mas do outro lado");
});
