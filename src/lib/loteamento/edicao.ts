// Edição livre dos lotes, como numa prancheta de CAD — só que sem travas.
//
// A primeira mexida geométrica num lote "congela" a quadra: os lotes que o
// sistema tinha calculado viram contornos do operador (`QuadraCfg.lotes`), e a
// partir daí a quadra é exatamente o que ele desenhou. Cada operação mexe nos
// contornos e devolve um projeto novo (nunca muta: o desfazer vem de graça).
//
// As divisas são compartilhadas: mover uma quina ou deslizar uma divisa leva
// junto os lotes vizinhos que têm aquele ponto — eles se ajustam sozinhos.
// Ponto que está na borda da quadra (na rua, na divisa da gleba) desliza pela
// borda; ponto que está numa linha de outros lotes (a linha de fundo) desliza
// por ela. Nada é recusado: o que sair das medidas vira aviso no lote.
import {
  antiHorario, areaAssinada, areaPol, bufferLinha, cross, dentroPol, diferenca, dist, distSegmento, dot, esquerda, intersecao,
  giroEm, intersecaoRetas, lerp, limparAnel, mult, quinasDe, soma, sub, uniaoFechada, unit,
} from "./geom.ts";
import type { Poligono, Pt } from "./geom.ts";
import { ancoraDaQuadra } from "./auto.ts";
import { fmt, partirIgual } from "./calculo.ts";
import type { Lote, Quadra, Resultado } from "./calculo.ts";
import { paraPlano, paraUtm } from "./plano.ts";
import type { LoteDesenhado, Projeto, QuadraCfg } from "./modelo.ts";

const TOL = 0.02;

/** O que acompanha cada contorno: destino (área pública) e a frente escolhida (plano). */
interface Meta { destino?: LoteDesenhado["destino"]; frente?: [Pt, Pt] }

export interface Edicao {
  pr: Projeto;
  msg: string;
  /** lotes que ficam selecionados (posição no desenho da quadra) */
  sel?: { quadra: string; indices: number[] };
  /** não deu para fazer (o projeto volta igual): é mensagem de erro, não edição */
  erro?: boolean;
}

// ---------------------------------------------------------------------------
// Congelar: a quadra passa a ser do operador
// ---------------------------------------------------------------------------

/**
 * Config da quadra no projeto: a do cálculo ou, se a quadra acabou de ganhar
 * uma (congelada nesta mesma edição), a que tem a âncora dentro dela.
 */
export function cfgDe(pr: Projeto, q: Quadra, pl?: Resultado["plano"]): number {
  if (q.cfg >= 0 && pr.quadras[q.cfg]) return q.cfg;
  if (!pl) return -1;
  for (let i = pr.quadras.length - 1; i >= 0; i--) if (dentroPol(paraPlano(pl, pr.quadras[i].ancora), q.pol)) return i;
  return -1;
}

export const quadraDesenhada = (pr: Projeto, q: Quadra, pl?: Resultado["plano"]): boolean => {
  const i = cfgDe(pr, q, pl);
  return i >= 0 && Array.isArray(pr.quadras[i]?.lotes);
};

/**
 * Lotes da quadra na ordem do desenho. Quem diz é o próprio resultado: lote
 * desenhado tem a posição no índice; a quadra ainda automática (ou o resultado
 * de antes do congelamento) vai pela numeração — é nessa ordem que ela congela.
 */
export function ordemDoDesenho(_pr: Projeto, q: Quadra): Lote[] {
  return q.lotes.some((l) => l.manual) ? [...q.lotes].sort((a, b) => a.indice - b.indice) : [...q.lotes].sort((a, b) => a.numero - b.numero);
}

/** Posição do lote no desenho da quadra (o índice que as operações usam). */
export function posicaoNoDesenho(pr: Projeto, res: Resultado, l: Lote): number {
  const q = res.quadras.find((x) => x.nome === l.quadra);
  if (!q) return -1;
  return l.manual ? l.indice : ordemDoDesenho(pr, q).indexOf(l);
}

/**
 * Garante a quadra desenhada e devolve os contornos (no plano) e o índice da
 * config. Os lotes viram contornos na ordem da numeração; as áreas públicas
 * feitas de lotes da quadra também (com o destino delas).
 */
function contornos(pr: Projeto, res: Resultado, q: Quadra): { pr: Projeto; i: number; aneis: Pt[][]; destinos: Meta[] } {
  const pl = res.plano;
  const ic = cfgDe(pr, q, pl);
  if (ic >= 0 && Array.isArray(pr.quadras[ic].lotes)) {
    const c = pr.quadras[ic];
    // o contorno guardado pode passar da quadra (a rua andou): vale o lote
    // recortado pela quadra — é nele que estão as quinas que o operador vê
    const aneis = c.lotes!.map((l) => {
      const an = l.anel.map((p) => paraPlano(pl, p));
      const pg: Poligono = { ext: antiHorario(an), furos: [] };
      if (an.length < 3 || areaPol({ ext: an, furos: [] }) < 0.5 || diferenca([pg], [q.pol]).reduce((s2, x) => s2 + areaPol(x), 0) < 0.05) return an;
      const dentro = intersecao([pg], [q.pol]).sort((x, y) => areaPol(y) - areaPol(x))[0];
      return dentro ? limparAnel(dentro.ext, 0.003) : an;
    });
    return { pr, i: ic, aneis: normalizar(aneis), destinos: c.lotes!.map((l) => ({ destino: l.destino, frente: l.frente ? [paraPlano(pl, l.frente[0]), paraPlano(pl, l.frente[1])] as [Pt, Pt] : undefined })) };
  }
  const aneis: Pt[][] = ordemDoDesenho(pr, q).map((l) => l.pol.ext.slice());
  const destinos: Meta[] = aneis.map(() => ({}));
  for (const a of res.areas) {
    if (a.origem !== "lotes" || a.cfg !== q.cfg || q.cfg < 0) continue;
    for (const pg of a.pols) { aneis.push(pg.ext.slice()); destinos.push({ destino: a.tipo }); }
  }
  const base: QuadraCfg = ic >= 0 ? { ...pr.quadras[ic] } : { ancora: paraUtm(pl, ancoraDaQuadra(q)), ajustes: [] };
  base.ajustes = [];
  const quadras = pr.quadras.slice();
  let i = ic;
  if (i >= 0 && quadras[i]) quadras[i] = base; else { quadras.push(base); i = quadras.length - 1; }
  return { pr: { ...pr, quadras }, i, aneis: normalizar(aneis), destinos };
}

