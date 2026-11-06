// "Ambiente" da Consultar imóvel: clima (Open-Meteo), solo (SoilGrids/ISRIC),
// bioma e Amazônia Legal (IBGE) e o município (IBGE). Todos respondem ao
// navegador (CORS conferido em 06/11/2026). Cada um falha sozinho: a tela diz
// qual não respondeu e segue com os outros.
//
// Fonte honesta: SoilGrids é MODELO global de 250 m (não é levantamento de
// solo); o clima é a reanálise ERA5 (Open-Meteo), não estação; o bioma é o
// mapa do IBGE 1:250.000.
import { motivoCurto } from "../restricoes.ts";

export const HOSTS_AMBIENTE = ["archive-api.open-meteo.com", "rest.isric.org", "geoservicos.ibge.gov.br", "servicodados.ibge.gov.br"];

export interface OpcoesAmbiente { fetch?: typeof fetch; timeoutMs?: number; agora?: Date }

async function pegarJson<T>(url: string, quem: string, op: OpcoesAmbiente): Promise<T> {
  const f = op.fetch ?? fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), op.timeoutMs ?? 20_000);
  try {
    const r = await f(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`${quem} respondeu ${r.status}`);
    const texto = await r.text();
    try { return JSON.parse(texto) as T; } catch { throw new Error(`${quem}: resposta inesperada`); }
  } catch (e) {
    throw new Error(ctl.signal.aborted ? `${quem} não respondeu a tempo` : motivoCurto(e));
  } finally {
    clearTimeout(t);
  }
}

const isoDia = (d: Date) => d.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// Clima (Open-Meteo, reanálise ERA5)
// ---------------------------------------------------------------------------

export interface Clima {
  /** período com dado (a reanálise chega com ~5 dias de atraso) */
  de: string;
  ate: string;
  chuva12mMm: number;
  chuva30dMm: number;
  tempMediaC: number | null;
  /** chuva por mês (AAAA-MM), do mais antigo ao mais recente */
  meses: { mes: string; chuvaMm: number; /** o mês tem 27 dias ou mais de dados (os das pontas da janela, não) */ inteiro?: boolean }[];
  maisChuvoso: { mes: string; chuvaMm: number } | null;
  maisSeco: { mes: string; chuvaMm: number } | null;
  /** altitude do ponto no modelo, m */
  altitudeM: number | null;
}

export function urlClima(lon: number, lat: number, agora = new Date()): string {
  const ate = new Date(agora.getTime() - 6 * 864e5);
  const de = new Date(ate.getTime() - 364 * 864e5);
  const q = new URLSearchParams({
    latitude: lat.toFixed(5), longitude: lon.toFixed(5), start_date: isoDia(de), end_date: isoDia(ate),
    daily: "precipitation_sum,temperature_2m_mean", timezone: "America/Sao_Paulo",
  });
  return `https://archive-api.open-meteo.com/v1/archive?${q}`;
}

/** A resposta do Open-Meteo → os números da tela. */
export function lerClima(j: { elevation?: number; daily?: { time?: string[]; precipitation_sum?: (number | null)[]; temperature_2m_mean?: (number | null)[] } }): Clima {
  const t = j.daily?.time ?? [], p = j.daily?.precipitation_sum ?? [], tm = j.daily?.temperature_2m_mean ?? [];
  const dias = t.map((d, i) => ({ d, p: p[i], t: tm[i] })).filter((x) => typeof x.p === "number" && Number.isFinite(x.p));
  if (dias.length < 30) throw new Error("Open-Meteo: sem dados de chuva para o ponto");
  const soma = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  const porMes = new Map<string, number>();
  for (const x of dias) porMes.set(x.d.slice(0, 7), (porMes.get(x.d.slice(0, 7)) ?? 0) + (x.p as number));
  // mês cortado nas pontas (começo/fim do período) não vale para "mais seco" nem entra nas barras
  const meses = [...porMes.entries()].map(([mes, chuvaMm]) => ({
    mes, chuvaMm: Math.round(chuvaMm * 10) / 10, inteiro: dias.filter((x) => x.d.startsWith(mes)).length >= 27,
  }));
  const inteiros = meses.filter((m) => m.inteiro);
  const temps = dias.map((x) => x.t).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const ordenados = [...inteiros].sort((a, b) => b.chuvaMm - a.chuvaMm);
  return {
    de: dias[0].d, ate: dias[dias.length - 1].d,
    chuva12mMm: Math.round(soma(dias.map((x) => x.p as number))),
    chuva30dMm: Math.round(soma(dias.slice(-30).map((x) => x.p as number)) * 10) / 10,
    tempMediaC: temps.length ? Math.round((soma(temps) / temps.length) * 10) / 10 : null,
    meses,
    maisChuvoso: ordenados[0] ?? null,
    maisSeco: ordenados[ordenados.length - 1] ?? null,
    altitudeM: Number.isFinite(Number(j.elevation)) ? Math.round(Number(j.elevation)) : null,
  };
}

