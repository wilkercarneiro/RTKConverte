// IA intérprete (OpenAI). A IA lê o cabeçalho e uma AMOSTRA das linhas e
// devolve só uma RECEITA (saída estruturada, esquema estrito). Ela nunca
// devolve coordenada: quem lê os números é o executor, e quem aprova é o
// validador. Receita reprovada volta para a IA com o motivo; depois de duas
// tentativas no modelo rápido, uma no modelo forte.
//
// A chamada HTTP é injetada (`fetch`): os testes simulam a API.
import type { Proj4 } from "../geo.ts";
import { esquemaJsonReceita, validarReceita } from "./receita.ts";
import type { Receita } from "./receita.ts";
import { executarReceita, notaDaLeitura } from "./index.ts";
import { dividirDelimitado, dividirEspacos } from "./executor.ts";
import { lerNumero } from "./numeros.ts";
import type { Leitura } from "./index.ts";

export interface ConfigIA {
  apiKey: string;
  url?: string;
  modeloRapido?: string;
  modeloForte?: string;
  fetch?: typeof fetch;
  /** Tempo máximo de cada chamada (ms). */
  timeoutMs?: number;
}

export interface TentativaIA {
  modelo: string;
  tentativa: number;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number | null;
  aprovada: boolean;
  motivo: string;
  ms: number;
}

/** US$ por milhão de tokens (entrada, saída) — páginas oficiais, 2026-11-01. */
export const PRECOS_OPENAI: Record<string, [number, number]> = {
  "gpt-6-luna": [0.10, 0.50],
  "gpt-6.1-terra": [1.00, 5.00],
  "gpt-6.1-sol": [2.00, 10.00],
  "gpt-6-astra": [10.00, 50.00],
};

export const MODELO_RAPIDO_PADRAO = "gpt-6-luna";
export const MODELO_FORTE_PADRAO = "gpt-6.1-sol";

// ---------------------------------------------------------------------------
// Pedido
// ---------------------------------------------------------------------------

const INSTRUCOES = `Você é o intérprete de arquivos de pontos topográficos de um sistema brasileiro de georreferenciamento rural (SIGEF/INCRA).
Sua tarefa: descrever COMO ler o arquivo, devolvendo uma RECEITA em JSON no esquema dado. Você NUNCA copia nem calcula coordenadas: um programa aplica a sua receita ao arquivo inteiro e confere tudo.

Contexto dos dados:
- Coordenadas UTM SIRGAS 2000, fusos 18S a 25S. No Brasil, E (este/easting/X) tem 6 dígitos inteiros (166000 a 834000) e N (norte/northing/Y) tem 7 (6100000 a 10000000). Na convenção chinesa X é o NORTE.
- Ou geográficas: latitude de -33,8 a +5,3; longitude de -74 a -34 (graus decimais, ou GMS como 15°33'18,9"S, -15 33 18.938, 39:05:04.7W).
- Altitude (h, cota, elevation, ellipsoidal height) de -100 a 3100 m.
- Precisões (σ, RMS, HRMS/VRMS, sdn/sde/sdu): valores pequenos (0 a 5 m), com casas decimais. σ horizontal → sigma_pos (ou sigma_n e sigma_e separados); vertical → sigma_h. Colunas de PDOP, satélites, status, antena, data/hora NÃO são precisão: deixe-as sem papel.
- A equipe usa o formato "ponto;E;N;h;σpos;σh" com o rótulo colado ao número ("5ramon/faz") — para isso, nome_formato = "numero_e_rotulo". Com coluna de código separada, use "texto".
- Base/referência (BASE, REF, RTCM, estação) não é vértice do imóvel: inclua em "apoio" uma regex que case o nome desses pontos.

Como escrever a receita:
- registro = "linha" (um ponto por linha).
- tokenizacao: "delimitado" (com delimitador), "espacos" (colunas separadas por um ou mais espaços), "largura_fixa" (cortes = posição inicial, 0-based, de cada coluna) ou "regex" (uma expressão com grupos nomeados (?<nome>…)(?<e>…)(?<n>…)(?<h>…)(?<lat>…)(?<lon>…)(?<sigma_pos>…)(?<sigma_h>…)(?<sigma_n>…)(?<sigma_e>…)(?<codigo>…) que case a LINHA INTEIRA de cada ponto; use regex quando nenhum dos outros modos servir). Nada de repetição aninhada como (a+)+.
- campos: índice 0-based da coluna de cada papel depois de dividir a linha; null se o papel não existe. Em modo regex os campos são ignorados (valem os grupos).
- campos.nome é a coluna que IDENTIFICA o ponto (número ou nome: 12, M-01, P5, postp_1) — mesmo que venha depois de um prefixo de registro como "CP". campos.codigo é só para descrição/atributo (MARCO, cerca, estrada, joao/maria). Nunca ponha o número do ponto em codigo.
- Expressões regulares no padrão JavaScript, sem flags embutidas: escreva "^base", não "(?i)^base" nem "/base/i" (o sistema já ignora maiúsculas).
- colunas: quantas colunas uma linha de ponto tem. excedente_em: a coluna de texto que recebe tokens a mais quando um rótulo contém o próprio delimitador (normalmente a de nome ou a de código); null se não houver.
- pular_inicio: quantas linhas físicas pular no topo (cabeçalho e metadados) = número da primeira linha de ponto menos 1.
- ignorar: regex de linhas DENTRO do bloco de pontos que não são ponto (cabeçalho repetido, régua de traços, comentário). Rodapé no fim pode ficar de fora.
- decimal: "," ou "." (o das colunas numéricas). unidade_sigma: "m", "cm" ou "mm" (veja o título da coluna). confianca_sigma: "95" só se o arquivo disser 95% (relatório IBGE-PPP).
- sistema: "utm" se houver E/N; "geografica" se só houver lat/lon. fuso: null (o sistema detecta). hemisferio: "S".
- ordem: "auto".
- explicacao: 1 a 3 frases em português simples para o operador, dizendo o que você entendeu (aparelho provável, ordem das colunas, unidades, linhas puladas).
- confianca: de 0 a 1.

As linhas vêm numeradas como "123| texto" — o prefixo "123| " NÃO faz parte da linha.`;

