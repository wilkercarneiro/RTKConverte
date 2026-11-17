// Cupons de desconto do cadastro (migração 0052): a conta do cupom, sem Deno
// nem DOM. A função `cobranca` calcula com ele o que vai ao Asaas (sem confiar
// no navegador) e a página de cadastro mostra a mesma conta antes do botão.
//
// Um cupom mexe na ADESÃO, na MENSALIDADE ou nas duas:
//   adesão      — percentual (1–100%), valor (R$ a menos) ou isenção (adesão zerada);
//   mensalidade — percentual (1–99%) ou valor (R$ a menos em cada cobrança), nas N
//                 primeiras cobranças (null = em todas); ou isenção de N meses
//                 (1–24): a 1ª cobrança só vence N meses depois do cadastro.
//
// Como o desconto da mensalidade chega ao Asaas: a assinatura nasce com o valor
// com desconto e, quando o Asaas gera a 1ª cobrança depois do fim do desconto
// (`desconto_ate` = início + N períodos), a função troca o valor dela e o da
// assinatura para o cheio (fluxos.ts → ajustarCupom). A isenção não mexe no
// valor: só empurra o 1º vencimento.
//
// O Asaas não emite cobrança abaixo de R$ 5,00: o desconto na mensalidade para
// em R$ 5,00. Uma adesão que, com o cupom, fica abaixo disso e seria cobrada
// sozinha (isenção da mensalidade) vira isenta. tests/cupons.test.mjs confere.

import { fmtReais } from "./precos.ts";
import { MESES, somarMeses } from "./parcelas.ts";
import type { Ciclo } from "./parcelas.ts";

export type TipoDesconto = "percentual" | "valor" | "isencao";
export const TIPOS: TipoDesconto[] = ["percentual", "valor", "isencao"];

/** O cupom como fica gravado na empresa (cobranca_empresas.cupom): uma foto do dia do cadastro. */
export interface Cupom {
  codigo: string;
  adesao_tipo: TipoDesconto | null;
  adesao_valor: number | null;
  mensalidade_tipo: TipoDesconto | null;
  mensalidade_valor: number | null;
  /** percentual/valor: em quantas cobranças (null = em todas) */
  mensalidade_vezes: number | null;
  /** isenção: quantos meses sem cobrança */
  isencao_meses: number | null;
}

/** O menor valor de cobrança que o Asaas aceita. */
export const MINIMO_ASAAS = 5;
export const LIMITE_VEZES = 60;
export const LIMITE_MESES_GRATIS = 24;
export const LIMITE_VALOR = 20000;

const cent = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;
const tipo = (x: unknown): TipoDesconto | null => (TIPOS.includes(x as TipoDesconto) ? (x as TipoDesconto) : null);
const num = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(String(x).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const inteiro = (x: unknown): number | null => {
  const n = num(x);
  return n === null ? null : Math.floor(n);
};

/** "bem vindo 20" → "BEMVINDO20": só letras, números, - e _ (sem acento, maiúsculas). */
export function normalizarCodigo(s: unknown): string {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 30);
}
export const codigoValido = (s: string): boolean => /^[A-Z0-9_-]{3,30}$/.test(s);

/** O cupom vindo do banco (jsonb) ou da função, conferido; null = sem cupom. */
export function cupomDe(x: unknown): Cupom | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const c: Cupom = {
    codigo: normalizarCodigo(o.codigo),
    adesao_tipo: tipo(o.adesao_tipo),
    adesao_valor: num(o.adesao_valor),
    mensalidade_tipo: tipo(o.mensalidade_tipo),
    mensalidade_valor: num(o.mensalidade_valor),
    mensalidade_vezes: inteiro(o.mensalidade_vezes),
    isencao_meses: inteiro(o.isencao_meses),
  };
  if (!c.adesao_tipo && !c.mensalidade_tipo) return null;
  return c;
}

/** A adesão com o cupom (sem o mínimo do Asaas: ela vai somada ao período). */
export function adesaoComCupom(adesao: number, c: Cupom | null): number {
  const a = cent(Math.max(0, adesao || 0));
  if (!c?.adesao_tipo || !(a > 0)) return a;
  const v = Math.max(0, c.adesao_valor ?? 0);
  if (c.adesao_tipo === "isencao") return 0;
  if (c.adesao_tipo === "percentual") return v >= 100 ? 0 : cent(a * (1 - v / 100));
  return cent(Math.max(0, a - v));
}

