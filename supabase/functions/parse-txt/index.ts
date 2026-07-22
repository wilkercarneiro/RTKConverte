// Edge Function parse-txt: recebe o TXT, valida, detecta fuso, converte
// coordenadas, sugere trechos/tipos e cria o serviço em rascunho.
// Toda a lógica de negócio roda server-side; o frontend só envia o arquivo.
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import {
  calcularAreaHa, calcularSegmentos, calcularPerimetroM, calcularVertices,
  detectZoneCandidates, escolherZona, fmtGmsPlanilha, parseTxt,
} from "../_shared/geo.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { sugerirTrechos } from "../_shared/servico.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { nome_arquivo, conteudo, uf } = await req.json();
    if (typeof conteudo !== "string" || !conteudo.trim()) return json({ erro: "Conteúdo do TXT ausente" }, 400);
    const nomeArquivo = typeof nome_arquivo === "string" && nome_arquivo ? nome_arquivo : "pontos.txt";

    const pontos = parseTxt(conteudo);
    const candidatos = detectZoneCandidates(pontos, proj4);
    const { escolhido, ambiguo, foraDaUf } = escolherZona(candidatos, uf ?? null);
    if (!escolhido) return json({ erro: "Nenhum fuso UTM brasileiro compatível com as coordenadas" }, 422);

    const calc = calcularVertices(
      pontos.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })),
      escolhido.zone, proj4,
    );
    const trechosSug = sugerirTrechos(pontos);
    const iniciosTrecho = new Set(trechosSug.map((t) => t.verticeInicioOrdem));
    const verticeInicial = trechosSug.length > 0 ? trechosSug[0].verticeInicioOrdem : 0;

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: servico, error: eServ } = await supa.from("servicos").insert({
      status: "rascunho",
      nome_arquivo_txt: nomeArquivo,
      fuso_utm: escolhido.zone,
      vertice_inicial: verticeInicial,
      uf: uf ?? null,
    }).select().single();
    if (eServ) throw eServ;

    const up = await supa.storage.from("uploads-txt")
      .upload(`${servico.id}/${nomeArquivo}`, new Blob([conteudo], { type: "text/plain" }), { upsert: true });
    if (up.error) throw up.error;

    const linhasVert = pontos.map((p, i) => ({
      servico_id: servico.id,
      ordem: i,
      num_txt: p.num,
      rotulo_txt: p.rotulo,
      e: p.e, n: p.n, h: p.h,
      sigma_pos: p.sigmaPos, sigma_h: p.sigmaH,
      tipo: iniciosTrecho.has(i) ? "M" : "P",
      metodo: "PG6",
      inserido_manual: false,
      lat_gms: fmtGmsPlanilha(calc[i].latGms, "lat"),
      lon_gms: fmtGmsPlanilha(calc[i].lonGms, "lon"),
    }));
    const { data: vertices, error: eVert } = await supa.from("vertices").insert(linhasVert).select().order("ordem");
    if (eVert) throw eVert;

    const linhasTre = trechosSug.map((t) => ({
      servico_id: servico.id,
      vertice_inicio_ordem: t.verticeInicioOrdem,
      apelido_txt: t.apelido,
      descritivo: "",
      tipo_limite: "LA1",
    }));
    const { data: trechos, error: eTre } = linhasTre.length
      ? await supa.from("trechos_confrontantes").insert(linhasTre).select().order("vertice_inicio_ordem")
      : { data: [], error: null };
    if (eTre) throw eTre;

    const segs = calcularSegmentos(calc);
    const preview = {
      fuso: escolhido.zone,
      epsg: escolhido.epsg,
      candidatos: candidatos.map((c) => c.zone),
      fusoAmbiguo: ambiguo,
      foraDaUf,
      areaHa: calcularAreaHa(calc),
      perimetroM: calcularPerimetroM(segs),
      qtdM: linhasVert.filter((v) => v.tipo === "M").length,
      qtdP: linhasVert.filter((v) => v.tipo === "P").length,
      qtdV: 0,
    };
    return json({ servico, vertices, trechos, preview });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
