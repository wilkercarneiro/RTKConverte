// Edge Function consultar-sigef: traz do INCRA, na hora, as parcelas
// certificadas ao redor do imóvel e sincroniza a base local `parcelas_sigef`.
// A sobreposição em si continua no PostGIS (`sigef_consultar`): esta função só
// mantém a base em dia. Se o INCRA cair, a tela segue com a última cópia.
//
// Fonte: Geoportal do INCRA (GeoNode/GeoServer), camada única `geonode:sigef_geo`
// com todas as parcelas do SIGEF do país, em GeoJSON (EPSG:4674, 8 casas).
// Substitui o WFS do acervo fundiário (i3geo), cujo domínio saiu do DNS em 2026-10-28.
// Por que passa pelo servidor: o GeoServer não manda cabeçalho CORS.
//
// Corpo: { imovel: GeoJSON MultiPolygon|Polygon (lon/lat), uf: "BA", margem_m?: 300 }
// Resposta: { ok, uf, caixa, camadas: [{ tema, parcelas, erro? }], guardadas, removidas, avisos }
//
// Quem chama precisa estar logado (a chave pública do app não basta): a função
// grava, com service_role, na base que todas as empresas leem. E só APAGA da
// cópia oficial o que sumiu do INCRA quando a resposta veio inteira — nunca
// numa resposta cortada (pelo nosso limite ou pelo do GeoServer) nem vazia.
import { createClient } from "@supabase/supabase-js";
import { ehRecusa, exigirUsuario } from "../_shared/acesso.ts";
import type { ClienteUsuario } from "../_shared/acesso.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const OWS = "https://geoportal.incra.gov.br/geoserver/ows";
const CAMADA = "geonode:sigef_geo";
const MAX_FEATURES = 2000;
/** Lado máximo da caixa consultada (~55 km): um imóvel, não uma região. */
const MAX_LADO_GRAUS = 0.5;
const UFS = new Set("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" "));
// código IBGE da UF (uf_id da camada) → sigla
const UF_IBGE: Record<number, string> = {
  11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE", 24: "RN",
  25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP", 41: "PR", 42: "SC",
  43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF",
};

type Pos = [number, number];
type Anel = Pos[];
interface ParcelaWfs {
  codigo: string; nome: string | null; uf: string | null; codigo_imovel: string | null;
  situacao: string | null; registro: string | null; municipio: string | null;
  geometria: { type: "MultiPolygon"; coordinates: Anel[][] };
}
interface Feicao {
  properties?: Record<string, unknown>;
  geometry?: { type: string; coordinates: unknown } | null;
}

function caixaDe(geo: { type: string; coordinates: unknown }, margemM: number): [number, number, number, number] | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const visitar = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      if (Number.isFinite(x) && Number.isFinite(y)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    } else if (Array.isArray(c)) c.forEach(visitar);
  };
  visitar(geo?.coordinates);
  if (!Number.isFinite(x0)) return null;
  const dy = margemM / 111320;
  const dx = margemM / (111320 * Math.cos(((y0 + y1) / 2) * Math.PI / 180));
  return [x0 - dx, y0 - dy, x1 + dx, y1 + dy];
}

const texto = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s ? s : null;
};

/** Registro em uma linha: situação informada + matrícula/CNS ou transcrição. */
function registroDe(p: Record<string, unknown>): string | null {
  const partes = [
    texto(p.situacao_informada)?.toLowerCase(),
    texto(p.registro_matricula) ? `matrícula ${texto(p.registro_matricula)}` : null,
    texto(p.transcricao) ? `transcrição ${texto(p.transcricao)}` : null,
    texto(p.registro_cns) ? `CNS ${texto(p.registro_cns)}` : null,
  ].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

/** GeoJSON do GeoServer → parcelas. Polygon vira MultiPolygon de um polígono. */
export function lerGeoJson(fc: { features?: Feicao[] }): ParcelaWfs[] {
  const out: ParcelaWfs[] = [];
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    const codigo = texto(p.parcela_codigo);
    const g = f.geometry;
    if (!codigo || !g) continue;
    const poligonos = (g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []) as Anel[][];
    const validos = poligonos.map((pol) => pol.filter((a) => a.length >= 4)).filter((pol) => pol.length);
    if (!validos.length) continue;
    out.push({
      codigo,
      nome: texto(p.nome_area),
      uf: UF_IBGE[Number(p.uf_id)] ?? null,
      codigo_imovel: texto(p.codigo_imovel),
      situacao: texto(p.status),
      registro: registroDe(p),
      municipio: texto(p.municipio_id) ? `IBGE ${texto(p.municipio_id)}` : null,
      geometria: { type: "MultiPolygon", coordinates: validos },
    });
  }
  return out;
}

