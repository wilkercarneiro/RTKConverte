// FAZENDA SALGADA VELHA (serviço ccd9927b): as plantas saíram sem a linha dupla
// vermelha da estrada, antes e depois do SIGEF.
//
// A faixa de domínio deste serviço NÃO está marcada pelo checkbox: os três
// vértices M têm `eh_via = false` no banco. O que diz que LINHA FERREA e ESTRADA
// VICINAL são via é `tipo_limite = 'LA3'` — e a tela grava assim de propósito,
// porque com LA3 o checkbox aparece marcado e DESABILITADO (Conferencia.tsx).
//
// Ou seja: quem esquece o fallback LA3 desenha a planta sem estrada nenhuma. O
// fluxo 'geo' (montarServico) já tinha o fallback; a reconciliação com o PDF do
// SIGEF, não — então a planta oficial saía sem estrada mesmo com o código novo.
// Estes testes prendem o fallback nos DOIS caminhos.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { montarTrechosDoSigef } from "../supabase/functions/_shared/reconciliacao.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);

// anel real do serviço, resumido: [ordem, E, N, tipo, código]
const ANEL = [
  [0, 481091.175, 8733180.153, "P", "DSBN-P-14330"],
  [1, 481057.974, 8733205.539, "P", "DSBN-P-14329"],
  [2, 481032.514, 8733194.699, "P", "DSBN-P-14357"],
  [3, 481024.033, 8733168.619, "P", "DSBN-P-14356"],
  [4, 481012.212, 8733149.520, "P", "DSBN-P-14355"],
  [5, 480996.392, 8733130.406, "P", "DSBN-P-14354"],
  [6, 480959.103, 8733088.535, "P", "DSBN-P-14353"],
  [7, 480932.097, 8733058.319, "P", "DSBN-P-14352"],
  [8, 480900.885, 8733023.073, "P", "DSBN-P-14351"],
  [9, 480869.413, 8732987.008, "P", "DSBN-P-14350"],
  [10, 480826.695, 8732981.336, "P", "DSBN-P-14349"],
  [11, 480791.755, 8732974.946, "P", "DSBN-P-14348"],
  [12, 480761.425, 8732968.667, "P", "DSBN-P-14347"],
  [13, 480746.203, 8732964.608, "P", "DSBN-P-14346"],
  [14, 480733.665, 8732963.354, "P", "DSBN-P-14345"],
  [15, 480719.713, 8732963.951, "P", "DSBN-P-14344"],
  [16, 480705.385, 8732965.368, "P", "DSBN-P-14343"],
  [17, 480683.143, 8732969.111, "P", "DSBN-P-14342"],
  [18, 480676.777, 8732969.034, "M", "DSBN-M-4547"],
  [19, 480674.374, 8732962.201, "P", "DSBN-P-14341"],
  [20, 480716.233, 8732918.374, "P", "DSBN-P-14340"],
  [21, 480738.100, 8732899.930, "P", "DSBN-P-14339"],
  [22, 480761.508, 8732886.778, "P", "DSBN-P-14338"],
  [23, 480797.484, 8732873.856, "P", "DSBN-P-14337"],
  [24, 480840.924, 8732859.259, "P", "DSBN-P-14336"],
  [25, 480867.594, 8732855.076, "P", "DSBN-P-14335"],
  [26, 480908.941, 8732855.954, "P", "DSBN-P-14334"],
  [27, 480950.059, 8732859.578, "P", "DSBN-P-14333"],
  [28, 480991.231, 8732860.376, "P", "DSBN-P-14332"],
  [29, 480994.851, 8732859.785, "M", "DSBN-M-4546"],
  [30, 481151.042, 8733154.669, "M", "DSBN-M-4545"],
  [31, 481129.373, 8733164.012, "P", "DSBN-P-14331"],
];

// confrontação como está gravada: LA3 sem eh_via
const CONF = {
  "DSBN-M-4547": { descritivo: "LINHA FERREA", tipo_limite: "LA3", eh_via: false },
  "DSBN-M-4546": { descritivo: "(POSSE) FAZENDA SALGADA VELHA\\ MARIA ELZA CORDEIRO FERREIRA SOUZA", tipo_limite: "LA1", eh_via: false },
  "DSBN-M-4545": { descritivo: "ESTRADA VICINAL", tipo_limite: "LA3", eh_via: false },
};

