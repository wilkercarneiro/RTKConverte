/**
 * Motor da LINHA CENTRAL (protótipo do plano "loteamento fundo com fundo").
 *
 * A quadra de duas fileiras deixa de ser um monte de anéis soltos e vira um
 * modelo: o contorno da quadra (com as ruas reconhecidas), a linha central C
 * (polilinha do operador ou automática) e, para cada divisa lateral, uma
 * junção sobre C. Cada divisa é um par de laterais que se encontram na junção
 * (fundo com fundo EXATO: cada lote encosta o fundo em um só lote da outra
 * fileira), cada lateral o mais perpendicular possível à SUA rua.
 *
 * Áreas: a área acumulada de cada fileira até a divisa k depende só da divisa
 * k. Então cada divisa se resolve sozinha: junção t sobre C e os dois pés
 * (u na rua da fileira 1, v na rua da fileira 2) tais que as duas áreas
 * acumuladas batem com k·T, escolhendo t para as laterais girarem o mínimo.
 * Resultado exato, sem dobrar a linha central do operador, em ~1 ms.
 *
 * Esquinas: o arco de concordância (vários lados curtos girando no mesmo
 * sentido) é UMA quina, no PI das tangentes. Dobra da rua (≥ 12°) dentro da
 * frente de um lote puxa a divisa mais próxima para cima dela (o lote não
 * ganha a 5ª quina). O mesmo para as dobras da linha central.
 */

import { quinasDetalhe } from "./geom.ts";
import type { Pt, Quina } from "./geom.ts";
export type { Pt };
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0];
export const norma = (a: Pt): number => Math.hypot(a[0], a[1]);
export const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const unit = (a: Pt): Pt => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
export const esq = (a: Pt): Pt => [-a[1], a[0]];
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
/** ângulo com sinal de a para b (rad) */
export const angulo = (a: Pt, b: Pt): number => Math.atan2(cross(a, b), dot(a, b));
const GRAU = Math.PI / 180;

export function areaAss(r: Pt[]): number {
  let s = 0;
  for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - a[1] * b[0]; }
  return s / 2;
}

export function intersecaoRetas(p0: Pt, p1: Pt, q0: Pt, q1: Pt): Pt | null {
  const r = sub(p1, p0), s = sub(q1, q0), d = cross(r, s);
  if (Math.abs(d) < 1e-12) return null;
  const t = cross(sub(q0, p0), s) / d;
  return add(p0, mul(r, t));
}

/** interseção de segmentos (t em [0,1] em ambos) */
export function intersecaoSeg(p0: Pt, p1: Pt, q0: Pt, q1: Pt): { t: number; u: number; p: Pt } | null {
  const r = sub(p1, p0), s = sub(q1, q0), d = cross(r, s);
  if (Math.abs(d) < 1e-12) return null;
  const qp = sub(q0, p0);
  const t = cross(qp, s) / d, u = cross(qp, r) / d;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, p: add(p0, mul(r, t)) };
}

