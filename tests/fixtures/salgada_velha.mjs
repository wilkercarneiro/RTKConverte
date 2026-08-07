// Anel real da FAZENDA SALGADA VELHA (serviço 915ee577), como está no banco.
// Quatro vértices M: dois abrem faixa de domínio marcada só por tipo_limite LA3
// (ESTRADA VICINAL e LINHA FERREA), os outros dois fecham essas divisas.
//
// Serve de fixture para o lacre de não-regressão do fluxo completo e para os
// testes das modalidades novas — todos partindo do MESMO anel, para que a
// comparação entre modalidades seja sobre o que mudou, não sobre a entrada.

// [ordem, E, N, tipo, código, descritivo, tipoLimite]
export const ANEL = [
  [0, 481057.98106081394, 8733205.543815147, "P", "DSBN-P-14300", "", null],
  [1, 481091.17227876623, 8733180.162392892, "P", "DSBN-P-14301", "", null],
  [2, 481129.38731956424, 8733163.99848221, "P", "DSBN-P-14302", "", null],
  [3, 481151.05571940786, 8733154.674082594, "M", "DSBN-M-4542", "ESTRADA VICINAL", "LA3"],
  [4, 480994.83755434374, 8732859.776446884, "M", "DSBN-M-4543", "", null],
  [5, 480991.23179985204, 8732860.388569724, "P", "DSBN-P-14303", "", null],
  [6, 480950.05820086517, 8732859.565060847, "P", "DSBN-P-14304", "", null],
  [7, 480908.9468947856, 8732855.9464604, "P", "DSBN-P-14305", "", null],
  [8, 480867.59155547485, 8732855.061302854, "P", "DSBN-P-14306", "", null],
  [9, 480840.92733701493, 8732859.253039302, "P", "DSBN-P-14307", "", null],
  [10, 480797.4720244345, 8732873.846928682, "P", "DSBN-P-14308", "", null],
  [11, 480761.50113540253, 8732886.786721932, "P", "DSBN-P-14309", "", null],
  [12, 480738.1035158911, 8732899.918468961, "P", "DSBN-P-14310", "", null],
  [13, 480716.247785289, 8732918.364859488, "P", "DSBN-P-14311", "", null],
  [14, 480674.3801247276, 8732962.200344961, "M", "DSBN-P-14312", "LINHA FERREA", "LA3"],
  [15, 480676.76943285455, 8732969.02056894, "M", "DSBN-M-4544", "", null],
  [16, 480683.13184016175, 8732969.116622927, "P", "DSBN-P-14313", "", null],
  [17, 480705.3724653332, 8732965.383031834, "P", "DSBN-P-14314", "", null],
  [18, 480719.7040410012, 8732963.948210934, "P", "DSBN-P-14315", "", null],
  [19, 480733.6715379215, 8732963.342468597, "P", "DSBN-P-14316", "", null],
  [20, 480746.21390743623, 8732964.609469622, "P", "DSBN-P-14317", "", null],
  [21, 480761.42074299813, 8732968.673171172, "P", "DSBN-P-14318", "", null],
  [22, 480791.7446588356, 8732974.95759032, "P", "DSBN-P-14319", "", null],
  [23, 480826.7040410805, 8732981.336951759, "P", "DSBN-P-14320", "", null],
  [24, 480869.42001705704, 8732987.01454578, "P", "DSBN-P-14321", "", null],
  [25, 480900.87719967583, 8733023.062491935, "P", "DSBN-P-14322", "", null],
  [26, 480932.09255850554, 8733058.311665222, "P", "DSBN-P-14323", "", null],
  [27, 480959.09967574227, 8733088.52098034, "P", "DSBN-P-14324", "", null],
  [28, 480996.4009725211, 8733130.408233492, "P", "DSBN-P-14325", "", null],
  [29, 481012.20478540566, 8733149.52257515, "P", "DSBN-P-14326", "", null],
  [30, 481024.03964597406, 8733168.603799041, "P", "DSBN-P-14327", "", null],
  [31, 481032.5072586349, 8733194.686032014, "P", "DSBN-P-14328", "", null],
];

