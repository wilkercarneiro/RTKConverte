/**
 * Rearranjo dos lotes SELECIONADOS ("Igualar áreas" e "Ajustar fundo com fundo"
 * com vários lotes): a terra deles (a união dos contornos) é redividida entre
 * eles mesmos. O contorno da união não muda — os lotes de fora da seleção ficam
 * exatamente como estão — e cada lote novo sai com a mesma área, laterais no
 * esquadro da rua (ou na direção que deixa os lotes mais parecidos entre si)
 * e, nas duas fileiras, fundo com fundo pela linha central.
 *
 * - Duas fileiras (a seleção encosta em duas ruas que se olham): o motor da
 *   linha central (linhaCentral.ts) roda dentro da união, com as cabeceiras nas
 *   divisas com os lotes de fora ("direta"); a junção de cada par fica na linha
 *   central — nenhum lote "pula" para o fundo do outro.
 * - Uma fileira (a seleção encosta numa rua só): a frente é dividida em cortes
 *   de rua a fundo, cada um achado pela área acumulada (exata). A direção dos
 *   cortes é a que deixa os lotes com melhor forma: no esquadro da rua, todos
 *   paralelos (a média das pontas) ou em leque — conferido lote a lote (quinas,
 *   esquadro, laterais paralelas, proporção fundo/frente). No "fundo com fundo",
 *   se a fileira de trás tem a mesma quantidade de lotes, cada corte termina
 *   numa junção dela (o fundo de cada lote encosta num lote só).
 */
import { areaAssinada, centroide, cross, dist, distSegmento, dot, esquerda, lerp, quinasAviso, quinasDetalhe, sub, unit } from "./geom.ts";
import type { Pt } from "./geom.ts";
import { cruzamentos as cruzamentosLC, estruturar, montar, montarMelhor } from "./linhaCentral.ts";
import type { Layout, TipoAresta } from "./linhaCentral.ts";
import { contornos, estruturaDeDivisas, gravar, normalizar, posicaoNoDesenho } from "./edicao.ts";
import type { Edicao, Meta } from "./edicao.ts";
import { encaixarNasQuinas, esquinaDe, fmt, foraDasFaixas, frentePrincipal, profundidadeDe } from "./calculo.ts";
import type { Quadra, Resultado } from "./calculo.ts";
import type { Parametros, Projeto } from "./modelo.ts";

const GRAU = Math.PI / 180;
const chave = (p: Pt) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
const ang = (a: Pt, b: Pt) => Math.atan2(cross(a, b), dot(a, b));

// ---------------------------------------------------------------------------
// Contorno da união (exato: as arestas internas, que dois lotes compartilham, se cancelam)
// ---------------------------------------------------------------------------
export function contornoUniao(aneis: Pt[][]): Pt[][] {
  interface Ar { a: Pt; b: Pt; ka: string; kb: string; usada: boolean }
  const todas: Ar[] = [];
  const conta = new Map<string, number>();
  for (const an0 of aneis) {
    if (an0.length < 3) continue;
    const an = areaAssinada(an0) < 0 ? [...an0].reverse() : an0;
    for (let i = 0; i < an.length; i++) {
      const a = an[i], b = an[(i + 1) % an.length];
      const ka = chave(a), kb = chave(b);
      if (ka === kb) continue;
      todas.push({ a, b, ka, kb, usada: false });
      conta.set(ka + "|" + kb, (conta.get(ka + "|" + kb) ?? 0) + 1);
    }
  }
  const borda = todas.filter((e) => !conta.has(e.kb + "|" + e.ka));
  const porIni = new Map<string, Ar[]>();
  for (const e of borda) porIni.set(e.ka, [...(porIni.get(e.ka) ?? []), e]);
  const out: Pt[][] = [];
  for (const e0 of borda) {
    if (e0.usada) continue;
    const anel: Pt[] = [];
    let e: Ar | undefined = e0;
    for (let g = 0; e && !e.usada && g < 100000; g++) {
      e.usada = true;
      anel.push(e.a);
      const cands: Ar[] = (porIni.get(e.kb) ?? []).filter((x) => !x.usada);
      if (cands.length > 1) {
        // vértice de toque: segue a que gira mais à esquerda (contorno de fora)
        const d = unit(sub(e.b, e.a));
        cands.sort((x, y) => ang(d, unit(sub(y.b, y.a))) - ang(d, unit(sub(x.b, x.a))));
      }
      e = cands[0];
    }
    if (anel.length >= 3) out.push(anel);
  }
  return out.sort((x, y) => Math.abs(areaAssinada(y)) - Math.abs(areaAssinada(x)));
}

// ---------------------------------------------------------------------------
// Qualidade de um lote (a mesma régua para escolher entre os arranjos)
// ---------------------------------------------------------------------------
export interface Forma { quinas: number; dev: number[]; paralelo: number; testada: number; prof: number; /** lote da ponta (esquina: a frente soma a outra rua) */ ponta?: boolean }

/** medidas do projeto (frente mínima/máxima) da operação em curso */
let LIM: { frenteMin: number; frenteMax: number } = { frenteMin: 0, frenteMax: Infinity };
/** lote fora das medidas do projeto (testada abaixo da mínima ou acima da máxima, 5ª quina) */
const foraDasMedidas = (f: Forma) => (Number.isFinite(f.testada) && (f.testada < LIM.frenteMin - 0.005 || (!f.ponta && f.testada > LIM.frenteMax * 1.03))) || f.quinas > 4;

function custoForma(f: Forma, alvo: { testada: number }): number {
  let c = 0;
  if (Number.isFinite(f.testada) && (f.testada < LIM.frenteMin - 0.005 || (!f.ponta && f.testada > LIM.frenteMax * 1.03))) c += 6000;
  for (const d of f.dev) c += d * d;
  c += 1.5 * f.paralelo * f.paralelo;
  if (f.quinas > 4) c += 3000 * (f.quinas - 4);
  const razao = f.prof / Math.max(0.1, f.testada);
  if (razao > 4) c += 400 * (razao - 4) ** 2;
  if (razao < 0.8) c += 400 * (0.8 - razao) ** 2 * 10;
  if (alvo.testada > 0) c += 200 * ((f.testada - alvo.testada) / alvo.testada) ** 2;
  return c;
}

// ---------------------------------------------------------------------------
// Uma fileira: cortes de rua a fundo com a área acumulada exata
// ---------------------------------------------------------------------------
interface Corte { s: number; P: Pt; Q: Pt; sig: number }
interface Fileira {
  anel: Pt[];
  S: number[];
  per: number;
  /** comprimento da frente (do vértice 0 até o vértice m) */
  L: number;
  m: number;
  /** direções das pontas para dentro (null = ponta livre: esquina com outra rua) */
  dA: Pt | null;
  dB: Pt | null;
}

function pontoEm(F: Fileira, s: number): Pt {
  const { anel, S } = F;
  const n = anel.length;
  let x = ((s % F.per) + F.per) % F.per;
  for (let i = 0; i < n; i++) {
    const s0 = S[i], s1 = i + 1 < n ? S[i + 1] : F.per;
    if (x <= s1 + 1e-12) {
      const l = s1 - s0;
      return lerp(anel[i], anel[(i + 1) % n], l > 0 ? Math.max(0, Math.min(1, (x - s0) / l)) : 0);
    }
  }
  return anel[0];
}

/** normal para dentro na frente (no vértice, a bissetriz) */
function normalFrente(F: Fileira, s: number): Pt {
  const { anel, S } = F;
  let i = 0;
  while (i + 1 < F.m && S[i + 1] <= s + 1e-9) i++;
  const d = unit(sub(anel[i + 1], anel[i]));
  if (Math.abs(s - S[i]) < 1e-6 && i > 0) return unit(esquerda(soma2(unit(sub(anel[i], anel[i - 1])), d)));
  if (Math.abs(s - S[i + 1]) < 1e-6 && i + 1 < F.m) return unit(esquerda(soma2(d, unit(sub(anel[i + 2], anel[i + 1])))));
  return esquerda(d);
}
const soma2 = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];

/** do ponto da frente na direção d até o contorno (do outro lado) */
function bater(F: Fileira, s: number, d: Pt): { Q: Pt; sig: number } | null {
  const P = pontoEm(F, s);
  const { anel, S } = F;
  const n = anel.length;
  let melhor: { Q: Pt; sig: number; t: number } | null = null;
  for (let j = 0; j < n; j++) {
    const a = anel[j], b = anel[(j + 1) % n];
    const e = sub(b, a);
    const den = cross(d, e);
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(a, P);
    const t = cross(w, e) / den, u = cross(w, d) / den;
    if (t <= 0.05 || u < -1e-9 || u > 1 + 1e-9) continue;
    if (!melhor || t < melhor.t) melhor = { Q: [P[0] + d[0] * t, P[1] + d[1] * t], sig: S[j] + u * dist(a, b), t };
  }
  return melhor ? { Q: melhor.Q, sig: melhor.sig } : null;
}

/** anel da região entre o corte a e o corte b (a antes de b na frente) */
function anelEntre(F: Fileira, a: Corte, b: Corte): Pt[] {
  const { anel, S } = F;
  const r: Pt[] = [a.P];
  for (let i = 0; i < anel.length; i++) if (S[i] > a.s + 1e-7 && S[i] < b.s - 1e-7) r.push(anel[i]);
  r.push(b.P);
  if (dist(b.Q, b.P) > 1e-6) r.push(b.Q);
  // contorno de trás: do sig de b até o sig de a (sentido do anel)
  const sb = b.sig, sa = a.sig;
  for (let i = 0; i < anel.length; i++) if (S[i] > sb + 1e-7 && S[i] < sa - 1e-7) r.push(anel[i]);
  if (dist(a.Q, a.P) > 1e-6 && dist(a.Q, r[r.length - 1]) > 1e-6) r.push(a.Q);
  const out: Pt[] = [];
  for (const p of r) if (!out.length || dist(out[out.length - 1], p) > 1e-6) out.push(p);
  if (out.length > 2 && dist(out[0], out[out.length - 1]) < 1e-6) out.pop();
  return out;
}

const areaDe = (r: Pt[]) => Math.abs(areaAssinada(r));

function seCruza(a: Pt[]): boolean {
  const n = a.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const p = a[i], r = sub(a[(i + 1) % n], p), q = a[j], s = sub(a[(j + 1) % n], q);
    const den = cross(r, s);
    if (Math.abs(den) < 1e-12) continue;
    const t = cross(sub(q, p), s) / den, u = cross(sub(q, p), r) / den;
    if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) return true;
  }
  return false;
}

type ModoCorte = "esquadro" | "paralelas" | "leque" | "juncoes";

interface Divisao { modo: ModoCorte; aneis: Pt[][]; custo: number; formas: Forma[]; cortes: Corte[] }