// ---------------------------------------------------------------------------
// Caminho: polilinha aberta com estacas e somas acumuladas do produto vetorial
// (a área de qualquer região limitada por pedaços de caminhos sai em O(log n)).
// ---------------------------------------------------------------------------
export class Caminho {
  readonly p: Pt[];
  readonly s: number[];
  readonly k: number[];
  constructor(pts: Pt[]) {
    const p: Pt[] = [];
    for (const q of pts) if (!p.length || dist(p[p.length - 1], q) > 1e-7) p.push([q[0], q[1]]);
    if (p.length === 1) p.push([p[0][0], p[0][1]]);
    this.p = p; this.s = [0]; this.k = [0];
    for (let i = 1; i < p.length; i++) {
      this.s.push(this.s[i - 1] + dist(p[i - 1], p[i]));
      this.k.push(this.k[i - 1] + cross(p[i - 1], p[i]));
    }
  }
  get L(): number { return this.s[this.s.length - 1]; }
  seg(t: number): number {
    const n = this.p.length;
    if (t <= 0) return 0;
    if (t >= this.L) return n - 2;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= t) lo = m; else hi = m; }
    return lo;
  }
  em(t: number): Pt {
    const i = this.seg(t), l = this.s[i + 1] - this.s[i];
    const f = l > 0 ? Math.max(0, Math.min(1, (t - this.s[i]) / l)) : 0;
    return lerp(this.p[i], this.p[i + 1], f);
  }
  tan(t: number): Pt { const i = this.seg(t); return unit(sub(this.p[i + 1], this.p[i])); }
  /** normal à esquerda; no vértice, a bissetriz das duas normais */
  nrm(t: number): Pt {
    const i = this.seg(t), d = unit(sub(this.p[i + 1], this.p[i]));
    if (Math.abs(t - this.s[i]) < 1e-6 && i > 0) return unit(esq(add(unit(sub(this.p[i], this.p[i - 1])), d)));
    if (Math.abs(t - this.s[i + 1]) < 1e-6 && i + 2 < this.p.length) return unit(esq(add(d, unit(sub(this.p[i + 2], this.p[i + 1])))));
    return esq(d);
  }
  /** Σ produto vetorial das arestas de 0 até a estaca t */
  K(t: number): number { const i = this.seg(t); return this.k[i] + cross(this.p[i], this.em(t)); }
  trecho(t0: number, t1: number): Pt[] {
    const out: Pt[] = [this.em(t0)];
    for (let i = 0; i < this.p.length; i++) if (this.s[i] > t0 + 1e-7 && this.s[i] < t1 - 1e-7) out.push(this.p[i]);
    out.push(this.em(t1));
    return out;
  }
  projetar(q: Pt): { t: number; d: number } {
    let best = { t: 0, d: Infinity };
    for (let i = 0; i + 1 < this.p.length; i++) {
      const a = this.p[i], ab = sub(this.p[i + 1], a), l2 = dot(ab, ab);
      const f = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(q, a), ab) / l2)) : 0;
      const d = dist(q, add(a, mul(ab, f)));
      if (d < best.d) best = { t: this.s[i] + f * Math.sqrt(l2), d };
    }
    return best;
  }
  /** interseções com o segmento a-b: estacas no caminho */
  cortes(a: Pt, b: Pt): { t: number; f: number; p: Pt }[] {
    const out: { t: number; f: number; p: Pt }[] = [];
    for (let i = 0; i + 1 < this.p.length; i++) {
      const x = intersecaoSeg(this.p[i], this.p[i + 1], a, b);
      if (x) out.push({ t: this.s[i] + x.t * (this.s[i + 1] - this.s[i]), f: x.u, p: x.p });
    }
    return out.sort((x, y) => x.t - y.t);
  }
  /** vértices (estaca, giro com sinal em graus) — só os de dentro */
  dobras(): { t: number; giro: number; i: number }[] {
    const out: { t: number; giro: number; i: number }[] = [];
    for (let i = 1; i + 1 < this.p.length; i++) {
      const g = angulo(sub(this.p[i], this.p[i - 1]), sub(this.p[i + 1], this.p[i])) / GRAU;
      out.push({ t: this.s[i], giro: g, i });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Quinas: o mesmo reconhecedor do sistema (geom.quinasDetalhe: arco e chanfro = 1 quina no PI)
// ---------------------------------------------------------------------------
export type { Quina } from "./geom.ts";
export function quinasArco(anel: Pt[], o: { giroMin?: number; raioMax?: number; ladoArco?: number } = {}): Quina[] {
  return quinasDetalhe(anel, o.ladoArco ?? 3.5, o.giroMin ?? 12, o.raioMax ?? 40);
}

// ---------------------------------------------------------------------------
// Estrutura da quadra: frentes F1/F2 (as duas ruas que se olham) e cabeceiras
// ---------------------------------------------------------------------------
export type TipoAresta = "rua" | "via" | "divisa" | "outro";
export interface Cadeia { s0: number; s1: number; tipo: TipoAresta; comp: number; dir: Pt; ref: string }
export interface Estrutura {
  anel: Pt[];
  tipos: TipoAresta[];
  refs: string[];
  /** anel dobrado (duas voltas) para recortar trechos que passam do início */
  Q: Caminho;
  P: number;
  quinas: Quina[];
  cadeias: Cadeia[];
  f1: Cadeia;
  f2: Cadeia;
  /** cabeceira 1 (entre o fim de F2 e o início de F1) e 2 (entre o fim de F1 e o início de F2) */
  e1: [number, number];
  e2: [number, number];
}

const ehRua = (t: TipoAresta) => t === "rua" || t === "via";

export function estruturar(anelIn: Pt[], tiposIn: TipoAresta[], refsIn?: string[], o: { giroMaior?: number } = {}): Estrutura {
  let anel = anelIn.map((p) => [p[0], p[1]] as Pt);
  let tipos = tiposIn.slice();
  let refs = (refsIn ?? tiposIn.map(() => "")).slice();
  if (areaAss(anel) < 0) {
    // inverte mantendo aresta i = (i → i+1)
    const n = anel.length;
    const a2: Pt[] = [], t2: TipoAresta[] = [], r2: string[] = [];
    for (let i = 0; i < n; i++) { a2.push(anel[(n - i) % n]); }
    for (let i = 0; i < n; i++) { const e = (n - 1 - i + n) % n; t2.push(tipos[e]); r2.push(refs[e]); }
    anel = a2; tipos = t2; refs = r2;
  }
  const n = anel.length;
  const Q = new Caminho([...anel, ...anel, anel[0]]);
  const P = Q.s[n];
  const quinas = quinasArco(anel);
  const gM = o.giroMaior ?? 40;
  // cantos maiores (giro ≥ 40°) ou troca de rua
  const maiores = quinas.filter((q) => Math.abs(q.giro) >= gM);
  const cortes: { s0: number; s1: number }[] = maiores.map((q) => ({ s0: Q.s[q.i0], s1: Q.s[q.i1] }));
  // troca de tipo/ref entre arestas seguidas, fora de canto, também corta
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    if ((tipos[a] !== tipos[i] || refs[a] !== refs[i]) && !cortes.some((c) => dentroCiclico(Q.s[i], c.s0, c.s1, P, 0.01))) cortes.push({ s0: Q.s[i], s1: Q.s[i] });
  }
  cortes.sort((a, b) => a.s0 - b.s0);
  const cadeias: Cadeia[] = [];
  for (let c = 0; c < cortes.length; c++) {
    const a = cortes[c], b = cortes[(c + 1) % cortes.length];
    const s0 = a.s1;
    let s1 = b.s0;
    while (s1 <= s0 + 1e-9) s1 += P;
    if (cortes.length === 1) s1 = s0 + P - (a.s1 - a.s0);
    const pts = Q.trecho(s0, s1);
    // tipo dominante
    const porTipo = new Map<string, number>();
    for (let i = 0; i + 1 < pts.length; i++) {
      const m = lerp(pts[i], pts[i + 1], 0.5);
      const e = arestaDe(anel, m);
      const chave = tipos[e] + "|" + refs[e];
      porTipo.set(chave, (porTipo.get(chave) ?? 0) + dist(pts[i], pts[i + 1]));
    }
    let melhor = "", mx = -1;
    for (const [k, v] of porTipo) if (v > mx) { mx = v; melhor = k; }
    const [tipo, ref] = melhor.split("|");
    cadeias.push({ s0, s1, tipo: tipo as TipoAresta, comp: s1 - s0, dir: unit(sub(Q.em(s1), Q.em(s0))), ref });
  }
  // F1 e F2: as duas ruas compridas que se olham
  let par: [Cadeia, Cadeia] | null = null, nota = -Infinity;
  for (let i = 0; i < cadeias.length; i++) for (let j = 0; j < cadeias.length; j++) {
    if (i === j) continue;
    const a = cadeias[i], b = cadeias[j];
    if (!ehRua(a.tipo) || !ehRua(b.tipo)) continue;
    const opost = -dot(a.dir, b.dir);
    if (opost < 0.35) continue;
    const v = Math.min(a.comp, b.comp) * (0.5 + opost);
    if (v > nota) { nota = v; par = [a, b]; }
  }
  if (!par) throw new Error("quadra sem duas ruas que se olham — não é de duas fileiras");
  // ordem no anel: F1, cabeceira 2, F2, cabeceira 1
  let [f1, f2] = par;
  const e2: [number, number] = [f1.s1, ajustarDepois(f2.s0, f1.s1, P)];
  const e1: [number, number] = [f2.s1, ajustarDepois(f1.s0, f2.s1, P)];
  return { anel, tipos, refs, Q, P, quinas, cadeias, f1, f2, e1, e2 };
}

function ajustarDepois(s: number, ref: number, P: number): number { let x = s; while (x < ref - 1e-9) x += P; while (x > ref + P) x -= P; return x; }
function dentroCiclico(s: number, a: number, b: number, P: number, tol: number): boolean {
  let x = s; while (x < a - tol) x += P; return x <= b + tol;
}
function arestaDe(anel: Pt[], m: Pt): number {
  let best = 0, bd = Infinity;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length], ab = sub(b, a), l2 = dot(ab, ab);
    const f = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(m, a), ab) / l2)) : 0;
    const d = dist(m, add(a, mul(ab, f)));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export function dentroAnel(p: Pt, anel: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const a = anel[i], b = anel[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

const distCaminho = (p: Pt, c: Caminho): number => c.projetar(p).d;

// ---------------------------------------------------------------------------
// Eixo: a linha equidistante das duas frentes (fileiras com a mesma profundidade)
// ---------------------------------------------------------------------------
/**
 * Traça a linha equidistante das duas frentes andando por ela: parte do meio
 * da quadra e caminha nos dois sentidos com passo fixo, voltando para g = 0
 * (g = distância a F1 − distância a F2) pelo gradiente. Sai ordenada e
 * contínua; termina onde sai da quadra (cabeceira) ou onde as frentes se
 * encontram (ponta).
 */
export function eixoEquidistante(E: Estrutura, passo = 1): { pts: Pt[]; meia: number[] } {
  const F1 = new Caminho(E.Q.trecho(E.f1.s0, E.f1.s1));
  const F2 = new Caminho(E.Q.trecho(E.f2.s0, E.f2.s1));
  const g = (X: Pt) => F1.projetar(X).d - F2.projetar(X).d;
  const grad = (X: Pt): Pt => {
    const c1 = F1.em(F1.projetar(X).t), c2 = F2.em(F2.projetar(X).t);
    return sub(unit(sub(X, c1)), unit(sub(X, c2)));
  };
  const corrigir = (X: Pt): Pt => {
    let Y = X;
    for (let i = 0; i < 6; i++) {
      const gv = g(Y), gr = grad(Y), l2 = dot(gr, gr);
      if (l2 < 1e-9 || Math.abs(gv) < 1e-6) break;
      Y = sub(Y, mul(gr, gv / l2));
    }
    return Y;
  };
  // ponto inicial: raio da metade de F1 até a equidistância
  let X0: Pt | null = null;
  for (const fr of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) {
    const P0 = F1.em(F1.L * fr), nr = F1.nrm(F1.L * fr);
    const cs = E.Q.cortes(add(P0, mul(nr, 0.05)), add(P0, mul(nr, 500))).filter((c) => c.f > 1e-6);
    if (!cs.length) continue;
    const lmax = Math.min(...cs.map((c) => c.f)) * 500;
    const h = (l: number) => g(add(P0, mul(nr, l)));
    if (h(lmax) < 0) continue;
    let lo = 0, hi = lmax;
    for (let it = 0; it < 60; it++) { const m = (lo + hi) / 2; if (h(m) < 0) lo = m; else hi = m; }
    X0 = add(P0, mul(nr, (lo + hi) / 2));
    break;
  }
  if (!X0) return { pts: [], meia: [] };
  const metade = (sentido: 1 | -1): Pt[] => {
    const out: Pt[] = [];
    let X = X0!;
    // direção de F1 no ponto mais próximo dá o sentido "para a cabeceira 2"
    let ant = mul(F1.tan(F1.projetar(X).t), sentido);
    for (let it = 0; it < 5000; it++) {
      const gr = grad(X);
      let tg = unit(esq(gr));
      if (norma(gr) < 1e-6) break;
      if (dot(tg, ant) < 0) tg = mul(tg, -1);
      let Y = corrigir(add(X, mul(tg, passo)));
      if (!dentroAnel(Y, E.anel)) {
        // fecha na borda
        const cs = E.Q.cortes(X, add(X, mul(unit(sub(Y, X)), passo * 3))).filter((c) => c.f > 1e-6);
        if (cs.length) out.push(cs.reduce((a, b) => (a.f < b.f ? a : b)).p);
        break;
      }
      if (F1.projetar(Y).d < 0.3) { out.push(Y); break; }
      if (out.length && dot(sub(Y, X), ant) <= 0) break;
      ant = unit(sub(Y, X));
      out.push(Y);
      X = Y;
    }
    return out;
  };
  const ida = metade(1), volta = metade(-1);
  const pts = [...volta.reverse(), X0, ...ida];
  return { pts, meia: pts.map((p) => F1.projetar(p).d) };
}

/** Douglas-Peucker */
/**
 * Linha limpa: sem ponto colado no anterior (menos de 30 cm) nem ponto no meio de um
 * trecho reto (giro abaixo de 0,3°). A realocação e o arraste podem juntar dois pontos
 * na mesma junção: o trechinho quase sem comprimento viraria uma dobra de direção aleatória.
 */
export function limparLinha(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  pts.forEach((p, i) => { if (!out.length || dist(out[out.length - 1], p) >= 0.3 || i === pts.length - 1) out.push([p[0], p[1]]); });
  if (out.length >= 2 && dist(out[out.length - 1], out[out.length - 2]) < 0.3) out.splice(out.length - 2, 1);
  for (let i = out.length - 2; i >= 1; i--) {
    const g = Math.abs(angulo(sub(out[i], out[i - 1]), sub(out[i + 1], out[i])));
    if (g < (0.3 * Math.PI) / 180) out.splice(i, 1);
  }
  return out.length >= 2 ? out : pts.slice(0, 2);
}

export function simplificar(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts.slice();
  const marca = new Array(pts.length).fill(false);
  marca[0] = marca[pts.length - 1] = true;
  const pilha: [number, number][] = [[0, pts.length - 1]];
  while (pilha.length) {
    const [a, b] = pilha.pop()!;
    let mx = -1, im = -1;
    for (let i = a + 1; i < b; i++) {
      const ab = sub(pts[b], pts[a]), l2 = dot(ab, ab);
      const f = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(pts[i], pts[a]), ab) / l2)) : 0;
      const d = dist(pts[i], add(pts[a], mul(ab, f)));
      if (d > mx) { mx = d; im = i; }
    }
    if (mx > tol) { marca[im] = true; pilha.push([a, im], [im, b]); }
  }
  return pts.filter((_, i) => marca[i]);
}

