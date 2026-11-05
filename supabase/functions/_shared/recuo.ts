// Recuo legal ao longo de rodovias (BR, BA, municipais e ferrovias).
//
// Pedido do Wilker (05/11/2026): "o sistema, automaticamente nos serviços, fazer
// recuo com base na lei ou manual de BA e BR". A pesquisa (docs/recuo-rodovias.md,
// com as fontes) mostrou três coisas que mandam neste módulo:
//   1. NÃO existe largura legal única de faixa de domínio. Na BR ela é de cada
//      trecho (Termo de Reconhecimento do DNIT, Res. DNIT 7/2021, IN DNIT
//      20/2020 e 75/2021); na BA a SEINFRA/SIT diz "em geral 30 m para cada lado
//      do eixo" (página oficial, sem lei nem decreto). Por isso o sistema aplica
//      um PADRÃO, sempre com a origem dita, e a peça final pede confirmação.
//   2. A faixa NÃO EDIFICÁVEL é de 15 m a partir do LIMITE da faixa de domínio
//      (Lei 6.766/1979, art. 4º, III, red. Lei 13.913/2019); lei municipal pode
//      reduzir até 5 m (só rodovia). Vale no loteamento e no desmembramento
//      urbano; em imóvel rural é controverso — lá ela é só informativa.
//   3. Restrição de construir NÃO é área pública: a terra continua do dono
//      (Despacho 13/2021/GM/MINFRA). Nunca se subtrai da área do imóvel.
//
// Módulo puro (sem DOM): serve à tela, ao motor do loteamento e às funções.

export type TipoVia = "federal" | "estadual" | "municipal" | "ferrovia";

export interface Via {
  tipo: TipoVia;
  /** "BR-116", "BA-120", "EF-025"; nulo quando o nome não traz o código */
  sigla: string | null;
  /** UF da rodovia estadual ("BA"); nulo nas outras */
  uf: string | null;
}

/** De onde veio a largura da faixa de domínio. */
export type OrigemFaixa = "padrao" | "informada";

export interface RegraRecuo {
  /** faixa de domínio padrão, em metros para cada lado a partir do eixo (nulo = sem padrão) */
  dominio: number | null;
  /** faixa não edificável padrão, em metros a partir do limite da faixa de domínio */
  naoEdificavel: number;
  /** a lei municipal pode reduzir a não edificável (até 5 m)? */
  reduzivel: boolean;
  /** quem define a faixa (para o confrontante e a nota) */
  orgao: string;
  /** de onde sai o padrão da faixa de domínio, em uma frase */
  fonteDominio: string;
}

/** Mínimo da faixa não edificável de rodovia com redução por lei municipal (Lei 6.766, art. 4º, III). */
export const NAO_EDIFICAVEL_MINIMO = 5;

export const FONTE_NAO_EDIFICAVEL = "Lei 6.766/1979, art. 4º, III (redação da Lei 13.913/2019)";
export const FONTE_NAO_EDIFICAVEL_FERROVIA = "Lei 6.766/1979, art. 4º, III-A (redação da Lei 14.285/2021)";

export const REGRAS_RECUO: Record<TipoVia, RegraRecuo> = {
  federal: {
    dominio: 40,
    naoEdificavel: 15,
    reduzivel: true,
    orgao: "DNIT",
    fonteDominio:
      "Rodovia federal: a largura é de cada trecho (Termo de Reconhecimento do DNIT; Res. DNIT 7/2021). " +
      "40 m por lado é o padrão do sistema, não da lei: cobre 91% da extensão documentada pelo DNIT. Confirme no DNIT ou na concessionária.",
  },
  estadual: {
    dominio: 30,
    naoEdificavel: 15,
    reduzivel: true,
    orgao: "SEINFRA/SIT",
    fonteDominio:
      "Rodovia estadual da Bahia: \"em geral\" 30 m para cada lado do eixo (SEINFRA/SIT), definida no projeto de engenharia. " +
      "Não há lei ou decreto com a largura: confirme com a SEINFRA/SIT ou a concessionária.",
  },
  municipal: {
    dominio: null,
    naoEdificavel: 0,
    reduzivel: false,
    orgao: "município",
    fonteDominio:
      "Estrada municipal: sem regra geral — vale a lei do município. Sem lei que defina a faixa, o limite é a própria estrada (Manual Técnico de Limites e Confrontações do INCRA, 2.4.1.3).",
  },
  ferrovia: {
    dominio: null,
    naoEdificavel: 15,
    reduzivel: false,
    orgao: "concessionária ferroviária",
    fonteDominio: "Ferrovia: a faixa de domínio é a do projeto e do decreto de utilidade pública de cada trecho.",
  },
};

