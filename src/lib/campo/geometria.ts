// Contas da medição de campo.
//
// Área e perímetro saem do MOTOR ÚNICO do sistema (princípio 4 do plano): UTM
// SIRGAS 2000 no fuso do lugar (`fusoDoLon`, as mesmas definições de
// _shared/geo.ts por `geoParaUtm`) e área de Gauss (`areaUtmM2`). O mesmo
// polígono mostra a mesma área aqui, na Consulta e no serviço de CAR.
//
// As decisões rápidas do GPS (andou 5 m? virou 15°?) usam uma conta local
// (plano tangente no elipsoide GRS80, erro < 0,01% em centenas de metros):
// rodam a cada leitura e não precisam do proj4. Nada que aparece como área ou
// perímetro sai delas.
import { areaUtmM2, fmtNum, fusoDoLon } from "../restricoes.ts";
import { geoParaUtm } from "../exportar/coordenadas.ts";
import type { LonLat, VerticeCampo } from "./tipos.ts";

const RAD = Math.PI / 180;
// GRS80 (SIRGAS 2000)
const A = 6378137, E2 = 0.00669438002290;

/** Metros por grau de longitude e de latitude na latitude dada (raios do elipsoide). */
export function metrosPorGrau(lat: number): [number, number] {
  const s = Math.sin(lat * RAD), w = 1 - E2 * s * s;
  const n = A / Math.sqrt(w), m = (A * (1 - E2)) / (w * Math.sqrt(w));
  return [n * Math.cos(lat * RAD) * RAD, m * RAD];
}

/** O ponto a (leste, norte) metros de `o` (plano tangente). */
export function deslocar(o: LonLat, leste: number, norte: number): LonLat {
  const [kx, ky] = metrosPorGrau(o[1]);
  return [o[0] + leste / kx, o[1] + norte / ky];
}

/** Distância em metros entre dois pontos lon/lat próximos (plano tangente). */
export function distanciaM(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const [kx, ky] = metrosPorGrau((a.lat + b.lat) / 2);
  return Math.hypot((b.lon - a.lon) * kx, (b.lat - a.lat) * ky);
}

/** Rumo de a para b em graus (0 = norte, 90 = leste). */
export function rumoGraus(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * RAD);
  const dx = (b.lon - a.lon) * k, dy = b.lat - a.lat;
  return (Math.atan2(dx, dy) / RAD + 360) % 360;
}

/** Diferença entre dois rumos, 0–180°. */
export function difAngulo(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Fuso UTM da medição: o do meio da caixa (como o CAR e a Consulta). */
export function fusoDaMedicao(vertices: { lon: number }[]): number {
  if (!vertices.length) return 24;
  let min = Infinity, max = -Infinity;
  for (const v of vertices) { if (v.lon < min) min = v.lon; if (v.lon > max) max = v.lon; }
  return fusoDoLon((min + max) / 2);
}

export interface Medidas {
  n: number;
  fuso: number;
  /** área do contorno fechado (m²); 0 com menos de 3 vértices */
  areaM2: number;
  /** perímetro do contorno fechado (m); com 2 vértices, a distância entre eles */
  perimetroM: number;
  /** precisão média dos vértices com precisão (m); null = todos à mão */
  precisaoMediaM: number | null;
  /** pior precisão (m) */
  precisaoPiorM: number | null;
}

/** Área, perímetro e precisão no motor único. Aberta ou fechada, a área é a do contorno fechando agora. */
export function medir(vertices: VerticeCampo[]): Medidas {
  const n = vertices.length;
  const fuso = fusoDaMedicao(vertices);
  const precs = vertices.map((v) => v.precisao).filter((p): p is number => p != null && Number.isFinite(p));
  const precisaoMediaM = precs.length ? precs.reduce((s, p) => s + p, 0) / precs.length : null;
  const precisaoPiorM = precs.length ? Math.max(...precs) : null;
  if (n < 2) return { n, fuso, areaM2: 0, perimetroM: 0, precisaoMediaM, precisaoPiorM };
  const utm = vertices.map((v) => geoParaUtm([v.lon, v.lat], fuso));
  let perimetroM = 0;
  const lados = n >= 3 ? n : 1;
  for (let i = 0; i < lados; i++) {
    const a = utm[i], b = utm[(i + 1) % n];
    perimetroM += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const areaM2 = n >= 3 ? areaUtmM2([utm]) : 0;
  return { n, fuso, areaM2, perimetroM, precisaoMediaM, precisaoPiorM };
}

/** O contorno fechado cruza a si mesmo? (lados não vizinhos que se cortam) */
export function contornoSeCruza(vertices: { lon: number; lat: number }[]): boolean {
  const n = vertices.length;
  if (n < 4) return false;
  const o = vertices[0];
  const [kx, ky] = metrosPorGrau(o.lat);
  const p = vertices.map((v) => [(v.lon - o.lon) * kx, (v.lat - o.lat) * ky] as [number, number]);
  const lado = (a: [number, number], b: [number, number], c: [number, number]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const corta = (a: [number, number], b: [number, number], c: [number, number], d: [number, number]) => {
    const d1 = lado(a, b, c), d2 = lado(a, b, d), d3 = lado(c, d, a), d4 = lado(c, d, b);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // lados vizinhos pelo fecho
      if (corta(a, b, p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Círculo (anel lon/lat fechado) de raio em metros: o círculo de precisão do ponto azul. */
export function circuloLonLat(centro: LonLat, raioM: number, lados = 48): LonLat[] {
  const anel: LonLat[] = [];
  for (let i = 0; i < lados; i++) {
    const a = (i / lados) * 2 * Math.PI;
    anel.push(deslocar(centro, Math.sin(a) * raioM, Math.cos(a) * raioM));
  }
  anel.push(anel[0]);
  return anel;
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** "2,4312 ha" (a área do imóvel, como no resto do sistema). */
export const textoHa = (m2: number): string => `${fmtNum(m2 / 10000, 4)} ha`;
/** "8.420 m²" */
export const textoM2 = (m2: number): string => `${fmtNum(m2, 0)} m²`;
/** "642 m" / "1,24 km" */
export const textoDistancia = (m: number): string => (m >= 1000 ? `${fmtNum(m / 1000, 2)} km` : `${fmtNum(m, m < 10 ? 1 : 0)} m`);
/** "±2,8 m" */
export const textoPrecisao = (m: number | null): string => (m == null ? "à mão" : `±${fmtNum(m, m < 10 ? 1 : 0)} m`);

export type ClassePrecisao = "boa" | "media" | "ruim";
/** Cor da precisão (plano): verde ≤ 3 m, âmbar ≤ 8 m, vermelho acima. */
export function classePrecisao(m: number | null): ClassePrecisao {
  if (m == null || m <= 3) return "boa";
  return m <= 8 ? "media" : "ruim";
}
