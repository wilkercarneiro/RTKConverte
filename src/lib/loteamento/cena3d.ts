// Maquete 3D do loteamento — os dados da cena, sem three.js (roda e testa em node).
//
// Como no Civil 3D/InfraWorks: o terreno natural vem do modelo digital de
// elevação calibrado pelo GNSS (projeto.terreno), as ruas ganham greide
// (o terreno suavizado ao longo delas, com talude de 1:1,5 até encontrar o
// natural) e a diferença entre os dois é o corte/aterro. Por cima vão as
// casas da simulação de ocupação (recuos típicos, assentadas no ponto alto do
// lote), as árvores das áreas verdes, da APP e das calçadas e o meio-fio.
//
// Tudo no plano do desenho (metros; x leste, y norte). As cotas são as reais:
// o exagero vertical é só da visualização.
import {
  antiHorario, areaPol, caixa, centroide, dentroPol, diferenca, dist, distAnel, dot, esquerda, intersecao,
  lerp, offsetPols, pontoNaPolilinha, comprimento, sub, uniao, unit,
} from "./geom.ts";
import type { Poligono, Pt } from "./geom.ts";
import type { Lote, Resultado } from "./calculo.ts";
import type { Parametros } from "./modelo.ts";
import type { GradeTerreno } from "./terreno.ts";
import { paraUtm } from "./plano.ts";

export interface Grade3D {
  /** canto sudoeste (plano) e espaçamento dos nós */
  x0: number;
  y0: number;
  passo: number;
  nx: number;
  ny: number;
  /** cota do terreno natural em cada nó */
  natural: Float32Array;
  /** cota do terreno projetado (ruas no greide, taludes) */
  final: Float32Array;
  /** declividade do terreno natural (%) */
  decl: Float32Array;
  /** 1 = rua (dentro da caixa da rua) */
  rua: Uint8Array;
  /** 1 = dentro da gleba */
  gleba: Uint8Array;
  /** índice do lote em res.lotes (-1 = nenhum) */
  lote: Int32Array;
}

export interface Casa {
  lote: number;
  /** centro da planta da casa, direção da frente (u) e medidas */
  c: Pt;
  u: Pt;
  larg: number;
  prof: number;
  /** piso (ponto alto do terreno sob a casa) e fundo da fundação */
  piso: number;
  fundacao: number;
  andares: number;
  telhado: "duas" | "quatro" | "laje";
  corParede: number;
  corTelhado: number;
}

export interface Arvore {
  p: Pt;
  z: number;
  altura: number;
  copa: number;
  /** 0 copa redonda, 1 cônica, 2 ipê florido */
  tipo: 0 | 1 | 2;
  cor: number;
}

/** Poste de iluminação na calçada: o braço aponta para a rua (`dir`). */
export interface Poste {
  p: Pt;
  z: number;
  dir: Pt;
}

export interface InfoLote {
  declMedia: number;
  declMax: number;
  cotaMin: number;
  cotaMax: number;
}

export interface Cena {
  grade: Grade3D;
  casas: Casa[];
  arvores: Arvore[];
  /** pista de rolamento (o resto da caixa da rua é calçada) */
  pista: Poligono[];
  /** caixa das ruas (pista + calçadas) */
  ruas: Poligono[];
  /** linhas do meio-fio (beira da pista), densificadas a cada ~2 m */
  meioFio: Pt[][];
  postes: Poste[];
  /** largura da pista de rolamento (m) — mão de direção dos carros */
  larguraPista: number;
  volumes: { corte: number; aterro: number };
  infoLotes: InfoLote[];
  cotaMin: number;
  cotaMax: number;
  /** centro e raio da gleba (câmera) */
  centro: Pt;
  raio: number;
}

export interface OpcoesCena {
  /** células da grade (limite de memória/GPU) */
  maxCelulas?: number;
  margem?: number;
}

// ---------------------------------------------------------------------------
// Sorteio repetível (a mesma casa sai sempre igual no mesmo lote)
// ---------------------------------------------------------------------------