/** desloca a polilinha d metros para a esquerda (junta em esquadria) */
export function deslocar(pts: Pt[], d: number): Pt[] {
  if (Math.abs(d) < 1e-12) return pts.slice();
  const n = pts.length;
  const segs: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < n; i++) { const nr = mul(esq(unit(sub(pts[i + 1], pts[i]))), d); segs.push([add(pts[i], nr), add(pts[i + 1], nr)]); }
  const out: Pt[] = [segs[0][0]];
  for (let i = 1; i < segs.length; i++) out.push(intersecaoRetas(segs[i - 1][0], segs[i - 1][1], segs[i][0], segs[i][1]) ?? segs[i][0]);
  out.push(segs[segs.length - 1][1]);
  return out;
}

/** estende as pontas da polilinha até encostar no anel (ou corta onde ela sai) */
export function ajustarAoAnel(pts: Pt[], E: Estrutura, ini: boolean, fim: boolean): Pt[] {
  let p = pts.slice();
  const bater = (a: Pt, b: Pt): Pt | null => {
    // de b na direção b-a até o anel
    const d = unit(sub(b, a));
    const cs = E.Q.cortes(add(b, mul(d, -0.01)), add(b, mul(d, 500))).filter((c) => c.f > 1e-6);
    return cs.length ? cs.reduce((x, y) => (x.f < y.f ? x : y)).p : null;
  };
  if (fim) { const x = bater(p[p.length - 2], p[p.length - 1]); if (x) p[p.length - 1] = x; }
  if (ini) { const x = bater(p[1], p[0]); if (x) p[0] = x; }
  return p;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export interface Config {
  /** total de lotes da quadra */
  N: number;
  /** profundidade mínima da fileira — onde a quadra é mais estreita que 2×, vira fileira única (ponta) */
  profMin: number;
  /** linha central do operador (travada). Sem ela, a automática (equidistante e equilibrada) */
  C?: Pt[];
  /** com C travada: iguala cada fileira por si (padrão) — ou desloca C para todos ficarem iguais */
  equilibrar?: boolean;
  giroMin?: number;
  /** quantos lotes na ponta de cada cabeceira (auto se ausente) */
  ponta1?: number;
  ponta2?: number;
  /** como cada cabeceira é loteada */
  cab1?: "auto" | ModoCabeceira;
  cab2?: "auto" | ModoCabeceira;
  /** lotes em cada cabeceira de ponta/testa */
  m1?: number;
  m2?: number;
  /** esquina da fileira mais comprida absorve a cabeceira inclinada (padrão) ou fica igual (as laterais giram) */
  esquinas?: "absorver" | "iguais";
  /** (interno) linha central automática da 2ª passada, com as dobras já nas junções */
  _C0?: Pt[];
  _passo?: number;
  /** (interno) arraste ao vivo: não puxa divisa para as dobras da linha central (a dobra vai para a junção ao soltar) */
  _vivo?: boolean;
  /** profundidade padrão do lote (faixa da testa) */
  profPadrao?: number;
}

export interface LoteL {
  anel: Pt[];
  zona: "ponta1" | "ponta2" | "testa1" | "testa2" | "f1" | "f2";
  ordem: number;
  area: number;
  quinas: Quina[];
  /** lados medidos: frente (rua), fundo, laterais */
  frente: number;
  fundo: number;
  laterais: number[];
  /** giro das laterais em relação à perpendicular da rua (graus) */
  giroLat: number[];
}

export interface Layout {
  C: Pt[];
  eixo: Pt[];
  lotes: LoteL[];
  juncoes: Pt[];
  divisas: Pt[][];
  T1: number;
  T2: number;
  Tponta: number;
  cabeceiras?: ModoCabeceira[];
  esquinas?: { c1: number; c2: number; c1f: number; c2f: number };
  avisos: string[];
  ms: number;
}

/** caminho da fileira 1: do pé da linha de início, pelo anel (anti-horário), até o pé da linha de fim */
interface Fileiras {
  C: Caminho;
  B1: Caminho;
  B2: Caminho;
  /** estacas em B1 onde começa/termina F1 propriamente (os pés das divisas internas ficam aqui) */
  f1: [number, number];
  f2: [number, number];
}

function area1(F: Fileiras, u: number, t: number): number {
  const J = F.C.em(t), P = F.B1.em(u);
  return 0.5 * (F.B1.K(u) + cross(P, J) - F.C.K(t) + cross(F.C.p[0], F.B1.p[0]));
}
function area2(F: Fileiras, v: number, t: number): number {
  const J = F.C.em(t), P = F.B2.em(v), L = F.B2.L;
  return 0.5 * (F.C.K(t) + cross(J, P) + (F.B2.K(L) - F.B2.K(v)) + cross(F.B2.p[F.B2.p.length - 1], F.C.p[0]));
}

/** raiz de f crescente/decrescente em [a,b] por varredura nos vértices + bisseção */
function raiz(f: (x: number) => number, a: number, b: number, alvo: number, vertices: number[]): number | null {
  const xs = [a, ...vertices.filter((x) => x > a + 1e-9 && x < b - 1e-9), b];
  let fa = f(xs[0]) - alvo;
  if (Math.abs(fa) < 1e-9) return xs[0];
  for (let i = 1; i < xs.length; i++) {
    const fb = f(xs[i]) - alvo;
    if (Math.abs(fb) < 1e-9) return xs[i];
    if ((fa < 0) !== (fb < 0)) {
      // linear no trecho (área é linear dentro do segmento) — mas confirma por bisseção curta
      let lo = xs[i - 1], hi = xs[i], flo = fa;
      for (let it = 0; it < 60; it++) {
        const m = (lo + hi) / 2, fm = f(m) - alvo;
        if ((fm < 0) === (flo < 0)) { lo = m; flo = fm; } else hi = m;
        if (hi - lo < 1e-9) break;
      }
      return (lo + hi) / 2;
    }
    fa = fb;
  }
  return null;
}

function douradaMin(f: (x: number) => number, a: number, b: number, it = 60): number {
  // varredura grossa para não cair em mínimo local, depois seção áurea
  const n = 24;
  let bi = 0, bv = Infinity;
  for (let i = 0; i <= n; i++) { const x = a + ((b - a) * i) / n, v = f(x); if (v < bv) { bv = v; bi = i; } }
  let lo = a + ((b - a) * Math.max(0, bi - 1)) / n, hi = a + ((b - a) * Math.min(n, bi + 1)) / n;
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - g * (hi - lo), x2 = lo + g * (hi - lo), f1 = f(x1), f2 = f(x2);
  for (let i = 0; i < it && hi - lo > 1e-6; i++) {
    if (f1 < f2) { hi = x2; x2 = x1; f2 = f1; x1 = hi - g * (hi - lo); f1 = f(x1); }
    else { lo = x1; x1 = x2; f1 = f2; x2 = lo + g * (hi - lo); f2 = f(x2); }
  }
  return (lo + hi) / 2;
}

interface Divisa { t: number; u: number; v: number; fixo?: "u" | "v" | "t" }

/** resolve a divisa k: junção t em C e pés u (B1) e v (B2) com as áreas acumuladas τ1, τ2 */
function resolverDivisa(F: Fileiras, tau1: number, tau2: number, tMin: number, fixo?: { tipo: "u" | "v" | "t"; valor: number }): Divisa | null {
  const vb1 = F.B1.s, vb2 = F.B2.s, vc = F.C.s;
  const U = (t: number) => raiz((u) => area1(F, u, t), F.f1[0], F.f1[1], tau1, vb1);
  const V = (t: number) => raiz((v) => -area2(F, v, t), F.f2[0], F.f2[1], -tau2, vb2);
  const giro1 = (t: number, u: number) => angulo(F.B1.nrm(u), sub(F.C.em(t), F.B1.em(u)));
  const giro2 = (t: number, v: number) => angulo(F.B2.nrm(v), sub(F.C.em(t), F.B2.em(v)));
  if (fixo?.tipo === "u") {
    const u = fixo.valor;
    const t = raiz((tt) => area1(F, u, tt), tMin, F.C.L, tau1, vc);
    if (t === null) return null;
    const v = V(t);
    return v === null ? null : { t, u, v, fixo: "u" };
  }
  if (fixo?.tipo === "v") {
    const v = fixo.valor;
    const t = raiz((tt) => area2(F, v, tt), tMin, F.C.L, tau2, vc);
    if (t === null) return null;
    const u = U(t);
    return u === null ? null : { t, u, v, fixo: "v" };
  }
  if (fixo?.tipo === "t") {
    const t = fixo.valor, u = U(t), v = V(t);
    return u === null || v === null ? null : { t, u, v, fixo: "t" };
  }
  const custo = (t: number) => {
    const u = U(t), v = V(t);
    if (u === null || v === null) return 1e6 + Math.abs(t);
    const a = giro1(t, u), b = giro2(t, v);
    return a * a + b * b;
  };
  const t = douradaMin(custo, tMin, F.C.L - 1e-6);
  const u = U(t), v = V(t);
  return u === null || v === null ? null : { t, u, v };
}

/** região da ponta: caminho anti-horário que passa pela cabeceira; pés x (lado de F2) e y (lado de F1) */
interface Ponta { Tp: Caminho; xMax: number; yMin: number }

function pontaDe(E: Estrutura, qual: 1 | 2): Ponta {
  // ponta 1: de F2 (início) passando por e1 até F1 (fim); ponta 2: de F1 passando por e2 até F2
  if (qual === 1) {
    const s0 = E.f2.s0, s1 = ajustarDepois(E.f1.s1, E.f2.s0, E.P);
    const Tp = new Caminho(E.Q.trecho(s0, s1));
    return { Tp, xMax: E.f2.s1 - s0, yMin: ajustarDepois(E.f1.s0, E.f2.s0, E.P) - s0 };
  }
  const s0 = E.f1.s0, s1 = ajustarDepois(E.f2.s1, E.f1.s0, E.P);
  const Tp = new Caminho(E.Q.trecho(s0, s1));
  return { Tp, xMax: E.f1.s1 - s0, yMin: ajustarDepois(E.f2.s0, E.f1.s0, E.P) - s0 };
}
const areaPonta = (pt: Ponta, x: number, y: number) => 0.5 * (pt.Tp.K(y) - pt.Tp.K(x) + cross(pt.Tp.em(y), pt.Tp.em(x)));

/** transversal da ponta com área acumulada τ, a mais perpendicular às duas ruas */
function transversal(pt: Ponta, tau: number, passaPor?: Pt): { x: number; y: number } | null {
  const T = pt.Tp;
  const X = (y: number) => raiz((x) => -areaPonta(pt, x, y), 0, pt.xMax, -tau, T.s);
  const custo = (y: number, x: number) => {
    const w = sub(T.em(x), T.em(y));
    const a = angulo(T.nrm(y), w), b = angulo(T.nrm(x), mul(w, -1));
    return a * a + b * b;
  };
  if (passaPor) {
    // linha pela junção: escolhe o ângulo (y) — x é onde a reta y→C0 bate no lado de F2
    const c = (y: number) => {
      const Y = T.em(y), d = unit(sub(passaPor, Y));
      const cs = T.cortes(add(passaPor, mul(d, 0.01)), add(passaPor, mul(d, 600))).filter((k) => k.t <= pt.xMax + 1e-6);
      if (!cs.length) return { v: 1e6, x: 0 };
      const x = cs[cs.length - 1].t;
      return { v: custo(y, x), x };
    };
    const y = douradaMin((yy) => c(yy).v, pt.yMin, T.L);
    return { x: c(y).x, y };
  }
  const y = douradaMin((yy) => { const x = X(yy); return x === null ? 1e6 : custo(yy, x); }, pt.yMin, T.L);
  const x = X(y);
  return x === null ? null : { x, y };
}

function pontaVazia(E: Estrutura, qual: 1 | 2): boolean {
  const e = qual === 1 ? E.e1 : E.e2;
  return e[1] - e[0] < 1e-6;
}

export type ModoCabeceira = "direta" | "ponta" | "testa";

/** cabeceira de testa: lotes de frente para a rua da ponta, entre ela e a transversal (x, y) */
function lotesTesta(E: Estrutura, qual: 1 | 2, pt: Ponta, tr: { x: number; y: number }, m: number, giroMin: number, avisos: string[]): { lotes: LoteL[]; divisas: Pt[][] } {
  const Tp = pt.Tp;
  // a rua da ponta: a maior cadeia de rua entre o fim de uma frente e o começo da outra
  const base = qual === 1 ? E.f2.s0 : E.f1.s0;
  const ini = pt.xMax, fim = pt.yMin; // trecho da cabeceira em Tp (com os arcos das esquinas)
  let eA = ini, eB = fim, maior = -1;
  for (const c of E.cadeias) {
    const a = ajustarDepois(c.s0, base, E.P) - base, b = a + c.comp;
    if (a >= ini - 0.05 && b <= fim + 0.05 && c.comp > maior) { maior = c.comp; eA = a; eB = b; }
  }
  const X = Tp.em(tr.x), Y = Tp.em(tr.y);
  const linha = sub(X, Y), L2 = dot(linha, linha);
  // direção das divisas (paralelas, para não se cruzarem): o esquadro da rua da ponta;
  // se a ponta é tão inclinada que assim elas cruzam ou saem da faixa, a meia direção
  // entre o esquadro e o eixo da quadra; por último, paralelas ao eixo
  const normalRua = unit(esq(sub(Tp.em(eB), Tp.em(eA))));
  let eixoQ = unit(esq(linha));
  if (dot(eixoQ, normalRua) < 0) eixoQ = mul(eixoQ, -1);
  const candidatas: Pt[] = [normalRua, unit(add(normalRua, eixoQ)), eixoQ];
  const total = areaPonta(pt, tr.x, tr.y), Tm = total / m;
  let es: number[] = [], zs: Pt[] = [];
  let achou = false;
  for (const dir of candidatas) {
    const bate = (e: number): Pt => { const P = Tp.em(e); return intersecaoRetas(P, add(P, dir), Y, X) ?? P; };
    const areaAteE = (e: number) => { const z = bate(e); return 0.5 * (Tp.K(e) - Tp.K(tr.x) + cross(Tp.em(e), z) + cross(z, X)); };
    const eTent: number[] = [];
    let ok = true;
    for (let i = 1; i < m && ok; i++) {
      const e = raiz(areaAteE, eA + 0.05, eB - 0.05, i * Tm, Tp.s);
      if (e === null) ok = false; else eTent.push(e);
    }
    if (!ok) continue;
    const zTent = eTent.map(bate);
    // cada divisa bate na linha interna DENTRO do trecho, em ordem, sem furar o contorno
    const par = zTent.map((z) => (L2 > 0 ? dot(sub(z, Y), linha) / L2 : 0));
    const dentro = par.every((t) => t > 0.02 && t < 0.98);
    const ordem = par.every((t, k) => k === 0 || (par[k - 1] - t) * (par[0] - par[par.length - 1] >= 0 ? 1 : -1) > 0.005);
    const livre = eTent.every((e, k) => Tp.cortes(add(Tp.em(e), mul(unit(sub(zTent[k], Tp.em(e))), 0.05)), zTent[k]).length === 0);
    if (dentro && (par.length < 2 || ordem) && livre) { es = eTent; zs = zTent; achou = true; break; }
  }
  if (!achou) { avisos.push("testa: as divisas não cabem na faixa da rua da ponta sem se cruzar"); return { lotes: [], divisas: [] }; }
  const lotes: LoteL[] = [], divisas: Pt[][] = [];
  for (let i = 0; i < m; i++) {
    let anel: Pt[];
    if (m === 1) anel = Tp.trecho(tr.x, tr.y);
    else if (i === 0) anel = [...Tp.trecho(tr.x, es[0]), zs[0]];
    else if (i === m - 1) anel = [...Tp.trecho(es[m - 2], tr.y), zs[m - 2]];
    else anel = [...Tp.trecho(es[i - 1], es[i]), zs[i], zs[i - 1]];
    const l = medirPonta(anel, qual === 1 ? "testa1" : "testa2", i, giroMin);
    lotes.push(l);
  }
  for (let i = 0; i < es.length; i++) divisas.push([Tp.em(es[i]), zs[i]]);
  divisas.push([Y, X]);
  return { lotes, divisas };
}

const cacheEixo = new WeakMap<Estrutura, { pts: Pt[]; meia: number[] }>();

export function montar(E: Estrutura, cfg: Config): Layout {
  const t0 = performance.now();
  const avisos: string[] = [];
  const giroMin = cfg.giroMin ?? 12;
  const AQ = areaAss(E.anel);
  let eixo = cacheEixo.get(E);
  if (!eixo) { eixo = eixoEquidistante(E); cacheEixo.set(E, eixo); }
  if (eixo.pts.length < 2) throw new Error("não achei a linha equidistante entre as duas frentes");
  const N = cfg.N;
  const p1 = pontaDe(E, 1), p2 = pontaDe(E, 2);
  const absorver = (cfg.esquinas ?? "absorver") === "absorver";

  // --- modo de cada cabeceira
  const iDuas0 = eixo.meia.findIndex((m) => m >= cfg.profMin);
  const iDuas1 = eixo.meia.length - 1 - [...eixo.meia].reverse().findIndex((m) => m >= cfg.profMin);
  if (iDuas0 < 0) throw new Error("quadra estreita demais para duas fileiras");
  /** quanto a cabeceira foge do esquadro do eixo (graus) */
  const obliquidade = (qual: 1 | 2): number => {
    const e = qual === 1 ? E.e1 : E.e2;
    if (e[1] - e[0] < 1) return 90;
    const a = E.Q.em(e[0]), b = E.Q.em(e[1]);
    const k = qual === 1 ? 0 : eixo.pts.length - 1, k2 = qual === 1 ? Math.min(5, eixo.pts.length - 1) : Math.max(0, eixo.pts.length - 6);
    const dEixo = unit(sub(eixo.pts[k2], eixo.pts[k]));
    const dCab = unit(sub(b, a));
    // cabeceira em esquadro = perpendicular ao eixo → |cos| = 0
    return Math.asin(Math.min(1, Math.abs(dot(dEixo, dCab)))) / GRAU;
  };
  const decidir = (qual: 1 | 2): ModoCabeceira => {
    const pedido = qual === 1 ? cfg.cab1 : cfg.cab2;
    const estreita = qual === 1 ? iDuas0 > 0 : iDuas1 < eixo.pts.length - 1;
    if (pontaVazia(E, qual) || estreita) return "ponta";
    if (pedido && pedido !== "auto") return pedido;
    return obliquidade(qual) > 28 ? "testa" : "direta";
  };
  let modo1 = decidir(1), modo2 = decidir(2);

  // quantos lotes vão em cada cabeceira (ponta/testa) para um T
  const prof = cfg.profPadrao ?? 25;
  const lotesCab = (qual: 1 | 2, modo: ModoCabeceira, T: number): number => {
    const pedido = qual === 1 ? cfg.m1 : cfg.m2;
    if (modo === "direta") return 0;
    if (pedido !== undefined) return pedido;
    const pt = qual === 1 ? p1 : p2;
    if (modo === "ponta") {
      const X = eixo.pts[qual === 1 ? iDuas0 : iDuas1];
      const tr = transversal(pt, 0, X);
      return Math.max(1, Math.round((tr ? areaPonta(pt, tr.x, tr.y) : 0) / T));
    }
    // testa: faixa com a profundidade padrão do lote, medida pelo eixo a partir da rua da ponta
    const k = qual === 1 ? 0 : eixo.pts.length - 1;
    const sent = qual === 1 ? 1 : -1;
    let acc = 0, j = k;
    while (j + sent >= 0 && j + sent < eixo.pts.length && acc < prof) { acc += dist(eixo.pts[j], eixo.pts[j + sent]); j += sent; }
    const tr = transversal(pt, 0, eixo.pts[j]);
    return Math.max(1, Math.round((tr ? areaPonta(pt, tr.x, tr.y) : 0) / T));
  };

  // --- fileiras para uma linha central C entre as transversais tr1/tr2 (ou o anel)
  const fileiras = (Cpts: Pt[], tr1: { x: number; y: number } | null, tr2: { x: number; y: number } | null): { F: Fileiras; C: Pt[] } | null => {
    let C = Cpts.slice();
    const cortaNa = (C: Pt[], a: Pt, b: Pt, inicio: boolean): Pt[] => {
      const ext = C.slice();
      const d0 = unit(sub(ext[1], ext[0])), d1 = unit(sub(ext[ext.length - 1], ext[ext.length - 2]));
      ext[0] = add(ext[0], mul(d0, -300));
      ext[ext.length - 1] = add(ext[ext.length - 1], mul(d1, 300));
      const cam = new Caminho(ext);
      const da = unit(sub(b, a));
      const cs = cam.cortes(add(a, mul(da, -300)), add(b, mul(da, 300)));
      if (!cs.length) return C;
      if (inicio) { const c = cs[0]; const resto = cam.trecho(c.t, cam.L); resto[resto.length - 1] = C[C.length - 1]; return resto; }
      const c = cs[cs.length - 1]; const ini = cam.trecho(0, c.t); ini[0] = C[0]; return ini;
    };
    const P = E.P;
    const mod = (x: number) => ((x % P) + P) % P;
    const rel = (s: number, base: number) => mod(s - base);
    let P10: Pt, P20: Pt, P1n: Pt, P2n: Pt, s10: number, s20: number, s1n: number, s2n: number;
    if (tr1) {
      const Ya = p1.Tp.em(tr1.y), Xa = p1.Tp.em(tr1.x);
      C = cortaNa(C, Ya, Xa, true);
      P10 = Ya; P20 = Xa;
      s10 = mod(E.f2.s0 + tr1.y); s20 = mod(E.f2.s0 + tr1.x);
    } else {
      C = ajustarAoAnel(C, E, true, false);
      P10 = C[0]; P20 = C[0];
      s10 = s20 = mod(E.Q.projetar(C[0]).t);
    }
    if (tr2) {
      const Yb = p2.Tp.em(tr2.x), Xb = p2.Tp.em(tr2.y);
      C = cortaNa(C, Yb, Xb, false);
      P1n = Yb; P2n = Xb;
      s1n = mod(E.f1.s0 + tr2.x); s2n = mod(E.f1.s0 + tr2.y);
    } else {
      C = ajustarAoAnel(C, E, false, true);
      P1n = C[C.length - 1]; P2n = C[C.length - 1];
      s1n = s2n = mod(E.Q.projetar(C[C.length - 1]).t);
    }
    if (C.length < 2) return null;
    const l1 = rel(s1n, s10) || P, l2 = rel(s20, s2n) || P;
    const B1 = new Caminho([P10, ...E.Q.trecho(s10, s10 + l1).slice(1, -1), P1n]);
    const B2 = new Caminho([P2n, ...E.Q.trecho(s2n, s2n + l2).slice(1, -1), P20]);
    const faixa = (cad: Cadeia, base: number, comp: number): [number, number] => {
      let a = rel(cad.s0, base);
      let b = a + cad.comp;
      if (a > comp + 1e-6) { a = 0; b = rel(cad.s1, base); }
      return [Math.max(0, a - 0.01), Math.min(comp, b + 0.01)];
    };
    return { F: { C: new Caminho(C), B1, B2, f1: faixa(E.f1, s10, B1.L), f2: faixa(E.f2, s2n, B2.L) }, C };
  };
  const somas = (F: Fileiras) => ({ S1: area1(F, F.B1.L, F.C.L), S2: area2(F, 0, F.C.L) });
  // áreas acumuladas com as laterais no esquadro (pé = ponto mais perto de J na própria rua)
  // o pé é procurado só na própria rua (a cabeceira pode estar mais perto da junção)
  const frentes = new WeakMap<Fileiras, { r1: Caminho; r2: Caminho }>();
  const fr = (F: Fileiras) => { let x = frentes.get(F); if (!x) { x = { r1: new Caminho(F.B1.trecho(F.f1[0], F.f1[1])), r2: new Caminho(F.B2.trecho(F.f2[0], F.f2[1])) }; frentes.set(F, x); } return x; };
  const perp1 = (F: Fileiras, t: number) => { const J = F.C.em(t); const u = F.f1[0] + fr(F).r1.projetar(J).t; return area1(F, u, t); };
  const perp2 = (F: Fileiras, t: number) => { const J = F.C.em(t); const v = F.f2[0] + fr(F).r2.projetar(J).t; return area2(F, v, t); };
  /** sobra de área de uma fileira sobre a outra em cada cabeceira direta (a esquina da fileira mais comprida absorve) */
  const cunhas = (F: Fileiras, T: number, S1: number, S2: number): { W0: number; W1: number } => {
    let W0 = 0, W1 = 0;
    if (modo1 === "direta") {
      let lo = 0, hi = F.C.L;
      for (let i = 0; i < 50 && hi - lo > 1e-5; i++) { const m = (lo + hi) / 2; if (Math.min(perp1(F, m), perp2(F, m)) < T) lo = m; else hi = m; }
      W0 = perp1(F, lo) - perp2(F, lo);
    }
    if (modo2 === "direta") {
      let lo = 0, hi = F.C.L;
      for (let i = 0; i < 50 && hi - lo > 1e-5; i++) { const m = (lo + hi) / 2; if (Math.min(S1 - perp1(F, m), S2 - perp2(F, m)) > T) lo = m; else hi = m; }
      W1 = (S1 - perp1(F, hi)) - (S2 - perp2(F, hi));
    }
    return { W0, W1 };
  };

  // --- iteração em T. Nas cabeceiras diretas, a esquina da fileira mais comprida absorve a
  //     cunha; cunha de mais de meio lote vira lote(s) a mais nessa fileira (todos iguais), e
  //     cunha de mais de 1,4 lote faz a cabeceira virar "testa" (lotes de frente para a rua da ponta).
  const Cbase0 = limparLinha(cfg.C ? cfg.C.map((p) => [p[0], p[1]] as Pt) : (cfg._C0 ?? simplificar(eixo.pts, 0.35)));
  type Tr = { x: number; y: number } | null;
  interface Sol { T: number; W: { W0: number; W1: number }; base: { F: Fileiras; C: Pt[] }; tr1: Tr; tr2: Tr; m1: number; m2: number; n: number }
  const resolverT = (j0: number, j1: number): Sol => {
    let T = AQ / N, W = { W0: 0, W1: 0 };
    let tr1: Tr = null, tr2: Tr = null, m1 = 0, m2 = 0, n = 0;
    let base: { F: Fileiras; C: Pt[] } | null = null;
    for (let it = 0; it < 12; it++) {
      m1 = lotesCab(1, modo1, T); m2 = lotesCab(2, modo2, T);
      if ((N - m1 - m2 - j0 - j1) % 2 !== 0) {
        if (modo1 !== "direta" && cfg.m1 === undefined) m1 += 1;
        else if (modo2 !== "direta" && cfg.m2 === undefined) m2 += 1;
      }
      n = Math.floor((N - m1 - m2 - j0 - j1) / 2);
      if (n < 2) throw new Error(`não fecha: N=${N}, cabeceiras ${m1}+${m2}, esquinas +${j0}+${j1}`);
      if (cfg.C) {
        const naBorda = (p: Pt) => E.Q.projetar(p).d < 0.3;
        tr1 = naBorda(Cbase0[0]) ? null : transversal(p1, 0, Cbase0[0]);
        tr2 = naBorda(Cbase0[Cbase0.length - 1]) ? null : transversal(p2, 0, Cbase0[Cbase0.length - 1]);
      } else {
        tr1 = m1 > 0 ? transversal(p1, m1 * T) : null;
        tr2 = m2 > 0 ? transversal(p2, m2 * T) : null;
      }
      let Cuse = Cbase0;
      if (!cfg.C || cfg.equilibrar) {
        const dif = (d: number) => {
          const f = fileiras(deslocar(Cbase0, d), tr1, tr2);
          if (!f) return NaN;
          const s = somas(f.F);
          const w = absorver ? cunhas(f.F, T, s.S1, s.S2) : { W0: 0, W1: 0 };
          return s.S1 - s.S2 - (w.W0 + w.W1);
        };
        let lo = -12, hi = 12, flo = dif(lo), fhi = dif(hi);
        if (!(flo < 0 && fhi > 0)) { lo = -30; hi = 30; flo = dif(lo); fhi = dif(hi); }
        if (flo < 0 && fhi > 0) {
          for (let k = 0; k < 50 && hi - lo > 1e-5; k++) { const mm = (lo + hi) / 2, fm = dif(mm); if (fm < 0) lo = mm; else hi = mm; }
          Cuse = deslocar(Cbase0, (lo + hi) / 2);
        } else if (it === 0 && !avisos.includes("não consegui equilibrar as fileiras deslocando a linha central")) avisos.push("não consegui equilibrar as fileiras deslocando a linha central");
      }
      base = fileiras(Cuse, tr1, tr2);
      if (!base) throw new Error("linha central fora da quadra");
      const s = somas(base.F);
      W = absorver ? cunhas(base.F, T, s.S1, s.S2) : { W0: 0, W1: 0 };
      const Tn = (s.S1 + s.S2 - Math.abs(W.W0) - Math.abs(W.W1)) / (2 * n);
      if (cfg.C || Math.abs(Tn - T) < 1e-7) { T = Tn; break; }
      T = Tn;
    }
    return { T, W, base: base!, tr1, tr2, m1, m2, n };
  };
  let sol = resolverT(0, 0);
  if (absorver && !cfg.C) {
    let mudou = false;
    if (modo1 === "direta" && (cfg.cab1 ?? "auto") === "auto" && Math.abs(sol.W.W0) > 1.0 * sol.T) { modo1 = "testa"; mudou = true; }
    if (modo2 === "direta" && (cfg.cab2 ?? "auto") === "auto" && Math.abs(sol.W.W1) > 1.0 * sol.T) { modo2 = "testa"; mudou = true; }
    if (mudou) sol = resolverT(0, 0);
  }
  // lote a mais na esquina (0 ou 1 por cabeceira direta): o que deixa os lotes do grupo mais perto de T
  // e fecha a contagem par das fileiras
  let j0 = 0, j1 = 0;
  if (absorver) {
    const dev = (w: number, j: number) => Math.abs((sol.T + Math.abs(w)) / (j + 1) - sol.T) / sol.T;
    let melhor = Infinity;
    for (const a0 of modo1 === "direta" ? [0, 1] : [0]) for (const a1 of modo2 === "direta" ? [0, 1] : [0]) {
      const par = (N - sol.m1 - sol.m2 - a0 - a1) % 2 === 0;
      const c = dev(sol.W.W0, a0) + dev(sol.W.W1, a1) + (par ? 0 : 0.6);
      if (c < melhor) { melhor = c; j0 = a0; j1 = a1; }
    }
  }
  if (j0 || j1) sol = resolverT(j0, j1);
  const { W, base, tr1, tr2, m1, m2, n } = sol;
  if (m1 + m2 + j0 + j1 + 2 * n !== N) avisos.push(`fundo com fundo pede contagem par nas fileiras: ficaram ${m1 + m2 + j0 + j1 + 2 * n} lotes (pedido ${N})`);
  const F = base!.F;
  const { S1, S2 } = somas(F);
  const p = (x: number) => Math.max(0, x);
  // alvo de cada fileira (com C do operador as fileiras podem dar áreas diferentes)
  const T1 = (S1 - p(W.W0) - p(W.W1)) / n, T2 = (S2 - p(-W.W0) - p(-W.W1)) / n;
  const c1 = T1 + p(W.W0), c2 = T2 + p(-W.W0);

  // --- divisas da zona de duas fileiras
  const div: (Divisa | null)[] = [];
  let tMin = 0.3;
  for (let k = 1; k < n; k++) {
    const d = resolverDivisa(F, c1 + (k - 1) * T1, c2 + (k - 1) * T2, tMin);
    div.push(d);
    if (d) tMin = d.t + 0.3;
  }
  if (!cfg.C && !cfg._vivo && (cfg._passo ?? 1) < 4) {
    const dobras = F.C.dobras().filter((d) => Math.abs(d.giro) >= giroMin);
    if (dobras.length && div.some(Boolean)) {
      const pts = F.C.p.map((q) => [q[0], q[1]] as Pt);
      let mexeu = false;
      for (const d of dobras) {
        let best: Divisa | null = null, bd = Infinity;
        for (const x of div) if (x && Math.abs(x.t - d.t) < bd) { bd = Math.abs(x.t - d.t); best = x; }
        if (best && bd > 0.05 && bd < 8) { pts[d.i] = F.C.em(best.t); mexeu = true; }
      }
      if (mexeu) return montar(E, { ...cfg, _C0: limparLinha(pts), _passo: (cfg._passo ?? 1) + 1 });
    }
  }
  const dob1 = F.B1.dobras().filter((d) => Math.abs(d.giro) >= giroMin && Math.abs(d.giro) < 40 && d.t > F.f1[0] + 0.05 && d.t < F.f1[1] - 0.05);
  const dob2 = F.B2.dobras().filter((d) => Math.abs(d.giro) >= giroMin && Math.abs(d.giro) < 40 && d.t > F.f2[0] + 0.05 && d.t < F.f2[1] - 0.05);
  const dobC = cfg._vivo ? [] : F.C.dobras().filter((d) => Math.abs(d.giro) >= giroMin);
  // giro de uma divisa (o maior entre as duas laterais; na dobra, medido da bissetriz)
  const giroDe = (d: Divisa) => Math.max(
    Math.abs(angulo(F.B1.nrm(d.u), sub(F.C.em(d.t), F.B1.em(d.u)))),
    Math.abs(angulo(F.B2.nrm(d.v), sub(F.C.em(d.t), F.B2.em(d.v)))));
  const fixar = (tipo: "u" | "v" | "t", valor: number) => {
    // as duas divisas em volta da dobra: fica a que gira menos ao ir para cima dela
    const cand: number[] = [];
    for (let k = 0; k < div.length; k++) {
      const d = div[k]; if (!d || d.fixo) continue;
      cand.push(k);
    }
    const pos = (d: Divisa) => (tipo === "u" ? d.u : tipo === "v" ? d.v : d.t);
    cand.sort((x, y) => Math.abs(pos(div[x]!) - valor) - Math.abs(pos(div[y]!) - valor));
    let melhor: { k: number; d: Divisa; g: number } | null = null;
    for (const best of cand.slice(0, 2)) {
      const k = best + 1;
      const tm = best > 0 && div[best - 1] ? div[best - 1]!.t + 0.2 : 0.2;
      const nd = resolverDivisa(F, c1 + (k - 1) * T1, c2 + (k - 1) * T2, tm, { tipo, valor });
      if (!nd) continue;
      if (best + 1 < div.length && div[best + 1] && nd.t >= div[best + 1]!.t - 0.2) continue;
      const g = giroDe(nd);
      if (!melhor || g < melhor.g) melhor = { k: best, d: nd, g };
    }
    if (melhor) div[melhor.k] = melhor.d; else avisos.push("uma divisa não alcança a dobra sem sair da quadra");
  };
  for (const d of dob1) fixar("u", d.t);
  for (const d of dob2) fixar("v", d.t);
  for (const d of dobC) fixar("t", d.t);

  // --- laterais de uma fileira só (dentro do grupo de esquina que absorveu a cunha)
  const tDaNormal = (P: Pt, nr: Pt): number | null => {
    const cs = F.C.cortes(add(P, mul(nr, 0.01)), add(P, mul(nr, 400)));
    return cs.length ? cs.reduce((a, b) => (a.f < b.f ? a : b)).t : null;
  };
  const simples1 = (tau: number): { u: number; t: number } | null => {
    const g = (u: number) => { const t = tDaNormal(F.B1.em(u), F.B1.nrm(u)); return t === null ? NaN : area1(F, u, t); };
    let lo = F.f1[0], hi = F.f1[1];
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2, v = g(m); if (!(v >= tau)) lo = m; else hi = m; }
    const u = (lo + hi) / 2, t = tDaNormal(F.B1.em(u), F.B1.nrm(u));
    return t === null ? null : { u, t };
  };
  const simples2 = (tau: number): { v: number; t: number } | null => {
    const g = (v: number) => { const t = tDaNormal(F.B2.em(v), F.B2.nrm(v)); return t === null ? NaN : area2(F, v, t); };
    let lo = F.f2[0], hi = F.f2[1]; // área cai com v
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2, v = g(m); if (!(v <= tau)) lo = m; else hi = m; }
    const v = (lo + hi) / 2, t = tDaNormal(F.B2.em(v), F.B2.nrm(v));
    return t === null ? null : { v, t };
  };
  // laterais de cada fileira: bordas + divisas compartilhadas + as de uma fileira só
  type Lat = { pe: number; t: number; interna: boolean; compart: boolean };
  const lat1: Lat[] = [{ pe: 0, t: 0, interna: false, compart: false }, { pe: F.B1.L, t: F.C.L, interna: false, compart: false }];
  const lat2: Lat[] = [{ pe: F.B2.L, t: 0, interna: false, compart: false }, { pe: 0, t: F.C.L, interna: false, compart: false }];
  for (const d of div) if (d) { lat1.push({ pe: d.u, t: d.t, interna: true, compart: true }); lat2.push({ pe: d.v, t: d.t, interna: true, compart: true }); }
  const grupo = (w: number, j: number, inicio: boolean) => {
    if (j < 1) return;
    const lado1 = w > 0; // a fileira mais comprida
    const Tl = lado1 ? T1 : T2, S = lado1 ? S1 : S2, G = Tl + Math.abs(w);
    const novos: Lat[] = [];
    for (let i = 1; i <= j; i++) {
      const tau = inicio ? (i * G) / (j + 1) : S - G + (i * G) / (j + 1);
      const r = lado1 ? simples1(tau) : simples2(tau);
      const pe = r ? (lado1 ? (r as { u: number }).u : (r as { v: number }).v) : NaN;
      const fx = lado1 ? F.f1 : F.f2;
      const ok = r && pe > fx[0] + 0.3 && pe < fx[1] - 0.3 && Math.abs((lado1 ? area1(F, pe, r.t) : area2(F, pe, r.t)) - tau) < 0.5;
      if (!ok) { avisos.push(`esquina com ${G.toFixed(0)} m²: a sobra da cabeceira inclinada não dá outro lote de frente para a rua`); return; }
      novos.push({ pe, t: r!.t, interna: true, compart: false });
    }
    // a lateral do lote a mais não pode passar da primeira (ou da última) divisa
    // compartilhada: com a linha central dobrada ali, ela cruzaria a vizinha
    const ts = div.filter((d): d is Divisa => !!d).map((d) => d.t);
    if (ts.length) {
      const limite = inicio ? Math.min(...ts) - 0.5 : Math.max(...ts) + 0.5;
      if (novos.some((x) => (inicio ? x.t > limite : x.t < limite))) {
        avisos.push(`esquina com ${G.toFixed(0)} m²: a sobra da cabeceira inclinada não dá outro lote sem cruzar a divisa vizinha`);
        return;
      }
    }
    (lado1 ? lat1 : lat2).push(...novos);
  };
  grupo(W.W0, j0, true);
  grupo(W.W1, j1, false);
  lat1.sort((a, b) => a.pe - b.pe);
  lat2.sort((a, b) => b.pe - a.pe);

  const lotes: LoteL[] = [];
  const divisas: Pt[][] = [];
  const juncoes: Pt[] = [];
  if (div.some((d) => !d)) avisos.push("alguma divisa não fechou a área");
  for (let k = 0; k + 1 < lat1.length; k++) {
    const a = lat1[k], b = lat1[k + 1];
    const anel = [...F.B1.trecho(a.pe, b.pe), ...F.C.trecho(Math.min(a.t, b.t), Math.max(a.t, b.t)).reverse()];
    lotes.push(medir(anel, "f1", k, F.B1, a.pe, b.pe, F.C, a.t, b.t, giroMin, a.interna, b.interna));
  }
  for (let k = 0; k + 1 < lat2.length; k++) {
    const a = lat2[k], b = lat2[k + 1];
    const anel = [...F.C.trecho(Math.min(a.t, b.t), Math.max(a.t, b.t)), ...F.B2.trecho(b.pe, a.pe)];
    lotes.push(medir(anel, "f2", k, F.B2, a.pe, b.pe, F.C, a.t, b.t, giroMin, a.interna, b.interna));
  }
  for (const d of div) if (d) { juncoes.push(F.C.em(d.t)); divisas.push([F.B1.em(d.u), F.C.em(d.t), F.B2.em(d.v)]); }
  for (const l of lat1) if (l.interna && !l.compart) divisas.push([F.B1.em(l.pe), F.C.em(l.t)]);
  for (const l of lat2) if (l.interna && !l.compart) divisas.push([F.B2.em(l.pe), F.C.em(l.t)]);

  // --- cabeceiras
  const lotesPonta = (pt: Ponta, tr: { x: number; y: number } | null, m: number, zona: "ponta1" | "ponta2") => {
    if (!tr || m < 1) return;
    const Tm = areaPonta(pt, tr.x, tr.y) / m;
    let prev: { x: number; y: number } | null = null;
    for (let i = 1; i <= m; i++) {
      const cur = i === m ? tr : transversal(pt, i * Tm);
      if (!cur) { avisos.push(`ponta: transversal ${i} não fechou`); return; }
      const anel = prev ? [...pt.Tp.trecho(cur.x, prev.x), ...pt.Tp.trecho(prev.y, cur.y)] : pt.Tp.trecho(cur.x, cur.y);
      lotes.push(medirPonta(anel, zona, i - 1, giroMin));
      if (i < m) divisas.push([pt.Tp.em(cur.y), pt.Tp.em(cur.x)]);
      prev = cur;
    }
    divisas.push([pt.Tp.em(tr.y), pt.Tp.em(tr.x)]);
  };
  const cab = (qual: 1 | 2, modo: ModoCabeceira, tr: { x: number; y: number } | null, m: number) => {
    const pt = qual === 1 ? p1 : p2;
    if (modo === "ponta" || (cfg.C && tr && modo !== "testa")) lotesPonta(pt, tr, m, qual === 1 ? "ponta1" : "ponta2");
    else if (modo === "testa" && tr) { const r = lotesTesta(E, qual, pt, tr, m, giroMin, avisos); lotes.push(...r.lotes); divisas.push(...r.divisas); }
  };
  cab(1, modo1, tr1, m1);
  cab(2, modo2, tr2, m2);
  const Tcab = (tr: { x: number; y: number } | null, pt: Ponta, m: number) => (tr && m ? areaPonta(pt, tr.x, tr.y) / m : 0);
  return {
    C: base!.C, eixo: eixo.pts, lotes, juncoes, divisas, T1, T2,
    Tponta: Math.max(Tcab(tr1, p1, m1), Tcab(tr2, p2, m2)),
    cabeceiras: [modo1, modo2], esquinas: { c1, c2, c1f: T1 + p(W.W1), c2f: T2 + p(-W.W1) },
    avisos, ms: performance.now() - t0,
  };
}

