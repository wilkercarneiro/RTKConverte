// Roteiro do voo de drone da maquete 3D — como o filme de lançamento de um
// loteamento: o drone desce na rua de entrada e passeia por DENTRO das ruas
// (vira nas esquinas, para na frente de casas com a ficha do lote), sobe para
// mostrar a área verde, desce em outra rua, passa pelo institucional e pelo
// miolo e termina na vista geral. Legendas com os números reais. Sem
// three.js: só posições e tempos.
//
// O mundo é o da maquete: x = leste, z = −norte, y = altura (já com o
// exagero); `xz` e `chao` vêm de quem desenha.
import type { Resultado, RuaCalc } from "./calculo.ts";
import { fmt } from "./calculo.ts";
import type { Cena } from "./cena3d.ts";
import { areaPol, centroide, comprimento, dentroPol, dist, distAnel, distSegmento, pontoNaPolilinha } from "./geom.ts";
import type { Pt } from "./geom.ts";

export type V3 = [number, number, number];

export interface Chave {
  /** segundos desde o início */
  t: number;
  pos: V3;
  alvo: V3;
  /** lente: abertura vertical (graus) e tilt-shift 0..1 */
  fov?: number;
  tilt?: number;
  /** folga mínima sobre o chão (m); sobre a rua o drone desce mais (não há casa) */
  folga?: number;
  /** a câmera chega (ou sai) parada nesta chave: velocidade zero */
  parada?: boolean;
}

export interface Legenda {
  t0: number;
  t1: number;
  titulo: string;
  texto: string;
  /** capítulo do filme ("01", "02"…) */
  capitulo: string;
}

export interface Roteiro {
  chaves: Chave[];
  legendas: Legenda[];
  duracao: number;
  /** janela (s) da transformação hoje → projeto, se houver abertura */
  transformacao?: [number, number];
  /** janela (s) do voo propriamente dito (o timelapse do sol corre nela) */
  voo: [number, number];
}

export interface MundoRoteiro {
  res: Resultado;
  cena: Cena;
  raio: number;
  xz: (p: Pt) => [number, number];
  /** altura do chão no mundo (projeto pronto) */
  chao: (p: Pt) => number;
  /** proporção da tela (largura/altura): no celular em pé a câmera abre mais */
  aspecto: number;
}

const passo = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Velocidade do drone dentro da rua (m/s) e altura da câmera sobre o asfalto (m). */
const VEL_RUA = 10;
const ALT_RUA = 5.2;
/** Folga mínima no ar (as casas têm até ~7,5 m). */
const FOLGA_AR = 9;

