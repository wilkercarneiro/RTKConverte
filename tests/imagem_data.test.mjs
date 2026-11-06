// Imagem por data (Esri Wayback): as partes puras, sem rede. A fonte de
// mentira simula o acervo: versões, tilemap (de qual versão o tile veio),
// bytes dos tiles e o serviço de metadados (data da captura).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparSeguidos, buscarMudancas, camadaMetadados, citacao, consolidar, dataBr, detalheImagem, gms, idade,
  imagensDoLugar, lerCaptura, lerConfig, lerTilemap, limparCache, ordenarPorData, percorrerVersoes, rotuloImagem, tileDoPonto,
  zoomParaExtensao,
} from "../src/lib/imagem_data.ts";

// ---- configuração -------------------------------------------------------------

const CONFIG = {
  "10": { itemTitle: "World Imagery (Wayback 2014-02-20)", layerIdentifier: "WB_2014_R01", metadataLayerUrl: "https://meta/2014_r01/MapServer" },
  "43291": { itemTitle: "World Imagery (Wayback 2026-10-29)", layerIdentifier: "WB_2026_R10", metadataLayerUrl: "https://meta/2026_r10/MapServer/" },
  "2168": { itemTitle: "World Imagery (Wayback 2018-09-06)", layerIdentifier: "WB_2018_R09", metadataLayerUrl: "https://meta/2018/MapServer" },
  "abc": { itemTitle: "World Imagery (Wayback 2020-01-01)" },
  "77": { itemTitle: "sem data" },
  "99": { itemTitle: "World Imagery (Wayback 2018-09-06)", metadataLayerUrl: "http://inseguro" },
};

test("lerConfig: ordena da mais nova para a mais velha e descarta o que não serve", () => {
  const v = lerConfig(CONFIG);
  assert.deepEqual(v.map((x) => x.release), [43291, 2168, 99, 10]);
  assert.equal(v[0].data, "2026-10-29");
  assert.equal(v[0].identificador, "WB_2026_R10");
  assert.equal(v[0].metadados, "https://meta/2026_r10/MapServer", "tira a barra do fim");
  assert.equal(v.find((x) => x.release === 99).metadados, null, "só https");
  assert.deepEqual(lerConfig(null), []);
  assert.deepEqual(lerConfig("x"), []);
});

// ---- tiles --------------------------------------------------------------------

test("tileDoPonto: confere com o tile conhecido de Brasília (z17)", () => {
  assert.deepEqual(tileDoPonto(-47.95, -15.75, 17), { z: 17, x: 48077, y: 71344 });
  assert.deepEqual(tileDoPonto(-51.9, -6.6, 15), { z: 15, x: 11659, y: 16986 });
  // polos e antimeridiano não saem da grade
  const t = tileDoPonto(180, -90, 4);
  assert.ok(t.x <= 15 && t.y <= 15 && t.x >= 0 && t.y >= 0);
});

test("zoomParaExtensao: enquadra a área num tile, entre 14 e 17", () => {
  assert.equal(zoomParaExtensao(null), 16);
  assert.equal(zoomParaExtensao([-51.9083, -6.6079, -51.9017, -6.6018]), 15);
  assert.equal(zoomParaExtensao([-48, -16, -47.9999, -15.9999]), 17, "lote pequeno: no máximo 17");
  assert.equal(zoomParaExtensao([-50, -10, -48, -8]), 14, "fazenda enorme: no mínimo 14");
});

test("lerTilemap: lê data/select/size e recusa resposta estranha", () => {
  assert.deepEqual(lerTilemap({ data: [1], select: [10842], size: [11884], valid: true }), { tem: true, release: 10842, tamanho: 11884 });
  assert.deepEqual(lerTilemap({ data: [0], valid: true }), { tem: false, release: null, tamanho: null });
  assert.equal(lerTilemap({ error: { code: 500 } }), null);
  assert.equal(lerTilemap(null), null);
});

// ---- metadados ----------------------------------------------------------------

test("camadaMetadados: 23 − zoom, entre 0 e 13", () => {
  assert.equal(camadaMetadados(17), 6);
  assert.equal(camadaMetadados(15), 8);
  assert.equal(camadaMetadados(5), 13);
  assert.equal(camadaMetadados(24), 0);
});

