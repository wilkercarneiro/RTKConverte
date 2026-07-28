// Domínios oficiais SIGEF (seção 6.3 — extraídos da planilha oficial)
import type { RT } from "./types";

export const TIPOS_VERTICE = ["M", "P", "V"] as const;

export const TIPOS_LIMITE = [
  "LA1", "LA2", "LA3", "LA4", "LA5", "LA6", "LA7",
  "LN1", "LN2", "LN3", "LN4", "LN5", "LN6",
];

export const METODOS_POSICIONAMENTO = [
  "PA1", "PA2",
  "PG1", "PG2", "PG3", "PG4", "PG5", "PG6", "PG7", "PG8", "PG9",
  "PS1", "PS2", "PS3", "PS4",
  "PT1", "PT2", "PT3", "PT4", "PT5", "PT6", "PT7", "PT8",
];

export const NATUREZAS_SERVICO = ["Contrato com Administração Pública", "Particular"];

export const SITUACOES = ["Imóvel Registrado", "Área Titulada não Registrada", "Área não Titulada"];

export const NATUREZAS_AREA = [
  "Assentamento", "Assentamento Parcela", "Estrada", "Ferrovia", "Floresta Pública",
  "Gleba Pública", "Particular", "Perímetro Urbano", "Terra Indígena",
  "Terreno de Marinha", "Terreno Marginal", "Território Quilombola", "Unidade de Conservação",
];

export const TIPOS_PESSOA = ["Física", "Jurídica"];

export const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

export const LADOS = ["Externo", "Interno"];

// Conselho profissional do responsável técnico. CFTA/CFT para técnicos,
// CREA para engenheiros — a sigla vai impressa nas peças e no carimbo da planta.
export const CONSELHOS = ["CFTA", "CFT", "CREA"];

/** Rótulo do RT nos selects: "NOME — CFTA 0578839458-9". */
export function rotuloRT(r: RT): string {
  const numero = (r.conselho_numero ?? "").trim() || (r.crea ?? "").trim();
  if (!numero) return r.nome;
  return `${r.nome} — ${(r.conselho_sigla ?? "CREA").trim()} ${numero}`;
}
