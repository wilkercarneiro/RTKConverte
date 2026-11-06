// TIN: a triangulação de Delaunay dos pontos do levantamento, o mesmo modelo
// que o agrimensor monta no CAD. Entre três pontos vizinhos o terreno é o
// plano que passa por eles — nada inventado além do que foi medido.
//
// Bowyer–Watson com um índice de baldes pelos círculos circunscritos: cada
// ponto novo só testa os triângulos cujo círculo cobre o balde dele (mais os
// poucos triângulos enormes, ligados ao triângulo envolvente). Alguns
// milhares de pontos triangulam em dezenas de milissegundos.
//
// Depois, a borda é "aparada": o fecho convexo liga pontos distantes com
// triângulos compridos e finos por cima do que não foi levantado (o canto de
// fora de um levantamento em L). Triângulo de borda com lado muito maior que o
// espaçamento típico sai, e a borda que sobra é o CONTORNO dos pontos.
import type { Pt } from "./geometria.ts";
import { antiHorario, areaAssinada } from "./geometria.ts";

export interface Tin {
  /** coordenadas dos pontos usados (UTM) e a cota */
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** 3 índices por triângulo, anti-horário */
  tri: Int32Array;
  /** borda externa da triangulação (anti-horário), sem repetir o 1º ponto */
  contorno: Pt[];
  /** mediana do comprimento das arestas (espaçamento típico do levantamento) */
  espacamento: number;
  /** pontos descartados por repetirem a posição de outro (a menos de 1 cm) */
  repetidos: number;
}

