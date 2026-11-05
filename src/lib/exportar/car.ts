// Camadas do CAR, a partir do projeto gravado e do cálculo (car/motor.ts), em
// lon/lat como o CAR guarda: AREA_IMOVEL, RESERVA_LEGAL, APP, AREA_PRODUTIVA e
// VEGETACAO_NATIVA — os mesmos polígonos (com os furos) dos shapefiles do
// SICAR, pela mesma função (`poligonosDaCamada`). Vão junto os RIOS traçados
// (a linha de onde sai a APP) e os VERTICES do imóvel, que são os pontos do
// CSV, do TXT da coletora e os waypoints do GPX. No DXF, o imóvel ganha o
// azimute e a distância de cada lado (SEGMENTOS) e cada área, o seu nome.
//
// O CAR não tem fuso: o DXF e o TXT saem no fuso UTM do meio do imóvel.
import { calcularCar } from "../car/motor.ts";
import type { ProjetoCar, ResultadoCar } from "../car/motor.ts";
import { CAMADAS, poligonosDaCamada } from "../car/saidas.ts";
import type { CamadaCar } from "../car/saidas.ts";
import { areaPol } from "../loteamento/geom.ts";
import type { Poligono } from "../loteamento/geom.ts";
import { fusoDoMeio } from "./coordenadas.ts";
import type { Camada, Feicao } from "./tipos.ts";

const ORDEM: [CamadaCar, string][] = [
  ["imovel", "AREA_IMOVEL"], ["reserva", "RESERVA_LEGAL"], ["app", "APP"], ["produtiva", "AREA_PRODUTIVA"], ["vegetacao", "VEGETACAO_NATIVA"],
];

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** Os polígonos de cada camada no plano do cálculo (de área igual), na ordem de `poligonosDaCamada`. */
function noPlano(res: ResultadoCar, c: CamadaCar): Poligono[] {
  switch (c) {
    case "imovel": return [res.imovel];
    case "reserva": return res.reserva;
    case "vegetacao": return res.vegetacao;
    case "produtiva": return res.produtiva;
    case "app": return res.app;
  }
}

export function camadasDoCar(pr: ProjetoCar, res: ResultadoCar = calcularCar(pr)): Camada[] {
  const camadas: Camada[] = ORDEM.map(([id, nome]) => {
    const def = CAMADAS.find((c) => c.id === id)!;
    const pols = poligonosDaCamada(pr, res, id);
    const planos = noPlano(res, id);
    return {
      nome, cor: def.cor,
      // no DXF: azimute e distância dos lados do imóvel; o nome de cada área dentro dela
      ...(id === "imovel" ? { segmentos: true } : { rotulos: 1.2 }),
      feicoes: pols.map((p, i): Feicao => ({
        nome: pols.length > 1 ? `${def.titulo} ${i + 1}` : def.titulo,
        tipo: "poligono", geo: p.ext, furosGeo: p.furos,
        // a área do quadro do CAR (plano de área igual), não a do desenho em grau
        props: { area_ha: r4((id === "imovel" ? res.area.imovel : planos[i] ? areaPol(planos[i]) : 0) / 1e4) },
      })),
    };
  });
  camadas.push({
    nome: "RIOS", cor: "#3B8BD9", rotulos: 1,
    feicoes: pr.rios.filter((r) => r.linha.length >= 2).map((r): Feicao => ({ nome: r.nome, tipo: "linha", geo: r.linha, props: { app_m: r.faixa } })),
  });
  camadas.push({
    nome: "VERTICES", cor: "#E53935", rotulos: 1,
    feicoes: pr.perimetro.map((p, i): Feicao => ({ nome: pr.nomesVertices?.[i]?.trim() || `V${i + 1}`, tipo: "ponto", geo: [p] })),
  });
  return camadas;
}

/** Fuso UTM do meio do imóvel: é o do DXF e do TXT da coletora. */
export const fusoDoCar = (pr: ProjetoCar): number => fusoDoMeio(pr.perimetro);
