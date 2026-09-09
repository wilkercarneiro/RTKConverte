// O PDF do SIGEF como FONTE DE NÚMEROS, não de desenho (regra do usuário,
// 2026-09-09): "as informações do sigef é única e exclusiva para pegar o
// perímetro e área total para a geração de documentos PDF das plantas. Não deve
// gerar as plantas baseado nele. A planta em si é gerada como era anterior".
//
// Estes testes existem para que ninguém volte a puxar geometria do PDF: o que
// `sigef_glebas` entrega para a planta são strings formatadas, e nada mais.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefBlocos } from "../supabase/functions/_shared/sigef_pdf.ts";
import {
  anelDoBloco, casarBlocosComAneis, numerosDoSigefPorAnel, numerosTotaisDoSigef,
} from "../supabase/functions/_shared/sigef_glebas.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const FUSO = 24;

const { text } = await extractText(
  await getDocumentProxy(new Uint8Array(readFileSync(new URL("../PREVIA TOTAL.pdf", import.meta.url)))),
  { mergePages: true },
);
const blocos = parseSigefBlocos(text);
// os anéis das "unidades" do sistema: aqui os do próprio PDF, embaralhados, para
// provar que o casamento é geométrico
const aneis = blocos.map((b) => anelDoBloco(b.linhas, FUSO, proj4));

test("cada anel recebe os números do SEU memorial, mesmo fora de ordem", () => {
  const invertidos = [...aneis].reverse();
  const nums = numerosDoSigefPorAnel(blocos, invertidos, FUSO, proj4);

  assert.deepEqual(nums.map((n) => n?.areaFmt), ["46,0445", "783,3724", "550,5523"]);
  assert.deepEqual(nums.map((n) => n?.perimetroFmt), ["3.419,37", "12.788,32", "11.753,39"]);
  // tarefas derivam da área do SIGEF, não de recalcular o anel
  // 550,5523 ha ÷ 0,4356 ha/tarefa
  assert.equal(nums[2].tarefasFmt, "1.263,89");
});

test("anel sem memorial correspondente volta null (a planta mantém o calculado)", () => {
  // um anel em outro canto do mundo não casa com memorial nenhum
  const longe = aneis[0].map(([e, n]) => [e + 50000, n + 50000]);
  const nums = numerosDoSigefPorAnel(blocos, [longe], FUSO, proj4);
  assert.equal(nums[0], null);
});

test("total: área SOMADA; perímetro só quando o PDF é de um anel só", () => {
  const varios = numerosTotaisDoSigef(blocos);
  assert.equal(varios.areaFmt, "1.379,9692");
  // com glebas o perímetro é individual — null diz à planta para manter o dela
  assert.equal(varios.perimetroFmt, null);

  const um = numerosTotaisDoSigef([blocos[0]]);
  assert.equal(um.areaFmt, "550,5523");
  assert.equal(um.perimetroFmt, "11.753,39");
});

test("o casamento devolve ÍNDICES, nunca vértices — o PDF não desenha nada", () => {
  const idx = casarBlocosComAneis(blocos, aneis, FUSO, proj4);
  assert.deepEqual(idx, [0, 1, 2]);

  // e o que vai para a planta são só strings: qualquer campo de geometria aqui
  // seria o começo de o desenho voltar a sair do PDF
  const nums = numerosDoSigefPorAnel(blocos, aneis, FUSO, proj4);
  for (const n of nums) {
    assert.deepEqual(Object.keys(n).sort(), ["areaFmt", "perimetroFmt", "tarefasFmt"]);
    for (const v of Object.values(n)) assert.equal(typeof v, "string");
  }
});
