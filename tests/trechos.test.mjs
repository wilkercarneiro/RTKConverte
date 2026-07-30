// Onde a linha dupla vermelha aparece: a regra compartilhada pelo preview (MapaSVG)
// e pela planta. Ancorado no caso FAZENDA LAGOA SECA, que gerou o defeito original.
import { test } from "node:test";
import assert from "node:assert/strict";
import { trechoDoVertice, segmentosDeVia, moverConfrontacao } from "../src/lib/trechos.ts";
import { sugerirTrechos } from "../supabase/functions/_shared/servico.ts";

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

test("importação sugere faixa de domínio pelo rótulo do TXT", () => {
  const pontos = [
    { num: 1, rotulo: "marlene/estrada" },   // apelido = "estrada"
    { num: 2, rotulo: "estrasa/viz" },       // apelido = "viz" (erro de digitação, não é via)
    { num: 3, rotulo: "viz./Adelândio" },
    { num: 4, rotulo: "corredor" },
    { num: 5, rotulo: "fundo/BA 408" },
    { num: 6, rotulo: null },
  ];
  const sug = sugerirTrechos(pontos);
  assert.deepEqual(sug.map((s) => [s.apelido, s.ehVia]), [
    ["estrada", true], ["viz", false], ["Adelândio", false], ["corredor", true], ["BA 408", true],
  ]);
});

test("LAGOA não é sugerida como via: é nome comum de fazenda na região", () => {
  const sug = sugerirTrechos([{ num: 1, rotulo: "fundo/lagoa seca" }]);
  assert.equal(sug[0].ehVia, false);
});

test("sem trecho algum, nada vira estrada", () => {
  assert.deepEqual(segmentosDeVia(vertices, []), []);
  assert.equal(trechoDoVertice([], 5), null);
});

// ---- mover a confrontação de ponto (o M veio errado do TXT) ----

// mesmo anel, agora com as colunas de confrontação que moram no vértice
const anel = () => CODIGOS.map((codigo, ordem) => ({
  ordem, codigo,
  tipo: codigo.startsWith("M-") ? "M" : codigo.startsWith("V-") ? "V" : "P",
  inserido_manual: codigo.startsWith("V-"),
  descritivo: ordem === 2 ? "ESTRADA VICINAL" : null,
  tipo_limite: ordem === 2 ? "LA3" : null,
  eh_via: ordem === 2,
  cns: ordem === 2 ? "00.770-8" : null,
  matricula: ordem === 2 ? "432" : null,
  apelido_txt: ordem === 2 ? "Estrada" : null,
}));

test("mover leva a confrontação inteira para o novo ponto", () => {
  // a estrada foi lançada no M-3704 (ordem 2) e começa mesmo no P-13808 (ordem 5)
  const vs = moverConfrontacao(anel(), 2, 5);
  const origem = vs[2], destino = vs[5];
  assert.equal(destino.tipo, "M");
  assert.deepEqual(
    [destino.descritivo, destino.apelido_txt, destino.tipo_limite, destino.eh_via, destino.cns, destino.matricula],
    ["ESTRADA VICINAL", "Estrada", "LA3", true, "00.770-8", "432"],
  );
  // origem devolvida a P e sem resto de confrontação
  assert.equal(origem.tipo, "P");
  assert.deepEqual(
    [origem.descritivo, origem.apelido_txt, origem.tipo_limite, origem.eh_via, origem.cns, origem.matricula],
    [null, null, null, false, null, null],
  );
  // o desenho acompanha: a estrada agora vai do novo M até o M-3705
  const trechosMovidos = vs.filter((v) => v.tipo === "M").map((v) => ({ vertice_inicio_ordem: v.ordem, eh_via: v.eh_via }));
  assert.deepEqual(segmentosDeVia(vs, trechosMovidos), [5, 6, 7, 8]);
});

test("vértice inserido à mão volta a V, não a P, quando a confrontação sai dele", () => {
  const comConfNoV = moverConfrontacao(anel(), 2, 3); // V-0781
  assert.equal(comConfNoV[3].tipo, "M");
  const devolvido = moverConfrontacao(comConfNoV, 3, 2);
  assert.equal(devolvido[3].tipo, "V", "V-0781 foi inserido à mão e continua V");
  assert.equal(devolvido[2].descritivo, "ESTRADA VICINAL");
});

test("movimento inválido devolve a lista intacta", () => {
  const vs = anel();
  assert.equal(moverConfrontacao(vs, 2, 2), vs, "mesmo ponto");
  assert.equal(moverConfrontacao(vs, 2, 9), vs, "destino já é M — sobrescreveria o vizinho");
  assert.equal(moverConfrontacao(vs, 5, 6), vs, "origem não é M");
  assert.equal(moverConfrontacao(vs, 2, 99), vs, "destino inexistente");
});
