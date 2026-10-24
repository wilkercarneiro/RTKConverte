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
  antiHorario, areaAssinada, areaPol, areaPolAteCorte, dentroAnel, bufferLinha, caixa, centroide, circulo, cross, dentroPol,
  diferenca, dist, distSegmento, dot, esquerda, faixaReferencial, intersecao, lerp, limparAnel, mult, offsetPols, soma, sub,
  uniao, uniaoFechada, unit, verdeValida,
} from "./geom.ts";
import type { Anel, Poligono, Pt } from "./geom.ts";
import { criarPlano, paraPlano } from "./plano.ts";
import type { Plano } from "./plano.ts";
import { ROTULO_AREA, ehAcesso, faixaDentroDoLote } from "./modelo.ts";
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
  /** do alinhamento da frente principal até o ponto mais fundo do lote (m) */
  profundidade: number;
  /** lote de ponta que absorve a irregularidade da gleba (frente máxima não se aplica) */
  ponta?: boolean;
  /** absorveu um retalho que não cabia em lugar nenhum (fora das medidas = aviso, não erro) */
  retalho?: boolean;
  /** ângulo de projeto entre a frente e as divisas (graus), quando a fileira
   *  corta na direção da malha — lote em paralelogramo de propósito, não torto */
  angCorte?: number;
  /** direção das divisas laterais (a do leque), para redividir o lote sem perder o alinhamento */
  dirCorte?: Pt;
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
  /** fim da fileira (a divisa não passa dele) */
  sFim?: number;
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
  origem: "desenho" | "quadra" | "lotes" | "borda" | "sobra";
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
  /** faixa inteira da rua (antes do recorte pela gleba) */
  corpo: Poligono[];
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
  /** faixa non aedificandi dentro dos lotes (rodovia/ferrovia): linha a N m da divisa */
  faixasRestricao: { linha: Pt[]; largura: number; lado: number; nome: string }[];
  /** áreas públicas numeradas para a planta e o quadro (ÁREA VERDE 01, 02…) */
  publicas: AreaConsolidada[];
  sobras: Poligono[];
  /** pedaços de quadra que viraram viário (canteiro de cruzamento, calçada, bico na estrada) */
  canteiros: Poligono[];
  quadro: QuadroAreas;
  problemas: Problema[];
  /** lotes fora das faixas ou tortos (conta também no cálculo rápido — é a nota do gerador) */
  desarmonicos: number;
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
  /** profundidade padrão do lote (para reconhecer faixa de uma fileira) */
  prof: number;
  areaMin: number;
  gleba: Poligono;
  ladosGleba: Resultado["ladosGleba"];
  confrontantes: (string | null)[];
  ruas: RuaCalc[];
  /** áreas, faixas e sobras — tudo que não é lote nem rua */
  fixos: Indice;
  /** peças de quadra (para a borda entre duas quadras vizinhas não virar "rua") */
  pecas?: Indice;
  /** busca de malha do gerador: só a nota importa (pula a redistribuição das pontas) */
  busca?: boolean;
  /** nenhum retalho fica sem dono: o que cabe vira lote, o resto entra no lote vizinho */
  juntar?: boolean;
  /** pontos dos retalhos marcados como área pública (esses não viram lote) */
  marcas?: Pt[];
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
    if (ehAcesso(lado.tipo)) return { tipo: "via", ref: `borda${melhor}`, nome: lado.nome || (lado.tipo === "rodovia" ? "Rodovia" : "estrada existente") };
    return { tipo: "divisa", ref: `borda${melhor}`, nome: ctx.confrontantes[melhor] || lado.nome || "divisa da gleba" };
  }
  const f = ctx.fixos.achar(p, proprio);
  if (f) return { tipo: f.tipo, ref: f.ref, nome: f.nome };
  if (lotes) {
    const l = lotes.achar(p, proprio);
    if (l) return { tipo: l.tipo, ref: l.ref, nome: l.nome };
  }
  // quadra vizinha sem rua no meio (a faixa partida no canto): não é frente
  if (ctx.pecas) {
    const q = ctx.pecas.achar(p, proprio);
    if (q) return { tipo: "lote", ref: q.ref, nome: q.nome };
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
    if (lMax < 0.3) { novo.push(V); continue; } // lado minúsculo: um arco aqui seria um enxame de pontos no mesmo lugar
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
    if (r < 0.5) {
      // canto muito agudo: o arco que cabe é um ponto — vira chanfro
      const pc = soma(V, mult(dA, t)), pt = soma(V, mult(dB, t));
      novo.push(pc, pt);
      curvas.push({ pc, pt, meio: null, centro: null, raio: 0, desenvolvimento: dist(pc, pt), intermediarios: [] });
      continue;
    }
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
  return { pol: { ext: limparAnel(novo, 0.005), furos: pol.furos }, curvas };
}

// ---------------------------------------------------------------------------
// Quadra em L / C
// ---------------------------------------------------------------------------

/**
 * Quadra que dobra a esquina (a faixa entre a rua de contorno e a divisa, que
 * dá a volta no loteamento) não pode ser loteada numa direção só: os lotes
 * da dobra saem tortos e compridos. Ela é partida em cada canto interno onde
 * as duas frentes são rua, pela bissetriz do canto até o outro lado — cada
 * trecho reto vira uma quadra própria, dividida na direção da sua rua.
 */
function partirEmL(ctx: Contexto, pol: Poligono): Poligono[] {
  const anel = pol.ext;
  const n = anel.length;
  if (n < 5) return [pol];
  const lados = anel.map((a, i) => classificar(ctx, a, anel[(i + 1) % n], null).tipo);
  const cortes: [Pt, Pt][] = [];
  for (let i = 0; i < n; i++) {
    const V = anel[i], A = anel[(i - 1 + n) % n], B = anel[(i + 1) % n];
    if (!ehFrente(lados[(i - 1 + n) % n]) || !ehFrente(lados[i])) continue;
    const giro = cross(sub(V, A), sub(B, V));
    const convexo = giro > 0;
    const a = unit(sub(A, V)), b = unit(sub(B, V));
    const ang = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
    if (ang > (160 * Math.PI) / 180) continue; // dobra suave de rua, não é canto
    // canto aberto em que um dos braços é curto (a rua que passa pela ponta da
    // fileira): a fileira dobra nele com lote de esquina, como na planta da
    // equipe — partir aqui deixaria um triângulo e uma bissetriz torta
    if (ang > (120 * Math.PI) / 180 && Math.min(dist(A, V), dist(B, V)) < 2 * ctx.prof) continue;
    // canto interno: bissetriz para dentro é −(a+b); canto externo (a rua dobra
    // em volta da quadra): +(a+b) — este só parte faixa de uma fileira, cuja
    // bissetriz bate na divisa logo ali (numa quadra comum ela bate em outra rua)
    const r = unit(convexo ? soma(a, b) : mult(soma(a, b), -1));
    // até onde o raio atravessa a quadra
    let tMin = Infinity, ladoHit = -1;
    for (let k = 0; k < n; k++) {
      if (k === i || (k + 1) % n === i) continue;
      const p = anel[k], q = anel[(k + 1) % n];
      const s2 = sub(q, p);
      const den = cross(r, s2);
      if (Math.abs(den) < 1e-12) continue;
      const w = sub(p, V);
      const t = cross(w, s2) / den, u2 = cross(w, r) / den;
      // a bissetriz do contorno passa exatamente pelo vértice da gleba: tolerância nas pontas
      if (t > 0.05 && u2 >= -1e-6 && u2 <= 1 + 1e-6 && t < tMin) { tMin = t; ladoHit = k; }
    }
    if (!Number.isFinite(tMin) || tMin > 120) continue;
    // só parte FAIXA de uma fileira (a bissetriz bate na divisa logo ali); quadra
    // interna em L, cuja bissetriz bate noutra rua, é loteada inteira
    if (ehFrente(lados[ladoHit]) || tMin > 2.2 * ctx.prof) continue;
    cortes.push([V, soma(V, mult(r, tMin))]);
  }
  if (!cortes.length) return [pol];
  // corta pela corda, uma de cada vez, na peça que a contém (exato, sem clipper)
  let pecas: Anel[] = [anel];
  for (const [P, Q] of cortes) {
    const meio = lerp(P, Q, 0.5);
    const i = pecas.findIndex((pc) => dentroAnel(meio, pc));
    if (i < 0) continue;
    const partes = cortarPelaCorda(pecas[i], P, Q);
    if (partes) pecas.splice(i, 1, ...partes);
  }
  let out: Poligono[] = pecas.filter((pc) => pc.length >= 3).map((ext) => ({ ext: antiHorario(limparAnel(ext, 0.005)), furos: [] }));
  // lasca pequena demais para dois lotes (canto entre dois cortes, bico da
  // gleba) volta para a peça vizinha: vira o lote de ponta dela (de esquina)
  // em vez de uma quadra de um lote só ao lado de um trapézio largo
  for (let guarda = 0; guarda < 6; guarda++) {
    const i = out.findIndex((pc) => areaPol(pc) < 2 * ctx.areaMin);
    if (i < 0 || out.length < 2) break;
    let feito = false;
    for (let j = 0; j < out.length && !feito; j++) {
      if (j === i) continue;
      const u2 = uniaoFechada([out[i], out[j]]);
      if (u2.length === 1 && !u2[0].furos.length) {
        const novo = { ext: limparAnel(u2[0].ext, 0.005), furos: [] };
        out = out.filter((_, k) => k !== i && k !== j);
        out.push(novo);
        feito = true;
      }
    }
    if (!feito) break;
  }
  return out;
}

/** Parte um anel simples em dois pela corda PQ (P e Q sobre a borda). */
function cortarPelaCorda(anel: Anel, P: Pt, Q: Pt): [Anel, Anel] | null {
  const n = anel.length;
  const ondeEsta = (X: Pt): { i: number; t: number } | null => {
    let melhor: { i: number; t: number; d: number } | null = null;
    for (let i = 0; i < n; i++) {
      const { d, t } = distSegmento(X, anel[i], anel[(i + 1) % n]);
      if (!melhor || d < melhor.d) melhor = { i, t, d };
    }
    return melhor && melhor.d < 0.01 ? { i: melhor.i, t: melhor.t } : null;
  };
  const a = ondeEsta(P), b = ondeEsta(Q);
  if (!a || !b || a.i === b.i) return null;
  const caminho = (de: { i: number }, ate: { i: number }): Pt[] => {
    const out: Pt[] = [];
    for (let k = (de.i + 1) % n; ; k = (k + 1) % n) { out.push(anel[k]); if (k === ate.i) break; }
    return out;
  };
  const r1 = [P, ...caminho(a, b), Q];
  const r2 = [Q, ...caminho(b, a), P];
  if (Math.abs(areaAssinada(r1)) < 1 || Math.abs(areaAssinada(r2)) < 1) return null;
  return [r1, r2];
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
  ajustes: Map<number, AjusteLote>, p: Parametros, alinhar?: number[],
): { cortes: number[]; specs: EspecLote[] } {
  const L = fil.fim - fil.ini;
  const areaTotal = areaPol(fil.pol);
  const prof = L > 0 ? areaTotal / L : p.profundidade;
  if (L < p.frenteMin * 0.5) return { cortes: [], specs: [{ indice: 0, fixo: false }] };

  const fixos = [...ajustes.values()].filter((a) => a.frente || a.area);
  const areaAte = (s: number) => areaPolAteCorte(fil.pol, o, u, s);
  const livres = (n: number): EspecLote[] => Array.from({ length: n }, (_, i) => ({ indice: i, fixo: false }));

  // Perfil de profundidade ao longo da rua: numa fileira que encosta numa
  // divisa torta (ou num ângulo de rua) a profundidade varia, e lote de frente
  // fixa sai desproporcional — raso e pequeno de um lado, um triângulo no fim.
  const profEm = (s: number) => areaAte(s + 0.5) - areaAte(s - 0.5);
  const amostras: number[] = [];
  for (let k = 0; k < 11; k++) amostras.push(profEm(fil.ini + 0.5 + ((L - 1) * k) / 10));
  const ordenadas = [...amostras].sort((a, b) => a - b);
  const profMed = ordenadas[5];
  const irregular = modo === "frente" && L > 2 * valor && ordenadas[0] < 0.88 * ordenadas[10];
  const aref = Math.max(p.areaMin, (modo === "frente" ? valor : L / Math.max(1, valor)) * profMed);

  // fundo com fundo: a fileira de trás segue os cortes da da frente, para as
  // divisas laterais dos lotes se encontrarem na linha de fundo
  if (alinhar && modo !== "area" && !fixos.length) {
    const cs = alinhar.filter((x) => x > fil.ini + p.frenteMin * 0.5 && x < fil.fim - p.frenteMin * 0.5).sort((a, b) => a - b);
    const final = suavizarPontas(cs, fil, areaAte, areaTotal, aref, p);
    return { cortes: final, specs: livres(final.length + 1) };
  }

  // fileira irregular sem trava: lote raso fica mais largo até chegar à área de
  // referência, e as pontas são redistribuídas em áreas iguais
  if (irregular && !fixos.length) {
    const f = valor;
    const cortes: number[] = [];
    let pos = fil.ini;
    for (let guarda = 0; guarda < 2000; guarda++) {
      const base = cortes.length ? areaAte(pos) : 0; // o 1º lote leva o que fica antes da frente
      let w = f;
      if (areaAte(pos + w) - base < 0.92 * aref) {
        let lo = f, hi = Math.max(f, Math.min(2.5 * f, p.frenteMax));
        if (areaAte(pos + hi) - base < aref) w = hi;
        else {
          for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (areaAte(pos + m) - base < aref) lo = m; else hi = m; }
          w = (lo + hi) / 2;
        }
      }
      if (pos + w > fil.fim - 0.5 * f) break;
      pos += w;
      cortes.push(pos);
    }
    const final = suavizarPontas(cortes, fil, areaAte, areaTotal, aref, p);
    return { cortes: final, specs: livres(final.length + 1) };
  }
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
  // fileira regular também pode terminar num triângulo (canto da divisa): só
  // o que passa muito do padrão é redistribuído — o lote de esquina um pouco
  // maior (sobra nas esquinas) é de propósito e fica
  if (!fixos.length && modo === "frente" && cortes.length >= 2) {
    const final = suavizarPontas(cortes, fil, areaAte, areaTotal, aref, p, 1.9);
    if (final.length !== cortes.length || final.some((x, i) => Math.abs(x - cortes[i]) > 1e-6)) return { cortes: final, specs: livres(final.length + 1) };
  }
  return { cortes, specs: specs.slice(0, cortes.length + 1) };
}

/**
 * Quantos lotes na ponta: o que a área de referência pede, mas sem passar da
 * área nem da frente máxima — e sem descer da área nem da frente mínima.
 */
