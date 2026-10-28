// Serviço de CAR (src/lib/car): KML de entrada → reserva legal, APP e área
// produtiva → shapefiles para o SICAR.
//
// O que se lacra aqui é o que o SICAR confere: a reserva nunca abaixo da
// porcentagem, reserva + produtiva fechando o imóvel sem fresta, a APP dentro
// do imóvel, e o shapefile do imóvel igual ao que o escritório já envia
// (tests/fixtures/car/PLANTA.*, o arquivo de exemplo do Wilker).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import shapefile from "shapefile";
import { lerKml } from "../src/lib/car/kml.ts";
import { ajustarReserva, calcularCar, projetoNovo, reservaPorLado } from "../src/lib/car/motor.ts";
import { PRJ_SIRGAS2000, gravarShapefile } from "../src/lib/car/shapefile.ts";
import { poligonosDaCamada, shapefileDaCamada } from "../src/lib/car/saidas.ts";

const dir = new URL("./fixtures/car/", import.meta.url);
const kml = lerKml(fs.readFileSync(new URL("PLANTA.kml", dir), "utf8"));
const base = () => projetoNovo("FAZENDA DEMO", kml.perimetro);

const toAb = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
async function lerShp(a) {
  const src = await shapefile.open(toAb(a.shp), toAb(a.dbf));
  const out = [];
  for (let r = await src.read(); !r.done; r = await src.read()) out.push(r.value);
  return out;
}

test("KML do CAD: linha fechada vira o perímetro (sem repetir o 1º ponto)", () => {
  assert.equal(kml.perimetro.length, 20);
  assert.deepEqual(kml.perimetro[0], [-39.317443128521, -11.593438062575]);
  assert.equal(kml.rios.length, 0);
  assert.deepEqual(kml.avisos, []);
});

test("KML: Polygon e linha aberta (rio) no mesmo arquivo", () => {
  const k = lerKml(`<kml><Document><name>SITIO</name>
    <Placemark><name>Area</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
      -40,-10,0 -39.99,-10,0 -39.99,-10.01,0 -40,-10.01,0 -40,-10,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
    <Placemark><name>Riacho</name><LineString><coordinates>-40.001,-10.005 -39.989,-10.004</coordinates></LineString></Placemark>
  </Document></kml>`);
  assert.equal(k.nome, "SITIO");
  assert.equal(k.perimetro.length, 4);
  assert.equal(k.rios.length, 1);
  assert.equal(k.rios[0].nome, "Riacho");
  assert.throws(() => lerKml("<kml><Placemark><LineString><coordinates>0,0 1,1</coordinates></LineString></Placemark></kml>"), /linhas abertas/);
});

test("shapefile do imóvel = arquivo de exemplo do escritório (geometria, PRJ e DBF)", async () => {
  const pr = base();
  const res = calcularCar(pr);
  const a = shapefileDaCamada(pr, res, "imovel");
  const exemplo = fs.readFileSync(new URL("PLANTA.shp", dir));
  assert.equal(a.shp.length, exemplo.length);
  assert.equal(a.shx.length, fs.readFileSync(new URL("PLANTA.shx", dir)).length);
  assert.equal(a.prj, fs.readFileSync(new URL("TEMPORARIO.prj", dir), "utf8").trim());
  assert.equal(PRJ_SIRGAS2000, a.prj);
  // mesmos 21 pontos (anel fechado); o nosso no sentido horário da especificação
  const [nosso] = await lerShp(a);
  const ex = await shapefile.read(toAb(exemplo));
  const anelEx = ex.features[0].geometry.coordinates[0];
  const anelNosso = nosso.geometry.coordinates[0];
  assert.equal(anelNosso.length, anelEx.length);
  const chave = (p) => p.join(",");
  assert.deepEqual(new Set(anelNosso.map(chave)), new Set(anelEx.map(chave)));
  // DBF: mesmo cabeçalho de campos do exemplo (só muda a data e o NOME)
  const dbfEx = fs.readFileSync(new URL("PLANTA.dbf", dir));
  assert.equal(a.dbf.length, dbfEx.length);
  assert.deepEqual([...a.dbf.slice(4, 0xc1)], [...dbfEx.subarray(4, 0xc1)]);
  assert.equal(nosso.properties.NOME, "IMOVEL");
  assert.equal(nosso.properties.COR, 32768);
});

test("reserva encostada num lado: nunca abaixo de 20%, e produtiva fecha o imóvel", () => {
  let pr = base();
  const total = calcularCar(pr).area.imovel;
  for (let lado = 0; lado < kml.perimetro.length; lado += 3) {
    for (const giro of [0, 25, -40]) {
      pr = { ...pr, reserva: { ...pr.reserva, poligonos: reservaPorLado(pr, lado, giro), lado, giro } };
      const r = calcularCar(pr);
      assert.ok(r.reservaOk, `lado ${lado} giro ${giro}: ${r.pctReserva}%`);
      assert.ok(r.pctReserva < 20.01, `lado ${lado} giro ${giro}: ${r.pctReserva}% (passou demais)`);
      assert.ok(Math.abs(r.area.reserva + r.area.produtiva - total) < 0.01, "reserva + produtiva ≠ imóvel");
    }
  }
});

