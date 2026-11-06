// Volumes de corte e aterro de uma plataforma sobre o terreno do levantamento.
//
// O MÉTODO
// --------
// Terreno: o TIN dos pontos (tin.ts) — entre três pontos vizinhos, o plano que
// passa por eles.
//
// Projeto: a plataforma é um plano (horizontal ou com a inclinação pedida)
// dentro do contorno dela. Fora, o talude: a partir da borda, sobe na
// proporção do corte (1 m na vertical para `corte` m na horizontal) até
// encontrar o terreno na CRISTA, ou desce na proporção do aterro até o PÉ.
// A distância é medida até o ponto mais perto da borda (nos cantos de fora
// o talude vira um quarto de cone, como na obra).
//
// Volume dentro da plataforma: exato. Cada triângulo do TIN é recortado pelo
// contorno da plataforma; em cada pedaço, terreno − projeto é linear, e a
// integral da parte positiva (corte) e da negativa (aterro) sai fechada,
// recortando o pedaço pela linha de passagem (corte = 0).
//
// Volume dos taludes: malha regular (o passo sai da densidade dos pontos),
// prisma em cada célula com corte parcial — dentro da célula, a altura de
// corte/aterro é interpolada linearmente em dois triângulos e a parte que
// passa do zero é cortada fora (fórmula fechada). As células que a borda da
// plataforma atravessa são subdivididas (8 × 8) e só a parte de fora conta.
//
// Cota de equilíbrio: bisseção na cota do centro da plataforma até
// corte = aterro × fator de compactação (o volume de corte cai e o de aterro
// sobe quando a cota sobe — a função é monótona, a bisseção sempre converge).
//
// Tudo aqui é puro (sem DOM): roda no Web Worker e no node --test.
import { curvasDeNivel } from "../relevo/curvas.ts";
import type { Curva, GradeCotas } from "../relevo/curvas.ts";
import { offsetPols } from "../loteamento/geom.ts";
import type { Pt } from "./geometria.ts";
import {
  antiHorario, areaAssinada, caixa, cantosDoRetangulo, centroide, dentro, dist, doAzimute, limparAnel,
  maisPertoNaBorda, recortarSemiplano, retanguloMinimo, seCruza, trianguloNoPoligono,
} from "./geometria.ts";
import type { RetanguloMinimo } from "./geometria.ts";
import { IndiceTin, montarTin } from "./tin.ts";
import type { Tin } from "./tin.ts";
import type { ProjetoTerraplanagem } from "./modelo.ts";

// ---------------------------------------------------------------------------
// Malha
// ---------------------------------------------------------------------------

export interface Malha {
  e0: number;
  n0: number;
  passo: number;
  nx: number;
  ny: number;
  /** cota do terreno em cada nó (NaN fora do TIN), linha a linha a partir do sul */
  t: Float64Array;
}

const PASSOS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50];
const MAX_NOS = 120_000;

/** Passo da malha pela densidade dos pontos: metade do espaçamento típico, até ~200 nós no lado maior. */
export function passoAutomatico(tin: Tin): number {
  const c = caixa(tin.contorno.length ? tin.contorno : [[0, 0]]);
  const lx = c.max[0] - c.min[0], ly = c.max[1] - c.min[1];
  const area = Math.abs(areaAssinada(tin.contorno)) || lx * ly;
  const esp = Math.sqrt(area / Math.max(1, tin.x.length));
  let alvo = Math.min(esp / 2, Math.max(lx, ly) / 200);
  alvo = Math.max(alvo, Math.sqrt((lx + 2) * (ly + 2) / MAX_NOS));
  for (const p of PASSOS) if (p >= alvo * 0.999) return p;
  return PASSOS[PASSOS.length - 1];
}

/** Rasteriza o TIN na malha (baricêntrica em cada triângulo). */
export function malhaDoTin(tin: Tin, passo: number, folga = 0): Malha {
  const c = caixa(tin.contorno.length ? tin.contorno : Array.from(tin.x, (x, i) => [x, tin.y[i]] as Pt));
  const e0 = Math.floor((c.min[0] - folga) / passo) * passo, n0 = Math.floor((c.min[1] - folga) / passo) * passo;
  const nx = Math.floor((c.max[0] + folga - e0) / passo) + 2, ny = Math.floor((c.max[1] + folga - n0) / passo) + 2;
  const t = new Float64Array(nx * ny).fill(NaN);
  const { x, y, z, tri } = tin;
  for (let k = 0; k < tri.length; k += 3) {
    const a = tri[k], b = tri[k + 1], cc = tri[k + 2];
    const xa = x[a], ya = y[a], xb = x[b], yb = y[b], xc = x[cc], yc = y[cc];
    const d = (yb - yc) * (xa - xc) + (xc - xb) * (ya - yc);
    if (d === 0) continue;
    const i0 = Math.max(0, Math.ceil((Math.min(xa, xb, xc) - e0) / passo - 1e-9));
    const i1 = Math.min(nx - 1, Math.floor((Math.max(xa, xb, xc) - e0) / passo + 1e-9));
    const j0 = Math.max(0, Math.ceil((Math.min(ya, yb, yc) - n0) / passo - 1e-9));
    const j1 = Math.min(ny - 1, Math.floor((Math.max(ya, yb, yc) - n0) / passo + 1e-9));
    for (let j = j0; j <= j1; j++) {
      const py = n0 + j * passo;
      for (let i = i0; i <= i1; i++) {
        const px = e0 + i * passo;
        const l1 = ((yb - yc) * (px - xc) + (xc - xb) * (py - yc)) / d;
        const l2 = ((yc - ya) * (px - xc) + (xa - xc) * (py - yc)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) t[j * nx + i] = l1 * z[a] + l2 * z[b] + l3 * z[cc];
      }
    }
  }
  return { e0, n0, passo, nx, ny, t };
}

