// Troca de fuso na Conferência (sem certificados): o E/N fica e o GMS é refeito.
// Regressão da FAZENDA SALGADINHO (06/11/2026): o GMS ficou no fuso 23 com o
// serviço no 24 — 6° de longitude fora — e a satélite saiu de outro lugar.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4 from "proj4";
import { reprojetarVerticesNoFuso, utmDoGms } from "../src/lib/vertice_utm.ts";
import { GEO_DEF, gmsToDeg, parseGmsPlanilha, utmDef } from "../supabase/functions/_shared/geo.ts";

const lonDe = (v) => gmsToDeg(parseGmsPlanilha(v.lon_gms));
const latDe = (v) => gmsToDeg(parseGmsPlanilha(v.lat_gms));

// pontos reais da Salgadinho (Nova Soure/BA): E/N do 24S, GMS gravado no 23S
const salgadinho = [
  { ordem: 0, e: 560480.877, n: 8758393.392, lat_gms: "", lon_gms: "", inserido_manual: false },
  { ordem: 1, e: 561138.471, n: 8760376.876, lat_gms: "", lon_gms: "", inserido_manual: false },
].map((v) => {
  const [lon, lat] = proj4(utmDef(23), GEO_DEF, [v.e, v.n]);
  const fmt = (d) => { const a = Math.abs(d), g = Math.floor(a), m = Math.floor((a - g) * 60), s = ((a - g) * 60 - m) * 60; return `${g} ${m} ${s.toFixed(3).replace(".", ",")}`; };
  return { ...v, lat_gms: `${fmt(lat)} S`, lon_gms: `${fmt(lon)} W` };
});

test("fuso 23 → 24: GMS refeito a partir do E/N, que não muda", () => {
  assert.ok(lonDe(salgadinho[0]) < -44); // o estado quebrado: ~44,4° W
  const novos = reprojetarVerticesNoFuso(salgadinho, 24);
  for (const [i, v] of novos.entries()) {
    assert.equal(v.e, salgadinho[i].e);
    assert.equal(v.n, salgadinho[i].n);
    const [lon, lat] = proj4(utmDef(24), GEO_DEF, [v.e, v.n]);
    assert.ok(Math.abs(lonDe(v) - lon) < 1e-6, `lon ${lonDe(v)} × ${lon}`);
    assert.ok(Math.abs(latDe(v) - lat) < 1e-6);
    assert.ok(lonDe(v) > -38.5 && lonDe(v) < -38.4); // Nova Soure
    assert.match(v.lon_gms, /^38 \d+ \d+,\d{3} W$/);
  }
});

test("vértice inserido à mão: o GMS é a verdade e o E/N é que muda", () => {
  const v = { ordem: 5, e: 1, n: 2, lat_gms: "11 13 0,000 S", lon_gms: "38 27 0,000 W", inserido_manual: true };
  const [novo] = reprojetarVerticesNoFuso([v], 24);
  assert.equal(novo.lat_gms, v.lat_gms);
  assert.equal(novo.lon_gms, v.lon_gms);
  const en = utmDoGms(v, 24);
  assert.equal(novo.e, en[0]);
  assert.equal(novo.n, en[1]);
});

test("vértice sem E/N nem GMS fica como está", () => {
  const v = { ordem: 1, e: null, n: null, lat_gms: "", lon_gms: "", inserido_manual: false };
  assert.deepEqual(reprojetarVerticesNoFuso([v], 24), [v]);
});
