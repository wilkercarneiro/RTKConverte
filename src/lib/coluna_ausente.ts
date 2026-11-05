// Gravar quando o banco ainda não tem a coluna nova.
//
// O site vai ao ar antes (ou sem) a migração que cria a coluna: o PostgREST
// recusa o insert/update INTEIRO por causa de um campo que ele não conhece. Aqui
// a gravação é refeita sem os campos ausentes, e quem chamou fica sabendo quais
// ficaram de fora (para avisar a pessoa, uma vez).

export interface ErroBanco { code?: string; message?: string; details?: string | null; hint?: string | null }

/**
 * O erro diz que `coluna` não existe? Cobre as duas formas:
 * - PostgREST (PGRST204): "Could not find the 'x' column of 't' in the schema cache";
 * - Postgres (42703): `column "x" of relation "t" does not exist` / `column t.x does not exist`.
 */
export function erroColunaAusente(e: ErroBanco | null | undefined, coluna: string): boolean {
  if (!e) return false;
  const txt = `${e.message ?? ""} ${e.details ?? ""} ${e.hint ?? ""}`;
  if (!txt.includes(coluna)) return false;
  if (e.code === "PGRST204" || e.code === "42703") return true;
  return /could not find the .* column|column .* does not exist/i.test(txt);
}

/**
 * Grava `dados`; se o banco recusar por uma das `opcionais` não existir, tira
 * esse campo e tenta de novo (uma vez por campo). Devolve o resultado da última
 * tentativa e os campos que ficaram de fora.
 */
export async function gravarSemColunasAusentes<D extends Record<string, unknown>, R extends { error: ErroBanco | null }>(
  dados: D,
  opcionais: readonly string[],
  gravar: (d: Partial<D>) => PromiseLike<R>,
): Promise<{ resultado: R; omitidas: string[] }> {
  const atual: Partial<D> = { ...dados };
  const omitidas: string[] = [];
  for (;;) {
    const resultado = await gravar(atual);
    const ausente = opcionais.find((c) => c in atual && erroColunaAusente(resultado.error, c));
    if (!ausente) return { resultado, omitidas };
    delete atual[ausente as keyof D];
    omitidas.push(ausente);
  }
}

/** Aviso (uma vez por tela) quando o banco não tem `servicos.monografia` (0042). */
export const AVISO_SEM_MONOGRAFIA =
  "O banco ainda não tem a coluna da monografia (migração 0042): os dados da monografia dos marcos não foram guardados. O resto do serviço foi salvo.";

/** Memória da tela: já se sabe que a coluna falta? já se avisou? */
export interface MemoColunas { semMonografia?: boolean; avisado?: boolean }

/**
 * Update do serviço que não cai inteiro por causa da monografia: banco sem a
 * coluna → grava o resto, lembra (as próximas gravações já vão sem ela) e avisa
 * uma vez. Devolve o resultado da gravação (erro de outra natureza segue nele).
 */
export async function gravarServicoTolerante<D extends Record<string, unknown>, R extends { error: ErroBanco | null }>(
  campos: D,
  gravar: (d: Partial<D>) => PromiseLike<R>,
  memo: MemoColunas,
  avisar: (msg: string) => void,
): Promise<R> {
  const dados: Partial<D> = { ...campos };
  const tinhaMonografia = dados.monografia != null;
  if (memo.semMonografia) delete dados.monografia;
  const { resultado, omitidas } = await gravarSemColunasAusentes<Partial<D>, R>(dados, ["monografia"], gravar);
  if (omitidas.length) memo.semMonografia = true;
  if (memo.semMonografia && tinhaMonografia && !resultado.error && !memo.avisado) {
    memo.avisado = true;
    avisar(AVISO_SEM_MONOGRAFIA);
  }
  return resultado;
}
