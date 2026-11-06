// Entrada da terraplanagem no navegador: o arquivo de pontos (leitor próprio,
// e o leitor universal do sistema para os formatos especiais — GSI, XML da
// coletora, DXF…), o KML/KMZ da plataforma e o relevo público.
import JSZip from "jszip";
import proj4lib from "proj4";
import { decodificar, separarLinhas } from "../../../supabase/functions/_shared/leitor/abertura.ts";
import { lerLinhas } from "../../../supabase/functions/_shared/leitor/index.ts";
import type { Proj4 } from "../../../supabase/functions/_shared/geo.ts";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import { lerKml } from "../car/kml.ts";
import { buscarTerreno } from "../loteamento/terreno.ts";
import { fusoDoLon } from "../restricoes.ts";
import type { Pt } from "./geometria.ts";
import { antiHorario, caixa, dentro, limparAnel, maisPertoNaBorda, seCruza } from "./geometria.ts";
import { ERRO_GRAVATA } from "./calculo.ts";
import type { LeituraPontos, PontoCota } from "./pontos.ts";
import { lerPontos } from "./pontos.ts";

const proj4: Proj4 = (de, para, c) => (proj4lib as unknown as Proj4)(de, para, c);

export const ACEITOS_PONTOS = ".txt,.csv,.tsv,.dat,.xyz,.pnt,.gsi,.xml,.dxf,.geojson,.json";

/** Lê o arquivo do levantamento. Nunca lança: o erro vem nos avisos, com pontos vazios. */
export async function lerArquivoDePontos(f: File): Promise<LeituraPontos> {
  if (f.size > 25 * 1024 * 1024) return { pontos: [], colunas: "", fuso: null, ignoradas: [], avisos: ["O arquivo passa de 25 MB. Exporte só os pontos do levantamento (nome, E, N, cota)."] };
  const { texto } = decodificar(new Uint8Array(await f.arrayBuffer()));
  const proprio = lerPontos(texto);
  if (proprio.pontos.length >= 3) return proprio;
  // formatos especiais: o leitor universal do sistema
  try {
    const l = lerLinhas(separarLinhas(texto), { proj4, ordem: "arquivo" });
    const pts: PontoCota[] = (l?.pontos ?? [])
      .filter((p) => p.h != null && Number.isFinite(p.h) && p.h !== 0)
      .map((p) => ({ nome: p.nome || String(p.idx + 1), e: p.e, n: p.n, z: p.h as number, ...(p.rotulo ? { descricao: p.rotulo } : {}) }));
    if (pts.length >= 3) {
      const semCota = (l?.pontos.length ?? 0) - pts.length;
      return {
        pontos: pts, colunas: "nome · E · N · cota", fuso: null, ignoradas: [],
        avisos: semCota > 0 ? [`${semCota} ponto(s) sem cota ficaram de fora.`] : [],
      };
    }
    if ((l?.pontos.length ?? 0) >= 3) {
      return { ...proprio, pontos: [], avisos: ["O arquivo tem coordenadas, mas não tem a cota (altitude) dos pontos. A terraplanagem precisa de nome, E, N e cota."] };
    }
  } catch { /* fica a leitura própria */ }
  return proprio;
}

async function textoKml(f: File): Promise<string> {
  if (!/\.kmz$/i.test(f.name)) return f.text();
  const zip = await JSZip.loadAsync(await f.arrayBuffer());
  const kml = Object.values(zip.files).find((x) => !x.dir && /\.kml$/i.test(x.name));
  if (!kml) throw new Error("O KMZ não tem nenhum arquivo .kml dentro.");
  return kml.async("string");
}

export interface PoligonoLido {
  utm: Pt[]; fuso: number; nome: string | null; lonlat: [number, number][];
  /** o KML tinha furo (anel interno): a plataforma usa só o contorno de fora */
  furoIgnorado: boolean;
}

/** Polígono de um KML/KMZ, em UTM no fuso dado (ou no do próprio KML). */
export async function lerPoligonoKml(f: File, fuso: number | null): Promise<PoligonoLido> {
  return poligonoDoKml(await textoKml(f), fuso);
}

