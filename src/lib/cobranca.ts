// Pagamentos pelo Asaas (migração 0034 + edge function `cobranca`).
//
// A empresa compra créditos (gera uma cobrança com Pix, boleto ou cartão; os
// créditos entram sozinhos quando o Asaas confirma) e vê a mensalidade em
// aberto. O superadmin configura a chave do Asaas e o WhatsApp e cobra a
// mensalidade das empresas. Quem fala com o Asaas é sempre a função.
import { chamarFuncao, supabase } from "./supabase";
import type { CartaoPublico, RecargaCarteira } from "./creditos_regras";
import type { CartaoDigitado, TitularDigitado } from "../../supabase/functions/_shared/cartao.ts";

export type { CartaoPublico, RecargaCarteira };

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
/** `forma: "cartao"` paga na hora com o cartão salvo (sem Pix). */
export const comprarCreditos = (tipo: string, quantidade: number, forma?: "cartao") =>
  chamar<ResultadoCompra & { pago?: boolean }>({ acao: "comprar_creditos", tipo, quantidade, ...(forma ? { forma } : {}) });
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
  /** 0037 */
  pagamento_online?: boolean;
  cartao?: CartaoPublico | null;
  /** paga algo (mensalidade ou crédito à venda) e não tem cartão: mostra o aviso */
  precisa_cartao?: boolean;
  contato?: { email: string | null; telefone: string | null; cnpj: string | null; responsavel: string | null };
}

// ---------------------------------------------------------------- o cartão (0037)

export interface ResultadoCartao {
  /** o cartão também compra créditos (o Asaas guardou o token) */
  reutilizavel: boolean; bandeira: string | null; final: string;
  /** mensalidades pagas agora com ele; ativou = a empresa foi liberada */
  pagas: number; ativou: boolean; assinatura: string | null;
}
export const salvarCartao = (cartao: CartaoDigitado, titular: TitularDigitado) =>
  chamar<ResultadoCartao>({ acao: "cartao_salvar", cartao, titular });
export const removerCartao = () => chamar<{ ok: true }>({ acao: "cartao_remover" });

export interface CompraAutomatica { tipo: string; descricao: string; valor: number; ok: boolean; erro?: string }
/** Compra os créditos das carteiras zeradas que têm a compra automática ligada (o servidor decide). */
export const recargaAutomatica = (tipo?: string) =>
  chamar<{ compras: CompraAutomatica[]; motivos: Record<string, string> }>({ acao: "recarga_automatica", ...(tipo ? { tipo } : {}) });

export async function definirRecarga(tipo: string, ativo: boolean, quantidade: number, limite: number | null): Promise<Record<string, RecargaCarteira>> {
  if (falsa) return (await falsa({ acao: "definir_recarga", tipo, ativo, quantidade, limite })) as Record<string, RecargaCarteira>;
  const { data, error } = await supabase.rpc("definir_recarga_automatica", { p_tipo: tipo, p_ativo: ativo, p_quantidade: quantidade, p_limite: limite });
  if (error) throw new Error(error.message);
  return data as Record<string, RecargaCarteira>;
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
    /** a conta guarda cartões (tokenização)? Sem ela, o cartão só paga a mensalidade */
    tokenizacao?: "liberada" | "bloqueada" | null;
  };
  whatsapp: { configurado: boolean; url?: string; instancia?: string; estado?: string | null };
  url_app: string;
  ultimo_evento: { evento: string; resultado: string | null; recebido_em: string } | null;
}
export const statusPagamentos = () => chamar<StatusPagamentos>({ acao: "config_status" });
export const salvarPagamentos = (d: Record<string, unknown>) =>
  chamar<StatusPagamentos>({ acao: "config_salvar", url_webhook: urlWebhook(), ...d });
export const testarWhatsApp = (telefone: string) => chamar<{ ok: true }>({ acao: "whatsapp_testar", telefone });
/** QR Code para conectar o número das cobranças (sem qrcode = já conectado). */
export const qrcodeWhatsApp = () => chamar<{ estado: string | null; qrcode?: string }>({ acao: "whatsapp_qrcode" });
export const estadoWhatsApp = () => chamar<{ configurado: boolean; estado: string | null }>({ acao: "whatsapp_estado" });

export interface ResultadoCobranca {
  link: string; valor: number; vencimento: string | null; mensagem: string;
  whatsapp: { configurado: boolean; enviado: boolean; erro?: string };
}
export const cobrarEmpresa = (d: { escritorio_id: string; enviar_whatsapp?: boolean; login?: string; senha?: string; liberada?: boolean }) =>
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
