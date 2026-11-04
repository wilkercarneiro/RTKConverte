// Travas contra abuso das edge functions (auditoria de segurança, 04/11/2026).
//
// 1. `lerJson`: lê o corpo com teto de bytes ANTES de interpretar. Sem isso, um
//    JSON de centenas de MB estoura a memória do worker (256 MB) e derruba as
//    outras funções que dividem o mesmo serviço na VPS.
// 2. `dentroDoLimite`: conta chamadas por chave numa janela (tabela limites_uso,
//    migração 0038, função consumir_limite só para a service_role). Se a
//    migração ainda não estiver no banco, a RPC falha e a trava NÃO bloqueia:
//    o limite é proteção extra, não pode derrubar o sistema.
//
// Como os demais módulos de _shared, não usa `Deno` nem importa supabase-js.

export class CorpoInvalido extends Error {
  status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

const MB = 1024 * 1024;

/** Lê o corpo como texto, recusando o que passar de `maxBytes` (413). */
export async function lerTexto(req: Request, maxBytes: number): Promise<string> {
  const declarado = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declarado) && declarado > maxBytes) {
    throw new CorpoInvalido(413, `Envio grande demais (limite de ${Math.round(maxBytes / MB)} MB).`);
  }
  if (!req.body) return "";
  const leitor = req.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await leitor.cancel().catch(() => {});
      throw new CorpoInvalido(413, `Envio grande demais (limite de ${Math.round(maxBytes / MB)} MB).`);
    }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { tudo.set(p, pos); pos += p.byteLength; }
  return new TextDecoder().decode(tudo);
}

/** Lê o corpo como JSON com teto de bytes. Corpo vazio ou inválido: 400. */
// deno-lint-ignore no-explicit-any
export async function lerJson(req: Request, maxBytes: number): Promise<any> {
  const texto = await lerTexto(req, maxBytes);
  try {
    return JSON.parse(texto);
  } catch {
    throw new CorpoInvalido(400, "Corpo da requisição inválido.");
  }
}

export const LIMITE_MB = (n: number) => n * MB;

/** O mínimo do supabase-js (cliente service_role) que a trava usa. */
export interface ClienteLimite {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * true = pode seguir. Conta 1 uso de `chave` na janela de `janelaS` segundos e
 * recusa quando passa de `max`. Erro no banco libera (ver cabeçalho).
 */
export async function dentroDoLimite(svc: ClienteLimite, chave: string, max: number, janelaS: number): Promise<boolean> {
  try {
    const { data, error } = await svc.rpc("consumir_limite", { p_chave: chave, p_max: max, p_janela_s: janelaS });
    if (error) return true;
    return data !== false;
  } catch {
    return true;
  }
}

export const MUITAS_CHAMADAS = {
  erro: "Muitas solicitações seguidas. Aguarde um minuto e tente de novo.",
  status: 429,
};
