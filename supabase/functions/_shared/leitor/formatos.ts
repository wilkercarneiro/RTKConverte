// Extratores de formatos que não são "um ponto por linha". Cada um produz a
// mesma Tabela do executor, com as células na ordem de PAPEIS, o valor já
// normalizado (decimal ".") e — para a prova de procedência (V1) — o trecho
// BRUTO do arquivo e a linha de onde cada valor saiu.
//
// Nenhum extrator inventa coordenada: o que não está no arquivo fica vazio e o
// validador aponta (ex.: KML sem altitude real, DXF sem σ).
import { APOIO_PADRAO, PAPEIS, camposVazios } from "./receita.ts";
import type { Papel, Receita, Registro } from "./receita.ts";
import type { Aviso, LinhaIgnorada, LinhaTabela, Tabela } from "./executor.ts";
import { lerAngulo, lerNumero } from "./numeros.ts";
import { LIMITES } from "../geo.ts";

const COL = Object.fromEntries(PAPEIS.map((p, i) => [p, i])) as Record<Papel, number>;

interface Cel { valor: string; bruto: string; linha: number }

/** Mapa offset → linha (1-based) do texto unido por "\n". */
function indiceDeLinhas(linhas: string[]): { texto: string; linhaDe: (off: number) => number } {
  const inicios: number[] = [];
  let acc = 0;
  for (const l of linhas) { inicios.push(acc); acc += l.length + 1; }
  const texto = linhas.join("\n");
  const linhaDe = (off: number) => {
    let lo = 0, hi = inicios.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (inicios[m] <= off) lo = m; else hi = m - 1; }
    return lo + 1;
  };
  return { texto, linhaDe };
}

function montarLinha(cels: Partial<Record<Papel, Cel>>, linhas: string[]): LinhaTabela {
  const celulas = PAPEIS.map((p) => cels[p]?.valor ?? "");
  const brutos = PAPEIS.map((p) => cels[p]?.bruto ?? null);
  const linhasCel = PAPEIS.map((p) => cels[p]?.linha ?? null);
  const linha = Math.min(...linhasCel.filter((x): x is number => x !== null));
  return { linha, texto: linhas[linha - 1] ?? "", celulas, brutos, linhas: linhasCel };
}

/** Receita dos extratores: células na ordem de PAPEIS, decimal ".". */
export function receitaDoFormato(registro: Registro, extra: Partial<Receita> = {}): Receita {
  const campos = camposVazios();
  for (const p of PAPEIS) campos[p] = COL[p];
  const nomes: Partial<Record<Registro, string>> = {
    gsi: "Leica GSI", chave_valor: "relatório chave → valor (IBGE-PPP)", xml: "XML (KML/GPX/LandXML/JobXML)",
    geojson: "GeoJSON", dxf: "DXF", texto_livre: "texto livre (memorial/relatório)",
  };
  return {
    versao: 1, registro, pular_inicio: 0, ignorar: [], tokenizacao: "delimitado", delimitador: ";",
    colunas: null, excedente_em: null, cortes: null, regex: null, decimal: ".", campos,
    sistema: "utm", fuso: null, hemisferio: "S", unidade_sigma: "m", confianca_sigma: "1sigma",
    nome_formato: "texto", ordem: "auto", apoio: [...APOIO_PADRAO], origem: "regras",
    explicacao: `Arquivo no formato ${nomes[registro] ?? registro}.`,
    ...extra,
  };
}

/** Número de texto livre: "8.658.085,635", "491199,57", "497318.611". */
function numeroLivre(bruto: string): number | null {
  const t = bruto.replace(/\s/g, "");
  if (/,/.test(t)) return lerNumero(t, ",");
  if (/^\d{1,3}(\.\d{3}){2,}$/.test(t)) return lerNumero(t, ",");
  return lerNumero(t, ".");
}
const fmt = (v: number) => String(v);

// ---------------------------------------------------------------------------
// Leica GSI-8 / GSI-16
// ---------------------------------------------------------------------------

const RE_GSI_PALAVRA = /\*?(\d{2})([0-9.]{4})([+-])([0-9A-Za-z?_.\-]+)/g;
const CASAS_GSI: Record<string, number> = { "0": 3, "6": 4, "8": 5 };

export function pareceGsi(linhas: string[]): boolean {
  const amostra = linhas.filter((l) => l.trim()).slice(0, 30);
  if (!amostra.length) return false;
  const ok = amostra.filter((l) => /^\*?(11|41|21|31|81|82|83|84|85|86|87|88|71)[0-9.]{4}[+-]/.test(l.trim()));
  return ok.length >= amostra.length * 0.8 && amostra.some((l) => /(^|\s)\*?8[12][0-9.]{4}[+-]/.test(l));
}

