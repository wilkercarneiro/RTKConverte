// Modelo do projeto de loteamento.
//
// O projeto guarda só INTENÇÃO — parâmetros, ruas, áreas e os ajustes que o
// operador fez à mão. Quadras e lotes NUNCA são gravados: saem de `calcular()`
// toda vez. É isso que faz o loteamento "se ajustar sozinho": mudar a largura de
// uma rua, a frente de um lote ou o fundo de uma quadra é mudar uma entrada, e
// o resto é recalculado a partir dela.
//
// Geometria gravada em UTM (absoluta): o plano de projeto depende do fator de
// escala, e um projeto salvo não pode andar se o operador trocar essa opção.
import type { Pt } from "./geom.ts";
import type { GradeTerreno } from "./terreno.ts";

export type ModoDivisao = "frente" | "area" | "quantidade";
/** Para onde vai o que sobra quando a fileira não dá um número inteiro de lotes. */
export type Sobra = "esquinas" | "ultimo" | "distribuir" | "extra";
export type TipoArea = "verde" | "institucional" | "app" | "lazer";
export type TipoBorda = "divisa" | "via" | "rio" | "rodovia" | "ferrovia";
export type Esquina = "raio" | "chanfro" | "nenhuma";

export const ROTULO_AREA: Record<TipoArea, string> = {
  verde: "Área verde",
  institucional: "Área institucional",
  app: "APP / faixa non aedificandi",
  lazer: "Área de lazer",
};

export const ROTULO_BORDA: Record<TipoBorda, string> = {
  divisa: "Divisa",
  via: "Rua/estrada existente",
  rio: "Rio / córrego (APP)",
  rodovia: "Rodovia (acesso + faixa non aedificandi)",
  ferrovia: "Ferrovia (faixa non aedificandi)",
};

/**
 * Lado por onde se entra no loteamento: estrada existente ou rodovia. É frente
 * de lote (o mais valorizado) e é onde as ruas novas podem se ligar.
 */
export const ehAcesso = (t: TipoBorda): boolean => t === "via" || t === "rodovia";

/**
 * Faixa non aedificandi de rodovia/ferrovia (Lei 6.766, art. 4º, III) é
 * RESTRIÇÃO de construir dentro do lote, não área pública: a terra continua
 * sendo lote. Só a APP de rio sai do loteamento.
 */
export const faixaDentroDoLote = (t: TipoBorda): boolean => t === "rodovia" || t === "ferrovia";

/** Faixa sugerida por tipo de borda (Lei 6.766 art. 4º III; Código Florestal art. 4º I a). */
export const FAIXA_SUGERIDA: Record<TipoBorda, number> = { divisa: 0, via: 0, rio: 30, rodovia: 15, ferrovia: 15 };

export interface Parametros {
  /** frente padrão do lote (m) */
  frente: number;
  /** profundidade padrão do lote (m) — a quadra de duas fileiras tem 2× isso */
  profundidade: number;
  /** Lei 6.766 art. 4º II: 125 m² e 5 m, salvo lei municipal mais exigente */
  areaMin: number;
  frenteMin: number;
  /**
   * Faixas de harmonia: lote fora delas é refeito pelo gerador (dividido,
   * aparado no fundo) e a edição não deixa passar. Projeto antigo sem elas
   * ganha valores derivados do padrão (`completarFaixas`).
   */
  frenteMax: number;
  profundidadeMin: number;
  profundidadeMax: number;
  /** área alvo do lote; nasce frente × profundidade */
  areaPadrao: number;
  areaMax: number;
  /** largura total da rua (pista + calçadas) */
  ruaLargura: number;
  /** pista de rolamento (só para o desenho e o memorial); calçadas = (largura − pista)/2 */
  ruaPista: number;
  esquina: Esquina;
  /** raio do arco (raio) ou recuo em cada alinhamento (chanfro), em metros */
  esquinaValor: number;
  /** comprimento máximo da quadra (lei municipal: 100–250 m é o comum) */
  quadraCompMax: number;
  sobra: Sobra;
  /** lotes que encostam na divisa da gleba: mesma frente padrão ou áreas iguais */
  divisa: "padronizar" | "areas_iguais";
  /** metas (% da gleba). Desde a Lei 9.785/99 quem fixa é o município. */
  pctVerdeMin: number;
  pctInstitucionalMin: number;
  pctPublicasMin: number;
  numeracaoQuadras: "letras" | "numeros";
  sentidoLotes: "horario" | "antihorario";
  /** desenhar em distâncias de terreno (plano topográfico) em vez da UTM pura */
  distanciasTerreno: boolean;
  /** preço do m² para o quadro de vendas (opcional) */
  precoM2: number;
  /** acréscimo do lote de esquina no quadro de vendas (%) */
  acrescimoEsquina: number;
}