function limpa(anel: Pt[]): Pt[] {
  const r: Pt[] = [];
  for (const q of anel) if (!r.length || dist(r[r.length - 1], q) > 1e-6) r.push(q);
  if (r.length > 1 && dist(r[0], r[r.length - 1]) <= 1e-6) r.pop();
  return r;
}

/** lote de fileira: pés ua (junção ta) e ub (junção tb); interna = a lateral é divisa de verdade (não a cabeceira) */
function medir(anelIn: Pt[], zona: "f1" | "f2", ordem: number, B: Caminho, ua: number, ub: number, C: Caminho, ta: number, tb: number, giroMin: number, internaA: boolean, internaB: boolean): LoteL {
  const anel = limpa(anelIn);
  const area = Math.abs(areaAss(anel));
  const frente = Math.abs(ub - ua), fundo = Math.abs(tb - ta);
  const Pa = B.em(ua), Pb = B.em(ub), Ja = C.em(ta), Jb = C.em(tb);
  const laterais = [dist(Pa, Ja), dist(Pb, Jb)];
  const g = (u: number, J: Pt) => Math.abs(angulo(B.nrm(u), sub(J, B.em(u)))) / GRAU;
  const giroLat = [internaA ? g(ua, Ja) : NaN, internaB ? g(ub, Jb) : NaN];
  return { anel, zona, ordem, area, quinas: quinasArco(anel, { giroMin }), frente, fundo, laterais, giroLat };
}

