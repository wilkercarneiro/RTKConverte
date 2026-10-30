// Rede de distribuição de energia e iluminação pública (Neoenergia Coelba,
// DIS-NOR-012 rev. 08; REN ANEEL 1.000/2021; NBR 5101).
//
//   postes: no passeio, na divisa de lotes, vão básico de 35 m (30 a 40), em
//           um lado só nas ruas de até 20 m (o lado com mais lotes; empate: as
//           faces norte e oeste), evitando a esquina (6.5.18, 6.6.31);
//   demanda: Tab. 17 (demanda diversificada por unidade, cai com o número de
//           unidades: tipo A 1,23→0,50 kVA, B 3,08→1,25, C 7,60→3,13; entre 5 e 40
//           unidades interpolada) × 1,28 de projeção (Tab. 18);
//   transformadores: 45, 75 e 112,5 kVA (limites 48, 79 e 118 kVA, Tab. 19), no
//           centro de carga, nunca em poste de derivação; circuito de baixa
//           tensão de no máximo 200 m (220/127 V) ou 500 m (380/220 V) e queda
//           ≤ 3,5% (6.8.5.5 e 6.8.5.11);
//   média tensão: rede compacta (obrigatória em loteamento, 6.5.1 b) da entrada
//           na estrada até cada transformador; baixa tensão multiplexada;
//   iluminação: uma luminária LED por poste, no braço; a potência sai do método
//           dos lúmens para a classe da via (V5: 5 lux médios; V4: 10 lux).
import type { Pt } from "../geom.ts";
import { dist, esquerda, pontoNaPolilinha } from "../geom.ts";
import type { Resultado } from "../calculo.ts";
import { ehAcesso } from "../modelo.ts";
import type { GrafoRede } from "./grafo.ts";
import { projetar } from "./grafo.ts";
import type { ParametrosInfra, PadraoLote } from "./parametros.ts";
import { paraPlano } from "../plano.ts";

export const TRAFOS = [{ kva: 45, limite: 48 }, { kva: 75, limite: 79 }, { kva: 112.5, limite: 118 }];
/** demanda diversificada por unidade (kVA): com até 5 unidades e com mais de 40 (Tab. 17) */
const TAB17: Record<PadraoLote, [number, number]> = { A: [1.23, 0.5], B: [3.08, 1.25], C: [7.6, 3.13] };
export const PROJECAO = 1.28;
/** cabos multiplexados de alumínio (R a 90 °C e X, Ω/km) */
const CABOS = { "3x1x70+70": { r: 0.568, x: 0.1 }, "3x1x120+70": { r: 0.325, x: 0.095 } } as const;
type Cabo = keyof typeof CABOS;
/** LED de iluminação pública: eficiência (lm/W), coeficiente de utilização e fator de manutenção */
const LM_W = 130, CU = 0.4, FM = 0.8;
const LUMINARIAS = [40, 50, 60, 80, 100, 120];

/** Demanda diversificada por unidade (kVA) para n unidades no mesmo transformador. */
export function demandaPorUnidade(padrao: PadraoLote, n: number): number {
  const [d5, d40] = TAB17[padrao];
  if (n <= 5) return d5;
  if (n >= 40) return d40;
  const t = Math.log(n / 5) / Math.log(40 / 5);
  return d5 + (d40 - d5) * t;
}

/** Queda de tensão unitária do cabo trifásico (% por kVA·km). */
export function coefQueda(cabo: Cabo, tensao: ParametrosInfra["tensaoBT"]): number {
  const v = tensao === "380/220" ? 380 : 220;
  const { r, x } = CABOS[cabo];
  return (100 * 1000 * (r * 0.92 + x * Math.sin(Math.acos(0.92)))) / (v * v);
}

export interface Poste {
  id: string;
  p: Pt;
  z: number;
  /** direção do poste para a rua (o braço da luminária) */
  dir: Pt;
  altura: number;
  /** esforço nominal (daN) */
  esforco: number;
  mt: boolean;
  /** índice do transformador deste poste */
  trafo: number | null;
  /** potência da luminária (W) */
  luminaria: number;
  /** a que transformador o poste pertence (circuito de baixa tensão) */
  grupo: number;
  aresta: number;
  equipamentos: string[];
}

export interface Vao { a: number; b: number; L: number; mt: boolean; bt: boolean; cabo: Cabo | null; grupo: number }

