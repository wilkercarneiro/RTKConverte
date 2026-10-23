// Proposta automática: lança as ruas, testa orientações e defasagens e fica
// com as que rendem mais lotes válidos. Depois reserva área verde e
// institucional onde custa menos lote.
//
// O critério é o mesmo `calcular()` da tela — o gerador não tem uma ideia
// própria do que é um lote bom.
import {
  antiHorario, areaAssinada, caixa, centroide, dentroPol, dist, dot, esquerda, intersecao as intersecaoPols, limparAnel, mult,
  recortarLinha, soma, sub, uniao, unit,
} from "./geom.ts";
import type { Poligono, Pt } from "./geom.ts";
import { calcular } from "./calculo.ts";
import type { Perimetro, Resultado } from "./calculo.ts";
import { criarPlano, paraPlano, paraUtm } from "./plano.ts";
import { novoId } from "./modelo.ts";
import { cotaEm, declividadeEm, depressaoEm, gradeDoPerimetro } from "./terreno.ts";
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
  for (const i of vias) angs.push(lados[i].ang);
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
): EixoAuto[] {
  const p = projeto.params;
  const w = p.ruaLargura;
  const u: Pt = [Math.cos(ang), Math.sin(ang)], v = esquerda(u);
  const us = glebaPl.ext.map((q) => dot(q, u)), vs = glebaPl.ext.map((q) => dot(q, v));
  const u0 = Math.min(...us) - 50, u1 = Math.max(...us) + 50, v0 = Math.min(...vs), v1 = Math.max(...vs);
  const passoV = 2 * p.profundidade + w;
  const lq = Math.max(p.frente * 4, Math.floor(p.quadraCompMax / p.frente) * p.frente);
  const passoU = lq + w;
  const linhas: Pt[][] = [];
  const pt = (s: number, t: number): Pt => soma(mult(u, s), mult(v, t));
  for (let t = Math.min(...vs) + fy; t < v1; t += passoV) if (t > v0) linhas.push([pt(u0, t), pt(u1, t)]);
  if (Math.max(...us) - Math.min(...us) > lq + 2 * p.profundidade) {
    for (let s = Math.min(...us) + fx; s < Math.max(...us); s += passoU) linhas.push([pt(s, v0 - 50), pt(s, v1 + 50)]);
  }
  const minimo = Math.max(p.profundidade, 2 * p.frente);
  const segs: Seg[] = [];
  if (anel) {
    // contorno: as ruas internas terminam no anel; da estrada até o anel saem os acessos
    const anelPol: Poligono = { ext: anel, furos: [] };
    for (let i = 0; i < anel.length; i++) segs.push({ a: anel[i], b: anel[(i + 1) % anel.length], viaA: false, viaB: false, balao: false, anel: true });
    for (const l of linhas) {
      for (const seg of recortarLinha(l, anelPol)) {
        const a = seg[0], b = seg[seg.length - 1];
        if (dist(a, b) < minimo) continue;
        // rua interna quase colada no contorno deixa uma quadra fina demais
        // para lote: entre as duas não cabe uma fileira
        const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        let dAnel = Infinity;
        for (let i = 0; i < anel.length; i++) dAnel = Math.min(dAnel, distSegmentoAuto(m, anel[i], anel[(i + 1) % anel.length]));
        if (dAnel < 1.2 * p.profundidade + w) continue;
        segs.push({ a, b, viaA: false, viaB: false, balao: false });
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
  const doAnel = ligados.filter((s) => s.anel);
  if (doAnel.length) out.push({ eixo: [...doAnel.map((s) => s.a), doAnel[0].a] });
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
export function anelInterno(ptsPl: Pt[], distancias: number[], glebaPl: Poligono): Pt[] | null {
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
  const limpo = intersecaoAnel(vert, glebaPl);
  if (!limpo) return null;
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

interface Seg { a: Pt; b: Pt; viaA: boolean; viaB: boolean; balao: boolean; anel?: boolean }
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
}

export function gerarPropostas(base: Projeto, perimetro: Perimetro, op: OpcoesGerar = {}): Proposta[] {
  const p = base.params;
  const plano = criarPlano(perimetro.pts, perimetro.altitudes, p.distanciasTerreno);
  const ptsPl = perimetro.pts.map((q) => paraPlano(plano, q));
  const glebaPl: Poligono = { ext: antiHorario(ptsPl), furos: [] };
  const vias = base.bordas.map((b, i) => (b.tipo === "via" ? i : -1)).filter((i) => i >= 0);
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
  const nota = (r: Resultado) => {
    // lote válido conta 1; lote desproporcional (mais que 2,2× o padrão) conta
    // meio — é a faixa comprida da beirada, que ninguém quer comprar; terra
    // sem frente (sobra) desconta o que renderia em lotes
    const padrao = p.frente * p.profundidade;
    let n = 0, a = 0;
    for (const l of r.lotes) if (l.area >= p.areaMin - 0.01) { n += l.area > 2.2 * padrao ? 0.5 : 1; a += l.area; }
    n -= r.quadro.sobras / padrao;
    let longas = 0;
    for (const q of r.quadras) {
      const us = q.pol.ext.map((x) => dot(sub(x, q.origem), q.u));
      if (Math.max(...us) - Math.min(...us) > p.quadraCompMax + 0.5) longas++;
    }
    return n - 12 * longas + a / 1e7;
  };

  // rua de contorno: uma profundidade de lote da divisa, duas da estrada
  const distAnel = base.bordas.map((b) => (b.tipo === "via" ? 2 * p.profundidade + w / 2 : p.profundidade + w / 2 + (b.tipo === "divisa" ? 0 : b.faixa)));
  const anel = anelInterno(ptsPl, distAnel, glebaPl);
  const variantes: (Pt[] | null)[] = anel ? [null, anel] : [null];

  const porAngulo: { ang: number; eixos: EixoAuto[]; nota: number; res: Resultado }[] = [];
  for (const ang of angs) {
    const v = esquerda([Math.cos(ang), Math.sin(ang)]);
    const vMin = Math.min(...ptsPl.map((q) => dot(q, v)));
    // defasagens: a "natural" (uma fileira de lotes antes da 1ª rua) e frações do passo
    const fys = new Set<number>();
    for (let j = 0; j < 6; j++) fys.add(((p.profundidade + w / 2 + (j * passoV) / 6) % passoV));
    for (const i of vias) {
      const a = ptsPl[i], b = ptsPl[(i + 1) % ptsPl.length];
      const vv = (dot(a, v) + dot(b, v)) / 2;
      for (const s of [1, -1]) fys.add((((vv + s * (2 * p.profundidade + w / 2) - vMin) % passoV) + passoV) % passoV);
    }
    let melhor: { eixos: EixoAuto[]; nota: number; res: Resultado; fy: number; anel: Pt[] | null } | null = null;
    for (const va of variantes) for (const fy of fys) {
      const eixos = malha(glebaPl, ang, fy, passoU / 2, base, viasPl, va);
      const res = calcular(montar(eixos), perimetro, { rapido: true });
      const n = nota(res);
      if (!melhor || n > melhor.nota) melhor = { eixos, nota: n, res, fy, anel: va };
    }
    // ajuste fino da defasagem transversal com a melhor longitudinal
    const fyMelhor = melhor!.fy;
    for (const fx of [passoU / 6, passoU / 3, (2 * passoU) / 3, (5 * passoU) / 6, 0]) {
      const eixos = malha(glebaPl, ang, fyMelhor, fx, base, viasPl, melhor!.anel);
      const res = calcular(montar(eixos), perimetro, { rapido: true });
      const n = nota(res);
      if (n > melhor!.nota) melhor = { eixos, nota: n, res, fy: fyMelhor, anel: melhor!.anel };
    }
    porAngulo.push({ ang, ...melhor! });
  }
  porAngulo.sort((a, b) => b.nota - a.nota);

  const quantas = op.quantas ?? 3;
  const props: Proposta[] = [];
  for (const c of porAngulo.slice(0, quantas)) {
    let projeto = montar(c.eixos);
    projeto = nomearRuas(projeto, plano, c.ang);
    if (op.reservarAreas !== false) projeto = reservarAreas(projeto, perimetro);
    const resultado = calcular(projeto, perimetro);
    const g = resultado.quadro.gleba;
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
  }
  props.sort((a, b) => b.lotes - a.lotes);
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
  for (let rodada = 0; rodada < 5; rodada++) {
    const novas: AreaDesenhada[] = [];
    for (const s of uniao(res.sobras.map((x) => ({ ext: x.ext, furos: [] })))) {
      if (Math.abs(areaAssinada(s.ext)) < 50) continue;
      novas.push({ id: novoId("autov"), tipo: "verde", nome: "", anel: s.ext.map((q) => paraUtm(plano, q)) });
    }
    if (!novas.length) break;
    pr = { ...pr, areas: [...pr.areas, ...novas] };
    res = calcular(pr, perimetro, { rapido: true });
  }

  // 2. área verde onde a terra vale menos: baixada, encosta íngreme, buraco,
  //    longe do acesso. Lote com frente para a estrada NUNCA vira área verde.
  const verdeAtual = () => res.quadro.verde + res.quadro.lazer;
  let falta = (p.pctVerdeMin / 100) * G - verdeAtual();
  let quadrasCfg: QuadraCfg[] = [...pr.quadras];
  let guarda = 0;
  while (falta > 1 && guarda++ < 25) {
    res = calcular(pr, perimetro);
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
    res = calcular(pr, perimetro, { rapido: true });
    falta = (p.pctVerdeMin / 100) * G - verdeAtual();
  }

  // 3. institucional: lotes de uma ponta da quadra mais central
  //    (se a quadra central não basta, continua na vizinha mais próxima)
  res = calcular(pr, perimetro, { rapido: true });
  let faltaInst = (p.pctInstitucionalMin / 100) * G - res.quadro.institucional;
  let referencia = centroide(res.gleba.ext);
  const usadas = new Set<string>();
  for (let rodada = 0; faltaInst > 1 && rodada < 10; rodada++) {
    const ord = [...res.quadras].filter((q) => q.lotes.length >= 2 && !usadas.has(q.nome)).sort((a, b) => dist(a.centro, referencia) - dist(b.centro, referencia));
    const q = ord[0];
    if (!q) break;
    usadas.add(q.nome);
    referencia = q.centro;
    // a config da quadra é UMA: se a quadra já tem ajustes (área verde), soma neles
    const cfgs = quadrasCfg.map((c) => ({ ...c, ajustes: [...c.ajustes] }));
    let cfg = q.cfg >= 0 ? cfgs[q.cfg] : undefined;
    if (!cfg) { cfg = { ancora: paraUtm(plano, ancoraDaQuadra(q)), ajustes: [] }; cfgs.push(cfg); }
    const total = q.lotes.reduce((s, l) => s + l.area, 0);
    if (total <= faltaInst * 1.15 && !cfg.ajustes.length) {
      cfg.destino = "institucional";
    } else {
      // fileira 0 a partir do início, depois a fileira 1 na mesma ponta, até cobrir a meta
      const fil0 = q.lotes.filter((l) => l.fileira === 0).sort((a, b) => a.indice - b.indice);
      const fil1 = q.lotes.filter((l) => l.fileira === 1).sort((a, b) => b.indice - a.indice);
      let soma2 = 0;
      for (let k = 0; soma2 < faltaInst && (k < fil0.length || k < fil1.length); k++) {
        for (const l of [fil0[k], fil1[k]]) {
          if (!l || soma2 >= faltaInst) continue;
          cfg.ajustes.push({ fileira: l.fileira, indice: Math.floor(l.indice + 1e-9), destino: "institucional" });
          soma2 += l.area;
        }
      }
    }
    quadrasCfg = cfgs;
    pr = { ...pr, quadras: quadrasCfg.slice() };
    res = calcular(pr, perimetro, { rapido: true });
    faltaInst = (p.pctInstitucionalMin / 100) * G - res.quadro.institucional;
  }

  // 4. retalhos que apareceram depois das reservas também viram área verde
  //    — marcados por um ponto, sem redesenhar: assim nenhuma quadra muda de
  //    forma e as reservas já feitas (presas à posição do lote) continuam certas
  res = calcular(pr, perimetro, { rapido: true });
  const marcas = res.sobras.filter((s) => Math.abs(areaAssinada(s.ext)) >= 50).map((s) => ({ ponto: paraUtm(plano, pontoInterno(s)), tipo: "verde" as const }));
  if (marcas.length) pr = { ...pr, sobrasPublicas: [...(pr.sobrasPublicas ?? []), ...marcas] };

  // 5. o que ainda ficou abaixo do mínimo (retalho com frente) vira área verde —
  //    menos na beira da estrada: ali o retalho é somado ao lote vizinho
  res = calcular(pr, perimetro);
  const ruins = res.lotes.filter((l) => l.problemas.length);
  if (ruins.length) {
    const cfgs = pr.quadras.map((c) => ({ ...c, ajustes: [...c.ajustes] }));
    for (const l of ruins) {
      const q = res.quadras.find((x) => x.nome === l.quadra);
      if (!q) continue;
      let c = q.cfg >= 0 ? cfgs[q.cfg] : undefined;
      if (!c) { c = { ancora: paraUtm(plano, ancoraDaQuadra(q)), ajustes: [] }; cfgs.push(c); q.cfg = cfgs.length - 1; }
      const indice = Math.floor(l.indice + 1e-9);
      // na estrada, ou pequeno demais para ser praça: soma-se ao lote vizinho
      if (l.lados.some((x) => x.tipo === "via") || l.area < 0.5 * p.areaMin) {
        const vizinhos = q.lotes.filter((x) => x.fileira === l.fileira).map((x) => Math.floor(x.indice + 1e-9));
        const ant = vizinhos.filter((i) => i < indice).sort((a, b) => b - a)[0];
        c.ajustes.push(ant !== undefined ? { fileira: l.fileira, indice: ant, unir: true } : { fileira: l.fileira, indice, unir: true });
      } else c.ajustes.push({ fileira: l.fileira, indice, destino: "verde" });
    }
    pr = { ...pr, quadras: cfgs };
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
  const vias = res.ladosGleba.filter((l) => l.tipo === "via");
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
    const v = relevo
      ? 0.4 * z + 0.25 * (1 - s) + 0.15 * (1 - b) + 0.2 * (1 - longe)
      : 1 - longe;
    out.set(x.l.id, Math.max(0, Math.min(1, v)));
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
  let melhor: { quadra: Resultado["quadras"][number]; lotes: Resultado["lotes"]; nota: number } | null = null;
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
        if (area >= alvo) break;
      }
      if (area < alvo - 1) continue;
      // valor médio + leve preferência por não passar muito da falta
      const nota = soma / area + 0.15 * Math.max(0, area - falta) / Math.max(falta, 1);
      if (!melhor || nota < melhor.nota) melhor = { quadra: q, lotes: jan, nota };
    }
  }
  return melhor;
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
