// Proposta automática: lança as ruas, testa orientações e defasagens e fica
// com as que rendem mais lotes válidos. Depois reserva área verde e
// institucional onde custa menos lote.
//
// O critério é o mesmo `calcular()` da tela — o gerador não tem uma ideia
// própria do que é um lote bom.
import {
  antiHorario, areaAssinada, areaPol, caixa, centroide, dentroPol, dist, dot, esquerda, intersecao as intersecaoPols, limparAnel, mult,
  offsetPols, quinasDetalhe, recortarLinha, soma, sub, uniao, uniaoFechada, unit, verdeValida,
} from "./geom.ts";
import type { Poligono, Pt } from "./geom.ts";
import { calcular } from "./calculo.ts";
import type { Lote, Perimetro, Resultado } from "./calculo.ts";
import { criarPlano, paraPlano, paraUtm } from "./plano.ts";
import { ehAcesso, novoId } from "./modelo.ts";
import { cotaEm, declividadeEm, depressaoEm, gradeDoPerimetro } from "./terreno.ts";
import { rearranjarSelecao } from "./rearranjo.ts";
import { dividirLote, encaixarQuadraGravada, melhorEstrutura, mudarDestino, posicaoNoDesenho, unirComVizinho } from "./edicao.ts";
import type { Edicao } from "./edicao.ts";
import type { AreaDesenhada, Projeto, QuadraCfg, Rua } from "./modelo.ts";

export interface Proposta {
  titulo: string;
  angulo: number;
  ruas: Rua[];
  lotes: number;
  areaLotes: number;
  pctLotes: number;
  pctViario: number;
  /** projeto pronto (ruas + áreas reservadas) */
  projeto: Projeto;
  resultado: Resultado;
}

/** Um ponto garantidamente dentro do polígono (o centroide de um "C" cai fora). */
export function pontoInterno(pol: Poligono): Pt {
  const c = centroide(pol.ext);
  if (dentroPol(c, pol)) return c;
  const { min, max } = caixa(pol.ext);
  let melhor: Pt = c, larg = -1;
  for (let k = 1; k < 12; k++) {
    const y = min[1] + ((max[1] - min[1]) * k) / 12;
    const xs: number[] = [];
    for (const anel of [pol.ext, ...pol.furos]) {
      for (let i = 0; i < anel.length; i++) {
        const a = anel[i], b = anel[(i + 1) % anel.length];
        if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      if (xs[i + 1] - xs[i] > larg) { larg = xs[i + 1] - xs[i]; melhor = [(xs[i] + xs[i + 1]) / 2, y]; }
    }
  }
  return melhor;
}

/**
 * Âncora da config de uma quadra: dentro do MAIOR LOTE, não no meio da quadra.
 * O meio pode cair num retalho que depois vira área desenhada — a quadra
 * deixaria de conter a âncora e perderia os ajustes.
 */
export function ancoraDaQuadra(q: { pol: Poligono; lotes: { pol: Poligono; area: number }[] }): Pt {
  const maior = q.lotes.reduce<{ pol: Poligono; area: number } | null>((m, l) => (!m || l.area > m.area ? l : m), null);
  return pontoInterno(maior ? maior.pol : q.pol);
}

/** Ângulos candidatos: lados longos do perímetro, vias existentes e o retângulo mínimo. */
function angulosCandidatos(gleba: Pt[], vias: number[]): number[] {
  const lados = gleba.map((a, i) => {
    const b = gleba[(i + 1) % gleba.length];
    return { ang: Math.atan2(b[1] - a[1], b[0] - a[0]), comp: dist(a, b), i };
  });
  const angs: number[] = [];
  // estrada com muitos vértices (curva) vira muitas direções quase iguais: fica
  // só a direção dominante dela (a de maior comprimento somado)
  const pesosVia: { ang: number; peso: number }[] = [];
  for (const i of vias) {
    const a = ((lados[i].ang % Math.PI) + Math.PI) % Math.PI;
    const g = pesosVia.find((p) => Math.abs(Math.sin(p.ang - a)) < 0.12);
    if (g) g.peso += lados[i].comp; else pesosVia.push({ ang: a, peso: lados[i].comp });
  }
  pesosVia.sort((x, y) => y.peso - x.peso).slice(0, 2).forEach((x) => angs.push(x.ang));
  // agrupa lados quase paralelos: o peso de uma direção é o comprimento somado
  const pesos: { ang: number; peso: number }[] = [];
  for (const l of lados) {
    const a = ((l.ang % Math.PI) + Math.PI) % Math.PI;
    const g = pesos.find((p) => Math.abs(Math.sin(p.ang - a)) < 0.05);
    if (g) g.peso += l.comp; else pesos.push({ ang: a, peso: l.comp });
  }
  pesos.sort((a, b) => b.peso - a.peso).slice(0, 3).forEach((p) => angs.push(p.ang));
  // retângulo mínimo
  let melhor = 0, area = Infinity;
  for (const l of lados) {
    const u: Pt = [Math.cos(l.ang), Math.sin(l.ang)], v = esquerda(u);
    const us = gleba.map((p) => dot(p, u)), vs = gleba.map((p) => dot(p, v));
    const a = (Math.max(...us) - Math.min(...us)) * (Math.max(...vs) - Math.min(...vs));
    if (a < area) { area = a; melhor = l.ang; }
  }
  angs.push(melhor);
  const unicos: number[] = [];
  for (const a of angs) {
    for (const b of [a, a + Math.PI / 2]) {
      const n = ((b % Math.PI) + Math.PI) % Math.PI;
      if (!unicos.some((x) => Math.abs(Math.sin(x - n)) < 0.03)) unicos.push(n);
    }
  }
  return unicos;
}

/** Malha de ruas num ângulo, com defasagens (fy, fx) em metros. Eixos em coordenadas do plano. */
function malha(
  glebaPl: Poligono, ang: number, fy: number, fx: number, projeto: Projeto, vias: [Pt, Pt][], anel: Pt[] | null = null,
  transversais = true,
  /** malha simétrica: passo entre ruas da família (v) e entre transversais (u) que fecham a gleba exata */
  passos?: { v?: number; u?: number },
): EixoAuto[] {
  const p = projeto.params;
  const w = p.ruaLargura;
  const u: Pt = [Math.cos(ang), Math.sin(ang)], v = esquerda(u);
  const us = glebaPl.ext.map((q) => dot(q, u)), vs = glebaPl.ext.map((q) => dot(q, v));
  const u0 = Math.min(...us) - 50, u1 = Math.max(...us) + 50, v0 = Math.min(...vs), v1 = Math.max(...vs);
  const passoV = passos?.v && passos.v > w + 2 * p.profundidadeMin ? passos.v : 2 * p.profundidade + w;
  const lq = passos?.u && passos.u > w + 2 * p.frente ? passos.u - w : Math.max(p.frente * 4, Math.floor(p.quadraCompMax / p.frente) * p.frente);
  const passoU = lq + w;
  // (trava: passo que não anda deixaria os laços abaixo sem fim)
  if (!(passoV > 1) || !(passoU > 1)) return [];
  const linhas: Pt[][] = [];
  const pt = (s: number, t: number): Pt => soma(mult(u, s), mult(v, t));
  for (let t = Math.min(...vs) + fy; t < v1; t += passoV) if (t > v0) linhas.push([pt(u0, t), pt(u1, t)]);
  if (transversais && Math.max(...us) - Math.min(...us) > lq + 2 * p.profundidade) {
    for (let s = Math.min(...us) + fx; s < Math.max(...us); s += passoU) linhas.push([pt(s, v0 - 50), pt(s, v1 + 50)]);
  }
  const minimo = Math.max(p.profundidade, 2 * p.frente);
  const segs: Seg[] = [];
  if (anel) {
    // contorno: as ruas internas terminam no anel; da estrada até o anel saem os acessos
    const anelPol: Poligono = { ext: anel, furos: [] };
    // trecho do contorno que coincide com a estrada não é rua nova: é a própria estrada
    for (let i = 0; i < anel.length; i++) {
      const a = anel[i], b = anel[(i + 1) % anel.length];
      const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (vias.some(([p1, p2]) => distSegmentoAuto(m, p1, p2) < 0.5)) continue;
      // trecho sobre a própria divisa (lado paralelo à família): ali não corre rua
      const g = glebaPl.ext;
      if (g.some((g0, k) => distSegmentoAuto(m, g0, g[(k + 1) % g.length]) < 0.5)) continue;
      segs.push({ a, b, viaA: tocaVia(a, vias), viaB: tocaVia(b, vias), balao: false, anel: true, ordem: i });
    }
    for (const l of linhas) {
      for (const seg of recortarLinha(l, anelPol)) {
        const a = seg[0], b = seg[seg.length - 1];
        if (dist(a, b) < minimo) continue;
        // rua interna quase colada no contorno deixa uma quadra fina demais
        // para lote: entre as duas não cabe uma fileira
        // (mede em vários pontos: rua que cruza o contorno em diagonal passa
        // perto dele só nas pontas e é rua boa)
        let dAnel = 0;
        for (const t of [0.3, 0.5, 0.7]) {
          const m: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
          let d = Infinity;
          for (let i = 0; i < anel.length; i++) d = Math.min(d, distSegmentoAuto(m, anel[i], anel[(i + 1) % anel.length]));
          dAnel = Math.max(dAnel, d);
        }
        if (dAnel < 1.2 * p.profundidade + w) continue;
        segs.push({ a, b, viaA: tocaVia(a, vias), viaB: tocaVia(b, vias), balao: false });
      }
      if (!vias.length) continue;
      for (const seg of recortarLinha(l, glebaPl)) {
        const A = seg[0], B = seg[seg.length - 1];
        const dentro = recortarLinha([A, B], anelPol);
        if (!dentro.length) continue;
        const pri = dentro[0][0], ult = dentro[dentro.length - 1][dentro[dentro.length - 1].length - 1];
        // o pedaço de dentro pode ter vindo no sentido contrário
        const [c1, c2] = dist(A, pri) <= dist(A, ult) ? [pri, ult] : [ult, pri];
        if (tocaVia(A, vias) && dist(A, c1) > 1) segs.push({ a: A, b: c1, viaA: true, viaB: false, balao: false });
        if (tocaVia(B, vias) && dist(B, c2) > 1) segs.push({ a: c2, b: B, viaA: false, viaB: true, balao: false });
      }
    }
  } else {
    for (const l of linhas) {
      for (const seg of recortarLinha(l, glebaPl)) {
        const a = seg[0], b = seg[seg.length - 1];
        if (dist(a, b) < minimo) continue;
        segs.push({ a, b, viaA: tocaVia(a, vias), viaB: tocaVia(b, vias), balao: false });
      }
    }
  }
  const ligados = ligarAoAcesso(segs, vias, p.profundidade, w);
  const out: EixoAuto[] = [];
  // o contorno sai em trechos contínuos (some onde coincide com a estrada)
  const doAnel = ligados.filter((s) => s.anel).sort((x, y) => (x.ordem ?? 0) - (y.ordem ?? 0));
  const cadeias: Seg[][] = [];
  for (const sg of doAnel) {
    const ult = cadeias[cadeias.length - 1];
    if (ult && (ult[ult.length - 1].ordem ?? -9) === (sg.ordem ?? 0) - 1) ult.push(sg); else cadeias.push([sg]);
  }
  if (anel && cadeias.length > 1 && cadeias[0][0].ordem === 0 && cadeias[cadeias.length - 1].slice(-1)[0].ordem === anel.length - 1) {
    cadeias[0] = [...cadeias.pop()!, ...cadeias[0]];
  }
  // Rabo do contorno: o trecho que passa da última rua que chega nele e morre
  // na divisa, sem saída, só tira terreno — como na planta aprovada da equipe,
  // o contorno começa na rua que chega nele e essa rua segue até a divisa (os
  // lotes da ponta ficam de frente para ela).
  const internas = ligados.filter((s) => !s.anel);
  const aparar = (pts: Pt[], noInicio: boolean): Pt[] => {
    const lin = noInicio ? [...pts].reverse() : pts;
    const acum = [0];
    for (let i = 1; i < lin.length; i++) acum.push(acum[i - 1] + dist(lin[i - 1], lin[i]));
    const total = acum[acum.length - 1];
    let jun: { pos: number; s: Seg; ponta: "a" | "b"; q: Pt } | null = null;
    for (const sg of internas) for (const ponta of ["a", "b"] as const) {
      const q = sg[ponta];
      for (let i = 0; i + 1 < lin.length; i++) {
        if (distSegmentoAuto(q, lin[i], lin[i + 1]) > 1) continue;
        const l = dist(lin[i], lin[i + 1]);
        const pos = acum[i] + (l > 0 ? Math.max(0, Math.min(l, dot(sub(q, lin[i]), unit(sub(lin[i + 1], lin[i]))))) : 0);
        if (!jun || pos > jun.pos) jun = { pos, s: sg, ponta, q };
      }
    }
    const rabo = jun ? total - jun.pos : 0;
    if (!jun || rabo < 1 || rabo > 1.5 * (2 * p.profundidade + w)) return pts;
    // a rua que chega no contorno atravessa e vai até a divisa (uma profundidade de lote)
    const outra = jun.ponta === "a" ? jun.s.b : jun.s.a;
    const d = unit(sub(jun.q, outra));
    let tMin = Infinity;
    const g = glebaPl.ext;
    for (let k = 0; k < g.length; k++) {
      const a = g[k], b = g[(k + 1) % g.length], sv = sub(b, a);
      const den = d[0] * sv[1] - d[1] * sv[0];
      if (Math.abs(den) < 1e-9) continue;
      const w0 = sub(a, jun.q);
      const t = (w0[0] * sv[1] - w0[1] * sv[0]) / den, uu = (w0[0] * d[1] - w0[1] * d[0]) / den;
      if (t > 0.5 && uu >= 0 && uu <= 1 && t < tMin) tMin = t;
    }
    if (!(tMin <= 1.5 * p.profundidade + w)) return pts;
    // corta a polilinha na junção (se sobrar menos que um trecho, fica como está)
    const out: Pt[] = [];
    for (let i = 0; i < lin.length; i++) {
      if (acum[i] < jun.pos - 1e-6) out.push(lin[i]);
      else { out.push(jun.q); break; }
    }
    if (out.length < 2 || dist(out[0], out[out.length - 1]) < 1) return pts;
    jun.s[jun.ponta] = soma(jun.q, mult(d, tMin + w));
    return noInicio ? out.reverse() : out;
  };
  for (const c of cadeias) {
    let pts: Pt[] = [c[0].a, ...c.map((x) => x.b)];
    const fechado = anel !== null && c.length === anel.length;
    if (!fechado) {
      if (!c[0].viaA) pts = aparar(pts, true);
      if (!c[c.length - 1].viaB) pts = aparar(pts, false);
      // ponta que sai na estrada atravessa a divisa (corte limpo)
      if (c[0].viaA) pts.unshift(soma(pts[0], mult(unit(sub(pts[0], pts[1])), w)));
      if (c[c.length - 1].viaB) { const k = pts.length; pts.push(soma(pts[k - 1], mult(unit(sub(pts[k - 1], pts[k - 2])), w))); }
    }
    out.push({ eixo: pts });
  }
  for (const s of ligados) {
    if (s.anel) continue;
    const d = unit(sub(s.b, s.a));
    // só a ponta que sai na estrada atravessa a divisa (corte limpo no perímetro)
    out.push({
      eixo: [s.viaA ? soma(s.a, mult(d, -w)) : s.a, s.viaB ? soma(s.b, mult(d, w)) : s.b],
      balao: s.balao ? Math.max(w * 0.75, 9) : undefined,
    });
  }
  return out;
}

/**
 * Rua de contorno: paralela ao perímetro, a uma profundidade de lote das
 * divisas (os lotes da beirada ficam todos com o fundo na divisa e a mesma
 * profundidade) e a duas da estrada (quadra de duas fileiras entre a estrada e
 * o contorno). APP/faixa non aedificandi entram na distância.
 */
export function anelInterno(ptsPl: Pt[], distancias: number[], glebaPl: Poligono, cortarAgudo = 0): Pt[] | null {
  let pts = ptsPl, ds = distancias;
  const n = pts.length;
  if (areaAssinada(pts) < 0) {
    pts = [...ptsPl].reverse();
    ds = pts.map((_, j) => distancias[(n - 2 - j + n) % n]);
  }
  const linhas = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const d = unit(sub(b, a));
    const nrm = esquerda(d);
    return { p: soma(a, mult(nrm, ds[i])), d };
  });
  const vert: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const l0 = linhas[(i - 1 + n) % n], l1 = linhas[i];
    const den = l0.d[0] * l1.d[1] - l0.d[1] * l1.d[0];
    if (Math.abs(den) < 0.08) { vert.push(l1.p); continue; } // lados quase alinhados
    const w0 = sub(l1.p, l0.p);
    const t = (w0[0] * l1.d[1] - w0[1] * l1.d[0]) / den;
    vert.push(soma(l0.p, mult(l0.d, t)));
  }
  let limpo = intersecaoAnel(vert, glebaPl);
  if (!limpo) return null;
  // Canto muito agudo (ponta da gleba): as duas ruas de contorno se
  // encontrariam longe da ponta e deixariam uma cunha enorme sem frente. O
  // encontro é antecipado com um trecho de rua de `cortarAgudo` metros — a
  // cunha que sobra cabe em lotes de ponta (como nas plantas da equipe).
  if (cortarAgudo > 0) {
    const n2 = limpo.length;
    const novo: Pt[] = [];
    for (let i = 0; i < n2; i++) {
      const V = limpo[i], A = limpo[(i - 1 + n2) % n2], B = limpo[(i + 1) % n2];
      const dA = unit(sub(A, V)), dB = unit(sub(B, V));
      const ang = Math.acos(Math.max(-1, Math.min(1, dot(dA, dB))));
      const convexo = (B[0] - V[0]) * (A[1] - V[1]) - (B[1] - V[1]) * (A[0] - V[0]) < 0;
      if (ang > (55 * Math.PI) / 180 || !convexo) { novo.push(V); continue; }
      const sCorte = Math.min(cortarAgudo / (2 * Math.sin(ang / 2)), 0.45 * dist(A, V), 0.45 * dist(B, V));
      novo.push(soma(V, mult(dA, sCorte)), soma(V, mult(dB, sCorte)));
    }
    limpo = novo;
  }
  const a = Math.abs(areaAssinada(limpo));
  if (a < 0.2 * Math.abs(areaAssinada(glebaPl.ext))) return null;
  return limpo;
}

