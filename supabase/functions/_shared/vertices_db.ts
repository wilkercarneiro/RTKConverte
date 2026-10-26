// Regravação do anel de vértices de um serviço (DELETE + INSERT).
//
// Existe por causa da FAZENDA CURRAL DA SERRA (2026-10-26): a correção de
// sobreposição montava os vértices novos sem as colunas `numerado` e
// `exibir_planta` (NOT NULL, migrations 0014/0016). O supabase-js manda a união
// das chaves e completa as ausentes com NULL, o banco recusou o INSERT — e o
// DELETE já tinha rodado: o serviço ficou sem nenhum vértice. Na tela, o erro
// do PostgREST (um objeto, não um Error) aparecia como "[object Object]".
//
// Três garantias:
//  1. `defaultToNull: false` → chave ausente recebe o DEFAULT da coluna, não
//     NULL. Vale também para as colunas que ainda vão nascer;
//  2. se o INSERT falha, as linhas antigas voltam (com os mesmos ids);
//  3. `mensagemDeErro` tira o texto de erros do PostgREST/Storage.

/** Texto legível de qualquer coisa lançada — Error, erro do PostgREST/Storage ou valor solto. */
export function mensagemDeErro(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    if (typeof o.message === "string" && o.message) {
      const extra = [o.details, o.hint].filter((x) => typeof x === "string" && x).join(" · ");
      const cod = typeof o.code === "string" && o.code ? ` [${o.code}]` : "";
      return `${o.message}${extra ? ` (${extra})` : ""}${cod}`;
    }
    try { return JSON.stringify(err); } catch { /* cai no String abaixo */ }
  }
  return String(err);
}

type Resp<T = unknown> = PromiseLike<{ data: T | null; error: unknown }>;

/** O pedaço do cliente supabase-js usado aqui (estrutural, para os testes trocarem por um dublê). */
export interface ClienteVertices {
  from(tabela: "vertices"): {
    delete(): { eq(col: "servico_id", v: string): Resp };
    insert(linhas: Record<string, unknown>[], opts: { defaultToNull: false }): {
      select(): { order(col: "ordem"): Resp<Record<string, unknown>[]> };
    };
  };
}

/**
 * Troca todos os vértices do serviço por `novas`. `antigas` são as linhas lidas
 * do banco (com `id`): voltam se o INSERT falhar. Devolve as linhas gravadas.
 */
export async function substituirVertices(
  supa: ClienteVertices,
  servicoId: string,
  novas: Record<string, unknown>[],
  antigas: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  const tab = () => supa.from("vertices");
  const { error: eDel } = await tab().delete().eq("servico_id", servicoId);
  if (eDel) throw new Error(`Não foi possível apagar os vértices antigos: ${mensagemDeErro(eDel)}`);
  const { data, error: eIns } = await tab().insert(novas, { defaultToNull: false }).select().order("ordem");
  if (!eIns) return data ?? [];
  const motivo = mensagemDeErro(eIns);
  if (antigas.length) {
    const { error: eVolta } = await tab().insert(antigas, { defaultToNull: false }).select().order("ordem");
    if (eVolta) {
      throw new Error(`Os vértices novos não foram gravados (${motivo}) e os antigos não puderam ser restaurados (${mensagemDeErro(eVolta)})`);
    }
  }
  throw new Error(`Os vértices novos não foram gravados (${motivo}); o serviço continua como estava`);
}