export function dividirFileira(F: Fileira, N: number, modo: ModoCorte, juncoes?: { Q: Pt; sig: number }[]): Divisao | null {
  const total = areaDe(F.anel);
  const T = total / N;
  const nA = F.dA ?? normalFrente(F, 0), nB = F.dB ?? normalFrente(F, F.L);
  const thA = Math.atan2(nA[1], nA[0]);
  let dth = Math.atan2(nB[1], nB[0]) - thA;
  while (dth > Math.PI) dth -= 2 * Math.PI;
  while (dth < -Math.PI) dth += 2 * Math.PI;
  const media = unit(soma2(nA, nB));
  const direcao = (s: number): Pt => {
    if (modo === "esquadro") return normalFrente(F, s);
    if (modo === "paralelas") return media;
    const th = thA + dth * (s / F.L);
    return [Math.cos(th), Math.sin(th)];
  };
  const corteEm = (s: number, k: number): Corte | null => {
    const P = pontoEm(F, s);
    if (modo === "juncoes" && juncoes) { const j = juncoes[k - 1]; return { s, P, Q: j.Q, sig: j.sig }; }
    const h = bater(F, s, direcao(s));
    return h ? { s, P, Q: h.Q, sig: h.sig } : null;
  };
  const ini: Corte = { s: 0, P: F.anel[0], Q: F.anel[0], sig: F.per };
  const fim: Corte = { s: F.L, P: F.anel[F.m], Q: F.anel[F.m], sig: F.L };
  const cortes: Corte[] = [ini];
  for (let k = 1; k < N; k++) {
    const ant = cortes[k - 1];
    const f = (s: number) => { const c = corteEm(s, k); return c ? areaDe(anelEntre(F, ini, c)) - k * T : NaN; };
    let lo = ant.s + 0.05, hi = F.L - 0.05;
    let flo = f(lo), fhi = f(hi);
    if (!(flo < 0) || !(fhi > 0)) return null;
    for (let it = 0; it < 70 && hi - lo > 1e-7; it++) {
      const m = (lo + hi) / 2, fm = f(m);
      if (!Number.isFinite(fm)) return null;
      if (fm < 0) { lo = m; flo = fm; } else { hi = m; fhi = fm; }
    }
    const c = corteEm((lo + hi) / 2, k);
    if (!c) return null;
    // cortes não se cruzam: o pé de trás anda para trás no anel
    if (c.sig >= ant.sig - 0.05 || c.sig <= F.L + 0.05) return null;
    cortes.push(c);
  }
  cortes.push(fim);
  const aneis: Pt[][] = [];
  const formas: Forma[] = [];
  for (let k = 0; k < N; k++) {
    const a = cortes[k], b = cortes[k + 1];
    const r = anelEntre(F, a, b);
    if (r.length < 3 || seCruza(r) || Math.abs(areaDe(r) - T) > Math.max(0.05, 0.002 * T)) return null;
    aneis.push(r);
    const fr = sub(b.P, a.P);
    const latA = k === 0 ? (F.dA ? F.dA : null) : sub(a.Q, a.P);
    const latB = k === N - 1 ? (F.dB ? F.dB : null) : sub(b.Q, b.P);
    const dev: number[] = [];
    for (const l of [latA, latB]) if (l) dev.push(Math.abs(90 - Math.abs(ang(fr, l)) / GRAU));
    const paralelo = latA && latB ? Math.abs(ang(latA, latB)) / GRAU : 0;
    const testada = b.s - a.s;
    formas.push({ quinas: quinasAviso(r), dev, paralelo, testada, prof: areaDe(r) / Math.max(0.1, testada), ponta: k === 0 || k === N - 1 });
  }
  const alvo = { testada: F.L / N };
  const custo = formas.reduce((s, f) => s + custoForma(f, alvo), 0);
  return { modo, aneis, custo, formas, cortes };
}

// ---------------------------------------------------------------------------
// Duas fileiras por faixas: divisas retas de rua a rua (paralelas às pontas ou em
// leque) em faixas de 2T; em cada divisa, a junção do fundo com fundo é o ponto que
// parte a faixa em duas metades de T. A linha central passa pelas junções.
// ---------------------------------------------------------------------------
function fatiar(path: Pt[], t: number): { ini: Pt[]; fim: Pt[]; J: Pt } {
  let acc = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const l = dist(path[i], path[i + 1]);
    if (acc + l >= t - 1e-12 || i + 2 === path.length) {
      const J = lerp(path[i], path[i + 1], l > 0 ? Math.max(0, Math.min(1, (t - acc) / l)) : 0);
      return { ini: [...path.slice(0, i + 1), J], fim: [J, ...path.slice(i + 1)], J };
    }
    acc += l;
  }
  return { ini: [path[0]], fim: path.slice(), J: path[0] };
}
const compr = (p: Pt[]) => p.reduce((s, q, i) => (i ? s + dist(p[i - 1], q) : 0), 0);
const semRepetir = (r: Pt[]) => { const o: Pt[] = []; for (const p of r) if (!o.length || dist(o[o.length - 1], p) > 1e-6) o.push(p); if (o.length > 2 && dist(o[0], o[o.length - 1]) < 1e-6) o.pop(); return o; };

export function dividirDuas(F: Fileira, sigA: number, sigB: number, N: number, modo: ModoCorte): Divisao | null {
  if (N % 2 !== 0 || N < 4) return null;
  const n = N / 2;
  const fx = dividirFileira(F, n, modo);
  if (!fx) return null;
  const T = areaDe(F.anel) / N;
  const { anel, S } = F;
  const nv = anel.length;
  const pt = (s: number) => pontoEm(F, s);
  // caminhos de frente a fundo: as pontas seguem o contorno
  const pathA: Pt[] = [anel[0]];
  for (let i = nv - 1; i > 0 && S[i] > sigA + 1e-7; i--) pathA.push(anel[i]);
  pathA.push(pt(sigA));
  const pathB: Pt[] = [anel[F.m]];
  for (let i = F.m + 1; i < nv && S[i] < sigB - 1e-7; i++) pathB.push(anel[i]);
  pathB.push(pt(sigB));
  const cortes = fx.cortes;
  for (let k = 1; k < n; k++) if (cortes[k].sig <= sigB + 0.05 || cortes[k].sig >= sigA - 0.05) return null; // a divisa tem de chegar na outra rua
  const paths: Pt[][] = cortes.map((c, k) => (k === 0 ? pathA : k === n ? pathB : [c.P, c.Q]));
  const sigQ = cortes.map((c, k) => (k === 0 ? sigA : k === n ? sigB : c.sig));
  const frenteEntre = (a: number, b: number) => { const r: Pt[] = [pt(a)]; for (let i = 0; i < nv; i++) if (S[i] > a + 1e-7 && S[i] < b - 1e-7) r.push(anel[i]); r.push(pt(b)); return r; };
  const fundoEntre = (a: number, b: number) => { const r: Pt[] = []; for (let i = 0; i < nv; i++) if (S[i] > a + 1e-7 && S[i] < b - 1e-7) r.push(anel[i]); return r; };
  const lote1 = (k: number, tk: number, tk1: number) => {
    const a = fatiar(paths[k], tk), b = fatiar(paths[k + 1], tk1);
    return semRepetir([...frenteEntre(cortes[k].s, cortes[k + 1].s), ...b.ini.slice(1), ...[...a.ini].reverse().slice(0, -1)]);
  };
  const lote2 = (k: number, tk: number, tk1: number) => {
    const a = fatiar(paths[k], tk), b = fatiar(paths[k + 1], tk1);
    return semRepetir([...b.fim, ...fundoEntre(sigQ[k + 1], sigQ[k]), ...a.fim.slice().reverse()]);
  };
  const resolver = (t0: number): { ts: number[]; giro: number } | null => {
    const ts = [t0];
    for (let k = 0; k < n; k++) {
      const Lp = compr(paths[k + 1]);
      const f = (t: number) => areaDe(lote1(k, ts[k], t)) - T;
      let lo = 0.3, hi = Lp - 0.3;
      if (!(f(lo) < 0) || !(f(hi) > 0)) return null;
      for (let it = 0; it < 60 && hi - lo > 1e-7; it++) { const m = (lo + hi) / 2; if (f(m) < 0) lo = m; else hi = m; }
      ts.push((lo + hi) / 2);
    }
    const Js = ts.map((t, k) => fatiar(paths[k], t).J);
    let giro = 0;
    for (let k = 1; k + 1 < Js.length; k++) giro += ang(sub(Js[k], Js[k - 1]), sub(Js[k + 1], Js[k])) ** 2;
    return { ts, giro };
  };
  const LA = compr(pathA);
  const montarCom = (sol: { ts: number[]; giro: number }): Divisao | null => {
    const aneis: Pt[][] = [], formas: Forma[] = [];
    for (let k = 0; k < n; k++) {
      for (const lado of [1, 2]) {
        const r = lado === 1 ? lote1(k, sol.ts[k], sol.ts[k + 1]) : lote2(k, sol.ts[k], sol.ts[k + 1]);
        if (r.length < 3 || seCruza(r) || Math.abs(areaDe(r) - T) > Math.max(0.05, 0.002 * T)) return null;
        aneis.push(r);
        const ja = fatiar(paths[k], sol.ts[k]).J, jb = fatiar(paths[k + 1], sol.ts[k + 1]).J;
        const pa = lado === 1 ? paths[k][0] : paths[k][paths[k].length - 1], pb = lado === 1 ? paths[k + 1][0] : paths[k + 1][paths[k + 1].length - 1];
        const fr = sub(pb, pa), la = sub(ja, pa), lb = sub(jb, pb);
        const dev = [Math.abs(90 - Math.abs(ang(fr, la)) / GRAU), Math.abs(90 - Math.abs(ang(fr, lb)) / GRAU)];
        const testada = dist(pa, pb);
        formas.push({ quinas: quinasAviso(r), dev, paralelo: Math.abs(ang(la, lb)) / GRAU, testada, prof: areaDe(r) / Math.max(0.1, testada), ponta: k === 0 || k === n - 1 });
      }
    }
    const custo = formas.reduce((s, f) => s + custoForma(f, { testada: 0 }), 0) + 5 * sol.giro / (GRAU * GRAU);
    return { modo, aneis, custo, formas, cortes };
  };
  // a junção da ponta: pontos espaçados e as quinas do caminho (o degrau do vizinho:
  // junção nele não deixa quina a mais no lote da ponta)
  const t0s: number[] = [];
  for (let i = 1; i < 20; i++) t0s.push((LA * i) / 20);
  for (let i = 1, acc = 0; i + 1 < pathA.length; i++) { acc += dist(pathA[i - 1], pathA[i]); t0s.push(acc); }
  let melhor: Divisao | null = null;
  for (const t0 of t0s) {
    if (t0 <= 0.3 || t0 >= LA - 0.3) continue;
    const sol = resolver(t0);
    const d = sol && montarCom(sol);
    if (d && (!melhor || d.custo < melhor.custo)) melhor = d;
  }
  return melhor;
}

// ---------------------------------------------------------------------------
// Cadeias do contorno (frente, pontas, fundo)
// ---------------------------------------------------------------------------
interface CadeiaR { i0: number; i1: number; rua: boolean; comp: number }

function cadeias(anel: Pt[], rua: boolean[]): CadeiaR[] {
  const n = anel.length;
  const corta = new Set<number>();
  for (const q of quinasDetalhe(anel, 3.5, 12, 40)) if (Math.abs(q.giro) >= 40) { corta.add(q.i0); corta.add(q.i1); }
  for (let i = 0; i < n; i++) if (rua[(i - 1 + n) % n] !== rua[i]) corta.add(i);
  const cs = [...corta].sort((a, b) => a - b);
  if (!cs.length) return [{ i0: 0, i1: n, rua: rua[0], comp: anel.reduce((s, p, i) => s + dist(p, anel[(i + 1) % n]), 0) }];
  const out: CadeiaR[] = [];
  for (let k = 0; k < cs.length; k++) {
    const i0 = cs[k];
    let i1 = cs[(k + 1) % cs.length];
    if (i1 <= i0) i1 += n;
    let comp = 0, naRua = 0;
    for (let i = i0; i < i1; i++) { const l = dist(anel[i % n], anel[(i + 1) % n]); comp += l; if (rua[i % n]) naRua += l; }
    out.push({ i0, i1, rua: naRua > comp / 2, comp });
  }
  return out;
}