function medirPonta(anelIn: Pt[], zona: "ponta1" | "ponta2" | "testa1" | "testa2", ordem: number, giroMin: number): LoteL {
  const anel = limpa(anelIn);
  return { anel, zona, ordem, area: Math.abs(areaAss(anel)), quinas: quinasArco(anel, { giroMin }), frente: NaN, fundo: NaN, laterais: [], giroLat: [] };
}

/** Testa as combinações de cabeceira (direta × testa) que o operador deixou em "auto" e fica com a melhor. */
export function montarMelhor(E: Estrutura, cfg: Config): Layout & { nota: number; tentativas: string[] } {
  const opcoes = (pedido?: "auto" | ModoCabeceira): (ModoCabeceira | "auto")[] => (pedido && pedido !== "auto" ? [pedido] : ["auto", "direta", "testa"]);
  let melhor: (Layout & { nota: number; tentativas: string[] }) | null = null;
  const tentativas: string[] = [];
  const vistos = new Set<string>();
  for (const c1 of opcoes(cfg.cab1)) for (const c2 of opcoes(cfg.cab2)) {
    let L: Layout;
    try { L = montar(E, { ...cfg, cab1: c1, cab2: c2 }); } catch (e) { tentativas.push(`${c1}/${c2}: ${(e as Error).message}`); continue; }
    const chave = (L.cabeceiras ?? []).join("/");
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const { nota, q5, desvio, gmax } = notaDe(L, cfg.N);
    const cz = cruzamentos(L);
    tentativas.push(`${chave}: nota ${nota.toFixed(1)} (5+ quinas ${q5}, desvio ${(desvio * 100).toFixed(0)}%, giro ${gmax.toFixed(1)}°, lotes ${L.lotes.length}${cz ? ", CRUZA " + cz : ""})`);
    const pref = (L.cabeceiras ?? []).filter((c) => c === "testa").length * 0.5;
    if (!melhor || nota + pref < melhor.nota + (melhor as any)._pref) melhor = { ...L, nota, tentativas, _pref: pref } as any;
  }
  if (!melhor) throw new Error("nenhuma combinação de cabeceiras fechou: " + tentativas.join(" | "));
  // linha central com dobra que nenhuma junção alcança deixa lote de 5 quinas: tenta a
  // linha mais reta (menos pontos) com as mesmas cabeceiras e fica com a de nota menor
  const m0: Layout & { nota: number; tentativas: string[] } = melhor;
  if (!cfg.C && m0.lotes.some((l) => l.quinas.length > 4)) {
    const cab = { cab1: (m0.cabeceiras ?? [])[0], cab2: (m0.cabeceiras ?? [])[1] };
    let atual = m0;
    for (const tol of [1, 2.5, 6]) {
      try {
        const L = montar(E, { ...cfg, ...cab, _C0: simplificar(m0.eixo, tol) });
        const nn = notaDe(L, cfg.N).nota;
        tentativas.push(`linha mais reta (${tol} m): nota ${nn.toFixed(1)}`);
        if (nn < atual.nota) atual = { ...L, nota: nn, tentativas };
      } catch { /* não fechou */ }
    }
    melhor = atual;
  }
  if (!melhor) return m0;
  const gmax = notaDe(melhor, cfg.N).gmax;
  if (!cfg.C && gmax > 6) {
    const cab = { cab1: (melhor.cabeceiras ?? [])[0], cab2: (melhor.cabeceiras ?? [])[1] };
    const O = otimizarC(E, { ...cfg, ...cab }, melhor);
    const nO = notaDe(O, cfg.N);
    tentativas.push(`C otimizada (${O.avaliacoes} avaliações): giro ${nO.gmax.toFixed(1)}°, nota ${nO.nota.toFixed(1)}`);
    if (nO.nota < melhor.nota) return { ...O, nota: nO.nota, tentativas };
  }
  return melhor;
}

