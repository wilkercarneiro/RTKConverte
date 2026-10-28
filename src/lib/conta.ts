// A conta de quem entrou: é superadmin? precisa trocar a senha provisória? que
// recursos o plano da empresa libera? (RPC minha_conta, migração 0024)
//
// Banco sem a 0024: `legado` — ninguém é superadmin, nada é bloqueado, como era.
import { supabase } from "./supabase";
import { definirRecursos } from "./recursos";

export interface Conta {
  legado: boolean;
  superadmin: boolean;
  trocarSenha: boolean;
  recursos: Record<string, boolean>;
}

export async function carregarConta(): Promise<Conta> {
  const { data, error } = await supabase.rpc("minha_conta");
  if (error || !data) {
    definirRecursos(null);
    return { legado: true, superadmin: false, trocarSenha: false, recursos: {} };
  }
  const d = data as { superadmin?: boolean; trocar_senha?: boolean; recursos?: Record<string, boolean> };
  const conta: Conta = {
    legado: false,
    superadmin: !!d.superadmin,
    trocarSenha: !!d.trocar_senha,
    recursos: d.recursos ?? {},
  };
  // superadmin vê tudo (é quem testa o recurso antes de liberar)
  definirRecursos(conta.superadmin ? null : conta.recursos);
  return conta;
}

/** Troca a senha no Auth e, dando certo, tira a marca de senha provisória. */
export async function trocarSenha(nova: string): Promise<string | null> {
  const { error } = await supabase.auth.updateUser({ password: nova });
  if (error) {
    if (/different from the old/i.test(error.message)) return "A senha nova precisa ser diferente da atual.";
    if (/weak|short/i.test(error.message)) return "Senha fraca demais para o servidor. Use uma mais longa.";
    return error.message;
  }
  await supabase.rpc("marcar_senha_trocada");
  return null;
}
