// Períodos e parcelas do autocadastro (migração 0040): quanto custa cada
// período (mensal, semestral, anual) e em quantas vezes dá para pagar no cartão.
//
// Puro (sem Deno nem DOM): a função `cobranca` calcula com ele o valor que vai
// ao Asaas — sem confiar no que o navegador mandou — e a tela mostra a mesma
// conta ("7x de R$ 48,12 · total R$ 336,84") antes do botão Pagar.
//
// O Asaas não repassa juros de parcelamento ao cliente (a central de ajuda diz
// "Não"; pesquisa de 05/11/2026): quem calcula somos nós.
//   - Valor do período = mensalidade × meses × (1 − desconto do período). O
//     mensal não tem desconto (para isso muda-se o preço do plano).
//   - Até `parcelas_sem_juros` (padrão 6): o total é o valor do período. Vai ao
//     Asaas como `totalValue` e ele divide. ARREDONDAMENTO: a parcela é total ÷ n
//     em centavos e a diferença vai na ÚLTIMA (é o que o Asaas faz com o
//     totalValue), então a soma das parcelas fecha o total.
//   - Acima disso, até `parcelas_max` (padrão 12): Tabela Price com `juros_mes`
//     (padrão 2,99% a.m.), PMT = PV·i / (1 − (1+i)^−n), arredondada em centavos.
//     Vai como `installmentValue` e todas as parcelas são iguais: total = n × parcela.
//   - O número de parcelas nunca passa dos meses do período: mensal só à vista
//     (Pix ou cartão 1x), semestral até 6x, anual até 12x. Parcelar UMA
//     mensalidade empilharia parcelas mês a mês (a assinatura não parcela).
//
// As regras moram em cobranca_config (chaves cadastro_aberto, parcelas_sem_juros,
// parcelas_max, juros_mes, ciclos) e o superadmin muda em Configurações →
// Autocadastro. tests/parcelas.test.mjs confere as contas.

import { fmtReais } from "./precos.ts";

export type Ciclo = "MONTHLY" | "SEMIANNUALLY" | "YEARLY";
export const CICLOS: Ciclo[] = ["MONTHLY", "SEMIANNUALLY", "YEARLY"];
export const MESES: Record<Ciclo, number> = { MONTHLY: 1, SEMIANNUALLY: 6, YEARLY: 12 };
export const NOME_CICLO: Record<Ciclo, string> = { MONTHLY: "Mensal", SEMIANNUALLY: "Semestral", YEARLY: "Anual" };
/** O nome que vai na URL do link de cadastro (?ciclo=anual). */
export const APELIDO_CICLO: Record<Ciclo, string> = { MONTHLY: "mensal", SEMIANNUALLY: "semestral", YEARLY: "anual" };

const APELIDOS: Record<string, Ciclo> = {
  mensal: "MONTHLY", monthly: "MONTHLY", semestral: "SEMIANNUALLY", semiannually: "SEMIANNUALLY", anual: "YEARLY", yearly: "YEARLY",
};

/** "anual", "YEARLY"… → o ciclo do Asaas; o resto → null. */
export function cicloDe(x: unknown): Ciclo | null {
  return APELIDOS[String(x ?? "").trim().toLowerCase()] ?? null;
}

export interface RegraCiclo { ativo: boolean; desconto: number }
export interface RegrasPagamento {
  /** o link de cadastro aceita conta nova (ainda depende do Asaas ligado) */
  cadastro_aberto: boolean;
  parcelas_sem_juros: number;
  parcelas_max: number;
  /** % ao mês, acima das parcelas sem juros */
  juros_mes: number;
  /** desconto em % (0 a 50); o mensal é sempre 0 */
  ciclos: Record<Ciclo, RegraCiclo>;
  /**
   * Taxa de adesão (0044): cobrada UMA vez, somada ao 1º pagamento do
   * autocadastro (Pix, cartão à vista ou parcelado junto com o período). 0 = sem
   * adesão. As renovações cobram só o plano.
   */
  adesao: number;
  /** a explicação que a pessoa lê no cadastro e na tela de pagamento */
  adesao_texto: string;
}

