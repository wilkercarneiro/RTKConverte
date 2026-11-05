// Loteamento pronto sintético para os testes da importação (fuso 24S).
//
// Gleba de 120 × 80 m (o centro cai em metro redondo: as coordenadas do plano
// de cálculo ficam exatas e a área do lote sai igual à do arquivo):
//   • rua das Flores (12 m) atravessando a gleba de oeste a leste, y 28–40;
//   • avenida Brasil (12 m) subindo dela até a divisa norte, x 54–66;
//   • quadra A (x 0–54) e quadra B (x 66–120) acima da rua, 4 lotes de
//     13,5 × 40 m = 540 m² cada; a B numerada 5, 6, 7 e 9 (sem o 8);
//   • área verde embaixo da rua (120 × 28 m = 3.360 m²).
// Viário = 120 × 80 − 8 × 540 − 3.360 = 1.920 m².
import proj4 from "proj4";

export const E0 = 500000, N0 = 8600000;
const U = ([x, y]) => [E0 + x, N0 + y];

export const perimetroImp = {
  pts: [[0, 0], [120, 0], [120, 80], [0, 80]].map(U),
  altitudes: [100, 100.5, 101, 100.5],
  confrontantes: ["JOSÉ DA SILVA", "MARIA SOUZA", "ANTÔNIO LIMA", "PEDRO ALVES"],
  nomes: ["P1", "P2", "P3", "P4"],
};

const ret = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
export const LOTES = [
  ...[0, 1, 2, 3].map((i) => ({ quadra: "A", numero: i + 1, anel: ret(13.5 * i, 40, 13.5 * (i + 1), 80) })),
  ...[5, 6, 7, 9].map((n, i) => ({ quadra: "B", numero: n, anel: ret(66 + 13.5 * i, 40, 66 + 13.5 * (i + 1), 80) })),
];
export const QUADRAS = { A: ret(0, 40, 54, 80), B: ret(66, 40, 120, 80) };
export const VERDE = ret(0, 0, 120, 28);
export const AREA_LOTE = 540, AREA_VERDE = 3360, AREA_VIARIO = 1920;

// ---------------------------------------------------------------- DXF R2000 (LWPOLYLINE, TEXT, MTEXT, LINE)
function dxfDe({ comQuadras = true, camadaLote = "LOTES", deslocar = [0, 0], local = false, extra = [] } = {}) {
  const o = [];
  const g = (c, v) => o.push(String(c), String(v));
  const P = (p) => (local ? p : [U(p)[0] + deslocar[0], U(p)[1] + deslocar[1]]);
  const poli = (pts, camada, fechada = true) => {
    g(0, "LWPOLYLINE"); g(8, camada); g(90, pts.length); g(70, fechada ? 1 : 0);
    for (const p of pts.map(P)) { g(10, p[0].toFixed(3)); g(20, p[1].toFixed(3)); }
  };
  const texto = (p, t, camada, alt = 1.5, rot = 0) => {
    const q = P(p);
    g(0, "TEXT"); g(8, camada); g(10, q[0].toFixed(3)); g(20, q[1].toFixed(3)); g(40, alt); g(1, t);
    if (rot) g(50, rot);
    g(72, 1); g(73, 2); g(11, q[0].toFixed(3)); g(21, q[1].toFixed(3));
  };
  g(0, "SECTION"); g(2, "HEADER"); g(9, "$ACADVER"); g(1, "AC1015"); g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  poli(perimetroImp.pts.map(([e, n]) => [e - E0, n - N0]), "PERIMETRO");
  if (comQuadras) { poli(QUADRAS.A, "QUADRAS"); poli(QUADRAS.B, "QUADRAS"); }
  for (const l of LOTES) poli(l.anel, camadaLote);
  poli(VERDE, "AREA VERDE");
  // eixos (LINE) e nomes de rua deitados ao longo delas
  for (const [a, b] of [[[0, 34], [120, 34]], [[60, 40], [60, 80]]]) {
    const pa = P(a), pb = P(b);
    g(0, "LINE"); g(8, "EIXO_VIA"); g(10, pa[0]); g(20, pa[1]); g(11, pb[0]); g(21, pb[1]);
  }
  texto([30, 34], "RUA DAS FLORES (12,00 m)", "TEXTO_RUA", 2);
  texto([60, 62], "AVENIDA BRASIL", "TEXTO_RUA", 2, 90);
  // números dos lotes em formatos variados (e ruído: área e cota dentro do lote)
  const rotulos = { 1: "01", 2: "02", 3: "LOTE 3", 4: "L-04", 5: "LOTE 5", 6: "L-6", 7: "Q-B L-7", 9: "9" };
  for (const l of LOTES) {
    const c = [(l.anel[0][0] + l.anel[2][0]) / 2, (l.anel[0][1] + l.anel[2][1]) / 2];
    texto(c, rotulos[l.numero], "TEXTO_LOTE", 2);
    texto([c[0], c[1] - 4], "540,00 m²", "TEXTO_LOTE", 0.8);
    texto([c[0], 41], "13,50", "COTA", 0.6);
  }
  texto([27, 75], "QUADRA A", "TEXTO_QUADRA", 2.5);
  // MTEXT com formatação, no meio da quadra B
  const mq = P([93, 75]);
  g(0, "MTEXT"); g(8, "TEXTO_QUADRA"); g(10, mq[0]); g(20, mq[1]); g(40, 2.5); g(71, 5); g(1, "{\\fArial|b1;QUADRA B}");
  texto([60, 14], "ÁREA VERDE 01 - 3.360,00 m²", "AREA VERDE", 2);
  for (const e of extra) e(poli, texto);
  g(0, "ENDSEC"); g(0, "EOF");
  return o.join("\r\n") + "\r\n";
}

