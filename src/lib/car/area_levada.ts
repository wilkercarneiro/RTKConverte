// A área que chegou de uma ferramenta (Medir no campo, Consultar imóvel) no
// CAR novo. Princípio 4 do plano: o MESMO polígono mostra o MESMO número em
// todas as telas. O motor único do sistema (UTM no fuso do lugar + Gauss,
// src/lib/consulta/geometria.ts) é o número de cabeça; o do motor do CAR
// (projeção de área igual colada no imóvel) aparece com o rótulo da
// projeção, porque as porcentagens de reserva e APP saem dele. Atenção: no CAR
// de Lençóis a área DECLARADA no SICAR (743,8531 ha) bate com o motor único,
// não com a projeção de área igual (743,4215 ha) — por isso o rótulo não diz
// "a do SICAR".
import { fmtAreaCurta, fmtHa, fmtNum, medir } from "../consulta/geometria.ts";
import type { LonLat } from "../consulta/geometria.ts";

export interface TextosAreaLevada {
  /** a área no motor único: a mesma que a tela de origem mostrou */
  areaM2: number;
  /** "No módulo do CAR (…): 2,7532 ha, 21 m² a mais…" — null quando é igual */
  linhaCar: string | null;
  /** "Levada a maior parte: 743,42 de 743,85 ha…" — null quando a área tinha uma parte só */
  linhaPartes: string | null;
}

function diferenca(m2: number): string {
  const a = Math.abs(m2);
  return a >= 10_000 ? `${fmtNum(a / 10_000, 4)} ha` : `${fmtNum(a, a < 10 ? 1 : 0)} m²`;
}

export function textosDaAreaLevada(perimetro: LonLat[], areaCarM2: number, origem: { areaOrigemM2?: number; partes?: number } = {}): TextosAreaLevada {
  const areaM2 = medir([perimetro]).areaM2;
  const d = areaCarM2 - areaM2;
  const linhaCar = Math.abs(d) < 0.5 ? null
    : `No módulo do CAR (projeção de área igual): ${fmtHa(areaCarM2)}, ${diferenca(d)} a ${d > 0 ? "mais" : "menos"} só pela projeção. As porcentagens de reserva legal e APP saem desse cálculo.`;
  const partes = origem.partes ?? 1;
  const total = origem.areaOrigemM2;
  const linhaPartes = partes > 1 && total != null && total - areaM2 >= 0.5
    ? `Levada a maior parte: ${fmtAreaCurta(areaM2)} de ${fmtAreaCurta(total)}. O CAR é um polígono só; ${partes - 1 === 1 ? "a outra parte" : `as outras ${partes - 1} partes`} (${diferenca(total - areaM2)}) ${partes - 1 === 1 ? "ficou" : "ficaram"} de fora.`
    : null;
  return { areaM2, linhaCar, linhaPartes };
}
