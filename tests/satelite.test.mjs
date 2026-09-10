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

import { garantirImagemSatelite } from "../supabase/functions/_shared/satelite.ts";

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

test("garantir: a imagem guardada em entrada/ vale, sem chamar o Mapbox", async () => {
  const st = storageFalso({ "sid/entrada/satelite.jpg": new Uint8Array([1, 2, 3]) });
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("não devia buscar"); };
  try {
    const r = await garantirImagemSatelite(st, "sid", "satelite", [anel], "tok", "Planta");
    assert.equal(r.aviso, null);
    assert.equal(r.imagem.tipo, "jpg");
    assert.deepEqual([...r.imagem.bytes], [1, 2, 3]);
  } finally { globalThis.fetch = fetchOriginal; }
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
