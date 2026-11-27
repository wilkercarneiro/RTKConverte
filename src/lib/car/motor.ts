// Motor do CAR: área total, reserva legal, APP de rio e área produtiva.
//
// O projeto guarda só a INTENÇÃO, em grau (SIRGAS 2000): o perímetro do KML, os
// polígonos da reserva e as linhas dos rios com a faixa de cada um. As camadas
// saem de `calcularCar` toda vez — mexer na reserva muda a produtiva na hora.
//
// Plano de cálculo: cônica equivalente de Albers centrada no imóvel. É de ÁREA
// igual, então a porcentagem da reserva que a tela mostra é a que o SICAR
// mede, e não depende de fuso UTM (o KML do CAR não traz fuso). Albers e não
// LAEA: a inversa elipsoidal da LAEA no proj4 erra ~2 mm na volta, e a reserva
// gravada em grau voltava 0,3 m² menor do que foi calculada.
//
// Glebas (pedido de 27/11/2026): a área total pode vir em várias poligonais no
// mesmo arquivo (as glebas do imóvel). A 1ª fica em `perimetro` (o serviço de
// uma gleba só não muda nada) e as outras em `glebas`. O imóvel é a união
// delas: as que se encostam viram um polígono só (a divisa comum some), as
// separadas viram partes do MESMO registro no shapefile da área total.
//
//   imóvel     = perímetro do KML (com glebas: a UNIÃO das glebas — 27/11/2026)
//   reserva    = (polígonos da reserva) ∩ imóvel
//   vegetação  = (polígonos da vegetação nativa) ∩ imóvel − reserva
//   APP        = (faixa de cada rio, dos dois lados da linha) ∩ imóvel
//   produtiva  = imóvel − reserva − vegetação   (− APP, se o operador pedir)
//
// Vegetação nativa = o excedente de mata do imóvel que vai servir de reserva
// legal de OUTRO imóvel (compensação, Código Florestal art. 66, §5º, IV). Só
// pode ser excedente: a reserva do próprio imóvel não é cedida, por isso a
// vegetação nunca entra nela.
import proj4mod from "proj4";
import { GEO_DEF } from "../../../supabase/functions/_shared/geo.ts";
import {
  antiHorario, areaAssinada, areaPol, areaPols, areaPolAteCorte, bufferLinha, caixa, diferenca, dist, distSegmento, dot, esquerda,
  faixaReferencial, intersecao, offsetPols, sub, tirarBicos, unit, uniao,
} from "../loteamento/geom.ts";
import type { Anel, Poligono, Pt } from "../loteamento/geom.ts";
import type { LonLat } from "./kml.ts";
import { medir } from "../consulta/geometria.ts";
import type { PoligonoGeo } from "./shapefile.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

export interface RioCar {
  id: string;
  nome: string;
  /** a linha do rio (eixo do leito), em grau */
  linha: LonLat[];
  /** largura da APP em metros, medida da linha para CADA margem */
  faixa: number;
}

/** Vegetação nativa cedida a outro imóvel (compensação de reserva legal). */
export interface VegetacaoCar {
  poligonos: PoligonoGeo[];
  /** área que o imóvel beneficiado precisa compensar (ha); null = sem meta */
  alvoHa: number | null;
  /** de onde saiu a faixa automática: lado do perímetro e giro da divisa (graus) */
  lado: number | null;
  giro: number;
  /** o imóvel que vai usar esta área como reserva legal */
  beneficiado: { nome: string; car: string };
}

/** Uma gleba a mais da área total (a 1ª gleba é o `perimetro` do projeto). */
export interface GlebaCar {
  /** o nome do polígono no arquivo, quando tinha */
  nome: string | null;
  /** anel aberto, em grau */
  anel: LonLat[];
  nomesVertices?: (string | null)[];
}

export interface ProjetoCar {
  versao: 1;
  nome: string;
  /** anel aberto do imóvel (a 1ª gleba, quando há várias), em grau, como veio do KML */
  perimetro: LonLat[];
  /** nome de cada vértice do perímetro (pontos do GPS), quando o arquivo trouxe */
  nomesVertices?: (string | null)[];
  /** nome do polígono da 1ª gleba no arquivo (só com glebas) */
  nomeGleba?: string | null;
  /** as OUTRAS glebas da área total (ausente = imóvel de uma poligonal só) */
  glebas?: GlebaCar[];
  vegetacao: VegetacaoCar;
  reserva: {
    /** porcentagem exigida (20% fora da Amazônia Legal; varia por bioma) */
    pct: number;
    poligonos: PoligonoGeo[];
    /** de onde saiu a faixa automática: lado do perímetro e giro da divisa (graus) */
    lado: number | null;
    giro: number;
  };
  rios: RioCar[];
  /** a área produtiva também exclui a APP? (padrão: só exclui a reserva) */
  produtivaSemApp: boolean;
  /**
   * Em que área o serviço fala (o agrimensor escolhe):
   *  - "utm": UTM no fuso do lugar + Gauss — a mesma do Campo, da Consulta,
   *    do SIGEF e, no CAR de Lençóis, a declarada no SICAR;
   *  - "albers": projeção de área igual colada no imóvel (o cálculo de sempre).
   * Ausente = "albers" (serviço antigo não muda de número sozinho).
   * O desenho continua no plano Albers; só os hectares (e a meta da
   * vegetação) passam pelo fator — as porcentagens não mudam.
   */
  baseArea?: BaseAreaCar;
  /** o ajuste automático da sobreposição com os vizinhos (src/lib/car/sobreposicao.ts) */
  sobreposicao?: RegistroSobreposicao;
}

