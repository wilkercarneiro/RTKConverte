// Quem assina junto com o detentor (pedido de cliente, 23/11/2026).
//
// O 1º requerente é o detentor (detentor_*). O 2º mora em requerente2_* (0004)
// e, do 3º em diante, na lista servicos.requerentes_extras (0053). Toda peça,
// memorial e planta pergunta AQUI quem são os outros — nenhum gerador lê as
// colunas direto, senão o 3º some de um documento e aparece no outro.

export interface OutroRequerente {
  nome: string;
  cpf: string;
  genero: "M" | "F";
}

interface ServicoComRequerentes {
  requerente2_nome?: string | null;
  requerente2_cpf?: string | null;
  requerente2_genero?: string | null;
  requerentes_extras?: unknown;
}

const genero = (g: unknown): "M" | "F" => (g === "F" ? "F" : "M");

/** O 2º requerente em diante, na ordem da tela; item sem nome não entra. */
export function outrosRequerentes(s: ServicoComRequerentes): OutroRequerente[] {
  const lista: OutroRequerente[] = [];
  const n2 = String(s.requerente2_nome ?? "").trim();
  if (n2) lista.push({ nome: n2, cpf: String(s.requerente2_cpf ?? "").trim(), genero: genero(s.requerente2_genero) });
  const extras = Array.isArray(s.requerentes_extras) ? s.requerentes_extras : [];
  for (const x of extras) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const nome = String(r.nome ?? "").trim();
    if (!nome) continue;
    lista.push({ nome, cpf: String(r.cpf ?? "").trim(), genero: genero(r.genero) });
  }
  return lista;
}

/** Apaga os co-requerentes (herdeiro de gleba, parte de partilha): campos a sobrescrever. */
export const SEM_OUTROS_REQUERENTES = {
  requerente2_nome: null,
  requerente2_cpf: null,
  requerente2_genero: null,
  requerentes_extras: [] as OutroRequerente[],
} as const;