function amostra(linhas: string[]): string {
  const idx = new Set<number>();
  const naoVazias = linhas.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  naoVazias.slice(0, 40).forEach((i) => idx.add(i));
  naoVazias.slice(-10).forEach((i) => idx.add(i));
  const meio = naoVazias.slice(40, -10);
  for (let k = 0; k < Math.min(20, meio.length); k++) idx.add(meio[Math.floor((k * meio.length) / Math.min(20, meio.length))]);
  const ordem = [...idx].sort((a, b) => a - b);
  const out: string[] = [];
  let ant = -1;
  for (const i of ordem) {
    if (ant >= 0 && i > ant + 1) out.push(`   … (${i - ant - 1} linha(s) omitida(s))`);
    out.push(`${i + 1}| ${linhas[i].slice(0, 400)}`);
    ant = i;
  }
  return out.join("\n");
}

export function montarPedido(linhas: string[], nomeArquivo: string, pista: { receita: Receita; duvidas: string[] } | null, erroAnterior: string | null): { instrucoes: string; entrada: string } {
  const partes = [
    `Arquivo: ${nomeArquivo || "(sem nome)"} — ${linhas.length} linha(s).`,
    "",
    "Amostra:",
    amostra(linhas),
  ];
  if (pista) {
    partes.push("", "Tentativa das regras automáticas (pode estar errada):", JSON.stringify({ ...pista.receita, explicacao: undefined, origem: undefined }), `Dúvidas das regras: ${pista.duvidas.join("; ") || "nenhuma"}`);
  }
  if (erroAnterior) partes.push("", "Sua receita anterior foi REPROVADA pela conferência automática:", erroAnterior, "Corrija e devolva uma nova receita.");
  return { instrucoes: INSTRUCOES, entrada: partes.join("\n") };
}

// ---------------------------------------------------------------------------
// Chamada (Responses API)
// ---------------------------------------------------------------------------

interface RespostaIA { receitaBruta: unknown; tokensEntrada: number; tokensSaida: number }

