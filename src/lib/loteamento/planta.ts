// Planta do loteamento em PDF (vai para o cliente e para a prefeitura).
//
// Folha 1: o projeto em escala normalizada — lotes cotados e numerados,
// quadras, ruas com nome e largura, áreas públicas, perímetro com os vértices
// e os confrontantes, malha UTM, norte e escala gráfica; à direita o quadro de
// áreas, o resumo por quadra, a legenda, as notas e o carimbo.
// Folha 2+: o quadro de lotes (frente, lados, fundos e área de cada um).
//
// Gerado no navegador com pdf-lib: a planta acompanha o desenho na hora, sem
// ida ao servidor (a VPS não é sobrecarregada com isto).
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import type { PDFFont, PDFImage, PDFPage, RGB } from "pdf-lib";
import { textoWinAnsi } from "../../../supabase/functions/_shared/texto.ts";
import { caixa, centroide, dist, esquerda, sub, unit } from "./geom.ts";
import type { Anel, Poligono, Pt } from "./geom.ts";
import { fmt, viarioDe } from "./calculo.ts";
import type { Perimetro, Resultado } from "./calculo.ts";
import { paraUtm } from "./plano.ts";
import type { Projeto } from "./modelo.ts";
import { resumoLote } from "./saidas.ts";

export type Folha = "A0" | "A1" | "A2" | "A3";
const FOLHAS: Record<Folha, [number, number]> = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297] };
const MM = 72 / 25.4;
const ESCALAS = [200, 250, 500, 750, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 20000];

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
  rtRegistro: string;
  trt: string;
  desenhista: string;
  fuso: number;
  logo?: { bytes: Uint8Array; tipo: "png" | "jpg" } | null;
}

const T = (s: string) => textoWinAnsi(s);
const CINZA = (v: number) => rgb(v, v, v);
const COR_AREA: Record<string, RGB> = {
  verde: rgb(0.78, 0.9, 0.72), institucional: rgb(0.98, 0.86, 0.7), lazer: rgb(0.78, 0.9, 0.96), app: rgb(0.74, 0.85, 0.96),
};

export function escalaPara(res: Resultado, folha: Folha): number {
  const [w, h] = FOLHAS[folha];
  const areaW = (w - 25 - 10 - 190 - 8) * 0.94, areaH = (h - 20) * 0.94;
  const { min, max } = caixa(res.gleba.ext);
  const den = Math.max(((max[0] - min[0]) * 1000) / areaW, ((max[1] - min[1]) * 1000) / areaH);
  return ESCALAS.find((e) => e >= den) ?? Math.ceil(den / 1000) * 1000;
}

