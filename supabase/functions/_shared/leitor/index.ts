// Leitor universal de arquivos de pontos — orquestração.
//
//   linhas ─▶ receita (perfil salvo │ formato padrão │ detector │ IA │ operador)
//          ─▶ executor (copia os números do arquivo) ─▶ apoio/repetidos/ordem
//          ─▶ validador (procedência, cobertura, faixas, geometria) ─▶ Leitura
//
// Código puro: roda igual no navegador (prévia instantânea) e na Edge Function
// (fonte da verdade, que reexecuta a receita confirmada antes de gravar).
import type { Proj4 } from "../geo.ts";
import { mapearTabela, tabelaDeLinhas } from "./executor.ts";
import type { Aviso, LinhaIgnorada, PontoLido, Tabela } from "./executor.ts";
import { marcarApoio, montarAnel } from "./ordem.ts";
import { separarVersoes } from "./versoes.ts";
import type { ResultadoVersoes } from "./versoes.ts";
import { validar } from "./validador.ts";
import { receitaPadrao, validarReceita } from "./receita.ts";
import type { Receita } from "./receita.ts";
import { detectar } from "./detector.ts";
import type { Confianca } from "./detector.ts";
import { assinatura } from "./assinatura.ts";
import { formatoEspecial, receitaEspecial, tabelaDoFormato } from "./formatos.ts";

export type { Receita } from "./receita.ts";
export type { Aviso, LinhaIgnorada, PontoLido } from "./executor.ts";
export type { ResultadoVersoes, Versao } from "./versoes.ts";

export interface OpcoesLeitura {
  proj4: Proj4;
  /** Ordem pedida na prévia (padrão: a da receita). */
  ordem?: "auto" | "id" | "arquivo";
  /** Linhas que o operador excluiu na prévia. */
  excluir?: number[];
  /** Precisão declarada pelo operador para pontos sem σ no arquivo. */
  sigmaPadrao?: { pos: number; h: number } | null;
  /** Versão dos pontos escolhida na prévia ("" = levantamento, "postp_"…);
   *  ausente = automática (a mais completa). Ver versoes.ts. */
  versao?: string | null;
  /** Linhas de pontos inativos (apoio, outra versão) ativadas na prévia. */
  incluir?: number[];
  /** Ligação dos pontos feita à mão na prévia: partes × `idx` dos pontos, na
   *  ordem do perímetro (ver ordem.ts). Ausente/null = ordem automática. */
  ligacao?: number[][] | null;
}

/** Ponto do perímetro, pronto para o parse-txt (formato de `PontoTxt` + origem). */
export interface PontoAnel {
  num: number;
  numSintetico: boolean;
  nome: string;
  rotulo: string | null;
  e: number;
  n: number;
  h: number;
  sigmaPos: number;
  sigmaH: number;
  linha: number;
  /** Índice do ponto lido (`PontoLido.idx`): é por ele que a ligação manual se refere. */
  idx: number;
  sigmaDeclarado: boolean;
}

export interface Leitura {
  /** Sem bloqueio: pode criar o serviço (depois das confirmações). */
  ok: boolean;
  receita: Receita;
  /** Quão certa está a receita (perfil e padrão contam como "alta"). */
  confianca: Confianca;
  duvidas: string[];
  pontos: PontoLido[];
  anel: PontoAnel[];
  /** Posições em `anel` de cada parte do imóvel. */
  blocos: number[][];
  criterio: "id" | "arquivo" | "ligacao";
  candidatos: { criterio: "id" | "arquivo" | "ligacao"; simples: boolean; cruzamentos: number }[];
  ignoradas: LinhaIgnorada[];
  avisos: Aviso[];
  /** Avisos que o operador precisa confirmar com um clique antes de seguir. */
  aConfirmar: string[];
  /** Versões dos mesmos pontos no arquivo (vazio quando há uma só). */
  versoes: ResultadoVersoes;
  fusoGeo: number | null;
  assinatura: string;
  totalLinhas: number;
}

