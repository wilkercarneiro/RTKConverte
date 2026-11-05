// Loteamento PRONTO importado (src/lib/loteamento/importar): DXF, KML e
// GeoJSON viram o projeto do sistema — quadras com os lotes do arquivo, áreas
// públicas e o viário com corpo próprio — e o cálculo devolve os mesmos lotes.
//
// O que se prova: a área de cada lote é a do arquivo (≤ 1 cm²); a numeração é
// a do arquivo (inclusive com salto: B-05, 06, 07, 09); viário = gleba − lotes
// − áreas; os nomes das ruas vêm dos textos; o projeto passa pelo JSON do
// banco e o servidor recalcula igual; a edição (mover quina, unir, dividir,
// desenhar) funciona no projeto importado; arquivo fora da gleba é recusado
// com o motivo; e um loteamento gerado aqui volta igual pelo DXF/KML que o
// próprio sistema exporta.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AREA_LOTE, AREA_VERDE, AREA_VIARIO, E0, LOTES, dxfSintetico, geojsonSintetico, kmlSintetico, perimetroImp,
} from "./fixtures/loteamento_importar.mjs";
import { perimetro as perimetroGleba } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo } from "../src/lib/loteamento/modelo.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { areaPol, intersecao } from "../src/lib/loteamento/geom.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { gerarDxf, gerarKml, pontosDeLocacao } from "../src/lib/loteamento/saidas.ts";
import { desenharLote, dividirLote, moverQuina, unirLotes } from "../src/lib/loteamento/edicao.ts";
import { importarLoteamento, lerArquivoLoteamento, lerDxf } from "../src/lib/loteamento/importar/index.ts";
import { classeDoNome, nomeDaQuadra, nomeDaRua, numeroDoLote } from "../src/lib/loteamento/importar/texto.ts";
import { arcoDoBulge, limparTextoDxf } from "../src/lib/loteamento/importar/dxf.ts";
import { encadearEixos } from "../src/lib/loteamento/importar/montar.ts";

const base = () => projetoNovo("LOTEAMENTO IMPORTADO", perimetroImp.pts.length);
const importar = (nome, bytes, b = base(), per = perimetroImp) => importarLoteamento({ nome, bytes }, b, per, 24);
const porId = (res) => new Map(res.lotes.map((l) => [l.id, l]));
const IDS = ["A-01", "A-02", "A-03", "A-04", "B-05", "B-06", "B-07", "B-09"];

test("nomes: camada, número do lote, quadra e rua sem diferenciar maiúscula nem acento", () => {
  assert.equal(classeDoNome("LOTES"), "lote");
  assert.equal(classeDoNome("Lt"), "lote");
  assert.equal(classeDoNome("QD"), "quadra");
  assert.equal(classeDoNome("Área Verde"), "verde");
  assert.equal(classeDoNome("AV"), "verde");
  assert.equal(classeDoNome("PRAÇA"), "lazer");
  assert.equal(classeDoNome("AI"), "institucional");
  assert.equal(classeDoNome("Equipamento comunitário"), "institucional");
  assert.equal(classeDoNome("APP"), "app");
  assert.equal(classeDoNome("SISTEMA VIÁRIO"), "viario");
  assert.equal(classeDoNome("RUA_EIXO"), "eixo");
  assert.equal(classeDoNome("Perímetro"), "contorno");
  assert.equal(classeDoNome("TEXTO_LOTE"), "nada");
  assert.equal(classeDoNome("Quadra A (12 lotes)"), "lote");
  assert.equal(classeDoNome("0"), "?");
  assert.deepEqual(numeroDoLote("12"), { numero: 12 });
  assert.deepEqual(numeroDoLote("L-12"), { numero: 12 });
  assert.deepEqual(numeroDoLote("Lote nº 7"), { numero: 7 });
  assert.deepEqual(numeroDoLote("Q-A L-12"), { quadra: "A", numero: 12 });
  assert.deepEqual(numeroDoLote("QD 01 LT 03"), { quadra: "01", numero: 3 });
  assert.equal(numeroDoLote("250,00 m²"), null, "área não é número de lote");
  assert.equal(numeroDoLote("10,00"), null, "cota não é número de lote");
  assert.equal(numeroDoLote("A-12"), null, "no DXF o A-12 é nome de ponto");
  assert.deepEqual(numeroDoLote("A-12", true), { quadra: "A", numero: 12 });
  assert.equal(nomeDaQuadra("QUADRA B"), "B");
  assert.equal(nomeDaQuadra("QD-01"), "01");
  assert.equal(nomeDaQuadra("A"), null);
  assert.equal(nomeDaQuadra("A", true), "A");
  assert.equal(nomeDaRua("RUA DAS FLORES (12,00 m)"), "RUA DAS FLORES");
  assert.equal(nomeDaRua("AV 01"), null, "AV sem ponto é área verde");
  assert.equal(nomeDaRua("Av. Brasil"), "Av. Brasil");
});

