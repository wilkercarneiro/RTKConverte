// Exportar a área (src/lib/exportar + saída "area" da função `entregar`).
//
// O que se prova aqui:
//  • cada formato sai bem formado e com as coordenadas certas (KML, KMZ, GPX,
//    DXF com as camadas nomeadas, pacote CAD, GeoJSON, SHP lido de volta pelo
//    pacote `shapefile`, CSV e TXT);
//  • a ida e volta UTM → lon/lat → UTM erra menos de 1 mm, inclusive passando
//    pelo texto do arquivo (9 casas de grau);
//  • a montagem das camadas de cada modalidade: GEO sem glebas (o anel do
//    memorial, ponto a ponto), com partes (IBERA), com glebas de divisa comum e
//    com vértice fora de gleba; loteamento (nomes da locação); CAR (lon/lat);
//  • a função `entregar` de ponta a ponta no Supabase falso: lê do banco,
//    confere o contorno ANTES de gerar e recusa formato inválido com 400.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import JSZip from "jszip";
import proj4lib from "proj4";
import shapefile from "shapefile";
import { exportarArea, FORMATOS_AREA, nomeDoArquivo } from "../src/lib/exportar/index.ts";
import { areaAssinada, fusoDoMeio, geoParaUtm, nomeLimpo, prepararCamadas, utmParaGeo } from "../src/lib/exportar/coordenadas.ts";
import { gerarKmlArea } from "../src/lib/exportar/kml.ts";
import { gerarDxfArea, textoDxf } from "../src/lib/exportar/dxf.ts";
import { prjUtmSirgas2000 } from "../src/lib/exportar/cad.ts";
import { anelExterno, camadasDoGeo, contornoDasCamadas, contornoDoGeo, nomeDoVertice, textoConfrontante } from "../src/lib/exportar/geo.ts";
import { camadasDoLoteamento } from "../src/lib/exportar/loteamento.ts";
import { camadasDoCar, fusoDoCar } from "../src/lib/exportar/car.ts";
import { PRJ_SIRGAS2000 } from "../src/lib/car/shapefile.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { ANEL, entrada } from "./fixtures/salgada_velha.mjs";
import { GLEBAS as GLEBAS_IBERA, VERTICES as VERTICES_IBERA } from "./fixtures/ibera.mjs";
import { perimetro as GLEBA_LOT } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo as projetoLot } from "../src/lib/loteamento/modelo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { paraUtm } from "../src/lib/loteamento/plano.ts";
import { LOCACAO_PADRAO, nomesDosPontos, pontosDeLocacao } from "../src/lib/loteamento/saidas.ts";
import { lerKml } from "../src/lib/car/kml.ts";
import { calcularCar, projetoNovo as projetoCar, reservaPorLado } from "../src/lib/car/motor.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const dec = (u8) => new TextDecoder().decode(u8);
const toAb = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// ---------------------------------------------------------------- fixtures

/** As linhas de `vertices` da SALGADA VELHA como vêm do banco (com a confrontação nos M). */
const linhasSalgada = (extra = () => ({})) => ANEL.map(([ordem, e, n, tipo, codigo, descritivo], i) => ({
  ordem, num_txt: ordem + 1, e, n, h: 360 + i / 10, tipo, codigo, descritivo: descritivo || null, apelido_txt: null,
  codigo_provisorio: false, inserido_manual: false, lat_gms: "", lon_gms: "", ...extra(i),
}));
const linhasIbera = () => VERTICES_IBERA.map(([ordem, num, tipo, e, n]) => ({ ordem, num_txt: num, e, n, h: 0, tipo, codigo: null }));
const GEO_SALGADA = camadasDoGeo(linhasSalgada(), [], 24, { nome: "FAZENDA SALGADA VELHA" });
const feicoesDe = (camadas, nome) => camadas.find((c) => c.nome === nome).feicoes;
const VERTICES_SALGADA = feicoesDe(GEO_SALGADA, "VERTICES");
const OP = { fuso: 24, nome: "FAZENDA SALGADA VELHA", hoje: new Date(2026, 10, 5) };

/** A SALGADA dividida em duas glebas pela corda 5–21, que corre por dentro (divisa interna comum). */
const anelDe = (idx) => idx.map((i) => [ANEL[i][1], ANEL[i][2]]);
const GLEBAS_SALGADA = [
  { nome: "GLEBA A", anel: anelDe(Array.from({ length: 17 }, (_, i) => 5 + i)) },
  { nome: "", anel: anelDe([...Array.from({ length: 11 }, (_, i) => 21 + i), 0, 1, 2, 3, 4, 5]) },
];

const quadrado = (e0, n0, l) => [[e0, n0], [e0 + l, n0], [e0 + l, n0 + l], [e0, n0 + l]];
/** Polígono com furo (e acento no nome) e uma linha: o que o GEO não tem e o CAR tem. */
const SINTETICA = [
  { nome: "AREAS", cor: "#2E9E5B", feicoes: [{ nome: "GLEBA SÃO JOSÉ", tipo: "poligono", utm: quadrado(500000, 8700000, 100), furosUtm: [quadrado(500040, 8700040, 20)], props: { area_ha: 0.96 } }] },
  { nome: "RIOS", feicoes: [{ nome: "RIACHO", tipo: "linha", utm: [[500000, 8700050], [500050, 8700055], [500100, 8700060]] }] },
];

let loteamento;
/** O loteamento da gleba de teste, com proposta gerada (como entregas.test.mjs). */
function projetoLoteamento() {
  if (!loteamento) {
    const pr0 = projetoLot("TESTE", GLEBA_LOT.pts.length);
    pr0.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
    const projeto = JSON.parse(JSON.stringify(gerarPropostas(pr0, GLEBA_LOT, { quantas: 1, estruturar: false })[0].projeto));
    loteamento = { projeto, res: calcular(projeto, GLEBA_LOT) };
  }
  return loteamento;
}

/** O CAR de demonstração com a reserva encostada no lado 0 (20% exatos). */
function projetoCarDemo() {
  const kml = lerKml(fs.readFileSync(new URL("./fixtures/car/PLANTA.kml", import.meta.url), "utf8"));
  const p = projetoCar("FAZENDA DEMO", kml.perimetro);
  p.reserva.poligonos = reservaPorLado(p, 0);
  return p;
}

// ---------------------------------------------------------------- leitores

/** XML bem formado: toda tag fecha na ordem, nada de < > & soltos no texto. */
function xmlBemFormado(xml) {
  const corpo = xml.replace(/^﻿?<\?xml[^>]*\?>/, "").replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"<]*")*)\s*(\/?)>/g;
  const pilha = [];
  let fim = 0, m;
  const textoOk = (t) => {
    assert.ok(!/[<>]/.test(t), `texto com < ou > solto: ${t.slice(0, 60)}`);
    assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(t), `& sem entidade: ${t.slice(0, 60)}`);
  };
  while ((m = re.exec(corpo))) {
    textoOk(corpo.slice(fim, m.index));
    fim = re.lastIndex;
    if (m[1]) assert.equal(pilha.pop(), m[2], `</${m[2]}> fora de ordem`);
    else if (!m[4]) pilha.push(m[2]);
  }
  textoOk(corpo.slice(fim));
  assert.deepEqual(pilha, [], "tag sem fechar");
}

