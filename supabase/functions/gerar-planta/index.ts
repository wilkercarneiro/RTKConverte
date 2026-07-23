// Edge Function gerar-planta: gera a PLANTA A1 (PDF) do imóvel.
//   serviço 'geo'  : usa os dados do próprio sistema (códigos já alocados)
//   serviço 'pecas': usa o PDF do SIGEF (azimutes/distâncias SGL) + projeção
// A logo da empresa vem de templates/logo-empresa.(png|jpg) no Storage.
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../_shared/sigef_pdf.ts";
import type { LinhaSigef } from "../_shared/sigef_pdf.ts";
import { montarServico } from "../_shared/servico.ts";
import type { ServicoInput } from "../_shared/servico.ts";
import { GEO_DEF, fmtBR, fmtGmsPlanilha, utmDef } from "../_shared/geo.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { gerarPlantaPdf } from "../_shared/planta.ts";
import type { DadosPlanta, TrechoPlanta, VerticePlanta } from "../_shared/planta.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function dataHojeBR(): string {
  const agora = new Date(Date.now() - 3 * 3600 * 1000);
  return `${String(agora.getUTCDate()).padStart(2, "0")}/${String(agora.getUTCMonth() + 1).padStart(2, "0")}/${agora.getUTCFullYear()}`;
}

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
    const { servico_id, pdf_base64 } = await req.json();
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
    let areaFmt = "", perimetroFmt = "", trt = rt?.trt ?? "";
    let fuso = servico.fuso_utm ?? 24;
    let latMedia = -12;

    const ehEstrada = (descritivo: string, tipoLimite: string) =>
      !descritivo.includes("\\") || /^LA[34567]/.test(tipoLimite);

    if (servico.tipo === "pecas" || pdf_base64) {
      // -------- fluxo via PDF do SIGEF (valores SGL) --------
      if (!pdf_base64) return json({ erro: "Envie o PDF do SIGEF para gerar a planta deste serviço" }, 422);
      const proxy = await getDocumentProxy(b64ToBytes(pdf_base64));
      const { text } = await extractText(proxy, { mergePages: true });
      const sigef = parseSigefTexto(text as string);
      const lon0 = gmsPdfParaDeg(sigef.linhas[0].lon);
      latMedia = gmsPdfParaDeg(sigef.linhas[0].lat);
      if (!servico.fuso_utm) fuso = Math.floor((lon0 + 180) / 6) + 1;
      const ud = utmDef(fuso);
      vertices = sigef.linhas.map((l, i) => {
        const [e, n] = proj4(GEO_DEF, ud, [gmsPdfParaDeg(l.lon), gmsPdfParaDeg(l.lat)]);
        return {
          codigo: l.codigo, e, n, lonFmt: l.lon, latFmt: l.lat, alt: l.alt,
          azFmt: l.azimute, distFmt: l.dist, vante: l.vante,
        };
      });
      // trechos: por codigo_inicio (serviço pecas) ou mudança de confrontação
      const idxDe = new Map(sigef.linhas.map((l, i) => [l.codigo, i]));
      let starts: { idx: number; descritivo: string; tipoLimite: string }[] = (trechoRows ?? [])
        .filter((t) => t.codigo_inicio && idxDe.has(t.codigo_inicio))
        .map((t) => ({ idx: idxDe.get(t.codigo_inicio)!, descritivo: t.descritivo || "", tipoLimite: t.tipo_limite }));
      if (starts.length === 0) {
        let ultima = "";
        sigef.linhas.forEach((l, i) => {
          if (l.confrontacao !== ultima) {
            ultima = l.confrontacao;
            starts.push({ idx: i, descritivo: l.confrontacao.replace(/\.{3}$/, ""), tipoLimite: "LA1" });
          }
        });
      }
      starts.sort((a, b) => a.idx - b.idx);
      trechosPlanta = starts.map((s, k) => ({
        descritivo: s.descritivo,
        isEstrada: ehEstrada(s.descritivo, s.tipoLimite),
        inicioIdx: s.idx,
        fimIdx: starts[(k + 1) % starts.length].idx,
      }));
      areaFmt = sigef.cabecalho.areaHa;
      perimetroFmt = sigef.cabecalho.perimetroM;
      trt = sigef.cabecalho.documentoRt.split(" ")[0] || trt;
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
        })),
        trechos: (trechoRows ?? []).map((t) => ({
          verticeInicioOrdem: t.vertice_inicio_ordem,
          descritivo: t.descritivo || t.apelido_txt || "",
          tipoLimite: t.tipo_limite, cns: t.cns, matricula: t.matricula,
        })),
      };
      const calc = montarServico(input, proj4);
      latMedia = calc.ring[0].latDeg;
      const posDe = new Map(calc.ring.map((v, i) => [v.ordem, i]));
      vertices = calc.ring.map((v, i) => ({
        codigo: v.codigo, e: v.eProj, n: v.nProj,
        lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
        alt: String(v.h).replace(".", ","),
        azFmt: calc.segs[i].azimuteFmt, distFmt: calc.segs[i].distFmt,
        vante: calc.ring[(i + 1) % calc.ring.length].codigo,
      }));
      trechosPlanta = calc.trechosOrdenados.map((t, k) => ({
        descritivo: t.descritivo,
        isEstrada: ehEstrada(t.descritivo, t.tipoLimite),
        inicioIdx: posDe.get(t.verticeInicioOrdem) ?? 0,
        fimIdx: posDe.get(calc.trechosOrdenados[(k + 1) % calc.trechosOrdenados.length].verticeInicioOrdem) ?? 0,
      }));
      areaFmt = fmtBR(calc.areaHa, 4);
      perimetroFmt = fmtBR(calc.perimetroM, 2);
    }

    // -------- logo da empresa --------
    let logo: DadosPlanta["logo"] = null;
    for (const [nome, tipo] of [["logo-empresa.png", "png"], ["logo-empresa.jpg", "jpg"]] as const) {
      const dl = await supa.storage.from("templates").download(nome);
      if (!dl.error && dl.data) { logo = { bytes: new Uint8Array(await dl.data.arrayBuffer()), tipo }; break; }
    }

    const areaHaNum = parseFloat(areaFmt.replace(/\./g, "").replace(",", "."));
    const proprietarios = [{ nome: servico.detentor_nome ?? "", cpf: servico.detentor_cpf ?? "" }];
    if (servico.requerente2_nome) proprietarios.push({ nome: servico.requerente2_nome, cpf: servico.requerente2_cpf ?? "" });

    const dados: DadosPlanta = {
      vertices, trechos: trechosPlanta,
      denominacao: servico.denominacao,
      proprietarios,
      matricula: servico.matricula ?? "",
      cns: servico.cns ?? "",
      sncr: servico.codigo_sncr ?? "",
      municipioUf: `${servico.municipio}-${servico.uf}`,
      areaFmt, tarefasFmt: fmtBR(areaHaNum * 10000 / 4356, 2), perimetroFmt,
      mcAbs: Math.abs(6 * fuso - 183), fuso, latMediaDeg: latMedia,
      trt,
      rt: {
        nome: rt?.nome ?? "", formacao: rt?.formacao ?? "",
        conselhoSigla: rt?.conselho_sigla ?? "CFTA", conselhoNumero: rt?.conselho_numero ?? "",
        codigoCredenciado: cred?.prefixo_vertice ?? servico.codigo_sncr ?? "",
      },
      desenhista: cfgDes?.value ?? "",
      dataStr: dataHojeBR(),
      logo,
    };

    const pdfBytes = await gerarPlantaPdf(dados);
    const { data: vmax } = await supa.from("documentos_gerados").select("versao")
      .eq("servico_id", servico_id).order("versao", { ascending: false }).limit(1);
    const versao = ((vmax?.[0]?.versao as number | undefined) ?? 0) + 1;
    const path = `${servico_id}/v${versao}/planta.pdf`;
    const up = await supa.storage.from("gerados").upload(path, pdfBytes, { upsert: true, contentType: "application/pdf" });
    if (up.error) throw up.error;
    await supa.from("documentos_gerados").insert([{ servico_id, versao, tipo: "planta_pdf", titulo: "Planta A1 (PDF)", path }]);
    const nomeBase = servico.denominacao.replace(/[\\/:*?"<>|]/g, "-").trim();
    const s = await supa.storage.from("gerados").createSignedUrl(path, 3600, { download: `Planta - ${nomeBase}.pdf` });

    return json({
      ok: true,
      planta_pdf: s.data?.signedUrl,
      resumo: { vertices: vertices.length, area: areaFmt, perimetro: perimetroFmt, logo: !!logo },
    });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
