// Arquivos lote a lote (src/lib/loteamento/loteALote.ts + plantaLote.ts):
// para cada lote (e cada área pública), uma pasta no zip com o memorial (DOCX),
// a planta A4 (PDF) e a locação dos vértices — saindo do mesmo módulo que o
// servidor usa (função `entregar`, saídas "lote" e "lotes").
//
// O que se prova: o zip tem QUADRA_A/LOTE_01/ com os três arquivos; o PDF abre
// no pdf-lib em A4; o DOCX traz o nome do lote em word/document.xml; a locação
// tem uma linha por vértice, com os MESMOS nomes da locação completa; o
// servidor só aceita ids que existem no projeto recalculado (até 60); e o
// memorial do lote de esquina descreve o arco como curva, sem "vértice A-?".
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { dxfSintetico, perimetroImp } from "./fixtures/loteamento_importar.mjs";
import { perimetro as perimetroGleba } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo } from "../src/lib/loteamento/modelo.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { memorialDoLote, nomesDosPontos, pontosDeLocacao } from "../src/lib/loteamento/saidas.ts";
import { arquivoDoLoteamento, numeracaoDaQuadra, SAIDAS_LOTEAMENTO } from "../src/lib/loteamento/entregas.ts";
import { MAX_ITENS_POR_PEDIDO, conferirItens, itensLoteALote, pacoteLoteALote } from "../src/lib/loteamento/loteALote.ts";
import { importarLoteamento } from "../src/lib/loteamento/importar/index.ts";

const carimbo = {
  empresa: "EMPRESA TESTE", cnpj: "00.000.000/0001-00", desenhista: "", proprietario: "FULANO", cpfProprietario: "",
  imovel: "GLEBA TESTE", municipio: "Salvador", uf: "BA", matricula: "", rt: "RT TESTE", rtRegistro: "CREA: 1", trt: "", fuso: 24, logo: null,
};
const servico = { municipio: "Salvador", uf: "BA", detentor_nome: "FULANO", fuso_utm: 24 };

const importado = await importarLoteamento({ nome: "lot.dxf", bytes: dxfSintetico() }, projetoNovo("LOTEAMENTO SINTETICO", 4), perimetroImp, 24);
const projeto = JSON.parse(JSON.stringify(importado.projeto)); // como o servidor lê do banco
const res = calcular(projeto, perimetroImp);

test("itens: lotes por quadra na numeração e as áreas públicas (sem APP)", () => {
  const itens = itensLoteALote(res);
  assert.deepEqual(itens.filter((x) => x.tipo === "lote").map((x) => x.id), ["A-01", "A-02", "A-03", "A-04", "B-05", "B-06", "B-07", "B-09"]);
  assert.equal(itens.find((x) => x.id === "B-09").pasta, "QUADRA_B/LOTE_09");
  const areas = itens.filter((x) => x.tipo === "area");
  assert.equal(areas.length, 1);
  assert.match(areas[0].pasta, /^AREA_VERDE/);
  assert.equal(new Set(itens.map((x) => x.id)).size, itens.length, "id repetido");
});

test("pacote: uma pasta por lote com memorial (DOCX), planta A4 (PDF) e locação de um vértice por linha", async () => {
  const itens = itensLoteALote(res);
  const escolhidos = [itens.find((x) => x.id === "A-01"), itens.find((x) => x.id === "B-09"), itens.find((x) => x.tipo === "area")];
  const zipU8 = await pacoteLoteALote({ itens: escolhidos, formato: "csv-nome-e-n" }, projeto, res, perimetroImp, servico, carimbo);
  const zip = await JSZip.loadAsync(zipU8);
  const arquivos = Object.keys(zip.files).filter((n) => !zip.files[n].dir).sort();
  const pasta = (p) => arquivos.filter((n) => n.startsWith(`${p}/`)).map((n) => n.slice(p.length + 1));
  assert.deepEqual(pasta("QUADRA_A/LOTE_01").sort(), ["LOCACAO_LOTE_01_QUADRA_A_SIRGAS2000_UTM24S.csv", "MEMORIAL_LOTE_01_QUADRA_A.docx", "PLANTA_LOTE_01_QUADRA_A.pdf"]);
  assert.equal(pasta("QUADRA_B/LOTE_09").length, 3);
  const pastaArea = escolhidos[2].pasta;
  assert.equal(pasta(pastaArea).length, 3, arquivos.join(", "));

  // PDF: abre no pdf-lib, uma folha A4 em pé
  const pdf = await PDFDocument.load(await zip.file("QUADRA_A/LOTE_01/PLANTA_LOTE_01_QUADRA_A.pdf").async("uint8array"));
  const { width, height } = pdf.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1, `${width} × ${height}`);

  // DOCX: word/document.xml com o nome do lote
  const docx = await JSZip.loadAsync(await zip.file("QUADRA_A/LOTE_01/MEMORIAL_LOTE_01_QUADRA_A.docx").async("uint8array"));
  const xml = await docx.file("word/document.xml").async("string");
  assert.match(xml, /LOTE 01 DA QUADRA A/);
  assert.match(xml, /540,00 m²/);

  // locação: cabeçalho + uma linha por vértice do lote, com os nomes da locação completa
  const csv = (await zip.file("QUADRA_A/LOTE_01/LOCACAO_LOTE_01_QUADRA_A_SIRGAS2000_UTM24S.csv").async("string")).trim().split("\r\n");
  const a01 = res.lotes.find((l) => l.id === "A-01");
  assert.equal(csv[0], "Name,Easting,Northing,Elevation,Code");
  assert.equal(csv.length - 1, a01.pol.ext.length, csv.join(" | "));
  const completa = new Map(pontosDeLocacao(res, perimetroImp).map((p) => [p.nome, p]));
  for (const linha of csv.slice(1)) {
    const [nome, e, n] = linha.split(",");
    assert.ok(completa.has(nome), `${nome} não está na locação completa`);
    assert.ok(Math.abs(completa.get(nome).e - Number(e)) < 0.001 && Math.abs(completa.get(nome).n - Number(n)) < 0.001);
  }
  // o memorial cita os mesmos vértices da locação do lote
  const memo = xml.replace(/<[^>]+>/g, " ");
  for (const linha of csv.slice(1)) assert.ok(memo.includes(linha.split(",")[0]), `memorial sem o vértice ${linha.split(",")[0]}`);
});

