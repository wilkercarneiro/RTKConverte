// Curvas de nível do imóvel (serviço GEO): modelo de terreno e marching squares.
//
// O MÉTODO DO MODELO DE TERRENO
// -----------------------------
// O levantamento GNSS só tem altitude nos vértices do perímetro; o miolo do
// imóvel não foi medido. O relevo de fundo é o mesmo do loteamento: o modelo
// digital de elevação público (tiles "terrarium" da AWS — SRTM/NASADEM, pixel de
// ~30 m), já trazido para o nível do levantamento pela MEDIANA da diferença nos
// marcos (`buscarTerreno` em loteamento/terreno.ts). Essa mediana absorve a
// ondulação do geoide (o h do GNSS é elipsoidal, o modelo é ortométrico) e o
// viés do modelo na região. Aqui o fundo ganha mais duas correções:
//
//   1. tendência: um plano ajustado por mínimos quadrados aos resíduos dos
//      marcos (levantamento − modelo). Tira inclinação sistemática do modelo
//      (comum em área de mata, onde o radar mede a copa).
//   2. correção local: o resto do resíduo é espalhado pelo inverso da distância
//      ao quadrado com um "peso de fundo" 1/R² (R = raio de influência). Perto
//      de um marco a correção é a dele (bate exato); a ~R de todos os marcos ela
//      cai pela metade e, no miolo, sobra só o plano de tendência.
//
// A grade é corrigida e conferida de novo nos marcos (interpolação bilinear)
// algumas vezes, para a GRADE — e não só a fórmula — passar nos vértices.
// O levantamento manda: nos marcos o modelo tem a cota medida. No miolo a cota
// é a do modelo público corrigido: vale como indicação do relevo, não como
// levantamento planialtimétrico. A dispersão dos resíduos (RMS) é o indicador
// honesto de quanto o modelo público se afasta do terreno naquele imóvel.
//
// Tudo aqui é puro (sem DOM) — roda no Web Worker e no node --test.

export type Pt = [number, number];

/** Grade regular de cotas em UTM (canto sudoeste, linha a linha a partir do sul). */
export interface GradeCotas {
  e0: number;
  n0: number;
  passo: number;
  nx: number;
  ny: number;
  h: ArrayLike<number>;
}

export interface Curva {
  cota: number;
  mestra: boolean;
  /** polilinha em UTM */
  pts: Pt[];
  fechada: boolean;
}

export interface EstatAjuste {
  /** marcos com altitude usados */
  n: number;
  /** resíduo levantamento − modelo (já com a mediana), antes do ajuste */
  rmsAntes: number;
  maxAntes: number;
  /** diferença que sobrou nos marcos depois do ajuste (grade, bilinear) */
  maxDepois: number;
  /** raio de influência da correção local (m) */
  raio: number;
}

// ---------------------------------------------------------------------------
// Grade
// ---------------------------------------------------------------------------

/** Cota bilinear na grade (fora dela, a borda). */
export function cotaBilinear(g: GradeCotas, p: Pt): number {
  const x = Math.max(0, Math.min(g.nx - 1.000001, (p[0] - g.e0) / g.passo));
  const y = Math.max(0, Math.min(g.ny - 1.000001, (p[1] - g.n0) / g.passo));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const v = (a: number, b: number) => g.h[b * g.nx + a];
  return v(i, j) * (1 - fx) * (1 - fy) + v(i + 1, j) * fx * (1 - fy) + v(i, j + 1) * (1 - fx) * fy + v(i + 1, j + 1) * fx * fy;
}

/** Cota bicúbica (Catmull-Rom): sem os vincos da bilinear ao reamostrar o modelo de ~30 m. */
export function cotaBicubica(g: GradeCotas, p: Pt): number {
  const v = (i: number, j: number) => g.h[Math.max(0, Math.min(g.ny - 1, j)) * g.nx + Math.max(0, Math.min(g.nx - 1, i))];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  const x = Math.max(0, Math.min(g.nx - 1.000001, (p[0] - g.e0) / g.passo));
  const y = Math.max(0, Math.min(g.ny - 1.000001, (p[1] - g.n0) / g.passo));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const linha = (jj: number) => cr(v(i - 1, jj), v(i, jj), v(i + 1, jj), v(i + 2, jj), fx);
  return cr(linha(j - 1), linha(j), linha(j + 1), linha(j + 2), fy);
}

