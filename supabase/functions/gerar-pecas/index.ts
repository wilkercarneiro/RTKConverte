// Edge Function gerar-pecas: recebe o PDF de prévia do SIGEF + servico_id,
// cruza com os dados do banco e gera as 7 peças técnicas (DOCX) a partir dos
// modelos oficiais da empresa no bucket `templates/pecas`.
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../_shared/sigef_pdf.ts";
import { gerarPecasPosseXml, gerarPecasXml, montarTrechosPecas } from "../_shared/pecas.ts";
import type { DadosPecas, Requerente } from "../_shared/pecas.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// [chave interna, arquivo do template, título] — a declaração de faixa de
// domínio (chave "7") só entra quando o imóvel confronta com estrada/corredor/rio.
const PECAS_MATRICULA = [
  ["1", "1-memorial-descritivo", "1 - Memorial Descritivo"],
  ["2", "2-memorial-tabular", "2 - Memorial Tabular"],
  ["3", "3-cartas-anuencia", "3 - Cartas de Anuência"],
  ["4", "4-declaracao-tecnico", "4 - Declaração do Técnico"],
  ["5", "5-declaracao-proprietario", "5 - Declaração do Proprietário"],
  ["6", "6-requerimento", "6 - Requerimento"],
  ["7", "7-declaracao-faixa-dominio", "7 - Declaração Faixa de Domínio"],
] as const;
const PECAS_POSSE = [
  ["1", "1-memorial-descritivo", "1 - Memorial Descritivo"],
  ["2", "2-memorial-tabular", "2 - Memorial Tabular"],
  ["3", "3-cartas-anuencia", "3 - Cartas de Anuência"],
  ["7", "4-declaracao-faixa-dominio", "4 - Declaração Faixa de Domínio"],
] as const;

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

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 25);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { servico_id, pdf_base64, modo } = await req.json();
    if (!pdf_base64) return json({ erro: "pdf_base64 é obrigatório" }, 400);

    // ---------------- modo "analisar": só lê o PDF e devolve o resumo ----------------
    // Usado pelo Serviço 2 (peças direto do PDF) p/ pré-preencher o cadastro.
    if (modo === "analisar") {
      const bytes = b64ToBytes(pdf_base64);
      const proxy = await getDocumentProxy(bytes);
      const { text: txt } = await extractText(proxy, { mergePages: true });
      const dadosSigef = parseSigefTexto(txt as string);
      const trechosPdf: { codigo: string; confrontacao: string; segmentos: number }[] = [];
      let ultima = "";
      for (const l of dadosSigef.linhas) {
        if (l.confrontacao !== ultima) {
          ultima = l.confrontacao;
          trechosPdf.push({ codigo: l.codigo, confrontacao: l.confrontacao.replace(/\.{3}$/, ""), segmentos: 1 });
        } else {
          trechosPdf[trechosPdf.length - 1].segmentos++;
        }
      }
      return json({ ok: true, cabecalho: dadosSigef.cabecalho, trechos: trechosPdf, vertices: dadosSigef.linhas.length });
    }

    if (!servico_id) return json({ erro: "servico_id é obrigatório" }, 400);

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: servico } = await supa.from("servicos").select().eq("id", servico_id).single();
    if (!servico) return json({ erro: "Serviço não encontrado" }, 404);
    const { data: vertices } = await supa.from("vertices").select().eq("servico_id", servico_id).order("ordem");
    const { data: trechoRows } = await supa.from("trechos_confrontantes").select().eq("servico_id", servico_id).order("vertice_inicio_ordem");
    const rt = servico.rt_id ? (await supa.from("responsaveis_tecnicos").select().eq("id", servico.rt_id).single()).data : null;

    // validações mínimas
    const faltando: string[] = [];
    if (!servico.detentor_nome) faltando.push("detentor");
    if (!servico.denominacao) faltando.push("denominação");
    if (!servico.municipio || !servico.uf) faltando.push("município/UF");
    if (!rt) faltando.push("responsável técnico");
    if (faltando.length) return json({ erro: `Complete os dados do serviço antes: ${faltando.join(", ")}` }, 422);

    // ---------------- PDF ----------------
    const pdfBytes = b64ToBytes(pdf_base64);
    const pdf = await getDocumentProxy(pdfBytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const sigef = parseSigefTexto(text as string);

    // ---------------- trechos: código do vértice inicial → descritivo ----------------
    // serviço 'pecas': o trecho guarda o código direto (codigo_inicio);
    // serviço 'geo': resolve pelo vértice na ordem indicada.
    const inicios = new Map<string, { descritivo: string; tipoLimite: string }>();
    for (const t of trechoRows ?? []) {
      const codigo = t.codigo_inicio || (vertices ?? []).find((x) => x.ordem === t.vertice_inicio_ordem)?.codigo;
      if (codigo) inicios.set(codigo, { descritivo: t.descritivo || t.apelido_txt || "", tipoLimite: t.tipo_limite });
    }
    // fallback: PDF de outra geração (códigos diferentes) → detecta trechos pela
    // mudança da confrontação e tenta casar com o descritivo completo do banco
    if (!sigef.linhas.some((l) => inicios.has(l.codigo))) {
      inicios.clear();
      let ultima = "";
      for (const l of sigef.linhas) {
        if (l.confrontacao !== ultima) {
          ultima = l.confrontacao;
          const alvo = norm(l.confrontacao.replace(/\.{3}$/, ""));
          const match = (trechoRows ?? []).find((t) => norm(t.descritivo ?? "").startsWith(alvo.slice(0, 15)) || alvo.startsWith(norm(t.descritivo ?? "").slice(0, 15)));
          inicios.set(l.codigo, {
            descritivo: match?.descritivo || l.confrontacao.replace(/\.{3}$/, ""),
            tipoLimite: match?.tipo_limite ?? "LA1",
          });
        }
      }
    }
    const { trechos, confrontacaoDe } = montarTrechosPecas(sigef.linhas, inicios);
    const posse = servico.tipo_imovel === "posse";

    // ---------------- dados ----------------
    const requerentes: Requerente[] = [{
      nome: servico.detentor_nome, cpf: servico.detentor_cpf ?? "", genero: servico.detentor_genero === "F" ? "F" : "M",
    }];
    if (servico.requerente2_nome && !posse) {
      requerentes.push({ nome: servico.requerente2_nome, cpf: servico.requerente2_cpf ?? "", genero: servico.requerente2_genero === "F" ? "F" : "M" });
    }
    const viaAuto = trechos.find((t) => t.ehVia)?.descritivo ?? null;
    const dados: DadosPecas = {
      requerentes,
      rg: servico.detentor_rg ?? null,
      endereco: servico.endereco_detentor ?? "",
      municipio: servico.municipio,
      uf: servico.uf,
      denominacao: servico.denominacao,
      matricula: servico.matricula ?? sigef.cabecalho.matricula,
      cns: servico.cns ?? sigef.cabecalho.cns,
      sncrFmt: servico.codigo_sncr ?? sigef.cabecalho.sncr,
      sncrNum: (servico.codigo_sncr ?? sigef.cabecalho.sncr ?? "").replace(/\D/g, ""),
      areaHa: sigef.cabecalho.areaHa,
      perimetro: sigef.cabecalho.perimetroM,
      areaMatriculaHa: servico.area_matricula_ha ?? null,
      mcAbs: Math.abs(6 * (servico.fuso_utm ?? 24) - 183),
      trt: sigef.cabecalho.documentoRt.split(" ")[0] || sigef.cabecalho.documentoRt,
      dataStr: dataHojeBR(),
      rt: {
        nome: rt!.nome ?? "",
        formacao: rt!.formacao ?? "",
        conselhoSigla: rt!.conselho_sigla ?? "CFTA",
        conselhoNumero: rt!.conselho_numero ?? "",
        identidade: rt!.identidade ?? "",
        cpf: rt!.cpf ?? "",
      },
      viaDominio: servico.via_dominio || viaAuto,
      sigef, trechos, confrontacaoDe,
    };

    // ---------------- templates → geração → upload ----------------
    const PECAS = posse ? PECAS_POSSE : PECAS_MATRICULA;
    const pasta = posse ? "pecas-posse" : "pecas";
    const zips: Record<string, JSZip> = {};
    const tplXml: Record<string, string> = {};
    for (const [num, arquivo] of PECAS) {
      const dl = await supa.storage.from("templates").download(`${pasta}/${arquivo}.docx`);
      if (dl.error || !dl.data) return json({ erro: `Template ${pasta}/${arquivo}.docx não encontrado no Storage` }, 500);
      const zip = await JSZip.loadAsync(await dl.data.arrayBuffer());
      zips[num] = zip;
      tplXml[num] = await zip.file("word/document.xml")!.async("string");
    }
    const xmls = posse ? gerarPecasPosseXml(tplXml, dados) : gerarPecasXml(tplXml, dados);

    const nomeBase = (servico.denominacao ?? "documento").replace(/[\\/:*?"<>|]/g, "-").trim();
    const { data: vmax } = await supa.from("documentos_gerados").select("versao")
      .eq("servico_id", servico_id).order("versao", { ascending: false }).limit(1);
    const versao = ((vmax?.[0]?.versao as number | undefined) ?? 0) + 1;
    const historico: { servico_id: string; versao: number; tipo: string; titulo: string; path: string }[] = [];
    const arquivos: { titulo: string; url: string }[] = [];
    for (const [num, arquivo, titulo] of PECAS) {
      if (xmls[num] == null) continue; // ex.: declaração de faixa sem estrada/corredor/rio
      zips[num].file("word/document.xml", xmls[num]);
      const buf = await zips[num].generateAsync({ type: "uint8array", compression: "DEFLATE" });
      const path = `${servico_id}/v${versao}/pecas/${arquivo}.docx`;
      historico.push({ servico_id, versao, tipo: `peca_${num}`, titulo, path });
      const up = await supa.storage.from("gerados").upload(path, buf, {
        upsert: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      if (up.error) throw up.error;
      const s = await supa.storage.from("gerados").createSignedUrl(path, 3600, { download: `${titulo} - ${nomeBase}.docx` });
      arquivos.push({ titulo, url: s.data?.signedUrl ?? "" });
    }

    await supa.from("servicos").update({ status: "gerado" }).eq("id", servico_id);
    await supa.from("documentos_gerados").insert(historico);

    return json({
      ok: true,
      arquivos,
      resumo: {
        areaHa: sigef.cabecalho.areaHa,
        perimetro: sigef.cabecalho.perimetroM,
        trt: dados.trt,
        vertices: sigef.linhas.length,
        cartas: trechos.filter((t) => !t.ehVia && t.pessoas.length > 0).length,
        via: trechos.filter((t) => t.ehVia).map((t) => t.descritivo).join(", ") || null,
      },
    });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
