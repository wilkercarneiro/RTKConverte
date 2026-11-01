// Abertura completa (assíncrona): além do texto, os formatos empacotados —
// planilha Excel (.xlsx) e LibreOffice (.ods), KMZ (KML zipado) e PDF com texto.
// Tudo vira LINHAS de texto e segue a mesma esteira (detector/receita/validador).
//
// Uma planilha vira linhas separadas por tabulação; números longos do Excel
// ("8738840.0769999996") são normalizados para 15 algarismos significativos.
import JSZip from "jszip";
import { abrir } from "./abertura.ts";

export interface ArquivoAberto {
  tipo: "texto" | "planilha" | "kmz" | "pdf" | "binario";
  codificacao: string;
  linhas: string[];
  /** Descrição do que foi aberto (vai para a prévia). */
  origem: string;
  binario?: { formato: string; orientacao: string };
}

export interface DepsArquivo {
  /** Extrai o texto de um PDF (unpdf no servidor e no navegador). */
  textoDoPdf?: (bytes: Uint8Array) => Promise<string>;
}

const desescapar = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

/** Número de planilha com o ruído binário aparado ("…0769999996" → "…077"). */
function numeroDePlanilha(v: string): string {
  const x = Number(v);
  if (!Number.isFinite(x) || !/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(v.trim())) return v;
  return String(Number(x.toPrecision(15)));
}

const indiceColuna = (ref: string): number => {
  const letras = ref.replace(/\d+/g, "").toUpperCase();
  let n = 0;
  for (const c of letras) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
};

async function linhasDoXlsx(zip: JSZip): Promise<string[]> {
  const compartilhadas: string[] = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) {
    const xml = await ss.async("string");
    for (const si of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
      compartilhadas.push(desescapar([...si[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
    }
  }
  const planilhas = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  if (!planilhas.length) return [];
  const xml = await zip.file(planilhas[0])!.async("string");
  const linhas: string[] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const celulas: string[] = [];
    for (const c of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], corpo = c[2] ?? "";
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      const j = ref ? indiceColuna(ref) : celulas.length;
      const tipo = /\bt="([^"]+)"/.exec(attrs)?.[1];
      let valor = "";
      if (tipo === "s") valor = compartilhadas[Number(/<v>([^<]*)<\/v>/.exec(corpo)?.[1] ?? -1)] ?? "";
      else if (tipo === "inlineStr") valor = desescapar([...corpo.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""));
      else if (tipo === "str" || tipo === "b") valor = desescapar(/<v>([^<]*)<\/v>/.exec(corpo)?.[1] ?? "");
      else valor = numeroDePlanilha(/<v>([^<]*)<\/v>/.exec(corpo)?.[1] ?? "");
      while (celulas.length < j) celulas.push("");
      celulas[j] = valor.replace(/[\t\r\n]+/g, " ");
    }
    linhas.push(celulas.join("\t"));
  }
  return linhas;
}

async function linhasDoOds(zip: JSZip): Promise<string[]> {
  const f = zip.file("content.xml");
  if (!f) return [];
  const xml = await f.async("string");
  const tabela = /<table:table\b[\s\S]*?<\/table:table>/.exec(xml)?.[0] ?? "";
  const linhas: string[] = [];
  for (const row of tabela.matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
    const celulas: string[] = [];
    for (const c of (row[2] ?? "").matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
      const attrs = c[1], corpo = c[2] ?? "";
      const rep = Math.min(Number(/table:number-columns-repeated="(\d+)"/.exec(attrs)?.[1] ?? 1), 64);
      const tipo = /office:value-type="([^"]+)"/.exec(attrs)?.[1];
      const valor = tipo === "float" || tipo === "percentage" || tipo === "currency"
        ? numeroDePlanilha(/office:value="([^"]+)"/.exec(attrs)?.[1] ?? "")
        : desescapar([...corpo.matchAll(/<text:p\b[^>]*>([\s\S]*?)<\/text:p>/g)].map((t) => t[1].replace(/<[^>]+>/g, "")).join(" "));
      for (let k = 0; k < rep; k++) celulas.push(valor.replace(/[\t\r\n]+/g, " "));
    }
    while (celulas.length && !celulas[celulas.length - 1]) celulas.pop();
    const repLinhas = Math.min(Number(/table:number-rows-repeated="(\d+)"/.exec(row[1])?.[1] ?? 1), celulas.length ? 1000 : 1);
    for (let k = 0; k < repLinhas; k++) linhas.push(celulas.join("\t"));
  }
  while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
  return linhas;
}

