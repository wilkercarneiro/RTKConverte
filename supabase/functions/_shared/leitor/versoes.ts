// Versões dos mesmos pontos no mesmo arquivo.
//
// Coletoras e programas de pós-processamento exportam, no mesmo arquivo, o
// levantamento de campo e uma segunda solução dos MESMOS marcos com um prefixo
// no nome: `3jorge/davino` e `postp_3jorge/davino` são o ponto 3 duas vezes.
// As duas soluções podem estar a centímetros ou a centenas de metros uma da
// outra (base sem correção, PPK que não fixou). Misturar as duas no perímetro
// produz um desenho que se cruza e que não dá para consertar depois.
//
// Regra (documentada em docs/leitura-universal.md, "Regra do arquivo"):
//   1. o ponto do perímetro é a linha cujo nome começa pelo número do ponto;
//   2. um nome = PREFIXO + nome de um ponto numerado do arquivo é OUTRA VERSÃO
//      desse ponto (o prefixo vale como versão quando repete ao menos 2 pontos
//      numerados e a maioria dos pontos com aquele prefixo);
//   3. entra no perímetro UMA versão inteira, nunca pedaços de duas;
//   4. a escolha automática é a versão mais completa (tem mais pontos do
//      perímetro); empate → a de menor σ mediano; empate → o levantamento
//      (sem prefixo). O operador pode escolher a outra na prévia.
import type { Aviso, PontoLido } from "./executor.ts";

/** Chave da versão sem prefixo (os pontos com o número no começo do nome). */
export const VERSAO_LEVANTAMENTO = "";
/** Escolha do operador: não separar — todos os pontos entram, como antes da regra. */
export const VERSAO_TODAS = "*";

export interface Versao {
  /** "" = levantamento (sem prefixo); senão o prefixo como veio ("postp_"). */
  chave: string;
  /** Nome para a tela: "levantamento" ou "postp_". */
  nome: string;
  /** Linhas do arquivo dos pontos desta versão. */
  linhas: number[];
  /** Números do perímetro que esta versão tem. */
  numeros: number[];
  /** Números que outra versão tem e esta não. */
  faltam: number[];
  /** σ horizontal mediano (null se a versão não traz σ). */
  sigmaMediano: number | null;
}

export interface ResultadoVersoes {
  /** Vazio quando o arquivo tem uma versão só (o caso de sempre). */
  versoes: Versao[];
  /** Chave da versão usada no perímetro (null quando há uma só). */
  escolhida: string | null;
  /** A escolha foi automática (true) ou pedida na prévia (false). */
  automatica: boolean;
  /** Distância mediana entre as duas versões do mesmo ponto (m). */
  distanciaMediana: number | null;
  avisos: Aviso[];
}

const RE_PREFIXO = /^(\D*[A-Za-zÀ-ÿ]\D*?)(\d+)(.*)$/s;

function mediana(v: number[]): number | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function listaNums(nums: number[]): string {
  if (nums.length <= 1) return nums.join("");
  return `${nums.slice(0, -1).join(", ")} e ${nums[nums.length - 1]}`;
}

function fmtDist(m: number): string {
  if (m < 1) return `${Math.round(m * 100)} cm`;
  return `${m < 10 ? m.toFixed(1).replace(".", ",") : Math.round(m)} m`;
}

/**
 * Separa as versões e marca `foraDaVersao` nos pontos da versão que NÃO entra.
 * Na versão escolhida com prefixo, o ponto passa a ter o número e o rótulo do
 * nome sem o prefixo (`postp_3jorge/davino` → 3, "jorge/davino"); o nome
 * original continua em `nome` (procedência).
 */
