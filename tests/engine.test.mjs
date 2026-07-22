// Testes de aceitação do motor geodésico (seção 3.2 da especificação).
// Fixture: reference/LARISSA.txt — fuso esperado 24S (EPSG:31984).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import {
  parseTxt, detectZoneCandidates, escolherZona, calcularVertices, calcularSegmentos,
  calcularAreaHa, calcularPerimetroM, fmtGmsPlanilha, fmtGmsMemorial,
  fmtBR, fmtAzimute, codigoVertice, degToGmsCanonical, gmsToDeg, parseGmsPlanilha,
} from "../supabase/functions/_shared/geo.ts";

const proj4 = (from, to, coords) => proj4lib(from, to, coords);

const txt = readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8");
const pontos = parseTxt(txt);

test("parse do TXT: 69 pontos, rótulos detectados", () => {
  assert.equal(pontos.length, 69);
  assert.equal(pontos[0].num, 1);
  assert.equal(pontos[0].e, 491199.572);
  assert.equal(pontos[0].n, 8738840.077);
  const comRotulo = pontos.filter((p) => p.rotulo).map((p) => [p.num, p.rotulo]);
  assert.deepEqual(comRotulo, [
    [9, "Estrada/Justiliano"],
    [30, "Justiliano/Varguim Serra"],
    [36, "Varguim Serra/Roger"],
    [58, "Roger/Valdete"],
    [64, "Valdete/estrada"],
  ]);
});

test("detecção de fuso: 24S / EPSG:31984", () => {
  const cands = detectZoneCandidates(pontos, proj4);
  assert.ok(cands.length >= 1, "nenhum fuso candidato");
  // E ≈ 491.000 (perto do MC) é ambíguo entre fusos — com UF da Bahia resolve p/ 24
  const comUf = escolherZona(cands, "BA");
  assert.equal(comUf.escolhido.zone, 24);
  assert.equal(comUf.escolhido.epsg, 31984);
  assert.equal(comUf.foraDaUf, false);
  // sem UF, a heurística de prioridade também sugere 24
  const semUf = escolherZona(cands, null);
  assert.equal(semUf.escolhido.zone, 24);
});

const vertices = calcularVertices(
  pontos.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })),
  24, proj4,
);

test("conversão canônica do ponto 30 (lat exata; lon ±0,001\")", () => {
  const v30 = vertices.find((v) => v.numTxt === 30);
  assert.equal(fmtGmsPlanilha(v30.latGms, "lat"), "11 23 44,344 S");
  const lon = fmtGmsPlanilha(v30.lonGms, "lon");
  assert.ok(lon === "39 5 04,736 W" || lon === "39 5 04,737 W", `lon obtida: ${lon}`);
  assert.equal(fmtGmsMemorial(v30.latGms, "lat"), `-11°23'44,344" S`);
});

const segs = calcularSegmentos(vertices); // ring na ordem do TXT (1..69, fecha 69→1)
const segDe = (numTxt) => {
  const v = vertices.find((x) => x.numTxt === numTxt);
  return segs.find((s) => s.deOrdem === v.ordem);
};

test("segmentos de aceitação: azimutes e distâncias exatos", () => {
  assert.equal(segDe(32).azimuteFmt, `129°46'54"`);
  assert.equal(segDe(32).distFmt, "33,01");
  assert.equal(segDe(33).azimuteFmt, `130°03'37"`);
  assert.equal(segDe(33).distFmt, "43,37");
  assert.equal(segDe(34).azimuteFmt, `130°14'30"`);
  assert.equal(segDe(34).distFmt, "24,62");
});

test("área e perímetro do polígono do TXT puro", () => {
  const areaHa = calcularAreaHa(vertices);
  const perimetro = calcularPerimetroM(segs);
  assert.ok(Math.abs(areaHa - 83.99) <= 0.011, `área: ${areaHa.toFixed(4)} ha`);
  assert.ok(Math.abs(perimetro - 4075.9) <= 0.5, `perímetro: ${perimetro.toFixed(2)} m`);
  console.log(`    área calculada: ${fmtBR(areaHa, 4)} ha | perímetro: ${fmtBR(perimetro, 2)} m`);
});

test("formatação pt-BR", () => {
  assert.equal(fmtBR(83.98861, 4), "83,9886");
  assert.equal(fmtBR(4075.94, 2), "4.075,94");
  assert.equal(fmtBR(33.005, 2), "33,01"); // half-up
  assert.equal(fmtAzimute(129.15788), `129°09'28"`);
  assert.equal(fmtAzimute(359.99999), `0°00'00"`); // carry 360→0
});

test("códigos de vértice", () => {
  assert.equal(codigoVertice("DSBN", "M", 3605), "DSBN-M-3605");
  assert.equal(codigoVertice("DSBN", "P", 13130), "DSBN-P-13130");
  assert.equal(codigoVertice("DSBN", "V", 758), "DSBN-V-0758");
});

test("THEREZA.txt: rótulos colados ao número e ponto 12 anexado ao fim", () => {
  const txtT = readFileSync(new URL("../reference/THEREZA.txt", import.meta.url), "utf8");
  const pts = parseTxt(txtT);
  assert.equal(pts.length, 64);
  // normalização: ordenado por ID (o 12 estava na última linha do arquivo)
  assert.deepEqual(pts.map((p) => p.num), Array.from({ length: 64 }, (_, i) => i + 1));
  const p12 = pts[11];
  assert.equal(p12.num, 12);
  assert.equal(p12.e, 466755.779);
  assert.equal(p12.n, 8651665.532);
  // rótulos sem espaço separador
  const rotulos = pts.filter((p) => p.rotulo).map((p) => [p.num, p.rotulo]);
  assert.deepEqual(rotulos, [
    [5, "ramon/faz,caguido"],
    [28, "faz,caguido/ze mota"],
    [35, "ze mota/tone"],
    [39, "tone/estrada"],
    [40, "estrada/tone"],
    [58, "tone/ramon"],
  ]);
  // pipeline completo roda sem erro e produz área plausível
  const vs = calcularVertices(
    pts.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })),
    24, proj4,
  );
  const area = calcularAreaHa(vs);
  const per = calcularPerimetroM(calcularSegmentos(vs));
  console.log(`    THEREZA: área ${fmtBR(area, 4)} ha | perímetro ${fmtBR(per, 2)} m`);
  assert.ok(area > 50 && area < 500, `área implausível: ${area}`);
});

test("parse: ponto duplicado é rejeitado", () => {
  assert.throws(
    () => parseTxt("1;491199,572;8738840,077;318,435;0,0026;0,004\n2;491159,978;8738824,912;319,376;0,0024;0,0043\n2;491124,084;8738816,159;319,783;0,0083;0,014"),
    /duplicado/,
  );
});

test("GMS: round-trip e carry no arredondamento", () => {
  const g = degToGmsCanonical(-11.999999999); // ≈ -12° → carry total
  assert.equal(g.d, 12);
  assert.equal(g.m, 0);
  assert.equal(g.sMil, 0);
  const p = parseGmsPlanilha("11 24 30,375 S");
  assert.equal(gmsToDeg(p), -(11 + 24 / 60 + 30.375 / 3600));
});