/** Meses sem cobrança da mensalidade (0 = o cupom não isenta). */
export const mesesGratis = (c: Cupom | null): number =>
  c?.mensalidade_tipo === "isencao" ? Math.max(0, Math.min(LIMITE_MESES_GRATIS, c.isencao_meses ?? 0)) : 0;

/** O cupom dá desconto (percentual ou valor) na mensalidade? */
export const descontaMensalidade = (c: Cupom | null): boolean =>
  (c?.mensalidade_tipo === "percentual" || c?.mensalidade_tipo === "valor") && (c.mensalidade_valor ?? 0) > 0;

/**
 * O valor de uma cobrança da mensalidade com o cupom. `vencimento` é o dia da
 * cobrança e `descontoAte`, o fim do desconto (cobranca_empresas.cupom_desconto_ate):
 * cobrança que vence antes dele tem desconto; sem `descontoAte` (o desconto ainda
 * não começou) ou com o desconto em todas as cobranças, também. Nunca abaixo de R$ 5,00.
 */
export function mensalidadeComCupom(valor: number, c: Cupom | null, vencimento?: string | null, descontoAte?: string | null): number {
  const v = cent(Math.max(0, valor || 0));
  if (!descontaMensalidade(c) || !(v > 0)) return v;
  if (c!.mensalidade_vezes !== null && descontoAte && vencimento && vencimento >= descontoAte) return v;
  const x = c!.mensalidade_valor ?? 0;
  const com = c!.mensalidade_tipo === "percentual" ? cent(v * (1 - Math.min(99, x) / 100)) : cent(v - x);
  return v <= MINIMO_ASAAS ? v : Math.max(MINIMO_ASAAS, com);
}

/**
 * O fim do desconto da mensalidade: a 1ª cobrança + N períodos (cobranças que
 * vencem antes dele têm desconto). null = sem fim (todas) ou o cupom não desconta.
 */
export function fimDoDesconto(primeira: string, c: Cupom | null, ciclo: Ciclo): string | null {
  if (!descontaMensalidade(c) || c!.mensalidade_vezes === null) return null;
  return somarMeses(primeira, Math.max(1, c!.mensalidade_vezes) * MESES[ciclo]);
}

/** O 1º vencimento da mensalidade com a isenção: `inicio` + N meses (sem isenção, o próprio `inicio`). */
export function vencimentoComIsencao(inicio: string, c: Cupom | null): string {
  const n = mesesGratis(c);
  return n > 0 ? somarMeses(inicio, n) : inicio;
}

/** O que a pessoa paga no cadastro (o 1º período e a adesão) com o cupom. */
export function primeiroPagamento(valorPeriodo: number, adesao: number, c: Cupom | null): {
  periodo: number; adesao: number; total: number; meses_gratis: number; periodo_cheio: number; adesao_cheia: number;
} {
  const gratis = mesesGratis(c);
  const periodo = gratis > 0 ? 0 : mensalidadeComCupom(valorPeriodo, c);
  let a = adesaoComCupom(adesao, c);
  // adesão cobrada sozinha abaixo do mínimo do Asaas: fica isenta
  if (periodo === 0 && a > 0 && a < MINIMO_ASAAS) a = 0;
  return { periodo, adesao: a, total: cent(periodo + a), meses_gratis: gratis, periodo_cheio: cent(valorPeriodo), adesao_cheia: cent(Math.max(0, adesao || 0)) };
}

const pct = (x: number) => `${String(cent(x)).replace(".", ",")}%`;
const meses = (n: number) => (n === 1 ? "1 mês" : `${n} meses`);

/** O cupom em frases ("Isenção da taxa de adesão", "20% de desconto nas 3 primeiras cobranças da mensalidade"). */
export function textosDoCupom(c: Cupom | null): string[] {
  if (!c) return [];
  const out: string[] = [];
  const av = c.adesao_valor ?? 0;
  if (c.adesao_tipo === "isencao" || (c.adesao_tipo === "percentual" && av >= 100)) out.push("Isenção da taxa de adesão");
  else if (c.adesao_tipo === "percentual") out.push(`${pct(av)} de desconto na taxa de adesão`);
  else if (c.adesao_tipo === "valor") out.push(`${fmtReais(av)} de desconto na taxa de adesão`);
  if (c.mensalidade_tipo === "isencao") {
    const n = mesesGratis(c);
    out.push(n === 1 ? "1º mês sem mensalidade" : `${n} primeiros meses sem mensalidade`);
  } else if (descontaMensalidade(c)) {
    const quanto = c.mensalidade_tipo === "percentual" ? pct(c.mensalidade_valor ?? 0) : fmtReais(c.mensalidade_valor ?? 0);
    const n = c.mensalidade_vezes;
    out.push(n === null ? `${quanto} de desconto em todas as cobranças da mensalidade`
      : n === 1 ? `${quanto} de desconto na primeira cobrança da mensalidade`
        : `${quanto} de desconto nas ${n} primeiras cobranças da mensalidade`);
  }
  return out;
}

