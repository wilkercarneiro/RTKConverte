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
  giroEm, intersecaoRetas, lerp, limparAnel, mult, quinasDe, quinasDetalhe, soma, sub, uniaoFechada, unit,
} from "./geom.ts";
import type { Poligono, Pt } from "./geom.ts";
import { ancoraDaQuadra } from "./auto.ts";
import { encaixarNasQuinas, fmt, partirIgual } from "./calculo.ts";
import type { Lote, Quadra, Resultado } from "./calculo.ts";
import { paraPlano, paraUtm } from "./plano.ts";
import type { LoteDesenhado, Projeto, QuadraCfg } from "./modelo.ts";

const TOL = 0.02;

/** O que acompanha cada contorno: destino (área pública), a frente escolhida (plano) e se o lote passa da quadra. */
export interface Meta { destino?: LoteDesenhado["destino"]; frente?: [Pt, Pt]; livre?: boolean }

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
  return desenhadaAMao(q) ? [...q.lotes].sort((a, b) => a.indice - b.indice) : [...q.lotes].sort((a, b) => a.numero - b.numero);
}

/**
 * Quadra com os lotes gravados (desenho à mão): o índice do lote É a posição no desenho.
 * A quadra da linha central também marca os lotes como "manual" (nenhum ajuste
 * automático mexe neles), mas o índice dela é a posição DENTRO da fileira (ida e
 * volta) — repetido nas duas fileiras. Tratada como desenhada, a operação caía no
 * lote errado (igualar A-03…A-06 mexia em A-08, A-09, A-23 e A-24).
 */
const desenhadaAMao = (q: Quadra) => !q.estruturada && q.lotes.some((l) => l.manual);

/** Posição do lote no desenho da quadra (o índice que as operações usam). */
export function posicaoNoDesenho(pr: Projeto, res: Resultado, l: Lote): number {
  const q = res.quadras.find((x) => x.nome === l.quadra);
  if (!q) return -1;
  return desenhadaAMao(q) ? l.indice : ordemDoDesenho(pr, q).indexOf(l);
}

/**
 * Garante a quadra desenhada e devolve os contornos (no plano) e o índice da
 * config. Os lotes viram contornos na ordem da numeração; as áreas públicas
 * feitas de lotes da quadra também (com o destino delas).
 */
