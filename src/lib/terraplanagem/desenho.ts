// O mapa de corte e aterro desenhado num canvas 2D — o mesmo desenho na tela
// e na imagem do relatório em PDF. Corte em tons de vermelho, aterro em azul
// (quanto mais fundo, mais forte), o terreno sem obra em relevo sombreado, as
// curvas do terreno, as isolinhas de 0,5 m, a linha de passagem, a crista e o
// pé do talude e as seções.
import type { Pt } from "./geometria.ts";
import type { ResultadoTerraplanagem } from "./calculo.ts";

export interface Vista {
  /** pixels por metro */
  escala: number;
  /** coordenada UTM do canto superior esquerdo do canvas */
  e: number;
  n: number;
}

export const CORES = {
  corte: "#B42318", corteClaro: "#FCE3DC",
  aterro: "#1D4ED8", aterroClaro: "#DCE7FD",
  plataforma: "#0E3B2B", passagem: "#12201A",
  crista: "#B42318", pe: "#1D4ED8", secao: "#B7791F",
  curva: "rgba(110, 84, 52, 0.35)", curvaMestra: "rgba(110, 84, 52, 0.7)",
};

const mistura = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const C_CORTE: [[number, number, number], [number, number, number]] = [[252, 222, 212], [160, 28, 18]];
const C_ATERRO: [[number, number, number], [number, number, number]] = [[214, 228, 253], [26, 64, 196]];

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A malha como imagem (1 pixel por nó, norte em cima). */
export function imagemDaMalha(r: ResultadoTerraplanagem): ImageData {
  const { nx, ny, passo, terreno, altura } = r.malha;
  const img = new ImageData(nx, ny);
  const d = img.data;
  const prof = Math.max(0.5, r.maxCorte, r.maxAterro);
  // sombreamento do terreno (luz de noroeste)
  const at = (i: number, j: number) => {
    const ii = Math.max(0, Math.min(nx - 1, i)), jj = Math.max(0, Math.min(ny - 1, j));
    const v = terreno[jj * nx + ii];
    return v === v ? v : terreno[j * nx + i];
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const o = ((ny - 1 - j) * nx + i) * 4;
    // fora do levantamento: a cor do nó válido mais perto na linha (o desenho é
    // recortado pelo contorno; sem isto, a suavização escurecia a borda)
    let k = j * nx + i;
    if (!(terreno[k] === terreno[k])) {
      let achou = -1;
      for (let s = 1; s < nx && achou < 0; s++) {
        if (i - s >= 0 && terreno[k - s] === terreno[k - s]) achou = k - s;
        else if (i + s < nx && terreno[k + s] === terreno[k + s]) achou = k + s;
      }
      if (achou < 0) { d[o + 3] = 0; continue; }
      k = achou;
    }
    const t = terreno[k];
    const ic = k % nx;
    const g = (a: number, b: number) => { const v = (a - b) / (2 * passo); return v === v ? v : 0; };
    const dzx = g(at(ic + 1, j), at(ic - 1, j)), dzy = g(at(ic, j + 1), at(ic, j - 1));
    // normal (−dzx, −dzy, 1) · luz (−1, 1, 1.4) normalizada
    const nl = Math.hypot(dzx, dzy, 1), luz = Math.hypot(1, 1, 1.4);
    const sombra = Math.max(0, Math.min(1, ((dzx - dzy + 1.4) / (nl * luz)) * 1.0));
    const h = altura[k];
    let c: [number, number, number];
    if (h > 0.01) c = mistura(C_CORTE[0], C_CORTE[1], Math.sqrt(Math.min(1, h / prof)));
    else if (h < -0.01) c = mistura(C_ATERRO[0], C_ATERRO[1], Math.sqrt(Math.min(1, -h / prof)));
    else {
      const base: [number, number, number] = [226, 231, 222];
      c = mistura([150, 160, 146], base, sombra);
    }
    // relevo leve também por baixo da cor da obra
    const f = h > 0.01 || h < -0.01 ? 0.88 + 0.12 * sombra : 1;
    d[o] = c[0] * f; d[o + 1] = c[1] * f; d[o + 2] = c[2] * f; d[o + 3] = 255;
  }
  return img;
}