export async function consultarClima(lon: number, lat: number, op: OpcoesAmbiente = {}): Promise<Clima> {
  return lerClima(await pegarJson(urlClima(lon, lat, op.agora), "Open-Meteo", op));
}

// ---------------------------------------------------------------------------
// Solo (SoilGrids, classe WRB) com o nome brasileiro
// ---------------------------------------------------------------------------

/**
 * Grupo de referência da WRB → a classe mais próxima do SiBCS (Embrapa) e o que
 * ela costuma significar no campo. A correspondência é aproximada (as duas
 * classificações não são uma tradução uma da outra).
 */
export const SOLOS_WRB: Record<string, { nome: string; explicacao: string }> = {
  Ferralsols: { nome: "Latossolos", explicacao: "Solos profundos, muito intemperizados e bem drenados, em relevo plano a suave. Boa estrutura física; em geral ácidos e pobres em nutrientes (pedem calagem e adubação)." },
  Acrisols: { nome: "Argissolos (distróficos)", explicacao: "Acúmulo de argila no horizonte B, ácidos e de baixa fertilidade. Sujeitos a erosão em declive: atenção a terraços e estradas." },
  Lixisols: { nome: "Argissolos (eutróficos)", explicacao: "Acúmulo de argila no horizonte B, com fertilidade natural melhor que a dos Acrissolos. Sensíveis à erosão em declive." },
  Alisols: { nome: "Argissolos/Nitossolos alumínicos", explicacao: "Argila acumulada no B e muito alumínio trocável: ácidos, exigem correção." },
  Luvisols: { nome: "Luvissolos", explicacao: "Argila acumulada no B e alta fertilidade natural; comuns no semiárido. Rasos a pouco profundos, erodem com facilidade." },
  Nitisols: { nome: "Nitossolos", explicacao: "Argilosos, profundos e bem estruturados (a \"terra roxa\" em parte); boa aptidão agrícola." },
  Arenosols: { nome: "Neossolos Quartzarênicos", explicacao: "Arenosos e profundos: drenagem excessiva, baixa retenção de água e de nutrientes, alta suscetibilidade à erosão." },
  Leptosols: { nome: "Neossolos Litólicos", explicacao: "Rasos, com rocha perto da superfície; relevo movimentado. Restrição para mecanização e fundação." },
  Regosols: { nome: "Neossolos Regolíticos", explicacao: "Pouco desenvolvidos, sobre material pouco alterado; fertilidade variável." },
  Fluvisols: { nome: "Neossolos Flúvicos", explicacao: "Formados de sedimentos de rio, em várzeas e margens: sujeitos a inundação (atenção à APP)." },
  Cambisols: { nome: "Cambissolos", explicacao: "Pouco desenvolvidos, de profundidade e fertilidade variáveis; comuns em relevo ondulado." },
  Gleysols: { nome: "Gleissolos", explicacao: "Encharcados boa parte do ano (lençol raso), em baixadas e várzeas: drenagem difícil, em geral área úmida/APP." },
  Planosols: { nome: "Planossolos", explicacao: "Mudança brusca de textura com camada adensada: encharcam na chuva e racham na seca." },
  Plinthosols: { nome: "Plintossolos", explicacao: "Com plintita (manchas que endurecem): drenagem impedida; comuns em áreas de lençol oscilante." },
  Vertisols: { nome: "Vertissolos", explicacao: "Argila expansiva: racham na seca e ficam pegajosos na chuva. Problema para estradas e fundações." },
  Histosols: { nome: "Organossolos", explicacao: "Ricos em matéria orgânica (turfa), em áreas alagadas: baixa capacidade de suporte." },
  Podzols: { nome: "Espodossolos", explicacao: "Arenosos, com acúmulo de matéria orgânica e ferro em profundidade; muito pobres; comuns em restingas." },
  Solonetz: { nome: "Planossolos Nátricos", explicacao: "Com muito sódio: estrutura ruim e restrição forte para cultivo." },
  Solonchaks: { nome: "Gleissolos Sálicos", explicacao: "Salinos (sais solúveis), em áreas costeiras ou de clima seco." },
  Chernozems: { nome: "Chernossolos", explicacao: "Horizonte superficial escuro e fértil; boa aptidão agrícola." },
  Phaeozems: { nome: "Chernossolos", explicacao: "Horizonte superficial escuro, rico em bases; férteis." },
  Kastanozems: { nome: "Chernossolos", explicacao: "Superfície escura com acúmulo de carbonatos; férteis, de clima mais seco." },
  Calcisols: { nome: "Cambissolos/Chernossolos carbonáticos", explicacao: "Acúmulo de carbonato de cálcio; comuns no semiárido." },
  Umbrisols: { nome: "Cambissolos Húmicos", explicacao: "Superfície escura e ácida, rica em matéria orgânica; comuns em serras frias." },
  Stagnosols: { nome: "Planossolos/Gleissolos", explicacao: "Encharcamento temporário por camada pouco permeável." },
  Andosols: { nome: "(sem equivalente comum no Brasil)", explicacao: "Solos de cinza vulcânica — raros no Brasil; confira em campo." },
  Durisols: { nome: "(sem equivalente comum no Brasil)", explicacao: "Com camada cimentada por sílica; raros no Brasil." },
  Gypsisols: { nome: "(sem equivalente comum no Brasil)", explicacao: "Com acúmulo de gesso; raros no Brasil." },
  Retisols: { nome: "Argissolos", explicacao: "Argila acumulada em profundidade, com língua de material claro." },
  Albeluvisols: { nome: "Argissolos", explicacao: "Argila acumulada em profundidade, com língua de material claro." },
  Anthrosols: { nome: "Antropossolos", explicacao: "Modificados pelo uso humano (terra preta de índio, aterros antigos)." },
  Technosols: { nome: "Antropossolos", explicacao: "Formados de material de origem humana (aterro, entulho)." },
  Cryosols: { nome: "(não ocorre no Brasil)", explicacao: "Solos congelados; o modelo errou para este ponto." },
};

