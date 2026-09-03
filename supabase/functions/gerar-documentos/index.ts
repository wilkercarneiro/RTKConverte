// Edge Function gerar-documentos: monta o serviço a partir do banco (fonte da
// verdade), aloca códigos de vértice (transação nos contadores do credenciado),
// gera Memorial DOCX + Planilha ODS + Planta PDF e salva no bucket `gerados`.
//
// A planta daqui sai do MESMO cálculo que alimenta o memorial e a planilha — é a
// planta da etapa anterior ao SIGEF. Depois da certificação, gerar-planta produz
// a planta oficial a partir do PDF do SIGEF, no mesmo padrão de folha. As duas
// convivem: uma não substitui a outra.
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import JSZip from "jszip";
import { montarServico, validarConfrontacoes } from "../_shared/servico.ts";
import type { ServicoInput, VerticeServico } from "../_shared/servico.ts";
import { ehCodigoDeConferencia } from "../_shared/geo.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { buildDocumentXml, buildDocxSkeleton, extrairTimbre } from "../_shared/docx.ts";
import type { TimbreModelo } from "../_shared/docx.ts";
import { gerarMemorialDescritivoXml } from "../_shared/pecas.ts";
import { montarDadosPecasDoCalculo } from "../_shared/pecas_dados.ts";
import type { DadosMemorial } from "../_shared/memorial.ts";
import { patchOdsContent } from "../_shared/ods.ts";
import { gerarPlantaPdf } from "../_shared/planta.ts";
import type { Folha } from "../_shared/planta.ts";
import {
  bytesDeBase64, carregarLogoPlanta, dataHojeBR, geometriaDoCalculo, glebasParaPlanta, montarDadosPlanta,
} from "../_shared/planta_dados.ts";
import type { GlebaRow } from "../_shared/planta_dados.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/**
 * Prefixo legado dos códigos de conferência.
 *
 * A conferência já saiu com "PROV-M-0001", depois com o prefixo oficial do
 * credenciado ("DSBN-P-14300") e a marca `codigo_provisorio`. As duas formas
 * tinham o mesmo defeito: um código com cara de oficial numa peça que não vale
 * para protocolar. Hoje a prévia numera `P-1`, `P-2` (ver `codigoConferencia`).
 * Os formatos antigos continuam reconhecidos aqui para que serviços gerados
 * antes da mudança sejam renumerados na próxima geração.
 */
const PREFIXO_PROVISORIO = "PROV";

/**
 * Um código que NÃO vale para protocolar: está marcado na coluna, carrega o
 * prefixo legado ou é do formato da prévia. Num serviço completo, um código
 * assim vale como ausente — a alocação oficial o substitui.
 */