/** Vista que enquadra a caixa dada no canvas (com margem em px). */
export function enquadrar(pts: Pt[], w: number, h: number, margem = 24): Vista {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  const escala = Math.min((w - 2 * margem) / Math.max(1, x1 - x0), (h - 2 * margem) / Math.max(1, y1 - y0));
  return { escala, e: (x0 + x1) / 2 - w / 2 / escala, n: (y0 + y1) / 2 + h / 2 / escala };
}

export const paraTela = (v: Vista, p: Pt): Pt => [(p[0] - v.e) * v.escala, (v.n - p[1]) * v.escala];
export const paraTerreno = (v: Vista, q: Pt): Pt => [v.e + q[0] / v.escala, v.n - q[1] / v.escala];

export interface OpcoesDesenho {
  pontos?: boolean;
  curvas?: boolean;
  /** seção destacada (nome) */
  secaoAtiva?: string | null;
  /** escala gráfica e norte no canto */
  moldura?: boolean;
}

/** A malha pronta para desenhar (guarde entre um quadro e outro: só muda com o resultado). */
export function telaDaMalha(r: ResultadoTerraplanagem): CanvasImageSource {
  const img = imagemDaMalha(r);
  const tela = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(img.width, img.height) : Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  (tela.getContext("2d") as Ctx).putImageData(img, 0, 0);
  return tela as CanvasImageSource;
}

