// Integração com o GPROL, do lado da tela: estado da conexão, pedidos a
// executar e o gatilho do sincronismo.
//
// Quem sincroniza é a edge function `gprol` (empurra a fila, puxa as mudanças).
// A tela só a chama: ao abrir as telas principais, depois de criar serviço ou
// gerar documento (gancho em `chamarFuncao`) e, com o app aberto, a cada poucos
// minutos. Cada rodada termina avisando as telas (evento `gprol:mudou`) para
// relerem pedidos e etapas.
import { useEffect, useState } from "react";
import { aoChamarFuncao, chamarFuncao, supabase } from "./supabase";
import { chaveDoServico } from "./modalidades";
import type { ChaveServico } from "./modalidades";
import type { DadosPedido } from "./pedidoGprol";
export { camposDoPedido } from "./pedidoGprol";
export type { DadosPedido } from "./pedidoGprol";

export interface IntegracaoGprol {
  status: "ativa" | "desconectada";
  empresa_externa_nome: string | null;
  conectado_em: string | null;
  desconectado_em: string | null;
  ultima_sincronizacao: string | null;
  ultimo_erro: string | null;
  resumo: { clientes_ligados?: number; clientes_criados?: number; pedidos?: number; aviso?: string | null } | null;
}

export type StatusPedido = "pendente" | "em_execucao" | "entregue" | "cancelado" | "descartado";

export interface PedidoGprol {
  id: string;
  externo_id: string;
  origem: "gprol" | "vertces";
  cliente_id: string | null;
  titulo: string | null;
  nome_servico: string | null;
  modalidades: string[];
  dados: DadosPedido;
  etapa: string | null;
  status: StatusPedido;
  recebido_em: string;
  atualizado_em: string;
}

export const MUDOU = "gprol:mudou";

/** Onde fica o GPROL (a conexão vem do servidor; a configuração abre direto). */
export const GPROL_APP = "https://app.gprol.com.br";

/**
 * Tela do GPROL que reconfigura a sincronização (funil, marcos → etapas, tipos →
 * modalidades): a mesma da conexão. Só o admin de lá salva; volta para cá com
 * `?gprol_config=ok`.
 */
export function urlConfigurarGprol(escritorioId: string, escritorioNome: string): string {
  const u = new URL("/integracoes/vertces/configurar", GPROL_APP);
  u.searchParams.set("escritorio_id", escritorioId);
  u.searchParams.set("escritorio", escritorioNome);
  return u.toString();
}

/** Chama uma ação da função `gprol`. */
export const gprol = <T = Record<string, unknown>>(acao: string, corpo: Record<string, unknown> = {}) =>
  chamarFuncao<T>("gprol", { acao, ...corpo });

// ------------------------------------------------------------------ conexão
let conectadoCache: boolean | null = null;

export async function lerIntegracao(): Promise<IntegracaoGprol | null> {
  const { data } = await supabase.from("integracoes")
    .select("status, empresa_externa_nome, conectado_em, desconectado_em, ultima_sincronizacao, ultimo_erro, resumo")
    .eq("provedor", "gprol").maybeSingle();
  const i = (data as IntegracaoGprol | null) ?? null;
  conectadoCache = i?.status === "ativa";
  return i;
}

/** Estado da conexão, relido quando o sincronismo avisa. */
export function useIntegracaoGprol(): { integracao: IntegracaoGprol | null; carregando: boolean; recarregar: () => void } {
  const [integracao, setIntegracao] = useState<IntegracaoGprol | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [vez, setVez] = useState(0);
  useEffect(() => {
    let vivo = true;
    lerIntegracao().then((i) => { if (vivo) { setIntegracao(i); setCarregando(false); } })
      .catch(() => { if (vivo) setCarregando(false); });
    const f = () => setVez((v) => v + 1);
    addEventListener(MUDOU, f);
    return () => { vivo = false; removeEventListener(MUDOU, f); };
  }, [vez]);
  return { integracao, carregando, recarregar: () => setVez((v) => v + 1) };
}

// ------------------------------------------------------------------ sincronismo
let timer: ReturnType<typeof setTimeout> | null = null;
let rodando = false;
let pedidaDeNovo = false;
let ultimaRodada = 0;
/** Navegar entre telas não sincroniza mais que isso (a VPS é compartilhada). */
const INTERVALO_MINIMO_MS = 20_000;