export const PARAMETROS_PADRAO: Parametros = {
  frente: 10,
  profundidade: 25,
  areaMin: 125,
  frenteMin: 5,
  frenteMax: 20,
  profundidadeMin: 15,
  profundidadeMax: 40,
  areaPadrao: 250,
  areaMax: 500,
  ruaLargura: 12,
  ruaPista: 8,
  esquina: "raio",
  esquinaValor: 6,
  quadraCompMax: 200,
  sobra: "esquinas",
  divisa: "padronizar",
  pctVerdeMin: 10,
  pctInstitucionalMin: 5,
  pctPublicasMin: 35,
  numeracaoQuadras: "letras",
  sentidoLotes: "horario",
  distanciasTerreno: true,
  precoM2: 0,
  acrescimoEsquina: 10,
};

type Faixas = Pick<Parametros, "frenteMax" | "profundidadeMin" | "profundidadeMax" | "areaPadrao" | "areaMax">;
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Faixas derivadas do lote padrão: frente até 2×, fundo de 60% a 160%, área até 2×. */
export function faixasDerivadas(p: Pick<Parametros, "frente" | "profundidade" | "areaMin" | "frenteMin">): Faixas {
  const areaPadrao = Math.max(p.areaMin, Math.round(p.frente * p.profundidade));
  return {
    frenteMax: Math.max(p.frenteMin, r1(2 * p.frente)),
    profundidadeMin: r1(0.6 * p.profundidade),
    profundidadeMax: r1(1.6 * p.profundidade),
    areaPadrao,
    areaMax: Math.round(2 * areaPadrao),
  };
}

/**
 * Coloca as faixas em ordem (mínimo ≤ padrão ≤ máximo) e preenche as que
 * faltam. Quem chama decide o padrão; aqui só se garante a coerência.
 */
export function completarFaixas(p: Parametros, salvo?: Partial<Parametros>): Parametros {
  const d = faixasDerivadas(p);
  const tem = (k: keyof Faixas) => salvo === undefined || (typeof salvo[k] === "number" && Number.isFinite(salvo[k]));
  const q: Parametros = { ...p };
  for (const k of Object.keys(d) as (keyof Faixas)[]) if (!tem(k)) q[k] = d[k];
  q.frenteMin = Math.min(q.frenteMin, q.frente);
  q.frenteMax = Math.max(q.frenteMax, q.frente);
  q.profundidadeMin = Math.min(q.profundidadeMin, q.profundidade);
  q.profundidadeMax = Math.max(q.profundidadeMax, q.profundidade);
  q.areaPadrao = Math.max(q.areaPadrao, q.areaMin);
  q.areaMax = Math.max(q.areaMax, q.areaPadrao);
  return q;
}

/**
 * Muda o lote do projeto. Faixa que ainda estava no valor derivado do padrão
 * antigo acompanha o padrão novo (frente 10 → 12 leva a máxima de 20 a 24);
 * faixa que o usuário digitou fica. Depois tudo volta à ordem mín ≤ padrão ≤ máx.
 */
export function mudarLote(p: Parametros, patch: Partial<Parametros>): Parametros {
  const antes = faixasDerivadas(p);
  const novo: Parametros = { ...p, ...patch };
  // área padrão digitada não é "derivada" — só acompanha quando ninguém mexeu nela
  const depois = faixasDerivadas(novo);
  for (const k of Object.keys(antes) as (keyof Faixas)[]) {
    if (k in patch) continue;
    if (Math.abs(p[k] - antes[k]) < 1e-6) novo[k] = depois[k];
  }
  if ("areaPadrao" in patch && !("areaMax" in patch) && Math.abs(p.areaMax - 2 * p.areaPadrao) < 1e-6) novo.areaMax = Math.round(2 * novo.areaPadrao);
  // o campo digitado manda: mínima acima do padrão leva o padrão junto (e não o contrário)
  const ordenar = (min: keyof Parametros, pad: keyof Parametros, max: keyof Parametros) => {
    const q = novo as unknown as Record<string, number>;
    if (min in patch) { q[pad] = Math.max(q[pad], q[min]); q[max] = Math.max(q[max], q[pad]); }
    else if (max in patch) { q[pad] = Math.min(q[pad], q[max]); q[min] = Math.min(q[min], q[pad]); }
    else { q[min] = Math.min(q[min], q[pad]); q[max] = Math.max(q[max], q[pad]); }
  };
  ordenar("frenteMin", "frente", "frenteMax");
  ordenar("profundidadeMin", "profundidade", "profundidadeMax");
  ordenar("areaMin", "areaPadrao", "areaMax");
  return novo;
}