/** Avisos de alerta que exigem confirmação explícita (nunca seguem calados). */
export const AVISOS_A_CONFIRMAR = new Set([
  "desenho_cruza", "linhas_ilegiveis", "V5_utm_geo", "lat_sem_sinal", "sigma_95", "apoio_fora", "ordem_do_arquivo", "ordem_ambigua", "texto_livre", "dxf_nomes_por_texto", "dxf_nomes_ambiguos", "gpx_trilha", "receita_ia", "receita_operador",
  "versoes", "versao_incompleta", "fora_da_ligacao",
]);

/** Avisos que tiram a confiança "alta" da leitura (dedução, não leitura direta). */
const AVISOS_DE_DUVIDA = new Set(["dxf_nomes_ambiguos", "texto_livre"]);

/** Tabela de células de qualquer registro. */
function tabelaDe(linhas: string[], r: Receita): { tabela: Tabela; semCobertura: boolean; consumidas?: Set<number> } {
  if (r.registro === "linha" || r.registro === "planilha") return { tabela: tabelaDeLinhas(linhas, r), semCobertura: false };
  return tabelaDoFormato(linhas, r);
}

/** Executa uma receita (já validada) e devolve a leitura completa. */
export function executarReceita(linhas: string[], receita: Receita, op: OpcoesLeitura, confianca: Confianca = "alta", duvidas: string[] = []): Leitura {
  const { tabela, semCobertura, consumidas } = tabelaDe(linhas, receita);
  const exec = mapearTabela(tabela, receita, op.proj4);
  marcarApoio(exec.pontos, receita.apoio);
  // o mesmo ponto em duas soluções (levantamento × "postp_"): entra UMA versão inteira
  const versoes = separarVersoes(exec.pontos, op.versao, receita.nome_formato === "numero_e_rotulo");

  // σ declarado pelo operador para quem veio sem precisão
  const sigmaDeclarado = new Set<number>();
  if (op.sigmaPadrao && op.sigmaPadrao.pos > 0 && op.sigmaPadrao.h > 0) {
    for (const p of exec.pontos) {
      if (p.sigmaPos === null) { p.sigmaPos = op.sigmaPadrao.pos; sigmaDeclarado.add(p.idx); }
      if (p.sigmaH === null) { p.sigmaH = op.sigmaPadrao.h; sigmaDeclarado.add(p.idx); }
    }
  }

  const ordem = montarAnel(exec.pontos, op.ordem ?? receita.ordem, new Set(op.excluir ?? []), { incluir: new Set(op.incluir ?? []), ligacao: op.ligacao ?? null });
  const ignoradas = [...exec.ignoradas, ...ordem.ignoradas];
  const validacao = validar({
    linhas, receita, pontos: exec.pontos, anel: ordem.anel, blocos: ordem.blocos, ignoradas,
    semCobertura, consumidas, proj4: op.proj4,
  });
  const avisos = [...exec.avisos, ...versoes.avisos, ...ordem.avisos, ...validacao];
  if (receita.origem.startsWith("ia:")) {
    avisos.push({
      codigo: "receita_ia", nivel: "alerta",
      mensagem: "Formato novo, interpretado pela IA (veja “Como entendemos”). Confira a tabela e o desenho antes de seguir — na próxima vez, este formato já será reconhecido sozinho.",
    });
  }
  if (sigmaDeclarado.size) {
    avisos.push({ codigo: "sigma_declarado", nivel: "info", mensagem: `Precisão declarada na prévia (${op.sigmaPadrao!.pos} m / ${op.sigmaPadrao!.h} m) aplicada a ${sigmaDeclarado.size} ponto(s) que vieram sem σ.` });
  }
  const ok = !avisos.some((a) => a.nivel === "bloqueio");
  // leituras que dependem de dedução (nome pelo texto vizinho, texto corrido) nunca são "alta"
  for (const a of avisos) {
    if (AVISOS_DE_DUVIDA.has(a.codigo) && confianca === "alta") { confianca = "media"; duvidas = [...duvidas, a.mensagem]; }
  }
  const anel: PontoAnel[] = ordem.anel.map((i) => {
    const p = exec.pontos[i];
    const nn = ordem.numeros.get(i)!;
    return {
      num: nn.num, numSintetico: nn.sintetico, nome: p.nome, rotulo: p.rotulo,
      e: p.e, n: p.n, h: p.h as number, sigmaPos: p.sigmaPos as number, sigmaH: p.sigmaH as number,
      linha: p.linha, idx: p.idx, sigmaDeclarado: sigmaDeclarado.has(i),
    };
  });
  return {
    ok, receita, confianca, duvidas,
    pontos: exec.pontos, anel, blocos: ordem.blocos, criterio: ordem.criterio,
    candidatos: ordem.candidatos.map((c) => ({ criterio: c.criterio, simples: c.simples, cruzamentos: c.cruzamentos.reduce((s, x) => s + x.length, 0) })),
    ignoradas, avisos,
    aConfirmar: [...new Set(avisos.filter((a) => a.nivel === "alerta" && AVISOS_A_CONFIRMAR.has(a.codigo)).map((a) => a.codigo))],
    versoes,
    fusoGeo: exec.fusoGeo,
    assinatura: assinatura(linhas, receita),
    totalLinhas: linhas.length,
  };
}