// ---------------------------------------------------------------------------
// Integrais fechadas
// ---------------------------------------------------------------------------

/** Parte positiva de uma função linear num triângulo de área A com valores a, b, c nos vértices. */
export function positivoNoTriangulo(A: number, a: number, b: number, c: number): { v: number; area: number } {
  let p = a, q = b, r = c;
  if (p < q) [p, q] = [q, p];
  if (q < r) [q, r] = [r, q];
  if (p < q) [p, q] = [q, p];
  if (p <= 0) return { v: 0, area: 0 };
  if (r >= 0) return { v: (A * (p + q + r)) / 3, area: A };
  if (q <= 0) {
    const t1 = p / (p - q), t2 = p / (p - r);
    const ar = A * t1 * t2;
    return { v: (ar * p) / 3, area: ar };
  }
  const s1 = -r / (p - r), s2 = -r / (q - r);
  const an = A * s1 * s2;
  return { v: (A * (p + q + r)) / 3 + (an * -r) / 3, area: A - an };
}

/** ∫ f dA de f linear (valores nos vértices) sobre um polígono (leque com área assinada). */
function integralLinear(pts: Pt[], f: number[]): { v: number; area: number } {
  let v = 0, area = 0;
  for (let i = 1; i + 1 < pts.length; i++) {
    const a = ((pts[i][0] - pts[0][0]) * (pts[i + 1][1] - pts[0][1]) - (pts[i][1] - pts[0][1]) * (pts[i + 1][0] - pts[0][0])) / 2;
    area += a;
    v += (a * (f[0] + f[i] + f[i + 1])) / 3;
  }
  return area < 0 ? { v: -v, area: -area } : { v, area };
}

// ---------------------------------------------------------------------------
// Geometria pronta da plataforma (não depende da cota)
// ---------------------------------------------------------------------------

export interface ProjetoPlataforma {
  /** contorno da plataforma (UTM, anti-horário) */
  anel: Pt[];
  /** centro (a cota da plataforma é a deste ponto) */
  centro: Pt;
  /** inclinação, % */
  inclinacao: number;
  /** azimute para onde a água escorre */
  direcao: number;
  /** H para 1 V */
  taludeCorte: number;
  taludeAterro: number;
}

interface Peca { pts: Pt[]; /** terreno − desnível da inclinação: plano α·x + β·y + γ (local) */ al: number; be: number; ga: number }

export interface Preparo {
  malha: Malha;
  plat: ProjetoPlataforma;
  /** origem local (o centro), para as contas dos pedaços */
  ox: number;
  oy: number;
  dentroNo: Uint8Array;
  /** distância do nó à borda (0 dentro) */
  delta: Float64Array;
  /** desnível da inclinação no nó (dentro) ou no ponto da borda mais perto (fora) */
  off: Float64Array;
  pecas: Peca[];
  /** área da plataforma coberta pelo TIN */
  areaCoberta: number;
  areaPlataforma: number;
  /** 0 fora, 1 dentro, 2 cortada pela borda */
  tipoCelula: Uint8Array;
  /** amostras de fora dentro das células cortadas: t, delta, off e a área de cada uma */
  sub: { t: Float64Array; delta: Float64Array; off: Float64Array; area: number };
  kc: number;
  ka: number;
}

const SUB = 8;