/**
 * Suavização leve (média móvel separável, duas passadas ≈ gaussiana) de raio
 * `raioM` metros. Usada no modelo público ANTES do ajuste: tira o serrilhado
 * da amostragem dos tiles (pixel inteiro) sem mexer no relevo de ~30 m.
 */
export function suavizar(g: GradeCotas & { h: Float64Array }, raioM: number): void {
  const r = Math.round(raioM / g.passo);
  if (r < 1) return;
  const { nx, ny } = g;
  const tmp = new Float64Array(nx * ny);
  const passada = (de: Float64Array, para: Float64Array, horizontal: boolean) => {
    const n1 = horizontal ? ny : nx, n2 = horizontal ? nx : ny;
    const idx = (a: number, b: number) => (horizontal ? a * nx + b : b * nx + a);
    for (let a = 0; a < n1; a++) {
      let s = 0, c = 0;
      for (let b = 0; b <= Math.min(r, n2 - 1); b++) { s += de[idx(a, b)]; c++; }
      for (let b = 0; b < n2; b++) {
        para[idx(a, b)] = s / c;
        const sai = b - r, entra = b + r + 1;
        if (sai >= 0) { s -= de[idx(a, sai)]; c--; }
        if (entra < n2) { s += de[idx(a, entra)]; c++; }
      }
    }
  };
  for (let k = 0; k < 2; k++) { passada(g.h, tmp, true); passada(tmp, g.h, false); }
}

/** Caixa dos pontos com folga. */
export function caixaDe(pts: Pt[], folga = 0): { min: Pt; max: Pt } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { min: [x0 - folga, y0 - folga], max: [x1 + folga, y1 + folga] };
}

/** Passo da grade do relevo: ~300 nós no lado maior, entre 2 e 25 m. */
export function passoParaCurvas(pts: Pt[]): number {
  const b = caixaDe(pts);
  const lado = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]);
  return Math.max(2, Math.min(25, Math.ceil((lado / 300) * 2) / 2));
}

/** Reamostra `base` numa grade nova cobrindo os pontos (bicúbica). */
export function reamostrar(base: GradeCotas, pts: Pt[], passo: number, folga = 30): GradeCotas & { h: Float64Array } {
  const g = gradeVazia(pts, passo, folga);
  const { e0, n0, nx, ny, h } = g;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = cotaBicubica(base, [e0 + i * passo, n0 + j * passo]);
  return g;
}

// ---------------------------------------------------------------------------
// Ajuste aos vértices
// ---------------------------------------------------------------------------

/** Plano z = a + b·dx + c·dy por mínimos quadrados (dx, dy em relação ao centro). Poucos pontos → constante. */
export function planoDeTendencia(pts: Pt[], r: number[]): (p: Pt) => number {
  const n = pts.length;
  if (!n) return () => 0;
  const cx = pts.reduce((s, p) => s + p[0], 0) / n, cy = pts.reduce((s, p) => s + p[1], 0) / n;
  const media = r.reduce((s, v) => s + v, 0) / n;
  if (n < 4) return () => media;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (let k = 0; k < n; k++) {
    const dx = pts[k][0] - cx, dy = pts[k][1] - cy, dz = r[k] - media;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy; sxz += dx * dz; syz += dy * dz;
  }
  const det = sxx * syy - sxy * sxy;
  // pontos quase em linha (faixa estreita): sem inclinação confiável
  if (!(Math.abs(det) > 1e-9 * Math.max(1, sxx * syy))) return () => media;
  const b = (sxz * syy - syz * sxy) / det, c = (syz * sxx - sxz * sxy) / det;
  return (p) => media + b * (p[0] - cx) + c * (p[1] - cy);
}

/** Correção local: inverso da distância² com peso de fundo 1/R² (decai para 0 longe dos marcos). */
function correcaoLocal(pts: Pt[], r: number[], R: number): (p: Pt) => number {
  const w0 = 1 / (R * R);
  return (p) => {
    let sw = w0, s = 0;
    for (let k = 0; k < pts.length; k++) {
      const d2 = (pts[k][0] - p[0]) ** 2 + (pts[k][1] - p[1]) ** 2;
      if (d2 < 1e-8) return r[k];
      const w = 1 / d2;
      sw += w; s += w * r[k];
    }
    return s / sw;
  };
}

