import { readFileSync } from "fs";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../supabase/functions/_shared/sigef_pdf.ts";

async function debugRegex() {
  const buf = readFileSync("./reference/PREVIA-FAZENDA-VIBRACAO.pdf");
  const proxy = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(proxy, { mergePages: true });
  
  const t = text.replace(/\s+/g, " ");
  
  // Testar o regex rowRe exatamente como o parser faz
  const COD = "[A-Z0-9_]{1,10}-[MPV]-\\d+|[A-Z0-9_]{1,10}-\\d+|[A-Z0-9_]{2,15}";
  const GMS = `-?\\d+°\\d+'[\\d,]+"`;
  const rowRe = new RegExp(
    `(${COD})\\s+(${GMS})\\s+(${GMS})\\s+([\\d.,]+)\\s+(${COD})\\s+(\\d+°\\d+')\\s+([\\d.,]+)\\s+` +
    `(.*?)(?=(?:${COD})\\s+-|Este Memorial|Data da Geração|$)`,
    "g",
  );
  
  let m;
  let count = 0;
  while ((m = rowRe.exec(t)) !== null) {
    count++;
    if (count <= 5 || count >= 69) {
      console.log(`Linha ${count}: codigo=${m[1]} lon=${m[2]} lat=${m[3]} alt=${m[4]} vante=${m[5]} az=${m[6]} dist=${m[7]}`);
      console.log(`  confrontacao: "${m[8].trim().slice(0, 80)}..."`);
    }
  }
  console.log(`\nTotal linhas parseadas: ${count}`);
  
  // Agora testar com parseSigefTexto
  const sigef = parseSigefTexto(text);
  console.log(`\nparseSigefTexto retornou ${sigef.linhas.length} linhas`);
  console.log(`Primeiro: ${sigef.linhas[0].codigo} → ${sigef.linhas[0].vante}`);
  console.log(`Último: ${sigef.linhas[sigef.linhas.length-1].codigo} → ${sigef.linhas[sigef.linhas.length-1].vante}`);
  
  // Verificar se o anel fecha
  const primeiro = sigef.linhas[0].codigo;
  const ultimoVante = sigef.linhas[sigef.linhas.length-1].vante;
  console.log(`\nAnel fecha? primeiro=${primeiro} ultimoVante=${ultimoVante} → ${primeiro === ultimoVante ? "SIM" : "NÃO!!"}`);

  // Verificar se todos os códigos são únicos
  const codigos = sigef.linhas.map(l => l.codigo);
  const unicos = new Set(codigos);
  console.log(`Códigos únicos: ${unicos.size}/${codigos.length}`);
  if (unicos.size !== codigos.length) {
    const dupes = codigos.filter((c, i) => codigos.indexOf(c) !== i);
    console.log("DUPLICADOS:", dupes);
  }
  
  // Verificar se a cadeia de vértices é contínua
  let quebras = 0;
  for (let i = 0; i < sigef.linhas.length - 1; i++) {
    if (sigef.linhas[i].vante !== sigef.linhas[i+1].codigo) {
      console.log(`QUEBRA na posição ${i}: ${sigef.linhas[i].vante} ≠ ${sigef.linhas[i+1].codigo}`);
      quebras++;
    }
  }
  console.log(`Quebras na cadeia: ${quebras}`);
}

debugRegex().catch(console.error);
