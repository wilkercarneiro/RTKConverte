// Etiqueta "(MATR.x\CNS.y)" digitada com contrabarra no lugar da barra
// (FAZENDA SANTA BARBARA, 2026-09-11): a contrabarra é o separador do
// descritivo, e partir a etiqueta ao meio fazia as peças lerem "(MATR.325" e
// "CNS.00.701-3) FAZENDA ENGENHO NOVO" como duas pessoas — o confrontante de
// verdade ficava sem imóvel e saía carta de anuência para "(MATR.325".
import { test } from "node:test";
import assert from "node:assert/strict";
import { partesDescritivo } from "../supabase/functions/_shared/texto.ts";
import { parseDescritivo } from "../supabase/functions/_shared/pecas.ts";

const SANTA_BARBARA = "(MATR.325\\CNS.00.701-3) FAZENDA ENGENHO NOVO\\ GERALDO MOREIRA DE OLIVEIRA\\ CPF: 058.180.875-49";

test("partesDescritivo: contrabarra dentro da etiqueta não separa e vira barra", () => {
  assert.deepEqual(partesDescritivo(SANTA_BARBARA), [
    "(MATR.325/CNS.00.701-3) FAZENDA ENGENHO NOVO",
    "GERALDO MOREIRA DE OLIVEIRA",
    "CPF: 058.180.875-49",
  ]);
});

test("partesDescritivo: quebra de linha dentro da etiqueta também não separa", () => {
  assert.deepEqual(partesDescritivo("(MATR.325\nCNS.00.701-3)\nFAZENDA X\nFULANO\nCPF: 1"), [
    "(MATR.325/CNS.00.701-3)", "FAZENDA X", "FULANO", "CPF: 1",
  ]);
});

test("partesDescritivo: a forma canônica continua igual", () => {
  assert.deepEqual(partesDescritivo("(MATR.473/CNS.13.662-2) FAZENDA RIACHO DA CRUZ\\ RUBEM LOPES DA SILVA\\ CPF:778.854.145-15"), [
    "(MATR.473/CNS.13.662-2) FAZENDA RIACHO DA CRUZ", "RUBEM LOPES DA SILVA", "CPF:778.854.145-15",
  ]);
  // parêntese no meio do nome (não é etiqueta) não muda a regra
  assert.deepEqual(partesDescritivo("ASSENTAMENTO NOVA VIDA (PA MARI)\\ CNPJ: 03.299.373/0001-01"), [
    "ASSENTAMENTO NOVA VIDA (PA MARI)", "CNPJ: 03.299.373/0001-01",
  ]);
});

test("parseDescritivo: SANTA BARBARA vira um confrontante com imóvel e CPF", () => {
  const r = parseDescritivo(SANTA_BARBARA);
  assert.equal(r.imovelLabel, "FAZENDA ENGENHO NOVO (MATR.325/CNS.00.701-3)");
  assert.equal(r.posse, false);
  assert.deepEqual(r.pessoas, [{ nome: "GERALDO MOREIRA DE OLIVEIRA", cpf: "058.180.875-49" }]);
});
