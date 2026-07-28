// Onde a linha dupla vermelha aparece: a regra compartilhada pelo preview (MapaSVG)
// e pela planta. Ancorado no caso FAZENDA LAGOA SECA, que gerou o defeito original.
import { test } from "node:test";
import assert from "node:assert/strict";
import { trechoDoVertice, segmentosDeVia } from "../src/lib/trechos.ts";

// anel real do serviço 74238a85 — 21 vértices, M nas ordens 2, 9, 14, 17, 18, 20
const CODIGOS = [
  "P-13806", "P-13807", "M-3704", "V-0781", "V-0782", "P-13808", "P-13809",
  "P-13810", "P-13811", "M-3705", "P-13812", "P-13813", "P-13814", "P-13815",
  "M-3706", "P-13816", "P-13817", "M-3707", "M-3708", "P-13818", "M-3709",
];
const vertices = CODIGOS.map((codigo, ordem) => ({ ordem, codigo }));
const trechos = [
  { vertice_inicio_ordem: 2, eh_via: true, nome: "ESTRADA VICINAL" },
  { vertice_inicio_ordem: 9, eh_via: false, nome: "ADELSON" },
  { vertice_inicio_ordem: 14, eh_via: false, nome: "ADERLÂNDIO" },
  { vertice_inicio_ordem: 17, eh_via: false, nome: "EXPEDITO" },
  { vertice_inicio_ordem: 18, eh_via: false, nome: "MANOEL" },
  { vertice_inicio_ordem: 20, eh_via: false, nome: "MARILENE" },
];

test("estrada vai de M a M: começa no M-3704 e termina no M-3705", () => {
  const via = segmentosDeVia(vertices, trechos);
  // segmentos 2..8: M-3704 → V-0781 → V-0782 → P-13808 → P-13809 → P-13810 → P-13811 → M-3705
  assert.deepEqual(via, [2, 3, 4, 5, 6, 7, 8]);
  // o segmento 8 termina no M-3705, fechando a estrada onde ela realmente acaba
  assert.equal(CODIGOS[via[via.length - 1] + 1], "M-3705");
});

test("não marca estrada onde não há: P-13806 → P-13807 → M-3704 fica de fora", () => {
  const via = segmentosDeVia(vertices, trechos);
  assert.ok(!via.includes(0), "segmento P-13806→P-13807 não é estrada");
  assert.ok(!via.includes(1), "segmento P-13807→M-3704 não é estrada");
  // e a estrada também não invade o trecho do vizinho seguinte
  assert.ok(!via.includes(9), "segmento M-3705→P-13812 pertence ao ADELSON");
});

test("vértices antes do primeiro M pertencem ao último trecho (volta do anel)", () => {
  assert.equal(trechoDoVertice(trechos, 0).nome, "MARILENE");
  assert.equal(trechoDoVertice(trechos, 1).nome, "MARILENE");
  assert.equal(trechoDoVertice(trechos, 2).nome, "ESTRADA VICINAL");
});

test("via no último trecho do anel pinta até o fim e volta ao começo", () => {
  const comViaNoFim = trechos.map((t) => ({ ...t, eh_via: t.vertice_inicio_ordem === 20 }));
  const via = segmentosDeVia(vertices, comViaNoFim);
  // M-3709 (ordem 20) até o fim, mais a volta pelos vértices 0 e 1 até o M-3704
  assert.deepEqual(via, [0, 1, 20]);
});

test("sem trecho algum, nada vira estrada", () => {
  assert.deepEqual(segmentosDeVia(vertices, []), []);
  assert.equal(trechoDoVertice([], 5), null);
});