function partesDaPonta(area: number, vao: number, pedido: number, p: Parametros): number {
  const minimo = Math.max(1, Math.ceil(area / p.areaMax - 1e-6), Math.ceil(vao / p.frenteMax - 1e-6));
  const maximo = Math.max(1, Math.min(Math.floor(area / p.areaMin + 1e-6), Math.floor(vao / p.frenteMin + 1e-6)));
  return Math.max(1, Math.min(maximo, Math.max(minimo, pedido)));
}

/**
 * Pontas desproporcionais (lote muito menor ou muito maior que o de
 * referência, ou de frente curta) são refeitas: os últimos lotes da ponta
 * dividem a área deles em partes iguais. Em vez de um triângulo de 60 m² ou
 * de um lote de 700 m² ao lado de outros de 250, saem lotes parecidos.
 */
function suavizarPontas(
  cortes: number[], fil: FileiraCalc, areaAte: (s: number) => number, total: number, aref: number, p: Parametros,
  limiteMaior = 1.45,
): number[] {
  let cs = [...cortes];
  const area = (i: number) => (i >= cs.length ? total : areaAte(cs[i])) - (i === 0 ? 0 : areaAte(cs[i - 1]));
  const frente = (i: number) => (i >= cs.length ? fil.fim : cs[i]) - (i === 0 ? fil.ini : cs[i - 1]);
  const ruim = (i: number) => {
    const a = area(i);
    return a < 0.8 * aref || a > Math.min(limiteMaior * aref, p.areaMax) || frente(i) < p.frenteMin - 0.005 || frente(i) > p.frenteMax + 0.05;
  };
  const dividirIgual = (aIni: number, aFim: number, m: number): number[] => {
    const out: number[] = [];
    for (let j = 1; j < m; j++) {
      const alvo = aIni + ((aFim - aIni) * j) / m;
      let lo = fil.ini - 1e3, hi = fil.fim + 1e3;
      for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2; if (areaAte(mid) < alvo) lo = mid; else hi = mid; }
      out.push((lo + hi) / 2);
    }
    return out;
  };
  const n = () => cs.length + 1;
  // fim da fileira: os últimos k lotes viram m lotes de área igual
  if (n() >= 2 && ruim(n() - 1)) {
    const k = Math.min(3, n());
    const fica = n() - k - 1; // índice do último corte mantido (-1 = começo da fileira)
    const aIni = fica >= 0 ? areaAte(cs[fica]) : 0;
    const vao = fil.fim - (fica >= 0 ? cs[fica] : fil.ini);
    const m = partesDaPonta(total - aIni, vao, Math.min(k + 1, Math.round((total - aIni) / aref)), p);
    cs = [...cs.slice(0, fica + 1), ...dividirIgual(aIni, total, m)];
  }
  // começo da fileira
  if (n() >= 2 && ruim(0)) {
    const k = Math.min(3, n());
    const aFim = k - 1 < cs.length ? areaAte(cs[k - 1]) : total;
    const vao = (k - 1 < cs.length ? cs[k - 1] : fil.fim) - fil.ini;
    const m = partesDaPonta(aFim, vao, Math.min(k + 1, Math.round(aFim / aref)), p);
    cs = [...dividirIgual(0, aFim, m), ...cs.slice(Math.min(k - 1, cs.length))];
  }
  return cs.filter((x) => x > fil.ini + 0.3 && x < fil.fim - 0.3);
}

interface ResultadoQuadra {
  lotes: Omit<Lote, "id" | "quadra" | "numero" | "lados" | "frente" | "profundidade" | "esquina" | "rua" | "problemas" | "naDivisa">[];
  destinos: Map<string, TipoArea>;
  cortes: Corte[];
  fundo: Quadra["fundo"];
  sobras: Poligono[];
  /** bico da esquina na estrada que virou parte do cruzamento */
  canteiros?: Poligono[];
  origem: Pt; u: Pt; v: Pt;
  fileiras: number;
  problemas: string[];
  /** lotes que nasceram fora do mínimo (área ou frente) — mede se a frente escolhida foi boa */
  ruins: number;
  /** quantas frentes candidatas a quadra tem */
  nFaces: number;
  /** lotes de canto torto (menor ângulo abaixo de 70°): paralelogramo, cunha */
  tortos: number;
  /** distância da rua principal até a rua oposta (ou até o fundo da quadra), m */
  largura: number;
  /** lotes com fundo abaixo da profundidade mínima (fileira estreita demais) */
  rasos: number;
}

/**
 * Regras do lote, na ordem em que o operador as lê: as mínimas (Lei 6.766 e
 * município) e as faixas de harmonia do projeto. É a mesma lista que a edição
 * consulta para não deixar passar lote fora das regras. No lote de esquina a
 * frente soma as duas ruas e o "fundo" é a largura dele: frente máxima e
 * profundidade mínima não se aplicam.
 */
/**
 * Folga sobre as máximas (3%): absorve a nesga da ponta da fileira sem criar
 * um lote nanico ao lado. Acima disso o lote é dividido/aparado — ou avisado.
 */
export const FOLGA_MAX = 1.03;
export const acimaDaArea = (a: number, p: Parametros) => a > p.areaMax * FOLGA_MAX + 0.5;
/** Profundidade-limite: a máxima com a mesma folga de 3% da área e da frente (mín. 0,5 m) —
 *  o retalho que encosta no fundo e acrescenta 1 m num lote de 40 m não vira aviso. */
export const limiteFundo = (p: Parametros) => Math.max(p.profundidadeMax * FOLGA_MAX, p.profundidadeMax + 0.5);
export const acimaDaFrente = (f: number, p: Parametros) => f > p.frenteMax * FOLGA_MAX + 0.05;

export function foraDasFaixas(
  l: Pick<Lote, "area" | "frente" | "profundidade"> & { rasa?: number }, p: Parametros, semFrente = false, esquina = false,
  /** frente para a rua principal (o lote de rua a rua não soma as duas) — vale para a máxima */
  testada = l.frente,
  /** lote de ponta: mantido por compatibilidade (as máximas de área e fundo valem para ele também) */
  ponta = false,
): string[] {
  const out: string[] = [];
  const fator = 1;
  void ponta;
  if (l.area < p.areaMin - 0.01) out.push(`área ${fmt(l.area)} m² abaixo do mínimo de ${fmt(p.areaMin)} m²`);
  else if (acimaDaArea(l.area, p)) out.push(`área ${fmt(l.area)} m² acima do máximo de ${fmt(fator * p.areaMax)} m²`);
  if (semFrente) out.push("lote sem frente para rua");
  // a mínima também vale para a frente principal: o lote de rua a rua com
  // 10 m em cada uma não tem 20 m de frente
  else if (Math.min(l.frente, testada > 0 ? testada : l.frente) < p.frenteMin - 0.005) out.push(`frente ${fmt(Math.min(l.frente, testada > 0 ? testada : l.frente))} m abaixo do mínimo de ${fmt(p.frenteMin)} m`);
  else if (!esquina && acimaDaFrente(testada, p)) out.push(`frente ${fmt(testada)} m acima do máximo de ${fmt(p.frenteMax)} m`);
  if (!semFrente && l.profundidade > fator * limiteFundo(p)) out.push(`profundidade ${fmt(l.profundidade)} m acima do máximo de ${fmt(fator * p.profundidadeMax)} m`);
  else if (!semFrente && !esquina && (l.rasa ?? l.profundidade) > 0 && (l.rasa ?? l.profundidade) < p.profundidadeMin - 0.5) out.push(`profundidade ${fmt(l.rasa ?? l.profundidade)} m abaixo do mínimo de ${fmt(p.profundidadeMin)} m`);
  return out;
}

type Seg = [Pt, Pt];

/**
 * Lote com forma de lote: no máximo um canto reentrante (o "L" da esquina) e
 * até 6 cantos. Junção que dá gancho ou dente não é aceita.
 */
export function formaDeLote(pol: Poligono): boolean {
  const e = pol.ext;
  // orientação: no anel anti-horário, canto reentrante tem produto vetorial negativo
  const sinal = areaAssinada(e) >= 0 ? 1 : -1;
  let reentrantes = 0;
  for (let i = 0; i < e.length; i++) {
    const a = e[(i + e.length - 1) % e.length], q = e[i], c = e[(i + 1) % e.length];
    if (dist(a, q) < 0.5 || dist(q, c) < 0.5) continue;
    const cr = cross(sub(q, a), sub(c, q)) * sinal;
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(a, q)), unit(sub(c, q)))))) * 180) / Math.PI;
    if (cr < 0 && ang < 170) reentrantes++;
  }
  return reentrantes <= 1 && verticesReais(pol) <= 6;
}

/** Vértices que fazem canto de verdade (menos de 170°) — 3 é triângulo. */
export function verticesReais(pol: Poligono): number {
  const e = pol.ext;
  let n = 0;
  for (let i = 0; i < e.length; i++) {
    const a = e[(i + e.length - 1) % e.length], q = e[i], c = e[(i + 1) % e.length];
    if (dist(a, q) < 0.05 || dist(q, c) < 0.05) continue;
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot(unit(sub(a, q)), unit(sub(c, q)))))) * 180) / Math.PI;
    if (ang < 170) n++;
  }
  return n;
}

/** Menor ângulo interno do lote, em graus (vértices quase retos/rasos não contam). */
export function anguloMinimo(pol: Poligono, quadra?: Poligono): number {
  const e = pol.ext;
  // canto feito só pelo contorno da quadra (rua com rua, rua com divisa) é o
  // que o terreno dá — o lote de esquina da planta da equipe também o tem; o
  // que se mede é o canto que a divisão criou (onde há linha de corte)
  const noContorno = (a: Pt, b: Pt) => {
    if (!quadra) return false;
    const m = lerp(a, b, 0.5);
    return quadra.ext.some((x, k) => distSegmento(m, x, quadra.ext[(k + 1) % quadra.ext.length]).d < 0.05);
  };
  let m = 180;
  for (let i = 0; i < e.length; i++) {
    const a = e[(i + e.length - 1) % e.length], q = e[i], c = e[(i + 1) % e.length];
    if (dist(a, q) < 1 || dist(q, c) < 1) continue; // arco de esquina: muitos vértices curtos
    const u = unit(sub(a, q)), v = unit(sub(c, q));
    const ang = (Math.acos(Math.max(-1, Math.min(1, dot(u, v)))) * 180) / Math.PI;
    if (ang >= 175 || ang >= m) continue;
    if (quadra && ang < 70 && noContorno(a, q) && noContorno(q, c)) continue;
    m = ang;
  }
  return m;
}

// cálculo repetido para o mesmo polígono (o gerador mede cada lote várias vezes)
const cacheFrentes = new WeakMap<Poligono, Seg[]>();
const cacheFundo = new WeakMap<Poligono, number>();

/** Lados do lote que dão para rua. */
function frentesDe(pol: Poligono, naFrente: (a: Pt, b: Pt) => boolean): Seg[] {
  const c = cacheFrentes.get(pol);
  if (c) return c;
  const out = frentesBrutas(pol, naFrente);
  cacheFrentes.set(pol, out);
  return out;
}

/**
 * Frente para a rua principal: os lados paralelos à frente mais longa, no
 * mesmo sentido. O lote que vai de rua a rua (frente e fundo para rua) não
 * soma as duas.
 */
function frentePrincipal(segs: Seg[]): number {
  if (!segs.length) return 0;
  const [a0, b0] = segs.reduce((m, x) => (dist(x[0], x[1]) > dist(m[0], m[1]) ? x : m), segs[0]);
  const d0 = unit(sub(b0, a0));
  let mesmo = 0, oposto = 0;
  for (const [a, b] of segs) { const c = dot(unit(sub(b, a)), d0); if (c > 0.5) mesmo += dist(a, b); else if (c < -0.5) oposto += dist(a, b); }
  return Math.max(mesmo, oposto);
}

/** Profundidade guardada por polígono. */
function fundoDe(pol: Poligono, segs: Seg[]): number {
  let f = cacheFundo.get(pol);
  if (f === undefined) { f = profundidadeDe(pol, segs); cacheFundo.set(pol, f); }
  return f;
}

const cacheFundoMax = new WeakMap<Poligono, number>();
/** Profundidade para a máxima (medida oblíqua), guardada por polígono. */
function fundoMaxDe(pol: Poligono, segs: Seg[]): number {
  let f = cacheFundoMax.get(pol);
  if (f === undefined) { f = profundidadeDe(pol, segs, true); cacheFundoMax.set(pol, f); }
  return f;
}

/** Passa da profundidade máxima? Lote cuja diagonal nem chega lá não precisa ser medido. */
function passaDoFundo(pol: Poligono, segs: Seg[], p: Parametros): boolean {
  const b = caixa(pol.ext);
  if (Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) <= limiteFundo(p)) return false;
  return fundoMaxDe(pol, segs) > limiteFundo(p);
}

function frentesBrutas(pol: Poligono, naFrente: (a: Pt, b: Pt) => boolean): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i < pol.ext.length; i++) {
    const a = pol.ext[i], b = pol.ext[(i + 1) % pol.ext.length];
    if (dist(a, b) > 0.05 && naFrente(a, b)) out.push([a, b]);
  }
  return out;
}

/**
 * Frente em duas direções: lote de esquina. Conta o arco da esquina (muitos
 * segmentos curtos): 3 m ou mais de frente a mais de 30° da frente principal.
 */
export function esquinaDe(segs: Seg[]): boolean {
  if (!segs.length) return false;
  const [a0, b0] = segs.reduce((m, x) => (dist(x[0], x[1]) > dist(m[0], m[1]) ? x : m), segs[0]);
  const d0 = unit(sub(b0, a0));
  let fora = 0;
  for (const [a, b] of segs) if (Math.abs(dot(unit(sub(b, a)), d0)) < 0.866) fora += dist(a, b);
  return fora >= 3;
}

/**
 * Profundidade do lote: a maior distância de um ponto dele até a frente.
 * Pega também o lote que avança de lado, atrás do fim da rua (a ponta da
 * gleba), que a medida perpendicular à frente não enxerga.
 */
export function profundidadeDe(pol: Poligono, segs: Seg[], obliqua = false): number {
  if (!segs.length) return 0;
  const pts: Pt[] = [];
  pol.ext.forEach((q, i) => { pts.push(q, lerp(q, pol.ext[(i + 1) % pol.ext.length], 0.5)); });
  // `obliqua` (para a MÁXIMA): no lote de divisa oblíqua (leque, até 35° com a
  // frente) o canto do fundo cai de lado, além da ponta da frente — ali conta a
  // distância à reta da frente, não ao segmento (senão um lote de 35 m mediria
  // 45). Só o ponto que passa dessa inclinação (lote que contorna o fim da rua)
  // usa o segmento. A MÍNIMA segue medida no segmento: a cunha rasa não passa.
  const cot35 = 1 / Math.tan((35 * Math.PI) / 180);
  const ate = (q: Pt, a: Pt, b: Pt) => {
    const L = dist(a, b);
    if (L < 1e-9) return dist(q, a);
    const d = unit(sub(b, a)), w = sub(q, a);
    const t = dot(w, d), h = Math.abs(cross(d, w));
    return obliqua && t >= -cot35 * h && t <= L + cot35 * h ? h : distSegmento(q, a, b).d;
  };
  let m = 0;
  for (const q of pts) m = Math.max(m, Math.min(...segs.map(([a, b]) => ate(q, a, b))));
  return m;
}

