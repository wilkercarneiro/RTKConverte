// Planta de UM lote (ou de uma área pública) em A4, do pacote "lote a lote"
// (loteALote.ts). Vai junto com o memorial e a locação do lote e usa os MESMOS
// nomes de vértice da locação: o técnico acha no papel o "A-07" da coletora.
//
//   ┌ título (lote e quadra, loteamento) ─────────────────────── empresa ┐
//   │ desenho em escala: o lote e os vizinhos em volta │ situação (o lote │
//   │ (lotes, ruas, áreas), medidas e azimutes, nomes  │ no loteamento)   │
//   │ dos vértices, confrontantes, norte e escala      │ quadro de medidas│
//   ├ tabela de coordenadas: vértice, E, N, azimute, distância, confrontante┤
//   └ carimbo: empresa, RT, loteamento, quadra/lote, área, perímetro, local ┘
//
// pdf-lib com as fontes padrão (nada embutido): o PDF de um lote fica com
// poucas dezenas de KB e o servidor gera dezenas deles numa chamada. Por isso a
// logo só entra se for pequena (a de vários MB iria 60 vezes para o zip).
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";
import { textoWinAnsi } from "../../../supabase/functions/_shared/texto.ts";
import { fmtAzimute } from "../../../supabase/functions/_shared/geo.ts";
import { areaPol, caixa, centroide, intersecao, pontoDoRotulo, sub, unit } from "./geom.ts";
import type { Anel, Poligono, Pt } from "./geom.ts";
import { fmt, viarioDe } from "./calculo.ts";
import type { Resultado } from "./calculo.ts";
import type { TipoArea } from "./modelo.ts";
import { fit, rosaDosVentos, texto, textoCentrado } from "./planta.ts";
import type { DadosCarimbo } from "./planta.ts";
import { paraUtm } from "./plano.ts";

const MM = 72 / 25.4;
const A4: [number, number] = [210 * MM, 297 * MM];
/** escalas normalizadas da planta do lote (o lote ocupa a maior parte do desenho) */
const ESCALAS = [50, 75, 100, 125, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000];
/** logo maior que isto não entra (o pacote leva uma planta por lote) */
export const LOGO_MAX_LOTE = 300 * 1024;

const T = (s: string) => textoWinAnsi(s);
const CINZA = (v: number) => rgb(v, v, v);
const VERDE_LOTE = rgb(0.1, 0.62, 0.1);
const MARINHO = rgb(0.05, 0.08, 0.42);
const VERMELHO = rgb(0.62, 0.1, 0.08);
const AZUL_CONF = rgb(0.1, 0.25, 0.5);
const DESTAQUE = rgb(0.9, 0.36, 0.1);
const COR_AREA: Record<string, RGB> = {
  verde: rgb(0.78, 0.92, 0.7), institucional: rgb(0.99, 0.86, 0.68), lazer: rgb(0.78, 0.9, 0.96), app: rgb(0.74, 0.85, 0.96),
};

/** Um trecho do perímetro entre dois vértices com nome (o arco da esquina é UM trecho). */
export interface TrechoFolha {
  de: string;
  ate: string;
  /** pontos do trecho no plano (2 no lado reto; do PC ao PT no arco) */
  pts: Pt[];
  /** distância (reto) ou desenvolvimento (curva), m */
  comp: number;
  /** azimute da corda, graus */
  az: number;
  raio: number | null;
  confrontante: string;
}

export interface FolhaItem {
  /** "LOTE 05 DA QUADRA A" / "ÁREA VERDE 01" */
  titulo: string;
  /** "Quadra A — Lote 05" (carimbo) */
  quadraLote: string;
  tipo: "lote" | TipoArea;
  pol: Poligono;
  /** vértices com nome, na ordem do memorial (o 1º é o início da descrição) */
  vertices: { p: Pt; nome: string }[];
  /** trecho i: do vértice i ao i+1 */
  trechos: TrechoFolha[];
  area: number;
  perimetro: number;
  /** quadro de medidas: [rótulo, valor] */
  medidas: [string, string][];
  /** o próprio lote (não volta a ser desenhado como vizinho) */
  idLote?: string;
}

