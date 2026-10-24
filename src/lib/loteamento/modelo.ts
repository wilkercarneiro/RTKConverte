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

const fmtN = (x: number, casas = 2) => x.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const r2 = (x: number) => Math.round(x * 100) / 100;
type Tripla = { min: keyof Parametros; pad: keyof Parametros; max: keyof Parametros; rot: string; un: string };

/**
 * Edição das medidas do lote, com a coerência garantida na hora: o campo
 * digitado manda e os outros se acomodam, e cada acomodação vira uma frase
 * para o operador ver. Nada incoerente chega ao gerador.
 *  - mínima ≤ padrão ≤ máxima em frente, profundidade e área;
 *  - área padrão = frente × profundidade (o lote padrão é o retângulo padrão);
 *  - área máxima ≤ frente máxima × profundidade máxima (senão nenhum lote a atinge);
 *  - mínimos federais: 125 m² e 5 m de frente (Lei 6.766, art. 4º, II).
 * Faixa ainda no valor derivado do padrão antigo acompanha o padrão novo.
 */
export function editarMedidas(p: Parametros, patch: Partial<Parametros>): { params: Parametros; ajustes: string[] } {
  const ajustes: string[] = [];
  const editado = Object.keys(patch)[0] as keyof Parametros | undefined;
  const antes = faixasDerivadas(p);
  const novo: Parametros = { ...p, ...patch };
  const depois = faixasDerivadas(novo);
  for (const k of Object.keys(antes) as (keyof Faixas)[]) {
    if (k in patch) continue;
    if (Math.abs(p[k] - antes[k]) < 1e-6) novo[k] = depois[k];
  }
  if ("areaPadrao" in patch && !("areaMax" in patch) && Math.abs(p.areaMax - 2 * p.areaPadrao) < 1e-6) novo.areaMax = Math.round(2 * novo.areaPadrao);
  const q = novo as unknown as Record<string, number>;
  // mínimos federais
  if (novo.areaMin < 125) { ajustes.push("Área mínima elevada para 125 m² — é o mínimo da Lei 6.766 (art. 4º, II)."); novo.areaMin = 125; }
  if (novo.frenteMin < 5) { ajustes.push("Frente mínima elevada para 5 m — é o mínimo da Lei 6.766 (art. 4º, II)."); novo.frenteMin = 5; }
  // o campo digitado manda: mínima acima do padrão leva o padrão junto (e não o contrário)
  const ordenar = (t: Tripla) => {
    const v0 = { min: q[t.min], pad: q[t.pad], max: q[t.max] };
    if (t.min === editado) { q[t.pad] = Math.max(q[t.pad], q[t.min]); q[t.max] = Math.max(q[t.max], q[t.pad]); }
    else if (t.max === editado) { q[t.pad] = Math.min(q[t.pad], q[t.max]); q[t.min] = Math.min(q[t.min], q[t.pad]); }
    else { q[t.min] = Math.min(q[t.min], q[t.pad]); q[t.max] = Math.max(q[t.max], q[t.pad]); }
    for (const k of ["min", "pad", "max"] as const) {
      const campo = t[k];
      if (campo === editado || Math.abs(q[campo] - v0[k]) < 1e-6) continue;
      const nome = k === "min" ? "mínima" : k === "pad" ? "padrão" : "máxima";
      ajustes.push(`${t.rot} ${nome} ajustada para ${fmtN(q[campo], t.un === "m²" ? 0 : 2)} ${t.un} — a mínima não pode passar do padrão, nem o padrão da máxima.`);
    }
  };
  ordenar({ min: "frenteMin", pad: "frente", max: "frenteMax", rot: "Frente", un: "m" });
  ordenar({ min: "profundidadeMin", pad: "profundidade", max: "profundidadeMax", rot: "Profundidade", un: "m" });
  ordenar({ min: "areaMin", pad: "areaPadrao", max: "areaMax", rot: "Área", un: "m²" });
  // área padrão = frente × profundidade (quem digitou área manda na profundidade)
  const prod = novo.frente * novo.profundidade;
  if (Math.abs(novo.areaPadrao - prod) > 0.05 * prod) {
    const areaMandou = editado === "areaPadrao" || ((editado === "areaMin" || editado === "areaMax") && Math.abs(novo.areaPadrao - p.areaPadrao) > 1e-6);
    if (areaMandou) {
      novo.profundidade = r2(novo.areaPadrao / novo.frente);
      ajustes.push(`Profundidade padrão ajustada para ${fmtN(novo.profundidade)} m — para o lote padrão de ${fmtN(novo.frente)} m de frente dar ${fmtN(novo.areaPadrao, 0)} m².`);
      if (novo.profundidade > novo.profundidadeMax) { novo.profundidadeMax = novo.profundidade; ajustes.push(`Profundidade máxima ajustada para ${fmtN(novo.profundidadeMax)} m.`); }
      if (novo.profundidade < novo.profundidadeMin) { novo.profundidadeMin = novo.profundidade; ajustes.push(`Profundidade mínima ajustada para ${fmtN(novo.profundidadeMin)} m.`); }
    } else {
      novo.areaPadrao = Math.round(prod);
      ajustes.push(`Área padrão ajustada para ${fmtN(novo.areaPadrao, 0)} m² — é a frente × a profundidade do lote padrão (${fmtN(novo.frente)} × ${fmtN(novo.profundidade)} m).`);
      if (novo.areaPadrao > novo.areaMax) { novo.areaMax = novo.areaPadrao; ajustes.push(`Área máxima ajustada para ${fmtN(novo.areaMax, 0)} m².`); }
      if (novo.areaPadrao < novo.areaMin) { novo.areaMin = Math.max(125, novo.areaPadrao); ajustes.push(`Área mínima ajustada para ${fmtN(novo.areaMin, 0)} m².`); }
    }
  }
  // área máxima alcançável: frente máxima × profundidade máxima
  const teto = novo.frenteMax * novo.profundidadeMax;
  if (novo.areaMax > teto + 0.5) {
    if (editado === "areaMax") {
      novo.profundidadeMax = r2(novo.areaMax / novo.frenteMax);
      ajustes.push(`Profundidade máxima ajustada para ${fmtN(novo.profundidadeMax)} m — com ${fmtN(novo.frenteMax)} m de frente máxima, só assim um lote chega a ${fmtN(novo.areaMax, 0)} m².`);
    } else {
      novo.areaMax = Math.floor(teto);
      ajustes.push(`Área máxima ajustada para ${fmtN(novo.areaMax, 0)} m² — é o maior lote possível com ${fmtN(novo.frenteMax)} × ${fmtN(novo.profundidadeMax)} m.`);
    }
  }
  if (novo.areaMin > novo.areaMax) { novo.areaMin = novo.areaMax; ajustes.push(`Área mínima ajustada para ${fmtN(novo.areaMin, 0)} m².`); }
  return { params: novo, ajustes };
}