export function prepararPlataforma(tin: Tin, idx: IndiceTin, malha: Malha, plat: ProjetoPlataforma): Preparo {
  const anel = antiHorario(plat.anel);
  const { e0, n0, passo, nx, ny, t } = malha;
  const u = doAzimute(plat.direcao), s = plat.inclinacao / 100;
  const [cx, cy] = plat.centro;
  const offEm = (x: number, y: number) => -s * ((x - cx) * u[0] + (y - cy) * u[1]);
  const N = nx * ny;
  const dentroNo = new Uint8Array(N), delta = new Float64Array(N), off = new Float64Array(N);
  const cb = caixa(anel);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = e0 + i * passo, y = n0 + j * passo;
    const ehDentro = x >= cb.min[0] && x <= cb.max[0] && y >= cb.min[1] && y <= cb.max[1] && dentro([x, y], anel);
    if (ehDentro) { dentroNo[k] = 1; delta[k] = 0; off[k] = offEm(x, y); continue; }
    const m = maisPertoNaBorda([x, y], anel);
    delta[k] = m.d; off[k] = offEm(m.q[0], m.q[1]);
  }

  // pedaços do TIN dentro da plataforma (coordenadas locais em volta do centro)
  const ox = cx, oy = cy;
  const anelL = anel.map((p) => [p[0] - ox, p[1] - oy] as Pt);
  const pecas: Peca[] = [];
  let areaCoberta = 0;
  const { x, y, z, tri } = tin;
  for (let k = 0; k < tri.length; k += 3) {
    const a = tri[k], b = tri[k + 1], c = tri[k + 2];
    if (Math.max(x[a], x[b], x[c]) < cb.min[0] || Math.min(x[a], x[b], x[c]) > cb.max[0]
      || Math.max(y[a], y[b], y[c]) < cb.min[1] || Math.min(y[a], y[b], y[c]) > cb.max[1]) continue;
    const A: Pt = [x[a] - ox, y[a] - oy], B: Pt = [x[b] - ox, y[b] - oy], C: Pt = [x[c] - ox, y[c] - oy];
    const pts = trianguloNoPoligono([A, B, C], anelL);
    if (pts.length < 3) continue;
    const ar = Math.abs(areaAssinada(pts));
    if (ar < 1e-10) continue;
    areaCoberta += ar;
    // plano do terreno no triângulo: z = α x + β y + γ
    const det = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    const al = ((z[b] - z[a]) * (C[1] - A[1]) - (z[c] - z[a]) * (B[1] - A[1])) / det;
    const be = ((B[0] - A[0]) * (z[c] - z[a]) - (C[0] - A[0]) * (z[b] - z[a])) / det;
    const ga = z[a] - al * A[0] - be * A[1];
    // − desnível da inclinação (linear, zero no centro): off = −s (x u0 + y u1)
    pecas.push({ pts, al: al + s * u[0], be: be + s * u[1], ga });
  }

  // células: 0 fora, 1 dentro, 2 cortada pela borda
  const cxN = nx - 1, cyN = ny - 1;
  const tipoCelula = new Uint8Array(cxN * cyN);
  for (let j = 0; j < cyN; j++) for (let i = 0; i < cxN; i++) {
    const k = j * nx + i;
    const soma = dentroNo[k] + dentroNo[k + 1] + dentroNo[k + nx] + dentroNo[k + nx + 1];
    tipoCelula[j * cxN + i] = soma === 4 ? 1 : soma === 0 ? 0 : 2;
  }
  // a borda pode cruzar uma célula sem mudar os nós (canto que entra numa célula)
  for (let e = 0; e < anel.length; e++) {
    const p = anel[e], q = anel[(e + 1) % anel.length];
    const L = dist(p, q), passos = Math.max(1, Math.ceil(L / (passo / 4)));
    for (let m = 0; m <= passos; m++) {
      const px = p[0] + ((q[0] - p[0]) * m) / passos, py = p[1] + ((q[1] - p[1]) * m) / passos;
      const fx = (px - e0) / passo, fy = (py - n0) / passo;
      const rx = Math.round(fx), ry = Math.round(fy);
      // borda em cima de uma linha da malha: as duas células dos lados contam
      const is = Math.abs(fx - rx) < 1e-6 ? [rx - 1, rx] : [Math.floor(fx)];
      const js = Math.abs(fy - ry) < 1e-6 ? [ry - 1, ry] : [Math.floor(fy)];
      for (const jj of js) for (const ii of is) if (ii >= 0 && jj >= 0 && ii < cxN && jj < cyN) tipoCelula[jj * cxN + ii] = 2;
    }
  }
  // amostras de fora nas células cortadas
  const st: number[] = [], sd: number[] = [], so: number[] = [];
  const h = passo / SUB;
  for (let j = 0; j < cyN; j++) for (let i = 0; i < cxN; i++) {
    if (tipoCelula[j * cxN + i] !== 2) continue;
    for (let b2 = 0; b2 < SUB; b2++) for (let a2 = 0; a2 < SUB; a2++) {
      const px = e0 + i * passo + (a2 + 0.5) * h, py = n0 + j * passo + (b2 + 0.5) * h;
      if (dentro([px, py], anel)) continue;
      const m = maisPertoNaBorda([px, py], anel);
      st.push(idx.cota(px, py)); sd.push(m.d); so.push(offEm(m.q[0], m.q[1]));
    }
  }
  void t;
  const kc = plat.taludeCorte > 0 ? 1 / plat.taludeCorte : 1e9;
  const ka = plat.taludeAterro > 0 ? 1 / plat.taludeAterro : 1e9;
  return {
    malha, plat: { ...plat, anel }, ox, oy, dentroNo, delta, off, pecas, areaCoberta,
    areaPlataforma: Math.abs(areaAssinada(anel)), tipoCelula,
    sub: { t: Float64Array.from(st), delta: Float64Array.from(sd), off: Float64Array.from(so), area: h * h }, kc, ka,
  };
}

/** Altura de corte (+) ou aterro (−) num ponto de fora da plataforma. */
function alturaNoTalude(t: number, zb: number, d: number, kc: number, ka: number): number {
  if (t >= zb) { const c = t - zb - d * kc; return c > 0 ? c : 0; }
  const a = zb - d * ka - t;
  return a > 0 ? -a : 0;
}

export interface Avaliacao {
  corte: number;
  aterro: number;
  areaCorte: number;
  areaAterro: number;
  /** área de talude que passaria da borda do levantamento (sem terreno para calcular) */
  areaSemDado: number;
}

