// Prévia do SIGEF com VÁRIOS memoriais (serviço de glebas).
//
// Antes disso, os três memoriais de PREVIA TOTAL.pdf eram lidos como uma tabela
// só: o encadeamento vante→código quebrava na virada da gleba 1 para a gleba 2
// e a geração falhava inteira ("o vértice DSBN-P-16697 aponta para
// DSBN-P-16674, mas a linha seguinte lida é DSBN-M-4822").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefBlocos, parseSigefTexto, totaisDosBlocos } from "../supabase/functions/_shared/sigef_pdf.ts";
import {
  anelDoBloco, areaTotalHa, avisosDoCasamento, casarBlocosComGlebas, nomeDaDenominacao,
} from "../supabase/functions/_shared/sigef_glebas.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const PDF = new URL("../PREVIA TOTAL.pdf", import.meta.url);

const { text } = await extractText(
  await getDocumentProxy(new Uint8Array(readFileSync(PDF))),
  { mergePages: true },
);
const blocos = parseSigefBlocos(text);

test("cada memorial do PDF vira um bloco com anel próprio e fechado", () => {
  assert.equal(blocos.length, 3);
  assert.deepEqual(blocos.map((b) => b.linhas.length), [29, 94, 53]);
  for (const b of blocos) {
    // o anel de cada gleba fecha em si mesmo — é o que o parser exige por bloco
    assert.equal(b.linhas[b.linhas.length - 1].vante, b.linhas[0].codigo);
    assert.match(b.cabecalho.denominacao, /FAZENDA LAMEIRO DA BOA VISTA - GLEBA \d/);
  }
});

test("área e perímetro saem POR GLEBA, como o SIGEF os certificou", () => {
  assert.deepEqual(blocos.map((b) => b.cabecalho.areaHa), ["550,5523", "783,3724", "46,0445"]);
  assert.deepEqual(blocos.map((b) => b.cabecalho.perimetroM), ["11.753,39", "12.788,32", "3.419,37"]);
});

test("a área total é a SOMA das glebas; o perímetro NÃO é somado", () => {
  assert.equal(areaTotalHa(blocos).toFixed(4), "1379.9692");
  const totais = totaisDosBlocos(blocos);
  assert.equal(totais.areaHa.toFixed(4), "1379.9692");
  // um perímetro por gleba, nunca um número só: a soma não é o contorno de nada
  assert.deepEqual(totais.perimetrosM, [11753.39, 12788.32, 3419.37]);
});

test("parseSigefTexto continua devolvendo UM memorial (imóvel de anel único)", () => {
  const um = parseSigefTexto(text);
  assert.equal(um.linhas.length, 29);
  assert.equal(um.cabecalho.areaHa, "550,5523");
});

test("o casamento é pela GEOMETRIA: nome trocado e ordem invertida não enganam", () => {
  const fuso = 24;
  // glebas "do sistema": os anéis do PDF, renomeados ao contrário e na ordem
  // inversa — se o casamento olhasse nome ou ordem, erraria as três
  const glebaRows = blocos
    .map((b, i) => ({ nome: `GLEBA ${blocos.length - i}`, ordem: i, anel: anelDoBloco(b.linhas, fuso, proj4) }))
    .reverse();

  const casados = casarBlocosComGlebas(blocos, glebaRows, "FAZENDA LAMEIRO DA BOA VISTA", fuso, proj4);
  assert.equal(casados.length, 3);
  for (const c of casados) {
    assert.equal(c.cobertura, 1, `bloco ${c.indiceBloco} deveria casar 100% do anel`);
    // a gleba casada é a que carrega o anel deste bloco: a lista foi invertida,
    // então o bloco 0 é a última posição (numeroGleba 3)
    assert.equal(c.numeroGleba, 3 - c.indiceBloco);
  }
  assert.deepEqual(avisosDoCasamento(casados, glebaRows), []);
});

test("memorial sem gleba desenhada vira aviso, não erro", () => {
  const fuso = 24;
  // só a primeira gleba foi desenhada na tela
  const glebaRows = [{ nome: "GLEBA 1", ordem: 0, anel: anelDoBloco(blocos[0].linhas, fuso, proj4) }];
  const casados = casarBlocosComGlebas(blocos, glebaRows, "FAZENDA LAMEIRO DA BOA VISTA", fuso, proj4);

  assert.equal(casados[0].numeroGleba, 1);
  assert.equal(casados[1].gleba, null);
  assert.equal(casados[2].gleba, null);
  // sem gleba, o nome do quadro sai da própria denominação do SIGEF
  assert.equal(casados[1].nome, "GLEBA 2");
  assert.equal(casados[2].nome, "GLEBA 3");

  const avisos = avisosDoCasamento(casados, glebaRows);
  assert.equal(avisos.length, 2);
  assert.match(avisos[0], /não casou com nenhuma gleba desenhada/);
});

test("nomeDaDenominacao recorta o nome da gleba da denominação do SIGEF", () => {
  assert.equal(nomeDaDenominacao("FAZENDA X - GLEBA 2", "FAZENDA X"), "GLEBA 2");
  // denominação do serviço em caixa diferente continua casando
  assert.equal(nomeDaDenominacao("Fazenda X - Gleba 2", "FAZENDA X"), "GLEBA 2");
  // sem a denominação do serviço, ainda reconhece o sufixo
  assert.equal(nomeDaDenominacao("SÍTIO Y - PARTE 3", ""), "PARTE 3");
});
