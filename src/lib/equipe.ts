// Equipe da empresa (migração 0025 + edge function `equipe`).
// Leitura e edição de permissões pelas RPCs; criar conta, redefinir senha e
// apagar conta pela edge function (só ela fala com o Auth).
import { chamarFuncao, supabase } from "./supabase";

export interface Membro {
  user_id: string; email: string; nome: string | null; cargo: string | null;
  papel: "dono" | "membro"; permissoes: string[]; ativo: boolean;
  desde: string; ultimo_acesso: string | null; senha_provisoria: boolean;
  /** a partir da 0029: o que a pessoa faz na empresa, e um telefone de contato */
  descricao?: string | null; telefone?: string | null;
}

export interface Atividade {
  id: number; acao: string; alvo: string | null; detalhe: Record<string, unknown> | null; created_at: string; quem: string;
  /** a partir da 0026 (auditoria) */
  user_id?: string | null; servico_id?: string | null; vezes?: number;
}

/** Quem criou e quem mexeu por último num serviço (0026). */
export interface Autoria { servico_id: string; criado_por: string | null; criado_em: string | null; atualizado_por: string | null; atualizado_em: string | null }

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
/**
 * Auditoria da empresa. Os filtros só vão ao banco quando usados: sem eles a
 * chamada é a mesma da 0025 e funciona antes da 0026 estar aplicada.
 */
export async function listarAtividades(limite = 150, filtro: { user?: string; servico?: string; antes?: string } = {}): Promise<Atividade[]> {
  const args: Record<string, unknown> = { p_limite: limite };
  if (filtro.user) args.p_user = filtro.user;
  if (filtro.servico) args.p_servico = filtro.servico;
  if (filtro.antes) args.p_antes = filtro.antes;
  return ok(await supabase.rpc("listar_atividades", args)) ?? [];
}

/** Autoria dos serviços pedidos. Banco sem a 0026: devolve vazio (a tela só não mostra). */
export async function autoriaServicos(ids: string[]): Promise<Record<string, Autoria>> {
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc("autoria_servicos", { p_ids: ids });
  if (error || !Array.isArray(data)) return {};
  return Object.fromEntries((data as Autoria[]).map((a) => [a.servico_id, a]));
}

export async function salvarMembro(m: Pick<Membro, "user_id" | "nome" | "cargo" | "permissoes" | "ativo" | "descricao" | "telefone">): Promise<void> {
  ok(await supabase.rpc("definir_membro", {
    p_user: m.user_id, p_nome: m.nome ?? "", p_cargo: m.cargo ?? "", p_permissoes: m.permissoes, p_ativo: m.ativo,
    p_descricao: m.descricao ?? "", p_telefone: m.telefone ?? "",
  }));
}

export interface PodeAdicionar { ok: boolean; motivo?: string; limite?: number | null; ativos?: number; sou_dono?: boolean }
export const podeAdicionar = async (): Promise<PodeAdicionar> => ok(await supabase.rpc("pode_adicionar_membro")) as PodeAdicionar;

/** `trocar`: a pessoa cria a própria senha no primeiro acesso. */
export interface Acesso { login: string; senha: string; trocar?: boolean }
/** Senha em branco = o sistema sorteia uma. */
export interface SenhaEscolhida { senha?: string; trocar: boolean }
export const criarMembro = (d: { email: string; nome: string; cargo: string; descricao: string; telefone: string; permissoes: string[] } & SenhaEscolhida) =>
  chamarFuncao<{ ok: true; user_id: string } & Acesso>("equipe", { acao: "criar", ...d });
export const novaSenha = (user_id: string, s: SenhaEscolhida = { trocar: true }) =>
  chamarFuncao<{ ok: true } & Acesso>("equipe", { acao: "redefinir_senha", user_id, ...s });

/** Mesma regra da edge function (senhaFraca): 8+ caracteres, letras e números. */
export function problemaDaSenha(s: string): string | null {
  if (s.length < 8) return "Use pelo menos 8 caracteres.";
  if (s.length > 72) return "Use no máximo 72 caracteres.";
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return "Misture letras e números.";
  return null;
}

/** 0 a 4, para a barrinha de força da senha. */
export function forcaDaSenha(s: string): number {
  if (!s) return 0;
  let f = 0;
  if (s.length >= 8) f++;
  if (s.length >= 12) f++;
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) f++;
  if (/\d/.test(s) && /[^A-Za-z0-9]/.test(s)) f++;
  return problemaDaSenha(s) ? Math.min(f, 1) : Math.max(f, 2);
}
export const apagarConta = (user_id: string) => chamarFuncao<{ ok: true }>("equipe", { acao: "remover", user_id });

/** Texto pronto para passar o acesso a quem entrou na equipe. */
export function mensagemDeAcesso(o: { nome: string; empresa: string; login: string; senha: string; trocar?: boolean }): string {
  const primeiro = o.nome.split(/\s+/)[0] || "";
  const trocar = o.trocar !== false;
  return [
    `Olá${primeiro ? `, ${primeiro}` : ""}! Seu acesso ao Vertces (${o.empresa}) está pronto.`,
    ``,
    `Endereço: ${location.origin}/app/`,
    `Login: ${o.login}`,
    `${trocar ? "Senha provisória" : "Senha"}: ${o.senha}`,
    ``,
    trocar ? `No primeiro acesso o sistema pede para você criar a sua própria senha.`
      : `Guarde esta senha. Para trocá-la, use Configurações → Minha conta.`,
  ].join("\n");
}