export interface PerfilSalvo { id: string; assinatura: string; receita: unknown; nome?: string | null }

/** A leitura do formato de sempre passa inteira, sem nenhuma linha de fora? */
function lerComoPadrao(linhas: string[], op: OpcoesLeitura): Leitura | null {
  const primeira = linhas.find((l) => l.trim());
  if (!primeira) return null;
  const r = receitaPadrao(primeira.includes(";") ? ";" : ",");
  const l = executarReceita(linhas, r, op);
  if (l.ignoradas.some((i) => i.tipo === "ilegivel" || i.tipo === "topo" || i.tipo === "padrao")) return null;
  if (l.pontos.length < 3 || l.avisos.some((a) => a.codigo.startsWith("V1") || a.codigo.startsWith("V2") || a.codigo.startsWith("V3_fora"))) return null;
  return l;
}

/**
 * Lê um arquivo de texto sem receita dada: perfil salvo → formato padrão →
 * detector. Devolve null quando nenhuma estrutura com coordenadas foi achada
 * (aí entra a IA, no servidor, ou o mapeamento manual).
 */
export function lerLinhas(linhas: string[], op: OpcoesLeitura & { perfis?: PerfilSalvo[] }): Leitura | null {
  for (const p of op.perfis ?? []) {
    const { receita } = validarReceita(p.receita);
    if (!receita) continue;
    if (assinatura(linhas, receita) !== p.assinatura) continue;
    const l = executarReceita(linhas, { ...receita, origem: `perfil:${p.id}` }, op);
    if (l.ok && l.pontos.length >= 3) return l;
  }
  const especial = formatoEspecial(linhas);
  if (especial) {
    const l = executarReceita(linhas, receitaEspecial(especial, linhas), op, "alta");
    if (l.pontos.length >= 3) return l;
  }
  const padrao = lerComoPadrao(linhas, op);
  if (padrao) return padrao;
  const d = detectar(linhas);
  const tabular = d && d.pontosValidos >= 3 ? executarReceita(linhas, d.receita, op, d.confianca, d.duvidas) : null;
  if (tabular && tabular.confianca === "alta") return tabular;
  // sem certeza na leitura em colunas: compara com a extração de texto corrido
  // (um memorial "parece" tabela quando separado por espaços)
  const livre = executarReceita(linhas, receitaEspecial("texto_livre", linhas), op, "media", ["pontos extraídos de texto corrido"]);
  const opcoes = [tabular, livre.pontos.length >= 3 ? livre : null].filter((x): x is Leitura => x !== null);
  if (opcoes.length) return opcoes.reduce((a, b) => (notaDaLeitura(b) > notaDaLeitura(a) ? b : a));
  return d ? executarReceita(linhas, d.receita, op, d.confianca, d.duvidas) : null;
}

/** Nota para comparar duas leituras do mesmo arquivo (regras × IA). */
export function notaDaLeitura(l: Leitura): number {
  const bloqueios = l.avisos.filter((a) => a.nivel === "bloqueio").length;
  const alertas = l.avisos.filter((a) => a.nivel === "alerta").length;
  const ilegiveis = l.ignoradas.filter((i) => i.tipo === "ilegivel").length;
  return l.anel.length * 10 - bloqueios * 1000 - ilegiveis * 20 - alertas * 3 - l.duvidas.length * 5;
}
