// Análise de restrições do imóvel: o perímetro cruzado com as áreas protegidas
// e especiais das bases públicas (Terras Indígenas, Unidades de Conservação,
// assentamentos e territórios quilombolas, embargos do IBAMA e do ICMBio,
// faixa de fronteira, áreas militares e sítios arqueológicos).
//
// A pesquisa das fontes (URL, camada, CORS, como filtra, limitações) está em
// docs/restricoes-fontes.md. Todas respondem ao navegador (CORS conferido em
// 05/11/2026), então a consulta é feita daqui, como o DNIT (src/lib/dnit.ts):
// sem edge function e sem proxy.
//
// Regras:
//  - cada fonte tem um ou mais servidores, em ordem; o primeiro que responder
//    vale. Uma fonte fora do ar NÃO derruba as outras: o resultado dela diz
//    "não consultado: motivo";
//  - a área sai no MESMO motor do sistema: coordenadas UTM do fuso do serviço
//    (proj4 + utmDef, como em lonLatDoVertice) e área plana dessas coordenadas
//    (fórmula de Gauss, a de calcularAreaHa). A interseção vai pelo clipper do
//    loteamento, num plano transladado para a origem no 1º vértice (translação
//    não muda área);
//  - a consulta é a bases públicas, em escalas diferentes da do levantamento:
//    é um alerta, não certidão (o texto e o PDF dizem isso).
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../supabase/functions/_shared/geo.ts";
import { antiHorario, areaAssinada, dentroAnel, distSegmento, intersecao } from "./loteamento/geom.ts";
import type { Poligono, Pt } from "./loteamento/geom.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

export type LonLat = [number, number];

export type TipoRestricao =
  | "ti" | "uc" | "assentamento" | "quilombola" | "embargo_ibama" | "embargo_icmbio" | "fronteira" | "militar" | "arqueologico";

/** Uma área encontrada numa base pública (ainda sem o cruzamento com o imóvel). */
export interface Feicao {
  id: string;
  nome: string;
  /** linhas curtas para a lista e o PDF ("Fase: Regularizada") */
  detalhes: string[];
  /** polígonos lon/lat: cada um é [externo, ...furos] */
  poligonos: LonLat[][][];
  /** feição pontual (sítio arqueológico cadastrado como ponto) */
  pontos?: LonLat[];
  /** data da última atualização do registro na base, quando a base informa (AAAA-MM-DD) */
  atualizacao?: string | null;
  /** a área contém o imóvel inteiro (consulta "dentro de", sem baixar a geometria) */
  contemTudo?: boolean;
}

/** Caixa de busca lon/lat: [oeste, sul, leste, norte]. */
export type Caixa = [number, number, number, number];

export interface Servidor {
  /** quem publica o dado neste servidor, para o texto ("FUNAI — GeoServer") */
  nome: string;
  buscar: (caixa: Caixa, f: typeof fetch, imovel: Caixa) => Promise<{ feicoes: Feicao[]; cortada: boolean }>;
}

export interface FonteRestricao {
  tipo: TipoRestricao;
  rotulo: string;
  /** singular, para a prévia e os textos ("Terra Indígena") */
  singular: string;
  orgao: string;
  cor: string;
  servidores: Servidor[];
  /** o que o operador precisa saber sobre a base (escala, cobertura) */
  nota: string;
}

export type ClasseRestricao = "sobrepoe" | "encosta" | "livre" | "nao_consultado";

export interface ItemRestricao {
  tipo: TipoRestricao;
  id: string;
  nome: string;
  detalhes: string[];
  classe: "sobrepoe" | "encosta";
  /** área do imóvel dentro da restrição, m² (0 quando só encosta ou é ponto) */
  areaM2: number;
  /** % da área do imóvel */
  pct: number;
  /** menor distância entre o perímetro e a área, m (0 quando sobrepõe) */
  distanciaM: number;
  atualizacao: string | null;
  /** a área (recortada na caixa da consulta), lon/lat — para o mapa e o croqui */
  geometria: GeoJSON.MultiPolygon | null;
  /** o pedaço do imóvel dentro dela, lon/lat */
  sobreposta: GeoJSON.MultiPolygon | null;
  pontos: LonLat[];
}

export interface ResultadoFonte {
  tipo: TipoRestricao;
  rotulo: string;
  singular: string;
  orgao: string;
  cor: string;
  nota: string;
  classe: ClasseRestricao;
  /** o servidor que respondeu */
  servidor: string | null;
  /** por que não foi consultada (fora do ar, tempo esgotado, resposta inválida) */
  motivo: string | null;
  /** a resposta passou do limite de feições (há mais áreas na caixa do que as que vieram) */
  cortada: boolean;
  /** atualização mais recente entre os registros encontrados */
  atualizacao: string | null;
  itens: ItemRestricao[];
}

export interface ResultadoRestricoes {
  /** ISO da consulta */
  quando: string;
  fuso: number;
  areaImovelM2: number;
  encostaM: number;
  fontes: ResultadoFonte[];
}

export interface OpcoesRestricoes {
  /** fuso UTM do serviço (sem ele, o do centro do imóvel) */
  fuso?: number | null;
  /** "encosta" até esta distância do perímetro, m */
  encostaM?: number;
  /** quanto além do imóvel a consulta olha, m (o mapa mostra esta vizinhança) */
  margemM?: number;
  timeoutMs?: number;
  /** só estas fontes (padrão: todas) */
  tipos?: TipoRestricao[];
  fetch?: typeof fetch;
  agora?: Date;
}

/** Sobreposição menor que isto é ruído do recorte (m²). */
export const AREA_MINIMA_M2 = 1;
/** Abaixo deste % a sobreposição pode ser só a diferença de escala da base pública. */
export const PCT_PEQUENA = 0.5;

// ---------------------------------------------------------------------------
// Leitura das respostas
// ---------------------------------------------------------------------------

