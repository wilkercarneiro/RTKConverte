// Vértices certificados de parcelas vizinhas (CSV de exportação do SIGEF).
//
// Dois usos, um parser:
//   1. Serviço novo que CONFRONTA com área já certificada: antes do TXT o
//      operador envia o CSV do vizinho, escolhe na planta quais vértices são a
//      divisa comum e o parse-txt une esses vértices ao levantamento
//      (`unirCertificados` + `montarVerticesUnidos`). A mesma união é refeita
//      pela função reunir-certificados quando o fuso muda na conferência.
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
  /** Quantos vértices EXTERNO o CSV tem: detecta escolha que dá a volta no anel (35, 36, 1, 2). */
  totalNoCsv?: number;
}

export type EntradaAnel =
  /** Ponto do TXT; `igualado` = está a menos da tolerância de um vértice certificado e vira ele. */
  | { origem: "txt"; idx: number; igualado?: { grupo: number; idx: number; distM: number }; herdaConfrontacaoDe?: number }
  /** Vértice certificado inserido entre dois pontos do TXT. */
  | { origem: "certificado"; grupo: number; idx: number; herdaConfrontacaoDe?: number };

export interface ResultadoUniao {
  /** Anel final, na ordem do TXT com as inserções e sem os pontos descartados. */
  anel: EntradaAnel[];
  igualados: number;
  inseridos: number;
  /** Índices (no TXT) dos pontos descartados por estarem sobre a divisa certificada. */
  removidos: number[];
  avisos: string[];
}

export interface OpcoesUniao {
  /** Ponto nosso a ≤ isto de um vértice certificado VIRA ele (padrão 0,5 m). */
  toleranciaM?: number;
  /**
   * Ponto nosso a ≤ isto da divisa certificada, entre dois vértices dela, é
   * DESCARTADO: onde o TXT e o CSV descrevem o mesmo trecho, vale o CSV.
   */
  toleranciaLinhaM?: number;
  /** Índices do TXT que iniciam confrontação (M): um M descartado passa a confrontação adiante. */
  inicios?: Set<number>;
}

export const TOLERANCIA_LINHA_M = 10;