/** Triangulação de Delaunay; devolve os triângulos (anti-horário) entre os índices dos pontos. */
export function delaunay(xs: ArrayLike<number>, ys: ArrayLike<number>): Int32Array {
  const n = xs.length;
  if (n < 3) return new Int32Array(0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i]; if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i]; }
  // coordenadas locais (UTM tem 7 dígitos antes da vírgula: o determinante perderia precisão)
  const ox = (x0 + x1) / 2, oy = (y0 + y1) / 2;
  const lado = Math.max(x1 - x0, y1 - y0, 1e-6);
  const X = new Float64Array(n + 3), Y = new Float64Array(n + 3);
  for (let i = 0; i < n; i++) { X[i] = xs[i] - ox; Y[i] = ys[i] - oy; }
  const M = lado * 40;
  X[n] = -M; Y[n] = -M; X[n + 1] = M; Y[n + 1] = -M; X[n + 2] = 0; Y[n + 2] = M;

  // triângulos em listas que crescem
  let cap = 2 * n + 16;
  let A = new Int32Array(cap), B = new Int32Array(cap), C = new Int32Array(cap);
  let CX = new Float64Array(cap), CY = new Float64Array(cap), R2 = new Float64Array(cap);
  let vivo = new Uint8Array(cap);
  let nt = 0;
  const crescer = () => {
    cap *= 2;
    const ni = (a: Int32Array) => { const b = new Int32Array(cap); b.set(a); return b; };
    const nf = (a: Float64Array) => { const b = new Float64Array(cap); b.set(a); return b; };
    A = ni(A); B = ni(B); C = ni(C); CX = nf(CX); CY = nf(CY); R2 = nf(R2);
    const v = new Uint8Array(cap); v.set(vivo); vivo = v;
  };

  // baldes
  const G = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(n / 3))));
  const bx0 = x0 - ox, by0 = y0 - oy, tb = lado / G + 1e-9;
  const baldes: number[][] = Array.from({ length: G * G }, () => []);
  const grandes: number[] = [];
  const LIMITE_BALDES = 48;

  const registrar = (t: number) => {
    const r = Math.sqrt(R2[t]);
    const i0 = Math.floor((CX[t] - r - bx0) / tb), i1 = Math.floor((CX[t] + r - bx0) / tb);
    const j0 = Math.floor((CY[t] - r - by0) / tb), j1 = Math.floor((CY[t] + r - by0) / tb);
    const ii0 = Math.max(0, i0), ii1 = Math.min(G - 1, i1), jj0 = Math.max(0, j0), jj1 = Math.min(G - 1, j1);
    if (ii1 < ii0 || jj1 < jj0) { grandes.push(t); return; }
    if ((ii1 - ii0 + 1) * (jj1 - jj0 + 1) > LIMITE_BALDES) { grandes.push(t); return; }
    for (let j = jj0; j <= jj1; j++) for (let i = ii0; i <= ii1; i++) baldes[j * G + i].push(t);
  };

  const novo = (a: number, b: number, c: number) => {
    if (nt >= cap) crescer();
    const t = nt++;
    A[t] = a; B[t] = b; C[t] = c; vivo[t] = 1;
    const ax = X[a], ay = Y[a], bx = X[b], by = Y[b], cx = X[c], cy = Y[c];
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-18) { CX[t] = (ax + bx + cx) / 3; CY[t] = (ay + by + cy) / 3; R2[t] = Infinity; }
    else {
      const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
      CX[t] = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
      CY[t] = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
      R2[t] = (ax - CX[t]) ** 2 + (ay - CY[t]) ** 2;
    }
    if (R2[t] === Infinity) grandes.push(t); else registrar(t);
    return t;
  };
  novo(n, n + 1, n + 2);

  // ordem de inserção: varredura em faixas (vizinho perto do anterior)
  const ordem = Array.from({ length: n }, (_, i) => i);
  const faixa = (i: number) => Math.floor((Y[i] - by0) / tb);
  ordem.sort((p, q) => faixa(p) - faixa(q) || ((faixa(p) & 1) ? X[q] - X[p] : X[p] - X[q]));

  const ruins: number[] = [];
  const arestas = new Map<number, number>(); // chave a*(n+3)+b → b (aresta orientada a→b)
  const K = n + 3;
  for (const p of ordem) {
    const px = X[p], py = Y[p];
    ruins.length = 0;
    const testar = (t: number) => {
      if (!vivo[t]) return;
      const dx = px - CX[t], dy = py - CY[t];
      if (dx * dx + dy * dy < R2[t] * (1 - 1e-12)) { vivo[t] = 2; ruins.push(t); }
    };
    const bi = Math.min(G - 1, Math.max(0, Math.floor((px - bx0) / tb)));
    const bj = Math.min(G - 1, Math.max(0, Math.floor((py - by0) / tb)));
    const balde = baldes[bj * G + bi];
    // limpa os mortos do balde enquanto testa
    let w = 0;
    for (let k = 0; k < balde.length; k++) { const t = balde[k]; if (vivo[t]) { balde[w++] = t; testar(t); } }
    balde.length = w;
    let wg = 0;
    for (let k = 0; k < grandes.length; k++) { const t = grandes[k]; if (vivo[t]) { grandes[wg++] = t; testar(t); } }
    grandes.length = wg;
    if (!ruins.length) continue;
    arestas.clear();
    const aresta = (a: number, b: number) => {
      const inv = b * K + a;
      if (arestas.has(inv)) arestas.delete(inv); else arestas.set(a * K + b, b);
    };
    for (const t of ruins) { vivo[t] = 0; aresta(A[t], B[t]); aresta(B[t], C[t]); aresta(C[t], A[t]); }
    for (const [k, b] of arestas) {
      const a = Math.floor(k / K);
      novo(a, b, p);
    }
  }

  const out: number[] = [];
  for (let t = 0; t < nt; t++) {
    if (vivo[t] !== 1 || A[t] >= n || B[t] >= n || C[t] >= n) continue;
    // anti-horário garantido
    const cr = (X[B[t]] - X[A[t]]) * (Y[C[t]] - Y[A[t]]) - (Y[B[t]] - Y[A[t]]) * (X[C[t]] - X[A[t]]);
    if (Math.abs(cr) < 1e-14 * lado * lado) continue; // degenerado (pontos alinhados)
    if (cr > 0) out.push(A[t], B[t], C[t]); else out.push(A[t], C[t], B[t]);
  }
  return Int32Array.from(out);
}

const chave = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

/**
 * Tira da borda os triângulos com lado de fora muito comprido (fecho convexo
 * por cima do que não foi levantado). `fator` × espaçamento típico.
 */
