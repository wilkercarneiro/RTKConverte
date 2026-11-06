// Terraplanagem, rodada 2 da revisão: resultado com erro não exporta, plataforma
// fora do levantamento é "incompleto", polígono em gravata é recusado, DXF com
// cota acima de 1000 m, hemisfério norte, vírgula na descrição e o cache do
// preparo (mudar só a cota não refaz as distâncias à borda).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calcularTerraplanagem, ErroTerraplanagem } from "../src/lib/terraplanagem/calculo.ts";
import { seCruza, areaAssinada } from "../src/lib/terraplanagem/geometria.ts";
import { areaAssinada as areaDoSistema } from "../src/lib/loteamento/geom.ts";
import { poligonoDoKml } from "../src/lib/terraplanagem/entrada.ts";
import { lerPontos } from "../src/lib/terraplanagem/pontos.ts";
import { projetoNovo } from "../src/lib/terraplanagem/modelo.ts";
import { terraplanagemParaDxf } from "../src/lib/terraplanagem/saidas.ts";
import { estadoDaEntrega } from "../src/lib/terraplanagem/textos.ts";

const E0 = 512000, N0 = 8590000;

function grade(lx, ly, passo, f, z0 = 0) {
  const pts = [];
  let k = 0;
  for (let y = 0; y <= ly + 1e-9; y += passo) for (let x = 0; x <= lx + 1e-9; x += passo) {
    pts.push({ nome: String(++k), e: E0 + x + (k % 7) * 1e-4, n: N0 + y + (k % 5) * 1e-4, z: z0 + f(x, y) });
  }
  return pts;
}
function projeto(pontos, ajustes = {}) {
  const p = projetoNovo("teste", pontos, { tipo: "arquivo", arquivo: "teste.txt" }, 24);
  return { ...p, ...ajustes, plataforma: { ...p.plataforma, ...(ajustes.plataforma ?? {}) }, cota: { ...p.cota, ...(ajustes.cota ?? {}) }, taludes: { ...p.taludes, ...(ajustes.taludes ?? {}) }, fatores: { ...p.fatores, ...(ajustes.fatores ?? {}) } };
}
const fixture = fs.readFileSync(new URL("./fixtures/terraplanagem/levantamento-declive.txt", import.meta.url), "utf8");
const exemplo = () => projetoNovo("Galpão", lerPontos(fixture).pontos, { tipo: "arquivo", arquivo: "x.txt" }, 24);

// ---------------------------------------------------------------- erro e entrega
test("entrega: com erro não há exportação nem 'pronto'; recalculando também não", () => {
  const r = calcularTerraplanagem(exemplo());
  const comErro = estadoDaEntrega({ r: null, erro: "Com 500 m de afastamento da borda não sobra plataforma.", ocupado: false, modo: "contorno", folga: 500 });
  assert.equal(comErro.podeExportar, false);
  assert.equal(comErro.tom, "pendente");
  assert.notEqual(comErro.acao, "pdf");
  assert.equal(comErro.acao, "recuo-automatico");
  // mesmo que a tela ainda tivesse um resultado velho, o erro manda
  assert.equal(estadoDaEntrega({ r, erro: "x", ocupado: false, modo: "retangulo", folga: null }).podeExportar, false);
  assert.equal(estadoDaEntrega({ r, erro: "x", ocupado: false, modo: "retangulo", folga: null }).acao, "contorno");
  assert.equal(estadoDaEntrega({ r, erro: null, ocupado: true, modo: "contorno", folga: null }).podeExportar, false);
  const ok = estadoDaEntrega({ r, erro: null, ocupado: false, modo: "contorno", folga: null });
  assert.deepEqual([ok.podeExportar, ok.tom, ok.acao], [true, "pronto", "pdf"]);
});

test("recuo de 500 m: o motor lança erro do usuário (a tela limpa o resultado)", () => {
  const pr = exemplo();
  assert.throws(() => calcularTerraplanagem({ ...pr, plataforma: { ...pr.plataforma, folga: 500 } }), (e) => e instanceof ErroTerraplanagem && /não sobra plataforma/.test(e.message));
});