function tabelaGsi(linhas: string[]): Tabela {
  const tabela: Tabela = { linhas: [], ignoradas: [], avisos: [] };
  const pes: number[] = [];
  linhas.forEach((texto, i) => {
    const linha = i + 1;
    if (!texto.trim()) return;
    const palavras = [...texto.matchAll(RE_GSI_PALAVRA)];
    const por = new Map<string, RegExpMatchArray>();
    for (const w of palavras) if (!por.has(w[1])) por.set(w[1], w);
    if (!por.has("81") || !por.has("82")) {
      const motivo = por.has("84") ? "estação ocupada (coordenada do instrumento)" : "registro GSI sem coordenada de ponto (observação/cabeçalho)";
      tabela.ignoradas.push({ linha, texto, motivo, tipo: "padrao" });
      return;
    }
    const cels: Partial<Record<Papel, Cel>> = {};
    let ruim = false;
    const coord = (wi: string, papel: Papel) => {
      const w = por.get(wi);
      if (!w) return;
      const unidade = w[2][3];
      const casas = CASAS_GSI[unidade];
      if (casas === undefined) { ruim = true; pes.push(linha); return; }
      const dig = w[4].replace(/^0+(?=\d)/, "");
      if (!/^\d+$/.test(dig)) { ruim = true; return; }
      const v = (w[3] === "-" ? -1 : 1) * Number(dig) / 10 ** casas;
      cels[papel] = { valor: v.toFixed(casas), bruto: `${w[3]}${w[4]}`, linha };
    };
    coord("81", "e"); coord("82", "n"); coord("83", "h");
    if (ruim) { tabela.ignoradas.push({ linha, texto, motivo: "unidade GSI não métrica ou valor inválido", tipo: "ilegivel" }); return; }
    const w11 = por.get("11");
    if (w11) cels.nome = { valor: w11[4].replace(/^0+(?=.)/, ""), bruto: w11[4], linha };
    const w71 = por.get("71");
    if (w71) cels.codigo = { valor: w71[4].replace(/^0+(?=.)/, ""), bruto: w71[4], linha };
    tabela.linhas.push(montarLinha(cels, linhas));
  });
  if (pes.length) tabela.avisos.push({ codigo: "gsi_unidade", nivel: "alerta", mensagem: "Registros GSI em pés não foram lidos: exporte em metros.", linhas: pes });
  return tabela;
}

// ---------------------------------------------------------------------------
// Relatório chave → valor (IBGE-PPP .txt e semelhantes)
// ---------------------------------------------------------------------------

const CHAVES: [RegExp, Papel][] = [
  [/^(ESTACAO|ESTAÇÃO|STATION|NOME|MARCO|PONTO|MARKER|SITE)$/i, "nome"],
  [/^(UTME|UTM_E|E_UTM|ESTE)$/i, "e"],
  [/^(UTMN|UTM_N|N_UTM|NORTE)$/i, "n"],
  [/^(LAT|LATITUDE)$/i, "lat"],
  [/^(LON|LONG|LONGITUDE)$/i, "lon"],
  [/^(HGEO|H_GEO|ALT_GEO|H_ELIP|ALTITUDE_GEOMETRICA|ALTITUDE_ELIPSOIDAL)$/i, "h"],
  [/^(SLAT|SIGMA_LAT)$/i, "sigma_n"],
  [/^(SLON|SIGMA_LON)$/i, "sigma_e"],
  [/^(SHGEO|SIGMA_H|SIGMA_HGEO)$/i, "sigma_h"],
];

export function pareceChaveValor(linhas: string[]): boolean {
  const chaves = new Set<string>();
  for (const l of linhas.slice(0, 200)) {
    const m = l.match(/^\s*([A-Za-zÇçÃã_]+)\s*[:=]?\s+\S/);
    if (m) for (const [re, p] of CHAVES) if (re.test(m[1])) chaves.add(p);
  }
  return (chaves.has("lat") && chaves.has("lon")) || (chaves.has("e") && chaves.has("n"));
}

function tabelaChaveValor(linhas: string[]): { tabela: Tabela; consumidas: Set<number> } {
  const tabela: Tabela = { linhas: [], ignoradas: [], avisos: [] };
  let atual: Partial<Record<Papel, Cel>> = {};
  const consumidas = new Set<number>();
  const fechar = () => {
    if ((atual.e && atual.n) || (atual.lat && atual.lon)) tabela.linhas.push(montarLinha(atual, linhas));
    atual = {};
  };
  linhas.forEach((texto, i) => {
    const linha = i + 1;
    if (!texto.trim()) return;
    const m = texto.match(/^\s*([A-Za-zÇçÃã_]+)\s*[:=]?\s+(.+?)\s*$/);
    const papel = m ? CHAVES.find(([re]) => re.test(m[1]))?.[1] : undefined;
    if (!m || !papel) { tabela.ignoradas.push({ linha, texto, motivo: "campo do relatório que não é coordenada", tipo: "padrao" }); return; }
    if (atual[papel]) fechar();
    const bruto = m[2];
    let valor: string | null;
    if (papel === "lat" || papel === "lon") {
      const a = lerAngulo(bruto, papel);
      valor = a ? String(a.graus) : null;
    } else if (papel === "nome") valor = bruto.trim();
    else { const v = numeroLivre(bruto.replace(/\s*m$/i, "")); valor = v === null ? null : fmt(v); }
    if (valor === null) { tabela.ignoradas.push({ linha, texto, motivo: `valor de ${m[1]} não lido`, tipo: "ilegivel" }); return; }
    atual[papel] = { valor, bruto, linha };
    consumidas.add(linha);
  });
  fechar();
  return { tabela, consumidas };
}