/** Volumes para a cota `z0` no centro (sem gravar a malha: é a conta da bisseção). */
export function avaliar(p: Preparo, z0: number, d?: Float64Array): Avaliacao {
  let corte = 0, aterro = 0, areaCorte = 0, areaAterro = 0, areaSemDado = 0;
  // dentro: exato pelos pedaços
  for (const pc of p.pecas) {
    const f = pc.pts.map((q) => pc.al * q[0] + pc.be * q[1] + pc.ga - z0);
    let mn = Infinity, mx = -Infinity;
    for (const v of f) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mn >= 0) { const r = integralLinear(pc.pts, f); corte += r.v; areaCorte += r.area; continue; }
    if (mx <= 0) { const r = integralLinear(pc.pts, f); aterro -= r.v; areaAterro += r.area; continue; }
    const pos = recortarSemiplano(pc.pts, f, pc.al, pc.be, pc.ga - z0);
    const neg = recortarSemiplano(pc.pts, f, -pc.al, -pc.be, -(pc.ga - z0));
    if (pos.pts.length >= 3) { const r = integralLinear(pos.pts, pos.vals); corte += r.v; areaCorte += r.area; }
    if (neg.pts.length >= 3) { const r = integralLinear(neg.pts, neg.vals); aterro -= r.v; areaAterro += r.area; }
  }
  // nós: altura de corte/aterro
  const { nx, ny, passo, t } = p.malha;
  const N = nx * ny;
  const h = d ?? new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const tk = t[k];
    if (!(tk === tk)) { h[k] = NaN; continue; }
    const zb = z0 + p.off[k];
    h[k] = p.dentroNo[k] ? tk - zb : alturaNoTalude(tk, zb, p.delta[k], p.kc, p.ka);
  }
  // fora: prisma por célula
  const A = (passo * passo) / 2;
  const cxN = nx - 1, cyN = ny - 1;
  for (let j = 0; j < cyN; j++) for (let i = 0; i < cxN; i++) {
    if (p.tipoCelula[j * cxN + i] !== 0) continue;
    const k = j * nx + i;
    const a = h[k], b = h[k + 1], c = h[k + nx + 1], e = h[k + nx];
    if (a === 0 && b === 0 && c === 0 && e === 0) continue;
    if (!(a === a && b === b && c === c && e === e)) {
      if ([a, b, c, e].some((v) => v === v && v !== 0)) areaSemDado += passo * passo;
      continue;
    }
    for (const [v1, v2, v3] of [[a, b, c], [a, c, e]]) {
      const pos = positivoNoTriangulo(A, v1, v2, v3);
      const neg = positivoNoTriangulo(A, -v1, -v2, -v3);
      corte += pos.v; areaCorte += pos.area;
      aterro += neg.v; areaAterro += neg.area;
    }
  }
  // fora, nas células cortadas pela borda: ponto médio das subcélulas
  const s = p.sub;
  for (let k = 0; k < s.t.length; k++) {
    const tk = s.t[k];
    if (!(tk === tk)) continue;
    const v = alturaNoTalude(tk, z0 + s.off[k], s.delta[k], p.kc, p.ka);
    if (v > 0) { corte += v * s.area; areaCorte += s.area; }
    else if (v < 0) { aterro -= v * s.area; areaAterro += s.area; }
  }
  return { corte, aterro, areaCorte, areaAterro, areaSemDado };
}

/** Faixa de cota em que a resposta está (todo corte em baixo, todo aterro em cima). */
function faixaDeBusca(p: Preparo, tin: Tin): [number, number] {
  let mn = Infinity, mx = -Infinity;
  for (const v of tin.z) { if (v < mn) mn = v; if (v > mx) mx = v; }
  let omn = 0, omx = 0;
  for (const q of p.plat.anel) {
    const u = doAzimute(p.plat.direcao), s = p.plat.inclinacao / 100;
    const o = -s * ((q[0] - p.plat.centro[0]) * u[0] + (q[1] - p.plat.centro[1]) * u[1]);
    if (o < omn) omn = o; if (o > omx) omx = o;
  }
  return [mn - omx - 1, mx - omn + 1];
}

/** Cota do centro em que corte = aterro × compactação (bisseção). */
export function cotaDeEquilibrio(p: Preparo, tin: Tin, compactacao = 1): number {
  let [lo, hi] = faixaDeBusca(p, tin);
  const f = (z: number) => { const r = avaliar(p, z); return r.corte - compactacao * r.aterro; };
  let flo = f(lo);
  if (flo <= 0) return lo;
  for (let it = 0; it < 60 && hi - lo > 1e-8; it++) {
    const m = (lo + hi) / 2, fm = f(m);
    if (fm > 0) { lo = m; flo = fm; } else hi = m;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------------------
// O cálculo completo de um projeto
// ---------------------------------------------------------------------------

export interface Secao {
  nome: string;
  a: Pt;
  b: Pt;
  /** distância ao início, cota do terreno (NaN sem dado), cota do projeto */
  s: number[];
  terreno: number[];
  projeto: number[];
}

export interface ResultadoTerraplanagem {
  cota: number;
  equilibrio: boolean;
  corte: number;
  aterro: number;
  /** corte − aterro × compactação: positivo sobra (bota-fora), negativo falta (empréstimo) */
  saldo: number;
  areaCorte: number;
  areaAterro: number;
  areaPlataforma: number;
  perimetroPlataforma: number;
  /** caminhões de `caminhao` m³ com o empolamento, e para quê */
  caminhoes: { quantidade: number; volumeSolto: number; para: "bota-fora" | "emprestimo" | "interno" };
  plataforma: Pt[];
  retangulo: RetanguloMinimo;
  folga: number | null;
  contorno: Pt[];
  malha: { e0: number; n0: number; passo: number; nx: number; ny: number; terreno: Float32Array; altura: Float32Array; projeto: Float32Array };
  faixaTerreno: { min: number; max: number };
  maxCorte: number;
  maxAterro: number;
  curvasTerreno: Curva[];
  intervaloTerreno: number;
  isolinhas: Curva[];
  intervaloIsolinhas: number;
  passagem: Pt[][];
  crista: Pt[][];
  pe: Pt[][];
  secoes: Secao[];
  avisos: string[];
  /**
   * Os volumes não cobrem a obra inteira (plataforma fora do levantamento ou
   * talude além da borda, acima da tolerância): a tela não trata como pronto.
   */
  incompleto: { motivo: string; areaFora: number; areaSemDado: number } | null;
  nPontos: number;
  espacamento: number;
  ms: number;
}

export const ERRO_GRAVATA = "O polígono da plataforma se cruza (forma de gravata): os lados se atravessam e a área não fecha. Redesenhe a plataforma no Google Earth sem cruzar as linhas e envie o KML de novo.";

export class ErroTerraplanagem extends Error {
  constructor(m: string) { super(m); this.name = "ErroTerraplanagem"; }
}

function intervaloTerreno(desnivel: number): number {
  for (const v of [0.25, 0.5, 1, 2, 5, 10]) if (desnivel / v <= 30) return v;
  return 20;
}

/** NaN vira o vizinho válido mais perto (só para traçar curvas, que depois são recortadas pelo contorno). */
function preencher(g: Float64Array, nx: number, ny: number): Float64Array {
  const h = Float64Array.from(g);
  let faltam = h.some((v) => v !== v);
  for (let volta = 0; faltam && volta < Math.max(nx, ny); volta++) {
    faltam = false;
    const ant = Float64Array.from(h);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (ant[k] === ant[k]) continue;
      let s = 0, c = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
        const v = ant[jj * nx + ii];
        if (v === v) { s += v; c++; }
      }
      if (c) h[k] = s / c; else faltam = true;
    }
  }
  for (let k = 0; k < h.length; k++) if (h[k] !== h[k]) h[k] = 0;
  return h;
}