/** Área pública (verde, institucional) feita de lotes da quadra mudou de tamanho? → frase de aviso. */
function avisoPublica(antes: Pt[][], depois: Pt[][], destinos: Meta[], destinosDepois = destinos): string {
  const soma = (an: Pt[][], ds: Meta[]) => an.reduce((s2, a, k) => s2 + (ds[k]?.destino ? Math.abs(areaAssinada(a)) : 0), 0);
  const a0 = soma(antes, destinos), a1 = soma(depois, destinosDepois);
  return Math.abs(a1 - a0) > 0.5 ? ` Atenção: a área pública desta quadra mudou de ${fmt(a0)} para ${fmt(a1)} m².` : "";
}

function gravar(pr: Projeto, res: Resultado, i: number, aneis: Pt[][], destinos: Meta[]): Projeto {
  const pl = res.plano;
  const lotes: LoteDesenhado[] = [];
  aneis.forEach((a, k) => {
    if (a.length < 3) return;
    const m = destinos[k] ?? {};
    const ld: LoteDesenhado = { anel: a.map((p) => paraUtm(pl, p)) };
    if (m.destino) ld.destino = m.destino;
    // a frente escolhida acompanha o lado: o lado do contorno perto da linha
    // dela (girado até 45°, deslocado até 30% do comprimento) e que se sobrepõe
    // a ela. Longe disso o lote não tem mais aquele lado (o pedaço de trás de
    // um corte, o lado que foi parar no fundo): a escolha cai e o aviso volta.
    if (m.frente) {
      const [fa, fb] = m.frente;
      const L = dist(fa, fb);
      const d = unit(sub(fb, fa));
      const n = a.length;
      let melhor = -1, dm = Math.max(1.5, 0.3 * L);
      for (let j = 0; j < n; j++) {
        const p = a[j], q = a[(j + 1) % n];
        if (dist(p, q) < 0.5 || Math.abs(cross(d, unit(sub(q, p)))) > 0.71) continue;
        const t0 = dot(sub(p, fa), d), t1 = dot(sub(q, fa), d);
        if (Math.min(Math.max(t0, t1), L) - Math.max(Math.min(t0, t1), 0) < 0.5) continue;
        const dd = Math.abs(cross(d, sub(lerp(p, q, 0.5), fa)));
        if (dd < dm) { dm = dd; melhor = j; }
      }
      if (melhor >= 0) {
        // o lado inteiro: junta as arestas alinhadas (o "T" de um vizinho no meio)
        const reta = (x: number, y: number) => Math.abs(cross(unit(sub(a[y], a[x])), unit(sub(a[(melhor + 1) % n], a[melhor])))) < 0.02;
        let i0 = melhor, i1 = (melhor + 1) % n;
        for (let s = 0; s < n && reta((i0 - 1 + n) % n, i0) && (i0 - 1 + n) % n !== i1; s++) i0 = (i0 - 1 + n) % n;
        for (let s = 0; s < n && reta(i1, (i1 + 1) % n) && (i1 + 1) % n !== i0; s++) i1 = (i1 + 1) % n;
        ld.frente = [paraUtm(pl, a[i0]), paraUtm(pl, a[i1])];
      }
    }
    lotes.push(ld);
  });
  const quadras = pr.quadras.slice();
  quadras[i] = { ...quadras[i], lotes };
  return { ...pr, quadras };
}

/** Volta a quadra a ser dividida pelo sistema (some o desenho do operador). */
export function voltarAoAutomatico(pr: Projeto, q: Quadra, pl?: Resultado["plano"]): Projeto {
  const i = cfgDe(pr, q, pl);
  if (i < 0 || !Array.isArray(pr.quadras[i].lotes)) return pr;
  const quadras = pr.quadras.slice();
  const c = { ...quadras[i] };
  delete c.lotes;
  quadras[i] = c;
  return { ...pr, quadras };
}

/** Lote ou área pública (verde, institucional) — numa quadra desenhada; `null` volta a ser lote. */
export function mudarDestino(pr0: Projeto, res: Resultado, q: Quadra, indices: number[], destino: LoteDesenhado["destino"] | null): Edicao {
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const novos = destinos.map((d, k) => (indices.includes(k) ? { ...d, destino: destino ?? undefined } : d));
  return { pr: gravar(pr, res, i, aneis, novos), msg: destino ? `${indices.length === 1 ? "Lote" : `${indices.length} lotes`} → área pública.` : "Voltou a ser lote." };
}

/**
 * Lado do lote escolhido como frente (servidão, área verde, outro lote): o
 * lote passa a ter frente ali — medidas, avisos e memorial. Clicar de novo no
 * mesmo lado tira a escolha.
 */
export function definirFrente(pr0: Projeto, res: Resultado, q: Quadra, l: Lote, a: Pt, b: Pt): Edicao | null {
  const k = posicaoNoDesenho(pr0, res, l);
  if (k < 0 || dist(a, b) < 0.5) return null;
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const atual = destinos[k]?.frente;
  const d = unit(sub(b, a));
  const mesmo = !!atual && Math.abs(cross(d, unit(sub(atual[1], atual[0])))) < 0.1 && Math.abs(cross(d, sub(atual[0], a))) < 0.3;
  const metas = destinos.map((m, j) => (j === k ? { ...m, frente: mesmo ? undefined : [a, b] as [Pt, Pt] } : m));
  return { pr: gravar(pr, res, i, aneis, metas), msg: mesmo ? (l.lados.some((x) => x.tipo === "rua") ? "Escolha retirada — a frente do lote volta a ser a rua." : "Escolha retirada — o lote fica sem frente (aviso à esquerda).") : `Frente do lote escolhida: o lado de ${fmt(dist(a, b))} m — só ele conta como frente; medidas e avisos recalculados.`, sel: { quadra: q.nome, indices: [k] } };
}