function textoDaResposta(j: Record<string, unknown>): string | null {
  if (typeof j.output_text === "string") return j.output_text;
  const out = Array.isArray(j.output) ? j.output as Record<string, unknown>[] : [];
  for (const item of out) {
    const conteudo = Array.isArray(item.content) ? item.content as Record<string, unknown>[] : [];
    for (const c of conteudo) {
      if (c.type === "refusal") throw new Error(`a IA recusou: ${String(c.refusal ?? "")}`);
      if (c.type === "output_text" && typeof c.text === "string") return c.text;
    }
  }
  return null;
}

async function chamar(cfg: ConfigIA, modelo: string, pedido: { instrucoes: string; entrada: string }): Promise<RespostaIA> {
  const f = cfg.fetch ?? fetch;
  const url = cfg.url ?? "https://api.openai.com/v1/responses";
  const corpo = (formato: "estrito" | "json", comRaciocinio: boolean) => ({
    model: modelo,
    input: [
      { role: "system", content: pedido.instrucoes },
      { role: "user", content: pedido.entrada + (formato === "json" ? "\n\nResponda SOMENTE com o objeto JSON da receita." : "") },
    ],
    text: { format: formato === "estrito"
      ? { type: "json_schema", name: "receita_leitura", schema: esquemaJsonReceita(), strict: true }
      : { type: "json_object" } },
    ...(comRaciocinio ? { reasoning: { effort: "low" } } : {}),
    max_output_tokens: 8000,
  });
  // modelos que não aceitam o esquema estrito ou o parâmetro de raciocínio: tenta sem eles
  const tentativas: ["estrito" | "json", boolean][] = [["estrito", true], ["estrito", false], ["json", false]];
  let ultimoErro = "";
  for (const [formato, raciocinio] of tentativas) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), cfg.timeoutMs ?? 90_000);
    let r: Response;
    try {
      r = await f(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(corpo(formato, raciocinio)),
        signal: ctl.signal,
      });
    } finally { clearTimeout(t); }
    const j = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (!r.ok) {
      const msg = String((j.error as Record<string, unknown> | undefined)?.message ?? `HTTP ${r.status}`);
      ultimoErro = msg;
      if (r.status === 400 && /reasoning|json_schema|strict|text\.format|response_format|not supported|unsupported/i.test(msg)) continue;
      throw new Error(`OpenAI ${r.status}: ${msg}`);
    }
    const texto = textoDaResposta(j);
    if (!texto) throw new Error("a IA não devolveu texto");
    const uso = (j.usage ?? {}) as Record<string, number>;
    let receitaBruta: unknown;
    try { receitaBruta = JSON.parse(texto); } catch { throw new Error("a IA devolveu JSON inválido"); }
    return { receitaBruta, tokensEntrada: uso.input_tokens ?? 0, tokensSaida: uso.output_tokens ?? 0 };
  }
  throw new Error(`OpenAI: ${ultimoErro}`);
}

const custo = (modelo: string, ent: number, sai: number): number | null => {
  const p = PRECOS_OPENAI[modelo];
  return p ? (ent * p[0] + sai * p[1]) / 1e6 : null;
};

// ---------------------------------------------------------------------------
// Conferência de uma receita da IA
// ---------------------------------------------------------------------------

/** Bloqueios que não reprovam a RECEITA (o arquivo é que não traz o dado). */
const BLOQUEIOS_DO_ARQUIVO = new Set(["sem_precisao", "sem_altura", "nome_repetido", "V3_sigma_unidade"]);

/** Como a receita leu as primeiras linhas de ponto — devolvido à IA quando ela erra. */
function amostraLida(l: Leitura): string {
  const fmt = (v: number | null) => (v === null || !Number.isFinite(v) ? "∅" : String(v));
  const pts = l.pontos.slice(0, 3).map((p) =>
    `linha ${p.linha}: nome="${p.nome}"${p.rotulo ? ` código="${p.rotulo}"` : ""} E=${fmt(p.e)} N=${fmt(p.n)} h=${fmt(p.h)} σpos=${fmt(p.sigmaPos)} σh=${fmt(p.sigmaH)}`);
  const ileg = l.ignoradas.filter((i) => i.tipo === "ilegivel").slice(0, 3).map((i) => `linha ${i.linha} não lida: ${i.motivo}`);
  return [...pts, ...ileg].map((x) => `  - ${x}`).join("\n");
}

