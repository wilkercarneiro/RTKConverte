// "Exportar a área": a geometria do serviço em KML, KMZ, DXF (solto ou no
// pacote CAD, com o .prj do fuso), GPX, Shapefile, GeoJSON, CSV de pontos ou
// TXT para a coletora.
//
// Biblioteca pura (sem DOM): roda no navegador, nos testes do node e no pacote
// da função `entregar`, que é quem de fato gera — a partir do que ela lê do
// banco, nunca de geometria vinda da tela (auditoria de 04/11/2026). As
// camadas saem da montagem de cada modalidade (geo.ts, loteamento.ts, car.ts).
import { FORMATOS_AREA, ehFormatoArea } from "./formatos.ts";
import type { FormatoArea } from "./formatos.ts";
import { nomeLimpo, pontosDasCamadas, prepararCamadas } from "./coordenadas.ts";
import { gerarKmlArea, gerarKmzArea } from "./kml.ts";
import { gerarGpxArea } from "./gpx.ts";
import { gerarDxfArea } from "./dxf.ts";
import { gerarGeoJsonArea } from "./geojson.ts";
import { gerarShpArea } from "./shp.ts";
import { gerarCsvPontos, gerarTxtColetora } from "./pontos.ts";
import { gerarPacoteCad } from "./cad.ts";
import type { Camada } from "./tipos.ts";

export type { Camada, Feicao, XY } from "./tipos.ts";
export type { FormatoArea } from "./formatos.ts";
export { FORMATOS_AREA, ehFormatoArea } from "./formatos.ts";

export interface ArquivoArea { dados: Uint8Array; nome: string; tipo: string }

export interface OpcoesExportacao {
  /** fuso UTM (SIRGAS 2000, hemisfério sul) das coordenadas `utm` e dos formatos em UTM */
  fuso: number;
  /** nome do imóvel/loteamento: vira o nome do arquivo e o título do documento */
  nome: string;
  /** data gravada no DBF do shapefile (padrão: hoje) */
  hoje?: Date;
}

/**
 * Nome do arquivo: "FAZENDA_X_SIRGAS2000_UTM24S.dxf" nos formatos em UTM;
 * KML, KMZ, GPX e GeoJSON são sempre lon/lat e vão sem o sufixo. Os dois zip
 * dizem o que levam: "FAZENDA_X_SHP_SIRGAS2000.zip" (shapefile em grau) e
 * "FAZENDA_X_CAD_SIRGAS2000_UTM24S.zip" (o pacote CAD).
 */
export function nomeDoArquivo(nome: string, formato: FormatoArea, fuso: number): string {
  const base = nomeLimpo(nome);
  const def = FORMATOS_AREA.find((f) => f.id === formato)!;
  if (formato === "shp") return `${base}_SHP_SIRGAS2000.zip`;
  if (formato === "cad") return `${base}_CAD_SIRGAS2000_UTM${fuso}S.zip`;
  return def.utm ? `${base}_SIRGAS2000_UTM${fuso}S.${def.ext}` : `${base}.${def.ext}`;
}

const texto = (s: string) => new TextEncoder().encode(s);

export async function exportarArea(camadas: Camada[], formato: FormatoArea, op: OpcoesExportacao): Promise<ArquivoArea> {
  if (!ehFormatoArea(formato)) throw new Error(`Formato de exportação desconhecido: ${String(formato)}.`);
  const fuso = Math.round(Number(op.fuso));
  if (!Number.isFinite(fuso) || fuso < 1 || fuso > 60) throw new Error("Fuso UTM inválido para a exportação.");
  const prontas = prepararCamadas(camadas, fuso);
  if (!prontas.length) throw new Error("Não há geometria para exportar.");
  const titulo = String(op.nome ?? "").trim() || "Área";
  const nome = nomeDoArquivo(titulo, formato, fuso);
  const tipo = FORMATOS_AREA.find((f) => f.id === formato)!.tipo;
  const com = (dados: Uint8Array): ArquivoArea => ({ dados, nome, tipo });
  switch (formato) {
    case "kml": return com(texto(gerarKmlArea(prontas, titulo)));
    case "kmz": return com(await gerarKmzArea(prontas, titulo));
    case "gpx": return com(texto(gerarGpxArea(prontas, titulo)));
    case "dxf": return com(texto(gerarDxfArea(prontas)));
    case "cad": return com(await gerarPacoteCad(prontas, { base: nomeLimpo(titulo), titulo, fuso, hoje: op.hoje }));
    case "geojson": return com(texto(gerarGeoJsonArea(prontas, titulo)));
    case "shp": return com(await gerarShpArea(prontas, nomeLimpo(titulo), fuso, op.hoje));
    case "csv":
    case "txt": {
      const pontos = pontosDasCamadas(prontas);
      if (!pontos.length) throw new Error("Não há pontos para exportar.");
      return com(texto(formato === "csv" ? gerarCsvPontos(pontos) : gerarTxtColetora(pontos)));
    }
  }
}
