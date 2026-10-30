// Ações do editor: tudo o que muda o projeto passa por aqui — o arraste no
// desenho, os botões do painel e a linha de comando. Uma ação recebe o projeto
// e o resultado atual e devolve um projeto NOVO (nunca muta), o que dá o
// desfazer/refazer de graça.
import { areaPol, centroide, cross, dentroPol, dist, dot, sub, unit } from "./geom.ts";
import type { Pt } from "./geom.ts";
import { ancoraDaQuadra } from "./auto.ts";
import { fmt } from "./calculo.ts";
import type { Corte, Lote, Quadra, Resultado } from "./calculo.ts";
import { paraPlano, paraUtm } from "./plano.ts";
import { ROTULO_AREA, mudarLote, novoId } from "./modelo.ts";
import {
  acertarMedida, apagarLotes, desenharLote, dividirLote, mudarDestino, posicaoNoDesenho, quadraDesenhada, unirComVizinho, unirLotes, voltarAoAutomatico,
} from "./edicao.ts";
import type { Edicao } from "./edicao.ts";
import type { AjusteLote, AreaDesenhada, Esquina, Parametros, Projeto, QuadraCfg, Rua, Sobra, TipoArea } from "./modelo.ts";

/** Lote identificado pela posição (sobrevive à renumeração). */
export interface ChaveLote { quadra: string; fileira: number; indice: number }

export type Selecao =
  | { tipo: "lotes"; chaves: ChaveLote[] }
  | { tipo: "quadra"; nome: string }
  | { tipo: "rua"; id: string }
  | { tipo: "area"; id: string }
  | null;

export const chaveDoLote = (l: Lote): ChaveLote => ({ quadra: l.quadra, fileira: l.fileira, indice: l.indice });

export function lotesDaSelecao(res: Resultado, sel: Selecao): Lote[] {
  if (sel?.tipo !== "lotes") return [];
  return sel.chaves
    .map((c) => res.lotes.find((l) => l.quadra === c.quadra && l.fileira === c.fileira && Math.abs(l.indice - c.indice) < 1e-9))
    .filter((l): l is Lote => !!l);
}

export const quadraDe = (res: Resultado, nome: string): Quadra | undefined =>
  res.quadras.find((q) => q.nome === nome) ?? res.quadrasVazias?.find((q) => q.nome === nome);

/** Garante uma config para a quadra (âncora num ponto interno) e devolve o índice. */
function garantirCfg(pr: Projeto, res: Resultado, q: Quadra): { pr: Projeto; i: number } {
  if (q.cfg >= 0 && pr.quadras[q.cfg]) return { pr, i: q.cfg };
  const ancora = paraUtm(res.plano, ancoraDaQuadra(q));
  const quadras = [...pr.quadras, { ancora, ajustes: [] } as QuadraCfg];
  return { pr: { ...pr, quadras }, i: quadras.length - 1 };
}

function comCfg(pr: Projeto, res: Resultado, q: Quadra, f: (c: QuadraCfg) => QuadraCfg): Projeto {
  const { pr: p2, i } = garantirCfg(pr, res, q);
  const quadras = p2.quadras.slice();
  quadras[i] = f({ ...quadras[i], ajustes: [...quadras[i].ajustes] });
  return { ...p2, quadras };
}

/** Aplica (ou remove, com `null`) um ajuste num lote. */
export function ajustarLote(pr: Projeto, res: Resultado, l: Lote, patch: Partial<AjusteLote> | null): Projeto {
  const q = quadraDe(res, l.quadra);
  if (!q) return pr;
  const indice = Math.floor(l.indice + 1e-9);
  return comCfg(pr, res, q, (c) => {
    const i = c.ajustes.findIndex((a) => a.fileira === l.fileira && a.indice === indice);
    const atual: AjusteLote = i >= 0 ? c.ajustes[i] : { fileira: l.fileira, indice };
    const ajustes = c.ajustes.slice();
    if (patch === null) { if (i >= 0) ajustes.splice(i, 1); return { ...c, ajustes }; }
    const novo: AjusteLote = { ...atual, ...patch };
    // frente e área são excludentes: travar uma solta a outra
    if (patch.frente !== undefined) delete novo.area;
    if (patch.area !== undefined) delete novo.frente;
    for (const k of Object.keys(novo) as (keyof AjusteLote)[]) if (novo[k] === undefined) delete novo[k];
    if (i >= 0) ajustes[i] = novo; else ajustes.push(novo);
    return { ...c, ajustes };
  });
}

export function ajustarQuadra(pr: Projeto, res: Resultado, q: Quadra, patch: Partial<QuadraCfg>): Projeto {
  return comCfg(pr, res, q, (c) => {
    const novo = { ...c, ...patch };
    for (const k of Object.keys(patch) as (keyof QuadraCfg)[]) if (patch[k] === undefined) delete novo[k];
    // mudar a regra de divisão é pedir ao sistema que divida de novo: o desenho à mão sai
    if (["modo", "valor", "sobra", "fileiras", "fundo", "frentePrincipal"].some((k) => k in patch)) delete novo.lotes;
    return novo;
  });
}

/** Volta a quadra ao padrão do projeto (some a config inteira). */
export function restaurarQuadra(pr: Projeto, q: Quadra): Projeto {
  if (q.cfg < 0) return pr;
  return { ...pr, quadras: pr.quadras.filter((_, i) => i !== q.cfg) };
}

