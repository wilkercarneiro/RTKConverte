// Regras puras dos créditos (sem banco): tipos, saldo de cada carteira e o
// custo de criar um serviço. Separadas de creditos.ts para rodar nos testes
// do Node; creditos.ts reexporta tudo, então quem importa de lá não muda.
import type { ChaveServico } from "./modalidades";
import type { Faixa } from "../../supabase/functions/_shared/precos.ts";

export type { Faixa };

export interface Carteira {
  chave: string;
  nome: string;
  descricao: string | null;
  /** serviços que ela paga (null = todos) */
  servicos: string[] | null;
  /** créditos do mês (null = sem limite) */
  por_mes: number | null;
  usado: number;
  /** comprados ou dados, sem vencimento */
  extra: number;
  /** preço do crédito extra por faixa (vazio = não está à venda) */
  precos: Faixa[];
}

export type StatusCompra = "pendente" | "aprovado" | "recusado" | "cancelado";
export interface Compra {
  id: string; tipo: string; quantidade: number; valor: number | null; unitario: number | null;
  descricao: string | null; status: StatusCompra; origem: "pedido" | "manual" | "compra";
  created_at: string; link: string | null; pagamento: string | null;
  /** feita pela compra automática (cartão) */
  automatica?: boolean;
  /** forma do pagamento no Asaas (CREDIT_CARD, PIX…) */
  forma?: string | null;
}

/** O cartão da empresa como as telas veem (o token fica no servidor). */
export interface CartaoPublico {
  bandeira: string | null; final: string | null; validade: string | null; titular: string | null;
  /** o Asaas guardou o cartão (token): ele compra créditos na hora e sozinho */
  reutilizavel: boolean;
  cadastrado_em: string;
  recusa_em: string | null; recusa_motivo: string | null;
}

/** Compra automática de uma carteira. */
export interface RecargaCarteira { ativo: boolean; quantidade: number; limite_periodo: number | null; gasto_periodo: number }

export interface Creditos {
  periodo: { inicio: string; renova_em: string; dia: number };
  carteiras: Carteira[];
  servicos: Record<string, { disponivel: boolean; carteira: string | null; precisa_aceite: boolean }>;
  sou_dono: boolean;
  /** Asaas configurado: a compra gera cobrança e os créditos entram sozinhos */
  pagamento_online: boolean;
  compras: Compra[];
  /** 0037: o cartão salvo e a compra automática por carteira */
  cartao?: CartaoPublico | null;
  recarga?: Record<string, RecargaCarteira>;
}

export const doServico = (c: Creditos | null, chave: ChaveServico) => c?.servicos[`servico.${chave}`];

/** O serviço ainda pode nascer? (sem a 0034, sempre) */
export const temCredito = (c: Creditos | null, chave: ChaveServico): boolean => doServico(c, chave)?.disponivel ?? true;

/** Só crédito geral paga este serviço agora, e ele tem carteira própria: pede o aceite. */
export const precisaAceite = (c: Creditos | null, chave: ChaveServico): boolean => doServico(c, chave)?.precisa_aceite ?? false;

export const carteiraDe = (c: Creditos, tipo: string): Carteira | undefined => c.carteiras.find((x) => x.chave === tipo);

/** Créditos do mês que sobram (null = sem limite). */
export const sobraDoMes = (k: Carteira): number | null => (k.por_mes === null ? null : Math.max(0, k.por_mes - k.usado));

/** Tudo o que a carteira ainda paga: o que sobra do mês + o extra (null = sem limite). */
export function disponivel(k: Carteira): number | null {
  const s = sobraDoMes(k);
  return s === null ? null : s + k.extra;
}

/** A carteira própria do serviço (a de CAR para o CAR); undefined = só a geral. */
export const carteiraPropria = (c: Creditos, chave: ChaveServico): Carteira | undefined =>
  c.carteiras.find((k) => k.servicos?.includes(`servico.${chave}`));

export const carteiraGeral = (c: Creditos): Carteira | undefined => c.carteiras.find((k) => k.servicos === null);

/** A carteira vende crédito extra neste plano. */
export const aVenda = (k: Carteira): boolean => k.precos.length > 0;

/** "crédito de CAR", "créditos gerais"… a partir do nome da carteira. */
export function nomeCredito(k: Pick<Carteira, "nome"> | undefined, n = 2): string {
  const base = (k?.nome ?? "Créditos").replace(/^Créditos\s*/i, "");
  if (n === 1) return `crédito ${base.replace(/^gerais$/i, "geral")}`.trim();
  return `créditos ${base}`.trim();
}

/** Erro do banco: o crédito acabou. */
export const ehSemCredito = (msg: string): boolean => msg.includes("SEM_CREDITO");
/** Erro do banco: só o crédito geral paga, e falta o aceite. */
export const ehAceiteGeral = (msg: string): boolean => msg.includes("ACEITE_CREDITO_GERAL");
/** Tira o prefixo técnico da mensagem do banco. */
export const textoSemCredito = (msg: string): string =>
  msg.replace(/^.*(SEM_CREDITO|ACEITE_CREDITO_GERAL):\s*/, "").replace(/^./, (x) => x.toUpperCase());

export const fmtPreco = (v: number | null): string =>
  v === null ? "a combinar" : Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** "30 de outubro" de uma data "aaaa-mm-dd" (sem passar por fuso). */
export function diaMes(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}