/** Monta o roteiro. `abertura`: começa no terreno de hoje com a transformação (a apresentação e o vídeo). */
export function roteiroDoVoo(m: MundoRoteiro, abertura: boolean): Roteiro {
  const { res, cena, raio: R } = m;
  const W = (p: Pt, h: number): V3 => { const [x, z] = m.xz(p); return [x, m.chao(p) + h, z]; };
  const yC = m.chao(cena.centro);
  const C: V3 = [0, yC, 0];
  const longe = m.aspecto < 0.8 ? 1.5 : 1;
  const orbita = (az: number, dist0: number, elev: number): V3 => {
    const d = dist0 * longe;
    return [Math.sin(az) * Math.cos(elev) * d, yC + Math.sin(elev) * d, Math.cos(az) * Math.cos(elev) * d];
  };
  const chaves: Chave[] = [];
  const legendas: Legenda[] = [];
  let t = 0;
  /** lente da próxima chave (vale até mudar) */
  let lente: { fov: number; tilt: number; folga?: number } = { fov: 38, tilt: 0.45 };
  const por = (pos: V3, alvo: V3, segundos: number, parada = false) => { t += segundos; chaves.push({ t, pos, alvo, ...lente, parada }); };
  /** trecho com a velocidade de um drone (m/s), com tempo mínimo */
  const voar = (pos: V3, alvo: V3, vel: number, min = 2.5) => {
    const ult = chaves[chaves.length - 1];
    por(pos, alvo, Math.max(min, ult ? passo(ult.pos, pos) / vel : 0));
  };
  /** legenda a partir de `t` (sem encavalar com a anterior) */
  const legenda = (titulo: string, texto: string, dur: number, atraso = 0.6) => {
    const ant = legendas[legendas.length - 1];
    const t0 = Math.max(t + atraso, ant ? ant.t1 + 0.3 : 0);
    legendas.push({ t0, t1: t0 + dur, titulo, texto, capitulo: String(legendas.length + 1).padStart(2, "0") });
  };
  const ultPos = () => chaves[chaves.length - 1].pos;

  // --- 1. abertura: alto, o terreno de hoje vira o projeto
  let transformacao: [number, number] | undefined;
  if (abertura) {
    chaves.push({ t: 0, pos: orbita(-2.55, R * 2.5, 0.66), alvo: C, ...lente, parada: true });
    por(orbita(-2.05, R * 2.2, 0.6), C, 6);
    transformacao = [1.2, 8.2];
    por(orbita(-1.55, R * 1.85, 0.52), C, 4.5);
  } else {
    chaves.push({ t: 0, pos: orbita(-1.9, R * 2.1, 0.58), alvo: C, ...lente, parada: true });
    por(orbita(-1.5, R * 1.8, 0.5), C, 3);
  }
  const inicioVoo = t;
  const lotes = res.lotes;
  if (lotes.length) {
    const areas = lotes.map((l) => l.area).sort((a, b) => a - b);
    legenda(`${lotes.length} lotes`, `de ${fmt(areas[0], 0)} a ${fmt(areas[areas.length - 1], 0)} m² · ${res.quadras.length} quadras · ${fmt(res.quadro.gleba / 1e4, 2)} ha`, 4.2);
  }

  // --- 2. passeio pelas ruas: a rua de entrada, virando nas esquinas, com paradas nas casas
  const nos = cruzamentos(res.ruas);
  const usadas = new Set<number>();
  const casasVistas = new Set<number>();
  const entrada = ruaDeEntrada(res);
  if (entrada) {
    const rota = percurso(res.ruas, nos, entrada, 250, usadas);
    passear(rota, true, 2);
  }

  // --- 3. sobe para a maior área verde: órbita baixa com as árvores
  const verdes = res.areas.filter((x) => (x.tipo === "verde" || x.tipo === "lazer") && x.area > 500)
    .flatMap((x) => x.pols.map((pol) => ({ pol, area: areaPol(pol) }))).sort((a, b) => b.area - a.area);
  const verde = verdes[0];
  if (verde) {
    const c = centroide(verde.pol.ext);
    const rg = Math.min(70, Math.sqrt(verde.area / Math.PI));
    const arvs = cena.arvores.filter((x) => dentroPol(x.p, verde.pol)).length;
    const [cx, cz] = m.xz(c);
    const a0 = Math.atan2(ultPos()[0] - cx, ultPos()[2] - cz);
    const pt = (a: number, d: number, h: number): V3 => { const p: Pt = [c[0] + Math.sin(a) * d, c[1] - Math.cos(a) * d]; return W(p, h); };
    const alvo = W(c, 2);
    lente = { fov: 38, tilt: 0.5 };
    voar(pt(a0, rg + 38, 30), alvo, 55, 3.2);
    legenda("Área verde", `${fmt(verde.area, 0)} m²${arvs ? ` · ${arvs} árvores` : ""} · praça e passeio para os moradores`, 6.5);
    por(pt(a0 + 0.9, rg + 30, 22), alvo, 3.4);
    por(pt(a0 + 1.8, rg + 34, 26), alvo, 3.4);
  }

  // --- 4. desce em outra rua (a mais longa que ainda não passou, pela ponta mais perto)
  const segunda = proximaRua(res.ruas, usadas, ultPos(), m);
  if (segunda) {
    const rota = percurso(res.ruas, nos, segunda, 170, usadas);
    passear(rota, false, 1);
  }

  // --- 5. o prédio institucional: passa por cima
  const inst = cena.casas.find((x) => x.telhado === "laje");
  const areaInst = res.areas.filter((x) => x.tipo === "institucional").reduce((s, x) => s + x.area, 0);
  if (inst) {
    const [ix, iz] = m.xz(inst.c);
    const ang = Math.atan2(ultPos()[0] - ix, ultPos()[2] - iz);
    const pt = (a: number, d: number, h: number): V3 => W([inst.c[0] + Math.sin(a) * d, inst.c[1] - Math.cos(a) * d], h);
    const alvo = W(inst.c, 6);
    lente = { fov: 38, tilt: 0.45 };
    voar(pt(ang, 70, 34), alvo, 55, 3.2);
    legenda("Área institucional", `${fmt(areaInst, 0)} m² reservados para escola, creche ou posto de saúde`, 5.5);
    por(pt(ang + 1.2, 58, 30), alvo, 3.8);
  }

  // --- 6. o miolo: vista zenital girando devagar sobre a quadra mais central (efeito maquete)
  const qd = [...res.quadras].filter((x) => x.lotes.length >= 4)
    .sort((a, b) => dist(a.centro, cena.centro) - dist(b.centro, cena.centro))[0];
  if (qd) {
    const c = qd.centro;
    const [qx, qz] = m.xz(c);
    const ang = Math.atan2(ultPos()[0] - qx, ultPos()[2] - qz);
    const pt = (a: number, d: number, h: number): V3 => W([c[0] + Math.sin(a) * d, c[1] - Math.cos(a) * d], h);
    const alto = Math.max(95, Math.sqrt(qd.lotes.reduce((s2, l) => s2 + l.area, 0)) * 1.25);
    lente = { fov: 36, tilt: 0.9 };
    // a câmera chega quase na vertical (3 m de desvio: o "para cima" da tela gira com ele)
    voar(pt(ang, 3, alto), W(c, 0), 50, 3.2);
    const frentes = qd.lotes.map((l) => l.frente).sort((a, b) => a - b);
    legenda(`Quadra ${qd.nome}`, `${qd.lotes.length} lotes · frente de ${fmt(frentes[Math.floor(frentes.length / 2)], 0)} m · casas simuladas com recuo de 4 m`, 6);
    por(pt(ang + 0.35, 2.5, alto * 0.92), W(c, 0), 3.4);
    por(pt(ang + 0.7, 2.5, alto * 0.86), W(c, 0), 3.4);
  }

  // --- 7. sobe para a vista geral e respira
  const azF = Math.atan2(ultPos()[0], ultPos()[2]) + 0.6;
  lente = { fov: 36, tilt: 0.55 };
  voar(orbita(azF, R * 1.9, 0.62), C, 55, 4.5);
  const fimVoo = t;
  // respiro final: a câmera para devagar enquanto as luzes acendem (lente de volta à normal)
  lente = { fov: 42, tilt: 0.4 };
  por(orbita(azF + 0.3, R * 2.0, 0.64), C, 6, true);

  // folga sobre o chão em todo o caminho. A curva entre as chaves pode afundar,
  // então mede-se a curva (a folga exigida vai de uma chave à outra)
  const chaoMundo = (x: number, z: number) => m.chao([x + cena.centro[0], -z + cena.centro[1]]);
  for (const k of chaves) k.pos[1] = Math.max(k.pos[1], chaoMundo(k.pos[0], k.pos[2]) + (k.folga ?? FOLGA_AR));
  const rot: Roteiro = { chaves, legendas, duracao: t, transformacao, voo: [inicioVoo, fimVoo] };
  for (let volta = 0; volta < 6; volta++) {
    let mexeu = false;
    for (let i = 0; i + 1 < chaves.length; i++) {
      const f0 = chaves[i].folga ?? FOLGA_AR, f1 = chaves[i + 1].folga ?? FOLGA_AR;
      let falta = 0;
      for (let s = 1; s < 24; s++) {
        const tt = chaves[i].t + ((chaves[i + 1].t - chaves[i].t) * s) / 24;
        const p = camNoTempo(rot, tt).pos;
        falta = Math.max(falta, chaoMundo(p[0], p[2]) + f0 + ((f1 - f0) * s) / 24 - p[1]);
      }
      if (falta > 0.05) { chaves[i].pos[1] += falta + 0.3; chaves[i + 1].pos[1] += falta + 0.3; mexeu = true; }
    }
    if (!mexeu) break;
  }
  return rot;

  /**
   * Passeio dentro da rota: o drone desce no começo, corre pelo eixo a 5 m do
   * asfalto olhando adiante (vira junto nas esquinas), para em `nParadas`
   * casas (encosta do outro lado da pista e vira para a fachada) e sobe no fim.
   */
  function passear(rota: Rota, primeira: boolean, nParadas: number): void {
    const L = comprimento(rota.pts);
    if (L < 40) return;
    const larg = rota.largura;
    // ponto da rota (d fora de [0, L] continua reto pela ponta), com desvio lateral (+ = esquerda)
    const P = (d: number, h: number, lat = 0): V3 => {
      const dd = Math.max(0, Math.min(L, d));
      const { pt, dir } = pontoNaPolilinha(rota.pts, dd);
      const ex = d - dd;
      return W([pt[0] + dir[0] * ex - dir[1] * lat, pt[1] + dir[1] * ex + dir[0] * lat], h);
    };
    const adiante = (d: number) => P(d + 26, 1.4);
    // paradas: casas com a fachada para a rota, uma em cada trecho
    const ps: { s: number; lado: number; casa: CasaDaCena }[] = [];
    for (let i = 0; i < nParadas; i++) {
      const a = 45 + ((L - 75) * i) / nParadas, b = 45 + ((L - 75) * (i + 1)) / nParadas;
      const c = casaNaRua(cena, rota.pts, larg, a, b - 20, casasVistas);
      if (c) { ps.push(c); casasVistas.add(c.casa.lote); }
    }
    // entrada: vem do alto alinhado com a rua e desce no começo dela
    lente = { fov: 44, tilt: 0.2, folga: FOLGA_AR };
    voar(P(-40, 26), P(30, 1), 60, 3.2);
    lente = { fov: 50, tilt: 0, folga: 4.5 };
    por(P(0, ALT_RUA + 1), adiante(0), 2.6);
    if (primeira) {
      const extras = [cena.arvores.length ? "calçadas arborizadas" : "calçadas", cena.postes.length ? "iluminação pública" : ""].filter(Boolean).join(" e ");
      legenda(`Ruas de ${fmt(larg, larg % 1 ? 1 : 0)} m`, `pista de ${fmt(cena.larguraPista, cena.larguraPista % 1 ? 1 : 0)} m, ${extras}`, 5.5, 0.2);
    }
    let d = 0;
    const andar = (ate: number) => {
      while (ate - d > 22) { d += 16; por(P(d, ALT_RUA), adiante(d), 16 / VEL_RUA); }
    };
    for (const pa of ps) {
      if (pa.s < d + 12) continue;
      andar(pa.s - 26);
      // freia e encosta do outro lado da pista, virando para a fachada
      // encosta um pouco do outro lado (sem entrar na copa das árvores da calçada)
      const lat = -pa.lado * larg * 0.16;
      const alvoCasa = W(pa.casa.c, 3.2);
      const sFreio = Math.max(d + 6, pa.s - 12);
      por(P(sFreio, ALT_RUA, lat * 0.6), alvoCasa, (sFreio - d) / (VEL_RUA * 0.7));
      por(P(pa.s, ALT_RUA - 0.2, lat), alvoCasa, Math.max(2.2, (pa.s - sFreio) / (VEL_RUA * 0.35)), true);
      const l = res.lotes[pa.casa.lote];
      if (l) {
        const tipo = pa.casa.andares > 1 ? "sobrado contemporâneo simulado" : "casa térrea contemporânea simulada";
        legenda(`Quadra ${l.quadra} · Lote ${l.numero}`, `${fmt(l.area, 0)} m² · frente de ${fmt(l.frente, l.frente % 1 ? 1 : 0)} m · ${tipo}`, 3.6, -0.4);
      }
      por(P(pa.s, ALT_RUA - 0.2, lat), alvoCasa, 3.4, true);
      // retoma devagar, voltando para o meio da rua e olhando adiante
      d = Math.min(L - 4, pa.s + 14);
      por(P(d, ALT_RUA, lat * 0.4), adiante(d), 14 / (VEL_RUA * 0.5));
    }
    andar(L);
    // sobe no fim da rota, seguindo em frente
    lente = { fov: 44, tilt: 0.3, folga: FOLGA_AR };
    por(P(L + 12, 24), P(L + 80, 0), 3.2);
  }
}

