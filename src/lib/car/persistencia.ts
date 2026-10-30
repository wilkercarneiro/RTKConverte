// O que liga o CAR ao banco: o serviço nasce aqui (sem parse-txt — a entrada é
// o KML) e o projeto mora na tabela `car_projetos` (migração 0023).
import { supabase } from "../supabase";
import type { Servico } from "../types";
import type { ProjetoCar } from "./motor.ts";

/** A migração 0023 já foi aplicada? (sem ela não há onde salvar o projeto) */
export async function carDisponivel(): Promise<boolean> {
  const { error } = await supabase.from("car_projetos").select("servico_id").limit(1);
  return !error;
}

export async function carregarProjetoCar(servicoId: string): Promise<Partial<ProjetoCar> | null> {
  const { data, error } = await supabase.from("car_projetos").select("projeto").eq("servico_id", servicoId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.projeto as Partial<ProjetoCar> | undefined) ?? null;
}

export async function salvarProjetoCar(servicoId: string, projeto: ProjetoCar): Promise<void> {
  const { error } = await supabase.from("car_projetos")
    .upsert({ servico_id: servicoId, projeto, updated_at: new Date().toISOString() }, { onConflict: "servico_id" });
  if (error) throw new Error(error.message);
}

/** Cria o serviço de CAR e grava o projeto inicial. Falhou o projeto, o serviço sai junto. */
export async function criarServicoCar(dados: {
  arquivo: string; projeto: ProjetoCar; uf: string | null; municipio: string | null; clienteId?: string;
  /** pedido do GPROL que este CAR executa */
  pedidoId?: string;
  /** os créditos de CAR acabaram e a pessoa aceitou pagar com 1 crédito geral (0034) */
  usarCreditoGeral?: boolean;
}): Promise<Servico> {
  if (!(await carDisponivel())) {
    throw new Error("O banco ainda não tem a atualização do CAR (migração 0023_car). Peça para aplicá-la e tente de novo.");
  }
  let cliente: Record<string, unknown> = {};
  if (dados.clienteId) {
    const { data: c } = await supabase.from("clientes").select().eq("id", dados.clienteId).single();
    if (c) cliente = { cliente_id: c.id, detentor_nome: c.nome, detentor_cpf: c.cpf_cnpj, detentor_genero: c.genero, endereco_detentor: c.endereco };
  }
  const { data, error } = await supabase.from("servicos").insert({
    tipo: "geo", modalidade: "car", tem_glebas: false, status: "rascunho",
    nome_arquivo_txt: dados.arquivo,
    denominacao: dados.projeto.nome || null,
    uf: dados.uf, municipio: dados.municipio,
    ...cliente,
    ...(dados.pedidoId ? { pedido_externo_id: dados.pedidoId } : {}),
    ...(dados.usarCreditoGeral ? { usar_credito_geral: true } : {}),
  }).select().single();
  if (error) throw new Error(error.message);
  const servico = data as Servico;
  try {
    await salvarProjetoCar(servico.id, dados.projeto);
  } catch (e) {
    await supabase.from("servicos").delete().eq("id", servico.id);
    throw e;
  }
  return servico;
}

export async function marcarCarExportado(servicoId: string): Promise<void> {
  await supabase.from("servicos").update({ status: "gerado" }).eq("id", servicoId);
}
