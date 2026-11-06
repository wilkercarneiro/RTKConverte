// Leitor de pontos com cota para a terraplanagem: o TXT/CSV do levantamento
// planialtimétrico (nome, E, N, cota — em qualquer ordem e com qualquer
// separador), tolerante a cabeçalho, linha de comentário, vírgula decimal e
// colunas a mais (descrição/código do ponto).
//
// Quando o arquivo tem cabeçalho, as colunas vêm pelo nome. Sem cabeçalho, pelo
// tamanho dos números: E de UTM tem 6 dígitos (100 000 a 900 000), N tem 7
// (no hemisfério sul, 6 a 10 milhões), a cota fica entre −100 e 6 000 m e a
// coluna de texto (ou a primeira, de números inteiros pequenos) é o nome.
// Latitude/longitude em grau decimal também entram, convertidas para UTM.
//
// O que não deu para ler vira aviso com o número da linha — nada some calado.
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

export interface PontoCota { nome: string; e: number; n: number; z: number; descricao?: string }

export interface LeituraPontos {
  pontos: PontoCota[];
  /** colunas reconhecidas, para mostrar "nome · E · N · cota" */
  colunas: string;
  /** fuso deduzido (lat/lon) — null quando o arquivo já vem em UTM */
  fuso: number | null;
  avisos: string[];
  ignoradas: { linha: number; texto: string; motivo: string }[];
}

type Papel = "nome" | "e" | "n" | "z" | "lat" | "lon" | "desc";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const CABECALHO: [Papel, RegExp][] = [
  ["nome", /^(nome|ponto|pt|pto|id|n[ºo°]|num(ero)?|estaca|name|point)$/],
  ["e", /^(e|este|leste|x|coord_?e|east(ing)?|e\s*\(m\)|x\s*\(m\))$/],
  ["n", /^(n|norte|y|coord_?n|north(ing)?|n\s*\(m\)|y\s*\(m\))$/],
  ["z", /^(z|h|cota|alt(itude)?|elev(acao|ation)?|cota\s*\(m\)|z\s*\(m\)|h\s*\(m\)|altura|rn)$/],
  ["lat", /^(lat(itude)?)$/],
  ["lon", /^(lon(g|gitude)?|lng)$/],
  ["desc", /^(desc(ricao)?|cod(igo)?|obs|code|description|tipo)$/],
];