/** Une o lote ao vizinho da quadra com quem ele divide a maior divisa. */
export function unirComVizinho(pr0: Projeto, res: Resultado, q: Quadra, l: Lote): Edicao | null {
  const ordem = ordemDoDesenho(pr0, q);
  const k = posicaoNoDesenho(pr0, res, l);
  const per = (pg: Poligono) => pg.ext.reduce((s2, p, j) => s2 + dist(p, pg.ext[(j + 1) % pg.ext.length]), 0);
  let melhor = -1, mc = 0.5;
  ordem.forEach((x, j) => {
    if (x === l) return;
    const u = uniaoFechada([l.pol, x.pol]);
    if (u.length !== 1) return;
    const c = (per(l.pol) + per(x.pol) - per(u[0])) / 2;
    if (c > mc) { mc = c; melhor = posicaoNoDesenho(pr0, res, x); }
  });
  if (melhor < 0 || k < 0) return null;
  return unirLotes(pr0, res, q, [k, melhor]);
}

// ---------------------------------------------------------------------------
// Topologia: vértice compartilhado é UM ponto em todos os lotes
// ---------------------------------------------------------------------------

/**
 * Junta vértices a menos de 1 cm e insere nos lados de cada lote os vértices
 * dos vizinhos que caem sobre eles (o "T" onde a divisa de um encontra o fundo
 * do outro). Assim mover um ponto move todos os lotes que o têm.
 */
export function normalizar(aneis: Pt[][]): Pt[][] {
  const pontos: Pt[] = [];
  const unico = (p: Pt): Pt => {
    for (const q of pontos) if (Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01) return q;
    pontos.push(p);
    return p;
  };
  let out = aneis.map((a) => a.map(unico));
  out = out.map((a) => {
    const r: Pt[] = [];
    for (let i = 0; i < a.length; i++) {
      const A = a[i], B = a[(i + 1) % a.length];
      r.push(A);
      const meio: { t: number; p: Pt }[] = [];
      for (const v of pontos) {
        if (v === A || v === B) continue;
        const { d, t } = distSegmento(v, A, B);
        if (d < 0.01 && t > 1e-4 && t < 1 - 1e-4) meio.push({ t, p: v });
      }
      meio.sort((x, y) => x.t - y.t).forEach((m) => r.push(m.p));
    }
    // sem repetição seguida
    return r.filter((p, i) => p !== r[(i + 1) % r.length]);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Movimentos
// ---------------------------------------------------------------------------

const naBorda = (q: Quadra, p: Pt): boolean => q.pol.ext.some((a, i) => distSegmento(p, a, q.pol.ext[(i + 1) % q.pol.ext.length]).d < 0.05);

function pontoNaBorda(q: Quadra, p: Pt): Pt {
  let melhor: Pt = p, dm = Infinity;
  const e = q.pol.ext;
  for (let i = 0; i < e.length; i++) {
    const a = e[i], b = e[(i + 1) % e.length];
    const { d, t } = distSegmento(p, a, b);
    if (d < dm) { dm = d; melhor = lerp(a, b, t); }
  }
  return melhor;
}

/** Linha de outros lotes que passa reta pelo ponto (a linha de fundo): par de lados colineares. */
function linhaPorDentro(aneis: Pt[][], p: Pt, ignorar: [Pt, Pt] | null): [Pt, Pt] | null {
  const dirs: Pt[] = [];
  const mesmo = (a: Pt, b: Pt) => dist(a, b) < TOL;
  for (const a of aneis) for (let i = 0; i < a.length; i++) {
    if (!mesmo(a[i], p)) continue;
    for (const viz of [a[(i + 1) % a.length], a[(i - 1 + a.length) % a.length]]) {
      if (ignorar && (mesmo(viz, ignorar[0]) || mesmo(viz, ignorar[1]))) continue;
      if (dist(viz, p) > 0.05) dirs.push(unit(sub(viz, p)));
    }
  }
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
    if (dot(dirs[i], dirs[j]) < -0.999) return [p, soma(p, dirs[i])];
  }
  return null;
}

function moverPontos(aneis: Pt[][], mapa: { de: Pt; para: Pt }[], so?: (k: number) => boolean): Pt[][] {
  return aneis.map((a, k) => (so && !so(k) ? a : a.map((v) => {
    for (const m of mapa) if (dist(v, m.de) < TOL) return m.para;
    return v;
  })));
}

const distBorda = (q: Quadra, p: Pt): number => q.pol.ext.reduce((m, a, i) => Math.min(m, distSegmento(p, a, q.pol.ext[(i + 1) % q.pol.ext.length]).d), Infinity);

const caixa = (a: Pt[]): [number, number, number, number] => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of a) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1];
};

/** O contorno se cruza (a quina passou por cima de outro lado do próprio lote)? */
function seCruza(a: Pt[]): boolean {
  const n = a.length;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
    if (i === 0 && j === n - 1) continue;
    const p = a[i], r = sub(a[(i + 1) % n], p), s = sub(a[(j + 1) % n], a[j]);
    const x = intersecaoRetas(p, r, a[j], s);
    if (x && x.t > 1e-6 && x.t < 1 - 1e-6 && x.u > 1e-6 && x.u < 1 - 1e-6) return true;
  }
  return false;
}

/**
 * Assenta os contornos depois de um arraste: o que se vê é o que se edita.
 * Quina puxada por cima de outra divisa cruza o contorno (vira "gravata") ou
 * invade o vizinho; o desenho mostra só o pedaço limpo, e as alças ficavam em
 * pontos que não existiam no contorno gravado — a quina "travava". Aqui cada
 * contorno vira o pedaço que aparece: o lote arrastado (`dono`) tem a vez, os
 * outros ficam com o que sobra; o pedaço solto de um contorno que se cruzou vai
 * para o vizinho que mais encosta nele. Contorno que some sai da lista: `mapa`
 * dá a posição nova de cada um (-1 = sumiu).
 */