/** As tuplas de cada <coordinates> do KML. */
const coordenadasKml = (xml) => [...xml.matchAll(/<coordinates>([^<]*)<\/coordinates>/g)]
  .map((m) => m[1].trim().split(/\s+/).map((t) => t.split(",").map(Number)));

/** Pares (código, valor) do DXF, conferindo que o arquivo é par a par. */
function paresDxf(dxf) {
  const linhas = dxf.split("\r\n");
  assert.equal(linhas.pop(), "", "DXF termina com quebra de linha");
  assert.equal(linhas.length % 2, 0, "DXF é sequência de pares código/valor");
  const out = [];
  for (let i = 0; i < linhas.length; i += 2) out.push([linhas[i].trim(), linhas[i + 1]]);
  return out;
}
const contar = (pares, ent) => pares.filter(([c, v]) => c === "0" && v === ent).length;
/** As camadas da tabela LAYER, na ordem. */
const camadasDxf = (pares) => pares.flatMap(([c, v], i) => (c === "0" && v === "LAYER" ? [pares[i + 1][1]] : []));
/** Cada entidade com os seus grupos: { tipo, camada, g: {código: valor} }. */
function entidadesDxf(pares) {
  const ini = pares.findIndex(([c, v]) => c === "2" && v === "ENTITIES");
  const out = [];
  for (let i = ini + 1; i < pares.length; i++) {
    const [c, v] = pares[i];
    if (c !== "0") { const e = out[out.length - 1]; if (e) e.g[c] ??= v; continue; }
    if (v === "ENDSEC") break;
    out.push({ tipo: v, g: {} });
  }
  for (const e of out) e.camada = e.g["8"];
  return out;
}

async function lerShp(zip, base, encoding = "utf-8") {
  const shp = await zip.file(`${base}.shp`).async("uint8array");
  const dbf = await zip.file(`${base}.dbf`).async("uint8array");
  const src = await shapefile.open(toAb(shp), toAb(dbf), { encoding });
  const out = [];
  for (let r = await src.read(); !r.done; r = await src.read()) out.push(r.value);
  return out;
}
const chave9 = (p) => `${p[0].toFixed(9)},${p[1].toFixed(9)}`;

// ======================================================================
// Formatos
// ======================================================================

test("formatos: os nove do menu, e o nome do arquivo diz o sistema de coordenadas", () => {
  assert.deepEqual(new Set(FORMATOS_AREA.map((f) => f.id)), new Set(["kml", "kmz", "dxf", "cad", "gpx", "shp", "geojson", "csv", "txt"]));
  assert.equal(FORMATOS_AREA.find((f) => f.id === "cad").rotulo, "Pacote CAD (.zip)");
  assert.ok(!FORMATOS_AREA.some((f) => /dwg/i.test(`${f.rotulo} ${f.serve}`)), "DXF não é DWG");
  assert.equal(nomeDoArquivo("Fazenda São José", "dxf", 24), "FAZENDA_SAO_JOSE_SIRGAS2000_UTM24S.dxf");
  assert.equal(nomeDoArquivo("Fazenda São José", "cad", 24), "FAZENDA_SAO_JOSE_CAD_SIRGAS2000_UTM24S.zip");
  assert.equal(nomeDoArquivo("Fazenda São José", "csv", 23), "FAZENDA_SAO_JOSE_SIRGAS2000_UTM23S.csv");
  assert.equal(nomeDoArquivo("Fazenda São José", "txt", 24), "FAZENDA_SAO_JOSE_SIRGAS2000_UTM24S.txt");
  for (const f of ["kml", "kmz", "gpx", "geojson"]) assert.equal(nomeDoArquivo("Fazenda São José", f, 24), `FAZENDA_SAO_JOSE.${f}`);
  assert.equal(nomeDoArquivo("Fazenda São José", "shp", 24), "FAZENDA_SAO_JOSE_SHP_SIRGAS2000.zip");
  assert.equal(nomeLimpo("  ///  "), "AREA");
  assert.equal(nomeLimpo("Sítio Boa Vista / Gleba 2"), "SITIO_BOA_VISTA_GLEBA_2");
});

test("exportarArea recusa formato desconhecido e camada sem geometria", async () => {
  await assert.rejects(exportarArea(GEO_SALGADA, "pdf", OP), /Formato de exportação desconhecido/);
  await assert.rejects(exportarArea([{ nome: "VAZIA", feicoes: [] }], "kml", OP), /Não há geometria/);
  // polígono de 2 pontos não é polígono: some, e a camada vazia também
  assert.equal(prepararCamadas([{ nome: "X", feicoes: [{ nome: "a", tipo: "poligono", utm: [[500000, 8700000], [500010, 8700000]] }] }], 24).length, 0);
});

test("KML: Document, pasta e estilo por camada, polígono anti-horário e um Placemark por vértice", async () => {
  const a = await exportarArea(GEO_SALGADA, "kml", OP);
  assert.equal(a.nome, "FAZENDA_SALGADA_VELHA.kml");
  assert.match(a.tipo, /kml/);
  const xml = dec(a.dados);
  xmlBemFormado(xml);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<kml xmlns="http:\/\/www.opengis.net\/kml\/2.2">/);
  assert.equal((xml.match(/<Document>/g) ?? []).length, 1);
  assert.deepEqual([...xml.matchAll(/<Folder><name>([^<]*)<\/name>/g)].map((m) => m[1]), ["PERIMETRO", "VERTICES"]);
  assert.equal((xml.match(/<Style id=/g) ?? []).length, 2);
  assert.equal((xml.match(/<Placemark>/g) ?? []).length, 1 + 32);
  assert.match(xml, /<Data name="area_ha"><value>6.7238<\/value><\/Data>/);
  assert.match(xml, /<Placemark><name>DSBN-M-4542<\/name>/);
  // o anel: fechado, anti-horário, e os mesmos pontos (lon, lat) da montagem
  const [anel, ...pontos] = coordenadasKml(xml);
  assert.equal(anel.length, 33);
  assert.deepEqual(anel[0], anel[32]);
  assert.ok(areaAssinada(anel.slice(0, -1)) > 0, "externo anti-horário");
  const per = GEO_SALGADA[0].feicoes[0];
  assert.deepEqual(new Set(anel.slice(0, -1).map(chave9)), new Set(per.geo.map(chave9)));
  // a altitude do vértice vai na terceira coordenada
  assert.equal(pontos.length, 32);
  const [[lon0, lat0]] = VERTICES_SALGADA[0].geo;
  assert.deepEqual(pontos[0][0], [Number(lon0.toFixed(9)), Number(lat0.toFixed(9)), Number(VERTICES_SALGADA[0].alt[0].toFixed(3))]);
});