test("lerCaptura: data da foto (SRC_DATE2 em ms, ou SRC_DATE aaaammdd), fornecedor e resolução", () => {
  const c = lerCaptura({ features: [{ attributes: { SRC_DATE2: 1757635200000, NICE_DESC: "Vantor", SRC_RES: 0.46, SRC_ACC: 8.47 } }] });
  assert.deepEqual(c, { data: "2025-09-12", fornecedor: "Vantor", resolucaoM: 0.46, precisaoM: 8.47 });
  assert.equal(lerCaptura({ features: [{ attributes: { SRC_DATE: 20180617 } }] }).data, "2018-06-17");
  assert.equal(lerCaptura({ features: [] }), null, "ponto fora da cobertura");
  assert.equal(lerCaptura({ features: [{ attributes: { SRC_DATE: 20181399 } }] }), null, "data inválida");
  assert.equal(lerCaptura({ error: { code: 502 } }), null);
});

// ---- achar as mudanças ---------------------------------------------------------

// 12 versões (0 = mais nova). A foto muda nas versões 0, 3, 4 e 9; a 10 e a 11 não têm imagem.
const ORIGEM = [0, 3, 3, 3, 4, 9, 9, 9, 9, 9, null, null];
const VERSOES = ORIGEM.map((_, i) => ({ release: 1000 + i, data: `20${String(26 - i).padStart(2, "0")}-01-01`, identificador: `WB_${i}`, metadados: `https://meta/${i}` }));

test("percorrerVersoes: pula direto de mudança em mudança pelo tilemap", async () => {
  const consultas = [];
  const r = await percorrerVersoes(VERSOES, async (release) => {
    const i = release - 1000;
    consultas.push(i);
    return ORIGEM[i] == null ? { tem: false, release: null, tamanho: null } : { tem: true, release: 1000 + ORIGEM[i], tamanho: 100 + ORIGEM[i] };
  });
  assert.deepEqual(r.candidatas.map((c) => c.indice), [0, 3, 4, 9]);
  assert.deepEqual(r.candidatas.map((c) => c.faixa), [[0, 0], [1, 3], [4, 4], [5, 9]]);
  assert.deepEqual(consultas, [0, 1, 4, 5, 10], "5 consultas para 12 versões");
  assert.equal(r.completo, true);
});

test("percorrerVersoes: respeita o limite e não volta no tempo com resposta incoerente", async () => {
  const r = await percorrerVersoes(VERSOES, async () => ({ tem: true, release: 1000, tamanho: 1 }), 3);
  assert.deepEqual(r.candidatas.map((c) => c.indice), [0, 1, 2]);
  assert.equal(r.completo, false);
});

test("buscarMudancas: busca binária pelo hash acha os mesmos trechos, com menos consultas que versões", async () => {
  // 40 versões; trechos iguais: 0–4, 5–19, 20–38; a 39 não tem imagem
  const hashDe = (i) => (i === 39 ? null : i < 5 ? "a" : i < 20 ? "b" : "c");
  const consultadas = new Set();
  const r = await buscarMudancas(40, async (i) => { consultadas.add(i); return hashDe(i); });
  assert.deepEqual(r.indices, [0, 5, 20]);
  assert.equal(r.completo, true);
  assert.ok(r.consultas < 40 && consultadas.size === r.consultas, `${r.consultas} consultas`);
});

test("buscarMudancas: com limite curto, para e avisa que ficou incompleto", async () => {
  const r = await buscarMudancas(64, async (i) => String(i), 6);
  assert.equal(r.completo, false);
  assert.ok(r.consultas <= 8);
  assert.equal(r.indices[0], 0);
});

test("buscarMudancas: lista vazia e lugar sem imagem nenhuma", async () => {
  assert.deepEqual((await buscarMudancas(0, async () => "x")).indices, []);
  assert.deepEqual((await buscarMudancas(10, async () => null)).indices, []);
});

