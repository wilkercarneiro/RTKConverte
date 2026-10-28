// Geração da PLANTA (PDF) do imóvel georreferenciado, no padrão da planta
// final da empresa: malha de coordenadas UTM, polígono, estradas em linha
// dupla vermelha, divisões de confrontação em verde com rótulos e linhas de
// assinatura, carimbo com a logo, bloco planimétrico, RT e rodapé.
//   matrícula → folha A1 paisagem, COM quadro analítico e selos de cartório
//   posse     → folha A3 paisagem, SEM quadro analítico, assinatura do posseiro
import { PDFDocument, PDFFont, StandardFonts, concatTransformationMatrix, degrees, popGraphicsState, pushGraphicsState, rgb } from "pdf-lib";
import { partesDescritivo, textoWinAnsi } from "./texto.ts";
import { GravadorCena, embutirCena, embutirImagem, marcarObjeto, type PaginaPlanta } from "./planta_cena.ts";

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
  /**
   * Divisa INTERNA entre glebas do mesmo imóvel. Na planta geral (uma parte por
   * gleba) ela é desenhada como lado do anel, mas não ganha rótulo de
   * confrontante nem marco verde: o "vizinho" é a gleba ao lado, que já está
   * identificada pelo próprio bloco, e um rótulo para fora dela cairia dentro
   * da outra.
   */
  interno?: boolean;
  /**
   * O operador desmarcou "exibir na planta" neste confrontante/estrada: a
   * divisa é desenhada normalmente, mas o nome NÃO sai (nem bloco, nem número
   * no quadro do rodapé). Default ausente = exibe, como sempre.
   */
  semRotulo?: boolean;
  /**
   * Curso d'água (limite LN1): linha dupla AZUL, no lugar da vermelha.
   *
   * Vem separado de `isEstrada` porque o rio continua sendo faixa de domínio
   * para o memorial e para as declarações — o que muda é só a cor do traço.
   * Rio VENCE estrada: com `isRio`, a dupla vermelha não é desenhada.
   */
  isRio?: boolean;
  /**
   * Confrontante NUMERADO: no desenho sai só o número, dentro de um disco
   * branco no meio da divisa, e o texto vai para o quadro CONFRONTANTES no
   * rodapé da área de desenho.
   *
   * Existe porque a largura do bloco de nome é proporcional ao COMPRIMENTO da
   * divisa (`maxW`): numa divisa curta o bloco fica alto e estreito, e dois
   * vizinhos assim, lado a lado, acabam empilhados um sobre o outro — o motor
   * esgota os candidatos e cai em `menosPior`, que desenha por cima. Um dígito
   * ocupa ~20×20pt e nunca esbarra em nada.
   *
   * O NÚMERO em si não vem daqui: é calculado por `numerarConfrontantes` sobre
   * o anel inteiro, para que os dois fluxos (cálculo do sistema e PDF do SIGEF)
   * produzam a mesma sequência e para que mover um trecho renumere sozinho.
   */
  numerado?: boolean;
  inicioIdx: number;    // índice do vértice inicial no anel
  fimIdx: number;       // índice do vértice inicial do PRÓXIMO trecho
}

/** Folha de entrega. Ausente = regra histórica (posse → A3, resto → A1). */
export type Folha = "A1" | "A3" | "A4";

/**
 * Uma gleba do imóvel.
 *
 * NÃO é uma divisa interna decorativa: na planta de referência da empresa
 * (FAZENDA MAURICÉIA) cada gleba é uma POLIGONAL própria — mesmo azul, mesma
 * espessura da poligonal do terreno —, com bloco de identificação completo,
 * linha no quadro analítico e área/perímetro próprios no rodapé. A legenda não
 * tem entrada de "divisão de gleba" porque gleba não é um tipo de traço: é o
 * imóvel, dividido.
 *
 * Os vértices vêm no MESMO plano do perímetro, então o enquadramento continua
 * saindo do perímetro e a planta de um serviço sem glebas não muda.
 */
export interface GlebaPlanta {
  nome: string;                  // "GLEBA 1"
  areaFmt: string;               // "502,2827"
  tarefasFmt: string;            // "1.153,08"
  perimetroFmt: string;          // "11.147,32"
  /** Bloco de identificação, uma linha por linha desenhada. */
  identificacao: string[];
  /** O anel da gleba, com o que o quadro analítico precisa de cada vértice. */
  vertices: VerticePlanta[];
  /** Índices do anel cuja aresta de saída é faixa de domínio (linha vermelha). */
  viasIdx?: number[];
  /** Índices do anel cuja aresta de saída é curso d'água (linha azul, LN1). */
  riosIdx?: number[];
}