/** Colunas numéricas das linhas de ponto que a receita deixou sem papel. */
function colunasSoltas(linhas: string[], l: Leitura): { coluna: number; exemplos: string[] }[] {
  const r = l.receita;
  if (r.registro !== "linha" || (r.tokenizacao !== "delimitado" && r.tokenizacao !== "espacos")) return [];
  const usadas = new Set(Object.values(r.campos).filter((j): j is number => j !== null));
  const cels = l.pontos.slice(0, 200).map((p) => (r.tokenizacao === "espacos" ? dividirEspacos(linhas[p.linha - 1]) : dividirDelimitado(linhas[p.linha - 1], r.delimitador!)));
  const k = Math.max(0, ...cels.map((c) => c.length));
  const out: { coluna: number; exemplos: string[] }[] = [];
  for (let j = 0; j < k; j++) {
    if (usadas.has(j)) continue;
    const vals = cels.map((c) => (c[j] ?? "").trim()).filter(Boolean);
    const num = vals.filter((v) => lerNumero(v, r.decimal) !== null);
    if (vals.length >= cels.length * 0.8 && num.length >= vals.length * 0.8) out.push({ coluna: j, exemplos: num.slice(0, 3) });
  }
  return out;
}

function conferir(l: Leitura, linhas: string[]): string | null {
  const problemas: string[] = [];
  if (l.pontos.length < 3) problemas.push(`só ${l.pontos.length} ponto(s) lido(s)`);
  // falta σ/altura com coluna numérica sobrando: o papel está no lugar errado, não falta no arquivo
  if (l.avisos.some((a) => a.codigo === "sem_precisao" || a.codigo === "sem_altura")) {
    const soltas = colunasSoltas(linhas, l);
    if (soltas.length) {
      problemas.push(`Os pontos ficaram sem ${l.avisos.some((a) => a.codigo === "sem_altura") ? "altitude/" : ""}precisão, mas o arquivo tem coluna(s) numérica(s) sem papel: ${soltas.map((s) => `coluna ${s.coluna} (ex.: ${s.exemplos.join(", ")})`).join("; ")}. Confira campos.h, sigma_pos e sigma_h.`);
    }
  }
  for (const a of l.avisos) {
    if (a.nivel === "bloqueio" && !BLOQUEIOS_DO_ARQUIVO.has(a.codigo)) problemas.push(`${a.mensagem}${a.linhas ? ` (linhas ${a.linhas.slice(0, 8).join(", ")})` : ""}`);
    // nome repetido em boa parte dos pontos é coluna de nome errada, não arquivo ruim
    if (a.codigo === "nome_repetido" && (a.linhas?.length ?? 0) > Math.max(2, l.pontos.length * 0.2)) problemas.push(`Quase todos os pontos saíram com o mesmo nome: a coluna escolhida para "nome" não identifica o ponto.`);
    if (a.codigo === "linhas_ilegiveis") problemas.push(`${a.mensagem} (linhas ${a.linhas?.slice(0, 8).join(", ")}): ${l.ignoradas.filter((i) => a.linhas?.includes(i.linha)).slice(0, 3).map((i) => `${i.linha}: ${i.motivo}`).join("; ")}`);
  }
  // o número do ponto foi parar no "código": os pontos perderiam a numeração real
  const r = l.receita;
  if (r.campos.nome === null && l.pontos.length >= 3) {
    const cods = l.pontos.map((p) => (p.rotulo ?? "").trim()).filter(Boolean);
    const unicos = new Set(cods).size;
    if (cods.length >= l.pontos.length * 0.9 && unicos >= cods.length * 0.9 && cods.filter((c) => /^[A-Za-z]{0,4}[-_ ]?\d+[A-Za-z]?$/.test(c)).length >= cods.length * 0.8) {
      problemas.push(`A coluna usada como "codigo" tem um valor diferente em cada linha (ex.: ${cods.slice(0, 3).join(", ")}): ela é o identificador do ponto e deve ir em campos.nome, não em campos.codigo.`);
    }
  }
  if (!problemas.length) return null;
  return `${problemas.join("\n")}\nComo a sua receita leu as primeiras linhas:\n${amostraLida(l)}`;
}