function assentar(antes: Pt[][], depois: Pt[][], destinos: Meta[], q: Quadra, dono: number, ponto?: Pt): { aneis: Pt[][]; destinos: Meta[]; mapa: number[] } {
  const igual = depois.map((a, k) => a === antes[k] || (a.length === antes[k]?.length && a.every((p, j) => dist(p, antes[k][j]) < 1e-9)));
  const caixas = depois.map(caixa);
  const tocam = (k: number, j: number) => caixas[k][0] < caixas[j][2] && caixas[j][0] < caixas[k][2] && caixas[k][1] < caixas[j][3] && caixas[j][1] < caixas[k][3];
  const pg = (a: Pt[]): Poligono => ({ ext: antiHorario(a), furos: [] });
  const area = (ps: Poligono[]) => ps.reduce((s2, x) => s2 + areaPol(x), 0);
  // caminho rápido: os contornos que mudaram continuam limpos, dentro da quadra e sem invadir ninguém
  // (contorno que mudou e ficou sem área — quina solta sobre a quina oposta — vai pelo caminho completo e sai)
  const limpo = depois.every((a, k) => igual[k] || (
    a.length >= 3 && Math.abs(areaAssinada(a)) >= 0.05 && !seCruza(a) && area(diferenca([pg(a)], [q.pol])) < 0.05
    && depois.every((b, j) => j === k || b.length < 3 || !tocam(k, j) || area(intersecao([pg(a)], [pg(b)])) < 0.05)
  ));
  if (limpo) return { aneis: depois, destinos, mapa: depois.map((_, k) => k) };
  const ordem = [...(dono >= 0 && dono < depois.length ? [dono] : []), ...depois.map((_, k) => k).filter((k) => k !== dono)];
  const usados: Poligono[] = [];
  const fica: (Pt[] | null)[] = depois.map(() => null);
  const soltos: Poligono[] = [];
  for (const k of ordem) {
    const a = depois[k];
    if (a.length < 3 || Math.abs(areaAssinada(a)) < 0.05 && !seCruza(a)) continue;
    const ped = diferenca(intersecao([pg(a)], [q.pol]), usados).filter((x) => areaPol(x) > 0.05).sort((x, y) => areaPol(y) - areaPol(x));
    // o lote arrastado fica com o pedaço onde está a quina que o operador
    // segura (não o maior): a alça acompanha o cursor, nunca "pula"
    if (k === dono && ponto && ped.length > 1) {
      const perto = (x: Poligono) => Math.min(...x.ext.map((v) => dist(v, ponto)));
      ped.sort((x, y) => perto(x) - perto(y));
    }
    if (!ped.length) continue;
    fica[k] = ped[0].ext;
    // o pedaço solto também já tem dono (vai para um vizinho logo abaixo):
    // os contornos seguintes não podem pegá-lo de novo — senão sobrepõe
    usados.push({ ext: ped[0].ext, furos: [] }, ...ped.slice(1));
    soltos.push(...ped.slice(1));
  }
  // pedaço solto vai para o vizinho com quem divide a maior divisa (nada de sobra)
  const per = (p: Poligono) => p.ext.reduce((s2, x, j) => s2 + dist(x, p.ext[(j + 1) % p.ext.length]), 0);
  for (const s of soltos) {
    let melhor = -1, mc = 0.05, uniao: Poligono | null = null;
    fica.forEach((a, k) => {
      if (!a) return;
      const u = uniaoFechada([pg(a), s]);
      if (u.length !== 1 || u[0].furos.length) return;
      const c = (per(pg(a)) + per(s) - per(u[0])) / 2;
      if (c > mc) { mc = c; melhor = k; uniao = u[0]; }
    });
    if (melhor >= 0 && uniao) fica[melhor] = (uniao as Poligono).ext;
  }
  // rede final: nada sobreposto (o contorno guardado é só o contorno de fora —
  // um furo ou a união de um pedaço solto podiam cobrir o lote de outro)
  const finais: Poligono[] = [];
  for (const k of ordem) {
    const a = fica[k];
    if (!a) continue;
    const ped = diferenca([pg(a)], finais).filter((x) => areaPol(x) > 0.05).sort((x, y) => areaPol(y) - areaPol(x));
    fica[k] = ped.length ? ped[0].ext : null;
    if (ped.length) finais.push({ ext: ped[0].ext, furos: [] });
  }
  const aneis: Pt[][] = [], ds: Meta[] = [], mapa: number[] = [];
  fica.forEach((a, k) => {
    if (!a) { mapa.push(-1); return; }
    mapa.push(aneis.length);
    aneis.push(limparAnel(a, 0.003));
    ds.push(destinos[k] ?? {});
  });
  return { aneis: normalizar(aneis), destinos: ds, mapa };
}

/** Edição de arraste: assenta, grava e devolve a seleção no lugar novo do lote arrastado. */
function aplicarArraste(pr: Projeto, res: Resultado, q: Quadra, i: number, aneis: Pt[][], novos: Pt[][], destinos: Meta[], dono: number, msg: string, ponto?: Pt): Edicao {
  const ass = assentar(aneis, novos, destinos, q, dono, ponto);
  const sumiram = ass.mapa.filter((x) => x < 0).length;
  const k = dono >= 0 ? ass.mapa[dono] : -1;
  return {
    pr: gravar(pr, res, i, ass.aneis, ass.destinos),
    msg: `${msg}${sumiram ? ` ${sumiram === 1 ? "Um lote foi engolido" : `${sumiram} lotes foram engolidos`} (Ctrl+Z desfaz).` : ""}${avisoPublica(aneis, ass.aneis, destinos, ass.destinos)}`,
    sel: k >= 0 ? { quadra: q.nome, indices: [k] } : undefined,
  };
}

/**
 * Arrasta uma quina. A borda da quadra (rua, divisa da gleba) é um ímã: com o
 * cursor até `ima` metros dela, a quina corre pela borda (o lote não descola
 * da rua); mais longe, ela vai aonde o operador puxar. `livre` solta de vez.
 * `dono` = posição no desenho do lote arrastado (ele tem a vez se invadir o vizinho).
 */
export function moverQuina(pr0: Projeto, res: Resultado, q: Quadra, de: Pt, para: Pt, livre = false, ima = Infinity, dono = -1): Edicao {
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const alvo = !livre && naBorda(q, de) && distBorda(q, para) <= ima ? pontoNaBorda(q, para) : para;
  const novos = normalizar(moverPontos(aneis, [{ de, para: alvo }]));
  return aplicarArraste(pr, res, q, i, aneis, novos, destinos, dono, `Quina movida ${fmt(dist(de, alvo))} m — os lotes vizinhos se ajustaram.`, alvo);
}

/**
 * Desliza uma divisa paralela a ela mesma (aumenta a largura ou o fundo do
 * lote; o vizinho do outro lado diminui). As pontas da divisa correm pela
 * borda da quadra ou pela linha de fundo, como na régua do projetista.
 */
