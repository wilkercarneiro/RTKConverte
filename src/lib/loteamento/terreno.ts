// Relevo do terreno: onde é baixada, encosta ou buraco.
//
// O TXT do perímetro só traz a cota dos marcos da divisa — por dentro da gleba
// não há nada. Por isso a grade de cotas vem do modelo digital de elevação
// (tiles "terrarium" da AWS, os mesmos do relevo do mapa interativo, ~30 m de
// resolução de origem) e é calibrada pelas cotas do levantamento: o desnível
// relativo é do modelo, o nível absoluto é do GNSS.
//
// A grade é gravada no projeto (UTM), então a escolha das áreas verdes é
// reproduzível e roda no Web Worker sem rede.
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import type { Pt } from "./geom.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

export interface GradeTerreno {
  /** canto sudoeste em UTM */
  e0: number;
  n0: number;
  passo: number;
  nx: number;
  ny: number;
  /** cotas (m), linha a linha a partir do sul, uma casa decimal */
  h: number[];
  fonte: "dem" | "perimetro";
  /** diferença média entre o levantamento e o modelo, já aplicada */
  calibracao: number;
}

export function cotaEm(g: GradeTerreno, utm: Pt): number {
  const x = Math.max(0, Math.min(g.nx - 1.001, (utm[0] - g.e0) / g.passo));
  const y = Math.max(0, Math.min(g.ny - 1.001, (utm[1] - g.n0) / g.passo));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const v = (a: number, b: number) => g.h[b * g.nx + a];
  return v(i, j) * (1 - fx) * (1 - fy) + v(i + 1, j) * fx * (1 - fy) + v(i, j + 1) * (1 - fx) * fy + v(i + 1, j + 1) * fx * fy;
}

/** Declividade em % (pela diferença central a ±meio passo). */
export function declividadeEm(g: GradeTerreno, utm: Pt): number {
  const d = Math.max(5, g.passo);
  const dx = (cotaEm(g, [utm[0] + d, utm[1]]) - cotaEm(g, [utm[0] - d, utm[1]])) / (2 * d);
  const dy = (cotaEm(g, [utm[0], utm[1] + d]) - cotaEm(g, [utm[0], utm[1] - d])) / (2 * d);
  return 100 * Math.hypot(dx, dy);
}

/** Quanto o ponto está abaixo da vizinhança (m, positivo = buraco/baixada). */
export function depressaoEm(g: GradeTerreno, utm: Pt, raio = 45): number {
  let s = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4;
    s += cotaEm(g, [utm[0] + raio * Math.cos(a), utm[1] + raio * Math.sin(a)]);
  }
  return s / 8 - cotaEm(g, utm);
}

export function faixaDeCotas(g: GradeTerreno): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const v of g.h) { if (v < min) min = v; if (v > max) max = v; }
  return { min, max };
}

/** Grade só pelos marcos do perímetro (sem rede): inverso da distância ao quadrado. */
export function gradeDoPerimetro(pts: Pt[], hs: number[], passo = 20): GradeTerreno | null {
  const val = pts.map((p, i) => ({ p, h: hs[i] })).filter((x) => Number.isFinite(x.h) && x.h !== 0);
  if (val.length < 3) return null;
  const { e0, n0, nx, ny } = moldura(pts, passo);
  const h: number[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const q: Pt = [e0 + i * passo, n0 + j * passo];
    let sw = 0, sh = 0;
    for (const v of val) { const d2 = (v.p[0] - q[0]) ** 2 + (v.p[1] - q[1]) ** 2 + 1; sw += 1 / d2; sh += v.h / d2; }
    h.push(Math.round((sh / sw) * 10) / 10);
  }
  return { e0, n0, passo, nx, ny, h, fonte: "perimetro", calibracao: 0 };
}

