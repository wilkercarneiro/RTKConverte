// Focos de queimada do INPE em volta do imóvel. A busca passa pela função
// analise-imovel (ação "focos": o WFS do INPE não libera CORS); a separação
// "dentro do imóvel" × "até 1 km" é feita aqui, no motor de área do sistema.
import type { Foco } from "../../../supabase/functions/analise-imovel/logica.ts";
import { caixaComMargem, distanciaAoImovelM, fusoDaArea } from "./geometria.ts";
import type { Caixa, LonLat } from "./geometria.ts";

export type { Foco };

export const RAIO_FOCOS_M = 1000;

export interface FocoPerto extends Foco { distanciaM: number }

export interface FocosDoImovel {
  desde: string;
  raioM: number;
  /** todos os satélites (um incêndio pode aparecer em vários) */
  dentro: FocoPerto[];
  perto: FocoPerto[];
  /** só o satélite de referência do INPE (a série comparável de ano a ano) */
  referenciaDentro: number;
  referenciaPerto: number;
  ultimo: string | null;
}

/** A caixa e a data de 12 meses atrás que a tela manda para a função. */
export function pedidoFocos(aneis: LonLat[][], agora = new Date(), raioM = RAIO_FOCOS_M): { caixa: Caixa; desde: string } {
  const desde = new Date(agora.getTime() - 365 * 864e5).toISOString().slice(0, 10);
  return { caixa: caixaComMargem(aneis, raioM + 150), desde };
}

export function classificarFocos(r: { todos: Foco[]; referencia: Foco[] }, aneis: LonLat[][], desde: string, raioM = RAIO_FOCOS_M): FocosDoImovel {
  const fuso = fusoDaArea(aneis);
  const medir = (fs: Foco[]) => fs.map((f) => ({ ...f, distanciaM: distanciaAoImovelM([f.lon, f.lat], aneis, fuso) })).filter((f) => f.distanciaM <= raioM);
  const todos = medir(r.todos), ref = medir(r.referencia);
  const dentro = todos.filter((f) => f.distanciaM === 0), perto = todos.filter((f) => f.distanciaM > 0).sort((a, b) => a.distanciaM - b.distanciaM);
  return {
    desde, raioM, dentro, perto,
    referenciaDentro: ref.filter((f) => f.distanciaM === 0).length,
    referenciaPerto: ref.filter((f) => f.distanciaM > 0).length,
    ultimo: todos.map((f) => f.quando).sort().pop() ?? null,
  };
}

const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

/** A frase do cartão: "Nenhum foco nos últimos 12 meses" / "3 focos dentro do imóvel · 7 a até 1 km · último em 21/06/2026". */
export function textoFocos(f: FocosDoImovel): string {
  if (!f.dentro.length && !f.perto.length) return `Nenhum foco de queimada nos últimos 12 meses, dentro do imóvel nem a até ${f.raioM / 1000} km`;
  const p: string[] = [];
  if (f.dentro.length) p.push(`${f.dentro.length} ${f.dentro.length === 1 ? "foco" : "focos"} dentro do imóvel`);
  else p.push("nenhum foco dentro do imóvel");
  if (f.perto.length) p.push(`${f.perto.length} a até ${f.raioM / 1000} km`);
  if (f.ultimo) p.push(`último em ${dataBr(f.ultimo)}`);
  const t = p.join(" · ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
