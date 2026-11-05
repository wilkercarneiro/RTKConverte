// Edição de vértices em lote: renomear (código) e inserir ponto num lado.
//
// ORDEM. A `ordem` de cada vértice é a linha do banco e é a sequência do anel
// na tabela (a do TXT, com as inserções). A planilha publica OUTRA sequência —
// começa no ponto mais ao norte e anda no sentido horário — e a ponte entre as
// duas é sempre `ordemBanco` (servico.ts, VerticeMontado). Por isso:
//   • renomear "na ordem do anel" recebe `ordemDoAnel` (as `ordem` do banco na
//     sequência publicada, de previaDaPlanilha) e grava o código na linha
//     daquela `ordem` — nunca pela posição no anel;
//   • inserir um ponto entre i e i+1 desloca as `ordem` seguintes (+1), como
//     inserirV/removerV da tela; o código, a confrontação e o id viajam com
//     cada linha, então nada se desalinha.
//
// CÓDIGOS OFICIAIS. Um código alocado do contador do credenciado (Anexo A) já
// pode ter ido ao SIGEF: trocá-lo é decisão do operador, nunca efeito
// colateral. A prévia lista quais mudanças tocam código oficial para a tela
// pedir confirmação; e avisa do que a geração faria depois (ver
// avisosDaRenomeacao).
import { ehCodigoDeConferencia } from "../../supabase/functions/_shared/geo.ts";
import { SEM_CONFRONTACAO, type Confrontacao } from "./trechos.ts";
import type { Vertice } from "./types.ts";

const ordenar = (vs: Vertice[]) => [...vs].sort((a, b) => a.ordem - b.ordem);

/** Código definitivo (tirado do contador ou digitado), que não é prévia de conferência. */
export function ehCodigoOficial(v: Pick<Vertice, "codigo" | "codigo_provisorio" | "inserido_manual">, conferencia = false): boolean {
  if (!v.codigo) return false;
  if (v.inserido_manual) return true;
  if (conferencia) return false;
  return !v.codigo_provisorio && !ehCodigoDeConferencia(v.codigo) && !v.codigo.startsWith("PROV-");
}

// ---------------------------------------------------------------------------
// Renomear em lote
// ---------------------------------------------------------------------------

export interface PadraoNome {
  /**
   * Texto antes do número. `{T}` vira a letra do tipo (M/P/V) e, com ele, cada
   * tipo conta separado (DSBN-{T}- → DSBN-M-0001…, DSBN-P-0001…).
   */
  prefixo: string;
  inicio: number;
  passo: number;
  /** zeros à esquerda (4 → 0001) */
  digitos: number;
  /** "tabela": a ordem da tabela; "anel": a ordem em que a planilha publica */
  ordem: "tabela" | "anel";
}

export interface MudancaNome {
  /** id da linha (ou `o<ordem>` sem id) */
  chave: string;
  ordem: number;
  tipo: "M" | "P" | "V";
  antes: string | null;
  antesProvisorio: boolean;
  depois: string;
  /** o código de antes era oficial: trocar pede confirmação */
  oficial: boolean;
}

export interface PreviaRenomeacao {
  mudancas: MudancaNome[];
  /** código novo que já existe em vértice fora da seleção (impede aplicar) */
  conflitos: string[];
}

export const chaveVertice = (v: Pick<Vertice, "id" | "ordem">) => v.id ?? `o${v.ordem}`;

export function nomeDoPadrao(p: Pick<PadraoNome, "prefixo" | "digitos">, tipo: string, numero: number): string {
  return `${p.prefixo.replace(/\{T\}/gi, tipo)}${String(numero).padStart(Math.max(0, p.digitos), "0")}`;
}

/**
 * Antes → depois dos selecionados. Não muda nada: quem aplica é
 * `aplicarRenomeacao`. `ordemDoAnel` só é lido com `padrao.ordem === "anel"`;
 * vértice selecionado que não está no anel publicado vai para o fim, na ordem
 * da tabela.
 */
