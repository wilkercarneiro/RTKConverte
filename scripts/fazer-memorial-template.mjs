// Monta o memorial-template.docx a partir do modelo de timbre da empresa.
//
// O Memorial Descritivo GEO é o único DOCX que o sistema escreve do zero — as
// outras peças saem de modelos. Para que ele tenha o MESMO timbre das peças sem
// duplicar a arte em código, o timbre vem de um modelo no Storage e a edge
// function só troca o corpo (word/document.xml), preservando o sectPr — que é
// quem aponta para o cabeçalho e o rodapé.
//
// O corpo do modelo é esvaziado de propósito: ele carrega o memorial de um
// cliente real, e um modelo que guarda dado de cliente é um vazamento esperando
// acontecer se algum dia a substituição do corpo falhar.
//
// Uso: node scripts/fazer-memorial-template.mjs <modelo.docx> <saida.docx>
import { readFileSync, writeFileSync } from "node:fs";
import JSZip from "jszip";

const [modelo, saida] = process.argv.slice(2);
if (!modelo || !saida) {
  console.error("uso: node scripts/fazer-memorial-template.mjs <modelo.docx> <saida.docx>");
  process.exit(1);
}

const z = await JSZip.loadAsync(readFileSync(modelo));
const doc = await z.file("word/document.xml").async("string");

// Cabeçalho do <w:document …> com TODAS as declarações de namespace do modelo:
// o sectPr usa r: e pode usar w14:/mc:, e um prefixo não declarado invalida o
// pacote inteiro.
const abertura = doc.match(/<w:document[^>]*>/)?.[0];
const sectPr = doc.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/)?.[0];
if (!abertura || !sectPr) {
  console.error("modelo sem <w:document> ou sem <w:sectPr> — não dá para derivar o timbre");
  process.exit(1);
}

z.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
${abertura}<w:body>${sectPr}</w:body></w:document>`);

const buf = await z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync(saida, buf);
console.log(`${saida}: ${(buf.length / 1024).toFixed(0)} KB · sectPr com ${(sectPr.match(/Reference/g) ?? []).length} referências de timbre`);
