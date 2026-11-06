// "Limpar vértices em linha reta" (Medir no campo): andando pela cerca, o modo
// Caminhar põe um vértice a cada 5 m — 121 vértices numa área de 4 lados. Para
// o croqui, o CAR e o memorial, a cerca reta vale 2 vértices, não 30.
//
// Douglas–Peucker em metros (UTM no fuso do lugar, o motor único): um vértice
// sai quando fica a menos da tolerância da linha reta entre os vizinhos que
// ficam. A tolerância é da ordem da precisão do GPS (~1 m): o que sai está
// dentro do ruído do próprio celular, e a área quase não muda (a tela mostra
// antes → depois para o agrimensor decidir).
//
// Vértices marcados de propósito ("Marcar ponto aqui", ou tocados no mapa)
// NUNCA saem: só os do Caminhar. Puro: a tela e os testes usam igual.
import { geoParaUtm } from "../exportar/coordenadas.ts";
import { fusoDaMedicao, medir } from "./geometria.ts";
import type { VerticeCampo } from "./tipos.ts";

export interface Limpeza {
  vertices: VerticeCampo[];
  antes: number;
  depois: number;
  areaAntesM2: number;
  areaDepoisM2: number;
  toleranciaM: number;
  /** incerteza da área pelo próprio GPS (perímetro × precisão média), m²; null = desenhada à mão */
  incertezaM2: number | null;
}

/** Tolerância padrão: da ordem da precisão média do GPS, entre 0,5 e 1,5 m (cerca de 1 m). */
export function toleranciaPadrao(vertices: VerticeCampo[]): number {
  const p = medir(vertices).precisaoMediaM;
  if (p == null) return 1;
  return Math.min(1.5, Math.max(0.5, Math.round(p * 0.3 * 10) / 10));
}

/** Distância do ponto p ao segmento a–b (metros, plano UTM). */
function distSegmento(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * O contorno FECHADO sem os vértices do Caminhar que estão em linha reta.
 * Os fixos (ponto, mão) dividem o anel em trechos; sem fixos, o anel é partido
 * no 1º vértice e no mais longe dele. Nunca devolve menos de 3 vértices.
 */
export function limparLinhaReta(vertices: VerticeCampo[], toleranciaM = toleranciaPadrao(vertices)): Limpeza {
  const n = vertices.length;
  const md = medir(vertices);
  const areaAntesM2 = md.areaM2;
  const incertezaM2 = md.precisaoMediaM == null ? null : md.perimetroM * md.precisaoMediaM;
  const igual: Limpeza = { vertices, antes: n, depois: n, areaAntesM2, areaDepoisM2: areaAntesM2, toleranciaM, incertezaM2 };
  if (n < 4 || !(toleranciaM > 0)) return igual;
  const fuso = fusoDaMedicao(vertices);
  const xy = vertices.map((v) => geoParaUtm([v.lon, v.lat], fuso) as [number, number]);

  const fica = new Array<boolean>(n).fill(false);
  let ancoras = vertices.map((v, i) => (v.modo === "caminhar" ? -1 : i)).filter((i) => i >= 0);
  if (ancoras.length < 2) {
    const a = ancoras[0] ?? 0;
    let longe = a, dMax = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(xy[i][0] - xy[a][0], xy[i][1] - xy[a][1]);
      if (d > dMax) { dMax = d; longe = i; }
    }
    ancoras = [...new Set([a, longe])].sort((x, y) => x - y);
  }
  for (const i of ancoras) fica[i] = true;

  // cada trecho entre duas âncoras seguidas (dando a volta no anel)
  for (let k = 0; k < ancoras.length; k++) {
    const ini = ancoras[k];
    const fim = ancoras[(k + 1) % ancoras.length];
    const trecho: number[] = [];
    for (let i = ini; ; i = (i + 1) % n) { trecho.push(i); if (i === fim && trecho.length > 1) break; }
    // Douglas–Peucker iterativo no trecho
    const pilha: [number, number][] = [[0, trecho.length - 1]];
    while (pilha.length) {
      const [a, b] = pilha.pop()!;
      if (b - a < 2) continue;
      let dMax = -1, iMax = -1;
      for (let j = a + 1; j < b; j++) {
        const d = distSegmento(xy[trecho[j]], xy[trecho[a]], xy[trecho[b]]);
        if (d > dMax) { dMax = d; iMax = j; }
      }
      if (dMax > toleranciaM) {
        fica[trecho[iMax]] = true;
        pilha.push([a, iMax], [iMax, b]);
      }
    }
  }

  // 2ª passada: os quase em linha que o ruído do GPS deixou nos lados compridos
  const altMax = Math.min(2, Math.max(toleranciaM, 0.6 * (md.precisaoMediaM ?? 0)));
  tirarQuaseRetos(vertices, xy, fica, altMax, areaAntesM2);

  const limpos = vertices.filter((_, i) => fica[i]);
  if (limpos.length < 3 || limpos.length === n) return igual;
  return { vertices: limpos, antes: n, depois: limpos.length, areaAntesM2, areaDepoisM2: medir(limpos).areaM2, toleranciaM, incertezaM2 };
}