/** Limpa o anel (laço de canto côncavo) e fica com a maior parte dentro da gleba. */
function intersecaoAnel(vert: Pt[], glebaPl: Poligono): Pt[] | null {
  const partes = intersecaoPols([{ ext: antiHorario(vert), furos: [] }], [glebaPl]);
  if (!partes.length) return null;
  const maior = partes.reduce((m, x) => (Math.abs(areaAssinada(x.ext)) > Math.abs(areaAssinada(m.ext)) ? x : m), partes[0]);
  return limparAnel(maior.ext, 0.5);
}

interface Seg { a: Pt; b: Pt; viaA: boolean; viaB: boolean; balao: boolean; anel?: boolean; ordem?: number }
export interface EixoAuto { eixo: Pt[]; balao?: number }

const tocaVia = (p: Pt, vias: [Pt, Pt][]) => vias.some(([a, b]) => distSegmentoAuto(p, a, b) < 1);

function distSegmentoAuto(p: Pt, a: Pt, b: Pt): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]);
}

/** Parâmetro t (0..1) em que o segmento s cruza (ou recebe a ponta de) o segmento o. */
function cruzamentos(s: Seg, o: Seg): number[] {
  const r = sub(s.b, s.a), q = sub(o.b, o.a);
  const den = r[0] * q[1] - r[1] * q[0];
  const out: number[] = [];
  if (Math.abs(den) > 1e-9) {
    const w0 = sub(o.a, s.a);
    const t = (w0[0] * q[1] - w0[1] * q[0]) / den;
    const uu = (w0[0] * r[1] - w0[1] * r[0]) / den;
    if (t > -1e-6 && t < 1 + 1e-6 && uu > -0.02 && uu < 1.02) out.push(Math.max(0, Math.min(1, t)));
  }
  return out;
}

/**
 * Rua só chega ao perímetro onde há acesso (estrada existente). Na divisa com
 * vizinho, no rio ou na rodovia ela tem de terminar num cruzamento com outra
 * rua — abrir rua contra a terra do vizinho é rua para lugar nenhum. Ramal que
 * sai da estrada e não cruza nada termina em balão, uma quadra antes da divisa.
 * Por fim, só fica a malha ligada a um acesso.
 */
function ligarAoAcesso(segs0: Seg[], vias: [Pt, Pt][], prof: number, w: number): Seg[] {
  let segs = segs0.map((s) => ({ ...s }));
  for (let passe = 0; passe < 6; passe++) {
    let mudou = false;
    const novos: Seg[] = [];
    for (const s of segs) {
      if (s.anel) { novos.push(s); continue; }
      const comp = dist(s.a, s.b);
      // cruzamentos, inclusive na ponta (rua que já termina num cruzamento está certa)
      const ts = segs.filter((o) => o !== s).flatMap((o) => cruzamentos(s, o));
      let a = s.a, b = s.b, viaA = s.viaA, viaB = s.viaB, balao = s.balao;
      const pt = (t: number): Pt => [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
      if (!viaB) {
        const fim = ts.length ? Math.max(...ts) : null;
        if (fim !== null && (1 - fim) * comp > 0.5) { b = pt(fim); mudou = true; }
        else if (fim === null) {
          if (!viaA) { mudou = true; continue; } // não toca acesso nem cruza nada
          const t = (comp - prof - w / 2) / comp;
          if (t * comp < prof) { mudou = true; continue; }
          if (!balao) { b = pt(t); balao = true; mudou = true; }
        }
      }
      if (!viaA) {
        const ini = ts.length ? Math.min(...ts) : null;
        if (ini !== null && ini * comp > 0.5) { a = pt(ini); mudou = true; }
        else if (ini === null) {
          if (!viaB) { mudou = true; continue; }
          const t = (prof + w / 2) / comp;
          if ((1 - t) * comp < prof) { mudou = true; continue; }
          if (!balao) { a = b; b = pt(t); viaA = true; viaB = false; balao = true; mudou = true; }
        }
      }
      if (dist(a, b) < w) { mudou = true; continue; }
      novos.push({ a, b, viaA, viaB, balao, anel: false });
    }
    segs = novos;
    if (!mudou) break;
  }
  if (!vias.length || !segs.length) return segs;
  // só a malha ligada a algum acesso
  const pai = segs.map((_, i) => i);
  const raiz = (i: number): number => (pai[i] === i ? i : (pai[i] = raiz(pai[i])));
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const ci = cruzamentos(segs[i], segs[j]);
      const toca = ci.length || [segs[j].a, segs[j].b].some((q) => distSegmentoAuto(q, segs[i].a, segs[i].b) < 0.6);
      if (toca) pai[raiz(i)] = raiz(j);
    }
  }
  const comAcesso = new Set(segs.map((s, i) => (s.viaA || s.viaB ? raiz(i) : -1)).filter((x) => x >= 0));
  return segs.filter((_, i) => comAcesso.has(raiz(i)));
}

export interface OpcoesGerar {
  /** devolve até N propostas distintas (por ângulo), da melhor para a pior */
  quantas?: number;
  /** força o ângulo (radianos, no plano) */
  angulo?: number;
  /** reservar área verde/institucional automaticamente */
  reservarAreas?: boolean;
  /** quadras de duas fileiras já saem fundo com fundo pela linha central (padrão: sim) */
  estruturar?: boolean;
}

