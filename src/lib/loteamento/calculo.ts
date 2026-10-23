// O cálculo do loteamento: projeto (intenção) → quadras, lotes, áreas, quadro.
//
//   gleba − ruas − faixas (APP/non aedificandi) − áreas desenhadas = quadras
//   quadra → esquinas arredondadas/chanfradas → fileiras → lotes
//
// Cada passo é função pura do projeto. A tela chama `calcular` a cada mudança
// (dezenas de milissegundos num loteamento de centenas de lotes) e o gerador
// automático chama a mesma função para comparar propostas — não existe uma
// segunda definição de "lote válido" em lugar nenhum.
import {
  antiHorario, areaAssinada, areaPol, areaPolAteCorte, bufferLinha, caixa, centroide, circulo, cross, dentroPol,
  diferenca, dist, distSegmento, dot, esquerda, faixaReferencial, intersecao, lerp, limparAnel, mult, offsetPols, soma, sub,
  uniao, unit,
} from "./geom.ts";
import type { Anel, Poligono, Pt } from "./geom.ts";
import { criarPlano, paraPlano } from "./plano.ts";
import type { Plano } from "./plano.ts";
import { ROTULO_AREA } from "./modelo.ts";
import type { AjusteLote, ModoDivisao, Parametros, Projeto, QuadraCfg, Sobra, TipoArea, TipoBorda } from "./modelo.ts";

// ---------------------------------------------------------------------------
// Entrada e saída
// ---------------------------------------------------------------------------

export interface Perimetro {
  /** pontos do perímetro em UTM, na ordem do levantamento (sem repetir o 1º) */
  pts: Pt[];
  altitudes: number[];
  /** confrontante de cada lado (lado i: ponto i → i+1), para o memorial dos lotes da divisa */
  confrontantes: (string | null)[];
  /** nome/código de cada ponto (para a planta) */
  nomes?: string[];
}

export type TipoLado = "rua" | "via" | "divisa" | "area" | "faixa" | "lote" | "sobra";

export interface Lado {
  a: Pt;
  b: Pt;
  comp: number;
  tipo: TipoLado;
  /** id da rua / área / lote vizinho */
  ref?: string;
  /** texto do confrontante: "Rua 1", "Lote 5", "JOÃO DA SILVA" */
  nome: string;
}

export interface Lote {
  /** "A-05" */
  id: string;
  quadra: string;
  numero: number;
  pol: Poligono;
  area: number;
  /** soma dos lados com frente para rua/via */
  frente: number;
  lados: Lado[];
  esquina: boolean;
  /** posição na quadra — é a chave dos ajustes */
  fileira: number;
  indice: number;
  /** tem ajuste manual (frente/área travada, unido, dividido) */
  ajustado: boolean;
  /** frente travada pelo operador (para o inspetor) */
  travaFrente?: number;
  travaArea?: number;
  /** frente principal (rua para onde o lote "olha") */
  rua: string;
  problemas: string[];
  /** lote que encosta na divisa da gleba */
  naDivisa: boolean;
}

export interface Corte {
  /** índice do lote à esquerda do corte (na ordem da fileira) — arrastar o corte muda a frente DELE */
  fileira: number;
  indice: number;
  a: Pt;
  b: Pt;
  /** referencial da fileira: posição ao longo da rua = dot(p − o, dir) */
  o: Pt;
  dir: Pt;
  /** início do lote à esquerda e posição do corte */
  s0: number;
  s: number;
  arrastavel: boolean;
}

export interface Quadra {
  /** chave estável: índice da config (ou -1) */
  cfg: number;
  nome: string;
  pol: Poligono;
  area: number;
  lotes: Lote[];
  /** referencial da divisão: origem na frente principal, u ao longo da rua, v para dentro */
  origem: Pt;
  u: Pt;
  v: Pt;
  /** linha de fundo entre as fileiras (quando há duas) */
  fundo: { a: Pt; b: Pt; valor: number } | null;
  cortes: Corte[];
  modo: ModoDivisao;
  valor: number;
  sobra: Sobra;
  fileiras: number;
  centro: Pt;
  ancoraUtm?: Pt;
  problemas: string[];
  /** curvas/chanfros das esquinas (para a locação e a planta) */
  curvas: CurvaEsquina[];
}

export interface AreaPublica {
  id: string;
  tipo: TipoArea;
  nome: string;
  pols: Poligono[];
  area: number;
  /** de onde veio: desenhada, quadra inteira, lotes ou faixa de borda */
  origem: "desenho" | "quadra" | "lotes" | "borda";
  /** índice da config da quadra (origem quadra/lotes) */
  cfg?: number;
}

/** Área pública como sai na planta: as peças do mesmo tipo que se tocam viram uma só. */
export interface AreaConsolidada {
  tipo: TipoArea;
  nome: string;
  pol: Poligono;
  area: number;
  /** ids das AreaPublica que a compõem */
  fontes: string[];
}

export interface RuaCalc {
  id: string;
  nome: string;
  largura: number;
  eixo: Pt[];
  /** pedaço da rua dentro da gleba */
  pols: Poligono[];
  area: number;
  comprimento: number;
}

export interface Problema {
  nivel: "erro" | "aviso";
  texto: string;
  /** lote/quadra para a tela focar */
  alvo?: { lote?: string; quadra?: string; ponto?: Pt };
}

export interface QuadroAreas {
  gleba: number;
  lotes: { qtd: number; area: number };
  viario: number;
  verde: number;
  institucional: number;
  lazer: number;
  app: number;
  sobras: number;
  /** viário + verde + institucional + lazer (o que passa ao município) */
  publicas: number;
  vgv: number;
}

export interface Resultado {
  plano: Plano;
  gleba: Poligono;
  /** lados do perímetro no plano (mesma ordem do levantamento) */
  ladosGleba: { a: Pt; b: Pt; tipo: TipoBorda; nome: string }[];
  ruas: RuaCalc[];
  quadras: Quadra[];
  lotes: Lote[];
  areas: AreaPublica[];
  /** áreas públicas numeradas para a planta e o quadro (ÁREA VERDE 01, 02…) */
  publicas: AreaConsolidada[];
  sobras: Poligono[];
  quadro: QuadroAreas;
  problemas: Problema[];
  /** direção da maior quadra (para o desenho alinhar textos) */
  ms: number;
}

// ---------------------------------------------------------------------------
// Classificação dos lados (quem está do outro lado desta aresta?)
// ---------------------------------------------------------------------------

interface Item { pol: Poligono; caixa: { min: Pt; max: Pt }; tipo: TipoLado; ref: string; nome: string }

