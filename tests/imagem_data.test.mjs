// Imagem por data (Esri Wayback): as partes puras, sem rede. A fonte de
// mentira simula o acervo: versões, tilemap (de qual versão o tile veio),
// bytes dos tiles e o serviço de metadados (data da captura).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agruparSeguidos, buscarComPrazo, citacaoAtual, buscarMudancas, camadaMetadados, erroPrazo, citacao, consolidar, dataBr, detalheImagem, gms, idade,
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
  assert.equal(rotuloImagem(ultima), "até 01/01/2017", "a foto não pode ser posterior à versão");
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
  const c = citacao(img, -51.905, -6.6048, "2026-11-06", 16);
  assert.match(c, /Esri World Imagery Wayback, versão WB_3/);
  assert.match(c, /capturada em 01\/03\/2020 \(Maxar, resolução 0,5 m\)/);
  assert.match(c, /6°36'17,3" S, 51°54'18,0" W \(WGS 84\)/);
  assert.match(c, /Disponível em: https:\/\/livingatlas\.arcgis\.com\/wayback\/#active=1003&mapCenter=-51\.90500%2C-6\.60480%2C16/);
  assert.match(c, /Acesso em: 06\/11\/2026\.$/);
  const ca = citacaoAtual(-51.905, -6.6048, "2026-11-06");
  assert.match(ca, /data da captura da foto não confirmada/);
  assert.match(ca, /\(WGS 84\)\. Disponível em: https:\/\/www\.arcgis\.com\/.+ Acesso em: 06\/11\/2026\./);
});

test("imagensDoLugar: mostra a lista antes das datas (aoParcial) e ordena pela data da foto no fim", async () => {
  limparCache();
  const f = fonteFalsa();
  const parciais = [];
  const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f, aoParcial: (p) => parciais.push(p) });
  assert.ok(parciais.length >= 1);
  assert.ok(parciais[0].datasPendentes > 0, "a primeira parcial ainda espera as datas");
  // a parcial só mostra o que já tem data: cresce, nunca encolhe, e sai sempre em ordem
  for (let k = 1; k < parciais.length; k++) assert.ok(parciais[k].imagens.length >= parciais[k - 1].imagens.length, "não encolhe");
  for (const p of [...parciais, r]) {
    const datas = p.imagens.map((x) => x.captura?.data ?? x.versao.data);
    assert.deepEqual(datas, [...datas].sort().reverse(), "mais nova primeiro");
    assert.equal(new Set(datas).size, datas.length, "sem a mesma foto duas vezes");
  }
  assert.equal(r.datasPendentes, 0);
});

test("ordenarPorData: a foto mais nova primeiro, mesmo quando a versão é mais velha", () => {
  const v = (d) => ({ release: 1, data: d, identificador: "", metadados: null });
  const img = (versao, foto) => ({ release: 1, versao: v(versao), versoes: [], hash: null, tamanho: null, captura: foto ? { data: foto, fornecedor: null, resolucaoM: null, precisaoM: null } : null });
  const r = ordenarPorData([img("2018-09-06", "2013-09-01"), img("2016-10-12", null), img("2014-10-29", "2011-06-12")]);
  assert.deepEqual(r.map((x) => x.captura?.data ?? `v${x.versao.data}`), ["v2016-10-12", "2013-09-01", "2011-06-12"]);
});

// ---- rodada 2 da revisão -------------------------------------------------------

test("buscarComPrazo: funciona sem AbortSignal.any nem AbortSignal.timeout (Safari/iOS 16)", async () => {
  const [any, timeout] = [AbortSignal.any, AbortSignal.timeout];
  delete AbortSignal.any;
  delete AbortSignal.timeout;
  try {
    assert.equal(typeof AbortSignal.any, "undefined");
    const ok = async (_url, init) => { assert.ok(init.signal instanceof AbortSignal); return new Response(JSON.stringify({ a: 1 })); };
    const ctl = new AbortController();
    assert.deepEqual(await buscarComPrazo("x://", ctl.signal, (r) => r.json(), 1000, ok), { a: 1 });
    // e o caminho inteiro (imagensDoLugar) com um sinal do usuário, como o componente faz
    limparCache();
    const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: fonteFalsa(), sinal: new AbortController().signal });
    assert.equal(r.imagens.length, 3);
  } finally {
    AbortSignal.any = any;
    AbortSignal.timeout = timeout;
  }
});