/** quantas vezes os contornos dos lotes se cruzam de verdade (sobreposição) — tem de ser zero */
export function cruzamentos(L: Layout): number {
  const segs: { a: Pt; b: Pt; lote: number; mn: Pt; mx: Pt }[] = [];
  L.lotes.forEach((l, k) => {
    const r = l.anel;
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (dist(a, b) < 1e-6) continue;
      segs.push({ a, b, lote: k, mn: [Math.min(a[0], b[0]), Math.min(a[1], b[1])], mx: [Math.max(a[0], b[0]), Math.max(a[1], b[1])] });
    }
  });
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const p = segs[i], q = segs[j];
    if (p.mx[0] < q.mn[0] || q.mx[0] < p.mn[0] || p.mx[1] < q.mn[1] || q.mx[1] < p.mn[1]) continue;
    const r = sub(p.b, p.a), t = sub(q.b, q.a), d = cross(r, t);
    if (Math.abs(d) < 1e-9) continue;
    const qp = sub(q.a, p.a);
    const u = cross(qp, t) / d, v = cross(qp, r) / d;
    // cruzamento próprio: longe das pontas dos dois segmentos
    const ea = 0.02 / norma(r), eb = 0.02 / norma(t);
    if (u > ea && u < 1 - ea && v > eb && v < 1 - eb) n++;
  }
  return n;
}

