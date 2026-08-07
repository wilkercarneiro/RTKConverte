// Edge Function gerar-pecas: recebe o PDF de prévia do SIGEF + servico_id,
// cruza com os dados do banco e gera as 7 peças técnicas (DOCX) a partir dos
// modelos oficiais da empresa no bucket `templates/pecas`.
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import proj4mod from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../_shared/sigef_pdf.ts";
import type { DadosSigef } from "../_shared/sigef_pdf.ts";
import { gerarPecasPosseXml, gerarPecasXml, montarTrechosPecas, rotuloVia, viasDaPlanta } from "../_shared/pecas.ts";
import type { DadosPecas, Requerente } from "../_shared/pecas.ts";
import { montarServico } from "../_shared/servico.ts";
import { geometriaDoCalculo, sigefDoCalculo } from "../_shared/planta_dados.ts";
import type { Proj4 } from "../_shared/geo.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

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
    // `origem: "calculo"` gera as peças a partir do cálculo do próprio sistema,
    // sem PDF do SIGEF. É o que a CONFERÊNCIA DE ÁREA usa para tirar o Memorial
    // Tabular: conferência é o que se faz ANTES de mandar ao SIGEF, então exigir
    // o PDF ali seria exigir o resultado do passo que ainda não aconteceu.
    // `apenas` restringe quais peças saem (a conferência pede só a "2").
    const { servico_id, pdf_base64, modo, origem, apenas } = await req.json();
    const doCalculo = origem === "calculo";
    if (!pdf_base64 && !doCalculo) return json({ erro: "pdf_base64 é obrigatório" }, 400);

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

    // ---------------- origem dos dados: PDF do SIGEF ou cálculo próprio ----------------
    const cred = servico.credenciado_id
      ? (await supa.from("credenciados").select().eq("id", servico.credenciado_id).single()).data
      : null;

    let sigef: DadosSigef;
    // trechos vindos do cálculo, quando é ele a origem (chave = código do M)
    let iniciosDoCalculo: Map<string, { descritivo: string; tipoLimite: string; ehVia?: boolean }> | null = null;

    if (doCalculo) {
      if (!vertices?.length) return json({ erro: "Serviço sem vértices" }, 422);
      if (vertices.some((v) => !v.codigo)) {
        return json({ erro: "Gere o memorial antes das peças — os códigos dos vértices são alocados na geração" }, 422);
      }
      const calc = montarServico({
        fusoUtm: servico.fuso_utm ?? 24,
        prefixo: cred?.prefixo_vertice ?? "",
        contadores: { M: 0, P: 0, V: 0 },
        vertices: vertices.map((v) => ({
          ordem: v.ordem, numTxt: v.num_txt,
          e: v.e === null ? null : Number(v.e), n: v.n === null ? null : Number(v.n),
          latGmsStr: v.inserido_manual ? v.lat_gms : null,
          lonGmsStr: v.inserido_manual ? v.lon_gms : null,
          h: Number(v.h), sigmaPos: Number(v.sigma_pos), sigmaH: Number(v.sigma_h),
          tipo: v.tipo, metodo: v.metodo, codigoManual: v.codigo, inserido: v.inserido_manual,
          descritivo: v.descritivo || v.apelido_txt || "", tipoLimite: v.tipo_limite,
          ehVia: v.eh_via, cns: v.cns, matricula: v.matricula,
        })),
      }, proj4);
      // A confrontação de cada vértice sai do trecho a que ele pertence — a
      // mesma invariante "de M a M" do resto do sistema (ARQUITETURA-TRECHOS.md),
      // e não da string truncada que o PDF traria.
      const descPorCodigo = new Map(calc.ring.map((v) => [v.codigo, v.trecho.descritivo]));
      sigef = sigefDoCalculo(geometriaDoCalculo(calc), {
        servico, rt, cred,
        trt: servico.trt?.trim() || (rt?.trt ?? "").trim(),
        confrontacaoDe: (c) => descPorCodigo.get(c) ?? "",
      });
      iniciosDoCalculo = new Map(
        calc.ring
          .filter((v) => v.iniciaTrecho)
          .map((v) => [v.codigo, {
            descritivo: v.iniciaTrecho!.descritivo,
            tipoLimite: v.iniciaTrecho!.tipoLimite,
            ehVia: v.iniciaTrecho!.ehVia,
          }]),
      );
    } else {
      const pdfBytes = b64ToBytes(pdf_base64);
      const pdf = await getDocumentProxy(pdfBytes);
      const { text } = await extractText(pdf, { mergePages: true });
      sigef = parseSigefTexto(text as string);
    }

    // ---------------- trechos: código do vértice inicial → descritivo ----------------
    // serviço 'pecas': o trecho guarda o código direto (codigo_inicio);
    // serviço 'geo': resolve pelo vértice na ordem indicada.
    const inicios = iniciosDoCalculo ?? new Map<string, { descritivo: string; tipoLimite: string; ehVia?: boolean }>();
    for (const t of iniciosDoCalculo ? [] : (trechoRows ?? [])) {
      const codigo = t.codigo_inicio || (vertices ?? []).find((x) => x.ordem === t.vertice_inicio_ordem)?.codigo;
      if (codigo) {
        inicios.set(codigo, {
          descritivo: t.descritivo || t.apelido_txt || "",
          tipoLimite: t.tipo_limite,
          // faixa de domínio marcada na planta manda; sem marca, o rótulo do
          // trecho ainda é reconhecido pelo texto (ESTRADA, CORREDOR, BA 408…)
          ehVia: !!t.eh_via,
        });
      }
    }
    // fallback: PDF de outra geração (códigos diferentes) → detecta trechos pela
    // mudança da confrontação e tenta casar com o descritivo completo do banco.
    // Não se aplica à origem 'calculo': lá os códigos são os mesmos por construção.
    if (!iniciosDoCalculo && !sigef.linhas.some((l) => inicios.has(l.codigo))) {
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
            ehVia: !!match?.eh_via,
          });
        }
      }
    }
    const { trechos, confrontacaoDe } = montarTrechosPecas(sigef.linhas, inicios);
    const posse = servico.tipo_imovel === "posse";

    // ---------------- dados ----------------
    const requerentes: Requerente[] = [{
      nome: servico.detentor_nome,
      cpf: servico.detentor_cpf ?? "",
      genero: servico.detentor_genero === "F" ? "F" : "M",
      isEspolio: !!servico.is_espolio,
      inventarianteNome: servico.inventariante_nome ?? null,
      inventarianteCpf: servico.inventariante_cpf ?? null,
      inventarianteRg: servico.inventariante_rg ?? null,
    }];
    if (servico.requerente2_nome && !posse) {
      requerentes.push({ nome: servico.requerente2_nome, cpf: servico.requerente2_cpf ?? "", genero: servico.requerente2_genero === "F" ? "F" : "M" });
    }
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
      // TRT preenchido no sistema manda: campo do serviço, depois o TRT padrão do
      // RT cadastrado; o PDF do SIGEF só entra se nada estiver preenchido.
      trt: servico.trt?.trim() || (rt?.trt ?? "").trim()
        || sigef.cabecalho.documentoRt.split(" ")[0] || sigef.cabecalho.documentoRt,
      dataStr: dataHojeBR(),
      rt: {
        nome: rt!.nome ?? "",
        formacao: rt!.formacao ?? "",
        conselhoSigla: rt!.conselho_sigla ?? "CFTA",
        conselhoNumero: rt!.conselho_numero ?? "",
        identidade: rt!.identidade ?? "",
        cpf: rt!.cpf ?? "",
      },
      sigef, trechos, confrontacaoDe,
    };

    // ---------------- templates → geração → upload ----------------
    // `apenas` recorta o que é ENTREGUE, não o que é gerado: gerarPecasXml lê
    // tpl["1"], tpl["2"], … sem guarda, então recortar o conjunto de templates
    // faria a peça que sobrou quebrar por causa das que não foram baixadas.
    // Baixar tudo e filtrar na emissão mantém o gerador intocado — ele é o
    // núcleo do fluxo que já funciona.
    const filtro: string[] | null = Array.isArray(apenas) && apenas.length ? apenas.map(String) : null;
    const TODAS = posse ? PECAS_POSSE : PECAS_MATRICULA;
    const PECAS = TODAS.filter(([num]) => !filtro || filtro.includes(num));
    if (PECAS.length === 0) return json({ erro: `Nenhuma peça corresponde a: ${filtro?.join(", ")}` }, 422);
    const pasta = posse ? "pecas-posse" : "pecas";
    const zips: Record<string, JSZip> = {};
    const tplXml: Record<string, string> = {};
    for (const [num, arquivo] of TODAS) {
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
        via: viasDaPlanta(trechos).map(rotuloVia).join(", ") || null,
      },
    });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
