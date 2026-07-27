// Geração da PLANTA (PDF) do imóvel georreferenciado, no padrão da planta
// final da empresa: malha de coordenadas UTM, polígono, estradas em linha
// dupla vermelha, divisões de confrontação em verde com rótulos e linhas de
// assinatura, carimbo com a logo, bloco planimétrico, RT e rodapé.
//   matrícula → folha A1 paisagem, COM quadro analítico e selos de cartório
//   posse     → folha A3 paisagem, SEM quadro analítico, assinatura do posseiro
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

export interface ProprietarioPlanta {
  nome: string;
  cpf: string;
  rg?: string | null;
  isEspolio?: boolean;
  inventarianteNome?: string | null;
  inventarianteCpf?: string | null;
  inventarianteRg?: string | null;
}

export interface DadosPlanta {
  vertices: VerticePlanta[];        // anel na ordem do perímetro
  trechos: TrechoPlanta[];
  denominacao: string;
  proprietarios: ProprietarioPlanta[];
  tipoImovel?: "matricula" | "posse";  // posse → A3 sem quadro analítico
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
  const th = 46;
  // título grande auto-ajustado à largura, sem caixinha em volta — só uma
  // linha separadora de largura total abaixo dele
  const tam = Math.min(30, (w - 28) / c.fb.widthOfTextAtSize(titulo, 1));
  texto(c, titulo, x + w / 2, y + h - th + 14, tam, { bold: true, center: true });
  linha(c, x, y + h - th, x + w, y + h - th, 1);
  return y + h - th; // topo útil
}

// texto que encolhe até caber em maxW — garante que nada estoura o campo
function textoFit(c: Ctx, t: string, x: number, y: number, size: number, maxW: number, opts: { bold?: boolean; cor?: ReturnType<typeof rgb>; center?: boolean } = {}) {
  const font = opts.bold ? c.fb : c.f;
  const tam = Math.min(size, maxW / font.widthOfTextAtSize(t, 1));
  texto(c, t, x, y, tam, opts);
}