test("eixo desenhado em LINEs soltas vira uma polilinha por rua (o cruzamento separa)", () => {
  const f = { geo: "linha", classe: "eixo", origem: "EIXO" };
  const linhas = [
    { f, pts: [[0, 0], [10, 0]] }, { f, pts: [[20, 0], [10, 0]] }, { f, pts: [[20, 0], [30, 0]] }, // uma rua em 3 pedaços (um invertido)
    { f, pts: [[30, 0], [30, 10]] }, { f, pts: [[30, 0], [40, 0]] }, // cruzamento em (30, 0): três pedaços no nó
  ];
  const r = encadearEixos(linhas);
  assert.equal(r.length, 3);
  const longa = r.find((x) => x.pts.length === 4);
  assert.ok(longa, JSON.stringify(r.map((x) => x.pts)));
  assert.deepEqual([longa.pts[0], longa.pts[3]].map((p) => p[0]).sort((a, b) => a - b), [0, 30]);
});

test("DXF: polilinhas, arco do bulge, textos e MTEXT sem formatação", () => {
  const d = lerDxf(new TextDecoder().decode(dxfSintetico()));
  assert.equal(d.polilinhas.filter((p) => p.camada === "LOTES" && p.fechada).length, 8);
  assert.equal(d.polilinhas.filter((p) => p.camada === "EIXO_VIA").length, 2);
  assert.ok(d.textos.some((t) => t.texto === "QUADRA B"), "MTEXT sem os códigos de formatação");
  assert.equal(limparTextoDxf("{\\fArial|b1;LOTE\\P12}", true), "LOTE\n12");
  assert.equal(limparTextoDxf("\\U+00C1REA 10%%d"), "ÁREA 10°");
  // meia-volta com bulge 1 (semicírculo): os pontos ficam no círculo
  const arco = arcoDoBulge([0, 0], [2, 0], 1);
  for (const p of arco) assert.ok(Math.abs(Math.hypot(p[0] - 1, p[1]) - 1) < 1e-9);
  assert.ok(arco.length > 40, "corda curta");
  assert.throws(() => lerDxf("AutoCAD Binary DXF\r\n\x1a\x00"), /binário/);
});

