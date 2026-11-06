// Onde o projeto de terraplanagem mora: na conta (tabela terraplanagens,
// migração 0046, RLS por escritório) e, sempre, uma cópia no aparelho — sem
// internet ou antes da migração no ar, nada se perde; na volta, vale o mais novo.
import type { supabase as ClienteSupabase } from "../supabase";
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
  /**
   * Só no índice do aparelho: o `atualizadoEm` da última versão que chegou à
   * conta. Sem ele, o projeto nunca foi para a conta (feito sem rede) e não
   * pode ser despejado nem tirado "por ter sido apagado em outro aparelho".
   */
  sincronizadoEm?: string;
}

/** A versão do aparelho já está toda na conta (pode sair do aparelho sem perder nada). */
export const estaNaConta = (x: ResumoTerraplanagem): boolean => !!x.sincronizadoEm && x.sincronizadoEm >= x.atualizadoEm;

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
    const antes = indice();
    const existente = antes.find((x) => x.id === p.id);
    // a marca de sincronia vem do índice (o resumo da tela não sabe dela)
    const atual: ResumoTerraplanagem = { ...resumo, sincronizadoEm: resumo.sincronizadoEm ?? existente?.sincronizadoEm };
    if (!atual.sincronizadoEm) delete atual.sincronizadoEm;
    const outros = antes.filter((x) => x.id !== p.id);
    let fica = [atual, ...outros];
    // passou do limite: saem os mais antigos que já estão na conta (o que só está aqui, fica)
    for (let i = fica.length - 1; fica.length > MAX_NO_APARELHO && i > 0; i--) {
      if (estaNaConta(fica[i])) { tirar(PREFIXO + fica[i].id); fica.splice(i, 1); }
    }
    const texto = JSON.stringify(paraGravar(p));
    let ok = gravarTexto(PREFIXO + p.id, texto);
    if (!ok) {
      // cheio: abre espaço tirando os mais antigos que já estão na conta (nunca o atual,
      // nunca um que só existe neste aparelho) e tenta de novo
      const fila = fica.slice(1).filter(estaNaConta).reverse();
      while (!ok && fila.length) {
        const velho = fila.shift()!;
        tirar(PREFIXO + velho.id);
        fica = fica.filter((x) => x.id !== velho.id);
        ok = gravarTexto(PREFIXO + p.id, texto);
      }
    }
    if (!ok) {
      // o índice continua dizendo onde está cada um (a versão anterior deste, se havia, segue gravada)
      gravar(INDICE, existente ? fica.map((x) => (x.id === p.id ? existente : x)) : fica.filter((x) => x.id !== p.id));
      return { naConta: false, noAparelho: false, motivo: "o navegador está cheio (os projetos que só existem neste aparelho não foram apagados para abrir espaço)" };
    }
    if (!gravar(INDICE, fica)) return { naConta: false, noAparelho: false, motivo: "o navegador não deixou gravar a lista de projetos" };
    return { naConta: false, noAparelho: true };
  },
  async apagar(id) {
    tirar(PREFIXO + id);
    gravar(INDICE, indice().filter((x) => x.id !== id));
  },
};

/** Marca no índice do aparelho que esta versão chegou à conta. */
function marcarSincronizado(id: string, atualizadoEm: string) {
  const ix = indice();
  const it = ix.find((x) => x.id === id);
  if (!it) return;
  if (!it.sincronizadoEm || it.sincronizadoEm < atualizadoEm) { it.sincronizadoEm = atualizadoEm; gravar(INDICE, ix); }
}

/** Some do aparelho o que foi apagado na conta por outro aparelho (e não tem mudança nova aqui). */
function esquecerNoAparelho(id: string) {
  tirar(PREFIXO + id);
  gravar(INDICE, indice().filter((x) => x.id !== id));
}

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

type Cliente = typeof ClienteSupabase;

/**
 * Conta + aparelho. O cliente vem de fora (os testes passam um falso); o do
 * sistema só é importado na primeira chamada.
 */