interface Feature { id?: string | number; properties?: Record<string, unknown> | null; geometry?: { type?: string; coordinates?: unknown } | null }

const txt = (v: unknown): string => (v === null || v === undefined ? "" : String(v).trim());

/** Polígonos de um Polygon/MultiPolygon do GeoJSON, em lon/lat (z some). */
export function poligonosDe(g: Feature["geometry"]): LonLat[][][] {
  if (!g?.coordinates) return [];
  const anel = (a: unknown) => ((a as number[][]) ?? []).filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1])).map((p) => [p[0], p[1]] as LonLat);
  const pol = (c: unknown) => ((c as unknown[]) ?? []).map(anel).filter((a) => a.length >= 3);
  if (g.type === "Polygon") return [pol(g.coordinates)].filter((p) => p.length);
  if (g.type === "MultiPolygon") return (g.coordinates as unknown[]).map(pol).filter((p) => p.length);
  return [];
}

function pontosDe(g: Feature["geometry"]): LonLat[] {
  if (!g?.coordinates) return [];
  if (g.type === "Point") { const c = g.coordinates as number[]; return [[c[0], c[1]]]; }
  if (g.type === "MultiPoint") return (g.coordinates as number[][]).map((c) => [c[0], c[1]] as LonLat);
  return [];
}

/** Data de registro em AAAA-MM-DD: aceita epoch (ms), "dd/mm/aaaa" e ISO; data no futuro é lixo da base. */
export function dataDe(v: unknown, agora = new Date()): string | null {
  if (v === null || v === undefined || v === "") return null;
  let d: Date | null = null;
  if (typeof v === "number" && Number.isFinite(v)) d = new Date(v);
  else {
    const s = String(v).trim();
    const br = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (br) d = new Date(Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1])));
    else if (iso) d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    else if (/^\d{10,13}$/.test(s)) d = new Date(Number(s));
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  if (d.getTime() > agora.getTime() + 864e5 || d.getUTCFullYear() < 1900) return null;
  return d.toISOString().slice(0, 10);
}

export const fmtData = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/** Mensagem curta, sem a URL inteira da consulta (centenas de caracteres). */
export function motivoCurto(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const curto = m.replace(/\(?https?:\/\/\S+\)?/g, "").replace(/\s+/g, " ").trim();
  if (/abort|timeout|tempo/i.test(curto)) return "tempo esgotado (o servidor não respondeu)";
  if (/failed to fetch|networkerror|fetch failed|load failed|ENOTFOUND|ECONNRE/i.test(curto)) return "servidor fora do ar ou inacessível";
  return curto.length > 140 ? `${curto.slice(0, 140)}…` : curto || "falha desconhecida";
}

async function lerJson(r: Response, quem: string): Promise<Record<string, unknown>> {
  if (!r.ok) throw new Error(`${quem} respondeu ${r.status}`);
  const t = await r.text();
  let j: Record<string, unknown>;
  try { j = JSON.parse(t); } catch { throw new Error(`${quem}: resposta inesperada (${t.slice(0, 80).replace(/\s+/g, " ")})`); }
  const erro = j.error as { message?: string; code?: number } | undefined;
  if (erro) throw new Error(`${quem}: ${erro.message ?? "erro"}${erro.code ? ` (${erro.code})` : ""}`);
  return j;
}

/** Consulta de feições numa camada do ArcGIS Server (query por envelope, GeoJSON em lon/lat). */
async function arcgis(f: typeof fetch, url: string, caixa: Caixa, campos: string[], extra: Record<string, string> = {}, max = 300) {
  const q = new URLSearchParams({
    geometry: caixa.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields: campos.join(","), outSR: "4326", returnGeometry: "true", f: "geojson", resultRecordCount: String(max), ...extra,
  });
  const j = await lerJson(await f(`${url}/query?${q}`), new URL(url).host);
  const features = (j.features as Feature[] | undefined) ?? [];
  const props = j.properties as { exceededTransferLimit?: boolean } | undefined;
  return { features, cortada: Boolean(props?.exceededTransferLimit ?? j.exceededTransferLimit) || features.length >= max };
}

/** Contagem no ArcGIS (sem baixar geometria). */
async function arcgisConta(f: typeof fetch, url: string, caixa: Caixa, rel: "esriSpatialRelIntersects" | "esriSpatialRelWithin"): Promise<number> {
  const q = new URLSearchParams({ geometry: caixa.join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: rel, returnCountOnly: "true", f: "json" });
  const j = await lerJson(await f(`${url}/query?${q}`), new URL(url).host);
  const n = Number(j.count);
  if (!Number.isFinite(n)) throw new Error(`${new URL(url).host}: contagem inválida`);
  return n;
}

/** GetFeature do WFS (GeoServer), caixa em lon/lat, GeoJSON. */
async function wfs(f: typeof fetch, base: string, typeName: string, caixa: Caixa, max = 300) {
  const q = new URLSearchParams({
    service: "WFS", version: "1.1.0", request: "GetFeature", typeName, outputFormat: "application/json",
    srsName: "EPSG:4326", maxFeatures: String(max), bbox: `${caixa.join(",")},EPSG:4326`,
  });
  const j = await lerJson(await f(`${base}?${q}`), new URL(base).host);
  if (j.type !== "FeatureCollection") throw new Error(`${new URL(base).host}: resposta inesperada`);
  const features = (j.features as Feature[] | undefined) ?? [];
  return { features, cortada: features.length >= max };
}

const linha = (rotulo: string, v: unknown) => (txt(v) ? `${rotulo}: ${txt(v)}` : "");
const limpar = (xs: string[]) => xs.filter(Boolean);

// ---------------------------------------------------------------------------
// Fontes (ver docs/restricoes-fontes.md)
// ---------------------------------------------------------------------------

