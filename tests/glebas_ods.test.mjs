// Planilha SIGEF das glebas: as linhas de cada aba `perimetro_N`.
//
// Referência: FAZ COIXO.ODS — uma aba por parte, cada vértice com o descritivo
// do confrontante do lado que sai dele. Dois pontos que este teste prova:
//
// 1. O anel da gleba é gravado com o E/N BRUTO do vértice (o que a tela tem) e o
//    cálculo re-projeta a partir do GMS arredondado — diferença de até ~2 cm.
//    Casar ao milímetro nunca casava e a gleba saía sem código. Agora casa por
//    proximidade (10 cm).
// 2. A divisa INTERNA (o lado que fecha a gleba por dentro) confronta com a gleba
//    vizinha: texto do operador ou o automático no formato dos demais.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { casarNoRing, glebasParaPlanta, perimetrosOdsDasGlebas } from "../supabase/functions/_shared/planta_dados.ts";
import { ANEL, entrada } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const calc = montarServico(entrada(), proj4);
const SERVICO = {
  denominacao: "Fazenda Salgada Velha", detentor_nome: "Fulano de Tal", detentor_cpf: "000.000.000-00",
  matricula: "1.234", cns: "00.810-2", tipo_imovel: "matricula",
};
// E/N brutos do banco (coluna 1 e 2 do ANEL), como a tela grava — NÃO eProj
const pontos = (idx) => idx.map((i) => [ANEL[i][1], ANEL[i][2]]);
const seq = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
const cod = (i) => ANEL[i][4];

test("ponto a até 10 cm do vértice casa com ele (o E/N bruto do TXT difere do re-projetado em até ~2 cm)", () => {
  const [, e, n] = ANEL[5];
  assert.equal(casarNoRing(calc.ring, e, n)?.codigo, cod(5));
  assert.equal(casarNoRing(calc.ring, e + 0.021, n - 0.02)?.codigo, cod(5), "3 cm de desvio tem de casar");
  assert.equal(casarNoRing(calc.ring, e + 0.2, n), null, "20 cm já não é o mesmo vértice");
  assert.equal(casarNoRing(calc.ring, e + 5, n), null, "5 m longe não é vértice nenhum");
});

test("glebasParaPlanta: os vértices da gleba saem com código (antes saíam vazios)", () => {
  const [g] = glebasParaPlanta([{ nome: "GLEBA 1", ordem: 0, anel: pontos(seq(0, 14)) }], calc, SERVICO);
  assert.equal(g.vertices.length, 15);
  assert.ok(g.vertices.every((v) => v.codigo !== ""), "vértice da gleba sem código");
  assert.equal(g.vertices[0].codigo, cod(0));
});

test("duas glebas → duas abas; a divisa interna confronta com a gleba vizinha, o resto herda o perímetro", () => {
  const rows = [
    { nome: "GLEBA 1", ordem: 0, anel: pontos(seq(0, 14)) },              // 0..14, fecha 14→0 por dentro
    { nome: "GLEBA 2", ordem: 1, anel: pontos([...seq(14, 31), 0]) },     // 14..31, 0, fecha 0→14 por dentro
  ];
  const abas = perimetrosOdsDasGlebas(rows, calc, SERVICO);
  assert.equal(abas.length, 2);
  assert.deepEqual(abas.map((a) => a.nome), ["GLEBA 1", "GLEBA 2"]);
  assert.deepEqual(abas.map((a) => a.semCodigo), [0, 0]);
  assert.equal(abas[0].linhas.length, 15);
  assert.equal(abas[1].linhas.length, 19);

  // GLEBA 1: o vértice 14 (DSBN-P-14312, "LINHA FERREA" no perímetro) inicia a divisa
  // interna 14→0: confronta com a GLEBA 2, no formato dos outros confrontantes
  const l14 = abas[0].linhas.find((l) => l.codigo === cod(14));
  assert.equal(l14.descritivo, "(MATR.1.234/CNS.00.810-2) FAZENDA SALGADA VELHA - GLEBA 2\\ FULANO DE TAL\\ CPF:000.000.000-00");
  assert.equal(l14.tipoLimite, "LA1");
  // os demais herdam EXATAMENTE a linha do perímetro (descritivo e tipo de limite)
  const doPerimetro = (c) => calc.linhasOds.find((l) => l.codigo === c);
  for (const i of seq(0, 13)) {
    const l = abas[0].linhas.find((x) => x.codigo === cod(i));
    assert.deepEqual([l.descritivo, l.tipoLimite], [doPerimetro(cod(i)).descritivo, doPerimetro(cod(i)).tipoLimite], `vértice ${i}`);
  }
  const l3 = abas[0].linhas.find((l) => l.codigo === cod(3));
  assert.equal(l3.descritivo, "ESTRADA VICINAL");
  assert.equal(l3.tipoLimite, "LA3");

  // GLEBA 2: o vértice 0 inicia a divisa interna 0→14: confronta com a GLEBA 1
  const l0 = abas[1].linhas.find((l) => l.codigo === cod(0));
  assert.match(l0.descritivo, /FAZENDA SALGADA VELHA - GLEBA 1\\ FULANO DE TAL/);
  // e o vértice 14 na GLEBA 2 segue o perímetro (14→15): herda a linha do imóvel, não o texto interno
  const l14b = abas[1].linhas.find((l) => l.codigo === cod(14));
  assert.deepEqual([l14b.descritivo, l14b.tipoLimite], [doPerimetro(cod(14)).descritivo, doPerimetro(cod(14)).tipoLimite]);
  assert.doesNotMatch(l14b.descritivo, /GLEBA 1/);
});