function sorteio(semente: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < semente.length; i++) { h ^= semente.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Terreno natural: o modelo de elevação (UTM) com interpolação bicúbica — a
// bilinear entre nós de 8 m deixa vincos que aparecem na maquete
// ---------------------------------------------------------------------------

export function cotaNatural(res: Resultado, terreno: GradeTerreno | null | undefined): (p: Pt) => number {
  if (!terreno) return () => 0;
  const g = terreno;
  const v = (i: number, j: number) => g.h[Math.max(0, Math.min(g.ny - 1, j)) * g.nx + Math.max(0, Math.min(g.nx - 1, i))];
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
  return (p: Pt) => {
    const u = paraUtm(res.plano, p);
    const x = Math.max(0, Math.min(g.nx - 1.001, (u[0] - g.e0) / g.passo));
    const y = Math.max(0, Math.min(g.ny - 1.001, (u[1] - g.n0) / g.passo));
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const linha = (jj: number) => cr(v(i - 1, jj), v(i, jj), v(i + 1, jj), v(i + 2, jj), fx);
    return cr(linha(j - 1), linha(j), linha(j + 1), linha(j + 2), fy);
  };
}

// ---------------------------------------------------------------------------
// Grade: rasterização e suavização
// ---------------------------------------------------------------------------

/** Nós da grade dentro dos polígonos (par-ímpar, com furos): chama `f(índice)`. */
export function rasterizar(g: Pick<Grade3D, "x0" | "y0" | "passo" | "nx" | "ny">, pols: Poligono[], f: (k: number) => void): void {
  const aneis = pols.flatMap((p) => [p.ext, ...p.furos]).filter((a) => a.length >= 3);
  if (!aneis.length) return;
  const todos = aneis.flat();
  const b = caixa(todos);
  const j0 = Math.max(0, Math.ceil((b.min[1] - g.y0) / g.passo)), j1 = Math.min(g.ny - 1, Math.floor((b.max[1] - g.y0) / g.passo));
  const xs: number[] = [];
  for (let j = j0; j <= j1; j++) {
    const y = g.y0 + j * g.passo;
    xs.length = 0;
    for (const a of aneis) for (let k = 0; k < a.length; k++) {
      const p = a[k], q = a[(k + 1) % a.length];
      if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.passo)), i1 = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / g.passo));
      for (let i = i0; i <= i1; i++) f(j * g.nx + i);
    }
  }
}

/** Média móvel separável (3 passadas ≈ gaussiana). */
function borrar(a: Float32Array, nx: number, ny: number, r: number, passadas = 3): void {
  const tmp = new Float32Array(Math.max(nx, ny));
  for (let s = 0; s < passadas; s++) {
    for (let j = 0; j < ny; j++) {
      let acc = 0;
      const o = j * nx;
      for (let i = -r; i <= r; i++) acc += a[o + Math.max(0, Math.min(nx - 1, i))];
      for (let i = 0; i < nx; i++) {
        tmp[i] = acc / (2 * r + 1);
        acc += a[o + Math.min(nx - 1, i + r + 1)] - a[o + Math.max(0, i - r)];
      }
      for (let i = 0; i < nx; i++) a[o + i] = tmp[i];
    }
    for (let i = 0; i < nx; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += a[Math.max(0, Math.min(ny - 1, j)) * nx + i];
      for (let j = 0; j < ny; j++) {
        tmp[j] = acc / (2 * r + 1);
        acc += a[Math.min(ny - 1, j + r + 1) * nx + i] - a[Math.max(0, j - r) * nx + i];
      }
      for (let j = 0; j < ny; j++) a[j * nx + i] = tmp[j];
    }
  }
}