/** Só os parâmetros (para os comandos do editor). */
export function mudarLote(p: Parametros, patch: Partial<Parametros>): Parametros {
  return editarMedidas(p, patch).params;
}

/**
 * Conferência antes de gerar: o que impede gerar (bloqueio) e o que vai dar
 * resultado ruim (aviso). `areaGleba` em m².
 */
export function conferirConfiguracao(p: Parametros, areaGleba?: number): { bloqueios: string[]; avisos: string[] } {
  const bloqueios: string[] = [];
  const avisos: string[] = [];
  const nomes: Partial<Record<keyof Parametros, string>> = {
    frente: "frente padrão", profundidade: "profundidade padrão", frenteMin: "frente mínima", frenteMax: "frente máxima",
    profundidadeMin: "profundidade mínima", profundidadeMax: "profundidade máxima", areaMin: "área mínima", areaPadrao: "área padrão",
    areaMax: "área máxima", ruaLargura: "largura da rua",
  };
  for (const [k, nome] of Object.entries(nomes)) if (!(Number(p[k as keyof Parametros]) > 0)) bloqueios.push(`A ${nome} precisa ser maior que zero.`);
  if (p.frenteMin > p.frente || p.frente > p.frenteMax || p.profundidadeMin > p.profundidade || p.profundidade > p.profundidadeMax || p.areaMin > p.areaPadrao || p.areaPadrao > p.areaMax)
    bloqueios.push("As medidas do lote estão fora de ordem: a mínima passa do padrão ou o padrão passa da máxima.");
  const prod = p.frente * p.profundidade;
  if (Math.abs(p.areaPadrao - prod) > 0.05 * prod) bloqueios.push(`A área padrão (${fmtN(p.areaPadrao, 0)} m²) não bate com frente × profundidade (${fmtN(prod, 0)} m²).`);
  if (p.areaMax > p.frenteMax * p.profundidadeMax + 0.5) bloqueios.push(`A área máxima (${fmtN(p.areaMax, 0)} m²) é maior que o maior lote possível (${fmtN(p.frenteMax)} × ${fmtN(p.profundidadeMax)} m).`);
  if (p.areaMin < 125 || p.frenteMin < 5) bloqueios.push("Abaixo do mínimo federal: 125 m² e 5 m de frente (Lei 6.766, art. 4º, II).");
  if (p.ruaPista > p.ruaLargura) bloqueios.push(`A pista (${fmtN(p.ruaPista)} m) é mais larga que a rua (${fmtN(p.ruaLargura)} m).`);
  if (p.ruaLargura < 6) bloqueios.push("Rua com menos de 6 m não comporta pista e calçadas.");
  if (p.pctVerdeMin + p.pctInstitucionalMin > 60) bloqueios.push("Área verde + institucional acima de 60% da gleba: não sobra loteamento.");
  if (areaGleba !== undefined && areaGleba > 0) {
    // ruas e áreas públicas levam uns 25% a mais do que as metas: o resto tem de caber em 4 lotes padrão
    const util = areaGleba * (1 - Math.min(0.8, 0.25 + (p.pctVerdeMin + p.pctInstitucionalMin) / 100));
    if (util < 4 * p.areaPadrao) bloqueios.push(`A gleba tem ${fmtN(areaGleba, 0)} m²: tirando ruas e áreas públicas, não cabem nem 4 lotes de ${fmtN(p.areaPadrao, 0)} m². Diminua o lote padrão.`);
  }
  // recomendações (não bloqueiam)
  const razao = p.profundidade / p.frente;
  if (razao > 5) bloqueios.push(`Lote padrão de ${fmtN(p.frente)} × ${fmtN(p.profundidade)} m: o fundo tem ${fmtN(razao, 1)} vezes a frente — não é lote de loteamento (o usual é até 3 vezes). Aumente a frente ou diminua a profundidade.`);
  else if (razao > 3.5) avisos.push(`Lote padrão comprido: o fundo (${fmtN(p.profundidade)} m) tem ${fmtN(razao, 1)} vezes a frente. O usual é até 3 vezes (códigos de parcelamento: 2,5 a 3).`);
  if (razao < 1) avisos.push(`Lote padrão mais largo que fundo (${fmtN(p.frente)} × ${fmtN(p.profundidade)} m): quadra rasa e muita rua por lote.`);
  if (p.pctPublicasMin > 0 && p.pctVerdeMin + p.pctInstitucionalMin <= 0)
    avisos.push(`Sem área verde nem institucional, as áreas públicas ficam só no viário (uns 15 a 25% da gleba) — abaixo da meta municipal de ${fmtN(p.pctPublicasMin, 0)}% informada. Confirme com a prefeitura.`);
  // faixa sem folga não absorve a gleba irregular
  if (p.areaMax < 1.4 * p.areaPadrao || p.frenteMax < 1.3 * p.frente || p.profundidadeMax < 1.2 * p.profundidade)
    avisos.push("Faixas máximas apertadas: nas pontas e na divisa torta não há folga para um lote maior absorver a irregularidade — sobram retalhos e lotes fora das medidas. Recomendado: frente máxima de pelo menos 1,3×, profundidade máxima de 1,2× e área máxima de 1,5× o padrão.");
  if (p.areaMin > 0.85 * p.areaPadrao || p.frenteMin > 0.85 * p.frente || p.profundidadeMin > 0.85 * p.profundidade)
    avisos.push("Faixas mínimas apertadas: onde a gleba afina, os lotes da ponta ficam abaixo do mínimo e viram retalho. Recomendado: mínimas até 80% do padrão.");
  return { bloqueios, avisos };
}

/** Folga recomendada a partir do padrão (o botão "usar folga recomendada"). */
export function folgaRecomendada(p: Parametros): Parametros {
  const q = { ...p };
  q.frenteMin = Math.max(5, Math.min(q.frenteMin, r2(0.8 * q.frente)));
  q.frenteMax = Math.max(q.frenteMax, r2(1.5 * q.frente));
  q.profundidadeMin = Math.min(q.profundidadeMin, r2(0.8 * q.profundidade));
  q.profundidadeMax = Math.max(q.profundidadeMax, r2(1.4 * q.profundidade));
  q.areaPadrao = Math.round(q.frente * q.profundidade);
  q.areaMin = Math.max(125, Math.min(q.areaMin, Math.round(0.8 * q.areaPadrao)));
  q.areaMax = Math.min(Math.floor(q.frenteMax * q.profundidadeMax), Math.max(q.areaMax, Math.round(1.6 * q.areaPadrao)));
  return q;
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