/** "Isenção da adesão · 1º mês sem mensalidade" — uma linha só (lista do painel, WhatsApp, descrição no Asaas). */
export const resumoDoCupom = (c: Cupom | null): string => textosDoCupom(c).join(" · ");

/** O formulário do cupom no painel (o banco confere de novo em sa_salvar_cupom). */
export interface FormCupom {
  codigo: string;
  adesao_tipo: TipoDesconto | null; adesao_valor: number | null;
  mensalidade_tipo: TipoDesconto | null; mensalidade_valor: number | null;
  mensalidade_vezes: number | null; isencao_meses: number | null;
  max_usos: number | null; valido_ate: string | null;
}

/** Os problemas do formulário, por campo (vazio = pode salvar). */
export function problemasDoCupom(f: FormCupom): Record<string, string> {
  const p: Record<string, string> = {};
  if (!codigoValido(normalizarCodigo(f.codigo))) p.codigo = "O código tem de 3 a 30 letras ou números (pode usar - e _).";
  if (!f.adesao_tipo && !f.mensalidade_tipo) p.alvo = "Escolha onde o cupom vale: na adesão, na mensalidade ou nas duas.";
  if (f.adesao_tipo === "percentual" && !(f.adesao_valor !== null && f.adesao_valor > 0 && f.adesao_valor <= 100)) p.adesao_valor = "Desconto na adesão: de 1% a 100%.";
  if (f.adesao_tipo === "valor" && !(f.adesao_valor !== null && f.adesao_valor > 0 && f.adesao_valor <= LIMITE_VALOR)) p.adesao_valor = "Informe quantos reais saem da adesão.";
  if (f.mensalidade_tipo === "percentual" && !(f.mensalidade_valor !== null && f.mensalidade_valor > 0 && f.mensalidade_valor < 100)) {
    p.mensalidade_valor = "Desconto na mensalidade: de 1% a 99% (para zerar, use a isenção de meses).";
  }
  if (f.mensalidade_tipo === "valor" && !(f.mensalidade_valor !== null && f.mensalidade_valor > 0 && f.mensalidade_valor <= LIMITE_VALOR)) p.mensalidade_valor = "Informe quantos reais saem de cada cobrança.";
  if (descontaMensalidade(f as unknown as Cupom) && f.mensalidade_vezes !== null && !(Number.isInteger(f.mensalidade_vezes) && f.mensalidade_vezes >= 1 && f.mensalidade_vezes <= LIMITE_VEZES)) {
    p.mensalidade_vezes = `Em quantas cobranças: de 1 a ${LIMITE_VEZES} (ou em todas).`;
  }
  if (f.mensalidade_tipo === "isencao" && !(f.isencao_meses !== null && Number.isInteger(f.isencao_meses) && f.isencao_meses >= 1 && f.isencao_meses <= LIMITE_MESES_GRATIS)) {
    p.isencao_meses = `Meses sem mensalidade: de 1 a ${LIMITE_MESES_GRATIS}.`;
  }
  if (f.max_usos !== null && !(Number.isInteger(f.max_usos) && f.max_usos >= 1 && f.max_usos <= 100000)) p.max_usos = "Limite de usos: um número inteiro a partir de 1 (ou sem limite).";
  if (f.valido_ate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(f.valido_ate)) p.valido_ate = "Data de validade inválida.";
  return p;
}

/** Por que o cupom não vale (a página de cadastro mostra). */
export const MOTIVO_CUPOM: Record<string, string> = {
  inexistente: "Cupom não encontrado. Confira as letras e os números.",
  inativo: "Este cupom foi desativado.",
  expirado: "Este cupom venceu.",
  esgotado: "Este cupom já foi usado o número máximo de vezes.",
  plano: "Este cupom não vale para o plano escolhido.",
  muitas: "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.",
};