export const LIMITE_PARCELAS = 12;
export const LIMITE_JUROS = 10;
export const LIMITE_DESCONTO = 50;
export const LIMITE_ADESAO = 20000;
export const LIMITE_TEXTO_ADESAO = 500;
export const ADESAO_PADRAO = 500;
export const TEXTO_ADESAO_PADRAO =
  "Pagamento único, cobrado só uma vez junto com o primeiro pagamento do plano. Ele cobre a implantação da sua empresa no Vertces e a liberação do acesso. Nas renovações você paga só o plano.";

export const REGRAS_PADRAO: RegrasPagamento = {
  cadastro_aberto: false, parcelas_sem_juros: 6, parcelas_max: 12, juros_mes: 2.99,
  ciclos: { MONTHLY: { ativo: true, desconto: 0 }, SEMIANNUALLY: { ativo: true, desconto: 0 }, YEARLY: { ativo: true, desconto: 0 } },
  adesao: ADESAO_PADRAO, adesao_texto: TEXTO_ADESAO_PADRAO,
};

const textoAdesao = (v: unknown): string => {
  const t = String(v ?? "").trim().replace(/\s+/g, " ").slice(0, LIMITE_TEXTO_ADESAO);
  return t || TEXTO_ADESAO_PADRAO;
};

const cent = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;
const entre = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));
/** número de texto ("2,99"), número ou vazio (= padrão) */
function numero(v: unknown, padrao: number): number {
  if (v === undefined || v === null || v === "") return padrao;
  const n = typeof v === "number" ? v : Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : padrao;
}
const sim = (v: unknown) => v === true || v === "true";

/** As regras com os padrões e dentro dos limites (o que vier do banco, da tela ou do JSON). */
export function normalizarRegras(r: unknown): RegrasPagamento {
  const x = (r ?? {}) as Record<string, unknown>;
  const max = entre(Math.floor(numero(x.parcelas_max, REGRAS_PADRAO.parcelas_max)), 1, LIMITE_PARCELAS);
  const semJuros = entre(Math.floor(numero(x.parcelas_sem_juros, REGRAS_PADRAO.parcelas_sem_juros)), 1, max);
  const juros = Math.round(entre(numero(x.juros_mes, REGRAS_PADRAO.juros_mes), 0, LIMITE_JUROS) * 10000) / 10000;
  const brutos = (x.ciclos && typeof x.ciclos === "object" ? x.ciclos : {}) as Record<string, { ativo?: unknown; desconto?: unknown } | undefined>;
  const ciclos = {} as Record<Ciclo, RegraCiclo>;
  for (const c of CICLOS) {
    const b = brutos[c];
    ciclos[c] = {
      ativo: b?.ativo === undefined ? true : sim(b.ativo),
      desconto: c === "MONTHLY" ? 0 : Math.round(entre(numero(b?.desconto, 0), 0, LIMITE_DESCONTO) * 100) / 100,
    };
  }
  const adesao = cent(entre(numero(x.adesao, REGRAS_PADRAO.adesao), 0, LIMITE_ADESAO));
  return {
    cadastro_aberto: sim(x.cadastro_aberto), parcelas_sem_juros: semJuros, parcelas_max: max, juros_mes: juros, ciclos,
    adesao, adesao_texto: textoAdesao(x.adesao_texto),
  };
}

/** As regras gravadas em cobranca_config (texto chave → valor). */
export function regrasDe(cfg: Record<string, string | undefined>): RegrasPagamento {
  let ciclos: unknown = null;
  try { ciclos = cfg.ciclos ? JSON.parse(cfg.ciclos) : null; } catch { ciclos = null; }
  return normalizarRegras({
    cadastro_aberto: cfg.cadastro_aberto, parcelas_sem_juros: cfg.parcelas_sem_juros,
    parcelas_max: cfg.parcelas_max, juros_mes: cfg.juros_mes, ciclos,
    adesao: cfg.adesao_valor, adesao_texto: cfg.adesao_texto,
  });
}

