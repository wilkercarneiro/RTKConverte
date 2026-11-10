// Dados do painel do superadmin (migração 0024 + edge function `superadmin`).
// Leitura e plano/recursos passam pela RLS (sou_superadmin()); empresa e
// usuários, pelas RPCs sa_* e pela edge function.
import { chamarFuncao, supabase } from "./supabase";
import { RECURSOS } from "./recursos";
import type { SituacaoCobranca } from "./cobranca";
import type { Carteira, Faixa } from "./creditos";
import type { CartaoPublico, RecargaCarteira } from "./creditos_regras";

export type StatusEmpresa = "ativo" | "aguardando_pagamento" | "suspenso" | "cancelado";

export interface Empresa {
  id: string; nome: string; cnpj: string | null; responsavel: string | null;
  telefone: string | null; email: string | null; status: StatusEmpresa;
  plano_id: string | null; plano: string | null; observacoes: string | null; created_at: string;
  usuarios: number; servicos: number; servicos_30d: number;
  ultimo_servico: string | null; ultimo_acesso: string | null; excecoes: number;
  /** a mensalidade que vale (da empresa, senão do plano; 0034) */
  mensalidade?: number | null;
  /** situação da assinatura no Asaas (null = sem cobrança) */
  cobranca?: SituacaoCobranca | null;
  vencimento?: string | null;
  /** 0049: a mensalidade começa no 1º crédito — 'esperando' (ainda não gastou) ou 'a_iniciar' (gastou, falta a cobrança) */
  inicio_cobranca?: "esperando" | "a_iniciar" | null;
}

export interface Plano {
  id: string; nome: string; descricao: string | null; cor: string; ordem: number; ativo: boolean;
  limite_usuarios?: number | null;
  /** mensalidade (0034; null = não definida) */
  preco_mensal?: number | null;
  /** false: recurso novo do catálogo nasce bloqueado neste plano */
  libera_recursos_novos?: boolean;
  /** aparece no autocadastro, o link de cadastro com pagamento (0040) */
  vende_no_site?: boolean;
}
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
/** Sessão de uso (0029): abre ao entrar, fecha depois de 30 min sem sinal. */
export interface AcessoEmpresa {
  id: number; user_id: string; quem: string; em: string; ultimo_em: string; ip: string | null;
  navegador: string | null; sistema: string | null; dispositivo: string | null; telas: number; ultima_tela: string | null;
}
/** Acessos recentes de uma empresa. Banco sem a 0029 (ou qualquer falha): null, e a seção some. */
export async function acessosDaEmpresa(id: string, limite = 50): Promise<AcessoEmpresa[] | null> {
  const r = await supabase.rpc("sa_acessos", { p_escritorio: id, p_limite: limite });
  return r.error ? null : ((r.data as AcessoEmpresa[]) ?? []);
}
/** Serviço com o imóvel assinado na 1ª geração (0039): 1 crédito = 1 imóvel. */
export interface ContornoServico { servico_id: string; denominacao: string; modalidade: string; area_ha: number; assinado_em: string }
/** Banco sem a 0039 (ou qualquer falha): null, e a seção some. */
export async function contornosDaEmpresa(id: string): Promise<ContornoServico[] | null> {
  const r = await supabase.rpc("sa_contornos_da_empresa", { p_escritorio: id });
  return r.error ? null : ((r.data as ContornoServico[]) ?? []);
}
/** O cliente refez o levantamento do MESMO imóvel: a próxima geração assina de novo. */
export const liberarContorno = async (servicoId: string): Promise<void> => {
  ok(await supabase.rpc("sa_liberar_contorno", { p_servico: servicoId }));
};
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

export async function atualizarEmpresa(id: string, dados: Partial<Pick<Empresa, "nome" | "cnpj" | "responsavel" | "telefone" | "email" | "plano_id" | "status" | "observacoes" | "mensalidade">>): Promise<void> {
  ok(await supabase.rpc("sa_atualizar_empresa", { p_escritorio: id, p_dados: dados }));
}

export async function definirRecursoEmpresa(id: string, chave: string, liberado: boolean | null, motivo?: string): Promise<void> {
  ok(await supabase.rpc("sa_definir_recurso_empresa", { p_escritorio: id, p_chave: chave, p_liberado: liberado, p_motivo: motivo ?? null }));
}