/** Faixa até `prof` metros de cada frente (com folga lateral `ext`), para aparar o fundo. */
function corredorDaFrente(pol: Poligono | Poligono[], segs: Seg[], prof: number, ext: number): Poligono[] {
  const pols = Array.isArray(pol) ? pol : [pol];
  const faixas = segs.map(([a, b]) => {
    const d = unit(sub(b, a));
    let n = esquerda(d);
    const teste = soma(lerp(a, b, 0.5), mult(n, 0.05));
    if (!pols.some((pg) => dentroPol(teste, pg))) n = mult(n, -1);
    // abre até 35° nas pontas, como a medida da profundidade (profundidadeDe):
    // o lote de divisa oblíqua tem o canto do fundo de lado, além da frente —
    // a faixa reta o cortaria em cunha
    const abre = prof / Math.tan((35 * Math.PI) / 180);
    const P = (s2: number, t: number) => soma(a, soma(mult(d, s2), mult(n, t)));
    const L = dist(a, b);
    return { ext: antiHorario([P(-ext, -1), P(L + ext, -1), P(L + ext + abre, prof), P(-ext - abre, prof)]), furos: [] };
  });
  return uniao(faixas);
}

/**
 * Direção das divisas laterais de uma fileira, como na planta aprovada da
 * equipe: paralelas às ruas que encontram a rua da fileira (a fileira das
 * ruas da família corta paralela à rua de contorno, e a fileira do contorno
 * corta paralela às ruas da família). Assim a quadra de pontas oblíquas sai
 * toda em lotes iguais, sem cunha. Volta null (perpendicular) quando não há
 * rua cruzando ou quando o corte ficaria a menos de 35° da frente.
 */
function direcaoDeCorte(ctx: Contexto, pol: Poligono, naFrente: (a: Pt, b: Pt) => boolean, uf: Pt): Pt | null {
  // ponto da frente: meio do lado de frente mais longo
  let m: Pt | null = null, lm = 0;
  for (let i = 0; i < pol.ext.length; i++) {
    const a = pol.ext[i], b = pol.ext[(i + 1) % pol.ext.length];
    if (naFrente(a, b) && dist(a, b) > lm && Math.abs(dot(unit(sub(b, a)), uf)) > 0.9) { lm = dist(a, b); m = lerp(a, b, 0.5); }
  }
  if (!m) return null;
  // a rua da frente: eixo paralelo à fileira mais perto desse ponto
  let rua: RuaCalc | null = null, dm = Infinity;
  for (const r of ctx.ruas) for (let i = 0; i + 1 < r.eixo.length; i++) {
    const a = r.eixo[i], b = r.eixo[i + 1];
    if (Math.abs(dot(unit(sub(b, a)), uf)) < 0.95) continue;
    const d = distSegmento(m, a, b).d;
    if (d < dm) { dm = d; rua = r; }
  }
  if (!rua || dm > rua.largura) return null;
  const naRua = (q: Pt, folga: number) => rua!.eixo.some((a, i) => i + 1 < rua!.eixo.length && distSegmento(q, a, rua!.eixo[i + 1]).d < folga);
  // ruas que encontram a da frente (a ponta delas cai no eixo dela); fica a do encontro mais perto
  let melhor: { d: number; dir: Pt } | null = null;
  for (const r of ctx.ruas) {
    if (r === rua || r.eixo.length < 2) continue;
    const pontas: [Pt, Pt][] = [[r.eixo[0], r.eixo[1]], [r.eixo[r.eixo.length - 1], r.eixo[r.eixo.length - 2]]];
    for (const [pt, viz] of pontas) {
      if (!naRua(pt, r.largura + rua.largura)) continue;
      const dir = unit(sub(viz, pt));
      const d = dist(pt, m);
      if (!melhor || d < melhor.d) melhor = { d, dir };
    }
  }
  if (!melhor) return null;
  // ângulo com a frente: abaixo de 35° o lote fica torto demais
  const seno = Math.abs(cross(melhor.dir, uf));
  if (seno < Math.sin((35 * Math.PI) / 180) || seno > 0.995) return null;
  // aponta para dentro da fileira (o mesmo lado da normal)
  return dot(melhor.dir, esquerda(uf)) >= 0 ? melhor.dir : mult(melhor.dir, -1);
}

/**
 * Direção das pontas de uma fileira: o lado mais longo em cada extremidade,
 * orientado para dentro da fileira. Só vale se fizer pelo menos 35° com a
 * frente — ponta em bico não serve de guia. Ponta que é rua ou rodovia manda
 * sobre ponta que é divisa, e esta sobre a linha interna que separa as
 * fileiras: se uma ponta vale mais que a outra, a fileira toda segue a dela
 * (na planta da equipe só a fileira entre duas ruas abre em leque).
 */
function direcoesDasPontas(
  pol: Poligono, quadra: Poligono, naFrente: (a: Pt, b: Pt) => boolean, uf: Pt, o: Pt, ini: number, fim: number,
): { ini: Pt | null; fim: Pt | null } {
  const noContorno = (q: Pt) => quadra.ext.some((a, i) => distSegmento(q, a, quadra.ext[(i + 1) % quadra.ext.length]).d < 0.3);
  const vv = esquerda(uf);
  const L = fim - ini;
  if (!(L > 0)) return { ini: null, fim: null };
  type Cand = { d: Pt; c: number; peso: number };
  const melhor = (m: Cand | null, x: Cand) => !m || x.peso > m.peso || (x.peso === m.peso && x.c > m.c);
  let mi: Cand | null = null, mf: Cand | null = null;
  for (let i = 0; i < pol.ext.length; i++) {
    const a = pol.ext[i], b = pol.ext[(i + 1) % pol.ext.length];
    const c = dist(a, b);
    if (c < 4) continue; // a ponta pode ser rua ou rodovia: o lado de frente sai pelo ângulo
    let d = unit(sub(b, a));
    if (Math.abs(cross(d, uf)) < Math.sin((35 * Math.PI) / 180)) continue;
    if (dot(d, vv) < 0) d = mult(d, -1);
    const sm = dot(sub(lerp(a, b, 0.5), o), uf);
    const x: Cand = { d, c, peso: naFrente(a, b) ? 2 : noContorno(lerp(a, b, 0.5)) ? 1 : 0 };
    if (sm <= ini + 0.2 * L && melhor(mi, x)) mi = x;
    if (sm >= fim - 0.2 * L && melhor(mf, x)) mf = x;
  }
  if (mi && mf && mi.peso !== mf.peso) return mi.peso > mf.peso ? { ini: mi.d, fim: null } : { ini: null, fim: mf.d };
  return { ini: mi?.d ?? null, fim: mf?.d ?? null };
}

/** Direção da frente principal (a mais longa) e uma origem nela. */
function frenteMaiorDe(segs: Seg[]): { a: Pt; d: Pt } | null {
  if (!segs.length) return null;
  const [a, b] = segs.reduce((m, x) => (dist(x[0], x[1]) > dist(m[0], m[1]) ? x : m), segs[0]);
  return { a, d: unit(sub(b, a)) };
}

/** `m` partes de frente igual (cortes equidistantes ao longo da frente, perpendiculares a `d`). */
/** Posição ao longo de `d` medida por retas na direção `c` (perpendicular se não houver `c`). */
const posCorte = (q: Pt, o: Pt, d: Pt, c?: Pt) => (c ? cross(sub(q, o), c) / cross(d, c) : dot(sub(q, o), d));

function partirFrenteIgual(pol: Poligono, segs: Seg[], o: Pt, d: Pt, m: number, GR: number, c?: Pt): Poligono[] | null {
  if (c && Math.abs(cross(d, c)) < 0.5) c = undefined;
  const us = segs.flatMap(([a, b]) => [posCorte(a, o, d, c), posCorte(b, o, d, c)]);
  if (!us.length) return null;
  const f0 = Math.min(...us), f1 = Math.max(...us);
  const todos = pol.ext.map((q) => posCorte(q, o, d, c));
  const cortes = [Math.min(...todos) - 1, ...Array.from({ length: m - 1 }, (_, j) => f0 + ((f1 - f0) * (j + 1)) / m), Math.max(...todos) + 1];
  const out: Poligono[] = [];
  for (let j = 0; j < m; j++) {
    const ps = intersecao([pol], [faixaReferencial(o, d, c ?? esquerda(d), cortes[j], cortes[j + 1], -GR, GR)]).filter((x) => areaPol(x) > 0.05);
    if (ps.length !== 1) return null;
    out.push({ ext: limparAnel(ps[0].ext, 0.005), furos: ps[0].furos });
  }
  return out;
}

/**
 * `m` partes de área igual, cortadas perpendiculares à direção `d` — ou na
 * direção `c` (a divisa do leque); null se alguma sair em pedaços.
 */
function partirIgual(pol: Poligono, o: Pt, d: Pt, m: number, GR: number, c?: Pt): Poligono[] | null {
  if (c && Math.abs(cross(d, c)) < 0.5) c = undefined;
  const area = areaPol(pol);
  const us = pol.ext.map((q) => posCorte(q, o, d, c));
  const lo0 = Math.min(...us), hi0 = Math.max(...us);
  // corte oblíquo: o cisalhamento (s, t) → (s − t·c_d/c_n, t) preserva área e
  // deixa as linhas na direção `c` perpendiculares — vale a conta rápida
  let ateCorte = (x: number) => areaPolAteCorte(pol, o, d, x);
  if (c) {
    const n = esquerda(d), k = dot(c, d) / dot(c, n);
    const cis = (q: Pt): Pt => { const sv = dot(sub(q, o), d), tv = dot(sub(q, o), n); return [sv - tv * k, tv]; };
    const polC: Poligono = { ext: pol.ext.map(cis), furos: pol.furos.map((f) => f.map(cis)) };
    ateCorte = (x: number) => areaPolAteCorte(polC, [0, 0], [1, 0], x);
  }
  const cortes: number[] = [lo0 - 1];
  for (let j = 1; j < m; j++) {
    let lo = lo0, hi = hi0;
    for (let it = 0; it < 32; it++) { const mid = (lo + hi) / 2; if (ateCorte(mid) < (area * j) / m) lo = mid; else hi = mid; }
    cortes.push((lo + hi) / 2);
  }
  cortes.push(hi0 + 1);
  const out: Poligono[] = [];
  for (let j = 0; j < m; j++) {
    const ps = intersecao([pol], [faixaReferencial(o, d, c ?? esquerda(d), cortes[j], cortes[j + 1], -GR, GR)]).filter((x) => areaPol(x) > 0.05);
    if (ps.length !== 1) return null;
    out.push({ ext: limparAnel(ps[0].ext, 0.005), furos: ps[0].furos });
  }
  return out;
}

/**
 * Harmonia dos lotes — nenhum sai fora das faixas do projeto:
 *  1. fundo além da profundidade máxima (a ponta aguda da gleba, a quadra
 *     triangular) é aparado; o que sobra vira retalho, e o gerador o faz área
 *     verde. Só quando o fundo cortado dá para a divisa: preso entre lotes
 *     ele viraria ilha sem acesso;
 *  2. área ou frente acima da máxima: o lote é dividido em partes de área
 *     igual, cortadas perpendiculares à frente, cada uma com frente e área
 *     mínimas. Se nenhuma divisão serve, fica (e o lote aparece com aviso).
 */