/** Cache do TIN entre um cálculo e outro (no worker: mexer na cota não refaz a triangulação). */
let cacheTin: { chave: string; tin: Tin; idx: IndiceTin; malha: Malha } | null = null;

export function chaveDosPontos(pts: { e: number; n: number; z: number }[]): string {
  let h = 0;
  for (const p of pts) h = (h * 31 + Math.round(p.e * 100) * 7 + Math.round(p.n * 100) * 13 + Math.round(p.z * 1000)) % 2147483647;
  return `${pts.length}:${h}`;
}

export function tinDoProjeto(pr: Pick<ProjetoTerraplanagem, "pontos">): { tin: Tin; idx: IndiceTin; malha: Malha } {
  const chave = chaveDosPontos(pr.pontos);
  if (cacheTin?.chave === chave) return cacheTin;
  if (pr.pontos.length < 3) throw new ErroTerraplanagem("São precisos pelo menos 3 pontos com cota.");
  const tin = montarTin(pr.pontos);
  if (tin.tri.length < 3 || tin.contorno.length < 3) throw new ErroTerraplanagem("Os pontos estão alinhados ou repetidos: não formam uma superfície.");
  const idx = new IndiceTin(tin);
  const malha = malhaDoTin(tin, passoAutomatico(tin));
  cacheTin = { chave, tin, idx, malha };
  return cacheTin;
}

/**
 * Cache do preparo da plataforma (as distâncias de cada nó à borda, os pedaços
 * do TIN): mudar só a cota fixa, a compactação, o caminhão ou o empolamento não
 * refaz nada disso — só a conta dos volumes.
 */
const cachePreparo: { chave: string; malha: Malha; prep: Preparo }[] = [];
function preparoEmCache(tin: Tin, idx: IndiceTin, malha: Malha, plat: ProjetoPlataforma): Preparo {
  const chave = JSON.stringify([plat.anel, plat.inclinacao, plat.direcao, plat.taludeCorte, plat.taludeAterro]);
  const i = cachePreparo.findIndex((c) => c.malha === malha && c.chave === chave);
  if (i >= 0) { const [c] = cachePreparo.splice(i, 1); cachePreparo.unshift(c); return c.prep; }
  const prep = prepararPlataforma(tin, idx, malha, plat);
  cachePreparo.unshift({ chave, malha, prep });
  if (cachePreparo.length > 6) cachePreparo.length = 6;
  return prep;
}

/**
 * Área de talude que cai fora do levantamento, estimada pela borda da
 * plataforma: em cada trecho, a largura do talude (desnível × H) na normal para
 * fora; o pedaço dessa normal fora do contorno dos pontos é volume que não entrou.
 * A malha não vê isso quando o talude sai inteiro da caixa dos pontos.
 */
export function taludeForaDoLevantamento(p: Preparo, tin: Tin, idx: IndiceTin, z0: number): number {
  const anel = p.plat.anel, cont = tin.contorno;
  const u = doAzimute(p.plat.direcao), s = p.plat.inclinacao / 100;
  const passo = p.malha.passo;
  const hc = p.kc >= 1e8 ? 0 : 1 / p.kc, ha = p.ka >= 1e8 ? 0 : 1 / p.ka;
  let area = 0;
  for (let e = 0; e < anel.length; e++) {
    const a = anel[e], b = anel[(e + 1) % anel.length];
    const L = dist(a, b);
    if (L < 1e-9) continue;
    const nxo = (b[1] - a[1]) / L, nyo = -(b[0] - a[0]) / L; // normal para fora (anel anti-horário)
    const n = Math.max(1, Math.ceil(L / passo)), ds = L / n;
    for (let m = 0; m < n; m++) {
      const t = (m + 0.5) / n;
      const q: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const tq = idx.cota(q[0], q[1]);
      if (!(tq === tq)) continue; // plataforma fora: já conta como área fora
      const zb = z0 - s * ((q[0] - p.plat.centro[0]) * u[0] + (q[1] - p.plat.centro[1]) * u[1]);
      const w = tq >= zb ? (tq - zb) * hc : (zb - tq) * ha;
      if (w < passo / 4) continue;
      const k = Math.max(2, Math.ceil(w / (passo / 2)));
      let fora = 0;
      for (let i = 1; i <= k; i++) {
        const d = (w * (i - 0.5)) / k;
        if (!dentro([q[0] + nxo * d, q[1] + nyo * d], cont)) fora++;
      }
      // a faixa do talude afina para fora (a terra encontra o terreno): conta a metade
      area += 0.5 * (fora / k) * w * ds;
    }
  }
  return area;
}

