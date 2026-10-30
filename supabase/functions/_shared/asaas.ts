// Cliente da API v3 do Asaas: só o que a cobrança do Vertces usa.
//
// O `fetch` entra por parâmetro para os testes trocarem o Asaas por um falso
// (tests/cobranca.test.mjs). Erro do Asaas vira ErroAsaas com a descrição que
// ele mandou ("errors[0].description"), em português.

export type Ambiente = "sandbox" | "producao";

export const BASE_ASAAS: Record<Ambiente, string> = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  producao: "https://api.asaas.com/v3",
};

export const ambienteValido = (a: unknown): a is Ambiente => a === "sandbox" || a === "producao";

export class ErroAsaas extends Error {
  status: number;
  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.status = status;
  }
}

/** A descrição do primeiro erro que o Asaas devolveu. */
export function mensagemDoAsaas(corpo: unknown, padrao: string): string {
  const erros = (corpo as { errors?: { description?: string }[] } | null)?.errors;
  return erros?.[0]?.description || padrao;
}

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
}
export interface PixAsaas { encodedImage: string; payload: string; expirationDate?: string }
export interface WebhookAsaas {
  id: string; name?: string; url: string; enabled: boolean; interrupted: boolean;
  penalizedRequestsCount?: number; hasAuthToken?: boolean;
}

/** Eventos que o webhook do Vertces escuta. */
export const EVENTOS_WEBHOOK = [
  "PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_OVERDUE",
  "PAYMENT_DELETED", "PAYMENT_RESTORED", "PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED",
  "PAYMENT_REFUND_IN_PROGRESS", "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_CHARGEBACK_DISPUTE",
  "PAYMENT_AWAITING_CHARGEBACK_REVERSAL", "PAYMENT_RECEIVED_IN_CASH_UNDONE",
];

export function clienteAsaas(chave: string, ambiente: Ambiente, f: typeof fetch = fetch) {
  async function chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await f(BASE_ASAAS[ambiente] + caminho, {
        method: metodo,
        headers: { "Content-Type": "application/json", "access_token": chave, "User-Agent": "Vertces" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ErroAsaas(`Sem resposta do Asaas (${e instanceof Error ? e.message : e}).`, 0);
    }
    const texto = await r.text();
    let j: unknown = null;
    try { j = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
    if (r.status === 401) throw new ErroAsaas("O Asaas recusou a chave da API (confira a chave e o ambiente).", 401);
    if (!r.ok) throw new ErroAsaas(mensagemDoAsaas(j, `O Asaas respondeu ${r.status}.`), r.status);
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
    cobranca: (pagamento: string) => chamar<CobrancaAsaas>("GET", `/payments/${id(pagamento)}`),
    removerCobranca: (pagamento: string) => chamar<{ deleted: boolean }>("DELETE", `/payments/${id(pagamento)}`),
    pix: (pagamento: string) => chamar<PixAsaas>("GET", `/payments/${id(pagamento)}/pixQrCode`),

    criarAssinatura: (d: { customer: string; billingType: string; value: number; nextDueDate: string; cycle: string; description: string; externalReference?: string }) =>
      chamar<{ id: string }>("POST", "/subscriptions", d),
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
