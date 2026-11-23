// Requerentes que assinam junto com o detentor (pedido de cliente, 23/11/2026).
//
// Na tela é uma lista só: "Quantos requerentes assinam?" e uma linha por pessoa
// a partir do 2º. No banco a 1ª linha mora nas colunas requerente2_* (0004) e o
// resto em requerentes_extras (0053) — estas funções traduzem os dois lados.
// O servidor lê pelo mesmo critério (supabase/functions/_shared/requerentes.ts).

export interface RequerenteTela {
  nome: string;
  cpf: string;
  genero: "M" | "F";
}

/** Total máximo de quem assina (detentor + 11): a 0053 aceita até 10 extras. */
export const MAX_REQUERENTES = 12;

interface ServicoRequerentes {
  requerente2_nome: string | null;
  requerente2_cpf: string | null;
  requerente2_genero: "M" | "F" | null;
  requerentes_extras?: RequerenteTela[] | null;
}

const gen = (g: unknown): "M" | "F" => (g === "F" ? "F" : "M");

/** As linhas da tela (2º requerente em diante) a partir do serviço salvo. */
export function linhasDoServico(s: ServicoRequerentes): RequerenteTela[] {
  const extras = (Array.isArray(s.requerentes_extras) ? s.requerentes_extras : [])
    .filter((x): x is RequerenteTela => !!x && typeof x === "object")
    .map((x) => ({ nome: String(x.nome ?? ""), cpf: String(x.cpf ?? ""), genero: gen(x.genero) }));
  const temSegundo = !!(s.requerente2_nome ?? "").trim() || !!(s.requerente2_cpf ?? "").trim() || extras.length > 0;
  return temSegundo
    ? [{ nome: s.requerente2_nome ?? "", cpf: s.requerente2_cpf ?? "", genero: gen(s.requerente2_genero) }, ...extras]
    : [];
}

/** O que gravar no serviço para estas linhas. */
export function camposDasLinhas(linhas: RequerenteTela[]): ServicoRequerentes & { requerentes_extras: RequerenteTela[] } {
  const [r2, ...extras] = linhas;
  return {
    requerente2_nome: r2?.nome.trim() ? r2.nome : null,
    requerente2_cpf: r2?.cpf.trim() ? r2.cpf : null,
    requerente2_genero: r2 ? r2.genero : null,
    requerentes_extras: extras.slice(0, MAX_REQUERENTES - 2).map((r) => ({ nome: r.nome, cpf: r.cpf, genero: r.genero })),
  };
}

/** As linhas para um total de `total` requerentes (o detentor conta como 1). */
export function comQuantidade(linhas: RequerenteTela[], total: number): RequerenteTela[] {
  const n = Math.max(0, Math.min(MAX_REQUERENTES, Math.floor(total)) - 1);
  if (linhas.length >= n) return linhas.slice(0, n);
  return [...linhas, ...Array.from({ length: n - linhas.length }, () => ({ nome: "", cpf: "", genero: "M" as const }))];
}

/** Quem tem nome entre as linhas que somem ao diminuir a quantidade. */
export function quemSaiAoReduzir(linhas: RequerenteTela[], total: number): string[] {
  return linhas.slice(Math.max(0, total - 1)).map((r) => r.nome.trim()).filter(Boolean);
}

/** Total de quem assina, contando o detentor (para o selo da seção). */
export function totalQueAssina(linhas: RequerenteTela[]): number {
  return 1 + linhas.filter((r) => r.nome.trim()).length;
}

/** Ordinal da pessoa na lista (2 → "2º"). */
export const ordinal = (n: number) => `${n}º`;
