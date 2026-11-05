// Faixa de domínio das rodovias FEDERAIS pelo GeoServer do DNIT — a parte
// "automática" do recuo de BR (docs/recuo-rodovias.md, seções 1.5 e B5).
//
// O DNIT publica, com CORS aberto (conferido em 05/11/2026):
//   vgeo:vw_faixa_reconhecida — polígonos dos Termos de Reconhecimento (oficial;
//                               24 trechos na BA), lado esquerdo/direito em m;
//   vgeo:vw_faixa_dominio     — faixa documentada (projetos), marcada pelo
//                               próprio DNIT como "informações teste";
//   vgeo:vw_snv_rod           — eixos do SNV (qual BR, km, administração).
// As duas primeiras são poucas por UF: baixa-se a UF inteira uma vez e o
// cruzamento com o imóvel é feito aqui. O eixo do SNV só serve para DIZER qual
// BR passa perto e a que distância — nunca para traçar divisa (precisão não
// verificada; regra B3.5 da pesquisa).
//
// Resultado: as faixas que encostam no imóvel e, quando o perímetro ENTRA numa
// faixa, a área invadida (bem público, CC art. 102) — é o alerta de recuo.
import { areaPol, antiHorario, dist, distSegmento, intersecao } from "./loteamento/geom.ts";
import type { Poligono, Pt } from "./loteamento/geom.ts";

export const GEOSERVER_DNIT = "https://servicos.dnit.gov.br/dnitgeo/geoserver/ows";

type LonLat = [number, number];

export interface FaixaDnit {
  br: string;
  /** "reconhecida" = Termo de Reconhecimento (oficial); "documentada" = base de teste do DNIT */
  origem: "reconhecida" | "documentada";
  /** largura por lado a partir do eixo, em m (nulo = "Variável" no DNIT) */
  ladoEsquerdo: number | null;
  ladoDireito: number | null;
  documento: string;
  trecho: string;
  /** polígonos da faixa em lon/lat */
  poligonos: LonLat[][];
}

export interface InvasaoDnit {
  br: string;
  origem: FaixaDnit["origem"];
  /** área do imóvel dentro da faixa de domínio, m² */
  areaM2: number;
  documento: string;
}

export interface EixoProximo {
  br: string;
  /** menor distância entre o perímetro e o eixo do SNV, m */
  distanciaM: number;
  administracao: string | null;
  trecho: string;
}