// fetch que só termina quando abortado (e rejeita com um AbortError genérico, como o Safari)
const pendurado = (_url, init) => new Promise((_ok, falha) => {
  init.signal.addEventListener("abort", () => { const e = new Error("The operation was aborted."); e.name = "AbortError"; falha(e); });
});

test("buscarComPrazo: prazo estourado vira TimeoutError; cancelar vira AbortError", async () => {
  await assert.rejects(buscarComPrazo("x://", undefined, (r) => r.json(), 30, pendurado), { name: "TimeoutError" });
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 20);
  await assert.rejects(buscarComPrazo("x://", ctl.signal, (r) => r.json(), 5000, pendurado), { name: "AbortError" });
  const ja = new AbortController(); ja.abort();
  await assert.rejects(buscarComPrazo("x://", ja.signal, (r) => r.json(), 5000, pendurado), { name: "AbortError" });
});

test("buscarMudancas: orçamento de tempo total devolve o que achou, marcado incompleto", async () => {
  const t0 = Date.now();
  const r = await buscarMudancas(200, async (i) => { await new Promise((ok) => setTimeout(ok, 15)); return String(i); }, 1000, 60);
  assert.equal(r.completo, false);
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
  assert.equal(r.indices[0], 0);
});

test("imagensDoLugar: dois imóveis no mesmo tile não dividem a data da foto (cache por ponto)", async () => {
  limparCache();
  const f = fonteFalsa();
  const pontos = [];
  const meta = f.metadados;
  f.metadados = async (v, c, lon, lat) => { pontos.push(`${lon},${lat}`); return meta(v, c, lon, lat); };
  await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  const n = pontos.length;
  assert.deepEqual(tileDoPonto(-51.9, -6.6, 15), tileDoPonto(-51.9001, -6.6001, 15), "mesmo tile em z15");
  await imagensDoLugar(-51.9001, -6.6001, 15, { fonte: f }); // outro ponto
  assert.ok(pontos.length > n, "consultou a data no ponto novo");
  assert.ok(pontos.slice(n).every((p) => p === "-51.9001,-6.6001"));
});

test("imagensDoLugar: data que estourou o prazo é pedida de novo em segundo plano (aoAtualizar)", async () => {
  limparCache();
  const f = fonteFalsa();
  const meta = f.metadados;
  let primeira = true;
  f.metadados = async (v, ...a) => {
    if (v.release === 1009 && primeira) { primeira = false; throw erroPrazo(); }
    return meta(v, ...a);
  };
  let aoAtualizar;
  const atualizou = new Promise((ok) => { aoAtualizar = ok; });
  const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f, aoAtualizar });
  // rodada 3: a que espera a nova tentativa fica "a caminho", não vira foto à parte "até 01/01/2017"
  assert.equal(r.datasPendentes, 1);
  assert.ok(r.imagens.every((x) => x.captura), "nenhuma foto sem data contada como diferente");
  assert.ok(!r.imagens.some((x) => x.release === 1009));
  assert.equal(r.lento, false, "ainda não faltou nada: não é aviso");
  const novo = await atualizou;
  assert.ok(novo.imagens.every((x) => x.captura), "a data chegou depois");
  assert.equal(novo.imagens[novo.imagens.length - 1].captura.data, "2014-05-10");
  assert.equal(novo.datasPendentes, 0);
  assert.equal(novo.lento, false, "veio tudo: o aviso de lento não fica preso");
  // e o cache guarda a versão completa, sem o aviso
  const antes = { ...f.chamadas };
  const doCache = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.deepEqual(f.chamadas, antes, "veio do cache");
  assert.equal(doCache.lento, false);
  assert.equal(doCache.imagens.length, 3);
});

// ---- rodada 3 da revisão -------------------------------------------------------

test("imagensDoLugar: tilemap estoura o prazo mas o hash acha tudo → sem aviso de lento, e vai para o cache", async () => {
  limparCache();
  const f = fonteFalsa();
  f.tilemap = async () => { throw erroPrazo(); };
  const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.equal(r.metodo, "hash");
  assert.equal(r.lento, false);
  assert.equal(r.incompleto, false);
  const n = f.chamadas.bytes;
  const c = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.equal(f.chamadas.bytes, n, "guardado");
  assert.equal(c.lento, false);
});

