// O CAR pela base pública do SICAR (GeoServer do car.gov.br, WFS): por código
// do imóvel ou pelos imóveis declarados num ponto/caixa. O CORS foi conferido
// em 06/11/2026 (libera o vertces.com.br), então a consulta sai do navegador.
//
// CAR é DECLARAÇÃO do proprietário: a tela e o laudo dizem "declarado" e
// trazem a condição ("Aguardando análise"), nunca "certificado".
import { cruzarComImovel, motivoCurto } from "../restricoes.ts";
import type { LonLat } from "../restricoes.ts";
import { normalizarCodigoCar } from "./entrada.ts";
import { contornosExternos, pontoEmPoligonos, semFecho } from "./geometria.ts";
import type { Caixa } from "./geometria.ts";
import type { ImovelEncontrado } from "./tipos.ts";
import type { CarSobreposto } from "./analise.ts";

export const WFS_CAR = "https://geoserver.car.gov.br/geoserver/sicar/wfs";
export const HOST_CAR = "geoserver.car.gov.br";

export const STATUS_CAR: Record<string, string> = { AT: "Ativo", PE: "Pendente", SU: "Suspenso", CA: "Cancelado" };
export const TIPO_CAR: Record<string, string> = {
  IRU: "Imóvel rural", AST: "Assentamento da reforma agrária", PCT: "Território de povos e comunidades tradicionais",
};

/** Caixas aproximadas das UFs (com folga): quando o IBGE não diz a UF do ponto, o CAR é procurado nas candidatas. */
export const CAIXAS_UF: Record<string, Caixa> = {
  AC: [-74.1, -11.3, -66.5, -7.0], AL: [-38.4, -10.6, -35.0, -8.7], AP: [-55.0, -1.4, -49.7, 4.6], AM: [-73.9, -10.0, -56.0, 2.4],
  BA: [-46.8, -18.5, -37.2, -8.4], CE: [-41.6, -8.0, -37.1, -2.6], DF: [-48.4, -16.2, -47.2, -15.4], ES: [-42.0, -21.5, -39.5, -17.7],
  GO: [-53.4, -19.6, -45.8, -12.3], MA: [-48.9, -10.4, -41.7, -0.9], MT: [-61.8, -18.2, -50.1, -7.2], MS: [-58.3, -24.2, -50.8, -17.0],
  MG: [-51.2, -23.0, -39.7, -14.1], PA: [-59.0, -10.0, -45.9, 2.7], PB: [-38.9, -8.4, -34.6, -5.9], PR: [-54.8, -26.9, -47.9, -22.4],
  PE: [-41.5, -9.6, -34.7, -7.2], PI: [-46.1, -11.0, -40.3, -2.6], RJ: [-45.0, -23.5, -40.8, -20.6], RN: [-38.7, -7.1, -34.8, -4.7],
  RS: [-57.8, -33.9, -49.6, -26.9], RO: [-67.0, -13.8, -59.6, -7.8], RR: [-65.0, -1.7, -58.7, 5.4], SC: [-54.0, -29.5, -48.2, -25.8],
  SP: [-53.3, -25.5, -44.0, -19.6], SE: [-38.4, -11.7, -36.2, -9.4], TO: [-50.9, -13.6, -45.5, -5.0],
};

export function ufsCandidatas(lon: number, lat: number): string[] {
  return Object.entries(CAIXAS_UF).filter(([, c]) => lon >= c[0] && lon <= c[2] && lat >= c[1] && lat <= c[3]).map(([uf]) => uf);
}