/**
 * A regra que vale para a via: a estadual com padrão de 30 m é a da Bahia
 * (SEINFRA/SIT). Rodovia de outra UF fica sem largura padrão — o operador
 * informa a do órgão rodoviário daquele estado.
 */
export function regraDaVia(via: Pick<Via, "tipo" | "uf">): RegraRecuo {
  const r = REGRAS_RECUO[via.tipo];
  if (via.tipo !== "estadual" || !via.uf || via.uf === "BA") return r;
  return {
    ...r,
    dominio: null,
    orgao: `órgão rodoviário de ${via.uf}`,
    fonteDominio: `Rodovia estadual de ${via.uf}: a largura é a do órgão rodoviário do estado (DER ou equivalente), no projeto de cada trecho. Informe a largura.`,
  };
}

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

const UFS = "AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO";
const RE_BR = /\bBR\s*[-–]?\s*(\d{3})\b/;
const RE_ESTADUAL = new RegExp(`\\b(${UFS})\\s*[-–]?\\s*(\\d{2,3})\\b`);
const RE_FERROVIA = /\b(FERROVIA|FERROVIARI[AO]|ESTRADA\s+DE\s+FERRO|LINHA\s+FERREA|LEITO\s+FERROVIARIO|EF\s*-?\s*\d{3})\b/;
const RE_MUNICIPAL = /\b(ESTRADA\s+(MUNICIPAL|VICINAL)|VICINAL|ESTRADA|CORREDOR|SERVIDAO|EM\s*-\s*\d+)\b/;
const RE_RODOVIA_ESTADUAL = /\bRODOVIA\s+ESTADUAL\b/;
const RE_RODOVIA_FEDERAL = /\bRODOVIA\s+FEDERAL\b/;

/**
 * O tipo de via pelo nome do confrontante ("RODOVIA BR-116", "BA 120",
 * "ESTRADA VICINAL", "LINHA FÉRREA"…). Nulo = não é via (imóvel, rio…).
 * "MUNICIPAL"/"VICINAL" escrito por extenso manda mesmo com código: no campo,
 * "ESTRADA MUNICIPAL BA-001" é estrada do município com apelido.
 */
