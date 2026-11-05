// Coordenadas da "Exportar a área": UTM ↔ lon/lat (SIRGAS 2000, hemisfério sul,
// as MESMAS definições do motor geodésico — _shared/geo.ts) e a preparação das
// camadas: cada feição sai daqui com os dois sistemas preenchidos, anel aberto,
// ponto inválido fora. Os geradores não convertem nada: só escrevem.
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import type { Camada, Feicao, Valor, XY } from "./tipos.ts";

interface Conversor { forward: (p: number[]) => number[]; inverse: (p: number[]) => number[] }
const criar = proj4mod as unknown as (de: string, para: string) => Conversor;

// um conversor por fuso: montar a projeção a cada ponto custava caro no loteamento grande
const cache = new Map<number, Conversor>();
function conversor(fuso: number): Conversor {
  let c = cache.get(fuso);
  if (!c) { c = criar(utmDef(fuso), GEO_DEF); cache.set(fuso, c); }
  return c;
}

export const utmParaGeo = (p: XY, fuso: number): XY => {
  const [lon, lat] = conversor(fuso).forward([p[0], p[1]]);
  return [lon, lat];
};
export const geoParaUtm = (p: XY, fuso: number): XY => {
  const [e, n] = conversor(fuso).inverse([p[0], p[1]]);
  return [e, n];
};

/** Fuso UTM do meio do imóvel (centro da caixa em lon/lat): o CAR não guarda fuso. */
export function fusoDoMeio(geo: XY[]): number {
  let min = Infinity, max = -Infinity;
  for (const [lon] of geo) if (Number.isFinite(lon)) { if (lon < min) min = lon; if (lon > max) max = lon; }
  if (min > max) return 24;
  const meio = (min + max) / 2;
  return Math.min(60, Math.max(1, Math.floor((meio + 180) / 6) + 1));
}

/** Área com sinal (shoelace): > 0 = anti-horário (x para leste, y para norte). */
export function areaAssinada(anel: XY[]): number {
  let s = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const antiHorario = (anel: XY[]): XY[] => (areaAssinada(anel) >= 0 ? anel : [...anel].reverse());
export const horario = (anel: XY[]): XY[] => (areaAssinada(anel) <= 0 ? anel : [...anel].reverse());
export const fechar = (anel: XY[]): XY[] => (anel.length ? [...anel, anel[0]] : anel);

// ---------------------------------------------------------------------------
// Preparação
// ---------------------------------------------------------------------------

export interface FeicaoPronta {
  nome: string;
  tipo: Feicao["tipo"];
  utm: XY[];
  geo: XY[];
  furosUtm: XY[][];
  furosGeo: XY[][];
  alt: (number | null)[];
  props: Record<string, Valor>;
  /** um por lado do polígono (lado i: ponto i → i+1); vazio fora do polígono */
  confrontantes: (string | null)[];
}

export interface CamadaPronta {
  nome: string;
  cor: string;
  feicoes: FeicaoPronta[];
  /** DXF: azimute e distância de cada lado */
  segmentos: boolean;
  /** DXF: altura relativa do rótulo de cada feição (0 = sem rótulo) */
  rotulos: number;
}

/** Cores de reserva para camada sem cor (amarelo, vermelho, azul, verde, laranja, roxo). */
const PALETA = ["#F5C542", "#E53935", "#1E88E5", "#43A047", "#FB8C00", "#8E24AA"];

const finito = (p: XY | undefined): p is XY => !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]);
/** Mesmo ponto: 1e-6 m em UTM, 1e-11° em grau — só o fechamento repetido do anel. */
const mesmo = (a: XY, b: XY) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/** Os dois sistemas de um anel/linha, sem ponto inválido e (no polígono) sem repetir o 1º no fim. */
function doisSistemas(utm: XY[] | undefined, geo: XY[] | undefined, alt: (number | null)[] | undefined, fuso: number, anel: boolean) {
  const base = utm?.length ? "utm" : geo?.length ? "geo" : null;
  if (!base) return null;
  const orig = (base === "utm" ? utm : geo)!;
  const outro = base === "utm" ? geo : utm;
  const usarOutro = !!outro && outro.length === orig.length;
  let pts: { u: XY; g: XY; h: number | null; i: number }[] = [];
  orig.forEach((p, i) => {
    if (!finito(p)) return;
    const o = usarOutro ? outro![i] : undefined;
    const u = base === "utm" ? p : finito(o) ? o : geoParaUtm(p, fuso);
    const g = base === "geo" ? p : finito(o) ? o : utmParaGeo(p, fuso);
    const h = alt?.[i];
    pts.push({ u: [u[0], u[1]], g: [g[0], g[1]], h: typeof h === "number" && Number.isFinite(h) ? h : null, i });
  });
  let tamanho = orig.length;
  if (anel && pts.length > 1 && mesmo(pts[0].u, pts[pts.length - 1].u)) {
    if (pts[pts.length - 1].i === orig.length - 1) tamanho--; // o fechamento repetido não é lado
    pts = pts.slice(0, -1);
  }
  return { utm: pts.map((p) => p.u), geo: pts.map((p) => p.g), alt: pts.map((p) => p.h), idx: pts.map((p) => p.i), tamanho };
}