// ---------------------------------------------------------------- incompleto
test("plataforma de 900 × 30 m saindo do levantamento: resultado incompleto, faixa pendente", () => {
  const pr = exemplo();
  const r0 = calcularTerraplanagem(pr);
  assert.equal(r0.incompleto, null, "o exemplo inteiro dentro não é incompleto");
  const c = r0.retangulo.centro;
  const r = calcularTerraplanagem({ ...pr, plataforma: { ...pr.plataforma, modo: "retangulo", retangulo: { centro: c, largura: 30, comprimento: 900, giro: 0 } } });
  assert.ok(r.incompleto, "devia marcar incompleto");
  assert.ok(r.incompleto.areaFora > 0.5 * 27000, `fora ${r.incompleto.areaFora}`);
  assert.match(r.incompleto.motivo, /fora do levantamento/);
  const e = estadoDaEntrega({ r, erro: null, ocupado: false, modo: "retangulo", folga: null });
  assert.equal(e.tom, "pendente");
  assert.equal(e.titulo, "A plataforma sai do levantamento");
  assert.equal(e.acao, "contorno");
});

test("talude além da borda acima de 5% da plataforma também é incompleto", () => {
  // terreno em rampa forte, plataforma encostada na borda, recuo zero
  const pts = grade(60, 60, 3, (x) => 0.4 * x, 100);
  const pr = projeto(pts, { plataforma: { folga: 0 } });
  const r = calcularTerraplanagem(pr);
  assert.ok(r.incompleto, JSON.stringify(r.avisos));
  assert.match(r.incompleto.motivo, /talude passa da borda/);
});

// ---------------------------------------------------------------- gravata e furo
const gravata = [[E0 + 10, N0 + 10], [E0 + 70, N0 + 70], [E0 + 70, N0 + 10], [E0 + 10, N0 + 70]];

test("seCruza: gravata cruza; quadrado, L côncavo e triângulo não", () => {
  assert.equal(seCruza(gravata), true);
  assert.equal(seCruza([[0, 0], [10, 0], [10, 10], [0, 10]]), false);
  assert.equal(seCruza([[0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]]), false);
  assert.equal(seCruza([[0, 0], [10, 0], [5, 8]]), false);
});

test("polígono em gravata é recusado pelo motor com a frase de redesenhar", () => {
  const pts = grade(80, 80, 4, () => 0, 300);
  const pr = projeto(pts, { plataforma: { modo: "poligono", poligono: gravata }, cota: { modo: "fixa", valor: 302 }, taludes: { corte: 0, aterro: 0 } });
  assert.throws(() => calcularTerraplanagem(pr), (e) => e instanceof ErroTerraplanagem && /se cruza/.test(e.message) && /Google Earth/.test(e.message));
});

const kml = (coords, furo = "") => `<?xml version="1.0"?><kml><Document><Placemark><name>Plat</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>${furo}</Polygon></Placemark></Document></kml>`;

test("KML: gravata recusada ao ler; furo avisado", () => {
  const g = "-38.5010,-12.9710,0 -38.5000,-12.9700,0 -38.5000,-12.9710,0 -38.5010,-12.9700,0 -38.5010,-12.9710,0";
  assert.throws(() => poligonoDoKml(kml(g), 24), /se cruza/);
  const q = "-38.5010,-12.9710,0 -38.5000,-12.9710,0 -38.5000,-12.9700,0 -38.5010,-12.9700,0 -38.5010,-12.9710,0";
  const semFuro = poligonoDoKml(kml(q), 24);
  assert.equal(semFuro.furoIgnorado, false);
  const furo = "<innerBoundaryIs><LinearRing><coordinates>-38.5007,-12.9707,0 -38.5003,-12.9707,0 -38.5003,-12.9703,0 -38.5007,-12.9707,0</coordinates></LinearRing></innerBoundaryIs>";
  const comFuro = poligonoDoKml(kml(q, furo), 24);
  assert.equal(comFuro.furoIgnorado, true);
  assert.equal(comFuro.utm.length, 4);
});

// ---------------------------------------------------------------- área: o motor do sistema
test("área da plataforma é a do motor do sistema (loteamento/restrições)", () => {
  const anel = [[E0, N0], [E0 + 30, N0], [E0 + 30, N0 + 20], [E0 + 12, N0 + 31], [E0, N0 + 20]];
  assert.equal(areaAssinada(anel), areaDoSistema(anel));
});

