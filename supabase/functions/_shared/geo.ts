// Motor geodésico — código puro, sem dependências de ambiente.
// proj4 é injetado pelo chamador (npm 'proj4' no Node/testes; 'npm:proj4' via deno.json na Edge Function).
//
// PROPRIEDADE FUNDAMENTAL (auto-consistência): todos os valores publicados
// (planilha e memorial) derivam das coordenadas geográficas ARREDONDADAS
// (segundos com 3 casas, half-up), nunca das coordenadas brutas do TXT.

export type Proj4 = (from: string, to: string, coords: [number, number]) => [number, number];

export const GEO_DEF = "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs";

export function utmDef(zone: number): string {
  return `+proj=utm +zone=${zone} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
}

// Fusos brasileiros SIRGAS2000: 18S..25S = EPSG:31978..31985
export const ZONAS_BR = [18, 19, 20, 21, 22, 23, 24, 25];
export function epsgForZone(zone: number): number { return 31960 + zone; }
export function mcForZone(zone: number): number { return 6 * zone - 183; } // fuso 24 → -39

// Limites oficiais SIGEF (aba parametros_vertice do template)
export const LIMITES = {
  eMin: 165700, eMax: 834300,
  nMin: 0, nMax: 10000000,
  lonMin: -73.992222, lonMax: -34.791667,
  latMin: -33.750833, latMax: 5.272222,
};

// ---------------------------------------------------------------------------
// Parse do TXT
// ---------------------------------------------------------------------------

export interface PontoTxt {
  num: number;          // ID sequencial no TXT
  rotulo: string | null; // ex.: "Justiliano/Varguim Serra"
  e: number;
  n: number;
  h: number;
  sigmaPos: number;
  sigmaH: number;
}

export function parseDecimalBR(s: string): number {
  const v = Number(s.trim().replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(v)) throw new Error(`Número inválido: "${s}"`);
  return v;
}

export function parseTxt(content: string): PontoTxt[] {
  // trata BOM (utf-8-sig)
  const clean = content.replace(/^﻿/, "");
  const pontos: PontoTxt[] = [];
  const lines = clean.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(";");
    if (parts.length < 6) throw new Error(`Linha ${i + 1}: esperados 6 campos separados por ';', obtidos ${parts.length}`);
    const idField = parts[0].trim();
    const m = idField.match(/^(\d+)(?:\s+(.+))?$/);
    if (!m) throw new Error(`Linha ${i + 1}: campo ID inválido: "${idField}"`);
    const num = parseInt(m[1], 10);
    const rotulo = m[2] ? m[2].trim() : null;
    const e = parseDecimalBR(parts[1]);
    const n = parseDecimalBR(parts[2]);
    const h = parseDecimalBR(parts[3]);
    const sigmaPos = parseDecimalBR(parts[4]);
    const sigmaH = parseDecimalBR(parts[5]);
    if (e < LIMITES.eMin || e > LIMITES.eMax) throw new Error(`Linha ${i + 1}: E=${parts[1]} fora dos limites SIGEF (${LIMITES.eMin}–${LIMITES.eMax})`);
    if (n < LIMITES.nMin || n > LIMITES.nMax) throw new Error(`Linha ${i + 1}: N=${parts[2]} fora dos limites SIGEF`);
    pontos.push({ num, rotulo, e, n, h, sigmaPos, sigmaH });
  }
  if (pontos.length < 3) throw new Error("TXT precisa de pelo menos 3 pontos");
  return pontos;
}

// ---------------------------------------------------------------------------
// GMS canônico (segundos arredondados half-up a 3 casas)
// ---------------------------------------------------------------------------

export interface GMS {
  neg: boolean;  // true = Sul / Oeste
  d: number;
  m: number;
  sMil: number;  // segundos em milésimos (inteiro), ex.: 44344 = 44,344"
}

export function degToGmsCanonical(deg: number): GMS {
  const neg = deg < 0;
  // milésimos de segundo de arco, half-up sobre o valor absoluto
  const mas = Math.round(Math.abs(deg) * 3600000);
  const d = Math.floor(mas / 3600000);
  const rem = mas % 3600000;
  const m = Math.floor(rem / 60000);
  const sMil = rem % 60000;
  return { neg, d, m, sMil };
}

export function gmsToDeg(g: GMS): number {
  const abs = g.d + g.m / 60 + g.sMil / 1000 / 3600;
  return g.neg ? -abs : abs;
}

export function parseGmsPlanilha(s: string): GMS {
  // "11 24 30,375 S" ou "39 4 47,198 W"
  const m = s.trim().match(/^(\d+)\s+(\d+)\s+(\d+(?:,\d+)?)\s*([NSEWO])$/i);
  if (!m) throw new Error(`Coordenada GMS inválida: "${s}"`);
  const hemi = m[4].toUpperCase();
  const neg = hemi === "S" || hemi === "W" || hemi === "O";
  const sec = Number(m[3].replace(",", "."));
  return { neg, d: parseInt(m[1], 10), m: parseInt(m[2], 10), sMil: Math.round(sec * 1000) };
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

function secStr(sMil: number): string {
  const s = Math.floor(sMil / 1000);
  const mil = sMil % 1000;
  return `${pad2(s)},${String(mil).padStart(3, "0")}`;
}

// Formato planilha SIGEF: "39 5 04,737 W" (graus e minutos sem zero à esquerda)
export function fmtGmsPlanilha(g: GMS, kind: "lat" | "lon"): string {
  const hemi = kind === "lat" ? (g.neg ? "S" : "N") : (g.neg ? "W" : "E");
  return `${g.d} ${g.m} ${secStr(g.sMil)} ${hemi}`;
}

// Formato memorial: `-11°23'44,344" S`
export function fmtGmsMemorial(g: GMS, kind: "lat" | "lon"): string {
  const hemi = kind === "lat" ? (g.neg ? "S" : "N") : (g.neg ? "W" : "E");
  const sign = g.neg ? "-" : "";
  return `${sign}${g.d}°${pad2(g.m)}'${secStr(g.sMil)}" ${hemi}`;
}

// ---------------------------------------------------------------------------
// Formatação numérica pt-BR
// ---------------------------------------------------------------------------

// Arredondamento half-up e separadores pt-BR (milhar com ponto p/ valores >= 1000)
export function fmtBR(v: number, dec: number): string {
  const neg = v < 0;
  const scale = Math.pow(10, dec);
  const n = Math.round(Math.abs(v) * scale);
  const int = Math.floor(n / scale);
  const frac = n % scale;
  const intStr = String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fracStr = dec > 0 ? "," + String(frac).padStart(dec, "0") : "";
  return (neg ? "-" : "") + intStr + fracStr;
}

// Azimute em GMS com segundo inteiro: `129°09'28"`, graus sem zero à esquerda
export function fmtAzimute(azDeg: number): string {
  let as = Math.round(azDeg * 3600); // arcsec, half-up
  as = ((as % 1296000) + 1296000) % 1296000; // normaliza 0–360°
  const d = Math.floor(as / 3600);
  const m = Math.floor((as % 3600) / 60);
  const s = as % 60;
  return `${d}°${pad2(m)}'${pad2(s)}"`;
}

// ---------------------------------------------------------------------------
// Detecção de fuso
// ---------------------------------------------------------------------------

export interface CandidatoZona { zone: number; epsg: number; lonCentroide: number; latCentroide: number }

// Todos os fusos plausíveis: |lon − MC| ≤ 3 e centroide dentro dos limites BR.
// Nota: coordenadas E próximas de 500.000 são ambíguas entre fusos por
// construção da projeção UTM — a escolha final usa o município/UF (ou override).
export function detectZoneCandidates(pontos: { e: number; n: number }[], proj4: Proj4): CandidatoZona[] {
  const ce = pontos.reduce((a, p) => a + p.e, 0) / pontos.length;
  const cn = pontos.reduce((a, p) => a + p.n, 0) / pontos.length;
  const out: CandidatoZona[] = [];
  for (const zone of ZONAS_BR) {
    const [lon, lat] = proj4(utmDef(zone), GEO_DEF, [ce, cn]);
    const mc = mcForZone(zone);
    if (Math.abs(lon - mc) <= 3 && lon >= LIMITES.lonMin && lon <= LIMITES.lonMax && lat >= LIMITES.latMin && lat <= LIMITES.latMax) {
      out.push({ zone, epsg: epsgForZone(zone), lonCentroide: lon, latCentroide: lat });
    }
  }
  return out;
}

// Bounding boxes aproximados por UF [lonMin, lonMax, latMin, latMax] — validação suave.
export const UF_BBOX: Record<string, [number, number, number, number]> = {
  AC: [-74.0, -66.6, -11.15, -7.1], AL: [-38.2, -35.1, -10.5, -8.8],
  AP: [-54.9, -49.8, -1.24, 4.5], AM: [-73.8, -56.1, -9.9, 2.25],
  BA: [-46.6, -37.3, -18.35, -8.5], CE: [-41.4, -37.25, -7.9, -2.75],
  DF: [-48.3, -47.3, -16.05, -15.5], ES: [-41.9, -39.6, -21.3, -17.9],
  GO: [-53.25, -45.9, -19.5, -12.4], MA: [-48.75, -41.8, -10.3, -1.05],
  MT: [-61.6, -50.2, -18.05, -7.35], MS: [-58.15, -50.9, -24.05, -17.15],
  MG: [-51.05, -39.85, -22.95, -14.25], PA: [-58.9, -46.05, -9.85, 2.6],
  PB: [-38.75, -34.8, -8.3, -6.0], PR: [-54.6, -48.0, -26.7, -22.5],
  PE: [-41.35, -34.8, -9.5, -3.8], PI: [-45.99, -40.35, -10.95, -2.7],
  RJ: [-44.9, -40.95, -23.4, -20.75], RN: [-38.6, -34.95, -6.98, -4.8],
  RS: [-57.65, -49.7, -33.75, -27.05], RO: [-66.8, -59.75, -13.7, -7.95],
  RR: [-64.8, -58.85, -1.6, 5.27], SC: [-53.85, -48.3, -29.4, -25.95],
  SP: [-53.1, -44.15, -25.3, -19.75], SE: [-38.25, -36.4, -11.55, -9.5],
  TO: [-50.75, -45.7, -13.5, -5.15],
};

// Prioridade heurística quando não há UF: fusos ordenados por participação no
// cadastro rural brasileiro (leste primeiro — decisão registrada no relatório).
const PRIORIDADE_ZONAS = [24, 23, 22, 21, 20, 25, 19, 18];

export function escolherZona(cands: CandidatoZona[], uf?: string | null): { escolhido: CandidatoZona | null; ambiguo: boolean; foraDaUf: boolean } {
  if (cands.length === 0) return { escolhido: null, ambiguo: false, foraDaUf: false };
  const ambiguo = cands.length > 1;
  const bbox = uf ? UF_BBOX[uf.toUpperCase()] : undefined;
  if (bbox) {
    const dentro = cands.filter((c) =>
      c.lonCentroide >= bbox[0] && c.lonCentroide <= bbox[1] &&
      c.latCentroide >= bbox[2] && c.latCentroide <= bbox[3]);
    if (dentro.length > 0) {
      // desempate: mais próximo do centro do bbox da UF
      const cx = (bbox[0] + bbox[1]) / 2;
      dentro.sort((a, b) => Math.abs(a.lonCentroide - cx) - Math.abs(b.lonCentroide - cx));
      return { escolhido: dentro[0], ambiguo: dentro.length > 1, foraDaUf: false };
    }
    // nenhum candidato dentro da UF informada → alerta suave
    return { escolhido: porPrioridade(cands), ambiguo, foraDaUf: true };
  }
  return { escolhido: porPrioridade(cands), ambiguo, foraDaUf: false };
}

function porPrioridade(cands: CandidatoZona[]): CandidatoZona {
  for (const z of PRIORIDADE_ZONAS) {
    const c = cands.find((x) => x.zone === z);
    if (c) return c;
  }
  return cands[0];
}

// ---------------------------------------------------------------------------
// Pipeline principal
// ---------------------------------------------------------------------------

export interface VerticeCalc {
  // entrada
  ordem: number;            // posição na sequência do TXT (com V inseridos), 0-based
  numTxt: number | null;    // null para vértices V inseridos manualmente
  h: number;
  sigmaPos: number;
  sigmaH: number;
  inserido: boolean;
  // coordenadas canônicas (arredondadas)
  latGms: GMS;
  lonGms: GMS;
  latDeg: number;           // = gmsToDeg(latGms)
  lonDeg: number;
  // plano re-projetado (base de TODOS os cálculos)
  eProj: number;
  nProj: number;
}

export interface EntradaVertice {
  numTxt: number | null;
  e?: number;               // UTM do TXT (ausente p/ V inserido)
  n?: number;
  latGms?: GMS;             // V inserido: coordenadas geográficas digitadas
  lonGms?: GMS;
  h: number;
  sigmaPos: number;
  sigmaH: number;
  inserido?: boolean;
}

// Converte, arredonda canonicamente e re-projeta cada vértice.
export function calcularVertices(entradas: EntradaVertice[], zone: number, proj4: Proj4): VerticeCalc[] {
  const ud = utmDef(zone);
  return entradas.map((v, i) => {
    let latGms: GMS, lonGms: GMS;
    if (v.latGms && v.lonGms) {
      latGms = v.latGms;
      lonGms = v.lonGms;
    } else {
      const [lon, lat] = proj4(ud, GEO_DEF, [v.e!, v.n!]);
      latGms = degToGmsCanonical(lat);
      lonGms = degToGmsCanonical(lon);
    }
    const latDeg = gmsToDeg(latGms);
    const lonDeg = gmsToDeg(lonGms);
    if (lonDeg < LIMITES.lonMin || lonDeg > LIMITES.lonMax || latDeg < LIMITES.latMin || latDeg > LIMITES.latMax) {
      throw new Error(`Vértice ${v.numTxt ?? "(inserido)"} fora dos limites geográficos SIGEF`);
    }
    const [eProj, nProj] = proj4(GEO_DEF, ud, [lonDeg, latDeg]);
    return {
      ordem: i, numTxt: v.numTxt, h: v.h, sigmaPos: v.sigmaPos, sigmaH: v.sigmaH,
      inserido: !!v.inserido, latGms, lonGms, latDeg, lonDeg, eProj, nProj,
    };
  });
}

export interface Segmento {
  deOrdem: number;
  paraOrdem: number;
  azimuteDeg: number;
  azimuteFmt: string;
  distM: number;        // valor bruto
  distCent: number;     // arredondado half-up em centímetros (valor publicado)
  distFmt: string;      // "33,01"
}

// Segmentos consecutivos no plano re-projetado, incluindo fechamento último→primeiro.
// `ordem` recebida já deve estar na sequência do perímetro (ring).
export function calcularSegmentos(ring: VerticeCalc[]): Segmento[] {
  const segs: Segmento[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const dE = b.eProj - a.eProj;
    const dN = b.nProj - a.nProj;
    let az = Math.atan2(dE, dN) * 180 / Math.PI;
    if (az < 0) az += 360;
    const dist = Math.hypot(dE, dN);
    const distCent = Math.round(dist * 100);
    segs.push({
      deOrdem: a.ordem, paraOrdem: b.ordem,
      azimuteDeg: az, azimuteFmt: fmtAzimute(az),
      distM: dist, distCent, distFmt: fmtBR(distCent / 100, 2),
    });
  }
  return segs;
}

// Área (shoelace) no plano re-projetado, em hectares.
export function calcularAreaHa(ring: { eProj: number; nProj: number }[]): number {
  let soma = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    soma += a.eProj * b.nProj - b.eProj * a.nProj;
  }
  return Math.abs(soma / 2) / 10000;
}