const DEFLEXAO_MAX = (20 * Math.PI) / 180;

function areaIdx(xy: [number, number][], idx: number[]): number {
  let s = 0;
  for (let k = 0; k < idx.length; k++) {
    const a = xy[idx[k]], b = xy[idx[(k + 1) % idx.length]];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/**
 * 2ª passada (depois do Douglas–Peucker): nos lados compridos ficam vértices
 * do Caminhar quase em linha — o ruído do GPS passa da tolerância aqui e ali.
 * Sai o que quebra pouco (deflexão < 20°, ou colado num vizinho) e fica perto da reta dos vizinhos
 * (dentro do ruído: até 0,6 × a precisão média, teto de 2 m), enquanto a área
 * total ficar a menos de 0,15% da medida. O de menor efeito na área sai primeiro.
 */
function tirarQuaseRetos(vertices: VerticeCampo[], xy: [number, number][], fica: boolean[], altMax: number, areaAntesM2: number): void {
  const limite = areaAntesM2 * 0.0015;
  for (;;) {
    const idx = fica.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
    if (idx.length <= 3) return;
    let melhor = -1, melhorDif = Infinity;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      if (vertices[i].modo !== "caminhar") continue;
      const a = xy[idx[(k - 1 + idx.length) % idx.length]], p = xy[i], b = xy[idx[(k + 1) % idx.length]];
      const ux = p[0] - a[0], uy = p[1] - a[1], vx = b[0] - p[0], vy = b[1] - p[1];
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu > 0 && lv > 0) {
        const def = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
        // vértice colado no vizinho (lado curto): a quebra aparente é só o ruído — vale a altura
        if ((def >= DEFLEXAO_MAX && Math.min(lu, lv) > 5 * altMax) || distSegmento(p, a, b) > altMax) continue;
      }
      const dif = Math.abs(areaIdx(xy, idx.filter((x) => x !== i)) - areaAntesM2);
      if (dif < melhorDif) { melhorDif = dif; melhor = i; }
    }
    if (melhor < 0 || melhorDif > limite) return;
    fica[melhor] = false;
  }
}

/** Vale oferecer? Medição com Caminhar e pelo menos 5 vértices (e 20%) a menos. */
export function valeLimpar(l: Limpeza): boolean {
  const tirados = l.antes - l.depois;
  return tirados >= 5 && tirados >= l.antes * 0.2;
}

/**
 * A limpeza feita ainda vale para estes vértices? Só se o contorno for
 * exatamente o que a limpeza deixou. Reaberta e editada ("Continuar medindo",
 * Desfazer, vértice novo), o aviso "Cerca limpa" e o Desfazer dele caducam: o
 * Desfazer poria de volta o contorno de antes e jogaria fora a edição.
 */
export function limpezaAindaVale(l: Limpeza, vertices: readonly VerticeCampo[]): boolean {
  if (l.vertices === vertices) return true;
  if (l.vertices.length !== vertices.length) return false;
  return l.vertices.every((v, i) => v.lon === vertices[i].lon && v.lat === vertices[i].lat && v.modo === vertices[i].modo);
}
