// CAR com várias poligonais no arquivo (pedido de 27/11/2026): "o sistema só leu
// uma das poligonais, a maior — eu quero que leia as três, que o arquivo seja a
// área total com três glebas, e faça um único shape".
//
// Fixture tests/fixtures/car/TRES_GLEBAS.kml (gerada para o teste, imitando o caso real):
//   - GLEBA 01 (linha fechada do CAD) e GLEBA 02 (Polygon) se encostam; a divisa
//     comum da 02 vem de outro levantamento (1–2 cm fora) e com um vértice a mais;
//   - GLEBA 03 separada das outras por uma estrada de ~40 m;
//   - RESERVA LEGAL: polígono desenhado DENTRO da gleba 01 (não é gleba).
//
// O que se lacra: entram as 3 glebas (a reserva desenhada não), a área total é a
// soma delas sem fresta nem conta dupla na divisa comum, o AREA_IMOVEL sai num
// shapefile só com UM registro (2 partes: 01+02 unidas e a 03), os vértices do
// arquivo voltam exatos, nada cruza em grau (SICAR 3001), reserva/produtiva
// fecham a área total, e a sobreposição não corta uma gleba pela certificação da outra.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import shapefile from "shapefile";
import { lerKml } from "../src/lib/car/kml.ts";
import {
  aneisDoImovel, ajustarReserva, areasDasBases, calcularCar, normalizarProjetoCar, projetoNovo, reservaPorLado, temGlebas,
} from "../src/lib/car/motor.ts";
import { poligonosDaCamada, shapefileDaCamada, gerarKmlCar } from "../src/lib/car/saidas.ts";
import { arquivoDoCar, projetoCarDoBanco } from "../src/lib/car/entregas.ts";
import { ajustarSobreposicao } from "../src/lib/car/sobreposicao.ts";
import { textosDaAreaLevada } from "../src/lib/car/area_levada.ts";
import { camadasDoCar } from "../src/lib/exportar/car.ts";
import { medir } from "../src/lib/consulta/geometria.ts";
import { lerGpx } from "../src/lib/car/gpx.ts";

const kml = lerKml(fs.readFileSync(new URL("./fixtures/car/TRES_GLEBAS.kml", import.meta.url), "utf8"));

/** o projeto como o CarNovo monta: as marcadas, a 1ª no perímetro e as outras em glebas */
function projetoDasMarcadas(k = kml, marcadas = k.poligonos.map((p) => p.incluir)) {
  const [p1, ...outras] = k.poligonos.filter((_, i) => marcadas[i]);
  return projetoNovo(k.nome, p1.anel, k.rios, p1.nomes, outras.map((g) => ({ nome: g.nome, anel: g.anel })), p1.nome);
}

const toAb = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
const cruzamentos = (anel) => {
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
};

test("KML com 4 polígonos: as 3 glebas entram, a reserva desenhada dentro da gleba 01 fica de fora", () => {
  assert.equal(kml.nome, "FAZENDA TRES GLEBAS");
  assert.equal(kml.poligonos.length, 4);
  const porNome = Object.fromEntries(kml.poligonos.map((p) => [p.nome, p]));
  assert.equal(porNome["GLEBA 01"].incluir, true);
  assert.equal(porNome["GLEBA 02"].incluir, true);
  assert.equal(porNome["GLEBA 03"].incluir, true);
  assert.equal(porNome["RESERVA LEGAL"].incluir, false);
  assert.match(porNome["RESERVA LEGAL"].motivo, /dentro do polígono \d \(GLEBA 01\)/);
  // o maior continua sendo o perímetro (quem só usa um anel não muda)
  assert.equal(kml.perimetro, kml.poligonos[0].anel);
  assert.ok(kml.avisos.some((a) => /4 polígonos: 3 entraram como glebas da área total, num shapefile só/.test(a)), kml.avisos.join(" | "));
  assert.ok(!kml.avisos.some((a) => /usei o maior/.test(a)), "não diz mais que leu só o maior");
});

