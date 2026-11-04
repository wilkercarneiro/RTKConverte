// Travas da auditoria de segurança de 04/11/2026 (_shared/limite.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { CorpoInvalido, dentroDoLimite, lerJson, lerTexto } from "../supabase/functions/_shared/limite.ts";

const pedido = (corpo, headers = {}) => new Request("http://x/", { method: "POST", body: corpo, headers });

test("lerJson: corpo pequeno passa", async () => {
  assert.deepEqual(await lerJson(pedido('{"a":1}'), 1024), { a: 1 });
});

test("lerJson: Content-Length acima do teto é recusado antes de ler (413)", async () => {
  await assert.rejects(lerJson(pedido("{}", { "content-length": "999999999" }), 1024),
    (e) => e instanceof CorpoInvalido && e.status === 413);
});

test("lerTexto: corpo sem Content-Length que passa do teto é cortado (413)", async () => {
  const grande = new ReadableStream({
    start(c) { for (let i = 0; i < 20; i++) c.enqueue(new Uint8Array(1000)); c.close(); },
  });
  const req = new Request("http://x/", { method: "POST", body: grande, duplex: "half" });
  await assert.rejects(lerTexto(req, 5000), (e) => e instanceof CorpoInvalido && e.status === 413);
});

test("lerJson: JSON inválido vira 400", async () => {
  await assert.rejects(lerJson(pedido("{não é json"), 1024), (e) => e instanceof CorpoInvalido && e.status === 400);
});

test("dentroDoLimite: respeita a resposta do banco e libera se o banco falhar", async () => {
  const cli = (r) => ({ rpc: async () => r });
  assert.equal(await dentroDoLimite(cli({ data: true, error: null }), "k", 1, 60), true);
  assert.equal(await dentroDoLimite(cli({ data: false, error: null }), "k", 1, 60), false);
  assert.equal(await dentroDoLimite(cli({ data: null, error: { message: "sem a 0038" } }), "k", 1, 60), true);
  assert.equal(await dentroDoLimite({ rpc: async () => { throw new Error("rede"); } }, "k", 1, 60), true);
});