export const PAMGIA = "https://pamgia.ibama.gov.br/server/rest/services";
export const FUNAI_WFS = "https://geoserver.funai.gov.br/geoserver/ows";
export const INDE_WFS = "https://geoservicos.inde.gov.br/geoserver/ows";
export const IBGE_WFS = "https://geoservicos.ibge.gov.br/geoserver/ows";
/** a versão do CNUC publicada pelo MMA na INDE (o nome da camada traz o mês) */
export const CAMADA_CNUC = "MMA:cnuc_2026_03";

const PAMGIA_SYNC = `${PAMGIA}/BasesSincronizadas`;
const PAMGIA_BASES = `${PAMGIA}/01_Publicacoes_Bases`;

/** Hosts que a análise chama (para a documentação e o teste de que nada mais é chamado). */
export const HOSTS_RESTRICOES = ["pamgia.ibama.gov.br", "geoserver.funai.gov.br", "geoservicos.inde.gov.br", "geoservicos.ibge.gov.br"];

type Mapear = (p: Record<string, unknown>, i: number) => Omit<Feicao, "poligonos" | "pontos">;

function servidorArcgis(nome: string, url: string, campos: string[], mapear: Mapear, pontos = false): Servidor {
  return {
    nome,
    buscar: async (caixa, f) => {
      const { features, cortada } = await arcgis(f, url, caixa, campos);
      return {
        cortada,
        feicoes: features.map((x, i): Feicao => ({
          ...mapear(x.properties ?? {}, i),
          poligonos: pontos ? [] : poligonosDe(x.geometry),
          pontos: pontos ? pontosDe(x.geometry) : undefined,
        })).filter((x) => x.poligonos.length || x.pontos?.length),
      };
    },
  };
}

function servidorWfs(nome: string, base: string, typeName: string, mapear: Mapear): Servidor {
  return {
    nome,
    buscar: async (caixa, f) => {
      const { features, cortada } = await wfs(f, base, typeName, caixa);
      return {
        cortada,
        feicoes: features.map((x, i): Feicao => ({ ...mapear(x.properties ?? {}, i), poligonos: poligonosDe(x.geometry) })).filter((x) => x.poligonos.length),
      };
    },
  };
}

const municipioUf = (m: unknown, uf: unknown) => [txt(m), txt(uf)].filter(Boolean).join("/");

const TI_FUNAI: Mapear = (p, i) => ({
  id: `ti:${txt(p.terrai_codigo) || i}`, nome: `TI ${txt(p.terrai_nome) || "sem nome"}`,
  detalhes: limpar([linha("Povo", p.etnia_nome), linha("Fase", p.fase_ti), linha("Modalidade", p.modalidade_ti), linha("Município", municipioUf(p.municipio_nome, p.uf_sigla))]),
  atualizacao: dataDe(p.data_atualizacao),
});
const TI_PAMGIA: Mapear = (p, i) => ({
  id: `ti:${txt(p.terrai_cod) || i}`, nome: `TI ${txt(p.terrai_nom) || "sem nome"}`,
  detalhes: limpar([linha("Povo", p.etnia_nome), linha("Fase", p.fase_ti), linha("Modalidade", p.modalidade), linha("Município", municipioUf(p.municipio_, p.uf_sigla))]),
  atualizacao: dataDe(p.data_atual),
});
const UC: Mapear = (p, i) => ({
  id: `uc:${txt(p.cd_cnuc) || txt(p.uc_id) || i}`, nome: txt(p.nome_uc) || "Unidade de Conservação",
  detalhes: limpar([
    [txt(p.categoria), txt(p.grupo)].filter(Boolean).join(" · "), linha("Esfera", p.esfera), linha("Criação", p.cria_ato),
    linha("CNUC", p.cd_cnuc), txt(p.municipio),
  ]),
  atualizacao: dataDe(p.dt_sync),
});

