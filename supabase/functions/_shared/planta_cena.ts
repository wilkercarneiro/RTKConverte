// CENA da planta: o desenho como lista de peças editáveis.
//
// A planta continua sendo desenhada direto no PDF, em uma passada (planta.ts).
// O que este módulo acrescenta é um GRAVADOR: ele fica entre o desenho e a
// página, repassa cada chamada sem tocar nela — o PDF sai byte a byte igual — e
// anota a mesma chamada como uma peça (texto, linha, retângulo, elipse, caminho,
// imagem) já nas coordenadas finais da tela.
//
// A cena vai embutida no próprio PDF, num fluxo particular do catálogo
// (/RTKCena) que nenhum leitor mostra: não é anexo, não aparece no Acrobat nem
// no cartório. Qualquer planta gerada pelo sistema carrega a sua cena, e o
// editor do navegador abre a partir do PDF — do histórico, da geração de agora,
// de gleba ou de serviço completo — sem arquivo paralelo para manter em dia.
//
// No navegador, `cenaParaPdf` reconstrói o PDF a partir da cena editada, com o
// mesmo pdf-lib e as mesmas fontes, e embute nele a cena nova: uma planta
// editada continua editável.
import {
  PDFDocument, PDFFont, PDFImage, PDFName, PDFPage, PDFRawStream, StandardFonts,
  decodePDFRawStream, degrees, rgb,
} from "pdf-lib";

// ---------------------------------------------------------------------------
// formato
// ---------------------------------------------------------------------------
export type Cor = [number, number, number];

interface ItemBase {
  id: string;
  /** objeto a que a peça pertence: um clique seleciona o objeto inteiro */
  obj: string;
  /** peça escondida pelo operador: fica na cena (para voltar), não sai no PDF */
  oculto?: boolean;
}
export interface ItemTexto extends ItemBase {
  k: "texto"; t: string; x: number; y: number; tam: number;
  negrito?: boolean; cor: Cor; rot?: number;
  /** largura impressa, medida na fonte do PDF */
  w: number;
  opac?: number;
}
export interface ItemLinha extends ItemBase {
  k: "linha"; x1: number; y1: number; x2: number; y2: number;
  esp: number; cor: Cor; tracejado?: number[]; opac?: number;
}
export interface ItemRet extends ItemBase {
  k: "ret"; x: number; y: number; w: number; h: number;
  fundo?: Cor; borda?: Cor; esp?: number; opac?: number;
}
export interface ItemElipse extends ItemBase {
  k: "elipse"; x: number; y: number; rx: number; ry: number;
  fundo?: Cor; borda?: Cor; esp?: number; opac?: number;
}
export interface ItemCaminho extends ItemBase {
  /** caminho SVG (y para baixo) a partir de (x, y); `esc` amplia o caminho e o traço */
  k: "caminho"; d: string; x: number; y: number; esc: number;
  fundo?: Cor; borda?: Cor; esp?: number; opac?: number;
}
export interface ItemImagem extends ItemBase {
  k: "imagem"; img: string; x: number; y: number; w: number; h: number;
}
export type ItemCena = ItemTexto | ItemLinha | ItemRet | ItemElipse | ItemCaminho | ItemImagem;

export interface ObjetoCena {
  rotulo: string;
  /** camada: agrupa objetos do mesmo tipo (todos os marcos verdes, todos os códigos…) */
  cat: string;
  /** traçado do terreno: aparece, não se seleciona, não se move, não se apaga */
  travado?: boolean;
}

export interface ImagemCena { tipo: "png" | "jpg"; b64: string }

export interface Cena {
  versao: 1;
  /** a tela em que tudo foi desenhado (sempre a A1, ou a A1 retrato no A4) */
  tela: { w: number; h: number };
  /** redução final para a folha de entrega; ausente = a tela já é a folha */
  folha?: { w: number; h: number; s: number; tx: number; ty: number };
  /** "A1", "A3"… — só para o editor dizer o que vai sair */
  nomeFolha?: string;
  imagens: Record<string, ImagemCena>;
  objetos: Record<string, ObjetoCena>;
  itens: ItemCena[];
}

