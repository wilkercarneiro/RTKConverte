// Geometria da Consultar imóvel. UM motor de área só: as coordenadas vão para
// UTM SIRGAS 2000 no fuso do centro da área (fusoDoLon, como a análise de
// restrições) e a área sai pela fórmula de Gauss (areaUtmM2). Assim a lista, o
// mapa, a análise, o PDF e o arquivo baixado mostram a MESMA área.
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import { areaUtmM2, fusoDoLon } from "../restricoes.ts";
import type { LonLat } from "../restricoes.ts";
import { dentroAnel, distSegmento } from "../loteamento/geom.ts";
import type { Pt } from "../loteamento/geom.ts";
import type { Camada } from "../exportar/tipos.ts";

const proj = proj4mod as unknown as (de: string, para: string, c: [number, number]) => [number, number];

export type { LonLat };

/** Tira o ponto repetido no fim e o que não é número. */
export function semFecho(a: LonLat[]): LonLat[] {
  const b = (a ?? []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])).map((p) => [p[0], p[1]] as LonLat);
  return b.length > 1 && b[0][0] === b[b.length - 1][0] && b[0][1] === b[b.length - 1][1] ? b.slice(0, -1) : b;
}

/** Anéis válidos (3+ vértices, sem o fecho). */
export const aneisValidos = (aneis: LonLat[][]): LonLat[][] => aneis.map(semFecho).filter((a) => a.length >= 3);

/** Polígonos [externo, ...furos] → só os contornos externos (o que a análise e o serviço usam) e quantos furos ficaram de fora. */
export function contornosExternos(poligonos: LonLat[][][]): { aneis: LonLat[][]; furos: number } {
  let furos = 0;
  const aneis: LonLat[][] = [];
  for (const pol of poligonos) {
    const [ext, ...fs] = pol.map(semFecho);
    if (ext && ext.length >= 3) aneis.push(ext);
    furos += fs.filter((f) => f.length >= 3).length;
  }
  return { aneis, furos };
}

/** O fuso da área: o do meio de todos os vértices (o mesmo de consultarRestricoes). */
export function fusoDaArea(aneis: LonLat[][]): number {
  const todos = aneisValidos(aneis).flat();
  if (!todos.length) return 24;
  return fusoDoLon(todos.reduce((s, p) => s + p[0], 0) / todos.length);
}

export const paraUtm = (p: LonLat, fuso: number): Pt => proj(GEO_DEF, utmDef(fuso), p) as Pt;
export const deUtm = (p: Pt, fuso: number): LonLat => proj(utmDef(fuso), GEO_DEF, p) as LonLat;

export interface Medidas { fuso: number; areaM2: number; perimetroM: number; vertices: number; partes: number }

/** Área (m²), perímetro (m) e fuso da área, no motor do sistema. */
export function medir(aneis: LonLat[][]): Medidas {
  const v = aneisValidos(aneis);
  const fuso = fusoDaArea(v);
  const utm = v.map((a) => a.map((p) => paraUtm(p, fuso)));
  const perimetroM = utm.reduce((s, a) => s + a.reduce((t, p, i) => t + Math.hypot(a[(i + 1) % a.length][0] - p[0], a[(i + 1) % a.length][1] - p[1]), 0), 0);
  return { fuso, areaM2: areaUtmM2(utm), perimetroM, vertices: v.reduce((s, a) => s + a.length, 0), partes: v.length };
}

/** Ponto dentro de polígonos [externo, ...furos] (em grau: para "dentro/fora" a projeção não muda nada). */
export function pontoEmPoligonos(p: LonLat, poligonos: LonLat[][][]): boolean {
  return poligonos.some((pol) => {
    const [ext, ...furos] = pol.map(semFecho);
    return !!ext && ext.length >= 3 && dentroAnel(p, ext) && !furos.some((f) => f.length >= 3 && dentroAnel(p, f));
  });
}

/** Distância (m) do ponto ao imóvel: 0 dentro; senão até o lado mais perto, em UTM no fuso dado. */
export function distanciaAoImovelM(p: LonLat, aneis: LonLat[][], fuso: number): number {
  const v = aneisValidos(aneis);
  if (v.some((a) => dentroAnel(p, a))) return 0;
  const q = paraUtm(p, fuso);
  let d = Infinity;
  for (const a of v) {
    const u = a.map((x) => paraUtm(x, fuso));
    for (let i = 0; i < u.length; i++) d = Math.min(d, distSegmento(q, u[i], u[(i + 1) % u.length]).d);
  }
  return d;
}

