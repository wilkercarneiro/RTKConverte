// Planta do loteamento em PDF (vai para o cliente e para a prefeitura).
//
// Segue o arranjo das plantas aprovadas da equipe (LOTEAMENTO NOVO-A1):
//   • à esquerda o desenho — lotes em verde com número e área, ruas em cinza
//     com o alinhamento em vermelho, divisa em azul-marinho e estrada em
//     laranja; rosa dos ventos no alto; embaixo a seção típica da rua, o
//     título "PLANTA BAIXA" com a escala e o detalhe de esquina;
//   • à direita, de cima para baixo: LEGENDAS / ABREVIATURAS, CONVENÇÕES,
//     QUADRO DE ÁREAS, PLANTA DE SITUAÇÃO (satélite com o loteamento),
//     CARIMBO DA EMPRESA (logo) e o bloco de identificação (denominação,
//     proprietário, responsável técnico, escala, área, perímetro, desenhista,
//     data, folha e sistema geodésico).
// Acrescenta o que as nossas outras plantas já fazem: cotas dos lotes, nome e
// largura das ruas, quadras numeradas, áreas públicas e, nas folhas seguintes,
// o quadro de lotes.
//
// Gerado no navegador com pdf-lib: a planta acompanha o desenho na hora, sem
// ida ao servidor (a VPS não é sobrecarregada com isto).
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";
import { textoWinAnsi } from "../../../supabase/functions/_shared/texto.ts";
import { areaPol, caixa, centroide, dist, esquerda, sub, unit } from "./geom.ts";
import { pontoInterno } from "./auto.ts";
import type { Anel, Poligono, Pt } from "./geom.ts";
import { fmt, viarioDe } from "./calculo.ts";
import type { Perimetro, Resultado } from "./calculo.ts";
import { ehAcesso } from "./modelo.ts";
import type { Projeto } from "./modelo.ts";
import { resumoLote } from "./saidas.ts";

export type Folha = "A0" | "A1" | "A2" | "A3";
const FOLHAS: Record<Folha, [number, number]> = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297] };
const MM = 72 / 25.4;
const ESCALAS = [200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000];

export interface DadosCarimbo {
  empresa: string;
  cnpj: string;
  proprietario: string;
  cpfProprietario: string;
  imovel: string;
  municipio: string;
  uf: string;
  matricula: string;
  rt: string;
  /** "TÉCNICO EM AGROPECUÁRIA", "ENGENHEIRO AGRIMENSOR"… */
  rtTitulo?: string;
  rtRegistro: string;
  /** código do credenciado no INCRA */
  credenciado?: string;
  trt: string;
  desenhista: string;
  fuso: number;
  logo?: { bytes: Uint8Array; tipo: "png" | "jpg" } | null;
  /** PNG da planta de situação (satélite com o loteamento) — ver situacao.ts */
  situacao?: Uint8Array | null;
}

const T = (s: string) => textoWinAnsi(s);
const CINZA = (v: number) => rgb(v, v, v);
// cores das plantas da equipe
const VERDE_LOTE = rgb(0.1, 0.72, 0.1);
const VERMELHO = rgb(0.86, 0.12, 0.1);
const MARINHO = rgb(0.05, 0.08, 0.42);
const LARANJA = rgb(0.95, 0.55, 0.12);
const AZUL = rgb(0.18, 0.36, 1);
const COR_AREA: Record<string, RGB> = {
  verde: rgb(0.78, 0.92, 0.7), institucional: rgb(0.99, 0.86, 0.68), lazer: rgb(0.78, 0.9, 0.96), app: rgb(0.74, 0.85, 0.96),
};

/** Geometria da folha: margens, barra lateral e faixa de baixo do desenho. */
function moldura(folha: Folha) {
  const [fw, fh] = FOLHAS[folha];
  const W = fw * MM, H = fh * MM;
  const k = fw / 841; // fator de tamanho de letra (A1 = 1)
  const mL = 25 * MM, mO = 10 * MM;
  const larguraBarra = Math.max(150 * MM, (W - mL - mO) * 0.22);
  const barraX = W - mO - larguraBarra;
  const faixaBaixo = (H - 2 * mO) * 0.17;
  const area = { x: mL + 6 * MM, y: mO + faixaBaixo, w: barraX - mL - 12 * MM, h: H - 2 * mO - faixaBaixo - 8 * MM };
  return { W, H, k, mL, mO, larguraBarra, barraX, faixaBaixo, area };
}

export function escalaPara(res: Resultado, folha: Folha): number {
  const { area } = moldura(folha);
  const { min, max } = caixa(res.gleba.ext);
  const den = Math.max(((max[0] - min[0]) * 1000) / ((area.w * 0.95) / MM), ((max[1] - min[1]) * 1000) / ((area.h * 0.95) / MM));
  return ESCALAS.find((e) => e >= den) ?? Math.ceil(den / 1000) * 1000;
}