export const FONTES: FonteRestricao[] = [
  {
    tipo: "ti", rotulo: "Terras Indígenas", singular: "Terra Indígena", orgao: "FUNAI", cor: "#F97316",
    nota: "Todas as fases (em estudo, delimitada, declarada, homologada, regularizada). Base cartográfica da FUNAI, em geral 1:100.000.",
    servidores: [
      servidorWfs("FUNAI — GeoServer (tis_poligonais)", FUNAI_WFS, "Funai:tis_poligonais", TI_FUNAI),
      servidorArcgis("IBAMA/PAMGIA — cópia da base da FUNAI", `${PAMGIA_BASES}/lim_terra_indigena_a/MapServer/12`,
        ["terrai_cod", "terrai_nom", "etnia_nome", "fase_ti", "modalidade", "municipio_", "uf_sigla", "data_atual"], TI_PAMGIA),
    ],
  },
  {
    tipo: "uc", rotulo: "Unidades de Conservação", singular: "Unidade de Conservação", orgao: "MMA (CNUC) / ICMBio", cor: "#22C55E",
    nota: "Federais, estaduais e municipais cadastradas no CNUC. Não inclui a zona de amortecimento (só o limite da UC).",
    servidores: [
      servidorWfs(`MMA — CNUC na INDE (${CAMADA_CNUC.replace("MMA:", "")})`, INDE_WFS, CAMADA_CNUC, UC),
      servidorArcgis("IBAMA/PAMGIA — cópia sincronizada do CNUC", `${PAMGIA_SYNC}/lim_unidades_conservação_mma_a/FeatureServer/0`,
        ["uc_id", "cd_cnuc", "nome_uc", "cria_ato", "esfera", "municipio", "grupo", "categoria", "dt_sync"], UC),
    ],
  },
  {
    tipo: "assentamento", rotulo: "Assentamentos da reforma agrária", singular: "Assentamento", orgao: "INCRA", cor: "#EAB308",
    nota: "Perímetros dos projetos de assentamento do INCRA (SIPRA).",
    servidores: [
      servidorArcgis("IBAMA/PAMGIA — base sincronizada do INCRA", `${PAMGIA_SYNC}/lim_assentamentos_incra_a/FeatureServer/0`,
        ["cd_sipra", "nome_proje", "municipio", "uf", "fase", "data_de_cr", "num_famili", "dt_sync"],
        (p, i) => ({
          id: `pa:${txt(p.cd_sipra) || i}`, nome: txt(p.nome_proje) || "Projeto de assentamento",
          detalhes: limpar([linha("Código SIPRA", p.cd_sipra), linha("Criação", p.data_de_cr), linha("Famílias", p.num_famili), linha("Município", municipioUf(p.municipio, p.uf))]),
          atualizacao: dataDe(p.dt_sync),
        })),
      servidorArcgis("IBAMA/PAMGIA — cópia da base do INCRA", `${PAMGIA_BASES}/assentamentos_incra/MapServer/1`,
        ["cd_sipra", "nome_proje", "municipio", "uf", "data_de_cr", "num_famili", "descricao_"],
        (p, i) => ({
          id: `pa:${txt(p.cd_sipra) || i}`, nome: txt(p.nome_proje) || "Projeto de assentamento",
          detalhes: limpar([linha("Código SIPRA", p.cd_sipra), txt(p.descricao_), linha("Criação", p.data_de_cr), linha("Município", municipioUf(p.municipio, p.uf))]),
          atualizacao: null,
        })),
    ],
  },
  {
    tipo: "quilombola", rotulo: "Territórios quilombolas", singular: "Território quilombola", orgao: "INCRA", cor: "#A855F7",
    nota: "Áreas com RTID publicado, portaria, decreto ou título (INCRA). Comunidades só certificadas pela Fundação Palmares, sem território delimitado, não aparecem.",
    servidores: [
      servidorArcgis("IBAMA/PAMGIA — base sincronizada do INCRA", `${PAMGIA_SYNC}/lim_quilombos_incra_a/FeatureServer/0`,
        ["cd_quilomb", "nm_comunid", "nm_municip", "cd_uf", "fase", "esfera", "nr_process", "st_titulad", "dt_sync"],
        (p, i) => ({
          id: `qui:${txt(p.cd_quilomb) || i}`, nome: `Quilombo ${txt(p.nm_comunid) || "sem nome"}`,
          detalhes: limpar([linha("Fase", p.fase), txt(p.st_titulad) === "T" ? "Titulado" : "", linha("Processo", p.nr_process), linha("Município", municipioUf(p.nm_municip, p.cd_uf))]),
          atualizacao: dataDe(p.dt_sync),
        })),
      servidorWfs("IBGE — territórios quilombolas (Censo 2022)", IBGE_WFS, "CGMAT:qg_2022_620_territorioquilombola__v02",
        (p, i) => ({
          id: `qui:ibge:${txt(p.cd_tq) || i}`, nome: `Quilombo ${txt(p.nm_tq) || "sem nome"}`,
          detalhes: limpar([linha("Situação", p.status), linha("UF", p.sg_uf), "Recorte do Censo 2022 (IBGE)"]),
          atualizacao: null,
        })),
    ],
  },
  {
    tipo: "embargo_ibama", rotulo: "Áreas embargadas pelo IBAMA", singular: "Área embargada (IBAMA)", orgao: "IBAMA", cor: "#EF4444",
    nota: "Polígonos dos termos de embargo do IBAMA. Nome e CPF/CNPJ do embargado não são trazidos para o relatório.",
    servidores: [
      servidorArcgis("IBAMA/PAMGIA — embargos (SISCOM)", `${PAMGIA_BASES}/adm_embargos_ibama_a/MapServer/0`,
        ["num_tad", "serie_tad", "dat_embargo", "municipio", "uf", "qtd_area_embargada", "des_tipo_bioma", "dat_ult_alteracao"],
        (p, i) => ({
          id: `emb:${txt(p.num_tad) || i}${txt(p.serie_tad)}`, nome: `Embargo IBAMA nº ${[txt(p.num_tad), txt(p.serie_tad)].filter(Boolean).join("-") || "s/n"}`,
          detalhes: limpar([
            p.dat_embargo ? `Data do embargo: ${fmtData(dataDe(p.dat_embargo))}` : "",
            Number(p.qtd_area_embargada) > 0 ? `Área embargada: ${fmtNum(Number(p.qtd_area_embargada), 2)} ha` : "",
            linha("Município", municipioUf(p.municipio, p.uf)), linha("Bioma", p.des_tipo_bioma),
          ]),
          atualizacao: dataDe(p.dat_ult_alteracao),
        })),
    ],
  },
  {
    tipo: "embargo_icmbio", rotulo: "Áreas embargadas pelo ICMBio", singular: "Área embargada (ICMBio)", orgao: "ICMBio", cor: "#F43F5E",
    nota: "Embargos lavrados pelo ICMBio (em geral dentro ou no entorno de UCs federais). Nome e CPF/CNPJ do autuado não são trazidos.",
    servidores: [
      servidorArcgis("IBAMA/PAMGIA — base sincronizada do ICMBio", `${PAMGIA_SYNC}/lim_embargos_icmbio_a/FeatureServer/0`,
        ["num_emb", "serie", "nome_uc", "municipio", "uf", "data", "processo", "dt_sync"],
        (p, i) => ({
          id: `embi:${txt(p.num_emb) || i}${txt(p.serie)}`, nome: `Embargo ICMBio nº ${[txt(p.num_emb), txt(p.serie)].filter(Boolean).join("-") || "s/n"}`,
          detalhes: limpar([linha("UC", p.nome_uc), p.data ? `Data: ${fmtData(dataDe(p.data))}` : "", linha("Processo", p.processo), linha("Município", municipioUf(p.municipio, p.uf))]),
          atualizacao: dataDe(p.dt_sync),
        })),
      servidorArcgis("IBAMA/PAMGIA — embargos do ICMBio (2022)", `${PAMGIA_BASES}/adm_embargo_icmbio_a/MapServer/0`,
        ["numero_ai", "serie", "nome_uc", "municipio", "uf", "data_auto", "nr_process"],
        (p, i) => ({
          id: `embi:${txt(p.numero_ai) || i}${txt(p.serie)}`, nome: `Embargo ICMBio (AI ${[txt(p.numero_ai), txt(p.serie)].filter(Boolean).join("-") || "s/n"})`,
          detalhes: limpar([linha("UC", p.nome_uc), p.data_auto ? `Data: ${fmtData(dataDe(p.data_auto))}` : "", linha("Município", municipioUf(p.municipio, p.uf))]),
          atualizacao: null,
        })),
    ],
  },
  {
    tipo: "fronteira", rotulo: "Faixa de fronteira", singular: "Faixa de fronteira", orgao: "IBGE", cor: "#3B82F6",
    nota: "Faixa de 150 km ao longo da fronteira terrestre (Lei 6.634/1979): alienação e concessão de terras dependem de assentimento prévio.",
    servidores: [{
      nome: "IBAMA/PAMGIA — faixa de fronteira do IBGE",
      buscar: async (_caixa, f, imovel) => {
        const url = `${PAMGIA_SYNC}/lim_faixa_fronteira_ibge_a/FeatureServer/0`;
        // A faixa é UM polígono do tamanho do país (9 MB): primeiro só conta.
        if ((await arcgisConta(f, url, imovel, "esriSpatialRelIntersects")) === 0) return { feicoes: [], cortada: false };
        const nome = "Faixa de Fronteira (150 km)";
        const detalhes = ["Lei 6.634/1979 e Decreto 85.064/1980"];
        if ((await arcgisConta(f, url, imovel, "esriSpatialRelWithin")) > 0) {
          return { cortada: false, feicoes: [{ id: "fronteira", nome, detalhes, poligonos: [], contemTudo: true, atualizacao: null }] };
        }
        // na borda dos 150 km: a geometria generalizada (~20 m) basta para o percentual
        const { features } = await arcgis(f, url, imovel, ["nome"], { maxAllowableOffset: "0.0002" }, 5);
        return {
          cortada: false,
          feicoes: features.map((x): Feicao => ({ id: "fronteira", nome, detalhes: [...detalhes, "Limite generalizado (~20 m) na borda da faixa"], poligonos: poligonosDe(x.geometry), atualizacao: null })),
        };
      },
    }],
  },
  {
    tipo: "militar", rotulo: "Áreas militares", singular: "Área militar", orgao: "Ministério da Defesa (via SFB)", cor: "#64748B",
    nota: "Áreas de uso militar do Cadastro Nacional de Florestas Públicas (SFB). Base antiga e incompleta: não exclui consulta às Forças Armadas.",
    servidores: [
      servidorArcgis("IBAMA/PAMGIA — áreas militares (SFB)", `${PAMGIA_BASES}/lim_uso_militar_a/MapServer/15`,
        ["objectid", "nome", "orgao", "estagio", "categoria", "uf", "ano"],
        (p, i) => ({
          id: `mil:${txt(p.objectid) || i}`, nome: txt(p.nome) || "Área militar",
          detalhes: limpar([txt(p.orgao), linha("Estágio", p.estagio), linha("UF", p.uf), linha("Ano", p.ano)]),
          atualizacao: null,
        })),
    ],
  },
  {
    tipo: "arqueologico", rotulo: "Sítios arqueológicos", singular: "Sítio arqueológico", orgao: "IPHAN", cor: "#B45309",
    nota: "Sítios cadastrados no IPHAN (SICG/CNSA), como polígono ou ponto. Sítio é bem da União (Lei 3.924/1961): obra exige manifestação do IPHAN.",
    servidores: [{
      nome: "IBAMA/PAMGIA — base sincronizada do IPHAN",
      buscar: async (caixa, f) => {
        const mapear: Mapear = (p, i) => ({
          id: `arq:${txt(p.co_iphan) || txt(p.id_bem) || i}`, nome: txt(p.identificacao_bem ?? p.identifica) || "Sítio arqueológico",
          detalhes: limpar([linha("Código IPHAN", p.co_iphan), linha("Classificação", p.ds_classificacao ?? p.ds_classif), (p.dt_cadastro ?? p.dt_cadastr) ? `Cadastro: ${fmtData(dataDe(p.dt_cadastro ?? p.dt_cadastr))}` : ""]),
          atualizacao: dataDe(p.dt_sync),
        });
        const [pol, pts] = await Promise.all([
          servidorArcgis("", `${PAMGIA_SYNC}/lim_sitios_arqueologicos_iphan_a/FeatureServer/0`, ["id_bem", "identificacao_bem", "co_iphan", "ds_classificacao", "dt_cadastro"], mapear).buscar(caixa, f, caixa),
          servidorArcgis("", `${PAMGIA_SYNC}/loc_sitios_arqueologicos_iphan_p/FeatureServer/0`, ["id_bem", "identifica", "co_iphan", "ds_classif", "dt_cadastr", "dt_sync"], mapear, true).buscar(caixa, f, caixa),
        ]);
        // o mesmo sítio pode vir nas duas camadas: vale o polígono
        const ids = new Set(pol.feicoes.map((x) => x.id));
        return { cortada: pol.cortada || pts.cortada, feicoes: [...pol.feicoes, ...pts.feicoes.filter((x) => !ids.has(x.id))] };
      },
    }],
  },
];