export function moverDivisa(pr0: Projeto, res: Resultado, q: Quadra, a: Pt, b: Pt, desloc: number, livre = false, dono = -1): Edicao {
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const novos = normalizar(deslizar(aneis, q, a, b, desloc, livre));
  return aplicarArraste(pr, res, q, i, aneis, novos, destinos, dono, `Divisa deslocada ${fmt(Math.abs(desloc))} m — os lotes dos dois lados se ajustaram.`);
}

function deslizar(aneis: Pt[][], q: Quadra, a: Pt, b: Pt, desloc: number, livre: boolean): Pt[][] {
  const u = unit(sub(b, a));
  const n = esquerda(u);
  const A2 = soma(a, mult(n, desloc)), B2 = soma(b, mult(n, desloc));
  // os lotes dos dois lados da divisa (os que têm um lado sobre ela)
  const naDivisa = (an: Pt[]) => an.some((v, j) => {
    const w = an[(j + 1) % an.length];
    return dist(v, w) > TOL && distSegmento(v, a, b).d < TOL && distSegmento(w, a, b).d < TOL;
  });
  // ponta que andou solta (Alt, ou sem guia): todos os lotes que a têm vão junto
  const soltas: Pt[] = [];
  const ponta = (e: Pt, alvo: Pt): Pt => {
    // Alt solta só a ponta de dentro: a da rua/divisa da gleba sempre corre pela borda
    if (livre && !naBorda(q, e)) { soltas.push(e); return alvo; }
    // guias: os lados dos lotes que chegam nesta ponta (a frente na rua, o
    // fundo, a lateral do próprio lote quando a divisa é a frente ou o fundo),
    // a borda da quadra e a linha de outros lotes que passa reta pelo ponto.
    // Lote de trás (tem a ponta mas não a divisa) fica parado: a ponta tem de
    // correr por um lado DELE — senão abre uma fresta entre ele e os que andam
    const deTras = aneis.some((an) => !naDivisa(an) && an.some((v) => dist(v, e) < TOL));
    const guias: [Pt, Pt][] = [];
    for (const an of aneis) {
      if (deTras && naDivisa(an)) continue;
      for (let j = 0; j < an.length; j++) {
        if (dist(an[j], e) > TOL) continue;
        for (const viz of [an[(j + 1) % an.length], an[(j - 1 + an.length) % an.length]]) {
          if (dist(viz, e) < 0.05 || distSegmento(viz, a, b).d < TOL) continue;
          guias.push([e, viz]);
        }
      }
    }
    if (naBorda(q, e)) {
      const ex = q.pol.ext;
      guias.push(...ex.map((x, k) => [x, ex[(k + 1) % ex.length]] as [Pt, Pt]).filter(([x, y]) => distSegmento(e, x, y).d < 0.05 || dist(e, x) < 0.05 || dist(e, y) < 0.05));
    }
    const l0 = linhaPorDentro(aneis, e, [a, b]);
    if (l0) guias.push(l0);
    let melhor: Pt | null = null, dm = Infinity;
    for (const [x, y] of guias) {
      // guia paralela à divisa não dá ponto de encontro
      if (Math.abs(cross(u, unit(sub(y, x)))) < 0.15) continue;
      const r = intersecaoRetas(A2, u, x, sub(y, x));
      if (!r) continue;
      const d = dist(r.pt, alvo);
      if (d < dm && d < Math.abs(desloc) * 4 + 5) { dm = d; melhor = r.pt; }
    }
    if (!melhor) soltas.push(e);
    return melhor ?? alvo;
  };
  const a2 = ponta(a, A2), b2 = ponta(b, B2);
  // pontos no meio da divisa (o "T" de um vizinho) andam junto, na mesma proporção
  const mapa: { de: Pt; para: Pt }[] = [{ de: a, para: a2 }, { de: b, para: b2 }];
  const L = dist(a, b);
  for (const an of aneis) for (const v of an) {
    if (dist(v, a) < TOL || dist(v, b) < TOL) continue;
    const { d, t } = distSegmento(v, a, b);
    if (d < TOL && t > 0 && t < 1 && L > 0 && !mapa.some((m) => dist(m.de, v) < TOL)) mapa.push({ de: v, para: lerp(a2, b2, t) });
  }
  // só os lotes dos dois lados da divisa andam; o de trás (na outra fileira),
  // que só toca a ponta dela, fica como está — o ponto novo cai no lado dele
  const guiadas = mapa.filter((m) => !soltas.some((x) => dist(x, m.de) < TOL));
  const livres = mapa.filter((m) => soltas.some((x) => dist(x, m.de) < TOL));
  // Na ponta, cada lote da divisa olha o lado dele que SAI da ponta: se a ponta
  // nova cai nesse lado, o lote encolhe por ele (troca a ponta); senão o lote
  // fica com a ponta velha e ganha a nova ao lado — é o lado que passa reto
  // (a divisa é só um trecho dele, que segue encostado no lote de trás) ou a
  // quina da rua (a ponta correu pelo outro lado da quina). Trocar nesses
  // casos entortava o lado e abria fresta.
  const naLinha = (p: Pt) => distSegmento(p, a, b).d < TOL;
  const guiar = (an: Pt[]): Pt[] => {
    const n = an.length, out: Pt[] = [];
    for (let j = 0; j < n; j++) {
      const v = an[j], m = guiadas.find((x) => dist(x.de, v) < TOL);
      if (!m) { out.push(v); continue; }
      const ehPonta = dist(v, a) < TOL || dist(v, b) < TOL;
      const ant = an[(j - 1 + n) % n], seg = an[(j + 1) % n];
      const antNaDivisa = naLinha(ant) && dist(ant, v) > TOL;
      const fora = antNaDivisa ? seg : ant;
      const noLado = dist(fora, v) < TOL || naLinha(fora) || distSegmento(m.para, v, fora).d < TOL;
      if (!ehPonta || noLado || dist(m.para, v) < TOL) out.push(m.para);
      else if (antNaDivisa) out.push(m.para, v);
      else out.push(v, m.para);
    }
    return out;
  };
  return moverPontos(aneis, livres).map((an, k) => (naDivisa(aneis[k]) ? guiar(an) : an));
}

