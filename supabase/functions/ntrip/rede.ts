// A parte pura do repasse NTRIP (sem `Deno`, testada no Node em
// tests/campo_receptor.test.mjs): conferir o destino (anti-SSRF), montar o
// pedido ao caster, ler a resposta dele, desfazer o "chunked" do HTTP/1.1 e
// ler a sourcetable.
//
// Por que a checagem do destino é dura: a função roda DENTRO da VPS, na mesma
// rede docker do banco, do Kong e do GoTrue. Sem ela, qualquer usuário logado
// mandaria a função abrir TCP para "db:5432" ou para o painel interno. Por
// isso: só nome DNS público ou IPv4 público; o nome é resolvido e TODOS os
// endereços têm de ser públicos; a conexão vai ao IP já conferido (não ao nome,
// que poderia resolver diferente na segunda vez).

// ---------------------------------------------------------------------------
// Destino
// ---------------------------------------------------------------------------

/** IPs públicos que mesmo assim não podem: a própria VPS (Traefik, SSH). Soma com NTRIP_IPS_BLOQUEADOS. */
export const IPS_BLOQUEADOS_PADRAO = ["31.97.85.119"];

/** "a.b.c.d" → número de 32 bits; null se não for IPv4 decimal estrito (sem zero à esquerda, que vira octal em alguns lugares). */
export function ipv4ParaNumero(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const p = m[i];
    if (p.length > 1 && p[0] === "0") return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

// [rede, bits] — tudo o que não é internet pública (RFC 6890 e vizinhas)
const FAIXAS_INTERNAS: [string, number][] = [
  ["0.0.0.0", 8],        // "esta rede" (0.0.0.0 chega ao próprio host)
  ["10.0.0.0", 8],       // privada
  ["100.64.0.0", 10],    // CGNAT
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local (metadados de nuvem: 169.254.169.254)
  ["172.16.0.0", 12],    // privada (redes do docker)
  ["192.0.0.0", 24],     // IETF
  ["192.0.2.0", 24],     // documentação
  ["192.88.99.0", 24],   // 6to4 relay
  ["192.168.0.0", 16],   // privada
  ["198.18.0.0", 15],    // testes de rede
  ["198.51.100.0", 24],  // documentação
  ["203.0.113.0", 24],   // documentação
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reservada + broadcast 255.255.255.255
];
const FAIXAS = FAIXAS_INTERNAS.map(([r, b]) => {
  const base = ipv4ParaNumero(r)!;
  const tam = 2 ** (32 - b);
  return [base, base + tam - 1] as const;
});

/** true = endereço interno/reservado (ou nem IPv4 é): NÃO conectar. */
export function ipv4Interno(ip: string): boolean {
  const n = ipv4ParaNumero(ip);
  if (n == null) return true;
  return FAIXAS.some(([ini, fim]) => n >= ini && n <= fim);
}

/** Pode conectar neste IP? Público e fora da lista de bloqueio. */
export function ipPermitido(ip: string, bloqueados: readonly string[] = IPS_BLOQUEADOS_PADRAO): boolean {
  return !ipv4Interno(ip) && !bloqueados.includes(ip);
}

// nomes que nunca são caster na internet: os do próprio servidor e os de rede interna
const NOMES_INTERNOS = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|private|docker|svc|cluster\.local|home\.arpa|in-addr\.arpa|ip6\.arpa|test|example|invalid|onion)$/;

export class DestinoRecusado extends Error {}

/**
 * Confere o host digitado. Devolve o IPv4 (já conferido) ou o nome DNS em
 * minúsculas (a resolver e conferir depois). Recusa: IPv6 literal (não
 * suportado — e evita os disfarces ::ffff:10.0.0.1), nome sem ponto (serviços
 * do docker: db, kong, rest…), sublinhado (nomes do swarm), sufixos internos.
 */
