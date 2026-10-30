// Etapa DIVISÃO EM PARTES IGUAIS (partilha): o motor corta o imóvel em partes de
// mesma área (ou na fração de cada herdeiro) e o operador ajusta na PRANCHETA DO
// LOTEAMENTO — o mesmo editor, as mesmas ferramentas e o mesmo manuseio: clicar
// numa parte mostra os lados e a área, arrastar quina e divisa, cortar, desenhar,
// unir, dividir, "area 33619" na linha de comando, Ctrl+Z, roda do mouse.
//
// Por baixo, a divisão vira um projeto de loteamento sem ruas: o imóvel é uma
// quadra e cada parte é um lote desenhado (ver divisao_prancheta.ts). Aplicar
// grava os pontos novos das divisas como vértices M do perímetro e cada parte
// como uma gleba; a partir daí o serviço segue o caminho das glebas e, com os
// códigos alocados, cada parte vira um GEO individual no nome do herdeiro.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import proj4 from "proj4";
import type { Gleba, ParametrosDivisao, Servico, Vertice } from "../lib/types";
import { dividir, sugerirDivisoes } from "../lib/divisao";
import { ROTULO_DIVISAO, aplicarDivisao, denominacaoDaParte, entradaDoServico, medidasDasPartes, pontosLocacaoDivisao, publicadorUtm, type InfoParte } from "../lib/divisao_servico";
import { ajustarPartes, aneisDasGlebas, aneisDosLotes, anelBruto, comRegrasDaDivisao, limparAvisos, perimetroDaDivisao, projetoDaDivisao, projetoServe, resultadoDosLotes } from "../lib/divisao_prancheta";
import { FORMATOS, arquivoLocacao, type FormatoLocacao } from "../lib/loteamento/saidas";
import { calcular } from "../lib/loteamento/calculo";
import type { Lote, Resultado } from "../lib/loteamento/calculo";
import type { Projeto } from "../lib/loteamento/modelo";
import { COMANDOS, chaveDoLote, contextoDe, executar, lotesDaSelecao, type Ferramenta, type Selecao } from "../lib/loteamento/acoes";
import type { Pt } from "../lib/loteamento/geom";
import { Editor, type OpcoesVista } from "./loteamento/Editor";
import { Avisos } from "./loteamento/Avisos";
import { Dica, GiroMapa } from "./ui";
import { ContornoEditor } from "./ContornoEditor";
import { areasFechadas, ligacoesIniciais, type Ligacao } from "../lib/contorno";
import { areaHaDoAnel, ordensDasGlebas } from "../lib/glebas";

// as mesmas cores do editor de pontos, para a tabela casar com o desenho
const CORES_GLEBA = ["#2E86AB", "#E07A1F", "#3BA55C", "#A23B72", "#C9A227", "#5B5FC7", "#D1495B", "#1B998B"];
import "./loteamento/loteamento.css";

const CORES_PARTE = ["#2E86AB", "#E07A1F", "#3BA55C", "#A23B72", "#C9A227", "#5B5FC7", "#D1495B", "#1B998B", "#8D6A9F", "#6C8EAD"];
const fmt = (v: number, c = 4) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const fmtM = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const fmtM2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// a divisão só tem pontos: o DXF de linhas do loteamento não se aplica
const FORMATOS_LOCACAO = FORMATOS.filter((f) => f.id !== "dxf");
// da linha de comando do loteamento, o que serve para partes (sem rua, quadra, área pública)
const CMDS_DIVISAO = new Set(["area", "unir", "dividir", "apagar", "desenhar lote", "cortar", "preencher", "medir", "ir", "desfazer", "refazer"]);
const COMANDOS_DIVISAO = COMANDOS.filter((c) => CMDS_DIVISAO.has(c.cmd));
/** As mensagens do loteamento falam de lote; aqui é parte. */
const paraPartes = (t: string) => t.replace(/\b([Ll])otes?\b/g, (m, l: string) => (l === "L" ? "Parte" : "parte") + (m.endsWith("s") ? "s" : ""));

interface Props {
  /** "divisao" = partilha (herdeiro, GEO por parte); "glebas" = só divide o imóvel em glebas */
  modo?: "divisao" | "glebas";
  servico: Servico;
  vertices: Vertice[];
  glebas: Gleba[];
  /** grava vértices, glebas e os parâmetros da divisão no serviço */
  onAplicar: (r: { vertices: Vertice[]; glebas: Gleba[]; divisao: ParametrosDivisao }) => void;
  /** herdeiro/nome/denominação editados depois de aplicada */
  onGlebas: (g: Gleba[]) => void;
  /** guarda o rascunho da prancheta no serviço (só no serviço de divisão) */
  onRascunho?: (d: ParametrosDivisao) => void;
  /** ações do serviço de glebas que moram na barra de baixo (ex.: separar em serviços) */
  extrasGlebas?: ReactNode;
}

function infoDe(g: Gleba | undefined, k: number): InfoParte {
  return {
    nome: g?.nome ?? `PARTE ${k + 1}`,
    herdeiro: g?.detentor_nome ?? "",
    cpf: g?.detentor_cpf ?? "",
    denominacao: g?.denominacao ?? "",
  };
}

interface Historico { passado: Projeto[]; atual: Projeto | null; futuro: Projeto[]; base: Projeto | null }

/** Desfazer/refazer como no loteamento: o arraste empilha só o resultado, ao soltar. */
function useHistorico(inicial: () => Projeto | null) {
  const [h, setH] = useState<Historico>(() => ({ passado: [], atual: inicial(), futuro: [], base: null }));
  const mudar = useCallback((p: Projeto, transiente = false) => setH((e) => {
    if (transiente) return { ...e, atual: p, base: e.base ?? e.atual };
    const antes = e.base ?? e.atual;
    return { passado: antes ? [...e.passado.slice(-100), antes] : e.passado, atual: p, futuro: [], base: null };
  }), []);
  const fimArraste = useCallback(() => setH((e) => (e.base ? { passado: [...e.passado.slice(-100), e.base], atual: e.atual, futuro: [], base: null } : e)), []);
  const desfazer = useCallback(() => setH((e) => (e.passado.length ? { passado: e.passado.slice(0, -1), atual: e.passado[e.passado.length - 1], futuro: e.atual ? [e.atual, ...e.futuro] : e.futuro, base: null } : e)), []);
  const refazer = useCallback(() => setH((e) => (e.futuro.length ? { passado: e.atual ? [...e.passado, e.atual] : e.passado, atual: e.futuro[0], futuro: e.futuro.slice(1), base: null } : e)), []);
  return { h, mudar, fimArraste, desfazer, refazer };
}

