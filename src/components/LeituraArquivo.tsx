// Etapa "Leitura do arquivo" — a conferência do TXT, ANTES de gastar o crédito.
// Mostra COMO o arquivo foi lido (formato, origem da leitura — formato da
// equipe, perfil aprendido, regras ou IA), o desenho do perímetro, a lista de
// pontos, a tabela do arquivo com o papel de cada coluna e os avisos.
//
// O operador confere e ajusta os pontos aqui: desativa, ativa um inativo (apoio,
// outra versão, excluído), liga os pontos à mão na ordem do perímetro (em uma ou
// mais partes) e encaixa um ponto em outro lado. Cada mudança relê o arquivo NA
// HORA com o mesmo código do servidor (supabase/functions/_shared/leitor), que
// reexecuta tudo antes de criar o serviço. "Gerar imagem" monta o esboço
// (satélite + perímetro + medidas) do lado direito, para baixar. Avisos
// importantes pedem um "conferi". O "Prosseguir" é o que cria o serviço — e é
// nele que o crédito é gasto (a pergunta fica no Upload).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import proj4lib from "proj4";
import type { Proj4 } from "../../supabase/functions/_shared/geo.ts";
import { detectZoneCandidates, UF_BBOX } from "../../supabase/functions/_shared/geo.ts";
import { executarReceita } from "../../supabase/functions/_shared/leitor/index.ts";
import type { Leitura, PontoLido, Receita } from "../../supabase/functions/_shared/leitor/index.ts";
import { APOIO_PADRAO, camposVazios, PAPEIS } from "../../supabase/functions/_shared/leitor/receita.ts";
import type { Papel } from "../../supabase/functions/_shared/leitor/receita.ts";
import { dividirDelimitado, dividirEspacos } from "../../supabase/functions/_shared/leitor/executor.ts";
import { cruzamentos } from "../../supabase/functions/_shared/leitor/ordem.ts";
import { BotaoTelaCheia } from "./TelaCheia";
import { usePinca } from "../lib/pinca";
import { VERSAO_TODAS } from "../../supabase/functions/_shared/leitor/versoes.ts";
import { desenharEsboco, fmtArea, fmtM, medirEsboco } from "../lib/esboco";
import type { Esboco, PontoEsboco } from "../lib/esboco";
import { Dica } from "./ui";
import { lonLatDeUtm, PreviaRestricoes } from "./RestricoesImovel";
import { estimarAltitudes } from "../lib/altitude_terreno";
import type { AltitudesEstimadas } from "../lib/altitude_terreno";
import "./leitura.css";

const proj4: Proj4 = (de, para, c) => (proj4lib as unknown as Proj4)(de, para, c);

export interface RespostaLeitura {
  ok: boolean;
  formato: string;
  codificacao: string;
  linhas: string[];
  receita: Receita | null;
  confianca: "alta" | "media" | "baixa";
  duvidas: string[];
  perfil: { id: string; nome: string | null } | null;
  ia: { usada: boolean; tentativas: { modelo: string; aprovada: boolean; ms: number; custoUsd: number | null }[]; custoUsd: number; erro: string | null; motivo: string | null };
  binario?: { formato: string; orientacao: string };
  /** O servidor aceita os ajustes de pontos (ativar inativo, ligar à mão).
   *  Ausente = servidor antigo: a tela só deixa desativar/reativar excluídos. */
  ajustes?: number;
}

export interface LeituraConfirmada {
  receita: Receita;
  ordem: "auto" | "id" | "arquivo";
  excluir: number[];
  sigma_padrao: { pos: number; h: number } | null;
  /** Altitude estimada pela coordenada (idx do ponto → m) para quem veio sem; null = nenhuma. */
  altura_padrao: Record<number, number> | null;
  confirmados: string[];
  /** Versão dos pontos que entra no perímetro ("" = levantamento, "postp_"…);
   *  null quando o arquivo tem uma versão só. */
  versao: string | null;
  /** Linhas de pontos inativos (apoio, outra versão) ativados na prévia. */
  incluir: number[];
  /** Ligação feita à mão (partes × índice do ponto); null = ordem automática. */
  ligacao: number[][] | null;
  /** Resumo para a pergunta do crédito (não vai ao servidor como regra). */
  resumo: { pontos: number; partes: number; areaHa: number | null; perimetroM: number | null };
}

const NOME_PAPEL: Record<Papel, string> = {
  nome: "Ponto (nome)", codigo: "Código / descrição", e: "E (este)", n: "N (norte)", h: "Altitude",
  lat: "Latitude", lon: "Longitude", sigma_pos: "σ horizontal", sigma_h: "σ vertical", sigma_n: "σ norte", sigma_e: "σ este",
};
const SEPARADORES: { valor: string; rotulo: string }[] = [
  { valor: ";", rotulo: "ponto e vírgula ( ; )" }, { valor: ",", rotulo: "vírgula ( , )" }, { valor: "\t", rotulo: "tabulação" },
  { valor: "|", rotulo: "barra ( | )" }, { valor: ":", rotulo: "dois-pontos ( : )" }, { valor: "espacos", rotulo: "espaços" },
];

/** Receita de partida quando nada foi reconhecido: o operador mapeia as colunas. */
export function receitaManual(linhas: string[]): Receita {
  const amostra = linhas.filter((l) => l.trim()).slice(0, 50);
  const conta = (d: string) => amostra.reduce((s, l) => s + (l.split(d).length - 1), 0);
  const d = [";", "\t", ",", "|"].sort((a, b) => conta(b) - conta(a))[0];
  const usaD = conta(d) >= amostra.length;
  return {
    versao: 1, registro: "linha", pular_inicio: 0, ignorar: [], tokenizacao: usaD ? "delimitado" : "espacos", delimitador: usaD ? d : null,
    colunas: null, excedente_em: null, cortes: null, regex: null, decimal: amostra.some((l) => /\d,\d/.test(l)) && d !== "," ? "," : ".",
    campos: camposVazios(), sistema: "utm", fuso: null, hemisferio: "S", unidade_sigma: "m", confianca_sigma: "1sigma",
    nome_formato: "texto", ordem: "auto", apoio: [...APOIO_PADRAO], origem: "operador",
    explicacao: "Formato não reconhecido automaticamente: indique na tabela o papel de cada coluna.",
  };
}

const ORIGEM: (r: Receita, perfil: RespostaLeitura["perfil"]) => { selo: string; texto: string } = (r, perfil) => {
  if (r.origem === "padrao") return { selo: "Formato da equipe", texto: "Arquivo no formato de sempre das coletoras da equipe." };
  if (r.origem.startsWith("perfil:")) return { selo: "Formato já conhecido", texto: `Reconhecido pelo perfil “${perfil?.nome ?? "aprendido"}”, salvo da primeira vez que este formato chegou.` };
  if (r.origem.startsWith("ia:")) return { selo: "Interpretado pela IA", texto: "Formato novo: a IA descreveu como ler o arquivo e o sistema conferiu cada número no texto original." };
  if (r.origem === "operador") return { selo: "Ajustado por você", texto: "Leitura com os ajustes feitos nesta tela." };
  return { selo: "Reconhecido automaticamente", texto: "Estrutura reconhecida pelas regras do sistema." };
};

// ---------------------------------------------------------------------------
// Ajustes de pontos
// ---------------------------------------------------------------------------

interface Ajustes { excluir: Set<number>; incluir: Set<number>; ligacao: number[][] | null }

/** Situação de um ponto lido no desenho atual. */
export type Situacao = "vertice" | "excluido" | "apoio" | "versao" | "solto" | "repetido";
const NOME_SITUACAO: Record<Situacao, string> = {
  vertice: "no perímetro", excluido: "desativado", apoio: "inativo · apoio", versao: "inativo · outra versão", solto: "fora da ligação", repetido: "repetido",
};
const inativo = (s: Situacao) => s === "excluido" || s === "apoio" || s === "versao" || s === "solto";

const dist = (a: { e: number; n: number }, b: { e: number; n: number }) => Math.hypot(a.e - b.e, a.n - b.n);

/** Põe o ponto `idx` no lado em que ele acrescenta menos caminho (o "lugar natural"). */
function inserirNoMelhorLado(ligacao: number[][], idx: number, pontos: PontoLido[]): number[][] {
  const p = pontos[idx];
  let melhor = { parte: 0, pos: 0, custo: Infinity };
  ligacao.forEach((parte, k) => {
    parte.forEach((a, i) => {
      const b = parte[(i + 1) % parte.length];
      const custo = dist(pontos[a], p) + dist(p, pontos[b]) - dist(pontos[a], pontos[b]);
      if (custo < melhor.custo) melhor = { parte: k, pos: i + 1, custo };
    });
  });
  return ligacao.map((parte, k) => (k === melhor.parte ? [...parte.slice(0, melhor.pos), idx, ...parte.slice(melhor.pos)] : parte));
}

/** Tira `idx` da ligação e o põe entre `a` e `b` (um lado do desenho). */
function encaixarNoLado(ligacao: number[][], idx: number, a: number, b: number): number[][] {
  const sem = ligacao.map((parte) => parte.filter((i) => i !== idx));
  return sem.map((parte) => {
    const ia = parte.indexOf(a);
    if (ia < 0 || !parte.includes(b)) return parte;
    const n = parte.length;
    // b logo depois de a: entra depois de a; b logo antes de a: entra antes de a
    const pos = parte[(ia + 1) % n] === b ? ia + 1 : parte[(ia - 1 + n) % n] === b ? ia : ia + 1;
    return [...parte.slice(0, pos), idx, ...parte.slice(pos)];
  });
}