test("DXF sintético: 2 quadras × 4 lotes, a numeração e as áreas do arquivo", async () => {
  const imp = await importar("loteamento.dxf", dxfSintetico());
  const { projeto, res, resumo } = imp;
  assert.equal(projeto.gerado, true);
  assert.equal(projeto.importado.arquivo, "loteamento.dxf");
  assert.equal(resumo.quadras, 2);
  assert.equal(resumo.lotes, 8);
  assert.deepEqual(res.lotes.map((l) => l.id).sort(), IDS);
  // mesma área de lote que o arquivo (≤ 1 cm²)
  for (const l of res.lotes) assert.ok(Math.abs(l.area - AREA_LOTE) <= 1e-4, `${l.id}: ${l.area}`);
  // numeração do arquivo: a quadra B pula o 8 (LoteDesenhado.numero), a A é 1..4 (sem número gravado)
  const cfgA = projeto.quadras.find((q) => q.nome === "A"), cfgB = projeto.quadras.find((q) => q.nome === "B");
  assert.ok(cfgA.lotes.every((l) => l.numero === undefined));
  assert.deepEqual(cfgB.lotes.map((l) => l.numero), [5, 6, 7, 9]);
  // cada lote no lugar do arquivo (o B-09 é o último da quadra B)
  const b9 = porId(res).get("B-09");
  const esperado = LOTES.find((l) => l.quadra === "B" && l.numero === 9).anel;
  const xs = b9.pol.ext.map((p) => p[0] + res.plano.centro[0] - E0);
  assert.ok(Math.abs(Math.min(...xs) - esperado[0][0]) < 1e-6 && Math.abs(Math.max(...xs) - esperado[1][0]) < 1e-6);
  // viário = gleba − lotes − áreas, e o quadro fecha
  assert.ok(Math.abs(res.quadro.viario - AREA_VIARIO) < 0.01, `viário ${res.quadro.viario}`);
  assert.ok(Math.abs(res.quadro.verde - AREA_VERDE) < 0.01);
  assert.ok(Math.abs(res.quadro.gleba - (res.quadro.lotes.area + res.quadro.verde + res.quadro.viario + res.quadro.sobras)) < 0.01);
  assert.ok(res.quadro.sobras < 0.01, "sem área livre");
  // ruas com o nome do texto e a largura medida
  assert.deepEqual(res.ruas.map((r) => r.nome).sort(), ["AVENIDA BRASIL", "RUA DAS FLORES"]);
  for (const r of projeto.ruas) { assert.ok(Math.abs(r.largura - 12) < 0.05, `${r.nome}: ${r.largura}`); assert.equal(r.eixo.length, 2); assert.ok(r.corpo.length >= 1); }
  // o lote dá frente para a rua certa e ninguém sai acusado de fora da medida
  assert.equal(porId(res).get("A-01").rua, "RUA DAS FLORES");
  for (const l of res.lotes) assert.ok(!l.problemas.some((t) => /abaixo|acima/.test(t)), `${l.id}: ${l.problemas}`);
  assert.equal(res.publicas.length, 1);
  assert.match(res.publicas[0].nome, /ÁREA VERDE 01/i);
  assert.equal(projeto.params.distanciasTerreno, false, "áreas no plano UTM, como as do arquivo");
});

test("projeto importado passa pelo JSON do banco e o servidor recalcula igual", async () => {
  const { projeto, res } = await importar("loteamento.dxf", dxfSintetico());
  const doBanco = JSON.parse(JSON.stringify(projeto));
  const r2 = calcular(doBanco, perimetroImp);
  assert.deepEqual(r2.lotes.map((l) => [l.id, l.area.toFixed(6)]), res.lotes.map((l) => [l.id, l.area.toFixed(6)]));
  assert.ok(Math.abs(r2.quadro.viario - res.quadro.viario) < 1e-6);
});

test("sem polígono de quadra: os lotes que se encostam formam a quadra", async () => {
  const { res } = await importar("sem_quadras.dxf", dxfSintetico({ comQuadras: false }));
  assert.equal(res.quadras.length, 2);
  assert.deepEqual(res.lotes.map((l) => l.id).sort(), IDS);
  for (const l of res.lotes) assert.ok(Math.abs(l.area - AREA_LOTE) <= 1e-4);
});

test("camada desconhecida: o polígono dentro da quadra é lote", async () => {
  const { res, avisos } = await importar("camada0.dxf", dxfSintetico({ camadaLote: "0" }));
  assert.equal(res.lotes.length, 8, avisos.join(" | "));
  assert.deepEqual(res.lotes.map((l) => l.id).sort(), IDS);
});

