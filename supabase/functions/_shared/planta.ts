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

// ---------------------------------------------------------------------------
// geometria do polígono — usada p/ encaixar o bloco de identificação DENTRO
// da área do imóvel, sem tocar nas divisas
// ---------------------------------------------------------------------------
interface Pt { x: number; y: number }

function pontoDentro(p: Pt, poly: Pt[]): boolean {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}

function cruzam(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
}

function distSeg(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x, vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

// retângulo INTEIRAMENTE contido no polígono (cantos dentro e nenhuma divisa
// cruzando os lados) — testar só o retângulo envolvente do polígono não basta
// em imóveis irregulares, que é onde o texto vazava por cima da divisa
function retanguloDentro(x: number, y: number, w: number, h: number, poly: Pt[]): boolean {
  const cantos: Pt[] = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
  if (!cantos.every((q) => pontoDentro(q, poly))) return false;
  for (let i = 0; i < cantos.length; i++) {
    const a = cantos[i], b = cantos[(i + 1) % cantos.length];
    for (let j = 0, k = poly.length - 1; j < poly.length; k = j++) {
      if (cruzam(a, b, poly[j], poly[k])) return false;
    }
  }
  return true;
}

// ponto interior mais afastado das divisas (polo de inacessibilidade aproximado
// por varredura) — melhor âncora para o bloco que o centroide, que em imóveis
// côncavos pode cair fora ou colado numa borda
function poloInterior(poly: Pt[], passos = 48): Pt {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let melhor: Pt = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, melhorD = -1;
  for (let i = 0; i <= passos; i++) {
    for (let j = 0; j <= passos; j++) {
      const p = { x: x0 + ((x1 - x0) * i) / passos, y: y0 + ((y1 - y0) * j) / passos };
      if (!pontoDentro(p, poly)) continue;
      let dmin = Infinity;
      for (let k = 0, l = poly.length - 1; k < poly.length; l = k++) dmin = Math.min(dmin, distSeg(p, poly[k], poly[l]));
      if (dmin > melhorD) { melhorD = dmin; melhor = p; }
    }
  }
  return melhor;
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

// ---------------------------------------------------------------------------
// Colisão de rótulos. Os códigos de vértice já se evitavam entre si (retângulo
// contra retângulo), mas nada impedia um bloco de confrontante ou o nome de uma
// via de cair EM CIMA das linhas do terreno. Aqui entra o teste que faltava:
// retângulo contra segmento.
// ---------------------------------------------------------------------------
export interface Ret { x1: number; y1: number; x2: number; y2: number }
export type Seg = Ret;

/** Diagnóstico opcional do desenho, para os testes conferirem sobreposição. */
export interface DiagPlanta {
  /** linhas que nenhum rótulo pode cobrir: polígono e linhas duplas das vias */
  obstaculos: Seg[];
  /** caixas dos rótulos de confrontante e de via efetivamente desenhados */
  rotulos: Ret[];
  /** quantos desses rótulos ficaram por cima de alguma linha (deve ser 0) */
  sobrepostos: number;
  /** quantos não couberam centrados no trecho e tiveram de deslizar pela divisa */
  deslocados: number;
  /** traços verdes de divisão — tem de sair um por vértice M, via ou não */
  marcos?: Seg[];
  /** as linhas duplas vermelhas, para conferir que caem FORA da poligonal */
  vias?: Seg[];
  /** corpo em que cada rótulo de trecho acabou saindo, na ordem de `rotulos` */
  corpos?: number[];
  /** folga mínima exigida entre rótulo de trecho e traço do desenho */
  folga?: number;
  /** o anel como foi desenhado, em pontos da folha */
  poligono?: Pt[];
}

function retCruzaRet(a: Ret, b: Ret): boolean {
  return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
}

function segCruzaSeg(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const d1 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d2 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  const d3 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d4 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segCruzaRet(s: Seg, r: Ret): boolean {
  const dentro = (x: number, y: number) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
  if (dentro(s.x1, s.y1) || dentro(s.x2, s.y2)) return true;
  const cantos: [number, number][] = [[r.x1, r.y1], [r.x2, r.y1], [r.x2, r.y2], [r.x1, r.y2]];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = cantos[i], [bx, by] = cantos[(i + 1) % 4];
    if (segCruzaSeg(s.x1, s.y1, s.x2, s.y2, ax, ay, bx, by)) return true;
  }
  return false;
}

/**
 * Caixa REAL de um texto rotacionado, e a colisão exata contra ela.
 *
 * A caixa envolvente (`retTextoRot`) serve para reservar espaço, mas não para
 * decidir sobreposição: num nome de via a ~50°, a envolvente é quase um quadrado
 * que a própria divisa atravessa por dentro, faça o rótulo o que fizer. Enquanto
 * o rótulo fugia do obstáculo isso só o empurrava para longe; depois que a
 * posição virou regra e o corpo passou a ser quem cede, o falso positivo passou a
 * encolher o nome da estrada até o piso — 12,8pt onde cabiam 22. Aqui o segmento
 * é levado para o referencial do texto e testado contra o retângulo de verdade.
 */
interface Obb { x: number; y: number; w: number; h: number; ang: number }

function segCruzaObb(s: Seg, o: Obb, folga = 0): boolean {
  const a = -o.ang * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const loc = (px: number, py: number) => {
    const dx = px - o.x, dy = py - o.y;
    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
  };
  const p1 = loc(s.x1, s.y1), p2 = loc(s.x2, s.y2);
  return segCruzaRet(
    { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y },
    { x1: -folga, y1: -folga, x2: o.w + folga, y2: o.h + folga },
  );
}

/**
 * A caixa com a FOLGA PADRÃO em volta.
 *
 * Não basta escolher uma distância inicial confortável: quem decide é o teste de
 * colisão, e ele só reprovava o candidato cuja caixa a linha CRUZA. Um rótulo
 * podia então parar a um ponto da divisa e passar como limpo — encostado, que é
 * o que não pode acontecer em hipótese nenhuma. Inflando a caixa, "não cruzar"
 * passa a significar "não chegar perto", e a folga vale para todos os candidatos
 * de todos os rótulos, inclusive o do último recurso.
 */
function inflar(r: Ret, folga: number): Ret {
  return { x1: r.x1 - folga, y1: r.y1 - folga, x2: r.x2 + folga, y2: r.y2 + folga };
}

// caixa envolvente de um texto rotacionado (pdf-lib gira em torno da origem do texto)
function retTextoRot(x: number, y: number, w: number, h: number, angDeg: number): Ret {
  const a = angDeg * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const xs: number[] = [], ys: number[] = [];
  for (const [dx, dy] of [[0, 0], [w, 0], [w, h], [0, h]] as [number, number][]) {
    xs.push(x + dx * cos - dy * sin);
    ys.push(y + dx * sin + dy * cos);
  }
  return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/**
 * Entre os candidatos LIVRES, o de menor custo — não o primeiro da lista.
 *
 * A busca por ordem fixa ("esgote afastamento, depois quebra, depois corpo, e só
 * então deslize") garante que o rótulo fique no vão do vizinho, mas paga caro por
 * isso: prefere QUALQUER distância a QUALQUER deslize, então os blocos saíam
 * boiando a 150pt da divisa, cada um a uma distância diferente. O custo deixa as
 * quatro saídas competirem: afastar pouco e encolher um passo passa a ganhar de
 * afastar muito, e o deslize continua caro o bastante para nunca vencer enquanto
 * houver qualquer posição centrada livre (peso 20 > o pior caso centrado, 15,6).
 */
function melhorLivre<T extends { ret: Ret; obb?: Obb; custo: number }>(
  candidatos: T[], obstaculos: Seg[], ocupado: Ret[], folga = 0,
): T | null {
  let melhor: T | null = null;
  for (const cand of candidatos) {
    if (melhor && cand.custo >= melhor.custo) continue;
    if (obstaculos.some((s) => (cand.obb ? segCruzaObb(s, cand.obb, folga) : segCruzaRet(s, inflar(cand.ret, folga))))) continue;
    if (ocupado.some((o) => retCruzaRet(inflar(cand.ret, folga), o))) continue;
    melhor = cand;
  }
  return melhor;
}

/**
 * Quando NENHUM candidato está livre, o menos ruim — o que cruza menos coisa.
 *
 * O recurso anterior era pegar o último da lista, que é o extremo da busca: o
 * corpo mais reduzido, no afastamento máximo, deslizado o quanto a busca permite.
 * Não havia razão para ele ser melhor que os outros, e no anel estreito da LAGOA
 * SECA era pior — o rótulo saía pequeno, longe da divisa e ainda por cima da
 * linha. Empate fica com o primeiro, que é o mais próximo do centro do trecho.
 */
function menosPior<T extends { ret: Ret; obb?: Obb }>(
  candidatos: T[], obstaculos: Seg[], ocupado: Ret[], folga = 0,
): T {
  let melhor = candidatos[0], melhorN = Infinity;
  for (const cand of candidatos) {
    const n = obstaculos.filter((s) => (cand.obb ? segCruzaObb(s, cand.obb, folga) : segCruzaRet(s, inflar(cand.ret, folga)))).length
      + ocupado.filter((o) => retCruzaRet(inflar(cand.ret, folga), o)).length;
    if (n < melhorN) { melhor = cand; melhorN = n; if (n === 0) break; }
  }
  return melhor;
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
export async function gerarPlantaPdf(d: DadosPlanta, diag?: DiagPlanta): Promise<Uint8Array> {
  const posse = d.tipoImovel === "posse";
  // A folha de posse É a folha de matrícula, só que menor: MESMAS regras, MESMO
  // desenho, MESMAS medidas em pontos — muda a proporção no fim e nada mais.
  //
  // Antes os corpos pequenos do desenho eram ampliados por K = 1,7 na posse, para
  // ganhar legibilidade depois da redução. Isso funcionava enquanto as distâncias
  // de rótulo eram números fixos de pontos, mas as regras novas dos nomes de
  // vizinho são PROPORCIONAIS ao desenho (fração da diagonal do polígono) e só os
  // pisos acompanhavam K. Resultado: na A3 os pisos venciam a proporção, o bloco
  // de texto quebrava em outra largura, a caixa da legenda reservava 510×211pt no
  // lugar de 300×124 e o arranjo saía diferente do da A1 — a mesma planta com
  // dois layouts. A regra agora é uma só; a legibilidade vem da redução única do
  // fim, como em qualquer prancha reduzida.
  const pdf = await PDFDocument.create();
  // a folha é sempre desenhada nas medidas A1; p/ posse o conteúdo é reduzido
  // proporcionalmente no final (scaleContent+setSize), virando um A3
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
  const GRID_TAM = 11; // discreto, como na planta de referência
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
  // Linhas do desenho que nenhum rótulo pode cobrir: as duplas vermelhas das vias
  // e o próprio polígono. Preenchidas conforme são desenhadas, logo abaixo.
  const obstaculos: Seg[] = [];
  // caixas dos rótulos de trecho (confrontante e via) para o diagnóstico
  const rotulosTrecho: Ret[] = [];
  const corposTrecho: number[] = [];
  // caixa REAL dos rótulos girados, para o diagnóstico medir sobreposição com o
  // mesmo critério da busca — pela envolvente, todo nome de via em diagonal
  // aparecia como sobreposto sem estar
  const obbsTrecho: (Obb | undefined)[] = [];
  // quantos não couberam centrados e tiveram de deslizar pela divisa
  let deslocados = 0;
  const nv = vs.length;

  // ------------------- de que lado fica o "fora" -------------------
  // Quem decide é o SENTIDO DO ANEL, não a distância ao centro da folha.
  //
  // O critério anterior era "o lado mais longe de (dcx, dcy)", que é o centro da
  // ÁREA DE DESENHO — nem o centroide do imóvel. Num polígono convexo dá no
  // mesmo; em côncavo, não: no braço estreito a noroeste da LAGOA SECA o centro
  // da folha cai do lado de fora do braço, e a linha dupla da estrada era jogada
  // para DENTRO da poligonal. Com o sentido do anel o lado é o mesmo para todas
  // as arestas, côncavo ou não.
  //
  // Convenção: em coordenadas de tela (Y para cima), área assinada > 0 = anti-
  // horário, e a normal externa da aresta a→b é (dy, -dx)/len.
  let giro = 0;
  for (let i = 0; i < nv; i++) {
    const a = vs[i], b = vs[(i + 1) % nv];
    giro += X(a.e) * Y(b.n) - X(b.e) * Y(a.n);
  }
  const sentido = giro >= 0 ? 1 : -1;
  /** normal externa unitária da aresta i → i+1 */
  const normalAresta = (i: number): Pt => {
    const a = vs[i], b = vs[(i + 1) % nv];
    const dx = X(b.e) - X(a.e), dy = Y(b.n) - Y(a.n);
    const len = Math.hypot(dx, dy) || 1;
    return { x: sentido * dy / len, y: -sentido * dx / len };
  };
  /** normal externa unitária NO vértice i: bissetriz das duas arestas que o tocam */
  const normalVertice = (i: number): Pt => {
    const p = normalAresta((i - 1 + nv) % nv), q = normalAresta(i);
    const x = p.x + q.x, y = p.y + q.y;
    const l = Math.hypot(x, y);
    // arestas antiparalelas (bico degenerado): fica com a normal da que sai
    return l < 1e-6 ? q : { x: x / l, y: y / l };
  };

  const vias: Seg[] = [];

  // Unidade PROPORCIONAL ao desenho. Todo afastamento de rótulo é medido nela, e
  // não em pontos fixos: assim a mesma regra vale para um imóvel de 6 ha e um de
  // 600, e os rótulos de uma planta ficam todos à mesma distância da divisa. Era
  // a falta disso que deixava cada nome a uma distância diferente.
  const bbX = vs.map((v) => X(v.e)), bbY = vs.map((v) => Y(v.n));
  const diagPoly = Math.hypot(
    Math.max(...bbX) - Math.min(...bbX),
    Math.max(...bbY) - Math.min(...bbY),
  ) || 100;

  // FOLGA PADRÃO entre qualquer rótulo de trecho e qualquer traço do desenho.
  // Proporcional como o resto, e com piso em pontos para não sumir em imóvel
  // pequeno. Vale para TODOS os candidatos, inclusive o de último recurso: um
  // nome não pode encostar na linha em hipótese nenhuma. Vale igual na A1 e na
  // A3: o piso é medido no desenho, que é o mesmo nas duas — a A3 só é reduzida
  // depois de pronta, e a redução leva a folga junto, na mesma proporção.
  const FOLGA = Math.max(9, 0.011 * diagPoly);

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
    // a linha dupla é SEMPRE por fora: a normal vem do sentido do anel
    const { x: nx, y: ny } = normalAresta(i);
    for (const off of [5, 11]) {
      const seg = { x1: X(a.e) + nx * off, y1: Y(a.n) + ny * off, x2: X(b.e) + nx * off, y2: Y(b.n) + ny * off };
      linha(c, seg.x1, seg.y1, seg.x2, seg.y2, 2.8, VERMELHO);
      obstaculos.push(seg);
      vias.push(seg);
    }
  }

  // ------------------- polígono -------------------
  for (let i = 0; i < nv; i++) {
    const a = vs[i], b = vs[(i + 1) % nv];
    linha(c, X(a.e), Y(a.n), X(b.e), Y(b.n), 3.4, AZUL);
    obstaculos.push({ x1: X(a.e), y1: Y(a.n), x2: X(b.e), y2: Y(b.n) });
  }
  // vértices + códigos. Em divisas com muitos pontos quase alinhados (a face
  // norte do MONOINO tem 13) os códigos em corpo grande viravam um borrão
  // ilegível: aqui o texto é pequeno e o rótulo que colidiria com outro já
  // desenhado é suprimido — nenhum dado se perde, o quadro analítico lista
  // TODOS os vértices.
  const VERT_TAM = 7.5;
  const ocupado: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let rotulosOcultos = 0;
  // A legenda é desenhada no fim, com fundo BRANCO OPACO, no canto inferior
  // esquerdo da área de desenho — ou seja, apaga qualquer rótulo que tenha caído
  // ali. O espaço dela é reservado agora, antes de posicionar nome nenhum: da
  // parte do rótulo não adianta não invadir se depois vem a legenda por cima.
  const legendaRet: Ret = {
    x1: dArea.x + 6, y1: dArea.y + 2,
    x2: dArea.x + 6 + 300, y2: dArea.y + 2 + 124,
  };
  ocupado.push(legendaRet);
  // Só o bolinha e o tique saem agora. O CÓDIGO fica reservado e é desenhado
  // depois dos nomes dos vizinhos: quem cede lugar é ele, não o confrontante.
  // Antes era ao contrário — os códigos entravam em `ocupado` primeiro e o bloco
  // do vizinho tinha de se virar em volta deles.
  const codigosPendentes: { codigo: string; lx: number; ly: number; ret: Ret }[] = [];
  for (let i = 0; i < nv; i++) {
    const v = vs[i];
    page.drawCircle({ x: X(v.e), y: Y(v.n), size: 1.4, color: PRETO });
    // fora do polígono pela bissetriz das duas arestas, não pelo centro da folha
    const { x: nx, y: ny } = normalVertice(i);
    // tique do marco, como na planta de referência
    const tique = {
      x1: X(v.e) + nx * 2, y1: Y(v.n) + ny * 2,
      x2: X(v.e) + nx * 6, y2: Y(v.n) + ny * 6,
    };
    linha(c, tique.x1, tique.y1, tique.x2, tique.y2, 0.9);
    // o tique é linha do desenho como qualquer outra: nenhum rótulo passa por cima
    obstaculos.push(tique);
    const w = f.widthOfTextAtSize(v.codigo, VERT_TAM);
    const lx = nx < 0 ? X(v.e) + nx * 8 - w : X(v.e) + nx * 8;
    const ly = Y(v.n) + ny * 8 - VERT_TAM / 2;
    codigosPendentes.push({
      codigo: v.codigo, lx, ly,
      ret: { x1: lx - 1.5, y1: ly - 1.5, x2: lx + w + 1.5, y2: ly + VERT_TAM + 1.5 },
    });
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
    // O bloco é ancorado no ponto interior mais afastado das divisas e encolhe
    // até caber INTEIRO dentro do polígono, com margem para não encostar nas
    // bordas. O cálculo anterior usava só o retângulo envolvente e, em imóveis
    // irregulares, o texto atravessava a divisa.
    const poly: Pt[] = vs.map((v) => ({ x: X(v.e), y: Y(v.n) }));
    const polo = poloInterior(poly);
    const larguraUnit = Math.max(...centroLinhas.map((l) => fb.widthOfTextAtSize(l, 1)));
    let tam = 0, esp = 0, bx0 = polo.x, byTopo = polo.y;
    // teto de 18pt: acima disso o bloco fica maior que os títulos do carimbo
    for (let t = 18; t >= 4; t -= 0.5) {
      const bw = larguraUnit * t;
      const e = t * 1.35;
      const bh = centroLinhas.length * e;
      const mg = Math.max(10, t * 0.9); // margem até a divisa
      if (retanguloDentro(polo.x - bw / 2 - mg, polo.y - bh / 2 - mg, bw + 2 * mg, bh + 2 * mg, poly)) {
        tam = t; esp = e; bx0 = polo.x - bw / 2; byTopo = polo.y + bh / 2;
        break;
      }
    }
    if (tam === 0) { // imóvel estreito demais: menor corpo possível, ainda no polo
      tam = 4; esp = tam * 1.35;
      bx0 = polo.x - (larguraUnit * tam) / 2;
      byTopo = polo.y + (centroLinhas.length * esp) / 2;
    }
    // alinhado à esquerda, padrão da planta de referência
    for (const [li, lt] of centroLinhas.entries()) {
      texto(c, lt, bx0, byTopo - tam - li * esp, tam, { bold: li === 1 });
    }
  }
  // ------------------- marco de divisão: um por vértice M -------------------
  // Todo M é a troca de um confrontante para o outro, então todo M ganha o seu
  // traço verde. Isto é um laço próprio, sobre `d.trechos` cru, de propósito: o
  // desenho antigo saía de dentro do laço de rótulos, que (a) pula os trechos de
  // faixa de domínio no `continue` e (b) funde trechos vizinhos de mesmo
  // confrontante. Na LAGOA SECA, dos três M só o M-4501 (único não-via) recebia
  // marco — os outros dois sumiam e a planta não dizia onde cada divisa começa e
  // termina. Ver ARQUITETURA-TRECHOS.md.
  const marcos: Seg[] = [];
  for (const t of d.trechos) {
    const vm = vs[t.inicioIdx % nv];
    if (!vm) continue;
    const { x: gx, y: gy } = normalVertice(t.inicioIdx % nv);
    const x1 = X(vm.e), y1 = Y(vm.n), x2 = x1 + gx * 50, y2 = y1 + gy * 50;
    linha(c, x1, y1, x2, y2, 2.8, VERDE);
    marcos.push({ x1, y1, x2, y2 });
  }
  // O traço verde tem 50pt e sai de dentro do vão de um vizinho para o do outro:
  // é o obstáculo mais fácil de um bloco atropelar, e era o único traço do desenho
  // que não estava na lista. Nome de vizinho não invade NADA.
  obstaculos.push(...marcos);
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
  const LBL_TAM = 13, LBL_ESP = 16, LBL_MAXW = 310;
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
    let idxMeio = idxs[0] % nv;
    for (const [k, i] of idxs.entries()) {
      if (alvo <= segLens[k] || k === idxs.length - 1) {
        const a = vs[i], b = vs[(i + 1) % nv];
        idxMeio = i;
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
    // rótulo empurrado para fora pela normal da ARESTA onde caiu o meio do trecho:
    // em imóvel côncavo o vetor a partir do centro da folha apontava para dentro,
    // e o bloco do vizinho ia parar em cima da área do imóvel
    const { x: nx, y: ny } = normalAresta(idxMeio);

    if (t.isEstrada) {
      // Nome da via rotacionado ao longo do segmento, empurrado para fora até não
      // cobrir a linha dupla vermelha nem o polígono.
      const nome = linhasDescritivo(t.descritivo)[0] ?? "";
      const rot = angSeg > 90 || angSeg < -90 ? angSeg + 180 : angSeg;
      // o texto é desenhado a partir da origem; recuar meia largura NA DIREÇÃO DA
      // ROTAÇÃO centraliza o nome sobre o meio do trecho
      const ra = rot * Math.PI / 180;
      // Mesma regra do bloco do confrontante, na medida proporcional: o nome fica
      // no meio da via, encostado nela, e é o corpo que cede para caber. Já é
      // centrado por construção — acompanha a própria estrada, não desliza.
      const AFAST_VIA = Math.max(16, 0.026 * diagPoly);
      const escalasVia: number[] = [];
      // piso de 0,7: abaixo disso o nome da via deixa de ser legível depois da
      // redução para A3 — encolher tem limite, cair fora da folha não tem
      for (let s = 1; s >= 0.7; s -= 0.03) escalasVia.push(s);
      const cands = [1, 1.35, 1.75, 2.2].flatMap((fa, ai) =>
        escalasVia.map((escala, ei) => {
          const tam = LBL_TAM * escala;
          const vw = c.fb.widthOfTextAtSize(nome, tam);
          const o = AFAST_VIA * fa;
          const x = mx + nx * o - Math.cos(ra) * vw / 2;
          const y = my + ny * o - Math.sin(ra) * vw / 2;
          return {
            x, y, tam, custo: 100 * ai + ei,
            ret: retTextoRot(x, y, vw, tam, rot),
            obb: { x, y, w: vw, h: tam, ang: rot },
          };
        }));
      const esc = melhorLivre(cands, obstaculos, ocupado, FOLGA) ?? menosPior(cands, obstaculos, ocupado, FOLGA);
      texto(c, nome, esc.x, esc.y, esc.tam, { bold: true, cor: PRETO, rot });
      ocupado.push(esc.ret);
      rotulosTrecho.push(esc.ret);
      corposTrecho.push(esc.tam);
      obbsTrecho.push(esc.obb);
      continue;
    }
    // o traço verde de divisão já foi desenhado acima, um por M
    // Rótulo do confrontante: bloco de texto corrido alinhado à esquerda, como
    // na planta de referência. A versão anterior desenhava uma linha de
    // assinatura de 340pt com nome e CPF em corpo 21 — duplicava as cartas de
    // anuência e dominava o desenho.
    // O bloco fica CENTRADO no meio da confrontação: o nome do vizinho aparece no
    // vão da divisa dele, não encostado numa ponta. Antes a âncora era pela borda
    // porque centrar fazia rótulos largos voltarem por cima do polígono — hoje
    // isso é impossível, porque a busca abaixo testa colisão contra as linhas.
    //
    // REGRA DE POSIÇÃO — o lugar do nome não se negocia:
    //
    //   no meio do trecho do vizinho, para fora, a uma distância PROPORCIONAL ao
    //   desenho (5,2% da diagonal do polígono, igual para todos os rótulos da
    //   planta), com a largura do bloco proporcional ao COMPRIMENTO DA DIVISA dele.
    //
    // Quem se ajusta para caber é o TEXTO — a quebra de linha e o corpo, que
    // encolhe continuamente até 55% — e, se ainda assim faltar espaço, os códigos
    // dos vértices, que são desenhados depois e cedem lugar.
    //
    // O que havia antes era o oposto: o bloco fugia do obstáculo afastando-se até
    // 208pt e deslizando até 1,05× da própria largura para o lado. Cada nome parava
    // a uma distância diferente, e o do trecho apertado ia parar fora do vão do
    // vizinho — o "desorganizado" relatado. Deslizamento agora não existe: um nome
    // fora do meio do trecho dele aponta para a divisa errada, e isso não é questão
    // de estética. Ver ARQUITETURA-TRECHOS.md.
    const AFAST = Math.max(22, 0.052 * diagPoly);
    // largura do bloco proporcional ao espaço do vizinho, com piso para caber o
    // nome mesmo em trecho curto e teto para não atravessar a folha
    const compTrecho = segLens.reduce((s, l) => s + l, 0);
    const maxW = Math.min(LBL_MAXW, Math.max(90, 0.8 * compTrecho));
    // escalas contínuas: o corpo cede de 1 até 0,55 em passos finos, para o bloco
    // encolher só o necessário em vez de saltar de degrau em degrau
    const ESCALAS: number[] = [];
    for (let s = 1; s >= 0.7; s -= 0.03) ESCALAS.push(s);
    // O afastamento só cresce se nem o menor corpo couber na distância da regra.
    // Crescer aqui NÃO fere a regra: o nome continua no meio do trecho do vizinho,
    // que é o que aponta para a divisa certa — só sai mais para fora do desenho.
    const AFASTS = [1, 1.2, 1.4, 1.65, 1.9, 2.2, 2.55, 2.95, 3.4, 3.9];
    // Deslize lateral, ÚLTIMO recurso — e só existe porque "não invadir" ganha de
    // "ficar no meio". No ADERLÂNDIO REIS MOTA (serviço ff198218) a divisa fica no
    // fundo de um "V" côncavo: a normal do meio do trecho aponta para dentro da
    // própria reentrância, e nenhuma distância nem nenhum corpo limpa a aresta
    // vizinha. Sem esta saída o rótulo era desenhado POR CIMA da linha, que é pior
    // que sair um pouco do centro. O peso garante que ele só entre quando nada
    // centrado estiver livre: 2000 por passo contra 909 do pior caso centrado.
    const DESLS = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8];
    const dir = { x: Math.cos(angSeg * Math.PI / 180), y: Math.sin(angSeg * Math.PI / 180) };
    const cands: { lbl: string[]; lx: number; ty: number; tam: number; esp: number; desl: number; custo: number; ret: Ret }[] = [];
    for (const [di, desl] of DESLS.entries()) {
      for (const [ai, fa] of AFASTS.entries()) {
        for (const [ei, escala] of ESCALAS.entries()) {
          const tam = LBL_TAM * escala, esp = LBL_ESP * escala;
          const lbl = quebrarLinhas(linhasDescritivo(t.descritivo), maxW, tam, f);
          const blockW = Math.max(...lbl.map((l) => f.widthOfTextAtSize(l, tam)));
          const altura = lbl.length * esp;
          const MG = AFAST * fa;
          // meio do trecho, empurrado para fora; o bloco é centrado nesse ponto
          // o deslize é limitado pelo ESPAÇO DO VIZINHO: no máximo 0,4 do
          // comprimento da divisa dele, para o nome nunca chegar ao vão do vizinho
          // de baixo mesmo quando o desvio é a única saída contra a sobreposição
          const passo = desl * Math.min(blockW, 0.4 * compTrecho);
          let lx = mx + nx * MG + dir.x * passo - blockW / 2;
          let ty = my + ny * MG + dir.y * passo + altura / 2;
          // e o bloco inteiro fica dentro da área de desenho — antes os rótulos
          // laterais vazavam para fora da folha
          lx = Math.max(dArea.x + 4, Math.min(lx, dArea.x + dArea.w - blockW - 4));
          ty = Math.max(dArea.y + altura, Math.min(ty, dArea.y + dArea.h - tam));
          cands.push({
            lbl, lx, ty, tam, esp, desl,
            // 2000 por passo de deslize ≫ 9·100 (afastamento) + 10 (corpo) = 910:
            // sair do meio só quando NADA centrado estiver livre. Depois disso,
            // manter a distância da regra vale mais que manter o corpo.
            custo: 2000 * Math.ceil(di / 2) + 100 * ai + ei,
            ret: { x1: lx - 2, y1: ty - altura, x2: lx + blockW + 2, y2: ty + tam },
          });
        }
      }
    }
    const esc = melhorLivre(cands, obstaculos, ocupado, FOLGA) ?? menosPior(cands, obstaculos, ocupado, FOLGA);
    for (const [li, lt] of esc.lbl.entries()) texto(c, lt, esc.lx, esc.ty - li * esc.esp, esc.tam);
    ocupado.push(esc.ret);
    rotulosTrecho.push(esc.ret);
    corposTrecho.push(esc.tam);
    obbsTrecho.push(undefined);
    if (esc.desl !== 0) deslocados++;
  }

  // ------------------- códigos dos vértices, por último -------------------
  // Reservados lá em cima e desenhados só agora: o nome do vizinho tem posição
  // fixada por regra, então quem cede é o código. Em divisas com muitos pontos
  // quase alinhados (a face norte do MONOINO tem 13) eles já se suprimiam entre
  // si; agora também cedem ao bloco do confrontante. Nada se perde no fluxo de
  // matrícula — o quadro analítico lista TODOS os vértices.
  for (const cp of codigosPendentes) {
    if (ocupado.some((o) => retCruzaRet(cp.ret, o))) { rotulosOcultos++; continue; }
    ocupado.push(cp.ret);
    texto(c, cp.codigo, cp.lx, cp.ly, VERT_TAM, { cor: PRETO });
  }

  // ------------------- bússola (rosa dos ventos moderna) -------------------
  // estrela de 8 pontas: pontas cardeais com metades preto/branco (efeito 3D),
  // pontas diagonais menores em cinza, dois anéis com marcações a cada 45°
  {
    // afastada do canto p/ não cobrir os rótulos N=/E= da malha (que ocupam
    // as bordas), e maior p/ acompanhar a nova escala dos textos
    const R = 58;
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
    texto(c, "N", bx, by + R + 10, 22, { bold: true, center: true });
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
    // mesma caixa reservada lá em cima em `legendaRet` — nenhum rótulo caiu aqui
    const lx = legendaRet.x1 + 6, boxW = legendaRet.x2 - legendaRet.x1, boxH = legendaRet.y2 - legendaRet.y1;
    page.drawRectangle({ x: legendaRet.x1, y: legendaRet.y1, width: boxW, height: boxH, color: rgb(1, 1, 1), borderColor: PRETO, borderWidth: 0.8 });
    const lyTop = legendaRet.y2;
    texto(c, "LEGENDAS / ABREVIATURAS", lx, lyTop - 17, 11, { bold: true });
    const itens: [ReturnType<typeof rgb>, string][] = [
      [VERMELHO, "ESTRADA"], [AZUL, "POLIGONAL DO TERRENO"], [VERDE, "DIVISÕES DAS CONFRONTAÇÕES"], [CINZA, "MALHA DE COORDENADA"],
    ];
    let lyy = lyTop - 38;
    for (const [cor, nome] of itens) {
      linha(c, lx, lyy + 3, lx + 38, lyy + 3, 3.4, cor);
      texto(c, nome, lx + 46, lyy, 9.5);
      lyy -= 20;
    }
    texto(c, posse ? "POSSE = IMÓVEL SEM MATRÍCULA" : "MATR. = MATRÍCULA", lx, lyy, 9.5);
  }

  if (diag) {
    diag.obstaculos = obstaculos;
    diag.rotulos = rotulosTrecho;
    diag.sobrepostos = rotulosTrecho.filter((r, i) => {
      const o = obbsTrecho[i];
      return obstaculos.some((s) => (o ? segCruzaObb(s, o) : segCruzaRet(s, r)));
    }).length;
    diag.deslocados = deslocados;
    diag.marcos = marcos;
    diag.vias = vias;
    diag.corpos = corposTrecho;
    diag.folga = FOLGA;
    diag.poligono = vs.map((v) => ({ x: X(v.e), y: Y(v.n) }));
  }

  // posse: a MESMA folha, entregue no A3 exato (420×297 mm).
  //
  // Um único fator para os dois eixos — é isso que faz da A3 uma redução e não
  // uma folha diferente. Meia-A1 daria 420,5×297, então quem manda é o eixo mais
  // apertado (420/841 ≈ 0,4994) e sobra 1,1pt de altura, repartida em cima e
  // embaixo para a moldura continuar centrada. Escalar cada eixo pelo seu próprio
  // fator caberia igual, mas achataria o desenho 0,12% na horizontal: o círculo
  // da bússola viraria elipse e a escala gráfica deixaria de bater com a numérica.
  if (posse) {
    const w3 = 420 * MM, h3 = 297 * MM;
    const s = Math.min(w3 / W, h3 / H);
    // ordem importa: o translate é aplicado por fora da escala (T · S)
    page.scaleContent(s, s);
    page.translateContent((w3 - W * s) / 2, (h3 - H * s) / 2);
    page.setSize(w3, h3);
  }

  return await pdf.save();
}
