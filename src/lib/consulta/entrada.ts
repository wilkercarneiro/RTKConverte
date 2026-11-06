// "Consultar imóvel": a caixa única entende o que foi colado, sem abas para o
// usuário escolher o tipo. Reconhece:
//   - código do CAR (UF-IBGE-HASH, com ou sem os pontos do recibo do SICAR);
//   - código de parcela do SIGEF (UUID);
//   - coordenada decimal ("-12.40, -41.20", "-12,40 -41,20", "12.4 S 41.2 W");
//   - coordenada em GMS ("12°24'00"S 41°12'00"W", "-12 24 0 -41 12 0");
//   - coordenada UTM ("24L 260000 8628000", "E 260000 N 8628000 fuso 24");
//   - link do Google Maps (o ponto marcado, ou o centro da vista).
// O que não dá para consultar (link curto, SNCR, matrícula) volta com o motivo
// e o que fazer, nunca com um "formato inválido" seco.
//
// Puro (sem DOM): roda nos testes do node.
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";

const proj = proj4mod as unknown as (de: string, para: string, c: [number, number]) => [number, number];

export const UFS_IBGE: Record<string, number> = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
};

export type OrigemCoordenada = "decimal" | "gms" | "utm" | "maps" | "mapa" | "gps";

export type Entrada =
  | { tipo: "vazio" }
  | { tipo: "car"; codigo: string; uf: string; descricao: string }
  | { tipo: "sigef"; codigo: string; descricao: string }
  | { tipo: "coordenada"; lon: number; lat: number; origem: OrigemCoordenada; descricao: string; aviso?: string }
  | { tipo: "utm_sem_fuso"; e: number; n: number; descricao: string }
  | { tipo: "invalida"; motivo: string };

const fmt = (v: number, casas = 6) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const descreverPonto = (lon: number, lat: number) => `${fmt(lat)}, ${fmt(lon)}`;

/** Dentro do retângulo do Brasil (com folga no mar). */
export const noBrasil = (lon: number, lat: number) => lat >= -34.5 && lat <= 5.8 && lon >= -74.5 && lon <= -28.5;

/** Fuso UTM do lugar (o mesmo cálculo de fusoDoLon, sem importar a análise). */
const fusoDe = (lon: number) => Math.min(25, Math.max(18, Math.floor((lon + 180) / 6) + 1));

// ---------------------------------------------------------------------------
// Códigos
// ---------------------------------------------------------------------------

/** "BA-2919306-4185.CFD2.57C5…" → "BA-2919306-4185CFD257C5…" (o recibo do SICAR põe pontos no hash). */
export function normalizarCodigoCar(s: string): string | null {
  const t = s.trim().toUpperCase().replace(/[\s.]/g, "").replace(/–|—/g, "-");
  const m = t.match(/^([A-Z]{2})-?(\d{7})-?([0-9A-F]{32})$/);
  if (!m || !(m[1] in UFS_IBGE)) return null;
  // o código do município começa pelo código da UF
  if (Number(m[2].slice(0, 2)) !== UFS_IBGE[m[1]]) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Coordenadas
// ---------------------------------------------------------------------------

const num = (s: string) => Number(s.replace(",", "."));

/** Ordem lat/lon de um par em grau decimal; null se não serve para o Brasil. */
function parDecimal(a: number, b: number): { lon: number; lat: number; aviso?: string } | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ehLat = (v: number) => v >= -34.5 && v <= 5.8;
  const ehLon = (v: number) => v >= -74.5 && v <= -28.5;
  if (ehLat(a) && ehLon(b)) return { lat: a, lon: b };
  if (ehLon(a) && ehLat(b)) return { lat: b, lon: a, aviso: "Li como longitude, latitude (a ordem do arquivo GIS)." };
  // sem sinal: o Brasil fica quase todo no sul e no oeste
  if (a > 0 && b > 0 && ehLat(-a) && ehLon(-b)) return { lat: -a, lon: -b, aviso: "Sem sinal nem hemisfério: considerei Sul e Oeste." };
  if (a > 0 && b > 0 && ehLon(-a) && ehLat(-b)) return { lat: -b, lon: -a, aviso: "Sem sinal nem hemisfério: considerei Sul e Oeste (longitude primeiro)." };
  if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lon: b, aviso: "Este ponto parece fora do Brasil — confira a ordem e o sinal." };
  return null;
}

