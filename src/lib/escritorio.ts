// Escritório do usuário logado (ver docs/multiescritorio).
//
// O frontend funciona nos dois estados do banco:
//   - "legado": a migração de escritórios ainda não foi aplicada (a RPC
//     meu_escritorio não existe). Tudo como sempre foi: um escritório só,
//     modelos e logo na raiz do bucket `templates`.
//   - "ok": o usuário pertence a um escritório.
//   - "sem-escritorio": a migração existe, mas a conta não está em nenhum
//     escritório (criada no painel, ou aguardando o dono adicioná-la).
import { supabase } from "./supabase";

export interface Escritorio {
  id: string;
  nome: string;
  papel: "dono" | "membro";
  /** true = escritório que já existia: logo/modelos na raiz de `templates` */
  modelos_compartilhados: boolean;
  /** situação da empresa no SaaS (0024); ausente antes dela */
  status?: "ativo" | "aguardando_pagamento" | "suspenso" | "cancelado";
  plano?: string | null;
  /** equipe (0025): desativado perde o acesso; permissões do membro; nome dele */
  ativo?: boolean;
  permissoes?: string[];
  meu_nome?: string | null;
}

export type EstadoEscritorio =
  | { estado: "legado" }
  | { estado: "sem-escritorio" }
  | { estado: "ok"; escritorio: Escritorio };

export async function carregarEscritorio(): Promise<EstadoEscritorio> {
  const { data, error } = await supabase.rpc("meu_escritorio");
  if (error) return { estado: "legado" };
  const linha = (Array.isArray(data) ? data[0] : data) as Escritorio | undefined;
  return linha?.id ? { estado: "ok", escritorio: linha } : { estado: "sem-escritorio" };
}

/**
 * Pasta do escritório no bucket `templates`. Vazia no escritório legado (e
 * antes da migração): a logo continua em `templates/logo-empresa.*`.
 */
export function pastaDoEscritorio(e: EstadoEscritorio): string {
  if (e.estado !== "ok" || e.escritorio.modelos_compartilhados) return "";
  return `escritorios/${e.escritorio.id}/`;
}

/**
 * Grava chaves de config_empresa sem `upsert`: a chave de conflito muda com a
 * migração (key → escritorio_id+key) e um onConflict fixo quebraria num dos
 * dois estados do banco. UPDATE de quem já existe (a RLS limita ao escritório)
 * e INSERT do resto (o banco preenche o escritório).
 */
export async function salvarConfigEmpresa(linhas: { key: string; value: string }[]): Promise<string | null> {
  const { data: existentes, error: eSel } = await supabase.from("config_empresa").select("key").in("key", linhas.map((l) => l.key));
  if (eSel) return eSel.message;
  const tem = new Set(((existentes ?? []) as { key: string }[]).map((l) => l.key));
  for (const l of linhas) {
    const { error } = tem.has(l.key)
      ? await supabase.from("config_empresa").update({ value: l.value }).eq("key", l.key)
      : await supabase.from("config_empresa").insert(l);
    if (error) return error.message;
  }
  return null;
}