/** Distância (m) até a máscara, por chanfro 3-4 (duas passadas). */
function distanciaAte(m: Uint8Array, nx: number, ny: number, passo: number): Float32Array {
  const d = new Float32Array(nx * ny);
  const INF = 1e9;
  for (let k = 0; k < d.length; k++) d[k] = m[k] ? 0 : INF;
  const a = passo, b = passo * Math.SQRT2;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    let v = d[k];
    if (i > 0) v = Math.min(v, d[k - 1] + a);
    if (j > 0) {
      v = Math.min(v, d[k - nx] + a);
      if (i > 0) v = Math.min(v, d[k - nx - 1] + b);
      if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b);
    }
    d[k] = v;
  }
  for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
    const k = j * nx + i;
    let v = d[k];
    if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
    if (j < ny - 1) {
      v = Math.min(v, d[k + nx] + a);
      if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b);
      if (i > 0) v = Math.min(v, d[k + nx - 1] + b);
    }
    d[k] = v;
  }
  return d;
}

/** Cota do terreno projetado num ponto qualquer (bilinear na grade). */
export function cotaFinal(g: Grade3D, p: Pt, campo: "final" | "natural" = "final"): number {
  const h = g[campo];
  const x = Math.max(0, Math.min(g.nx - 1.0001, (p[0] - g.x0) / g.passo));
  const y = Math.max(0, Math.min(g.ny - 1.0001, (p[1] - g.y0) / g.passo));
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const k = j * g.nx + i;
  return h[k] * (1 - fx) * (1 - fy) + h[k + 1] * fx * (1 - fy) + h[k + g.nx] * (1 - fx) * fy + h[k + g.nx + 1] * fx * fy;
}

/** Índice do lote no ponto (plano), ou -1. */
export function loteNoPonto(res: Resultado, g: Grade3D, p: Pt): number {
  const i = Math.round((p[0] - g.x0) / g.passo), j = Math.round((p[1] - g.y0) / g.passo);
  if (i >= 0 && j >= 0 && i < g.nx && j < g.ny) {
    const k = g.lote[j * g.nx + i];
    if (k >= 0 && dentroPol(p, res.lotes[k].pol)) return k;
  }
  // perto da divisa o nó pode ser do vizinho: confere pelo polígono
  for (let k = 0; k < res.lotes.length; k++) if (dentroPol(p, res.lotes[k].pol)) return k;
  return -1;
}

// ---------------------------------------------------------------------------
// A cena
// ---------------------------------------------------------------------------

/** Margem da maquete em volta da gleba (m): mostra a vizinhança no satélite. */
export function margemDaCena(res: Resultado): number {
  const gb = caixa(res.gleba.ext);
  return Math.max(40, Math.min(220, 0.3 * Math.max(gb.max[0] - gb.min[0], gb.max[1] - gb.min[1])));
}

/** Cantos da maquete (plano), para buscar o relevo que cobre também a margem. */
export function cantosDaCena(res: Resultado): Pt[] {
  const gb = caixa(res.gleba.ext), m = margemDaCena(res);
  return [[gb.min[0] - m, gb.min[1] - m], [gb.max[0] + m, gb.min[1] - m], [gb.max[0] + m, gb.max[1] + m], [gb.min[0] - m, gb.max[1] + m]];
}

