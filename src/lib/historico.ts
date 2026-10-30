// Histórico de documentos gerados (tabela documentos_gerados): o que a tela
// lê dele — o título que o operador vê e a última geração de cada etapa.
//
// Funções puras, sem React e sem banco: a mesma regra serve ao histórico, à
// tela do serviço (que reabre mostrando os documentos da última geração) e ao
// visualizador da planta (que grava a planta editada).

/** Uma linha de documentos_gerados — só o que estas regras leem. */
export interface DocHistorico {
  id?: string;
  versao: number;
  tipo: string;
  titulo: string;
  path: string;
  created_at?: string;
}

/**
 * Avisa quem mostra o histórico (HistoricoDocs) que entrou documento novo.
 * Toda geração dispara: documentos, Memorial Tabular, planta do SIGEF, peças e
 * a planta editada salva pelo visualizador. Sem isto a lista só mudava ao
 * recarregar a página.
 */
export const EVENTO_HISTORICO = "rtk:historico-atualizado";
export function avisarHistoricoAtualizado(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_HISTORICO));
}

// O que a tela acrescenta ao título ao abrir/salvar uma planta: a versão
// (" · v6") e a marca de edição (" · editada"). Só no FIM do título — o meio
// ("Planta A1 (PDF · dados do sistema) · PRÉVIA") é do servidor e fica.
const SUFIXO_DA_TELA = /\s*·\s*(?:v\d+|editada)\s*$/;

/**
 * O título sem o que a tela acrescentou, quantas vezes tenha acumulado.
 * Reabrir uma planta editada a partir do histórico e salvar de novo gravava
 * "… · v6 · editada · v6 · editada"; daqui sai só "…".
 */
export function tituloBasePlanta(titulo: string): string {
  let t = titulo.trim();
  while (SUFIXO_DA_TELA.test(t)) t = t.replace(SUFIXO_DA_TELA, "").trim();
  return t;
}

/** Título da planta editada que vai para o histórico: "editada" uma vez só. */
export function tituloPlantaEditada(titulo: string | null | undefined): string {
  return `${tituloBasePlanta(titulo ?? "") || "Planta"} · editada`;
}

/** Título do Memorial Tabular de prévia (conferência de área), no histórico. */
export const TITULO_TABULAR_PREVIA = "Memorial Tabular (DOCX) · PRÉVIA";

const ehPeca = (tipo: string) => tipo.startsWith("peca_");

/**
 * Versão que só tem o Memorial Tabular: é o da conferência de área, gerado do
 * cálculo antes de a gerar-pecas anexá-lo à versão dos documentos (linhas
 * antigas: tipo "peca_2", título "2 - Memorial Tabular", versão própria). As
 * peças de verdade nunca saem sem o Memorial Descritivo (peca_1).
 */
function ehTabularAvulso(d: DocHistorico, daVersao: readonly DocHistorico[]): boolean {
  return d.tipo === "peca_2" && !daVersao.some((x) => ehPeca(x.tipo) && x.tipo !== "peca_2");
}

/**
 * O título que o histórico mostra. `daVersao` são as linhas da mesma versão
 * (sem ela, nenhuma regra que dependa das irmãs se aplica).
 */
export function tituloNoHistorico(d: DocHistorico, daVersao: readonly DocHistorico[] = []): string {
  if (d.tipo === "planta_pdf_editada") return tituloPlantaEditada(d.titulo);
  if (d.tipo === "memorial_tabular") return d.titulo || TITULO_TABULAR_PREVIA;
  if (daVersao.length && ehTabularAvulso(d, daVersao)) return TITULO_TABULAR_PREVIA;
  return d.titulo;
}

/** Folha (A1/A3) no título da planta, quando ele diz. */
export function folhaDoTitulo(titulo: string): "A1" | "A3" | null {
  const m = /\bPlanta\s+(A1|A3)\b/.exec(titulo);
  return m ? (m[1] as "A1" | "A3") : null;
}

/** Nome da gleba no título da planta A3 dela ("Planta A3 · GLEBA 1 · PRÉVIA"). */
export function nomeDaGlebaNoTitulo(titulo: string): string {
  return titulo.replace(/^\s*Planta\s+A3\s*·\s*/, "").replace(/\s*·\s*PRÉVIA\s*$/, "").trim();
}

export interface UltimaGeracao {
  /** gerar-documentos: memorial, planilha, planta do sistema e a A3 de cada gleba */
  documentos: {
    versao: number;
    memorial: DocHistorico | null;
    planilha: DocHistorico | null;
    planta: DocHistorico | null;
    glebas: DocHistorico[];
  } | null;
  /** gerar-planta: a planta desenhada do PDF do SIGEF */
  plantaSigef: DocHistorico | null;
  /** gerar-pecas: o jogo do imóvel e, com glebas, o de cada gleba */
  pecas: { versao: number; itens: DocHistorico[] } | null;
  /** conferência de área: o Memorial Tabular de prévia */
  tabular: DocHistorico | null;
}

/**
 * A última geração de cada etapa, para a tela do serviço reabrir mostrando os
 * documentos que já existem — antes o bloco "Documentos gerados" só aparecia
 * logo depois de gerar e sumia ao reabrir o serviço.
 */
export function ultimaGeracao(docs: readonly DocHistorico[]): UltimaGeracao {
  const ordenados = [...docs].sort((a, b) => b.versao - a.versao);
  const daVersao = (v: number) => ordenados.filter((d) => d.versao === v);

  const vDocs = ordenados.find((d) => d.tipo === "memorial_docx" || d.tipo === "planilha_ods")?.versao;
  let documentos: UltimaGeracao["documentos"] = null;
  if (vDocs !== undefined) {
    const linhas = daVersao(vDocs);
    documentos = {
      versao: vDocs,
      memorial: linhas.find((d) => d.tipo === "memorial_docx") ?? null,
      planilha: linhas.find((d) => d.tipo === "planilha_ods") ?? null,
      planta: linhas.find((d) => d.tipo === "planta_pdf_sistema") ?? null,
      // a pasta de cada gleba é numerada pela ordem (glebas/1-…, glebas/2-…)
      glebas: linhas.filter((d) => d.tipo === "gleba_planta_pdf")
        .sort((a, b) => a.path.localeCompare(b.path, "pt-BR", { numeric: true })),
    };
  }

  const plantaSigef = ordenados.find((d) => d.tipo === "planta_pdf") ?? null;

  const vPecas = ordenados.find((d) => ehPeca(d.tipo) && !ehTabularAvulso(d, daVersao(d.versao)))?.versao;
  const pecas = vPecas === undefined ? null : {
    versao: vPecas,
    // o jogo do imóvel (peca_1 … peca_7) antes do de cada gleba (peca_1_glebas_…)
    itens: daVersao(vPecas).filter((d) => ehPeca(d.tipo)).sort((a, b) => {
      const ga = /^peca_\d+$/.test(a.tipo) ? 0 : 1;
      const gb = /^peca_\d+$/.test(b.tipo) ? 0 : 1;
      return ga - gb || a.path.localeCompare(b.path, "pt-BR", { numeric: true });
    }),
  };

  const tabular = ordenados.find((d) => d.tipo === "memorial_tabular" || ehTabularAvulso(d, daVersao(d.versao))) ?? null;

  return { documentos, plantaSigef, pecas, tabular };
}
