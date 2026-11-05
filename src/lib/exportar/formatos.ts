// Formatos da "Exportar a área". Mora sozinho, sem dependência nenhuma, porque
// a tela (o menu do botão) e o servidor (função `entregar`, que valida o pedido)
// leem a mesma lista — e a tela não precisa carregar proj4 nem JSZip para isso.

export type FormatoArea = "kml" | "kmz" | "dxf" | "cad" | "gpx" | "shp" | "geojson" | "csv" | "txt";

export interface DefFormatoArea {
  id: FormatoArea;
  /** como aparece no menu */
  rotulo: string;
  /** para que serve, em poucas palavras */
  serve: string;
  /** extensão do arquivo baixado */
  ext: string;
  /** Content-Type da resposta */
  tipo: string;
  /** coordenadas em UTM (o nome do arquivo leva o fuso) */
  utm: boolean;
}

/** Na ordem do menu: os mais pedidos primeiro. */
export const FORMATOS_AREA: DefFormatoArea[] = [
  { id: "kml", rotulo: "KML", serve: "Google Earth", ext: "kml", tipo: "application/vnd.google-earth.kml+xml", utm: false },
  { id: "dxf", rotulo: "DXF", serve: "AutoCAD / topografia", ext: "dxf", tipo: "application/dxf", utm: true },
  // o DXF não diz o fuso: o pacote leva o .prj do UTM e um LEIAME junto
  { id: "cad", rotulo: "Pacote CAD (.zip)", serve: "DXF + PRJ do fuso + LEIAME", ext: "zip", tipo: "application/zip", utm: true },
  { id: "gpx", rotulo: "GPX", serve: "GPS de navegação (Garmin)", ext: "gpx", tipo: "application/gpx+xml", utm: false },
  { id: "shp", rotulo: "SHP", serve: "QGIS / ArcGIS", ext: "zip", tipo: "application/zip", utm: false },
  { id: "kmz", rotulo: "KMZ", serve: "Google Earth, compactado", ext: "kmz", tipo: "application/vnd.google-earth.kmz", utm: false },
  { id: "geojson", rotulo: "GeoJSON", serve: "QGIS e mapas na web", ext: "geojson", tipo: "application/geo+json", utm: false },
  { id: "csv", rotulo: "CSV de pontos", serve: "planilha (Excel)", ext: "csv", tipo: "text/csv;charset=utf-8", utm: true },
  { id: "txt", rotulo: "TXT para a coletora", serve: "P,E,N,Z,D", ext: "txt", tipo: "text/plain;charset=utf-8", utm: true },
];

export const ehFormatoArea = (v: unknown): v is FormatoArea => FORMATOS_AREA.some((f) => f.id === v);