export function aparar(tri: Int32Array, xs: ArrayLike<number>, ys: ArrayLike<number>, fator = 4): Int32Array {
  const nt = tri.length / 3;
  if (!nt) return tri;
  const L = (a: number, b: number) => Math.hypot(xs[a] - xs[b], ys[a] - ys[b]);
  const comps: number[] = [];
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) comps.push(L(tri[3 * t + k], tri[3 * t + ((k + 1) % 3)]));
  comps.sort((a, b) => a - b);
  const med = comps[Math.floor(comps.length / 2)];
  const limite = Math.max(med * fator, 1e-9);
  const vivo = new Uint8Array(nt).fill(1);
  const donos = new Map<string, number[]>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const c = chave(tri[3 * t + k], tri[3 * t + ((k + 1) % 3)]);
    const l = donos.get(c); if (l) l.push(t); else donos.set(c, [t]);
  }
  const ehBorda = (a: number, b: number) => (donos.get(chave(a, b)) ?? []).filter((t) => vivo[t]).length === 1;
  const fila: number[] = [];
  for (let t = 0; t < nt; t++) fila.push(t);
  let restantes = nt;
  while (fila.length) {
    const t = fila.pop()!;
    if (!vivo[t]) continue;
    for (let k = 0; k < 3; k++) {
      const a = tri[3 * t + k], b = tri[3 * t + ((k + 1) % 3)];
      if (ehBorda(a, b) && L(a, b) > limite && restantes > 1) {
        vivo[t] = 0; restantes--;
        // os vizinhos podem ter virado borda
        for (let j = 0; j < 3; j++) {
          const c = chave(tri[3 * t + j], tri[3 * t + ((j + 1) % 3)]);
          for (const v of donos.get(c) ?? []) if (vivo[v]) fila.push(v);
        }
        break;
      }
    }
  }
  const out: number[] = [];
  for (let t = 0; t < nt; t++) if (vivo[t]) out.push(tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]);
  return Int32Array.from(out);
}

/** Bordas da triangulação encadeadas em anéis; o maior primeiro (anti-horário). */
export function bordas(tri: Int32Array, xs: ArrayLike<number>, ys: ArrayLike<number>): Pt[][] {
  const conta = new Map<string, number>();
  const nt = tri.length / 3;
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const c = chave(tri[3 * t + k], tri[3 * t + ((k + 1) % 3)]);
    conta.set(c, (conta.get(c) ?? 0) + 1);
  }
  // arestas de borda orientadas como no triângulo (anti-horário: o de dentro à esquerda)
  const prox = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = tri[3 * t + k], b = tri[3 * t + ((k + 1) % 3)];
    if (conta.get(chave(a, b)) === 1) { const l = prox.get(a); if (l) l.push(b); else prox.set(a, [b]); }
  }
  const aneis: Pt[][] = [];
  const usado = new Set<string>();
  for (const [ini, lista] of prox) {
    for (const primeiro of lista) {
      if (usado.has(`${ini}>${primeiro}`)) continue;
      const anel: Pt[] = [];
      let a = ini, b = primeiro, guarda = 0;
      while (guarda++ < 1e6) {
        usado.add(`${a}>${b}`);
        anel.push([xs[a], ys[a]]);
        if (b === ini) break;
        const ops = (prox.get(b) ?? []).filter((c) => !usado.has(`${b}>${c}`));
        if (!ops.length) break;
        a = b; b = ops[0];
      }
      if (anel.length >= 3) aneis.push(anel);
    }
  }
  aneis.sort((p, q) => Math.abs(areaAssinada(q)) - Math.abs(areaAssinada(p)));
  return aneis.map(antiHorario);
}

