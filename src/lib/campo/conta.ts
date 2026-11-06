// As medições na conta: a tabela `medicoes_campo` (migração 0047). O
// escritório é preenchido pelo banco (gatilho preencher_escritorio) e a RLS só
// deixa ver e gravar as da própria empresa — a tela nunca manda escritorio_id.
import { supabase } from "../supabase";
import { medicaoValida } from "./aparelho.ts";
import { ErroConta, linhaDaMedicao } from "./repositorio.ts";
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

export function repositorioSupabase(): RepositorioMedicoes {
  return {
    async listar() {
      if (!supabase) throw new ErroConta("outro", "Sistema sem configuração do banco.");
      const { data, error } = await supabase.from(TABELA)
        .select("id, nome, vertices, fechada, criado_em, atualizado_em")
        .order("atualizado_em", { ascending: false })
        .limit(100);
      if (error) throw erroDe(error);
      return (data ?? [])
        .map((l) => medicaoValida({ id: l.id, nome: l.nome, vertices: l.vertices, fechada: l.fechada, criadaEm: l.criado_em, atualizadaEm: l.atualizado_em }))
        .filter((m): m is Medicao => m !== null)
        // o banco devolve a hora no formato dele; aqui volta para o ISO do aparelho (comparação por texto)
        .map((m) => ({ ...m, criadaEm: new Date(m.criadaEm).toISOString(), atualizadaEm: new Date(m.atualizadaEm).toISOString() }));
    },
    async salvar(m) {
      if (!supabase) throw new ErroConta("outro", "Sistema sem configuração do banco.");
      // o gatilho medicoes_campo_mais_nova deixa de lado a versão mais velha sem
      // erro: sem linha de volta = a conta tem uma versão mais nova
      const { data, error } = await supabase.from(TABELA).upsert(linhaDaMedicao(m), { onConflict: "id" }).select("atualizado_em");
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
