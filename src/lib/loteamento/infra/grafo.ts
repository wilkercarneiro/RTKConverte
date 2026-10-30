// Grafo das ruas: a base comum das redes de água, esgoto, drenagem e energia.
//
// Toda rede de loteamento corre pelas vias. Os eixos das ruas (recortados na
// gleba) e a frente da estrada de acesso onde há lote viram arestas; os nós são
// as pontas e os cruzamentos (em X e em T). Cada lote é ligado à aresta da rua
// para onde ele dá frente — é por ali que entram o ramal de água, o de esgoto e
// o de energia.
import { comprimento, dist, distSegmento, dot, offsetPols, pontoNaPolilinha, recortarLinha, sub, unit } from "../geom.ts";
import type { Pt } from "../geom.ts";
import type { Resultado } from "../calculo.ts";
import { ehAcesso } from "../modelo.ts";
import type { GradeTerreno } from "../terreno.ts";
import { cotaEm } from "../terreno.ts";
import { paraUtm } from "../plano.ts";

export interface NoRede {
  id: number;
  p: Pt;
  /** cota do terreno (m) */
  z: number;
  arestas: number[];
  /** está na divisa da gleba (ponta de rua que sai para a estrada) */
  naDivisa: boolean;
}

export interface ArestaRede {
  id: number;
  a: number;
  b: number;
  /** polilinha de a até b (plano) */
  linha: Pt[];
  L: number;
  tipo: "rua" | "acesso";
  /** id da rua (RuaCalc) — ou "acesso-i" para o lado i da gleba */
  rua: string;
  nome: string;
  /** largura entre alinhamentos (0 na estrada de acesso) */
  largura: number;
  /** lotes (índice em res.lotes) que dão frente para esta aresta */
  lotes: number[];
  /** posição de cada lote ao longo da aresta (m, a partir de a) */
  sLotes: number[];
  /** lado de cada lote: +1 à esquerda do sentido a→b, −1 à direita */
  ladoLotes: number[];
  /** ponto da frente de cada lote (meio do lado da frente) */
  frentes: Pt[];
}

export interface GrafoRede {
  nos: NoRede[];
  arestas: ArestaRede[];
  /** cota do terreno num ponto do plano */
  cota: (p: Pt) => number;
  /** lotes sem rua da rede (frente para lugar nenhum que a rede alcance) */
  semRede: number[];
  /** o relevo é do modelo de elevação (senão a rede é calculada no plano, com aviso) */
  temRelevo: boolean;
}

/** Cota pelo relevo do projeto; sem relevo, tudo plano (cota 0). */
export function cotaDoPlano(res: Resultado, terreno: GradeTerreno | null | undefined): (p: Pt) => number {
  if (!terreno) return () => 0;
  return (p) => cotaEm(terreno, paraUtm(res.plano, p));
}

/** Projeção de p numa polilinha: posição ao longo (s), distância e lado (+1 esquerda). */
export function projetar(linha: Pt[], p: Pt): { s: number; d: number; lado: number; pt: Pt } {
  let melhor = { s: 0, d: Infinity, lado: 1, pt: linha[0] }, acc = 0;
  for (let i = 0; i + 1 < linha.length; i++) {
    const a = linha[i], b = linha[i + 1], L = dist(a, b);
    const { d, t } = distSegmento(p, a, b);
    if (d < melhor.d) {
      const pt: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      melhor = { s: acc + t * L, d, lado: cr >= 0 ? 1 : -1, pt };
    }
    acc += L;
  }
  return melhor;
}

/** Trecho da polilinha entre s0 e s1 (s0 < s1). */
export function trechoDaLinha(linha: Pt[], s0: number, s1: number): Pt[] {
  const out: Pt[] = [pontoNaPolilinha(linha, s0).pt];
  let acc = 0;
  for (let i = 0; i + 1 < linha.length; i++) {
    acc += dist(linha[i], linha[i + 1]);
    if (acc > s0 + 1e-6 && acc < s1 - 1e-6) out.push(linha[i + 1]);
  }
  out.push(pontoNaPolilinha(linha, s1).pt);
  return out;
}

/** Polilinha deslocada `d` metros para a esquerda (d < 0: direita), com quina em esquadro. */
export function deslocar(linha: Pt[], d: number): Pt[] {
  if (linha.length < 2 || Math.abs(d) < 1e-9) return linha.slice();
  const n = (a: Pt, b: Pt): Pt => { const u = unit(sub(b, a)); return [-u[1], u[0]]; };
  const out: Pt[] = [];
  for (let i = 0; i < linha.length; i++) {
    if (i === 0 || i === linha.length - 1) {
      const k = i === 0 ? n(linha[0], linha[1]) : n(linha[i - 1], linha[i]);
      out.push([linha[i][0] + k[0] * d, linha[i][1] + k[1] * d]);
      continue;
    }
    const n1 = n(linha[i - 1], linha[i]), n2 = n(linha[i], linha[i + 1]);
    const m = unit([n1[0] + n2[0], n1[1] + n2[1]]);
    const c = Math.max(0.3, dot(m, n1));
    out.push([linha[i][0] + (m[0] * d) / c, linha[i][1] + (m[1] * d) / c]);
  }
  return out;
}

