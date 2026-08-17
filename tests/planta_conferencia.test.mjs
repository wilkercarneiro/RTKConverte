// As duas folhas da conferência de área.
//
// A3 é a folha do SERVIÇO COMPLETO, sem uma linha de diferença — quadro
// analítico, planimétrico e barra lateral. A4 é outra coisa: o arranjo simples,
// retrato, que vai à mesa com o cliente. Confundir as duas foi o que motivou
// estes testes; o que os separa é só `folha`.
//
// Em ambas os códigos dos vértices SAEM no desenho, no formato da prévia:
// "P-1", "P-2" (ver codigoConferencia). Eles já saíram suprimidos, quando a
// prévia numerava com o prefixo do credenciado e o código impresso ao lado do
// marco passava por definitivo; hoje o que se garante é o contrário — o código
// curto aparece, e nenhum código oficial pode vazar para a folha.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { dadosPlantaDe, ehFolha, entrada, glebaDe } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const geo = () => geometriaDoCalculo(montarServico(entrada(), proj4));
// Geometria da PRÉVIA: códigos alocados no formato da conferência (P-1, P-2…),
// que é o que o gerar-documentos manda para a planta quando a modalidade é
// conferência. Testar a prévia com códigos oficiais testaria o que não existe.
const geoPrevia = () =>
  geometriaDoCalculo(montarServico({ ...entrada({ comCodigo: false }), estiloCodigo: "conferencia" }, proj4));

async function textoDe(bytes) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return text.replace(/\s+/g, " ");
}

const planta = (g, opts) => gerarPlantaPdf(dadosPlantaDe(g, { tipoImovel: "matricula", ...opts }));

test("A4 da conferência sai no arranjo simples do modelo", async () => {
  const pdf = await planta(geoPrevia(), { folha: "A4", conferencia: true });
  assert.equal(await ehFolha(pdf, "A4"), true, "A4 é retrato (210×297)");
  const t = await textoDe(pdf);
  // a faixa do rodapé com as duas células do modelo
  assert.match(t, /CARIMBO DA EMPRESA/);
  assert.match(t, /PLANTA DE SITUAÇÃO/);
  // o selo, com os seis campos
  for (const campo of ["PROPRIETÁRIO:", "RESPONSÁVEL TÉCNICO:", "MUNICÍPIO:", "ESCALA:", "DATA:", "FOLHA:"]) {
    assert.ok(t.includes(campo), `faltou ${campo} no selo`);
  }
  assert.match(t, /AREA TOTAL:/);
  // o que o modelo NÃO tem
  assert.doesNotMatch(t, /QUADRO ANALÍTICO/);
  assert.doesNotMatch(t, /PLANIMÉTRICO DO IMÓVEL/);
  assert.doesNotMatch(t, /SELO DE RECONHECIMENTO/);
});

test("na conferência o desenho leva o código curto da prévia, e nenhum oficial", async () => {
  const a4 = await textoDe(await planta(geoPrevia(), { folha: "A4", conferencia: true }));
  // o A4 não tem quadro analítico: todo código na folha veio do desenho
  assert.doesNotMatch(a4, /DSBN-/, "código do credenciado não pode aparecer numa prévia");
  const codigos = new Set(a4.match(/\b[MPV]-\d+\b/g) ?? []);
  assert.ok(codigos.size >= 10, `poucos códigos no desenho: ${[...codigos].join(", ")}`);
  assert.ok([...codigos].some((c) => c.startsWith("P-")), "os pontos saem como P-n");
  // os vizinhos continuam: é o que o cliente confere na planta
  assert.match(a4, /ESTRADA VICINAL/);
  assert.match(a4, /LINHA FERREA/);
});

test("o código da prévia é curto: nada de zero à esquerda nem prefixo", async () => {
  const a4 = await textoDe(await planta(geoPrevia(), { folha: "A4", conferencia: true }));
  for (const c of new Set(a4.match(/\b[MPV]-\d+\b/g) ?? [])) {
    assert.doesNotMatch(c, /-0\d/, `${c} tem zero à esquerda`);
  }
});

test("A3 da conferência segue a organização da planta de posse", async () => {
  const a3 = await planta(geoPrevia(), { folha: "A3", conferencia: true });
  assert.equal(await ehFolha(a3, "A3"), true);
  const t = await textoDe(a3);
  // barra lateral inteira, menos o quadro analítico: é a tabela que o SIGEF
  // confere, e a prévia ainda não passou por ele
  assert.doesNotMatch(t, /QUADRO ANALÍTICO/);
  assert.match(t, /PLANTA DE SITUAÇÃO/);
  assert.match(t, /CARIMBO DA EMPRESA/);
  assert.match(t, /PLANIMÉTRICO DO IMÓVEL/);
  assert.match(t, /RESPONSÁVEL TÉCNICO/);
  assert.match(t, /01 001 A3/);
  // sem quadro analítico, os códigos da folha são os do desenho — e são os curtos
  assert.doesNotMatch(t, /DSBN-/);
  assert.match(t, /\bP-\d+\b/);
});

