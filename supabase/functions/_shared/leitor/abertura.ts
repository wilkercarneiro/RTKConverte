// Abertura: bytes → texto. Decide a codificação (BOM, UTF-8 estrito, UTF-16
// sem BOM, Windows-1252), normaliza quebras de linha e caracteres invisíveis e
// reconhece o que não é texto (ZIP de planilha/KMZ, PDF, binário de aparelho).
//
// As LINHAS devolvidas preservam a numeração do arquivo original (linha 1 =
// índice 0), sem trim: a largura fixa precisa das posições.

export type TipoArquivo = "texto" | "zip" | "pdf" | "binario";

export interface Abertura {
  tipo: TipoArquivo;
  codificacao: string;
  texto: string;
  linhas: string[];
  /** Para binários: o que parece ser (guia de exportação). */
  binario?: { formato: string; orientacao: string };
}

const u8 = (b: ArrayBuffer | Uint8Array): Uint8Array => (b instanceof Uint8Array ? b : new Uint8Array(b));

function comeca(b: Uint8Array, ...sig: number[]): boolean {
  return sig.every((x, i) => b[i] === x);
}

/** Bytes → texto com a melhor codificação. */
export function decodificar(entrada: ArrayBuffer | Uint8Array): { texto: string; codificacao: string } {
  const b = u8(entrada);
  if (comeca(b, 0xef, 0xbb, 0xbf)) return { texto: new TextDecoder("utf-8").decode(b.subarray(3)), codificacao: "utf-8 (BOM)" };
  if (comeca(b, 0xff, 0xfe)) return { texto: new TextDecoder("utf-16le").decode(b.subarray(2)), codificacao: "utf-16le (BOM)" };
  if (comeca(b, 0xfe, 0xff)) return { texto: new TextDecoder("utf-16be").decode(b.subarray(2)), codificacao: "utf-16be (BOM)" };
  // UTF-16 sem BOM: metade dos bytes zerados, alternados
  const n = Math.min(b.length, 4000);
  let zPar = 0, zImpar = 0;
  for (let i = 0; i < n; i++) if (b[i] === 0) (i % 2 === 0 ? zPar++ : zImpar++);
  if (n >= 8 && zImpar > n * 0.3 && zPar < n * 0.05) return { texto: new TextDecoder("utf-16le").decode(b), codificacao: "utf-16le" };
  if (n >= 8 && zPar > n * 0.3 && zImpar < n * 0.05) return { texto: new TextDecoder("utf-16be").decode(b), codificacao: "utf-16be" };
  try {
    return { texto: new TextDecoder("utf-8", { fatal: true }).decode(b), codificacao: "utf-8" };
  } catch {
    return { texto: new TextDecoder("windows-1252").decode(b), codificacao: "windows-1252" };
  }
}

/** Normaliza o texto e separa em linhas (CRLF, LF e CR sozinho). */
export function separarLinhas(texto: string): string[] {
  const t = texto
    .replace(/^﻿/, "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[   ]/g, " ")
    .replace(/[‘’´′]/g, "'")
    .replace(/[“”″]/g, "\"");
  const linhas = t.split("\n").map((l) => l.replace(/^﻿/, ""));
  // a última linha vazia (arquivo terminado em quebra) não existe para o operador
  while (linhas.length && linhas[linhas.length - 1].trim() === "") linhas.pop();
  return linhas;
}

/** Guia de exportação para formatos binários que só o software do fabricante lê. */
const GUIAS_BINARIO: { teste: (nome: string, b: Uint8Array) => boolean; formato: string; orientacao: string }[] = [
  {
    teste: (nome) => /\.(dbx|xcf|x\d\d)$/i.test(nome),
    formato: "Leica (banco DBX)",
    orientacao: "No Leica Captivate/SmartWorx: Jobs & Data → Export → Export ASCII/CSV (ou GSI-16) e envie o arquivo gerado.",
  },
  {
    teste: (nome) => /\.job$/i.test(nome),
    formato: "Trimble (job binário)",
    orientacao: "No Trimble Access: Trabalho → Exportar → \"Comma Delimited (*.CSV, *.TXT)\" ou JobXML (.jxl) e envie o arquivo gerado.",
  },
  {
    teste: (nome) => /\.(rw5|raw)$/i.test(nome),
    formato: "arquivo de observações brutas",
    orientacao: "Esse arquivo guarda observações, não coordenadas. Exporte os PONTOS da coletora em TXT/CSV (nome, E, N, cota).",
  },
  {
    teste: (nome) => /\.(\d\do|rnx|obs|crx|\d\dd|\d\dn|ubx|sbf|t0\d|tps|hcn|sth|gns|dat_rtk)$/i.test(nome),
    formato: "dados GNSS brutos (RINEX/observações)",
    orientacao: "Esse arquivo tem observações de satélite, não pontos. Processe no software do receptor (ou no IBGE-PPP) e envie o TXT/CSV de pontos ou o relatório do PPP.",
  },
  {
    teste: (nome) => /\.(dwg)$/i.test(nome),
    formato: "AutoCAD DWG",
    orientacao: "Salve o desenho como DXF (Arquivo → Salvar como → DXF) e envie o DXF.",
  },
  {
    teste: (nome) => /\.(shp|shx|dbf)$/i.test(nome),
    formato: "Shapefile",
    orientacao: "Exporte a camada de pontos como CSV (com X/Y ou E/N) ou KML e envie esse arquivo.",
  },
  {
    teste: (_nome, b) => b.length > 0,
    formato: "arquivo binário desconhecido",
    orientacao: "Exporte os pontos da coletora como texto (TXT ou CSV com nome, E, N e cota) e envie de novo.",
  },
];

function pareceBinario(b: Uint8Array): boolean {
  const n = Math.min(b.length, 4096);
  if (!n) return false;
  let ctrl = 0;
  for (let i = 0; i < n; i++) {
    const x = b[i];
    if (x < 9 || (x > 13 && x < 32 && x !== 26)) ctrl++;
  }
  return ctrl / n > 0.05;
}

/** Abre o arquivo: decide o tipo e, se for texto, a codificação e as linhas. */
export function abrir(entrada: ArrayBuffer | Uint8Array, nome = ""): Abertura {
  const b = u8(entrada);
  if (comeca(b, 0x50, 0x4b, 0x03, 0x04)) return { tipo: "zip", codificacao: "-", texto: "", linhas: [] };
  if (comeca(b, 0x25, 0x50, 0x44, 0x46)) return { tipo: "pdf", codificacao: "-", texto: "", linhas: [] };
  const temBom = comeca(b, 0xef, 0xbb, 0xbf) || comeca(b, 0xff, 0xfe) || comeca(b, 0xfe, 0xff);
  const { texto, codificacao } = decodificar(b);
  const utf16 = codificacao.startsWith("utf-16");
  if (!temBom && !utf16 && pareceBinario(b)) {
    const guia = GUIAS_BINARIO.find((g) => g.teste(nome, b))!;
    return { tipo: "binario", codificacao: "-", texto: "", linhas: [], binario: { formato: guia.formato, orientacao: guia.orientacao } };
  }
  return { tipo: "texto", codificacao, texto, linhas: separarLinhas(texto) };
}

/** Guia de exportação pelo nome (para extensões de dados brutos que são texto, como RINEX). */
export function guiaPorExtensao(nome: string): { formato: string; orientacao: string } | null {
  const g = GUIAS_BINARIO.slice(0, -1).find((x) => x.teste(nome, new Uint8Array(0)));
  return g ? { formato: g.formato, orientacao: g.orientacao } : null;
}
