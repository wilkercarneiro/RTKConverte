// Ações do editor: tudo o que muda o projeto passa por aqui — o arraste no
// desenho, os botões do painel e a linha de comando. Uma ação recebe o projeto
// e o resultado atual e devolve um projeto NOVO (nunca muta), o que dá o
// desfazer/refazer de graça.
import { dot, sub } from "./geom.ts";
import type { Pt } from "./geom.ts";
import { ancoraDaQuadra } from "./auto.ts";
import { fmt } from "./calculo.ts";
import type { Corte, Lote, Quadra, Resultado } from "./calculo.ts";
import { paraUtm } from "./plano.ts";
import { ROTULO_AREA, novoId } from "./modelo.ts";
import type { AjusteLote, AreaDesenhada, Esquina, Projeto, QuadraCfg, Rua, Sobra, TipoArea } from "./modelo.ts";

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

export const quadraDe = (res: Resultado, nome: string): Quadra | undefined => res.quadras.find((q) => q.nome === nome);

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
    return novo;
  });
}

/** Volta a quadra ao padrão do projeto (some a config inteira). */
export function restaurarQuadra(pr: Projeto, q: Quadra): Projeto {
  if (q.cfg < 0) return pr;
  return { ...pr, quadras: pr.quadras.filter((_, i) => i !== q.cfg) };
}

/** Arrastar a divisa entre dois lotes = travar a frente do lote de trás dela. */
export function moverCorte(pr: Projeto, res: Resultado, c: Corte, ponto: Pt): Projeto {
  const s = dot(sub(ponto, c.o), c.dir);
  const frente = Math.max(pr.params.frenteMin * 0.5, s - c.s0);
  const l = res.lotes.find((x) => x.quadra === quadraDoCorte(res, c)?.nome && x.fileira === c.fileira && Math.abs(x.indice - c.indice) < 1e-9);
  if (!l) return pr;
  return ajustarLote(pr, res, l, { frente: Math.round(frente * 100) / 100 });
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

export type Ferramenta = "selecionar" | "rua" | "area" | "medir";

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
  { cmd: "frente", exemplo: "frente 12", desc: "trava a frente do lote (os vizinhos se ajustam) · na quadra, muda a frente padrão · sem seleção, a do projeto", contexto: ["lote", "quadra", "nada"] },
  { cmd: "area", exemplo: "area 300", desc: "trava a área do lote · na quadra, divide em áreas iguais deste tamanho", contexto: ["lote", "quadra"] },
  { cmd: "unir", exemplo: "unir", desc: "une o lote com o seguinte (ou os selecionados)", contexto: ["lote"] },
  { cmd: "dividir", exemplo: "dividir 2", desc: "divide o lote em partes iguais", contexto: ["lote"] },
  { cmd: "verde", exemplo: "verde", desc: "transforma em área verde", contexto: ["lote", "quadra", "area"] },
  { cmd: "institucional", exemplo: "institucional", desc: "transforma em área institucional", contexto: ["lote", "quadra", "area"] },
  { cmd: "lazer", exemplo: "lazer", desc: "transforma em área de lazer", contexto: ["lote", "quadra", "area"] },
  { cmd: "lote", exemplo: "lote", desc: "devolve a área para lotes", contexto: ["area", "lote"] },
  { cmd: "soltar", exemplo: "soltar", desc: "tira as travas do lote / volta a quadra ao padrão", contexto: ["lote", "quadra"] },
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
  const n1 = num(a1);
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
    case "desenhar": case "poligono": return { ferramenta: "area", sel: null, msg: "Clique o contorno da área. Enter fecha, Esc cancela." };
    case "medir": return { ferramenta: "medir", msg: "Clique dois pontos para medir." };
    case "ir": case "zoom": return irPara(args.join(""), res);

    case "frente": case "f": case "testada": {
      if (!Number.isFinite(n1) || n1 <= 0) return numErr("frente 12");
      if (lotes.length) {
        let novo = pr;
        for (const l of lotes) novo = ajustarLote(novo, res, l, { frente: n1 });
        return { pr: novo, msg: `${lotes.length === 1 ? `Lote ${lotes[0].id}` : `${lotes.length} lotes`} com frente travada em ${fmt(n1)} m — os demais da fileira se ajustaram.` };
      }
      if (quadra) return { pr: ajustarQuadra(pr, res, quadra, { modo: "frente", valor: n1 }), msg: `Quadra ${quadra.nome}: frente padrão ${fmt(n1)} m.` };
      return { pr: { ...pr, params: { ...p, frente: n1 } }, msg: `Frente padrão do projeto: ${fmt(n1)} m (todas as quadras sem ajuste próprio).` };
    }
    case "area": case "a": {
      if (!Number.isFinite(n1) || n1 <= 0) return numErr("area 300");
      if (lotes.length) {
        let novo = pr;
        for (const l of lotes) novo = ajustarLote(novo, res, l, { area: n1 });
        return { pr: novo, msg: `Área travada em ${fmt(n1)} m² — a frente é calculada para chegar nela.` };
      }
      if (quadra) return { pr: ajustarQuadra(pr, res, quadra, { modo: "area", valor: n1 }), msg: `Quadra ${quadra.nome}: lotes de áreas iguais, alvo ${fmt(n1)} m².` };
      return precisa("um lote ou uma quadra");
    }
    case "unir": case "juntar": {
      if (!lotes.length) return precisa("o lote");
      const ord = [...lotes].sort((x, y) => x.fileira - y.fileira || x.indice - y.indice);
      let novo = pr;
      const alvo = ord.length === 1 ? ord : ord.slice(0, -1);
      for (const l of alvo) novo = ajustarLote(novo, res, l, { unir: true });
      return { pr: novo, sel: { tipo: "lotes", chaves: [chaveDoLote(ord[0])] }, msg: ord.length === 1 ? `Lote ${ord[0].id} unido ao seguinte.` : `${ord.length} lotes unidos.` };
    }
    case "dividir": case "desmembrar": {
      if (lotes.length !== 1) return precisa("um lote");
      const n = Number.isFinite(n1) ? Math.round(n1) : 2;
      if (n < 2 || n > 20) return { msg: "Divida em 2 a 20 partes.", erro: true };
      return { pr: ajustarLote(pr, res, lotes[0], { dividir: n }), msg: `Lote ${lotes[0].id} dividido em ${n}.` };
    }
    case "verde": case "institucional": case "lazer": case "app": {
      const tipo = TIPOS_AREA[cmd];
      if (lotes.length) {
        let novo = pr;
        for (const l of lotes) novo = ajustarLote(novo, res, l, { destino: tipo });
        return { pr: novo, sel: null, msg: `${lotes.length === 1 ? "Lote" : `${lotes.length} lotes`} → ${ROTULO_AREA[tipo]}.` };
      }
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
      return { pr: ajustarQuadra(pr, res, quadra, { modo: "area", valor: Number.isFinite(n1) ? n1 : p.frente * p.profundidade }), msg: `Quadra ${quadra.nome} em áreas iguais.` };
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
      return { pr: { ...pr, params: { ...p, profundidade: n1 } }, msg: `Profundidade padrão: ${fmt(n1)} m.` };
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
