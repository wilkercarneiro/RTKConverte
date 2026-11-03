// Esboço do imóvel: imagem de satélite (Esri World Imagery, sem chave) com o
// perímetro conferido na etapa "Leitura do arquivo" desenhado por cima, a
// medida de cada lado, os nomes dos vértices, área e perímetro. É gerado no
// navegador (canvas), ANTES de o serviço nascer — não gasta crédito e não grava
// nada no servidor. As medidas saem das mesmas funções do motor (geo.ts), então
// batem com as da conferência e do memorial.
import proj4mod from "proj4";
import {
  calcularAreaHa, calcularPerimetroM, calcularSegmentos, calcularVertices, GEO_DEF, utmDef,
} from "../../supabase/functions/_shared/geo.ts";
import type { Proj4 } from "../../supabase/functions/_shared/geo.ts";

const proj4: Proj4 = (de, para, c) => (proj4mod as unknown as Proj4)(de, para, c);

export interface PontoEsboco { nome: string; e: number; n: number; h: number }

export interface LadoEsboco { parte: number; de: string; para: string; distM: number; distFmt: string; azimuteFmt: string }
export interface MedidasEsboco {
  areaHa: number;
  perimetroM: number;
  vertices: number;
  partes: { areaHa: number; perimetroM: number; vertices: number }[];
  lados: LadoEsboco[];
}

export interface Esboco {
  blob: Blob;
  url: string;
  largura: number;
  altura: number;
  medidas: MedidasEsboco;
  /** a foto de satélite não veio (sem rede/bloqueada): o desenho saiu sobre fundo neutro */
  semSatelite: boolean;
  /** lados curtos demais para cotar dentro da imagem (estão na tabela) */
  ladosSemCota: number;
  fuso: number;
}

const fmtBR = (v: number, casas: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const fmtArea = (ha: number) => `${fmtBR(ha, 4)} ha`;
export const fmtM = (m: number) => `${fmtBR(m, 2)} m`;

/** Área, perímetro e lados — pelas funções do motor; se o fuso estiver fora dos
 *  limites do SIGEF, cai no plano UTM direto (o esboço sai mesmo assim). */
export function medirEsboco(partes: PontoEsboco[][], fuso: number): MedidasEsboco {
  const out: MedidasEsboco = { areaHa: 0, perimetroM: 0, vertices: 0, partes: [], lados: [] };
  partes.forEach((pts, k) => {
    let ring: { ordem: number; eProj: number; nProj: number }[];
    try {
      ring = calcularVertices(pts.map((p) => ({ numTxt: null, e: p.e, n: p.n, h: p.h, sigmaPos: 0, sigmaH: 0 })), fuso, proj4);
    } catch {
      ring = pts.map((p, i) => ({ ordem: i, eProj: p.e, nProj: p.n }));
    }
    const segs = calcularSegmentos(ring);
    const areaHa = calcularAreaHa(ring), perimetroM = calcularPerimetroM(segs);
    out.partes.push({ areaHa, perimetroM, vertices: pts.length });
    out.areaHa += areaHa; out.perimetroM += perimetroM; out.vertices += pts.length;
    segs.forEach((s, i) => out.lados.push({
      parte: k, de: pts[i].nome, para: pts[(i + 1) % pts.length].nome, distM: s.distM, distFmt: s.distFmt, azimuteFmt: s.azimuteFmt,
    }));
  });
  return out;
}

// ---------------------------------------------------------------- satélite
const TILE = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
/** "Map data not yet available": a Esri responde 200 com este JPEG cinza onde não há foto no zoom. */
const PLACEHOLDER_BYTES = 2521;
const mx = (lon: number, z: number) => ((lon + 180) / 360) * 256 * 2 ** z;
const my = (lat: number, z: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 256 * 2 ** z;

async function baixarTile(z: number, x: number, y: number): Promise<Blob | null> {
  try {
    const r = await fetch(TILE(z, x, y), { mode: "cors" });
    if (!r.ok) return null;
    const b = await r.blob();
    return b.size === PLACEHOLDER_BYTES ? null : b;
  } catch { return null; }
}

/** O zoom mais alto (até `max`) em que há foto no centro do imóvel. */
async function zoomComFoto(lon: number, lat: number, max: number): Promise<number | null> {
  for (let z = max; z >= 12; z--) {
    const b = await baixarTile(z, Math.floor(mx(lon, z) / 256), Math.floor(my(lat, z) / 256));
    if (b) return z;
    // sem rede: não adianta descer o zoom
    if (z === max && !navigator.onLine) return null;
  }
  return null;
}

// ---------------------------------------------------------------- desenho
/** Retângulo girado: centro, meia-largura, meia-altura e ângulo. */
interface Caixa { x: number; y: number; hw: number; hh: number; ang: number }
const caixaGirada = (x: number, y: number, w: number, h: number, ang: number): Caixa => ({ x, y, hw: w / 2, hh: h / 2, ang });
const caixaReta = (x0: number, y0: number, x1: number, y1: number): Caixa => caixaGirada((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0);
const cantos = (c: Caixa): [number, number][] => {
  const co = Math.cos(c.ang), si = Math.sin(c.ang);
  return ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sy]) => [c.x + sx * c.hw * co - sy * c.hh * si, c.y + sx * c.hw * si + sy * c.hh * co]);
};
/** Teste dos eixos separadores entre duas caixas giradas. */
export function colideCaixa(a: Caixa, b: Caixa): boolean {
  const ca = cantos(a), cb = cantos(b);
  for (const ang of [a.ang, a.ang + Math.PI / 2, b.ang, b.ang + Math.PI / 2]) {
    const ex = Math.cos(ang), ey = Math.sin(ang);
    const pa = ca.map(([x, y]) => x * ex + y * ey), pb = cb.map(([x, y]) => x * ex + y * ey);
    if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
  }
  return true;
}
const dentroDoMapa = (c: Caixa, W: number, H: number) => cantos(c).every(([x, y]) => x >= 4 && y >= 4 && x <= W - 4 && y <= H - 4);