function papelDoTitulo(t: string): Papel | null {
  const s = semAcento(t).replace(/["']/g, "");
  for (const [p, re] of CABECALHO) if (re.test(s)) return p;
  return null;
}

/** Número em notação brasileira ou internacional ("1.234,56", "1234.56", "1234,56"). */
export function lerNumero(s: string, decimalVirgula: boolean): number {
  let t = s.trim().replace(/\s+/g, "");
  if (!t) return NaN;
  if (!/^[+-]?[\d.,]+([eE][+-]?\d+)?$/.test(t)) return NaN;
  if (decimalVirgula) t = t.replace(/\./g, "").replace(",", ".");
  else if (/,\d{3}(\.|$)/.test(t) && /\./.test(t)) t = t.replace(/,/g, "");
  else t = t.replace(",", ".");
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

function separadorDe(linhas: string[]): { sep: RegExp | string; decimalVirgula: boolean } {
  const amostra = linhas.slice(0, 60);
  const conta = (c: string) => amostra.reduce((s, l) => s + (l.split(c).length - 1), 0) / Math.max(1, amostra.length);
  const tab = conta("\t"), pv = conta(";"), vg = conta(",");
  // vírgula decimal: decide pelas células que parecem número ("512003,123"), não
  // pela linha inteira — a descrição "cerca, muro, poste" também tem vírgulas
  const decimalDasCelulas = (sep: string) => {
    let comVirgula = 0, comPonto = 0;
    for (const l of amostra) for (const c of l.split(sep)) {
      const t = c.trim().replace(/^"(.*)"$/, "$1");
      if (/^[+-]?\d+,\d+$/.test(t)) comVirgula++;
      else if (/^[+-]?\d+\.\d+$/.test(t)) comPonto++;
    }
    return comVirgula > comPonto;
  };
  if (tab >= 2) return { sep: "\t", decimalVirgula: decimalDasCelulas("\t") };
  if (pv >= 2) return { sep: ";", decimalVirgula: decimalDasCelulas(";") };
  // vírgula como separador quando cada linha tem 2+ vírgulas e números com ponto
  if (vg >= 2 && amostra.some((l) => /\d\.\d/.test(l))) return { sep: ",", decimalVirgula: false };
  if (vg >= 3) {
    // "1,5000,000,8590000,000,102,350": vírgula decimal separada por espaço? sem espaço não dá para saber
    return { sep: ",", decimalVirgula: false };
  }
  return { sep: /\s+/, decimalVirgula: vg >= 1 };
}

const ehE = (v: number) => v >= 100000 && v <= 900000;
const ehN = (v: number) => v >= 1000000 && v <= 10000000;
/** N do hemisfério norte (Roraima, Amapá): de 0 a ~600 km do equador */
const ehNNorte = (v: number) => v >= 10000 && v < 1000000;
const MSG_NORTE = "As coordenadas parecem do hemisfério norte (N abaixo de 1.000.000, como em Roraima e no Amapá). A terraplanagem ainda só aceita UTM do hemisfério sul: exporte o levantamento em latitude e longitude, que ele é convertido certo.";
const ehZ = (v: number) => v > -100 && v < 6000;
const ehLat = (v: number) => v >= -35 && v <= 6 && !Number.isInteger(v);
const ehLon = (v: number) => v >= -75 && v <= -28 && !Number.isInteger(v);

export const MSG_SEM_ALTITUDE = "O arquivo não tem a cota (altitude) dos pontos: muitas cotas 0,000. Exporte o levantamento com a altitude.";
export const MSG_SEM_DESNIVEL = "Todas as cotas do arquivo são iguais (desnível zero): confira se o levantamento saiu com a altitude dos pontos.";

/**
 * A regra das cotas 0,000, num lugar só (leitor próprio e leitor universal):
 * 20% ou mais dos pontos a 0,000 é arquivo sem altitude (recusa); menos que
 * isso, os zeros são pontos sem altitude medida e saem com aviso. Desnível
 * menor que 1 cm também avisa (terreno sem cota não pode passar por "pronto").
 */
export function filtrarCotasZero<T extends { z: number }>(pontos: T[]): { pontos: T[]; descartados: T[]; avisos: string[]; recusa: string | null } {
  if (!pontos.length) return { pontos, descartados: [], avisos: [], recusa: null };
  const zeros = pontos.filter((p) => p.z === 0);
  if (zeros.length / pontos.length >= 0.2) return { pontos: [], descartados: zeros, avisos: [], recusa: MSG_SEM_ALTITUDE };
  const fica = zeros.length ? pontos.filter((p) => p.z !== 0) : pontos;
  const avisos: string[] = [];
  if (zeros.length) avisos.push(`${zeros.length} ponto(s) com cota 0,000 ficaram de fora: parece altitude que não foi medida.`);
  if (fica.length >= 3 && desnivelDe(fica) < 0.01) avisos.push(MSG_SEM_DESNIVEL);
  return { pontos: fica, descartados: zeros, avisos, recusa: null };
}

/** Diferença entre a maior e a menor cota. */
export function desnivelDe(pontos: { z: number }[]): number {
  let a = Infinity, b = -Infinity;
  for (const p of pontos) { if (p.z < a) a = p.z; if (p.z > b) b = p.z; }
  return pontos.length ? b - a : 0;
}

export function lerPontos(texto: string): LeituraPontos {
  const brutas = texto.replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const avisos: string[] = [];
  const ignoradas: LeituraPontos["ignoradas"] = [];
  const linhas = brutas.map((t, i) => ({ t: t.trim(), i: i + 1 })).filter((l) => l.t && !/^(#|\/\/|;|--)/.test(l.t));
  if (!linhas.length) return { pontos: [], colunas: "", fuso: null, avisos: ["O arquivo está vazio."], ignoradas };
  const { sep, decimalVirgula } = separadorDe(linhas.map((l) => l.t));
  const dividir = (s: string) => s.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));

  // cabeçalho: a primeira linha com 2+ títulos conhecidos (até a 10ª)
  let mapa: Partial<Record<Papel, number>> | null = null;
  let inicio = 0;
  for (let k = 0; k < Math.min(10, linhas.length); k++) {
    const cels = dividir(linhas[k].t);
    const m: Partial<Record<Papel, number>> = {};
    cels.forEach((c, i) => { const p = papelDoTitulo(c); if (p && m[p] === undefined) m[p] = i; });
    const conhecidos = Object.keys(m).length;
    if (conhecidos >= 2 && ((m.e !== undefined && m.n !== undefined) || (m.lat !== undefined && m.lon !== undefined) || m.z !== undefined)) {
      mapa = m; inicio = k + 1; break;
    }
  }

  const tabela = linhas.slice(inicio).map((l) => ({ ...l, cels: dividir(l.t) }));
  const nums = (cels: string[]) => cels.map((c) => lerNumero(c, decimalVirgula));

  // sem cabeçalho (ou cabeçalho sem E/N/cota): deduz pela faixa dos números
  if (!mapa || (mapa.e === undefined && mapa.lat === undefined) || mapa.z === undefined) {
    const amostra = tabela.slice(0, 200).map((l) => nums(l.cels));
    const ncol = Math.max(0, ...amostra.map((a) => a.length));
    const frac = (i: number, f: (v: number) => boolean) => {
      let s = 0, c = 0;
      for (const a of amostra) { if (i < a.length) { c++; if (f(a[i])) s++; } }
      return c ? s / c : 0;
    };
    const m: Partial<Record<Papel, number>> = { ...(mapa ?? {}) };
    const livres = () => Array.from({ length: ncol }, (_, i) => i).filter((i) => !Object.values(m).includes(i));
    const melhor = (f: (v: number) => boolean) => {
      let b = -1, bf = 0.6;
      for (const i of livres()) { const v = frac(i, f); if (v > bf) { bf = v; b = i; } }
      return b;
    };
    if (m.e === undefined && m.n === undefined) {
      const e = melhor(ehE); if (e >= 0) m.e = e;
      const n = melhor(ehN); if (n >= 0) m.n = n;
      if (m.e !== undefined && m.n === undefined && melhor(ehNNorte) >= 0) {
        return { pontos: [], colunas: "", fuso: null, ignoradas, avisos: [MSG_NORTE] };
      }
      if (m.e === undefined || m.n === undefined) {
        delete m.e; delete m.n;
        const la = melhor(ehLat); if (la >= 0) m.lat = la;
        const lo = melhor(ehLon); if (lo >= 0) m.lon = lo;
      }
    }
    if (m.z === undefined) {
      // a cota: a coluna numérica de faixa de cota com mais casas decimais, à direita do E/N
      const ref = Math.max(m.e ?? -1, m.n ?? -1, m.lat ?? -1, m.lon ?? -1);
      const cands = livres().filter((i) => frac(i, (v) => Number.isFinite(v) && ehZ(v)) > 0.6);
      const depois = cands.filter((i) => i > ref);
      // só depois das coordenadas: antes delas vem o nome (que também é número pequeno)
      const z = ref >= 0 ? depois[0] : cands[0];
      if (z !== undefined) m.z = z;
    }
    if (m.nome === undefined) {
      // primeira coluna que não é número (ou de inteiros) antes do E
      const cands = livres().filter((i) => i < Math.min(m.e ?? m.lon ?? ncol, m.n ?? m.lat ?? ncol));
      if (cands.length) m.nome = cands[0];
    }
    mapa = m;
  }

  const temUtm = mapa.e !== undefined && mapa.n !== undefined;
  const temGeo = !temUtm && mapa.lat !== undefined && mapa.lon !== undefined;
  if ((!temUtm && !temGeo) || mapa.z === undefined) {
    return {
      pontos: [], colunas: "", fuso: null, ignoradas,
      avisos: [temUtm || temGeo
        ? "Não achei a coluna da cota. O arquivo precisa ter nome, E, N e cota (Z) de cada ponto."
        : "Não achei as colunas de coordenada (E e N em UTM, ou latitude e longitude). Confira se o arquivo é o do levantamento com cota."],
    };
  }

  // lat/lon: o fuso sai da longitude média
  let fuso: number | null = null;
  if (temGeo) {
    const lons = tabela.map((l) => lerNumero(l.cels[mapa!.lon!] ?? "", decimalVirgula)).filter(Number.isFinite);
    const lonMed = lons.reduce((s, v) => s + v, 0) / Math.max(1, lons.length);
    fuso = Math.min(25, Math.max(18, Math.floor((lonMed + 180) / 6) + 1));
  }
  const ud = fuso ? utmDef(fuso) : null;

  const pontos: PontoCota[] = [];
  const nomes = new Map<string, number>();
  let semNome = 0;
  for (const l of tabela) {
    const v = nums(l.cels);
    const z = v[mapa.z!];
    let e: number, n: number;
    if (temUtm) { e = v[mapa.e!]; n = v[mapa.n!]; }
    else {
      const lat = v[mapa.lat!], lon = v[mapa.lon!];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) { e = NaN; n = NaN; }
      else [e, n] = proj(GEO_DEF, ud!, [lon, lat]);
    }
    if (!Number.isFinite(e) || !Number.isFinite(n) || !Number.isFinite(z)) {
      ignoradas.push({ linha: l.i, texto: l.t.slice(0, 80), motivo: !Number.isFinite(z) ? "sem cota" : "sem coordenada" });
      continue;
    }
    if (temUtm && (!ehE(e) || !ehN(n))) {
      ignoradas.push({ linha: l.i, texto: l.t.slice(0, 80), motivo: "coordenada fora da faixa de UTM" });
      continue;
    }
    if (!ehZ(z)) { ignoradas.push({ linha: l.i, texto: l.t.slice(0, 80), motivo: "cota fora da faixa (−100 a 6000 m)" }); continue; }
    let nome = mapa.nome !== undefined ? (l.cels[mapa.nome] ?? "").trim() : "";
    if (!nome) nome = `P${++semNome}`;
    const rep = nomes.get(nome) ?? 0;
    nomes.set(nome, rep + 1);
    if (rep) nome = `${nome}-${rep + 1}`;
    const desc = mapa.desc !== undefined ? (l.cels[mapa.desc] ?? "").trim() : "";
    pontos.push({ nome, e, n, z, ...(desc ? { descricao: desc } : {}) });
  }

  if (temUtm && !pontos.length) {
    const linhasN = tabela.map((l) => nums(l.cels)).filter((v) => ehE(v[mapa!.e!]) && ehNNorte(v[mapa!.n!]));
    if (linhasN.length && linhasN.length >= tabela.length * 0.6) return { pontos: [], colunas: "", fuso: null, ignoradas, avisos: [MSG_NORTE] };
  }

  // pontos com cota zero quase sempre são "sem cota" (coletora sem altitude)
  const zc = filtrarCotasZero(pontos);
  if (zc.recusa) return { pontos: [], colunas: "", fuso: null, ignoradas, avisos: [zc.recusa] };
  for (const p of zc.descartados) ignoradas.push({ linha: 0, texto: p.nome, motivo: "cota 0,000" });
  avisos.push(...zc.avisos);
  const validos = zc.pontos;

  // ponto muito longe do resto (digitação errada) — avisa, não tira
  if (validos.length >= 10) {
    const es = validos.map((p) => p.e).sort((a, b) => a - b), ns = validos.map((p) => p.n).sort((a, b) => a - b);
    const me = es[Math.floor(es.length / 2)], mn = ns[Math.floor(ns.length / 2)];
    const ds = validos.map((p) => Math.hypot(p.e - me, p.n - mn)).sort((a, b) => a - b);
    const d90 = ds[Math.floor(ds.length * 0.9)];
    const longe = validos.filter((p) => Math.hypot(p.e - me, p.n - mn) > Math.max(50, d90 * 6));
    if (longe.length) avisos.push(`${longe.length === 1 ? `O ponto ${longe[0].nome} está` : `${longe.length} pontos estão`} muito longe dos outros: confira a coordenada${longe.length === 1 ? "" : " deles"}.`);
  }

  const nomesCol = [mapa.nome !== undefined ? "nome" : null, temUtm ? "E" : "latitude", temUtm ? "N" : "longitude", "cota", mapa.desc !== undefined ? "descrição" : null].filter(Boolean).join(" · ");
  if (temGeo) avisos.push(`Coordenadas em latitude/longitude: convertidas para UTM no fuso ${fuso}.`);
  if (ignoradas.filter((x) => x.linha).length) {
    const n = ignoradas.filter((x) => x.linha).length;
    avisos.push(`${n} linha(s) não entraram (${[...new Set(ignoradas.map((x) => x.motivo))].join(", ")}).`);
  }
  return { pontos: validos, colunas: nomesCol, fuso, avisos, ignoradas };
}
