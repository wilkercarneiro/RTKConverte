// As duas formas de medir do Medir no campo, como contas puras (testáveis sem
// GPS, sem mapa e sem relógio):
//
//  • Caminhar — `verticeAoCaminhar`: a cada leitura, decide se ela vira
//    vértice. Vira quando o agrimensor andou N metros (5 m) desde o último
//    vértice, ou quando a direção mudou mais que X° (15°) — é o canto da cerca.
//    Leitura pior que o limite de precisão não vira nada (a tela diz "sinal
//    fraco, esperando melhorar"). Parado no lugar, o GPS "passeia" uns metros:
//    o deslocamento precisa passar de 60% da precisão para contar, senão o
//    agrimensor ganhava vértices sem sair do canto.
//
//  • Marcar ponto aqui — `combinarLeituras`: junta as leituras de alguns
//    segundos, joga fora as que pularam longe (reflexo em árvore, telhado) e
//    tira a média ponderada pela precisão. A precisão do ponto é dita com
//    honestidade: a média de leituras do MESMO aparelho em poucos segundos não
//    fica mais precisa que a melhor delas (os erros do GPS do celular andam
//    juntos), então o ponto leva a melhor precisão das leituras ou o
//    espalhamento delas, o que for pior.
import { difAngulo, distanciaM, rumoGraus } from "./geometria.ts";
import type { FonteLeitura, Leitura, OpcoesCampo, TipoFix, VerticeCampo } from "./tipos.ts";

/** A leitura serve para medir? (posição válida e precisão dentro do limite) */
export function leituraUtil(l: Leitura | null | undefined, limiteM: number): l is Leitura {
  return !!l && Number.isFinite(l.lon) && Number.isFinite(l.lat) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180
    && l.precisao != null && Number.isFinite(l.precisao) && l.precisao <= limiteM;
}

export type MotivoCaminhar = "primeiro" | "distancia" | "direcao";

/**
 * A leitura vira vértice no modo Caminhar? Devolve o vértice (e o motivo) ou null.
 * `vertices` são os da medição até agora (o último é a referência).
 */
export function verticeAoCaminhar(
  vertices: VerticeCampo[], l: Leitura, op: Pick<OpcoesCampo, "passoM" | "anguloGraus" | "limitePrecisaoM">,
): { vertice: VerticeCampo; motivo: MotivoCaminhar } | null {
  if (!leituraUtil(l, op.limitePrecisaoM)) return null;
  const novo = (motivo: MotivoCaminhar) => ({
    vertice: {
      lon: l.lon, lat: l.lat, precisao: l.precisao, t: l.t, modo: "caminhar" as const,
      ...(l.alt != null ? { alt: l.alt } : {}), ...(l.fonte ? { fonte: l.fonte } : {}), ...(l.fix ? { fix: l.fix } : {}),
    },
    motivo,
  });
  const ult = vertices[vertices.length - 1];
  if (!ult) return novo("primeiro");
  const d = distanciaM(ult, l);
  // o GPS parado passeia: abaixo de 60% da precisão não é andar
  const ruido = 0.6 * (l.precisao ?? 0);
  if (d >= Math.max(op.passoM, ruido)) return novo("distancia");
  const pen = vertices[vertices.length - 2];
  // a direção só conta com um trecho mínimo (metade do passo, 2 m no mínimo):
  // com 1 m de deslocamento, meio metro de erro já vira 30°
  if (pen && d >= Math.max(2, op.passoM / 2, ruido) && distanciaM(pen, ult) >= 1) {
    if (difAngulo(rumoGraus(pen, ult), rumoGraus(ult, l)) > op.anguloGraus) return novo("direcao");
  }
  return null;
}

export interface PontoCombinado {
  lon: number;
  lat: number;
  /** precisão honesta do ponto (m); null = as leituras não diziam a precisão */
  precisao: number | null;
  usadas: number;
  descartadas: number;
  alt?: number | null;
  /** o pior tipo de solução entre as leituras usadas (só receptor) */
  fix?: TipoFix;
  fonte?: FonteLeitura;
}

const mediana = (v: number[]): number => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * A mesma posição chega duas vezes: o watchPosition e o pedirAgora (que pede uma
 * por segundo no Marcar ponto) devolvem o último fix do aparelho. Repetida, ela
 * pesava dobrado e o espalhamento saía menor que o de verdade. A chave é a hora
 * do próprio GPS; sem ela, a posição idêntica (lon, lat e precisão).
 */
