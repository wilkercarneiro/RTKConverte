// O Memorial Descritivo sai timbrado: a logo da empresa entra ATRÁS do texto,
// em todas as páginas. Um timbre não é uma figura no corpo do documento — é uma
// parte de cabeçalho, uma relação e um content-type que precisam existir juntos,
// e é essa amarração que estes testes guardam. Faltando qualquer uma delas o
// Word recusa o arquivo inteiro, e o operador só descobre ao abrir.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { buildDocumentXml, buildDocxSkeleton, dimensoesImagem, extrairTimbre } from "../supabase/functions/_shared/docx.ts";

/** PNG de 400×200 — só o cabeçalho, que é tudo que o leitor de medidas olha. */
function pngFalso(w, h) {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13], 8);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
}

/** JPEG com um SOF0 declarando altura×largura, precedido de um segmento a pular. */
function jpgFalso(w, h) {
  const b = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08];
  b.push(h >> 8, h & 0xff, w >> 8, w & 0xff);
  return new Uint8Array(b);
}

// Um perímetro degenerado de um vértice só: aqui o que está sob teste é o
// EMPACOTAMENTO do .docx, não o texto do memorial (esse é o gerador.test.mjs).
const dadosMemorial = {
  imovel: "FAZENDA SALGADA VELHA", proprietario: "FULANO", cpfProprietario: "000",
  municipio: "SÃO DESIDÉRIO", uf: "BA", matricula: "1", comarca: "", codigoCredenciamento: "",
  areaHa: 10, perimetroM: 100, mcAbs: 39, dataStr: "11 de agosto de 2026",
  rtNome: "RT", rtCrea: "1", rtTrt: "BR1",
  ring: [{
    codigo: "DSBN-M-3605",
    latGms: { neg: true, d: 11, m: 23, sMil: 44344 },
    lonGms: { neg: true, d: 39, m: 5, sMil: 4736 },
    h: 300.05,
    iniciaTrechoDescritivo: null,
  }],
  segs: [{ deOrdem: 0, paraOrdem: 0, azimuteDeg: 129.78, azimuteFmt: "129°46'54\"", distM: 33.01, distCent: 3301 }],
  confrontantesDescritivos: [],
};

test("as medidas saem do cabeçalho do arquivo, em PNG e em JPEG", () => {
  assert.deepEqual(dimensoesImagem(pngFalso(400, 200), "png"), { w: 400, h: 200 });
  assert.deepEqual(dimensoesImagem(jpgFalso(640, 480), "jpg"), { w: 640, h: 480 });
  // arquivo truncado não derruba a geração: quem chama decide o que fazer
  assert.equal(dimensoesImagem(new Uint8Array([0x89, 0x50]), "png"), null);
});

test("com logo, o pacote traz cabeçalho, mídia, relação e content-type", () => {
  const files = buildDocxSkeleton({ bytes: pngFalso(400, 200), tipo: "png" });
  for (const parte of ["word/header1.xml", "word/_rels/header1.xml.rels", "word/media/logo-fundo.png"]) {
    assert.ok(files.has(parte), `faltou ${parte}`);
  }
  const ct = files.get("[Content_Types].xml");
  assert.match(ct, /Default Extension="png" ContentType="image\/png"/);
  assert.match(ct, /PartName="\/word\/header1.xml"/);
  // a relação do documento tem de apontar para o MESMO rId que o sectPr usa
  const rels = files.get("word/_rels/document.xml.rels");
  assert.match(rels, /Id="rId9".*header1\.xml/);
  assert.match(buildDocumentXml(dadosMemorial, true), /<w:headerReference w:type="default" r:id="rId9"\/>/);
  // o r: do headerReference precisa estar declarado, senão o XML é inválido
  assert.match(buildDocumentXml(dadosMemorial, true), /xmlns:r="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships"/);
  // e a relação do cabeçalho tem de apontar para a mídia que foi mesmo gravada
  assert.match(files.get("word/_rels/header1.xml.rels"), /Target="media\/logo-fundo\.png"/);
  assert.equal(files.get("word/media/logo-fundo.png").length, 24);
});

