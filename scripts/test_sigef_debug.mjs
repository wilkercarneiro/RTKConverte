import { readFileSync } from "fs";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../supabase/functions/_shared/sigef_pdf.ts";

async function testSigef() {
  const buf = readFileSync("./reference/PREVIA-FAZENDA-VIBRACAO.pdf");
  const proxy = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(proxy, { mergePages: true });

  const sigef = parseSigefTexto(text);
  console.log("Cabecalho:", sigef.cabecalho);
  console.log("Qtd linhas extraidas:", sigef.linhas.length);
  console.log("Linha 1:", sigef.linhas[0]);
  console.log("Linha 2:", sigef.linhas[1]);
  console.log("Linha 69:", sigef.linhas[68]);
  console.log("Linha 70:", sigef.linhas[69]);
}

testSigef().catch(console.error);