test("locação do lote no formato DXF da coletora", async () => {
  const item = itensLoteALote(res).find((x) => x.id === "B-05");
  const zip = await JSZip.loadAsync(await pacoteLoteALote({ itens: [item], formato: "dxf" }, projeto, res, perimetroImp, servico, carimbo));
  const dxf = await zip.file("QUADRA_B/LOTE_05/LOCACAO_LOTE_05_QUADRA_B_SIRGAS2000_UTM24S.dxf").async("string");
  assert.ok(dxf.trimEnd().endsWith("EOF"));
  assert.equal((dxf.match(/\r\nPOINT\r\n/g) ?? []).length, 4);
});

test("servidor: só ids que existem no projeto recalculado, no máximo 60 por pedido", () => {
  assert.ok("itens" in conferirItens(res, ["A-01", "B-09"]));
  assert.match(conferirItens(res, ["A-01", "Z-99"]).erro, /Z-99 não existe/);
  assert.match(conferirItens(res, []).erro, /Diga quais/);
  assert.match(conferirItens(res, "A-01").erro, /Diga quais/);
  assert.match(conferirItens(res, Array.from({ length: MAX_ITENS_POR_PEDIDO + 1 }, (_, i) => `X-${i}`)).erro, /No máximo 60/);
  // o mesmo id duas vezes conta uma
  assert.equal(conferirItens(res, ["A-01", "A-01"]).itens.length, 1);
});

test("saídas lote e lotes no módulo das entregas (o que a função entregar chama)", async () => {
  assert.ok(SAIDAS_LOTEAMENTO.includes("lote") && SAIDAS_LOTEAMENTO.includes("lotes"));
  const um = await arquivoDoLoteamento({ saida: "lote", ids: ["B-07"] }, projeto, res, perimetroImp, servico, carimbo);
  assert.equal(um.tipo, "application/zip");
  assert.match(um.nome, /^LOTE_07_QUADRA_B_LOTEAMENTO_SINTETICO\.zip$/);
  const varios = await arquivoDoLoteamento({ saida: "lotes", ids: ["A-01", "A-02", "B-05"] }, projeto, res, perimetroImp, servico, carimbo);
  assert.match(varios.nome, /^LOTES_LOTEAMENTO_SINTETICO\.zip$/);
  const z = await JSZip.loadAsync(varios.dados);
  assert.equal(Object.keys(z.files).filter((n) => n.endsWith(".pdf")).length, 3);
  // memorial do loteamento: a numeração da quadra B com o salto do arquivo
  assert.equal(numeracaoDaQuadra([5, 6, 7, 9]), "05 a 07 e 09");
  assert.equal(numeracaoDaQuadra([1, 2, 3, 4]), "01 a 04");
});

test("loteamento gerado: lote de esquina com o arco como curva (sem vértice A-?) e 60 lotes num pedido", async () => {
  const pr0 = projetoNovo("TESTE", perimetroGleba.pts.length);
  pr0.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
  const gerado = JSON.parse(JSON.stringify(gerarPropostas(pr0, perimetroGleba, { quantas: 1, estruturar: false })[0].projeto));
  const r = calcular(gerado, perimetroGleba);
  const nomes = nomesDosPontos(pontosDeLocacao(r, perimetroGleba));
  const esq = r.lotes.find((l) => l.esquina && r.quadras.some((q) => q.curvas.some((c) => c.intermediarios.length)));
  assert.ok(esq, "nenhum lote de esquina com arco");
  const desc = memorialDoLote(esq, r, nomes, { loteamento: "TESTE", municipio: "X", uf: "BA", proprietario: "", fuso: 24 }).paragrafos.find((p) => p.startsWith("Descrição"));
  assert.ok(!/-\?/.test(desc), desc);
  assert.match(desc, /em curva de raio \d+,\d{2} m e desenvolvimento/);
  for (const m of desc.matchAll(/vértice ([A-Z]+-\d+)/g)) assert.ok([...nomes.values()].includes(m[1]), `${m[1]} fora da locação`);
  // 60 lotes num pedido (o teto do servidor) num tempo de servidor
  const itens = itensLoteALote(r).slice(0, MAX_ITENS_POR_PEDIDO);
  const t0 = performance.now();
  const zip = await JSZip.loadAsync(await pacoteLoteALote({ itens }, gerado, r, perimetroGleba, servico, carimbo));
  const ms = performance.now() - t0;
  assert.equal(Object.keys(zip.files).filter((n) => n.endsWith(".pdf")).length, itens.length);
  assert.ok(ms < 20000, `${ms.toFixed(0)} ms`);
  // locação de cada lote: os vértices com nome da locação completa (os do arco, só PC, meio e PT)
  const csvEsq = itens.find((x) => x.id === esq.id) ? await zip.file(new RegExp(`${itens.find((x) => x.id === esq.id).pasta}/LOCACAO`))[0].async("string") : null;
  if (csvEsq) for (const linha of csvEsq.trim().split("\r\n").slice(1)) assert.ok([...nomes.values()].includes(linha.split(",")[0]));
});