async function buscarCaixa(caixa: number[]): Promise<{ parcelas: ParcelaWfs[]; truncado: boolean }> {
  const q = new URLSearchParams({
    service: "WFS", version: "1.0.0", request: "GetFeature", typename: CAMADA, outputFormat: "application/json",
    bbox: caixa.map((v) => v.toFixed(8)).join(","), maxFeatures: String(MAX_FEATURES),
  });
  const r = await fetch(`${OWS}?${q}`, { signal: AbortSignal.timeout(25000) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`INCRA respondeu ${r.status}`);
  let fc: { type?: string; features?: Feicao[]; totalFeatures?: unknown; numberMatched?: unknown };
  try { fc = JSON.parse(txt); } catch { fc = {}; }
  if (fc.type !== "FeatureCollection") throw new Error(`resposta inesperada do INCRA: ${txt.slice(0, 160).replace(/\s+/g, " ")}`);
  return { parcelas: lerGeoJson(fc), truncado: respostaCortada(fc) };
}

/**
 * A resposta veio cortada? Pelo nosso limite, ou pelo do GeoServer (que pode ser
 * menor e não avisa no corpo, só nos totais quando os manda).
 */
export function respostaCortada(fc: { features?: unknown[]; totalFeatures?: unknown; numberMatched?: unknown }): boolean {
  const n = fc.features?.length ?? 0;
  if (n >= MAX_FEATURES) return true;
  for (const total of [fc.totalFeatures, fc.numberMatched]) {
    const t = Number(total);
    if (total != null && total !== "unknown" && Number.isFinite(t) && t > n) return true;
  }
  return false;
}

const clienteDoUsuario = (req: Request) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ClienteUsuario;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const quem = await exigirUsuario(clienteDoUsuario(req));
    if (ehRecusa(quem)) return json({ erro: quem.erro }, quem.status);
    const { imovel, uf: ufBruta, margem_m } = await req.json();
    const uf = String(ufBruta ?? "").trim().toUpperCase();
    if (!UFS.has(uf)) return json({ erro: "Informe a UF do imóvel para consultar o SIGEF" }, 422);
    const caixa = caixaDe(imovel, Math.min(Math.max(Number(margem_m) || 300, 0), 3000));
    if (!caixa) return json({ erro: "Polígono do imóvel vazio" }, 422);
    if (caixa[2] - caixa[0] > MAX_LADO_GRAUS || caixa[3] - caixa[1] > MAX_LADO_GRAUS) {
      return json({ erro: "Área grande demais para consultar o SIGEF de uma vez (mais de ~55 km de lado)." }, 422);
    }

    let parcelas: ParcelaWfs[] = [];
    let completo = true;
    const camada: { tema: string; parcelas: number; erro?: string } = { tema: CAMADA, parcelas: 0 };
    try {
      const r = await buscarCaixa(caixa);
      parcelas = r.parcelas;
      completo = !r.truncado;
      camada.parcelas = parcelas.length;
    } catch (e) {
      camada.erro = e instanceof Error ? e.message : String(e);
    }
    const camadas = [camada];
    const ok = !camada.erro;
    const avisos = camada.erro ? [`${CAMADA}: ${camada.erro}`] : [];
    if (!ok) return json({ ok, uf, caixa, camadas, guardadas: 0, removidas: 0, avisos });

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // parcela vizinha de outra UF (divisa de estado) fica com a UF dela
    const lote = parcelas.map((p) => ({ ...p, uf: p.uf ?? uf, fonte: "wfs" }));
    // resposta vazia não apaga nada: um INCRA instável pareceria "todas sumiram"
    const { data, error } = await supa.rpc("sigef_sincronizar", {
      parcelas: lote, x0: caixa[0], y0: caixa[1], x1: caixa[2], y1: caixa[3], remover: completo && lote.length > 0,
    });
    if (error) return json({ ok: false, uf, caixa, camadas, guardadas: 0, removidas: 0, avisos: [...avisos, `base local: ${error.message}`] });
    if (data?.remocao_suspensa > 0) {
      avisos.push(`${data.remocao_suspensa} parcela(s) da cópia local não vieram nesta consulta e foram mantidas (resposta do INCRA possivelmente incompleta).`);
    }
    return json({ ok, uf, caixa, camadas, guardadas: data?.guardadas ?? 0, removidas: data?.removidas ?? 0, avisos });
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
