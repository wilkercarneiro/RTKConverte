// A reconciliação com o PDF do SIGEF traz GEOMETRIA oficial, não confrontantes.
// Ela substitui a tabela de vértices inteira, então precisa carregar a confrontação
// junto — descartá-la apagava o trabalho do usuário a cada geração de planta.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarTrechosDoSigef, reconciliarVerticesBancoComSigef } from "../supabase/functions/_shared/reconciliacao.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);

// 3 vértices: um M com estrada marcada, um M com vizinho, um P comum
const vertBanco = [
  {
    servico_id: "s1", ordem: 0, num_txt: 1, rotulo_txt: "marlene/estrada",
    codigo: "DSBN-M-3704", e: 480500, n: 8717900, h: 300, sigma_pos: 0.05, sigma_h: 0.08,
    tipo: "M", metodo: "PG6", inserido_manual: false, lat_gms: null, lon_gms: null,
    descritivo: "", tipo_limite: "LA1", eh_via: true, cns: null, matricula: null, apelido_txt: "estrada",
  },
  {
    servico_id: "s1", ordem: 1, num_txt: 2, rotulo_txt: null,
    codigo: "DSBN-P-13806", e: 480600, n: 8717800, h: 301, sigma_pos: 0.05, sigma_h: 0.08,
    tipo: "P", metodo: "PG6", inserido_manual: false, lat_gms: null, lon_gms: null,
    descritivo: null, tipo_limite: null, eh_via: false, cns: null, matricula: null, apelido_txt: null,
  },
  {
    // confrontação num vértice cujo CÓDIGO diz P — o dado tem de vencer o código
    servico_id: "s1", ordem: 2, num_txt: 3, rotulo_txt: null,
    codigo: "DSBN-P-13807", e: 480700, n: 8717700, h: 302, sigma_pos: 0.05, sigma_h: 0.08,
    tipo: "M", metodo: "PG6", inserido_manual: false, lat_gms: null, lon_gms: null,
    descritivo: "ADELSON BONIFACIO DA MOTA\\ CPF:111.222.333-44",
    tipo_limite: "LA1", eh_via: false, cns: null, matricula: null, apelido_txt: "adelson",
  },
];

// o SIGEF devolve os mesmos códigos, com coordenadas em GMS
const sigefLinhas = [
  { codigo: "DSBN-M-3704", lat: "-11°23'44,344\"", lon: "-39°04'47,198\"", alt: "300,00", confrontacao: "" },
  { codigo: "DSBN-P-13806", lat: "-11°23'47,000\"", lon: "-39°04'44,000\"", alt: "301,00", confrontacao: "" },
  { codigo: "DSBN-P-13807", lat: "-11°23'50,000\"", lon: "-39°04'41,000\"", alt: "302,00", confrontacao: "" },
];

test("reconciliação preserva a confrontação dos vértices do banco", () => {
  const out = reconciliarVerticesBancoComSigef("s1", vertBanco, sigefLinhas, 24, proj4);
  assert.equal(out.length, 3);

  const m3704 = out.find((v) => v.codigo === "DSBN-M-3704");
  assert.equal(m3704.eh_via, true, "a estrada continua marcada depois da reconciliação");
  assert.equal(m3704.apelido_txt, "estrada");
  assert.equal(m3704.tipo, "M");

  const p13806 = out.find((v) => v.codigo === "DSBN-P-13806");
  assert.equal(p13806.eh_via, false);
  assert.equal(p13806.descritivo, null);
  assert.equal(p13806.tipo, "P");
});

test("vértice com confrontação continua M mesmo com código de P", () => {
  const out = reconciliarVerticesBancoComSigef("s1", vertBanco, sigefLinhas, 24, proj4);
  const v = out.find((x) => x.codigo === "DSBN-P-13807");
  assert.equal(v.tipo, "M", "o confrontante sumiria do desenho se virasse P");
  assert.match(v.descritivo, /ADELSON/);
});

// --- de onde a planta tira os trechos quando gerada com o PDF do SIGEF ---

test("serviço geo: a estrada marcada no vértice M chega à planta", () => {
  const reconciliados = reconciliarVerticesBancoComSigef("s1", vertBanco, sigefLinhas, 24, proj4);
  // trechos_confrontantes está VAZIA no fluxo geo — era aqui que a marcação sumia
  const trechos = montarTrechosDoSigef([], reconciliados, sigefLinhas);
  const estrada = trechos.find((t) => t.idx === 0);
  assert.equal(estrada.ehVia, true, "a estrada tem de sair com linha dupla vermelha");
  assert.equal(estrada.descritivo, "estrada");
  // o vizinho do M com código de P também vira trecho, sem virar via
  const vizinho = trechos.find((t) => t.idx === 2);
  assert.equal(vizinho.ehVia, false);
  assert.match(vizinho.descritivo, /ADELSON/);
  // o P comum não abre trecho
  assert.equal(trechos.some((t) => t.idx === 1), false);
});

test("fluxo pecas: trechos_confrontantes por codigo_inicio tem precedência", () => {
  const reconciliados = reconciliarVerticesBancoComSigef("s1", vertBanco, sigefLinhas, 24, proj4);
  const trechos = montarTrechosDoSigef(
    [{ codigo_inicio: "DSBN-P-13806", vertice_inicio_ordem: 0, descritivo: "CORREDOR", eh_via: true }],
    reconciliados, sigefLinhas,
  );
  assert.deepEqual(trechos, [{ idx: 1, descritivo: "CORREDOR", ehVia: true }]);
});

test("sem trecho e sem confrontação nos vértices, cai no texto do SIGEF sem marcar via", () => {
  const linhas = [
    { codigo: "X-P-1", confrontacao: "FAZENDA A" },
    { codigo: "X-P-2", confrontacao: "FAZENDA A" },
    { codigo: "X-P-3", confrontacao: "ESTRADA VICINAL" },
  ];
  const trechos = montarTrechosDoSigef([], [], linhas);
  assert.deepEqual(trechos.map((t) => [t.idx, t.descritivo, t.ehVia]), [
    [0, "FAZENDA A", false], [2, "ESTRADA VICINAL", false],
  ]);
});

test("ponto de terceiro vindo só do SIGEF não inventa confrontação", () => {
  const comTerceiro = [...sigefLinhas, {
    codigo: "OUTR-P-9999", lat: "-11°24'00,000\"", lon: "-39°05'00,000\"", alt: "305,00",
    confrontacao: "FAZENDA DE TERCEIRO",
  }];
  const out = reconciliarVerticesBancoComSigef("s1", vertBanco, comTerceiro, 24, proj4);
  const novo = out.find((v) => v.codigo === "OUTR-P-9999");
  assert.equal(novo.descritivo, null);
  assert.equal(novo.eh_via, false);
  assert.equal(novo.apelido_txt, null);
});