/** Nome de cada camada, para o painel do editor. */
export const CAMADAS: Record<string, string> = {
  terreno: "Traçado do terreno",
  moldura: "Molduras",
  malha: "Malha de coordenadas",
  estrada: "Estradas (vermelho)",
  rio: "Rios / cursos d'água",
  marco: "Divisões das confrontações (verde)",
  tique: "Tiques dos vértices",
  "codigo-vertice": "Códigos dos vértices",
  "rotulo-confrontante": "Nomes dos confrontantes",
  "rotulo-numero": "Números dos confrontantes",
  "rotulo-via": "Nomes das vias e rios",
  identificacao: "Identificação do imóvel",
  gleba: "Identificação das glebas",
  bussola: "Rosa dos ventos",
  quadro: "Quadro analítico",
  situacao: "Planta de situação",
  carimbo: "Carimbo da empresa",
  planimetrico: "Planimétrico",
  rodape: "Rodapé",
  legenda: "Legenda",
  "quadro-confrontantes": "Quadro de confrontantes",
  selo: "Selo",
  area: "Área total",
  anotacao: "Suas anotações",
  desenho: "Desenho",
};

// ---------------------------------------------------------------------------
// gravador
// ---------------------------------------------------------------------------
/**
 * O pedaço da PDFPage que os geradores de planta usam. O gravador implementa
 * exatamente isto, então o gerador não sabe se desenha numa página ou num
 * gravador — e não precisa saber.
 */
export interface PaginaPlanta {
  drawText: PDFPage["drawText"];
  drawLine: PDFPage["drawLine"];
  drawRectangle: PDFPage["drawRectangle"];
  drawCircle: PDFPage["drawCircle"];
  drawEllipse: PDFPage["drawEllipse"];
  drawSvgPath: PDFPage["drawSvgPath"];
  drawImage: PDFPage["drawImage"];
  pushOperators: PDFPage["pushOperators"];
  scaleContent: PDFPage["scaleContent"];
  translateContent: PDFPage["translateContent"];
  setSize: PDFPage["setSize"];
  getSize: PDFPage["getSize"];
  getWidth: PDFPage["getWidth"];
  getHeight: PDFPage["getHeight"];
  /** marca o objeto/camada das próximas peças (no PDF puro, nada acontece) */
  objeto?: (id: string, cat: string, rotulo: string, travado?: boolean) => void;
}

/** Marca o objeto das próximas peças, se a página for um gravador. */
export function marcarObjeto(p: PaginaPlanta, id: string, cat: string, rotulo: string, travado = false): void {
  p.objeto?.(id, cat, rotulo, travado);
}

// deno-lint-ignore no-explicit-any
type Qualquer = any;

function corDe(c: Qualquer): Cor | undefined {
  if (!c) return undefined;
  if (c.type === "RGB") return [c.red, c.green, c.blue];
  if (c.type === "Grayscale") return [c.gray, c.gray, c.gray];
  if (c.type === "CMYK") {
    const k = 1 - c.key;
    return [(1 - c.cyan) * k, (1 - c.magenta) * k, (1 - c.yellow) * k];
  }
  return undefined;
}

const num = (a: Qualquer): number => (typeof a?.asNumber === "function" ? a.asNumber() : Number(String(a)));

/** Matriz afim [a b c d e f], como no PDF. */
type Matriz = [number, number, number, number, number, number];
const IDENT: Matriz = [1, 0, 0, 1, 0, 0];
// m' = n × m (n aplicada antes de m): é o efeito do operador cm sobre a CTM
const compor = (n: Matriz, m: Matriz): Matriz => [
  n[0] * m[0] + n[1] * m[2], n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2], n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4], n[4] * m[1] + n[5] * m[3] + m[5],
];

export class GravadorCena implements PaginaPlanta {
  private itens: ItemCena[] = [];
  private objetos: Record<string, ObjetoCena> = {};
  private imagens: Record<string, ImagemCena> = {};
  private idsImagem = new Map<PDFImage, string>();
  private atual = "solto";
  private seq = 0;
  private soltos = 0;
  private ctm: Matriz = IDENT;
  private pilha: Matriz[] = [];
  private tela: { w: number; h: number };
  private folha?: Cena["folha"];
  private escalaFinal?: number;
  private readonly page: PDFPage;