// ---------------------------------------------------------------------------
// Antes de gastar: o que o "Prosseguir" vai consumir
// ---------------------------------------------------------------------------

export interface CustoServico {
  /** ainda há crédito para este serviço (o banco decide de novo ao criar) */
  disponivel: boolean;
  /** "1 crédito", "1 crédito geral"… */
  credito: string;
  /** de onde sai e quanto sobra depois */
  detalhe: string;
}

/**
 * O que criar este serviço agora gasta, para a pergunta do "Prosseguir". Segue
 * a ordem do banco (fonte_credito): a carteira que o banco indicou para o
 * serviço; nela, primeiro o crédito do mês e depois o extra.
 */
export function custoDoServico(c: Creditos | null, chave: ChaveServico): CustoServico {
  const generico = { disponivel: true, credito: "1 crédito", detalhe: "O crédito é descontado quando o serviço é criado." };
  if (!c) return generico;
  const s = doServico(c, chave);
  const k = (s?.carteira ? carteiraDe(c, s.carteira) : undefined) ?? carteiraPropria(c, chave) ?? carteiraGeral(c);
  if (s && !s.disponivel) {
    return { disponivel: false, credito: k ? `1 ${nomeCredito(k, 1)}` : "1 crédito", detalhe: `Os ${k ? nomeCredito(k) : "créditos"} acabaram. Compre mais créditos para criar o serviço — a conferência fica aberta aqui.` };
  }
  if (!k) return generico;
  const credito = `1 ${nomeCredito(k, 1)}`;
  const sobra = sobraDoMes(k);
  const renova = c.periodo?.renova_em ? ` (renova em ${diaMes(c.periodo.renova_em)})` : "";
  if (sobra === null) return { disponivel: true, credito, detalhe: `Seu plano não tem limite de ${nomeCredito(k)} no mês.` };
  if (sobra > 0) {
    const depois = sobra - 1;
    const extra = k.extra > 0 ? ` Você ainda tem ${k.extra} extra${k.extra === 1 ? "" : "s"} guardado${k.extra === 1 ? "" : "s"}.` : "";
    return {
      disponivel: true, credito,
      detalhe: `Sai dos créditos do mês: depois dele, ${depois === 0 ? "não sobra nenhum" : depois === 1 ? "sobra 1" : `sobram ${depois}`} de ${k.por_mes}${renova}.${extra}`,
    };
  }
  const depois = Math.max(0, k.extra - 1);
  return {
    disponivel: true, credito,
    detalhe: `Os créditos do mês já foram usados: este sai dos extras comprados. Depois dele, ${depois === 0 ? "não sobra nenhum extra" : depois === 1 ? "sobra 1 extra" : `sobram ${depois} extras`}.`,
  };
}

/**
 * O custo de criar `n` serviços de uma vez — o GEO de cada parte da divisão:
 * cada parte é um serviço novo e gasta 1 crédito. Mesma ordem do banco: a
 * carteira do serviço; nela, o crédito do mês e depois o extra. Sem crédito
 * para todos, não deixa começar (criaria só uma parte das partes).
 */
export function custoDeVarios(c: Creditos | null, chave: ChaveServico, n: number): CustoServico {
  const qtd = (k: Carteira | undefined, x: number) => `${x} ${k ? nomeCredito(k, x) : x === 1 ? "crédito" : "créditos"}`;
  if (n <= 0) return { disponivel: false, credito: "0 créditos", detalhe: "Nenhuma parte selecionada." };
  if (n === 1) return custoDoServico(c, chave);
  if (!c) return { disponivel: true, credito: qtd(undefined, n), detalhe: "Os créditos são descontados quando os serviços são criados, 1 por parte." };
  const s = doServico(c, chave);
  const k = (s?.carteira ? carteiraDe(c, s.carteira) : undefined) ?? carteiraPropria(c, chave) ?? carteiraGeral(c);
  if (!k) return { disponivel: true, credito: qtd(undefined, n), detalhe: "Os créditos são descontados quando os serviços são criados, 1 por parte." };
  const credito = qtd(k, n);
  if (s && !s.disponivel) return { disponivel: false, credito, detalhe: `Os ${nomeCredito(k)} acabaram. Compre mais créditos para gerar os GEOs das partes.` };
  const tem = disponivel(k);
  if (tem === null) return { disponivel: true, credito, detalhe: `Seu plano não tem limite de ${nomeCredito(k)} no mês: 1 por parte, ${n} no total.` };
  if (tem < n) {
    return { disponivel: false, credito, detalhe: `Há ${tem === 0 ? "nenhum" : qtd(k, tem)} e são ${n} partes. Compre mais créditos ou selecione menos partes.` };
  }
  const doMes = Math.min(sobraDoMes(k) ?? 0, n);
  const extras = n - doMes;
  const depois = tem - n;
  const origem = [doMes ? `${doMes} do${doMes === 1 ? "" : "s"} crédito${doMes === 1 ? "" : "s"} do mês` : "", extras ? `${extras} do${extras === 1 ? "" : "s"} extra${extras === 1 ? "" : "s"} comprado${extras === 1 ? "" : "s"}` : ""].filter(Boolean).join(" e ");
  return {
    disponivel: true, credito,
    detalhe: `1 por parte: saem ${origem}. Depois, ${depois === 0 ? "não sobra nenhum" : depois === 1 ? "sobra 1" : `sobram ${depois}`}.`,
  };
}