export type BaseAreaCar = "utm" | "albers";

/** O que o ajuste automático da sobreposição fez (e o que a pessoa mandou não fazer). */
export interface RegistroSobreposicao {
  /** o perímetro antes do PRIMEIRO ajuste (o "Desfazer" volta a ele) */
  original: LonLat[] | null;
  nomesOriginais?: (string | null)[];
  /** as outras glebas antes do primeiro ajuste (só com glebas) */
  glebasOriginais?: GlebaCar[];
  /** os vizinhos cortados no último ajuste */
  cortes: { fonte: "car" | "sigef"; codigo: string; rotulo: string; areaM2: number }[];
  antesM2: number;
  depoisM2: number;
  em: string;
  /** códigos que a pessoa mandou deixar como estão (desfez o ajuste) */
  ignorar: string[];
  /** códigos que a pessoa mandou cortar mesmo sendo grandes ou parecendo o próprio imóvel */
  forcar: string[];
}

function normalizarRegistro(r: Partial<RegistroSobreposicao> | undefined): RegistroSobreposicao | undefined {
  if (!r || typeof r !== "object") return undefined;
  const lista = (x: unknown) => (Array.isArray(x) ? x.filter((c): c is string => typeof c === "string") : []);
  const glebasOriginais = normalizarGlebas(r.glebasOriginais);
  return {
    original: Array.isArray(r.original) && r.original.length >= 3 ? r.original : null,
    ...(Array.isArray(r.nomesOriginais) ? { nomesOriginais: r.nomesOriginais } : {}),
    ...(glebasOriginais ? { glebasOriginais } : {}),
    cortes: Array.isArray(r.cortes) ? r.cortes.filter((c) => c && typeof c.codigo === "string") : [],
    antesM2: Number(r.antesM2) || 0,
    depoisM2: Number(r.depoisM2) || 0,
    em: typeof r.em === "string" ? r.em : "",
    ignorar: lista(r.ignorar),
    forcar: lista(r.forcar),
  };
}

/** Faixas de APP de curso d'água (Lei 12.651/2012, art. 4º, I), pela largura do leito. */
export const FAIXAS_APP: { faixa: number; leito: string }[] = [
  { faixa: 30, leito: "rio com menos de 10 m" },
  { faixa: 50, leito: "rio de 10 a 50 m" },
  { faixa: 100, leito: "rio de 50 a 200 m" },
  { faixa: 200, leito: "rio de 200 a 600 m" },
  { faixa: 500, leito: "rio com mais de 600 m" },
];

export const vegetacaoVazia = (): VegetacaoCar => ({ poligonos: [], alvoHa: null, lado: null, giro: 0, beneficiado: { nome: "", car: "" } });

/** Glebas do banco/arquivo: só as que têm anel; lista vazia = imóvel de uma poligonal (undefined). */
function normalizarGlebas(gs: unknown): GlebaCar[] | undefined {
  if (!Array.isArray(gs)) return undefined;
  // só coordenada numérica: o anel conferido (contorno 0039) tem de ser o mesmo que vira arquivo
  const ponto = (p: unknown): p is LonLat => Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" && Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const out = gs
    .filter((g): g is GlebaCar => !!g && Array.isArray((g as GlebaCar).anel) && (g as GlebaCar).anel.length >= 3 && (g as GlebaCar).anel.every(ponto))
    .map((g): GlebaCar => ({
      nome: typeof g.nome === "string" && g.nome.trim() ? g.nome : null,
      anel: g.anel,
      ...(Array.isArray(g.nomesVertices) && g.nomesVertices.length === g.anel.length && g.nomesVertices.some(Boolean) ? { nomesVertices: g.nomesVertices } : {}),
    }));
  return out.length ? out : undefined;
}

/** Os anéis da área total: a 1ª gleba (`perimetro`) e as outras. */
export const aneisDoImovel = (pr: Pick<ProjetoCar, "perimetro" | "glebas">): LonLat[][] =>
  [pr.perimetro, ...(pr.glebas ?? []).map((g) => g.anel)].filter((a) => a.length >= 3);

/** Todos os vértices da área total (âncoras do paraGeo, plano de cálculo, caixa da consulta). */
export const pontosDoImovel = (pr: Pick<ProjetoCar, "perimetro" | "glebas">): LonLat[] => aneisDoImovel(pr).flat();

