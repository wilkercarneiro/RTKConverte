// "Não perde nada" (plano, seção 2): cada vértice é gravado NA HORA no
// aparelho, antes de qualquer rede. Se a página fechar (bateria, ligação,
// navegador matou a aba), ao voltar aparece "Continuar a medição de hoje
// 14:32 (23 vértices)?".
//
// localStorage e não IndexedDB: a gravação é síncrona — o vértice está salvo
// quando a função volta, sem promessa pendente no instante em que a aba
// morre. Cabe com folga: 10 mil vértices ≈ 1 MB.
//
// O aparelho guarda também as medições ainda NÃO enviadas para a conta (no
// campo quase nunca há internet): elas sobem sozinhas quando a rede voltar.
// As já enviadas ficam como cópia (as 30 mais recentes) para abrir sem rede.
import type { Medicao, VerticeCampo } from "./tipos.ts";

/** O pedaço do Storage que se usa (o laboratório e os testes passam um falso). */
export interface Armazem {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export interface RegistroLocal {
  medicao: Medicao;
  /** a versão que está na conta (atualizadaEm); null = nunca foi */
  enviadaVersao: string | null;
  /** a conta recusou esta medição (é de outra empresa): não tenta mais enviar */
  recusada?: boolean;
}

export interface EstadoAparelho {
  /** a medição em andamento (a da retomada) */
  atualId: string | null;
  registros: Record<string, RegistroLocal>;
}

export const CHAVE_APARELHO = "vertces.campo.v1";
const MAX_ENVIADAS = 30;

const vazio = (): EstadoAparelho => ({ atualId: null, registros: {} });

function verticeOk(v: unknown): v is VerticeCampo {
  const x = v as VerticeCampo;
  return !!x && Number.isFinite(x.lon) && Number.isFinite(x.lat) && Number.isFinite(x.t)
    && (x.precisao === null || Number.isFinite(x.precisao)) && (x.modo === "caminhar" || x.modo === "ponto" || x.modo === "mao");
}

/** Medição vinda de fora (aparelho, banco) com o formato certo; vértice estragado fica de fora. */
export function medicaoValida(m: unknown): Medicao | null {
  const x = m as Medicao;
  if (!x || typeof x.id !== "string" || !x.id || !Array.isArray(x.vertices)) return null;
  const agora = new Date().toISOString();
  return {
    id: x.id,
    nome: typeof x.nome === "string" && x.nome.trim() ? x.nome.slice(0, 200) : "Medição",
    criadaEm: typeof x.criadaEm === "string" ? x.criadaEm : agora,
    atualizadaEm: typeof x.atualizadaEm === "string" ? x.atualizadaEm : agora,
    vertices: x.vertices.filter(verticeOk),
    fechada: !!x.fechada && x.vertices.filter(verticeOk).length >= 3,
  };
}

/** Lê o que o aparelho tem. Dado estragado (outra versão, gravação cortada) não derruba a tela. */
export function lerAparelho(arm: Armazem | null): EstadoAparelho {
  if (!arm) return vazio();
  try {
    const t = arm.getItem(CHAVE_APARELHO);
    if (!t) return vazio();
    const bruto = JSON.parse(t) as Partial<EstadoAparelho>;
    const registros: Record<string, RegistroLocal> = {};
    for (const r of Object.values(bruto.registros ?? {})) {
      const m = medicaoValida((r as RegistroLocal)?.medicao);
      if (m) registros[m.id] = { medicao: m, enviadaVersao: typeof r?.enviadaVersao === "string" ? r.enviadaVersao : null, ...(r?.recusada === true ? { recusada: true } : {}) };
    }
    const atualId = typeof bruto.atualId === "string" && registros[bruto.atualId] ? bruto.atualId : null;
    return { atualId, registros };
  } catch {
    return vazio();
  }
}

/** Grava. false = o aparelho recusou (modo privado, memória cheia): a tela avisa. */
export function gravarAparelho(arm: Armazem | null, e: EstadoAparelho): boolean {
  if (!arm) return false;
  // as já enviadas mais antigas saem primeiro; pendente e a atual nunca
  const enviadas = Object.values(e.registros)
    .filter((r) => r.enviadaVersao === r.medicao.atualizadaEm && r.medicao.id !== e.atualId)
    .sort((a, b) => b.medicao.atualizadaEm.localeCompare(a.medicao.atualizadaEm));
  const registros = { ...e.registros };
  for (const r of enviadas.slice(MAX_ENVIADAS)) delete registros[r.medicao.id];
  try {
    arm.setItem(CHAVE_APARELHO, JSON.stringify({ atualId: e.atualId, registros }));
    return true;
  } catch {
    return false;
  }
}

export const pendente = (r: RegistroLocal): boolean => r.enviadaVersao !== r.medicao.atualizadaEm;

/** O que a fila de envio deve subir: pendente, com vértice e não recusada pela conta. */
export const paraEnviar = (r: RegistroLocal): boolean => pendente(r) && !r.recusada && r.medicao.vertices.length > 0;

/**
 * Guarda a medição (e, se `atual`, marca como a em andamento).
 * `daConta`: a medição veio da conta como está — já conta como enviada (não
 * pisca "só no aparelho" nem sobe de novo).
 */
export function guardarMedicao(e: EstadoAparelho, m: Medicao, atual: boolean, daConta = false): EstadoAparelho {
  const antes = e.registros[m.id];
  const enviadaVersao = daConta ? m.atualizadaEm : antes?.enviadaVersao ?? null;
  return {
    atualId: atual ? m.id : e.atualId === m.id ? null : e.atualId,
    registros: { ...e.registros, [m.id]: { medicao: m, enviadaVersao, ...(antes?.recusada ? { recusada: true } : {}) } },
  };
}

export function marcarEnviada(e: EstadoAparelho, id: string, versao: string): EstadoAparelho {
  const r = e.registros[id];
  if (!r) return e;
  return { ...e, registros: { ...e.registros, [id]: { ...r, enviadaVersao: versao } } };
}

export function removerMedicao(e: EstadoAparelho, id: string): EstadoAparelho {
  const registros = { ...e.registros };
  delete registros[id];
  return { atualId: e.atualId === id ? null : e.atualId, registros };
}

// ---------------------------------------------------------------------------
// Lista "Medições salvas": o aparelho e a conta juntos
// ---------------------------------------------------------------------------

export type Onde = "aparelho" | "conta";

export interface ItemLista {
  medicao: Medicao;
  /** "aparelho" = ainda não subiu (ou subiu uma versão velha) */
  onde: Onde;
}

/** Junta o aparelho e a conta pelo id; vale a versão mais nova. */
export function juntarListas(aparelho: EstadoAparelho, conta: Medicao[]): ItemLista[] {
  const porId = new Map<string, ItemLista>();
  for (const m of conta) porId.set(m.id, { medicao: m, onde: "conta" });
  for (const r of Object.values(aparelho.registros)) {
    const naConta = porId.get(r.medicao.id);
    if (naConta && naConta.medicao.atualizadaEm > r.medicao.atualizadaEm) continue; // a conta tem mais nova (outro aparelho)
    porId.set(r.medicao.id, { medicao: r.medicao, onde: pendente(r) && !(naConta && naConta.medicao.atualizadaEm === r.medicao.atualizadaEm) ? "aparelho" : "conta" });
  }
  return [...porId.values()].sort((a, b) => b.medicao.atualizadaEm.localeCompare(a.medicao.atualizadaEm));
}

// ---------------------------------------------------------------------------
// Textos e nomes
// ---------------------------------------------------------------------------

const dois = (n: number) => String(n).padStart(2, "0");
const hora = (d: Date) => `${dois(d.getHours())}:${dois(d.getMinutes())}`;
const mesmoDia = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "hoje 14:32", "ontem 09:10", "03/11 08:05", "03/11/2025 08:05". */
export function quando(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ontem = new Date(agora); ontem.setDate(agora.getDate() - 1);
  if (mesmoDia(d, agora)) return `hoje ${hora(d)}`;
  if (mesmoDia(d, ontem)) return `ontem ${hora(d)}`;
  const ano = d.getFullYear() === agora.getFullYear() ? "" : `/${d.getFullYear()}`;
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}${ano} ${hora(d)}`;
}

const vertices = (n: number) => `${n} ${n === 1 ? "vértice" : "vértices"}`;

/** "Continuar a medição de hoje 14:32 (23 vértices)?" — a hora em que a medição começou. */
export function textoRetomada(m: Medicao, agora: Date = new Date()): string {
  return `Continuar a medição de ${quando(m.criadaEm, agora)} (${vertices(m.vertices.length)})?`;
}

/** "último vértice hoje 14:36" (a linha de baixo da retomada). */
export function textoUltimoVertice(m: Medicao, agora: Date = new Date()): string {
  const t = m.vertices.length ? m.vertices[m.vertices.length - 1].t : NaN;
  const iso = Number.isFinite(t) ? new Date(t).toISOString() : m.atualizadaEm;
  return `último vértice ${quando(iso, agora)}`;
}

/**
 * O aparelho de cada pessoa: as medições ficam numa chave por usuário
 * ("vertces.campo.v1:<id>"). Quem entra depois no mesmo navegador (outra
 * pessoa, outra empresa) não vê nem envia as medições de quem saiu.
 */
export function armazemDoUsuario(base: Armazem, usuario: string): Armazem {
  const k = (c: string) => `${c}:${usuario}`;
  return {
    getItem: (c) => base.getItem(k(c)),
    setItem: (c, v) => base.setItem(k(c), v),
    removeItem: (c) => base.removeItem(k(c)),
  };
}

export const textoVertices = vertices;

/** Nome que a medição ganha ao nascer: "Medição 06/11 14:32". */
export function nomePadrao(d: Date = new Date()): string {
  return `Medição ${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${hora(d)}`;
}

/** Id da medição (uuid v4), gerado no aparelho: é a chave no aparelho e na conta. */
export function novoId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function novaMedicao(agora: Date = new Date()): Medicao {
  const iso = agora.toISOString();
  return { id: novoId(), nome: nomePadrao(agora), criadaEm: iso, atualizadaEm: iso, vertices: [], fechada: false };
}

/** A medição com uma mudança: carimba a hora (é o que decide a versão mais nova). */
export function alterar(m: Medicao, mudanca: Partial<Omit<Medicao, "id" | "criadaEm">>, agora: Date = new Date()): Medicao {
  // a hora nunca anda para trás: dois toques no mesmo milissegundo ainda são versões diferentes
  let iso = agora.toISOString();
  if (iso <= m.atualizadaEm) iso = new Date(new Date(m.atualizadaEm).getTime() + 1).toISOString();
  return { ...m, ...mudanca, atualizadaEm: iso };
}