/** Marcos válidos (altitude finita e não zero), sem repetir a mesma posição. */
export function marcosComAltitude(pts: Pt[], hs: number[]): { pts: Pt[]; hs: number[] } {
  const out: { pts: Pt[]; hs: number[] } = { pts: [], hs: [] };
  const vistos = new Set<string>();
  pts.forEach((p, i) => {
    const h = hs[i];
    if (!Number.isFinite(h) || h === 0 || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    const k = `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)}`;
    if (vistos.has(k)) return;
    vistos.add(k);
    out.pts.push(p); out.hs.push(h);
  });
  return out;
}

/**
 * Ajusta a grade aos marcos (altera `g.h` no lugar). Devolve as estatísticas.
 * `raio` padrão: 3× a resolução do modelo público (~90 m), no mínimo 4 passos.
 */
export function ajustarAosVertices(g: GradeCotas & { h: Float64Array }, ptsIn: Pt[], hsIn: number[], raio?: number): EstatAjuste {
  const { pts, hs } = marcosComAltitude(ptsIn, hsIn);
  const R = raio ?? Math.max(90, 4 * g.passo);
  if (!pts.length) return { n: 0, rmsAntes: 0, maxAntes: 0, maxDepois: 0, raio: R };
  const res0 = pts.map((p, k) => hs[k] - cotaBilinear(g, p));
  const rmsAntes = Math.sqrt(res0.reduce((s, v) => s + v * v, 0) / res0.length);
  const maxAntes = Math.max(...res0.map(Math.abs));
  const tend = planoDeTendencia(pts, res0);
  const { nx, ny, passo, e0, n0 } = g;
  // 1ª passada: tendência + correção local dos resíduos que sobram dela
  const loc = correcaoLocal(pts, res0.map((v, k) => v - tend(pts[k])), R);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p: Pt = [e0 + i * passo, n0 + j * passo];
    g.h[j * nx + i] += tend(p) + loc(p);
  }
  // passadas de conferência: a grade (bilinear) tem de passar nos marcos.
  // Só os nós em volta dos marcos mudam (raio de 2 passos) — barato.
  for (let it = 0; it < 6; it++) {
    const r = pts.map((p, k) => hs[k] - cotaBilinear(g, p));
    if (Math.max(...r.map(Math.abs)) < 0.002) break;
    const Rl = 1.5 * passo;
    const fix = correcaoLocal(pts, r, Rl);
    const alcance = Math.ceil(2 * Rl / passo);
    const nos = new Set<number>();
    for (const p of pts) {
      const ci = Math.round((p[0] - e0) / passo), cj = Math.round((p[1] - n0) / passo);
      for (let dj = -alcance; dj <= alcance; dj++) for (let di = -alcance; di <= alcance; di++) {
        const i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < nx && j < ny) nos.add(j * nx + i);
      }
    }
    const delta = new Map<number, number>();
    for (const k of nos) delta.set(k, fix([e0 + (k % nx) * passo, n0 + Math.floor(k / nx) * passo]));
    for (const [k, d] of delta) g.h[k] += d;
  }
  const maxDepois = Math.max(...pts.map((p, k) => Math.abs(hs[k] - cotaBilinear(g, p))));
  return { n: pts.length, rmsAntes, maxAntes, maxDepois, raio: R };
}

/**
 * Sem modelo público (sem rede): a superfície sai só dos marcos — plano de
 * tendência + correção local, sem fundo. Bate nos marcos; o miolo é só uma
 * interpolação (dito na tela).
 */
export function gradeSoDosMarcos(ptsIn: Pt[], hsIn: number[], passo: number, folga = 30, cobertura: Pt[] = ptsIn): (GradeCotas & { h: Float64Array }) | null {
  const { pts, hs } = marcosComAltitude(ptsIn, hsIn);
  if (pts.length < 3) return null;
  const g = gradeVazia(cobertura, passo, folga);
  ajustarAosVertices(g, pts, hs, Math.max(60, 3 * passo));
  return g;
}

/** Grade zerada cobrindo os pontos (nós em múltiplos do passo). */
export function gradeVazia(pts: Pt[], passo: number, folga = 30): GradeCotas & { h: Float64Array } {
  const b = caixaDe(pts, folga);
  const e0 = Math.floor(b.min[0] / passo) * passo, n0 = Math.floor(b.min[1] / passo) * passo;
  const nx = Math.ceil((b.max[0] - e0) / passo) + 1, ny = Math.ceil((b.max[1] - n0) / passo) + 1;
  return { e0, n0, passo, nx, ny, h: new Float64Array(nx * ny) };
}