/** O imóvel tem mais de uma gleba? */
export const temGlebas = (pr: Pick<ProjetoCar, "glebas">): boolean => (pr.glebas?.length ?? 0) > 0;

/** O projeto com as glebas trocadas (vazio = imóvel de uma poligonal só). */
export function comGlebas(pr: ProjetoCar, glebas: GlebaCar[] | undefined): ProjetoCar {
  const { glebas: _g, nomeGleba, ...resto } = pr;
  return glebas?.length ? { ...resto, ...(nomeGleba ? { nomeGleba } : {}), glebas } : resto;
}

export function projetoNovo(nome: string, perimetro: LonLat[], rios: { nome: string; linha: LonLat[] }[] = [], nomesVertices?: (string | null)[],
  glebas?: GlebaCar[], nomeGleba?: string | null): ProjetoCar {
  const gs = normalizarGlebas(glebas);
  return {
    versao: 1, nome, perimetro,
    ...(nomesVertices?.some(Boolean) && nomesVertices.length === perimetro.length ? { nomesVertices } : {}),
    ...(gs ? { glebas: gs, ...(nomeGleba ? { nomeGleba } : {}) } : {}),
    reserva: { pct: 20, poligonos: [], lado: null, giro: 0 },
    vegetacao: vegetacaoVazia(),
    rios: rios.map((r, i) => ({ id: `rio-${i + 1}`, nome: r.nome, linha: r.linha, faixa: 30 })),
    produtivaSemApp: false,
  };
}

/** Projeto do banco, completando o que faltar (versões antigas, campo apagado). */
export function normalizarProjetoCar(p: Partial<ProjetoCar> | null, base: ProjetoCar): ProjetoCar {
  if (!p || !Array.isArray(p.perimetro) || p.perimetro.length < 3) return base;
  const v = p.vegetacao;
  const glebas = normalizarGlebas(p.glebas);
  return {
    versao: 1,
    nome: p.nome || base.nome,
    perimetro: p.perimetro,
    ...(Array.isArray(p.nomesVertices) && p.nomesVertices.length === p.perimetro.length ? { nomesVertices: p.nomesVertices } : {}),
    ...(glebas ? { glebas, ...(typeof p.nomeGleba === "string" && p.nomeGleba ? { nomeGleba: p.nomeGleba } : {}) } : {}),
    vegetacao: {
      poligonos: Array.isArray(v?.poligonos) ? v!.poligonos : [],
      alvoHa: Number.isFinite(v?.alvoHa) && v!.alvoHa! > 0 ? v!.alvoHa : null,
      lado: v?.lado ?? null,
      giro: v?.giro ?? 0,
      beneficiado: { nome: v?.beneficiado?.nome ?? "", car: v?.beneficiado?.car ?? "" },
    },
    reserva: {
      pct: Number.isFinite(p.reserva?.pct) ? p.reserva!.pct : 20,
      poligonos: Array.isArray(p.reserva?.poligonos) ? p.reserva!.poligonos : [],
      lado: p.reserva?.lado ?? null,
      giro: p.reserva?.giro ?? 0,
    },
    rios: Array.isArray(p.rios) ? p.rios.filter((r) => r && Array.isArray(r.linha)) : [],
    produtivaSemApp: !!p.produtivaSemApp,
    ...(p.baseArea === "utm" || p.baseArea === "albers" ? { baseArea: p.baseArea } : {}),
    ...(normalizarRegistro(p.sobreposicao) ? { sobreposicao: normalizarRegistro(p.sobreposicao) } : {}),
  };
}

/** As duas áreas do mesmo perímetro (ou das glebas), para a escolha (m²). */
export function areasDasBases(perimetroOuAneis: LonLat[] | LonLat[][]): Record<BaseAreaCar, number> {
  const aneis = (typeof perimetroOuAneis[0]?.[0] === "number" ? [perimetroOuAneis] : perimetroOuAneis) as LonLat[][];
  const pl = planoDe(aneis.flat());
  const planos = aneis.map((a) => antiHorario(a.map(pl.para)));
  const albers = areaPols(uniaoDasGlebas(planos).imovel);
  return { albers, utm: albers * fatorUtm(aneis, planos) };
}

/** UTM ÷ área igual, anel a anel (glebas que se sobrepõem não contam duas vezes no fator). */
function fatorUtm(aneis: LonLat[][], planos: Anel[]): number {
  const soma = planos.reduce((s, a) => s + Math.abs(areaAssinada(a)), 0);
  return soma > 0 ? medir(aneis).areaM2 / soma : 1;
}

// ---------------------------------------------------------------------------
// Glebas: a união que vira a área total
// ---------------------------------------------------------------------------

/** Vértice de uma gleba a menos disto da outra é encaixado nela (levantamentos diferentes erram mm–cm na divisa comum). */
export const ENCAIXE_GLEBAS_M = 0.05;
/** Vão entre glebas menor que isto é sobra do encaixe, não terra de fora (m²). */
export const VAO_MIN_M2 = 1;