function harmonizar(
  lotes: ResultadoQuadra["lotes"], destinos: Map<string, TipoArea>, naFrente: (a: Pt, b: Pt) => boolean,
  ladosQuadra: Lado[], p: Parametros, GR: number, busca = false,
): { lotes: ResultadoQuadra["lotes"]; sobras: Poligono[]; viario: Poligono[] } {
  const out: ResultadoQuadra["lotes"] = [];
  const sobras: Poligono[] = [];
  const viario: Poligono[] = [];
  const frenteDe = (pol: Poligono) => {
    let s = 0;
    for (let i = 0; i < pol.ext.length; i++) { const a = pol.ext[i], b = pol.ext[(i + 1) % pol.ext.length]; if (naFrente(a, b)) s += dist(a, b); }
    return s;
  };
  const fundos = ladosQuadra.filter((l) => !ehFrente(l.tipo));
  // comprimento do contorno do retalho que encosta num fundo da quadra (divisa, sobra)
  const naDivisa = (pol: Poligono) => {
    let s = 0;
    for (let i = 0; i < pol.ext.length; i++) {
      const a = pol.ext[i], b = pol.ext[(i + 1) % pol.ext.length];
      const m = lerp(a, b, 0.5);
      if (fundos.some((l) => distSegmento(m, l.a, l.b).d < 0.05)) s += dist(a, b);
    }
    return s;
  };
  const vias = ladosQuadra.filter((l) => l.tipo === "via");
  const naEstrada = (pol: Poligono) => pol.ext.some((q, k) => {
    const m = lerp(q, pol.ext[(k + 1) % pol.ext.length], 0.5);
    return vias.some((l) => distSegmento(m, l.a, l.b).d < 0.05);
  });
  // corte do fundo pela frente da FILEIRA inteira (e não lote a lote): os fundos
  // aparados ficam numa linha só, sem dente de serra onde a rua dobra
  const corredores = new Map<number, Poligono[]>();
  const corredorDaFileira = (fil: number): Poligono[] => {
    let c = corredores.get(fil);
    if (!c) {
      // as frentes de cada lote, lado a lado, dão o mesmo corredor que a fileira unida
      const base = lotes.filter((y) => y.fileira === fil && !destinos.has(`${y.fileira}:${y.indice}`)).map((y) => y.pol);
      const segsF = base.flatMap((b) => frentesDe(b, naFrente));
      c = corredorDaFrente(base, segsF, p.profundidadeMax - 1, 0.25 * p.frente);
      corredores.set(fil, c);
    }
    return c;
  };
  for (const l of lotes) {
    // lote que o operador ajustou (trava, unir, dividir) fica como ele deixou — com aviso, se for o caso
    if (destinos.has(`${l.fileira}:${l.indice}`) || l.ajustado) { out.push(l); continue; }
    let pol = l.pol;
    let segs = frentesDe(pol, naFrente);
    if (!segs.length) { out.push(l); continue; }
    if (passaDoFundo(pol, segs, p)) {
      const corredor = corredorDaFileira(l.fileira);
      const frentes = intersecao([pol], corredor).sort((x, y) => areaPol(y) - areaPol(x));
      const resto = diferenca([pol], corredor).filter((r) => areaPol(r) > 0.5);
      const ok = frentes.length > 0 && areaPol(frentes[0]) >= p.areaMin - 0.01 && frenteDe(frentes[0]) >= p.frenteMin - 0.005
        && resto.every((r) => naDivisa(r) >= Math.min(5, 0.25 * Math.sqrt(areaPol(r))) && !naEstrada(r));
      if (ok) {
        pol = { ext: limparAnel(frentes[0].ext, 0.005), furos: frentes[0].furos };
        sobras.push(...frentes.slice(1).filter((r) => areaPol(r) > 0.5), ...resto);
        segs = frentesDe(pol, naFrente);
      }
    }
    const fr = frenteMaiorDe(segs);
    const area = areaPol(pol), f = frenteDe(pol);
    const esquina = esquinaDe(segs);
    let partes = [pol];
    if (fr && (acimaDaArea(area, p) || (!esquina && acimaDaFrente(f, p)))) {
      const mMax = Math.min(Math.floor(f / p.frenteMin + 1e-6), Math.floor(area / p.areaMin + 1e-6));
      const m0 = Math.min(mMax, Math.max(Math.ceil(area / p.areaMax - 1e-6), esquina ? 1 : Math.ceil(f / p.frenteMax - 1e-6), Math.round(area / p.areaPadrao)));
      for (let m = m0; m >= 2; m--) {
        const ps = partirIgual(pol, fr.a, fr.d, m, GR, l.dirCorte);
        if (ps && ps.every((x) => areaPol(x) >= p.areaMin - 0.01 && frenteDe(x) >= p.frenteMin - 0.005)) { partes = ps; break; }
      }
    }
    if (partes.length === 1 && pol === l.pol) { out.push(l); continue; }
    // as partes seguem a ordem da fileira (a frente do lote corre no sentido dela)
    partes.forEach((x, k) => out.push({ ...l, pol: x, area: areaPol(x), indice: partes.length > 1 ? l.indice + k / 1000 : l.indice }));
  }
  // cunha (ponta com menos de 30°, onde a rua encontra a divisa) e lote raso
  // (fundo abaixo da profundidade mínima) somam-se ao vizinho da fileira quando
  // os dois juntos cabem nas máximas: sai um lote maior e bem formado em vez de
  // um triângulo ou de uma tira que ninguém compra
  const livre = (x: ResultadoQuadra["lotes"][number]) => !destinos.has(`${x.fileira}:${x.indice}`) && !x.ajustado;
  const torto = (pol: Poligono) => {
    if (anguloMinimo(pol) < 30) return true;
    const segs = frentesDe(pol, naFrente);
    if (!segs.length) return false;
    // nesga abaixo das mínimas no canto da gleba: com área verde, a reserva a
    // resolve (une ou faz verde); sem área verde, é aqui que ela some
    if (p.pctVerdeMin <= 0 && (areaPol(pol) < p.areaMin - 0.01 || frenteDe(pol) < p.frenteMin - 0.005)) return true;
    if (esquinaDe(segs)) return false;
    // lote retangular tem fundo = área ÷ frente: bem acima da mínima, nem mede
    const fr = segs.reduce((s2, [a, b]) => s2 + dist(a, b), 0);
    if (areaPol(pol) / Math.max(0.01, fr) < 1.5 * p.profundidadeMin && fundoDe(pol, segs) < p.profundidadeMin - 0.5) return true;
    // triângulo que ainda passa da frente máxima (a ponta larga e rasa da fileira)
    return verticesReais(pol) <= 3 && acimaDaFrente(frenteDe(pol), p);
  };
  // só nas pontas da fileira: no meio, juntar quebraria o alinhamento fundo com fundo
  const ehPonta = (x: ResultadoQuadra["lotes"][number]) => {
    const ids = out.filter((y) => y.fileira === x.fileira).map((y) => y.indice);
    return x.indice === Math.min(...ids) || x.indice === Math.max(...ids);
  };
  // Ponta da fileira, como o projetista faz: a cunha e os 1 a 3 lotes vizinhos
  // são redivididos em um lote a menos, com divisas perpendiculares à rua. A
  // ponta é absorvida por lotes um pouco maiores, cada um dentro das faixas —
  // sem triângulo, sem tira e sem retalho.
  const bomLote = (pol: Poligono) => {
    const a = areaPol(pol);
    if (a < p.areaMin - 0.01 || acimaDaArea(a, p)) return false;
    const segs = frentesDe(pol, naFrente);
    if (!segs.length || frenteDe(pol) < p.frenteMin - 0.005) return false;
    if (passaDoFundo(pol, segs, p)) return false; // o canto agudo da gleba pode ficar no lote da ponta
    if (!esquinaDe(segs)) {
      if (acimaDaFrente(frentePrincipal(segs), p)) return false;
      if (fundoDe(pol, segs) < p.profundidadeMin - 0.5) return false;
    }
    return true;
  };
  for (let volta = 0; volta < (busca ? 0 : 4); volta++) {
    let mudou = false;
    for (const x of [...out]) {
      if (!out.includes(x) || !livre(x) || !torto(x.pol)) continue;
      const fila = out.filter((y) => y.fileira === x.fileira && livre(y)).sort((a, b) => a.indice - b.indice);
      if (fila.length < 2) continue;
      // a cunha na ponta ou até dois lotes antes dela (a fileira que afina no
      // fim da quadra): o grupo começa na ponta e inclui o lote ruim
      const pos = fila.indexOf(x);
      const daPonta = pos <= fila.length - 1 - pos ? fila : [...fila].reverse();
      const dist0 = daPonta.indexOf(x);
      if (dist0 > 2) continue;
      let feito = false;
      for (let k = Math.max(2, dist0 + 2); k <= Math.min(dist0 + 4, 5, daPonta.length) && !feito; k++) {
        const grupo = daPonta.slice(0, k);
        // filtro barato antes da geometria: k lotes em k−1 partes cabem na área máxima?
        const somaA = grupo.reduce((s2, g) => s2 + g.area, 0);
        if (somaA / (k - 1) > p.areaMax * FOLGA_MAX) break;
        const u = uniaoFechada(grupo.map((g) => g.pol));
        if (u.length !== 1 || u[0].furos.length) continue;
        const pol: Poligono = { ext: limparAnel(u[0].ext, 0.005), furos: [] };
        // os cortes seguem a direção da FILEIRA (a frente do lote mais de dentro),
        // e não a da estrada que a ponta toca em diagonal
        const fr = frenteMaiorDe(frentesDe(grupo[k - 1].pol, naFrente)) ?? frenteMaiorDe(frentesDe(pol, naFrente));
        if (!fr) continue;
        const area = areaPol(pol);
        for (let m = k - 1; m >= 1 && !feito; m--) {
          if (area / m > p.areaMax * FOLGA_MAX) break;
          if (area / m < p.areaMin - 0.01) continue;
          // áreas iguais; se a ponta rasa sai larga demais, frentes iguais (como
          // se loteia de frente para a estrada: a ponta fica com menos área)
          const dc = grupo[k - 1].dirCorte;
          let partes = m === 1 ? [pol] : partirIgual(pol, fr.a, fr.d, m, GR, dc);
          if (m > 1 && (!partes || !partes.every(bomLote))) partes = partirFrenteIgual(pol, frentesDe(pol, naFrente), fr.a, fr.d, m, GR, dc);
          if (!partes || !partes.every(bomLote)) continue;
          // as partes, da ponta para dentro; ficam os índices de dentro (a
          // fileira continua numerada sem buraco junto ao resto)
          const proj = (g: Poligono) => dot(sub(centroide(g.ext), centroide(daPonta[0].pol.ext)), fr.d);
          const sentido = proj(grupo[k - 1].pol) >= 0 ? 1 : -1;
          const ord = [...partes].sort((a, b) => sentido * (proj(a) - proj(b)));
          const indices = grupo.map((g) => g.indice).slice(k - m);
          const modelo = grupo[k - 1];
          for (const g of grupo) out.splice(out.indexOf(g), 1);
          ord.forEach((pp, j) => out.push({ ...modelo, pol: pp, area: areaPol(pp), indice: indices[j] }));
          feito = true;
        }
      }
      if (feito) mudou = true;
    }
    if (!mudou) break;
  }
  // Quadrinha de ponta (2 ou 3 lotes, triângulo entre a rua, a divisa e a
  // estrada) vira UM lote de ponta: maior, com frente até 1,5× a máxima — o
  // lote que ajusta a linha da propriedade, em vez de dois triângulos
  {
    const livres = out.filter(livre);
    if (livres.length >= 2 && livres.length <= 3) {
      const u = uniaoFechada(livres.map((x) => x.pol));
      if (u.length === 1 && !u[0].furos.length) {
        const pol: Poligono = { ext: limparAnel(u[0].ext, 0.005), furos: [] };
        const segs = frentesDe(pol, naFrente);
        const a = areaPol(pol);
        if (segs.length && a <= p.areaMax * FOLGA_MAX && frentePrincipal(segs) <= 1.5 * p.frenteMax && !passaDoFundo(pol, segs, p)) {
          const modelo = livres.reduce((m, x) => (x.area > m.area ? x : m), livres[0]);
          for (const x of livres) out.splice(out.indexOf(x), 1);
          out.push({ ...modelo, pol, area: a, ponta: true });
        }
      }
    }
  }
  // a cunha que não coube em vizinho nenhum, na ponta da quadra (encostada na
  // divisa), não é lote: vira retalho — área verde quando o projeto tem, área
  // remanescente quando não. Na beira da estrada de acesso fica lote (é a terra
  // que mais vale; a nesga ali é aviso para o operador, não área pública).
  // repete: tirada a cunha da ponta, o lote seguinte vira a ponta (fileira que afina)
  for (let mudou = true, volta = 0; mudou && volta < 6; volta++) {
    mudou = false;
    for (let i = out.length - 1; i >= 0; i--) {
      const x = out[i];
      if (!livre(x) || !torto(x.pol)) continue;
      // bico na quina da estrada (menor que um lote padrão): vira parte do
      // cruzamento — canteiro e alargamento da esquina, com a visibilidade da
      // estrada; nunca área verde, e lote fora das medidas não pode ser
      if (naEstrada(x.pol)) {
        // só a ponta da fileira e uma vez só (tirar em cadeia comeria a fileira
        // rasa ao longo da estrada): o bico da esquina ou a nesga mais rasa que a
        // profundidade mínima — que junto à rodovia é toda faixa não edificável
        const segs = frentesDe(x.pol, naFrente);
        const temRua = segs.some(([a2, b2]) => { const m = lerp(a2, b2, 0.5); return !vias.some((l) => distSegmento(m, l.a, l.b).d < 0.05); });
        const rasa = fundoDe(x.pol, segs) < p.profundidadeMin - 0.5;
        if (volta === 0 && (temRua || rasa) && ehPonta(x) && x.area < p.areaPadrao && out.filter((y) => y.fileira === x.fileira).length >= 3) { viario.push(x.pol); out.splice(i, 1); mudou = true; }
        continue;
      }
      if (out.filter((y) => y.fileira === x.fileira).length < 3) continue; // quadrinha: fica (com aviso)
      if (!ehPonta(x)) continue;
      sobras.push(x.pol);
      out.splice(i, 1);
      mudou = true;
    }
  }
  return { lotes: out, sobras, viario };
}

/**
 * Sobra anexada aos lotes vizinhos — "parcelas remanescentes não são
 * permitidas; devem ser anexadas aos lotes adjacentes" (Sherburne County,
 * §11.1.5), e é o que a equipe faz na planta aprovada: os lotes da borda
 * ficam maiores e a ponta da gleba não fica vazia. Cada lote vizinho leva a
 * parte da sobra que fica atrás dele, no prolongamento das próprias divisas
 * laterais; vira "lote de ponta" (até 2× a área e a profundidade máximas).
 * A sobra que é praça de verdade (círculo de 10 m) fica para a área verde
 * quando o projeto tem área verde. O que nenhum vizinho alcança continua sobra.
 */
function anexarSobras(
  lotes: ResultadoQuadra["lotes"], sobras: Poligono[], destinos: Map<string, TipoArea>,
  naFrente: (a: Pt, b: Pt) => boolean, p: Parametros, GR: number,
): { lotes: ResultadoQuadra["lotes"]; sobras: Poligono[] } {
  const out = lotes.slice();
  const restam: Poligono[] = [];
  const livre = (x: ResultadoQuadra["lotes"][number]) => !destinos.has(`${x.fileira}:${x.indice}`);
  // o lote que anexa continua dentro das faixas do projeto (área e fundo máximos)
  const cabe = (pol: Poligono) => {
    const a = areaPol(pol);
    if (acimaDaArea(a, p) || !formaDeLote(pol)) return false;
    const segs = frentesDe(pol, naFrente);
    return segs.length > 0 && profundidadeDe(pol, segs, true) <= limiteFundo(p);
  };
  const encosta = (a: Poligono, b: Poligono) => {
    const ca = caixa(a.ext), cb = caixa(b.ext);
    if (ca.min[0] > cb.max[0] + 0.05 || cb.min[0] > ca.max[0] + 0.05 || ca.min[1] > cb.max[1] + 0.05 || cb.min[1] > ca.max[1] + 0.05) return false;
    const u = uniaoFechada([a, b]);
    return u.length === 1 && !u[0].furos.length;
  };
  const perimetro = (pol: Poligono) => pol.ext.reduce((s2, q, i) => s2 + dist(q, pol.ext[(i + 1) % pol.ext.length]), 0);
  // divisa em comum entre o lote e a sobra (pelo perímetro da união)
  const comum = (a: Poligono, b: Poligono) => {
    const u = uniaoFechada([a, b]);
    return u.length === 1 ? (perimetro(a) + perimetro(b) - perimetro(u[0])) / 2 : 0;
  };
  for (const sb0 of sobras) {
    if (areaPol(sb0) < 1) continue;
    if (p.pctVerdeMin > 0 && verdeValida([sb0])) { restam.push(sb0); continue; }
    let resto: Poligono[] = [sb0];
    // 1. cada vizinho leva a faixa da sobra atrás dele (prolongando as divisas)
    // quem tem a maior divisa com a sobra (os lotes de costas para ela) leva
    // primeiro; o que só encosta de lado fica por último
    const vizinhos = out.filter((l) => livre(l) && encosta(l.pol, sb0))
      .map((l) => ({ l, c: comum(l.pol, sb0) })).sort((a, b) => b.c - a.c).map((x) => x.l);
    for (const l of vizinhos) {
      const segs = frentesDe(l.pol, naFrente);
      const fr = frenteMaiorDe(segs);
      if (!fr) continue;
      const us = l.pol.ext.map((q) => dot(sub(q, fr.a), fr.d));
      const faixa = faixaReferencial(fr.a, fr.d, esquerda(fr.d), Math.min(...us), Math.max(...us), -GR, GR);
      const partes = intersecao(resto, [faixa]).filter((x) => areaPol(x) > 0.5 && encosta(l.pol, x));
      if (!partes.length) continue;
      const u = uniaoFechada([l.pol, ...partes]);
      if (u.length !== 1 || u[0].furos.length) continue;
      const pol: Poligono = { ext: limparAnel(u[0].ext, 0.005), furos: [] };
      if (!cabe(pol)) continue;
      const i = out.indexOf(l);
      out[i] = { ...l, pol, area: areaPol(pol), ponta: true };
      resto = diferenca(resto, partes).filter((x) => areaPol(x) > 0.5);
    }
    // 2. nesga que sobrou entre as faixas vai inteira para o vizinho menor
    for (const r of resto) {
      let melhor: { i: number; pol: Poligono; c: number } | null = null;
      for (let i = 0; i < out.length; i++) {
        const l = out[i];
        if (!livre(l) || !encosta(l.pol, r)) continue;
        const u = uniaoFechada([l.pol, r]);
        if (u.length !== 1 || u[0].furos.length) continue;
        const pol: Poligono = { ext: limparAnel(u[0].ext, 0.005), furos: [] };
        if (!cabe(pol)) continue;
        const c = comum(l.pol, r);
        if (!melhor || c > melhor.c) melhor = { i, pol, c };
      }
      if (melhor) out[melhor.i] = { ...out[melhor.i], pol: melhor.pol, area: areaPol(melhor.pol), ponta: true };
      else restam.push(r);
    }
  }
  return { lotes: out, sobras: restam };
}

