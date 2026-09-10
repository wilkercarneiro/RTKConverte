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
