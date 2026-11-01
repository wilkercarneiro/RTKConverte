// Receita de leitura: a descrição, em dados, de como ler um arquivo de pontos.
//
// Um formato novo de aparelho é uma RECEITA, não código novo. Quem escreve a
// receita pode ser o detector por regras, a IA, o operador (na prévia) ou um
// perfil salvo — e quem a EXECUTA é sempre o mesmo código determinístico
// (executor.ts), que copia os números do arquivo original. A IA nunca digita
// coordenada nenhuma: só diz onde ela está.
//
// O formato é "estrito" (todos os campos presentes, nulos quando não se aplicam)
// para servir tal e qual de esquema JSON à saída estruturada da IA.

/** Papéis que uma coluna pode ter. */
export const PAPEIS = [
  "nome", "codigo", "e", "n", "h", "lat", "lon", "sigma_pos", "sigma_h", "sigma_n", "sigma_e",
] as const;
export type Papel = typeof PAPEIS[number];

export type Campos = Record<Papel, number | null>;

export type Registro =
  | "linha"        // um ponto por linha (TXT, CSV, PNEZD, RTKLIB, Nikon, …)
  | "gsi"          // Leica GSI-8/16 (palavras de largura fixa com índice WI)
  | "chave_valor"  // relatório "CHAVE: valor" (IBGE-PPP .txt)
  | "ppp_sum"      // relatório IBGE-PPP .sum
  | "xml"          // LandXML / Trimble JobXML / KML / GPX
  | "geojson"
  | "dxf"
  | "planilha"     // xlsx / ods já convertidos em linhas
  | "texto_livre"; // memorial, e-mail, relatório: pares de coordenadas soltos

export type Tokenizacao = "delimitado" | "espacos" | "largura_fixa" | "regex";

export interface Receita {
  versao: 1;
  registro: Registro;
  /** Linhas físicas a pular no topo (cabeçalho, metadados). */
  pular_inicio: number;
  /** Regex (sem barras; aplicadas com a flag i) de linhas que não são ponto. */
  ignorar: string[];
  tokenizacao: Tokenizacao;
  /** Delimitado: ";", ",", "\t", "|", ":". */
  delimitador: string | null;
  /** Nº esperado de colunas (delimitado/espacos). Linhas com mais tokens têm o
   *  excedente juntado na coluna `excedente_em` (rótulo com o separador dentro). */
  colunas: number | null;
  excedente_em: number | null;
  /** Largura fixa: posição (0-based) de início de cada coluna. */
  cortes: number[] | null;
  /** Modo regex: grupos nomeados com os nomes dos papéis, ex.: (?<nome>…);(?<e>…). */
  regex: string | null;
  decimal: "," | ".";
  campos: Campos;
  sistema: "utm" | "geografica";
  /** Fuso forçado (null = detectar pelas coordenadas). */
  fuso: number | null;
  hemisferio: "S" | "N";
  unidade_sigma: "m" | "cm" | "mm";
  confianca_sigma: "1sigma" | "95";
  /** "numero_e_rotulo": "5ramon/faz" → ponto 5, rótulo "ramon/faz" (o formato
   *  de sempre). "texto": o nome inteiro é o identificador ("postp_1", "M-01"). */
  nome_formato: "numero_e_rotulo" | "texto";
  ordem: "auto" | "id" | "arquivo";
  /** Regex de nomes/rótulos de pontos de APOIO (base, referência): ficam fora do perímetro. */
  apoio: string[];
  /** Quem escreveu: "padrao" | "regras" | "ia:<modelo>" | "operador" | "perfil:<id>". */
  origem: string;
  /** Explicação em português do que foi entendido (vai para a prévia). */
  explicacao: string;
}

export const camposVazios = (): Campos => ({
  nome: null, codigo: null, e: null, n: null, h: null, lat: null, lon: null,
  sigma_pos: null, sigma_h: null, sigma_n: null, sigma_e: null,
});

/** Padrões de ponto de apoio usados quando a receita não diz nada. */
export const APOIO_PADRAO = ["rtcm", "(^|[^a-z])ref([^a-z]|$)", "^base([^a-z]|$)", "(^|[^a-z])base$", "^esta[cç][aã]o\\b"];

/**
 * A receita do formato de sempre (LARISSA/THEREZA/ANTONIO):
 * `ID[rótulo] ; E ; N ; h ; σpos ; σh`. O decimal e o separador mudam entre as
 * duas convenções de máquina; o resto é igual.
 */
