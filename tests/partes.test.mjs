// Imóvel em PARTES: TXT em blocos de numeração (o RUY.txt vem 1–75, 100–123,
// 200–228 — três anéis separados por estradas). Um anel só cruzava a si mesmo;
// cada parte tem de ser calculada, listada e desenhada como o anel que é.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarPartes, montarServico } from "../supabase/functions/_shared/servico.ts";
import { blocosPorNumeracao, unirEmBlocos } from "../supabase/functions/_shared/certificados.ts";
import { dadosDasPartes } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { buildDocumentXml } from "../supabase/functions/_shared/docx.ts";
import { GEO_DEF, utmDef } from "../supabase/functions/_shared/geo.ts";
import { ANEL, dadosPlantaDe, entrada } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const nums = (arr) => arr.map((num) => ({ num }));

test("blocosPorNumeracao: centena com salto abre bloco; bloco curto gruda no anterior", () => {
  const ruy = [...Array.from({ length: 75 }, (_, i) => i + 1), 100, ...Array.from({ length: 22 }, (_, i) => 102 + i), ...Array.from({ length: 29 }, (_, i) => 200 + i)];
  const b = blocosPorNumeracao(nums(ruy));
  assert.equal(b.length, 3);
  assert.deepEqual(b.map((x) => x.length), [75, 23, 29]);
  assert.deepEqual(b.map((x) => ruy[x[0]]), [1, 100, 200]);
  // numeração contínua que passa pelo 100 não é parte nova
  assert.equal(blocosPorNumeracao(nums(Array.from({ length: 120 }, (_, i) => i + 1))).length, 1);
  // um "200" solto no fim não é anel: volta para o bloco anterior
  assert.deepEqual(blocosPorNumeracao(nums([1, 2, 3, 4, 100, 101, 102, 200])).map((x) => x.length), [4, 4]);
  // bloco novo só abre se o anterior já tem 3 pontos
  assert.deepEqual(blocosPorNumeracao(nums([1, 2, 100, 101, 102])).map((x) => x.length), [5]);
});

// Duas partes: o anel da SALGADA VELHA e uma cópia 2 km a leste, numerada 101+
function inputDuasPartes() {
  const base = entrada({ comCodigo: false });
  const n = base.vertices.length;
  const copia = base.vertices.map((v) => ({ ...v, ordem: v.ordem + n, numTxt: 100 + v.numTxt, e: v.e + 2000 }));
  return { input: { ...base, vertices: [...base.vertices, ...copia] }, ordensA: base.vertices.map((v) => v.ordem), ordensB: copia.map((v) => v.ordem) };
}

test("montarPartes: cada parte é um anel próprio, os códigos continuam de uma para a outra e a área soma", () => {
  const { input, ordensA, ordensB } = inputDuasPartes();
  const so = montarServico({ ...entrada({ comCodigo: false }) }, proj4);
  const r = montarPartes(input, [{ nome: "PARTE 1", ordens: ordensA }, { nome: "PARTE 2", ordens: ordensB }], proj4);
  assert.equal(r.partes.length, 2);
  assert.ok(Math.abs(r.partes[0].calc.areaHa - so.areaHa) < 1e-9, "a parte 1 é o anel de sempre");
  // a cópia deslocada 2 km arredonda o GMS de outro jeito: a área difere em metros quadrados, não mais
  assert.ok(Math.abs(r.areaHa - 2 * so.areaHa) < 2 * so.areaHa * 1e-3, `soma ${r.areaHa} vs ${2 * so.areaHa}`);
  assert.ok(Math.abs(r.perimetroM - 2 * so.perimetroM) < 1, `perímetro ${r.perimetroM} vs ${2 * so.perimetroM}`);
  // códigos: a parte 2 continua onde a 1 parou (nenhum código repetido)
  const cods = r.partes.flatMap((p) => p.calc.ring.map((v) => v.codigo));
  assert.equal(new Set(cods).size, cods.length);
  const maxP1 = Math.max(...r.partes[0].calc.ring.filter((v) => v.tipo === "P").map((v) => Number(v.codigo.split("-")[2])));
  const minP2 = Math.min(...r.partes[1].calc.ring.filter((v) => v.tipo === "P").map((v) => Number(v.codigo.split("-")[2])));
  assert.equal(minP2, maxP1 + 1);
  assert.deepEqual(r.contadoresFinais, { M: so.contadoresFinais.M * 2, P: so.contadoresFinais.P * 2, V: 0 });
  // cada parte fecha os trechos dentro dela: a última linha da ODS da parte 2 não aponta para a parte 1
  assert.equal(r.partes[1].calc.linhasOds.length, ordensB.length);
});

