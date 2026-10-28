// Shapefile de polígono (SHP + SHX + DBF + PRJ) para o CAR.
//
// O SICAR recebe cada camada (imóvel, reserva legal, APP…) como um zip com os
// quatro arquivos de mesmo nome. Coordenadas em GRAU, SIRGAS 2000 (o PRJ é
// sempre o mesmo). A tabela de atributos repete a do arquivo que o escritório
// já envia ao SICAR (D:\ArquivosCar\PLANTA.dbf): INDICE, NOME, COR, ESTILO,
// ESCALA — com os números alinhados à esquerda, como lá.
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

export interface ArquivosShp { shp: Uint8Array; shx: Uint8Array; dbf: Uint8Array; prj: string }

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

function partesDe(f: FeicaoShp): LonLat[][] {
  return f.poligonos.flatMap((p) => [anelShp(p.ext, true), ...p.furos.map((h) => anelShp(h, false))]);
}

export function gravarShapefile(feicoes: FeicaoShp[], hoje = new Date()): ArquivosShp {
  const registros = feicoes.map(partesDe).filter((ps) => ps.length);
  if (!registros.length) throw new Error("camada vazia: não há polígono para gravar");

  // ---- SHP / SHX ----
  const conteudo = registros.map((ps) => 44 + 4 * ps.length + 16 * ps.reduce((s, p) => s + p.length, 0));
  const tamShp = 100 + conteudo.reduce((s, c) => s + 8 + c, 0);
  const tamShx = 100 + 8 * registros.length;
  const shp = new DataView(new ArrayBuffer(tamShp));
  const shx = new DataView(new ArrayBuffer(tamShx));

  const todos = registros.flat(2);
  const caixa = [
    Math.min(...todos.map((p) => p[0])), Math.min(...todos.map((p) => p[1])),
    Math.max(...todos.map((p) => p[0])), Math.max(...todos.map((p) => p[1])),
  ];
  const cabecalho = (v: DataView, tam: number) => {
    v.setInt32(0, 9994, false);
    v.setInt32(24, tam / 2, false);
    v.setInt32(28, 1000, true);
    v.setInt32(32, 5, true); // polígono
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
    const pts = partes.flat();
    shp.setInt32(o, 5, true);
    [
      Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
      Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1])),
    ].forEach((c, i) => shp.setFloat64(o + 4 + 8 * i, c, true));
    shp.setInt32(o + 36, partes.length, true);
    shp.setInt32(o + 40, pts.length, true);
    o += 44;
    let inicio = 0;
    for (const p of partes) { shp.setInt32(o, inicio, true); o += 4; inicio += p.length; }
    for (const [x, y] of pts) { shp.setFloat64(o, x, true); shp.setFloat64(o + 8, y, true); o += 16; }
  });

  return {
    shp: new Uint8Array(shp.buffer),
    shx: new Uint8Array(shx.buffer),
    dbf: gravarDbf(feicoes.filter((f) => partesDe(f).length).map((f) => f.nome), hoje),
    prj: PRJ_SIRGAS2000,
  };
}

// ---- DBF (dBase III) ----

const CAMPOS: { nome: string; tipo: "N" | "C"; tam: number; dec: number }[] = [
  { nome: "INDICE", tipo: "N", tam: 10, dec: 0 },
  { nome: "NOME", tipo: "C", tam: 10, dec: 0 },
  { nome: "COR", tipo: "N", tam: 10, dec: 0 },
  { nome: "ESTILO", tipo: "N", tam: 10, dec: 0 },
  { nome: "ESCALA", tipo: "N", tam: 18, dec: 2 },
];

/** Texto em ASCII (o dBase III não tem página de código aqui): sem acento. */
const ascii = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?");

function gravarDbf(nomes: string[], hoje: Date): Uint8Array {
  const tamCab = 32 + 32 * CAMPOS.length + 1;
  const tamReg = 1 + CAMPOS.reduce((s, c) => s + c.tam, 0);
  const b = new Uint8Array(tamCab + tamReg * nomes.length + 1);
  const v = new DataView(b.buffer);
  b[0] = 0x03;
  b[1] = hoje.getFullYear() - 1900; b[2] = hoje.getMonth() + 1; b[3] = hoje.getDate();
  v.setUint32(4, nomes.length, true);
  v.setUint16(8, tamCab, true);
  v.setUint16(10, tamReg, true);
  let desloc = 1;
  CAMPOS.forEach((c, i) => {
    const o = 32 + 32 * i;
    for (let k = 0; k < c.nome.length; k++) b[o + k] = c.nome.charCodeAt(k);
    b[o + 11] = c.tipo.charCodeAt(0);
    v.setUint32(o + 12, desloc, true);
    b[o + 16] = c.tam; b[o + 17] = c.dec;
    desloc += c.tam;
  });
  b[tamCab - 1] = 0x0d;
  nomes.forEach((nome, r) => {
    const valores = [String(r + 1), ascii(nome), "32768", "18", ".00"];
    let o = tamCab + tamReg * r;
    b[o++] = 0x20;
    CAMPOS.forEach((c, i) => {
      const t = valores[i].slice(0, c.tam).padEnd(c.tam, " ");
      for (let k = 0; k < c.tam; k++) b[o + k] = t.charCodeAt(k);
      o += c.tam;
    });
  });
  b[b.length - 1] = 0x1a;
  return b;
}

/** Os quatro arquivos de uma camada dentro do zip (na pasta `pasta`, se houver). */
export function juntarNoZip(zip: JSZip, base: string, a: ArquivosShp, pasta?: string): void {
  const alvo = pasta ? zip.folder(pasta)! : zip;
  alvo.file(`${base}.shp`, a.shp);
  alvo.file(`${base}.shx`, a.shx);
  alvo.file(`${base}.dbf`, a.dbf);
  alvo.file(`${base}.prj`, a.prj);
}