  constructor(page: PDFPage) {
    this.page = page;
    const { width, height } = page.getSize();
    this.tela = { w: width, h: height };
  }

  objeto(id: string, cat: string, rotulo: string, travado = false): void {
    this.atual = id;
    if (!this.objetos[id]) this.objetos[id] = { rotulo, cat, ...(travado ? { travado: true } : {}) };
  }

  /** Registra os bytes de uma imagem embutida, para a cena poder redesenhá-la. */
  registrarImagem(img: PDFImage, bytes: Uint8Array, tipo: "png" | "jpg"): PDFImage {
    if (!this.idsImagem.has(img)) {
      const id = `img${this.idsImagem.size + 1}`;
      this.idsImagem.set(img, id);
      this.imagens[id] = { tipo, b64: paraBase64(bytes) };
    }
    return img;
  }

  cena(): Cena {
    return {
      versao: 1, tela: this.tela, ...(this.folha ? { folha: this.folha } : {}),
      imagens: this.imagens, objetos: this.objetos, itens: this.itens,
    };
  }

  // ---- peças ----
  private obj(): string {
    // peça desenhada sem objeto marcado vira um objeto só dela
    if (this.atual !== "solto") return this.atual;
    const id = `p${++this.soltos}`;
    this.objetos[id] = { rotulo: "Elemento", cat: "desenho" };
    return id;
  }
  private add(it: Record<string, unknown>): void {
    this.itens.push({ id: `i${++this.seq}`, obj: this.obj(), ...it } as unknown as ItemCena);
  }
  private pt(x: number, y: number): [number, number] {
    const m = this.ctm;
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }
  /** escala uniforme da CTM (o desenho só usa escala uniforme e translação) */
  private get k(): number { return Math.hypot(this.ctm[0], this.ctm[1]); }

  drawText(text: string, o: Qualquer = {}): void {
    this.page.drawText(text, o);
    const font: PDFFont | undefined = o.font;
    const size = o.size ?? 24;
    const [x, y] = this.pt(o.x ?? 0, o.y ?? 0);
    const w = font ? font.widthOfTextAtSize(text, size) : text.length * size * 0.5;
    this.add({
      k: "texto", t: text, x, y, tam: size * this.k, w: w * this.k,
      ...(font && /bold/i.test(font.name) ? { negrito: true } : {}),
      cor: corDe(o.color) ?? [0, 0, 0],
      ...(o.rotate ? { rot: o.rotate.type === "radians" ? o.rotate.angle * 180 / Math.PI : o.rotate.angle } : {}),
      ...(o.opacity !== undefined ? { opac: o.opacity } : {}),
    });
  }

  drawLine(o: Qualquer): void {
    this.page.drawLine(o);
    const [x1, y1] = this.pt(o.start.x, o.start.y), [x2, y2] = this.pt(o.end.x, o.end.y);
    this.add({
      k: "linha", x1, y1, x2, y2, esp: (o.thickness ?? 1) * this.k, cor: corDe(o.color) ?? [0, 0, 0],
      ...(o.dashArray?.length ? { tracejado: o.dashArray.map((v: number) => v * this.k) } : {}),
      ...(o.opacity !== undefined ? { opac: o.opacity } : {}),
    });
  }

  drawRectangle(o: Qualquer = {}): void {
    this.page.drawRectangle(o);
    const [x, y] = this.pt(o.x ?? 0, o.y ?? 0);
    let fundo = corDe(o.color), borda = corDe(o.borderColor);
    // regra do pdf-lib: sem cor nenhuma, o retângulo sai preenchido de preto
    if (!fundo && !borda) fundo = [0, 0, 0];
    if (borda && !(o.borderWidth > 0)) borda = undefined;
    this.add({
      k: "ret", x, y, w: (o.width ?? 150) * this.k, h: (o.height ?? 100) * this.k,
      ...(fundo ? { fundo } : {}), ...(borda ? { borda, esp: o.borderWidth * this.k } : {}),
      ...(o.opacity !== undefined ? { opac: o.opacity } : {}),
    });
  }

