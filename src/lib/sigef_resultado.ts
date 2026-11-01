// Resposta da consulta de sobreposição (RPC sigef_consultar) sempre no formato
// que a tela lê. Uma resposta incompleta — sem `parcelas`, ou `sobreposicoes`
// fora de lista — derrubava o painel com "reading 'features'" e, antes da
// barreira de erro (BarreiraErro), apagava a tela inteira da conferência.
// Módulo puro (sem o cliente do Supabase) para rodar nos testes em Node.
import type { ResultadoSigef } from "./sigef";

export function normalizarResultadoSigef(data: unknown): ResultadoSigef {
  const r = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Partial<ResultadoSigef>;
  const feats = r.parcelas && Array.isArray(r.parcelas.features) ? r.parcelas.features : [];
  return {
    ...r,
    parcelas: { type: "FeatureCollection", features: feats },
    sobreposicoes: Array.isArray(r.sobreposicoes) ? r.sobreposicoes : [],
    ...(r.encostos !== undefined ? { encostos: Array.isArray(r.encostos) ? r.encostos : [] } : {}),
  } as ResultadoSigef;
}