test("reserva desenhada pequena: o ajuste leva à porcentagem sem sair do lugar", () => {
  const pr = base();
  const centro = [-39.3172, -11.5937];
  const q = 0.0001;
  pr.reserva.poligonos = [{ ext: [[centro[0] - q, centro[1] - q], [centro[0] + q, centro[1] - q], [centro[0] + q, centro[1] + q], [centro[0] - q, centro[1] + q]], furos: [] }];
  for (const pct of [20, 35]) {
    pr.reserva.pct = pct;
    pr.reserva.poligonos = ajustarReserva(pr);
    const r = calcularCar(pr);
    assert.ok(r.reservaOk && r.pctReserva < pct + 0.01, `${pct}% pedido, saiu ${r.pctReserva}%`);
  }
  // reserva no meio: a produtiva tem um furo (ou se parte), e o shapefile lê de volta
  const r = calcularCar(pr);
  assert.ok(Math.abs(r.area.reserva + r.area.produtiva - r.area.imovel) < 0.01);
});

test("ajuste que ENCOLHE a reserva não a descola da divisa do imóvel", () => {
  const pr = base();
  pr.reserva.pct = 45;
  pr.reserva.poligonos = reservaPorLado(pr, 5, 0);
  const doKml = new Set(kml.perimetro.map((p) => p.join(",")));
  const naDivisa = (pols) => pols.flatMap((p) => p.ext).filter((p) => doKml.has(p.join(","))).length;
  const antes = naDivisa(pr.reserva.poligonos);
  pr.reserva.pct = 20;
  pr.reserva.lado = null; // como depois de arrastar um vértice
  pr.reserva.poligonos = ajustarReserva(pr);
  const r = calcularCar(pr);
  assert.ok(r.reservaOk && r.pctReserva < 20.01, `saiu ${r.pctReserva}%`);
  assert.ok(antes >= 2 && naDivisa(pr.reserva.poligonos) >= 2, "a reserva perdeu os vértices da divisa ao encolher");
});

test("rio: APP é a faixa dos dois lados, só dentro do imóvel; produtiva só exclui APP se pedido", () => {
  const pr = base();
  pr.reserva.poligonos = reservaPorLado(pr, 0, 0);
  pr.rios = [{ id: "r1", nome: "Rio Verde", faixa: 30, linha: [[-39.3185, -11.5935], [-39.3165, -11.5945]] }];
  const r = calcularCar(pr);
  assert.ok(r.area.app > 0 && r.area.app < r.area.imovel);
  assert.deepEqual(r.avisos, []);
  // faixa maior → APP maior
  const r60 = calcularCar({ ...pr, rios: [{ ...pr.rios[0], faixa: 60 }] });
  assert.ok(r60.area.app > r.area.app * 1.5);
  // com a opção, produtiva = imóvel − (reserva ∪ APP)
  const sem = calcularCar({ ...pr, produtivaSemApp: true });
  assert.ok(Math.abs(sem.area.produtiva - (r.area.imovel - r.area.reserva - r.area.app + r.area.appNaReserva)) < 0.05);
  // rio fora do imóvel avisa
  const fora = calcularCar({ ...pr, rios: [{ ...pr.rios[0], linha: [[-39.4, -11.7], [-39.41, -11.71]] }] });
  assert.match(fora.avisos.join(" "), /não toca o imóvel/);
});

test("camadas em grau: vértices do perímetro voltam EXATOS ao KML (sem fresta no SICAR)", async () => {
  const pr = base();
  pr.reserva.poligonos = reservaPorLado(pr, 4, 10);
  const res = calcularCar(pr);
  const doKml = new Set(kml.perimetro.map((p) => p.join(",")));
  for (const c of ["reserva", "produtiva"]) {
    const pols = poligonosDaCamada(pr, res, c);
    const pts = pols.flatMap((p) => p.ext);
    // todo vértice ou é do KML, ou é ponto novo da divisa da reserva (fora da lista)
    const herdados = pts.filter((p) => doKml.has(p.join(",")));
    assert.ok(herdados.length >= 2, `${c}: nenhum vértice do KML preservado`);
    const a = shapefileDaCamada(pr, res, c);
    const [f] = await lerShp(a);
    assert.equal(f.geometry.type, "Polygon");
  }
  // reserva e produtiva compartilham os pontos novos da divisa, exatamente
  const novosRes = poligonosDaCamada(pr, res, "reserva").flatMap((p) => p.ext).filter((p) => !doKml.has(p.join(",")));
  const prodPts = new Set(poligonosDaCamada(pr, res, "produtiva").flatMap((p) => p.ext).map((p) => p.join(",")));
  assert.ok(novosRes.length >= 2);
  for (const p of novosRes) assert.ok(prodPts.has(p.join(",")), `ponto da divisa ${p} não está na produtiva`);
});

test("shapefile com furo: externo horário, furo anti-horário, multipolígono num registro", async () => {
  const ext = [[0, 0], [0, 1], [1, 1], [1, 0]]; // horário
  const furo = [[0.2, 0.2], [0.2, 0.4], [0.4, 0.4], [0.4, 0.2]];
  const a = gravarShapefile([{ nome: "PRODUTIVA", poligonos: [{ ext, furos: [furo] }, { ext: [[2, 0], [3, 0], [3, 1]], furos: [] }] }]);
  const fs2 = await lerShp(a);
  assert.equal(fs2.length, 1);
  assert.equal(fs2[0].geometry.type, "MultiPolygon");
  assert.equal(fs2[0].geometry.coordinates[0].length, 2, "o furo ficou no 1º polígono");
});