const verticesServico = ANEL.map(([ordem, e, n, tipo, codigo]) => ({
  ordem, numTxt: ordem + 1, e, n, h: 360, sigmaPos: 0.01, sigmaH: 0.01,
  tipo, metodo: "PG6", codigoManual: codigo, inserido: false,
  descritivo: CONF[codigo]?.descritivo ?? "",
  tipoLimite: CONF[codigo]?.tipo_limite ?? null,
  ehVia: CONF[codigo]?.eh_via ?? false,
}));

test("fluxo 'geo': LA3 sem checkbox continua sendo faixa de domínio", () => {
  const calc = montarServico(
    { fusoUtm: 24, prefixo: "DSBN", contadores: { M: 0, P: 0, V: 0 }, vertices: verticesServico },
    proj4,
  );
  const vias = calc.trechosOrdenados.filter((t) => t.ehVia);
  assert.equal(vias.length, 2, "LINHA FERREA e ESTRADA VICINAL são LA3, logo são via");
  assert.ok(
    calc.trechosOrdenados.every((t) => t.ehVia === (t.tipoLimite === "LA3")),
    "só os trechos LA3 são via — o LA1 (POSSE) não pode virar estrada",
  );
});

test("planta do sistema desenha a linha vermelha nos trechos LA3", () => {
  const calc = montarServico(
    { fusoUtm: 24, prefixo: "DSBN", contadores: { M: 0, P: 0, V: 0 }, vertices: verticesServico },
    proj4,
  );
  const g = geometriaDoCalculo(calc);
  assert.equal(g.trechos.filter((t) => t.isEstrada).length, 2);

  // mesma varredura de planta.ts: cada aresta herda o trecho do seu vértice inicial
  const trechoDoIdx = (i) => g.trechos.find((t) =>
    t.fimIdx > t.inicioIdx ? i >= t.inicioIdx && i < t.fimIdx : i >= t.inicioIdx || i < t.fimIdx
  ) ?? g.trechos[g.trechos.length - 1];
  const arestasVermelhas = g.vertices.filter((_, i) => trechoDoIdx(i).isEstrada).length;
  assert.ok(arestasVermelhas > 0, "a planta tem de sair com pelo menos uma aresta em vermelho");
});

test("planta do SIGEF: reconciliação preserva a via marcada por LA3", () => {
  // vértices como saem de reconciliarVerticesBancoComSigef: eh_via veio false do
  // banco, tipo_limite atravessou. Sem o fallback LA3 aqui, a planta oficial
  // saía sem estrada mesmo com o fluxo 'geo' já corrigido.
  const reconciliados = ANEL.map(([ordem, , , tipo, codigo]) => ({
    ordem, codigo, tipo,
    descritivo: CONF[codigo]?.descritivo ?? null,
    apelido_txt: null,
    tipo_limite: CONF[codigo]?.tipo_limite ?? null,
    eh_via: CONF[codigo]?.eh_via ?? false,
  }));
  const sigefLinhas = ANEL.map(([, , , , codigo]) => ({ codigo, confrontacao: "" }));

  const starts = montarTrechosDoSigef([], reconciliados, sigefLinhas);
  assert.equal(starts.length, 3, "um início por vértice M");
  assert.deepEqual(
    starts.filter((s) => s.ehVia).map((s) => s.descritivo),
    ["LINHA FERREA", "ESTRADA VICINAL"],
  );
});

test("fluxo 'pecas': trecho LA3 da tabela trechos_confrontantes também é via", () => {
  const trechoRows = [
    { codigo_inicio: "DSBN-M-4547", vertice_inicio_ordem: 18, descritivo: "LINHA FERREA", tipo_limite: "LA3", eh_via: false },
    { codigo_inicio: "DSBN-M-4546", vertice_inicio_ordem: 29, descritivo: "MARIA ELZA", tipo_limite: "LA1", eh_via: false },
  ];
  const sigefLinhas = ANEL.map(([, , , , codigo]) => ({ codigo, confrontacao: "" }));
  const starts = montarTrechosDoSigef(trechoRows, [], sigefLinhas);
  assert.deepEqual(starts.map((s) => s.ehVia), [true, false]);
});
