// Vértices certificados de parcelas vizinhas (CSV de exportação do SIGEF).
//
// Dois usos, um parser:
//   1. Serviço novo que CONFRONTA com área já certificada: antes do TXT o
//      operador envia o CSV do vizinho, escolhe na planta quais vértices são a
//      divisa comum e o parse-txt une esses vértices ao levantamento
//      (`unirCertificados` + `montarVerticesUnidos`).
//   2. Correção de sobreposição (sobreposicao.ts), que importa o parser daqui.
//
// Regra comum aos dois: o vértice do vizinho entra no nosso anel com o CÓDIGO,
// as coordenadas GMS, o método, os sigmas e a altitude DELE, gravado como
// `inserido_manual=true` — o canal que gerar-documentos já trata como "código
// digitado" (não realoca nos contadores e publica o GMS gravado).
//
// Código puro: sem clipper, sem Deno — o frontend importa este módulo para
// desenhar a planta do CSV, e os testes rodam em Node.
import { degToGmsCanonical, fmtGmsPlanilha, gmsToDeg, parseGmsPlanilha } from "./geo.ts";
import type { PontoTxt } from "./geo.ts";

/** Um vértice do CSV de exportação do SIGEF, com tudo o que a planilha precisa. */
export interface VerticeSigef {
  codigo: string;
  tipo: "M" | "P" | "V";
  metodo: string;
  sigmaX: number;
  sigmaY: number;
  sigmaZ: number;
  h: number;
  /** Coordenadas GMS como o SIGEF as publica (colunas X/Y): "12 10 30,687 S". */
  latGms: string;
  lonGms: string;
  /** Graus decimais do WKT (o mesmo valor, em outra forma). */
  lon: number;
  lat: number;
  /** Coluna INDICE do CSV: posição no anel do vizinho (1-based). */
  indice: number;
}

// ---------------------------------------------------------------------------
// Parse do CSV de exportação do SIGEF
// ---------------------------------------------------------------------------

