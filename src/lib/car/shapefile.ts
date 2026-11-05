// Shapefile (SHP + SHX + DBF + PRJ) em grau, SIRGAS 2000.
//
// O SICAR recebe cada camada (imóvel, reserva legal, APP…) como um zip com os
// quatro arquivos de mesmo nome. Coordenadas em GRAU, SIRGAS 2000 (o PRJ é
// sempre o mesmo). A tabela de atributos repete a do arquivo que o escritório
// já envia ao SICAR (D:\ArquivosCar\PLANTA.dbf): INDICE, NOME, COR, ESTILO,
// ESCALA — com os números alinhados à esquerda, como lá.
//
// A "Exportar a área" (src/lib/exportar) usa o mesmo gravador para pontos,
// linhas e polígonos com uma tabela LIVRE (as colunas que a camada tiver), em
// UTF-8 com o .cpg que diz isso ao QGIS/ArcGIS. O caminho do SICAR não muda:
// é o mesmo núcleo, com a tabela fixa dele.
//
// Anel externo no sentido HORÁRIO e furo no anti-horário (especificação ESRI):
// é a única orientação que todo leitor entende quando a camada tem furo, como
// a área produtiva com a reserva no meio dela.
import JSZip from "jszip";
import type { LonLat } from "./kml.ts";

/** O PRJ do CAR: SIRGAS 2000 geográfico, igual para todo imóvel. */
export const PRJ_SIRGAS2000 =
  'GEOGCS["SIRGAS 2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]]';

/** Um polígono: anel externo + furos, abertos (sem repetir o 1º ponto). */
export interface PoligonoGeo { ext: LonLat[]; furos: LonLat[][] }

export interface FeicaoShp {
  /** as partes de UMA feição (multipolígono vira um registro só) */
  poligonos: PoligonoGeo[];
  nome: string;
}

/** `cpg` só na tabela livre (UTF-8); a do SICAR é ASCII e vai sem ele. */
export interface ArquivosShp { shp: Uint8Array; shx: Uint8Array; dbf: Uint8Array; prj: string; cpg?: string }