export async function gerarPlantaPdf(res: Resultado, pr: Projeto, perimetro: Perimetro, c: DadosCarimbo, folha: Folha = "A1"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(T(`Planta do loteamento ${pr.nome}`));
  pdf.setCreator("Vértice");
  const fonte = await pdf.embedFont(StandardFonts.Helvetica);
  const negrito = await pdf.embedFont(StandardFonts.HelveticaBold);
  let logo: PDFImage | null = null;
  if (c.logo) {
    try { logo = c.logo.tipo === "png" ? await pdf.embedPng(c.logo.bytes) : await pdf.embedJpg(c.logo.bytes); } catch { logo = null; }
  }
  const [fw, fh] = FOLHAS[folha];
  const W = fw * MM, H = fh * MM;
  const page = pdf.addPage([W, H]);
  const mL = 25 * MM, mO = 10 * MM;
  const larguraBarra = 190 * MM;
  // moldura
  page.drawRectangle({ x: mL, y: mO, width: W - mL - mO, height: H - 2 * mO, borderWidth: 1.4, borderColor: CINZA(0) });
  const barraX = W - mO - larguraBarra;
  page.drawLine({ start: { x: barraX, y: mO }, end: { x: barraX, y: H - mO }, thickness: 1.2 });

  // ---------------------------------------------------------------- desenho
  const den = escalaPara(res, folha);
  const ptm = (1000 / den) * MM; // pontos por metro
  const area = { x: mL + 4 * MM, y: mO + 4 * MM, w: barraX - mL - 8 * MM, h: H - 2 * mO - 8 * MM };
  const bb = caixa(res.gleba.ext);
  const cx = (bb.min[0] + bb.max[0]) / 2, cy = (bb.min[1] + bb.max[1]) / 2;
  const ox = area.x + area.w / 2, oy = area.y + area.h / 2;
  const P = (p: Pt): Pt => [ox + (p[0] - cx) * ptm, oy + (p[1] - cy) * ptm];
  // caminho SVG relativo à origem (ox, oy), com y para baixo (convenção do drawSvgPath)
  const svg = (pol: Poligono) => {
    const r = (a: Anel) => "M" + a.map((p) => `${((p[0] - cx) * ptm).toFixed(2)} ${(-(p[1] - cy) * ptm).toFixed(2)}`).join("L") + "Z";
    return r(pol.ext) + pol.furos.map(r).join("");
  };
  const desenharPol = (pol: Poligono, o: { cor?: RGB; borda?: RGB; esp?: number }) => {
    page.drawSvgPath(svg(pol), { x: ox, y: oy, color: o.cor, borderColor: o.borda, borderWidth: o.esp ?? 0 });
  };

  // malha UTM (linhas claras + rótulos na moldura)
  const passoMalha = [50, 100, 200, 250, 500, 1000].find((p) => (area.w / ptm) / p <= 12) ?? 1000;
  const U = (p: Pt) => paraUtm(res.plano, p);
  const inv = (e: number, n: number): Pt => [(e - res.plano.centro[0]) / res.plano.k, (n - res.plano.centro[1]) / res.plano.k];
  const cantoMin = U([cx - area.w / 2 / ptm, cy - area.h / 2 / ptm]), cantoMax = U([cx + area.w / 2 / ptm, cy + area.h / 2 / ptm]);
  for (let e = Math.ceil(cantoMin[0] / passoMalha) * passoMalha; e < cantoMax[0]; e += passoMalha) {
    const x = P(inv(e, res.plano.centro[1]))[0];
    page.drawLine({ start: { x, y: area.y }, end: { x, y: area.y + area.h }, thickness: 0.25, color: CINZA(0.82) });
    texto(page, fonte, `E ${fmt(e, 0)}`, x + 2, area.y + 3, 6, CINZA(0.45), 90);
  }
  for (let n = Math.ceil(cantoMin[1] / passoMalha) * passoMalha; n < cantoMax[1]; n += passoMalha) {
    const y = P(inv(res.plano.centro[0], n))[1];
    page.drawLine({ start: { x: area.x, y }, end: { x: area.x + area.w, y }, thickness: 0.25, color: CINZA(0.82) });
    texto(page, fonte, `N ${fmt(n, 0)}`, area.x + 3, y + 2, 6, CINZA(0.45));
  }

  // viário, áreas, lotes, quadras, perímetro
  for (const v of viarioDe(res)) desenharPol(v, { cor: CINZA(0.93) });
  for (const a of res.publicas) desenharPol(a.pol, { cor: COR_AREA[a.tipo], borda: CINZA(0.25), esp: 0.5 });
  for (const l of res.lotes) desenharPol(l.pol, { borda: CINZA(0.15), esp: 0.35 });
  for (const q of res.quadras) desenharPol(q.pol, { borda: CINZA(0), esp: 0.9 });
  for (const r of res.ruas) {
    for (let i = 0; i + 1 < r.eixo.length; i++) {
      const [a, b] = recortar(r.eixo[i], r.eixo[i + 1], res);
      if (!a || !b) continue;
      const A = P(a), B = P(b);
      page.drawLine({ start: { x: A[0], y: A[1] }, end: { x: B[0], y: B[1] }, thickness: 0.35, color: rgb(0.75, 0.2, 0.2), dashArray: [8, 3, 1.5, 3] });
    }
  }
  desenharPol(res.gleba, { borda: CINZA(0), esp: 1.8 });

  // vértices do perímetro e confrontantes (por fora)
  const glebaCcw = res.gleba.ext;
  const sentidoIgual = (() => {
    // os pontos do levantamento podem estar no sentido contrário ao anel anti-horário
    const p0 = res.ladosGleba[0];
    const i = glebaCcw.findIndex((q) => dist(q, p0.a) < 0.01);
    return i >= 0 && dist(glebaCcw[(i + 1) % glebaCcw.length], p0.b) < 0.01;
  })();
  res.ladosGleba.forEach((l, i) => {
    const A = P(l.a);
    page.drawCircle({ x: A[0], y: A[1], size: 1.6, color: CINZA(1), borderColor: CINZA(0), borderWidth: 0.6 });
    const nome = perimetro.nomes?.[i];
    if (nome) texto(page, fonte, nome, A[0] + 2.5, A[1] + 2.5, 5, CINZA(0.25));
    const comp = dist(l.a, l.b);
    if (comp * ptm < 60) return;
    const conf = l.tipo === "via" ? (l.nome || "Estrada existente") : (perimetro.confrontantes[i] ?? "");
    const d = unit(sub(l.b, l.a));
    const fora = sentidoIgual ? [d[1], -d[0]] as Pt : [-d[1], d[0]] as Pt;
    const m: Pt = [(l.a[0] + l.b[0]) / 2, (l.a[1] + l.b[1]) / 2];
    const M = P(m);
    const off = 9;
    let ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
    if (conf) textoCentrado(page, fonte, T(conf.slice(0, 70)), M[0] + fora[0] * off, M[1] + fora[1] * off, 6.2, CINZA(0.2), ang);
    textoCentrado(page, fonte, `${fmt(comp)} m`, M[0] + fora[0] * (off + 8), M[1] + fora[1] * (off + 8), 5, CINZA(0.4), ang);
  });

  // cotas dos lotes (uma vez por aresta), número e área
  const tamNum = Math.max(4.5, Math.min(11, pr.params.frente * ptm * 0.32));
  const tamCota = Math.max(3.2, Math.min(6.5, pr.params.frente * ptm * 0.16));
  const cotadas = new Set<string>();
  for (const l of res.lotes) {
    const c = P(centroide(l.pol.ext));
    textoCentrado(page, negrito, String(l.numero).padStart(2, "0"), c[0], c[1] + tamNum * 0.15, tamNum, CINZA(0));
    textoCentrado(page, fonte, `${fmt(l.area)} m²`, c[0], c[1] - tamNum * 0.85, tamNum * 0.58, CINZA(0.25));
    for (const lado of l.lados) {
      const k = [lado.a, lado.b].map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).sort().join("|");
      if (cotadas.has(k)) continue;
      cotadas.add(k);
      const largura = fonte.widthOfTextAtSize(fmt(lado.comp), tamCota);
      if (lado.comp * ptm < largura + 4) continue;
      const d = unit(sub(lado.b, lado.a));
      const dentro = esquerda(d);
      const m = P([(lado.a[0] + lado.b[0]) / 2, (lado.a[1] + lado.b[1]) / 2]);
      let ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      textoCentrado(page, fonte, fmt(lado.comp), m[0] + dentro[0] * tamCota * 0.9, m[1] + dentro[1] * tamCota * 0.9, tamCota, CINZA(0.3), ang);
    }
  }
  // letra da quadra num círculo
  for (const q of res.quadras) {
    const ctr = q.fundo ? P([(q.fundo.a[0] + q.fundo.b[0]) / 2, (q.fundo.a[1] + q.fundo.b[1]) / 2]) : P(q.centro);
    const r = Math.max(7, Math.min(16, tamNum * 1.3));
    page.drawCircle({ x: ctr[0], y: ctr[1], size: r, color: CINZA(1), borderColor: CINZA(0), borderWidth: 0.8 });
    textoCentrado(page, negrito, q.nome, ctr[0], ctr[1] - r * 0.02, r * 1.05, CINZA(0));
  }
  // ruas
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
    const tam = Math.max(5, Math.min(10, r.largura * ptm * 0.42));
    textoCentrado(page, negrito, T(`${r.nome.toUpperCase()}  (${fmt(r.largura)} m)`), (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, tam, rgb(0.45, 0.1, 0.1), ang);
  }
  // áreas públicas
  for (const a of res.publicas) {
    if (a.area < 100) continue; // nesga: conta no quadro, não ganha rótulo
    const c = P(centroide(a.pol.ext));
    textoCentrado(page, negrito, T(a.nome), c[0], c[1] + 3, 7.5, CINZA(0.1));
    textoCentrado(page, fonte, `${fmt(a.area)} m²`, c[0], c[1] - 7, 6.5, CINZA(0.2));
  }

  // norte e escala gráfica
  const nx = area.x + area.w - 30, ny = area.y + area.h - 50;
  page.drawSvgPath("M0 -34 L10 0 L0 -8 L-10 0 Z", { x: nx, y: ny + 34, color: CINZA(0.1) });
  textoCentrado(page, negrito, "N", nx, ny + 40, 12, CINZA(0));
  textoCentrado(page, fonte, "NQ (UTM)", nx, ny - 12, 5.5, CINZA(0.3));
  const passoEsc = [5, 10, 20, 25, 50, 100, 200, 250, 500].find((p) => p * ptm >= 40) ?? 500;
  const ex = area.x + 12, ey = area.y + 14;
  for (let i = 0; i < 4; i++) {
    page.drawRectangle({ x: ex + i * passoEsc * ptm, y: ey, width: passoEsc * ptm, height: 4, color: i % 2 ? CINZA(1) : CINZA(0), borderColor: CINZA(0), borderWidth: 0.5 });
    texto(page, fonte, `${passoEsc * i}`, ex + i * passoEsc * ptm - 2, ey + 7, 6, CINZA(0));
  }
  texto(page, fonte, `${passoEsc * 4} m`, ex + 4 * passoEsc * ptm - 3, ey + 7, 6, CINZA(0));
  texto(page, negrito, `ESCALA 1:${fmt(den, 0)}`, ex, ey - 9, 8, CINZA(0));

  // ---------------------------------------------------------------- barra lateral
  const bx = barraX + 5 * MM, bw = larguraBarra - 10 * MM;
  let y = H - mO - 8 * MM;
  texto(page, negrito, "PROJETO URBANÍSTICO DE LOTEAMENTO", bx, y, 13, CINZA(0));
  y -= 17;
  texto(page, negrito, T(pr.nome.toUpperCase()), bx, y, 11, rgb(0.07, 0.42, 0.26));
  y -= 13;
  texto(page, fonte, T([c.municipio, c.uf].filter(Boolean).join(" / ")), bx, y, 8.5, CINZA(0.25));
  y -= 16;

  // quadro de áreas
  const q = res.quadro;
  const pct = (v: number) => `${fmt((100 * v) / q.gleba)}%`;
  y = tituloSecao(page, negrito, "QUADRO DE ÁREAS", bx, y, bw);
  const linhasQA: [string, string, string][] = [
    [`Área dos lotes (${q.lotes.qtd} lotes)`, fmt(q.lotes.area), pct(q.lotes.area)],
    ["Sistema viário", fmt(q.viario), pct(q.viario)],
    ["Áreas verdes", fmt(q.verde + q.lazer), pct(q.verde + q.lazer)],
    ["Área institucional", fmt(q.institucional), pct(q.institucional)],
    ...(q.app > 0 ? [["APP / faixa non aedificandi", fmt(q.app), pct(q.app)] as [string, string, string]] : []),
    ...(q.sobras > 0 ? [["Remanescente", fmt(q.sobras), pct(q.sobras)] as [string, string, string]] : []),
    ["ÁREA TOTAL DA GLEBA", fmt(q.gleba), "100,00%"],
  ];
  y = tabela(page, fonte, negrito, bx, y, [bw * 0.56, bw * 0.26, bw * 0.18], ["ESPECIFICAÇÃO", "ÁREA (m²)", "%"], linhasQA, 7.2, linhasQA.length - 1);
  y -= 4;
  texto(page, fonte, T(`Áreas públicas (viário + verdes + institucional): ${fmt(q.publicas)} m² = ${pct(q.publicas)}`), bx, y, 6.6, CINZA(0.2));
  y -= 14;

  // quadras
  y = tituloSecao(page, negrito, "QUADRAS", bx, y, bw);
  const linhasQ = res.quadras.map((qq) => [qq.nome, String(qq.lotes.length), fmt(qq.lotes.reduce((s, l) => s + l.area, 0))]);
  const colunas = linhasQ.length > 14 ? 2 : 1;
  const porCol = Math.ceil(linhasQ.length / colunas);
  const wCol = (bw - (colunas - 1) * 8) / colunas;
  let yMin = y;
  for (let k = 0; k < colunas; k++) {
    const yy = tabela(page, fonte, negrito, bx + k * (wCol + 8), y, [wCol * 0.3, wCol * 0.25, wCol * 0.45], ["QUADRA", "LOTES", "ÁREA (m²)"], linhasQ.slice(k * porCol, (k + 1) * porCol), 7);
    yMin = Math.min(yMin, yy);
  }
  y = yMin - 10;

  // áreas públicas e ruas
  if (res.publicas.length) {
    y = tituloSecao(page, negrito, "ÁREAS PÚBLICAS", bx, y, bw);
    y = tabela(page, fonte, negrito, bx, y, [bw * 0.62, bw * 0.38], ["ÁREA", "m²"], res.publicas.map((a) => [T(a.nome), fmt(a.area)]), 7);
    y -= 10;
  }
  if (res.ruas.length) {
    y = tituloSecao(page, negrito, "SISTEMA VIÁRIO", bx, y, bw);
    const pista = pr.params.ruaPista, calc = (r: number) => Math.max(0, (r - pista) / 2);
    y = tabela(page, fonte, negrito, bx, y, [bw * 0.36, bw * 0.2, bw * 0.22, bw * 0.22], ["VIA", "LARGURA", "EXTENSÃO", "ÁREA (m²)"],
      res.ruas.map((r) => [T(r.nome), `${fmt(r.largura)} m`, `${fmt(r.comprimento, 1)} m`, fmt(r.area)]), 6.8);
    y -= 4;
    texto(page, fonte, T(`Seção típica: pista ${fmt(pista)} m + calçadas ${fmt(calc(pr.params.ruaLargura))} m de cada lado.`), bx, y, 6.4, CINZA(0.25));
    y -= 14;
  }

  // legenda
  y = tituloSecao(page, negrito, "LEGENDA", bx, y, bw);
  const leg: [string, (x: number, yy: number) => void][] = [
    ["Perímetro da gleba", (x, yy) => page.drawLine({ start: { x, y: yy + 3 }, end: { x: x + 22, y: yy + 3 }, thickness: 1.8 })],
    ["Alinhamento da quadra", (x, yy) => page.drawLine({ start: { x, y: yy + 3 }, end: { x: x + 22, y: yy + 3 }, thickness: 0.9 })],
    ["Divisa de lote", (x, yy) => page.drawLine({ start: { x, y: yy + 3 }, end: { x: x + 22, y: yy + 3 }, thickness: 0.35 })],
    ["Eixo de rua", (x, yy) => page.drawLine({ start: { x, y: yy + 3 }, end: { x: x + 22, y: yy + 3 }, thickness: 0.4, color: rgb(0.75, 0.2, 0.2), dashArray: [6, 2, 1, 2] })],
    ["Área verde", (x, yy) => page.drawRectangle({ x, y: yy - 1, width: 22, height: 8, color: COR_AREA.verde, borderColor: CINZA(0.3), borderWidth: 0.4 })],
    ["Área institucional", (x, yy) => page.drawRectangle({ x, y: yy - 1, width: 22, height: 8, color: COR_AREA.institucional, borderColor: CINZA(0.3), borderWidth: 0.4 })],
    ...(q.app > 0 ? [["APP / non aedificandi", (x: number, yy: number) => page.drawRectangle({ x, y: yy - 1, width: 22, height: 8, color: COR_AREA.app, borderColor: CINZA(0.3), borderWidth: 0.4 })] as [string, (x: number, yy: number) => void]] : []),
  ];
  leg.forEach(([rot, f], i) => {
    const col = i % 2, lin = Math.floor(i / 2);
    const x = bx + col * (bw / 2), yy = y - lin * 13 - 8;
    f(x, yy);
    texto(page, fonte, T(rot), x + 27, yy, 7, CINZA(0.1));
  });
  y -= Math.ceil(leg.length / 2) * 13 + 14;

  // notas
  y = tituloSecao(page, negrito, "NOTAS", bx, y, bw);
  const p = pr.params;
  const notas = [
    `Coordenadas no SGR SIRGAS 2000, projeção UTM fuso ${c.fuso}S (MC ${6 * c.fuso - 183}°).`,
    res.plano.terreno
      ? `Distâncias e áreas no plano topográfico (medidas de terreno). Fator de escala combinado no centro da gleba: k = ${res.plano.k.toFixed(8)}.`
      : "Distâncias e áreas no plano da projeção UTM.",
    `Lote padrão ${fmt(p.frente)} x ${fmt(p.profundidade)} m; lote mínimo ${fmt(p.areaMin)} m² e frente mínima ${fmt(p.frenteMin)} m.`,
    p.esquina === "raio" ? `Esquinas em curva de raio ${fmt(p.esquinaValor)} m no alinhamento.` : p.esquina === "chanfro" ? `Esquinas chanfradas em ${fmt(p.esquinaValor)} m em cada alinhamento.` : "Esquinas em canto vivo.",
    "Medidas em metros; áreas em metros quadrados.",
  ];
  for (const n of notas) {
    for (const linha of quebrar(T(n), fonte, 6.6, bw)) { texto(page, fonte, linha, bx, y, 6.6, CINZA(0.15)); y -= 8.5; }
    y -= 1.5;
  }

  // carimbo (fundo da barra)
  const alturaCarimbo = 205;
  const cyB = mO + 4 * MM;
  page.drawRectangle({ x: bx - 2, y: cyB, width: bw + 4, height: alturaCarimbo, borderWidth: 0.9, borderColor: CINZA(0) });
  let yc = cyB + alturaCarimbo - 6;
  if (logo) {
    const s = Math.min(150 / logo.width, 42 / logo.height);
    page.drawImage(logo, { x: bx + 4, y: yc - logo.height * s, width: logo.width * s, height: logo.height * s });
  }
  const xTexto = logo ? bx + 162 : bx + 4;
  texto(page, negrito, T(c.empresa || "Responsável pelo projeto"), xTexto, yc - 12, 9, CINZA(0));
  if (c.cnpj) texto(page, fonte, T(`CNPJ ${c.cnpj}`), xTexto, yc - 23, 7, CINZA(0.25));
  yc -= 50;
  const campos: [string, string][] = [
    ["PROPRIETÁRIO", [c.proprietario, c.cpfProprietario ? `CPF/CNPJ ${c.cpfProprietario}` : ""].filter(Boolean).join(" — ")],
    ["IMÓVEL", [c.imovel, c.matricula ? `Matrícula ${c.matricula}` : ""].filter(Boolean).join(" — ")],
    ["MUNICÍPIO", [c.municipio, c.uf].filter(Boolean).join(" / ")],
    ["RESPONSÁVEL TÉCNICO", [c.rt, c.rtRegistro].filter(Boolean).join(" — ")],
    ["ART/TRT", c.trt],
  ];
  for (const [rot, val] of campos) {
    page.drawLine({ start: { x: bx - 2, y: yc + 10 }, end: { x: bx + bw + 2, y: yc + 10 }, thickness: 0.4 });
    texto(page, fonte, rot, bx + 2, yc + 3, 5.4, CINZA(0.4));
    texto(page, negrito, T(fit(val || "—", negrito, 7.6, bw - 70)), bx + 66, yc + 1.8, 7.6, CINZA(0));
    yc -= 15;
  }
  page.drawLine({ start: { x: bx - 2, y: yc + 10 }, end: { x: bx + bw + 2, y: yc + 10 }, thickness: 0.4 });
  const linhaInfo: [string, string][] = [
    ["ESCALA", `1:${fmt(den, 0)}`], ["FOLHA", `01/${String(1 + paginasQuadro(res, folha)).padStart(2, "0")} ${folha}`],
    ["DATA", new Date().toLocaleDateString("pt-BR")], ["DESENHO", c.desenhista || "—"],
  ];
  const wInfo = bw / linhaInfo.length;
  linhaInfo.forEach(([rot, val], i) => {
    const x = bx + i * wInfo;
    if (i) page.drawLine({ start: { x: x - 2, y: yc + 10 }, end: { x: x - 2, y: yc - 12 }, thickness: 0.4 });
    texto(page, fonte, rot, x + 2, yc + 3, 5.4, CINZA(0.4));
    texto(page, negrito, T(fit(val, negrito, 7.6, wInfo - 6)), x + 2, yc - 7, 7.6, CINZA(0));
  });
  yc -= 20;
  // assinaturas
  const wAss = (bw - 20) / 2;
  for (const [i, rot] of ["Proprietário", "Responsável técnico"].entries()) {
    const x = bx + 4 + i * (wAss + 12);
    page.drawLine({ start: { x, y: cyB + 20 }, end: { x: x + wAss, y: cyB + 20 }, thickness: 0.5 });
    textoCentrado(page, fonte, rot, x + wAss / 2, cyB + 11, 6.5, CINZA(0.2));
  }
  void yc;

  // ---------------------------------------------------------------- quadro de lotes
  desenharQuadroDeLotes(pdf, res, pr, fonte, negrito, folha, den);
  return pdf.save();
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

function tituloSecao(page: PDFPage, f: PDFFont, t: string, x: number, y: number, w: number): number {
  texto(page, f, t, x, y, 8.5, CINZA(0));
  page.drawLine({ start: { x, y: y - 3 }, end: { x: x + w, y: y - 3 }, thickness: 0.6 });
  return y - 14;
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

function quebrar(t: string, f: PDFFont, tam: number, w: number): string[] {
  const out: string[] = [];
  let linha = "";
  for (const p of t.split(/\s+/)) {
    const tent = linha ? `${linha} ${p}` : p;
    if (f.widthOfTextAtSize(tent, tam) > w && linha) { out.push(linha); linha = p; } else linha = tent;
  }
  if (linha) out.push(linha);
  return out;
}