// Perímetro = soma das distâncias PUBLICADAS (2 casas), p/ auto-consistência com o memorial.
export function calcularPerimetroM(segs: Segmento[]): number {
  const cents = segs.reduce((a, s) => a + s.distCent, 0);
  return cents / 100;
}

// Rotaciona a sequência de vértices para iniciar no vértice de ordem `ordemInicial`.
export function rotacionarRing<T extends { ordem: number }>(vs: T[], ordemInicial: number): T[] {
  const idx = vs.findIndex((v) => v.ordem === ordemInicial);
  if (idx < 0) throw new Error(`Vértice inicial ordem=${ordemInicial} não encontrado`);
  return [...vs.slice(idx), ...vs.slice(0, idx)];
}

// ---------------------------------------------------------------------------
// Códigos de vértice
// ---------------------------------------------------------------------------

// Nome do vértice: {prefixo 4 chars}-{tipo}-{sequencial}, sequencial com mínimo
// 4 dígitos (zero à esquerda, ex.: DSBN-V-0758), até 7 dígitos.
export function codigoVertice(prefixo: string, tipo: "M" | "P" | "V", seq: number): string {
  return `${prefixo}-${tipo}-${String(seq).padStart(4, "0")}`;
}

// Aloca códigos na ordem do memorial (a partir do vértice inicial), consumindo
// contadores por tipo. Vértices inseridos (V) com código digitado mantêm o seu.
export function alocarCodigos(
  ringOrdenado: { ordem: number; tipo: "M" | "P" | "V"; codigoManual?: string | null }[],
  prefixo: string,
  contadores: { M: number; P: number; V: number },
): Map<number, string> {
  const c = { ...contadores };
  const out = new Map<number, string>();
  for (const v of ringOrdenado) {
    if (v.codigoManual) { out.set(v.ordem, v.codigoManual); continue; }
    out.set(v.ordem, codigoVertice(prefixo, v.tipo, c[v.tipo]));
    c[v.tipo]++;
  }
  return out;
}