export interface Solo {
  /** grupo WRB mais provável */
  wrb: string;
  nome: string;
  explicacao: string;
  /** probabilidade do grupo mais provável, % */
  probabilidade: number | null;
  /** as outras classes prováveis, com o nome brasileiro */
  alternativas: { wrb: string; nome: string; probabilidade: number }[];
}

export const urlSolo = (lon: number, lat: number) =>
  `https://rest.isric.org/soilgrids/v2.0/classification/query?lon=${lon.toFixed(5)}&lat=${lat.toFixed(5)}&number_classes=3`;

export function lerSolo(j: { wrb_class_name?: string | null; wrb_class_probability?: [string, number][] }): Solo {
  const wrb = (j.wrb_class_name ?? "").trim();
  if (!wrb || /no ?data|null/i.test(wrb)) throw new Error("SoilGrids: sem classe de solo para o ponto (água, área urbana ou fora do modelo)");
  const pt = SOLOS_WRB[wrb] ?? { nome: wrb, explicacao: "Classe da WRB sem correspondência cadastrada aqui." };
  const probs = (j.wrb_class_probability ?? []).filter((x) => Array.isArray(x) && typeof x[1] === "number");
  const prob = probs.find((x) => x[0] === wrb)?.[1] ?? null;
  return {
    wrb, nome: pt.nome, explicacao: pt.explicacao, probabilidade: prob,
    alternativas: probs.filter((x) => x[0] !== wrb).map(([w, p]) => ({ wrb: w, nome: SOLOS_WRB[w]?.nome ?? w, probabilidade: p })),
  };
}

export async function consultarSolo(lon: number, lat: number, op: OpcoesAmbiente = {}): Promise<Solo> {
  return lerSolo(await pegarJson(urlSolo(lon, lat), "SoilGrids", { timeoutMs: 45_000, ...op }));
}

// ---------------------------------------------------------------------------
// IBGE: bioma, Amazônia Legal e município (consulta por ponto, só atributos)
// ---------------------------------------------------------------------------

export const IBGE_OWS = "https://geoservicos.ibge.gov.br/geoserver/ows";