test("agruparSeguidos e consolidar: mesma foto (hash ou data de captura) vira uma linha", () => {
  assert.deepEqual(agruparSeguidos([1, 1, 2, 1], (a, b) => a === b), [[1, 1], [2], [1]]);
  const v = (i) => VERSOES[i];
  const img = (i, hash, data) => ({ release: 1000 + i, versao: v(i), versoes: [v(i)], hash, tamanho: 1, captura: data ? { data, fornecedor: "Maxar", resolucaoM: 0.5, precisaoM: null } : null });
  const r = consolidar([
    img(0, "h0", "2025-08-09"),
    img(1, "h1", "2018-06-17"),
    img(2, "h2", "2018-06-17"), // mesma captura, reprocessada
    img(3, "h3", null),
    img(4, "h3", null), // mesmo conteúdo, sem data
    img(5, "h5", "2013-09-01"),
  ]);
  assert.deepEqual(r.map((x) => x.release), [1000, 1001, 1003, 1005]);
  assert.deepEqual(r[1].versoes.map((x) => x.release), [1001, 1002]);
  assert.deepEqual(r[2].versoes.map((x) => x.release), [1003, 1004]);
});

// ---- orquestração com fonte de mentira ----------------------------------------

function fonteFalsa({ tilemapFalha = false, metaFalha = new Set(), semImagemAcimaDe = 99 } = {}) {
  const chamadas = { tilemap: 0, bytes: 0, meta: 0 };
  const bytesDe = (i) => {
    const o = ORIGEM[i];
    if (o == null) return null;
    // as versões 3 e 4 são o MESMO arquivo republicado (mesmo tamanho e conteúdo)
    const conteudo = o === 4 ? 3 : o;
    return new TextEncoder().encode(`tile-${conteudo}`).buffer;
  };
  const capturaDe = { 0: "2025-08-09", 3: "2020-03-01", 4: "2020-03-01", 9: "2014-05-10" };
  return {
    chamadas,
    nome: `falsa-${Math.random()}`,
    atribuicao: "teste",
    config: async () => Object.fromEntries(VERSOES.map((v) => [String(v.release), { itemTitle: `World Imagery (Wayback ${v.data})`, layerIdentifier: v.identificador, metadataLayerUrl: v.metadados }])),
    tilemap: async (release, t) => {
      chamadas.tilemap++;
      if (tilemapFalha) throw new Error("HTTP 502");
      const i = release - 1000;
      if (t.z > semImagemAcimaDe || ORIGEM[i] == null) return { data: [0] };
      const o = ORIGEM[i];
      return { data: [1], select: [1000 + o], size: [o === 4 ? 103 : 100 + o] };
    },
    bytes: async (release, t) => { chamadas.bytes++; return t.z > semImagemAcimaDe ? null : bytesDe(release - 1000); },
    metadados: async (v) => {
      chamadas.meta++;
      const i = v.release - 1000;
      if (metaFalha.has(i)) throw new Error("HTTP 502");
      return { features: [{ attributes: { SRC_DATE: Number(capturaDe[ORIGEM[i]].replaceAll("-", "")), NICE_DESC: "Maxar", SRC_RES: 0.5 } }] };
    },
    modeloTile: (r) => `x://${r}/{z}/{y}/{x}`,
    urlTile: (r, t) => `x://${r}/${t.z}/${t.y}/${t.x}`,
  };
}

test("imagensDoLugar: tilemap + hash + data da captura → só as fotos diferentes", async () => {
  limparCache();
  const f = fonteFalsa();
  const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.equal(r.metodo, "tilemap");
  assert.equal(r.totalVersoes, 12);
  // 0, 3 (= 4, mesmo arquivo e mesma captura), 9
  assert.deepEqual(r.imagens.map((x) => x.captura?.data), ["2025-08-09", "2020-03-01", "2014-05-10"]);
  assert.deepEqual(r.imagens[1].versoes.map((x) => x.release), [1001, 1002, 1003, 1004]);
  assert.equal(r.imagens[2].versoes.length, 5);
  // cache: a segunda chamada não vai à rede
  const antes = { ...f.chamadas };
  await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.deepEqual(f.chamadas, antes);
});