/** O lote passa no aviso da planta? (lados classificados, esquina por ruas distintas) */
function dentroDasFaixas(ctx: Contexto, pol: Poligono, p: Parametros, ponta = false): boolean {
  const fr = ladosDe(ctx, pol, null).filter((x) => ehFrente(x.tipo));
  if (!fr.length) return false;
  const segs: Seg[] = fr.map((x) => [x.a, x.b]);
  const esq = new Set(fr.map((x) => x.ref)).size >= 2 || esquinaDe(segs);
  const frente = fr.reduce((s2, x) => s2 + x.comp, 0);
  return foraDasFaixas({ area: areaPol(pol), frente, profundidade: profundidadeDe(pol, segs, true), rasa: profundidadeDe(pol, segs) }, p, false, esq, ponta ? 0 : frentePrincipal(segs)).length === 0;
}

/**
 * Conformidade final — a garantia: nenhum lote fora das medidas do projeto
 * chega à planta. Cada lote ainda fora delas é consertado como o projetista
 * faria (aparar o fundo além da máxima; dividir em frentes ou áreas iguais;
 * juntar com o vizinho). O que nenhum conserto resolve deixa de ser lote e
 * vira sobra — que segue o destino das sobras (anexada a vizinho dentro das
 * faixas, praça, canteiro de cruzamento ou área remanescente).
 */
function conformar(
  ctx: Contexto, lotes: ResultadoQuadra["lotes"], destinos: Map<string, TipoArea>, naFrente: (a: Pt, b: Pt) => boolean,
  p: Parametros, GR: number,
): { lotes: ResultadoQuadra["lotes"]; sobras: Poligono[] } {
  const out: ResultadoQuadra["lotes"] = [];
  const sobras: Poligono[] = [];
  const livre = (x: ResultadoQuadra["lotes"][number]) => !destinos.has(`${x.fileira}:${x.indice}`) && !x.ajustado; // o ajuste do operador não é desfeito
  // as MESMAS medidas e regras do aviso da planta (lados classificados, esquina
  // por ruas distintas) — conferir diferente daria lote bom descartado
  const valido = (pol: Poligono, ponta = false) => dentroDasFaixas(ctx, pol, p, ponta);
  const invalidos: { l: ResultadoQuadra["lotes"][number]; pol: Poligono }[] = [];
  for (const l of lotes) {
    if (!livre(l) || valido(l.pol, l.ponta)) { out.push(l); continue; }
    let pol = l.pol;
    let segs = frentesDe(pol, naFrente);
    if (!segs.length) { sobras.push(pol); continue; }
    // 1. fundo além da máxima: apara pela própria frente
    if (fundoMaxDe(pol, segs) > limiteFundo(p)) {
      const corredor = corredorDaFrente(pol, segs, p.profundidadeMax - 0.5, 0);
      const dentro = intersecao([pol], corredor).filter((x) => areaPol(x) > 0.5).sort((x, y) => areaPol(y) - areaPol(x));
      if (dentro.length && frentesDe(dentro[0], naFrente).length) {
        sobras.push(...diferenca([pol], [dentro[0]]).filter((x) => areaPol(x) > 0.5));
        pol = { ext: limparAnel(dentro[0].ext, 0.005), furos: dentro[0].furos };
        segs = frentesDe(pol, naFrente);
      }
    }
    if (valido(pol, l.ponta)) { out.push({ ...l, pol, area: areaPol(pol) }); continue; }
    // 2. grande ou largo demais: partes iguais (por área ou por frente)
    const fr = frenteMaiorDe(segs);
    let feito = false;
    if (fr) {
      const area = areaPol(pol);
      const m0 = Math.max(2, Math.ceil(area / p.areaMax - 1e-6), Math.ceil(frentePrincipal(segs) / p.frenteMax - 1e-6));
      for (let m = m0; m <= m0 + 1 && !feito; m++) {
        for (const partes of [partirIgual(pol, fr.a, fr.d, m, GR, l.dirCorte), partirFrenteIgual(pol, segs, fr.a, fr.d, m, GR, l.dirCorte)]) {
          if (!partes || !partes.every((x) => valido(x))) continue;
          partes.forEach((x, k) => out.push({ ...l, pol: x, area: areaPol(x), indice: l.indice + k / 1000, ponta: false }));
          feito = true;
          break;
        }
      }
    }
    if (!feito) invalidos.push({ l, pol });
  }
  // 3. o que ficou fora: junta com o vizinho (de qualquer fileira) se os dois
  //    juntos cabem nas medidas; senão deixa de ser lote
  for (const { pol } of invalidos) {
    let melhor: { i: number; pol: Poligono } | null = null;
    for (let i = 0; i < out.length; i++) {
      const y = out[i];
      if (!livre(y)) continue;
      const u = uniaoFechada([y.pol, pol]);
      if (u.length !== 1 || u[0].furos.length) continue;
      const juntos: Poligono = { ext: limparAnel(u[0].ext, 0.005), furos: [] };
      if (!formaDeLote(juntos) || !valido(juntos, true)) continue;
      if (!melhor || areaPol(juntos) < areaPol(melhor.pol)) melhor = { i, pol: juntos };
    }
    if (melhor) out[melhor.i] = { ...out[melhor.i], pol: melhor.pol, area: areaPol(melhor.pol), ponta: true };
    else {
      sobras.push(pol);
    }
  }
  return { lotes: out, sobras };
}