export function receitaPadrao(delimitador: ";" | ","): Receita {
  return {
    versao: 1, registro: "linha", pular_inicio: 0, ignorar: [],
    tokenizacao: "delimitado", delimitador, colunas: 6, excedente_em: 0, cortes: null, regex: null,
    decimal: delimitador === ";" ? "," : ".",
    campos: { ...camposVazios(), nome: 0, e: 1, n: 2, h: 3, sigma_pos: 4, sigma_h: 5 },
    sistema: "utm", fuso: null, hemisferio: "S", unidade_sigma: "m", confianca_sigma: "1sigma",
    nome_formato: "numero_e_rotulo", ordem: "auto", apoio: [...APOIO_PADRAO],
    origem: "padrao",
    explicacao: `Formato padrão das coletoras da equipe: ponto (com o rótulo colado), E, N, altura e as duas precisões, separados por "${delimitador}".`,
  };
}

// ---------------------------------------------------------------------------
// Validação da receita (vinda da IA, da tela ou do banco: nunca confiar)
// ---------------------------------------------------------------------------

const REGISTROS: Registro[] = ["linha", "gsi", "chave_valor", "ppp_sum", "xml", "geojson", "dxf", "planilha", "texto_livre"];
const TOKENIZACOES: Tokenizacao[] = ["delimitado", "espacos", "largura_fixa", "regex"];
const DELIMITADORES = [";", ",", "\t", "|", ":"];

/** Regex com quantificador aninhado ("(a+)+", "(\w*)*") pode travar o servidor. */
export function regexPerigosa(p: string): boolean {
  if (p.length > 400) return true;
  return /\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]/.test(p) || /\\[1-9]/.test(p);
}

function compilar(p: string, onde: string, erros: string[]): void {
  if (regexPerigosa(p)) { erros.push(`${onde}: expressão regular recusada (longa demais ou com repetição aninhada)`); return; }
  try { new RegExp(p, "i"); } catch { erros.push(`${onde}: expressão regular inválida`); }
}

/**
 * Confere e normaliza uma receita de origem não confiável. Devolve a receita
 * limpa ou a lista de problemas (nunca lança).
 */