test("área total = as 3 glebas, sem fresta nem conta dupla na divisa comum (levantamentos de 1–2 cm de diferença)", () => {
  const pr = projetoDasMarcadas();
  assert.ok(temGlebas(pr));
  assert.equal(aneisDoImovel(pr).length, 3);
  const res = calcularCar({ ...pr, baseArea: "albers" });
  // 01+02 se encostam (viram um polígono só, a divisa comum some); a 03 é outra parte
  assert.equal(res.imovel.length, 2, "duas partes: 01+02 unidas e a 03");
  assert.equal(res.glebas.length, 3);
  for (const p of res.imovel) assert.equal(p.furos.length, 0, "a divisa de cm entre 01 e 02 não deixou fresta");
  const soma = res.glebas.reduce((s, g) => s + Math.abs(g.reduce((t, p, i) => t + p[0] * g[(i + 1) % g.length][1] - g[(i + 1) % g.length][0] * p[1], 0) / 2), 0);
  // a diferença de 1–2 cm ao longo de ~1,5 km da divisa comum é < 50 m² — nada de conta dupla nem buraco
  assert.ok(Math.abs(res.area.imovel - soma) < 50, `total ${res.area.imovel} × soma ${soma}`);
  // a área total na base UTM bate com o motor único (Consulta/SIGEF) das 3 glebas
  const utm = calcularCar({ ...pr, baseArea: "utm" }).area.imovel;
  assert.ok(Math.abs(utm - medir(aneisDoImovel(pr)).areaM2) < 50, `utm ${utm}`);
  assert.ok(Math.abs(areasDasBases(aneisDoImovel(pr)).utm - utm) < 1e-6);
  assert.ok(res.avisos.some((a) => /3 glebas formam 2 partes que não se encostam: a área total sai num shapefile só/.test(a)), res.avisos.join(" | "));
});

test("AREA_IMOVEL: um shapefile, UM registro com as 2 partes; vértices do arquivo exatos; nada cruza em grau", async () => {
  const pr = projetoDasMarcadas();
  const res = calcularCar(pr);
  const a = shapefileDaCamada(pr, res, "imovel");
  const src = await shapefile.open(toAb(a.shp), toAb(a.dbf));
  const regs = [];
  for (let r = await src.read(); !r.done; r = await src.read()) regs.push(r.value);
  assert.equal(regs.length, 1, "um registro só (a área total)");
  assert.equal(regs[0].geometry.type, "MultiPolygon");
  assert.equal(regs[0].geometry.coordinates.length, 2);
  // todo vértice do contorno externo (fora da divisa comum 01/02) sai com a coordenada EXATA do KML
  const saida = new Set(regs[0].geometry.coordinates.flatMap((pol) => pol[0]).map((p) => `${p[0]},${p[1]}`));
  const g3 = kml.poligonos.find((p) => p.nome === "GLEBA 03").anel;
  for (const p of g3) assert.ok(saida.has(`${p[0]},${p[1]}`), `vértice da gleba 03 ${p}`);
  const g1 = kml.poligonos.find((p) => p.nome === "GLEBA 01").anel;
  for (const k of [0, 1, 6, 7, 8]) assert.ok(saida.has(`${g1[k][0]},${g1[k][1]}`), `vértice ${k} da gleba 01`);
  for (const pol of poligonosDaCamada(pr, res, "imovel")) assert.deepEqual(cruzamentos(pol.ext), []);
});