// ---------------------------------------------------------------------------
// Apagar, desenhar, unir, dividir, cortar
// ---------------------------------------------------------------------------

export function apagarLotes(pr0: Projeto, res: Resultado, q: Quadra, indices: number[]): Edicao {
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const fica = (_: unknown, k: number) => !indices.includes(k);
  return {
    pr: gravar(pr, res, i, aneis.filter(fica), destinos.filter(fica)),
    msg: `${indices.length === 1 ? "Lote apagado" : `${indices.length} lotes apagados`} — a área ficou livre. Desenhe um lote nela (L) ou mova as divisas dos vizinhos.`,
  };
}

/**
 * Lote desenhado pelo operador: o contorno dele manda. O que ele cobre sai dos
 * lotes vizinhos (eles se ajustam ao desenho) e o lote fica dentro da quadra.
 */
export function desenharLote(pr0: Projeto, res: Resultado, anel: Pt[]): Edicao | null {
  const pol: Poligono = { ext: antiHorario(anel), furos: [] };
  let q: Quadra | null = null, melhor = 0;
  for (const x of [...res.quadras, ...(res.quadrasVazias ?? [])]) {
    const a = intersecao([pol], [x.pol]).reduce((s, y) => s + areaPol(y), 0);
    if (a > melhor) { melhor = a; q = x; }
  }
  if (!q || melhor < 1) return null;
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  // o lote desenhado manda sobre os lotes — não sobre a área pública da quadra
  const publicas = aneis.filter((_, k) => destinos[k]?.destino).map((a) => ({ ext: antiHorario(a), furos: [] as Pt[][] }));
  const novo = diferenca(intersecao([pol], [q.pol]), publicas).sort((x, y) => areaPol(y) - areaPol(x))[0];
  if (!novo || areaPol(novo) < 1) return null;
  const ext = limparAnel(novo.ext, 0.005);
  const outros: Pt[][] = [], dOutros: Meta[] = [];
  aneis.forEach((a, k) => {
    if (destinos[k]?.destino) { outros.push(a); dOutros.push(destinos[k]); return; }
    const resto = diferenca([{ ext: antiHorario(a), furos: [] }], [{ ext, furos: [] }]).filter((x) => areaPol(x) > 1).sort((x, y) => areaPol(y) - areaPol(x));
    if (!resto.length) return;
    outros.push(limparAnel(resto[0].ext, 0.003));
    dOutros.push(destinos[k]);
  });
  const todos = normalizar([...outros, ext]);
  const k = todos.length - 1;
  return { pr: gravar(pr, res, i, todos, [...dOutros, {}]), msg: `Lote desenhado com ${fmt(areaPol({ ext, furos: [] }))} m² — os vizinhos se ajustaram ao contorno.`, sel: { quadra: q.nome, indices: [k] } };
}

export function unirLotes(pr0: Projeto, res: Resultado, q: Quadra, indices: number[]): Edicao | null {
  if (indices.length < 2) return null;
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const u = uniaoFechada(indices.map((k) => ({ ext: antiHorario(aneis[k]), furos: [] })));
  if (u.length !== 1 || u[0].furos.length) return null;
  const alvo = Math.min(...indices);
  const novos = aneis.map((a, k) => (k === alvo ? limparAnel(u[0].ext, 0.005) : a)).filter((_, k) => k === alvo || !indices.includes(k));
  const dest = destinos.filter((_, k) => k === alvo || !indices.includes(k));
  return { pr: gravar(pr, res, i, normalizar(novos), dest), msg: `${indices.length} lotes unidos em um de ${fmt(areaPol(u[0]))} m².`, sel: { quadra: q.nome, indices: [alvo] } };
}

/** Direção das divisas laterais do lote (média dos lados que encostam na frente), para dividir sem entortar. */
function direcoesDoLote(l: Lote): { o: Pt; d: Pt; c: Pt | undefined } {
  const fr = l.lados.filter((x) => x.tipo === "rua" || x.tipo === "via");
  const maior = (fr.length ? fr : l.lados).reduce((m, x) => (x.comp > m.comp ? x : m), (fr.length ? fr : l.lados)[0]);
  const d = unit(sub(maior.b, maior.a));
  const vv = esquerda(d);
  let soma2: Pt = [0, 0];
  for (const x of l.lados) {
    if (x === maior || x.comp < 2) continue;
    const toca = dist(x.a, maior.b) < 0.05 || dist(x.b, maior.a) < 0.05;
    if (!toca) continue;
    let w = unit(sub(x.b, x.a));
    if (dot(w, vv) < 0) w = mult(w, -1);
    if (Math.abs(cross(w, d)) > 0.5) soma2 = soma(soma2, w);
  }
  return { o: maior.a, d, c: soma2[0] || soma2[1] ? unit(soma2) : undefined };
}

export function dividirLote(pr0: Projeto, res: Resultado, q: Quadra, l: Lote, n: number): Edicao | null {
  const k = posicaoNoDesenho(pr0, res, l);
  if (k < 0 || n < 2) return null;
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const pol: Poligono = { ext: antiHorario(aneis[k]), furos: [] };
  const { o, d, c } = direcoesDoLote(l);
  const GR = pol.ext.reduce((m, p) => Math.max(m, dist(p, o)), 0) + 50;
  const partes = partirIgual(pol, o, d, n, GR, c);
  if (!partes) return null;
  const novos = [...aneis.slice(0, k), ...partes.map((x) => x.ext), ...aneis.slice(k + 1)];
  const dest = [...destinos.slice(0, k), ...partes.map(() => destinos[k]), ...destinos.slice(k + 1)];
  return {
    pr: gravar(pr, res, i, normalizar(novos), dest),
    msg: `Lote dividido em ${n} de ${fmt(areaPol(pol) / n)} m² — as divisas seguem as laterais dele.`,
    sel: { quadra: q.nome, indices: partes.map((_, j) => k + j) },
  };
}

