// Onde o projeto de terraplanagem mora: na conta (tabela terraplanagens,
// migração 0046, RLS por escritório) e, sempre, uma cópia no aparelho — sem
// internet ou antes da migração no ar, nada se perde; na volta, vale o mais novo.
import { supabase } from "../supabase";
import type { ProjetoTerraplanagem } from "./modelo.ts";
import { normalizarProjeto, paraGravar } from "./modelo.ts";

export interface ResumoTerraplanagem {
  id: string;
  nome: string;
  atualizadoEm: string;
  nPontos: number;
  corte: number | null;
  aterro: number | null;
  cota: number | null;
}

export interface Armazenamento {
  listar(): Promise<{ itens: ResumoTerraplanagem[]; soNoAparelho: boolean }>;
  carregar(id: string): Promise<ProjetoTerraplanagem | null>;
  /** grava; diz se foi para a conta ou ficou só no aparelho */
  salvar(p: ProjetoTerraplanagem, resumo: ResumoTerraplanagem): Promise<{ naConta: boolean }>;
  apagar(id: string): Promise<void>;
}

const PREFIXO = "vertces.terraplanagem.";
const INDICE = `${PREFIXO}indice`;

const ler = <T>(k: string): T | null => { try { const t = localStorage.getItem(k); return t ? JSON.parse(t) as T : null; } catch { return null; } };
const gravar = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const tirar = (k: string) => { try { localStorage.removeItem(k); } catch { /* sem storage */ } };

/** Só no aparelho (laboratório, ou banco sem a migração). */
export const armazenamentoLocal: Armazenamento = {
  async listar() {
    const itens = (ler<ResumoTerraplanagem[]>(INDICE) ?? []).sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
    return { itens, soNoAparelho: true };
  },
  async carregar(id) { return normalizarProjeto(ler(PREFIXO + id)); },
  async salvar(p, resumo) {
    gravar(PREFIXO + p.id, paraGravar(p));
    const idx = (ler<ResumoTerraplanagem[]>(INDICE) ?? []).filter((x) => x.id !== p.id);
    gravar(INDICE, [resumo, ...idx].slice(0, 60));
    return { naConta: false };
  },
  async apagar(id) {
    tirar(PREFIXO + id);
    gravar(INDICE, (ler<ResumoTerraplanagem[]>(INDICE) ?? []).filter((x) => x.id !== id));
  },
};

interface ErroPg { code?: string; message?: string }
/** O banco ainda não tem a tabela (migração 0046 não aplicada). */
export function semTabela(e: ErroPg | null | undefined): boolean {
  if (!e) return false;
  return e.code === "42P01" || e.code === "PGRST205" || /terraplanagens/.test(e.message ?? "") && /does not exist|schema cache|not find/i.test(e.message ?? "");
}

const resumoDaLinha = (l: { id: string; nome: string; updated_at: string; resumo: Partial<ResumoTerraplanagem> | null }): ResumoTerraplanagem => ({
  id: l.id, nome: l.nome, atualizadoEm: l.updated_at,
  nPontos: Number(l.resumo?.nPontos ?? 0), corte: l.resumo?.corte ?? null, aterro: l.resumo?.aterro ?? null, cota: l.resumo?.cota ?? null,
});

/** Conta + aparelho. */
export const armazenamentoConta: Armazenamento = {
  async listar() {
    const local = (await armazenamentoLocal.listar()).itens;
    const { data, error } = await supabase.from("terraplanagens").select("id, nome, updated_at, resumo").order("updated_at", { ascending: false }).limit(60);
    if (error) {
      if (semTabela(error)) return { itens: local, soNoAparelho: true };
      throw new Error(error.message);
    }
    const conta = (data ?? []).map(resumoDaLinha);
    // o que só está no aparelho (gravado sem rede) também aparece
    const ids = new Set(conta.map((c) => c.id));
    const itens = [...conta, ...local.filter((l) => !ids.has(l.id))].sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
    return { itens, soNoAparelho: false };
  },
  async carregar(id) {
    const local = await armazenamentoLocal.carregar(id);
    const { data, error } = await supabase.from("terraplanagens").select("projeto, updated_at").eq("id", id).maybeSingle();
    if (error && !semTabela(error)) { if (local) return local; throw new Error(error.message); }
    const conta = data ? normalizarProjeto(data.projeto) : null;
    if (!conta) return local;
    if (!local) return conta;
    return local.atualizadoEm > conta.atualizadoEm ? local : conta;
  },
  async salvar(p, resumo) {
    await armazenamentoLocal.salvar(p, resumo);
    const { error } = await supabase.from("terraplanagens").upsert({
      id: p.id, nome: p.nome, projeto: paraGravar(p), resumo, updated_at: p.atualizadoEm,
    }, { onConflict: "id" });
    // sem rede ou sem a tabela: a cópia do aparelho já está gravada; a próxima mudança tenta de novo
    return { naConta: !error };
  },
  async apagar(id) {
    await armazenamentoLocal.apagar(id);
    const { error } = await supabase.from("terraplanagens").delete().eq("id", id);
    if (error && !semTabela(error)) throw new Error(error.message);
  },
};