/**
 * A planta já sai ajustada: cada quadra de duas fileiras é refeita pela linha
 * central (fundo com fundo, laterais no esquadro da rua, áreas iguais). Fica a
 * que não perde lote e não ganha aviso; as outras continuam como o gerador fez.
 */
export function estruturarQuadras(pr0: Projeto, perimetro: Perimetro): Projeto {
  let pr = pr0;
  let res = calcular(pr, perimetro);
  const nomes = res.quadras.filter((q) => q.fileiras >= 2 && q.lotes.length >= 4 && !q.estruturada).map((q) => q.nome);
  const calc = (p: Projeto) => calcular(p, perimetro);
  for (const nome of nomes) {
    const q = res.quadras.find((x) => x.nome === nome);
    if (!q) continue;
    const cfg0: QuadraCfg | undefined = q.cfg >= 0 ? pr.quadras[q.cfg] : undefined;
    if (cfg0 && (cfg0.lotes || cfg0.destino || cfg0.estrutura)) continue;
    // o mesmo "Ajustar fundo com fundo" da prancheta: quantidade atual, ±1, esquina
    // absorvendo ou todos iguais; fica o arranjo que não perde lote nem ganha aviso
    const m = melhorEstrutura(pr, res, q, calc, { rapido: true });
    if (!m || m.avisosDepois > m.avisosAntes) continue;
    // grava a linha que o cálculo escolheu (o recálculo repete o arranjo, rápido)
    pr = m.pr;
    res = m.r;
  }
  return pr;
}