/** Índice espacial simples: grade de células de 40 m sobre as caixas. */
class Indice {
  private cel = new Map<string, Item[]>();
  private tam = 40;
  add(it: Item) {
    const { min, max } = it.caixa;
    for (let i = Math.floor(min[0] / this.tam); i <= Math.floor(max[0] / this.tam); i++) {
      for (let j = Math.floor(min[1] / this.tam); j <= Math.floor(max[1] / this.tam); j++) {
        const k = `${i},${j}`;
        const l = this.cel.get(k);
        if (l) l.push(it); else this.cel.set(k, [it]);
      }
    }
  }
  achar(p: Pt, ignorar?: string): Item | null {
    const l = this.cel.get(`${Math.floor(p[0] / this.tam)},${Math.floor(p[1] / this.tam)}`);
    if (!l) return null;
    for (const it of l) {
      if (it.ref === ignorar) continue;
      if (p[0] < it.caixa.min[0] || p[0] > it.caixa.max[0] || p[1] < it.caixa.min[1] || p[1] > it.caixa.max[1]) continue;
      if (dentroPol(p, it.pol)) return it;
    }
    return null;
  }
}

const item = (pol: Poligono, tipo: TipoLado, ref: string, nome: string): Item => ({ pol, caixa: caixa(pol.ext), tipo, ref, nome });

interface Contexto {
  gleba: Poligono;
  ladosGleba: Resultado["ladosGleba"];
  confrontantes: (string | null)[];
  ruas: RuaCalc[];
  /** áreas, faixas e sobras — tudo que não é lote nem rua */
  fixos: Indice;
}

/** Sonda um ponto logo do lado de fora da aresta e diz o que tem lá. */
function classificar(ctx: Contexto, a: Pt, b: Pt, lotes: Indice | null, proprio?: string): Omit<Lado, "a" | "b" | "comp"> {
  const d = unit(sub(b, a));
  const fora = mult(esquerda(d), -1); // anel anti-horário: o interior fica à esquerda
  const m = lerp(a, b, 0.5);
  const p = soma(m, mult(fora, 0.05));
  if (!dentroPol(p, ctx.gleba)) {
    // fora da gleba: divisa. Qual lado do perímetro? o mais próximo do ponto médio.
    let melhor = 0, dm = Infinity;
    ctx.ladosGleba.forEach((l, i) => { const dd = distSegmento(m, l.a, l.b).d; if (dd < dm) { dm = dd; melhor = i; } });
    const lado = ctx.ladosGleba[melhor];
    if (lado.tipo === "via") return { tipo: "via", ref: `borda${melhor}`, nome: lado.nome || "estrada existente" };
    return { tipo: "divisa", ref: `borda${melhor}`, nome: ctx.confrontantes[melhor] || lado.nome || "divisa da gleba" };
  }
  const f = ctx.fixos.achar(p, proprio);
  if (f) return { tipo: f.tipo, ref: f.ref, nome: f.nome };
  if (lotes) {
    const l = lotes.achar(p, proprio);
    if (l) return { tipo: l.tipo, ref: l.ref, nome: l.nome };
  }
  // dentro da gleba e fora de tudo: é rua (inclusive o canto cortado da esquina)
  let rua: RuaCalc | null = null, dm = Infinity;
  for (const r of ctx.ruas) {
    for (let i = 0; i + 1 < r.eixo.length; i++) {
      const dd = distSegmento(p, r.eixo[i], r.eixo[i + 1]).d;
      if (dd < dm) { dm = dd; rua = r; }
    }
  }
  return { tipo: "rua", ref: rua?.id, nome: rua?.nome ?? "via" };
}

function ladosDe(ctx: Contexto, pol: Poligono, lotes: Indice | null, proprio?: string): Lado[] {
  const out: Lado[] = [];
  const aneis = [pol.ext, ...pol.furos.map((f) => [...f].reverse())];
  for (const anel of aneis) {
    const ehFuro = anel !== pol.ext;
    for (let i = 0; i < anel.length; i++) {
      let a = anel[i], b = anel[(i + 1) % anel.length];
      if (ehFuro) [a, b] = [b, a]; // furo percorrido ao contrário: o "fora" é o furo
      const c = classificar(ctx, a, b, lotes, proprio);
      out.push({ a, b, comp: dist(a, b), ...c });
    }
  }
  return fundirLados(out);
}

/** Junta lados consecutivos e colineares com o mesmo vizinho (vértice no meio de aresta). */
function fundirLados(ls: Lado[]): Lado[] {
  if (ls.length < 2) return ls;
  const out: Lado[] = [];
  for (const l of ls) {
    const ult = out[out.length - 1];
    if (ult && ult.tipo === l.tipo && ult.ref === l.ref && Math.abs(cross(unit(sub(ult.b, ult.a)), unit(sub(l.b, l.a)))) < 0.005) {
      ult.b = l.b; ult.comp = dist(ult.a, ult.b);
    } else out.push({ ...l });
  }
  const p = out[0], u = out[out.length - 1];
  if (out.length > 2 && p.tipo === u.tipo && p.ref === u.ref && Math.abs(cross(unit(sub(u.b, u.a)), unit(sub(p.b, p.a)))) < 0.005) {
    p.a = u.a; p.comp = dist(p.a, p.b); out.pop();
  }
  return out;
}

const ehFrente = (t: TipoLado) => t === "rua" || t === "via";

// ---------------------------------------------------------------------------
// Esquinas
// ---------------------------------------------------------------------------

/**
 * Arredonda (raio) ou chanfra os cantos convexos da quadra em que os DOIS lados
 * dão para rua. Canto na divisa da gleba fica como está: ali não há esquina.
 */
/** Curva (ou chanfro) de esquina: PC e PT são os pontos que o técnico loca. */
export interface CurvaEsquina { pc: Pt; pt: Pt; meio: Pt | null; centro: Pt | null; raio: number; desenvolvimento: number; intermediarios: Pt[] }

function tratarEsquinas(ctx: Contexto, pol: Poligono, p: Parametros): { pol: Poligono; curvas: CurvaEsquina[] } {
  const curvas: CurvaEsquina[] = [];
  if (p.esquina === "nenhuma" || p.esquinaValor <= 0) return { pol, curvas };
  const anel = pol.ext;
  const n = anel.length;
  const tipos = anel.map((a, i) => classificar(ctx, a, anel[(i + 1) % n], null).tipo);
  const novo: Anel = [];
  for (let i = 0; i < n; i++) {
    const V = anel[i], A = anel[(i - 1 + n) % n], B = anel[(i + 1) % n];
    const tAnt = tipos[(i - 1 + n) % n], tProx = tipos[i];
    const dA = unit(sub(A, V)), dB = unit(sub(B, V));
    const giro = cross(sub(V, A), sub(B, V)); // > 0: canto convexo no anel anti-horário
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(dA, dB)))); // ângulo interno
    if (!ehFrente(tAnt) || !ehFrente(tProx) || giro <= 0 || ang > (150 * Math.PI) / 180) { novo.push(V); continue; }
    const lMax = 0.4 * Math.min(dist(A, V), dist(B, V));
    if (p.esquina === "chanfro") {
      const c = Math.min(p.esquinaValor, lMax);
      const pc = soma(V, mult(dA, c)), pt = soma(V, mult(dB, c));
      novo.push(pc, pt);
      curvas.push({ pc, pt, meio: null, centro: null, raio: 0, desenvolvimento: dist(pc, pt), intermediarios: [] });
      continue;
    }
    // raio: arco tangente aos dois alinhamentos
    let r = p.esquinaValor;
    let t = r / Math.tan(ang / 2);
    if (t > lMax) { t = lMax; r = t * Math.tan(ang / 2); }
    const T1 = soma(V, mult(dA, t)), T2 = soma(V, mult(dB, t));
    const bis = unit(soma(dA, dB));
    const C = soma(V, mult(bis, r / Math.sin(ang / 2)));
    const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]);
    // o arco curto, de T1 a T2: o centro fica dentro da quadra
    let giroArco = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1;
    while (giroArco > Math.PI) giroArco -= 2 * Math.PI;
    while (giroArco < -Math.PI) giroArco += 2 * Math.PI;
    const a2 = a1 + giroArco;
    const passos = Math.max(4, 2 * Math.ceil((Math.abs(giroArco) * 180) / Math.PI / 20));
    const arco: Pt[] = [];
    for (let k = 0; k <= passos; k++) {
      const a = a1 + ((a2 - a1) * k) / passos;
      arco.push([C[0] + r * Math.cos(a), C[1] + r * Math.sin(a)]);
    }
    novo.push(...arco);
    curvas.push({
      pc: arco[0], pt: arco[arco.length - 1], meio: arco[passos / 2], centro: C, raio: r,
      desenvolvimento: Math.abs(giroArco) * r, intermediarios: arco.slice(1, -1).filter((_, k) => k + 1 !== passos / 2),
    });
  }
  return { pol: { ext: novo, furos: pol.furos }, curvas };
}