test("o timbre fica atrás do texto, desbotado e na proporção da logo", () => {
  const hdr = buildDocxSkeleton({ bytes: pngFalso(400, 200), tipo: "png" }).get("word/header1.xml");
  // z-index negativo é o "atrás do texto" do VML
  assert.match(hdr, /z-index:-\d+/);
  // gain/blacklevel são o desbotamento nativo do Word — sem eles a logo sai
  // chapada por baixo do texto e o memorial fica ilegível
  assert.match(hdr, /gain="19661f" blacklevel="22938f"/);
  // 400×200 no lado máximo de 12 cm = 340,2 × 170,1 pt, sem achatar a logo
  assert.match(hdr, /width:340\.2pt;height:170\.1pt/);
  // centrado na página, não pendurado no parágrafo do cabeçalho
  assert.match(hdr, /mso-position-horizontal:center/);
  assert.match(hdr, /mso-position-vertical:center/);
});

test("o .docx timbrado fecha e reabre com a logo real intacta", async () => {
  // logo de verdade: a que já vem no modelo de peça versionado no repositório
  const modelo = await JSZip.loadAsync(readFileSync(new URL("../reference/memorial-template.docx", import.meta.url)));
  const bytes = await modelo.file("word/media/image1.png").async("uint8array");
  assert.ok(dimensoesImagem(bytes, "png").w > 0, "PNG real precisa ser legível");

  const zip = new JSZip();
  for (const [path, content] of buildDocxSkeleton({ bytes, tipo: "png" })) zip.file(path, content);
  zip.file("word/document.xml", buildDocumentXml(dadosMemorial, true));
  const re = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  // a imagem tem de atravessar o zip byte a byte: um deflate mal aplicado aqui
  // vira "imagem corrompida" só na hora de abrir no Word
  assert.deepEqual(await re.file("word/media/logo-fundo.png").async("uint8array"), bytes);
  assert.match(await re.file("word/header1.xml").async("string"), /<v:imagedata r:id="rId1"/);
});

test("com modelo, o memorial herda o timbre das outras peças", async () => {
  // o modelo real, o mesmo que vai ao Storage
  const z = await JSZip.loadAsync(readFileSync(new URL("../reference/memorial-template.docx", import.meta.url)));
  const timbre = extrairTimbre(await z.file("word/document.xml").async("string"));
  assert.ok(timbre, "o modelo precisa ter cabeçalho e sectPr");

  const doc = buildDocumentXml(dadosMemorial, false, timbre);
  // a seção é a do modelo: cabeçalho, rodapé e margens vêm de lá
  assert.match(doc, /<w:headerReference w:type="default"/);
  assert.match(doc, /<w:footerReference w:type="default"/);
  assert.match(doc, /w:header="340"/);
  // e o corpo é o nosso
  assert.match(doc, /M E M O R I A L/);
  // a abertura do modelo traz os namespaces que o sectPr usa
  assert.match(doc, /<w:document[^>]*xmlns:r=/);
  // com timbre de modelo não se pendura a marca d'água própria: seriam duas
  assert.doesNotMatch(doc, new RegExp(`r:id="rId9"[^>]*/>\\s*<w:pgSz`));
});

test("modelo sem cabeçalho não conta como timbre", () => {
  // é o esqueleto antigo: sectPr sem nenhuma referência
  assert.equal(extrairTimbre(buildDocumentXml(dadosMemorial)), null);
  assert.equal(extrairTimbre("<w:body/>"), null);
});

test("sem logo, o pacote é o de sempre — nada de cabeçalho pendurado", () => {
  const files = buildDocxSkeleton();
  assert.equal(files.has("word/header1.xml"), false);
  assert.doesNotMatch(files.get("[Content_Types].xml"), /header/);
  assert.doesNotMatch(files.get("word/_rels/document.xml.rels"), /header/);
  // um headerReference apontando para parte ausente invalida o pacote inteiro
  assert.doesNotMatch(buildDocumentXml(dadosMemorial), /headerReference/);
});