test("imagensDoLugar: data que estoura o prazo duas vezes → aviso de lento, e não vai para o cache", async () => {
  limparCache();
  const f = fonteFalsa();
  const meta = f.metadados;
  f.metadados = async (v, ...a) => { if (v.release === 1009) throw erroPrazo(); return meta(v, ...a); };
  let aoAtualizar;
  const atualizou = new Promise((ok) => { aoAtualizar = ok; });
  await imagensDoLugar(-51.9, -6.6, 15, { fonte: f, aoAtualizar });
  const novo = await atualizou;
  assert.equal(novo.lento, true);
  assert.equal(novo.datasPendentes, 0);
  const semData = novo.imagens.find((x) => !x.captura);
  assert.equal(semData?.release, 1009, "depois da nova tentativa ela aparece, honesta: \"até …\"");
  const m = f.chamadas.meta;
  await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.ok(f.chamadas.meta > m, "não veio do cache");
});

test("buscarMudancas: um tile que falha no meio não derruba a busca (fica incompleta, com o resto achado)", async () => {
  const hashDe = (i) => (i < 5 ? "a" : i < 20 ? "b" : "c");
  let tentativas9 = 0;
  const r = await buscarMudancas(40, async (i) => {
    if (i === 9) { tentativas9++; throw new Error("HTTP 503"); }
    return hashDe(i);
  });
  assert.equal(tentativas9, 2, "tentou de novo uma vez");
  assert.equal(r.falhas, 1);
  assert.deepEqual(r.indices, [0, 5, 20], "o vizinho serviu de meio");
  assert.equal(r.completo, true);
  // um bloco inteiro caindo: devolve o que achou, marcado incompleto, sem rejeitar
  const q = await buscarMudancas(40, async (i) => { if (i >= 8 && i <= 12) throw new Error("HTTP 503"); return hashDe(i); });
  assert.equal(q.completo, false);
  assert.equal(q.corte, "falha");
  assert.ok(q.indices.includes(0) && q.indices.includes(20), `achou ${q.indices}`);
  // o cancelamento do usuário continua passando
  await assert.rejects(buscarMudancas(40, async () => { const e = new Error("x"); e.name = "AbortError"; throw e; }), { name: "AbortError" });
});

test("imagensDoLugar: tile 503 no meio da busca por hash → lista parcial, não a tela de erro", async () => {
  limparCache();
  const f = fonteFalsa({ tilemapFalha: true });
  const bytes = f.bytes;
  f.bytes = async (release, t) => { if (release === 1005) throw new Error("HTTP 503"); return bytes(release, t); };
  // o tile do meio falhou: um vizinho serve de meio e a busca acha as mesmas 3 fotos
  const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.equal(r.metodo, "hash");
  assert.deepEqual(r.imagens.map((x) => x.captura?.data), ["2025-08-09", "2020-03-01", "2014-05-10"]);
  assert.equal(r.corte, "falha", "a fronteira exata da foto de 2014 ficou em aberto: avisa");
  // vários tiles caindo seguidos: lista parcial, marcada, em vez da tela de erro
  limparCache();
  f.bytes = async (release, t) => { if (release >= 1004 && release <= 1008) throw new Error("HTTP 503"); return bytes(release, t); };
  const p = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.ok(p.imagens.length >= 1, `${p.imagens.length} fotos`);
  assert.equal(p.incompleto, true);
  assert.equal(p.corte, "falha");
  assert.equal(p.lento, false, "falhou, não demorou");
});

test("imagensDoLugar: a imagem de hoje igual à versão mais nova ganha a data dela (atualIgual)", async () => {
  limparCache();
  const f = fonteFalsa();
  f.bytesAtual = async () => new TextEncoder().encode("tile-0").buffer;
  const r = await imagensDoLugar(-51.9, -6.6, 15, { fonte: f });
  assert.equal(r.atualIgual, 1000);
  assert.equal(r.imagens.find((x) => x.release === r.atualIgual).captura.data, "2025-08-09");
  limparCache();
  f.bytesAtual = async () => new TextEncoder().encode("outra").buffer;
  assert.equal((await imagensDoLugar(-51.9, -6.6, 15, { fonte: f })).atualIgual, null, "foto diferente: não confirma");
  limparCache();
  f.bytesAtual = async () => { throw new Error("HTTP 500"); };
  assert.equal((await imagensDoLugar(-51.9, -6.6, 15, { fonte: f })).atualIgual, null, "falhou: não confirma, e não derruba");
});