const areaGeo = (a: LonLat[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const p = a[i], q = a[(i + 1) % a.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
};

/** Fecha o anel e acerta o sentido (horário = externo). */
function anelShp(anel: LonLat[], horario: boolean): LonLat[] {
  const a = areaGeo(anel) < 0 === horario ? [...anel] : [...anel].reverse();
  return [...a, a[0]];
}

const partesDosPoligonos = (pols: PoligonoGeo[]): LonLat[][] =>
  pols.filter((p) => p.ext.length >= 3).flatMap((p) => [anelShp(p.ext, true), ...p.furos.filter((h) => h.length >= 3).map((h) => anelShp(h, false))]);

function partesDe(f: FeicaoShp): LonLat[][] {
  return f.poligonos.flatMap((p) => [anelShp(p.ext, true), ...p.furos.map((h) => anelShp(h, false))]);
}

// ---------------------------------------------------------------------------
// SHP / SHX
// ---------------------------------------------------------------------------

/** Geometria do arquivo (código da especificação ESRI: 1 ponto, 3 linha, 5 polígono). */
export type GeometriaShp = "ponto" | "linha" | "poligono";
const CODIGO_SHP: Record<GeometriaShp, number> = { ponto: 1, linha: 3, poligono: 5 };

/** [xmin, ymin, xmax, ymax] num laço: o espalhamento (...) estoura a pilha em camada grande. */
function caixaDe(pts: LonLat[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

/**
 * SHP + SHX de registros prontos. Cada registro é a lista das suas partes: no
 * polígono, os anéis já fechados e orientados; na linha, os trechos; no ponto,
 * uma parte com um ponto só.
 */
function gravarGeometrias(tipo: GeometriaShp, registros: LonLat[][][]): { shp: Uint8Array; shx: Uint8Array } {
  const cod = CODIGO_SHP[tipo];
  const conteudo = registros.map((ps) => (tipo === "ponto" ? 20 : 44 + 4 * ps.length + 16 * ps.reduce((s, p) => s + p.length, 0)));
  const tamShp = 100 + conteudo.reduce((s, c) => s + 8 + c, 0);
  const tamShx = 100 + 8 * registros.length;
  const shp = new DataView(new ArrayBuffer(tamShp));
  const shx = new DataView(new ArrayBuffer(tamShx));

  const caixa = caixaDe(registros.flat(2));
  const cabecalho = (v: DataView, tam: number) => {
    v.setInt32(0, 9994, false);
    v.setInt32(24, tam / 2, false);
    v.setInt32(28, 1000, true);
    v.setInt32(32, cod, true);
    caixa.forEach((c, i) => v.setFloat64(36 + 8 * i, c, true));
  };
  cabecalho(shp, tamShp);
  cabecalho(shx, tamShx);

  let o = 100;
  registros.forEach((partes, r) => {
    shx.setInt32(100 + 8 * r, o / 2, false);
    shx.setInt32(104 + 8 * r, conteudo[r] / 2, false);
    shp.setInt32(o, r + 1, false);
    shp.setInt32(o + 4, conteudo[r] / 2, false);
    o += 8;
    shp.setInt32(o, cod, true);
    if (tipo === "ponto") {
      const [x, y] = partes[0][0];
      shp.setFloat64(o + 4, x, true);
      shp.setFloat64(o + 12, y, true);
      o += 20;
      return;
    }
    const pts = partes.flat();
    caixaDe(pts).forEach((c, i) => shp.setFloat64(o + 4 + 8 * i, c, true));
    shp.setInt32(o + 36, partes.length, true);
    shp.setInt32(o + 40, pts.length, true);
    o += 44;
    let inicio = 0;
    for (const p of partes) { shp.setInt32(o, inicio, true); o += 4; inicio += p.length; }
    for (const [x, y] of pts) { shp.setFloat64(o, x, true); shp.setFloat64(o + 8, y, true); o += 16; }
  });
  return { shp: new Uint8Array(shp.buffer), shx: new Uint8Array(shx.buffer) };
}

export function gravarShapefile(feicoes: FeicaoShp[], hoje = new Date()): ArquivosShp {
  const registros = feicoes.map(partesDe).filter((ps) => ps.length);
  if (!registros.length) throw new Error("camada vazia: não há polígono para gravar");
  return {
    ...gravarGeometrias("poligono", registros),
    dbf: dbfDoSicar(feicoes.filter((f) => partesDe(f).length).map((f) => f.nome), hoje),
    prj: PRJ_SIRGAS2000,
  };
}

// ---------------------------------------------------------------------------
// DBF (dBase III)
// ---------------------------------------------------------------------------

export interface CampoDbf { nome: string; tipo: "N" | "C"; tam: number; dec: number }

/** Cabeçalho, campos e registros. Cada célula já vem com os bytes do tamanho exato do campo. */
function gravarDbf(campos: CampoDbf[], linhas: Uint8Array[][], hoje: Date): Uint8Array {
  const tamCab = 32 + 32 * campos.length + 1;
  const tamReg = 1 + campos.reduce((s, c) => s + c.tam, 0);
  const b = new Uint8Array(tamCab + tamReg * linhas.length + 1);
  const v = new DataView(b.buffer);
  b[0] = 0x03;
  b[1] = hoje.getFullYear() - 1900; b[2] = hoje.getMonth() + 1; b[3] = hoje.getDate();
  v.setUint32(4, linhas.length, true);
  v.setUint16(8, tamCab, true);
  v.setUint16(10, tamReg, true);
  let desloc = 1;
  campos.forEach((c, i) => {
    const o = 32 + 32 * i;
    for (let k = 0; k < c.nome.length; k++) b[o + k] = c.nome.charCodeAt(k);
    b[o + 11] = c.tipo.charCodeAt(0);
    v.setUint32(o + 12, desloc, true);
    b[o + 16] = c.tam; b[o + 17] = c.dec;
    desloc += c.tam;
  });
  b[tamCab - 1] = 0x0d;
  linhas.forEach((celulas, r) => {
    let o = tamCab + tamReg * r;
    b[o++] = 0x20;
    campos.forEach((c, i) => { b.set(celulas[i].subarray(0, c.tam), o); o += c.tam; });
  });
  b[b.length - 1] = 0x1a;
  return b;
}

// ---- a tabela do SICAR ----

const CAMPOS: CampoDbf[] = [
  { nome: "INDICE", tipo: "N", tam: 10, dec: 0 },
  { nome: "NOME", tipo: "C", tam: 10, dec: 0 },
  { nome: "COR", tipo: "N", tam: 10, dec: 0 },
  { nome: "ESTILO", tipo: "N", tam: 10, dec: 0 },
  { nome: "ESCALA", tipo: "N", tam: 18, dec: 2 },
];

/** Texto em ASCII (o dBase III não tem página de código aqui): sem acento. */
const ascii = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");
const bytesAscii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

function dbfDoSicar(nomes: string[], hoje: Date): Uint8Array {
  const linhas = nomes.map((nome, r) =>
    [String(r + 1), ascii(nome), "32768", "18", ".00"].map((val, i) => bytesAscii(val.slice(0, CAMPOS[i].tam).padEnd(CAMPOS[i].tam, " "))));
  return gravarDbf(CAMPOS, linhas, hoje);
}

// ---- a tabela livre (Exportar a área) ----

export type ValorAtributo = string | number | null | undefined;
export type Atributos = Record<string, ValorAtributo>;

const utf8 = new TextEncoder();

/** Corta em `max` bytes sem partir um caractere de vários bytes ao meio. */
function cortarUtf8(b: Uint8Array, max: number): Uint8Array {
  if (b.length <= max) return b;
  let fim = max;
  while (fim > 0 && (b[fim] & 0xc0) === 0x80) fim--;
  return b.subarray(0, fim);
}

/** Nome de campo do dBase: até 10 letras/dígitos/_ em maiúscula, começando por letra, sem repetir. */
function nomesDeCampo(chaves: string[]): string[] {
  const usados = new Set<string>();
  return chaves.map((k) => {
    let n = ascii(k).toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "") || "CAMPO";
    if (!/^[A-Z]/.test(n)) n = `C${n}`;
    n = n.slice(0, 10);
    let final = n;
    for (let i = 2; usados.has(final); i++) final = `${n.slice(0, 10 - String(i).length)}${i}`;
    usados.add(final);
    return final;
  });
}

/** Menor número de casas (até 8) que representa o valor sem perder nada. */
function casasDe(v: number): number {
  for (let d = 0; d <= 8; d++) if (Number(v.toFixed(d)) === v) return d;
  return 8;
}

/** Maior valor de uma lista grande (reduce: o espalhamento estoura a pilha). */
const maior = (vs: number[], minimo: number) => vs.reduce((m, v) => (v > m ? v : m), minimo);

/**
 * As colunas saem da união das chaves dos atributos, na ordem em que aparecem.
 * Coluna só com número vira N (alinhado à direita, como o dBase manda); o resto
 * vira C em UTF-8. Valor vazio fica em branco. Sem atributo nenhum, a tabela é
 * só o número do registro (o dBase não aceita tabela sem coluna).
 */
function tabelaLivre(atributos0: Atributos[]): { campos: CampoDbf[]; linhas: Uint8Array[][] } {
  const temChave = atributos0.some((a) => Object.keys(a).length > 0);
  const atributos: Atributos[] = temChave ? atributos0 : atributos0.map((_, r) => ({ ID: r + 1 }));
  const chaves: string[] = [];
  for (const a of atributos) for (const k of Object.keys(a)) if (!chaves.includes(k)) chaves.push(k);
  const nomes = nomesDeCampo(chaves);
  const vazio = (v: ValorAtributo) => v === null || v === undefined || v === "";
  const colunas = chaves.map((k, i) => {
    const vals = atributos.map((a) => a[k]);
    const preenchidos = vals.filter((v) => !vazio(v));
    if (preenchidos.length > 0 && preenchidos.every((v) => typeof v === "number" && Number.isFinite(v))) {
      const dec = maior(preenchidos.map((v) => casasDe(v as number)), 0);
      const textos = vals.map((v) => (vazio(v) ? "" : (v as number).toFixed(dec)));
      const tam = maior(textos.map((t) => t.length), dec ? dec + 2 : 1);
      // número maior que o campo N do dBase (19) vai como texto, nunca cortado
      if (tam <= 19) {
        return { campo: { nome: nomes[i], tipo: "N" as const, tam, dec }, celulas: textos.map((t) => bytesAscii(t.padStart(tam, " "))) };
      }
    }
    const bytes = vals.map((v) => (vazio(v) ? new Uint8Array(0) : cortarUtf8(utf8.encode(String(v).replace(/[\r\n]+/g, " ")), 254)));
    const tam = maior(bytes.map((b) => b.length), 1);
    return {
      campo: { nome: nomes[i], tipo: "C" as const, tam, dec: 0 },
      celulas: bytes.map((b) => { const c = new Uint8Array(tam).fill(0x20); c.set(b); return c; }),
    };
  });
  return { campos: colunas.map((c) => c.campo), linhas: atributos.map((_, r) => colunas.map((c) => c.celulas[r])) };
}

function arquivosLivres(tipo: GeometriaShp, registros: LonLat[][][], atributos: Atributos[], hoje: Date): ArquivosShp {
  const { campos, linhas } = tabelaLivre(atributos);
  return { ...gravarGeometrias(tipo, registros), dbf: gravarDbf(campos, linhas, hoje), prj: PRJ_SIRGAS2000, cpg: "UTF-8" };
}

/** Shapefile de pontos (lon, lat) com tabela livre. */
export function gravarShapefilePontos(feicoes: { ponto: LonLat; atributos: Atributos }[], hoje = new Date()): ArquivosShp {
  const validas = feicoes.filter((f) => Number.isFinite(f.ponto[0]) && Number.isFinite(f.ponto[1]));
  if (!validas.length) throw new Error("camada vazia: não há ponto para gravar");
  return arquivosLivres("ponto", validas.map((f) => [[f.ponto]]), validas.map((f) => f.atributos), hoje);
}

/** Shapefile de linhas (cada feição pode ter vários trechos) com tabela livre. */
export function gravarShapefileLinhas(feicoes: { trechos: LonLat[][]; atributos: Atributos }[], hoje = new Date()): ArquivosShp {
  const validas = feicoes.map((f) => ({ ...f, trechos: f.trechos.filter((t) => t.length >= 2) })).filter((f) => f.trechos.length);
  if (!validas.length) throw new Error("camada vazia: não há linha para gravar");
  return arquivosLivres("linha", validas.map((f) => f.trechos), validas.map((f) => f.atributos), hoje);
}

/** Shapefile de polígonos (externo horário, furo anti-horário) com tabela livre. */
export function gravarShapefilePoligonos(feicoes: { poligonos: PoligonoGeo[]; atributos: Atributos }[], hoje = new Date()): ArquivosShp {
  const validas = feicoes.map((f) => ({ ...f, partes: partesDosPoligonos(f.poligonos) })).filter((f) => f.partes.length);
  if (!validas.length) throw new Error("camada vazia: não há polígono para gravar");
  return arquivosLivres("poligono", validas.map((f) => f.partes), validas.map((f) => f.atributos), hoje);
}

/** Os arquivos de uma camada dentro do zip (na pasta `pasta`, se houver). */
export function juntarNoZip(zip: JSZip, base: string, a: ArquivosShp, pasta?: string): void {
  const alvo = pasta ? zip.folder(pasta)! : zip;
  alvo.file(`${base}.shp`, a.shp);
  alvo.file(`${base}.shx`, a.shx);
  alvo.file(`${base}.dbf`, a.dbf);
  alvo.file(`${base}.prj`, a.prj);
  if (a.cpg) alvo.file(`${base}.cpg`, a.cpg);
}