export function gerarPropostas(base: Projeto, perimetro: Perimetro, op: OpcoesGerar = {}): Proposta[] {
  const p = base.params;
  const plano = criarPlano(perimetro.pts, perimetro.altitudes, p.distanciasTerreno);
  const ptsPl = perimetro.pts.map((q) => paraPlano(plano, q));
  const glebaPl: Poligono = { ext: antiHorario(ptsPl), furos: [] };
  const vias = base.bordas.map((b, i) => (ehAcesso(b.tipo) ? i : -1)).filter((i) => i >= 0);
  const viasPl: [Pt, Pt][] = vias.map((i) => [ptsPl[i], ptsPl[(i + 1) % ptsPl.length]]);
  const angs = op.angulo !== undefined ? [op.angulo] : angulosCandidatos(ptsPl, vias);

  const w = p.ruaLargura;
  const passoV = 2 * p.profundidade + w;
  const lq = Math.max(p.frente * 4, Math.floor(p.quadraCompMax / p.frente) * p.frente);
  const passoU = lq + w;

  const montar = (eixos: EixoAuto[]): Projeto => ({
    ...base,
    ruas: [
      ...base.ruas.filter((r) => r.id.startsWith("m")), // ruas desenhadas à mão ficam
      ...eixos.map((e, i) => ({ id: `a${i}`, nome: `Rua ${String(i + 1).padStart(2, "0")}`, largura: w, eixo: e.eixo.map((q) => paraUtm(plano, q)), ...(e.balao ? { balao: e.balao } : {}) })),
    ],
    quadras: [],
    areas: base.areas.filter((a) => !a.id.startsWith("auto")),
  });
  // lotes válidos; quadra acima do comprimento máximo custa caro (a prefeitura devolve)
  // direções das divisas sem acesso (a equipe orienta as ruas por elas)
  const dirDivisas = ptsPl.map((a, i) => {
    const b = ptsPl[(i + 1) % ptsPl.length];
    return { ang: Math.atan2(b[1] - a[1], b[0] - a[0]), comp: dist(a, b), acesso: ehAcesso(base.bordas[i]?.tipo ?? "divisa") };
  }).filter((x) => !x.acesso);
  const compDivisas = dirDivisas.reduce((s2, x) => s2 + x.comp, 0);
  const nota = (r: Resultado, tr = true, ang = 0) => {
    // lote válido conta 1; lote acima da área máxima (a faixa comprida da
    // beirada, que ninguém quer comprar) conta meio; terra sem frente (sobra)
    // desconta o que renderia em lotes
    const padrao = p.areaPadrao;
    let n = 0, a = 0;
    for (const l of r.lotes) if (l.area >= p.areaMin - 0.01) { n += l.area > p.areaMax + 0.5 ? 0.5 : 1; a += l.area; }
    // lote que sai com pendência (o lote-tira de 130 m de fundo na beirada, a frente de
    // 3 m na ponta): a planta que o tem perde para a que não tem, mesmo com um lote a menos
    n -= 2 * r.lotes.filter((l) => l.problemas.length).length;
    // terra sem destino pesa mais que o lote que renderia: a malha que deixa
    // área rosa perde para a que aproveita a gleba
    n -= 2.5 * r.quadro.sobras / padrao;
    // lote fora das faixas (fundo demais, largo demais) ou torto: a malha que
    // o produz perde para a que dá lotes harmônicos, mesmo com um lote a menos
    n -= 3 * r.desarmonicos;
    // quadra longa: tolera um pouco (a planta aprovada tem 250 m), cobra caro
    // quanto mais passa — quadra de 600 m não é quadra. Faixa da beirada
    // (lindeira à divisa) não conta: ali a rua não pode cortar até a divisa.
    let longas = 0;
    for (const q of r.quadras) {
      const us = q.pol.ext.map((x) => dot(sub(x, q.origem), q.u));
      const comp = Math.max(...us) - Math.min(...us);
      if (comp <= p.quadraCompMax + 1) continue;
      const beirada = q.fileiras <= 1 && q.lotes.length > 0 && q.lotes.every((l) => l.fileira === 0);
      // (26/11: passar do máximo do projeto é aviso na planta — custa como uns 5 lotes, mais se passar muito)
      if (!beirada) longas += 5 + 12 * (comp / p.quadraCompMax - 1);
    }
    // quadra longa desconta, mas pouco: a planta aprovada da equipe tem quadra
    // de 250 m; o que não pode é perder lote para cumprir isso à força
    // cada rua que chega na estrada é um acesso a mais (circulação, como nas
    // plantas aprovadas: as ruas internas saem do contorno e vão até a estrada)
    let acessos = 0, semSaida = 0;
    for (const ru of r.ruas) {
      if (ru.eixo.length > 2) continue; // o contorno não conta
      if ([ru.eixo[0], ru.eixo[ru.eixo.length - 1]].some((ponta) => viasPl.some(([q1, q2]) => distSegmentoAuto(ponta, q1, q2) < ru.largura + 1))) acessos++;
      else if (viasPl.length) semSaida++; // rua interna que só liga contorno com contorno
    }
    acessos -= 0.75 * semSaida;
    // quadrinha (menos de 6 lotes) é sinal de rua cruzando no lugar errado — e
    // na ponta da gleba ela vira triângulo: pesa mais que o par de lotes que rende
    const pequenas = r.quadras.filter((q) => q.lotes.length > 0 && q.lotes.length < 6).length;
    // a lógica das plantas aprovadas: UMA família de ruas, paralela a uma
    // divisa, do contorno até a estrada, sem cruzamento no meio da quadra
    const umaFamilia = tr ? 0 : 6;
    const paraleloDivisa = dirDivisas.filter((x) => Math.abs(Math.sin(x.ang - ang)) < 0.06).reduce((s2, x) => s2 + x.comp, 0);
    const orientacao = compDivisas ? 6 * Math.min(1, paraleloDivisa / (0.25 * compDivisas)) : 0;
    return n - 3 * longas - 5 * pequenas + 4 * acessos + umaFamilia + orientacao - harmonia(r) + a / 1e7;
  };
  /**
   * Desarmonia visível (pedido do Wilker, 25/11: "simetria, projeto harmônico, lotes bem
   * distribuídos"): lote muito maior ou menor que o padrão, lote em diagonal (divisas
   * fora do esquadro da rua) e quadras de tamanhos desencontrados custam na nota — a
   * malha que dá 4 lotes a mais e um mosaico torto perde para a que fica regular.
   */
  const harmonia = (r: Resultado): number => {
    let custo = 0;
    for (const l of r.lotes) {
      // o "lote" de vários mil m² (a cunha inteira que nada dividiu) é terra perdida, como a sobra
      if (l.area > p.areaMax * 1.03) custo += (2.5 * (l.area - p.areaMax)) / p.areaPadrao;
      if (l.angCorte !== undefined && Math.abs(90 - l.angCorte) > 12) custo += 0.4;
      // esquina e ponta são maiores de propósito (absorvem a curva e a divisa torta)
      if (l.esquina || l.ponta) continue;
      const dev = Math.abs(l.area - p.areaPadrao) / p.areaPadrao;
      if (dev > 0.25) custo += Math.min(0.8, 0.3 + (dev - 0.25));
    }
    // retalho que virou "canteiro" (viário) é buraco cinza no meio da quadra: terra perdida
    for (const c of r.canteiros ?? []) custo += (1.5 * areaPol(c)) / p.areaPadrao;
    // quadras de duas fileiras: comprimentos parecidos (o olho vê a malha regular)
    const comps = r.quadras.filter((q) => q.fileiras >= 2 && q.lotes.length >= 6).map((q) => q.lotes.length);
    if (comps.length >= 3) {
      const m = comps.reduce((s2, x) => s2 + x, 0) / comps.length;
      const cv = Math.sqrt(comps.reduce((s2, x) => s2 + (x - m) ** 2, 0) / comps.length) / m;
      custo += 8 * Math.max(0, cv - 0.15);
    }
    return custo;
  };
  /**
   * MALHA SIMÉTRICA: quantas quadras de duas fileiras cabem entre os extremos da
   * gleba nesta direção, com a profundidade ajustada (até ±10% do padrão) para todas
   * saírem IGUAIS — sem a faixa torta que o passo fixo deixa na última quadra. O mesmo
   * no comprimento: as transversais dividem o comprimento em quadras iguais.
   */
  const simetricas = (ang: number): { d: number; fy: number; passoV: number; passoU: number; fx: number }[] => {
    const u: Pt = [Math.cos(ang), Math.sin(ang)], v = esquerda(u);
    const vs = ptsPl.map((q) => dot(q, v)), us = ptsPl.map((q) => dot(q, u));
    const vMin = Math.min(...vs), vMax = Math.max(...vs), H = vMax - vMin;
    const uMin = Math.min(...us), uMax = Math.max(...us), U = uMax - uMin;
    // o extremo é de acesso quando a estrada corre por ele (paralela, perto da ponta)
    const ehAcessoEm = (alvo: number, eixo: Pt, perp: Pt) => base.bordas.some((b, i) => {
      if (!ehAcesso(b.tipo)) return false;
      const a0 = ptsPl[i], b0 = ptsPl[(i + 1) % ptsPl.length];
      if (dist(a0, b0) < 2 * p.frente || Math.abs(dot(unit(sub(b0, a0)), perp)) > 0.26) return false;
      return Math.abs((dot(a0, eixo) + dot(b0, eixo)) / 2 - alvo) < p.profundidade;
    });
    const c0 = ehAcessoEm(vMin, v, v) ? 2 : 1, c1 = ehAcessoEm(vMax, v, v) ? 2 : 1;
    const out: { d: number; fy: number; passoV: number; passoU: number; fx: number }[] = [];
    const dMin = Math.max(p.profundidadeMin, 0.9 * p.profundidade), dMax = Math.min(p.profundidadeMax, 1.12 * p.profundidade);
    const cands: { d: number; k: number }[] = [];
    for (let k = 0; k < 80; k++) {
      const d = (H - (k + 1) * w) / (c0 + 2 * k + c1);
      if (d < dMin - 1e-6) break;
      if (d <= dMax + 1e-6) cands.push({ d, k });
    }
    cands.sort((x, y) => Math.abs(x.d - p.profundidade) - Math.abs(y.d - p.profundidade));
    for (const { d } of cands.slice(0, 2)) {
      // comprimento: as transversais repartem o espaço entre os contornos das pontas
      const e0 = ehAcessoEm(uMin, u, u) ? 0 : d + w / 2, e1 = ehAcessoEm(uMax, u, u) ? 0 : d + w / 2;
      const Ur = U - e0 - e1;
      // gleba estreita nesta direção (as pontas comem o comprimento): sem transversais
      // simétricas — o passo negativo deixava o laço das transversais sem fim (a
      // geração estourava a memória: POR DO SOL e VITAO, 26/11/2026)
      if (!(Ur > 4 * p.frente + w)) { out.push({ d, fy: c0 * d + w / 2, passoV: 2 * d + w, passoU: 0, fx: 0 }); continue; }
      const m = Math.max(1, Math.ceil(Ur / (p.quadraCompMax + w) - 1e-9));
      const passoU = Ur / m;
      out.push({ d, fy: c0 * d + w / 2, passoV: 2 * d + w, passoU, fx: e0 + passoU });
    }
    return out;
  };

  // Rua de contorno: uma profundidade de lote da divisa (APP do rio entra na
  // conta). Na estrada NÃO há rua paralela: os lotes dão frente para ela e as
  // ruas internas saem do contorno e chegam nela — o padrão das plantas
  // aprovadas da equipe (LOTEAMENTO NOVO, out/2026).
  const distDivisa = (b: (typeof base.bordas)[number], d = p.profundidade) => d + w / 2 + (b.tipo === "rio" ? b.faixa : 0);
  const anelEstrada = anelInterno(ptsPl, base.bordas.map((b) => (ehAcesso(b.tipo) ? 0 : distDivisa(b))), glebaPl, 2 * p.profundidade);
  // Contorno seletivo — a lógica da planta aprovada da equipe (IRAN, LOTEAMENTO
  // NOVO-A1): as ruas são UMA família paralela à divisa mais longa; nas divisas
  // paralelas a ela não corre rua (a faixa da borda fica com a profundidade que
  // sobrar, lotes maiores); só na divisa que a família CRUZA corre a rua de
  // contorno, a uma profundidade de lote, e dela nascem as ruas da família, que
  // terminam na estrada. Na estrada não há rua paralela.
  const anelDaFamilia = (ang: number, d = p.profundidade) => anelInterno(ptsPl, base.bordas.map((b, i) => {
    if (ehAcesso(b.tipo)) return 0;
    const a0 = ptsPl[i], b0 = ptsPl[(i + 1) % ptsPl.length];
    const paralela = Math.abs(Math.sin(Math.atan2(b0[1] - a0[1], b0[0] - a0[0]) - ang)) < 0.34; // até 20°
    return paralela ? 0 : distDivisa(b, d);
  }), glebaPl, 2 * d);

  type Cand = { ang: number; eixos: EixoAuto[]; nota: number; tr: boolean; sim: boolean; nLotes: number; faixa?: boolean };
  const porAngulo: Cand[] = [];
  /** todas as malhas avaliadas (a 2ª e a 3ª proposta saem daqui quando a gleba só tem 1–2 direções) */
  const todos: Cand[] = [];
  for (const ang of angs) {
    const v = esquerda([Math.cos(ang), Math.sin(ang)]);
    const vMin = Math.min(...ptsPl.map((q) => dot(q, v)));
    // defasagens: a "natural" (uma fileira de lotes antes da 1ª rua) e frações do passo
    const fys = new Set<number>();
    for (let j = 0; j < 5; j++) fys.add(((p.profundidade + w / 2 + (j * passoV) / 5) % passoV));
    for (const i of vias) {
      const a = ptsPl[i], b = ptsPl[(i + 1) % ptsPl.length];
      const vv = (dot(a, v) + dot(b, v)) / 2;
      for (const s of [1, -1]) fys.add((((vv + s * (2 * p.profundidade + w / 2) - vMin) % passoV) + passoV) % passoV);
    }
    // divisa paralela à família (onde não corre rua): a 1ª rua a uma
    // profundidade de lote dela — a padrão ou quase a máxima, como a equipe fez
    // no IRAN (faixa da borda com lotes fundos até a divisa)
    base.bordas.forEach((bd, i) => {
      if (ehAcesso(bd.tipo)) return;
      const a = ptsPl[i], b = ptsPl[(i + 1) % ptsPl.length];
      if (dist(a, b) < 2 * p.frente || Math.abs(Math.sin(Math.atan2(b[1] - a[1], b[0] - a[0]) - ang)) > 0.1) return;
      const vv = (dot(a, v) + dot(b, v)) / 2;
      for (const prof of [p.profundidade, Math.max(p.profundidade, p.profundidadeMax - 4), Math.max(p.profundidade, p.profundidadeMax - 8)]) {
        for (const s of [1, -1]) fys.add(Math.round((((vv + s * (prof + w / 2) - vMin) % passoV) + passoV) % passoV));
      }
    });
    // defasagens a menos de 2 m uma da outra dão a mesma malha: fica uma
    const fysUnicas: number[] = [];
    for (const f of [...fys].sort((x, y) => x - y)) if (!fysUnicas.some((g) => Math.min(Math.abs(g - f), passoV - Math.abs(g - f)) < 2)) fysUnicas.push(f);
    let melhor: { eixos: EixoAuto[]; nota: number; res: Resultado; fy: number; anel: Pt[] | null; tr: boolean } | null = null;
    const variantes: (Pt[] | null)[] = [anelEstrada, anelDaFamilia(ang)].filter((x): x is Pt[] => !!x);
    if (!variantes.length) variantes.push(null);
    // com e sem a segunda família de ruas (a equipe costuma usar uma só: as
    // ruas saem do contorno e vão até a estrada, sem cruzamento no meio)
    for (const va of variantes) for (const tr of [true, false]) for (const fy of fysUnicas) {
      const eixos = malha(glebaPl, ang, fy, passoU / 2, base, viasPl, va, tr);
      const res = calcular(montar(eixos), perimetro, { busca: true });
      const n = nota(res, tr, ang);
      todos.push({ ang, eixos, nota: n, tr, sim: false, nLotes: res.lotes.length });
      if (!melhor || n > melhor.nota) melhor = { eixos, nota: n, res, fy, anel: va, tr };
    }
    // ajuste fino da defasagem transversal com a melhor longitudinal
    const fyMelhor = melhor!.fy;
    for (const fx of [passoU / 6, passoU / 3, (2 * passoU) / 3, (5 * passoU) / 6, 0]) {
      if (!melhor!.tr) break; // sem transversais a defasagem delas não importa
      const eixos = malha(glebaPl, ang, fyMelhor, fx, base, viasPl, melhor!.anel, true);
      const res = calcular(montar(eixos), perimetro, { busca: true });
      const n = nota(res, true, ang);
      todos.push({ ang, eixos, nota: n, tr: true, sim: false, nLotes: res.lotes.length });
      if (n > melhor!.nota) melhor = { eixos, nota: n, res, fy: fyMelhor, anel: melhor!.anel, tr: true };
    }
    const m = melhor!;
    porAngulo.push({ ang, eixos: m.eixos, nota: m.nota, tr: m.tr, sim: false, nLotes: m.res.lotes.length });
  }
  porAngulo.sort((a, b) => b.nota - a.nota);
  // malha simétrica: quadras iguais de ponta a ponta (profundidade ajustada até ±10%).
  // Só nas 4 melhores direções da busca (nas outras ela não chegaria à frente e
  // dobrava o tempo da geração).
  for (let k = 0; k < Math.min(4, porAngulo.length); k++) {
    const ang = porAngulo[k].ang;
    let melhorSim: Cand | null = null;
    for (const s of simetricas(ang)) {
      const bS: Projeto = { ...base, params: { ...p, profundidade: s.d } };
      const aneisS = [
        anelInterno(ptsPl, base.bordas.map((b) => (ehAcesso(b.tipo) ? 0 : distDivisa(b, s.d))), glebaPl, 2 * s.d),
        anelDaFamilia(ang, s.d),
      ].filter((x): x is Pt[] => !!x);
      const vars: (Pt[] | null)[] = aneisS.length ? aneisS : [null];
      for (const va of vars) for (const tr of [true, false]) {
        const eixos = malha(glebaPl, ang, s.fy, s.fx, bS, viasPl, va, tr, { v: s.passoV, u: s.passoU });
        const res = calcular(montar(eixos), perimetro, { busca: true });
        const n = nota(res, tr, ang);
        const c: Cand = { ang, eixos, nota: n, tr, sim: true, nLotes: res.lotes.length };
        todos.push(c);
        if (!melhorSim || n > melhorSim.nota) melhorSim = c;
      }
    }
    if (melhorSim && melhorSim.nota >= porAngulo[k].nota) porAngulo[k] = melhorSim;
  }
  // Faixa estreita (até ~2 quadras de largura): UMA rua ao longo do comprimento — na
  // beira (uma fileira de lotes do outro lado) ou no meio (duas fileiras). É o que a
  // equipe faz à mão nas glebas compridas (POR DO SOL, VITAO, MAURICIO); a malha com
  // contorno e transversais picava a faixa em quadrinhas de 2 a 4 lotes.
  for (let k = 0; k < porAngulo.length; k++) {
    const ang = porAngulo[k].ang;
    const u: Pt = [Math.cos(ang), Math.sin(ang)], v = esquerda(u);
    const vs = ptsPl.map((q) => dot(q, v)), us = ptsPl.map((q) => dot(q, u));
    const vMin = Math.min(...vs), vMax = Math.max(...vs), H = vMax - vMin;
    const U = Math.max(...us) - Math.min(...us);
    if (H > 2 * (2 * p.profundidadeMax + w) || U < 2 * H) continue;
    // (t: eixo; lados: beiradas da rua que dão para lote — 1 = a de cima, -1 = a de baixo)
    const posicoes: { t: number; lados: number[] }[] = [];
    // na beira: a fileira fica com o que sobra da largura (até a profundidade máxima)
    if (H - w <= p.profundidadeMax * 1.1 + 1) posicoes.push({ t: vMin + w / 2, lados: [1] }, { t: vMax - w / 2, lados: [-1] });
    // no meio: duas fileiras
    if ((H - w) / 2 >= p.profundidadeMin - 0.5 && (H - w) / 2 <= p.profundidadeMax * 1.1) posicoes.push({ t: vMin + H / 2, lados: [1, -1] });
    // a uma profundidade de uma das beiras: uma fileira de cada lado da rua
    if (H > 2 * p.profundidade + w && H - w - p.profundidade <= p.profundidadeMax * 1.1) posicoes.push({ t: vMin + p.profundidade + w / 2, lados: [1, -1] }, { t: vMax - p.profundidade - w / 2, lados: [1, -1] });
    let melhorF: Cand | null = null;
    const u0 = Math.min(...us) - 50, u1 = Math.max(...us) + 50;
    for (const { t, lados } of posicoes) {
      const linha: Pt[] = [soma(mult(u, u0), mult(v, t)), soma(mult(u, u1), mult(v, t))];
      const pedacos = recortarLinha(linha, glebaPl).sort((a, b) => dist(b[0], b[b.length - 1]) - dist(a[0], a[a.length - 1]));
      if (!pedacos.length) continue;
      const a0 = pedacos[0][0], b0 = pedacos[0][pedacos[0].length - 1];
      const d = unit(sub(b0, a0));
      // (1) a rua atravessa o perímetro nas duas pontas (corte limpo, como a das malhas);
      // (2) a rua acaba onde as DUAS beiradas dela ainda estão na gleba: na ponta
      //     inclinada da faixa o corpo da rua não corta um triângulo que viraria
      //     quadra de um lote só — ele fica com o lote da ponta
      const versoes: Pt[][] = [[soma(a0, mult(d, -w)), soma(b0, mult(d, w))]];
      const faixaU = (tt: number) => {
        const ps = recortarLinha([soma(mult(u, u0), mult(v, tt)), soma(mult(u, u1), mult(v, tt))], glebaPl)
          .map((sg) => [dot(sg[0], u), dot(sg[sg.length - 1], u)].sort((x, y) => x - y))
          .sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]));
        return ps[0] ?? null;
      };
      const es = lados.map((ld) => faixaU(t + ld * (w / 2 - 0.3)));
      if (es.every((e) => e)) {
        const s0 = Math.max(...es.map((e) => e![0])), s1 = Math.min(...es.map((e) => e![1]));
        if (s1 - s0 > 4 * p.frente) versoes.push([soma(mult(u, s0), mult(v, t)), soma(mult(u, s1), mult(v, t))]);
      }
      // ponta que não chega na estrada: rua sem saída — recua e ganha balão de retorno
      // (rua morrendo na divisa do vizinho é pendência da planta)
      const R = Math.max(w * 0.75, 9);
      const viaA = tocaVia(a0, viasPl), viaB = tocaVia(b0, viasPl);
      const comSaida: EixoAuto[] = [];
      for (const eixo of versoes) {
        if (!viasPl.length || (viaA && viaB)) comSaida.push({ eixo });
        else if (viaA) comSaida.push({ eixo: [eixo[0], soma(b0, mult(d, -(R + 1)))], balao: R });
        else if (viaB) comSaida.push({ eixo: [eixo[1], soma(a0, mult(d, R + 1))], balao: R });
      }
      for (const eixoA of comSaida) {
        const eixos: EixoAuto[] = [eixoA];
        const res = calcular(montar(eixos), perimetro, { busca: true });
        const n = nota(res, false, ang);
        const c: Cand = { ang, eixos, nota: n, tr: false, sim: false, nLotes: res.lotes.length, faixa: true };
        todos.push(c);
        if (!melhorF || n > melhorF.nota) melhorF = c;
      }
    }
    if (melhorF && melhorF.nota > porAngulo[k].nota) porAngulo[k] = melhorF;
  }
  porAngulo.sort((a, b) => b.nota - a.nota);
  // Sempre 3 propostas (pedido do Wilker): a gleba retangular só tem 2 direções — a
  // terceira é a melhor malha de outro tipo (simétrica × defasada, com × sem
  // transversais) que não repete uma já escolhida.
  const quantas0 = op.quantas ?? 3;
  const assinatura = (c: Cand) => c.eixos.map((e) => e.eixo.map((q) => `${Math.round(q[0] / 4)},${Math.round(q[1] / 4)}`).join(";")).sort().join("|");
  if (porAngulo.length < quantas0) {
    const vistos = new Set(porAngulo.map(assinatura));
    const tipos = new Set(porAngulo.map((c) => `${c.ang.toFixed(3)}|${c.sim}|${c.tr}|${!!c.faixa}`));
    const resto = todos.filter((c) => !tipos.has(`${c.ang.toFixed(3)}|${c.sim}|${c.tr}|${!!c.faixa}`)).sort((a, b) => b.nota - a.nota);
    for (const c of resto) {
      if (porAngulo.length >= quantas0) break;
      const s = assinatura(c), t = `${c.ang.toFixed(3)}|${c.sim}|${c.tr}|${!!c.faixa}`;
      if (vistos.has(s) || tipos.has(t) || !c.nLotes) continue;
      vistos.add(s); tipos.add(t);
      porAngulo.push(c);
    }
  }

  const quantas = op.quantas ?? 3;
  const props: Proposta[] = [];
  const notaFinal = new Map<Proposta, number>();
  // reservas: a busca é no cálculo rápido; no completo (linha central, áreas públicas,
  // sobras anexadas) uma malha pode desandar (o lote-cunha de 20 mil m² do IRAN). Duas
  // malhas a mais entram no cálculo completo e ficam as 3 melhores.
  const fila = porAngulo.slice(0, quantas);
  if (quantas > 1) {
    const vistos = new Set(fila.map(assinatura));
    // (as variantes da faixa estreita — rua na outra beira, no meio — vêm antes das outras reservas)
    const porNota = (a: Cand, b: Cand) => b.nota - a.nota;
    for (const c of [...porAngulo.slice(quantas), ...todos.filter((x) => x.faixa && !porAngulo.includes(x)).sort(porNota), ...todos.filter((x) => !x.faixa && !porAngulo.includes(x)).sort(porNota)]) {
      if (fila.length >= quantas + 4) break;
      const s = assinatura(c);
      if (vistos.has(s) || !c.nLotes) continue;
      vistos.add(s);
      fila.push(c);
    }
  }
  // planta ruim no cálculo completo: lote com pendência, terra sem destino ou "lote" gigante
  const ruim = (r: Resultado) => !r.lotes.length || r.problemas.some((q) => q.nivel === "erro") || r.quadro.sobras > 1 || r.lotes.some((l) => l.area > 2 * p.areaMax);
  // avisos que o operador veria na planta (lote fora das medidas, quadra longa, rua sem saída…)
  const avisosDe = (r: Resultado) => r.lotes.filter((l) => l.problemas.length).length + r.problemas.filter((q) => /^Quadra .* de comprimento/.test(q.texto) || (viasPl.length > 0 && /termina no lado/.test(q.texto)) || /sem lote|sobras sem destino|Área verde com/.test(q.texto)).length;
  // propostas iguais no resultado (malhas diferentes que dão a mesma planta) contam uma vez
  const chaveRes = (r: Resultado) => `${r.lotes.length}|${Math.round(r.quadro.lotes.area / 10)}|${r.ruas.length}|${ruim(r) ? 1 : 0}`;
  const jaTem = new Set<string>();
  let completas = 0;
  for (const c of fila) {
    // as 3 primeiras sempre; as reservas só enquanto faltar proposta distinta ou para trocar uma ruim
    if (completas >= quantas + 4 || (completas >= quantas && jaTem.size >= quantas && props.filter((x) => !ruim(x.resultado)).length >= Math.min(quantas, props.length) && props.some((x) => !avisosDe(x.resultado)))) break;
    completas++;
    let projeto = montar(c.eixos);
    projeto = nomearRuas(projeto, plano, c.ang);
    // a planta já sai ajustada: quadra de duas fileiras fundo com fundo pela linha central
    if (op.estruturar !== false) projeto = estruturarQuadras(projeto, perimetro);
    if (op.reservarAreas !== false) projeto = reservarAreas(projeto, perimetro);
    const resultado = calcular(projeto, perimetro);
    const g = resultado.quadro.gleba;
    const ch = chaveRes(resultado);
    if (jaTem.has(ch)) continue;
    jaTem.add(ch);
    props.push({
      titulo: "",
      angulo: c.ang,
      ruas: projeto.ruas,
      lotes: resultado.lotes.length,
      areaLotes: resultado.quadro.lotes.area,
      pctLotes: (100 * resultado.quadro.lotes.area) / g,
      pctViario: (100 * resultado.quadro.viario) / g,
      projeto: { ...projeto, gerado: true },
      resultado,
    });
    notaFinal.set(props[props.length - 1], nota(resultado, c.tr, c.ang));
  }
  // a ordem é a da nota no cálculo completo (lotes, terra sem uso, harmonia,
  // quadra longa) — não só a contagem: a planta com mais lotes e retalho
  // grande não vem antes da que aproveita a gleba como a equipe faria
  // planta sem pendência vem sempre antes da que tem (o operador não recebe proposta com lote vermelho na frente)
  const pend = (x: Proposta) => (ruim(x.resultado) ? 1 : 0);
  // a harmonia decide entre plantas de rendimento parecido: a que perde mais de 15% dos
  // lotes da melhor não vem na frente (o loteador não troca 50 lotes por 33 "mais bonitos")
  const maxLotes = Math.max(0, ...props.filter((x) => !pend(x)).map((x) => x.lotes));
  const rende = (x: Proposta) => (x.lotes >= 0.85 * maxLotes ? 0 : 1);
  // (26/11) entre plantas de rendimento parecido, a sem aviso nenhum (lote fora das medidas,
  // quadra acima do comprimento máximo) vem antes da que tem
  const avisos = (x: Proposta) => avisosDe(x.resultado);
  const limpa = (x: Proposta) => (avisos(x) ? 1 : 0);
  props.sort((a, b) => pend(a) - pend(b) || rende(a) - rende(b) || limpa(a) - limpa(b) || notaFinal.get(b)! - notaFinal.get(a)! || b.lotes - a.lotes);
  props.splice(quantas);
  // proposta que rende muito menos que a melhor (a malha que não abriu rua, 0 ou 1 lote) não
  // é alternativa: sai — melhor 2 propostas boas que uma terceira inútil
  const topo = Math.max(0, ...props.map((x) => x.lotes));
  for (let i = props.length - 1; i >= 0; i--) if (props.length > 1 && !props[i].lotes) props.splice(i, 1);
  for (let i = props.length - 1; i > 0; i--) if (props[i].lotes < 0.6 * topo || (pend(props[i]) && !pend(props[0]) && props[i].lotes < 0.85 * topo)) props.splice(i, 1);
  props.forEach((pr, i) => { pr.titulo = `Proposta ${String.fromCharCode(65 + i)}`; });
  return props;
}