// ---------------------------------------------------------------- DXF acima de 1000 m
test("DXF: cota acima de 1000 m sai sem separador de milhar (Brasília, sul de Minas)", () => {
  const pts = grade(60, 60, 3, (x, y) => 0.05 * x + 0.03 * y, 1098);
  const pr = projeto(pts);
  const r = calcularTerraplanagem(pr);
  assert.ok(r.cota > 1000);
  const dxf = terraplanagemParaDxf(r, pr);
  // textos do DXF: pares (código, valor); cada TEXT leva a camada (8) e o texto (1)
  const l = dxf.split("\r\n");
  const textos = [];
  for (let i = 0; i + 1 < l.length; i += 2) {
    if (l[i].trim() === "0" && l[i + 1] === "TEXT") {
      const t = {};
      for (let j = i + 2; j + 1 < l.length && l[j].trim() !== "0"; j += 2) t[l[j].trim()] = l[j + 1];
      textos.push(t);
    }
  }
  const plat = textos.find((t) => t["8"] === "PLATAFORMA" && /^PLATAFORMA /.test(t["1"]));
  assert.ok(plat, "sem o rótulo da plataforma");
  const v = plat["1"].replace("PLATAFORMA ", "");
  assert.match(v, /^1\d{3}\.\d{2}$/);
  assert.ok(Math.abs(Number(v) - r.cota) < 0.01);
  // nenhum rótulo de curva mestra com ponto de milhar ("1.100" seria lido 1,1 no CAD)
  const mestras = textos.filter((t) => t["8"] === "TERRENO_CURVAS_MESTRAS").map((t) => t["1"]);
  assert.ok(mestras.length > 0, "sem rótulo de curva mestra");
  for (const t of mestras) assert.match(t, /^1\d{3}(\.\d)?$/, `rótulo ${t}`);
});

// ---------------------------------------------------------------- leitor
test("leitor: hemisfério norte (Roraima) dá a mensagem certa, com ou sem cabeçalho", () => {
  const sem = ["1 612003.12 250010.50 85.20", "2 612013.12 250010.50 85.70", "3 612013.12 250020.50 86.10", "4 612003.12 250020.50 85.90"].join("\n");
  const a = lerPontos(sem);
  assert.equal(a.pontos.length, 0);
  assert.match(a.avisos[0], /hemisfério norte/);
  const com = ["nome;E;N;cota", "1;612003.12;250010.50;85.20", "2;612013.12;250010.50;85.70", "3;612013.12;250020.50;86.10"].join("\n");
  const b = lerPontos(com);
  assert.equal(b.pontos.length, 0);
  assert.match(b.avisos[0], /hemisfério norte/);
});

test("leitor: tab, ponto decimal e descrição com vírgulas não vira número errado", () => {
  const t = [
    "1\t512003.123\t8590010.456\t312.811\tcerca, muro, poste",
    "2\t512013.123\t8590010.456\t312.100\tcanto, cerca, árvore, poste",
    "3\t512013.123\t8590020.456\t311.050\tTN",
    "4\t512003.123\t8590020.456\t310.700\tmuro, portão, poste",
  ].join("\n");
  const l = lerPontos(t);
  assert.equal(l.pontos.length, 4, JSON.stringify(l.avisos));
  assert.deepEqual([l.pontos[0].e, l.pontos[0].n, l.pontos[0].z], [512003.123, 8590010.456, 312.811]);
});

test("leitor: ponto e vírgula com vírgula decimal continua certo", () => {
  const t = ["M1;8634150,123;487320,456;312,811;cerca, muro", "M2;8634160,000;487330,000;312,100;TN", "M3;8634170,500;487310,250;311,050;TN"].join("\n");
  const l = lerPontos(t);
  assert.equal(l.pontos.length, 3);
  assert.deepEqual([l.pontos[0].e, l.pontos[0].n, l.pontos[0].z], [487320.456, 8634150.123, 312.811]);
});

// ---------------------------------------------------------------- cache do preparo
test("mudar só a cota fixa reaproveita o preparo: mesmo número e bem mais rápido", () => {
  const pts = grade(240, 240, 2, (x, y) => 0.06 * x + 0.02 * y + 0.5 * Math.sin(x / 17), 400); // ~14,6 mil pontos
  const base = projeto(pts, { cota: { modo: "fixa", valor: 410 } });
  calcularTerraplanagem(base); // TIN e preparo no cache
  const t0 = performance.now();
  const frio = calcularTerraplanagem({ ...base, taludes: { corte: 1.25, aterro: 1.75 } }); // taludes mudam: preparo novo
  const tFrio = performance.now() - t0;
  const t1 = performance.now();
  const quente = calcularTerraplanagem({ ...base, taludes: { corte: 1.25, aterro: 1.75 }, cota: { ...base.cota, valor: 410 } });
  const tQuente = performance.now() - t1;
  assert.equal(quente.corte, frio.corte);
  assert.equal(quente.aterro, frio.aterro);
  const outra = calcularTerraplanagem({ ...base, taludes: { corte: 1.25, aterro: 1.75 }, cota: { ...base.cota, valor: 411 } });
  assert.ok(outra.aterro > frio.aterro);
  assert.ok(tQuente < tFrio, `cache não ajudou: ${tQuente.toFixed(0)} ms × ${tFrio.toFixed(0)} ms`);
});
