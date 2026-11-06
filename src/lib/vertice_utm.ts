// E/N de um vértice no fuso do serviço: o E/N gravado quando há; senão o GMS
// (vértice digitado ou trazido de vizinho certificado, que só tem lat/lon).
// É a mesma conta do utmDoVertice da conferência (Conferencia.tsx), aqui fora
// do componente para o relevo e quem mais precisar.
import proj4mod from "proj4";
import { degToGmsCanonical, fmtGmsPlanilha, GEO_DEF, gmsToDeg, parseGmsPlanilha, utmDef } from "../../supabase/functions/_shared/geo.ts";
import type { Vertice } from "./types";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

type VerticeEN = Pick<Vertice, "e" | "n" | "lat_gms" | "lon_gms">;

/** E/N do GMS gravado, no fuso dado; null sem fuso ou com GMS vazio/inválido. */
export function utmDoGms(v: Pick<Vertice, "lat_gms" | "lon_gms">, fuso: number | null | undefined): [number, number] | null {
  if (!fuso || !v.lat_gms?.trim() || !v.lon_gms?.trim()) return null;
  try {
    const lon = gmsToDeg(parseGmsPlanilha(v.lon_gms)), lat = gmsToDeg(parseGmsPlanilha(v.lat_gms));
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const en = proj(GEO_DEF, utmDef(fuso), [lon, lat]);
    return Number.isFinite(en[0]) && Number.isFinite(en[1]) ? en : null;
  } catch {
    return null;
  }
}

/**
 * Os vértices reinterpretados num fuso novo. O E/N do TXT é a medição: trocar o
 * fuso diz "estes E/N são do fuso z", então o GMS (lat_gms/lon_gms) é refeito a
 * partir deles. Vértice inserido à mão (vizinho certificado, V digitado) tem o
 * GMS como verdade: o E/N dele é que é refeito.
 *
 * Antes (até 06/11/2026) a troca de fuso sem CSV de certificados mudava só
 * `servicos.fuso_utm` e deixava o GMS no fuso antigo — 6° de longitude fora. A
 * satélite, a prévia de área e as restrições leem o GMS e foram parar ~650 km
 * a oeste (FAZENDA SALGADINHO e mais 4 serviços na BA).
 */
export function reprojetarVerticesNoFuso<T extends VerticeEN & { inserido_manual?: boolean | null }>(vertices: T[], fuso: number): T[] {
  const ud = utmDef(fuso);
  return vertices.map((v) => {
    if (v.inserido_manual) {
      const en = utmDoGms(v, fuso);
      return en ? { ...v, e: en[0], n: en[1] } : v;
    }
    const e = v.e === null || v.e === undefined ? NaN : Number(v.e), n = v.n === null || v.n === undefined ? NaN : Number(v.n);
    if (!Number.isFinite(e) || !Number.isFinite(n)) return v;
    try {
      const [lon, lat] = proj(ud, GEO_DEF, [e, n]);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return v;
      return { ...v, lat_gms: fmtGmsPlanilha(degToGmsCanonical(lat), "lat"), lon_gms: fmtGmsPlanilha(degToGmsCanonical(lon), "lon") };
    } catch {
      return v;
    }
  });
}

/** E/N do vértice: o gravado (finito) primeiro; senão convertido do GMS no fuso do serviço. */
export function utmDoVertice(v: VerticeEN, fuso: number | null | undefined): [number, number] | null {
  const e = v.e === null || v.e === undefined ? NaN : Number(v.e), n = v.n === null || v.n === undefined ? NaN : Number(v.n);
  if (Number.isFinite(e) && Number.isFinite(n)) return [e, n];
  return utmDoGms(v, fuso);
}
