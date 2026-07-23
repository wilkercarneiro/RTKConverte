// Dump do texto integral dos modelos de peças (base p/ mapa de substituições)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import JSZip from "jszip";

mkdirSync(new URL("../tests/out/", import.meta.url), { recursive: true });
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

for (const f of ["1-memorial-descritivo", "2-memorial-tabular", "3-cartas-anuencia", "4-declaracao-tecnico", "5-declaracao-proprietario", "6-requerimento", "7-declaracao-faixa-dominio"]) {
  const zip = await JSZip.loadAsync(readFileSync(new URL(`../reference/pecas/${f}.docx`, import.meta.url)));
  const xml = await zip.file("word/document.xml").async("string");
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)]
    .map((m) => decode([...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join("")))
    .filter((t) => t.trim());
  writeFileSync(new URL(`../tests/out/texto-${f}.txt`, import.meta.url), paras.join("\n"), "utf8");
  console.log(f, ":", paras.length, "parágrafos");
}
