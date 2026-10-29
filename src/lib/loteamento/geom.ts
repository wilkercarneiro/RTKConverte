// Geometria plana do loteamento.
//
// Tudo aqui trabalha no PLANO DE PROJETO (metros, origem no centro da gleba —
// ver `plano.ts`). As operações booleanas e os buffers vão pelo clipper-lib, em
// inteiros de milímetro: é o que torna a união de ruas, a subtração das quadras
// e o recorte dos lotes robustos em polígono côncavo e com furo, onde as
// fórmulas fechadas erram calado.
//
// Convenção: anel externo no sentido ANTI-HORÁRIO (área positiva), furo no
// horário. O interior fica sempre à ESQUERDA de cada aresta do anel externo —
// a classificação de aresta (`normalExterna`) depende disso.
import ClipperLib from "clipper-lib";

export type Pt = [number, number];
export type Anel = Pt[];
/** Polígono com furos. `ext` anti-horário; `furos` horários. */
export interface Poligono { ext: Anel; furos: Anel[] }

/** Clipper trabalha em inteiros: 1 unidade = 0,1 mm (área do lote 10 × 25 sai 250,00 e não 249,98). */
const ESC = 10000;
const GRANDE = 1e6; // 1.000 km: maior que qualquer gleba

interface IntPt { X: number; Y: number }
type Path = IntPt[];

// ---------------------------------------------------------------------------
// Medidas básicas
// ---------------------------------------------------------------------------

