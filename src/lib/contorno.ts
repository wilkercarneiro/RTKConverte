// Contorno do imóvel como LIGAÇÕES entre pontos (etapa Glebas, "Ajustar pontos").
//
// A prancheta ligava os vértices na sequência do TXT. Quando o TXT tem mais de
// uma área (1–117 e 200–217 no IBERA) ou pontos de dentro do imóvel, essa
// sequência cruza o mapa (117 → 200, 217 → 1) e a divisão sai de um contorno
// que não existe. Aqui o contorno é um grafo: cada ligação é um lado; o
// operador exclui ponto, liga dois pontos ou tira uma ligação, e as GLEBAS
// são as áreas fechadas por essas ligações (faces do desenho). Uma área só =
// o imóvel inteiro, que a prancheta divide; duas ou mais = as glebas prontas.
//
// Os pontos são identificados pela `ordem` do vértice (única no serviço).
import { ordensDasGlebas, type PontoAnel } from "./glebas.ts";

export type Ligacao = [number, number];
interface VXY { ordem: number; e: number | null; n: number | null }

const chave = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** Sem repetidas, sem laço no mesmo ponto. */
export function normalizar(ls: Ligacao[]): Ligacao[] {
  const vistas = new Set<string>();
  const out: Ligacao[] = [];
  for (const [a, b] of ls) {
    if (a === b) continue;
    const k = chave(a, b);
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push([a, b]);
  }
  return out;
}

export const temLigacao = (ls: Ligacao[], a: number, b: number) => ls.some(([x, y]) => chave(x, y) === chave(a, b));

/**
 * Ligações de partida: os contornos das glebas que o serviço já tem (o que o
 * operador montou ou o TXT trouxe em blocos); sem gleba, a sequência do TXT
 * fechando no primeiro ponto — o que a prancheta sempre fez.
 */
export function ligacoesIniciais(vertices: VXY[], glebas: { anel: PontoAnel[] }[]): Ligacao[] {
  const comXY = vertices.filter((v) => v.e !== null && v.n !== null).sort((a, b) => a.ordem - b.ordem);
  const aneis = ordensDasGlebas(glebas, comXY.map((v) => ({ ...v, e: Number(v.e), n: Number(v.n) })) as never);
  const fonte = aneis.length ? aneis : [comXY.map((v) => v.ordem)];
  const ls: Ligacao[] = [];
  for (const anel of fonte) anel.forEach((o, i) => ls.push([o, anel[(i + 1) % anel.length]]));
  return normalizar(ls);
}

/** Excluir o ponto: some com as ligações dele; `unirVizinhos` liga os dois vizinhos (o contorno continua fechado). */
export function excluirPonto(ls: Ligacao[], o: number, unirVizinhos: boolean): Ligacao[] {
  const viz = ls.filter(([a, b]) => a === o || b === o).map(([a, b]) => (a === o ? b : a));
  const resto = ls.filter(([a, b]) => a !== o && b !== o);
  return unirVizinhos && viz.length === 2 ? normalizar([...resto, [viz[0], viz[1]]]) : resto;
}

export const ligar = (ls: Ligacao[], a: number, b: number): Ligacao[] => normalizar([...ls, [a, b]]);
export const desligar = (ls: Ligacao[], a: number, b: number): Ligacao[] => ls.filter(([x, y]) => chave(x, y) !== chave(a, b));