/**
 * O confrontante de cada lado que sobrou: o lado k → k+1 só herda o do
 * original quando os dois pontos eram vizinhos lá (ponto inválido que caiu
 * junta dois lados, e aí não se sabe de quem é).
 */
function ladosQueSobraram(conf: (string | null)[] | undefined, idx: number[], tamanho: number): (string | null)[] {
  if (!conf?.length) return idx.map(() => null);
  return idx.map((a, k) => {
    const b = idx[(k + 1) % idx.length];
    const texto = conf[a];
    return (a + 1) % tamanho === b && typeof texto === "string" && texto.trim() ? texto.trim() : null;
  });
}

function prepararFeicao(f: Feicao, fuso: number): FeicaoPronta | null {
  const anel = f.tipo === "poligono";
  const s = doisSistemas(f.utm, f.geo, f.alt, fuso, anel);
  if (!s) return null;
  const minimo = f.tipo === "poligono" ? 3 : f.tipo === "linha" ? 2 : 1;
  if (s.utm.length < minimo) return null;
  const furosUtm: XY[][] = [], furosGeo: XY[][] = [];
  if (anel) {
    const n = Math.max(f.furosUtm?.length ?? 0, f.furosGeo?.length ?? 0);
    for (let i = 0; i < n; i++) {
      const h = doisSistemas(f.furosUtm?.[i], f.furosGeo?.[i], undefined, fuso, true);
      if (h && h.utm.length >= 3) { furosUtm.push(h.utm); furosGeo.push(h.geo); }
    }
  }
  const um = f.tipo === "ponto";
  return {
    nome: String(f.nome ?? "").trim() || "SEM NOME",
    tipo: f.tipo,
    utm: um ? s.utm.slice(0, 1) : s.utm,
    geo: um ? s.geo.slice(0, 1) : s.geo,
    furosUtm, furosGeo,
    alt: um ? s.alt.slice(0, 1) : s.alt,
    props: { ...(f.props ?? {}) },
    confrontantes: anel ? ladosQueSobraram(f.confrontantes, s.idx, s.tamanho) : [],
  };
}

/** Camadas prontas para escrever: feição inválida e camada vazia ficam de fora. */
export function prepararCamadas(camadas: Camada[], fuso: number): CamadaPronta[] {
  return camadas
    .map((c, i): CamadaPronta => {
      const feicoes = (c.feicoes ?? []).map((f) => prepararFeicao(f, fuso)).filter((f): f is FeicaoPronta => f !== null);
      const soPontos = feicoes.length > 0 && feicoes.every((f) => f.tipo === "ponto");
      const rotulos = typeof c.rotulos === "number" && Number.isFinite(c.rotulos) ? Math.max(0, c.rotulos) : soPontos ? 1 : 0;
      return {
        nome: String(c.nome ?? "").trim() || `CAMADA_${i + 1}`,
        cor: /^#[0-9a-f]{6}$/i.test(c.cor ?? "") ? c.cor! : PALETA[i % PALETA.length],
        feicoes,
        segmentos: !!c.segmentos,
        rotulos,
      };
    })
    .filter((c) => c.feicoes.length > 0);
}

// ---------------------------------------------------------------------------
// Pontos (CSV, TXT da coletora, waypoints do GPX)
// ---------------------------------------------------------------------------

export interface PontoArea { nome: string; camada: string; utm: XY; geo: XY; alt: number | null; props: Record<string, Valor> }

/**
 * Os pontos das camadas: as feições de ponto (os vértices com nome). Camada sem
 * ponto nenhum (só polígonos) cede os vértices dos polígonos e linhas, sem
 * repetir o mesmo vértice de duas feições vizinhas, numerados V1, V2…
 */
export function pontosDasCamadas(camadas: CamadaPronta[]): PontoArea[] {
  const pontos = camadas.flatMap((c) => c.feicoes.filter((f) => f.tipo === "ponto").map((f): PontoArea => ({
    nome: f.nome, camada: c.nome, utm: f.utm[0], geo: f.geo[0], alt: f.alt[0] ?? null, props: f.props,
  })));
  if (pontos.length) return pontos;
  const vistos = new Set<string>();
  const out: PontoArea[] = [];
  for (const c of camadas) for (const f of c.feicoes) {
    f.utm.forEach((u, i) => {
      const k = `${Math.round(u[0] * 1000)},${Math.round(u[1] * 1000)}`;
      if (vistos.has(k)) return;
      vistos.add(k);
      out.push({ nome: `V${out.length + 1}`, camada: c.nome, utm: u, geo: f.geo[i], alt: f.alt[i] ?? null, props: {} });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Nome do arquivo
// ---------------------------------------------------------------------------

/** Sem acento nem caractere que o Windows recusa, em maiúscula: "Fazenda São José" → "FAZENDA_SAO_JOSE". */
export function nomeLimpo(s: string | null | undefined, padrao = "AREA"): string {
  const n = String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").toUpperCase().slice(0, 60).replace(/_+$/, "");
  return n || padrao;
}