export const dist = (a: Pt, b: Pt): number => Math.hypot(b[0] - a[0], b[1] - a[1]);
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const soma = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const mult = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const dot = (a: Pt, b: Pt): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Pt, b: Pt): number => a[0] * b[1] - a[1] * b[0];
export const unit = (a: Pt): Pt => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
/** Vetor girado 90° no sentido anti-horário (normal à esquerda). */
export const esquerda = (a: Pt): Pt => [-a[1], a[0]];
export const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function areaAssinada(anel: Anel): number {
  let s = 0;
  for (let i = 0, n = anel.length; i < n; i++) {
    const a = anel[i], b = anel[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

export const areaPol = (p: Poligono): number =>
  Math.abs(areaAssinada(p.ext)) - p.furos.reduce((s, f) => s + Math.abs(areaAssinada(f)), 0);

export const areaPols = (ps: Poligono[]): number => ps.reduce((s, p) => s + areaPol(p), 0);

export function perimetro(anel: Anel): number {
  let s = 0;
  for (let i = 0; i < anel.length; i++) s += dist(anel[i], anel[(i + 1) % anel.length]);
  return s;
}

export function centroide(anel: Anel): Pt {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, n = anel.length; i < n; i++) {
    const p = anel[i], q = anel[(i + 1) % n];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const m = anel.reduce((s, p) => soma(s, p), [0, 0] as Pt);
    return mult(m, 1 / Math.max(1, anel.length));
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function antiHorario(anel: Anel): Anel {
  return areaAssinada(anel) < 0 ? [...anel].reverse() : anel;
}

export function caixa(pts: Pt[]): { min: Pt; max: Pt } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { min: [x0, y0], max: [x1, y1] };
}

/** Ponto dentro do anel (regra par-ímpar). */
export function dentroAnel(p: Pt, anel: Anel): boolean {
  let dentro = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const [xi, yi] = anel[i], [xj, yj] = anel[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

export const dentroPol = (p: Pt, pol: Poligono): boolean =>
  dentroAnel(p, pol.ext) && !pol.furos.some((f) => dentroAnel(p, f));

/** Distância de p ao segmento ab e o parâmetro t (0..1) do ponto mais próximo. */
export function distSegmento(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { d: dist(p, lerp(a, b, t)), t };
}

/** Distância de `p` à reta (infinita) por `a` e `b`; com `a` ≈ `b`, até `a`. */
export function distReta(p: Pt, a: Pt, b: Pt): number {
  const l = dist(a, b);
  return l < 1e-9 ? dist(p, a) : Math.abs(cross(sub(b, a), sub(p, a))) / l;
}

export function distPolilinha(p: Pt, linha: Pt[]): number {
  let m = Infinity;
  for (let i = 0; i + 1 < linha.length; i++) m = Math.min(m, distSegmento(p, linha[i], linha[i + 1]).d);
  return m;
}

export function distAnel(p: Pt, anel: Anel): number {
  let m = Infinity;
  for (let i = 0; i < anel.length; i++) m = Math.min(m, distSegmento(p, anel[i], anel[(i + 1) % anel.length]).d);
  return m;
}

/** Interseção de duas retas (p + t·r) e (q + u·s). null se paralelas. */
export function intersecaoRetas(p: Pt, r: Pt, q: Pt, s: Pt): { t: number; u: number; pt: Pt } | null {
  const rxs = cross(r, s);
  if (Math.abs(rxs) < 1e-12) return null;
  const qp = sub(q, p);
  const t = cross(qp, s) / rxs;
  const u = cross(qp, r) / rxs;
  return { t, u, pt: soma(p, mult(r, t)) };
}

/** Comprimento de uma polilinha. */
export function comprimento(linha: Pt[]): number {
  let s = 0;
  for (let i = 0; i + 1 < linha.length; i++) s += dist(linha[i], linha[i + 1]);
  return s;
}

/** Ponto a uma distância `s` ao longo da polilinha, com a direção do trecho. */
export function pontoNaPolilinha(linha: Pt[], s: number): { pt: Pt; dir: Pt } {
  let acc = 0;
  for (let i = 0; i + 1 < linha.length; i++) {
    const l = dist(linha[i], linha[i + 1]);
    if (acc + l >= s || i + 2 === linha.length) {
      const t = l < 1e-9 ? 0 : Math.max(0, Math.min(1, (s - acc) / l));
      return { pt: lerp(linha[i], linha[i + 1], t), dir: unit(sub(linha[i + 1], linha[i])) };
    }
    acc += l;
  }
  return { pt: linha[0], dir: [1, 0] };
}

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------

/**
 * Tira pontos repetidos e colineares (desvio < `tol` metros). O clipper deixa
 * vértice no meio de aresta reta onde dois recortes se encontraram; numa
 * planta isso vira um "ponto" sem razão de ser e, na locação, um piquete inútil.
 */
export function limparAnel(anel: Anel, tol = 0.002): Anel {
  let pts = anel.slice();
  let mudou = true;
  while (mudou && pts.length > 3) {
    mudou = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (dist(a, b) < tol || distSegmento(b, a, c).d < tol) { pts.splice(i, 1); mudou = true; i--; }
    }
  }
  return pts;
}

/**
 * Tira o "bico" de largura zero que o clipper às vezes deixa: o anel vai pela
 * reta além de `c` e volta por ela (a → b → c, `b` no prolongamento). No plano
 * a área é nula e `limparAnel` não o vê (`b` fica fora do segmento a–c), mas em
 * grau a reta vira curva, ida e volta se cruzam e o SICAR recusa (erro 3001).
 */
export function tirarBicos(anel: Anel, tol = 0.002): Anel {
  let pts = anel.slice();
  let mudou = true;
  while (mudou && pts.length > 3) {
    mudou = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      if (dot(sub(b, a), sub(c, b)) < 0 && distReta(b, a, c) < tol) { pts.splice(i, 1); mudou = true; i--; }
    }
  }
  return limparAnel(pts, tol);
}

// ---------------------------------------------------------------------------
// Clipper
// ---------------------------------------------------------------------------

const paraPath = (anel: Anel): Path => anel.map(([x, y]) => ({ X: Math.round(x * ESC), Y: Math.round(y * ESC) }));
const doPath = (p: Path): Anel => p.map((q) => [q.X / ESC, q.Y / ESC] as Pt);

function paths(pols: Poligono[]): Path[] {
  const out: Path[] = [];
  for (const p of pols) {
    out.push(paraPath(antiHorario(p.ext)));
    for (const f of p.furos) out.push(paraPath(antiHorario(f).reverse()));
  }
  return out;
}

/** PolyTree → polígonos com furos (ilhas dentro de furos viram polígonos próprios). */
function daArvore(tree: { Childs(): unknown[] }): Poligono[] {
  const out: Poligono[] = [];
  type Node = { Contour(): Path; IsHole(): boolean; Childs(): Node[] };
  const visitar = (n: Node) => {
    const ext = limparAnel(antiHorario(doPath(n.Contour())));
    const furos: Anel[] = [];
    for (const h of n.Childs()) {
      const f = limparAnel(doPath(h.Contour()));
      if (f.length >= 3 && Math.abs(areaAssinada(f)) > 1e-4) furos.push(areaAssinada(f) > 0 ? f.reverse() : f);
      for (const ilha of h.Childs()) visitar(ilha);
    }
    if (ext.length >= 3 && areaAssinada(ext) > 1e-4) out.push({ ext, furos });
  };
  for (const n of tree.Childs() as Node[]) visitar(n);
  return out;
}

function booleana(tipo: number, a: Poligono[], b: Poligono[]): Poligono[] {
  const c = new ClipperLib.Clipper();
  // sem isto, duas quadras que se tocam num ponto só (rua passando exatamente
  // sobre um vértice da gleba) voltam como UM polígono "beliscado"
  c.StrictlySimple = true;
  c.AddPaths(paths(a), ClipperLib.PolyType.ptSubject, true);
  if (b.length) c.AddPaths(paths(b), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(tipo, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return daArvore(tree);
}

export const uniao = (a: Poligono[], b: Poligono[] = []): Poligono[] => booleana(ClipperLib.ClipType.ctUnion, a, b);
export const diferenca = (a: Poligono[], b: Poligono[]): Poligono[] =>
  b.length ? booleana(ClipperLib.ClipType.ctDifference, a, b) : booleana(ClipperLib.ClipType.ctUnion, a, []);
export const intersecao = (a: Poligono[], b: Poligono[]): Poligono[] => booleana(ClipperLib.ClipType.ctIntersection, a, b);

/**
 * Faixa de largura total `largura` ao redor de uma polilinha aberta (rua pelo
 * eixo, APP pela margem). Pontas retas no fim do eixo; dobras em esquadria.
 * "redonda" arredonda pontas e dobras: é a faixa à distância fixa da linha
 * (APP de rio do CAR), que numa curva não pode ganhar o bico da esquadria.
 */
export function bufferLinha(linha: Pt[], largura: number, pontas: "reta" | "quadrada" | "redonda" = "reta"): Poligono[] {
  if (linha.length < 2 || largura <= 0) return [];
  const co = new ClipperLib.ClipperOffset(4, 0.01 * ESC);
  co.AddPath(paraPath(linha), pontas === "redonda" ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter,
    pontas === "reta" ? ClipperLib.EndType.etOpenButt
      : pontas === "quadrada" ? ClipperLib.EndType.etOpenSquare : ClipperLib.EndType.etOpenRound);
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, (largura / 2) * ESC);
  return daArvore(tree);
}

/** Recuo (negativo) ou afastamento (positivo) de polígonos fechados. */
/**
 * União que fecha frestas: lotes vizinhos cortados em passos diferentes podem
 * ficar com a divisa comum separada por frações de milímetro, e a união
 * simples devolve os dois de novo. Expande 5 mm, une e contrai de volta.
 */
export function uniaoFechada(pols: Poligono[], folga = 0.005): Poligono[] {
  return offsetPols(uniao(offsetPols(pols, folga)), -folga);
}

export function offsetPols(pols: Poligono[], delta: number, juncao: "reta" | "redonda" = "reta"): Poligono[] {
  if (!pols.length) return [];
  const co = new ClipperLib.ClipperOffset(4, 0.01 * ESC);
  co.AddPaths(paths(pols), juncao === "redonda" ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter,
    ClipperLib.EndType.etClosedPolygon);
  const tree = new ClipperLib.PolyTree();
  co.Execute(tree, delta * ESC);
  return daArvore(tree);
}

export function circulo(c: Pt, r: number, lados = 32): Poligono {
  const ext: Anel = [];
  for (let i = 0; i < lados; i++) {
    const a = (2 * Math.PI * i) / lados;
    ext.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
  }
  return { ext, furos: [] };
}

/**
 * Faixa entre duas retas paralelas, num referencial girado: tudo cujo
 * `dot(p - origem, eixo)` está em [a, b]. Com a/b infinitos vira meio-plano.
 * É o "cortador" dos lotes e das fileiras.
 */
export function faixaReferencial(origem: Pt, u: Pt, v: Pt, uMin: number, uMax: number, vMin: number, vMax: number): Poligono {
  const cl = (x: number) => Math.max(-GRANDE, Math.min(GRANDE, x));
  const a = cl(uMin), b = cl(uMax), c = cl(vMin), d = cl(vMax);
  const p = (s: number, t: number): Pt => soma(origem, soma(mult(u, s), mult(v, t)));
  return { ext: antiHorario([p(a, c), p(b, c), p(b, d), p(a, d)]), furos: [] };
}

// ---------------------------------------------------------------------------
// Área de corte (rápida, sem clipper)
// ---------------------------------------------------------------------------

/**
 * Área da parte do anel com `dot(p - o, u) <= s` (Sutherland–Hodgman contra um
 * meio-plano). Vale para anel côncavo: o recorte por UM meio-plano pode deixar
 * arestas de largura zero, mas a área sai certa. É o que a divisão por área usa
 * dezenas de vezes por lote — o clipper ali custaria caro.
 */
export function areaAteCorte(anel: Anel, o: Pt, u: Pt, s: number): number {
  const out: Pt[] = [];
  const f = (p: Pt) => dot(sub(p, o), u) - s;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    const fa = f(a), fb = f(b);
    if (fa <= 0) out.push(a);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) out.push(lerp(a, b, fa / (fa - fb)));
  }
  return out.length >= 3 ? Math.abs(areaAssinada(out)) : 0;
}

export const areaPolAteCorte = (p: Poligono, o: Pt, u: Pt, s: number): number =>
  areaAteCorte(p.ext, o, u, s) - p.furos.reduce((acc, f) => acc + areaAteCorte(f, o, u, s), 0);

/** Recorta uma polilinha pelo interior de um polígono (para eixo de rua). */
export function recortarLinha(linha: Pt[], pol: Poligono): Pt[][] {
  const c = new ClipperLib.Clipper();
  c.AddPath(paraPath(linha), ClipperLib.PolyType.ptSubject, false);
  c.AddPaths(paths([pol]), ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctIntersection, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  const abertos = ClipperLib.Clipper.OpenPathsFromPolyTree(tree) as Path[];
  return abertos.map(doPath).filter((l) => l.length >= 2);
}

/**
 * Área verde de verdade: cabe um círculo de 10 m de raio em qualquer ponto
 * dela (Lei 9.413/81 de SP, art. 2º, IV, b — o critério que exclui nesga e
 * faixa estreita). Medido pela abertura: encolhe 10 m e expande de volta; o
 * que volta tem de cobrir quase toda a área.
 */
export function verdeValida(pols: Poligono[], raio = 10): boolean {
  const a = pols.reduce((s2, x) => s2 + areaPol(x), 0);
  if (a < Math.PI * raio * raio) return false;
  const ab = offsetPols(offsetPols(pols, -raio), raio, "redonda");
  return ab.reduce((s2, x) => s2 + areaPol(x), 0) >= 0.7 * a;
}


// ---------------------------------------------------------------------------
// Quinas do lote
// ---------------------------------------------------------------------------

/** Giro (graus, com sinal) no vértice i do anel. */
export function giroEm(anel: Anel, i: number): number {
  const n = anel.length;
  const a = anel[(i + n - 1) % n], q = anel[i], c = anel[(i + 1) % n];
  const u = sub(q, a), v = sub(c, q);
  if (Math.hypot(u[0], u[1]) < 1e-9 || Math.hypot(v[0], v[1]) < 1e-9) return 0;
  return (Math.atan2(cross(u, v), dot(u, v)) * 180) / Math.PI;
}

/**
 * Quinas do lote — o canto que o comprador enxerga: giro de 12° ou mais. O
 * arco da esquina (vários lados curtos seguidos) conta como UMA quina. O
 * cliente pede no máximo 4; lote de ponta pode ter 3.
 */
export function quinasDe(anel: Anel, curto = 2, giroMin = 12): number[] {
  const n = anel.length;
  if (n < 3) return [];
  let k0 = -1;
  for (let i = 0; i < n; i++) if (dist(anel[i], anel[(i + 1) % n]) >= curto) { k0 = (i + 1) % n; break; }
  if (k0 < 0) return [];
  const out: number[] = [];
  let acc = 0, maior = -1, gMaior = 0;
  for (let s = 0; s < n; s++) {
    const i = (k0 + s) % n;
    const g = giroEm(anel, i);
    acc += g;
    if (Math.abs(g) > gMaior) { gMaior = Math.abs(g); maior = i; }
    if (dist(anel[i], anel[(i + 1) % n]) >= curto) {
      if (Math.abs(acc) >= giroMin) out.push(maior);
      acc = 0; maior = -1; gMaior = 0;
    }
  }
  return out;
}

export const quinas = (anel: Anel): number => quinasDe(anel).length;