export function montarFileira(anelR: Pt[], rua: boolean[]): Fileira | null {
  const n = anelR.length;
  const cs = cadeias(anelR, rua);
  const frentes = cs.filter((c) => c.rua);
  if (!frentes.length) return null;
  const fr = frentes.reduce((m, c) => (c.comp > m.comp ? c : m), frentes[0]);
  if (fr.comp < 2) return null;
  const k = cs.indexOf(fr);
  const antes = cs[(k - 1 + cs.length) % cs.length], depois = cs[(k + 1) % cs.length];
  // gira o anel para começar na frente
  const anel: Pt[] = [];
  for (let i = 0; i < n; i++) anel.push(anelR[(fr.i0 + i) % n]);
  const m = fr.i1 - fr.i0;
  const S: number[] = [0];
  for (let i = 1; i < n; i++) S.push(S[i - 1] + dist(anel[i - 1], anel[i]));
  const per = S[n - 1] + dist(anel[n - 1], anel[0]);
  const P0 = anel[0], PL = anel[m];
  const dA = cs.length > 1 && !antes.rua ? unit(sub(anelR[antes.i0 % n], P0)) : null;
  const dB = cs.length > 1 && !depois.rua ? unit(sub(anelR[depois.i1 % n], PL)) : null;
  return { anel, S, per, L: S[m], m, dA, dB };
}

/** Fileira pela rua mais longa (F1) e a posição da rua oposta (F2) no anel girado — para as faixas de rua a rua. */
export function montarDuas(anelR: Pt[], rua: boolean[]): { F: Fileira; sigA: number; sigB: number } | null {
  const F = montarFileira(anelR, rua);
  if (!F) return null;
  const n = anelR.length;
  // rua de cada aresta do anel girado
  const i0 = anelR.indexOf(F.anel[0]);
  const ruaG = F.anel.map((_, i) => rua[(i0 + i) % n]);
  const cs = cadeias(F.anel, ruaG).filter((c) => c.rua && c.i0 > F.m && c.i1 <= n);
  if (!cs.length) return null;
  const f1d = unit(sub(F.anel[F.m], F.anel[0]));
  const op = cs.filter((c) => dot(unit(sub(F.anel[c.i1 % n], F.anel[c.i0])), f1d) < -0.35);
  if (!op.length) return null;
  const f2 = op.reduce((m, c) => (c.comp > m.comp ? c : m), op[0]);
  const sigB = F.S[f2.i0], sigA = f2.i1 >= n ? F.per : F.S[f2.i1];
  const pA = pontoEm(F, sigA), pB = pontoEm(F, sigB);
  return { F: { ...F, dA: F.dA ? unit(sub(pA, F.anel[0])) : null, dB: F.dB ? unit(sub(pB, F.anel[F.m])) : null }, sigA, sigB };
}

// ---------------------------------------------------------------------------
// Quadra de três frentes (triângulo entre três ruas, como a quadra E do IRAN): duas
// ruas compridas que se encontram numa ponta e uma terceira rua na outra cabeceira.
// A linha central não fecha (a rua da cabeceira tem lotes de frente para ela e a
// ponta fica estreita demais para duas fileiras), então a terra vai em blocos, cada
// um com n × T de área exata:
//   A — fileira de frente para a rua da cabeceira, fundo numa reta paralela a ela;
//   B — o miolo, duas fileiras fundo com fundo numa linha de fundo reta, cada uma
//       dividida pela própria rua (no esquadro, paralelas ou em leque);
//   C — a ponta estreita, lotes de rua a rua.
// As quantidades de cada bloco são escolhidas pela forma dos lotes (mesma régua).
// ---------------------------------------------------------------------------
type Rotulo = "f1" | "f2" | "cab" | "outro" | "corte";
interface Peca { anel: Pt[]; rot: Rotulo[]; rua: boolean[] }

/** parte a peça pela reta dot(p − o, nv) = s; [lado ≤ s, lado > s], ou null se a reta não corta em exatamente dois pontos */
function partirPorReta(pc: Peca, o: Pt, nv: Pt, s: number): [Peca, Peca] | null {
  const { anel } = pc;
  const n = anel.length;
  const f = (p: Pt) => dot(sub(p, o), nv) - s;
  const cr: { i: number; t: number }[] = [];
  for (let i = 0; i < n; i++) {
    const fa = f(anel[i]), fb = f(anel[(i + 1) % n]);
    if ((fa <= 0) !== (fb <= 0)) cr.push({ i, t: fa / (fa - fb) });
  }
  if (cr.length !== 2) return null;
  const P = (c: { i: number; t: number }) => lerp(anel[c.i], anel[(c.i + 1) % n], c.t);
  const lado = (c0: { i: number; t: number }, c1: { i: number; t: number }): Peca => {
    const a: Pt[] = [P(c0)], r: Rotulo[] = [pc.rot[c0.i]], u: boolean[] = [pc.rua[c0.i]];
    for (let k = (c0.i + 1) % n; ; k = (k + 1) % n) {
      a.push(anel[k]); r.push(pc.rot[k]); u.push(pc.rua[k]);
      if (k === c1.i) break;
    }
    a.push(P(c1)); r.push("corte"); u.push(false);
    return limparPeca({ anel: a, rot: r, rua: u });
  };
  const A = lado(cr[0], cr[1]), B = lado(cr[1], cr[0]);
  if (A.anel.length < 3 || B.anel.length < 3) return null;
  return f(centroide(A.anel)) <= 0 ? [A, B] : [B, A];
}

/** tira pontos repetidos (a aresta que sobra fica com o rótulo da seguinte) */
function limparPeca(pc: Peca): Peca {
  const a: Pt[] = [], r: Rotulo[] = [], u: boolean[] = [];
  const n = pc.anel.length;
  for (let k = 0; k < n; k++) {
    const p = pc.anel[k];
    if (a.length && dist(a[a.length - 1], p) < 1e-6) { r[r.length - 1] = pc.rot[k]; u[u.length - 1] = pc.rua[k]; continue; }
    a.push(p); r.push(pc.rot[k]); u.push(pc.rua[k]);
  }
  while (a.length > 2 && dist(a[0], a[a.length - 1]) < 1e-6) { a.pop(); r.pop(); u.pop(); }
  return { anel: a, rot: r, rua: u };
}

/** parte a peça pela corda P0–P1 (os dois na borda); [lado que sai de P0 pelo anel, o outro] */
function partirPorCorda(pc: Peca, P0: Pt, P1: Pt, meio: Pt[] = []): [Peca, Peca] | null {
  // insere P0 e P1 como vértices
  const inserir = (x: Peca, P: Pt): { pc: Peca; i: number } | null => {
    const n = x.anel.length;
    for (let i = 0; i < n; i++) if (dist(x.anel[i], P) < 1e-6) return { pc: x, i };
    for (let i = 0; i < n; i++) {
      const a = x.anel[i], b = x.anel[(i + 1) % n];
      if (distSegmento(P, a, b).d < 1e-6) {
        return { pc: { anel: [...x.anel.slice(0, i + 1), P, ...x.anel.slice(i + 1)], rot: [...x.rot.slice(0, i + 1), x.rot[i], ...x.rot.slice(i + 1)], rua: [...x.rua.slice(0, i + 1), x.rua[i], ...x.rua.slice(i + 1)] }, i: i + 1 };
      }
    }
    return null;
  };
  const a = inserir(pc, P0);
  if (!a) return null;
  const b = inserir(a.pc, P1);
  if (!b) return null;
  const x = b.pc;
  const n = x.anel.length;
  const i0 = x.anel.findIndex((p) => dist(p, P0) < 1e-6), i1 = b.i;
  if (i0 < 0 || i0 === i1) return null;
  // o caminho (P0 → meio → P1) não pode cruzar o contorno; os pontos do meio ficam dentro
  const cam = [P0, ...meio, P1];
  if (meio.some((m) => !dentroAnelR(m, x.anel) || x.anel.some((q, k) => distSegmento(m, q, x.anel[(k + 1) % n]).d < 1e-6))) return null;
  for (let j = 0; j + 1 < cam.length; j++) {
    const A0 = cam[j], A1 = cam[j + 1];
    for (let k = 0; k < n; k++) {
      const p = x.anel[k], q = x.anel[(k + 1) % n];
      const r = sub(A1, A0), s2 = sub(q, p), den = cross(r, s2);
      if (Math.abs(den) < 1e-12) continue;
      const t = cross(sub(p, A0), s2) / den, u = cross(sub(p, A0), r) / den;
      // nas pontas do caminho o toque na borda é o próprio ponto
      const t0 = j === 0 ? 1e-6 : -1e-9, t1 = j + 2 === cam.length ? 1 - 1e-6 : 1 + 1e-9;
      if (t > t0 && t < t1 && u > 1e-9 && u < 1 - 1e-9) return null;
    }
  }
  const lado = (ia: number, ib: number, volta: Pt[]): Peca => {
    const an: Pt[] = [], r: Rotulo[] = [], u: boolean[] = [];
    for (let k = ia; ; k = (k + 1) % n) {
      an.push(x.anel[k]);
      if (k === ib) { r.push("corte"); u.push(false); break; }
      r.push(x.rot[k]); u.push(x.rua[k]);
    }
    for (const m of volta) { an.push(m); r.push("corte"); u.push(false); }
    return limparPeca({ anel: an, rot: r, rua: u });
  };
  const A = lado(i0, i1, [...meio].reverse()), B = lado(i1, i0, meio);
  if (A.anel.length < 3 || B.anel.length < 3 || seCruza(A.anel) || seCruza(B.anel)) return null;
  if (Math.abs(areaDe(A.anel) + areaDe(B.anel) - areaDe(pc.anel)) > 1e-4 * Math.max(1, areaDe(pc.anel))) return null;
  return [A, B];
}

