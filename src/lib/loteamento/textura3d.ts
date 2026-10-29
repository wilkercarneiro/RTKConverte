// O "chão" da maquete 3D: uma imagem do projeto pintada por cima do terreno
// (sem z-fighting — o desenho É a textura). Fora da gleba, a imagem de
// satélite (Esri World Imagery, sem chave); dentro, o projeto: lotes com
// número, pista de asfalto com faixa, calçada, áreas verdes, APP, a divisa.
// Os modos de análise trocam só o que é pintado dentro da gleba:
// declividade (faixas da Lei 6.766), corte/aterro e curvas de nível.
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import { centroide, comprimento, pontoNaPolilinha } from "./geom.ts";
import type { Poligono, Pt } from "./geom.ts";
import type { Resultado } from "./calculo.ts";
import type { Cena, Grade3D } from "./cena3d.ts";
import { livreDaGleba } from "./cena3d.ts";
import { paraPlano, paraUtm } from "./plano.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];
const TILE = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

export type ModoChao = "projeto" | "declividade" | "terraplenagem" | "curvas";

type Ctx = CanvasRenderingContext2D;

/** Quadro da textura: plano ↔ pixel (y do plano para cima, do canvas para baixo). */
export interface Quadro {
  largura: number;
  altura: number;
  x0: number;
  y0: number;
  W: number;
  H: number;
}

export function quadroDaGrade(g: Grade3D, maxPx: number): Quadro {
  const W = (g.nx - 1) * g.passo, H = (g.ny - 1) * g.passo;
  // ~12 cm por pixel, até o limite da placa de vídeo
  const k = Math.min(maxPx / Math.max(W, H), 1 / 0.12);
  return { largura: Math.round(W * k), altura: Math.round(H * k), x0: g.x0, y0: g.y0, W, H };
}

const px = (q: Quadro, p: Pt): Pt => [((p[0] - q.x0) / q.W) * q.largura, (1 - (p[1] - q.y0) / q.H) * q.altura];
const escala = (q: Quadro) => q.largura / q.W;

function caminho(ctx: Ctx, q: Quadro, pols: Poligono[]): void {
  ctx.beginPath();
  for (const pg of pols) for (const a of [pg.ext, ...pg.furos]) {
    a.forEach((p, i) => { const [x, y] = px(q, p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
  }
}

function linha(ctx: Ctx, q: Quadro, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => { const [x, y] = px(q, p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
}

/** Ruído fino (textura de grama/asfalto) num canvas pequeno, repetido como padrão. */
function padraoRuido(ctx: Ctx, base: string, amp: number, tam = 128): CanvasPattern | string {
  if (typeof document === "undefined") return base;
  const c = document.createElement("canvas");
  c.width = c.height = tam;
  const x = c.getContext("2d");
  if (!x) return base;
  x.fillStyle = base;
  x.fillRect(0, 0, tam, tam);
  const img = x.getImageData(0, 0, tam, tam);
  let s = 12345;
  for (let i = 0; i < img.data.length; i += 4) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const d = ((s / 2147483648) - 0.5) * amp;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + d));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + d));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + d));
  }
  x.putImageData(img, 0, 0);
  return ctx.createPattern(c, "repeat") ?? base;
}

// ---------------------------------------------------------------------------
// Satélite
// ---------------------------------------------------------------------------

/**
 * Pinta a imagem de satélite no quadro todo. Cada tile (Web Mercator) é
 * encaixado por uma afim de 3 cantos (lon/lat → UTM → plano → pixel).
 * Devolve false sem rede.
 */
