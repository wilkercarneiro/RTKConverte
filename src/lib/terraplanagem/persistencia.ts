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

/** Resultado de uma gravação: onde ficou e, se não ficou em algum lugar, por quê. */
export interface Gravado {
  naConta: boolean;
  noAparelho: boolean;
  /** frase para a tela quando algo não gravou (sem conexão, cheio, grande demais) */
  motivo?: string;
}

export interface Armazenamento {
  /** `semConexao`: a conta não respondeu — a lista é a deste aparelho */
  listar(): Promise<{ itens: ResumoTerraplanagem[]; soNoAparelho: boolean; semConexao?: boolean }>;
  carregar(id: string): Promise<ProjetoTerraplanagem | null>;
  /** grava; diz onde ficou (conta, aparelho, os dois ou nenhum) */
  salvar(p: ProjetoTerraplanagem, resumo: ResumoTerraplanagem): Promise<Gravado>;
  apagar(id: string): Promise<void>;
}

const PREFIXO = "vertces.terraplanagem.";
const INDICE = `${PREFIXO}indice`;
/** quantos projetos ficam no aparelho (os mais antigos saem, com o blob) */
export const MAX_NO_APARELHO = 60;
/** a tabela aceita até 5 MB por projeto (CHECK da 0046); folga para o JSON da linha */
export const MAX_BYTES_CONTA = 4_500_000;

const ler = <T>(k: string): T | null => { try { const t = localStorage.getItem(k); return t ? JSON.parse(t) as T : null; } catch { return null; } };
const gravarTexto = (k: string, t: string) => { try { localStorage.setItem(k, t); return true; } catch { return false; } };
const gravar = (k: string, v: unknown) => gravarTexto(k, JSON.stringify(v));
const tirar = (k: string) => { try { localStorage.removeItem(k); } catch { /* sem storage */ } };

/** Tamanho do projeto gravado (bytes do JSON compacto). */
export const tamanhoGravado = (p: ProjetoTerraplanagem): number => new TextEncoder().encode(JSON.stringify(paraGravar(p))).length;

const indice = () => ler<ResumoTerraplanagem[]>(INDICE) ?? [];

/** Só no aparelho (laboratório, ou banco sem a migração). */
export const armazenamentoLocal: Armazenamento = {
  async listar() {
    const itens = indice().sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm));
    return { itens, soNoAparelho: true };
  },
  async carregar(id) { return normalizarProjeto(ler(PREFIXO + id)); },
  async salvar(p, resumo) {
    const outros = indice().filter((x) => x.id !== p.id);
    const fica = [resumo, ...outros].slice(0, MAX_NO_APARELHO);
    // os que saíram do índice levam o blob junto (senão a cota do navegador enche)
    for (const x of outros.slice(MAX_NO_APARELHO - 1)) tirar(PREFIXO + x.id);
    const texto = JSON.stringify(paraGravar(p));
    let ok = gravarTexto(PREFIXO + p.id, texto);
    if (!ok) {
      // cheio: abre espaço tirando os mais antigos (nunca o atual) e tenta de novo
      const fila = fica.slice(1).reverse();
      while (!ok && fila.length) {
        const velho = fila.shift()!;
        tirar(PREFIXO + velho.id);
        fica.splice(fica.findIndex((x) => x.id === velho.id), 1);
        ok = gravarTexto(PREFIXO + p.id, texto);
      }
    }
    if (!ok) {
      gravar(INDICE, fica.filter((x) => x.id !== p.id));
      return { naConta: false, noAparelho: false, motivo: "o navegador não tem espaço para guardar este projeto" };
    }
    if (!gravar(INDICE, fica)) return { naConta: false, noAparelho: false, motivo: "o navegador não deixou gravar a lista de projetos" };
    return { naConta: false, noAparelho: true };
  },
  async apagar(id) {
    tirar(PREFIXO + id);
    gravar(INDICE, indice().filter((x) => x.id !== id));
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
    let data: { id: string; nome: string; updated_at: string; resumo: Partial<ResumoTerraplanagem> | null }[] | null = null;
    let error: ErroPg | null = null;
    try {
      ({ data, error } = await supabase.from("terraplanagens").select("id, nome, updated_at, resumo").order("updated_at", { ascending: false }).limit(60));
    } catch (e) { error = { message: e instanceof Error ? e.message : String(e) }; }
    if (error) {
      // sem a tabela ou sem conexão: o que está no aparelho continua à mão
      return { itens: local, soNoAparelho: true, semConexao: !semTabela(error) };
    }
    // o que só está no aparelho (gravado sem rede) também aparece; dos dois, vale o mais novo
    const porId = new Map<string, ResumoTerraplanagem>();
    for (const c of [...(data ?? []).map(resumoDaLinha), ...local]) {
      const ja = porId.get(c.id);
      if (!ja || new Date(c.atualizadoEm).getTime() > new Date(ja.atualizadoEm).getTime()) porId.set(c.id, c);
    }
    const itens = [...porId.values()].sort((a, b) => new Date(b.atualizadoEm).getTime() - new Date(a.atualizadoEm).getTime());
    return { itens, soNoAparelho: false };
  },
  async carregar(id) {
    const local = await armazenamentoLocal.carregar(id);
    let data: { projeto: unknown; updated_at: string } | null = null;
    let error: ErroPg | null = null;
    try {
      ({ data, error } = await supabase.from("terraplanagens").select("projeto, updated_at").eq("id", id).maybeSingle());
    } catch (e) { error = { message: e instanceof Error ? e.message : String(e) }; }
    if (error && !semTabela(error)) { if (local) return local; throw new Error(error.message); }
    const conta = data ? normalizarProjeto(data.projeto) : null;
    if (!conta) return local;
    if (!local) return conta;
    return local.atualizadoEm > conta.atualizadoEm ? local : conta;
  },
  async salvar(p, resumo) {
    const aqui = await armazenamentoLocal.salvar(p, resumo);
    if (tamanhoGravado(p) > MAX_BYTES_CONTA) {
      return { naConta: false, noAparelho: aqui.noAparelho, motivo: aqui.motivo ?? "o projeto passa de 4,5 MB (pontos demais) e não cabe na conta" };
    }
    let erro: string | null = null;
    try {
      const { error } = await supabase.from("terraplanagens").upsert({
        id: p.id, nome: p.nome, projeto: paraGravar(p), resumo, updated_at: p.atualizadoEm,
      }, { onConflict: "id" });
      if (error) erro = semTabela(error) ? "a conta ainda não guarda terraplanagens" : "sem conexão com a conta";
    } catch { erro = "sem conexão com a conta"; }
    // sem rede ou sem a tabela: a cópia do aparelho (se gravou) segura; a próxima mudança tenta de novo
    if (erro) return { naConta: false, noAparelho: aqui.noAparelho, motivo: aqui.motivo ? `${erro} e ${aqui.motivo}` : erro };
    return { naConta: true, noAparelho: aqui.noAparelho };
  },
  async apagar(id) {
    // primeiro na conta: sem conexão, nada some do aparelho (senão o projeto "volta" depois)
    let error: ErroPg | null = null;
    try { ({ error } = await supabase.from("terraplanagens").delete().eq("id", id)); }
    catch (e) { error = { message: e instanceof Error ? e.message : String(e) }; }
    if (error && !semTabela(error)) throw new Error("sem conexão com a conta agora — o projeto continua guardado. Tente de novo com internet.");
    await armazenamentoLocal.apagar(id);
  },
};
