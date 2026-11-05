// Imagem da assinatura do RT nos DOCX (memorial, tabular, peças) e o preparo
// da imagem no navegador (fundo branco → transparente, recorte).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import JSZip from "jszip";
import {
  aplicarAssinaturaRt, caminhoAssinaturaRt, carregarAssinaturaRt, ehLinhaDoRt, inserirAssinaturaNoXml,
  MARCADOR_ASSINATURA, medidasAssinatura, paragrafos, textoDoParagrafo,
} from "../supabase/functions/_shared/assinatura_rt.ts";
import { caixaDoTraco, caminhoAssinatura, limparFundo } from "../src/lib/assinatura.ts";
import { pngAssinatura } from "./fixtures/png_assinatura.mjs";

const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const ASSIN = { bytes: pngAssinatura(), tipo: "png" };
const EX = "DANIEL NASCIMENTO SANTOS"; // o RT de exemplo dos modelos
const xmlDe = async (caminho) => (await JSZip.loadAsync(readFileSync(new URL(caminho, import.meta.url)))).file("word/document.xml").async("string");
const qtdParagrafos = (xml) => paragrafos(xml).length;

test("linha do RT: só o nome, com rótulo ou com registro — nunca o nome no meio de um texto", () => {
  assert.ok(ehLinhaDoRt(EX, EX));
  assert.ok(ehLinhaDoRt("Responsável Técnico: Daniel Nascimento Santos", EX));
  assert.ok(ehLinhaDoRt(`${EX}  -  CREA : 123 -  - TRT: BR1`, EX));
  assert.ok(!ehLinhaDoRt(`Eu, ${EX}, Responsável Técnico do levantamento`, EX));
  assert.ok(!ehLinhaDoRt(`Declaramos ainda que o profissional credenciado ${EX} - TÉCNICO`, EX));
  assert.ok(!ehLinhaDoRt("JOSÉ", "JOSÉ"), "nome curto demais não casa");
});

test("parágrafos: caixas de texto (parágrafo dentro de parágrafo) ficam de fora", () => {
  const xml = `<w:body><w:p><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:pict><w:txbxContent><w:p><w:r><w:t>B</w:t></w:r></w:p></w:txbxContent></w:pict></w:r></w:p><w:p/></w:body>`;
  const ps = paragrafos(xml);
  assert.deepEqual(ps.map((p) => textoDoParagrafo(p.xml)), ["A", "B", ""]);
});

test("modelo da peça 1 (memorial): a imagem ocupa a linha em branco acima do nome", async () => {
  const xml = await xmlDe("./fixtures/modelos-padrao/pecas/1-memorial-descritivo.docx");
  const r = inserirAssinaturaNoXml(xml, ASSIN, EX);
  assert.equal(r.inseridas, 1);
  assert.equal(qtdParagrafos(r.xml), qtdParagrafos(xml), "o parágrafo vazio vira o da imagem: a página não cresce");
  const ps = paragrafos(r.xml);
  const iNome = ps.findIndex((p) => textoDoParagrafo(p.xml) === EX);
  assert.match(ps[iNome - 1].xml, /r:id="rIdAssinaturaRt"/);
  assert.match(ps[iNome - 1].xml, /<w:jc w:val="center"\/>/);
});

test("cartas de anuência: uma assinatura por carta, sobre o nome (depois do rótulo)", async () => {
  const xml = await xmlDe("../reference/pecas/3-cartas-anuencia.docx");
  const r = inserirAssinaturaNoXml(xml, ASSIN, EX);
  assert.equal(r.inseridas, 4);
  assert.equal((r.xml.match(/id="_x0000_t75"/g) ?? []).length, 1, "o shapetype entra uma vez só");
  assert.match(r.xml, /<w:ind w:left="\d{4}"\/>/);
});

