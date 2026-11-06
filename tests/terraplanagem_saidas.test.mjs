// Terraplanagem: leitor de pontos tolerante, projeto gravado que volta igual,
// e as saídas (DXF em camadas, CSV da malha, PDF do relatório) a partir do
// levantamento de exemplo do laboratório (298 pontos num terreno com declive).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { lerPontos, lerNumero } from "../src/lib/terraplanagem/pontos.ts";
import { lerCoordenada } from "../src/lib/terraplanagem/entrada.ts";
import { calcularTerraplanagem } from "../src/lib/terraplanagem/calculo.ts";
import { normalizarProjeto, paraGravar, projetoNovo } from "../src/lib/terraplanagem/modelo.ts";
import { malhaParaCsv, terraplanagemParaDxf, CAMADAS_TERRAPLANAGEM } from "../src/lib/terraplanagem/saidas.ts";
import { gerarPdfTerraplanagem } from "../src/lib/terraplanagem/pdf.ts";

const fixture = fs.readFileSync(new URL("./fixtures/terraplanagem/levantamento-declive.txt", import.meta.url), "utf8");

test("leitor: o levantamento de exemplo (cabeçalho, vírgula como separador, descrição)", () => {
  const l = lerPontos(fixture);
  assert.equal(l.pontos.length, 298);
  assert.equal(l.colunas, "nome · E · N · cota · descrição");
  assert.deepEqual(l.avisos, []);
  const p = l.pontos[0];
  assert.equal(p.nome, "1");
  assert.ok(p.e > 487000 && p.n > 8634000 && p.z > 300 && p.z < 320);
  assert.equal(p.descricao, "TN");
});

test("leitor: sem cabeçalho, ordem N E Z, ponto e vírgula e vírgula decimal", () => {
  const t = ["M1;8634150,123;487320,456;312,811", "M2;8634160,000;487330,000;312,100", "M3;8634170,500;487310,250;311,050", "M4;8634180;487340;310,7"].join("\r\n");
  const l = lerPontos(t);
  assert.equal(l.pontos.length, 4);
  assert.deepEqual([l.pontos[0].nome, l.pontos[0].e, l.pontos[0].n, l.pontos[0].z], ["M1", 487320.456, 8634150.123, 312.811]);
  assert.equal(l.pontos[3].z, 310.7);
});

test("leitor: espaços, linhas de comentário e linha estragada viram aviso com o número da linha", () => {
  const t = ["# levantamento planialtimétrico", "1 487320.10 8634150.20 312.81", "2 487330.10 8634150.20 312.11", "lixo aqui", "3 487330.10 8634160.20 311.50", "4 487320.10 8634160.20 xx"].join("\n");
  const l = lerPontos(t);
  assert.equal(l.pontos.length, 3);
  assert.ok(l.ignoradas.some((x) => x.linha === 6), JSON.stringify(l.ignoradas));
  assert.ok(l.avisos.some((a) => /não entraram/.test(a)));
});

test("leitor: latitude/longitude em grau viram UTM no fuso certo", () => {
  const t = ["ponto,lat,lon,cota", "A,-12.9700,-38.5000,50.1", "B,-12.9701,-38.4990,51.2", "C,-12.9710,-38.4995,49.7"].join("\n");
  const l = lerPontos(t);
  assert.equal(l.fuso, 24);
  assert.equal(l.pontos.length, 3);
  assert.ok(l.pontos[0].e > 500000 && l.pontos[0].e < 600000 && l.pontos[0].n > 8500000);
});

test("leitor: arquivo sem cota diz o que falta", () => {
  const l = lerPontos("nome;E;N\n1;487320;8634150\n2;487330;8634150\n3;487330;8634160\n");
  assert.equal(l.pontos.length, 0);
  assert.match(l.avisos[0], /cota/);
});

test("números em português e em inglês", () => {
  assert.equal(lerNumero("1.234,56", true), 1234.56);
  assert.equal(lerNumero("1234.56", false), 1234.56);
  assert.equal(lerNumero("1,234.5", false), 1234.5);
  assert.ok(Number.isNaN(lerNumero("abc", false)));
});