// ---------------------------------------------------------------------------
// Regras na edição: as medidas do lote do projeto (mín./máx. de frente e área)
// valem para o que o operador digita, une ou divide. A conferência geral (lote
// nenhum sai das regras) fica no editor, que recalcula antes de aceitar.
// ---------------------------------------------------------------------------

const FORA = "Aplicado mesmo assim: o lote fica com aviso na planta até ser acertado.";

/** Frente ou área digitada fora das faixas do projeto → aviso (a edição é livre); dentro → null. */
export function conferirMedida(p: Parametros, campo: "frente" | "area", v: number): string | null {
  const [min, max, un, nome] = campo === "frente" ? [p.frenteMin, p.frenteMax, "m", "Frente"] : [p.areaMin, p.areaMax, "m²", "Área"];
  if (v >= min - 1e-6 && v <= max + 1e-6) return null;
  return `${nome} de ${fmt(v)} ${un} fora das medidas do projeto (${fmt(min)} a ${fmt(max)} ${un}). ${FORA}`;
}

/** Lote seguinte na fileira (o que "unir" junta). */
function seguinte(res: Resultado, l: Lote): Lote | undefined {
  return res.lotes
    .filter((x) => x.quadra === l.quadra && x.fileira === l.fileira && x.indice > l.indice + 1e-9)
    .sort((a, b) => a.indice - b.indice)[0];
}

/** Unir passaria da área máxima? (aviso; só "não há lote seguinte" impede) */
export function conferirUnir(p: Parametros, res: Resultado, lotes: Lote[]): string | null {
  const grupo = lotes.length === 1 ? [lotes[0], seguinte(res, lotes[0])].filter((x): x is Lote => !!x) : lotes;
  if (grupo.length < 2) return "Não há lote seguinte na fileira para unir.";
  const area = grupo.reduce((s, l) => s + l.area, 0);
  if (area <= p.areaMax + 0.5) return null;
  return `Unidos, os lotes teriam ${fmt(area)} m² — passa da área máxima de ${fmt(p.areaMax)} m². ${FORA}`;
}

/** Dividir em n deixaria parte abaixo do mínimo? (aviso) */
export function conferirDividir(p: Parametros, l: Lote, n: number): string | null {
  if (l.area / n < p.areaMin - 0.01) return `Em ${n} partes, cada uma teria ${fmt(l.area / n)} m² — abaixo da área mínima de ${fmt(p.areaMin)} m².`;
  if (l.frente / n < p.frenteMin - 0.005) return `Em ${n} partes, cada uma teria ${fmt(l.frente / n)} m de frente — abaixo da frente mínima de ${fmt(p.frenteMin)} m.`;
  return null;
}

/**
 * Arrastar a divisa entre dois lotes = travar a frente do lote de trás dela.
 * Edição livre: a divisa vai aonde o operador soltar (fora das faixas o lote
 * fica com aviso); só não passa de 0,5 m, para o lote não sumir.
 */
export function moverCorte(pr: Projeto, res: Resultado, c: Corte, ponto: Pt): Projeto {
  const s = dot(sub(ponto, c.o), c.dir);
  // só o limite geométrico: a divisa não passa do fim da fileira
  const frente = Math.max(0.5, Math.min(s - c.s0, (c.sFim ?? Infinity) - c.s0 - 0.5));
  const q = quadraDoCorte(res, c);
  if (!q) return pr;
  // o lote daquela posição pode ter sido redistribuído no acabamento (ponta da
  // fileira): a trava vai para a posição mesmo assim — e lote travado o
  // acabamento não refaz, então a divisa fica onde o operador soltou
  const l = res.lotes.find((x) => x.quadra === q.nome && x.fileira === c.fileira && Math.abs(x.indice - c.indice) < 1e-9)
    ?? ({ quadra: q.nome, fileira: c.fileira, indice: c.indice } as Lote);
  return ajustarLote(pr, res, l, { frente: Math.round(frente * 100) / 100 });
}

/**
 * Lado da quadra escolhido como acesso (a quadra dá para servidão, área verde,
 * divisa com saída): conta como frente — a quadra automática é dividida a
 * partir dele e os lotes que encostam nele têm frente. Clicar de novo tira.
 * `a`/`b` no plano.
 */
export function alternarAcesso(pr: Projeto, res: Resultado, q: Quadra, a: Pt, b: Pt): { pr: Projeto; msg: string } {
  const atuais = (q.cfg >= 0 ? pr.quadras[q.cfg]?.acessos : undefined) ?? [];
  const d = unit(sub(b, a));
  const P = (x: Pt) => paraPlano(res.plano, x);
  const igual = (sg: [Pt, Pt]) => Math.abs(cross(d, unit(sub(P(sg[1]), P(sg[0]))))) < 0.1 && Math.abs(cross(d, sub(P(sg[0]), a))) < 0.5;
  const tem = atuais.some(igual);
  const novos: [Pt, Pt][] = tem ? atuais.filter((sg) => !igual(sg)) : [...atuais, [paraUtm(res.plano, a), paraUtm(res.plano, b)]];
  return {
    pr: ajustarQuadra(pr, res, q, { acessos: novos }),
    msg: tem ? `Acesso retirado da quadra ${q.nome}.` : `Lado de ${fmt(dist(a, b))} m marcado como frente (acesso) da quadra ${q.nome} — os lotes que encostam nele têm frente ali.`,
  };
}

export const quadraDoCorte = (res: Resultado, c: Corte): Quadra | undefined => res.quadras.find((q) => q.cortes.includes(c));

