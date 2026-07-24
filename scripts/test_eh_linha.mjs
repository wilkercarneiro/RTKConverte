// Testa se EH_LINHA_VERTICE aceita vários formatos de código de vértice

const EH_LINHA_VERTICE_ATUAL = (t) => /^[A-Z0-9_]{1,10}-[MPV]-\d+\s*-?\d+°/.test(t.trim());

const testes = [
  "DSBN-M-3605 -39°05'04,737\"",     // formato padrão
  "ABC-M-100 -39°05'03,926\"",        // outro profissional com M
  "ABC-P-101 -39°05'02,765\"",        // outro profissional com P  
  "XYZ-100 -39°10'10,000\"",          // sem M/P/V
  "CRTR-V-999 -39°10'10,000\"",       // outro com V
  "AB-1234 -39°10'10,000\"",          // 2 chars + número
  "ABCDE12345 -39°10'10,000\"",       // sem hífens
  "A1B2-M-1 -39°10'10,000\"",         // misto alfanumérico
];

console.log("=== EH_LINHA_VERTICE ATUAL ===");
for (const t of testes) {
  const r = EH_LINHA_VERTICE_ATUAL(t);
  console.log(`  ${r ? "✅" : "❌"} "${t.slice(0, 40)}" => ${r}`);
}

// Proposta de fix: aceitar qualquer código seguido de coordenada GMS
const EH_LINHA_VERTICE_FIX = (t) => /^[A-Z0-9_]{2,15}(?:-[A-Z0-9_]+)*\s*-?\d+°/.test(t.trim());

console.log("\n=== EH_LINHA_VERTICE CORRIGIDO ===");
for (const t of testes) {
  const r = EH_LINHA_VERTICE_FIX(t);
  console.log(`  ${r ? "✅" : "❌"} "${t.slice(0, 40)}" => ${r}`);
}
