// Exportação das curvas de nível: DXF (CAD) e KML (Google Earth). Feita no
// navegador: o relevo de fundo e o ajuste só existem no cliente (a função
// `entregar` do servidor não tem o modelo digital de elevação).
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import type { Curva, Pt } from "./curvas.ts";
import { caixaDe, pontosDeRotulo } from "./curvas.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

export const NOTA_RELEVO =
  "Curvas de nivel: cotas dos vertices pelo levantamento GNSS; miolo do imovel pelo modelo digital de elevacao publico (~30 m), ajustado aos vertices. Indicativo - nao e levantamento planialtimetrico.";

export interface DadosExportacao {
  curvas: Curva[];
  intervalo: number;
  /** anéis do imóvel (UTM) */
  aneis: Pt[][];
  /** marcos com código, para referência no desenho */
  marcos?: { texto: string; p: Pt; h?: number }[];
  nome: string;
  fuso: number;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const fmtCota = (z: number, iv: number) => (iv < 1 ? z.toFixed(1) : String(Math.round(z)));

export const CAMADAS_CURVAS: [string, number][] = [
  ["CURVAS_MESTRAS", 34], ["CURVAS_INTERMEDIARIAS", 252], ["PERIMETRO", 7], ["MARCOS", 1], ["NOTA_RELEVO", 8],
];

/**
 * DXF R12 (AC1009): cada curva é uma POLYLINE 2D com a cota como elevação
 * (grupo 30 da POLYLINE e dos VERTEX); as mestras levam a cota escrita (TEXT,
 * na mesma camada e na mesma elevação). Coordenadas UTM do fuso do serviço.
 */
export function curvasParaDxf(d: DadosExportacao): string {
  const o: string[] = [];
  const g = (c: number, v: string | number) => { o.push(String(c), typeof v === "number" ? v.toFixed(3) : v); };
  const todos = d.aneis.flat();
  const bb = caixaDe(todos.length ? todos : d.curvas.flatMap((c) => c.pts));
  const lado = Math.max(1, bb.max[0] - bb.min[0], bb.max[1] - bb.min[1]);
  const altTexto = Math.max(0.8, Math.min(12, lado / 300));
  g(999, semAcento(`${d.nome} - curvas de nivel de ${String(d.intervalo).replace(".", ",")} m - UTM fuso ${d.fuso}`));
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$EXTMIN"); g(10, bb.min[0]); g(20, bb.min[1]); g(30, 0);
  g(9, "$EXTMAX"); g(10, bb.max[0]); g(20, bb.max[1]); g(30, 0);
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, "1");
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, "0"); g(3, "Solid line"); g(72, "65"); g(73, "0"); g(40, 0);
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, String(CAMADAS_CURVAS.length));
  for (const [nome, cor] of CAMADAS_CURVAS) { g(0, "LAYER"); g(2, nome); g(70, "0"); g(62, String(cor)); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  const poli = (pts: Pt[], camada: string, fechada: boolean, z: number) => {
    if (pts.length < 2) return;
    g(0, "POLYLINE"); g(8, camada); g(66, "1"); g(70, fechada ? "1" : "0"); g(10, 0); g(20, 0); g(30, z);
    for (const p of pts) { g(0, "VERTEX"); g(8, camada); g(10, p[0]); g(20, p[1]); g(30, z); }
    g(0, "SEQEND"); g(8, camada);
  };
  const texto = (p: Pt, t: string, alt: number, camada: string, z = 0, rot = 0) => {
    g(0, "TEXT"); g(8, camada); g(10, p[0]); g(20, p[1]); g(30, z); g(40, alt); g(1, semAcento(t));
    if (rot) g(50, rot);
    g(72, "1"); g(73, "2"); g(11, p[0]); g(21, p[1]); g(31, z);
  };
  for (const c of d.curvas) {
    const fechada = c.fechada;
    const pts = fechada && c.pts.length > 2 && c.pts[0][0] === c.pts[c.pts.length - 1][0] && c.pts[0][1] === c.pts[c.pts.length - 1][1] ? c.pts.slice(0, -1) : c.pts;
    poli(pts, c.mestra ? "CURVAS_MESTRAS" : "CURVAS_INTERMEDIARIAS", fechada, c.cota);
    if (c.mestra) for (const r of pontosDeRotulo(c.pts, altTexto * 60)) texto(r.p, fmtCota(c.cota, d.intervalo), altTexto, "CURVAS_MESTRAS", c.cota, r.ang);
  }
  for (const a of d.aneis) poli(a, "PERIMETRO", true, 0);
  for (const m of d.marcos ?? []) {
    g(0, "POINT"); g(8, "MARCOS"); g(10, m.p[0]); g(20, m.p[1]); g(30, m.h ?? 0);
    texto([m.p[0] + altTexto * 0.6, m.p[1] + altTexto * 0.6], m.texto, altTexto * 0.7, "MARCOS", m.h ?? 0);
  }
  texto([bb.min[0], bb.min[1] - altTexto * 3], NOTA_RELEVO, altTexto * 0.7, "NOTA_RELEVO");
  g(0, "ENDSEC"); g(0, "EOF");
  return o.join("\r\n") + "\r\n";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * KML: pastas "Curvas mestras" e "Curvas intermediárias", cada curva um
 * LineString com a cota no nome e na coordenada (presa ao chão: o Google Earth
 * usa o próprio relevo e altitude ortométrica — a cota vai como informação).
 */
export function curvasParaKml(d: DadosExportacao): string {
  const ud = utmDef(d.fuso);
  const ll = (p: Pt, z = 0) => { const [lon, lat] = proj(ud, GEO_DEF, p); return `${lon.toFixed(8)},${lat.toFixed(8)},${z.toFixed(2)}`; };
  const linha = (pts: Pt[], z: number) => `<LineString><tessellate>1</tessellate><altitudeMode>clampToGround</altitudeMode><coordinates>${pts.map((p) => ll(p, z)).join(" ")}</coordinates></LineString>`;
  const iv = String(d.intervalo).replace(".", ",");
  const p: string[] = [];
  p.push(`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(`${d.nome} — curvas de nível (${iv} m)`)}</name>`);
  p.push(`<description>${esc("Cotas dos vértices pelo levantamento GNSS; miolo do imóvel pelo modelo digital de elevação público (~30 m), ajustado aos vértices. Indicativo — não é levantamento planialtimétrico.")}</description>`);
  p.push(`<Style id="mestra"><LineStyle><color>ff0b4c8a</color><width>2.4</width></LineStyle></Style>`,
    `<Style id="intermediaria"><LineStyle><color>b02f7fc8</color><width>1</width></LineStyle></Style>`,
    `<Style id="perimetro"><LineStyle><color>ff00d2ff</color><width>2.5</width></LineStyle><PolyStyle><fill>0</fill></PolyStyle></Style>`);
  p.push(`<Folder><name>Perímetro</name>`);
  for (const a of d.aneis) p.push(`<Placemark><name>Perímetro</name><styleUrl>#perimetro</styleUrl><LineString><tessellate>1</tessellate><coordinates>${[...a, a[0]].map((q) => ll(q)).join(" ")}</coordinates></LineString></Placemark>`);
  p.push(`</Folder>`);
  for (const [mestra, nome] of [[true, "Curvas mestras"], [false, "Curvas intermediárias"]] as const) {
    p.push(`<Folder><name>${nome}</name>`);
    for (const c of d.curvas) {
      if (c.mestra !== mestra) continue;
      p.push(`<Placemark><name>${fmtCota(c.cota, d.intervalo).replace(".", ",")} m</name><styleUrl>#${mestra ? "mestra" : "intermediaria"}</styleUrl><ExtendedData><Data name="cota"><value>${c.cota}</value></Data></ExtendedData>${linha(c.pts, c.cota)}</Placemark>`);
    }
    p.push(`</Folder>`);
  }
  p.push(`</Document></kml>`);
  return p.join("\n");
}