/** Uma parte do imóvel na planta geral: anel próprio com os seus trechos (índices locais). */
export interface ParteDaPlanta {
  nome: string;
  vertices: VerticePlanta[];
  trechos: TrechoPlanta[];
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
  folha?: Folha;                    // sobrepõe a folha; ausente = regra de tipoImovel
  /**
   * Prévia de conferência de área: sai sem o quadro analítico, que é a tabela
   * que o SIGEF confere e a prévia ainda não passou por ele.
   *
   * Os códigos dos vértices FICAM no desenho. Eles saíam suprimidos enquanto a
   * prévia numerava com o prefixo do credenciado ("DSBN-P-14300"), que impresso
   * ao lado do marco passava por definitivo; hoje ela numera "P-1", "P-2"
   * (`codigoConferencia`), que não se confunde com código oficial e é o que o
   * cliente usa para achar o ponto na planta.
   */
  conferencia?: boolean;
  /**
   * Campos que a prévia pode omitir. Ausente ou `true` = sai como sempre saiu.
   *
   * Uma conferência de área acontece ANTES de o imóvel ter documento: acontece
   * de não haver matrícula nem posse declarada, de a fazenda ainda não ter nome
   * e de o TRT não ter sido emitido. Imprimir "Matrícula do Imóvel:" em branco é
   * pior do que não imprimir — parece dado perdido. Por isso quem decide é o
   * operador, campo a campo, e não uma regra derivada do cadastro.
   */
  exibir?: { matricula?: boolean; denominacao?: boolean; trt?: boolean };
  glebas?: GlebaPlanta[];           // sub-polígonos internos; ausente/vazio = nada muda
  /**
   * Imóvel em PARTES (anéis separados — cortado por estradas, ou levantado em
   * glebas fechadas): cada parte é desenhada como um anel próprio, com as suas
   * divisas de confrontação, marcos e códigos. `vertices`/`trechos` passam a ser
   * só a concatenação (para enquadramento, quadro numerado e diagnóstico) e o
   * polígono geral NÃO é desenhado. Combine com `glebas` (uma por parte) para o
   * bloco de identificação e o quadro analítico por parte. Ausente = um anel só.
   */
  partes?: ParteDaPlanta[];
  /**
   * Escreve o comprimento de cada lado ao longo dele, do lado de dentro do anel
   * (de cada gleba, quando há glebas). Opcional na hora de gerar; ausente = não sai.
   */
  metragem?: boolean;
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

// Tela de desenho, em mm. O desenho é SEMPRE feito no tamanho de um A1 e
// reduzido no fim — é isso que faz da A3 uma redução e não uma segunda planta.
// A A4 é a exceção: ela tem OUTRO arranjo (ver LAYOUT SIMPLES), e arranjo
// retrato precisa de tela retrato, senão o desenho nasce deitado e a redução
// final o espremeria.
const TELA_PAISAGEM: [number, number] = [841 * MM, 594 * MM];
const TELA_RETRATO: [number, number] = [594 * MM, 841 * MM];

// Folhas de entrega, em mm. A4 é a única retrato: é a folha da conferência que
// circula impressa em mesa, no modelo simplificado.
const FOLHAS_MM: Record<Folha, [number, number]> = {
  A1: [841, 594],
  A3: [420, 297],
  A4: [210, 297],
};
const AZUL = rgb(0, 0.2, 0.85);
// Azul do curso d'água (LN1). Deliberadamente MAIS CLARO que o AZUL da
// poligonal: as duas linhas correm lado a lado na mesma divisa, e no mesmo tom
// a dupla do rio pareceria um engrossamento do próprio perímetro. É o azul de
// água — o mesmo papel que o VERMELHO faz para a estrada.
const AZUL_RIO = rgb(0.05, 0.6, 0.9);
const VERMELHO = rgb(0.85, 0.05, 0.05);
/** Estrada: uma linha vermelha por cima da azul da divisa, mais fina para a azul aparecer nas bordas. */
const LARG_ESTRADA = 2.2;
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

interface Ctx { page: PaginaPlanta; f: PDFFont; fb: PDFFont }

/** Objeto e camada das próximas peças da cena (o editor seleciona por objeto). */
const obj = (c: Ctx, id: string, cat: string, rotulo: string, travado = false) => marcarObjeto(c.page, id, cat, rotulo, travado);

// Único ponto em que texto vira glifo. A limpeza WinAnsi mora aqui, e não em
// cada chamador, porque a folha é desenhada numa passada só: um caractere que a
// fonte padrão não encode derruba a planta INTEIRA, não o campo em que ele está.
// Ver textoWinAnsi.
function texto(c: Ctx, bruto: string, x: number, y: number, size: number, opts: { bold?: boolean; cor?: ReturnType<typeof rgb>; rot?: number; center?: boolean } = {}) {
  const t = textoWinAnsi(bruto);
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

function caixaTitulo(c: Ctx, x: number, y: number, w: number, h: number, titulo: string, th = 46, tamMax = 30): number {
  caixa(c, x, y, w, h);
  // título auto-ajustado à largura, sem caixinha em volta — só uma linha
  // separadora de largura total abaixo dele. A faixa inferior do A4 usa o
  // título grande (46/30); a barra lateral do A1/A3, o pequeno do modelo.
  const tam = Math.min(tamMax, (w - 28) / c.fb.widthOfTextAtSize(titulo, 1));
  const base = th === 46 ? 14 : (th - tam * 0.72) / 2;
  texto(c, titulo, x + w / 2, y + h - th + base, tam, { bold: true, center: true });
  linha(c, x, y + h - th, x + w, y + h - th, 1);
  return y + h - th; // topo útil
}

// texto que encolhe até caber em maxW — garante que nada estoura o campo
function textoFit(c: Ctx, bruto: string, x: number, y: number, size: number, maxW: number, opts: { bold?: boolean; cor?: ReturnType<typeof rgb>; center?: boolean } = {}) {
  // medido sobre o MESMO texto que vai ser desenhado, senão a largura calculada
  // aqui não seria a largura impressa
  const t = textoWinAnsi(bruto);
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

/**
 * Distância, a partir de `p` andando na direção `d`, até a divisa ser
 * REENCONTRADA. `Infinity` quando o raio nunca mais volta.
 *
 * É a folga que existe de verdade do lado de fora de uma aresta. A normal
 * externa só garante "para fora" num passo infinitesimal: numa reentrância
 * estreita, andar o bastante atravessa a divisa vizinha e volta para dentro do
 * imóvel. Ver `folgaExterna` no laço dos rótulos.
 */
/** Um anel ou vários (as partes do imóvel): o rótulo não pode cair dentro de nenhum. */
type Aneis = Pt[] | Pt[][];
const listaDeAneis = (a: Aneis): Pt[][] => (a.length && Array.isArray(a[0]) ? (a as Pt[][]) : [a as Pt[]]);
const dentroDeAlgum = (p: Pt, a: Aneis): boolean => listaDeAneis(a).some((anel) => pontoDentro(p, anel));

function distanciaAteDivisa(p: Pt, d: Pt, aneis: Aneis): number {
  let menor = Infinity;
  for (const anel of listaDeAneis(aneis)) for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    const ex = b.x - a.x, ey = b.y - a.y;
    const den = d.x * ey - d.y * ex;
    if (Math.abs(den) < 1e-9) continue;                       // raio paralelo à aresta
    const t = (ex * (p.y - a.y) - ey * (p.x - a.x)) / den;    // ao longo do raio
    const u = (d.x * (p.y - a.y) - d.y * (p.x - a.x)) / den;  // ao longo da aresta
    // t > tolerância: ignora a própria aresta de onde o raio parte
    if (t > 1e-3 && u >= 0 && u <= 1 && t < menor) menor = t;
  }
  return menor;
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
  // limpo ANTES de medir: `widthOfTextAtSize` estoura no mesmo caractere que o
  // desenho, e era daqui que vinha o "WinAnsi cannot encode" da planta
  for (const l of linhas.map(textoWinAnsi)) {
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
  /** quantos rótulos de trecho caíram DENTRO da poligonal do imóvel (deve ser 0) */
  dentroDoImovel?: number;
  /** traços verdes de divisão — tem de sair um por vértice M, via ou não */
  marcos?: Seg[];
  /** as linhas duplas de faixa (vermelhas e azuis), p/ conferir que caem FORA da poligonal */
  vias?: Seg[];
  /** corpo em que cada rótulo de trecho acabou saindo, na ordem de `rotulos` */
  corpos?: number[];
  /** folga mínima exigida entre rótulo de trecho e traço do desenho */
  folga?: number;
  /** o anel como foi desenhado, em pontos da folha */
  poligono?: Pt[];
  /** divisas de gleba EFETIVAMENTE traçadas — as repetidas não entram aqui */
  divisasGleba?: Seg[];
  /** caixas dos nomes de gleba, para conferir que não se sobrepõem */
  rotulosGleba?: Ret[];
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

/**
 * Ponto dentro do polígono (ray casting).
 *
 * O rótulo de uma gleba precisa cair DENTRO dela: em glebas vizinhas, um nome
 * empurrado para escapar do vizinho acabava dentro da gleba ao lado, nomeando a
 * errada — o que é pior que dois nomes juntos, porque parece certo.
 */
function pontoEmPoligono(p: Pt, anel: Pt[]): boolean {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const a = anel[i], b = anel[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) {
      dentro = !dentro;
    }
  }
  return dentro;
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
/**
 * Centro do candidato — é por ele que se decide se o rótulo caiu DENTRO do
 * imóvel. Ver `anelProibido`.
 */
function centroCand(r: Ret): Pt {
  return { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 };
}

/**
 * Melhor candidato livre.
 *
 * `anelProibido` é o anel do imóvel: um rótulo cujo CENTRO cai lá dentro está
 * errado mesmo sem cruzar linha nenhuma. Faltava esta pergunta — o teste era só
 * "cruza algum segmento?", e num imóvel grande sobra vazio interno de sobra para
 * um bloco de 310pt pousar sem tocar em nada. Era assim que o nome do vizinho do
 * trecho do M-4640 (FAZENDA RIACHO DA CRUZ) ia parar no meio da fazenda: o
 * candidato mais barato, sem cruzamento, aceito de primeira.
 */
function melhorLivre<T extends { ret: Ret; obb?: Obb; custo: number }>(
  candidatos: T[], obstaculos: Seg[], ocupado: Ret[], folga = 0, anelProibido?: Aneis,
): T | null {
  let melhor: T | null = null;
  for (const cand of candidatos) {
    if (melhor && cand.custo >= melhor.custo) continue;
    if (anelProibido && dentroDeAlgum(centroCand(cand.ret), anelProibido)) continue;
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
  candidatos: T[], obstaculos: Seg[], ocupado: Ret[], folga = 0, anelProibido?: Aneis,
): T {
  let melhor = candidatos[0], melhorN = Infinity;
  for (const cand of candidatos) {
    const n = obstaculos.filter((s) => (cand.obb ? segCruzaObb(s, cand.obb, folga) : segCruzaRet(s, inflar(cand.ret, folga)))).length
      + ocupado.filter((o) => retCruzaRet(inflar(cand.ret, folga), o)).length
      // Cair dentro do imóvel pesa mais que cruzar uma linha: um nome sobre a
      // divisa ainda aponta a divisa certa; um nome no meio da fazenda, não.
      + (anelProibido && dentroDeAlgum(centroCand(cand.ret), anelProibido) ? 100 : 0);
    if (n < melhorN) { melhor = cand; melhorN = n; if (n === 0) break; }
  }
  return melhor;
}

// quebra o descritivo em linhas de rótulo (sempre em MAIÚSCULAS)
function linhasDescritivo(descritivo: string): string[] {
  const partes = partesDescritivo(descritivo);
  const out: string[] = [];
  const m = partes[0]?.match(/^(\([^)]*\))\s*(.+)$/);
  if (m) { out.push(m[1]); out.push(m[2]); } else if (partes[0]) out.push(partes[0]);
  for (const p of partes.slice(1)) out.push(p);
  return out.map((l) => l.toUpperCase());
}

// ---------------------------------------------------------------------------
// confrontantes numerados
// ---------------------------------------------------------------------------

/**
 * Chave de identidade de um confrontante: o descritivo, sem espaços nas pontas
 * e em maiúsculas.
 *
 * Espelhada em src/lib/trechos.ts — as duas precisam andar juntas, senão a
 * numeração que a tela mostra ao operador não é a que sai no PDF.
 */
export const chaveConfrontante = (descritivo: string): string => descritivo.trim().toUpperCase();

export interface ConfrontanteNumerado {
  numero: number;
  chave: string;
  /** descritivo cru, como digitado — o quadro do rodapé imprime a partir dele */
  descritivo: string;
}

/**
 * Quem sai numerado, e com que número.
 *
 * REGRAS — as mesmas dos dois lados (tela e PDF):
 *
 *   1. só entra quem o operador marcou (`numerado`);
 *   2. via e rio NUNCA entram: o nome da estrada acompanha o traço dela, não é
 *      um bloco de vizinho, e não é ele que empilha;
 *   3. descritivo vazio não entra — não haveria o que imprimir no quadro;
 *   4. UM número por CONFRONTANTE DISTINTO, não por trecho: o mesmo vizinho em
 *      duas divisas separadas do anel leva o mesmo número nas duas, porque é o
 *      mesmo vizinho. Trechos contíguos de mesmo descritivo já viravam um só
 *      rótulo; os não contíguos passam a compartilhar o número;
 *   5. a ordem é a do ANEL (por `inicioIdx`), começando em 1 — com um só
 *      marcado, ele é o "1".
 *
 * O número NÃO vem do banco: o banco guarda só o booleano. É isto que faz mover
 * ou remover uma confrontação renumerar sozinha, e faz os dois fluxos — cálculo
 * do sistema e PDF do SIGEF — produzirem a mesma sequência.
 */
export function numerarConfrontantes(
  trechos: { descritivo: string; isEstrada?: boolean; isRio?: boolean; numerado?: boolean; semRotulo?: boolean; inicioIdx: number }[],
): ConfrontanteNumerado[] {
  const out: ConfrontanteNumerado[] = [];
  const vistos = new Set<string>();
  for (const t of [...trechos].sort((a, b) => a.inicioIdx - b.inicioIdx)) {
    if (!t.numerado || t.isEstrada || t.isRio || t.semRotulo) continue;   // oculto na planta: nem número
    const chave = chaveConfrontante(t.descritivo);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push({ numero: out.length + 1, chave, descritivo: t.descritivo });
  }
  return out;
}

/** Uma entrada do quadro, já quebrada nas linhas da coluna em que vai sair. */
interface EntradaQuadro { numero: number; linhas: string[] }
interface QuadroNumerados {
  /** altura reservada no rodapé da área de desenho; 0 quando não há numerados */
  h: number;
  tam: number;
  esp: number;
  colW: number;
  /** entradas já distribuídas em colunas */
  colunas: EntradaQuadro[][];
}

/**
 * Mede o quadro CONFRONTANTES ANTES da escala, para descontá-lo da área de
 * desenho.
 *
 * Reservar espaço é o oposto do que os rótulos fazem — eles disputam lugar com
 * o motor de colisão. Aqui não há disputa: a faixa sai do desenho antes de o
 * polígono ser projetado, então a escala se ajusta sozinha e nada pode cair em
 * cima. É o mesmo princípio da legenda (`legendaRet`), levado ao rodapé inteiro.
 *
 * O corpo cede antes das colunas: um quadro de 3 colunas em corpo 11 é mais
 * legível que um de 4 em corpo 7, e a folha é larga.
 */
function medirQuadroNumerados(
  numerados: ConfrontanteNumerado[], f: PDFFont, larguraTotal: number, alturaMax: number,
): QuadroNumerados {
  const vazio: QuadroNumerados = { h: 0, tam: 0, esp: 0, colW: 0, colunas: [] };
  if (numerados.length === 0) return vazio;

  const TIT_H = 24, PAD = 10;
  const colBase = Math.max(1, Math.min(3, Math.floor(larguraTotal / 430)));
  const textoDe = (n: ConfrontanteNumerado) =>
    `${n.numero} - ${linhasDescritivo(n.descritivo).join(" · ")}`;

  // corpo primeiro, colunas depois: só quando nem o menor corpo couber é que o
  // quadro ganha mais uma coluna
  const tentativas: [number, number][] = [];
  for (const tam of [11, 10, 9, 8, 7]) tentativas.push([colBase, tam]);
  if (colBase < 4) for (const tam of [9, 8, 7, 6.5]) tentativas.push([colBase + 1, tam]);

  let ultima: QuadroNumerados = vazio;
  for (const [nCols, tam] of tentativas) {
    const esp = tam * 1.24;
    const colW = larguraTotal / nCols - 18;
    const blocos: EntradaQuadro[] = numerados.map((n) => ({
      numero: n.numero,
      linhas: quebrarLinhas([textoDe(n)], colW, tam, f),
    }));
    // distribuição sequencial equilibrada: a coluna acumula até passar do alvo,
    // e a entrada NUNCA é partida entre duas colunas — número numa, texto noutra
    // seria pior que uma coluna mais alta
    const totalLinhas = blocos.reduce((sum, b) => sum + b.linhas.length, 0);
    const alvo = Math.ceil(totalLinhas / nCols);
    const colunas: EntradaQuadro[][] = Array.from({ length: nCols }, () => []);
    let col = 0, acum = 0;
    for (const b of blocos) {
      if (acum > 0 && acum + b.linhas.length > alvo && col < nCols - 1) { col++; acum = 0; }
      colunas[col].push(b);
      acum += b.linhas.length;
    }
    const maxLinhas = Math.max(...colunas.map((cc) => cc.reduce((sum, b) => sum + b.linhas.length, 0)));
    ultima = { h: TIT_H + maxLinhas * esp + PAD, tam, esp, colW, colunas };
    if (ultima.h <= alturaMax) return ultima;
  }
  // nem no menor corpo coube: sai assim mesmo. Um quadro alto encolhe o desenho,
  // mas um quadro cortado esconde de quem é a divisa — que é o dado que o
  // número no desenho promete.
  return ultima;
}

// ---------------------------------------------------------------------------
// principal
// ---------------------------------------------------------------------------
/**
 * `editavel`: embute no PDF a CENA do desenho (planta_cena.ts), que é o que o
 * editor do navegador abre. O desenho não muda em nada — o gravador só repassa
 * as chamadas à página —, por isso o PDF sem a opção continua byte a byte o de
 * sempre.
 */
export async function gerarPlantaPdf(d: DadosPlanta, diag?: DiagPlanta, opts: { editavel?: boolean } = {}): Promise<Uint8Array> {
  const posse = d.tipoImovel === "posse";
  // Qual folha sai. `d.folha` ausente reproduz a regra histórica — posse em A3,
  // resto em A1 — para que nenhum chamador antigo mude de comportamento por ter
  // ganhado um campo. A A4 existe para a conferência de área, que é prévia e
  // circula impressa em mesa, não em prancheta.
  const folha: Folha = d.folha ?? (posse ? "A3" : "A1");
  // Gleba com menos de 3 vértices não fecha polígono: não desenha, não entra no
  // quadro analítico e não entra no rodapé. Filtrada UMA vez aqui para que as
  // três decisões não possam divergir — era assim que uma gleba pela metade
  // sumia do desenho mas continuava aparecendo na área do rodapé.
  const glebas = (d.glebas ?? []).filter((g) => g.vertices.length >= 3);
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
  // LAYOUT SIMPLES (A4): a conferência de área não é prancha de prancheta — é a
  // folha que vai à mesa com o cliente. Nela não entram quadro analítico,
  // planimétrico nem selo de cartório: fica o desenho, as áreas, e embaixo uma
  // faixa com o carimbo da empresa, a planta de situação e um selo pequeno.
  // O A3 e o A1 seguem o arranjo do serviço completo, sem uma linha de diferença.
  const simples = folha === "A4";
  // Omitir é sempre escolha explícita: campo ausente vale como "mostra", para
  // que nenhuma planta antiga mude de conteúdo por causa de um campo novo.
  const exibe = {
    matricula: d.exibir?.matricula !== false,
    denominacao: d.exibir?.denominacao !== false,
    trt: d.exibir?.trt !== false,
  };
  const [W, H] = simples ? TELA_RETRATO : TELA_PAISAGEM;
  const pdf = await PDFDocument.create();
  // O gravador fica entre o desenho e a página: repassa cada chamada e a anota
  // como peça da cena. Tudo abaixo desenha nele como desenharia na página.
  const page = new GravadorCena(pdf.addPage([W, H]));
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const c: Ctx = { page, f, fb };

  // molduras
  obj(c, "moldura", "moldura", "Molduras");
  caixa(c, 14, 14, W - 28, H - 28, 2);
  caixa(c, 20, 20, W - 40, H - 40, 0.8);

  // ------------------- área de desenho e barra lateral -------------------
  // No arranjo simples a barra lateral não existe: o que era coluna à direita
  // vira faixa no rodapé, e o desenho fica com a folha inteira acima dela.
  // 540 pt ≈ 22% da largura do A1, a proporção da planta de referência da
  // D'Prol (pedido de 2026-10-14). Com 720 a barra comia 30% da folha e os
  // textos dela saíam enormes na impressão.
  //
  // A barra é desenhada em coordenadas próprias, de largura lógica SB_W, e
  // ampliada por SB_K na folha. A A3 é a A1 reduzida à metade: com os corpos
  // do modelo (7,5–12 pt) a barra dela imprimiria a 4 pt. Na A3 ela é desenhada
  // com 405 de largura e ampliada em 4/3 — a MESMA largura física da A1, para
  // que o desenho continue idêntico (a A3 não tem quadro analítico, a seção
  // larga), e os textos saem a 5–8 pt.
  const SB_FIS = simples ? 0 : 540;
  const SB_K = folha === "A1" ? 1 : 4 / 3;
  const SB_W = SB_FIS / SB_K;
  const sbX = W - 20 - SB_FIS;
  const SELO_H = simples ? 156 : 0;    // proprietário/RT/escala/município/folha
  const FAIXA_H = simples ? 380 : 0;   // carimbo da empresa | planta de situação
  const dAreaCheia = simples
    ? { x: 46, y: 20 + SELO_H + FAIXA_H + 16, w: W - 92, h: H - 56 - SELO_H - FAIXA_H - 16 }
    : { x: 60, y: 60, w: sbX - 100, h: H - 120 };

  // ------------------- quadro dos confrontantes numerados -------------------
  // Quem o operador marcou sai do desenho como NÚMERO e reaparece por extenso
  // aqui embaixo. A faixa é medida e descontada ANTES da escala: o polígono é
  // projetado já no que sobra, e nenhum rótulo pode cair no quadro porque o
  // quadro não faz parte da área de desenho.
  //
  // Sem nenhum marcado, `h = 0` e TUDO abaixo é bit a bit o que era antes de
  // este bloco existir — é o que mantém idêntica a planta de quem não usa.
  const numerados = numerarConfrontantes(d.trechos);
  const numeroDe = new Map(numerados.map((n) => [n.chave, n.numero]));
  const quadroNum = medirQuadroNumerados(numerados, f, dAreaCheia.w, dAreaCheia.h * 0.28);
  const dArea = quadroNum.h > 0
    ? { ...dAreaCheia, y: dAreaCheia.y + quadroNum.h, h: dAreaCheia.h - quadroNum.h }
    : dAreaCheia;

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
  // Discreto, como na planta de referência. No arranjo simples sobe: a folha
  // inteira encolhe para um A4, e 11pt na tela viram 3,9pt no papel.
  const GRID_TAM = simples ? 18 : 11;
  for (let e = e0; X(e) < dArea.x + dArea.w; e += passo) {
    obj(c, `malha:e${e}`, "malha", `Malha E=${fmtMilhar(e)}`);
    linha(c, X(e), dArea.y, X(e), dArea.y + dArea.h, 0.4, CINZA, [2, 4]);
    const et = `E=${fmtMilhar(e)}`;
    const eLen = f.widthOfTextAtSize(et, GRID_TAM);
    texto(c, et, X(e) + 9, dArea.y + dArea.h - 14, GRID_TAM, { cor: CINZA, rot: -90 });
    texto(c, et, X(e) + 9, dArea.y + 12 + eLen, GRID_TAM, { cor: CINZA, rot: -90 });
  }
  for (let n = n0; Y(n) < dArea.y + dArea.h; n += passo) {
    obj(c, `malha:n${n}`, "malha", `Malha N=${fmtMilhar(n)}`);
    linha(c, dArea.x, Y(n), dArea.x + dArea.w, Y(n), 0.4, CINZA, [2, 4]);
    const nt = `N=${fmtMilhar(n)}`;
    texto(c, nt, dArea.x + 6, Y(n) + 6, GRID_TAM, { cor: CINZA });
    texto(c, nt, dArea.x + dArea.w - f.widthOfTextAtSize(nt, GRID_TAM) - 6, Y(n) + 6, GRID_TAM, { cor: CINZA });
  }

  // ------------------- anéis: o perímetro, ou as PARTES do imóvel -------------------
  // Tudo o que é "do anel" — lado de fora, normais, trecho de cada aresta, o
  // polígono em coordenadas de papel — vive num contexto por anel. Com um anel
  // só (todo serviço até aqui) o resultado é o de sempre; com partes, cada uma
  // é desenhada pelo MESMO código, e os rótulos de uma não podem cair dentro
  // de nenhuma outra.
  interface AnelCtx {
    nome: string | null;
    vs: VerticePlanta[];
    nv: number;
    trechos: TrechoPlanta[];
    anelTela: Pt[];
    normalAresta: (i: number) => Pt;
    normalVertice: (i: number) => Pt;
    trechoDoIdx: (i: number) => TrechoPlanta;
  }
  const contextoAnel = (nome: string | null, vsA: VerticePlanta[], trechosA: TrechoPlanta[]): AnelCtx => {
    const nvA = vsA.length;
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
    const anelTelaA: Pt[] = vsA.map((v) => ({ x: X(v.e), y: Y(v.n) }));
    let giro = 0;
    for (let i = 0; i < nvA; i++) {
      const a = vsA[i], b = vsA[(i + 1) % nvA];
      giro += X(a.e) * Y(b.n) - X(b.e) * Y(a.n);
    }
    const sentido = giro >= 0 ? 1 : -1;
    /** normal externa unitária da aresta i → i+1 */
    const normalAresta = (i: number): Pt => {
      const a = vsA[i], b = vsA[(i + 1) % nvA];
      const dx = X(b.e) - X(a.e), dy = Y(b.n) - Y(a.n);
      const len = Math.hypot(dx, dy) || 1;
      return { x: sentido * dy / len, y: -sentido * dx / len };
    };
    /** normal externa unitária NO vértice i: bissetriz das duas arestas que o tocam */
    const normalVertice = (i: number): Pt => {
      const p = normalAresta((i - 1 + nvA) % nvA), q = normalAresta(i);
      const x = p.x + q.x, y = p.y + q.y;
      const l = Math.hypot(x, y);
      // arestas antiparalelas (bico degenerado): fica com a normal da que sai
      return l < 1e-6 ? q : { x: x / l, y: y / l };
    };
    const trechoDoIdx = (i: number): TrechoPlanta => {
      for (const t of trechosA) {
        if (t.fimIdx > t.inicioIdx ? i >= t.inicioIdx && i < t.fimIdx : i >= t.inicioIdx || i < t.fimIdx) return t;
      }
      return trechosA[trechosA.length - 1];
    };
    return { nome, vs: vsA, nv: nvA, trechos: trechosA, anelTela: anelTelaA, normalAresta, normalVertice, trechoDoIdx };
  };
  const partes = (d.partes ?? []).filter((pt) => pt.vertices.length >= 3);
  const aneis: AnelCtx[] = partes.length
    ? partes.map((pt) => contextoAnel(pt.nome, pt.vertices, pt.trechos))
    : [contextoAnel(null, d.vertices, d.trechos)];
  const aneisTela: Pt[][] = aneis.map((a) => a.anelTela);
  // o anel do imóvel em coordenadas de papel (o primeiro, no caso de partes) —
  // é o que o diagnóstico devolve como `poligono`
  const anelTela: Pt[] = aneis[0].anelTela;
  const nv = vs.length;

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
  const vias: Seg[] = [];

  // Unidade PROPORCIONAL ao desenho. Todo afastamento de rótulo é medido nela, e
  // não em pontos fixos: assim a mesma regra vale para um imóvel de 6 ha e um de
  // 600, e os rótulos de uma planta ficam todos à mesma distância da divisa. Era
  // a falta disso que deixava cada nome a uma distância diferente. Com partes,
  // a diagonal é a do conjunto: todos os rótulos da folha à mesma distância.
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

  for (const [ai, A] of aneis.entries()) {
    const { vs, nv, normalAresta, trechoDoIdx } = A;
    for (let i = 0; i < nv; i++) {
      const t = trechoDoIdx(i);
      // Rio (LN1) vence estrada: sai a dupla AZUL e a vermelha não é desenhada.
      // As duas juntas na mesma divisa diriam que ali há uma estrada E um rio.
      if (!t.isRio) continue;
      const a = vs[i], b = vs[(i + 1) % nv];
      // a linha dupla do rio é SEMPRE por fora: a normal vem do sentido do anel
      const { x: nx, y: ny } = normalAresta(i);
      obj(c, `rio:${ai}:${t.inicioIdx}`, "rio", `Rio — ${linhasDescritivo(t.descritivo)[0] ?? ""}`);
      for (const off of [5, 11]) {
        const seg = { x1: X(a.e) + nx * off, y1: Y(a.n) + ny * off, x2: X(b.e) + nx * off, y2: Y(b.n) + ny * off };
        linha(c, seg.x1, seg.y1, seg.x2, seg.y2, 2.8, AZUL_RIO);
        obstaculos.push(seg);
        vias.push(seg);
      }
    }

    // ------------------- polígono -------------------
    // A ESTRADA sai como UMA linha vermelha POR CIMA da azul, na própria divisa
    // (pedido do usuário, 2026-09-08): a dupla afastada engrossava a via e, em
    // imóvel com várias glebas, virava uma faixa que disputava espaço com tudo.
    // A vermelha é mais fina que a azul de propósito — a poligonal continua
    // visível nas bordas, e a legenda mostra o mesmo par.
    for (let i = 0; i < nv; i++) {
      const a = vs[i], b = vs[(i + 1) % nv];
      const seg = { x1: X(a.e), y1: Y(a.n), x2: X(b.e), y2: Y(b.n) };
      // a poligonal é o terreno: no editor ela aparece, mas não se mexe
      obj(c, "terreno", "terreno", "Traçado do terreno", true);
      linha(c, seg.x1, seg.y1, seg.x2, seg.y2, 3.4, AZUL);
      obstaculos.push(seg);
      const t = trechoDoIdx(i);
      if (t.isEstrada && !t.isRio) {
        obj(c, `estrada:${ai}:${t.inicioIdx}`, "estrada", `Estrada — ${linhasDescritivo(t.descritivo)[0] ?? ""}`);
        linha(c, seg.x1, seg.y1, seg.x2, seg.y2, LARG_ESTRADA, VERMELHO);
        vias.push(seg);
      }
    }
  }
  // ------------------- glebas -------------------
  //
  // Gleba NÃO é divisa interna: na planta de referência da empresa (FAZENDA
  // MAURICÉIA) cada gleba é uma POLIGONAL própria — mesmo azul, mesma espessura
  // da poligonal do terreno — e a legenda não ganha entrada nova, porque gleba
  // não é um tipo de traço: é o imóvel, dividido. Duas glebas separadas pela
  // estrada, cada uma com a sua linha dupla vermelha na borda que a encosta.
  //
  // Todo este bloco vive atrás da guarda: sem gleba, nenhuma linha daqui executa
  // e o PDF sai igual ao de antes (lacrado em nao_regressao_completo.test.mjs).
  const rotulosGleba: Ret[] = [];
  const divisasGleba: Seg[] = [];
  // Em modo PARTES as glebas são as próprias partes: as linhas já saíram do
  // laço dos anéis; aqui só entrariam de novo, por cima. O bloco de
  // identificação e o quadro analítico por parte continuam mais abaixo.
  for (const [gi, gl] of (partes.length ? [] : glebas).entries()) {
    const gv = gl.vertices;
    const viasGl = new Set(gl.viasIdx ?? []);
    const riosGl = new Set(gl.riosIdx ?? []);

    // "fora" da gleba pelo sentido do PRÓPRIO anel dela, como no perímetro:
    // é o que joga a linha dupla da estrada para o lado certo mesmo em gleba
    // côncava, onde o centro da folha apontaria para dentro.
    let giroG = 0;
    for (let k = 0; k < gv.length; k++) {
      const u = gv[k], w = gv[(k + 1) % gv.length];
      giroG += X(u.e) * Y(w.n) - X(w.e) * Y(u.n);
    }
    const sg = giroG >= 0 ? 1 : -1;

    for (let i = 0; i < gv.length; i++) {
      const a = gv[i], b = gv[(i + 1) % gv.length];
      const p = { x: X(a.e), y: Y(a.n) }, q = { x: X(b.e), y: Y(b.n) };

      // A estrada que separa uma gleba da outra encosta nas DUAS, e cada uma
      // leva a sua dupla vermelha por fora. Desenhar a via só no perímetro era
      // o que deixava a estrada do meio "encavalada". Vale igual para o rio,
      // que também pode ser o que separa uma gleba da outra — e, como no
      // perímetro, rio vence estrada.
      if (riosGl.has(i)) {
        const dx = q.x - p.x, dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = sg * dy / len, nyy = -sg * dx / len;
        obj(c, `rio-gleba:${gi}`, "rio", `Rio — ${gl.nome}`);
        for (const off of [5, 11]) {
          const seg = { x1: p.x + nx * off, y1: p.y + nyy * off, x2: q.x + nx * off, y2: q.y + nyy * off };
          linha(c, seg.x1, seg.y1, seg.x2, seg.y2, 2.8, AZUL_RIO);
          obstaculos.push(seg);
          vias.push(seg);
        }
      }

      obj(c, "terreno", "terreno", "Traçado do terreno", true);
      linha(c, p.x, p.y, q.x, q.y, 3.4, AZUL);
      const seg = { x1: p.x, y1: p.y, x2: q.x, y2: q.y };
      obstaculos.push(seg);
      divisasGleba.push(seg);
      // estrada da gleba: a mesma linha vermelha única, por cima da azul
      if (viasGl.has(i) && !riosGl.has(i)) {
        obj(c, `estrada-gleba:${gi}`, "estrada", `Estrada — ${gl.nome}`);
        linha(c, p.x, p.y, q.x, q.y, LARG_ESTRADA, VERMELHO);
        vias.push(seg);
      }
    }
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
  // RIO só entra na legenda quando existe rio no desenho, e aí a caixa cresce
  // uma linha. Listar um traço que não está na folha é pior que não listar: o
  // cliente procura na planta o que a legenda promete. (ESTRADA é herança da
  // planta de referência e continua fixa.)
  const temRio = d.trechos.some((t) => t.isRio) || glebas.some((g) => (g.riosIdx?.length ?? 0) > 0);
  // Gleba NÃO ganha entrada na legenda: ela sai como POLIGONAL DO TERRENO,
  // que já está listada. Foi assim que a planta de referência resolveu, e é
  // coerente — a gleba é o imóvel dividido, não um traço de outro tipo.
  const itensLegenda: [ReturnType<typeof rgb>, string][] = [
    [VERMELHO, "ESTRADA"],
    ...(temRio ? [[AZUL_RIO, "RIO / CURSO D'ÁGUA"] as [ReturnType<typeof rgb>, string]] : []),
    [AZUL, "POLIGONAL DO TERRENO"], [VERDE, "DIVISÕES DAS CONFRONTAÇÕES"], [CINZA, "MALHA DE COORDENADA"],
  ];
  // a abreviatura só se explica se ela aparecer em algum lugar da folha
  const abrevLegenda = exibe.matricula ? (posse ? "POSSE = IMÓVEL SEM MATRÍCULA" : "MATR. = MATRÍCULA") : null;
  // a estrada é a vermelha SOBRE a azul — a amostra mostra o mesmo par
  const amostraLegenda = (cor: ReturnType<typeof rgb>, x: number, y: number, comp: number) => {
    if (cor === VERMELHO) {
      linha(c, x, y, x + comp, y, 3.4, AZUL);
      linha(c, x, y, x + comp, y, LARG_ESTRADA, VERMELHO);
    } else {
      linha(c, x, y, x + comp, y, 3.4, cor);
    }
  };
  const legendaRet: Ret = {
    x1: dArea.x + 6, y1: dArea.y + 2,
    x2: dArea.x + 6 + 300, y2: dArea.y + 2 + 124 + (temRio ? 20 : 0),
  };
  // Só no arranjo simples (A4) a legenda fica no desenho: no A1/A3 ela mora no
  // PLANIMÉTRICO da barra lateral, como na planta de referência (2026-10-14),
  // e o canto fica livre para o polígono. Pelo mesmo pedido a logo voltou à
  // seção CARIMBO DA EMPRESA da barra e saiu do canto do desenho.
  if (simples) ocupado.push(legendaRet);
  // Os nomes das glebas já estão na folha: reservá-los agora impede que um
  // código de vértice caia por cima — o código cede, como cede para a legenda.
  ocupado.push(...rotulosGleba);
  // Só o bolinha e o tique saem agora. O CÓDIGO fica reservado e é desenhado
  // depois dos nomes dos vizinhos: quem cede lugar é ele, não o confrontante.
  // Antes era ao contrário — os códigos entravam em `ocupado` primeiro e o bloco
  // do vizinho tinha de se virar em volta deles.
  const codigosPendentes: { codigo: string; lx: number; ly: number; ret: Ret }[] = [];
  const marcos: Seg[] = [];
  for (const [ai, A] of aneis.entries()) {
    const { vs, nv, normalAresta, normalVertice, trechos: trechosAnel } = A;
    const marcosAntes = marcos.length;
  for (let i = 0; i < nv; i++) {
    const v = vs[i];
    obj(c, "terreno", "terreno", "Traçado do terreno", true);
    page.drawCircle({ x: X(v.e), y: Y(v.n), size: 1.4, color: PRETO });
    // fora do polígono pela bissetriz das duas arestas, não pelo centro da folha
    const { x: nx, y: ny } = normalVertice(i);
    // tique do marco, como na planta de referência
    const tique = {
      x1: X(v.e) + nx * 2, y1: Y(v.n) + ny * 2,
      x2: X(v.e) + nx * 6, y2: Y(v.n) + ny * 6,
    };
    obj(c, `tique:${ai}:${i}`, "tique", `Tique — ${v.codigo}`);
    linha(c, tique.x1, tique.y1, tique.x2, tique.y2, 0.9);
    // o tique é linha do desenho como qualquer outra: nenhum rótulo passa por cima
    obstaculos.push(tique);
    // Vértice compartilhado por duas glebas (divisa interna, ponto de partilha)
    // passa aqui uma vez por anel: o código sai uma vez só, senão vira borrão.
    if (v.codigo && codigosPendentes.some((cp) => cp.codigo === v.codigo)) continue;
    const w = f.widthOfTextAtSize(v.codigo, VERT_TAM);
    const lx = nx < 0 ? X(v.e) + nx * 8 - w : X(v.e) + nx * 8;
    const ly = Y(v.n) + ny * 8 - VERT_TAM / 2;
    codigosPendentes.push({
      codigo: v.codigo, lx, ly,
      ret: { x1: lx - 1.5, y1: ly - 1.5, x2: lx + w + 1.5, y2: ly + VERT_TAM + 1.5 },
    });
  }

  // ------------------- marco de divisão: um por vértice M -------------------
  // Todo M é a troca de um confrontante para o outro, então todo M ganha o seu
  // traço verde. Isto é um laço próprio, sobre `d.trechos` cru, de propósito: o
  // desenho antigo saía de dentro do laço de rótulos, que (a) pula os trechos de
  // faixa de domínio no `continue` e (b) funde trechos vizinhos de mesmo
  // confrontante. Na LAGOA SECA, dos três M só o M-4501 (único não-via) recebia
  // marco — os outros dois sumiam e a planta não dizia onde cada divisa começa e
  // termina. Ver ARQUITETURA-TRECHOS.md.
  for (const t of trechosAnel) {
    if (t.interno) continue;   // divisa entre glebas: sem marco
    const vm = vs[t.inicioIdx % nv];
    if (!vm) continue;
    const { x: gx, y: gy } = normalVertice(t.inicioIdx % nv);
    const x1 = X(vm.e), y1 = Y(vm.n), x2 = x1 + gx * 50, y2 = y1 + gy * 50;
    obj(c, `marco:${ai}:${t.inicioIdx}`, "marco", `Divisão no ${vm.codigo}`);
    linha(c, x1, y1, x2, y2, 2.8, VERDE);
    marcos.push({ x1, y1, x2, y2 });
  }
  // O traço verde tem 50pt e sai de dentro do vão de um vizinho para o do outro:
  // é o obstáculo mais fácil de um bloco atropelar, e era o único traço do desenho
  // que não estava na lista. Nome de vizinho não invade NADA.
  obstaculos.push(...marcos.slice(marcosAntes));
  // Trechos contíguos do MESMO confrontante viram um único rótulo: no caso real
  // a FAZENDA KAGADOS chegava em 5 trechos seguidos e o bloco de texto saía
  // repetido 5× em volta do polígono.
  const trechosOrd = [...trechosAnel].sort((a, b) => a.inicioIdx - b.inicioIdx);
  const grupos: TrechoPlanta[] = [];
  for (const t of trechosOrd) {
    const ant = grupos[grupos.length - 1];
    if (ant && ant.descritivo === t.descritivo && !!ant.semRotulo === !!t.semRotulo && ant.fimIdx % nv === t.inicioIdx % nv) ant.fimIdx = t.fimIdx;
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
    if (t.interno) continue;   // divisa entre glebas: sem rótulo de confrontante
    if (t.semRotulo) continue; // o operador desmarcou "exibir na planta": só o traço
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
    const compTotal = segLens.reduce((s, l) => s + l, 0);

    /**
     * Âncora do rótulo a `alvoLen` de caminhada sobre a divisa DESTE vizinho.
     *
     * Antes só existia o meio (`alvoLen = comprimento/2`) e o desvio lateral era
     * um passo na direção da aresta do meio. Andar pela divisa é diferente e é o
     * que a regra sempre quis dizer: o nome continua no vão do MESMO vizinho, e
     * a normal e a folga passam a ser as da aresta onde ele realmente parou.
     * Sem isso, num trecho de 6.001 m o desvio saía com a normal da aresta
     * errada — sem chance de encontrar espaço em imóvel com reentrância.
     */
    const ancoraEm = (alvoLen: number) => {
      let resta = Math.max(0, Math.min(alvoLen, compTotal));
      let ax = X(vs[idxs[0] % nv].e), ay = Y(vs[idxs[0] % nv].n), ang = 0;
      let idxAresta = idxs[0] % nv;
      for (const [k, i] of idxs.entries()) {
        if (resta <= segLens[k] || k === idxs.length - 1) {
          const a = vs[i], b = vs[(i + 1) % nv];
          idxAresta = i;
          if (a && b) {
            const fr = segLens[k] > 0 ? resta / segLens[k] : 0;
            ax = X(a.e) + (X(b.e) - X(a.e)) * fr;
            ay = Y(a.n) + (Y(b.n) - Y(a.n)) * fr;
            ang = Math.atan2(Y(b.n) - Y(a.n), X(b.e) - X(a.e)) * 180 / Math.PI;
          }
          break;
        }
        resta -= segLens[k];
      }
      // rótulo empurrado para fora pela normal da ARESTA onde a âncora caiu: em
      // imóvel côncavo o vetor a partir do centro da folha apontava para dentro,
      // e o bloco do vizinho ia parar em cima da área do imóvel
      const n = normalAresta(idxAresta);
      // ------------------- quanto cabe DE FATO para fora -------------------
      // A normal externa só garante "para fora" num passo infinitesimal. Onde a
      // aresta faz fronteira com uma reentrância estreita, andar a distância da
      // regra atravessa a divisa vizinha e o rótulo reaparece DENTRO da fazenda.
      //
      // Foi o que aconteceu no trecho do M-4640 da FAZENDA RIACHO DA CRUZ:
      // 6.001 m de divisa, meio caindo na aresta 26→27, folga real de 279,5 m
      // para fora e afastamento de regra de 281 m — 1,5 m além do ponto de
      // reentrada, e o nome do vizinho aparecia no meio da fazenda.
      //
      // O corte só age quando a regra NÃO caberia; onde há espaço, o afastamento
      // continua sendo exatamente o de sempre e a planta não muda em nada.
      // Quando age, planta o rótulo a 45% do corredor: perto o bastante da
      // divisa dele para continuar apontando a divisa certa, longe o bastante da
      // que fecha o corredor por trás.
      const folga = distanciaAteDivisa({ x: ax, y: ay }, n, aneisTela);
      return {
        mx: ax, my: ay, nx: n.x, ny: n.y, angSeg: ang,
        cabe: (afastRegra: number) => (folga < afastRegra ? 0.45 * folga : afastRegra),
      };
    };

    const meioTrecho = ancoraEm(compTotal / 2);
    const { mx, my, nx, ny, angSeg } = meioTrecho;
    const cabeNoCorredor = meioTrecho.cabe;

    if (t.isEstrada || t.isRio) {
      // Nome da via rotacionado ao longo do segmento, empurrado para fora até não
      // cobrir a linha dupla vermelha nem o polígono. O rio usa o mesmo rótulo:
      // "RIO ITAPICURU" acompanha o curso d'água como "BA 408" acompanha a
      // estrada — é um traço de faixa, não um vizinho com bloco de nome e CPF.
      const nome = linhasDescritivo(t.descritivo)[0] ?? "";
      const rot = angSeg > 90 || angSeg < -90 ? angSeg + 180 : angSeg;
      // o texto é desenhado a partir da origem; recuar meia largura NA DIREÇÃO DA
      // ROTAÇÃO centraliza o nome sobre o meio do trecho
      const ra = rot * Math.PI / 180;
      // Mesma regra do bloco do confrontante, na medida proporcional: o nome fica
      // no meio da via, encostado nela, e é o corpo que cede para caber. Já é
      // centrado por construção — acompanha a própria estrada, não desliza.
      const AFAST_VIA = cabeNoCorredor(Math.max(16, 0.026 * diagPoly));
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
      const esc = melhorLivre(cands, obstaculos, ocupado, FOLGA, aneisTela)
        ?? menosPior(cands, obstaculos, ocupado, FOLGA, aneisTela);
      obj(c, `via:${ai}:${t.inicioIdx}`, "rotulo-via", nome);
      texto(c, nome, esc.x, esc.y, esc.tam, { bold: true, cor: PRETO, rot });
      ocupado.push(esc.ret);
      rotulosTrecho.push(esc.ret);
      corposTrecho.push(esc.tam);
      obbsTrecho.push(esc.obb);
      continue;
    }
    // ---- confrontante NUMERADO: só o número, no lugar do bloco de nome ----
    // Mesma âncora e mesma regra de posição do bloco de texto — meio da divisa,
    // para fora, à distância proporcional. O que muda é o tamanho do que se
    // posiciona: um disco de 24pt no lugar de um bloco de 310×90, e aí a busca
    // acha lugar livre onde o bloco não achava. O texto do vizinho não some:
    // está inteiro no quadro CONFRONTANTES do rodapé, com este mesmo número.
    const numero = numeroDe.get(chaveConfrontante(t.descritivo));
    if (numero !== undefined) {
      const NUM_TAM = 17, R = 12;
      const rotulo = String(numero);
      const AFASTS_N = [1, 1.2, 1.45, 1.75, 2.1, 2.5];
      const DESLS_N = [0, 0.2, -0.2, 0.4, -0.4];
      const AFAST_N_REGRA = Math.max(22, 0.052 * diagPoly);
      // mesma regra do bloco: o desvio anda pela divisa do vizinho, e a normal e
      // a folga saem da aresta onde o número realmente parou
      const candsN = DESLS_N.flatMap((desl, di) => {
        const anc = ancoraEm(compTotal * (0.5 + desl * 0.4));
        return AFASTS_N.map((fa, ai) => {
        const mgN = anc.cabe(AFAST_N_REGRA) * fa;
        let cxN = anc.mx + anc.nx * mgN;
        let cyN = anc.my + anc.ny * mgN;
        cxN = Math.max(dArea.x + R + 2, Math.min(cxN, dArea.x + dArea.w - R - 2));
        cyN = Math.max(dArea.y + R + 2, Math.min(cyN, dArea.y + dArea.h - R - 2));
        return {
          cx: cxN, cy: cyN,
          // mesmo espírito do bloco: sair do meio da divisa custa mais que
          // afastar-se dela, porque um número fora do vão aponta divisa errada
          custo: 2000 * Math.ceil(di / 2) + 100 * ai,
          ret: { x1: cxN - R, y1: cyN - R, x2: cxN + R, y2: cyN + R },
        };
        });
      });
      const escN = melhorLivre(candsN, obstaculos, ocupado, FOLGA, aneisTela)
        ?? menosPior(candsN, obstaculos, ocupado, FOLGA, aneisTela);
      // disco branco OPACO: o número cai sobre a malha de coordenadas tanto
      // quanto o bloco caía, e um dígito sobre linha tracejada não se lê
      obj(c, `num:${ai}:${t.inicioIdx}`, "rotulo-numero", `Confrontante ${rotulo}`);
      page.drawCircle({ x: escN.cx, y: escN.cy, size: R, color: rgb(1, 1, 1), borderColor: PRETO, borderWidth: 1.4 });
      texto(c, rotulo, escN.cx, escN.cy - NUM_TAM * 0.35, NUM_TAM, { bold: true, center: true });
      ocupado.push(escN.ret);
      rotulosTrecho.push(escN.ret);
      corposTrecho.push(NUM_TAM);
      obbsTrecho.push(undefined);
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
    const AFAST_REGRA = Math.max(22, 0.052 * diagPoly);
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
    // Caminhada PELA DIVISA do vizinho, ÚLTIMO recurso — e só existe porque
    // "não invadir" ganha de "ficar no meio". No ADERLÂNDIO REIS MOTA (serviço
    // ff198218) a divisa fica no fundo de um "V" côncavo: a normal do meio do
    // trecho aponta para dentro da própria reentrância, e nenhuma distância nem
    // nenhum corpo limpa a aresta vizinha. Sem esta saída o rótulo era desenhado
    // POR CIMA da linha, que é pior que sair um pouco do centro.
    //
    // Cada valor é uma fração de ±0,4 do comprimento da divisa (ver `ancoraEm`),
    // então o nome nunca chega ao vão do vizinho de baixo. O peso garante que só
    // entre quando nada centrado estiver livre: 2000 por passo contra 909 do
    // pior caso centrado.
    const DESLS = [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8];
    const cands: { lbl: string[]; lx: number; ty: number; tam: number; esp: number; desl: number; custo: number; ret: Ret }[] = [];
    for (const [di, desl] of DESLS.entries()) {
      // O desvio ANDA PELA DIVISA do próprio vizinho — a âncora é recalculada em
      // `desl` × 0,4 do comprimento dele, e com ela vêm a normal e a folga da
      // aresta onde o rótulo de fato parou. Deslizar na direção da aresta do
      // MEIO, como era antes, mandava o bloco para um lado usando a geometria do
      // outro: num trecho de 6.001 m com reentrância, nenhum candidato desviado
      // achava espaço porque todos herdavam o corredor estreito do meio.
      const anc = ancoraEm(compTotal * (0.5 + desl * 0.4));
      for (const [ai, fa] of AFASTS.entries()) {
        for (const [ei, escala] of ESCALAS.entries()) {
          const tam = LBL_TAM * escala, esp = LBL_ESP * escala;
          const lbl = quebrarLinhas(linhasDescritivo(t.descritivo), maxW, tam, f);
          const blockW = Math.max(...lbl.map((l) => f.widthOfTextAtSize(l, tam)));
          const altura = lbl.length * esp;
          const MG = anc.cabe(AFAST_REGRA) * fa;
          // âncora do trecho, empurrada para fora; o bloco é centrado nesse ponto
          let lx = anc.mx + anc.nx * MG - blockW / 2;
          let ty = anc.my + anc.ny * MG + altura / 2;
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
    const esc = melhorLivre(cands, obstaculos, ocupado, FOLGA, aneisTela)
      ?? menosPior(cands, obstaculos, ocupado, FOLGA, aneisTela);
    obj(c, `conf:${ai}:${t.inicioIdx}`, "rotulo-confrontante", linhasDescritivo(t.descritivo).find((l) => !l.startsWith("(")) ?? esc.lbl[0] ?? "Confrontante");
    for (const [li, lt] of esc.lbl.entries()) texto(c, lt, esc.lx, esc.ty - li * esc.esp, esc.tam);
    ocupado.push(esc.ret);
    rotulosTrecho.push(esc.ret);
    corposTrecho.push(esc.tam);
    obbsTrecho.push(undefined);
    if (esc.desl !== 0) deslocados++;
  }

  }

  // ------------------- divisões de confrontação + rótulos -------------------
  //
  // No arranjo simples o miolo do polígono leva só a área: matrícula, CNS,
  // proprietário e CPF já estão no selo do rodapé, e repeti-los dentro de um A4
  // cobriria o desenho. Com glebas ele some de vez — cada gleba mostra a sua
  // área e o total fica no canto, como no modelo.
  const centroLinhas = (simples ? (glebas.length ? [] : [`${d.areaFmt} HA`, `${d.tarefasFmt} TAREFAS`]) : [
    ...(exibe.matricula ? [posse ? "(POSSE)" : `(MATR.${d.matricula}/CNS.${d.cns})`] : []),
    ...(exibe.denominacao ? [d.denominacao] : []),
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
  ]).map((l) => l.toUpperCase());
  // bloco do imóvel no centroide — fonte proporcional ao polígono desenhado,
  // p/ o nome interno acompanhar o tamanho da propriedade sem vazar das bordas
  // Em modo PARTES cada parte tem o seu bloco de identificação (o das glebas);
  // o bloco geral não tem anel onde caber.
  if (!partes.length && centroLinhas.length) {
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
    obj(c, "identificacao", "identificacao", "Identificação do imóvel");
    for (const [li, lt] of centroLinhas.entries()) {
      texto(c, lt, bx0, byTopo - tam - li * esp, tam, { bold: li === 1 });
    }
  }
  // ------------------- códigos dos vértices, por último -------------------
  // Reservados lá em cima e desenhados só agora: o nome do vizinho tem posição
  // fixada por regra, então quem cede é o código. Em divisas com muitos pontos
  // quase alinhados (a face norte do MONOINO tem 13) eles já se suprimiam entre
  // si; agora também cedem ao bloco do confrontante. Nada se perde no fluxo de
  // matrícula — o quadro analítico lista TODOS os vértices.
  //
  // Valem também para a conferência: lá o código é "P-1" (ver
  // DadosPlanta.conferencia), curto e sem cara de oficial.
  for (const [ci, cp] of codigosPendentes.entries()) {
    if (ocupado.some((o) => retCruzaRet(cp.ret, o))) { rotulosOcultos++; continue; }
    ocupado.push(cp.ret);
    obj(c, `cod:${ci}`, "codigo-vertice", cp.codigo);
    texto(c, cp.codigo, cp.lx, cp.ly, VERT_TAM, { cor: PRETO });
  }

  // ------------------- metragem dos lados (opcional) -------------------
  // Depois de tudo: a medida é o rótulo que cede. Divisa compartilhada por
  // duas glebas sai uma vez só; lado curto demais para o texto fica sem.
  if (d.metragem) {
    const MET_TAM = 9;
    const aneisM: VerticePlanta[][] = glebas.length ? glebas.map((g) => g.vertices) : aneis.map((a) => a.vs);
    const feitos = new Set<string>();
    const chavePt = (v: VerticePlanta) => `${v.e.toFixed(2)},${v.n.toFixed(2)}`;
    for (const [ai, vm] of aneisM.entries()) {
      const nm = vm.length;
      let giro = 0;
      for (let k = 0; k < nm; k++) {
        const u = vm[k], w = vm[(k + 1) % nm];
        giro += X(u.e) * Y(w.n) - X(w.e) * Y(u.n);
      }
      const sg = giro >= 0 ? 1 : -1;
      for (let i = 0; i < nm; i++) {
        const a = vm[i], b = vm[(i + 1) % nm];
        const chave = [chavePt(a), chavePt(b)].sort().join("|");
        if (feitos.has(chave)) continue;
        feitos.add(chave);
        const metros = Math.hypot(b.e - a.e, b.n - a.n);
        const rot = `${a.distFmt || metros.toFixed(2).replace(".", ",")} m`;
        const p = { x: X(a.e), y: Y(a.n) }, q = { x: X(b.e), y: Y(b.n) };
        const dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
        const w = f.widthOfTextAtSize(rot, MET_TAM);
        if (len < 0.5) continue;   // vértices coincidentes: não há lado
        // texto sempre de pé: o ângulo fica em (-90°, 90°]
        let ang = Math.atan2(dy, dx) * 180 / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang <= -90) ang += 180;
        const ar = ang * Math.PI / 180;
        const ux = Math.cos(ar), uy = Math.sin(ar);   // ao longo do texto
        const vx = -uy, vy = ux;                        // "para cima" do texto
        const nx = sg * -dy / len, ny = sg * dx / len;  // para dentro do anel
        // no meio e dentro primeiro; depois desliza pelo lado (o meio de um lado
        // longo costuma ser onde mora o nome da estrada) e só então vai para fora
        let feito = false;
        // lado mais curto que o texto: só o meio (a medida fica centrada nele)
        const folgaT = Math.max(0, Math.min(0.4, (len - w) / (2 * len)));
        const posicoes = [0.5, 0.5 - folgaT * 0.5, 0.5 + folgaT * 0.5, 0.5 - folgaT, 0.5 + folgaT];
        busca: for (const lado of [1, -1]) {
          const ix = nx * lado, iy = ny * lado;
          // o texto cresce para "cima": se isso aponta para fora do lado escolhido, desce a altura dele
          const desce = vx * ix + vy * iy < 0 ? MET_TAM : 0;
          for (const t of posicoes) {
            const mx = p.x + dx * t, my = p.y + dy * t;
            const ox = mx - ux * w / 2 + ix * (3 + desce), oy = my - uy * w / 2 + iy * (3 + desce);
            const ret = inflar(retTextoRot(ox, oy, w, MET_TAM, ang), 0.5);
            if (ocupado.some((o) => retCruzaRet(ret, o))) continue;
            ocupado.push(ret);
            obj(c, `metragem:${ai}:${i}`, "metragem", `Lado ${a.codigo} – ${b.codigo}`);
            texto(c, rot, ox, oy, MET_TAM, { rot: ang });
            feito = true;
            break busca;
          }
        }
        // Todo lado tem de sair medido: sem lugar livre, vai no meio, por
        // dentro, mesmo encostando em outro texto (o operador ajusta no editor).
        if (!feito) {
          const desce = vx * nx + vy * ny < 0 ? MET_TAM : 0;
          const mx = p.x + dx / 2, my = p.y + dy / 2;
          const ox = mx - ux * w / 2 + nx * (3 + desce), oy = my - uy * w / 2 + ny * (3 + desce);
          ocupado.push(inflar(retTextoRot(ox, oy, w, MET_TAM, ang), 0.5));
          obj(c, `metragem:${ai}:${i}`, "metragem", `Lado ${a.codigo} – ${b.codigo}`);
          texto(c, rot, ox, oy, MET_TAM, { rot: ang });
        }
      }
    }
  }

  // ------------------- bússola (rosa dos ventos moderna) -------------------
  // estrela de 8 pontas: pontas cardeais com metades preto/branco (efeito 3D),
  // pontas diagonais menores em cinza, dois anéis com marcações a cada 45°
  {
    // afastada do canto p/ não cobrir os rótulos N=/E= da malha (que ocupam
    // as bordas), e maior p/ acompanhar a nova escala dos textos
    const R = 58;
    // canto livre: preferência pelo superior esquerdo (padrão da planta de
    // referência), depois os outros cantos se lá já houver polígono ou rótulo
    // — o inferior esquerdo só existe fora do A4, onde a legenda não está nele
    const margem = R + 22;
    const cantos: [number, number][] = [
      [dArea.x + margem, dArea.y + dArea.h - margem],
      [dArea.x + dArea.w - margem, dArea.y + dArea.h - margem],
      [dArea.x + dArea.w - margem, dArea.y + margem],
      ...(simples ? [] : [[dArea.x + margem, dArea.y + margem] as [number, number]]),
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
    obj(c, "bussola", "bussola", "Rosa dos ventos");
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
  // Só existe no arranjo completo (A1/A3). No simples, cada seção abaixo se
  // desliga e o que sobrevive — carimbo, planta de situação e os campos do selo
  // — reaparece na FAIXA INFERIOR, logo depois desta seção.
  //
  // Arranjo e corpos da planta de referência da D'Prol (pedido de 2026-10-14):
  // QUADRO ANALÍTICO · PLANTA DE SITUAÇÃO · CARIMBO DA EMPRESA (a logo, grande)
  // · PLANIMÉTRICO (legenda + campos do imóvel) · RT e selos · rodapé. A folha
  // é A1: um texto de 9–12 pt já se lê na prancheta; os 20–26 pt de antes
  // saíam desproporcionais na impressão e roubavam espaço da situação.
  const sbBot = 20, sbTop = sbBot + (H - 40) / SB_K;
  // x' = sbX + (x − sbX)·K, y' = sbBot + (y − sbBot)·K: a barra cresce a partir
  // do canto inferior esquerdo dela, e tudo abaixo desenha como se K fosse 1
  if (!simples && SB_K !== 1) {
    page.pushOperators(pushGraphicsState(), concatTransformationMatrix(SB_K, 0, 0, SB_K, sbX * (1 - SB_K), sbBot * (1 - SB_K)));
  }
  // A1 e A3 são dois MODELOS, não só dois tamanhos (pedido de 2026-09-03): o A1
  // leva o quadro analítico; o A3 não — as demais seções ganham o espaço dele.
  // Quem decide é a folha escolhida, não o tipo do imóvel: posse continua
  // caindo em A3 por padrão (regra de `folha` acima), mas posse em A1 ganha o
  // quadro, e matrícula em A3 sai sem. A conferência segue o modelo sem quadro
  // em qualquer folha: é a prévia — o quadro é a tabela que o SIGEF confere, e
  // a prévia ainda não passou por ele.
  const semQuadro = folha !== "A1" || !!d.conferencia;
  const sbH = sbTop - sbBot;
  const SEC_TIT = 28;
  const secao = (yBase: number, h: number, titulo: string) => caixaTitulo(c, sbX, yBase, SB_W, h, titulo, SEC_TIT, 16);

  // As seções são medidas pelo CONTEÚDO (pedido de 2026-09-10). Fixas:
  // carimbo, planimétrico e rodapé. A Planta de Situação recebe a altura da
  // imagem na largura inteira da barra, e o quadro analítico fica com o resto
  // — mostrando mais vértices quando há espaço, como a referência, que lista o
  // imóvel inteiro.
  //
  // QUADRO ANALÍTICO: linha fixa (QUADRO_ROW_H) no corpo legível; o mínimo
  // garantido é QUADRO_MIN_LINHAS por tabela (uma por gleba, ou uma do imóvel)
  // e o que não couber é remetido ao memorial tabular numa nota. Antes da
  // linha fixa o quadro encolhia até 5,5 pt para caber tudo — ilegível.
  const QUADRO_MIN_LINHAS = 10, QUADRO_ROW_H = 13, QUADRO_HEAD_H = 16, QUADRO_TIT_H = 13, QUADRO_NOTA_H = 14;
  const blocosQuadro = glebas.length ? glebas.map((g) => g.vertices.length) : [vs.length];
  // `medirQuadro` e `dispTotal` (no desenho) fazem a MESMA conta: uma diferença
  // de 2 pt já comia a última linha por arredondamento.
  const medirQuadro = (linhas: number[], nota: boolean) => SEC_TIT + 6
    + linhas.reduce((a, n) => a + n * QUADRO_ROW_H + QUADRO_HEAD_H + 6, 0)
    + (glebas.length ? linhas.length * QUADRO_TIT_H : 0)
    + (nota ? QUADRO_NOTA_H : 0) + 8;
  const quadroTodas = medirQuadro(blocosQuadro, false);
  const quadroMin = medirQuadro(blocosQuadro.map((n) => Math.min(n, QUADRO_MIN_LINHAS)), blocosQuadro.some((n) => n > QUADRO_MIN_LINHAS));

  // CARIMBO DA EMPRESA: só com logo. Sem ela a seção não sai vazia — a
  // situação herda o espaço.
  const hCarimbo = d.logo ? 190 : 0;

  // RODAPÉ: UMA linha de células, corpo pequeno (pedido de 2026-10-14 — quase
  // tudo ali já está em outro ponto da folha). Com glebas a célula de ÁREA e a
  // de PERÍMETRO listam uma linha por gleba, e só aí a linha cresce.
  const RODAPE_PASSO = 9;
  const linhasRodape = Math.max(2, glebas.length);
  const hRodape = 11 + linhasRodape * RODAPE_PASSO + 5;

  // ASSINATURAS E SELOS (fim do planimétrico): o RT e o(s) proprietário(s)
  // assinam sobre a linha, e embaixo de cada assinatura há uma caixa SELO DE
  // RECONHECIMENTO em branco, alta o bastante para o carimbo do cartório —
  // como na planta de referência (pedido de 2026-10-14: antes eram caixinhas
  // com o nome dentro, sem lugar para carimbar).
  const assinantes = d.proprietarios.slice(0, 2);
  const ASSIN_CAP = 30, ASSIN_BLOCO = 28, ASSIN_ENTRE = 20, ASSIN_ESPOLIO = 18;
  const altAssinProp = ASSIN_CAP + assinantes.reduce((a, p, i) =>
    a + ASSIN_BLOCO + (p.isEspolio && p.inventarianteNome ? ASSIN_ESPOLIO : 0) + (i > 0 ? ASSIN_ENTRE : 0), 0);
  const ASSIN_H = Math.max(ASSIN_CAP + 44, altAssinProp) + 6;
  const SELO_CART_H = 118;

  // PLANIMÉTRICO: legenda em duas colunas, campos em duas colunas (passo 25) e
  // a faixa das assinaturas e dos selos.
  const PLANI_BAND_H = ASSIN_H + SELO_CART_H, CAMPO_PASSO = 25;
  const nLegenda = itensLegenda.length + (abrevLegenda ? 1 : 0);
  const hLegenda = 16 + Math.ceil(nLegenda / 2) * 13 + 6;
  const nCamposDir = (exibe.trt ? 1 : 0) + (exibe.matricula ? (posse ? 1 : 2) : 0) + 2;
  const altPropr = 13 + d.proprietarios.reduce((a, p) => a + 24 + (p.isEspolio && p.inventarianteNome ? 24 : 0), 0);
  const altEsq = (exibe.denominacao ? CAMPO_PASSO : 0) + altPropr;
  const medirPlani = (passo: number) => SEC_TIT + hLegenda + 14 + Math.max(nCamposDir * passo, altEsq) + 8 + PLANI_BAND_H;
  let hPlani = Math.min(medirPlani(CAMPO_PASSO), sbH * 0.4);
  // piso: os campos da direita ainda cabem com passo 20 (o desenho adapta o passo)
  const pisoPlani = Math.min(hPlani, medirPlani(20));

  // PLANTA DE SITUAÇÃO: a imagem ocupa a largura da barra; a seção pede a
  // altura correspondente, com um mínimo. Se nem o mínimo sobrar, o
  // planimétrico aperta o passo dos campos até o piso; só depois o quadro cede
  // (e aí as linhas são cortadas com a nota).
  const satImg = d.satelite
    ? await embutirImagem(pdf, page, d.satelite.bytes, d.satelite.tipo)
    : null;
  const SITUACAO_MIN = sbH * 0.14;
  const situacaoAlvo = Math.max(SITUACAO_MIN, SEC_TIT + 12 + (satImg ? (SB_W - 12) * satImg.height / satImg.width : 200));
  const fixos = hCarimbo + hPlani + hRodape;
  let hQuadro = 0;
  if (!semQuadro) {
    const livre = sbH - fixos - situacaoAlvo;
    hQuadro = Math.min(quadroTodas, sbH * 0.6, Math.max(livre, Math.min(quadroMin, sbH * 0.5)));
  }
  let hSituacao = sbH - fixos - hQuadro;
  if (hSituacao < SITUACAO_MIN) {
    const falta = SITUACAO_MIN - hSituacao;
    const cedePlani = Math.min(falta, Math.max(0, hPlani - pisoPlani));
    hPlani -= cedePlani;
    const cedeQuadro = Math.min(falta - cedePlani, Math.max(0, hQuadro - sbH * 0.30));
    hQuadro -= cedeQuadro;
    hSituacao = sbH - hCarimbo - hPlani - hRodape - hQuadro;
  }
  let yCursor = sbTop;

  // ---- QUADRO ANALÍTICO (tabela com grade, colunas centradas) ----
  if (!semQuadro && !simples) {
    const h = hQuadro;
    const base = yCursor - h;
    obj(c, "quadro", "quadro", "Quadro analítico");
    const topoUtil = secao(base, h, "QUADRO ANALÍTICO");
    const heads = ["VÉRTICE", "LADO", "LONGITUDE", "LATITUDE", "AZIMUTE", "DIST.(m)", "ALTIT."];
    const cols = [68, 136, 80, 80, 62, 54, 44];
    const tw = cols.reduce((a, b) => a + b, 0);
    const tx0 = sbX + (SB_W - tw) / 2;
    const headH = QUADRO_HEAD_H;
    const tableTop = topoUtil - 6;
    // Com glebas, o quadro vira UMA TABELA POR GLEBA, cada uma com o seu
    // cabeçalho — é o que a planta de referência faz. Sem glebas, uma tabela só
    // com o anel do imóvel.
    const blocos: { titulo: string | null; linhas: VerticePlanta[] }[] = glebas.length
      ? glebas.map((g) => ({ titulo: g.nome, linhas: g.vertices }))
      : [{ titulo: null, linhas: vs }];
    const TIT_H = QUADRO_TIT_H;
    const rowH = QUADRO_ROW_H;
    const tamCel = 7.5;
    // Se nem tudo cabe, o corte é PROPORCIONAL: cada tabela perde a mesma
    // fração, e todas aparecem.
    const rodapeNota = h < quadroTodas - 0.5 ? QUADRO_NOTA_H : 0;
    const dispTotal = tableTop - base - 8 - rodapeNota
      - blocos.length * (headH + 6) - blocos.filter((b) => b.titulo).length * TIT_H;
    const totalLinhas = blocos.reduce((s2, b) => s2 + b.linhas.length, 0);
    const fatorCabe = Math.min(1, dispTotal / Math.max(1, totalLinhas * rowH));

    let cursorQ = tableTop;
    let cortadas = 0;
    for (const bloco of blocos) {
      // Sem espaço nem para o cabeçalho e uma linha, a tabela NÃO é desenhada:
      // o que ficou de fora entra na nota de cortadas.
      const espacoBloco = cursorQ - (bloco.titulo ? TIT_H : 0) - headH - base - 8 - rodapeNota;
      if (espacoBloco < rowH) { cortadas += bloco.linhas.length; continue; }
      if (bloco.titulo) {
        texto(c, bloco.titulo, tx0, cursorQ - 9, 8.5, { bold: true });
        cursorQ -= TIT_H;
      }
      const espaco = cursorQ - headH - base - 8 - rodapeNota;
      const cabem = Math.min(bloco.linhas.length, Math.max(1, Math.floor(espaco / rowH + 1e-6)),
        Math.max(1, Math.floor(bloco.linhas.length * fatorCabe + 1e-6)));
      const linhasQ = bloco.linhas.slice(0, cabem);
      cortadas += bloco.linhas.length - linhasQ.length;
      const topo = cursorQ;
      const bot = topo - headH - linhasQ.length * rowH;

      caixa(c, tx0, bot, tw, topo - bot, 0.8);
      linha(c, tx0, topo - headH, tx0 + tw, topo - headH, 0.8);
      let vx = tx0;
      for (const w of cols.slice(0, -1)) { vx += w; linha(c, vx, bot, vx, topo, 0.5); }
      for (let r = 1; r < linhasQ.length; r++) {
        const ly = topo - headH - r * rowH;
        linha(c, tx0, ly, tx0 + tw, ly, 0.3, CINZA);
      }
      let hx = tx0;
      for (const [i, hh] of heads.entries()) {
        texto(c, hh, hx + cols[i] / 2, topo - headH + 5, 7, { bold: true, center: true });
        hx += cols[i];
      }
      for (const [r, v] of linhasQ.entries()) {
        const vals = [v.codigo, `${v.codigo}-${v.vante}`, v.lonFmt, v.latFmt, v.azFmt, v.distFmt, v.alt];
        const ty = topo - headH - (r + 1) * rowH + (rowH - tamCel) / 2 + 1;
        let cx2 = tx0;
        for (const [i, val] of vals.entries()) { textoFit(c, val, cx2 + cols[i] / 2, ty, tamCel, cols[i] - 4, { center: true }); cx2 += cols[i]; }
      }
      cursorQ = bot - 6;
    }
    if (cortadas > 0) {
      texto(c, `Demais ${cortadas} vértices: ver MEMORIAL TABULAR (aqui só os primeiros${glebas.length ? " de cada gleba" : ""})`,
        tx0, Math.max(cursorQ - 4, base + 8), 7.5, { cor: CINZA });
    }
    yCursor -= h;
  }

  // ---- PLANTA DE SITUAÇÃO (imagem de satélite enviada na geração) ----
  if (!simples) {
    const h = hSituacao;
    obj(c, "situacao", "situacao", "Planta de situação");
    const topoUtil = secao(yCursor - h, h, "PLANTA DE SITUAÇÃO");
    if (satImg) {
      const maxW = SB_W - 12, maxH = topoUtil - (yCursor - h) - 12;
      const sc = Math.min(maxW / satImg.width, maxH / satImg.height);
      // centrada na altura: quando o quadro já mostra todos os vértices (ou no
      // A3, sem quadro) a seção fica mais alta que a imagem na largura cheia, e
      // encostada no topo deixava um vão branco embaixo
      page.drawImage(satImg, {
        x: sbX + (SB_W - satImg.width * sc) / 2,
        y: (yCursor - h) + 6 + (maxH - satImg.height * sc) / 2,
        width: satImg.width * sc, height: satImg.height * sc,
      });
    } else {
      textoFit(c, "(imagem de satélite indisponível — veja o aviso da geração)", sbX + SB_W / 2, yCursor - h / 2, 11, SB_W - 24, { cor: CINZA, center: true });
    }
    yCursor -= h;
  }

  // ---- CARIMBO DA EMPRESA (logo grande, centrada) ----
  if (!simples && d.logo) {
    const h = hCarimbo;
    const base = yCursor - h;
    obj(c, "carimbo", "carimbo", "Carimbo da empresa");
    const topoUtil = secao(base, h, "CARIMBO DA EMPRESA");
    const img = await embutirImagem(pdf, page, d.logo.bytes, d.logo.tipo);
    const maxW = SB_W - 80, maxH = topoUtil - base - 24;
    const sc = Math.min(maxW / img.width, maxH / img.height);
    page.drawImage(img, {
      x: sbX + (SB_W - img.width * sc) / 2,
      y: base + (topoUtil - base - img.height * sc) / 2,
      width: img.width * sc, height: img.height * sc,
    });
    yCursor -= h;
  }

  // ---- PLANIMÉTRICO ----
  if (!simples) {
    const h = hPlani;
    const base = yCursor - h;
    obj(c, "planimetrico", "planimetrico", "Planimétrico");
    const topoUtil = secao(base, h, "PLANIMÉTRICO DO IMÓVEL GEORREFERENCIADO");
    const colEsq = sbX + 12, colDir = sbX + SB_W / 2 + 8;
    const colW = SB_W / 2 - 20;

    // legenda em duas colunas, logo abaixo do título (como na referência, a
    // legenda é parte do planimétrico)
    texto(c, "LEGENDAS / ABREVIATURAS", colEsq, topoUtil - 12, 8, { bold: true });
    const legW = (SB_W - 24) / 2;
    const legItens: [ReturnType<typeof rgb> | null, string][] = [...itensLegenda, ...(abrevLegenda ? [[null, abrevLegenda] as [null, string]] : [])];
    for (const [i, [cor, nome]] of legItens.entries()) {
      const lx = colEsq + (i % 2) * legW;
      const ly = topoUtil - 16 - (Math.floor(i / 2) + 1) * 13 + 3;
      if (cor) {
        amostraLegenda(cor, lx, ly + 2.5, 26);
        texto(c, nome, lx + 32, ly, 7.5);
      } else {
        texto(c, nome, lx, ly, 7.5);
      }
    }
    linha(c, sbX, topoUtil - hLegenda, sbX + SB_W, topoUtil - hLegenda, 0.5);

    // rótulo pequeno em cinza + valor logo abaixo, encolhendo se preciso
    const campo = (rot: string, val: string, x: number, y: number) => {
      texto(c, rot, x, y, 7.5, { bold: true, cor: CINZA });
      textoFit(c, val, x, y - 11, 10.5, colW);
    };
    // Cada campo omitido não deixa buraco: some da lista e os de baixo sobem.
    // A coluna da direita mede a partir do topo fixo, não do cursor da esquerda
    // — senão esconder a denominação empurraria os campos do imóvel para baixo.
    const pyTopo = topoUtil - hLegenda - 14;
    let py = pyTopo;
    // Passo entre campos proporcional ao que sobra acima da faixa do RT: com o
    // quadro crescido o bloco encolhe, e a passo fixo o "Município/UF" caía
    // por cima do selo do cartório.
    const passo = Math.max(20, Math.min(CAMPO_PASSO, (pyTopo - (base + PLANI_BAND_H) - 8) / nCamposDir));
    if (exibe.denominacao) { campo("Denominação:", d.denominacao.toUpperCase(), colEsq, pyTopo); py -= passo; }
    // coluna direita: TRT + campos do imóvel (na posse não há matrícula nem
    // cartório: o campo indica POSSE e o CNS sai)
    const camposDir: [string, string][] = [
      ...(exibe.trt ? [["TRT:", d.trt] as [string, string]] : []),
      ...(exibe.matricula
        ? posse
          ? [["Matrícula do Imóvel:", "POSSE"] as [string, string]]
          : [["Matrícula do Imóvel:", d.matricula], ["Código do Cartório (CNS):", d.cns]] as [string, string][]
        : []),
      ["Código INCRA:", d.sncr],
      ["Município/UF:", d.municipioUf.toUpperCase()],
    ];
    for (const [i, [rot, val]] of camposDir.entries()) campo(rot, val, colDir, pyTopo - i * passo);
    texto(c, posse ? "Posseiro(s):" : "Proprietário(s):", colEsq, py, 7.5, { bold: true, cor: CINZA });
    let ppy = py - 12;
    for (const p of d.proprietarios) {
      textoFit(c, p.nome.toUpperCase(), colEsq, ppy, 10, colW, { bold: true });
      textoFit(c, `CPF: ${p.cpf}`, colEsq, ppy - 11, 9, colW);
      ppy -= 24;
      if (p.isEspolio && p.inventarianteNome) {
        textoFit(c, `REP. P/ INV.: ${p.inventarianteNome.toUpperCase()}`, colEsq, ppy, 9.5, colW, { bold: true });
        textoFit(c, `CPF: ${p.inventarianteCpf ?? ""}`, colEsq, ppy - 11, 9, colW);
        ppy -= 24;
      }
    }
    // ---- assinaturas (RT | proprietários) e, embaixo, os selos do cartório ----
    obj(c, "assinaturas", "planimetrico", "Assinaturas e selos do cartório");
    const bandTop = base + PLANI_BAND_H;
    const seloTop = base + SELO_CART_H;
    const meio = sbX + SB_W / 2;
    linha(c, sbX, bandTop, sbX + SB_W, bandTop, 0.8);
    linha(c, meio, seloTop, meio, bandTop, 0.5);
    const colAssW = SB_W / 2 - 24;
    // RT: legenda, espaço para assinar, linha e os dados embaixo dela
    const rtCx = sbX + SB_W / 4;
    texto(c, "RESPONSÁVEL TÉCNICO", rtCx, bandTop - 9, 6.5, { bold: true, center: true, cor: CINZA });
    linha(c, rtCx - colAssW / 2, bandTop - ASSIN_CAP, rtCx + colAssW / 2, bandTop - ASSIN_CAP, 0.6);
    textoFit(c, d.rt.nome.toUpperCase(), rtCx, bandTop - ASSIN_CAP - 10, 9, colAssW, { bold: true, center: true });
    textoFit(c, `${d.rt.formacao.toUpperCase()} - ${d.rt.conselhoSigla}: ${d.rt.conselhoNumero}`, rtCx, bandTop - ASSIN_CAP - 20, 7, colAssW, { center: true });
    textoFit(c, `CÓDIGO DO CREDENCIADO - ${d.rt.codigoCredenciado}`, rtCx, bandTop - ASSIN_CAP - 29, 7, colAssW, { center: true });
    if (exibe.trt) textoFit(c, `TRT: ${d.trt}`, rtCx, bandTop - ASSIN_CAP - 38, 7, colAssW, { center: true });
    // proprietário(s) / posseiro(s): uma linha de assinatura para cada um
    const prCx = sbX + SB_W * 3 / 4;
    texto(c, posse ? (assinantes.length > 1 ? "POSSEIROS" : "POSSEIRO") : (assinantes.length > 1 ? "PROPRIETÁRIOS" : "PROPRIETÁRIO"),
      prCx, bandTop - 9, 6.5, { bold: true, center: true, cor: CINZA });
    let ay = bandTop - ASSIN_CAP;
    for (const [i, p] of assinantes.entries()) {
      if (i > 0) ay -= ASSIN_ENTRE;
      linha(c, prCx - colAssW / 2, ay, prCx + colAssW / 2, ay, 0.6);
      textoFit(c, p.nome.toUpperCase(), prCx, ay - 10, 8.5, colAssW, { bold: true, center: true });
      textoFit(c, `CPF: ${p.cpf}`, prCx, ay - 19, 7, colAssW, { center: true });
      ay -= ASSIN_BLOCO;
      if (p.isEspolio && p.inventarianteNome) {
        textoFit(c, `REP. P/ INVENTARIANTE: ${p.inventarianteNome.toUpperCase()}`, prCx, ay, 7, colAssW, { bold: true, center: true });
        textoFit(c, `CPF: ${p.inventarianteCpf ?? ""}`, prCx, ay - 9, 7, colAssW, { center: true });
        ay -= ASSIN_ESPOLIO;
      }
    }
    // Selos: um por quem assina (RT + até 2 proprietários), lado a lado, em
    // branco — o cartório carimba ali o reconhecimento de firma.
    linha(c, sbX, seloTop, sbX + SB_W, seloTop, 0.8);
    const nSelos = 1 + assinantes.length;
    const seloW = SB_W / nSelos;
    for (let i = 0; i < nSelos; i++) {
      const sx = sbX + i * seloW;
      if (i > 0) linha(c, sx, base, sx, seloTop, 0.5);
      texto(c, "SELO DE RECONHECIMENTO", sx + seloW / 2, seloTop - 10, 6.5, { bold: true, center: true, cor: CINZA });
    }
    yCursor -= h;
  }

  // ---- RODAPÉ (escala/área/perímetro/desenhista/datum/data/folha) ----
  if (!simples) {
    const h = hRodape;
    const topo = yCursor;
    obj(c, "rodape", "rodape", "Rodapé");
    caixa(c, sbX, topo - h, SB_W, h);
    // Com glebas, área e perímetro saem POR GLEBA — é o que a planta de
    // referência faz ("GLEBA 1: 502,2827 HA/1.153,08 TAREFAS"). Um total só não
    // serve: cada gleba é certificada e negociada por si. A linha cresce com o
    // número de glebas (hRodape) e as células de ÁREA e PERÍMETRO alargam.
    const gl = glebas;
    const itens: [string, string[]][] = [
      ["ESCALA", [`1:${fmtMilhar(escala)}`]],
      ["ÁREA", gl.length
        ? gl.map((g) => `${g.nome}: ${g.areaFmt} HA/${g.tarefasFmt} TAREFAS`)
        : [`${d.areaFmt} HA`, `${d.tarefasFmt} TAREFAS`]],
      ["PERÍMETRO", gl.length
        ? gl.map((g) => `${g.nome}: ${g.perimetroFmt} m`)
        : [`${d.perimetroFmt} m`]],
      ["DESENHISTA", [d.desenhista || "—"]],
      ["DATUM", ["SIRGAS2000 - UTM", `M.C -${d.mcAbs}Wgr Fuso: ${d.fuso}${letraFuso(d.latMediaDeg)}`]],
      ["DATA", [d.dataStr]],
      ["FOLHA", [`01 001 ${folha}`]],
    ];
    const larguras = gl.length
      ? [0.09, 0.25, 0.19, 0.14, 0.13, 0.10, 0.10]
      : [0.11, 0.17, 0.14, 0.20, 0.16, 0.11, 0.11];
    let ix0 = sbX;
    for (const [i, [rot, vals]] of itens.entries()) {
      const cw = SB_W * larguras[i];
      if (i > 0) linha(c, ix0, topo - h, ix0, topo, 0.5);
      texto(c, rot, ix0 + 4, topo - 8, 6, { bold: true, cor: CINZA });
      for (const [k, val] of vals.entries()) textoFit(c, val, ix0 + 4, topo - 8 - (k + 1) * RODAPE_PASSO, 7.5, cw - 8);
      ix0 += cw;
    }
  }
  if (!simples && SB_K !== 1) page.pushOperators(popGraphicsState());

  // ==================== FAIXA INFERIOR (arranjo simples) ====================
  // O que a barra lateral tem de essencial, deitado no rodapé: carimbo e planta
  // de situação lado a lado, e abaixo um selo com os seis campos que o modelo
  // pede. Sem quadro analítico, sem planimétrico, sem selo de cartório — quem
  // precisa desses recebe a folha do serviço completo.
  if (simples) {
    const x0 = 20, x1 = W - 20;
    const meia = (x1 - x0) / 2;
    const faixaY = 20 + SELO_H;

    for (const [i, [titulo, arte]] of ([
      ["CARIMBO DA EMPRESA", d.logo],
      ["PLANTA DE SITUAÇÃO", d.satelite],
    ] as const).entries()) {
      const cx = x0 + i * meia;
      if (i === 0) obj(c, "carimbo", "carimbo", "Carimbo da empresa");
      else obj(c, "situacao", "situacao", "Planta de situação");
      const topoUtil = caixaTitulo(c, cx, faixaY, meia, FAIXA_H, titulo);
      if (arte) {
        const img = await embutirImagem(pdf, page, arte.bytes, arte.tipo);
        // a logo respira dentro da célula; o satélite ocupa quase tudo
        const folga = i === 0 ? 46 : 12;
        const sc = Math.min((meia - folga * 2) / img.width, (topoUtil - faixaY - folga) / img.height);
        page.drawImage(img, {
          x: cx + (meia - img.width * sc) / 2,
          y: faixaY + (topoUtil - faixaY - img.height * sc) / 2,
          width: img.width * sc, height: img.height * sc,
        });
      } else {
        texto(c, i === 0 ? "(envie a logo em Configurações)" : "(imagem de satélite indisponível — veja o aviso da geração)",
          cx + meia / 2, faixaY + FAIXA_H / 2, 20, { cor: CINZA, center: true });
      }
    }

    // selo: dois campos por linha, três linhas
    const campos: [string, string][] = [
      ["PROPRIETÁRIO", d.proprietarios[0]?.nome || "—"],
      ["RESPONSÁVEL TÉCNICO", d.rt.nome || "—"],
      ["MUNICÍPIO", d.municipioUf],
      ["ESCALA", `1:${fmtMilhar(escala)}`],
      ["DATA", d.dataStr],
      ["FOLHA", folha],
    ];
    const linhaH = SELO_H / 3;
    obj(c, "selo", "selo", "Selo");
    caixa(c, x0, 20, x1 - x0, SELO_H);
    for (const [i, [rot, val]] of campos.entries()) {
      const col = i % 2, row = Math.floor(i / 2);
      const cx = x0 + col * meia;
      const cy = 20 + SELO_H - (row + 1) * linhaH;
      if (col > 0) linha(c, cx, cy, cx, cy + linhaH, 0.5);
      if (row > 0) linha(c, x0, cy + linhaH, x1, cy + linhaH, 0.5);
      texto(c, `${rot}:`, cx + 10, cy + linhaH - 18, 16, { bold: true, cor: CINZA });
      textoFit(c, val, cx + 20, cy + 10, 28, meia - 40);
    }

    // ÁREA TOTAL no canto do desenho, como no modelo
    const total = ["AREA  TOTAL:", `${d.areaFmt} HECTARES`, `${d.tarefasFmt} TAREFAS`];
    obj(c, "area", "area", "Área total");
    for (const [i, t] of total.entries()) {
      texto(c, t, dArea.x + dArea.w - 16 - f.widthOfTextAtSize(t, 26), dArea.y + 76 - i * 32, 26);
    }
  }

  // ------------------- bloco de identificação de cada gleba -------------------
  //
  // Formato da planta de referência: matrícula/CNS, denominação com o nome da
  // gleba, proprietário, CPF, inventariante e a linha de ÁREA — o mesmo bloco de
  // um confrontante, porque é a mesma informação. Um nome curto no centroide,
  // que era o que a primeira versão fazia, não diz de quem é a gleba nem quanto
  // ela tem.
  //
  // Desenhado no FIM, quando `obstaculos` e `ocupado` já têm tudo: assim o bloco
  // desvia dos traços do desenho, dos nomes dos vizinhos e dos códigos de
  // vértice, em vez de ser desviado por eles.
  for (const [gi, gl] of glebas.entries()) {
    const anelGl: Pt[] = gl.vertices.map((v) => ({ x: X(v.e), y: Y(v.n) }));
    obj(c, `gleba:${gi}`, "gleba", `Identificação — ${gl.nome}`);

    // centroide da ÁREA: em gleba com um lado muito subdividido a média dos
    // vértices puxa o bloco para aquele lado
    let a2 = 0, sx = 0, sy = 0;
    for (let i = 0; i < anelGl.length; i++) {
      const p = anelGl[i], q = anelGl[(i + 1) % anelGl.length];
      const cr = p.x * q.y - q.x * p.y;
      a2 += cr; sx += (p.x + q.x) * cr; sy += (p.y + q.y) * cr;
    }
    const centro: Pt = Math.abs(a2) < 1e-9
      ? { x: anelGl.reduce((s, p) => s + p.x, 0) / anelGl.length, y: anelGl.reduce((s, p) => s + p.y, 0) / anelGl.length }
      : { x: sx / (3 * a2), y: sy / (3 * a2) };

    // No arranjo simples fica só a área: o modelo da conferência põe "2,8037 HA
    // / 6,43 TAREFAS" dentro da gleba e mais nada — numa folha A4 o bloco de
    // identificação inteiro cobriria o desenho.
    const linhasId = simples
      ? [`${gl.areaFmt} HA`, `${gl.tarefasFmt} TAREFAS`]
      : [...gl.identificacao, `AREA:${gl.areaFmt} HA/ ${gl.tarefasFmt} TAREFAS`];

    let posto = false;
    for (const tam of [13, 11.5, 10, 8.5, 7]) {
      const esp = tam * 1.25;
      const lbl = quebrarLinhas(linhasId, 330, tam, f);
      const bw = Math.max(...lbl.map((l) => f.widthOfTextAtSize(l, tam)));
      const bh = lbl.length * esp;
      // dentro da própria gleba primeiro (é onde a referência põe o bloco da
      // GLEBA 1); depois em volta, para a gleba estreita que não comporta
      const cands: Pt[] = [centro];
      for (const raio of [1, 1.6, 2.4, 3.2]) {
        for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          cands.push({ x: centro.x + dx * bw * 0.62 * raio, y: centro.y + dy * (bh + 22) * raio });
        }
      }
      for (const [ci, p] of cands.entries()) {
        const r: Ret = { x1: p.x - bw / 2 - 6, y1: p.y - bh / 2 - 6, x2: p.x + bw / 2 + 6, y2: p.y + bh / 2 + 6 };
        if (r.x1 < dArea.x || r.x2 > dArea.x + dArea.w || r.y1 < dArea.y || r.y2 > dArea.y + dArea.h) continue;
        // o primeiro candidato exige estar DENTRO da gleba; os demais aceitam
        // ficar fora, que é como a referência trata a gleba pequena
        if (ci === 0 && !pontoEmPoligono(p, anelGl)) continue;
        if (obstaculos.some((s) => segCruzaRet(s, r))) continue;
        if (ocupado.some((o) => retCruzaRet(o, r))) continue;
        const topo = p.y + bh / 2;
        for (const [li, lt] of lbl.entries()) {
          texto(c, lt, r.x1 + 6, topo - tam - li * esp, tam, { bold: li === 1 });
        }
        // traço verde por baixo, como nos blocos de confrontante da referência
        linha(c, r.x1 + 4, r.y1 + 3, r.x2 - 4, r.y1 + 3, 2, VERDE);
        ocupado.push(r);
        rotulosGleba.push(r);
        posto = true;
        break;
      }
      if (posto) break;
    }
    // Último recurso: sai no centroide em corpo mínimo. Uma gleba com o bloco
    // apertado é melhor que uma gleba anônima na planta.
    if (!posto) {
      const lbl = quebrarLinhas(linhasId, 300, 7, f);
      const bw = Math.max(...lbl.map((l) => f.widthOfTextAtSize(l, 7)));
      const bh = lbl.length * 9;
      for (const [li, lt] of lbl.entries()) {
        texto(c, lt, centro.x - bw / 2, centro.y + bh / 2 - 7 - li * 9, 7, { bold: li === 1 });
      }
      rotulosGleba.push({ x1: centro.x - bw / 2, y1: centro.y - bh / 2, x2: centro.x + bw / 2, y2: centro.y + bh / 2 });
    }
  }

  // legenda no canto inferior esquerdo da área de desenho — só no A4; no A1/A3
  // ela é desenhada dentro do PLANIMÉTRICO da barra lateral
  if (simples) {
    // mesma caixa reservada lá em cima em `legendaRet` — nenhum rótulo caiu aqui
    const lx = legendaRet.x1 + 6, boxW = legendaRet.x2 - legendaRet.x1, boxH = legendaRet.y2 - legendaRet.y1;
    obj(c, "legenda", "legenda", "Legenda");
    page.drawRectangle({ x: legendaRet.x1, y: legendaRet.y1, width: boxW, height: boxH, color: rgb(1, 1, 1), borderColor: PRETO, borderWidth: 0.8 });
    const lyTop = legendaRet.y2;
    texto(c, "LEGENDAS / ABREVIATURAS", lx, lyTop - 17, 11, { bold: true });
    let lyy = lyTop - 38;
    for (const [cor, nome] of itensLegenda) {
      amostraLegenda(cor, lx, lyy + 3, 38);
      texto(c, nome, lx + 46, lyy, 9.5);
      lyy -= 20;
    }
    if (abrevLegenda) texto(c, abrevLegenda, lx, lyy, 9.5);
  }

  // ---- QUADRO CONFRONTANTES (faixa reservada no rodapé do desenho) ----
  // O outro lado do número: quem no desenho é "3" está aqui por extenso, com
  // matrícula, CNS, nome e CPF — a mesma informação que sairia no bloco, só que
  // num lugar onde o comprimento da divisa não manda na largura do texto.
  //
  // A faixa já foi descontada da área de desenho lá em cima, então este bloco
  // não disputa espaço com nada: escreve onde ninguém pôde desenhar.
  if (quadroNum.h > 0) {
    const qx = dAreaCheia.x, qy = dAreaCheia.y, qw = dAreaCheia.w, qh = quadroNum.h;
    obj(c, "quadro-confrontantes", "quadro-confrontantes", "Quadro de confrontantes");
    page.drawRectangle({ x: qx, y: qy, width: qw, height: qh, color: rgb(1, 1, 1), borderColor: PRETO, borderWidth: 0.8 });
    texto(c, "CONFRONTANTES", qx + 8, qy + qh - 16, 12, { bold: true });
    linha(c, qx, qy + qh - 24, qx + qw, qy + qh - 24, 0.5);
    const nCols = quadroNum.colunas.length;
    const larguraCol = qw / nCols;
    for (const [ci, coluna] of quadroNum.colunas.entries()) {
      // fio separando as colunas, como no rodapé da barra lateral
      if (ci > 0) linha(c, qx + ci * larguraCol, qy + 4, qx + ci * larguraCol, qy + qh - 24, 0.4, CINZA);
      let cy = qy + qh - 24 - quadroNum.tam - 4;
      for (const entrada of coluna) {
        for (const [li, lt] of entrada.linhas.entries()) {
          // a primeira linha carrega o número e sai em negrito: é ela que o
          // leitor procura depois de achar o "3" no desenho
          texto(c, lt, qx + ci * larguraCol + 8 + (li === 0 ? 0 : 10), cy, quadroNum.tam, { bold: li === 0 });
          cy -= quadroNum.esp;
        }
      }
    }
  }

  if (diag) {
    diag.obstaculos = obstaculos;
    diag.rotulos = rotulosTrecho;
    diag.sobrepostos = rotulosTrecho.filter((r, i) => {
      const o = obbsTrecho[i];
      return obstaculos.some((s) => (o ? segCruzaObb(s, o) : segCruzaRet(s, r)));
    }).length;
    diag.deslocados = deslocados;
    // rótulo de vizinho que foi parar DENTRO da fazenda: nomeia a divisa errada
    // e tem de ser sempre 0. Ver `cabeNoCorredor` e `anelProibido`.
    diag.dentroDoImovel = rotulosTrecho.filter((r) => dentroDeAlgum(centroCand(r), aneisTela)).length;
    diag.marcos = marcos;
    diag.vias = vias;
    diag.corpos = corposTrecho;
    diag.folga = FOLGA;
    diag.poligono = anelTela;
    diag.divisasGleba = divisasGleba;
    diag.rotulosGleba = rotulosGleba;
  }

  // A MESMA folha, entregue na medida pedida. O desenho inteiro é sempre feito
  // em A1 e reduzido aqui no fim — é isso que faz da A3 (e agora da A4) uma
  // redução, e não uma segunda planta com outro layout.
  //
  // Um único fator para os dois eixos. Meia-A1 daria 420,5×297, então quem manda
  // é o eixo mais apertado (420/841 ≈ 0,4994) e sobra 1,1pt de altura, repartida
  // em cima e embaixo para a moldura continuar centrada. Escalar cada eixo pelo
  // seu próprio fator caberia igual, mas achataria o desenho 0,12% na horizontal:
  // o círculo da bússola viraria elipse e a escala gráfica deixaria de bater com
  // a numérica.
  if (folha !== "A1") {
    const [wf, hf] = FOLHAS_MM[folha];
    const w2 = wf * MM, h2 = hf * MM;
    const s = Math.min(w2 / W, h2 / H);
    // ordem importa: o translate é aplicado por fora da escala (T · S)
    page.scaleContent(s, s);
    page.translateContent((w2 - W * s) / 2, (h2 - H * s) / 2);
    page.setSize(w2, h2);
  }
  if (opts.editavel) {
    embutirCena(pdf, { ...page.cena(), nomeFolha: folha });
  }

  return await pdf.save();
}