export async function gerarPlantaPdf(res: Resultado, pr: Projeto, perimetro: Perimetro, c: DadosCarimbo, folha: Folha = "A1"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(T(`Planta do loteamento ${pr.nome}`));
  pdf.setCreator("Vertces");
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (c.logo) {
    try { logo = c.logo.tipo === "png" ? await pdf.embedPng(c.logo.bytes) : await pdf.embedJpg(c.logo.bytes); } catch { logo = null; }
  }
  let situacao: PDFImage | null = null;
  if (c.situacao) { try { situacao = await pdf.embedPng(c.situacao); } catch { situacao = null; } }

  const M = moldura(folha);
  const { W, H, k, mL, mO, larguraBarra, barraX, area } = M;
  const page = pdf.addPage([W, H]);
  page.drawRectangle({ x: mL, y: mO, width: W - mL - mO, height: H - 2 * mO, borderWidth: 2, borderColor: CINZA(0) });
  page.drawLine({ start: { x: barraX, y: mO }, end: { x: barraX, y: H - mO }, thickness: 1.2 });

  // ================================================================ desenho
  const den = escalaPara(res, folha);
  const ptm = (1000 / den) * MM; // pontos por metro
  const bb = caixa(res.gleba.ext);
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const ox = area.x + area.w / 2, oy = area.y + area.h / 2;
  const P = (p: Pt): Pt => [ox + (p[0] - cx) * ptm, oy + (p[1] - cy) * ptm];
  const svg = (pol: Poligono) => {
    const r = (a: Anel) => "M" + a.map((p) => `${((p[0] - cx) * ptm).toFixed(2)} ${(-(p[1] - cy) * ptm).toFixed(2)}`).join("L") + "Z";
    return r(pol.ext) + pol.furos.map(r).join("");
  };
  const pol = (pg: Poligono, o: { cor?: RGB; borda?: RGB; esp?: number; opac?: number }) =>
    page.drawSvgPath(svg(pg), { x: ox, y: oy, color: o.cor, borderColor: o.borda, borderWidth: o.esp ?? 0, opacity: o.opac });

  // ruas projetadas (cinza) com o alinhamento predial em vermelho
  for (const v of viarioDe(res)) pol(v, { cor: CINZA(0.86), borda: VERMELHO, esp: 0.7 });
  for (const a of res.publicas) pol(a.pol, { cor: COR_AREA[a.tipo], borda: CINZA(0.3), esp: 0.5 });
  // terra que não virou lote nem área pública (projeto sem área verde): fica do proprietário
  for (const sb of res.sobras) pol(sb, { cor: CINZA(0.95), borda: CINZA(0.35), esp: 0.5 });
  for (const l of res.lotes) pol(l.pol, { borda: VERDE_LOTE, esp: 0.6 });
  // eixo das ruas (traço-ponto)
  for (const r of res.ruas) {
    for (let i = 0; i + 1 < r.eixo.length; i++) {
      const [a, b] = recortar(r.eixo[i], r.eixo[i + 1], res);
      if (!a || !b) continue;
      const A = P(a), B = P(b);
      page.drawLine({ start: { x: A[0], y: A[1] }, end: { x: B[0], y: B[1] }, thickness: 0.35, color: VERMELHO, dashArray: [10, 3, 2, 3], opacity: 0.8 });
    }
  }
  // faixa non aedificandi (rodovia/ferrovia) dentro dos lotes
  // (um rótulo só por trecho contínuo de estrada, no lado mais longo dele)
  const maisLongoDaSequencia = (lados: number[], comp: (i: number) => number) => {
    const marcados = new Set<number>();
    let seq: number[] = [];
    const fechar = () => { if (seq.length) marcados.add(seq.reduce((m, i) => (comp(i) > comp(m) ? i : m), seq[0])); seq = []; };
    lados.forEach((i, k2) => { if (k2 && lados[k2 - 1] !== i - 1) fechar(); seq.push(i); });
    fechar();
    return marcados;
  };
  const rotuloFaixa = maisLongoDaSequencia(res.faixasRestricao.map((f) => f.lado), (i) => { const f = res.faixasRestricao.find((x) => x.lado === i)!; return dist(f.linha[0], f.linha[1]); });
  for (const f of res.faixasRestricao) {
    const A = P(f.linha[0]), B = P(f.linha[1]);
    page.drawLine({ start: { x: A[0], y: A[1] }, end: { x: B[0], y: B[1] }, thickness: 0.6, color: LARANJA, dashArray: [6, 4] });
    if (!rotuloFaixa.has(f.lado)) continue;
    const m: Pt = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    let ang = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    textoCentrado(page, fonte, T(`FAIXA NON AEDIFICANDI ${fmt(f.largura, 0)} m`), m[0], m[1] + 4, 5.5 * k, LARANJA, ang);
  }
  // perímetro: divisa em azul-marinho, estrada/acesso em laranja
  res.ladosGleba.forEach((l) => {
    const A = P(l.a), B = P(l.b);
    page.drawLine({ start: { x: A[0], y: A[1] }, end: { x: B[0], y: B[1] }, thickness: ehAcesso(l.tipo) ? 2.2 : 1.6, color: ehAcesso(l.tipo) ? LARANJA : MARINHO });
  });

  // vértices do perímetro e confrontantes (por fora)
  const glebaCcw = res.gleba.ext;
  const sentidoIgual = (() => {
    const p0 = res.ladosGleba[0];
    const i = glebaCcw.findIndex((q) => dist(q, p0.a) < 0.01);
    return i >= 0 && dist(glebaCcw[(i + 1) % glebaCcw.length], p0.b) < 0.01;
  })();
  const acessos = res.ladosGleba.map((l, i) => (ehAcesso(l.tipo) ? i : -1)).filter((i) => i >= 0);
  const rotuloAcesso = maisLongoDaSequencia(acessos, (i) => dist(res.ladosGleba[i].a, res.ladosGleba[i].b));
  res.ladosGleba.forEach((l, i) => {
    const A = P(l.a);
    page.drawCircle({ x: A[0], y: A[1], size: 1.4, color: CINZA(1), borderColor: MARINHO, borderWidth: 0.6 });
    const nome = perimetro.nomes?.[i];
    if (nome) texto(page, fonte, nome, A[0] + 2.5, A[1] + 2.5, 4.5 * k, CINZA(0.3));
    const comp = dist(l.a, l.b);
    if (comp * ptm < 70) return;
    if (ehAcesso(l.tipo) && !rotuloAcesso.has(i)) { // só a medida
      const d0 = unit(sub(l.b, l.a));
      const f0 = sentidoIgual ? [d0[1], -d0[0]] as Pt : [-d0[1], d0[0]] as Pt;
      const M0 = P([(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2]);
      let a0 = (Math.atan2(d0[1], d0[0]) * 180) / Math.PI;
      if (a0 > 90) a0 -= 180; if (a0 < -90) a0 += 180;
      textoCentrado(page, fonte, `${fmt(comp)} m`, M0[0] + f0[0] * 9, M0[1] + f0[1] * 9, 5 * k, CINZA(0.4), a0);
      return;
    }
    const conf = ehAcesso(l.tipo) ? (l.nome || (l.tipo === "rodovia" ? "RODOVIA" : "ESTRADA EXISTENTE")) : (perimetro.confrontantes[i] ?? "");
    const d = unit(sub(l.b, l.a));
    const fora = sentidoIgual ? [d[1], -d[0]] as Pt : [-d[1], d[0]] as Pt;
    const M2 = P([(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2]);
    let ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    if (conf) textoCentrado(page, fonte, T(conf.slice(0, 70)), M2[0] + fora[0] * 9, M2[1] + fora[1] * 9, 6 * k, ehAcesso(l.tipo) ? LARANJA : CINZA(0.25), ang);
    textoCentrado(page, fonte, `${fmt(comp)} m`, M2[0] + fora[0] * 17, M2[1] + fora[1] * 17, 5 * k, CINZA(0.4), ang);
  });

  // lotes: número, área e cotas (uma vez por aresta)
  const tamNum = Math.max(4.5, Math.min(11, pr.params.frente * ptm * 0.3));
  const tamCota = Math.max(3, Math.min(6, pr.params.frente * ptm * 0.15));
  const cotadas = new Set<string>();
  for (const l of res.lotes) {
    const c2 = P(centroide(l.pol.ext));
    textoCentrado(page, fonte, String(l.numero), c2[0], c2[1] + tamNum * 0.25, tamNum, CINZA(0));
    textoCentrado(page, negrito, `${fmt(l.area)}m²`, c2[0], c2[1] - tamNum * 0.75, tamNum * 0.55, CINZA(0.1));
    for (const lado of l.lados) {
      const kk = [lado.a, lado.b].map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).sort().join("|");
      if (cotadas.has(kk)) continue;
      cotadas.add(kk);
      if (lado.comp * ptm < fonte.widthOfTextAtSize(fmt(lado.comp), tamCota) + 5) continue;
      const d = unit(sub(lado.b, lado.a));
      const dentro = esquerda(d);
      const m = P([(lado.a[0] + lado.b[0]) / 2, (lado.a[1] + lado.b[1]) / 2]);
      let ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      textoCentrado(page, fonte, fmt(lado.comp), m[0] + dentro[0] * tamCota * 0.9, m[1] + dentro[1] * tamCota * 0.9, tamCota, CINZA(0.4), ang);
    }
  }
  // letra da quadra num círculo, sobre a linha de fundo
  for (const q of res.quadras) {
    const ctr = q.fundo ? P([(q.fundo.a[0] + q.fundo.b[0]) / 2, (q.fundo.a[1] + q.fundo.b[1]) / 2]) : P(q.centro);
    const r = Math.max(7, Math.min(15, tamNum * 1.3));
    page.drawCircle({ x: ctr[0], y: ctr[1], size: r, color: CINZA(1), borderColor: CINZA(0), borderWidth: 0.8 });
    textoCentrado(page, negrito, q.nome, ctr[0], ctr[1], r, CINZA(0));
  }
  // nome e largura das ruas ao longo do eixo
  for (const r of res.ruas) {
    let mi = -1, ml = 0;
    for (let i = 0; i + 1 < r.eixo.length; i++) {
      const [a, b] = recortar(r.eixo[i], r.eixo[i + 1], res);
      if (a && b && dist(a, b) > ml) { ml = dist(a, b); mi = i; }
    }
    if (mi < 0) continue;
    const [a, b] = recortar(r.eixo[mi], r.eixo[mi + 1], res) as [Pt, Pt];
    const A = P(a), B = P(b);
    let ang = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    const tam = Math.max(5, Math.min(9, r.largura * ptm * 0.4));
    textoCentrado(page, negrito, T(`${r.nome.toUpperCase()}  (${fmt(r.largura)} m)`), (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, tam, rgb(0.5, 0.08, 0.08), ang);
  }
  for (const a of res.publicas) {
    if (a.area < 100) continue;
    const c2 = P(centroide(a.pol.ext));
    textoCentrado(page, negrito, T(a.nome), c2[0], c2[1] + 3, 7 * k, CINZA(0.1));
    textoCentrado(page, fonte, `${fmt(a.area)} m²`, c2[0], c2[1] - 6, 6 * k, CINZA(0.2));
  }
  for (const sb of res.sobras) {
    const area = areaPol(sb);
    if (area < 100) continue;
    const c2 = P(pontoInterno(sb));
    textoCentrado(page, negrito, "ÁREA REMANESCENTE", c2[0], c2[1] + 3, 6.5 * k, CINZA(0.15));
    textoCentrado(page, fonte, `${fmt(area)} m²`, c2[0], c2[1] - 6, 6 * k, CINZA(0.25));
  }

  // rosa dos ventos (alto, à esquerda, como na planta da equipe)
  rosaDosVentos(page, negrito, mL + 40 * MM * k, H - mO - 38 * MM * k, 26 * MM * k);

  // ---------------------------------------------------- faixa de baixo do desenho
  const yBase = mO + 8 * MM;
  // seção típica da rua
  secaoDaRua(page, fonte, negrito, mL + 12 * MM, yBase + 30 * MM * k, pr.params.ruaPista, (pr.params.ruaLargura - pr.params.ruaPista) / 2, k);
  // título PLANTA BAIXA
  texto(page, fonte, "PLANTA BAIXA", mL + 12 * MM, yBase + 10 * MM * k, 22 * k, CINZA(0));
  page.drawRectangle({ x: mL + 12 * MM, y: yBase + 6.5 * MM * k, width: 70 * MM * k, height: 2.2 * k, color: rgb(0.1, 0.85, 0.1) });
  page.drawRectangle({ x: mL + 12 * MM, y: yBase + 5.4 * MM * k, width: 70 * MM * k, height: 0.6, color: rgb(0.1, 0.85, 0.1) });
  texto(page, fonte, `Esc. 1:${den}`, mL + 12 * MM, yBase, 13 * k, CINZA(0.3));
  // escala gráfica
  const passoEsc = [5, 10, 20, 25, 50, 100, 200, 250, 500].find((p) => p * ptm >= 40) ?? 500;
  const ex = mL + 100 * MM * k, ey = yBase + 2;
  for (let i = 0; i < 4; i++) {
    page.drawRectangle({ x: ex + i * passoEsc * ptm, y: ey, width: passoEsc * ptm, height: 4, color: i % 2 ? CINZA(1) : CINZA(0), borderColor: CINZA(0), borderWidth: 0.5 });
    texto(page, fonte, `${passoEsc * i}`, ex + i * passoEsc * ptm - 2, ey + 7, 6, CINZA(0));
  }
  texto(page, fonte, `${passoEsc * 4} m`, ex + 4 * passoEsc * ptm - 3, ey + 7, 6, CINZA(0));
  // detalhe de esquina
  detalheEsquina(page, fonte, negrito, barraX - 70 * MM * k, yBase - 2 * MM, 60 * MM * k, pr, k);

  // ================================================================ barra lateral
  const bx = barraX, bw = larguraBarra, topo = H - mO;
  const alturaUtil = H - 2 * mO;
  const caixas = { legenda: 0.205, convencoes: 0.115, quadro: 0.12, situacao: 0.18, carimbo: 0.15, titulo: 0.23 };
  let y = topo;
  const proxima = (f: number) => { const h = alturaUtil * f; const y0 = y - h; y = y0; return { y0, h }; };

  // LEGENDAS / ABREVIATURAS
  {
    const { y0, h } = proxima(caixas.legenda);
    page.drawLine({ start: { x: bx, y: y0 }, end: { x: bx + bw, y: y0 }, thickness: 1 });
    tituloCaixa(page, fonte, "LEGENDAS / ABREVIATURAS", bx + bw / 2, y0 + h - 14 * k, 12 * k, bw * 0.62);
    const itens: [string, (x: number, yy: number, w: number) => void][] = [
      ["LOTE", (x, yy, w) => page.drawRectangle({ x, y: yy - 3, width: w, height: 8, borderColor: VERDE_LOTE, borderWidth: 0.8 })],
      ["RUAS PROJETADAS", (x, yy, w) => page.drawRectangle({ x, y: yy - 3, width: w, height: 8, color: CINZA(0.86) })],
      ["ALINHAMENTO / MEIO-FIO", (x, yy, w) => page.drawLine({ start: { x, y: yy + 1 }, end: { x: x + w, y: yy + 1 }, thickness: 0.9, color: VERMELHO })],
      ["EIXO DE RUA", (x, yy, w) => page.drawLine({ start: { x, y: yy + 1 }, end: { x: x + w, y: yy + 1 }, thickness: 0.5, color: VERMELHO, dashArray: [6, 2, 1.5, 2] })],
      ["DIVISA", (x, yy, w) => page.drawLine({ start: { x, y: yy + 1 }, end: { x: x + w, y: yy + 1 }, thickness: 1.4, color: MARINHO })],
      ["ESTRADA / ACESSO", (x, yy, w) => page.drawLine({ start: { x, y: yy + 1 }, end: { x: x + w, y: yy + 1 }, thickness: 1.8, color: LARANJA })],
      ["FAIXA NON AEDIFICANDI", (x, yy, w) => page.drawLine({ start: { x, y: yy + 1 }, end: { x: x + w, y: yy + 1 }, thickness: 0.6, color: LARANJA, dashArray: [5, 3] })],
      ["ÁREA VERDE", (x, yy, w) => page.drawRectangle({ x, y: yy - 3, width: w, height: 8, color: COR_AREA.verde, borderColor: CINZA(0.3), borderWidth: 0.4 })],
      ["ÁREA INSTITUCIONAL", (x, yy, w) => page.drawRectangle({ x, y: yy - 3, width: w, height: 8, color: COR_AREA.institucional, borderColor: CINZA(0.3), borderWidth: 0.4 })],
      ["APP", (x, yy, w) => page.drawRectangle({ x, y: yy - 3, width: w, height: 8, color: COR_AREA.app, borderColor: CINZA(0.3), borderWidth: 0.4 })],
      ["RIO, LAGO, AÇUDE", (x, yy, w) => page.drawSvgPath(`M0 0 C ${w / 4} -4 ${w / 4} 4 ${w / 2} 0 S ${(3 * w) / 4} -4 ${w} 0`, { x, y: yy + 1, borderColor: AZUL, borderWidth: 0.8 })],
      ["VÉRTICE DE LIMITE", (x, yy, w) => page.drawCircle({ x: x + w / 2, y: yy + 1, size: 2, color: CINZA(1), borderColor: MARINHO, borderWidth: 0.7 })],
      ["QUADRA", (x, yy, w) => { page.drawCircle({ x: x + w / 2, y: yy + 1, size: 5, borderColor: CINZA(0), borderWidth: 0.7 }); textoCentrado(page, negrito, "A", x + w / 2, yy + 1, 6, CINZA(0)); }],
      ["Nº DO LOTE / ÁREA", (x, yy, w) => { textoCentrado(page, fonte, "12", x + w / 2, yy + 3, 6, CINZA(0)); textoCentrado(page, negrito, "250,00m²", x + w / 2, yy - 3, 4, CINZA(0)); }],
      ["COTA (m)", (x, yy, w) => textoCentrado(page, fonte, "10,00", x + w / 2, yy + 1, 5.5, CINZA(0.4))],
    ];
    const cols = 3, lin = Math.ceil(itens.length / cols);
    const cw = bw / cols, simb = cw * 0.32, passo = (h - 30 * k) / lin;
    itens.forEach(([rot, f], i) => {
      const col = Math.floor(i / lin), row = i % lin;
      const x = bx + 6 + col * cw, yy = y0 + h - 32 * k - row * passo;
      f(x, yy, simb);
      texto(page, fonte, T(rot), x + simb + 5, yy - 1, 5.6 * k, CINZA(0.25));
    });
  }

  // CONVENÇÕES
  {
    const { y0, h } = proxima(caixas.convencoes);
    page.drawLine({ start: { x: bx, y: y0 }, end: { x: bx + bw, y: y0 }, thickness: 1 });
    texto(page, fonte, "C O N V E N Ç Õ E S", bx + bw / 2 - fonte.widthOfTextAtSize(T("C O N V E N Ç Õ E S"), 12 * k) / 2, y0 + h - 16 * k, 12 * k, CINZA(0));
    page.drawLine({ start: { x: bx + 10, y: y0 + h - 21 * k }, end: { x: bx + bw - 10, y: y0 + h - 21 * k }, thickness: 1 });
    const conv: [string, (x: number, yy: number) => void][] = [
      ["ESTRADA / RUA / ACESSO", (x, yy) => page.drawLine({ start: { x, y: yy + 1 }, end: { x: x + 26, y: yy + 1 }, thickness: 1.4, color: LARANJA })],
      ["DIVISA", (x, yy) => page.drawLine({ start: { x, y: yy + 1 }, end: { x: x + 26, y: yy + 1 }, thickness: 1.2, color: MARINHO })],
      ["MARCOS IMPLANTADOS", (x, yy) => page.drawCircle({ x: x + 13, y: yy + 1, size: 3.2, color: CINZA(0) })],
      ["PONTOS LEVANTADOS", (x, yy) => { page.drawCircle({ x: x + 13, y: yy + 1, size: 3.2, borderColor: CINZA(0), borderWidth: 0.8 }); page.drawCircle({ x: x + 13, y: yy + 1, size: 1, color: CINZA(0) }); }],
      ["PONTOS DE LOCAÇÃO (PIQUETES)", (x, yy) => page.drawCircle({ x: x + 13, y: yy + 1, size: 1.4, color: CINZA(0) })],
      ["IMÓVEL", (x, yy) => page.drawRectangle({ x, y: yy - 2, width: 26, height: 6, color: CINZA(0.55) })],
      ["LOCALIZAÇÃO DO IMÓVEL NA IMAGEM", (x, yy) => page.drawRectangle({ x, y: yy - 2, width: 26, height: 6, borderColor: AZUL, borderWidth: 1 })],
      ["ESTAQUEAMENTO (EIXO A CADA 20 m)", (x, yy) => { page.drawLine({ start: { x, y: yy + 1 }, end: { x: x + 26, y: yy + 1 }, thickness: 0.5, color: VERMELHO }); for (const t of [4, 13, 22]) page.drawLine({ start: { x: x + t, y: yy - 2 }, end: { x: x + t, y: yy + 4 }, thickness: 0.5, color: VERMELHO }); }],
    ];
    const lin = Math.ceil(conv.length / 2), passo = (h - 30 * k) / lin;
    conv.forEach(([rot, f], i) => {
      const col = Math.floor(i / lin), row = i % lin;
      const x = bx + 12 + col * (bw / 2), yy = y0 + h - 34 * k - row * passo;
      f(x, yy);
      texto(page, fonte, T(rot), x + 32, yy - 1, 5.6 * k, CINZA(0.25));
    });
  }

  // QUADRO DE ÁREAS (o que as nossas plantas já trazem)
  {
    const { y0, h } = proxima(caixas.quadro);
    page.drawLine({ start: { x: bx, y: y0 }, end: { x: bx + bw, y: y0 }, thickness: 1 });
    const q = res.quadro;
    const pct = (v: number) => `${fmt((100 * v) / q.gleba)}%`;
    tituloCaixa(page, fonte, "QUADRO DE ÁREAS", bx + bw / 2, y0 + h - 13 * k, 11 * k, bw * 0.5);
    const linhas: [string, string, string][] = [
      [`LOTES (${q.lotes.qtd} lotes em ${res.quadras.length} quadras)`, fmt(q.lotes.area), pct(q.lotes.area)],
      ["SISTEMA VIÁRIO", fmt(q.viario), pct(q.viario)],
      ...(q.verde + q.lazer > 0 ? [["ÁREAS VERDES", fmt(q.verde + q.lazer), pct(q.verde + q.lazer)] as [string, string, string]] : []),
      ...(q.institucional > 0 ? [["ÁREA INSTITUCIONAL", fmt(q.institucional), pct(q.institucional)] as [string, string, string]] : []),
      ...(q.app > 0 ? [["APP", fmt(q.app), pct(q.app)] as [string, string, string]] : []),
      ...(q.sobras > 0 ? [["REMANESCENTE", fmt(q.sobras), pct(q.sobras)] as [string, string, string]] : []),
      ["ÁREA TOTAL DA GLEBA", fmt(q.gleba), "100,00%"],
    ];
    const tam = Math.min(7.4 * k, (h - 34 * k) / (linhas.length + 1) - 4);
    tabela(page, fonte, negrito, bx + 8, y0 + h - 28 * k, [bw * 0.56, bw * 0.24, bw * 0.16], ["ESPECIFICAÇÃO", "ÁREA (m²)", "%"], linhas, tam, linhas.length - 1);
  }

  // PLANTA DE SITUAÇÃO
  {
    const { y0, h } = proxima(caixas.situacao);
    page.drawLine({ start: { x: bx, y: y0 }, end: { x: bx + bw, y: y0 }, thickness: 1 });
    tituloCaixa(page, fonte, "PLANTA DE SITUAÇÃO", bx + bw / 2, y0 + h - 13 * k, 11 * k, bw * 0.5);
    const iw = bw - 12, ih = h - 26 * k;
    if (situacao) {
      const s = Math.min(iw / situacao.width, ih / situacao.height);
      page.drawImage(situacao, { x: bx + 6 + (iw - situacao.width * s) / 2, y: y0 + 4 + (ih - situacao.height * s) / 2, width: situacao.width * s, height: situacao.height * s });
    } else {
      // sem imagem: o contorno do loteamento em miniatura
      const { min, max } = caixa(res.gleba.ext);
      const s = Math.min(iw * 0.8 / (max[0] - min[0]), ih * 0.8 / (max[1] - min[1]));
      const ox2 = bx + 6 + iw / 2, oy2 = y0 + 4 + ih / 2, cx2 = (min[0] + max[0]) / 2, cy2 = (min[1] + max[1]) / 2;
      const r = (a: Anel) => "M" + a.map((p) => `${((p[0] - cx2) * s).toFixed(2)} ${(-(p[1] - cy2) * s).toFixed(2)}`).join("L") + "Z";
      page.drawSvgPath(r(res.gleba.ext), { x: ox2, y: oy2, color: CINZA(0.9), borderColor: CINZA(0), borderWidth: 1 });
      for (const l of res.lotes) page.drawSvgPath(r(l.pol.ext), { x: ox2, y: oy2, borderColor: VERDE_LOTE, borderWidth: 0.3 });
      textoCentrado(page, fonte, "imagem de satélite indisponível", ox2, y0 + 8, 5.5, CINZA(0.5));
    }
  }

  // CARIMBO DA EMPRESA (logo grande)
  {
    const { y0, h } = proxima(caixas.carimbo);
    page.drawLine({ start: { x: bx, y: y0 }, end: { x: bx + bw, y: y0 }, thickness: 1 });
    textoCentrado(page, fonte, "CARIMBO DA EMPRESA", bx + bw / 2, y0 + h - 9 * k, 11 * k, CINZA(0));
    page.drawLine({ start: { x: bx, y: y0 + h - 17 * k }, end: { x: bx + bw, y: y0 + h - 17 * k }, thickness: 0.6 });
    const iw = bw * 0.78, ih = h - 40 * k;
    if (logo) {
      const s = Math.min(iw / logo.width, ih / logo.height);
      page.drawImage(logo, { x: bx + (bw - logo.width * s) / 2, y: y0 + 12 * k + (ih - logo.height * s) / 2, width: logo.width * s, height: logo.height * s });
    } else {
      textoCentrado(page, negrito, T(c.empresa || "EMPRESA"), bx + bw / 2, y0 + h / 2, 18 * k, CINZA(0.2));
    }
    if (c.empresa && logo) textoCentrado(page, fonte, T(`${c.empresa}${c.cnpj ? ` · CNPJ ${c.cnpj}` : ""}`), bx + bw / 2, y0 + 7 * k, 6 * k, CINZA(0.35));
  }

  // BLOCO DE IDENTIFICAÇÃO
  {
    const { y0, h } = proxima(caixas.titulo);
    const pad = 5, x0 = bx + pad, w0 = bw - 2 * pad;
    let yy = y0 + h - 4;
    const caixaR = (x: number, ytop: number, w: number, hh: number) => page.drawRectangle({ x, y: ytop - hh, width: w, height: hh, borderColor: CINZA(0), borderWidth: 0.7 });
    const rotulo = (t: string, x: number, ytop: number) => texto(page, fonte, T(t), x + 3, ytop - 7 * k, 4.6 * k, CINZA(0.4));
    // título
    const hT = h * 0.1;
    caixaR(x0, yy, w0, hT);
    textoCentrado(page, negrito, "PROJETO DE LOTEAMENTO", x0 + w0 / 2, yy - hT / 2, 13 * k, CINZA(0));
    yy -= hT + 3;
    // denominação
    const hD = h * 0.13;
    caixaR(x0, yy, w0, hD); rotulo("Denominação:", x0, yy);
    textoCentrado(page, negrito, T(fit((pr.nome || c.imovel).toUpperCase(), negrito, 10 * k, w0 - 10)), x0 + w0 / 2, yy - hD / 2 - 2, 10 * k, CINZA(0));
    yy -= hD + 3;
    // proprietário / CPF / município
    const hP = h * 0.17;
    caixaR(x0, yy, w0, hP); rotulo("Proprietário:", x0, yy);
    texto(page, negrito, T(fit(c.proprietario || "—", negrito, 8 * k, w0 - 60)), x0 + 50, yy - 9 * k, 8 * k, CINZA(0));
    rotulo("CPF/CNPJ:", x0, yy - hP / 2);
    texto(page, fonte, T(c.cpfProprietario || "—"), x0 + 50, yy - hP / 2 - 9 * k, 7.5 * k, CINZA(0));
    texto(page, fonte, T("Município/UF:"), x0 + w0 * 0.55, yy - hP / 2 - 3 * k, 4.6 * k, CINZA(0.4));
    texto(page, fonte, T(fit([c.municipio, c.uf].filter(Boolean).join(" - ") || "—", fonte, 8 * k, w0 * 0.43)), x0 + w0 * 0.55, yy - hP / 2 - 12 * k, 8 * k, CINZA(0));
    if (c.matricula) texto(page, fonte, T(`Matrícula: ${c.matricula}`), x0 + w0 * 0.55, yy - 9 * k, 6.5 * k, CINZA(0.2));
    yy -= hP + 3;
    // responsável técnico | proprietário (assinaturas)
    const hR = h * 0.22;
    const wR = w0 * 0.5 - 2;
    caixaR(x0, yy, wR, hR); rotulo("RESPONSÁVEL TÉCNICO", x0, yy);
    caixaR(x0 + wR + 4, yy, wR, hR); rotulo("PROPRIETÁRIO", x0 + wR + 4, yy);
    page.drawLine({ start: { x: x0 + 8, y: yy - hR * 0.45 }, end: { x: x0 + wR - 8, y: yy - hR * 0.45 }, thickness: 0.5 });
    textoCentrado(page, negrito, T(fit((c.rt || "—").toUpperCase(), negrito, 7 * k, wR - 8)), x0 + wR / 2, yy - hR * 0.45 - 8 * k, 7 * k, CINZA(0));
    const linhasRt = [c.rtTitulo, c.rtRegistro, c.credenciado ? `CREDENCIADO: ${c.credenciado}` : "", c.trt ? `ART/TRT: ${c.trt}` : ""].filter(Boolean) as string[];
    linhasRt.forEach((t, i) => textoCentrado(page, fonte, T(fit(t, fonte, 5.2 * k, wR - 8)), x0 + wR / 2, yy - hR * 0.45 - (15 + i * 6.5) * k, 5.2 * k, CINZA(0.25)));
    page.drawLine({ start: { x: x0 + wR + 12, y: yy - hR * 0.45 }, end: { x: x0 + 2 * wR - 4, y: yy - hR * 0.45 }, thickness: 0.5 });
    textoCentrado(page, fonte, T(fit(c.proprietario || "NOME", fonte, 6.5 * k, wR - 8)), x0 + wR * 1.5 + 4, yy - hR * 0.45 - 8 * k, 6.5 * k, CINZA(0));
    textoCentrado(page, fonte, T(`CPF: ${c.cpfProprietario || ""}`), x0 + wR * 1.5 + 4, yy - hR * 0.45 - 15 * k, 5.5 * k, CINZA(0.3));
    yy -= hR + 3;
    // escala | área | perímetro | desenhista | data | folha
    const hL = h * 0.13;
    const perim = res.ladosGleba.reduce((s, l) => s + dist(l.a, l.b), 0);
    const campos: [string, string, number][] = [
      ["ESCALA", `1:${den}`, 0.13], ["ÁREA", `${fmt(res.quadro.gleba / 1e4, 4)} ha`, 0.2], ["PERÍMETRO", `${fmt(perim)} m`, 0.19],
      ["DESENHISTA", c.desenhista || "—", 0.22], ["DATA", new Date().toLocaleDateString("pt-BR"), 0.14], ["FOLHA", `01/${String(1 + paginasQuadro(res, folha)).padStart(2, "0")}`, 0.12],
    ];
    let xx = x0;
    for (const [rot, val, f] of campos) {
      const w = w0 * f - 2;
      caixaR(xx, yy, w, hL); rotulo(rot, xx, yy);
      textoCentrado(page, negrito, T(fit(val, negrito, 7 * k, w - 4)), xx + w / 2, yy - hL * 0.62, 7 * k, CINZA(0));
      xx += w + 2;
    }
    texto(page, negrito, folha, x0 + w0 - 16 * k, yy - hL - 1 - 8 * k, 7 * k, CINZA(0));
    yy -= hL + 3;
    // sistema geodésico
    const hG = h * 0.11;
    caixaR(x0, yy, w0, hG); rotulo("SISTEMA GEODÉSICO", x0, yy);
    const mc = 6 * c.fuso - 183;
    const geo = [`Coordenada: UTM`, `Datum: SIRGAS2000`, `M.C. ${mc}° Wgr`, `Fuso: ${c.fuso}S`, res.plano.terreno ? `k = ${res.plano.k.toFixed(6).replace(".", ",")}` : ""].filter(Boolean);
    const passoG = w0 / geo.length;
    geo.forEach((t, i) => texto(page, fonte, T(t), x0 + 4 + i * passoG, yy - hG * 0.68, 6.2 * k, CINZA(0)));
    void y;
  }

  // ================================================================ quadro de lotes
  desenharQuadroDeLotes(pdf, res, pr, fonte, negrito, folha, den);
  return pdf.save();
}

// ---------------------------------------------------------------------------
// Peças gráficas das plantas da equipe
// ---------------------------------------------------------------------------

function tituloCaixa(page: PDFPage, f: PDFFont, t: string, cx: number, cy: number, tam: number, largura: number) {
  page.drawRectangle({ x: cx - largura / 2, y: cy - tam * 0.75, width: largura, height: tam * 1.9, color: CINZA(1), borderColor: CINZA(0), borderWidth: 0.9 });
  textoCentrado(page, f, T(t), cx, cy + tam * 0.18, tam, CINZA(0));
}

/** Rosa dos ventos de oito pontas com o N, como a das plantas da equipe. */
function rosaDosVentos(page: PDFPage, f: PDFFont, cx: number, cy: number, r: number) {
  const ponta = (ang: number, comp: number, larg: number, cheia: boolean) => {
    const a = (ang * Math.PI) / 180;
    const d: Pt = [Math.sin(a), Math.cos(a)];
    const n: Pt = [d[1], -d[0]];
    const p1: Pt = [cx + d[0] * comp, cy + d[1] * comp];
    const pl: Pt = [cx + n[0] * larg, cy + n[1] * larg], pr2: Pt = [cx - n[0] * larg, cy - n[1] * larg];
    const svgP = (q: Pt) => `${(q[0] - cx).toFixed(2)} ${(-(q[1] - cy)).toFixed(2)}`;
    page.drawSvgPath(`M${svgP([cx, cy])}L${svgP(pl)}L${svgP(p1)}Z`, { x: cx, y: cy, color: cheia ? CINZA(0) : CINZA(1), borderColor: CINZA(0), borderWidth: 0.6 });
    page.drawSvgPath(`M${svgP([cx, cy])}L${svgP(pr2)}L${svgP(p1)}Z`, { x: cx, y: cy, color: cheia ? CINZA(1) : CINZA(0), borderColor: CINZA(0), borderWidth: 0.6 });
  };
  for (const a of [45, 135, 225, 315]) ponta(a, r * 0.55, r * 0.1, false);
  for (const a of [0, 90, 180, 270]) ponta(a, r, r * 0.14, true);
  page.drawCircle({ x: cx, y: cy, size: r * 0.08, color: CINZA(1), borderColor: CINZA(0), borderWidth: 0.6 });
  textoCentrado(page, f, "N", cx, cy + r + r * 0.32, r * 0.36, CINZA(0));
}

/** Seção típica da rua: calçada | pista | calçada, com postes, carros e pedestres (traço). */
function secaoDaRua(page: PDFPage, f: PDFFont, fb: PDFFont, x: number, y: number, pista: number, calcada: number, k: number) {
  const esc = 15 * k; // pontos por metro no desenho da seção
  const wC = calcada * esc, wP = pista * esc;
  const cor = VERMELHO;
  const L = (x1: number, y1: number, x2: number, y2: number, e = 0.6) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: e, color: cor });
  // calçadas (meio-fio 0,15 m acima da pista)
  const mf = 0.15 * esc * 2;
  L(x, y + mf, x + wC, y + mf); L(x + wC, y + mf, x + wC, y); L(x + wC, y, x + wC + wP, y); L(x + wC + wP, y, x + wC + wP, y + mf); L(x + wC + wP, y + mf, x + 2 * wC + wP, y + mf);
  page.drawRectangle({ x, y: y - 6 * k, width: 2 * wC + wP, height: 6 * k, borderColor: CINZA(0), borderWidth: 0.5 });
  // postes com braço
  for (const [px2, dir] of [[x + wC - 3, 1], [x + wC + wP + 3, -1]] as [number, number][]) {
    L(px2, y + mf, px2, y + 5.2 * esc, 0.9);
    page.drawSvgPath(`M0 0 Q ${dir * 1.2 * esc} ${-0.6 * esc} ${dir * 2 * esc} 0`, { x: px2, y: y + 5.2 * esc, borderColor: cor, borderWidth: 0.8 });
    page.drawEllipse({ x: px2 + dir * 2 * esc, y: y + 5.05 * esc, xScale: 0.35 * esc, yScale: 0.12 * esc, borderColor: cor, borderWidth: 0.6 });
  }
  // carros (silhueta de frente/traseira)
  for (const cxC of [x + wC + wP * 0.27, x + wC + wP * 0.73]) {
    const cw = 1.75 * esc, ch = 1.45 * esc;
    page.drawRectangle({ x: cxC - cw / 2, y: y + 0.25 * esc, width: cw, height: ch * 0.55, borderColor: cor, borderWidth: 0.6 });
    page.drawSvgPath(`M${-cw * 0.36} 0 L${-cw * 0.26} ${-ch * 0.42} L${cw * 0.26} ${-ch * 0.42} L${cw * 0.36} 0 Z`, { x: cxC, y: y + 0.25 * esc + ch * 0.55, borderColor: cor, borderWidth: 0.6 });
    for (const s of [-1, 1]) page.drawCircle({ x: cxC + s * cw * 0.32, y: y + 0.22 * esc, size: 0.22 * esc, borderColor: cor, borderWidth: 0.6 });
  }
  // pedestres
  for (const px2 of [x + wC * 0.4, x + 2 * wC + wP - wC * 0.4]) {
    page.drawCircle({ x: px2, y: y + mf + 1.6 * esc, size: 0.13 * esc, borderColor: CINZA(0.1), borderWidth: 0.6 });
    L(px2, y + mf + 1.45 * esc, px2, y + mf + 0.8 * esc, 0.8);
    L(px2, y + mf + 0.8 * esc, px2 - 0.2 * esc, y + mf, 0.7); L(px2, y + mf + 0.8 * esc, px2 + 0.2 * esc, y + mf, 0.7);
    L(px2 - 0.3 * esc, y + mf + 1.2 * esc, px2 + 0.3 * esc, y + mf + 1.2 * esc, 0.6);
  }
  // cotas
  const cota = (x1: number, x2: number, t: string) => {
    page.drawLine({ start: { x: x1, y: y - 3 * k }, end: { x: x2, y: y - 3 * k }, thickness: 0.4 });
    textoCentrado(page, f, t, (x1 + x2) / 2, y - 10 * k, 6 * k, CINZA(0));
  };
  cota(x, x + wC, fmt(calcada)); cota(x + wC, x + wC + wP, fmt(pista)); cota(x + wC + wP, x + 2 * wC + wP, fmt(calcada));
  texto(page, fb, "SEÇÃO TÍPICA DAS RUAS", x, y + 6.3 * esc, 8 * k, CINZA(0));
  texto(page, f, T(`Largura total ${fmt(pista + 2 * calcada)} m — pista ${fmt(pista)} m e passeios de ${fmt(calcada)} m`), x, y + 6.3 * esc - 10 * k, 6 * k, CINZA(0.3));
}