/** nota de um arranjo: quina a mais e lote faltando pesam muito; depois o giro das laterais */
export function notaDe(L: Layout, N: number): { nota: number; q5: number; desvio: number; gmax: number; g2: number } {
  const areas = L.lotes.map((l) => l.area).sort((a, b) => a - b);
  const med = areas[areas.length >> 1] || 1;
  const desvio = Math.max(...areas.map((a) => Math.abs(a - med) / med));
  const q5 = L.lotes.filter((l) => l.quinas.length > 4).length;
  const giros = L.lotes.flatMap((l) => l.giroLat.filter(Number.isFinite));
  const gmax = giros.length ? Math.max(...giros) : 0;
  const g2 = giros.reduce((t, g) => t + g * g, 0);
  const faltou = Math.abs(L.lotes.length - N);
  const cruz = cruzamentos(L);
  // proporção: lote-tira (fundo mais de 3× a largura, cresce ao quadrado) ou lote raso e largo demais pesa
  // — é o que deixava a "testa" de lotes estreitos e compridos ganhar da esquina
  const esguio = L.lotes.reduce((t, l) => { const r = alongamento(l.anel); return t + (r > 3 ? (r - 3) ** 2 : 0); }, 0);
  return { nota: 100 * q5 + 60 * desvio + 0.8 * gmax + 400 * faltou + 15 * L.avisos.length + 400 * cruz + 60 * esguio, q5, desvio, gmax, g2 };
}