export interface DadosFolha { loteamento: string; municipio: string; uf: string; fuso: number; proprietario?: string }

interface Vista { cx: number; cy: number; ptm: number; ox: number; oy: number; hw: number; hh: number; pol: Poligono }

const anelSvg = (a: Anel, v: Vista) => "M" + a.map((p) => `${((p[0] - v.cx) * v.ptm).toFixed(2)} ${(-(p[1] - v.cy) * v.ptm).toFixed(2)}`).join("L") + "Z";
const polSvg = (pg: Poligono, v: Vista) => anelSvg(pg.ext, v) + pg.furos.map((f) => anelSvg(f, v)).join("");

function desenharPol(page: PDFPage, pg: Poligono, v: Vista, o: { cor?: RGB; borda?: RGB; esp?: number; opac?: number }) {
  if (pg.ext.length < 3) return;
  page.drawSvgPath(polSvg(pg, v), { x: v.ox, y: v.oy, color: o.cor, borderColor: o.borda, borderWidth: o.esp ?? 0, opacity: o.opac });
}

/** Só o que aparece no desenho (o resto do loteamento fica de fora da folha). */
function naVista(pgs: Poligono[], v: Vista): Poligono[] {
  const out: Poligono[] = [];
  for (const pg of pgs) {
    const b = caixa(pg.ext);
    if (b.max[0] < v.cx - v.hw || b.min[0] > v.cx + v.hw || b.max[1] < v.cy - v.hh || b.min[1] > v.cy + v.hh) continue;
    const dentro = b.min[0] >= v.cx - v.hw && b.max[0] <= v.cx + v.hw && b.min[1] >= v.cy - v.hh && b.max[1] <= v.cy + v.hh;
    out.push(...(dentro ? [pg] : intersecao([pg], [v.pol])));
  }
  return out;
}

/** Segmento recortado pela vista (Liang–Barsky); null se fica fora. */
function recortarSegmento(a: Pt, b: Pt, v: Vista): [Pt, Pt] | null {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const lim: [number, number][] = [[-dx, a[0] - (v.cx - v.hw)], [dx, v.cx + v.hw - a[0]], [-dy, a[1] - (v.cy - v.hh)], [dy, v.cy + v.hh - a[1]]];
  for (const [p, q] of lim) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + dx * t0, a[1] + dy * t0], [a[0] + dx * t1, a[1] + dy * t1]];
}

const angLegivel = (d: Pt) => { let a = (Math.atan2(d[1], d[0]) * 180) / Math.PI; if (a > 90) a -= 180; if (a <= -90) a += 180; return a; };

/**
 * Planta A4 do lote (ou da área pública). `res` é o loteamento inteiro: os
 * vizinhos aparecem em volta, recortados pela folha, e a situação mostra onde
 * o lote fica.
 */
