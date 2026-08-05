// Teste da planta A1: monta o serviço do Anexo A e gera o PDF real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import proj4lib from "proj4";
import { PDFDocument } from "pdf-lib";
import { parseTxt, fmtBR, fmtGmsPlanilha } from "../supabase/functions/_shared/geo.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });

// matrizes `cm` que embrulham o conteúdo da página — é por elas que a folha de
// posse vira A3, e é nelas que se lê se a redução foi mesmo proporcional
async function transformacoesDoConteudo(bytes) {
  const pg = (await PDFDocument.load(bytes)).getPage(0);
  const doc = pg.doc;
  const out = [];
  for (const ref of pg.node.normalizedEntries().Contents.asArray()) {
    const bruto = Buffer.from(doc.context.lookup(ref).getContents());
    let txt;
    try { txt = inflateSync(bruto).toString("latin1"); } catch { txt = bruto.toString("latin1"); }
    for (const m of txt.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/g)) {
      out.push(m.slice(1).map(Number));
    }
  }
  return out;
}

// serviço do Anexo A (igual ao gerador.test)
const pontos = parseTxt(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8"));
const DESCS = {
  30: "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA\\ CARLOS MATOS DE LIMA\\ CPF:397.521.865-72\\ DIVALDO JOSE MATOS DE LIMA\\ CPF:180.246.295-34",
  36: "(POSSE) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  41: "(MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  58: "(POSSE) FAZENDA PAU D'ÁGUA\\ VALDETE DOS SANTOS\\ CPF:161.770.455-53",
  64: "BA 408",
  9: "CORREDOR",
};
const MS = new Set([30, 36, 41, 58, 64, 9]);
const VIAS = new Set([64, 9]); // BA 408 e CORREDOR: faixa de domínio pública
// a confrontação vive no próprio vértice M (ver ARQUITETURA-TRECHOS.md)
const vertices = pontos.map((p, i) => ({
  ordem: i, numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
  tipo: MS.has(p.num) ? "M" : "P", metodo: "PG6", inserido: false,
  descritivo: MS.has(p.num) ? DESCS[p.num] : null,
  tipoLimite: MS.has(p.num) ? (VIAS.has(p.num) ? "LA3" : "LA1") : null,
  ehVia: VIAS.has(p.num),
}));
const ordemDe = (n) => vertices.findIndex((v) => v.numTxt === n);
const servico = montarServico({
  fusoUtm: 24, verticeInicialOrdem: ordemDe(30), prefixo: "DSBN",
  contadores: { M: 3605, P: 13130, V: 758 }, vertices,
}, proj4);

const ring = servico.ring;
const posDe = new Map(ring.map((v, i) => [v.ordem, i]));
const trechosPlanta = servico.trechosOrdenados.map((t, k) => {
  const prox = servico.trechosOrdenados[(k + 1) % servico.trechosOrdenados.length];
  return {
    descritivo: t.descritivo,
    isEstrada: t.ehVia,
    inicioIdx: posDe.get(t.verticeInicioOrdem),
    fimIdx: posDe.get(prox.verticeInicioOrdem),
  };
});

test("planta A1: PDF gerado com dimensões e conteúdo", async () => {
  const dados = {
    vertices: ring.map((v, i) => ({
      codigo: v.codigo, e: v.eProj, n: v.nProj,
      lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
      alt: String(v.h).replace(".", ","),
      azFmt: servico.segs[i].azimuteFmt, distFmt: servico.segs[i].distFmt,
      vante: ring[(i + 1) % ring.length].codigo,
    })),
    trechos: trechosPlanta,
    denominacao: "FAZENDA TESTE",
    proprietarios: [
      { nome: "MARIA DE TESTE SILVA", cpf: "111.222.333-44" },
      { nome: "JOSE DE TESTE SILVA", cpf: "555.666.777-88" },
    ],
    matricula: "4.490", cns: "00.803-7", sncr: "312.010.028.860-1",
    municipioUf: "ARACI-BA",
    areaFmt: fmtBR(servico.areaHa, 4), tarefasFmt: fmtBR(servico.areaHa * 10000 / 4356, 2),
    perimetroFmt: fmtBR(servico.perimetroM, 2),
    mcAbs: 39, fuso: 24, latMediaDeg: -11.4,
    trt: "BR20260408910",
    rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
    desenhista: "JANETE OLIVEIRA", dataStr: "22/07/2026",
    logo: null,
  };
  const diag = { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 };
  const bytes = await gerarPlantaPdf(dados, diag);
  writeFileSync(new URL("./out/planta-teste.pdf", import.meta.url), bytes);
  assert.ok(bytes.length > 20000, `PDF pequeno demais: ${bytes.length}`);

  // nenhum rótulo de confrontante ou de via pode cair sobre as linhas do desenho
  assert.ok(diag.rotulos.length >= 6, `poucos rótulos posicionados: ${diag.rotulos.length}`);
  assert.equal(diag.sobrepostos, 0, `${diag.sobrepostos} rótulo(s) sobre as linhas do terreno`);
  // O nome do confrontante fica no VÃO DA DIVISA DELE. Deslizar para o lado é a
  // última saída da busca, depois de esgotar afastamento, quebra de linha e
  // redução de corpo — sair do centro é a única dessas que muda o significado do
  // rótulo. Era 1 enquanto o deslizamento vinha antes da quebra de linha.
  assert.equal(diag.deslocados, 0, `${diag.deslocados} rótulos fora do centro do trecho`);
  // TODO M ganha traço verde, inclusive os que abrem faixa de domínio (BA 408 e
  // CORREDOR). O desenho antigo saía de dentro do laço de rótulos, que pula as
  // vias no `continue`, e esses dois marcos não apareciam na planta.
  assert.equal(diag.marcos.length, trechosPlanta.length,
    `${diag.marcos.length} marcos para ${trechosPlanta.length} vértices M`);
  console.log(`    rótulos de trecho: ${diag.rotulos.length}, nenhum sobre as linhas, ${diag.deslocados} fora do centro, ${diag.marcos.length} marcos`);

  // leitura real
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 841 * 2.834645669) < 1, `largura ${width}`);
  assert.ok(Math.abs(height - 594 * 2.834645669) < 1, `altura ${height}`);
  console.log(`    planta-teste.pdf: ${(bytes.length / 1024).toFixed(0)} KB, A1 paisagem OK`);
});

