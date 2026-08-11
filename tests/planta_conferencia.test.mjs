// As duas folhas da conferência de área.
//
// A3 é a folha do SERVIÇO COMPLETO, sem uma linha de diferença — quadro
// analítico, planimétrico e barra lateral. A4 é outra coisa: o arranjo simples,
// retrato, que vai à mesa com o cliente. Confundir as duas foi o que motivou
// estes testes; o que os separa é só `folha`.
//
// Em ambas os códigos dos vértices somem do DESENHO: na prévia eles partem do
// contador do credenciado sem serem reservados, e impressos ao lado de cada
// marco passariam por definitivos.
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

async function textoDe(bytes) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return text.replace(/\s+/g, " ");
}

const planta = (g, opts) => gerarPlantaPdf(dadosPlantaDe(g, { tipoImovel: "matricula", ...opts }));

test("A4 da conferência sai no arranjo simples do modelo", async () => {
  const pdf = await planta(geo(), { folha: "A4", conferencia: true });
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

test("na conferência o desenho não leva código de vértice, mas leva confrontante", async () => {
  const g = geo();
  const a4 = await textoDe(await planta(g, { folha: "A4", conferencia: true }));
  // A4 não tem quadro analítico, então NENHUM código pode sobrar na folha
  assert.doesNotMatch(a4, /DSBN-/, "código de prévia não pode ser impresso no desenho");
  // os vizinhos continuam: é o que o cliente confere na planta
  assert.match(a4, /ESTRADA VICINAL/);
  assert.match(a4, /LINHA FERREA/);
});

test("A3 da conferência segue a organização da planta de posse", async () => {
  const g = geo();
  const a3 = await planta(g, { folha: "A3", conferencia: true });
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
  // sem quadro e sem rótulo no desenho, nenhum código de prévia sobra na folha
  assert.doesNotMatch(t, /DSBN-/);
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
  const g = geo();
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
  const g = geo();
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

test("com glebas, o A4 mostra a área de cada uma e o total no canto", async () => {
  const g = geo();
  const glebas = [glebaDe(g, [0, 1, 2, 3], "GLEBA 1"), glebaDe(g, [10, 11, 12, 13, 14], "GLEBA 2")];
  const t = await textoDe(await planta(g, { folha: "A4", conferencia: true, glebas }));
  assert.match(t, /AREA TOTAL:/);
  // o bloco de identificação do imóvel inteiro sai de cena: quem manda são as
  // glebas, e o A4 não tem espaço para os dois
  assert.doesNotMatch(t, /MATR\.1\.234/);
});