/** Caixa "DETALHES DE ESQUINAS": alinhamento do lote, meio-fio e o raio/chanfro. */
function detalheEsquina(page: PDFPage, f: PDFFont, fb: PDFFont, x: number, y: number, lado: number, pr: Projeto, k: number) {
  const p = pr.params;
  page.drawRectangle({ x, y, width: lado, height: lado, borderColor: CINZA(0), borderWidth: 0.7 });
  texto(page, fb, "DETALHES DE ESQUINAS", x + 8, y + lado - 14 * k, 7.5 * k, CINZA(0));
  texto(page, f, "ESC: SEM", x + 8, y + lado - 21 * k, 5 * k, CINZA(0.3));
  const calc = Math.max(0, (p.ruaLargura - p.ruaPista) / 2);
  const s = (lado * 0.55) / Math.max(8, p.esquinaValor * 2 + calc + 4);
  const ox = x + lado * 0.22, oy = y + lado * 0.68; // canto do lote
  const r = p.esquina === "nenhuma" ? 0 : p.esquinaValor * s;
  // testada do lote (preto) e meio-fio (afastado da calçada)
  const C = CINZA(0);
  if (p.esquina === "raio" && r > 0) {
    page.drawSvgPath(`M0 ${r} A ${r} ${r} 0 0 1 ${r} 0`, { x: ox, y: oy, borderColor: VERMELHO, borderWidth: 0.9 });
  } else if (p.esquina === "chanfro" && r > 0) {
    page.drawLine({ start: { x: ox, y: oy - r }, end: { x: ox + r, y: oy }, thickness: 0.9, color: VERMELHO });
  }
  page.drawLine({ start: { x: ox + r, y: oy }, end: { x: x + lado - 6, y: oy }, thickness: 0.8, color: C });
  page.drawLine({ start: { x: ox, y: oy - r }, end: { x: ox, y: y + 6 }, thickness: 0.8, color: C });
  const d = calc * s;
  page.drawLine({ start: { x: ox + r, y: oy + d }, end: { x: x + lado - 6, y: oy + d }, thickness: 0.6, color: C });
  page.drawLine({ start: { x: ox - d, y: oy - r }, end: { x: ox - d, y: y + 6 }, thickness: 0.6, color: C });
  if (r > 0) textoCentrado(page, f, `${p.esquina === "raio" ? "R=" : ""}${fmt(p.esquinaValor)}`, ox + r * 0.2, oy - r * 0.2, 5 * k, VERMELHO, -45);
  texto(page, f, "MEIO-FIO", x + lado - 34 * k, oy + d + 2, 4.5 * k, C);
  texto(page, f, "TESTADA DO LOTE", x + lado - 46 * k, oy - 7 * k, 4.5 * k, C);
  textoCentrado(page, f, `PASSEIO ${fmt(calc)}`, x + lado - 30 * k, oy + d / 2, 4.5 * k, CINZA(0.35));
}