export function moverFundo(pr: Projeto, res: Resultado, q: Quadra, ponto: Pt): Projeto {
  const v = dot(sub(ponto, q.origem), q.v);
  return ajustarQuadra(pr, res, q, { fundo: Math.max(1, Math.round(v * 100) / 100), fileiras: 2 });
}

export function adicionarRua(pr: Projeto, eixoUtm: Pt[], largura?: number): { pr: Projeto; id: string } {
  const id = novoId("m");
  const n = pr.ruas.length + 1;
  const rua: Rua = { id, nome: `Rua ${String(n).padStart(2, "0")}`, largura: largura ?? pr.params.ruaLargura, eixo: eixoUtm };
  return { pr: { ...pr, ruas: [...pr.ruas, rua] }, id };
}

export const editarRua = (pr: Projeto, id: string, patch: Partial<Rua>): Projeto =>
  ({ ...pr, ruas: pr.ruas.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

export const removerRua = (pr: Projeto, id: string): Projeto => ({ ...pr, ruas: pr.ruas.filter((r) => r.id !== id) });

export function adicionarArea(pr: Projeto, anelUtm: Pt[], tipo: TipoArea): { pr: Projeto; id: string } {
  const id = novoId("d");
  const a: AreaDesenhada = { id, tipo, nome: "", anel: anelUtm };
  return { pr: { ...pr, areas: [...pr.areas, a] }, id };
}

/**
 * Muda o tipo de uma área pública — seja ela desenhada, uma quadra inteira ou
 * um grupo de lotes. `null` devolve a área para o loteamento (vira lote de novo).
 */
export function mudarArea(pr: Projeto, res: Resultado, id: string, tipo: TipoArea | null): Projeto {
  const a = res.areas.find((x) => x.id === id);
  if (!a) return pr;
  if (a.origem === "desenho") {
    return tipo === null
      ? { ...pr, areas: pr.areas.filter((x) => x.id !== id) }
      : { ...pr, areas: pr.areas.map((x) => (x.id === id ? { ...x, tipo } : x)) };
  }
  if (a.origem === "sobra" && a.cfg !== undefined) {
    const lista = (pr.sobrasPublicas ?? []).slice();
    if (tipo === null) lista.splice(a.cfg, 1); else lista[a.cfg] = { ...lista[a.cfg], tipo };
    return { ...pr, sobrasPublicas: lista };
  }
  if (a.origem === "quadra" && a.cfg !== undefined && a.cfg >= 0) {
    const quadras = pr.quadras.slice();
    quadras[a.cfg] = { ...quadras[a.cfg], destino: tipo ?? undefined };
    if (tipo === null) delete quadras[a.cfg].destino;
    return { ...pr, quadras };
  }
  if (a.origem === "lotes" && a.cfg !== undefined && a.cfg >= 0 && Array.isArray(pr.quadras[a.cfg]?.lotes)) {
    // quadra desenhada: o destino está no contorno de cada lote
    const quadras = pr.quadras.slice();
    const c = quadras[a.cfg];
    quadras[a.cfg] = { ...c, lotes: c.lotes!.map((l) => (l.destino === a.tipo ? (tipo ? { ...l, destino: tipo } : { anel: l.anel }) : l)) };
    return { ...pr, quadras };
  }
  if (a.origem === "lotes" && a.cfg !== undefined && a.cfg >= 0) {
    const quadras = pr.quadras.slice();
    const c = quadras[a.cfg];
    quadras[a.cfg] = {
      ...c,
      ajustes: c.ajustes
        .map((x) => (x.destino === a.tipo ? { ...x, destino: tipo ?? undefined } : x))
        .map((x) => { if (x.destino === undefined) { const y = { ...x }; delete y.destino; return y; } return x; }),
    };
    return { ...pr, quadras };
  }
  return pr;
}

export const renomearArea = (pr: Projeto, res: Resultado, id: string, nome: string): Projeto => {
  const a = res.areas.find((x) => x.id === id);
  if (!a) return pr;
  if (a.origem === "desenho") return { ...pr, areas: pr.areas.map((x) => (x.id === id ? { ...x, nome } : x)) };
  if (a.origem === "quadra" && a.cfg !== undefined && a.cfg >= 0) {
    const quadras = pr.quadras.slice();
    quadras[a.cfg] = { ...quadras[a.cfg], nome };
    return { ...pr, quadras };
  }
  return pr;
};

// ---------------------------------------------------------------------------
// Linha de comando
// ---------------------------------------------------------------------------

export type Ferramenta = "selecionar" | "rua" | "area" | "medir" | "lote" | "cortar" | "frente";

export interface Saida {
  pr?: Projeto;
  sel?: Selecao;
  ferramenta?: Ferramenta;
  /** foca/enquadra um ponto do plano */
  focar?: Pt;
  desfazer?: boolean;
  refazer?: boolean;
  ajuda?: boolean;
  msg: string;
  erro?: boolean;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const num = (s: string | undefined) => {
  if (!s) return NaN;
  return Number(s.replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
};

export const COMANDOS: { cmd: string; exemplo: string; desc: string; contexto: ("nada" | "lote" | "quadra" | "rua" | "area")[] }[] = [
  { cmd: "frente", exemplo: "frente 12", desc: "deixa o lote com esta frente (a divisa desliza e o vizinho se ajusta) · na quadra, muda a frente padrão · \"frente padrão 12\" muda a do projeto", contexto: ["lote", "quadra", "nada"] },
  { cmd: "area", exemplo: "area 300", desc: "deixa o lote com esta área (a divisa desliza) · na quadra, divide em áreas iguais deste tamanho", contexto: ["lote", "quadra"] },
  { cmd: "unir", exemplo: "unir", desc: "une os lotes selecionados (um só: une ao vizinho de maior divisa)", contexto: ["lote"] },
  { cmd: "dividir", exemplo: "dividir 2", desc: "divide o lote em partes iguais, com as divisas na direção das laterais dele", contexto: ["lote"] },
  { cmd: "apagar", exemplo: "apagar", desc: "apaga o lote (a área fica livre para desenhar outro) · Delete", contexto: ["lote", "rua", "area"] },
  { cmd: "desenhar lote", exemplo: "desenhar lote", desc: "desenha um lote: clique as quinas, Enter fecha (L) · duplo clique na área livre rosa vira lote", contexto: ["nada", "lote", "quadra"] },
  { cmd: "definir", exemplo: "definir frente", desc: "escolher a frente: clique no lado do lote (ou da quadra) que é a frente dele (T)", contexto: ["lote", "quadra", "nada"] },
  { cmd: "cortar", exemplo: "cortar", desc: "corta lotes com uma linha: clique o início e o fim (C)", contexto: ["nada", "lote", "quadra"] },
  { cmd: "preencher", exemplo: "preencher", desc: "cada área livre (rosa) da quadra vira um lote", contexto: ["quadra"] },
  { cmd: "automatico", exemplo: "automatico", desc: "a quadra desenhada à mão volta a ser dividida pelo sistema", contexto: ["quadra"] },
  { cmd: "verde", exemplo: "verde", desc: "transforma em área verde", contexto: ["lote", "quadra", "area"] },
  { cmd: "institucional", exemplo: "institucional", desc: "transforma em área institucional", contexto: ["lote", "quadra", "area"] },
  { cmd: "lazer", exemplo: "lazer", desc: "transforma em área de lazer", contexto: ["lote", "quadra", "area"] },
  { cmd: "lote", exemplo: "lote", desc: "devolve a área para lotes", contexto: ["area", "lote"] },
  { cmd: "soltar", exemplo: "soltar", desc: "na quadra automática, volta o lote (ou a quadra) à regra do projeto", contexto: ["lote", "quadra"] },
  { cmd: "qtd", exemplo: "qtd 8", desc: "quadra com N lotes por fileira, de frente igual", contexto: ["quadra"] },
  { cmd: "iguais", exemplo: "iguais", desc: "quadra em áreas iguais (absorve divisa torta)", contexto: ["quadra"] },
  { cmd: "padronizar", exemplo: "padronizar", desc: "quadra com frente padrão", contexto: ["quadra"] },
  { cmd: "sobra", exemplo: "sobra esquinas", desc: "para onde vai a sobra: esquinas, ultimo, distribuir, extra", contexto: ["quadra", "nada"] },
  { cmd: "fileiras", exemplo: "fileiras 1", desc: "uma ou duas fileiras de lotes (auto)", contexto: ["quadra"] },
  { cmd: "fundo", exemplo: "fundo 25", desc: "distância da rua principal até a linha de fundo", contexto: ["quadra"] },
  { cmd: "prof", exemplo: "prof 30", desc: "profundidade padrão dos lotes do projeto", contexto: ["nada"] },
  { cmd: "largura", exemplo: "largura 14", desc: "largura da rua selecionada (sem seleção: todas)", contexto: ["rua", "nada"] },
  { cmd: "balao", exemplo: "balao 10", desc: "balão de retorno no fim da rua (raio, m)", contexto: ["rua"] },
  { cmd: "nome", exemplo: "nome Rua das Flores", desc: "renomeia a rua, a quadra ou a área", contexto: ["rua", "quadra", "area"] },
  { cmd: "esquina", exemplo: "esquina raio 6", desc: "esquinas: raio N, chanfro N ou nenhuma", contexto: ["nada"] },
  { cmd: "excluir", exemplo: "excluir", desc: "apaga a rua ou a área desenhada", contexto: ["rua", "area"] },
  { cmd: "rua", exemplo: "rua", desc: "desenhar rua: clique os pontos do eixo, Enter termina", contexto: ["nada", "lote", "quadra", "rua", "area"] },
  { cmd: "desenhar", exemplo: "desenhar area", desc: "desenhar área pública: clique o contorno, Enter fecha", contexto: ["nada"] },
  { cmd: "medir", exemplo: "medir", desc: "mede distância entre dois pontos", contexto: ["nada"] },
  { cmd: "ir", exemplo: "ir A-12", desc: "vai até o lote ou a quadra", contexto: ["nada", "lote", "quadra", "rua", "area"] },
  { cmd: "preco", exemplo: "preco 180", desc: "preço do m² para o quadro de vendas", contexto: ["nada"] },
  { cmd: "desfazer", exemplo: "desfazer", desc: "Ctrl+Z", contexto: ["nada"] },
  { cmd: "refazer", exemplo: "refazer", desc: "Ctrl+Y", contexto: ["nada"] },
];

export function contextoDe(sel: Selecao): "nada" | "lote" | "quadra" | "rua" | "area" {
  if (!sel) return "nada";
  return sel.tipo === "lotes" ? "lote" : sel.tipo;
}

const TIPOS_AREA: Record<string, TipoArea> = { verde: "verde", institucional: "institucional", lazer: "lazer", app: "app" };
const SOBRAS: Record<string, Sobra> = { esquinas: "esquinas", esquina: "esquinas", ultimo: "ultimo", distribuir: "distribuir", extra: "extra" };

export function executar(texto: string, pr: Projeto, res: Resultado, sel: Selecao): Saida {
  const bruto = texto.trim();
  if (!bruto) return { msg: "" };
  const t = semAcento(bruto);
  const [cmd0, ...args] = t.split(/\s+/);
  const cmd = cmd0.replace(/:$/, "");
  const a1 = args[0];
  // o número é o primeiro argumento numérico ("frente padrão 12" também vale)
  const n1 = num(args.find((x) => Number.isFinite(num(x))) ?? a1);
  const lotes = lotesDaSelecao(res, sel);
  const quadra = sel?.tipo === "quadra" ? quadraDe(res, sel.nome) : undefined;
  const p = pr.params;
  const precisa = (o: string): Saida => ({ msg: `Selecione ${o} primeiro (clique no desenho).`, erro: true });
  const numErr = (ex: string): Saida => ({ msg: `Faltou o número — ex.: ${ex}`, erro: true });

  // atalho: "A12", "A-12", "b" → ir
  if (/^[a-z]{1,2}-?\d{1,3}$/.test(t) || (/^[a-z]{1,2}$/.test(t) && res.quadras.some((q) => semAcento(q.nome) === t))) return irPara(t, res);

  switch (cmd) {
    case "ajuda": case "?": case "help": return { ajuda: true, msg: "Comandos na lista abaixo." };
    case "desfazer": case "u": case "undo": return { desfazer: true, msg: "Desfeito." };
    case "refazer": case "redo": return { refazer: true, msg: "Refeito." };
    case "rua": return { ferramenta: "rua", sel: null, msg: "Clique os pontos do eixo da rua. Enter ou duplo clique termina, Esc cancela. Shift trava o ângulo." };
    case "desenhar": case "poligono":
      if (a1 === "lote") return { ferramenta: "lote", sel: null, msg: "Clique as quinas do lote (elas grudam nas dos vizinhos). Enter fecha; o lote se ajusta aos vizinhos. Duplo clique numa área livre rosa vira lote." };
      return { ferramenta: "area", sel: null, msg: "Clique o contorno da área. Enter fecha, Esc cancela." };
    case "preencher": {
      if (!quadra) return precisa("a quadra (duplo clique num lote)");
      const livres = res.sobras.filter((sb) => dentroPol(centroide(sb.ext), quadra.pol) && areaPol(sb) > 1);
      if (!livres.length) return { msg: `A quadra ${quadra.nome} não tem área livre.` };
      let novo = pr, feitos = 0;
      for (const sb of livres) { const ed = desenharLote(novo, res, sb.ext); if (ed) { novo = ed.pr; feitos++; } }
      if (!feitos) return { msg: "Não consegui fazer lote da área livre desta quadra.", erro: true };
      return { pr: novo, msg: `${feitos === 1 ? "A área livre virou um lote" : `${feitos} áreas livres viraram lotes`} — ajuste as quinas se quiser.` };
    }
    case "definir": return { ferramenta: "frente", msg: lotes.length === 1 ? "Clique no lado do lote que é a frente dele (clicar de novo tira)." : "Clique no lado da quadra que é o acesso (frente) dela — ou selecione um lote antes para escolher a frente dele." };
    case "cortar": case "corte": return { ferramenta: "cortar", msg: "Clique o início e o fim da linha de corte: cada lote que ela atravessa vira dois." };
    case "automatico": case "automatica": {
      if (!quadra) return precisa("a quadra (duplo clique num lote)");
      if (!quadraDesenhada(pr, quadra, res.plano)) return { msg: `A quadra ${quadra.nome} já é dividida pelo sistema.` };
      return { pr: voltarAoAutomatico(pr, quadra, res.plano), msg: `Quadra ${quadra.nome} voltou a ser dividida pelo sistema (o desenho à mão foi descartado; Ctrl+Z desfaz).` };
    }
    case "medir": return { ferramenta: "medir", msg: "Clique dois pontos para medir." };
    case "ir": case "zoom": return irPara(args.join(""), res);

    case "frente": case "f": case "testada": {
      if (!Number.isFinite(n1) || n1 <= 0) return numErr("frente 12");
      const avF = lotes.length || quadra ? conferirMedida(p, "frente", n1) : null;
      const comAvF = (m: string) => (avF ? `${m} Atenção: ${avF}` : m);
      if (lotes.length) {
        const ed = emSequencia(pr, res, lotes, (p2, q, l, feitos) => acertarMedida(p2, res, q, l, "frente", n1, feitos));
        if (!ed) return { msg: "Não achei uma divisa lateral para deslizar neste lote (ele não tem vizinho ao lado).", erro: true };
        if (ed.erro) return { msg: ed.msg, erro: true };
        return { pr: ed.pr, sel: selDe(ed, lotes), msg: comAvF(lotes.length === 1 ? ed.msg : `${lotes.length} lotes com ${fmt(n1)} m de frente — os vizinhos se ajustaram.`) };
      }
      if (quadra) return { pr: ajustarQuadra(pr, res, quadra, { modo: "frente", valor: n1 }), msg: comAvF(`Quadra ${quadra.nome}: frente padrão ${fmt(n1)} m.`) };
      // sem nada selecionado, só muda o padrão do projeto se o operador pedir com todas as letras
      // (seleção perdida não pode mexer no loteamento inteiro)
      if (!/padrao|projeto/.test(t)) return { msg: `Nenhum lote selecionado. Clique num lote (ou duplo clique na quadra); para mudar a frente padrão do projeto digite: frente padrão ${fmt(n1)}`, erro: true };
      return { pr: { ...pr, params: mudarLote(p, { frente: n1 }) }, msg: `Frente padrão do projeto: ${fmt(n1)} m (todas as quadras sem ajuste próprio; as faixas automáticas acompanham).` };
    }
    case "area": case "a": {
      if (!Number.isFinite(n1) || n1 <= 0) return numErr("area 300");
      const avA = lotes.length || quadra ? conferirMedida(p, "area", n1) : null;
      const comAvA = (m: string) => (avA ? `${m} Atenção: ${avA}` : m);
      if (lotes.length) {
        const ed = emSequencia(pr, res, lotes, (p2, q, l, feitos) => acertarMedida(p2, res, q, l, "area", n1, feitos));
        if (!ed) return { msg: "Não achei uma divisa lateral para deslizar neste lote (ele não tem vizinho ao lado).", erro: true };
        if (ed.erro) return { msg: ed.msg, erro: true };
        return { pr: ed.pr, sel: selDe(ed, lotes), msg: comAvA(lotes.length === 1 ? ed.msg : `${lotes.length} lotes com ${fmt(n1)} m² — os vizinhos se ajustaram.`) };
      }
      if (quadra) return { pr: ajustarQuadra(pr, res, quadra, { modo: "area", valor: n1 }), msg: comAvA(`Quadra ${quadra.nome}: lotes de áreas iguais, alvo ${fmt(n1)} m².`) };
      return precisa("um lote ou uma quadra");
    }
    case "unir": case "juntar": {
      if (!lotes.length) return precisa("o lote");
      const qs = new Set(lotes.map((l) => l.quadra));
      if (qs.size > 1) return { msg: "Só dá para unir lotes da mesma quadra.", erro: true };
      const q = quadraDe(res, lotes[0].quadra)!;
      const ed = lotes.length === 1 ? unirComVizinho(pr, res, q, lotes[0]) : unirLotes(pr, res, q, lotes.map((l) => posicaoNoDesenho(pr, res, l)));
      if (!ed) return { msg: lotes.length === 1 ? "Este lote não tem vizinho com divisa em comum." : "Os lotes selecionados não se tocam — selecione lotes vizinhos.", erro: true };
      const eU = conferirUnir(p, res, lotes);
      return { pr: ed.pr, sel: selDe(ed, lotes), msg: eU && !eU.startsWith("Não há") ? `${ed.msg} Atenção: ${eU}` : ed.msg };
    }
    case "dividir": case "desmembrar": {
      if (lotes.length !== 1) return precisa("um lote");
      if (a1 !== undefined && !Number.isFinite(n1)) return { msg: `"${a1}" não é um número — ex.: dividir 3`, erro: true };
      const n = Number.isFinite(n1) ? Math.round(n1) : 2;
      if (n < 2 || n > 60) return { msg: "Divida em 2 a 60 partes (para mais, divida as partes de novo).", erro: true };
      const eD = conferirDividir(p, lotes[0], n);
      const ed = dividirLote(pr, res, quadraDe(res, lotes[0].quadra)!, lotes[0], n);
      if (!ed) return { msg: "Não consegui dividir este lote em partes iguais (forma muito irregular) — use a ferramenta Cortar (C).", erro: true };
      const selD: Selecao = ed.sel ? { tipo: "lotes", chaves: [{ quadra: ed.sel.quadra, fileira: 0, indice: ed.sel.indices[0] }] } : selDe(ed, lotes);
      return { pr: ed.pr, sel: selD, msg: eD ? `${ed.msg} Atenção: ${eD} ${FORA}` : ed.msg };
    }
    case "verde": case "institucional": case "lazer": case "app": {
      const tipo = TIPOS_AREA[cmd];
      if (lotes.length) return { pr: destinoDosLotes(pr, res, lotes, tipo), sel: null, msg: `${lotes.length === 1 ? "Lote" : `${lotes.length} lotes`} → ${ROTULO_AREA[tipo]}.` };
      if (quadra) return { pr: ajustarQuadra(pr, res, quadra, { destino: tipo }), sel: null, msg: `Quadra ${quadra.nome} → ${ROTULO_AREA[tipo]}.` };
      if (sel?.tipo === "area") return { pr: mudarArea(pr, res, sel.id, tipo), msg: `Área → ${ROTULO_AREA[tipo]}.` };
      return precisa("um lote, uma quadra ou uma área");
    }
    case "lote": case "devolver": case "lotear": {
      if (sel?.tipo === "area") return { pr: mudarArea(pr, res, sel.id, null), sel: null, msg: "A área voltou a ser loteada." };
      return precisa("uma área pública");
    }
    case "soltar": case "destravar": case "padrao": case "resetar": {
      if (lotes.length) {
        let novo = pr;
        for (const l of lotes) novo = ajustarLote(novo, res, l, null);
        return { pr: novo, msg: "Travas removidas — o lote voltou à regra da quadra." };
      }
      if (quadra) return { pr: restaurarQuadra(pr, quadra), msg: `Quadra ${quadra.nome} de volta ao padrão do projeto.` };
      return precisa("um lote ou uma quadra");
    }
    case "qtd": case "quantidade": {
      if (!quadra) return precisa("a quadra (duplo clique num lote)");
      if (!Number.isFinite(n1) || n1 < 1) return numErr("qtd 8");
      return { pr: ajustarQuadra(pr, res, quadra, { modo: "quantidade", valor: Math.round(n1) }), msg: `Quadra ${quadra.nome}: ${Math.round(n1)} lotes por fileira.` };
    }
    case "iguais": {
      if (!quadra) return precisa("a quadra");
      return { pr: ajustarQuadra(pr, res, quadra, { modo: "area", valor: Number.isFinite(n1) ? n1 : p.areaPadrao }), msg: `Quadra ${quadra.nome} em áreas iguais.` };
    }
    case "padronizar": case "padronizada": {
      if (!quadra) return precisa("a quadra");
      return { pr: ajustarQuadra(pr, res, quadra, { modo: "frente", valor: Number.isFinite(n1) ? n1 : p.frente }), msg: `Quadra ${quadra.nome} padronizada.` };
    }
    case "sobra": {
      const s = SOBRAS[a1 ?? ""];
      if (!s) return { msg: "Use: sobra esquinas | ultimo | distribuir | extra", erro: true };
      if (quadra) return { pr: ajustarQuadra(pr, res, quadra, { sobra: s }), msg: `Quadra ${quadra.nome}: sobra → ${a1}.` };
      return { pr: { ...pr, params: { ...p, sobra: s } }, msg: `Sobra do projeto → ${a1}.` };
    }
    case "fileiras": case "fileira": {
      if (!quadra) return precisa("a quadra");
      const v = a1 === "auto" ? "auto" : Math.round(n1) === 1 ? 1 : Math.round(n1) === 2 ? 2 : null;
      if (v === null) return { msg: "Use: fileiras 1 | 2 | auto", erro: true };
      return { pr: ajustarQuadra(pr, res, quadra, { fileiras: v }), msg: `Quadra ${quadra.nome}: ${v === "auto" ? "fileiras automáticas" : `${v} fileira(s)`}.` };
    }
    case "fundo": {
      if (!quadra) return precisa("a quadra");
      if (!Number.isFinite(n1) || n1 <= 0) return numErr("fundo 25");
      return { pr: ajustarQuadra(pr, res, quadra, { fundo: n1 }), msg: `Quadra ${quadra.nome}: linha de fundo a ${fmt(n1)} m da rua.` };
    }
    case "prof": case "profundidade": {
      if (!Number.isFinite(n1) || n1 <= 0) return numErr("prof 30");
      return { pr: { ...pr, params: mudarLote(p, { profundidade: n1 }) }, msg: `Profundidade padrão: ${fmt(n1)} m (as faixas automáticas acompanham).` };
    }
    case "largura": {
      if (!Number.isFinite(n1) || n1 <= 0) return numErr("largura 14");
      if (sel?.tipo === "rua") return { pr: editarRua(pr, sel.id, { largura: n1 }), msg: `Rua com ${fmt(n1)} m de largura — quadras e lotes recalculados.` };
      return { pr: { ...pr, params: { ...p, ruaLargura: n1 }, ruas: pr.ruas.map((r) => ({ ...r, largura: n1 })) }, msg: `Todas as ruas com ${fmt(n1)} m.` };
    }
    case "balao": {
      if (sel?.tipo !== "rua") return precisa("a rua");
      const r = Number.isFinite(n1) ? n1 : 0;
      return { pr: editarRua(pr, sel.id, { balao: r > 0 ? r : undefined }), msg: r > 0 ? `Balão de retorno com raio ${fmt(r)} m.` : "Balão removido." };
    }
    case "nome": case "renomear": {
      const nome = bruto.split(/\s+/).slice(1).join(" ").trim();
      if (!nome) return { msg: "Ex.: nome Rua das Flores", erro: true };
      if (sel?.tipo === "rua") return { pr: editarRua(pr, sel.id, { nome }), msg: `Rua renomeada: ${nome}.` };
      if (quadra) return { pr: ajustarQuadra(pr, res, quadra, { nome: nome.toUpperCase() }), sel: { tipo: "quadra", nome: nome.toUpperCase() }, msg: `Quadra renomeada: ${nome.toUpperCase()}.` };
      if (sel?.tipo === "area") return { pr: renomearArea(pr, res, sel.id, nome), msg: `Área renomeada: ${nome}.` };
      return precisa("a rua, a quadra ou a área");
    }
    case "esquina": case "esquinas": {
      const tipo = (a1 === "raio" || a1 === "chanfro" || a1 === "nenhuma") ? a1 as Esquina : null;
      if (!tipo) return { msg: "Use: esquina raio 6 | esquina chanfro 3 | esquina nenhuma", erro: true };
      const v = num(args[1]);
      return { pr: { ...pr, params: { ...p, esquina: tipo, esquinaValor: Number.isFinite(v) ? v : p.esquinaValor } }, msg: tipo === "nenhuma" ? "Esquinas em canto vivo." : `Esquinas em ${tipo} de ${fmt(Number.isFinite(v) ? v : p.esquinaValor)} m.` };
    }
    case "excluir": case "apagar": case "del": {
      if (lotes.length) {
        // quadra por quadra (cada uma com o seu desenho)
        let novo = pr;
        for (const nome of new Set(lotes.map((l) => l.quadra))) {
          const q = quadraDe(res, nome);
          if (q) novo = apagarLotes(novo, res, q, lotes.filter((l) => l.quadra === nome).map((l) => posicaoNoDesenho(pr, res, l))).pr;
        }
        return { pr: novo, sel: null, msg: `${lotes.length === 1 ? "Lote apagado" : `${lotes.length} lotes apagados`} — a área ficou livre. Desenhe um lote nela (L) ou mova as divisas dos vizinhos.` };
      }
      if (sel?.tipo === "rua") return { pr: removerRua(pr, sel.id), sel: null, msg: "Rua apagada — as quadras vizinhas se juntaram." };
      if (sel?.tipo === "area") return { pr: mudarArea(pr, res, sel.id, null), sel: null, msg: "Área apagada." };
      return precisa("a rua ou a área");
    }
    case "preco": case "valor": {
      if (!Number.isFinite(n1) || n1 < 0) return numErr("preco 180");
      return { pr: { ...pr, params: { ...p, precoM2: n1 } }, msg: `Preço de ${fmt(n1)} por m² — o quadro de vendas foi atualizado.` };
    }
    default:
      return { msg: `Não conheço "${cmd0}". Digite "ajuda" para ver os comandos.`, erro: true };
  }
}

/**
 * A mesma operação geométrica em vários lotes. Cada uma lê os contornos já
 * mudados pela anterior (a quadra congelada é achada pela âncora).
 */
function emSequencia(pr: Projeto, res: Resultado, lotes: Lote[], f: (pr: Projeto, q: Quadra, l: Lote, feitos: number[]) => Edicao | null): Edicao | null {
  let atual: Edicao | null = null, falha: Edicao | null = null, falhas = 0;
  let p2 = pr;
  const feitos: number[] = [];
  const sel: { quadra: string; indices: number[] } = { quadra: lotes[0]?.quadra ?? "", indices: [] };
  for (const l of lotes) {
    const q = quadraDe(res, l.quadra);
    if (!q) continue;
    const k = posicaoNoDesenho(pr, res, l);
    const ed = f(p2, q, l, l.quadra === lotes[0].quadra ? feitos : []);
    if (!ed) { falhas++; continue; }
    if (ed.erro) { falha = ed; falhas++; continue; }
    p2 = ed.pr;
    feitos.push(k);
    if (l.quadra === sel.quadra) sel.indices.push(k);
    atual = { ...ed, pr: p2 };
  }
  if (!atual) return falha;
  return { ...atual, sel: lotes.length > 1 ? sel : atual.sel, msg: falhas && lotes.length > 1 ? `${atual.msg} (${falhas} lote(s) não deu para acertar)` : atual.msg };
}

/**
 * O "area" com um alvo para cada lote (na ordem da lista), numa operação só —
 * o lote acertado antes não é mexido pelos seguintes. A divisão em partes usa
 * para igualar as áreas IMPRESSAS, que diferem das do desenho parte a parte.
 */
export function acertarAreas(pr: Projeto, res: Resultado, lotes: Lote[], alvos: number[]): Edicao | null {
  return emSequencia(pr, res, lotes, (p2, q, l, feitos) => acertarMedida(p2, res, q, l, "area", alvos[lotes.indexOf(l)], feitos));
}

/** Seleção depois de uma edição: os lotes que ela indicou (ou os mesmos, na posição do desenho). */
function selDe(ed: Edicao, lotes: Lote[]): Selecao {
  if (ed.sel) return { tipo: "lotes", chaves: ed.sel.indices.map((indice) => ({ quadra: ed.sel!.quadra, fileira: 0, indice })) };
  return { tipo: "lotes", chaves: lotes.map((l) => chaveDoLote(l)) };
}

/** Lotes viram área pública: na quadra desenhada muda o destino do contorno; na automática, um ajuste. */
export function destinoDosLotes(pr: Projeto, res: Resultado, lotes: Lote[], tipo: TipoArea | null): Projeto {
  let novo = pr;
  const porQuadra = new Map<string, Lote[]>();
  for (const l of lotes) porQuadra.set(l.quadra, [...(porQuadra.get(l.quadra) ?? []), l]);
  for (const [nome, ls] of porQuadra) {
    const q = quadraDe(res, nome);
    if (!q) continue;
    if (quadraDesenhada(novo, q, res.plano)) novo = mudarDestino(novo, res, q, ls.map((l) => posicaoNoDesenho(novo, res, l)), tipo).pr;
    else for (const l of ls) novo = ajustarLote(novo, res, l, { destino: tipo ?? undefined });
  }
  return novo;
}

function irPara(alvo: string, res: Resultado): Saida {
  const a = semAcento(alvo).replace(/\s/g, "").toUpperCase();
  const m = a.match(/^([A-Z0-9]{1,3}?)-?(\d{1,3})$/);
  if (m) {
    const l = res.lotes.find((x) => x.quadra.toUpperCase() === m[1] && x.numero === Number(m[2]));
    if (l) return { sel: { tipo: "lotes", chaves: [chaveDoLote(l)] }, focar: centroLote(l), msg: `Lote ${l.id}: ${fmt(l.area)} m², frente ${fmt(l.frente)} m.` };
  }
  const q = res.quadras.find((x) => x.nome.toUpperCase() === a);
  if (q) return { sel: { tipo: "quadra", nome: q.nome }, focar: q.centro, msg: `Quadra ${q.nome}: ${q.lotes.length} lotes.` };
  return { msg: `Não achei "${alvo}".`, erro: true };
}

export const centroLote = (l: Lote): Pt => {
  const e = l.pol.ext;
  return [e.reduce((s, p) => s + p[0], 0) / e.length, e.reduce((s, p) => s + p[1], 0) / e.length];
};
