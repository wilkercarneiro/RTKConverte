// Pacote CAD (.zip): o DXF + o .prj do SIRGAS 2000 / UTM do fuso (projetado,
// não o geográfico do shapefile) + um LEIAME.txt curto.
//
// O DXF não guarda sistema de coordenadas: quem abre não tem como saber em
// que fuso estão aqueles números. O .prj de mesmo nome resolve no ArcGIS (que
// lê o .prj ao lado do desenho) e serve de referência no QGIS e no AutoCAD
// Map/Civil 3D; o LEIAME diz em português o que é cada coisa e como abrir.
import JSZip from "jszip";
import { epsgForZone, mcForZone, ZONAS_BR } from "../../../supabase/functions/_shared/geo.ts";
import { desenharDxf } from "./dxf.ts";
import type { CamadaPronta } from "./coordenadas.ts";

/** WKT (formato ESRI, o do .prj) do SIRGAS 2000 / UTM zona <fuso>S. */
export function prjUtmSirgas2000(fuso: number): string {
  return `PROJCS["SIRGAS_2000_UTM_Zone_${fuso}S",GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",`
    + `SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],`
    + `PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",10000000.0],`
    + `PARAMETER["Central_Meridian",${mcForZone(fuso).toFixed(1)}],PARAMETER["Scale_Factor",0.9996],`
    + `PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]`;
}

function dataBr(d: Date): string {
  try {
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Bahia" });
  } catch {
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
}

/** O texto do LEIAME (CRLF, para o Bloco de Notas de qualquer Windows). */
export function leiameCad(op: { titulo: string; arquivo: string; fuso: number; hoje: Date; camadas: string[] }): string {
  const epsg = ZONAS_BR.includes(op.fuso) ? ` (EPSG:${epsgForZone(op.fuso)})` : "";
  const src = `SIRGAS 2000 / UTM zona ${op.fuso}S${epsg}`;
  return [
    "VERTCES - PACOTE CAD",
    "",
    `Serviço: ${op.titulo}`,
    `Gerado em: ${dataBr(op.hoje)}`,
    "",
    "ARQUIVOS",
    `  ${op.arquivo}.dxf  desenho (DXF R12 ASCII, abre em qualquer CAD)`,
    `  ${op.arquivo}.prj  sistema de coordenadas do desenho`,
    "",
    "SISTEMA DE COORDENADAS",
    `  ${src}, meridiano central ${mcForZone(op.fuso)}°`,
    "  Unidade: metro. X = Este (E), Y = Norte (N); a altitude vai no Z dos pontos.",
    "",
    "CAMADAS",
    ...op.camadas.map((c) => `  ${c}`),
    "",
    "COMO ABRIR",
    "  AutoCAD: Abrir > Tipo de arquivo DXF (*.dxf). No AutoCAD Map 3D / Civil 3D,",
    `    atribua o sistema ${src} ao desenho para georreferenciar.`,
    "  QGIS: arraste o .dxf para o mapa e defina o SRC da camada como",
    `    ${src}.`,
    "  ArcGIS: deixe o .prj na mesma pasta do .dxf, com o mesmo nome.",
    "",
  ].join("\r\n");
}

export async function gerarPacoteCad(camadas: CamadaPronta[], op: { base: string; titulo: string; fuso: number; hoje?: Date }): Promise<Uint8Array> {
  const hoje = op.hoje ?? new Date();
  const desenho = desenharDxf(camadas);
  const arquivo = `${op.base}_SIRGAS2000_UTM${op.fuso}S`;
  const zip = new JSZip();
  zip.file(`${arquivo}.dxf`, desenho.texto);
  zip.file(`${arquivo}.prj`, prjUtmSirgas2000(op.fuso));
  zip.file("LEIAME.txt", "﻿" + leiameCad({ titulo: op.titulo, arquivo, fuso: op.fuso, hoje, camadas: desenho.camadas }));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