/** Velocidade (por segundo) da chave `i`: diferença das vizinhas no tempo; zero na parada e nas pontas. */
function velocidade(ks: Chave[], i: number, sel: (k: Chave) => V3): V3 {
  if (i <= 0 || i >= ks.length - 1 || ks[i].parada) return [0, 0, 0];
  const a = sel(ks[i - 1]), b = sel(ks[i + 1]), dt = ks[i + 1].t - ks[i - 1].t;
  return [(b[0] - a[0]) / dt, (b[1] - a[1]) / dt, (b[2] - a[2]) / dt];
}

/**
 * Posição, alvo e lente da câmera no tempo `t`. Hermite com a velocidade de
 * cada chave pelo TEMPO (trechos curtos e longos emendam sem tranco), e
 * velocidade zero nas paradas — a câmera para de verdade, sem passar do ponto.
 */
export function camNoTempo(r: Roteiro, t: number): { pos: V3; alvo: V3; fov: number; tilt: number } {
  const ks = r.chaves;
  const lenteDe = (k: Chave) => ({ fov: k.fov ?? 38, tilt: k.tilt ?? 0 });
  if (t <= ks[0].t) return { pos: [...ks[0].pos], alvo: [...ks[0].alvo], ...lenteDe(ks[0]) };
  if (t >= ks[ks.length - 1].t) { const k = ks[ks.length - 1]; return { pos: [...k.pos], alvo: [...k.alvo], ...lenteDe(k) }; }
  let i = 0;
  while (i < ks.length - 2 && t > ks[i + 1].t) i++;
  const h = ks[i + 1].t - ks[i].t;
  const f = (t - ks[i].t) / h;
  const f2 = f * f, f3 = f2 * f;
  const h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
  const herm = (sel: (k: Chave) => V3): V3 => {
    const p1 = sel(ks[i]), p2 = sel(ks[i + 1]);
    const v1 = velocidade(ks, i, sel), v2 = velocidade(ks, i + 1, sel);
    return [0, 1, 2].map((c) => h00 * p1[c] + h10 * h * v1[c] + h01 * p2[c] + h11 * h * v2[c]) as V3;
  };
  // lente: troca suave (smoothstep) entre as chaves
  const a = lenteDe(ks[i]), b = lenteDe(ks[i + 1]), e = f2 * (3 - 2 * f);
  return { pos: herm((k) => k.pos), alvo: herm((k) => k.alvo), fov: a.fov + (b.fov - a.fov) * e, tilt: a.tilt + (b.tilt - a.tilt) * e };
}

