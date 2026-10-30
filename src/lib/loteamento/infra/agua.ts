// Rede de distribuição de água (NBR 12218:2017).
//
// Um tubo por rua (rede simples no passeio mais baixo; dupla, um em cada
// passeio, na rua com 15 m ou mais entre alinhamentos — Sanepar MPS 11.3), a
// 0,70 m do alinhamento. A rede é MALHADA onde as ruas fecham quadra e é
// resolvida como o EPANET resolve: gradiente global (Todini-Pilati), perda de
// carga por Hazen-Williams. Dimensionamento: tudo começa em DN 50 e o tubo que
// passa da perda máxima (10 m/km) sobe de diâmetro até ninguém passar.
//
// A demanda de cada rua é a dos lotes que dão frente para ela (vazão em marcha
// concentrada metade em cada ponta), na hora de maior consumo do dia de maior
// consumo: Q = P·q·K1·K2/86.400.
//
// O reservatório fica na área pública mais alta (ou no nó mais alto). O nível
// mínimo da água sai do ponto crítico: N.A. = máx(cota + pressão mínima + perda
// até lá). Se o N.A. passa do chão do reservatório, ele é ELEVADO (torre). A
// estática máxima (N.A. − cota mais baixa) acima de 40 mca pede válvula
// redutora (VRP) na entrada da zona baixa.
import { antiHorario, centroide, dist, offsetPols, pontoDoRotulo } from "../geom.ts";
import type { Pt } from "../geom.ts";
import type { Resultado } from "../calculo.ts";
import type { GrafoRede } from "./grafo.ts";
import { deslocar, outro, trechoDaLinha } from "./grafo.ts";
import type { ParametrosInfra } from "./parametros.ts";
import { paraPlano } from "../plano.ts";

/** Diâmetros comerciais (PVC PBA até DN 100, DEFoFo acima). */
export const DN_AGUA = [50, 75, 100, 150, 200, 250, 300];
/** Diâmetro interno de cálculo (m) de cada DN (PVC PBA classe 15 / DEFoFo 1 MPa). */
const DI: Record<number, number> = { 50: 0.0476, 75: 0.0725, 100: 0.0976, 150: 0.1564, 200: 0.2042, 250: 0.2526, 300: 0.3008 };
const NHW = 1.852;

export interface TuboAgua {
  id: string;
  /** aresta do grafo (−1 = adutora do reservatório) */
  aresta: number;
  /** nós do grafo nas pontas (o sentido positivo da vazão é de → para) */
  de: number;
  para: number;
  /** desenho do tubo (no passeio) */
  linha: Pt[];
  /** segundo tubo da rede dupla (no outro passeio) */
  linha2?: Pt[];
  L: number;
  dn: number;
  dupla: boolean;
  /** vazão (L/s, + de → para), velocidade (m/s), perda unitária (m/km) e total (m) */
  q: number;
  v: number;
  j: number;
  hf: number;
  lotes: number;
  adutora?: boolean;
}

export interface NoAgua {
  no: number;
  p: Pt;
  z: number;
  /** demanda concentrada (L/s) */
  demanda: number;
  /** cota piezométrica (m) */
  carga: number;
  /** pressão dinâmica e estática (mca) */
  pDin: number;
  pEst: number;
}

export interface Reservatorio {
  p: Pt;
  z: number;
  /** nível mínimo da água que garante a pressão mínima no ponto crítico */
  na: number;
  tipo: "elevado" | "apoiado";
  /** altura do fuste (elevado) */
  altura: number;
  /** volume útil (m³): 1/3 do consumo do dia de maior consumo (NBR 12217) */
  volume: number;
  /** nó onde a adutora encosta na rede */
  noLigacao: number;
  /** nome da área pública onde ficou (ou null: área a reservar) */
  area: string | null;
  /** nó crítico (o que fixou o nível) */
  critico: number;
}