/** Corta pela linha P→Q todo lote que ela atravessa (divisão do jeito do operador). */
export function cortarLotes(pr0: Projeto, res: Resultado, P: Pt, Q: Pt): Edicao | null {
  if (dist(P, Q) < 0.5) return null;
  const d = unit(sub(Q, P));
  // o segmento (não a reta inteira) atravessa o lote: corta um lado dele
  const cruza = (pg: Poligono) => {
    const e = pg.ext;
    let cortes = 0;
    for (let i = 0; i < e.length; i++) {
      const a = e[i], b = e[(i + 1) % e.length];
      const r = intersecaoRetas(P, sub(Q, P), a, sub(b, a));
      if (r && r.t > 0 && r.t < 1 && r.u >= 0 && r.u <= 1) cortes++;
    }
    return cortes >= 2;
  };
  const porQuadra = new Map<Quadra, Lote[]>();
  for (const l of res.lotes) {
    if (!cruza(l.pol)) continue;
    const q = res.quadras.find((x) => x.nome === l.quadra);
    if (!q) continue;
    porQuadra.set(q, [...(porQuadra.get(q) ?? []), l]);
  }
  if (!porQuadra.size) return null;
  let pr = pr0, cortados = 0;
  for (const [q0, ls] of porQuadra) {
    const q = q0;
    const ks = ls.map((l) => posicaoNoDesenho(pr0, res, l));
    const c = contornos(pr, res, q);
    pr = c.pr;
    const novos: Pt[][] = [], dest: Meta[] = [];
    c.aneis.forEach((a, k) => {
      if (!ks.includes(k)) { novos.push(a); dest.push(c.destinos[k]); return; }
      const pg: Poligono = { ext: antiHorario(a), furos: [] };
      // corta pelo SEGMENTO (fenda de 4 mm), não pela reta inteira: no lote em
      // L o braço que a linha não atravessa fica inteiro
      const partes = diferenca([pg], bufferLinha([P, Q], 0.004, "reta")).filter((x) => areaPol(x) > 0.5);
      // lasca (menos de 5 m²) não vira lote: a linha só raspou a quina
      if (partes.length < 2 || partes.some((x) => areaPol(x) < 5)) { novos.push(a); dest.push(c.destinos[k]); return; }
      for (const x of partes) { novos.push(limparAnel(x.ext, 0.003)); dest.push(c.destinos[k]); }
      cortados++;
    });
    pr = gravar(pr, res, c.i, normalizar(novos), dest);
  }
  if (!cortados) return null;
  return { pr, msg: `${cortados === 1 ? "Lote cortado" : `${cortados} lotes cortados`} pela linha.` };
}

// ---------------------------------------------------------------------------
// Frente e área digitadas: a divisa lateral desliza até chegar no valor
// ---------------------------------------------------------------------------

/**
 * Leva o lote à frente (m) ou à área (m²) pedida deslizando UMA divisa lateral
 * — a que dá para o vizinho (ele cede ou ganha a diferença).
 */
export function acertarMedida(pr0: Projeto, res: Resultado, q: Quadra, l: Lote, campo: "frente" | "area", alvo: number, naoMexer: number[] = []): Edicao | null {
  const k = posicaoNoDesenho(pr0, res, l);
  if (k < 0) return null;
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const anel = aneis[k];
  // a frente escolhida pelo operador é a frente que conta (é a que o painel mostra)
  const principal = l.lados.filter((x) => x.principal);
  const todasFrentes = principal.length ? principal : l.lados.filter((x) => x.tipo === "rua" || x.tipo === "via");
  if (!todasFrentes.length) return null;
  const sobre = (f: { a: Pt; b: Pt }, a: Pt, b: Pt) => Math.abs(cross(unit(sub(f.b, f.a)), sub(lerp(a, b, 0.5), f.a))) < 0.05;
  const emAlgumaFrente = (a: Pt, b: Pt) => todasFrentes.some((f) => sobre(f, a, b));
  // divisas laterais: lados que não estão na borda e encostam numa frente
  const cand: { a: Pt; b: Pt; viz: number; frente: [Pt, Pt] }[] = [];
  for (let j = 0; j < anel.length; j++) {
    const a = anel[j], b = anel[(j + 1) % anel.length];
    if (dist(a, b) < 1 || naBorda(q, lerp(a, b, 0.5))) continue;
    let frente: [Pt, Pt] | null = null;
    for (let m = 0; m < anel.length && !frente; m++) {
      const v = anel[m], w = anel[(m + 1) % anel.length];
      if (dist(v, w) > 0.3 && emAlgumaFrente(v, w) && (dist(v, a) < TOL || dist(w, a) < TOL || dist(v, b) < TOL || dist(w, b) < TOL)) frente = [v, w];
    }
    if (!frente) continue;
    const viz = aneis.findIndex((x, m) => m !== k && x.some((v) => dist(v, a) < TOL) && x.some((v) => dist(v, b) < TOL));
    cand.push({ a, b, viz, frente });
  }
  if (!cand.length) return null;
  // a que dá para um lote vizinho (área pública só se não houver outra); entre duas, a do vizinho maior (ele cede melhor)
  // (e nunca a de um lote que acabou de ser acertado na mesma operação)
  const area = (m: number) => (m >= 0 ? Math.abs(areaAssinada(aneis[m])) - (destinos[m]?.destino ? 1e7 : 0) - (naoMexer.includes(m) ? 2e7 : 0) : -1);
  const lado = cand.sort((x, y) => area(y.viz) - area(x.viz))[0];
  // frente = soma dos lados de rua (a mesma medida do painel e do aviso da planta)
  const naFrente = emAlgumaFrente;
  const medir = (an: Pt[]) => (campo === "area"
    ? Math.abs(areaAssinada(an))
    : an.reduce((s2, v, j) => { const w = an[(j + 1) % an.length]; return s2 + (naFrente(v, w) ? dist(v, w) : 0); }, 0));
  // sentido que aumenta o lote: a normal para FORA dele (n aponta para dentro → o contrário)
  const u = unit(sub(lado.b, lado.a));
  const n = esquerda(u);
  const dentro = dot(sub(lerp(lado.a, lado.b, 0.5), centroDe(anel)), n) < 0;
  const sinal = dentro ? -1 : 1;
  const aplicar = (s: number) => normalizar(deslizar(aneis, q, lado.a, lado.b, sinal * s, false));
  const atual = medir(anel);
  if (Math.abs(atual - alvo) < 0.005) return { pr: pr0, erro: true, msg: `O lote já tem ${fmt(alvo)} ${campo === "area" ? "m²" : "m"}.` };
  // anda em passos de meio metro para o lado certo até passar do valor (sem
  // atravessar o vizinho nem o próprio lote) e refina por bissecção
  const sentido = alvo > atual ? 1 : -1;
  // (contorno já esmagado antes não conta — senão um lote sumido travaria a quadra inteira)
  const valido = (an: Pt[][]) => an.every((x, m) => Math.abs(areaAssinada(aneis[m])) < 1 || (Math.sign(areaAssinada(x)) === Math.sign(areaAssinada(aneis[m])) && Math.abs(areaAssinada(x)) > 1));
  let lo = 0, mLo = atual, hi = NaN;
  for (let s2 = 0.5; s2 <= 80; s2 += 0.5) {
    const an = aplicar(sentido * s2);
    if (!valido(an)) break;
    const m = medir(an[k]);
    if ((m - alvo) * (mLo - alvo) <= 0) { hi = s2; break; }
    lo = s2; mLo = m;
  }
  if (!Number.isFinite(hi)) {
    return { pr: pr0, erro: true, msg: `Não dá para chegar em ${fmt(alvo)} ${campo === "area" ? "m²" : "m"} deslizando a divisa (o mais perto é ${fmt(mLo)}) — arraste as quinas ou apague o vizinho.` };
  }
  for (let it = 0; it < 40; it++) {
    const s2 = (lo + hi) / 2;
    const m = medir(aplicar(sentido * s2)[k]);
    if ((m - alvo) * (mLo - alvo) > 0) { lo = s2; mLo = m; } else hi = s2;
    if (hi - lo < 1e-4) break;
  }
  const s = sentido * (lo + hi) / 2;
  const novos = aplicar(s);
  return {
    pr: gravar(pr, res, i, novos, destinos),
    msg: `Lote com ${fmt(medir(novos[k]))} ${campo === "area" ? "m²" : "m de frente"} — a divisa deslizou ${fmt(Math.abs(s))} m e o vizinho se ajustou.${avisoPublica(aneis, novos, destinos)}`,
    sel: { quadra: q.nome, indices: [k] },
  };
}