export function montarCena(res: Resultado, params: Parametros, terreno: GradeTerreno | null | undefined, op: OpcoesCena = {}): Cena {
  const gb = caixa(res.gleba.ext);
  const larg = gb.max[0] - gb.min[0], alt = gb.max[1] - gb.min[1];
  const margem = op.margem ?? margemDaCena(res);
  const W = larg + 2 * margem, H = alt + 2 * margem;
  const maxCel = op.maxCelulas ?? 300_000;
  const passo = Math.max(0.75, Math.ceil((Math.sqrt((W * H) / maxCel)) * 4) / 4);
  const nx = Math.ceil(W / passo) + 1, ny = Math.ceil(H / passo) + 1;
  const x0 = gb.min[0] - margem, y0 = gb.min[1] - margem;
  const n = nx * ny;
  const g: Grade3D = {
    x0, y0, passo, nx, ny,
    natural: new Float32Array(n), final: new Float32Array(n), decl: new Float32Array(n),
    rua: new Uint8Array(n), gleba: new Uint8Array(n), lote: new Int32Array(n).fill(-1),
  };

  // terreno natural
  const cota = cotaNatural(res, terreno);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) g.natural[j * nx + i] = cota([x0 + i * passo, y0 + j * passo]);
  // declividade (%) pela diferença central
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    const ia = Math.max(0, i - 1), ib = Math.min(nx - 1, i + 1), ja = Math.max(0, j - 1), jb = Math.min(ny - 1, j + 1);
    const dx = (g.natural[j * nx + ib] - g.natural[j * nx + ia]) / ((ib - ia) * passo);
    const dy = (g.natural[jb * nx + i] - g.natural[ja * nx + i]) / ((jb - ja) * passo);
    g.decl[k] = 100 * Math.hypot(dx, dy);
  }

  rasterizar(g, [res.gleba], (k) => { g.gleba[k] = 1; });
  const caixaRuas = uniao(res.ruas.flatMap((r) => r.pols));
  rasterizar(g, caixaRuas, (k) => { g.rua[k] = 1; });
  res.lotes.forEach((l, idx) => rasterizar(g, [l.pol], (k) => { g.lote[k] = idx; }));

  // greide das ruas: o terreno suavizado SÓ com os nós da rua (convolução
  // normalizada — o cruzamento sai contínuo, sem degrau entre as ruas)
  g.final.set(g.natural);
  let corte = 0, aterro = 0;
  if (res.ruas.length) {
    const A = new Float32Array(n), B = new Float32Array(n);
    for (let k = 0; k < n; k++) if (g.rua[k]) { A[k] = g.natural[k]; B[k] = 1; }
    const r = Math.max(1, Math.round(9 / passo));
    borrar(A, nx, ny, r);
    borrar(B, nx, ny, r);
    const d = distanciaAte(g.rua, nx, ny, passo);
    for (let k = 0; k < n; k++) {
      if (!g.gleba[k] || B[k] < 1e-3) continue;
      const greide = A[k] / B[k];
      if (g.rua[k]) { g.final[k] = greide; continue; }
      // talude 1:1,5 (H:V) até encontrar o terreno natural
      const dh = greide - g.natural[k];
      const w = Math.min(15, Math.max(0.5, Math.abs(dh) * 1.5));
      if (d[k] >= w) continue;
      const t = d[k] / w, s = t * t * (3 - 2 * t);
      g.final[k] = greide + (g.natural[k] - greide) * s;
    }
    const a2 = passo * passo;
    for (let k = 0; k < n; k++) {
      const dz = g.final[k] - g.natural[k];
      if (dz > 0) aterro += dz * a2; else corte -= dz * a2;
    }
  }

  // estatística de cada lote (cota real, declividade do terreno natural)
  const infoLotes: InfoLote[] = res.lotes.map(() => ({ declMedia: 0, declMax: 0, cotaMin: Infinity, cotaMax: -Infinity }));
  const conta = new Int32Array(res.lotes.length);
  for (let k = 0; k < n; k++) {
    const l = g.lote[k];
    if (l < 0) continue;
    const inf = infoLotes[l];
    inf.declMedia += g.decl[k];
    inf.declMax = Math.max(inf.declMax, g.decl[k]);
    inf.cotaMin = Math.min(inf.cotaMin, g.natural[k]);
    inf.cotaMax = Math.max(inf.cotaMax, g.natural[k]);
    conta[l]++;
  }
  infoLotes.forEach((inf, i) => {
    if (conta[i]) { inf.declMedia /= conta[i]; return; }
    // lote menor que a grade: mede no centro
    const c = centroide(res.lotes[i].pol.ext);
    const h = cotaFinal(g, c, "natural");
    Object.assign(inf, { declMedia: 0, declMax: 0, cotaMin: h, cotaMax: h });
  });

  // pista e meio-fio: a caixa da rua menos as calçadas (o recuo da caixa
  // inteira, que passa da gleba, para a rua que segue não ganhar meio-fio na divisa)
  const calcada = Math.max(0, (params.ruaLargura - params.ruaPista) / 2);
  const corpo = uniao(res.ruas.flatMap((r) => [...r.corpo, ...r.pols]));
  const pista = calcada > 0.3 ? intersecao(offsetPols(offsetPols(offsetPols(corpo, -calcada), 2.5, "redonda"), -2.5, "redonda"), caixaRuas) : caixaRuas;
  const meioFio: Pt[][] = [];
  for (const pg of pista) for (const anel of [pg.ext, ...pg.furos]) {
    let atual: Pt[] = [];
    for (let k = 0; k <= anel.length; k++) {
      const a = anel[k % anel.length], b = anel[(k + 1) % anel.length];
      if (k === anel.length) break;
      // trecho em cima da divisa da gleba: a rua continua lá fora, sem meio-fio
      const naDivisa = distAnel(a, res.gleba.ext) < 0.4 && distAnel(b, res.gleba.ext) < 0.4;
      if (naDivisa) { if (atual.length > 1) meioFio.push(atual); atual = []; continue; }
      const L = dist(a, b), m = Math.max(1, Math.ceil(L / 2));
      if (!atual.length) atual.push(a);
      for (let s = 1; s <= m; s++) atual.push(lerp(a, b, s / m));
    }
    if (atual.length > 1) meioFio.push(atual);
  }

  const casas = [...montarCasas(res, g), ...montarEquipamentos(res, g)];
  const arvores = montarArvores(res, g, pista, calcada);
  const postes = montarPostes(res, g, pista, calcada, arvores);

  let cotaMin = Infinity, cotaMax = -Infinity;
  for (let k = 0; k < n; k++) { cotaMin = Math.min(cotaMin, g.final[k]); cotaMax = Math.max(cotaMax, g.final[k]); }
  const centro: Pt = [(gb.min[0] + gb.max[0]) / 2, (gb.min[1] + gb.max[1]) / 2];
  return {
    grade: g, casas, arvores, pista, ruas: caixaRuas, meioFio, postes, larguraPista: Math.max(4, params.ruaPista), volumes: { corte, aterro }, infoLotes,
    cotaMin, cotaMax, centro, raio: Math.hypot(larg, alt) / 2,
  };
}

