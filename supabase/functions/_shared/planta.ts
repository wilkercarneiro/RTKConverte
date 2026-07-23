// Geração da PLANTA (folha A1 paisagem, PDF) do imóvel georreferenciado,
// no padrão da planta final da empresa: malha de coordenadas UTM, polígono,
// estradas em linha dupla vermelha, divisões de confrontação em verde com
// rótulos e linhas de assinatura, quadro analítico, carimbo com a logo,
// bloco planimétrico, RT, selos de cartório e rodapé com escala/datum/folha.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";

// ---------------------------------------------------------------------------
// dados de entrada
// ---------------------------------------------------------------------------
export interface VerticePlanta {
  codigo: string;
  e: number;            // coordenadas planas p/ desenho (m)
  n: number;
  lonFmt: string;       // p/ quadro analítico
  latFmt: string;
  alt: string;
  azFmt: string;        // azimute do segmento que SAI deste vértice
  distFmt: string;
  vante: string;
}

export interface TrechoPlanta {
  descritivo: string;   // formato "(MATR.x/CNS.y) FAZENDA\ NOME\ CPF:..."
  isEstrada: boolean;
  inicioIdx: number;    // índice do vértice inicial no anel
  fimIdx: number;       // índice do vértice inicial do PRÓXIMO trecho
}

export interface DadosPlanta {
  vertices: VerticePlanta[];        // anel na ordem do perímetro
  trechos: TrechoPlanta[];
  denominacao: string;
  proprietarios: { nome: string; cpf: string }[];
  matricula: string;
  cns: string;
  sncr: string;
  municipioUf: string;              // "ARACI-BA"
  areaFmt: string;                  // "84,0638"
  tarefasFmt: string;               // "192,98"
  perimetroFmt: string;             // "4.077,80"
  mcAbs: number;
  fuso: number;
  latMediaDeg: number;              // p/ letra do fuso (24L)
  trt: string;
  rt: { nome: string; formacao: string; conselhoSigla: string; conselhoNumero: string; codigoCredenciado: string };
  desenhista: string;
  dataStr: string;
  logo?: { bytes: Uint8Array; tipo: "png" | "jpg" } | null;
  satelite?: { bytes: Uint8Array; tipo: "png" | "jpg" } | null;
}

// ---------------------------------------------------------------------------
// constantes de folha
// ---------------------------------------------------------------------------
const MM = 2.834645669; // pt por mm
const W = 841 * MM;     // A1 paisagem
const H = 594 * MM;
const AZUL = rgb(0, 0.2, 0.85);
const VERMELHO = rgb(0.85, 0.05, 0.05);
const VERDE = rgb(0.05, 0.65, 0.15);
const PRETO = rgb(0, 0, 0);
const CINZA = rgb(0.45, 0.45, 0.45);

// escala proporcional ao desenho: menor escala redonda em que o polígono cabe
// (passo 50/100/500 conforme a ordem de grandeza) — sem saltar p/ degraus
// padrão distantes, que deixavam o polígono pequeno e a folha vazia
function escalaProporcional(mPorPtMin: number): number {
  const raw = mPorPtMin / 0.000352778;
  const passo = raw <= 1000 ? 50 : raw <= 5000 ? 100 : 500;
  return Math.max(100, Math.ceil(raw / passo) * passo);
}

function letraFuso(latDeg: number): string {
  const bandas = "CDEFGHJKLMNPQRSTUVWX";
  const i = Math.max(0, Math.min(19, Math.floor((latDeg + 80) / 8)));
  return bandas[i];
}

function fmtMilhar(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

interface Ctx { page: PDFPage; f: PDFFont; fb: PDFFont }

function texto(c: Ctx, t: string, x: number, y: number, size: number, opts: { bold?: boolean; cor?: ReturnType<typeof rgb>; rot?: number; center?: boolean } = {}) {
  const font = opts.bold ? c.fb : c.f;
  const tx = opts.center ? x - font.widthOfTextAtSize(t, size) / 2 : x;
  c.page.drawText(t, { x: tx, y, size, font, color: opts.cor ?? PRETO, rotate: opts.rot ? degrees(opts.rot) : undefined });
}

function linha(c: Ctx, x1: number, y1: number, x2: number, y2: number, esp: number, cor = PRETO, dash?: number[]) {
  c.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: esp, color: cor, dashArray: dash });
}