/** O mesmo, a partir do texto do KML (testável sem File). */
export function poligonoDoKml(texto: string, fuso: number | null): PoligonoLido {
  const k = lerKml(texto);
  if (k.perimetro.length < 3) throw new Error("O KML não tem um polígono (área). Desenhe a plataforma como polígono no Google Earth.");
  const lonMed = k.perimetro.reduce((s, p) => s + p[0], 0) / k.perimetro.length;
  const fz = fuso ?? fusoDoLon(lonMed);
  const ud = utmDef(fz);
  const utm = antiHorario(k.perimetro.map((p) => proj4(GEO_DEF, ud, p) as Pt));
  if (seCruza(limparAnel(utm, 0.001))) throw new Error(ERRO_GRAVATA);
  return { utm, fuso: fz, nome: k.nome, lonlat: k.perimetro, furoIgnorado: /<innerBoundaryIs[\s>]/i.test(texto) };
}

/**
 * Coordenada digitada ou link do Google Maps → lon/lat. Aceita "-12,9714 -38,5014",
 * "-12.9714, -38.5014", ".../@-12.97,-38.50,17z" e "?q=-12.97,-38.50".
 */
export function lerCoordenada(texto: string): [number, number] | null {
  const t = texto.trim();
  const link = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(t) ?? /[?&](?:q|ll|query)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/.exec(t) ?? /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(t);
  let lat: number, lon: number;
  if (link) { lat = Number(link[1]); lon = Number(link[2]); }
  else {
    const m = /^(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/.exec(t);
    if (!m) return null;
    lat = Number(m[1].replace(",", ".")); lon = Number(m[2].replace(",", "."));
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // no Brasil a latitude vai de +5 a −34 e a longitude de −28 a −74: invertidas, desinverte
  if (lat < -34 && lon >= -34 && lon <= 6) [lat, lon] = [lon, lat];
  return [lon, lat];
}

export interface TerrenoPublico { pontos: PontoCota[]; fuso: number; plataforma: Pt[] }

/**
 * Pontos do relevo público (modelo digital de elevação de ~30 m, o mesmo do
 * loteamento) em volta da área: a plataforma e uma margem para o talude.
 * Sem rede, lança. É estimativa — a tela diz isso.
 */
export async function terrenoPublico(plataformaUtm: Pt[], fuso: number): Promise<TerrenoPublico> {
  const c = caixa(plataformaUtm);
  const lado = Math.max(c.max[0] - c.min[0], c.max[1] - c.min[1]);
  const margem = Math.max(25, lado * 0.35);
  const cob: Pt[] = [[c.min[0] - margem, c.min[1] - margem], [c.max[0] + margem, c.min[1] - margem], [c.max[0] + margem, c.max[1] + margem], [c.min[0] - margem, c.max[1] + margem]];
  const g = await buscarTerreno(cob, cob.map(() => NaN), fuso);
  if (!g || g.fonte !== "dem") throw new Error("Não deu para baixar o relevo público agora (sem internet?). Envie o arquivo do levantamento ou tente de novo.");
  const pontos: PontoCota[] = [];
  let k = 0;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const p: Pt = [g.e0 + i * g.passo, g.n0 + j * g.passo];
    if (!dentro(p, plataformaUtm) && maisPertoNaBorda(p, plataformaUtm).d > margem) continue;
    const z = g.h[j * g.nx + i];
    if (Number.isFinite(z)) pontos.push({ nome: `R${++k}`, e: p[0], n: p[1], z });
  }
  if (pontos.length < 3) throw new Error("O relevo público não cobriu esta área.");
  return { pontos, fuso, plataforma: plataformaUtm };
}

/** Quadrado de `lado` m em volta de uma coordenada (lon/lat), em UTM. */
export function quadradoEm(lonlat: [number, number], lado = 60): { utm: Pt[]; fuso: number } {
  const fuso = fusoDoLon(lonlat[0]);
  const [e, n] = proj4(GEO_DEF, utmDef(fuso), lonlat);
  const h = lado / 2;
  return { fuso, utm: [[e - h, n - h], [e + h, n - h], [e + h, n + h], [e - h, n + h]] };
}

export function paraLonLat(p: Pt, fuso: number): [number, number] {
  return proj4(utmDef(fuso), GEO_DEF, p);
}
