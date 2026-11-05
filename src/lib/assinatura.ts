// Preparo da IMAGEM da assinatura do responsável técnico, no navegador, antes
// de enviar ao Storage (templates/escritorios/{escritório}/assinaturas/rt-{id}.png):
//
//   1. fundo claro → transparente (papel branco fotografado ou escaneado), com
//      borda suave para o traço não ficar serrilhado;
//   2. recorte no traço (sem margem branca sobrando);
//   3. no máximo 1200 px de largura, em PNG.
//
// A parte de pixels é pura (testada no Node); a do canvas só lê e grava.
// É uma imagem de assinatura, não assinatura digital ICP-Brasil.

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Brilho a partir do qual o pixel é fundo (0–255). */
export const LIMIAR_FUNDO = 215;
/** Faixa de transição: entre LIMIAR - SUAVE e LIMIAR o pixel fica meio transparente. */
const SUAVE = 45;

/** Torna transparente o fundo claro (in place). Devolve quantos pixels sobraram com traço. */
export function limparFundo(px: Pixels, limiar = LIMIAR_FUNDO): number {
  const d = px.data;
  let traco = 0;
  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const alfaOriginal = d[i + 3];
    let alfa: number;
    if (lum >= limiar) alfa = 0;
    else if (lum > limiar - SUAVE) alfa = Math.round(255 * (limiar - lum) / SUAVE);
    else alfa = 255;
    alfa = Math.min(alfa, alfaOriginal);
    d[i + 3] = alfa;
    if (alfa > 0) {
      traco++;
      // o traço fica escuro e uniforme (caneta azul continua azul, só mais firme)
      const k = lum > 0 ? Math.min(1, 90 / lum) : 1;
      d[i] = Math.round(d[i] * k); d[i + 1] = Math.round(d[i + 1] * k); d[i + 2] = Math.round(d[i + 2] * k);
    }
  }
  return traco;
}

/** Caixa do traço (pixels com alfa > 24), com `margem` px em volta. null = imagem vazia. */
export function caixaDoTraco(px: Pixels, margem = 6): { x: number; y: number; w: number; h: number } | null {
  let x0 = px.width, y0 = px.height, x1 = -1, y1 = -1;
  for (let y = 0; y < px.height; y++) {
    for (let x = 0; x < px.width; x++) {
      if (px.data[(y * px.width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const x = Math.max(0, x0 - margem), y = Math.max(0, y0 - margem);
  return { x, y, w: Math.min(px.width, x1 + margem + 1) - x, h: Math.min(px.height, y1 + margem + 1) - y };
}

export const LARGURA_MAX = 1200;

/** Arquivo escolhido → PNG transparente e recortado. Lança erro legível. */
export async function prepararAssinatura(arquivo: File, opts: { limparFundo?: boolean } = {}): Promise<Blob> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(arquivo.type) && !/\.(png|jpe?g|webp)$/i.test(arquivo.name)) {
    throw new Error("Envie a assinatura como imagem (PNG, JPG ou WEBP).");
  }
  if (arquivo.size > 8 * 1024 * 1024) throw new Error("Imagem grande demais (máximo 8 MB).");
  const bmp = await createImageBitmap(arquivo);
  const escala = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * escala)), h = Math.max(1, Math.round(bmp.height * escala));
  const tela = document.createElement("canvas");
  tela.width = w; tela.height = h;
  const ctx = tela.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("O navegador não conseguiu abrir a imagem.");
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  if (opts.limparFundo !== false && limparFundo(img) === 0) {
    throw new Error("Não achei o traço da assinatura: use uma foto nítida, com caneta escura em papel branco.");
  }
  const caixa = caixaDoTraco(img);
  if (!caixa) throw new Error("A imagem está vazia (só fundo).");
  ctx.putImageData(img, 0, 0);
  const k = Math.min(1, LARGURA_MAX / caixa.w);
  const saida = document.createElement("canvas");
  saida.width = Math.max(1, Math.round(caixa.w * k));
  saida.height = Math.max(1, Math.round(caixa.h * k));
  saida.getContext("2d")!.drawImage(tela, caixa.x, caixa.y, caixa.w, caixa.h, 0, 0, saida.width, saida.height);
  return await new Promise<Blob>((ok, falha) => saida.toBlob((b) => (b ? ok(b) : falha(new Error("Falha ao gerar o PNG."))), "image/png"));
}

/** Caminho no bucket `templates` (o mesmo que o servidor lê em _shared/assinatura_rt.ts). */
export function caminhoAssinatura(escritorioId: string, rtId: string): string {
  return `escritorios/${escritorioId}/assinaturas/rt-${rtId}.png`;
}
