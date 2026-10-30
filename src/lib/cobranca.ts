// Pagamentos pelo Asaas (migração 0034 + edge function `cobranca`).
//
// A empresa compra créditos (gera uma cobrança com Pix, boleto ou cartão; os
// créditos entram sozinhos quando o Asaas confirma) e vê a mensalidade em
// aberto. O superadmin configura a chave do Asaas e o WhatsApp e cobra a
// mensalidade das empresas. Quem fala com o Asaas é sempre a função.
import { chamarFuncao, supabase } from "./supabase";

export interface Pix { encodedImage: string; payload: string; expirationDate?: string }

let falsa: ((body: Record<string, unknown>) => Promise<unknown>) | null = null;
/** Só os laboratórios (dev): responde no lugar da função. */
export function definirCobrancaFalsa(f: typeof falsa): void { falsa = f; }

const chamar = <T>(body: Record<string, unknown>): Promise<T> =>
  falsa ? (falsa(body) as Promise<T>) : chamarFuncao<T>("cobranca", body);

// ---------------------------------------------------------------- a empresa

export interface ResultadoCompra {
  credito_id: string; valor: number; descricao: string; link: string | null; pix: Pix | null;
  /** sem pagamento online, a compra virou pedido */
  pedido?: unknown;
}
export const comprarCreditos = (tipo: string, quantidade: number) =>
  chamar<ResultadoCompra>({ acao: "comprar_creditos", tipo, quantidade });
export const pixDaCompra = (creditoId: string) =>
  chamar<{ pix: Pix | null; link: string | null }>({ acao: "pix", credito_id: creditoId });
export const cancelarCompra = (creditoId: string) =>
  chamar<{ ja_paga?: boolean }>({ acao: "cancelar_compra", credito_id: creditoId });
/** Pergunta ao Asaas pelo que está em aberto (a rede de segurança do webhook). */
export const conferirPagamentos = (escritorioId?: string) =>
  chamar<{ conferidos: number; mudancas: string[] }>({ acao: "conferir", ...(escritorioId ? { escritorio_id: escritorioId } : {}) });

export type SituacaoCobranca = "sem_assinatura" | "aguardando" | "em_dia" | "atrasada" | "cancelada";
export interface MinhaCobranca {
  status: string; empresa: string; plano: string | null; valor: number | null;
  situacao: SituacaoCobranca; link: string | null; vencimento: string | null; sou_dono: boolean;
}
/** A mensalidade da empresa da pessoa (funciona antes de a empresa ser ativada). */
export async function minhaCobranca(): Promise<MinhaCobranca | null> {
  const { data, error } = await supabase.rpc("minha_cobranca");
  return error ? null : (data as MinhaCobranca | null);
}

// ---------------------------------------------------------------- o superadmin

export interface StatusPagamentos {
  asaas: {
    configurado: boolean; ambiente?: "sandbox" | "producao"; chave_final?: string; saldo?: number | null; erro?: string | null;
    webhook?: { url?: string; ativo?: boolean; interrompido?: boolean; penalizados?: number; erro?: string } | null;
  };
  whatsapp: { configurado: boolean; url?: string; instancia?: string; estado?: string | null };
  url_app: string;
  ultimo_evento: { evento: string; resultado: string | null; recebido_em: string } | null;
}
export const statusPagamentos = () => chamar<StatusPagamentos>({ acao: "config_status" });
export const salvarPagamentos = (d: Record<string, unknown>) =>
  chamar<StatusPagamentos>({ acao: "config_salvar", url_webhook: urlWebhook(), ...d });
export const testarWhatsApp = (telefone: string) => chamar<{ ok: true }>({ acao: "whatsapp_testar", telefone });

export interface ResultadoCobranca {
  link: string; valor: number; vencimento: string | null; mensagem: string;
  whatsapp: { configurado: boolean; enviado: boolean; erro?: string };
}
export const cobrarEmpresa = (d: { escritorio_id: string; enviar_whatsapp?: boolean; login?: string; senha?: string }) =>
  chamar<ResultadoCobranca>({ acao: "cobrar_empresa", ...d });
export const atualizarAssinatura = (escritorioId: string) => chamar<{ valor: number }>({ acao: "atualizar_assinatura", escritorio_id: escritorioId });
export const cancelarAssinatura = (escritorioId: string) => chamar<{ ok: true }>({ acao: "cancelar_assinatura", escritorio_id: escritorioId });

/** Onde o Asaas avisa os pagamentos: a função, com o marcador de origem. */
export function urlWebhook(): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/functions/v1/cobranca?origem=asaas`;
}

export const ROTULO_SITUACAO: Record<SituacaoCobranca, string> = {
  sem_assinatura: "Sem cobrança", aguardando: "Aguardando pagamento", em_dia: "Em dia", atrasada: "Atrasada", cancelada: "Cancelada",
};

/** Situação de uma cobrança do Asaas em português. */
export function rotuloPagamento(status: string | null | undefined): string {
  switch (status) {
    case "CRIANDO": return "Gerando";
    case "PENDING": return "Aguardando";
    case "OVERDUE": return "Vencida";
    case "CONFIRMED": case "RECEIVED": case "RECEIVED_IN_CASH": return "Pago";
    case "REFUNDED": case "PARTIALLY_REFUNDED": case "REFUND_REQUESTED": case "REFUND_IN_PROGRESS": return "Estornado";
    case "DELETED": case "CANCELADO": return "Cancelado";
    case "AWAITING_RISK_ANALYSIS": return "Em análise";
    default: return status ?? "—";
  }
}
export const FORMA: Record<string, string> = { PIX: "Pix", BOLETO: "Boleto", CREDIT_CARD: "Cartão", UNDEFINED: "—" };
