import { readFileSync } from "node:fs";
import JSZip from "jszip";

const zip = await JSZip.loadAsync(readFileSync(new URL("../reference/pecas/2-memorial-tabular.docx", import.meta.url)));
const xml = await zip.file("word/document.xml").async("string");
const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const txt = (x) => dec([...x.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(""));

const tbls = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) ?? [];
console.log("tabelas (regex não-gulosa):", tbls.length);
for (const [i, t] of tbls.entries()) {
  const trs = t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) ?? [];
  const temFiltro = txt(t).includes("Longitude") && txt(t).includes("Azimute");
  console.log(`--- tbl#${i} len=${t.length} linhas=${trs.length} filtroVertices=${temFiltro}`);
  for (const tr of trs.slice(0, 3)) {
    const s = txt(tr);
    console.log(`   linha: ${JSON.stringify(s.slice(0, 100))}`);
    console.log(`   casa EH_LINHA_VERTICE? ${/^[A-Z0-9]{2,4}-[MPV]-\d+\s*-?\d+°/.test(s.trim())}`);
  }
}
