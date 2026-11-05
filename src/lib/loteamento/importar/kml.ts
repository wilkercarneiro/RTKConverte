// Leitor de KML/KMZ do loteamento pronto (Google Earth, QGIS, o KML que o
// próprio sistema exporta). Diferente do KML do CAR (car/kml.ts, que só quer
// o perímetro), aqui importa CADA Placemark e a pasta onde ele está: a pasta
// "Quadra A" diz a quadra dos lotes de dentro, o nome "A-01" ou "Lote 12" diz o
// número, o estilo "#verde" diz a área verde.
//
// Sem DOMParser (o mesmo código roda no navegador e nos testes do node): um
// varredor de marcas acompanha Document/Folder/Placemark.
import JSZip from "jszip";
import { coordenadas, nomeDe, tirarTags } from "../../car/kml.ts";
import type { LonLat } from "../../car/kml.ts";

export interface FeicaoKml {
  geo: "poligono" | "linha" | "ponto";
  /** contorno (sem repetir o 1º ponto) ou linha ou [ponto], em lon/lat */
  pts: LonLat[];
  nome: string | null;
  /** nomes das pastas, de fora para dentro */
  pastas: string[];
  /** estilo sem o "#" (o KML do sistema usa lote, esquina, verde, institucional…) */
  estilo: string | null;
  descricao: string | null;
}

const entidades = (s: string) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, "&");

const IGUAL = 1e-9;
const fechada = (l: LonLat[]) => l.length >= 4 && Math.abs(l[0][0] - l[l.length - 1][0]) <= IGUAL && Math.abs(l[0][1] - l[l.length - 1][1]) <= IGUAL;

function feicoesDoPlacemark(pm: string, pastas: string[]): FeicaoKml[] {
  const nome0 = nomeDe(pm);
  const nome = nome0 ? entidades(nome0) : null;
  const estilo = /<styleUrl>\s*#?([^<\s]+)\s*<\/styleUrl>/i.exec(pm)?.[1] ?? null;
  const d = /<description>([\s\S]*?)<\/description>/i.exec(pm);
  const descricao = d ? entidades(tirarTags(d[1])) || null : null;
  const base = { nome, pastas, estilo, descricao };
  const out: FeicaoKml[] = [];
  for (const pol of pm.match(/<Polygon[\s\S]*?<\/Polygon>/gi) ?? []) {
    const ext = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(pol);
    if (!ext) continue;
    const pts = coordenadas(ext[1]);
    out.push({ ...base, geo: "poligono", pts: fechada(pts) ? pts.slice(0, -1) : pts });
  }
  const sem = pm.replace(/<Polygon[\s\S]*?<\/Polygon>/gi, "");
  for (const m of sem.matchAll(/<(LineString|LinearRing)[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi)) {
    const pts = coordenadas(m[2]);
    if (m[1].toLowerCase() === "linearring" || fechada(pts)) out.push({ ...base, geo: "poligono", pts: fechada(pts) ? pts.slice(0, -1) : pts });
    else if (pts.length >= 2) out.push({ ...base, geo: "linha", pts });
  }
  for (const m of sem.matchAll(/<Point[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi)) {
    const c = coordenadas(m[1])[0];
    if (c) out.push({ ...base, geo: "ponto", pts: [c] });
  }
  return out;
}

/** Todas as feições do KML, com a pasta de cada uma. */
export function lerKmlLoteamento(texto: string): FeicaoKml[] {
  const xml = texto.replace(/<!--[\s\S]*?-->/g, "");
  if (!/<kml[\s>]/i.test(xml) && !/<Placemark[\s>]/i.test(xml)) throw new Error("O arquivo não parece um KML (não achei <kml> nem Placemark).");
  const out: FeicaoKml[] = [];
  const pilha: string[] = [];
  const baixo = xml.toLowerCase();
  const marca = /<(\/?)(Document|Folder|Placemark)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = marca.exec(xml))) {
    const fecha = m[1] === "/", tag = m[2].toLowerCase();
    if (tag === "placemark") {
      if (fecha) continue;
      const fim = baixo.indexOf("</placemark>", marca.lastIndex);
      if (fim < 0) break;
      out.push(...feicoesDoPlacemark(xml.slice(m.index, fim + 12), pilha.filter(Boolean)));
      marca.lastIndex = fim + 12;
      continue;
    }
    if (fecha) { pilha.pop(); continue; }
    // nome da pasta: o <name> logo depois da abertura, antes de qualquer filho
    const resto = xml.slice(marca.lastIndex);
    const filho = resto.search(/<(Folder|Placemark|Document)\b/i);
    const cab = filho >= 0 ? resto.slice(0, filho) : resto;
    const n = /<name>([\s\S]*?)<\/name>/i.exec(cab);
    pilha.push(tag === "folder" && n ? entidades(tirarTags(n[1])) : tag === "document" ? "" : "");
  }
  return out;
}

/** O KML de dentro do KMZ (doc.kml, ou o primeiro .kml do pacote). */
export async function kmlDoKmz(bytes: Uint8Array): Promise<string> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes); } catch { throw new Error("O KMZ não abriu (arquivo corrompido ou não é KMZ)."); }
  const nomes = Object.keys(zip.files).filter((n) => !zip.files[n].dir && /\.kml$/i.test(n));
  const escolhido = nomes.find((n) => /(^|\/)doc\.kml$/i.test(n)) ?? nomes[0];
  if (!escolhido) throw new Error("O KMZ não tem nenhum arquivo .kml dentro.");
  return zip.files[escolhido].async("string");
}