interface Feature { id?: string; properties?: Record<string, unknown> | null; geometry?: { type?: string; coordinates?: unknown } | null }

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim());
const dataIso = (v: unknown): string | null => { const s = txt(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };

function poligonos(g: Feature["geometry"]): LonLat[][][] {
  if (!g?.coordinates) return [];
  const anel = (a: unknown) => semFecho(((a as number[][]) ?? []).map((p) => [Number(p?.[0]), Number(p?.[1])] as LonLat));
  const pol = (c: unknown) => ((c as unknown[]) ?? []).map(anel).filter((a) => a.length >= 3);
  if (g.type === "Polygon") return [pol(g.coordinates)].filter((p) => p.length);
  if (g.type === "MultiPolygon") return (g.coordinates as unknown[]).map(pol).filter((p) => p.length);
  return [];
}

/** Uma feição do SICAR → o imóvel da lista. */
export function imovelDoCar(f: Feature): ImovelEncontrado | null {
  const p = f.properties ?? {};
  const codigo = normalizarCodigoCar(txt(p.cod_imovel)) ?? (txt(p.cod_imovel) || null);
  const pols = poligonos(f.geometry);
  if (!codigo || !pols.length) return null;
  const { aneis, furos } = contornosExternos(pols);
  const status = txt(p.status_imovel).toUpperCase();
  const tipo = txt(p.tipo_imovel).toUpperCase();
  const statusRotulo = STATUS_CAR[status] ?? (status || "situação não informada");
  const condicao = txt(p.condicao) || null;
  const area = Number(p.area);
  const mf = Number(p.m_fiscal);
  return {
    id: `car:${codigo}`, fonte: "car", codigo,
    titulo: `CAR ${codigo}`,
    aneis, poligonos: pols, furos,
    areaDeclaradaHa: Number.isFinite(area) && area > 0 ? area : null,
    municipio: txt(p.municipio) || null, uf: txt(p.uf).toUpperCase() || codigo.slice(0, 2),
    codMunicipio: txt(p.cod_municipio_ibge) || codigo.slice(3, 10),
    atualizacao: dataIso(p.data_atualizacao) ?? dataIso(p.dat_criacao),
    situacao: [statusRotulo, condicao].filter(Boolean).join(" · "),
    detalhes: [
      TIPO_CAR[tipo] ? `Tipo: ${TIPO_CAR[tipo]}` : tipo ? `Tipo: ${tipo}` : "",
      Number.isFinite(mf) && mf > 0 ? `Módulos fiscais: ${mf.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}` : "",
      dataIso(p.dat_criacao) ? `Inscrito em ${dataIso(p.dat_criacao)!.split("-").reverse().join("/")}` : "",
    ].filter(Boolean),
    car: { status, statusRotulo, condicao, tipo, tipoRotulo: TIPO_CAR[tipo] ?? (tipo || null), modulosFiscais: Number.isFinite(mf) ? mf : null },
  };
}

export interface OpcoesCar { fetch?: typeof fetch; timeoutMs?: number; max?: number }

async function getFeature(params: Record<string, string>, uf: string, op: OpcoesCar): Promise<{ imoveis: ImovelEncontrado[]; cortada: boolean }> {
  const f = op.fetch ?? fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), op.timeoutMs ?? 25_000);
  try {
    const q = new URLSearchParams({
      service: "WFS", version: "1.1.0", request: "GetFeature", typeName: `sicar:sicar_imoveis_${uf.toLowerCase()}`,
      outputFormat: "application/json", srsName: "EPSG:4326", maxFeatures: String(op.max ?? 50), ...params,
    });
    const r = await f(`${WFS_CAR}?${q}`, { signal: ctl.signal });
    if (!r.ok) throw new Error(`SICAR respondeu ${r.status}`);
    const texto = await r.text();
    let j: { type?: string; features?: Feature[]; totalFeatures?: number; numberMatched?: number };
    try { j = JSON.parse(texto); } catch { throw new Error(`SICAR: resposta inesperada (${texto.slice(0, 60).replace(/\s+/g, " ")})`); }
    if (j.type !== "FeatureCollection") throw new Error("SICAR: resposta inesperada");
    const feats = j.features ?? [];
    const total = Number(j.totalFeatures ?? j.numberMatched);
    return {
      imoveis: feats.map(imovelDoCar).filter((x): x is ImovelEncontrado => !!x),
      cortada: Number.isFinite(total) ? total > feats.length : feats.length >= (op.max ?? 50),
    };
  } catch (e) {
    throw new Error(ctl.signal.aborted ? "o SICAR não respondeu a tempo" : motivoCurto(e));
  } finally {
    clearTimeout(t);
  }
}

/** O imóvel pelo código (vazio = o SICAR não tem esse código publicado). */
export async function carPorCodigo(codigo: string, op: OpcoesCar = {}): Promise<ImovelEncontrado[]> {
  const c = normalizarCodigoCar(codigo);
  if (!c) throw new Error("Código do CAR inválido.");
  // `c` só tem [A-Z0-9-]: nada de aspas no filtro
  const { imoveis } = await getFeature({ CQL_FILTER: `cod_imovel='${c}'`, maxFeatures: "5" }, c.slice(0, 2), op);
  return imoveis;
}

/** Imóveis declarados que tocam a caixa (para o "CAR sobre esta área"). */
export async function carNaCaixa(caixa: Caixa, uf: string, op: OpcoesCar = {}): Promise<{ imoveis: ImovelEncontrado[]; cortada: boolean }> {
  return getFeature({ bbox: `${caixa.join(",")},EPSG:4326` }, uf, op);
}

/** Imóveis declarados que CONTÊM o ponto (pode haver mais de um: CAR sobreposto). */
export async function carNoPonto(lon: number, lat: number, uf: string, op: OpcoesCar = {}): Promise<ImovelEncontrado[]> {
  const d = 0.0006;
  const { imoveis } = await getFeature({ bbox: `${lon - d},${lat - d},${lon + d},${lat + d},EPSG:4326` }, uf, { ...op, max: op.max ?? 30 });
  return imoveis.filter((x) => pontoEmPoligonos([lon, lat], x.poligonos));
}

/**
 * Os CAR declarados sobre a área (ou a até `encostaM` dela), no motor da
 * análise: área em comum e % da área. `proprio`: o código da área consultada,
 * que não conta como sobreposição consigo mesma.
 */
export function carSobreAArea(aneis: LonLat[][], imoveis: ImovelEncontrado[], proprio: string | null, encostaM = 100): CarSobreposto[] {
  return imoveis
    .filter((x) => x.codigo && x.codigo !== proprio)
    .map((x): CarSobreposto => {
      const c = cruzarComImovel(aneis, x.poligonos);
      return {
        codigo: x.codigo!, situacao: x.situacao, municipio: x.municipio, areaDeclaradaHa: x.areaDeclaradaHa,
        areaM2: c.areaM2, pct: c.pct, distanciaM: c.distanciaM, sobreposta: c.sobreposta,
      };
    })
    .filter((x) => x.areaM2 > 0 || x.distanciaM <= encostaM)
    .sort((a, b) => b.areaM2 - a.areaM2 || a.distanciaM - b.distanciaM);
}
