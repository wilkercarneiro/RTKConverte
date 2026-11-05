// O que liga o loteamento ao resto do sistema: o perímetro sai dos vértices do
// serviço (o mesmo TXT que alimenta memorial e planta) e o projeto mora na
// tabela `loteamentos` (migração 0021). O cálculo do perímetro e do projeto
// inicial fica em perimetro.ts (o servidor usa o mesmo, ver função `entregar`).
import { supabase } from "../supabase";
import type { Projeto } from "./modelo.ts";

export { nomeConfrontante, perimetroDoServico, projetoInicial } from "./perimetro.ts";

/** A migração 0021 já foi aplicada? (sem ela não há onde salvar o projeto) */
export async function loteamentoDisponivel(): Promise<boolean> {
  const { error } = await supabase.from("loteamentos").select("servico_id").limit(1);
  return !error;
}

export async function carregarProjeto(servicoId: string): Promise<Partial<Projeto> | null> {
  const { data, error } = await supabase.from("loteamentos").select("projeto").eq("servico_id", servicoId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.projeto as Partial<Projeto> | undefined) ?? null;
}

export async function salvarProjeto(servicoId: string, projeto: Projeto): Promise<void> {
  const { error } = await supabase.from("loteamentos")
    .upsert({ servico_id: servicoId, projeto, updated_at: new Date().toISOString() }, { onConflict: "servico_id" });
  if (error) throw new Error(error.message);
}
