// Perímetro do serviço e projeto inicial do loteamento — só cálculo, sem banco.
// Mora fora de persistencia.ts porque a função `entregar` (servidor) monta o
// mesmo perímetro e o mesmo projeto a partir do banco para gerar os arquivos.
import proj4mod from "proj4";
import { GEO_DEF, gmsToDeg, parseGmsPlanilha, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import type { Servico, Vertice } from "../types";
import type { Pt } from "./geom.ts";
import type { Perimetro } from "./calculo.ts";
import { normalizarProjeto } from "./modelo.ts";
import { classificarVia, recuoDaVia } from "../../../supabase/functions/_shared/recuo.ts";
import type { Borda, Projeto } from "./modelo.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

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
  // confrontação: começa no último M do anel (dá a volta). O marco com rótulo do TXT é
  // ponto de troca mesmo sem nome depois da barra: "16estrada/" ENCERRA a estrada (o
  // lado seguinte é de vizinho sem nome) — antes ele era pulado e a estrada continuava
  // pelos lados 16, 1 e 2 do EDILSON, que são divisa
  const troca = (v: Vertice) => v.tipo === "M" && (!!v.descritivo || v.apelido_txt !== null || !!v.rotulo_txt);
  let atual: Vertice | null = [...doVertice].reverse().find(troca) ?? null;
  const confrontantes: (string | null)[] = [];
  const vias: boolean[] = [];
  for (const v of doVertice) {
    if (troca(v)) atual = v;
    confrontantes.push(nomeConfrontante(atual?.descritivo ?? atual?.apelido_txt));
    vias.push(!!atual?.eh_via);
  }
  return { pts, altitudes, confrontantes, nomes, vias };
}

/**
 * Borda de um lado com estrada, já com o recuo da lei (recuo automático,
 * 05/11/2026; regras em supabase/functions/_shared/recuo.ts): rodovia federal
 * ou estadual vira "rodovia" com a faixa não edificável de 15 m (Lei 6.766/1979,
 * art. 4º, III — obrigatória no loteamento), ferrovia idem (art. 4º, III-A), e
 * estrada municipal continua "via existente", sem faixa (vale a lei do
 * município, que o operador põe à mão).
 */
export function bordaDaEstrada(nome: string): Borda {
  const via = classificarVia(nome);
  if (via && (via.tipo === "federal" || via.tipo === "estadual")) return { tipo: "rodovia", faixa: recuoDaVia(via).naoEdificavel, nome };
  if (via?.tipo === "ferrovia") return { tipo: "ferrovia", faixa: recuoDaVia(via).naoEdificavel, nome };
  return { tipo: "via", faixa: 0, nome };
}

/** Projeto do banco (ou novo), já com as estradas do levantamento marcadas — e com o recuo legal das rodovias. */
export function projetoInicial(salvo: Partial<Projeto> | null, servico: Servico, perimetro: Perimetro & { vias: boolean[] }): Projeto {
  const nome = servico.denominacao || servico.nome_arquivo_txt?.replace(/\.txt$/i, "") || "Loteamento";
  const p = normalizarProjeto(salvo, nome, perimetro.pts.length);
  if (!salvo) {
    p.bordas = perimetro.pts.map((_, i): Borda => (perimetro.vias[i]
      ? bordaDaEstrada(perimetro.confrontantes[i] ?? "")
      : { tipo: "divisa", faixa: 0 }));
  }
  return p;
}