// ---------------------------------------------------------------------------
// Malha de ruas: cruzamentos, rota pelas esquinas
// ---------------------------------------------------------------------------

/** Encontro de duas ruas: posição ao longo de cada eixo (m). */
export interface No { a: number; sa: number; b: number; sb: number; p: Pt }

/** Ponto de partida de um passeio: rua, posição no eixo e sentido (+1 ou −1). */
interface Partida { rua: number; s: number; sentido: 1 | -1 }

/** Rota: a polilinha (pelos eixos, virando nos cruzamentos) e os trechos de cada rua. */
export interface Rota { pts: Pt[]; largura: number; trechos: { nome: string; d0: number; d1: number }[] }

/** Projeção de `p` no eixo: posição ao longo (s) e distância. */
function projetar(eixo: Pt[], p: Pt): { s: number; d: number } {
  let melhor = { s: 0, d: Infinity }, acc = 0;
  for (let i = 0; i + 1 < eixo.length; i++) {
    const L = dist(eixo[i], eixo[i + 1]);
    const { d, t } = distSegmento(p, eixo[i], eixo[i + 1]);
    if (d < melhor.d) melhor = { s: acc + t * L, d };
    acc += L;
  }
  return melhor;
}

/** Cruzamentos em X (eixos que se cortam) e em T (ponta de uma rua no eixo da outra). */
export function cruzamentos(ruas: RuaCalc[]): No[] {
  const nos: No[] = [];
  const junto = (a: number, b: number, p: Pt) => nos.some((n) => ((n.a === a && n.b === b) || (n.a === b && n.b === a)) && dist(n.p, p) < 8);
  for (let a = 0; a < ruas.length; a++) for (let b = a + 1; b < ruas.length; b++) {
    const A = ruas[a].eixo, B = ruas[b].eixo;
    // X: segmento com segmento
    let accA = 0;
    for (let i = 0; i + 1 < A.length; i++) {
      const LA = dist(A[i], A[i + 1]);
      let accB = 0;
      for (let j = 0; j + 1 < B.length; j++) {
        const LB = dist(B[j], B[j + 1]);
        const r: Pt = [A[i + 1][0] - A[i][0], A[i + 1][1] - A[i][1]], s: Pt = [B[j + 1][0] - B[j][0], B[j + 1][1] - B[j][1]];
        const den = r[0] * s[1] - r[1] * s[0];
        if (Math.abs(den) > 1e-9) {
          const q: Pt = [B[j][0] - A[i][0], B[j][1] - A[i][1]];
          const tA = (q[0] * s[1] - q[1] * s[0]) / den, tB = (q[0] * r[1] - q[1] * r[0]) / den;
          if (tA >= -1e-6 && tA <= 1 + 1e-6 && tB >= -1e-6 && tB <= 1 + 1e-6) {
            const p: Pt = [A[i][0] + r[0] * tA, A[i][1] + r[1] * tA];
            if (!junto(a, b, p)) nos.push({ a, sa: accA + tA * LA, b, sb: accB + tB * LB, p });
          }
        }
        accB += LB;
      }
      accA += LA;
    }
    // T: a ponta de uma rua encosta no eixo da outra (até meia largura + 3 m)
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const E = ruas[x].eixo, Lx = comprimento(E);
      for (const [ponta, sx] of [[E[0], 0], [E[E.length - 1], Lx]] as const) {
        const pr = projetar(ruas[y].eixo, ponta);
        if (pr.d > ruas[y].largura / 2 + 3 || junto(a, b, ponta)) continue;
        nos.push(x === a ? { a, sa: sx, b, sb: pr.s, p: ponta } : { a, sa: pr.s, b, sb: sx, p: ponta });
      }
    }
  }
  return nos;
}

