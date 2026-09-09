// Parser do texto extraído do PDF de prévia/certificação do SIGEF.
// A extração de texto (unpdf) é feita pelo chamador; aqui só interpretamos.

export interface CabecalhoSigef {
  denominacao: string;        // "FAZENDA VIBRAÇÃO - Parte 1"
  proprietario: string;
  matricula: string;
  municipioUf: string;        // "Araci-BA"
  rtNome: string;
  formacao: string;           // "Técnico(a) em Agropecuária"
  codigoCredenciamento: string;
  areaHa: string;             // "84,0638"
  naturezaArea: string;
  cpf: string;
  sncr: string;
  cns: string;                // "00.803-7"
  cartorioLocal: string;      // "Araci - BA"
  conselho: string;           // "05788394589/BA"
  documentoRt: string;        // "BR20250804764 - BA"
  perimetroM: string;         // "4.077,80"
  dataGeracao: string | null; // "02/06/2026 14:56"
}

export interface LinhaSigef {
  codigo: string;      // vértice de origem
  lon: string;         // -39°05'04,737"
  lat: string;
  alt: string;         // 300.051 (como no PDF)
  vante: string;       // vértice de destino
  azimute: string;     // 129°10'
  dist: string;        // 31,72
  confrontacao: string; // truncada no PDF (usar descritivo do banco quando possível)
}

export interface DadosSigef { cabecalho: CabecalhoSigef; linhas: LinhaSigef[] }

function campo(texto: string, re: RegExp): string {
  const m = texto.match(re);
  return m ? m[1].trim() : "";
}

/**
 * Corta o texto do PDF em UM PEDAÇO POR MEMORIAL.
 *
 * A prévia de um serviço de glebas não é um memorial: é um memorial por gleba,
 * emendado num PDF só ("PREVIA TOTAL"). Cada bloco tem cabeçalho, área,
 * perímetro e anel PRÓPRIOS. Lidos juntos, as linhas das três glebas viram uma
 * tabela só, o encadeamento vante→código quebra na virada de gleba e a leitura
 * falha inteira — era o que acontecia com FAZENDA LAMEIRO DA BOA VISTA.
 *
 * O corte é feito em "MEMORIAL DESCRITIVO" seguido de "Denominação:", porque a
 * expressão sozinha também aparece no rodapé de toda página ("Este Memorial
 * Descritivo foi gerado automaticamente…").
 */
function blocosDoTexto(t: string): string[] {
  const inicios: number[] = [];
  const re = /MEMORIAL DESCRITIVO\s+Denominação:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) inicios.push(m.index);
  if (inicios.length <= 1) return [t];
  return inicios.map((ini, i) => t.slice(ini, i + 1 < inicios.length ? inicios[i + 1] : t.length));
}

/**
 * Todos os memoriais do PDF, na ordem em que aparecem. Um PDF de imóvel simples
 * devolve uma posição só; a prévia de glebas devolve uma por gleba.
 */
export function parseSigefBlocos(texto: string): DadosSigef[] {
  const t = texto.replace(/\s+/g, " ");
  return blocosDoTexto(t).map((b) => parseBloco(b));
}

/** Área total em ha (SOMA das glebas) e perímetro de cada bloco, para a planta. */
export function totaisDosBlocos(blocos: DadosSigef[]): { areaHa: number; perimetrosM: number[] } {
  const num = (s: string) => parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
  return {
    areaHa: blocos.reduce((s, b) => s + num(b.cabecalho.areaHa), 0),
    // NÃO somado de propósito: o perímetro é individual por gleba (a soma não é
    // o contorno de nada). A planta lista um por gleba.
    perimetrosM: blocos.map((b) => num(b.cabecalho.perimetroM)),
  };
}

/**
 * O PRIMEIRO memorial do PDF. Mantido para o fluxo de imóvel simples, em que o
 * PDF tem um memorial só; quem lida com glebas usa `parseSigefBlocos`.
 */
export function parseSigefTexto(texto: string): DadosSigef {
  return parseSigefBlocos(texto)[0];
}