/** Ruas longitudinais primeiro (de cima para baixo), depois as transversais. */
function nomearRuas(projeto: Projeto, plano: ReturnType<typeof criarPlano>, ang: number): Projeto {
  const u: Pt = [Math.cos(ang), Math.sin(ang)], v = esquerda(u);
  const auto = projeto.ruas.filter((r) => r.id.startsWith("a"));
  const info = auto.map((r) => {
    const e = r.eixo.map((q) => paraPlano(plano, q));
    const d = unit(sub(e[e.length - 1], e[0]));
    const longit = Math.abs(dot(d, u)) > 0.7;
    const m = mult(soma(e[0], e[e.length - 1]), 0.5);
    return { r, longit, chave: longit ? -dot(m, v) : dot(m, u) };
  });
  info.sort((a, b) => (a.longit === b.longit ? a.chave - b.chave : a.longit ? -1 : 1));
  const nomeadas = info.map((x, i) => ({ ...x.r, id: `a${i}`, nome: `Rua ${String(i + 1).padStart(2, "0")}` }));
  return { ...projeto, ruas: [...projeto.ruas.filter((r) => !r.id.startsWith("a")), ...nomeadas] };
}

export { verdeValida };

/** Já há área pública cobrindo este retalho? (evita desenhar o mesmo verde de novo) */
const coberto = (res: Resultado, s: Poligono) => {
  const pt = pontoInterno(s);
  return res.areas.some((a) => a.pols.some((pol) => dentroPol(pt, pol)));
};

/**
 * O retalho fica na metade da gleba mais afastada das estradas? Só ali ele vira
 * área verde (regra do Wilker: o verde fica no ponto mais longe das estradas); perto
 * delas o retalho é somado aos lotes vizinhos. Sem estrada, qualquer um serve.
 */
function longeDaEstrada(res: Resultado, pg: Poligono): boolean {
  const vias = res.ladosGleba.filter((l) => ehAcesso(l.tipo));
  if (!vias.length) return true;
  const dV = (q: Pt) => Math.min(...vias.map((v) => distSegmentoAuto(q, v.a, v.b)));
  const dMax = Math.max(...res.gleba.ext.map(dV));
  return dV(pontoInterno(pg)) >= 0.5 * dMax;
}

/** O lote encosta numa área verde? (verde cresce colado, num perímetro só) */
const perimetroDe = (pg: Poligono) => pg.ext.reduce((s2, q, i) => s2 + dist(q, pg.ext[(i + 1) % pg.ext.length]), 0);
/** Divide divisa (5 m ou mais) com a área verde — tocar num canto não é encostar. */
const encostaEmVerde = (res: Resultado, pol: Poligono) =>
  res.areas.some((a) => (a.tipo === "verde" || a.tipo === "lazer") && a.pols.some((v) => {
    const u = uniaoFechada([v, pol]);
    return u.length === 1 && (perimetroDe(v) + perimetroDe(pol) - perimetroDe(u[0])) / 2 >= 5;
  }));