function moldura(pts: Pt[], passo: number) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const e0 = Math.min(...xs) - 60, n0 = Math.min(...ys) - 60;
  const nx = Math.ceil((Math.max(...xs) + 60 - e0) / passo) + 1;
  const ny = Math.ceil((Math.max(...ys) + 60 - n0) / passo) + 1;
  return { e0, n0, nx, ny };
}

const URL_TILE = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

/**
 * Busca o relevo da gleba no modelo digital de elevação (navegador). Devolve a
 * grade calibrada pelas cotas do levantamento, ou a grade só do perímetro se a
 * rede falhar.
 */
export async function buscarTerreno(pts: Pt[], hs: number[], fuso: number): Promise<GradeTerreno | null> {
  const ud = utmDef(fuso);
  const larg = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  const alt = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
  const passo = Math.max(8, Math.ceil(Math.max(larg, alt) / 160));
  const { e0, n0, nx, ny } = moldura(pts, passo);
  try {
    const cantos = [[e0, n0], [e0 + nx * passo, n0 + ny * passo]].map((c) => proj(ud, GEO_DEF, c as [number, number]));
    let z = 15;
    const tx = (lon: number, zz: number) => ((lon + 180) / 360) * 2 ** zz;
    const ty = (lat: number, zz: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** zz;
    const conta = (zz: number) => (Math.floor(tx(cantos[1][0], zz)) - Math.floor(tx(cantos[0][0], zz)) + 1) * (Math.floor(ty(cantos[0][1], zz)) - Math.floor(ty(cantos[1][1], zz)) + 1);
    while (z > 10 && conta(z) > 36) z--;
    const x0 = Math.floor(tx(cantos[0][0], z)), x1 = Math.floor(tx(cantos[1][0], z));
    const y0 = Math.floor(ty(cantos[1][1], z)), y1 = Math.floor(ty(cantos[0][1], z));
    const tiles = new Map<string, Uint8ClampedArray>();
    const ctl = new AbortController();
    const prazo = setTimeout(() => ctl.abort(), 12000);
    await Promise.all(
      Array.from({ length: (x1 - x0 + 1) * (y1 - y0 + 1) }, (_, k) => {
        const x = x0 + (k % (x1 - x0 + 1)), y = y0 + Math.floor(k / (x1 - x0 + 1));
        return fetch(URL_TILE(z, x, y), { signal: ctl.signal })
          .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
          .then((b) => createImageBitmap(b))
          .then((img) => {
            const c = new OffscreenCanvas(256, 256);
            const ctx = c.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            tiles.set(`${x}/${y}`, ctx.getImageData(0, 0, 256, 256).data);
          });
      }),
    );
    clearTimeout(prazo);
    const cotaDem = (e: number, n: number): number => {
      const [lon, lat] = proj(ud, GEO_DEF, [e, n]);
      const fx = tx(lon, z), fy = ty(lat, z);
      const x = Math.floor(fx), y = Math.floor(fy);
      const d = tiles.get(`${x}/${y}`);
      if (!d) return NaN;
      const px = Math.min(255, Math.floor((fx - x) * 256)), py = Math.min(255, Math.floor((fy - y) * 256));
      const o = (py * 256 + px) * 4;
      return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
    };
    const h: number[] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h.push(cotaDem(e0 + i * passo, n0 + j * passo));
    if (h.some((v) => !Number.isFinite(v))) throw new Error("tile faltando");
    // calibra pelo levantamento (mediana da diferença nos marcos)
    const difs = pts.map((p, i) => (Number.isFinite(hs[i]) && hs[i] !== 0 ? hs[i] - cotaDem(p[0], p[1]) : NaN)).filter(Number.isFinite).sort((a, b) => a - b);
    const calibracao = difs.length ? difs[Math.floor(difs.length / 2)] : 0;
    return { e0, n0, passo, nx, ny, h: h.map((v) => Math.round((v + calibracao) * 10) / 10), fonte: "dem", calibracao };
  } catch {
    return gradeDoPerimetro(pts, hs);
  }
}
