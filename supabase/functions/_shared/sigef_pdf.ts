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

export function parseSigefTexto(texto: string): DadosSigef {
  const t = texto.replace(/\s+/g, " ");

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
  const COD = "[A-Z0-9]{2,4}-[MPV]-\\d+";
  const GMS = `-?\\d+°\\d+'[\\d,]+"`;
  const rowRe = new RegExp(
    `(${COD})\\s+(${GMS})\\s+(${GMS})\\s+([\\d.,]+)\\s+(${COD})\\s+(\\d+°\\d+')\\s+([\\d.,]+)\\s+` +
    `(.*?)(?=(?:${COD})\\s+-|Este Memorial|Data da Geração|$)`,
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
  if (linhas.length === 0) throw new Error("Não foi possível ler a tabela de vértices do PDF do SIGEF");
  if (!cabecalho.areaHa || !cabecalho.perimetroM) {
    throw new Error("PDF não parece ser um Memorial Descritivo do SIGEF (área/perímetro não encontrados)");
  }
  return { cabecalho, linhas };
}