test("KML com furo: furo horário dentro do externo; KMZ é o mesmo KML como doc.kml", async () => {
  const xml = dec((await exportarArea(SINTETICA, "kml", OP)).dados);
  xmlBemFormado(xml);
  const [ext, furo, rio] = coordenadasKml(xml);
  assert.ok(areaAssinada(ext.slice(0, -1)) > 0);
  assert.ok(areaAssinada(furo.slice(0, -1)) < 0);
  assert.match(xml, /<innerBoundaryIs>/);
  assert.equal(rio.length, 3);
  assert.match(xml, /GLEBA SÃO JOSÉ/);

  const kmz = await exportarArea(GEO_SALGADA, "kmz", OP);
  assert.equal(kmz.nome, "FAZENDA_SALGADA_VELHA.kmz");
  assert.equal(dec(kmz.dados.slice(0, 2)), "PK");
  const zip = await JSZip.loadAsync(kmz.dados);
  assert.deepEqual(Object.keys(zip.files), ["doc.kml"]);
  assert.equal(await zip.file("doc.kml").async("string"), gerarKmlArea(prepararCamadas(GEO_SALGADA, 24), OP.nome));
});

test("GPX 1.1: waypoint por vértice com nome e ele, perímetro como trilha fechada", async () => {
  const a = await exportarArea(GEO_SALGADA, "gpx", OP);
  assert.equal(a.nome, "FAZENDA_SALGADA_VELHA.gpx");
  const gpx = dec(a.dados);
  xmlBemFormado(gpx);
  assert.match(gpx, /<gpx version="1.1" creator="Vertces" xmlns="http:\/\/www.topografix.com\/GPX\/1\/1"/);
  const wpts = [...gpx.matchAll(/<wpt lat="([^"]+)" lon="([^"]+)">(.*?)<\/wpt>/g)];
  assert.equal(wpts.length, 32);
  const [[lon0, lat0]] = VERTICES_SALGADA[0].geo;
  assert.deepEqual([Number(wpts[0][2]), Number(wpts[0][1])], [Number(lon0.toFixed(9)), Number(lat0.toFixed(9))]);
  for (const w of wpts) assert.match(w[3], /^<ele>[\d.]+<\/ele><name>[^<]+<\/name>/);
  assert.match(wpts[0][3], /<name>DSBN-P-14300<\/name>/);
  // o esquema manda: todos os wpt antes da primeira trilha
  assert.ok(gpx.lastIndexOf("<wpt ") < gpx.indexOf("<trk>"));
  const trks = [...gpx.matchAll(/<trk>(.*?)<\/trk>/g)];
  assert.equal(trks.length, 1);
  const pts = [...trks[0][1].matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)">/g)].map((m) => [Number(m[2]), Number(m[1])]);
  assert.equal(pts.length, 33);
  assert.deepEqual(pts[0], pts[32], "a trilha do polígono fecha no primeiro ponto");

  // polígono com furo: dois segmentos na mesma trilha; linha: trilha aberta
  const s = dec((await exportarArea(SINTETICA, "gpx", OP)).dados);
  xmlBemFormado(s);
  const [tPol, tRio] = [...s.matchAll(/<trk>(.*?)<\/trk>/g)].map((m) => m[1]);
  assert.equal((tPol.match(/<trkseg>/g) ?? []).length, 2);
  assert.equal([...tRio.matchAll(/<trkpt /g)].length, 3);
});

test("DXF R12: camadas nomeadas — PERIMETRO, VERTICES, ROTULOS_VERTICES, SEGMENTOS e CONFRONTANTES", async () => {
  const a = await exportarArea(GEO_SALGADA, "dxf", OP);
  assert.equal(a.nome, "FAZENDA_SALGADA_VELHA_SIRGAS2000_UTM24S.dxf");
  const pares = paresDxf(dec(a.dados));
  assert.deepEqual(pares[0], ["0", "SECTION"]);
  assert.deepEqual(pares.at(-1), ["0", "EOF"]);
  assert.ok(pares.some(([c, v]) => c === "1" && v === "AC1009"), "versão R12");
  for (const s of ["HEADER", "TABLES", "ENTITIES"]) assert.ok(pares.some(([c, v]) => c === "2" && v === s), s);
  assert.equal(contar(pares, "SECTION"), contar(pares, "ENDSEC"));
  assert.deepEqual(camadasDxf(pares), ["PERIMETRO", "VERTICES", "ROTULOS_VERTICES", "SEGMENTOS", "CONFRONTANTES"]);
  const ents = entidadesDxf(pares);
  const de = (camada, tipo) => ents.filter((e) => e.camada === camada && e.tipo === tipo);
  // PERIMETRO: uma POLYLINE fechada com os 32 vértices, no UTM do anel (4 casas)
  assert.equal(contar(pares, "POLYLINE"), 1);
  assert.equal(contar(pares, "SEQEND"), 1);
  const [poli] = de("PERIMETRO", "POLYLINE");
  assert.equal(poli.g["70"], "1", "POLYLINE fechada");
  const per = GEO_SALGADA[0].feicoes[0];
  const vx = de("PERIMETRO", "VERTEX").map((e) => [Number(e.g["10"]), Number(e.g["20"])]);
  assert.equal(vx.length, 32);
  vx.forEach((p, i) => assert.ok(dist(p, per.utm[i]) < 1e-4, `vértice ${i}`));
  // VERTICES: POINT com a altitude no Z; ROTULOS_VERTICES: o nome de cada um
  const pts = de("VERTICES", "POINT");
  assert.equal(pts.length, 32);
  assert.equal(Number(pts[0].g["30"]), 360);
  assert.deepEqual(de("ROTULOS_VERTICES", "TEXT").map((e) => e.g["1"]), VERTICES_SALGADA.map((f) => f.nome));
  // SEGMENTOS: azimute e distância no meio de cada lado, girados no sentido dele
  const segs = de("SEGMENTOS", "TEXT");
  assert.equal(segs.length, 32);
  const calc = montarServico(entrada(), proj4);
  const s0 = calc.segs[0];
  assert.equal(segs[0].g["1"], `${s0.azimuteFmt.replace("°", "%%d")} - ${s0.distFmt} m`, "o mesmo azimute e distância do memorial");
  const a0 = per.utm[0], b0 = per.utm[1];
  const meio = [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2];
  assert.ok(dist([Number(segs[0].g["11"]), Number(segs[0].g["21"])], meio) < 5, "no meio do lado");
  let ang = (Math.atan2(b0[1] - a0[1], b0[0] - a0[0]) * 180) / Math.PI;
  if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
  assert.ok(Math.abs(Number(segs[0].g["50"] ?? 0) - ang) < 1e-3, "girado no sentido do lado");
  // CONFRONTANTES: um texto por trecho com confrontante (a estrada e a linha férrea)
  assert.deepEqual(de("CONFRONTANTES", "TEXT").map((e) => e.g["1"]).sort(), ["ESTRADA VICINAL", "LINHA FERREA"]);
  // furo: outra POLYLINE fechada na mesma camada; linha: POLYLINE aberta
  const s = paresDxf(gerarDxfArea(prepararCamadas(SINTETICA, 24)));
  assert.deepEqual(entidadesDxf(s).filter((e) => e.tipo === "POLYLINE").map((e) => [e.camada, e.g["70"]]), [["AREAS", "1"], ["AREAS", "1"], ["RIOS", "0"]]);
  assert.equal(textoDxf("Fazenda São José — 12°30' Nº 2"), "Fazenda Sao Jose - 12%%d30' No 2");
});