test("KML e GeoJSON (lon/lat e UTM com crs) chegam ao mesmo loteamento", async () => {
  for (const [nome, bytes, tol] of [["lot.kml", kmlSintetico(), 0.05], ["lot.geojson", geojsonSintetico(), 0.05], ["utm.geojson", geojsonSintetico({ utm: true }), 1e-4]]) {
    const { res, avisos } = await importar(nome, bytes);
    assert.deepEqual(res.lotes.map((l) => l.id).sort(), IDS, `${nome}: ${avisos.join(" | ")}`);
    for (const l of res.lotes) assert.ok(Math.abs(l.area - AREA_LOTE) <= tol, `${nome} ${l.id}: ${l.area}`);
    assert.ok(Math.abs(res.quadro.verde - AREA_VERDE) <= 0.1, nome);
    assert.deepEqual(res.ruas.map((r) => r.nome.toUpperCase()).sort(), ["AVENIDA BRASIL", "RUA DAS FLORES"], nome);
  }
});

test("lote fora da gleba é recortado e avisado; arquivo longe da gleba é recusado com o motivo", async () => {
  // um lote a mais passando 5 m da divisa leste
  const extra = (poli) => poli([[110, 40], [125, 40], [125, 50], [110, 50]], "LOTES");
  const { res, avisos } = await importar("fora.dxf", dxfSintetico({ extra: [extra] }));
  assert.ok(avisos.some((a) => /recortados pela gleba|recortados por ela/.test(a)), avisos.join(" | "));
  for (const l of res.lotes) assert.ok(intersecao([l.pol], [res.gleba]).reduce((s, x) => s + areaPol(x), 0) >= l.area - 1e-3, `${l.id} fora da gleba`);
  await assert.rejects(importar("longe.dxf", dxfSintetico({ deslocar: [0, 300000] })), /não cai na gleba/);
  await assert.rejects(importar("local.dxf", dxfSintetico({ local: true })), /coordenadas locais/);
  await assert.rejects(lerArquivoLoteamento("planta.dwg", new Uint8Array([1, 2, 3]), 24), /DXF/);
});

test("edição num projeto importado: mover quina, unir, dividir e desenhar lote", async () => {
  const { projeto, res } = await importar("loteamento.dxf", dxfSintetico());
  const qA = () => (r) => r.quadras.find((q) => q.nome === "A");
  const areaQuadra = (r, nome) => r.lotes.filter((l) => l.quadra === nome).reduce((s, l) => s + l.area, 0);
  const semSobreposicao = (r) => {
    for (let i = 0; i < r.lotes.length; i++) for (let j = 0; j < i; j++) {
      const a = intersecao([r.lotes[i].pol], [r.lotes[j].pol]).reduce((s, x) => s + areaPol(x), 0);
      assert.ok(a < 0.01, `${r.lotes[i].id} × ${r.lotes[j].id}: ${a}`);
    }
  };
  // mover a quina de fundo entre A-01 e A-02 (na divisa norte): corre pela divisa
  const a1 = porId(res).get("A-01"), a2 = porId(res).get("A-02");
  const quina = a1.pol.ext.find((p) => a2.pol.ext.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01) && p[1] > 0);
  const m = moverQuina(projeto, res, qA()(res), quina, [quina[0] + 2, quina[1]], false, Infinity, a1.indice);
  const r1 = calcular(m.pr, perimetroImp);
  assert.equal(r1.lotes.length, 8);
  assert.ok(porId(r1).get("A-01").area > AREA_LOTE + 1, "A-01 cresceu");
  assert.ok(Math.abs(areaQuadra(r1, "A") - 4 * AREA_LOTE) < 0.01, "a quadra conserva a área");
  semSobreposicao(r1);
  // unir A-01 e A-02
  const u = unirLotes(projeto, res, qA()(res), [a1.indice, a2.indice]);
  const r2 = calcular(u.pr, perimetroImp);
  assert.equal(r2.lotes.filter((l) => l.quadra === "A").length, 3);
  assert.ok(Math.abs(porId(r2).get("A-01").area - 2 * AREA_LOTE) < 0.01);
  // dividir o B-09 em dois: a numeração do arquivo continua (B-09 e o seguinte, B-10)
  const b9 = porId(res).get("B-09");
  const d = dividirLote(projeto, res, res.quadras.find((q) => q.nome === "B"), b9, 2);
  const r3 = calcular(d.pr, perimetroImp);
  assert.deepEqual(r3.lotes.filter((l) => l.quadra === "B").map((l) => l.id).sort(), ["B-05", "B-06", "B-07", "B-09", "B-10"]);
  assert.ok(Math.abs(porId(r3).get("B-09").area - AREA_LOTE / 2) < 0.01);
  semSobreposicao(r3);
  // desenhar um lote por cima de dois: os vizinhos cedem
  const c0 = res.plano.centro;
  const P = ([x, y]) => [E0 + x - c0[0], 8600000 + y - c0[1]];
  const des = desenharLote(projeto, res, [[5, 40], [20, 40], [20, 60], [5, 60]].map(P));
  assert.ok(des && !des.erro, des?.msg);
  const r4 = calcular(des.pr, perimetroImp);
  assert.equal(r4.lotes.filter((l) => l.quadra === "A").length, 5);
  assert.ok(Math.abs(areaQuadra(r4, "A") - 4 * AREA_LOTE) < 0.01);
  semSobreposicao(r4);
});