test("todos os modelos: nunca quebra o XML e o nome do RT continua lá", async () => {
  for (const arq of ["1-memorial-descritivo", "2-memorial-tabular", "3-cartas-anuencia", "4-declaracao-tecnico", "5-declaracao-proprietario", "6-requerimento", "7-declaracao-faixa-dominio"]) {
    const xml = await xmlDe(`./fixtures/modelos-padrao/pecas/${arq}.docx`);
    const r = inserirAssinaturaNoXml(xml, ASSIN, EX);
    assert.equal((r.xml.match(/<w:p[\s>]/g) ?? []).length - (r.xml.match(/<\/w:p>/g) ?? []).length,
      (xml.match(/<w:p[\s>]/g) ?? []).length - (xml.match(/<\/w:p>/g) ?? []).length, `${arq}: parágrafos balanceados`);
    assert.equal((r.xml.match(new RegExp(EX, "g")) ?? []).length, (xml.match(new RegExp(EX, "g")) ?? []).length, arq);
  }
});

test("linha tracejada (memorial montado em código, docx.ts): a imagem entra antes dela, recuada sobre os traços", () => {
  const xml = `<w:document><w:body><w:p><w:r><w:t>Texto.</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Responsável Técnico: ____________</w:t></w:r></w:p><w:p><w:r><w:t>TECNICO DE TESTE  -  CREA : 1</w:t></w:r></w:p></w:body></w:document>`;
  const r = inserirAssinaturaNoXml(xml, ASSIN, "Técnico de Teste");
  assert.equal(r.inseridas, 1);
  const ps = paragrafos(r.xml);
  assert.match(ps[1].xml, /rIdAssinaturaRt/);
  assert.match(ps[1].xml, /<w:ind w:left="2205"\/>/);
  assert.equal(textoDoParagrafo(ps[2].xml), "Responsável Técnico: ____________");
});

test("marcador {{ASSINATURA_RT}} do modelo: a imagem entra no lugar; sem imagem, o marcador some", () => {
  const xml = `<w:document><w:body><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>${MARCADOR_ASSINATURA}</w:t></w:r></w:p><w:p><w:r><w:t>Assinado: ${MARCADOR_ASSINATURA} fim</w:t></w:r></w:p><w:p><w:r><w:t>${EX}</w:t></w:r></w:p></w:body></w:document>`;
  const com = inserirAssinaturaNoXml(xml, ASSIN, EX);
  assert.equal(com.inseridas, 2, "só os marcadores; a linha do nome não ganha uma segunda");
  assert.ok(!com.xml.includes(MARCADOR_ASSINATURA));
  assert.match(paragrafos(com.xml)[0].xml, /<w:jc w:val="center"\/>[\s\S]*rIdAssinaturaRt/);
  assert.equal(textoDoParagrafo(paragrafos(com.xml)[1].xml), "Assinado:  fim");
  const sem = inserirAssinaturaNoXml(xml, null, EX);
  assert.equal(sem.inseridas, 0);
  assert.ok(!sem.xml.includes(MARCADOR_ASSINATURA));
  assert.ok(!sem.xml.includes("rIdAssinaturaRt"));
});

test("sem imagem e sem marcador: o documento sai idêntico", async () => {
  const xml = await xmlDe("./fixtures/modelos-padrao/pecas/1-memorial-descritivo.docx");
  assert.equal(inserirAssinaturaNoXml(xml, null, EX).xml, xml);
});

