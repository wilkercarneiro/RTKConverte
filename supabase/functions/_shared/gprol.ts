// Regras puras da integração com o GPROL (sem supabase-js, sem Deno): o que
// vai no nome do serviço lá, a nota do card, os campos do cliente e a espera
// entre tentativas. A edge function `gprol` usa; os testes rodam no Node.

export const MARCOS = ["iniciado", "documentos", "planta_sigef", "pecas", "entregue"] as const;
export type Marco = (typeof MARCOS)[number];

const ROTULO_MARCO: Record<Marco, string> = {
  iniciado: "serviço iniciado",
  documentos: "documentos gerados",
  planta_sigef: "planta do SIGEF gerada",
  pecas: "peças técnicas geradas",
  entregue: "serviço concluído",
};

export type ChaveServico = "completo" | "conferencia" | "gleba" | "divisao" | "loteamento" | "car" | "pecas";

const ROTULO_SERVICO: Record<ChaveServico, string> = {
  completo: "Georreferenciamento",
  conferencia: "Conferência de área",
  gleba: "Georreferenciamento com glebas",
  divisao: "Divisão de área",
  loteamento: "Loteamento",
  car: "CAR",
  pecas: "Peças técnicas",
};

/** Mesma leitura de src/lib/modalidades.ts (chaveDoServico): qual cartão o serviço gravado é. */
export function chaveDoServico(s: { tipo?: string | null; modalidade?: string | null; tem_glebas?: boolean | null; divisao?: unknown }): ChaveServico {
  if (s.tipo === "pecas") return "pecas";
  if (s.modalidade === "conferencia") return "conferencia";
  if (s.modalidade === "loteamento") return "loteamento";
  if (s.modalidade === "car") return "car";
  if (s.divisao) return "divisao";
  return s.tem_glebas ? "gleba" : "completo";
}

export const rotuloDoServico = (chave: ChaveServico): string => ROTULO_SERVICO[chave] ?? "Serviço";

/** Nome do serviço que nasce no GPROL: "CAR · Fazenda Boa Vista". */
export function nomeParaGprol(s: {
  denominacao?: string | null; detentor_nome?: string | null; nome_arquivo_txt?: string | null;
}, chave: ChaveServico): string {
  const quem = [s.denominacao, s.detentor_nome, s.nome_arquivo_txt].map((x) => (x ?? "").trim()).find(Boolean);
  return quem ? `${rotuloDoServico(chave)} · ${quem}` : rotuloDoServico(chave);
}

export function localParaGprol(municipio?: string | null, uf?: string | null): string | null {
  const m = (municipio ?? "").trim();
  const u = (uf ?? "").trim().toUpperCase();
  if (m && u) return `${m}/${u}`;
  return m || u || null;
}

/** O marco mais adiantado da lista (na ordem do processo). */
export function marcoMaisAdiantado(marcos: readonly string[]): Marco | null {
  for (let i = MARCOS.length - 1; i >= 0; i--) if (marcos.includes(MARCOS[i])) return MARCOS[i];
  return null;
}

/** Nota do histórico do card: "Vertces · Maria · documentos gerados". */
export function notaDoCard(marcos: readonly string[], quem?: string | null): string {
  const m = marcoMaisAdiantado(marcos);
  return ["Vertces", (quem ?? "").trim() || null, m ? ROTULO_MARCO[m] : null].filter(Boolean).join(" · ");
}

export const rotuloDoMarco = (m: string): string => ROTULO_MARCO[m as Marco] ?? m;

// Cliente: nomes daqui → nomes do GPROL
const CAMPO_GPROL: Record<string, string> = {
  nome: "full_name",
  cpf_cnpj: "cpf_cnpj",
  email: "email",
  telefone: "phone",
  endereco: "address",
};

/** Só os campos pedidos (os que mudaram aqui); sem lista, todos. */
export function camposClienteParaGprol(c: Record<string, unknown>, campos?: readonly string[] | null): Record<string, string> {
  const lista = campos && campos.length ? campos : Object.keys(CAMPO_GPROL);
  const saida: Record<string, string> = {};
  for (const k of lista) {
    const g = CAMPO_GPROL[k];
    if (!g) continue;
    const v = c[k];
    saida[g] = v == null ? "" : String(v);
  }
  return saida;
}

/** Espera antes da próxima tentativa: 1 min, 5 min, 30 min, 2 h (e fica em 2 h). */
export function esperaDaTentativa(tentativas: number): number {
  const passos = [60, 300, 1800, 7200];
  return passos[Math.min(Math.max(tentativas, 1), passos.length) - 1] * 1000;
}

/**
 * Documentos para o GPROL: de cada tipo, só a última versão (todas as linhas
 * dela — uma geração grava várias plantas de gleba com o mesmo tipo).
 */
export function ultimasVersoes<T extends { tipo: string; versao: number }>(docs: readonly T[]): T[] {
  const maior = new Map<string, number>();
  for (const d of docs) maior.set(d.tipo, Math.max(maior.get(d.tipo) ?? -Infinity, d.versao));
  return docs.filter((d) => d.versao === maior.get(d.tipo));
}

/** Link de volta para conectar: valida que é o app do GPROL, com o state e o escritório. */
export function urlDeAutorizacao(base: string, state: string, escritorioId: string, escritorioNome: string): string {
  const u = new URL("/integracoes/vertces/autorizar", base);
  u.searchParams.set("state", state);
  u.searchParams.set("escritorio_id", escritorioId);
  u.searchParams.set("escritorio", escritorioNome);
  return u.toString();
}