// ---------------------------------------------------------------------------
// Simulação de ocupação: uma casa por lote, de frente para a rua
// ---------------------------------------------------------------------------

const PAREDES = [0xf4efe6, 0xeee4d3, 0xe9e2d6, 0xf2e8dc, 0xdfe3e6, 0xf6f1e9, 0xe8d5bd, 0xd9cbb4, 0xc9d3cf, 0xefd9c4];
const TELHAS = [0x9c4a2f, 0xa65535, 0x8a3f28, 0xb36540, 0x5b5f66, 0x4a4e55, 0x7d3a26];

/** Frente do lote para orientar a casa: a frente escolhida, senão a rua mais longa. */
function frenteDaCasa(l: Lote): { a: Pt; b: Pt } | null {
  const principal = l.lados.filter((x) => x.principal);
  const cands = (principal.length ? principal : l.lados.filter((x) => (x.tipo === "rua" || x.tipo === "via") && x.comp >= 3));
  if (!cands.length) return null;
  return cands.reduce((m, x) => (x.comp > m.comp ? x : m), cands[0]);
}

function montarCasas(res: Resultado, g: Grade3D): Casa[] {
  const out: Casa[] = [];
  res.lotes.forEach((l, idx) => {
    if (l.area < 90) return;
    const fr = frenteDaCasa(l);
    if (!fr) return;
    const rnd = sorteio(l.id);
    const u = unit(sub(fr.b, fr.a));
    const c0 = centroide(l.pol.ext);
    let v = esquerda(u);
    if (dot(sub(c0, fr.a), v) < 0) v = [-v[0], -v[1]];
    const Lf = dist(fr.a, fr.b);
    // fundo do lote a partir da frente (pelo meio da testada)
    const prof = Math.max(...l.pol.ext.map((p) => dot(sub(p, fr.a), v)));
    const dentro = offsetPols([{ ext: antiHorario(l.pol.ext), furos: [] }], -1.2);
    if (!dentro.length) return;
    const cabe = (q: Pt) => dentro.some((pg) => dentroPol(q, pg));
    let larg = Math.min(12.5, Math.max(5.5, (Math.min(Lf, 16) - 3) * (0.78 + 0.17 * rnd())));
    let fundo = Math.min(15, Math.max(6, (prof - 4 - 2.5) * (0.55 + 0.25 * rnd())));
    const recuo = 4 + rnd() * 1.2;
    const meio = lerp(fr.a, fr.b, 0.5);
    // fachada paralela à rua; no lote em leque, se não couber, alinhada com o eixo do lote
    const eixo = unit(sub(c0, meio));
    let ue = esquerda(eixo);
    if (dot(ue, u) < 0) ue = [-ue[0], -ue[1]];
    const quadros: [Pt, Pt][] = [[u, v], [ue, eixo]];
    const andares = rnd() < 0.24 ? 2 : 1, telhado = rnd() < 0.6 ? "quatro" as const : "duas" as const;
    const corParede = PAREDES[Math.floor(rnd() * PAREDES.length)], corTelhado = TELHAS[Math.floor(rnd() * TELHAS.length)];
    for (let tent = 0; tent < 7; tent++) {
      for (const [U, V] of quadros) {
        // anda pela profundidade (do recuo para dentro) e desliza pela testada
        for (let t = recuo + fundo / 2; t <= prof - fundo / 2 && t <= recuo + fundo / 2 + 8; t += 1) {
          for (let s = 0; s <= Lf / 2; s += 0.75) for (const du of s ? [s, -s] : [0]) {
            const c: Pt = [meio[0] + V[0] * t + U[0] * du, meio[1] + V[1] * t + U[1] * du];
            const P = (a: number, b: number): Pt => [c[0] + U[0] * a + V[0] * b, c[1] + U[1] * a + V[1] * b];
            const cantos = [P(-larg / 2, -fundo / 2), P(larg / 2, -fundo / 2), P(larg / 2, fundo / 2), P(-larg / 2, fundo / 2)];
            const pts = [...cantos, P(0, -fundo / 2), P(0, fundo / 2), P(-larg / 2, 0), P(larg / 2, 0)];
            // recuo frontal medido da rua, em todos os cantos
            if (cantos.some((p) => dot(sub(p, fr.a), v) < recuo - 0.01) || !pts.every(cabe)) continue;
            const hs = cantos.map((p) => cotaFinal(g, p));
            out.push({
              lote: idx, c, u: U, larg, prof: fundo,
              piso: Math.max(...hs) + 0.25, fundacao: Math.min(...hs) - 0.4,
              andares, telhado, corParede, corTelhado,
            });
            return;
          }
        }
      }
      larg *= 0.88;
      fundo *= 0.88;
      if (larg < 4.5 || fundo < 4.5) return;
    }
  });
  return out;
}