function dentroAnelR(p: Pt, anel: Pt[]): boolean {
  let c = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const a = anel[i], b = anel[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** do ponto V na direção d até a borda (só as arestas aceitas): o ponto mais perto */
function raioAteBorda(pc: Peca, V: Pt, d: Pt, aceita: (i: number) => boolean = () => true): Pt | null {
  const n = pc.anel.length;
  let melhor: { t: number; Q: Pt } | null = null;
  for (let i = 0; i < n; i++) {
    if (!aceita(i)) continue;
    const a = pc.anel[i], e = sub(pc.anel[(i + 1) % n], a), den = cross(d, e);
    if (Math.abs(den) < 1e-12) continue;
    const w = sub(a, V), t = cross(w, e) / den, u = cross(w, d) / den;
    if (t <= 1e-6 || u < -1e-9 || u > 1 + 1e-9) continue;
    if (!melhor || t < melhor.t) melhor = { t, Q: [V[0] + d[0] * t, V[1] + d[1] * t] };
  }
  return melhor ? melhor.Q : null;
}

/** posição (comprimento pelo anel) do ponto P na borda da fileira */
function sigDe(F: Fileira, P: Pt): number | null {
  const n = F.anel.length;
  for (let j = 0; j < n; j++) {
    const a = F.anel[j], b = F.anel[(j + 1) % n];
    const d = distSegmento(P, a, b);
    if (d.d < 1e-5) return F.S[j] + d.t * dist(a, b);
  }
  return null;
}

/**
 * Raiz de f (crescente) em [lo, hi] por varredura + bisseção: onde f não existe (a reta
 * não corta a peça em dois, a corda cruza o contorno) a varredura pula; a bisseção
 * corre no primeiro par de amostras com troca de sinal.
 */
function raiz(f: (x: number) => number, lo: number, hi: number, passos = 48): number | null {
  let xa = NaN, fa = NaN;
  for (let k = 0; k <= passos; k++) {
    const x = lo + ((hi - lo) * k) / passos, fx = f(x);
    if (!Number.isFinite(fx)) continue;
    if (Number.isFinite(fa) && fa < 0 && fx >= 0) {
      let a = xa, b = x;
      for (let it = 0; it < 70 && b - a > 1e-9; it++) {
        const m = (a + b) / 2, fm = f(m);
        if (!Number.isFinite(fm)) return null;
        if (fm < 0) a = m; else b = m;
      }
      return (a + b) / 2;
    }
    xa = x; fa = fx;
  }
  return null;
}

/** a reta dot(p − o, nv) = s que deixa n × T do lado de o (≤ s); null se não cabe */
function profundidadePara(pc: Peca, o: Pt, nv: Pt, alvo: number, sMax: number): number | null {
  return raiz((s) => { const x = partirPorReta(pc, o, nv, s); return x ? areaDe(x[0].anel) - alvo : NaN; }, 0.05, sMax);
}

/** melhor divisão de uma peça de uma fileira (frente = arestas marcadas como rua) */
/** régua para escolher entre divisões (a forma; nos blocos, também as medidas da planta) */
type Regua = (d: Divisao) => number;
const pelaForma: Regua = (d) => d.custo;

/**
 * Melhor divisão de uma peça de uma fileira (frente = arestas marcadas como rua). Com
 * frente em mais de uma rua (a peça que dobra a esquina), testa também a frente por cada
 * rua sozinha — entre duas ruas que se encontram em ângulo fechado os lotes correm de
 * rua a rua em vez de dar a volta na esquina.
 */
function melhorFileira(pc: Peca, n: number, juncoesDe?: Pt[], regua: Regua = pelaForma): Divisao | null {
  if (n < 1) return null;
  const mascaras: boolean[][] = [pc.rua];
  const rotulos = [...new Set(pc.rot.filter((r, i) => pc.rua[i] && r !== "outro" && r !== "corte"))];
  if (rotulos.length > 1) for (const r of rotulos) mascaras.push(pc.rua.map((u, i) => u && pc.rot[i] === r));
  let melhor: { d: Divisao; v: number } | null = null;
  for (const rua of mascaras) {
    const F = montarFileira(pc.anel, rua);
    if (!F) continue;
    const opcoes: Divisao[] = [];
    if (n === 1) {
      const r = pc.anel.slice();
      opcoes.push({ modo: "esquadro", aneis: [r], custo: 0, formas: [{ quinas: quinasAviso(r), dev: [], paralelo: 0, testada: F.L, prof: areaDe(r) / Math.max(0.1, F.L), ponta: true }], cortes: [] });
    } else {
      for (const m of ["esquadro", "paralelas", "leque"] as ModoCorte[]) { const d = dividirFileira(F, n, m); if (d) opcoes.push(d); }
      if (juncoesDe && juncoesDe.length === n - 1) {
        const jun = juncoesDe.map((Q) => ({ Q, sig: sigDe(F, Q) ?? NaN })).filter((j) => Number.isFinite(j.sig)).sort((a, b) => b.sig - a.sig);
        if (jun.length === n - 1) { const d = dividirFileira(F, n, "juncoes", jun); if (d && d.formas.every((f) => f.dev.every((x) => x <= 25))) opcoes.push({ ...d, custo: d.custo * 0.8 }); }
      }
    }
    for (const d of opcoes) { const v = regua(d); if (!melhor || v < melhor.v) melhor = { d, v }; }
    if (n === 1) break;
  }
  return melhor?.d ?? null;
}

/**
 * Fileira cujo fundo dobra (o corte do bloco vizinho encontra a linha de fundo): a dobra
 * vira divisa — uma lateral vai da frente até ela, com a área acumulada de k lotes — e
 * cada lado se divide por si (o trecho torto em leque, o reto no esquadro). Sem isso a
 * fileira inteira acompanha a inclinação do corte, ou a dobra cai no meio de um lote.
 */
function melhorComDobra(pc: Peca, n: number, juncoesDe?: Pt[], regua: Regua = pelaForma): Divisao | null {
  let melhor = melhorFileira(pc, n, juncoesDe, regua);
  let vMelhor = melhor ? regua(melhor) : Infinity;
  if (n < 2) return melhor;
  const F = montarFileira(pc.anel, pc.rua);
  if (!F) return melhor;
  const T = areaDe(pc.anel) / n;
  // dobras do fundo: vértice entre dois cortes (ou corte e outro) com giro ≥ 12°, fora da frente
  const m = pc.anel.length;
  const dobras: Pt[] = [];
  for (let i = 0; i < m; i++) {
    const a = (i - 1 + m) % m;
    if (pc.rua[a] || pc.rua[i]) continue;
    const g = Math.abs(ang(sub(pc.anel[i], pc.anel[a]), sub(pc.anel[(i + 1) % m], pc.anel[i])));
    if (g >= 12 * GRAU) dobras.push(pc.anel[i]);
  }
  const ini = F.anel[0];
  for (const V of dobras) for (let k = 1; k < n; k++) {
    // lateral da frente (ponto s) até a dobra: a parte do começo da frente fica com k × T
    const partes = (s: number): [Peca, Peca] | null => {
      const P0 = pontoEm(F, s);
      const x = partirPorCorda(pc, P0, V);
      if (!x) return null;
      const temIni = (y: Peca) => y.anel.some((q) => dist(q, ini) < 1e-6);
      return temIni(x[0]) && !temIni(x[1]) ? x : temIni(x[1]) && !temIni(x[0]) ? [x[1], x[0]] : null;
    };
    const sk = raiz((s) => { const x = partes(s); return x ? areaDe(x[0].anel) - k * T : NaN; }, 0.3, F.L - 0.3, 64);
    if (sk === null) continue;
    const x = partes(sk);
    if (!x) continue;
    const d1 = melhorFileira(x[0], k, undefined, regua), d2 = melhorFileira(x[1], n - k, undefined, regua);
    if (!d1 || !d2 || d1.aneis.length !== k || d2.aneis.length !== n - k) continue;
    const junto: Divisao = { modo: d2.modo, aneis: [...d1.aneis, ...d2.aneis], formas: [...d1.formas, ...d2.formas], custo: d1.custo + d2.custo, cortes: [...d1.cortes, ...d2.cortes] };
    const v = regua(junto);
    if (v < vMelhor) { melhor = junto; vMelhor = v; }
  }
  return melhor;
}

export interface Blocos { aneis: Pt[][]; formas: Forma[]; custo: number; resumo: string }

/**
 * Divisão em blocos de uma quadra de três frentes (ver acima). R é o contorno da
 * seleção; tipos/refs de cada aresta (rua, via ou divisa). Devolve N lotes de área
 * T exata, ou null quando a quadra não é desse tipo ou nenhum arranjo fecha.
 *
 * As retas que separam os blocos podem girar: a da testa (até 20° da paralela à rua
 * da cabeceira — encontrar a outra frente num ângulo agudo deixaria um triângulo na
 * fileira dela) e a da ponta (até 30° da perpendicular à bissetriz — a transição em
 * diagonal dá fundo aos últimos lotes das duas fileiras sem o primeiro lote de rua a
 * rua passar da profundidade máxima). Cada bloco é avaliado sozinho e só os melhores
 * seguem para o miolo.
 */
export function blocosTresFrentes(R: Pt[], tipos: TipoAresta[], refs: string[], N: number, p: Parametros): Blocos | null {
  let E;
  try { E = estruturar(R, tipos, refs); } catch { return null; }
  const total = areaDe(E.anel);
  const T = total / N;
  const n = E.anel.length;
  const P = E.P;
  const dentro = (sx: number, a: number, b: number) => { let x = sx; while (x < a - 1e-6) x += P; while (x > a + P) x -= P; return x <= b + 1e-6; };
  // rótulo de cada aresta: F1, F2, a rua da cabeceira ou outro (arcos das esquinas, ponta)
  const rot: Rotulo[] = [], rua: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const sm = (E.Q.s[i] + E.Q.s[i + 1]) / 2;
    rua.push(E.tipos[i] === "rua" || E.tipos[i] === "via");
    rot.push(dentro(sm, E.f1.s0, E.f1.s1) ? "f1" : dentro(sm, E.f2.s0, E.f2.s1) ? "f2" : "outro");
  }
  // cabeceiras: e1 (fim de F2 → início de F1) e e2 (fim de F1 → início de F2)
  const ruaNaCab = (e: [number, number]) => E.cadeias.filter((c) => (c.tipo === "rua" || c.tipo === "via") && c !== E.f1 && c !== E.f2 && dentro((c.s0 + c.s1) / 2, e[0], e[1]) && c.comp >= 2 * p.frenteMin);
  const cabs = [ruaNaCab(E.e1), ruaNaCab(E.e2)];
  const larg = (e: [number, number]) => dist(E.Q.em(e[0]), E.Q.em(e[1]));
  // uma cabeceira com rua (a testa) e a outra estreita (a ponta onde as duas frentes se encontram)
  const kT = cabs[0].length ? 0 : cabs[1].length ? 1 : -1;
  if (kT < 0 || cabs[1 - kT].length) return null;
  const eP = kT === 0 ? E.e2 : E.e1;
  if (larg(eP) > 2 * p.profundidadeMin) return null;
  const cT = cabs[kT].reduce((m, c) => (c.comp > m.comp ? c : m));
  for (let i = 0; i < n; i++) if (rua[i] && rot[i] === "outro" && dentro((E.Q.s[i] + E.Q.s[i + 1]) / 2, cT.s0, cT.s1)) rot[i] = "cab";
  const base: Peca = { anel: E.anel, rot, rua };
  const girar = (v: Pt, g: number): Pt => [v[0] * Math.cos(g) - v[1] * Math.sin(g), v[0] * Math.sin(g) + v[1] * Math.cos(g)];
  // reta da testa: paralela à corda da rua da cabeceira (girada até ±20°); dentro = esquerda
  const oT = E.Q.em(cT.s0), nT0 = esquerda(cT.dir);
  // eixo da ponta: da ponta para dentro, na bissetriz das duas frentes
  const ponta = E.Q.em((eP[0] + (eP[1] >= eP[0] ? eP[1] : eP[1] + P)) / 2);
  const dIn = unit(sub(E.f2.dir, E.f1.dir));
  const eixo: Pt = dot(sub(centroide(E.anel), ponta), dIn) >= 0 ? dIn : [-dIn[0], -dIn[1]];
  const perp = esquerda(eixo);
  const alcance = (o: Pt, v: Pt) => Math.max(...E.anel.map((q) => dot(sub(q, o), v)));
  const largPerp = Math.max(...E.anel.map((q) => Math.abs(dot(sub(q, ponta), perp))));
  // de que lado da bissetriz fica F1
  const ladoF1 = (() => { const i = rot.indexOf("f1"); return i >= 0 ? Math.sign(dot(sub(lerp(E.anel[i], E.anel[(i + 1) % n], 0.5), ponta), perp)) || 1 : 1; })();

  // ---- medida de cada lote como a planta mede: frente = lados na rua; fundo = maior distância
  //      até a reta do lado mais comprido na rua. Fora das medidas pesa (mais quanto mais longe).
  // ---- cada lote medido pela regra da planta (foraDasFaixas, como o aviso): frente = lados na
  //      rua; esquina = ruas distintas ou a quina entre frentes; fundo máximo pela reta da
  //      frente e mínimo no segmento. Lote com aviso pesa; perto da profundidade padrão é melhor
  const refDe = (a: Pt, b: Pt): string | null => {
    for (let i = 0; i < n; i++) if (rua[i] && distSegmento(a, E.anel[i], E.anel[(i + 1) % n]).d < 0.05 && distSegmento(b, E.anel[i], E.anel[(i + 1) % n]).d < 0.05) return E.refs[i] || E.tipos[i];
    return null;
  };
  const medida = (an: Pt[]) => {
    const segs: [Pt, Pt][] = [], refsL = new Set<string>();
    let frente = 0;
    an.forEach((a, i) => {
      const b = an[(i + 1) % an.length], r = refDe(a, b);
      if (r === null || dist(a, b) < 1e-6) return;
      segs.push([a, b]); refsL.add(r); frente += dist(a, b);
    });
    if (!segs.length) return { fora: 1, custo: 1e6 };
    const pol = { ext: an, furos: [] as Pt[][] };
    const esq = refsL.size >= 2 || esquinaDe(segs);
    const prof = profundidadeDe(pol, segs, true);
    const avisos = foraDasFaixas({ area: areaDe(an), frente, profundidade: prof, rasa: profundidadeDe(pol, segs) }, p, false, esq, frentePrincipal(segs));
    let fora = avisos.length, c = 6000 * avisos.length;
    if (quinasAviso(an) > 4) { fora++; c += 3000 * (quinasAviso(an) - 4); }
    c += 300 * ((prof - p.profundidade) / p.profundidade) ** 2;
    return { fora, custo: c };
  };
  const nota = (d: Divisao) => { const ms = d.aneis.map(medida); return { fora: ms.reduce((s2, m) => s2 + m.fora, 0), custo: d.custo + ms.reduce((s2, m) => s2 + m.custo, 0) }; };
  const melhorQue = (a: { fora: number; custo: number }, b: { fora: number; custo: number }) => a.fora < b.fora || (a.fora === b.fora && a.custo < b.custo);
  const regua: Regua = (d) => { const k = nota(d); return k.fora * 1e6 + k.custo; };

  // ---- testas candidatas: (nA, giro) → bloco A dividido e o resto
  interface OpT { nA: number; nT: Pt; A: Peca; resto: Peca; d: Divisao; fora: number; custo: number }
  const testas: OpT[] = [];
  const nA0 = Math.max(2, Math.round(cT.comp / Math.max(1, p.frente)));
  for (let nA = Math.max(2, nA0 - 3); nA <= nA0 + 3 && nA < N - 2; nA++) {
    for (const gr of [0, -10, 10, -20, 20, -30, 30, -40, 40]) {
      const nT = girar(nT0, gr * GRAU);
      const sA = raiz((x) => { const y = partirPorReta(base, oT, nT, x); return y ? areaDe(y[0].anel) - nA * T : NaN; }, 0.05, alcance(oT, nT) - 0.01);
      if (sA === null) continue;
      const y = partirPorReta(base, oT, nT, sA);
      if (!y || !temRot(y[0], "cab") || temRot(y[1], "cab")) continue;
      const d = melhorComDobra({ ...y[0], rua: y[0].rua.map((u, i) => u && y[0].rot[i] !== "corte") }, nA, undefined, regua);
      if (!d || d.aneis.length !== nA) continue;
      testas.push({ nA, nT, A: y[0], resto: y[1], d, ...nota(d) });
    }
  }
  // ---- pontas candidatas: (nC, giro) → reta da ponta (sobre a quadra inteira) e o bloco C dividido
  interface OpP { nC: number; e: Pt; s: number; d: Divisao | null; fora: number; custo: number }
  const pontas: OpP[] = [{ nC: 0, e: eixo, s: 0, d: null, fora: 0, custo: 0 }];
  for (let nC = 1; nC <= Math.min(10, N - 6); nC++) {
    for (const gr of [0, -15, 15, -30, 30]) {
      const e = girar(eixo, gr * GRAU);
      const sC = raiz((x) => { const y = partirPorReta(base, ponta, e, x); return y ? areaDe(y[0].anel) - nC * T : NaN; }, 0.05, alcance(ponta, e) - 0.01);
      if (sC === null) continue;
      const y = partirPorReta(base, ponta, e, sC);
      if (!y || temRot(y[0], "cab") || !temRot(y[0], "f1") || !temRot(y[0], "f2")) continue;
      // a reta corta as duas frentes (não passa da largura máxima de um lote de rua a rua com folga)
      const m = y[0].anel.length;
      const pts = y[0].anel.filter((_, i) => y[0].rot[i] === "corte" || y[0].rot[(i - 1 + m) % m] === "corte");
      const w = pts.length >= 2 ? dist(pts[0], pts[pts.length - 1]) : 0;
      if (w > p.profundidadeMax * 1.6) continue;
      let d: Divisao | null = null, nt: { fora: number; custo: number } | null = null;
      for (const fx of ["f1", "f2"] as const) {
        const x = melhorFileira({ ...y[0], rua: y[0].rot.map((r) => r === fx) }, nC, undefined, regua);
        if (!x || x.aneis.length !== nC) continue;
        const k = nota(x);
        if (!nt || melhorQue(k, nt)) { d = x; nt = k; }
      }
      if (d && nt) pontas.push({ nC, e, s: sC, d, ...nt });
    }
  }
  if (!testas.length) return null;
  const top = <X extends { fora: number; custo: number }>(xs: X[], k: number) => xs.slice().sort((a, b) => (melhorQue(a, b) ? -1 : melhorQue(b, a) ? 1 : 0)).slice(0, k);
  const testasTop = top(testas, 6);
  // as pontas: as melhores de cada quantidade (a quantidade mexe no miolo)
  const pontasTop: OpP[] = [];
  for (let nC = 0; nC <= 10; nC++) pontasTop.push(...top(pontas.filter((x) => x.nC === nC), 2));

  // ---- o miolo: linha de fundo reta na bissetriz, deslocada d (d > 0 = para o lado de F2)
  const metades = (M: Peca, d: number): [Peca, Peca] | null => {
    const x = partirPorReta(M, ponta, perp, ladoF1 * -d);
    if (!x) return null;
    if (temRot(x[0], "f1") && !temRot(x[0], "f2") && temRot(x[1], "f2") && !temRot(x[1], "f1")) return x;
    if (temRot(x[1], "f1") && !temRot(x[1], "f2") && temRot(x[0], "f2") && !temRot(x[0], "f1")) return [x[1], x[0]];
    return null;
  };
  const dPara = (M: Peca, n1: number) => raiz((d) => { const h = metades(M, d); return h ? areaDe(h[0].anel) - n1 * T : NaN; }, -largPerp, largPerp, 96);

  // ---- cunha: onde a reta da testa encontra uma frente num ângulo fechado, o primeiro lote
  //      da fileira dela seria um triângulo. A ponta aguda vem para a testa: o fundo da testa
  //      dobra em V (a reta da testa × a linha de fundo do miolo) e desce no esquadro da frente
  const testaComCunha = (nT: Pt, sx: number, d: number, cunha: "f1" | "f2", fi: number): [Peca, Peca] | null => {
    const den = cross(nT, perp);
    if (Math.abs(den) < 1e-9) return null;
    const c1 = sx + dot(oT, nT), c2 = ladoF1 * -d + dot(ponta, perp);
    const V: Pt = [(c1 * perp[1] - c2 * nT[1]) / den, (nT[0] * c2 - perp[0] * c1) / den];
    const pi = rot.indexOf(cunha);
    if (pi < 0) return null;
    // normal da frente para dentro da quadra
    let nf = esquerda(cunha === "f1" ? E.f1.dir : E.f2.dir);
    if (dot(sub(centroide(E.anel), E.anel[pi]), nf) < 0) nf = [-nf[0], -nf[1]];
    const t0 = esquerda(nT);
    const t: Pt = dot(t0, nf) > 0 ? t0 : [-t0[0], -t0[1]];
    // a descida: no esquadro da frente (fi = 0) ou inclinada fi para o lado da reta da testa
    // (a ponta que passa para a testa fica menor e o primeiro lote da frente, um trapézio)
    const lado: Pt = [-t[0], -t[1]];
    const tf = unit(sub(lado, mult2(nf, dot(lado, nf))));
    const desce = unit([-nf[0] * Math.cos(fi) + tf[0] * Math.sin(fi), -nf[1] * Math.cos(fi) + tf[1] * Math.sin(fi)]);
    const X = raioAteBorda(base, V, desce, (i) => rot[i] === cunha);
    const Y = raioAteBorda(base, V, t);
    if (!X || !Y) return null;
    const x = partirPorCorda(base, X, Y, [V]);
    if (!x) return null;
    return temRot(x[0], "cab") && !temRot(x[1], "cab") ? x : temRot(x[1], "cab") && !temRot(x[0], "cab") ? [x[1], x[0]] : null;
  };

  let melhor: (Blocos & { fora: number }) | null = null;
  interface Tentativa { ta: OpT; pc: OpP; n1: number; d: number; fora: number; custo: number }
  const feitas: Tentativa[] = [];
  /** o miolo de uma testa + ponta com n1 lotes na fileira de F1; atualiza o melhor */
  const miolo = (ta: OpT, pc: OpP, n1: number, dFixo?: number, rapido = false): Tentativa | null => {
    const nM = N - ta.nA - pc.nC, n2 = nM - n1;
    if (n1 < 1 || n2 < 1) return null;
    // a ponta sai do resto pela mesma reta; se ela entra na testa, a área não fecha
    let M: Peca = ta.resto;
    if (pc.nC > 0) {
      const y = partirPorReta(ta.resto, ponta, pc.e, pc.s);
      if (!y || Math.abs(areaDe(y[0].anel) - pc.nC * T) > 0.02) return null;
      M = y[1];
    }
    const dd = dFixo ?? dPara(M, n1);
    if (dd === null) return null;
    const h = metades(M, dd);
    if (!h) return null;
    const [M1, M2] = h;
    if (Math.abs(areaDe(M1.anel) - n1 * T) > 0.02 || Math.abs(areaDe(M2.anel) - n2 * T) > 0.02) return null;
    const dividir = (pc2: Peca, k: number, j?: Pt[]) => (rapido ? melhorFileira(pc2, k, j, regua) : melhorComDobra(pc2, k, j, regua));
    const d1 = dividir({ ...M1, rua: M1.rot.map((r) => r === "f1") }, n1);
    if (!d1 || d1.aneis.length !== n1) return null;
    // fundo com fundo: com a mesma quantidade, a fileira de F2 termina nas junções da de F1
    const junc = n1 === n2 ? d1.cortes.slice(1, -1).map((c) => c.Q) : undefined;
    const d2 = dividir({ ...M2, rua: M2.rot.map((r) => r === "f2") }, n2, junc);
    if (!d2 || d2.aneis.length !== n2) return null;
    const partes = [ta.d, d1, d2, ...(pc.d ? [pc.d] : [])];
    const aneis = partes.flatMap((x) => x.aneis);
    if (aneis.length !== N) return null;
    if (aneis.some((a) => a.length < 3 || seCruza(a) || Math.abs(areaDe(a) - T) > Math.max(0.05, 0.002 * T))) return null;
    if (Math.abs(aneis.reduce((s2, a) => s2 + areaDe(a), 0) - total) > Math.max(1, 0.002 * total)) return null;
    const k1 = nota(d1), k2 = nota(d2);
    const fora = ta.fora + pc.fora + k1.fora + k2.fora;
    const custo = ta.custo + pc.custo + k1.custo + k2.custo;
    if (!rapido && (!melhor || melhorQue({ fora, custo }, melhor))) {
      const frase = `${ta.nA} de frente para a rua da cabeceira, ${n1} + ${n2} fundo com fundo no miolo${pc.nC ? `, ${pc.nC} de rua a rua na ponta` : ""}`;
      melhor = { aneis, formas: partes.flatMap((x) => x.formas), custo, fora, resumo: `${N} lotes com ${fmt(T)} m² cada — quadra de três frentes: ${frase}` };
    }
    return { ta, pc, n1, d: dd, fora, custo };
  };
  const foraAtual = () => (melhor as (Blocos & { fora: number }) | null)?.fora ?? Infinity;
  for (const ta of testasTop) for (const pc of pontasTop) {
    const nM = N - ta.nA - pc.nC;
    if (nM < 2 || ta.fora + pc.fora > foraAtual()) continue;
    let M: Peca = ta.resto;
    if (pc.nC > 0) {
      const y = partirPorReta(ta.resto, ponta, pc.e, pc.s);
      if (!y) continue;
      M = y[1];
    }
    const h0 = metades(M, 0);
    if (!h0) continue;
    const n1b = Math.round(areaDe(h0[0].anel) / T);
    for (const n1 of [n1b, n1b - 1, n1b + 1]) { const r = miolo(ta, pc, n1, undefined, true); if (r) feitas.push(r); }
  }
  // a divisão completa (com as dobras do fundo) só nas melhores da passada rápida
  {
    const rapidas = top(feitas, 8);
    feitas.length = 0;
    for (const f of rapidas) { const r = miolo(f.ta, f.pc, f.n1, f.d); if (r) feitas.push(r); }
  }
  // ---- a cunha nas melhores que ainda têm lote fora das medidas: a testa e a linha de fundo
  //      se acertam juntas (a dobra V depende da linha de fundo, e a área da testa, de V)
  const comFora = top(feitas.filter((x) => x.fora > 0), 4);
  for (const f of comFora) for (const cunha of ["f1", "f2"] as const) for (const fiG of [0, 10, 15, 20]) {
    const fi = fiG * GRAU;
    if (foraAtual() === 0) break;
    let d = f.d, ta: OpT | null = null;
    for (let it = 0; it < 12; it++) {
      const sx = raiz((x) => { const y = testaComCunha(f.ta.nT, x, d, cunha, fi); return y ? areaDe(y[0].anel) - f.ta.nA * T : NaN; }, 0.05, alcance(oT, f.ta.nT) - 0.01, 64);
      if (sx === null) { ta = null; break; }
      const y = testaComCunha(f.ta.nT, sx, d, cunha, fi);
      if (!y) { ta = null; break; }
      let M: Peca = y[1];
      if (f.pc.nC > 0) { const z = partirPorReta(y[1], ponta, f.pc.e, f.pc.s); if (!z) { ta = null; break; } M = z[1]; }
      const d1 = dPara(M, f.n1);
      if (d1 === null) { ta = null; break; }
      const parado = Math.abs(d1 - d) < 1e-6;
      d = d1;
      ta = { ...f.ta, A: y[0], resto: y[1] };
      if (parado) break;
    }
    if (!ta || Math.abs(areaDe(ta.A.anel) - f.ta.nA * T) > 0.02) continue;
    const dA = melhorComDobra({ ...ta.A, rua: ta.A.rua.map((u, i) => u && ta!.A.rot[i] !== "corte") }, f.ta.nA, undefined, regua);
    if (!dA || dA.aneis.length !== f.ta.nA) continue;
    miolo({ ...ta, d: dA, ...nota(dA) }, f.pc, f.n1, d);
  }
  const fim = melhor as (Blocos & { fora: number }) | null;
  if (!fim) return null;
  return { aneis: fim.aneis, formas: fim.formas, custo: fim.custo, resumo: fim.resumo };
}
const temRot = (pc: Peca, r: Rotulo) => pc.rot.some((y) => y === r);
const mult2 = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];

