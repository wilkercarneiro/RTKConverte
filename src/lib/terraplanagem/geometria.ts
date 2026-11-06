// Geometria plana da terraplanagem (UTM, metros). Puro: roda no Web Worker e
// no node --test.
import { areaAssinada as areaAssinadaSistema } from "../loteamento/geom.ts";

export type Pt = [number, number];

export const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * Área com sinal (Gauss): positiva no anti-horário. É o motor de área do
 * sistema (o mesmo de areaUtmM2 em restricoes.ts e do loteamento) — não um
 * cálculo próprio da terraplanagem.
 */
export const areaAssinada = (anel: Pt[]): number => areaAssinadaSistema(anel);

export const antiHorario = (anel: Pt[]): Pt[] => (areaAssinada(anel) >= 0 ? anel : [...anel].reverse());

export function centroide(anel: Pt[]): Pt {
  const a = areaAssinada(anel);
  if (Math.abs(a) < 1e-9) {
    const n = anel.length || 1;
    return [anel.reduce((s, p) => s + p[0], 0) / n, anel.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0, cy = 0;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const f = anel[j][0] * anel[i][1] - anel[i][0] * anel[j][1];
    cx += (anel[j][0] + anel[i][0]) * f;
    cy += (anel[j][1] + anel[i][1]) * f;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/** Par-ímpar. */
export function dentro(p: Pt, anel: Pt[]): boolean {
  let d = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i], [xj, yj] = anel[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

/** Ponto mais perto na borda do anel: distância e o ponto. */
export function maisPertoNaBorda(p: Pt, anel: Pt[]): { d: number; q: Pt } {
  let melhor = Infinity, q: Pt = anel[0];
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const a = anel[j], b = anel[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const x = a[0] + t * dx, y = a[1] + t * dy;
    const d2 = (p[0] - x) ** 2 + (p[1] - y) ** 2;
    if (d2 < melhor) { melhor = d2; q = [x, y]; }
  }
  return { d: Math.sqrt(melhor), q };
}

export function caixa(pts: Pt[]): { min: Pt; max: Pt } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { min: [x0, y0], max: [x1, y1] };
}

/** Fecho convexo (cadeia monótona), anti-horário. */
export function fechoConvexo(pts: Pt[]): Pt[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], hi: Pt[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

export interface RetanguloMinimo { centro: Pt; largura: number; comprimento: number; /** azimute do lado comprido, graus (0 = norte, horário), em [0, 180) */ giro: number }

/** Retângulo de menor área que envolve os pontos (pinças rotativas sobre o fecho). */
export function retanguloMinimo(pts: Pt[]): RetanguloMinimo {
  const h = fechoConvexo(pts);
  let melhor: RetanguloMinimo | null = null, melhorArea = Infinity;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    const l = dist(a, b);
    if (l < 1e-9) continue;
    const u: Pt = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], v: Pt = [-u[1], u[0]];
    let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
    for (const q of h) {
      const s = q[0] * u[0] + q[1] * u[1], t = q[0] * v[0] + q[1] * v[1];
      if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t;
    }
    const area = (s1 - s0) * (t1 - t0);
    if (area < melhorArea - 1e-9) {
      melhorArea = area;
      const sm = (s0 + s1) / 2, tm = (t0 + t1) / 2;
      const centro: Pt = [sm * u[0] + tm * v[0], sm * u[1] + tm * v[1]];
      const ls = s1 - s0, lt = t1 - t0;
      const eixo = ls >= lt ? u : v;
      let giro = (Math.atan2(eixo[0], eixo[1]) * 180) / Math.PI;
      giro = ((giro % 180) + 180) % 180;
      melhor = { centro, largura: Math.min(ls, lt), comprimento: Math.max(ls, lt), giro };
    }
  }
  if (!melhor) {
    const c = caixa(pts.length ? pts : [[0, 0]]);
    return { centro: [(c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2], largura: c.max[0] - c.min[0], comprimento: c.max[1] - c.min[1], giro: 0 };
  }
  return melhor;
}

/** Vetor unitário do azimute (graus, 0 = norte, horário). */
export const doAzimute = (az: number): Pt => [Math.sin((az * Math.PI) / 180), Math.cos((az * Math.PI) / 180)];

/** Os 4 cantos do retângulo (anti-horário). `giro` = azimute do comprimento. */
export function cantosDoRetangulo(centro: Pt, largura: number, comprimento: number, giro: number): Pt[] {
  const u = doAzimute(giro), v: Pt = [-u[1], u[0]];
  const c = (s: number, t: number): Pt => [centro[0] + u[0] * s + v[0] * t, centro[1] + u[1] * s + v[1] * t];
  const L = comprimento / 2, W = largura / 2;
  return antiHorario([c(-L, -W), c(L, -W), c(L, W), c(-L, W)]);
}

export function perimetro(anel: Pt[]): number {
  let s = 0;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) s += dist(anel[j], anel[i]);
  return s;
}

/**
 * O anel se cruza ("gravata")? Lados não vizinhos que se cortam. O(n²), mas
 * plataforma tem dezenas de vértices — e só roda ao ler o KML e ao calcular.
 */
export function seCruza(anel: Pt[]): boolean {
  const n = anel.length;
  if (n < 4) return false;
  const lado = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const cortam = (p1: Pt, p2: Pt, p3: Pt, p4: Pt) => {
    const d1 = lado(p3, p4, p1), d2 = lado(p3, p4, p2), d3 = lado(p1, p2, p3), d4 = lado(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  };
  for (let i = 0; i < n; i++) {
    const a = anel[i], b = anel[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // vizinhos pelo fechamento
      if (cortam(a, b, anel[j], anel[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Tira pontos repetidos e colineares (tolerância em m). */
export function limparAnel(anel: Pt[], tol = 1e-4): Pt[] {
  let a = anel.filter((p, i) => dist(p, anel[(i + 1) % anel.length]) > tol);
  let mudou = true;
  while (mudou && a.length > 3) {
    mudou = false;
    for (let i = 0; i < a.length; i++) {
      const p = a[(i + a.length - 1) % a.length], q = a[i], r = a[(i + 1) % a.length];
      const cr = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      if (Math.abs(cr) / Math.max(dist(p, r), 1e-9) < tol) { a = a.filter((_, k) => k !== i); mudou = true; break; }
    }
  }
  return a;
}

/**
 * Recorte de Sutherland–Hodgman do polígono `sujeito` (pode ser côncavo) pelo
 * semiplano a·x + b·y + c ≥ 0. Devolve também o valor interpolado de `vals`.
 */
export function recortarSemiplano(pts: Pt[], vals: number[], a: number, b: number, c: number): { pts: Pt[]; vals: number[] } {
  const op: Pt[] = [], ov: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const P = pts[i], Q = pts[(i + 1) % n];
    const fp = a * P[0] + b * P[1] + c, fq = a * Q[0] + b * Q[1] + c;
    if (fp >= 0) { op.push(P); ov.push(vals[i]); }
    if ((fp >= 0) !== (fq >= 0)) {
      const t = fp / (fp - fq);
      op.push([P[0] + t * (Q[0] - P[0]), P[1] + t * (Q[1] - P[1])]);
      ov.push(vals[i] + t * (vals[(i + 1) % n] - vals[i]));
    }
  }
  return { pts: op, vals: ov };
}

/**
 * Interseção de um triângulo (o recortador, convexo) com um polígono qualquer
 * (o sujeito). Sutherland–Hodgman com o triângulo como recortador: serve para
 * sujeito côncavo (podem sobrar "pontes" de largura zero, que não mudam área nem integral).
 */
export function trianguloNoPoligono(tri: [Pt, Pt, Pt], pol: Pt[]): Pt[] {
  let s = pol;
  const ccw = (tri[1][0] - tri[0][0]) * (tri[2][1] - tri[0][1]) - (tri[1][1] - tri[0][1]) * (tri[2][0] - tri[0][0]) >= 0;
  for (let k = 0; k < 3 && s.length; k++) {
    const A = tri[k], B = tri[(k + 1) % 3];
    // lado esquerdo de A→B (dentro de um triângulo anti-horário)
    let a = -(B[1] - A[1]), b = B[0] - A[0];
    if (!ccw) { a = -a; b = -b; }
    const c = -(a * A[0] + b * A[1]);
    s = recortarSemiplano(s, s.map(() => 0), a, b, c).pts;
  }
  return s;
}