interface Peca { linha: Pt[]; tipo: "rua" | "acesso"; rua: string; nome: string; largura: number; cortes: number[] }

export function montarGrafo(res: Resultado, terreno: GradeTerreno | null | undefined): GrafoRede {
  const cota = cotaDoPlano(res, terreno);
  // a gleba um pouco maior: a ponta da rua que encosta na estrada fica dentro
  const gleba = offsetPols([res.gleba], 0.6)[0] ?? res.gleba;
  const pecas: Peca[] = [];
  for (const r of res.ruas) {
    for (const l of recortarLinha(r.eixo, gleba)) {
      if (comprimento(l) > 1) pecas.push({ linha: l, tipo: "rua", rua: r.id, nome: r.nome, largura: r.largura, cortes: [] });
    }
  }
  // frente da estrada de acesso: só onde algum lote dá frente para ela
  const lotesNaVia = res.lotes.some((l) => l.lados.some((x) => x.tipo === "via"));
  if (lotesNaVia) {
    res.ladosGleba.forEach((lg, i) => {
      if (!ehAcesso(lg.tipo) || dist(lg.a, lg.b) < 1) return;
      const tem = res.lotes.some((l) => l.lados.some((x) => x.tipo === "via" && distSegmento(x.a, lg.a, lg.b).d < 0.5 && distSegmento(x.b, lg.a, lg.b).d < 0.5));
      if (tem) pecas.push({ linha: [lg.a, lg.b], tipo: "acesso", rua: `acesso-${i}`, nome: lg.nome || "Estrada existente", largura: 0, cortes: [] });
    });
  }

  // cruzamentos em X (segmento × segmento) e em T (ponta de uma peça no corpo da outra)
  const pontas: { peca: number; ponta: 0 | 1; p: Pt }[] = [];
  for (let i = 0; i < pecas.length; i++) {
    const A = pecas[i].linha;
    for (let j = i + 1; j < pecas.length; j++) {
      const B = pecas[j].linha;
      let accA = 0;
      for (let a = 0; a + 1 < A.length; a++) {
        const r: Pt = sub(A[a + 1], A[a]), LA = Math.hypot(r[0], r[1]);
        let accB = 0;
        for (let b = 0; b + 1 < B.length; b++) {
          const s: Pt = sub(B[b + 1], B[b]), LB = Math.hypot(s[0], s[1]);
          const den = r[0] * s[1] - r[1] * s[0];
          if (Math.abs(den) > 1e-9) {
            const q = sub(B[b], A[a]);
            const tA = (q[0] * s[1] - q[1] * s[0]) / den, tB = (q[0] * r[1] - q[1] * r[0]) / den;
            if (tA > -1e-6 && tA < 1 + 1e-6 && tB > -1e-6 && tB < 1 + 1e-6) {
              pecas[i].cortes.push(accA + tA * LA);
              pecas[j].cortes.push(accB + tB * LB);
            }
          }
          accB += LB;
        }
        accA += LA;
      }
    }
  }
  pecas.forEach((pc, i) => {
    pontas.push({ peca: i, ponta: 0, p: pc.linha[0] }, { peca: i, ponta: 1, p: pc.linha[pc.linha.length - 1] });
  });
  for (const pt of pontas) {
    const pc = pecas[pt.peca];
    let melhor: { j: number; s: number; d: number; ptP: Pt } | null = null;
    pecas.forEach((outra, j) => {
      if (j === pt.peca) return;
      const pr = projetar(outra.linha, pt.p);
      const tol = pc.tipo === "acesso" || outra.tipo === "acesso" ? Math.max(1.5, pc.largura / 2 + 1.5) : outra.largura / 2 + 3;
      if (pr.d <= tol && (!melhor || pr.d < melhor.d)) melhor = { j, s: pr.s, d: pr.d, ptP: pr.pt };
    });
    if (!melhor) continue;
    const m = melhor as { j: number; s: number; d: number; ptP: Pt };
    pecas[m.j].cortes.push(m.s);
    // a ponta vai para o eixo da outra (o nó é um ponto só)
    if (pt.ponta === 0) pc.linha[0] = m.ptP; else pc.linha[pc.linha.length - 1] = m.ptP;
  }

  // nós: pontas e cortes, fundidos a menos de 1,5 m
  const nos: NoRede[] = [];
  const noEm = (p: Pt): number => {
    for (const n of nos) if (dist(n.p, p) < 1.5) return n.id;
    nos.push({ id: nos.length, p, z: cota(p), arestas: [], naDivisa: false });
    return nos.length - 1;
  };
  const arestas: ArestaRede[] = [];
  for (const pc of pecas) {
    const L = comprimento(pc.linha);
    const cortes = [0, ...pc.cortes.filter((s) => s > 0.5 && s < L - 0.5).sort((x, y) => x - y), L]
      .filter((s, k, v) => k === 0 || s - v[k - 1] > 1);
    if (cortes[cortes.length - 1] < L) cortes[cortes.length - 1] = L;
    for (let k = 0; k + 1 < cortes.length; k++) {
      const linha = trechoDaLinha(pc.linha, cortes[k], cortes[k + 1]);
      const a = noEm(linha[0]), b = noEm(linha[linha.length - 1]);
      if (a === b) continue;
      linha[0] = nos[a].p;
      linha[linha.length - 1] = nos[b].p;
      const id = arestas.length;
      arestas.push({ id, a, b, linha, L: comprimento(linha), tipo: pc.tipo, rua: pc.rua, nome: pc.nome, largura: pc.largura, lotes: [], sLotes: [], ladoLotes: [], frentes: [] });
      nos[a].arestas.push(id);
      nos[b].arestas.push(id);
    }
  }
  for (const n of nos) {
    let d = Infinity;
    for (const l of res.ladosGleba) d = Math.min(d, distSegmento(n.p, l.a, l.b).d);
    n.naDivisa = d < 2;
  }

  // cada lote na aresta da sua frente
  const semRede: number[] = [];
  res.lotes.forEach((l, i) => {
    const principais = l.lados.filter((x) => x.principal);
    const frentes = (principais.length ? principais : l.lados.filter((x) => x.tipo === "rua" || x.tipo === "via"));
    const fr = frentes.sort((x, y) => y.comp - x.comp)[0];
    const alvo = fr ? [(fr.a[0] + fr.b[0]) / 2, (fr.a[1] + fr.b[1]) / 2] as Pt : null;
    let melhor: { e: number; s: number; d: number; lado: number } | null = null;
    const testar = (e: ArestaRede, alcance: number) => {
      const pr = projetar(e.linha, alvo!);
      if (pr.d <= alcance && (!melhor || pr.d < melhor.d)) melhor = { e: e.id, s: pr.s, d: pr.d, lado: pr.lado };
    };
    if (alvo) {
      // primeiro a rua da própria frente; depois qualquer rua por perto
      for (const e of arestas) if ((fr.tipo === "via" && e.tipo === "acesso") || (fr.ref && e.rua === fr.ref)) testar(e, Math.max(30, e.largura));
      if (!melhor) for (const e of arestas) testar(e, 40);
    }
    if (!melhor || !alvo) { semRede.push(i); return; }
    const m = melhor as { e: number; s: number; d: number; lado: number };
    const e = arestas[m.e];
    e.lotes.push(i); e.sLotes.push(m.s); e.ladoLotes.push(m.lado); e.frentes.push(alvo);
  });
  return { nos, arestas, cota, semRede, temRelevo: !!terreno };
}

/** Distância (pelo grafo) de um nó a todos — Dijkstra com o peso dado. */
export function dijkstra(g: GrafoRede, origem: number, peso: (e: ArestaRede, de: number, para: number) => number = (e) => e.L): { dist: number[]; pai: number[]; via: number[] } {
  const n = g.nos.length;
  const distancia = new Array<number>(n).fill(Infinity), pai = new Array<number>(n).fill(-1), via = new Array<number>(n).fill(-1);
  const feito = new Uint8Array(n);
  distancia[origem] = 0;
  for (;;) {
    let u = -1, du = Infinity;
    for (let i = 0; i < n; i++) if (!feito[i] && distancia[i] < du) { du = distancia[i]; u = i; }
    if (u < 0) break;
    feito[u] = 1;
    for (const ei of g.nos[u].arestas) {
      const e = g.arestas[ei];
      const v = e.a === u ? e.b : e.a;
      const w = du + peso(e, u, v);
      if (w < distancia[v]) { distancia[v] = w; pai[v] = u; via[v] = ei; }
    }
  }
  return { dist: distancia, pai, via };
}

/** O outro nó da aresta. */
export const outro = (e: ArestaRede, n: number): number => (e.a === n ? e.b : e.a);