export interface UniaoGlebas {
  /** a área total: um polígono por parte que não encosta nas outras */
  imovel: Poligono[];
  /** cada gleba como veio, no plano (para o contorno tracejado na prancheta) */
  glebas: Anel[];
  /** soma das glebas − união (m², plano): o que uma gleba cobre da outra */
  sobrepostoM2: number;
  /** vãos (furos) que sobraram entre as glebas, em m² */
  vaosM2: number[];
  /** partes separadas que ficam a menos de 1 m uma da outra: a menor distância (m); null = nenhuma */
  quaseM: number | null;
}

/** Menor distância entre duas partes (vértice de uma a lado da outra), só abaixo de `limite`. */
function distanciaEntrePartes(a: Anel, b: Anel, limite: number): number {
  const ca = caixa(a), cb = caixa(b);
  if (ca.min[0] - limite > cb.max[0] || cb.min[0] - limite > ca.max[0] || ca.min[1] - limite > cb.max[1] || cb.min[1] - limite > ca.max[1]) return Infinity;
  let m = Infinity;
  const ver = (pts: Anel, lados: Anel) => {
    for (const p of pts) for (let k = 0; k < lados.length; k++) {
      const d = distSegmento(p, lados[k], lados[(k + 1) % lados.length]).d;
      if (d < m) m = d;
    }
  };
  ver(a, b);
  ver(b, a);
  return m;
}

/**
 * Encaixa os vértices de cada gleba nos vértices/lados das ANTERIORES
 * (tolerância ENCAIXE_GLEBAS_M). Em ordem: a 1ª fica parada, a 2ª encaixa na
 * 1ª, a 3ª nas duas já encaixadas — encaixar todas ao mesmo tempo fazia as duas
 * pontas trocarem de lugar e a divisa comum continuava desencontrada (fresta).
 */
function encaixarGlebas(glebas: Anel[]): Anel[] {
  const prontas: Anel[] = [];
  const caixas: { min: Pt; max: Pt }[] = [];
  const perto = (p: Pt, j: number) => {
    const c = caixas[j];
    return p[0] >= c.min[0] - ENCAIXE_GLEBAS_M && p[0] <= c.max[0] + ENCAIXE_GLEBAS_M && p[1] >= c.min[1] - ENCAIXE_GLEBAS_M && p[1] <= c.max[1] + ENCAIXE_GLEBAS_M;
  };
  for (const g of glebas) {
    prontas.push(g.map((p) => encaixarPonto(p, prontas, perto)));
    caixas.push(caixa(prontas[prontas.length - 1]));
  }
  return prontas;
}