export interface RedeAgua {
  tubos: TuboAgua[];
  nos: NoAgua[];
  reservatorio: Reservatorio | null;
  registros: { p: Pt; tubo: string }[];
  descargas: { p: Pt; no: number }[];
  ventosas: { p: Pt; no: number }[];
  hidrantes: { p: Pt; no: number }[];
  vrps: { p: Pt; tubo: string }[];
  ligacoes: { lote: number; de: Pt; ate: Pt }[];
  resumo: {
    populacao: number;
    /** vazões (L/s): média, do dia de maior consumo e da hora de maior consumo */
    qMedia: number;
    qDia: number;
    qHora: number;
    extensao: Record<number, number>;
    pMin: number;
    pMax: number;
    pEstMax: number;
    iteracoes: number;
    convergiu: boolean;
  };
  avisos: string[];
}

/** r de Hazen-Williams (SI: h = r·Q^1,852, Q em m³/s). */
const rHW = (L: number, dn: number, C: number) => (10.67 * L) / (C ** NHW * DI[dn] ** 4.87);

/** Gradiente conjugado com pré-condicionador de Jacobi (matriz simétrica esparsa). */
function resolverPCG(n: number, diag: Float64Array, viz: { j: number; v: number }[][], b: Float64Array, x: Float64Array): void {
  const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  const mult = (v: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) { let s = diag[i] * v[i]; for (const e of viz[i]) s += e.v * v[e.j]; out[i] = s; }
  };
  mult(x, Ap);
  let rz = 0, bb = 0;
  for (let i = 0; i < n; i++) { r[i] = b[i] - Ap[i]; z[i] = r[i] / diag[i]; p[i] = z[i]; rz += r[i] * z[i]; bb += b[i] * b[i]; }
  const tol = 1e-20 * Math.max(1, bb);
  for (let it = 0; it < 4 * n + 50; it++) {
    mult(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (Math.abs(pAp) < 1e-300) break;
    const alfa = rz / pAp;
    let rr = 0;
    for (let i = 0; i < n; i++) { x[i] += alfa * p[i]; r[i] -= alfa * Ap[i]; rr += r[i] * r[i]; }
    if (rr < tol) break;
    let rz2 = 0;
    for (let i = 0; i < n; i++) { z[i] = r[i] / diag[i]; rz2 += r[i] * z[i]; }
    const beta = rz2 / rz;
    rz = rz2;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
  }
}

interface Hidraulica { H: Float64Array; Q: Float64Array; iteracoes: number; convergiu: boolean }

/**
 * Gradiente global (Todini-Pilati): nós com carga desconhecida, um nó de carga
 * fixa (o reservatório). `r` de cada tubo e demandas em m³/s.
 */
function resolver(nNos: number, fixo: number, H0: number, tubos: { de: number; para: number; r: number }[], demanda: Float64Array): Hidraulica {
  const Q = new Float64Array(tubos.length).fill(0.001);
  const H = new Float64Array(nNos).fill(H0);
  // índice só dos nós livres
  const idx = new Int32Array(nNos).fill(-1);
  let m = 0;
  for (let i = 0; i < nNos; i++) if (i !== fixo) idx[i] = m++;
  let iteracoes = 0, convergiu = false;
  for (; iteracoes < 80; iteracoes++) {
    const diag = new Float64Array(m), F = new Float64Array(m);
    const viz: { j: number; v: number }[][] = Array.from({ length: m }, () => []);
    const p = new Float64Array(tubos.length);
    tubos.forEach((t, k) => {
      const q = Math.max(Math.abs(Q[k]), 1e-6);
      p[k] = 1 / (NHW * t.r * q ** (NHW - 1));
      const y = (1 - 1 / NHW) * Q[k];
      const i = idx[t.de], j = idx[t.para];
      // continuidade no nó: entra − sai = demanda
      if (i >= 0) { diag[i] += p[k]; F[i] -= y; }
      if (j >= 0) { diag[j] += p[k]; F[j] += y; }
      if (i >= 0 && j >= 0) { viz[i].push({ j, v: -p[k] }); viz[j].push({ j: i, v: -p[k] }); }
      else if (i >= 0) F[i] += p[k] * H0;
      else if (j >= 0) F[j] += p[k] * H0;
    });
    for (let i = 0; i < nNos; i++) if (idx[i] >= 0) F[idx[i]] -= demanda[i];
    const x = new Float64Array(m);
    for (let i = 0; i < nNos; i++) if (idx[i] >= 0) x[idx[i]] = H[i];
    resolverPCG(m, diag, viz, F, x);
    for (let i = 0; i < nNos; i++) H[i] = idx[i] >= 0 ? x[idx[i]] : H0;
    let dq = 0, sq = 0;
    tubos.forEach((t, k) => {
      const novo = (1 - 1 / NHW) * Q[k] + p[k] * (H[t.de] - H[t.para]);
      dq += Math.abs(novo - Q[k]);
      sq += Math.abs(novo);
      Q[k] = novo;
    });
    if (dq <= 1e-5 * Math.max(sq, 1e-6)) { convergiu = true; iteracoes++; break; }
  }
  return { H, Q, iteracoes, convergiu };
}

