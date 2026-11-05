// GeoJSON (RFC 7946): FeatureCollection em lon/lat, anel externo anti-horário
// e furo horário (a regra da RFC, que o QGIS e os mapas da web seguem). Cada
// feição leva a camada e o nome nas propriedades, junto com os atributos dela.
// Uma feição por linha: o arquivo continua legível e comparável num diff.
import { antiHorario, fechar, horario } from "./coordenadas.ts";
import type { CamadaPronta, FeicaoPronta } from "./coordenadas.ts";
import type { XY } from "./tipos.ts";

/** 9 casas de grau ≈ 0,1 mm (a RFC pede não exagerar na precisão). */
const r9 = (v: number) => Math.round(v * 1e9) / 1e9;
const pos = (p: XY): number[] => [r9(p[0]), r9(p[1])];

function geometria(f: FeicaoPronta): Record<string, unknown> {
  if (f.tipo === "ponto") {
    const h = f.alt[0];
    return { type: "Point", coordinates: typeof h === "number" ? [...pos(f.geo[0]), Math.round(h * 1000) / 1000] : pos(f.geo[0]) };
  }
  if (f.tipo === "linha") return { type: "LineString", coordinates: f.geo.map(pos) };
  // arredonda ANTES de fechar: o último ponto sai idêntico ao primeiro
  const anel = (a: XY[]) => fechar(a.map((p) => pos(p) as XY));
  return { type: "Polygon", coordinates: [anel(antiHorario(f.geo)), ...f.furosGeo.map((h) => anel(horario(h)))] };
}

export function gerarGeoJsonArea(camadas: CamadaPronta[], nome: string): string {
  const feicoes = camadas.flatMap((c) => c.feicoes.map((f) => JSON.stringify({
    type: "Feature",
    properties: { camada: c.nome, nome: f.nome, ...f.props },
    geometry: geometria(f),
  })));
  return `{"type":"FeatureCollection","name":${JSON.stringify(nome)},"features":[\n${feicoes.join(",\n")}\n]}\n`;
}
