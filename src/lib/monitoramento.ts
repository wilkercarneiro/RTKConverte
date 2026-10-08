// Erros do navegador para o Sentry, sem SDK (só fetch no endpoint de envelope).
//
// Liga sozinho quando VITE_SENTRY_DSN está definido (Vercel → Environment
// Variables). Sem a variável não faz nada. Não envia dado pessoal: nem e-mail,
// nem conteúdo de formulário — só a mensagem, a pilha e a rota (#/servico/{id}).
// O alerta por e-mail é configurado no próprio Sentry (Alerts → "a new issue").

interface Dsn { endpoint: string; chave: string }

function lerDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projeto = u.pathname.replace(/^\//, "");
    if (!u.username || !projeto) return null;
    return { endpoint: `${u.protocol}//${u.host}/api/${projeto}/envelope/`, chave: u.username };
  } catch {
    return null;
  }
}

const hex32 = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

let enviados = 0;
const LIMITE_POR_SESSAO = 20; // um laço de erro não pode virar enxurrada

export function enviarErro(dsn: Dsn, erro: unknown, origem: string): void {
  if (enviados >= LIMITE_POR_SESSAO) return;
  enviados++;
  const e = erro instanceof Error ? erro : new Error(typeof erro === "string" ? erro : JSON.stringify(erro));
  const id = hex32();
  const evento = {
    event_id: id,
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: "error",
    environment: import.meta.env.MODE,
    tags: { origem },
    request: { url: location.origin + location.pathname + location.hash },
    exception: { values: [{ type: e.name, value: e.message }] },
    extra: { stack: e.stack?.slice(0, 4000) },
  };
  const corpo = `${JSON.stringify({ event_id: id, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(evento)}`;
  fetch(`${dsn.endpoint}?sentry_key=${dsn.chave}&sentry_version=7`, {
    method: "POST", body: corpo, headers: { "Content-Type": "application/x-sentry-envelope" }, keepalive: true,
  }).catch(() => { /* monitoramento nunca derruba a tela */ });
}

export function iniciarMonitoramento(): void {
  const dsn = lerDsn(import.meta.env.VITE_SENTRY_DSN as string | undefined);
  if (!dsn) return;
  addEventListener("error", (ev) => enviarErro(dsn, ev.error ?? ev.message, "window.error"));
  addEventListener("unhandledrejection", (ev) => enviarErro(dsn, ev.reason, "promise"));
}