/** Escolhe onde vai o reservatório: a área pública mais alta perto da rede, ou o nó mais alto. */
function lugarDoReservatorio(res: Resultado, g: GrafoRede, prm: ParametrosInfra, alcancaveis: Set<number>): { p: Pt; area: string | null } {
  if (prm.reservatorio) return { p: paraPlano(res.plano, prm.reservatorio), area: null };
  const nosOk = g.nos.filter((n) => alcancaveis.has(n.id));
  const zMaxNo = Math.max(...nosOk.map((n) => n.z));
  const cands = res.publicas
    .filter((a) => a.tipo === "institucional" || a.tipo === "verde" || a.tipo === "lazer")
    .map((a) => {
      // num canto da área (6 m para dentro), o mais alto e longe do centro, onde vai o prédio
      const c = centroide(a.pol.ext);
      const dentro = offsetPols([{ ext: antiHorario(a.pol.ext), furos: [] }], -6)[0];
      const cantos = dentro ? dentro.ext : [pontoDoRotulo(a.pol)];
      const p = cantos.reduce((m, q) => (g.cota(q) * 2 + dist(q, c) * 0.15 > g.cota(m) * 2 + dist(m, c) * 0.15 ? q : m), cantos[0]);
      const perto = Math.min(...nosOk.map((n) => dist(n.p, p)));
      return { p, nome: a.nome, z: g.cota(p), perto, inst: a.tipo === "institucional" };
    })
    .filter((c) => c.perto < 160);
  cands.sort((x, y) => (y.z + (y.inst ? 1.5 : 0) - y.perto * 0.01) - (x.z + (x.inst ? 1.5 : 0) - x.perto * 0.01));
  // reservatório é equipamento público: fica na área pública mais alta; até ~8 m
  // abaixo do ponto mais alto da rede a torre compensa sem ficar exagerada
  if (cands.length && cands[0].z >= zMaxNo - 8) return { p: cands[0].p, area: cands[0].nome };
  const alto = nosOk.reduce((a, b) => (b.z > a.z ? b : a), nosOk[0]);
  if (cands.length) return { p: cands[0].p, area: cands[0].nome };
  // sem área pública: junto do nó mais alto (a área tem de ser reservada no projeto)
  return { p: alto.p, area: null };
}

