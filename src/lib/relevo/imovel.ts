// Ligação do relevo com o serviço GEO (navegador): vértices → pontos/anéis,
// relevo de fundo do loteamento (modelo digital público) e o Web Worker.
import type { Vertice } from "../types";
import { buscarTerreno } from "../loteamento/terreno.ts";
import type { Pt } from "./curvas.ts";
import { caixaDe } from "./curvas.ts";
import type { EntradaRelevo, ModeloRelevo } from "./modelo.ts";
import { calcularRelevo } from "./modelo.ts";
import { utmDoVertice } from "../vertice_utm.ts";

export interface ImovelRelevo {
  /** todos os vértices com coordenada (UTM), na ordem, e a altitude */
  pts: Pt[];
  hs: number[];
  /** anéis do imóvel (um por parte/gleba desenhada, ou a sequência inteira) */
  aneis: Pt[][];
  /** marcos M (e V) com o código para os pinos e o DXF */
  marcos: { texto: string; p: Pt; h: number }[];
}

/**
 * Pontos do relevo a partir dos vértices. Vértice só com GMS (V digitado ou
 * trazido de vizinho certificado, sem E/N) entra convertido para UTM no fuso
 * do serviço — sem isso ele sumia do anel e da superfície.
 */
export function imovelDosVertices(vertices: Vertice[], aneisOrdens: number[][] | null, fuso?: number | null): ImovelRelevo {
  const comXY = [...vertices]
    .map((v) => ({ v, en: utmDoVertice(v, fuso) }))
    .filter((x): x is { v: Vertice; en: [number, number] } => !!x.en)
    .sort((a, b) => a.v.ordem - b.v.ordem);
  const porOrdem = new Map(comXY.map((x) => [x.v.ordem, x]));
  const anel = (ordens: number[]) => ordens.map((o) => porOrdem.get(o)).filter((x): x is (typeof comXY)[number] => !!x).map((x) => [x.en[0], x.en[1]] as Pt);
  const aneis = (aneisOrdens?.length ? aneisOrdens.map(anel) : [comXY.map((x) => [x.en[0], x.en[1]] as Pt)]).filter((a) => a.length >= 3);
  return {
    pts: comXY.map((x) => [x.en[0], x.en[1]] as Pt),
    hs: comXY.map((x) => Number(x.v.h)),
    aneis,
    marcos: comXY.filter((x) => x.v.tipo === "M" || x.v.tipo === "V").map(({ v, en }) => ({
      texto: v.codigo || (v.num_txt != null ? String(v.num_txt) : `V${v.ordem + 1}`),
      p: [en[0], en[1]] as Pt,
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

/** O cálculo foi trocado por outro (intervalo novo) ou o painel fechou. */
export class RelevoCancelado extends Error {
  constructor() { super("cálculo do relevo cancelado"); this.name = "RelevoCancelado"; }
}

/**
 * Calcula no Web Worker; se o navegador não deixar criar o worker, calcula
 * aqui mesmo. `signal` (abortado ao trocar de intervalo ou fechar o painel)
 * encerra o worker e rejeita com RelevoCancelado — trocar o intervalo várias
 * vezes seguidas deixava workers antigos rodando até o fim. Erro do worker
 * (error/messageerror) rejeita.
 */
export function calcularRelevoEmSegundoPlano(e: EntradaRelevo, signal?: AbortSignal): Promise<ModeloRelevo | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new RelevoCancelado()); return; }
    let w: Worker;
    try {
      w = new Worker(new URL("./relevo.worker.ts", import.meta.url), { type: "module" });
    } catch {
      try { resolve(calcularRelevo(e)); } catch (err) { reject(err); }
      return;
    }
    let fim = false;
    const encerrar = () => {
      fim = true;
      w.terminate();
      signal?.removeEventListener("abort", cancelar);
    };
    const cancelar = () => { if (fim) return; encerrar(); reject(new RelevoCancelado()); };
    signal?.addEventListener("abort", cancelar);
    w.onmessage = (m: MessageEvent<{ ok: boolean; r?: ModeloRelevo | null; erro?: string }>) => {
      if (fim) return;
      encerrar();
      if (m.data.ok) resolve(m.data.r ?? null); else reject(new Error(m.data.erro));
    };
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault?.();
      if (fim) return;
      encerrar();
      reject(new Error(`cálculo do relevo falhou${ev.message ? `: ${ev.message}` : ""}`));
    };
    w.onmessageerror = () => {
      if (fim) return;
      encerrar();
      reject(new Error("cálculo do relevo falhou: resposta do worker ilegível"));
    };
    w.postMessage(e);
  });
}