test("confrontante interno digitado pelo operador vale sobre o automático", () => {
  const rows = [
    { nome: "GLEBA 1", ordem: 0, anel: pontos(seq(0, 14)), confrontante_interno: "GLEBA 2 - MESMO PROPRIETÁRIO" },
    { nome: "GLEBA 2", ordem: 1, anel: pontos([...seq(14, 31), 0]) },
  ];
  const [a1] = perimetrosOdsDasGlebas(rows, calc, SERVICO);
  assert.equal(a1.linhas.find((l) => l.codigo === cod(14)).descritivo, "GLEBA 2 - MESMO PROPRIETÁRIO");
});

test("gleba única sem vizinha e ponto livre: texto genérico e aviso por ponto sem código", () => {
  const livre = [ANEL[7][1] + 40, ANEL[7][2] + 40];
  const rows = [{ nome: "GLEBA 1", ordem: 0, anel: [...pontos(seq(0, 6)), livre] }];
  const [a] = perimetrosOdsDasGlebas(rows, calc, SERVICO);
  assert.equal(a.semCodigo, 1);
  assert.equal(a.linhas.length, 7);
  // 6 → ponto livre é divisa interna; sem gleba vizinha conhecida
  assert.match(a.linhas.find((l) => l.codigo === cod(6)).descritivo, /- GLEBA VIZINHA\\ FULANO DE TAL/);
});

test("posse: o automático sai com (POSSE) em vez de matrícula/CNS", () => {
  const rows = [
    { nome: "GLEBA 1", ordem: 0, anel: pontos(seq(0, 14)) },
    { nome: "GLEBA 2", ordem: 1, anel: pontos([...seq(14, 31), 0]) },
  ];
  const [a1] = perimetrosOdsDasGlebas(rows, calc, { ...SERVICO, tipo_imovel: "posse" });
  assert.equal(a1.linhas.find((l) => l.codigo === cod(14)).descritivo, "(POSSE) FAZENDA SALGADA VELHA - GLEBA 2\\ FULANO DE TAL\\ CPF:000.000.000-00");
});

// ---- calcularGleba: a gleba como anel próprio (memorial, tabular, planta A3, aba) ----
import { calcularGleba } from "../supabase/functions/_shared/planta_dados.ts";

test("calcularGleba: mesmos códigos do imóvel, trecho interno vira M com a gleba vizinha, área da gleba", () => {
  // corte 0–7: a reta 7→0 passa POR DENTRO do imóvel (o corte 0–14 dos testes
  // acima serve para as linhas, mas cruza a reentrância e as áreas não somam)
  const rows = [
    { nome: "GLEBA 1", ordem: 0, anel: pontos(seq(0, 7)) },
    { nome: "GLEBA 2", ordem: 1, anel: pontos([...seq(7, 31), 0]) },
  ];
  const g1 = calcularGleba(rows[0], rows, calc, SERVICO, { fusoUtm: 24, prefixo: "DSBN" }, proj4);
  assert.equal(g1.nome, "GLEBA 1");
  assert.equal(g1.semCodigo, 0);
  assert.equal(g1.calc.ring.length, 8);
  // códigos são os do imóvel — nenhum realocado
  const codsImovel = new Set(calc.ring.map((v) => v.codigo));
  assert.ok(g1.calc.ring.every((v) => codsImovel.has(v.codigo)));
  // a linha do vértice 7 na aba da gleba confronta com a GLEBA 2 (divisa interna)
  const l14 = g1.calc.linhasOds.find((l) => l.codigo === cod(7));
  assert.match(l14.descritivo, /FAZENDA SALGADA VELHA - GLEBA 2/);
  assert.equal(g1.calc.ring.find((v) => v.codigo === cod(7)).tipo, "M", "a divisa interna nasce num M");
  // e o vértice 3 (ESTRADA VICINAL, LA3) continua igual ao do imóvel
  const l3 = g1.calc.linhasOds.find((l) => l.codigo === cod(3));
  assert.equal(l3.descritivo, "ESTRADA VICINAL");
  assert.equal(l3.tipoLimite, "LA3");
  // a aba da gleba pelo anel próprio bate com a montagem antiga, linha a linha
  const antiga = perimetrosOdsDasGlebas(rows, calc, SERVICO)[0];
  for (const l of g1.calc.linhasOds) {
    const a = antiga.linhas.find((x) => x.codigo === l.codigo);
    assert.deepEqual([l.descritivo, l.tipoLimite], [a.descritivo, a.tipoLimite], l.codigo);
  }
  // área e perímetro próprios, memorial da gleba com o seu anel
  assert.ok(g1.calc.areaHa > 0 && g1.calc.areaHa < calc.areaHa, `área ${g1.calc.areaHa} de ${calc.areaHa}`);
  assert.equal(g1.calc.memorialRing.length, 8);
  const g2 = calcularGleba(rows[1], rows, calc, SERVICO, { fusoUtm: 24, prefixo: "DSBN" }, proj4);
  assert.ok(Math.abs(g1.calc.areaHa + g2.calc.areaHa - calc.areaHa) < 1e-4, "as duas glebas somam o imóvel");
});
