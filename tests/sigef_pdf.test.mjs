// Regressão do parser da prévia do SIGEF: códigos de vértice com sufixo
// alfanumérico (AC9-M-RL49) faziam a linha inteira ser descartada, e a planta
// saía com vértices faltando. Caso real: FAZENDA MONOINO - Parte 1 (matr. 13146).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSigefTexto } from "../supabase/functions/_shared/sigef_pdf.ts";

const CABECALHO =
  "MEMORIAL DESCRITIVO " +
  "Denominação: FAZENDA MONOINO - Parte 1 " +
  "Proprietário(a): PEDRO ATHANAGILDO CALMON DE BITTENCOURT " +
  "Matrícula do imóvel: 13146 " +
  "Município/UF: Serra Preta-BA " +
  "Responsável Técnico(a): DANIEL NASCIMENTO SANTOS " +
  "Formação:Técnico(a) em Agropecuária " +
  "Código de credenciamento: DSBN " +
  "Natureza da Área: Particular " +
  "CPF/CNPJ: 005.899.265-00 " +
  "Código INCRA/SNCR:3130922939626 " +
  "Cartório (CNS): (01.334-2) Ipirá - BA " +
  "Conselho Profissional:05788394589/BA " +
  "Documento de RT:20210405061 - BA " +
  "Área (Sistema Geodésico Local)*: 235,7048 ha " +
  "Perímetro (m): 6.222,62 m " +
  "DESCRIÇÃO DA PARCELA " +
  "Código Longitude Latitude Altitude (m) Código Azimute Dist. (m) Confrontações ";

// Anel com os três formatos de código que aparecem no PDF real:
// DSBN-P-9999 (numérico), XMMS-P-0379 (zero à esquerda) e AC9-M-RL49 (sufixo
// alfanumérico). Inclui o rodapé de página no meio, como na extração real.
const LINHAS =
  "XMMS-P-0380 -39°18'34,567\" -12°11'48,541\" 336.82 XMMS-P-0379 269°22' 288,53 " +
  "(MATR.10.637/CNS.00.811-0) FAZENDA LAGOA DA CRUZ LUCILIA NAVARRO SILVA CPF:33... " +
  "XMMS-P-0379 -39°18'44,111\" -12°11'48,644\" 308.91 AC9-M-RL49 269°15' 173,68 " +
  "(MATR.10.637/CNS.00.811-0) FAZENDA LAGOA DA CRUZ LUCILIA NAVARRO SILVA CPF:33... " +
  "Este Memorial Descritivo foi gerado automaticamente pelo Sigef. Página 1/3 " +
  "AC9-M-RL49 -39°18'49,856\" -12°11'48,718\" 269.903 AC9-M-RL11 325°36' 520,91 " +
  "(MATR.7.498/CNS.00.811-0) FAZENDA FORMOSA 2 RAMON RAMONY MORADILLO PINTO CPF:... " +
  "AC9-M-RL11 -39°18'59,588\" -12°11'34,729\" 251.971 AC9-M-RL16 343°41' 7,99 " +
  "(MATR.7.498/CNS.00.811-0) FAZENDA FORMOSA 2 RAMON RAMONY MORADILLO PINTO CPF:... " +
  "AC9-M-RL16 -39°19'03,277\" -12°11'16,089\" 259.555 DSBN-M-3153 15°04' 604,33 " +
  "(MATR.1.257/CNS.00.990-2) FAZENDA PRINCESA DA SERRA ANGELA MARIA MASCA... CPF... " +
  "DSBN-M-3153 -39°18'58,075\" -12°10'57,101\" 330.526 XMMS-P-0380 88°48' 56,3 " +
  "(MATR.799/CNS.00.990-2) FAZENDA EMANOEL EMERSON LUIZ REBOUCAS ARAPIRACA CPF:... " +
  "Data da Geração: 19/11/2025 14:05";

test("códigos de vértice com sufixo alfanumérico (AC9-M-RL49) não são descartados", () => {
  const { cabecalho, linhas } = parseSigefTexto(CABECALHO + LINHAS);

  assert.equal(cabecalho.areaHa, "235,7048");
  assert.equal(cabecalho.perimetroM, "6.222,62");
  assert.deepEqual(linhas.map((l) => l.codigo), [
    "XMMS-P-0380", "XMMS-P-0379", "AC9-M-RL49", "AC9-M-RL11", "AC9-M-RL16", "DSBN-M-3153",
  ]);

  const rl49 = linhas[2];
  assert.equal(rl49.lon, "-39°18'49,856\"");
  assert.equal(rl49.lat, "-12°11'48,718\"");
  assert.equal(rl49.alt, "269.903");
  assert.equal(rl49.vante, "AC9-M-RL11");
  assert.equal(rl49.azimute, "325°36'");
  assert.equal(rl49.dist, "520,91");
  assert.match(rl49.confrontacao, /FAZENDA FORMOSA 2/);
  // rodapé de página não vaza para a confrontação da linha anterior
  assert.doesNotMatch(linhas[1].confrontacao, /Este Memorial/);
});

