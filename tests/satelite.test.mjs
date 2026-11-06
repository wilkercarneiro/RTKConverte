// Imagem de satélite pelas coordenadas: polyline, simplificação e URL do Mapbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { codificarPolyline, fecharAnel, simplificarParaCaber, urlImagemSatelite } from "../supabase/functions/_shared/satelite.ts";

test("polyline segue o exemplo oficial do Google", () => {
  // https://developers.google.com/maps/documentation/utilities/polylinealgorithm
  const pts = [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]];
  assert.equal(codificarPolyline(pts), "_p~iF~ps|U_ulLnnqC_mqNvxq`@");
});

test("anel aberto ganha o primeiro ponto no fim; fechado fica como está", () => {
  const a = [[-39, -11], [-39.01, -11], [-39.01, -11.01]];
  assert.equal(fecharAnel(a).length, 4);
  assert.deepEqual(fecharAnel(a)[3], a[0]);
  assert.equal(fecharAnel(fecharAnel(a)).length, 4);
});

test("anel gigante é afinado até a polyline caber no orçamento", () => {
  // 3 000 pontos num círculo de ~1 km: sem afinar a polyline passa do orçamento
  const anel = [];
  for (let i = 0; i < 3000; i++) {
    const t = (i / 3000) * 2 * Math.PI;
    anel.push([-39 + 0.009 * Math.cos(t), -11 + 0.009 * Math.sin(t)]);
  }
  assert.ok(codificarPolyline(anel).length > 2400);
  const fino = simplificarParaCaber(anel, 2400);
  assert.ok(codificarPolyline(fino).length <= 2400);
  assert.ok(fino.length >= 4);
  // extremos preservados: o primeiro e o último ponto são os mesmos
  assert.deepEqual(fino[0], anel[0]);
  assert.deepEqual(fino[fino.length - 1], anel[anel.length - 1]);
});

test("URL do Mapbox: estilo, overlay por anel, auto, @2x, token e tamanho da URL", () => {
  const anel = [[-39.0, -11.0], [-39.01, -11.0], [-39.01, -11.01], [-39.0, -11.01]];
  const url = urlImagemSatelite([anel], { token: "pk.teste" });
  assert.ok(url.startsWith("https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/path-4+ffd800-1+ffd800-0.12("));
  assert.ok(url.includes("/auto/1000x750@2x?padding=70&access_token=pk.teste"));
  assert.ok(url.length < 8192);
  // duas partes = dois overlays separados por vírgula
  const dois = urlImagemSatelite([anel, anel.map(([x, y]) => [x + 0.05, y])], { token: "t" });
  assert.equal(dois.split("path-4+").length - 1, 2);
  assert.throws(() => urlImagemSatelite([[[-39, -11], [-39, -11.1]]], { token: "t" }), /3 vértices/);
});

import { caixaConfere, caixaDosAneis, garantirImagemSatelite } from "../supabase/functions/_shared/satelite.ts";

/** Storage de mentira: um mapa caminho → bytes. */
function storageFalso(inicial = {}) {
  const arquivos = new Map(Object.entries(inicial));
  return {
    arquivos,
    from: () => ({
      download: async (p) => arquivos.has(p) ? { data: new Blob([arquivos.get(p)]), error: null } : { data: null, error: new Error("404") },
      upload: async (p, bytes) => { arquivos.set(p, bytes); return { error: null }; },
      remove: async (ps) => { for (const p of ps) arquivos.delete(p); },
    }),
  };
}
const anel = [[-39.0, -11.0], [-39.01, -11.0], [-39.01, -11.01]];

const caixaJson = (c) => new TextEncoder().encode(JSON.stringify({ caixa: c }));
const mapboxFalso = (bytes = [9, 9]) => async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "image/jpeg" } });

test("garantir: a imagem guardada DESTE contorno vale, sem chamar o Mapbox", async () => {
  const st = storageFalso({
    "sid/entrada/satelite.jpg": new Uint8Array([1, 2, 3]),
    "sid/entrada/satelite.caixa.json": caixaJson(caixaDosAneis([anel])),
  });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("não devia buscar"); };
  try {
    const r = await garantirImagemSatelite(st, "sid", "satelite", [anel], "tok", "Planta");
    assert.equal(r.aviso, null);
    assert.equal(r.imagem.tipo, "jpg");
    assert.deepEqual([...r.imagem.bytes], [1, 2, 3]);
  } finally { globalThis.fetch = fetchOriginal; }
});

test("garantir: imagem guardada de OUTRO lugar (GMS no fuso errado, 6° a oeste) é refeita — FAZENDA SALGADINHO", async () => {
  const outroLugar = anel.map(([lon, lat]) => [lon - 6, lat]);
  const st = storageFalso({
    "sid/entrada/satelite.jpg": new Uint8Array([1, 2, 3]),
    "sid/entrada/satelite.caixa.json": caixaJson(caixaDosAneis([outroLugar])),
  });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = mapboxFalso();
  try {
    const r = await garantirImagemSatelite(st, "sid", "satelite", [anel], "tok", "Planta");
    assert.equal(r.aviso, null);
    assert.deepEqual([...r.imagem.bytes], [9, 9]);
    // a caixa nova fica guardada: a próxima geração não busca de novo
    const salva = JSON.parse(new TextDecoder().decode(st.arquivos.get("sid/entrada/satelite.caixa.json"))).caixa;
    assert.ok(caixaConfere(salva, caixaDosAneis([anel])));
  } finally { globalThis.fetch = fetchOriginal; }
});

