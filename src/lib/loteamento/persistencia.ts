// O que liga o loteamento ao resto do sistema: o perímetro sai dos vértices do
// serviço (o mesmo TXT que alimenta memorial e planta) e o projeto mora na
// tabela `loteamentos` (migração 0021).
import proj4mod from "proj4";
import { supabase } from "../supabase";
import { GEO_DEF, gmsToDeg, parseGmsPlanilha, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import type { Servico, Vertice } from "../types";
import type { Pt } from "./geom.ts";
import type { Perimetro } from "./calculo.ts";
import { normalizarProjeto } from "./modelo.ts";
import type { Borda, Projeto } from "./modelo.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

/** A migração 0021 já foi aplicada? (sem ela não há onde salvar o projeto) */
export async function loteamentoDisponivel(): Promise<boolean> {
  const { error } = await supabase.from("loteamentos").select("servico_id").limit(1);
  return !error;
}

export async function carregarProjeto(servicoId: string): Promise<Partial<Projeto> | null> {
  const { data, error } = await supabase.from("loteamentos").select("projeto").eq("servico_id", servicoId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.projeto as Partial<Projeto> | undefined) ?? null;
}

export async function salvarProjeto(servicoId: string, projeto: Projeto): Promise<void> {
  const { error } = await supabase.from("loteamentos")
    .upsert({ servico_id: servicoId, projeto, updated_at: new Date().toISOString() }, { onConflict: "servico_id" });
  if (error) throw new Error(error.message);
}

/** Nome do confrontante para o memorial do lote: "NOME — CPF: …" sem a etiqueta de matrícula. */
export function nomeConfrontante(descritivo: string | null | undefined): string | null {
  const partes = (descritivo ?? "").split("\\").map((x) => x.trim()).filter(Boolean);
  if (!partes.length) return null;
  const semEtiqueta = partes[0].replace(/^\([^)]*\)\s*/, "").trim();
  return [semEtiqueta || partes[0], ...partes.slice(1, 2)].filter(Boolean).join(" — ");
}

/**
 * Perímetro do serviço em UTM, na ordem do anel. O confrontante de cada lado é
 * o do último M antes dele (a confrontação vive no M e vale até o próximo M —
 * ARQUITETURA-TRECHOS.md).
 */
export function perimetroDoServico(vertices: Vertice[], fuso: number): Perimetro & { vias: boolean[] } {
  const vs = [...vertices].sort((a, b) => a.ordem - b.ordem);
  const ud = utmDef(fuso);
  const pts: Pt[] = [];
  const altitudes: number[] = [];
  const nomes: string[] = [];
  const doVertice: Vertice[] = [];
  for (const v of vs) {
    let p: Pt | null = null;
    if (v.e !== null && v.n !== null && Number.isFinite(Number(v.e)) && Number.isFinite(Number(v.n))) p = [Number(v.e), Number(v.n)];
    else if (v.lat_gms && v.lon_gms) {
      try { p = proj(GEO_DEF, ud, [gmsToDeg(parseGmsPlanilha(v.lon_gms)), gmsToDeg(parseGmsPlanilha(v.lat_gms))]); } catch { p = null; }
    }
    if (!p) continue;
    const ult = pts[pts.length - 1];
    if (ult && Math.hypot(ult[0] - p[0], ult[1] - p[1]) < 0.005) continue; // marco repetido
    pts.push(p);
    altitudes.push(Number(v.h) || 0);
    nomes.push(v.codigo ?? (v.num_txt !== null ? String(v.num_txt) : `V${v.ordem + 1}`));
    doVertice.push(v);
  }
  if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.005) {
    pts.pop(); altitudes.pop(); nomes.pop(); doVertice.pop();
  }
  // confrontação: começa no último M do anel (dá a volta)
  let atual: Vertice | null = [...doVertice].reverse().find((v) => v.tipo === "M" && (v.descritivo || v.apelido_txt)) ?? null;
  const confrontantes: (string | null)[] = [];
  const vias: boolean[] = [];
  for (const v of doVertice) {
    if (v.tipo === "M" && (v.descritivo || v.apelido_txt)) atual = v;
    confrontantes.push(nomeConfrontante(atual?.descritivo ?? atual?.apelido_txt));
    vias.push(!!atual?.eh_via);
  }
  return { pts, altitudes, confrontantes, nomes, vias };
}

/** Projeto do banco (ou novo), já com as estradas do levantamento marcadas como via existente. */
export function projetoInicial(salvo: Partial<Projeto> | null, servico: Servico, perimetro: Perimetro & { vias: boolean[] }): Projeto {
  const nome = servico.denominacao || servico.nome_arquivo_txt?.replace(/\.txt$/i, "") || "Loteamento";
  const p = normalizarProjeto(salvo, nome, perimetro.pts.length);
  if (!salvo) {
    p.bordas = perimetro.pts.map((_, i): Borda => (perimetro.vias[i]
      ? { tipo: "via", faixa: 0, nome: perimetro.confrontantes[i] ?? "" }
      : { tipo: "divisa", faixa: 0 }));
  }
  return p;
}