// ---------------------------------------------------------------------------
// XML: KML, GPX, LandXML, Trimble JobXML
// ---------------------------------------------------------------------------

export function pareceXml(linhas: string[]): boolean {
  const ini = linhas.slice(0, 5).join(" ").trim();
  return /^<\?xml|^<(kml|gpx|LandXML|JOBFile)\b/i.test(ini);
}

const desescapar = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&").trim();

function tabelaXml(linhas: string[]): { tabela: Tabela; extra: Partial<Receita> } {
  const { texto, linhaDe } = indiceDeLinhas(linhas);
  const tabela: Tabela = { linhas: [], ignoradas: [], avisos: [] };
  const num = (bruto: string, off: number): Cel | null => {
    const v = lerNumero(bruto.trim(), ".");
    return v === null ? null : { valor: fmt(v), bruto: bruto.trim(), linha: linhaDe(off) };
  };
  const push = (c: Partial<Record<Papel, Cel>>) => { if ((c.e && c.n) || (c.lat && c.lon)) tabela.linhas.push(montarLinha(c, linhas)); };

  // ---- Trimble JobXML ----
  if (/<JOBFile\b/i.test(texto)) {
    for (const m of texto.matchAll(/<PointRecord\b[\s\S]*?<\/PointRecord>/gi)) {
      const bloco = m[0], base = m.index!;
      if (/<Deleted>\s*true\s*<\/Deleted>/i.test(bloco)) continue;
      const tag = (t: string, dentro = bloco, b0 = base): Cel | null => {
        const r = new RegExp(`<${t}>([^<]*)</${t}>`, "i").exec(dentro);
        if (!r || !r[1].trim()) return null;
        return { valor: desescapar(r[1]), bruto: r[1].trim(), linha: linhaDe(b0 + r.index + r[0].indexOf(r[1])) };
      };
      const g = /<Grid>([\s\S]*?)<\/Grid>/i.exec(bloco);
      const c: Partial<Record<Papel, Cel>> = {};
      const nome = tag("Name"); if (nome) c.nome = nome;
      const cod = tag("Code"); if (cod) c.codigo = cod;
      if (g) {
        const gb = base + g.index + g[0].indexOf(g[1]);
        for (const [t, p] of [["North", "n"], ["East", "e"], ["Elevation", "h"]] as const) {
          const x = tag(t, g[1], gb);
          const v = x ? num(x.bruto, 0) : null;
          if (x && v) c[p] = { ...x, valor: v.valor };
        }
      }
      if (!c.e) {
        const w = /<WGS84>([\s\S]*?)<\/WGS84>/i.exec(bloco);
        if (w) {
          const wb = base + w.index + w[0].indexOf(w[1]);
          const la = tag("Latitude", w[1], wb), lo = tag("Longitude", w[1], wb), hh = tag("Height", w[1], wb);
          if (la && lo) { c.lat = la; c.lon = lo; }
          if (hh && !c.h) c.h = hh;
        }
      }
      push(c);
    }
    return { tabela, extra: { explicacao: "Trimble JobXML: pontos com nome, código e coordenadas da grade (N, E, cota)." } };
  }

  // ---- LandXML ----
  if (/<LandXML\b/i.test(texto)) {
    for (const m of texto.matchAll(/<CgPoint\b([^>]*)>([^<]*)<\/CgPoint>/gi)) {
      const attrs = m[1], corpo = m[2];
      const off = m.index! + m[0].indexOf(">") + 1;
      const toks = [...corpo.matchAll(/\S+/g)];
      if (toks.length < 2) continue;
      const c: Partial<Record<Papel, Cel>> = {};
      // LandXML: "northing easting [elevation]"
      const n = num(toks[0][0], off + toks[0].index!), e = num(toks[1][0], off + toks[1].index!);
      if (!n || !e) continue;
      c.n = n; c.e = e;
      if (toks[2]) { const h = num(toks[2][0], off + toks[2].index!); if (h) c.h = h; }
      const nm = /\bname="([^"]*)"/i.exec(attrs);
      if (nm) c.nome = { valor: desescapar(nm[1]), bruto: nm[1], linha: linhaDe(m.index!) };
      const cd = /\b(code|desc)="([^"]*)"/i.exec(attrs);
      if (cd && cd[2].trim()) c.codigo = { valor: desescapar(cd[2]), bruto: cd[2], linha: linhaDe(m.index!) };
      push(c);
    }
    return { tabela, extra: { explicacao: "LandXML: pontos CgPoint (norte, este, cota)." } };
  }

  // ---- GPX ----
  if (/<gpx\b/i.test(texto)) {
    const tipo = /<wpt\b/i.test(texto) ? "wpt" : /<rtept\b/i.test(texto) ? "rtept" : "trkpt";
    const re = new RegExp(`<${tipo}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tipo}>)`, "gi");
    for (const m of texto.matchAll(re)) {
      const attrs = m[1], corpo = m[2] ?? "", base = m.index!;
      const la = /\blat="([^"]+)"/i.exec(attrs), lo = /\blon="([^"]+)"/i.exec(attrs);
      if (!la || !lo) continue;
      const c: Partial<Record<Papel, Cel>> = {
        lat: { valor: la[1], bruto: la[1], linha: linhaDe(base + m[0].indexOf(la[0])) },
        lon: { valor: lo[1], bruto: lo[1], linha: linhaDe(base + m[0].indexOf(lo[0])) },
      };
      const cb = base + m[0].indexOf(corpo);
      const ele = /<ele>([^<]+)<\/ele>/i.exec(corpo);
      if (ele) { const h = num(ele[1], cb + ele.index); if (h) c.h = h; }
      const nm = /<name>([\s\S]*?)<\/name>/i.exec(corpo);
      if (nm) c.nome = { valor: desescapar(nm[1]), bruto: nm[1].trim(), linha: linhaDe(cb + nm.index) };
      push(c);
    }
    if (tipo !== "wpt") tabela.avisos.push({ codigo: "gpx_trilha", nivel: "alerta", mensagem: "O GPX não tem waypoints: foram lidos os pontos da trilha/rota. Confira se são os vértices." });
    return { tabela, extra: { sistema: "geografica", explicacao: `GPX: ${tipo === "wpt" ? "waypoints" : "pontos de trilha"} com latitude, longitude e altitude.` } };
  }

  // ---- KML ----
  if (/<kml\b/i.test(texto)) {
    const pontos: Partial<Record<Papel, Cel>>[] = [];
    const aneis: { nome: Cel | null; coords: { lat: Cel; lon: Cel; h: Cel | null }[] }[] = [];
    for (const m of texto.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/gi)) {
      const bloco = m[0], base = m.index!;
      const nm = /<name>([\s\S]*?)<\/name>/i.exec(bloco);
      const nome = nm && desescapar(nm[1]) ? { valor: desescapar(nm[1]), bruto: nm[1].trim(), linha: linhaDe(base + nm.index) } : null;
      const coordBlocos = [...bloco.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
      for (const cb of coordBlocos) {
        const cbase = base + cb.index! + cb[0].indexOf(cb[1]);
        const tuplas = [...cb[1].matchAll(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(-?\d+(?:\.\d+)?))?/g)].map((t) => {
          const o = cbase + t.index!;
          const lon = { valor: t[1], bruto: t[1], linha: linhaDe(o) };
          const lat = { valor: t[2], bruto: t[2], linha: linhaDe(o + t[0].indexOf(t[2], t[1].length)) };
          const h = t[3] ? { valor: t[3], bruto: t[3], linha: linhaDe(o + t[0].lastIndexOf(t[3])) } : null;
          return { lat, lon, h };
        });
        const ehPonto = /<Point\b/i.test(bloco) && tuplas.length === 1;
        if (ehPonto) pontos.push({ ...(nome ? { nome } : {}), lat: tuplas[0].lat, lon: tuplas[0].lon, ...(tuplas[0].h ? { h: tuplas[0].h } : {}) });
        else if (tuplas.length >= 3) aneis.push({ nome, coords: tuplas });
      }
    }
    let usados: Partial<Record<Papel, Cel>>[];
    if (pontos.length >= 3) {
      usados = pontos;
      if (aneis.length) tabela.avisos.push({ codigo: "kml_pontos", nivel: "info", mensagem: "O KML tem pontos e polígono: foram usados os pontos (com nome)." });
    } else if (aneis.length) {
      const maior = aneis.reduce((a, b) => (b.coords.length > a.coords.length ? b : a));
      let cs = maior.coords;
      const f = cs[0], l = cs[cs.length - 1];
      if (cs.length > 3 && f.lat.valor === l.lat.valor && f.lon.valor === l.lon.valor) cs = cs.slice(0, -1);
      usados = cs.map((c) => ({ lat: c.lat, lon: c.lon, ...(c.h ? { h: c.h } : {}) }));
      tabela.avisos.push({ codigo: "kml_poligono", nivel: "info", mensagem: `Lidos os vértices do polígono${maior.nome ? ` "${maior.nome.valor}"` : ""} do KML (sem nome: numerados na ordem do desenho).` });
    } else usados = pontos;
    // KML do Google Earth vem com altitude 0 (colado ao chão): não é altitude medida
    if (usados.length && usados.every((c) => !c.h || Number(c.h.valor) === 0)) {
      for (const c of usados) delete c.h;
      if (usados.length) tabela.avisos.push({ codigo: "kml_sem_altitude", nivel: "alerta", mensagem: "As altitudes do KML são zero (desenho colado ao chão): não são altitude medida e foram descartadas." });
    }
    for (const c of usados) push(c);
    return { tabela, extra: { sistema: "geografica", explicacao: "KML: coordenadas geográficas (WGS84) dos pontos ou do polígono." } };
  }
  return { tabela, extra: {} };
}

