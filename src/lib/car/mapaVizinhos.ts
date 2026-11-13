// Os vizinhos (CAR do SICAR, parcelas do SIGEF) como aparecem no mapa do CAR.
//
// 13/11/2026: o Wilker não via os terrenos dos lados no mapa — estavam lá, mas
// em tracejado cinza de 1,4 px (sumia no satélite), sem nome, e o vizinho que
// deu sobreposição ficava igual aos outros depois do ajuste. Além disso o filtro
// só deixava passar vizinho com algum VÉRTICE perto do imóvel: o vizinho grande
// (vértices longe, divisa colada) sumia.
//
// Agora cada vizinho leva um estado e um nome curto com a posição do rótulo:
//   - "invade": o imóvel ainda sobrepõe (vermelho);
//   - "ajustado": deu sobreposição e o terreno foi recortado pela divisa dele (laranja);
//   - "encosta": vizinho conferido, sem sobreposição (branco).
// O próprio imóvel (CAR/certificação dele) não entra: é o mesmo terreno.
import { centroide, intersecao, areaPol } from "../loteamento/geom.ts";
import type { Anel, Pt } from "../loteamento/geom.ts";
import type { ItemSobreposicao, VizinhoCar } from "./sobreposicao.ts";
import type { LonLat } from "./kml.ts";

export type EstadoVizinhoMapa = "invade" | "ajustado" | "encosta";

export interface VizinhoNoMapa {
  chave: string;
  aneis: Pt[][];
  estado: EstadoVizinhoMapa;
  /** nome curto para o rótulo ("CAR FD77…8BBA", "SIGEF Fazenda Tal") */
  nome: string;
  /** onde pôr o nome (no plano): dentro do vizinho, perto do imóvel; null = sem rótulo */
  rotulo: Pt | null;
}

/** Até onde os vizinhos aparecem em volta do imóvel (m) — a caixa consultada tem 300 m. */
export const MARGEM_MAPA_M = 300;
/** Faixa em volta do imóvel onde o nome do vizinho é posto (m). */
const FAIXA_ROTULO_M = 80;

export function nomeCurtoVizinho(v: Pick<VizinhoCar, "fonte" | "codigo" | "rotulo">): string {
  if (v.fonte === "car") {
    const hash = v.codigo.split("-").pop() ?? v.codigo;
    return hash.length > 10 ? `CAR ${hash.slice(0, 4)}…${hash.slice(-4)}` : `CAR ${v.codigo}`;
  }
  const r = v.rotulo.trim();
  return r.length > 28 ? `${r.slice(0, 27)}…` : r;
}

const caixaDe = (pts: Pt[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
};
const retangulo = (c: { x0: number; y0: number; x1: number; y1: number }, m: number): Anel =>
  [[c.x0 - m, c.y0 - m], [c.x1 + m, c.y0 - m], [c.x1 + m, c.y1 + m], [c.x0 - m, c.y1 + m]];
const antiH = (a: Pt[]): Pt[] => {
  let s = 0;
  for (let i = 0; i < a.length; i++) { const p = a[i], q = a[(i + 1) % a.length]; s += p[0] * q[1] - q[0] * p[1]; }
  return s < 0 ? a.slice().reverse() : a;
};
const semFecho = (a: LonLat[]) => (a.length > 1 && a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1] ? a.slice(0, -1) : a);

/**
 * Monta os vizinhos do mapa.
 * `itens`: o cruzamento com o perímetro ATUAL (sob.ajuste.itens);
 * `cortados`: os códigos já recortados pelo ajuste (projeto.sobreposicao.cortes).
 */
export function vizinhosNoMapa(
  imovel: Pt[],
  vizinhos: VizinhoCar[],
  para: (p: LonLat) => Pt,
  itens: ItemSobreposicao[],
  cortados: { fonte: string; codigo: string }[],
): VizinhoNoMapa[] {
  if (imovel.length < 3) return [];
  const k = (fonte: string, codigo: string) => `${fonte}:${codigo}`;
  const proprios = new Set(itens.filter((i) => i.decisao === "proprio").map((i) => k(i.fonte, i.codigo)));
  const invadem = new Set(itens.filter((i) => i.decisao !== "proprio").map((i) => k(i.fonte, i.codigo)));
  const ajustados = new Set(cortados.map((c) => k(c.fonte, c.codigo)));
  const cx = caixaDe(imovel);
  // primeiro perto do imóvel; o vizinho mais afastado leva o nome na faixa toda
  const faixas = [retangulo(cx, FAIXA_ROTULO_M), retangulo(cx, MARGEM_MAPA_M)];
  const vistos = new Set<string>();
  const saida: VizinhoNoMapa[] = [];
  for (const v of vizinhos) {
    const chave = k(v.fonte, v.codigo);
    if (vistos.has(chave) || proprios.has(chave)) continue;
    vistos.add(chave);
    const aneis = v.poligonos.flatMap((pol) => pol.slice(0, 1)).map((a) => semFecho(a).map(para)).filter((a) => a.length >= 3);
    // perto = a CAIXA do vizinho cruza a do imóvel com margem (não basta um vértice perto)
    const perto = aneis.some((a) => {
      const c = caixaDe(a);
      return c.x0 < cx.x1 + MARGEM_MAPA_M && c.x1 > cx.x0 - MARGEM_MAPA_M && c.y0 < cx.y1 + MARGEM_MAPA_M && c.y1 > cx.y0 - MARGEM_MAPA_M;
    });
    if (!perto) continue;
    // o nome vai no pedaço do vizinho que fica perto do imóvel (o centro dele pode estar a km)
    let rotulo: Pt | null = null;
    for (const f of faixas) {
      try {
        const pedacos = intersecao(aneis.map((a) => ({ ext: antiH(a), furos: [] })), [{ ext: f, furos: [] }])
          .sort((a, b) => areaPol(b) - areaPol(a));
        if (pedacos[0] && areaPol(pedacos[0]) > 1) { rotulo = centroide(pedacos[0].ext); break; }
      } catch { /* tenta a faixa maior */ }
    }
    const estado: EstadoVizinhoMapa = invadem.has(chave) ? "invade" : ajustados.has(chave) ? "ajustado" : "encosta";
    saida.push({ chave, aneis, estado, nome: nomeCurtoVizinho(v), rotulo });
  }
  // os importantes por cima
  const ordem: Record<EstadoVizinhoMapa, number> = { encosta: 0, ajustado: 1, invade: 2 };
  return saida.sort((a, b) => ordem[a.estado] - ordem[b.estado]);
}