/**
 * Reserva área verde e institucional onde custa menos lote:
 *  1. retalhos sem frente para rua viram área verde (de graça);
 *  2. falta verde: quadras com a pior relação "lote perdido ÷ área ganha";
 *  3. institucional: lotes de uma ponta da quadra mais central, até a meta.
 */
export function reservarAreas(projeto: Projeto, perimetro: Perimetro): Projeto {
  let pr: Projeto = { ...projeto, areas: projeto.areas.filter((a) => !a.id.startsWith("auto")), quadras: projeto.quadras.filter((q) => !q.destino), sobrasPublicas: [] };
  const p = pr.params;
  let res = calcular(pr, perimetro, { rapido: true });
  const plano = res.plano;
  const G = res.quadro.gleba;

  // 1. retalhos sem frente viram área verde. Repete até parar: tirar um
  //    retalho muda a quadra vizinha e pode soltar outro. Tem de acontecer
  //    ANTES das reservas por lote, que são presas à posição do lote na fileira.
  // Área verde 0% é escolha do projeto (loteamento sem área pública verde):
  // o retalho fica como área remanescente do proprietário, nunca vira verde.
  const semVerde = p.pctVerdeMin <= 0;
  for (let rodada = 0; rodada < 5 && !semVerde; rodada++) {
    const novas: AreaDesenhada[] = [];
    for (const s of uniao(res.sobras.map((x) => ({ ext: x.ext, furos: [] })))) {
      // só o retalho que é praça de verdade; nesga não é área verde
      if (!verdeValida([s]) || coberto(res, s) || !longeDaEstrada(res, s)) continue;
      novas.push({ id: novoId("autov"), tipo: "verde", nome: "", anel: s.ext.map((q) => paraUtm(plano, q)) });
    }
    if (!novas.length) break;
    pr = { ...pr, areas: [...pr.areas, ...novas] };
    res = calcular(pr, perimetro, { rapido: true });
  }

  // 1b. quadrinha (até 5 lotes) entre ruas que se cruzam em ângulo — o triângulo que
  //     sobra no canto da malha — vira PRAÇA, dentro da meta de verde: os lotes dela
  //     saem em leque, de tamanhos desencontrados, e quebram a harmonia da planta
  //     (pedido do Wilker, 25/11). Nunca a de frente para a estrada.
  const verdeAtual = () => res.quadro.verde + res.quadro.lazer;
  if (!semVerde) {
    const meta = (p.pctVerdeMin / 100) * G;
    res = calcular(pr, perimetro, { manterSobras: true });
    const cfgs = pr.quadras.map((c) => ({ ...c, ajustes: [...c.ajustes] }));
    let verde = verdeAtual(), mudou = false;
    const peq = res.quadras.filter((q) => q.lotes.length > 0 && q.lotes.length <= 5 && q.cfg < 0
      && !q.lotes.some((l) => l.lados.some((x) => x.tipo === "via")) && verdeValida([q.pol]))
      .sort((a, b) => a.area - b.area);
    for (const q of peq) {
      if (verde + q.area > 1.25 * meta) continue;
      cfgs.push({ ancora: paraUtm(plano, ancoraDaQuadra(q)), ajustes: [], destino: "verde" });
      verde += q.area;
      mudou = true;
    }
    if (mudou) { pr = { ...pr, quadras: cfgs }; res = calcular(pr, perimetro, { rapido: true }); }
  }

  // 2. área verde onde a terra vale menos: baixada, encosta íngreme, buraco,
  //    longe do acesso. Lote com frente para a estrada NUNCA vira área verde.
  let falta = (p.pctVerdeMin / 100) * G - verdeAtual();
  let quadrasCfg: QuadraCfg[] = [...pr.quadras];
  let guarda = 0;
  while (falta > 1 && guarda++ < 25) {
    res = calcular(pr, perimetro, { manterSobras: true });
    const valor = valorDosLotes(res, pr, perimetro);
    const melhor = melhorJanelaVerde(res, valor, falta);
    if (!melhor) break;
    const q = melhor.quadra;
    const cfgs = quadrasCfg.map((c) => ({ ...c, ajustes: [...c.ajustes] }));
    let c = q.cfg >= 0 ? cfgs[q.cfg] : undefined;
    if (!c) { c = { ancora: paraUtm(plano, ancoraDaQuadra(q)), ajustes: [] }; cfgs.push(c); }
    if (melhor.lotes.length === q.lotes.length) c.destino = "verde";
    else for (const l of melhor.lotes) c.ajustes.push({ fileira: l.fileira, indice: Math.floor(l.indice + 1e-9), destino: "verde" });
    quadrasCfg = cfgs;
    pr = { ...pr, quadras: quadrasCfg.slice() };
    res = calcular(pr, perimetro, { manterSobras: true }); // a meta confere no cálculo completo (o da planta)
    falta = (p.pctVerdeMin / 100) * G - verdeAtual();
  }

  // 3. institucional: lotes de uma ponta da quadra mais central
  //    (se a quadra central não basta, continua na vizinha mais próxima)
  res = calcular(pr, perimetro, { manterSobras: true }); // lotes e metas do cálculo completo (o da planta)
  let faltaInst = (p.pctInstitucionalMin / 100) * G - res.quadro.institucional;
  // o ponto mais central do terreno (o centroide; numa gleba em "L" ele cai fora: o ponto interno)
  const cg = centroide(res.gleba.ext);
  const referencia = dentroPol(cg, res.gleba) ? cg : pontoInterno(res.gleba);
  const usadas = new Set<string>();
  const dLote = (l: Resultado["lotes"][number]) => dist(centroide(l.pol.ext), referencia);
  for (let rodada = 0; faltaInst > 1 && rodada < 10; rodada++) {
    // a quadra que chega mais perto do centro; a de duas fileiras (terreno compacto,
    // o equipamento precisa de largura) ganha se estiver quase tão perto
    const perto = (q: Resultado["quadras"][number]) => Math.min(...q.lotes.map(dLote)) - (q.fileiras >= 2 ? 30 : 0);
    const ord = [...res.quadras].filter((q) => q.lotes.length >= 2 && !usadas.has(q.nome)).sort((a, b) => perto(a) - perto(b));
    const q = ord[0];
    if (!q) break;
    usadas.add(q.nome);
    // a config da quadra é UMA: se a quadra já tem ajustes (área verde), soma neles
    const cfgs = quadrasCfg.map((c) => ({ ...c, ajustes: [...c.ajustes] }));
    let cfg = q.cfg >= 0 ? cfgs[q.cfg] : undefined;
    if (!cfg) { cfg = { ancora: paraUtm(plano, ancoraDaQuadra(q)), ajustes: [] }; cfgs.push(cfg); }
    const total = q.lotes.reduce((s, l) => s + l.area, 0);
    if (total <= faltaInst * 1.15 && !cfg.ajustes.length) {
      cfg.destino = "institucional";
    } else {
      // cresce a partir do lote mais perto do centro, sempre pelo vizinho (divisa de 3 m
      // ou mais) mais central — um terreno só, compacto, no meio do loteamento
      const livres = q.lotes.filter((l) => !cfg!.ajustes.some((a) => a.destino && a.fileira === l.fileira && a.indice === Math.floor(l.indice + 1e-9)));
      const grupo: typeof livres = [];
      let soma2 = 0;
      const encosta = (l: (typeof livres)[number]) => grupo.some((g) => {
        const u = uniaoFechada([g.pol, l.pol]);
        return u.length === 1 && (perimetroDe(g.pol) + perimetroDe(l.pol) - perimetroDe(u[0])) / 2 >= 3;
      });
      // (25/11) a partir da PONTA da quadra que fica mais perto do centro, coluna a coluna
      // (frente e fundo juntos): um bloco retangular numa ponta. Crescendo do lote do meio,
      // a área cortava a quadra em duas, com degraus — não era harmônico e o DXF exportado
      // voltava como duas quadras.
      const pos = (l: (typeof livres)[number]) => dot(sub(centroide(l.pol.ext), q.origem), q.u);
      const ps = livres.map(pos);
      const sMin = Math.min(...ps), sMax = Math.max(...ps);
      const ponta = (s: number) => {
        const ls = livres.filter((l) => Math.abs(pos(l) - s) < 0.6 * p.frente + 1);
        return ls.length ? Math.min(...ls.map(dLote)) : Infinity;
      };
      const sentido = ponta(sMin) <= ponta(sMax) ? 1 : -1;
      const ordem = [...livres].sort((a, b) => sentido * (pos(a) - pos(b)));
      for (const l of ordem) {
        if (soma2 >= faltaInst) break;
        // o lote seguinte precisa encostar no bloco (fileira única ou a outra fileira da mesma coluna)
        if (grupo.length && !encosta(l)) continue;
        grupo.push(l);
        soma2 += l.area;
        cfg.ajustes.push({ fileira: l.fileira, indice: Math.floor(l.indice + 1e-9), destino: "institucional" });
      }
    }
    quadrasCfg = cfgs;
    pr = { ...pr, quadras: quadrasCfg.slice() };
    res = calcular(pr, perimetro, { manterSobras: true });
    faltaInst = (p.pctInstitucionalMin / 100) * G - res.quadro.institucional;
  }

  // 4. retalhos que apareceram depois das reservas também viram área verde
  //    — marcados por um ponto, sem redesenhar: assim nenhuma quadra muda de
  //    forma e as reservas já feitas (presas à posição do lote) continuam certas
  res = calcular(pr, perimetro, { rapido: true });
  const marcas = semVerde ? [] : res.sobras.filter((s) => verdeValida([s]) && !coberto(res, s) && longeDaEstrada(res, s)).map((s) => ({ ponto: paraUtm(plano, pontoInterno(s)), tipo: "verde" as const }));
  if (marcas.length) pr = { ...pr, sobrasPublicas: [...(pr.sobrasPublicas ?? []), ...marcas] };

  // 5. o que ainda ficou abaixo do mínimo (retalho com frente) vira área verde —
  //    menos na beira da estrada: ali o retalho é somado ao lote vizinho
  // (repete: unir dois lotes muda a fileira e pode sobrar outro pequeno)
  for (let rodada = 0; rodada < 3; rodada++) {
    res = calcular(pr, perimetro, { manterSobras: true });
    // o cálculo completo testa outras frentes nas quadras difíceis e pode
    // soltar retalho que o rápido não via: ele também vira área verde
    if (!semVerde) {
      const novas = res.sobras.filter((s) => verdeValida([s]) && !coberto(res, s) && longeDaEstrada(res, s)).map((s) => ({ ponto: paraUtm(plano, pontoInterno(s)), tipo: "verde" as const }));
      if (novas.length) { pr = { ...pr, sobrasPublicas: [...(pr.sobrasPublicas ?? []), ...novas] }; res = calcular(pr, perimetro, { manterSobras: true }); }
    }
    // só o que está ABAIXO das regras (área, frente, sem frente); o que passa do
    // máximo o motor já divide — unir aqui criaria lote ainda maior
    const ruins = res.lotes.filter((l) => l.area < p.areaMin - 0.01 || l.frente < p.frenteMin - 0.005);
    if (!ruins.length) break;
    const cfgs = pr.quadras.map((c) => ({ ...c, ajustes: [...c.ajustes] }));
    for (const l of ruins) {
      const q = res.quadras.find((x) => x.nome === l.quadra);
      if (!q) continue;
      let c = q.cfg >= 0 ? cfgs[q.cfg] : undefined;
      if (!c) { c = { ancora: paraUtm(plano, ancoraDaQuadra(q)), ajustes: [] }; cfgs.push(c); q.cfg = cfgs.length - 1; }
      const indice = Math.floor(l.indice + 1e-9);
      // retalho com frente soma-se ao lote vizinho (lote maior na ponta, como
      // nas plantas da equipe); só vira área verde se não tiver vizinho na fileira
      const temVizinho = q.lotes.some((x) => x !== l && x.fileira === l.fileira);
      if (temVizinho || l.lados.some((x) => x.tipo === "via")) {
        // "unir" junta um lote com o SEGUINTE da fileira: vale o vizinho imediato
        // (índice − 1 unido a este, ou este unido ao índice + 1)
        // (só se os dois juntos couberem na área máxima — senão o motor dividiria de novo)
        const areaDe = new Map<number, number>();
        for (const x of q.lotes) if (x.fileira === l.fileira) { const k = Math.floor(x.indice + 1e-9); areaDe.set(k, (areaDe.get(k) ?? 0) + x.area); }
        const cabe = (k: number) => areaDe.has(k) && (areaDe.get(k) ?? 0) + l.area <= p.areaMax + 0.5;
        if (cabe(indice - 1)) c.ajustes.push({ fileira: l.fileira, indice: indice - 1, unir: true });
        else if (cabe(indice + 1)) c.ajustes.push({ fileira: l.fileira, indice, unir: true });
        else if (q.lotes.length <= 3) { c.modo = "quantidade"; c.valor = Math.max(1, q.lotes.length - 1); } // quadrinha: um lote a menos
        else if (!semVerde && !l.lados.some((x) => x.tipo === "via") && encostaEmVerde(res, l.pol)) c.ajustes.push({ fileira: l.fileira, indice, destino: "verde" });
      } else if (!semVerde && encostaEmVerde(res, l.pol)) c.ajustes.push({ fileira: l.fileira, indice, destino: "verde" });
    }
    pr = { ...pr, quadras: cfgs };
  }
  // 5b. lote fora das medidas (cunha na ponta da fileira, frente acima do máximo):
  //     antes ele "sumia" virando área verde, mas o verde agora fica sempre no
  //     ponto mais longe das estradas. Ele e os vizinhos da fileira dividem a terra
  //     deles por igual (o mesmo "Igualar áreas" da prancheta). Só fica se melhora.
  {
    res = calcular(pr, perimetro);
    const ruinsDe = (r: Resultado) => r.lotes.filter((l) => l.problemas.length).length + 3 * r.problemas.filter((x) => x.nivel === "erro").length;
    const largos = res.lotes.filter((l) => l.frente > p.frenteMax * 1.03 && !l.esquina && !l.manual);
    for (const l0 of largos) {
      const l = res.lotes.find((x) => x.quadra === l0.quadra && x.fileira === l0.fileira && Math.abs(x.indice - l0.indice) < 1e-9);
      const q = l && res.quadras.find((x) => x.nome === l.quadra);
      if (!l || !q || q.estruturada) continue;
      const fila = q.lotes.filter((x) => x.fileira === l.fileira).sort((a, b) => a.indice - b.indice);
      const k = fila.indexOf(l);
      let feito = false;
      for (const tam of [3, 4, 5, 2]) {
        for (let ini = Math.max(0, k - tam + 1); ini <= k && !feito; ini++) {
          const grupo = fila.slice(ini, ini + tam);
          if (grupo.length < 2 || !grupo.includes(l)) continue;
          const ed = rearranjarSelecao(pr, res, q, grupo.map((x) => posicaoNoDesenho(pr, res, x)), "igualar");
          if (ed.erro) continue;
          const r2 = calcular(ed.pr, perimetro);
          if (ruinsDe(r2) < ruinsDe(res) && r2.lotes.length >= res.lotes.length) { pr = ed.pr; res = r2; feito = true; }
        }
        if (feito) break;
      }
    }
  }
  // 5b'. a quadra que o passo 5b congelou pode ter lote de 5 quinas (a divisa morre
  //      a 3 m da quina da gleba): o pé da divisa vai para a quina
  {
    res = calcular(pr, perimetro);
    const ruinsDe = (r: Resultado) => r.lotes.filter((l) => l.problemas.length).length;
    for (const q of res.quadras) {
      const c = q.cfg >= 0 ? pr.quadras[q.cfg] : undefined;
      if (!c?.lotes || !q.lotes.some((l) => l.problemas.some((t) => /quinas/.test(t)))) continue;
      const pr2 = encaixarQuadraGravada(pr, res, q);
      if (pr2 === pr) continue;
      const r2 = calcular(pr2, perimetro);
      if (ruinsDe(r2) < ruinsDe(res) && r2.lotes.length >= res.lotes.length) { pr = pr2; res = r2; }
    }
  }
  // 5c. lote fora das medidas encostado no verde e longe da estrada (a ponta fina da
  //     gleba que ficou como um lote de 658 m² com 44 m de fundo): entra no verde —
  //     é terra da ponta mais longe das estradas, onde o verde já está. Só fica se
  //     diminui as pendências da planta.
  if (!semVerde) {
    for (let rodada = 0; rodada < 3; rodada++) {
      res = calcular(pr, perimetro);
      const ruinsDe = (r: Resultado) => r.lotes.filter((l) => l.problemas.length).length;
      const alvo = res.lotes.filter((l) => l.problemas.length && !l.lados.some((x) => x.tipo === "via") && encostaEmVerde(res, l.pol) && longeDaEstrada(res, l.pol));
      if (!alvo.length) break;
      const cfgs = pr.quadras.map((c) => ({ ...c, ajustes: [...c.ajustes] }));
      for (const l of alvo) {
        const q = res.quadras.find((x) => x.nome === l.quadra);
        if (!q) continue;
        let c = q.cfg >= 0 ? cfgs[q.cfg] : undefined;
        if (!c) { c = { ancora: paraUtm(plano, ancoraDaQuadra(q)), ajustes: [] }; cfgs.push(c); q.cfg = cfgs.length - 1; }
        c.ajustes.push({ fileira: l.fileira, indice: Math.floor(l.indice + 1e-9), destino: "verde" });
      }
      const pr2 = { ...pr, quadras: cfgs };
      const r2 = calcular(pr2, perimetro);
      if (ruinsDe(r2) >= ruinsDe(res)) break;
      pr = pr2;
    }
  }
  // 6. fechamento: o retalho que ainda ficou e é praça de verdade vira área verde
  //    (a planta não sai com área rosa que podia ser praça)
  //    — e a nesga (ponta fina da gleba) que encosta no verde, longe da estrada, entra
  //    nele: sozinha ela não é praça, mas somada ao lote vizinho estourava as medidas
  //    (a ponta sul do EDILSON virava um lote de 658 m² com 44 m de fundo)
  if (!semVerde) {
    res = calcular(pr, perimetro, { manterSobras: true });
    const novas = res.sobras.filter((s) => (verdeValida([s]) || encostaEmVerde(res, s)) && !coberto(res, s) && longeDaEstrada(res, s)).map((s) => ({ ponto: paraUtm(plano, pontoInterno(s)), tipo: "verde" as const }));
    if (novas.length) pr = { ...pr, sobrasPublicas: [...(pr.sobrasPublicas ?? []), ...novas] };
  }
  // 7. conserto final: o lote que ainda saiu fora das medidas passa pelas mesmas
  //    ferramentas da prancheta — a planta já sai sem pendência sempre que dá
  return consertarPendencias(pr, perimetro);
}