const ehCodigoProvisorio = (v: { codigo: string | null; codigo_provisorio?: boolean | null }) =>
  !!v.codigo_provisorio || ehCodigoDeConferencia(v.codigo) ||
  (!!v.codigo && v.codigo.startsWith(`${PREFIXO_PROVISORIO}-`));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    // a imagem de satélite é opcional aqui: sem ela a planta sai com o quadro
    // PLANTA DE SITUAÇÃO vazio e um aviso pedindo o reenvio
    // `folha` (A1/A3) é a escolha do operador para a planta do serviço completo;
    // ausente = regra histórica (posse → A3, matrícula → A1)
    const { servico_id, satelite_base64, satelite_tipo, folha: folhaPedida } = await req.json();
    if (!servico_id) return json({ erro: "servico_id ausente" }, 400);

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: servico, error: eS } = await supa.from("servicos").select().eq("id", servico_id).single();
    if (eS || !servico) return json({ erro: "Serviço não encontrado" }, 404);
    const { data: vertRows, error: eV } = await supa.from("vertices").select().eq("servico_id", servico_id).order("ordem");
    if (eV) throw eV;
    // a confrontação vive no próprio vértice M (ver ARQUITETURA-TRECHOS.md)

    // A confrontação vive no vértice M e o trecho vai de M a M — desalinhamento é
    // impossível por construção, mas dados legados e escrita direta no banco ainda
    // podem chegar inconsistentes. Ver ARQUITETURA-TRECHOS.md.
    const conf = validarConfrontacoes(vertRows ?? []);
    if (conf.erros.length) return json({ erro: conf.erros.join(" ") }, 422);

    // validações
    const obrig: [string, unknown][] = [
      ["detentor_nome", servico.detentor_nome], ["denominacao", servico.denominacao],
      ["municipio", servico.municipio], ["uf", servico.uf], ["fuso_utm", servico.fuso_utm],
      ["credenciado_id", servico.credenciado_id],
    ];
    const faltando = obrig.filter(([, v]) => !v).map(([k]) => k);
    if (faltando.length) return json({ erro: `Campos obrigatórios ausentes: ${faltando.join(", ")}` }, 422);
    if (!vertRows?.length) return json({ erro: "Serviço sem vértices" }, 422);
    for (const v of vertRows) {
      if (v.inserido_manual && !v.codigo) return json({ erro: `Vértice inserido (ordem ${v.ordem}) sem código` }, 422);
    }

    const { data: cred, error: eC } = await supa.from("credenciados").select().eq("id", servico.credenciado_id).single();
    if (eC || !cred) return json({ erro: "Credenciado não encontrado" }, 422);
    const rt = servico.rt_id
      ? (await supa.from("responsaveis_tecnicos").select().eq("id", servico.rt_id).single()).data
      : null;
    // desenhista do carimbo da planta (Configurações)
    const { data: cfgDes } = await supa.from("config_empresa").select("value").eq("key", "desenhista").maybeSingle();

    // Conferência de área é PRÉVIA: não vai ao SIGEF, então não pode queimar a
    // numeração oficial do credenciado. Os contadores do Anexo A só andam para
    // frente — código consumido numa conferência que não fecha é código perdido.
    //
    // Ela numera do zero, no formato da prévia: P-1, P-2, M-1 (`codigoConferencia`).
    // Sair com o prefixo do credenciado era pior do que não ter código nenhum —
    // o cliente lia "DSBN-P-14300" numa peça que não vale para protocolar e não
    // tinha como saber disso. Cada linha continua marcada em `codigo_provisorio`,
    // e é essa marca que manda os códigos serem refeitos quando a conferência
    // vira serviço completo.
    const conferencia = servico.modalidade === "conferencia";
    const prefixo = cred.prefixo_vertice;

    // PROMOÇÃO a serviço completo: uma conferência que virou serviço de verdade
    // chega aqui com todos os vértices já codificados, mas com códigos que nunca
    // foram alocados. Sem zerá-los, `precisaAlocar` daria falso e o memorial
    // oficial sairia com uma numeração que o credenciado não reservou.
    //
    // A conferência faz a sua própria limpeza: uma prévia gerada antes desta
    // mudança carrega códigos "PROV-…" ou "DSBN-…", e como regerar reaproveita o
    // que já tem código, o formato antigo ficaria preso ao serviço para sempre.
    // Zerar aqui faz a próxima geração renumerar no formato da prévia.
    for (const v of vertRows) {
      if (v.inserido_manual) continue;   // código digitado pelo operador, não alocado
      if (conferencia ? !ehCodigoDeConferencia(v.codigo) : ehCodigoProvisorio(v)) {
        v.codigo = null;
      }
    }

    // alocação de códigos: incrementa contadores apenas quando há vértice sem código
    const precisaAlocar = vertRows.some((v: { codigo: string | null; inserido_manual: boolean }) => !v.codigo && !v.inserido_manual);
    // Prévia: os contadores do credenciado não entram na conta — `alocarCodigos`
    // numera do 1 no estilo "conferencia". Duas conferências diferentes mostram
    // os mesmos números de propósito: o número é a posição no desenho.
    let contadores = { M: 0, P: 0, V: 0 };
    if (precisaAlocar && !conferencia) {
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
      // confrontação: só os M carregam; descritivo é opcional (sem ele usa o apelido,
      // sem ambos o memorial segue sem a cláusula "confrontando com a propriedade de")
      descritivo: v.descritivo || v.apelido_txt || "",
      tipoLimite: v.tipo_limite,
      ehVia: v.eh_via,
      cns: v.cns,
      matricula: v.matricula,
      // confrontante que o operador mandou sair numerado no desenho: na planta
      // fica só o número, e o texto vai ao quadro CONFRONTANTES do rodapé
      numerado: v.numerado,
    }));

    const input: ServicoInput = {
      fusoUtm: servico.fuso_utm,
      verticeInicialOrdem: servico.vertice_inicial ?? 0,
      prefixo,
      contadores,
      estiloCodigo: conferencia ? "conferencia" : "oficial",
      vertices,
    };
    const calc = montarServico(input, proj4);

    // Persiste códigos e a marca de prévia. A marca é gravada SEMPRE que o
    // serviço passa por aqui — inclusive ao promover a conferência, onde ela
    // precisa cair para false, senão a próxima geração jogaria fora códigos
    // oficiais recém-alocados.
    //
    // Vértice inserido à mão fica de fora da marca: o código dele foi digitado
    // pelo operador, não tirado do contador, e apagá-lo na promoção obrigaria a
    // redigitar o que já estava certo.
    const manuais = new Set(vertRows.filter((v) => v.inserido_manual).map((v) => v.ordem));
    if (precisaAlocar) {
      for (const v of calc.ring) {
        await supa.from("vertices")
          .update({ codigo: v.codigo, codigo_provisorio: conferencia && !manuais.has(v.ordem) })
          .eq("servico_id", servico_id).eq("ordem", v.ordem);
      }
    } else if (!conferencia) {
      await supa.from("vertices").update({ codigo_provisorio: false }).eq("servico_id", servico_id);
    }

    // ------------------------- glebas -------------------------
    // Carregadas antes do DOCX/ODS porque a PLANILHA também depende delas: com
    // glebas o arquivo sai com uma aba de perímetro por gleba.
    const glebas = servico.tem_glebas
      ? glebasParaPlanta(
        ((await supa.from("glebas").select().eq("servico_id", servico_id).order("ordem")).data ?? []) as GlebaRow[],
        calc,
        servico,
      )
      : undefined;

    // Uma aba `perimetro_N` por gleba, na ordem em que foram montadas. Sem
    // glebas, um perímetro só — exatamente o que a planilha sempre teve.
    const porCodigo = new Map(calc.linhasOds.map((l) => [l.codigo, l]));
    const hemisferio = calc.ring[0].latDeg < 0 ? "Sul" : "Norte";
    const perimetrosOds = glebas?.length
      ? glebas.map((g, i) => ({
        denominacaoParcela: g.nome,
        parcelaNumero: String(i + 1).padStart(3, "0"),
        lado: servico.lado ?? "Externo",
        mcAbs: calc.mcAbs,
        hemisferio,
        // vértice sem código é ponto livre digitado na tela: não tem linha na
        // planilha, e sair de fora é o sinal de que falta levantá-lo
        linhas: g.vertices.map((v) => porCodigo.get(v.codigo)).filter((l): l is NonNullable<typeof l> => !!l),
      }))
      : [{
        denominacaoParcela: servico.denominacao_parcela ?? "Parte 1",
        parcelaNumero: servico.parcela_numero ?? "001",
        lado: servico.lado ?? "Externo",
        mcAbs: calc.mcAbs,
        hemisferio,
        linhas: calc.linhasOds,
      }];

    // ------------------------- DOCX -------------------------
    // Avisos de todo o percurso: o DOCX já tem o seu (modelo ausente) e a planta
    // acrescenta os dela mais abaixo.
    const avisosGeracao = [...conf.avisos];
    // decide o conjunto de modelos e, mais abaixo, a folha da planta
    const posse = servico.tipo_imovel === "posse";
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
      // técnicos são registrados no CFT/CFTA, não no CREA — o número do conselho
      // preenche o campo do memorial quando não há CREA cadastrado
      rtCrea: (rt?.crea ?? "").trim() || (rt?.conselho_numero ?? ""),
      rtTrt: (servico.trt ?? "").trim() || (rt?.trt ?? ""),
      ring: calc.memorialRing,
      segs: calc.segs,
      confrontantesDescritivos: calc.trechosOrdenados.map((t) => t.descritivo).filter((d) => d.trim() !== ""),
    };
    // O memorial sai TIMBRADO, com o MESMO timbre das outras peças: cabeçalho
    // com a logo, marca d'água e rodapé de contato saem do
    // `memorial-template.docx`, que vive no Storage ao lado dos modelos das sete
    // peças. Aqui só se troca o corpo — a seção do modelo (que aponta para
    // cabeçalho, rodapé e margens) é preservada. Trocar o timbre da empresa é
    // trocar aquele arquivo, não mexer neste código.
    //
    // Sem o modelo, o memorial ainda sai: monta-se o pacote mínimo com a logo
    // como marca d'água. É pior — não tem rodapé nem logo no topo — mas é melhor
    // do que não gerar.
    const logo = await carregarLogoPlanta(supa);
    const zipDocx = new JSZip();
    // O modelo é o da PEÇA 1 — o mesmo arquivo que as sete peças usam. Não há
    // "modelo do memorial da geração" e "modelo do memorial das peças": é um só,
    // e é por isso que os dois saem idênticos.
    const tplMemorial = await supa.storage.from("templates")
      .download(`${posse ? "pecas-posse" : "pecas"}/1-memorial-descritivo.docx`);
    let doModelo = false;
    if (!tplMemorial.error && tplMemorial.data) {
      const tz = await JSZip.loadAsync(await tplMemorial.data.arrayBuffer());
      for (const name of Object.keys(tz.files)) {
        if (tz.files[name].dir) continue;
        zipDocx.file(name, await tz.file(name)!.async("uint8array"));
      }
      const dadosPecas = montarDadosPecasDoCalculo({ servico, rt, cred, calc, dataStr: dataHojeBR() });
      zipDocx.file(
        "word/document.xml",
        gerarMemorialDescritivoXml(await tz.file("word/document.xml")!.async("string"), dadosPecas, posse),
      );
      doModelo = true;
    }
    // Sem o modelo o memorial ainda sai, montado em código: não é o documento da
    // empresa, mas é melhor do que não gerar — e o aviso diz o que aconteceu.
    if (!doModelo) {
      const tplDocx = await supa.storage.from("templates").download("memorial-template.docx");
      let timbre: TimbreModelo | null = null;
      if (!tplDocx.error && tplDocx.data) {
        const tz = await JSZip.loadAsync(await tplDocx.data.arrayBuffer());
        for (const name of Object.keys(tz.files)) {
          if (tz.files[name].dir) continue;
          zipDocx.file(name, await tz.file(name)!.async("uint8array"));
        }
        timbre = extrairTimbre(await tz.file("word/document.xml")!.async("string"));
      }
      if (!timbre) for (const [path, content] of buildDocxSkeleton(logo)) zipDocx.file(path, content);
      zipDocx.file("word/document.xml", buildDocumentXml(dadosMemorial, !timbre && !!logo, timbre));
      avisosGeracao.push(
        `Memorial gerado fora do modelo da empresa: templates/${posse ? "pecas-posse" : "pecas"}/1-memorial-descritivo.docx não está no Storage.`,
      );
    }
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
    }, perimetrosOds);
    const zipOds = new JSZip();
    zipOds.file("mimetype", await zipIn.file("mimetype")!.async("uint8array"), { compression: "STORE" });
    for (const name of Object.keys(zipIn.files)) {
      if (name === "mimetype" || name === "content.xml" || zipIn.files[name].dir) continue;
      zipOds.file(name, await zipIn.file(name)!.async("uint8array"), { compression: "DEFLATE" });
    }
    zipOds.file("content.xml", patched, { compression: "DEFLATE" });
    const odsBuf = await zipOds.generateAsync({ type: "uint8array" });

    // ------------------------- PLANTA (PDF) -------------------------
    // Mesmo padrão de folha da planta pós-SIGEF (A1 matrícula / A3 posse), mas
    // desenhada com a geometria que acabou de gerar o memorial e a planilha.
    // Uma falha aqui não derruba o DOCX/ODS: vira aviso e os dois seguem.
    let plantaBuf: Uint8Array | null = null;

    // A conferência circula impressa em mesa, não em prancheta: sai em A3 por
    // padrão, ou na folha que o operador escolheu na tela. Serviço completo usa a
    // folha pedida na chamada (A1/A3); sem ela cai na regra de sempre
    // (posse → A3, matrícula → A1).
    const folha: Folha | undefined = conferencia
      ? ((["A1", "A3", "A4"].includes(servico.folha_conferencia ?? "") ? servico.folha_conferencia : "A3") as Folha)
      : (folhaPedida === "A1" || folhaPedida === "A3" ? (folhaPedida as Folha) : undefined);
    try {
      const dadosPlanta = montarDadosPlanta({
        servico, rt, cred,
        desenhista: cfgDes?.value ?? "",
        geometria: geometriaDoCalculo(calc),
        fuso: servico.fuso_utm,
        trt: (servico.trt ?? "").trim() || (rt?.trt ?? ""),
        dataStr: dataHojeBR(),
        logo,
        satelite: satelite_base64
          ? { bytes: bytesDeBase64(satelite_base64), tipo: satelite_tipo === "png" ? "png" : "jpg" }
          : null,
        folha, glebas, conferencia,
        // Só a prévia pode esconder campo: num serviço que vai ao SIGEF a
        // matrícula, a denominação e o TRT são obrigatórios, e deixar as
        // chaves passarem para lá abriria a porta para uma planta oficial
        // incompleta sair sem ninguém notar.
        exibir: conferencia
          ? {
            matricula: servico.conf_exibir_matricula !== false,
            denominacao: servico.conf_exibir_denominacao !== false,
            trt: servico.conf_exibir_trt !== false,
          }
          : undefined,
      });
      if (!dadosPlanta.satelite) {
        avisosGeracao.push("Planta gerada sem imagem de satélite — o quadro PLANTA DE SITUAÇÃO ficou vazio. Envie a imagem e gere os documentos de novo.");
      }
      plantaBuf = await gerarPlantaPdf(dadosPlanta);
    } catch (e) {
      avisosGeracao.push(`Memorial e planilha gerados, mas a planta falhou: ${e instanceof Error ? e.message : String(e)}`);
    }

    // ------------------------- upload + status + histórico -------------------------
    // cada geração é uma nova VERSÃO preservada (histórico em documentos_gerados)
    const { data: vmax } = await supa.from("documentos_gerados").select("versao")
      .eq("servico_id", servico_id).order("versao", { ascending: false }).limit(1);
    const versao = ((vmax?.[0]?.versao as number | undefined) ?? 0) + 1;
    const pDocx = `${servico_id}/v${versao}/memorial.docx`;
    const pOds = `${servico_id}/v${versao}/planilha.ods`;
    const u1 = await supa.storage.from("gerados").upload(pDocx, docxBuf, {
      upsert: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    if (u1.error) throw u1.error;
    const u2 = await supa.storage.from("gerados").upload(pOds, odsBuf, {
      upsert: true, contentType: "application/vnd.oasis.opendocument.spreadsheet",
    });
    if (u2.error) throw u2.error;

    // a planta desta etapa mora ao lado dos outros dois, na MESMA versão
    const pPlanta = `${servico_id}/v${versao}/planta-sistema.pdf`;
    // O título é o que o operador lê no histórico. Numa conferência ele precisa
    // dizer PRÉVIA: os códigos são provisórios e os documentos não servem para
    // protocolar. Ver PREFIXO_PROVISORIO.
    const selo = conferencia ? " · PRÉVIA" : "";
    const folhaSaida = folha ?? (posse ? "A3" : "A1");
    const docs = [
      { servico_id, versao, tipo: "memorial_docx", titulo: `Memorial Descritivo (DOCX)${selo}`, path: pDocx },
      { servico_id, versao, tipo: "planilha_ods", titulo: `Planilha SIGEF (ODS)${selo}`, path: pOds },
    ];
    if (plantaBuf) {
      const u3 = await supa.storage.from("gerados").upload(pPlanta, plantaBuf, { upsert: true, contentType: "application/pdf" });
      if (u3.error) {
        plantaBuf = null;
        avisosGeracao.push(`Memorial e planilha gerados, mas o envio da planta falhou: ${u3.error.message}`);
      } else {
        docs.push({
          servico_id, versao, tipo: "planta_pdf_sistema",
          titulo: `Planta ${folhaSaida} (PDF · dados do sistema)${selo}`, path: pPlanta,
        });
      }
    }
    if (conferencia) {
      avisosGeracao.push(
        `Conferência de área: os vértices saíram com o código do credenciado (${prefixo}-…), mas a numeração oficial NÃO foi consumida — ` +
        "os números partem do contador atual e valem como prévia. Ao converter em serviço completo, os códigos definitivos são alocados na próxima geração.",
      );
    }
    await supa.from("servicos").update({ status: "gerado" }).eq("id", servico_id);
    await supa.from("documentos_gerados").insert(docs);

    // URLs assinadas com download direto (Content-Disposition: attachment)
    const nomeBase = (servico.denominacao ?? "documento").replace(/[\\/:*?"<>|]/g, "-").trim();
    const s1 = await supa.storage.from("gerados").createSignedUrl(pDocx, 3600, { download: `Memorial - ${nomeBase}.docx` });
    const s2 = await supa.storage.from("gerados").createSignedUrl(pOds, 3600, { download: `Planilha SIGEF - ${nomeBase}.ods` });
    const s3 = plantaBuf
      ? await supa.storage.from("gerados").createSignedUrl(pPlanta, 3600, { download: `Planta - ${nomeBase}.pdf` })
      : null;
    return json({
      ok: true,
      avisos: avisosGeracao,
      memorial_docx: s1.data?.signedUrl,
      planilha_ods: s2.data?.signedUrl,
      planta_pdf: s3?.data?.signedUrl ?? null,
      folha: folhaSaida,
      modalidade: servico.modalidade ?? "completo",
      provisorio: conferencia,
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