// ---------------------------------------------------------------------------
// Divisão da quadra em lotes
// ---------------------------------------------------------------------------

interface Face { lados: Lado[]; comp: number; dir: Pt; a: Pt; b: Pt; /** lado mais longo: dá a direção e a posição exatas (os arcos da esquina não) */ maior: Lado }

/** Agrupa lados consecutivos com frente para rua e direção parecida (< 25°). */
function faces(lados: Lado[]): Face[] {
  const n = lados.length;
  if (!n) return [];
  const lim = Math.cos((25 * Math.PI) / 180);
  const dirDe = (l: Lado) => unit(sub(l.b, l.a));
  const quebra = (i: number) => {
    const l = lados[i], ant = lados[(i - 1 + n) % n];
    if (!ehFrente(l.tipo)) return true;
    if (!ehFrente(ant.tipo)) return true;
    return dot(dirDe(l), dirDe(ant)) < lim;
  };
  let ini = lados.findIndex((_, i) => quebra(i));
  if (ini < 0) ini = 0;
  const out: Face[] = [];
  let atual: Lado[] = [];
  const fechar = () => {
    if (!atual.length) return;
    const comp = atual.reduce((s, l) => s + l.comp, 0);
    let dx = 0, dy = 0;
    for (const l of atual) { dx += l.b[0] - l.a[0]; dy += l.b[1] - l.a[1]; }
    const maior = atual.reduce((m, l) => (l.comp > m.comp ? l : m), atual[0]);
    out.push({ lados: atual, comp, dir: unit(sub(maior.b, maior.a)), a: atual[0].a, b: atual[atual.length - 1].b, maior });
    atual = [];
  };
  for (let k = 0; k < n; k++) {
    const i = (ini + k) % n;
    // quebra também quando o desvio ACUMULADO passa de 25°: um arco de esquina
    // gira 10° por segmento e, sem isso, juntaria as quatro frentes numa só
    if (quebra(i) || (atual.length && dot(dirDe(lados[i]), dirDe(atual[0])) < lim)) fechar();
    if (ehFrente(lados[i].tipo)) atual.push(lados[i]);
  }
  fechar();
  return out;
}

interface FileiraCalc { pol: Poligono; sentido: 1 | -1; ini: number; fim: number }

interface EspecLote { w?: number; area?: number; indice: number; fixo: boolean }

/**
 * Distribui a fileira em lotes. É aqui que mora o "os outros se ajustam":
 * lotes travados (frente ou área) entram primeiro, e o comprimento que sobra
 * é dividido entre os livres pela regra da quadra.
 */
function distribuir(
  fil: FileiraCalc, o: Pt, u: Pt, modo: ModoDivisao, valor: number, sobra: Sobra,
  ajustes: Map<number, AjusteLote>, p: Parametros,
): { cortes: number[]; specs: EspecLote[] } {
  const L = fil.fim - fil.ini;
  const areaTotal = areaPol(fil.pol);
  const prof = L > 0 ? areaTotal / L : p.profundidade;
  if (L < p.frenteMin * 0.5) return { cortes: [], specs: [{ indice: 0, fixo: false }] };

  const fixos = [...ajustes.values()].filter((a) => a.frente || a.area);
  let usado = 0;
  for (const a of fixos) usado += a.frente ?? (a.area! / prof);
  const livre = Math.max(0, L - usado);

  const larg: number[] = [];
  let modoArea = false;
  if (modo === "area") {
    modoArea = true;
    const alvo = Math.max(valor, 1);
    const areaLivre = Math.max(0, areaTotal - fixos.reduce((s, a) => s + (a.area ?? a.frente! * prof), 0));
    let nf = Math.floor(areaLivre / alvo + 1e-6);
    if (nf === 0 && areaLivre >= p.areaMin * 0.5) nf = 1;
    for (let i = 0; i < nf; i++) larg.push(areaLivre / nf); // áreas iguais
  } else if (modo === "quantidade") {
    const nf = Math.max(0, Math.round(valor) - fixos.length);
    for (let i = 0; i < nf; i++) larg.push(livre / nf);
  } else {
    const f = Math.max(valor, 0.5);
    let nf = Math.floor(livre / f + 1e-6);
    if (nf === 0 && livre >= p.frenteMin) nf = 1;
    const r = livre - nf * f;
    for (let i = 0; i < nf; i++) larg.push(f);
    if (nf > 0 && r > 1e-6) {
      if (sobra === "distribuir") for (let i = 0; i < nf; i++) larg[i] += r / nf;
      else if (sobra === "ultimo") larg[nf - 1] += r;
      else if (sobra === "extra" && r >= p.frenteMin) larg.push(r);
      else if (sobra === "extra") larg[nf - 1] += r;
      else if (nf >= 2) { larg[0] += r / 2; larg[nf - 1] += r / 2; }
      else larg[0] += r;
    }
  }

  // intercala travados (na posição deles) e livres (na ordem)
  const n = larg.length + fixos.length;
  const specs: EspecLote[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const a = ajustes.get(i);
    if (a && (a.frente || a.area)) specs.push({ indice: i, fixo: true, w: a.frente, area: a.frente ? undefined : a.area });
    else if (k < larg.length) {
      specs.push(modoArea ? { indice: i, fixo: false, area: larg[k++] } : { indice: i, fixo: false, w: larg[k++] });
    }
  }
  // travado com índice além do fim da fileira: entra no fim
  for (const a of fixos) if (a.indice >= n) specs.push({ indice: specs.length, fixo: true, w: a.frente, area: a.frente ? undefined : a.area });

  // posições dos cortes
  const cortes: number[] = [];
  let pos = fil.ini;
  let areaAcum = 0;
  const areaAte = (s: number) => areaPolAteCorte(fil.pol, o, u, s);
  for (let i = 0; i < specs.length - 1; i++) {
    const s = specs[i];
    let prox: number;
    if (s.w !== undefined) prox = pos + s.w;
    else {
      const alvo = areaAcum + (s.area ?? 0);
      let lo = pos, hi = fil.fim + L;
      for (let it = 0; it < 50; it++) {
        const mid = (lo + hi) / 2;
        if (areaAte(mid) < alvo) lo = mid; else hi = mid;
      }
      prox = (lo + hi) / 2;
    }
    if (prox >= fil.fim - Math.min(p.frenteMin, 1) * 0.5) break; // não cabe: o resto fica no último
    cortes.push(prox);
    pos = prox;
    areaAcum = areaAte(pos);
  }
  return { cortes, specs: specs.slice(0, cortes.length + 1) };
}

