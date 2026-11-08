// Edge Function ntrip: o repasse da correção RTK (NTRIP) para o receptor que o
// navegador controla (src/lib/campo/receptor.ts e ntrip.ts). O navegador não
// abre TCP; esta função abre, conversa NTRIP com o caster (RBMC-IP do IBGE ou
// outro) e passa os bytes RTCM pelo WebSocket, sem mexer neles.
//
//   WebSocket  wss://…/functions/v1/ntrip?access_token=<jwt>&apikey=<anon>
//     1ª mensagem (texto JSON): { tipo: "abrir", host, porta, montagem, usuario, senha }
//     depois, do navegador: "$..GGA,…" (a posição; rede VRS exige) → caster, com CRLF
//     da função: binário = RTCM; texto = { tipo: "estado", estado } | { tipo: "erro", mensagem, definitivo, codigo? }
//
//   POST { acao: "tabela", host, porta, usuario?, senha? }  (Authorization: Bearer <jwt>)
//     → { montagens: [...] } a sourcetable do caster (linhas STR)
//
// IMPLANTAÇÃO: precisa de verify_jwt = FALSE (o WebSocket do navegador não
// manda o cabeçalho Authorization, e o portão do runtime recusaria antes de a
// função ver o token da query). A função confere o login ela mesma, nos dois
// caminhos (token da query no WS, cabeçalho no POST) — só usuário logado.
// Na VPS: "ntrip" em FUNCTIONS_IMPORT_MAPS e FUNCTIONS_VERIFY_JWT_MAP (false)
// do serviço sb_rtkconverte_functions (scripts/publicar-ntrip.sh); na nuvem,
// supabase/config.toml.
//
// Segurança:
//  - destino conferido em rede.ts (anti-SSRF): só nome/IPv4 públicos; o nome é
//    resolvido aqui e a conexão vai ao IP conferido. NTRIP_IPS_BLOQUEADOS
//    (lista separada por vírgula) soma IPs públicos proibidos à lista padrão.
//  - usuário e senha do caster: só na mensagem do WS ou no corpo do POST;
//    nunca em log, nunca no banco. Esta função não loga a config.
//  - limites: 2 sessões abertas por usuário (contadas na memória do worker:
//    com mais de um worker de pé, o limite vale por worker — é trava contra
//    abuso, não contabilidade), 4 h por sessão, 10 s para conectar e para o
//    caster responder, 20 aberturas/tabelas por minuto por usuário (limites_uso).
import { createClient } from "@supabase/supabase-js";
import { ehRecusa, exigirUsuario } from "../_shared/acesso.ts";
import type { ClienteUsuario, Recusa } from "../_shared/acesso.ts";
import { CorpoInvalido, dentroDoLimite, LIMITE_MB, lerJson, MUITAS_CHAMADAS } from "../_shared/limite.ts";
import {
  criarDesfazChunks, criarLeitorResposta, DestinoRecusado, escolherIp, ggaValida, IPS_BLOQUEADOS_PADRAO, pedidoNtrip, pedidoTabela,
  respostaDaTabela, validarConfig, validarHost,
} from "./rede.ts";
import type { ConfigCaster } from "./rede.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MAX_SESSOES_POR_USUARIO = 2;
const SESSAO_MAX_MS = 4 * 60 * 60 * 1000;
const PRAZO_CONEXAO_MS = 10_000;
const PRAZO_CONFIG_MS = 15_000;
const MAX_TABELA_BYTES = 2 * 1024 * 1024;
/** navegador que não dá conta de receber (rede ruim): fecha em vez de acumular memória */
const MAX_BUFFER_WS = 1024 * 1024;