function parseBloco(t: string): DadosSigef {

  const cabecalho: CabecalhoSigef = {
    denominacao: campo(t, /Denominação:\s*(.+?)\s*Proprietário/),
    proprietario: campo(t, /Proprietário\(a\):\s*(.+?)\s*Matrícula/),
    matricula: campo(t, /Matrícula do imóvel:\s*(\S+)/),
    municipioUf: campo(t, /Município\/UF:\s*(\S+)/),
    rtNome: campo(t, /Responsável Técnico\(a\):\s*(.+?)\s*Formação/),
    formacao: campo(t, /Formação:\s*(.+?)\s*Código de credenciamento/),
    codigoCredenciamento: campo(t, /Código de credenciamento:\s*(\S+)/),
    areaHa: campo(t, /Área \(Sistema Geodésico Local\)\*?:\s*([\d.,]+)\s*ha/),
    naturezaArea: campo(t, /Natureza da Área:\s*(.+?)\s*CPF/),
    cpf: campo(t, /CPF\/CNPJ:\s*([\d.\-/]+)/),
    sncr: campo(t, /Código INCRA\/SNCR:\s*(\S+)/),
    cns: campo(t, /Cartório \(CNS\):\s*\(([^)]+)\)/),
    cartorioLocal: campo(t, /Cartório \(CNS\):\s*\([^)]+\)\s*(.+?)\s*Conselho/),
    conselho: campo(t, /Conselho Profissional:\s*(\S+)/),
    documentoRt: campo(t, /Documento de RT:\s*([A-Z0-9]+(?:\s*-\s*[A-Z]{2})?)/),
    perimetroM: campo(t, /Perímetro \(m\):\s*([\d.,]+)\s*m/),
    dataGeracao: campo(t, /Data da Geração:\s*([\d/]+\s*[\d:]*)/) || null,
  };

  // Linhas da tabela: CODE lon lat alt CODE az dist confrontação...
  // A confrontação termina no próximo código de vértice, no rodapé de página
  // ("Este Memorial...") ou no fim da tabela ("Data da Geração").
  const linhas: LinhaSigef[] = [];
  // Código de vértice: 1 a 4 segmentos alfanuméricos separados por "-".
  // Precisa aceitar sufixos não numéricos (AC9-M-RL49, AC9-M-RL11) e não só
  // o formato XXXX-[MPV]-9999. Os lookarounds impedem que o código case com um
  // PEDAÇO de um código maior ("RL49" dentro de "AC9-M-RL49"), o que fazia a
  // linha inteira ser descartada e vértices sumirem da planta.
  const COD = "(?<![-A-Z0-9_])[A-Z0-9_]{1,15}(?:-[A-Z0-9_]{1,15}){0,3}(?![-A-Z0-9_])";
  const GMS = `-?\\d+°\\d+'[\\d,]+"`;
  // lookahead: o fim da confrontação é detectado pelo início da PRÓXIMA linha
  // de vértice — um código seguido de uma coordenada GMS (longitude negativa).
  // Usar apenas `COD\s+-` casaria com palavras do texto da confrontação ("FAZENDA -").
  const PROX = `(?:${COD})\\s+${GMS}`;
  // A altitude pode ser NEGATIVA (imóvel litorâneo: altitude geodésica abaixo do
  // elipsoide, ex. -12.222). Sem o `-?` a linha inteira não casava, o vértice
  // sumia da leitura e o encadeamento vante→código quebrava: FAZENDA SANTA
  // BARBARA lia só os 5 vértices de altitude positiva, dos 26 do memorial.
  const rowRe = new RegExp(
    `(${COD})\\s+(${GMS})\\s+(${GMS})\\s+(-?[\\d.,]+)\\s+(${COD})\\s+(\\d+°\\d+')\\s+([\\d.,]+)\\s+` +
    `(.*?)(?=${PROX}|Este Memorial|Data da Geração|$)`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(t)) !== null) {
    linhas.push({
      codigo: m[1], lon: m[2], lat: m[3], alt: m[4], vante: m[5],
      azimute: m[6], dist: m[7],
      confrontacao: m[8].trim(),
    });
  }
  // Sem denominação não dá para dizer QUAL gleba falhou; com ela o operador
  // não precisa abrir o PDF para descobrir onde a leitura parou.
  const onde = cabecalho.denominacao ? ` (${cabecalho.denominacao})` : "";
  if (linhas.length === 0) throw new Error(`Não foi possível ler a tabela de vértices do PDF do SIGEF${onde}`);
  // O SIGEF lista o perímetro em sequência: o vante de cada linha é o código da
  // linha seguinte e a última fecha no primeiro vértice. Se o encadeamento
  // quebrar, alguma linha não foi lida — melhor falhar do que gerar planta com
  // pontos faltando.
  for (let i = 0; i < linhas.length; i++) {
    const prox = linhas[(i + 1) % linhas.length];
    if (linhas[i].vante !== prox.codigo) {
      throw new Error(
        `Leitura do PDF do SIGEF${onde} incompleta: o vértice ${linhas[i].codigo} aponta para ` +
        `${linhas[i].vante}, mas a linha seguinte lida é ${prox.codigo}. ` +
        `Foram lidos ${linhas.length} vértices.`,
      );
    }
  }
  if (!cabecalho.areaHa || !cabecalho.perimetroM) {
    throw new Error(`PDF não parece ser um Memorial Descritivo do SIGEF${onde} (área/perímetro não encontrados)`);
  }
  return { cabecalho, linhas };
}