function caixa(c: Ctx, x: number, y: number, w: number, h: number, esp = 1) {
  c.page.drawRectangle({ x, y, width: w, height: h, borderWidth: esp, borderColor: PRETO });
}

function caixaTitulo(c: Ctx, x: number, y: number, w: number, h: number, titulo: string): number {
  caixa(c, x, y, w, h);
  const th = 20;
  caixa(c, x + w / 2 - 120, y + h - th, 240, th, 1);
  texto(c, titulo, x + w / 2, y + h - th + 5.5, 12, { bold: true, center: true });
  return y + h - th; // topo útil
}

// quebra o descritivo em linhas de rótulo (sempre em MAIÚSCULAS)
function linhasDescritivo(descritivo: string): string[] {
  const partes = descritivo.split("\\").map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  const m = partes[0]?.match(/^(\([^)]*\))\s*(.+)$/);
  if (m) { out.push(m[1]); out.push(m[2]); } else if (partes[0]) out.push(partes[0]);
  for (const p of partes.slice(1)) out.push(p);
  return out.map((l) => l.toUpperCase());
}

// ---------------------------------------------------------------------------
// principal
// ---------------------------------------------------------------------------
export async function gerarPlantaPdf(d: DadosPlanta): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([W, H]);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const c: Ctx = { page, f, fb };

  // molduras
  caixa(c, 14, 14, W - 28, H - 28, 2);
  caixa(c, 20, 20, W - 40, H - 40, 0.8);

  // ------------------- área de desenho e barra lateral -------------------
  const SB_W = 470;
  const sbX = W - 20 - SB_W;
  const dArea = { x: 60, y: 60, w: sbX - 100, h: H - 120 };

  // ------------------- escala e projeção papel -------------------
  const vs = d.vertices;
  const minE = Math.min(...vs.map((v) => v.e)), maxE = Math.max(...vs.map((v) => v.e));
  const minN = Math.min(...vs.map((v) => v.n)), maxN = Math.max(...vs.map((v) => v.n));
  const spanE = (maxE - minE) * 1.45 || 100; // folga p/ os rótulos grandes dos confrontantes
  const spanN = (maxN - minN) * 1.40 || 100;
  const mPorPtMin = Math.max(spanE / dArea.w, spanN / dArea.h);
  const escala = escalaProporcional(mPorPtMin);
  const mPorPt = escala * 0.000352778;
  const cxE = (minE + maxE) / 2, cxN = (minN + maxN) / 2;
  const dcx = dArea.x + dArea.w / 2, dcy = dArea.y + dArea.h / 2;
  const X = (e: number) => dcx + (e - cxE) / mPorPt;
  const Y = (n: number) => dcy + (n - cxN) / mPorPt;

  // ------------------- malha de coordenadas -------------------
  const stepCands = [100, 200, 250, 500, 1000, 2000, 5000];
  const alvoM = dArea.w * mPorPt / 5;
  const passo = stepCands.find((s) => s >= alvoM) ?? 5000;
  const e0 = Math.ceil((cxE - dArea.w / 2 * mPorPt) / passo) * passo;
  const n0 = Math.ceil((cxN - dArea.h / 2 * mPorPt) / passo) * passo;
  for (let e = e0; X(e) < dArea.x + dArea.w; e += passo) {
    linha(c, X(e), dArea.y, X(e), dArea.y + dArea.h, 0.4, CINZA, [2, 4]);
    texto(c, `E=${fmtMilhar(e)}`, X(e) + 3.5, dArea.y + dArea.h - 58, 10, { cor: CINZA, rot: -90 });
    texto(c, `E=${fmtMilhar(e)}`, X(e) + 3.5, dArea.y + 8, 10, { cor: CINZA, rot: -90 });
  }
  for (let n = n0; Y(n) < dArea.y + dArea.h; n += passo) {
    linha(c, dArea.x, Y(n), dArea.x + dArea.w, Y(n), 0.4, CINZA, [2, 4]);
    texto(c, `N=${fmtMilhar(n)}`, dArea.x + 2, Y(n) + 2.5, 10, { cor: CINZA });
    texto(c, `N=${fmtMilhar(n)}`, dArea.x + dArea.w - 84, Y(n) + 2.5, 10, { cor: CINZA });
  }

  // ------------------- trechos de estrada (linha dupla vermelha) -------------------
  const nv = vs.length;
  const trechoDoIdx = (i: number): TrechoPlanta => {
    for (const t of d.trechos) {
      if (t.fimIdx > t.inicioIdx ? i >= t.inicioIdx && i < t.fimIdx : i >= t.inicioIdx || i < t.fimIdx) return t;
    }
    return d.trechos[d.trechos.length - 1];
  };
  for (let i = 0; i < nv; i++) {
    const t = trechoDoIdx(i);
    if (!t.isEstrada) continue;
    const a = vs[i], b = vs[(i + 1) % nv];
    const dx = X(b.e) - X(a.e), dy = Y(b.n) - Y(a.n);
    const len = Math.hypot(dx, dy) || 1;
    // normal apontando p/ FORA (lado oposto ao centroide)
    let nx = -dy / len, ny = dx / len;
    const mx = (X(a.e) + X(b.e)) / 2, my = (Y(a.n) + Y(b.n)) / 2;
    if ((mx + nx * 10 - dcx) ** 2 + (my + ny * 10 - dcy) ** 2 < (mx - nx * 10 - dcx) ** 2 + (my - ny * 10 - dcy) ** 2) { nx = -nx; ny = -ny; }
    for (const off of [4, 7]) {
      linha(c, X(a.e) + nx * off, Y(a.n) + ny * off, X(b.e) + nx * off, Y(b.n) + ny * off, 1.6, VERMELHO);
    }
  }

  // ------------------- polígono -------------------
  for (let i = 0; i < nv; i++) {
    const a = vs[i], b = vs[(i + 1) % nv];
    linha(c, X(a.e), Y(a.n), X(b.e), Y(b.n), 1.8, AZUL);
  }
  // vértices + códigos
  for (let i = 0; i < nv; i++) {
    const v = vs[i];
    page.drawCircle({ x: X(v.e), y: Y(v.n), size: 1.6, color: PRETO });
    const prev = vs[(i - 1 + nv) % nv], next = vs[(i + 1) % nv];
    let nx = X(v.e) - dcx, ny = Y(v.n) - dcy;
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    void prev; void next;
    texto(c, v.codigo, X(v.e) + nx * 10, Y(v.n) + ny * 10 - 2.5, 9, { cor: PRETO });
  }

  // ------------------- divisões de confrontação + rótulos -------------------
  const centroLinhas = [
    `(MATR.${d.matricula}/CNS.${d.cns})`,
    d.denominacao,
    ...d.proprietarios.flatMap((p) => [p.nome, `CPF:${p.cpf}`]),
    `ÁREA:${d.areaFmt} HA/ ${d.tarefasFmt} TAREFAS`,
  ].map((l) => l.toUpperCase());
  // bloco do imóvel no centroide — fonte proporcional ao polígono desenhado,
  // p/ o nome interno acompanhar o tamanho da propriedade sem vazar das bordas
  {
    const wPoly = (maxE - minE) / mPorPt, hPoly = (maxN - minN) / mPorPt;
    const larguraMax = Math.max(...centroLinhas.map((l) => fb.widthOfTextAtSize(l, 1)));
    const tamW = (wPoly * 0.72) / larguraMax;
    const tamH = (hPoly * 0.55) / (centroLinhas.length * 1.3);
    const tam = Math.max(8, Math.min(30, Math.min(tamW, tamH)));
    const esp = tam * 1.3;
    let ty = dcy + (centroLinhas.length * esp) / 2;
    for (const [li, lt] of centroLinhas.entries()) {
      texto(c, lt, dcx, ty, tam, { bold: li === 1, center: true });
      ty -= esp;
    }
  }
  for (const t of d.trechos) {
    // ponto médio GEOMÉTRICO do trecho: metade do comprimento da linha do
    // confrontante — o rótulo fica centralizado no "raio" da confrontação
    const idxs: number[] = [];
    for (let i = t.inicioIdx % nv; i !== t.fimIdx % nv; i = (i + 1) % nv) {
      idxs.push(i);
      if (idxs.length >= nv) break;
    }
    if (idxs.length === 0) for (let i = 0; i < nv; i++) idxs.push((t.inicioIdx + i) % nv);
    const segLens = idxs.map((i) => {
      const a = vs[i], b = vs[(i + 1) % nv];
      return Math.hypot(X(b.e) - X(a.e), Y(b.n) - Y(a.n));
    });
    let alvo = segLens.reduce((s, l) => s + l, 0) / 2;
    let mx = X(vs[idxs[0]].e), my = Y(vs[idxs[0]].n), angSeg = 0;
    for (const [k, i] of idxs.entries()) {
      if (alvo <= segLens[k] || k === idxs.length - 1) {
        const a = vs[i], b = vs[(i + 1) % nv];
        const fr = segLens[k] > 0 ? alvo / segLens[k] : 0;
        mx = X(a.e) + (X(b.e) - X(a.e)) * fr;
        my = Y(a.n) + (Y(b.n) - Y(a.n)) * fr;
        angSeg = Math.atan2(Y(b.n) - Y(a.n), X(b.e) - X(a.e)) * 180 / Math.PI;
        break;
      }
      alvo -= segLens[k];
    }
    let nx = mx - dcx, ny = my - dcy;
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;

    if (t.isEstrada) {
      // nome da via rotacionado ao longo do segmento do ponto médio
      const nome = linhasDescritivo(t.descritivo)[0] ?? "";
      texto(c, nome, mx + nx * 32, my + ny * 32, 20, { bold: true, cor: PRETO, rot: angSeg > 90 || angSeg < -90 ? angSeg + 180 : angSeg });
      continue;
    }
    // linha verde de divisão no INÍCIO do trecho
    const vi = vs[t.inicioIdx % nv];
    let gx = X(vi.e) - dcx, gy = Y(vi.n) - dcy;
    const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
    linha(c, X(vi.e), Y(vi.n), X(vi.e) + gx * 65, Y(vi.n) + gy * 65, 1.4, VERDE);
    // rótulo do confrontante: cabeçalho (matrícula + imóvel) e, por pessoa,
    // linha de assinatura larga com nome e CPF centralizados embaixo
    const lts = linhasDescritivo(t.descritivo);
    const header: string[] = [];
    const pessoas: { nome: string; cpf: string }[] = [];
    for (let k = 0; k < lts.length; k++) {
      if (/^CPF/i.test(lts[k])) continue;
      if (k + 1 < lts.length && /^CPF/i.test(lts[k + 1])) pessoas.push({ nome: lts[k], cpf: lts[k + 1] });
      else header.push(lts[k]);
    }
    const ASS_W = 300;                       // largura da linha de assinatura
    const H_HEADER = 22, H_PESSOA = 64;
    const altura = header.length * H_HEADER + 8 + Math.max(pessoas.length, 1) * H_PESSOA;
    // afastamento calculado pela metade do bloco projetada na normal + margem:
    // o rótulo fica AO LADO da linha azul, sem nunca encostar nela
    const blockW = Math.max(ASS_W,
      ...header.map((hh) => fb.widthOfTextAtSize(hh, 18)),
      ...pessoas.map((pp) => Math.max(fb.widthOfTextAtSize(pp.nome, 17), f.widthOfTextAtSize(pp.cpf, 15))));
    const off = Math.abs(nx) * blockW / 2 + Math.abs(ny) * altura / 2 + 26;
    const lx = mx + nx * off;
    let ty = my + ny * off + altura / 2;     // bloco centralizado no ponto médio do trecho
    for (const [hi, ht] of header.entries()) {
      texto(c, ht, lx, ty, 18, { center: true, bold: hi === header.length - 1 });
      ty -= H_HEADER;
    }
    ty -= 8;
    if (pessoas.length === 0) {
      linha(c, lx - ASS_W / 2, ty, lx + ASS_W / 2, ty, 1.1);
    } else {
      for (const p of pessoas) {
        linha(c, lx - ASS_W / 2, ty, lx + ASS_W / 2, ty, 1.1);
        texto(c, p.nome, lx, ty - 19, 17, { center: true, bold: true });
        texto(c, p.cpf, lx, ty - 36, 15, { center: true });
        ty -= H_PESSOA;
      }
    }
  }

  // ------------------- bússola (rosa dos ventos moderna) -------------------
  // estrela de 8 pontas: pontas cardeais com metades preto/branco (efeito 3D),
  // pontas diagonais menores em cinza, dois anéis com marcações a cada 45°
  {
    const bx = dArea.x + dArea.w - 92, by = dArea.y + dArea.h - 126;
    const R = 54;
    // coordenadas SVG (y p/ baixo), 0° = norte, sentido horário
    const pol = (angDeg: number, r: number): [number, number] => {
      const a = angDeg * Math.PI / 180;
      return [Math.sin(a) * r, -Math.cos(a) * r];
    };
    const p = (pt: [number, number]) => `${pt[0].toFixed(2)} ${pt[1].toFixed(2)}`;
    // disco branco + anéis
    page.drawCircle({ x: bx, y: by, size: R, borderWidth: 1.4, borderColor: PRETO, color: rgb(1, 1, 1) });
    page.drawCircle({ x: bx, y: by, size: R - 7, borderWidth: 0.6, borderColor: CINZA });
    // marcações a cada 45° (coordenadas da página: y p/ cima)
    for (let a = 0; a < 360; a += 45) {
      const rad = a * Math.PI / 180;
      const sx = Math.sin(rad), sy = Math.cos(rad);
      linha(c, bx + sx * (R - 7), by + sy * (R - 7), bx + sx * (R - 1.5), by + sy * (R - 1.5), a % 90 === 0 ? 1.2 : 0.7);
    }
    // pontas diagonais (menores, cinza)
    for (const a of [45, 135, 225, 315]) {
      const path = `M ${p(pol(a, 30))} L ${p(pol(a + 45, 9))} L 0 0 L ${p(pol(a - 45, 9))} Z`;
      page.drawSvgPath(path, { x: bx, y: by, color: CINZA, borderColor: PRETO, borderWidth: 0.4 });
    }
    // pontas cardeais (metade escura + metade clara)
    for (const a of [0, 90, 180, 270]) {
      const tip = pol(a, R - 9), sd = pol(a + 45, 12), se = pol(a - 45, 12);
      page.drawSvgPath(`M ${p(tip)} L ${p(sd)} L 0 0 Z`, { x: bx, y: by, color: PRETO });
      page.drawSvgPath(`M ${p(tip)} L ${p(se)} L 0 0 Z`, { x: bx, y: by, color: rgb(1, 1, 1), borderColor: PRETO, borderWidth: 0.6 });
    }
    // miolo e letra N
    page.drawCircle({ x: bx, y: by, size: 3.5, borderWidth: 1.1, borderColor: PRETO, color: rgb(1, 1, 1) });
    texto(c, "N", bx, by + R + 8, 28, { bold: true, center: true });
  }

  // ============================ BARRA LATERAL ============================
  const sbTop = H - 20, sbBot = 20;
  const alturas = { quadro: 0.30, situacao: 0.16, carimbo: 0.15, planimetrico: 0.27, rodape: 0.12 };
  let yCursor = sbTop;

  // ---- QUADRO ANALÍTICO (tabela com grade, colunas centradas) ----
  {
    const h = (sbTop - sbBot) * alturas.quadro;
    const topoUtil = caixaTitulo(c, sbX, yCursor - h, SB_W, h, "QUADRO ANALÍTICO");
    const heads = ["VÉRTICE", "LADO", "LONGITUDE", "LATITUDE", "AZIMUTE", "DIST.(m)", "ALTIT."];
    const cols = [56, 112, 64, 64, 52, 46, 42];
    const tw = cols.reduce((a, b) => a + b, 0);
    const tx0 = sbX + (SB_W - tw) / 2;
    const headH = 14;
    const rowH = 11;
    const tableTop = topoUtil - 5;
    const maxLinhas = Math.max(1, Math.floor((tableTop - headH - (yCursor - h) - 12) / rowH));
    const linhasQ = vs.slice(0, maxLinhas);
    const tableBot = tableTop - headH - linhasQ.length * rowH;
    // moldura, linha do cabeçalho e divisões verticais
    caixa(c, tx0, tableBot, tw, tableTop - tableBot, 1);
    linha(c, tx0, tableTop - headH, tx0 + tw, tableTop - headH, 1);
    let vx = tx0;
    for (const w of cols.slice(0, -1)) { vx += w; linha(c, vx, tableBot, vx, tableTop, 0.6); }
    // divisões horizontais entre as linhas
    for (let r = 1; r < linhasQ.length; r++) {
      const ly = tableTop - headH - r * rowH;
      linha(c, tx0, ly, tx0 + tw, ly, 0.35, CINZA);
    }
    // cabeçalho centrado por coluna
    let hx = tx0;
    for (const [i, hh] of heads.entries()) {
      texto(c, hh, hx + cols[i] / 2, tableTop - headH + 4, 9, { bold: true, center: true });
      hx += cols[i];
    }
    // valores centrados por coluna
    for (const [r, v] of linhasQ.entries()) {
      const vals = [v.codigo, `${v.codigo}-${v.vante}`, v.lonFmt, v.latFmt, v.azFmt, v.distFmt, v.alt];
      const ty = tableTop - headH - (r + 1) * rowH + 3;
      let cx2 = tx0;
      for (const [i, val] of vals.entries()) { texto(c, val, cx2 + cols[i] / 2, ty, 8, { center: true }); cx2 += cols[i]; }
    }
    if (vs.length > linhasQ.length) {
      texto(c, `… +${vs.length - linhasQ.length} vértices (ver memorial tabular)`, tx0, tableBot - 10, 8, { cor: CINZA });
    }
    yCursor -= h;
  }

  // ---- PLANTA DE SITUAÇÃO (imagem de satélite enviada na geração) ----
  {
    const h = (sbTop - sbBot) * alturas.situacao;
    const topoUtil = caixaTitulo(c, sbX, yCursor - h, SB_W, h, "PLANTA DE SITUAÇÃO");
    if (d.satelite) {
      const img = d.satelite.tipo === "png" ? await pdf.embedPng(d.satelite.bytes) : await pdf.embedJpg(d.satelite.bytes);
      const maxW = SB_W - 12, maxH = topoUtil - (yCursor - h) - 10;
      const sc = Math.min(maxW / img.width, maxH / img.height);
      page.drawImage(img, {
        x: sbX + (SB_W - img.width * sc) / 2,
        y: (yCursor - h) + 5 + (maxH - img.height * sc) / 2,
        width: img.width * sc, height: img.height * sc,
      });
    } else {
      texto(c, "(envie a imagem de satélite ao gerar a planta)", sbX + SB_W / 2, yCursor - h / 2, 9, { cor: CINZA, center: true });
    }
    yCursor -= h;
  }

  // ---- CARIMBO DA EMPRESA (logo) ----
  {
    const h = (sbTop - sbBot) * alturas.carimbo;
    const topoUtil = caixaTitulo(c, sbX, yCursor - h, SB_W, h, "CARIMBO DA EMPRESA");
    if (d.logo) {
      const img = d.logo.tipo === "png" ? await pdf.embedPng(d.logo.bytes) : await pdf.embedJpg(d.logo.bytes);
      const maxW = SB_W - 60, maxH = topoUtil - (yCursor - h) - 20;
      const sc = Math.min(maxW / img.width, maxH / img.height);
      page.drawImage(img, {
        x: sbX + (SB_W - img.width * sc) / 2,
        y: (yCursor - h) + (topoUtil - (yCursor - h) - img.height * sc) / 2,
        width: img.width * sc, height: img.height * sc,
      });
    } else {
      texto(c, "(envie a logo em Configurações)", sbX + SB_W / 2, yCursor - h / 2, 9, { cor: CINZA, center: true });
    }
    yCursor -= h;
  }

  // ---- PLANIMÉTRICO ----
  {
    const h = (sbTop - sbBot) * alturas.planimetrico;
    const topoUtil = caixaTitulo(c, sbX, yCursor - h, SB_W, h, "PLANIMÉTRICO DO IMÓVEL GEORREFERENCIADO");
    const colEsq = sbX + 10, colDir = sbX + SB_W / 2 + 10;
    let py = topoUtil - 18;
    const campo = (rot: string, val: string, x: number, y: number) => {
      texto(c, rot, x, y, 9, { bold: true, cor: CINZA });
      texto(c, val, x, y - 13, 12);
    };
    campo("Denominação:", d.denominacao.toUpperCase(), colEsq, py);
    campo("TRT:", d.trt, colDir, py);
    py -= 34;
    texto(c, "Proprietário(s):", colEsq, py, 9, { bold: true, cor: CINZA });
    let ppy = py - 14;
    for (const p of d.proprietarios) { texto(c, p.nome.toUpperCase(), colEsq, ppy, 11); ppy -= 14; }
    campo("Matrícula do Imóvel:", d.matricula, colDir, py);
    campo("Código do Cartório (CNS):", d.cns, colDir, py - 34);
    campo("Código INCRA:", d.sncr, colDir, py - 68);
    campo("Município/UF:", d.municipioUf.toUpperCase(), colDir, py - 102);
    // RT
    const rtY = yCursor - h + 66;
    linha(c, sbX, rtY + 32, sbX + SB_W, rtY + 32, 0.8);
    texto(c, "RESPONSÁVEL TÉCNICO", colEsq, rtY + 21, 9, { bold: true, cor: CINZA });
    texto(c, d.rt.nome.toUpperCase(), colEsq, rtY + 8, 12, { bold: true });
    texto(c, `${d.rt.formacao.toUpperCase()} - ${d.rt.conselhoSigla}: ${d.rt.conselhoNumero}`, colEsq, rtY - 4, 9);
    texto(c, `CÓDIGO DO CREDENCIADO - ${d.rt.codigoCredenciado}   TRT: ${d.trt}`, colEsq, rtY - 16, 9);
    // selos
    const seloW = (SB_W - 24) / 2;
    for (const [i, p] of d.proprietarios.slice(0, 2).entries()) {
      const sx = sbX + 8 + i * (seloW + 8);
      caixa(c, sx, yCursor - h + 4, seloW, 48, 0.8);
      texto(c, "SELO DE RECONHECIMENTO — CARTÓRIO", sx + seloW / 2, yCursor - h + 39, 7, { bold: true, center: true, cor: CINZA });
      texto(c, p.nome.toUpperCase(), sx + seloW / 2, yCursor - h + 26, 8.5, { center: true });
      texto(c, `CPF: ${p.cpf}`, sx + seloW / 2, yCursor - h + 13, 8.5, { center: true });
    }
    yCursor -= h;
  }

  // ---- RODAPÉ (escala/datum/folha) ----
  {
    const h = (sbTop - sbBot) * alturas.rodape;
    caixa(c, sbX, yCursor - h, SB_W, h);
    const cw = SB_W / 4;
    const itens: [string, string][] = [
      ["ESCALA", `1:${fmtMilhar(escala)}`],
      ["ÁREA", `${d.areaFmt} HA/ ${d.tarefasFmt} TAREFAS`],
      ["PERÍMETRO", `${d.perimetroFmt} m`],
      ["DESENHISTA", d.desenhista || "—"],
      ["COORDENADA", "UTM"],
      ["DATUM", `SIRGAS2000  M.C -${d.mcAbs}Wgr  Fuso: ${d.fuso}${letraFuso(d.latMediaDeg)}`],
      ["DATA", d.dataStr],
      ["FOLHA", "01 001 A1"],
    ];
    for (const [i, [rot, val]] of itens.entries()) {
      const col = i % 4, row = Math.floor(i / 4);
      const ix = sbX + col * cw + 6;
      const iy = yCursor - 20 - row * (h / 2 - 4);
      texto(c, rot, ix, iy, 8, { bold: true, cor: CINZA });
      texto(c, val, ix, iy - 14, val.length > 22 ? 8 : 11);
      if (col > 0) linha(c, sbX + col * cw, yCursor - h, sbX + col * cw, yCursor, 0.5);
    }
    linha(c, sbX, yCursor - h / 2, sbX + SB_W, yCursor - h / 2, 0.5);
  }

  // legenda no canto inferior esquerdo da área de desenho
  {
    const lx = dArea.x + 6, lyTop = dArea.y + 110;
    caixa(c, lx - 4, dArea.y + 2, 292, 114, 0.8);
    texto(c, "LEGENDAS / ABREVIATURAS", lx, lyTop - 8, 10, { bold: true });
    const itens: [ReturnType<typeof rgb>, string][] = [
      [VERMELHO, "ESTRADA"], [AZUL, "POLIGONAL DO TERRENO"], [VERDE, "DIVISÕES DAS CONFRONTAÇÕES"], [CINZA, "MALHA DE COORDENADA"],
    ];
    let lyy = lyTop - 26;
    for (const [cor, nome] of itens) {
      linha(c, lx, lyy + 3, lx + 34, lyy + 3, 2.5, cor);
      texto(c, nome, lx + 42, lyy, 9);
      lyy -= 17;
    }
    texto(c, "MATR. = MATRÍCULA", lx, lyy, 9);
  }

  return await pdf.save();
}
