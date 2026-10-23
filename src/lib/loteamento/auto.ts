// Proposta automática: lança as ruas, testa orientações e defasagens e fica
// com as que rendem mais lotes válidos. Depois reserva área verde e
// institucional onde custa menos lote.
//
// O critério é o mesmo `calcular()` da tela — o gerador não tem uma ideia
// própria do que é um lote bom.
import {
  antiHorario, areaAssinada, caixa, centroide, dentroPol, dist, dot, esquerda, mult, recortarLinha, soma, sub, uniao, unit,
} from "./geom.ts";
import type { Poligono, Pt } from "./geom.ts";
import { calcular } from "./calculo.ts";
import type { Perimetro, Resultado } from "./calculo.ts";
import { criarPlano, paraPlano, paraUtm } from "./plano.ts";
import { novoId } from "./modelo.ts";
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
function malha(glebaPl: Poligono, ang: number, fy: number, fx: number, projeto: Projeto): Pt[][] {
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
  const eixos: Pt[][] = [];
  for (const l of linhas) {
    for (const seg of recortarLinha(l, glebaPl)) {
      const a = seg[0], b = seg[seg.length - 1];
      if (dist(a, b) < minimo) continue;
      const d = unit(sub(b, a));
      eixos.push([soma(a, mult(d, -w)), soma(b, mult(d, w))]);
    }
  }
  return eixos;
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
  const angs = op.angulo !== undefined ? [op.angulo] : angulosCandidatos(ptsPl, vias);

  const w = p.ruaLargura;
  const passoV = 2 * p.profundidade + w;
  const lq = Math.max(p.frente * 4, Math.floor(p.quadraCompMax / p.frente) * p.frente);
  const passoU = lq + w;

  const montar = (eixos: Pt[][]): Projeto => ({
    ...base,
    ruas: [
      ...base.ruas.filter((r) => r.id.startsWith("m")), // ruas desenhadas à mão ficam
      ...eixos.map((e, i) => ({ id: `a${i}`, nome: `Rua ${String(i + 1).padStart(2, "0")}`, largura: w, eixo: e.map((q) => paraUtm(plano, q)) })),
    ],
    quadras: [],
    areas: base.areas.filter((a) => !a.id.startsWith("auto")),
  });
  // lotes válidos; quadra acima do comprimento máximo custa caro (a prefeitura devolve)
  const nota = (r: Resultado) => {
    let n = 0, a = 0;
    for (const l of r.lotes) if (l.area >= p.areaMin - 0.01) { n++; a += l.area; }
    let longas = 0;
    for (const q of r.quadras) {
      const us = q.pol.ext.map((x) => dot(sub(x, q.origem), q.u));
      if (Math.max(...us) - Math.min(...us) > p.quadraCompMax + 0.5) longas++;
    }
    return n - 12 * longas + a / 1e7;
  };

  const porAngulo: { ang: number; eixos: Pt[][]; nota: number; res: Resultado }[] = [];
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
    let melhor: { eixos: Pt[][]; nota: number; res: Resultado; fy: number } | null = null;
    for (const fy of fys) {
      const eixos = malha(glebaPl, ang, fy, passoU / 2, base);
      const res = calcular(montar(eixos), perimetro, { rapido: true });
      const n = nota(res);
      if (!melhor || n > melhor.nota) melhor = { eixos, nota: n, res, fy };
    }
    // ajuste fino da defasagem transversal com a melhor longitudinal
    const fyMelhor = melhor!.fy;
    for (const fx of [passoU / 6, passoU / 3, (2 * passoU) / 3, (5 * passoU) / 6, 0]) {
      const eixos = malha(glebaPl, ang, fyMelhor, fx, base);
      const res = calcular(montar(eixos), perimetro, { rapido: true });
      const n = nota(res);
      if (n > melhor!.nota) melhor = { eixos, nota: n, res, fy: fyMelhor };
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
  let pr = { ...projeto, areas: projeto.areas.filter((a) => !a.id.startsWith("auto")), quadras: projeto.quadras.filter((q) => !q.destino) };
  const p = pr.params;
  let res = calcular(pr, perimetro, { rapido: true });
  const plano = res.plano;
  const G = res.quadro.gleba;

  // 1. retalhos
  const novas: AreaDesenhada[] = [];
  for (const s of uniao(res.sobras.map((x) => ({ ext: x.ext, furos: [] })))) {
    if (Math.abs(areaAssinada(s.ext)) < 50) continue;
    novas.push({ id: novoId("autov"), tipo: "verde", nome: "", anel: s.ext.map((q) => paraUtm(plano, q)) });
  }
  if (novas.length) {
    pr = { ...pr, areas: [...pr.areas, ...novas] };
    res = calcular(pr, perimetro, { rapido: true });
  }

  // 2. quadras para área verde
  const verdeAtual = () => res.quadro.verde + res.quadro.lazer;
  let falta = (p.pctVerdeMin / 100) * G - verdeAtual();
  const quadrasCfg: QuadraCfg[] = [...pr.quadras];
  let guarda = 0;
  while (falta > 1 && guarda++ < 30) {
    const cands = res.quadras.map((q) => {
      const util = q.lotes.filter((l) => l.area >= p.areaMin - 0.01).reduce((s, l) => s + l.area, 0);
      const ganho = Math.min(q.area, falta);
      const excesso = Math.max(0, q.area - falta);
      return { q, custo: (util + 0.35 * excesso) / Math.max(1, ganho) };
    }).sort((a, b) => a.custo - b.custo);
    if (!cands.length) break;
    const q = cands[0].q;
    quadrasCfg.push({ ancora: paraUtm(plano, pontoInterno(q.pol)), destino: "verde", ajustes: [] });
    pr = { ...pr, quadras: quadrasCfg.slice() };
    res = calcular(pr, perimetro, { rapido: true });
    falta = (p.pctVerdeMin / 100) * G - verdeAtual();
  }

  // 3. institucional: lotes de uma ponta da quadra mais central
  const faltaInst = (p.pctInstitucionalMin / 100) * G - res.quadro.institucional;
  if (faltaInst > 1 && res.quadras.length) {
    const c = centroide(res.gleba.ext);
    const ord = [...res.quadras].filter((q) => q.lotes.length >= 2).sort((a, b) => dist(a.centro, c) - dist(b.centro, c));
    const q = ord[0];
    if (q) {
      const total = q.lotes.reduce((s, l) => s + l.area, 0);
      const ancora = paraUtm(plano, pontoInterno(q.pol));
      if (total <= faltaInst * 1.15) {
        quadrasCfg.push({ ancora, destino: "institucional", ajustes: [] });
      } else {
        // fileira 0 a partir do início, depois a fileira 1 na mesma ponta, até cobrir a meta
        const fil0 = q.lotes.filter((l) => l.fileira === 0).sort((a, b) => a.indice - b.indice);
        const fil1 = q.lotes.filter((l) => l.fileira === 1).sort((a, b) => b.indice - a.indice);
        const ajustes: QuadraCfg["ajustes"] = [];
        let soma2 = 0;
        for (let k = 0; soma2 < faltaInst && (k < fil0.length || k < fil1.length); k++) {
          for (const l of [fil0[k], fil1[k]]) {
            if (!l || soma2 >= faltaInst) continue;
            ajustes.push({ fileira: l.fileira, indice: l.indice, destino: "institucional" });
            soma2 += l.area;
          }
        }
        quadrasCfg.push({ ancora, ajustes });
      }
      pr = { ...pr, quadras: quadrasCfg.slice() };
    }
  }

  // 4. retalhos que apareceram depois das reservas também viram área verde
  res = calcular(pr, perimetro, { rapido: true });
  const retalhos = uniao(res.sobras.map((x) => ({ ext: x.ext, furos: [] }))).filter((s) => Math.abs(areaAssinada(s.ext)) >= 50);
  if (retalhos.length) {
    pr = { ...pr, areas: [...pr.areas, ...retalhos.map((s) => ({ id: novoId("autov"), tipo: "verde" as const, nome: "", anel: s.ext.map((q) => paraUtm(plano, q)) }))] };
  }

  // 5. o que ainda ficou abaixo do mínimo (retalho com frente) vira área verde
  res = calcular(pr, perimetro);
  const ruins = res.lotes.filter((l) => l.problemas.length);
  if (ruins.length) {
    const cfgs = pr.quadras.map((c) => ({ ...c, ajustes: [...c.ajustes] }));
    for (const l of ruins) {
      const q = res.quadras.find((x) => x.nome === l.quadra);
      if (!q) continue;
      let c = q.cfg >= 0 ? cfgs[q.cfg] : undefined;
      if (!c) { c = { ancora: paraUtm(plano, pontoInterno(q.pol)), ajustes: [] }; cfgs.push(c); q.cfg = cfgs.length - 1; }
      c.ajustes.push({ fileira: l.fileira, indice: l.indice, destino: "verde" });
    }
    pr = { ...pr, quadras: cfgs };
  }
  return pr;
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