export async function pintarSatelite(ctx: Ctx, q: Quadro, res: Resultado, fuso: number): Promise<boolean> {
  try {
    const ud = utmDef(fuso);
    const ll = (p: Pt) => proj(ud, GEO_DEF, paraUtm(res.plano, p));
    const plano = (lon: number, lat: number) => paraPlano(res.plano, proj(GEO_DEF, ud, [lon, lat]));
    const cantos = [[q.x0, q.y0], [q.x0 + q.W, q.y0 + q.H], [q.x0, q.y0 + q.H], [q.x0 + q.W, q.y0]].map((p) => ll(p as Pt));
    const lon0 = Math.min(...cantos.map((c) => c[0])), lon1 = Math.max(...cantos.map((c) => c[0]));
    const lat0 = Math.min(...cantos.map((c) => c[1])), lat1 = Math.max(...cantos.map((c) => c[1]));
    const tx = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
    const ty = (lat: number, z: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
    let z = 18;
    const conta = (zz: number) => (Math.floor(tx(lon1, zz)) - Math.floor(tx(lon0, zz)) + 1) * (Math.floor(ty(lat0, zz)) - Math.floor(ty(lat1, zz)) + 1);
    while (z > 12 && conta(z) > 64) z--;
    const x0 = Math.floor(tx(lon0, z)), x1 = Math.floor(tx(lon1, z)), y0 = Math.floor(ty(lat1, z)), y1 = Math.floor(ty(lat0, z));
    const lonDe = (x: number) => (x / 2 ** z) * 360 - 180;
    const latDe = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
    let ok = 0;
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), 15000);
    await Promise.all(Array.from({ length: (x1 - x0 + 1) * (y1 - y0 + 1) }, async (_, k) => {
      const x = x0 + (k % (x1 - x0 + 1)), y = y0 + Math.floor(k / (x1 - x0 + 1));
      try {
        const r = await fetch(TILE(z, x, y), { mode: "cors", signal: ctl.signal });
        if (!r.ok) return;
        const img = await createImageBitmap(await r.blob());
        // afim pelos cantos NO, NE e SO do tile
        const [ax, ay] = px(q, plano(lonDe(x), latDe(y)));
        const [bx, by] = px(q, plano(lonDe(x + 1), latDe(y)));
        const [cx, cy] = px(q, plano(lonDe(x), latDe(y + 1)));
        ctx.save();
        ctx.setTransform((bx - ax) / 256, (by - ay) / 256, (cx - ax) / 256, (cy - ay) / 256, ax, ay);
        // meio pixel de sobra: sem fresta entre os tiles
        ctx.drawImage(img, -0.5, -0.5, 257, 257);
        ctx.restore();
        ok++;
      } catch { /* tile faltando: fica o fundo */ }
    }));
    clearTimeout(prazo);
    return ok > 0;
  } catch {
    return false;
  }
}

/** A divisa da gleba (amarela), por cima do que já está pintado. */
export function pintarDivisa(ctx: Ctx, q: Quadro, res: Resultado): void {
  ctx.save();
  ctx.strokeStyle = COR.gleba;
  ctx.lineWidth = Math.max(2, 0.5 * escala(q));
  ctx.setLineDash([2.5 * escala(q), 1.2 * escala(q)]);
  caminho(ctx, q, [res.gleba]);
  ctx.stroke();
  ctx.restore();
}

/** Fundo sem satélite: campo (grama seca e terra) com o relevo sombreado. */
export function pintarCampo(ctx: Ctx, q: Quadro, g: Grade3D): void {
  ctx.fillStyle = padraoRuido(ctx, "#9aa874", 26);
  ctx.fillRect(0, 0, q.largura, q.altura);
  sombrearRelevo(ctx, q, g, 0.35);
}

