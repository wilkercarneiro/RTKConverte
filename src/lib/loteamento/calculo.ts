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
  intersecaoRetas, quinas, quinasDe, uniao, uniaoFechada, unit, verdeValida,
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
  /** frente escolhida pelo operador — no lote ou no acesso da quadra */
  definida?: boolean;
  /** o lado não é rua (servidão, área verde, outro lote): virou frente pela escolha */
  semRua?: boolean;
  /** a frente que o operador escolheu para ESTE lote: só ela conta como frente */
  principal?: boolean;
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
  /** desenhado à mão (a quadra é do operador): fora das medidas é aviso, nunca bloqueio */
  manual?: boolean;
  /** lado que o operador escolheu como frente (plano) */
  frenteDefinida?: [Pt, Pt];
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
  /** lados da quadra marcados como acesso pelo operador (plano) */
  acessos?: [Pt, Pt][];
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
  /** quadras desenhadas à mão que ficaram sem lote (só o editor usa) */
  quadrasVazias?: Quadra[];
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
  /** lados de acesso da quadra que está sendo dividida (o operador os escolheu como frente) */
  acessosQuadra?: [Pt, Pt][];
}

/**
 * Lado escolhido pelo operador como frente: o lado (ou o pedaço dele) que cai
 * sobre um desses segmentos passa a contar como frente — "via", marcado como
 * definido (o memorial continua dizendo com quem confronta). `ruaTambem`: o
 * lado de rua também é marcado (a frente principal do lote de esquina).
 * Devolve os lados marcados.
 */