test("pacote DOCX: mídia, relação, tipo png e namespaces do VML", async () => {
  const zip = await JSZip.loadAsync(readFileSync(new URL("./fixtures/modelos-padrao/pecas/1-memorial-descritivo.docx", import.meta.url)));
  assert.equal(await aplicarAssinaturaRt(zip, ASSIN, EX), 1);
  assert.ok(zip.file("word/media/assinatura-rt.png"));
  assert.match(await zip.file("word/_rels/document.xml.rels").async("string"), /Id="rIdAssinaturaRt"[^>]*Target="media\/assinatura-rt.png"/);
  assert.match(await zip.file("[Content_Types].xml").async("string"), /Extension="png"/);
  const doc = await zip.file("word/document.xml").async("string");
  assert.match(/<w:document\b[^>]*>/.exec(doc)[0], /xmlns:v="urn:schemas-microsoft-com:vml"/);
  assert.match(/<w:document\b[^>]*>/.exec(doc)[0], /xmlns:o="/);
  writeFileSync(new URL("./memorial-com-assinatura.docx", OUT), await zip.generateAsync({ type: "uint8array" }));
  // aplicar de novo não duplica a relação
  const zip2 = await JSZip.loadAsync(await zip.generateAsync({ type: "uint8array" }));
  await aplicarAssinaturaRt(zip2, ASSIN, EX);
  assert.equal(((await zip2.file("word/_rels/document.xml.rels").async("string")).match(/rIdAssinaturaRt/g) ?? []).length, 1);
});

test("tamanho no papel: altura 36 pt, largura limitada, proporção mantida", () => {
  const m = medidasAssinatura(ASSIN); // 300×90
  assert.equal(m.h, 36);
  assert.equal(m.w, 120);
  const larga = medidasAssinatura({ bytes: pngAssinatura(1000, 50), tipo: "png" });
  assert.equal(larga.w, 170);
  assert.equal(larga.h, 8.5);
});

test("carregar: caminho por escritório, respeita o liga/desliga e recusa o que não é PNG", async () => {
  assert.equal(caminhoAssinaturaRt("e1", "r1"), "escritorios/e1/assinaturas/rt-r1.png");
  assert.equal(caminhoAssinatura("e1", "r1"), caminhoAssinaturaRt("e1", "r1"), "navegador e servidor no mesmo caminho");
  const pedidos = [];
  const supa = (bytes) => ({ storage: { from: (b) => ({ download: async (n) => { pedidos.push(`${b}/${n}`); return bytes ? { data: new Blob([bytes]), error: null } : { data: null, error: { message: "não há" } }; } }) } });
  assert.deepEqual((await carregarAssinaturaRt(supa(ASSIN.bytes), "e1", { id: "r1" }))?.tipo, "png");
  assert.equal(pedidos.at(-1), "templates/escritorios/e1/assinaturas/rt-r1.png");
  assert.equal(await carregarAssinaturaRt(supa(ASSIN.bytes), "e1", { id: "r1", assinar_com_imagem: false }), null);
  assert.equal(await carregarAssinaturaRt(supa(ASSIN.bytes), null, { id: "r1" }), null);
  assert.equal(await carregarAssinaturaRt(supa(ASSIN.bytes), "e1", null), null);
  assert.equal(await carregarAssinaturaRt(supa(null), "e1", { id: "r1" }), null);
  assert.equal(await carregarAssinaturaRt(supa(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22])), "e1", { id: "r1" }), null);
});

test("navegador: fundo branco vira transparente, traço fica, recorte justo", () => {
  const w = 40, h = 20;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  // traço escuro de x 10..29, y 8..11; um pixel cinza-claro (borda suave) em 5,5
  for (let y = 8; y < 12; y++) for (let x = 10; x < 30; x++) { const i = (y * w + x) * 4; data[i] = 20; data[i + 1] = 20; data[i + 2] = 90; }
  const i55 = (5 * w + 5) * 4; data[i55] = data[i55 + 1] = data[i55 + 2] = 195;
  const px = { data, width: w, height: h };
  const traco = limparFundo(px);
  assert.equal(traco, 20 * 4 + 1);
  assert.equal(data[3], 0, "canto branco transparente");
  assert.equal(data[(9 * w + 15) * 4 + 3], 255, "traço opaco");
  assert.ok(data[i55 + 3] > 0 && data[i55 + 3] < 255, "borda suave meio transparente");
  const caixa = caixaDoTraco(px, 2);
  assert.deepEqual(caixa, { x: 3, y: 3, w: 29, h: 11 }, "inclui a borda suave em 5,5");
  assert.equal(caixaDoTraco({ data: new Uint8ClampedArray(16), width: 2, height: 2 }), null);
});
