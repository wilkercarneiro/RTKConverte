// Equipe da empresa (migração 0025 + edge function `equipe`).
// Leitura e edição de permissões pelas RPCs; criar conta, redefinir senha e
// apagar conta pela edge function (só ela fala com o Auth).
import { chamarFuncao, supabase } from "./supabase";

export interface Membro {
  user_id: string; email: string; nome: string | null; cargo: string | null;
  papel: "dono" | "membro"; permissoes: string[]; ativo: boolean;
  desde: string; ultimo_acesso: string | null; senha_provisoria: boolean;
}

export interface Atividade { id: number; acao: string; alvo: string | null; detalhe: Record<string, unknown> | null; created_at: string; quem: string }

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(traduzir(r.error.message));
  return r.data as T;
}

/** Mensagens do banco que a pessoa pode ler. */
function traduzir(m: string): string {
  if (/limite|permite/i.test(m)) return m;
  if (/permission denied|row-level security/i.test(m)) return "Você não tem permissão para isso.";
  return m;
}

export const listarMembros = async (): Promise<Membro[]> => ok(await supabase.rpc("listar_membros")) ?? [];
export const listarAtividades = async (limite = 150): Promise<Atividade[]> =>
  ok(await supabase.rpc("listar_atividades", { p_limite: limite })) ?? [];

export async function salvarMembro(m: Pick<Membro, "user_id" | "nome" | "cargo" | "permissoes" | "ativo">): Promise<void> {
  ok(await supabase.rpc("definir_membro", {
    p_user: m.user_id, p_nome: m.nome ?? "", p_cargo: m.cargo ?? "", p_permissoes: m.permissoes, p_ativo: m.ativo,
  }));
}

export interface PodeAdicionar { ok: boolean; motivo?: string; limite?: number | null; ativos?: number; sou_dono?: boolean }
export const podeAdicionar = async (): Promise<PodeAdicionar> => ok(await supabase.rpc("pode_adicionar_membro")) as PodeAdicionar;

export interface Acesso { login: string; senha: string }
export const criarMembro = (d: { email: string; nome: string; cargo: string; permissoes: string[] }) =>
  chamarFuncao<{ ok: true; user_id: string } & Acesso>("equipe", { acao: "criar", ...d });
export const novaSenha = (user_id: string) => chamarFuncao<{ ok: true } & Acesso>("equipe", { acao: "redefinir_senha", user_id });
export const apagarConta = (user_id: string) => chamarFuncao<{ ok: true }>("equipe", { acao: "remover", user_id });

/** Texto pronto para passar o acesso a quem entrou na equipe. */
export function mensagemDeAcesso(o: { nome: string; empresa: string; login: string; senha: string }): string {
  const primeiro = o.nome.split(/\s+/)[0] || "";
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Seu acesso ao Vértice (${o.empresa}) está pronto.`,
    ``,
    `Endereço: ${location.origin}/app/`,
    `Login: ${o.login}`,
    `Senha provisória: ${o.senha}`,
    ``,
    `No primeiro acesso o sistema pede para você criar a sua própria senha.`,
  ].join("\n");
}

const ROTULOS: Record<string, string> = {
  "servico.criado": "criou o serviço",
  "servico.excluido": "excluiu o serviço",
  "cliente.criado": "cadastrou o cliente",
  "cliente.excluido": "excluiu o cliente",
  "documento.gerado": "gerou",
  "membro.adicionado": "adicionou à equipe",
  "membro.alterado": "alterou o acesso de",
  "membro.desativado": "desativou o acesso de",
  "membro.reativado": "reativou o acesso de",
  "membro.removido": "removeu da equipe",
  "membro.senha": "gerou uma senha nova para",
};
export const rotuloAtividade = (acao: string): string => ROTULOS[acao] ?? acao;
