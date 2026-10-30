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

// Quem quer saber que uma função terminou bem (a integração com o GPROL
// sincroniza depois de criar serviço ou gerar documento). Sem import circular:
// o interessado se registra aqui.
type Ouvinte = (nome: string) => void;
const ouvintes = new Set<Ouvinte>();
export function aoChamarFuncao(f: Ouvinte): () => void {
  ouvintes.add(f);
  return () => { ouvintes.delete(f); };
}

export async function chamarFuncao<T>(nome: string, body: unknown): Promise<T> {
  const enviar = (token: string) => fetch(`${url}/functions/v1/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: anon ?? "", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((e: unknown) => {
    // O servidor mata a função que passa do limite de CPU/memória e responde
    // sem cabeçalho CORS: o navegador só enxerga "Failed to fetch".
    if (e instanceof TypeError) {
      throw new Error("O servidor interrompeu o processamento antes de terminar (limite de recursos ou conexão caída). Tente de novo em instantes; se repetir, avise o suporte.");
    }
    throw e;
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
  for (const f of ouvintes) { try { f(nome); } catch { /* ouvinte nunca quebra a chamada */ } }
  return dados as T;
}