const BLOQUEADOS = [
  ...IPS_BLOQUEADOS_PADRAO,
  ...(Deno.env.get("NTRIP_IPS_BLOQUEADOS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];

const clienteComToken = (token: string) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
const servico = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function autenticar(token: string): Promise<{ userId: string } | Recusa> {
  if (!token) return { erro: "Sessão inválida ou expirada. Entre de novo.", status: 401 };
  try {
    return await exigirUsuario(clienteComToken(token) as unknown as ClienteUsuario);
  } catch {
    return { erro: "Não foi possível conferir o seu login agora. Tente de novo em instantes.", status: 503 };
  }
}

// sessões abertas por usuário (memória do worker; ver cabeçalho)
const abertas = new Map<string, number>();
const reservar = (u: string) => {
  const n = abertas.get(u) ?? 0;
  if (n >= MAX_SESSOES_POR_USUARIO) return false;
  abertas.set(u, n + 1);
  return true;
};
const liberar = (u: string) => {
  const n = (abertas.get(u) ?? 1) - 1;
  if (n <= 0) abertas.delete(u); else abertas.set(u, n);
};

function comPrazo<T>(p: Promise<T>, ms: number, mensagem: string, aoAtrasar?: (v: T) => void): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  let venceu = false;
  return Promise.race([
    p.then((v) => { if (venceu) aoAtrasar?.(v); return v; }),
    new Promise<T>((_, rej) => { t = setTimeout(() => { venceu = true; rej(new Error(mensagem)); }, ms); }),
  ]).finally(() => clearTimeout(t));
}

/** DNS por HTTPS: só se o runtime não tiver Deno.resolveDns. A conexão vai ao IP devolvido, conferido do mesmo jeito. */
async function resolverPorHttps(nome: string): Promise<string[]> {
  const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(nome)}&type=A`, { headers: { accept: "application/dns-json" } });
  if (!r.ok) throw new Error(`DNS ${r.status}`);
  const d = await r.json() as { Answer?: { type: number; data: string }[] };
  return (d.Answer ?? []).filter((a) => a.type === 1).map((a) => a.data);
}

/** host conferido → IPv4 público para conectar (ou DestinoRecusado). */
async function resolverDestino(host: string): Promise<string> {
  const h = validarHost(host);
  if (h.tipo === "ip") return escolherIp([h.valor], BLOQUEADOS);
  let ips: string[];
  try {
    ips = await comPrazo(Deno.resolveDns(h.valor, "A"), PRAZO_CONEXAO_MS, "DNS demorou");
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new DestinoRecusado("Esse endereço de caster não existe (DNS).");
    try { ips = await comPrazo(resolverPorHttps(h.valor), PRAZO_CONEXAO_MS, "DNS demorou"); } catch {
      throw new DestinoRecusado("Não deu para achar o endereço do caster agora (DNS). Tente de novo.");
    }
  }
  return escolherIp(ips, BLOQUEADOS);
}

async function conectar(ip: string, porta: number): Promise<Deno.TcpConn> {
  return await comPrazo(Deno.connect({ hostname: ip, port: porta, transport: "tcp" }), PRAZO_CONEXAO_MS,
    "O caster não atendeu em 10 s (endereço ou porta errados, ou fora do ar).", (c) => { try { c.close(); } catch { /* */ } });
}

async function escreverTudo(c: Deno.TcpConn, b: Uint8Array) {
  for (let i = 0; i < b.length;) i += await c.write(b.subarray(i));
}

const enc = new TextEncoder();

// ---------------------------------------------------------------------------
// Sessão (WebSocket)
// ---------------------------------------------------------------------------

function sessao(req: Request): Response {
  const token = new URL(req.url).searchParams.get("access_token") ?? "";
  const { socket: ws, response } = Deno.upgradeWebSocket(req);
  ws.binaryType = "arraybuffer";

  let fechado = false;
  let configurado = false;
  let userId: string | null = null;
  let tcp: Deno.TcpConn | null = null;
  let cabecalhoOk = false;
  let ggaPendente: string | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const auth = autenticar(token);

  const enviarJson = (o: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };
  const encerrar = (erro?: { mensagem: string; definitivo: boolean; codigo?: string }) => {
    if (fechado) return;
    fechado = true;
    if (erro) enviarJson({ tipo: "erro", ...erro });
    timers.forEach((t) => clearTimeout(t));
    try { tcp?.close(); } catch { /* já fechado */ }
    tcp = null;
    if (userId) { liberar(userId); userId = null; }
    try { ws.close(erro ? 4000 : 1000, erro ? "erro" : "fim"); } catch { /* já fechado */ }
  };

  timers.push(setTimeout(() => { if (!configurado) encerrar({ mensagem: "A configuração do caster não chegou.", definitivo: false }); }, PRAZO_CONFIG_MS));

  const escreverGga = (linha: string) => {
    const c = tcp;
    if (!c || !cabecalhoOk) { ggaPendente = linha; return; }
    escreverTudo(c, enc.encode(linha + "\r\n")).catch(() => encerrar({ mensagem: "A conexão com o caster caiu.", definitivo: false }));
  };

  async function iniciar(texto: string) {
    const u = await auth;
    if (fechado) return;
    // 401: o navegador renova a sessão e tenta de novo (codigo "sessao")
    if (ehRecusa(u)) return encerrar({ mensagem: u.erro, definitivo: false, codigo: u.status === 401 ? "sessao" : undefined });
    if (!reservar(u.userId)) {
      return encerrar({ mensagem: `Já há ${MAX_SESSOES_POR_USUARIO} correções abertas na sua conta. Desligue a de outro aparelho ou aba.`, definitivo: true });
    }
    userId = u.userId;
    if (!(await dentroDoLimite(servico(), `ntrip:${u.userId}`, 20, 60))) return encerrar({ mensagem: MUITAS_CHAMADAS.erro, definitivo: false });

    let cfg: ConfigCaster;
    try {
      const o = JSON.parse(texto);
      if (o?.tipo !== "abrir") throw new DestinoRecusado("Mensagem inicial inválida.");
      cfg = validarConfig(o, true);
    } catch (e) {
      return encerrar({ mensagem: e instanceof DestinoRecusado ? e.message : "Configuração do caster inválida.", definitivo: true });
    }

    enviarJson({ tipo: "estado", estado: "conectando" });
    let ip: string;
    try { ip = await resolverDestino(cfg.host); } catch (e) {
      return encerrar({ mensagem: e instanceof DestinoRecusado ? e.message : "Endereço do caster inválido.", definitivo: e instanceof DestinoRecusado && !/agora/.test(e.message) });
    }
    if (fechado) return;
    try { tcp = await conectar(ip, cfg.porta); } catch (e) {
      return encerrar({ mensagem: e instanceof Error && e.message.startsWith("O caster") ? e.message : "Não deu para conectar ao caster.", definitivo: false });
    }
    if (fechado) { try { tcp.close(); } catch { /* */ } tcp = null; return; }
    timers.push(setTimeout(() => encerrar({ mensagem: "A correção chegou ao limite de 4 horas seguidas. Ligue de novo.", definitivo: false }), SESSAO_MAX_MS));

    const conn = tcp;
    try {
      // a GGA só vai DEPOIS do "200" (como o RTKLIB): mandada antes, o caster que recusa (404/401)
      // já fechou, o TCP volta RST e a resposta com o motivo se perde (visto na RBMC em 08/11/2026)
      await escreverTudo(conn, enc.encode(pedidoNtrip(cfg)));
    } catch {
      return encerrar({ mensagem: "A conexão com o caster caiu.", definitivo: false });
    }
    timers.push(setTimeout(() => { if (!cabecalhoOk) encerrar({ mensagem: "O caster não respondeu em 10 s.", definitivo: false }); }, PRAZO_CONEXAO_MS));

    const leitor = criarLeitorResposta();
    let chunks: ReturnType<typeof criarDesfazChunks> | null = null;
    const buf = new Uint8Array(16 * 1024);
    try {
      while (!fechado) {
        const n = await conn.read(buf);
        if (n === null) break;
        let pedaco: Uint8Array = buf.slice(0, n);
        if (!cabecalhoOk) {
          const r = leitor.empurrar(pedaco);
          if (r.tipo === "incompleto") continue;
          if (r.tipo === "erro") return encerrar({ mensagem: r.mensagem, definitivo: r.definitivo });
          cabecalhoOk = true;
          enviarJson({ tipo: "estado", estado: "recebendo" });
          if (r.chunked) chunks = criarDesfazChunks();
          pedaco = r.resto;
          if (ggaPendente) { const g = ggaPendente; ggaPendente = null; escreverGga(g); }
        }
        const dados = chunks ? chunks.empurrar(pedaco) : pedaco;
        if (dados.length) {
          if (ws.bufferedAmount > MAX_BUFFER_WS) return encerrar({ mensagem: "A internet do aparelho não está dando conta da correção.", definitivo: false });
          if (ws.readyState === WebSocket.OPEN) ws.send(dados);
        }
        if (chunks?.acabou()) break;
      }
    } catch {
      if (!fechado) return encerrar({ mensagem: "A conexão com o caster caiu.", definitivo: false });
      return;
    }
    encerrar({ mensagem: "O caster encerrou a conexão.", definitivo: false });
  }

  ws.onmessage = (ev) => {
    if (fechado || typeof ev.data !== "string") return; // binário do navegador: não há o que repassar
    if (!configurado) {
      configurado = true;
      iniciar(ev.data).catch(() => encerrar({ mensagem: "Erro no servidor de correção.", definitivo: false }));
      return;
    }
    const linha = ggaValida(ev.data);
    if (linha) escreverGga(linha);
  };
  ws.onclose = () => encerrar();
  ws.onerror = () => encerrar();
  return response;
}

// ---------------------------------------------------------------------------
// Sourcetable (POST)
// ---------------------------------------------------------------------------

async function tabela(req: Request): Promise<Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const u = await autenticar(token);
  if (ehRecusa(u)) return json({ erro: u.erro }, u.status);
  if (!(await dentroDoLimite(servico(), `ntrip:${u.userId}`, 20, 60))) return json({ erro: MUITAS_CHAMADAS.erro }, MUITAS_CHAMADAS.status);
  const corpo = await lerJson(req, LIMITE_MB(0.05));
  if (corpo?.acao !== "tabela") return json({ erro: "Ação inválida." }, 400);
  let cfg: ConfigCaster;
  let ip: string;
  try {
    cfg = validarConfig(corpo, false);
    ip = await resolverDestino(cfg.host);
  } catch (e) {
    return json({ erro: e instanceof DestinoRecusado ? e.message : "Endereço do caster inválido." }, 400);
  }
  let conn: Deno.TcpConn | null = null;
  try {
    conn = await conectar(ip, cfg.porta);
    await escreverTudo(conn, enc.encode(pedidoTabela(cfg)));
    const partes: Uint8Array[] = [];
    let total = 0;
    const buf = new Uint8Array(32 * 1024);
    const c = conn;
    await comPrazo((async () => {
      for (;;) {
        const n = await c.read(buf);
        if (n === null) break;
        partes.push(buf.slice(0, n));
        total += n;
        if (total > MAX_TABELA_BYTES) break;
        // a tabela termina em ENDSOURCETABLE (o caster nem sempre fecha logo)
        const fimDoPedaco = new TextDecoder("latin1").decode(buf.subarray(Math.max(0, n - 32), n));
        if (fimDoPedaco.includes("ENDSOURCETABLE")) break;
      }
    })(), 15_000, "O caster demorou demais para mandar a lista.");
    const tudo = new Uint8Array(total);
    let p = 0;
    for (const s of partes) { tudo.set(s.subarray(0, Math.min(s.length, total - p)), p); p += s.length; }
    const r = respostaDaTabela(tudo);
    if ("erro" in r) return json({ erro: r.erro }, 502);
    return json({ montagens: r.montagens, caster: `${cfg.host}:${cfg.porta}` });
  } catch (e) {
    return json({ erro: e instanceof Error && e.message.startsWith("O caster") ? e.message : "Não deu para falar com o caster." }, 502);
  } finally {
    try { conn?.close(); } catch { /* já fechado */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if ((req.headers.get("upgrade") ?? "").toLowerCase() === "websocket") return sessao(req);
  if (req.method !== "POST") return json({ erro: "Use POST ou WebSocket." }, 405);
  try {
    return await tabela(req);
  } catch (e) {
    if (e instanceof CorpoInvalido) return json({ erro: e.message }, e.status);
    return json({ erro: "Erro no servidor de correção." }, 500);
  }
});