export interface Transformador {
  id: string;
  poste: number;
  kva: number;
  /** demanda de projeto (kVA, já com a projeção e a iluminação) */
  demanda: number;
  lotes: number;
  /** maior distância de circuito (m) e maior queda (%) */
  alcance: number;
  queda: number;
  circuitos: number;
}

export interface RedeEletrica {
  postes: Poste[];
  vaos: Vao[];
  trafos: Transformador[];
  entrada: { p: Pt; poste: number } | null;
  ramais: { lote: number; poste: number; de: Pt; ate: Pt; L: number }[];
  ip: { potencia: number; fluxo: number; eMedia: number; alvo: number; classe: string; quantidade: number; kva: number };
  resumo: { extensaoMT: number; extensaoBT: number; nPostes: number; kvaInstalado: number; demanda: number; porLote: number; quedaMax: number };
  avisos: string[];
}

/** Fila de prioridade mínima (Dijkstra no grafo dos postes). */
class Heap {
  private a: [number, number][] = [];
  get tamanho() { return this.a.length; }
  push(v: number, k: number) {
    const a = this.a; a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop(): [number, number] {
    const a = this.a, top = a[0], fim = a.pop()!;
    if (a.length) {
      a[0] = fim;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function caminhos(n: number, adj: { j: number; L: number }[][], origem: number): { d: Float64Array; pai: Int32Array } {
  const d = new Float64Array(n).fill(Infinity), pai = new Int32Array(n).fill(-1);
  const h = new Heap();
  d[origem] = 0;
  h.push(origem, 0);
  while (h.tamanho) {
    const [k, u] = h.pop();
    if (k > d[u]) continue;
    for (const { j, L } of adj[u]) if (k + L < d[j]) { d[j] = k + L; pai[j] = u; h.push(j, d[j]); }
  }
  return { d, pai };
}

export function projetarEletrica(res: Resultado, g: GrafoRede, prm: ParametrosInfra): RedeEletrica {
  const avisos: string[] = [];
  const postes: Poste[] = [];
  const vazia: RedeEletrica = {
    postes, vaos: [], trafos: [], entrada: null, ramais: [],
    ip: { potencia: 0, fluxo: 0, eMedia: 0, alvo: 0, classe: prm.classeIP, quantidade: 0, kva: 0 },
    resumo: { extensaoMT: 0, extensaoBT: 0, nPostes: 0, kvaInstalado: 0, demanda: 0, porLote: 0, quedaMax: 0 }, avisos,
  };
  if (!g.arestas.length) return vazia;

  // ---------------- postes ----------------
  const novoOuPerto = (p: Pt, dir: Pt, aresta: number): number => {
    const k = postes.findIndex((x) => dist(x.p, p) < 7);
    if (k >= 0) return k;
    postes.push({ id: "", p, z: g.cota(p), dir, altura: 12, esforco: 300, mt: false, trafo: null, luminaria: 0, grupo: -1, aresta, equipamentos: [] });
    return postes.length - 1;
  };
  const cadeia = new Map<number, number[]>(); // postes de cada aresta, em ordem
  for (const e of g.arestas) {
    // lado: o com mais lotes; empate, a face norte/oeste
    const esq = e.ladoLotes.filter((x) => x > 0).length, dir = e.ladoLotes.length - esq;
    const meio = pontoNaPolilinha(e.linha, e.L / 2);
    const nEsq = esquerda(meio.dir);
    let lado = esq > dir ? 1 : dir > esq ? -1 : (nEsq[1] - nEsq[0] >= 0 ? 1 : -1);
    let off = Math.max(1, e.largura / 2 - 0.35);
    if (e.tipo === "acesso") { lado = esq >= dir ? -1 : 1; off = 1.5; } // na beira da estrada, do outro lado dos lotes
    const grauA = g.nos[e.a].arestas.length, grauB = g.nos[e.b].arestas.length;
    const recuo = (grau: number) => (grau >= 3 ? 7 : grau === 2 ? 2 : 2.5);
    const s0 = Math.min(e.L / 2, recuo(grauA)), s1 = Math.max(e.L / 2, e.L - recuo(grauB));
    const vao = s1 - s0;
    const n = vao < 10 ? 0 : Math.max(1, Math.ceil(vao / prm.vao - 1e-6));
    // divisas de lote do lado dos postes (para o poste cair nelas)
    const divisas: number[] = [];
    e.lotes.forEach((li, k) => {
      if (e.ladoLotes[k] !== lado && e.tipo === "rua") return;
      for (const ld of res.lotes[li].lados) if (ld.tipo === "rua" || ld.tipo === "via") for (const q of [ld.a, ld.b]) divisas.push(projetar(e.linha, q).s);
    });
    const ss: number[] = [];
    for (let k = 0; k <= n; k++) {
      let s = n ? s0 + (vao * k) / n : (s0 + s1) / 2;
      if (k > 0 && k < n) {
        const perto = divisas.reduce((m, x) => (Math.abs(x - s) < Math.abs(m - s) ? x : m), Infinity);
        if (Math.abs(perto - s) <= 5) s = perto;
      }
      ss.push(s);
    }
    const ids: number[] = [];
    for (const s of ss) {
      const { pt, dir: d } = pontoNaPolilinha(e.linha, Math.max(0, Math.min(e.L, s)));
      const nrm = esquerda(d);
      const p: Pt = [pt[0] + nrm[0] * off * lado, pt[1] + nrm[1] * off * lado];
      const k = novoOuPerto(p, [-nrm[0] * lado, -nrm[1] * lado], e.id);
      if (!ids.includes(k)) ids.push(k);
    }
    cadeia.set(e.id, ids);
  }
  if (!postes.length) return vazia;

  // ---------------- vãos ----------------
  const chave = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const vaosSet = new Map<string, Vao>();
  const ligar = (a: number, b: number) => { if (a !== b && !vaosSet.has(chave(a, b))) vaosSet.set(chave(a, b), { a: Math.min(a, b), b: Math.max(a, b), L: dist(postes[a].p, postes[b].p), mt: false, bt: false, cabo: null, grupo: -1 }); };
  for (const ids of cadeia.values()) for (let k = 0; k + 1 < ids.length; k++) ligar(ids[k], ids[k + 1]);
  // nos cruzamentos: as pontas das ruas que chegam, pela árvore mínima
  for (const n of g.nos) {
    const pontas: number[] = [];
    for (const ei of n.arestas) {
      const ids = cadeia.get(ei) ?? [];
      if (!ids.length) continue;
      const e = g.arestas[ei];
      pontas.push(e.a === n.id ? ids[0] : ids[ids.length - 1]);
    }
    const unicos = [...new Set(pontas)];
    const dentro = new Set([unicos[0]]);
    while (unicos.length && dentro.size < unicos.length) {
      let melhor: [number, number] | null = null, dm = Infinity;
      for (const a of dentro) for (const b of unicos) if (!dentro.has(b) && dist(postes[a].p, postes[b].p) < dm) { dm = dist(postes[a].p, postes[b].p); melhor = [a, b]; }
      if (!melhor) break;
      ligar(melhor[0], melhor[1]);
      dentro.add(melhor[1]);
    }
  }
  // componentes soltas: liga pelo par mais perto
  const adjDe = () => {
    const adj: { j: number; L: number }[][] = postes.map(() => []);
    for (const v of vaosSet.values()) { adj[v.a].push({ j: v.b, L: v.L }); adj[v.b].push({ j: v.a, L: v.L }); }
    return adj;
  };
  for (let guarda = 0; guarda < 50; guarda++) {
    const { d } = caminhos(postes.length, adjDe(), 0);
    const fora = postes.map((_, i) => i).filter((i) => !Number.isFinite(d[i]));
    if (!fora.length) break;
    let melhor: [number, number] = [0, fora[0]], dm = Infinity;
    for (const a of postes.keys()) if (Number.isFinite(d[a])) for (const b of fora) { const x = dist(postes[a].p, postes[b].p); if (x < dm) { dm = x; melhor = [a, b]; } }
    ligar(melhor[0], melhor[1]);
  }
  const vaos = [...vaosSet.values()];
  const adj = adjDe();
  const longos = vaos.filter((v) => v.L > 45).length;
  if (longos) avisos.push(`${longos} vão(s) com mais de 45 m (travessia de cruzamento largo): confira a flecha e o poste.`);

  // ---------------- cargas ----------------
  const ramais: RedeEletrica["ramais"] = [];
  const lotesNoPoste = new Array<number>(postes.length).fill(0);
  for (const e of g.arestas) {
    const ids = cadeia.get(e.id) ?? [];
    e.lotes.forEach((li, k) => {
      const fr = e.frentes[k];
      const cand = ids.length ? ids : postes.map((_, i) => i);
      const pk = cand.reduce((m, i) => (dist(postes[i].p, fr) < dist(postes[m].p, fr) ? i : m), cand[0]);
      lotesNoPoste[pk]++;
      ramais.push({ lote: li, poste: pk, de: postes[pk].p, ate: fr, L: dist(postes[pk].p, fr) });
    });
  }
  const ramaisLongos = ramais.filter((r) => r.L > 40).length;
  if (ramaisLongos) avisos.push(`${ramaisLongos} lote(s) com ramal de ligação acima de 40 m (DIS-NOR-030, Tab. 24): falta poste perto deles.`);

  // iluminação: potência pelo método dos lúmens
  const larguras = g.arestas.filter((e) => e.tipo === "rua").map((e) => e.largura);
  const largura = larguras.length ? larguras.reduce((s, x) => s + x, 0) / larguras.length : 12;
  const vaoMedio = vaos.length ? vaos.reduce((s, v) => s + Math.min(v.L, 45), 0) / vaos.length : prm.vao;
  const alvo = prm.classeIP === "V4" ? 10 : 5;
  const eDe = (w: number) => (w * LM_W * CU * FM) / (vaoMedio * largura);
  const potencia = LUMINARIAS.find((w) => eDe(w) >= alvo) ?? LUMINARIAS[LUMINARIAS.length - 1];
  for (const p of postes) p.luminaria = potencia;
  const kvaIp = potencia / 1000 / 0.92;

  // ---------------- transformadores (k-medoides no grafo dos postes) ----------------
  const N = postes.length;
  const dists = postes.map((_, i) => caminhos(N, adj, i));
  const rMax = prm.tensaoBT === "380/220" ? 500 : 200;
  const grau = adj.map((x) => x.length);
  const elegivel = (i: number) => grau[i] <= 2 && postes[i].aresta >= 0;
  const totalLotes = lotesNoPoste.reduce((s, x) => s + x, 0);
  const demandaGrupo = (n: number, nPostes: number) => n * demandaPorUnidade(prm.padraoLote, n) * PROJECAO + nPostes * kvaIp;
  const totalKva = demandaGrupo(totalLotes, N);
  let melhor: { med: number[]; grupo: Int32Array; ok: boolean; quedas: number[]; cabos: Map<string, Cabo>; alcances: number[] } | null = null;
  const kIni = Math.max(1, Math.ceil(totalKva / (0.9 * TRAFOS[TRAFOS.length - 1].limite)));
  for (let k = kIni; k <= Math.min(N, kIni + 40); k++) {
    // sementes: o centro de carga e, depois, o poste mais longe dos já escolhidos
    const med: number[] = [];
    const cx = postes.reduce((s, p, i) => s + p.p[0] * (lotesNoPoste[i] + 0.2), 0) / postes.reduce((s, _, i) => s + lotesNoPoste[i] + 0.2, 0);
    const cy = postes.reduce((s, p, i) => s + p.p[1] * (lotesNoPoste[i] + 0.2), 0) / postes.reduce((s, _, i) => s + lotesNoPoste[i] + 0.2, 0);
    med.push(postes.reduce((m, p, i) => (dist(p.p, [cx, cy]) < dist(postes[m].p, [cx, cy]) ? i : m), 0));
    while (med.length < k) {
      let far = -1, df = -1;
      for (let i = 0; i < N; i++) { const d = Math.min(...med.map((m) => dists[m].d[i])); if (d > df) { df = d; far = i; } }
      med.push(far);
    }
    const grupo = new Int32Array(N);
    for (let it = 0; it < 15; it++) {
      for (let i = 0; i < N; i++) { let b = 0; for (let m = 1; m < med.length; m++) if (dists[med[m]].d[i] < dists[med[b]].d[i]) b = m; grupo[i] = b; }
      let mudou = false;
      for (let m = 0; m < med.length; m++) {
        const membros = postes.map((_, i) => i).filter((i) => grupo[i] === m);
        let best = med[m], custo = Infinity;
        for (const c of membros) {
          if (!elegivel(c) && membros.some(elegivel)) continue;
          const s = membros.reduce((acc, i) => acc + (lotesNoPoste[i] + 0.2) * dists[c].d[i], 0);
          if (s < custo) { custo = s; best = c; }
        }
        if (best !== med[m]) { med[m] = best; mudou = true; }
      }
      if (!mudou) break;
    }
    // verificação: carga, alcance e queda de cada grupo
    let ok = true;
    const quedas: number[] = [], alcances: number[] = [];
    const cabos = new Map<string, Cabo>();
    for (let m = 0; m < med.length; m++) {
      const membros = postes.map((_, i) => i).filter((i) => grupo[i] === m);
      const nl = membros.reduce((s, i) => s + lotesNoPoste[i], 0);
      const dem = demandaGrupo(nl, membros.length);
      const porPoste = (i: number) => (nl ? (lotesNoPoste[i] / nl) * (dem - membros.length * kvaIp) : 0) + kvaIp;
      const { d, pai } = dists[med[m]];
      const alcance = Math.max(0, ...membros.map((i) => d[i]));
      // carga a jusante de cada poste na árvore do transformador
      const jus = new Float64Array(N);
      const ordemM = [...membros].sort((a, b) => d[b] - d[a]);
      for (const i of ordemM) { jus[i] += porPoste(i); if (pai[i] >= 0 && i !== med[m]) jus[pai[i]] += jus[i]; }
      const queda = (cabo: (a: number, b: number) => Cabo) => {
        const q = new Float64Array(N);
        let max = 0;
        for (const i of [...membros].sort((a, b) => d[a] - d[b])) {
          if (i === med[m] || pai[i] < 0) continue;
          q[i] = q[pai[i]] + coefQueda(cabo(i, pai[i]), prm.tensaoBT) * jus[i] * (dist(postes[i].p, postes[pai[i]].p) / 1000);
          max = Math.max(max, q[i]);
        }
        return max;
      };
      let qMax = queda(() => "3x1x70+70");
      let tronco = false;
      if (qMax > prm.quedaMax) {
        tronco = true;
        qMax = queda((a) => (jus[a] > 0.3 * dem ? "3x1x120+70" : "3x1x70+70"));
      }
      for (const i of membros) if (pai[i] >= 0 && i !== med[m]) cabos.set(chave(i, pai[i]), tronco && jus[i] > 0.3 * dem ? "3x1x120+70" : "3x1x70+70");
      quedas.push(qMax);
      alcances.push(alcance);
      if (dem > TRAFOS[TRAFOS.length - 1].limite || alcance > rMax || qMax > prm.quedaMax) ok = false;
    }
    melhor = { med, grupo, ok, quedas, cabos, alcances };
    if (ok) break;
  }
  const sol = melhor!;
  if (!sol.ok) avisos.push("Nem com mais transformadores todos os circuitos ficaram dentro do raio e da queda de tensão: confira os grupos marcados.");

  const trafos: Transformador[] = sol.med.map((pi, m) => {
    const membros = postes.map((_, i) => i).filter((i) => sol.grupo[i] === m);
    const nl = membros.reduce((s, i) => s + lotesNoPoste[i], 0);
    const dem = demandaGrupo(nl, membros.length);
    const t = TRAFOS.find((x) => x.limite >= dem) ?? TRAFOS[TRAFOS.length - 1];
    const circuitos = adj[pi].filter((x) => sol.grupo[x.j] === m && dists[pi].pai[x.j] === pi).length;
    return { id: `T${m + 1}`, poste: pi, kva: t.kva, demanda: dem, lotes: nl, alcance: sol.alcances[m], queda: sol.quedas[m], circuitos: Math.max(1, circuitos) };
  });
  trafos.forEach((t, m) => { postes[t.poste].trafo = m; });
  postes.forEach((p, i) => { p.grupo = sol.grupo[i]; });

  // vãos de baixa tensão: a árvore de cada transformador
  for (const v of vaos) {
    const m = sol.grupo[v.a];
    if (sol.grupo[v.b] !== m) continue;
    const { pai } = dists[sol.med[m]];
    if (pai[v.a] === v.b || pai[v.b] === v.a) { v.bt = true; v.grupo = m; v.cabo = sol.cabos.get(chave(v.a, v.b)) ?? "3x1x70+70"; }
  }

  // ---------------- média tensão: da entrada até cada transformador ----------------
  let entradaP: Pt | null = prm.entradaEnergia ? paraPlano(res.plano, prm.entradaEnergia) : null;
  if (!entradaP) {
    const acessos = res.ladosGleba.filter((l) => ehAcesso(l.tipo));
    const cT: Pt = [trafos.reduce((s, t) => s + postes[t.poste].p[0], 0) / trafos.length, trafos.reduce((s, t) => s + postes[t.poste].p[1], 0) / trafos.length];
    const nosEntrada = g.nos.filter((n) => n.naDivisa && acessos.some((l) => projetar([l.a, l.b], n.p).d < 3));
    if (nosEntrada.length) entradaP = nosEntrada.reduce((m, n) => (dist(n.p, cT) < dist(m.p, cT) ? n : m), nosEntrada[0]).p;
    else if (acessos.length) entradaP = projetar([acessos[0].a, acessos[0].b], cT).pt;
    else entradaP = g.nos.filter((n) => n.naDivisa)[0]?.p ?? postes[0].p;
    if (!acessos.length) avisos.push("A gleba não tem lado marcado como estrada: a entrada de energia foi posta na ponta de rua mais perto da divisa — confirme o ponto de conexão com a Coelba.");
  }
  const posteEntrada = postes.reduce((m, p, i) => (dist(p.p, entradaP!) < dist(postes[m].p, entradaP!) ? i : m), 0);
  const { pai: paiE } = dists[posteEntrada];
  postes[posteEntrada].mt = true;
  for (const t of trafos) {
    let u = t.poste;
    postes[u].mt = true;
    for (let guarda = 0; guarda < N && u !== posteEntrada && paiE[u] >= 0; guarda++) {
      const v = paiE[u];
      const vao = vaosSet.get(chave(u, v));
      if (vao) vao.mt = true;
      postes[v].mt = true;
      u = v;
    }
  }

  // ---------------- postes: altura, esforço e equipamentos ----------------
  const grauMt = postes.map(() => 0);
  for (const v of vaos) if (v.mt) { grauMt[v.a]++; grauMt[v.b]++; }
  postes.forEach((p, i) => {
    const t = p.trafo !== null ? trafos[p.trafo] : null;
    const fim = grau[i] === 1;
    // ângulo da linha no poste (dois vãos): acima de 30° pede poste mais forte
    let angulo = 0;
    if (grau[i] === 2) {
      const [a, b] = adj[i].map((x) => postes[x.j].p);
      const u1: Pt = [p.p[0] - a[0], p.p[1] - a[1]], u2: Pt = [b[0] - p.p[0], b[1] - p.p[1]];
      angulo = (Math.acos(Math.max(-1, Math.min(1, (u1[0] * u2[0] + u1[1] * u2[1]) / (Math.hypot(...u1) * Math.hypot(...u2) || 1)))) * 180) / Math.PI;
    }
    p.altura = p.mt || t ? 12 : 9;
    p.esforco = t ? (t.kva > 75 ? 600 : 400) : fim || angulo > 30 || grau[i] >= 3 ? 600 : p.mt ? 300 : 300;
    if (t) p.equipamentos.push(`Transformador ${t.kva.toLocaleString("pt-BR")} kVA`, "Chave fusível", "Para-raios", "Aterramento");
    if (i === posteEntrada) p.equipamentos.push("Derivação da rede da Coelba", "Chave fusível", "Para-raios");
    else if (p.mt && grauMt[i] >= 3) p.equipamentos.push("Derivação de média tensão", "Chave fusível");
    else if (p.mt && grauMt[i] === 1 && !t) p.equipamentos.push("Fim de linha de média tensão", "Para-raios");
    if (!t && fim) p.equipamentos.push("Aterramento (fim de circuito)");
  });
  // nome dos postes pela ordem da entrada (o primeiro é o da derivação)
  const ordemP = postes.map((_, i) => i).sort((a, b) => dists[posteEntrada].d[a] - dists[posteEntrada].d[b]);
  ordemP.forEach((i, k) => { postes[i].id = `P${String(k + 1).padStart(2, "0")}`; });

  const extensaoMT = vaos.filter((v) => v.mt).reduce((s, v) => s + v.L, 0);
  const extensaoBT = vaos.filter((v) => v.bt).reduce((s, v) => s + v.L, 0);
  const kvaInstalado = trafos.reduce((s, t) => s + t.kva, 0);
  const demanda = trafos.reduce((s, t) => s + t.demanda, 0);
  avisos.push(`Tensão secundária ${prm.tensaoBT} V adotada: confirme no site da Coelba a tensão do município (há municípios em 220/127 V e em 380/220 V).`);
  return {
    postes, vaos, trafos, entrada: { p: entradaP, poste: posteEntrada }, ramais,
    ip: { potencia, fluxo: potencia * LM_W, eMedia: eDe(potencia), alvo, classe: prm.classeIP, quantidade: postes.length, kva: postes.length * kvaIp },
    resumo: {
      extensaoMT, extensaoBT, nPostes: postes.length, kvaInstalado, demanda, porLote: totalLotes ? (demanda - postes.length * kvaIp) / totalLotes : 0,
      quedaMax: Math.max(0, ...trafos.map((t) => t.queda)),
    },
    avisos,
  };
}