/** O inverso de regrasDe: as chaves para gravar em cobranca_config. */
export function configDasRegras(r: RegrasPagamento): Record<string, string> {
  return {
    cadastro_aberto: r.cadastro_aberto ? "true" : "false",
    parcelas_sem_juros: String(r.parcelas_sem_juros),
    parcelas_max: String(r.parcelas_max),
    juros_mes: String(r.juros_mes),
    ciclos: JSON.stringify(r.ciclos),
    adesao_valor: String(r.adesao),
    adesao_texto: r.adesao_texto,
  };
}

/** O que impede de gravar o que o superadmin digitou (null = ok). Números fora do limite não são corrigidos em silêncio. */
export function problemaDasRegras(r: unknown): string | null {
  const x = (r ?? {}) as Record<string, unknown>;
  const inteiro = (v: unknown) => Number.isInteger(numero(v, NaN));
  if (!inteiro(x.parcelas_max) || numero(x.parcelas_max, 0) < 1 || numero(x.parcelas_max, 0) > LIMITE_PARCELAS) {
    return `O máximo de parcelas vai de 1 a ${LIMITE_PARCELAS}.`;
  }
  if (!inteiro(x.parcelas_sem_juros) || numero(x.parcelas_sem_juros, 0) < 1 || numero(x.parcelas_sem_juros, 0) > numero(x.parcelas_max, 0)) {
    return "As parcelas sem juros vão de 1 até o máximo de parcelas.";
  }
  const juros = numero(x.juros_mes, NaN);
  if (!Number.isFinite(juros) || juros < 0 || juros > LIMITE_JUROS) return `Os juros ao mês vão de 0 a ${LIMITE_JUROS}%.`;
  const ciclos = (x.ciclos && typeof x.ciclos === "object" ? x.ciclos : {}) as Record<string, { ativo?: unknown; desconto?: unknown } | undefined>;
  for (const c of CICLOS) {
    const d = numero(ciclos[c]?.desconto, 0);
    if (!Number.isFinite(d) || d < 0 || d > LIMITE_DESCONTO) return `O desconto do ${NOME_CICLO[c].toLowerCase()} vai de 0 a ${LIMITE_DESCONTO}%.`;
  }
  if (x.adesao !== undefined) {
    const a = numero(x.adesao, NaN);
    if (!Number.isFinite(a) || a < 0 || a > LIMITE_ADESAO) return `A adesão vai de R$ 0 a ${fmtReais(LIMITE_ADESAO)} (0 = sem adesão).`;
    if (Math.round(a * 100) / 100 !== a) return "A adesão aceita no máximo dois decimais (centavos).";
  }
  if (x.adesao_texto !== undefined && String(x.adesao_texto ?? "").trim().length > LIMITE_TEXTO_ADESAO) {
    return `A explicação da adesão tem no máximo ${LIMITE_TEXTO_ADESAO} caracteres.`;
  }
  if (sim(x.cadastro_aberto) && !CICLOS.some((c) => ciclos[c]?.ativo === undefined || sim(ciclos[c]?.ativo))) {
    return "Deixe ao menos um período à venda para abrir o cadastro.";
  }
  return null;
}

export const ciclosAtivos = (r: RegrasPagamento): Ciclo[] => CICLOS.filter((c) => r.ciclos[c].ativo);

/** Mensalidade × meses × (1 − desconto%), em centavos. */
export function valorDoPeriodo(mensalidade: number, ciclo: Ciclo, desconto = 0): number {
  return cent(mensalidade * MESES[ciclo] * (1 - desconto / 100));
}

/** O 1º pagamento do autocadastro: o período + a adesão (cobrada uma vez só). */
export function totalComAdesao(valorPeriodo: number, adesao: number): number {
  return cent(valorPeriodo + Math.max(0, adesao || 0));
}