/** A IA às vezes escreve regex no estilo de outras linguagens: "(?i)base", "/base/i". */
function normalizarPadrao(p: unknown): unknown {
  if (typeof p !== "string") return p;
  let s = p.trim().replace(/^\(\?[imsux]+\)/, "");
  const lit = s.match(/^\/(.*)\/[a-z]*$/s);
  if (lit) s = lit[1];
  return s;
}
function normalizarBruta(b: Record<string, unknown>): Record<string, unknown> {
  const lista = (v: unknown) => (Array.isArray(v) ? v.map(normalizarPadrao) : v);
  return { ...b, ignorar: lista(b.ignorar), apoio: lista(b.apoio), regex: normalizarPadrao(b.regex) };
}

export interface ResultadoIA {
  leitura: Leitura | null;
  tentativas: TentativaIA[];
  erro: string | null;
}

/**
 * Cascata: modelo rápido → rápido com o motivo da reprovação → modelo forte.
 * Devolve a melhor leitura APROVADA (ou a melhor reprovada, para o
 * mapeamento assistido), com o registro de cada tentativa.
 */
export async function interpretarComIA(
  linhas: string[], nomeArquivo: string, proj4: Proj4, cfg: ConfigIA,
  pista: { receita: Receita; duvidas: string[] } | null,
): Promise<ResultadoIA> {
  const rapido = cfg.modeloRapido || MODELO_RAPIDO_PADRAO, forte = cfg.modeloForte || MODELO_FORTE_PADRAO;
  const plano = [rapido, rapido, forte];
  const tentativas: TentativaIA[] = [];
  let erroAnterior: string | null = null;
  let melhor: Leitura | null = null;
  let erro: string | null = null;
  for (let k = 0; k < plano.length; k++) {
    const modelo = plano[k];
    const t0 = Date.now();
    let r: RespostaIA;
    try {
      r = await chamar(cfg, modelo, montarPedido(linhas, nomeArquivo, pista, erroAnterior));
    } catch (e) {
      erro = e instanceof Error ? e.message : String(e);
      tentativas.push({ modelo, tentativa: k + 1, tokensEntrada: 0, tokensSaida: 0, custoUsd: null, aprovada: false, motivo: erro, ms: Date.now() - t0 });
      if (/OpenAI (401|403|429)/.test(erro)) break; // chave inválida / sem crédito / limite: não adianta insistir
      continue;
    }
    const base = { modelo, tentativa: k + 1, tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida, custoUsd: custo(modelo, r.tokensEntrada, r.tokensSaida), ms: Date.now() - t0 };
    const bruta = normalizarBruta(r.receitaBruta as Record<string, unknown>);
    const { receita, erros } = validarReceita({ ...bruta, versao: 1, origem: `ia:${modelo}` });
    if (!receita) {
      erroAnterior = `A receita não é válida: ${erros.join("; ")}`;
      tentativas.push({ ...base, aprovada: false, motivo: erroAnterior });
      continue;
    }
    const confIA = typeof bruta.confianca === "number" ? bruta.confianca : 0.5;
    let leitura: Leitura;
    try {
      leitura = executarReceita(linhas, receita, { proj4 }, confIA >= 0.8 ? "alta" : "media", [`receita escrita pela IA (${modelo})`]);
    } catch (e) {
      erroAnterior = `A receita falhou ao ser aplicada: ${e instanceof Error ? e.message : String(e)}`;
      tentativas.push({ ...base, aprovada: false, motivo: erroAnterior });
      continue;
    }
    const problema = conferir(leitura, linhas);
    tentativas.push({ ...base, aprovada: !problema, motivo: problema ?? "aprovada" });
    if (!melhor || notaDaLeitura(leitura) > notaDaLeitura(melhor)) melhor = leitura;
    if (!problema) return { leitura, tentativas, erro: null };
    erroAnterior = problema;
  }
  return { leitura: melhor, tentativas, erro };
}