test("planta geral em partes: dois anéis desenhados, dois blocos de identificação, nenhum rótulo dentro de parte alguma", async () => {
  const { input, ordensA, ordensB } = inputDuasPartes();
  const r = montarPartes(input, [{ nome: "PARTE 1", ordens: ordensA }, { nome: "PARTE 2", ordens: ordensB }], proj4);
  const dp = dadosDasPartes(r.partes, { denominacao: "FAZENDA SALGADA VELHA", detentor_nome: "FULANO", detentor_cpf: "000.000.000-00", matricula: "1", cns: "2" });
  assert.equal(dp.geometria.vertices.length, ordensA.length + ordensB.length);
  assert.equal(dp.partes.length, 2);
  assert.equal(dp.glebas.length, 2);
  const diag = {};
  const pdf = await gerarPlantaPdf(dadosPlantaDe(dp.geometria, { partes: dp.partes, glebas: dp.glebas }), diag);
  assert.ok(pdf.length > 10000);
  assert.equal(diag.rotulosGleba.length, 2, "um bloco de identificação por parte");
  assert.equal(diag.divisasGleba.length, 0, "em partes as linhas saem dos anéis, não do laço das glebas");
  assert.equal(diag.dentroDoImovel, 0);
  // os marcos verdes (um por M) saem nas duas partes: 4 M em cada anel
  assert.equal(diag.marcos.length, 8);
  // o polígono geral (costura entre as partes) NÃO existe: cada obstáculo de anel
  // liga dois vértices da mesma parte — nenhum segmento azul cruza os 2 km de vão
  const largos = diag.obstaculos.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 0.6 * Math.hypot(diag.poligono[0].x - diag.poligono[1].x, 1) * 50);
  assert.ok(largos.length < 3, `segmentos suspeitos: ${largos.length}`);
});

test("memorial em partes: um título e uma descrição por parte", () => {
  const { input, ordensA, ordensB } = inputDuasPartes();
  const r = montarPartes(input, [{ nome: "PARTE 1", ordens: ordensA }, { nome: "PARTE 2", ordens: ordensB }], proj4);
  const xml = buildDocumentXml({
    imovel: "X", proprietario: "Y", cpfProprietario: "1", municipio: "M", uf: "BA", matricula: "1", comarca: "", codigoCredenciamento: "DSBN",
    areaHa: r.areaHa, perimetroM: r.perimetroM, mcAbs: 39, dataStr: "01/01/2026", rtNome: "RT", rtCrea: "", rtTrt: "",
    ring: r.partes[0].calc.memorialRing, segs: r.partes[0].calc.segs, confrontantesDescritivos: [],
    partes: r.partes.map((p) => ({ nome: p.nome, areaHa: p.calc.areaHa, perimetroM: p.calc.perimetroM, ring: p.calc.memorialRing, segs: p.calc.segs })),
  });
  assert.equal((xml.match(/Inicia-se a descrição deste perímetro/g) ?? []).length, 2);
  assert.ok(xml.includes("PARTE 1") && xml.includes("PARTE 2"));
});

test("unirEmBlocos sem certificados devolve cada bloco como anel inteiro, em ordem", () => {
  const ud = utmDef(24);
  const geoParaUtm = (lon, lat) => proj4(GEO_DEF, ud, [lon, lat]);
  const pontos = [
    ...ANEL.slice(0, 5).map(([o, e, n]) => ({ num: o + 1, e, n })),
    // o bloco novo começa na centena cheia (100), como o RUY.txt
    ...ANEL.slice(5, 10).map(([o, e, n]) => ({ num: 100 + o - 5, e: e + 3000, n })),
  ];
  const blocos = blocosPorNumeracao(pontos);
  assert.equal(blocos.length, 2);
  const r = unirEmBlocos(pontos, blocos, [], geoParaUtm, {});
  assert.equal(r.anel.length, 10);
  assert.deepEqual(r.blocosAnel, [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9]]);
  assert.deepEqual(r.anel.map((x) => x.idx), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});