/** A rua de entrada: a mais longa que encosta na divisa, começando pela ponta da divisa. */
function ruaDeEntrada(res: Resultado): Partida | null {
  const cands = res.ruas.map((r, i) => ({ r, i, L: comprimento(r.eixo) })).filter((x) => x.L > 70).sort((a, b) => b.L - a.L);
  if (!cands.length) return null;
  const perto = (x: (typeof cands)[number]) => Math.min(distAnel(x.r.eixo[0], res.gleba.ext), distAnel(x.r.eixo[x.r.eixo.length - 1], res.gleba.ext));
  const c = cands.find((x) => perto(x) < x.r.largura) ?? cands[0];
  const a = c.r.eixo[0], b = c.r.eixo[c.r.eixo.length - 1];
  const doA = distAnel(a, res.gleba.ext) <= distAnel(b, res.gleba.ext);
  return { rua: c.i, s: doA ? Math.min(10, c.L * 0.05) : c.L - Math.min(10, c.L * 0.05), sentido: doA ? 1 : -1 };
}

/** A próxima rua para descer: a mais longa ainda não percorrida, pela ponta mais perto de onde a câmera está. */
function proximaRua(ruas: RuaCalc[], usadas: Set<number>, cam: V3, m: MundoRoteiro): Partida | null {
  const cands = ruas.map((r, i) => ({ r, i, L: comprimento(r.eixo) })).filter((x) => !usadas.has(x.i) && x.L > 90).sort((a, b) => b.L - a.L);
  const c = cands[0];
  if (!c) return null;
  const dc = (p: Pt) => { const [x, z] = m.xz(p); return Math.hypot(x - cam[0], z - cam[2]); };
  const doA = dc(c.r.eixo[0]) <= dc(c.r.eixo[c.r.eixo.length - 1]);
  return { rua: c.i, s: doA ? 8 : c.L - 8, sentido: doA ? 1 : -1 };
}

