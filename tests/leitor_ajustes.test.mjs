// Ajustes de pontos na prévia (etapa "Leitura do arquivo", antes de gastar o
// crédito): ativar ponto inativo (apoio / outra versão) e ligar os pontos à mão.
// O mesmo código roda no navegador (prévia) e no parse-txt (que cria o serviço).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4 from "proj4";
import { executarReceita, lerLinhas } from "../supabase/functions/_shared/leitor/index.ts";
import { separarLinhas } from "../supabase/functions/_shared/leitor/abertura.ts";

const op = { proj4 };
const THEREZA = separarLinhas(readFileSync(new URL("../reference/THEREZA.txt", import.meta.url), "utf8"));

/** Quadrado de 100 m (e mais pontos) no formato da equipe. */
const linha = (nome, e, n) => `${nome};${String(e).replace(".", ",")};${String(n).replace(".", ",")};300,0;0,01;0,02`;

test("sem ajustes a leitura é a mesma de antes (nada muda para quem não mexe)", () => {
  const base = lerLinhas(THEREZA, op);
  const igual = executarReceita(THEREZA, base.receita, { ...op, incluir: [], ligacao: null });
  assert.deepEqual(igual.anel.map((p) => p.num), base.anel.map((p) => p.num));
  assert.equal(igual.criterio, base.criterio);
});

test("ligação manual: o anel segue exatamente a sequência ligada", () => {
  const linhas = [linha(1, 500000, 8700000), linha(2, 500100, 8700000), linha(3, 500100, 8700100), linha(4, 500000, 8700100)];
  const base = lerLinhas(linhas, op);
  // 1 → 4 → 3 → 2 (o mesmo quadrado no outro sentido)
  const l = executarReceita(linhas, base.receita, { ...op, ligacao: [[0, 3, 2, 1]] });
  assert.equal(l.criterio, "ligacao");
  assert.deepEqual(l.anel.map((p) => p.num), [1, 4, 3, 2]);
  assert.ok(l.ok);
  assert.ok(!l.aConfirmar.includes("desenho_cruza"));
});

test("ligação que cruza: avisa o lado que cruza e pede conferência", () => {
  const linhas = [linha(1, 500000, 8700000), linha(2, 500100, 8700000), linha(3, 500100, 8700100), linha(4, 500000, 8700100)];
  const base = lerLinhas(linhas, op);
  const l = executarReceita(linhas, base.receita, { ...op, ligacao: [[0, 2, 1, 3]] });
  assert.deepEqual(l.anel.map((p) => p.num), [1, 3, 2, 4]);
  assert.ok(l.aConfirmar.includes("desenho_cruza"));
});

test("ponto ativo deixado fora da ligação não entra, e isso pede conferência", () => {
  const linhas = [linha(1, 500000, 8700000), linha(2, 500100, 8700000), linha(3, 500100, 8700100), linha(4, 500000, 8700100), linha(5, 500050, 8700050)];
  const base = lerLinhas(linhas, op);
  const l = executarReceita(linhas, base.receita, { ...op, ligacao: [[0, 1, 2, 3]] });
  assert.deepEqual(l.anel.map((p) => p.num), [1, 2, 3, 4]);
  const fora = l.ignoradas.find((i) => i.tipo === "ligacao");
  assert.equal(fora?.linha, 5);
  assert.ok(l.aConfirmar.includes("fora_da_ligacao"));
  assert.ok(l.ok, "não é bloqueio: o operador confere");
});

test("ligação em duas partes vira dois blocos (glebas)", () => {
  const linhas = [
    linha(1, 500000, 8700000), linha(2, 500100, 8700000), linha(3, 500100, 8700100), linha(4, 500000, 8700100),
    linha(5, 500300, 8700000), linha(6, 500400, 8700000), linha(7, 500400, 8700100),
  ];
  const base = lerLinhas(linhas, op);
  const l = executarReceita(linhas, base.receita, { ...op, ligacao: [[0, 1, 2, 3], [4, 5, 6]] });
  assert.equal(l.blocos.length, 2);
  assert.deepEqual(l.blocos, [[0, 1, 2, 3], [4, 5, 6]]);
  assert.ok(l.ok);
});