export function criarArmazenamentoConta(obterCliente: () => Promise<Cliente>): Armazenamento {
  // gravações na conta, uma de cada vez e sempre a versão mais nova de cada
  // projeto: com rede lenta, um upsert antigo não termina depois do novo
  const paraConta = new Map<string, { p: ProjetoTerraplanagem; resumo: ResumoTerraplanagem }>();
  const ultimoEnvio = new Map<string, { erro: string | null }>();
  let fila: Promise<unknown> = Promise.resolve();

  async function enviarParaConta(id: string): Promise<{ erro: string | null }> {
    const pedido = paraConta.get(id);
    // uma gravação anterior da fila já levou a versão mais nova
    if (!pedido) return ultimoEnvio.get(id) ?? { erro: null };
    paraConta.delete(id);
    const { p, resumo } = pedido;
    let erro: string | null = null;
    try {
      const { sincronizadoEm: _, ...semMarca } = resumo;
      void _;
      const { error } = await (await obterCliente()).from("terraplanagens").upsert({
        id: p.id, nome: p.nome, projeto: paraGravar(p), resumo: semMarca, updated_at: p.atualizadoEm,
      }, { onConflict: "id" });
      if (error) erro = semTabela(error) ? "a conta ainda não guarda terraplanagens" : "sem conexão com a conta";
    } catch { erro = "sem conexão com a conta"; }
    if (!erro) marcarSincronizado(p.id, p.atualizadoEm);
    const r = { erro };
    ultimoEnvio.set(id, r);
    return r;
  }

  return {
    async listar() {
      const local = (await armazenamentoLocal.listar()).itens;
      let data: { id: string; nome: string; updated_at: string; resumo: Partial<ResumoTerraplanagem> | null }[] | null = null;
      let error: ErroPg | null = null;
      try {
        ({ data, error } = await (await obterCliente()).from("terraplanagens").select("id, nome, updated_at, resumo").order("updated_at", { ascending: false }).limit(60));
      } catch (e) { error = { message: e instanceof Error ? e.message : String(e) }; }
      if (error) {
        // sem a tabela ou sem conexão: o que está no aparelho continua à mão
        return { itens: local, soNoAparelho: true, semConexao: !semTabela(error) };
      }
      // o que só está no aparelho (gravado sem rede) também aparece; dos dois, vale o mais novo.
      // O que já esteve na conta, não tem mudança nova aqui e a conta não devolveu
      // foi apagado em outro aparelho: sai deste também.
      const linhas = data ?? [];
      const naConta = new Set(linhas.map((l) => l.id));
      const maisVelhaDaConta = linhas.length >= 60 ? linhas[linhas.length - 1].updated_at : null;
      const fica = local.filter((x) => {
        if (naConta.has(x.id) || !estaNaConta(x)) return true;
        // a conta só devolve 60: o que é mais velho que o último pode só não ter vindo
        if (maisVelhaDaConta && new Date(x.atualizadoEm).getTime() <= new Date(maisVelhaDaConta).getTime()) return true;
        esquecerNoAparelho(x.id);
        return false;
      });
      const porId = new Map<string, ResumoTerraplanagem>();
      for (const c of [...linhas.map(resumoDaLinha), ...fica]) {
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
        ({ data, error } = await (await obterCliente()).from("terraplanagens").select("projeto, updated_at").eq("id", id).maybeSingle());
      } catch (e) { error = { message: e instanceof Error ? e.message : String(e) }; }
      if (error && !semTabela(error)) { if (local) return local; throw new Error(error.message); }
      const conta = data ? normalizarProjeto(data.projeto) : null;
      if (!conta && !error && local) {
        // a conta respondeu e não tem: se a cópia daqui já tinha ido para a conta e
        // não mudou depois, foi apagado em outro aparelho
        const it = indice().find((x) => x.id === id);
        if (it && estaNaConta(it)) { esquecerNoAparelho(id); return null; }
      }
      if (!conta) return local;
      if (!local) return conta;
      return local.atualizadoEm > conta.atualizadoEm ? local : conta;
    },
    async salvar(p, resumo) {
      const aqui = await armazenamentoLocal.salvar(p, resumo);
      if (tamanhoGravado(p) > MAX_BYTES_CONTA) {
        return { naConta: false, noAparelho: aqui.noAparelho, motivo: aqui.motivo ?? "o projeto passa de 4,5 MB (pontos demais) e não cabe na conta" };
      }
      paraConta.set(p.id, { p, resumo });
      const job = fila.then(() => enviarParaConta(p.id));
      fila = job.catch(() => undefined);
      const { erro } = await job;
      // sem rede ou sem a tabela: a cópia do aparelho (se gravou) segura; a próxima mudança tenta de novo
      if (erro) return { naConta: false, noAparelho: aqui.noAparelho, motivo: aqui.motivo ? `${erro} e ${aqui.motivo}` : erro };
      return { naConta: true, noAparelho: aqui.noAparelho };
    },
    async apagar(id) {
      // primeiro na conta: sem conexão, nada some do aparelho (senão o projeto "volta" depois)
      let error: ErroPg | null = null;
      try { ({ error } = await (await obterCliente()).from("terraplanagens").delete().eq("id", id)); }
      catch (e) { error = { message: e instanceof Error ? e.message : String(e) }; }
      if (error && !semTabela(error)) throw new Error("sem conexão com a conta agora — o projeto continua guardado. Tente de novo com internet.");
      await armazenamentoLocal.apagar(id);
    },
  };
}

export const armazenamentoConta: Armazenamento = criarArmazenamentoConta(async () => (await import("../supabase")).supabase);