/**
 * Cada lote ainda fora das medidas tenta, na ordem: dividir em 2 ou 3 (grande demais),
 * igualar com 1 a 3 vizinhos que encostam nele (frente curta ou larga, cunha da ponta) e
 * unir ao vizinho (pequeno demais). Fica a ferramenta que diminui as pendências da
 * planta sem deixar sobra e sem perder mais que o lote unido. Rodadas até parar.
 */
/** A área pública que contém o lote virado área continua praça de verdade (corpo e tamanho)? */
function areaComCorpo(r: Resultado, pol: Poligono): boolean {
  const pc = pontoInterno(pol);
  const pedacos = r.areas.filter((a) => a.tipo !== "app").flatMap((a) => a.pols).filter((pg) => dentroPol(pc, pg));
  return pedacos.length > 0 && pedacos.every((pg) => areaPol(pg) >= 300 && verdeValida([pg], 5));
}

export function consertarPendencias(pr0: Projeto, perimetro: Perimetro, limite = 60): Projeto {
  let pr = pr0;
  let res = calcular(pr, perimetro);
  const p = pr.params;
  const pend = (r: Resultado) => r.lotes.filter((l) => l.problemas.length).length;
  let calculos = 0;
  const perim = (pg: Poligono) => pg.ext.reduce((s2, q, i) => s2 + dist(q, pg.ext[(i + 1) % pg.ext.length]), 0);
  const contato = (a: Poligono, b: Poligono) => { const u = uniaoFechada([a, b]); return u.length === 1 ? (perim(a) + perim(b) - perim(u[0])) / 2 : 0; };
  for (let rodada = 0; rodada < 3 && calculos < limite; rodada++) {
    let mudou = false;
    for (const id of res.lotes.filter((l) => l.problemas.length).map((l) => l.id)) {
      if (calculos >= limite) break;
      const l = res.lotes.find((x) => x.id === id);
      const q = l && res.quadras.find((x) => x.nome === l.quadra);
      if (!l || !q || !l.problemas.length) continue;
      const grande = l.area > p.areaMax * 1.03 || l.profundidade > p.profundidadeMax * 1.03 || l.frente > p.frenteMax * 1.03;
      const pequeno = l.area < p.areaMin - 0.01 || l.frente < p.frenteMin - 0.005;
      const viz = q.lotes.filter((x) => x !== l && contato(x.pol, l.pol) >= 2).sort((a, b) => contato(b.pol, l.pol) - contato(a.pol, l.pol));
      const pos = (x: Lote) => posicaoNoDesenho(pr, res, x);
      const cands: (() => Edicao | null)[] = [];
      if (grande) for (const n of [2, 3]) cands.push(() => dividirLote(pr, res, q, l, n));
      for (const v of viz.slice(0, 2)) {
        cands.push(() => rearranjarSelecao(pr, res, q, [pos(l), pos(v)], "igualar"));
        const v2 = q.lotes.filter((x) => x !== l && x !== v && contato(x.pol, v.pol) >= 2)[0];
        if (v2) cands.push(() => rearranjarSelecao(pr, res, q, [pos(l), pos(v), pos(v2)], "igualar"));
      }
      if (pequeno) cands.push(() => unirComVizinho(pr, res, q, l));
      // forma ruim (5+ quinas: o lote em L que sobrou em volta da área verde feita de
      // lotes, a cunha da ponta): unir ao vizinho ou entrar na área pública encostada.
      // Pode custar o lote — lote vermelho na planta entregue é pior
      const forma = l.problemas.some((x) => /quinas/.test(x));
      if (forma) {
        if (!pequeno) cands.push(() => unirComVizinho(pr, res, q, l));
        const pub = res.areas.find((a) => a.tipo !== "app" && a.pols.some((pg) => contato(pg, l.pol) >= 3));
        if (pub) cands.push(() => { const e = mudarDestino(pr, res, q, [pos(l)], pub.tipo); return e && { ...e, _virouArea: l.pol } as Edicao; });
      }
      let melhor: { pr: Projeto; r: Resultado; n: number } | null = null;
      for (const c of cands) {
        if (calculos >= limite) break;
        let ed: Edicao | null = null;
        try { ed = c(); } catch { ed = null; }
        if (!ed || ed.erro || ed.pr === pr) continue;
        let r2: Resultado;
        try { r2 = calcular(ed.pr, perimetro); } catch { continue; }
        calculos++;
        const n2 = pend(r2);
        if (n2 >= pend(res) || r2.quadro.sobras > res.quadro.sobras + 1) continue;
        if (r2.lotes.length < res.lotes.length - (pequeno || forma ? 1 : 0)) continue;
        // lote virado área pública só se a área fica praça de verdade (senão é nesga)
        const va = (ed as Edicao & { _virouArea?: Poligono })._virouArea;
        if (va && !areaComCorpo(r2, va)) continue;
        if (!melhor || n2 < melhor.n || (n2 === melhor.n && r2.lotes.length > melhor.r.lotes.length)) melhor = { pr: ed.pr, r: r2, n: n2 };
      }
      if (melhor) { pr = melhor.pr; res = melhor.r; mudou = true; }
    }
    if (!mudou) break;
  }
  // Último recurso (26/11): o lote que continua fora das medidas — a cunha da ponta aguda,
  // o resto torto entre ruas que se cruzam em ângulo — une ao vizinho ou vira área verde
  // (terra de menos valor; nunca o lote de frente para a estrada). Perde-se um lote, mas a
  // planta entregue não sai com lote vermelho.
  const valor = valorDosLotes(res, pr, perimetro);
  // lasca: quina abaixo de 20° (a ponta onde a rua encontra a divisa em ângulo fechado) —
  // o aviso do lote não pega, mas é lote que ninguém compra
  const lasca = (l: Lote) => quinasDetalhe(antiHorario(l.pol.ext)).some((q) => !q.arco && q.giro > 160 && q.giro < 179);
  const ruins = (r: Resultado) => pend(r) + r.lotes.filter(lasca).length;
  const tentados = new Set<string>();
  for (let volta = 0; volta < 14 && calculos < limite + 40; volta++) {
    const l = res.lotes.find((x) => !tentados.has(x.id) && ((x.problemas.length && !x.problemas.every((t) => /absorveu retalho/.test(t))) || lasca(x)));
    if (!l) break;
    tentados.add(l.id);
    const q = res.quadras.find((x) => x.nome === l.quadra);
    if (!q) continue;
    const cands: (() => Edicao | null)[] = [() => unirComVizinho(pr, res, q, l)];
    if (p.pctVerdeMin > 0 && Number.isFinite(valor.get(l.id) ?? Infinity)) cands.push(() => { const e = mudarDestino(pr, res, q, [posicaoNoDesenho(pr, res, l)], "verde"); return e && { ...e, _virouArea: l.pol } as Edicao; });
    let melhor: { pr: Projeto; r: Resultado; n: number } | null = null;
    for (const c of cands) {
      let ed: Edicao | null = null;
      try { ed = c(); } catch { ed = null; }
      if (!ed || ed.erro || ed.pr === pr) continue;
      let r2: Resultado;
      try { r2 = calcular(ed.pr, perimetro); } catch { continue; }
      calculos++;
      const n2 = ruins(r2);
      if (n2 >= ruins(res) || r2.quadro.sobras > res.quadro.sobras + 1 || r2.lotes.length < res.lotes.length - 1) continue;
      const va = (ed as Edicao & { _virouArea?: Poligono })._virouArea;
      if (va && !areaComCorpo(r2, va)) continue;
      if (!melhor || n2 < melhor.n || (n2 === melhor.n && r2.lotes.length > melhor.r.lotes.length)) melhor = { pr: ed.pr, r: r2, n: n2 };
    }
    if (!melhor) continue;
    pr = melhor.pr; res = melhor.r;
    tentados.clear(); // a numeração mudou: os outros voltam a ser tentados
  }
  return pr;
}

