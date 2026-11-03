// Ocupação de cada lote na maquete 3D (só dados, sem three.js, testável em node):
// muro de divisa, frente com mureta e gradil, portão da garagem e o social,
// piso da garagem até o meio-fio, caminho até a porta, jardim (arbustos), carro
// parado na garagem, piscina no quintal e o padrão de entrada de energia (onde
// o ramal do poste chega).
import type { Poligono, Pt } from "./geom.ts";
import { antiHorario, areaPol, centroide, dentroPol, dist, distSegmento, dot, esquerda, lerp, offsetPols, sub, unit } from "./geom.ts";
import type { Resultado } from "./calculo.ts";
import type { Arvore, Casa, Grade3D } from "./cena3d.ts";
import { cotaFinal, frenteDaCasa, sorteio } from "./cena3d.ts";

/** Trecho de muro sobre a divisa: `n` aponta para dentro do lote. */
export interface Muro { a: Pt; b: Pt; n: Pt; tipo: "divisa" | "frente" }
/** Vão de portão na frente (garagem: de correr; social: de abrir). */
export interface Portao { a: Pt; b: Pt; n: Pt; tipo: "garagem" | "social" }

export interface OcupacaoLote {
  /** índice da casa em cena.casas e do lote em res.lotes */
  casa: number;
  lote: number;
  /** piso da garagem: da face da casa até o meio-fio (quadrilátero) */
  entrada: Pt[];
  /** caminho do portão social até a porta (eixo; 1 m de largura) */
  caminho: [Pt, Pt] | null;
  muros: Muro[];
  portoes: Portao[];
  carro: { p: Pt; dir: Pt; z: number; cor: number; modelo: number } | null;
  piscina: { c: Pt; u: Pt; comp: number; larg: number; z: number } | null;
  /** poste do padrão de entrada (medidor) na frente: o ramal chega no topo */
  padrao: { p: Pt; n: Pt; z: number } | null;
}

export interface Ocupacao {
  lotes: OcupacaoLote[];
  /** arbustos dos jardins (tipo 3), no formato das árvores da cena */
  arbustos: Arvore[];
}

/** Cores de carro como na rua brasileira: muito branco, prata, cinza e preto. */
const CORES_CARRO = [0xf4f4f2, 0xf4f4f2, 0xf4f4f2, 0xb9bdc1, 0xb9bdc1, 0x7d8287, 0x1e2024, 0x1e2024, 0x8f1d1d, 0x23436e, 0xd9d4c7];
export const corDeCarro = (r: number): number => CORES_CARRO[Math.floor(r * CORES_CARRO.length) % CORES_CARRO.length];

const ehRua = (t: string) => t === "rua" || t === "via";

/**
 * Ocupa os lotes que receberam casa. `calcada`: largura da calçada (o piso da
 * garagem atravessa até o meio-fio, com o rebaixo da guia).
 */
