// Parcela certificada do SIGEF (a base do sistema: src/lib/sigef.ts, PostGIS)
// → o imóvel da lista da Consultar imóvel. SIGEF é CERTIFICADO pelo INCRA.
import type { FeatureParcela, Sobreposicao } from "../sigef.ts";
import { cruzarComImovel } from "../restricoes.ts";
import type { SigefDaArea } from "./analise.ts";
import { contornosExternos, semFecho } from "./geometria.ts";
import type { LonLat } from "./geometria.ts";
import type { ImovelEncontrado } from "./tipos.ts";

function poligonos(g: FeatureParcela["geometry"] | null | undefined): LonLat[][][] {
  if (!g) return [];
  const anel = (a: number[][]) => semFecho((a ?? []).map((p) => [Number(p[0]), Number(p[1])] as LonLat));
  const pol = (c: number[][][]) => (c ?? []).map(anel).filter((a) => a.length >= 3);
  if (g.type === "Polygon") return [pol(g.coordinates as number[][][])].filter((p) => p.length);
  if (g.type === "MultiPolygon") return (g.coordinates as number[][][][]).map(pol).filter((p) => p.length);
  return [];
}

export function imovelDoSigef(f: FeatureParcela): ImovelEncontrado | null {
  const p = f.properties;
  const pols = poligonos(f.geometry);
  if (!p?.codigo || !pols.length) return null;
  const { aneis, furos } = contornosExternos(pols);
  return {
    id: `sigef:${p.codigo}`, fonte: "sigef", codigo: p.codigo,
    titulo: p.nome?.trim() || `Parcela ${p.codigo.slice(0, 8)}`,
    aneis, poligonos: pols, furos,
    areaDeclaradaHa: p.area_ha != null && Number(p.area_ha) > 0 ? Number(p.area_ha) : null,
    municipio: p.municipio, uf: p.uf, atualizacao: null,
    situacao: p.situacao || "Certificada",
    detalhes: [p.fonte === "csv" ? "Guardada pela sua empresa (CSV do vizinho)" : "Base do SIGEF (INCRA)"],
  };
}

/** Raio das parcelas vizinhas (confrontantes certificados em potencial). */
export const RAIO_SIGEF_M = 500;

/**
 * O SIGEF da área: as sobreposições (do PostGIS, sigef_consultar) e as parcelas
 * vizinhas que não sobrepõem, com a distância no motor da análise. `proprio`:
 * o código da parcela consultada (não é vizinha nem sobreposição de si mesma).
 */
export function sigefDaArea(aneis: LonLat[][], parcelas: FeatureParcela[], sobreposicoes: Sobreposicao[], proprio: string | null): Omit<SigefDaArea, "online" | "detalhe"> {
  const sobre = sobreposicoes.map((s) => (proprio && s.codigo === proprio ? { ...s, mesma_parcela: true } : s));
  const comConflito = new Set(sobre.map((s) => s.codigo));
  const vizinhas = parcelas
    .filter((f) => f.properties?.codigo && !comConflito.has(f.properties.codigo) && f.properties.codigo !== proprio)
    .map((f) => {
      const im = imovelDoSigef(f);
      const d = im ? cruzarComImovel(aneis, im.poligonos).distanciaM : Infinity;
      return { codigo: f.properties.codigo, nome: f.properties.nome, situacao: f.properties.situacao, areaHa: f.properties.area_ha, distanciaM: d };
    })
    .filter((v) => v.distanciaM <= RAIO_SIGEF_M)
    .sort((a, b) => a.distanciaM - b.distanciaM);
  return { sobreposicoes: sobre, vizinhas, raioM: RAIO_SIGEF_M, parcelas };
}
