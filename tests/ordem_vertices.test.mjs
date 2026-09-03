// Reordenação de vértices em bloco (src/lib/ordem.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { reordenarVertices } from "../src/lib/ordem.ts";

const anel = (nomes) => nomes.map((nome, ordem) => ({ ordem, nome, id: nome }));
const nomes = (vs) => vs.map((v) => v.nome).join("");
const ordens = (vs) => vs.map((v) => v.ordem);
const sel = (...ids) => (v) => ids.includes(v.id);

const base = () => anel(["A", "B", "C", "D", "E", "F"]);

test("as ordens saem sempre 0..n-1, e a confrontação viaja com o vértice", () => {
  const vs = base().map((v) => (v.nome === "C" ? { ...v, tipo: "M", descritivo: "VIZINHO" } : v));
  const r = reordenarVertices(vs, sel("C"), { tipo: "inicio" });
  assert.deepEqual(ordens(r), [0, 1, 2, 3, 4, 5]);
  assert.equal(r[0].nome, "C");
  assert.equal(r[0].descritivo, "VIZINHO");
});

test("sem seleção nada muda", () => {
  assert.equal(nomes(reordenarVertices(base(), () => false, { tipo: "fim" })), "ABCDEF");
});

test("cima/baixo movem cada bloco selecionado um passo, preservando a ordem interna", () => {
  assert.equal(nomes(reordenarVertices(base(), sel("C", "D"), { tipo: "cima" })), "ACDBEF");
  assert.equal(nomes(reordenarVertices(base(), sel("C", "D"), { tipo: "baixo" })), "ABECDF");
  // já no topo: fica
  assert.equal(nomes(reordenarVertices(base(), sel("A", "B"), { tipo: "cima" })), "ABCDEF");
  // dois blocos separados sobem juntos
  assert.equal(nomes(reordenarVertices(base(), sel("B", "E"), { tipo: "cima" })), "BACEDF");
});

test("início e fim levam o bloco inteiro", () => {
  assert.equal(nomes(reordenarVertices(base(), sel("D", "F"), { tipo: "inicio" })), "DFABCE");
  assert.equal(nomes(reordenarVertices(base(), sel("A", "C"), { tipo: "fim" })), "BDEFAC");
});

test("depois de um ponto: o bloco entra logo após ele; alvo selecionado é ignorado", () => {
  assert.equal(nomes(reordenarVertices(base(), sel("A", "B"), { tipo: "depois", ordem: 3 })), "CDABEF");
  assert.equal(nomes(reordenarVertices(base(), sel("E", "F"), { tipo: "depois", ordem: 0 })), "AEFBCD");
  assert.equal(nomes(reordenarVertices(base(), sel("B", "C"), { tipo: "depois", ordem: 2 })), "ABCDEF");
});

test("inverter troca a sequência dos selecionados nas mesmas posições", () => {
  assert.equal(nomes(reordenarVertices(base(), sel("B", "C", "D"), { tipo: "inverter" })), "ADCBEF");
  assert.equal(nomes(reordenarVertices(base(), sel("A", "F"), { tipo: "inverter" })), "FBCDEA");
});

test("entrada fora de ordem é normalizada pela ordem, não pela posição na lista", () => {
  const embaralhado = [base()[3], base()[0], base()[5], base()[1], base()[4], base()[2]];
  assert.equal(nomes(reordenarVertices(embaralhado, sel("F"), { tipo: "inicio" })), "FABCDE");
});
