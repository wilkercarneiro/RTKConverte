// Regras puras do pedido do GPROL (sem Supabase): testáveis no Node.

export interface DadosPedido { fazenda?: string; local?: string; area_m2?: number; observacoes?: string; cliente_gprol?: string; criado_em?: string }

const UFS = new Set(["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"]);

/**
 * O que o pedido do GPROL já sabe e o serviço novo ainda não: denominação (a
 * fazenda) e município/UF ("Feira de Santana/BA", "Feira de Santana - BA").
 * Nunca sobrescreve o que já está preenchido.
 */
export function camposDoPedido(d: DadosPedido | null | undefined,
  s: { denominacao?: string | null; municipio?: string | null; uf?: string | null }): Record<string, string> {
  const saida: Record<string, string> = {};
  if (!d) return saida;
  const fazenda = (d.fazenda ?? "").trim();
  if (fazenda && !(s.denominacao ?? "").trim()) saida.denominacao = fazenda;
  const local = (d.local ?? "").trim();
  if (local) {
    const m = local.match(/^(.*?)\s*(?:\/|-|,)\s*([A-Za-z]{2})$/);
    const municipio = (m ? m[1] : local).trim();
    const uf = m && UFS.has(m[2].toUpperCase()) ? m[2].toUpperCase() : null;
    if (municipio && !(s.municipio ?? "").trim()) saida.municipio = municipio;
    if (uf && !(s.uf ?? "").trim()) saida.uf = uf;
  }
  return saida;
}