function dividirQuadra(
  ctx: Contexto, pol: Poligono, cfg: QuadraCfg | null, p: Parametros, modo: ModoDivisao, valor: number, sobra: Sobra,
  ancoraFrente: Pt | null, opcaoFace = 0,
): ResultadoQuadra {
  const lados = ladosDe(ctx, pol, null);
  const fs = faces(lados).filter((f) => f.comp >= Math.min(p.frenteMin, 3));
  const vazio = (msg: string): ResultadoQuadra => ({
    lotes: [], destinos: new Map(), cortes: [], fundo: null, sobras: [pol], origem: pol.ext[0], u: [1, 0], v: [0, 1],
    fileiras: 0, problemas: [msg], ruins: 0, nFaces: 0, tortos: 0, largura: 0, rasos: 0,
  });
  if (!fs.length) return vazio("quadra sem frente para rua");

  // frentes candidatas, da mais longa para a mais curta (a 2ª e a 3ª só são
  // tentadas quando a mais longa deixa lote fora do mínimo)
  const candidatas = [...fs].filter((f) => f.comp >= 2 * p.frenteMin).sort((a, b) => b.comp - a.comp);
  let principal = candidatas[Math.min(opcaoFace, Math.max(0, candidatas.length - 1))] ?? fs.reduce((m, f) => (f.comp > m.comp ? f : m), fs[0]);
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

  // frente oposta: a rua (ou estrada) do outro lado da quadra. Até 60° fora
  // do paralelo — a estrada antiga não é paralela à rua nova, e a quadra
  // entre as duas tem de ter duas fileiras, uma de frente para cada uma
  const opostas = fs.filter((f) => f !== principal && dot(f.dir, u) < -0.5 && f.comp >= 0.3 * principal.comp);
  const oposta = opostas.length ? opostas.reduce((m, f) => (f.comp > m.comp ? f : m), opostas[0]) : null;
  const D = oposta ? (proj(oposta.maior.a)[1] + proj(oposta.maior.b)[1]) / 2 : vMax;

  const pedido = cfg?.fileiras ?? "auto";
  let duas = !!oposta && (pedido === 2 || (pedido === "auto" && D >= Math.max(1.2 * p.profundidade, 2 * p.profundidadeMin)));
  if (pedido === 1) duas = false;

  const problemas: string[] = [];
  const sobras: Poligono[] = [];
  let cortouFundo = false;
  // `dir`/`org`: fileira de trás voltada para uma frente que não é paralela à
  // principal — os cortes dela ficam perpendiculares à SUA rua
  const fileirasPol: { pol: Poligono; sentido: 1 | -1; dir?: Pt; org?: Pt }[] = [];
  const paralela = !oposta || dot(oposta.dir, u) < -0.95;
  let fundo: Quadra["fundo"] = null;
  // limites dos cortadores: só um pouco além da própria quadra. Retângulo de
  // 100 km tira o clipper da faixa de inteiros "rápida" e ele passa a errar
  // por arredondamento (a contagem de lotes mudava com a escala interna).
  const GR = pol.ext.reduce((m, q) => Math.max(m, dist(q, o)), 0) + 50;
  if (duas && !paralela && cfg?.fundo === undefined) {
    // ruas que se abrem em ângulo (quadra triangular): o fundo é a bissetriz
    // entre as duas — cada ponto fica com a rua mais próxima, e as duas
    // fileiras têm a mesma profundidade de ponta a ponta. Com o fundo paralelo
    // à rua principal, a outra fileira virava lotes de 80 m numa ponta e nada na outra.
    const o2 = oposta!.maior.a;
    const v2 = esquerda(oposta!.dir);
    const nb = unit(sub(v, v2));
    const c = dot(o, v) - dot(o2, v2);
    const k = c / Math.max(1e-9, Math.hypot(v[0] - v2[0], v[1] - v2[1]));
    const pb = soma(o, mult(nb, k - dot(o, nb)));
    const tb = esquerda(nb);
    for (const pp of intersecao([pol], [faixaReferencial(pb, tb, nb, -GR, GR, -GR, 0)])) fileirasPol.push({ pol: pp, sentido: 1 });
    for (const pp of intersecao([pol], [faixaReferencial(pb, tb, nb, -GR, GR, 0, GR)])) fileirasPol.push({ pol: pp, sentido: -1, dir: oposta!.dir, org: o2 });
    const ts = pol.ext.map((q) => dot(sub(q, pb), tb));
    fundo = { a: soma(pb, mult(tb, Math.min(...ts))), b: soma(pb, mult(tb, Math.max(...ts))), valor: D / 2 };
  } else if (duas) {
    const f = Math.max(0.2 * D, Math.min(0.8 * D, cfg?.fundo ?? D / 2));
    for (const pp of intersecao([pol], [faixaReferencial(o, u, v, -GR, GR, -GR, f)])) fileirasPol.push({ pol: pp, sentido: 1 });
    for (const pp of intersecao([pol], [faixaReferencial(o, u, v, -GR, GR, f, GR)])) {
      fileirasPol.push(paralela ? { pol: pp, sentido: -1 } : { pol: pp, sentido: -1, dir: oposta!.dir, org: oposta!.maior.a });
    }
    const us = pol.ext.map((q) => proj(q)[0]);
    const a = soma(o, soma(mult(u, Math.min(...us)), mult(v, f)));
    const b = soma(o, soma(mult(u, Math.max(...us)), mult(v, f)));
    fundo = { a, b, valor: f };
  } else {
    // fileira única: além da profundidade máxima o fundo não é lote
    const limite = Math.max(p.profundidadeMax, 1.2 * p.profundidade);
    if (!oposta && vMax > limite) {
      // profundidade típica da fileira (mediana ao longo da frente): se ela cabe
      // na máxima, quem passa é só o bico da ponta — corta-se ali, na máxima, e
      // o lote vai até a divisa como na planta da equipe; aparar a fileira toda
      // na padrão deixaria uma faixa de fundo inteira sem uso
      const us0 = pol.ext.map((q) => proj(q)[0]);
      const uMin = Math.min(...us0), uMax = Math.max(...us0);
      const fundos: number[] = [];
      for (let k = 1; k < 20; k++) {
        const x = uMin + ((uMax - uMin) * k) / 20;
        let vm = -Infinity;
        for (let i = 0; i < pol.ext.length; i++) {
          const [ua, va] = proj(pol.ext[i]), [ub, vb] = proj(pol.ext[(i + 1) % pol.ext.length]);
          if ((ua - x) * (ub - x) > 0 || ua === ub) continue;
          vm = Math.max(vm, va + ((vb - va) * (x - ua)) / (ub - ua));
        }
        if (Number.isFinite(vm)) fundos.push(vm);
      }
      fundos.sort((a, b) => a - b);
      const tipica = fundos.length ? fundos[Math.floor(fundos.length / 2)] : vMax;
      const f = cfg?.fundo ?? (tipica <= p.profundidadeMax ? p.profundidadeMax : Math.min(1.2 * p.profundidade, p.profundidadeMax));
      for (const pp of intersecao([pol], [faixaReferencial(o, u, v, -GR, GR, -GR, f)])) fileirasPol.push({ pol: pp, sentido: 1 });
      for (const pp of diferenca([pol], [faixaReferencial(o, u, v, -GR, GR, -GR, f)])) sobras.push(pp);
      const us = pol.ext.map((q) => proj(q)[0]);
      fundo = { a: soma(o, soma(mult(u, Math.min(...us)), mult(v, f))), b: soma(o, soma(mult(u, Math.max(...us)), mult(v, f))), valor: f };
      cortouFundo = sobras.length > 0;
    } else fileirasPol.push({ pol, sentido: 1 });
  }

  // frente útil de cada fileira: extensão (em u) dos lados que dão para rua
  const frentes = lados.filter((l) => ehFrente(l.tipo));
  const caixasFrente = frentes.map((l) => ({ l, x0: Math.min(l.a[0], l.b[0]) - 0.03, x1: Math.max(l.a[0], l.b[0]) + 0.03, y0: Math.min(l.a[1], l.b[1]) - 0.03, y1: Math.max(l.a[1], l.b[1]) + 0.03 }));
  const naFrente = (a: Pt, b: Pt) => {
    const m = lerp(a, b, 0.5);
    return caixasFrente.some((c) => m[0] >= c.x0 && m[0] <= c.x1 && m[1] >= c.y0 && m[1] <= c.y1 && distSegmento(m, c.l.a, c.l.b).d < 0.02);
  };
  // Fileira funda demais (a quadra alarga na ponta, ou não há rua atrás): o
  // projetista apara a fileira inteira numa linha paralela à rua, na
  // profundidade máxima — o fundo vira UM retalho limpo, e não um pente de
  // pontas lote a lote. Na beira da estrada de acesso não apara (ali é lote).
  const viasDaQuadra = lados.filter((l) => l.tipo === "via");
  const tocaEstrada = (pg: Poligono) => pg.ext.some((q, k) => {
    const m = lerp(q, pg.ext[(k + 1) % pg.ext.length], 0.5);
    return viasDaQuadra.some((l) => distSegmento(m, l.a, l.b).d < 0.05);
  });
  for (let i = 0; i < fileirasPol.length; i++) {
    const fp = fileirasPol[i];
    const segs = frentesBrutas(fp.pol, naFrente);
    if (!segs.length || profundidadeDe(fp.pol, segs, true) <= limiteFundo(p)) continue;
    const corredor = corredorDaFrente(fp.pol, segs, p.profundidadeMax, 0);
    // o que encosta na estrada fica na fileira (é lote); o resto do fundo sai
    const fora = diferenca([fp.pol], corredor).filter((x) => areaPol(x) > 1 && !tocaEstrada(x));
    if (!fora.length) continue;
    const dentro = diferenca([fp.pol], fora).filter((x) => areaPol(x) > 1).sort((x, y) => areaPol(y) - areaPol(x));
    if (!dentro.length) continue;
    fileirasPol[i] = { ...fp, pol: dentro[0] };
    sobras.push(...dentro.slice(1), ...fora);
  }

  const ajustesPorFil = new Map<number, Map<number, AjusteLote>>();
  for (const a of cfg?.ajustes ?? []) {
    if (!ajustesPorFil.has(a.fileira)) ajustesPorFil.set(a.fileira, new Map());
    ajustesPorFil.get(a.fileira)!.set(a.indice, a);
  }

  const lotes: ResultadoQuadra["lotes"] = [];
  const destinos = new Map<string, TipoArea>();
  const cortes: Corte[] = [];
  let ruins = 0;
  fileirasPol.sort((a, b) => b.sentido - a.sentido);
  const exts = fileirasPol.map((fp) => {
    const uf: Pt = fp.dir ?? (fp.sentido === 1 ? u : mult(u, -1));
    const org: Pt = fp.org ?? o;
    let ini = Infinity, fim = -Infinity;
    const anel = fp.pol.ext;
    for (let i = 0; i < anel.length; i++) {
      const a = anel[i], b = anel[(i + 1) % anel.length];
      if (!naFrente(a, b)) continue;
      for (const q of [a, b]) { const s = dot(sub(q, org), uf); ini = Math.min(ini, s); fim = Math.max(fim, s); }
    }
    return { uf, org, ini, fim };
  });
  // Quadra de duas fileiras: a de frente mais longa manda e a outra segue os
  // mesmos cortes (fundo com fundo alinhado). No referencial da outra fileira o
  // eixo é invertido, por isso o corte s vira −s.
  let mestre = -1;
  if (fileirasPol.length === 2 && fileirasPol[0].sentido !== fileirasPol[1].sentido && !fileirasPol.some((f) => f.dir) && exts.every((e) => Number.isFinite(e.ini))) {
    mestre = exts[0].fim - exts[0].ini >= exts[1].fim - exts[1].ini ? 0 : 1;
  }
  let cortesMestre: number[] | undefined;
  (mestre === 1 ? [1, 0] : fileirasPol.map((_, i) => i)).forEach((fi) => {
    const fp = fileirasPol[fi];
    const { uf, org: o, ini, fim } = exts[fi];
    if (!Number.isFinite(ini)) {
      sobras.push(fp.pol);
      problemas.push("parte da quadra sem frente para rua");
      return;
    }
    const aj = ajustesPorFil.get(fi) ?? new Map<number, AjusteLote>();
    const alinhar = mestre >= 0 && fi !== mestre && cortesMestre ? cortesMestre.map((x) => -x) : undefined;
    const { cortes: cs, specs } = distribuir({ pol: fp.pol, sentido: fp.sentido, ini, fim }, o, uf, modo, valor, sobra, aj, p, alinhar);
    if (fi === mestre) cortesMestre = cs;

    // une (pula o corte) e divide (acrescenta cortes) — sobre as posições já calculadas
    const lim = [-GR, ...cs, GR];
    const intervalos: { a: number; b: number; indice: number; unido?: boolean }[] = [];
    for (let i = 0; i < lim.length - 1; i++) intervalos.push({ a: lim[i], b: lim[i + 1], indice: specs[i]?.indice ?? i });
    const finais: typeof intervalos = [];
    for (const it of intervalos) {
      const ult = finais[finais.length - 1];
      // une UMA vez: o lote unido guarda o índice do primeiro, que tem a marca "unir"
      if (ult && !ult.unido && aj.get(ult.indice)?.unir) { ult.b = it.b; ult.unido = true; continue; }
      finais.push({ ...it });
    }

    interface Pedaco { pol: Poligono; area: number; a: number; b: number; indice: number; frente: number; aj?: AjusteLote; sub: boolean }
    const vv = esquerda(uf);
    // direção das divisas laterais: a das ruas que encontram a rua desta
    // fileira (a malha da planta aprovada — lote alinhado à propriedade, sem
    // cunha na ponta oblíqua da quadra); perpendicular se não houver
    const sdir = direcaoDeCorte(ctx, fp.pol, naFrente, uf) ?? vv;
    // Divisas em leque, como na planta da equipe: a direção das divisas acompanha
    // as PONTAS da fileira (a da ponta inicial vai girando até a da ponta final),
    // e todo lote encaixa na quadra de pontas oblíquas sem virar cunha. Ponta que
    // não serve (menos de 35° com a frente) dá lugar à outra; sem nenhuma, vale a
    // rua que cruza (sdir) ou a perpendicular.
    const pontas = direcoesDasPontas(fp.pol, pol, naFrente, uf, o, ini, fim);
    // uma ponta só: a fileira inteira sai paralela a ela, mas sem passar de 60°
    // de inclinação com a frente (fileira longa de paralelogramos finos não é
    // lote) — o lote da ponta vira trapézio, como na planta da equipe
    const umaSo = (d: Pt): Pt => {
      const minimo = Math.sin((60 * Math.PI) / 180);
      if (Math.abs(cross(d, uf)) >= minimo) return d;
      const cos = Math.cos((60 * Math.PI) / 180);
      return soma(mult(uf, dot(d, uf) >= 0 ? cos : -cos), mult(vv, minimo));
    };
    // fileira única (fundo na divisa): lotes paralelos entre si, na média das
    // duas pontas — o leque fica para a quadra de duas fileiras entre ruas,
    // onde os fundos se encontram (é assim nas duas na planta da equipe)
    const media = pontas.ini && pontas.fim && fileirasPol.length === 1 ? umaSo(unit(soma(pontas.ini, pontas.fim))) : null;
    let dIni = media ?? (pontas.ini ? (pontas.fim ? pontas.ini : umaSo(pontas.ini)) : pontas.fim ? umaSo(pontas.fim) : sdir);
    let dFim = media ?? (pontas.fim ? (pontas.ini ? pontas.fim : umaSo(pontas.fim)) : pontas.ini ? umaSo(pontas.ini) : sdir);
    // pontas quase em esquadro (até 12°): lote retangular, divisas
    // perpendiculares — o leque só entra quando a quadra é de fato oblíqua
    const quaseReto = (d: Pt) => Math.abs(dot(d, uf)) < Math.sin((12 * Math.PI) / 180);
    if (quaseReto(dIni) && quaseReto(dFim)) { dIni = vv; dFim = vv; }
    // fileira curta com pontas que convergem: as divisas do leque se cruzariam
    // antes do fundo (lote em gravata) — aí a fileira vai paralela, na média
    if (dIni !== dFim && fim > ini) {
      const inc = (d: Pt) => dot(d, uf) / Math.max(1e-9, dot(d, vv));
      const den = inc(dIni) - inc(dFim);
      const vs = fp.pol.ext.map((q) => dot(sub(q, o), vv));
      if (den > 1e-9 && (fim - ini) / den < Math.max(...vs) - Math.min(...vs)) { dIni = dFim = umaSo(unit(soma(dIni, dFim))); }
    }
    const angDe = (d: Pt) => Math.atan2(d[1], d[0]);
    const aIni = angDe(dIni);
    let delta = angDe(dFim) - aIni;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const dirEm = (sv: number): Pt => {
      const t = fim > ini ? Math.max(0, Math.min(1, (sv - ini) / (fim - ini))) : 0;
      const a = aIni + delta * t;
      return [Math.cos(a), Math.sin(a)];
    };
    const acudo = (d: Pt) => (Math.asin(Math.min(1, Math.abs(cross(d, uf)))) * 180) / Math.PI;
    const emLeque = dIni !== vv || dFim !== vv;
    // reta de frente da fileira e alcance das linhas de corte
    let vFrente = 0, lMax = 0;
    for (let i = 0; i < fp.pol.ext.length; i++) {
      const a = fp.pol.ext[i], b = fp.pol.ext[(i + 1) % fp.pol.ext.length];
      if (naFrente(a, b) && dist(a, b) > lMax && Math.abs(dot(unit(sub(b, a)), uf)) > 0.9) { lMax = dist(a, b); vFrente = dot(sub(lerp(a, b, 0.5), o), vv); }
    }
    const fundoMax = Math.max(...fp.pol.ext.map((q) => Math.abs(dot(sub(q, o), vv) - vFrente)));
    const T = 3 * (fundoMax + 20);
    const F = (sv: number): Pt => soma(o, soma(mult(uf, sv), mult(vv, vFrente)));
    const faixaCorte = (sa: number, sb: number): Poligono => {
      if (!emLeque) return faixaReferencial(o, uf, vv, sa, sb, -GR, GR);
      const da = dirEm(sa), db = dirEm(sb), A = F(sa), B = F(sb);
      return { ext: antiHorario([soma(A, mult(da, -T)), soma(B, mult(db, -T)), soma(B, mult(db, T)), soma(A, mult(da, T))]), furos: [] };
    };
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
        const corte = faixaCorte(sa, sb);
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
        angCorte: emLeque ? Math.min(acudo(dirEm(x.a)), acudo(dirEm(x.b))) : undefined,
        dirCorte: emLeque ? dirEm((x.a + x.b) / 2) : undefined,
        ajustado: !!a && !!(a.frente || a.area || a.unir || (a.dividir && a.dividir > 1)),
        travaFrente: a?.frente, travaArea: a?.area,
      });
      if (a?.destino) destinos.set(`${fi}:${x.indice}`, a.destino);
      const prox = pedacos[i + 1];
      if (prox && Math.abs(prox.a - x.b) < 1e-6) {
        // posição ao longo da divisa (oblíqua): t = cruz(uf, q − o) / cruz(uf, sdir)
        const dc = emLeque ? dirEm(x.b) : vv;
        const ps = fp.pol.ext.map((q) => cross(uf, sub(q, F(x.b))) / cross(uf, dc));
        cortes.push({
          fileira: fi, indice: x.indice, arrastavel: !x.sub && !prox.sub,
          a: soma(F(x.b), mult(dc, Math.min(...ps))),
          b: soma(F(x.b), mult(dc, Math.max(...ps))),
          o, dir: uf, s0: i === 0 ? ini : x.a, s: x.b, sFim: fim,
        });
      }
    });
  });
  // retalho que ficou com frente e área de lote (canto da quadra, ponta além
  // do fundo) é lote, não sobra — sobretudo na beira da estrada, onde a terra
  // vale mais e área pública não pode ficar
  const restantes: Poligono[] = [];
  const padrao = Math.max(p.areaMin, p.areaPadrao);
  let extra = 0;
  // retalho com frente: em lotes de área parecida com a padrão (serve também,
  // no fim, para o retalho grande que sobrou — ele não vai inteiro para um lote só)
  const lotearRetalho = (sb: Poligono, saida: ResultadoQuadra["lotes"], restos: Poligono[]) => {
    let fr = 0, maior: [Pt, Pt] | null = null;
    for (let i = 0; i < sb.ext.length; i++) {
      const a = sb.ext[i], b = sb.ext[(i + 1) % sb.ext.length];
      if (!naFrente(a, b)) continue;
      fr += dist(a, b);
      if (!maior || dist(a, b) > dist(maior[0], maior[1])) maior = [a, b];
    }
    const area = areaPol(sb);
    if (!maior || fr < p.frenteMin - 0.005 || area < p.areaMin - 0.01) { restos.push(sb); return; }
    // retalho grande: divide em lotes de área parecida com a do padrão,
    // cortando perpendicular à frente dele
    // partes: perto da área padrão, mas nenhuma acima da máxima
    const m = Math.max(1, Math.min(Math.floor(fr / p.frenteMin), Math.max(Math.round(area / padrao), Math.ceil(area / p.areaMax - 1e-6))));
    const d = unit(sub(maior[1], maior[0]));
    const o2 = maior[0];
    const us = sb.ext.map((q) => dot(sub(q, o2), d));
    const lo0 = Math.min(...us) - 1, hi0 = Math.max(...us) + 1;
    const cortesR: number[] = [];
    for (let j = 1; j < m; j++) {
      const alvo = (area * j) / m;
      let lo = lo0, hi = hi0;
      for (let it = 0; it < 50; it++) { const mid = (lo + hi) / 2; if (areaPolAteCorte(sb, o2, d, mid) < alvo) lo = mid; else hi = mid; }
      cortesR.push((lo + hi) / 2);
    }
    const lim = [lo0 - 10, ...cortesR, hi0 + 10];
    const ajR = ajustesPorFil.get(9);
    for (let j = 0; j < m; j++) {
      const pedacos = intersecao([sb], [faixaReferencial(o2, d, esquerda(d), lim[j], lim[j + 1], -GR, GR)]).sort((x, y) => areaPol(y) - areaPol(x));
      if (!pedacos.length) continue;
      for (const r of pedacos.slice(1)) restos.push(r);
      // cada pedaço precisa da própria frente; o que não tem volta a ser retalho
      let frP = 0;
      for (let i = 0; i < pedacos[0].ext.length; i++) {
        const a = pedacos[0].ext[i], b = pedacos[0].ext[(i + 1) % pedacos[0].ext.length];
        if (naFrente(a, b)) frP += dist(a, b);
      }
      if (frP < p.frenteMin - 0.005 || areaPol(pedacos[0]) < p.areaMin - 0.01) { restos.push(pedacos[0]); continue; }
      const idx = extra++;
      // frente só para menos partes: o lote sai maior que a máxima — é retalho (aviso)
      saida.push({ pol: pedacos[0], area: areaPol(pedacos[0]), fileira: 9, indice: idx, ajustado: false, retalho: acimaDaArea(areaPol(pedacos[0]), p) || undefined });
      const dest = ajR?.get(idx)?.destino;
      if (dest) destinos.set(`9:${idx}`, dest);
    }
  };
  for (const sb of sobras) lotearRetalho(sb, lotes, restantes);
  // retalho sem frente que encosta num lote é somado a ele (o lote da ponta
  // fica maior, como nas plantas da equipe); só sobra o que passaria da área
  // máxima — esse vira área verde lá na reserva
  const finais: Poligono[] = [];
  for (const sb of restantes) {
    const aSb = areaPol(sb);
    const cb = caixa(sb.ext);
    let melhor: { i: number; pol: Poligono; area: number } | null = null;
    for (let i = 0; i < lotes.length; i++) {
      const l = lotes[i];
      if (l.area + aSb > p.areaMax || destinos.has(`${l.fileira}:${l.indice}`)) continue;
      const cl = caixa(l.pol.ext);
      if (cl.min[0] > cb.max[0] + 0.01 || cl.max[0] < cb.min[0] - 0.01 || cl.min[1] > cb.max[1] + 0.01 || cl.max[1] < cb.min[1] - 0.01) continue;
      const u2 = uniao([l.pol], [sb]);
      if (u2.length !== 1 || u2[0].furos.length) continue; // não encostam (ou só num ponto)
      const area = areaPol(u2[0]);
      // o retalho do fundo aparado não volta para o lote (ficaria fundo de novo)
      const novo: Poligono = { ext: limparAnel(u2[0].ext, 0.005), furos: [] };
      if (profundidadeDe(novo, frentesBrutas(novo, naFrente), true) > limiteFundo(p)) continue;
      if (!melhor || l.area < lotes[melhor.i].area) melhor = { i, pol: novo, area };
    }
    if (melhor) { lotes[melhor.i] = { ...lotes[melhor.i], pol: melhor.pol, area: melhor.area }; continue; }
    finais.push(sb);
  }
  const h0 = harmonizar(lotes, destinos, naFrente, lados, p, GR, ctx.busca);
  // a sobra não fica vazia: os lotes vizinhos a anexam (lote de ponta)
  // no cálculo da planta o bico da esquina na estrada também não se perde:
  // entra no lote vizinho como qualquer retalho
  const bicos = ctx.juntar ? h0.viario : [];
  let h = ctx.busca ? { lotes: h0.lotes, sobras: [...finais, ...h0.sobras] } : anexarSobras(h0.lotes, [...finais, ...h0.sobras, ...bicos], destinos, naFrente, p, GR);
  if (!ctx.busca) {
    // garantia: lote fora das medidas é consertado ou deixa de ser lote
    const c2 = conformar(ctx, h.lotes, destinos, naFrente, p, GR);
    h = c2.sobras.length ? anexarSobras(c2.lotes, [...h.sobras, ...c2.sobras], destinos, naFrente, p, GR) : { lotes: c2.lotes, sobras: h.sobras };
  }
  finais.length = 0;
  finais.push(...h.sobras);
  // nenhum retalho sem dono: o que tem frente e cabe nas medidas é lote
  // (o bico entre ruas, a ponta da fileira) — os demais entram no lote
  // vizinho no fim do cálculo
  if (ctx.juntar) {
    // a faixa de fundo atrás de vários lotes é partida pelas divisas
    // prolongadas: cada lote leva o pedaço que fica atrás dele (e não um lote
    // só fica com a faixa inteira)
    const linhas = cortes.map((c) => ({ a: c.a, d: unit(sub(c.b, c.a)) })).filter((l) => Number.isFinite(l.d[0]));
    for (let i = finais.length - 1; i >= 0; i--) {
      let pecas: Poligono[] = [finais[i]];
      const cb = caixa(finais[i].ext);
      const cantos: Pt[] = [cb.min, [cb.max[0], cb.min[1]], cb.max, [cb.min[0], cb.max[1]]];
      for (const ln of linhas) {
        // só a divisa cuja reta atravessa o retalho
        const lados = cantos.map((q) => Math.sign(cross(ln.d, sub(q, ln.a))));
        if (lados.every((x) => x >= 0) || lados.every((x) => x <= 0)) continue;
        const n = esquerda(ln.d);
        const lado = (sinal: number) => faixaReferencial(ln.a, ln.d, n, -GR, GR, sinal > 0 ? 0 : -GR, sinal > 0 ? GR : 0);
        pecas = pecas.flatMap((pc) => [...intersecao([pc], [lado(1)]), ...intersecao([pc], [lado(-1)])]).filter((x) => areaPol(x) > 0.5);
      }
      if (pecas.length > 1) finais.splice(i, 1, ...pecas.map((x) => ({ ext: limparAnel(x.ext, 0.005), furos: x.furos })));
    }
    // retalho maior que o lote máximo, com frente para rua: vira lotes
    for (let i = finais.length - 1; i >= 0; i--) {
      const sb = finais[i];
      if (areaPol(sb) <= p.areaMax * FOLGA_MAX || (ctx.marcas ?? []).some((m) => dentroPol(m, sb))) continue;
      const antes = h.lotes.length, restos: Poligono[] = [];
      lotearRetalho(sb, h.lotes, restos);
      if (h.lotes.length > antes) finais.splice(i, 1, ...restos.filter((x) => areaPol(x) > 0.5));
    }
    for (let i = finais.length - 1; i >= 0; i--) {
      const sb = finais[i];
      if ((ctx.marcas ?? []).some((m) => dentroPol(m, sb))) continue;
      if (!dentroDasFaixas(ctx, sb, p)) continue;
      h.lotes.push({ pol: sb, area: areaPol(sb), fileira: 9, indice: 100 + extra++, ajustado: false });
      finais.splice(i, 1);
    }
  }
  if (cortouFundo && !ctx.juntar && finais.reduce((s2, x) => s2 + areaPol(x), 0) > 50) problemas.push("fundo da quadra sem acesso (faixa além da profundidade máxima)");
  // fora das faixas também conta como lote ruim: é o que faz o cálculo tentar
  // outra frente / outro número de fileiras para a quadra
  let tortos = 0, rasos = 0;
  for (const l of h.lotes) {
    if (destinos.has(`${l.fileira}:${l.indice}`) || l.ponta) continue;
    const segs = frentesDe(l.pol, naFrente);
    const ang = anguloMinimo(l.pol, pol);
    // lote de divisa oblíqua de projeto: o canto do fundo pode fugir um pouco do
    // ângulo da frente (o fundo da quadra de duas fileiras segue a bissetriz
    // entre ruas que não são paralelas); torto é passar disso ou ficar agudo
    const deProjeto = l.angCorte !== undefined && ang >= Math.max(40, l.angCorte - 15);
    if (ang < 70 && !deProjeto) tortos++;
    const esq = esquinaDe(segs);
    const fr = segs.reduce((s2, [a, b]) => s2 + dist(a, b), 0);
    if (!esq && fr > 0 && l.area / fr < 1.5 * p.profundidadeMin && fundoDe(l.pol, segs) < p.profundidadeMin - 0.5) rasos++;
    // medido no lote final (o pedaço provisório abaixo da mínima a harmonia já consertou)
    if (acimaDaArea(l.area, p) || passaDoFundo(l.pol, segs, p) || l.area < p.areaMin - 0.01 || frentePrincipal(segs) < p.frenteMin - 0.005) ruins++;
    else if (!esq && acimaDaFrente(segs.reduce((s2, [a, b]) => s2 + dist(a, b), 0), p)) ruins++;
    else if (ang < 50 && !deProjeto) ruins++; // cunha
  }
  return { lotes: h.lotes, destinos, cortes, fundo, sobras: finais, canteiros: ctx.juntar ? [] : h0.viario, origem: o, u, v, fileiras: fileirasPol.length, problemas, ruins, nFaces: candidatas.length, tortos, largura: D, rasos };
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
  /** busca de malha (implica rápido): pula a redistribuição das pontas, que só muda o acabamento */
  busca?: boolean;
  /** o gerador quer ver os retalhos (para fazê-los área verde): não junta nos lotes */
  manterSobras?: boolean;
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
  // só a APP de rio sai do loteamento; a faixa de rodovia/ferrovia fica dentro
  // dos lotes, desenhada como restrição (linha tracejada a N m da divisa)
  const bordasComFaixa = projeto.bordas.map((b, i) => ({ b, i })).filter(({ b }) => b.faixa > 0 && b.tipo === "rio");
  const faixasRestricao: Resultado["faixasRestricao"] = [];
  projeto.bordas.forEach((b, i) => {
    if (!faixaDentroDoLote(b.tipo) || !(b.faixa > 0)) return;
    const l = ladosGleba[i];
    const d = unit(sub(l.b, l.a));
    let nrm = esquerda(d);
    // para dentro da gleba (o anel do levantamento pode estar em qualquer sentido)
    if (!dentroPol(soma(lerp(l.a, l.b, 0.5), mult(nrm, 0.5)), gleba)) nrm = mult(nrm, -1);
    const linha: Pt[] = [soma(l.a, mult(nrm, b.faixa)), soma(l.b, mult(nrm, b.faixa))];
    faixasRestricao.push({ linha, largura: b.faixa, lado: i, nome: b.nome || (b.tipo === "rodovia" ? "Rodovia" : "Ferrovia") });
  });
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
    return { id: r.id, nome: r.nome, largura: r.largura, eixo, pols, area: 0, comprimento: comp, corpo };
  });
  // as quadras saem da gleba menos o corpo INTEIRO das ruas: subtrair a rua já
  // recortada pela gleba deixa uma fresta de décimo de milímetro na divisa que
  // emenda quadras vizinhas numa só
  const viarioBruto = ruas.length ? uniao(ruas.flatMap((r) => r.corpo)) : [];

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
  const canteiros: Poligono[] = [];

  const fixos = new Indice();
  for (const a of areas) for (const pol of a.pols) fixos.add(item(pol, a.tipo === "app" ? "faixa" : "area", a.id, a.nome));
  if (op.busca) op = { ...op, rapido: true };
  const ctx: Contexto = {
    prof: p.profundidade, areaMin: p.areaMin, gleba, ladosGleba, confrontantes: perimetro.confrontantes, ruas, fixos, busca: op.busca,
    juntar: !op.rapido && !op.busca && !op.manterSobras,
    marcas: (projeto.sobrasPublicas ?? []).map((m) => P(m.ponto)),
  };

  // configs: cada quadra pega a config cuja âncora cai dentro dela
  const cfgs = projeto.quadras.map((c) => ({ c, pt: P(c.ancora) }));
  const usadas = new Set<number>();

  interface QuadraTmp {
    pol: Poligono; cfgIdx: number; cfg: QuadraCfg | null; centro: Pt; res: ResultadoQuadra | null;
    destino?: TipoArea; modo: ModoDivisao; valor: number; sobra: Sobra;
  }
  const tmp: QuadraTmp[] = [];
  // pedaço menor que um lote mínimo não é quadra (não cabe lote nele)
  const minQuadra = Math.max(p.areaMin, 40);
  const pecasQuadra = pedacos.flatMap((pp) => partirEmL(ctx, pp));
  ctx.pecas = new Indice();
  pecasQuadra.forEach((pp, i) => ctx.pecas!.add(item(pp, "lote", `peca${i}`, "lote vizinho")));
  for (const bruto of pecasQuadra) {
    const a = areaPol(bruto);
    if (a < minQuadra) {
      // nesga na beira da estrada fica como passeio (viário), nunca área verde
      const naEstrada = bruto.ext.some((q, i) => {
        const r = bruto.ext[(i + 1) % bruto.ext.length];
        return dist(q, r) > 1 && ladosGleba.some((l) => ehAcesso(l.tipo) && distSegmento(q, l.a, l.b).d < 0.05 && distSegmento(r, l.a, l.b).d < 0.05);
      });
      if (!naEstrada) sobras.push(bruto);
      continue;
    }
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
  let desarmonicos = 0;
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
    const { pol: polEsq, curvas } = tratarEsquinas(ctx, q.pol, p);
    // depois de arredondar as esquinas, pedaço menor que um lote não é quadra:
    // na beira da estrada vira passeio; no resto, retalho
    if (areaPol(polEsq) < p.areaMin) {
      if (!ladosDe(ctx, polEsq, null).some((l) => l.tipo === "via")) sobras.push(polEsq);
      continue;
    }
    // lotes da divisa: mesma frente, ou áreas iguais absorvendo a irregularidade
    const naDivisa = ladosDe(ctx, polEsq, null).some((l) => l.tipo === "divisa");
    let modo: ModoDivisao = q.cfg?.modo ?? "frente";
    let valor = q.cfg?.valor ?? p.frente;
    if (!q.cfg?.modo && naDivisa && p.divisa === "areas_iguais") { modo = "area"; valor = p.areaPadrao; }
    if (modo === "area" && !q.cfg?.valor) valor = p.areaPadrao;
    if (modo === "quantidade" && !q.cfg?.valor) valor = 10;
    const sobra = q.cfg?.sobra ?? p.sobra;
    const ancFrente = q.cfg?.frentePrincipal ? P(q.cfg.frentePrincipal) : null;
    let res = dividirQuadra(ctx, polEsq, q.cfg, p, modo, valor, sobra, ancFrente);
    // frente mais longa deixou lote torto/nanico (quadra com um lado diagonal):
    // tenta lotear pelas outras frentes e fica com a que dá mais lote bom
    // (na busca rápida do gerador pula: a contagem de lotes quase não muda e custa o triplo)
    // (e uma ou duas fileiras, se o operador não escolheu): quadra triangular
    // ou funda demais costuma ter uma combinação sem lote fora das faixas
    // quadra com ajuste do operador (trava, unir, dividir) fica no arranjo em
    // que ele mexeu: outra frente ou outro nº de fileiras jogaria a edição fora
    const editada = (q.cfg?.ajustes ?? []).some((a) => a.frente !== undefined || a.area !== undefined || a.unir || (a.dividir ?? 0) > 1);
    if (!op.rapido && !ancFrente && !editada && res.ruins > 0) {
      const nota = (r: ResultadoQuadra) => r.lotes.length - 3 * r.ruins - r.tortos - r.sobras.reduce((s2, x) => s2 + areaPol(x), 0) / Math.max(1, p.areaPadrao);
      const fileiras: (QuadraCfg["fileiras"] | undefined)[] = q.cfg?.fileiras && q.cfg.fileiras !== "auto" ? [undefined] : [undefined, 1, 2];
      // duas fileiras forçadas só são tentadas se a quadra tem fundo para as duas
      const larguraQ = (() => { const us = polEsq.ext.map((x) => dot(sub(x, res.origem), res.v)); return Math.max(...us) - Math.min(...us); })();
      if (larguraQ < 2 * p.profundidadeMin) fileiras.splice(fileiras.indexOf(2), 1);
      for (const fil of fileiras) for (let k = 0; k < Math.min(3, Math.max(1, res.nFaces)); k++) {
        if (fil === undefined && k === 0) continue; // é o próprio `res`
        const cfgAlt: QuadraCfg | null = fil === undefined ? q.cfg : { ...(q.cfg ?? { ancora: [0, 0], ajustes: [] }), fileiras: fil };
        const alt = dividirQuadra(ctx, polEsq, cfgAlt, p, modo, valor, sobra, null, k);
        // duas fileiras forçadas que deixam lote raso (quadra estreita para duas):
        // com área verde, a faixa rasa é a terra de menos valor e vira o verde;
        // sem área verde não há para onde ir — a quadra fica com uma fileira só
        if (fil === 2 && p.pctVerdeMin <= 0 && alt.rasos > res.rasos) continue;
        if (nota(alt) > nota(res)) res = alt;
        if (res.ruins === 0) break;
      }
    }
    for (const s of res.sobras) sobras.push(s);
    canteiros.push(...(res.canteiros ?? []));
    desarmonicos += res.ruins + 0.5 * res.tortos;

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

    // quadra que virou toda área pública não leva letra nem entra na lista
    const temLote = seq.some((x) => !x.dest);
    const nome = q.cfg?.nome || (p.numeracaoQuadras === "letras" ? letraQuadra(nQuadra) : String(nQuadra + 1).padStart(2, "0"));
    if (temLote) nQuadra++;
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
        ...x.l, id: `${nome}-${String(num).padStart(2, "0")}`, quadra: nome, numero: num, lados: [], frente: 0, profundidade: 0,
        esquina: false, rua: "", problemas: [], naDivisa: false,
      };
      quadra.lotes.push(lote);
      lotes.push(lote);
      lotesIdx.add(item(lote.pol, "lote", lote.id, `Lote ${String(num).padStart(2, "0")} da Quadra ${nome}`));
    }
    void nAreaLotes;
    if (temLote) quadras.push(quadra);
  }

  // --- retalhos encostados viram um só (o fundo aparado de vários lotes é UM retalho)
  if (sobras.length > 1 && !ctx.juntar) { const u = uniaoFechada(sobras); sobras.length = 0; sobras.push(...u); }
  // --- retalho minúsculo (canto de esquina, ponta de rua) é calçada: some no viário
  //     — só na beira da rua; a lasca do miolo (dente no fundo entre as
  //     fileiras) entra no lote vizinho, senão ficaria um furo de "viário"
  //     no meio da quadra
  for (let i = sobras.length - 1; i >= 0; i--) {
    const sb = sobras[i];
    if (areaPol(sb) >= 30) continue;
    const naRua = ladosDe(ctx, sb, null).some((l) => ehFrente(l.tipo));
    if (!naRua) {
      const cb = caixa(sb.ext);
      const perto = (l: Lote) => { const c2 = caixa(l.pol.ext); return c2.min[0] <= cb.max[0] + 0.1 && c2.max[0] >= cb.min[0] - 0.1 && c2.min[1] <= cb.max[1] + 0.1 && c2.max[1] >= cb.min[1] - 0.1; };
      const viz = lotes.filter(perto)
        .map((l) => ({ l, u: uniaoFechada([l.pol, sb]) }))
        .filter((x) => x.u.length === 1 && !x.u[0].furos.length && dentroDasFaixas(ctx, x.u[0], p, !!x.l.ponta))
        .sort((a, b) => a.l.area - b.l.area)[0];
      if (viz) {
        viz.l.pol = { ext: limparAnel(viz.u[0].ext, 0.005), furos: [] };
        viz.l.area = areaPol(viz.l.pol);
        // o índice guarda o polígono: o lote crescido entra de novo (mesmo id),
        // senão o vizinho que encosta na lasca a leria como "lote vizinho"
        lotesIdx.add(item(viz.l.pol, "lote", viz.l.id, `Lote ${String(viz.l.numero).padStart(2, "0")} da Quadra ${viz.l.quadra}`));
        sobras.splice(i, 1);
        continue;
      }
      if (ctx.juntar) continue; // o passo final a junta mesmo fora das medidas
    }
    canteiros.push(...sobras.splice(i, 1));
  }
  // --- bico de quadra entre ruas (cruzamento em ângulo fechado) que não é
  //     praça (não cabe o círculo de 10 m) nem cabe num lote: é canteiro do
  //     cruzamento — entra no viário, em vez de ficar retalho sem destino
  const bicoDeCanteiro = (sb: Poligono) => {
    if (areaPol(sb) >= 2 * p.areaPadrao || verdeValida([sb])) return false;
    return ladosDe(ctx, sb, null).filter((l) => ehFrente(l.tipo)).reduce((s2, l) => s2 + l.comp, 0) >= 5;
  };
  // (no cálculo da planta o bico entra antes no lote vizinho — passo final)
  if (!ctx.juntar) for (let i = sobras.length - 1; i >= 0; i--) if (bicoDeCanteiro(sobras[i])) canteiros.push(...sobras.splice(i, 1));
  // --- retalho colado numa área verde entra nela: a praça cresce num perímetro só
  for (let i = sobras.length - 1; i >= 0; i--) {
    const sb = sobras[i];
    const a = areas.find((x) => x.tipo !== "app" && x.pols.some((v) => uniaoFechada([v, sb]).length === 1));
    if (!a) continue;
    a.pols = uniaoFechada([...a.pols, sb]);
    a.area = a.pols.reduce((s2, x) => s2 + areaPol(x), 0);
    sobras.splice(i, 1);
  }
  // --- retalho marcado como área pública (ponto dentro dele) sai das sobras
  (projeto.sobrasPublicas ?? []).forEach((m, k) => {
    const pt = P(m.ponto);
    const i = sobras.findIndex((sb) => dentroPol(pt, sb));
    if (i < 0) return;
    const [sb] = sobras.splice(i, 1);
    areas.push({ id: `sp${k}`, tipo: m.tipo, nome: "", pols: [sb], area: areaPol(sb), origem: "sobra", cfg: k });
    fixos.add(item(sb, m.tipo === "app" ? "faixa" : "area", `sp${k}`, ROTULO_AREA[m.tipo]));
  });
  // --- nenhuma sobra de terreno: o retalho entra no lote vizinho — de
  //     preferência um que continue dentro das medidas; senão o que encosta
  //     mais (o lote fica com aviso e o operador ajusta). Só sem lote vizinho
  //     ele vira canteiro (bico na rua) ou fica remanescente.
  if (ctx.juntar) {
    for (let i = sobras.length - 1; i >= 0; i--) {
      const sb = sobras[i];
      const cb = caixa(sb.ext);
      const perto = (l: Lote) => { const c2 = caixa(l.pol.ext); return c2.min[0] <= cb.max[0] + 0.1 && c2.max[0] >= cb.min[0] - 0.1 && c2.min[1] <= cb.max[1] + 0.1 && c2.max[1] >= cb.min[1] - 0.1; };
      const perimetroDe = (pg: Poligono) => pg.ext.reduce((s2, q, k) => s2 + dist(q, pg.ext[(k + 1) % pg.ext.length]), 0);
      const cands = lotes.filter(perto)
        .map((l) => ({ l, u: uniaoFechada([l.pol, sb]) }))
        .filter((x) => x.u.length === 1 && !x.u[0].furos.length)
        .map((x) => ({ ...x, ok: dentroDasFaixas(ctx, x.u[0], p, !!x.l.ponta), contato: x.l.pol.ext.length ? perimetroDe(x.l.pol) + perimetroDe(sb) - perimetroDe(x.u[0]) : 0 }));
      const viz = cands.filter((x) => x.ok).sort((a, b) => a.l.area - b.l.area)[0] ?? cands.sort((a, b) => b.contato - a.contato)[0];
      if (viz) {
        viz.l.pol = { ext: limparAnel(viz.u[0].ext, 0.005), furos: [] };
        viz.l.area = areaPol(viz.l.pol);
        if (!viz.ok) viz.l.retalho = true;
        lotesIdx.add(item(viz.l.pol, "lote", viz.l.id, `Lote ${String(viz.l.numero).padStart(2, "0")} da Quadra ${viz.l.quadra}`));
        sobras.splice(i, 1);
      } else if (bicoDeCanteiro(sb)) canteiros.push(...sobras.splice(i, 1));
    }
  }
  // --- sobras entram no índice (para o lado do lote dizer "área remanescente")
  for (const [i, s] of sobras.entries()) fixos.add(item(s, "sobra", `sobra${i}`, "área remanescente"));

  // --- lados e problemas dos lotes
  for (const l of lotes) {
    if (op.rapido) {
      l.frente = 0;
      if (l.area < p.areaMin - 0.01) l.problemas.push("área abaixo do mínimo");
      if (acimaDaArea(l.area, p)) l.problemas.push("área acima do máximo");
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
    const segs: Seg[] = fr.map((x) => [x.a, x.b]);
    l.profundidade = profundidadeDe(l.pol, segs, true);
    // lote de rua a rua (frente e fundo para rua): a regra vale para a frente principal
    l.problemas.push(...foraDasFaixas({ ...l, rasa: profundidadeDe(l.pol, segs) }, p, !fr.length, l.esquina || esquinaDe(segs), l.ponta ? 0 : frentePrincipal(segs), !!l.ponta));
    // fora das medidas por decisão do operador (ajuste) ou por ter absorvido
    // o retalho da gleba: é aviso — o lote fica marcado para ele acertar
    const nivelLote: Problema["nivel"] = l.ajustado || l.retalho ? "aviso" : "erro";
    for (const pr of l.problemas) problemas.push({ nivel: nivelLote, texto: `Lote ${l.id}: ${pr}${l.retalho && !l.ajustado ? " (absorveu retalho da gleba)" : ""}`, alvo: { lote: l.id } });
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
    if (p.pctVerdeMin + p.pctInstitucionalMin > 0 && pct(quadro.publicas) < p.pctPublicasMin - 0.005) problemas.push({ nivel: "aviso", texto: `Áreas públicas (viário + verde + institucional) somam ${fmt(pct(quadro.publicas))}% — a meta do município é ${fmt(p.pctPublicasMin)}%` });
    for (const q of quadras) {
      const us = q.pol.ext.map((x) => dot(sub(x, q.origem), q.u));
      const comp = Math.max(...us) - Math.min(...us);
      if (comp > p.quadraCompMax + 1) {
        // quadra encostada na divisa não pode ser cortada por rua (a rua iria
        // para a terra do vizinho): o caminho é viela de pedestre ou a prefeitura
        // (a faixa de uma fileira na divisa é a exceção de toda planta aprovada:
        // ali a rua não pode cortar até a divisa — não é pendência)
        const lindeira = q.fileiras <= 1 && q.lotes.some((l) => l.naDivisa);
        if (!lindeira) problemas.push({ nivel: "aviso", alvo: { quadra: q.nome }, texto: `Quadra ${q.nome} com ${fmt(comp)} m de comprimento — o máximo é ${fmt(p.quadraCompMax)} m` });
      }
    }
    // projeto sem área verde: o retalho é área remanescente por escolha, não pendência
    if (areaSobras > 50 && p.pctVerdeMin > 0) problemas.push({ nivel: "aviso", texto: `${fmt(areaSobras)} m² de sobras sem destino (retalhos sem frente para rua) — transforme em área verde ou ajuste as ruas` });
    for (const r of ruas) if (r.largura < 8) problemas.push({ nivel: "aviso", texto: `${r.nome} com ${fmt(r.largura)} m de largura` });
    problemas.push(...problemasDeAcesso(ruas, ladosGleba));
  }

  const ms = quadras.length ? Math.atan2(quadras[0].u[1], quadras[0].u[0]) : 0;
  const publicas = op.rapido ? [] : consolidar(areas);
  return { plano, gleba, ladosGleba, ruas, quadras, lotes, areas, faixasRestricao, publicas, sobras, canteiros, quadro, problemas, ms, desarmonicos };
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
    // o pedaço de quadra que virou canteiro/calçada é viário
    if (res.canteiros?.length) v = uniaoFechada([...v, ...res.canteiros]);
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
  const vias = lados.filter((l) => ehAcesso(l.tipo));
  const out: Problema[] = [];
  // rua que encosta no perímetro fora de uma estrada existente leva para a
  // terra do vizinho (ou para o rio): sem acesso, não pode abrir ali
  for (const r of ruas) {
    for (const ponta of [r.eixo[0], r.eixo[r.eixo.length - 1]]) {
      let melhor = -1, dm = Infinity;
      lados.forEach((l, i) => { const d = distSegmento(ponta, l.a, l.b).d; if (d < dm) { dm = d; melhor = i; } });
      if (melhor < 0 || dm > r.largura / 2 + 1) continue;
      const l = lados[melhor];
      if (ehAcesso(l.tipo)) continue;
      if (vias.some((v) => distSegmento(ponta, v.a, v.b).d < r.largura / 2 + 1)) continue;
      out.push({
        nivel: "aviso", alvo: { ponto: ponta },
        texto: `${r.nome} termina no lado ${melhor + 1} do perímetro (${l.tipo === "divisa" ? "divisa com vizinho" : l.tipo}), sem acesso — termine num cruzamento, faça balão ou marque o lado como estrada existente`,
      });
    }
  }
  if (!vias.length) {
    if (ruas.length) out.push({ nivel: "aviso", texto: "Nenhum lado do perímetro está marcado como rua/estrada existente: o loteamento fica sem acesso. Marque o acesso nas Perguntas." });
    return out;
  }
  if (!ruas.length) return out;
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
  return [...out, ...ruas.filter((_, i) => !ligadas.has(raiz(i))).map((r) => ({
    nivel: "aviso" as const, texto: `${r.nome} não chega a nenhuma via de acesso existente`, alvo: { ponto: r.eixo[0] },
  }))];
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
