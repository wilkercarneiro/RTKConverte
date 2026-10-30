// Contadores do credenciado: a língua do banco × a língua de quem cadastra.
//
// O banco guarda em cada contador o PRÓXIMO número a usar — é dele que a
// geração parte (`alocar_contadores` devolve o valor de antes do incremento).
// Quem cadastra pensa no ÚLTIMO número já usado, que é o que está na última
// planilha enviada ao SIGEF. A tela fala a língua de quem usa e só converte ao
// ler e ao gravar: último usado = contador − 1, contador = último usado + 1.
//
// Contador 0 (credenciado que nasceu antes da 0031 e nunca gerou) vale como 1
// na alocação — o número 0000 nunca sai —, então o último usado dele é 0.
import type { Credenciado } from "./types";

export type CampoContador = "contador_m" | "contador_p" | "contador_v";
export const CAMPOS_CONTADOR: CampoContador[] = ["contador_m", "contador_p", "contador_v"];

/** Últimos números usados, por tipo, na língua da tela. */
export type UltimosUsados = Record<CampoContador, number>;

/** Último número já usado, a partir do contador do banco (próximo a usar). */
export function ultimoUsado(contador: number | null | undefined): number {
  const c = Math.trunc(Number(contador) || 0);
  return Math.max(c, 1) - 1;
}

/** Contador do banco (próximo a usar), a partir do último número usado. */
export function contadorDoUltimo(ultimo: number): number {
  const u = Math.trunc(Number(ultimo) || 0);
  return Math.max(u, 0) + 1;
}

/** Os três últimos usados de um credenciado (ou de um novo: nenhum usado). */
export function ultimosDe(c: Pick<Credenciado, CampoContador> | null): UltimosUsados {
  return {
    contador_m: c ? ultimoUsado(c.contador_m) : 0,
    contador_p: c ? ultimoUsado(c.contador_p) : 0,
    contador_v: c ? ultimoUsado(c.contador_v) : 0,
  };
}

/**
 * Os contadores que o formulário grava.
 *
 * Credenciado novo: os três (último usado 0 → contador 1 → o primeiro vértice
 * sai M-0001). Edição: SÓ o que o operador mudou. Gravar os três sempre
 * devolvia ao banco o valor de quando o formulário abriu — se uma geração
 * andou o contador nesse meio-tempo, salvar o nome do credenciado rebobinava
 * a sequência e os próximos vértices repetiam números já emitidos.
 */
export function contadoresParaGravar(
  original: Pick<Credenciado, CampoContador> | null,
  ultimos: UltimosUsados,
): Partial<Record<CampoContador, number>> {
  const antes = ultimosDe(original);
  const out: Partial<Record<CampoContador, number>> = {};
  for (const k of CAMPOS_CONTADOR) {
    if (!original || ultimos[k] !== antes[k]) out[k] = contadorDoUltimo(ultimos[k]);
  }
  return out;
}
