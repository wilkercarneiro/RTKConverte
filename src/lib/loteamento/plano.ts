// Plano de projeto do loteamento.
//
// O levantamento chega em UTM, e UTM não mede o chão: a escala do ponto varia
// de 0,9996 no meridiano central a ~1,0010 na borda do fuso, e a altitude
// encolhe mais um pouco. Num lote de 10 m isso é milímetro; numa quadra de
// 200 m são 10–20 cm, e a quadra locada não fecha com a planta aprovada.
//
// Por isso o projeto é desenhado num plano local: UTM menos o centro da gleba,
// dividido pelo FATOR DE ESCALA COMBINADO (ponto × altitude) no centro. As
// medidas do desenho viram medidas de trena no terreno, e a locação volta para
// UTM multiplicando de novo — é o que o receptor GNSS espera.
import type { Pt } from "./geom.ts";

/** Raio médio da Terra (GRS80) para os fatores de escala; o erro é desprezível em loteamento. */
const R = 6_371_000;
const K0 = 0.9996;

export interface Plano {
  /** centro da gleba em UTM (origem do plano) */
  centro: Pt;
  /** fator combinado: distância UTM = distância no plano × k */
  k: number;
  /** fator de escala do ponto (UTM) no centro */
  kUtm: number;
  /** fator de altitude no centro (R / (R + h)) */
  kAlt: number;
  altitudeMedia: number;
  /** true: o plano mede distâncias de terreno; false: o plano é a própria UTM */
  terreno: boolean;
}

export function criarPlano(pontosUtm: Pt[], altitudes: number[], terreno: boolean): Plano {
  const n = Math.max(1, pontosUtm.length);
  const centro: Pt = [
    pontosUtm.reduce((s, p) => s + p[0], 0) / n,
    pontosUtm.reduce((s, p) => s + p[1], 0) / n,
  ];
  const hs = altitudes.filter((h) => Number.isFinite(h) && h !== 0);
  const altitudeMedia = hs.length ? hs.reduce((s, h) => s + h, 0) / hs.length : 0;
  const x = centro[0] - 500_000;
  const kUtm = K0 * (1 + (x * x) / (2 * R * R) + (x ** 4) / (24 * R ** 4));
  const kAlt = R / (R + altitudeMedia);
  const k = terreno ? kUtm * kAlt : 1;
  return { centro, k, kUtm, kAlt, altitudeMedia, terreno };
}

export const paraPlano = (pl: Plano, p: Pt): Pt => [(p[0] - pl.centro[0]) / pl.k, (p[1] - pl.centro[1]) / pl.k];
export const paraUtm = (pl: Plano, p: Pt): Pt => [pl.centro[0] + p[0] * pl.k, pl.centro[1] + p[1] * pl.k];