export const FONTE_POR_TIPO = Object.fromEntries(FONTES.map((f) => [f.tipo, f])) as Record<TipoRestricao, FonteRestricao>;

// ---------------------------------------------------------------------------
// Geometria
// ---------------------------------------------------------------------------

export const fusoDoLon = (lon: number): number => Math.min(25, Math.max(18, Math.floor((lon + 180) / 6) + 1));

/** Área plana (m²) de anéis UTM — a mesma conta de calcularAreaHa (Gauss), parte por parte. */
export function areaUtmM2(aneisUtm: Pt[][]): number {
  return aneisUtm.reduce((s, a) => s + Math.abs(areaAssinada(a)), 0);
}

interface Plano {
  fuso: number;
  ida: (p: LonLat) => Pt;
  volta: (p: Pt) => LonLat;
}

function plano(fuso: number, origemLonLat: LonLat): Plano {
  const def = utmDef(fuso);
  const o = proj(GEO_DEF, def, origemLonLat);
  return {
    fuso,
    ida: (p) => { const u = proj(GEO_DEF, def, p); return [u[0] - o[0], u[1] - o[1]]; },
    volta: (p) => proj(def, GEO_DEF, [p[0] + o[0], p[1] + o[1]]) as LonLat,
  };
}

const semFecho = (a: Pt[]): Pt[] => (a.length > 1 && a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1] ? a.slice(0, -1) : a);