/** Fusos em que o desenho cabe (dentro da UF, se ela foi informada). */
function fusosPossiveis(anel: { e: number; n: number }[], uf: string): { zone: number; lon: number }[] {
  if (anel.length < 3) return [];
  try {
    const todos = detectZoneCandidates(anel, proj4);
    const bb = uf ? UF_BBOX[uf] : undefined;
    const naUf = bb ? todos.filter((c) => c.lonCentroide >= bb[0] && c.lonCentroide <= bb[1] && c.latCentroide >= bb[2] && c.latCentroide <= bb[3]) : todos;
    return (naUf.length ? naUf : todos).map((c) => ({ zone: c.zone, lon: c.lonCentroide }));
  } catch { return []; }
}
const fmtLon = (lon: number) => { const a = Math.abs(lon); const g = Math.floor(a); return `${g}°${String(Math.round((a - g) * 60)).padStart(2, "0")}′ ${lon < 0 ? "O" : "L"}`; };
const fmtCoord = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

type Modo = { t: "ver" } | { t: "ligar"; partes: number[][]; aberta: boolean } | { t: "encaixar"; idx: number };

export function LeituraArquivo({ nomeArquivo, resposta, criando, erro, onConfirmar, onTrocarArquivo, uf = "", fuso = null, onEscolherFuso }: {
  nomeArquivo: string;
  resposta: RespostaLeitura;
  criando: boolean;
  erro: string | null;
  onConfirmar: (l: LeituraConfirmada) => void;
  onTrocarArquivo: () => void;
  /** UF do imóvel (separa os fusos possíveis para o esboço) */
  uf?: string;
  /** fuso fixado pelo operador (ou já escolhido); null = automático */
  fuso?: number | null;
  /** o operador escolheu o fuso aqui (vale também para criar o serviço) */
  onEscolherFuso?: (z: number) => void;
}) {
  const linhas = resposta.linhas;
  const podeAjustar = !!resposta.ajustes;
  const [receita, setReceita] = useState<Receita>(() => resposta.receita ?? receitaManual(linhas));
  const [ordem, setOrdem] = useState<"auto" | "id" | "arquivo">("auto");
  const [aj, setAj] = useState<Ajustes>({ excluir: new Set(), incluir: new Set(), ligacao: null });
  const [historico, setHistorico] = useState<Ajustes[]>([]);
  const [selecionado, setSelecionado] = useState<number | null>(null);
  const [modo, setModo] = useState<Modo>({ t: "ver" });
  const [recado, setRecado] = useState<string | null>(null);
  // versão dos pontos (levantamento × "postp_"…): null = a automática, a mais completa
  const [versao, setVersao] = useState<string | null>(null);
  const [sigmaTexto, setSigmaTexto] = useState({ pos: "", h: "" });
  const [confirmados, setConfirmados] = useState<Set<string>>(new Set());
  const [verTodas, setVerTodas] = useState(false);
  // a tabela já vem aberta quando a leitura pede conferência (IA, dúvida, nada reconhecido)
  const [ajustar, setAjustar] = useState(resposta.receita === null || resposta.confianca !== "alta" || !!resposta.receita?.origem.startsWith("ia:"));
  const { excluir, incluir, ligacao } = aj;

  const sigmaPadrao = useMemo(() => {
    const pos = Number(sigmaTexto.pos.replace(",", ".")), h = Number(sigmaTexto.h.replace(",", "."));
    return pos > 0 && h > 0 && pos <= 10 && h <= 10 ? { pos, h } : null;
  }, [sigmaTexto]);

  // altitude pela coordenada para os pontos sem altitude no arquivo (modelo de terreno)
  // (os valores são por índice do ponto: só valem para a mesma receita)
  const [alturas, setAlturas] = useState<{ chave: string; receita: string; est: AltitudesEstimadas } | null>(null);
  const [buscandoAlt, setBuscandoAlt] = useState(false);
  const [erroAlt, setErroAlt] = useState<string | null>(null);
  const receitaChave = useMemo(() => JSON.stringify(receita), [receita]);
  const alturaPadrao = alturas && alturas.receita === receitaChave && Object.keys(alturas.est.valores).length ? alturas.est.valores : null;

  const leitura: Leitura | null = useMemo(() => {
    try {
      return executarReceita(linhas, receita, { proj4, ordem, excluir: [...excluir], sigmaPadrao, alturaPadrao, versao, incluir: [...incluir], ligacao }, resposta.confianca, resposta.duvidas);
    } catch { return null; }
  }, [linhas, receita, ordem, excluir, incluir, ligacao, sigmaPadrao, alturaPadrao, versao, resposta.confianca, resposta.duvidas]);
  // a versão que o sistema escolheria sozinho (marcada "sugerida" na lista)
  const versaoSugerida = useMemo(() => {
    if (versao === null) return leitura?.versoes.escolhida ?? null;
    try { return executarReceita(linhas, receita, { proj4, ordem, excluir: [...excluir], sigmaPadrao }).versoes.escolhida; }
    catch { return null; }
  }, [versao, leitura, linhas, receita, ordem, excluir, sigmaPadrao]);

  /** Muda os ajustes guardando o estado anterior (para o "Desfazer"). */
  function aplicar(mud: Partial<Ajustes>, texto?: string) {
    setHistorico((h) => [...h.slice(-49), aj]);
    setAj({ ...aj, ...mud });
    setConfirmados(new Set());
    setRecado(texto ?? null);
  }
  function desfazer() {
    if (!historico.length) return;
    setAj(historico[historico.length - 1]);
    setHistorico(historico.slice(0, -1));
    setConfirmados(new Set());
    setRecado("Último ajuste desfeito.");
  }

  const editar = (mud: Partial<Receita>) => {
    setReceita((r) => ({ ...r, ...mud, origem: "operador" }));
    // outra leitura das colunas pode mudar os pontos: a ligação e as ativações recomeçam
    if (ligacao || incluir.size) aplicar({ ligacao: null, incluir: new Set() });
    setConfirmados(new Set());
  };
  const definirPapel = (coluna: number, papel: Papel | "") => {
    const campos = { ...receita.campos };
    for (const p of PAPEIS) if (campos[p] === coluna) campos[p] = null;
    if (papel) campos[papel] = coluna;
    const geo = campos.lat !== null && campos.lon !== null && (campos.e === null || campos.n === null);
    editar({ campos, sistema: geo ? "geografica" : "utm" });
  };

  // ---- situação de cada ponto ----
  const noAnel = useMemo(() => new Set(leitura?.anel.map((p) => p.idx) ?? []), [leitura]);
  const soltos = useMemo(() => new Set(leitura?.ignoradas.filter((i) => i.tipo === "ligacao").map((i) => i.linha) ?? []), [leitura]);
  const situacao = useCallback((p: PontoLido): Situacao => {
    if (noAnel.has(p.idx)) return "vertice";
    if (excluir.has(p.linha)) return "excluido";
    if (soltos.has(p.linha)) return "solto";
    if (p.apoio && !incluir.has(p.linha)) return "apoio";
    if (p.foraDaVersao && !incluir.has(p.linha)) return "versao";
    return "repetido";
  }, [noAnel, excluir, incluir, soltos]);
  /** As partes do desenho atual, em índices de ponto (base para ligar/encaixar). */
  const partesAtuais = useMemo(() => (leitura ? leitura.blocos.map((b) => b.map((k) => leitura.anel[k].idx)) : []), [leitura]);

  // ---- ações sobre um ponto ----
  const nomeDe = (p: PontoLido) => p.nome || `linha ${p.linha}`;
  // ativar apoio/outra versão depende do servidor novo (o antigo ignoraria e criaria sem o ponto)
  const precisaServidor = (p: PontoLido) => !podeAjustar && (p.apoio || !!p.foraDaVersao);
  function desativar(p: PontoLido) {
    const exc = new Set(excluir), inc = new Set(incluir);
    if (inc.has(p.linha) && (p.apoio || p.foraDaVersao)) inc.delete(p.linha); else exc.add(p.linha);
    aplicar({ excluir: exc, incluir: inc }, `Ponto ${nomeDe(p)} desativado: saiu do perímetro.`);
  }
  function ativar(p: PontoLido) {
    const exc = new Set(excluir), inc = new Set(incluir);
    exc.delete(p.linha);
    if ((p.apoio || p.foraDaVersao) && podeAjustar) inc.add(p.linha);
    let lig = ligacao;
    // com ligação feita à mão, o ponto entra no lado onde ele "cabe" melhor
    if (lig && !lig.some((parte) => parte.includes(p.idx)) && leitura) lig = inserirNoMelhorLado(lig, p.idx, leitura.pontos);
    aplicar({ excluir: exc, incluir: inc, ligacao: lig }, `Ponto ${nomeDe(p)} ativado: voltou ao perímetro.`);
  }
  function ligarSolto(p: PontoLido) {
    if (!ligacao || !leitura) return;
    aplicar({ ligacao: inserirNoMelhorLado(ligacao, p.idx, leitura.pontos) }, `Ponto ${nomeDe(p)} ligado ao perímetro, no lado mais próximo.`);
  }
  function encaixar(idx: number, a: number, b: number) {
    if (!leitura) return;
    const p = leitura.pontos[idx];
    const exc = new Set(excluir), inc = new Set(incluir);
    exc.delete(p.linha);
    if (p.apoio || p.foraDaVersao) inc.add(p.linha);
    const base = ligacao ?? partesAtuais;
    aplicar({ excluir: exc, incluir: inc, ligacao: encaixarNoLado(base, idx, a, b) },
      `Ponto ${nomeDe(p)} encaixado entre ${nomeDe(leitura.pontos[a])} e ${nomeDe(leitura.pontos[b])}.`);
    setModo({ t: "ver" });
    setSelecionado(idx);
  }

  // ---- ligar à mão ----
  function cliqueLigando(idx: number) {
    if (modo.t !== "ligar" || !leitura) return;
    const partes = modo.partes.map((p) => [...p]);
    const aberta = modo.aberta ? partes[partes.length - 1] : null;
    if (aberta && aberta.length >= 3 && idx === aberta[0]) {
      setModo({ t: "ligar", partes, aberta: false });
      setRecado(`Parte ${partes.length} fechada com ${aberta.length} pontos. Clique em “Concluir ligação” ou comece outra parte.`);
      return;
    }
    if (partes.some((p) => p.includes(idx))) { setRecado(`O ponto ${nomeDe(leitura.pontos[idx])} já está ligado.`); return; }
    if (aberta) aberta.push(idx); else partes.push([idx]);
    setModo({ t: "ligar", partes, aberta: true });
    setRecado(null);
  }
  function desfazerPontoLigado() {
    if (modo.t !== "ligar") return;
    const partes = modo.partes.map((p) => [...p]);
    if (!modo.aberta) { setModo({ t: "ligar", partes, aberta: partes.length > 0 }); return; }
    const ult = partes[partes.length - 1];
    ult?.pop();
    if (ult && !ult.length) partes.pop();
    setModo({ t: "ligar", partes, aberta: partes.length > 0 });
  }
  function concluirLigacao() {
    if (modo.t !== "ligar" || !leitura) return;
    const partes = modo.partes.filter((p) => p.length);
    if (!partes.length) { setModo({ t: "ver" }); return; }
    const curta = partes.findIndex((p) => p.length < 3);
    if (curta >= 0) { setRecado(`A parte ${curta + 1} tem só ${partes[curta].length} ponto(s): ligue pelo menos 3 ou desfaça.`); return; }
    const exc = new Set(excluir), inc = new Set(incluir);
    for (const idx of partes.flat()) {
      const p = leitura.pontos[idx];
      exc.delete(p.linha);
      if (p.apoio || p.foraDaVersao) inc.add(p.linha);
    }
    const total = partes.flat().length;
    aplicar({ excluir: exc, incluir: inc, ligacao: partes },
      `Ligação aplicada: ${total} pontos${partes.length > 1 ? ` em ${partes.length} partes` : ""}. Os pontos que você não ligou ficam fora do perímetro.`);
    setModo({ t: "ver" });
  }

  // teclado: Esc sai do modo, Delete desativa o ponto escolhido, Ctrl+Z desfaz
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|SELECT|TEXTAREA)$/.test(alvo.tagName)) return;
      if (!ref.current || !document.body.contains(ref.current)) return;
      if (e.key === "Escape") { if (modo.t !== "ver") setModo({ t: "ver" }); else setSelecionado(null); }
      else if ((e.key === "Delete" || e.key === "Backspace") && modo.t === "ver" && selecionado !== null && leitura) {
        const p = leitura.pontos[selecionado];
        if (p && situacao(p) === "vertice") { e.preventDefault(); desativar(p); }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && modo.t === "ver") { e.preventDefault(); desfazer(); }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  // ---- esboço (imagem de satélite) ----
  const anelChave = leitura ? JSON.stringify(leitura.blocos.map((b) => b.map((k) => [leitura.anel[k].e, leitura.anel[k].n]))) : "";
  const fusos = useMemo(() => (leitura ? fusosPossiveis(leitura.anel, uf) : []), [leitura, uf]);
  const fusoEsboco = leitura?.fusoGeo ?? fuso ?? (fusos.length === 1 ? fusos[0].zone : null);

  // Pontos sem altitude no arquivo: o sistema busca pela coordenada, sozinho.
  // A chave é a leitura (receita) + o fuso: mudou, busca de novo; igual, não repete.
  const pedemAltura = useMemo(() => (leitura ? leitura.pontos.filter((p) => p.h === null || p.hEstimada) : []), [leitura]);
  const precisaGeo = pedemAltura.some((p) => !p.geo);
  const chaveAlt = pedemAltura.length ? `${receitaChave}|${precisaGeo ? fusoEsboco : "geo"}` : "";
  const tentouAlt = useRef("");
  async function buscarAltitudes() {
    if (!leitura || !chaveAlt) return;
    const chave = chaveAlt, rc = receitaChave;
    tentouAlt.current = chave;
    setBuscandoAlt(true);
    setErroAlt(null);
    try {
      const est = await estimarAltitudes(
        leitura.pontos.map((p) => ({ idx: p.idx, e: p.e, n: p.n, geo: p.geo, h: p.hEstimada ? null : p.h })),
        precisaGeo ? fusoEsboco : null,
      );
      setAlturas({ chave, receita: rc, est });
      setConfirmados(new Set());
    } catch (err) {
      setAlturas(null);
      setErroAlt(err instanceof Error ? err.message : String(err));
    } finally {
      setBuscandoAlt(false);
    }
  }
  useEffect(() => {
    if (!chaveAlt || buscandoAlt || alturas?.chave === chaveAlt || tentouAlt.current === chaveAlt) return;
    if (precisaGeo && fusoEsboco === null) return; // espera o fuso
    void buscarAltitudes();
  });
  const [esboco, setEsboco] = useState<{ e: Esboco; chave: string } | null>(null);
  const [gerando, setGerando] = useState(false);
  const [erroEsboco, setErroEsboco] = useState<string | null>(null);
  const [perguntarFuso, setPerguntarFuso] = useState(false);
  const [verLados, setVerLados] = useState(false);
  const [ampliado, setAmpliado] = useState(false);
  useEffect(() => () => { if (esboco) URL.revokeObjectURL(esboco.e.url); }, [esboco]);
  const desatualizado = !!esboco && esboco.chave !== `${anelChave}|${fusoEsboco}`;
  const partesEsboco = useMemo((): PontoEsboco[][] => (leitura ? leitura.blocos.map((b) => b.map((k) => {
    const p = leitura.anel[k];
    return { nome: p.nome || String(p.num), e: p.e, n: p.n, h: p.h };
  })) : []), [leitura]);
  async function gerarImagem(z: number | null = fusoEsboco) {
    if (!leitura || leitura.anel.length < 3) return;
    if (z === null) { setPerguntarFuso(true); return; }
    setPerguntarFuso(false);
    setGerando(true);
    setErroEsboco(null);
    try {
      const e = await desenharEsboco(partesEsboco, z, { titulo: nomeArquivo.replace(/\.[^.]+$/, "") });
      setEsboco({ e, chave: `${anelChave}|${z}` });
    } catch (err) {
      setErroEsboco(err instanceof Error ? err.message : String(err));
    } finally {
      setGerando(false);
    }
  }
  function baixar() {
    if (!esboco) return;
    const a = document.createElement("a");
    a.href = esboco.e.url;
    a.download = `esboco-${nomeArquivo.replace(/\.[^.]+$/, "").replace(/[^\w\-]+/g, "_")}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // medidas do desenho atual (para o resumo do crédito e o rodapé), sem rede
  const medidas = useMemo(() => {
    if (partesEsboco.flat().length < 3) return null;
    const z = fusoEsboco ?? fusos[0]?.zone;
    if (!z) return null;
    try { return medirEsboco(partesEsboco, z); } catch { return null; }
  }, [partesEsboco, fusoEsboco, fusos]);

  // prévia das restrições: o desenho atual em lon/lat, no fuso que o esboço usaria
  // (sem fuso decidido não há onde pôr o imóvel — a prévia espera)
  const fusoPrevia = fusoEsboco ?? (fusos.length === 1 ? fusos[0].zone : null);
  const aneisPrevia = useMemo(() => {
    if (!fusoPrevia || partesEsboco.flat().length < 3) return [];
    try { return lonLatDeUtm(partesEsboco, fusoPrevia); } catch { return []; }
  }, [partesEsboco, fusoPrevia]);

  const bloqueios = leitura ? leitura.avisos.filter((a) => a.nivel === "bloqueio") : [];
  const faltaConfirmar = leitura ? leitura.aConfirmar.filter((c) => !confirmados.has(c)) : [];
  const pode = !!leitura && leitura.ok && faltaConfirmar.length === 0 && !criando && modo.t === "ver";
  const semSigma = leitura?.avisos.some((a) => a.codigo === "sem_precisao") || sigmaPadrao !== null || !!leitura?.anel.some((p) => p.sigmaDeclarado);
  const origem = ORIGEM(receita, resposta.perfil);
  const estado = !leitura || bloqueios.length ? "ruim" : leitura.aConfirmar.length ? "atencao" : "bom";
  const tabular = receita.registro === "linha" || receita.registro === "planilha";
  const ajustesFeitos = excluir.size + incluir.size + (ligacao ? 1 : 0);
  const inativos = leitura ? leitura.pontos.filter((p) => inativo(situacao(p))).length : 0;
  const sel = selecionado !== null && leitura ? leitura.pontos[selecionado] ?? null : null;

  function prosseguir() {
    if (!leitura) return;
    onConfirmar({
      receita, ordem, excluir: [...excluir], sigma_padrao: sigmaPadrao, altura_padrao: alturaPadrao, confirmados: [...confirmados], versao: leitura.versoes.escolhida,
      incluir: [...incluir], ligacao,
      resumo: { pontos: leitura.anel.length, partes: leitura.blocos.length, areaHa: medidas?.areaHa ?? null, perimetroM: medidas?.perimetroM ?? null },
    });
  }

  return (
    <div className="leitura-arquivo" ref={ref}>
      {/* ---- faixa de resumo ---- */}
      <div className={`lt-faixa lt-${estado}`}>
        <span className="lt-sinal" aria-hidden>{estado === "bom" ? "✓" : estado === "atencao" ? "!" : "✕"}</span>
        <div className="lt-faixa-texto">
          <b>
            {!leitura ? "Não foi possível ler com estas opções"
              : estado === "ruim" ? "Falta resolver antes de prosseguir"
              : estado === "atencao" ? "Lido — confira os pontos marcados abaixo"
              : "Arquivo lido sem pendências"}
          </b>
          <span className="lt-chips">
            <span className="lt-chip forte">{origem.selo}</span>
            <span className="lt-chip">{nomeArquivo}</span>
            <span className="lt-chip">{resposta.formato}</span>
            {leitura && <span className="lt-chip">{leitura.anel.length} ponto(s) no perímetro</span>}
            {leitura && leitura.blocos.length > 1 && <span className="lt-chip">{leitura.blocos.length} partes</span>}
            {leitura?.fusoGeo && <span className="lt-chip">lat/lon → UTM {leitura.fusoGeo}S</span>}
            {inativos > 0 && <span className="lt-chip">{inativos} inativo(s)</span>}
            {ligacao && <span className="lt-chip">ligação feita por você</span>}
          </span>
        </div>
        <button type="button" className="fantasma" onClick={() => setAjustar((v) => !v)}>{ajustar ? "ocultar colunas" : "ajustar colunas"}</button>
      </div>

      <div className="lt-grade">
        <div className="lt-esquerda">
          {/* ---- desenho + ajustes de pontos ---- */}
          <section className="lt-mapa" aria-label="Conferência e ajuste dos pontos" data-tela-cheia="">
            <BotaoTelaCheia className="lt-tela-cheia" />
            <BarraAjustes
              modo={modo} sel={sel} situacao={sel ? situacao(sel) : null} podeAjustar={podeAjustar}
              ordemPerimetro={sel && leitura ? leitura.anel.findIndex((p) => p.idx === sel.idx) : -1} totalPerimetro={leitura?.anel.length ?? 0}
              podeDesfazer={historico.length > 0} temLigacao={!!ligacao} ajustesFeitos={ajustesFeitos}
              precisaServidor={sel ? precisaServidor(sel) : false}
              onLigar={() => { setSelecionado(null); setModo({ t: "ligar", partes: [], aberta: false }); setRecado("Clique nos pontos na ordem do perímetro. Clique no primeiro ponto para fechar a parte."); }}
              onDesfazer={desfazer}
              onAutomatica={() => aplicar({ ligacao: null }, "Voltou à ordem automática.")}
              onRestaurar={() => aplicar({ excluir: new Set(), incluir: new Set(), ligacao: null }, "Leitura original restaurada: todos os ajustes de pontos foram desfeitos.")}
              onDesativar={() => sel && desativar(sel)}
              onAtivar={() => sel && ativar(sel)}
              onLigarSolto={() => sel && ligarSolto(sel)}
              onEncaixar={() => sel && setModo({ t: "encaixar", idx: sel.idx })}
              onFecharSel={() => setSelecionado(null)}
              onDesfazerPonto={desfazerPontoLigado}
              onConcluir={concluirLigacao}
              onCancelar={() => { setModo({ t: "ver" }); setRecado(null); }}
            />
            {recado && <p className="lt-recado" role="status">{recado}</p>}
            {leitura && leitura.pontos.length > 0
              ? <MapaAjuste leitura={leitura} situacao={situacao} selecionado={selecionado} modo={modo}
                  onPonto={(idx) => {
                    if (modo.t === "ligar") cliqueLigando(idx);
                    else if (modo.t === "ver") { setSelecionado((s) => (s === idx ? null : idx)); setRecado(null); }
                  }}
                  onLado={(a, b) => { if (modo.t === "encaixar") encaixar(modo.idx, a, b); }} />
              : <div className="lt-vazio">Nenhum ponto lido ainda. Indique as colunas de coordenadas na tabela abaixo.</div>}
            <p className="lt-legenda">
              <span><i className="lt-leg-ponto" /> vértice</span>
              <span><i className="lt-leg-apoio" /> apoio (inativo)</span>
              <span><i className="lt-leg-excluido" /> desativado</span>
              {leitura && leitura.versoes.versoes.length > 1 && <span><i className="lt-leg-versao" /> outra versão</span>}
              {ligacao && <span><i className="lt-leg-solto" /> fora da ligação</span>}
              <span><i className="lt-leg-cruza" /> lado que cruza</span>
            </p>
          </section>

          {leitura && leitura.pontos.length > 0 && (
            <ListaPontos leitura={leitura} situacao={situacao} selecionado={selecionado}
              onSelecionar={(idx) => { if (modo.t === "ligar") cliqueLigando(idx); else if (modo.t === "ver") setSelecionado(idx); }}
              onDesativar={desativar} onAtivar={ativar} onLigarSolto={ligarSolto} precisaServidor={precisaServidor} ocupado={modo.t !== "ver"}
              ordemLigando={modo.t === "ligar" ? modo.partes : null} />
          )}
        </div>

        <section className="lt-lateral">
          {/* ---- esboço ---- */}
          <div className="lt-bloco lt-esboco">
            <div className="lt-esboco-topo">
              <h4>Esboço<Dica lado="baixo">Imagem de satélite com o perímetro conferido aqui, a medida de cada lado, área e perímetro. Serve para mostrar ao cliente e conferir o desenho antes de prosseguir — gerar e baixar não gasta crédito.</Dica></h4>
              <button type="button" className={esboco && !desatualizado ? "" : "principal"} disabled={gerando || !leitura || leitura.anel.length < 3 || modo.t !== "ver"} onClick={() => void gerarImagem()}>
                {gerando ? "Gerando…" : esboco ? "Gerar de novo" : "Gerar imagem"}
              </button>
            </div>
            {perguntarFuso && (
              <div className="lt-fuso" role="group" aria-label="Fuso do levantamento">
                <b>Em qual fuso UTM o levantamento foi feito?</b>
                <span className="sub pequeno">As coordenadas servem para {fusos.length} fusos{uf ? ` na ${uf}` : ""}; cada um põe o imóvel num lugar. A escolha vale também para o serviço.</span>
                <div className="lt-fuso-opcoes">
                  {fusos.map((f) => (
                    <button key={f.zone} type="button" onClick={() => { onEscolherFuso?.(f.zone); void gerarImagem(f.zone); }}>
                      {f.zone}S — imóvel em {fmtLon(f.lon)}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {gerando && <div className="lt-esboco-vazio"><span className="spinner" /> buscando a imagem de satélite e desenhando as medidas…</div>}
            {!gerando && !esboco && !perguntarFuso && (
              <button type="button" className="lt-esboco-vazio lt-esboco-convite" disabled={!leitura || leitura.anel.length < 3} onClick={() => void gerarImagem()}>
                <span className="lt-esboco-icone" aria-hidden>▦</span>
                <span>Gere a imagem de satélite com o perímetro e as medidas de cada lado.</span>
              </button>
            )}
            {erroEsboco && <div className="erro" role="alert">{erroEsboco}</div>}
            {esboco && !gerando && (
              <>
                <button type="button" className={`lt-esboco-img${desatualizado ? " velho" : ""}`} onClick={() => setAmpliado(true)} aria-label="Ampliar o esboço">
                  <img src={esboco.e.url} alt={`Esboço sobre imagem de satélite: ${fmtArea(esboco.e.medidas.areaHa)}, perímetro ${fmtM(esboco.e.medidas.perimetroM)}`} />
                  {desatualizado && <span className="lt-esboco-velho">os pontos mudaram — gere de novo</span>}
                </button>
                <div className="lt-esboco-kpis">
                  <span><small>Área</small><b>{fmtArea(esboco.e.medidas.areaHa)}</b></span>
                  <span><small>Perímetro</small><b>{fmtM(esboco.e.medidas.perimetroM)}</b></span>
                  <span><small>Vértices</small><b>{esboco.e.medidas.vertices}</b></span>
                </div>
                {(esboco.e.semSatelite || esboco.e.ladosSemCota > 0) && (
                  <p className="sub pequeno lt-esboco-nota">
                    {esboco.e.semSatelite ? "Sem a foto de satélite (sem conexão com o servidor de imagens): o desenho saiu sobre fundo neutro. " : ""}
                    {esboco.e.ladosSemCota > 0 ? `${esboco.e.ladosSemCota} lado(s) curto(s) demais para a cota caber na imagem — estão na tabela de lados.` : ""}
                  </p>
                )}
                <div className="lt-esboco-acoes">
                  <button type="button" className="principal" onClick={baixar} disabled={desatualizado}>Baixar imagem (PNG)</button>
                  <button type="button" className="fantasma" onClick={() => setVerLados((v) => !v)}>{verLados ? "ocultar lados" : `ver os ${esboco.e.medidas.lados.length} lados`}</button>
                </div>
                {verLados && (
                  <div className="lt-lados">
                    <table>
                      <thead><tr><th>Lado</th><th>Azimute</th><th>Distância</th></tr></thead>
                      <tbody>
                        {esboco.e.medidas.lados.map((l, i) => (
                          <tr key={i}><td>{esboco.e.medidas.partes.length > 1 ? `P${l.parte + 1} · ` : ""}{l.de} → {l.para}</td><td className="mono">{l.azimuteFmt}</td><td className="mono">{l.distFmt} m</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>

          {/* prévia GRÁTIS das restrições (TI, UC, assentamento…): só tem/não tem, antes do crédito */}
          {aneisPrevia.length > 0 && <PreviaRestricoes aneisLonLat={aneisPrevia} fuso={fusoPrevia} />}

          <div className="lt-bloco">
            <h4>Como entendemos<Dica lado="baixo">{origem.texto} Os números são copiados do arquivo, nunca digitados: cada coordenada tem a linha de onde saiu.</Dica></h4>
            <p className="lt-explicacao">
              {receita.origem === "operador"
                ? `Leitura definida por você: ${PAPEIS.filter((p) => receita.campos[p] !== null).sort((a, b) => receita.campos[a]! - receita.campos[b]!).map((p) => `${NOME_PAPEL[p]} na coluna ${receita.campos[p]! + 1}`).join(", ") || "nenhuma coluna indicada ainda"}.`
                : receita.explicacao || "—"}
            </p>
            {resposta.ia.usada && (
              <p className="sub pequeno">
                IA: {resposta.ia.tentativas.map((t) => `${t.modelo} ${t.aprovada ? "✓" : "✕"}`).join(" → ")}
                {resposta.ia.custoUsd > 0 ? ` · US$ ${resposta.ia.custoUsd.toFixed(4)}` : ""}
              </p>
            )}
            {!resposta.ia.usada && resposta.ia.motivo && resposta.confianca !== "alta" && <p className="sub pequeno">IA não usada: {resposta.ia.motivo}.</p>}
            {resposta.duvidas.length > 0 && receita.origem !== "operador" && (
              <ul className="lt-duvidas">{resposta.duvidas.map((d, i) => <li key={i}>{d}</li>)}</ul>
            )}
          </div>

          {leitura && leitura.versoes.versoes.length > 1 && (
            <div className="lt-bloco">
              <h4>Versão dos pontos<Dica>O arquivo traz os mesmos pontos duas vezes: o levantamento (nome começando pelo número, ex.: “3jorge/davino”) e outra solução com um prefixo no nome (ex.: “postp_3jorge/davino”, pós-processado). Só uma versão entra no perímetro, inteira — misturar as duas desenha um polígono errado. A sugerida é a mais completa; empatando, a de melhor precisão.</Dica></h4>
              <div className="lt-opcoes">
                {leitura.versoes.versoes.map((v) => {
                  const sugerida = versaoSugerida === v.chave;
                  return (
                    <label key={v.chave || "levantamento"} className="lt-opcao lt-opcao-versao">
                      <input type="radio" name="versao" checked={leitura.versoes.escolhida === v.chave}
                        onChange={() => { setVersao(v.chave); setConfirmados(new Set()); if (ligacao || incluir.size) aplicar({ ligacao: null, incluir: new Set() }); }} />
                      <span>
                        {v.chave === "" ? "Levantamento" : `“${v.nome}”`} · {v.numeros.length} ponto{v.numeros.length === 1 ? "" : "s"}{sugerida ? " (sugerida)" : ""}
                        <small className="sub">
                          {v.sigmaMediano !== null ? `σ mediano ${v.sigmaMediano < 1 ? `${Math.round(v.sigmaMediano * 100)} cm` : `${v.sigmaMediano.toFixed(2)} m`}` : "sem σ"}
                          {v.faltam.length ? ` · sem ${v.faltam.length > 1 ? "os pontos" : "o ponto"} ${v.faltam.slice(0, 10).join(", ")}${v.faltam.length > 10 ? "…" : ""}` : " · completa"}
                        </small>
                      </span>
                    </label>
                  );
                })}
                <label className="lt-opcao lt-opcao-versao">
                  <input type="radio" name="versao" checked={leitura.versoes.escolhida === VERSAO_TODAS}
                    onChange={() => { setVersao(VERSAO_TODAS); setConfirmados(new Set()); if (ligacao || incluir.size) aplicar({ ligacao: null, incluir: new Set() }); }} />
                  <span>Todos os pontos (não separar)<small className="sub">as versões entram juntas, como pontos diferentes</small></span>
                </label>
              </div>
            </div>
          )}

          {leitura && (leitura.candidatos.length > 1 || ligacao) && (
            <div className="lt-bloco">
              <h4>Ordem dos pontos<Dica>A ordem define o desenho do perímetro. “Automática” escolhe a que não cruza; com duas válidas, a de menor perímetro. “Ligar pontos”, no desenho, define a ordem à mão.</Dica></h4>
              <div className="lt-opcoes">
                {ligacao && (
                  <label className="lt-opcao">
                    <input type="radio" name="ordem" checked readOnly />
                    Ligação feita por você
                    <small className="sub"> {leitura.avisos.some((a) => a.codigo === "desenho_cruza") ? "cruza" : "sem cruzar"}</small>
                  </label>
                )}
                {(["auto", "id", "arquivo"] as const).filter((o) => leitura.candidatos.length > 1 || o === "auto").map((o) => (
                  <label key={o} className="lt-opcao">
                    <input type="radio" name="ordem" checked={!ligacao && ordem === o}
                      onChange={() => { setOrdem(o); setConfirmados(new Set()); if (ligacao) aplicar({ ligacao: null }, "Voltou à ordem automática."); }} />
                    {o === "auto" ? "Automática" : o === "id" ? "Pela numeração" : "Como está no arquivo"}
                    {o !== "auto" && <small className="sub"> {leitura.candidatos.find((c) => c.criterio === o)?.simples ? "sem cruzar" : "cruza"}</small>}
                  </label>
                ))}
              </div>
            </div>
          )}

          {pedemAltura.length > 0 && (
            <div className="lt-bloco" data-testid="altitude-coordenada">
              <h4>Altitude pela coordenada<Dica>O arquivo veio sem a altitude de alguns pontos. O sistema busca a de cada um no modelo digital de terreno pela latitude/longitude (o mesmo do relevo e do loteamento) e, se houver pontos com altitude medida, calibra o modelo por eles (erro típico de 1–4 m; sem nenhum ponto medido sai a cota do terreno, que pode diferir 10–20 m da altitude elipsoidal). Serve para planta, memorial e relevo; para o SIGEF, o ideal é a altitude do receptor.</Dica></h4>
              {buscandoAlt && <p className="sub pequeno"><span className="spinner" /> buscando a altitude de {pedemAltura.length} ponto(s) pela coordenada…</p>}
              {!buscandoAlt && precisaGeo && fusoEsboco === null && (
                <div className="lt-fuso" role="group" aria-label="Fuso para buscar a altitude">
                  <b>Em qual fuso UTM o levantamento foi feito?</b>
                  <span className="sub pequeno">Sem o fuso o sistema não sabe onde fica o imóvel para buscar a altitude.</span>
                  <div className="lt-fuso-opcoes">
                    {fusos.map((f) => (
                      <button key={f.zone} type="button" onClick={() => onEscolherFuso?.(f.zone)}>{f.zone}S — imóvel em {fmtLon(f.lon)}</button>
                    ))}
                  </div>
                </div>
              )}
              {!buscandoAlt && erroAlt && (
                <div className="erro" role="alert">{erroAlt} <button type="button" onClick={() => void buscarAltitudes()}>Tentar de novo</button></div>
              )}
              {!buscandoAlt && !erroAlt && alturaPadrao && (
                <p className="sub pequeno">
                  Altitude preenchida em {Object.keys(alturaPadrao).length} ponto(s){alturas?.est.calibracao !== null && alturas?.est.calibracao !== undefined ? `, calibrada pelos pontos medidos (${alturas.est.calibracao >= 0 ? "+" : ""}${alturas.est.calibracao.toLocaleString("pt-BR")} m)` : " pelo modelo de terreno"}. Confira e marque “conferi” no aviso.
                </p>
              )}
            </div>
          )}

          {semSigma && (
            <div className="lt-bloco">
              <h4>Precisão dos pontos sem σ<Dica>O SIGEF exige a precisão de cada vértice. Se o arquivo não a traz, informe a precisão do método usado (ex.: 0,05 m e 0,08 m para RTK).</Dica></h4>
              <div className="lt-linha-campos">
                <label>σ horizontal (m)<input className="mono" inputMode="decimal" value={sigmaTexto.pos} onChange={(e) => { setSigmaTexto((s) => ({ ...s, pos: e.target.value })); setConfirmados(new Set()); }} placeholder="0,05" /></label>
                <label>σ vertical (m)<input className="mono" inputMode="decimal" value={sigmaTexto.h} onChange={(e) => { setSigmaTexto((s) => ({ ...s, h: e.target.value })); setConfirmados(new Set()); }} placeholder="0,08" /></label>
              </div>
            </div>
          )}

          {leitura && leitura.avisos.length > 0 && (
            <div className="lt-bloco">
              <h4>Avisos</h4>
              <ul className="lt-avisos">
                {leitura.avisos.map((a, i) => {
                  const confirmar = leitura.aConfirmar.includes(a.codigo);
                  return (
                    <li key={`${a.codigo}-${i}`} className={`lt-aviso lt-${a.nivel}`}>
                      <span>{a.mensagem}{a.linhas?.length ? <small className="sub"> · linha{a.linhas.length > 1 ? "s" : ""} {a.linhas.slice(0, 12).join(", ")}{a.linhas.length > 12 ? "…" : ""}</small> : null}</span>
                      {confirmar && (
                        <label className="lt-conferi">
                          <input type="checkbox" checked={confirmados.has(a.codigo)}
                            onChange={(e) => setConfirmados((s) => { const n = new Set(s); if (e.target.checked) n.add(a.codigo); else n.delete(a.codigo); return n; })} />
                          conferi
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* ---- tabela do arquivo ---- */}
      {(ajustar || !leitura?.ok) && (
        <section className="lt-tabela-bloco">
          <h4>O arquivo, linha a linha<Dica>Cada coluna tem um papel. Troque o papel no topo da coluna se a leitura estiver errada — o desenho e os avisos se atualizam na hora. Linhas riscadas não são pontos (o motivo aparece ao passar o mouse).</Dica></h4>
          {tabular && (
            <div className="lt-linha-campos lt-controles">
              <label>Separador
                <select value={receita.tokenizacao === "espacos" ? "espacos" : receita.tokenizacao === "regex" ? "regex" : receita.tokenizacao === "largura_fixa" ? "largura_fixa" : receita.delimitador ?? ";"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "regex" || v === "largura_fixa") return; // modos da IA: só se sai deles escolhendo um separador
                    editar(v === "espacos"
                      ? { tokenizacao: "espacos", delimitador: null, colunas: null, excedente_em: null, regex: null, cortes: null }
                      : { tokenizacao: "delimitado", delimitador: v, colunas: null, excedente_em: null, regex: null, cortes: null, ...(v === "," ? { decimal: "." } : {}) });
                  }}>
                  {receita.tokenizacao === "regex" && <option value="regex">padrão de texto (lido pela IA)</option>}
                  {receita.tokenizacao === "largura_fixa" && <option value="largura_fixa">colunas de largura fixa</option>}
                  {SEPARADORES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
                </select>
              </label>
              <label>Decimal
                <select value={receita.decimal} onChange={(e) => editar({ decimal: e.target.value as "," | "." })}>
                  <option value=",">vírgula (1.234,56)</option><option value=".">ponto (1234.56)</option>
                </select>
              </label>
              <label>Pular no topo
                <input type="number" min={0} max={linhas.length} value={receita.pular_inicio} onChange={(e) => editar({ pular_inicio: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
              <label>Precisões em
                <select value={receita.unidade_sigma} onChange={(e) => editar({ unidade_sigma: e.target.value as "m" | "cm" | "mm" })}>
                  <option value="m">metros</option><option value="cm">centímetros</option><option value="mm">milímetros</option>
                </select>
              </label>
              <label>Nome do ponto
                <select value={receita.nome_formato} onChange={(e) => editar({ nome_formato: e.target.value as Receita["nome_formato"] })}>
                  <option value="numero_e_rotulo">número + rótulo colado</option><option value="texto">nome inteiro</option>
                </select>
              </label>
            </div>
          )}
          <TabelaArquivo linhas={linhas} receita={receita} leitura={leitura} verTodas={verTodas} tabular={tabular} onPapel={definirPapel} />
          {linhas.length > 300 && <button type="button" className="fantasma" onClick={() => setVerTodas((v) => !v)}>{verTodas ? "mostrar só as primeiras 300 linhas" : `mostrar as ${linhas.length} linhas`}</button>}
        </section>
      )}

      {erro && <div className="erro" role="alert">{erro}</div>}
      <div className="lt-rodape">
        <button type="button" className="fantasma voltar-para" onClick={onTrocarArquivo} disabled={criando}>← Trocar arquivo</button>
        <span className="esticar" />
        {modo.t !== "ver" && <span className="sub pequeno">conclua ou cancele a {modo.t === "ligar" ? "ligação" : "escolha do lado"} para seguir</span>}
        {modo.t === "ver" && faltaConfirmar.length > 0 && leitura?.ok && <span className="sub pequeno">marque “conferi” nos avisos destacados para seguir</span>}
        {modo.t === "ver" && !faltaConfirmar.length && leitura?.ok && (
          <span className="lt-resumo-final">
            {leitura.anel.length} pontos{leitura.blocos.length > 1 ? ` · ${leitura.blocos.length} partes` : ""}{medidas ? ` · ${fmtArea(medidas.areaHa)}` : ""}
            <span className="lt-chip-credito" title="Até aqui nada foi cobrado. O crédito é descontado quando o serviço é criado.">1 crédito ao prosseguir</span>
          </span>
        )}
        <button type="button" className="principal lt-prosseguir" disabled={!pode} onClick={prosseguir}>
          {criando ? "Criando o serviço…" : "Prosseguir →"}
        </button>
      </div>

      {ampliado && esboco && (
        <div className="lt-luz" role="dialog" aria-modal="true" aria-label="Esboço ampliado" onClick={() => setAmpliado(false)}>
          <img src={esboco.e.url} alt="Esboço ampliado" />
          <div className="lt-luz-acoes" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="principal" onClick={baixar} disabled={desatualizado}>Baixar imagem (PNG)</button>
            <button type="button" onClick={() => setAmpliado(false)}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra de ajustes (acima do desenho)
// ---------------------------------------------------------------------------

function BarraAjustes(p: {
  modo: Modo; sel: PontoLido | null; situacao: Situacao | null; podeAjustar: boolean; precisaServidor: boolean;
  ordemPerimetro: number; totalPerimetro: number; podeDesfazer: boolean; temLigacao: boolean; ajustesFeitos: number;
  onLigar: () => void; onDesfazer: () => void; onAutomatica: () => void; onRestaurar: () => void;
  onDesativar: () => void; onAtivar: () => void; onLigarSolto: () => void; onEncaixar: () => void; onFecharSel: () => void;
  onDesfazerPonto: () => void; onConcluir: () => void; onCancelar: () => void;
}) {
  const semServidor = "Disponível quando o servidor do sistema for atualizado.";
  if (p.modo.t === "ligar") {
    const partes = p.modo.partes;
    const aberta = p.modo.aberta ? partes[partes.length - 1] : null;
    return (
      <div className="lt-barra lt-barra-modo" role="toolbar" aria-label="Ligar pontos">
        <span className="lt-barra-texto">
          <b>Ligando os pontos</b>
          <span className="sub pequeno">
            {aberta ? `parte ${partes.length}: ${aberta.length} ponto(s)${aberta.length >= 3 ? " — clique no primeiro para fechar" : ""}`
              : partes.length ? `${partes.length} parte(s) fechada(s) — clique num ponto para começar outra` : "clique no primeiro ponto do perímetro"}
          </span>
        </span>
        <span className="esticar" />
        <button type="button" onClick={p.onDesfazerPonto} disabled={!partes.length}>Desfazer ponto</button>
        <button type="button" className="fantasma" onClick={p.onCancelar}>Cancelar</button>
        <button type="button" className="principal" onClick={p.onConcluir} disabled={!partes.length || (partes.length === 1 && partes[0].length < 3)}>Concluir ligação</button>
      </div>
    );
  }
  if (p.modo.t === "encaixar") {
    return (
      <div className="lt-barra lt-barra-modo" role="toolbar" aria-label="Encaixar ponto">
        <span className="lt-barra-texto"><b>Clique no lado onde o ponto deve entrar</b><span className="sub pequeno">os lados ficam destacados ao passar o mouse</span></span>
        <span className="esticar" />
        <button type="button" className="fantasma" onClick={p.onCancelar}>Cancelar</button>
      </div>
    );
  }
  const geral = (
    <div className="lt-barra" role="toolbar" aria-label="Ajustes de pontos">
      <span className="lt-barra-texto">
        <b>Ajustar pontos<Dica lado="baixo">Clique num ponto (no desenho ou na lista) para desativar, ativar um inativo ou encaixá-lo em outro lado. “Ligar pontos” refaz a ordem do perímetro: clique nos pontos em sequência e no primeiro para fechar; dá para fazer mais de uma parte. Role o mouse sobre o desenho para aproximar pontos colados. Delete desativa o ponto escolhido; Ctrl+Z desfaz.</Dica></b>
      </span>
      <span className="esticar" />
      <button type="button" onClick={p.onLigar} disabled={!p.podeAjustar} title={p.podeAjustar ? "Defina a ordem do perímetro clicando nos pontos" : semServidor}>Ligar pontos</button>
      {p.temLigacao && <button type="button" className="fantasma" onClick={p.onAutomatica}>Ordem automática</button>}
      <button type="button" className="fantasma" onClick={p.onDesfazer} disabled={!p.podeDesfazer} title="Ctrl+Z">Desfazer</button>
      {p.ajustesFeitos > 0 && <button type="button" className="fantasma" onClick={p.onRestaurar}>Restaurar leitura</button>}
    </div>
  );
  if (p.sel && p.situacao) {
    const s = p.situacao;
    return (
      <>
      {geral}
      <div className="lt-barra lt-barra-sel" role="toolbar" aria-label={`Ponto ${p.sel.nome}`}>
        <span className={`lt-sel-sinal lt-s-${s}`} aria-hidden />
        <span className="lt-barra-texto">
          <b>Ponto {p.sel.nome || `(linha ${p.sel.linha})`}{s === "vertice" && p.ordemPerimetro >= 0 ? <small className="sub"> · vértice {p.ordemPerimetro + 1} de {p.totalPerimetro}</small> : <small className="sub"> · {NOME_SITUACAO[s]}</small>}</b>
          <span className="sub pequeno mono">E {fmtCoord(p.sel.e)} · N {fmtCoord(p.sel.n)}{p.sel.h !== null ? ` · h ${fmtCoord(p.sel.h)}` : ""} · linha {p.sel.linha}</span>
        </span>
        <span className="esticar" />
        {s === "vertice" && <button type="button" onClick={p.onDesativar} title="Tecla Delete">Desativar</button>}
        {(s === "excluido" || s === "apoio" || s === "versao") && (
          <button type="button" className="principal" onClick={p.onAtivar} disabled={p.precisaServidor} title={p.precisaServidor ? semServidor : undefined}>Ativar</button>
        )}
        {s === "solto" && <button type="button" className="principal" onClick={p.onLigarSolto}>Ligar ao perímetro</button>}
        {s !== "repetido" && (
          <button type="button" onClick={p.onEncaixar} disabled={!p.podeAjustar} title={p.podeAjustar ? "Escolha o lado do desenho em que este ponto entra" : semServidor}>Encaixar em outro lado</button>
        )}
        <button type="button" className="fantasma lt-x" onClick={p.onFecharSel} aria-label="Fechar">×</button>
      </div>
      </>
    );
  }
  return geral;
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

type Vista = [number, number, number, number];

function MapaAjuste({ leitura, situacao, selecionado, modo, onPonto, onLado }: {
  leitura: Leitura; situacao: (p: PontoLido) => Situacao; selecionado: number | null; modo: Modo;
  onPonto: (idx: number) => void; onLado: (a: number, b: number) => void;
}) {
  const L = 1000, A = 640, M = 28;
  // ---- zoom (roda do mouse) e arraste: pontos colados só se separam de perto ----
  const svgRef = useRef<SVGSVGElement>(null);
  const [vista, setVista] = useState<Vista>([0, 0, L, A]);
  const arraste = useRef<{ x: number; y: number; v: Vista; moveu: boolean; id: number } | null>(null);
  const acabouDeArrastar = useRef(false);
  const limitar = ([vx, vy, vw, vh]: Vista): Vista => [Math.min(Math.max(vx, -vw * 0.5), L - vw * 0.5), Math.min(Math.max(vy, -vh * 0.5), A - vh * 0.5), vw, vh];
  const zoom = (f: number, cx = 0.5, cy = 0.5) => setVista(([vx, vy, vw, vh]) => {
    const nw = Math.min(L, Math.max(L / 60, vw * f)), nh = (nw * A) / L;
    const px = vx + cx * vw, py = vy + cy * vh;
    return nw >= L ? [0, 0, L, A] : limitar([px - (px - vx) * (nw / vw), py - (py - vy) * (nh / vh), nw, nh]);
  });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const roda = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = el.getBoundingClientRect();
      zoom(Math.exp(ev.deltaY * 0.0016), (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
    };
    el.addEventListener("wheel", roda, { passive: false });
    return () => el.removeEventListener("wheel", roda);
  });
  // pinça no celular: dois dedos aproximam e arrastam (lib/pinca.ts)
  usePinca(svgRef, {
    zoom: (f, x, y) => {
      const r = svgRef.current!.getBoundingClientRect();
      zoom(1 / f, x / (r.width || 1), y / (r.height || 1));
    },
    mover: (dx, dy) => setVista((v) => {
      const r = svgRef.current!.getBoundingClientRect();
      return limitar([v[0] - (dx / (r.width || 1)) * v[2], v[1] - (dy / (r.height || 1)) * v[3], v[2], v[3]]);
    }),
    cancelar: () => { arraste.current = null; acabouDeArrastar.current = true; setTimeout(() => { acabouDeArrastar.current = false; }, 400); },
  });
  const pts = leitura.pontos.filter((p) => Number.isFinite(p.e) && Number.isFinite(p.n));
  if (!pts.length) return <div className="lt-vazio">Sem coordenadas para desenhar.</div>;
  const k = vista[2] / L; // tamanhos fixos na tela, qualquer que seja o zoom
  const clicar = (f: () => void) => () => { if (!acabouDeArrastar.current) f(); };
  const minE = Math.min(...pts.map((p) => p.e)), maxE = Math.max(...pts.map((p) => p.e));
  const minN = Math.min(...pts.map((p) => p.n)), maxN = Math.max(...pts.map((p) => p.n));
  const esc = Math.min((L - 2 * M) / Math.max(maxE - minE, 1e-6), (A - 2 * M) / Math.max(maxN - minN, 1e-6));
  const ox = (L - (maxE - minE) * esc) / 2, oy = (A - (maxN - minN) * esc) / 2;
  const x = (e: number) => ox + (e - minE) * esc;
  const y = (n: number) => A - (oy + (n - minN) * esc);
  const partes = leitura.blocos.map((b) => b.map((k) => leitura.anel[k]));
  const rotular = pts.length <= 160 || k < 0.4;
  const porIdx = new Map(leitura.pontos.map((p) => [p.idx, p]));
  const doAnel = new Map(leitura.anel.map((a) => [a.idx, a]));
  // posição de cada ponto na ligação em andamento (o número aparece no ponto)
  const ordemLigando = new Map<number, string>();
  if (modo.t === "ligar") modo.partes.forEach((parte, k) => parte.forEach((idx, i) => ordemLigando.set(idx, modo.partes.length > 1 ? `${k + 1}.${i + 1}` : String(i + 1))));
  const ligando = modo.t === "ligar";
  const encaixando = modo.t === "encaixar";
  return (
    <div className="lt-mapa-area">
    <svg ref={svgRef} viewBox={vista.join(" ")} className={`lt-svg${ligando ? " lt-svg-ligando" : ""}${encaixando ? " lt-svg-encaixando" : ""}${vista[2] < L ? " lt-svg-zoom" : ""}`} role="img" aria-label={`Perímetro com ${leitura.anel.length} pontos`}
      onPointerDown={(e) => { if (e.button === 0) arraste.current = { x: e.clientX, y: e.clientY, v: vista, moveu: false, id: e.pointerId }; }}
      onPointerMove={(e) => {
        const a = arraste.current;
        if (!a || !svgRef.current) return;
        const dx = e.clientX - a.x, dy = e.clientY - a.y;
        if (!a.moveu && Math.hypot(dx, dy) < 5) return;
        if (!a.moveu) { a.moveu = true; svgRef.current.setPointerCapture(a.id); }
        const r = svgRef.current.getBoundingClientRect();
        setVista(limitar([a.v[0] - (dx / r.width) * a.v[2], a.v[1] - (dy / r.height) * a.v[3], a.v[2], a.v[3]]));
      }}
      onPointerUp={() => {
        // o clique que vem logo depois de um arraste não seleciona ponto
        if (arraste.current?.moveu) { acabouDeArrastar.current = true; setTimeout(() => { acabouDeArrastar.current = false; }, 0); }
        arraste.current = null;
      }}>
      {partes.map((parte, k) => {
        const cr = cruzamentos(parte);
        const ruins = new Set(cr.flatMap(([i, j]) => [i, j]));
        return (
          <g key={k} className={ligando ? "lt-apagado" : undefined}>
            <polygon points={parte.map((p) => `${x(p.e)},${y(p.n)}`).join(" ")} className="lt-poligono" vectorEffect="non-scaling-stroke" />
            {parte.map((p, i) => ruins.has(i) && (
              <line key={i} x1={x(p.e)} y1={y(p.n)} x2={x(parte[(i + 1) % parte.length].e)} y2={y(parte[(i + 1) % parte.length].n)} className="lt-cruza" vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        );
      })}
      {/* lados clicáveis (encaixar um ponto entre dois vértices) */}
      {encaixando && partes.map((parte, kp) => parte.map((p, i) => {
        const q = parte[(i + 1) % parte.length];
        if (modo.t === "encaixar" && (p.idx === modo.idx || q.idx === modo.idx)) return null;
        return (
          <line key={`l${kp}-${i}`} x1={x(p.e)} y1={y(p.n)} x2={x(q.e)} y2={y(q.n)} className="lt-lado-alvo" vectorEffect="non-scaling-stroke"
            onClick={clicar(() => onLado(p.idx, q.idx))}>
            <title>{`Encaixar entre ${p.nome || p.num} e ${q.nome || q.num}`}</title>
          </line>
        );
      }))}
      {/* ligação em andamento */}
      {ligando && modo.partes.map((parte, kp) => {
        const fechada = !modo.aberta || kp < modo.partes.length - 1;
        const coords = parte.map((idx) => porIdx.get(idx)!).filter(Boolean).map((p) => `${x(p.e)},${y(p.n)}`).join(" ");
        return fechada && parte.length >= 3
          ? <polygon key={`r${kp}`} points={coords} className="lt-rascunho fechado" vectorEffect="non-scaling-stroke" />
          : <polyline key={`r${kp}`} points={coords} className="lt-rascunho" vectorEffect="non-scaling-stroke" />;
      })}
      {/* camada 1: áreas de clique (maiores que o ponto) — todas por baixo, para
          que, com dois pontos colados, o ponto VISÍVEL ganhe o clique */}
      {pts.map((p) => {
        const s = situacao(p);
        const clicavel = s !== "repetido" && !encaixando;
        return clicavel && (
          <circle key={`a${p.idx}`} cx={x(p.e)} cy={y(p.n)} r={10 * k} className="lt-alvo" onClick={clicar(() => onPonto(p.idx))} />
        );
      })}
      {/* camada 2: os pontos e os nomes */}
      {pts.map((p) => {
        const s = situacao(p);
        const cls = s === "vertice" ? "lt-p" : s === "apoio" ? "lt-p-apoio" : s === "versao" ? "lt-p-versao" : s === "solto" ? "lt-p-solto" : "lt-p-excluido";
        const noAnel = s === "vertice" ? doAnel.get(p.idx) : null;
        const escolhido = selecionado === p.idx || (modo.t === "encaixar" && modo.idx === p.idx);
        const numLigacao = ordemLigando.get(p.idx);
        const clicavel = s !== "repetido" && !encaixando;
        const dica = `${p.nome || "(sem nome)"} · linha ${p.linha}
E ${p.e.toFixed(3)}  N ${p.n.toFixed(3)}${p.h !== null ? `  h ${p.h}` : ""}
${NOME_SITUACAO[s]}${clicavel ? (ligando ? " — clique para ligar" : " — clique para ajustar") : ""}`;
        return (
          <g key={`${p.linha}-${p.idx}`} className={`lt-ponto${clicavel ? "" : " lt-ponto-fixo"}${escolhido ? " escolhido" : ""}`} data-ponto={p.idx}
            onClick={clicar(() => clicavel && onPonto(p.idx))}>
            <title>{dica}</title>
            {escolhido && <circle cx={x(p.e)} cy={y(p.n)} r={11 * k} className="lt-anel-sel" vectorEffect="non-scaling-stroke" />}
            {p.apoio && s === "apoio"
              ? <rect x={x(p.e) - 5 * k} y={y(p.n) - 5 * k} width={10 * k} height={10 * k} className={`${cls} lt-ponto-desenho`} vectorEffect="non-scaling-stroke" />
              : <circle cx={x(p.e)} cy={y(p.n)} r={(s === "vertice" ? 4.5 : 5) * k} className={`${cls} lt-ponto-desenho`} vectorEffect="non-scaling-stroke" />}
            {numLigacao && <text x={x(p.e)} y={y(p.n) + 18 * k} className="lt-num-ligacao" style={{ fontSize: 11 * k, strokeWidth: 3 * k }}>{numLigacao}</text>}
            {rotular && !numLigacao && <text x={x(p.e) + 6 * k} y={y(p.n) - 6 * k} className="lt-rotulo" style={{ fontSize: 11 * k, strokeWidth: 3 * k }}>{noAnel ? noAnel.nome || noAnel.num : p.nome}</text>}
          </g>
        );
      })}
    </svg>
    <div className="lt-zoom" role="group" aria-label="Zoom do desenho">
      <button type="button" onClick={() => zoom(0.6)} aria-label="Aproximar" title="Aproximar (ou role o mouse sobre o desenho)">+</button>
      <button type="button" onClick={() => zoom(1 / 0.6)} aria-label="Afastar" disabled={vista[2] >= L}>−</button>
      {vista[2] < L && <button type="button" className="lt-zoom-ajustar" onClick={() => setVista([0, 0, L, A])}>Ajustar</button>}
    </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista de pontos (conferir um a um)
// ---------------------------------------------------------------------------

function ListaPontos({ leitura, situacao, selecionado, onSelecionar, onDesativar, onAtivar, onLigarSolto, precisaServidor, ocupado, ordemLigando }: {
  leitura: Leitura; situacao: (p: PontoLido) => Situacao; selecionado: number | null; ocupado: boolean;
  /** ligação em andamento (a linha mostra o número na sequência) */
  ordemLigando: number[][] | null;
  onSelecionar: (idx: number) => void; onDesativar: (p: PontoLido) => void; onAtivar: (p: PontoLido) => void; onLigarSolto: (p: PontoLido) => void;
  precisaServidor: (p: PontoLido) => boolean;
}) {
  const [aberta, setAberta] = useState(true);
  const linhaSel = useRef<HTMLTableRowElement>(null);
  useEffect(() => { linhaSel.current?.scrollIntoView({ block: "nearest" }); }, [selecionado]);
  // perímetro na ordem do desenho; depois os que estão fora
  const posNoAnel = new Map(leitura.anel.map((p, i) => [p.idx, i]));
  const partes = leitura.blocos.length;
  const parteDe = new Map<number, number>();
  leitura.blocos.forEach((b, k) => b.forEach((pos) => parteDe.set(leitura.anel[pos].idx, k)));
  const linhas = [...leitura.pontos].sort((a, b) => (posNoAnel.get(a.idx) ?? 1e9 + a.idx) - (posNoAnel.get(b.idx) ?? 1e9 + b.idx));
  const fora = linhas.filter((p) => !posNoAnel.has(p.idx)).length;
  return (
    <section className="lt-pontos">
      <button type="button" className="lt-pontos-topo" onClick={() => setAberta((v) => !v)} aria-expanded={aberta}>
        <b>Pontos</b>
        <span className="sub pequeno">{leitura.anel.length} no perímetro{fora ? ` · ${fora} fora` : ""}</span>
        <span className="esticar" />
        <span className="sub pequeno">{aberta ? "ocultar" : "mostrar"}</span>
      </button>
      {aberta && (
        <div className="lt-pontos-rolagem">
          <table className="lt-pontos-tabela">
            <thead><tr><th>#</th><th>Ponto</th><th>E</th><th>N</th><th>Situação</th><th aria-label="Ação" /></tr></thead>
            <tbody>
              {linhas.map((p) => {
                const s = situacao(p);
                const pos = posNoAnel.get(p.idx);
                return (
                  <tr key={`${p.linha}-${p.idx}`} ref={selecionado === p.idx ? linhaSel : undefined}
                    className={`${selecionado === p.idx ? "sel " : ""}${inativo(s) || s === "repetido" ? "fora" : ""}`}
                    onClick={() => s !== "repetido" && onSelecionar(p.idx)}>
                    <td className="lt-n">{pos !== undefined ? (partes > 1 ? `${(parteDe.get(p.idx) ?? 0) + 1}.${pos + 1}` : pos + 1) : "—"}</td>
                    <td><b>{p.nome || "—"}</b></td>
                    <td className="mono">{fmtCoord(p.e)}</td>
                    <td className="mono">{fmtCoord(p.n)}</td>
                    <td>{ordemLigando?.some((pt) => pt.includes(p.idx))
                      ? <span className="lt-sit lt-s-ligando">ligado · {ordemLigando.findIndex((pt) => pt.includes(p.idx)) + 1}.{ordemLigando.find((pt) => pt.includes(p.idx))!.indexOf(p.idx) + 1}</span>
                      : <span className={`lt-sit lt-s-${s}`}>{NOME_SITUACAO[s]}</span>}</td>
                    <td className="lt-acao" onClick={(e) => e.stopPropagation()}>
                      {s === "vertice" && <button type="button" className="mini" disabled={ocupado} onClick={() => onDesativar(p)}>Desativar</button>}
                      {(s === "excluido" || s === "apoio" || s === "versao") && (
                        <button type="button" className="mini" disabled={ocupado || precisaServidor(p)} onClick={() => onAtivar(p)}
                          title={precisaServidor(p) ? "Disponível quando o servidor do sistema for atualizado." : undefined}>Ativar</button>
                      )}
                      {s === "solto" && <button type="button" className="mini" disabled={ocupado} onClick={() => onLigarSolto(p)}>Ligar</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------

function TabelaArquivo({ linhas, receita, leitura, verTodas, tabular, onPapel }: {
  linhas: string[]; receita: Receita; leitura: Leitura | null; verTodas: boolean; tabular: boolean;
  onPapel: (coluna: number, papel: Papel | "") => void;
}) {
  const status = useMemo(() => {
    const m = new Map<number, { tipo: string; motivo: string }>();
    for (const p of leitura?.pontos ?? []) m.set(p.linha, { tipo: p.apoio ? "apoio" : "ponto", motivo: p.apoio ? "ponto de apoio (fora do perímetro)" : `ponto ${p.nome}` });
    for (const i of leitura?.ignoradas ?? []) if (!m.has(i.linha) || i.tipo === "excluido" || i.tipo === "repetido" || i.tipo === "versao" || i.tipo === "ligacao") m.set(i.linha, { tipo: i.tipo, motivo: i.motivo });
    return m;
  }, [leitura]);
  const mostradas = linhas.map((t, i) => ({ t, n: i + 1 })).filter((x) => x.t.trim()).slice(0, verTodas ? undefined : 300);
  const quebrar = (t: string) => (receita.tokenizacao === "espacos" ? dividirEspacos(t) : receita.tokenizacao === "delimitado" && receita.delimitador ? dividirDelimitado(t, receita.delimitador) : [t]);
  const celulas = tabular && receita.tokenizacao !== "regex" && receita.tokenizacao !== "largura_fixa" ? mostradas.map((x) => quebrar(x.t)) : null;
  const k = celulas ? Math.min(40, Math.max(receita.colunas ?? 0, ...celulas.map((c) => c.length))) : 0;
  const papelDa = (j: number) => (PAPEIS.find((p) => receita.campos[p] === j) ?? "") as Papel | "";
  return (
    <div className="lt-tabela-rolagem">
      <table className="lt-tabela">
        {celulas && (
          <thead>
            <tr>
              <th className="lt-n">linha</th>
              {Array.from({ length: k }, (_, j) => (
                <th key={j}>
                  <select value={papelDa(j)} onChange={(e) => onPapel(j, e.target.value as Papel | "")} aria-label={`Papel da coluna ${j + 1}`} className={papelDa(j) ? "lt-papel-ativo" : ""}>
                    <option value="">— ignorar —</option>
                    {PAPEIS.map((p) => <option key={p} value={p}>{NOME_PAPEL[p]}</option>)}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {mostradas.map((x, r) => {
            const s = status.get(x.n);
            const cls = !s ? "lt-l-solta" : s.tipo === "ponto" ? "" : s.tipo === "apoio" ? "lt-l-apoio" : s.tipo === "ilegivel" ? "lt-l-ilegivel" : "lt-l-ignorada";
            return (
              <tr key={x.n} className={cls} title={s?.motivo ?? "linha sem explicação"}>
                <td className="lt-n">{x.n}</td>
                {celulas
                  ? Array.from({ length: k }, (_, j) => <td key={j} className={papelDa(j) ? "lt-c-papel" : ""}>{celulas[r][j] ?? ""}</td>)
                  : <td className="lt-c-texto">{x.t}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
