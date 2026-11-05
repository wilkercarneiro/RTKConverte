// Cliente da API v3 do Asaas: só o que a cobrança do Vertces usa.
//
// O `fetch` entra por parâmetro para os testes trocarem o Asaas por um falso
// (tests/cobranca.test.mjs). Erro do Asaas vira ErroAsaas com a descrição que
// ele mandou ("errors[0].description"), em português.

import type { CartaoAsaas, TitularAsaas } from "./cartao.ts";

export type Ambiente = "sandbox" | "producao";

export const BASE_ASAAS: Record<Ambiente, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  producao: "https://api.asaas.com/v3",
};

export const ambienteValido = (a: unknown): a is Ambiente => a === "sandbox" || a === "producao";

export class ErroAsaas extends Error {
  status: number;
  /** o `code` do primeiro erro ("invalid_creditCard", "invalid_value"…) */
  codigo: string | null;
  constructor(mensagem: string, status: number, codigo: string | null = null) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

/** A descrição do primeiro erro que o Asaas devolveu. */
export function mensagemDoAsaas(corpo: unknown, padrao: string): string {
  const erros = (corpo as { errors?: { description?: string }[] } | null)?.errors;
  return erros?.[0]?.description || padrao;
}
const codigoDoAsaas = (corpo: unknown): string | null =>
  (corpo as { errors?: { code?: string }[] } | null)?.errors?.[0]?.code ?? null;

export interface CobrancaAsaas {
  id: string;
  status: string;
  value: number;
  dueDate: string;
  invoiceUrl?: string;
  bankSlipUrl?: string;
  billingType?: string;
  subscription?: string | null;
  externalReference?: string | null;
  deleted?: boolean;
  /** pago no cartão: o Asaas pode devolver o token junto (com a tokenização liberada) */
  creditCard?: CartaoDaCobranca | null;
  /** compra parcelada: o id do parcelamento (igual em todas as parcelas) e o número desta */
  installment?: string | null;
  installmentNumber?: number | null;
}
export interface CartaoDaCobranca { creditCardNumber?: string; creditCardBrand?: string; creditCardToken?: string | null }
export interface AssinaturaAsaas {
  id: string; status?: string; nextDueDate?: string; billingType?: string; value?: number; deleted?: boolean;
  creditCard?: CartaoDaCobranca | null;
}
/** O cartão: os dados digitados (só nesta chamada) ou o token. */
export type CartaoParaAsaas =
  | { creditCard: CartaoAsaas; creditCardHolderInfo: TitularAsaas; creditCardToken?: undefined }
  | { creditCardToken: string; creditCard?: undefined; creditCardHolderInfo?: undefined };
export interface PixAsaas { encodedImage: string; payload: string; expirationDate?: string }
export interface WebhookAsaas {
  id: string; name?: string; url: string; enabled: boolean; interrupted: boolean;
  penalizedRequestsCount?: number; hasAuthToken?: boolean;
  /** os eventos que o Asaas manda para este webhook */
  events?: string[];
}

/**
 * Eventos que o webhook do Vertces escuta. Mudou a lista: o superadmin clica em
 * "Religar o webhook" (Configurações → Pagamentos) para o Asaas passar a mandar.
 */
export const EVENTOS_WEBHOOK = [
  "PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE",
  "PAYMENT_DELETED", "PAYMENT_RESTORED", "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS", "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL", "PAYMENT_RECEIVED_IN_CASH_UNDONE",
  // 0040 (autocadastro): análise de risco do cartão e captura recusada
  "PAYMENT_AWAITING_RISK_ANALYSIS", "PAYMENT_APPROVED_BY_RISK_ANALYSIS", "PAYMENT_REPROVED_BY_RISK_ANALYSIS",
  "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED",
];

export function clienteAsaas(chave: string, ambiente: Ambiente, f: typeof fetch = fetch) {
  // cartão: o Asaas pede 60 s de espera (a operadora pode demorar)
  async function chamar<T>(metodo: string, caminho: string, corpo?: unknown, espera = 20_000): Promise<T> {
    let r: Response;
    try {
      r = await f(BASE_ASAAS[ambiente] + caminho, {
        method: metodo,
        headers: { "Content-Type": "application/json", "access_token": chave, "User-Agent": "Vertces" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(espera),
      });
    } catch (e) {
      throw new ErroAsaas(`Sem resposta do Asaas (${e instanceof Error ? e.message : e}).`, 0);
    }
    const texto = await r.text();
    let j: unknown = null;
    try { j = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
    if (r.status === 401) throw new ErroAsaas("O Asaas recusou a chave da API (confira a chave e o ambiente).", 401);
    if (!r.ok) throw new ErroAsaas(mensagemDoAsaas(j, `O Asaas respondeu ${r.status}.`), r.status, codigoDoAsaas(j));
    return j as T;
  }
  const id = encodeURIComponent;

  return {
    saldo: () => chamar<{ balance: number }>("GET", "/finance/balance"),

    async buscarCliente(cpfCnpj: string): Promise<{ id: string } | null> {
      const r = await chamar<{ data?: { id: string; deleted?: boolean }[] }>("GET", `/customers?cpfCnpj=${id(cpfCnpj)}&limit=10`);
      return r.data?.find((c) => !c.deleted) ?? null;
    },
    criarCliente: (d: { name: string; cpfCnpj: string; email?: string | null; mobilePhone?: string | null; externalReference?: string }) =>
      chamar<{ id: string }>("POST", "/customers", d),

    criarCobranca: (d: { customer: string; billingType: string; value: number; dueDate: string; description: string; externalReference?: string }) =>
      chamar<CobrancaAsaas>("POST", "/payments", d),
    /** Cobra o cartão na hora: aprovada = 200 (CONFIRMED); recusada = ErroAsaas 400. */
    cobrarNoCartao: (d: { customer: string; value: number; dueDate: string; description: string; externalReference?: string; remoteIp: string } & CartaoParaAsaas) =>
      chamar<CobrancaAsaas>("POST", "/payments", { billingType: "CREDIT_CARD", ...d }, 60_000),
    /**
     * Compra parcelada no cartão, cobrada na hora (autocadastro): `installmentCount`
     * com `totalValue` (sem juros: o Asaas divide e põe a diferença na última) ou
     * `installmentValue` (com juros, calculado por nós). Aprovada = 200 com a 1ª
     * parcela e o id do parcelamento em `installment`; recusada = ErroAsaas 400
     * (e nada fica no Asaas). `value` só vai se a conta exigir (ver fluxos.ts).
     */
    cobrarParcelado: (d: {
      customer: string; dueDate: string; installmentCount: number; totalValue?: number; installmentValue?: number; value?: number;
      description: string; externalReference?: string; remoteIp: string;
    } & CartaoParaAsaas) =>
      chamar<CobrancaAsaas>("POST", "/payments", { billingType: "CREDIT_CARD", ...d }, 60_000),
    /** Paga uma cobrança que já existe (a mensalidade em aberto) com o cartão. */
    pagarComCartao: (pagamento: string, d: CartaoParaAsaas & { remoteIp?: string }) =>
      chamar<CobrancaAsaas>("POST", `/payments/${id(pagamento)}/payWithCreditCard`, d, 60_000),
    /** Guarda o cartão no Asaas sem cobrar. Sem a tokenização liberada: ErroAsaas 403. */
    tokenizar: (d: { customer: string; remoteIp: string; creditCard: CartaoAsaas; creditCardHolderInfo: TitularAsaas }) =>
      chamar<{ creditCardToken: string; creditCardNumber?: string; creditCardBrand?: string }>("POST", "/creditCard/tokenizeCreditCard", d, 60_000),
    cobranca: (pagamento: string) => chamar<CobrancaAsaas>("GET", `/payments/${id(pagamento)}`),
    removerCobranca: (pagamento: string) => chamar<{ deleted: boolean }>("DELETE", `/payments/${id(pagamento)}`),
    pix: (pagamento: string) => chamar<PixAsaas>("GET", `/payments/${id(pagamento)}/pixQrCode`),

    criarAssinatura: (d: { customer: string; billingType: string; value: number; nextDueDate: string; cycle: string; description: string; externalReference?: string }) =>
      chamar<AssinaturaAsaas>("POST", "/subscriptions", d),
    /** Assinatura no cartão: o Asaas valida o cartão; vencendo hoje, cobra na hora. */
    criarAssinaturaNoCartao: (d: { customer: string; value: number; nextDueDate: string; cycle: string; description: string; externalReference?: string; remoteIp: string } & CartaoParaAsaas) =>
      chamar<AssinaturaAsaas>("POST", "/subscriptions", { billingType: "CREDIT_CARD", ...d }, 60_000),
    assinatura: (assinatura: string) => chamar<AssinaturaAsaas>("GET", `/subscriptions/${id(assinatura)}`),
    async cobrancasDaAssinatura(assinatura: string): Promise<CobrancaAsaas[]> {
      return (await chamar<{ data?: CobrancaAsaas[] }>("GET", `/subscriptions/${id(assinatura)}/payments`)).data ?? [];
    },
    atualizarAssinatura: (assinatura: string, d: { value?: number; description?: string; updatePendingPayments?: boolean }) =>
      chamar<{ id: string }>("PUT", `/subscriptions/${id(assinatura)}`, d),
    removerAssinatura: (assinatura: string) => chamar<{ deleted: boolean }>("DELETE", `/subscriptions/${id(assinatura)}`),

    async listarWebhooks(): Promise<WebhookAsaas[]> {
      return (await chamar<{ data?: WebhookAsaas[] }>("GET", "/webhooks?limit=100")).data ?? [];
    },
    webhook: (w: string) => chamar<WebhookAsaas>("GET", `/webhooks/${id(w)}`),
    criarWebhook: (d: Record<string, unknown>) => chamar<WebhookAsaas>("POST", "/webhooks", d),
    atualizarWebhook: (w: string, d: Record<string, unknown>) => chamar<WebhookAsaas>("PUT", `/webhooks/${id(w)}`, d),
  };
}

export type ClienteAsaas = ReturnType<typeof clienteAsaas>;

/** Configura (ou religa) o webhook do Vertces na conta: mesmo endereço = atualiza. */
export async function garantirWebhook(asaas: ClienteAsaas, o: { url: string; token: string; email: string; idAtual?: string | null }): Promise<WebhookAsaas> {
  const lista = await asaas.listarWebhooks();
  const existente = lista.find((w) => w.url === o.url) ?? (o.idAtual ? lista.find((w) => w.id === o.idAtual) : undefined);
  const corpo = {
    name: "Vertces", url: o.url, email: o.email, enabled: true, interrupted: false,
    authToken: o.token, sendType: "SEQUENTIALLY", events: EVENTOS_WEBHOOK,
  };
  return existente
    ? asaas.atualizarWebhook(existente.id, corpo)
    : asaas.criarWebhook({ ...corpo, apiVersion: 3 });
}

/** A cobrança está paga (o dinheiro entrou ou vai entrar). */
export const cobrancaPaga = (status: string | undefined): boolean =>
  status === "RECEIVED" || status === "CONFIRMED" || status === "RECEIVED_IN_CASH";
