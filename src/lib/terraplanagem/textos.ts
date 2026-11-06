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
  if (r.corte < 0.05 && r.aterro < 0.05) return "o terreno já está na cota: sem corte nem aterro";
  if (r.caminhoes.para === "interno") return "o corte cobre o aterro, sem trazer nem tirar terra";
  if (r.saldo > 0) return `sobram ${m3(r.saldo)} de corte: bota-fora`;
  return `faltam ${m3(-r.saldo)} para o aterro: empréstimo`;
}

/** Para que servem os caminhões. `curto` = para o cartão do PDF. */
export function textoCaminhoes(r: ResultadoTerraplanagem, pr: ProjetoTerraplanagem, curto = false): string {
  const cap = `${fmtN(pr.fatores.caminhao, 0)} m³`;
  const emp = `${fmtN(pr.fatores.empolamento, 0)}%`;
  const solto = m3(r.caminhoes.volumeSolto);
  if (r.caminhoes.quantidade === 0) return curto ? `nenhuma viagem de ${cap}` : "nenhum caminhão: não há terra para mover";
  if (r.caminhoes.para === "interno") return curto ? `de ${cap}, levando o corte ao aterro (empolamento ${emp})` : `viagens de ${cap} para levar o corte ao aterro — ${solto} soltos, com empolamento de ${emp}`;
  if (r.caminhoes.para === "bota-fora") return curto ? `de ${cap} para o bota-fora (empolamento ${emp})` : `caminhões de ${cap} para tirar a sobra — ${solto} soltos, com empolamento de ${emp}`;
  return curto ? `de ${cap} trazendo terra (empolamento ${emp})` : `caminhões de ${cap} trazendo terra de empréstimo — ${solto} soltos, com empolamento de ${emp}`;
}

/** O que a tela pode oferecer agora — puro, para testar sem React. */
export interface EstadoEntrega {
  /** PDF, DXF e CSV só com um resultado que é o do projeto de agora */
  podeExportar: boolean;
  tom: "pendente" | "pronto";
  titulo: string;
  detalhe: string;
  /** o botão da faixa "e agora?" */
  acao: "pdf" | "contorno" | "recuo-automatico" | "trazer" | null;
  rotuloAcao: string | null;
}

/**
 * Estado da entrega: com erro, recalculando ou sem resultado não há o que
 * baixar; com o resultado incompleto (plataforma fora do levantamento) a faixa
 * pede o ajuste em vez de dizer "pronto" — o PDF ainda sai, com o aviso dentro.
 */
export function estadoDaEntrega(o: {
  r: ResultadoTerraplanagem | null; erro: string | null; ocupado: boolean;
  modo: ProjetoTerraplanagem["plataforma"]["modo"]; folga: number | null;
  /** desnível do terreno (m): abaixo de 1 cm é arquivo sem altitude, nunca "pronto" */
  desnivel?: number;
}): EstadoEntrega {
  const { r, erro, ocupado, modo, folga } = o;
  const ajuste = (): Pick<EstadoEntrega, "acao" | "rotuloAcao"> => modo !== "contorno"
    ? { acao: "contorno", rotuloAcao: "Usar o contorno dos pontos" }
    : folga != null ? { acao: "recuo-automatico", rotuloAcao: "Recuo automático" } : { acao: null, rotuloAcao: null };
  // retângulo perdido (fora dos pontos, grande demais): trazer para cima dos pontos resolve sem perder a forma
  if (erro) return { podeExportar: false, tom: "pendente", titulo: "Ajuste a plataforma", detalhe: erro, ...(modo === "retangulo" ? { acao: "trazer" as const, rotuloAcao: "Trazer para cima dos pontos" } : ajuste()) };
  if (!r || ocupado) return { podeExportar: false, tom: "pendente", titulo: "Calculando…", detalhe: r ? "Refazendo os volumes com a mudança." : "Montando o terreno e a cota de equilíbrio.", acao: null, rotuloAcao: null };
  if (r.incompleto) {
    return {
      podeExportar: true, tom: "pendente", titulo: "A plataforma sai do levantamento",
      detalhe: `${r.incompleto.motivo} ${modo === "retangulo" ? "Arraste a plataforma para cima dos pontos ou diminua o tamanho." : modo === "poligono" ? "Use um KML dentro da área levantada ou levante mais pontos em volta." : "Aumente o recuo da borda ou levante mais pontos em volta."}`,
      ...ajuste(),
    };
  }
  if (o.desnivel != null && o.desnivel < 0.01) {
    return {
      podeExportar: true, tom: "pendente", titulo: "O terreno veio sem desnível",
      detalhe: "Todas as cotas são iguais: confira se o arquivo saiu com a altitude dos pontos. Se o terreno é plano mesmo, não há corte nem aterro a fazer.",
      acao: null, rotuloAcao: null,
    };
  }
  return { podeExportar: true, tom: "pronto", titulo: "Pronto para o cliente", detalhe: "Relatório em PDF com os números, o mapa, as duas seções e o método.", acao: "pdf", rotuloAcao: "Baixar relatório" };
}