export function previaRenomeacao(
  vertices: Vertice[],
  selecionado: (v: Vertice) => boolean,
  padrao: PadraoNome,
  opts: { ordemDoAnel?: number[]; conferencia?: boolean } = {},
): PreviaRenomeacao {
  const lista = ordenar(vertices);
  let alvo = lista.filter(selecionado);
  if (padrao.ordem === "anel" && opts.ordemDoAnel?.length) {
    const pos = new Map<number, number>();
    opts.ordemDoAnel.forEach((o, i) => { if (!pos.has(o)) pos.set(o, i); });
    alvo = [...alvo].sort((a, b) => (pos.get(a.ordem) ?? 1e9 + a.ordem) - (pos.get(b.ordem) ?? 1e9 + b.ordem));
  }
  const porTipo = /\{T\}/i.test(padrao.prefixo);
  const passo = padrao.passo === 0 ? 1 : padrao.passo;
  const contador: Record<string, number> = {};
  const mudancas: MudancaNome[] = alvo.map((v) => {
    const k = porTipo ? v.tipo : "_";
    const i = contador[k] ?? 0;
    contador[k] = i + 1;
    return {
      chave: chaveVertice(v), ordem: v.ordem, tipo: v.tipo,
      antes: v.codigo, antesProvisorio: !!v.codigo_provisorio,
      depois: nomeDoPadrao(padrao, v.tipo, padrao.inicio + i * passo),
      oficial: ehCodigoOficial(v, opts.conferencia),
    };
  });
  const escolhidos = new Set(mudancas.map((m) => m.chave));
  const deFora = new Set(lista.filter((v) => !escolhidos.has(chaveVertice(v)) && v.codigo).map((v) => v.codigo!));
  const novos = new Map<string, number>();
  for (const m of mudancas) novos.set(m.depois, (novos.get(m.depois) ?? 0) + 1);
  const conflitos = [...new Set([
    ...mudancas.filter((m) => deFora.has(m.depois)).map((m) => m.depois),
    ...[...novos].filter(([, c]) => c > 1).map(([c]) => c),
  ])];
  return { mudancas, conflitos };
}

/** Grava os códigos novos (por chave da linha). O código passa a valer como definitivo. */
export function aplicarRenomeacao(vertices: Vertice[], mudancas: MudancaNome[]): Vertice[] {
  const por = new Map(mudancas.map((m) => [m.chave, m]));
  return vertices.map((v) => {
    const m = por.get(chaveVertice(v));
    return m ? { ...v, codigo: m.depois, codigo_provisorio: false } : v;
  });
}

/** O caminho de volta de `aplicarRenomeacao`: cada linha volta ao código (e à marca de prévia) de antes. */
export function desfazerRenomeacao(vertices: Vertice[], mudancas: MudancaNome[]): Vertice[] {
  const por = new Map(mudancas.map((m) => [m.chave, m]));
  return vertices.map((v) => {
    const m = por.get(chaveVertice(v));
    return m && v.codigo === m.depois ? { ...v, codigo: m.antes, codigo_provisorio: m.antesProvisorio } : v;
  });
}

/**
 * O que a geração faria com os nomes novos — para a tela dizer ANTES de aplicar.
 * `contadores` = próximo número de cada tipo no credenciado.
 */