interface ResultadoQuadra {
  lotes: Omit<Lote, "id" | "quadra" | "numero" | "lados" | "frente" | "esquina" | "rua" | "problemas" | "naDivisa">[];
  destinos: Map<string, TipoArea>;
  cortes: Corte[];
  fundo: Quadra["fundo"];
  sobras: Poligono[];
  origem: Pt; u: Pt; v: Pt;
  fileiras: number;
  problemas: string[];
}

function dividirQuadra(
  ctx: Contexto, pol: Poligono, cfg: QuadraCfg | null, p: Parametros, modo: ModoDivisao, valor: number, sobra: Sobra,
  ancoraFrente: Pt | null,
): ResultadoQuadra {
  const lados = ladosDe(ctx, pol, null);
  const fs = faces(lados).filter((f) => f.comp >= Math.min(p.frenteMin, 3));
  const vazio = (msg: string): ResultadoQuadra => ({
    lotes: [], destinos: new Map(), cortes: [], fundo: null, sobras: [pol], origem: pol.ext[0], u: [1, 0], v: [0, 1],
    fileiras: 0, problemas: [msg],
  });
  if (!fs.length) return vazio("quadra sem frente para rua");

  let principal = fs.reduce((m, f) => (f.comp > m.comp ? f : m), fs[0]);
  if (ancoraFrente) {
    let dm = Infinity;
    for (const f of fs) for (const l of f.lados) {
      const d = distSegmento(ancoraFrente, l.a, l.b).d;
      if (d < dm) { dm = d; principal = f; }
    }
  }
  const u = principal.dir;
  const v = esquerda(u);
  const o = principal.maior.a;
  const proj = (q: Pt): [number, number] => [dot(sub(q, o), u), dot(sub(q, o), v)];
  const vs = pol.ext.map((q) => proj(q)[1]);
  const vMax = Math.max(...vs);

  const opostas = fs.filter((f) => f !== principal && dot(f.dir, u) < -0.85 && f.comp >= 0.3 * principal.comp);
  const oposta = opostas.length ? opostas.reduce((m, f) => (f.comp > m.comp ? f : m), opostas[0]) : null;
  const D = oposta ? (proj(oposta.maior.a)[1] + proj(oposta.maior.b)[1]) / 2 : vMax;

  const pedido = cfg?.fileiras ?? "auto";
  let duas = !!oposta && (pedido === 2 || (pedido === "auto" && D >= 1.2 * p.profundidade));
  if (pedido === 1) duas = false;

  const problemas: string[] = [];
  const sobras: Poligono[] = [];
  const fileirasPol: { pol: Poligono; sentido: 1 | -1 }[] = [];
  let fundo: Quadra["fundo"] = null;
  // limites dos cortadores: só um pouco além da própria quadra. Retângulo de
  // 100 km tira o clipper da faixa de inteiros "rápida" e ele passa a errar
  // por arredondamento (a contagem de lotes mudava com a escala interna).
  const GR = pol.ext.reduce((m, q) => Math.max(m, dist(q, o)), 0) + 50;
  if (duas) {
    const f = Math.max(0.2 * D, Math.min(0.8 * D, cfg?.fundo ?? D / 2));
    for (const pp of intersecao([pol], [faixaReferencial(o, u, v, -GR, GR, -GR, f)])) fileirasPol.push({ pol: pp, sentido: 1 });
    for (const pp of intersecao([pol], [faixaReferencial(o, u, v, -GR, GR, f, GR)])) fileirasPol.push({ pol: pp, sentido: -1 });
    const us = pol.ext.map((q) => proj(q)[0]);
    const a = soma(o, soma(mult(u, Math.min(...us)), mult(v, f)));
    const b = soma(o, soma(mult(u, Math.max(...us)), mult(v, f)));
    fundo = { a, b, valor: f };
  } else {
    const limite = 2.2 * p.profundidade;
    if (!oposta && vMax > limite) {
      const f = cfg?.fundo ?? 1.2 * p.profundidade;
      for (const pp of intersecao([pol], [faixaReferencial(o, u, v, -GR, GR, -GR, f)])) fileirasPol.push({ pol: pp, sentido: 1 });
      for (const pp of diferenca([pol], [faixaReferencial(o, u, v, -GR, GR, -GR, f)])) sobras.push(pp);
      const us = pol.ext.map((q) => proj(q)[0]);
      fundo = { a: soma(o, soma(mult(u, Math.min(...us)), mult(v, f))), b: soma(o, soma(mult(u, Math.max(...us)), mult(v, f))), valor: f };
      if (sobras.length) problemas.push("fundo da quadra sem acesso (faixa além da profundidade máxima)");
    } else fileirasPol.push({ pol, sentido: 1 });
  }

  // frente útil de cada fileira: extensão (em u) dos lados que dão para rua
  const frentes = lados.filter((l) => ehFrente(l.tipo));
  const naFrente = (a: Pt, b: Pt) => {
    const m = lerp(a, b, 0.5);
    return frentes.some((l) => distSegmento(m, l.a, l.b).d < 0.02);
  };
  const ajustesPorFil = new Map<number, Map<number, AjusteLote>>();
  for (const a of cfg?.ajustes ?? []) {
    if (!ajustesPorFil.has(a.fileira)) ajustesPorFil.set(a.fileira, new Map());
    ajustesPorFil.get(a.fileira)!.set(a.indice, a);
  }

  const lotes: ResultadoQuadra["lotes"] = [];
  const destinos = new Map<string, TipoArea>();
  const cortes: Corte[] = [];
  fileirasPol.sort((a, b) => b.sentido - a.sentido);
  fileirasPol.forEach((fp, fi) => {
    const uf: Pt = fp.sentido === 1 ? u : mult(u, -1);
    let ini = Infinity, fim = -Infinity;
    const anel = fp.pol.ext;
    for (let i = 0; i < anel.length; i++) {
      const a = anel[i], b = anel[(i + 1) % anel.length];
      if (!naFrente(a, b)) continue;
      for (const q of [a, b]) { const s = dot(sub(q, o), uf); ini = Math.min(ini, s); fim = Math.max(fim, s); }
    }
    if (!Number.isFinite(ini)) {
      sobras.push(fp.pol);
      problemas.push("parte da quadra sem frente para rua");
      return;
    }
    const aj = ajustesPorFil.get(fi) ?? new Map<number, AjusteLote>();
    const { cortes: cs, specs } = distribuir({ pol: fp.pol, sentido: fp.sentido, ini, fim }, o, uf, modo, valor, sobra, aj, p);

    // une (pula o corte) e divide (acrescenta cortes) — sobre as posições já calculadas
    const lim = [-GR, ...cs, GR];
    const intervalos: { a: number; b: number; indice: number }[] = [];
    for (let i = 0; i < lim.length - 1; i++) intervalos.push({ a: lim[i], b: lim[i + 1], indice: specs[i]?.indice ?? i });
    const finais: typeof intervalos = [];
    for (const it of intervalos) {
      const ult = finais[finais.length - 1];
      if (ult && aj.get(ult.indice)?.unir) { ult.b = it.b; continue; }
      finais.push({ ...it });
    }

    interface Pedaco { pol: Poligono; area: number; a: number; b: number; indice: number; frente: number; aj?: AjusteLote; sub: boolean }
    const vv = esquerda(uf);
    const frenteDe = (pol: Poligono) => {
      let s = 0;
      for (let i = 0; i < pol.ext.length; i++) {
        const a = pol.ext[i], b = pol.ext[(i + 1) % pol.ext.length];
        if (naFrente(a, b)) s += dist(a, b);
      }
      return s;
    };
    const pedacos: Pedaco[] = [];
    for (let i = 0; i < finais.length; i++) {
      const it = finais[i];
      const a = aj.get(it.indice);
      const partes = Math.max(1, Math.min(20, Math.round(a?.dividir ?? 1)));
      const ea = i === 0 ? ini : it.a, eb = i === finais.length - 1 ? fim : it.b;
      for (let k = 0; k < partes; k++) {
        const sa = partes === 1 || k === 0 ? it.a : ea + ((eb - ea) * k) / partes;
        const sb = partes === 1 || k === partes - 1 ? it.b : ea + ((eb - ea) * (k + 1)) / partes;
        const corte = faixaReferencial(o, uf, vv, sa, sb, -GR, GR);
        const partesPol = intersecao([fp.pol], [corte]).sort((x, y) => areaPol(y) - areaPol(x));
        if (!partesPol.length) continue;
        for (const resto of partesPol.slice(1)) sobras.push(resto);
        const pol = partesPol[0];
        pedacos.push({ pol, area: areaPol(pol), a: sa, b: sb, indice: it.indice + (partes > 1 ? k / 100 : 0), frente: frenteDe(pol), aj: a, sub: partes > 1 });
      }
    }

    // pedaço sem frente para rua não é lote: vira sobra (o gerador a transforma em área verde)
    for (let i = pedacos.length - 1; i >= 0; i--) {
      if (pedacos[i].frente < 0.05) { sobras.push(pedacos[i].pol); pedacos.splice(i, 1); }
    }
    // pontas pequenas demais (retalho da divisa torta, da esquina) somam-se ao vizinho
    const fundir = (i: number, j: number) => {
      const x = pedacos[i], y = pedacos[j];
      const u2 = uniao([x.pol], [y.pol]).sort((m, n) => areaPol(n) - areaPol(m));
      if (u2.length !== 1) return false;
      const fica = x.area >= y.area ? x : y;
      const novo: Pedaco = { ...fica, pol: u2[0], area: areaPol(u2[0]), a: Math.min(x.a, y.a), b: Math.max(x.b, y.b), frente: frenteDe(u2[0]) };
      pedacos.splice(Math.min(i, j), 2, novo);
      return true;
    };
    const pequeno = (x: Pedaco) => !x.aj?.frente && !x.aj?.area && (x.area < p.areaMin - 0.01 || x.frente < p.frenteMin - 0.005);
    for (let guarda = 0; guarda < 6 && pedacos.length >= 2 && pequeno(pedacos[0]); guarda++) if (!fundir(0, 1)) break;
    for (let guarda = 0; guarda < 6 && pedacos.length >= 2 && pequeno(pedacos[pedacos.length - 1]); guarda++) if (!fundir(pedacos.length - 2, pedacos.length - 1)) break;
    for (let i = 1; i < pedacos.length - 1; i++) {
      if (pedacos[i].area < 0.3 * p.areaMin && !pedacos[i].aj?.frente && fundir(i - 1, i)) i--;
    }

    pedacos.forEach((x, i) => {
      const a = x.aj;
      lotes.push({
        pol: x.pol, area: x.area, fileira: fi, indice: x.indice,
        ajustado: !!a && !!(a.frente || a.area || a.unir || (a.dividir && a.dividir > 1)),
        travaFrente: a?.frente, travaArea: a?.area,
      });
      if (a?.destino) destinos.set(`${fi}:${x.indice}`, a.destino);
      const prox = pedacos[i + 1];
      if (prox && Math.abs(prox.a - x.b) < 1e-6) {
        const ps = fp.pol.ext.map((q) => dot(sub(q, o), vv));
        cortes.push({
          fileira: fi, indice: x.indice, arrastavel: !x.sub && !prox.sub,
          a: soma(o, soma(mult(uf, x.b), mult(vv, Math.min(...ps)))),
          b: soma(o, soma(mult(uf, x.b), mult(vv, Math.max(...ps)))),
          o, dir: uf, s0: i === 0 ? ini : x.a, s: x.b,
        });
      }
    });
  });
  return { lotes, destinos, cortes, fundo, sobras, origem: o, u, v, fileiras: fileirasPol.length, problemas };
}