export function contornos(pr: Projeto, res: Resultado, q: Quadra): { pr: Projeto; i: number; aneis: Pt[][]; destinos: Meta[] } {
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
    return { pr, i: ic, aneis: normalizar(aneis), destinos: c.lotes!.map((l) => ({ destino: l.destino, frente: l.frente ? [paraPlano(pl, l.frente[0]), paraPlano(pl, l.frente[1])] as [Pt, Pt] : undefined, livre: l.livre })) };
  }
  // o lote que absorveu um retalho de fora da quadra (o canto que sobrou da quadra
  // vizinha) congela RECORTADO pela quadra: o retalho volta a ser retalho e o cálculo
  // o junta de novo ao lote — guardado inteiro, ele ficava em duas quadras ao mesmo
  // tempo e a vizinha se redividia por baixo dele (lotes sobrepostos)
  const aneis: Pt[][] = ordemDoDesenho(pr, q).map((l) => {
    if (diferenca([l.pol], [q.pol]).reduce((s2, x) => s2 + areaPol(x), 0) < 0.05) return l.pol.ext.slice();
    const dentro = intersecao([l.pol], [q.pol]).sort((x, y) => areaPol(y) - areaPol(x))[0];
    return dentro ? limparAnel(dentro.ext, 0.003) : l.pol.ext.slice();
  });
  const destinos: Meta[] = aneis.map(() => ({}));
  // áreas públicas feitas de lotes desta quadra: pela geometria — a área verde que
  // juntou lotes de duas quadras vizinhas fica registrada numa só, e o pedaço desta
  // sumia ao congelá-la (virava "sobra" por cima do lote vizinho)
  for (const a of res.areas) {
    if (a.origem !== "lotes") continue;
    for (const pg of a.pols) {
      const pedacos = a.cfg === q.cfg && q.cfg >= 0 && diferenca([pg], [q.pol]).reduce((s2, x) => s2 + areaPol(x), 0) < 0.05 ? [pg] : intersecao([pg], [q.pol]);
      for (const pc of pedacos) if (areaPol(pc) > 0.5) { aneis.push(pc === pg ? pg.ext.slice() : limparAnel(pc.ext, 0.003)); destinos.push({ destino: a.tipo }); }
    }
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

export function gravar(pr: Projeto, res: Resultado, i: number, aneis: Pt[][], destinos: Meta[]): Projeto {
  const pl = res.plano;
  const lotes: LoteDesenhado[] = [];
  aneis.forEach((a, k) => {
    if (a.length < 3) return;
    const m = destinos[k] ?? {};
    const ld: LoteDesenhado = { anel: a.map((p) => paraUtm(pl, p)) };
    if (m.destino) ld.destino = m.destino;
    if (m.livre) ld.livre = true;
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

/** Volta a quadra a ser dividida pelo sistema (some o desenho do operador e a linha central). */
export function voltarAoAutomatico(pr: Projeto, q: Quadra, pl?: Resultado["plano"]): Projeto {
  const i = cfgDe(pr, q, pl);
  if (i < 0 || (!Array.isArray(pr.quadras[i].lotes) && !pr.quadras[i].estrutura)) return pr;
  const quadras = pr.quadras.slice();
  const c = { ...quadras[i] };
  delete c.lotes;
  delete c.estrutura;
  quadras[i] = c;
  return { ...pr, quadras };
}

// ---------------------------------------------------------------------------
// Linha central (docs/plano-linha-central.md): a quadra de duas fileiras passa a
// ser gerada da estrutura (linhaCentral.ts) — fundo com fundo por construção.
// ---------------------------------------------------------------------------

/**
 * "Ajustar fundo com fundo": a quadra passa a ser estruturada pela linha central.
 * O desenho à mão sai (Ctrl+Z volta); a linha e as cabeceiras ficam em "auto" até
 * o cálculo escolher (`fixarEstrutura` grava o que ele escolheu).
 */
export function pedirEstrutura(pr0: Projeto, res: Resultado, q: Quadra, op: { lotes?: number; esquinas?: "absorver" | "iguais"; manterLinha?: boolean } = {}): { pr: Projeto; i: number } {
  const pl = res.plano;
  let i = cfgDe(pr0, q, pl);
  const quadras = pr0.quadras.slice();
  const base: QuadraCfg = i >= 0 ? { ...quadras[i] } : { ancora: paraUtm(pl, ancoraDaQuadra(q)), ajustes: [] };
  delete base.lotes;
  base.ajustes = [];
  const antes = base.estrutura;
  base.estrutura = {
    lotes: Math.max(4, Math.round(op.lotes ?? q.lotes.length)),
    cabeceiras: op.manterLinha && antes?.cabeceiras ? antes.cabeceiras : ["auto", "auto"],
    esquinas: op.esquinas ?? antes?.esquinas ?? "absorver",
    ...(op.manterLinha && antes?.linhaCentral ? { linhaCentral: antes.linhaCentral, travada: antes.travada } : {}),
  };
  if (i >= 0) quadras[i] = base; else { quadras.push(base); i = quadras.length - 1; }
  return { pr: { ...pr0, quadras }, i };
}

/**
 * A quadra tem área pública feita dos lotes dela (institucional, verde)? Refazer a
 * quadra inteira pela linha central apagaria essa reserva — o "fundo com fundo" da
 * quadra inteira fica para as quadras sem ela (os lotes selecionados ainda podem).
 */
export function temAreaPublicaDeLotes(res: Resultado, q: Quadra): string | null {
  for (const a of res.areas) {
    if (a.origem !== "lotes") continue;
    if (a.pols.some((pg) => intersecao([pg], [q.pol]).reduce((s2, x) => s2 + areaPol(x), 0) > 1)) return a.tipo === "institucional" ? "institucional" : a.tipo === "verde" ? "verde" : a.tipo;
  }
  return null;
}

/**
 * "Ajustar fundo com fundo" sem número nem modo pedidos: testa a quantidade atual, um
 * lote a mais e um a menos, com a esquina absorvendo ou com todos iguais (as cabeceiras
 * já são escolhidas pelo motor), e fica com o arranjo de menos lotes fora das medidas —
 * sem perder lote, sem cruzar divisa e sem deixar sobra. `calc` é o cálculo da planta.
 * Devolve também quantos avisos a quadra tinha e passa a ter, para quem chama decidir.
 */
export function melhorEstrutura(pr0: Projeto, res: Resultado, q: Quadra, calc: (p: Projeto) => Resultado | null, op: { rapido?: boolean } = {}):
  { pr: Projeto; i: number; r: Resultado; avisosAntes: number; avisosDepois: number; tentativas: number } | null {
  const avisos = (r: Resultado, nome: string) => r.lotes.filter((l) => l.quadra === nome && l.problemas.length).length;
  // a reserva de área pública feita com lotes desta quadra se perderia
  if (temAreaPublicaDeLotes(res, q)) return null;
  const antes = avisos(res, q.nome);
  const n = q.lotes.length;
  type Cand = { pr: Projeto; i: number; r: Resultado; custo: number; av: number };
  const cands: Cand[] = [];
  let tentativas = 0;
  // nota de um arranjo calculado: menos avisos primeiro; depois a mesma quantidade de
  // lotes, áreas parecidas e laterais no esquadro — o giro pesa ao quadrado (26° na ponta
  // salta aos olhos; 3° ninguém vê). Null se não serve (cruza, perde lote, deixa sobra).
  const avaliar = (pr: Projeto, r: Resultado | null, i: number): Cand | null => {
    const q1 = r?.quadras.find((x) => x.cfg === i);
    if (!r || !q1?.estruturada || q1.estruturada.cruzamentos > 0 || q1.lotes.length < n) return null;
    if (r.quadro.sobras > res.quadro.sobras + 1) return null;
    const av = avisos(r, q1.nome);
    const ar = q1.lotes.map((l) => l.area);
    const espalho = (Math.max(...ar) - Math.min(...ar)) / Math.max(1, ar.reduce((s, a) => s + a, 0) / ar.length);
    const g = q1.estruturada.giroMax;
    return { pr, i, r, av, custo: 1000 * av + 40 * Math.abs(q1.lotes.length - n) + 100 * espalho + 0.1 * g * g };
  };
  const tentar = (N: number, esquinas: "absorver" | "iguais") => {
    const { pr, i } = pedirEstrutura(pr0, res, q, { lotes: N, esquinas });
    let r: Resultado | null = null;
    try { r = calc(pr); } catch { r = null; }
    tentativas++;
    const c = avaliar(pr, r, i);
    if (c) cands.push(c);
  };
  const melhorAte = () => cands.reduce<Cand | null>((m, c) => (!m || c.custo < m.custo ? c : m), null);
  tentar(n, "absorver");
  // a esquina absorvendo já sem aviso e com as laterais no esquadro: "todos iguais" só
  // giraria as laterais da ponta — não vale o cálculo
  const m0 = melhorAte();
  // (rápido = a geração: cada variante é um cálculo inteiro da linha central — "iguais" só
  // quando a esquina deixa aviso, e um lote a mais só na quantidade ímpar, como antes)
  if (!m0 || m0.av > 0 || (!op.rapido && m0.custo > 40)) tentar(n, "iguais");
  // um lote a mais ou a menos só quando a quantidade atual não fecha sem aviso
  const m1 = melhorAte();
  if (!m1 || m1.av > 0) for (const N of (op.rapido ? (n % 2 ? [n + 1] : []) : [n + 1, n - 1]).filter((x) => x >= 4)) { tentar(N, "absorver"); if (!op.rapido) tentar(N, "iguais"); }
  // vale o arranjo GRAVADO (a linha fixada, como fica no projeto): o recálculo com a linha
  // gravada realoca as junções e pode dar outro desenho — divisas cruzadas na quadra F da
  // gleba de teste. Fixa só o melhor (e, se ele não se sustenta, o seguinte): fixar todas
  // as variantes dobrava o custo e a geração do IRAN passava de 80 s.
  cands.sort((a, b) => a.custo - b.custo);
  for (const c of cands.slice(0, 3)) {
    const prF = fixarEstrutura(c.pr, c.r, c.i);
    let rF: Resultado | null = null;
    try { rF = calc(prF); } catch { rF = null; }
    tentativas++;
    const f = avaliar(prF, rF, c.i);
    if (f && f.av <= c.av) return { pr: f.pr, i: f.i, r: f.r, avisosAntes: antes, avisosDepois: f.av, tentativas };
  }
  return null;
}

/**
 * Quadra com os lotes gravados (a geração congelou ao igualar um lote largo): o lote
 * que ficou com 5 quinas porque a divisa morre a poucos metros da quina do contorno
 * tem o pé dela levado à quina (`encaixarNasQuinas`). As áreas mudam um pouco — vale
 * a forma. Devolve o mesmo projeto se nada mudou.
 */
export function encaixarQuadraGravada(pr: Projeto, res: Resultado, q: Quadra): Projeto {
  const c = contornos(pr, res, q);
  const objs = c.aneis.map((a) => ({ pol: { ext: a, furos: [] } as Poligono, area: Math.abs(areaAssinada(a)) }));
  encaixarNasQuinas(objs, q.pol, pr.params);
  if (objs.every((o, k) => o.pol.ext === c.aneis[k])) return pr;
  return gravar(c.pr, res, c.i, normalizar(objs.map((o) => o.pol.ext)), c.destinos);
}

/**
 * "Fundo com fundo em todas": cada quadra de duas fileiras vira estruturada pela linha
 * central (o melhor arranjo de `melhorEstrutura`), uma de cada vez. Só fica a que não
 * piora os avisos; as outras não mudam.
 */
export function fundoComFundoEmTodasAsQuadras(pr0: Projeto, res0: Resultado, calc: (p: Projeto) => Resultado | null):
  { pr: Projeto; r: Resultado; feitas: string[]; ficaram: string[]; editadas: string[]; jaEstavam: string[]; comArea: string[] } {
  let pr = pr0, r = res0;
  const feitas: string[] = [], ficaram: string[] = [];
  // as que ficam de fora, para a mensagem dizer por quê: editada à mão (refazer apagaria a
  // edição — a quadra pode ser refeita sozinha, pelo botão dela), já pela linha central e
  // com área pública feita dos lotes dela
  // (a de uma fileira só — metade ou mais dos lotes no fundo da gleba — não tem fundo com fundo)
  const umaFileira = (q: Quadra) => q.lotes.filter((l) => l.lados.some((x) => x.tipo === "divisa")).length >= q.lotes.length / 2;
  const editadas = res0.quadras.filter((q) => !q.estruturada && q.lotes.length >= 4 && q.lotes.some((l) => l.manual) && !umaFileira(q)).map((q) => q.nome);
  const jaEstavam = res0.quadras.filter((q) => q.estruturada).map((q) => q.nome);
  const comArea = res0.quadras.filter((q) => !q.estruturada && q.fileiras >= 2 && q.lotes.length >= 4 && temAreaPublicaDeLotes(res0, q)).map((q) => q.nome);
  for (const nome of res0.quadras.filter((q) => !q.estruturada && q.fileiras >= 2 && q.lotes.length >= 4 && !comArea.includes(q.nome)).map((q) => q.nome)) {
    const q = r.quadras.find((x) => x.nome === nome);
    if (!q) continue;
    const m = melhorEstrutura(pr, r, q, calc);
    if (!m || m.avisosDepois > m.avisosAntes) { ficaram.push(nome); continue; }
    // (o arranjo já vem gravado: a linha fixada é a que foi avaliada)
    const p2 = m.pr;
    const r2: Resultado | null = m.r;
    const q2 = r2?.quadras.find((x) => x.cfg === m.i);
    if (!r2 || !q2) { ficaram.push(nome); continue; }
    feitas.push(`${q2.nome} (avisos ${m.avisosAntes} → ${r2.lotes.filter((l) => l.quadra === q2.nome && l.problemas.length).length})`);
    pr = p2; r = r2;
  }
  return { pr, r, feitas, ficaram, editadas, jaEstavam, comArea };
}

/** Grava a linha central e as cabeceiras que o cálculo escolheu: o recálculo fica rápido e dá o mesmo arranjo. */
export function fixarEstrutura(pr: Projeto, res: Resultado, i: number): Projeto {
  const q = res.quadras.find((x) => x.cfg === i);
  const c = pr.quadras[i];
  if (!q?.linhaCentral || !q.estruturada || !c?.estrutura) return pr;
  const cab = q.estruturada.cabeceiras as ("direta" | "ponta" | "testa")[];
  const quadras = pr.quadras.slice();
  quadras[i] = {
    ...c,
    estrutura: {
      ...c.estrutura,
      linhaCentral: q.linhaCentral.map((p) => paraUtm(res.plano, p)),
      cabeceiras: cab.length === 2 ? [cab[0], cab[1]] : c.estrutura.cabeceiras,
      lotes: q.lotes.length,
    },
  };
  return { ...pr, quadras };
}

/**
 * Linha central nova (do operador) numa quadra estruturada.
 * - "vivo": durante o arraste — a linha segue o cursor exatamente (cada fileira se iguala por si);
 * - "ajustada": ao soltar — a dobra vai para a junção mais próxima e a linha desliza de lado até as áreas empatarem;
 * - "travada": cadeado — a linha fica exatamente onde está.
 */
export function moverLinhaCentral(pr: Projeto, res: Resultado, q: Quadra, linha: Pt[], modo: "vivo" | "ajustada" | "travada" = "ajustada"): Projeto {
  const i = cfgDe(pr, q, res.plano);
  const c = i >= 0 ? pr.quadras[i] : null;
  if (!c?.estrutura) return pr;
  const est = { ...c.estrutura, linhaCentral: linha.map((p) => paraUtm(res.plano, p)) };
  delete est.vivo;
  if (modo === "vivo") est.vivo = true;
  if (modo === "ajustada") { est.ajustada = true; delete est.travada; }
  if (modo === "travada") est.travada = true;
  const quadras = pr.quadras.slice();
  quadras[i] = { ...c, estrutura: est };
  return { ...pr, quadras };
}

/** Projeta o ponto no contorno da quadra (a ponta da linha central corre pela rua da cabeceira). */
export function naBordaDaQuadra(q: Quadra, p: Pt): Pt {
  const r = q.pol.ext;
  let best: Pt = r[0], bd = Infinity;
  for (let k = 0; k < r.length; k++) {
    const a = r[k], b = r[(k + 1) % r.length];
    const x = distSegmento(p, a, b);
    if (x.d < bd) { bd = x.d; best = lerp(a, b, x.t); }
  }
  return best;
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
  const novos = normalizar(deslizar(aneis, q, a, b, desloc, livre, !!pr0.params.bordaFixa));
  return aplicarArraste(pr, res, q, i, aneis, novos, destinos, dono, `Divisa deslocada ${fmt(Math.abs(desloc))} m — os lotes dos dois lados se ajustaram.`);
}

function deslizar(aneis: Pt[][], q: Quadra, a: Pt, b: Pt, desloc: number, livre: boolean, contorno = false): Pt[][] {
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
      // Divisão de imóvel (contorno fixo): a ponta na borda corre pelo CONTORNO
      // — a divisa deslocada cortando os lados de verdade, passando para o lado
      // seguinte depois do vértice. Pela reta do lado prolongada ela sairia do
      // imóvel quando o lado acaba antes (num perímetro rural, toda hora).
      let naBordaMelhor: Pt | null = null, dmB = Infinity;
      for (let k = 0; contorno && k < ex.length; k++) {
        const x = ex[k], y = ex[(k + 1) % ex.length];
        const r = intersecaoRetas(A2, u, x, sub(y, x));
        if (!r || r.u < -1e-9 || r.u > 1 + 1e-9) continue;
        const d = dist(r.pt, alvo);
        if (d < dmB && d < Math.abs(desloc) * 4 + 5) { dmB = d; naBordaMelhor = r.pt; }
      }
      if (naBordaMelhor) return naBordaMelhor;
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

/** Os lotes cedem ao contorno `ext` o que ele cobre (área pública da quadra fica). */
function cederAo(ext: Pt[], aneis: Pt[][], destinos: Meta[]): { aneis: Pt[][]; metas: Meta[] } {
  const outros: Pt[][] = [], metas: Meta[] = [];
  aneis.forEach((a, k) => {
    if (destinos[k]?.destino) { outros.push(a); metas.push(destinos[k]); return; }
    const resto = diferenca([{ ext: antiHorario(a), furos: [] }], [{ ext, furos: [] }]).filter((x) => areaPol(x) > 1).sort((x, y) => areaPol(y) - areaPol(x));
    if (!resto.length) return;
    outros.push(limparAnel(resto[0].ext, 0.003));
    metas.push(destinos[k]);
  });
  return { aneis: outros, metas };
}

/**
 * Lote desenhado pelo operador: o contorno dele manda. Ele toma a terra que
 * cobrir — lotes, área livre (rosa) e a divisa invisível entre duas quadras
 * (a quina onde a rua acaba, a quadra que ficou vazia) —, nunca rua nem área
 * pública. Os lotes que ele cobre se ajustam ao desenho; o lote fica na quadra
 * de que ele tem mais terra e, passando dela, é "livre" (a quadra cresce).
 * `soLivre`: só a área livre (duplo clique no rosa — nenhum lote cede).
 */
export function desenharLote(pr0: Projeto, res: Resultado, anel: Pt[], op: { soLivre?: boolean } = {}): Edicao | null {
  const pol: Poligono = { ext: antiHorario(anel), furos: [] };
  const todas = [...res.quadras, ...(res.quadrasVazias ?? [])];
  const publicas = res.areas.flatMap((a) => a.pols);
  let pedacos = intersecao([pol], op.soLivre ? res.sobras : [...todas.map((x) => x.pol), ...res.sobras]);
  if (publicas.length) pedacos = diferenca(pedacos, publicas);
  pedacos = pedacos.filter((x) => areaPol(x) > 0.05);
  const novo = (pedacos.length > 1 ? uniaoFechada(pedacos) : pedacos).sort((x, y) => areaPol(y) - areaPol(x))[0];
  if (!novo || areaPol(novo) < 1) return null;
  const ext = limparAnel(novo.ext, 0.005);
  const novoPol: Poligono = { ext, furos: [] };
  // dono: a quadra de que o lote tem mais terra; só retalho (fora das quadras) → a quadra mais perto
  const partes = todas
    .map((x) => ({ q: x, a: intersecao([novoPol], [x.pol]).reduce((s, y) => s + areaPol(y), 0) }))
    .filter((x) => x.a > 0.5).sort((x, y) => y.a - x.a);
  const c: Pt = [ext.reduce((s, p) => s + p[0], 0) / ext.length, ext.reduce((s, p) => s + p[1], 0) / ext.length];
  const longe = (x: Quadra) => Math.min(...x.pol.ext.map((p, j) => distSegmento(c, p, x.pol.ext[(j + 1) % x.pol.ext.length]).d));
  const dono = partes[0]?.q ?? [...todas].sort((x, y) => longe(x) - longe(y))[0];
  if (!dono) return null;
  const livre = diferenca([novoPol], [dono.pol]).reduce((s, x) => s + areaPol(x), 0) > 1;
  // as outras quadras cobertas cedem a parte delas
  let pr = pr0;
  for (const { q: qx } of partes) {
    if (qx === dono) continue;
    const cx = contornos(pr, res, qx);
    const cedido = cederAo(ext, cx.aneis, cx.destinos);
    pr = gravar(cx.pr, res, cx.i, normalizar(cedido.aneis), cedido.metas);
  }
  const { pr: prD, i, aneis, destinos } = contornos(pr, res, dono);
  const cedido = cederAo(ext, aneis, destinos);
  const todos = normalizar([...cedido.aneis, ext]);
  const k = todos.length - 1;
  const outras = partes.filter((x) => x.q !== dono).map((x) => x.q.nome);
  return {
    pr: gravar(prD, res, i, todos, [...cedido.metas, livre ? { livre: true } : {}]),
    msg: `Lote desenhado com ${fmt(areaPol(novoPol))} m²${livre ? ` — passa da quadra ${dono.nome}${outras.length ? ` e toma a terra da quadra ${outras.join(", ")}` : " e toma a área livre"}; fica na quadra ${dono.nome}` : " — os vizinhos se ajustaram ao contorno"}.`,
    sel: { quadra: dono.nome, indices: [k] },
  };
}

export function unirLotes(pr0: Projeto, res: Resultado, q: Quadra, indices: number[]): Edicao | null {
  if (indices.length < 2) return null;
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const u = uniaoFechada(indices.map((k) => ({ ext: antiHorario(aneis[k]), furos: [] })));
  if (u.length !== 1 || u[0].furos.length) return null;
  const alvo = Math.min(...indices);
  const novos = aneis.map((a, k) => (k === alvo ? limparAnel(u[0].ext, 0.005) : a)).filter((_, k) => k === alvo || !indices.includes(k));
  // unido a um lote livre (que passa da quadra), o lote todo continua livre
  const livre = indices.some((k) => destinos[k]?.livre);
  const dest = destinos.map((d, k) => (k === alvo && livre ? { ...d, livre: true } : d)).filter((_, k) => k === alvo || !indices.includes(k));
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
  const contorno = !!pr0.params.bordaFixa;
  const aplicar = (s: number): Pt[][] => {
    const nv = normalizar(deslizar(aneis, q, lado.a, lado.b, sinal * s, false, contorno));
    if (!contorno) return nv;
    // divisão de imóvel: a divisa passa por cima de vértices do contorno, e só
    // o desenho ASSENTADO (cada vértice com o lote do seu lado) mede o que vai
    // ficar — medir o anel cru errava dezenas de m². Volta na ordem de antes;
    // lote engolido vira anel vazio (o passo é recusado como inválido).
    const ass = assentar(aneis, nv, destinos, q, k);
    return aneis.map((_, m) => (ass.mapa[m] >= 0 ? ass.aneis[ass.mapa[m]] : []));
  };
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
    // (na divisão o passo que cai exatamente num vértice do contorno pode sair torto: pula e segue)
    if (!valido(an)) { if (contorno) continue; break; }
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
// Igualar áreas: vários lotes da mesma quadra ficam com a mesma área
// ---------------------------------------------------------------------------

/**
 * Contorno degenerado: uma quina encostada num lado do próprio lote que não é
 * dela — o lote espremido até virar um fiapo de largura zero, que vai e volta
 * pela mesma linha (a área ainda "fecha", mas o desenho quebrou).
 */
function fiapo(an: Pt[]): boolean {
  const n = an.length;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const z = (y + 1) % n;
      if (y === x || z === x) continue;
      if (dist(an[y], an[z]) < 1e-6) continue;
      const { d, t } = distSegmento(an[x], an[y], an[z]);
      if (d >= 0.03) continue;
      // perto só da quina vizinha (um lado de 2 cm no meio da rua reta) não é fiapo:
      // a ponta da divisa passando por um ponto da rua travava o deslizar
      if ((y === (x + 1) % n && t < 1e-3) || (z === (x + n - 1) % n && t > 1 - 1e-3)) continue;
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Estrutura das divisas: a linha de fundo (fundo com fundo) e as laterais
// ---------------------------------------------------------------------------

interface LadoComum { a: Pt; b: Pt; lotes: [number, number] }
export interface EstruturaDivisas {
  /** lados que dois lotes têm em comum */
  comuns: LadoComum[];
  /** a(s) linha(s) de fundo: o caminho pelas junções de dentro da quadra (fundo com fundo das duas fileiras) */
  espinhas: Pt[][];
  /** o lado comum a–b é da linha de fundo? */
  ehFundo: (a: Pt, b: Pt) => boolean;
}

/**
 * Acha a linha de fundo da quadra desenhada. As divisas laterais vão da rua até
 * uma junção dentro da quadra; a linha de fundo é o caminho que passa por
 * essas junções, quase reto (até 35° de giro em cada uma — o leque gira aos
 * poucos), e termina na borda da quadra. Quadra de uma fileira não tem.
 */
export function estruturaDeDivisas(aneis: Pt[][], q: Quadra): EstruturaDivisas {
  const comuns: LadoComum[] = [];
  for (let k = 0; k < aneis.length; k++) {
    const an = aneis[k];
    for (let j = 0; j < an.length; j++) {
      const a = an[j], b = an[(j + 1) % an.length];
      if (dist(a, b) < 0.05) continue;
      for (let m = k + 1; m < aneis.length; m++) {
        if (aneis[m].length >= 3 && temLado(aneis[m], a, b)) { comuns.push({ a, b, lotes: [k, m] }); break; }
      }
    }
  }
  const dentro = (p: Pt) => !naBorda(q, p);
  const noPonto = (p: Pt) => comuns.filter((c) => dist(c.a, p) < TOL || dist(c.b, p) < TOL);
  // junção de verdade: 3 ou mais divisas chegam nela (o "T" e o "X" da linha de
  // fundo). Ponto com 2 é só passagem no meio de uma divisa — não começa linha.
  const juncao = (p: Pt) => noPonto(p).length >= 3;
  // a linha de fundo corre AO LONGO da quadra (perto da direção da rua principal);
  // as divisas laterais — e o degrau que fica nelas quando um trecho do fundo anda — cortam a quadra
  const aoLongo = (c: LadoComum) => Math.abs(cross(unit(sub(c.b, c.a)), q.u)) < Math.sin((50 * Math.PI) / 180);
  const naEspinha = new Set<LadoComum>();
  const espinhas: Pt[][] = [];
  for (const sem of comuns) {
    if (naEspinha.has(sem) || !dentro(sem.a) || !dentro(sem.b) || !juncao(sem.a) || !juncao(sem.b) || !aoLongo(sem)) continue;
    naEspinha.add(sem);
    const linha: Pt[] = [sem.a, sem.b];
    // estende pelas duas pontas: o lado comum que segue mais reto (sai na borda)
    for (const lado of [1, -1]) {
      for (let it = 0; it < 500; it++) {
        const fim = lado === 1 ? linha[linha.length - 1] : linha[0];
        const ant = lado === 1 ? linha[linha.length - 2] : linha[1];
        if (!dentro(fim)) break;
        const u = unit(sub(fim, ant));
        let melhor: LadoComum | null = null, cmax = Math.cos((35 * Math.PI) / 180);
        for (const c of noPonto(fim)) {
          if (naEspinha.has(c) || !aoLongo(c)) continue;
          const outro = dist(c.a, fim) < TOL ? c.b : c.a;
          const cs = dot(u, unit(sub(outro, fim)));
          if (cs > cmax) { cmax = cs; melhor = c; }
        }
        if (!melhor) break;
        naEspinha.add(melhor);
        const outro = dist(melhor.a, fim) < TOL ? melhor.b : melhor.a;
        if (lado === 1) linha.push(outro); else linha.unshift(outro);
      }
    }
    espinhas.push(linha);
  }
  const ehFundo = (a: Pt, b: Pt) => [...naEspinha].some((c) => (dist(c.a, a) < TOL && dist(c.b, b) < TOL) || (dist(c.a, b) < TOL && dist(c.b, a) < TOL)
    || (distSegmento(a, c.a, c.b).d < TOL && distSegmento(b, c.a, c.b).d < TOL));
  return { comuns, espinhas, ehFundo };
}

// ---------------------------------------------------------------------------
// Linha de fundo maleável: arrastar a linha inteira ou dobrar num ponto
// ---------------------------------------------------------------------------

/** Linhas de fundo da quadra (fundo com fundo das duas fileiras), para o editor desenhar e arrastar. */
export function linhasDeFundo(pr: Projeto, q: Quadra): Pt[][] {
  const aneis = normalizar(ordemDoDesenho(pr, q).map((l) => l.pol.ext.slice()));
  return estruturaDeDivisas(aneis, q).espinhas.filter((e) => e.length >= 2);
}

/** Por onde a junção da linha de fundo anda: a divisa lateral que chega nela (na borda, a borda). */
function trilhoDaJuncao(est: EstruturaDivisas, q: Quadra, p: Pt, uF: Pt): Pt {
  if (naBorda(q, p)) {
    const ex = q.pol.ext;
    let melhor: Pt | null = null, mc = 0.2;
    for (let k = 0; k < ex.length; k++) {
      const a = ex[k], b = ex[(k + 1) % ex.length];
      if (distSegmento(p, a, b).d > 0.05) continue;
      const d = unit(sub(b, a));
      const c = Math.abs(cross(uF, d));
      if (c > mc) { mc = c; melhor = d; }
    }
    return melhor ?? esquerda(uF);
  }
  let melhor: Pt | null = null, mc = 0.2;
  for (const c of est.comuns) {
    if (est.ehFundo(c.a, c.b)) continue;
    const outro = dist(c.a, p) < TOL ? c.b : dist(c.b, p) < TOL ? c.a : null;
    if (!outro) continue;
    const d = unit(sub(outro, p));
    const s = Math.abs(cross(uF, d));
    if (s > mc) { mc = s; melhor = d; }
  }
  return melhor ?? esquerda(uF);
}

/** A linha de fundo de `ref` (como o editor a desenhou) no desenho de agora. */
function espinhaDe(est: EstruturaDivisas, ref: Pt[]): Pt[] | null {
  let melhor: Pt[] | null = null, dm = 1;
  for (const e of est.espinhas) {
    const d = Math.min(...ref.map((p) => Math.min(...e.map((x) => dist(p, x)))));
    if (d < dm) { dm = d; melhor = e; }
  }
  return melhor;
}

/**
 * Arrasta a linha de fundo INTEIRA, paralela a ela mesma: cada junção corre
 * pela sua divisa lateral (o fundo com fundo continua alinhado) e as pontas
 * correm pela borda da quadra. Uma fileira fica mais funda, a outra mais rasa.
 */
export function moverLinhaDeFundo(pr0: Projeto, res: Resultado, q: Quadra, ref: Pt[], desloc: number): Edicao {
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const est = estruturaDeDivisas(aneis, q);
  const e = espinhaDe(est, ref);
  if (!e) return { pr: pr0, erro: true, msg: "Esta quadra não tem linha de fundo (fundo com fundo) — ela tem uma fileira só." };
  const mapa: { de: Pt; para: Pt }[] = [];
  e.forEach((p, j) => {
    const uF = unit(sub(e[Math.min(j + 1, e.length - 1)], e[Math.max(j - 1, 0)]));
    const dir = trilhoDaJuncao(est, q, p, uF);
    const r = intersecaoRetas(soma(p, mult(esquerda(uF), desloc)), uF, p, dir);
    if (r && dist(r.pt, p) < Math.abs(desloc) * 4 + 2) mapa.push({ de: p, para: r.pt });
  });
  const novos = normalizar(moverPontos(aneis, mapa));
  return aplicarArraste(pr, res, q, i, aneis, novos, destinos, -1, `Linha de fundo deslocada ${fmt(Math.abs(desloc))} m — as junções correram pelas divisas: o fundo com fundo continua alinhado.`);
}

/**
 * Dobra a linha de fundo num ponto: a junção corre pela divisa lateral dela
 * (o lote da frente fica mais fundo e o de trás mais raso, ou o contrário).
 */
export function moverPontoDeFundo(pr0: Projeto, res: Resultado, q: Quadra, de: Pt, para: Pt): Edicao {
  const { pr, i, aneis, destinos } = contornos(pr0, res, q);
  const est = estruturaDeDivisas(aneis, q);
  let alvo: { p: Pt; uF: Pt } | null = null, dm = 0.5;
  for (const e of est.espinhas) {
    e.forEach((p, j) => {
      const d = dist(p, de);
      if (d < dm) { dm = d; alvo = { p, uF: unit(sub(e[Math.min(j + 1, e.length - 1)], e[Math.max(j - 1, 0)])) }; }
    });
  }
  if (!alvo) return { pr: pr0, erro: true, msg: "Este ponto não está na linha de fundo." };
  const { p, uF } = alvo as { p: Pt; uF: Pt };
  const dir = trilhoDaJuncao(est, q, p, uF);
  const novo = soma(p, mult(dir, dot(sub(para, p), dir)));
  const novos = normalizar(moverPontos(aneis, [{ de: p, para: novo }]));
  return aplicarArraste(pr, res, q, i, aneis, novos, destinos, -1, `Ponto da linha de fundo movido ${fmt(dist(p, novo))} m pela divisa — os lotes da frente e de trás se ajustaram.`, novo);
}

/** Resolve M·y = b (eliminação de Gauss com pivô parcial); null se singular. */
function resolver(M0: number[][], b0: number[]): number[] | null {
  const n = b0.length;
  const M = M0.map((l) => l.slice()), b = b0.slice();
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let l = c + 1; l < n; l++) if (Math.abs(M[l][c]) > Math.abs(M[piv][c])) piv = l;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let l = c + 1; l < n; l++) {
      const f = M[l][c] / M[c][c];
      if (!f) continue;
      for (let k = c; k < n; k++) M[l][k] -= f * M[c][k];
      b[l] -= f * b[c];
    }
  }
  const y = new Array(n).fill(0);
  for (let c = n - 1; c >= 0; c--) {
    let t = b[c];
    for (let k = c + 1; k < n; k++) t -= M[c][k] * y[k];
    y[c] = t / M[c][c];
  }
  return y;
}

/** O contorno tem o lado a–b (em qualquer sentido)? */
function temLado(an: Pt[], a: Pt, b: Pt): boolean {
  for (let j = 0; j < an.length; j++) {
    const v = an[j], w = an[(j + 1) % an.length];
    if ((dist(v, a) < TOL && dist(w, b) < TOL) || (dist(v, b) < TOL && dist(w, a) < TOL)) return true;
  }
  return false;
}

/**
 * Tira do contorno os pontos de passagem — no meio de um lado reto, vindos de
 * outro lote (que continua com eles) — menos os que `manter` pede. O normalizar
 * os devolve no lado onde caírem depois de mover as junções.
 */
function semPassagens(an: Pt[], todos: Pt[][], manter: (v: Pt) => boolean, q: Quadra): Pt[] {
  const n = an.length;
  if (n <= 3) return an;
  const out = an.filter((v, j) => {
    if (manter(v)) return true;
    const { d, t } = distSegmento(v, an[(j + n - 1) % n], an[(j + 1) % n]);
    if (d > 0.01 || t <= 0 || t >= 1) return true;
    if (q.pol.ext.some((c) => dist(c, v) < 0.01)) return true;
    return !todos.some((o) => o !== an && o.some((w) => dist(w, v) < TOL));
  });
  return out.length >= 3 ? out : an;
}

/**
 * A divisa entre dois lotes: o trecho reto mais longo que eles têm em comum,
 * esticado pelos lados alinhados (o "T" de um terceiro lote no meio dela).
 */
function divisaEntre(x: Pt[], y: Pt[]): [Pt, Pt] | null {
  const n = x.length;
  let j0 = -1, mc = 0.5;
  for (let j = 0; j < n; j++) {
    const a = x[j], b = x[(j + 1) % n];
    if (dist(a, b) > mc && temLado(y, a, b)) { mc = dist(a, b); j0 = j; }
  }
  if (j0 < 0) return null;
  const u = unit(sub(x[(j0 + 1) % n], x[j0]));
  const alinhado = (j: number) => {
    const a = x[(j + n) % n], b = x[(j + 1 + n) % n];
    return dist(a, b) > TOL && temLado(y, a, b) && Math.abs(cross(u, unit(sub(b, a)))) < 0.02;
  };
  let ini = j0, fim = j0;
  for (let s = 0; s < n && alinhado(ini - 1) && (ini - 1 + n) % n !== fim; s++) ini = (ini - 1 + n) % n;
  for (let s = 0; s < n && alinhado(fim + 1) && (fim + 1) % n !== ini; s++) fim = (fim + 1) % n;
  return [x[ini], x[(fim + 1) % n]];
}

/**
 * Deixa os lotes selecionados (da mesma quadra, encostados uns nos outros)
 * todos com a mesma área: a soma deles dividida por igual.
 *
 * Fundo com fundo continua fundo com fundo: na quadra de duas fileiras a
 * divisa lateral vai de rua a rua, cruzando a linha de fundo. Ela desliza
 * INTEIRA (o trecho da frente e o de trás juntos, a junção correndo pela linha
 * de fundo) — assim o lote da frente e o de trás seguem encostados pelo fundo.
 * O lote de trás de um selecionado acompanha a divisa mesmo fora da seleção
 * (a mensagem diz quais).
 *
 * Como: os selecionados viram "colunas" (o da frente com o de trás, quando os
 * dois estão selecionados). 1) Uma árvore pelas divisas laterais entre as
 * colunas leva cada parte da árvore à área certa (n × alvo); 2) as junções da
 * linha de fundo correm pelas divisas até o da frente e o de trás baterem
 * (contínua, sem degrau, com a menor dobra). Repete até todos baterem.
 *
 * Forma antes da área: nenhum lote ganha quina, perde a testada, vira faixa
 * comprida ou fica abaixo da área mínima. A divisa que só andaria assim fica
 * travada, e cada parte da seleção se iguala por dentro (a mensagem diz quais).
 */
export function igualarAreas(pr0: Projeto, res: Resultado, q: Quadra, indices: number[]): Edicao | null {
  const ks = [...new Set(indices)].filter((k) => k >= 0);
  if (ks.length < 2) return null;
  const { pr, i, aneis: an0, destinos } = contornos(pr0, res, q);
  if (ks.some((k) => !an0[k] || an0[k].length < 3)) return null;
  if (ks.some((k) => destinos[k]?.destino)) return { pr: pr0, erro: true, msg: "Área pública não entra na conta — selecione só lotes." };
  let aneis = an0;
  const area = (an: Pt[][], k: number) => Math.abs(areaAssinada(an[k]));
  const somaDe = (an: Pt[][], ls: number[]) => ls.reduce((s, k) => s + area(an, k), 0);
  // o alvo é a média ATUAL dos selecionados: a divisa que vai de rua a rua leva o lote de
  // trás junto (fundo com fundo) e, se ele está fora da seleção, a soma dos selecionados muda
  let alvo = somaDe(aneis, ks) / ks.length;
  const atualizarAlvo = () => { alvo = somaDe(aneis, ks) / ks.length; };
  const selecionado = new Set(ks);

  // ---- colunas: o da frente e o de trás selecionados, ligados pela linha de fundo ----
  const est0 = estruturaDeDivisas(aneis, q);
  // a divisa entre x e y é (trecho d) da linha de fundo? Ela pode vir em pedaços (o "T" de
  // um terceiro lote no meio): basta um pedaço de fundo dos dois em cima dela. Pedindo a
  // divisa inteira como um lado só, o fundo de C-19|C-20 passava por lateral e deslizava (degrau)
  const deFundo = (est: EstruturaDivisas, d: [Pt, Pt], x: number, y: number) => est.ehFundo(d[0], d[1])
    || est.comuns.some((c) => c.lotes.includes(x) && c.lotes.includes(y) && est.ehFundo(c.a, c.b)
      && distSegmento(c.a, d[0], d[1]).d < TOL && distSegmento(c.b, d[0], d[1]).d < TOL);
  const fundoEntre = (an: Pt[][], x: number, y: number, est: EstruturaDivisas): [Pt, Pt] | null => {
    const d = divisaEntre(an[x], an[y]);
    return d && deFundo(est, d, x, y) ? d : null;
  };
  const ufC = new Map(ks.map((k) => [k, k]));
  const achaC = (k: number): number => { let r = k; while (ufC.get(r) !== r) r = ufC.get(r)!; return r; };
  // coluna só com par EXCLUSIVO (alinhado): o da frente encosta pelo fundo só no
  // de trás e vice-versa. Nas fileiras desencontradas (cada lote encosta no fundo
  // de dois), juntar em "coluna" encadeava a fileira inteira num bloco só e o
  // ajuste pelos trechos do fundo cruzava os lotes — ali cada lote fica sozinho
  // e a fileira se iguala pelas laterais (a ponta delas corre pela linha de fundo)
  const vizinhosDeFundo = new Map<number, Set<number>>();
  for (const c of est0.comuns) {
    if (!est0.ehFundo(c.a, c.b)) continue;
    const [u, w] = c.lotes;
    if (!vizinhosDeFundo.has(u)) vizinhosDeFundo.set(u, new Set());
    if (!vizinhosDeFundo.has(w)) vizinhosDeFundo.set(w, new Set());
    vizinhosDeFundo.get(u)!.add(w); vizinhosDeFundo.get(w)!.add(u);
  }
  const soEle = (x: number, y: number) => { const v = vizinhosDeFundo.get(x); return !!v && v.size === 1 && v.has(y); };
  for (const x of ks) for (const y of ks) if (x < y && soEle(x, y) && soEle(y, x) && fundoEntre(aneis, x, y, est0)) ufC.set(achaC(x), achaC(y));
  const colunas = new Map<number, number[]>();
  for (const k of ks) colunas.set(achaC(k), [...(colunas.get(achaC(k)) ?? []), k]);
  const cols = [...colunas.values()];
  const colDe = new Map<number, number>();
  cols.forEach((c, j) => c.forEach((k) => colDe.set(k, j)));

  /**
   * A divisa lateral entre x e y, esticada de rua a rua quando ela cruza a
   * linha de fundo (com o lote de trás dos dois lados): o trecho a deslizar, a
   * junção na linha de fundo e os lotes de trás que vão junto.
   */
  const lateral = (an: Pt[][], x: number, y: number) => {
    const d = divisaEntre(an[x], an[y]);
    if (!d) return null;
    const est = estruturaDeDivisas(an, q);
    if (deFundo(est, d, x, y)) return null;
    const pb = naBorda(q, d[0]), rb = naBorda(q, d[1]);
    const simples = { a: d[0], b: d[1], m: null as Pt | null, dirFundo: null as Pt | null, lotes: [x, y] };
    if (pb === rb) return simples;
    const a = pb ? d[0] : d[1], m = pb ? d[1] : d[0];
    let dirFundo: Pt | null = null;
    for (const e of est.espinhas) {
      const j = e.findIndex((p) => dist(p, m) < TOL);
      if (j >= 0) dirFundo = unit(sub(e[Math.min(j + 1, e.length - 1)], e[Math.max(j - 1, 0)]));
    }
    if (!dirFundo) return simples;
    // segue reto além da junção, pelos lados comuns que não são de fundo, até a outra rua
    const u = unit(sub(m, a));
    let cur = m, b: Pt | null = null;
    const junto = new Set<number>([x, y]);
    for (let it = 0; it < 20; it++) {
      let melhor: { outro: Pt; lotes: [number, number] } | null = null, cmax = Math.cos((12 * Math.PI) / 180);
      for (const c of est.comuns) {
        if (est.ehFundo(c.a, c.b)) continue;
        const ehA = dist(c.a, cur) < TOL, ehB = dist(c.b, cur) < TOL;
        if (!ehA && !ehB) continue;
        const outro = ehA ? c.b : c.a;
        const cs = dot(u, unit(sub(outro, cur)));
        if (cs > cmax) { cmax = cs; melhor = { outro, lotes: c.lotes }; }
      }
      if (!melhor) break;
      melhor.lotes.forEach((k) => junto.add(k));
      cur = melhor.outro;
      if (naBorda(q, cur)) { b = cur; break; }
    }
    // a divisa de trás não continua a da frente (ou dobra na junção): só o trecho da frente
    if (!b || distSegmento(m, a, b).d > 0.05) return { ...simples, a, b: m };
    // o lote de trás não está na seleção: ele não muda (regra do Wilker — a terra dos
    // selecionados fica entre eles). Só o trecho da frente desliza; a junção corre pela
    // linha de fundo, que fica onde está. Fundo com fundo, selecionando as duas fileiras.
    if ([...junto].some((k) => !selecionado.has(k))) return { ...simples, a, b: m };
    return { a, b, m, dirFundo, lotes: [...junto] };
  };

  // a ponta da divisa corre pelo CONTORNO da quadra, virando as dobras da rua
  // e da divisa da gleba (pela reta do lado ela saía da quadra na primeira dobra)
  const contorno = true;
  const pg = (x: Pt[]): Poligono => ({ ext: antiHorario(x), furos: [] });
  const soma2 = (ps: Poligono[]) => ps.reduce((s2, x) => s2 + areaPol(x), 0);
  const fora = (x: Pt[]) => soma2(diferenca([pg(x)], [q.pol]));
  const encontro = (x: Pt[], y: Pt[]) => soma2(intersecao([pg(x)], [pg(y)]));
  /** lotes de fora da seleção que acompanharam a divisa (fundo com fundo) */
  const acompanharam = new Set<number>();
  // forma do lote: o que encosta na rua (a testada) não some. Igualar a área a
  // qualquer custo deixava, na ponta de uma quadra em leque, lote sem frente e
  // lote comprido de 60 m de fundo — ali a divisa para e a mensagem avisa
  const frenteMinima = Math.max(2.5, 0.5 * (pr0.params.frenteMin || 5));
  const frenteNaBorda = (x: Pt[]) => x.reduce((t, v, j) => { const w = x[(j + 1) % x.length]; return t + (naBorda(q, lerp(v, w, 0.5)) && naBorda(q, v) && naBorda(q, w) ? dist(v, w) : 0); }, 0);
  // e não vira faixa: alongamento (perímetro² ÷ área; 10×25 dá 19,6 e 7×40 dá 31) até 34 —
  // lote que já era mais comprido que isso não pode ficar mais comprido do que era
  const alongamento = (x: Pt[]) => { const p = x.reduce((t, v, j) => t + dist(v, x[(j + 1) % x.length]), 0); return (p * p) / Math.max(Math.abs(areaAssinada(x)), 1e-6); };
  const alongMax = new Map(ks.map((k) => [k, Math.max(34, alongamento(an0[k]) + 0.5)]));
  // e não ganha quina: a ponta da divisa que corre pela borda e passa a dobra da rua
  // levava a dobra para dentro do lote (A-26 com 5 quinas, marcado de vermelho)
  const qMax = pr0.params.quinasMax ?? 4;
  const quinasAntes = new Map<number, number>();
  // (contadas no contorno limpo, como a planta conta: pontos alinhados a cada 2 m pela
  // rua passavam por "arco de esquina" e escondiam a dobra)
  const nQuinas = (x: Pt[]) => { const l = limparAnel(x, 0.01); return quinasDe(l.length >= 3 ? l : x).length; };
  const quinasOk = (x: Pt[], k: number) => {
    if (qMax <= 0 || !an0[k]) return true;
    if (!quinasAntes.has(k)) quinasAntes.set(k, nQuinas(an0[k]));
    return nQuinas(x) <= Math.max(qMax, quinasAntes.get(k)!);
  };
  // e não fica abaixo da área mínima do loteamento (se já não estava): a divisa que
  // arrasta o lote de trás de fora da seleção esvaziava o vizinho até 100 m²
  const areaMin = pr0.params.areaMin || 0;
  const areaOk = (x: Pt[], k: number) => !an0[k] || Math.abs(areaAssinada(x)) >= Math.min(areaMin, Math.abs(areaAssinada(an0[k]))) - 0.01;
  const formaBoa = (x: Pt[], k: number) => quinasOk(x, k) && areaOk(x, k) && (!selecionado.has(k) || alongamento(x) <= alongMax.get(k)!);

  /**
   * Desliza o trecho a–b até a soma do `grupo` chegar em `alvoG` (ou o mais
   * perto que der). Só os `lotes` da divisa podem mudar; nenhum se sobrepõe,
   * sai da quadra, se cruza ou vira fiapo. Com `m` (divisa de rua a rua), a
   * junção volta para a linha de fundo depois de deslizar.
   */
  /** devolve true quando a divisa não anda nada no sentido que a conta pede (travada) */
  const ajustar = (seg: { a: Pt; b: Pt; m: Pt | null; dirFundo: Pt | null; lotes: number[] }, grupo: number[], alvoG: number, dono: number): boolean => {
    const { a, b, m, dirFundo } = seg;
    const L = Math.max(dist(a, b), 1);
    const podem = new Set(seg.lotes);
    const antes = aneis.map((_, k) => area(aneis, k));
    const u = unit(sub(b, a));
    const aplicar = (s: number): Pt[][] => {
      let nv = normalizar(deslizar(aneis, q, a, b, s, false, contorno));
      if (m && dirFundo) {
        // a junção andou junto com a divisa (na proporção); volta para a linha de fundo
        const perto = nv[seg.lotes[0]].reduce((mm: Pt | null, v) => (dist(v, m) < Math.abs(s) * 2 + 0.5 && Math.abs(Math.abs(cross(u, sub(v, a))) - Math.abs(s)) < 0.05 && (!mm || dist(v, m) < dist(mm, m)) ? v : mm), null);
        if (perto) {
          const r = intersecaoRetas(perto, u, m, dirFundo);
          if (r && dist(r.pt, perto) < 5) nv = normalizar(moverPontos(nv, [{ de: perto, para: r.pt }]));
        }
      }
      const ass = assentar(aneis, nv, destinos, q, dono);
      // lote de fora da divisa sai do assentamento com o contorno EXATO de antes
      // (o recorte refaz todos e deixava ruído de milímetros que se acumulava)
      return aneis.map((x, k) => {
        const novo = ass.mapa[k] >= 0 ? ass.aneis[ass.mapa[k]] : [];
        return !podem.has(k) && novo.length >= 3 && Math.abs(Math.abs(areaAssinada(novo)) - antes[k]) < 0.01 ? x : novo;
      });
    };
    const ls = [...podem];
    const pares: [number, number][] = [];
    for (let x = 0; x < ls.length; x++) for (let y = x + 1; y < ls.length; y++) pares.push([ls[x], ls[y]]);
    const foraAntes = ls.reduce((s2, k) => s2 + fora(aneis[k]), 0);
    const encAntes = pares.map(([x, y]) => encontro(aneis[x], aneis[y]));
    // a quadra continua coberta, sem sobreposição: a soma de TODOS os lotes não muda
    // (um lote da divisa que invade outro de fora dela não muda a área do invadido —
    // só a soma denuncia; foi o que gerava os lotes compridos cruzando na ponta da quadra)
    const totalAntes = antes.reduce((t, x) => t + x, 0);
    const frenteAntes = ls.map((k) => frenteNaBorda(aneis[k]));
    const valido = (an: Pt[][]) => an.length === aneis.length
      && Math.abs(an.reduce((t, x) => t + Math.abs(areaAssinada(x)), 0) - totalAntes) < 0.05
      && ls.every((k, j) => frenteNaBorda(an[k]) >= Math.min(frenteAntes[j], frenteMinima) - 0.01 && formaBoa(an[k], k)) && an.every((x, k) => {
      if (antes[k] < 1) return true;
      if (x.length < 3 || Math.sign(areaAssinada(x)) !== Math.sign(areaAssinada(aneis[k])) || Math.abs(areaAssinada(x)) < 1) return false;
      return podem.has(k) || Math.abs(Math.abs(areaAssinada(x)) - antes[k]) < 0.002;
    }) && ls.every((k) => !seCruza(an[k]) && (!fiapo(an[k]) || fiapo(aneis[k])))
      && pares.every(([x, y], j) => encontro(an[x], an[y]) <= encAntes[j] + 0.05)
      && ls.reduce((s2, k) => s2 + fora(an[k]), 0) <= foraAntes + 0.05;
    const medir = (s: number): { an: Pt[][]; m: number } | null => { const an = aplicar(s); return valido(an) ? { an, m: somaDe(an, grupo) } : null; };
    const g0 = somaDe(aneis, grupo) - alvoG;
    if (Math.abs(g0) < 0.005) return false;
    // sentido: o deslocamento +n aumenta ou diminui o grupo?
    // (vários tamanhos: um ponto da rua a centímetros da ponta trava um deles)
    let mais: { an: Pt[][]; m: number } | null = null, menos: { an: Pt[][]; m: number } | null = null;
    for (const e of [0.1, 0.25, 0.04, 0.5]) {
      mais = medir(e);
      if (mais) break;
      menos = medir(-e);
      if (menos) break;
    }
    if (!mais && !menos) return Math.abs(g0) > 0.05;
    const base = somaDe(aneis, grupo);
    const cresce = mais ? (mais.m > base ? 1 : -1) : (menos!.m > base ? -1 : 1);
    const g = (s: number) => { const r = medir(cresce * s); return r ? { ...r, g: r.m - alvoG } : null; };
    // chute pela largura da divisa, depois cerca o valor e refina
    let lo = 0, gLo = g0, melhor: Pt[][] | null = null, hi = NaN;
    let passo = -g0 / L;
    for (let it = 0; it < 40 && !Number.isFinite(hi); it++) {
      const r = g(lo + passo);
      if (!r) { passo /= 2; if (Math.abs(passo) < 1e-3) break; continue; }
      if (Math.sign(r.g) !== Math.sign(gLo)) { hi = lo + passo; break; }
      lo += passo; gLo = r.g; melhor = r.an;
      passo *= 1.5;
    }
    if (Number.isFinite(hi)) {
      for (let it = 0; it < 50; it++) {
        const s = (lo + hi) / 2;
        const r = g(s);
        if (!r) { hi = s; continue; }
        if (Math.sign(r.g) === Math.sign(gLo)) { lo = s; gLo = r.g; } else hi = s;
        melhor = r.an;
        if (Math.abs(r.g) < 0.002 || Math.abs(hi - lo) < 1e-5) break;
      }
    }
    if (melhor) {
      for (const k of podem) if (!selecionado.has(k) && Math.abs(area(melhor, k) - antes[k]) > 0.05) acompanharam.add(k);
      aneis = melhor;
    }
    return !melhor && Math.abs(g0) > 0.05;
  };

  // ---- árvore (por um critério de preferência) sobre nós ligados por divisas ----
  type Aresta = { a: number; b: number; x: number; y: number; comp: number };
  const arvore = (nos: number[], arestas: Aresta[], criterio: (e: Aresta) => number, floresta = false) => {
    const uf = new Map(nos.map((k) => [k, k]));
    const acha = (k: number): number => { let r = k; while (uf.get(r) !== r) r = uf.get(r)!; return r; };
    const viz = new Map<number, { v: number; e: Aresta }[]>(nos.map((k) => [k, []]));
    for (const e of [...arestas].sort((x, y) => criterio(x) - criterio(y))) {
      const ra = acha(e.a), rb = acha(e.b);
      if (ra === rb) continue;
      uf.set(ra, rb);
      viz.get(e.a)!.push({ v: e.b, e }); viz.get(e.b)!.push({ v: e.a, e });
    }
    if (!floresta && new Set(nos.map(acha)).size > 1) return null;
    // (floresta: uma árvore por parte — a divisa travada separa as partes)
    const pai = new Map<number, { v: number; e: Aresta }>();
    const parte = new Map<number, number>();
    const ordem: number[] = [];
    const visto = new Set<number>();
    for (const raiz of [...nos].sort((x, y) => viz.get(y)!.length - viz.get(x)!.length)) {
      if (visto.has(raiz)) continue;
      const fila = [raiz];
      visto.add(raiz);
      while (fila.length) {
        const k = fila.shift()!;
        ordem.push(k);
        parte.set(k, raiz);
        for (const w of viz.get(k)!) if (!visto.has(w.v)) { visto.add(w.v); pai.set(w.v, { v: k, e: w.e }); fila.push(w.v); }
      }
    }
    // dos filhos para a raiz (as raízes de cada parte ficam de fora)
    const posOrdem = ordem.filter((k) => pai.has(k)).reverse();
    const subarvore = new Map<number, number[]>(nos.map((k) => [k, [k]]));
    for (const k of posOrdem) subarvore.get(pai.get(k)!.v)!.push(...subarvore.get(k)!);
    return { pai, posOrdem, subarvore, parte };
  };
  // arestas entre colunas: divisas laterais entre um lote de cada
  const arestasColunas = (): Aresta[] => {
    const out: Aresta[] = [];
    for (const x of ks) for (const y of ks) {
      if (x >= y || colDe.get(x) === colDe.get(y)) continue;
      const d = divisaEntre(aneis[x], aneis[y]);
      if (!d) continue;
      const est = estruturaDeDivisas(aneis, q);
      if (deFundo(est, d, x, y)) continue;
      out.push({ a: colDe.get(x)!, b: colDe.get(y)!, x, y, comp: dist(d[0], d[1]) });
    }
    return out;
  };
  const nosColunas = cols.map((_, j) => j);
  const criterios: ((e: Aresta) => number)[] = [(e) => -Math.min(e.comp, 999), (e) => Math.min(e.comp, 999)];
  // sem árvore única: ou os lotes não se encostam (recusa), ou são duas fileiras encostadas só
  // pelo fundo e desencontradas (o da frente não fica bem atrás do de trás) — aí cada
  // fileira se iguala por dentro e a linha de fundo fica onde está
  const porFileira = !arvore(nosColunas, arestasColunas(), criterios[0]);
  if (porFileira && uniaoFechada(ks.map((k) => ({ ext: aneis[k], furos: [] as Pt[][] }))).length !== 1) {
    return { pr: pr0, erro: true, msg: "Os lotes selecionados precisam estar encostados uns nos outros (divisa em comum) — selecione lotes vizinhos, sem pular nenhum." };
  }
  // encostados só pelo fundo, cada um numa fileira e sem vizinho de lado na seleção: não
  // há divisa lateral entre eles para andar (a linha de fundo é dos lotes de fora também)
  if (porFileira && arestasColunas().length === 0) {
    return { pr: pr0, erro: true, msg: "Estes lotes só se encostam pelo fundo, cada um numa fileira — não há divisa lateral entre eles para igualar. Selecione lotes vizinhos da mesma fileira, ou os das duas fileiras em pares e use \"Ajustar fundo com fundo\"." };
  }
  const minimo = () => Math.max(1, 0.1 * alvo);
  // divisa travada (não anda no sentido que a conta pede sem deformar um lote): vira
  // corte, e cada parte se iguala por dentro. Sem isso, a coluna da ponta esvaziava a
  // vizinha (que não tinha por onde receber de volta) — A-26 ia de 191 a 113 m²
  const chaveC = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const cortadas = new Map<string, [number, number]>();
  /** as partes (colunas ligadas por divisas não travadas) e a média de cada uma */
  const partes = () => {
    const t = arvore(nosColunas, arestasColunas().filter((e) => !cortadas.has(chaveC(e.a, e.b))), criterios[0], true)!;
    const grupos = new Map<number, number[]>();
    for (const j of nosColunas) grupos.set(t.parte.get(j)!, [...(grupos.get(t.parte.get(j)!) ?? []), ...cols[j]]);
    return [...grupos.values()].map((ls) => ({ lotes: ls, media: somaDe(aneis, ls) / ls.length }));
  };
  const igual = () => partes().every((p) => p.lotes.every((k) => Math.abs(area(aneis, k) - p.media) < 0.01));

  /** 1) entre colunas: cada divisa lateral (de rua a rua) leva a sua parte da árvore à área certa */
  const passeColunas = (criterio: (e: Aresta) => number) => {
    // achou divisa travada no meio da passada: volta ao começo dela e refaz com o corte
    // (o que já tinha andado contava com a divisa travada e esvaziava a coluna da ponta)
    for (let volta = 0; volta < 8; volta++) {
      const inicio = aneis, acompInicio = [...acompanharam];
      if (!umaPasseColunas(criterio)) return;
      aneis = inicio;
      acompanharam.clear();
      acompInicio.forEach((k) => acompanharam.add(k));
    }
  };
  /** uma passada; devolve true se achou divisa travada nova */
  const umaPasseColunas = (criterio: (e: Aresta) => number): boolean => {
    atualizarAlvo();
    let nova = false;
    const t = arvore(nosColunas, arestasColunas().filter((e) => !cortadas.has(chaveC(e.a, e.b))), criterio, true);
    if (!t) return false;
    // a média de cada parte (sem corte, uma só: a de todos)
    const mediaParte = new Map<number, number>();
    for (const raiz of new Set(t.parte.values())) {
      const membros = nosColunas.filter((j) => t.parte.get(j) === raiz);
      mediaParte.set(raiz, membros.reduce((s, j) => s + somaDe(aneis, cols[j]), 0) / membros.reduce((s, j) => s + cols[j].length, 0));
    }
    for (const c of t.posOrdem) {
      const { v: p, e } = t.pai.get(c)!;
      const sub2 = t.subarvore.get(c)!;
      const alvoP = mediaParte.get(t.parte.get(c)!)!;
      const alvoC = sub2.reduce((s, j) => s + cols[j].length * alvoP, 0) - sub2.filter((j) => j !== c).reduce((s, j) => s + somaDe(aneis, cols[j]), 0);
      const x = colDe.get(e.x) === c ? e.x : e.y, y = x === e.x ? e.y : e.x;
      const seg = lateral(aneis, x, y);
      if (!seg) continue;
      const par = somaDe(aneis, cols[c]) + somaDe(aneis, cols[p]);
      const travou = ajustar(seg, cols[c], Math.min(Math.max(alvoC, minimo() * cols[c].length), par - minimo() * cols[p].length), x);
      if (travou && !cortadas.has(chaveC(c, p))) { cortadas.set(chaveC(c, p), [x, y]); nova = true; }
    }
    return nova;
  };
  /**
   * 2) frente × fundo de cada coluna pelas JUNÇÕES da linha de fundo (não pelos
   * trechos): cada junção corre pela sua divisa, e duas colunas vizinhas dividem
   * a mesma junção — a linha de fundo continua contínua, sem degrau. Com uma
   * junção a mais que colunas, há solução; longe do alvo o passo é liso (a
   * linha anda por inteiro), perto dele é o exato de menor dobra. As pontas
   * correm pelo T do lote de fora e pela dobra da rua. A soma de cada coluna não muda.
   */
  const passeJuncoes = () => {
    // colunas na ordem ao longo da quadra (as junções saem em sequência)
    const meioFundo = ([x, z]: [number, number]) => { const d = divisaEntre(aneis[x], aneis[z]); return d ? dot(lerp(d[0], d[1], 0.5), q.u) : 0; };
    const duplas = (cols.filter((c) => c.length === 2) as [number, number][]).sort((a, b) => meioFundo(a) - meioFundo(b));
    if (!duplas.length) return;
    const daColuna = new Set(duplas.flat());
    // cura: degrau numa divisa entre duas colunas selecionadas (o fundo de uma
    // termina num ponto, o da vizinha noutro, na mesma divisa) — as duas pontas
    // se juntam no meio e a linha de fundo volta a ser contínua
    {
      const pontas = duplas.map(([x, z]) => divisaEntre(aneis[x], aneis[z]));
      const juntar: { de: Pt; para: Pt }[] = [];
      for (let c = 0; c + 1 < duplas.length; c++) {
        const d1 = pontas[c], d2 = pontas[c + 1];
        if (!d1 || !d2) continue;
        let par: [Pt, Pt] | null = null, dm = 6;
        for (const a of d1) for (const b of d2) { const dd = dist(a, b); if (dd < dm) { dm = dd; par = [a, b]; } }
        if (!par || dm < TOL) continue;
        // os dois têm de estar na mesma divisa: o trecho entre eles é lado de um lote das duas colunas
        const [a, b] = par;
        const naDivisa = [...duplas[c], ...duplas[c + 1]].some((k) => {
          const an = aneis[k];
          return an.some((v, j) => { const w = an[(j + 1) % an.length]; return distSegmento(a, v, w).d < TOL && distSegmento(b, v, w).d < TOL; });
        });
        if (!naDivisa) continue;
        const meio = lerp(a, b, 0.5);
        juntar.push({ de: a, para: meio }, { de: b, para: meio });
      }
      if (juntar.length) {
        const antesC = aneis.map((_, k) => area(aneis, k));
        const nv = normalizar(moverPontos(aneis, juntar, (k) => daColuna.has(k)));
        const ok = nv.every((x, k) => antesC[k] < 1 || (x.length >= 3 && Math.abs(areaAssinada(x)) >= 1
          && (daColuna.has(k) ? !seCruza(x) : Math.abs(Math.abs(areaAssinada(x)) - antesC[k]) < 0.002)));
        if (ok) aneis = nv;
      }
    }
    const est = estruturaDeDivisas(aneis, q);
    type Juncao = { p: Pt; dir: Pt; todos: boolean; uF: Pt; borda: boolean };
    /** na borda: os vizinhos da junção pela borda, de um lado e do outro da linha de fundo (no desenho de agora) */
    const ladosDe = (j: Juncao): [Pt, Pt] | null => {
      if (!j.borda) return null;
      const viz = aneis.flatMap((an, k) => {
        const jj = daColuna.has(k) ? an.findIndex((v) => dist(v, j.p) < TOL) : -1;
        return jj < 0 ? [] : [an[(jj + an.length - 1) % an.length], an[(jj + 1) % an.length]];
      }).filter((v) => naBorda(q, v) && dist(v, j.p) > 0.05);
      const lado = (v: Pt) => dot(sub(v, j.p), esquerda(j.uF));
      const A = viz.reduce((m: Pt | null, v) => (!m || lado(v) > lado(m) ? v : m), null);
      const B = viz.reduce((m: Pt | null, v) => (!m || lado(v) < lado(m) ? v : m), null);
      return A && B && lado(A) > 0 && lado(B) < 0 ? [A, B] : null;
    };
    const juncoes: Juncao[] = [];
    const extremos: [number, number][] = [];
    for (const [x, z] of duplas) {
      const d = divisaEntre(aneis[x], aneis[z]);
      if (!d) return;
      let uF = unit(sub(d[1], d[0]));
      if (dot(uF, q.u) < 0) uF = mult(uF, -1);
      const ids = d.map((p) => {
        let j = juncoes.findIndex((o) => dist(o.p, p) < TOL);
        if (j < 0) {
          // a junção anda pela divisa lateral dela (na borda, pela borda)
          let dir = trilhoDaJuncao(est, q, p, uF);
          // lote de fora da seleção que também tem o ponto: se o ponto é só passagem num
          // lado reto dele, na direção em que a junção anda, ela corre por esse lado em
          // todos os lotes e o de fora não muda de forma. Presa ali, a ponta da linha de
          // fundo obrigava as junções do meio a compensar uma a uma — o zigue-zague.
          // Senão (quina do lote de fora), só os selecionados a movem (degrau só na ponta)
          const passagem = (an: Pt[]) => {
            const j = an.findIndex((v) => dist(v, p) < TOL);
            if (j < 0) return true;
            const a = an[(j + an.length - 1) % an.length], b = an[(j + 1) % an.length];
            const ab = unit(sub(b, a));
            return distSegmento(p, a, b).d < 0.005 && Math.abs(cross(ab, dir)) < 0.02;
          };
          const todos = aneis.every((an, k) => daColuna.has(k) || passagem(an));
          // todas as junções orientadas para o mesmo lado da linha de fundo (deslocamento "físico" comparável)
          if (dot(dir, esquerda(uF)) < 0) dir = mult(dir, -1);
          // na borda (a ponta que já andou pelo lado do lote pode ficar uns centímetros
          // fora da borda "oficial" da quadra, que é mais curva que o lote)
          juncoes.push({ p, dir, todos, uF, borda: distBorda(q, p) < 0.5 });
          j = juncoes.length - 1;
        }
        return j;
      }) as [number, number];
      extremos.push(ids);
    }
    const antes = aneis.map((_, k) => area(aneis, k));
    const foraAntes = aneis.map((x, k) => (daColuna.has(k) ? fora(x) : 0));
    // a quadra continua coberta: a soma de TODOS os lotes não muda (junção da ponta que
    // anda só nos selecionados e se afasta do vizinho de fora abria um vão entre eles)
    const totalAntes = antes.reduce((t, x) => t + x, 0);
    const frenteJ = new Map([...daColuna].map((k) => [k, frenteNaBorda(aneis[k])]));
    /** para onde a junção vai com o deslocamento s: pela divisa dela; na borda, pelo lado do lote (a rua tem dobras) */
    const destino = (j: Juncao, s: number): Pt => {
      const lados = ladosDe(j);
      if (!lados) return soma(j.p, mult(j.dir, s));
      const v = s >= 0 ? lados[0] : lados[1];
      return soma(j.p, mult(unit(sub(v, j.p)), Math.abs(s)));
    };
    const aplicar = (s: number[]): Pt[][] | null => {
      const geral = juncoes.map((j, jj) => ({ de: j.p, para: destino(j, s[jj]), todos: j.todos, lados: ladosDe(j) })).filter((m, jj) => Math.abs(s[jj]) > 1e-9);
      const anda = (v: Pt) => geral.some((m) => dist(m.de, v) < TOL);
      const andaEmTodos = (v: Pt) => geral.some((m) => m.todos && dist(m.de, v) < TOL);
      // os pontos de passagem (o "T" de outro lote no meio de um lado) saem antes e o
      // normalizar os devolve no lado onde caírem: a junção passa por eles sem dobrar
      // o lote (a ponta da linha de fundo estava a 22 cm da quina de um lote de fora)
      const base = aneis.map((an, k) => (daColuna.has(k) ? semPassagens(an, aneis, (v) => anda(v), q) : semPassagens(an, aneis, (v) => !andaEmTodos(v), q)));
      let nv = moverPontos(base, geral.filter((m) => m.todos));
      nv = moverPontos(nv, geral.filter((m) => !m.todos), (k) => daColuna.has(k));
      // na borda a junção correu pelo lado do lote; onde ela estava, se era dobra da
      // rua, fica como quina do lote que cresceu (senão o lote cortava a dobra)
      for (const m of geral) {
        if (!m.lados) continue;
        const c = m.de;
        nv = nv.map((an, k) => {
          const j = daColuna.has(k) ? an.findIndex((v) => dist(v, m.para) < 1e-9) : -1;
          if (j < 0) return an;
          const n = an.length;
          for (const [jv, antesDele] of [[(j + n - 1) % n, true], [(j + 1) % n, false]] as const) {
            const v = an[jv];
            if (!m.lados!.some((l) => dist(l, v) < TOL) || Math.abs(cross(unit(sub(m.para, v)), sub(c, v))) < 0.002) continue;
            return antesDele ? [...an.slice(0, j), c, ...an.slice(j)] : [...an.slice(0, j + 1), c, ...an.slice(j + 1)];
          }
          return an;
        });
      }
      nv = normalizar(nv);
      if (Math.abs(nv.reduce((t, x) => t + Math.abs(areaAssinada(x)), 0) - totalAntes) > 0.05) return null;
      if ([...daColuna].some((k) => frenteNaBorda(nv[k]) < Math.min(frenteJ.get(k)!, frenteMinima) - 0.01 || !formaBoa(nv[k], k))) return null;
      const ok = nv.every((x, k) => {
        if (antes[k] < 1) return true;
        if (x.length < 3 || Math.sign(areaAssinada(x)) !== Math.sign(areaAssinada(aneis[k])) || Math.abs(areaAssinada(x)) < 1) return false;
        // o de fora: mesma área e, se a junção corre pelo lado dele, sem passar da quina (vira espeto)
        if (!daColuna.has(k)) return Math.abs(Math.abs(areaAssinada(x)) - antes[k]) < 0.002
          && (!geral.some((m) => m.todos && aneis[k].some((v) => dist(v, m.de) < TOL)) || !fiapo(x) || fiapo(aneis[k]));
        return !seCruza(x) && (!fiapo(x) || fiapo(aneis[k])) && fora(x) <= foraAntes[k] + 0.05;
      });
      return ok ? nv : null;
    };
    const resid = (an: Pt[][]) => duplas.map(([x, z]) => (area(an, x) - area(an, z)) / 2);
    // junções em sequência pela linha de fundo (as duplas se encadeiam pela junção
    // comum); a dobra se mede em cada trio seguido
    const trios: [number, number, number][] = [];
    {
      let corrida: number[] = [];
      const fechar = () => { for (let k = 0; k + 2 < corrida.length; k++) trios.push([corrida[k], corrida[k + 1], corrida[k + 2]]); corrida = []; };
      extremos.forEach(([a, b], c) => {
        const ult = corrida[corrida.length - 1];
        if (corrida.length && a === ult) corrida.push(b);
        else if (corrida.length && b === ult) corrida.push(a);
        else {
          fechar();
          const prox = extremos[c + 1];
          corrida = prox && prox.includes(a) ? [b, a] : [a, b];
        }
      });
      fechar();
    }
    for (let it = 0; it < 10; it++) {
      const r = resid(aneis);
      // derivadas: cada junção, um empurrão de 5 cm pela divisa
      const nJ = juncoes.length, nC = duplas.length;
      const J: number[][] = Array.from({ length: nC }, () => new Array(nJ).fill(0));
      for (let jj = 0; jj < nJ; jj++) {
        for (const eps of [0.05, -0.05]) {
          const s = new Array(nJ).fill(0); s[jj] = eps;
          const an = aplicar(s);
          if (!an) continue;
          const r2 = resid(an);
          extremos.forEach(([a, b], c) => { if (a === jj || b === jj) J[c][jj] = (r2[c] - r[c]) / eps; });
          break;
        }
      }
      // a dobra da linha de fundo em cada junção do meio: a distância dela à reta
      // entre as vizinhas, e quanto essa distância muda com cada junção andando
      const dirEf = juncoes.map((j) => mult(sub(destino(j, 0.05), destino(j, -0.05)), 10));
      const dobra0: number[] = [];
      const B: number[][] = trios.map(([x, y, z]) => {
        const P = juncoes[x].p, Q = juncoes[y].p, R = juncoes[z].p;
        const L = Math.max(dist(P, R), 1e-6);
        const u = mult(sub(R, P), 1 / L);
        const t = Math.min(1, Math.max(0, dot(sub(Q, P), u) / L));
        dobra0.push(cross(u, sub(Q, P)));
        const linha = new Array(nJ).fill(0);
        linha[y] += cross(u, dirEf[y]);
        linha[x] -= (1 - t) * cross(u, dirEf[x]);
        linha[z] -= t * cross(u, dirEf[z]);
        return linha;
      });
      // junção que não pode andar o que o passo pede (na ponta da seleção, a quina de um
      // lote de fora no caminho) fica parada; as outras resolvem a conta
      const fixas = new Set<number>();
      // o passo: as áreas batem (J·s = −r) e, entre as soluções que batem, a linha de
      // fundo com MENOS dobra (min Σ dobra²). Há uma família de soluções exatas — numa
      // delas a linha é lisa, nas outras ondula (cada coluna compensa a vizinha); o
      // passo que só olhava a área caía numa das onduladas
      // par com as duas junções paradas não tem como fechar (a ponta da quadra): fica fora
      // da conta — senão o passo aproximado espalhava a diferença dele pelos pares do meio
      const preso = (c: number) => fixas.has(extremos[c][0]) && fixas.has(extremos[c][1]);
      const passoExato = (): number[] | null => {
        const fx = [...fixas];
        const linhas = [...J.filter((_, c) => !preso(c)), ...fx.map((j) => Array.from({ length: nJ }, (_, k) => (k === j ? 1 : 0)))];
        const alvoL = [...r.filter((_, c) => !preso(c)).map((v) => -v), ...fx.map(() => 0)];
        if (linhas.length > nJ) return null;
        const N = nJ + linhas.length;
        const M = Array.from({ length: N }, () => new Array(N).fill(0));
        const rhs = new Array(N).fill(0);
        for (let a = 0; a < nJ; a++) {
          for (let b = 0; b < nJ; b++) M[a][b] = B.reduce((s2, row) => s2 + row[a] * row[b], 0) + (a === b ? 1e-3 : 0);
          rhs[a] = -B.reduce((s2, row, i) => s2 + row[a] * dobra0[i], 0);
        }
        linhas.forEach((row, i) => { for (let a = 0; a < nJ; a++) { M[nJ + i][a] = row[a]; M[a][nJ + i] = row[a]; } rhs[nJ + i] = alvoL[i]; });
        const y = resolver(M, rhs);
        return y && y.slice(0, nJ).every((v) => Number.isFinite(v) && Math.abs(v) < 50) ? y.slice(0, nJ) : null;
      };
      // sem solução exata (junções paradas demais): a mais perto, lisa
      // min Σ(r + J·s)² + α·Σ(s[j+1] − s[j])² + μΣs²
      const passoMinimo = (): number[] | null => {
        const A = Array.from({ length: nJ }, (_, a) => Array.from({ length: nJ }, (_, b) => J.reduce((t, row) => t + row[a] * row[b], 0) + (a === b ? 1e-3 + (fixas.has(a) ? 1e7 : 0) : 0)));
        const alfa = 25;
        // vizinhas pela linha de fundo: as duas pontas de cada coluna (a ordem em que as
        // junções foram achadas nem sempre é a da linha)
        for (const [a, b] of extremos) { A[a][a] += alfa; A[b][b] += alfa; A[a][b] -= alfa; A[b][a] -= alfa; }
        return resolver(A, Array.from({ length: nJ }, (_, a) => -J.reduce((t, row, c) => t + row[a] * r[c], 0)));
      };
      // longe do alvo, o passo liso (a linha anda por inteiro); perto, o exato de menor dobra
      const passo = () => (r.every((v, c) => Math.abs(v) < 0.5 || preso(c)) ? passoExato() ?? passoMinimo() : passoMinimo());
      let y = passo();
      for (let tent = 0; y && tent < nJ; tent++) {
        const ruim = y.findIndex((v, jj) => !fixas.has(jj) && Math.abs(v) > 1e-6 && !aplicar(y!.map((_, k) => (k === jj ? v : 0))));
        if (ruim < 0) break;
        fixas.add(ruim);
        y = passo();
      }
      if (!y || y.every((v) => Math.abs(v) < 1e-4)) break;
      const s = y;
      const norma = (v: number[]) => v.reduce((t, x) => t + x * x, 0);
      // mérito: a área manda; a dobra desempata (a linha só alisa sem desigualar)
      const dobraDe = (novas: Pt[]) => trios.map(([x, y2, z]) => cross(unit(sub(novas[z], novas[x])), sub(novas[y2], novas[x])));
      const merito = (rr: number[], dd: number[]) => norma(rr) + 0.01 * norma(dd);
      const m0 = merito(r, dobra0);
      let aceito = false;
      for (const lambda of [1, 0.5, 0.25, 0.1]) {
        const an = aplicar(s.map((v) => v * lambda));
        if (!an) continue;
        // as junções andam: posição nova (calculada no desenho de antes)
        const novas = juncoes.map((j, jj) => (Math.abs(s[jj] * lambda) > 1e-9 ? destino(j, s[jj] * lambda) : j.p));
        if (merito(resid(an), dobraDe(novas)) < m0 - 1e-7) {
          aneis = an;
          juncoes.forEach((j, jj) => { j.p = novas[jj]; });
          aceito = true;
          break;
        }
      }
      if (!aceito) break;
    }
  };
  /** 3) coluna com mais de dois lotes: o trecho do fundo desliza (raro: esquina com dois de trás) */
  const passeFundos = () => {
    atualizarAlvo();
    for (const col of cols) {
      if (col.length < 3) continue;
      // dentro da coluna, a divisa entre dois lotes é a de fundo (a coluna foi
      // formada por ela) — depois que a linha anda, a estrutura nem sempre a reconhece
      const ar: Aresta[] = [];
      for (const x of col) for (const y of col) {
        if (x >= y) continue;
        const d = divisaEntre(aneis[x], aneis[y]);
        if (d) ar.push({ a: x, b: y, x, y, comp: dist(d[0], d[1]) });
      }
      const t = arvore(col, ar, (e) => -e.comp);
      if (!t) continue;
      for (const c of t.posOrdem) {
        const { v: p } = t.pai.get(c)!;
        const sub2 = t.subarvore.get(c)!;
        const alvoC = sub2.length * alvo - sub2.filter((k) => k !== c).reduce((s, k) => s + area(aneis, k), 0);
        const d = divisaEntre(aneis[c], aneis[p]);
        if (!d) continue;
        const par = area(aneis, c) + area(aneis, p);
        ajustar({ a: d[0], b: d[1], m: null, dirFundo: null, lotes: [c, p] }, [c], Math.min(Math.max(alvoC, minimo()), par - minimo()), c);
      }
    }
  };
  // a soma de cada coluna pelas divisas laterais (paralelas, de rua a rua) e a
  // frente × fundo de cada coluna pelas junções da linha de fundo (contínua):
  // nenhum trecho do fundo anda sozinho — é o que fazia a "escada" de degraus
  for (const criterio of criterios) {
    for (let passe = 0; passe < 10 && !igual(); passe++) {
      passeColunas(criterio);
      passeJuncoes();
      passeFundos();
    }
    if (igual()) break;
  }

  const areas = ks.map((k) => area(aneis, k));
  atualizarAlvo();
  const desvio = Math.max(...areas.map((x) => Math.abs(x - alvo)));
  const nomeDe = (k: number) => { const l = q.lotes.find((x) => posicaoNoDesenho(pr0, res, x) === k); return l ? l.id : `lote ${k + 1}`; };
  const juntos = [...acompanharam];
  const extra = juntos.length
    ? ` Para continuar fundo com fundo, ${juntos.length === 1 ? "o lote de trás" : "os lotes de trás"} ${juntos.map(nomeDe).join(", ")} ${juntos.length === 1 ? "acompanhou" : "acompanharam"} a divisa (selecione-${juntos.length === 1 ? "o" : "os"} também para igualar junto).`
    : "";
  // por partes: a divisa travada separou a seleção; cada parte se igualou por dentro
  const ps = partes();
  const travadas = [...cortadas.values()].map(([x, y]) => `entre ${nomeDe(x)} e ${nomeDe(y)}`);
  const descParte = (p: { lotes: number[]; media: number }) => {
    const as = p.lotes.map((k) => area(aneis, k));
    const mn = Math.min(...as), mx = Math.max(...as);
    const nomes = p.lotes.length <= 4 ? ` (${p.lotes.map(nomeDe).sort().join(", ")})` : "";
    const n = p.lotes.length === 1 ? "1 lote" : `${p.lotes.length} lotes`;
    return mx - mn < 0.05 ? `${n} com ${fmt(p.media)} m²${nomes}` : `${n} entre ${fmt(mn)} e ${fmt(mx)} m²${nomes}`;
  };
  const msg = desvio < 0.05
    ? `${ks.length} lotes com ${fmt(alvo)} m² cada — as divisas entre eles deslizaram${cols.some((c) => c.length > 1) ? " e o fundo com fundo continua alinhado" : ""}.${extra || " Os lotes de fora da seleção não mudaram."}`
    : porFileira && !travadas.length && ps.length > 1
    ? `As fileiras selecionadas estão desencontradas (o lote da frente não fica bem atrás do de trás), então cada uma se igualou por dentro e a linha de fundo ficou onde estava: ${ps.map(descParte).join("; ")}. Os lotes de fora da seleção não mudaram. Para todos com a mesma área, use "Ajustar fundo com fundo" nestes lotes.`
    : travadas.length && ps.length > 1
    ? `Não deu para todos ficarem iguais: ${travadas.length === 1 ? "a divisa" : "as divisas"} ${travadas.join(" e ")} não ${travadas.length === 1 ? "anda" : "andam"} sem deformar um lote (ganharia quina, perderia a testada ou ficaria comprido demais). Os lotes se igualaram por partes: ${ps.map(descParte).join("; ")}.${extra}`
    : `Os lotes ficaram entre ${fmt(Math.min(...areas))} e ${fmt(Math.max(...areas))} m² (o alvo era ${fmt(alvo)} m²): igualar mais deformaria os lotes (lote sem testada, comprido demais ou com degrau) — a forma da quadra não deixa. Ajuste as quinas que faltam ou tire da seleção os lotes da ponta.${extra}`;
  return { pr: gravar(pr, res, i, normalizar(aneis), destinos), msg, sel: { quadra: q.nome, indices: ks } };
}

// ---------------------------------------------------------------------------
// Alças: o que o editor mostra no lote selecionado
// ---------------------------------------------------------------------------

export interface Alca { tipo: "quina" | "divisa"; p: Pt; a?: Pt; b?: Pt; naBorda: boolean }

/**
 * Lados retos do polígono, de quina a quina. O arco (ou chanfro) da esquina é
 * UMA quina com começo e fim (PC e PT): o lado de rua vai do fim de uma quina ao
 * começo da próxima, então a rua do lote de esquina é clicável dos dois lados do
 * arco (antes, o lado começava no meio do arco e era descartado como "torto").
 */
export function ladosRetos(pol: Poligono): [Pt, Pt][] {
  const e = pol.ext, n = e.length;
  const qs = quinasDetalhe(e, 3.5, 3).sort((x, y) => x.i0 - y.i0);
  const out: [Pt, Pt][] = [];
  for (let k = 0; k < qs.length; k++) {
    const i0 = qs[k].i1, i1 = qs[(k + 1) % qs.length].i0;
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