// ---------------------------------------------------------------------------
// A operação
// ---------------------------------------------------------------------------
export type ModoRearranjo = "igualar" | "fundo";

export function rearranjarSelecao(pr0: Projeto, res: Resultado, q: Quadra, indices: number[], modo: ModoRearranjo): Edicao {
  const p: Parametros = pr0.params;
  LIM = { frenteMin: p.frenteMin, frenteMax: p.frenteMax };
  let formasFinal: Forma[] = [];
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const ks = [...new Set(indices)].filter((k) => k >= 0 && k < aneis.length && aneis[k].length >= 3);
  if (ks.length < 2) return { pr: pr0, erro: true, msg: "Selecione dois ou mais lotes vizinhos da mesma quadra." };
  const uni = contornoUniao(ks.map((k) => aneis[k]));
  if (uni.length !== 1) return { pr: pr0, erro: true, msg: "Os lotes selecionados não formam um bloco só (há lote solto ou um buraco no meio) — selecione lotes encostados uns nos outros." };
  const R = uni[0];
  const total = areaDe(R);
  const N = ks.length;
  const T = total / N;
  // lote de 5+ quinas que já havia na seleção (o arranjo novo não pode ter mais que isso:
  // o candidato que joga o degrau do contorno no meio de um lote sai da disputa)
  const q5antes = ks.filter((k) => quinasAviso(aneis[k]) > 4).length;
  const quebra = (an: Pt[][]) => an.filter((x) => quinasAviso(x) > 4).length > q5antes;
  // "fundo com fundo" em lotes que já estão fundo com fundo (cada um encosta o fundo num lote
  // só da seleção) e com a mesma área: nada a fazer — redesenhar só mexeria nas divisas
  if (modo === "fundo") {
    const areasSel = ks.map((k) => areaDe(aneis[k]));
    if (Math.max(...areasSel) - Math.min(...areasSel) < 0.05) {
      // fundo com fundo = nenhuma junção em "T" dentro da seleção (ponto de dentro da união
      // que é vértice de exatamente 3 lotes selecionados) e pelo menos um cruzamento de 4
      const chave = (p: Pt) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)}`;
      const conta = new Map<string, { p: Pt; n: number }>();
      for (const k of ks) {
        const doLote = new Map(aneis[k].map((p) => [chave(p), p] as const));
        for (const [c, p] of doLote) conta.set(c, { p, n: (conta.get(c)?.n ?? 0) + 1 });
      }
      const dentroR = (p: Pt) => !R.some((a, i) => distSegmento(p, a, R[(i + 1) % R.length]).d < 0.02);
      const juncoes = [...conta.values()].filter((v) => dentroR(v.p));
      if (juncoes.some((v) => v.n >= 4) && !juncoes.some((v) => v.n === 3)) return { pr: pr0, msg: `Os ${N} lotes já estão fundo com fundo e com a mesma área (${fmt(areasSel[0])} m²) — nada mudou.` };
    }
  }

  // lados de rua da quadra (dos lotes do resultado)
  const ladosRua = res.lotes.filter((l) => l.quadra === q.nome).flatMap((l) => l.lados.filter((x) => x.tipo === "rua" || x.tipo === "via"));
  const tipos: TipoAresta[] = [], refs: string[] = [], rua: boolean[] = [];
  for (let k = 0; k < R.length; k++) {
    const a = R[k], b = R[(k + 1) % R.length];
    const m = lerp(a, b, 0.5);
    let achou: (typeof ladosRua)[number] | null = null;
    for (const x of ladosRua) if (distSegmento(m, x.a, x.b).d < 0.05 && (dist(a, b) < 0.05 || distSegmento(a, x.a, x.b).d < 0.1)) { achou = x; break; }
    tipos.push(achou ? (achou.tipo === "via" ? "via" : "rua") : "divisa");
    refs.push(achou ? (achou.tipo === "via" ? "via" : String(achou.ref ?? "")) : "");
    rua.push(!!achou);
  }
  if (!rua.some(Boolean)) return { pr: pr0, erro: true, msg: "Os lotes selecionados não têm frente para rua." };

  // ---- duas fileiras (as ruas se olham): linha central dentro da seleção
  let novos: Pt[][] | null = null;
  let resumo = "";
  let duas = false;
  let soUmaFileira = true;
  let emOrdem = false;
  try {
    const E = estruturar(R, tipos, refs);
    soUmaFileira = false;
    const temRua = (e: [number, number]) => E.cadeias.some((c) => ehRua(c.tipo) && c !== E.f1 && c !== E.f2 && dentroDe(c.s0, c.s1, e, E.P));
    // "igualar" não muda a orientação dos lotes: a cabeceira em "testa" (lotes de frente
    // para a rua da ponta) redesenharia a ponta da seleção — 3 lotes verticais e uma cunha
    // onde havia lotes deitados. A testa fica para o "fundo com fundo".
    const cab1 = temRua(E.e1) && modo !== "igualar" ? "auto" as const : "direta" as const;
    const cab2 = temRua(E.e2) && modo !== "igualar" ? "auto" as const : "direta" as const;
    const tentativas: { L: Layout; custo: number; esq: string; formas: Forma[] }[] = [];
    const avaliar = (L: Layout, esq: string) => {
      if (L.lotes.length !== N || cruzamentosLC(L) > 0 || quebra(L.lotes.map((l) => l.anel))) return;
      const soma = L.lotes.reduce((s, l) => s + l.area, 0);
      if (Math.abs(soma - total) > Math.max(1, 0.002 * total) || L.lotes.some((l) => seCruza(l.anel))) return;
      const formas = L.lotes.map((l): Forma => {
        const dev = l.giroLat.filter(Number.isFinite);
        const fr = Number.isFinite(l.frente) ? l.frente : Math.sqrt(l.area);
        return { quinas: quinasAviso(l.anel), dev, paralelo: dev.length === 2 ? Math.abs(dev[0] - dev[1]) : 0, testada: fr, prof: l.area / Math.max(0.1, fr), ponta: dev.length < 2 };
      });
      const ar = L.lotes.map((l) => l.area);
      const espalho = (Math.max(...ar) - Math.min(...ar)) / T;
      // igualar = áreas iguais de verdade; a esquina que absorve só entra se for o único jeito
      // a linha central em zigue-zague pesa como nas faixas (giro em graus², o mesmo peso)
      let giroC = 0;
      for (let k = 1; k + 1 < L.C.length; k++) giroC += (ang(sub(L.C[k], L.C[k - 1]), sub(L.C[k + 1], L.C[k])) / GRAU) ** 2;
      const custo = formas.reduce((s, f) => s + custoForma(f, { testada: 0 }), 0) + (modo === "igualar" ? 20000 : 4000) * espalho + 5 * giroC;
      tentativas.push({ L, custo, esq, formas });
    };
    const base = { N, profMin: p.profundidadeMin, profPadrao: p.profundidade, cab1, cab2, lim: { areaMin: p.areaMin, areaMax: p.areaMax, frenteMin: p.frenteMin, profMin: p.profundidadeMin, profMax: p.profundidadeMax } };
    for (const esquinas of ["iguais", "absorver"] as const) {
      let L: Layout;
      try { L = montarMelhor(E, { ...base, esquinas }); } catch (e) { if (/estreita/.test((e as Error).message)) soUmaFileira = true; continue; }
      avaliar(L, esquinas);
      // ponta da linha central no degrau da cabeceira (o vizinho de fora não está
      // alinhado): a linha termina na quina do degrau — o degrau fica inteiro num
      // lote só, sem lasca; as fileiras se reequilibram deslocando o miolo da linha
      const Cs = linhaNoDegrau(L.C, R, rua);
      if (Cs) {
        const miolo = Cs.length > 2 ? Cs.slice(1, -1) : [lerp(Cs[0], Cs[1], 1 / 3), lerp(Cs[0], Cs[1], 2 / 3)];
        const comD = (d: number): Pt[] => {
          const nr = esquerda(unit(sub(Cs[Cs.length - 1], Cs[0])));
          return [Cs[0], ...miolo.map((q) => [q[0] + nr[0] * d, q[1] + nr[1] * d] as Pt), Cs[Cs.length - 1]];
        };
        const dif = (d: number) => { try { const x = montar(E, { ...base, esquinas, C: comD(d) }); return { x, f: x.T1 - x.T2 }; } catch { return null; } };
        let lo = -8, hi = 8, a = dif(lo), b = dif(hi);
        if (a && b && Math.sign(a.f) !== Math.sign(b.f)) {
          for (let it = 0; it < 40 && hi - lo > 1e-4; it++) {
            const m = (lo + hi) / 2, c = dif(m);
            if (!c) break;
            if (Math.sign(c.f) === Math.sign(a.f)) { lo = m; a = c; } else { hi = m; b = c; }
          }
          const fin = dif((lo + hi) / 2);
          if (fin) avaliar(fin.x, esquinas + "+degrau");
        }
      }
    }
    // a linha de fundo que já existe entre os selecionados, travada: nas fileiras
    // desencontradas (o lote da frente não fica bem atrás do de trás) os degraus das
    // pontas ficam SOBRE ela, e os lotes da ponta seguem com 4 quinas. Cada fileira se
    // divide por igual e as divisas se encontram na linha (fundo com fundo).
    const atual = modo === "fundo" ? linhaDeFundoDaSelecao(aneis, ks, q, R) : null;
    if (atual) for (const esquinas of ["iguais", "absorver"] as const) {
      try { avaliar(montar(E, { ...base, esquinas, C: atual }), esquinas + "+linha atual"); } catch { /* não fecha */ }
    }
    // faixas de rua a rua (pontas muito inclinadas: as divisas acompanham as pontas)
    let faixa: Divisao | null = null;
    // de uma ponta e da outra (espelhada): a junção livre fica na ponta onde ajuda mais
    const nR = R.length;
    const espelho = (a: Pt[]): Pt[] => a.map((p) => [-p[0], p[1]] as Pt).reverse();
    for (const esp of [false, true]) {
      const Rx = esp ? espelho(R) : R;
      const ruaX = esp ? R.map((_, i) => rua[(2 * nR - 2 - i) % nR]) : rua;
      const D2 = montarDuas(Rx, ruaX);
      if (D2) for (const m of ["paralelas", "leque", "esquadro"] as ModoCorte[]) {
        const d = dividirDuas(D2.F, D2.sigA, D2.sigB, N, m);
        if (d && !quebra(d.aneis) && (!faixa || d.custo < faixa.custo)) faixa = esp ? { ...d, aneis: d.aneis.map(espelho) } : d;
      }
    }
    // igualar = todos iguais: havendo arranjo exato, o da esquina que absorve não concorre
    const iguais = (L: Layout) => { const ar = L.lotes.map((l) => l.area); return Math.max(...ar) - Math.min(...ar) < 0.05; };
    const exatos = tentativas.filter((t) => iguais(t.L));
    // "Igualar áreas" sem nenhum arranjo exato pela linha central nem pelas faixas: o da
    // esquina que absorve deixaria as áreas diferentes — quem chamou cai no igualar que
    // desliza as divisas (áreas exatas)
    if (modo === "igualar" && !exatos.length && !faixa) tentativas.length = 0;
    const lcMelhor = (modo === "igualar" && (exatos.length || faixa) ? exatos : tentativas).sort((a, b) => a.custo - b.custo)[0];
    if (faixa && (!lcMelhor || faixa.custo < lcMelhor.custo)) {
      novos = faixa.aneis;
      formasFinal = faixa.formas;
      duas = true;
      const devMax = Math.max(0, ...faixa.formas.flatMap((f) => f.dev));
      const nomeF: Record<string, string> = { paralelas: "paralelas às divisas das pontas", leque: "em leque, girando aos poucos de uma ponta à outra", esquadro: "no esquadro da rua" };
      resumo = `${N} lotes com ${fmt(T)} m² cada — fundo com fundo, divisas de rua a rua ${nomeF[faixa.modo] ?? ""} (até ${fmt(devMax, 1)}° do esquadro)`;
    } else if (tentativas.length) {
      const melhor = lcMelhor;
      novos = melhor.L.lotes.map((l) => l.anel);
      formasFinal = melhor.formas;
      duas = true;
      const ar = melhor.L.lotes.map((l) => l.area);
      const giros = melhor.L.lotes.flatMap((l) => l.giroLat.filter(Number.isFinite));
      const naLinhaAtual = melhor.esq.includes("linha atual");
      const porFila = (z: string[]) => melhor.L.lotes.filter((l) => z.includes(l.zona)).map((l) => l.area);
      const fr = porFila(["f1", "ponta1", "testa1"]), tr = porFila(["f2", "ponta2", "testa2"]);
      const fila = (v: number[]) => (Math.max(...v) - Math.min(...v) < 0.05 ? `${v.length} com ${fmt(v[0])} m²` : `${v.length} de ${fmt(Math.min(...v))} a ${fmt(Math.max(...v))} m²`);
      resumo = (Math.max(...ar) - Math.min(...ar) < 0.05 ? `${N} lotes com ${fmt(ar[0])} m² cada`
        : naLinhaAtual && fr.length && tr.length ? `${N} lotes — ${fila(fr)} de um lado e ${fila(tr)} do outro (a linha de fundo ficou onde estava, sobre os degraus das pontas)`
        : `${N} lotes de ${fmt(Math.min(...ar))} a ${fmt(Math.max(...ar))} m² (a ponta inclinada fica com a diferença)`)
        + ` — fundo com fundo pela linha central, laterais a até ${fmt(giros.length ? Math.max(...giros) : 0, 1)}° do esquadro da rua`;
    }
  } catch { /* não é de duas fileiras */ }

  // quadra de três frentes (triângulo entre três ruas): nem a linha central nem as faixas
  // fecham — a terra vai em blocos (testa, miolo fundo com fundo, ponta de rua a rua)
  if (!novos && !soUmaFileira) {
    const b = blocosTresFrentes(R, tipos, refs, N, p);
    if (b && !quebra(b.aneis)) { novos = b.aneis; formasFinal = b.formas; resumo = b.resumo; duas = true; emOrdem = true; }
  }

  // duas ruas que se olham e fundo para duas fileiras: dividir de rua a rua faria lote
  // com duas frentes — melhor dizer que não deu
  if (!novos && !soUmaFileira) return { pr: pr0, erro: true, msg: "Não consegui rearranjar estes lotes fundo com fundo sem cruzar divisas — selecione os lotes das duas fileiras em pares (o mesmo trecho de frente e de fundo)." };

  // ---- uma fileira
  if (!novos) {
    const F = montarFileira(R, rua);
    if (!F) return { pr: pr0, erro: true, msg: "Não achei a frente dos lotes selecionados." };
    const opcoes: Divisao[] = [];
    {
      // junções da fileira de trás (lotes de fora) no fundo da seleção: com a mesma quantidade, cada lateral termina numa delas — o fundo com fundo fica, sem mexer nos de trás
      const fora = aneis.filter((_, k) => !ks.includes(k));
      const conta = new Map<string, number>();
      for (const a of fora) for (const v of a) conta.set(chave(v), (conta.get(chave(v)) ?? 0) + 1);
      const qs = quinasDetalhe(F.anel, 3.5, 12, 40);
      const naQuina = new Set<number>(qs.flatMap((x) => { const o: number[] = []; for (let j = x.i0; j !== (x.i1 + 1) % F.anel.length; j = (j + 1) % F.anel.length) o.push(j); return o; }));
      const jun: { Q: Pt; sig: number }[] = [];
      F.anel.forEach((v, j) => {
        if (j <= F.m || naQuina.has(j)) return;
        if ((conta.get(chave(v)) ?? 0) >= 2) jun.push({ Q: v, sig: F.S[j] });
      });
      jun.sort((a, b) => b.sig - a.sig);
      if (jun.length === N - 1) { const d = dividirFileira(F, N, "juncoes", jun); if (d && d.formas.every((f) => f.dev.every((x) => x <= 25))) opcoes.push({ ...d, custo: d.custo * 0.5 }); }
    }
    for (const m of ["esquadro", "paralelas", "leque"] as ModoCorte[]) { const d = dividirFileira(F, N, m); if (d && !quebra(d.aneis)) opcoes.push(d); }
    if (!opcoes.length) return { pr: pr0, erro: true, msg: "Não consegui dividir estes lotes em áreas iguais sem cruzar divisas (o contorno da seleção é irregular demais) — selecione menos lotes ou use Cortar (C)." };
    const melhor = opcoes.sort((a, b) => a.custo - b.custo)[0];
    novos = melhor.aneis;
    formasFinal = melhor.formas;
    const devMax = Math.max(0, ...melhor.formas.flatMap((f) => f.dev));
    const nomeModo: Record<ModoCorte, string> = {
      esquadro: "laterais no esquadro da rua",
      paralelas: "laterais paralelas entre si (na média das divisas das pontas)",
      leque: "laterais em leque, girando aos poucos de uma ponta à outra",
      juncoes: "cada lateral termina numa junção dos lotes de trás (fundo com fundo)",
    };
    resumo = `${N} lotes com ${fmt(T)} m² cada — ${nomeModo[melhor.modo]}${melhor.modo === "esquadro" ? "" : `, até ${fmt(devMax, 1)}° do esquadro`}`;
    if (modo === "fundo" && melhor.modo !== "juncoes") resumo += ". Para fundo com fundo selecione também os lotes de trás (as duas fileiras)";
  }

  // ---- "fundo com fundo": a divisa que morre a poucos metros do degrau do contorno (o
  //      vizinho de fora desalinhado na ponta da seleção) vai até a quina dele — o lote da
  //      ponta fica com 4 quinas e com a pequena diferença de área. No "igualar" não: lá as
  //      áreas têm de ser iguais (se a forma não deixa, quem chamou desliza as divisas)
  if (modo === "fundo") {
    const objs = novos.map((a) => ({ pol: { ext: a, furos: [] as Pt[][] }, area: Math.abs(areaAssinada(a)) }));
    encaixarNasQuinas(objs, { ext: R, furos: [] }, p);
    let mexeu = false;
    objs.forEach((o, k) => {
      if (o.pol.ext === novos![k]) return;
      novos![k] = o.pol.ext;
      mexeu = true;
      if (formasFinal[k]) formasFinal[k] = { ...formasFinal[k], quinas: quinasAviso(o.pol.ext) };
    });
    if (mexeu) {
      const ar = novos.map((a) => Math.abs(areaAssinada(a)));
      resumo = resumo.replace(/^\d+ lotes (com [\d.,]+ m² cada|de [\d.,]+ a [\d.,]+ m²[^—]*)/, `${N} lotes de ${fmt(Math.min(...ar))} a ${fmt(Math.max(...ar))} m² (a ponta fica com a diferença, para o lote não ganhar quina) `);
    }
  }

  // ---- lote fora das medidas que não estava antes (testada abaixo da mínima numa ponta
  //      inclinada, por exemplo): não piora a planta — quem chamou decide (o igualar
  //      volta ao jeito antigo, por partes)
  const selAntes = res.lotes.filter((l) => l.quadra === q.nome && ks.includes(posicaoNoDesenho(pr0, res, l)));
  // lote de 5 quinas: conta pelo contorno de cada lote, antes e depois. A quina que o
  // contorno da seleção traz (a dobra da linha central, o degrau do vizinho) estava numa
  // divisa antes; se o arranjo novo a põe no meio de um lote, piorou (igualar 3 lotes já
  // iguais numa quadra da linha central deixava um com 5 quinas)
  // fundo: a maior distância do lote à reta da frente dele (o lado mais comprido na rua),
  // como a planta mede — fundo com fundo que deixava um lote com 50,8 m (máx. 48) passava
  const naRua = (a: Pt, b: Pt) => R.some((x, i) => rua[i] && distSegmento(a, x, R[(i + 1) % R.length]).d < 0.05 && distSegmento(b, x, R[(i + 1) % R.length]).d < 0.05);
  const fundoDe = (an: Pt[]) => {
    let fa: Pt | null = null, fb: Pt | null = null, comp = 0;
    an.forEach((a, i) => { const b = an[(i + 1) % an.length]; if (dist(a, b) > comp && naRua(a, b)) { comp = dist(a, b); fa = a; fb = b; } });
    if (!fa || !fb) return 0;
    const u = unit(sub(fb, fa));
    return Math.max(...an.map((x) => Math.abs(cross(u, sub(x, fa!)))));
  };
  const fundoFora = (f: number) => f > p.profundidadeMax * 1.03 + 0.01;
  const antesFora = selAntes.filter((l) => l.problemas.some((t) => /frente|profundidade/.test(t))).length + selAntes.filter((l) => quinasAviso(l.pol.ext) > 4).length;
  // fundo com fundo que só fecha com lotes de áreas muito diferentes (a seleção com 4 de um
  // lado e 3 do outro dava 138 a 274 m²): melhor pedir os lotes em pares do que entregar isso
  {
    const ar = novos.map((a) => Math.abs(areaAssinada(a)));
    const med = ar.reduce((s, x) => s + x, 0) / ar.length;
    if (modo === "fundo" && (Math.max(...ar) - Math.min(...ar)) / med > 0.25) {
      return { pr: pr0, erro: true, msg: `Fundo com fundo nestes ${N} lotes deixaria áreas muito diferentes (${fmt(Math.min(...ar))} a ${fmt(Math.max(...ar))} m²). Selecione os lotes das duas fileiras em pares — o mesmo trecho de frente e de fundo, a mesma quantidade de cada lado.` };
    }
  }
  // frente medida no lote (os lados dele que ficam na rua), como a planta mede: o lote da
  // ponta da linha central não tem "frente" no motor e passava com 4,6 m (mín. 5)
  const frenteNaRua = (an: Pt[]) => an.reduce((s, a, i) => { const b = an[(i + 1) % an.length]; return s + (naRua(a, b) ? dist(a, b) : 0); }, 0);
  const testadaFora = novos.filter((a, k) => {
    const f = formasFinal[k];
    const curta = frenteNaRua(a) < LIM.frenteMin - 0.005;
    return curta || (!!f && Number.isFinite(f.testada) && (f.testada < LIM.frenteMin - 0.005 || (!f.ponta && f.testada > LIM.frenteMax * 1.03)));
  }).length;
  const depoisFora = testadaFora + novos.filter((a) => quinasAviso(a) > 4).length + novos.filter((a) => fundoFora(fundoDe(a))).length;
  if (depoisFora > antesFora) return { pr: pr0, erro: true, msg: `Rearranjando estes ${N} lotes por igual, ${depoisFora - antesFora === 1 ? "um lote ficaria" : `${depoisFora - antesFora} lotes ficariam`} fora das medidas do projeto (testada abaixo de ${fmt(p.frenteMin)} m ou acima de ${fmt(p.frenteMax)} m, fundo acima de ${fmt(p.profundidadeMax)} m, ou com 5 quinas) — a ponta da seleção é inclinada demais. Selecione menos lotes na ponta.` };

  // ---- cada lote novo vai para a posição de um selecionado (a numeração fica)
  const cOld = ks.map((k) => centroide(aneis[k]));
  const cNew = novos.map((a) => centroide(a));
  const pares: { o: number; n: number; d: number }[] = [];
  cOld.forEach((co, o) => cNew.forEach((cn, n) => pares.push({ o, n, d: dist(co, cn) })));
  pares.sort((a, b) => a.d - b.d);
  const usadoO = new Set<number>(), usadoN = new Set<number>();
  const destinoDe = new Map<number, number>();
  for (const x of pares) { if (usadoO.has(x.o) || usadoN.has(x.n)) continue; usadoO.add(x.o); usadoN.add(x.n); destinoDe.set(ks[x.o], x.n); }
  // arranjo novo por inteiro (quadra de três frentes): pelo mais perto os números saíam
  // embaralhados; a numeração segue a ordem do contorno, no mesmo sentido de antes
  if (emOrdem && novos.length === ks.length) {
    const nR = R.length;
    const posNoContorno = (an: Pt[]) => {
      // o meio do lado mais comprido do lote que fica no contorno da seleção (a frente)
      let m: Pt = centroide(an), comp = -1;
      an.forEach((a, i) => { const b = an[(i + 1) % an.length]; if (dist(a, b) > comp && R.some((x, j) => distSegmento(a, x, R[(j + 1) % nR]).d < 0.05 && distSegmento(b, x, R[(j + 1) % nR]).d < 0.05)) { comp = dist(a, b); m = lerp(a, b, 0.5); } });
      let melhor = Infinity, sm = 0, acc = 0;
      for (let j = 0; j < nR; j++) { const a = R[j], b = R[(j + 1) % nR], d = distSegmento(m, a, b); if (d.d < melhor) { melhor = d.d; sm = acc + d.t * dist(a, b); } acc += dist(a, b); }
      return sm;
    };
    // as posições na ordem da numeração; os lotes novos pelo contorno, no sentido e com o
    // começo que ficam mais perto dos números antigos
    const oOrd = ks.map((_, o) => o).sort((x, y) => ks[x] - ks[y]);
    const pos = novos.map((a) => posNoContorno(a));
    const ida = novos.map((_, k) => k).sort((x, y) => pos[x] - pos[y]);
    const N2 = ks.length;
    let ordem = ida, rMelhor = 0, dMelhor = Infinity;
    for (const o of [ida, [...ida].reverse()]) for (let r = 0; r < N2; r++) {
      let d = 0;
      for (let i = 0; i < N2; i++) d += dist(cOld[oOrd[i]], cNew[o[(i + r) % N2]]);
      if (d < dMelhor) { dMelhor = d; rMelhor = r; ordem = o; }
    }
    destinoDe.clear();
    for (let i = 0; i < N2; i++) destinoDe.set(ks[oOrd[i]], ordem[(i + rMelhor) % N2]);
  }
  const aneisNovos = aneis.map((a, k) => (destinoDe.has(k) ? novos![destinoDe.get(k)!] : a));
  const metas: Meta[] = destinos.map((d, k) => (destinoDe.has(k) ? { ...d, frente: undefined } : d));
  const prN = gravar(pr, res, i, normalizar(aneisNovos), metas);
  void duas;
  return { pr: prN, msg: `${resumo}. A área total dos ${N} lotes (${fmt(total)} m²) ficou entre eles; os lotes de fora da seleção não mudaram.`, sel: { quadra: q.nome, indices: ks } };
}

const ehRua = (t: TipoAresta) => t === "rua" || t === "via";

/**
 * Pontas da linha central levadas à quina mais próxima do contorno (até 6 m): é o
 * degrau que o vizinho de fora deixa na cabeceira. Sem isso a linha bate no meio do
 * degrau e os dois lotes da ponta ficam com 5 quinas (ou com uma lasca).
 */
/**
 * A linha de fundo atual entre os lotes selecionados: os lados comuns de fundo (lote da
 * frente com lote de trás, os dois na seleção), encadeados de uma ponta do contorno da
 * seleção à outra. Sem linha contínua de borda a borda, nada.
 */
function linhaDeFundoDaSelecao(aneis: Pt[][], ks: number[], q: Quadra, R: Pt[]): Pt[] | null {
  const est = estruturaDeDivisas(aneis, q);
  const sel = new Set(ks);
  const segs = est.comuns.filter((c) => sel.has(c.lotes[0]) && sel.has(c.lotes[1]) && est.ehFundo(c.a, c.b));
  if (!segs.length) return null;
  const chave = (p: Pt) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)}`;
  const viz = new Map<string, { p: Pt; outros: Pt[] }>();
  const liga = (a: Pt, b: Pt) => { const k = chave(a); if (!viz.has(k)) viz.set(k, { p: a, outros: [] }); viz.get(k)!.outros.push(b); };
  for (const s of segs) { liga(s.a, s.b); liga(s.b, s.a); }
  const pontas = [...viz.values()].filter((v) => v.outros.length === 1);
  if (pontas.length !== 2 || [...viz.values()].some((v) => v.outros.length > 2)) return null;
  const linha: Pt[] = [pontas[0].p];
  let ant: Pt | null = null, cur = pontas[0].p;
  for (let it = 0; it < 500; it++) {
    const prox = viz.get(chave(cur))!.outros.find((o) => !ant || chave(o) !== chave(ant));
    if (!prox) break;
    linha.push(prox);
    ant = cur; cur = prox;
    if (chave(cur) === chave(pontas[1].p)) break;
  }
  if (chave(linha[linha.length - 1]) !== chave(pontas[1].p)) return null;
  const naBorda = (p: Pt) => R.some((a, i) => distSegmento(p, a, R[(i + 1) % R.length]).d < 0.05);
  if (!naBorda(linha[0]) || !naBorda(linha[linha.length - 1])) return null;
  // pontos alinhados (junções no meio de um lado reto) saem: a linha fica com as dobras
  const limpa = [linha[0]];
  // (até 3°: a linha de fundo antiga tem uma dobrinha em cada junção, e o motor puxava as
  // divisas novas para elas — os lotes da fileira saíam 182 e 186 m² em vez de iguais)
  for (let i = 1; i < linha.length - 1; i++) if (Math.abs(ang(sub(linha[i], limpa[limpa.length - 1]), sub(linha[i + 1], linha[i]))) > 3 * GRAU) limpa.push(linha[i]);
  limpa.push(linha[linha.length - 1]);
  return limpa;
}

