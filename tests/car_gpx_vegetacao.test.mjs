// CAR: entrada pelo GPX do GPS de mão e vegetação nativa cedida a outro imóvel.
//
// GPX: o arquivo de exemplo do Wilker é o do eTrex 10 (D:\GPXCAR, cópia em
// tests/fixtures/car/PONTOS.gpx): 9 pontos de passagem marcados na divisa, 218 a 226.
// Vegetação: excedente de mata que vira reserva legal de OUTRO imóvel
// (compensação, Código Florestal art. 66) — nunca sobre a reserva do próprio
// imóvel, fora da produtiva, com shapefile e KML próprios.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import JSZip from "jszip";
import shapefile from "shapefile";
import { lerKml } from "../src/lib/car/kml.ts";
import { anelSimples, lerGpx, metros, perimetroDosPontos } from "../src/lib/car/gpx.ts";
import {
  ajustarVegetacao, calcularCar, normalizarProjetoCar, projetoNovo, reservaPorLado, vegetacaoPorLado,
} from "../src/lib/car/motor.ts";
import { gerarKmlVegetacao, poligonosDaCamada, shapefileDaCamada, zipCompleto } from "../src/lib/car/saidas.ts";
import { areaPols, centroide, intersecao } from "../src/lib/loteamento/geom.ts";

const dir = new URL("./fixtures/car/", import.meta.url);
const kml = lerKml(fs.readFileSync(new URL("PLANTA.kml", dir), "utf8"));
const base = () => projetoNovo("FAZENDA DEMO", kml.perimetro);
const gpxEtrex = fs.readFileSync(new URL("PONTOS.gpx", dir), "utf8");

const toAb = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
async function lerShp(a) {
  const src = await shapefile.open(toAb(a.shp), toAb(a.dbf));
  const out = [];
  for (let r = await src.read(); !r.done; r = await src.read()) out.push(r.value);
  return out;
}
const sobreposta = (r) => (r.reserva.length && r.vegetacao.length ? areaPols(intersecao(r.reserva, r.vegetacao)) : 0);

