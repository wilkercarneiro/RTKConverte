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
  rodovia: "Rodovia (non aedificandi)",
  ferrovia: "Ferrovia (non aedificandi)",
};

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
    params: { ...PARAMETROS_PADRAO, ...(p.params ?? {}) },
    bordas,
    ruas: p.ruas ?? [],
    areas: p.areas ?? [],
    quadras: (p.quadras ?? []).map((q) => ({ ...q, ajustes: q.ajustes ?? [] })),
  };
}

let seq = 0;
export const novoId = (prefixo: string): string =>
  `${prefixo}${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