export function ocuparLotes(res: Resultado, g: Grade3D, casas: Casa[], calcada: number): Ocupacao {
  const lotes: OcupacaoLote[] = [];
  const arbustos: Arvore[] = [];
  const cota = (p: Pt) => cotaFinal(g, p);
  casas.forEach((c, ci) => {
    if (c.lote < 0 || !c.garagem || !c.porta) return;
    const l = res.lotes[c.lote];
    const fr = frenteDaCasa(l);
    if (!fr) return;
    const rnd = sorteio(`ocupa-${l.id}`);
    const U = c.u, V = esquerda(U);
    const P = (a: number, b: number): Pt => [c.c[0] + U[0] * a + V[0] * b, c.c[1] + U[1] * a + V[1] * b];
    const c0 = centroide(l.pol.ext);
    const ufr = unit(sub(fr.b, fr.a));
    let nIn = esquerda(ufr);
    if (dot(sub(c0, fr.a), nIn) < 0) nIn = [-nIn[0], -nIn[1]];
    const Lf = dist(fr.a, fr.b);
    const vn = dot(V, nIn);
    if (vn < 0.25) return;
    // do ponto q andando para a rua (−V) até a linha da frente recuada `off` para fora
    const ateFrente = (q: Pt, off: number) => (dot(sub(q, fr.a), nIn) + off) / vn;
    const anda = (q: Pt, t: number): Pt => [q[0] - V[0] * t, q[1] - V[1] * t];
    const sDe = (p: Pt) => dot(sub(p, fr.a), ufr);
    const naFrente = (s: number, dentro = 0): Pt => [fr.a[0] + ufr[0] * s + nIn[0] * dentro, fr.a[1] + ufr[1] * s + nIn[1] * dentro];

    // ---- piso da garagem até o meio-fio
    const gg = c.garagem;
    const ga = (gg.a0 + gg.a1) / 2, hw = Math.min(1.6, (gg.a1 - gg.a0) / 2 - 0.1);
    const q0 = P(ga - hw, gg.b), q1 = P(ga + hw, gg.b);
    const entrada = [q0, q1, anda(q1, ateFrente(q1, calcada)), anda(q0, ateFrente(q0, calcada))];
    const f0 = anda(q0, ateFrente(q0, 0)), f1 = anda(q1, ateFrente(q1, 0));
    const sg0 = Math.min(sDe(f0), sDe(f1)) - 0.15, sg1 = Math.max(sDe(f0), sDe(f1)) + 0.15;
    const vaos: [number, number, Portao["tipo"]][] = [];
    if (sg1 > 0.3 && sg0 < Lf - 0.3) vaos.push([Math.max(0, sg0), Math.min(Lf, sg1), "garagem"]);
    // ---- portão social ao lado, do lado da porta
    const lado = Math.sign((c.porta.a - ga) * dot(U, ufr)) || 1;
    let social: [number, number] | null = null;
    for (const sd of [lado, -lado]) {
      const s0 = sd > 0 ? sg1 + 0.35 : sg0 - 1.35;
      if (s0 >= 0.4 && s0 + 1 <= Lf - 0.4) { social = [s0, s0 + 1]; break; }
    }
    if (social) vaos.push([social[0], social[1], "social"]);
    // ---- muros: a frente com os vãos dos portões, as outras divisas inteiras
    const muros: Muro[] = [], portoes: Portao[] = [];
    for (const ld of l.lados) {
      const L = dist(ld.a, ld.b);
      if (L < 0.05) continue;
      const u = unit(sub(ld.b, ld.a));
      let n = esquerda(u);
      if (dot(sub(c0, lerp(ld.a, ld.b, 0.5)), n) < 0) n = [-n[0], -n[1]];
      const tipo: Muro["tipo"] = ehRua(ld.tipo) ? "frente" : "divisa";
      const ehFr = dist(ld.a, fr.a) + dist(ld.b, fr.b) < 0.01 || dist(ld.a, fr.b) + dist(ld.b, fr.a) < 0.01;
      if (!ehFr) { muros.push({ a: ld.a, b: ld.b, n, tipo }); continue; }
      // a frente principal vai de fr.a a fr.b (s cresce de a para b)
      const cortes = vaos.slice().sort((x, y) => x[0] - y[0]);
      let s = 0;
      for (const [v0, v1, tp] of cortes) {
        if (v0 - s > 0.05) muros.push({ a: naFrente(s), b: naFrente(v0), n: nIn, tipo });
        portoes.push({ a: naFrente(v0), b: naFrente(v1), n: nIn, tipo: tp });
        s = v1;
      }
      if (Lf - s > 0.05) muros.push({ a: naFrente(s), b: naFrente(Lf), n: nIn, tipo });
    }
    // ---- caminho do portão social até a porta
    const porta = P(c.porta.a, c.porta.b - 0.2);
    const caminho: [Pt, Pt] | null = social ? [naFrente((social[0] + social[1]) / 2, 0.1), porta] : null;
    // ---- padrão de entrada: no muro, logo depois do portão social (ou da garagem)
    const sp = social ? (lado > 0 ? social[1] + 0.45 : social[0] - 0.45) : (sg1 + 0.5 <= Lf - 0.3 ? sg1 + 0.5 : sg0 - 0.5);
    const padrao = sp > 0.2 && sp < Lf - 0.2 ? { p: naFrente(sp, 0.18), n: [-nIn[0], -nIn[1]] as Pt, z: cota(naFrente(sp, 0.18)) } : null;
    // ---- carro na garagem (de frente para a casa ou de ré), se o recuo couber
    const recuo = ateFrente(P(ga, gg.b), 0);
    let carro: OcupacaoLote["carro"] = null;
    if (recuo >= 5.5 && rnd() < 0.78) {
      // meio metro de folga da parede e um pouco para o lado de fora (a porta fica livre)
      const fora = -Math.sign(c.porta.a - ga) || 1;
      const desvio = Math.max(0, Math.min(0.45, (gg.a1 - gg.a0 - 2.1) / 2));
      const p = anda(P(ga + fora * desvio, gg.b), 2.95);
      const re = rnd() < 0.35;
      carro = { p, dir: re ? [-V[0], -V[1]] : V, z: cota(p), cor: corDeCarro(rnd()), modelo: Math.floor(rnd() * 3) };
    }
    // ---- piscina no quintal (lote folgado)
    let piscina: OcupacaoLote["piscina"] = null;
    const dentro: Poligono[] = offsetPols([{ ext: antiHorario(l.pol.ext), furos: [] }], -1.1);
    const cabe = (q: Pt) => dentro.some((pg) => dentroPol(q, pg));
    if (l.area >= 240 && rnd() < 0.42) {
      const comp = Math.min(8, c.larg - 1.2), larg = comp >= 6 ? 3.5 : 3;
      if (comp >= 4) for (const folga of [1.6, 1.3]) {
        const bc = c.prof / 2 + folga + larg / 2;
        const cs = [P(-comp / 2, bc - larg / 2), P(comp / 2, bc - larg / 2), P(comp / 2, bc + larg / 2), P(-comp / 2, bc + larg / 2)];
        if (!cs.every(cabe)) continue;
        const pc = P(0, bc);
        piscina = { c: pc, u: U, comp, larg, z: Math.max(...cs.map(cota)) + 0.12 };
        break;
      }
    }
    // ---- jardim: arbustos junto ao muro da frente e na frente da fachada
    const longe = (p: Pt, r: number) => {
      if (distSegmento(p, lerp(entrada[0], entrada[1], 0.5), lerp(entrada[2], entrada[3], 0.5)).d < hw + r) return false;
      if (caminho && distSegmento(p, caminho[0], caminho[1]).d < 0.5 + r) return false;
      if (piscina && distSegmento(p, sub(piscina.c, [U[0] * piscina.comp / 2, U[1] * piscina.comp / 2]), [piscina.c[0] + U[0] * piscina.comp / 2, piscina.c[1] + U[1] * piscina.comp / 2]).d < piscina.larg / 2 + r + 0.8) return false;
      return dentroPol(p, l.pol) && distSegmento(p, fr.a, fr.b).d > 0.35;
    };
    // fora da casa (a planta da casa com uma folga)
    const foraDaCasa = (p: Pt, r: number) => {
      const rel = sub(p, c.c);
      return Math.abs(dot(rel, U)) > c.larg / 2 + r || Math.abs(dot(rel, V)) > c.prof / 2 + r;
    };
    const planta = (p: Pt, alt: number) => {
      if (!longe(p, 0.35) || !foraDaCasa(p, 0.3)) return;
      arbustos.push({ p, z: cota(p), altura: alt, copa: alt * 0.6, tipo: 3, cor: 0x4a7a35 });
    };
    // (a cerca viva podada atrás do muro da frente é desenhada pela maquete, junto do muro)
    // canteiro rente à fachada, fora da garagem e da porta
    const bF = -c.prof / 2 - 0.55;
    for (let a = -c.larg / 2 + 0.5; a < c.larg / 2 - 0.4; a += 1.15 + rnd() * 0.3) {
      if (a > gg.a0 - 0.5 && a < gg.a1 + 0.5) continue;
      if (Math.abs(a - c.porta.a) < 1.1) continue;
      planta(P(a, bF), 0.8 + rnd() * 0.6);
    }
    // um arbusto maior em cada quina do fundo
    for (const sa of [-1, 1]) if (rnd() < 0.6) planta(P(sa * (c.larg / 2 + 1.0), c.prof / 2 + 0.9), 1.5 + rnd() * 0.6);
    lotes.push({ casa: ci, lote: c.lote, entrada, caminho, muros, portoes, carro, piscina, padrao });
  });
  return { lotes, arbustos };
}

/** Área de um quadrilátero (teste e conferência). */
export const areaQuad = (q: Pt[]): number => Math.abs(areaPol({ ext: q, furos: [] }));