export function projetarAgua(res: Resultado, g: GrafoRede, prm: ParametrosInfra): RedeAgua {
  const avisos: string[] = [];
  const nLotes = res.lotes.length - g.semRede.length;
  const populacao = nLotes * prm.habPorLote;
  const qMedia = (populacao * prm.perCapita) / 86400;
  const qDia = qMedia * prm.k1, qHora = qDia * prm.k2;
  const vazio: RedeAgua = {
    tubos: [], nos: [], reservatorio: null, registros: [], descargas: [], ventosas: [], hidrantes: [], vrps: [], ligacoes: [],
    resumo: { populacao, qMedia, qDia, qHora, extensao: {}, pMin: 0, pMax: 0, pEstMax: 0, iteracoes: 0, convergiu: true }, avisos,
  };
  if (!g.arestas.length || !nLotes) return vazio;

  // componente com mais lotes (é ela que o reservatório abastece)
  const comp = new Int32Array(g.nos.length).fill(-1);
  let nc = 0;
  for (const n0 of g.nos) {
    if (comp[n0.id] >= 0) continue;
    const pilha = [n0.id];
    comp[n0.id] = nc;
    while (pilha.length) {
      const u = pilha.pop()!;
      for (const ei of g.nos[u].arestas) { const v = outro(g.arestas[ei], u); if (comp[v] < 0) { comp[v] = nc; pilha.push(v); } }
    }
    nc++;
  }
  const lotesComp = new Array<number>(nc).fill(0);
  for (const e of g.arestas) lotesComp[comp[e.a]] += e.lotes.length;
  const principal = lotesComp.indexOf(Math.max(...lotesComp));
  const alcancaveis = new Set(g.nos.filter((n) => comp[n.id] === principal).map((n) => n.id));
  const fora = g.arestas.filter((e) => comp[e.a] !== principal).reduce((s, e) => s + e.lotes.length, 0);
  if (fora) avisos.push(`${fora} lote(s) em ruas sem ligação com a malha principal ficaram sem água — ligue essas ruas à rede.`);

  // reservatório + adutora até o nó mais perto
  const lugar = lugarDoReservatorio(res, g, prm, alcancaveis);
  const nosRede = g.nos.filter((n) => alcancaveis.has(n.id));
  const noLig = nosRede.reduce((a, b) => (dist(b.p, lugar.p) < dist(a.p, lugar.p) ? b : a), nosRede[0]);
  const R = g.nos.length; // índice do nó do reservatório
  const zRes = g.cota(lugar.p);

  // demandas: a vazão da rua dividida pelos lotes, metade em cada ponta
  const demanda = new Float64Array(R + 1);
  const qLote = qHora / Math.max(1, nLotes) / 1000; // m³/s
  for (const e of g.arestas) {
    if (!alcancaveis.has(e.a)) continue;
    demanda[e.a] += (e.lotes.length * qLote) / 2;
    demanda[e.b] += (e.lotes.length * qLote) / 2;
  }

  // tubos
  const tubos: TuboAgua[] = [];
  const dnMin: number[] = [];
  for (const e of g.arestas) {
    if (!alcancaveis.has(e.a)) continue;
    const dupla = e.tipo === "rua" && e.largura >= 15;
    // passeio mais baixo (rede simples), a 0,70 m do alinhamento
    const off = e.tipo === "acesso" ? 0 : Math.max(0.5, e.largura / 2 - 0.7);
    let lado = 1;
    if (off > 0 && e.L > 2) {
      const meio = trechoDaLinha(e.linha, e.L * 0.25, e.L * 0.75);
      const zE = deslocar(meio, off).reduce((s, p) => s + g.cota(p), 0), zD = deslocar(meio, -off).reduce((s, p) => s + g.cota(p), 0);
      lado = zE <= zD ? 1 : -1;
    }
    tubos.push({
      id: `A${tubos.length + 1}`, aresta: e.id, de: e.a, para: e.b, linha: desenhoNoPasseio(e.linha, lado * off, e.L),
      ...(dupla ? { linha2: desenhoNoPasseio(e.linha, -lado * off, e.L) } : {}),
      L: e.L, dn: 50, dupla, q: 0, v: 0, j: 0, hf: 0, lotes: e.lotes.length,
    });
    dnMin.push(50);
  }
  tubos.push({ id: "AD", aresta: -1, de: R, para: noLig.id, linha: [lugar.p, noLig.p], L: Math.max(1, dist(lugar.p, noLig.p)), dn: 50, dupla: false, q: 0, v: 0, j: 0, hf: 0, lotes: 0, adutora: true });
  dnMin.push(75);

  // hidrantes: cobertura dos lotes pelo raio, nos nós (Bombeiros: 300 m)
  const hidrantes: { p: Pt; no: number }[] = [];
  if (prm.raioHidrante > 0) {
    const pts = g.arestas.flatMap((e) => (alcancaveis.has(e.a) ? e.frentes : []));
    const coberto = new Uint8Array(pts.length);
    for (let guarda = 0; guarda < 50 && coberto.some((c) => !c); guarda++) {
      let melhor = -1, ganho = 0;
      for (const n of nosRede) {
        let k = 0;
        pts.forEach((p, i) => { if (!coberto[i] && dist(p, n.p) <= prm.raioHidrante) k++; });
        const extra = k + (n.arestas.length >= 3 ? 0.5 : 0);
        if (extra > ganho) { ganho = extra; melhor = n.id; }
      }
      if (melhor < 0 || ganho < 1) break;
      hidrantes.push({ p: g.nos[melhor].p, no: melhor });
      pts.forEach((p, i) => { if (dist(p, g.nos[melhor].p) <= prm.raioHidrante) coberto[i] = 1; });
    }
  }

  // dimensionamento: sobe o DN de quem passa da perda máxima
  const r = (t: TuboAgua) => rHW(t.L, t.dn, prm.cHW) / (t.dupla ? 2 ** NHW : 1);
  let hid: Hidraulica = { H: new Float64Array(R + 1), Q: new Float64Array(tubos.length), iteracoes: 0, convergiu: true };
  const calcular = () => {
    hid = resolver(R + 1, R, 1000, tubos.map((t) => ({ de: t.de, para: t.para, r: r(t) })), demanda);
    tubos.forEach((t, k) => {
      const q = hid.Q[k];
      const qTubo = t.dupla ? q / 2 : q;
      t.q = q * 1000;
      t.v = Math.abs(qTubo) / ((Math.PI * DI[t.dn] ** 2) / 4);
      t.hf = Math.abs(hid.H[t.de] - hid.H[t.para]);
      t.j = (1000 * t.hf) / t.L;
    });
  };
  // o caminho do reservatório até um nó, subindo pela maior carga
  const caminho = (no: number): number[] => {
    const out: number[] = [];
    let u = no;
    for (let guarda = 0; u !== R && guarda < R + 5; guarda++) {
      let melhor = -1, hm = -Infinity;
      tubos.forEach((t, k) => {
        if (t.de !== u && t.para !== u) return;
        const v = t.de === u ? t.para : t.de;
        if (hid.H[v] > hm) { hm = hid.H[v]; melhor = k; }
      });
      if (melhor < 0 || hm <= hid.H[u] - 1e-9) break;
      out.push(melhor);
      u = tubos[melhor].de === u ? tubos[melhor].para : tubos[melhor].de;
    }
    return out;
  };
  calcular();
  // hidrante DN 100 na boca: o caminho até ele não fica abaixo de DN 100
  if (hidrantes.length) {
    for (const h of hidrantes) for (const k of caminho(h.no)) dnMin[k] = Math.max(dnMin[k], 100);
  }
  for (let passo = 0; passo < 40; passo++) {
    let mudou = false;
    tubos.forEach((t, k) => {
      const alvo = Math.max(dnMin[k], t.dn);
      if (alvo !== t.dn) { t.dn = alvo; mudou = true; }
      if (t.j > prm.perdaMax && t.dn < DN_AGUA[DN_AGUA.length - 1]) { t.dn = DN_AGUA[DN_AGUA.indexOf(t.dn) + 1]; mudou = true; }
    });
    if (!mudou) break;
    calcular();
  }
  if (!hid.convergiu) avisos.push("O cálculo da malha de água não convergiu totalmente — confira os trechos marcados.");

  // nível do reservatório pelo ponto crítico (a perda não depende do nível)
  let na = zRes, critico = noLig.id;
  for (const n of nosRede) {
    if (demanda[n.id] <= 0 && n.arestas.length > 1) continue;
    const precisa = n.z + prm.pressaoMin + (1000 - hid.H[n.id]);
    if (precisa > na) { na = precisa; critico = n.id; }
  }
  na = Math.ceil(na * 10) / 10;
  const altura = Math.max(0, na - zRes);
  const elevado = altura > 3;
  const naCheio = na + (elevado ? 3 : 0); // lâmina útil da torre
  const volume = arredondarVolume((populacao * prm.perCapita * prm.k1) / 1000 / 3);
  const reservatorio: Reservatorio = {
    p: lugar.p, z: zRes, na, tipo: elevado ? "elevado" : "apoiado", altura: elevado ? Math.ceil(altura) : 0, volume,
    noLigacao: noLig.id, area: lugar.area, critico,
  };
  if (!lugar.area && !prm.reservatorio) avisos.push("Nenhuma área pública fica no alto: o reservatório foi posto junto ao ponto mais alto da rede — reserve uma área para ele (ou escolha o lugar).");

  const nos: NoAgua[] = nosRede.map((n) => {
    const carga = hid.H[n.id] - 1000 + na;
    return { no: n.id, p: n.p, z: n.z, demanda: demanda[n.id] * 1000, carga, pDin: carga - n.z, pEst: naCheio - n.z };
  });
  const pMin = Math.min(...nos.map((x) => x.pDin)), pMax = Math.max(...nos.map((x) => x.pDin));
  const pEstMax = Math.max(...nos.map((x) => x.pEst));

  // VRP na entrada de cada zona baixa (estática acima do máximo)
  const vrps: { p: Pt; tubo: string }[] = [];
  const pEst = new Map(nos.map((x) => [x.no, x.pEst]));
  if (pEstMax > prm.pressaoMax) {
    for (const t of tubos) {
      if (t.adutora) continue;
      const [alto, baixo] = (pEst.get(t.de) ?? 0) <= (pEst.get(t.para) ?? 0) ? [t.de, t.para] : [t.para, t.de];
      if ((pEst.get(alto) ?? 0) <= prm.pressaoMax && (pEst.get(baixo) ?? 0) > prm.pressaoMax) {
        const ponta = alto === t.de ? 0.3 : 0.7;
        vrps.push({ p: pontoNaLinha(t.linha, ponta), tubo: t.id });
      }
    }
    avisos.push(`Pressão estática chega a ${pEstMax.toFixed(1).replace(".", ",")} mca (máximo ${prm.pressaoMax}): ${vrps.length} válvula(s) redutora(s) de pressão na entrada da zona baixa.`);
  }
  if (pMin < prm.pressaoMin - 0.05) avisos.push(`Pressão dinâmica mínima de ${pMin.toFixed(1).replace(".", ",")} mca — abaixo de ${prm.pressaoMin} mca.`);

  // registros: em cada derivação, um por ramal que sai (menos o de maior vazão)
  const registros: { p: Pt; tubo: string }[] = [];
  for (const n of nosRede) {
    const ts = tubos.filter((t) => !t.adutora && (t.de === n.id || t.para === n.id));
    if (ts.length < 3) continue;
    // os dois de maior vazão são o tronco que atravessa o nó; registro só nos ramais que derivam
    const ordem = [...ts].sort((a, b) => Math.abs(b.q) - Math.abs(a.q));
    for (const t of ordem.slice(2)) registros.push({ p: pontoNaLinha(t.linha, t.de === n.id ? Math.min(0.5, 6 / t.L) : Math.max(0.5, 1 - 6 / t.L)), tubo: t.id });
  }
  // descargas nos pontos baixos e pontas secas; ventosas nos altos
  const descargas: { p: Pt; no: number }[] = [], ventosas: { p: Pt; no: number }[] = [];
  for (const n of nosRede) {
    const viz = n.arestas.map((ei) => g.nos[outro(g.arestas[ei], n.id)]);
    if (n.arestas.length === 1 || viz.every((v) => v.z > n.z + 0.3)) descargas.push({ p: n.p, no: n.id });
    else if (viz.length >= 2 && viz.every((v) => v.z < n.z - 0.3)) ventosas.push({ p: n.p, no: n.id });
  }

  // ligações prediais: do tubo até a frente do lote
  const ligacoes: { lote: number; de: Pt; ate: Pt }[] = [];
  for (const t of tubos) {
    if (t.adutora) continue;
    const e = g.arestas[t.aresta];
    e.lotes.forEach((lote, k) => {
      const linha = t.linha2 && e.ladoLotes[k] !== ladoDe(t.linha, e.linha) ? t.linha2 : t.linha;
      ligacoes.push({ lote, de: projetarEm(linha, e.frentes[k]), ate: e.frentes[k] });
    });
  }

  const extensao: Record<number, number> = {};
  for (const t of tubos) extensao[t.dn] = (extensao[t.dn] ?? 0) + t.L * (t.dupla ? 2 : 1);
  const semHid = hidrantes.length && prm.raioHidrante > 0;
  if (semHid) avisos.push(`Hidrantes de coluna DN 100 com raio de ${prm.raioHidrante} m: confirme a exigência com o Corpo de Bombeiros (alguns pedem rede DN 150 no hidrante).`);
  return {
    tubos, nos, reservatorio, registros, descargas, ventosas, hidrantes, vrps, ligacoes,
    resumo: { populacao, qMedia, qDia, qHora, extensao, pMin, pMax, pEstMax, iteracoes: hid.iteracoes, convergiu: hid.convergiu }, avisos,
  };
}