/** Grau decimal com hemisfério opcional: "-12.4, -41.2", "12,4 S; 41,2 W", "S 12.4 O 41.2". */
function lerDecimal(t: string): { lon: number; lat: number; aviso?: string } | null {
  if (/[°º'′"″]/.test(t)) return null;
  const s = t
    // a altitude do GPS/da planilha não é coordenada: "alt 500", "altitude: 512,3 m", "elev 500"
    .replace(/\b(alt(itude)?|elev(a[cç][aã]o)?|h)\b\s*[:=]?\s*-?\d+(?:[.,]\d+)?\s*m?\b/gi, " ")
    .replace(/\s+e\s+/g, " ").replace(/\b(lat(itude)?|lon(gitude)?|lng)\b\s*[:=]?/gi, " ");
  // o hemisfério vem ANTES ("S12.4 W41.2") ou DEPOIS ("12.4 S 41.2 W") dos dois números: lê de um jeito
  // só, senão a letra do segundo número vira sufixo do primeiro
  const prefixo = /^\s*[NSEWOL](?![a-z])/i.test(s);
  const re = prefixo
    ? /(?<![a-z])([NSEWOL])?\s*(-?\d+(?:[.,]\d+)?)/gi
    : /()(-?\d+(?:[.,]\d+)?)\s*([NSEWOL](?![a-z]))?/gi;
  const toks = [...s.matchAll(re)];
  if (toks.length !== 2) return null;
  const val = toks.map((m) => {
    const v = num(m[2]);
    const h = (m[1] || m[3] || "").toUpperCase();
    return { v: h === "S" || h === "W" || h === "O" ? -Math.abs(v) : h ? Math.abs(v) : v, h };
  });
  // só número inteiro "grande" não é grau (UTM)
  if (val.some((x) => Math.abs(x.v) > 180)) return null;
  const [p, q] = val;
  if (/[NS]/.test(p.h) && /[EWOL]/.test(q.h)) return { lat: p.v, lon: q.v };
  if (/[EWOL]/.test(p.h) && /[NS]/.test(q.h)) return { lat: q.v, lon: p.v };
  return parDecimal(p.v, q.v);
}

/** GMS: "12°24'00"S 41°12'00"W", "-12 24 00 -41 12 00", "S12 24 0 W41 12 0". */
function lerGms(t: string): { lon: number; lat: number; aviso?: string } | null {
  const s = t.replace(/\s+e\s+/g, " ").replace(/''/g, '"').replace(/[″“”]/g, '"').replace(/[′’]/g, "'").replace(/º/g, "°");
  type Tok = { n?: string; h?: string; grau?: boolean; neg?: boolean };
  const toks: Tok[] = [];
  for (const m of s.matchAll(/(-)?\s*(\d+(?:[.,]\d+)?)\s*(°)?|([NSEWOL])(?![a-z])/gi)) {
    if (m[4]) toks.push({ h: m[4].toUpperCase() });
    else toks.push({ n: m[2], grau: !!m[3], neg: !!m[1] });
  }
  const nums = toks.filter((x) => x.n);
  if (nums.length < 4 || nums.length > 6) return null;
  const temGrau = nums.some((x) => x.grau);
  if (!temGrau && nums.length !== 6 && nums.length !== 4) return null;
  // agrupa: novo grupo quando aparece "°", sinal, ou letra de hemisfério antes do número
  const grupos: { partes: number[]; neg: boolean; h: string | null }[] = [];
  let atual: { partes: number[]; neg: boolean; h: string | null } | null = null;
  let hPendente: string | null = null;
  const porGrupo = temGrau ? 0 : nums.length / 2;
  for (const x of toks) {
    if (x.h) {
      // letra depois do grupo fecha; antes do número abre o próximo
      if (atual && atual.h === null && atual.partes.length) { atual.h = x.h; continue; }
      hPendente = x.h; continue;
    }
    const novo = !atual || (temGrau ? x.grau : atual.partes.length >= porGrupo) || x.neg || (hPendente !== null && atual.partes.length > 0);
    if (novo) { atual = { partes: [], neg: !!x.neg, h: hPendente }; grupos.push(atual); hPendente = null; }
    atual!.partes.push(num(x.n!));
  }
  if (grupos.length !== 2 || grupos.some((g) => g.partes.length < 1 || g.partes.length > 3)) return null;
  const graus = grupos.map((g) => {
    const [d, m = 0, sec = 0] = g.partes;
    if (m >= 60 || sec >= 60) return NaN;
    const v = d + m / 60 + sec / 3600;
    const neg = g.neg || g.h === "S" || g.h === "W" || g.h === "O";
    return { v: neg ? -v : v, h: g.h };
  });
  if (graus.some((g) => typeof g === "number" || !Number.isFinite(g.v))) return null;
  const [p, q] = graus as { v: number; h: string | null }[];
  if (p.h && /[EWOL]/.test(p.h)) return { lat: q.v, lon: p.v };
  if (p.h && /[NS]/.test(p.h)) return { lat: p.v, lon: q.v };
  return parDecimal(p.v, q.v);
}

/** UTM: E de 6 dígitos, N de 7 e o fuso (18 a 25, com ou sem a letra da banda). */
function lerUtm(t: string): Entrada | null {
  // formato brasileiro com ponto de milhar e vírgula decimal: "8.628.000,00" e "260.000,00" → "8628000.00"
  // e "8.628.000" → "8628000" (sem a vírgula, só com dois ou mais grupos: "260.000" pode ser decimal)
  const s = t
    .replace(/\b\d{1,3}(?:\.\d{3})+,\d+/g, (m) => m.replace(/\./g, "").replace(",", "."))
    .replace(/\d{1,3}(?:\.\d{3}){2,}/g, (m) => m.replace(/\./g, ""));
  const nums = [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => ({ txt: m[0], v: num(m[0]), i: m.index ?? 0 }));
  const e = nums.find((x) => x.v >= 100_000 && x.v < 1_000_000);
  const n = nums.find((x) => x.v >= 1_000_000 && x.v <= 10_000_000);
  if (!e || !n) return null;
  // fuso: "24L", "24S", "fuso 24", "zona 24", "UTM 24" ou um número 18–25 solto
  const mf = s.match(/(?:fuso|zona|zone|utm|mc)\s*[:=]?\s*(1[89]|2[0-5])\s*[a-z]?\b/i) ?? s.match(/\b(1[89]|2[0-5])\s*[c-hj-np-x]\b/i);
  let fuso = mf ? Number(mf[1]) : null;
  if (fuso === null) {
    const solto = nums.find((x) => x !== e && x !== n && Number.isInteger(x.v) && x.v >= 18 && x.v <= 25);
    if (solto) fuso = solto.v;
  }
  const descricao = `UTM E ${fmt(e.v, 2)} · N ${fmt(n.v, 2)}`;
  if (fuso === null) return { tipo: "utm_sem_fuso", e: e.v, n: n.v, descricao };
  return utmParaEntrada(e.v, n.v, fuso);
}

export function utmParaEntrada(e: number, n: number, fuso: number): Entrada {
  const [lon, lat] = proj(utmDef(fuso), GEO_DEF, [e, n]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return { tipo: "invalida", motivo: "Coordenada UTM inválida." };
  const aviso = !noBrasil(lon, lat)
    ? "Este ponto cai fora do Brasil — confira E, N e o fuso."
    : fusoDe(lon) !== fuso ? `O ponto cai no fuso ${fusoDe(lon)}, não no ${fuso}: confira o fuso.` : undefined;
  return { tipo: "coordenada", lon, lat, origem: "utm", descricao: `UTM ${fuso}S E ${fmt(e, 2)} N ${fmt(n, 2)} → ${descreverPonto(lon, lat)}`, aviso };
}

/** O ponto de um link do Google Maps (o marcador vale mais que o centro da vista). */
function lerLinkMaps(t: string): Entrada | null {
  if (!/google\.[a-z.]+\/maps|maps\.google\.|goo\.gl\/maps|maps\.app\.goo\.gl|g\.co\/kgs/i.test(t)) return null;
  let u = t.trim();
  try { u = decodeURIComponent(u); } catch { /* fica cru */ }
  if (/goo\.gl\/maps|maps\.app\.goo\.gl|g\.co\/kgs/i.test(u) && !/[@!=]-?\d/.test(u)) {
    return { tipo: "invalida", motivo: "Link curto do Google Maps: o navegador não deixa abrir. Abra o link, toque no ponto e copie as coordenadas (ou o endereço completo da barra)." };
  }
  const par = (lat: string, lon: string, como: string): Entrada | null => {
    const la = Number(lat), lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
    return { tipo: "coordenada", lat: la, lon: lo, origem: "maps", descricao: `Google Maps (${como}) → ${descreverPonto(lo, la)}`, aviso: noBrasil(lo, la) ? undefined : "Este ponto parece fora do Brasil." };
  };
  const D = "(-?\\d+(?:\\.\\d+)?)";
  const marcador = u.match(new RegExp(`!3d${D}!4d${D}`));
  if (marcador) return par(marcador[1], marcador[2], "ponto marcado");
  const q = u.match(new RegExp(`[?&](?:q|query|ll|destination|center)=(?:loc:)?${D}\\s*,\\s*${D}`));
  if (q) return par(q[1], q[2], "ponto do link");
  const lugar = u.match(/\/maps\/(?:place|search)\/([^/@?]+)/);
  if (lugar) {
    const dentro = interpretarEntrada(lugar[1].replace(/\+/g, " "));
    if (dentro.tipo === "coordenada") return { ...dentro, origem: "maps", descricao: `Google Maps (ponto marcado) → ${descreverPonto(dentro.lon, dentro.lat)}` };
  }
  const vista = u.match(new RegExp(`@${D},${D}`));
  if (vista) {
    const r = par(vista[1], vista[2], "centro da vista");
    return r && r.tipo === "coordenada" ? { ...r, aviso: r.aviso ?? "O link não tem um ponto marcado: usei o centro do mapa que estava aberto." } : r;
  }
  return { tipo: "invalida", motivo: "Não achei coordenada neste link do Google Maps. Toque no ponto no mapa e copie as coordenadas que aparecem." };
}

// ---------------------------------------------------------------------------
// A caixa
// ---------------------------------------------------------------------------

export function interpretarEntrada(texto: string): Entrada {
  const t = (texto ?? "").trim();
  if (!t) return { tipo: "vazio" };
  if (/^https?:\/\/|google\.|goo\.gl/i.test(t)) {
    const link = lerLinkMaps(t);
    if (link) return link;
    return { tipo: "invalida", motivo: "Só consigo ler links do Google Maps. Para outros sites, copie a coordenada." };
  }
  const car = normalizarCodigoCar(t);
  if (car) return { tipo: "car", codigo: car, uf: car.slice(0, 2), descricao: `Código do CAR · ${car.slice(0, 2)}` };
  if (/^[A-Z]{2}-\d{4,7}-[0-9A-F.]{6,}$/i.test(t.replace(/\s/g, ""))) {
    return { tipo: "invalida", motivo: "Parece um código do CAR, mas está incompleto: são a UF, os 7 dígitos do município e 32 letras/números (ex.: BA-2919306-4185CFD2…)." };
  }
  if (UUID.test(t)) return { tipo: "sigef", codigo: t.toLowerCase(), descricao: "Código de parcela do SIGEF" };
  // UTM antes do SNCR: "260000 8628000" (E e N sem o fuso, como vem da planilha de campo) tem 13 dígitos
  // sem os espaços, igual ao código do SNCR — e é muito mais comum
  const utm = lerUtm(t);
  if (utm) return utm;
  const semEspaco = t.replace(/[\s.\-/]/g, "");
  if (/^\d{13}$/.test(semEspaco) || /^\d{3}\.?\d{3}\.?\d{3}\.?\d{3}-?\d$/.test(t)) {
    return { tipo: "invalida", motivo: "Código do SNCR/CCIR: ainda não há base pública aberta para buscar por ele. Use o código do CAR, uma coordenada ou envie o arquivo do imóvel." };
  }
  if (/matr[ií]cula/i.test(t)) {
    return { tipo: "invalida", motivo: "A matrícula só é consultada no cartório (ONR, pago). Use o código do CAR, uma coordenada ou envie o arquivo do imóvel." };
  }
  const gms = lerGms(t);
  if (gms) return { tipo: "coordenada", ...gms, origem: "gms", descricao: `Coordenada em GMS → ${descreverPonto(gms.lon, gms.lat)}` };
  const dec = lerDecimal(t);
  if (dec) return { tipo: "coordenada", ...dec, origem: "decimal", descricao: `Coordenada → ${descreverPonto(dec.lon, dec.lat)}` };
  return { tipo: "invalida", motivo: "Não reconheci. Cole o código do CAR (UF-município-código), uma coordenada (−12,40, −41,20 · 12°24'S 41°12'W · UTM 24L 260000 8628000) ou um link do Google Maps." };
}
