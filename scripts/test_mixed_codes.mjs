import { parseSigefTexto } from "../supabase/functions/_shared/sigef_pdf.ts";

// Simula texto de PDF SIGEF com vértices de diferentes profissionais
const textoMisto = "georreferenciado. Página 1/3 MEMORIAL DESCRITIVO " +
  "Denominação: FAZENDA TESTE MISTO - Parte 1 " +
  "Proprietário(a): JOÃO DA SILVA " +
  "Matrícula do imóvel: 1234 " +
  "Município/UF: Araci-BA " +
  "Responsável Técnico(a): DANIEL SANTOS " +
  "Formação: Técnico(a) em Agropecuária " +
  "Código de credenciamento: DSBN " +
  "Natureza da Área: Particular " +
  "CPF/CNPJ: 123.456.789-00 " +
  "Código INCRA/SNCR: 3120100288601 " +
  "Cartório (CNS): (00.803-7) Araci - BA " +
  "Conselho Profissional: 05788394589/BA " +
  "Documento de RT: BR20250804764 - BA " +
  "Área (Sistema Geodésico Local): 50,0000 ha " +
  "Perímetro (m): 2.000,00 m " +
  "Vértice Longitude Latitude Altitude Vértice Azimute Distância Confrontante " +
  "DSBN-M-3605 -39°05'04,737\" -11°23'44,344\" 300.051 ABC-M-100 129°10' 31,72 " +
  "(MATR.123) FAZENDA VIZINHA\\ JOSE DA SILVA\\ CPF:111.222.333-44 " +
  "ABC-M-100 -39°05'03,926\" -11°23'44,996\" 299.644 ABC-P-101 131°05' 46,70 " +
  "(MATR.123) FAZENDA VIZINHA\\ JOSE DA SILVA\\ CPF:111.222.333-44 " +
  "ABC-P-101 -39°05'02,765\" -11°23'45,995\" 301.859 DSBN-P-13130 129°47' 33,03 " +
  "BA 408 " +
  "DSBN-P-13130 -39°05'01,928\" -11°23'46,683\" 299.439 DSBN-M-3605 130°04' 43,39 " +
  "CORREDOR " +
  "Data da Geração: 24/07/2026 17:00";

console.log("=== TESTE COM PDF MISTO (DSBN + ABC) ===");
try {
  const result = parseSigefTexto(textoMisto);
  console.log("Linhas parseadas:", result.linhas.length);
  result.linhas.forEach((l, i) => {
    console.log(`  [${i}] ${l.codigo} → ${l.vante} | lon=${l.lon} lat=${l.lat} az=${l.azimute} dist=${l.dist}`);
    console.log(`       confrontação: "${l.confrontacao.slice(0, 60)}"`);
  });
  const primeiro = result.linhas[0].codigo;
  const ultimoVante = result.linhas[result.linhas.length - 1].vante;
  console.log(`\nAnel: ${primeiro} → ${ultimoVante} = ${primeiro === ultimoVante ? "FECHOU" : "NÃO FECHOU!!"}`);
} catch (e) {
  console.log("ERRO:", e.message);
}

// Teste com formato XYZ-NNN (sem M/P/V)
const textoSemMPV = "georreferenciado. Página 1/3 MEMORIAL DESCRITIVO " +
  "Denominação: FAZENDA SEM MPV " +
  "Proprietário(a): MARIA DA SILVA " +
  "Matrícula do imóvel: 5678 " +
  "Município/UF: Tucano-BA " +
  "Responsável Técnico(a): OUTRO TECNICO " +
  "Formação: Engenheiro(a) Agrônomo(a) " +
  "Código de credenciamento: XYZ " +
  "Natureza da Área: Particular " +
  "CPF/CNPJ: 999.888.777-66 " +
  "Código INCRA/SNCR: 9999999999999 " +
  "Cartório (CNS): (00.123-4) Tucano - BA " +
  "Conselho Profissional: 12345678/BA " +
  "Documento de RT: BR20261234567 - BA " +
  "Área (Sistema Geodésico Local): 30,0000 ha " +
  "Perímetro (m): 1.500,00 m " +
  "Vértice Longitude Latitude Altitude Vértice Azimute Distância Confrontante " +
  "XYZ-100 -39°10'10,000\" -11°20'20,000\" 250.000 XYZ-101 90°00' 100,00 " +
  "ESTRADA " +
  "XYZ-101 -39°10'06,780\" -11°20'20,000\" 250.000 XYZ-102 180°00' 100,00 " +
  "VIZINHO " +
  "XYZ-102 -39°10'06,780\" -11°20'23,240\" 250.000 XYZ-100 270°00' 100,00 " +
  "VIZINHO " +
  "Data da Geração: 24/07/2026 17:00";

console.log("\n=== TESTE COM FORMATO XYZ-NNN (sem M/P/V) ===");
try {
  const result2 = parseSigefTexto(textoSemMPV);
  console.log("Linhas parseadas:", result2.linhas.length);
  result2.linhas.forEach((l, i) => {
    console.log(`  [${i}] ${l.codigo} → ${l.vante} | lon=${l.lon} lat=${l.lat}`);
  });
} catch (e) {
  console.log("ERRO:", e.message);
}