/** Arestas que se cruzam no anel em grau (é o que o SICAR recusa com 3001). */
function cruzamentos(anel) {
  const n = anel.length, out = [];
  const x = (a, b, c, d) => {
    const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (den === 0) return false;
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
    const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
    return t > 1e-12 && t < 1 - 1e-12 && u > 1e-12 && u < 1 - 1e-12;
  };
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    if (x(anel[i], anel[(i + 1) % n], anel[j], anel[(j + 1) % n])) out.push([i, j]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// GPX
// ---------------------------------------------------------------------------

test("GPX do eTrex: os pontos de passagem viram o perímetro, na ordem da coleta", () => {
  const g = lerGpx(gpxEtrex);
  assert.equal(g.perimetro.length, 9);
  assert.deepEqual(g.nomes, ["218", "219", "220", "221", "222", "223", "224", "225", "226"]);
  assert.deepEqual(g.perimetro[0], [-39.195239, -11.487302]);
  assert.equal(g.pontos.length, 9);
  assert.ok(anelSimples(g.perimetro));
  assert.match(g.avisos.join(" "), /218 → 226/);
  const pr = projetoNovo("SITIO GPS", g.perimetro, g.rios, g.nomes);
  const r = calcularCar(pr);
  assert.ok(r.area.imovel > 5900 && r.area.imovel < 6100, `área ${r.area.imovel}`);
  assert.deepEqual(pr.nomesVertices, g.nomes);
});

test("GPX: pontos fora de ordem (sem horário) fecham pela numeração, sem cruzar", () => {
  const g = lerGpx(gpxEtrex);
  const pts = g.pontos.map((p, i) => ({ ...p, nome: String(i + 1), tempo: null }));
  // embaralhado: a ordem do arquivo cruza o contorno
  const fora = [pts[4], pts[0], pts[7], pts[2], pts[8], pts[1], pts[6], pts[3], pts[5]];
  assert.ok(!anelSimples(fora.map((p) => [p.lon, p.lat])));
  const r = perimetroDosPontos(fora);
  assert.ok(r.simples);
  assert.equal(r.criterio, "ordem do número do ponto");
  assert.deepEqual(r.nomes, ["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
});

test("GPX: ponto marcado duas vezes no mesmo lugar sai (o SICAR recusa vértice colado)", () => {
  const dobrado = gpxEtrex.replace("</gpx>", "<wpt lat=\"-11.487512\" lon=\"-39.1952261\"><time>2025-08-09T13:24:00Z</time><name>227</name></wpt></gpx>");
  const g = lerGpx(dobrado);
  assert.equal(g.perimetro.length, 9);
  assert.match(g.avisos.join(" "), /repetido/);
  for (let i = 0; i < g.perimetro.length; i++) assert.ok(metros(g.perimetro[i], g.perimetro[(i + 1) % g.perimetro.length]) >= 1);
});

test("GPX de trilha: o caminho andado fecha sozinho, simplificado sem vértice colado", () => {
  // contorno de 200 × 120 m andado com um ponto a cada 0,8 m e tremido de 10 cm
  const pts = [];
  const lat0 = -11.5, lon0 = -39.2, dx = 1 / (111320 * Math.cos((lat0 * Math.PI) / 180)), dy = 1 / 110574;
  const canto = [[0, 0], [200, 0], [200, 120], [0, 120]];
  for (let k = 0; k < 4; k++) {
    const a = canto[k], b = canto[(k + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < L; s += 0.8) {
      const t = s / L, j = Math.sin(s * 7.3) * 0.1;
      pts.push([lon0 + (a[0] + (b[0] - a[0]) * t + j) * dx, lat0 + (a[1] + (b[1] - a[1]) * t + j) * dy]);
    }
  }
  pts.push([pts[0][0] + 3 * dx, pts[0][1] + 2 * dy]); // termina a 3,6 m do começo
  const gpx = `<?xml version="1.0"?><gpx version="1.1" creator="teste"><trk><name>Divisa</name><trkseg>${pts.map(([lon, lat]) => `<trkpt lat="${lat}" lon="${lon}"><ele>300</ele></trkpt>`).join("")}</trkseg></trk></gpx>`;
  const g = lerGpx(gpx);
  assert.equal(g.pontos, null);
  assert.ok(g.perimetro.length >= 4 && g.perimetro.length < 60, `${g.perimetro.length} vértices`);
  assert.match(g.avisos.join(" "), /simplificada/);
  const r = calcularCar(projetoNovo("TRILHA", g.perimetro));
  assert.ok(Math.abs(r.area.imovel - 24000) < 150, `área ${r.area.imovel}`);
});

test("KML só de pontos (o GPX aberto no Google Earth) também vira perímetro", () => {
  const g = lerGpx(gpxEtrex);
  const k = lerKml(`<kml><Document><name>Pontos</name>${g.pontos.map((p) => `<Placemark><name>${p.nome}</name><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`).join("")}</Document></kml>`);
  assert.equal(k.perimetro.length, 9);
  assert.deepEqual(k.nomes, g.nomes);
});

test("GPX sem nada aproveitável dá erro claro", () => {
  assert.throws(() => lerGpx("<gpx><wpt lat=\"-11\" lon=\"-39\"><name>1</name></wpt></gpx>"), /pelo menos 3/);
  assert.throws(() => lerGpx("<kml></kml>"), /não é um GPX/);
});

// ---------------------------------------------------------------------------
// Vegetação nativa
// ---------------------------------------------------------------------------

test("vegetação encostada num lado: área pedida, fora da reserva, e as camadas fecham o imóvel", () => {
  let pr = base();
  pr.reserva.poligonos = reservaPorLado(pr, 0, 0);
  pr.reserva.lado = 0;
  const total = calcularCar(pr).area.imovel;
  pr.vegetacao.alvoHa = Math.round((total * 0.15) / 100) / 100;
  assert.throws(() => vegetacaoPorLado({ ...pr, vegetacao: { ...pr.vegetacao, alvoHa: null } }, 5, 0), /área a ceder/);
  for (const lado of [0, 5, 10]) for (const giro of [0, 20]) {
    pr = { ...pr, vegetacao: { ...pr.vegetacao, poligonos: vegetacaoPorLado(pr, lado, giro), lado, giro } };
    const r = calcularCar(pr);
    assert.ok(r.vegetacaoOk, `lado ${lado} giro ${giro}: ${r.area.vegetacao} m² < ${pr.vegetacao.alvoHa} ha`);
    assert.ok(r.area.vegetacao < pr.vegetacao.alvoHa * 1e4 + 5, `lado ${lado}: passou demais (${r.area.vegetacao})`);
    assert.ok(r.reservaOk, "a vegetação comeu a reserva");
    assert.ok(sobreposta(r) < 0.01, "vegetação sobre a reserva");
    assert.ok(Math.abs(r.area.reserva + r.area.vegetacao + r.area.produtiva - total) < 0.05, `lado ${lado}: reserva + vegetação + produtiva ≠ imóvel`);
  }
});

test("vegetação desenhada por cima da reserva: só o excedente conta; ajustar leva à área pedida", () => {
  const pr = base();
  pr.reserva.poligonos = reservaPorLado(pr, 0, 0);
  const res0 = calcularCar(pr);
  const [cx, cy] = res0.plano.de(centroide(res0.reserva[0].ext));
  const q = 0.0012;
  pr.vegetacao.poligonos = [{ ext: [[cx - q, cy - q], [cx + q, cy - q], [cx + q, cy + q], [cx - q, cy + q]], furos: [] }];
  const r = calcularCar(pr);
  assert.ok(r.area.vegetacao > 0);
  assert.match(r.avisos.join(" "), /caíam na reserva legal/);
  assert.ok(sobreposta(r) < 0.01);
  for (const ha of [0.3, 0.6]) {
    pr.vegetacao.alvoHa = ha;
    pr.vegetacao.poligonos = ajustarVegetacao(pr);
    const r2 = calcularCar(pr);
    assert.ok(r2.vegetacaoOk && r2.area.vegetacao < ha * 1e4 + 5, `${ha} ha pedido, saiu ${r2.area.vegetacao} m²`);
    assert.ok(r2.reservaOk && sobreposta(r2) < 0.01);
  }
});

test("vegetação: shapefile VEGETACAO_NATIVA e KML com a área e o imóvel beneficiado", async () => {
  const pr = base();
  pr.reserva.poligonos = reservaPorLado(pr, 0, 0);
  pr.vegetacao.alvoHa = 0.25;
  pr.vegetacao.beneficiado = { nome: "FAZENDA BOA ESPERANÇA & CIA", car: "BA-2905206-ABC" };
  pr.vegetacao.poligonos = vegetacaoPorLado(pr, 8, 0);
  const res = calcularCar(pr);
  const [f] = await lerShp(shapefileDaCamada(pr, res, "vegetacao"));
  assert.equal(f.properties.NOME, "VEGETACAO");
  const kmlVeg = gerarKmlVegetacao(pr, res, { municipio: "Campo Formoso", uf: "BA", proprietario: "PAULO" });
  assert.match(kmlVeg, /FAZENDA BOA ESPERANÇA &amp; CIA/);
  assert.match(kmlVeg, /BA-2905206-ABC/);
  assert.match(kmlVeg, /<Data name="Área \(ha\)"><value>0,2500<\/value>/);
  assert.match(kmlVeg, /<Data name="Área \(m²\)"><value>2\.500,\d\d<\/value>/);
  assert.match(kmlVeg, /Campo Formoso\/BA/);
  assert.ok(lerKml(kmlVeg).perimetro.length >= 3, "o KML abre de volta");
  // zip completo leva o shapefile e o KML da vegetação
  const zip = await JSZip.loadAsync(await (await zipCompleto(pr, res)).arrayBuffer());
  const nomes = Object.keys(zip.files);
  assert.ok(nomes.some((n) => /VEGETACAO_NATIVA\/VEGETACAO_NATIVA\.shp$/.test(n)), nomes.join(", "));
  assert.ok(nomes.some((n) => /_VEGETACAO_NATIVA\.kml$/.test(n)));
  const semVeg = { ...pr, vegetacao: { ...pr.vegetacao, poligonos: [] } };
  assert.throws(() => gerarKmlVegetacao(semVeg, calcularCar(semVeg)), /Não há vegetação/);
});

test("vegetação e produtiva em grau sem aresta cruzada (SICAR 3001)", () => {
  const pr = base();
  pr.reserva.poligonos = reservaPorLado(pr, 0, 0);
  pr.vegetacao.alvoHa = 0.3;
  const lados = calcularCar(pr).imovel.ext.length;
  let testados = 0;
  for (let lado = 1; lado < lados; lado += 2) for (const giro of [-30, 0, 30]) {
    let p;
    try { p = { ...pr, vegetacao: { ...pr.vegetacao, lado, giro, poligonos: vegetacaoPorLado(pr, lado, giro) } }; } catch { continue; }
    testados++;
    const res = calcularCar(p);
    for (const c of ["vegetacao", "produtiva"]) for (const pol of poligonosDaCamada(p, res, c))
      for (const anel of [pol.ext, ...pol.furos])
        assert.deepEqual(cruzamentos(anel), [], `${c}, lado ${lado}, giro ${giro}`);
  }
  assert.ok(testados > 10);
});

test("projeto antigo do banco (sem vegetação) abre com a vegetação vazia e a conta de antes", () => {
  const antigo = { ...base() };
  delete antigo.vegetacao;
  const p = normalizarProjetoCar(antigo, base());
  assert.deepEqual(p.vegetacao.poligonos, []);
  assert.equal(p.vegetacao.alvoHa, null);
  const r = calcularCar(p);
  assert.equal(r.area.vegetacao, 0);
  assert.ok(Math.abs(r.area.produtiva - r.area.imovel) < 0.01);
});
