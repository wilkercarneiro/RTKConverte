// Dados do painel do superadmin (migração 0024 + edge function `superadmin`).
// Leitura e plano/recursos passam pela RLS (sou_superadmin()); empresa e
// usuários, pelas RPCs sa_* e pela edge function.
import { chamarFuncao, supabase } from "./supabase";
import { RECURSOS } from "./recursos";

export type StatusEmpresa = "ativo" | "suspenso" | "cancelado";

export interface Empresa {
  id: string; nome: string; cnpj: string | null; responsavel: string | null;
  telefone: string | null; email: string | null; status: StatusEmpresa;
  plano_id: string | null; plano: string | null; observacoes: string | null; created_at: string;
  usuarios: number; servicos: number; servicos_30d: number;
  ultimo_servico: string | null; ultimo_acesso: string | null; excecoes: number;
}

export interface Plano { id: string; nome: string; descricao: string | null; cor: string; ordem: number; ativo: boolean; limite_usuarios?: number | null }
export interface RecursoBanco {
  chave: string; nome: string; grupo: string; descricao: string | null;
  padrao: boolean; ordem: number; ativo: boolean; criado_em: string;
}
export interface UsuarioEmpresa {
  user_id: string; email: string; papel: "dono" | "membro"; desde: string;
  ultimo_acesso: string | null; senha_provisoria: boolean;
  /** equipe (0025) */
  nome?: string | null; ativo?: boolean; permissoes?: string[];
}
export interface AtividadeEmpresa { id: number; acao: string; alvo: string | null; detalhe: Record<string, unknown> | null; created_at: string; quem: string }
export const atividadesDaEmpresa = async (id: string): Promise<AtividadeEmpresa[]> =>
  ok(await supabase.rpc("sa_atividades", { p_escritorio: id, p_limite: 200 })) ?? [];
export interface RecursoEmpresa { chave: string; liberado: boolean; origem: "excecao" | "plano" | "padrao"; excecao: boolean | null }
export interface Contato {
  id: string; nome: string; empresa: string | null; telefone: string; email: string | null;
  cidade_uf: string | null; mensagem: string | null; origem: string | null;
  status: "novo" | "em_contato" | "reuniao" | "fechado" | "descartado"; created_at: string;
}

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** Manda o catálogo do código ao banco. Devolve quantos recursos são novos. */
export async function sincronizarRecursos(): Promise<number> {
  return ok(await supabase.rpc("sa_sincronizar_recursos", { p_itens: RECURSOS }));
}

export const listarEmpresas = async (): Promise<Empresa[]> => ok(await supabase.rpc("sa_empresas")) ?? [];
export const listarPlanos = async (): Promise<Plano[]> =>
  ok(await supabase.from("planos").select().order("ordem").order("nome")) ?? [];
export const listarRecursos = async (): Promise<RecursoBanco[]> =>
  ok(await supabase.from("recursos").select().order("ordem").order("chave")) ?? [];
export const matrizPlanos = async (): Promise<{ plano_id: string; recurso_chave: string; liberado: boolean }[]> =>
  ok(await supabase.from("plano_recursos").select()) ?? [];
export const usuariosDaEmpresa = async (id: string): Promise<UsuarioEmpresa[]> =>
  ok(await supabase.rpc("sa_empresa_usuarios", { p_escritorio: id })) ?? [];
export const recursosDaEmpresa = async (id: string): Promise<RecursoEmpresa[]> =>
  ok(await supabase.rpc("sa_recursos_empresa", { p_escritorio: id })) ?? [];
export const usoModalidades = async (id: string | null, dias = 30): Promise<{ chave: string; total: number }[]> =>
  ok(await supabase.rpc("sa_uso_modalidades", { p_escritorio: id, p_dias: dias })) ?? [];
export const serieServicos = async (dias = 30): Promise<{ dia: string; total: number }[]> =>
  ok(await supabase.rpc("sa_serie_servicos", { p_dias: dias })) ?? [];