/** Tolerâncias do "incompleto": acima disso o número não representa a obra. */
export const TOLERANCIA_FORA = 0.02;
export const TOLERANCIA_SEM_DADO = 0.05;

function maiorAnel(pols: { ext: Pt[] }[]): Pt[] | null {
  let m: Pt[] | null = null, am = 0;
  for (const p of pols) { const a = Math.abs(areaAssinada(p.ext)); if (a > am) { am = a; m = p.ext; } }
  return m;
}

/** Contorno dos pontos recuado `folga` m (onde o talude cabe dentro do levantamento). */
export function plataformaDoContorno(contorno: Pt[], folga: number): Pt[] | null {
  if (folga <= 0) return contorno;
  const r = maiorAnel(offsetPols([{ ext: contorno, furos: [] }], -folga));
  return r && r.length >= 3 ? limparAnel(antiHorario(r), 0.01) : null;
}

/** Largura máxima do talude (maior distância à borda com corte ou aterro). */
function larguraDoTalude(p: Preparo, h: Float64Array): number {
  let w = 0;
  for (let k = 0; k < h.length; k++) if (!p.dentroNo[k] && h[k] !== 0 && h[k] === h[k] && p.delta[k] > w) w = p.delta[k];
  return w;
}

export function calcularTerraplanagem(pr: ProjetoTerraplanagem): ResultadoTerraplanagem {
  const t0 = Date.now();
  const { tin, idx, malha } = tinDoProjeto(pr);
  const avisos: string[] = [];
  if (tin.repetidos) avisos.push(`${tin.repetidos} ponto(s) na mesma posição de outro ficaram de fora do terreno (vale o primeiro).`);
  const ret0 = retanguloMinimo(tin.contorno);
  const taludes = { taludeCorte: pr.taludes.corte, taludeAterro: pr.taludes.aterro };
  const inclinacao = pr.cota.inclinacao, direcao = pr.cota.direcao;
  const fc = pr.fatores.compactacao;

  const resolver = (anel: Pt[]) => {
    const plat: ProjetoPlataforma = { anel, centro: centroide(antiHorario(anel)), inclinacao, direcao, ...taludes };
    const prep = preparoEmCache(tin, idx, malha, plat);
    if (!prep.pecas.length) throw new ErroTerraplanagem("A plataforma está fora da área levantada. Desenhe-a por cima dos pontos.");
    const equilibrio = pr.cota.modo !== "fixa" || pr.cota.valor == null;
    const z0 = equilibrio ? cotaDeEquilibrio(prep, tin, fc) : pr.cota.valor!;
    const h = new Float64Array(malha.nx * malha.ny);
    const av = avaliar(prep, z0, h);
    return { prep, z0, equilibrio, av, h };
  };

  let anel: Pt[] | null = null;
  let folga: number | null = null;
  let r: ReturnType<typeof resolver> | null = null;
  if (pr.plataforma.modo === "retangulo" && pr.plataforma.retangulo) {
    const q = pr.plataforma.retangulo;
    anel = cantosDoRetangulo(q.centro, q.largura, q.comprimento, q.giro);
  } else if (pr.plataforma.modo === "poligono" && pr.plataforma.poligono && pr.plataforma.poligono.length >= 3) {
    anel = limparAnel(antiHorario(pr.plataforma.poligono), 0.001);
    if (anel.length < 3 || seCruza(anel)) throw new ErroTerraplanagem(ERRO_GRAVATA);
  }
  if (anel) r = resolver(anel);
  else if (pr.plataforma.folga != null) {
    folga = pr.plataforma.folga;
    anel = plataformaDoContorno(tin.contorno, folga);
    if (!anel) throw new ErroTerraplanagem(`Com ${fmtN(folga, 1)} m de afastamento da borda não sobra plataforma. Diminua o afastamento.`);
    r = resolver(anel);
  } else {
    // automático: o maior recuo do contorno em que o talude cabe dentro do levantamento
    let zmin = Infinity, zmax = -Infinity;
    for (const v of tin.z) { if (v < zmin) zmin = v; if (v > zmax) zmax = v; }
    const desnivel = zmax - zmin;
    const lim = Math.max(1, 0.3 * ret0.largura);
    folga = Math.min(lim, Math.max(malha.passo * 2, (desnivel / 2) * Math.max(pr.taludes.corte, pr.taludes.aterro)));
    for (let volta = 0; volta < 5; volta++) {
      const a = plataformaDoContorno(tin.contorno, folga);
      if (!a) { folga *= 0.6; continue; }
      const tent = resolver(a);
      anel = a; r = tent;
      const w = larguraDoTalude(tent.prep, tent.h);
      const precisa = w + malha.passo;
      if (precisa <= folga * 1.02 && precisa >= folga * 0.8) break;
      const nova = Math.min(lim, precisa * 1.05);
      if (Math.abs(nova - folga) < malha.passo / 2) break;
      folga = nova;
    }
    if (!r || !anel) throw new ErroTerraplanagem("Não coube uma plataforma dentro do contorno dos pontos.");
  }
  if (!r || !anel) throw new ErroTerraplanagem("Plataforma sem contorno.");
  const { prep, z0, equilibrio, av, h } = r;

  // avisos honestos
  const fora = Math.max(0, prep.areaPlataforma - prep.areaCoberta);
  if (prep.areaCoberta < prep.areaPlataforma * 0.995) {
    avisos.push(`${fmtN(fora, 0)} m² da plataforma ficam fora da área levantada: lá não há terreno para calcular. Mova ou reduza a plataforma.`);
  }
  const semDado = Math.max(av.areaSemDado, taludeForaDoLevantamento(prep, tin, idx, z0));
  if (semDado >= 1) avisos.push(`O talude passa da borda do levantamento (cerca de ${fmtN(semDado, 0)} m²): o volume desse trecho não entrou. Afaste a plataforma da borda ou levante mais pontos em volta.`);
  if (pr.taludes.corte === 0 || pr.taludes.aterro === 0) avisos.push("Talude a prumo (0 na horizontal): só vale com muro de arrimo ou contenção.");

  // malha para o mapa
  const { nx, ny, passo, e0, n0 } = malha;
  const N = nx * ny;
  const terreno = new Float32Array(N), altura = new Float32Array(N), projeto = new Float32Array(N);
  let maxCorte = 0, maxAterro = 0, tmin = Infinity, tmax = -Infinity;
  for (let k = 0; k < N; k++) {
    const tk = malha.t[k];
    terreno[k] = tk; altura[k] = h[k];
    projeto[k] = tk === tk ? (prep.dentroNo[k] ? z0 + prep.off[k] : tk - h[k]) : NaN;
    if (tk === tk) { if (tk < tmin) tmin = tk; if (tk > tmax) tmax = tk; }
    if (h[k] > maxCorte) maxCorte = h[k];
    if (-h[k] > maxAterro) maxAterro = -h[k];
  }
  for (const pc of prep.pecas) for (const q of pc.pts) {
    const v = pc.al * q[0] + pc.be * q[1] + pc.ga - z0;
    if (v > maxCorte) maxCorte = v;
    if (-v > maxAterro) maxAterro = -v;
  }

  // curvas do terreno (recortadas pelo contorno)
  const gT: GradeCotas = { e0, n0, passo, nx, ny, h: preencher(malha.t, nx, ny) };
  const ivT = intervaloTerreno(tmax - tmin);
  const curvasTerreno = curvasDeNivel(gT, ivT, [tin.contorno]);
  // isolinhas de corte/aterro (a cada 0,5 m; mais largas em obra funda)
  const hz = Float64Array.from(h, (v) => (v === v ? v : 0));
  const gH: GradeCotas = { e0, n0, passo, nx, ny, h: hz };
  const prof = Math.max(maxCorte, maxAterro);
  const ivH = prof <= 12 ? 0.5 : prof <= 30 ? 1 : 2;
  const isolinhas = curvasDeNivel(gH, ivH, [tin.contorno]).filter((c) => Math.abs(c.cota) > 1e-6);
  // linha de passagem: corte = 0 dentro da plataforma
  const passagem = curvasDeNivel(gH, 1e6, [prep.plat.anel]).map((c) => c.pts).filter((q) => q.length >= 2);
  // crista e pé: a borda do que o talude ocupa
  const g = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const tk = malha.t[k];
    if (!(tk === tk)) { g[k] = -1; continue; }
    const zb = z0 + prep.off[k];
    if (prep.dentroNo[k]) { g[k] = Math.max(Math.abs(tk - zb), 1e-3); continue; }
    // só o sinal e o zero interessam: limitado, senão o talude a prumo (k = 1e9) abriria milhões de níveis
    const v = tk >= zb ? tk - zb - prep.delta[k] * prep.kc : zb - prep.delta[k] * prep.ka - tk;
    g[k] = v < -5 ? -5 : v > 5 ? 5 : v;
  }
  const bordaTalude = curvasDeNivel({ e0, n0, passo, nx, ny, h: g }, 1e6, [tin.contorno]).map((c) => c.pts);
  const crista: Pt[][] = [], pe: Pt[][] = [];
  const u = doAzimute(direcao), s = inclinacao / 100;
  const ehCorte = (q: Pt) => {
    const m = maisPertoNaBorda(q, prep.plat.anel);
    const zb = z0 - s * ((m.q[0] - prep.plat.centro[0]) * u[0] + (m.q[1] - prep.plat.centro[1]) * u[1]);
    const tq = idx.cota(q[0], q[1]);
    return tq === tq ? tq >= zb : true;
  };
  for (const linha of bordaTalude) {
    let atual: Pt[] = [], tipo: boolean | null = null;
    for (const q of linha) {
      const c = ehCorte(q);
      if (tipo !== null && c !== tipo) {
        atual.push(q);
        if (atual.length >= 2) (tipo ? crista : pe).push(atual);
        atual = [q];
      } else atual.push(q);
      tipo = c;
    }
    if (atual.length >= 2 && tipo !== null) (tipo ? crista : pe).push(atual);
  }

  // seções pelo meio da plataforma, nos dois sentidos
  const retP = retanguloMinimo(prep.plat.anel);
  const centroS = pr.secao.centro ?? prep.plat.centro;
  const giroS = pr.secao.giro ?? retP.giro;
  const cbT = caixa(tin.contorno);
  const meia = Math.hypot(cbT.max[0] - cbT.min[0], cbT.max[1] - cbT.min[1]) / 2 + passo;
  const secoes = [
    secaoPor(prep, idx, z0, centroS, giroS, meia, "A"),
    secaoPor(prep, idx, z0, centroS, giroS + 90, meia, "B"),
  ].filter((x): x is Secao => !!x);

  // incompleto: o volume deixa de fora um pedaço da obra que importa
  let incompleto: ResultadoTerraplanagem["incompleto"] = null;
  const pctFora = fora / Math.max(1e-9, prep.areaPlataforma);
  const pctSemDado = semDado / Math.max(1e-9, prep.areaPlataforma);
  if (pctFora > TOLERANCIA_FORA || pctSemDado > TOLERANCIA_SEM_DADO) {
    incompleto = {
      motivo: pctFora > TOLERANCIA_FORA
        ? `${fmtN(pctFora * 100, 0)}% da plataforma (${fmtN(fora, 0)} m²) fica fora do levantamento: esse trecho não entrou nos volumes.`
        : `O talude passa da borda do levantamento em cerca de ${fmtN(semDado, 0)} m²: esse trecho não entrou nos volumes.`,
      areaFora: fora, areaSemDado: semDado,
    };
  }

  // números
  const saldo = av.corte - fc * av.aterro;
  const emp = 1 + pr.fatores.empolamento / 100, cap = pr.fatores.caminhao;
  const relSaldo = Math.abs(saldo) / Math.max(1, av.corte, av.aterro);
  const caminhoes = relSaldo < 0.01
    ? { quantidade: Math.ceil((av.corte * emp) / cap - 1e-9), volumeSolto: av.corte * emp, para: "interno" as const }
    : saldo > 0
      ? { quantidade: Math.ceil((saldo * emp) / cap - 1e-9), volumeSolto: saldo * emp, para: "bota-fora" as const }
      : { quantidade: Math.ceil((-saldo * emp) / cap - 1e-9), volumeSolto: -saldo * emp, para: "emprestimo" as const };

  return {
    cota: z0, equilibrio,
    corte: av.corte, aterro: av.aterro, saldo,
    areaCorte: av.areaCorte, areaAterro: av.areaAterro,
    areaPlataforma: prep.areaPlataforma,
    perimetroPlataforma: prep.plat.anel.reduce((sm, q, i, a) => sm + dist(q, a[(i + 1) % a.length]), 0),
    caminhoes,
    plataforma: prep.plat.anel, retangulo: retP, folga,
    contorno: tin.contorno,
    malha: { e0, n0, passo, nx, ny, terreno, altura, projeto },
    faixaTerreno: { min: tmin, max: tmax }, maxCorte, maxAterro,
    curvasTerreno, intervaloTerreno: ivT, isolinhas, intervaloIsolinhas: ivH,
    passagem, crista, pe, secoes, avisos, incompleto,
    nPontos: tin.x.length, espacamento: tin.espacamento,
    ms: Date.now() - t0,
  };
}