export function validarHost(host: unknown): { tipo: "ip"; valor: string } | { tipo: "nome"; valor: string } {
  if (typeof host !== "string") throw new DestinoRecusado("Informe o endereço do caster.");
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) throw new DestinoRecusado("Informe o endereço do caster.");
  if (h.length > 253) throw new DestinoRecusado("Endereço do caster comprido demais.");
  if (/^\d+(\.\d+){3}$/.test(h)) {
    if (!ipPermitido(h)) throw new DestinoRecusado("Esse endereço é de rede interna: use o endereço público do caster.");
    return { tipo: "ip", valor: h };
  }
  if (h.includes(":") || h.startsWith("[")) throw new DestinoRecusado("Use o nome ou o IPv4 do caster (IPv6 não é aceito).");
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(h)) {
    throw new DestinoRecusado("Endereço do caster inválido (use algo como gps-ntrip.ibge.gov.br).");
  }
  // última parte só de números ("1.2.3.0x") ou TLD numérico: não é nome de internet
  if (!/[a-z]/.test(h.slice(h.lastIndexOf(".") + 1))) throw new DestinoRecusado("Endereço do caster inválido.");
  if (NOMES_INTERNOS.test(h)) throw new DestinoRecusado("Esse endereço é de rede interna: use o endereço público do caster.");
  return { tipo: "nome", valor: h };
}

/** Todos os IPs que o nome deu têm de ser públicos (um só interno já recusa: é truque de DNS). */
export function escolherIp(ips: readonly string[], bloqueados: readonly string[] = IPS_BLOQUEADOS_PADRAO): string {
  const v4 = ips.filter((ip) => ipv4ParaNumero(ip) != null);
  if (!v4.length) throw new DestinoRecusado("Não achei o endereço do caster (o nome não tem IPv4).");
  if (v4.some((ip) => !ipPermitido(ip, bloqueados))) throw new DestinoRecusado("Esse endereço aponta para rede interna: recusado.");
  return v4[0];
}

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export interface ConfigCaster {
  host: string;
  porta: number;
  montagem: string;
  usuario: string;
  senha: string;
}

const texto = (v: unknown, max: number, oQue: string): string => {
  if (v == null || v === "") return "";
  if (typeof v !== "string") throw new DestinoRecusado(`${oQue} inválido.`);
  if (v.length > max) throw new DestinoRecusado(`${oQue} comprido demais.`);
  if (/[\r\n\0]/.test(v)) throw new DestinoRecusado(`${oQue} com caractere proibido.`);
  return v;
};

export function validarPorta(p: unknown): number {
  const n = typeof p === "string" ? Number(p) : p;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 65535) throw new DestinoRecusado("Porta do caster inválida (de 1 a 65535; a RBMC usa 2101).");
  return n;
}

/** A config que chega do navegador. `comMontagem` = false na sourcetable. */
export function validarConfig(o: unknown, comMontagem = true): ConfigCaster {
  const c = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  const host = validarHost(c.host).valor;
  const porta = validarPorta(c.porta);
  let montagem = "";
  if (comMontagem) {
    montagem = typeof c.montagem === "string" ? c.montagem.trim().replace(/^\/+/, "") : "";
    if (!/^[A-Za-z0-9_.\-]{1,100}$/.test(montagem)) throw new DestinoRecusado("Ponto de montagem inválido (só letras, números, _ . -).");
  }
  // ":" no usuário quebraria o Basic (usuário:senha)
  const usuario = texto(c.usuario, 128, "Usuário");
  if (usuario.includes(":")) throw new DestinoRecusado("Usuário do caster não pode ter dois-pontos.");
  return { host, porta, montagem, usuario, senha: texto(c.senha, 128, "Senha") };
}

// ---------------------------------------------------------------------------
// Pedido e resposta
// ---------------------------------------------------------------------------

function base64Utf8(s: string): string {
  const b = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
}

const USER_AGENT = "NTRIP VertcesNtrip/1.0";

/**
 * GET da montagem. HTTP/1.0 de propósito: com ele o caster Ntrip 2.0 não usa
 * chunked (a RBMC, BKG Caster 2.0.37, responde "HTTP/1.1 200" sem chunked; o
 * Rev1 responde "ICY 200 OK"). Mesmo assim o leitor desfaz chunked se vier.
 */
export function pedidoNtrip(cfg: ConfigCaster): string {
  const linhas = [
    `GET /${cfg.montagem} HTTP/1.0`,
    `Host: ${cfg.host}:${cfg.porta}`,
    `User-Agent: ${USER_AGENT}`,
    "Ntrip-Version: Ntrip/2.0",
    "Accept: */*",
  ];
  if (cfg.usuario || cfg.senha) linhas.push(`Authorization: Basic ${base64Utf8(`${cfg.usuario}:${cfg.senha}`)}`);
  linhas.push("Connection: close");
  return linhas.join("\r\n") + "\r\n\r\n";
}