export async function atualizarEmpresa(id: string, dados: Partial<Pick<Empresa, "nome" | "cnpj" | "responsavel" | "telefone" | "email" | "plano_id" | "status" | "observacoes">>): Promise<void> {
  ok(await supabase.rpc("sa_atualizar_empresa", { p_escritorio: id, p_dados: dados }));
}

export async function definirRecursoEmpresa(id: string, chave: string, liberado: boolean | null, motivo?: string): Promise<void> {
  ok(await supabase.rpc("sa_definir_recurso_empresa", { p_escritorio: id, p_chave: chave, p_liberado: liberado, p_motivo: motivo ?? null }));
}

export async function salvarPlano(p: Partial<Plano> & { nome: string }): Promise<Plano> {
  const linha = {
    nome: p.nome.trim(), descricao: p.descricao ?? null, cor: p.cor ?? "#178552", ordem: p.ordem ?? 0, ativo: p.ativo ?? true,
    ...(p.limite_usuarios !== undefined ? { limite_usuarios: p.limite_usuarios || null } : {}),
  };
  const r = p.id
    ? await supabase.from("planos").update(linha).eq("id", p.id).select().single()
    : await supabase.from("planos").insert(linha).select().single();
  return ok(r) as Plano;
}

export async function excluirPlano(id: string): Promise<void> {
  ok(await supabase.from("planos").delete().eq("id", id));
}

/** Grava a decisão de vários recursos de um plano de uma vez. */
export async function salvarMatrizPlano(planoId: string, valores: Record<string, boolean>): Promise<void> {
  const linhas = Object.entries(valores).map(([recurso_chave, liberado]) => ({ plano_id: planoId, recurso_chave, liberado }));
  if (linhas.length) ok(await supabase.from("plano_recursos").upsert(linhas, { onConflict: "plano_id,recurso_chave" }));
}

export async function lerSenhaPadrao(): Promise<string> {
  const r = await supabase.from("saas_config").select("value").eq("key", "senha_padrao").maybeSingle();
  return (ok(r) as { value: string } | null)?.value ?? "";
}
export async function salvarSenhaPadrao(valor: string): Promise<void> {
  ok(await supabase.from("saas_config").upsert({ key: "senha_padrao", value: valor }));
}

export const listarContatos = async (): Promise<Contato[]> =>
  ok(await supabase.from("contatos_site").select().order("created_at", { ascending: false }).limit(500)) ?? [];
export async function mudarStatusContato(id: string, status: Contato["status"]): Promise<void> {
  ok(await supabase.from("contatos_site").update({ status }).eq("id", id));
}

// ---- edge function
export interface NovaEmpresa { cnpj: string; nome: string; responsavel: string; telefone: string; email: string; senha: string; plano_id: string | null }
export const criarEmpresa = (d: NovaEmpresa) =>
  chamarFuncao<{ ok: true; escritorio_id: string; user_id: string; login: string }>("superadmin", { acao: "criar_empresa", ...d });
export const adicionarUsuario = (escritorio_id: string, email: string, senha: string, papel: "dono" | "membro") =>
  chamarFuncao<{ ok: true; login: string }>("superadmin", { acao: "adicionar_usuario", escritorio_id, email, senha, papel });
export const redefinirSenha = (user_id: string, senha: string) =>
  chamarFuncao<{ ok: true }>("superadmin", { acao: "redefinir_senha", user_id, senha });
export const removerUsuario = (user_id: string) =>
  chamarFuncao<{ ok: true }>("superadmin", { acao: "remover_usuario", user_id });

/** Texto pronto para mandar ao cliente pelo WhatsApp ou e-mail. */
export function mensagemDeAcesso(o: { responsavel: string; empresa: string; login: string; senha: string; url: string }): string {
  const nome = o.responsavel.split(/\s+/)[0] || o.responsavel;
  return [
    `Olá, ${nome}! O acesso da ${o.empresa} ao Vértice está pronto.`,
    ``,
    `Endereço: ${o.url}`,
    `Login: ${o.login}`,
    `Senha provisória: ${o.senha}`,
    ``,
    `No primeiro acesso o sistema pede para você criar a sua própria senha.`,
  ].join("\n");
}