export interface ResultadoDnit {
  /** faixas a até 300 m do imóvel */
  faixas: (FaixaDnit & { distanciaM: number })[];
  invasoes: InvasaoDnit[];
  /** BRs do SNV a até 500 m do perímetro */
  eixos: EixoProximo[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Anéis lon/lat de um Polygon/MultiPolygon do GeoJSON (só o externo; z some). */
function aneisDe(g: { type?: string; coordinates?: unknown } | null | undefined): LonLat[][] {
  if (!g?.coordinates) return [];
  const pol = (c: unknown) => ((c as number[][][])[0] ?? []).map((p) => [p[0], p[1]] as LonLat);
  if (g.type === "Polygon") return [pol(g.coordinates)];
  if (g.type === "MultiPolygon") return (g.coordinates as unknown[]).map(pol);
  return [];
}

function linhasDe(g: { type?: string; coordinates?: unknown } | null | undefined): LonLat[][] {
  if (!g?.coordinates) return [];
  if (g.type === "LineString") return [(g.coordinates as number[][]).map((p) => [p[0], p[1]] as LonLat)];
  if (g.type === "MultiLineString") return (g.coordinates as number[][][]).map((l) => l.map((p) => [p[0], p[1]] as LonLat));
  return [];
}

/** Plano local em metros (equirretangular no centro do imóvel): sobra para área e distância de alerta. */
function planoLocal(ref: LonLat): (p: LonLat) => Pt {
  const R = 6378137, k = Math.PI / 180, c = Math.cos(ref[1] * k);
  return (p) => [(p[0] - ref[0]) * k * R * c, (p[1] - ref[1]) * k * R];
}

function distAneis(a: Pt[], b: Pt[], fechadoB = true): number {
  let d = Infinity;
  const nb = fechadoB ? b.length : b.length - 1;
  for (const p of a) for (let i = 0; i < nb; i++) d = Math.min(d, distSegmento(p, b[i], b[(i + 1) % b.length]).d);
  for (const p of b) for (let i = 0; i < a.length; i++) d = Math.min(d, distSegmento(p, a[i], a[(i + 1) % a.length]).d);
  return d;
}

const pol = (anel: Pt[]): Poligono => ({ ext: antiHorario(anel), furos: [] });

interface Feature { properties?: Record<string, unknown>; geometry?: { type?: string; coordinates?: unknown } | null }

async function wfs(f: typeof fetch, params: Record<string, string>): Promise<Feature[]> {
  const q = new URLSearchParams({ service: "WFS", version: "1.1.0", request: "GetFeature", outputFormat: "application/json", ...params });
  const r = await f(`${GEOSERVER_DNIT}?${q}`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`DNIT respondeu ${r.status}`);
  const j = await r.json() as { features?: Feature[] };
  return j.features ?? [];
}

const cacheUf = new Map<string, Promise<FaixaDnit[]>>();

/** Todas as faixas (reconhecidas e documentadas) de uma UF — poucas; guardadas na sessão. */
export function faixasDaUf(uf: string, f: typeof fetch = fetch): Promise<FaixaDnit[]> {
  const chave = uf.toUpperCase();
  if (!/^[A-Z]{2}$/.test(chave)) return Promise.resolve([]);
  if (!cacheUf.has(chave)) {
    const filtro = `Unidade_Federacao='${chave}'`;
    const p = Promise.all([
      wfs(f, { typeName: "vgeo:vw_faixa_reconhecida", CQL_FILTER: filtro, maxFeatures: "2000" }),
      wfs(f, { typeName: "vgeo:vw_faixa_dominio", CQL_FILTER: filtro, maxFeatures: "2000" }),
    ]).then(([rec, doc]) => [
      ...rec.map((x): FaixaDnit => ({
        br: `BR-${String(x.properties?.Codigo_BR ?? "").padStart(3, "0")}`, origem: "reconhecida",
        ladoEsquerdo: num(x.properties?.Lado_Esquerdo), ladoDireito: num(x.properties?.Lado_Direito),
        documento: `${x.properties?.Tipo_Documento ?? "Termo de Reconhecimento"} ${x.properties?.Numero_Documento ?? ""}`.trim(),
        trecho: [x.properties?.Trecho, x.properties?.Subtrecho].filter(Boolean).join(" — "),
        poligonos: aneisDe(x.geometry),
      })),
      ...doc.map((x): FaixaDnit => ({
        br: `BR-${String(x.properties?.Codigo_BR ?? "").padStart(3, "0")}`, origem: "documentada",
        ladoEsquerdo: num(x.properties?.Lado_Esquerdo), ladoDireito: num(x.properties?.Lado_Direito),
        documento: `${x.properties?.Numero_Documento ?? "projeto"} (base de teste do DNIT)`,
        trecho: String(x.properties?.Trecho ?? "").replace(/;\s*;?\s*Lote$/i, "").trim(),
        poligonos: aneisDe(x.geometry),
      })),
    ].filter((x) => x.poligonos.some((a) => a.length >= 3)));
    p.catch(() => cacheUf.delete(chave));
    cacheUf.set(chave, p);
  }
  return cacheUf.get(chave)!;
}

/** Eixos do SNV perto do imóvel (caixa + margem de ~1 km). Só a versão vigente de cada trecho. */
async function eixosPerto(aneis: LonLat[][], f: typeof fetch): Promise<Feature[]> {
  const pts = aneis.flat();
  const lon = pts.map((p) => p[0]), lat = pts.map((p) => p[1]);
  const m = 0.01;
  // WFS 1.1.0 com EPSG:4326 por URN: caixa em lat/lon
  const bbox = [Math.min(...lat) - m, Math.min(...lon) - m, Math.max(...lat) + m, Math.max(...lon) + m].join(",") + ",urn:ogc:def:crs:EPSG::4326";
  const fs = await wfs(f, { typeName: "vgeo:vw_snv_rod", bbox, maxFeatures: "500", srsName: "urn:ogc:def:crs:EPSG::4326" });
  const hoje = new Date().toISOString().slice(0, 10);
  return fs.filter((x) => {
    const fim = String(x.properties?.dt_fim ?? "").slice(0, 10);
    return !fim || fim >= hoje;
  });
}

/**
 * Cruza o imóvel (anéis lon/lat) com as faixas do DNIT da UF e com os eixos do
 * SNV. Falha de rede vira exceção — quem chama mostra "DNIT indisponível" e
 * segue com o padrão (o DNIT é um extra, nunca trava o serviço).
 */
export async function consultarDnit(aneis: LonLat[][], uf: string | null, f: typeof fetch = fetch): Promise<ResultadoDnit> {
  const validos = aneis.filter((a) => a.length >= 3);
  if (!validos.length) return { faixas: [], invasoes: [], eixos: [] };
  const ref = validos[0][0];
  const P = planoLocal(ref);
  const imovel = validos.map((a) => a.map(P));
  const [faixasUf, eixos] = await Promise.all([uf ? faixasDaUf(uf, f) : Promise.resolve([]), eixosPerto(validos, f).catch(() => [] as Feature[])]);

  const faixas: ResultadoDnit["faixas"] = [];
  const invasoes = new Map<string, InvasaoDnit>();
  for (const fx of faixasUf) {
    const polsFx = fx.poligonos.map((a) => a.map(P));
    const d = Math.min(...polsFx.flatMap((pf) => imovel.map((im) => distAneis(im, pf))));
    if (!(d <= 300)) continue;
    faixas.push({ ...fx, distanciaM: Math.round(d * 10) / 10 });
    const area = intersecao(imovel.map(pol), polsFx.map(pol)).reduce((s, x) => s + areaPol(x), 0);
    if (area > 1) {
      const chave = `${fx.br}|${fx.origem}|${fx.documento}`;
      const ja = invasoes.get(chave);
      invasoes.set(chave, { br: fx.br, origem: fx.origem, documento: fx.documento, areaM2: Math.round(((ja?.areaM2 ?? 0) + area) * 100) / 100 });
    }
  }

  const porBr = new Map<string, EixoProximo>();
  for (const e of eixos) {
    const br = `BR-${String(e.properties?.Codigo_BR ?? "").padStart(3, "0")}`;
    for (const l of linhasDe(e.geometry)) {
      const lp = l.map(P);
      const d = Math.min(...imovel.map((im) => distAneis(im, lp, false)));
      const atual = porBr.get(br);
      if (d <= 500 && (!atual || d < atual.distanciaM)) {
        porBr.set(br, {
          br, distanciaM: Math.round(d * 10) / 10,
          administracao: (e.properties?.Administracao as string | null) ?? null,
          trecho: [e.properties?.Local_Inicio, e.properties?.Local_Fim].filter(Boolean).join(" → "),
        });
      }
    }
  }
  return {
    faixas: faixas.sort((a, b) => a.distanciaM - b.distanciaM),
    invasoes: [...invasoes.values()],
    eixos: [...porBr.values()].sort((a, b) => a.distanciaM - b.distanciaM),
  };
}

/** Menor distância (m) entre dois pontos lon/lat próximos — para textos. */
export const metrosEntre = (a: LonLat, b: LonLat): number => dist(planoLocal(a)(a), planoLocal(a)(b));
