// Edge Function gerar-planta: gera a PLANTA (PDF) do imóvel.
//   matrícula → folha A1 com quadro analítico · posse → folha A3 sem quadro
//   serviço 'geo'  : usa os dados do próprio sistema (códigos já alocados)
//   serviço 'pecas': usa o PDF do SIGEF (azimutes/distâncias SGL) + projeção
// A logo da empresa vem de templates/logo-empresa.(png|jpg) no Storage.
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefBlocos } from "../_shared/sigef_pdf.ts";
import { areaTotalHa, avisosDoCasamento, casarBlocosComGlebas } from "../_shared/sigef_glebas.ts";
import { montarServico } from "../_shared/servico.ts";
import type { ServicoInput } from "../_shared/servico.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { gerarPlantaPdf } from "../_shared/planta.ts";
import type { Folha, TrechoPlanta, VerticePlanta } from "../_shared/planta.ts";
import { montarTrechosDoSigef, reconciliarVerticesBancoComSigef, trechosPlantaDoSigef } from "../_shared/reconciliacao.ts";
import type { VerticeReconciliado } from "../_shared/reconciliacao.ts";
import {
  bytesDeBase64, carregarLogoPlanta, dataHojeBR, geometriaDoCalculo, identificacaoDaGleba, montarDadosPlanta,
} from "../_shared/planta_dados.ts";
import type { GlebaRow } from "../_shared/planta_dados.ts";
import type { GlebaPlanta, ParteDaPlanta } from "../_shared/planta.ts";
import { fmtBR } from "../_shared/geo.ts";

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

/**
 * Os índices do anel cuja aresta de SAÍDA pertence ao trecho — de `inicioIdx`
 * até um antes de `fimIdx`, dando a volta. É o formato que a planta usa para
 * saber onde pintar a linha dupla de estrada (vermelha) e a de rio (azul):
 * `viasIdx`/`riosIdx` são vértices, e o trecho é um intervalo.
 */
