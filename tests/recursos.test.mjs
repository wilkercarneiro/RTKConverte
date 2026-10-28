// O catálogo de recursos (src/lib/recursos.ts) é o que o painel do superadmin
// manda ao banco. Estes testes lacram as regras que o banco e a tela assumem:
// chave válida e única, toda modalidade vira recurso, toda trava usada na tela
// existe no catálogo, e as chaves que a migração 0024 semeia batem com o código.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RECURSOS, definirRecursos, recursoDe, temRecurso } from "../src/lib/recursos.ts";
import { SERVICOS } from "../src/lib/modalidades.ts";

test("chaves válidas para o banco e sem repetição", () => {
  const vistas = new Set();
  for (const r of RECURSOS) {
    assert.match(r.chave, /^[a-z0-9][a-z0-9_.-]*$/, r.chave);
    assert.ok(!vistas.has(r.chave), `chave repetida: ${r.chave}`);
    vistas.add(r.chave);
    assert.ok(r.nome && r.grupo, `${r.chave} sem nome ou grupo`);
  }
});

test("toda modalidade de serviço é um recurso", () => {
  for (const s of SERVICOS) assert.ok(recursoDe(`servico.${s.chave}`), `falta servico.${s.chave}`);
});

test("as chaves semeadas pela migração existem no código", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0024_saas.sql", import.meta.url), "utf8");
  const semeadas = [...sql.matchAll(/\('(servico\.[a-z]+)',/g)].map((m) => m[1]);
  assert.ok(semeadas.length >= 7);
  for (const c of semeadas) assert.ok(recursoDe(c), `${c} está na migração mas não no código`);
  // e o mapeamento serviço → chave do banco cobre toda modalidade
  for (const s of SERVICOS) assert.ok(sql.includes(`'servico.${s.chave}'`), `chave_recurso_do_servico não conhece servico.${s.chave}`);
});

function arquivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

test("toda trava usada na tela está no catálogo", () => {
  const usadas = new Set();
  for (const f of arquivos(new URL("../src", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"))) {
    for (const m of readFileSync(f, "utf8").matchAll(/temRecurso\("([^"]+)"\)/g)) usadas.add(m[1]);
  }
  assert.ok(usadas.size >= 5, "esperava travas nas telas");
  for (const c of usadas) assert.ok(recursoDe(c), `temRecurso("${c}") sem entrada em RECURSOS`);
});

test("temRecurso: banco sem planos libera tudo; com mapa, vale o mapa e depois o padrão", () => {
  definirRecursos(null);
  assert.equal(temRecurso("servico.loteamento"), true);
  definirRecursos({ "servico.loteamento": false });
  assert.equal(temRecurso("servico.loteamento"), false);
  assert.equal(temRecurso("planta.editor"), true, "ainda não sincronizado: segue o padrão do código");
  definirRecursos(null);
});
