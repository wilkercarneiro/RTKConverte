// As medições na conta: a tabela `medicoes_campo` (migração 0047). O
// escritório é preenchido pelo banco (gatilho preencher_escritorio) e a RLS só
// deixa ver e gravar as da própria empresa — a tela nunca manda escritorio_id.
import { supabase } from "../supabase";
import { medicaoValida } from "./aparelho.ts";
import { ErroConta, LIMITE_LISTA, linhaDaMedicao } from "./repositorio.ts";
import type { RepositorioMedicoes } from "./repositorio.ts";
import type { Medicao } from "./tipos.ts";

const TABELA = "medicoes_campo";

function erroDe(e: { message?: string; code?: string } | null): ErroConta {
  const msg = e?.message ?? "Erro desconhecido";
  // tabela que não existe: a 0047 ainda não foi aplicada no banco
  if (e?.code === "42P01" || e?.code === "PGRST205" || /medicoes_campo/.test(msg) && /does not exist|not find|schema cache/i.test(msg)) {
    return new ErroConta("sem-tabela", "O sistema ainda não foi atualizado para guardar medições na conta. Elas ficam no aparelho até lá.");
  }
  if (/fetch|network|Failed to fetch|NetworkError|Load failed/i.test(msg)) return new ErroConta("sem-rede", "Sem internet agora.");
  // a RLS recusou a LINHA (o id existe na conta de outra empresa): não é sessão vencida
  if (/row-level security/i.test(msg)) return new ErroConta("outra-conta", "Esta medição é de outra conta: não sobe para a sua.");
  if (/JWT|not authenticated|permission denied/i.test(msg) || e?.code === "PGRST301") return new ErroConta("sem-login", "A sessão expirou: entre de novo para enviar.");
  return new ErroConta("outro", msg);
}

// A coluna `calibracoes` chega na 0048. Até o banco recebê-la, a medição sobe sem
// ela (os vértices já vão corrigidos, com o bruto e o deslocamento em cada um):
// só recalibrar em OUTRO aparelho fica sem a lista.
let semColunaCalibracoes = false;
const colunaFaltando = (e: { code?: string; message?: string }) =>
  e.code === "42703" || e.code === "PGRST204" || /calibracoes/.test(e.message ?? "");

interface LinhaLida {
  id: string; nome: string; vertices: unknown; fechada: boolean; criado_em: string; atualizado_em: string; calibracoes?: unknown;
}

export function repositorioSupabase(): RepositorioMedicoes {
  return {
    async listar() {
      if (!supabase) throw new ErroConta("outro", "Sistema sem configuração do banco.");
      const consultar = (colunas: string) => supabase!.from(TABELA)
        .select(colunas)
        .order("atualizado_em", { ascending: false })
        .limit(LIMITE_LISTA);
      const BASE = "id, nome, vertices, fechada, criado_em, atualizado_em";
      let r = await consultar(semColunaCalibracoes ? BASE : `${BASE}, calibracoes`);
      // banco ainda sem a 0048: lista sem as calibrações (os vértices já vêm corrigidos)
      if (r.error && colunaFaltando(r.error)) { semColunaCalibracoes = true; r = await consultar(BASE); }
      const { data, error } = r;
      if (error) throw erroDe(error);
      return ((data ?? []) as unknown as LinhaLida[])
        .map((l) => medicaoValida({ id: l.id, nome: l.nome, vertices: l.vertices, fechada: l.fechada, criadaEm: l.criado_em, atualizadaEm: l.atualizado_em, calibracoes: l.calibracoes ?? undefined }))
        .filter((m): m is Medicao => m !== null)
        // o banco devolve a hora no formato dele; aqui volta para o ISO do aparelho (comparação por texto)
        .map((m) => ({ ...m, criadaEm: new Date(m.criadaEm).toISOString(), atualizadaEm: new Date(m.atualizadaEm).toISOString() }));
    },
    async salvar(m) {
      if (!supabase) throw new ErroConta("outro", "Sistema sem configuração do banco.");
      // o gatilho medicoes_campo_mais_nova deixa de lado a versão mais velha sem
      // erro: sem linha de volta = a conta tem uma versão mais nova
      const linha = linhaDaMedicao(m);
      const comCal = !semColunaCalibracoes && m.calibracoes?.length ? { ...linha, calibracoes: m.calibracoes } : linha;
      let r = await supabase.from(TABELA).upsert(comCal, { onConflict: "id" }).select("atualizado_em");
      if (r.error && comCal !== linha && colunaFaltando(r.error)) {
        semColunaCalibracoes = true;
        r = await supabase.from(TABELA).upsert(linha, { onConflict: "id" }).select("atualizado_em");
      }
      const { data, error } = r;
      if (error) throw erroDe(error);
      return Array.isArray(data) && data.length === 0 ? "conta-mais-nova" : "ok";
    },
    async excluir(id) {
      if (!supabase) throw new ErroConta("outro", "Sistema sem configuração do banco.");
      const { error } = await supabase.from(TABELA).delete().eq("id", id);
      if (error) throw erroDe(error);
    },
  };
}
