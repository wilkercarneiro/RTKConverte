// Rede coletora de esgoto (NBR 9649; manuais Saneago IT00.0723 e Sanepar MPS).
//
// Coletor no eixo da rua (rua com até ~15 m entre alinhamentos), escoando por
// gravidade até o ponto de lançamento — a estação de tratamento do loteamento
// ou a ligação na rede pública, no ponto mais baixo da divisa. Cada rua tem
// coletor; a rua que não está no caminho natural da água vira ponta seca (TIL).
//
//   vazões: Qi = K2·Qm + Qinf (início de plano) e Qf = K1·K2·Qm + Qinf, nunca
//           menos de 1,5 L/s por trecho; Qm = hab·q·C/86.400
//   declividade mínima: I = 0,0055·Qi^−0,47 (tensão trativa ≥ 1 Pa), ≥ 0,5%
//   declividade máxima: I = 4,65·Qf^−0,67 (velocidade ≤ 5 m/s)
//   lâmina: y/D ≤ 0,75 com Qf (≤ 0,50 se a velocidade passa da crítica 6·√(g·Rh))
//   recobrimento mínimo 0,90 m no leito; PV a cada ≤ 80 m e em toda
//   junção/mudança; tubo de queda a partir de 0,50 m de degrau.
//
// O coletor acompanha o terreno com o recobrimento mínimo quando a rua desce o
// bastante; senão desce na declividade mínima e vai aprofundando.
import type { Pt } from "../geom.ts";
import { comprimento, distSegmento } from "../geom.ts";
import { ehAcesso } from "../modelo.ts";
import type { Resultado } from "../calculo.ts";
import type { GrafoRede } from "./grafo.ts";
import { dijkstra, projetar, trechoDaLinha } from "./grafo.ts";
import type { ParametrosInfra } from "./parametros.ts";
import { arvoreDeEscoamento, componentePrincipal, lamina, noDeSaida, noMaisBaixo, secao } from "./gravidade.ts";

export const DN_ESGOTO = [100, 150, 200, 250, 300, 350, 400];
/** Manning do PVC com o envelhecimento (a norma usa 0,013) */
const N_MANNING = 0.013;

export interface PvEsgoto {
  id: string;
  p: Pt;
  /** cota do terreno (tampa) e do fundo (saída) */
  z: number;
  fundo: number;
  prof: number;
  tipo: "PV" | "TIL";
  /** degrau (tubo de queda) na chegada, m */
  queda: number;
  /** nó do grafo (cruzamento/ponta), quando é um */
  no: number | null;
  saida?: boolean;
}

export interface TrechoEsgoto {
  id: string;
  de: number;
  para: number;
  linha: Pt[];
  L: number;
  dn: number;
  /** declividade (m/m) */
  I: number;
  /** vazões de projeto (L/s), inicial e final, a jusante */
  qi: number;
  qf: number;
  /** contribuição do próprio trecho (L/s, final) */
  contrib: number;
  lamina: number;
  v: number;
  tensao: number;
  fMont: number;
  fJus: number;
  lotes: number;
}

export interface RedeEsgoto {
  pvs: PvEsgoto[];
  trechos: TrechoEsgoto[];
  saida: { pv: number; p: Pt; z: number; destino: "ete" | "rede"; q: number } | null;
  /**
   * Estação elevatória: o ponto baixo da rede fica abaixo da ligação na estrada —
   * o esgoto desce até a elevatória e sobe pela linha de recalque.
   */
  elevatoria: { p: Pt; z: number; recalque: Pt[]; L: number; altura: number; destino: Pt } | null;
  ligacoes: { lote: number; de: Pt; ate: Pt }[];
  resumo: { extensao: Record<number, number>; nPv: number; nTil: number; profMax: number; profMedia: number; qMedia: number; qFinal: number; quedas: number };
  avisos: string[];
}