/** GET da sourcetable: sem Ntrip-Version, o caster responde "SOURCETABLE 200 OK" (texto puro, sem chunked). */
export function pedidoTabela(cfg: Pick<ConfigCaster, "host" | "porta" | "usuario" | "senha">): string {
  const linhas = [`GET / HTTP/1.0`, `Host: ${cfg.host}:${cfg.porta}`, `User-Agent: ${USER_AGENT}`, "Accept: */*"];
  if (cfg.usuario || cfg.senha) linhas.push(`Authorization: Basic ${base64Utf8(`${cfg.usuario}:${cfg.senha}`)}`);
  linhas.push("Connection: close");
  return linhas.join("\r\n") + "\r\n\r\n";
}

export type RespostaCaster =
  | { tipo: "incompleto" }
  | { tipo: "ok"; resto: Uint8Array; chunked: boolean }
  | { tipo: "erro"; mensagem: string; definitivo: boolean };

const latin1 = (b: Uint8Array, ini = 0, fim = b.length) => {
  let s = "";
  for (let i = ini; i < fim; i++) s += String.fromCharCode(b[i]);
  return s;
};

const MAX_CABECALHO = 16 * 1024;
const MONTAGEM_NAO_EXISTE = "Esse ponto de montagem não existe no caster. Escolha um da lista.";
const SENHA_RECUSADA = "O caster recusou o usuário ou a senha (confira o cadastro; o da RBMC vence a cada poucos meses).";

/** Lê o início da resposta do caster (acumulando os pedaços) até saber se é dado, erro ou falta chegar mais. */
export function criarLeitorResposta(): { empurrar(b: Uint8Array): RespostaCaster } {
  let buf = new Uint8Array(0);
  return {
    empurrar(b) {
      const novo = new Uint8Array(buf.length + b.length);
      novo.set(buf); novo.set(b, buf.length);
      buf = novo;
      const t = latin1(buf, 0, Math.min(buf.length, MAX_CABECALHO));
      if (t.startsWith("ICY 200 OK")) {
        const fim = t.indexOf("\n");
        if (fim < 0) return buf.length > 64 ? { tipo: "erro", mensagem: "Resposta estranha do caster.", definitivo: false } : { tipo: "incompleto" };
        let i = fim + 1;
        // alguns casters mandam uma linha em branco depois; RTCM começa em 0xD3, então pular CR/LF é seguro
        while (i < buf.length && (buf[i] === 13 || buf[i] === 10)) i++;
        return { tipo: "ok", resto: buf.slice(i), chunked: false };
      }
      if (t.startsWith("SOURCETABLE")) return { tipo: "erro", mensagem: MONTAGEM_NAO_EXISTE, definitivo: true };
      if (t.startsWith("HTTP/")) {
        let fimCab = t.indexOf("\r\n\r\n"), pulo = 4;
        if (fimCab < 0) { fimCab = t.indexOf("\n\n"); pulo = 2; }
        if (fimCab < 0) {
          return buf.length >= MAX_CABECALHO ? { tipo: "erro", mensagem: "Resposta estranha do caster (cabeçalho sem fim).", definitivo: false } : { tipo: "incompleto" };
        }
        const cab = t.slice(0, fimCab);
        const status = Number(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(cab)?.[1] ?? 0);
        if (status === 200) {
          if (/^content-type:\s*gnss\/sourcetable/im.test(cab)) return { tipo: "erro", mensagem: MONTAGEM_NAO_EXISTE, definitivo: true };
          return { tipo: "ok", resto: buf.slice(fimCab + pulo), chunked: /^transfer-encoding:\s*chunked/im.test(cab) };
        }
        if (status === 401) return { tipo: "erro", mensagem: SENHA_RECUSADA, definitivo: true };
        if (status === 403) return { tipo: "erro", mensagem: "O caster negou o acesso a esse ponto de montagem (403).", definitivo: true };
        if (status === 404) return { tipo: "erro", mensagem: MONTAGEM_NAO_EXISTE, definitivo: true };
        const linha = cab.split(/\r?\n/)[0].slice(0, 80);
        return { tipo: "erro", mensagem: `O caster respondeu "${linha}".`, definitivo: status >= 400 && status < 500 };
      }
      // ainda pode ser o começo de uma das três respostas
      const prefixos = ["ICY 200 OK", "SOURCETABLE", "HTTP/"];
      if (prefixos.some((p) => p.startsWith(t))) return { tipo: "incompleto" };
      return { tipo: "erro", mensagem: "Esse endereço não respondeu como um caster NTRIP.", definitivo: true };
    },
  };
}

