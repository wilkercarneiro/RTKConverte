// Altitude pela coordenada: arquivo sem altitude não trava mais a leitura — a
// prévia estima a altitude de cada ponto no modelo de terreno e manda como
// `alturaPadrao` (idx → m). O leitor só preenche quem veio sem, marca o ponto e
// pede um "conferi"; a altitude medida nunca é sobrescrita.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4 from "proj4";
import { executarReceita, lerLinhas } from "../supabase/functions/_shared/leitor/index.ts";

const op = { proj4 };
// E;N;σ horizontal;σ vertical — sem coluna de altitude
const semH = (nome, e, n) => `${nome};${e};${n}`;
const LINHAS = [semH(1, 500000, 8700000), semH(2, 500100, 8700000), semH(3, 500100, 8700100), semH(4, 500000, 8700100)];

test("sem altitude e sem preenchimento: continua bloqueado (sem_altura)", () => {
  const l = lerLinhas(LINHAS, op);
  assert.ok(l);
  assert.ok(l.avisos.some((a) => a.codigo === "sem_altura" && a.nivel === "bloqueio"));
  assert.equal(l.ok, false);
});

test("altitude pela coordenada tira o bloqueio e pede conferência", () => {
  const base = lerLinhas(LINHAS, op);
  const alturaPadrao = Object.fromEntries(base.pontos.map((p) => [p.idx, 812.4 + p.idx]));
  const l = executarReceita(LINHAS, base.receita, { ...op, alturaPadrao, sigmaPadrao: { pos: 0.05, h: 0.08 } });
  assert.ok(!l.avisos.some((a) => a.codigo === "sem_altura"));
  assert.ok(l.aConfirmar.includes("altura_estimada"));
  assert.ok(l.ok);
  assert.deepEqual(l.anel.map((p) => p.h), l.anel.map((p) => 812.4 + p.idx));
  assert.ok(l.anel.every((p) => p.alturaEstimada));
  assert.ok(l.pontos.every((p) => p.hEstimada));
});

test("altitude medida nunca é sobrescrita; só os pontos sem altitude recebem", () => {
  const linhas = [
    "1;500000;8700000;300,5", "2;500100;8700000;301,0", "3;500100;8700100", "4;500000;8700100",
  ];
  const base = lerLinhas(linhas, op);
  const alturaPadrao = Object.fromEntries(base.pontos.map((p) => [p.idx, 999]));
  const l = executarReceita(linhas, base.receita, { ...op, alturaPadrao, sigmaPadrao: { pos: 0.05, h: 0.08 } });
  const porNum = new Map(l.anel.map((p) => [p.num, p]));
  assert.equal(porNum.get(1).h, 300.5);
  assert.equal(porNum.get(1).alturaEstimada, false);
  assert.equal(porNum.get(3).h, 999);
  assert.equal(porNum.get(3).alturaEstimada, true);
  const aviso = l.avisos.find((a) => a.codigo === "altura_estimada");
  assert.ok(aviso && aviso.mensagem.startsWith("2 ponto(s)"));
});

test("altitude fora da faixa do Brasil é ignorada (o bloqueio volta)", () => {
  const base = lerLinhas(LINHAS, op);
  const alturaPadrao = Object.fromEntries(base.pontos.map((p) => [p.idx, 9000]));
  const l = executarReceita(LINHAS, base.receita, { ...op, alturaPadrao });
  assert.ok(l.avisos.some((a) => a.codigo === "sem_altura"));
});

test("sem alturaPadrao a leitura é exatamente a de antes", () => {
  const base = lerLinhas(LINHAS, op);
  const l = executarReceita(LINHAS, base.receita, { ...op, alturaPadrao: null });
  assert.deepEqual(l.avisos.map((a) => a.codigo), base.avisos.map((a) => a.codigo));
  assert.ok(!l.aConfirmar.includes("altura_estimada"));
});