/**
 * Rota de até `alvo` metros a partir da partida: segue a rua e, passados uns
 * 70 m, vira no primeiro cruzamento com rua ainda não percorrida (para o lado
 * mais comprido dela). Para no fim da rua ou do orçamento.
 */
export function percurso(ruas: RuaCalc[], nos: No[], partida: Partida, alvo: number, usadas: Set<number>): Rota {
  const pts: Pt[] = [];
  const trechos: Rota["trechos"] = [];
  let total = 0, cur = partida, largura = ruas[partida.rua].largura;
  const juntar = (rua: number, s0: number, s1: number) => {
    const E = ruas[rua].eixo, n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / 4));
    for (let k = 0; k <= n; k++) {
      const p = pontoNaPolilinha(E, s0 + ((s1 - s0) * k) / n).pt;
      const ult = pts[pts.length - 1];
      if (!ult || dist(ult, p) > 0.5) pts.push(p);
    }
    trechos.push({ nome: ruas[rua].nome, d0: total, d1: total + Math.abs(s1 - s0) });
    total += Math.abs(s1 - s0);
  };
  for (let volta = 0; volta < 4; volta++) {
    usadas.add(cur.rua);
    largura = Math.min(largura, ruas[cur.rua].largura);
    const L = comprimento(ruas[cur.rua].eixo);
    const fim = cur.sentido > 0 ? L - 6 : 6;
    // depois de virar, anda pelo menos 60 m na rua nova (senão a virada nem aparece)
    const falta = Math.max(alvo - total, volta ? 60 : 0);
    // cruzamentos à frente, com outra rua ainda livre e comprida o bastante
    const frente = nos.flatMap((n) => (n.a === cur.rua ? [{ s: n.sa, outra: n.b, so: n.sb }] : n.b === cur.rua ? [{ s: n.sb, outra: n.a, so: n.sa }] : []))
      // a esquina do fim da rua também vale (rua que só cruza outras nas pontas)
      .filter((x) => (x.s - cur.s) * cur.sentido > 70 && (x.s - cur.s) * cur.sentido <= falta + 12 && !usadas.has(x.outra))
      .map((x) => { const Lo = comprimento(ruas[x.outra].eixo); return { ...x, resto: Math.max(x.so, Lo - x.so) }; })
      .filter((x) => x.resto > 70)
      .sort((a, b) => (a.s - cur.s) * cur.sentido - (b.s - cur.s) * cur.sentido);
    const vira = frente[0];
    if (!vira) {
      const sFim = cur.sentido > 0 ? Math.min(fim, cur.s + falta) : Math.max(fim, cur.s - falta);
      if ((sFim - cur.s) * cur.sentido > 1) juntar(cur.rua, cur.s, sFim);
      break;
    }
    juntar(cur.rua, cur.s, vira.s);
    const Lo = comprimento(ruas[vira.outra].eixo);
    cur = { rua: vira.outra, s: vira.so, sentido: Lo - vira.so >= vira.so ? 1 : -1 };
  }
  return { pts, largura, trechos };
}

