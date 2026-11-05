// Contorno assinado (migração 0039): 1 crédito = 1 imóvel.
//
// Toda geração oficial passa por `conferirContorno` ANTES de gerar: a primeira
// grava o contorno do imóvel; as seguintes precisam ser o mesmo imóvel (metade
// ou mais em comum com o contorno da primeira). Falha FECHA: sem a conferência,
// a geração não sai — é a trava do crédito, não um extra.

/** Anel em lon/lat (grau). Pode vir aberto ou fechado. */
export type AnelLonLat = [number, number][];

export interface ClienteContorno {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
}

/** "-39°05'04,737\"" (tabela do PDF do SIGEF) → grau decimal, ou NaN. */
export function grauDoPdf(s: string): number {
  const m = String(s ?? "").match(/(-?)(\d+)°(\d+)'([\d,.]+)"/);
  if (!m) return NaN;
  const v = parseInt(m[2], 10) + parseInt(m[3], 10) / 60 + parseFloat(m[4].replace(",", ".")) / 3600;
  return m[1] === "-" ? -v : v;
}

/** Linhas da tabela de coordenadas do SIGEF → anel lon/lat. */
export const anelDoSigef = (linhas: { lon: string; lat: string }[]): AnelLonLat =>
  linhas.map((l): [number, number] => [grauDoPdf(l.lon), grauDoPdf(l.lat)]);

/** Anéis → GeoJSON MultiPolygon (cada anel é um polígono; o banco une). Anel com menos de 3 pontos sai. */
export function geojsonDosAneis(aneis: AnelLonLat[]): { type: "MultiPolygon"; coordinates: number[][][][] } | null {
  const polis: number[][][][] = [];
  for (const anel of aneis) {
    const pts = anel.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (pts.length < 3) continue;
    const [a, z] = [pts[0], pts[pts.length - 1]];
    const fechado = a[0] === z[0] && a[1] === z[1] ? pts : [...pts, a];
    if (fechado.length < 4) continue;
    polis.push([fechado.map((p) => [p[0], p[1]])]);
  }
  return polis.length ? { type: "MultiPolygon", coordinates: polis } : null;
}

/**
 * null = pode gerar. Senão, a recusa ({erro, status}) para devolver ao cliente.
 * Sem anel legível (dado legado), libera sem assinar — o banco faz o mesmo.
 */
export async function conferirContorno(
  svc: ClienteContorno, servicoId: string, aneis: AnelLonLat[],
): Promise<{ erro: string; status: number } | null> {
  const geojson = geojsonDosAneis(aneis);
  if (!geojson) return null;
  const { data, error } = await svc.rpc("conferir_contorno", { p_servico: servicoId, p_geojson: geojson });
  if (error) {
    return { erro: "Não foi possível conferir o imóvel deste serviço agora. Tente de novo em instantes.", status: 503 };
  }
  const r = (data ?? {}) as { ok?: boolean; motivo?: string };
  if (r.ok) return null;
  return { erro: r.motivo ?? "Este serviço não pode gerar para outro imóvel.", status: 409 };
}
