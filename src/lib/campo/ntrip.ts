// Correção NTRIP (RTK) para o receptor. O navegador não abre TCP, então a
// conexão com o caster passa pela edge function `ntrip` (supabase/functions/
// ntrip): o navegador fala WebSocket com ela, ela fala TCP com o caster e
// repassa os bytes da correção (RTCM) sem mexer neles.
//
// Protocolo com a função:
//  - URL: wss://<supabase>/functions/v1/ntrip?access_token=<jwt>&apikey=<anon>
//    (WebSocket do navegador não manda cabeçalho; o token é curto e vence)
//  - 1ª mensagem (texto): a config em JSON — host, porta, montagem, usuário e
//    SENHA vão aqui, nunca na URL (URL vai parar em log de proxy)
//  - depois: texto "$..GGA,…" = a posição para o caster (rede VRS)
//  - da função: binário = RTCM; texto JSON = { tipo: "estado" | "erro", … }
//
// A sourcetable (lista de pontos de montagem) vai por POST normal na mesma
// função (chamarFuncao), com o login no cabeçalho.
//
// O cliente do Supabase é importado só na hora de abrir (import dinâmico):
// assim os testes no Node carregam este módulo sem o Vite.

export interface ConfigNtrip {
  host: string;
  porta: number;
  /** ponto de montagem (mountpoint), sem a barra */
  montagem: string;
  usuario: string;
  senha: string;
  /** manda a posição (GGA) ao caster a cada 10 s — rede VRS/MAC exige */
  enviarGga: boolean;
}

/** RBMC-IP do IBGE: gratuita, com cadastro (o usuário e a senha são do cadastro de cada um). */
export const CASTER_RBMC = { host: "gps-ntrip.ibge.gov.br", porta: 2101 } as const;

/** Do caster até a tela. "erro" é sempre o fim da conexão; `definitivo` = tentar de novo não adianta. */
export type EstadoConexaoNtrip =
  | { estado: "conectando" }
  | { estado: "recebendo" }
  | { estado: "erro"; mensagem: string; definitivo: boolean };

export interface ConexaoNtrip {
  /** uma linha GGA (sem CRLF); antes de a conexão abrir, guarda só a última */
  enviarGga(texto: string): void;
  /** fecha sem avisar mais nada */
  fechar(): void;
}

export type AbrirNtrip = (
  cfg: ConfigNtrip,
  aoDados: (b: Uint8Array) => void,
  aoEstado: (e: EstadoConexaoNtrip) => void,
) => ConexaoNtrip;

/** Uma linha STR da sourcetable (mesmo formato que a função devolve). */
export interface Montagem {
  nome: string;
  identificador: string;
  /** "RTCM 3.0", "RTCM 3.2"… */
  formato: string;
  /** mensagens e taxas: "1004(1),1006(10),…" */
  detalhesFormato: string;
  /** "GPS+GLO+GAL" */
  navegacao: string;
  rede: string;
  pais: string;
  lat: number | null;
  lon: number | null;
  /** o caster quer a posição (GGA) do receptor */
  nmea: boolean;
  /** "base" = uma estação; "rede" = solução de rede (VRS/MAC) */
  solucao: "base" | "rede";
  gerador: string;
  /** "N" nenhuma, "B" básica, "D" digest */
  autenticacao: string;
}

/** https://x.supabase.co → wss://x.supabase.co/functions/v1/ntrip */
export function urlWsDaFuncao(urlSupabase: string): string {
  return urlSupabase.replace(/\/+$/, "").replace(/^http(s?):\/\//i, (_m, s: string) => `ws${s}://`) + "/functions/v1/ntrip";
}

/** O que dá para trocar nos testes (e no laboratório). */
export interface DepsNtrip {
  /** URL wss da função (sem a query) */
  url?: string;
  /** token do usuário e a chave anon */
  credenciais?: () => Promise<{ token: string; apikey: string } | null>;
  /** sessão recusada pela função: renova para a próxima tentativa */
  renovarSessao?: () => Promise<void>;
  WebSocket?: new (url: string) => WebSocket;
}

function envVite(): { url?: string; anon?: string } {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
    return { url: env?.VITE_SUPABASE_URL, anon: env?.VITE_SUPABASE_ANON_KEY };
  } catch {
    return {};
  }
}

async function credenciaisPadrao(): Promise<{ token: string; apikey: string } | null> {
  const { supabase } = await import("../supabase.ts");
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { token, apikey: envVite().anon ?? "" } : null;
}

async function renovarPadrao(): Promise<void> {
  const { supabase } = await import("../supabase.ts");
  await supabase.auth.refreshSession().catch(() => {});
}

const SEM_SERVIDOR = "Não deu para falar com o servidor de correção do Vertces. Confira a internet do celular.";

