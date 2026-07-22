import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configOk = Boolean(url && anon);

// Sem configuração, não deixamos o app quebrar em tela branca: App.tsx exibe
// instruções quando configOk === false.
export const supabase = configOk
  ? createClient(url!, anon!)
  : (null as unknown as ReturnType<typeof createClient>);

export async function chamarFuncao<T>(nome: string, body: unknown): Promise<T> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const resp = await fetch(`${url}/functions/v1/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: anon ?? "", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const dados = await resp.json();
  if (!resp.ok) throw new Error(dados.erro ?? `Erro ${resp.status}`);
  return dados as T;
}