test("a organização de posse não vaza para o serviço completo de matrícula", async () => {
  const t = await textoDe(await planta(geo(), {}));
  // sem `conferencia`, a matrícula continua com o quadro analítico de sempre
  assert.match(t, /QUADRO ANALÍTICO/);
  assert.match(t, /DSBN-/);
});

test("fora da conferência nada muda: o A1 continua com os códigos no desenho", async () => {
  const g = geo();
  const semQuadro = await textoDe(await gerarPlantaPdf({
    ...dadosPlantaDe(g, { tipoImovel: "posse" }),   // posse não tem quadro analítico
  }));
  // sem quadro analítico e sem o selo de prévia, os códigos só podem ter vindo
  // do desenho — é a prova de que a supressão é exclusiva da conferência
  assert.match(semQuadro, /DSBN-/);
});

test("a prévia pode omitir matrícula, nome da fazenda e TRT", async () => {
  const g = geoPrevia();
  const completa = await textoDe(await planta(g, { folha: "A3", conferencia: true }));
  // com tudo à vista, os três aparecem — é o ponto de partida da comparação
  assert.match(completa, /Matrícula do Imóvel:/);
  assert.match(completa, /FAZENDA SALGADA VELHA/);
  assert.match(completa, /TRT:/);

  const enxuta = await textoDe(await planta(g, {
    folha: "A3", conferencia: true,
    exibir: { matricula: false, denominacao: false, trt: false },
  }));
  assert.doesNotMatch(enxuta, /Matrícula do Imóvel:/);
  assert.doesNotMatch(enxuta, /Código do Cartório/);
  assert.doesNotMatch(enxuta, /MATR\. = MATRÍCULA/);
  assert.doesNotMatch(enxuta, /FAZENDA SALGADA VELHA/);
  assert.doesNotMatch(enxuta, /TRT:/);
  // o que não foi desmarcado continua: esconder um campo não pode levar outro
  assert.match(enxuta, /Código INCRA:/);
  assert.match(enxuta, /Município\/UF:/);
  assert.match(enxuta, /RESPONSÁVEL TÉCNICO/);
});

test("cada campo é independente dos outros", async () => {
  const g = geoPrevia();
  const soSemTrt = await textoDe(await planta(g, { folha: "A3", conferencia: true, exibir: { trt: false } }));
  assert.doesNotMatch(soSemTrt, /TRT:/);
  assert.match(soSemTrt, /Matrícula do Imóvel:/);
  assert.match(soSemTrt, /FAZENDA SALGADA VELHA/);
});

test("sem `exibir`, a planta sai completa — inclusive fora da conferência", async () => {
  const t = await textoDe(await planta(geo(), {}));
  assert.match(t, /Matrícula do Imóvel:/);
  assert.match(t, /TRT:/);
  assert.match(t, /FAZENDA SALGADA VELHA/);
});

// A escolha "Matrícula ou posse" da tela chega aqui como `tipoImovel`. É o que
// decide se a prévia imprime o documento do imóvel ou "(POSSE)" — um posseiro
// não tem matrícula nem cartório, e imprimir os dois seria inventar registro.
test("na prévia, matrícula e posse imprimem coisas diferentes", async () => {
  const g = geoPrevia();
  const comMatricula = await textoDe(await planta(g, { folha: "A3", conferencia: true }));
  assert.match(comMatricula, /MATR\.1\.234/, "matrícula sai com o número e o CNS");
  assert.doesNotMatch(comMatricula, /\(POSSE\)/);

  const comPosse = await textoDe(await gerarPlantaPdf(
    dadosPlantaDe(g, { tipoImovel: "posse", folha: "A3", conferencia: true }),
  ));
  assert.match(comPosse, /POSSE/, "posse sai marcada como posse");
  assert.doesNotMatch(comPosse, /MATR\.1\.234/, "posse não pode imprimir matrícula nenhuma");
  // e os códigos curtos continuam no desenho, seja qual for a situação
  assert.match(comPosse, /\bP-\d+\b/);
});

test("com glebas, o A4 mostra a área de cada uma e o total no canto", async () => {
  const g = geoPrevia();
  const glebas = [glebaDe(g, [0, 1, 2, 3], "GLEBA 1"), glebaDe(g, [10, 11, 12, 13, 14], "GLEBA 2")];
  const t = await textoDe(await planta(g, { folha: "A4", conferencia: true, glebas }));
  assert.match(t, /AREA TOTAL:/);
  // o bloco de identificação do imóvel inteiro sai de cena: quem manda são as
  // glebas, e o A4 não tem espaço para os dois
  assert.doesNotMatch(t, /MATR\.1\.234/);
});