  private elipse(o: Qualquer, rx: number, ry: number): void {
    const [x, y] = this.pt(o.x ?? 0, o.y ?? 0);
    let fundo = corDe(o.color), borda = corDe(o.borderColor);
    if (!fundo && !borda) fundo = [0, 0, 0];
    if (borda && !(o.borderWidth > 0)) borda = undefined;
    this.add({
      k: "elipse", x, y, rx: rx * this.k, ry: ry * this.k,
      ...(fundo ? { fundo } : {}), ...(borda ? { borda, esp: o.borderWidth * this.k } : {}),
      ...(o.opacity !== undefined ? { opac: o.opacity } : {}),
    });
  }
  drawCircle(o: Qualquer = {}): void {
    this.page.drawCircle(o);
    this.elipse(o, o.size ?? 100, o.size ?? 100);
  }
  drawEllipse(o: Qualquer = {}): void {
    this.page.drawEllipse(o);
    this.elipse(o, o.xScale ?? 100, o.yScale ?? 100);
  }

  drawSvgPath(d: string, o: Qualquer = {}): void {
    this.page.drawSvgPath(d, o);
    const [x, y] = this.pt(o.x ?? 0, o.y ?? 0);
    const fundo = corDe(o.color);
    // regra do pdf-lib: sem cor nenhuma, o caminho sai com contorno preto
    const borda = corDe(o.borderColor) ?? (fundo ? undefined : [0, 0, 0] as Cor);
    this.add({
      k: "caminho", d, x, y, esc: (o.scale ?? 1) * this.k,
      ...(fundo ? { fundo } : {}), ...(borda ? { borda, esp: o.borderWidth ?? 0 } : {}),
      ...(o.opacity !== undefined ? { opac: o.opacity } : {}),
    });
  }

  drawImage(img: PDFImage, o: Qualquer = {}): void {
    this.page.drawImage(img, o);
    const id = this.idsImagem.get(img);
    if (!id) return; // imagem não registrada: sai no PDF, não entra na cena
    const [x, y] = this.pt(o.x ?? 0, o.y ?? 0);
    this.add({ k: "imagem", img: id, x, y, w: (o.width ?? img.width) * this.k, h: (o.height ?? img.height) * this.k });
  }

  // ---- estado gráfico ----
  pushOperators(...ops: Qualquer[]): void {
    this.page.pushOperators(...ops);
    for (const op of ops) {
      if (op?.name === "q") this.pilha.push(this.ctm);
      else if (op?.name === "Q") this.ctm = this.pilha.pop() ?? IDENT;
      else if (op?.name === "cm") this.ctm = compor(op.args.map(num) as Matriz, this.ctm);
    }
  }
  scaleContent(x: number, y: number): void {
    this.page.scaleContent(x, y);
    this.escalaFinal = x;
    void y;
  }
  translateContent(x: number, y: number): void {
    this.page.translateContent(x, y);
    this.folha = { w: 0, h: 0, s: this.escalaFinal ?? 1, tx: x, ty: y };
  }
  setSize(w: number, h: number): void {
    this.page.setSize(w, h);
    this.folha = { ...(this.folha ?? { s: 1, tx: 0, ty: 0 }), w, h };
  }
  getSize() { return this.page.getSize(); }
  getWidth() { return this.page.getWidth(); }
  getHeight() { return this.page.getHeight(); }
}

/** Embute uma imagem no PDF e, se houver gravador, registra os bytes dela. */
export async function embutirImagem(pdf: PDFDocument, pagina: PaginaPlanta, bytes: Uint8Array, tipo: "png" | "jpg"): Promise<PDFImage> {
  const img = tipo === "png" ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  if (pagina instanceof GravadorCena) pagina.registrarImagem(img, bytes, tipo);
  return img;
}

// ---------------------------------------------------------------------------
// base64 sem Buffer (Deno, navegador e Node)
// ---------------------------------------------------------------------------
export function paraBase64(bytes: Uint8Array): string {
  let s = "";
  const PASSO = 0x8000;
  for (let i = 0; i < bytes.length; i += PASSO) s += String.fromCharCode(...bytes.subarray(i, i + PASSO));
  return btoa(s);
}
export function deBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// a cena dentro do PDF
// ---------------------------------------------------------------------------
const CHAVE_CENA = "RTKCena";