export function validarReceita(bruta: unknown): { receita: Receita | null; erros: string[] } {
  const erros: string[] = [];
  if (!bruta || typeof bruta !== "object") return { receita: null, erros: ["receita ausente"] };
  const r = bruta as Record<string, unknown>;
  const int = (v: unknown, min: number, max: number): number | null =>
    typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null;

  const registro = REGISTROS.includes(r.registro as Registro) ? r.registro as Registro : null;
  if (!registro) erros.push("registro inválido");
  const tokenizacao = TOKENIZACOES.includes(r.tokenizacao as Tokenizacao) ? r.tokenizacao as Tokenizacao : null;
  if (!tokenizacao) erros.push("tokenização inválida");
  const delimitador = r.delimitador === null || r.delimitador === undefined ? null
    : DELIMITADORES.includes(r.delimitador as string) ? r.delimitador as string : undefined;
  if (delimitador === undefined) erros.push("delimitador inválido");
  if (tokenizacao === "delimitado" && !delimitador) erros.push("tokenização delimitada sem delimitador");

  const ignorar = Array.isArray(r.ignorar) ? r.ignorar.filter((x): x is string => typeof x === "string").slice(0, 30) : [];
  ignorar.forEach((p, i) => compilar(p, `ignorar[${i}]`, erros));
  const apoio = Array.isArray(r.apoio) ? r.apoio.filter((x): x is string => typeof x === "string").slice(0, 30) : [...APOIO_PADRAO];
  apoio.forEach((p, i) => compilar(p, `apoio[${i}]`, erros));

  const regex = typeof r.regex === "string" && r.regex ? r.regex : null;
  if (tokenizacao === "regex") {
    if (!regex) erros.push("tokenização regex sem expressão");
    else {
      compilar(regex, "regex", erros);
      if (!/\(\?<(e|lat)>/.test(regex) || !/\(\?<(n|lon)>/.test(regex)) erros.push("a regex precisa dos grupos (?<e>…) e (?<n>…) ou (?<lat>…) e (?<lon>…)");
    }
  }
  const cortes = Array.isArray(r.cortes) && r.cortes.every((c) => int(c, 0, 1000) !== null) ? (r.cortes as number[]).slice() : null;
  if (tokenizacao === "largura_fixa" && (!cortes || cortes.length < 2)) erros.push("largura fixa sem as posições das colunas");

  const camposIn = (r.campos && typeof r.campos === "object" ? r.campos : {}) as Record<string, unknown>;
  const campos = camposVazios();
  for (const p of PAPEIS) {
    const v = camposIn[p];
    if (v === null || v === undefined) continue;
    const c = int(v, 0, 200);
    if (c === null) erros.push(`campo ${p}: coluna inválida`); else campos[p] = c;
  }
  const temUtm = campos.e !== null && campos.n !== null;
  const temGeo = campos.lat !== null && campos.lon !== null;
  const registroTabular = registro === "linha" || registro === "planilha";
  if (registroTabular && tokenizacao !== "regex" && !temUtm && !temGeo) erros.push("a receita precisa das colunas de E e N ou de latitude e longitude");

  const fuso = r.fuso === null || r.fuso === undefined ? null : int(r.fuso, 18, 25);
  if (r.fuso !== null && r.fuso !== undefined && fuso === null) erros.push("fuso inválido (18 a 25)");
  const umDe = <T extends string>(v: unknown, ops: readonly T[], padrao: T): T => (ops.includes(v as T) ? v as T : padrao);

  const receita: Receita = {
    versao: 1,
    registro: registro ?? "linha",
    pular_inicio: int(r.pular_inicio, 0, 100000) ?? 0,
    ignorar,
    tokenizacao: tokenizacao ?? "delimitado",
    delimitador: delimitador ?? null,
    colunas: r.colunas === null || r.colunas === undefined ? null : int(r.colunas, 1, 200),
    excedente_em: r.excedente_em === null || r.excedente_em === undefined ? null : int(r.excedente_em, 0, 200),
    cortes,
    regex,
    decimal: umDe(r.decimal, [",", "."] as const, "."),
    campos,
    sistema: umDe(r.sistema, ["utm", "geografica"] as const, temUtm ? "utm" : "geografica"),
    fuso,
    hemisferio: umDe(r.hemisferio, ["S", "N"] as const, "S"),
    unidade_sigma: umDe(r.unidade_sigma, ["m", "cm", "mm"] as const, "m"),
    confianca_sigma: umDe(r.confianca_sigma, ["1sigma", "95"] as const, "1sigma"),
    nome_formato: umDe(r.nome_formato, ["numero_e_rotulo", "texto"] as const, "texto"),
    ordem: umDe(r.ordem, ["auto", "id", "arquivo"] as const, "auto"),
    apoio,
    origem: typeof r.origem === "string" ? r.origem.slice(0, 120) : "desconhecida",
    explicacao: typeof r.explicacao === "string" ? r.explicacao.slice(0, 1200) : "",
  };
  return { receita: erros.length ? null : receita, erros };
}

/** Esquema JSON da receita para a saída estruturada (modo estrito da OpenAI). */
export function esquemaJsonReceita(): Record<string, unknown> {
  const anula = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });
  const camposProps: Record<string, unknown> = {};
  for (const p of PAPEIS) camposProps[p] = anula({ type: "integer" });
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "registro", "pular_inicio", "ignorar", "tokenizacao", "delimitador", "colunas", "excedente_em",
      "cortes", "regex", "decimal", "campos", "sistema", "fuso", "hemisferio", "unidade_sigma",
      "confianca_sigma", "nome_formato", "ordem", "apoio", "explicacao", "confianca",
    ],
    properties: {
      registro: { type: "string", enum: REGISTROS },
      pular_inicio: { type: "integer" },
      ignorar: { type: "array", items: { type: "string" } },
      tokenizacao: { type: "string", enum: TOKENIZACOES },
      delimitador: anula({ type: "string", enum: DELIMITADORES }),
      colunas: anula({ type: "integer" }),
      excedente_em: anula({ type: "integer" }),
      cortes: anula({ type: "array", items: { type: "integer" } }),
      regex: anula({ type: "string" }),
      decimal: { type: "string", enum: [",", "."] },
      campos: { type: "object", additionalProperties: false, required: [...PAPEIS], properties: camposProps },
      sistema: { type: "string", enum: ["utm", "geografica"] },
      fuso: anula({ type: "integer" }),
      hemisferio: { type: "string", enum: ["S", "N"] },
      unidade_sigma: { type: "string", enum: ["m", "cm", "mm"] },
      confianca_sigma: { type: "string", enum: ["1sigma", "95"] },
      nome_formato: { type: "string", enum: ["numero_e_rotulo", "texto"] },
      ordem: { type: "string", enum: ["auto", "id", "arquivo"] },
      apoio: { type: "array", items: { type: "string" } },
      explicacao: { type: "string" },
      confianca: { type: "number" },
    },
  };
}