export function desenharMapa(ctx: Ctx, r: ResultadoTerraplanagem, v: Vista, w: number, h: number, pontos: Pt[], op: OpcoesDesenho = {}, telaPronta?: CanvasImageSource): void {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  // malha
  const tela = telaPronta ?? telaDaMalha(r);
  const { e0, n0, passo, nx, ny } = r.malha;
  const [px0, py0] = paraTela(v, [e0 - passo / 2, n0 + (ny - 0.5) * passo]);
  ctx.imageSmoothingEnabled = true;
  ctx.save();
  ctx.beginPath();
  r.contorno.forEach((p, i) => { const [x, y] = paraTela(v, p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(tela, px0, py0, nx * passo * v.escala, ny * passo * v.escala);
  ctx.restore();

  const linha = (pts: Pt[], fechada = false) => {
    if (pts.length < 2) return;
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = paraTela(v, p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    if (fechada) ctx.closePath();
    ctx.stroke();
  };
  const espessura = (px: number) => px;
  ctx.lineJoin = "round"; ctx.lineCap = "round";

  if (op.curvas !== false) {
    for (const c of r.curvasTerreno) {
      ctx.strokeStyle = c.mestra ? CORES.curvaMestra : CORES.curva;
      ctx.lineWidth = espessura(c.mestra ? 1.1 : 0.7);
      ctx.setLineDash([]);
      linha(c.pts);
    }
  }
  // isolinhas de corte/aterro
  for (const c of r.isolinhas) {
    ctx.strokeStyle = c.cota > 0 ? "rgba(122, 21, 12, 0.55)" : "rgba(20, 46, 140, 0.55)";
    ctx.lineWidth = c.mestra ? 1.1 : 0.7;
    ctx.setLineDash([]);
    linha(c.pts);
  }
  // contorno dos pontos
  ctx.strokeStyle = "rgba(18, 32, 26, 0.45)"; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
  linha(r.contorno, true);
  // crista e pé
  ctx.setLineDash([7, 4]); ctx.lineWidth = 1.8;
  ctx.strokeStyle = CORES.crista; for (const l of r.crista) linha(l);
  ctx.strokeStyle = CORES.pe; for (const l of r.pe) linha(l);
  // plataforma
  ctx.setLineDash([]); ctx.lineWidth = 2.4; ctx.strokeStyle = CORES.plataforma;
  linha(r.plataforma, true);
  // linha de passagem
  ctx.setLineDash([10, 4, 2, 4]); ctx.lineWidth = 2; ctx.strokeStyle = CORES.passagem;
  for (const l of r.passagem) linha(l);
  ctx.setLineDash([]);
  // pontos do levantamento
  if (op.pontos !== false && v.escala > 0.6) {
    ctx.fillStyle = "rgba(18, 32, 26, 0.7)";
    const raio = Math.max(1, Math.min(2.2, v.escala * 0.4));
    for (const p of pontos) {
      const [x, y] = paraTela(v, p);
      if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue;
      ctx.beginPath(); ctx.arc(x, y, raio, 0, Math.PI * 2); ctx.fill();
    }
  }
  // seções
  for (const s of r.secoes) {
    const ativa = op.secaoAtiva === s.nome;
    ctx.strokeStyle = CORES.secao; ctx.lineWidth = ativa ? 2.6 : 1.6; ctx.setLineDash(ativa ? [] : [12, 5]);
    linha([s.a, s.b]);
    ctx.setLineDash([]);
    for (const [p, t] of [[s.a, s.nome], [s.b, `${s.nome}'`]] as [Pt, string][]) {
      const [x, y] = paraTela(v, p);
      ctx.fillStyle = CORES.secao;
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "700 11px Figtree, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(t, x, y + 0.5);
    }
  }
  if (op.moldura) desenharMoldura(ctx, v, w, h);
  ctx.restore();
}

/**
 * Sem resultado (o cálculo falhou e não há um anterior): só os pontos do
 * levantamento e a plataforma tracejada, para dar para ver onde ela está e
 * trazê-la de volta.
 */
export function desenharSoPontos(ctx: Ctx, v: Vista, w: number, h: number, pontos: Pt[], plataforma: Pt[] | null): void {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(18, 32, 26, 0.75)";
  const raio = Math.max(1.4, Math.min(2.6, v.escala * 0.5));
  for (const p of pontos) {
    const [x, y] = paraTela(v, p);
    if (x < -4 || y < -4 || x > w + 4 || y > h + 4) continue;
    ctx.beginPath(); ctx.arc(x, y, raio, 0, Math.PI * 2); ctx.fill();
  }
  if (plataforma && plataforma.length >= 3) {
    ctx.lineWidth = 2; ctx.strokeStyle = CORES.plataforma; ctx.setLineDash([6, 4]);
    ctx.fillStyle = "rgba(14, 59, 43, 0.08)";
    ctx.beginPath();
    plataforma.forEach((q, i) => { const [x, y] = paraTela(v, q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Escala gráfica (canto inferior esquerdo) e seta do norte (superior direito). */
export function desenharMoldura(ctx: Ctx, v: Vista, w: number, h: number): void {
  const alvo = 110 / v.escala;
  const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((x) => x >= alvo * 0.6) ?? 1000;
  const L = nice * v.escala;
  ctx.save();
  const x0 = w - L - 66;
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillRect(x0 - 8, h - 34, L + 60, 24);
  ctx.strokeStyle = "#12201A"; ctx.lineWidth = 2; ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x0, h - 16); ctx.lineTo(x0 + L, h - 16); ctx.moveTo(x0, h - 21); ctx.lineTo(x0, h - 11); ctx.moveTo(x0 + L, h - 21); ctx.lineTo(x0 + L, h - 11); ctx.stroke();
  ctx.fillStyle = "#12201A"; ctx.font = "600 11px Figtree, system-ui, sans-serif"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(`${nice} m`, x0 + L + 6, h - 16);
  // norte
  const x = w - 24, y = 22;
  ctx.beginPath(); ctx.moveTo(x, y - 12); ctx.lineTo(x + 7, y + 8); ctx.lineTo(x, y + 4); ctx.lineTo(x - 7, y + 8); ctx.closePath(); ctx.fill();
  ctx.font = "700 10px Figtree, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText("N", x, y + 18);
  ctx.restore();
}

/** Imagem PNG do mapa (para o PDF): enquadra o contorno dos pontos. */
export async function pngDoMapa(r: ResultadoTerraplanagem, pontos: Pt[], w = 1400, h = 1000): Promise<Uint8Array | null> {
  try {
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = c.getContext("2d") as Ctx | null;
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    const v = enquadrar(r.contorno, w, h, 40);
    desenharMapa(ctx, r, v, w, h, pontos, { moldura: true });
    // desenharMapa limpa o fundo: devolve o branco por baixo
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "source-over";
    const blob = "convertToBlob" in c ? await (c as OffscreenCanvas).convertToBlob({ type: "image/png" })
      : await new Promise<Blob | null>((ok) => (c as HTMLCanvasElement).toBlob(ok, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}