/**
 * Agenda uma rodada (junta chamadas próximas). Sem conexão, não faz nada.
 * `forcar`: depois de uma ação (serviço criado, documento gerado, pedido ligado)
 * vai mesmo que tenha sincronizado há pouco; só navegar respeita o intervalo.
 */
export function sincronizarGprol(atrasoMs = 1200, forcar = false): void {
  if (conectadoCache === false) return;
  if (!forcar && Date.now() - ultimaRodada < INTERVALO_MINIMO_MS) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void rodar(); }, atrasoMs);
}

async function rodar() {
  if (rodando) { pedidaDeNovo = true; return; }
  rodando = true;
  try {
    if (conectadoCache === null) await lerIntegracao();
    if (!conectadoCache) return;
    ultimaRodada = Date.now();
    await gprol("sincronizar");
  } catch {
    // o erro fica gravado na integração (ultimo_erro) e aparece em Configurações
  } finally {
    rodando = false;
    dispatchEvent(new Event(MUDOU));
    if (pedidaDeNovo) { pedidaDeNovo = false; sincronizarGprol(500, true); }
  }
}

/** Esquece o estado guardado (logout, conectar/desconectar). */
export function esquecerConexaoGprol() { conectadoCache = null; }

// gerar documento / criar serviço → leva ao GPROL logo depois
const FUNCOES_QUE_MUDAM = new Set(["parse-txt", "gerar-documentos", "gerar-pecas", "gerar-planta"]);
aoChamarFuncao((nome) => { if (FUNCOES_QUE_MUDAM.has(nome)) sincronizarGprol(1200, true); });

/** Com o app aberto e visível: uma rodada a cada 3 min (traz pedidos novos sem recarregar). */
export function useSincronismoPeriodico(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    sincronizarGprol(800, true);
    const id = setInterval(() => { if (document.visibilityState === "visible") sincronizarGprol(0, true); }, 180_000);
    const aoVoltar = () => { if (document.visibilityState === "visible") sincronizarGprol(300); };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [ativo]);
}

// ------------------------------------------------------------------ pedidos
/** Pedidos abertos (pendentes ou em execução), do escritório ou de um cliente. */
export function usePedidosGprol(clienteId?: string): { pedidos: PedidoGprol[] | null; erro: string | null; recarregar: () => void } {
  const [pedidos, setPedidos] = useState<PedidoGprol[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [vez, setVez] = useState(0);
  useEffect(() => {
    let vivo = true;
    let q = supabase.from("pedidos_externos").select("*").in("status", ["pendente", "em_execucao"])
      .order("recebido_em", { ascending: false }).limit(100);
    if (clienteId) q = q.eq("cliente_id", clienteId);
    q.then(({ data, error }) => {
      if (!vivo) return;
      // tabela ainda inexistente (banco sem a 0028) = sem integração, não é erro para o usuário
      if (error && !/pedidos_externos/.test(error.message)) setErro(error.message);
      setPedidos((data as PedidoGprol[] | null) ?? []);
    });
    const f = () => setVez((v) => v + 1);
    addEventListener(MUDOU, f);
    return () => { vivo = false; removeEventListener(MUDOU, f); };
  }, [clienteId, vez]);
  return { pedidos, erro, recarregar: () => setVez((v) => v + 1) };
}

/** Modalidades do pedido que já têm serviço aqui (para os selos "feito / a fazer"). */
export async function modalidadesFeitas(pedidoIds: string[]): Promise<Record<string, string[]>> {
  if (!pedidoIds.length) return {};
  const { data } = await supabase.from("servicos").select("pedido_externo_id, tipo, modalidade, tem_glebas, divisao, origem_id")
    .in("pedido_externo_id", pedidoIds);
  const saida: Record<string, string[]> = {};
  for (const s of (data ?? []) as { pedido_externo_id: string; origem_id: string | null }[]) {
    if (s.origem_id) continue; // gleba/parte não é modalidade nova
    (saida[s.pedido_externo_id] ??= []).push(chaveDoServico(s as never));
  }
  return saida;
}

/** Modalidades do pedido que ainda não têm serviço. */
export function modalidadesAFazer(p: PedidoGprol, feitas: string[] = []): ChaveServico[] {
  return (p.modalidades as ChaveServico[]).filter((m) => !feitas.includes(m));
}

export const ROTULO_ETAPA_PEDIDO: Record<StatusPedido, string> = {
  pendente: "A executar",
  em_execucao: "Em execução",
  entregue: "Entregue",
  cancelado: "Cancelado no GPROL",
  descartado: "Descartado",
};
