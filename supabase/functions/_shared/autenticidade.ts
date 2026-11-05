// Selo de autenticidade das plantas: cada emissão ganha um CÓDIGO aleatório,
// impresso na folha como QR + texto, e um registro no banco (tabela
// documentos_autenticidade, migração 0043) com o SHA-256 do PDF e os dados
// públicos do documento. Qualquer pessoa confere em
//   https://vertces.com.br/app/#/verificar/<código>
// — a página chama a RPC pública verificar_documento, que devolve SÓ os campos
// públicos (nunca CPF de ninguém).
//
// Ordem de uma emissão (emitirComAutenticidade):
//   1. reserva o código (linha sem hash — invisível para a verificação)
//   2. gera o PDF com o QR do código
//   3. calcula o SHA-256 dos bytes finais e confirma a linha
// O hash não pode estar dentro do próprio PDF (mudaria o hash), por isso ele
// fica no banco e a página o mostra para quem quiser conferir o arquivo.
//
// Sem a migração no banco a reserva falha e a planta sai SEM o selo, avisada:
// o selo é um extra, não pode impedir a entrega.
//
// Módulo sem dependência de execução (só Web Crypto): roda no Deno e no Node.

/** Base32 de Crockford (sem I, L, O, U): sem letras que se confundem ao digitar. */
export const ALFABETO_CODIGO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 20 caracteres × 5 bits = 100 bits aleatórios: inadivinhável. */
export const TAMANHO_CODIGO = 20;
export const URL_VERIFICACAO_PADRAO = "https://vertces.com.br/app/#/verificar/";

export function gerarCodigoVerificacao(): string {
  const bytes = new Uint8Array(TAMANHO_CODIGO);
  crypto.getRandomValues(bytes);
  // 256 é múltiplo de 32: o resto não enviesa nenhum caractere
  return Array.from(bytes, (b) => ALFABETO_CODIGO[b % 32]).join("");
}

