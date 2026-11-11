// Escritórios adicionais (migração 0050).
//
// O plano Empresarial permite escritórios adicionais: cada um é um espaço
// próprio (serviços, clientes, cadastros, configurações e equipe) que usa o
// plano e os créditos da matriz e entra na mensalidade dela. O dono da matriz
// cria, renomeia, desativa e reativa (Configurações → Escritórios) e entra em
// qualquer um pelo seletor do topo. Depois de mudar a lista, a mensalidade nova
// vai para o Asaas pela função `cobranca` (escritorios_sincronizar).
import { chamarFuncao, supabase } from "./supabase";
import type { MensalidadeDetalhe } from "./cobranca";
import { rotaParaHash } from "./rota";

export interface EscritorioAdicional {
  id: string; nome: string; status: "ativo" | "suspenso" | "cancelado" | "aguardando_pagamento";
  criado_em: string; servicos: number; servicos_30d: number; ultimo_servico: string | null; usuarios: number;
}

export interface MeusEscritorios {
  /** false = quem chama não é o dono da matriz (membro da equipe, ou já é um escritório) */
  disponivel: boolean;
  matriz?: { id: string; nome: string; status: string; servicos?: number; servicos_30d?: number; usuarios?: number };
  plano?: string | null;
  /** quantos escritórios ativos o plano (ou o combinado) permite */
  limite?: number;
  /** quanto cada escritório ativo soma à mensalidade */
  preco?: number;
  ativos?: number;
  mensalidade?: MensalidadeDetalhe;
  /** o escritório em que o dono está agora (a matriz, se nenhum) */
  em_uso?: string;
  escritorios?: EscritorioAdicional[];
}

let falsa: ((acao: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;
/** Só os laboratórios (dev): responde no lugar do banco. */
export function definirEscritoriosFalsos(f: typeof falsa): void { falsa = f; }

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (falsa) return (await falsa(fn, args)) as T;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** O que a tela "Escritórios" mostra; null = banco sem a 0050. */
export async function meusEscritorios(): Promise<MeusEscritorios | null> {
  try { return await rpc<MeusEscritorios>("meus_escritorios"); }
  catch (e) {
    if (/meus_escritorios|function|schema cache/i.test(String((e as Error).message))) return null;
    throw e;
  }
}

export const criarEscritorio = (nome: string) =>
  rpc<{ id: string; nome: string; mensalidade: MensalidadeDetalhe }>("criar_escritorio", { p_nome: nome });

/** Renomeia (`nome`), desativa (`ativo: false`) ou reativa (`ativo: true`). */
export const definirEscritorio = (id: string, mudar: { nome?: string; ativo?: boolean }) =>
  rpc<{ id: string; mensalidade: MensalidadeDetalhe }>("definir_escritorio",
    { p_id: id, p_nome: mudar.nome ?? null, p_ativo: mudar.ativo ?? null });

/** O seletor do topo: passa a trabalhar no escritório (null ou o id da matriz = a matriz). */
export const usarEscritorio = (id: string | null) => rpc<void>("usar_escritorio", { p_id: id });

/**
 * Troca de escritório e recarrega o sistema no Início: tudo (serviços,
 * clientes, créditos, permissões) é relido já no escritório novo.
 */
export async function entrarNoEscritorio(id: string | null): Promise<void> {
  await usarEscritorio(id);
  if (falsa) return;
  history.replaceState(null, "", `${location.pathname}${location.search}${rotaParaHash({ t: "inicio" })}`);
  location.reload();
}

/**
 * Leva a mensalidade nova ao Asaas (assinatura e faturas em aberto). Sem Asaas
 * ou sem assinatura não há o que levar: `sincronizado: false`.
 */
export async function sincronizarMensalidade(): Promise<{ sincronizado: boolean; valor: number | null }> {
  if (falsa) return (await falsa("escritorios_sincronizar")) as { sincronizado: boolean; valor: number | null };
  return chamarFuncao<{ sincronizado: boolean; valor: number | null }>("cobranca", { acao: "escritorios_sincronizar" });
}

/** "R$ 1.000,00 + 2 escritórios × R$ 99,90" — a conta da mensalidade em uma linha. */
export function contaDaMensalidade(m: MensalidadeDetalhe | null | undefined, fmt: (v: number) => string): string | null {
  if (!m || m.plano == null || !(m.escritorios > 0)) return null;
  const n = m.escritorios;
  return `${fmt(Number(m.plano))} do plano + ${n} escritório${n > 1 ? "s" : ""} × ${fmt(Number(m.preco_escritorio))}`;
}