test("loteamento gerado aqui volta igual pelo DXF e pelo KML que o sistema exporta", async () => {
  const pr0 = projetoNovo("TESTE", perimetroGleba.pts.length);
  pr0.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
  pr0.params.distanciasTerreno = false; // áreas no plano UTM, como o arquivo exportado
  const gerado = gerarPropostas(pr0, perimetroGleba, { quantas: 1, estruturar: false })[0].projeto;
  const res0 = calcular(gerado, perimetroGleba);
  const b = { ...projetoNovo("VOLTA", perimetroGleba.pts.length), bordas: gerado.bordas };
  for (const [nome, conteudo, tol] of [["volta.dxf", gerarDxf(res0, pontosDeLocacao(res0, perimetroGleba)), 0.02], ["volta.kml", gerarKml(res0, 24, "VOLTA"), 0.06]]) {
    const { res, avisos } = await importarLoteamento({ nome, bytes: new TextEncoder().encode(conteudo) }, b, perimetroGleba, 24);
    assert.equal(res.lotes.length, res0.lotes.length, `${nome}: ${avisos.join(" | ")}`);
    assert.equal(res.quadras.length, res0.quadras.length, nome);
    const orig = new Map(res0.lotes.map((l) => [l.id, l.area]));
    let iguais = 0;
    for (const l of res.lotes) { assert.ok(orig.has(l.id), `${nome}: ${l.id} não existia`); if (Math.abs(orig.get(l.id) - l.area) <= tol) iguais++; }
    assert.ok(iguais >= res0.lotes.length - 2, `${nome}: só ${iguais} de ${res0.lotes.length} lotes com a mesma área`);
    assert.ok(Math.abs(res.quadro.viario - res0.quadro.viario) < 1, `${nome}: viário ${res.quadro.viario} × ${res0.quadro.viario}`);
    assert.ok(Math.abs(res.quadro.verde + res.quadro.institucional - res0.quadro.verde - res0.quadro.institucional) < 1, nome);
  }
});

test("importar: arquivo do vizinho que só encosta na gleba é recusado como fora da gleba (revisão 05/11)", async () => {
  // o mesmo loteamento deslocado 115 m para leste: só a ponta encosta na gleba
  const bytes = dxfSintetico({ deslocar: [115, 0] });
  await assert.rejects(() => importar("vizinho.dxf", bytes), /não cai na gleba deste serviço/);
});