function paraPoligono(pol: Pt[][]): Poligono {
  const [ext, ...furos] = pol.map(semFecho);
  return { ext: antiHorario(ext), furos: furos.map((f) => (areaAssinada(f) > 0 ? [...f].reverse() : f)) };
}

function distAneis(a: Pt[], b: Pt[]): number {
  let d = Infinity;
  for (const p of a) for (let i = 0; i < b.length; i++) d = Math.min(d, distSegmento(p, b[i], b[(i + 1) % b.length]).d);
  for (const p of b) for (let i = 0; i < a.length; i++) d = Math.min(d, distSegmento(p, a[i], a[(i + 1) % a.length]).d);
  return d;
}

const areaPoligono = (p: Poligono) => areaAssinada(p.ext) + p.furos.reduce((s, f) => s + areaAssinada(f), 0);

function multiPoligono(pols: Poligono[], P: Plano): GeoJSON.MultiPolygon | null {
  if (!pols.length) return null;
  const anel = (a: Pt[]) => { const ll = a.map(P.volta); return [...ll, ll[0]]; };
  return { type: "MultiPolygon", coordinates: pols.map((p) => [anel(p.ext), ...p.furos.map(anel)]) };
}

const caixaRet = (min: Pt, max: Pt): Poligono => ({ ext: [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]], furos: [] });

function comTempo<T>(p: Promise<T>, ms: number, ctl: AbortController): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => { t = setTimeout(() => { ctl.abort(); rej(new Error("tempo esgotado")); }, ms); }),
  ]).finally(() => clearTimeout(t));
}

// ---------------------------------------------------------------------------
// A consulta
// ---------------------------------------------------------------------------

/**
 * Cruza o imóvel (anéis lon/lat, um por parte) com cada fonte. Nunca rejeita
 * por falha de uma fonte: ela volta como "nao_consultado" com o motivo.
 */
