// O que esgoto e drenagem têm em comum: escoam por gravidade até um ponto de
// lançamento. Aqui ficam a hidráulica do tubo circular parcialmente cheio
// (Manning) e a árvore de escoamento sobre o grafo das ruas.
import type { Pt } from "../geom.ts";
import { dist } from "../geom.ts";
import type { ArestaRede, GrafoRede } from "./grafo.ts";
import { dijkstra, trechoDaLinha } from "./grafo.ts";
import { paraPlano } from "../plano.ts";
import type { Resultado } from "../calculo.ts";

/** Seção molhada do tubo de diâmetro D (m) com lâmina y/D = h. */
export function secao(D: number, h: number): { A: number; P: number; Rh: number; B: number } {
  const t = 2 * Math.acos(1 - 2 * Math.max(1e-6, Math.min(1, h)));
  const A = ((D * D) / 8) * (t - Math.sin(t));
  const P = (D * t) / 2;
  return { A, P, Rh: A / P, B: D * Math.sin(t / 2) };
}

/** Vazão (m³/s) pela fórmula de Manning com a lâmina h. */
export const vazaoManning = (D: number, h: number, I: number, n: number) => {
  const s = secao(D, h);
  return (s.A * s.Rh ** (2 / 3) * Math.sqrt(Math.max(0, I))) / n;
};

/** Lâmina y/D para a vazão Q (m³/s); > 0,94 = o tubo não dá conta. */
export function lamina(Q: number, D: number, I: number, n: number): number {
  if (Q <= 0) return 0;
  if (vazaoManning(D, 0.94, I, n) < Q) return 1;
  let a = 0, b = 0.94;
  for (let k = 0; k < 50; k++) { const m = (a + b) / 2; if (vazaoManning(D, m, I, n) < Q) a = m; else b = m; }
  return (a + b) / 2;
}

/** Trecho de gravidade já orientado de montante para jusante. */
export interface ArestaDirigida {
  aresta: ArestaRede;
  /** nós do grafo: montante e jusante */
  mont: number;
  jus: number;
  /** a aresta faz parte da árvore (o nó de montante escoa por ela) ou é ponta seca */
  arvore: boolean;
  /** polilinha de montante a jusante (a ponta seca começa um pouco depois do nó) */
  linha: Pt[];
  /** posição (a partir de a) onde a linha começa */
  s0: number;
}

/**
 * Árvore de escoamento até o nó de saída: cada nó escoa para o vizinho que leva
 * à saída com menos subida (subir custa caro — é profundidade de vala). A rua
 * que não entra na árvore vira ponta seca: começa num TIL logo depois do nó
 * mais alto e desce até o outro.
 */
export function arvoreDeEscoamento(g: GrafoRede, saida: number, alcancaveis: Set<number>): { dirigidas: ArestaDirigida[]; custo: number[] } {
  const { dist: custo, via } = dijkstra(g, saida, (e, de, para) => {
    // de = mais perto da saída (jusante), para = montante
    if (!alcancaveis.has(para)) return Infinity;
    const subida = Math.max(0, g.nos[de].z - g.nos[para].z + 0.005 * e.L);
    return e.L + 40 * subida;
  });
  const dirigidas: ArestaDirigida[] = [];
  for (const e of g.arestas) {
    if (!alcancaveis.has(e.a) || !alcancaveis.has(e.b)) continue;
    const arvoreA = via[e.a] === e.id, arvoreB = via[e.b] === e.id;
    if (arvoreA || arvoreB) {
      const mont = arvoreA ? e.a : e.b;
      const linha = mont === e.a ? e.linha.slice() : e.linha.slice().reverse();
      dirigidas.push({ aresta: e, mont, jus: arvoreA ? e.b : e.a, arvore: true, linha, s0: 0 });
      continue;
    }
    // ponta seca: desce para o lado mais baixo (no plano, para o mais perto da saída)
    const dz = g.nos[e.a].z - g.nos[e.b].z;
    const paraA = Math.abs(dz) > 0.3 ? dz < 0 : custo[e.a] <= custo[e.b];
    const jus = paraA ? e.a : e.b, mont = paraA ? e.b : e.a;
    const recuo = Math.min(2, e.L / 4);
    const linhaAB = trechoDaLinha(e.linha, recuo, e.L);
    const linha = mont === e.a ? linhaAB : trechoDaLinha(e.linha, 0, e.L - recuo).reverse();
    dirigidas.push({ aresta: e, mont, jus, arvore: false, linha, s0: recuo });
  }
  return { dirigidas, custo };
}

/**
 * Ponto de lançamento: o escolhido pelo operador, ou o mais baixo entre os
 * preferidos (perto do rio, na estrada), ou o nó mais baixo da rede — por
 * gravidade tudo desce até lá; subir de volta é vala funda ou bomba.
 */
export function noDeSaida(res: Resultado, g: GrafoRede, alcancaveis: Set<number>, escolhido?: Pt, preferir?: (n: number) => boolean): number {
  const nos = g.nos.filter((n) => alcancaveis.has(n.id));
  if (escolhido) {
    const p = paraPlano(res.plano, escolhido);
    return nos.reduce((a, b) => (dist(b.p, p) < dist(a.p, p) ? b : a), nos[0]).id;
  }
  const pref = preferir ? nos.filter((n) => preferir(n.id)) : [];
  const cands = pref.length ? pref : nos;
  return cands.reduce((a, b) => (b.z < a.z ? b : a), cands[0]).id;
}

/** O nó mais baixo da rede. */
export const noMaisBaixo = (g: GrafoRede, alcancaveis: Set<number>): number =>
  g.nos.filter((n) => alcancaveis.has(n.id)).reduce((a, b) => (b.z < a.z ? b : a)).id;

/** Nós ligados ao nó dado (a componente dele). */
export function componenteDe(g: GrafoRede, origem: number): Set<number> {
  const vistos = new Set<number>([origem]);
  const pilha = [origem];
  while (pilha.length) {
    const u = pilha.pop()!;
    for (const ei of g.nos[u].arestas) {
      const e = g.arestas[ei];
      const v = e.a === u ? e.b : e.a;
      if (!vistos.has(v)) { vistos.add(v); pilha.push(v); }
    }
  }
  return vistos;
}

/** Componente com mais lotes (a rede principal). */
export function componentePrincipal(g: GrafoRede): Set<number> {
  let melhor = new Set<number>(), lotes = -1;
  const visto = new Set<number>();
  for (const n of g.nos) {
    if (visto.has(n.id)) continue;
    const c = componenteDe(g, n.id);
    c.forEach((x) => visto.add(x));
    const k = g.arestas.filter((e) => c.has(e.a)).reduce((s, e) => s + e.lotes.length, 0);
    if (k > lotes) { lotes = k; melhor = c; }
  }
  return melhor;
}
