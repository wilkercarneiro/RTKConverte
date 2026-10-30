// Drenagem pluvial (microdrenagem): sarjetas, bocas de lobo e galerias.
//
// Método racional Q = C·i·A (área de contribuição bem abaixo de 2 km²), chuva
// pela equação do município (Salvador pré-carregada, SGB/CPRM 2015) com o
// período de retorno do projeto e o tempo de concentração (10 min iniciais +
// percurso). Coeficiente C pelo tamanho do lote (Jundiaí 5.10): < 200 m² 0,90;
// 200–500 0,80; 500–1.000 0,70; > 1.000 0,60; pavimento 0,90; área verde 0,25.
//
// A água corre pela sarjeta (Izzard: Q0 = 0,375·(z/n)·I^½·y0^8/3, faixa
// alagada de até 2 m sobre a pista) até ela esgotar: ali entra um par de bocas
// de lobo (uma em cada lado), e também antes de cada cruzamento onde a sarjeta
// já leva bastante água e no ponto baixo. Das bocas a água desce em galeria
// (Ø400 mínimo, PV a cada ≤ 60 m, recobrimento ≥ 1,0 m, velocidade de 0,75 a
// 6 m/s) até o lançamento — o rio, se a gleba tem um, senão o ponto mais baixo
// da divisa, com dissipador.
import type { Pt } from "../geom.ts";
import { areaPol, centroide, comprimento, dist, distSegmento, lerp, pontoNaPolilinha } from "../geom.ts";
import type { Resultado } from "../calculo.ts";
import type { GrafoRede } from "./grafo.ts";
import { deslocar, projetar, trechoDaLinha } from "./grafo.ts";
import type { ParametrosInfra } from "./parametros.ts";
import { intensidade } from "./parametros.ts";
import { arvoreDeEscoamento, componentePrincipal, lamina, noDeSaida, secao } from "./gravidade.ts";

export const DN_GALERIA = [400, 500, 600, 800, 1000, 1200, 1500];
const N_CONCRETO = 0.013;
/** sarjeta: rugosidade, declividade transversal da pista (3%) e faixa alagada máxima */
const N_SARJETA = 0.016, Z_SARJETA = 1 / 0.03, FAIXA_MAX = 2.0;
const RECOBRIMENTO = 1.0;
const DIST_PV = 60;

export const coefLote = (area: number) => (area < 200 ? 0.9 : area < 500 ? 0.8 : area < 1000 ? 0.7 : 0.6);

export interface BocaDeLobo { id: string; p: Pt; /** direção da guia (para desenhar a grelha) */ dir: Pt; aresta: number; q: number }

export interface PvDrenagem { id: string; p: Pt; z: number; fundo: number; prof: number; no: number | null; saida?: boolean }

export interface TrechoGaleria {
  id: string;
  de: number;
  para: number;
  linha: Pt[];
  L: number;
  dn: number;
  I: number;
  /** vazão de projeto (L/s), tempo de concentração (min), intensidade (mm/h) */
  q: number;
  tc: number;
  i: number;
  lamina: number;
  v: number;
  fMont: number;
  fJus: number;
  /** soma de C·A a montante (m²) */
  ca: number;
}

export interface RedeDrenagem {
  bocas: BocaDeLobo[];
  ramais: { de: Pt; ate: Pt }[];
  pvs: PvDrenagem[];
  trechos: TrechoGaleria[];
  /** sentido da água na sarjeta em cada rua (para as setas da planta) */
  sarjetas: { linha: Pt[]; q: number }[];
  lancamento: { p: Pt; z: number; q: number; rio: boolean } | null;
  resumo: { extensao: Record<number, number>; nBocas: number; areaDrenada: number; cMedio: number; i10: number; qLancamento: number; profMax: number };
  avisos: string[];
}

/** Capacidade de uma sarjeta (m³/s) com a declividade da rua. */
export function capacidadeSarjeta(I: number): number {
  const y0 = FAIXA_MAX / Z_SARJETA;
  return 0.375 * (Z_SARJETA / N_SARJETA) * Math.sqrt(Math.max(0.003, I)) * y0 ** (8 / 3);
}

