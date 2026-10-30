// "Concluir serviço" (0033): concluído é a decisão da equipe (concluido_em),
// não só documentos prontos. O progresso mostrado no Início, nos Serviços e no
// cliente segue isso.
import { test } from "node:test";
import assert from "node:assert/strict";
import { progressoDe, progressoDosDocumentos } from "../src/lib/progresso.ts";

const completo = { modalidade: "completo", tipo: "geo", status: "gerado" };
const tudo = { docs: true, planta: true, pecas: true };

test("tudo gerado e ainda não concluído: falta concluir o serviço", () => {
  const p = progressoDe({ ...completo, concluido_em: null }, tudo);
  assert.equal(p.concluido, false);
  assert.equal(p.falta, "concluir o serviço");
  assert.deepEqual(p.etapas, [true, true, true]);
  assert.equal(progressoDosDocumentos(completo, tudo).concluido, true, "os documentos, sozinhos, estão prontos");
});

test("concluído pela equipe: concluído, mesmo antes de gerar tudo", () => {
  const p = progressoDe({ ...completo, concluido_em: "2026-10-30T12:00:00Z" }, { docs: true, planta: false, pecas: false });
  assert.equal(p.concluido, true);
  assert.equal(p.falta, "concluído");
  assert.equal(p.atual, -1);
});

test("em andamento: a frase continua sendo a do documento que falta", () => {
  const p = progressoDe({ ...completo, concluido_em: null }, { docs: true, planta: false, pecas: false });
  assert.equal(p.concluido, false);
  assert.equal(p.falta, "enviar o PDF do SIGEF e gerar a planta");
});

test("conferência: pronta nos documentos; concluída só ao concluir", () => {
  const conf = { modalidade: "conferencia", tipo: "geo", status: "gerado" };
  assert.equal(progressoDe({ ...conf, concluido_em: null }, { docs: true, planta: false, pecas: false }).falta, "concluir o serviço");
  assert.equal(progressoDe({ ...conf, concluido_em: "2026-10-30T12:00:00Z" }, { docs: true, planta: false, pecas: false }).concluido, true);
});

test("CAR e loteamento: prontos quando exportados", () => {
  for (const modalidade of ["car", "loteamento"]) {
    assert.equal(progressoDe({ modalidade, tipo: "geo", status: "rascunho", concluido_em: null }).concluido, false);
    assert.equal(progressoDe({ modalidade, tipo: "geo", status: "gerado", concluido_em: null }).falta, "concluir o serviço");
  }
});