export async function salvarPlano(p: Partial<Plano> & { nome: string }): Promise<Plano> {
  const linha = {
    nome: p.nome.trim(), descricao: p.descricao ?? null, cor: p.cor ?? "#178552", ordem: p.ordem ?? 0, ativo: p.ativo ?? true,
    ...(p.limite_usuarios !== undefined ? { limite_usuarios: p.limite_usuarios || null } : {}),
    ...(p.preco_mensal !== undefined ? { preco_mensal: p.preco_mensal ?? null } : {}),
    ...(p.libera_recursos_novos !== undefined ? { libera_recursos_novos: p.libera_recursos_novos } : {}),
    ...(p.vende_no_site !== undefined ? { vende_no_site: p.vende_no_site } : {}),
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

// ---- créditos em carteiras e cobrança (0027 + 0034)
export interface TipoCredito { chave: string; nome: string; descricao: string | null; servicos: string[] | null; ordem: number; ativo: boolean }
export const listarTiposCredito = async (): Promise<TipoCredito[]> =>
  ok(await supabase.from("tipos_credito").select().eq("ativo", true).order("ordem")) ?? [];
/** plano → carteira → créditos por mês (null = sem limite; sem linha = 0) */
export async function creditosDosPlanos(): Promise<Record<string, Record<string, number | null>>> {
  const linhas = (ok(await supabase.from("plano_creditos").select()) ?? []) as { plano_id: string; tipo: string; por_mes: number | null }[];
  const m: Record<string, Record<string, number | null>> = {};
  for (const l of linhas) (m[l.plano_id] ??= {})[l.tipo] = l.por_mes;
  return m;
}
/** plano → carteira → faixas de preço */
export async function precosDosPlanos(): Promise<Record<string, Record<string, Faixa[]>>> {
  const linhas = (ok(await supabase.from("precos_credito").select().not("plano_id", "is", null)) ?? []) as { plano_id: string; tipo: string; a_partir_de: number; preco: number }[];
  const m: Record<string, Record<string, Faixa[]>> = {};
  for (const l of linhas) ((m[l.plano_id] ??= {})[l.tipo] ??= []).push({ a_partir_de: l.a_partir_de, preco: Number(l.preco) });
  for (const p of Object.values(m)) for (const f of Object.values(p)) f.sort((a, b) => a.a_partir_de - b.a_partir_de);
  return m;
}
export async function salvarCreditosPlano(planoId: string, tipo: string, porMes: number | null): Promise<void> {
  ok(await supabase.from("plano_creditos").upsert({ plano_id: planoId, tipo, por_mes: porMes }, { onConflict: "plano_id,tipo" }));
}
/** Tabela de preço de um plano (lista vazia = não vende) ou de uma empresa (null = volta à do plano). */
export async function salvarPrecos(alvo: { plano: string } | { empresa: string }, tipo: string, faixas: Faixa[] | null): Promise<void> {
  ok(await supabase.rpc("sa_definir_precos", {
    p_plano: "plano" in alvo ? alvo.plano : null, p_escritorio: "empresa" in alvo ? alvo.empresa : null, p_tipo: tipo, p_faixas: faixas,
  }));
}

export interface CreditoExtra {
  id: string; tipo: string; quantidade: number; preco: number | null; valor_unitario: number | null; descricao: string | null;
  origem: "pedido" | "manual" | "compra"; status: "pendente" | "aprovado" | "recusado" | "cancelado";
  observacao: string | null; created_at: string; resolvido_em: string | null; quem: string | null;
  link: string | null; pagamento: string | null; forma: string | null;
}
export interface CreditosEmpresa {
  periodo: { inicio: string; renova_em: string; dia: number };
  carteiras: Carteira[];
  servicos: Record<string, { disponivel: boolean; carteira: string | null; precisa_aceite: boolean }>;
  /** o que o plano dá e cobra (null quando a empresa está sem plano) */
  plano: {
    id: string; nome: string; preco_mensal: number | null;
    por_mes: Record<string, number | null>; tem_carteira: Record<string, boolean>; precos: Record<string, Faixa[]>;
  } | null;
  /** o que vale só para ela: chave presente = vence o plano */
  empresa: { mensalidade: number | null; por_mes: Record<string, number | null>; precos: Record<string, Faixa[]> };
  /** a mensalidade que vale */
  mensalidade: number | null;
  extras: CreditoExtra[];
  historico: { mes: string; por_tipo: Record<string, number>; total: number }[];
}
export interface PedidoPendente {
  id: string; escritorio_id: string; empresa: string; tipo: string; quantidade: number; preco: number | null;
  descricao: string | null; origem: "pedido" | "compra"; link: string | null; created_at: string;
}

export const creditosDaEmpresa = async (id: string): Promise<CreditosEmpresa> =>
  ok(await supabase.rpc("sa_creditos_empresa", { p_escritorio: id }));
/** Créditos por mês só desta empresa (seguirPlano = volta ao plano; porMes null = sem limite). */
export async function definirCreditosEmpresa(id: string, tipo: string, porMes: number | null, seguirPlano = false): Promise<void> {
  ok(await supabase.rpc("sa_definir_creditos_empresa", { p_escritorio: id, p_tipo: tipo, p_por_mes: porMes, p_seguir_plano: seguirPlano }));
}
export async function resolverPedidoCredito(id: string, aprovar: boolean, observacao?: string): Promise<void> {
  ok(await supabase.rpc("sa_resolver_pedido_credito", { p_id: id, p_aprovar: aprovar, p_observacao: observacao ?? null }));
}
export async function adicionarCreditos(id: string, tipo: string, quantidade: number, descricao?: string, preco?: number | null): Promise<void> {
  ok(await supabase.rpc("sa_adicionar_creditos", { p_escritorio: id, p_tipo: tipo, p_quantidade: quantidade, p_descricao: descricao ?? null, p_preco: preco ?? null }));
}

export interface PagamentoEmpresa {
  /** parcela = a 2ª em diante de uma compra parcelada no cartão (0040) */
  id: string; finalidade: "mensalidade" | "creditos" | "parcela"; asaas_id: string | null; valor: number; status: string;
  forma: string | null; link: string | null; vencimento: string | null; pago_em: string | null; criado_em: string;
  erro: string | null; descricao: string | null;
  /** 0040: compra do período parcelada (na 1ª parcela: quantas; nas outras: qual) e o período */
  parcelas?: number | null; parcela?: number | null; ciclo?: string | null;
}
export interface CobrancaEmpresa {
  mensalidade: number | null;
  pagamento_online: boolean;
  assinatura: {
    asaas_cliente_id: string | null; asaas_assinatura_id: string | null; valor: number | null; situacao: SituacaoCobranca;
    link_pagamento: string | null; proximo_vencimento: string | null; ultimo_pagamento_em: string | null;
    whatsapp_em: string | null; whatsapp_erro: string | null;
    /** 0040: período da assinatura (valor = o do período) */
    ciclo?: string | null;
    /** 0049: a mensalidade começa no 1º crédito gasto */
    inicio_no_primeiro_credito?: boolean;
    primeiro_credito_em?: string | null;
    mensalidade_iniciada_em?: string | null;
  } | null;
  /** 0037: o cartão (sem o token) e a compra automática */
  cartao?: CartaoPublico | null;
  recarga?: Record<string, RecargaCarteira>;
  pagamentos: PagamentoEmpresa[];
}
export const cobrancaDaEmpresa = async (id: string): Promise<CobrancaEmpresa> =>
  ok(await supabase.rpc("sa_cobranca_empresa", { p_escritorio: id }));
/** Pedidos esperando aprovação, de todas as empresas. Banco sem a 0027: lista vazia. */
export async function pedidosPendentes(): Promise<PedidoPendente[]> {
  const r = await supabase.rpc("sa_pedidos_credito_pendentes");
  return r.error ? [] : (r.data as PedidoPendente[]) ?? [];
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
export interface NovaEmpresa {
  cnpj: string; nome: string; responsavel: string; telefone: string; email: string; senha: string; plano_id: string | null;
  /** nasce sem acesso até pagar a 1ª mensalidade (0034) */
  aguardando_pagamento?: boolean;
  /** 0049: entra já e a mensalidade só começa no 1º crédito gasto */
  inicio_no_primeiro_credito?: boolean;
}
export const criarEmpresa = (d: NovaEmpresa) =>
  chamarFuncao<{ ok: true; escritorio_id: string; user_id: string; login: string }>("superadmin", { acao: "criar_empresa", ...d });

// ---------------------------------------------------------------- convites de cadastro (0049)

/** Link de cadastro de uso único: libera já e a mensalidade começa no 1º crédito gasto. */
export interface Convite {
  id: string; token: string; nome: string | null; plano_id: string; plano: string | null;
  criado_em: string; expira_em: string; usado_em: string | null; cancelado_em: string | null;
  escritorio_id: string | null; empresa: string | null;
  situacao: "aberto" | "usado" | "expirado" | "cancelado";
}
export const listarConvites = async (): Promise<Convite[]> => ok(await supabase.rpc("sa_convites")) ?? [];
export const criarConvite = async (plano: string, nome: string, dias: number): Promise<{ id: string; token: string; expira_em: string }> =>
  ok(await supabase.rpc("sa_criar_convite", { p_plano: plano, p_nome: nome || null, p_dias: dias }));
export const cancelarConvite = async (id: string): Promise<void> => { ok(await supabase.rpc("sa_cancelar_convite", { p_id: id })); };
/** O endereço que vai para o cliente (a página /cadastro/ leva ao #/assinar com o token). */
export const linkDoConvite = (token: string, origem = location.origin) => `${origem}/cadastro/?convite=${token}`;
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
    `Olá, ${nome}! O acesso da ${o.empresa} ao Vertces está pronto.`,
    ``,
    `Endereço: ${o.url}`,
    `Login: ${o.login}`,
    `Senha provisória: ${o.senha}`,
    ``,
    `No primeiro acesso o sistema pede para você criar a sua própria senha.`,
  ].join("\n");
}