/** Abre qualquer arquivo de pontos. Nunca lança: o que não dá para abrir vira `binario` com orientação. */
export async function abrirArquivo(bytes: Uint8Array, nome: string, deps: DepsArquivo = {}): Promise<ArquivoAberto> {
  const a = abrir(bytes, nome);
  if (a.tipo === "texto") return { tipo: "texto", codificacao: a.codificacao, linhas: a.linhas, origem: `texto (${a.codificacao})` };
  if (a.tipo === "binario") return { tipo: "binario", codificacao: "-", linhas: [], origem: a.binario!.formato, binario: a.binario };
  if (a.tipo === "pdf") {
    if (!deps.textoDoPdf) return { tipo: "binario", codificacao: "-", linhas: [], origem: "PDF", binario: { formato: "PDF", orientacao: "Envie o arquivo de pontos (TXT/CSV) em vez do PDF." } };
    try {
      const texto = await deps.textoDoPdf(bytes);
      if (!texto.trim()) {
        return { tipo: "binario", codificacao: "-", linhas: [], origem: "PDF digitalizado", binario: { formato: "PDF digitalizado (imagem)", orientacao: "O PDF é uma imagem, sem texto: não dá para ler as coordenadas com segurança. Envie o arquivo de pontos (TXT/CSV) ou um PDF gerado pelo sistema de origem." } };
      }
      return { tipo: "pdf", codificacao: "-", linhas: texto.split(/\r?\n/), origem: "texto extraído do PDF" };
    } catch {
      return { tipo: "binario", codificacao: "-", linhas: [], origem: "PDF", binario: { formato: "PDF ilegível", orientacao: "Não foi possível extrair o texto do PDF. Envie o arquivo de pontos (TXT/CSV)." } };
    }
  }
  // ZIP: planilha, KMZ…
  try {
    const zip = await JSZip.loadAsync(bytes);
    if (zip.file("xl/workbook.xml")) return { tipo: "planilha", codificacao: "-", linhas: await linhasDoXlsx(zip), origem: "planilha Excel (.xlsx) — 1ª aba" };
    const mime = zip.file("mimetype") ? await zip.file("mimetype")!.async("string") : "";
    if (/spreadsheet/.test(mime) || (zip.file("content.xml") && /\.ods$/i.test(nome))) return { tipo: "planilha", codificacao: "-", linhas: await linhasDoOds(zip), origem: "planilha LibreOffice (.ods) — 1ª aba" };
    const kml = Object.keys(zip.files).find((n) => /\.kml$/i.test(n));
    if (kml) {
      const t = abrir(await zip.file(kml)!.async("uint8array"), kml);
      return { tipo: "kmz", codificacao: t.codificacao, linhas: t.linhas, origem: "KMZ (KML compactado)" };
    }
    const dentro = Object.keys(zip.files).find((n) => /\.(txt|csv|dat|xyz|pts|gsi|jxl|xml|dxf|geojson)$/i.test(n) && !zip.files[n].dir);
    if (dentro) {
      const t = abrir(await zip.file(dentro)!.async("uint8array"), dentro);
      if (t.tipo === "texto") return { tipo: "texto", codificacao: t.codificacao, linhas: t.linhas, origem: `${dentro} (dentro do ZIP)` };
    }
  } catch { /* ZIP corrompido: cai na orientação abaixo */ }
  return { tipo: "binario", codificacao: "-", linhas: [], origem: "ZIP", binario: { formato: "arquivo compactado sem pontos reconhecíveis", orientacao: "Envie o arquivo de pontos (TXT/CSV/planilha) direto, sem compactar." } };
}
