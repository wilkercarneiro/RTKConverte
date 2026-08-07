// Folha de entrega e glebas — as duas capacidades novas do motor da planta.
//
// As duas entram como campo OPCIONAL em DadosPlanta, e é isso que garante que o
// serviço completo não mude: `folha` ausente cai na regra histórica
// (posse → A3, resto → A1) e `glebas` ausente não executa uma linha do desenho
// novo. A prova de que nada mudou está em nao_regressao_completo.test.mjs;
// aqui prova-se que o que foi acrescentado funciona.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { dadosPlantaDe, ehFolha, entrada, glebaDe, mesmoDesenho } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const geo = () => geometriaDoCalculo(montarServico(entrada(), proj4));

test("folha explícita manda sobre a regra de tipoImovel", async () => {
  const g = geo();
  // matrícula pedida em A4: é o caso da conferência de área, que é prévia
  const a4 = await gerarPlantaPdf(dadosPlantaDe(g, { tipoImovel: "matricula", folha: "A4" }));
  assert.equal(await ehFolha(a4, "A4"), true);
  // posse pedida em A1: a folha vence o default de posse
  const a1 = await gerarPlantaPdf(dadosPlantaDe(g, { tipoImovel: "posse", folha: "A1" }));
  assert.equal(await ehFolha(a1, "A1"), true);
});

test("folha ausente preserva a regra histórica", async () => {
  const g = geo();
  const m = await gerarPlantaPdf(dadosPlantaDe(g, { tipoImovel: "matricula" }));
  const p = await gerarPlantaPdf(dadosPlantaDe(g, { tipoImovel: "posse" }));
  assert.equal(await ehFolha(m, "A1"), true);
  assert.equal(await ehFolha(p, "A3"), true);
  // pedir explicitamente o que a regra já daria não pode mudar nada
  const mExpl = await gerarPlantaPdf(dadosPlantaDe(g, { tipoImovel: "matricula", folha: "A1" }));
  assert.equal(await mesmoDesenho(mExpl, m), true);
});

// duas glebas montadas de vértices do próprio levantamento, que é como a tela
// as produz
const glebas = (g) => [
  glebaDe(g, [0, 1, 2, 3], "GLEBA 1"),
  glebaDe(g, [10, 11, 12, 13, 14], "GLEBA 2"),
];

test("glebas desenhadas mudam o PDF; sem glebas ele não muda", async () => {
  const g = geo();
  const sem = await gerarPlantaPdf(dadosPlantaDe(g));
  const com = await gerarPlantaPdf(dadosPlantaDe(g, { glebas: glebas(g) }));
  assert.equal(await mesmoDesenho(com, sem), false, "o desenho tem de mudar com gleba");
  assert.ok(com.length > 1000);
});

test("gleba degenerada (menos de 3 pontos) é ignorada sem quebrar", async () => {
  const g = geo();
  const sem = await gerarPlantaPdf(dadosPlantaDe(g));
  // uma gleba de 2 pontos não fecha polígono: não desenha, e não derruba a planta
  const degenerada = await gerarPlantaPdf(dadosPlantaDe(g, { glebas: [glebaDe(g, [0, 1], "X")] }));
  assert.ok(degenerada.length > 1000, "a planta tem de sair mesmo assim");
  // nada foi desenhado, então o resultado é o mesmo de uma planta sem gleba
  assert.equal(await mesmoDesenho(degenerada, sem), true);
});

test("glebas convivem com a redução de folha", async () => {
  const g = geo();
  for (const folha of ["A1", "A3", "A4"]) {
    const pdf = await gerarPlantaPdf(dadosPlantaDe(g, { folha, glebas: glebas(g) }));
    assert.equal(await ehFolha(pdf, folha), true, `gleba em ${folha}`);
  }
});