export function projetarEsgoto(res: Resultado, g: GrafoRede, prm: ParametrosInfra): RedeEsgoto {
  const avisos: string[] = [];
  const vazio: RedeEsgoto = { pvs: [], trechos: [], saida: null, elevatoria: null, ligacoes: [], resumo: { extensao: {}, nPv: 0, nTil: 0, profMax: 0, profMedia: 0, qMedia: 0, qFinal: 0, quedas: 0 }, avisos };
  if (!g.arestas.length) return vazio;
  const alcancaveis = componentePrincipal(g);
  // estação de tratamento: no ponto mais baixo da rede (tudo desce até ela)
  let saidaNo = prm.lancamento ? noDeSaida(res, g, alcancaveis, prm.lancamento) : noMaisBaixo(g, alcancaveis);
  let elevatoria: RedeEsgoto["elevatoria"] = null;
  if (!prm.lancamento && prm.destinoEsgoto === "rede") {
    // rede pública: liga na estrada de acesso; se o ponto baixo fica abaixo dela, elevatória no ponto baixo
    const acessos = res.ladosGleba.filter((l) => ehAcesso(l.tipo));
    const naEstrada = (n: number) => g.nos[n].arestas.some((ei) => g.arestas[ei].tipo === "acesso")
      || (g.nos[n].naDivisa && acessos.some((l) => distSegmento(g.nos[n].p, l.a, l.b).d < 3));
    const naRua = noDeSaida(res, g, alcancaveis, undefined, naEstrada);
    if (naEstrada(naRua) && g.nos[saidaNo].z < g.nos[naRua].z - 1) {
      const { pai, via } = dijkstra(g, saidaNo);
      const recalque: Pt[] = [];
      for (let u = naRua, guarda = 0; u !== saidaNo && pai[u] >= 0 && guarda < g.nos.length; guarda++) {
        const e = g.arestas[via[u]];
        const l = e.a === u ? e.linha : e.linha.slice().reverse();
        recalque.push(...(recalque.length ? l.slice(1) : l));
        u = pai[u];
      }
      elevatoria = { p: g.nos[saidaNo].p, z: g.nos[saidaNo].z, recalque: recalque.reverse(), L: comprimento(recalque), altura: g.nos[naRua].z - g.nos[saidaNo].z, destino: g.nos[naRua].p };
    } else saidaNo = naRua;
  }
  const { dirigidas } = arvoreDeEscoamento(g, saidaNo, alcancaveis);

  const qmLote = (prm.habPorLote * prm.perCapita * prm.retorno) / 86400; // L/s
  const cob = prm.recobrimentoEsgoto;
  const dnMin = DN_ESGOTO.includes(prm.dnMinEsgoto) ? prm.dnMinEsgoto : 150;

  // PVs: um por nó do grafo + os intermediários
  const pvs: PvEsgoto[] = [];
  const pvDoNo = new Map<number, number>();
  const novoPv = (p: Pt, no: number | null): number => {
    pvs.push({ id: "", p, z: g.cota(p), fundo: Infinity, prof: 0, tipo: "PV", queda: 0, no });
    return pvs.length - 1;
  };
  const pvNo = (n: number) => { let k = pvDoNo.get(n); if (k === undefined) { k = novoPv(g.nos[n].p, n); pvDoNo.set(n, k); } return k; };

  interface T0 { de: number; para: number; linha: Pt[]; L: number; lotes: number[]; }
  const brutos: T0[] = [];
  for (const d of dirigidas) {
    const L = comprimento(d.linha);
    const partes = Math.max(1, Math.ceil(L / prm.distPv - 1e-6));
    // lotes da aresta na posição do sentido do escoamento
    const e = d.aresta;
    const sDir = e.sLotes.map((s) => {
      const sAB = d.mont === e.a ? s - d.s0 : e.L - d.s0 - s;
      return Math.max(0, Math.min(L, sAB));
    });
    let anterior = d.arvore ? pvNo(d.mont) : novoPv(d.linha[0], null);
    for (let k = 0; k < partes; k++) {
      const s0 = (L * k) / partes, s1 = (L * (k + 1)) / partes;
      const linha = trechoDaLinha(d.linha, s0, s1);
      const fim = k === partes - 1 ? pvNo(d.jus) : novoPv(linha[linha.length - 1], null);
      const lotes = e.lotes.filter((_, i) => sDir[i] >= s0 - 1e-6 && (sDir[i] < s1 || k === partes - 1));
      brutos.push({ de: anterior, para: fim, linha, L: s1 - s0, lotes });
      anterior = fim;
    }
  }
  if (!brutos.length) return vazio;

  // ordem de cálculo: de montante para jusante (cada PV tem uma saída só)
  const entram = new Map<number, number[]>(), sai = new Map<number, number>();
  brutos.forEach((t, i) => { entram.set(t.para, [...(entram.get(t.para) ?? []), i]); sai.set(t.de, i); });
  const grau = brutos.map((t) => (entram.get(t.de) ?? []).length);
  const fila = brutos.map((_, i) => i).filter((i) => grau[i] === 0);
  const ordem: number[] = [];
  while (fila.length) {
    const i = fila.shift()!;
    ordem.push(i);
    const prox = sai.get(brutos[i].para);
    if (prox !== undefined && --grau[prox] === 0) fila.push(prox);
  }
  if (ordem.length < brutos.length) avisos.push("Parte da rede de esgoto formou laço e ficou fora do cálculo.");

  const trechos: TrechoEsgoto[] = brutos.map((t, i) => ({
    id: `E${i + 1}`, de: t.de, para: t.para, linha: t.linha, L: t.L, dn: dnMin, I: 0, qi: 0, qf: 0, contrib: 0, lamina: 0, v: 0, tensao: 0, fMont: 0, fJus: 0, lotes: t.lotes.length,
  }));
  const qiJus = new Float64Array(brutos.length), qfJus = new Float64Array(brutos.length);
  let quedas = 0;
  for (const i of ordem) {
    const t = trechos[i], b = brutos[i];
    const anteriores = entram.get(t.de) ?? [];
    const inf = (prm.infiltracao * t.L) / 1000;
    const qiM = anteriores.reduce((s, k) => s + qiJus[k], 0), qfM = anteriores.reduce((s, k) => s + qfJus[k], 0);
    qiJus[i] = qiM + b.lotes.length * qmLote * prm.k2 + inf;
    qfJus[i] = qfM + b.lotes.length * qmLote * prm.k1 * prm.k2 + inf;
    t.contrib = qfJus[i] - qfM;
    const qi = Math.max(1.5, qiJus[i]), qf = Math.max(1.5, qfJus[i]);
    t.qi = qi; t.qf = qf;
    const Imin = Math.max(0.0055 * qi ** -0.47, 0.005);
    const Imax = 4.65 * qf ** -0.67;
    const zM = pvs[t.de].z, zJ = pvs[t.para].z;
    // o diâmetro de jusante nunca menor que o de montante
    let dn = Math.max(dnMin, ...anteriores.map((k) => trechos[k].dn));
    for (let tentativa = 0; tentativa < DN_ESGOTO.length; tentativa++) {
      const D = dn / 1000;
      // fundo de montante: abaixo de quem chega (geratriz superior alinhada) e com o recobrimento
      let fM = zM - cob - D;
      for (const k of anteriores) fM = Math.min(fM, trechos[k].fJus, trechos[k].fJus + trechos[k].dn / 1000 - D);
      const fJmin = zJ - cob - D;
      let I = (fM - fJmin) / t.L;
      let queda = 0;
      if (I < Imin) I = Imin;
      else if (I > Imax) { const fM2 = fJmin + Imax * t.L; queda = fM - fM2; fM = fM2; I = Imax; }
      const h = lamina(qf / 1000, D, I, N_MANNING);
      const s = secao(D, Math.min(h, 0.94));
      const v = qf / 1000 / s.A;
      const vc = 6 * Math.sqrt(9.81 * s.Rh);
      const limite = v > vc ? 0.5 : 0.75;
      if (h > limite && dn < DN_ESGOTO[DN_ESGOTO.length - 1]) { dn = DN_ESGOTO[DN_ESGOTO.indexOf(dn) + 1]; continue; }
      const hi = lamina(qi / 1000, D, I, N_MANNING);
      t.dn = dn; t.I = I; t.fMont = fM; t.fJus = fM - I * t.L; t.lamina = h; t.v = v;
      t.tensao = 9810 * secao(D, Math.min(hi, 0.94)).Rh * I;
      if (queda >= 0.5) { pvs[t.de].queda = Math.max(pvs[t.de].queda, queda); quedas++; }
      break;
    }
    pvs[t.de].fundo = Math.min(pvs[t.de].fundo, t.fMont);
    pvs[t.para].fundo = Math.min(pvs[t.para].fundo, t.fJus);
  }
  // tipo, nome e profundidade dos PVs
  let nPv = 0, nTil = 0, profMax = 0, somaProf = 0;
  const saidaPv = pvDoNo.get(saidaNo) ?? -1;
  pvs.forEach((pv, k) => {
    const chegam = (entram.get(k) ?? []).length;
    pv.tipo = chegam === 0 && (pv.z - pv.fundo) < 4 ? "TIL" : "PV";
    if (pv.tipo === "TIL") pv.id = `TIL-${String(++nTil).padStart(2, "0")}`;
    else pv.id = `PV-${String(++nPv).padStart(2, "0")}`;
    if (!Number.isFinite(pv.fundo)) pv.fundo = pv.z - cob - dnMin / 1000;
    pv.prof = pv.z - pv.fundo;
    profMax = Math.max(profMax, pv.prof);
    somaProf += pv.prof;
    if (k === saidaPv) pv.saida = true;
  });
  const saida = saidaPv >= 0 ? {
    pv: saidaPv, p: pvs[saidaPv].p, z: pvs[saidaPv].z, destino: prm.destinoEsgoto,
    q: (entram.get(saidaPv) ?? []).reduce((s, k) => s + qfJus[k], 0),
  } : null;
  if (profMax > 3) avisos.push(`Coletor chega a ${profMax.toFixed(2).replace(".", ",")} m de profundidade (acima de 3 m): avalie rede auxiliar ou elevatória nos trechos fundos.`);
  if (!g.temRelevo) avisos.push("Sem o relevo do terreno, o esgoto foi calculado com o terreno plano (declividade mínima em tudo). Gere o relevo nas Perguntas.");
  if (saida && prm.destinoEsgoto === "ete") avisos.push(`Estação de tratamento compacta junto ao ${pvs[saidaPv].id} (o ponto mais baixo): exige licença ambiental e outorga de lançamento.`);
  if (saida && elevatoria) avisos.push(`O ponto baixo da rede fica ${elevatoria.altura.toFixed(1).replace(".", ",")} m abaixo da estrada: estação elevatória junto ao ${pvs[saidaPv].id} e ${Math.round(elevatoria.L)} m de linha de recalque até a ligação na rede pública.`);
  else if (saida && prm.destinoEsgoto === "rede") avisos.push(`Ligação na rede pública no ${pvs[saidaPv].id}: confirme a cota do PV de chegada com a concessionária.`);

  // ligações: do coletor (eixo) até a frente do lote
  const ligacoes: { lote: number; de: Pt; ate: Pt }[] = [];
  for (const e of g.arestas) e.lotes.forEach((lote, k) => ligacoes.push({ lote, de: projetar(e.linha, e.frentes[k]).pt, ate: e.frentes[k] }));

  const extensao: Record<number, number> = {};
  for (const t of trechos) extensao[t.dn] = (extensao[t.dn] ?? 0) + t.L;
  const nLotes = g.arestas.reduce((s, e) => s + e.lotes.length, 0);
  return {
    pvs, trechos, saida, elevatoria, ligacoes,
    resumo: {
      extensao, nPv, nTil, profMax, profMedia: pvs.length ? somaProf / pvs.length : 0,
      qMedia: nLotes * qmLote, qFinal: saida?.q ?? 0, quedas,
    },
    avisos,
  };
}

/** Distância de um ponto ao trecho mais perto (para o clique na tela). */
export function trechoPerto(r: RedeEsgoto, p: Pt): { t: TrechoEsgoto; d: number } | null {
  let melhor: { t: TrechoEsgoto; d: number } | null = null;
  for (const t of r.trechos) { const d = projetar(t.linha, p).d; if (!melhor || d < melhor.d) melhor = { t, d }; }
  return melhor && melhor.d < Infinity ? melhor : null;
}

