// Contorno por ligações (src/lib/contorno.ts): excluir ponto, ligar, desligar e
// as glebas saindo das áreas fechadas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { areasFechadas, desligar, excluirPonto, ligacoesIniciais, ligar } from "../src/lib/contorno.ts";
import { areaHaDoAnel } from "../src/lib/glebas.ts";
import { VERTICES, GLEBAS } from "./fixtures/ibera.mjs";

const vs = (pts) => pts.map(([e, n], i) => ({ ordem: i, e, n }));
// quadrado 0..3 com o ponto 4 no meio do lado de baixo e o 5 no meio do de cima
const Q = vs([[0, 0], [100, 0], [100, 100], [0, 100], [50, 0], [50, 100]]);

test("contorno · sem gleba, a sequência fecha no primeiro ponto e é uma área só", () => {
  const sq = vs([[0, 0], [100, 0], [100, 100], [0, 100]]);
  const ls = ligacoesIniciais(sq, []);
  assert.equal(ls.length, 4);
  const r = areasFechadas(sq, ls);
  assert.equal(r.aneis.length, 1);
  assert.deepEqual(r.pontas, []);
});

test("contorno · ligar dois pontos do perímetro divide em duas glebas; desligar volta a uma", () => {
  let ls = [[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0]];
  assert.equal(areasFechadas(Q, ls).aneis.length, 1);
  ls = ligar(ls, 4, 5);
  const r = areasFechadas(Q, ls);
  assert.equal(r.aneis.length, 2);
  const has = r.aneis.map((a) => areaHaDoAnel(a.map((o) => [Q[o].e, Q[o].n])));
  assert.deepEqual(has.map((h) => Math.round(h * 10000)), [5000, 5000]);
  assert.equal(areasFechadas(Q, desligar(ls, 5, 4)).aneis.length, 1);
});

test("contorno · excluir ponto unindo os vizinhos mantém fechado; sem unir, avisa as pontas", () => {
  const ls = [[0, 4], [4, 1], [1, 2], [2, 5], [5, 3], [3, 0]];
  const unido = areasFechadas(Q, excluirPonto(ls, 4, true));
  assert.equal(unido.aneis.length, 1);
  assert.deepEqual(unido.soltos, [4]);
  const aberto = areasFechadas(Q, excluirPonto(ls, 4, false));
  assert.equal(aberto.aneis.length, 0);
  assert.ok(aberto.pontas.includes(0) && aberto.pontas.includes(1));
});

test("contorno · ligação cruzada é apontada", () => {
  const ls = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [1, 3]];
  assert.ok(areasFechadas(vs([[0, 0], [100, 0], [100, 100], [0, 100]]), ls).cruzadas.length >= 1);
});

test("contorno · IBERA: a sequência do TXT cruza; pelas glebas saem as duas áreas certas", () => {
  const V = VERTICES.map(([ordem, , , e, n]) => ({ ordem, e, n }));
  // o que a prancheta fazia: a sequência inteira (117 → 200 → … → 217 → 1)
  const seq = ligacoesIniciais(V, []);
  const rs = areasFechadas(V, seq);
  assert.ok(rs.cruzadas.length > 0, "a sequência do TXT cruza o próprio desenho");
  // pelas glebas do serviço
  const ls = ligacoesIniciais(V, GLEBAS);
  const r = areasFechadas(V, ls);
  assert.equal(r.cruzadas.length, 0);
  assert.equal(r.aneis.length, 2);
  const has = r.aneis.map((a) => areaHaDoAnel(a.map((o) => [V[o].e, V[o].n])));
  const esperado = GLEBAS.map((g) => areaHaDoAnel(g.anel)).sort((a, b) => b - a);
  has.forEach((h, k) => assert.ok(Math.abs(h - esperado[k]) < 0.001, `área ${k + 1}: ${h} × ${esperado[k]}`));
});

test("contorno · a prancheta divide o contorno das ligações em qualquer sentido de giro", async () => {
  const { default: proj4lib } = await import("proj4");
  const { sugerirDivisoes, dividir } = await import("../src/lib/divisao.ts");
  const { entradaDoServico, publicadorUtm } = await import("../src/lib/divisao_servico.ts");
  const { ANEL } = await import("./fixtures/salgada_velha.mjs");
  const base = ANEL.map(([ordem, e, n, tipo]) => ({ id: `v${ordem}`, servico_id: "s", ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 0, sigma_pos: 0.01, sigma_h: 0.01, tipo, codigo: null, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "", descritivo: tipo === "M" ? `VIZINHO ${ordem}` : null, tipo_limite: tipo === "M" ? "LA1" : null }));
  // a volta que areasFechadas devolve (anti-horária), mapeada de volta para os vértices
  const r = areasFechadas(base, ligacoesIniciais(base, []));
  assert.equal(r.aneis.length, 1);
  const porOrdem = new Map(base.map((v) => [v.ordem, v]));
  for (const lista of [base, r.aneis[0].map((o) => porOrdem.get(o))]) {
    const ent = entradaDoServico(lista, [1, 1], false, publicadorUtm(24, (f, t, c) => proj4lib(f, t, c)));
    const d = dividir(ent, sugerirDivisoes(ent)[0].azimute);
    assert.ok(d.ok, d.motivo);
    assert.ok(Math.abs(d.partes[0].areaM2 - d.partes[1].areaM2) < 1, `${d.partes[0].areaM2} × ${d.partes[1].areaM2}`);
  }
});