// ---------------------------------------------------------------------------
// Numeração
// ---------------------------------------------------------------------------

export function letraQuadra(i: number): string {
  let s = "";
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/** Quadras de cima para baixo, da esquerda para a direita (faixas pela altura). */
function ordenarQuadras<T extends { centro: Pt }>(qs: T[], faixa: number): T[] {
  const ord = [...qs].sort((a, b) => b.centro[1] - a.centro[1]);
  const faixas: T[][] = [];
  for (const q of ord) {
    const f = faixas[faixas.length - 1];
    if (f && Math.abs(f[0].centro[1] - q.centro[1]) < faixa) f.push(q); else faixas.push([q]);
  }
  return faixas.flatMap((f) => f.sort((a, b) => a.centro[0] - b.centro[0]));
}

// ---------------------------------------------------------------------------
// Cálculo completo
// ---------------------------------------------------------------------------

export interface OpcoesCalculo {
  /** pula lados/memorial/problemas dos lotes (o gerador automático só quer contar) */
  rapido?: boolean;
}

export function calcular(projeto: Projeto, perimetro: Perimetro, op: OpcoesCalculo = {}): Resultado {
  const p = projeto.params;
  const plano = criarPlano(perimetro.pts, perimetro.altitudes, p.distanciasTerreno);
  const P = (q: Pt) => paraPlano(plano, q);
  const ptsPl = perimetro.pts.map(P);
  const horario = areaAssinada(ptsPl) < 0;
  const gleba: Poligono = { ext: antiHorario(ptsPl), furos: [] };
  const ladosGleba = ptsPl.map((a, i) => {
    const b = ptsPl[(i + 1) % ptsPl.length];
    const bd = projeto.bordas[i] ?? { tipo: "divisa" as TipoBorda, faixa: 0 };
    return { a, b, tipo: bd.tipo, nome: bd.nome ?? "" };
  });
  void horario;
  const problemas: Problema[] = [];
  const areaGleba = areaPol(gleba);

  // --- faixas das bordas (APP, non aedificandi)
  const areas: AreaPublica[] = [];
  const bordasComFaixa = projeto.bordas.map((b, i) => ({ b, i })).filter(({ b }) => b.faixa > 0 && b.tipo !== "divisa");
  if (bordasComFaixa.length) {
    // lados vizinhos com o mesmo tipo e faixa viram uma polilinha só (sem dente na dobra)
    const grupos: { tipo: TipoBorda; faixa: number; pts: Pt[]; nome: string }[] = [];
    for (const { b, i } of bordasComFaixa) {
      const l = ladosGleba[i];
      const g = grupos[grupos.length - 1];
      if (g && g.tipo === b.tipo && g.faixa === b.faixa && dist(g.pts[g.pts.length - 1], l.a) < 1e-6) g.pts.push(l.b);
      else grupos.push({ tipo: b.tipo, faixa: b.faixa, pts: [l.a, l.b], nome: b.nome ?? "" });
    }
    grupos.forEach((g, k) => {
      const pols = intersecao([gleba], bufferLinha(g.pts, 2 * g.faixa, "quadrada"));
      if (!pols.length) return;
      const rot = g.tipo === "rio" ? "APP" : "Faixa non aedificandi";
      areas.push({ id: `faixa${k}`, tipo: "app", nome: `${rot}${g.nome ? ` — ${g.nome}` : ""}`, pols, area: pols.reduce((s, x) => s + areaPol(x), 0), origem: "borda" });
    });
  }

  // --- ruas
  const ruas: RuaCalc[] = projeto.ruas.filter((r) => r.eixo.length >= 2).map((r) => {
    const eixo = r.eixo.map(P);
    let corpo = bufferLinha(eixo, r.largura, "reta");
    if (r.balao && r.balao > r.largura / 2) corpo = uniao(corpo, [circulo(eixo[eixo.length - 1], r.balao)]);
    const pols = intersecao([gleba], corpo);
    let comp = 0;
    for (let i = 0; i + 1 < eixo.length; i++) comp += dist(eixo[i], eixo[i + 1]);
    return { id: r.id, nome: r.nome, largura: r.largura, eixo, pols, area: 0, comprimento: comp };
  });
  const viarioBruto = ruas.length ? uniao(ruas.flatMap((r) => r.pols)) : [];

  // --- áreas desenhadas (o que estiver sob rua continua sendo rua)
  for (const a of projeto.areas) {
    if (a.anel.length < 3) continue;
    const pol: Poligono = { ext: antiHorario(a.anel.map(P)), furos: [] };
    const pols = diferenca(intersecao([gleba], [pol]), [...viarioBruto, ...areas.filter((x) => x.origem === "borda").flatMap((x) => x.pols)]);
    if (!pols.length) continue;
    areas.push({ id: a.id, tipo: a.tipo, nome: a.nome || ROTULO_AREA[a.tipo], pols, area: pols.reduce((s, x) => s + areaPol(x), 0), origem: "desenho" });
  }

  // --- quadras brutas
  const bloqueios = [...viarioBruto, ...areas.flatMap((a) => a.pols)];
  const pedacos = diferenca([gleba], bloqueios);
  const sobras: Poligono[] = [];

  const fixos = new Indice();
  for (const a of areas) for (const pol of a.pols) fixos.add(item(pol, a.tipo === "app" ? "faixa" : "area", a.id, a.nome));
  const ctx: Contexto = { gleba, ladosGleba, confrontantes: perimetro.confrontantes, ruas, fixos };

  // configs: cada quadra pega a config cuja âncora cai dentro dela
  const cfgs = projeto.quadras.map((c) => ({ c, pt: P(c.ancora) }));
  const usadas = new Set<number>();

  interface QuadraTmp {
    pol: Poligono; cfgIdx: number; cfg: QuadraCfg | null; centro: Pt; res: ResultadoQuadra | null;
    destino?: TipoArea; modo: ModoDivisao; valor: number; sobra: Sobra;
  }
  const tmp: QuadraTmp[] = [];
  const minQuadra = Math.max(p.areaMin * 0.6, 40);
  for (const bruto of pedacos) {
    const a = areaPol(bruto);
    if (a < minQuadra) { sobras.push(bruto); continue; }
    let cfgIdx = -1;
    for (let i = cfgs.length - 1; i >= 0; i--) {
      if (!usadas.has(i) && dentroPol(cfgs[i].pt, bruto)) { cfgIdx = i; break; }
    }
    if (cfgIdx >= 0) usadas.add(cfgIdx);
    const cfg = cfgIdx >= 0 ? cfgs[cfgIdx].c : null;
    tmp.push({ pol: bruto, cfgIdx, cfg, centro: centroide(bruto.ext), res: null, destino: cfg?.destino, modo: "frente", valor: p.frente, sobra: p.sobra });
  }
  // quadra inteira virou área: entra nos "fixos" antes de dividir as outras
  for (const q of tmp) {
    if (!q.destino) continue;
    fixos.add(item(q.pol, q.destino === "app" ? "faixa" : "area", `qa${q.cfgIdx}`, ROTULO_AREA[q.destino]));
  }

  const lotesIdx = new Indice();
  const quadras: Quadra[] = [];
  const lotes: Lote[] = [];

  const ordenadas = ordenarQuadras(tmp, Math.max(15, p.profundidade));
  let nQuadra = 0;
  const contaArea: Record<TipoArea, number> = { verde: 0, institucional: 0, app: 0, lazer: 0 };
  for (const q of ordenadas) {
    if (q.destino) {
      contaArea[q.destino]++;
      areas.push({
        id: `qa${q.cfgIdx}`, tipo: q.destino, nome: q.cfg?.nome || `${ROTULO_AREA[q.destino]} ${contaArea[q.destino]}`,
        pols: [q.pol], area: areaPol(q.pol), origem: "quadra", cfg: q.cfgIdx,
      });
      continue;
    }
    const nome = q.cfg?.nome || (p.numeracaoQuadras === "letras" ? letraQuadra(nQuadra) : String(nQuadra + 1).padStart(2, "0"));
    nQuadra++;
    const { pol: polEsq, curvas } = tratarEsquinas(ctx, q.pol, p);
    // lotes da divisa: mesma frente, ou áreas iguais absorvendo a irregularidade
    const naDivisa = ladosDe(ctx, polEsq, null).some((l) => l.tipo === "divisa");
    let modo: ModoDivisao = q.cfg?.modo ?? "frente";
    let valor = q.cfg?.valor ?? p.frente;
    if (!q.cfg?.modo && naDivisa && p.divisa === "areas_iguais") { modo = "area"; valor = p.frente * p.profundidade; }
    if (modo === "area" && !q.cfg?.valor) valor = p.frente * p.profundidade;
    if (modo === "quantidade" && !q.cfg?.valor) valor = 10;
    const sobra = q.cfg?.sobra ?? p.sobra;
    const ancFrente = q.cfg?.frentePrincipal ? P(q.cfg.frentePrincipal) : null;
    const res = dividirQuadra(ctx, polEsq, q.cfg, p, modo, valor, sobra, ancFrente);
    for (const s of res.sobras) sobras.push(s);

    // numeração: fileira 0 no sentido dela, fileira 1 voltando — dá a volta na quadra
    const lotesQ = res.lotes.map((l, i) => ({ l, i, dest: res.destinos.get(`${l.fileira}:${l.indice}`) }));
    const ordem = [
      ...lotesQ.filter((x) => x.l.fileira === 0),
      ...lotesQ.filter((x) => x.l.fileira === 1),
      ...lotesQ.filter((x) => x.l.fileira > 1),
    ];
    // anti-horário por construção; horário = inverter. Começa no lote mais a noroeste.
    let seq = p.sentidoLotes === "horario" ? [...ordem].reverse() : ordem;
    if (seq.length > 1) {
      const bb = caixa(polEsq.ext);
      const no: Pt = [bb.min[0], bb.max[1]];
      const cs = seq.map((x) => centroide(x.l.pol.ext));
      let ini = 0, dm = Infinity;
      cs.forEach((c, i) => { const d = dist(c, no); if (d < dm) { dm = d; ini = i; } });
      if (res.fileiras >= 2) seq = [...seq.slice(ini), ...seq.slice(0, ini)];
      else if (dist(cs[cs.length - 1], no) < dist(cs[0], no)) seq = [...seq].reverse();
    }

    const quadra: Quadra = {
      cfg: q.cfgIdx, nome, pol: polEsq, area: areaPol(polEsq), lotes: [], origem: res.origem, u: res.u, v: res.v,
      fundo: res.fundo, cortes: res.cortes, modo, valor, sobra, fileiras: res.fileiras, centro: q.centro,
      ancoraUtm: q.cfg?.ancora, problemas: res.problemas, curvas,
    };
    let num = 0;
    let nAreaLotes = 0;
    for (const x of seq) {
      if (x.dest) {
        nAreaLotes++;
        const id = `ql${q.cfgIdx}-${x.l.fileira}-${x.l.indice}`;
        // lotes vizinhos com o mesmo destino viram uma área só
        const vizinha = areas.find((a) => a.origem === "lotes" && a.cfg === q.cfgIdx && a.tipo === x.dest);
        if (vizinha) { vizinha.pols = fechar(uniao(vizinha.pols, [x.l.pol])); vizinha.area = vizinha.pols.reduce((s, pp) => s + areaPol(pp), 0); }
        else {
          contaArea[x.dest]++;
          areas.push({ id, tipo: x.dest, nome: `${ROTULO_AREA[x.dest]} ${contaArea[x.dest]}`, pols: [x.l.pol], area: x.l.area, origem: "lotes", cfg: q.cfgIdx });
        }
        fixos.add(item(x.l.pol, "area", vizinha?.id ?? id, vizinha?.nome ?? `${ROTULO_AREA[x.dest]} ${contaArea[x.dest]}`));
        continue;
      }
      num++;
      const lote: Lote = {
        ...x.l, id: `${nome}-${String(num).padStart(2, "0")}`, quadra: nome, numero: num, lados: [], frente: 0,
        esquina: false, rua: "", problemas: [], naDivisa: false,
      };
      quadra.lotes.push(lote);
      lotes.push(lote);
      lotesIdx.add(item(lote.pol, "lote", lote.id, `Lote ${String(num).padStart(2, "0")} da Quadra ${nome}`));
    }
    void nAreaLotes;
    quadras.push(quadra);
  }

  // --- retalho minúsculo (canto de esquina, ponta de rua) é calçada: some no viário
  for (let i = sobras.length - 1; i >= 0; i--) if (areaPol(sobras[i]) < 30) sobras.splice(i, 1);
  // --- sobras entram no índice (para o lado do lote dizer "área remanescente")
  for (const [i, s] of sobras.entries()) fixos.add(item(s, "sobra", `sobra${i}`, "área remanescente"));

  // --- lados e problemas dos lotes
  for (const l of lotes) {
    if (op.rapido) {
      l.frente = 0;
      if (l.area < p.areaMin - 0.01) l.problemas.push("área abaixo do mínimo");
      continue;
    }
    l.lados = ladosDe(ctx, l.pol, lotesIdx, l.id);
    const fr = l.lados.filter((x) => ehFrente(x.tipo));
    l.frente = fr.reduce((s, x) => s + x.comp, 0);
    const ruasDistintas = new Set(fr.map((x) => x.ref));
    l.esquina = ruasDistintas.size >= 2;
    const maior = fr.sort((a, b) => b.comp - a.comp)[0];
    l.rua = maior?.nome ?? "";
    l.naDivisa = l.lados.some((x) => x.tipo === "divisa");
    if (l.area < p.areaMin - 0.01) l.problemas.push(`área ${fmt(l.area)} m² abaixo do mínimo de ${fmt(p.areaMin)} m²`);
    if (!fr.length) l.problemas.push("lote sem frente para rua");
    else if (l.frente < p.frenteMin - 0.005) l.problemas.push(`frente ${fmt(l.frente)} m abaixo do mínimo de ${fmt(p.frenteMin)} m`);
    for (const pr of l.problemas) problemas.push({ nivel: "erro", texto: `Lote ${l.id}: ${pr}`, alvo: { lote: l.id } });
  }
  for (const q of quadras) for (const pr of q.problemas) problemas.push({ nivel: "aviso", texto: `Quadra ${q.nome}: ${pr}`, alvo: { quadra: q.nome } });

  for (const r of ruas) r.area = r.pols.reduce((s, x) => s + areaPol(x), 0);

  // --- quadro de áreas
  const somaTipo = (t: TipoArea) => areas.filter((a) => a.tipo === t).reduce((s, a) => s + a.area, 0);
  const areaLotes = lotes.reduce((s, l) => s + l.area, 0);
  const verde = somaTipo("verde"), inst = somaTipo("institucional"), lazer = somaTipo("lazer"), app = somaTipo("app");
  const areaSobras = sobras.reduce((s, x) => s + areaPol(x), 0);
  // viário por diferença: o que não é lote, área pública nem sobra (inclui os
  // cantos das esquinas). A soma do quadro fecha na área da gleba por construção.
  const areaViario = Math.max(0, areaGleba - areaLotes - verde - inst - lazer - app - areaSobras);
  const vgv = p.precoM2 > 0
    ? lotes.reduce((s, l) => s + l.area * p.precoM2 * (l.esquina ? 1 + p.acrescimoEsquina / 100 : 1), 0)
    : 0;
  const quadro: QuadroAreas = {
    gleba: areaGleba, lotes: { qtd: lotes.length, area: areaLotes }, viario: areaViario, verde, institucional: inst, lazer, app,
    sobras: areaSobras, publicas: areaViario + verde + inst + lazer, vgv,
  };

  if (!op.rapido && lotes.length) {
    const pct = (x: number) => (100 * x) / areaGleba;
    if (pct(verde + lazer) < p.pctVerdeMin - 0.005) problemas.push({ nivel: "aviso", texto: `Área verde com ${fmt(pct(verde + lazer))}% da gleba — a meta é ${fmt(p.pctVerdeMin)}% (faltam ${fmt(((p.pctVerdeMin - pct(verde + lazer)) / 100) * areaGleba)} m²)` });
    if (pct(inst) < p.pctInstitucionalMin - 0.005) problemas.push({ nivel: "aviso", texto: `Área institucional com ${fmt(pct(inst))}% — a meta é ${fmt(p.pctInstitucionalMin)}% (faltam ${fmt(((p.pctInstitucionalMin - pct(inst)) / 100) * areaGleba)} m²)` });
    if (pct(quadro.publicas) < p.pctPublicasMin - 0.005) problemas.push({ nivel: "aviso", texto: `Áreas públicas (viário + verde + institucional) somam ${fmt(pct(quadro.publicas))}% — a meta do município é ${fmt(p.pctPublicasMin)}%` });
    for (const q of quadras) {
      const us = q.pol.ext.map((x) => dot(sub(x, q.origem), q.u));
      const comp = Math.max(...us) - Math.min(...us);
      if (comp > p.quadraCompMax + 0.5) problemas.push({ nivel: "aviso", texto: `Quadra ${q.nome} com ${fmt(comp)} m de comprimento — o máximo é ${fmt(p.quadraCompMax)} m`, alvo: { quadra: q.nome } });
    }
    if (areaSobras > 1) problemas.push({ nivel: "aviso", texto: `${fmt(areaSobras)} m² de sobras sem destino (retalhos sem frente para rua) — transforme em área verde ou ajuste as ruas` });
    for (const r of ruas) if (r.largura < 8) problemas.push({ nivel: "aviso", texto: `${r.nome} com ${fmt(r.largura)} m de largura` });
    problemas.push(...problemasDeAcesso(ruas, ladosGleba));
  }

  const ms = quadras.length ? Math.atan2(quadras[0].u[1], quadras[0].u[0]) : 0;
  const publicas = op.rapido ? [] : consolidar(areas);
  return { plano, gleba, ladosGleba, ruas, quadras, lotes, areas, publicas, sobras, quadro, problemas, ms };
}

const cacheViario = new WeakMap<Resultado, Poligono[]>();
/**
 * Polígonos do sistema viário (gleba − quadras − áreas − sobras). É uma
 * diferença com dezenas de furos — cara num loteamento grande —, por isso só
 * as exportações (planta e DXF) pedem; a tela pinta a gleba na cor da rua.
 */
export function viarioDe(res: Resultado): Poligono[] {
  let v = cacheViario.get(res);
  if (!v) {
    v = diferenca([res.gleba], [...res.quadras.map((q) => q.pol), ...res.areas.flatMap((a) => a.pols), ...res.sobras]);
    cacheViario.set(res, v);
  }
  return v;
}

/** Fecha frestas de milímetro que a união de lotes vizinhos deixa na linha de fundo. */
const fechar = (pols: Poligono[]): Poligono[] => offsetPols(offsetPols(pols, 0.01), -0.01);

function consolidar(areas: AreaPublica[]): AreaConsolidada[] {
  const out: AreaConsolidada[] = [];
  const ordem: TipoArea[] = ["verde", "lazer", "institucional", "app"];
  for (const tipo of ordem) {
    const doTipo = areas.filter((a) => a.tipo === tipo);
    if (!doTipo.length) continue;
    const comps = fechar(uniao(doTipo.flatMap((a) => a.pols)))
      .filter((pp) => areaPol(pp) >= 1)
      .map((pol) => ({ pol, c: centroide(pol.ext) }))
      .sort((a, b) => (Math.abs(a.c[1] - b.c[1]) > 30 ? b.c[1] - a.c[1] : a.c[0] - b.c[0]));
    comps.forEach(({ pol }, i) => {
      const fontes = doTipo.filter((a) => a.pols.some((pp) => dentroPol(centroide(pp.ext), pol) || pp.ext.some((q) => dentroPol(q, pol)))).map((a) => a.id);
      const proprio = doTipo.find((a) => fontes.includes(a.id) && a.origem !== "lotes" && !/^(Área|APP|Faixa)/.test(a.nome));
      const base = tipo === "app" ? (doTipo[0].nome.startsWith("APP") ? "APP" : "FAIXA NON AEDIFICANDI") : ROTULO_AREA[tipo].toUpperCase();
      out.push({
        tipo, pol, area: areaPol(pol), fontes,
        nome: proprio?.nome ?? (comps.length > 1 ? `${base} ${String(i + 1).padStart(2, "0")}` : base),
      });
    });
  }
  return out;
}

/**
 * Rua que não se liga a nenhuma via existente (nem por outra rua) é rua sem
 * acesso: o loteamento fica com um pedaço ilhado. Só confere quando o operador
 * marcou ao menos uma via existente no perímetro.
 */
function problemasDeAcesso(ruas: RuaCalc[], lados: Resultado["ladosGleba"]): Problema[] {
  const vias = lados.filter((l) => l.tipo === "via");
  if (!vias.length || !ruas.length) return [];
  const pai = ruas.map((_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
  const toca = (r: RuaCalc, s: RuaCalc) => {
    const tol = (r.largura + s.largura) / 2 + 0.5;
    for (const q of r.eixo) for (let i = 0; i + 1 < s.eixo.length; i++) if (distSegmento(q, s.eixo[i], s.eixo[i + 1]).d < tol) return true;
    for (const q of s.eixo) for (let i = 0; i + 1 < r.eixo.length; i++) if (distSegmento(q, r.eixo[i], r.eixo[i + 1]).d < tol) return true;
    for (let i = 0; i + 1 < r.eixo.length; i++) for (let j = 0; j + 1 < s.eixo.length; j++) if (cruza(r.eixo[i], r.eixo[i + 1], s.eixo[j], s.eixo[j + 1])) return true;
    return false;
  };
  for (let i = 0; i < ruas.length; i++) for (let j = i + 1; j < ruas.length; j++) if (toca(ruas[i], ruas[j])) pai[raiz(i)] = raiz(j);
  const ligadas = new Set<number>();
  ruas.forEach((r, i) => {
    const tol = r.largura / 2 + 2;
    for (let k = 0; k + 1 < r.eixo.length; k++) {
      const a = r.eixo[k], b = r.eixo[k + 1];
      if (vias.some((v) => cruza(a, b, v.a, v.b) || [a, b].some((q) => distSegmento(q, v.a, v.b).d < tol))) ligadas.add(raiz(i));
    }
  });
  return ruas.filter((_, i) => !ligadas.has(raiz(i))).map((r) => ({
    nivel: "aviso" as const, texto: `${r.nome} não chega a nenhuma via de acesso existente`, alvo: { ponto: r.eixo[0] },
  }));
}

function cruza(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function fmt(v: number, casas = 2): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Limpa o anel de um lote para saída (remove colineares que o recorte deixou). */
export const anelLimpo = (pol: Poligono): Anel => limparAnel(pol.ext, 0.003);