test("reserva encostada num lado: 20% da área TOTAL, dentro da parte do lado; parte pequena demais avisa", () => {
  const pr = projetoDasMarcadas();
  const res0 = calcularCar(pr);
  // lado 0 = 1º lado da maior parte (01+02)
  const p = { ...pr, reserva: { ...pr.reserva, lado: 0, giro: 0, poligonos: reservaPorLado(pr, 0, 0) } };
  const res = calcularCar(p);
  assert.ok(res.reservaOk, `reserva ${res.pctReserva}%`);
  assert.ok(res.pctReserva < 20.01);
  // reserva + produtiva = área total (as duas partes)
  assert.ok(Math.abs(res.area.reserva + res.area.produtiva - res.area.imovel) < 0.05);
  // a gleba 03 inteira é produtiva (a reserva não pulou para ela)
  const ladosParte0 = res0.imovel[0].ext.length;
  assert.throws(() => reservaPorLado(pr, ladosParte0, 0), /Esta parte do imóvel tem .* a reserva pede/);
  // em grau, nada cruza (SICAR 3001)
  for (const c of ["reserva", "produtiva", "imovel"]) for (const pol of poligonosDaCamada(p, res, c))
    for (const anel of [pol.ext, ...pol.furos]) assert.deepEqual(cruzamentos(anel), [], c);
});

test("reserva desenhada em duas glebas + Ajustar: chega aos 20% da área total", () => {
  const pr = projetoDasMarcadas();
  // a reserva do CAD (dentro da 01) + um pedaço na gleba 03
  const desenhada = kml.poligonos.find((p) => p.nome === "RESERVA LEGAL").anel;
  const g3 = kml.poligonos.find((p) => p.nome === "GLEBA 03").anel;
  const p = { ...pr, reserva: { ...pr.reserva, poligonos: [{ ext: desenhada, furos: [] }, { ext: g3.slice(0, 3), furos: [] }] } };
  assert.equal(calcularCar(p).reserva.length, 2);
  const ajustada = { ...p, reserva: { ...p.reserva, poligonos: ajustarReserva(p) } };
  const res = calcularCar(ajustada);
  assert.ok(res.reservaOk && res.pctReserva < 20.01, `${res.pctReserva}%`);
  assert.ok(Math.abs(res.area.reserva + res.area.produtiva - res.area.imovel) < 0.05);
});

test("banco e servidor: as glebas sobrevivem ao normalizar; o zip e o KML saem com a área total", async () => {
  const pr = projetoDasMarcadas();
  const volta = projetoCarDoBanco(JSON.parse(JSON.stringify(pr)), "X");
  assert.equal(volta.glebas.length, 2);
  assert.equal(volta.nomeGleba, "GLEBA 01");
  assert.deepEqual(aneisDoImovel(volta), aneisDoImovel(pr));
  // projeto antigo (sem glebas) continua sem
  assert.equal(normalizarProjetoCar({ perimetro: pr.perimetro }, pr).glebas, undefined);
  const z = await arquivoDoCar("imovel", volta, {});
  assert.match(z.nome, /_AREA_IMOVEL\.zip$/);
  const k = gerarKmlCar(volta, calcularCar(volta));
  assert.equal((k.match(/<name>Área total do imóvel \d<\/name>/g) ?? []).length, 2, "as 2 partes");
  assert.equal((k.match(/<name>Gleba \d/g) ?? []).length, 3, "o contorno de cada gleba para conferir");
  // a Exportar a área: o imóvel com as 2 partes e os vértices das 3 glebas
  const cam = camadasDoCar(volta);
  assert.equal(cam.find((c) => c.nome === "AREA_IMOVEL").feicoes.length, 2);
  assert.equal(cam.find((c) => c.nome === "VERTICES").feicoes.length, aneisDoImovel(pr).flat().length);
});

test("desmarcar uma gleba tira ela da área total", () => {
  const marcadas = kml.poligonos.map((p) => p.incluir && p.nome !== "GLEBA 03");
  const pr = projetoDasMarcadas(kml, marcadas);
  const res = calcularCar(pr);
  assert.equal(aneisDoImovel(pr).length, 2);
  assert.equal(res.imovel.length, 1, "01+02 encostadas: um polígono só");
  // e uma só marcada = projeto de uma poligonal, como sempre foi
  const so1 = projetoDasMarcadas(kml, kml.poligonos.map((p) => p.nome === "GLEBA 01"));
  assert.equal(temGlebas(so1), false);
  assert.equal(so1.glebas, undefined);
});

