// Créditos de serviço da empresa logada (migrações 0027 e 0034).
//
// O crédito mora em CARTEIRAS: a geral paga qualquer serviço; a de CAR, só o
// CAR. Um serviço gasta primeiro a carteira própria (o CAR gasta CAR) e, quando
// ela acaba, a geral — no CAR, só com o aceite de quem envia o arquivo. Dentro
// de cada carteira vem primeiro o crédito do mês e depois o extra comprado.
//
// Quem decide é o banco (gatilho em servicos): esta lib lê o retrato do período
// para a tela avisar antes, e manda o pedido de compra quando o pagamento
// online (Asaas) não está ligado. A compra online está em lib/cobranca.ts.
//
// Banco sem a 0034: `meus_creditos` vem no formato antigo → null, nada bloqueia.
import { supabase } from "./supabase";
import { avisarGlobal } from "./ux";
import { recursoDe } from "./recursos";
import type { ChaveServico } from "./modalidades";
import type { Faixa } from "../../supabase/functions/_shared/precos.ts";

export type { Faixa };

export interface Carteira {
  chave: string;
  nome: string;
  descricao: string | null;
  /** serviços que ela paga (null = todos) */
  servicos: string[] | null;
  /** créditos do mês (null = sem limite) */
  por_mes: number | null;
  usado: number;
  /** comprados ou dados, sem vencimento */
  extra: number;
  /** preço do crédito extra por faixa (vazio = não está à venda) */
  precos: Faixa[];
}

export type StatusCompra = "pendente" | "aprovado" | "recusado" | "cancelado";
export interface Compra {
  id: string; tipo: string; quantidade: number; valor: number | null; unitario: number | null;
  descricao: string | null; status: StatusCompra; origem: "pedido" | "manual" | "compra";
  created_at: string; link: string | null; pagamento: string | null;
}

export interface Creditos {
  periodo: { inicio: string; renova_em: string; dia: number };
  carteiras: Carteira[];
  servicos: Record<string, { disponivel: boolean; carteira: string | null; precisa_aceite: boolean }>;
  sou_dono: boolean;
  /** Asaas configurado: a compra gera cobrança e os créditos entram sozinhos */
  pagamento_online: boolean;
  compras: Compra[];
}

export async function carregarCreditos(): Promise<Creditos | null> {
  const { data, error } = await supabase.rpc("meus_creditos");
  if (error || !data || !Array.isArray((data as Creditos).carteiras)) return null;
  return data as Creditos;
}

const doServico = (c: Creditos | null, chave: ChaveServico) => c?.servicos[`servico.${chave}`];

/** O serviço ainda pode nascer? (sem a 0034, sempre) */
export const temCredito = (c: Creditos | null, chave: ChaveServico): boolean => doServico(c, chave)?.disponivel ?? true;

/** Só crédito geral paga este serviço agora, e ele tem carteira própria: pede o aceite. */
export const precisaAceite = (c: Creditos | null, chave: ChaveServico): boolean => doServico(c, chave)?.precisa_aceite ?? false;

export const carteiraDe = (c: Creditos, tipo: string): Carteira | undefined => c.carteiras.find((x) => x.chave === tipo);

/** Créditos do mês que sobram (null = sem limite). */
export const sobraDoMes = (k: Carteira): number | null => (k.por_mes === null ? null : Math.max(0, k.por_mes - k.usado));

/** Tudo o que a carteira ainda paga: o que sobra do mês + o extra (null = sem limite). */
export function disponivel(k: Carteira): number | null {
  const s = sobraDoMes(k);
  return s === null ? null : s + k.extra;
}

/** A carteira própria do serviço (a de CAR para o CAR); undefined = só a geral. */
export const carteiraPropria = (c: Creditos, chave: ChaveServico): Carteira | undefined =>
  c.carteiras.find((k) => k.servicos?.includes(`servico.${chave}`));

