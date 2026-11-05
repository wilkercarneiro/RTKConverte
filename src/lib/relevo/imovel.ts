// Ligação do relevo com o serviço GEO (navegador): vértices → pontos/anéis,
// relevo de fundo do loteamento (modelo digital público) e o Web Worker.
import type { Vertice } from "../types";
import { buscarTerreno } from "../loteamento/terreno.ts";
import type { Pt } from "./curvas.ts";
import { caixaDe } from "./curvas.ts";
import type { EntradaRelevo, ModeloRelevo } from "./modelo.ts";
import { calcularRelevo } from "./modelo.ts";

export interface ImovelRelevo {
  /** todos os vértices com coordenada (UTM), na ordem, e a altitude */
  pts: Pt[];
  hs: number[];
  /** anéis do imóvel (um por parte/gleba desenhada, ou a sequência inteira) */
  aneis: Pt[][];
  /** marcos M (e V) com o código para os pinos e o DXF */
  marcos: { texto: string; p: Pt; h: number }[];
}

export function imovelDosVertices(vertices: Vertice[], aneisOrdens: number[][] | null): ImovelRelevo {
  const comXY = [...vertices].filter((v) => Number.isFinite(v.e) && Number.isFinite(v.n)).sort((a, b) => a.ordem - b.ordem);
  const porOrdem = new Map(comXY.map((v) => [v.ordem, v]));
  const anel = (ordens: number[]) => ordens.map((o) => porOrdem.get(o)).filter((v): v is Vertice => !!v).map((v) => [v.e!, v.n!] as Pt);
  const aneis = (aneisOrdens?.length ? aneisOrdens.map(anel) : [comXY.map((v) => [v.e!, v.n!] as Pt)]).filter((a) => a.length >= 3);
  return {
    pts: comXY.map((v) => [v.e!, v.n!] as Pt),
    hs: comXY.map((v) => Number(v.h)),
    aneis,
    marcos: comXY.filter((v) => v.tipo === "M" || v.tipo === "V").map((v) => ({
      texto: v.codigo || (v.num_txt != null ? String(v.num_txt) : `V${v.ordem + 1}`),
      p: [v.e!, v.n!] as Pt,
      h: Number(v.h),
    })),
  };
}

/** Margem em volta do imóvel coberta pelo relevo (a maquete mostra a vizinhança). */
export function margemDoImovel(pts: Pt[]): number {
  const b = caixaDe(pts);
  return Math.max(40, Math.min(220, 0.3 * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1])));
}

/** Pontos que a grade precisa cobrir: o imóvel e os cantos da margem. */
export function coberturaDoImovel(pts: Pt[]): Pt[] {
  const b = caixaDe(pts, margemDoImovel(pts) + 20);
  return [...pts, b.min, [b.max[0], b.min[1]], b.max, [b.min[0], b.max[1]]];
}

/**
 * Relevo de fundo: o mesmo do loteamento (tiles de elevação da AWS, nível
 * calibrado pela mediana nos marcos). Sem rede: null (a superfície sai só dos marcos).
 */
export async function buscarRelevoDeFundo(im: ImovelRelevo, fuso: number): Promise<EntradaRelevo["base"]> {
  const cob = coberturaDoImovel(im.pts);
  const hs = [...im.hs, ...cob.slice(im.pts.length).map(() => NaN)];
  const t = await buscarTerreno(cob, hs, fuso);
  return t && t.fonte === "dem" ? t : null;
}

/** Calcula no Web Worker; se o navegador não deixar, calcula aqui mesmo. */
export function calcularRelevoEmSegundoPlano(e: EntradaRelevo): Promise<ModeloRelevo | null> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL("./relevo.worker.ts", import.meta.url), { type: "module" });
    } catch {
      try { resolve(calcularRelevo(e)); } catch (err) { reject(err); }
      return;
    }
    w.onmessage = (m: MessageEvent<{ ok: boolean; r?: ModeloRelevo | null; erro?: string }>) => {
      w.terminate();
      if (m.data.ok) resolve(m.data.r ?? null); else reject(new Error(m.data.erro));
    };
    w.onerror = () => {
      w.terminate();
      try { resolve(calcularRelevo(e)); } catch (err) { reject(err); }
    };
    w.postMessage(e);
  });
}
