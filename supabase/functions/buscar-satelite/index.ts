// Edge Function buscar-satelite: busca a imagem de satélite da PLANTA DE
// SITUAÇÃO pelas coordenadas do imóvel (e de cada gleba) e guarda no Storage
// no MESMO lugar em que o upload manual guardava —
// `gerados/{servico}/entrada/satelite.png` e `satelite-gleba-{k}.png`. Assim
// gerar-documentos e gerar-planta não sabem se a imagem veio da API ou da mão
// do operador; e o upload continua valendo como troca.
//
// Corpo: { servico_id, imovel?: boolean, glebas?: number[], faltantes?: boolean }
//   imovel     → (re)busca a do imóvel inteiro
//   glebas     → (re)busca as das glebas k (1-based, posição entre as fechadas)
//   faltantes  → só o que ainda não existe em entrada/ (é o que a tela chama ao abrir)
// Resposta: { gerados: [{ alvo: "imovel" | k, nome, tipo }], avisos: string[] }
//
// Segredo: MAPBOX_TOKEN (Mapbox Static Images).
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import { GEO_DEF, gmsToDeg, parseGmsPlanilha, utmDef } from "../_shared/geo.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { urlImagemSatelite } from "../_shared/satelite.ts";
import type { LonLat } from "../_shared/satelite.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

interface VertRow { ordem: number; e: number | string | null; n: number | string | null; lat_gms: string | null; lon_gms: string | null }
interface GlebaRow { nome: string | null; anel: [number, number][] | null }

/** Fuso do serviço, ou o deduzido da longitude do 1º vértice com GMS; 24 no escuro (BA/SE/AL/PE). */
function fusoDoServico(fusoServico: number | null, verts: VertRow[]): number {
  if (fusoServico) return fusoServico;
  const v = verts.find((x) => x.lon_gms);
  if (v?.lon_gms) {
    try { return Math.floor((gmsToDeg(parseGmsPlanilha(v.lon_gms)) + 180) / 6) + 1; } catch { /* cai no padrão */ }
  }
  return 24;
}

/** Anel do imóvel em [lon, lat]: o GMS gravado quando há; senão E/N re-projetado. */
function anelDosVertices(verts: VertRow[], fuso: number): LonLat[] {
  const out: LonLat[] = [];
  for (const v of verts) {
    if (v.lat_gms && v.lon_gms) {
      try {
        out.push([gmsToDeg(parseGmsPlanilha(v.lon_gms)), gmsToDeg(parseGmsPlanilha(v.lat_gms))]);
        continue;
      } catch { /* GMS ilegível: tenta E/N */ }
    }
    if (v.e != null && v.n != null) out.push(proj4(utmDef(fuso), GEO_DEF, [Number(v.e), Number(v.n)]));
  }
  return out;
}

function anelDaGleba(anel: [number, number][], fuso: number): LonLat[] {
  return anel.map(([e, n]) => proj4(utmDef(fuso), GEO_DEF, [Number(e), Number(n)]));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { servico_id, imovel, glebas: glebasPedidas, faltantes } = await req.json();
    if (!servico_id) return json({ erro: "servico_id é obrigatório" }, 400);
    const token = Deno.env.get("MAPBOX_TOKEN");
    if (!token) return json({ erro: "MAPBOX_TOKEN não configurado no servidor" }, 500);

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: servico } = await supa.from("servicos").select("id, fuso_utm, tem_glebas").eq("id", servico_id).single();
    if (!servico) return json({ erro: "Serviço não encontrado" }, 404);
    const { data: vertRows } = await supa.from("vertices").select("ordem, e, n, lat_gms, lon_gms").eq("servico_id", servico_id).order("ordem");
    const verts = (vertRows ?? []) as VertRow[];
    if (verts.length < 3) return json({ erro: "O serviço ainda não tem vértices: importe o TXT antes de buscar a imagem" }, 422);

    const fuso = fusoDoServico(servico.fuso_utm, verts);
    // glebas fechadas na ordem do banco — a posição k aqui é a mesma que nomeia
    // `satelite-gleba-{k}` na tela e em gerar-documentos
    let glebas: GlebaRow[] = [];
    if (servico.tem_glebas) {
      const { data } = await supa.from("glebas").select("nome, anel").eq("servico_id", servico_id).order("ordem");
      glebas = ((data ?? []) as GlebaRow[]).filter((g) => (g.anel?.length ?? 0) >= 3);
    }

    // o que já existe em entrada/ (só interessa no modo `faltantes`)
    const pasta = `${servico_id}/entrada`;
    const existentes = new Set<string>();
    if (faltantes) {
      const { data: lista } = await supa.storage.from("gerados").list(pasta);
      for (const f of lista ?? []) existentes.add(f.name);
    }

    type Alvo = { alvo: "imovel" | number; aneis: LonLat[][]; nome: string };
    const alvos: Alvo[] = [];
    const querImovel = imovel || (faltantes && !existentes.has("satelite.png") && !existentes.has("satelite.jpg"));
    if (querImovel) {
      // com glebas, o imóvel é o conjunto delas (partes separadas por estrada
      // saem cada uma com o seu contorno); sem glebas, o anel dos vértices
      const aneis = glebas.length ? glebas.map((g) => anelDaGleba(g.anel!, fuso)) : [anelDosVertices(verts, fuso)];
      alvos.push({ alvo: "imovel", aneis, nome: "satelite" });
    }
    const ks = new Set<number>(Array.isArray(glebasPedidas) ? glebasPedidas.map(Number) : []);
    if (faltantes) {
      glebas.forEach((_, i) => {
        const k = i + 1;
        if (!existentes.has(`satelite-gleba-${k}.png`) && !existentes.has(`satelite-gleba-${k}.jpg`)) ks.add(k);
      });
    }
    for (const k of [...ks].sort((a, b) => a - b)) {
      const g = glebas[k - 1];
      if (!g) continue;
      alvos.push({ alvo: k, aneis: [anelDaGleba(g.anel!, fuso)], nome: `satelite-gleba-${k}` });
    }

    const gerados: { alvo: "imovel" | number; nome: string; tipo: "png" | "jpg" }[] = [];
    const avisos: string[] = [];
    for (const a of alvos) {
      try {
        const url = urlImagemSatelite(a.aneis, { token });
        const resp = await fetch(url);
        if (!resp.ok) {
          const corpo = await resp.text().catch(() => "");
          throw new Error(`Mapbox respondeu ${resp.status}: ${corpo.slice(0, 200)}`);
        }
        const ct = resp.headers.get("content-type") ?? "";
        const tipo: "png" | "jpg" = /jpe?g/i.test(ct) ? "jpg" : "png";
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const up = await supa.storage.from("gerados")
          .upload(`${pasta}/${a.nome}.${tipo}`, bytes, { upsert: true, contentType: tipo === "png" ? "image/png" : "image/jpeg" });
        if (up.error) throw new Error(`não ficou guardada no Storage: ${up.error.message}`);
        // só uma imagem por alvo: a de outra extensão, se existir, sai
        await supa.storage.from("gerados").remove([`${pasta}/${a.nome}.${tipo === "png" ? "jpg" : "png"}`]);
        gerados.push({ alvo: a.alvo, nome: `${a.nome}.${tipo}`, tipo });
      } catch (e) {
        const rotulo = a.alvo === "imovel" ? "imóvel" : `gleba ${a.alvo}`;
        avisos.push(`Imagem de satélite do ${rotulo}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return json({ gerados, avisos });
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