export const carteiraGeral = (c: Creditos): Carteira | undefined => c.carteiras.find((k) => k.servicos === null);

/** A carteira vende crédito extra neste plano. */
export const aVenda = (k: Carteira): boolean => k.precos.length > 0;

/** "crédito de CAR", "créditos gerais"… a partir do nome da carteira. */
export function nomeCredito(k: Pick<Carteira, "nome"> | undefined, n = 2): string {
  const base = (k?.nome ?? "Créditos").replace(/^Créditos\s*/i, "");
  if (n === 1) return `crédito ${base.replace(/^gerais$/i, "geral")}`.trim();
  return `créditos ${base}`.trim();
}

export const nomeDaChave = (chave: string): string => recursoDe(chave)?.nome ?? chave;

/** Erro do banco: o crédito acabou. */
export const ehSemCredito = (msg: string): boolean => msg.includes("SEM_CREDITO");
/** Erro do banco: só o crédito geral paga, e falta o aceite. */
export const ehAceiteGeral = (msg: string): boolean => msg.includes("ACEITE_CREDITO_GERAL");
/** Tira o prefixo técnico da mensagem do banco. */
export const textoSemCredito = (msg: string): string =>
  msg.replace(/^.*(SEM_CREDITO|ACEITE_CREDITO_GERAL):\s*/, "").replace(/^./, (x) => x.toUpperCase());

/** Pedido de créditos sem o pagamento online: o superadmin aprova depois de combinar o pagamento. */
export async function pedirCreditos(tipo: string, quantidade: number, observacao?: string): Promise<void> {
  const { error } = await supabase.rpc("pedir_creditos", { p_tipo: tipo, p_quantidade: quantidade, p_observacao: observacao ?? null });
  if (error) throw new Error(error.message);
}

export async function cancelarPedido(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancelar_pedido_credito", { p_id: id });
  if (error) throw new Error(error.message);
}

export const fmtPreco = (v: number | null): string =>
  v === null ? "a combinar" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "30 de outubro" de uma data "aaaa-mm-dd" (sem passar por fuso). */
export function diaMes(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

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

/** Texto do aviso depois de o serviço nascer, com o saldo já descontado. */
export function textoDoConsumo(c: Creditos, chave: ChaveServico, usouGeral = false): string {
  const nome = recursoDe(`servico.${chave}`)?.nome ?? "serviço";
  const k = usouGeral ? carteiraGeral(c) : carteiraPropria(c, chave) ?? carteiraGeral(c);
  if (!k) return `1 crédito foi usado ao enviar o arquivo de ${nome}.`;
  const r = disponivel(k);
  const usado = usouGeral
    ? `1 crédito geral foi usado no ${nome}, com o seu aceite.`
    : `1 ${nomeCredito(k, 1)} foi usado ao enviar o arquivo.`;
  const sobra = r === null ? `Seu plano não tem limite de ${nomeCredito(k)}.`
    : r === 0 ? `Era o último dos seus ${nomeCredito(k)}.`
      : `${r === 1 ? "Resta 1" : `Restam ${r}`} ${nomeCredito(k, r)}.`;
  return `${usado} ${sobra}`;
}

/** Chamar logo depois de o serviço nascer. Lê o saldo novo para dizer quanto sobra. */
export async function avisarConsumo(chave: ChaveServico, usouGeral = false): Promise<void> {
  const { data } = await supabase.auth.getUser();
  if (data.user?.user_metadata?.ocultar_aviso_credito) return;
  const c = await carregarCreditos();
  if (!c) return;
  aviso = { id: ++seq, texto: textoDoConsumo(c, chave, usouGeral) };
  mudou();
}

export async function naoExibirMaisAvisoCredito(): Promise<void> {
  fecharAvisoCredito();
  const { error } = await supabase.auth.updateUser({ data: { ocultar_aviso_credito: true } });
  if (error) avisarGlobal("erro", `Não foi possível guardar a preferência: ${error.message}`);
}
