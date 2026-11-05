// KML (Google Earth) e KMZ (o mesmo KML zipado como doc.kml).
//
// Uma pasta por camada, um estilo por camada (a cor da camada na linha, no
// preenchimento translúcido e no alfinete do vértice). Cada polígono e cada
// vértice é um Placemark com nome; os atributos vão no ExtendedData, que o
// Google Earth mostra em tabela no balão. Anel externo anti-horário e furo
// horário, como o KML pede; `tessellate` para a divisa acompanhar o relevo.
import JSZip from "jszip";
import { antiHorario, fechar, horario } from "./coordenadas.ts";
import type { CamadaPronta, FeicaoPronta } from "./coordenadas.ts";
import type { Valor, XY } from "./tipos.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** cor KML é aabbggrr */
const corKml = (hex: string, alfa: string) => alfa + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
/** 9 casas de grau ≈ 0,1 mm */
const g9 = (v: number) => v.toFixed(9);
const tupla = (p: XY, h?: number | null) => (typeof h === "number" ? `${g9(p[0])},${g9(p[1])},${h.toFixed(3)}` : `${g9(p[0])},${g9(p[1])}`);

/** Anel fechado com a altitude de cada ponto (o sentido muda, a altitude acompanha o ponto). */
function anelKml(geo: XY[], alt: (number | null)[], externo: boolean): string {
  const comAlt = geo.map((p, i) => ({ p, h: alt[i] ?? null }));
  const orientado = (externo ? antiHorario : horario)(geo);
  const seq = orientado === geo ? comAlt : [...comAlt].reverse();
  return fechar(seq.map((x) => x.p)).map((p, i) => tupla(p, seq[i % seq.length].h)).join(" ");
}

function dadosExtras(props: Record<string, Valor>): string {
  const linhas = Object.entries(props).filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(String(v))}</value></Data>`);
  return linhas.length ? `<ExtendedData>${linhas.join("")}</ExtendedData>` : "";
}

function geometria(f: FeicaoPronta): string {
  if (f.tipo === "ponto") return `<Point><coordinates>${tupla(f.geo[0], f.alt[0])}</coordinates></Point>`;
  if (f.tipo === "linha") return `<LineString><tessellate>1</tessellate><coordinates>${f.geo.map((p, i) => tupla(p, f.alt[i])).join(" ")}</coordinates></LineString>`;
  const furos = f.furosGeo.map((h) => `<innerBoundaryIs><LinearRing><coordinates>${anelKml(h, [], false)}</coordinates></LinearRing></innerBoundaryIs>`).join("");
  return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${anelKml(f.geo, f.alt, true)}</coordinates></LinearRing></outerBoundaryIs>${furos}</Polygon>`;
}

export function gerarKmlArea(camadas: CamadaPronta[], nome: string): string {
  const estilos = camadas.map((c, i) => `<Style id="camada${i + 1}">`
    + `<IconStyle><color>${corKml(c.cor, "ff")}</color><scale>0.7</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle>`
    + `<LabelStyle><scale>0.8</scale></LabelStyle>`
    + `<LineStyle><color>${corKml(c.cor, "ff")}</color><width>2</width></LineStyle>`
    + `<PolyStyle><color>${corKml(c.cor, "40")}</color></PolyStyle></Style>`);
  const pastas = camadas.map((c, i) => [
    `<Folder><name>${esc(c.nome)}</name>`,
    ...c.feicoes.map((f) => `<Placemark><name>${esc(f.nome)}</name><styleUrl>#camada${i + 1}</styleUrl>${dadosExtras(f.props)}${geometria(f)}</Placemark>`),
    "</Folder>",
  ].join("\n"));
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    `<Document><name>${esc(nome)}</name>`,
    "<description>Coordenadas SIRGAS 2000 (lon, lat em grau). Gerado pelo Vertces.</description>",
    ...estilos,
    ...pastas,
    "</Document></kml>",
    "",
  ].join("\n");
}

/** KMZ: o KML como doc.kml dentro de um zip (o Google Earth abre direto). */
export async function gerarKmzArea(camadas: CamadaPronta[], nome: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("doc.kml", gerarKmlArea(camadas, nome));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