const ROTULOS: Record<string, string> = {
  "servico.criado": "criou o serviço",
  "servico.excluido": "excluiu o serviço",
  "servico.concluido": "concluiu o serviço",
  "servico.reaberto": "reabriu o serviço",
  "cliente.criado": "cadastrou o cliente",
  "cliente.excluido": "excluiu o cliente",
  "servico.alterado": "alterou o serviço",
  "vertices.alterados": "mexeu nos vértices de",
  "confrontantes.alterados": "mexeu nos confrontantes de",
  "glebas.alteradas": "mexeu nas glebas de",
  "loteamento.alterado": "mexeu no projeto do loteamento",
  "car.alterado": "mexeu no CAR",
  "cliente.alterado": "alterou o cliente",
  "cadastro.rt.criado": "cadastrou o responsável técnico",
  "cadastro.rt.alterado": "alterou o responsável técnico",
  "cadastro.rt.excluido": "excluiu o responsável técnico",
  "cadastro.credenciado.criado": "cadastrou o credenciado",
  "cadastro.credenciado.alterado": "alterou o credenciado",
  "cadastro.credenciado.excluido": "excluiu o credenciado",
  "empresa.configurada": "alterou",
  "documento.gerado": "gerou documentos de",
  "membro.adicionado": "adicionou à equipe",
  "membro.alterado": "alterou o acesso de",
  "membro.desativado": "desativou o acesso de",
  "membro.reativado": "reativou o acesso de",
  "membro.removido": "removeu da equipe",
  "membro.senha": "definiu uma senha nova para",
  "creditos.pedido": "pediu créditos:",
  "creditos.pagos": "pagou créditos:",
  "empresa.ativada": "acesso liberado:",
};
export const rotuloAtividade = (acao: string): string => ROTULOS[acao] ?? acao;

/** Categoria da ação, para os filtros e a cor do ponto na linha do tempo. */
export function categoriaAtividade(acao: string): "servicos" | "documentos" | "clientes" | "cadastros" | "equipe" {
  if (acao.startsWith("membro.")) return "equipe";
  if (acao.startsWith("documento.")) return "documentos";
  if (acao.startsWith("cliente.")) return "clientes";
  if (acao.startsWith("cadastro.") || acao.startsWith("empresa.")) return "cadastros";
  return "servicos";
}

// Nomes legíveis das colunas que aparecem em "campos" (o resto vira texto com espaços).
const CAMPOS: Record<string, string> = {
  denominacao: "denominação", municipio: "município", uf: "UF", fuso_utm: "fuso", detentor_nome: "detentor",
  detentor_cpf: "CPF/CNPJ do detentor", detentor_genero: "gênero do detentor", endereco_detentor: "endereço do detentor",
  cliente_id: "cliente", credenciado_id: "credenciado", rt_id: "responsável técnico", trt: "TRT", matricula: "matrícula",
  cns: "CNS", codigo_sncr: "código SNCR", situacao: "situação", natureza_area: "natureza da área",
  natureza_servico: "natureza do serviço", tipo_pessoa: "tipo de pessoa", tipo_imovel: "matrícula ou posse",
  vertice_inicial: "vértice inicial", status: "situação do serviço", is_espolio: "espólio",
  inventariante_nome: "inventariante", inventariante_cpf: "CPF do inventariante", inventariante_rg: "RG do inventariante",
  area_matricula_ha: "área da matrícula", denominacao_parcela: "denominação da parcela", parcela_numero: "número da parcela",
  lado: "lado", tem_glebas: "glebas", divisao: "divisão", modalidade: "modalidade", nome: "nome", cpf_cnpj: "CPF/CNPJ",
  telefone: "telefone", email: "e-mail", endereco: "endereço", crea: "CREA", cpf: "CPF", prefixo_vertice: "prefixo dos vértices",
  razao_social: "razão social", cnpj: "CNPJ", desenhista: "desenhista", rt_padrao: "RT padrão", credenciado_padrao: "credenciado padrão",
  // cliente (0029)
  rg: "RG", rg_orgao: "órgão emissor do RG", data_nascimento: "nascimento", nacionalidade: "nacionalidade",
  estado_civil: "estado civil", regime_bens: "regime de bens", profissao: "profissão", conjuge_nome: "cônjuge",
  conjuge_cpf: "CPF do cônjuge", telefone2: "segundo telefone", cep: "CEP", cidade: "cidade",
  representante_nome: "representante", representante_cpf: "CPF do representante", origem: "origem do cliente",
  observacoes: "observações", genero: "gênero",
  // empresa (Configurações)
  telefone_empresa: "telefone da empresa", email_empresa: "e-mail da empresa", site: "site",
  endereco_empresa: "endereço da empresa", cidade_empresa: "cidade da empresa", uf_empresa: "UF da empresa", cep_empresa: "CEP da empresa",
};
export const rotuloCampo = (c: string): string => CAMPOS[c] ?? c.replace(/_/g, " ");