export const dxfSintetico = (op) => new TextEncoder().encode(dxfDe(op));

// ---------------------------------------------------------------- KML (lon/lat)
// os mesmos sistemas do servidor (supabase/functions/_shared/geo.ts)
const utm24 = "+proj=utm +zone=24 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs";
const geo = "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs";
const ll = (p) => proj4(utm24, geo, U(p));
const coords = (anel) => [...anel, anel[0]].map((p) => ll(p).map((x) => x.toFixed(9)).join(",") + ",0").join(" ");

export function kmlSintetico() {
  const pm = (nome, anel, estilo = "") => `<Placemark><name>${nome}</name>${estilo}<Polygon><outerBoundaryIs><LinearRing><coordinates>${coords(anel)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
  const linha = (nome, pts) => `<Placemark><name>${nome}</name><LineString><coordinates>${pts.map((p) => ll(p).map((x) => x.toFixed(9)).join(",") + ",0").join(" ")}</coordinates></LineString></Placemark>`;
  const doc = [
    '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Loteamento Sintético</name>',
    "<Folder><name>Quadra A</name>", ...LOTES.filter((l) => l.quadra === "A").map((l) => pm(`Lote ${String(l.numero).padStart(2, "0")}`, l.anel)), "</Folder>",
    "<Folder><name>Quadra B</name>", ...LOTES.filter((l) => l.quadra === "B").map((l) => pm(`Lote ${l.numero}`, l.anel)), "</Folder>",
    "<Folder><name>Áreas públicas</name>", pm("Área Verde 01", VERDE), "</Folder>",
    "<Folder><name>Ruas</name>", linha("Rua das Flores", [[0, 34], [120, 34]]), linha("Avenida Brasil", [[60, 40], [60, 80]]), "</Folder>",
    "</Document></kml>",
  ];
  return new TextEncoder().encode(doc.join("\n"));
}

// ---------------------------------------------------------------- GeoJSON (lon/lat ou UTM com crs)
export function geojsonSintetico({ utm = false } = {}) {
  const C = (p) => (utm ? U(p) : ll(p));
  const pol = (anel) => ({ type: "Polygon", coordinates: [[...anel, anel[0]].map(C)] });
  const fc = {
    type: "FeatureCollection",
    ...(utm ? { crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::31984" } } } : {}),
    features: [
      ...LOTES.map((l) => ({ type: "Feature", properties: { tipo: "lote", quadra: l.quadra, lote: l.numero }, geometry: pol(l.anel) })),
      { type: "Feature", properties: { tipo: "área verde", nome: "Área Verde 01" }, geometry: pol(VERDE) },
      { type: "Feature", properties: { tipo: "eixo", nome: "Rua das Flores" }, geometry: { type: "LineString", coordinates: [[0, 34], [120, 34]].map(C) } },
      { type: "Feature", properties: { tipo: "eixo", nome: "Avenida Brasil" }, geometry: { type: "LineString", coordinates: [[60, 40], [60, 80]].map(C) } },
    ],
  };
  return new TextEncoder().encode(JSON.stringify(fc));
}
