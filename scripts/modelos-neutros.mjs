// Gera os modelos NEUTROS (templates/padrao/…) a partir dos modelos em uso:
// mesmo corpo, sem o timbre de ninguém. É o que uma empresa nova do SaaS usa
// até mandar os próprios modelos (ver supabase/functions/_shared/modelos.ts).
//
// O timbre mora só no cabeçalho e no rodapé (scripts/aplicar-timbre.mjs troca
// exatamente essas partes). Aqui cada header*.xml/footer*.xml vira um parágrafo
// vazio e as imagens que eles usavam saem do pacote. O corpo
// (word/document.xml), os estilos e a numeração ficam intocados.
//
// Uso: node scripts/modelos-neutros.mjs <pasta-entrada> <pasta-saida>
//   (as subpastas são mantidas: memorial-template.docx, pecas/…, pecas-posse/…)
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import JSZip from "jszip";

const VAZIO = (raiz) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:${raiz} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p/></w:${raiz}>`;

export async function neutralizar(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const partes = Object.keys(zip.files).filter((n) => /^word\/(header|footer)\d*\.xml$/.test(n));
  const midias = new Set();
  for (const p of partes) {
    const rels = `word/_rels/${p.slice(5)}.rels`;
    const r = zip.file(rels);
    if (r) {
      for (const m of (await r.async("string")).matchAll(/Target="([^"]+)"/g)) {
        if (!/^https?:/.test(m[1])) midias.add(`word/${m[1].replace(/^\.\//, "")}`);
      }
      zip.remove(rels);
    }
    zip.file(p, VAZIO(p.includes("header") ? "hdr" : "ftr"));
  }
  // metadados (autor, "modificado por", título) também carregam o nome de quem fez
  const core = zip.file("docProps/core.xml");
  if (core) {
    zip.file("docProps/core.xml", (await core.async("string"))
      .replace(/<(dc:creator|cp:lastModifiedBy|dc:title|dc:subject|cp:keywords|dc:description)>[^<]*<\/\1>/g, "<$1></$1>"));
  }
  const app = zip.file("docProps/app.xml");
  if (app) zip.file("docProps/app.xml", (await app.async("string")).replace(/<(Company|Manager)>[^<]*<\/\1>/g, "<$1></$1>"));
  // só apaga a mídia que o corpo não usa também
  const corpoRels = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  for (const m of midias) if (!corpoRels.includes(m.slice(5))) zip.remove(m);
  return { bytes: await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }), partes: partes.length, midias: midias.size };
}

function arquivos(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith(".docx") ? [p] : [];
  });
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("modelos-neutros.mjs")) {
  const [entrada, saida] = process.argv.slice(2);
  if (!entrada || !saida) { console.error("uso: node scripts/modelos-neutros.mjs <entrada> <saida>"); process.exit(1); }
  for (const f of arquivos(entrada)) {
    const r = await neutralizar(readFileSync(f));
    const destino = join(saida, relative(entrada, f));
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, r.bytes);
    console.log(`${relative(entrada, f)}: ${r.partes} cabeçalho/rodapé esvaziados, ${r.midias} imagem(ns) do timbre removida(s)`);
  }
}