test("pacote CAD (.zip): o DXF, o .prj do SIRGAS 2000 / UTM do fuso e o LEIAME", async () => {
  const a = await exportarArea(GEO_SALGADA, "cad", OP);
  assert.equal(a.nome, "FAZENDA_SALGADA_VELHA_CAD_SIRGAS2000_UTM24S.zip");
  assert.equal(a.tipo, "application/zip");
  const zip = await JSZip.loadAsync(a.dados);
  const base = "FAZENDA_SALGADA_VELHA_SIRGAS2000_UTM24S";
  assert.deepEqual(Object.keys(zip.files).sort(), [`${base}.dxf`, `${base}.prj`, "LEIAME.txt"].sort());
  assert.equal(await zip.file(`${base}.dxf`).async("string"), gerarDxfArea(prepararCamadas(GEO_SALGADA, 24)));
  const prj = await zip.file(`${base}.prj`).async("string");
  assert.equal(prj, prjUtmSirgas2000(24));
  assert.match(prj, /^PROJCS\["SIRGAS_2000_UTM_Zone_24S",GEOGCS\["GCS_SIRGAS_2000"/);
  assert.match(prj, /PROJECTION\["Transverse_Mercator"\]/);
  assert.match(prj, /PARAMETER\["Central_Meridian",-39\.0\]/);
  assert.match(prj, /PARAMETER\["False_Northing",10000000\.0\]/);
  assert.match(prj, /UNIT\["Meter",1\.0\]\]$/);
  assert.notEqual(prj, PRJ_SIRGAS2000, "projetado, não o geográfico do shapefile");
  assert.match(prjUtmSirgas2000(22), /Central_Meridian",-51\.0/);
  const leiame = (await zip.file("LEIAME.txt").async("string")).replace(/^﻿/, "");
  for (const trecho of ["FAZENDA SALGADA VELHA", "05/11/2026", "SIRGAS 2000 / UTM zona 24S (EPSG:31984)", "meridiano central -39°", "metro", "AutoCAD", "QGIS", `${base}.dxf`, `${base}.prj`]) {
    assert.ok(leiame.includes(trecho), `LEIAME sem "${trecho}"`);
  }
  for (const camada of ["PERIMETRO", "VERTICES", "ROTULOS_VERTICES", "SEGMENTOS", "CONFRONTANTES"]) assert.match(leiame, new RegExp(`^  ${camada}$`, "m"));
  assert.ok(!/dwg/i.test(leiame), "DXF não é DWG");
  assert.ok(leiame.includes("\r\n"), "CRLF para o Bloco de Notas");
});

test("GeoJSON (RFC 7946): FeatureCollection em lon/lat, externo anti-horário e furo horário", async () => {
  const a = await exportarArea(GEO_SALGADA, "geojson", OP);
  assert.equal(a.nome, "FAZENDA_SALGADA_VELHA.geojson");
  assert.equal(a.tipo, "application/geo+json");
  const gj = JSON.parse(dec(a.dados));
  assert.equal(gj.type, "FeatureCollection");
  assert.equal(gj.features.length, 33);
  const pol = gj.features.find((f) => f.geometry.type === "Polygon");
  assert.deepEqual(pol.properties, { camada: "PERIMETRO", nome: "FAZENDA SALGADA VELHA", area_ha: 6.7238, perim_m: 1291.52, vertices: 32 });
  const anel = pol.geometry.coordinates[0];
  assert.equal(anel.length, 33);
  assert.deepEqual(anel[0], anel[32]);
  assert.ok(areaAssinada(anel.slice(0, -1)) > 0, "externo anti-horário");
  for (const [lon, lat] of anel) assert.ok(lon > -40 && lon < -38 && lat > -12 && lat < -11, "lon/lat, não UTM");
  const pt = gj.features.find((f) => f.geometry.type === "Point");
  assert.equal(pt.properties.camada, "VERTICES");
  assert.equal(pt.geometry.coordinates.length, 3, "o vértice leva a altitude");

  const s = JSON.parse(dec((await exportarArea(SINTETICA, "geojson", OP)).dados));
  const [ext, furo] = s.features[0].geometry.coordinates;
  assert.ok(areaAssinada(ext.slice(0, -1)) > 0);
  assert.ok(areaAssinada(furo.slice(0, -1)) < 0, "furo horário");
  assert.equal(s.features[1].geometry.type, "LineString");
  assert.equal(s.features[0].properties.nome, "GLEBA SÃO JOSÉ");
});

test("SHP: um conjunto por geometria no zip, lido de volta com as mesmas coordenadas e atributos", async () => {
  const a = await exportarArea(GEO_SALGADA, "shp", OP);
  assert.equal(a.nome, "FAZENDA_SALGADA_VELHA_SHP_SIRGAS2000.zip");
  const zip = await JSZip.loadAsync(a.dados);
  const base = "FAZENDA_SALGADA_VELHA";
  assert.deepEqual(Object.keys(zip.files).sort(), ["cpg", "dbf", "prj", "shp", "shx"].flatMap((x) => [`${base}_POLIGONOS.${x}`, `${base}_PONTOS.${x}`]).sort());
  assert.equal(await zip.file(`${base}_POLIGONOS.prj`).async("string"), PRJ_SIRGAS2000);
  assert.equal(await zip.file(`${base}_PONTOS.cpg`).async("string"), "UTF-8");

  const [pol] = await lerShp(zip, `${base}_POLIGONOS`);
  assert.equal(pol.geometry.type, "Polygon");
  const anel = pol.geometry.coordinates[0];
  assert.ok(areaAssinada(anel.slice(0, -1)) < 0, "externo horário, como a ESRI pede");
  const per = GEO_SALGADA[0].feicoes[0];
  assert.deepEqual(new Set(anel.slice(0, -1).map((p) => p.join(","))), new Set(per.geo.map((p) => p.join(","))), "coordenadas exatas (float64)");
  assert.equal(pol.properties.CAMADA, "PERIMETRO");
  assert.equal(pol.properties.NOME, "FAZENDA SALGADA VELHA");
  assert.equal(pol.properties.AREA_HA, 6.7238);
  assert.equal(pol.properties.PERIM_M, 1291.52);

  const pts = await lerShp(zip, `${base}_PONTOS`);
  assert.equal(pts.length, 32);
  const vs = VERTICES_SALGADA;
  pts.forEach((p, i) => {
    assert.deepEqual(p.geometry.coordinates, vs[i].geo[0]);
    assert.equal(p.properties.NOME, vs[i].nome);
    assert.equal(p.properties.TIPO, ANEL[i][3]);
    assert.equal(p.properties.E_UTM, Math.round(vs[i].utm[0][0] * 1000) / 1000);
    assert.equal(p.properties.ALTITUDE, Math.round(vs[i].alt[0] * 1000) / 1000);
  });

  // furo, linha e acento (UTF-8 com .cpg)
  const z2 = await JSZip.loadAsync((await exportarArea(SINTETICA, "shp", OP)).dados);
  const [g] = await lerShp(z2, `${base}_POLIGONOS`);
  assert.equal(g.geometry.coordinates.length, 2, "externo + furo num registro");
  assert.equal(g.properties.NOME, "GLEBA SÃO JOSÉ");
  const [rio] = await lerShp(z2, `${base}_LINHAS`);
  assert.equal(rio.geometry.type, "LineString");
  assert.equal(rio.geometry.coordinates.length, 3);
  assert.equal(z2.file(`${base}_PONTOS.shp`), null, "sem ponto, sem arquivo de pontos");
});

test("CSV de pontos (; e vírgula decimal) e TXT da coletora (P,E,N,Z,D): uma linha por vértice", async () => {
  const csv = await exportarArea(GEO_SALGADA, "csv", OP);
  assert.equal(csv.nome, "FAZENDA_SALGADA_VELHA_SIRGAS2000_UTM24S.csv");
  assert.deepEqual([...csv.dados.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM para o Excel");
  const linhas = dec(csv.dados).split("\r\n");
  assert.equal(linhas.pop(), "");
  assert.equal(linhas[0], "Nome;E;N;Latitude;Longitude;Altitude");
  assert.equal(linhas.length, 1 + 32);
  const vs = VERTICES_SALGADA;
  linhas.slice(1).forEach((l, i) => {
    const [nome, e, n, lat, lon, h] = l.split(";");
    assert.equal(nome, vs[i].nome);
    assert.match(e, /^\d{6},\d{3}$/);
    assert.match(n, /^\d{7},\d{3}$/);
    assert.match(lat, /^-\d+,\d{9}$/);
    assert.match(lon, /^-\d+,\d{9}$/);
    assert.ok(Math.abs(Number(e.replace(",", ".")) - vs[i].utm[0][0]) < 0.0006);
    assert.ok(Math.abs(Number(lat.replace(",", ".")) - vs[i].geo[0][1]) < 1e-9);
    assert.equal(h, vs[i].alt[0].toFixed(3).replace(".", ","));
  });

  const txt = await exportarArea(GEO_SALGADA, "txt", OP);
  assert.equal(txt.nome, "FAZENDA_SALGADA_VELHA_SIRGAS2000_UTM24S.txt");
  const t = dec(txt.dados).split("\r\n");
  assert.equal(t.pop(), "");
  assert.equal(t.length, 32, "sem cabeçalho");
  t.forEach((l, i) => {
    const [p, e, n, z, d] = l.split(",");
    assert.equal(l.split(",").length, 5);
    assert.equal(p, vs[i].nome);
    assert.equal(e, vs[i].utm[0][0].toFixed(3));
    assert.equal(n, vs[i].utm[0][1].toFixed(3));
    assert.equal(z, vs[i].alt[0].toFixed(3));
    assert.equal(d, ANEL[i][3], "descrição = tipo do marco");
  });
  // nome repetido não passa para a coletora
  const rep = await exportarArea([{ nome: "P", feicoes: [0, 1].map((i) => ({ nome: "MARCO 1", tipo: "ponto", utm: [[500000 + i, 8700000]] })) }], "txt", OP);
  assert.deepEqual(dec(rep.dados).split("\r\n").slice(0, 2).map((l) => l.split(",")[0]), ["MARCO1", "MARCO1-2"]);
});

// ======================================================================
// Coordenadas
// ======================================================================

test("ida e volta UTM → lon/lat → UTM erra menos de 1 mm, em todo fuso do Brasil", () => {
  let x = 12345;
  const aleatorio = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let fuso = 18; fuso <= 25; fuso++) {
    for (let k = 0; k < 60; k++) {
      const p = [166000 + aleatorio() * 668000, 6500000 + aleatorio() * 3490000];
      const volta = geoParaUtm(utmParaGeo(p, fuso), fuso);
      assert.ok(dist(p, volta) < 0.001, `fuso ${fuso}: ${dist(p, volta)} m`);
    }
  }
  // passando pelo texto do arquivo (9 casas de grau no KML)
  const per = GEO_SALGADA[0].feicoes[0];
  const [anel] = coordenadasKml(gerarKmlArea(prepararCamadas(GEO_SALGADA, 24), "X"));
  const utmDoKml = anel.slice(0, -1).map((g) => geoParaUtm([g[0], g[1]], 24));
  for (const u of per.utm) assert.ok(utmDoKml.some((v) => dist(u, v) < 0.001), "ponto do KML a menos de 1 mm do UTM");
  // feição só em UTM ganha o lon/lat; só em lon/lat (CAR) ganha o UTM
  const [c] = prepararCamadas([{ nome: "A", feicoes: [{ nome: "a", tipo: "poligono", utm: per.utm }] }], 24);
  c.feicoes[0].geo.forEach((g, i) => assert.ok(dist(geoParaUtm(g, 24), per.utm[i]) < 0.001));
  const [d] = prepararCamadas([{ nome: "B", feicoes: [{ nome: "b", tipo: "poligono", geo: per.geo }] }], 24);
  d.feicoes[0].utm.forEach((u, i) => assert.ok(dist(u, per.utm[i]) < 0.001));
  assert.equal(fusoDoMeio([[-39.3, -11.6], [-39.2, -11.5]]), 24);
  assert.equal(fusoDoMeio([[-51.5, -22], [-50.9, -22.1]]), 22);
  // o confrontante acompanha o lado quando um ponto inválido cai (e some do lado que perdeu o vizinho)
  const [q] = prepararCamadas([{ nome: "Q", feicoes: [{ nome: "q", tipo: "poligono", utm: [...quadrado(500000, 8700000, 10), [NaN, 0], [500000, 8700000]], confrontantes: ["A", "B", "C", "D", "E", "F"] }] }], 24);
  assert.deepEqual(q.feicoes[0].confrontantes, ["A", "B", "C", null]);
});

// ======================================================================
// Montagem das camadas
// ======================================================================

test("GEO sem glebas: o anel do memorial (horário, do vértice mais ao norte) e um ponto por vértice", () => {
  assert.deepEqual(GEO_SALGADA.map((c) => c.nome), ["PERIMETRO", "VERTICES"]);
  const [per] = GEO_SALGADA[0].feicoes;
  assert.equal(per.nome, "FAZENDA SALGADA VELHA");
  assert.deepEqual(per.props, { area_ha: 6.7238, perim_m: 1291.52, vertices: 32 });
  // ponto a ponto, o MESMO anel que o memorial e a planilha publicam
  const calc = montarServico(entrada(), proj4);
  assert.deepEqual(per.utm, calc.ring.map((v) => [v.eProj, v.nProj]));
  assert.deepEqual(per.geo, calc.ring.map((v) => [v.lonDeg, v.latDeg]));
  assert.ok(areaAssinada(per.utm) < 0, "sentido horário");
  assert.equal(Math.max(...per.geo.map((g) => g[1])), per.geo[0][1], "começa no mais ao norte");
  // confrontante por lado: do M até o próximo M (a estrada vai do 4 ao 5, a ferrovia do 15 ao 16)
  const ordemDe = (u) => ANEL.findIndex(([, e, n]) => Math.hypot(e - u[0], n - u[1]) < 0.05);
  const lados = per.confrontantes.map((t, i) => [ordemDe(per.utm[i]), ordemDe(per.utm[(i + 1) % 32]), t]).filter(([, , t]) => t);
  assert.deepEqual(lados.map(([a, b, t]) => `${Math.min(a, b)}-${Math.max(a, b)} ${t}`).sort(), ["14-15 LINHA FERREA", "3-4 ESTRADA VICINAL"]);
  const vs = VERTICES_SALGADA;
  assert.equal(vs.length, 32);
  assert.deepEqual(vs.map((v) => v.nome), ANEL.map((a) => a[4]), "nome = código definitivo");
  assert.deepEqual(vs[3].props, { tipo: "M", codigo: "DSBN-M-4542", num_txt: 4 });
  assert.deepEqual(contornoDoGeo(GEO_SALGADA), [per.geo]);
  assert.equal(textoConfrontante({ descritivo: "(MATR.1.234/CNS.00.810-2) JOÃO DA SILVA \\ CPF: 000.000.000-00" }), "JOÃO DA SILVA");
  assert.equal(textoConfrontante({ descritivo: "", apelido_txt: "roque" }), "roque");
  assert.equal(textoConfrontante({ descritivo: null, apelido_txt: null }), null);
});

test("GEO: código da prévia não é nome definitivo; vértice inserido usa o GMS digitado", () => {
  const conf = camadasDoGeo(linhasSalgada((i) => ({ codigo: `P-${i + 1}`, codigo_provisorio: true })), [], 24);
  assert.deepEqual(conf[1].feicoes.slice(0, 3).map((f) => f.nome), ["1", "2", "3"]);
  assert.equal(nomeDoVertice({ ordem: 4, num_txt: null, codigo: "V-1", codigo_provisorio: true, e: null, n: null, tipo: "V" }), "V-1");
  assert.equal(nomeDoVertice({ ordem: 4, num_txt: null, codigo: null, e: null, n: null, tipo: "V" }), "V5");
  assert.equal(nomeDoVertice({ ordem: 4, num_txt: 9, codigo: "PROV-V-0001", e: null, n: null, tipo: "V" }), "9");
  // vértice inserido à mão: o GMS manda (gerar-documentos), mesmo com E/N gravado
  const linhas = linhasSalgada();
  linhas.splice(5, 0, { ordem: 4.5, num_txt: null, e: 1, n: 1, h: 0, tipo: "V", codigo: null, inserido_manual: true, lat_gms: "11 29 0,000 S", lon_gms: "39 10 30,000 W" });
  const cs = camadasDoGeo(linhas, [], 24);
  const v = cs[1].feicoes.find((f) => f.props.tipo === "V");
  assert.ok(Math.abs(v.geo[0][1] - -(11 + 29 / 60)) < 1e-12);
  assert.ok(Math.abs(v.geo[0][0] - -(39 + 10.5 / 60)) < 1e-12);
  assert.equal(cs[0].feicoes[0].utm.length, 33);
});

test("GEO com partes (IBERA): camada PARTES com o nome de cada uma; o perímetro são as partes", () => {
  const cs = camadasDoGeo(linhasIbera(), GLEBAS_IBERA, 24);
  assert.deepEqual(cs.map((c) => c.nome), ["PERIMETRO", "PARTES", "VERTICES"]);
  const partes = cs[1].feicoes;
  assert.deepEqual(partes.map((f) => f.nome), ["PARTE 1", "PARTE 2"]);
  assert.deepEqual(partes.map((f) => f.props.vertices), [117, 18]);
  assert.deepEqual(cs[0].feicoes.map((f) => f.utm), partes.map((f) => f.utm));
  assert.equal(cs[2].feicoes.length, 135);
  assert.equal(contornoDoGeo(cs).length, 2);
  for (const f of partes) assert.ok(areaAssinada(f.utm) < 0, "cada parte no sentido horário");
  // só a primeira parte desenhada: a outra fica fora dos documentos — e daqui
  const so1 = camadasDoGeo(linhasIbera(), GLEBAS_IBERA.slice(0, 1), 24);
  assert.deepEqual(so1.map((c) => c.nome), ["PERIMETRO", "GLEBAS", "VERTICES"]);
  assert.equal(so1[2].feicoes.length, 117);
  assert.ok(so1[2].feicoes.every((f) => f.props.num_txt < 200));
});

test("GEO com glebas de divisa comum: perímetro externo pelas arestas de uma gleba só, e uma por gleba", () => {
  const cs = camadasDoGeo(linhasSalgada(), GLEBAS_SALGADA, 24, { nome: "FAZENDA SALGADA VELHA" });
  assert.deepEqual(cs.map((c) => c.nome), ["PERIMETRO", "GLEBAS", "VERTICES"]);
  const [externo] = cs[0].feicoes;
  assert.equal(cs[0].feicoes.length, 1);
  assert.deepEqual(externo.props, { area_ha: 6.7238, perim_m: 1291.52, vertices: 32 }, "o imóvel inteiro, sem a divisa interna");
  assert.deepEqual(externo.utm, GEO_SALGADA[0].feicoes[0].utm, "o mesmo anel do memorial");
  const glebas = cs[1].feicoes;
  assert.deepEqual(glebas.map((f) => f.nome), ["GLEBA A", "GLEBA 2"]);
  assert.deepEqual(glebas.map((f) => f.props.vertices), [17, 17]);
  const soma = glebas.reduce((s, f) => s + f.props.area_ha, 0);
  assert.ok(Math.abs(soma - 6.7238) < 0.0002, `soma das glebas ${soma}`);
  assert.equal(cs[2].feicoes.length, 32, "as glebas cobrem todos os vértices");
  assert.equal(contornoDoGeo(cs).length, 2, "o contorno conferido são os anéis das glebas");
  // a divisa interna ganha azimute e distância no DXF, uma vez só
  const pares = paresDxf(gerarDxfArea(prepararCamadas(cs, 24)));
  assert.deepEqual(camadasDxf(pares), ["PERIMETRO", "GLEBAS", "VERTICES", "ROTULOS_GLEBAS", "ROTULOS_VERTICES", "SEGMENTOS", "CONFRONTANTES"]);
  const ents = entidadesDxf(pares);
  assert.equal(ents.filter((e) => e.camada === "SEGMENTOS").length, 32 + 1);
  assert.deepEqual(ents.filter((e) => e.camada === "ROTULOS_GLEBAS").map((e) => e.g["1"]), ["GLEBA A", "GLEBA 2"]);
  // anel externo: nulo quando as arestas de fora não fecham um anel só
  assert.deepEqual(anelExterno([[0, 1, 2], [2, 3, 0]]).length, 4);
  assert.equal(anelExterno([[0, 1, 2], [3, 4, 5]]), null, "anéis separados não são um perímetro");
  // sem perímetro (menos de 3 vértices): nenhum polígono
  const dois = camadasDoGeo(linhasSalgada().slice(0, 2), [], 24);
  assert.equal(dois[0].feicoes.length, 0);
  assert.deepEqual(contornoDoGeo(dois), []);
  assert.deepEqual(contornoDasCamadas(dois), []);
});

test("loteamento: gleba com confrontantes, quadras, lotes, áreas, viário e os pontos com o nome da locação", () => {
  const { res } = projetoLoteamento();
  const cs = camadasDoLoteamento(res, GLEBA_LOT);
  assert.deepEqual(cs.map((c) => c.nome), ["GLEBA", "QUADRAS", "LOTES", "AREAS_PUBLICAS", "VIARIO", "VERTICES_GLEBA", "VERTICES_LOTES"]);
  const porNome = Object.fromEntries(cs.map((c) => [c.nome, c.feicoes]));
  assert.equal(porNome.GLEBA.length, 1);
  assert.deepEqual(porNome.GLEBA[0].utm, GLEBA_LOT.pts, "a gleba é o perímetro do serviço");
  assert.equal(porNome.GLEBA[0].confrontantes[0], "Estrada BA-001", "a estrada do projeto");
  assert.deepEqual(porNome.GLEBA[0].confrontantes.slice(1), GLEBA_LOT.confrontantes.slice(1), "o vizinho do levantamento");
  assert.equal(porNome.QUADRAS.length, res.quadras.length);
  assert.equal(porNome.LOTES.length, res.lotes.length);
  assert.ok(res.lotes.length > 0);
  const l0 = res.lotes.find((l) => l.id === porNome.LOTES[0].nome);
  assert.deepEqual(porNome.LOTES[0].props, { quadra: l0.quadra, numero: l0.numero, area_m2: Math.round(l0.area * 100) / 100 });
  assert.deepEqual(porNome.LOTES[0].utm[0], paraUtm(res.plano, l0.pol.ext[0]));
  assert.ok(porNome.VIARIO.length >= 1);
  assert.equal(porNome.AREAS_PUBLICAS.length, res.publicas.length);
  for (const a of porNome.AREAS_PUBLICAS) assert.ok(typeof a.props.tipo === "string");
  assert.equal(porNome.VERTICES_GLEBA.length, GLEBA_LOT.pts.length);
  // o ponto do arquivo tem o MESMO nome que a planta e o memorial usam — um por
  // posição: quadras encostadas dividem vértice, e a locação o repetia com dois nomes
  const mapa = nomesDosPontos(pontosDeLocacao(res, GLEBA_LOT, LOCACAO_PADRAO));
  assert.deepEqual(new Set(porNome.VERTICES_LOTES.map((p) => p.nome)), new Set(mapa.values()));
  assert.equal(porNome.VERTICES_LOTES.length, mapa.size);
  // no CAD: o que o loteamento já tinha, mais os rótulos e os confrontantes da gleba
  const camadas = camadasDxf(paresDxf(gerarDxfArea(prepararCamadas(cs, 24))));
  for (const c of ["GLEBA", "QUADRAS", "LOTES", "VIARIO", "VERTICES_GLEBA", "VERTICES_LOTES", "ROTULOS_QUADRAS", "ROTULOS_LOTES", "ROTULOS_VERTICES_GLEBA", "ROTULOS_VERTICES_LOTES", "CONFRONTANTES"]) {
    assert.ok(camadas.includes(c), `camada ${c}`);
  }
  assert.ok(!camadas.includes("SEGMENTOS"), "a distância do memorial do loteamento é a do plano, não a do UTM");
});

test("CAR: as camadas do SICAR em lon/lat, rios, vértices e o fuso do meio do imóvel", async () => {
  const p = projetoCarDemo();
  const res = calcularCar(p);
  const cs = camadasDoCar(p, res);
  assert.deepEqual(cs.map((c) => c.nome), ["AREA_IMOVEL", "RESERVA_LEGAL", "APP", "AREA_PRODUTIVA", "VEGETACAO_NATIVA", "RIOS", "VERTICES"]);
  const porNome = Object.fromEntries(cs.map((c) => [c.nome, c.feicoes]));
  assert.deepEqual(porNome.AREA_IMOVEL[0].geo, p.perimetro, "o imóvel exatamente como veio do KML");
  assert.equal(porNome.AREA_IMOVEL[0].props.area_ha, Math.round(res.area.imovel) / 1e4);
  assert.ok(porNome.RESERVA_LEGAL.length >= 1);
  const reserva = porNome.RESERVA_LEGAL.reduce((s, f) => s + f.props.area_ha, 0);
  assert.ok(Math.abs(reserva - res.area.reserva / 1e4) < 0.001);
  assert.equal(porNome.VERTICES.length, 20);
  assert.equal(fusoDoCar(p), 24);
  // DXF no fuso do meio: o perímetro volta ao KML ao converter de novo
  const pares = paresDxf(dec((await exportarArea(cs, "dxf", { fuso: fusoDoCar(p), nome: p.nome })).dados));
  assert.deepEqual(camadasDxf(pares), [
    "AREA_IMOVEL", "RESERVA_LEGAL", "AREA_PRODUTIVA", "VERTICES",
    "ROTULOS_RESERVA_LEGAL", "ROTULOS_AREA_PRODUTIVA", "ROTULOS_VERTICES", "SEGMENTOS",
  ], "camada vazia não vai ao CAD");
  const ents = entidadesDxf(pares);
  const vx = [];
  const i0 = ents.findIndex((e) => e.tipo === "POLYLINE" && e.camada === "AREA_IMOVEL");
  for (let i = i0 + 1; ents[i].tipo === "VERTEX"; i++) vx.push([Number(ents[i].g["10"]), Number(ents[i].g["20"])]);
  assert.equal(vx.length, 20);
  vx.forEach((u, k) => assert.ok(dist(utmParaGeo(u, 24), p.perimetro[k]) < 1e-8));
  assert.equal(ents.filter((e) => e.camada === "SEGMENTOS").length, 20, "azimute e distância de cada lado do imóvel");
});

// ======================================================================
// Função `entregar`, de ponta a ponta (Supabase falso)
// ======================================================================

register("./funcoes/ganchos.mjs", import.meta.url);
const { bancoNovo } = await import("./funcoes/supabase-falso.mjs");
const env = { SUPABASE_URL: "http://falso", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
let entregar;
globalThis.Deno = { serve: (h) => { entregar = h; }, env: { get: (k) => env[k] } };
await import("../supabase/functions/entregar/index.ts");

async function chamar(corpo) {
  const r = await entregar(new Request("http://funcao", {
    method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  }));
  if (r.status !== 200) return { status: r.status, corpo: await r.json() };
  return { status: 200, nome: decodeURIComponent(r.headers.get("x-nome-arquivo") ?? ""), tipo: r.headers.get("content-type"), dados: new Uint8Array(await r.arrayBuffer()) };
}

function banco({ modalidade = "completo", vertices = linhasSalgada(), glebas = [], temGlebas = false, extra = {} } = {}) {
  const b = bancoNovo();
  b.rpc.conferir_contorno = { ok: true };
  b.tabelas.servicos = [{ id: "s1", modalidade, tipo: "geo", tem_glebas: temGlebas, fuso_utm: 24, denominacao: "FAZENDA SALGADA VELHA", nome_arquivo_txt: "SALGADA.txt", ...extra }];
  b.tabelas.vertices = vertices.map((v) => ({ servico_id: "s1", ...v }));
  b.tabelas.glebas = glebas.map((g, i) => ({ servico_id: "s1", ordem: i, ...g }));
  return b;
}
const contornos = (b) => (b.chamadasRpc ?? []).filter((c) => c.nome === "conferir_contorno").map((c) => c.args.p_geojson);

test("entregar · GEO sem glebas: lê do banco, confere o contorno e devolve o KML", async () => {
  const b = banco();
  const r = await chamar({ servico_id: "s1", saida: "area", formato: "kml" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.nome, "FAZENDA_SALGADA_VELHA.kml");
  assert.match(r.tipo, /kml/);
  const xml = dec(r.dados);
  xmlBemFormado(xml);
  assert.equal((xml.match(/<Placemark>/g) ?? []).length, 33);
  const [mp] = contornos(b);
  assert.equal(mp.type, "MultiPolygon");
  assert.equal(mp.coordinates.length, 1);
  assert.equal(mp.coordinates[0][0].length, 33, "anel fechado com os 32 vértices");
});

test("entregar · GEO com glebas (IBERA): o contorno são os anéis das partes; sem tem_glebas, a tabela não é lida", async () => {
  const b = banco({ vertices: linhasIbera(), glebas: GLEBAS_IBERA, temGlebas: true, extra: { denominacao: "FAZENDA IBERA" } });
  const r = await chamar({ servico_id: "s1", saida: "area", formato: "dxf" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.nome, "FAZENDA_IBERA_SIRGAS2000_UTM24S.dxf");
  assert.equal(contornos(b)[0].coordinates.length, 2);
  const pares = paresDxf(dec(r.dados));
  assert.deepEqual(camadasDxf(pares).slice(0, 3), ["PERIMETRO", "PARTES", "VERTICES"]);
  assert.equal(contar(pares, "POLYLINE"), 4, "duas partes no PERIMETRO e duas em PARTES");
  // serviço sem glebas ligadas: o anel é a sequência do TXT, como nos documentos
  const b2 = banco({ vertices: linhasIbera(), glebas: GLEBAS_IBERA, temGlebas: false });
  assert.equal((await chamar({ servico_id: "s1", saida: "area", formato: "geojson" })).status, 200);
  assert.equal(contornos(b2)[0].coordinates.length, 1);
});

test("entregar · pacote CAD: DXF + .prj do fuso do serviço + LEIAME", async () => {
  banco({ extra: { fuso_utm: 24 } });
  const r = await chamar({ servico_id: "s1", saida: "area", formato: "cad" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.nome, "FAZENDA_SALGADA_VELHA_CAD_SIRGAS2000_UTM24S.zip");
  const zip = await JSZip.loadAsync(r.dados);
  assert.deepEqual(Object.keys(zip.files).sort(), ["FAZENDA_SALGADA_VELHA_SIRGAS2000_UTM24S.dxf", "FAZENDA_SALGADA_VELHA_SIRGAS2000_UTM24S.prj", "LEIAME.txt"]);
  assert.match(await zip.file("FAZENDA_SALGADA_VELHA_SIRGAS2000_UTM24S.prj").async("string"), /UTM_Zone_24S/);
});

test("entregar · formato inválido é 400 com a lista, antes de qualquer consulta", async () => {
  const b = banco();
  for (const formato of [undefined, "pdf", "dwg", 7]) {
    const r = await chamar({ servico_id: "s1", saida: "area", formato });
    assert.equal(r.status, 400);
    assert.match(r.corpo.erro, /Formato de exportação inválido.*kml, dxf, cad, gpx, shp, kmz, geojson, csv, txt/);
  }
  assert.deepEqual(b.chamadasRpc ?? [], [], "nem permissão nem contorno foram consultados");
});

test("entregar · mantém as travas: permissão, contorno recusado e serviço sem perímetro", async () => {
  const b = banco();
  b.rpc.tem_permissao = false;
  assert.equal((await chamar({ servico_id: "s1", saida: "area", formato: "kml" })).status, 403);

  const c = banco();
  c.rpc.conferir_contorno = { ok: false, motivo: "O desenho deste serviço não é mais o imóvel da primeira geração." };
  const r = await chamar({ servico_id: "s1", saida: "area", formato: "kml" });
  assert.equal(r.status, 409);
  assert.match(r.corpo.erro, /não é mais o imóvel/);

  banco({ vertices: linhasSalgada().slice(0, 2) });
  const s = await chamar({ servico_id: "s1", saida: "area", formato: "csv" });
  assert.equal(s.status, 422);
  assert.match(s.corpo.erro, /perímetro/);

  // serviço de outro escritório (a RLS esconde): 404, nada é gerado
  const d = banco();
  d.tabelas.servicos = [];
  assert.equal((await chamar({ servico_id: "s1", saida: "area", formato: "kml" })).status, 404);
  // GEO continua sem as saídas do CAR/loteamento
  banco();
  assert.equal((await chamar({ servico_id: "s1", saida: "planta" })).status, 400);
});

test("entregar · CAR: camadas do projeto gravado; TXT no fuso do meio do imóvel", async () => {
  const p = projetoCarDemo();
  const b = banco({ modalidade: "car", vertices: [], extra: { denominacao: "FAZENDA DEMO", fuso_utm: null } });
  b.tabelas.car_projetos = [{ servico_id: "s1", projeto: JSON.parse(JSON.stringify(p)) }];
  const g = await chamar({ servico_id: "s1", saida: "area", formato: "geojson" });
  assert.equal(g.status, 200, JSON.stringify(g.corpo));
  const gj = JSON.parse(dec(g.dados));
  assert.ok(gj.features.some((f) => f.properties.camada === "AREA_IMOVEL"));
  assert.ok(gj.features.some((f) => f.properties.camada === "RESERVA_LEGAL"));
  assert.equal(contornos(b)[0].coordinates.length, 1);
  const t = await chamar({ servico_id: "s1", saida: "area", formato: "txt" });
  assert.equal(t.nome, "FAZENDA_DEMO_SIRGAS2000_UTM24S.txt");
  assert.equal(dec(t.dados).trim().split("\r\n").length, 20);
});

test("entregar · loteamento: lotes no SHP; a área sai mesmo sem projeto gravado", async () => {
  const { projeto, res } = projetoLoteamento();
  const vertices = GLEBA_LOT.pts.map(([e, n], i) => ({ ordem: i, num_txt: i + 1, e, n, h: GLEBA_LOT.altitudes[i], tipo: "P", codigo: null, descritivo: null, apelido_txt: null, rotulo_txt: null, eh_via: false }));
  const b = banco({ modalidade: "loteamento", vertices, extra: { denominacao: "TESTE" } });
  b.tabelas.loteamentos = [{ servico_id: "s1", projeto }];
  const r = await chamar({ servico_id: "s1", saida: "area", formato: "shp" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.nome, "TESTE_SHP_SIRGAS2000.zip");
  const zip = await JSZip.loadAsync(r.dados);
  const pols = await lerShp(zip, "TESTE_POLIGONOS");
  assert.equal(pols.filter((f) => f.properties.CAMADA === "LOTES").length, res.lotes.length);
  assert.ok((await lerShp(zip, "TESTE_PONTOS")).length > 0);
  assert.equal(contornos(b).length, 1);
  // sem projeto gravado: a área (a gleba) sai; as outras saídas continuam pedindo o projeto
  const b2 = banco({ modalidade: "loteamento", vertices, extra: { denominacao: "TESTE" } });
  b2.tabelas.loteamentos = [];
  assert.equal((await chamar({ servico_id: "s1", saida: "area", formato: "kml" })).status, 200);
  assert.equal((await chamar({ servico_id: "s1", saida: "kml" })).status, 422);
});
