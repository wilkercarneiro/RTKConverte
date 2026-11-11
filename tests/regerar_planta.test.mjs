// "Gerar de novo" no visualizador (pedido de 2026-11-11: a planta antiga, de
// antes do editor, não editava e não havia como refazê-la dali). O tipo da
// linha do histórico decide a função que refaz a planta e a folha que já vem
// escolhida.
import { test } from "node:test";
import assert from "node:assert/strict";
import { caminhoDaPlanta, comoRegerar } from "../src/lib/historico.ts";

test("planta do SIGEF → gerar-planta, na folha do título", () => {
  assert.deepEqual(comoRegerar({ tipo: "planta_pdf", titulo: "Planta A3 (PDF · SIGEF)" }), { funcao: "gerar-planta", folha: "A3", gleba: null });
  assert.equal(comoRegerar({ tipo: "planta_pdf", titulo: "Planta (PDF)" }).folha, "A1");
});

test("planta do sistema → gerar-documentos", () => {
  assert.deepEqual(comoRegerar({ tipo: "planta_pdf_sistema", titulo: "Planta A1 (PDF · dados do sistema) · PRÉVIA" }), { funcao: "gerar-documentos", folha: "A1", gleba: null });
});

test("planta de gleba → gerar-documentos, abrindo a A3 da mesma gleba", () => {
  assert.deepEqual(comoRegerar({ tipo: "gleba_planta_pdf", titulo: "Planta A3 · GLEBA 2" }, "A1"), { funcao: "gerar-documentos", folha: "A1", gleba: "GLEBA 2" });
  assert.equal(comoRegerar({ tipo: "gleba_planta_pdf", titulo: "Planta A3 · PARTE 1 · PRÉVIA" }).gleba, "PARTE 1");
});

test("o que não é planta refeita pelo servidor não ganha o botão", () => {
  for (const tipo of ["planta_pdf_editada", "memorial_docx", "planilha_ods"]) assert.equal(comoRegerar({ tipo, titulo: "Planta A1" }), null);
});

test("caminho no bucket a partir da URL assinada", () => {
  assert.equal(caminhoDaPlanta({ url: "https://x/storage/v1/object/sign/gerados/abc-123/v4/planta%20A1.pdf?token=t" }), "abc-123/v4/planta A1.pdf");
  assert.equal(caminhoDaPlanta({ path: "p/q.pdf", url: "https://x/y" }), "p/q.pdf");
  assert.equal(caminhoDaPlanta({ url: "blob:abc" }), null);
});
