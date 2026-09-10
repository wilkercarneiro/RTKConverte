// Edge Function buscar-satelite: busca a imagem de satélite da PLANTA DE
// SITUAÇÃO pelas coordenadas do imóvel (e de cada gleba) e guarda no Storage
// no MESMO lugar em que o upload manual guardava —
// `gerados/{servico}/entrada/satelite.png` e `satelite-gleba-{k}.png`. Assim
// gerar-documentos e gerar-planta não sabem se a imagem veio da API ou da mão
// do operador; e o upload continua valendo como troca.
//
// Corpo: { servico_id, imovel?: boolean, glebas?: number[], faltantes?: boolean, mapa?: boolean }
//   imovel     → (re)busca a do imóvel inteiro (e o mapa da tela junto)
//   glebas     → (re)busca as das glebas k (1-based, posição entre as fechadas)
//   faltantes  → só o que ainda não existe em entrada/ (é o que a tela chama ao abrir)
//   mapa       → (re)busca só o mapa da tela (entrada/mapa.jpg + mapa.json)
// Resposta: { gerados: [{ alvo: "imovel" | k, nome, tipo }], mapa: GeorefMapa | null, avisos: string[] }
//
// O MAPA DA TELA é a imagem limpa, com centro e zoom conhecidos (mapa.json),
// para a conferência desenhar os vértices por cima no lugar certo.
//
// Segredo: MAPBOX_TOKEN (Mapbox Static Images).
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import { GEO_DEF, gmsToDeg, parseGmsPlanilha, utmDef } from "../_shared/geo.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { buscarImagemMapbox, enquadrar, guardarImagem, urlMapaSatelite } from "../_shared/satelite.ts";
import type { GeorefMapa, LonLat } from "../_shared/satelite.ts";

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
    const { servico_id, imovel, glebas: glebasPedidas, faltantes, mapa: mapaPedido } = await req.json();
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

    // mapa da tela: junto com a do imóvel, sozinho (`mapa`), ou quando falta
    let mapa: GeorefMapa | null = null;
    const querMapa = mapaPedido || querImovel || (faltantes && !existentes.has("mapa.json"));
    if (querMapa) {
      try {
        const aneis = glebas.length ? glebas.map((g) => anelDaGleba(g.anel!, fuso)) : [anelDosVertices(verts, fuso)];
        const g = enquadrar(aneis, 640, 640, 44);
        const resp = await fetch(urlMapaSatelite(g, token));
        if (!resp.ok) throw new Error(`Mapbox respondeu ${resp.status}: ${(await resp.text().catch(() => "")).slice(0, 200)}`);
        const bytes = new Uint8Array(await resp.arrayBuffer());
        const upImg = await supa.storage.from("gerados").upload(`${pasta}/mapa.jpg`, bytes, { upsert: true, contentType: "image/jpeg" });
        if (upImg.error) throw new Error(`mapa não ficou guardado: ${upImg.error.message}`);
        const upJson = await supa.storage.from("gerados").upload(`${pasta}/mapa.json`, new TextEncoder().encode(JSON.stringify(g)),
          { upsert: true, contentType: "application/json" });
        if (upJson.error) throw new Error(`georreferência não ficou guardada: ${upJson.error.message}`);
        mapa = g;
      } catch (e) {
        avisos.push(`Mapa de satélite da tela: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    for (const a of alvos) {
      try {
        const img = await buscarImagemMapbox(a.aneis, token);
        await guardarImagem(supa.storage, servico_id, a.nome, img);
        gerados.push({ alvo: a.alvo, nome: `${a.nome}.${img.tipo}`, tipo: img.tipo });
      } catch (e) {
        const rotulo = a.alvo === "imovel" ? "imóvel" : `gleba ${a.alvo}`;
        avisos.push(`Imagem de satélite do ${rotulo}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return json({ gerados, mapa, avisos });
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
