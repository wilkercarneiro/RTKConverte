import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configOk = Boolean(url && anon);

// Sem configuração, não deixamos o app quebrar em tela branca: App.tsx exibe
// instruções quando configOk === false.
export const supabase = configOk
  ? createClient(url!, anon!)
  : (null as unknown as ReturnType<typeof createClient>);

const SESSAO_EXPIRADA = "Sessão inválida ou expirada. Entre de novo.";

export async function chamarFuncao<T>(nome: string, body: unknown): Promise<T> {
  const enviar = (token: string) => fetch(`${url}/functions/v1/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: anon ?? "", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const { data: sess } = await supabase.auth.getSession();
  let token = sess.session?.access_token;
  if (!token) {
    await supabase.auth.signOut();
    throw new Error(SESSAO_EXPIRADA);
  }
  let resp = await enviar(token);
  // A sessão guardada no navegador pode ter sido revogada no servidor (troca de
  // senha, conta mexida pela equipe, auth reiniciado) sem o token ter vencido:
  // renova uma vez e repete; se nem assim, volta para o login em vez de deixar
  // o erro na tela.
  if (resp.status === 401) {
    const { data: nova } = await supabase.auth.refreshSession();
    token = nova.session?.access_token;
    if (!token) {
      await supabase.auth.signOut();
      throw new Error(SESSAO_EXPIRADA);
    }
    resp = await enviar(token);
    if (resp.status === 401) {
      await supabase.auth.signOut();
      throw new Error(SESSAO_EXPIRADA);
    }
  }
  const dados = await resp.json();
  if (!resp.ok) throw new Error(dados.erro ?? `Erro ${resp.status}`);
  return dados as T;
}
