// Modelo de terreno do imóvel + curvas: a parte pesada (roda no Web Worker).
// O método está explicado em curvas.ts.
import type { Curva, EstatAjuste, GradeCotas, Pt } from "./curvas.ts";
import {
  ajustarAosVertices, curvasDeNivel, faixaNoImovel, gradeVazia, intervaloAutomatico, marcosComAltitude, passoParaCurvas, reamostrar, suavizar,
} from "./curvas.ts";

export type FonteRelevo = "dem" | "marcos";

export interface EntradaRelevo {
  /** relevo de fundo (grade do modelo público, já no nível do levantamento) ou null sem rede */
  base: GradeCotas | null;
  /** todos os vértices do perímetro (UTM) e a altitude de cada um */
  pts: Pt[];
  hs: number[];
  /** anéis do imóvel (UTM) para recortar as curvas */
  aneis: Pt[][];
  /** intervalo pedido; null = automático */
  intervalo: number | null;
  /** pontos que a grade tem de cobrir além do imóvel (margem da maquete 3D) */
  cobertura?: Pt[];
}

export interface ModeloRelevo {
  grade: GradeCotas & { h: Float64Array };
  fonte: FonteRelevo;
  ajuste: EstatAjuste;
  /** faixa de cotas dentro do imóvel */
  min: number;
  max: number;
  intervaloAuto: number;
  intervalo: number;
  curvas: Curva[];
  /** milissegundos de cálculo (modelo, curvas) */
  ms: { modelo: number; curvas: number };
}

/** Só o modelo (grade ajustada). */
export function modeloDoTerreno(e: Omit<EntradaRelevo, "intervalo">): Pick<ModeloRelevo, "grade" | "fonte" | "ajuste"> | null {
  const cob = e.cobertura?.length ? [...e.pts, ...e.cobertura] : e.pts;
  // o passo vem do tamanho da área coberta (com a margem, a grade não passa de ~300 nós por lado)
  const passo = passoParaCurvas(cob);
  if (e.base) {
    const g = reamostrar(e.base, cob, passo);
    // tira o serrilhado da amostragem dos tiles (meio pixel do modelo de ~30 m)
    suavizar(g, 12);
    const ajuste = ajustarAosVertices(g, e.pts, e.hs);
    return { grade: g, fonte: "dem", ajuste };
  }
  // sem o modelo público: a superfície sai só dos marcos (plano de tendência + correção local)
  if (marcosComAltitude(e.pts, e.hs).pts.length < 3) return null;
  const g = gradeVazia(cob, passo);
  const ajuste = ajustarAosVertices(g, e.pts, e.hs, Math.max(60, 3 * passo));
  return { grade: g, fonte: "marcos", ajuste };
}

/** Curvas para uma grade já ajustada. */
export function curvasDoModelo(grade: GradeCotas, aneis: Pt[][], intervalo: number | null): Pick<ModeloRelevo, "min" | "max" | "intervaloAuto" | "intervalo" | "curvas"> {
  const f = faixaNoImovel(grade, aneis);
  const intervaloAuto = intervaloAutomatico(f.max - f.min);
  const iv = intervalo && intervalo > 0 ? intervalo : intervaloAuto;
  return { min: f.min, max: f.max, intervaloAuto, intervalo: iv, curvas: curvasDeNivel(grade, iv, aneis) };
}

export function calcularRelevo(e: EntradaRelevo): ModeloRelevo | null {
  const t0 = Date.now();
  const m = modeloDoTerreno(e);
  if (!m) return null;
  const t1 = Date.now();
  const c = curvasDoModelo(m.grade, e.aneis, e.intervalo);
  return { ...m, ...c, ms: { modelo: t1 - t0, curvas: Date.now() - t1 } };
}
