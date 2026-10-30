// Envio de WhatsApp pela Evolution API (a mesma que o GPROL usa na VPS).
//
// A cobrança manda o link de pagamento para o telefone da empresa e avisa
// quando o pagamento confirma. Sem configuração, nada é enviado: a tela mostra
// a mensagem pronta e o botão do wa.me, como antes.

export interface ConfigWhatsApp { url: string; chave: string; instancia: string }

export const whatsappConfigurado = (c: Partial<ConfigWhatsApp> | null | undefined): c is ConfigWhatsApp =>
  !!c?.url && !!c.chave && !!c.instancia;

/** Número no formato da Evolution (DDI + DDD + número). null = inválido. */
export function numeroWhatsApp(telefone: string | null | undefined): string | null {
  const d = String(telefone ?? "").replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

const base = (c: ConfigWhatsApp) => c.url.trim().replace(/\/+$/, "");

export async function enviarWhatsApp(c: ConfigWhatsApp, telefone: string | null | undefined, texto: string, f: typeof fetch = fetch):
  Promise<{ ok: true } | { ok: false; erro: string }> {
  const numero = numeroWhatsApp(telefone);
  if (!numero) return { ok: false, erro: "Telefone da empresa inválido para WhatsApp (use DDD + número)." };
  try {
    const r = await f(`${base(c)}/message/sendText/${encodeURIComponent(c.instancia)}`, {
      method: "POST",
      headers: { apikey: c.chave, "Content-Type": "application/json" },
      body: JSON.stringify({ number: numero, text: texto }),
      signal: AbortSignal.timeout(15_000),
    });
    let j: { status?: string; error?: string; response?: { message?: unknown } } = {};
    try { j = await r.json(); } catch { /* sem JSON */ }
    if (!r.ok || j.status === "error" || (typeof j.error === "string" && j.error)) {
      const detalhe = typeof j.response?.message === "string" ? j.response.message : Array.isArray(j.response?.message) ? JSON.stringify(j.response.message) : j.error;
      return { ok: false, erro: `A Evolution recusou o envio (${r.status}${detalhe ? `: ${detalhe}` : ""}).` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: `Sem resposta da Evolution (${e instanceof Error ? e.message : e}).` };
  }
}

/** Estado da instância: "open" = conectada. null = sem resposta. */
export async function estadoWhatsApp(c: ConfigWhatsApp, f: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await f(`${base(c)}/instance/connectionState/${encodeURIComponent(c.instancia)}`, {
      headers: { apikey: c.chave }, signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    const j = await r.json() as { instance?: { state?: string }; state?: string };
    return j.instance?.state ?? j.state ?? null;
  } catch {
    return null;
  }
}