/**
 * Quanto vale cada lote, de 0 (terra que ninguém quer: baixada, encosta,
 * buraco, longe do acesso) a 1. Lote de frente para a estrada vale infinito —
 * é o mais valorizado do loteamento e não pode virar área pública.
 */
export function valorDosLotes(res: Resultado, pr: Projeto, perimetro: Perimetro): Map<string, number> {
  const g = pr.terreno ?? gradeDoPerimetro(perimetro.pts, perimetro.altitudes);
  const vias = res.ladosGleba.filter((l) => ehAcesso(l.tipo));
  const info = res.lotes.map((l) => {
    const c = centroide(l.pol.ext);
    const u = paraUtm(res.plano, c);
    const dVia = vias.length ? Math.min(...vias.map((v) => distSegmentoAuto(c, v.a, v.b))) : 0;
    return {
      l, dVia,
      h: g ? cotaEm(g, u) : 0,
      dec: g ? declividadeEm(g, u) : 0,
      dep: g ? depressaoEm(g, u) : 0,
    };
  });
  const hs = info.map((x) => x.h);
  const hMin = Math.min(...hs), hMax = Math.max(...hs);
  const dMax = Math.max(1, ...info.map((x) => x.dVia));
  const relevo = hMax - hMin > 0.5;
  const out = new Map<string, number>();
  for (const x of info) {
    if (x.l.lados.some((s) => s.tipo === "via")) { out.set(x.l.id, Infinity); continue; }
    const z = relevo ? (x.h - hMin) / (hMax - hMin) : 0.5;      // baixa = 0
    const s = Math.min(1, x.dec / 30);                          // íngreme = 1
    const b = Math.max(0, Math.min(1, x.dep / 2));              // buraco = 1
    const longe = vias.length ? x.dVia / dMax : 0.5;            // longe do acesso = 1
    // regra do Wilker (02/11): a área verde fica SEMPRE no ponto do terreno mais
    // afastado das estradas — a distância manda; o relevo só desempata
    const v = vias.length
      ? 0.9 * (1 - longe) + (relevo ? 0.1 * (0.5 * z + 0.3 * (1 - s) + 0.2 * (1 - b)) : 0)
      : relevo ? 0.4 * z + 0.25 * (1 - s) + 0.15 * (1 - b) + 0.2 : 0.5;
    // lote fora das faixas vale um pouco menos (desempate), sem puxar o verde para perto da estrada
    const desarmonico = x.l.problemas.length > 0 ? 0.95 : 1;
    out.set(x.l.id, Math.max(0, Math.min(1, v)) * desarmonico);
  }
  return out;
}

/**
 * Melhor trecho CONTÍNUO de lotes (andando em volta da quadra) para virar área
 * verde: o de menor valor médio que cubra o que falta — ou a quadra inteira,
 * se ela toda for menor que a falta. Lote de frente para a estrada interrompe
 * o trecho (a área verde nunca encosta na estrada).
 */
function melhorJanelaVerde(res: Resultado, valor: Map<string, number>, falta: number) {
  type Cand = { quadra: Resultado["quadras"][number]; lotes: Resultado["lotes"]; nota: number; coluna?: boolean };
  const cands: Cand[] = [];
  const verdes = res.areas.filter((a) => a.tipo === "verde" || a.tipo === "lazer").flatMap((a) => a.pols);
  for (const q of res.quadras) {
    const seq = [...q.lotes].sort((a, b) => a.numero - b.numero);
    const n = seq.length;
    if (!n) continue;
    // maior trecho contínuo sem lote de estrada (dando a volta na quadra)
    let total = 0, corrida = 0;
    for (let k = 0; k < 2 * n; k++) {
      const l = seq[k % n];
      if (Number.isFinite(valor.get(l.id) ?? Infinity)) { corrida += l.area; total = Math.max(total, Math.min(corrida, q.lotes.reduce((s, x) => s + x.area, 0))); }
      else corrida = 0;
    }
    const alvo = Math.min(falta, total);
    if (alvo < 1) continue;
    for (let i = 0; i < n; i++) {
      let area = 0, soma = 0;
      const jan: typeof seq = [];
      for (let k = 0; k < n; k++) {
        const l = seq[(i + k) % n];
        const v = valor.get(l.id) ?? Infinity;
        if (!Number.isFinite(v)) break;
        jan.push(l); area += l.area; soma += v * l.area;
        // praça tem corpo: no mínimo 3 lotes, mesmo que a falta seja menor
        if (area >= alvo && jan.length >= Math.min(3, n)) break;
      }
      if (area < alvo - 1) continue;
      // valor médio + leve preferência por não passar muito da falta
      const nota = soma / area + 0.15 * Math.max(0, area - falta) / Math.max(falta, 1);
      cands.push({ quadra: q, lotes: jan, nota });
    }
    // colunas a partir de cada ponta da quadra (frente e fundo juntos): com lote estreito
    // e raso (7 × 20) a janela pela numeração fica numa fileira só e nunca fecha a praça
    // mínima (círculo de 10 m) — a meta de verde ficava sem cumprir
    if (q.fileiras >= 2 && n >= 4) {
      const proj = (l: (typeof seq)[number]) => dot(centroide(l.pol.ext), q.u);
      const ord = [...seq].sort((a, b) => proj(a) - proj(b));
      for (const lista of [ord, [...ord].reverse()]) {
        const jan: typeof seq = [];
        let area = 0, soma = 0, ok = true;
        for (const l of lista) {
          const v = valor.get(l.id) ?? Infinity;
          if (!Number.isFinite(v)) { ok = false; break; }
          jan.push(l); area += l.area; soma += v * l.area;
          if (area >= alvo && jan.length >= 4) break;
        }
        if (!ok || area < alvo - 1) continue;
        // fecha a coluna: o lote de trás do último que entrou vai junto (bloco reto)
        const ult = proj(jan[jan.length - 1]);
        for (const l of lista) if (!jan.includes(l) && Math.abs(proj(l) - ult) < 0.6 * Math.sqrt(l.area / 2.5) && Number.isFinite(valor.get(l.id) ?? Infinity)) { jan.push(l); area += l.area; soma += (valor.get(l.id) ?? 0) * l.area; }
        cands.push({ quadra: q, lotes: jan, nota: soma / area + 0.15 * Math.max(0, area - falta) / Math.max(falta, 1), coluna: true });
      }
    }
  }
  // Área verde num perímetro só e com corpo (círculo de 10 m): o trecho que
  // encosta no verde que já existe ganha preferência, e o que, somado a ele,
  // não fecha uma praça de verdade é descartado
  const avaliados = cands.map((c) => {
    const pols = c.lotes.map((l) => l.pol);
    const juntos = uniaoFechada(pols);
    // encostar é dividir divisa (5 m ou mais), não tocar num canto
    const per = perimetroDe;
    const viz = verdes.filter((v) => juntos.some((j) => {
      const u = uniaoFechada([v, j]);
      return u.length === 1 && (per(v) + per(j) - per(u[0])) / 2 >= 5;
    }));
    return { c, viz, nota: c.nota - (viz.length ? 0.2 : 0) };
  }).sort((a, b) => a.nota - b.nota);
  for (const a of [...avaliados.slice(0, 60), ...avaliados.slice(60).filter((x) => x.c.coluna)]) {
    const pols = a.c.lotes.map((l) => l.pol);
    // com folga (raio de 11 m): a geometria final da quadra pode mexer uns centímetros
    if (verdeValida(uniaoFechada([...pols, ...a.viz]), 11)) return a.c;
  }
  return null;
}

/** Quadra que contém o ponto (plano). */
export function quadraNoPonto(res: Resultado, p: Pt) {
  return res.quadras.find((q) => dentroPol(p, q.pol)) ?? null;
}

export function boxDe(res: Resultado): { min: Pt; max: Pt } {
  return caixa(res.gleba.ext);
}

export { paraPlano, paraUtm };

/** Gera num Web Worker; se o navegador não deixar, gera aqui mesmo. */
export function gerarPropostasEmSegundoPlano(projeto: Projeto, perimetro: Perimetro, op: OpcoesGerar = {}): Promise<Proposta[]> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL("./gerador.worker.ts", import.meta.url), { type: "module" });
    } catch {
      try { resolve(gerarPropostas(projeto, perimetro, op)); } catch (e) { reject(e); }
      return;
    }
    w.onmessage = (e: MessageEvent<{ ok: boolean; props?: Proposta[]; erro?: string }>) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.props ?? []); else reject(new Error(e.data.erro));
    };
    w.onerror = () => {
      w.terminate();
      try { resolve(gerarPropostas(projeto, perimetro, op)); } catch (e) { reject(e); }
    };
    w.postMessage({ projeto, perimetro, op });
  });
}