export function projetarDrenagem(res: Resultado, g: GrafoRede, prm: ParametrosInfra, pista: number): RedeDrenagem {
  const avisos: string[] = [];
  const vazio: RedeDrenagem = { bocas: [], ramais: [], pvs: [], trechos: [], sarjetas: [], lancamento: null, resumo: { extensao: {}, nBocas: 0, areaDrenada: 0, cMedio: 0, i10: 0, qLancamento: 0, profMax: 0 }, avisos };
  if (!g.arestas.length) return vazio;
  const alcancaveis = componentePrincipal(g);
  // lançamento: no rio, se a gleba tem lado de rio; senão o ponto mais baixo da divisa
  const rios = res.ladosGleba.filter((l) => l.tipo === "rio");
  const pertoDoRio = (n: number) => rios.some((l) => distSegmento(g.nos[n].p, l.a, l.b).d < 60);
  const saidaNo = noDeSaida(res, g, alcancaveis, undefined, rios.length ? pertoDoRio : undefined);
  const { dirigidas } = arvoreDeEscoamento(g, saidaNo, alcancaveis);
  const iDe = (tc: number) => intensidade(prm.idf, prm.periodoRetorno, tc);

  // C·A de cada aresta: lotes da frente, a própria rua e as áreas públicas mais perto
  const caAresta = new Map<number, number>();
  let areaTot = 0, caTot = 0;
  for (const e of g.arestas) {
    let ca = e.lotes.reduce((s, li) => s + res.lotes[li].area * coefLote(res.lotes[li].area), 0);
    let a = e.lotes.reduce((s, li) => s + res.lotes[li].area, 0);
    if (e.tipo === "rua") { ca += e.L * e.largura * 0.9; a += e.L * e.largura; }
    caAresta.set(e.id, ca);
    areaTot += a; caTot += ca;
  }
  for (const pa of res.publicas) {
    if (pa.tipo === "app") continue;
    const c = centroide(pa.pol.ext);
    const e = g.arestas.reduce((m, x) => (projetar(x.linha, c).d < projetar(m.linha, c).d ? x : m), g.arestas[0]);
    const C = pa.tipo === "institucional" ? 0.6 : 0.25;
    caAresta.set(e.id, (caAresta.get(e.id) ?? 0) + areaPol(pa.pol) * C);
    areaTot += areaPol(pa.pol); caTot += areaPol(pa.pol) * C;
  }

  // ordem de montante para jusante pelas arestas dirigidas
  const chegamNo = new Map<number, number[]>();
  dirigidas.forEach((d, i) => chegamNo.set(d.jus, [...(chegamNo.get(d.jus) ?? []), i]));
  const saiDoNo = new Map<number, number>();
  dirigidas.forEach((d, i) => { if (d.arvore) saiDoNo.set(d.mont, i); });
  const grau = dirigidas.map((d) => (d.arvore ? (chegamNo.get(d.mont) ?? []).length : 0));
  const fila = dirigidas.map((_, i) => i).filter((i) => grau[i] === 0);
  const ordem: number[] = [];
  while (fila.length) {
    const i = fila.shift()!;
    ordem.push(i);
    const prox = saiDoNo.get(dirigidas[i].jus);
    if (prox !== undefined && --grau[prox] === 0) fila.push(prox);
  }

  // ---------------- sarjetas e bocas de lobo ----------------
  const bocas: BocaDeLobo[] = [];
  /** captações por aresta dirigida: posição (m da montante), C·A captado e tc */
  const captacoes = new Map<number, { s: number; ca: number; tc: number }[]>();
  const superficie = new Float64Array(dirigidas.length); // C·A que segue pela sarjeta ao fim da aresta
  const tcSup = new Float64Array(dirigidas.length).fill(prm.tcInicial);
  const sarjetas: { linha: Pt[]; q: number }[] = [];
  const zDe = (n: number) => g.nos[n].z;
  const ehBaixo = (n: number) => g.nos[n].arestas.length >= 1 && g.nos[n].arestas.every((ei) => {
    const e = g.arestas[ei];
    return zDe(e.a === n ? e.b : e.a) > zDe(n) + 0.2;
  });
  const marcarBoca = (i: number, s: number, ca: number, tc: number, q: number) => {
    const d = dirigidas[i];
    const L = comprimento(d.linha);
    const { pt, dir } = pontoNaPolilinha(d.linha, Math.max(0, Math.min(L, s)));
    const meia = d.aresta.tipo === "rua" ? Math.max(1.5, pista / 2) : 0.8;
    const lados = d.aresta.tipo === "rua" ? [1, -1] : [1];
    for (const lado of lados) {
      const p: Pt = [pt[0] - dir[1] * meia * lado, pt[1] + dir[0] * meia * lado];
      bocas.push({ id: "", p, dir, aresta: d.aresta.id, q: (q * 1000) / lados.length });
    }
    captacoes.set(i, [...(captacoes.get(i) ?? []), { s, ca, tc }]);
  };
  for (const i of ordem) {
    const d = dirigidas[i];
    const L = Math.max(1, comprimento(d.linha));
    const I = Math.max(0.003, (zDe(d.mont) - zDe(d.jus)) / L);
    const cap = 2 * capacidadeSarjeta(I);
    const vSarjeta = Math.max(0.6, Math.min(3, (cap / 2) / (0.5 * FAIXA_MAX * (FAIXA_MAX / Z_SARJETA))));
    // o que vem das ruas de cima pela sarjeta (só a da árvore passa pelo nó)
    let caIn = 0, tc = prm.tcInicial;
    if (d.arvore) for (const k of chegamNo.get(d.mont) ?? []) { caIn += superficie[k]; tc = Math.max(tc, tcSup[k]); }
    const caLin = (caAresta.get(d.aresta.id) ?? 0) / L;
    let s = 0;
    for (let guarda = 0; guarda < 40; guarda++) {
      // vazão no fim da aresta com o que já vem
      const tcFim = tc + (L - s) / vSarjeta / 60;
      const qFim = ((caIn + caLin * (L - s)) * iDe(tcFim)) / 3.6e6;
      if (qFim <= cap * 0.95) break;
      // onde a sarjeta esgota (Q cresce com a distância: busca linear)
      let x = s + 5;
      for (; x < L; x += 2) if (((caIn + caLin * (x - s)) * iDe(tc + (x - s) / vSarjeta / 60)) / 3.6e6 > cap * 0.95) break;
      x = Math.min(L - 2, Math.max(s + 3, x - 2));
      const caCapt = caIn + caLin * (x - s);
      const tcB = tc + (x - s) / vSarjeta / 60;
      marcarBoca(i, x, caCapt, tcB, (caCapt * iDe(tcB)) / 3.6e6);
      caIn = 0; tc = prm.tcInicial; s = x;
    }
    const caFim = caIn + caLin * (L - s);
    const tcFim = tc + (L - s) / vSarjeta / 60;
    const qFim = (caFim * iDe(tcFim)) / 3.6e6;
    sarjetas.push({ linha: d.linha, q: qFim * 1000 });
    const noJus = d.jus;
    const cruzamento = g.nos[noJus].arestas.length >= 3;
    // a montante do cruzamento (sarjeta já carregada), no ponto baixo, na saída e em toda ponta seca
    if (caFim > 1 && (noJus === saidaNo || ehBaixo(noJus) || !d.arvore || (cruzamento && qFim > 0.4 * cap))) {
      marcarBoca(i, Math.max(s + 1, L - Math.min(6, L / 3)), caFim, tcFim, qFim);
      superficie[i] = 0;
    } else {
      superficie[i] = caFim;
      tcSup[i] = tcFim;
    }
  }

  // ---------------- galerias ----------------
  // a galeria existe da primeira boca de lobo até o lançamento
  const pvs: PvDrenagem[] = [];
  const pvDoNo = new Map<number, number>();
  const novoPv = (p: Pt, no: number | null) => { pvs.push({ id: "", p, z: g.cota(p), fundo: Infinity, prof: 0, no }); return pvs.length - 1; };
  const pvNo = (n: number) => { let k = pvDoNo.get(n); if (k === undefined) { k = novoPv(g.nos[n].p, n); pvDoNo.set(n, k); } return k; };
  const temGaleria = new Uint8Array(dirigidas.length);
  const inicio = new Float64Array(dirigidas.length).fill(Infinity);
  for (const [i, cs] of captacoes) { temGaleria[i] = 1; inicio[i] = Math.min(inicio[i], ...cs.map((c) => c.s)); }
  // desce pela árvore a partir de cada aresta com galeria
  for (const i of [...ordem]) {
    if (!temGaleria[i]) continue;
    let k = saiDoNo.get(dirigidas[i].jus);
    while (k !== undefined && !(temGaleria[k] && inicio[k] === 0)) { temGaleria[k] = 1; inicio[k] = 0; k = saiDoNo.get(dirigidas[k].jus); }
  }
  // lado da galeria: no leito, do lado mais baixo (o esgoto fica no eixo)
  interface G0 { de: number; para: number; linha: Pt[]; L: number; capt: { ca: number; tc: number }[]; d: number }
  const brutos: G0[] = [];
  const ramais: { de: Pt; ate: Pt }[] = [];
  for (const i of ordem) {
    if (!temGaleria[i]) continue;
    const d = dirigidas[i];
    const L = comprimento(d.linha);
    const s0 = Math.min(inicio[i], L - 1);
    const off = d.aresta.tipo === "rua" ? Math.min(2.5, Math.max(1, pista / 4)) : 0;
    let lado = 1;
    if (off) {
      const z1 = g.cota(deslocar(d.linha, off)[Math.floor(d.linha.length / 2)]), z2 = g.cota(deslocar(d.linha, -off)[Math.floor(d.linha.length / 2)]);
      lado = z1 <= z2 ? 1 : -1;
    }
    const cs = (captacoes.get(i) ?? []).sort((a, b) => a.s - b.s);
    // quebras: as bocas e o máximo de 60 m entre PVs
    const marcas = [s0, ...cs.map((c) => c.s).filter((s) => s > s0 + 3 && s < L - 3), L];
    const pontos: number[] = [];
    for (let k = 0; k + 1 < marcas.length; k++) {
      const a = marcas[k], b = marcas[k + 1], n = Math.max(1, Math.ceil((b - a) / DIST_PV - 1e-6));
      for (let j = 0; j < n; j++) pontos.push(a + ((b - a) * j) / n);
    }
    pontos.push(L);
    const desl = (pts: Pt[]) => (off ? deslocar(pts, off * lado) : pts);
    let anterior = s0 > 0.5 ? novoPv(desl(trechoDaLinha(d.linha, s0, Math.min(L, s0 + 1)))[0], null) : pvNo(d.mont);
    for (let k = 0; k + 1 < pontos.length; k++) {
      const a = pontos[k], b = pontos[k + 1];
      const linha = trechoDaLinha(d.linha, a, b);
      const fim = k === pontos.length - 2 ? pvNo(d.jus) : novoPv(desl(linha)[linha.length - 1], null);
      const capt = cs.filter((c) => (k === 0 ? c.s <= b + 1e-6 : c.s > a + 1e-6 && c.s <= b + 1e-6)).map((c) => ({ ca: c.ca, tc: c.tc }));
      brutos.push({ de: anterior, para: fim, linha: [pvs[anterior].p, ...desl(linha).slice(1, -1), pvs[fim].p], L: b - a, capt, d: i });
      anterior = fim;
    }
  }
  // emissário: do ponto baixo da rede até a divisa mais baixa ali perto (no rio, se houver) — a água sai da gleba
  let emissario: number | null = null;
  let pontoLanc: Pt = g.nos[saidaNo].p, zLanc = g.nos[saidaNo].z;
  if (brutos.length) {
    let melhor: { p: Pt; z: number } | null = null;
    const lados = rios.length ? rios : res.ladosGleba;
    for (const l of lados) {
      const L = dist(l.a, l.b);
      for (let s = 0; s <= L; s += 4) {
        const p = lerp(l.a, l.b, L ? s / L : 0);
        if (dist(p, g.nos[saidaNo].p) > (rios.length ? 300 : 150)) continue;
        const z = g.cota(p);
        if ((rios.length || z < zLanc - 0.3) && (!melhor || z < melhor.z)) melhor = { p, z };
      }
    }
    if (melhor && dist(melhor.p, g.nos[saidaNo].p) > 3) {
      const de = pvNo(saidaNo);
      emissario = novoPv(melhor.p, null);
      brutos.push({ de, para: emissario, linha: [g.nos[saidaNo].p, melhor.p], L: dist(g.nos[saidaNo].p, melhor.p), capt: [], d: -1 });
      pontoLanc = melhor.p; zLanc = melhor.z;
    }
  }
  const trechos: TrechoGaleria[] = [];
  const entram = new Map<number, number[]>();
  brutos.forEach((t, k) => entram.set(t.para, [...(entram.get(t.para) ?? []), k]));
  const sai = new Map<number, number>();
  brutos.forEach((t, k) => sai.set(t.de, k));
  const grauG = brutos.map((t) => (entram.get(t.de) ?? []).length);
  const filaG = brutos.map((_, k) => k).filter((k) => grauG[k] === 0);
  const ordemG: number[] = [];
  while (filaG.length) { const k = filaG.shift()!; ordemG.push(k); const p = sai.get(brutos[k].para); if (p !== undefined && --grauG[p] === 0) filaG.push(p); }
  brutos.forEach((t, k) => trechos.push({ id: `G${k + 1}`, de: t.de, para: t.para, linha: t.linha, L: t.L, dn: 400, I: 0, q: 0, tc: 0, i: 0, lamina: 0, v: 0, fMont: 0, fJus: 0, ca: 0 }));
  const caJus = new Float64Array(brutos.length), tcJus = new Float64Array(brutos.length);
  let profMax = 0;
  for (const k of ordemG) {
    const t = trechos[k], b = brutos[k];
    const ant = entram.get(t.de) ?? [];
    let ca = ant.reduce((s, j) => s + caJus[j], 0);
    let tc = Math.max(prm.tcInicial, ...ant.map((j) => tcJus[j]), ...b.capt.map((c) => c.tc));
    ca += b.capt.reduce((s, c) => s + c.ca, 0);
    const i = iDe(tc);
    const q = (ca * i) / 3.6e6;
    const zM = pvs[t.de].z, zJ = pvs[t.para].z;
    let dn = Math.max(400, ...ant.map((j) => trechos[j].dn));
    for (let tent = 0; tent < DN_GALERIA.length; tent++) {
      const D = dn / 1000;
      const Imin = Math.max(0.002, ((0.75 * N_CONCRETO) / (D / 4) ** (2 / 3)) ** 2);
      let fM = zM - RECOBRIMENTO - D;
      for (const j of ant) fM = Math.min(fM, trechos[j].fJus + trechos[j].dn / 1000 - D, trechos[j].fJus);
      const fJmin = zJ - RECOBRIMENTO - D;
      let I = Math.max(Imin, (fM - fJmin) / t.L);
      const Imax = ((6 * N_CONCRETO) / (D / 4) ** (2 / 3)) ** 2;
      if (I > Imax) { fM = fJmin + Imax * t.L; I = Imax; }
      const h = lamina(q, D, I, N_CONCRETO);
      if (h > 0.85 && dn < DN_GALERIA[DN_GALERIA.length - 1]) { dn = DN_GALERIA[DN_GALERIA.indexOf(dn) + 1]; continue; }
      const s = secao(D, Math.min(h, 0.94));
      Object.assign(t, { dn, I, q: q * 1000, tc, i, lamina: h, v: q / Math.max(1e-9, s.A), fMont: fM, fJus: fM - I * t.L, ca });
      break;
    }
    caJus[k] = ca;
    tcJus[k] = tc + t.L / Math.max(0.75, t.v) / 60;
    pvs[t.de].fundo = Math.min(pvs[t.de].fundo, t.fMont);
    pvs[t.para].fundo = Math.min(pvs[t.para].fundo, t.fJus);
  }
  pvs.forEach((pv, k) => {
    pv.id = `PVD-${String(k + 1).padStart(2, "0")}`;
    if (!Number.isFinite(pv.fundo)) pv.fundo = pv.z - RECOBRIMENTO - 0.4;
    pv.prof = pv.z - pv.fundo;
    profMax = Math.max(profMax, pv.prof);
  });
  bocas.forEach((b, k) => { b.id = `BL-${String(k + 1).padStart(2, "0")}`; });
  // ramal de cada boca até o PV mais perto (há um PV na estação de cada par de bocas)
  if (pvs.length) for (const b of bocas) {
    const pv = pvs.reduce((m, x) => (dist(x.p, b.p) < dist(m.p, b.p) ? x : m), pvs[0]);
    ramais.push({ de: b.p, ate: pv.p });
  }
  const pvSaida = emissario ?? pvDoNo.get(saidaNo);
  if (pvSaida !== undefined) pvs[pvSaida].saida = true;
  const qLanc = pvSaida !== undefined ? (entram.get(pvSaida) ?? []).reduce((s, j) => s + trechos[j].q, 0) : 0;
  const lancamento = { p: pontoLanc, z: zLanc, q: qLanc, rio: rios.length > 0 && (emissario !== null || pertoDoRio(saidaNo)) };
  if (!trechos.length && bocas.length === 0) avisos.push("A sarjeta dá conta da chuva de projeto em todas as ruas: nenhuma boca de lobo nem galeria foi necessária.");
  if (qLanc > 0) avisos.push(`Lançamento de ${(qLanc / 1000).toFixed(2).replace(".", ",")} m³/s ${lancamento.rio ? "no rio" : "no ponto mais baixo da divisa"}: prever dissipador de energia${lancamento.rio ? " e a outorga do lançamento" : " e o destino da água fora da gleba"}.`);
  if (!g.temRelevo) avisos.push("Sem o relevo do terreno, a drenagem foi calculada com a rua plana (declividade mínima).");
  const extensao: Record<number, number> = {};
  for (const t of trechos) extensao[t.dn] = (extensao[t.dn] ?? 0) + t.L;
  return {
    bocas, ramais, pvs, trechos, sarjetas, lancamento,
    resumo: {
      extensao, nBocas: bocas.length, areaDrenada: areaTot, cMedio: areaTot ? caTot / areaTot : 0,
      i10: iDe(prm.tcInicial), qLancamento: qLanc, profMax,
    },
    avisos,
  };
}