const centroDe = (an: Pt[]): Pt => [an.reduce((s, p) => s + p[0], 0) / an.length, an.reduce((s, p) => s + p[1], 0) / an.length];

// ---------------------------------------------------------------------------
// Alças: o que o editor mostra no lote selecionado
// ---------------------------------------------------------------------------

export interface Alca { tipo: "quina" | "divisa"; p: Pt; a?: Pt; b?: Pt; naBorda: boolean }

/** Lados retos do polígono, de quina a quina (o arco da esquina fica de fora). */
export function ladosRetos(pol: Poligono): [Pt, Pt][] {
  const e = pol.ext, n = e.length;
  const qs = [...new Set(quinasDe(e, 2, 3))].sort((x, y) => x - y);
  const out: [Pt, Pt][] = [];
  for (let k = 0; k < qs.length; k++) {
    const i0 = qs[k], i1 = qs[(k + 1) % qs.length];
    const a = e[i0], b = e[i1];
    if (dist(a, b) < 1.5) continue;
    let reto = true;
    for (let j = i0; j !== i1 && reto; j = (j + 1) % n) if (distSegmento(e[(j + 1) % n], a, b).d > 0.05) reto = false;
    if (reto) out.push([a, b]);
  }
  return out;
}

/**
 * Alças do lote: uma em cada quina (o arco da esquina não tem — é da rua) e
 * uma no meio de cada divisa que não é a borda da quadra (deslizar a divisa
 * muda a largura ou o fundo). Divisa da borda (rua, divisa da gleba) não anda.
 */
export function alcasDoLote(l: Lote, q: Quadra): Alca[] {
  const e = l.pol.ext, n = e.length;
  const out: Alca[] = [];
  if (n < 3) return out;
  // arco da esquina: dois ou mais lados curtos seguidos, virando pouco em cada
  // ponto (a rua fazendo a curva) — é da rua, sem alça. Lado curto que o
  // operador criou (quina dobrada, lasca) vira muito e continua com alça.
  const curta = (j: number) => dist(e[((j % n) + n) % n], e[(((j + 1) % n) + n) % n]) < 2;
  const deArco = (j: number) => curta(j) && (curta(j - 1) || curta(j + 1));
  const giro = e.map((_, i) => Math.abs(giroEm(e, i)));
  // ponto reto: é o "T" de um vizinho (o lado dele chega ali e vira) — sem alça
  // neste lote; ponto reto que ninguém usa é quina que o operador alinhou: tem
  // alça (senão ela sumia e não voltava)
  const ehT = (p: Pt) => q.lotes.some((o) => o !== l && o.pol.ext.some((v, j) => dist(v, p) < TOL && Math.abs(giroEm(o.pol.ext, j)) >= 0.5));
  // dobra da rua (ponto da borda da quadra que vira pouco): o lote segue a
  // borda de qualquer jeito — a alça ali não mexeria em nada
  const dobraDaRua = (i: number) => giro[i] < 12 && q.pol.ext.some((v) => dist(v, e[i]) < TOL);
  const pontas: number[] = [];
  for (let i = 0; i < n; i++) {
    if (giro[i] < 0.5 && ehT(e[i])) continue;
    pontas.push(i);
    if (dobraDaRua(i) || (giro[i] < 35 && (deArco(i - 1) || deArco(i)))) continue;
    out.push({ tipo: "quina", p: e[i], naBorda: naBorda(q, e[i]) });
  }
  // lados retos de ponta a ponta (o "T" no meio não corta o lado)
  for (let k = 0; k < pontas.length; k++) {
    const i0 = pontas[k], i1 = pontas[(k + 1) % pontas.length];
    const a = e[i0], b = e[i1];
    if (dist(a, b) < 1.5) continue;
    // o caminho entre as duas pontas tem de ser UMA reta (o arco da esquina não
    // anda); o lado na borda (frente na rua, fundo na divisa) também tem alça
    let reto = true, borda = true;
    for (let j = i0; j !== i1 && reto; j = (j + 1) % n) {
      const p0 = e[j], p1 = e[(j + 1) % n];
      if (distSegmento(p1, a, b).d > 0.05 || deArco(j)) reto = false;
      if (!naBorda(q, lerp(p0, p1, 0.5))) borda = false;
    }
    if (!reto) continue;
    out.push({ tipo: "divisa", p: lerp(a, b, 0.5), a, b, naBorda: borda });
  }
  return out;
}