function idxDoTrecho(t: { inicioIdx: number; fimIdx: number }, total: number): number[] {
  if (total <= 0) return [];
  const out: number[] = [];
  // trecho que dá a volta inteira (início === fim) cobre o anel todo
  const quantos = ((t.fimIdx - t.inicioIdx) % total + total) % total || total;
  for (let k = 0; k < quantos; k++) out.push((t.inicioIdx + k) % total);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // `folha` (A1/A3) é escolha do operador na tela; ausente = regra histórica
    // (posse → A3, matrícula → A1)
    const { servico_id, pdf_base64, satelite_base64, satelite_tipo, folha } = await req.json();
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
    // Prévia de glebas: cada memorial do PDF é uma parte desenhada por inteiro e
    // uma gleba do quadro analítico. Vazios = imóvel de memorial único, e a
    // planta sai idêntica à de sempre.
    const partes: ParteDaPlanta[] = [];
    const glebas: GlebaPlanta[] = [];
    const avisos: string[] = [];
    // vértices oficializados pelo SIGEF, gravados só depois que o PDF sai
    let persistirReconciliados: VerticeReconciliado[] = [];
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
      // A prévia de um serviço de glebas traz UM MEMORIAL POR GLEBA no mesmo
      // PDF. Lê-los como uma tabela só quebrava o encadeamento vante→código na
      // virada de gleba e a geração falhava inteira. Ver parseSigefBlocos.
      const blocos = parseSigefBlocos(text as string);
      const sigef = blocos[0];
      const lon0 = gmsPdfParaDeg(sigef.linhas[0].lon);
      latMedia = gmsPdfParaDeg(sigef.linhas[0].lat);
      if (!servico.fuso_utm) fuso = Math.floor((lon0 + 180) / 6) + 1;

      if (blocos.length > 1) {
        // -------- prévia de GLEBAS: cada memorial é uma parte da planta --------
        const { data: glebaRows } = await supa.from("glebas").select().eq("servico_id", servico_id).order("ordem");
        const casados = casarBlocosComGlebas(blocos, (glebaRows ?? []) as GlebaRow[], servico.denominacao ?? "", fuso, proj4);
        avisos.push(...avisosDoCasamento(casados, (glebaRows ?? []) as GlebaRow[]));

        for (const c of casados) {
          // Uma reconciliação POR GLEBA: correr os vértices do banco contra as
          // linhas das três glebas de uma vez casaria o marco de uma gleba com o
          // homônimo da vizinha, e a gleba sairia com a confrontação da outra.
          const rec = reconciliarVerticesBancoComSigef(servico_id, vertRows ?? [], c.bloco.linhas, fuso, proj4);
          const vertsGleba: VerticePlanta[] = c.bloco.linhas.map((l, i) => ({
            codigo: l.codigo,
            e: rec[i] ? rec[i].e : 0,
            n: rec[i] ? rec[i].n : 0,
            lonFmt: l.lon, latFmt: l.lat, alt: l.alt,
            azFmt: l.azimute, distFmt: l.dist, vante: l.vante,
          }));
          const startsGleba = montarTrechosDoSigef(trechoRows ?? [], rec, c.bloco.linhas);
          const trechosGleba = trechosPlantaDoSigef(startsGleba);

          // Índices do anel DESTA gleba, contados a partir de onde ela começa na
          // geometria geral — a planta desenha um vetor só de vértices.
          const off = vertices.length;
          vertices.push(...vertsGleba);
          trechosPlanta.push(...trechosGleba.map((t) => ({ ...t, inicioIdx: t.inicioIdx + off, fimIdx: t.fimIdx + off })));
          partes.push({ nome: c.nome, vertices: vertsGleba, trechos: trechosGleba });

          // Área e perímetro vêm DO MEMORIAL da gleba, não de recalcular o anel:
          // é o número que o SIGEF certificou, e é ele que tem de sair na planta.
          const areaHaGleba = parseFloat(c.bloco.cabecalho.areaHa.replace(/\./g, "").replace(",", ".")) || 0;
          glebas.push({
            nome: c.nome,
            areaFmt: c.bloco.cabecalho.areaHa,
            tarefasFmt: fmtBR(areaHaGleba * 10000 / 4356, 2),
            perimetroFmt: c.bloco.cabecalho.perimetroM,
            identificacao: identificacaoDaGleba(servico, c.nome),
            vertices: vertsGleba,
            viasIdx: trechosGleba.flatMap((t) => (t.isEstrada ? idxDoTrecho(t, vertsGleba.length) : [])),
            riosIdx: trechosGleba.flatMap((t) => (t.isRio ? idxDoTrecho(t, vertsGleba.length) : [])),
          });
        }

        // ÁREA TOTAL = soma das glebas. PERÍMETRO TOTAL não existe: ele é
        // individual por gleba, e somá-lo daria um número que não é o contorno de
        // nada. A planta lista um perímetro por gleba (ver planta.ts), então este
        // campo fica vazio de propósito em vez de carregar uma soma inventada.
        areaFmt = fmtBR(areaTotalHa(blocos), 4);
        perimetroFmt = "";
        if (!trtSistema) trt = sigef.cabecalho.documentoRt.split(" ")[0] || trt;
        // Vértices do PDF NÃO substituem os do banco num serviço de glebas: a
        // lista reconciliada aqui é por gleba, e gravá-las em sequência
        // destruiria a divisão que o operador desenhou.
        persistirReconciliados = [];
      } else {

      // Reconciliação dos vértices cadastrados no banco com o PDF do SIGEF
      const verticesReconciliados = reconciliarVerticesBancoComSigef(
        servico_id,
        vertRows ?? [],
        sigef.linhas,
        fuso,
        proj4
      );

      // A gravação da lista reconciliada fica para DEPOIS do PDF (ver
      // `persistirReconciliados`, no fim do fluxo). Gravar aqui trocava os 50
      // vértices do serviço por um perímetro no formato do PDF e, se o desenho
      // estourasse logo em seguida, o banco ficava migrado pela metade: o
      // operador via o serviço mudar sem receber planta nenhuma. Foi exatamente
      // o que aconteceu na FAZENDA RIACHO DA CRUZ.
      persistirReconciliados = verticesReconciliados;

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
      // conversão compartilhada: leva estrada, rio E a marca de numerado
      trechosPlanta = trechosPlantaDoSigef(starts);
      areaFmt = sigef.cabecalho.areaHa;
      perimetroFmt = sigef.cabecalho.perimetroM;
      if (!trtSistema) trt = sigef.cabecalho.documentoRt.split(" ")[0] || trt;
      }
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
          // confrontante que o operador mandou sair numerado no desenho
          numerado: v.numerado,
          exibirPlanta: v.exibir_planta !== false,
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
    const folhaSaida: Folha = folha === "A1" || folha === "A3" ? folha : (posse ? "A3" : "A1");
    const dados = montarDadosPlanta({
      servico, rt, cred,
      desenhista: cfgDes?.value ?? "",
      geometria: { vertices, trechos: trechosPlanta, areaFmt, perimetroFmt, latMediaDeg: latMedia },
      fuso, trt,
      folha: folhaSaida,
      dataStr: dataHojeBR(),
      logo: await carregarLogoPlanta(supa),
      satelite: satelite_base64
        ? { bytes: bytesDeBase64(satelite_base64), tipo: satelite_tipo === "png" ? "png" : "jpg" }
        : null,
      // só existem na prévia de glebas; `undefined` mantém a planta do imóvel
      // simples byte a byte igual à de antes
      partes: partes.length ? partes : undefined,
      glebas: glebas.length ? glebas : undefined,
    });

    const pdfBytes = await gerarPlantaPdf(dados);

    // O PDF saiu: agora o serviço pode assumir o perímetro do SIGEF.
    if (persistirReconciliados.length > 0) {
      await supa.from("vertices").delete().eq("servico_id", servico_id);
      await supa.from("vertices").insert(persistirReconciliados);
    }

    const { data: vmax } = await supa.from("documentos_gerados").select("versao")
      .eq("servico_id", servico_id).order("versao", { ascending: false }).limit(1);
    const versao = ((vmax?.[0]?.versao as number | undefined) ?? 0) + 1;
    const path = `${servico_id}/v${versao}/planta.pdf`;
    const up = await supa.storage.from("gerados").upload(path, pdfBytes, { upsert: true, contentType: "application/pdf" });
    if (up.error) throw up.error;
    // "SIGEF" no título/nome do arquivo: esta é a planta oficial, para não se
    // confundir com a que sai junto do memorial (gerar-documentos, tipo planta_pdf_sistema)
    await supa.from("documentos_gerados").insert([{ servico_id, versao, tipo: "planta_pdf", titulo: `Planta ${folhaSaida} (PDF · SIGEF)`, path }]);
    const nomeBase = servico.denominacao.replace(/[\\/:*?"<>|]/g, "-").trim();
    const s = await supa.storage.from("gerados").createSignedUrl(path, 3600, { download: `Planta SIGEF - ${nomeBase}.pdf` });

    return json({
      ok: true,
      planta_pdf: s.data?.signedUrl,
      resumo: {
        vertices: vertices.length, area: areaFmt, perimetro: perimetroFmt,
        logo: !!dados.logo, folha: folhaSaida,
        // uma linha por gleba, para o operador conferir sem abrir o PDF
        glebas: glebas.length ? glebas.map((g) => ({ nome: g.nome, area: g.areaFmt, perimetro: g.perimetroFmt })) : undefined,
      },
      // Aviso NÃO é erro: a planta saiu. Mas se um memorial não casou com a
      // gleba desenhada, o operador precisa saber antes de mandar ao cartório.
      avisos: avisos.length ? avisos : undefined,
    });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
