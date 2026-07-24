import { readFileSync } from "fs";
import { extractText, getDocumentProxy } from "unpdf";

async function debugPdfText() {
  const buf = readFileSync("./reference/PREVIA-FAZENDA-VIBRACAO.pdf");
  const proxy = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(proxy, { mergePages: true });
  
  // Normalizar como o parser faz
  const t = text.replace(/\s+/g, " ");
  
  // Mostrar um trecho ao redor dos códigos de vértice para ver a transição entre linhas
  const COD = /[A-Z0-9_]{1,10}-[MPV]-\d+|[A-Z0-9_]{1,10}-\d+|[A-Z0-9_]{2,15}/g;
  let m;
  let count = 0;
  while ((m = COD.exec(t)) !== null && count < 10) {
    const start = Math.max(0, m.index - 30);
    const end = Math.min(t.length, m.index + m[0].length + 50);
    console.log(`[${count}] pos=${m.index} código="${m[0]}" contexto: ...${t.slice(start, end)}...`);
    count++;
  }
  
  // Verificar se existem códigos de vértice de OUTROS profissionais (não-DSBN)
  console.log("\n=== BUSCANDO CÓDIGOS NÃO-DSBN ===");
  const todosCodeRe = /([A-Z0-9_]{1,10}-[MPV]-\d+)/g;
  const codigos = new Set();
  while ((m = todosCodeRe.exec(t)) !== null) {
    const prefix = m[1].split("-")[0];
    if (prefix !== "DSBN") codigos.add(m[1]);
  }
  console.log("Códigos de outros profissionais encontrados:", [...codigos]);
  
  // Mostrar TODO o texto entre a tabela de vértices
  const inicioTabela = t.indexOf("Vértice");
  const fimTabela = t.indexOf("Data da Geração");
  if (inicioTabela > -1 && fimTabela > -1) {
    const trecho = t.slice(inicioTabela, fimTabela);
    // Mostrar as primeiras 3 linhas de dados (após o cabeçalho)
    console.log("\n=== INÍCIO DA TABELA DE VÉRTICES ===");
    console.log(trecho.slice(0, 800));
    console.log("\n=== FIM DA TABELA (últimos 500 chars) ===");
    console.log(trecho.slice(-500));
  }
}

debugPdfText().catch(console.error);