export type Caixa = [number, number, number, number];

/** Caixa lon/lat [oeste, sul, leste, norte] da área com `margemM` metros em volta. */
export function caixaComMargem(aneis: LonLat[][], margemM: number): Caixa {
  const v = aneisValidos(aneis);
  const fuso = fusoDaArea(v);
  const u = v.flat().map((p) => paraUtm(p, fuso));
  const xs = u.map((p) => p[0]), ys = u.map((p) => p[1]);
  const cantos = [[Math.min(...xs) - margemM, Math.min(...ys) - margemM], [Math.max(...xs) + margemM, Math.min(...ys) - margemM],
    [Math.max(...xs) + margemM, Math.max(...ys) + margemM], [Math.min(...xs) - margemM, Math.max(...ys) + margemM]].map((c) => deUtm(c as Pt, fuso));
  return [Math.min(...cantos.map((c) => c[0])), Math.min(...cantos.map((c) => c[1])), Math.max(...cantos.map((c) => c[0])), Math.max(...cantos.map((c) => c[1]))];
}

/** Círculo de `raioM` metros em volta do ponto (o "ponto consultado" no mapa). */
export function circulo(p: LonLat, raioM: number, n = 48): LonLat[] {
  const fuso = fusoDoLon(p[0]);
  const c = paraUtm(p, fuso);
  return Array.from({ length: n }, (_, i) => deUtm([c[0] + raioM * Math.cos((2 * Math.PI * i) / n), c[1] + raioM * Math.sin((2 * Math.PI * i) / n)], fuso));
}

/** Centro (média dos vértices) — para clima, solo e bioma, que são consultas por ponto. */
export function centroDe(aneis: LonLat[][]): LonLat | null {
  const todos = aneisValidos(aneis).flat();
  if (!todos.length) return null;
  // centro da caixa: num imóvel com um lado cheio de vértices, a média puxa para a borda
  const xs = todos.map((p) => p[0]), ys = todos.map((p) => p[1]);
  const c: LonLat = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  // imóvel em "L": o centro da caixa pode cair fora; aí vale o vértice mais perto dele
  if (aneisValidos(aneis).some((a) => dentroAnel(c, a))) return c;
  return todos.reduce((m, p) => (Math.hypot(p[0] - c[0], p[1] - c[1]) < Math.hypot(m[0] - c[0], m[1] - c[1]) ? p : m));
}

/** As camadas da exportação (src/lib/exportar): o perímetro e os vértices numerados. */
export function camadasDaArea(nome: string, aneis: LonLat[][], nomes?: (string | null)[]): Camada[] {
  const v = aneisValidos(aneis);
  let k = 0;
  return [
    {
      nome: "PERIMETRO", cor: "#F5C542", segmentos: true,
      feicoes: v.map((a, i) => ({ nome: v.length > 1 ? `${nome} - parte ${i + 1}` : nome, tipo: "poligono" as const, geo: a })),
    },
    {
      nome: "VERTICES", cor: "#E53935",
      feicoes: v.flatMap((a) => a.map((p) => { k++; return { nome: nomes?.[k - 1] || `V${k}`, tipo: "ponto" as const, geo: [p] }; })),
    },
  ];
}

/** O maior contorno (o serviço de CAR recebe um perímetro só). */
export function maiorAnel(aneis: LonLat[][]): LonLat[] | null {
  const v = aneisValidos(aneis);
  if (!v.length) return null;
  return v.map((a) => ({ a, m: medir([a]).areaM2 })).sort((x, y) => y.m - x.m)[0].a;
}

// ---------------------------------------------------------------------------
// Números para a tela
// ---------------------------------------------------------------------------

export const fmtNum = (v: number, casas: number): string =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
/** "743,8531 ha" (4 casas, como o resto do sistema). */
export const fmtHa = (m2: number): string => `${fmtNum(m2 / 10_000, 4)} ha`;
/** Para cartões: "743,85 ha" ou "8.540 m²" quando é pequeno. */
export const fmtAreaCurta = (m2: number): string => (m2 >= 10_000 ? `${fmtNum(m2 / 10_000, 2)} ha` : `${fmtNum(m2, 0)} m²`);
export const fmtDist = (m: number): string => (m >= 1000 ? `${fmtNum(m / 1000, 1)} km` : `${fmtNum(m, 0)} m`);