// ---------------------------------------------------------------------------
// GeoJSON
// ---------------------------------------------------------------------------

export function pareceGeoJson(linhas: string[]): boolean {
  const ini = linhas.slice(0, 20).join(" ");
  return /^\s*\{/.test(ini) && /"type"\s*:\s*"(FeatureCollection|Feature|Point|Polygon|MultiPoint|LineString)"/.test(ini + linhas.slice(20, 200).join(" "));
}

interface NumPos { v: number; bruto: string; off: number }
type Aninhado = NumPos | Aninhado[];

function lerArrayCoord(texto: string, ini: number): { valor: Aninhado; fim: number } | null {
  const re = /\s*(\[|\]|,|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/y;
  re.lastIndex = ini;
  const pilha: Aninhado[][] = [];
  let raiz: Aninhado[] | null = null;
  for (;;) {
    const m = re.exec(texto);
    if (!m) return null;
    const t = m[1];
    if (t === "[") { const novo: Aninhado[] = []; if (pilha.length) pilha[pilha.length - 1].push(novo); else raiz = novo; pilha.push(novo); }
    else if (t === "]") { pilha.pop(); if (!pilha.length) return { valor: raiz!, fim: re.lastIndex }; }
    else if (t !== ",") { if (!pilha.length) return null; pilha[pilha.length - 1].push({ v: Number(t), bruto: t, off: re.lastIndex - t.length }); }
  }
}

function tabelaGeoJson(linhas: string[]): Tabela {
  const { texto, linhaDe } = indiceDeLinhas(linhas);
  const tabela: Tabela = { linhas: [], ignoradas: [], avisos: [] };
  let nomes: (string | null)[] = [];
  try {
    const j = JSON.parse(texto);
    const feats = j.type === "FeatureCollection" ? j.features : j.type === "Feature" ? [j] : [{ geometry: j, properties: {} }];
    nomes = feats.map((f: { properties?: Record<string, unknown> }) => {
      const p = f.properties ?? {};
      const k = Object.keys(p).find((x) => /^(name|nome|id|ponto|vertice|label|codigo)$/i.test(x));
      return k && p[k] !== null && p[k] !== undefined ? String(p[k]) : null;
    });
  } catch {
    tabela.avisos.push({ codigo: "geojson_invalido", nivel: "bloqueio", mensagem: "O GeoJSON não é um JSON válido." });
    return tabela;
  }
  const geoms: Aninhado[] = [];
  for (const m of texto.matchAll(/"coordinates"\s*:/g)) {
    const r = lerArrayCoord(texto, m.index! + m[0].length);
    if (r) geoms.push(r.valor);
  }
  const ehPos = (a: Aninhado): a is NumPos[] => Array.isArray(a) && a.length >= 2 && a.every((x) => !Array.isArray(x));
  const pontos: { pos: NumPos[]; nome: string | null }[] = [];
  const aneis: NumPos[][][] = [];
  geoms.forEach((g, k) => {
    if (ehPos(g)) pontos.push({ pos: g, nome: nomes[k] ?? null });
    else if (Array.isArray(g)) {
      // LineString [[x,y]…], Polygon [[[x,y]…]], MultiPolygon [[[[x,y]…]]]: desce até a lista de posições
      let a: Aninhado = g;
      while (Array.isArray(a) && a.length && Array.isArray(a[0]) && !ehPos(a[0])) a = a[0];
      if (Array.isArray(a) && a.length >= 3 && a.every((x) => ehPos(x))) aneis.push(a as NumPos[][]);
    }
  });
  const cel = (x: NumPos): Cel => ({ valor: String(x.v), bruto: x.bruto, linha: linhaDe(x.off) });
  if (pontos.length >= 3) {
    // o nome é procurado no texto, em ordem (as features vêm na ordem do arquivo)
    let cursor = 0;
    for (const p of pontos) {
      const c: Partial<Record<Papel, Cel>> = { lon: cel(p.pos[0]), lat: cel(p.pos[1]) };
      if (p.pos[2]) c.h = cel(p.pos[2]);
      if (p.nome) {
        const lit = JSON.stringify(p.nome).slice(1, -1);
        const re = new RegExp(`"(?:name|nome|id|ponto|vertice|label|codigo)"\\s*:\\s*"?${lit.replace(/[.*+?^${}()|[\]\\]/gi, "\\$&")}"?`, "gi");
        re.lastIndex = cursor;
        const m = re.exec(texto);
        if (m) {
          cursor = m.index + m[0].length;
          c.nome = { valor: p.nome, bruto: lit, linha: linhaDe(m.index + m[0].lastIndexOf(lit)) };
        }
      }
      tabela.linhas.push(montarLinha(c, linhas));
    }
  } else if (aneis.length) {
    let anel = aneis.reduce((a, b) => (b.length > a.length ? b : a));
    const f = anel[0], l = anel[anel.length - 1];
    if (anel.length > 3 && f[0].v === l[0].v && f[1].v === l[1].v) anel = anel.slice(0, -1);
    for (const pos of anel) {
      const c: Partial<Record<Papel, Cel>> = { lon: cel(pos[0]), lat: cel(pos[1]) };
      if (pos[2] && pos[2].v !== 0) c.h = cel(pos[2]);
      tabela.linhas.push(montarLinha(c, linhas));
    }
    tabela.avisos.push({ codigo: "geojson_poligono", nivel: "info", mensagem: "Lidos os vértices do polígono do GeoJSON (numerados na ordem do desenho)." });
  }
  return tabela;
}

// ---------------------------------------------------------------------------
// DXF (pontos POINT ou a maior polilinha fechada)
// ---------------------------------------------------------------------------

export function pareceDxf(linhas: string[]): boolean {
  const l = linhas.slice(0, 8).map((x) => x.trim());
  return l[0] === "0" && l[1] === "SECTION";
}

function tabelaDxf(linhas: string[]): Tabela {
  const tabela: Tabela = { linhas: [], ignoradas: [], avisos: [] };
  type Ent = { tipo: string; g: { cod: number; val: string; linha: number }[] };
  const ents: Ent[] = [];
  let emEnt = false, atual: Ent | null = null;
  for (let i = 0; i + 1 < linhas.length; i += 2) {
    const cod = Number(linhas[i].trim()), val = linhas[i + 1].trim();
    if (cod === 2 && val === "ENTITIES") emEnt = true;
    if (cod === 0 && val === "ENDSEC") { emEnt = false; if (atual) ents.push(atual); atual = null; continue; }
    if (!emEnt) continue;
    if (cod === 0) { if (atual) ents.push(atual); atual = { tipo: val, g: [] }; continue; }
    atual?.g.push({ cod, val, linha: i + 2 });
  }
  const cel = (x: { val: string; linha: number }): Cel | null => {
    const v = lerNumero(x.val, ".");
    return v === null ? null : { valor: fmt(v), bruto: x.val, linha: x.linha };
  };
  const textos = ents.filter((e) => e.tipo === "TEXT" || e.tipo === "MTEXT").map((e) => ({
    t: e.g.find((x) => x.cod === 1), x: Number(e.g.find((x) => x.cod === 10)?.val), y: Number(e.g.find((x) => x.cod === 20)?.val),
  })).filter((t) => t.t && Number.isFinite(t.x) && Number.isFinite(t.y));
  // nomes pelos textos do desenho: casamento um-a-um pelo par mais próximo (até 5 m)
  const nomearPorTexto = (cs: Partial<Record<Papel, Cel>>[]) => {
    const pares: { i: number; t: number; d: number }[] = [];
    cs.forEach((c, i) => textos.forEach((t, k) => {
      const d = Math.hypot(t.x - Number(c.e!.valor), t.y - Number(c.n!.valor));
      if (d < 5) pares.push({ i, t: k, d });
    }));
    pares.sort((a, b) => a.d - b.d);
    const usadoP = new Set<number>(), usadoT = new Set<number>();
    for (const p of pares) {
      if (usadoP.has(p.i) || usadoT.has(p.t)) continue;
      usadoP.add(p.i); usadoT.add(p.t);
      const t = textos[p.t];
      cs[p.i].nome = { valor: t.t!.val.replace(/\\[A-Za-z][^;]*;|[{}]/g, ""), bruto: t.t!.val, linha: t.t!.linha };
    }
    if (usadoP.size) {
      // pontos mais perto um do outro que dos textos: o nome pode ter sido trocado
      const ambiguo = pares.some((p) => usadoP.has(p.i) && cs.some((c, k) => k !== p.i && Math.hypot(Number(c.e!.valor) - Number(cs[p.i].e!.valor), Number(c.n!.valor) - Number(cs[p.i].n!.valor)) <= 2 * p.d + 0.01));
      tabela.avisos.push({
        codigo: ambiguo ? "dxf_nomes_ambiguos" : "dxf_nomes_por_texto", nivel: "alerta",
        mensagem: ambiguo
          ? `Nomes dos pontos deduzidos pelo texto mais próximo, mas há pontos muito juntos: os nomes podem ter sido trocados entre eles. Confira no mapa.`
          : `Nomes dos pontos deduzidos pelo texto mais próximo de cada um no desenho (${usadoP.size} de ${cs.length}). Confira no mapa.`,
      });
    }
  };
  const pts = ents.filter((e) => e.tipo === "POINT");
  const linhasPts: Partial<Record<Papel, Cel>>[] = [];
  if (pts.length >= 3) {
    for (const p of pts) {
      const x = p.g.find((g) => g.cod === 10), y = p.g.find((g) => g.cod === 20), z = p.g.find((g) => g.cod === 30);
      if (!x || !y) continue;
      const ce = cel(x), cn = cel(y);
      if (!ce || !cn) continue;
      const c: Partial<Record<Papel, Cel>> = { e: ce, n: cn };
      const cz = z ? cel(z) : null;
      if (cz && Number(cz.valor) !== 0) c.h = cz;
      linhasPts.push(c);
    }
    nomearPorTexto(linhasPts);
  } else {
    // a maior polilinha (LWPOLYLINE ou POLYLINE+VERTEX)
    const polis: { v: Partial<Record<Papel, Cel>>[] }[] = [];
    for (let k = 0; k < ents.length; k++) {
      const e = ents[k];
      if (e.tipo === "LWPOLYLINE") {
        const elev = e.g.find((g) => g.cod === 38);
        const vs: Partial<Record<Papel, Cel>>[] = [];
        let cur: Partial<Record<Papel, Cel>> | null = null;
        for (const g of e.g) {
          if (g.cod === 10) { const c = cel(g); cur = c ? { e: c } : null; }
          else if (g.cod === 20 && cur) { const c = cel(g); if (c) { cur.n = c; if (elev && Number(elev.val) !== 0) cur.h = cel(elev)!; vs.push(cur); } cur = null; }
        }
        polis.push({ v: vs });
      } else if (e.tipo === "POLYLINE") {
        const vs: Partial<Record<Papel, Cel>>[] = [];
        for (let q = k + 1; q < ents.length && ents[q].tipo === "VERTEX"; q++) {
          const g = ents[q].g;
          const x = g.find((a) => a.cod === 10), y = g.find((a) => a.cod === 20), z = g.find((a) => a.cod === 30);
          const ce = x ? cel(x) : null, cn = y ? cel(y) : null;
          if (ce && cn) { const c: Partial<Record<Papel, Cel>> = { e: ce, n: cn }; const cz = z ? cel(z) : null; if (cz && Number(cz.valor) !== 0) c.h = cz; vs.push(c); }
        }
        polis.push({ v: vs });
      }
    }
    if (polis.length) {
      let maior = polis.reduce((a, b) => (b.v.length > a.v.length ? b : a)).v;
      const f = maior[0], l = maior[maior.length - 1];
      if (maior.length > 3 && f.e!.valor === l.e!.valor && f.n!.valor === l.n!.valor) maior = maior.slice(0, -1);
      for (const c of maior) linhasPts.push(c);
      nomearPorTexto(linhasPts);
      tabela.avisos.push({ codigo: "dxf_polilinha", nivel: "info", mensagem: "Lidos os vértices da maior polilinha do DXF." });
    }
  }
  for (const c of linhasPts) tabela.linhas.push(montarLinha(c, linhas));
  return tabela;
}

// ---------------------------------------------------------------------------
// Texto livre (memorial descritivo, e-mail, relatório colado)
// ---------------------------------------------------------------------------

const RE_NUM_LIVRE = /\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?/g;
const RE_NOME_VERTICE = /\b([A-Z0-9]{2,8}-[MPVX]-\d{1,6})\b|\b(?:v[ée]rtice|ponto|marco|pto\.?|pt\.?)\s*(?:n[º°o.]?\s*)?([A-Za-z0-9][\w\-./]*)/gi;
const RE_ANGULO_LIVRE = /(lat(?:itude)?|lon(?:g(?:itude)?)?)\s*[:=]?\s*([-+]?\s*\d{1,3}\s*[°º]\s*\d{1,2}\s*['’]\s*\d{1,2}(?:[.,]\d+)?\s*(?:"|”|'')?\s*[NSWOEL]?|[-+]?\d{1,3}[.,]\d{4,})/gi;

export function tabelaTextoLivre(linhas: string[]): Tabela {
  const { texto, linhaDe } = indiceDeLinhas(linhas);
  const tabela: Tabela = { linhas: [], ignoradas: [], avisos: [] };
  type Achado = { tipo: "E" | "N" | "lat" | "lon" | "h"; off: number; fim: number; bruto: string; valor: number };
  const achados: Achado[] = [];
  // UTM: rótulo E/N (ou Este/Norte/Leste/X/Y) seguido do número
  for (const m of texto.matchAll(/\b(E|N|Este|Leste|Norte|X|Y)\s*[:=]?\s*(\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?|\d{6,7}(?:[.,]\d+)?)\s*m?\b/g)) {
    const v = numeroLivre(m[2]);
    if (v === null) continue;
    const rot = m[1].toUpperCase();
    let tipo: "E" | "N" | null = null;
    if (v >= LIMITES.eMin && v <= LIMITES.eMax) tipo = "E";
    else if (v >= 6100000 && v <= LIMITES.nMax) tipo = "N";
    if (!tipo) continue;
    if ((rot === "E" || rot === "ESTE" || rot === "LESTE") && tipo !== "E") continue;
    if ((rot === "N" || rot === "NORTE") && tipo !== "N") continue;
    const off = m.index! + m[0].indexOf(m[2], m[1].length);
    achados.push({ tipo, off, fim: off + m[2].length, bruto: m[2], valor: v });
  }
  for (const m of texto.matchAll(RE_ANGULO_LIVRE)) {
    const eixo = m[1].toLowerCase().startsWith("lat") ? "lat" : "lon";
    const a = lerAngulo(m[2].replace(/\s+/g, " "), eixo, ",") ?? lerAngulo(m[2], eixo, ".");
    if (!a) continue;
    const off = m.index! + m[0].indexOf(m[2], m[1].length);
    achados.push({ tipo: eixo, off, fim: off + m[2].length, bruto: m[2], valor: a.graus });
  }
  for (const m of texto.matchAll(/\b(altitude|alt\.?|cota|h)\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)\s*m\b/gi)) {
    const v = numeroLivre(m[2]);
    if (v === null) continue;
    const off = m.index! + m[0].indexOf(m[2], m[1].length);
    achados.push({ tipo: "h", off, fim: off + m[2].length, bruto: m[2], valor: v });
  }
  achados.sort((a, b) => a.off - b.off);
  const nomes = [...texto.matchAll(RE_NOME_VERTICE)].map((m) => ({ off: m.index!, nome: (m[1] ?? m[2]).replace(/[.,;:]+$/, ""), bruto: m[1] ?? m[2] }));
  const nomeAntes = (off: number, limite: number) => {
    let melhor: typeof nomes[number] | null = null;
    for (const n of nomes) if (n.off < off && n.off >= limite) melhor = n;
    return melhor;
  };
  // pares: E+N (qualquer ordem) ou lat+lon, próximos (≤ 160 caracteres)
  let i = 0, ultimoFim = 0;
  while (i < achados.length - 1) {
    const a = achados[i], b = achados[i + 1];
    const par = (a.tipo === "E" && b.tipo === "N") || (a.tipo === "N" && b.tipo === "E") ? "utm"
      : (a.tipo === "lat" && b.tipo === "lon") || (a.tipo === "lon" && b.tipo === "lat") ? "geo" : null;
    if (!par || b.off - a.fim > 160) { i++; continue; }
    const c: Partial<Record<Papel, Cel>> = {};
    const mk = (x: Achado): Cel => ({ valor: String(x.valor), bruto: x.bruto, linha: linhaDe(x.off) });
    if (par === "utm") { const e = a.tipo === "E" ? a : b, n = a.tipo === "N" ? a : b; c.e = mk(e); c.n = mk(n); }
    else { const la = a.tipo === "lat" ? a : b, lo = a.tipo === "lon" ? a : b; c.lat = mk(la); c.lon = mk(lo); }
    let pulo = 2;
    const prox = achados[i + 2];
    if (prox && prox.tipo === "h" && prox.off - b.fim <= 80) { c.h = mk(prox); pulo = 3; }
    const nm = nomeAntes(a.off, Math.max(ultimoFim, a.off - 250));
    if (nm) c.nome = { valor: nm.nome, bruto: nm.bruto, linha: linhaDe(nm.off) };
    tabela.linhas.push(montarLinha(c, linhas));
    ultimoFim = (achados[i + pulo - 1] ?? b).fim;
    i += pulo;
  }
  if (tabela.linhas.length) {
    tabela.avisos.push({ codigo: "texto_livre", nivel: "alerta", mensagem: "Pontos extraídos de texto corrido: confira cada coordenada com o documento antes de seguir." });
  }
  return tabela;
}

// ---------------------------------------------------------------------------
// Despacho
// ---------------------------------------------------------------------------

/** Formato especial reconhecido pelo conteúdo (null = tabular comum). */
export function formatoEspecial(linhas: string[]): Registro | null {
  if (pareceXml(linhas)) return "xml";
  if (pareceGeoJson(linhas)) return "geojson";
  if (pareceDxf(linhas)) return "dxf";
  if (pareceGsi(linhas)) return "gsi";
  if (pareceChaveValor(linhas)) return "chave_valor";
  return null;
}

/** Receita completa para um formato especial (o extrator decide o resto). */
export function receitaEspecial(registro: Registro, linhas: string[]): Receita {
  if (registro === "xml") return receitaDoFormato("xml", tabelaXml(linhas).extra);
  if (registro === "geojson") return receitaDoFormato("geojson", { sistema: "geografica" });
  if (registro === "chave_valor") return receitaDoFormato("chave_valor", { confianca_sigma: "95", explicacao: "Relatório chave → valor (IBGE-PPP): precisões a 95%." });
  if (registro === "texto_livre") return receitaDoFormato("texto_livre");
  return receitaDoFormato(registro);
}

export function tabelaDoFormato(linhas: string[], r: Receita): { tabela: Tabela; semCobertura: boolean; consumidas?: Set<number> } {
  switch (r.registro) {
    case "gsi": return { tabela: tabelaGsi(linhas), semCobertura: false };
    case "chave_valor": { const r2 = tabelaChaveValor(linhas); return { tabela: r2.tabela, semCobertura: false, consumidas: r2.consumidas }; }
    case "xml": return { tabela: tabelaXml(linhas).tabela, semCobertura: true };
    case "geojson": return { tabela: tabelaGeoJson(linhas), semCobertura: true };
    case "dxf": return { tabela: tabelaDxf(linhas), semCobertura: true };
    case "texto_livre": return { tabela: tabelaTextoLivre(linhas), semCobertura: true };
    default: return { tabela: { linhas: [], ignoradas: [], avisos: [{ codigo: "registro", nivel: "bloqueio", mensagem: `Registro "${r.registro}" sem extrator.` } as Aviso] }, semCobertura: true };
  }
}

export type { LinhaIgnorada };