test("garantir: imagem antiga, sem caixa, é renovada uma vez; se o Mapbox falhar ela serve de reserva, avisada", async () => {
  const st = storageFalso({ "sid/entrada/satelite.jpg": new Uint8Array([1, 2, 3]) });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => new Response("erro", { status: 500 });
  try {
    const r = await garantirImagemSatelite(st, "sid", "satelite", [anel], "tok", "Planta");
    assert.deepEqual([...r.imagem.bytes], [1, 2, 3]);
    assert.match(r.aviso, /não pôde ser renovada.*confira/);
    globalThis.fetch = mapboxFalso([7]);
    const r2 = await garantirImagemSatelite(st, "sid", "satelite", [anel], "tok", "Planta");
    assert.equal(r2.aviso, null);
    assert.deepEqual([...r2.imagem.bytes], [7]);
  } finally { globalThis.fetch = fetchOriginal; }
});

test("garantir: imagem comprovadamente de outro contorno nunca vai para a planta, nem quando o Mapbox falha", async () => {
  const st = storageFalso({
    "sid/entrada/satelite.jpg": new Uint8Array([1, 2, 3]),
    "sid/entrada/satelite.caixa.json": caixaJson([-45.1, -11.1, -45.0, -11.0]),
  });
  const r = await garantirImagemSatelite(st, "sid", "satelite", [anel], undefined, "Planta");
  assert.equal(r.imagem, null);
  assert.match(r.aviso, /MAPBOX_TOKEN/);
});

test("caixaConfere: centímetros não renovam; dezenas de metros sim; lixo nunca confere", () => {
  const c = caixaDosAneis([anel]); // ~1,1 km
  assert.ok(caixaConfere(c.map((x) => x + 1e-6), c));        // ~0,1 m
  assert.ok(!caixaConfere(c.map((x, i) => i === 0 ? x - 5e-4 : x), c)); // ~55 m num lado (> 2% de 1,1 km)
  assert.ok(!caixaConfere(null, c));
  assert.ok(!caixaConfere([1, 2, 3], c));
  assert.ok(!caixaConfere(["a", 2, 3, 4], c));
  // imóvel pequeno: folga mínima de ~5 m
  const peq = [[-39, -11], [-39.0005, -11], [-39.0005, -11.0005]];
  const cp = caixaDosAneis([peq]);
  assert.ok(caixaConfere(cp.map((x) => x + 3e-5), cp));
  assert.ok(!caixaConfere(cp.map((x) => x + 1e-4), cp));
});

test("garantir: sem imagem guardada busca no Mapbox e guarda para a próxima", async () => {
  const st = storageFalso();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes("access_token=tok"));
    return new Response(new Uint8Array([9, 9]), { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  try {
    const r = await garantirImagemSatelite(st, "sid", "satelite-gleba-2", [anel], "tok", "GLEBA 2");
    assert.equal(r.aviso, null);
    assert.equal(r.imagem.tipo, "jpg");
    assert.ok(st.arquivos.has("sid/entrada/satelite-gleba-2.jpg"));
  } finally { globalThis.fetch = fetchOriginal; }
});

test("garantir: sem token ou com falha do Mapbox devolve aviso, nunca lança", async () => {
  const st = storageFalso();
  const semToken = await garantirImagemSatelite(st, "sid", "satelite", [anel], undefined, "Planta");
  assert.equal(semToken.imagem, null);
  assert.match(semToken.aviso, /MAPBOX_TOKEN/);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
  try {
    const r = await garantirImagemSatelite(st, "sid", "satelite", [anel], "tok", "Planta");
    assert.equal(r.imagem, null);
    assert.match(r.aviso, /401/);
  } finally { globalThis.fetch = fetchOriginal; }
});

import { enquadrar, mercatorPx, pontoNoMapa, urlMapaSatelite } from "../supabase/functions/_shared/satelite.ts";

test("mercator: origem do mundo e centro (0,0)", () => {
  assert.deepEqual(mercatorPx(-180, 85.0511287798, 0).map((v) => Math.round(v)), [0, 0]);
  assert.deepEqual(mercatorPx(0, 0, 0), [256, 256]);
  assert.deepEqual(mercatorPx(0, 0, 1), [512, 512]);
});

test("enquadrar: todos os pontos caem dentro da imagem, respeitando a margem", () => {
  const anel = [[-39.0, -11.0], [-39.02, -11.0], [-39.02, -11.015], [-39.0, -11.015]];
  const g = enquadrar([anel], 640, 640, 40);
  for (const [lon, lat] of anel) {
    const [x, y] = pontoNoMapa(lon, lat, g);
    assert.ok(x >= 39 && x <= 601, `x=${x}`);
    assert.ok(y >= 39 && y <= 601, `y=${y}`);
  }
  // o lado maior encosta na margem
  const xs = anel.map(([lon, lat]) => pontoNoMapa(lon, lat, g)[0]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 540);
  // o centro da imagem é o centro do polígono
  const [cx, cy] = pontoNoMapa(g.lon, g.lat, g);
  assert.ok(Math.abs(cx - 320) < 1e-6 && Math.abs(cy - 320) < 1e-6);
  assert.match(urlMapaSatelite(g, "tok"), /static\/-39\.010000,-11\.0075\d\d,\d+(\.\d+)?,0\/640x640@2x\?access_token=tok$/);
});