/**
 * Área institucional: um prédio público (escola, posto de saúde) de laje,
 * alinhado com o lado mais comprido da área, com folga de 5 m nas divisas.
 */
function montarEquipamentos(res: Resultado, g: Grade3D): Casa[] {
  const out: Casa[] = [];
  for (const a of res.areas) {
    if (a.tipo !== "institucional") continue;
    for (const pol of a.pols) {
      if (areaPol(pol) < 400) continue;
      const e = pol.ext;
      let u: Pt = [1, 0], maior = 0;
      for (let i = 0; i < e.length; i++) { const L = dist(e[i], e[(i + 1) % e.length]); if (L > maior) { maior = L; u = unit(sub(e[(i + 1) % e.length], e[i])); } }
      const v = esquerda(u);
      const dentro = offsetPols([{ ext: antiHorario(e), furos: [] }], -5);
      if (!dentro.length) continue;
      const cabe = (q: Pt) => dentro.some((pg) => dentroPol(q, pg));
      const c = centroide(e);
      let larg = Math.min(48, Math.sqrt(areaPol(pol)) * 0.62), prof = Math.min(26, larg * 0.5);
      for (let t = 0; t < 10 && larg > 10; t++, larg *= 0.88, prof *= 0.9) {
        const P = (x: number, y: number): Pt => [c[0] + u[0] * x + v[0] * y, c[1] + u[1] * x + v[1] * y];
        const cantos = [P(-larg / 2, -prof / 2), P(larg / 2, -prof / 2), P(larg / 2, prof / 2), P(-larg / 2, prof / 2)];
        if (!cantos.every(cabe)) continue;
        const hs = cantos.map((p) => cotaFinal(g, p));
        out.push({
          lote: -1, c, u, larg, prof, piso: Math.max(...hs) + 0.3, fundacao: Math.min(...hs) - 0.4,
          andares: 2, telhado: "laje", corParede: 0xf1efe9, corTelhado: 0x9aa3ab,
        });
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Árvores: áreas verdes e lazer (praça), APP (mata fechada), calçadas e quintais
// ---------------------------------------------------------------------------

const VERDES = [0x3f7d3a, 0x4a8a3f, 0x356f34, 0x5a9446, 0x2f6a35, 0x4f7f2e, 0x3c7446];

function montarArvores(res: Resultado, g: Grade3D, pista: Poligono[], calcada: number): Arvore[] {
  const out: Arvore[] = [];
  const LIMITE = 7000;
  const plantar = (p: Pt, rnd: () => number, escala: number, ipe = 0.04) => {
    if (out.length >= LIMITE) return;
    const flor = rnd() < ipe;
    out.push({
      p, z: cotaFinal(g, p), altura: (5 + rnd() * 5) * escala, copa: (2 + rnd() * 1.8) * escala,
      tipo: flor ? 2 : rnd() < 0.18 ? 1 : 0,
      cor: flor ? (rnd() < 0.6 ? 0xf2c230 : 0xc86fb4) : VERDES[Math.floor(rnd() * VERDES.length)],
    });
  };
  // áreas públicas: praça arborizada, APP como mata
  for (const a of res.areas) {
    if (a.tipo === "institucional") continue;
    const passo = a.tipo === "app" ? 4.2 : a.tipo === "lazer" ? 9 : 6.5;
    const rnd = sorteio(`area-${a.id}`);
    for (const pol of a.pols) {
      const b = caixa(pol.ext);
      for (let y = b.min[1] + passo / 2; y < b.max[1]; y += passo) for (let x = b.min[0] + passo / 2; x < b.max[0]; x += passo) {
        const p: Pt = [x + (rnd() - 0.5) * passo * 0.8, y + (rnd() - 0.5) * passo * 0.8];
        if (rnd() < (a.tipo === "app" ? 0.08 : 0.28) || !dentroPol(p, pol) || distAnel(p, pol.ext) < 1.2) continue;
        plantar(p, rnd, a.tipo === "app" ? 1.15 : 1, a.tipo === "app" ? 0.015 : 0.07);
      }
    }
  }
  // calçadas: uma árvore a cada ~14 m dos dois lados, longe dos cruzamentos
  if (calcada >= 1.4) {
    for (const r of res.ruas) {
      const rnd = sorteio(`rua-${r.id}`);
      const L = comprimento(r.eixo);
      const off = (r.largura / 2) - calcada * 0.45;
      for (let s = 6; s < L - 6; s += 14) {
        const { pt, dir } = pontoNaPolilinha(r.eixo, s);
        const nrm = esquerda(dir);
        for (const lado of [1, -1]) {
          const p: Pt = [pt[0] + nrm[0] * off * lado, pt[1] + nrm[1] * off * lado];
          const i = Math.round((p[0] - g.x0) / g.passo), j = Math.round((p[1] - g.y0) / g.passo);
          if (i < 0 || j < 0 || i >= g.nx || j >= g.ny || !g.rua[j * g.nx + i]) continue;
          if (pista.some((pg) => dentroPol(p, pg)) || pista.some((pg) => distAnel(p, pg.ext) < 0.5)) continue;
          if (rnd() < 0.15) continue;
          plantar(p, rnd, 0.75, 0.08);
        }
      }
    }
  }
  // quintal: uma árvore no fundo de parte dos lotes
  res.lotes.forEach((l) => {
    const rnd = sorteio(`quintal-${l.id}`);
    if (rnd() > 0.45 || l.area < 160) return;
    const dentro = offsetPols([{ ext: antiHorario(l.pol.ext), furos: [] }], -2);
    const fr = frenteDaCasa(l);
    if (!dentro.length || !fr) return;
    const u = unit(sub(fr.b, fr.a));
    const c0 = centroide(l.pol.ext);
    let v = esquerda(u);
    if (dot(sub(c0, fr.a), v) < 0) v = [-v[0], -v[1]];
    const prof = Math.max(...l.pol.ext.map((p) => dot(sub(p, fr.a), v)));
    const meio = lerp(fr.a, fr.b, 0.2 + 0.6 * rnd());
    const p: Pt = [meio[0] + v[0] * (prof - 2.5), meio[1] + v[1] * (prof - 2.5)];
    if (dentro.some((pg) => dentroPol(p, pg))) plantar(p, rnd, 0.7, 0.1);
  });
  return out;
}

/**
 * Iluminação pública: um poste a cada ~32 m, alternando os lados, na beira de
 * fora da calçada (longe das árvores e dos outros postes — o cruzamento não
 * ganha dois).
 */
function montarPostes(res: Resultado, g: Grade3D, pista: Poligono[], calcada: number, arvores: Arvore[]): Poste[] {
  const out: Poste[] = [];
  if (calcada < 1) return out;
  for (const r of res.ruas) {
    const L = comprimento(r.eixo);
    const off = r.largura / 2 - 0.35;
    let k = 0;
    for (let s = 12; s < L - 8; s += 32, k++) {
      const { pt, dir } = pontoNaPolilinha(r.eixo, s);
      const nrm = esquerda(dir);
      const lado = k % 2 ? 1 : -1;
      const p: Pt = [pt[0] + nrm[0] * off * lado, pt[1] + nrm[1] * off * lado];
      const i = Math.round((p[0] - g.x0) / g.passo), j = Math.round((p[1] - g.y0) / g.passo);
      if (i < 0 || j < 0 || i >= g.nx || j >= g.ny || !g.rua[j * g.nx + i]) continue;
      if (pista.some((pg) => dentroPol(p, pg))) continue;
      if (out.some((o) => dist(o.p, p) < 14) || arvores.some((a) => dist(a.p, p) < 2.5)) continue;
      out.push({ p, z: cotaFinal(g, p), dir: [-nrm[0] * lado, -nrm[1] * lado] });
    }
  }
  return out;
}

/** Área do lote que precisa de corte/aterro além do talude da rua (m²) — ficha do lote. */
export function areaComTalude(g: Grade3D, idx: number): number {
  let n = 0;
  for (let k = 0; k < g.lote.length; k++) if (g.lote[k] === idx && Math.abs(g.final[k] - g.natural[k]) > 0.05) n++;
  return n * g.passo * g.passo;
}

/** Diferença do projeto: o que sobra da gleba sem lote, rua nem área pública (para pintar de grama). */
export function livreDaGleba(res: Resultado): Poligono[] {
  const ocupado = [...res.lotes.map((l) => l.pol), ...res.ruas.flatMap((r) => r.pols), ...res.areas.flatMap((a) => a.pols)];
  return diferenca([res.gleba], ocupado).filter((p) => areaPol(p) > 1);
}
