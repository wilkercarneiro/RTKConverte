// Gravar com o banco ainda sem a coluna nova (0042 monografia, 0043 assinar_com_imagem):
// o insert/update é refeito sem o campo, em vez de falhar inteiro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { erroColunaAusente, gravarSemColunasAusentes } from "../src/lib/coluna_ausente.ts";

const PGRST = (c) => ({ code: "PGRST204", message: `Could not find the '${c}' column of 'responsaveis_tecnicos' in the schema cache` });
const PG = (c) => ({ code: "42703", message: `column "${c}" of relation "servicos" does not exist` });

test("erro de coluna ausente: PostgREST e Postgres, só para a coluna citada", () => {
  assert.equal(erroColunaAusente(PGRST("assinar_com_imagem"), "assinar_com_imagem"), true);
  assert.equal(erroColunaAusente(PG("monografia"), "monografia"), true);
  assert.equal(erroColunaAusente(PG("monografia"), "assinar_com_imagem"), false);
  assert.equal(erroColunaAusente({ code: "23505", message: "duplicate key monografia" }, "monografia"), false);
  assert.equal(erroColunaAusente(null, "monografia"), false);
});

test("banco sem a coluna: repete sem o campo e conta o que ficou de fora", async () => {
  const chamadas = [];
  const { resultado, omitidas } = await gravarSemColunasAusentes(
    { nome: "RT", assinar_com_imagem: true }, ["assinar_com_imagem"],
    async (d) => { chamadas.push({ ...d }); return "assinar_com_imagem" in d ? { error: PGRST("assinar_com_imagem") } : { error: null, data: { id: "x" } }; },
  );
  assert.equal(resultado.error, null);
  assert.equal(resultado.data.id, "x");
  assert.deepEqual(omitidas, ["assinar_com_imagem"]);
  assert.deepEqual(chamadas, [{ nome: "RT", assinar_com_imagem: true }, { nome: "RT" }]);
});

test("banco com a coluna, ou erro de outra natureza: uma tentativa só", async () => {
  let n = 0;
  const ok = await gravarSemColunasAusentes({ a: 1, monografia: {} }, ["monografia"], async () => { n++; return { error: null }; });
  assert.equal(n, 1);
  assert.deepEqual(ok.omitidas, []);
  n = 0;
  const outro = await gravarSemColunasAusentes({ a: 1, monografia: {} }, ["monografia"], async () => { n++; return { error: { code: "42501", message: "permission denied" } }; });
  assert.equal(n, 1);
  assert.equal(outro.resultado.error.code, "42501");
  // campo ausente que não é opcional não é cortado
  n = 0;
  const naoOpcional = await gravarSemColunasAusentes({ x: 1 }, ["monografia"], async () => { n++; return { error: PG("x") }; });
  assert.equal(n, 1);
  assert.ok(naoOpcional.resultado.error);
});

test("serviço sem a coluna monografia: salva o resto, avisa uma vez e já não manda o campo", async () => {
  const { gravarServicoTolerante, AVISO_SEM_MONOGRAFIA } = await import("../src/lib/coluna_ausente.ts");
  const memo = {};
  const avisos = [];
  const chamadas = [];
  const gravar = async (d) => { chamadas.push(Object.keys(d)); return "monografia" in d ? { error: PG("monografia") } : { error: null }; };
  const campos = { denominacao: "FAZENDA", monografia: { marcos: {} } };
  for (let i = 0; i < 3; i++) {
    const r = await gravarServicoTolerante(campos, gravar, memo, (m) => avisos.push(m));
    assert.equal(r.error, null);
  }
  assert.deepEqual(avisos, [AVISO_SEM_MONOGRAFIA]);
  // 1ª: tenta com, repete sem; depois: direto sem
  assert.deepEqual(chamadas, [["denominacao", "monografia"], ["denominacao"], ["denominacao"], ["denominacao"]]);
  // serviço sem monografia digitada não gera aviso
  const memo2 = {}; const av2 = [];
  await gravarServicoTolerante({ denominacao: "X", monografia: null }, gravar, memo2, (m) => av2.push(m));
  assert.deepEqual(av2, []);
});
