// Edge Function consultar-sigef: traz do INCRA, na hora, as parcelas
// certificadas ao redor do imóvel e sincroniza a base local `parcelas_sigef`.
// A sobreposição em si continua no PostGIS (`sigef_consultar`): esta função só
// mantém a base em dia. Se o INCRA cair, a tela segue com a última cópia.
//
// Por que passa pelo servidor: o acervo fundiário não manda cabeçalho CORS.
// Serviço: WFS 1.0.0 do i3geo/MapServer, só GML2, coordenadas com 6 casas.
//
// Corpo: { imovel: GeoJSON MultiPolygon|Polygon (lon/lat), uf: "BA", margem_m?: 300 }
// Resposta: { ok, uf, caixa, camadas: [{ tema, parcelas, erro? }], guardadas, removidas, avisos }
import { createClient } from "@supabase/supabase-js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const OGC = "https://acervofundiario.incra.gov.br/i3geo/ogc.php";
const TEMAS = ["certificada_sigef_particular", "certificada_sigef_publico"];
const MAX_FEATURES = 2000;
const UFS = new Set("AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split(" "));

type Pos = [number, number];
type Anel = Pos[];
interface ParcelaWfs { codigo: string; situacao: string | null; registro: string | null; municipio: string | null; geometria: { type: "MultiPolygon"; coordinates: Anel[][] } }

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

const lerCoords = (txt: string): Anel =>
  txt.trim().split(/\s+/).map((par) => par.split(",").map(Number) as Pos).filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));

const campo = (bloco: string, nome: string): string | null => {
  const m = bloco.match(new RegExp(`<ms:${nome}>([^<]*)</ms:${nome}>`));
  const v = m?.[1]?.trim();
  return v ? v : null;
};

/** GML2 do MapServer → parcelas. Cada gml:Polygon vira um polígono do MultiPolygon. */
export function lerGml(xml: string): ParcelaWfs[] {
  const out: ParcelaWfs[] = [];
  for (const bloco of xml.split("<gml:featureMember>").slice(1)) {
    const codigo = campo(bloco, "parcela_codigo");
    if (!codigo) continue;
    const poligonos: Anel[][] = [];
    for (const pm of bloco.matchAll(/<gml:Polygon[^>]*>([\s\S]*?)<\/gml:Polygon>/g)) {
      const corpo = pm[1];
      const externo = corpo.match(/<gml:outerBoundaryIs>[\s\S]*?<gml:coordinates[^>]*>([^<]*)<\/gml:coordinates>/);
      if (!externo) continue;
      const aneis = [lerCoords(externo[1])];
      for (const im of corpo.matchAll(/<gml:innerBoundaryIs>[\s\S]*?<gml:coordinates[^>]*>([^<]*)<\/gml:coordinates>/g)) aneis.push(lerCoords(im[1]));
      if (aneis[0].length >= 4) poligonos.push(aneis.filter((a) => a.length >= 4));
    }
    if (!poligonos.length) continue;
    out.push({
      codigo,
      situacao: campo(bloco, "status"),
      registro: campo(bloco, "registro_data") ? `registrada em ${campo(bloco, "registro_data")}` : null,
      municipio: campo(bloco, "codigo_municipio") ? `IBGE ${campo(bloco, "codigo_municipio")}` : null,
      geometria: { type: "MultiPolygon", coordinates: poligonos },
    });
  }
  return out;
}

async function buscarTema(tema: string, caixa: number[]): Promise<{ parcelas: ParcelaWfs[]; truncado: boolean }> {
  const q = new URLSearchParams({
    tema, service: "WFS", version: "1.0.0", request: "GetFeature", typename: tema,
    bbox: caixa.map((v) => v.toFixed(6)).join(","), maxfeatures: String(MAX_FEATURES),
  });
  const r = await fetch(`${OGC}?${q}`, { signal: AbortSignal.timeout(25000) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`INCRA respondeu ${r.status}`);
  if (!txt.includes("FeatureCollection")) throw new Error(`resposta inesperada do INCRA: ${txt.slice(0, 160).replace(/\s+/g, " ")}`);
  const parcelas = lerGml(txt);
  const membros = (txt.match(/<gml:featureMember>/g) ?? []).length;
  return { parcelas, truncado: membros >= MAX_FEATURES };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { imovel, uf: ufBruta, margem_m } = await req.json();
    const uf = String(ufBruta ?? "").trim().toUpperCase();
    if (!UFS.has(uf)) return json({ erro: "Informe a UF do imóvel para consultar o SIGEF" }, 422);
    const caixa = caixaDe(imovel, Math.min(Math.max(Number(margem_m) || 300, 0), 3000));
    if (!caixa) return json({ erro: "Polígono do imóvel vazio" }, 422);

    const camadas: { tema: string; parcelas: number; erro?: string }[] = [];
    const todas = new Map<string, ParcelaWfs>();
    let completo = true;
    await Promise.all(TEMAS.map(async (base) => {
      const tema = `${base}_${uf.toLowerCase()}`;
      try {
        const { parcelas, truncado } = await buscarTema(tema, caixa);
        if (truncado) completo = false;
        for (const p of parcelas) todas.set(p.codigo, p);
        camadas.push({ tema, parcelas: parcelas.length });
      } catch (e) {
        completo = false;
        camadas.push({ tema, parcelas: 0, erro: e instanceof Error ? e.message : String(e) });
      }
    }));
    const ok = camadas.some((c) => !c.erro);
    const avisos = camadas.filter((c) => c.erro).map((c) => `${c.tema}: ${c.erro}`);
    if (!ok) return json({ ok, uf, caixa, camadas, guardadas: 0, removidas: 0, avisos });

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lote = [...todas.values()].map((p) => ({ ...p, uf, fonte: "wfs" }));
    const { data, error } = await supa.rpc("sigef_sincronizar", {
      parcelas: lote, x0: caixa[0], y0: caixa[1], x1: caixa[2], y1: caixa[3], remover: completo,
    });
    if (error) return json({ ok: false, uf, caixa, camadas, guardadas: 0, removidas: 0, avisos: [...avisos, `base local: ${error.message}`] });
    return json({ ok, uf, caixa, camadas, guardadas: data?.guardadas ?? 0, removidas: data?.removidas ?? 0, avisos });
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
