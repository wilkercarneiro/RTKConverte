// REDE DE PROTEÇÃO da reestruturação em três modalidades.
//
// O "serviço completo" é o fluxo que já funciona ponta a ponta, e a regra que
// governa toda a mudança é: `modalidade = 'completo'` sem glebas tem de executar
// exatamente o mesmo código de antes. Este arquivo lacra os números desse fluxo
// com o anel real da FAZENDA SALGADA VELHA, para que qualquer desvio apareça
// aqui antes de aparecer numa planta entregue ao cliente.
//
// Não é teste de comportamento novo: é lacre no comportamento antigo. Se um
// valor daqui mudar, ou a mudança é intencional — e o número se atualiza junto
// com a explicação — ou é o bug que este arquivo existe para pegar.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { dadosPlantaDe, ehFolha, entrada, mesmoDesenho } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const calcular = (opts) => montarServico(entrada(opts), proj4);

test("não-regressão · geometria do serviço completo", () => {
  const c = calcular();
  assert.equal(c.areaHa.toFixed(4), "6.7238");
  assert.equal(c.perimetroM.toFixed(2), "1291.52");
  assert.equal(c.ring.length, 32);
  assert.equal(c.segs.length, 32);
  assert.equal(c.mcAbs, 39);
});

test("não-regressão · o anel publicado começa no vértice mais ao norte", () => {
  const c = calcular();
  const maisAoNorte = c.ring.reduce((a, b) => (b.nProj > a.nProj ? b : a));
  assert.equal(c.ring[0].codigo, maisAoNorte.codigo);
  assert.equal(c.ring[0].codigo, "DSBN-P-14300");
});

test("não-regressão · trechos e faixas de domínio", () => {
  const c = calcular();
  assert.equal(c.trechosOrdenados.length, 4, "um trecho por vértice M");
  assert.deepEqual(
    c.trechosOrdenados.filter((t) => t.ehVia).map((t) => t.descritivo),
    ["ESTRADA VICINAL", "LINHA FERREA"],
  );

  const g = geometriaDoCalculo(c);
  assert.equal(g.areaFmt, "6,7238");
  assert.equal(g.perimetroFmt, "1.291,52");
  assert.equal(g.trechos.filter((t) => t.isEstrada).length, 2);

  // mesma varredura de planta.ts: a aresta herda o trecho do seu vértice inicial
  const trechoDoIdx = (i) => g.trechos.find((t) =>
    t.fimIdx > t.inicioIdx ? i >= t.inicioIdx && i < t.fimIdx : i >= t.inicioIdx || i < t.fimIdx
  ) ?? g.trechos[g.trechos.length - 1];
  const vermelhas = g.vertices.filter((_, i) => trechoDoIdx(i).isEstrada);
  assert.equal(vermelhas.length, 2, "exatamente as duas divisas marcadas como via");
});

test("não-regressão · alocação consome os contadores do credenciado", () => {
  // Sem código gravado, montarServico aloca a partir dos contadores recebidos —
  // é o caminho que a RPC alocar_contadores alimenta em produção. A conferência
  // de área NÃO passa por aqui: usa prefixo provisório e não toca em credenciados.
  const c = calcular({ comCodigo: false, contadores: { M: 100, P: 200, V: 300 } });
  assert.deepEqual(c.contadoresFinais, { M: 104, P: 228, V: 300 });
  assert.ok(c.ring.every((v) => /^DSBN-[MPV]-\d+$/.test(v.codigo)));
});

test("não-regressão · matrícula continua saindo em A1", async () => {
  const g = geometriaDoCalculo(calcular());
  const pdf = await gerarPlantaPdf(dadosPlantaDe(g, { tipoImovel: "matricula" }));
  assert.equal(await ehFolha(pdf, "A1"), true);
});

test("não-regressão · posse continua saindo em A3", async () => {
  const g = geometriaDoCalculo(calcular());
  const pdf = await gerarPlantaPdf(dadosPlantaDe(g, { tipoImovel: "posse" }));
  assert.equal(await ehFolha(pdf, "A3"), true);
});

test("não-regressão · planta sem glebas não desenha nada a mais", async () => {
  // Guarda da Fase 3: o caminho de gleba é todo `if (d.glebas?.length)`. Serviço
  // sem gleba tem de produzir o MESMO PDF, byte a byte, com o campo ausente,
  // vazio ou indefinido.
  const g = geometriaDoCalculo(calcular());
  const semCampo = await gerarPlantaPdf(dadosPlantaDe(g));
  const vazio = await gerarPlantaPdf(dadosPlantaDe(g, { glebas: [] }));
  const indefinido = await gerarPlantaPdf(dadosPlantaDe(g, { glebas: undefined }));
  assert.equal(await mesmoDesenho(vazio, semCampo), true);
  assert.equal(await mesmoDesenho(indefinido, semCampo), true);
});