/** Sombreado do relevo (luz de noroeste), por cima do que já está pintado. */
function sombrearRelevo(ctx: Ctx, q: Quadro, g: Grade3D, forca: number): void {
  if (typeof document === "undefined") return;
  const c = document.createElement("canvas");
  c.width = g.nx;
  c.height = g.ny;
  const x = c.getContext("2d");
  if (!x) return;
  const img = x.createImageData(g.nx, g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const k = j * g.nx + i;
    const ia = Math.max(0, i - 1), ib = Math.min(g.nx - 1, i + 1), ja = Math.max(0, j - 1), jb = Math.min(g.ny - 1, j + 1);
    const dx = (g.final[j * g.nx + ib] - g.final[j * g.nx + ia]) / ((ib - ia) * g.passo);
    const dy = (g.final[jb * g.nx + i] - g.final[ja * g.nx + i]) / ((jb - ja) * g.passo);
    // normal · luz (NO, 45°)
    const nz = 1 / Math.hypot(dx * 3, dy * 3, 1);
    const l = (-dx * 3 * -0.5 + -dy * 3 * 0.5) * nz + nz * 0.707;
    const v = Math.max(-1, Math.min(1, (l - 0.707) * 2.5));
    const o = ((g.ny - 1 - j) * g.nx + i) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v > 0 ? 255 : 0;
    img.data[o + 3] = Math.abs(v) * 255 * forca;
  }
  x.putImageData(img, 0, 0);
  desenharGrade(ctx, q, g, c);
}

/** Desenha um canvas de nx × ny (um pixel por NÓ da grade) alinhado com o quadro. */
function desenharGrade(ctx: Ctx, q: Quadro, g: Grade3D, c: HTMLCanvasElement): void {
  const sx = q.largura / (g.nx - 1), sy = q.altura / (g.ny - 1);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(c, -sx / 2, -sy / 2, g.nx * sx, g.ny * sy);
}

// ---------------------------------------------------------------------------
// O projeto dentro da gleba
// ---------------------------------------------------------------------------

const COR = {
  lote: "#98b67f",
  loteAlt: "#91b078",
  divisaLote: "rgba(255,255,255,0.92)",
  numero: "rgba(38,52,36,0.78)",
  asfalto: "#43474d",
  faixa: "rgba(245,245,240,0.85)",
  calcada: "#d9d3c5",
  verde: "#6f9f5c",
  lazer: "#86b866",
  institucional: "#e3d4b0",
  app: "#4b7341",
  livre: "#b3c995",
  gleba: "#ffd23f",
  restricao: "rgba(224,74,58,0.9)",
};

export interface DadosPintura {
  res: Resultado;
  cena: Cena;
  modo: ModoChao;
  /** lote destacado (índice) — fica com contorno dourado na textura */
  destaque?: number;
}

/**
 * Máscara de materiais para a textura de detalhe da maquete: R = pista,
 * G = calçada, B = grama (lotes e áreas verdes). Fora da gleba, preto.
 */
export function pintarMateriais(ctx: Ctx, q: Quadro, res: Resultado, cena: Cena): void {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, q.largura, q.altura);
  ctx.save();
  caminho(ctx, q, [res.gleba]);
  ctx.clip("evenodd");
  ctx.fillStyle = "#0000ff";
  caminho(ctx, q, [res.gleba]);
  ctx.fill("evenodd");
  // institucional: chão batido/piso, sem grama
  ctx.fillStyle = "#000";
  for (const a of res.areas) if (a.tipo === "institucional") { caminho(ctx, q, a.pols); ctx.fill("evenodd"); }
  ctx.fillStyle = "#00ff00";
  caminho(ctx, q, cena.ruas);
  ctx.fill("evenodd");
  ctx.fillStyle = "#ff0000";
  caminho(ctx, q, cena.pista);
  ctx.fill("evenodd");
  ctx.restore();
}

