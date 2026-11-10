// Imóvel de mais de um dono (casal: o requerente e o segundo requerente). As
// peças técnicas já saíam com os dois; a planta tem de trazer o segundo em TODO
// lugar onde o primeiro aparece: planimétrico, assinaturas com selo do cartório,
// selo da folha A4 e o bloco de identificação de cada gleba (pedido de
// 2026-11-10: "também é dono da propriedade").
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo, glebasParaPlanta, montarDadosPlanta, servicoDaGleba } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { entrada } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const calc = montarServico(entrada(), proj4);
const g = geometriaDoCalculo(calc);
const servico = (extra = {}) => ({
  denominacao: "FAZENDA TESTE", detentor_nome: "JOSE MARIDO DA SILVA", detentor_cpf: "111.111.111-11",
  requerente2_nome: "MARIA ESPOSA DA SILVA", requerente2_cpf: "222.222.222-22",
  tipo_imovel: "matricula", matricula: "1.234", cns: "00.810-2", codigo_sncr: "", municipio: "ARACI", uf: "BA",
  ...extra,
});
const ctx = (s, extra = {}) => ({
  servico: s, rt: { nome: "RT", formacao: "Téc", conselho_sigla: "CFT", conselho_numero: "1" }, cred: { prefixo_vertice: "DSBN" },
  desenhista: "", geometria: g, fuso: 24, trt: "BR1", dataStr: "10/11/2026", ...extra,
});
async function textoDe(pdf) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true });
  return text;
}
const vezes = (t, s) => t.split(s).length - 1;
const n = g.vertices.length;
const idx = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const anel = (ids) => ids.map((i) => [g.vertices[i].e, g.vertices[i].n]);
const linhasGlebas = [
  { nome: "GLEBA 1", ordem: 0, anel: anel(idx(0, 15)) },
  { nome: "GLEBA 2", ordem: 1, anel: anel([14, ...idx(15, n), 0]) },
];

for (const folha of ["A1", "A3"]) {
  test(`${folha}: o segundo requerente sai no planimétrico e assina com selo próprio`, async () => {
    const t = await textoDe(await gerarPlantaPdf(montarDadosPlanta(ctx(servico(), { folha }))));
    assert.match(t, /PROPRIETÁRIOS/);
    assert.equal(vezes(t, "MARIA ESPOSA DA SILVA"), vezes(t, "JOSE MARIDO DA SILVA"), "aparece onde o primeiro aparece");
    assert.ok(vezes(t, "222.222.222-22") >= 2, "CPF no planimétrico e na assinatura");
    assert.equal(vezes(t, "SELO DE RECONHECIMENTO"), 3, "RT + 2 proprietários");
  });
}

test("A4: o selo da folha lista os dois proprietários", async () => {
  const t = await textoDe(await gerarPlantaPdf(montarDadosPlanta(ctx(servico(), { folha: "A4" }))));
  assert.match(t, /PROPRIETÁRIOS:/);
  assert.match(t, /JOSE MARIDO DA SILVA E MARIA ESPOSA DA SILVA/);
});

test("glebas: o bloco de cada gleba traz os dois donos", async () => {
  const glebas = glebasParaPlanta(linhasGlebas, calc, servico());
  for (const gl of glebas) {
    assert.ok(gl.identificacao.includes("MARIA ESPOSA DA SILVA"), `${gl.nome}: ${gl.identificacao.join(" | ")}`);
    assert.ok(gl.identificacao.includes("CPF:222.222.222-22"));
  }
  const t = await textoDe(await gerarPlantaPdf(montarDadosPlanta(ctx(servico(), { folha: "A1", glebas }))));
  assert.equal(vezes(t, "MARIA ESPOSA DA SILVA"), vezes(t, "JOSE MARIDO DA SILVA"));
});

test("partilha: a parte de um herdeiro não leva o cônjuge do dono de origem", () => {
  const s = servicoDaGleba(servico(), { detentor_nome: "FILHO HERDEIRO", detentor_cpf: "333.333.333-33" }, "PARTE 1");
  assert.equal(s.detentor_nome, "FILHO HERDEIRO");
  assert.equal(s.requerente2_nome, null);
  assert.equal(montarDadosPlanta(ctx(s)).proprietarios.length, 1);
  // sem herdeiro, a gleba é do imóvel: continua dos dois
  assert.equal(servicoDaGleba(servico(), null, "GLEBA 1").requerente2_nome, "MARIA ESPOSA DA SILVA");
});

test("um dono só: nada muda (singular e um selo de proprietário)", async () => {
  const t = await textoDe(await gerarPlantaPdf(montarDadosPlanta(ctx(servico({ requerente2_nome: null, requerente2_cpf: null }), { folha: "A1" }))));
  assert.doesNotMatch(t, /PROPRIETÁRIOS/);
  assert.equal(vezes(t, "SELO DE RECONHECIMENTO"), 2);
  const a4 = await textoDe(await gerarPlantaPdf(montarDadosPlanta(ctx(servico({ requerente2_nome: null }), { folha: "A4" }))));
  assert.match(a4, /PROPRIETÁRIO:/);
  assert.doesNotMatch(a4, / E MARIA/);
});

// Posse de casal (pedido de 2026-11-10, "ajuste para posse também"): os dois
// são posseiros e saem em todo lugar onde o primeiro sai, como na matrícula.
const posse = (extra = {}) => servico({ tipo_imovel: "posse", matricula: "", cns: "", ...extra });
for (const folha of [undefined, "A1", "A3"]) {
  test(`posse ${folha ?? "(folha padrão)"}: o segundo posseiro sai e assina com selo próprio`, async () => {
    const t = await textoDe(await gerarPlantaPdf(montarDadosPlanta(ctx(posse(), folha ? { folha } : {}))));
    assert.match(t, /POSSEIROS/);
    assert.ok(vezes(t, "MARIA ESPOSA DA SILVA") >= 2, "planimétrico e assinatura");
    assert.equal(vezes(t, "MARIA ESPOSA DA SILVA"), vezes(t, "JOSE MARIDO DA SILVA"));
    assert.ok(vezes(t, "222.222.222-22") >= 2);
    assert.equal(vezes(t, "SELO DE RECONHECIMENTO"), 3, "RT + 2 posseiros");
  });
}

test("posse A4: o selo lista os dois", async () => {
  const t = await textoDe(await gerarPlantaPdf(montarDadosPlanta(ctx(posse(), { folha: "A4" }))));
  assert.match(t, /POSSEIROS:/);
  assert.match(t, /JOSE MARIDO DA SILVA E MARIA ESPOSA DA SILVA/);
});

test("posse em glebas: o bloco de cada gleba traz os dois", () => {
  for (const gl of glebasParaPlanta(linhasGlebas, calc, posse())) {
    assert.ok(gl.identificacao.includes("(POSSE)"));
    assert.ok(gl.identificacao.includes("MARIA ESPOSA DA SILVA"), gl.identificacao.join(" | "));
  }
});

test("posse de um posseiro só: singular", async () => {
  const t = await textoDe(await gerarPlantaPdf(montarDadosPlanta(ctx(posse({ requerente2_nome: null, requerente2_cpf: null })))));
  assert.doesNotMatch(t, /POSSEIROS/);
  assert.equal(vezes(t, "SELO DE RECONHECIMENTO"), 2);
});