export async function consultarRestricoes(aneis: LonLat[][], opcoes: OpcoesRestricoes = {}): Promise<ResultadoRestricoes> {
  const encostaM = opcoes.encostaM ?? 300;
  const margemM = Math.max(opcoes.margemM ?? 1500, encostaM + 100);
  const timeoutMs = opcoes.timeoutMs ?? 25_000;
  const f0 = opcoes.fetch ?? fetch;
  const agora = opcoes.agora ?? new Date();
  const validos = aneis.map(semFechoLL).filter((a) => a.length >= 3);
  const fontes = FONTES.filter((x) => !opcoes.tipos || opcoes.tipos.includes(x.tipo));
  const base = { quando: agora.toISOString(), encostaM };
  if (!validos.length) return { ...base, fuso: opcoes.fuso ?? 24, areaImovelM2: 0, fontes: [] };

  const todos = validos.flat();
  const lon0 = todos.reduce((s, p) => s + p[0], 0) / todos.length;
  const fuso = opcoes.fuso && opcoes.fuso >= 18 && opcoes.fuso <= 25 ? opcoes.fuso : fusoDoLon(lon0);
  const P = plano(fuso, validos[0][0]);
  const imovelUtm = validos.map((a) => a.map(P.ida));
  const imovel = imovelUtm.map((a) => paraPoligono([a]));
  const areaImovelM2 = areaUtmM2(imovelUtm);

  // caixa da consulta: o imóvel mais a margem, em metros e em lon/lat
  const xs = imovelUtm.flat().map((p) => p[0]), ys = imovelUtm.flat().map((p) => p[1]);
  const min: Pt = [Math.min(...xs) - margemM, Math.min(...ys) - margemM], max: Pt = [Math.max(...xs) + margemM, Math.max(...ys) + margemM];
  const vista = caixaRet(min, max);
  const cantos = [min, [max[0], min[1]], max, [min[0], max[1]]].map((p) => P.volta(p as Pt));
  const caixa: Caixa = [Math.min(...cantos.map((c) => c[0])), Math.min(...cantos.map((c) => c[1])), Math.max(...cantos.map((c) => c[0])), Math.max(...cantos.map((c) => c[1]))];
  const lls = todos;
  const caixaImovel: Caixa = [Math.min(...lls.map((p) => p[0])), Math.min(...lls.map((p) => p[1])), Math.max(...lls.map((p) => p[0])), Math.max(...lls.map((p) => p[1]))];

  const cruzar = (fonte: FonteRestricao, x: Feicao): ItemRestricao | null => {
    const comum = { tipo: fonte.tipo, id: x.id, nome: x.nome, detalhes: x.detalhes, atualizacao: x.atualizacao ?? null };
    if (x.contemTudo) {
      return { ...comum, classe: "sobrepoe", areaM2: areaImovelM2, pct: 100, distanciaM: 0, geometria: null, sobreposta: multiPoligono(imovel, P), pontos: [] };
    }
    if (x.pontos?.length) {
      const pts = x.pontos.map(P.ida);
      const dentro = pts.some((p) => imovel.some((im) => dentroAnel(p, im.ext)));
      const d = dentro ? 0 : Math.min(...pts.flatMap((p) => imovelUtm.map((a) => distAneis([p], a))));
      if (!dentro && !(d <= encostaM)) return null;
      return { ...comum, classe: dentro ? "sobrepoe" : "encosta", areaM2: 0, pct: 0, distanciaM: Math.round(d * 10) / 10, geometria: null, sobreposta: null, pontos: x.pontos };
    }
    // recorta na vista: geometria limitada (TI de milhões de ha vira o pedaço perto do imóvel)
    const pols = intersecao(x.poligonos.map((pol) => paraPoligono(pol.map((a) => a.map(P.ida)))), [vista]);
    if (!pols.length) return null;
    const sobre = intersecao(imovel, pols);
    const area = sobre.reduce((s, p) => s + areaPoligono(p), 0);
    if (area >= AREA_MINIMA_M2) {
      return {
        ...comum, classe: "sobrepoe", areaM2: area, pct: areaImovelM2 > 0 ? Math.min(100, (area / areaImovelM2) * 100) : 0, distanciaM: 0,
        geometria: multiPoligono(pols, P), sobreposta: multiPoligono(sobre, P), pontos: [],
      };
    }
    const d = Math.min(...pols.flatMap((pg) => [pg.ext, ...pg.furos]).flatMap((a) => imovelUtm.map((im) => distAneis(im, a))));
    if (!(d <= encostaM)) return null;
    return { ...comum, classe: "encosta", areaM2: 0, pct: 0, distanciaM: Math.round(d * 10) / 10, geometria: multiPoligono(pols, P), sobreposta: null, pontos: [] };
  };

  const consultarFonte = async (fonte: FonteRestricao): Promise<ResultadoFonte> => {
    const r: ResultadoFonte = {
      tipo: fonte.tipo, rotulo: fonte.rotulo, singular: fonte.singular, orgao: fonte.orgao, cor: fonte.cor, nota: fonte.nota,
      classe: "nao_consultado", servidor: null, motivo: null, cortada: false, atualizacao: null, itens: [],
    };
    const motivos: string[] = [];
    const tentativas = fonte.servidores.flatMap((s) => [s, s]);
    for (let k = 0; k < tentativas.length; k++) {
      const s = tentativas[k];
      // a 2ª tentativa no mesmo servidor só vale para erro 5xx passageiro (o ArcGIS do IBAMA dá 500 de vez em quando)
      if (k % 2 === 1 && !/respondeu 5\d\d/.test(motivos[motivos.length - 1] ?? "")) continue;
      if (k % 2 === 1) motivos.pop();
      const ctl = new AbortController();
      const f: typeof fetch = (u, init) => f0(u, { ...(init ?? {}), signal: ctl.signal });
      try {
        const { feicoes, cortada } = await comTempo(s.buscar(caixa, f, caixaImovel), timeoutMs, ctl);
        const porId = new Map<string, ItemRestricao>();
        for (const x of feicoes) {
          const it = cruzar(fonte, x);
          if (!it) continue;
          // a mesma área em vários pedaços (MultiPolygon partido pela base): soma
          const ja = porId.get(it.id);
          if (!ja) { porId.set(it.id, it); continue; }
          if (it.classe === "sobrepoe" || ja.classe === "sobrepoe") {
            const soma = (ja.classe === "sobrepoe" ? ja.areaM2 : 0) + (it.classe === "sobrepoe" ? it.areaM2 : 0);
            porId.set(it.id, {
              ...ja, classe: soma >= AREA_MINIMA_M2 || ja.classe === "sobrepoe" || it.classe === "sobrepoe" ? "sobrepoe" : ja.classe, areaM2: soma,
              pct: areaImovelM2 > 0 ? Math.min(100, (soma / areaImovelM2) * 100) : 0, distanciaM: 0,
              geometria: juntar(ja.geometria, it.geometria), sobreposta: juntar(ja.sobreposta, it.sobreposta), pontos: [...ja.pontos, ...it.pontos],
            });
          } else if (it.distanciaM < ja.distanciaM) porId.set(it.id, { ...it, geometria: juntar(ja.geometria, it.geometria) });
        }
        r.itens = [...porId.values()].sort((a, b) => (a.classe === b.classe ? b.areaM2 - a.areaM2 || a.distanciaM - b.distanciaM : a.classe === "sobrepoe" ? -1 : 1));
        r.classe = r.itens.some((i) => i.classe === "sobrepoe") ? "sobrepoe" : r.itens.length ? "encosta" : "livre";
        r.servidor = s.nome;
        r.cortada = cortada;
        r.atualizacao = feicoes.map((x) => x.atualizacao ?? "").filter(Boolean).sort().pop() ?? null;
        r.motivo = motivos.length ? `servidor principal indisponível (${motivos.join("; ")}); usada a cópia` : null;
        return r;
      } catch (e) {
        motivos.push(motivoCurto(e));
      }
    }
    r.motivo = motivos.join("; ") || "sem servidor";
    return r;
  };

  return { ...base, fuso, areaImovelM2, fontes: await Promise.all(fontes.map(consultarFonte)) };
}

function semFechoLL(a: LonLat[]): LonLat[] {
  const b = a.filter((p) => Number.isFinite(p?.[0]) && Number.isFinite(p?.[1]));
  return b.length > 1 && b[0][0] === b[b.length - 1][0] && b[0][1] === b[b.length - 1][1] ? b.slice(0, -1) : b;
}

