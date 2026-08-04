// Edge Function gerar-planta: gera a PLANTA (PDF) do imóvel.
//   matrícula → folha A1 com quadro analítico · posse → folha A3 sem quadro
//   serviço 'geo'  : usa os dados do próprio sistema (códigos já alocados)
//   serviço 'pecas': usa o PDF do SIGEF (azimutes/distâncias SGL) + projeção
// A logo da empresa vem de templates/logo-empresa.(png|jpg) no Storage.
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../_shared/sigef_pdf.ts";
import { montarServico } from "../_shared/servico.ts";
import type { ServicoInput } from "../_shared/servico.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { gerarPlantaPdf } from "../_shared/planta.ts";
import type { TrechoPlanta, VerticePlanta } from "../_shared/planta.ts";
import { montarTrechosDoSigef, reconciliarVerticesBancoComSigef } from "../_shared/reconciliacao.ts";
import {
  bytesDeBase64, carregarLogoPlanta, dataHojeBR, geometriaDoCalculo, montarDadosPlanta,
} from "../_shared/planta_dados.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// "-39°05'04,737\"" → graus decimais
function gmsPdfParaDeg(s: string): number {
  const m = s.match(/(-?)(\d+)°(\d+)'([\d,]+)"/);
  if (!m) throw new Error(`Coordenada inválida no PDF: ${s}`);
  const v = parseInt(m[2], 10) + parseInt(m[3], 10) / 60 + parseFloat(m[4].replace(",", ".")) / 3600;
  return m[1] === "-" ? -v : v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { servico_id, pdf_base64, satelite_base64, satelite_tipo } = await req.json();
    if (!servico_id) return json({ erro: "servico_id é obrigatório" }, 400);

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: servico } = await supa.from("servicos").select().eq("id", servico_id).single();
    if (!servico) return json({ erro: "Serviço não encontrado" }, 404);
    const { data: vertRows } = await supa.from("vertices").select().eq("servico_id", servico_id).order("ordem");
    const { data: trechoRows } = await supa.from("trechos_confrontantes").select().eq("servico_id", servico_id).order("vertice_inicio_ordem");
    const rt = servico.rt_id ? (await supa.from("responsaveis_tecnicos").select().eq("id", servico.rt_id).single()).data : null;
    const cred = servico.credenciado_id ? (await supa.from("credenciados").select().eq("id", servico.credenciado_id).single()).data : null;
    const { data: cfgDes } = await supa.from("config_empresa").select("value").eq("key", "desenhista").maybeSingle();

    if (!servico.denominacao || !servico.municipio || !servico.uf) {
      return json({ erro: "Complete denominação e município/UF antes de gerar a planta" }, 422);
    }

    let vertices: VerticePlanta[] = [];
    let trechosPlanta: TrechoPlanta[] = [];
    // TRT preenchido no sistema manda: campo do serviço, depois o TRT padrão do
    // RT cadastrado; o PDF do SIGEF (fluxo 'pecas', abaixo) é o último recurso.
    const trtSistema = ((servico.trt ?? "").trim() || (rt?.trt ?? "").trim());
    let areaFmt = "", perimetroFmt = "", trt = trtSistema;
    let fuso = servico.fuso_utm ?? 24;
    let latMedia = -12;

    if (servico.tipo === "pecas" || pdf_base64) {
      // -------- fluxo via PDF do SIGEF (valores SGL) --------
      if (!pdf_base64) return json({ erro: "Envie o PDF do SIGEF para gerar a planta deste serviço" }, 422);
      const proxy = await getDocumentProxy(bytesDeBase64(pdf_base64));
      const { text } = await extractText(proxy, { mergePages: true });
      const sigef = parseSigefTexto(text as string);
      const lon0 = gmsPdfParaDeg(sigef.linhas[0].lon);
      latMedia = gmsPdfParaDeg(sigef.linhas[0].lat);
      if (!servico.fuso_utm) fuso = Math.floor((lon0 + 180) / 6) + 1;

      // Reconciliação dos vértices cadastrados no banco com o PDF do SIGEF
      const verticesReconciliados = reconciliarVerticesBancoComSigef(
        servico_id,
        vertRows ?? [],
        sigef.linhas,
        fuso,
        proj4
      );

      // Atualiza o banco de dados com a lista reconciliada e oficializada pelo SIGEF
      if (verticesReconciliados.length > 0) {
        await supa.from("vertices").delete().eq("servico_id", servico_id);
        await supa.from("vertices").insert(verticesReconciliados);
      }

      vertices = sigef.linhas.map((l, i) => {
        const vr = verticesReconciliados[i];
        return {
          codigo: l.codigo,
          e: vr ? vr.e : 0,
          n: vr ? vr.n : 0,
          lonFmt: l.lon, latFmt: l.lat, alt: l.alt,
          azFmt: l.azimute, distFmt: l.dist, vante: l.vante,
        };
      });

      // onde cada confrontação começa (ver montarTrechosDoSigef p/ a precedência)
      const starts = montarTrechosDoSigef(trechoRows ?? [], verticesReconciliados, sigef.linhas);
      trechosPlanta = starts.map((s, k) => ({
        descritivo: s.descritivo,
        isEstrada: s.ehVia,
        inicioIdx: s.idx,
        fimIdx: starts[(k + 1) % starts.length].idx,
      }));
      areaFmt = sigef.cabecalho.areaHa;
      perimetroFmt = sigef.cabecalho.perimetroM;
      if (!trtSistema) trt = sigef.cabecalho.documentoRt.split(" ")[0] || trt;
    } else {
      // -------- fluxo 'geo': dados do próprio sistema --------
      if (!vertRows?.length) return json({ erro: "Serviço sem vértices" }, 422);
      if (vertRows.some((v) => !v.codigo)) return json({ erro: "Gere os documentos (memorial/planilha) antes da planta — os códigos dos vértices são alocados na geração" }, 422);
      if (!cred) return json({ erro: "Credenciado não definido" }, 422);
      const input: ServicoInput = {
        fusoUtm: fuso,
        verticeInicialOrdem: servico.vertice_inicial ?? 0,
        prefixo: cred.prefixo_vertice,
        contadores: { M: 0, P: 0, V: 0 },
        vertices: vertRows.map((v) => ({
          ordem: v.ordem, numTxt: v.num_txt,
          e: v.e === null ? null : Number(v.e), n: v.n === null ? null : Number(v.n),
          latGmsStr: v.inserido_manual ? v.lat_gms : null, lonGmsStr: v.inserido_manual ? v.lon_gms : null,
          h: Number(v.h), sigmaPos: Number(v.sigma_pos), sigmaH: Number(v.sigma_h),
          tipo: v.tipo, metodo: v.metodo, codigoManual: v.codigo, inserido: v.inserido_manual,
          descritivo: v.descritivo || v.apelido_txt || "", tipoLimite: v.tipo_limite,
          ehVia: v.eh_via, cns: v.cns, matricula: v.matricula,
        })),
      };
      const g = geometriaDoCalculo(montarServico(input, proj4));
      latMedia = g.latMediaDeg;
      vertices = g.vertices;
      trechosPlanta = g.trechos;
      areaFmt = g.areaFmt;
      perimetroFmt = g.perimetroFmt;
    }

    const posse = servico.tipo_imovel === "posse";
    const dados = montarDadosPlanta({
      servico, rt, cred,
      desenhista: cfgDes?.value ?? "",
      geometria: { vertices, trechos: trechosPlanta, areaFmt, perimetroFmt, latMediaDeg: latMedia },
      fuso, trt,
      dataStr: dataHojeBR(),
      logo: await carregarLogoPlanta(supa),
      satelite: satelite_base64
        ? { bytes: bytesDeBase64(satelite_base64), tipo: satelite_tipo === "png" ? "png" : "jpg" }
        : null,
    });

    const pdfBytes = await gerarPlantaPdf(dados);
    const { data: vmax } = await supa.from("documentos_gerados").select("versao")
      .eq("servico_id", servico_id).order("versao", { ascending: false }).limit(1);
    const versao = ((vmax?.[0]?.versao as number | undefined) ?? 0) + 1;
    const path = `${servico_id}/v${versao}/planta.pdf`;
    const up = await supa.storage.from("gerados").upload(path, pdfBytes, { upsert: true, contentType: "application/pdf" });
    if (up.error) throw up.error;
    // "SIGEF" no título/nome do arquivo: esta é a planta oficial, para não se
    // confundir com a que sai junto do memorial (gerar-documentos, tipo planta_pdf_sistema)
    await supa.from("documentos_gerados").insert([{ servico_id, versao, tipo: "planta_pdf", titulo: `Planta ${posse ? "A3" : "A1"} (PDF · SIGEF)`, path }]);
    const nomeBase = servico.denominacao.replace(/[\\/:*?"<>|]/g, "-").trim();
    const s = await supa.storage.from("gerados").createSignedUrl(path, 3600, { download: `Planta SIGEF - ${nomeBase}.pdf` });

    return json({
      ok: true,
      planta_pdf: s.data?.signedUrl,
      resumo: { vertices: vertices.length, area: areaFmt, perimetro: perimetroFmt, logo: !!dados.logo, folha: posse ? "A3" : "A1" },
    });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
