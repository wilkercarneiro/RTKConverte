// Inspeção dos modelos de peças técnicas: extrai o texto do document.xml
import { readFileSync } from "node:fs";
import JSZip from "jszip";

const arquivos = [
  "1-MEMORIAL DESCRITIVO.docx",
  "2-MEMORIAL TABULAR .docx",
  "3-CARTAS DE ANUÊNCIA .docx",
  "4-DECLARAÇÃO DO TECNICO.docx",
  "5-DECLARAÇÃO DO PROPRIETARIO.docx",
  "6-REQUERIMENTO.docx",
  "7-DECLARAÇÃO CONF- FAIXA DE DOMINIO PUBLICA .docx",
];

for (const nome of arquivos) {
  const zip = await JSZip.loadAsync(readFileSync(new URL(`../${nome}`, import.meta.url)));
  const xml = await zip.file("word/document.xml").async("string");
  // texto por parágrafo
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) =>
    [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join("")
  ).filter((t) => t.trim());
  const temTabela = xml.includes("<w:tbl>");
  const nLinhasTbl = (xml.match(/<w:tr[ >]/g) ?? []).length;
  console.log(`\n########## ${nome} | tabelas: ${temTabela ? "sim" : "não"} (${nLinhasTbl} linhas) | ${paras.length} parágrafos ##########`);
  for (const p of paras.slice(0, 60)) console.log("¶ " + p.slice(0, 300));
  if (paras.length > 60) console.log(`... (+${paras.length - 60} parágrafos)`);
}