/** GetFeature com filtro "contém o ponto", sem baixar geometria (propertyName). Eixo lon,lat explícito. */
export function urlIbgePonto(typeName: string, campos: string[], lon: number, lat: number): string {
  const filtro = `<Filter xmlns="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml"><Intersects><PropertyName>geom</PropertyName>`
    + `<gml:Point srsName="http://www.opengis.net/gml/srs/epsg.xml#4326"><gml:coordinates>${lon.toFixed(6)},${lat.toFixed(6)}</gml:coordinates></gml:Point></Intersects></Filter>`;
  const q = new URLSearchParams({ service: "WFS", version: "1.1.0", request: "GetFeature", typeName, outputFormat: "application/json", maxFeatures: "1", propertyName: campos.join(","), filter: filtro });
  return `${IBGE_OWS}?${q}`;
}

async function ibgePonto(typeName: string, campos: string[], lon: number, lat: number, op: OpcoesAmbiente): Promise<Record<string, unknown> | null> {
  const j = await pegarJson<{ type?: string; features?: { properties?: Record<string, unknown> }[] }>(urlIbgePonto(typeName, campos, lon, lat), "IBGE", op);
  if (j.type !== "FeatureCollection") throw new Error("IBGE: resposta inesperada");
  return j.features?.[0]?.properties ?? null;
}

export interface Bioma {
  bioma: string;
  amazoniaLegal: boolean | null;
  /** a reserva legal mínima de referência do Código Florestal (art. 12) para o lugar */
  reservaLegal: string;
}

export function reservaLegalDe(bioma: string, amazoniaLegal: boolean | null): string {
  if (amazoniaLegal === null) return "Reserva legal: 80% (floresta), 35% (cerrado) ou 20% (campos) na Amazônia Legal; 20% no resto do país (Lei 12.651/2012, art. 12).";
  if (!amazoniaLegal) return "Fora da Amazônia Legal: reserva legal mínima de 20% (Lei 12.651/2012, art. 12).";
  if (/amaz/i.test(bioma)) return "Amazônia Legal, bioma Amazônia: reserva legal de 80% em área de floresta (35% se for cerrado, 20% em campos gerais).";
  if (/cerrado/i.test(bioma)) return "Amazônia Legal, bioma Cerrado: reserva legal de 35% (20% se for campo geral).";
  return "Amazônia Legal: reserva legal de 80% (floresta), 35% (cerrado) ou 20% (campos gerais), conforme a vegetação.";
}

export async function consultarBioma(lon: number, lat: number, op: OpcoesAmbiente = {}): Promise<Bioma> {
  const [b, al] = await Promise.all([
    ibgePonto("CREN:lm_bioma_250", ["bioma"], lon, lat, op),
    ibgePonto("CGMAT:qg_2024_040_amazleg_agreg", ["nm_amazleg"], lon, lat, op).catch(() => null),
  ]);
  const bioma = String(b?.bioma ?? "").trim();
  if (!bioma) throw new Error("IBGE: o ponto não cai em nenhum bioma (mar ou fora do Brasil)");
  const nome = al ? String(al.nm_amazleg ?? "") : "";
  const amazoniaLegal = al ? !/n[ãa]o/i.test(nome) && /amaz/i.test(nome) : null;
  return { bioma, amazoniaLegal, reservaLegal: reservaLegalDe(bioma, amazoniaLegal) };
}

export interface Municipio { codigo: string; nome: string; uf: string; regiaoImediata: string | null; microrregiao: string | null }

export async function consultarMunicipio(lon: number, lat: number, op: OpcoesAmbiente = {}): Promise<Municipio | null> {
  const p = await ibgePonto("CGMAT:qg_2025_030_munic", ["cd_mun", "nm_mun", "sigla_uf"], lon, lat, op);
  if (!p) return null;
  const codigo = String(p.cd_mun ?? "");
  const base: Municipio = { codigo, nome: String(p.nm_mun ?? ""), uf: String(p.sigla_uf ?? ""), regiaoImediata: null, microrregiao: null };
  if (!/^\d{7}$/.test(codigo)) return base;
  // a região (Localidades do IBGE) é enfeite: falhar aqui não tira o município
  try {
    const l = await pegarJson<{ microrregiao?: { nome?: string }; "regiao-imediata"?: { nome?: string } }>(
      `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/${codigo}`, "IBGE Localidades", { ...op, timeoutMs: 8_000 });
    return { ...base, regiaoImediata: l["regiao-imediata"]?.nome ?? null, microrregiao: l.microrregiao?.nome ?? null };
  } catch {
    return base;
  }
}