/** O vértice mais perto das glebas já encaixadas (< ENCAIXE_GLEBAS_M); senão, o ponto do lado mais perto; senão, ele mesmo. */
function encaixarPonto(p: Pt, glebas: Anel[], perto: (p: Pt, j: number) => boolean): Pt {
  let melhor: Pt = p, dm = ENCAIXE_GLEBAS_M;
  for (let j = 0; j < glebas.length; j++) {
    if (!perto(p, j)) continue;
    for (const q of glebas[j]) { const d = dist(p, q); if (d > 0 && d < dm) { dm = d; melhor = q; } }
  }
  if (melhor !== p) return melhor;
  for (let j = 0; j < glebas.length; j++) {
    if (!perto(p, j)) continue;
    const o = glebas[j];
    for (let k = 0; k < o.length; k++) {
      const a = o[k], b = o[(k + 1) % o.length];
      const { d, t } = distSegmento(p, a, b);
      if (d > 0 && d < dm) { dm = d; melhor = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    }
  }
  return melhor;
}

const cacheUniao = new Map<string, UniaoGlebas>();

/**
 * A área total a partir das glebas (anéis no plano). Uma gleba só: o anel como
 * veio, sem passar pelo clipper (o serviço de sempre não muda um milímetro).
 */
export function uniaoDasGlebas(glebasIn: Anel[]): UniaoGlebas {
  const glebas = glebasIn.filter((g) => g.length >= 3).map(antiHorario);
  if (glebas.length <= 1) return { imovel: glebas.map((ext) => ({ ext, furos: [] })), glebas, sobrepostoM2: 0, vaosM2: [], quaseM: null };
  // o cálculo roda a cada arraste na prancheta: a união só muda quando as glebas mudam
  const chave = glebas.map((g) => g.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join(";")).join("|");
  const ja = cacheUniao.get(chave);
  if (ja) return ja;
  const u = uniao(encaixarGlebas(glebas).map((ext) => ({ ext: antiHorario(ext), furos: [] })));
  const vaosM2: number[] = [];
  const imovel = u.map((p): Poligono => ({
    ext: tirarBicos(p.ext),
    furos: p.furos.filter((f) => {
      const a = Math.abs(areaAssinada(f));
      if (a < VAO_MIN_M2) return false;
      vaosM2.push(a);
      return true;
    }).map((f) => tirarBicos(f)),
  })).filter((p) => p.ext.length >= 3).sort((a, b) => areaPol(b) - areaPol(a));
  const soma = glebas.reduce((s, g) => s + areaAssinada(g), 0);
  let quase = Infinity;
  for (let i = 0; i < imovel.length; i++) for (let j = i + 1; j < imovel.length; j++) quase = Math.min(quase, distanciaEntrePartes(imovel[i].ext, imovel[j].ext, 1));
  const r: UniaoGlebas = { imovel, glebas, sobrepostoM2: Math.max(0, soma - areaPols(imovel)), vaosM2, quaseM: quase < 1 ? quase : null };
  if (cacheUniao.size > 40) cacheUniao.clear();
  cacheUniao.set(chave, r);
  return r;
}

// ---------------------------------------------------------------------------
// Plano de cálculo
// ---------------------------------------------------------------------------

export interface PlanoCar {
  para: (g: LonLat) => Pt;
  de: (p: Pt) => LonLat;
}

export function planoDe(perimetro: LonLat[]): PlanoCar {
  const lon0 = perimetro.reduce((s, p) => s + p[0], 0) / perimetro.length;
  const lat0 = perimetro.reduce((s, p) => s + p[1], 0) / perimetro.length;
  // paralelos-padrão colados no imóvel; os dois do mesmo lado do equador
  // (simétricos ao equador a cônica degenera)
  let lat1 = lat0 - 0.05, lat2 = lat0 + 0.05;
  if (Math.abs(lat1 + lat2) < 0.02) { lat1 += 0.2; lat2 += 0.2; }
  const aea = `+proj=aea +lat_1=${lat1} +lat_2=${lat2} +lat_0=${lat0} +lon_0=${lon0} +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs`;
  return {
    para: (g) => proj(GEO_DEF, aea, [g[0], g[1]]),
    de: (p) => proj(aea, GEO_DEF, [p[0], p[1]]),
  };
}

const polPlano = (pl: PlanoCar, p: PoligonoGeo): Poligono => ({
  ext: antiHorario(p.ext.map(pl.para)),
  furos: p.furos.map((f) => antiHorario(f.map(pl.para)).reverse()),
});

// ---------------------------------------------------------------------------
// Cálculo das camadas
// ---------------------------------------------------------------------------

export interface ResultadoCar {
  plano: PlanoCar;
  /** a área total: um polígono por parte (uma gleba, ou glebas que se encostam = 1 parte) */
  imovel: Poligono[];
  /** cada gleba como veio, no plano (uma só quando o imóvel é de uma poligonal) */
  glebas: Anel[];
  reserva: Poligono[];
  /** vegetação nativa cedida (fora da reserva) */
  vegetacao: Poligono[];
  app: Poligono[];
  produtiva: Poligono[];
  /** áreas em m² na base escolhida (pr.baseArea) */
  area: { imovel: number; reserva: number; vegetacao: number; app: number; produtiva: number; appNaReserva: number };
  /** área na base escolhida ÷ área no plano Albers (1 na base "albers") */
  fatorArea: number;
  /** reserva / imóvel, em % */
  pctReserva: number;
  /** a reserva atinge a porcentagem pedida? */
  reservaOk: boolean;
  /** a vegetação atinge a área pedida (sem meta = true)? */
  vegetacaoOk: boolean;
  avisos: string[];
}

/** Folga para cima no alvo da reserva: o SICAR não pode ler 19,9999%. */
const FOLGA_PCT = 0.001;

export function faixaDoRio(pl: PlanoCar, r: RioCar): Poligono[] {
  return r.linha.length >= 2 && r.faixa > 0 ? bufferLinha(r.linha.map(pl.para), 2 * r.faixa, "redonda") : [];
}

/** O bico de largura zero do clipper vira aresta cruzada em grau (SICAR 3001). */
const semBicos = (pols: Poligono[]): Poligono[] =>
  pols.map((p) => ({ ext: tirarBicos(p.ext), furos: p.furos.map((f) => tirarBicos(f)) }));

/** O plano de cálculo do projeto: centrado em TODAS as glebas. */
export const planoDoProjeto = (pr: Pick<ProjetoCar, "perimetro" | "glebas">): PlanoCar => planoDe(pontosDoImovel(pr));

/** Os lados do perímetro (anel externo de cada parte, anti-horário), na ordem do índice da ferramenta "Encostar". */
export function ladosDoImovel(imovel: Poligono[]): { a: Pt; b: Pt; parte: number }[] {
  return imovel.flatMap((p, parte) => p.ext.map((a, i) => ({ a, b: p.ext[(i + 1) % p.ext.length], parte })));
}

export function calcularCar(pr: ProjetoCar): ResultadoCar {
  const aneis = aneisDoImovel(pr);
  const plano = planoDe(aneis.flat());
  const planos = aneis.map((a) => antiHorario(a.map(plano.para)));
  const uniaoG = uniaoDasGlebas(planos);
  const imovel = uniaoG.imovel;
  const areaImovel = areaPols(imovel);
  const reserva = semBicos(pr.reserva.poligonos.length
    ? intersecao(imovel, uniao(pr.reserva.poligonos.map((p) => polPlano(plano, p))))
    : []);
  const veg = pr.vegetacao ?? vegetacaoVazia();
  const vegDesenhada = veg.poligonos.length ? intersecao(imovel, uniao(veg.poligonos.map((p) => polPlano(plano, p)))) : [];
  const vegetacao = semBicos(vegDesenhada.length && reserva.length ? diferenca(vegDesenhada, reserva) : vegDesenhada);
  const faixas = pr.rios.flatMap((r) => faixaDoRio(plano, r));
  const app = semBicos(faixas.length ? intersecao(imovel, uniao(faixas)) : []);
  const fora = [...reserva, ...vegetacao, ...(pr.produtivaSemApp ? app : [])];
  // só a reserva (o caso de sempre): a mesma conta de antes, sem passar pela união
  const produtiva = semBicos(diferenca(imovel, fora.length === reserva.length ? reserva : uniao(fora)));

  // base UTM: o mesmo desenho, os hectares no número UTM (as razões não mudam)
  const k = pr.baseArea === "utm" && areaImovel > 0 ? fatorUtm(aneis, planos) : 1;
  const area = {
    imovel: areaImovel * k,
    reserva: areaPols(reserva) * k,
    vegetacao: areaPols(vegetacao) * k,
    app: areaPols(app) * k,
    produtiva: areaPols(produtiva) * k,
    appNaReserva: reserva.length && app.length ? areaPols(intersecao(reserva, app)) * k : 0,
  };
  const pctReserva = area.imovel > 0 ? (100 * area.reserva) / area.imovel : 0;
  const reservaOk = pctReserva >= pr.reserva.pct - 1e-6;
  const vegetacaoOk = !veg.alvoHa || area.vegetacao >= veg.alvoHa * 1e4 - 1e-3;

  const avisos: string[] = [];
  if (planos.length > 1) {
    if (imovel.length > 1) avisos.push(`As ${planos.length} glebas formam ${imovel.length} partes que não se encostam: a área total sai num shapefile só, com as ${imovel.length} partes no mesmo registro.`);
    if (uniaoG.sobrepostoM2 * k > 1) avisos.push(`As glebas se sobrepõem em ${fmtNum(uniaoG.sobrepostoM2 * k, 2)} m²: a área total conta essa parte uma vez só.`);
    if (uniaoG.quaseM !== null) avisos.push(`Duas glebas ficam a ${fmtNum(uniaoG.quaseM * 100, 0)} cm uma da outra sem se encostar: se a divisa é comum, acerte o desenho (o SICAR pode recusar partes quase coladas).`);
    if (uniaoG.vaosM2.length) avisos.push(`Entre as glebas ficou ${uniaoG.vaosM2.length === 1 ? "um vão" : `${uniaoG.vaosM2.length} vãos`} de ${uniaoG.vaosM2.map((v) => `${fmtNum(v * k, 2)} m²`).join(", ")} fora da área total — confira se é mesmo terra de fora do imóvel.`);
  }
  if (!reserva.length) avisos.push("Falta definir onde fica a reserva legal.");
  else if (!reservaOk) avisos.push(`A reserva tem ${fmtPct(pctReserva)} do imóvel; o pedido é ${fmtPct(pr.reserva.pct)}. Use “Ajustar à %”.`);
  if (reserva.length > 1) avisos.push(`A reserva ficou em ${reserva.length} pedaços separados.`);
  if (veg.poligonos.length) {
    if (!vegetacao.length) avisos.push("A vegetação nativa desenhada caiu toda dentro da reserva legal — a reserva do próprio imóvel não pode ser cedida.");
    else {
      const comida = areaPols(vegDesenhada) * k - area.vegetacao;
      if (comida > 1) avisos.push(`${fmtNum(comida, 2)} m² da vegetação desenhada caíam na reserva legal e ficaram de fora (só o excedente pode ser cedido).`);
      if (!vegetacaoOk) avisos.push(`A vegetação nativa tem ${fmtHa(area.vegetacao)}; o imóvel beneficiado precisa de ${fmtHa(veg.alvoHa! * 1e4)}. Use “Ajustar”.`);
      if (vegetacao.length > 1) avisos.push(`A vegetação nativa ficou em ${vegetacao.length} pedaços separados.`);
    }
  }
  for (const r of pr.rios) {
    if (r.linha.length < 2) avisos.push(`${r.nome}: a linha precisa de ao menos 2 pontos.`);
    else if (!(r.faixa > 0)) avisos.push(`${r.nome}: falta a largura da faixa de APP.`);
    else if (!intersecao(imovel, faixaDoRio(plano, r)).length) avisos.push(`${r.nome}: a faixa não toca o imóvel.`);
  }
  return { plano, imovel, glebas: uniaoG.glebas, reserva, vegetacao, app, produtiva, area, fatorArea: k, pctReserva, reservaOk, vegetacaoOk, avisos };
}

// ---------------------------------------------------------------------------
// Ferramentas da reserva
// ---------------------------------------------------------------------------

/** Bissecção de f crescente em [a, b] até f(x) ≈ alvo. */
function bisseccao(f: (x: number) => number, alvo: number, a: number, b: number, iter = 60): number {
  for (let i = 0; i < iter; i++) {
    const m = (a + b) / 2;
    if (f(m) < alvo) a = m; else b = m;
  }
  return b;
}

/**
 * Faixa de reserva encostada no lado `lado` do imóvel (índice da aresta do
 * anel anti-horário do plano), com a área exata da porcentagem. A divisa da
 * reserva é paralela ao lado; `giro` (graus) a inclina.
 */
/** O lado `lado` (índice de ladosDoImovel) e a parte do imóvel em que ele está. */
function ladoDaParte(res: ResultadoCar, lado: number): { a: Pt; b: Pt; parte: Poligono; varias: boolean } {
  const lados = ladosDoImovel(res.imovel);
  if (!lados.length) throw new Error("O imóvel não tem perímetro.");
  const l = lados[((lado % lados.length) + lados.length) % lados.length];
  return { a: l.a, b: l.b, parte: res.imovel[l.parte], varias: res.imovel.length > 1 };
}

export function reservaPorLado(pr: ProjetoCar, lado: number, giro = 0): PoligonoGeo[] {
  const res = calcularCar({ ...pr, reserva: { ...pr.reserva, poligonos: [] } });
  // com glebas separadas a faixa fica na PARTE do lado clicado (não atravessa para outra gleba)
  const { a, b, parte, varias } = ladoDaParte(res, lado);
  const anel = parte.ext;
  const g = (giro * Math.PI) / 180;
  const d = unit(sub(b, a));
  const u: Pt = [d[0] * Math.cos(g) - d[1] * Math.sin(g), d[0] * Math.sin(g) + d[1] * Math.cos(g)];
  // interior à esquerda de cada aresta do anel anti-horário
  const n = esquerda(u);
  const proj = anel.map((p) => dot(sub(p, a), n));
  const alvo = alvoReserva(pr, areaPols(res.imovel));
  if (varias && areaPol(parte) < alvo) {
    throw new Error(`Esta parte do imóvel tem ${fmtHa(areaPol(parte) * res.fatorArea)}; a reserva pede ${fmtHa(alvo * res.fatorArea)}. Encoste numa gleba maior, ou desenhe a reserva à mão (pode ficar em mais de uma gleba).`);
  }
  const s = bisseccao((x) => areaPolAteCorte(parte, a, n, x), alvo, Math.min(...proj), Math.max(...proj));
  // cortador do tamanho do imóvel: retângulo gigante tira o clipper da faixa rápida de inteiros
  const { min, max } = caixa(anel);
  const D = 2 * dist(min, max);
  const corte = faixaReferencial(a, u, n, -D, D, -D, s);
  return paraGeo(res.plano, intersecao([parte], [corte]), pontosDoImovel(pr));
}

const caixaDoImovel = (imovel: Poligono[]) => caixa(imovel.flatMap((p) => p.ext));

const alvoReserva = (pr: ProjetoCar, areaImovel: number) => (areaImovel * (pr.reserva.pct + FOLGA_PCT)) / 100;

/**
 * Leva a reserva desenhada à porcentagem pedida sem mudar o lugar dela: cresce
 * ou encolhe por igual (offset) e recorta no imóvel. Lado encostado na divisa
 * continua na divisa; só a borda de dentro anda. Para encolher, quem cresce é
 * o RESTO do imóvel para dentro da reserva — encolher a reserva puxaria também
 * o lado da divisa para dentro e a descolaria do perímetro.
 */
export function ajustarReserva(pr: ProjetoCar): PoligonoGeo[] {
  const res = calcularCar(pr);
  if (!res.reserva.length) return pr.reserva.poligonos;
  const alvo = alvoReserva(pr, areaPols(res.imovel));
  const { min, max } = caixaDoImovel(res.imovel);
  const D = dist(min, max);
  const resto = diferenca(res.imovel, res.reserva);
  const ajustada = (delta: number) => delta >= 0
    ? intersecao(res.imovel, offsetPols(res.reserva, delta))
    : diferenca(res.reserva, offsetPols(resto, -delta));
  const areaCom = (delta: number) => areaPols(ajustada(delta));
  if (areaCom(D) < alvo) throw new Error("O imóvel inteiro não chega à porcentagem pedida.");
  const delta = bisseccao(areaCom, alvo, -D, D, 45);
  const out = ajustada(delta);
  if (!out.length) throw new Error("Não deu para ajustar: a reserva sumiu ao encolher. Desenhe-a maior.");
  return paraGeo(res.plano, out, pontosDoImovel(pr));
}

// ---------------------------------------------------------------------------
// Ferramentas da vegetação nativa (o mesmo jeito da reserva, só fora dela)
// ---------------------------------------------------------------------------

/** Área-alvo da vegetação (m²), com folga para cima: o beneficiado não pode receber 1 m² a menos. */
const alvoVegetacao = (pr: ProjetoCar): number => {
  const ha = pr.vegetacao?.alvoHa;
  if (!ha || !(ha > 0)) throw new Error("Informe primeiro a área a ceder (ha) — é o que o imóvel beneficiado precisa compensar.");
  return ha * 1e4 + Math.max(0.5, ha * 0.1);
};

/** O imóvel sem a reserva legal: é só aí que a vegetação cedida pode ficar. */
function livreDaReserva(pr: ProjetoCar): { res: ResultadoCar; livre: Poligono[] } {
  const res = calcularCar({ ...pr, vegetacao: { ...(pr.vegetacao ?? vegetacaoVazia()), poligonos: [] } });
  return { res, livre: res.reserva.length ? diferenca(res.imovel, res.reserva) : res.imovel };
}

/**
 * Faixa de vegetação encostada no lado `lado` do imóvel, com a área pedida,
 * desviando da reserva. A divisa é paralela ao lado; `giro` (graus) a inclina.
 */
export function vegetacaoPorLado(pr: ProjetoCar, lado: number, giro = 0): PoligonoGeo[] {
  const { res, livre: livreTodo } = livreDaReserva(pr);
  // a meta está na base escolhida; o corte é no plano
  const alvo = alvoVegetacao(pr) / res.fatorArea;
  // com glebas separadas, a faixa fica na parte do lado clicado
  const { a, b, parte, varias } = ladoDaParte(res, lado);
  const livre = varias ? intersecao(livreTodo, [parte]) : livreTodo;
  const disponivel = areaPols(livre);
  if (disponivel < alvo) throw new Error(`Fora da reserva sobram ${fmtHa(disponivel * res.fatorArea)}${varias ? " nesta parte do imóvel" : ""}; não cabem os ${fmtHa(alvo * res.fatorArea)} pedidos.`);
  const anel = parte.ext;
  const g = (giro * Math.PI) / 180;
  const d = unit(sub(b, a));
  const u: Pt = [d[0] * Math.cos(g) - d[1] * Math.sin(g), d[0] * Math.sin(g) + d[1] * Math.cos(g)];
  const n = esquerda(u);
  const proj = anel.map((p) => dot(sub(p, a), n));
  const { min, max } = caixa(anel);
  const D = 2 * dist(min, max);
  const corte = (s: number) => intersecao(livre, [faixaReferencial(a, u, n, -D, D, -D, s)]);
  const s = bisseccao((x) => areaPols(corte(x)), alvo, Math.min(...proj), Math.max(...proj), 50);
  return paraGeo(res.plano, corte(s), pontosDoImovel(pr));
}

/** Leva a vegetação desenhada à área pedida sem tirá-la do lugar (como "Ajustar" da reserva). */
export function ajustarVegetacao(pr: ProjetoCar): PoligonoGeo[] {
  const res = calcularCar(pr);
  const alvo = alvoVegetacao(pr) / res.fatorArea;
  if (!res.vegetacao.length) return pr.vegetacao.poligonos;
  const livre = res.reserva.length ? diferenca(res.imovel, res.reserva) : res.imovel;
  if (areaPols(livre) < alvo) throw new Error(`Fora da reserva sobram ${fmtHa(areaPols(livre) * res.fatorArea)}; não cabem os ${fmtHa(alvo * res.fatorArea)} pedidos.`);
  const { min, max } = caixaDoImovel(res.imovel);
  const D = dist(min, max);
  const resto = diferenca(livre, res.vegetacao);
  const ajustada = (delta: number) => delta >= 0
    ? intersecao(livre, offsetPols(res.vegetacao, delta))
    : diferenca(res.vegetacao, offsetPols(resto, -delta));
  const delta = bisseccao((x) => areaPols(ajustada(x)), alvo, -D, D, 45);
  const out = ajustada(delta);
  if (!out.length) throw new Error("Não deu para ajustar: a vegetação sumiu ao encolher. Desenhe-a maior.");
  return paraGeo(res.plano, out, pontosDoImovel(pr));
}

/** Polígonos do plano → grau, com os vértices do perímetro voltando EXATOS ao KML. */
export function paraGeo(pl: PlanoCar, pols: Poligono[], perimetro?: LonLat[]): PoligonoGeo[] {
  const ancoras = perimetro?.map((g) => ({ g, p: pl.para(g) })) ?? [];
  const conv = (p: Pt): LonLat => {
    for (const a of ancoras) if (dist(a.p, p) < 0.005) return a.g;
    return pl.de(p);
  };
  return pols.map((p) => ({ ext: p.ext.map(conv), furos: p.furos.map((f) => f.map(conv)) }));
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------

export const fmtNum = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const fmtHa = (m2: number) => `${fmtNum(m2 / 10000, 4)} ha`;
export const fmtPct = (v: number) => `${fmtNum(v, 2)}%`;