function juntar(a: GeoJSON.MultiPolygon | null, b: GeoJSON.MultiPolygon | null): GeoJSON.MultiPolygon | null {
  if (!a) return b;
  if (!b) return a;
  return { type: "MultiPolygon", coordinates: [...a.coordinates, ...b.coordinates] };
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

export function fmtNum(v: number, casas: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
export const fmtHa = (m2: number): string => `${fmtNum(m2 / 10000, 4)} ha`;
export const fmtPct = (p: number): string => `${fmtNum(p, p > 0 && p < 0.01 ? 4 : 2)}%`;
export const fmtM = (m: number): string => `${fmtNum(m, m < 10 ? 1 : 0)} m`;

/** Minúsculas no meio da frase, sem estragar sigla: "Área embargada (IBAMA)" → "área embargada (IBAMA)". */
export const minusculas = (s: string): string =>
  s.split(" ").map((w) => (/^\(?[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}\)?$/.test(w) ? w : w.toLowerCase())).join(" ");

export const ROTULO_CLASSE: Record<ClasseRestricao, string> = {
  sobrepoe: "Sobrepõe", encosta: "Encosta", livre: "Livre", nao_consultado: "Não consultado",
};

/** A frase de um item ("sobrepõe 12,3456 ha (4,10% do imóvel)" / "a 85 m do perímetro"). */
export function textoItem(it: ItemRestricao): string {
  if (it.classe === "encosta") return `a ${fmtM(it.distanciaM)} do perímetro, sem sobreposição`;
  if (it.pontos.length && it.areaM2 === 0) return "ponto cadastrado dentro do imóvel";
  if (it.pct >= 99.995) return `o imóvel inteiro está dentro (${fmtHa(it.areaM2)})`;
  const pequena = it.pct < PCT_PEQUENA ? " — pequena: pode ser só a diferença de escala da base pública; confira em campo" : "";
  return `sobrepõe ${fmtHa(it.areaM2)} (${fmtPct(it.pct)} do imóvel)${pequena}`;
}

/** Uma linha por fonte, para a lista e o PDF. */
export function textoFonte(f: ResultadoFonte, encostaM: number): string {
  if (f.classe === "nao_consultado") return `não consultado: ${f.motivo ?? "sem resposta"}`;
  if (f.classe === "livre") return `nenhuma área a menos de ${fmtM(encostaM)} do imóvel`;
  const s = f.itens.filter((i) => i.classe === "sobrepoe");
  if (s.length) {
    const area = s.reduce((t, i) => t + i.areaM2, 0);
    if (s.every((i) => i.pontos.length && i.areaM2 === 0)) return `${s.length === 1 ? "1 registro" : `${s.length} registros`} dentro do imóvel`;
    return `${s.length === 1 ? "1 área sobrepõe" : `${s.length} áreas sobrepõem`} o imóvel${area > 0 ? ` (${fmtHa(area)})` : ""}`;
  }
  return `${f.itens.length === 1 ? "1 área" : `${f.itens.length} áreas`} a menos de ${fmtM(encostaM)}, sem sobreposição`;
}

/** Resumo geral para o cabeçalho do cartão. */
export function resumoRestricoes(r: ResultadoRestricoes): { sobrepoe: ResultadoFonte[]; encosta: ResultadoFonte[]; livres: ResultadoFonte[]; naoConsultadas: ResultadoFonte[]; texto: string } {
  const por = (c: ClasseRestricao) => r.fontes.filter((f) => f.classe === c);
  const sobrepoe = por("sobrepoe"), encosta = por("encosta"), livres = por("livre"), naoConsultadas = por("nao_consultado");
  const partes: string[] = [];
  if (sobrepoe.length) partes.push(`sobrepõe ${sobrepoe.map((f) => minusculas(f.singular)).join(", ")}`);
  if (encosta.length) partes.push(`encosta em ${encosta.map((f) => minusculas(f.singular)).join(", ")}`);
  if (!sobrepoe.length && !encosta.length && (livres.length || !naoConsultadas.length)) partes.push("nenhuma restrição encontrada nas bases consultadas");
  if (naoConsultadas.length) partes.push(`${naoConsultadas.length} base(s) não consultada(s)`);
  const t = partes.join("; ");
  return { sobrepoe, encosta, livres, naoConsultadas, texto: t.charAt(0).toUpperCase() + t.slice(1) + "." };
}

/**
 * A prévia grátis do Novo serviço: por tipo, só "tem / não tem sobreposição"
 * (null = não deu para consultar). Nome, área e % ficam para o serviço.
 */
export function previaRestricoes(r: ResultadoRestricoes): { tipo: TipoRestricao; rotulo: string; cor: string; tem: boolean | null }[] {
  return r.fontes.map((f) => ({ tipo: f.tipo, rotulo: f.rotulo, cor: f.cor, tem: f.classe === "nao_consultado" ? null : f.classe === "sobrepoe" }));
}

/** Camadas para o mapa interativo: a área (recortada na vista) e o pedaço sobreposto, com a cor do tipo. */
export interface CamadaRestricao {
  tipo: TipoRestricao;
  cor: string;
  nome: string;
  rotulo: string;
  geometria: GeoJSON.MultiPolygon | null;
  sobreposta: GeoJSON.MultiPolygon | null;
  pontos: LonLat[];
}

export function camadasDoResultado(r: ResultadoRestricoes | null): CamadaRestricao[] {
  if (!r) return [];
  return r.fontes.flatMap((f) => f.itens.map((i) => ({ tipo: f.tipo, cor: f.cor, nome: i.nome, rotulo: f.singular, geometria: i.geometria, sobreposta: i.sobreposta, pontos: i.pontos })));
}

export const AVISO_RESTRICOES =
  "Consulta automática a bases públicas, em escalas e datas próprias de cada órgão. É um alerta para orientar o trabalho: não substitui certidão, consulta formal aos órgãos nem a vistoria em campo.";
