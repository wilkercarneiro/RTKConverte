// Edge Function gerar-documentos: monta o serviço a partir do banco (fonte da
// verdade), aloca códigos de vértice (transação nos contadores do credenciado),
// gera Memorial DOCX + Planilha ODS e salva no bucket `gerados` (sobrescreve).
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import JSZip from "jszip";
import { montarServico } from "../_shared/servico.ts";
import type { ServicoInput, VerticeServico } from "../_shared/servico.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { buildDocumentXml, buildDocxSkeleton } from "../_shared/docx.ts";
import type { DadosMemorial } from "../_shared/memorial.ts";
import { patchOdsContent } from "../_shared/ods.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

function dataHojeBR(): string {
  const agora = new Date(Date.now() - 3 * 3600 * 1000); // UTC-3
  const d = String(agora.getUTCDate()).padStart(2, "0");
  const m = String(agora.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${agora.getUTCFullYear()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { servico_id } = await req.json();
    if (!servico_id) return json({ erro: "servico_id ausente" }, 400);

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: servico, error: eS } = await supa.from("servicos").select().eq("id", servico_id).single();
    if (eS || !servico) return json({ erro: "Serviço não encontrado" }, 404);
    const { data: vertRows, error: eV } = await supa.from("vertices").select().eq("servico_id", servico_id).order("ordem");
    if (eV) throw eV;
    const { data: trechoRows, error: eT } = await supa.from("trechos_confrontantes").select().eq("servico_id", servico_id).order("vertice_inicio_ordem");
    if (eT) throw eT;

    // validações
    const obrig: [string, unknown][] = [
      ["detentor_nome", servico.detentor_nome], ["denominacao", servico.denominacao],
      ["municipio", servico.municipio], ["uf", servico.uf], ["fuso_utm", servico.fuso_utm],
      ["credenciado_id", servico.credenciado_id],
    ];
    const faltando = obrig.filter(([, v]) => !v).map(([k]) => k);
    if (faltando.length) return json({ erro: `Campos obrigatórios ausentes: ${faltando.join(", ")}` }, 422);
    if (!vertRows?.length) return json({ erro: "Serviço sem vértices" }, 422);
    if (!trechoRows?.length) return json({ erro: "Defina os trechos de confrontantes" }, 422);
    if (trechoRows.some((t: { descritivo: string | null }) => !t.descritivo)) {
      return json({ erro: "Todos os trechos precisam de descritivo formal" }, 422);
    }
    for (const v of vertRows) {
      if (v.inserido_manual && !v.codigo) return json({ erro: `Vértice inserido (ordem ${v.ordem}) sem código` }, 422);
    }

    const { data: cred, error: eC } = await supa.from("credenciados").select().eq("id", servico.credenciado_id).single();
    if (eC || !cred) return json({ erro: "Credenciado não encontrado" }, 422);
    const rt = servico.rt_id
      ? (await supa.from("responsaveis_tecnicos").select().eq("id", servico.rt_id).single()).data
      : null;

    // alocação de códigos: incrementa contadores apenas quando há vértice sem código
    const precisaAlocar = vertRows.some((v: { codigo: string | null; inserido_manual: boolean }) => !v.codigo && !v.inserido_manual);
    let contadores = { M: 0, P: 0, V: 0 };
    if (precisaAlocar) {
      const consumo = { M: 0, P: 0, V: 0 };
      for (const v of vertRows) if (!v.inserido_manual || !v.codigo) consumo[v.tipo as "M" | "P" | "V"]++;
      const { data: base, error: eA } = await supa.rpc("alocar_contadores", {
        p_credenciado: cred.id, dm: consumo.M, dp: consumo.P, dv: consumo.V,
      });
      if (eA) throw eA;
      const b = Array.isArray(base) ? base[0] : base;
      contadores = { M: b.base_m, P: b.base_p, V: b.base_v };
    }

    const vertices: VerticeServico[] = vertRows.map((v) => ({
      ordem: v.ordem,
      numTxt: v.num_txt,
      e: v.e === null ? null : Number(v.e),
      n: v.n === null ? null : Number(v.n),
      latGmsStr: v.inserido_manual ? v.lat_gms : null,
      lonGmsStr: v.inserido_manual ? v.lon_gms : null,
      h: Number(v.h),
      sigmaPos: Number(v.sigma_pos),
      sigmaH: Number(v.sigma_h),
      tipo: v.tipo,
      metodo: v.metodo,
      // regeração: códigos já alocados são reutilizados (não re-incrementa)
      codigoManual: precisaAlocar ? (v.inserido_manual ? v.codigo : null) : v.codigo,
      inserido: v.inserido_manual,
    }));

    const input: ServicoInput = {
      fusoUtm: servico.fuso_utm,
      verticeInicialOrdem: servico.vertice_inicial ?? 0,
      prefixo: cred.prefixo_vertice,
      contadores,
      vertices,
      trechos: trechoRows.map((t) => ({
        verticeInicioOrdem: t.vertice_inicio_ordem,
        descritivo: t.descritivo,
        tipoLimite: t.tipo_limite,
        cns: t.cns,
        matricula: t.matricula,
      })),
    };
    const calc = montarServico(input, proj4);

    // persiste códigos e coordenadas canônicas
    if (precisaAlocar) {
      for (const v of calc.ring) {
        await supa.from("vertices").update({ codigo: v.codigo }).eq("servico_id", servico_id).eq("ordem", v.ordem);
      }
    }

    // ------------------------- DOCX -------------------------
    const dadosMemorial: DadosMemorial = {
      imovel: servico.denominacao ?? "",
      proprietario: servico.detentor_nome ?? "",
      cpfProprietario: servico.detentor_cpf ?? "",
      municipio: servico.municipio ?? "",
      uf: servico.uf ?? "",
      matricula: servico.matricula ?? "",
      comarca: "",
      codigoCredenciamento: "",
      areaHa: calc.areaHa,
      perimetroM: calc.perimetroM,
      mcAbs: calc.mcAbs,
      dataStr: dataHojeBR(),
      rtNome: rt?.nome ?? "",
      rtCrea: rt?.crea ?? "",
      rtTrt: rt?.trt ?? "",
      ring: calc.memorialRing,
      segs: calc.segs,
      confrontantesDescritivos: calc.trechosOrdenados.map((t) => t.descritivo),
    };
    const zipDocx = new JSZip();
    const tplDocx = await supa.storage.from("templates").download("memorial-template.docx");
    if (!tplDocx.error && tplDocx.data) {
      const tz = await JSZip.loadAsync(await tplDocx.data.arrayBuffer());
      for (const name of Object.keys(tz.files)) {
        if (tz.files[name].dir) continue;
        zipDocx.file(name, await tz.file(name)!.async("uint8array"));
      }
    } else {
      for (const [path, content] of buildDocxSkeleton()) zipDocx.file(path, content);
    }
    zipDocx.file("word/document.xml", buildDocumentXml(dadosMemorial));
    const docxBuf = await zipDocx.generateAsync({ type: "uint8array", compression: "DEFLATE" });

    // ------------------------- ODS -------------------------
    const tplOds = await supa.storage.from("templates").download("planta-template.ods");
    if (tplOds.error || !tplOds.data) return json({ erro: "Template planta-template.ods não encontrado no Storage" }, 500);
    const zipIn = await JSZip.loadAsync(await tplOds.data.arrayBuffer());
    const contentXml = await zipIn.file("content.xml")!.async("string");
    const patched = patchOdsContent(contentXml, {
      natureza: servico.natureza_servico ?? "Particular",
      tipoPessoa: servico.tipo_pessoa ?? "Física",
      nome: servico.detentor_nome ?? "",
      cpf: servico.detentor_cpf ?? "",
      denominacao: servico.denominacao ?? "",
      situacao: servico.situacao ?? "",
      naturezaArea: servico.natureza_area ?? "",
      sncr: servico.codigo_sncr ?? "",
      cns: servico.cns ?? "",
      matricula: servico.matricula ?? "",
      municipioUf: `${servico.municipio}-${servico.uf}`,
    }, {
      denominacaoParcela: servico.denominacao_parcela ?? "Parte 1",
      parcelaNumero: servico.parcela_numero ?? "001",
      lado: servico.lado ?? "Externo",
      mcAbs: calc.mcAbs,
      hemisferio: calc.ring[0].latDeg < 0 ? "Sul" : "Norte",
      linhas: calc.linhasOds,
    });
    const zipOds = new JSZip();
    zipOds.file("mimetype", await zipIn.file("mimetype")!.async("uint8array"), { compression: "STORE" });
    for (const name of Object.keys(zipIn.files)) {
      if (name === "mimetype" || name === "content.xml" || zipIn.files[name].dir) continue;
      zipOds.file(name, await zipIn.file(name)!.async("uint8array"), { compression: "DEFLATE" });
    }
    zipOds.file("content.xml", patched, { compression: "DEFLATE" });
    const odsBuf = await zipOds.generateAsync({ type: "uint8array" });

    // ------------------------- upload + status -------------------------
    const pDocx = `${servico_id}/memorial.docx`;
    const pOds = `${servico_id}/planilha.ods`;
    const u1 = await supa.storage.from("gerados").upload(pDocx, docxBuf, {
      upsert: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    if (u1.error) throw u1.error;
    const u2 = await supa.storage.from("gerados").upload(pOds, odsBuf, {
      upsert: true, contentType: "application/vnd.oasis.opendocument.spreadsheet",
    });
    if (u2.error) throw u2.error;
    await supa.from("servicos").update({ status: "gerado" }).eq("id", servico_id);

    const s1 = await supa.storage.from("gerados").createSignedUrl(pDocx, 3600);
    const s2 = await supa.storage.from("gerados").createSignedUrl(pOds, 3600);
    return json({
      ok: true,
      memorial_docx: s1.data?.signedUrl,
      planilha_ods: s2.data?.signedUrl,
      resumo: {
        areaHa: calc.areaHa,
        perimetroM: calc.perimetroM,
        qtdM: calc.ring.filter((v) => v.tipo === "M").length,
        qtdP: calc.ring.filter((v) => v.tipo === "P").length,
        qtdV: calc.ring.filter((v) => v.tipo === "V").length,
        contadoresFinais: calc.contadoresFinais,
        verticeInicial: calc.ring[0].codigo,
      },
    });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