type CasaDaCena = Cena["casas"][number];

/**
 * Sobrado (de preferência) com a fachada para o eixo, entre `sMin` e `sMax`
 * (m ao longo dele), sem árvore na frente e fora de `excluir` (lotes).
 * `lado`: de que lado do eixo a casa fica (+1 esquerda).
 */
export function casaNaRua(cena: Cena, eixo: Pt[], largura: number, sMin: number, sMax: number, excluir?: Set<number>): { casa: CasaDaCena; s: number; lado: number } | null {
  if (sMax <= sMin) return null;
  const L = comprimento(eixo);
  const amostras: { s: number; p: Pt; d: Pt }[] = [];
  for (let s = 0; s <= L; s += 2) { const { pt, dir } = pontoNaPolilinha(eixo, s); amostras.push({ s, p: pt, d: dir }); }
  let melhor: { casa: CasaDaCena; s: number; lado: number; nota: number } | null = null;
  const meio = (sMin + sMax) / 2;
  for (const k of cena.casas) {
    if (k.lote < 0 || excluir?.has(k.lote)) continue;
    // fachada = c − esquerda(u)·prof/2
    const fr: Pt = [k.c[0] + k.u[1] * k.prof / 2, k.c[1] - k.u[0] * k.prof / 2];
    let a = amostras[0], dm = Infinity;
    for (const x of amostras) { const d = dist(x.p, fr); if (d < dm) { dm = d; a = x; } }
    if (a.s < sMin || a.s > sMax || dm > largura / 2 + 7) continue;
    // árvore da calçada na frente da fachada taparia a casa (a câmera passa baixo)
    if (cena.arvores.some((x) => dist(x.p, fr) < Math.max(7, k.larg / 2 + 3))) continue;
    // nem poste de luz na frente (cortaria a fachada ao meio na parada)
    if (cena.postes.some((x) => dist(x.p, fr) < Math.max(8, k.larg / 2 + 4))) continue;
    // a fachada olha para o eixo: −esquerda(u) aponta para a rua
    const olha: Pt = [k.u[1], -k.u[0]];
    const para: Pt = [a.p[0] - k.c[0], a.p[1] - k.c[1]];
    if (olha[0] * para[0] + olha[1] * para[1] <= 0) continue;
    const lado = Math.sign(a.d[0] * (k.c[1] - a.p[1]) - a.d[1] * (k.c[0] - a.p[0])) || 1;
    const nota = Math.abs(a.s - meio) + (k.andares > 1 ? 0 : 60);
    if (!melhor || nota < melhor.nota) melhor = { casa: k, s: a.s, lado, nota };
  }
  return melhor && { casa: melhor.casa, s: melhor.s, lado: melhor.lado };
}

/** Legenda no ar em `t`, com a opacidade (entra e sai em 0,5 s). */
export function legendaNoTempo(r: Roteiro, t: number): { legenda: Legenda; alfa: number } | null {
  for (const l of r.legendas) {
    if (t < l.t0 || t > l.t1) continue;
    return { legenda: l, alfa: Math.min(1, (t - l.t0) / 0.5, (l.t1 - t) / 0.5) };
  }
  return null;
}
