// Frases do resultado, iguais na tela e no PDF.
import type { ResultadoTerraplanagem } from "./calculo.ts";
import { fmtN } from "./calculo.ts";
import type { ProjetoTerraplanagem } from "./modelo.ts";

/** Rumo do azimute (para onde a água escorre). */
export function rumo(az: number): string {
  const n = ["norte", "nordeste", "leste", "sudeste", "sul", "sudoeste", "oeste", "noroeste"];
  return n[Math.round((((az % 360) + 360) % 360) / 45) % 8];
}

const m3 = (v: number) => `${fmtN(v, v >= 100 ? 0 : 1)} m³`;

/** O que fazer com o saldo: equilibrado, sobra para bota-fora ou falta (empréstimo). */
export function textoSaldo(r: ResultadoTerraplanagem): string {
  if (r.caminhoes.para === "interno") return "o corte cobre o aterro, sem trazer nem tirar terra";
  if (r.saldo > 0) return `sobram ${m3(r.saldo)} de corte: bota-fora`;
  return `faltam ${m3(-r.saldo)} para o aterro: empréstimo`;
}

/** Para que servem os caminhões. `curto` = para o cartão do PDF. */
export function textoCaminhoes(r: ResultadoTerraplanagem, pr: ProjetoTerraplanagem, curto = false): string {
  const cap = `${fmtN(pr.fatores.caminhao, 0)} m³`;
  const emp = `${fmtN(pr.fatores.empolamento, 0)}%`;
  const solto = m3(r.caminhoes.volumeSolto);
  if (r.caminhoes.para === "interno") return curto ? `de ${cap}, levando o corte ao aterro (empolamento ${emp})` : `viagens de ${cap} para levar o corte ao aterro — ${solto} soltos, com empolamento de ${emp}`;
  if (r.caminhoes.para === "bota-fora") return curto ? `de ${cap} para o bota-fora (empolamento ${emp})` : `caminhões de ${cap} para tirar a sobra — ${solto} soltos, com empolamento de ${emp}`;
  return curto ? `de ${cap} trazendo terra (empolamento ${emp})` : `caminhões de ${cap} trazendo terra de empréstimo — ${solto} soltos, com empolamento de ${emp}`;
}