test("planta de posse: folha A3 sem quadro analítico", async () => {
  const dados = {
    vertices: ring.map((v, i) => ({
      codigo: v.codigo, e: v.eProj, n: v.nProj,
      lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
      alt: String(v.h).replace(".", ","),
      azFmt: servico.segs[i].azimuteFmt, distFmt: servico.segs[i].distFmt,
      vante: ring[(i + 1) % ring.length].codigo,
    })),
    trechos: trechosPlanta,
    denominacao: "FAZENDA SÃO DOMINGOS",
    proprietarios: [{ nome: "ANTONIO DE TESTE COSTA", cpf: "111.222.333-44", rg: "1256766461" }],
    tipoImovel: "posse",
    matricula: "", cns: "", sncr: "950.033.008.028-6",
    municipioUf: "FEIRA DE SANTANA-BA",
    areaFmt: fmtBR(servico.areaHa, 4), tarefasFmt: fmtBR(servico.areaHa * 10000 / 4356, 2),
    perimetroFmt: fmtBR(servico.perimetroM, 2),
    mcAbs: 39, fuso: 24, latMediaDeg: -12.2,
    trt: "BR20251208584",
    rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
    desenhista: "JANETE OLIVEIRA", dataStr: "22/07/2026",
    logo: null,
  };
  const diag = { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 };
  const bytes = await gerarPlantaPdf(dados, diag);
  writeFileSync(new URL("./out/planta-posse-teste.pdf", import.meta.url), bytes);
  assert.ok(bytes.length > 15000, `PDF pequeno demais: ${bytes.length}`);
  // a folha A3 é desenhada em A1 e reduzida: o encaixe tem de valer nela também
  assert.equal(diag.sobrepostos, 0, `${diag.sobrepostos} rótulo(s) sobre as linhas do terreno`);

  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 420 * 2.834645669) < 1, `largura ${width}`);
  assert.ok(Math.abs(height - 297 * 2.834645669) < 1, `altura ${height}`);
  console.log(`    planta-posse-teste.pdf: ${(bytes.length / 1024).toFixed(0)} KB, A3 paisagem OK`);
});

