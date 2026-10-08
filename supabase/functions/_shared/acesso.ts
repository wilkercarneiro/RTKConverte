// Quem está chamando a edge function, e se o serviço pedido é dele.
//
// As funções leem e gravam com a service_role (passa por cima da RLS), então
// até aqui bastava ter um JWT válido para gerar documentos de QUALQUER
// servico_id. Agora a função confere, com um cliente no nome do próprio
// usuário (chave anon + o Authorization da chamada), que o serviço aparece
// para ele — ou seja, que a RLS deixa. Antes da migração de escritórios a RLS
// libera tudo para quem está logado e nada muda; depois dela, cada escritório
// só alcança os próprios serviços.
//
// Como os demais módulos de _shared, este não importa supabase-js nem usa
// `Deno`: quem chama passa o cliente do usuário (ver `clienteDoUsuario` no
// index.ts de cada função). Assim o módulo é testável no Node.

/** O mínimo do supabase-js que estas checagens usam. */
export interface ClienteUsuario {
  auth: { getUser: () => PromiseLike<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
  rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }>;
}

export type Recusa = { erro: string; status: number };

const SESSAO_INVALIDA: Recusa = { erro: "Sessão inválida ou expirada. Entre de novo.", status: 401 };

/** Exige usuário logado. Devolve o id dele, ou a recusa. */
export async function exigirUsuario(cli: ClienteUsuario): Promise<{ userId: string } | Recusa> {
  const { data, error } = await cli.auth.getUser();
  if (error || !data?.user) return SESSAO_INVALIDA;
  return { userId: data.user.id };
}

/** Exige que o serviço exista PARA ESTE usuário (RLS). 404 quando não — não diz se é de outro. */
export async function exigirServicoDoUsuario(cli: ClienteUsuario, servicoId: string): Promise<Recusa | null> {
  const u = await exigirUsuario(cli);
  if (ehRecusa(u)) return u;
  const { data, error } = await cli.from("servicos").select("id").eq("id", servicoId).maybeSingle();
  if (error || !data) return { erro: "Serviço não encontrado", status: 404 };
  return null;
}

/**
 * Escritório de quem chama, para gravar no serviço novo.
 *  - banco sem escritórios (antes da 0020): `{ escritorioId: null }` — a coluna nem existe
 *  - usuário sem escritório: recusa (403)
 */
export async function escritorioDoUsuario(cli: ClienteUsuario): Promise<{ escritorioId: string | null } | Recusa> {
  const u = await exigirUsuario(cli);
  if (ehRecusa(u)) return u;
  const { data, error } = await cli.rpc("meu_escritorio");
  // a RPC só existe depois da migração de escritórios
  if (error) return { escritorioId: null };
  const linha = (Array.isArray(data) ? data[0] : data) as { id?: string } | null | undefined;
  if (!linha?.id) {
    return {
      erro: "Sua conta ainda não está ligada a um escritório. Peça ao dono do escritório para adicionar seu e-mail.",
      status: 403,
    };
  }
  return { escritorioId: linha.id };
}

export function ehRecusa(x: unknown): x is Recusa {
  return typeof x === "object" && x !== null && "erro" in x && "status" in x;
}
