// Gera reference/memorial-template.docx (esqueleto OOXML com estilos, base do
// memorial — o corpo é injetado pela Edge Function gerar-documentos).
import { writeFileSync } from "node:fs";
import JSZip from "jszip";
import { buildDocxSkeleton } from "../supabase/functions/_shared/docx.ts";

const zip = new JSZip();
for (const [path, content] of buildDocxSkeleton()) zip.file(path, content);
const docxBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync(new URL("../reference/memorial-template.docx", import.meta.url), docxBuf);
console.log("memorial-template.docx:", docxBuf.length, "bytes");
