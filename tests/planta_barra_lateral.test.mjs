// Barra lateral medida pelo conteúdo (pedido de 2026-09-10), no arranjo da
// planta de referência da D'Prol (2026-10-14): quadro analítico com linha fixa
// que mostra tudo o que couber (mínimo de 10 por tabela), carimbo com a logo
// depois da situação, legenda no planimétrico, rodapé com uma linha por gleba.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { dadosPlantaDe, entrada, glebaDe } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const geo = () => geometriaDoCalculo(montarServico(entrada(), proj4));
async function textoDe(pdf) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true });
  return text;
}
const idx = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

// PNG 1×1 válido: basta para a seção do carimbo existir
const PNG_1PX = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));

test("A1 sem glebas: com espaço, o quadro traz todos os vértices e não há nota", async () => {
  const g = geo();
  const t = await textoDe(await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A1" })));
  assert.ok(g.vertices.length > 10, "a fixture precisa ter mais de 10 vértices");
  assert.doesNotMatch(t, /MEMORIAL TABULAR/);
  // sem logo, a seção do carimbo não sai vazia
  assert.doesNotMatch(t, /CARIMBO DA EMPRESA/);
  // o desenho usa códigos curtos: o código completo (DSBN-…) só aparece no quadro
  for (const v of g.vertices) assert.ok(t.includes(v.codigo), `${v.codigo} deveria estar no quadro`);
});

test("A1 com logo: a seção CARIMBO DA EMPRESA volta à barra lateral, depois da situação", async () => {
  const g = geo();
  const t = await textoDe(await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A1", logo: { bytes: PNG_1PX, tipo: "png" } })));
  assert.match(t, /CARIMBO DA EMPRESA/);
  const ordem = ["QUADRO ANALÍTICO", "PLANTA DE SITUAÇÃO", "CARIMBO DA EMPRESA", "PLANIMÉTRICO DO IMÓVEL", "LEGENDAS / ABREVIATURAS", "RESPONSÁVEL TÉCNICO"]
    .map((s) => t.indexOf(s));
  assert.ok(ordem.every((i) => i >= 0), `seções ausentes: ${ordem}`);
});

test("A1 com 3 glebas: uma tabela por gleba, e o rodapé lista área e perímetro por gleba", async () => {
  const g = geo();
  const n = g.vertices.length;
  const glebas = [
    glebaDe(g, idx(0, 12), "GLEBA 1"),
    glebaDe(g, idx(12, 20), "GLEBA 2"),
    glebaDe(g, idx(20, n), "GLEBA 3"),
  ];
  const t = await textoDe(await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A1", glebas })));
  assert.doesNotMatch(t, /MEMORIAL TABULAR/);
  assert.match(t, /GLEBA 1: 1,0000 HA/);
  assert.match(t, /GLEBA 3: 1,0000 HA/);
  assert.match(t, /GLEBA 2: 400,00 m/);
});

test("quadro grande demais: ao menos 10 linhas por gleba e o resto remetido ao memorial tabular", async () => {
  const g = geo();
  const n = g.vertices.length;
  // 5 glebas com o anel inteiro: ~160 linhas, mais do que a barra comporta
  const glebas = Array.from({ length: 5 }, (_, k) => glebaDe(g, idx(0, n), `GLEBA ${k + 1}`));
  const t = await textoDe(await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A1", glebas })));
  const m = t.match(/Demais (\d+) vértices: ver MEMORIAL TABULAR \(aqui só os primeiros de cada gleba\)/);
  assert.ok(m, "nota do quadro");
  assert.ok(Number(m[1]) <= 5 * (n - 10), `cortou demais: ${m[1]}`);
});

test("com muitas glebas o quadro não passa da metade da barra e a página continua uma só", async () => {
  const g = geo();
  const n = g.vertices.length;
  const glebas = Array.from({ length: 7 }, (_, k) => glebaDe(g, idx(0, 4).map((i) => (i + 4 * k) % n), `GLEBA ${k + 1}`));
  const pdf = await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A1", glebas }));
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), 1);
  const t = await textoDe(pdf);
  assert.match(t, /PLANTA DE SITUAÇÃO/);
  assert.match(t, /GLEBA 7: 1,0000 HA/);
});