test("imagensDoLugar: tilemap fora do ar → cai na busca por hash e acha as mesmas fotos", async () => {
  limparCache();
  const f = fonteFalsa({ tilemapFalha: true });
  const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.equal(r.metodo, "hash");
  assert.deepEqual(r.imagens.map((x) => x.captura?.data), ["2025-08-09", "2020-03-01", "2014-05-10"]);
});

test("imagensDoLugar: metadados falhando não derruba a lista (fica a data da versão)", async () => {
  limparCache();
  const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: fonteFalsa({ metaFalha: new Set([9]) }) });
  const ultima = r.imagens[r.imagens.length - 1];
  assert.equal(ultima.captura, null);
  assert.equal(rotuloImagem(ultima), "versão de 01/01/2017");
  assert.match(detalheImagem(ultima), /não informada/);
});

test("imagensDoLugar: sem imagem no zoom alto, desce de zoom até achar", async () => {
  limparCache();
  const r = await imagensDoLugar(-51.9, -6.6, 17, { fonte: fonteFalsa({ semImagemAcimaDe: 14 }) });
  assert.equal(r.tile.z, 13);
  assert.equal(r.imagens.length, 3);
});

test("imagensDoLugar: cancelar (AbortSignal) interrompe sem virar 'lugar sem imagem'", async () => {
  limparCache();
  const ctl = new AbortController();
  const f = fonteFalsa();
  const tilemap = f.tilemap;
  f.tilemap = async (...a) => { ctl.abort(); const e = new Error("abortado"); e.name = "AbortError"; throw e; void tilemap; void a; };
  await assert.rejects(imagensDoLugar(-51.9, -6.6, 15, { fonte: f, sinal: ctl.signal }), { name: "AbortError" });
});

// ---- textos -------------------------------------------------------------------

test("textos: data, idade, GMS e citação para o laudo", () => {
  assert.equal(dataBr("2018-06-17"), "17/06/2018");
  assert.equal(idade("2018-06-17", "2026-11-06"), "há 8 anos");
  assert.equal(idade("2026-06-01", "2026-11-06"), "há 5 meses");
  assert.equal(idade("2025-11-01", "2026-11-06"), "há 1 ano");
  assert.equal(idade("2026-11-01", "2026-11-06"), "este mês");
  assert.equal(gms(-6.6048, "lat"), `6°36'17,3" S`);
  assert.equal(gms(-51.905, "lon"), `51°54'18,0" W`);
  const img = { release: 1003, versao: VERSOES[3], versoes: [VERSOES[3]], hash: null, tamanho: null, captura: { data: "2020-03-01", fornecedor: "Maxar", resolucaoM: 0.5, precisaoM: null } };
  const c = citacao(img, -51.905, -6.6048);
  assert.match(c, /Esri World Imagery Wayback, versão WB_3/);
  assert.match(c, /capturada em 01\/03\/2020 \(Maxar, resolução 0,5 m\)/);
  assert.match(c, /6°36'17,3" S, 51°54'18,0" W/);
});

test("imagensDoLugar: mostra a lista antes das datas (aoParcial) e ordena pela data da foto no fim", async () => {
  limparCache();
  const f = fonteFalsa();
  const parciais = [];
  const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f, aoParcial: (p) => parciais.push(p) });
  assert.ok(parciais.length >= 1);
  assert.ok(parciais[0].datasPendentes > 0, "a primeira parcial ainda espera as datas");
  assert.ok(parciais[0].imagens.length >= 3);
  assert.equal(r.datasPendentes, 0);
});

test("ordenarPorData: a foto mais nova primeiro, mesmo quando a versão é mais velha", () => {
  const v = (d) => ({ release: 1, data: d, identificador: "", metadados: null });
  const img = (versao, foto) => ({ release: 1, versao: v(versao), versoes: [], hash: null, tamanho: null, captura: foto ? { data: foto, fornecedor: null, resolucaoM: null, precisaoM: null } : null });
  const r = ordenarPorData([img("2018-09-06", "2013-09-01"), img("2016-10-12", null), img("2014-10-29", "2011-06-12")]);
  assert.deepEqual(r.map((x) => x.captura?.data ?? `v${x.versao.data}`), ["v2016-10-12", "2013-09-01", "2011-06-12"]);
});