export function avisosDaRenomeacao(
  vertices: Vertice[],
  previa: PreviaRenomeacao,
  ctx: { conferencia: boolean; prefixo: string | null; contadores?: { M: number; P: number; V: number } | null },
): string[] {
  const out: string[] = [];
  const depois = aplicarRenomeacao(vertices, previa.mudancas);
  const oficiais = previa.mudancas.filter((m) => m.oficial && m.antes !== m.depois);
  if (oficiais.length) {
    out.push(`${oficiais.length} vértice(s) já têm código oficial (${oficiais.slice(0, 4).map((m) => m.antes).join(", ")}${oficiais.length > 4 ? "…" : ""}). Se a planilha já foi ao SIGEF, trocar o código desencontra do que foi certificado.`);
  }
  if (ctx.conferencia) {
    const foraDoFormato = previa.mudancas.filter((m) => !ehCodigoDeConferencia(m.depois));
    if (foraDoFormato.length) out.push("Na conferência de área a geração refaz os códigos no formato da prévia (P-1, M-1): nomes em outro formato não ficam.");
  } else {
    const semCodigo = depois.filter((v) => !v.inserido_manual && !v.codigo).length;
    if (semCodigo) out.push(`${semCodigo} vértice(s) continuam sem código: ao gerar, o sistema renumera TODOS os vértices pelo contador do credenciado e estes nomes se perdem. Dê código a todos ou numere depois.`);
    if (ctx.prefixo && ctx.contadores) {
      const re = new RegExp(`^${ctx.prefixo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-([MPV])-(\\d+)$`);
      const usadosAntes = new Set(vertices.map((v) => v.codigo).filter(Boolean));
      const adiante = previa.mudancas.filter((m) => {
        const x = re.exec(m.depois);
        return !!x && !usadosAntes.has(m.depois) && Number(x[2]) >= ctx.contadores![x[1] as "M" | "P" | "V"];
      });
      const atras = previa.mudancas.filter((m) => {
        const x = re.exec(m.depois);
        return !!x && !usadosAntes.has(m.depois) && Number(x[2]) < ctx.contadores![x[1] as "M" | "P" | "V"];
      });
      if (adiante.length) out.push(`${adiante.length} código(s) com número que o credenciado ainda não reservou (${adiante[0].depois}…): o contador não anda com esta troca e a próxima numeração automática pode repetir o número em outro imóvel.`);
      if (atras.length) out.push(`${atras.length} código(s) com número já passado pelo contador do credenciado (${atras[0].depois}…): pode pertencer a outro imóvel. Use só números que são deste levantamento.`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Inserir ponto num lado
// ---------------------------------------------------------------------------

export type PosicaoNoLado = { modo: "meio" } | { modo: "distancia"; metros: number };

export interface PedidoInsercao {
  /** `ordem` do vértice que abre o lado (o lado vai dele ao seguinte da tabela, dando a volta) */
  ordem: number;
  posicao: PosicaoNoLado;
  /** sem tipo: herda do lado (ver tipoHerdado) */
  tipo?: "M" | "P" | "V";
  codigo?: string | null;
  metodo?: string;
  servicoId: string;
  /** E/N do vértice quando a linha só tem lat/lon (V digitado): quem chama converte */
  utmDe?: (v: Vertice) => [number, number] | null;
  id?: string;
}

/** Confrontação vigente em cada posição da tabela: a do último M antes dela, dando a volta. */
function confrontacaoNa(lista: Vertice[], i: number): Confrontacao & { tipo_limite: string | null } {
  const n = lista.length;
  for (let k = 0; k < n; k++) {
    const v = lista[(i - k + n) % n];
    if (v.tipo === "M") {
      return {
        descritivo: v.descritivo, tipo_limite: v.tipo_limite, eh_via: v.eh_via, cns: v.cns, matricula: v.matricula,
        apelido_txt: v.apelido_txt, numerado: !!v.numerado, exibir_planta: v.exibir_planta !== false,
      };
    }
  }
  return { ...SEM_CONFRONTACAO };
}

/**
 * Tipo do ponto novo quando o operador não escolhe: o do lado. Um M abre
 * confrontação — o ponto no meio do lado não muda de vizinho, então não herda
 * o M; herda o tipo do outro extremo, e entre dois M vira P (ponto da divisa).
 */
export function tipoHerdado(a: Pick<Vertice, "tipo">, b: Pick<Vertice, "tipo">): "M" | "P" | "V" {
  if (a.tipo !== "M") return a.tipo;
  if (b.tipo !== "M") return b.tipo;
  return "P";
}

export interface ResultadoInsercao {
  vertices: Vertice[];
  novo: Vertice;
  /** comprimento do lado e onde o ponto caiu, a partir do vértice de origem */
  ladoM: number;
  distanciaM: number;
}

const enDe = (v: Vertice, utmDe?: (v: Vertice) => [number, number] | null): [number, number] | null => {
  if (v.e !== null && v.n !== null && v.e !== undefined && v.n !== undefined) return [Number(v.e), Number(v.n)];
  return utmDe ? utmDe(v) : null;
};

/**
 * Insere um ponto no lado (i → i+1): no meio ou a `metros` de i. Altitude
 * interpolada, σ do pior dos dois extremos, método PA1 (posição calculada —
 * como os pontos novos da divisão, aplicarDivisao). Um M novo carrega a
 * confrontação do lado onde cai, para o trecho continuar o mesmo depois dele;
 * P e V não carregam confrontação (só o M carrega, ARQUITETURA-TRECHOS.md).
 */
export function inserirNoLado(vertices: Vertice[], p: PedidoInsercao): ResultadoInsercao {
  const lista = ordenar(vertices);
  const i = lista.findIndex((v) => v.ordem === p.ordem);
  if (i < 0) throw new Error("Vértice de origem não encontrado.");
  if (lista.length < 2) throw new Error("É preciso ter ao menos dois vértices.");
  const a = lista[i], b = lista[(i + 1) % lista.length];
  const pa = enDe(a, p.utmDe), pb = enDe(b, p.utmDe);
  if (!pa || !pb) throw new Error("Um dos vértices do lado não tem coordenada UTM.");
  const lado = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  if (!(lado > 0)) throw new Error("Os dois vértices do lado estão no mesmo lugar.");
  const d = p.posicao.modo === "meio" ? lado / 2 : p.posicao.metros;
  if (!(d > 0) || d >= lado) throw new Error(`A distância tem de ficar entre 0 e ${lado.toFixed(3).replace(".", ",")} m (o comprimento do lado).`);
  const t = d / lado;
  const tipo = p.tipo ?? tipoHerdado(a, b);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const novo: Vertice = {
    id: p.id ?? crypto.randomUUID(),
    servico_id: p.servicoId,
    ordem: a.ordem + 1,
    num_txt: null, rotulo_txt: null,
    e: r3(pa[0] + (pb[0] - pa[0]) * t),
    n: r3(pa[1] + (pb[1] - pa[1]) * t),
    h: r3(Number(a.h) + (Number(b.h) - Number(a.h)) * t),
    sigma_pos: Math.max(Number(a.sigma_pos), Number(b.sigma_pos)),
    sigma_h: Math.max(Number(a.sigma_h), Number(b.sigma_h)),
    tipo,
    codigo: p.codigo?.trim() || null,
    codigo_provisorio: false,
    metodo: p.metodo ?? "PA1",
    inserido_manual: false,
    // sem lat/lon: o servidor e a prévia calculam pelo E/N (como os marcos da divisão)
    lat_gms: "", lon_gms: "",
    ...(tipo === "M" ? confrontacaoNa(lista, i) : { ...SEM_CONFRONTACAO, tipo_limite: null }),
  };
  const deslocados = vertices.map((v) => (v.ordem > a.ordem ? { ...v, ordem: v.ordem + 1 } : v));
  return {
    vertices: [...deslocados, novo].sort((x, y) => x.ordem - y.ordem),
    novo,
    ladoM: lado,
    distanciaM: d,
  };
}

/**
 * Reserva no credenciado um código que NÃO esteja em nenhum vértice do serviço.
 * O contador pode estar atrás do que o serviço já usa (planilha importada,
 * código digitado à mão): código repetido → reserva o próximo, até `tentativas`
 * vezes; depois disso, recusa com uma mensagem que diz o que fazer.
 */
export async function reservarCodigoLivre(
  reservar: () => Promise<string>,
  codigosDoServico: Iterable<string | null | undefined>,
  tentativas = 5,
): Promise<string> {
  const emUso = new Set<string>();
  for (const c of codigosDoServico) if (c?.trim()) emUso.add(c.trim().toUpperCase());
  const repetidos: string[] = [];
  for (let i = 0; i < tentativas; i++) {
    const codigo = (await reservar()).trim();
    if (!emUso.has(codigo.toUpperCase())) return codigo;
    repetidos.push(codigo);
  }
  throw new Error(
    `O contador do credenciado devolveu ${tentativas} números que já estão neste serviço (${repetidos.join(", ")}). ` +
    "Ajuste o último número usado no cadastro do credenciado (Cadastros) ou digite o código do ponto à mão.",
  );
}

/** Campos do ponto inserido que, mudados depois, tornam o desfazer arriscado. */
const CAMPOS_DO_INSERIDO = ["e", "n", "h", "tipo", "codigo", "metodo", "lat_gms", "lon_gms", "descritivo", "tipo_limite"] as const;

export type ResultadoDesfazerInsercao =
  | { ok: true; vertices: Vertice[] }
  | { ok: false; motivo: "apagado" | "alterado" };

/**
 * Desfaz a inserção de UM ponto pelo id, sem voltar a foto da tabela: tira o
 * ponto e devolve a ordem de quem foi empurrado (todo vértice depois dele desce
 * uma casa). Qualquer outra edição feita depois da inserção fica como está.
 * Se o ponto já foi apagado ou mexido (coordenada, tipo, código…), não desfaz.
 */
export function desfazerInsercao(vertices: Vertice[], inserido: Vertice): ResultadoDesfazerInsercao {
  const atual = vertices.find((v) => v.id === inserido.id);
  if (!atual) return { ok: false, motivo: "apagado" };
  const mudou = CAMPOS_DO_INSERIDO.some((k) => String(atual[k] ?? "") !== String(inserido[k] ?? ""));
  if (mudou) return { ok: false, motivo: "alterado" };
  return {
    ok: true,
    vertices: vertices
      .filter((v) => v.id !== inserido.id)
      .map((v) => (v.ordem > atual.ordem ? { ...v, ordem: v.ordem - 1 } : v)),
  };
}