/** Grava a cena num fluxo particular do catálogo — invisível para qualquer leitor de PDF. */
export function embutirCena(pdf: PDFDocument, cena: Cena): void {
  const json = new TextEncoder().encode(JSON.stringify(cena));
  const ref = pdf.context.register(pdf.context.flateStream(json));
  pdf.catalog.set(PDFName.of(CHAVE_CENA), ref);
}

/** A cena de um PDF gerado pelo sistema; `null` se ele não tiver (planta antiga). */
export async function lerCena(bytes: Uint8Array | ArrayBuffer): Promise<Cena | null> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const fluxo = doc.catalog.lookup(PDFName.of(CHAVE_CENA));
  if (!(fluxo instanceof PDFRawStream)) return null;
  const json = new TextDecoder().decode(decodePDFRawStream(fluxo).decode());
  const cena = JSON.parse(json) as Cena;
  return cena?.versao === 1 && Array.isArray(cena.itens) ? cena : null;
}

// ---------------------------------------------------------------------------
// cena → PDF
// ---------------------------------------------------------------------------
const c3 = (c: Cor) => rgb(c[0], c[1], c[2]);

/**
 * Reconstrói o PDF a partir da cena: a mesma tela, as mesmas fontes padrão, a
 * mesma redução para a folha. Peças ocultas ficam de fora. A cena vai junto,
 * para a planta editada poder ser editada de novo.
 */
export async function cenaParaPdf(cena: Cena, limparTexto: (t: string) => string = (t) => t): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([cena.tela.w, cena.tela.h]);
  const f = await pdf.embedFont(StandardFonts.Helvetica);
  const fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  const imgs = new Map<string, PDFImage>();
  for (const [id, im] of Object.entries(cena.imagens)) {
    const b = deBase64(im.b64);
    imgs.set(id, im.tipo === "png" ? await pdf.embedPng(b) : await pdf.embedJpg(b));
  }
  for (const it of cena.itens) {
    if (it.oculto) continue;
    switch (it.k) {
      case "texto":
        page.drawText(limparTexto(it.t), {
          x: it.x, y: it.y, size: it.tam, font: it.negrito ? fb : f, color: c3(it.cor),
          rotate: it.rot ? degrees(it.rot) : undefined, opacity: it.opac,
        });
        break;
      case "linha":
        page.drawLine({
          start: { x: it.x1, y: it.y1 }, end: { x: it.x2, y: it.y2 }, thickness: it.esp, color: c3(it.cor),
          dashArray: it.tracejado, opacity: it.opac,
        });
        break;
      case "ret":
        if (!it.fundo && !it.borda) break;
        page.drawRectangle({
          x: it.x, y: it.y, width: it.w, height: it.h,
          color: it.fundo ? c3(it.fundo) : undefined, opacity: it.opac,
          borderColor: it.borda ? c3(it.borda) : undefined, borderWidth: it.borda ? it.esp ?? 1 : 0, borderOpacity: it.opac,
        });
        break;
      case "elipse":
        if (!it.fundo && !it.borda) break;
        page.drawEllipse({
          x: it.x, y: it.y, xScale: it.rx, yScale: it.ry,
          color: it.fundo ? c3(it.fundo) : undefined, opacity: it.opac,
          borderColor: it.borda ? c3(it.borda) : undefined, borderWidth: it.borda ? it.esp ?? 1 : 0, borderOpacity: it.opac,
        });
        break;
      case "caminho":
        if (!it.fundo && !it.borda) break;
        page.drawSvgPath(it.d, {
          x: it.x, y: it.y, scale: it.esc,
          color: it.fundo ? c3(it.fundo) : undefined, opacity: it.opac,
          borderColor: it.borda ? c3(it.borda) : undefined, borderWidth: it.borda ? it.esp ?? 0 : 0, borderOpacity: it.opac,
        });
        break;
      case "imagem": {
        const img = imgs.get(it.img);
        if (img) page.drawImage(img, { x: it.x, y: it.y, width: it.w, height: it.h });
        break;
      }
    }
  }
  if (cena.folha) {
    page.scaleContent(cena.folha.s, cena.folha.s);
    page.translateContent(cena.folha.tx, cena.folha.ty);
    page.setSize(cena.folha.w, cena.folha.h);
  }
  embutirCena(pdf, cena);
  return await pdf.save();
}