const numBR = (s: string | undefined): number => {
  const v = parseFloat((s ?? "").trim().replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

// Cabeçalho esperado: QRCODE;CODIGO;METODO_...;TIPO_VERTICE;SIGMA_X;SIGMA_Y;SIGMA_Z;LADO;INDICE;X;Y;Z;GEOMETRIA_WKT;
// As colunas X/Y vêm ora em GMS ("39 18 31,135 W"), ora em UTM ("540251,85") —
// depende da exportação. Em UTM, o GMS publicado é derivado do WKT no formato
// canônico da planilha (mesmo arredondamento de 0,001").
export function parseCsvSigef(
  nome: string,
  conteudo: string,
): { nome: string; pontos: [number, number][]; vertices: VerticeSigef[]; parcela: string | null } {
  const linhas = conteudo.replace(/^﻿/, "").split(/\r?\n/);
  const header = linhas[0]?.toUpperCase() ?? "";
  if (!header.includes("GEOMETRIA_WKT") || !header.includes("INDICE")) {
    throw new Error(`${nome}: não parece um CSV de exportação do SIGEF (cabeçalho sem GEOMETRIA_WKT/INDICE)`);
  }
  const cols = header.split(";").map((c) => c.trim());
  const col = (n: string) => cols.indexOf(n);
  const iLado = col("LADO"), iIdx = col("INDICE"), iWkt = col("GEOMETRIA_WKT");
  const iCod = col("CODIGO"), iMet = col("METODO_POSICIONAMENTO"), iTipo = col("TIPO_VERTICE");
  const iSx = col("SIGMA_X"), iSy = col("SIGMA_Y"), iSz = col("SIGMA_Z");
  const iX = col("X"), iY = col("Y"), iZ = col("Z");
  const iQr = col("QRCODE");
  // identidade da parcela: o SIGEF baixa todo CSV como "exportacao.csv", então o
  // nome do arquivo não distingue dois vizinhos — o QRCODE (id da parcela) sim
  let parcela: string | null = null;
  const pts: { idx: number; v: VerticeSigef }[] = [];
  for (const linha of linhas.slice(1)) {
    if (!linha.trim()) continue;
    const partes = linha.split(";");
    if (partes.length <= iWkt) continue;
    if (parcela === null && iQr >= 0 && partes[iQr].trim()) parcela = partes[iQr].trim();
    if (iLado >= 0 && partes[iLado].trim().toUpperCase() !== "EXTERNO") continue;
    const m = partes[iWkt].match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
    if (!m) continue;
    const lon = parseFloat(m[1]), lat = parseFloat(m[2]);
    const codigo = iCod >= 0 ? partes[iCod].trim() : "";
    const letra = (iTipo >= 0 ? partes[iTipo].trim().toUpperCase() : "") || (codigo.match(/-([MPV])-/)?.[1] ?? "P");
    const tipo: "M" | "P" | "V" = letra === "M" || letra === "V" ? letra : "P";
    const lonGmsCsv = iX >= 0 ? partes[iX].trim() : "";
    const latGmsCsv = iY >= 0 ? partes[iY].trim() : "";
    const lonGms = ehGmsValido(lonGmsCsv) ? lonGmsCsv : gmsCanonicoStr(lon, "lon");
    const latGms = ehGmsValido(latGmsCsv) ? latGmsCsv : gmsCanonicoStr(lat, "lat");
    const sx = numBR(partes[iSx]), sy = numBR(partes[iSy]), sz = numBR(partes[iSz]);
    const idx = parseInt(partes[iIdx], 10) || 0;
    pts.push({
      idx,
      v: {
        codigo, tipo,
        metodo: (iMet >= 0 ? partes[iMet].trim() : "") || "PG2",
        sigmaX: Number.isFinite(sx) ? sx : 0, sigmaY: Number.isFinite(sy) ? sy : 0, sigmaZ: Number.isFinite(sz) ? sz : 0,
        h: Number.isFinite(numBR(partes[iZ])) ? numBR(partes[iZ]) : 0,
        latGms, lonGms, lon, lat, indice: idx,
      },
    });
  }
  if (pts.length < 3) throw new Error(`${nome}: menos de 3 vértices EXTERNO no CSV`);
  pts.sort((a, b) => a.idx - b.idx);
  return { nome, pontos: pts.map((p) => [p.v.lon, p.v.lat]), vertices: pts.map((p) => p.v), parcela };
}

function ehGmsValido(s: string): boolean {
  if (!s) return false;
  try { parseGmsPlanilha(s); return true; } catch { return false; }
}

const gmsCanonicoStr = (deg: number, kind: "lat" | "lon"): string => fmtGmsPlanilha(degToGmsCanonical(deg), kind);

/** Graus decimais do vértice certificado, a partir do GMS publicado (fonte da verdade). */
export function lonLatDoVerticeSigef(v: VerticeSigef): [number, number] {
  try {
    return [gmsToDeg(parseGmsPlanilha(v.lonGms)), gmsToDeg(parseGmsPlanilha(v.latGms))];
  } catch {
    return [v.lon, v.lat];
  }
}

// ---------------------------------------------------------------------------
// União dos vértices certificados escolhidos ao levantamento (TXT)
// ---------------------------------------------------------------------------

/** Os vértices ESCOLHIDOS de uma parcela vizinha, na ordem do anel dela. */
export interface GrupoCertificado {
  nome: string;
  vertices: VerticeSigef[];
}

export type EntradaAnel =
  /** Ponto do TXT; `igualado` = está a menos da tolerância de um vértice certificado e vira ele. */
  | { origem: "txt"; idx: number; igualado?: { grupo: number; idx: number; distM: number } }
  /** Vértice certificado inserido entre dois pontos do TXT. */
  | { origem: "certificado"; grupo: number; idx: number };

export interface ResultadoUniao {
  /** Anel final, na ordem do TXT com as inserções. */
  anel: EntradaAnel[];
  igualados: number;
  inseridos: number;
  avisos: string[];
}

/** Um ponto certificado a mais do que isto do nosso perímetro é quase certamente escolha errada.
 *  Não pode ser pequeno: a divisa do vizinho pode bojar dezenas de metros entre dois pontos
 *  nossos — é justamente o caso em que não medimos os intermediários e usamos os dele. */
export const DISTANCIA_SUSPEITA_M = 150;

/**
 * Encaixa os vértices certificados escolhidos no anel do TXT.
 *
 * - **Igualar**: ponto nosso a ≤ `toleranciaM` do vértice certificado vira ele
 *   (mantém a linha nossa — nº TXT, rótulo, confrontação — e recebe código,
 *   coordenadas, método, σ e Z do vizinho). Mesma regra da correção de
 *   sobreposição: dois pontos a meio metro um do outro são o mesmo marco.
 * - **Inserir**: os demais entram no lado nosso em que menos alongam o
 *   perímetro (d(a,p) + d(p,b) − d(a,b) mínimo), ordenados ao longo do lado.
 *   Vários certificados no mesmo lado saem na ordem em que a divisa os percorre,
 *   ande o nosso anel no sentido do vizinho ou no contrário.
 *
 * Nenhum ponto medido é descartado aqui: se o operador escolheu um vértice que
 * não é divisa, ele aparece no mapa da conferência e pode ser removido lá.
 */
export function unirCertificados(
  txt: { e: number; n: number }[],
  grupos: GrupoCertificado[],
  geoParaUtm: (lon: number, lat: number) => [number, number],
  toleranciaM = 0.5,
): ResultadoUniao {
  const n = txt.length;
  const avisos: string[] = [];
  if (n < 3) throw new Error("O levantamento precisa de pelo menos 3 pontos");
  const igualadoPorTxt = new Map<number, { grupo: number; idx: number; distM: number }>();
  const insercoes = new Map<number, { grupo: number; idx: number; t: number; seq: number }[]>();
  const vistos = new Set<string>();
  let seq = 0;

  grupos.forEach((g, gi) => {
    g.vertices.forEach((v, vi) => {
      if (v.codigo && vistos.has(v.codigo)) {
        avisos.push(`${v.codigo} aparece mais de uma vez nos CSVs — usado uma vez só.`);
        return;
      }
      if (v.codigo) vistos.add(v.codigo);
      const [lon, lat] = lonLatDoVerticeSigef(v);
      const [pe, pn] = geoParaUtm(lon, lat);

      // 1) vértice nosso mais próximo
      let iv = -1, dv = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(txt[i].e - pe, txt[i].n - pn);
        if (d < dv) { dv = d; iv = i; }
      }
      if (dv <= toleranciaM && !igualadoPorTxt.has(iv)) {
        igualadoPorTxt.set(iv, { grupo: gi, idx: vi, distM: dv });
        return;
      }

      // 2) lado nosso que menos alonga o perímetro
      let melhor = -1, extraMin = Infinity, tMelhor = 0, distLado = Infinity;
      for (let i = 0; i < n; i++) {
        const a = txt[i], b = txt[(i + 1) % n];
        const abE = b.e - a.e, abN = b.n - a.n;
        const len2 = abE * abE + abN * abN || 1e-12;
        const t = Math.max(0, Math.min(1, ((pe - a.e) * abE + (pn - a.n) * abN) / len2));
        const dab = Math.sqrt(len2);
        const extra = Math.hypot(pe - a.e, pn - a.n) + Math.hypot(b.e - pe, b.n - pn) - dab;
        if (extra < extraMin) {
          extraMin = extra; melhor = i; tMelhor = t;
          distLado = Math.hypot(pe - (a.e + abE * t), pn - (a.n + abN * t));
        }
      }
      if (distLado > DISTANCIA_SUSPEITA_M) {
        avisos.push(`${v.codigo || `vértice ${vi + 1} de ${g.nome}`} está a ${distLado.toFixed(1).replace(".", ",")} m do perímetro levantado — confira se é mesmo divisa.`);
      }
      const lista = insercoes.get(melhor) ?? [];
      lista.push({ grupo: gi, idx: vi, t: tMelhor, seq: seq++ });
      insercoes.set(melhor, lista);
    });
  });

  const anel: EntradaAnel[] = [];
  let inseridos = 0;
  for (let i = 0; i < n; i++) {
    const ig = igualadoPorTxt.get(i);
    anel.push(ig ? { origem: "txt", idx: i, igualado: ig } : { origem: "txt", idx: i });
    const lista = (insercoes.get(i) ?? []).sort((a, b) => a.t - b.t || a.seq - b.seq);
    for (const ins of lista) {
      anel.push({ origem: "certificado", grupo: ins.grupo, idx: ins.idx });
      inseridos++;
    }
  }
  return { anel, igualados: igualadoPorTxt.size, inseridos, avisos };
}

// ---------------------------------------------------------------------------
// Linhas da tabela `vertices` a partir do anel unido
// ---------------------------------------------------------------------------

/** Linha de `vertices` sem `servico_id` (quem grava acrescenta). */
export interface VerticeUnido {
  ordem: number;
  num_txt: number | null;
  rotulo_txt: string | null;
  e: number;
  n: number;
  h: number;
  sigma_pos: number;
  sigma_h: number;
  tipo: "M" | "P" | "V";
  codigo: string | null;
  codigo_provisorio: boolean;
  metodo: string;
  inserido_manual: boolean;
  lat_gms: string;
  lon_gms: string;
  apelido_txt: string | null;
  descritivo: string | null;
  tipo_limite: string | null;
  eh_via: boolean;
  /** Índice no TXT (null = vértice do vizinho inserido). */
  txt_idx: number | null;
  /** Código do vizinho quando a linha veio (ou foi igualada a) um certificado. */
  certificado: string | null;
}

export interface SugestaoTrecho { verticeInicioOrdem: number; apelido: string; ehVia: boolean }

const arred3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * Monta as linhas da tabela `vertices` para o anel unido. Sem certificados o
 * resultado é exatamente o que o parse-txt sempre gravou: a confrontação nasce
 * no vértice M (início de trecho sugerido pelo rótulo do TXT) e todo o resto é P.
 *
 * Com certificados:
 * - linha IGUALADA continua sendo a nossa (nº TXT, rótulo, confrontação se for M),
 *   mas publica código, GMS, método, σ e Z do vizinho;
 * - linha INSERIDA é do vizinho: sem nº TXT, sem confrontação. Um M do vizinho
 *   vira P aqui — no nosso anel, M significa "inicia confrontação".
 *
 * `sigma_pos = max(σx, σy)`: a planilha grava um σ só para x e y.
 */
export function montarVerticesUnidos(
  pontos: PontoTxt[],
  trechosSug: SugestaoTrecho[],
  uniao: ResultadoUniao,
  grupos: GrupoCertificado[],
  latLonGmsDoTxt: (idxTxt: number) => { lat: string; lon: string },
  geoParaUtm: (lon: number, lat: number) => [number, number],
): VerticeUnido[] {
  const inicios = new Set(trechosSug.map((t) => t.verticeInicioOrdem));
  const apelidoPor = new Map(trechosSug.map((t) => [t.verticeInicioOrdem, t.apelido]));
  const viaPor = new Map(trechosSug.map((t) => [t.verticeInicioOrdem, t.ehVia]));

  const doCertificado = (ref: { grupo: number; idx: number }) => {
    const vc = grupos[ref.grupo].vertices[ref.idx];
    const [lon, lat] = lonLatDoVerticeSigef(vc);
    const [e, n] = geoParaUtm(lon, lat);
    return {
      vc, e: arred3(e), n: arred3(n),
      lat_gms: fmtGmsPlanilha(parseGmsPlanilha(vc.latGms), "lat"),
      lon_gms: fmtGmsPlanilha(parseGmsPlanilha(vc.lonGms), "lon"),
      sigmaPos: Math.max(vc.sigmaX, vc.sigmaY),
    };
  };

  return uniao.anel.map((ent, ordem): VerticeUnido => {
    if (ent.origem === "txt") {
      const p = pontos[ent.idx];
      const ehM = inicios.has(ent.idx);
      const gms = latLonGmsDoTxt(ent.idx);
      const base: VerticeUnido = {
        ordem, num_txt: p.num, rotulo_txt: p.rotulo,
        e: p.e, n: p.n, h: p.h, sigma_pos: p.sigmaPos, sigma_h: p.sigmaH,
        tipo: ehM ? "M" : "P", codigo: null, codigo_provisorio: false, metodo: "PG6", inserido_manual: false,
        lat_gms: gms.lat, lon_gms: gms.lon,
        apelido_txt: apelidoPor.get(ent.idx) ?? null,
        descritivo: ehM ? "" : null,
        tipo_limite: ehM ? "LA1" : null,
        eh_via: viaPor.get(ent.idx) ?? false,
        txt_idx: ent.idx, certificado: null,
      };
      if (!ent.igualado) return base;
      const c = doCertificado(ent.igualado);
      return {
        ...base,
        e: c.e, n: c.n, h: c.vc.h,
        sigma_pos: c.sigmaPos || p.sigmaPos, sigma_h: c.vc.sigmaZ || p.sigmaH,
        tipo: ehM ? "M" : (c.vc.tipo === "M" ? "P" : c.vc.tipo),
        codigo: c.vc.codigo, metodo: c.vc.metodo || "PG2", inserido_manual: true,
        lat_gms: c.lat_gms, lon_gms: c.lon_gms,
        certificado: c.vc.codigo,
      };
    }
    const c = doCertificado(ent);
    return {
      ordem, num_txt: null, rotulo_txt: null,
      e: c.e, n: c.n, h: c.vc.h, sigma_pos: c.sigmaPos || 0.05, sigma_h: c.vc.sigmaZ || 0.05,
      tipo: c.vc.tipo === "M" ? "P" : c.vc.tipo,
      codigo: c.vc.codigo, codigo_provisorio: false, metodo: c.vc.metodo || "PG2", inserido_manual: true,
      lat_gms: c.lat_gms, lon_gms: c.lon_gms,
      apelido_txt: null, descritivo: null, tipo_limite: null, eh_via: false,
      txt_idx: null, certificado: c.vc.codigo,
    };
  });
}