test("coordenada digitada e link do Google Maps", () => {
  assert.deepEqual(lerCoordenada("-12,9714, -38,5014"), [-38.5014, -12.9714]);
  assert.deepEqual(lerCoordenada("https://www.google.com/maps/@-12.9714,-38.5014,17z"), [-38.5014, -12.9714]);
  assert.deepEqual(lerCoordenada("-38.5014 -12.9714"), [-38.5014, -12.9714]);
  assert.equal(lerCoordenada("rua das flores"), null);
});

test("projeto gravado (compacto) volta igual e o lixo não derruba", () => {
  const l = lerPontos(fixture);
  const p = projetoNovo("Galpão", l.pontos, { tipo: "arquivo", arquivo: "x.txt" }, 24);
  const volta = normalizarProjeto(JSON.parse(JSON.stringify(paraGravar(p))));
  assert.equal(volta.pontos.length, 298);
  assert.equal(volta.nome, "Galpão");
  assert.equal(volta.fuso, 24);
  assert.equal(normalizarProjeto(null), null);
  const torto = normalizarProjeto({ pontos: "x", cota: { modo: "fixa", valor: "abc" }, taludes: { corte: -3 } });
  assert.equal(torto.cota.modo, "equilibrio");
  assert.equal(torto.taludes.corte, 0);
});

const projetoExemplo = () => {
  const l = lerPontos(fixture);
  return projetoNovo("Galpão Boa Vista", l.pontos, { tipo: "arquivo", arquivo: "levantamento-declive.txt" }, 24);
};

test("exemplo do laboratório: plataforma no contorno, equilíbrio, sem aviso", () => {
  const r = calcularTerraplanagem(projetoExemplo());
  assert.ok(Math.abs(r.corte - r.aterro) / r.corte < 1e-3);
  assert.deepEqual(r.avisos, []);
  assert.ok(r.crista.length && r.pe.length && r.passagem.length);
  assert.equal(r.secoes.length, 2);
});

test("DXF: R12 com as camadas da obra e o texto sem acento", () => {
  const pr = projetoExemplo();
  const r = calcularTerraplanagem(pr);
  const dxf = terraplanagemParaDxf(r, pr);
  assert.match(dxf, /AC1009/);
  for (const [c] of CAMADAS_TERRAPLANAGEM) assert.ok(dxf.includes(`\r\n${c}\r\n`), `camada ${c} sem nada`);
  assert.ok(dxf.trimEnd().endsWith("EOF"));
  assert.ok(!/[^\x00-\x7F]/.test(dxf), "DXF R12 com caractere fora do ASCII");
  // a plataforma é uma polilinha 3D fechada (70 = 9)
  assert.match(dxf, /POLYLINE\r\n\s*8\r\nPLATAFORMA\r\n\s*66\r\n1\r\n\s*70\r\n9/);
});

test("CSV da malha: separador ; e vírgula decimal, só nós com terreno", () => {
  const pr = projetoExemplo();
  const r = calcularTerraplanagem(pr);
  const csv = malhaParaCsv(r);
  const linhas = csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(linhas[0], "E;N;Terreno (m);Projeto (m);Corte (m);Aterro (m)");
  const validos = Array.from(r.malha.terreno).filter((v) => v === v).length;
  assert.equal(linhas.length - 1, validos);
  assert.match(linhas[1], /^\d+,\d{3};\d+,\d{3};\d+,\d{3};\d+,\d{3};\d+,\d{3};\d+,\d{3}$/);
});

test("PDF: abre, tem páginas e o título", async () => {
  const pr = projetoExemplo();
  const r = calcularTerraplanagem(pr);
  const bytes = await gerarPdfTerraplanagem(r, pr, null, { emitente: "Escritório Teste", quando: new Date("2026-11-06T10:00:00-03:00") });
  assert.ok(bytes.length > 5000);
  assert.match(Buffer.from(bytes.subarray(0, 8)).toString("latin1"), /^%PDF-/);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2, `páginas: ${doc.getPageCount()}`);
  assert.match(doc.getTitle() ?? "", /Galp/);
});