/**
 * Desenha o esboço. `partes`: cada parte é um anel E/N (UTM do `fuso`) na ordem
 * do perímetro. Devolve o PNG (para baixar) e as medidas.
 */
export async function desenharEsboco(partes: PontoEsboco[][], fuso: number, opcoes: { titulo: string; largura?: number; altura?: number }): Promise<Esboco> {
  const W = opcoes.largura ?? 1600, H = opcoes.altura ?? 1200;
  const FAIXA = 116; // faixa de informações embaixo
  const HM = H - FAIXA; // altura do mapa
  const medidas = medirEsboco(partes, fuso);
  const ud = utmDef(fuso);
  const ll = partes.map((pts) => pts.map((p) => proj4(ud, GEO_DEF, [p.e, p.n]) as [number, number]));
  const todos = ll.flat();
  const lon0 = Math.min(...todos.map((p) => p[0])), lon1 = Math.max(...todos.map((p) => p[0]));
  const lat0 = Math.min(...todos.map((p) => p[1])), lat1 = Math.max(...todos.map((p) => p[1]));
  const cLon = (lon0 + lon1) / 2, cLat = (lat0 + lat1) / 2;

  // zoom fracionário que cabe o imóvel com folga para as cotas (180 px de cada lado)
  const PAD = 130;
  const span = (z: number) => ({ w: mx(lon1, z) - mx(lon0, z), h: my(lat0, z) - my(lat1, z) });
  const s0 = span(0);
  const zf = Math.min(Math.log2((W - 2 * PAD) / Math.max(s0.w, 1e-12)), Math.log2((HM - 2 * PAD) / Math.max(s0.h, 1e-12)), 21);
  const canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("O navegador não deixou desenhar a imagem (canvas indisponível).");

  // ---- fundo: satélite (o zoom das fotos vai até onde há foto; o resto é escala) ----
  const cx = mx(cLon, zf), cy = my(cLat, zf);
  const P = (lon: number, lat: number): [number, number] => [mx(lon, zf) - cx + W / 2, my(lat, zf) - cy + HM / 2];
  ctx.fillStyle = "#2f3a33";
  ctx.fillRect(0, 0, W, HM);
  let semSatelite = true;
  const zt = await zoomComFoto(cLon, cLat, Math.min(19, Math.ceil(zf)));
  if (zt !== null) {
    const esc = 2 ** (zf - zt); // pixels do esboço por pixel do tile
    const ox = mx(cLon, zt) - (W / 2) / esc, oy = my(cLat, zt) - (HM / 2) / esc;
    const tx0 = Math.floor(ox / 256), tx1 = Math.floor((ox + W / esc) / 256);
    const ty0 = Math.floor(oy / 256), ty1 = Math.floor((oy + HM / esc) / 256);
    const total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    if (total <= 400) {
      const tiles = await Promise.all(Array.from({ length: total }, async (_, k) => {
        const tx = tx0 + (k % (tx1 - tx0 + 1)), ty = ty0 + Math.floor(k / (tx1 - tx0 + 1));
        const b = await baixarTile(zt, tx, ty);
        return b ? { tx, ty, img: await createImageBitmap(b) } : null;
      }));
      ctx.imageSmoothingQuality = "high";
      for (const t of tiles) {
        if (!t) continue;
        semSatelite = false;
        // +0.5 px de sobra: sem fresta entre tiles escalados
        ctx.drawImage(t.img, (t.tx * 256 - ox) * esc, (t.ty * 256 - oy) * esc, 256 * esc + 0.5, 256 * esc + 0.5);
      }
    }
  }
  if (semSatelite) {
    // fundo neutro com grade, para o desenho continuar legível
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HM); ctx.stroke(); }
    for (let y = 0; y < HM; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }
  // véu leve: a linha amarela e as cotas brancas aparecem em qualquer foto
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(0, 0, W, HM);

  // ---- perímetro ----
  const tela = ll.map((pts) => pts.map(([lon, lat]) => P(lon, lat)));
  for (const pts of tela) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(255, 212, 0, 0.14)";
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = "#ffd400";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  // ---- cotas dos lados (as maiores primeiro) e nomes dos vértices ----
  // Ocupação por caixas GIRADAS (teste dos eixos separadores): a caixa alinhada
  // aos eixos de um texto na diagonal é quase o dobro dele e barrava quase tudo.
  const ocupados: Caixa[] = [
    caixaReta(W - 120, 0, W, 140), // norte
    caixaReta(0, HM - 70, 330, HM), // escala
  ];
  // o ponto de cada vértice também é obstáculo: cota não cobre vértice
  for (const pts of tela) for (const [x, y] of pts) ocupados.push(caixaReta(x - 5.5, y - 5.5, x + 5.5, y + 5.5));
  const livre = (c: Caixa) => dentroDoMapa(c, W, HM) && !ocupados.some((o) => colideCaixa(o, c));
  const texto = (t: string, x: number, y: number, ang: number, fonte: string, cor: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.font = fonte;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 4.5;
    ctx.strokeText(t, 0, 0);
    ctx.fillStyle = cor;
    ctx.fillText(t, 0, 0);
    ctx.restore();
  };

  // cota sem a unidade ("251,31"), como nas plantas; a faixa diz "medidas em metros"
  const FONTE_COTA = "600 17px 'Segoe UI', Inter, Arial, sans-serif";
  const FONTE_VERT = "700 16px 'Segoe UI', Inter, Arial, sans-serif";
  const ALT_COTA = 18, ALT_VERT = 17;
  let ladosSemCota = 0;
  const cotas: { parte: number; i: number; len: number }[] = [];
  tela.forEach((pts, k) => pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    cotas.push({ parte: k, i, len: Math.hypot(b[0] - a[0], b[1] - a[1]) });
  }));
  cotas.sort((a, b) => b.len - a.len);
  // sentido de cada parte na tela (y para baixo): o "para fora" do lado
  const sentido = tela.map((pts) => {
    let s = 0;
    pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; });
    return s >= 0 ? 1 : -1;
  });
  let base = 0;
  const inicioParte = medidas.partes.map((p) => { const v = base; base += p.vertices; return v; });
  ctx.font = FONTE_COTA;
  for (const c of cotas) {
    const pts = tela[c.parte];
    const a = pts[c.i], b = pts[(c.i + 1) % pts.length];
    const t = medidas.lados[inicioParte[c.parte] + c.i].distFmt;
    const tw = ctx.measureText(t).width;
    // o texto pode passar um pouco das pontas do lado (fica afastado da linha)
    if (c.len < tw * 0.8 + 6) { ladosSemCota++; continue; }
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
    // normal para fora (tela com y para baixo); tenta fora, depois dentro
    const nx = ((b[1] - a[1]) / c.len) * sentido[c.parte], ny = (-(b[0] - a[0]) / c.len) * sentido[c.parte];
    const mxp = (a[0] + b[0]) / 2, myp = (a[1] + b[1]) / 2;
    let posto = false;
    for (const lado of [1, -1]) {
      const x = mxp + nx * 16 * lado, y = myp + ny * 16 * lado;
      const cx2 = caixaGirada(x, y, tw + 6, ALT_COTA, ang);
      if (!livre(cx2)) continue;
      ocupados.push(cx2);
      texto(t, x, y, ang, FONTE_COTA, "#ffffff");
      posto = true;
      break;
    }
    if (!posto) ladosSemCota++;
  }

  // vértices: ponto + nome (o nome some onde não cabe)
  ctx.font = FONTE_VERT;
  tela.forEach((pts, k) => {
    const n = pts.length;
    const nomes = partes[k];
    pts.forEach(([x, y], i) => {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#1b1b1b";
      ctx.stroke();
      if (n > 150) return;
      // bissetriz para fora: média das normais dos dois lados que chegam no vértice
      const ant = pts[(i - 1 + n) % n], pos = pts[(i + 1) % n];
      const n1 = norm(y - ant[1], -(x - ant[0])), n2 = norm(pos[1] - y, -(pos[0] - x));
      let dx = (n1[0] + n2[0]) * sentido[k], dy = (n1[1] + n2[1]) * sentido[k];
      const d = Math.hypot(dx, dy);
      if (d < 1e-6) { dx = n1[0] * sentido[k]; dy = n1[1] * sentido[k]; } else { dx /= d; dy /= d; }
      const t = nomes[i].nome || String(i + 1);
      const tw = ctx.measureText(t).width;
      // fora do canto; se não couber, tenta os quatro lados do ponto
      const tentativas: [number, number][] = [
        [x + dx * (12 + tw / 2), y + dy * 14],
        [x + tw / 2 + 10, y], [x - tw / 2 - 10, y], [x, y - 15], [x, y + 15],
      ];
      for (const [lx, ly] of tentativas) {
        const r = caixaGirada(lx, ly, tw + 4, ALT_VERT, 0);
        if (!livre(r)) continue;
        ocupados.push(r);
        texto(t, lx, ly, 0, FONTE_VERT, "#ffe14d");
        break;
      }
    });
  });

  // ---- norte e escala ----
  desenharNorte(ctx, W - 64, 70);
  const mpp = (156543.03392 * Math.cos((cLat * Math.PI) / 180)) / 2 ** zf; // metros por pixel
  desenharEscala(ctx, 28, HM - 34, mpp);

  // ---- faixa de informações ----
  ctx.fillStyle = "#14181b";
  ctx.fillRect(0, HM, W, FAIXA);
  ctx.fillStyle = "#ffd400";
  ctx.fillRect(0, HM, W, 4);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 26px 'Segoe UI', Inter, Arial, sans-serif";
  ctx.fillText(cortar(ctx, opcoes.titulo, 760), 28, HM + 44);
  ctx.font = "500 17px 'Segoe UI', Inter, Arial, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  const data = new Date().toLocaleDateString("pt-BR");
  ctx.fillText(`Esboço para conferência — não substitui a planta · medidas em metros · SIRGAS 2000 / UTM ${fuso}S · ${data}`, 28, HM + 76);
  ctx.fillText(semSatelite ? "Imagem de satélite indisponível (sem conexão)" : "Imagem: Esri, Maxar, Earthstar Geographics", 28, HM + 101);
  const kpis: [string, string][] = [
    ["ÁREA", fmtArea(medidas.areaHa)],
    ["PERÍMETRO", fmtM(medidas.perimetroM)],
    [medidas.partes.length > 1 ? `VÉRTICES · ${medidas.partes.length} PARTES` : "VÉRTICES", String(medidas.vertices)],
  ];
  let kx = W - 28;
  for (let i = kpis.length - 1; i >= 0; i--) {
    const [rot, val] = kpis[i];
    ctx.font = "700 30px 'Segoe UI', Inter, Arial, sans-serif";
    const wv = ctx.measureText(val).width;
    ctx.font = "600 13px 'Segoe UI', Inter, Arial, sans-serif";
    const wr = ctx.measureText(rot).width;
    const w = Math.max(wv, wr);
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(rot, kx, HM + 46);
    ctx.font = "700 30px 'Segoe UI', Inter, Arial, sans-serif";
    ctx.fillStyle = i === 0 ? "#ffd400" : "#ffffff";
    ctx.fillText(val, kx, HM + 86);
    kx -= w + 44;
  }

  const blob = await new Promise<Blob>((ok, falha) => canvas.toBlob((b) => (b ? ok(b) : falha(new Error("Não foi possível gerar o PNG."))), "image/png"));
  return { blob, url: URL.createObjectURL(blob), largura: W, altura: H, medidas, semSatelite, ladosSemCota, fuso };
}