/** Quanto o período sai mais barato que pagar mês a mês (0 = sem desconto). */
export function economia(mensalidade: number, ciclo: Ciclo, desconto = 0): number {
  return cent(mensalidade * MESES[ciclo] - valorDoPeriodo(mensalidade, ciclo, desconto));
}

/** Em até quantas vezes o período pode ser pago no cartão. */
export function maxParcelas(r: Pick<RegrasPagamento, "parcelas_max">, ciclo: Ciclo): number {
  return Math.max(1, Math.min(r.parcelas_max, MESES[ciclo]));
}

export interface Parcelamento {
  n: number;
  /** cada parcela (sem juros, a última pode levar a diferença do arredondamento) */
  parcela: number;
  ultima: number;
  total: number;
  juros: boolean;
  /** o campo do Asaas que leva o valor */
  campo: "value" | "totalValue" | "installmentValue";
}

/** `total` em `n` vezes pelas regras (sem juros até o limite; Price acima). */
export function parcelamento(total: number, n: number, r: Pick<RegrasPagamento, "parcelas_sem_juros" | "juros_mes">): Parcelamento {
  const t = cent(total);
  if (n <= 1) return { n: 1, parcela: t, ultima: t, total: t, juros: false, campo: "value" };
  if (n <= r.parcelas_sem_juros || !(r.juros_mes > 0)) {
    const parcela = cent(t / n);
    return { n, parcela, ultima: cent(t - parcela * (n - 1)), total: t, juros: false, campo: "totalValue" };
  }
  const i = r.juros_mes / 100;
  const parcela = cent((t * i) / (1 - Math.pow(1 + i, -n)));
  return { n, parcela, ultima: parcela, total: cent(parcela * n), juros: true, campo: "installmentValue" };
}

/** As opções do seletor: 1x até o máximo do período. */
export function opcoesDeParcelas(total: number, ciclo: Ciclo, r: RegrasPagamento): Parcelamento[] {
  return Array.from({ length: maxParcelas(r, ciclo) }, (_, k) => parcelamento(total, k + 1, r));
}

/** A escolha do navegador conferida (null = número de parcelas fora do que o período aceita). */
export function escolherParcelas(total: number, ciclo: Ciclo, n: unknown, r: RegrasPagamento): Parcelamento | null {
  const k = Number(n);
  if (!Number.isInteger(k) || k < 1 || k > maxParcelas(r, ciclo)) return null;
  return parcelamento(total, k, r);
}

/** "à vista: R$ 299,90" · "6x de R$ 49,98 sem juros" · "7x de R$ 48,12 · total R$ 336,84" */
export function textoParcelas(p: Parcelamento): string {
  if (p.n === 1) return `à vista: ${fmtReais(p.total)}`;
  if (!p.juros) return `${p.n}x de ${fmtReais(p.parcela)} sem juros`;
  return `${p.n}x de ${fmtReais(p.parcela)} · total ${fmtReais(p.total)}`;
}

/** A descrição da cobrança no Asaas (o cliente vê na fatura): o total e os juros antes de pagar. */
export function descricaoDaCompra(plano: string | null, ciclo: Ciclo, p: Parcelamento, r: Pick<RegrasPagamento, "juros_mes">, adesao = 0): string {
  const base = `Vertces: plano ${plano ?? "contratado"} (${NOME_CICLO[ciclo].toLowerCase()})`
    + (adesao > 0 ? ` + adesão de ${fmtReais(adesao)} (uma vez só)` : "");
  if (p.n === 1) return base;
  if (!p.juros) return `${base}, ${p.n}x de ${fmtReais(p.parcela)} sem juros (total ${fmtReais(p.total)})`;
  return `${base}, ${p.n}x de ${fmtReais(p.parcela)} (total ${fmtReais(p.total)}; juros de ${String(r.juros_mes).replace(".", ",")}% a.m.)`;
}

/** O mesmo dia `meses` meses depois (31 → último dia do mês). "aaaa-mm-dd". */
export function somarMeses(iso: string, meses: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m - 1 + meses + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m - 1 + meses, Math.min(d, ultimo))).toISOString().slice(0, 10);
}