test("encadeamento quebrado do anel falha em vez de gerar planta com pontos faltando", () => {
  // remove uma linha do meio: o vante de XMMS-P-0379 deixa de ter linha própria
  const truncado = CABECALHO + LINHAS.replace(
    /AC9-M-RL49 -39°18'49,856".*?CPF:\.\.\. /s,
    "",
  );
  assert.throws(
    () => parseSigefTexto(truncado),
    // a mensagem nomeia o memorial: numa prévia de glebas são vários, e sem o
    // nome o operador não sabe em qual deles a leitura parou
    /Leitura do PDF do SIGEF \(FAZENDA MONOINO - Parte 1\) incompleta/,
  );
});

// Imóvel litorâneo: a altitude geodésica fica ABAIXO do elipsoide e sai negativa
// no PDF ("-12.222"). A regex da linha só aceitava dígitos na altitude, então
// toda linha negativa era descartada e a leitura quebrava o encadeamento.
// Caso real: FAZENDA SANTA BARBARA - Parte 1 (matr. 315, São Francisco do Conde),
// que lia 5 dos 26 vértices e falhava com
// "o vértice DJ9-M-2490 aponta para ONDE-P-33446, mas a linha seguinte lida é DSBN-M-4838".
const ANEL_LITORANEO =
  "DJ9-M-2491 -38°37'37,440\" -12°36'14,174\" 1.05 DJ9-M-2490 116°23' 262,66 " +
  "(MATR.287\CNS.00.701-3) FAZENDA GUAIBA\ ADNIL DE FATIMA SILVA FALCAO BAHIA\ C... " +
  "DJ9-M-2490 -38°37'29,644\" -12°36'17,973\" 23.11 ONDE-P-33446 207°22' 485,52 " +
  "(MATR.325\CNS.00.701-3) FAZENDA ENGENHO NOVO\ GERALDO MOREIRA DE OLIVEIRA\ CP... " +
  "ONDE-P-33446 -38°37'37,040\" -12°36'32,004\" -6.74 ONDE-P-33447 210°17' 331,0 " +
  "(MATR.325\CNS.00.701-3) FAZENDA ENGENHO NOVO\ GERALDO MOREIRA DE OLIVEIRA\ CP... " +
  "ONDE-P-33447 -38°37'42,573\" -12°36'41,304\" -9.13 DSBN-P-16858 246°30' 18,03 " +
  "(MATR.325\CNS.00.701-3) FAZENDA ENGENHO NOVO\ GERALDO MOREIRA DE OLIVEIRA\ CP... " +
  "DSBN-P-16858 -38°37'47,618\" -12°36'48,163\" -12.222 DSBN-M-4838 246°52' 69,5 " +
  "(MATR.51\CNS.00.701-3) FAZENDA ENGENHO DE BAIXO\ ARMANDO TOURINHO RIBEIRO\ CP... " +
  "DSBN-M-4838 -38°38'00,379\" -12°36'37,756\" 4.911 DJ9-M-2491 332°03' 8,25 BA-522 " +
  "Data da Geração: 09/09/2026 12:10";

test("altitude negativa (imóvel litorâneo) não faz a linha ser descartada", () => {
  const { linhas } = parseSigefTexto(CABECALHO + ANEL_LITORANEO);

  // o anel inteiro é lido, não só os vértices de altitude positiva
  assert.deepEqual(
    linhas.map((l) => l.codigo),
    ["DJ9-M-2491", "DJ9-M-2490", "ONDE-P-33446", "ONDE-P-33447", "DSBN-P-16858", "DSBN-M-4838"],
  );
  // o sinal é preservado: a altitude vai para o memorial como está no PDF
  assert.deepEqual(
    linhas.map((l) => l.alt),
    ["1.05", "23.11", "-6.74", "-9.13", "-12.222", "4.911"],
  );
  assert.equal(linhas[2].confrontacao.startsWith("(MATR.325"), true);
});