/** Volumes comerciais de reservatório (m³). */
function arredondarVolume(v: number): number {
  for (const c of [5, 10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500, 750, 1000]) if (c >= v) return c;
  return Math.ceil(v / 100) * 100;
}

/** Desenho do tubo no passeio: sai do nó, corre deslocado e volta ao outro nó. */
function desenhoNoPasseio(eixo: Pt[], off: number, L: number): Pt[] {
  if (Math.abs(off) < 0.01 || L < 12) return eixo.slice();
  const recuo = Math.min(L / 3, Math.max(4, Math.abs(off) + 2));
  const meio = deslocar(trechoDaLinha(eixo, recuo, L - recuo), off);
  return [eixo[0], ...meio, eixo[eixo.length - 1]];
}

function pontoNaLinha(linha: Pt[], t: number): Pt {
  let L = 0;
  for (let i = 0; i + 1 < linha.length; i++) L += dist(linha[i], linha[i + 1]);
  const alvo = L * t;
  let acc = 0;
  for (let i = 0; i + 1 < linha.length; i++) {
    const l = dist(linha[i], linha[i + 1]);
    if (acc + l >= alvo) { const u = l ? (alvo - acc) / l : 0; return [linha[i][0] + (linha[i + 1][0] - linha[i][0]) * u, linha[i][1] + (linha[i + 1][1] - linha[i][1]) * u]; }
    acc += l;
  }
  return linha[linha.length - 1];
}

function projetarEm(linha: Pt[], p: Pt): Pt {
  let melhor: Pt = linha[0], dm = Infinity;
  for (let i = 0; i + 1 < linha.length; i++) {
    const a = linha[i], b = linha[i + 1];
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    const q: Pt = [a[0] + dx * t, a[1] + dy * t];
    const d = dist(p, q);
    if (d < dm) { dm = d; melhor = q; }
  }
  return melhor;
}

/** De que lado do eixo fica a linha (+1 esquerda). */
function ladoDe(linha: Pt[], eixo: Pt[]): number {
  const meio = linha.length > 2 ? linha.slice(1, -1) : linha;
  const c: Pt = [meio.reduce((s, p) => s + p[0], 0) / meio.length, meio.reduce((s, p) => s + p[1], 0) / meio.length];
  const a = eixo[0], b = eixo[eixo.length - 1];
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) >= 0 ? 1 : -1;
}