type Pt = [number, number];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const compr = (ps: Pt[]) => { let s = 0; for (let i = 1; i < ps.length; i++) s += dist(ps[i - 1], ps[i]); return s; };
function distSeg(p: Pt, a: Pt, b: Pt): number {
  const abx = b[0] - a[0], aby = b[1] - a[1];
  const l2 = abx * abx + aby * aby || 1e-12;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / l2));
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
}
function distPolilinha(p: Pt, ps: Pt[]): number {
  if (ps.length === 1) return dist(p, ps[0]);
  let m = Infinity;
  for (let i = 1; i < ps.length; i++) m = Math.min(m, distSeg(p, ps[i - 1], ps[i]));
  return m;
}
function segmentosCruzam(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

interface Cert { grupo: number; idx: number; pt: Pt; codigo: string; indice: number }

/**
 * Ordena a cadeia pelo INDICE do vizinho e, se a escolha deu a volta no anel
 * dele (35, 36, 1, 2), começa depois do maior salto — a cadeia tem de ser a
 * sequência contígua da divisa, não a ordem numérica.
 */
function ordenarCadeia(lista: Cert[], total?: number): Cert[] {
  const l = [...lista].sort((a, b) => a.indice - b.indice);
  if (l.length < 2) return l;
  let maior = -1, corte = -1;
  for (let i = 0; i + 1 < l.length; i++) {
    const gap = l[i + 1].indice - l[i].indice;
    if (gap > maior) { maior = gap; corte = i + 1; }
  }
  const gapVolta = total ? l[0].indice + total - l[l.length - 1].indice : Infinity;
  if (gapVolta >= maior) return l;
  return [...l.slice(corte), ...l.slice(0, corte)];
}

/**
 * Encaixa os vértices certificados escolhidos no anel do TXT.
 *
 * Cada parcela escolhida é uma CADEIA rígida, na ordem do anel do vizinho
 * (eventualmente percorrida ao contrário). O que decide onde a cadeia entra:
 *
 * - **Igualar**: ponto nosso a ≤ `toleranciaM` de um vértice certificado vira
 *   ele (mantém a linha nossa — nº TXT, rótulo, confrontação — e recebe código,
 *   coordenadas, método, σ e Z do vizinho). Esses são os pontos de ANCORAGEM.
 * - **Entre duas âncoras**, o pedaço da cadeia substitui o caminho do TXT entre
 *   elas: os pontos nossos que estão a ≤ `toleranciaLinhaM` da divisa
 *   certificada são descartados — onde o TXT e o CSV descrevem o mesmo trecho,
 *   vale o CSV. Um M descartado passa a confrontação ao próximo ponto mantido.
 * - **Ponta** (antes da primeira âncora / depois da última) e **cadeia sem
 *   âncora** entram no lado do anel em que menos alongam o perímetro, com a
 *   cadeia inteira e na orientação que menos alonga — nunca vértice a vértice,
 *   porque a divisa do vizinho pode se afastar centenas de metros da corda
 *   entre dois pontos nossos e a ordem interna dela não pode ser reconstruída
 *   por projeção.
 *
 * Um levantamento parcial (o TXT só cobre parte do perímetro e o resto é dos
 * vizinhos certificados) sai correto por essa regra: as cadeias fecham o
 * polígono na ordem em que o vizinho as percorre.
 */
export function unirCertificados(
  txt: { e: number; n: number; num?: number }[],
  grupos: GrupoCertificado[],
  geoParaUtm: (lon: number, lat: number) => [number, number],
  opcoes: number | OpcoesUniao = 0.5,
): ResultadoUniao {
  const op: OpcoesUniao = typeof opcoes === "number" ? { toleranciaM: opcoes } : opcoes;
  const tol = op.toleranciaM ?? 0.5;
  const tolLinha = op.toleranciaLinhaM ?? TOLERANCIA_LINHA_M;
  const inicios = op.inicios ?? new Set<number>();
  const n = txt.length;
  if (n < 3) throw new Error("O levantamento precisa de pelo menos 3 pontos");
  const avisos: string[] = [];
  const nomeTxt = (i: number) => `ponto ${txt[i].num ?? i + 1} do TXT`;

  // 1) cadeias, na ordem do anel do vizinho
  const vistos = new Set<string>();
  const cadeias: Cert[][] = [];
  grupos.forEach((g, gi) => {
    const lista: Cert[] = [];
    g.vertices.forEach((v, vi) => {
      if (v.codigo && vistos.has(v.codigo)) {
        avisos.push(`${v.codigo} aparece mais de uma vez nos CSVs — usado uma vez só.`);
        return;
      }
      if (v.codigo) vistos.add(v.codigo);
      const [lon, lat] = lonLatDoVerticeSigef(v);
      lista.push({ grupo: gi, idx: vi, pt: geoParaUtm(lon, lat), codigo: v.codigo, indice: v.indice });
    });
    if (lista.length) cadeias.push(ordenarCadeia(lista, g.totalNoCsv));
  });

  // 2) âncoras: vértice certificado ↔ ponto nosso a ≤ tolerância
  const ancoraTxt = new Map<number, { grupo: number; idx: number; distM: number }>();
  const ancoraCert = new Map<string, number>();
  const chave = (c: Cert) => `${c.grupo}:${c.idx}`;
  for (const cad of cadeias) {
    for (const c of cad) {
      let iv = -1, dv = Infinity;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(txt[i].e - c.pt[0], txt[i].n - c.pt[1]);
        if (d < dv) { dv = d; iv = i; }
      }
      if (dv <= tol && !ancoraTxt.has(iv)) {
        ancoraTxt.set(iv, { grupo: c.grupo, idx: c.idx, distM: dv });
        ancoraCert.set(chave(c), iv);
      }
    }
  }

  // 3) anel de trabalho
  type No = EntradaAnel;
  let anel: No[] = txt.map((_, i) => {
    const ig = ancoraTxt.get(i);
    return ig ? { origem: "txt", idx: i, igualado: ig } : { origem: "txt", idx: i };
  });
  const certPt = new Map<string, Pt>();
  for (const cad of cadeias) for (const c of cad) certPt.set(chave(c), c.pt);
  const posDe = (no: No): Pt => {
    if (no.origem === "certificado") return certPt.get(`${no.grupo}:${no.idx}`)!;
    if (no.igualado) return certPt.get(`${no.igualado.grupo}:${no.igualado.idx}`)!;
    return [txt[no.idx].e, txt[no.idx].n];
  };
  const noCert = (c: Cert): No => ({ origem: "certificado", grupo: c.grupo, idx: c.idx });
  const noDoTxt = (i: number): No => anel.find((x) => x.origem === "txt" && x.idx === i)!;
  const descartavel = (no: No, poli: Pt[]): boolean =>
    no.origem === "txt" && !no.igualado && distPolilinha(posDe(no), poli) <= tolLinha;
  const removidos: number[] = [];

  // Descarta os nós marcados; um M descartado passa a confrontação ao próximo
  // nó mantido (na direção do anel), como faz a correção de sobreposição.
  function removerNos(marcados: Set<No>) {
    if (!marcados.size) return;
    anel.forEach((no, i) => {
      if (!marcados.has(no) || no.origem !== "txt") return;
      removidos.push(no.idx);
      if (!inicios.has(no.idx)) return;
      for (let s = 1; s < anel.length; s++) {
        const prox = anel[(i + s) % anel.length];
        if (marcados.has(prox)) continue;
        const jaEhM = (prox.origem === "txt" && inicios.has(prox.idx)) || prox.herdaConfrontacaoDe !== undefined;
        if (jaEhM) avisos.push(`Confrontação do ${nomeTxt(no.idx)} descartada: o trecho ficou inteiro sobre a divisa certificada.`);
        else prox.herdaConfrontacaoDe = no.idx;
        break;
      }
    });
    anel = anel.filter((no) => !marcados.has(no));
  }

  // trecho da cadeia entre duas âncoras substitui o caminho do TXT entre elas
  function encaixarEntre(interior: Cert[], ia: number, ib: number) {
    const noA = noDoTxt(ia), noB = noDoTxt(ib);
    const pa = anel.indexOf(noA), pb = anel.indexOf(noB);
    const poli: Pt[] = [posDe(noA), ...interior.map((c) => c.pt), posDe(noB)];
    const arco = (de: number, ate: number): No[] => {
      const out: No[] = [];
      for (let p = (de + 1) % anel.length; p !== ate; p = (p + 1) % anel.length) out.push(anel[p]);
      return out;
    };
    const frente = arco(pa, pb), tras = arco(pb, pa);
    const ok = (arc: No[]) => arc.every((no) => descartavel(no, poli));
    let escolhido: No[], paraFrente: boolean;
    if (ok(frente)) { escolhido = frente; paraFrente = true; }
    else if (ok(tras)) { escolhido = tras; paraFrente = false; }
    else {
      paraFrente = frente.length <= tras.length;
      escolhido = paraFrente ? frente : tras;
      const mantidos = escolhido.filter((no) => !descartavel(no, poli));
      avisos.push(`Entre ${nomeTxt(ia)} e ${nomeTxt(ib)} há ${mantidos.length} ponto(s) fora da divisa certificada — mantidos; confira a ordem na conferência.`);
    }
    removerNos(new Set(escolhido.filter((no) => descartavel(no, poli))));
    const seq = (paraFrente ? interior : [...interior].reverse()).map(noCert);
    const ancora = paraFrente ? noDoTxt(ia) : noDoTxt(ib);
    const p = anel.indexOf(ancora);
    anel.splice(p + 1, 0, ...seq);
  }

  // ponta da cadeia presa a uma âncora: `cabeca[último]` é vizinho da âncora
  function encaixarCabeca(cabeca: Cert[], ia: number) {
    if (!cabeca.length) return;
    const noA = noDoTxt(ia);
    const pa = anel.indexOf(noA);
    const pts = cabeca.map((c) => c.pt);
    const poli: Pt[] = [...pts, posDe(noA)];
    const len = compr(poli) - 0; // inclui o lance até a âncora
    // caminha para um lado descartando o que está sobre a divisa; devolve o custo
    const lado = (dir: 1 | -1) => {
      const drop: No[] = [];
      let p = pa;
      for (let s = 1; s < anel.length; s++) {
        const no = anel[(pa + dir * s + anel.length * s) % anel.length];
        if (!descartavel(no, poli)) { p = (pa + dir * s + anel.length * s) % anel.length; break; }
        drop.push(no);
      }
      const vizinho = anel[p];
      const antigo = compr([posDe(vizinho), ...drop.slice().reverse().map(posDe), posDe(noA)]);
      const novo = dist(posDe(vizinho), pts[0]) + len;
      return { dir, drop, delta: novo - antigo };
    };
    const antes = lado(-1), depois = lado(1);
    const esc = antes.delta <= depois.delta ? antes : depois;
    removerNos(new Set(esc.drop));
    const p = anel.indexOf(noDoTxt(ia));
    if (esc.dir === -1) anel.splice(p, 0, ...cabeca.map(noCert));
    else anel.splice(p + 1, 0, ...[...cabeca].reverse().map(noCert));
  }

  // cadeia sem âncora: lado do anel e orientação que menos alongam o perímetro
  function inserirLivre(cad: Cert[]) {
    const pts = cad.map((c) => c.pt);
    const len = compr(pts);
    let melhor = { delta: Infinity, p: -1, inverte: false };
    for (let p = 0; p < anel.length; p++) {
      const u = posDe(anel[p]), v = posDe(anel[(p + 1) % anel.length]);
      const duv = dist(u, v);
      const d1 = dist(u, pts[0]) + len + dist(pts[pts.length - 1], v) - duv;
      const d2 = dist(u, pts[pts.length - 1]) + len + dist(pts[0], v) - duv;
      if (d1 < melhor.delta) melhor = { delta: d1, p, inverte: false };
      if (d2 < melhor.delta) melhor = { delta: d2, p, inverte: true };
    }
    const seq = (melhor.inverte ? [...cad].reverse() : cad).map(noCert);
    anel.splice(melhor.p + 1, 0, ...seq);
  }

  // 4) cadeias ancoradas primeiro (a posição delas é determinada), livres depois
  const livres: Cert[][] = [];
  for (const cad of cadeias) {
    const anc = cad.map((c, k) => ({ k, txt: ancoraCert.get(chave(c)) })).filter((a) => a.txt !== undefined) as { k: number; txt: number }[];
    if (!anc.length) { livres.push(cad); continue; }
    for (let a = 0; a + 1 < anc.length; a++) encaixarEntre(cad.slice(anc[a].k + 1, anc[a + 1].k), anc[a].txt, anc[a + 1].txt);
    encaixarCabeca(cad.slice(0, anc[0].k), anc[0].txt);
    const ult = anc[anc.length - 1];
    encaixarCabeca(cad.slice(ult.k + 1).reverse(), ult.txt);
  }
  for (const cad of livres) inserirLivre(cad);

  // 5) sanidade: o anel unido não pode se cruzar
  const P = anel.map(posDe);
  let cruza = false;
  for (let i = 0; i < P.length && !cruza; i++) {
    for (let j = i + 2; j < P.length; j++) {
      if (i === 0 && j === P.length - 1) continue;
      if (segmentosCruzam(P[i], P[(i + 1) % P.length], P[j], P[(j + 1) % P.length])) { cruza = true; break; }
    }
  }
  if (cruza) avisos.push("O perímetro unido se cruza — confira a ordem dos pontos e os vértices escolhidos na conferência.");

  const inseridos = anel.filter((x) => x.origem === "certificado").length;
  return { anel, igualados: ancoraTxt.size, inseridos, removidos: removidos.sort((a, b) => a - b), avisos };
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
 *   vira P aqui — no nosso anel, M significa "inicia confrontação";
 * - quem HERDA a confrontação de um M descartado vira M com o apelido dele.
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
  // confrontação que a linha carrega: a própria (início de trecho) ou a herdada
  const confrontacao = (proprio: number | null, herdado: number | undefined) => {
    const origem = proprio !== null && inicios.has(proprio) ? proprio : herdado;
    if (origem === undefined) return null;
    return { apelido: apelidoPor.get(origem) ?? null, ehVia: viaPor.get(origem) ?? false };
  };

  return uniao.anel.map((ent, ordem): VerticeUnido => {
    if (ent.origem === "txt") {
      const p = pontos[ent.idx];
      const conf = confrontacao(ent.idx, ent.herdaConfrontacaoDe);
      const gms = latLonGmsDoTxt(ent.idx);
      const base: VerticeUnido = {
        ordem, num_txt: p.num, rotulo_txt: p.rotulo,
        e: p.e, n: p.n, h: p.h, sigma_pos: p.sigmaPos, sigma_h: p.sigmaH,
        tipo: conf ? "M" : "P", codigo: null, codigo_provisorio: false, metodo: "PG6", inserido_manual: false,
        lat_gms: gms.lat, lon_gms: gms.lon,
        apelido_txt: conf?.apelido ?? null,
        descritivo: conf ? "" : null,
        tipo_limite: conf ? "LA1" : null,
        eh_via: conf?.ehVia ?? false,
        txt_idx: ent.idx, certificado: null,
      };
      if (!ent.igualado) return base;
      const c = doCertificado(ent.igualado);
      return {
        ...base,
        e: c.e, n: c.n, h: c.vc.h,
        sigma_pos: c.sigmaPos || p.sigmaPos, sigma_h: c.vc.sigmaZ || p.sigmaH,
        tipo: conf ? "M" : (c.vc.tipo === "M" ? "P" : c.vc.tipo),
        codigo: c.vc.codigo, metodo: c.vc.metodo || "PG2", inserido_manual: true,
        lat_gms: c.lat_gms, lon_gms: c.lon_gms,
        certificado: c.vc.codigo,
      };
    }
    const c = doCertificado(ent);
    const conf = confrontacao(null, ent.herdaConfrontacaoDe);
    return {
      ordem, num_txt: null, rotulo_txt: null,
      e: c.e, n: c.n, h: c.vc.h, sigma_pos: c.sigmaPos || 0.05, sigma_h: c.vc.sigmaZ || 0.05,
      tipo: conf ? "M" : (c.vc.tipo === "M" ? "P" : c.vc.tipo),
      codigo: c.vc.codigo, codigo_provisorio: false, metodo: c.vc.metodo || "PG2", inserido_manual: true,
      lat_gms: c.lat_gms, lon_gms: c.lon_gms,
      apelido_txt: conf?.apelido ?? null, descritivo: conf ? "" : null, tipo_limite: conf ? "LA1" : null,
      eh_via: conf?.ehVia ?? false,
      txt_idx: null, certificado: c.vc.codigo,
    };
  });
}

// ---------------------------------------------------------------------------
// Escolha do fuso quando há vizinhos certificados
// ---------------------------------------------------------------------------

/**
 * O TXT sozinho é ambíguo perto de E = 500 km (a Bahia atravessa os fusos 23 e
 * 24 e a UF não decide). Os CSVs têm lon/lat: o fuso certo é o candidato em que
 * o centroide do TXT cai ao lado dos vértices certificados.
 */
export function fusoPelosCertificados<T extends { zone: number; lonCentroide: number; latCentroide: number }>(
  candidatos: T[],
  grupos: GrupoCertificado[],
): { escolhido: T; distanciaGraus: number } | null {
  const vs = grupos.flatMap((g) => g.vertices);
  if (!candidatos.length || !vs.length) return null;
  let lon = 0, lat = 0;
  for (const v of vs) { const [lo, la] = lonLatDoVerticeSigef(v); lon += lo; lat += la; }
  lon /= vs.length; lat /= vs.length;
  let melhor = candidatos[0], dm = Infinity;
  for (const c of candidatos) {
    const d = Math.hypot(c.lonCentroide - lon, c.latCentroide - lat);
    if (d < dm) { dm = d; melhor = c; }
  }
  return { escolhido: melhor, distanciaGraus: dm };
}
