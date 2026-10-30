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
//   imóvel     = perímetro do KML
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
  antiHorario, areaPol, areaPols, areaPolAteCorte, bufferLinha, caixa, diferenca, dist, dot, esquerda,
  faixaReferencial, intersecao, offsetPols, sub, tirarBicos, unit, uniao,
} from "../loteamento/geom.ts";
import type { Poligono, Pt } from "../loteamento/geom.ts";
import type { LonLat } from "./kml.ts";
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

export interface ProjetoCar {
  versao: 1;
  nome: string;
  /** anel aberto do imóvel, em grau, como veio do KML */
  perimetro: LonLat[];
  /** nome de cada vértice do perímetro (pontos do GPS), quando o arquivo trouxe */
  nomesVertices?: (string | null)[];
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

export function projetoNovo(nome: string, perimetro: LonLat[], rios: { nome: string; linha: LonLat[] }[] = [], nomesVertices?: (string | null)[]): ProjetoCar {
  return {
    versao: 1, nome, perimetro,
    ...(nomesVertices?.some(Boolean) && nomesVertices.length === perimetro.length ? { nomesVertices } : {}),
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
  return {
    versao: 1,
    nome: p.nome || base.nome,
    perimetro: p.perimetro,
    ...(Array.isArray(p.nomesVertices) && p.nomesVertices.length === p.perimetro.length ? { nomesVertices: p.nomesVertices } : {}),
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
  };
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
  imovel: Poligono;
  reserva: Poligono[];
  /** vegetação nativa cedida (fora da reserva) */
  vegetacao: Poligono[];
  app: Poligono[];
  produtiva: Poligono[];
  area: { imovel: number; reserva: number; vegetacao: number; app: number; produtiva: number; appNaReserva: number };
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

export function calcularCar(pr: ProjetoCar): ResultadoCar {
  const plano = planoDe(pr.perimetro);
  const imovel: Poligono = { ext: antiHorario(pr.perimetro.map(plano.para)), furos: [] };
  const areaImovel = areaPol(imovel);
  const reserva = semBicos(pr.reserva.poligonos.length
    ? intersecao([imovel], uniao(pr.reserva.poligonos.map((p) => polPlano(plano, p))))
    : []);
  const veg = pr.vegetacao ?? vegetacaoVazia();
  const vegDesenhada = veg.poligonos.length ? intersecao([imovel], uniao(veg.poligonos.map((p) => polPlano(plano, p)))) : [];
  const vegetacao = semBicos(vegDesenhada.length && reserva.length ? diferenca(vegDesenhada, reserva) : vegDesenhada);
  const faixas = pr.rios.flatMap((r) => faixaDoRio(plano, r));
  const app = semBicos(faixas.length ? intersecao([imovel], uniao(faixas)) : []);
  const fora = [...reserva, ...vegetacao, ...(pr.produtivaSemApp ? app : [])];
  // só a reserva (o caso de sempre): a mesma conta de antes, sem passar pela união
  const produtiva = semBicos(diferenca([imovel], fora.length === reserva.length ? reserva : uniao(fora)));

  const area = {
    imovel: areaImovel,
    reserva: areaPols(reserva),
    vegetacao: areaPols(vegetacao),
    app: areaPols(app),
    produtiva: areaPols(produtiva),
    appNaReserva: reserva.length && app.length ? areaPols(intersecao(reserva, app)) : 0,
  };
  const pctReserva = areaImovel > 0 ? (100 * area.reserva) / areaImovel : 0;
  const reservaOk = pctReserva >= pr.reserva.pct - 1e-6;
  const vegetacaoOk = !veg.alvoHa || area.vegetacao >= veg.alvoHa * 1e4 - 1e-3;

  const avisos: string[] = [];
  if (!reserva.length) avisos.push("Falta definir onde fica a reserva legal.");
  else if (!reservaOk) avisos.push(`A reserva tem ${fmtPct(pctReserva)} do imóvel; o pedido é ${fmtPct(pr.reserva.pct)}. Use “Ajustar à %”.`);
  if (reserva.length > 1) avisos.push(`A reserva ficou em ${reserva.length} pedaços separados.`);
  if (veg.poligonos.length) {
    if (!vegetacao.length) avisos.push("A vegetação nativa desenhada caiu toda dentro da reserva legal — a reserva do próprio imóvel não pode ser cedida.");
    else {
      const comida = areaPols(vegDesenhada) - area.vegetacao;
      if (comida > 1) avisos.push(`${fmtNum(comida, 2)} m² da vegetação desenhada caíam na reserva legal e ficaram de fora (só o excedente pode ser cedido).`);
      if (!vegetacaoOk) avisos.push(`A vegetação nativa tem ${fmtHa(area.vegetacao)}; o imóvel beneficiado precisa de ${fmtHa(veg.alvoHa! * 1e4)}. Use “Ajustar”.`);
      if (vegetacao.length > 1) avisos.push(`A vegetação nativa ficou em ${vegetacao.length} pedaços separados.`);
    }
  }
  for (const r of pr.rios) {
    if (r.linha.length < 2) avisos.push(`${r.nome}: a linha precisa de ao menos 2 pontos.`);
    else if (!(r.faixa > 0)) avisos.push(`${r.nome}: falta a largura da faixa de APP.`);
    else if (!intersecao([imovel], faixaDoRio(plano, r)).length) avisos.push(`${r.nome}: a faixa não toca o imóvel.`);
  }
  return { plano, imovel, reserva, vegetacao, app, produtiva, area, pctReserva, reservaOk, vegetacaoOk, avisos };
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
export function reservaPorLado(pr: ProjetoCar, lado: number, giro = 0): PoligonoGeo[] {
  const res = calcularCar({ ...pr, reserva: { ...pr.reserva, poligonos: [] } });
  const anel = res.imovel.ext;
  const a = anel[lado % anel.length], b = anel[(lado + 1) % anel.length];
  const g = (giro * Math.PI) / 180;
  const d = unit(sub(b, a));
  const u: Pt = [d[0] * Math.cos(g) - d[1] * Math.sin(g), d[0] * Math.sin(g) + d[1] * Math.cos(g)];
  // interior à esquerda de cada aresta do anel anti-horário
  const n = esquerda(u);
  const proj = anel.map((p) => dot(sub(p, a), n));
  const alvo = alvoReserva(pr, res.area.imovel);
  const s = bisseccao((x) => areaPolAteCorte(res.imovel, a, n, x), alvo, Math.min(...proj), Math.max(...proj));
  // cortador do tamanho do imóvel: retângulo gigante tira o clipper da faixa rápida de inteiros
  const { min, max } = caixa(anel);
  const D = 2 * dist(min, max);
  const corte = faixaReferencial(a, u, n, -D, D, -D, s);
  return paraGeo(res.plano, intersecao([res.imovel], [corte]), pr.perimetro);
}

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
  const alvo = alvoReserva(pr, res.area.imovel);
  const { min, max } = caixa(res.imovel.ext);
  const D = dist(min, max);
  const resto = diferenca([res.imovel], res.reserva);
  const ajustada = (delta: number) => delta >= 0
    ? intersecao([res.imovel], offsetPols(res.reserva, delta))
    : diferenca(res.reserva, offsetPols(resto, -delta));
  const areaCom = (delta: number) => areaPols(ajustada(delta));
  if (areaCom(D) < alvo) throw new Error("O imóvel inteiro não chega à porcentagem pedida.");
  const delta = bisseccao(areaCom, alvo, -D, D, 45);
  const out = ajustada(delta);
  if (!out.length) throw new Error("Não deu para ajustar: a reserva sumiu ao encolher. Desenhe-a maior.");
  return paraGeo(res.plano, out, pr.perimetro);
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
  return { res, livre: res.reserva.length ? diferenca([res.imovel], res.reserva) : [res.imovel] };
}

/**
 * Faixa de vegetação encostada no lado `lado` do imóvel, com a área pedida,
 * desviando da reserva. A divisa é paralela ao lado; `giro` (graus) a inclina.
 */
export function vegetacaoPorLado(pr: ProjetoCar, lado: number, giro = 0): PoligonoGeo[] {
  const alvo = alvoVegetacao(pr);
  const { res, livre } = livreDaReserva(pr);
  const disponivel = areaPols(livre);
  if (disponivel < alvo) throw new Error(`Fora da reserva sobram ${fmtHa(disponivel)}; não cabem os ${fmtHa(alvo)} pedidos.`);
  const anel = res.imovel.ext;
  const a = anel[lado % anel.length], b = anel[(lado + 1) % anel.length];
  const g = (giro * Math.PI) / 180;
  const d = unit(sub(b, a));
  const u: Pt = [d[0] * Math.cos(g) - d[1] * Math.sin(g), d[0] * Math.sin(g) + d[1] * Math.cos(g)];
  const n = esquerda(u);
  const proj = anel.map((p) => dot(sub(p, a), n));
  const { min, max } = caixa(anel);
  const D = 2 * dist(min, max);
  const corte = (s: number) => intersecao(livre, [faixaReferencial(a, u, n, -D, D, -D, s)]);
  const s = bisseccao((x) => areaPols(corte(x)), alvo, Math.min(...proj), Math.max(...proj), 50);
  return paraGeo(res.plano, corte(s), pr.perimetro);
}

/** Leva a vegetação desenhada à área pedida sem tirá-la do lugar (como "Ajustar" da reserva). */
export function ajustarVegetacao(pr: ProjetoCar): PoligonoGeo[] {
  const alvo = alvoVegetacao(pr);
  const res = calcularCar(pr);
  if (!res.vegetacao.length) return pr.vegetacao.poligonos;
  const livre = res.reserva.length ? diferenca([res.imovel], res.reserva) : [res.imovel];
  if (areaPols(livre) < alvo) throw new Error(`Fora da reserva sobram ${fmtHa(areaPols(livre))}; não cabem os ${fmtHa(alvo)} pedidos.`);
  const { min, max } = caixa(res.imovel.ext);
  const D = dist(min, max);
  const resto = diferenca(livre, res.vegetacao);
  const ajustada = (delta: number) => delta >= 0
    ? intersecao(livre, offsetPols(res.vegetacao, delta))
    : diferenca(res.vegetacao, offsetPols(resto, -delta));
  const delta = bisseccao((x) => areaPols(ajustada(x)), alvo, -D, D, 45);
  const out = ajustada(delta);
  if (!out.length) throw new Error("Não deu para ajustar: a vegetação sumiu ao encolher. Desenhe-a maior.");
  return paraGeo(res.plano, out, pr.perimetro);
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