// ---------------------------------------------------------------------------

function paginasQuadro(res: Resultado, folha: Folha): number {
  const [fw, fh] = FOLHAS[folha];
  const linhas = Math.floor(((fh - 20) * MM - 90) / 10.5);
  const colunas = Math.max(1, Math.floor(((fw - 35) * MM) / 420));
  return Math.max(1, Math.ceil((res.lotes.length + res.quadras.length * 2) / (linhas * colunas)));
}

function desenharQuadroDeLotes(pdf: PDFDocument, res: Resultado, pr: Projeto, fonte: PDFFont, negrito: PDFFont, folha: Folha, den: number) {
  const [fw, fh] = FOLHAS[folha];
  const W = fw * MM, H = fh * MM, mL = 25 * MM, mO = 10 * MM;
  const larguraCol = 405, gap = 15;
  const colunas = Math.max(1, Math.floor((W - mL - mO - 16) / (larguraCol + gap)));
  const linhasPorCol = Math.floor((H - 2 * mO - 90) / 10.5);
  const total = paginasQuadro(res, folha);
  // linhas: cabeçalho de quadra + lotes
  const itens: ({ t: "q"; nome: string } | { t: "l"; cel: string[] })[] = [];
  for (const q of res.quadras) {
    itens.push({ t: "q", nome: q.nome });
    for (const l of [...q.lotes].sort((a, b) => a.numero - b.numero)) {
      const r = resumoLote(l);
      itens.push({ t: "l", cel: [String(l.numero).padStart(2, "0"), fmt(r.medidas[0]), fmt(r.medidas[1]), fmt(r.medidas[2]), fmt(r.medidas[3]), fmt(l.area)] });
    }
  }
  const larg = [42, 66, 66, 66, 66, 99];
  const cab = ["LOTE", "FRENTE", "LADO DIR.", "FUNDOS", "LADO ESQ.", "ÁREA (m²)"];
  let i = 0;
  for (let pg = 0; pg < total && i < itens.length; pg++) {
    const page = pdf.addPage([W, H]);
    page.drawRectangle({ x: mL, y: mO, width: W - mL - mO, height: H - 2 * mO, borderWidth: 1.4, borderColor: CINZA(0) });
    texto(page, negrito, T(`QUADRO DE LOTES — ${pr.nome.toUpperCase()}`), mL + 12, H - mO - 26, 14, CINZA(0));
    texto(page, fonte, T(`Medidas em metros (frente, lado direito, fundos e lado esquerdo de quem da rua olha o lote); áreas em m². Planta na escala 1:${fmt(den, 0)}. Folha ${String(pg + 2).padStart(2, "0")}/${String(total + 1).padStart(2, "0")}.`), mL + 12, H - mO - 42, 8, CINZA(0.3));
    for (let c = 0; c < colunas && i < itens.length; c++) {
      const x0 = mL + 12 + c * (larguraCol + gap);
      let y = H - mO - 64;
      let xx = x0;
      page.drawRectangle({ x: x0, y: y - 3, width: larguraCol, height: 12, color: CINZA(0.88) });
      cab.forEach((h, k) => { texto(page, negrito, T(h), xx + 3, y, 6.8, CINZA(0)); xx += larg[k]; });
      y -= 11;
      for (let lin = 0; lin < linhasPorCol && i < itens.length; lin++, i++) {
        const it = itens[i];
        if (it.t === "q") {
          page.drawRectangle({ x: x0, y: y - 3, width: larguraCol, height: 10.5, color: rgb(0.89, 0.95, 0.91) });
          texto(page, negrito, T(`QUADRA ${it.nome}`), x0 + 3, y, 7.2, rgb(0.05, 0.3, 0.2));
        } else {
          xx = x0;
          it.cel.forEach((v, k) => { texto(page, k === 0 || k === 5 ? negrito : fonte, v, xx + 3, y, 7, CINZA(0.05)); xx += larg[k]; });
          page.drawLine({ start: { x: x0, y: y - 3 }, end: { x: x0 + larguraCol, y: y - 3 }, thickness: 0.2, color: CINZA(0.75) });
        }
        y -= 10.5;
      }
    }
  }
}