test("sobreposição: a certificação de UMA gleba é o próprio imóvel (não corta a outra); o vizinho de verdade só corta a gleba que invade", () => {
  const pr = projetoDasMarcadas();
  const [g1, g2, g3] = aneisDoImovel(pr);
  // SIGEF da gleba 02 (o mesmo polígono) e um CAR vizinho invadindo a gleba 03 pela ponta
  const sigefG2 = { fonte: "sigef", codigo: "SIG-G2", rotulo: "SIGEF GLEBA 02", situacao: "Certificada", poligonos: [[g2]] };
  const c = g3[2];
  const vizinho = { fonte: "car", codigo: "BA-VIZ", rotulo: "CAR BA-VIZ", situacao: "Ativo",
    poligonos: [[[[c[0] - 0.001, c[1] - 0.001], [c[0] + 0.003, c[1] - 0.001], [c[0] + 0.003, c[1] + 0.003], [c[0] - 0.001, c[1] + 0.003]]]] };
  const a = ajustarSobreposicao(pr.perimetro, [sigefG2, vizinho], { outras: [g2, g3] });
  const item = (cod) => a.itens.find((i) => i.codigo === cod);
  assert.equal(item("SIG-G2").decisao, "proprio");
  assert.equal(item("BA-VIZ").decisao, "cortado");
  assert.ok(a.perimetro, "houve ajuste");
  assert.deepEqual(a.perimetro, g1, "a gleba 01 não foi tocada");
  assert.deepEqual(a.outras[0], g2, "a gleba 02 não foi tocada (o SIGEF dela é o próprio imóvel)");
  assert.notDeepEqual(a.outras[1], g3, "a gleba 03 perdeu a ponta invadida");
  assert.ok(a.restanteM2 < 0.01, `sobrou ${a.restanteM2} m²`);
  assert.ok(a.depoisM2 < a.antesM2);
});

test("área levada com várias partes: entrando todas, não diz que ficou parte de fora", () => {
  const aneis = aneisDoImovel(projetoDasMarcadas());
  const total = medir(aneis).areaM2;
  assert.equal(textosDaAreaLevada(aneis, total, { areaOrigemM2: total, partes: 3 }).linhaPartes, null);
  assert.match(textosDaAreaLevada(aneis.slice(0, 2), total, { areaOrigemM2: total, partes: 3 }).linhaPartes, /^Entraram 2 de 3 partes: .* A outra parte \(.*\) ficou de fora/);
});

test("GPX com várias trilhas fechadas: a maior entra; as outras vêm na lista, desligadas", () => {
  const trk = (pts) => `<trk><name>T</name><trkseg>${[...pts, pts[0]].map(([x, y]) => `<trkpt lon="${x}" lat="${y}"/>`).join("")}</trkseg></trk>`;
  const q = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d]];
  const g = lerGpx(`<gpx>${trk(q(-40, -10, 0.01))}${trk(q(-39.95, -10, 0.004))}</gpx>`);
  assert.equal(g.poligonos.length, 2);
  assert.deepEqual(g.poligonos.map((p) => p.incluir), [true, false]);
  assert.ok(g.avisos.some((a) => /marque-as na lista/.test(a)));
});

// ---------------------------------------------------------------- casos difíceis da divisa comum
// metros → grau perto do imóvel da fixture (a 1 m de lado o erro da conversão é desprezível)
const LAT0 = -11.62, LON0 = -39.33;
const g = ([x, y]) => [LON0 + x / (111320 * Math.cos((LAT0 * Math.PI) / 180)), LAT0 + y / 110574];
const quadra = (pts) => pts.map(g);

