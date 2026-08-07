// As modalidades de serviço, em UM lugar só.
//
// A tela mostra três (mais uma entrada secundária), mas no banco isso são DUAS
// colunas ortogonais — `modalidade` e `tem_glebas` — e a coluna `tipo`, que é
// outro eixo ainda: de onde vêm os dados. "Serviço com gleba" não é um quarto
// caminho, é o serviço completo com glebas ligadas.
//
// Concentrar o mapeamento aqui é o que impede a tela de virar a autoridade sobre
// o modelo. Antes, cada ponto de entrada novo tinha de ser plugado no Dashboard
// E na página do cliente; agora os dois iteram esta lista.
import type { Modalidade, Servico } from "./types";

/** Chave do cartão na tela — não é coluna do banco. */
export type ChaveServico = "completo" | "conferencia" | "gleba" | "pecas";

export interface DefinicaoServico {
  chave: ChaveServico;
  titulo: string;
  icone: string;
  resumo: string;
  /** O que o operador precisa ter em mãos. */
  requisitos: string[];
  /** O que sai no fim. */
  entrega: string[];
  cta: string;
  /** Colunas gravadas ao criar. `tipo` decide qual pipeline abre. */
  campos: { tipo: "geo" | "pecas"; modalidade: Modalidade; tem_glebas: boolean };
  /** Cartão principal (topo) ou entrada secundária. */
  principal: boolean;
}

export const SERVICOS: DefinicaoServico[] = [
  {
    chave: "completo",
    titulo: "Serviço completo",
    icone: "🛰️",
    resumo: "Do levantamento à certificação: memorial, planilha e planta, envio ao SIGEF e as peças técnicas.",
    requisitos: ["TXT do levantamento", "documentos do proprietário", "confrontantes", "imagem de satélite"],
    entrega: ["Memorial Descritivo", "Planilha SIGEF", "Planta A1/A3", "Planta oficial do SIGEF", "7 peças técnicas"],
    cta: "Enviar TXT",
    campos: { tipo: "geo", modalidade: "completo", tem_glebas: false },
    principal: true,
  },
  {
    chave: "conferencia",
    titulo: "Conferência de área",
    icone: "📐",
    resumo: "Prévia de área e perímetro, sem passar pelo SIGEF. Os vértices saem com código provisório e a numeração oficial não é consumida.",
    requisitos: ["TXT do levantamento", "documentos do proprietário", "confrontantes", "imagem de satélite"],
    entrega: ["Memorial Descritivo", "Memorial Tabular (opcional)", "Planta A4 ou A3 (opcional)"],
    cta: "Enviar TXT",
    campos: { tipo: "geo", modalidade: "conferencia", tem_glebas: false },
    principal: true,
  },
  {
    chave: "gleba",
    titulo: "Serviço com gleba",
    icone: "🧩",
    resumo: "O serviço completo com as glebas desenhadas dentro do perímetro. As divisões são montadas na tela antes de gerar a planta.",
    requisitos: ["TXT do levantamento", "documentos do proprietário", "confrontantes", "imagem de satélite"],
    entrega: ["Tudo do serviço completo", "Planta com as glebas e suas áreas"],
    cta: "Enviar TXT",
    campos: { tipo: "geo", modalidade: "completo", tem_glebas: true },
    principal: true,
  },
  {
    chave: "pecas",
    titulo: "Peças a partir do PDF do SIGEF",
    icone: "📑",
    resumo: "Para quando o imóvel já foi certificado e só faltam as peças. Não precisa do TXT.",
    requisitos: ["PDF de prévia do SIGEF", "documentos do proprietário"],
    entrega: ["7 peças técnicas"],
    cta: "Enviar PDF",
    campos: { tipo: "pecas", modalidade: "completo", tem_glebas: false },
    principal: false,
  },
];

export const definicaoDe = (chave: ChaveServico): DefinicaoServico =>
  SERVICOS.find((s) => s.chave === chave) ?? SERVICOS[0];

/**
 * Qual cartão um serviço gravado representa. É a leitura inversa de `campos`:
 * a tela precisa disso para o chip da lista e para o cabeçalho da conferência.
 */
export function chaveDoServico(s: Pick<Servico, "tipo" | "modalidade" | "tem_glebas">): ChaveServico {
  if (s.tipo === "pecas") return "pecas";
  if (s.modalidade === "conferencia") return "conferencia";
  return s.tem_glebas ? "gleba" : "completo";
}

/** Rótulo curto para chips de lista. */
export const rotuloCurto: Record<ChaveServico, string> = {
  completo: "Completo",
  conferencia: "Conferência",
  gleba: "Gleba",
  pecas: "Peças",
};

/**
 * A conferência para no memorial: não envia ao SIGEF nem gera as 7 peças.
 * Uma função só, usada pela trilha de etapas e pelos blocos da tela, para que
 * não exista uma segunda definição de "até onde vai a conferência".
 */
export const vaiAoSigef = (s: Pick<Servico, "modalidade">): boolean => s.modalidade !== "conferencia";