/** Desfaz o Transfer-Encoding: chunked em fluxo (os pedaços do TCP cortam onde quiserem). */
export function criarDesfazChunks(): { empurrar(b: Uint8Array): Uint8Array; acabou(): boolean } {
  let estado: "tamanho" | "dados" | "crlf" | "fim" = "tamanho";
  let linhaTam = "";
  let faltam = 0;
  return {
    empurrar(b) {
      const saida: Uint8Array[] = [];
      let i = 0;
      while (i < b.length && estado !== "fim") {
        if (estado === "tamanho") {
          const c = b[i++];
          if (c === 10) {
            const n = parseInt(linhaTam.replace(/\r$/, "").split(";")[0].trim(), 16);
            linhaTam = "";
            if (!Number.isFinite(n) || n < 0) { estado = "fim"; break; }
            if (n === 0) { estado = "fim"; break; }
            faltam = n; estado = "dados";
          } else if (linhaTam.length < 64) linhaTam += String.fromCharCode(c);
        } else if (estado === "dados") {
          const n = Math.min(faltam, b.length - i);
          saida.push(b.subarray(i, i + n));
          i += n; faltam -= n;
          if (faltam === 0) estado = "crlf";
        } else { // crlf depois dos dados: pula CR, termina no LF
          const c = b[i++];
          if (c === 10) estado = "tamanho";
        }
      }
      const total = saida.reduce((s, p) => s + p.length, 0);
      const out = new Uint8Array(total);
      let p = 0;
      for (const s of saida) { out.set(s, p); p += s.length; }
      return out;
    },
    acabou: () => estado === "fim",
  };
}

/** Só GGA vai do navegador ao caster: "$xxGGA,…" ASCII imprimível, sem CR/LF, até 120 caracteres. */
export function ggaValida(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const s = t.trim();
  return /^\$[A-Z]{2}GGA,[\x20-\x7e]{10,113}$/.test(s) && !/[\r\n]/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Sourcetable
// ---------------------------------------------------------------------------

/** Linha STR (NTRIP): mesmo formato que src/lib/campo/ntrip.ts `Montagem`. */
export interface Montagem {
  nome: string;
  identificador: string;
  formato: string;
  detalhesFormato: string;
  navegacao: string;
  rede: string;
  pais: string;
  lat: number | null;
  lon: number | null;
  nmea: boolean;
  solucao: "base" | "rede";
  gerador: string;
  autenticacao: string;
}

/**
 * STR;mountpoint;identifier;format;format-details;carrier;nav-system;network;
 * country;latitude;longitude;nmea;solution;generator;compr-encryp;
 * authentication;fee;bitrate;misc
 */
export function lerTabela(texto: string): Montagem[] {
  const saida: Montagem[] = [];
  for (const bruta of texto.split(/\r?\n/)) {
    if (!bruta.startsWith("STR;")) continue;
    const c = bruta.split(";");
    if (c.length < 12 || !c[1]) continue;
    const n = (s: string | undefined) => { const v = Number(s); return s != null && s.trim() !== "" && Number.isFinite(v) ? v : null; };
    saida.push({
      nome: c[1], identificador: c[2] ?? "", formato: c[3] ?? "", detalhesFormato: c[4] ?? "",
      navegacao: c[6] ?? "", rede: c[7] ?? "", pais: c[8] ?? "",
      lat: n(c[9]), lon: n(c[10]),
      nmea: c[11] === "1",
      solucao: c[12] === "1" ? "rede" : "base",
      gerador: c[13] ?? "",
      autenticacao: c[15] ?? "",
    });
  }
  return saida;
}

/** A resposta inteira do GET / → montagens, ou o motivo de não ter tabela. */
export function respostaDaTabela(b: Uint8Array): { montagens: Montagem[] } | { erro: string } {
  const t = latin1(b);
  const primeira = t.slice(0, t.indexOf("\n") >= 0 ? t.indexOf("\n") : 80).trim();
  if (/^HTTP\/\d(\.\d)?\s+401/.test(primeira)) return { erro: SENHA_RECUSADA };
  if (!/^(SOURCETABLE 200|HTTP\/\d(\.\d)?\s+200)/.test(primeira)) {
    return { erro: primeira ? `O caster não devolveu a lista ("${primeira.slice(0, 80)}").` : "O caster não respondeu." };
  }
  return { montagens: lerTabela(t) };
}