/** comprimento ÷ largura do lote pela caixa orientada mais justa (largura = a menor extensão). */
export function alongamento(anel: Pt[]): number {
  let w = Infinity;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    if (dist(a, b) < 1) continue;
    const n = esq(unit(sub(b, a)));
    let lo = Infinity, hi = -Infinity;
    for (const q of anel) { const t = dot(sub(q, a), n); lo = Math.min(lo, t); hi = Math.max(hi, t); }
    w = Math.min(w, hi - lo);
  }
  if (!Number.isFinite(w) || w <= 0) return 1;
  const A = Math.abs(areaAss(anel));
  return Math.max(A / (w * w), (w * w) / Math.max(A, 1e-9));
}

/**
 * Linha central que deixa as laterais mais no esquadro: parte da automática, põe um vértice
 * nas junções das divisas que giram mais e desloca os vértices (de lado) para reduzir o giro,
 * sem mexer na área (cada passo é reequilibrado e as divisas recalculadas).
 */
export function otimizarC(E: Estrutura, cfg: Config, L0: Layout, maxAval = 160): Layout & { avaliacoes: number } {
  const base = L0.C.map((p) => [p[0], p[1]] as Pt);
  // vértices novos nas junções em volta das divisas que giram mais de 6°
  const C0 = new Caminho(base);
  const novos: number[] = [];
  for (const d of L0.divisas) if (d.length === 3) {
    const g1 = Math.abs(angulo(sub(d[1], d[0]), sub(d[1], d[0]))); void g1;
  }
  const ts: number[] = [];
  for (const l of L0.lotes) {
    if (!l.giroLat.some((g) => Number.isFinite(g) && g > 6)) continue;
    for (const j of L0.juncoes) { const t = C0.projetar(j).t; if (C0.projetar(j).d < 0.5) ts.push(t); }
  }
  // só as junções perto das divisas giradas: as que estão nos lotes com giro alto
  const alvo = new Set<number>();
  for (const l of L0.lotes) {
    if (!l.giroLat.some((g) => Number.isFinite(g) && g > 6)) continue;
    for (const j of L0.juncoes) if (l.anel.some((p) => dist(p, j) < 0.05)) alvo.add(Math.round(C0.projetar(j).t * 100) / 100);
  }
  void ts; void novos;
  const pts: Pt[] = [base[0]];
  const tsAlvo = [...alvo].sort((a, b) => a - b);
  for (let i = 1; i < base.length; i++) {
    for (const t of tsAlvo) if (t > C0.s[i - 1] + 1 && t < C0.s[i] - 1) pts.push(C0.em(t));
    pts.push(base[i]);
  }
  const nInt = pts.length - 2;
  if (nInt < 1) return { ...L0, avaliacoes: 0 };
  const normais = pts.map((_, i) => (i === 0 || i === pts.length - 1 ? [0, 0] as Pt : unit(esq(add(unit(sub(pts[i], pts[i - 1])), unit(sub(pts[i + 1], pts[i])))))));
  const off = new Array(pts.length).fill(0);
  const comOff = () => pts.map((p, i) => add(p, mul(normais[i], off[i])));
  let aval = 0;
  const avaliar = (): { L: Layout; v: number } | null => {
    aval++;
    try {
      const L = montar(E, { ...cfg, _C0: comOff(), _passo: 4 });
      const n = notaDe(L, cfg.N);
      const reg = off.reduce((t, o) => t + o * o, 0);
      return { L, v: n.nota * 50 + n.g2 + 0.3 * reg };
    } catch { return null; }
  };
  let atual = avaliar();
  if (!atual) return { ...L0, avaliacoes: aval };
  for (const passo of [3, 1.5, 0.7, 0.3]) {
    let melhorou = true, voltas = 0;
    while (melhorou && voltas < 3 && aval < maxAval) {
      melhorou = false; voltas++;
      for (let i = 1; i <= nInt && aval < maxAval; i++) {
        for (const sgn of [1, -1]) {
          off[i] += sgn * passo;
          const r = avaliar();
          if (r && r.v < atual!.v - 1e-6) { atual = r; melhorou = true; break; }
          off[i] -= sgn * passo;
        }
      }
    }
  }
  return { ...atual!.L, avaliacoes: aval };
}