/**
 * Abre a correção. Devolve na hora; os estados chegam por `aoEstado`
 * ("conectando" → "recebendo"; "erro" encerra). Os bytes RTCM chegam por
 * `aoDados`, para escrever no receptor.
 */
export function abrirNtrip(
  cfg: ConfigNtrip,
  aoDados: (b: Uint8Array) => void,
  aoEstado: (e: EstadoConexaoNtrip) => void,
  deps: DepsNtrip = {},
): ConexaoNtrip {
  let ws: WebSocket | null = null;
  let fechado = false;
  let terminou = false;
  let ggaPendente: string | null = null;
  let erroDaFuncao: { mensagem: string; definitivo: boolean; codigo?: string } | null = null;
  const fim = (mensagem: string, definitivo: boolean) => {
    if (terminou || fechado) return;
    terminou = true;
    aoEstado({ estado: "erro", mensagem, definitivo });
  };

  void (async () => {
    aoEstado({ estado: "conectando" });
    const cred = await (deps.credenciais ?? credenciaisPadrao)().catch(() => null);
    if (fechado) return;
    if (!cred) { fim("Sessão expirada. Entre de novo no Vertces para ligar a correção.", true); return; }
    const base = deps.url ?? (envVite().url ? urlWsDaFuncao(envVite().url!) : null);
    if (!base) { fim("O endereço do servidor não está configurado.", true); return; }
    const Ws = deps.WebSocket ?? (typeof WebSocket !== "undefined" ? WebSocket : null);
    if (!Ws) { fim("Este navegador não abre WebSocket.", true); return; }
    try {
      ws = new Ws(`${base}?access_token=${encodeURIComponent(cred.token)}&apikey=${encodeURIComponent(cred.apikey)}`);
    } catch {
      fim(SEM_SERVIDOR, false);
      return;
    }
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      if (!ws) return;
      ws.send(JSON.stringify({
        tipo: "abrir", host: cfg.host.trim(), porta: cfg.porta, montagem: cfg.montagem.trim().replace(/^\/+/, ""),
        usuario: cfg.usuario, senha: cfg.senha,
      }));
      if (ggaPendente) { ws.send(ggaPendente); ggaPendente = null; }
    };
    ws.onmessage = (ev: MessageEvent) => {
      if (fechado) return;
      if (typeof ev.data === "string") {
        let m: { tipo?: string; estado?: string; mensagem?: string; definitivo?: boolean; codigo?: string };
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.tipo === "estado" && (m.estado === "conectando" || m.estado === "recebendo")) aoEstado({ estado: m.estado });
        else if (m.tipo === "erro") erroDaFuncao = { mensagem: String(m.mensagem ?? "Erro no servidor de correção."), definitivo: m.definitivo === true, codigo: m.codigo };
        return;
      }
      const dados = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : ev.data instanceof Uint8Array ? ev.data : null;
      if (dados && dados.length) aoDados(dados);
    };
    ws.onerror = () => { /* o onclose vem logo depois e diz o motivo */ };
    ws.onclose = () => {
      ws = null;
      if (fechado) return;
      const e = erroDaFuncao;
      if (e?.codigo === "sessao") void (deps.renovarSessao ?? renovarPadrao)();
      if (e) fim(e.mensagem, e.definitivo);
      else fim(SEM_SERVIDOR, false);
    };
  })();

  return {
    enviarGga(texto) {
      if (fechado) return;
      const linha = texto.trim();
      if (!linha.startsWith("$")) return;
      if (ws && ws.readyState === 1) ws.send(linha);
      else ggaPendente = linha;
    },
    fechar() {
      if (fechado) return;
      fechado = true;
      try { ws?.close(1000); } catch { /* já fechado */ }
      ws = null;
    },
  };
}

/**
 * Pede a sourcetable do caster (pela função; o login vai no cabeçalho).
 * Sem usuário e senha, a maioria dos casters (a RBMC inclusive) já devolve a tabela.
 */
export async function listarMontagens(
  cfg: Pick<ConfigNtrip, "host" | "porta"> & Partial<Pick<ConfigNtrip, "usuario" | "senha">>,
  deps: { chamar?: <T>(nome: string, corpo: unknown) => Promise<T> } = {},
): Promise<Montagem[]> {
  const chamar = deps.chamar ?? (await import("../supabase.ts")).chamarFuncao;
  const r = await chamar<{ montagens: Montagem[] }>("ntrip", {
    acao: "tabela", host: cfg.host.trim(), porta: cfg.porta, usuario: cfg.usuario ?? "", senha: cfg.senha ?? "",
  });
  return Array.isArray(r?.montagens) ? r.montagens : [];
}