function recortar(a: Pt, b: Pt, res: Resultado): [Pt | null, Pt | null] {
  // trecho do eixo dentro da gleba (o eixo das ruas automáticas passa um pouco da divisa)
  const dentro = (p: Pt) => {
    const e = res.gleba.ext;
    let d = false;
    for (let i = 0, j = e.length - 1; i < e.length; j = i++) {
      if ((e[i][1] > p[1]) !== (e[j][1] > p[1]) && p[0] < ((e[j][0] - e[i][0]) * (p[1] - e[i][1])) / (e[j][1] - e[i][1]) + e[i][0]) d = !d;
    }
    return d;
  };
  const N = 60;
  let ini: Pt | null = null, fim: Pt | null = null;
  for (let k = 0; k <= N; k++) {
    const p: Pt = [a[0] + ((b[0] - a[0]) * k) / N, a[1] + ((b[1] - a[1]) * k) / N];
    if (dentro(p)) { if (!ini) ini = p; fim = p; }
  }
  return [ini, fim];
}

function texto(page: PDFPage, f: PDFFont, t: string, x: number, y: number, tam: number, cor: RGB, rot = 0) {
  page.drawText(T(t), { x, y, size: tam, font: f, color: cor, rotate: rot ? degrees(rot) : undefined });
}

