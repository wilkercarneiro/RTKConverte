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
import { carteiraGeral, carteiraPropria, disponivel, nomeCredito } from "./creditos_regras";
import type { Creditos } from "./creditos_regras";

// tipos, saldo e custo: regras puras (testáveis no Node) — reexportadas aqui
export * from "./creditos_regras";

export async function carregarCreditos(): Promise<Creditos | null> {
  const { data, error } = await supabase.rpc("meus_creditos");
  if (error || !data || !Array.isArray((data as Creditos).carteiras)) return null;
  return data as Creditos;
}

export const nomeDaChave = (chave: string): string => recursoDe(chave)?.nome ?? chave;

/** Pedido de créditos sem o pagamento online: o superadmin aprova depois de combinar o pagamento. */
export async function pedirCreditos(tipo: string, quantidade: number, observacao?: string): Promise<void> {
  const { error } = await supabase.rpc("pedir_creditos", { p_tipo: tipo, p_quantidade: quantidade, p_observacao: observacao ?? null });
  if (error) throw new Error(error.message);
}

export async function cancelarPedido(id: string): Promise<void> {
  const { error } = await supabase.rpc("cancelar_pedido_credito", { p_id: id });
  if (error) throw new Error(error.message);
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
  if (!k) return `1 crédito foi usado no ${nome}.`;
  const r = disponivel(k);
  const usado = usouGeral
    ? `1 crédito geral foi usado no ${nome}, com o seu aceite.`
    : `1 ${nomeCredito(k, 1)} foi usado no ${nome}.`;
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
