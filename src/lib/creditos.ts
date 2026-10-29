// Créditos de serviço da empresa logada (migração 0027).
//
// Um crédito é gasto quando o arquivo de entrada é enviado (o serviço nasce).
// Quem decide é o banco (trigger em servicos): esta lib só lê o retrato do mês
// para a tela avisar antes e mostrar o saldo, e manda o pedido de compra.
//
// Banco sem a 0027: `meus_creditos` não existe → null, e nada é bloqueado.
import { supabase } from "./supabase";
import { avisarGlobal } from "./ux";
import { recursoDe } from "./recursos";
import type { ChaveServico } from "./modalidades";

export interface Saldo { limite: number | null; usado: number; extra: number }
export interface Pacote { id: string; nome: string; chave: string; quantidade: number; preco: number | null }
export interface PedidoCredito {
  id: string; chave: string; quantidade: number; preco: number | null; descricao: string | null;
  status: "pendente" | "aprovado" | "recusado" | "cancelado"; created_at: string;
}
export interface Creditos {
  mes: string;
  total: Saldo;
  servicos: Record<string, Saldo & { disponivel: boolean }>;
  sou_dono: boolean;
  pacotes: Pacote[];
  pedidos: PedidoCredito[];
}

export async function carregarCreditos(): Promise<Creditos | null> {
  const { data, error } = await supabase.rpc("meus_creditos");
  if (error || !data) return null;
  return data as Creditos;
}

/** O serviço ainda pode nascer este mês? (sem a 0027, sempre) */
export function temCredito(c: Creditos | null, chave: ChaveServico): boolean {
  if (!c) return true;
  return c.servicos[`servico.${chave}`]?.disponivel ?? true;
}

/** Quantos ainda cabem na franquia do mês (null = sem teto) + o extra que serve a este serviço. */
export function restantes(c: Creditos, chave: ChaveServico): number | null {
  const s = c.servicos[`servico.${chave}`];
  const sobra = (lim: number | null, usado: number) => (lim === null ? null : Math.max(0, lim - usado));
  const doServico = s ? sobra(s.limite, s.usado) : null;
  const doTotal = sobra(c.total.limite, c.total.usado);
  const franquia = doServico === null ? doTotal : doTotal === null ? doServico : Math.min(doServico, doTotal);
  if (franquia === null) return null;
  return franquia + (s?.extra ?? 0) + c.total.extra;
}

export const nomeDaChave = (chave: string): string =>
  chave === "total" ? "Qualquer serviço" : recursoDe(chave)?.nome ?? chave;

export const ehSemCredito = (msg: string): boolean => msg.includes("SEM_CREDITO");
/** Tira o prefixo técnico da mensagem do banco. */
export const textoSemCredito = (msg: string): string => msg.replace(/^.*SEM_CREDITO:\s*/, "");

export async function pedirCreditos(p: { pacote?: string; chave?: string; quantidade?: number; observacao?: string }): Promise<void> {
  const { error } = await supabase.rpc("pedir_creditos", {
    p_pacote: p.pacote ?? null, p_chave: p.chave ?? null, p_quantidade: p.quantidade ?? null, p_observacao: p.observacao ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function cancelarPedido(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancelar_pedido_credito", { p_id: id });
  if (error) throw new Error(error.message);
}

export const fmtPreco = (v: number | null): string =>
  v === null ? "a combinar" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ---------------------------------------------------------------------------
// Aviso de crédito gasto
// ---------------------------------------------------------------------------
//
// Aparece toda vez que um serviço nasce, até a pessoa marcar "Não exibir mais
// esse aviso" — a escolha fica na conta dela (user_metadata), não no navegador.

export interface AvisoCredito { id: number; texto: string }
let aviso: AvisoCredito | null = null;
let seq = 0;
const ouvintes = new Set<() => void>();
const mudou = () => ouvintes.forEach((f) => f());
export const assinarAvisoCredito = (f: () => void) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; };
export const avisoCreditoAtual = () => aviso;
export function fecharAvisoCredito(): void { aviso = null; mudou(); }

/** Chamar logo depois de o serviço nascer. Lê o saldo novo para dizer quanto sobra. */
export async function avisarConsumo(chave: ChaveServico): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (data.user?.user_metadata?.ocultar_aviso_credito) return;
  const c = await carregarCreditos();
  if (!c) return;
  const nome = recursoDe(`servico.${chave}`)?.nome ?? "serviço";
  const r = restantes(c, chave);
  const sobra = r === null ? "Seu plano não tem limite mensal para este serviço."
    : r === 0 ? "Este era o último crédito deste serviço no mês."
      : `${r === 1 ? "Resta 1 crédito" : `Restam ${r} créditos`} para este serviço.`;
  aviso = { id: ++seq, texto: `1 crédito de ${nome} foi usado ao enviar o arquivo. ${sobra}` };
  mudou();
}

export async function naoExibirMaisAvisoCredito(): Promise<void> {
  fecharAvisoCredito();
  const { error } = await supabase.auth.updateUser({ data: { ocultar_aviso_credito: true } });
  if (error) avisarGlobal("erro", `Não foi possível guardar a preferência: ${error.message}`);
}