test("divisa com vértice só de um lado (T) e 2 cm de desencontro: um polígono só, sem fresta nem bico", () => {
  // A tem o lado direito reto de (500,0) a (500,400); B o mesmo lado, 2 cm para dentro de A, com um vértice no meio
  const A = quadra([[0, 0], [500, 0], [500, 400], [0, 400]]);
  const B = quadra([[499.98, 0.01], [900, 0], [900, 400], [499.99, 399.98], [499.985, 200]]);
  const pr = projetoNovo("T", A, [], undefined, [{ nome: "B", anel: B }]);
  const res = calcularCar({ ...pr, baseArea: "albers" });
  assert.equal(res.imovel.length, 1);
  assert.equal(res.imovel[0].furos.length, 0);
  // a área de cada gleba sozinha, no mesmo motor: a união é a soma (a fresta de 2 cm ao longo de 400 m é < 10 m²)
  const so = (anel) => calcularCar({ ...projetoNovo("1", anel), baseArea: "albers" }).area.imovel;
  assert.ok(Math.abs(res.area.imovel - (so(A) + so(B))) < 10, `${res.area.imovel} × ${so(A) + so(B)}`);
  // o contorno de fora: os 4 cantos + as 2 pontas da divisa (vértices do arquivo, exatos); o do meio da divisa sumiu
  const [contorno] = poligonosDaCamada(pr, res, "imovel");
  assert.equal(contorno.ext.length, 6);
  const doArquivo = new Set([...A, ...B].map((p) => `${p[0]},${p[1]}`));
  for (const p of contorno.ext) assert.ok(doArquivo.has(`${p[0]},${p[1]}`), `vértice ${p} não é do arquivo`);
  assert.ok(!res.avisos.some((a) => /vão|sobrepõem|cm uma da outra/.test(a)), res.avisos.join(" | "));
  for (const pol of poligonosDaCamada(pr, res, "imovel")) assert.deepEqual(cruzamentos(pol.ext), []);
});

test("glebas que se sobrepõem: a área conta uma vez só e o aviso diz quanto", () => {
  const A = quadra([[0, 0], [500, 0], [500, 400], [0, 400]]);
  const B = quadra([[450, 0], [900, 0], [900, 400], [450, 400]]); // 50 m × 400 m em cima de A
  const res = calcularCar({ ...projetoNovo("S", A, [], undefined, [{ nome: "B", anel: B }]), baseArea: "albers" });
  assert.equal(res.imovel.length, 1);
  const so = (anel) => calcularCar({ ...projetoNovo("1", anel), baseArea: "albers" }).area.imovel;
  const faixa = so(quadra([[450, 0], [500, 0], [500, 400], [450, 400]]));
  assert.ok(Math.abs(res.area.imovel - (so(A) + so(B) - faixa)) < 1, "a faixa comum conta uma vez");
  const aviso = res.avisos.find((a) => /se sobrepõem em/.test(a));
  assert.ok(aviso, res.avisos.join(" | "));
  const m2 = Number(aviso.match(/em ([\d.]+,\d\d) m²/)[1].replace(/\./g, "").replace(",", "."));
  assert.ok(Math.abs(m2 - faixa) < 1, `${m2} × ${faixa}`);
});

test("glebas quase encostadas (30 cm) sem divisa comum: duas partes e o aviso para conferir", () => {
  const A = quadra([[0, 0], [500, 0], [500, 400], [0, 400]]);
  const B = quadra([[500.3, 0], [900, 0], [900, 400], [500.3, 400]]);
  const res = calcularCar(projetoNovo("Q", A, [], undefined, [{ nome: "B", anel: B }]));
  assert.equal(res.imovel.length, 2);
  assert.ok(res.avisos.some((a) => /ficam a 30 cm uma da outra/.test(a)), res.avisos.join(" | "));
});

test("Consulta com o KML de glebas: as 3 entram como partes (a reserva desenhada não) e levar ao CAR leva as 3", async () => {
  const { areaDoArquivo } = await import("../src/lib/consulta/arquivo.ts");
  const r = areaDoArquivo("TRES_GLEBAS.kml", fs.readFileSync(new URL("./fixtures/car/TRES_GLEBAS.kml", import.meta.url), "utf8"));
  assert.equal(r.imovel.aneis.length, 3);
  assert.ok(r.avisos.some((a) => /4 polígonos: 3 entram como partes da mesma área \(1 dentro de outro ficou de fora\)/.test(a)), r.avisos.join(" | "));
  assert.ok(!r.avisos.some((a) => /lista de poligonais/.test(a)), "a Consulta não tem a lista do CAR");
});
