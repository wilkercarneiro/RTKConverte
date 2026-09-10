// Base local de parcelas certificadas (SIGEF): consulta de vizinhança e de
// sobreposição, e gravação das parcelas que chegam por CSV. O trabalho
// geométrico é do PostGIS (migration 0018); aqui só se monta o GeoJSON.
import proj4mod from "proj4";
import { supabase } from "./supabase";
import { GEO_DEF, gmsToDeg, parseGmsPlanilha, utmDef } from "../../supabase/functions/_shared/geo.ts";
import type { Vertice } from "./types";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

export type LonLat = [number, number];

export interface ParcelaProps {
  codigo: string;
  nome: string | null;
  uf: string | null;
  municipio: string | null;
  situacao: string | null;
  area_ha: number | null;
  fonte: string;
  /** ponto interno (lon, lat) para rotular */
  centro: LonLat;
}

export interface FeatureParcela {
  type: "Feature";
  id: number;
  properties: ParcelaProps;
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon;
}

export interface Sobreposicao {
  codigo: string;
  nome: string | null;
  municipio: string | null;
  uf: string | null;
  situacao: string | null;
  area_ha: number | null;
  /** área da interseção com o imóvel */
  area_m2: number;
  /** quanto do imóvel está dentro dessa parcela */
  percentual_imovel: number;
  geometria: GeoJSON.MultiPolygon | GeoJSON.Polygon;
}

export interface ResultadoSigef {
  parcelas: { type: "FeatureCollection"; features: FeatureParcela[] };
  sobreposicoes: Sobreposicao[];
  area_imovel_m2?: number;
}

/** Fecha o anel (primeiro == último), como o GeoJSON exige. */
export function fecharAnel(anel: LonLat[]): LonLat[] {
  if (anel.length < 3) return anel;
  const [a, b] = [anel[0], anel[anel.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? anel : [...anel, a];
}

export function multiPoligono(aneis: LonLat[][]): GeoJSON.MultiPolygon {
  return { type: "MultiPolygon", coordinates: aneis.filter((a) => a.length >= 3).map((a) => [fecharAnel(a)]) };
}

/**
 * lon/lat de um vértice da conferência: E/N no fuso do serviço quando há; senão
 * o GMS gravado (vértice inserido de vizinho certificado). null se nada serve.
 */
export function lonLatDoVertice(v: Vertice, fuso: number): LonLat | null {
  if (v.e !== null && v.n !== null && Number.isFinite(Number(v.e)) && Number.isFinite(Number(v.n))) {
    const [lon, lat] = proj(utmDef(fuso), GEO_DEF, [Number(v.e), Number(v.n)]);
    return [lon, lat];
  }
  try {
    if (v.lat_gms && v.lon_gms) return [gmsToDeg(parseGmsPlanilha(v.lon_gms)), gmsToDeg(parseGmsPlanilha(v.lat_gms))];
  } catch { /* GMS vazio ou inválido */ }
  return null;
}

/** Anéis lon/lat do imóvel: um por lista de ordens (partes/glebas) ou um só com todos. */
export function aneisLonLat(vertices: Vertice[], fuso: number, ordens?: number[][] | null): LonLat[][] {
  const porOrdem = new Map(vertices.map((v) => [v.ordem, v]));
  const listas = ordens && ordens.length ? ordens : [[...vertices].sort((a, b) => a.ordem - b.ordem).map((v) => v.ordem)];
  return listas
    .map((os) => os.map((o) => porOrdem.get(o)).filter((v): v is Vertice => Boolean(v)).map((v) => lonLatDoVertice(v, fuso)).filter((p): p is LonLat => p !== null))
    .filter((a) => a.length >= 3);
}

export async function consultarSigef(aneis: LonLat[][], opcoes?: { raioM?: number; ignorar?: string[] }): Promise<ResultadoSigef> {
  const vazio: ResultadoSigef = { parcelas: { type: "FeatureCollection", features: [] }, sobreposicoes: [] };
  const mp = multiPoligono(aneis);
  if (!mp.coordinates.length) return vazio;
  const { data, error } = await supabase.rpc("sigef_consultar", {
    imovel: mp, raio_m: opcoes?.raioM ?? 300, ignorar_codigos: opcoes?.ignorar ?? [],
  });
  if (error) throw new Error(error.message);
  return (data as ResultadoSigef) ?? vazio;
}

export interface ParcelaParaGuardar {
  codigo: string;
  nome?: string | null;
  uf?: string | null;
  municipio?: string | null;
  fonte?: string;
  geometria: GeoJSON.Polygon | GeoJSON.MultiPolygon;
}

export async function guardarParcelasSigef(parcelas: ParcelaParaGuardar[]): Promise<number> {
  if (!parcelas.length) return 0;
  const { data, error } = await supabase.rpc("sigef_guardar", { parcelas });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

/** Quantas parcelas a base local tem por UF. */
export async function coberturaSigef(): Promise<Record<string, number>> {
  const { data, error } = await supabase.rpc("sigef_cobertura");
  if (error) throw new Error(error.message);
  return (data as Record<string, number>) ?? {};
}

export const fmtArea = (m2: number): string =>
  m2 >= 10000 ? `${(m2 / 10000).toFixed(4).replace(".", ",")} ha` : `${m2.toFixed(1).replace(".", ",")} m²`;
