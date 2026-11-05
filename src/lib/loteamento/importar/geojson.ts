// Leitor de GeoJSON do loteamento pronto (QGIS, ArcGIS, scripts). Cada feição
// traz as propriedades (lote, quadra, tipo, nome) que dizem o que ela é. As
// coordenadas vêm em lon/lat (o padrão do GeoJSON, RFC 7946) ou projetadas,
// quando o arquivo diz o sistema no "crs" (EPSG 31978 a 31985 = SIRGAS 2000
// UTM 18S a 25S); sem "crs" e com número grande, são UTM do fuso do serviço.

export interface FeicaoGeoJson {
  geo: "poligono" | "linha" | "ponto";
  /** contorno externo (sem repetir o 1º ponto), linha ou [ponto] */
  pts: [number, number][];
  props: Record<string, unknown>;
}

export interface GeoJsonLido {
  feicoes: FeicaoGeoJson[];
  /** "lonlat" ou o fuso UTM sul em que as coordenadas estão (null = UTM sem fuso dito) */
  sistema: "lonlat" | { fuso: number | null };
}

type Geo = { type?: string; coordinates?: unknown; geometries?: Geo[] };

const par = (c: unknown): [number, number] | null =>
  Array.isArray(c) && c.length >= 2 && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1])) ? [Number(c[0]), Number(c[1])] : null;
const linha = (c: unknown): [number, number][] => (Array.isArray(c) ? c.map(par).filter((p): p is [number, number] => !!p) : []);
const anel = (c: unknown): [number, number][] => {
  const l = linha(c);
  if (l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1]) l.pop();
  return l;
};

function geometrias(g: Geo | null | undefined, props: Record<string, unknown>, out: FeicaoGeoJson[]) {
  if (!g || typeof g !== "object") return;
  const c = g.coordinates;
  switch (g.type) {
    case "Polygon": if (Array.isArray(c) && c.length) out.push({ geo: "poligono", pts: anel(c[0]), props }); break;
    case "MultiPolygon": if (Array.isArray(c)) for (const p of c) if (Array.isArray(p) && p.length) out.push({ geo: "poligono", pts: anel(p[0]), props }); break;
    case "LineString": {
      const l = linha(c);
      const fechada = l.length > 3 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];
      out.push(fechada ? { geo: "poligono", pts: l.slice(0, -1), props } : { geo: "linha", pts: l, props });
      break;
    }
    case "MultiLineString": if (Array.isArray(c)) for (const l of c) out.push({ geo: "linha", pts: linha(l), props }); break;
    case "Point": { const p = par(c); if (p) out.push({ geo: "ponto", pts: [p], props }); break; }
    case "MultiPoint": for (const p of linha(c)) out.push({ geo: "ponto", pts: [p], props }); break;
    case "GeometryCollection": for (const x of g.geometries ?? []) geometrias(x, props, out); break;
  }
}

export function lerGeoJson(texto: string): GeoJsonLido {
  let j: Record<string, unknown>;
  try { j = JSON.parse(texto.replace(/^﻿/, "")); } catch { throw new Error("O GeoJSON não abriu: o arquivo não é um JSON válido."); }
  if (!j || typeof j !== "object") throw new Error("O GeoJSON está vazio.");
  const feicoes: FeicaoGeoJson[] = [];
  const lista = j.type === "FeatureCollection" && Array.isArray(j.features) ? j.features as Record<string, unknown>[]
    : j.type === "Feature" ? [j] : [{ type: "Feature", geometry: j, properties: {} }];
  for (const f of lista) geometrias(f?.geometry as Geo, (f?.properties as Record<string, unknown>) ?? {}, feicoes);
  if (!feicoes.length) throw new Error("O GeoJSON não tem nenhuma geometria.");
  // sistema: o "crs" antigo (EPSG:31984, urn:ogc:def:crs:EPSG::31984) ou pelo tamanho dos números
  const crs = JSON.stringify((j as { crs?: unknown }).crs ?? "");
  const epsg = Number(/EPSG[:]{1,2}(\d{4,5})/i.exec(crs)?.[1] ?? NaN);
  let sistema: GeoJsonLido["sistema"];
  if (epsg >= 31978 && epsg <= 31985) sistema = { fuso: epsg - 31960 };
  else if (epsg === 4326 || epsg === 4674 || /CRS84/i.test(crs)) sistema = "lonlat";
  else {
    const pts = feicoes.flatMap((f) => f.pts);
    sistema = pts.every((p) => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) ? "lonlat" : { fuso: null };
  }
  return { feicoes, sistema };
}