function linhaNoDegrau(C: Pt[], R: Pt[], rua: boolean[]): Pt[] | null {
  if (C.length < 2) return null;
  const n = R.length;
  const quinas = quinasDetalhe(R, 3.5, 12, 40).filter((q) => !q.arco && !rua[q.i] && !rua[(q.i - 1 + n) % n]).map((q) => R[q.i]);
  const out = C.map((p) => [p[0], p[1]] as Pt);
  let mexeu = false;
  for (const k of [0, C.length - 1]) {
    // (até 10 m: o degrau de 3 m na ponta da quadra C do EDILSON ficava a 6,9 m da ponta da linha)
    let melhor: Pt | null = null, dm = 10;
    for (const v of quinas) { const d = dist(v, C[k]); if (d < dm && d > 0.05) { dm = d; melhor = v; } }
    if (melhor) { out[k] = melhor; mexeu = true; }
  }
  return mexeu ? out : null;
}
function dentroDe(s0: number, s1: number, e: [number, number], P: number): boolean {
  // a cadeia [s0,s1] cai dentro do trecho e (cíclico)
  const meio = (s0 + s1) / 2;
  let x = meio;
  while (x < e[0] - 1e-6) x += P;
  while (x > e[0] + P) x -= P;
  return x <= e[1] + 1e-6;
}

/** posições no desenho dos lotes (para os comandos) */
export function posicoes(pr: Projeto, res: Resultado, lotes: Resultado["lotes"]): number[] {
  return lotes.map((l) => posicaoNoDesenho(pr, res, l));
}
