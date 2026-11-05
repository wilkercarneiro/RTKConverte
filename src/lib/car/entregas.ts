// Os arquivos do CAR (shapefiles do SICAR e os KML). Desde a auditoria de
// 04/11/2026 eles saem do SERVIDOR (função `entregar`): o projeto vem do banco
// (car_projetos), o perímetro do imóvel é conferido contra o contorno assinado
// do serviço (0039) e só então os arquivos são montados. A tela só pede e baixa.
import { calcularCar, normalizarProjetoCar, projetoNovo } from "./motor.ts";
import type { ProjetoCar } from "./motor.ts";
import { CAMADAS, gerarKmlCar, gerarKmlVegetacao, nomeArquivo, zipCompleto, zipDaCamada } from "./saidas.ts";
import type { CamadaCar, DadosVegetacao } from "./saidas.ts";

export type SaidaCar = CamadaCar | "tudo" | "kml" | "kml-vegetacao";
export const SAIDAS_CAR: SaidaCar[] = [...CAMADAS.map((c) => c.id), "tudo", "kml", "kml-vegetacao"];

export interface Arquivo { dados: Uint8Array; nome: string; tipo: string }

const texto = (s: string) => new TextEncoder().encode(s);

/** O projeto salvo, normalizado como a tela faz ao abrir o serviço. */
export function projetoCarDoBanco(salvo: Partial<ProjetoCar> | null, denominacao: string | null | undefined): ProjetoCar {
  return normalizarProjetoCar(salvo, projetoNovo(denominacao ?? "Imóvel", []));
}

/** Gera um arquivo do CAR. Quem chama já conferiu acesso, crédito e contorno. */
export async function arquivoDoCar(saida: SaidaCar, projeto: ProjetoCar, dados: DadosVegetacao): Promise<Arquivo> {
  if (projeto.perimetro.length < 3) throw new Error("O projeto deste serviço não tem o perímetro do imóvel.");
  const res = calcularCar(projeto);
  const base = nomeArquivo(projeto.nome);
  if (saida === "kml") return { dados: texto(gerarKmlCar(projeto, res)), nome: `${base}_CAR.kml`, tipo: "application/vnd.google-earth.kml+xml" };
  if (saida === "kml-vegetacao") return { dados: texto(gerarKmlVegetacao(projeto, res, dados)), nome: `${base}_VEGETACAO_NATIVA.kml`, tipo: "application/vnd.google-earth.kml+xml" };
  if (saida === "tudo") return { dados: new Uint8Array(await (await zipCompleto(projeto, res, dados)).arrayBuffer()), nome: `${base}_CAR.zip`, tipo: "application/zip" };
  const camada = CAMADAS.find((c) => c.id === saida);
  if (!camada) throw new Error("Arquivo de CAR desconhecido.");
  return { dados: new Uint8Array(await (await zipDaCamada(projeto, res, saida as CamadaCar)).arrayBuffer()), nome: `${base}_${camada.arquivo}.zip`, tipo: "application/zip" };
}