function marcarFrentes(lados: Lado[], segs: [Pt, Pt][] | undefined, ruaTambem = false): Lado[] {
  const marcados: Lado[] = [];
  if (!segs?.length) return marcados;
  for (const l of lados) {
    if ((ehFrente(l.tipo) && !ruaTambem) || l.comp < 0.05) continue;
    const m = lerp(l.a, l.b, 0.5);
    const sobre = segs.some(([a, b]) => {
      const L = dist(a, b);
      if (L < 0.05) return false;
      const d = unit(sub(b, a));
      // a frente escolhida no lote (ruaTambem) é o lado exato: o 1º trecho do
      // arco da esquina, quase alinhado com ele, não entra
      if (Math.abs(cross(d, unit(sub(l.b, l.a)))) > (ruaTambem ? 0.02 : 0.1)) return false;
      const t = dot(sub(m, a), d);
      return Math.abs(cross(d, sub(m, a))) < (ruaTambem ? 0.1 : 0.3) && t > -0.5 && t < L + 0.5;
    });
    if (!sobre) continue;
    if (!ehFrente(l.tipo)) { l.tipo = "via"; l.semRua = true; }
    l.definida = true;
    marcados.push(l);
  }
  return marcados;
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
  /** quadra entre duas ruas de frente uma para a outra (cabe costas com costas) */
  temOposta?: boolean;
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
  if (semFrente) out.push("sem frente para rua");
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
export function partirIgual(pol: Poligono, o: Pt, d: Pt, m: number, GR: number, c?: Pt): Poligono[] | null {
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

/** O lote passa no aviso da planta? (lados classificados, esquina por ruas distintas) */
function dentroDasFaixas(ctx: Contexto, pol: Poligono, p: Parametros, ponta = false): boolean {
  const fr = ladosDe(ctx, pol, null).filter((x) => ehFrente(x.tipo));
  if (!fr.length) return false;
  const segs: Seg[] = fr.map((x) => [x.a, x.b]);
  const esq = new Set(fr.map((x) => x.ref)).size >= 2 || esquinaDe(segs);
  const frente = fr.reduce((s2, x) => s2 + x.comp, 0);
  return foraDasFaixas({ area: areaPol(pol), frente, profundidade: profundidadeDe(pol, segs, true), rasa: profundidadeDe(pol, segs) }, p, false, esq, ponta ? 0 : frentePrincipal(segs)).length === 0;
}

// ---------------------------------------------------------------------------
// Divisão da quadra em lotes — faixas transversais
// ---------------------------------------------------------------------------
//
// Como o projetista divide a quadra (e o que a planta precisa ter):
//  - a quadra é cortada por linhas TRANSVERSAIS que vão de uma rua à outra.
//    Cada faixa entre duas linhas dá um lote de cada lado da linha de fundo:
//    fundo com fundo por construção, sem lote "de um lado só";
//  - as linhas são perpendiculares à rua (à bissetriz, quando as duas ruas se
//    abrem em ângulo). Na quadra de duas fileiras com as pontas oblíquas elas
//    giram de uma ponta à outra (leque); na fileira única seguem paralelas;
//  - toda quina do contorno (divisa que dobra, rua do outro lado que termina)
//    recebe uma linha: o lote não ganha 5ª quina (o máximo é 4; a ponta, 3);
//  - onde a quadra afina (ruas que se encontram), o lote vai de rua a rua;
//  - a ponta que não dá lote soma-se ao vizinho da mesma fileira, e o que passa
//    das máximas é redividido em partes iguais.

/** Área da parte do anel à esquerda da reta P + t·d (recorte por semiplano). */
function areaAEsquerda(anel: Anel, P: Pt, d: Pt): number {
  const lado = (q: Pt) => cross(d, sub(q, P));
  const out: Pt[] = [];
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    const la = lado(a), lb = lado(b);
    if (la >= 0) out.push(a);
    if ((la >= 0) !== (lb >= 0)) out.push(lerp(a, b, la / (la - lb)));
  }
  return out.length >= 3 ? areaAssinada(out) : 0;
}

/**
 * Larguras de um trecho de comprimento L: lotes de frente `f`, e o resto vai
 * para onde a quadra pede (esquinas, último, distribuído ou lote a mais). Só
 * as pontas do trecho que são ponta da quadra recebem o resto "de esquina".
 */
function larguras(L: number, f: number, p: Parametros, sobra: Sobra, pontaIni: boolean, pontaFim: boolean): number[] {
  if (L <= 0) return [];
  let n = Math.max(1, Math.floor(L / f + 1e-6));
  // nenhum lote acima da frente máxima nem abaixo da mínima, se der
  while (n > 1 && L / n < p.frenteMin - 1e-6) n--;
  while (L / n > p.frenteMax + 1e-6 && L / (n + 1) >= p.frenteMin - 1e-6) n++;
  const r = L - n * f;
  if (r < -1e-6 || (!pontaIni && !pontaFim)) return Array(n).fill(L / n);
  const w: number[] = Array(n).fill(f);
  const cabe = (x: number) => x <= p.frenteMax + 1e-6;
  if (sobra === "distribuir") return Array(n).fill(L / n);
  if (sobra === "extra" && r >= p.frenteMin - 1e-6) return [...w, r];
  if (sobra === "esquinas" && pontaIni && pontaFim && n >= 2 && cabe(f + r / 2)) { w[0] += r / 2; w[n - 1] += r / 2; return w; }
  const alvo = sobra === "ultimo" || (sobra === "esquinas" && !pontaIni) ? n - 1 : 0;
  if (cabe(w[alvo] + r)) { w[alvo] += r; return w; }
  return Array(n).fill(L / n);
}

interface Celula {
  pol: Poligono;
  fileira: number;
  /** trecho da faixa na frente mestra (posição s) */
  a: number;
  b: number;
  ponta?: boolean;
}

/**
 * Parte o polígono em `m` lotes de frente igual medida AO LONGO da frente (que
 * pode dobrar — a rua que faz curva no meio da quadra): em cada ponto de corte
 * a divisa sai perpendicular à frente ali (na dobra, pela bissetriz). É o
 * recurso para o lote grande que os cortes retos não conseguem dividir.
 */
function partirPelaFrente(pol: Poligono, naFrente: (a: Pt, b: Pt) => boolean, m: number, GR: number): Poligono[] | null {
  const e = pol.ext, n = e.length;
  // a corrente de lados de frente mais longa, na ordem do anel
  let melhor: number[] = [], atual: number[] = [];
  for (let k = 0; k < 2 * n; k++) {
    const i = k % n;
    if (naFrente(e[i], e[(i + 1) % n]) && dist(e[i], e[(i + 1) % n]) > 0.05) {
      atual.push(i);
      if (atual.length > n) break;
    } else {
      const comp = (c: number[]) => c.reduce((s2, j) => s2 + dist(e[j], e[(j + 1) % n]), 0);
      if (comp(atual) > comp(melhor)) melhor = atual;
      atual = [];
    }
  }
  if (!melhor.length || m < 2) return null;
  const pts = [e[melhor[0]], ...melhor.map((j) => e[(j + 1) % n])];
  const acum = [0];
  for (let j = 1; j < pts.length; j++) acum.push(acum[j - 1] + dist(pts[j - 1], pts[j]));
  const L = acum[acum.length - 1];
  const em = (s: number): { p: Pt; d: Pt } => {
    let j = 1;
    while (j < pts.length - 1 && acum[j] < s) j++;
    const t = (s - acum[j - 1]) / Math.max(1e-9, acum[j] - acum[j - 1]);
    const dir = unit(sub(pts[j], pts[j - 1]));
    let nrm = esquerda(dir); // interior à esquerda (anel anti-horário)
    // perto da dobra: bissetriz das duas normais
    if (t > 0.98 && j + 1 < pts.length) nrm = unit(soma(nrm, esquerda(unit(sub(pts[j + 1], pts[j])))));
    if (t < 0.02 && j > 1) nrm = unit(soma(nrm, esquerda(unit(sub(pts[j - 1], pts[j - 2])))));
    return { p: lerp(pts[j - 1], pts[j], t), d: nrm };
  };
  const partes: Poligono[] = [];
  let resto: Poligono = pol;
  for (let j = 1; j < m; j++) {
    const { p: C, d } = em((L * j) / m);
    const tg: Pt = [-d[1], d[0]]; // ao longo da frente, para o começo da corrente fica o lado "antes"
    const H = faixaReferencial(C, d, mult(tg, -1), -GR, GR, 0, GR);
    const ref = em(Math.max(0, (L * (j - 0.5)) / m));
    const sonda = soma(ref.p, mult(ref.d, 0.3));
    const lados = [intersecao([resto], [H]), diferenca([resto], [H])];
    const lado = lados.find((ps) => ps.some((x) => dentroPol(sonda, x)));
    if (!lado) return null;
    const peca = lado.find((x) => dentroPol(sonda, x))!;
    partes.push({ ext: limparAnel(peca.ext, 0.005), furos: [] });
    const r2 = diferenca([resto], [peca]).filter((x) => areaPol(x) > 0.5).sort((a, b) => areaPol(b) - areaPol(a));
    if (!r2.length) return null;
    if (r2.length > 1) return null;
    resto = r2[0];
  }
  partes.push({ ext: limparAnel(resto.ext, 0.005), furos: [] });
  return partes;
}

/**
 * Largura de verdade do lote: a menor largura da caixa orientada mais justa
 * (testa as direções dos lados). Pega a tira fina e a cunha que a "frente"
 * (soma dos lados de rua) esconde.
 */
export function larguraReal(pol: Poligono): number {
  const e = pol.ext;
  let menor = Infinity;
  for (let i = 0; i < e.length; i++) {
    const a = e[i], b = e[(i + 1) % e.length];
    if (dist(a, b) < 1) continue;
    const d = unit(sub(b, a)), n = esquerda(d);
    let lo = Infinity, hi = -Infinity;
    for (const q of e) { const t = dot(sub(q, a), n); lo = Math.min(lo, t); hi = Math.max(hi, t); }
    menor = Math.min(menor, hi - lo);
  }
  // a caixa mais justa ainda exagera no trapézio e no triângulo: a área pelo comprimento corrige
  let comp = 0;
  for (let i = 0; i < e.length; i++) for (let j = i + 1; j < e.length; j++) comp = Math.max(comp, dist(e[i], e[j]));
  return Number.isFinite(menor) ? Math.min(menor, comp > 0 ? (2 * areaPol(pol)) / comp : menor) : 0;
}

/**
 * Quadra desenhada pelo operador: os lotes são os contornos dele, recortados
 * pela quadra (se uma rua andar, o lote é aparado e a parte que ficar sem lote
 * aparece como área livre). Nada é redividido nem "consertado": o que sair das
 * medidas vira aviso no lote.
 */
function quadraDesenhada(ctx: Contexto, pol: Poligono, cfg: QuadraCfg, P: (q: Pt) => Pt): ResultadoQuadra {
  const lotes: ResultadoQuadra["lotes"] = [];
  const destinos = new Map<string, TipoArea>();
  const problemas: string[] = [];
  const usados: Poligono[] = [];
  (cfg.lotes ?? []).forEach((ld, k) => {
    if (ld.anel.length < 3) return;
    const bruto: Poligono = { ext: antiHorario(ld.anel.map(P)), furos: [] };
    // o que já é de outro lote não entra de novo (desenho sobreposto)
    const pedacos = diferenca(intersecao([bruto], [pol]), usados).filter((x) => areaPol(x) > 0.05).sort((a, b) => areaPol(b) - areaPol(a));
    if (!pedacos.length) return;
    const pg: Poligono = { ext: limparAnel(pedacos[0].ext, 0.003), furos: pedacos[0].furos };
    usados.push(pg);
    lotes.push({ pol: pg, area: areaPol(pg), fileira: 0, indice: k, ajustado: false, manual: true, frenteDefinida: ld.frente ? [P(ld.frente[0]), P(ld.frente[1])] : undefined });
    if (ld.destino) destinos.set(`0:${k}`, ld.destino);
  });
  const livre = diferenca([pol], usados).filter((x) => areaPol(x) > 1);
  const aLivre = livre.reduce((s2, x) => s2 + areaPol(x), 0);
  if (aLivre > 1) problemas.push(`${fmt(aLivre)} m² sem lote (área livre — desenhe um lote nela ou mova as divisas)`);
  // referencial: a frente mais longa (o aviso de comprimento da quadra e os textos usam)
  const fr = ladosDe(ctx, pol, null).filter((l) => ehFrente(l.tipo));
  const maior = fr.length ? fr.reduce((m, l) => (l.comp > m.comp ? l : m), fr[0]) : { a: pol.ext[0], b: pol.ext[1] };
  const u = unit(sub(maior.b, maior.a));
  return {
    lotes, destinos, cortes: [], fundo: null, sobras: livre, canteiros: [], origem: maior.a, u, v: esquerda(u),
    fileiras: 1, problemas, ruins: 0, nFaces: 0, tortos: 0, largura: 0, rasos: 0,
  };
}

function dividirQuadra(
  ctx: Contexto, pol: Poligono, cfg: QuadraCfg | null, p: Parametros, modo: ModoDivisao, valor: number, sobra: Sobra,
  ancoraFrente: Pt | null, opcaoFace = 0,
): ResultadoQuadra {
  const lados = ladosDe(ctx, pol, null);
  marcarFrentes(lados, ctx.acessosQuadra);
  const fs = faces(lados).filter((f) => f.comp >= Math.min(p.frenteMin, 3));
  const vazio = (msg: string): ResultadoQuadra => ({
    lotes: [], destinos: new Map(), cortes: [], fundo: null, sobras: [pol], origem: pol.ext[0], u: [1, 0], v: [0, 1],
    fileiras: 0, problemas: [msg], ruins: 0, nFaces: 0, tortos: 0, largura: 0, rasos: 0,
  });
  if (!fs.length) return vazio("quadra sem frente para rua");

  // frentes candidatas, da mais longa para a mais curta (a 2ª e a 3ª só são
  // tentadas quando a mais longa deixa lote fora das medidas)
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
  // do paralelo — a quadra entre as duas tem duas fileiras, uma para cada rua
  // A rua oposta tem de estar À FRENTE da principal (a faixa em "V" que dá a
  // volta numa praça tem as duas ruas de costas uma para a outra)
  const opostas = fs.filter((f) => f !== principal && dot(f.dir, u) < -0.5 && f.comp >= 0.3 * principal.comp
    && proj(lerp(f.maior.a, f.maior.b, 0.5))[1] > 0.5 * p.profundidadeMin);
  const oposta = opostas.length ? opostas.reduce((m, f) => (f.comp > m.comp ? f : m), opostas[0]) : null;
  // de frente (até 40° fora do paralelo): as divisas atravessam a quadra de
  // rua a rua. Em esquina (as ruas se encontram num canto da quadra): cada
  // fileira é dividida perpendicular à SUA rua, e as duas se encontram na bissetriz
  const deFrente = !!oposta && dot(oposta.dir, u) < -Math.cos((40 * Math.PI) / 180);
  const D = oposta ? (proj(oposta.maior.a)[1] + proj(oposta.maior.b)[1]) / 2 : vMax;

  const pedido = cfg?.fileiras ?? "auto";
  let duas = !!oposta && (pedido === 2 || (pedido === "auto" && D >= Math.max(1.2 * p.profundidade, 2 * p.profundidadeMin)));
  if (pedido === 1) duas = false;

  const problemas: string[] = [];
  const sobras: Poligono[] = [];
  const paralela = !oposta || dot(oposta.dir, u) < -0.95;
  // limites dos cortadores: só um pouco além da própria quadra (retângulo de
  // 100 km tira o clipper da faixa de inteiros "rápida" e ele erra por arredondamento)
  const GR = pol.ext.reduce((m, q) => Math.max(m, dist(q, o)), 0) + 50;

  // ---------------- fileiras: a linha de fundo parte a quadra em duas
  const filA: Poligono[] = [], filB: Poligono[] = [];
  let fundo: Quadra["fundo"] = null;
  /** normal da linha de fundo (perpendicular a ela, para dentro, do lado da rua principal para a oposta) */
  let normalFundo: Pt | null = null;
  if (duas && !paralela && cfg?.fundo === undefined) {
    // ruas que se abrem em ângulo: o fundo é a bissetriz entre as duas — cada
    // ponto fica com a rua mais próxima, e as fileiras têm a mesma profundidade
    const o2 = oposta!.maior.a;
    const v2 = esquerda(oposta!.dir);
    const nb = unit(sub(v, v2));
    const c = dot(o, v) - dot(o2, v2);
    const k = c / Math.max(1e-9, Math.hypot(v[0] - v2[0], v[1] - v2[1]));
    const pb = soma(o, mult(nb, k - dot(o, nb)));
    const tb = esquerda(nb);
    filA.push(...intersecao([pol], [faixaReferencial(pb, tb, nb, -GR, GR, -GR, 0)]));
    filB.push(...intersecao([pol], [faixaReferencial(pb, tb, nb, -GR, GR, 0, GR)]));
    const ts = pol.ext.map((q) => dot(sub(q, pb), tb));
    fundo = { a: soma(pb, mult(tb, Math.min(...ts))), b: soma(pb, mult(tb, Math.max(...ts))), valor: D / 2 };
    normalFundo = nb;
  } else if (duas) {
    const f = Math.max(0.2 * D, Math.min(0.8 * D, cfg?.fundo ?? D / 2));
    filA.push(...intersecao([pol], [faixaReferencial(o, u, v, -GR, GR, -GR, f)]));
    filB.push(...intersecao([pol], [faixaReferencial(o, u, v, -GR, GR, f, GR)]));
    const us = pol.ext.map((q) => proj(q)[0]);
    fundo = { a: soma(o, soma(mult(u, Math.min(...us)), mult(v, f))), b: soma(o, soma(mult(u, Math.max(...us)), mult(v, f))), valor: f };
    normalFundo = v;
  } else {
    // fileira única: além da profundidade máxima o fundo não é lote
    const limite = Math.max(p.profundidadeMax, 1.2 * p.profundidade);
    if (!oposta && vMax > limite) {
      // profundidade típica (mediana ao longo da frente): se cabe na máxima,
      // quem passa é só o bico da ponta — corta-se na máxima, e o lote vai até
      // a divisa; aparar a fileira toda na padrão deixaria faixa sem uso
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
      filA.push(...intersecao([pol], [faixaReferencial(o, u, v, -GR, GR, -GR, f)]));
      sobras.push(...diferenca([pol], [faixaReferencial(o, u, v, -GR, GR, -GR, f)]));
      const us = pol.ext.map((q) => proj(q)[0]);
      fundo = { a: soma(o, soma(mult(u, Math.min(...us)), mult(v, f))), b: soma(o, soma(mult(u, Math.max(...us)), mult(v, f))), valor: f };
    } else filA.push(pol);
  }

  // frente útil: lados que dão para rua
  const frentes = lados.filter((l) => ehFrente(l.tipo));
  const caixasFrente = frentes.map((l) => ({ l, x0: Math.min(l.a[0], l.b[0]) - 0.03, x1: Math.max(l.a[0], l.b[0]) + 0.03, y0: Math.min(l.a[1], l.b[1]) - 0.03, y1: Math.max(l.a[1], l.b[1]) + 0.03 }));
  const naFrente = (a: Pt, b: Pt) => {
    const m = lerp(a, b, 0.5);
    return caixasFrente.some((c) => m[0] >= c.x0 && m[0] <= c.x1 && m[1] >= c.y0 && m[1] <= c.y1 && distSegmento(m, c.l.a, c.l.b).d < 0.02);
  };
  // fileira funda demais (a quadra alarga na ponta): apara numa linha paralela
  // à rua, na profundidade máxima — o fundo vira UM retalho, não um pente de
  // pontas. Na beira da estrada de acesso não apara (ali é lote).
  const viasDaQuadra = lados.filter((l) => l.tipo === "via");
  const tocaEstrada = (pg: Poligono) => pg.ext.some((q, k) => {
    const m = lerp(q, pg.ext[(k + 1) % pg.ext.length], 0.5);
    return viasDaQuadra.some((l) => distSegmento(m, l.a, l.b).d < 0.05);
  });
  for (const fil of [filA, filB]) {
    for (let i = 0; i < fil.length; i++) {
      const fp = fil[i];
      const segs = frentesBrutas(fp, naFrente);
      if (!segs.length || profundidadeDe(fp, segs, true) <= limiteFundo(p)) continue;
      const corredor = corredorDaFrente(fp, segs, p.profundidadeMax, 0);
      const fora = diferenca([fp], corredor).filter((x) => areaPol(x) > 1 && !tocaEstrada(x));
      if (!fora.length) continue;
      const dentro = diferenca([fp], fora).filter((x) => areaPol(x) > 1).sort((x, y) => areaPol(y) - areaPol(x));
      if (!dentro.length) continue;
      fil[i] = dentro[0];
      sobras.push(...dentro.slice(1), ...fora);
    }
  }
  const nFileiras = filB.length ? 2 : 1;

  const ajustesPorFil = new Map<number, Map<number, AjusteLote>>();
  for (const a of cfg?.ajustes ?? []) {
    if (!ajustesPorFil.has(a.fileira)) ajustesPorFil.set(a.fileira, new Map());
    ajustesPorFil.get(a.fileira)!.set(a.indice, a);
  }
  // pontos do contorno onde o vizinho muda (rua → divisa, divisa → área): viram divisa de lote
  const trocas: Pt[] = [];
  lados.forEach((l, i) => {
    const ant = lados[(i - 1 + lados.length) % lados.length];
    if (ant.tipo !== l.tipo && !(ehFrente(ant.tipo) && ehFrente(l.tipo))) trocas.push(l.a);
  });
  const naLinhaDeFundo = (q: Pt) => !!fundo && Math.abs(cross(unit(sub(fundo.b, fundo.a)), sub(q, fundo.a))) < 0.05;
  const f = modo === "frente" ? Math.max(valor, 0.5) : p.frente;
  let fundoMax = 0;
  for (const q of pol.ext) fundoMax = Math.max(fundoMax, Math.abs(proj(q)[1]));
  const T = 3 * (fundoMax + 20);

  interface Plano { o: Pt; u: Pt; v: Pt; ini: number; fim: number; F: (s: number) => Pt; dirEm: (s: number) => Pt; posDe: (q: Pt) => number; emLeque: boolean }
  /**
   * Divisas de um grupo de fileiras que compartilham as mesmas linhas (as duas
   * de uma quadra entre ruas de frente, ou uma fileira só). `oR`/`uR`: a rua de
   * referência (o interior fica à esquerda de uR); `c0`: direção base das divisas.
   */
  const planejar = (fils: Poligono[][], oR: Pt, uR: Pt, c0: Pt, filTrava: number, oposB: Face | null): { plano: Plano; celulas: Celula[][] } | null => {
    const vR = esquerda(uR);
    const pr = (q: Pt): [number, number] => [dot(sub(q, oR), uR), dot(sub(q, oR), vR)];
    let ini = Infinity, fim = -Infinity;
    for (const fp of fils[0]) for (let i = 0; i < fp.ext.length; i++) {
      const a = fp.ext[i], b = fp.ext[(i + 1) % fp.ext.length];
      if (!naFrente(a, b)) continue;
      for (const q of [a, b]) { const s = pr(q)[0]; ini = Math.min(ini, s); fim = Math.max(fim, s); }
    }
    if (!Number.isFinite(ini) || fim - ini < 0.5) return null;
    const L = fim - ini;
    const F = (s: number): Pt => soma(oR, mult(uR, s));
    const todos = fils.flat();
    const noGrupo = (q: Pt) => todos.some((fp) => fp.ext.some((a, i) => distSegmento(q, a, fp.ext[(i + 1) % fp.ext.length]).d < 0.05));

    // pontas: o lado mais longo em cada extremidade, se fizer 35° ou mais com a
    // rua (ponta em bico não serve de guia); rua manda sobre divisa
    const sen35 = Math.sin((35 * Math.PI) / 180);
    type Cand = { d: Pt; c: number; peso: number };
    let pi: Cand | null = null, pf: Cand | null = null;
    for (const l of lados) {
      if (l.comp < 4 || !noGrupo(lerp(l.a, l.b, 0.5))) continue;
      let d = unit(sub(l.b, l.a));
      if (Math.abs(cross(d, uR)) < sen35) continue;
      if (dot(d, c0) < 0) d = mult(d, -1);
      const sm = pr(lerp(l.a, l.b, 0.5))[0];
      const x: Cand = { d, c: l.comp, peso: ehFrente(l.tipo) ? 2 : 1 };
      const melhor = (m: Cand | null) => !m || x.peso > m.peso || (x.peso === m.peso && x.c > m.c);
      if (sm <= ini + 0.25 * L && melhor(pi)) pi = x;
      if (sm >= fim - 0.25 * L && melhor(pf)) pf = x;
    }
    const sen12 = Math.sin((12 * Math.PI) / 180);
    const guia = (x: Cand | null) => (x && Math.abs(cross(x.d, c0)) >= sen12 ? x.d : null);
    // a divisa acompanha a ponta oblíqua até 45° com a rua (lote em trapézio, como na planta da equipe)
    // (na fileira única, que inclina inteira, até 30°)
    const limitar = (d: Pt): Pt => {
      const ang = Math.atan2(cross(c0, d), dot(c0, d));
      const lim = ((fils.length === 1 ? 30 : 45) * Math.PI) / 180;
      const a = Math.max(-lim, Math.min(lim, ang));
      return [c0[0] * Math.cos(a) - c0[1] * Math.sin(a), c0[0] * Math.sin(a) + c0[1] * Math.cos(a)];
    };
    const gi = guia(pi), gf = guia(pf);
    const dI = gi ? limitar(gi) : null, dF = gf ? limitar(gf) : null;
    let cIni: Pt = c0, cFim: Pt = c0;
    if (fils.length === 1) {
      // fileira única: lotes paralelos; se as duas pontas inclinam para o mesmo lado, na média
      if (dI && dF && Math.sign(cross(c0, dI)) === Math.sign(cross(c0, dF))) cIni = cFim = unit(soma(dI, dF));
    } else {
      // duas fileiras: leque de uma ponta à outra
      cIni = dI ?? c0; cFim = dF ?? c0;
      // as divisas não podem se cruzar dentro da quadra (lote em gravata)
      const x = intersecaoRetas(F(ini), cIni, F(fim), cFim);
      if (x && x.t > 0 && x.t < 1.2 * Math.max(D, vMax)) cIni = cFim = unit(soma(cIni, cFim));
    }
    const aIni = Math.atan2(cIni[1], cIni[0]);
    let delta = Math.atan2(cFim[1], cFim[0]) - aIni;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const dirEm = (s: number): Pt => {
      const t = Math.max(0, Math.min(1, (s - ini) / L));
      const a = aIni + delta * t;
      return [Math.cos(a), Math.sin(a)];
    };
    /** posição s da divisa que passa pelo ponto q */
    const posDe = (q: Pt): number => {
      let s = pr(q)[0];
      for (let it = 0; it < 8; it++) {
        const c = dirEm(s);
        s = pr(q)[0] - (pr(q)[1] * dot(c, uR)) / Math.max(1e-9, dot(c, vR));
      }
      return s;
    };
    const plano: Plano = { o: oR, u: uR, v: vR, ini, fim, F, dirEm, posDe, emLeque: Math.abs(delta) > 1e-6 };

    // régua: a fileira de frentes MENORES recebe a frente padrão (a outra sai
    // um pouco mais larga — nunca abaixo da mínima)
    let regua = (s: number) => s;
    if (oposB && fils.length === 2) {
      const tB = (s: number) => { const x = intersecaoRetas(F(s), dirEm(s), oposB.maior.a, oposB.dir); return x ? -dot(sub(x.pt, oposB.maior.a), oposB.dir) : NaN; };
      const k = (tB(fim) - tB(ini)) / L;
      if (Number.isFinite(k) && k > 0.2 && k < 0.97) regua = tB;
    }
    const sDe = (m: number): number => {
      let lo = ini - L, hi = fim + L;
      for (let it = 0; it < 50; it++) { const md = (lo + hi) / 2; if (regua(md) < m) lo = md; else hi = md; }
      return (lo + hi) / 2;
    };

    // ---------------- posições das divisas
    const travas = [...(ajustesPorFil.get(filTrava)?.values() ?? [])].filter((a) => a.frente || a.area);
    const fil0 = fils[0];
    const area0 = fil0.reduce((s2, x) => s2 + areaPol(x), 0);
    const areaAte = (s: number) => fil0.reduce((s2, x) => s2 + areaAEsquerda(x.ext, F(s), dirEm(s)), 0);
    let cortesS: number[] = [];
    if (travas.length) {
      // lotes travados pelo operador ficam com a frente (ou a área) dele; os livres dividem o resto por igual
      const profMed = area0 / L;
      const larg = (a: AjusteLote) => a.frente ?? (a.area ?? 0) / Math.max(1, profMed);
      const fixo = travas.reduce((s2, a) => s2 + larg(a), 0);
      const nLivre = Math.max(0, Math.round(Math.max(0, L - fixo) / f));
      const n = travas.length + nLivre;
      const wLivre = nLivre ? Math.max(0, L - fixo) / nLivre : 0;
      const ws: number[] = [];
      for (let i = 0, k = 0; i < Math.max(n, ...travas.map((a) => a.indice + 1)); i++) {
        const a = ajustesPorFil.get(filTrava)?.get(i);
        if (a && (a.frente || a.area)) ws.push(larg(a));
        else if (k < nLivre) { ws.push(wLivre); k++; }
      }
      let s = ini;
      for (const w of ws.slice(0, -1)) { s += w; if (s < fim - 0.5) cortesS.push(s); }
    } else if (modo === "quantidade") {
      const n = Math.max(1, Math.round(valor));
      for (let i = 1; i < n; i++) cortesS.push(ini + (L * i) / n);
    } else if (modo === "area") {
      const n = Math.max(1, Math.round(area0 / Math.max(1, valor)));
      for (let i = 1; i < n; i++) {
        let lo = ini - 0.5 * L, hi = fim + 0.5 * L;
        for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (areaAte(m) < (area0 * i) / n) lo = m; else hi = m; }
        cortesS.push((lo + hi) / 2);
      }
    } else {
      // quinas do contorno viram divisa: o lote não ganha 5ª quina
      const ancoras: { s: number; peso: number }[] = [];
      // (também as da quadra inteira: o fundo além da profundidade máxima volta
      // aos lotes no fim do cálculo, e a quina da divisa lá atrás precisa de divisa)
      for (const fp of [...todos, ...(fils.length === 1 ? [pol] : [])]) {
        // quinas como o comprador as vê: o arco da esquina (ou da rua que dobra) é UMA quina
        const qs = new Set(quinasDe(fp.ext));
        fp.ext.forEach((q, i) => {
          const troca = trocas.some((t) => dist(t, q) < 0.05);
          if ((!qs.has(i) && !troca) || naLinhaDeFundo(q)) return;
          const s = posDe(q);
          // arco (lados curtos em volta): o da esquina da quadra fica inteiro no lote de esquina
          const e = fp.ext, n = e.length;
          const arco = dist(e[(i - 1 + n) % n], q) < 2 || dist(q, e[(i + 1) % n]) < 2;
          const folga = arco ? Math.max(0.6 * p.frenteMin, 2 * p.esquinaValor + f) : 0.6 * p.frenteMin;
          if (s > ini + folga && s < fim - folga) ancoras.push({ s, peso: troca ? 180 : 90 });
        });
      }
      const aceitas: number[] = [];
      for (const an of ancoras.sort((a, b) => b.peso - a.peso)) {
        if (aceitas.every((x) => Math.abs(x - an.s) >= 0.75 * f)) aceitas.push(an.s);
      }
      const marcos = [ini, ...aceitas.sort((a, b) => a - b), fim].map(regua);
      for (let k = 0; k + 1 < marcos.length; k++) {
        const ws = larguras(marcos[k + 1] - marcos[k], f, p, sobra, k === 0, k + 2 === marcos.length);
        let m = marcos[k];
        for (const w of ws.slice(0, -1)) { m += w; cortesS.push(sDe(m)); }
        if (k + 2 < marcos.length) cortesS.push(sDe(marcos[k + 1]));
      }
    }
    cortesS = cortesS.filter((x) => x > ini + 0.3 && x < fim - 0.3).sort((a, b) => a - b);

    // ---------------- células: cada faixa × cada fileira
    const faixa = (sa: number, sb: number): Poligono => {
      const da = dirEm(sa), db = dirEm(sb), A = F(sa), B = F(sb);
      return { ext: antiHorario([soma(A, mult(da, -T)), soma(B, mult(db, -T)), soma(B, mult(db, T)), soma(A, mult(da, T))]), furos: [] };
    };
    const lim = [-GR, ...cortesS, GR];
    const celulas: Celula[][] = fils.map(() => []);
    fils.forEach((fil, r) => {
      if (!fil.length) return;
      for (let k = 0; k + 1 < lim.length; k++) {
        const partes = intersecao(fil, [faixa(lim[k], lim[k + 1])]).filter((x) => areaPol(x) > 0.05).sort((x, y) => areaPol(y) - areaPol(x));
        if (!partes.length) continue;
        sobras.push(...partes.slice(1));
        celulas[r].push({ pol: { ext: limparAnel(partes[0].ext, 0.005), furos: partes[0].furos }, fileira: r, a: lim[k], b: lim[k + 1] });
      }
    });
    return { plano, celulas };
  };

  // base: perpendicular à rua (à linha de fundo, na quadra entre ruas que se abrem)
  const cBase: Pt = normalFundo && deFrente ? (dot(normalFundo, v) >= 0 ? normalFundo : mult(normalFundo, -1)) : v;
  const compartilhado = nFileiras === 2 && deFrente;
  const linhas: Celula[][] = [[], []];
  const planos: Plano[] = [];
  if (compartilhado || nFileiras === 1) {
    const g = planejar(nFileiras === 2 ? [filA, filB] : [filA], o, u, cBase, 0, compartilhado ? oposta : null);
    if (!g) return vazio("quadra sem frente para rua");
    g.celulas.forEach((c, r) => { linhas[r] = c; planos[r] = g.plano; });
  } else {
    const gA = planejar([filA], o, u, v, 0, null);
    if (!gA) return vazio("quadra sem frente para rua");
    linhas[0] = gA.celulas[0]; planos[0] = gA.plano;
    const uB = oposta!.dir;
    const gB = planejar([filB], oposta!.maior.a, uB, esquerda(uB), 1, null);
    if (gB) { linhas[1] = gB.celulas[0]; planos[1] = gB.plano; }
    else sobras.push(...filB);
  }
  const plA = planos[0];

  // ---------------- acabamento
  const medir = (pg: Poligono) => {
    const segs = frentesBrutas(pg, naFrente);
    const frente = segs.reduce((s2, [a, b]) => s2 + dist(a, b), 0);
    const esquina = esquinaDe(segs);
    return {
      area: areaPol(pg), frente, testada: frentePrincipal(segs), esquina,
      prof: segs.length ? profundidadeDe(pg, segs, true) : 0, rasa: segs.length ? profundidadeDe(pg, segs) : 0,
      nq: quinas(pg.ext), largura: larguraReal(pg),
    };
  };
  const juntar = (a: Poligono, b: Poligono): Poligono | null => {
    const un = uniaoFechada([a, b]);
    return un.length === 1 && !un[0].furos.length ? { ext: limparAnel(un[0].ext, 0.005), furos: [] } : null;
  };
  const areaMaxF = p.areaMax * FOLGA_MAX;
  const pequena = (m: ReturnType<typeof medir>) => m.area < p.areaMin - 0.01 || (m.frente > 0.05 && m.frente < p.frenteMin - 0.005);
  const rasa = (m: ReturnType<typeof medir>) => !m.esquina && m.frente > 0.05 && m.rasa < p.profundidadeMin - 0.5;

  // custo de um lote: quanto ele falta com as regras (0 = lote bom)
  const custo = (pg: Poligono): number => {
    const m = medir(pg);
    if (m.frente < 0.05) return 100;
    let c = 0;
    // lote sem frente ou sem área não é lote: a falta pesa mais que qualquer excesso
    if (m.area < p.areaMin - 0.01) c += 10 + (40 * (p.areaMin - m.area)) / p.areaMin;
    if (m.area > areaMaxF) c += 5 + 10 * (m.area / p.areaMax - 1);
    // a mínima vale para a frente de UMA rua: o lote de rua a rua não soma as duas
    const fr = m.esquina ? m.frente : Math.min(m.frente, m.testada);
    if (fr < p.frenteMin - 0.005) c += 10 + (40 * (p.frenteMin - fr)) / p.frenteMin;
    // muito mais estreito que o padrão da quadra (legal, mas destoa da fileira)
    else if (!m.esquina && m.testada < 0.65 * f) c += 2 + (4 * (0.65 * f - m.testada)) / f;
    else if (!m.esquina && acimaDaFrente(m.testada, p)) c += 5;
    else if (m.esquina && m.testada > 1.5 * p.frenteMax) c += 5 + 10 * (m.testada / (1.5 * p.frenteMax) - 1);
    if (m.prof > limiteFundo(p)) c += 5 + 10 * (m.prof / p.profundidadeMax - 1);
    else if (rasa(m) || (m.esquina && m.rasa < 0.6 * p.profundidadeMin)) c += 3;
    if (m.nq > 4) c += 4 * (m.nq - 4);
    // tira e cunha: a largura de verdade (não a frente) abaixo da frente mínima
    if (m.largura < p.frenteMin - 0.05) c += 6 + (20 * (p.frenteMin - m.largura)) / p.frenteMin;
    const ang = anguloMinimo(pg);
    if (ang < 25) c += 6; else if (ang < 45) c += 2;
    return c;
  };
  // (1) onde a quadra afina (as ruas se encontram), o lote vai de rua a rua
  if (compartilhado && linhas[1].length) {
    for (const ca of linhas[0]) {
      const cb = linhas[1].find((x) => Math.abs(x.a - ca.a) < 1e-6);
      if (!cb) continue;
      const ma = medir(ca.pol), mb = medir(cb.pol);
      if (!(pequena(ma) || pequena(mb) || rasa(ma) || rasa(mb))) continue;
      const u2 = juntar(ca.pol, cb.pol);
      if (!u2 || areaPol(u2) > areaMaxF) continue;
      ca.pol = u2; ca.ponta = true;
      linhas[1].splice(linhas[1].indexOf(cb), 1);
    }
  }
  // (2) célula sem frente para rua: entra na célula da mesma faixa (vira lote
  //     de rua a rua) ou no vizinho da fileira que encosta mais
  for (const r of [1, 0]) {
    for (const c of [...linhas[r]]) {
      if (medir(c.pol).frente > 0.05) continue;
      const outra = compartilhado ? linhas[1 - r].find((x) => x.a <= c.a + 1e-6 && x.b >= c.b - 1e-6) : undefined;
      const vizinhos = [outra, ...linhas[r].filter((x) => x !== c && (Math.abs(x.b - c.a) < 1e-6 || Math.abs(x.a - c.b) < 1e-6))].filter((x): x is Celula => !!x);
      let feito = false;
      for (const viz of vizinhos) {
        const u2 = juntar(viz.pol, c.pol);
        if (!u2) continue;
        viz.pol = u2;
        if (viz === outra) viz.ponta = true;
        else { viz.a = Math.min(viz.a, c.a); viz.b = Math.max(viz.b, c.b); }
        feito = true;
        break;
      }
      linhas[r].splice(linhas[r].indexOf(c), 1);
      if (!feito) sobras.push(c.pol);
    }
  }
  // Quadra entre ruas de frente: o acabamento é feito por FAIXA (as duas
  // fileiras juntas), para nenhum lote ficar de costas para dois. Roda de novo
  // (só a redivisão) depois do acabamento das pontas.
  const acabarPorFaixa = (soRedividir: boolean) => {
    type Faixa = { a: number; b: number; c: (Celula | null)[] };
    // borda de faixa: nenhum lote de nenhuma fileira passa por cima dela
    const comum = (x: number) => linhas.every((lin) => !lin.some((c) => c.a < x - 1e-6 && c.b > x + 1e-6));
    const bordas = [...new Set(linhas.flat().flatMap((c) => [c.a, c.b]).map((x) => +x.toFixed(9)))].sort((x, y) => x - y).filter(comum);
    const faixas: Faixa[] = [];
    let normal = true;
    for (let k = 0; k + 1 < bordas.length; k++) {
      const a = bordas[k], b = bordas[k + 1];
      const c = linhas.map((lin, r) => {
        const cs = lin.filter((x) => x.a >= a - 1e-6 && x.b <= b + 1e-6);
        if (!cs.length) return null;
        let U: Poligono | null = cs[0].pol;
        for (const x of cs.slice(1)) U = U && juntar(U, x.pol);
        if (!U) { normal = false; return cs[0]; }
        return { pol: U, fileira: r, a, b, ponta: cs.some((x) => x.ponta) || undefined } as Celula;
      });
      if (c.some(Boolean)) faixas.push({ a, b, c });
    }
    if (normal && faixas.length) {
      const unirFaixas = (i: number, j: number): boolean => {
        const [x, y] = [faixas[Math.min(i, j)], faixas[Math.max(i, j)]];
        const c: (Celula | null)[] = [];
        for (let r = 0; r < 2; r++) {
          const px = x.c[r], py = y.c[r];
          if (px && py) { const u2 = juntar(px.pol, py.pol); if (!u2) return false; c.push({ pol: u2, fileira: r, a: x.a, b: y.b, ponta: px.ponta || py.ponta }); }
          else c.push(px ? { ...px, a: x.a, b: y.b } : py ? { ...py, a: x.a, b: y.b } : null);
        }
        faixas.splice(Math.min(i, j), 2, { a: x.a, b: y.b, c });
        return true;
      };
      const ruim = (f: Faixa, teste: (m: ReturnType<typeof medir>, pg: Poligono) => boolean) => f.c.some((c) => c && teste(medir(c.pol), c.pol));
      // (3s) ponta pequena: a faixa inteira soma-se à vizinha de dentro
      const semJeito = new Set<Faixa>();
      for (let guarda = 0; guarda < (soRedividir ? 0 : 40) && faixas.length > 1; guarda++) {
        const i = faixas.findIndex((f) => !semJeito.has(f) && ruim(f, (m) => pequena(m)));
        if (i < 0) break;
        const j = i === 0 ? 1 : i === faixas.length - 1 ? i - 1 : (areaPol(faixas[i - 1].c[0]?.pol ?? faixas[i - 1].c[1]!.pol) <= areaPol(faixas[i + 1].c[0]?.pol ?? faixas[i + 1].c[1]!.pol) ? i - 1 : i + 1);
        if (!unirFaixas(i, j)) semJeito.add(faixas[i]);
      }
      // (4s) faixa com lote acima das máximas: o lote de rua a rua grande volta a
      // ser dois, costas com costas; senão a faixa é redividida inteira em partes iguais
      const valido = (pg: Poligono) => { const mx = medir(pg); return mx.area >= p.areaMin - 0.01 && mx.area <= areaMaxF && Math.min(mx.frente, mx.esquina ? mx.frente : mx.testada) >= p.frenteMin - 0.005; };
      for (const f of faixas) {
        const unica = f.c[0] && !f.c[1] ? 0 : f.c[1] && !f.c[0] ? 1 : -1;
        if (unica < 0 || areaPol(f.c[unica]!.pol) <= areaMaxF || !filB.length) continue;
        const cel = f.c[unica]!;
        const pa = intersecao([cel.pol], filA).filter((x) => areaPol(x) > 0.5), pb = intersecao([cel.pol], filB).filter((x) => areaPol(x) > 0.5);
        if (pa.length !== 1 || pb.length !== 1 || !valido(pa[0]) || !valido(pb[0])) continue;
        f.c = [{ ...cel, pol: { ext: limparAnel(pa[0].ext, 0.005), furos: [] }, fileira: 0, ponta: undefined }, { ...cel, pol: { ext: limparAnel(pb[0].ext, 0.005), furos: [] }, fileira: 1, ponta: undefined }];
      }
      for (let i = 0; i < faixas.length; i++) {
        const f = faixas[i];
        let precisa = 1;
        for (const c of f.c) {
          if (!c) continue;
          const m = medir(c.pol);
          const larga = !m.esquina && acimaDaFrente(m.testada, p);
          if (m.area > areaMaxF || larga) precisa = Math.max(precisa, Math.ceil(m.area / p.areaMax - 1e-6), larga ? Math.ceil(m.testada / p.frenteMax - 1e-6) : 2);
        }
        if (precisa < 2) continue;
        const sa = Math.max(f.a, plA.ini), sb = Math.min(f.b, plA.fim);
        let novas: Faixa[] | null = null;
        // entre as quantidades possíveis, a que deixa a faixa com menos falta (e só se melhorar)
        const custoFaixas = (fs: Faixa[]) => fs.reduce((s2, x) => s2 + x.c.reduce((s3, c) => s3 + (c ? custo(c.pol) : 0), 0), 0);
        let cNovas = custoFaixas([f]) - 0.5;
        for (let k = precisa; k <= precisa + 1; k++) {
          const lim = [f.a, ...Array.from({ length: k - 1 }, (_, j) => sa + ((sb - sa) * (j + 1)) / k), f.b];
          const cand: Faixa[] = [];
          let ok = true;
          for (let j = 0; j + 1 < lim.length && ok; j++) {
            const fx = { ext: antiHorario([soma(plA.F(lim[j]), mult(plA.dirEm(lim[j]), -T)), soma(plA.F(lim[j + 1]), mult(plA.dirEm(lim[j + 1]), -T)), soma(plA.F(lim[j + 1]), mult(plA.dirEm(lim[j + 1]), T)), soma(plA.F(lim[j]), mult(plA.dirEm(lim[j]), T))]), furos: [] };
            const c = f.c.map((cel, r) => {
              if (!cel) return null;
              const ps = intersecao([cel.pol], [fx]).filter((x) => areaPol(x) > 0.5);
              if (ps.length > 1) ok = false;
              return ps[0] ? ({ pol: { ext: limparAnel(ps[0].ext, 0.005), furos: [] }, fileira: r, a: lim[j], b: lim[j + 1], ponta: cel.ponta } as Celula) : null;
            });
            if (c.every((x) => !x || (() => { const mx = medir(x.pol); return mx.area >= p.areaMin - 0.01 && mx.frente >= p.frenteMin - 0.005; })())) cand.push({ a: lim[j], b: lim[j + 1], c });
            else ok = false;
          }
          if (ok && custoFaixas(cand) < cNovas) { novas = cand; cNovas = custoFaixas(cand); }
        }
        if (!novas) continue;
        faixas.splice(i, 1, ...novas);
        i += novas.length - 1;
      }
      // (6s) mais de 4 quinas: junta a faixa com a vizinha se tudo fica com até 4
      for (let i = 0; i < (soRedividir ? 0 : faixas.length); i++) {
        if (!ruim(faixas[i], (m) => m.nq > 4)) continue;
        for (const j of [i - 1, i + 1]) {
          if (j < 0 || j >= faixas.length) continue;
          const copia = faixas.slice();
          if (!unirFaixas(i, j)) continue;
          const f = faixas[Math.min(i, j)];
          if (f.c.every((c) => !c || (quinas(c.pol.ext) <= 4 && areaPol(c.pol) <= areaMaxF))) { i = Math.max(-1, Math.min(i, j) - 1); break; }
          faixas.splice(0, faixas.length, ...copia);
        }
      }
      linhas[0] = faixas.map((f) => f.c[0]).filter((c): c is Celula => !!c);
      linhas[1] = faixas.map((f) => f.c[1]).filter((c): c is Celula => !!c);
    }
  };
  if (compartilhado) acabarPorFaixa(false);
  // (3) ponta pequena (cunha da divisa oblíqua, resto da esquina) soma-se ao
  //     vizinho da fileira, do lado de dentro
  for (const r of compartilhado ? [] : [0, 1]) {
    const lin = linhas[r];
    for (let guarda = 0; guarda < 40; guarda++) {
      const i = lin.findIndex((c) => lin.length > 1 && pequena(medir(c.pol)));
      if (i < 0) break;
      const j = i === 0 ? 1 : i === lin.length - 1 ? i - 1 : (areaPol(lin[i - 1].pol) <= areaPol(lin[i + 1].pol) ? i - 1 : i + 1);
      const u2 = juntar(lin[i].pol, lin[j].pol);
      if (!u2) break;
      const [x, y] = [lin[i], lin[j]];
      lin.splice(Math.min(i, j), 2, { pol: u2, fileira: r, a: Math.min(x.a, y.a), b: Math.max(x.b, y.b), ponta: x.ponta || y.ponta });
    }
  }
  // (4) célula acima das máximas (o canto largo da quadra, a junção do passo
  //     anterior): redividida em partes iguais, com divisas na direção da faixa
  for (const r of compartilhado ? [] : [0, 1]) {
    const lin = linhas[r];
    for (let i = 0; i < lin.length; i++) {
      const c = lin[i];
      const m = medir(c.pol);
      const largaDemais = !m.esquina && acimaDaFrente(m.testada, p);
      if (!(m.area > areaMaxF || largaDemais)) continue;
      const pl = planos[r];
      const dc = pl.dirEm((Math.max(c.a, pl.ini) + Math.min(c.b, pl.fim)) / 2);
      const segs = frentesBrutas(c.pol, naFrente);
      const fr = frenteMaiorDe(segs);
      if (!fr) continue;
      const m0 = Math.max(2, Math.ceil(m.area / p.areaMax - 1e-6), largaDemais ? Math.ceil(m.testada / p.frenteMax - 1e-6) : 2);
      let partes: Poligono[] | null = null;
      for (let k = m0; k <= m0 + 1 && !partes; k++) {
        for (const [j, ps] of [partirFrenteIgual(c.pol, segs, fr.a, pl.u, k, GR, dc), partirIgual(c.pol, fr.a, pl.u, k, GR, dc), partirPelaFrente(c.pol, naFrente, k, GR)].entries()) {
          // pela frente (último recurso) só se cada parte sai lote de verdade: até 4 quinas, sem ficar rasa
          if (ps && ps.every((x) => { const mx = medir(x); return mx.area >= p.areaMin - 0.01 && mx.frente >= p.frenteMin - 0.005 && (j < 2 || (mx.nq <= 4 && !rasa(mx))); })) { partes = ps; break; }
        }
      }
      if (!partes) continue;
      const pos = (pg: Poligono) => pl.posDe(centroide(pg.ext));
      partes.sort((x, y) => pos(x) - pos(y));
      const novas: Celula[] = partes.map((x, k) => ({ pol: x, fileira: r, a: k === 0 ? c.a : pos(x), b: k === partes!.length - 1 ? c.b : pos(partes![k + 1]), ponta: c.ponta }));
      lin.splice(i, 1, ...novas);
      i += novas.length - 1;
    }
  }
  // (4b) quadra que alarga: o lote que passa do fundo máximo cede a parte de
  //      trás ao lote de costas para ele (a mesma faixa), se esse tem folga —
  //      a divisa de fundo daquele par anda, os dois seguem com 4 quinas
  if (compartilhado && !ctx.busca) {
    for (const [r, s2] of [[0, 1], [1, 0]] as const) {
      for (const c of linhas[r]) {
        const o2 = linhas[s2].find((x) => Math.abs(x.a - c.a) < 1e-6 && Math.abs(x.b - c.b) < 1e-6);
        if (!o2) continue;
        const m = medir(c.pol);
        if (m.prof <= limiteFundo(p) || m.esquina) continue;
        const segs = frentesBrutas(c.pol, naFrente);
        const U = juntar(c.pol, o2.pol);
        if (!U || !segs.length) continue;
        const corredor = corredorDaFrente(c.pol, segs, p.profundidadeMax - 0.3, 2);
        const novoC = intersecao([U], corredor).filter((x) => areaPol(x) > 1).sort((x, y) => areaPol(y) - areaPol(x));
        if (novoC.length !== 1) continue;
        const novoO = diferenca([U], [novoC[0]]).filter((x) => areaPol(x) > 1);
        if (novoO.length !== 1) continue;
        const mo = medir(novoO[0]);
        if (mo.prof > limiteFundo(p) || mo.nq > 4 || quinas(novoC[0].ext) > 4 || mo.frente < 0.05) continue;
        c.pol = { ext: limparAnel(novoC[0].ext, 0.005), furos: [] };
        o2.pol = { ext: limparAnel(novoO[0].ext, 0.005), furos: [] };
      }
    }
  }
  // (5) pontas da fileira: os 1 a 4 lotes da ponta são redivididos (em mais,
  //     menos ou o mesmo número de lotes, com as divisas na direção da fileira,
  //     na da ponta ou entre as duas) se isso tirar lote das faltas — é a ponta
  //     que absorve a irregularidade da quadra, como o projetista faz
  // Quadra entre ruas de frente: a ponta é redividida nas DUAS fileiras pelas
  // mesmas linhas (fundo com fundo até a ponta). Onde a faixa fica rasa, o par
  // vira um lote de rua a rua.
  if (compartilhado && !ctx.busca && linhas[1].length) {
    const pl = plA;
    const custoPar = (a: Poligono | null, b: Poligono | null): { c: number; pols: (Poligono | null)[]; junto: boolean } => {
      const sep = (a ? custo(a) : 0) + (b ? custo(b) : 0);
      if (a && b) {
        const u = juntar(a, b);
        if (u) { const cu = custo(u); if (cu + 0.5 < sep) return { c: cu, pols: [u, null], junto: true }; }
      }
      return { c: sep, pols: [a, b], junto: false };
    };
    for (const lado of [0, 1]) {
      const bordas = (lin: Celula[]) => new Set(lin.flatMap((c) => [c.a, c.b]).filter((x) => Math.abs(x) < GR - 1).map((x) => x.toFixed(6)));
      const comuns = [...bordas(linhas[0])].filter((x) => bordas(linhas[1]).has(x)).map(Number).sort((a, b) => (lado === 0 ? a - b : b - a));
      let melhor: { corte: number; novas: Celula[][]; ganho: number } | null = null;
      for (const corte of comuns.slice(0, 4)) {
        const grupo = linhas.map((lin) => lin.filter((c) => (lado === 0 ? c.b <= corte + 1e-6 : c.a >= corte - 1e-6)));
        if (!grupo[0].length) continue;
        const atual = grupo.flat().reduce((s2, c) => s2 + custo(c.pol), 0);
        if (atual < 0.5) continue;
        const uniaoDe = (cs: Celula[]) => { let U: Poligono | null = cs[0]?.pol ?? null; for (const c of cs.slice(1)) U = U && juntar(U, c.pol); return U; };
        const U = grupo.map(uniaoDe);
        if (!U[0]) continue;
        const k = Math.max(grupo[0].length, grupo[1].length);
        const sIni = lado === 0 ? pl.ini : corte, sFim = lado === 0 ? corte : pl.fim;
        const dPonta = pl.dirEm(lado === 0 ? pl.ini : pl.fim);
        for (let m2 = Math.max(1, k - 1); m2 <= k + 1; m2++) {
          for (const modoDir of [0, 1]) {
            if (modoDir === 1 && Math.abs(cross(dPonta, pl.dirEm(corte))) < 0.05) continue;
            // linhas de corte: o fim do grupo fica onde está; as de dentro são novas
            const pos = Array.from({ length: m2 - 1 }, (_, j) => sIni + ((sFim - sIni) * (j + 1)) / m2);
            const dir = (s3: number) => (modoDir === 1 ? dPonta : pl.dirEm(s3));
            const lim = lado === 0 ? [-GR, ...pos, corte] : [corte, ...pos, GR];
            const fx = (sa: number, sb: number): Poligono => {
              const da = sa === corte ? pl.dirEm(corte) : dir(sa), db = sb === corte ? pl.dirEm(corte) : dir(sb), A = pl.F(sa), B = pl.F(sb);
              return { ext: antiHorario([soma(A, mult(da, -T)), soma(B, mult(db, -T)), soma(B, mult(db, T)), soma(A, mult(da, T))]), furos: [] };
            };
            const novas: Celula[][] = [[], []];
            let c2 = 0, ok = true;
            for (let j = 0; j + 1 < lim.length && ok; j++) {
              const pedaco = (Ur: Poligono | null) => {
                if (!Ur) return null;
                const ps = intersecao([Ur], [fx(lim[j], lim[j + 1])]).filter((x) => areaPol(x) > 0.5);
                if (ps.length > 1) ok = false;
                return ps[0] ? { ext: limparAnel(ps[0].ext, 0.005), furos: [] } as Poligono : null;
              };
              const pa = pedaco(U[0]), pb = pedaco(U[1]);
              if (!pa && !pb) continue;
              const par = custoPar(pa, pb);
              c2 += par.c;
              par.pols.forEach((pg, r) => { if (pg) novas[r].push({ pol: pg, fileira: r, a: lim[j], b: lim[j + 1], ponta: par.junto || undefined }); });
            }
            if (!ok) continue;
            const ganho = atual - c2;
            if (ganho > 0.5 && (!melhor || ganho > melhor.ganho + 1e-6)) melhor = { corte, novas, ganho };
          }
        }
      }
      if (!melhor) continue;
      const mc = melhor;
      linhas.forEach((lin, r) => {
        const fora = lin.filter((c) => !(lado === 0 ? c.b <= mc.corte + 1e-6 : c.a >= mc.corte - 1e-6));
        linhas[r] = lado === 0 ? [...mc.novas[r], ...fora] : [...fora, ...mc.novas[r]];
      });
    }
  }
  if (compartilhado && !ctx.busca) acabarPorFaixa(true);
  for (const r of ctx.busca || compartilhado ? [] : [0, 1]) {
    const lin = linhas[r];
    const pl = planos[r];
    if (!pl || lin.length < 2) continue;
    for (const ladoPonta of [0, 1]) {
      const grupoDe = (k: number) => (ladoPonta === 0 ? lin.slice(0, k) : lin.slice(lin.length - k));
      const atual = grupoDe(Math.min(4, lin.length)).map((c) => custo(c.pol));
      if (atual.every((x) => x === 0)) continue;
      let melhor: { k: number; partes: Poligono[]; ganho: number } | null = null;
      for (let k = 1; k <= Math.min(4, lin.length); k++) {
        const grupo = grupoDe(k);
        const custoAtual = (ladoPonta === 0 ? atual.slice(0, k) : atual.slice(atual.length - k)).reduce((s2, x) => s2 + x, 0);
        if (custoAtual === 0) continue;
        let U: Poligono | null = grupo[0].pol;
        for (const g of grupo.slice(1)) { U = U && juntar(U, g.pol); }
        if (!U) continue;
        const segs = frentesBrutas(U, naFrente);
        const fr = frenteMaiorDe(segs);
        if (!fr) continue;
        // direções: a da fileira (no limite de dentro do grupo), a da ponta e a média
        const sDentro = ladoPonta === 0 ? grupo[k - 1].b : grupo[0].a;
        const cDentro = pl.dirEm(Math.max(pl.ini, Math.min(pl.fim, sDentro)));
        const cPonta = pl.dirEm(ladoPonta === 0 ? pl.ini : pl.fim);
        const dirs: Pt[] = [cDentro];
        if (Math.abs(cross(cPonta, cDentro)) > 0.05) dirs.push(cPonta, unit(soma(cPonta, cDentro)));
        const area = areaPol(U);
        const mMin = Math.max(1, Math.ceil(area / p.areaMax - 1e-6)), mMax = Math.max(1, Math.floor(area / p.areaMin + 1e-6));
        for (let m2 = Math.max(mMin, k - 1); m2 <= Math.min(mMax, Math.max(k + 1, mMin + 1)); m2++) {
          for (const dc of dirs) {
            const opcoes = m2 === 1 ? [[U]] : [partirIgual(U, fr.a, pl.u, m2, GR, dc), partirFrenteIgual(U, segs, fr.a, pl.u, m2, GR, dc)];
            for (const ps of opcoes) {
              if (!ps) continue;
              const c2 = ps.reduce((s2, x) => s2 + custo(x), 0);
              // o que mais tira falta; empate: mais lotes
              const ganho = custoAtual - c2;
              if (ganho > 0.5 && (!melhor || ganho > melhor.ganho + 1e-6 || (Math.abs(ganho - melhor.ganho) < 1e-6 && ps.length > melhor.partes.length))) melhor = { k, partes: ps, ganho };
            }
          }
        }
      }
      if (!melhor) continue;
      const grupo = grupoDe(melhor.k);
      const sA = Math.min(...grupo.map((g) => g.a)), sB = Math.max(...grupo.map((g) => g.b));
      const pos = (pg: Poligono) => pl.posDe(centroide(pg.ext));
      const ord = [...melhor.partes].sort((x, y) => pos(x) - pos(y));
      const novas: Celula[] = ord.map((x, j) => ({
        pol: { ext: limparAnel(x.ext, 0.005), furos: x.furos }, fileira: r,
        a: j === 0 ? sA : (pos(ord[j - 1]) + pos(x)) / 2, b: j === ord.length - 1 ? sB : (pos(x) + pos(ord[j + 1])) / 2,
        ponta: grupo.some((g) => g.ponta) || undefined,
      }));
      lin.splice(ladoPonta === 0 ? 0 : lin.length - melhor.k, melhor.k, ...novas);
    }
  }
  // (6) mais de 4 quinas: junta com o vizinho da fileira se a junção fica com 4
  for (const r of compartilhado ? [] : [0, 1]) {
    const lin = linhas[r];
    for (let i = 0; i < lin.length; i++) {
      if (medir(lin[i].pol).nq <= 4) continue;
      for (const j of [i - 1, i + 1]) {
        if (j < 0 || j >= lin.length) continue;
        const u2 = juntar(lin[i].pol, lin[j].pol);
        if (!u2 || quinas(u2.ext) > 4 || areaPol(u2) > areaMaxF) continue;
        const [x, y] = [lin[i], lin[j]];
        lin.splice(Math.min(i, j), 2, { pol: u2, fileira: r, a: Math.min(x.a, y.a), b: Math.max(x.b, y.b), ponta: x.ponta || y.ponta });
        i = Math.max(-1, Math.min(i, j) - 1);
        break;
      }
    }
  }

  // ---------------- lotes: índice na ordem da fileira (a de trás volta), ajustes do operador
  const lotes: ResultadoQuadra["lotes"] = [];
  const destinos = new Map<string, TipoArea>();
  const cortes: Corte[] = [];
  linhas[0].sort((x, y) => x.a - y.a);
  // a fileira de trás volta (na quadra de linhas compartilhadas o s é o da rua principal)
  linhas[1].sort((x, y) => (compartilhado ? y.a - x.a : x.a - y.a));
  linhas.forEach((lin, r) => {
    const pl = planos[r] ?? plA;
    const acudo = (d: Pt) => (Math.asin(Math.min(1, Math.abs(cross(d, pl.u)))) * 180) / Math.PI;
    const aj = ajustesPorFil.get(r) ?? new Map<number, AjusteLote>();
    // une (com o seguinte) — uma vez
    const fila = lin.map((c, i) => ({ c, indice: i }));
    for (let i = 0; i + 1 < fila.length; i++) {
      if (!aj.get(fila[i].indice)?.unir) continue;
      const u2 = juntar(fila[i].c.pol, fila[i + 1].c.pol);
      if (!u2) continue;
      fila[i].c = { ...fila[i].c, pol: u2, a: Math.min(fila[i].c.a, fila[i + 1].c.a), b: Math.max(fila[i].c.b, fila[i + 1].c.b) };
      fila.splice(i + 1, 1);
    }
    fila.forEach(({ c, indice }, i) => {
      const a = aj.get(indice);
      const dc = pl.dirEm((Math.max(c.a, pl.ini) + Math.min(c.b, pl.fim)) / 2);
      const nDiv = Math.max(1, Math.min(20, Math.round(a?.dividir ?? 1)));
      let partes = [c.pol];
      if (nDiv > 1) {
        const segs = frentesBrutas(c.pol, naFrente);
        const fr = frenteMaiorDe(segs);
        const ps = fr ? partirFrenteIgual(c.pol, segs, fr.a, pl.u, nDiv, GR, dc) ?? partirIgual(c.pol, fr.a, pl.u, nDiv, GR, dc) : null;
        if (ps) partes = ps.sort((x, y) => (r === 0 || !compartilhado ? 1 : -1) * (pl.posDe(centroide(x.ext)) - pl.posDe(centroide(y.ext))));
      }
      partes.forEach((pg, k) => lotes.push({
        pol: pg, area: areaPol(pg), fileira: r, indice: indice + (partes.length > 1 ? k / 100 : 0),
        angCorte: pl.emLeque || Math.abs(cross(dc, pl.v)) > 1e-6 ? Math.min(acudo(pl.dirEm(c.a)), acudo(pl.dirEm(c.b))) : undefined,
        dirCorte: dc, ponta: c.ponta || undefined,
        ajustado: !!a && !!(a.frente || a.area || a.unir || (a.dividir && a.dividir > 1)),
        travaFrente: a?.frente, travaArea: a?.area,
      }));
      if (a?.destino) destinos.set(`${r}:${indice}`, a.destino);
      // divisa entre este e o próximo da fileira mestra (o operador arrasta)
      const prox = fila[i + 1];
      if (r === 0 && prox && Math.abs(prox.c.a - c.b) < 1e-6) {
        const dcb = pl.dirEm(c.b), Fb = pl.F(c.b);
        const ps = pol.ext.map((q) => dot(sub(q, Fb), dcb));
        cortes.push({
          fileira: 0, indice, arrastavel: nDiv === 1 && Math.max(1, Math.round(aj.get(prox.indice)?.dividir ?? 1)) === 1,
          a: soma(Fb, mult(dcb, Math.min(...ps))), b: soma(Fb, mult(dcb, Math.max(...ps))),
          o: pl.o, dir: pl.u, s0: i === 0 ? pl.ini : c.a, s: c.b, sFim: pl.fim,
        });
      }
    });
  });

  // ---------------- retalhos (fundo aparado, pedaço de quadra côncava)
  // retalho com frente e área de lote é lote (sobretudo na beira da estrada)
  const restantes: Poligono[] = [];
  const padrao = Math.max(p.areaMin, p.areaPadrao);
  let extra = 0;
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
    // fundo grande com pouca frente não é lote: um lote gigante seria pior que a área verde/remanescente
    const mPossivel = Math.max(1, Math.floor(fr / p.frenteMin));
    if (area / mPossivel > 1.5 * p.areaMax) { restos.push(sb); return; }
    // partes perto da área padrão, nenhuma acima da máxima, divisas perpendiculares à frente dele
    const m = Math.max(1, Math.min(Math.floor(fr / p.frenteMin), Math.max(Math.round(area / padrao), Math.ceil(area / p.areaMax - 1e-6))));
    const d = unit(sub(maior[1], maior[0]));
    const partes = m > 1 ? partirIgual(sb, maior[0], d, m, GR) ?? [sb] : [sb];
    const ajR = ajustesPorFil.get(9);
    for (const pg of partes) {
      let frP = 0;
      for (let i = 0; i < pg.ext.length; i++) if (naFrente(pg.ext[i], pg.ext[(i + 1) % pg.ext.length])) frP += dist(pg.ext[i], pg.ext[(i + 1) % pg.ext.length]);
      if (frP < p.frenteMin - 0.005 || areaPol(pg) < p.areaMin - 0.01) { restos.push(pg); continue; }
      const idx = extra++;
      saida.push({ pol: pg, area: areaPol(pg), fileira: 9, indice: idx, ajustado: false, retalho: acimaDaArea(areaPol(pg), p) || undefined });
      const dest = ajR?.get(idx)?.destino;
      if (dest) destinos.set(`9:${idx}`, dest);
    }
  };
  for (const sb of sobras) lotearRetalho(sb, lotes, restantes);
  // retalho sem frente que encosta num lote soma-se a ele, se o lote continua
  // dentro das medidas e com no máximo 4 quinas
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
      const u2 = uniaoFechada([l.pol, sb]);
      if (u2.length !== 1 || u2[0].furos.length) continue;
      const novo: Poligono = { ext: limparAnel(u2[0].ext, 0.005), furos: [] };
      if (quinas(novo.ext) > 4) continue;
      if (profundidadeDe(novo, frentesBrutas(novo, naFrente), true) > limiteFundo(p)) continue;
      if (!melhor || l.area < lotes[melhor.i].area) melhor = { i, pol: novo, area: areaPol(novo) };
    }
    if (melhor) { lotes[melhor.i] = { ...lotes[melhor.i], pol: melhor.pol, area: melhor.area, ponta: true }; continue; }
    finais.push(sb);
  }
  // nenhum retalho sem dono na planta: o que tem frente e cabe nas medidas é
  // lote; os demais entram no lote vizinho no fim do cálculo
  if (ctx.juntar) {
    // a faixa de fundo atrás de vários lotes é partida pelas divisas
    // prolongadas: cada lote leva o pedaço que fica atrás dele
    const linhasCorte = cortes.map((c) => ({ a: c.a, d: unit(sub(c.b, c.a)) })).filter((l) => Number.isFinite(l.d[0]));
    for (let i = finais.length - 1; i >= 0; i--) {
      let pecas: Poligono[] = [finais[i]];
      const cb = caixa(finais[i].ext);
      const cantos: Pt[] = [cb.min, [cb.max[0], cb.min[1]], cb.max, [cb.min[0], cb.max[1]]];
      for (const ln of linhasCorte) {
        const ladosC = cantos.map((q) => Math.sign(cross(ln.d, sub(q, ln.a))));
        if (ladosC.every((x) => x >= 0) || ladosC.every((x) => x <= 0)) continue;
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
      const antes = lotes.length, restos: Poligono[] = [];
      lotearRetalho(sb, lotes, restos);
      if (lotes.length > antes) finais.splice(i, 1, ...restos.filter((x) => areaPol(x) > 0.5));
    }
    for (let i = finais.length - 1; i >= 0; i--) {
      const sb = finais[i];
      if ((ctx.marcas ?? []).some((m) => dentroPol(m, sb))) continue;
      if (!dentroDasFaixas(ctx, sb, p)) continue;
      lotes.push({ pol: sb, area: areaPol(sb), fileira: 9, indice: 100 + extra++, ajustado: false });
      finais.splice(i, 1);
    }
  }
  // último recurso para lote muito acima da área máxima (a dobra da rua, o
  // canto largo): partes iguais ao longo da frente, se ficarem melhores
  for (let i = 0; i < lotes.length && !ctx.busca; i++) {
    const l = lotes[i];
    if (l.ajustado || destinos.has(`${l.fileira}:${l.indice}`) || l.area <= 1.15 * areaMaxF) continue;
    let melhorP: Poligono[] | null = null, cMelhor = custo(l.pol);
    for (let k = Math.max(2, Math.ceil(l.area / p.areaMax - 1e-6)); k <= Math.max(2, Math.round(l.area / p.areaPadrao)) + 1; k++) {
      const ps = partirPelaFrente(l.pol, naFrente, k, GR);
      // as partes não podem ter mais quinas que o permitido — nem que o lote original, se ele já passava
      const nqMax = Math.max(4, quinas(l.pol.ext) - 1);
      if (!ps || !ps.every((x) => { const mx = medir(x); return mx.area >= p.areaMin - 0.01 && mx.frente >= p.frenteMin - 0.005 && mx.nq <= nqMax && !rasa(mx); })) continue;
      const c2 = ps.reduce((s2, x) => s2 + custo(x), 0);
      if (c2 < cMelhor - 0.5) { cMelhor = c2; melhorP = ps; }
    }
    if (!melhorP) continue;
    lotes.splice(i, 1, ...melhorP.map((pg, j) => ({ ...l, pol: pg, area: areaPol(pg), indice: l.indice + j / 1000, ponta: undefined })));
    i += melhorP.length - 1;
  }
  // quadrinha de ponta (2 ou 3 lotes entre ruas e divisa): um lote só, se
  // couber nas medidas e ficar com até 4 quinas. Lote de quadrinha é lote de
  // ponta — ajusta a linha da propriedade (a frente máxima não vale para ele)
  if (!ctx.busca && lotes.length >= 2 && lotes.length <= 3 && !destinos.size && !lotes.some((l) => l.ajustado)) {
    let U: Poligono | null = lotes[0].pol;
    for (const l of lotes.slice(1)) U = U && juntar(U, l.pol);
    if (U && areaPol(U) <= areaMaxF && quinas(U.ext) <= 4) lotes.splice(0, lotes.length, { ...lotes[0], pol: U, area: areaPol(U), ponta: true });
  }
  if (lotes.length <= 3) for (const l of lotes) l.ponta = true;
  // fora das faixas também conta como lote ruim: é o que faz o cálculo tentar
  // outra frente / outro número de fileiras para a quadra
  let ruins = 0, tortos = 0, rasos = 0;
  for (const l of lotes) {
    if (destinos.has(`${l.fileira}:${l.indice}`) || l.ponta) continue;
    const segs = frentesDe(l.pol, naFrente);
    const ang = anguloMinimo(l.pol, pol);
    // divisa oblíqua de projeto (leque, bissetriz): o canto pode fugir um pouco do esquadro
    const deProjeto = l.angCorte !== undefined && ang >= Math.max(40, l.angCorte - 15);
    if (ang < 70 && !deProjeto) tortos++;
    const esq = esquinaDe(segs);
    const fr = segs.reduce((s2, [a, b]) => s2 + dist(a, b), 0);
    if (!esq && fr > 0 && l.area / fr < 1.5 * p.profundidadeMin && fundoDe(l.pol, segs) < p.profundidadeMin - 0.5) rasos++;
    if (acimaDaArea(l.area, p) || passaDoFundo(l.pol, segs, p) || l.area < p.areaMin - 0.01 || frentePrincipal(segs) < p.frenteMin - 0.005) ruins++;
    else if (!esq && acimaDaFrente(segs.reduce((s2, [a, b]) => s2 + dist(a, b), 0), p)) ruins++;
    else if (ang < 50 && !deProjeto) ruins++; // cunha
    else if (quinas(l.pol.ext) > 4) ruins++;
  }
  return { lotes, destinos, cortes, fundo, sobras: finais, canteiros: [], origem: o, u, v, fileiras: nFileiras, problemas, ruins, nFaces: candidatas.length, tortos, largura: D, rasos, temOposta: deFrente };
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

/**
 * Divisões já feitas, por "mundo" (perímetro, parâmetros, ruas, áreas e
 * configs das quadras — menos os lotes desenhados, que não mudam a divisão das
 * outras). Arrastar uma quina recalcula só a quadra desenhada; as demais vêm
 * daqui. Guarda os 4 últimos mundos.
 */
const mundos = new Map<string, Map<string, ResultadoQuadra>>();
function cacheDaDivisao(projeto: Projeto, perimetro: Perimetro, op: OpcoesCalculo): Map<string, ResultadoQuadra> {
  const k = JSON.stringify({
    pts: perimetro.pts, conf: perimetro.confrontantes, p: projeto.params, b: projeto.bordas, r: projeto.ruas, a: projeto.areas, s: projeto.sobrasPublicas,
    // das configs das quadras só entram as áreas públicas (elas mudam o vizinho de
    // cada lado); o resto de cada config vai na chave da própria quadra. Assim
    // congelar ou desenhar uma quadra não refaz as outras (sem tranco no arraste)
    // (quais tipos, não a geometria: o vizinho de cada lado só muda quando não há
    // rua no meio, e arrastar a quina de um lote não pode refazer o loteamento inteiro)
    // (config sem área pública nem entra: congelar uma quadra cria config nova, e isso não pode invalidar as outras)
    q: projeto.quadras.flatMap((c) => {
      const tipos = [...new Set([c.destino, ...c.ajustes.map((a) => a.destino), ...(c.lotes ?? []).map((l) => l.destino)].filter(Boolean))].sort();
      return tipos.length ? [[c.ancora, tipos]] : [];
    }),
    o: [!!op.rapido, !!op.busca, !!op.manterSobras],
  });
  let m = mundos.get(k);
  if (m && m.size > 600) m.clear();
  if (m) { mundos.delete(k); mundos.set(k, m); return m; }
  m = new Map();
  mundos.set(k, m);
  while (mundos.size > 4) mundos.delete(mundos.keys().next().value!);
  return m;
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
  const vazios: Poligono[] = [];

  const fixos = new Indice();
  for (const a of areas) for (const pol of a.pols) fixos.add(item(pol, a.tipo === "app" ? "faixa" : "area", a.id, a.nome));
  if (op.busca) op = { ...op, rapido: true };
  const ctx: Contexto = {
    prof: p.profundidade, areaMin: p.areaMin, gleba, ladosGleba, confrontantes: perimetro.confrontantes, ruas, fixos, busca: op.busca,
    juntar: !op.rapido && !op.busca && !op.manterSobras,
    marcas: (projeto.sobrasPublicas ?? []).map((m) => P(m.ponto)),
  };

  // divisão de cada quadra guardada: na edição só a quadra mexida é refeita
  const cacheQ = cacheDaDivisao(projeto, perimetro, op);

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
  const quadrasVazias: Quadra[] = [];
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
    // quadra com lotes desenhados pelo operador: é o desenho dele, não se redivide
    const manual = Array.isArray(q.cfg?.lotes);
    const chave = manual ? "" : `${q.cfgIdx}|${q.cfg ? JSON.stringify({ ...q.cfg, lotes: undefined }) : ""}|${modo}|${valor}|${sobra}|${polEsq.ext.map((x) => `${x[0].toFixed(3)},${x[1].toFixed(3)}`).join(";")}`;
    const guardado = manual ? undefined : cacheQ.get(chave);
    if (guardado) {
      for (const s of guardado.sobras) sobras.push(s);
      canteiros.push(...(guardado.canteiros ?? []));
      desarmonicos += guardado.ruins + 0.5 * guardado.tortos;
    }
    // lados de acesso que o operador marcou nesta quadra contam como frente na divisão
    const acessosQ = q.cfg?.acessos?.map((sg) => [P(sg[0]), P(sg[1])] as [Pt, Pt]);
    ctx.acessosQuadra = acessosQ;
    let res = guardado ?? (manual ? quadraDesenhada(ctx, polEsq, q.cfg!, P) : dividirQuadra(ctx, polEsq, q.cfg, p, modo, valor, sobra, ancFrente));
    // frente mais longa deixou lote torto/nanico (quadra com um lado diagonal):
    // tenta lotear pelas outras frentes e fica com a que dá mais lote bom
    // (na busca rápida do gerador pula: a contagem de lotes quase não muda e custa o triplo)
    // (e uma ou duas fileiras, se o operador não escolheu): quadra triangular
    // ou funda demais costuma ter uma combinação sem lote fora das faixas
    // quadra com ajuste do operador (trava, unir, dividir) fica no arranjo em
    // que ele mexeu: outra frente ou outro nº de fileiras jogaria a edição fora
    const editada = (q.cfg?.ajustes ?? []).some((a) => a.frente !== undefined || a.area !== undefined || a.unir || (a.dividir ?? 0) > 1);
    if (!guardado && !manual && !op.rapido && !ancFrente && !editada && res.ruins > 0) {
      // retalho loteado (fileira 9) é lote de sobra, fora da malha da quadra: vale menos
      // lote de rua a rua (frente para duas ruas) é o que as normas mandam evitar:
      // a quadra entre duas ruas de frente fica com uma fileira só se a de duas for bem pior
      const nota = (r: ResultadoQuadra) => r.lotes.length - 0.6 * r.lotes.filter((l) => l.fileira === 9).length - 3 * r.ruins - r.tortos
        - r.sobras.reduce((s2, x) => s2 + areaPol(x), 0) / Math.max(1, p.areaPadrao)
        - (r.temOposta && r.fileiras === 1 ? 0.25 * r.lotes.length : 0);
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
    if (!guardado) {
      if (!manual) cacheQ.set(chave, res);
      // área livre da quadra desenhada fica como está (o operador decide o que fazer com ela)
      for (const s of res.sobras) (manual ? vazios : sobras).push(s);
      canteiros.push(...(res.canteiros ?? []));
      desarmonicos += res.ruins + 0.5 * res.tortos;
    }

    // numeração: fileira 0 no sentido dela, fileira 1 voltando — dá a volta na quadra
    const lotesQ = res.lotes.map((l, i) => ({ l, i, dest: res.destinos.get(`${l.fileira}:${l.indice}`) }));
    const ordem = [
      ...lotesQ.filter((x) => x.l.fileira === 0),
      ...lotesQ.filter((x) => x.l.fileira === 1),
      ...lotesQ.filter((x) => x.l.fileira > 1),
    ];
    // anti-horário por construção; horário = inverter. Começa no lote mais a noroeste.
    let seq = manual || p.sentidoLotes !== "horario" ? ordem : [...ordem].reverse();
    if (seq.length > 1 && !manual) {
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
    // quadra desenhada à mão guarda a letra mesmo sem lote (senão as outras mudariam de nome)
    if (temLote || manual) nQuadra++;
    const quadra: Quadra = {
      cfg: q.cfgIdx, nome, pol: polEsq, area: areaPol(polEsq), lotes: [], origem: res.origem, u: res.u, v: res.v,
      fundo: res.fundo, cortes: res.cortes, modo, valor, sobra, fileiras: res.fileiras, centro: q.centro,
      ancoraUtm: q.cfg?.ancora, problemas: res.problemas, curvas, acessos: acessosQ,
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
    // quadra desenhada que ficou sem lote não vai para a planta nem para as
    // entregas, mas o editor ainda a acha (para voltar ao automático, preencher)
    if (temLote) quadras.push(quadra);
    else if (manual) quadrasVazias.push(quadra);
    // quadra sem nenhum lote (sem frente para rua): o editor precisa achá-la para
    // o operador escolher a frente dela — com nome próprio, sem tomar a letra de outra
    else if (!seq.length) quadrasVazias.push({ ...quadra, nome: q.cfg?.nome || `(sem frente ${quadrasVazias.length + 1})` });
  }
  ctx.acessosQuadra = undefined;

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
        .map((x) => ({ ...x, ok: dentroDasFaixas(ctx, x.u[0], p, !!x.l.ponta), nq: quinas(x.u[0].ext), contato: x.l.pol.ext.length ? perimetroDe(x.l.pol) + perimetroDe(sb) - perimetroDe(x.u[0]) : 0 }))
        // retalho grande demais (mais que o dobro do lote máximo) não vira "lote": fica como área remanescente
        .filter((x) => areaPol(x.u[0]) <= 2 * p.areaMax);
      // de preferência um vizinho que continue nas medidas e com até 4 quinas
      // de jeito nenhum um lote com mais de 4 quinas — só a lasca minúscula entra assim
      const viz = cands.filter((x) => x.ok && x.nq <= 4).sort((a, b) => a.l.area - b.l.area)[0]
        ?? cands.filter((x) => x.nq <= 4).sort((a, b) => b.contato - a.contato)[0]
        ?? (areaPol(sb) < 0.1 * p.areaMin ? cands.sort((a, b) => b.contato - a.contato)[0] : undefined);
      if (viz) {
        viz.l.pol = { ext: limparAnel(viz.u[0].ext, 0.005), furos: [] };
        viz.l.area = areaPol(viz.l.pol);
        if (!viz.ok) viz.l.retalho = true;
        lotesIdx.add(item(viz.l.pol, "lote", viz.l.id, `Lote ${String(viz.l.numero).padStart(2, "0")} da Quadra ${viz.l.quadra}`));
        sobras.splice(i, 1);
      } else if (bicoDeCanteiro(sb)) canteiros.push(...sobras.splice(i, 1));
    }
  }
  // --- área livre das quadras desenhadas: não entra no lote vizinho (é do operador)
  sobras.push(...vazios);
  // --- sobras entram no índice (para o lado do lote dizer "área remanescente")
  for (const [i, s] of sobras.entries()) fixos.add(item(s, "sobra", `sobra${i}`, "área remanescente"));

  // --- quadras vizinhas sem rua no meio: agora com as esquinas já arredondadas
  //     (o canto cortado da esquina é calçada, não "lote vizinho")
  ctx.pecas = new Indice();
  for (const q of quadras) ctx.pecas.add(item(q.pol, "lote", `quadra${q.nome}`, "lote vizinho"));
  // --- lados e problemas dos lotes
  for (const l of lotes) {
    if (op.rapido) {
      l.frente = 0;
      if (l.area < p.areaMin - 0.01) l.problemas.push("área abaixo do mínimo");
      if (acimaDaArea(l.area, p)) l.problemas.push("área acima do máximo");
      continue;
    }
    l.lados = ladosDe(ctx, l.pol, lotesIdx, l.id);
    // frente escolhida pelo operador: o lado de acesso da quadra e o lado marcado no lote
    const qdl = quadras.find((x) => x.nome === l.quadra);
    marcarFrentes(l.lados, qdl?.acessos);
    // a frente escolhida no lote manda: só ela é frente — a rua do outro lado
    // fica como confrontação (é assim que se escolhe a frente da esquina)
    const principal = l.frenteDefinida ? marcarFrentes(l.lados, [l.frenteDefinida], true) : [];
    for (const x of principal) x.principal = true;
    const fr = principal.length ? principal : l.lados.filter((x) => ehFrente(x.tipo));
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
    // forma: no máximo 4 quinas (o lote de ponta pode ter 3)
    const nq = quinas(l.pol.ext);
    // (divisão de imóvel rural desliga a regra: quinasMax 0 — a parte segue o perímetro)
    const qMax = p.quinasMax ?? 4;
    if (qMax > 0 && nq > qMax) l.problemas.push(`${nq} quinas — o máximo é ${qMax}`);
    // fora das medidas por decisão do operador (ajuste) ou por ter absorvido
    // o retalho da gleba: é aviso — o lote fica marcado para ele acertar
    const nivelLote: Problema["nivel"] = l.ajustado || l.retalho || l.manual ? "aviso" : "erro";
    for (const pr of l.problemas) problemas.push({ nivel: nivelLote, texto: `Lote ${l.id}: ${pr}${l.retalho && !l.ajustado ? " (absorveu retalho da gleba)" : ""}`, alvo: { lote: l.id } });
  }
  for (const q of [...quadras, ...quadrasVazias]) for (const pr of q.problemas) problemas.push({ nivel: "aviso", texto: `Quadra ${q.nome}: ${pr}`, alvo: { quadra: q.nome } });

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
  return { plano, gleba, ladosGleba, ruas, quadras, quadrasVazias, lotes, areas, faixasRestricao, publicas, sobras, canteiros, quadro, problemas, ms, desarmonicos };
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