function textoCentrado(page: PDFPage, f: PDFFont, t: string, x: number, y: number, tam: number, cor: RGB, rot = 0) {
  const s = T(t);
  const w = f.widthOfTextAtSize(s, tam);
  const a = (rot * Math.PI) / 180;
  const dx = Math.cos(a), dy = Math.sin(a);
  // centro (x, y) → canto inferior esquerdo do texto girado
  const x0 = x - dx * (w / 2) + dy * (tam * 0.35);
  const y0 = y - dy * (w / 2) - dx * (tam * 0.35);
  page.drawText(s, { x: x0, y: y0, size: tam, font: f, color: cor, rotate: rot ? degrees(rot) : undefined });
}

function tabela(page: PDFPage, f: PDFFont, fb: PDFFont, x: number, y: number, larg: number[], cab: string[], linhas: string[][], tam: number, destacar = -1): number {
  const alt = tam + 4.2;
  let xx = x;
  page.drawRectangle({ x, y: y - 3, width: larg.reduce((s, v) => s + v, 0), height: alt, color: CINZA(0.9) });
  cab.forEach((h, k) => { texto(page, fb, T(h), xx + 2, y, tam * 0.85, CINZA(0)); xx += larg[k]; });
  y -= alt;
  linhas.forEach((l, i) => {
    xx = x;
    l.forEach((v, k) => {
      const fonte = i === destacar ? fb : f;
      const s = fit(T(v), fonte, tam, larg[k] - 4);
      const w = fonte.widthOfTextAtSize(s, tam);
      texto(page, fonte, s, k === 0 ? xx + 2 : xx + larg[k] - 2 - w, y, tam, CINZA(0.05));
      xx += larg[k];
    });
    page.drawLine({ start: { x, y: y - 3 }, end: { x: x + larg.reduce((s, v) => s + v, 0), y: y - 3 }, thickness: 0.25, color: CINZA(0.6) });
    y -= alt;
  });
  return y;
}

function fit(t: string, f: PDFFont, tam: number, w: number): string {
  let s = T(t);
  while (s.length > 3 && f.widthOfTextAtSize(s, tam) > w) s = s.slice(0, -2) + "…";
  return T(s);
}

