// Auditoria de uso (0029): cada sessão do app vira uma linha em `acessos` —
// quem entrou, de onde (IP pelo servidor, navegador e aparelho daqui), até
// quando ficou e quantas telas abriu. O banco junta as chamadas da mesma
// sessão (mesmo navegador e IP em menos de 30 min).
import { useEffect } from "react";
import { supabase } from "./supabase";
import { descreverNavegador } from "./suporte";

const INTERVALO = 5 * 60_000;
let ultimo = 0;
let ultimaTela = "";

function registrar(tela: string, forcar = false) {
  const agora = Date.now();
  // troca de tela conta logo; parado na mesma tela, um sinal a cada 5 min
  if (!forcar && tela === ultimaTela && agora - ultimo < INTERVALO) return;
  ultimo = agora;
  ultimaTela = tela;
  const d = descreverNavegador(navigator.userAgent);
  // sem a 0029 a RPC não existe: falha calada, nunca atrapalha a tela
  void supabase.rpc("registrar_acesso", {
    p_navegador: d.navegador, p_sistema: d.sistema, p_dispositivo: d.dispositivo, p_tela: tela,
  }).then(() => undefined, () => undefined);
}

/** Liga o registro enquanto há sessão; `tela` é a rota atual (t da Rota). */
export function useRegistroDeAcesso(ativo: boolean, tela: string): void {
  useEffect(() => { if (ativo) registrar(tela); }, [ativo, tela]);
  useEffect(() => {
    if (!ativo) return;
    const pulso = () => { if (document.visibilityState === "visible") registrar(ultimaTela, Date.now() - ultimo >= INTERVALO); };
    const t = window.setInterval(pulso, INTERVALO);
    document.addEventListener("visibilitychange", pulso);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", pulso); };
  }, [ativo]);
}

export interface Sessao {
  id: number; user_id: string; quem: string; em: string; ultimo_em: string; ip: string | null;
  navegador: string | null; sistema: string | null; dispositivo: string | null; telas: number; ultima_tela: string | null;
}
export interface UsoPessoa {
  user_id: string; nome: string; email: string; ativo: boolean; sessoes: number; minutos: number; ultimo_acesso: string | null;
  servicos_criados: number; documentos: number; alteracoes: number; clientes: number;
}

export async function listarAcessos(limite = 100, filtro: { user?: string; antes?: string } = {}): Promise<Sessao[]> {
  const { data, error } = await supabase.rpc("listar_acessos", { p_limite: limite, p_user: filtro.user ?? null, p_antes: filtro.antes ?? null });
  if (error) throw new Error(error.message);
  return (data as Sessao[]) ?? [];
}

export async function usoDaEquipe(dias = 30): Promise<UsoPessoa[]> {
  const { data, error } = await supabase.rpc("uso_da_equipe", { p_dias: dias });
  if (error) throw new Error(error.message);
  return (data as UsoPessoa[]) ?? [];
}

/** "1 h 20 min", "35 min". */
export function duracao(min: number): string {
  if (min < 60) return `${Math.max(1, Math.round(min))} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Nome legível da tela registrada. */
const TELAS: Record<string, string> = {
  inicio: "Início", servicos: "Serviços", servico: "Serviço", clientes: "Clientes", cliente: "Cliente",
  config: "Configurações", equipe: "Equipe", ajuda: "Ajuda", novo: "Novo serviço", admin: "Painel SaaS",
};
export const rotuloTela = (t: string | null) => (t ? TELAS[t] ?? t : "—");

/** Baixa uma tabela como CSV (Excel abre direto: separador ";" e BOM). */
export function baixarCsv(nome: string, cabecalho: string[], linhas: (string | number | null | undefined)[][]): void {
  const cel = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = "﻿" + [cabecalho, ...linhas].map((l) => l.map(cel).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