/** O que a pessoa digitou → o código como está no banco (maiúsculas, sem traços/espaços; O→0, I/L→1). */
export function normalizarCodigo(entrada: string): string {
  return entrada.toUpperCase().replace(/[\s\-.]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function codigoValido(c: string): boolean {
  return c.length === TAMANHO_CODIGO && [...c].every((ch) => ALFABETO_CODIGO.includes(ch));
}

/** Para ler na folha: grupos de 4 ("7K3M-9QXW-…"). */
export function codigoAgrupado(c: string): string {
  return c.match(/.{1,4}/g)?.join("-") ?? c;
}

export function urlVerificacao(codigo: string, base: string = URL_VERIFICACAO_PADRAO): string {
  return `${base}${codigo}`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** O que a planta precisa para imprimir o selo. */
export interface AutenticidadePlanta {
  codigo: string;
  url: string;
}

/** Tipos de documento registrados (o rótulo é o que a página mostra). */
export const TIPOS_DOCUMENTO: Record<string, string> = {
  planta_sigef: "Planta do imóvel (SIGEF)",
  planta_sistema: "Planta do imóvel",
  planta_previa: "Planta do imóvel (prévia de conferência)",
  planta_gleba: "Planta da gleba / parte",
};

/** Campos que podem ir a público. Qualquer outra chave é descartada. */
export interface MetadadosPublicos {
  titulo: string;
  denominacao: string;
  municipio: string;
  uf: string;
  area_ha: string;
  perimetro_m: string;
  folha: string;
  empresa: string;
  rt_nome: string;
  rt_registro: string;
  emitido_em: string;
}
const CHAVES_PUBLICAS: (keyof MetadadosPublicos)[] = [
  "titulo", "denominacao", "municipio", "uf", "area_ha", "perimetro_m", "folha", "empresa", "rt_nome", "rt_registro", "emitido_em",
];

export interface EntradaMetadados {
  tipo: string;
  unidade?: string | null;
  servico: { denominacao?: string | null; municipio?: string | null; uf?: string | null };
  rt: { nome?: string | null; conselho_sigla?: string | null; conselho_numero?: string | null; crea?: string | null } | null;
  empresa?: string | null;
  areaFmt: string;
  perimetroFmt: string;
  folha?: string | null;
  dataStr: string;
}

const limpo = (s: unknown, max = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Metadados públicos de uma emissão. Lista FECHADA de campos: dado pessoal
 * (CPF, RG, nome do proprietário) não tem como entrar, nem por engano de quem
 * chama. O RT é profissional habilitado: nome e registro no conselho são
 * públicos por natureza (constam da ART/TRT).
 */
export function metadadosPublicos(e: EntradaMetadados): MetadadosPublicos {
  const sigla = limpo(e.rt?.conselho_sigla, 20);
  const numero = limpo(e.rt?.conselho_numero, 40) || limpo(e.rt?.crea, 40);
  const den = limpo(e.servico.denominacao);
  const m: MetadadosPublicos = {
    titulo: limpo(TIPOS_DOCUMENTO[e.tipo] ?? "Planta do imóvel"),
    denominacao: e.unidade ? limpo(`${den} — ${e.unidade}`) : den,
    municipio: limpo(e.servico.municipio, 80),
    uf: limpo(e.servico.uf, 2).toUpperCase(),
    area_ha: limpo(e.areaFmt, 30),
    perimetro_m: limpo(e.perimetroFmt, 30),
    folha: limpo(e.folha, 4),
    empresa: limpo(e.empresa),
    rt_nome: limpo(e.rt?.nome),
    rt_registro: numero ? (sigla ? `${sigla} ${numero}` : numero) : "",
    emitido_em: limpo(e.dataStr, 10),
  };
  return Object.fromEntries(CHAVES_PUBLICAS.map((k) => [k, m[k]])) as unknown as MetadadosPublicos;
}

/** O mínimo do supabase-js (service_role) que o registro usa. */
interface ClienteAutenticidade {
  from: (t: string) => {
    insert: (v: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
    update: (v: Record<string, unknown>) => { eq: (c: string, v: string) => PromiseLike<{ error: unknown }> };
    delete: () => { eq: (c: string, v: string) => PromiseLike<{ error: unknown }> };
  };
}

export interface Reserva {
  servico_id: string;
  escritorio_id: string | null;
  tipo: string;
  unidade?: string | null;
  metadados: MetadadosPublicos;
}

/** Reserva um código (linha ainda sem hash). null = banco sem a migração 0043 ou falha. */
export async function reservarCodigo(svc: unknown, r: Reserva): Promise<string | null> {
  const cli = svc as ClienteAutenticidade;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    const codigo = gerarCodigoVerificacao();
    try {
      const { error } = await cli.from("documentos_autenticidade").insert({
        codigo, servico_id: r.servico_id, escritorio_id: r.escritorio_id, tipo: r.tipo,
        unidade: r.unidade ?? null, metadados: r.metadados,
      });
      if (!error) return codigo;
      // colisão de chave (praticamente impossível com 100 bits): tenta outro
      if ((error as { code?: string }).code !== "23505") return null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function confirmarCodigo(svc: unknown, codigo: string, hash: string): Promise<boolean> {
  try {
    const { error } = await (svc as ClienteAutenticidade).from("documentos_autenticidade")
      .update({ hash_sha256: hash, confirmado_em: new Date().toISOString() }).eq("codigo", codigo);
    return !error;
  } catch {
    return false;
  }
}

async function descartarCodigo(svc: unknown, codigo: string): Promise<void> {
  try { await (svc as ClienteAutenticidade).from("documentos_autenticidade").delete().eq("codigo", codigo); } catch { /* sem hash ele nunca aparece */ }
}

export interface Emissao {
  bytes: Uint8Array;
  codigo: string | null;
  hash: string;
  aviso?: string;
}

/**
 * Reserva → gera (com o selo) → confirma com o hash dos bytes finais. Se a
 * geração falhar, a reserva é descartada e o erro sobe como antes.
 */
export async function emitirComAutenticidade(
  svc: unknown, reserva: Reserva,
  gerar: (selo: AutenticidadePlanta | null) => Promise<Uint8Array>,
  baseUrl: string = URL_VERIFICACAO_PADRAO,
): Promise<Emissao> {
  const codigo = await reservarCodigo(svc, reserva);
  let bytes: Uint8Array;
  try {
    bytes = await gerar(codigo ? { codigo, url: urlVerificacao(codigo, baseUrl) } : null);
  } catch (e) {
    if (codigo) await descartarCodigo(svc, codigo);
    throw e;
  }
  const hash = await sha256Hex(bytes);
  if (!codigo) return { bytes, codigo: null, hash, aviso: "A planta saiu sem o selo de autenticidade (QR): o registro de emissão não está disponível no banco." };
  if (!(await confirmarCodigo(svc, codigo, hash))) {
    return { bytes, codigo, hash, aviso: "A planta saiu com o QR de autenticidade, mas o registro da emissão não foi confirmado: a verificação dela pode não funcionar. Gere de novo." };
  }
  return { bytes, codigo, hash };
}