/** Perfil ao longo da reta pelo centro no azimute dado, só onde há terreno. */
export function secaoPor(p: Preparo, idx: IndiceTin, z0: number, centro: Pt, giro: number, meia: number, nome: string): Secao | null {
  const u = doAzimute(giro);
  const passo = Math.max(0.05, p.malha.passo / 2);
  const n = Math.min(1200, Math.ceil((2 * meia) / passo));
  const amostras: { q: Pt; t: number; z: number }[] = [];
  const s = p.plat.inclinacao / 100, w = doAzimute(p.plat.direcao);
  const offEm = (q: Pt) => -s * ((q[0] - p.plat.centro[0]) * w[0] + (q[1] - p.plat.centro[1]) * w[1]);
  for (let k = 0; k <= n; k++) {
    const d = -meia + (2 * meia * k) / n;
    const q: Pt = [centro[0] + u[0] * d, centro[1] + u[1] * d];
    const t = idx.cota(q[0], q[1]);
    if (!(t === t)) { amostras.push({ q, t: NaN, z: NaN }); continue; }
    if (dentro(q, p.plat.anel)) { amostras.push({ q, t, z: z0 + offEm(q) }); continue; }
    const m = maisPertoNaBorda(q, p.plat.anel);
    const hgt = alturaNoTalude(t, z0 + offEm(m.q), m.d, p.kc, p.ka);
    amostras.push({ q, t, z: t - hgt });
  }
  // só o trecho com terreno
  const i0 = amostras.findIndex((a) => a.t === a.t);
  let i1 = -1;
  for (let k = amostras.length - 1; k >= 0; k--) if (amostras[k].t === amostras[k].t) { i1 = k; break; }
  if (i0 < 0 || i1 - i0 < 2) return null;
  const trecho = amostras.slice(i0, i1 + 1);
  const a = trecho[0].q, b = trecho[trecho.length - 1].q;
  return {
    nome, a, b,
    s: trecho.map((x) => dist(a, x.q)),
    terreno: trecho.map((x) => x.t),
    projeto: trecho.map((x) => x.z),
  };
}

export function fmtN(v: number, casas: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