export function classificarVia(rotulo: string | null | undefined): Via | null {
  const t = sem(String(rotulo ?? "").split("\\")[0]);
  if (!t.trim()) return null;
  // imóvel ("(MATR. 123) FAZENDA…") ou pessoa com CPF não é via
  if (/^\s*\(/.test(t) || /\bCPF\b|\bCNPJ\b/.test(t)) return null;
  const ferro = t.match(RE_FERROVIA);
  if (ferro) {
    const ef = t.match(/\bEF\s*-?\s*(\d{3})\b/);
    return { tipo: "ferrovia", sigla: ef ? `EF-${ef[1]}` : null, uf: null };
  }
  if (/\b(MUNICIPAL|VICINAL)\b/.test(t)) return { tipo: "municipal", sigla: null, uf: null };
  const br = t.match(RE_BR);
  if (br) return { tipo: "federal", sigla: `BR-${br[1]}`, uf: null };
  if (RE_RODOVIA_FEDERAL.test(t)) return { tipo: "federal", sigla: null, uf: null };
  // sigla de UF + 2 ou 3 dígitos ("BA-120", "BA 052", "SE 100"): rodovia estadual
  // sem hífen, só com "RODOVIA"/"ROD." ou sozinho: "ESTRADA DO PA 25 DE MAIO"
  // (projeto de assentamento) e "RUA SE 10" não são rodovia estadual
  const est = t.match(RE_ESTADUAL);
  const ehCodigo = !!est && (/[-–]/.test(est[0]) || /\bROD(OVIA\b|\.)/.test(t) || t.trim() === est[0].trim());
  if (est && ehCodigo) return { tipo: "estadual", sigla: `${est[1]}-${est[2].padStart(3, "0")}`, uf: est[1] };
  if (RE_RODOVIA_ESTADUAL.test(t)) return { tipo: "estadual", sigla: null, uf: null };
  // "BA" ou "RODOVIA BA" sem número (o confrontante sai assim no campo)
  if (/^\s*(RODOVIA\s+)?BA\s*$/.test(t)) return { tipo: "estadual", sigla: null, uf: "BA" };
  if (/\bRODOVIA\b/.test(t)) return { tipo: "estadual", sigla: null, uf: null };
  if (RE_MUNICIPAL.test(t)) return { tipo: "municipal", sigla: null, uf: null };
  return null;
}

/** Nome curto da via para textos: "BR-116", "BA-120", "rodovia estadual", "estrada municipal". */
export function nomeDaVia(v: Via): string {
  if (v.sigla) return v.sigla;
  return v.tipo === "federal" ? "rodovia federal" : v.tipo === "estadual" ? "rodovia estadual" : v.tipo === "ferrovia" ? "ferrovia" : "estrada municipal";
}

/** O que o operador pode ajustar por via (fica guardado no projeto/serviço). */
export interface AjusteRecuo {
  /** faixa de domínio em m por lado a partir do eixo (informada pelo operador) */
  dominio?: number | null;
  /** faixa não edificável em m (abaixo de 15 só com a lei municipal) */
  naoEdificavel?: number | null;
  /** número da lei municipal que reduziu a não edificável */
  leiMunicipal?: string | null;
  /** a divisa levantada passa no EIXO da via (e não na cerca/limite da faixa) */
  divisaNoEixo?: boolean;
}

export interface Recuo {
  via: Via;
  /** faixa de domínio por lado, a partir do eixo (nulo = sem regra) */
  dominio: number | null;
  origemDominio: OrigemFaixa;
  naoEdificavel: number;
  /** a não edificável está abaixo do padrão por lei municipal */
  reduzida: boolean;
  divisaNoEixo: boolean;
  /**
   * Quanto a terra útil recua A PARTIR DA DIVISA levantada: com a divisa no
   * eixo, a faixa de domínio inteira sai do imóvel; com a divisa na cerca
   * (o normal), nada sai.
   */
  recuoDaDivisa: number;
  /** linha da restrição de construir, a partir da divisa levantada */
  restricaoDaDivisa: number;
  /** precisa de confirmação antes da peça final (largura do padrão) */
  confirmar: boolean;
  avisos: string[];
}

/**
 * O recuo de uma via: o padrão da regra, por cima o que o operador informou.
 * Não edificável abaixo do padrão só com lei municipal e nunca abaixo de 5 m.
 */
export function recuoDaVia(via: Via, aj: AjusteRecuo = {}): Recuo {
  const r = regraDaVia(via);
  const avisos: string[] = [];
  const informado = typeof aj.dominio === "number" && Number.isFinite(aj.dominio) && aj.dominio >= 0;
  const dominio = informado ? (aj.dominio as number) : r.dominio;
  let ne = typeof aj.naoEdificavel === "number" && Number.isFinite(aj.naoEdificavel) && aj.naoEdificavel >= 0 ? aj.naoEdificavel : r.naoEdificavel;
  let reduzida = false;
  if (ne < r.naoEdificavel) {
    if (!r.reduzivel) {
      avisos.push(`A faixa não edificável de ${nomeDaVia(via)} não pode ser reduzida: ficou em ${r.naoEdificavel} m.`);
      ne = r.naoEdificavel;
    } else if (!aj.leiMunicipal?.trim()) {
      avisos.push(`Para reduzir a faixa não edificável abaixo de ${r.naoEdificavel} m é preciso informar a lei municipal: ficou em ${r.naoEdificavel} m.`);
      ne = r.naoEdificavel;
    } else if (ne < NAO_EDIFICAVEL_MINIMO) {
      avisos.push(`A lei permite reduzir a faixa não edificável até ${NAO_EDIFICAVEL_MINIMO} m: ficou em ${NAO_EDIFICAVEL_MINIMO} m.`);
      ne = NAO_EDIFICAVEL_MINIMO;
      reduzida = true;
    } else reduzida = true;
  }
  const divisaNoEixo = !!aj.divisaNoEixo && dominio !== null;
  if (aj.divisaNoEixo && dominio === null) avisos.push(`Sem a largura da faixa de domínio de ${nomeDaVia(via)} não dá para recuar a partir do eixo: informe a largura.`);
  const recuoDaDivisa = divisaNoEixo ? dominio! : 0;
  return {
    via, dominio, origemDominio: informado ? "informada" : "padrao", naoEdificavel: ne, reduzida, divisaNoEixo,
    recuoDaDivisa, restricaoDaDivisa: recuoDaDivisa + ne,
    confirmar: !informado && dominio !== null,
    avisos,
  };
}

const m = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m`;

/** Confrontante no padrão do INCRA: "RODOVIA BR-116 - FAIXA DE DOMÍNIO (DNIT)". */
export function confrontanteDaVia(v: Via): string {
  const r = regraDaVia(v);
  if (v.tipo === "municipal") return "ESTRADA MUNICIPAL";
  if (v.tipo === "ferrovia") return `${v.sigla ? `FERROVIA ${v.sigla}` : "FERROVIA"} - FAIXA DE DOMÍNIO`;
  return `RODOVIA ${v.sigla ?? (v.tipo === "federal" ? "FEDERAL" : "ESTADUAL")} - FAIXA DE DOMÍNIO (${r.orgao.toUpperCase()})`;
}

/** Uma linha para a tela: "faixa de domínio 30 m do eixo (padrão SEINFRA) · não edificável 15 m". */
export function resumoRecuo(r: Recuo): string {
  const partes: string[] = [];
  if (r.dominio !== null) partes.push(`faixa de domínio ${m(r.dominio)} do eixo${r.origemDominio === "padrao" ? ` (padrão ${regraDaVia(r.via).orgao} — confirme)` : ""}`);
  else partes.push("faixa de domínio: sem regra geral");
  partes.push(r.naoEdificavel > 0 ? `não edificável ${m(r.naoEdificavel)}${r.reduzida ? " (lei municipal)" : ""}` : "sem faixa não edificável");
  return partes.join(" · ");
}

/** O que o serviço guarda (servicos.recuo_vias): o ajuste de cada via e se a faixa sai na planta. */
export interface RecuoDoServico {
  vias?: Record<string, AjusteRecuo & { confirmado?: boolean }>;
  /** a faixa não edificável sai na planta (padrão: sim — pedido de recuo automático) */
  planta?: boolean;
}

/**
 * As opções da planta (DadosPlanta.naoEdificavel) a partir do que o serviço
 * guardou. A redução por lei municipal é REVALIDADA aqui (recuoDaVia): o que veio
 * da tela não passa sem a lei e nunca abaixo de 5 m. Sem nada guardado, a faixa
 * sai com o padrão de 15 m; `planta: false` tira.
 */
export function naoEdificavelDaPlanta(salvo: unknown): { padrao: number; porVia: Record<string, number> } | undefined {
  const r = (salvo && typeof salvo === "object" ? salvo : {}) as RecuoDoServico;
  if (r.planta === false) return undefined;
  const porVia: Record<string, number> = {};
  for (const [chave, aj] of Object.entries(r.vias ?? {})) {
    if (!aj || typeof aj !== "object" || aj.naoEdificavel === undefined || aj.naoEdificavel === null) continue;
    const via = classificarVia(chave)
      ?? ((["estadual", "federal", "municipal", "ferrovia"] as string[]).includes(chave) ? { tipo: chave as TipoVia, sigla: null, uf: null } : null);
    if (!via) continue;
    porVia[chave] = recuoDaVia(via, aj).naoEdificavel;
  }
  return { padrao: REGRAS_RECUO.estadual.naoEdificavel, porVia };
}

/**
 * Nota para planta e memorial (sugestão da pesquisa, base da dispensa de
 * anuência do Prov. CNJ 195/2025): o perímetro respeita a faixa de domínio e a
 * não edificável, com a fonte de cada número.
 */
export function notaRecuo(r: Recuo, aj: AjusteRecuo = {}): string {
  const nome = nomeDaVia(r.via).toUpperCase();
  const reg = regraDaVia(r.via);
  const dom = r.dominio !== null
    ? `faixa de domínio da ${r.via.tipo === "ferrovia" ? "" : "RODOVIA "}${nome} (${m(r.dominio)} de cada lado do eixo; fonte: ${r.origemDominio === "informada" ? "informada pelo responsável técnico" : `padrão ${reg.orgao}`})`
    : `faixa de domínio da ${nome}`;
  const fonteNe = r.via.tipo === "ferrovia" ? FONTE_NAO_EDIFICAVEL_FERROVIA : FONTE_NAO_EDIFICAVEL;
  const ne = r.naoEdificavel > 0
    ? ` e a faixa não edificável de ${m(r.naoEdificavel)} a partir dela (${fonteNe}${r.reduzida && aj.leiMunicipal ? `; reduzida pela lei municipal ${aj.leiMunicipal.trim()}` : ""})`
    : "";
  return `O perímetro respeita a ${dom}${ne}.`;
}