// quebra linhas longas em várias, respeitando a largura máxima do bloco
function quebrarLinhas(linhas: string[], maxW: number, tam: number, font: PDFFont): string[] {
  const out: string[] = [];
  for (const l of linhas) {
    if (font.widthOfTextAtSize(l, tam) <= maxW) { out.push(l); continue; }
    let atual = "";
    for (const p of l.split(" ")) {
      const teste = atual ? `${atual} ${p}` : p;
      if (atual && font.widthOfTextAtSize(teste, tam) > maxW) { out.push(atual); atual = p; }
      else atual = teste;
    }
    if (atual) out.push(atual);
  }
  return out;
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
  const posse = d.tipoImovel === "posse";
  // A folha de posse é desenhada em A1 e reduzida à metade no fim (A3). Os
  // corpos pequenos do desenho são ampliados por K aqui para continuarem
  // legíveis depois dessa redução.
  const K = posse ? 1.7 : 1;
  const pdf = await PDFDocument.create();
  // a folha é sempre desenhada nas medidas A1; p/ posse o conteúdo é reduzido
  // à metade no final (setSize+scaleContent), virando um A3 proporcional
  const page = pdf.addPage([W, H]);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const c: Ctx = { page, f, fb };

  // molduras
  caixa(c, 14, 14, W - 28, H - 28, 2);
  caixa(c, 20, 20, W - 40, H - 40, 0.8);

  // ------------------- área de desenho e barra lateral -------------------
  const SB_W = 720;
  const sbX = W - 20 - SB_W;
  const dArea = { x: 60, y: 60, w: sbX - 100, h: H - 120 };

  // ------------------- escala e projeção papel -------------------
  const vs = d.vertices;
  const minE = Math.min(...vs.map((v) => v.e)), maxE = Math.max(...vs.map((v) => v.e));
  const minN = Math.min(...vs.map((v) => v.n)), maxN = Math.max(...vs.map((v) => v.n));
  // folga p/ os rótulos dos confrontantes — reduzida junto com o corpo deles,
  // o polígono passa a ocupar a área de desenho como na planta de referência
  const spanE = (maxE - minE) * 1.42 || 100;
  const spanN = (maxN - minN) * 1.26 || 100;
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
  const GRID_TAM = 11 * K; // discreto, como na planta de referência
  for (let e = e0; X(e) < dArea.x + dArea.w; e += passo) {
    linha(c, X(e), dArea.y, X(e), dArea.y + dArea.h, 0.4, CINZA, [2, 4]);
    const et = `E=${fmtMilhar(e)}`;
    const eLen = f.widthOfTextAtSize(et, GRID_TAM);
    texto(c, et, X(e) + 9, dArea.y + dArea.h - 14, GRID_TAM, { cor: CINZA, rot: -90 });
    texto(c, et, X(e) + 9, dArea.y + 12 + eLen, GRID_TAM, { cor: CINZA, rot: -90 });
  }
  for (let n = n0; Y(n) < dArea.y + dArea.h; n += passo) {
    linha(c, dArea.x, Y(n), dArea.x + dArea.w, Y(n), 0.4, CINZA, [2, 4]);
    const nt = `N=${fmtMilhar(n)}`;
    texto(c, nt, dArea.x + 6, Y(n) + 6, GRID_TAM, { cor: CINZA });
    texto(c, nt, dArea.x + dArea.w - f.widthOfTextAtSize(nt, GRID_TAM) - 6, Y(n) + 6, GRID_TAM, { cor: CINZA });
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
  // vértices + códigos. Em divisas com muitos pontos quase alinhados (a face
  // norte do MONOINO tem 13) os códigos em corpo grande viravam um borrão
  // ilegível: aqui o texto é pequeno e o rótulo que colidiria com outro já
  // desenhado é suprimido — nenhum dado se perde, o quadro analítico lista
  // TODOS os vértices.
  const VERT_TAM = 7.5 * K;
  const ocupado: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let rotulosOcultos = 0;
  for (let i = 0; i < nv; i++) {
    const v = vs[i];
    page.drawCircle({ x: X(v.e), y: Y(v.n), size: 1.4, color: PRETO });
    // normal apontando p/ fora do polígono
    let nx = X(v.e) - dcx, ny = Y(v.n) - dcy;
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    // tique do marco, como na planta de referência
    linha(c, X(v.e) + nx * 2, Y(v.n) + ny * 2, X(v.e) + nx * 6, Y(v.n) + ny * 6, 0.9);
    const w = f.widthOfTextAtSize(v.codigo, VERT_TAM);
    const lx = nx < 0 ? X(v.e) + nx * 8 - w : X(v.e) + nx * 8;
    const ly = Y(v.n) + ny * 8 - VERT_TAM / 2;
    const cx = { x1: lx - 1.5, y1: ly - 1.5, x2: lx + w + 1.5, y2: ly + VERT_TAM + 1.5 };
    if (ocupado.some((o) => !(cx.x2 < o.x1 || cx.x1 > o.x2 || cx.y2 < o.y1 || cx.y1 > o.y2))) {
      rotulosOcultos++;
      continue;
    }
    ocupado.push(cx);
    texto(c, v.codigo, lx, ly, VERT_TAM, { cor: PRETO });
  }

  // ------------------- divisões de confrontação + rótulos -------------------
  const centroLinhas = [
    posse ? "(POSSE)" : `(MATR.${d.matricula}/CNS.${d.cns})`,
    d.denominacao,
    ...d.proprietarios.flatMap((p) => {
      const res = [p.nome, `CPF:${p.cpf}`];
      if (posse && p.rg) res.push(`RG:${p.rg}`);
      if (p.isEspolio && p.inventarianteNome) {
        res.push(`REP. P/ INVENTARIANTE: ${p.inventarianteNome}`);
        if (p.inventarianteCpf) res.push(`CPF:${p.inventarianteCpf}`);
        if (p.inventarianteRg) res.push(`RG:${p.inventarianteRg}`);
      }
      return res;
    }),
    `ÁREA:${d.areaFmt} HA/ ${d.tarefasFmt} TAREFAS`,
  ].map((l) => l.toUpperCase());
  // bloco do imóvel no centroide — fonte proporcional ao polígono desenhado,
  // p/ o nome interno acompanhar o tamanho da propriedade sem vazar das bordas
  {
    const wPoly = (maxE - minE) / mPorPt, hPoly = (maxN - minN) / mPorPt;
    const larguraMax = Math.max(...centroLinhas.map((l) => fb.widthOfTextAtSize(l, 1)));
    const tamW = (wPoly * 0.70) / larguraMax;
    const tamH = (hPoly * 0.55) / (centroLinhas.length * 1.3);
    // teto pela área de desenho: o bloco nunca estoura as margens laterais,
    // e encolhe o quanto for preciso p/ ficar dentro do polígono
    const tamArea = (dArea.w * 0.92) / larguraMax;
    // teto de 18pt: o bloco identificava o imóvel em corpo maior que os títulos
    // do carimbo e desequilibrava a folha
    const tam = Math.max(7 * K, Math.min(18 * K, tamW, tamH, tamArea));
    const esp = tam * 1.35;
    // alinhado à esquerda (padrão da planta de referência), com o bloco inteiro
    // centralizado no centroide
    const bw = Math.max(...centroLinhas.map((l) => fb.widthOfTextAtSize(l, tam)));
    const bx0 = Math.max(dArea.x + 6, Math.min(dcx - bw / 2, dArea.x + dArea.w - bw - 6));
    let ty = dcy + (centroLinhas.length * esp) / 2;
    for (const [li, lt] of centroLinhas.entries()) {
      texto(c, lt, bx0, ty, tam, { bold: li === 1 });
      ty -= esp;
    }
  }
  // Trechos contíguos do MESMO confrontante viram um único rótulo: no caso real
  // a FAZENDA KAGADOS chegava em 5 trechos seguidos e o bloco de texto saía
  // repetido 5× em volta do polígono.
  const trechosOrd = [...d.trechos].sort((a, b) => a.inicioIdx - b.inicioIdx);
  const grupos: TrechoPlanta[] = [];
  for (const t of trechosOrd) {
    const ant = grupos[grupos.length - 1];
    if (ant && ant.descritivo === t.descritivo && ant.fimIdx % nv === t.inicioIdx % nv) ant.fimIdx = t.fimIdx;
    else grupos.push({ ...t });
  }
  // fechamento do anel: o último grupo pode continuar no primeiro
  if (grupos.length > 1) {
    const ult = grupos[grupos.length - 1], pri = grupos[0];
    if (ult.descritivo === pri.descritivo && ult.fimIdx % nv === pri.inicioIdx % nv) {
      pri.inicioIdx = ult.inicioIdx;
      grupos.pop();
    }
  }
  const LBL_TAM = 13 * K, LBL_ESP = 16 * K, LBL_MAXW = 310 * K;
  for (const t of grupos) {
    // ponto médio GEOMÉTRICO do trecho: metade do comprimento da linha do
    // confrontante — o rótulo fica centralizado no "raio" da confrontação
    const idxs: number[] = [];
    for (let i = t.inicioIdx % nv; i !== t.fimIdx % nv; i = (i + 1) % nv) {
      idxs.push(i);
      if (idxs.length >= nv) break;
    }
    if (idxs.length === 0) for (let i = 0; i < nv; i++) idxs.push((t.inicioIdx + i) % nv);
    if (idxs.length === 0 || nv === 0 || !vs[idxs[0] % nv]) continue;
    const segLens = idxs.map((i) => {
      const a = vs[i], b = vs[(i + 1) % nv];
      if (!a || !b) return 0;
      return Math.hypot(X(b.e) - X(a.e), Y(b.n) - Y(a.n));
    });
    let alvo = segLens.reduce((s, l) => s + l, 0) / 2;
    let mx = X(vs[idxs[0] % nv].e), my = Y(vs[idxs[0] % nv].n), angSeg = 0;
    for (const [k, i] of idxs.entries()) {
      if (alvo <= segLens[k] || k === idxs.length - 1) {
        const a = vs[i], b = vs[(i + 1) % nv];
        if (a && b) {
          const fr = segLens[k] > 0 ? alvo / segLens[k] : 0;
          mx = X(a.e) + (X(b.e) - X(a.e)) * fr;
          my = Y(a.n) + (Y(b.n) - Y(a.n)) * fr;
          angSeg = Math.atan2(Y(b.n) - Y(a.n), X(b.e) - X(a.e)) * 180 / Math.PI;
        }
        break;
      }
      alvo -= segLens[k];
    }
    let nx = mx - dcx, ny = my - dcy;
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;

    if (t.isEstrada) {
      // nome da via rotacionado ao longo do segmento do ponto médio
      const nome = linhasDescritivo(t.descritivo)[0] ?? "";
      texto(c, nome, mx + nx * 22, my + ny * 22, 13 * K, { bold: true, cor: PRETO, rot: angSeg > 90 || angSeg < -90 ? angSeg + 180 : angSeg });
      continue;
    }
    // linha verde de divisão no INÍCIO do trecho
    const vi = vs[t.inicioIdx % nv];
    if (!vi) continue;
    let gx = X(vi.e) - dcx, gy = Y(vi.n) - dcy;
    const gl = Math.hypot(gx, gy) || 1; gx /= gl; gy /= gl;
    linha(c, X(vi.e), Y(vi.n), X(vi.e) + gx * 50, Y(vi.n) + gy * 50, 1.4, VERDE);
    // Rótulo do confrontante: bloco de texto corrido alinhado à esquerda, como
    // na planta de referência. A versão anterior desenhava uma linha de
    // assinatura de 340pt com nome e CPF em corpo 21 — duplicava as cartas de
    // anuência e dominava o desenho.
    const lbl = quebrarLinhas(linhasDescritivo(t.descritivo), LBL_MAXW, LBL_TAM, f);
    const blockW = Math.max(...lbl.map((l) => f.widthOfTextAtSize(l, LBL_TAM)));
    const altura = lbl.length * LBL_ESP;
    // Ancoragem pela BORDA do bloco (não pelo centro): à direita do perímetro o
    // texto começa depois do traço, à esquerda termina antes dele. Centrar o
    // bloco no ponto deslocado fazia rótulos largos voltarem por cima do
    // polígono.
    const MG = 30;
    let lx = Math.abs(nx) < 0.3 ? mx - blockW / 2 : nx > 0 ? mx + MG : mx - MG - blockW;
    let ty = Math.abs(ny) < 0.3 ? my + altura / 2 : ny > 0 ? my + MG + altura : my - MG;
    // e o bloco inteiro fica dentro da área de desenho — antes os rótulos
    // laterais vazavam para fora da folha
    lx = Math.max(dArea.x + 4, Math.min(lx, dArea.x + dArea.w - blockW - 4));
    ty = Math.max(dArea.y + altura, Math.min(ty, dArea.y + dArea.h - LBL_TAM));
    for (const [li, lt] of lbl.entries()) texto(c, lt, lx, ty - li * LBL_ESP, LBL_TAM);
    ocupado.push({ x1: lx, y1: ty - altura, x2: lx + blockW, y2: ty + LBL_TAM });
  }

  // ------------------- bússola (rosa dos ventos moderna) -------------------
  // estrela de 8 pontas: pontas cardeais com metades preto/branco (efeito 3D),
  // pontas diagonais menores em cinza, dois anéis com marcações a cada 45°
  {
    // afastada do canto p/ não cobrir os rótulos N=/E= da malha (que ocupam
    // as bordas), e maior p/ acompanhar a nova escala dos textos
    const R = 58 * K;
    // canto livre: preferência pelo superior esquerdo (padrão da planta de
    // referência), caindo p/ outro canto se lá já houver polígono ou rótulo —
    // o inferior esquerdo é reservado à legenda
    const margem = R + 22;
    const cantos: [number, number][] = [
      [dArea.x + margem, dArea.y + dArea.h - margem],
      [dArea.x + dArea.w - margem, dArea.y + dArea.h - margem],
      [dArea.x + dArea.w - margem, dArea.y + margem],
    ];
    const livre = ([qx, qy]: [number, number]) => {
      const cx0 = { x1: qx - R - 8, y1: qy - R - 8, x2: qx + R + 8, y2: qy + R + 18 };
      if (ocupado.some((o) => !(cx0.x2 < o.x1 || cx0.x1 > o.x2 || cx0.y2 < o.y1 || cx0.y1 > o.y2))) return false;
      return !vs.some((v) => X(v.e) > cx0.x1 && X(v.e) < cx0.x2 && Y(v.n) > cx0.y1 && Y(v.n) < cx0.y2);
    };
    const [bx, by] = cantos.find(livre) ?? cantos[0];
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
      const path = `M ${p(pol(a, 38))} L ${p(pol(a + 45, 12))} L 0 0 L ${p(pol(a - 45, 12))} Z`;
      page.drawSvgPath(path, { x: bx, y: by, color: CINZA, borderColor: PRETO, borderWidth: 0.4 });
    }
    // pontas cardeais (metade escura + metade clara)
    for (const a of [0, 90, 180, 270]) {
      const tip = pol(a, R - 9), sd = pol(a + 45, 15), se = pol(a - 45, 15);
      page.drawSvgPath(`M ${p(tip)} L ${p(sd)} L 0 0 Z`, { x: bx, y: by, color: PRETO });
      page.drawSvgPath(`M ${p(tip)} L ${p(se)} L 0 0 Z`, { x: bx, y: by, color: rgb(1, 1, 1), borderColor: PRETO, borderWidth: 0.6 });
    }
    // miolo e letra N
    page.drawCircle({ x: bx, y: by, size: 4.5, borderWidth: 1.2, borderColor: PRETO, color: rgb(1, 1, 1) });
    texto(c, "N", bx, by + R + 10, 22 * K, { bold: true, center: true });
  }

  // ============================ BARRA LATERAL ============================
  const sbTop = H - 20, sbBot = 20;
  // posse não leva quadro analítico — as demais seções ganham o espaço dele
  const alturas = posse
    ? { quadro: 0, situacao: 0.30, carimbo: 0.12, planimetrico: 0.42, rodape: 0.16 }
    : { quadro: 0.38, situacao: 0.12, carimbo: 0.08, planimetrico: 0.31, rodape: 0.11 };
  let yCursor = sbTop;

  // ---- QUADRO ANALÍTICO (tabela com grade, colunas centradas) ----
  if (!posse) {
    const h = (sbTop - sbBot) * alturas.quadro;
    const topoUtil = caixaTitulo(c, sbX, yCursor - h, SB_W, h, "QUADRO ANALÍTICO");
    const heads = ["VÉRTICE", "LADO", "LONGITUDE", "LATITUDE", "AZIMUTE", "DIST.(m)", "ALTIT."];
    const cols = [90, 190, 105, 105, 85, 75, 60];
    const tw = cols.reduce((a, b) => a + b, 0);
    const tx0 = sbX + (SB_W - tw) / 2;
    const headH = 22;
    const tableTop = topoUtil - 6;
    // Altura de linha adaptativa: a planta tem de trazer TODOS os vértices.
    // Antes a tabela era cortada em 15 linhas e remetia ao memorial tabular
    // ("… +40 vértices"), o que deixava a peça incompleta.
    const disp = tableTop - headH - (yCursor - h) - 12;
    const rowH = Math.max(6.5, Math.min(20, disp / Math.max(1, vs.length)));
    const tamCel = Math.max(5, Math.min(11, rowH - 2.5));
    const maxLinhas = Math.max(1, Math.floor(disp / rowH));
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
      texto(c, hh, hx + cols[i] / 2, tableTop - headH + 7, 10, { bold: true, center: true });
      hx += cols[i];
    }
    // valores centrados por coluna (encolhem se não couberem na coluna)
    for (const [r, v] of linhasQ.entries()) {
      const vals = [v.codigo, `${v.codigo}-${v.vante}`, v.lonFmt, v.latFmt, v.azFmt, v.distFmt, v.alt];
      const ty = tableTop - headH - (r + 1) * rowH + (rowH - tamCel) / 2 + 1;
      let cx2 = tx0;
      for (const [i, val] of vals.entries()) { textoFit(c, val, cx2 + cols[i] / 2, ty, tamCel, cols[i] - 6, { center: true }); cx2 += cols[i]; }
    }
    if (vs.length > linhasQ.length) {
      texto(c, `… +${vs.length - linhasQ.length} vértices (ver memorial tabular)`, tx0, tableBot - 12, 10, { cor: CINZA });
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
      texto(c, "(envie a imagem de satélite ao gerar a planta)", sbX + SB_W / 2, yCursor - h / 2, 20, { cor: CINZA, center: true });
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
      texto(c, "(envie a logo em Configurações)", sbX + SB_W / 2, yCursor - h / 2, 20, { cor: CINZA, center: true });
    }
    yCursor -= h;
  }

  // ---- PLANIMÉTRICO ----
  {
    const h = (sbTop - sbBot) * alturas.planimetrico;
    const topoUtil = caixaTitulo(c, sbX, yCursor - h, SB_W, h, "PLANIMÉTRICO DO IMÓVEL GEORREFERENCIADO");
    const colEsq = sbX + 14, colDir = sbX + SB_W / 2 + 12;
    const colW = SB_W / 2 - 26;
    let py = topoUtil - 32;
    // rótulo pequeno em cinza + valor grande logo abaixo, encolhendo se preciso
    const campo = (rot: string, val: string, x: number, y: number) => {
      texto(c, rot, x, y, 13, { bold: true, cor: CINZA });
      textoFit(c, val, x, y - 22, 21, colW);
    };
    campo("Denominação:", d.denominacao.toUpperCase(), colEsq, py);
    // coluna direita: TRT + campos do imóvel (na posse não há matrícula nem
    // cartório: o campo indica POSSE e o CNS sai)
    const camposDir: [string, string][] = posse
      ? [["TRT:", d.trt], ["Matrícula do Imóvel:", "POSSE"], ["Código INCRA:", d.sncr], ["Município/UF:", d.municipioUf.toUpperCase()]]
      : [["TRT:", d.trt], ["Matrícula do Imóvel:", d.matricula], ["Código do Cartório (CNS):", d.cns], ["Código INCRA:", d.sncr], ["Município/UF:", d.municipioUf.toUpperCase()]];
    for (const [i, [rot, val]] of camposDir.entries()) campo(rot, val, colDir, py - i * 50);
    py -= 50;
    texto(c, posse ? "Posseiro(s):" : "Proprietário(s):", colEsq, py, 13, { bold: true, cor: CINZA });
    let ppy = py - 24;
    for (const p of d.proprietarios) {
      textoFit(c, p.nome.toUpperCase(), colEsq, ppy, 19, colW, { bold: true });
      textoFit(c, `CPF: ${p.cpf}`, colEsq, ppy - 20, 16, colW);
      ppy -= 46;
      if (p.isEspolio && p.inventarianteNome) {
        textoFit(c, `REP. P/ INV.: ${p.inventarianteNome.toUpperCase()}`, colEsq, ppy, 17, colW, { bold: true });
        textoFit(c, `CPF: ${p.inventarianteCpf ?? ""}`, colEsq, ppy - 20, 16, colW);
        ppy -= 48;
      }
    }
    // faixa inferior em duas colunas: RESPONSÁVEL TÉCNICO à esquerda e o(s)
    // quadro(s) de assinatura encaixado(s) na metade direita, lado a lado
    const bandH = 192;
    const bandTop = yCursor - h + bandH;
    linha(c, sbX, bandTop, sbX + SB_W, bandTop, 0.8);
    linha(c, sbX + SB_W / 2, yCursor - h, sbX + SB_W / 2, bandTop, 0.8);
    const rtW = SB_W / 2 - 28;
    texto(c, "RESPONSÁVEL TÉCNICO", colEsq, bandTop - 28, 15, { bold: true, cor: CINZA });
    textoFit(c, d.rt.nome.toUpperCase(), colEsq, bandTop - 58, 26, rtW, { bold: true });
    textoFit(c, `${d.rt.formacao.toUpperCase()} - ${d.rt.conselhoSigla}: ${d.rt.conselhoNumero}`, colEsq, bandTop - 84, 16, rtW);
    textoFit(c, `CÓDIGO DO CREDENCIADO - ${d.rt.codigoCredenciado}`, colEsq, bandTop - 108, 16, rtW);
    textoFit(c, `TRT: ${d.trt}`, colEsq, bandTop - 132, 16, rtW);
    // quadros de assinatura: cartório (matrícula) ou posseiro (posse),
    // empilhados e centralizados verticalmente na metade direita da faixa
    const assinantes = d.proprietarios.slice(0, 2);
    const seloX = sbX + SB_W / 2 + 12;
    const seloW = SB_W / 2 - 24;
    const seloH = assinantes.some((p) => p.isEspolio && p.inventarianteNome) ? 120 : (assinantes.length > 1 ? 88 : 108);
    const gap = Math.max(8, (bandH - assinantes.length * seloH) / (assinantes.length + 1));
    for (const [i, p] of assinantes.entries()) {
      const syBot = bandTop - (i + 1) * (gap + seloH);
      caixa(c, seloX, syBot, seloW, seloH, 0.8);
      const cx = seloX + seloW / 2;
      if (posse) {
        texto(c, "POSSEIRO", cx, syBot + seloH - 18, 14, { bold: true, center: true, cor: CINZA });
        linha(c, seloX + 20, syBot + seloH - 42, seloX + seloW - 20, syBot + seloH - 42, 1);
        if (p.isEspolio && p.inventarianteNome) {
          textoFit(c, p.nome.toUpperCase(), cx, syBot + seloH - 58, 15, seloW - 16, { center: true, bold: true });
          textoFit(c, `CPF: ${p.cpf}`, cx, syBot + seloH - 72, 14, seloW - 16, { center: true });
          textoFit(c, `REP. P/ INVENTARIANTE: ${p.inventarianteNome.toUpperCase()}`, cx, syBot + seloH - 88, 14, seloW - 16, { center: true, bold: true });
          textoFit(c, `CPF: ${p.inventarianteCpf ?? ""}`, cx, syBot + seloH - 104, 14, seloW - 16, { center: true });
        } else {
          textoFit(c, p.nome.toUpperCase(), cx, syBot + seloH - 65, 18, seloW - 16, { center: true });
          textoFit(c, `CPF: ${p.cpf}`, cx, syBot + seloH - 88, 16, seloW - 16, { center: true });
        }
      } else {
        textoFit(c, "SELO DE RECONHECIMENTO — CARTÓRIO", cx, syBot + seloH - 20, 14, seloW - 16, { bold: true, center: true, cor: CINZA });
        if (p.isEspolio && p.inventarianteNome) {
          textoFit(c, p.nome.toUpperCase(), cx, syBot + seloH - 42, 15, seloW - 16, { center: true, bold: true });
          textoFit(c, `CPF: ${p.cpf}`, cx, syBot + seloH - 56, 14, seloW - 16, { center: true });
          textoFit(c, `REP. P/ INVENTARIANTE: ${p.inventarianteNome.toUpperCase()}`, cx, syBot + seloH - 76, 14, seloW - 16, { center: true, bold: true });
          textoFit(c, `CPF: ${p.inventarianteCpf ?? ""}`, cx, syBot + seloH - 92, 14, seloW - 16, { center: true });
        } else {
          textoFit(c, p.nome.toUpperCase(), cx, syBot + seloH - 50, 18, seloW - 16, { center: true });
          textoFit(c, `CPF: ${p.cpf}`, cx, syBot + seloH - 74, 16, seloW - 16, { center: true });
        }
      }
    }
    yCursor -= h;
  }

  // ---- RODAPÉ (escala/datum/folha) ----
  {
    const h = (sbTop - sbBot) * alturas.rodape;
    caixa(c, sbX, yCursor - h, SB_W, h);
    const cw = SB_W / 4;
    // valores longos quebram em 2 linhas dentro da célula em vez de encolher
    const itens: [string, string[]][] = [
      ["ESCALA", [`1:${fmtMilhar(escala)}`]],
      ["ÁREA", [`${d.areaFmt} HA`, `${d.tarefasFmt} TAREFAS`]],
      ["PERÍMETRO", [`${d.perimetroFmt} m`]],
      ["DESENHISTA", [d.desenhista || "—"]],
      ["COORDENADA", ["UTM"]],
      ["DATUM", ["SIRGAS2000", `M.C -${d.mcAbs}Wgr Fuso: ${d.fuso}${letraFuso(d.latMediaDeg)}`]],
      ["DATA", [d.dataStr]],
      ["FOLHA", [posse ? "01 001 A3" : "01 001 A1"]],
    ];
    for (const [i, [rot, vals]] of itens.entries()) {
      const col = i % 4, row = Math.floor(i / 4);
      const ix = sbX + col * cw + 8;
      const iy = yCursor - 26 - row * (h / 2);
      texto(c, rot, ix, iy, 15, { bold: true, cor: CINZA });
      for (const [k, val] of vals.entries()) textoFit(c, val, ix, iy - 26 - k * 22, 20, cw - 16);
      if (col > 0) linha(c, sbX + col * cw, yCursor - h, sbX + col * cw, yCursor, 0.5);
    }
    linha(c, sbX, yCursor - h / 2, sbX + SB_W, yCursor - h / 2, 0.5);
  }

  // legenda no canto inferior esquerdo da área de desenho — caixa compacta
  // (a anterior tinha 640×258pt e comia um quarto do desenho)
  {
    const lx = dArea.x + 12, boxW = 300 * K, boxH = 124 * K;
    // fundo branco opaco: a legenda cobre a malha e os rótulos que passam atrás
    page.drawRectangle({ x: lx - 6, y: dArea.y + 2, width: boxW, height: boxH, color: rgb(1, 1, 1), borderColor: PRETO, borderWidth: 0.8 });
    const lyTop = dArea.y + 2 + boxH;
    texto(c, "LEGENDAS / ABREVIATURAS", lx, lyTop - 17 * K, 11 * K, { bold: true });
    const itens: [ReturnType<typeof rgb>, string][] = [
      [VERMELHO, "ESTRADA"], [AZUL, "POLIGONAL DO TERRENO"], [VERDE, "DIVISÕES DAS CONFRONTAÇÕES"], [CINZA, "MALHA DE COORDENADA"],
    ];
    let lyy = lyTop - 38 * K;
    for (const [cor, nome] of itens) {
      linha(c, lx, lyy + 3, lx + 38 * K, lyy + 3, 2.6, cor);
      texto(c, nome, lx + 46 * K, lyy, 9.5 * K);
      lyy -= 20 * K;
    }
    texto(c, posse ? "POSSE = IMÓVEL SEM MATRÍCULA" : "MATR. = MATRÍCULA", lx, lyy, 9.5 * K);
  }

  // posse: reduz o conteúdo e entrega a folha no A3 exato (420×297 mm) —
  // meia-A1 seria 420,5 mm, então o eixo X escala por 420/841 (~0,4994)
  if (posse) {
    const w3 = 420 * MM, h3 = 297 * MM;
    page.scaleContent(w3 / W, h3 / H);
    page.setSize(w3, h3);
  }

  return await pdf.save();
}