// ---------------------------------------------------------------------------
// Intervalo
// ---------------------------------------------------------------------------

export const INTERVALOS = [0.5, 1, 2, 5, 10] as const;

/**
 * Intervalo automático (1, 2, 5 ou 10 m): no máximo ~30 curvas no desnível.
 * Mais que isso, com o miolo vindo de um modelo de ~30 m, vira rabisco.
 */
export function intervaloAutomatico(desnivel: number): number {
  if (!(desnivel > 0)) return 1;
  for (const v of [1, 2, 5]) if (desnivel / v <= 30) return v;
  return 10;
}

/** A curva de cota z é mestra? (a cada 5 intervalos: 5 em 5 m com 1 m, 10 em 10 m com 2 m…) */
export function ehMestra(z: number, intervalo: number): boolean {
  const n = Math.round(z / intervalo);
  return n % 5 === 0;
}

// ---------------------------------------------------------------------------
// Dentro do imóvel
// ---------------------------------------------------------------------------

/** Par-ímpar sobre todos os anéis (glebas separadas e furos entram juntos). */
export function dentroDosAneis(p: Pt, aneis: Pt[][]): boolean {
  let dentro = false;
  for (const a of aneis) {
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
      const [xi, yi] = a[i], [xj, yj] = a[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
  }
  return dentro;
}

/** Faixa de cotas dos nós dentro dos anéis (sem anéis: a grade toda). */
export function faixaNoImovel(g: GradeCotas, aneis: Pt[][] | null): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  const m = aneis?.length ? mascaraCelulas(g, aneis) : null;
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    if (m) {
      // nó conta se alguma célula vizinha dele toca o imóvel
      const c = (ii: number, jj: number) => ii >= 0 && jj >= 0 && ii < g.nx - 1 && jj < g.ny - 1 && m[jj * (g.nx - 1) + ii] > 0;
      if (!(c(i, j) || c(i - 1, j) || c(i, j - 1) || c(i - 1, j - 1))) continue;
    }
    const v = g.h[j * g.nx + i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/**
 * Máscara das células (nx−1 × ny−1): 0 fora, 1 dentro, 2 cortada pela divisa.
 * Dentro/fora pelo centro da célula (varredura por linha); a divisa marca as
 * células que ela atravessa (andando em passos de ¼ de célula).
 */
function mascaraCelulas(g: GradeCotas, aneis: Pt[][]): Uint8Array {
  const cx = g.nx - 1, cy = g.ny - 1;
  const m = new Uint8Array(cx * cy);
  const arestas: [Pt, Pt][] = [];
  for (const a of aneis) for (let i = 0; i < a.length; i++) arestas.push([a[i], a[(i + 1) % a.length]]);
  for (let j = 0; j < cy; j++) {
    const y = g.n0 + (j + 0.5) * g.passo;
    const xs: number[] = [];
    for (const [p, q] of arestas) {
      if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.e0) / g.passo - 0.5)), i1 = Math.min(cx - 1, Math.floor((xs[k + 1] - g.e0) / g.passo - 0.5));
      for (let i = i0; i <= i1; i++) m[j * cx + i] = 1;
    }
  }
  for (const [p, q] of arestas) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const n = Math.max(1, Math.ceil(L / (g.passo / 4)));
    for (let s = 0; s <= n; s++) {
      const x = p[0] + ((q[0] - p[0]) * s) / n, y = p[1] + ((q[1] - p[1]) * s) / n;
      const i = Math.floor((x - g.e0) / g.passo), j = Math.floor((y - g.n0) / g.passo);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < cx && jj < cy) m[jj * cx + ii] = 2;
      }
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Marching squares
// ---------------------------------------------------------------------------

interface Seg { a: Pt; b: Pt; ka: string; kb: string }