test("parte da ligação com menos de 3 pontos bloqueia (não cria serviço torto)", () => {
  const linhas = [linha(1, 500000, 8700000), linha(2, 500100, 8700000), linha(3, 500100, 8700100), linha(4, 500000, 8700100), linha(5, 500300, 8700000), linha(6, 500400, 8700000)];
  const base = lerLinhas(linhas, op);
  const l = executarReceita(linhas, base.receita, { ...op, ligacao: [[0, 1, 2, 3], [4, 5]] });
  assert.ok(!l.ok);
  assert.ok(l.avisos.some((a) => a.codigo === "parte_curta" && a.nivel === "bloqueio"));
});

test("ligação ignora ponto excluído, repetido e índice inexistente", () => {
  const linhas = [linha(1, 500000, 8700000), linha(2, 500100, 8700000), linha(3, 500100, 8700100), linha(4, 500000, 8700100), linha(5, 500050, 8700150)];
  const base = lerLinhas(linhas, op);
  // linha 5 excluída; o índice 4 (dela) e 99 (não existe) e o 0 repetido somem da ligação
  const l = executarReceita(linhas, base.receita, { ...op, excluir: [5], ligacao: [[0, 1, 4, 2, 99, 3, 0]] });
  assert.deepEqual(l.anel.map((p) => p.num), [1, 2, 3, 4]);
  assert.ok(!l.aConfirmar.includes("fora_da_ligacao"));
});

test("ativar ponto de apoio: entra no perímetro e some o aviso de apoio", () => {
  const linhas = [linha(1, 500000, 8700000), linha(2, 500100, 8700000), linha(3, 500100, 8700100), "BASE;500000,0;8700100,0;300,0;0,01;0,02"];
  const base = lerLinhas(linhas, op);
  assert.equal(base.anel.length, 3);
  assert.ok(base.aConfirmar.includes("apoio_fora"));
  const l = executarReceita(linhas, base.receita, { ...op, incluir: [4] });
  assert.equal(l.anel.length, 4);
  assert.ok(l.anel.some((p) => p.nome === "BASE"));
  assert.ok(!l.avisos.some((a) => a.codigo === "apoio_fora"));
});

test("ativar ponto de outra versão: entra; se colidir com o mesmo número, bloqueia até desativar o outro", () => {
  const linhas = [
    linha(1, 500000, 8700000), linha(2, 500100, 8700000), linha(3, 500100, 8700100), linha(4, 500000, 8700100),
    linha("postp_1", 499990, 8699990), linha("postp_2", 500110, 8699990), linha("postp_3", 500110, 8700110),
  ];
  const base = lerLinhas(linhas, op);
  assert.equal(base.versoes.versoes.length, 2);
  const fora = base.pontos.find((p) => p.foraDaVersao);
  assert.ok(fora, "há ponto fora da versão");
  const l = executarReceita(linhas, base.receita, { ...op, incluir: [fora.linha] });
  assert.ok(l.anel.some((p) => p.linha === fora.linha) || l.avisos.some((a) => a.codigo === "nome_repetido"),
    "o ponto ativado entra, ou o conflito de número aparece para o operador resolver");
});

test("ligação manual sobre o arquivo real (THEREZA): reverter a ordem dá o mesmo polígono", () => {
  const base = lerLinhas(THEREZA, op);
  const idx = base.anel.map((p) => base.pontos.find((q) => q.linha === p.linha).idx);
  const l = executarReceita(THEREZA, base.receita, { ...op, ligacao: [[...idx].reverse()] });
  assert.equal(l.anel.length, base.anel.length);
  assert.deepEqual(l.anel.map((p) => p.num), [...base.anel.map((p) => p.num)].reverse());
  assert.ok(l.ok);
});