export function DivisaoEditor({ modo = "divisao", servico, vertices: todos, glebas, onAplicar, onGlebas, onRascunho, extrasGlebas }: Props) {
  const ehGleba = modo === "glebas";

  // ---------------- glebas: o contorno como ligações entre pontos ----------------
  // Começa pelos contornos das glebas que o serviço já tem (não pela sequência
  // do TXT, que cruza o mapa quando há mais de uma área). Uma área fechada =
  // o imóvel, que a prancheta divide; duas ou mais = as glebas prontas.
  const [lig, setLig] = useState<{ atual: Ligacao[]; passado: Ligacao[][] }>(() => ({ atual: ehGleba ? ligacoesIniciais(todos, glebas) : [], passado: [] }));
  const mudarLig = (ls: Ligacao[]) => setLig((h) => ({ atual: ls, passado: [...h.passado.slice(-60), h.atual] }));
  const desfazerLig = () => setLig((h) => (h.passado.length ? { atual: h.passado[h.passado.length - 1], passado: h.passado.slice(0, -1) } : h));
  const areas = useMemo(() => (ehGleba ? areasFechadas(todos, lig.atual) : null), [ehGleba, todos, lig.atual]);
  const porOrdem = useMemo(() => new Map(todos.map((v) => [v.ordem, v])), [todos]);
  const anelUnico = ehGleba && areas?.aneis.length === 1 ? areas.aneis[0] : null;
  const chaveAnel = anelUnico?.join(",") ?? "";
  // a prancheta trabalha só com os pontos do contorno, na volta dele
  const vertices = useMemo(() => (anelUnico ? anelUnico.map((o) => porOrdem.get(o)!) : todos), [chaveAnel, todos]); // eslint-disable-line react-hooks/exhaustive-deps
  const glebasProntas = ehGleba && (areas?.aneis.length ?? 0) >= 2;
  const [vistaGleba, setVistaGleba] = useState<"pontos" | "prancheta">(() => (ehGleba && (areas?.aneis.length !== 1 || areas.pontas.length || areas.cruzadas.length) ? "pontos" : "prancheta"));

  const aplicadaAntes = vertices.some((v) => v.rotulo_txt === ROTULO_DIVISAO) && glebas.length >= 2;
  const fuso = servico.fuso_utm ?? 24;
  const rascunho = (servico.divisao as (ParametrosDivisao & { projeto?: Projeto }) | null | undefined)?.projeto;
  // o contador começa nas partes que a prancheta vai abrir: as do rascunho
  // guardado (era sempre 2 — com 3 partes na tela, o "+" pulava para 4)
  const [n, setN] = useState(() => {
    const doRascunho = rascunho?.quadras?.[0]?.lotes?.length ?? 0;
    return doRascunho >= 2 ? Math.min(30, doRascunho) : aplicadaAntes ? glebas.length : 2;
  });
  const [iguais, setIguais] = useState(servico.divisao?.iguais ?? !glebas.some((g) => g.fracao && Math.abs(g.fracao - 1 / glebas.length) > 1e-6));
  const [pct, setPct] = useState<number[]>(() => glebas.length >= 2 && glebas.every((g) => g.fracao) ? glebas.map((g) => Math.round(g.fracao! * 10000) / 100) : []);
  const [azManual, setAzManual] = useState<number | null>(servico.divisao?.azimute ?? null);
  const [inverter, setInverter] = useState(!!servico.divisao?.inverter);
  const [linhas, setLinhas] = useState<InfoParte[]>(() => Array.from({ length: Math.max(n, glebas.length) }, (_, k) => infoDe(glebas[k], k)));

  const publicar = useMemo(() => publicadorUtm(fuso, (f, t, c) => proj4(f, t, c)), [fuso]);
  const fracoesDe = (nn: number, ig: boolean, pc: number[]) => (ig ? Array(nn).fill(1) : Array.from({ length: nn }, (_, k) => Math.max(0.01, pc[k] ?? 100 / nn)));
  const fracoes = useMemo(() => fracoesDe(n, iguais, pct), [n, iguais, pct]);
  const ent = useMemo(() => entradaDoServico(vertices, fracoes, inverter, publicar), [vertices, fracoes, inverter, publicar]);
  const perimetro = useMemo(() => perimetroDaDivisao(ent), [ent]);
  const sugestoes = useMemo(() => (ent.anel.length >= 3 ? sugerirDivisoes(ent) : []), [ent]);
  const temEstrada = !!ent.estrada?.some(Boolean);
  const comCodigo = vertices.some((v) => v.codigo && !v.codigo_provisorio);
  const nomeProjeto = servico.denominacao || "Divisão";

  // ---------------- o motor gera; a prancheta guarda o que o operador fez ----------------
  /** Partes do motor para estes parâmetros, como projeto da prancheta (null = não dá nesta direção). */
  const gerarProjeto = (nn: number, ig: boolean, pc: number[], az: number | null, inv: boolean): { pr: Projeto | null; motivo?: string } => {
    const e = entradaDoServico(vertices, fracoesDe(nn, ig, pc), inv, publicar);
    if (e.anel.length < 3) return { pr: null, motivo: "o perímetro tem menos de 3 vértices" };
    const azUsar = az ?? sugerirDivisoes(e)[0]?.azimute;
    if (azUsar === undefined) return { pr: null, motivo: "nenhuma direção de divisas reta divide este imóvel" };
    const r = dividir(e, azUsar);
    if (!r.ok) return { pr: null, motivo: r.motivo };
    return { pr: projetoDaDivisao(e, r.partes.map((p) => anelBruto(e, p)), nomeProjeto) };
  };
  const hist = useHistorico(() => {
    const salvo = rascunho;
    if (projetoServe(salvo, ent)) return comRegrasDaDivisao(salvo);
    if (aplicadaAntes) return projetoDaDivisao(ent, aneisDasGlebas(glebas), nomeProjeto);
    return gerarProjeto(n, iguais, pct, azManual, inverter).pr;
  });
  const projeto = hist.h.atual;

  const cache = useRef(new WeakMap<Projeto, Resultado | null>());
  const calc = useCallback((p: Projeto): Resultado | null => {
    if (cache.current.has(p)) return cache.current.get(p)!;
    let r: Resultado | null = null;
    try { r = limparAvisos(calcular(p, perimetro), temEstrada); } catch (e) { console.error(e); }
    cache.current.set(p, r);
    return r;
  }, [perimetro, temEstrada]);
  const res = useMemo(() => (projeto ? calc(projeto) : null), [projeto, calc]);
  const nPartes = res?.lotes.length ?? n;
  // parte dividida ou unida na prancheta (comando, Ctrl+Z): o contador acompanha
  useEffect(() => { if (res) setN(res.lotes.length); }, [res?.lotes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const fracoesRd = nPartes === fracoes.length ? fracoes : undefined;
  // as partes como o operador deixou, de volta ao formato da divisão (marcos, glebas, locação)
  const rd = useMemo(() => (res ? resultadoDosLotes(ent, aneisDosLotes(res), fracoesRd, azManual ?? sugestoes[0]?.azimute ?? 0) : null), [res, ent, fracoesRd, azManual, sugestoes]);
  const lotesOrdem: Lote[] = useMemo(() => (res ? [...res.lotes].sort((a, b) => a.numero - b.numero) : []), [res]);
  // o desenho mostra a área como os documentos vão imprimir (pontos arredondados
  // a 0,001"), a mesma da tabela — os comandos seguem medindo no desenho
  const resVista = useMemo(() => {
    if (!res || !rd?.ok) return res;
    const area = new Map(lotesOrdem.map((l, k) => [l.id, rd.partes[k]?.areaM2 ?? l.area]));
    const troca = (l: Lote) => ({ ...l, area: area.get(l.id) ?? l.area });
    return { ...res, lotes: res.lotes.map(troca), quadras: res.quadras.map((q) => ({ ...q, lotes: q.lotes.map(troca) })) };
  }, [res, rd, lotesOrdem]);

  // rascunho no serviço: a prancheta volta como estava ao reabrir
  useEffect(() => {
    if (!onRascunho || !projeto) return;
    const t = setTimeout(() => onRascunho({ ...(servico.divisao ?? {}), azimute: azManual, inverter, iguais, projeto } as ParametrosDivisao), 1200);
    return () => clearTimeout(t);
  }, [projeto]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- prancheta (cópia do fluxo do loteamento) ----------------
  const [sel, setSel] = useState<Selecao>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("selecionar");
  const [vista, setVista] = useState<OpcoesVista>({ satelite: true, medidas: true, cores: "situacao" });
  const [focar, setFocar] = useState<{ pt: Pt; n: number } | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [cmd, setCmd] = useState("");
  const [verAvisos, setVerAvisos] = useState(false);
  const [areaAlvo, setAreaAlvo] = useState("");
  const cmdRef = useRef<HTMLInputElement>(null);
  const dentro = useRef(false);
  const mostrar = useCallback((t: string, erro = false) => setMsg({ t, erro }), []);

  const mudar = useCallback((p: Projeto, transiente = false): boolean => {
    if (!calc(p)) { if (!transiente) mostrar("Essa mudança não fecha o cálculo (geometria impossível) — não aplicada.", true); return false; }
    hist.mudar(p, transiente);
    return true;
  }, [calc, hist, mostrar]);
  const fimArraste = useCallback(() => { hist.fimArraste(); mostrar("Pronto — as partes vizinhas se ajustaram (Ctrl+Z desfaz)."); }, [hist, mostrar]);

  const regerar = (nn: number, ig: boolean, pc: number[], az: number | null, inv: boolean) => {
    const { pr, motivo } = gerarProjeto(nn, ig, pc, az, inv);
    if (!pr) { mostrar(`Não dá para dividir assim: ${motivo}. Escolha outra direção.`, true); return false; }
    hist.mudar(pr);
    setSel(null);
    mostrar(`Divisão gerada em ${nn} partes. Clique numa parte para ver os lados; arraste quinas e divisas para ajustar (Ctrl+Z volta).`);
    return true;
  };

  // giro à mão: o controle deslizante redivide enquanto arrasta (com folga para o motor)
  const giroT = useRef<ReturnType<typeof setTimeout>>();
  const girar = (az: number) => {
    setAzManual(az);
    clearTimeout(giroT.current);
    giroT.current = setTimeout(() => regerar(n, iguais, pct, az, inverter), 160);
  };

  /** "Ajustar lotes": deixa todas as partes com a mesma área IMPRESSA (ou na
   *  fração de cada uma) — a do painel e dos documentos, medida nos pontos
   *  arredondados a 0,001", não a do desenho (igualar a do desenho deixava até
   *  7 m² de diferença no painel). Primeiro sem desmanchar o desenho: as divisas
   *  deslizam e as pontas acertam o arredondamento; se a forma não deixar,
   *  divide de novo pelo motor na direção atual (ver ajustarPartes). A mensagem
   *  diz as áreas que ficaram, não o alvo. */
  const ajustarLotes = () => {
    if (!projeto || !res) return;
    const nn = res.lotes.length;
    let motivo = "";
    const aj = ajustarPartes(projeto, ent, calc, fracoes.length === nn ? fracoes : undefined, () => {
      const g = gerarProjeto(nn, iguais, pct, azManual, inverter);
      motivo = g.motivo ?? "";
      return g.pr;
    });
    if (!aj) { mostrar(`Não deu para ajustar as partes${motivo ? `: ${motivo}` : ""}. Arraste as divisas ou gire a direção.`, true); return; }
    if (!mudar(aj.pr)) return;
    setSel(null);
    const as = aj.rd.partes.map((p) => p.areaM2);
    const noPainel = [...new Set(as.map(fmtM2))];
    const noDoc = [...new Set(as.map((a) => fmt(a / 10000)))];
    const faixa = `de ${fmtM2(Math.min(...as))} a ${fmtM2(Math.max(...as))} m²`;
    const como = aj.manteve ? "o desenho foi mantido" : "divididas de novo pelo motor na direção atual";
    if (!iguais) mostrar(`Partes ajustadas na fração de cada uma (maior diferença p/ a cota: ${fmtM2(aj.rd.erroAreaM2)} m², como os documentos imprimem) — ${como} (Ctrl+Z volta).`);
    else if (noPainel.length === 1) mostrar(`Partes ajustadas: todas com ${noPainel[0]} m² (${noDoc[0]} ha), como os documentos imprimem — ${como} (Ctrl+Z volta).`);
    else if (noDoc.length === 1) mostrar(`Partes ajustadas: todas com ${noDoc[0]} ha nos documentos (${faixa}: o arredondamento dos pontos a 0,001" não deixa igualar o centésimo) — ${como} (Ctrl+Z volta).`);
    else mostrar(`Partes ajustadas ${faixa}, como os documentos imprimem (maior diferença p/ a cota: ${fmtM2(aj.rd.erroAreaM2)} m²) — ${como} (Ctrl+Z volta).`, aj.rd.erroAreaM2 >= 1);
  };

  // o contorno mudou em "Ajustar pontos" e continua uma área só: a prancheta divide de novo
  const contornoAntes = useRef(chaveAnel);
  useEffect(() => {
    if (contornoAntes.current === chaveAnel) return;
    contornoAntes.current = chaveAnel;
    if (anelUnico) regerar(n, iguais, pct, azManual, inverter);
  }, [chaveAnel]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- glebas prontas pelas ligações (duas ou mais áreas fechadas) ----------------
  /** A gleba do serviço que mais divide pontos com a área k (para manter id, nome e confrontante). */
  const glebaDaArea = useMemo(() => {
    if (!areas) return [] as (Gleba | undefined)[];
    const conjuntos = glebas.map((g) => new Set(ordensDasGlebas([g], todos)[0] ?? []));
    const usadas = new Set<number>();
    return areas.aneis.map((a) => {
      let melhor = -1, comum = 0;
      conjuntos.forEach((c, i) => {
        if (usadas.has(i)) return;
        const n = a.filter((o) => c.has(o)).length;
        if (n > comum) { comum = n; melhor = i; }
      });
      if (melhor >= 0) usadas.add(melhor);
      return melhor >= 0 ? glebas[melhor] : undefined;
    });
  }, [areas, glebas, todos]);
  // nome e confrontante da divisa interna digitados aqui (antes de salvar); salvas, vão direto para a gleba
  const [edicaoArea, setEdicaoArea] = useState<Record<number, { nome?: string; conf?: string }>>({});
  const nomesAreas = (areas?.aneis ?? []).map((_, k) => edicaoArea[k]?.nome ?? (glebaDaArea[k]?.nome || `PARTE ${k + 1}`));
  const confAreas = (areas?.aneis ?? []).map((_, k) => edicaoArea[k]?.conf ?? (glebaDaArea[k]?.confrontante_interno ?? ""));
  const editarArea = (k: number, patch: { nome?: string; conf?: string }) => {
    setEdicaoArea((e) => ({ ...e, [k]: { ...e[k], ...patch } }));
    const g = glebaDaArea[k];
    if (areasSalvas && g) onGlebas(glebas.map((x) => (x !== g ? x : {
      ...x,
      ...(patch.nome !== undefined ? { nome: patch.nome.trim() || `PARTE ${k + 1}` } : {}),
      ...(patch.conf !== undefined ? { confrontante_interno: patch.conf.trim() || null } : {}),
    })));
  };
  // já é o que está salvo? (mesmos pontos em cada gleba e nenhum ponto a apagar)
  const areasSalvas = glebasProntas && !areas!.soltos.length && !areas!.pontas.length
    && glebas.filter((g) => g.anel.length >= 3).length === areas!.aneis.length
    && areas!.aneis.every((a, k) => {
      const g = glebaDaArea[k];
      const c = g ? new Set(ordensDasGlebas([g], todos)[0] ?? []) : null;
      return !!c && c.size === a.length && a.every((o) => c.has(o));
    });
  const salvarAreas = () => {
    if (!areas || !glebasProntas || areas.cruzadas.length) return;
    const usados = new Set(areas.aneis.flat());
    const gs: Gleba[] = areas.aneis.map((a, k) => {
      const g = glebaDaArea[k];
      return {
        id: g?.id ?? crypto.randomUUID(), servico_id: servico.id, ordem: k, nome: nomesAreas[k],
        anel: a.map((o) => [Number(porOrdem.get(o)!.e), Number(porOrdem.get(o)!.n)] as [number, number]),
        confrontante_interno: confAreas[k].trim() || null,
      };
    });
    // ponto fora de toda área sai do serviço (o salvar da Conferência apaga o que não veio)
    onAplicar({ vertices: todos.filter((v) => usados.has(v.ordem) || v.e === null || v.n === null), glebas: gs, divisao: {} as ParametrosDivisao });
  };

  function rodarComando(texto: string) {
    if (!projeto || !res) return;
    const s = executar(texto, projeto, res, sel);
    if (s.desfazer) hist.desfazer();
    if (s.refazer) hist.refazer();
    const aceito = s.pr ? mudar(s.pr) : true;
    if (aceito && s.sel !== undefined) setSel(s.sel);
    if (s.ferramenta) setFerramenta(s.ferramenta);
    if (s.focar) setFocar({ pt: s.focar, n: Date.now() });
    if (aceito && s.msg) mostrar(paraPartes(s.msg), s.erro);
  }

  // atalhos do loteamento, só com o mouse na prancheta (a página tem outros campos)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!dentro.current) return;
      const alvo = e.target as HTMLElement;
      const digitando = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !digitando) { e.preventDefault(); if (e.shiftKey) hist.refazer(); else hist.desfazer(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !digitando) { e.preventDefault(); hist.refazer(); }
      else if (!digitando && (e.key === "/" || e.key === ":")) { e.preventDefault(); cmdRef.current?.focus(); }
      else if (!digitando && e.key === "Delete" && res && projeto) {
        const s = executar("excluir", projeto, res, sel);
        if (s.pr) { mudar(s.pr); setSel(null); mostrar(s.msg); } else if (s.msg) mostrar(s.msg, s.erro);
      }
    };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [hist, res, projeto, sel, mudar, mostrar]);

  // ---------------- herdeiros, locação, aplicar ----------------
  const nomesPartes = Array.from({ length: nPartes }, (_, i) => (linhas[i]?.nome ?? "").trim() || `PARTE ${i + 1}`);
  const medidas = useMemo(() => (rd?.ok ? medidasDasPartes(ent, rd, nomesPartes) : []), [ent, rd, nomesPartes.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [formato, setFormato] = useState<Exclude<FormatoLocacao, "dxf">>("penzd");
  const baixarLocacao = () => {
    if (!rd?.ok) return;
    const pontos = pontosLocacaoDivisao(ent, rd, vertices);
    if (!pontos.length) return;
    const f = FORMATOS.find((x) => x.id === formato)!;
    const nome = (servico.denominacao ?? "IMOVEL").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase();
    const blob = new Blob([arquivoLocacao(pontos, formato)], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `LOCACAO_DIVISAO_${nome || "IMOVEL"}_SIRGAS2000_UTM${fuso}S.${f.ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // a divisão aplicada ainda é a da prancheta?
  const igualAplicada = aplicadaAntes && !!rd?.ok && glebas.length === rd.partes.length && rd.partes.every((p, k) =>
    p.anel.length === glebas[k].anel.length && p.anel.every((q, j) => Math.hypot(q.e - glebas[k].anel[j][0], q.n - glebas[k].anel[j][1]) < 0.002));

  const editarLinha = (k: number, patch: Partial<InfoParte>) => {
    const ls = Array.from({ length: Math.max(linhas.length, k + 1) }, (_, i) => linhas[i] ?? infoDe(undefined, i)).map((l, i) => (i === k ? { ...l, ...patch } : l));
    setLinhas(ls);
    // aplicada: herdeiro, nome e denominação vão direto para a gleba (a geometria não muda)
    if (aplicadaAntes && glebas[k]) {
      onGlebas(glebas.map((g, i) => (i !== k ? g : {
        ...g,
        nome: ls[k].nome.trim() || `PARTE ${k + 1}`,
        detentor_nome: ls[k].herdeiro.trim() || null,
        detentor_cpf: ls[k].cpf.trim() || null,
        denominacao: ls[k].denominacao.trim() || null,
      })));
    }
  };
  const aplicar = () => {
    if (!rd?.ok || !projeto) return;
    const infos = Array.from({ length: nPartes }, (_, i) => linhas[i] ?? infoDe(undefined, i));
    const fr = fracoesRd ?? Array(nPartes).fill(1);
    const r = aplicarDivisao(vertices, rd, infos, fr, servico.id, glebas);
    onAplicar({ ...r, divisao: { azimute: azManual, inverter, iguais, projeto } as ParametrosDivisao });
  };

  // ---------------- tela ----------------
  const selLotes = res ? lotesDaSelecao(res, sel) : [];
  const parteSel = selLotes.length === 1 ? lotesOrdem.indexOf(selLotes[0]) : -1;
  const lsel = parteSel >= 0 ? lotesOrdem[parteSel] : null;
  // a área digitada é de uma parte: trocou de parte, o campo volta vazio
  useEffect(() => setAreaAlvo(""), [parteSel]);
  const alvoArea = (k: number) => (rd?.ok ? (fracoes.length === nPartes ? fracoes[k] / fracoes.reduce((s, f) => s + f, 0) : 1 / nPartes) * rd.partes.reduce((s, p) => s + p.areaM2, 0) : 0);
  const nomeLado = (l: Lote["lados"][number]) => {
    if (l.tipo === "lote") {
      const k = lotesOrdem.findIndex((x) => x.id === l.ref);
      return `divisa com ${k >= 0 ? nomesPartes[k] : l.nome}`;
    }
    return l.nome || (l.tipo === "via" ? "estrada" : "divisa");
  };
  const contexto = contextoDe(sel);
  const sugestoesCmd = COMANDOS_DIVISAO.filter((c) => c.contexto.includes(contexto)).slice(0, 7);
  const selecionarParte = (k: number) => {
    const l = lotesOrdem[k];
    if (!l) return;
    // só seleciona: o "ir" do loteamento aproxima no tamanho de lote urbano, perto demais para uma parte rural
    setSel({ tipo: "lotes", chaves: [chaveDoLote(l)] });
  };

  return (
    <section className="bloco" id={ehGleba ? "bloco-glebas-prancheta" : "bloco-divisao"}>
      <header>
        {ehGleba ? (
          <h3>Dividir em glebas<Dica>Escolha em quantas glebas, a direção das divisas e ajuste na prancheta (arrastar quinas e divisas, cortar, unir, dividir). "Dividir em glebas" grava cada parte como uma gleba — PARTE 1, PARTE 2… — e os pontos novos das divisas como marcos M do perímetro.</Dica></h3>
        ) : (
          <h3>Divisão em partes iguais<Dica>Partilha ou herança: o motor corta o imóvel em partes de mesma área (ou na fração de cada um) e você ajusta na prancheta, com o mesmo manuseio do loteamento. Sai o GEO do imóvel inteiro e, depois, um GEO para cada parte.</Dica></h3>
        )}
      </header>

      {ehGleba && areas && (
        <div className="ct-abas" role="tablist">
          <button type="button" role="tab" aria-selected={vistaGleba === "pontos"} className={vistaGleba === "pontos" ? "ativa" : ""} onClick={() => setVistaGleba("pontos")}>
            Pontos e ligações
          </button>
          <button type="button" role="tab" aria-selected={vistaGleba === "prancheta"} className={vistaGleba === "prancheta" ? "ativa" : ""}
            disabled={!anelUnico} onClick={() => setVistaGleba("prancheta")}
            title={anelUnico ? "Dividir o contorno em glebas com o motor e ajustar na prancheta" : "A prancheta divide um contorno só: hoje há " + areas.aneis.length + " áreas fechadas"}>
            Dividir na prancheta
          </button>
        </div>
      )}

      {ehGleba && areas && vistaGleba === "pontos" && (
        <>
          <ContornoEditor vertices={todos} ligacoes={lig.atual} areas={areas} nomes={nomesAreas}
            onLigacoes={mudarLig} onDesfazer={desfazerLig} podeDesfazer={lig.passado.length > 0}
            onRecomecar={() => mudarLig(ligacoesIniciais(todos, glebas))} />
          {areas.aneis.length > 0 && (
            <div className="tabela-scroll">
              <table className="dv-tabela ct-tabela">
                <thead>
                  <tr>
                    <th></th><th>Gleba</th><th>Área (ha)</th><th>Pontos</th>
                    <th><span className="rotulo-campo">Confrontante da divisa interna<Dica>Descritivo do lado que fecha a gleba por dentro. Em branco sai o automático: "(MATR./CNS.) IMÓVEL - GLEBA VIZINHA\ PROPRIETÁRIO\ CPF".</Dica></span></th>
                  </tr>
                </thead>
                <tbody>
                  {areas.aneis.map((a, k) => (
                    <tr key={k}>
                      <td><span className="dv-cor" style={{ background: CORES_GLEBA[k % CORES_GLEBA.length] }} /></td>
                      <td><input value={nomesAreas[k]} onChange={(e) => editarArea(k, { nome: e.target.value.toUpperCase() })} placeholder={`PARTE ${k + 1}`} aria-label={`Nome da gleba ${k + 1}`} /></td>
                      <td className="mono">{fmt(areaHaDoAnel(a.map((o) => [Number(porOrdem.get(o)!.e), Number(porOrdem.get(o)!.n)])))}</td>
                      <td className="mono">{a.length}</td>
                      <td><input value={confAreas[k]} onChange={(e) => editarArea(k, { conf: e.target.value })} placeholder="automático: a gleba vizinha" aria-label={`Confrontante da divisa interna da gleba ${k + 1}`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="dv-barra">
            {glebasProntas && areasSalvas && extrasGlebas}
            <span className="esticar" />
            {areas.cruzadas.length > 0 && <b className="dv-sem">Ainda não dá para salvar: há ligações que se cruzam.</b>}
            {glebasProntas ? (
              <div className="dv-barra-grupo">
                <button type="button" className="principal" disabled={areasSalvas || areas.cruzadas.length > 0} onClick={salvarAreas}>
                  {areasSalvas ? "Glebas salvas ✓" : `Salvar ${areas.aneis.length} glebas`}
                </button>
                <Dica>Grava cada área fechada como uma gleba, com os pontos que já existem (nenhum marco novo).{areas.soltos.length > 0 ? ` Os ${areas.soltos.length} pontos sem ligação saem do serviço.` : ""} Em Documentos sai a planta A1 com todas as glebas e a A3 de cada uma; o memorial de cada gleba sai nas peças técnicas, depois do SIGEF.</Dica>
              </div>
            ) : (
              <div className="dv-barra-grupo">
                <button type="button" className="principal" disabled={!anelUnico} onClick={() => setVistaGleba("prancheta")}>Dividir na prancheta →</button>
                <Dica>Com uma área só, a prancheta corta o contorno em glebas (iguais ou em frações) e cria os marcos das divisas. Se a divisa já existe no levantamento, ligue os pontos dela aqui — de um lado ao outro do imóvel — e salve as glebas.</Dica>
              </div>
            )}
          </div>
        </>
      )}

      {!(ehGleba && vistaGleba === "pontos") && (<>
      {!projeto || !res ? (
        <div className="dv-alerta">{msg?.t ?? "Não foi possível dividir este imóvel com divisas retas. Confira o perímetro ou gire as divisas."}</div>
      ) : (
        <div className={`lot-area-trabalho dv-prancheta${verAvisos ? " com-avisos" : ""}`}
          onPointerEnter={() => { dentro.current = true; }} onPointerLeave={() => { dentro.current = false; }}>
          <nav className="lot-ferramentas" aria-label="Ferramentas">
            {([
              ["selecionar", "Selecionar e arrastar (S) — clique numa parte; arraste as quinas e as divisas dela", "M5 3l14 9-6 1.5L10 20z"],
              ["lote", "Desenhar parte (L) — clique as quinas, Enter fecha; duplo clique na área livre rosa vira parte", "M4 4h16v16H4zM4 12h16M12 4v16"],
              ["cortar", "Cortar partes com uma linha (C)", "M6 6a2 2 0 1 0 0 .01M6 18a2 2 0 1 0 0 .01M8 7l12 10M8 17l12-10"],
              ["medir", "Medir (M)", "M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"],
            ] as [Ferramenta, string, string][]).map(([f, t, d]) => (
              <button type="button" key={f} title={t} className={ferramenta === f ? "ativo" : ""} onClick={() => setFerramenta(f)}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d={d} /></svg>
              </button>
            ))}
            <span className="sep" />
            <button type="button" title="Desfazer (Ctrl+Z)" disabled={!hist.h.passado.length} onClick={hist.desfazer}>↶</button>
            <button type="button" title="Refazer (Ctrl+Y)" disabled={!hist.h.futuro.length} onClick={hist.refazer}>↷</button>
            <span className="sep" />
            <button type="button" title="Imagem de satélite" className={vista.satelite ? "ativo" : ""} onClick={() => setVista({ ...vista, satelite: !vista.satelite })}>🛰</button>
            <button type="button" title="Medidas dos lados" className={vista.medidas ? "ativo" : ""} onClick={() => setVista({ ...vista, medidas: !vista.medidas })}>↔</button>
            <button type="button" title="Colorir pelo tamanho da parte" className={vista.cores === "area" ? "ativo" : ""} onClick={() => setVista({ ...vista, cores: vista.cores === "area" ? "situacao" : "area" })}>▦</button>
            <span className="sep" />
            <button type="button" title={verAvisos ? "Esconder os avisos" : "Mostrar os avisos das partes"} className={`lot-btn-avisos${verAvisos ? " ativo" : ""}`} onClick={() => setVerAvisos(!verAvisos)}>
              ⚠{res.lotes.some((l) => l.problemas.length) && <i>{res.lotes.filter((l) => l.problemas.length).length}</i>}
            </button>
          </nav>

          {verAvisos && <Avisos res={res} params={projeto.params} sel={sel} onSel={setSel} onFocar={(p) => setFocar({ pt: p, n: Date.now() })} onFechar={() => setVerAvisos(false)} />}

          <div className="lot-centro">
            <Editor projeto={projeto} res={resVista ?? res} fuso={fuso} sel={sel} onSel={setSel} ferramenta={ferramenta} onFerramenta={setFerramenta}
              onMudar={mudar} onFimArraste={fimArraste} vista={vista} focar={focar} onMsg={(m) => mostrar(paraPartes(m))}
              sobreposto={
                <GiroMapa rotulo="Giro das divisas" valor={azManual ?? sugestoes[0]?.azimute ?? 0} min={0} max={179.5} onGiro={girar}>
                  <button type="button" className={`dv-inverter${inverter ? " ativa" : ""}`} aria-pressed={inverter}
                    onClick={() => { setInverter(!inverter); regerar(n, iguais, pct, azManual, !inverter); }}>
                    ⇄ Outro lado
                  </button>
                </GiroMapa>
              } />
            <form className="lot-comando" onSubmit={(e) => { e.preventDefault(); rodarComando(cmd); setCmd(""); }}>
              <div className="lot-cmd-linha">
                <span className="lot-cmd-prompt">Comando{lsel ? ` · ${nomesPartes[parteSel]}` : selLotes.length > 1 ? ` · ${selLotes.length} partes` : ""}:</span>
                <input ref={cmdRef} value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="ex.: area 33619 · unir · dividir 2 · cortar"
                  onKeyDown={(e) => { if (e.key === "Escape") { setCmd(""); (e.target as HTMLInputElement).blur(); } }} />
                <button type="submit" className="principal">Executar</button>
              </div>
              <div className="lot-cmd-sugestoes">
                {msg && <span className={`lot-cmd-msg${msg.erro ? " erro" : ""}`}>{msg.t}</span>}
                {!msg && sugestoesCmd.map((c) => (
                  <button type="button" key={c.cmd} title={paraPartes(c.desc)}
                    onClick={() => { if (/\d/.test(c.exemplo)) { setCmd(c.exemplo.replace(/\d+.*$/, "")); cmdRef.current?.focus(); } else rodarComando(c.exemplo); }}>{c.exemplo}</button>
                ))}
                {msg && <button type="button" className="fantasma" onClick={() => setMsg(null)}>×</button>}
              </div>
            </form>
          </div>

          {/* Painel das partes: quantas partes e "Ajustar lotes" no topo; cada
              parte é uma sanfona — a escolhida (no desenho ou aqui) abre com os
              dados de quem recebe, a área e a metragem; as outras ficam
              encolhidas embaixo, a um clique de distância. */}
          <aside className="lot-painel dv-painel">
            <div className="dv-painel-topo">
              <b>{ehGleba ? "Glebas" : "Partes"}</b>
              <div className="dv-contador dv-contador-p">
                <button type="button" onClick={() => { const v = Math.max(2, nPartes - 1); setN(v); setPct([]); if (!regerar(v, iguais, [], azManual, inverter)) setN(nPartes); }} disabled={nPartes <= 2} aria-label={ehGleba ? "Menos uma gleba" : "Menos uma parte"}>−</button>
                <input type="number" min={2} max={30} value={n} aria-label={ehGleba ? "Quantas glebas" : "Quantas partes"}
                  onChange={(e) => setN(Math.max(2, Math.min(30, Math.round(Number(e.target.value)) || 2)))}
                  onBlur={() => { if (n !== nPartes) { setPct([]); if (!regerar(n, iguais, [], azManual, inverter)) setN(nPartes); } }} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                <button type="button" onClick={() => { const v = Math.min(30, nPartes + 1); setN(v); setPct([]); if (!regerar(v, iguais, [], azManual, inverter)) setN(nPartes); }} disabled={nPartes >= 30} aria-label={ehGleba ? "Mais uma gleba" : "Mais uma parte"}>+</button>
              </div>
              <button type="button" className="fantasma dv-ajustar" onClick={ajustarLotes} title="Deixa todas com a mesma área, como o painel mostra e os documentos imprimem (Ctrl+Z volta)">⚖ Ajustar lotes</button>
              <Dica lado="baixo">Clique numa {ehGleba ? "gleba" : "parte"} (no desenho ou aqui) para abrir os dados dela; as outras ficam encolhidas embaixo. "Ajustar lotes" deixa todas do mesmo tamanho mantendo o desenho — se a forma não deixar, divide de novo na direção do giro. Arraste quinas e divisas no desenho para ajustar à mão; roda do mouse aproxima.</Dica>
            </div>

            <div className="dv-sanfona">
              {lotesOrdem.map((l, k) => {
                const aberta = k === parteSel;
                const info = linhas[k] ?? infoDe(undefined, k);
                const area = rd?.ok ? rd.partes[k]?.areaM2 ?? l.area : l.area;
                const p = rd?.ok ? rd.partes[k] : null;
                return (
                  <div key={l.id} className={`dv-item${aberta ? " aberta" : ""}`}>
                    <button type="button" className="dv-item-cabeca" aria-expanded={aberta}
                      onClick={() => (aberta ? setSel(null) : selecionarParte(k))}>
                      <span className="dv-cor" style={{ background: CORES_PARTE[k % CORES_PARTE.length] }} />
                      <span className="dv-item-nome">
                        <b>{nomesPartes[k]}</b>
                        {!ehGleba && <small>{info.herdeiro || "sem herdeiro"}</small>}
                      </span>
                      <span className="dv-item-area mono">{fmtM2(area)} m²<small>{fmt(area / 10000)} ha</small></span>
                      <span className="dv-item-seta" aria-hidden="true">▾</span>
                    </button>
                    {aberta && (
                      <div className="dv-item-corpo">
                        <div className="dv-campos">
                          <label><span>Nome</span>
                            <input value={info.nome} onChange={(e) => editarLinha(k, { nome: e.target.value })} placeholder={`PARTE ${k + 1}`} />
                          </label>
                          {!ehGleba && <>
                            <label><span>Herdeiro / quem recebe</span>
                              <input value={info.herdeiro} onChange={(e) => editarLinha(k, { herdeiro: e.target.value.toUpperCase() })} placeholder={servico.detentor_nome ?? "nome completo"} />
                            </label>
                            <label><span>CPF</span>
                              <input value={info.cpf} onChange={(e) => editarLinha(k, { cpf: e.target.value })} placeholder="000.000.000-00" className="mono" />
                            </label>
                            <label><span className="rotulo-campo">Denominação do GEO<Dica>Nome do imóvel no GEO individual desta parte. Em branco sai o nome do imóvel com o da parte.</Dica></span>
                              <input value={info.denominacao} onChange={(e) => editarLinha(k, { denominacao: e.target.value.toUpperCase() })}
                                placeholder={denominacaoDaParte(servico, { nome: info.nome || `PARTE ${k + 1}`, denominacao: null }).toUpperCase()} />
                            </label>
                          </>}
                        </div>
                        <div className="dv-detalhe-totais">
                          <div><span>Perímetro</span><b className="mono">{fmtM2(p?.perimetroM ?? l.lados.reduce((s, x) => s + x.comp, 0))} m</b></div>
                          {rd?.ok && <div><span>Diferença p/ a cota</span><b className="mono">{(area - alvoArea(k) >= 0 ? "+" : "") + fmtM2(area - alvoArea(k))} m²</b></div>}
                          {temEstrada && p && <div><span>Frente p/ estrada</span><b className={`mono${p.frenteEstradaM < 5 ? " dv-sem" : ""}`}>{fmtM(p.frenteEstradaM)} m</b></div>}
                        </div>
                        <table className="dv-lados">
                          <tbody>
                            {(medidas[k] ?? []).map((m, j) => (
                              <tr key={j} className={m.estrada ? "dv-m-estrada" : m.divisa ? "dv-m-divisa" : ""}>
                                <td>{m.divisa ? `divisa com ${m.confrontante}` : m.confrontante}{m.estrada && " (estrada)"}</td>
                                <td className="mono">{fmtM2(m.comprimentoM)} m</td>
                              </tr>
                            ))}
                            {!medidas[k] && l.lados.map((x, j) => (
                              <tr key={j} className={x.tipo === "via" ? "dv-m-estrada" : x.tipo === "lote" ? "dv-m-divisa" : ""}>
                                <td>{nomeLado(x)}</td><td className="mono">{fmtM2(x.comp)} m</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <form className="dv-area-alvo" onSubmit={(e) => { e.preventDefault(); const v = Number(areaAlvo.replace(/\./g, "").replace(",", ".")); if (v > 0) rodarComando(`area ${v}`); }}>
                          <label>Área de
                            <input value={areaAlvo} onChange={(e) => setAreaAlvo(e.target.value)} placeholder={fmtM2(alvoArea(k))} className="mono" />m²
                          </label>
                          <button type="submit">Aplicar</button>
                        </form>
                        <div className="acoes-linha">
                          {rd?.ok && <button type="button" onClick={() => rodarComando(`area ${alvoArea(k).toFixed(2)}`)} title="A divisa desliza até a parte ficar com a cota dela">Acertar a cota</button>}
                          <button type="button" onClick={() => rodarComando("dividir 2")}>Dividir em 2</button>
                          <button type="button" onClick={() => rodarComando("unir")} title="Une com a parte vizinha">Unir</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {rd?.ok && <div className="sub dv-resumo-pe">{rd.divisas.length} divisa(s) · {fmtM(rd.divisas.reduce((s, d) => s + d.comprimentoM, 0))} m de cerca · {rd.novos.length} marcos novos · maior diferença p/ a cota: {rd.erroAreaM2 < 0.05 ? "< 0,1" : fmtM2(rd.erroAreaM2)} m²</div>}
            {rd && !rd.ok && <div className="dv-alerta">{rd.motivo}</div>}
          </aside>
        </div>
      )}

      {/* Uma barra só: baixar a locação, o formato dela e salvar. As explicações
          ficam no "?" de cada lado; só o motivo de não poder salvar fica à vista. */}
      <div className="dv-barra">
        {rd?.ok && rd.novos.length > 0 && (
          <div className="dv-barra-grupo">
            <button type="button" onClick={baixarLocacao}>Baixar arquivo de locação ({rd.novos.length} marcos)</button>
            <select value={formato} onChange={(e) => setFormato(e.target.value as Exclude<FormatoLocacao, "dxf">)} aria-label="Formato do arquivo de locação">
              {FORMATOS_LOCACAO.map((f) => <option key={f.id} value={f.id}>{f.nome} — {f.serve}</option>)}
            </select>
            <Dica>
              Os pontos novos das divisas em UTM SIRGAS 2000 fuso {fuso}S, para importar na coletora e implantar os marcos.
              {comCodigo && igualAplicada ? " Saem com o código do marco." : " Saem como DIV-01, DIV-02… (com os códigos alocados, saem com o código do marco)."}
            </Dica>
          </div>
        )}
        <span className="esticar" />
        {rd && !rd.ok && <b className="dv-sem">Ainda não dá para salvar: {rd.motivo}.</b>}
        <div className="dv-barra-grupo">
          <button type="button" className="principal" disabled={!rd?.ok || igualAplicada} onClick={aplicar}>
            {ehGleba
              ? (igualAplicada ? "Glebas salvas ✓" : aplicadaAntes ? "Salvar as novas glebas" : `Dividir em ${nPartes} glebas`)
              : (igualAplicada ? "Divisão salva ✓" : aplicadaAntes ? "Salvar a nova divisão" : `Salvar a divisão em ${nPartes} partes`)}
          </button>
          <Dica>
            {igualAplicada
              ? (ehGleba
                ? "As glebas estão salvas no serviço: em Documentos saem a planta A1 com todas as glebas e a A3 de cada uma; o memorial de cada gleba sai nas peças técnicas, depois do SIGEF. O nome de cada gleba pode ser mudado aqui a qualquer momento."
                : "As partes estão salvas no serviço: em Documentos saem a planta A1 com as divisões e a planta A3 de cada parte, e o GEO de cada uma; o memorial de cada parte sai nas peças técnicas, depois do SIGEF. Herdeiro, nome e denominação podem ser mudados aqui a qualquer momento.")
              : <>Salva os {rd?.ok ? rd.novos.length : "—"} pontos novos como marcos <b>M</b> no perímetro (método PA1 até a implantação) e as {nPartes} {ehGleba ? "glebas" : "partes"} como glebas — só depois de salvas elas entram na planta A1 e na A3 de cada uma (o memorial de cada uma sai nas peças técnicas, depois do SIGEF).
                {!ehGleba && " Os ajustes da prancheta ficam guardados como rascunho mesmo sem salvar."}
                {comCodigo && " Os códigos do imóvel serão realocados na próxima geração, por causa dos marcos novos."}
                {aplicadaAntes && (ehGleba ? " As glebas salvas antes são substituídas." : " A divisão salva antes é substituída.")}</>}
          </Dica>
        </div>
      </div>
      </>)}
    </section>
  );
}
