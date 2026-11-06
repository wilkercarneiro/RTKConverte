// "Enviar arquivo" da Consultar imóvel: KML, KMZ, GPX ou GeoJSON viram a área
// a analisar, com os leitores que o CAR já usa (src/lib/car/kml.ts, gpx.ts).
import JSZip from "jszip";
import { lerKml } from "../car/kml.ts";
import { lerGpx } from "../car/gpx.ts";
import { autointersecta, contornosExternos, semFecho, textoCruzamento } from "./geometria.ts";
import type { LonLat } from "./geometria.ts";
import type { ImovelEncontrado } from "./tipos.ts";

export const ACEITA_ARQUIVO = ".kml,.kmz,.gpx,.geojson,.json";

/** Texto do arquivo (o KMZ é um zip com o .kml dentro). */
export async function textoDoArquivo(nome: string, dados: ArrayBuffer | Uint8Array): Promise<string> {
  if (/\.kmz$/i.test(nome)) {
    const zip = await JSZip.loadAsync(dados);
    const kml = Object.values(zip.files).find((x) => !x.dir && /\.kml$/i.test(x.name));
    if (!kml) throw new Error("O KMZ não tem nenhum arquivo .kml dentro.");
    return kml.async("string");
  }
  return new TextDecoder("utf-8").decode(dados);
}

function poligonosGeoJson(g: unknown): LonLat[][][] {
  const x = g as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[]; geometries?: unknown[] };
  if (!x || typeof x !== "object") return [];
  if (x.type === "FeatureCollection") return (x.features ?? []).flatMap(poligonosGeoJson);
  if (x.type === "Feature") return poligonosGeoJson(x.geometry);
  if (x.type === "GeometryCollection") return (x.geometries ?? []).flatMap(poligonosGeoJson);
  const anel = (a: unknown) => semFecho(((a as number[][]) ?? []).map((p) => [Number(p?.[0]), Number(p?.[1])] as LonLat));
  const pol = (c: unknown) => ((c as unknown[]) ?? []).map(anel).filter((a) => a.length >= 3);
  if (x.type === "Polygon") return [pol(x.coordinates)].filter((p) => p.length);
  if (x.type === "MultiPolygon") return ((x.coordinates as unknown[]) ?? []).map(pol).filter((p) => p.length);
  // linha fechada (CAD exporta assim)
  if (x.type === "LineString") {
    const l = anel(x.coordinates);
    return l.length >= 3 ? [[l]] : [];
  }
  return [];
}

/** Coordenada em grau? (GeoJSON em UTM não serve: o padrão é WGS84/SIRGAS em grau.) */
const emGrau = (pols: LonLat[][][]) => pols.flat(2).every((p) => Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);

/** O arquivo → a área (com os avisos da leitura). */
export function areaDoArquivo(nome: string, texto: string): { imovel: ImovelEncontrado; avisos: string[] } {
  const base = nome.replace(/\.(kml|kmz|gpx|geojson|json)$/i, "");
  let poligonos: LonLat[][][] = [];
  let nomes: (string | null)[] | undefined;
  let avisos: string[] = [];
  let titulo = base;
  if (/\.gpx$/i.test(nome) || /<gpx[\s>]/i.test(texto.slice(0, 2000))) {
    const g = lerGpx(texto);
    poligonos = [[g.perimetro]];
    nomes = g.nomes; avisos = g.avisos; titulo = g.nome || base;
  } else if (/\.(geo)?json$/i.test(nome) || /^\s*[{[]/.test(texto)) {
    let j: unknown;
    try { j = JSON.parse(texto); } catch { throw new Error("O arquivo não é um GeoJSON válido."); }
    poligonos = poligonosGeoJson(j);
    if (!poligonos.length) throw new Error("O GeoJSON não tem nenhum polígono.");
    if (!emGrau(poligonos)) throw new Error("O GeoJSON está em metros (UTM). Exporte em graus (WGS84/SIRGAS 2000, EPSG:4326 ou 4674).");
    const j2 = j as { name?: string; features?: { properties?: Record<string, unknown> }[] };
    const nm = j2.features?.[0]?.properties?.nome ?? j2.features?.[0]?.properties?.name ?? j2.name;
    if (nm) titulo = String(nm);
    if (poligonos.length > 1) avisos.push(`O arquivo tem ${poligonos.length} polígonos: entram todos, como partes da mesma área.`);
  } else {
    const k = lerKml(texto);
    if (k.perimetro.length < 3) throw new Error("Não achei um polígono no KML.");
    poligonos = [[k.perimetro]];
    nomes = k.nomes; avisos = [...k.avisos]; titulo = k.nome || base;
    if (k.rios.length) avisos.push(`${k.rios.length} linha(s) aberta(s) do arquivo ficaram de fora (rios/estradas não entram na consulta).`);
  }
  const { aneis, furos } = contornosExternos(poligonos);
  if (!aneis.length) throw new Error("O arquivo não tem um polígono com 3 vértices ou mais.");
  // lados que se cruzam: a área sai sem sentido (e iria assim para a análise, o PDF e o serviço de CAR)
  for (const [i, a] of aneis.entries()) {
    const par = autointersecta(a);
    if (par) {
      throw new Error(`os lados do polígono${aneis.length > 1 ? ` (parte ${i + 1})` : ""} se cruzam — ${textoCruzamento(par, a.length)}. A área calculada não teria sentido. Corrija a ordem dos vértices no arquivo (no Google Earth ou no CAD) e envie de novo.`);
    }
  }
  if (furos) avisos.push(`${furos} furo(s) no polígono: a área usa o contorno externo.`);
  return {
    imovel: {
      id: `arquivo:${nome}`, fonte: "arquivo", codigo: null, titulo, aneis, poligonos, furos, nomes,
      areaDeclaradaHa: null, municipio: null, uf: null, atualizacao: null, situacao: `Arquivo ${nome}`, detalhes: [],
    },
    avisos,
  };
}