/** Pinta o projeto dentro da gleba (o fundo/satélite já está no canvas). */
export function pintarProjeto(ctx: Ctx, q: Quadro, d: DadosPintura): void {
  const { res, cena, modo } = d;
  const k = escala(q);
  ctx.save();
  caminho(ctx, q, [res.gleba]);
  ctx.clip("evenodd");

  // base: o que não é lote nem rua (canteiros, sobras) — grama
  ctx.fillStyle = padraoRuido(ctx, COR.livre, 20);
  caminho(ctx, q, [res.gleba]);
  ctx.fill("evenodd");

  // lotes (grama em dois tons alternados por quadra, como maquete)
  const grama = padraoRuido(ctx, COR.lote, 18), grama2 = padraoRuido(ctx, COR.loteAlt, 18);
  res.quadras.forEach((qd, iq) => {
    ctx.fillStyle = iq % 2 ? grama2 : grama;
    caminho(ctx, q, qd.lotes.map((l) => l.pol));
    ctx.fill("evenodd");
  });

  // áreas públicas
  for (const a of res.areas) {
    const cor = a.tipo === "app" ? COR.app : a.tipo === "lazer" ? COR.lazer : a.tipo === "institucional" ? COR.institucional : COR.verde;
    ctx.fillStyle = padraoRuido(ctx, cor, a.tipo === "app" ? 40 : 22);
    caminho(ctx, q, a.pols);
    ctx.fill("evenodd");
  }
  for (const s of livreDaGleba(res)) { ctx.fillStyle = padraoRuido(ctx, COR.livre, 20); caminho(ctx, q, [s]); ctx.fill("evenodd"); }

  // ruas: calçada (caixa) e asfalto (pista)
  ctx.fillStyle = padraoRuido(ctx, COR.calcada, 16);
  caminho(ctx, q, cena.ruas);
  ctx.fill("evenodd");
  ctx.fillStyle = padraoRuido(ctx, COR.asfalto, 22);
  caminho(ctx, q, cena.pista);
  ctx.fill("evenodd");
  // faixa central tracejada (só onde há pista larga)
  ctx.save();
  caminho(ctx, q, cena.pista);
  ctx.clip("evenodd");
  ctx.strokeStyle = COR.faixa;
  ctx.lineWidth = 0.14 * k;
  ctx.setLineDash([3 * k, 4 * k]);
  for (const r of res.ruas) { linha(ctx, q, r.eixo); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.restore();

  // modos de análise: pintam por cima dos lotes
  if (modo === "declividade") pintarCampoGrade(ctx, q, cena.grade, (g, kk) => {
    if (!g.gleba[kk] || g.rua[kk]) return null;
    const s = g.decl[kk];
    return s < 8 ? [76, 175, 80, 0.78] : s < 15 ? [156, 204, 101, 0.8] : s < 30 ? [255, 179, 0, 0.85] : [229, 57, 53, 0.9];
  });
  if (modo === "terraplenagem") pintarCampoGrade(ctx, q, cena.grade, (g, kk) => {
    if (!g.gleba[kk]) return null;
    const dz = g.final[kk] - g.natural[kk];
    if (Math.abs(dz) < 0.05) return g.rua[kk] ? null : [255, 255, 255, 0.35];
    const t = Math.min(1, Math.abs(dz) / 2.5);
    return dz > 0 ? [40, 110, 230, 0.35 + 0.6 * t] : [225, 60, 40, 0.35 + 0.6 * t];
  });

  // divisas dos lotes e número
  ctx.strokeStyle = COR.divisaLote;
  ctx.lineWidth = Math.max(1, 0.22 * k);
  ctx.lineJoin = "round";
  caminho(ctx, q, res.lotes.map((l) => l.pol));
  ctx.stroke();
  if (modo === "curvas") {
    // o desenho do projeto clareia para as curvas aparecerem
    ctx.fillStyle = "rgba(250,248,240,0.45)";
    caminho(ctx, q, [res.gleba]);
    ctx.fill("evenodd");
  }

  ctx.fillStyle = COR.numero;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const l of res.lotes) {
    const c = centroide(l.pol.ext);
    const tam = Math.max(1.4, Math.min(3.2, Math.sqrt(l.area) * 0.16));
    ctx.font = `600 ${Math.round(tam * k)}px Inter, system-ui, sans-serif`;
    const [x, y] = px(q, c);
    ctx.fillText(String(l.numero), x, y);
  }

  // faixa non aedificandi (rodovia/ferrovia): tracejado vermelho
  ctx.strokeStyle = COR.restricao;
  ctx.lineWidth = Math.max(1, 0.3 * k);
  ctx.setLineDash([2 * k, 1.5 * k]);
  for (const f of res.faixasRestricao) { linha(ctx, q, f.linha); ctx.stroke(); }
  ctx.setLineDash([]);

  // destaque do lote selecionado
  if (d.destaque !== undefined && d.destaque >= 0 && res.lotes[d.destaque]) {
    ctx.strokeStyle = "#ffcc33";
    ctx.lineWidth = Math.max(2, 0.6 * k);
    caminho(ctx, q, [res.lotes[d.destaque].pol]);
    ctx.stroke();
  }
  ctx.restore();

  // curvas de nível no terreno todo (no satélite em volta, mais claras)
  if (modo === "curvas") pintarCurvas(ctx, q, cena.grade, res);

  // divisa da gleba
  ctx.strokeStyle = COR.gleba;
  ctx.lineWidth = Math.max(2, 0.55 * k);
  caminho(ctx, q, [res.gleba]);
  ctx.stroke();

  // nome das ruas, ao longo do eixo
  for (const r of res.ruas) {
    const L = comprimento(r.eixo);
    if (L < 30) continue;
    const vezes = Math.max(1, Math.floor(L / 140));
    for (let n = 0; n < vezes; n++) {
      const { pt, dir } = pontoNaPolilinha(r.eixo, (L * (n + 0.5)) / vezes);
      const [x, y] = px(q, pt);
      let ang = Math.atan2(-dir[1], dir[0]);
      if (ang > Math.PI / 2) ang -= Math.PI;
      if (ang < -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.font = `700 ${Math.round(1.9 * k)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 0.35 * k;
      ctx.strokeStyle = "rgba(30,32,36,0.85)";
      ctx.strokeText(r.nome.toUpperCase(), 0, 0);
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillText(r.nome.toUpperCase(), 0, 0);
      ctx.restore();
    }
  }
}

/** Pinta uma cor por nó da grade (declividade, corte/aterro), suavizada. */
function pintarCampoGrade(ctx: Ctx, q: Quadro, g: Grade3D, cor: (g: Grade3D, k: number) => [number, number, number, number] | null): void {
  if (typeof document === "undefined") return;
  const c = document.createElement("canvas");
  c.width = g.nx;
  c.height = g.ny;
  const x = c.getContext("2d");
  if (!x) return;
  const img = x.createImageData(g.nx, g.ny);
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const v = cor(g, j * g.nx + i);
    if (!v) continue;
    const o = ((g.ny - 1 - j) * g.nx + i) * 4;
    img.data[o] = v[0]; img.data[o + 1] = v[1]; img.data[o + 2] = v[2]; img.data[o + 3] = v[3] * 255;
  }
  x.putImageData(img, 0, 0);
  desenharGrade(ctx, q, g, c);
}

/** Intervalo "redondo" das curvas de nível para o desnível. */
export function intervaloCurvas(desnivel: number): number {
  const alvo = desnivel / 30;
  for (const v of [0.25, 0.5, 1, 2, 5, 10, 20]) if (v >= alvo) return v;
  return 50;
}

/** Desnível dentro da gleba (é ele que decide o intervalo das curvas). */
export function desnivelDaGleba(g: Grade3D): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < g.final.length; k++) if (g.gleba[k]) { min = Math.min(min, g.final[k]); max = Math.max(max, g.final[k]); }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/** Curvas de nível do terreno projetado (marching squares), mestras a cada 5. */
function pintarCurvas(ctx: Ctx, q: Quadro, g: Grade3D, res: Resultado): void {
  let min = Infinity, max = -Infinity;
  for (let k = 0; k < g.final.length; k++) { min = Math.min(min, g.final[k]); max = Math.max(max, g.final[k]); }
  const dg = desnivelDaGleba(g);
  const iv = intervaloCurvas(dg.max - dg.min);
  const k = escala(q);
  // dentro da gleba, marrom forte; fora, sobre o satélite, branco suave
  for (const dentro of [false, true]) {
    ctx.save();
    ctx.beginPath();
    if (dentro) caminho(ctx, q, [res.gleba]);
    else { ctx.rect(0, 0, q.largura, q.altura); res.gleba.ext.forEach((p, i) => { const [x, y] = px(q, p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); }
    ctx.clip("evenodd");
    desenharCurvas(ctx, q, g, min, max, iv, k, dentro);
    ctx.restore();
  }
}

function desenharCurvas(ctx: Ctx, q: Quadro, g: Grade3D, min: number, max: number, iv: number, k: number, dentro: boolean): void {
  const P = (i: number, j: number): Pt => [g.x0 + i * g.passo, g.y0 + j * g.passo];
  for (let n = Math.ceil(min / iv); n * iv <= max; n++) {
    const z = n * iv;
    const mestra = n % 5 === 0;
    ctx.strokeStyle = dentro ? (mestra ? "rgba(84,40,8,1)" : "rgba(110,60,22,0.9)") : (mestra ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.45)");
    ctx.lineWidth = Math.max(1.4, (mestra ? 0.65 : 0.32) * k);
    const rotulos: { p: Pt; ang: number }[] = [];
    ctx.beginPath();
    for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
      const a = g.final[j * g.nx + i], b = g.final[j * g.nx + i + 1], c = g.final[(j + 1) * g.nx + i + 1], dd = g.final[(j + 1) * g.nx + i];
      const cs = (a > z ? 1 : 0) | (b > z ? 2 : 0) | (c > z ? 4 : 0) | (dd > z ? 8 : 0);
      if (cs === 0 || cs === 15) continue;
      const e = (v1: number, v2: number, p1: Pt, p2: Pt): Pt => { const t = (z - v1) / (v2 - v1); return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t]; };
      const pa = P(i, j), pb = P(i + 1, j), pc = P(i + 1, j + 1), pd = P(i, j + 1);
      const eB = () => e(a, b, pa, pb), eR = () => e(b, c, pb, pc), eT = () => e(dd, c, pd, pc), eL = () => e(a, dd, pa, pd);
      const segs: [Pt, Pt][] = [];
      switch (cs) {
        case 1: case 14: segs.push([eL(), eB()]); break;
        case 2: case 13: segs.push([eB(), eR()]); break;
        case 3: case 12: segs.push([eL(), eR()]); break;
        case 4: case 11: segs.push([eR(), eT()]); break;
        case 5: segs.push([eL(), eT()], [eB(), eR()]); break;
        case 6: case 9: segs.push([eB(), eT()]); break;
        case 7: case 8: segs.push([eL(), eT()]); break;
        case 10: segs.push([eL(), eB()], [eR(), eT()]); break;
      }
      for (const [p1, p2] of segs) {
        const [x1, y1] = px(q, p1); const [x2, y2] = px(q, p2); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
        // cota escrita na mestra, uma a cada ~70 m
        if (mestra && dentro && !rotulos.some((r) => Math.hypot(r.p[0] - p1[0], r.p[1] - p1[1]) < 70)) {
          let ang = Math.atan2(y2 - y1, x2 - x1);
          if (ang > Math.PI / 2) ang -= Math.PI;
          if (ang < -Math.PI / 2) ang += Math.PI;
          rotulos.push({ p: p1, ang });
        }
      }
    }
    ctx.stroke();
    for (const r of rotulos) {
      const [x, y] = px(q, r.p);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r.ang);
      ctx.font = `700 ${Math.round(1.6 * k)}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = 0.45 * k;
      ctx.strokeStyle = "rgba(255,250,240,0.95)";
      const txt = iv < 1 ? z.toFixed(1).replace(".", ",") : String(Math.round(z));
      ctx.strokeText(txt, 0, 0);
      ctx.fillStyle = "rgba(84,40,8,1)";
      ctx.fillText(txt, 0, 0);
      ctx.restore();
    }
  }
}
