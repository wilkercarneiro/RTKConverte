// Projetos de infraestrutura do loteamento, gerados pelo sistema a partir do
// traçado: abastecimento de água, esgoto, drenagem pluvial, energia e
// iluminação pública. Como quadras e lotes, NADA disto é gravado: só os
// parâmetros (projeto.infra). As redes saem de `calcularInfra` a cada mudança —
// mexeu numa rua, as redes acompanham.
import type { Resultado } from "../calculo.ts";
import type { Projeto } from "../modelo.ts";
import { montarGrafo } from "./grafo.ts";
import type { GrafoRede } from "./grafo.ts";
import { projetarAgua } from "./agua.ts";
import type { RedeAgua } from "./agua.ts";
import { projetarEsgoto } from "./esgoto.ts";
import type { RedeEsgoto } from "./esgoto.ts";
import { projetarDrenagem } from "./drenagem.ts";
import type { RedeDrenagem } from "./drenagem.ts";
import { projetarEletrica } from "./eletrica.ts";
import type { RedeEletrica } from "./eletrica.ts";
import { infraDe } from "./parametros.ts";
import type { ParametrosInfra } from "./parametros.ts";

export type Rede = "agua" | "esgoto" | "drenagem" | "energia" | "iluminacao";

export const REDES: { id: Rede; nome: string; cor: string }[] = [
  { id: "agua", nome: "Água", cor: "#1E6FD9" },
  { id: "esgoto", nome: "Esgoto", cor: "#8A5A2B" },
  { id: "drenagem", nome: "Drenagem", cor: "#13A3A3" },
  { id: "energia", nome: "Energia", cor: "#E23B2E" },
  { id: "iluminacao", nome: "Iluminação", cor: "#F2B705" },
];

export interface ResultadoInfra {
  params: ParametrosInfra;
  grafo: GrafoRede;
  agua: RedeAgua;
  esgoto: RedeEsgoto;
  drenagem: RedeDrenagem;
  eletrica: RedeEletrica;
  /** lotes atendidos e população de projeto */
  lotes: number;
  populacao: number;
  ms: number;
}

const cache = new WeakMap<Resultado, { chave: string; r: ResultadoInfra }>();

export function calcularInfra(res: Resultado, projeto: Pick<Projeto, "infra" | "terreno" | "params">): ResultadoInfra {
  const params = infraDe(projeto.infra);
  const chave = JSON.stringify(params) + (projeto.terreno ? `${projeto.terreno.e0},${projeto.terreno.n0},${projeto.terreno.nx}` : "-");
  const c = cache.get(res);
  if (c && c.chave === chave) return c.r;
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const grafo = montarGrafo(res, projeto.terreno);
  const agua = projetarAgua(res, grafo, params);
  const esgoto = projetarEsgoto(res, grafo, params);
  const drenagem = projetarDrenagem(res, grafo, params, projeto.params.ruaPista);
  const eletrica = projetarEletrica(res, grafo, params);
  const lotes = res.lotes.length - grafo.semRede.length;
  const r: ResultadoInfra = {
    params, grafo, agua, esgoto, drenagem, eletrica, lotes, populacao: lotes * params.habPorLote,
    ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0,
  };
  if (grafo.semRede.length) {
    agua.avisos.unshift(`${grafo.semRede.length} lote(s) sem frente para rua da rede ficaram fora dos projetos de infraestrutura.`);
  }
  cache.set(res, { chave, r });
  return r;
}

export { infraDe, INFRA_PADRAO, IDF_SALVADOR } from "./parametros.ts";
export type { ParametrosInfra } from "./parametros.ts";