export async function gerarPlantaDoItem(item: FolhaItem, res: Resultado, c: DadosCarimbo, d: DadosFolha): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(T(`${item.titulo} — ${d.loteamento}`));
  pdf.setCreator("Vertces");
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (c.logo && c.logo.bytes.length <= LOGO_MAX_LOTE) {
    try { logo = c.logo.tipo === "png" ? await pdf.embedPng(c.logo.bytes) : await pdf.embedJpg(c.logo.bytes); } catch { logo = null; }
  }
  const [W, H] = A4;
  const mO = 10 * MM, mL = 15 * MM;
  const x0 = mL, x1 = W - mO, y0 = mO, y1 = H - mO;
  const larg = x1 - x0;
  const hTitulo = 15 * MM, hCarimbo = 40 * MM;
  const ALT_LINHA = 10.5, CAB_TAB = 16;
  // a tabela cabe na 1ª folha até deixar 115 mm de desenho; o resto vai para a continuação
  const maxLinhas1 = Math.max(4, Math.floor((y1 - y0 - hTitulo - hCarimbo - 115 * MM - CAB_TAB - 8) / ALT_LINHA));
  const linhas1 = Math.min(item.vertices.length, maxLinhas1);
  const hTab = CAB_TAB + linhas1 * ALT_LINHA + 8;
  const yCarimboTopo = y0 + hCarimbo;
  const yTabTopo = yCarimboTopo + hTab;
  const yDesTopo = y1 - hTitulo;
  const colW = 60 * MM;
  const area = { x: x0 + 4, y: yTabTopo + 4, w: larg - colW - 8, h: yDesTopo - yTabTopo - 8 };

  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: x0, y: y0, width: larg, height: y1 - y0, borderWidth: 1.4, borderColor: CINZA(0) });
  page.drawLine({ start: { x: x0, y: yDesTopo }, end: { x: x1, y: yDesTopo }, thickness: 1 });
  page.drawLine({ start: { x: x0, y: yTabTopo }, end: { x: x1, y: yTabTopo }, thickness: 1 });
  page.drawLine({ start: { x: x0, y: yCarimboTopo }, end: { x: x1, y: yCarimboTopo }, thickness: 1 });
  page.drawLine({ start: { x: x1 - colW, y: yTabTopo }, end: { x: x1 - colW, y: yDesTopo }, thickness: 0.8 });

  // ------------------------------------------------------------ título
  const rotuloFolha = item.tipo === "lote" ? "PLANTA DO LOTE" : "PLANTA DA ÁREA PÚBLICA";
  texto(page, fonte, rotuloFolha, x0 + 8, y1 - 13, 7, CINZA(0.4));
  texto(page, negrito, fit(item.titulo, negrito, 14, larg * 0.62), x0 + 8, y1 - 29, 14, CINZA(0));
  texto(page, fonte, fit(`Loteamento ${d.loteamento}${d.municipio ? ` · ${d.municipio}${d.uf ? `/${d.uf}` : ""}` : ""}`, fonte, 8, larg * 0.62), x0 + 8, y1 - 40, 8, CINZA(0.3));
  if (c.empresa) {
    const t = fit(c.empresa.toUpperCase(), negrito, 9, larg * 0.34);
    texto(page, negrito, t, x1 - 8 - negrito.widthOfTextAtSize(T(t), 9), y1 - 22, 9, CINZA(0.15));
    if (c.cnpj) { const t2 = T(`CNPJ ${c.cnpj}`); texto(page, fonte, t2, x1 - 8 - fonte.widthOfTextAtSize(t2, 6.5), y1 - 32, 6.5, CINZA(0.4)); }
  }

  // ------------------------------------------------------------ desenho em escala
  const bb = caixa(item.pol.ext);
  const folga = 46; // pontos de cada lado para as medidas e os confrontantes
  const precisa = Math.max(((bb.max[0] - bb.min[0]) * 1000 * MM) / Math.max(10, area.w - 2 * folga), ((bb.max[1] - bb.min[1]) * 1000 * MM) / Math.max(10, area.h - 2 * folga));
  const den = ESCALAS.find((e) => e >= precisa) ?? Math.ceil(precisa / 1000) * 1000;
  const ptm = (1000 / den) * MM;
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const hw = area.w / 2 / ptm, hh = area.h / 2 / ptm;
  const v: Vista = {
    cx, cy, ptm, ox: area.x + area.w / 2, oy: area.y + area.h / 2, hw, hh,
    pol: { ext: [[cx - hw, cy - hh], [cx + hw, cy - hh], [cx + hw, cy + hh], [cx - hw, cy + hh]], furos: [] },
  };
  const P = (p: Pt): Pt => [v.ox + (p[0] - cx) * ptm, v.oy + (p[1] - cy) * ptm];

  // vizinhança: viário, áreas, remanescente, lotes, divisa da gleba
  for (const pg of naVista(viarioDe(res), v)) desenharPol(page, pg, v, { cor: CINZA(0.9) });
  for (const a of res.publicas) for (const pg of naVista([a.pol], v)) desenharPol(page, pg, v, { cor: COR_AREA[a.tipo], opac: 0.55 });
  for (const pg of naVista(res.sobras, v)) desenharPol(page, pg, v, { cor: CINZA(0.96) });
  const tamViz = Math.max(5, Math.min(9, 10 * ptm * 0.22));
  for (const l of res.lotes) {
    if (l.id === item.idLote) continue;
    const pecas = naVista([l.pol], v);
    if (!pecas.length) continue;
    for (const pg of pecas) desenharPol(page, pg, v, { borda: CINZA(0.62), esp: 0.5 });
    const c2 = centroide(l.pol.ext);
    if (Math.abs(c2[0] - cx) < hw - 2 / ptm && Math.abs(c2[1] - cy) < hh - 2 / ptm) {
      const q = P(c2);
      textoCentrado(page, fonte, String(l.numero).padStart(2, "0"), q[0], q[1], tamViz, CINZA(0.55));
    }
  }
  const glebaExt = res.gleba.ext;
  for (let i = 0; i < glebaExt.length; i++) {
    const s = recortarSegmento(glebaExt[i], glebaExt[(i + 1) % glebaExt.length], v);
    if (!s) continue;
    const A = P(s[0]), B = P(s[1]);
    page.drawLine({ start: { x: A[0], y: A[1] }, end: { x: B[0], y: B[1] }, thickness: 1.3, color: MARINHO });
  }
  // nome das ruas que aparecem na folha (no meio do maior pedaço visível)
  for (const r of res.ruas) {
    const pecas = naVista(r.pols, v).filter((pg) => areaPol(pg) > 4);
    if (!pecas.length) continue;
    const maior = pecas.sort((a, b) => areaPol(b) - areaPol(a))[0];
    const tam = Math.max(5.5, Math.min(8, r.largura * ptm * 0.32));
    const rot = T(r.nome.toUpperCase());
    // deitado ao longo do pedaço: a direção do lado mais comprido dele
    let ang = 0, ml = 0;
    for (let i = 0; i < maior.ext.length; i++) {
      const a = maior.ext[i], b = maior.ext[(i + 1) % maior.ext.length];
      const l2 = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l2 > ml) { ml = l2; ang = angLegivel(sub(b, a)); }
    }
    const pr = negrito.widthOfTextAtSize(rot, tam) / tam / ptm;
    const c2 = P(pontoDoRotulo(maior, Math.max(1, pr)));
    textoCentrado(page, negrito, rot, c2[0], c2[1], tam, VERMELHO, Math.abs(ang) < 45 ? ang : 0);
  }

  // o lote
  const fundo = item.tipo === "lote" ? rgb(0.92, 0.97, 0.89) : COR_AREA[item.tipo] ?? CINZA(0.9);
  desenharPol(page, item.pol, v, { cor: fundo, borda: item.tipo === "lote" ? VERDE_LOTE : CINZA(0.2), esp: 1.4 });
  // título dentro do lote: do tamanho que cabe (a faixa estreita de área verde pede letra menor)
  const espessura = (2 * item.area) / Math.max(1, item.perimetro) * ptm;
  const tamTit = Math.max(6, Math.min(14, Math.sqrt(item.area) * ptm * 0.16, 0.4 * espessura));
  const titulo = item.tipo === "lote" ? item.titulo.replace(/ DA QUADRA .*/, "") : item.titulo;
  const centro = P(pontoDoRotulo(item.pol, Math.max(1, negrito.widthOfTextAtSize(T(titulo), tamTit) / (2.2 * tamTit))));
  textoCentrado(page, negrito, titulo, centro[0], centro[1] + tamTit * 0.5, tamTit, CINZA(0.05));
  textoCentrado(page, fonte, `${fmt(item.area)} m²`, centro[0], centro[1] - tamTit * 0.75, tamTit * 0.7, CINZA(0.15));

  // medidas, azimutes e confrontantes de cada trecho (por fora: medida e vizinho; por dentro: azimute).
  // O arco da esquina (PC → meio → PT) leva UM rótulo, com o desenvolvimento e o raio.
  const nt = item.trechos.length;
  const rotuloArco = new Map<number, { D: number; R: number; pc: Pt; pt: Pt; meio: Pt }>();
  {
    const ini = Math.max(0, item.trechos.findIndex((t) => !t.raio));
    let corrida: number[] = [];
    const fechar = () => {
      if (!corrida.length) return;
      const ts = corrida.map((k) => item.trechos[k]);
      const todos = ts.flatMap((t, k) => (k ? t.pts.slice(1) : t.pts));
      rotuloArco.set(corrida[0], {
        D: ts.reduce((s, t) => s + t.comp, 0), R: ts.reduce((s, t) => s + (t.raio ?? 0), 0) / ts.length,
        pc: todos[0], pt: todos[todos.length - 1], meio: todos[Math.floor(todos.length / 2)],
      });
      corrida = [];
    };
    for (let k = 0; k < nt; k++) {
      const i = (ini + k) % nt;
      if (item.trechos[i].raio) corrida.push(i); else fechar();
    }
    fechar();
  }
  let confAnterior = "";
  item.trechos.forEach((t, i) => {
    const a = t.pts[0], b = t.pts[t.pts.length - 1];
    const d0 = unit(sub(b, a));
    const fora: Pt = [d0[1], -d0[0]]; // anel anti-horário: o interior fica à esquerda
    const ang = angLegivel(d0);
    const M = P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const compPapel = t.comp * ptm;
    const tamM = Math.max(5, Math.min(7.5, compPapel / 7));
    const arco = rotuloArco.get(i);
    if (arco) {
      const dA = unit(sub(arco.pt, arco.pc));
      const Ma = P(arco.meio);
      textoCentrado(page, negrito, `D = ${fmt(arco.D)} m · R = ${fmt(arco.R)} m`, Ma[0] + dA[1] * 24, Ma[1] - dA[0] * 24, 6, CINZA(0.05));
    } else if (!t.raio) {
      const medida = `${fmt(t.comp)} m`;
      if (compPapel > fonte.widthOfTextAtSize(T(medida), tamM) * 0.6) textoCentrado(page, negrito, medida, M[0] + fora[0] * 6, M[1] + fora[1] * 6, tamM, CINZA(0.05), ang);
      if (compPapel > 30) textoCentrado(page, fonte, fmtAzimute(t.az), M[0] - fora[0] * 6, M[1] - fora[1] * 6, tamM * 0.85, CINZA(0.3), ang);
    }
    // o mesmo vizinho em trechos seguidos: um rótulo só, no mais comprido
    if (t.confrontante && t.confrontante !== confAnterior) {
      let maior = t, j = i;
      while (j + 1 < item.trechos.length && item.trechos[j + 1].confrontante === t.confrontante) { j++; if (item.trechos[j].comp > maior.comp) maior = item.trechos[j]; }
      const ma = maior.pts[0], mb = maior.pts[maior.pts.length - 1];
      const dm = unit(sub(mb, ma));
      const fm: Pt = [dm[1], -dm[0]];
      const Mm = P(maior.raio ? maior.pts[Math.floor(maior.pts.length / 2)] : [(ma[0] + mb[0]) / 2, (ma[1] + mb[1]) / 2]);
      const tamC = 6.5;
      const txt = fit(T(maior.confrontante.toUpperCase()), fonte, tamC, Math.max(95, maior.comp * ptm * 1.6));
      textoCentrado(page, fonte, txt, Mm[0] + fm[0] * 19, Mm[1] + fm[1] * 19, tamC, AZUL_CONF, maior.raio ? 0 : angLegivel(dm));
    }
    confAnterior = t.confrontante;
  });

  // vértices com o nome da locação (por fora, na bissetriz)
  const nv = item.vertices.length;
  item.vertices.forEach((vt, i) => {
    const ant = item.trechos[(i - 1 + nv) % nv], prox = item.trechos[i];
    const dir = (t: TrechoFolha | undefined) => {
      if (!t) return [0, 0] as Pt;
      const a = t.pts[0], b = t.pts[t.pts.length - 1];
      const u = unit(sub(b, a));
      return [u[1], -u[0]] as Pt;
    };
    const n1 = dir(ant), n2 = dir(prox);
    let bis = unit([n1[0] + n2[0], n1[1] + n2[1]]);
    if (!Number.isFinite(bis[0]) || (Math.abs(bis[0]) < 1e-9 && Math.abs(bis[1]) < 1e-9)) bis = n2;
    const Q = P(vt.p);
    page.drawCircle({ x: Q[0], y: Q[1], size: 1.8, color: CINZA(1), borderColor: CINZA(0), borderWidth: 0.8 });
    textoCentrado(page, negrito, vt.nome, Q[0] + bis[0] * 11, Q[1] + bis[1] * 9, 6.2, CINZA(0.05));
  });

  // norte e escala
  rosaDosVentos(page, negrito, area.x + 24, area.y + area.h - 30, 18);
  const passo = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((p) => p * ptm >= 28) ?? 1000;
  const ex = area.x + 10, ey = area.y + 10;
  for (let i = 0; i < 4; i++) page.drawRectangle({ x: ex + i * passo * ptm, y: ey, width: passo * ptm, height: 3.5, color: i % 2 ? CINZA(1) : CINZA(0), borderColor: CINZA(0), borderWidth: 0.4 });
  for (let i = 0; i <= 4; i++) texto(page, fonte, `${passo * i}${i === 4 ? " m" : ""}`, ex + i * passo * ptm - 2, ey + 6, 5.5, CINZA(0.2));
  texto(page, negrito, `ESCALA 1:${den}`, ex, ey + 15, 7, CINZA(0.1));

  // ------------------------------------------------------------ coluna da direita: situação e medidas
  const cxCol = x1 - colW;
  const hSit = (yDesTopo - yTabTopo) * 0.56;
  {
    const top = yDesTopo, base = yDesTopo - hSit;
    page.drawLine({ start: { x: cxCol, y: base }, end: { x: x1, y: base }, thickness: 0.8 });
    texto(page, negrito, "SITUAÇÃO", cxCol + 6, top - 11, 7, CINZA(0.1));
    const box = { x: cxCol + 6, y: base + 6, w: colW - 12, h: hSit - 24 };
    const g = caixa(res.gleba.ext);
    const s = Math.min(box.w / Math.max(1, g.max[0] - g.min[0]), box.h / Math.max(1, g.max[1] - g.min[1]));
    const vs: Vista = {
      cx: (g.min[0] + g.max[0]) / 2, cy: (g.min[1] + g.max[1]) / 2, ptm: s, ox: box.x + box.w / 2, oy: box.y + box.h / 2, hw: 0, hh: 0, pol: res.gleba,
    };
    desenharPol(page, res.gleba, vs, { cor: CINZA(0.88), borda: MARINHO, esp: 0.8 });
    for (const q of res.quadras) desenharPol(page, q.pol, vs, { cor: CINZA(1), borda: CINZA(0.55), esp: 0.3 });
    for (const a of res.publicas) desenharPol(page, a.pol, vs, { cor: COR_AREA[a.tipo] });
    desenharPol(page, item.pol, vs, { cor: DESTAQUE, borda: DESTAQUE, esp: 0.6 });
    // o lote é pequeno na situação: um círculo em volta mostra onde ele fica
    const cc = centroide(item.pol.ext);
    const Cs: Pt = [vs.ox + (cc[0] - vs.cx) * s, vs.oy + (cc[1] - vs.cy) * s];
    page.drawCircle({ x: Cs[0], y: Cs[1], size: 7, borderColor: DESTAQUE, borderWidth: 1 });
  }
  {
    const top = yDesTopo - hSit;
    texto(page, negrito, "MEDIDAS", cxCol + 6, top - 11, 7, CINZA(0.1));
    let yy = top - 24;
    const passoM = Math.min(15, (top - yTabTopo - 28) / Math.max(1, item.medidas.length));
    for (const [rot, val] of item.medidas) {
      texto(page, fonte, rot.toUpperCase(), cxCol + 6, yy + 6, 5.3, CINZA(0.45));
      texto(page, negrito, fit(val, negrito, 7.2, colW - 12), cxCol + 6, yy - 2, 7.2, CINZA(0.05));
      yy -= passoM;
    }
  }

  // ------------------------------------------------------------ tabela de coordenadas
  const colunas: [string, number][] = [["VÉRTICE", 0.11], ["E (m)", 0.15], ["N (m)", 0.16], ["AZIMUTE", 0.13], ["DIST. (m)", 0.1], ["CONFRONTANTE", 0.35]];
  const linhaTab = (i: number): string[] => {
    const vt = item.vertices[i], t = item.trechos[i];
    const u = paraUtm(res.plano, vt.p);
    const conf = t ? `${t.confrontante}${t.raio ? ` (curva, R = ${fmt(t.raio)} m)` : ""}` : "";
    return [vt.nome, fmt(u[0], 3), fmt(u[1], 3), t ? fmtAzimute(t.az) : "", t ? fmt(t.comp) : "", conf];
  };
  const tabela = (pg: PDFPage, topo: number, de: number, ate: number) => {
    const xT = x0 + 6, wT = larg - 12;
    texto(pg, negrito, `TABELA DE COORDENADAS (SIRGAS 2000, UTM ${d.fuso}S)`, xT, topo - 11, 7, CINZA(0.1));
    let y = topo - CAB_TAB - 4;
    pg.drawRectangle({ x: xT, y: y - 3, width: wT, height: ALT_LINHA, color: CINZA(0.9) });
    let xx = xT;
    for (const [h, f] of colunas) { texto(pg, negrito, h, xx + 2, y, 6, CINZA(0)); xx += wT * f; }
    y -= ALT_LINHA;
    for (let i = de; i < ate; i++) {
      xx = xT;
      linhaTab(i).forEach((val, k) => {
        const w = wT * colunas[k][1];
        const f = k === 0 ? negrito : fonte;
        texto(pg, f, fit(val, f, 6.6, w - 4), xx + 2, y, 6.6, CINZA(0.05));
        xx += w;
      });
      pg.drawLine({ start: { x: xT, y: y - 3 }, end: { x: xT + wT, y: y - 3 }, thickness: 0.25, color: CINZA(0.65) });
      y -= ALT_LINHA;
    }
  };
  tabela(page, yTabTopo, 0, linhas1);

  // ------------------------------------------------------------ carimbo
  {
    const caixaR = (x: number, ytop: number, w: number, h: number, rot: string) => {
      page.drawRectangle({ x, y: ytop - h, width: w, height: h, borderColor: CINZA(0), borderWidth: 0.6 });
      texto(page, fonte, rot, x + 3, ytop - 7, 5, CINZA(0.45));
    };
    const valor = (t: string, x: number, ytop: number, w: number, h: number, tam = 8) =>
      textoCentrado(page, negrito, fit(t || "—", negrito, tam, w - 6), x + w / 2, ytop - h / 2 - 2, tam, CINZA(0));
    const pad = 4, xc = x0 + pad, wc = larg - 2 * pad;
    let yy = yCarimboTopo - pad;
    // empresa | responsável técnico
    const hA = 44;
    const wE = wc * 0.45;
    caixaR(xc, yy, wE, hA, "EMPRESA");
    if (logo) {
      const s = Math.min((wE * 0.42) / logo.width, (hA - 12) / logo.height);
      page.drawImage(logo, { x: xc + 4, y: yy - hA + 4, width: logo.width * s, height: logo.height * s });
      texto(page, negrito, fit(c.empresa || "", negrito, 7, wE * 0.55), xc + wE * 0.44, yy - 20, 7, CINZA(0));
      if (c.cnpj) texto(page, fonte, T(`CNPJ ${c.cnpj}`), xc + wE * 0.44, yy - 30, 6, CINZA(0.3));
    } else {
      valor(c.empresa || "—", xc, yy, wE, hA, 9);
      if (c.cnpj) textoCentrado(page, fonte, T(`CNPJ ${c.cnpj}`), xc + wE / 2, yy - hA + 7, 6, CINZA(0.3));
    }
    const xR = xc + wE + 3, wR = wc - wE - 3;
    caixaR(xR, yy, wR, hA, "RESPONSÁVEL TÉCNICO");
    textoCentrado(page, negrito, fit((c.rt || "—").toUpperCase(), negrito, 8, wR - 8), xR + wR / 2, yy - 17, 8, CINZA(0));
    const rtLinhas = [
      [c.rtTitulo, c.rtRegistro].filter(Boolean).join(" · "),
      [c.credenciado ? `CREDENCIADO ${c.credenciado}` : "", c.trt ? `ART/TRT ${c.trt}` : ""].filter(Boolean).join(" · "),
    ].filter(Boolean);
    rtLinhas.forEach((t, i) => textoCentrado(page, fonte, fit(t, fonte, 6, wR - 8), xR + wR / 2, yy - 27 - i * 7.5, 6, CINZA(0.25)));
    yy -= hA + 3;
    // loteamento | quadra e lote | município
    const hB = 26;
    const campos2: [string, string, number][] = [
      ["LOTEAMENTO", d.loteamento.toUpperCase(), 0.42], ["IDENTIFICAÇÃO", item.quadraLote.toUpperCase(), 0.3], ["MUNICÍPIO / UF", [d.municipio, d.uf].filter(Boolean).join(" / ").toUpperCase(), 0.28],
    ];
    let xx = xc;
    for (const [rot, val, f] of campos2) { const w = wc * f - (f === 0.28 ? 0 : 3); caixaR(xx, yy, w, hB, rot); valor(val, xx, yy, w, hB); xx += w + 3; }
    yy -= hB + 3;
    // área | perímetro | escala | data | sistema
    const hC = yy - (y0 + pad);
    const campos3: [string, string, number][] = [
      ["ÁREA", `${fmt(item.area)} m²`, 0.19], ["PERÍMETRO", `${fmt(item.perimetro)} m`, 0.17], ["ESCALA", `1:${den}`, 0.13],
      ["DATA", new Date().toLocaleDateString("pt-BR", { timeZone: "America/Bahia" }), 0.14], ["SISTEMA GEODÉSICO", `SIRGAS 2000 · UTM ${d.fuso}S${res.plano.terreno ? " · medidas de terreno" : ""}`, 0.37],
    ];
    xx = xc;
    for (const [rot, val, f] of campos3) { const w = wc * f - (f === 0.37 ? 0 : 3); caixaR(xx, yy, w, hC, rot); valor(val, xx, yy, w, hC, f === 0.37 ? 6.5 : 8); xx += w + 3; }
    if (d.proprietario) texto(page, fonte, fit(`Proprietário: ${d.proprietario}`, fonte, 6, wc * 0.5), xc + 3, yy - hC + 3, 6, CINZA(0.35));
  }

  // ------------------------------------------------------------ continuação da tabela
  for (let de = linhas1, folha = 2; de < item.vertices.length; folha++) {
    const pg = pdf.addPage([W, H]);
    pg.drawRectangle({ x: x0, y: y0, width: larg, height: y1 - y0, borderWidth: 1.4, borderColor: CINZA(0) });
    texto(pg, negrito, fit(`${item.titulo} — continuação (folha ${folha})`, negrito, 11, larg - 16), x0 + 8, y1 - 18, 11, CINZA(0));
    const cabem = Math.floor((y1 - y0 - 40 - CAB_TAB) / ALT_LINHA);
    const ate = Math.min(item.vertices.length, de + cabem);
    tabela(pg, y1 - 26, de, ate);
    de = ate;
  }
  return pdf.save();
}