export function semRepetidas<T extends Leitura>(leituras: T[]): T[] {
  const vistas = new Set<string>();
  return leituras.filter((l) => {
    const k = l.tGps != null && Number.isFinite(l.tGps) ? `t${l.tGps}|${l.lon}|${l.lat}` : `p${l.lon}|${l.lat}|${l.precisao}`;
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}

/** Raio de 68% (o `accuracy` do Android) → raio de 95%, para erro circular normal: √(−2 ln 0,05) / √(−2 ln 0,32). */
export const FATOR_95 = 1.62;
export const precisao95 = (p: number | null): number | null => (p == null ? null : p * FATOR_95);

/** Junta as leituras de "Marcar ponto aqui" num ponto só. null = nenhuma leitura válida. */
export function combinarLeituras(leituras: Leitura[]): PontoCombinado | null {
  const validas = semRepetidas(leituras.filter((l) => Number.isFinite(l.lon) && Number.isFinite(l.lat) && Math.abs(l.lat) <= 90 && Math.abs(l.lon) <= 180));
  if (!validas.length) return null;
  // centro robusto: a mediana de cada coordenada
  const centro = { lon: mediana(validas.map((l) => l.lon)), lat: mediana(validas.map((l) => l.lat)) };
  const dists = validas.map((l) => distanciaM(centro, l));
  const dMed = mediana(dists);
  // fora: as que pularam mais que 2,5× o espalhamento típico. O piso acompanha a
  // precisão das leituras: 1,5 m no celular (±3 m), 3 cm num receptor RTK (±1 cm)
  const precsInf = validas.map((l) => l.precisao).filter((p): p is number => p != null && Number.isFinite(p));
  const piso = precsInf.length ? Math.min(1.5, Math.max(0.03, 3 * mediana(precsInf))) : 1.5;
  const corte = Math.max(piso, 2.5 * dMed);
  let usadas = validas.filter((_, i) => dists[i] <= corte);
  if (usadas.length < Math.ceil(validas.length / 2)) usadas = validas; // nunca jogar fora a maioria
  // peso 1/precisão²; o piso de 5 mm só evita divisão por zero (receptor RTK diz ±1 cm)
  const peso = (l: Leitura) => 1 / Math.max(0.005, l.precisao ?? 5) ** 2;
  const somaP = usadas.reduce((s, l) => s + peso(l), 0);
  const lon = usadas.reduce((s, l) => s + l.lon * peso(l), 0) / somaP;
  const lat = usadas.reduce((s, l) => s + l.lat * peso(l), 0) / somaP;
  const precs = usadas.map((l) => l.precisao).filter((p): p is number => p != null && Number.isFinite(p));
  const espalhamento = usadas.length > 1
    ? Math.sqrt(usadas.reduce((s, l) => s + distanciaM({ lon, lat }, l) ** 2, 0) / usadas.length)
    : 0;
  const precisao = precs.length ? Math.max(Math.min(...precs), espalhamento) : usadas.length > 1 ? espalhamento : null;
  const alts = usadas.map((l) => l.alt).filter((a): a is number => a != null && Number.isFinite(a));
  // o tipo de solução do ponto é o PIOR das leituras usadas (receptor): um ponto
  // "RTK fixo" só quando todas as leituras eram fixas
  const ordem: TipoFix[] = ["sem-fix", "autonomo", "dgps", "rtk-flutuante", "rtk-fixo"];
  const fixes = usadas.map((l) => l.fix).filter((f): f is TipoFix => !!f);
  const fix = fixes.length === usadas.length && fixes.length ? fixes.reduce((a, b) => (ordem.indexOf(a) <= ordem.indexOf(b) ? a : b)) : null;
  const fonte = usadas.every((l) => l.fonte === "receptor") ? "receptor" as const : usadas.some((l) => l.fonte) ? "celular" as const : undefined;
  return {
    lon, lat, precisao, usadas: usadas.length, descartadas: validas.length - usadas.length,
    ...(alts.length ? { alt: mediana(alts) } : {}),
    ...(fix ? { fix } : {}),
    ...(fonte ? { fonte } : {}),
  };
}

/** O vértice de "Marcar ponto aqui". */
export function verticeDoPonto(p: PontoCombinado, t: number): VerticeCampo {
  return {
    lon: p.lon, lat: p.lat, precisao: p.precisao, t, modo: "ponto", leituras: p.usadas,
    ...(p.alt != null ? { alt: p.alt } : {}), ...(p.fonte ? { fonte: p.fonte } : {}), ...(p.fix ? { fix: p.fix } : {}),
  };
}