/** Recorta o segmento pelos anéis: devolve os pedaços de dentro. */
function recortar(a: Pt, b: Pt, aneis: Pt[][]): [Pt, Pt][] {
  const ts: number[] = [0, 1];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const r of aneis) for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((p[0] - a[0]) * ey - (p[1] - a[1]) * ex) / den;
    const u = ((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  ts.sort((x, y) => x - y);
  const out: [Pt, Pt][] = [];
  const em = (t: number): Pt => [a[0] + dx * t, a[1] + dy * t];
  for (let k = 0; k + 1 < ts.length; k++) {
    if (ts[k + 1] - ts[k] < 1e-9) continue;
    if (dentroDosAneis(em((ts[k] + ts[k + 1]) / 2), aneis)) out.push([em(ts[k]), em(ts[k + 1])]);
  }
  return out;
}

/**
 * Curvas de nível de `g` no intervalo dado, recortadas pelos anéis do imóvel
 * (sem anéis: a grade toda). Polilinhas encadeadas, simplificadas a 1/20 do passo.
 */
export function curvasDeNivel(g: GradeCotas, intervalo: number, aneis: Pt[][] | null = null): Curva[] {
  const { nx, ny, passo, e0, n0 } = g;
  const h = g.h;
  const m = aneis?.length ? mascaraCelulas(g, aneis) : null;
  const fx = faixaNoImovel(g, aneis);
  const out: Curva[] = [];
  let unico = 0;
  for (let n = Math.ceil(fx.min / intervalo - 1e-9); n * intervalo <= fx.max + 1e-9; n++) {
    // cota "redonda" levemente deslocada: nó exatamente na cota não gera pontas soltas
    const z = Math.round(n * intervalo * 1000) / 1000;
    const zz = z + 1e-7;
    const segs: Seg[] = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const mc = m ? m[j * (nx - 1) + i] : 1;
      if (!mc) continue;
      const ia = j * nx + i;
      const a = h[ia], b = h[ia + 1], c = h[ia + nx + 1], d = h[ia + nx];
      const cs = (a > zz ? 1 : 0) | (b > zz ? 2 : 0) | (c > zz ? 4 : 0) | (d > zz ? 8 : 0);
      if (cs === 0 || cs === 15) continue;
      const x0 = e0 + i * passo, y0 = n0 + j * passo, x1 = x0 + passo, y1 = y0 + passo;
      const t = (v1: number, v2: number) => Math.max(0, Math.min(1, (z - v1) / (v2 - v1)));
      // arestas: B (sul, nó ia → ia+1), R (leste), T (norte), L (oeste); chave pela aresta da grade
      const eB = (): [Pt, string] => [[x0 + passo * t(a, b), y0], `h${ia}`];
      const eT = (): [Pt, string] => [[x0 + passo * t(d, c), y1], `h${ia + nx}`];
      const eL = (): [Pt, string] => [[x0, y0 + passo * t(a, d)], `v${ia}`];
      const eR = (): [Pt, string] => [[x1, y0 + passo * t(b, c)], `v${ia + 1}`];
      const pares: [[Pt, string], [Pt, string]][] = [];
      const centro = (a + b + c + d) / 4 > zz;
      switch (cs) {
        case 1: case 14: pares.push([eL(), eB()]); break;
        case 2: case 13: pares.push([eB(), eR()]); break;
        case 3: case 12: pares.push([eL(), eR()]); break;
        case 4: case 11: pares.push([eR(), eT()]); break;
        case 6: case 9: pares.push([eB(), eT()]); break;
        case 7: case 8: pares.push([eL(), eT()]); break;
        // sela: o centro da célula decide quem se liga com quem
        case 5: if (centro) pares.push([eL(), eT()], [eB(), eR()]); else pares.push([eL(), eB()], [eR(), eT()]); break;
        case 10: if (centro) pares.push([eL(), eB()], [eR(), eT()]); else pares.push([eL(), eT()], [eB(), eR()]); break;
      }
      for (const [[pa, ka], [pb, kb]] of pares) {
        if (mc === 1 || !aneis) { segs.push({ a: pa, b: pb, ka, kb }); continue; }
        // célula na divisa: recorta; a ponta cortada ganha chave própria (fim de linha)
        for (const [qa, qb] of recortar(pa, pb, aneis)) {
          const ia2 = qa[0] === pa[0] && qa[1] === pa[1] ? ka : `c${unico++}`;
          const ib2 = qb[0] === pb[0] && qb[1] === pb[1] ? kb : `c${unico++}`;
          segs.push({ a: qa, b: qb, ka: ia2, kb: ib2 });
        }
      }
    }
    const mestra = ehMestra(z, intervalo);
    for (const l of encadear(segs)) {
      const pts = simplificar(l.pts, passo / 20);
      if (pts.length >= 2) out.push({ cota: z, mestra, pts, fechada: l.fechada });
    }
  }
  return out;
}