/** ServicoInput do anel acima. `comCodigo: false` força a alocação de códigos. */
export function entrada({ comCodigo = true, contadores } = {}) {
  return {
    fusoUtm: 24,
    prefixo: "DSBN",
    contadores: contadores ?? { M: 0, P: 0, V: 0 },
    vertices: ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
      ordem, numTxt: ordem + 1, e, n, h: 360, sigmaPos: 0.01, sigmaH: 0.01,
      tipo, metodo: "PG6", codigoManual: comCodigo ? codigo : null, inserido: false,
      descritivo, tipoLimite, ehVia: false,
    })),
  };
}

/** Cabeçalho/carimbo mínimo para exercitar gerarPlantaPdf a partir de uma geometria. */
export function dadosPlantaDe(g, extra = {}) {
  return {
    vertices: g.vertices,
    trechos: g.trechos,
    denominacao: "FAZENDA SALGADA VELHA",
    proprietarios: [{ nome: "FULANO DE TAL", cpf: "000.000.000-00" }],
    matricula: "1.234", cns: "00.810-2", sncr: "", municipioUf: "ARACI-BA",
    areaFmt: g.areaFmt, tarefasFmt: "154,32", perimetroFmt: g.perimetroFmt,
    mcAbs: 39, fuso: 24, latMediaDeg: g.latMediaDeg, trt: "BR20260807",
    rt: { nome: "RT TESTE", formacao: "Técnico", conselhoSigla: "CFTA", conselhoNumero: "1", codigoCredenciado: "DSBN" },
    desenhista: "TESTE", dataStr: "07/08/2026",
    ...extra,
  };
}

/** Milímetro em pontos PDF, e as folhas em pontos. */
export const MM = 2.834645669;
export const FOLHAS_PT = {
  A1: [841 * MM, 594 * MM],
  A3: [420 * MM, 297 * MM],
  A4: [297 * MM, 210 * MM],
};

/**
 * Dimensões da primeira página de um PDF.
 *
 * Lido pelo pdf-lib, não por regex: o pdf-lib grava os objetos comprimidos, então
 * a string "MediaBox" não existe em texto puro no arquivo.
 */
export async function dimensoesPdf(bytes) {
  const { PDFDocument } = await import("pdf-lib");
  const { width, height } = (await PDFDocument.load(bytes)).getPage(0).getSize();
  return { w: width, h: height };
}

/**
 * Dois PDFs contêm o mesmo desenho?
 *
 * Não dá para comparar os bytes crus: o pdf-lib carimba CreationDate/ModDate com
 * a hora da geração, então dois PDFs idênticos gerados em segundos diferentes
 * divergem. Aqui as duas datas são normalizadas antes da comparação — o que
 * sobra é o conteúdo, que é o que os testes querem afirmar.
 */
export async function mesmoDesenho(a, b) {
  const { PDFDocument } = await import("pdf-lib");
  const zero = new Date(0);
  const normalizar = async (bytes) => {
    const doc = await PDFDocument.load(bytes);
    doc.setCreationDate(zero);
    doc.setModificationDate(zero);
    return Buffer.from(await doc.save());
  };
  return Buffer.compare(await normalizar(a), await normalizar(b)) === 0;
}

/** Confere a folha de um PDF contra FOLHAS_PT, com tolerância de 2pt. */
export async function ehFolha(bytes, nome) {
  const { w, h } = await dimensoesPdf(bytes);
  const [ew, eh] = FOLHAS_PT[nome];
  return Math.abs(w - ew) < 2 && Math.abs(h - eh) < 2
    ? true
    : `esperava ${nome} (${ew.toFixed(1)}×${eh.toFixed(1)}), veio ${w.toFixed(1)}×${h.toFixed(1)}`;
}