test("A3 é a A1 reduzida: mesmo desenho, muda só a proporção", async () => {
  // As regras dos nomes de vizinho são proporcionais ao desenho, mas os pisos em
  // pontos eram multiplicados por 1,7 só na posse — na A3 os pisos venciam a
  // proporção e a mesma planta saía com dois arranjos. O desenho tem de ser bit a
  // bit o mesmo nos dois fluxos; o que muda é a folha no fim.
  const comum = {
    vertices: ring.map((v, i) => ({
      codigo: v.codigo, e: v.eProj, n: v.nProj,
      lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
      alt: String(v.h).replace(".", ","),
      azFmt: servico.segs[i].azimuteFmt, distFmt: servico.segs[i].distFmt,
      vante: ring[(i + 1) % ring.length].codigo,
    })),
    trechos: trechosPlanta,
    denominacao: "FAZENDA SÃO DOMINGOS",
    proprietarios: [{ nome: "ANTONIO DE TESTE COSTA", cpf: "111.222.333-44" }],
    matricula: "12345", cns: "00.770-8", sncr: "950.033.008.028-6",
    municipioUf: "FEIRA DE SANTANA-BA",
    areaFmt: fmtBR(servico.areaHa, 4), tarefasFmt: fmtBR(servico.areaHa * 10000 / 4356, 2),
    perimetroFmt: fmtBR(servico.perimetroM, 2),
    mcAbs: 39, fuso: 24, latMediaDeg: -12.2, trt: "BR20251208584",
    rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
    desenhista: "JANETE OLIVEIRA", dataStr: "22/07/2026", logo: null,
  };
  const d1 = {}, d3 = {};
  await gerarPlantaPdf({ ...comum, tipoImovel: "matricula" }, d1);
  const a3 = await gerarPlantaPdf({ ...comum, tipoImovel: "posse" }, d3);

  assert.deepEqual(d3.poligono, d1.poligono, "a poligonal saiu em outro lugar na A3");
  assert.deepEqual(d3.rotulos, d1.rotulos, "os nomes de vizinho saíram em outro arranjo na A3");
  assert.deepEqual(d3.corpos, d1.corpos, "os nomes de vizinho saíram em outro corpo na A3");
  assert.equal(d3.folga, d1.folga, "a folga mínima mudou entre A1 e A3");

  // e a redução é PROPORCIONAL: um fator só para os dois eixos, conteúdo centrado
  const pg = (await PDFDocument.load(a3)).getPage(0);
  const w3 = 420 * 2.834645669, h3 = 297 * 2.834645669;
  assert.ok(Math.abs(pg.getWidth() - w3) < 1 && Math.abs(pg.getHeight() - h3) < 1);
  const cms = await transformacoesDoConteudo(a3);
  const escala = cms.find((m) => m[0] !== 1);
  assert.ok(escala, "faltou a escala do conteúdo na A3");
  assert.equal(escala[0], escala[3], "escala anisotrópica: a A3 sairia achatada");
  const desloc = cms.find((m) => m[0] === 1);
  assert.ok(desloc && Math.abs(desloc[5] - (h3 - 594 * 2.834645669 * escala[0]) / 2) < 0.01,
    "conteúdo não ficou centrado na folha A3");
  console.log(`    A3 = A1 × ${escala[0].toFixed(4)}, ${d3.rotulos.length} rótulos idênticos`);
});

test("planta de espólio com inventariante: PDF gerado com dados do inventariante", async () => {
  const dados = {
    vertices: ring.map((v, i) => ({
      codigo: v.codigo, e: v.eProj, n: v.nProj,
      lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
      alt: String(v.h).replace(".", ","),
      azFmt: servico.segs[i].azimuteFmt, distFmt: servico.segs[i].distFmt,
      vante: ring[(i + 1) % ring.length].codigo,
    })),
    trechos: trechosPlanta,
    denominacao: "FAZENDA ESPÓLIO TESTE",
    proprietarios: [{
      nome: "ESPÓLIO DE JOÃO DA SILVA",
      cpf: "111.222.333-44",
      isEspolio: true,
      inventarianteNome: "CARLOS DA SILVA",
      inventarianteCpf: "999.888.777-66",
      inventarianteRg: "12.345.678-9",
    }],
    matricula: "1.234", cns: "00.803-7", sncr: "312.010.028.860-1",
    municipioUf: "ARACI-BA",
    areaFmt: fmtBR(servico.areaHa, 4), tarefasFmt: fmtBR(servico.areaHa * 10000 / 4356, 2),
    perimetroFmt: fmtBR(servico.perimetroM, 2),
    mcAbs: 39, fuso: 24, latMediaDeg: -11.4,
    trt: "BR20260408910",
    rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
    desenhista: "JANETE OLIVEIRA", dataStr: "22/07/2026",
    logo: null,
  };
  const diag = { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 };
  const bytes = await gerarPlantaPdf(dados, diag);
  writeFileSync(new URL("./out/planta-espolio-teste.pdf", import.meta.url), bytes);
  assert.ok(bytes.length > 20000, `PDF pequeno demais: ${bytes.length}`);
  assert.equal(diag.sobrepostos, 0, `${diag.sobrepostos} rótulo(s) sobre as linhas do terreno`);

  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  console.log(`    planta-espolio-teste.pdf: ${(bytes.length / 1024).toFixed(0)} KB, Espólio com inventariante OK`);
});