function norm(x: number, y: number): [number, number] {
  const d = Math.hypot(x, y) || 1;
  return [x / d, y / d];
}

function cortar(ctx: CanvasRenderingContext2D, t: string, max: number): string {
  if (ctx.measureText(t).width <= max) return t;
  let s = t;
  while (s.length > 4 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

function desenharNorte(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.fillStyle = "rgba(20,24,27,0.72)";
  ctx.beginPath();
  ctx.arc(x, y, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - 30); ctx.lineTo(x + 13, y + 14); ctx.lineTo(x, y + 6); ctx.closePath();
  ctx.fillStyle = "#ffd400"; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y - 30); ctx.lineTo(x - 13, y + 14); ctx.lineTo(x, y + 6); ctx.closePath();
  ctx.fillStyle = "#ffffff"; ctx.fill();
  ctx.font = "700 15px 'Segoe UI', Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("N", x, y + 32);
  ctx.restore();
}

function desenharEscala(ctx: CanvasRenderingContext2D, x: number, y: number, mpp: number) {
  // comprimento "redondo" perto de 220 px
  const alvo = 220 * mpp;
  const p = 10 ** Math.floor(Math.log10(alvo));
  const m = [1, 2, 5, 10].map((k) => k * p).filter((v) => v <= alvo).pop() ?? p;
  const px = m / mpp;
  ctx.save();
  ctx.fillStyle = "rgba(20,24,27,0.72)";
  ctx.fillRect(x - 12, y - 30, px + 24 + 70, 46);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? "#ffffff" : "#1b1b1b";
    ctx.fillRect(x + (px / 4) * i, y, px / 4, 8);
  }
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, px, 8);
  ctx.font = "600 14px 'Segoe UI', Inter, Arial, sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "left";
  ctx.fillText("0", x - 3, y - 8);
  ctx.textAlign = "center";
  ctx.fillText(m >= 1000 ? `${fmtBR(m / 1000, m % 1000 ? 1 : 0)} km` : `${fmtBR(m, 0)} m`, x + px, y - 8);
  ctx.restore();
}
