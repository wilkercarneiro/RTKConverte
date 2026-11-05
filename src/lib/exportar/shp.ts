// Shapefile em zip para o QGIS/ArcGIS: um conjunto .shp/.shx/.dbf/.prj/.cpg
// por tipo de geometria (o formato só guarda um tipo por arquivo) — POLIGONOS,
// LINHAS e PONTOS, quando houver. Coordenadas em grau, SIRGAS 2000: o mesmo
// gravador e o mesmo PRJ dos shapefiles do SICAR (car/shapefile.ts). A tabela
// traz a camada, o nome e os atributos de cada feição; o ponto leva também o
// E/N do fuso e a altitude, que o topógrafo procura na tabela de atributos.
import JSZip from "jszip";
import { gravarShapefileLinhas, gravarShapefilePoligonos, gravarShapefilePontos, juntarNoZip } from "../car/shapefile.ts";
import type { Atributos } from "../car/shapefile.ts";
import type { CamadaPronta, FeicaoPronta } from "./coordenadas.ts";

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export async function gerarShpArea(camadas: CamadaPronta[], base: string, fuso: number, hoje = new Date()): Promise<Uint8Array> {
  const de = (tipo: FeicaoPronta["tipo"]) => camadas.flatMap((c) => c.feicoes.filter((f) => f.tipo === tipo).map((f) => ({ c, f })));
  const atributos = (camada: string, f: FeicaoPronta, extra: Atributos = {}): Atributos => ({ camada, nome: f.nome, ...f.props, ...extra });
  const zip = new JSZip();

  const pols = de("poligono");
  if (pols.length) {
    juntarNoZip(zip, `${base}_POLIGONOS`, gravarShapefilePoligonos(pols.map(({ c, f }) => ({
      poligonos: [{ ext: f.geo, furos: f.furosGeo }], atributos: atributos(c.nome, f),
    })), hoje));
  }
  const linhas = de("linha");
  if (linhas.length) {
    juntarNoZip(zip, `${base}_LINHAS`, gravarShapefileLinhas(linhas.map(({ c, f }) => ({
      trechos: [f.geo], atributos: atributos(c.nome, f),
    })), hoje));
  }
  const pontos = de("ponto");
  if (pontos.length) {
    juntarNoZip(zip, `${base}_PONTOS`, gravarShapefilePontos(pontos.map(({ c, f }) => ({
      ponto: f.geo[0],
      atributos: atributos(c.nome, f, {
        e_utm: r3(f.utm[0][0]), n_utm: r3(f.utm[0][1]), fuso: `${fuso}S`,
        ...(typeof f.alt[0] === "number" ? { altitude: r3(f.alt[0]) } : {}),
      }),
    })), hoje));
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
