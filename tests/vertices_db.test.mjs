// Regravação do anel de vértices (DELETE + INSERT) — caso FAZENDA CURRAL DA SERRA
// (2026-10-26): a correção de sobreposição inseria vértices novos sem `numerado`
// e `exibir_planta`; o supabase-js completou com NULL, o banco recusou (NOT NULL)
// e, como o DELETE já tinha rodado, o serviço ficou sem vértices. A tela mostrava
// "[object Object]".
//
// O dublê abaixo imita o PostgREST: o INSERT em lote usa a união das chaves e,
// sem `defaultToNull: false`, completa as ausentes com NULL; as colunas NOT NULL
// são as da tabela `vertices` na VPS em 2026-10-26.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mensagemDeErro, substituirVertices } from "../supabase/functions/_shared/vertices_db.ts";

const DEFAULTS = {
  tipo: "P", metodo: "PG6", inserido_manual: false, eh_via: false,
  codigo_provisorio: false, numerado: false, exibir_planta: true,
};
const NOT_NULL = ["servico_id", "ordem", ...Object.keys(DEFAULTS)];

function bancoFalso(linhasIniciais, { falharInsert = false } = {}) {
  let linhas = linhasIniciais.map((l) => ({ ...l }));
  let seq = 1000;
  const chamadasInsert = [];
  const cliente = {
    from: () => ({
      delete: () => ({
        eq: async (_c, sid) => { linhas = linhas.filter((l) => l.servico_id !== sid); return { data: null, error: null }; },
      }),
      insert: (lote, opts) => ({
        select: () => ({
          order: async () => {
            chamadasInsert.push(opts);
            const n = chamadasInsert.length;
            if (falharInsert && n === 1) {
              return { data: null, error: { message: "falha simulada", details: null, hint: null, code: "XX000" } };
            }
            const chaves = [...new Set(lote.flatMap((l) => Object.keys(l)))];
            const prontas = [];
            for (const l of lote) {
              const r = { id: l.id ?? `novo-${seq++}` };
              for (const k of chaves) {
                r[k] = k in l ? l[k] : (opts?.defaultToNull === false ? (DEFAULTS[k] ?? null) : null);
              }
              for (const [k, v] of Object.entries(DEFAULTS)) if (!(k in r)) r[k] = v;
              const nula = NOT_NULL.find((k) => r[k] === null || r[k] === undefined);
              if (nula) {
                return {
                  data: null,
                  error: {
                    message: `null value in column "${nula}" of relation "vertices" violates not-null constraint`,
                    details: "Failing row contains (...)", hint: null, code: "23502",
                  },
                };
              }
              prontas.push(r);
            }
            linhas.push(...prontas);
            return { data: prontas.sort((a, b) => a.ordem - b.ordem), error: null };
          },
        }),
      }),
    }),
  };
  return { cliente, linhas: () => linhas, chamadasInsert };
}

const SID = "954e1026-d09f-4241-9d8f-b24aebeec762";
const antigas = [0, 1, 2].map((i) => ({
  id: `v${i}`, servico_id: SID, ordem: i, tipo: i === 0 ? "M" : "P", metodo: "PG6", inserido_manual: false,
  eh_via: false, codigo_provisorio: false, numerado: false, exibir_planta: true, codigo: `DSBN-P-${i}`,
}));

test("CURRAL DA SERRA: vértice novo sem numerado/exibir_planta entra com o default do banco", async () => {
  const b = bancoFalso(antigas);
  const mantidas = antigas.map(({ id: _id, ...v }) => v);
  // vértice certificado do vizinho montado como a correção montava antes (sem as duas colunas)
  const novo = { servico_id: SID, ordem: 3, tipo: "P", codigo: "ABCD-M-0001", metodo: "PG2", inserido_manual: true, eh_via: false, codigo_provisorio: false };
  const gravadas = await substituirVertices(b.cliente, SID, [...mantidas, novo], antigas);
  assert.equal(gravadas.length, 4);
  assert.equal(b.chamadasInsert[0]?.defaultToNull, false, "INSERT precisa pedir missing=default");
  const g = b.linhas().find((l) => l.codigo === "ABCD-M-0001");
  assert.equal(g.numerado, false);
  assert.equal(g.exibir_planta, true);
});

test("sem defaultToNull:false o mesmo lote é recusado (é o bug original)", async () => {
  const b = bancoFalso([]);
  const lote = [
    { servico_id: SID, ordem: 0, numerado: true, exibir_planta: true },
    { servico_id: SID, ordem: 1 },
  ];
  const r = await b.cliente.from("vertices").insert(lote, undefined).select().order("ordem");
  assert.equal(r.error?.code, "23502");
});

test("INSERT recusado: os vértices antigos voltam e a mensagem é legível", async () => {
  const b = bancoFalso(antigas, { falharInsert: true });
  await assert.rejects(
    substituirVertices(b.cliente, SID, [{ servico_id: SID, ordem: 0 }], antigas),
    (e) => {
      assert.match(e.message, /falha simulada/);
      assert.match(e.message, /continua como estava/);
      assert.doesNotMatch(e.message, /object Object/);
      return true;
    },
  );
  assert.deepEqual(b.linhas().map((l) => l.id).sort(), ["v0", "v1", "v2"]);
});

test("mensagemDeErro: erro do PostgREST não vira [object Object]", () => {
  const pg = { message: 'null value in column "numerado" of relation "vertices" violates not-null constraint', details: "Failing row", hint: null, code: "23502" };
  assert.equal(String(pg), "[object Object]");
  const m = mensagemDeErro(pg);
  assert.match(m, /numerado/);
  assert.match(m, /\[23502\]/);
  assert.equal(mensagemDeErro(new Error("x")), "x");
  assert.equal(mensagemDeErro("texto"), "texto");
  assert.equal(mensagemDeErro({ a: 1 }), '{"a":1}');
});
