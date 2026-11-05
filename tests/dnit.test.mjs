// Consulta da faixa de domínio no GeoServer do DNIT (src/lib/dnit.ts), com o
// DNIT falso: o que se lacra é o cruzamento — faixa que o imóvel invade vira
// área em m², faixa longe some, eixo do SNV perto diz a BR e a distância, e a
// versão vencida do SNV não entra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { consultarDnit } from "../src/lib/dnit.ts";

const mLon = 1 / (111320 * Math.cos(12 * Math.PI / 180));
const mLat = 1 / 110574;
const O = [-39.0, -12.0];
const ret = (x0, y0, x1, y1) => [[O[0] + x0 * mLon, O[1] + y0 * mLat], [O[0] + x1 * mLon, O[1] + y0 * mLat], [O[0] + x1 * mLon, O[1] + y1 * mLat], [O[0] + x0 * mLon, O[1] + y1 * mLat], [O[0] + x0 * mLon, O[1] + y0 * mLat]];

function dnitFalso({ reconhecida = [], documentada = [], snv = [] }) {
  const pedidos = [];
  const f = async (url) => {
    const u = new URL(url);
    const tipo = u.searchParams.get("typeName");
    pedidos.push(tipo);
    const features = tipo === "vgeo:vw_faixa_reconhecida" ? reconhecida : tipo === "vgeo:vw_faixa_dominio" ? documentada : snv;
    return new Response(JSON.stringify({ type: "FeatureCollection", features }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return { f, pedidos };
}

// faixa: retângulo de 0 a 40 m de y (a rodovia corre no eixo x); o imóvel começa em y = 30 m
const faixa = { properties: { Codigo_BR: "116", Lado_Esquerdo: "40", Lado_Direito: "Variável", Tipo_Documento: "Termo de Reconhecimento", Numero_Documento: "BA 999", Trecho: "A - B" }, geometry: { type: "Polygon", coordinates: [ret(-500, -40, 500, 40)] } };
const longe = { properties: { Codigo_BR: "242", Lado_Esquerdo: 30, Lado_Direito: 30, Numero_Documento: "Projeto 1" }, geometry: { type: "MultiPolygon", coordinates: [[ret(5000, -40, 6000, 40)]] } };
const eixo = (fim) => ({ properties: { Codigo_BR: "116", Administracao: "Federal", Local_Inicio: "A", Local_Fim: "B", dt_fim: fim }, geometry: { type: "MultiLineString", coordinates: [[[O[0] - 500 * mLon, O[1]], [O[0] + 500 * mLon, O[1]]]] } });

test("imóvel que entra na faixa reconhecida: invasão em m² e a largura oficial", async () => {
  const { f } = dnitFalso({ reconhecida: [faixa], documentada: [longe], snv: [eixo(null)] });
  const imovel = ret(0, 30, 200, 230).slice(0, 4);
  const r = await consultarDnit([imovel], "BA", f);
  assert.equal(r.faixas.length, 1, "a faixa da BR-242 a 5 km não entra");
  assert.equal(r.faixas[0].br, "BR-116");
  assert.equal(r.faixas[0].ladoEsquerdo, 40);
  assert.equal(r.faixas[0].ladoDireito, null, "\"Variável\" vira nulo");
  assert.equal(r.invasoes.length, 1);
  // 200 m × 10 m dentro da faixa; o plano local esférico erra < 1% (é um ALERTA,
  // não número de documento — a área oficial sai do cálculo geodésico do serviço)
  assert.ok(Math.abs(r.invasoes[0].areaM2 - 2000) / 2000 < 0.01, `área invadida ${r.invasoes[0].areaM2}`);
  assert.equal(r.eixos[0].br, "BR-116");
  assert.ok(Math.abs(r.eixos[0].distanciaM - 30) < 0.5, `distância ao eixo ${r.eixos[0].distanciaM}`);
});

test("imóvel fora da faixa: sem invasão; versão vencida do SNV não conta", async () => {
  const { f } = dnitFalso({ reconhecida: [faixa], snv: [eixo("2015-02-28Z")] });
  const r = await consultarDnit([ret(0, 60, 200, 260).slice(0, 4)], "PE", f);
  assert.equal(r.invasoes.length, 0);
  assert.equal(r.faixas.length, 1, "a faixa a 20 m entra como vizinha");
  assert.ok(Math.abs(r.faixas[0].distanciaM - 20) < 0.5);
  assert.equal(r.eixos.length, 0, "eixo com dt_fim no passado é versão antiga do SNV");
});

test("sem UF: só o SNV é consultado; anel vazio não consulta nada", async () => {
  const d = dnitFalso({ snv: [eixo(null)] });
  const r = await consultarDnit([ret(0, 60, 200, 260).slice(0, 4)], null, d.f);
  assert.deepEqual(d.pedidos, ["vgeo:vw_snv_rod"]);
  assert.equal(r.faixas.length, 0);
  const vazio = dnitFalso({});
  assert.deepEqual(await consultarDnit([[]], "BA", vazio.f), { faixas: [], invasoes: [], eixos: [] });
  assert.equal(vazio.pedidos.length, 0);
});