/** Monta o TIN dos pontos (descarta posição repetida a menos de 1 cm, ficando a 1ª). */
export function montarTin(pontos: { e: number; n: number; z: number }[]): Tin {
  const vistos = new Map<string, true>();
  const xs: number[] = [], ys: number[] = [], zs: number[] = [];
  let repetidos = 0;
  for (const p of pontos) {
    if (!Number.isFinite(p.e) || !Number.isFinite(p.n) || !Number.isFinite(p.z)) continue;
    const k = `${Math.round(p.e * 100)},${Math.round(p.n * 100)}`;
    if (vistos.has(k)) { repetidos++; continue; }
    vistos.set(k, true);
    xs.push(p.e); ys.push(p.n); zs.push(p.z);
  }
  const x = Float64Array.from(xs), y = Float64Array.from(ys), z = Float64Array.from(zs);
  const bruto = delaunay(x, y);
  const tri = aparar(bruto, x, y);
  const aneis = bordas(tri, x, y);
  const comps: number[] = [];
  for (let t = 0; t < tri.length / 3; t++) for (let k = 0; k < 3; k++) {
    const a = tri[3 * t + k], b = tri[3 * t + ((k + 1) % 3)];
    comps.push(Math.hypot(x[a] - x[b], y[a] - y[b]));
  }
  comps.sort((a, b) => a - b);
  return { x, y, z, tri, contorno: aneis[0] ?? [], espacamento: comps.length ? comps[Math.floor(comps.length / 2)] : 0, repetidos };
}

/**
 * Índice para achar o triângulo de um ponto qualquer (seções, pontos da borda
 * da plataforma). Baldes pela caixa de cada triângulo.
 */
export class IndiceTin {
  private tin: Tin;
  private G: number;
  private x0: number;
  private y0: number;
  private tb: number;
  private baldes: Int32Array[];
  constructor(tin: Tin) {
    this.tin = tin;
    const nt = tin.tri.length / 3;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < tin.x.length; i++) { const a = tin.x[i], b = tin.y[i]; if (a < x0) x0 = a; if (a > x1) x1 = a; if (b < y0) y0 = b; if (b > y1) y1 = b; }
    this.G = Math.max(1, Math.min(200, Math.ceil(Math.sqrt(nt / 2))));
    this.x0 = x0; this.y0 = y0;
    this.tb = Math.max(x1 - x0, y1 - y0, 1e-6) / this.G + 1e-9;
    const listas: number[][] = Array.from({ length: this.G * this.G }, () => []);
    for (let t = 0; t < nt; t++) {
      const a = tin.tri[3 * t], b = tin.tri[3 * t + 1], c = tin.tri[3 * t + 2];
      const i0 = this.bi(Math.min(tin.x[a], tin.x[b], tin.x[c])), i1 = this.bi(Math.max(tin.x[a], tin.x[b], tin.x[c]));
      const j0 = this.bj(Math.min(tin.y[a], tin.y[b], tin.y[c])), j1 = this.bj(Math.max(tin.y[a], tin.y[b], tin.y[c]));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) listas[j * this.G + i].push(t);
    }
    this.baldes = listas.map((l) => Int32Array.from(l));
  }
  private bi(x: number) { return Math.min(this.G - 1, Math.max(0, Math.floor((x - this.x0) / this.tb))); }
  private bj(y: number) { return Math.min(this.G - 1, Math.max(0, Math.floor((y - this.y0) / this.tb))); }
  /** Cota do TIN no ponto (NaN fora da triangulação). */
  cota(px: number, py: number): number {
    if (px < this.x0 - 1e-6 || py < this.y0 - 1e-6 || px > this.x0 + this.G * this.tb + 1e-6 || py > this.y0 + this.G * this.tb + 1e-6) return NaN;
    const { x, y, z, tri } = this.tin;
    for (const t of this.baldes[this.bj(py) * this.G + this.bi(px)]) {
      const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
      const d = (y[b] - y[c]) * (x[a] - x[c]) + (x[c] - x[b]) * (y[a] - y[c]);
      if (d === 0) continue;
      const l1 = ((y[b] - y[c]) * (px - x[c]) + (x[c] - x[b]) * (py - y[c])) / d;
      const l2 = ((y[c] - y[a]) * (px - x[c]) + (x[a] - x[c]) * (py - y[c])) / d;
      const l3 = 1 - l1 - l2;
      const e = -1e-9;
      if (l1 >= e && l2 >= e && l3 >= e) return l1 * z[a] + l2 * z[b] + l3 * z[c];
    }
    return NaN;
  }
}