const cruza = (p: PontoAnel, q: PontoAnel, r: PontoAnel, s: PontoAnel) => {
  const d = (a: PontoAnel, b: PontoAnel, c: PontoAnel) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = d(p, q, r), d2 = d(p, q, s), d3 = d(r, s, p), d4 = d(r, s, q);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

const areaAssinada = (anel: PontoAnel[]) => {
  let s = 0;
  for (let i = 0; i < anel.length; i++) {
    const [ax, ay] = anel[i], [bx, by] = anel[(i + 1) % anel.length];
    s += ax * by - bx * ay;
  }
  return s / 2;
};

export interface Areas {
  /** cada área fechada, como ordens dos vértices na volta (anti-horário), maior primeiro */
  aneis: number[][];
  /** pontos com uma ligação só: o contorno não fecha neles */
  pontas: number[];
  /** ligações que se cruzam (sem ponto em comum) */
  cruzadas: [Ligacao, Ligacao][];
  /** pontos sem ligação nenhuma: saem do serviço ao salvar */
  soltos: number[];
}

/**
 * As áreas fechadas pelas ligações. Percorre as faces do desenho plano: em
 * cada ponto, a próxima ligação é a primeira no sentido horário a partir da
 * que chegou; as faces de área positiva são as áreas, a negativa de cada
 * componente é o lado de fora. Pontas soltas são podadas antes (uma linha que
 * entra e não fecha nada não é divisa), e a resposta diz quais eram.
 */
export function areasFechadas(vertices: VXY[], ls0: Ligacao[]): Areas {
  const xy = new Map<number, PontoAnel>();
  for (const v of vertices) if (v.e !== null && v.n !== null) xy.set(v.ordem, [Number(v.e), Number(v.n)]);
  let ls = normalizar(ls0).filter(([a, b]) => xy.has(a) && xy.has(b));
  const soltos = [...xy.keys()].filter((o) => !ls.some(([a, b]) => a === o || b === o));

  const cruzadas: [Ligacao, Ligacao][] = [];
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    const [a, b] = ls[i], [c, d] = ls[j];
    if (a === c || a === d || b === c || b === d) continue;
    if (cruza(xy.get(a)!, xy.get(b)!, xy.get(c)!, xy.get(d)!)) cruzadas.push([ls[i], ls[j]]);
  }

  // poda as pontas (grau 1) até não sobrar nenhuma
  const pontas: number[] = [];
  for (;;) {
    const grau = new Map<number, number>();
    for (const [a, b] of ls) { grau.set(a, (grau.get(a) ?? 0) + 1); grau.set(b, (grau.get(b) ?? 0) + 1); }
    const p = [...grau].filter(([, g]) => g === 1).map(([o]) => o);
    if (!p.length) break;
    pontas.push(...p);
    ls = ls.filter(([a, b]) => !p.includes(a) && !p.includes(b));
  }

  // vizinhos de cada ponto em ordem de ângulo (anti-horário)
  const viz = new Map<number, number[]>();
  for (const [a, b] of ls) { viz.set(a, [...(viz.get(a) ?? []), b]); viz.set(b, [...(viz.get(b) ?? []), a]); }
  const ang = (o: number, w: number) => { const p = xy.get(o)!, q = xy.get(w)!; return Math.atan2(q[1] - p[1], q[0] - p[0]); };
  for (const [o, ws] of viz) ws.sort((x, y) => ang(o, x) - ang(o, y));

  const usadas = new Set<string>();
  const aneis: number[][] = [];
  for (const [a, b] of ls) for (const [u0, v0] of [[a, b], [b, a]] as const) {
    if (usadas.has(`${u0}>${v0}`)) continue;
    const face: number[] = [];
    let u = u0, v = v0;
    for (let guarda = 0; guarda < ls.length * 2 + 2; guarda++) {
      usadas.add(`${u}>${v}`);
      face.push(u);
      // chegando em v vindo de u: a próxima é a vizinha logo antes de u no sentido anti-horário
      const ws = viz.get(v)!;
      const k = ws.indexOf(u);
      const w = ws[(k - 1 + ws.length) % ws.length];
      u = v; v = w;
      if (u === u0 && v === v0) break;
    }
    const anel = face.map((o) => xy.get(o)!);
    if (face.length >= 3 && areaAssinada(anel) > 0.5) aneis.push(face);
  }
  aneis.sort((x, y) => areaAssinada(y.map((o) => xy.get(o)!)) - areaAssinada(x.map((o) => xy.get(o)!)));
  return { aneis, pontas: [...new Set(pontas)], cruzadas, soltos };
}