/** Junta os segmentos em polilinhas pelas chaves das pontas. */
function encadear(segs: Seg[]): { pts: Pt[]; fechada: boolean }[] {
  const porChave = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const k of [s.ka, s.kb]) { const l = porChave.get(k); if (l) l.push(i); else porChave.set(k, [i]); }
  });
  const usado = new Uint8Array(segs.length);
  const outro = (i: number, k: string): number => { for (const x of porChave.get(k) ?? []) if (x !== i && !usado[x]) return x; return -1; };
  const linhas: { pts: Pt[]; fechada: boolean }[] = [];
  // começa pelas pontas soltas (linhas abertas), depois os anéis
  const ordem = segs.map((_, i) => i).sort((x, y) => {
    const sx = (porChave.get(segs[x].ka)!.length === 1 || porChave.get(segs[x].kb)!.length === 1) ? 0 : 1;
    const sy = (porChave.get(segs[y].ka)!.length === 1 || porChave.get(segs[y].kb)!.length === 1) ? 0 : 1;
    return sx - sy;
  });
  for (const i0 of ordem) {
    if (usado[i0]) continue;
    usado[i0] = 1;
    const s0 = segs[i0];
    // orienta: se a ponta "a" é solta, começa por ela
    let ini = s0.ka, fim = s0.kb;
    let pts: Pt[] = [s0.a, s0.b];
    if (porChave.get(s0.kb)!.length === 1 && porChave.get(s0.ka)!.length > 1) { pts = [s0.b, s0.a]; ini = s0.kb; fim = s0.ka; }
    // para frente
    for (let i = i0, k = fim; ;) {
      const j = outro(i, k);
      if (j < 0) { fim = k; break; }
      usado[j] = 1;
      const s = segs[j];
      if (s.ka === k) { pts.push(s.b); k = s.kb; } else { pts.push(s.a); k = s.ka; }
      i = j;
      if (k === ini) { fim = k; break; }
    }
    const fechada = fim === ini && pts.length > 3;
    if (!fechada) {
      // para trás (a linha começou no meio)
      const tras: Pt[] = [];
      for (let i = i0, k = ini; ;) {
        const j = outro(i, k);
        if (j < 0) break;
        usado[j] = 1;
        const s = segs[j];
        if (s.ka === k) { tras.push(s.b); k = s.kb; } else { tras.push(s.a); k = s.ka; }
        i = j;
      }
      pts = [...tras.reverse(), ...pts];
    }
    linhas.push({ pts, fechada });
  }
  return linhas;
}

/** Douglas-Peucker (iterativo). */
export function simplificar(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2 || tol <= 0) return pts;
  const manter = new Uint8Array(pts.length);
  manter[0] = manter[pts.length - 1] = 1;
  const pilha: [number, number][] = [[0, pts.length - 1]];
  while (pilha.length) {
    const [i0, i1] = pilha.pop()!;
    const a = pts[i0], b = pts[i1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    let dm = -1, im = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = pts[i];
      let d: number;
      if (L2 < 1e-12) d = Math.hypot(p[0] - a[0], p[1] - a[1]);
      else {
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
        d = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
      }
      if (d > dm) { dm = d; im = i; }
    }
    if (dm > tol && im > 0) { manter[im] = 1; pilha.push([i0, im], [im, i1]); }
  }
  return pts.filter((_, i) => manter[i]);
}

/** Comprimento de uma polilinha. */
export function comprimento(pts: Pt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
}

/**
 * Pontos para escrever a cota na curva: um a cada `cada` metros (pelo menos um
 * no meio), com o ângulo legível (texto nunca de cabeça para baixo), em graus.
 */
export function pontosDeRotulo(pts: Pt[], cada: number): { p: Pt; ang: number }[] {
  const L = comprimento(pts);
  if (L <= 0) return [];
  const n = Math.max(1, Math.floor(L / cada));
  const alvo = Array.from({ length: n }, (_, k) => (L * (k + 0.5)) / n);
  const out: { p: Pt; ang: number }[] = [];
  let s = 0, k = 0;
  for (let i = 1; i < pts.length && k < alvo.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (k < alvo.length && alvo[k] <= s + d) {
      const t = d > 0 ? (alvo[k] - s) / d : 0;
      let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang <= -90) ang += 180;
      out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], ang });
      k++;
    }
    s += d;
  }
  return out;
}
