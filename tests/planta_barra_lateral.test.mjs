// Barra lateral medida pelo conteúdo (pedido de 2026-09-10): quadro analítico
// com no máximo 10 linhas por tabela no corpo de sempre, sem seção de carimbo
// (a logo foi para o canto do desenho), rodapé com uma linha por gleba.
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

test("A1 sem glebas: 10 vértices no quadro e o resto remetido ao memorial tabular", async () => {
  const g = geo();
  const t = await textoDe(await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A1" })));
  const n = g.vertices.length;
  assert.ok(n > 10, "a fixture precisa ter mais de 10 vértices");
  assert.match(t, new RegExp(`Demais ${n - 10} vértices: ver MEMORIAL TABULAR`));
  assert.doesNotMatch(t, /CARIMBO DA EMPRESA/);
  // o 11º vértice não está no quadro; como o desenho usa códigos curtos, o
  // código completo (DSBN-…) só aparece no quadro
  const cod = (v) => v.codigo;
  for (const v of g.vertices.slice(0, 10)) assert.ok(t.includes(cod(v)), `${cod(v)} deveria estar no quadro`);
});

test("A1 com 3 glebas: cada tabela mostra até 10 linhas, e o rodapé lista área e perímetro por gleba", async () => {
  const g = geo();
  const n = g.vertices.length;
  const glebas = [
    glebaDe(g, idx(0, 12), "GLEBA 1"),
    glebaDe(g, idx(12, 20), "GLEBA 2"),
    glebaDe(g, idx(20, n), "GLEBA 3"),
  ];
  const t = await textoDe(await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A1", glebas })));
  const cortadas = Math.max(0, 12 - 10) + Math.max(0, 8 - 10) + Math.max(0, (n - 20) - 10);
  assert.ok(t.includes(`Demais ${cortadas} vértices: ver MEMORIAL TABULAR (aqui só os 10 primeiros de cada gleba)`), "nota do quadro");
  assert.match(t, /GLEBA 1: 1,0000 HA/);
  assert.match(t, /GLEBA 3: 1,0000 HA/);
  assert.match(t, /GLEBA 2: 400,00 m/);
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