/** O que está incoerente nas faixas do lote (para avisar no assistente). */
export function conferirFaixas(p: Parametros): string[] {
  const out: string[] = [];
  if (p.frenteMin < 5 || p.areaMin < 125) out.push("abaixo do mínimo federal (125 m² e 5 m de frente — Lei 6.766, art. 4º, II)");
  if (p.frenteMax * p.profundidadeMax < p.areaMin) out.push("frente máxima × profundidade máxima não chega à área mínima: nenhum lote cabe");
  if (p.frenteMin * p.profundidadeMin > p.areaMax) out.push("frente mínima × profundidade mínima já passa da área máxima");
  if (p.frente * p.profundidade < p.areaMin - 0.5) out.push(`o lote padrão (${Math.round(p.frente * p.profundidade)} m²) é menor que a área mínima`);
  if (p.frente * p.profundidade > p.areaMax + 0.5) out.push(`o lote padrão (${Math.round(p.frente * p.profundidade)} m²) passa da área máxima`);
  return out;
}

/** Configuração de cada lado do perímetro (lado i vai do ponto i ao i+1). */
export interface Borda {
  tipo: TipoBorda;
  /** faixa a partir da divisa que NÃO vira lote (APP / non aedificandi), m */
  faixa: number;
  /** nome da via existente / do rio (vai para a planta e o memorial) */
  nome?: string;
}

export interface Rua {
  id: string;
  nome: string;
  largura: number;
  /** eixo em UTM */
  eixo: Pt[];
  /** raio do balão de retorno no fim do eixo (rua sem saída), m */
  balao?: number;
}

export interface AreaDesenhada {
  id: string;
  tipo: TipoArea;
  nome: string;
  /** contorno em UTM */
  anel: Pt[];
}

/**
 * Ajuste feito à mão num lote. A chave é (fileira, índice) dentro da quadra —
 * o lote é identificado pela posição na fileira, não pelo número, porque o
 * número muda quando um vizinho é unido ou dividido.
 */
export interface AjusteLote {
  fileira: number;
  indice: number;
  /** frente fixa (m, medida ao longo da rua) */
  frente?: number;
  /** área fixa (m²) */
  area?: number;
  /** une com o lote seguinte da fileira */
  unir?: boolean;
  /** divide em N lotes iguais */
  dividir?: number;
  /** vira área pública em vez de lote */
  destino?: TipoArea;
}

/**
 * Configuração de UMA quadra. A quadra é achada pela âncora (um ponto UTM
 * dentro dela): se uma rua for movida, a quadra que contém a âncora continua
 * sendo "a mesma" e leva os ajustes junto.
 */
export interface QuadraCfg {
  ancora: Pt;
  nome?: string;
  destino?: TipoArea;
  modo?: ModoDivisao;
  /** frente (m), área (m²) ou quantidade, conforme o modo */
  valor?: number;
  sobra?: Sobra;
  fileiras?: "auto" | 1 | 2;
  /** distância da frente principal até a linha de fundo (m) */
  fundo?: number;
  /** ponto UTM sobre o lado escolhido como frente principal */
  frentePrincipal?: Pt;
  ajustes: AjusteLote[];
}

export interface Projeto {
  versao: 1;
  nome: string;
  params: Parametros;
  bordas: Borda[];
  ruas: Rua[];
  areas: AreaDesenhada[];
  quadras: QuadraCfg[];
  /** etapa em que o operador parou (o assistente só aparece até gerar a 1ª proposta) */
  gerado: boolean;
  /** relevo da gleba (modelo digital de elevação calibrado pelo levantamento) */
  terreno?: GradeTerreno;
  /**
   * Retalhos sem frente que viraram área pública, marcados por um ponto (UTM)
   * dentro deles — sem redesenhar nada, para não mexer nas quadras vizinhas.
   */
  sobrasPublicas?: { ponto: Pt; tipo: TipoArea }[];
}

export function projetoNovo(nome: string, ladosPerimetro: number): Projeto {
  return {
    versao: 1,
    nome,
    params: { ...PARAMETROS_PADRAO },
    bordas: Array.from({ length: ladosPerimetro }, () => ({ tipo: "divisa" as TipoBorda, faixa: 0 })),
    ruas: [],
    areas: [],
    quadras: [],
    gerado: false,
  };
}

/** Normaliza um projeto lido do banco (campos novos ganham o padrão). */
export function normalizarProjeto(p: Partial<Projeto> | null | undefined, nome: string, lados: number): Projeto {
  const base = projetoNovo(nome, lados);
  if (!p || p.versao !== 1) return base;
  const bordas = Array.isArray(p.bordas) && p.bordas.length === lados ? p.bordas : base.bordas;
  return {
    ...base,
    ...p,
    params: completarFaixas({ ...PARAMETROS_PADRAO, ...(p.params ?? {}) }, p.params ?? {}),
    bordas,
    ruas: p.ruas ?? [],
    areas: p.areas ?? [],
    quadras: (p.quadras ?? []).map((q) => ({ ...q, ajustes: q.ajustes ?? [] })),
  };
}

let seq = 0;
export const novoId = (prefixo: string): string =>
  `${prefixo}${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