export function separarVersoes(pontos: PontoLido[], pedida: string | null | undefined, nomeComRotulo: boolean): ResultadoVersoes {
  const nada: ResultadoVersoes = { versoes: [], escolhida: null, automatica: true, distanciaMediana: null, avisos: [] };
  for (const p of pontos) p.foraDaVersao = false;
  const ativos = pontos.filter((p) => !p.apoio && Number.isFinite(p.e) && Number.isFinite(p.n));
  // número do levantamento: o do nome ("3jorge/davino" → 3), mesmo quando o
  // nome foi lido inteiro (receita "texto")
  const numDe = (p: PontoLido): number | null => p.num ?? (/^\d+/.test(p.nome.trim()) ? parseInt(p.nome.trim(), 10) : null);
  const numerados = ativos.filter((p) => numDe(p) !== null);
  if (numerados.length < 3) return nada;
  const porNum = new Map<number, PontoLido>();
  for (const p of numerados) if (!porNum.has(numDe(p)!)) porNum.set(numDe(p)!, p);

  // ---- candidatos: nome não numérico = prefixo + número (+ rótulo) ----
  type Cand = { p: PontoLido; num: number; rotulo: string | null };
  const grupos = new Map<string, { prefixo: string; itens: Cand[] }>();
  for (const p of ativos) {
    if (numDe(p) !== null) continue;
    const m = p.nome.trim().match(RE_PREFIXO);
    if (!m) continue;
    const chave = m[1].toLowerCase();
    const g = grupos.get(chave) ?? { prefixo: m[1], itens: [] };
    g.itens.push({ p, num: parseInt(m[2], 10), rotulo: m[3].trim() || null });
    grupos.set(chave, g);
  }
  const versoesComPrefixo = [...grupos.values()].filter((g) => {
    const repetem = g.itens.filter((c) => porNum.has(c.num)).length;
    return g.itens.length >= 2 && repetem >= 2 && repetem * 2 >= g.itens.length;
  });
  if (!versoesComPrefixo.length) return nada;

  // ---- as versões: o levantamento (tudo que não é de um prefixo) + cada prefixo ----
  const doPrefixo = new Set(versoesComPrefixo.flatMap((g) => g.itens.map((c) => c.p.idx)));
  const levantamento = ativos.filter((p) => !doPrefixo.has(p.idx));
  const todosNums = new Set<number>([...porNum.keys(), ...versoesComPrefixo.flatMap((g) => g.itens.map((c) => c.num))]);
  const sigmaMed = (ps: PontoLido[]) => mediana(ps.map((p) => p.sigmaPos).filter((s): s is number => s !== null));
  const montar = (chave: string, nome: string, ps: PontoLido[], nums: number[]): Versao => {
    const tem = new Set(nums);
    return {
      chave, nome, linhas: ps.map((p) => p.linha),
      numeros: [...tem].sort((a, b) => a - b),
      faltam: [...todosNums].filter((n) => !tem.has(n)).sort((a, b) => a - b),
      sigmaMediano: sigmaMed(ps),
    };
  };
  const versoes: Versao[] = [
    montar(VERSAO_LEVANTAMENTO, "levantamento", levantamento, levantamento.filter((p) => numDe(p) !== null).map((p) => numDe(p)!)),
    ...versoesComPrefixo.map((g) => montar(g.prefixo, g.prefixo, g.itens.map((c) => c.p), g.itens.map((c) => c.num))),
  ];

  // ---- distância entre as versões do mesmo ponto ----
  const dists: number[] = [];
  for (const g of versoesComPrefixo) {
    for (const c of g.itens) {
      const q = porNum.get(c.num);
      if (q) dists.push(Math.hypot(c.p.e - q.e, c.p.n - q.n));
    }
  }
  const distanciaMediana = mediana(dists);

  // ---- "não separar": o operador quer todos os pontos (como era antes da regra) ----
  if (pedida === VERSAO_TODAS) {
    return {
      versoes, escolhida: VERSAO_TODAS, automatica: false, distanciaMediana,
      avisos: [{
        codigo: "versoes", nivel: "alerta",
        mensagem: `O arquivo traz ${versoes.length} versões dos mesmos pontos, e você pediu para usar todos os pontos juntos (não separar). Confira o desenho: as versões repetem os mesmos marcos.`,
      }],
    };
  }

  // ---- escolha ----
  const pedidaOk = pedida !== null && pedida !== undefined && versoes.some((v) => v.chave === pedida);
  const automatica = !pedidaOk;
  const escolhida = pedidaOk
    ? versoes.find((v) => v.chave === pedida)!
    : versoes.reduce((a, b) => {
      if (b.numeros.length !== a.numeros.length) return b.numeros.length > a.numeros.length ? b : a;
      const sa = a.sigmaMediano ?? Infinity, sb = b.sigmaMediano ?? Infinity;
      return sb < sa ? b : a;
    });

  // ---- aplica: fora quem não é da escolhida; a escolhida com prefixo ganha número/rótulo ----
  const linhasEscolhidas = new Set(escolhida.linhas);
  for (const p of ativos) if (!linhasEscolhidas.has(p.linha)) p.foraDaVersao = true;
  const grupoEscolhido = versoesComPrefixo.find((g) => g.prefixo === escolhida.chave);
  if (grupoEscolhido) {
    for (const c of grupoEscolhido.itens) {
      c.p.num = c.num;
      if (nomeComRotulo) c.p.rotulo = [c.rotulo, c.p.rotulo].filter((x) => x && x.trim()).join(" ").trim() || null;
    }
  }

  const descr =(v: Versao) => `${v.chave === VERSAO_LEVANTAMENTO ? "o levantamento" : `“${v.nome}”`} (${v.numeros.length} ponto${v.numeros.length === 1 ? "" : "s"}${v.faltam.length ? `, sem ${v.faltam.length > 1 ? "os pontos" : "o ponto"} ${listaNums(v.faltam.slice(0, 12))}${v.faltam.length > 12 ? "…" : ""}` : ""})`;
  const qual = escolhida.chave === VERSAO_LEVANTAMENTO ? "a do levantamento" : `a “${escolhida.nome}”`;
  const porque = automatica
    ? (versoes.filter((v) => v !== escolhida).every((v) => v.numeros.length < escolhida.numeros.length)
      ? "que é a mais completa"
      : "que tem a melhor precisão")
    : "escolhida na prévia";
  const outras = versoes.length > 2 ? "as outras ficaram" : "a outra ficou";
  const avisos: Aviso[] = [{
    codigo: "versoes", nivel: "alerta",
    mensagem: `O arquivo traz ${versoes.length} versões dos mesmos pontos: ${versoes.map(descr).join(" e ")}${distanciaMediana !== null ? `, a cerca de ${fmtDist(distanciaMediana)} uma da outra` : ""}. Só uma entra no perímetro: ${qual}, ${porque}; ${outras} de fora, em cinza no desenho. Para trocar, use “Versão dos pontos”.`,
    linhas: versoes.filter((v) => v !== escolhida).flatMap((v) => v.linhas),
  }];
  if (escolhida.faltam.length) {
    avisos.push({
      codigo: "versao_incompleta", nivel: "alerta",
      mensagem: `A versão usada não tem o${escolhida.faltam.length > 1 ? "s" : ""} ponto${escolhida.faltam.length > 1 ? "s" : ""} ${listaNums(escolhida.faltam)}: o perímetro fica sem ${escolhida.faltam.length > 1 ? "eles" : "ele"}.`,
    });
  }
  return { versoes, escolhida: escolhida.chave, automatica, distanciaMediana, avisos };
}
