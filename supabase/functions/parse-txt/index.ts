// Edge Function parse-txt: recebe o TXT, valida, detecta fuso, converte
// coordenadas, sugere trechos/tipos e cria o serviço em rascunho.
// Toda a lógica de negócio roda server-side; o frontend só envia o arquivo.
//
// Serviço que CONFRONTA com área certificada: o corpo traz também
// `certificados` — um por CSV de exportação do SIGEF do vizinho, com o CSV
// bruto e os códigos dos vértices que o operador escolheu na planta. O CSV é
// reparseado aqui (fonte da verdade é o arquivo, não a tela) e os vértices
// escolhidos são unidos ao levantamento antes de gravar. Ver _shared/certificados.ts.
//
// TXT em PARTES: blocos de numeração por centena (1–75, 100–123, 200–228) são
// anéis separados — o imóvel cortado por estradas. Cada bloco vira uma parte
// (linha em `glebas`, "PARTE n") e o serviço nasce com `tem_glebas`; a união
// com certificados e o cálculo do preview rodam parte a parte.
//
// Fuso: `fuso` explícito (tela) > candidato mais perto dos vértices certificados
// > UF > prioridade histórica. O TXT sozinho é ambíguo perto de E = 500 km.
//
// LEITURA UNIVERSAL (0035): o arquivo pode vir em qualquer formato. A tela
// manda os bytes (`arquivo_base64`) e a `leitura` confirmada na prévia (receita,
// ordem, exclusões, σ declarado, confirmações); aqui a receita é REEXECUTADA
// sobre o arquivo — a fonte da verdade é o arquivo, não a tela — e o serviço só
// nasce sem bloqueio e com todas as confirmações. Cliente antigo (só
// `conteudo`): lê sozinho, como sempre. Ver _shared/leitor/.
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import {
  GEO_DEF, ZONAS_BR, calcularAreaHa, calcularSegmentos, calcularPerimetroM, calcularVertices,
  detectZoneCandidates, epsgForZone, escolherZona, fmtGmsPlanilha, parseGmsPlanilha, utmDef,
} from "../_shared/geo.ts";
import type { CandidatoZona, EntradaVertice, PontoTxt, Proj4 } from "../_shared/geo.ts";
import { sugerirTrechos } from "../_shared/servico.ts";
import {
  fusoPelosCertificados, montarVerticesUnidos, parseCsvSigef, unirEmBlocos,
} from "../_shared/certificados.ts";
import { abrirArquivo } from "../_shared/leitor/arquivo.ts";
import { separarLinhas } from "../_shared/leitor/abertura.ts";
import { executarReceita, lerLinhas } from "../_shared/leitor/index.ts";
import type { Leitura } from "../_shared/leitor/index.ts";
import { validarReceita } from "../_shared/leitor/receita.ts";
import type { GrupoCertificado, VerticeUnido } from "../_shared/certificados.ts";
import { autorDaChamada, ehRecusa, escritorioDoUsuario, exigirPermissao } from "../_shared/acesso.ts";
import type { ClienteUsuario } from "../_shared/acesso.ts";
import { mensagemDeErro } from "../_shared/vertices_db.ts";
import { CorpoInvalido, dentroDoLimite, lerJson, LIMITE_MB, MUITAS_CHAMADAS } from "../_shared/limite.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

/** Cliente no nome de quem chamou (RLS vale): descobre o escritório dele. */
const clienteDoUsuario = (req: Request) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ClienteUsuario;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

interface CertificadoEntrada { nome?: unknown; conteudo?: unknown; selecionados?: unknown }
type OrigemFuso = "informado" | "certificados" | "uf" | "automatico";

const entradaCalc = (l: VerticeUnido): EntradaVertice => l.inserido_manual
  ? { numTxt: l.num_txt, latGms: parseGmsPlanilha(l.lat_gms), lonGms: parseGmsPlanilha(l.lon_gms), h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h, inserido: true }
  : { numTxt: l.num_txt, e: l.e, n: l.n, h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h };

function bytesDeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function textoDoPdf(bytes: Uint8Array): Promise<string> {
  const proxy = await getDocumentProxy(bytes);
  const { text } = await extractText(proxy, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

interface LeituraPedida { receita?: unknown; ordem?: unknown; excluir?: unknown; sigma_padrao?: unknown; altura_padrao?: unknown; confirmados?: unknown; versao?: unknown; incluir?: unknown; ligacao?: unknown }

/** Altitudes estimadas pela coordenada na prévia (idx → m); o leitor só usa nos pontos sem altitude. */
function alturaPadraoDe(v: unknown): Record<number, number> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const out: Record<number, number> = {};
  let n = 0;
  for (const [k, h] of Object.entries(v as Record<string, unknown>)) {
    const idx = Number(k);
    if (!Number.isInteger(idx) || idx < 0 || typeof h !== "number" || !Number.isFinite(h) || h < -100 || h > 3100) continue;
    out[idx] = h;
    if (++n >= 20000) break;
  }
  return n ? out : null;
}

/** Linhas (inteiros > 0) de uma lista vinda da tela; o resto é descartado. */
const linhasDe = (v: unknown): number[] => Array.isArray(v) ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];

/** Ligação manual da prévia: partes × índices de ponto (inteiros >= 0); null = automática. */
function ligacaoDe(v: unknown): number[][] | null {
  if (!Array.isArray(v)) return null;
  const partes = v.filter(Array.isArray).map((p) => (p as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(0, 20000)).filter((p) => p.length);
  return partes.length ? partes.slice(0, 200) : null;
}

/**
 * Lê o arquivo: com a leitura confirmada na prévia, reexecuta a receita e exige
 * as confirmações; sem ela (cliente antigo), lê sozinho. Devolve a leitura ou a
 * recusa (status + mensagem).
 */
function lerPedido(linhas: string[], pedido: LeituraPedida | null, fusoTela: number | null): { leitura: Leitura; pedido: LeituraPedida | null } | { erro: string; status: number; faltam?: string[] } {
  if (!pedido) {
    let l = lerLinhas(linhas, { proj4 });
    if (!l) return { erro: "Não foi possível encontrar as coordenadas no arquivo", status: 422 };
    if (fusoTela !== null && l.fusoGeo !== null && l.fusoGeo !== fusoTela) l = executarReceita(linhas, { ...l.receita, fuso: fusoTela }, { proj4 });
    return { leitura: l, pedido: null };
  }
  const validada = validarReceita(pedido.receita);
  if (!validada.receita) return { erro: `Receita de leitura inválida: ${validada.erros.join("; ")}`, status: 400 };
  const receita = fusoTela !== null ? { ...validada.receita, fuso: fusoTela } : validada.receita;
  const ordem = pedido.ordem === "id" || pedido.ordem === "arquivo" || pedido.ordem === "auto" ? pedido.ordem : undefined;
  const excluir = linhasDe(pedido.excluir);
  // ajustes de pontos da prévia: inativos ativados e a ligação feita à mão
  const incluir = linhasDe(pedido.incluir);
  const ligacao = ligacaoDe(pedido.ligacao);
  const sp = pedido.sigma_padrao as { pos?: unknown; h?: unknown } | null | undefined;
  const sigmaPadrao = sp && Number(sp.pos) > 0 && Number(sp.h) > 0 && Number(sp.pos) <= 10 && Number(sp.h) <= 10 ? { pos: Number(sp.pos), h: Number(sp.h) } : null;
  // versão dos pontos escolhida na prévia ("" = levantamento; "postp_"…); ausente = automática
  const versao = typeof pedido.versao === "string" && pedido.versao.length <= 40 ? pedido.versao : null;
  const alturaPadrao = alturaPadraoDe(pedido.altura_padrao);
  const leitura = executarReceita(linhas, receita, { proj4, ordem, excluir, sigmaPadrao, alturaPadrao, versao, incluir, ligacao });
  const confirmados = new Set(Array.isArray(pedido.confirmados) ? pedido.confirmados.map(String) : []);
  const faltam = leitura.aConfirmar.filter((c) => !confirmados.has(c));
  if (faltam.length) {
    const msgs = leitura.avisos.filter((a) => faltam.includes(a.codigo)).map((a) => a.mensagem);
    return { erro: `Confirme na prévia antes de criar o serviço: ${msgs.join(" | ")}`, status: 422, faltam };
  }
  return { leitura, pedido: { ...pedido, ordem, excluir, sigma_padrao: sigmaPadrao, altura_padrao: alturaPadrao, versao, incluir, ligacao } };
}

/**
 * Grava como o arquivo foi lido (leituras_arquivo) e aprende o formato
 * (perfis_leitura): perfil usado ganha um uso; receita nova das regras, da IA
 * ou do operador vira perfil da empresa — o próximo arquivo igual entra sozinho.
 * Formato padrão e formatos especiais (GSI, XML, DXF…) não precisam de perfil.
 * Falha aqui nunca derruba a criação do serviço.
 */
// deno-lint-ignore no-explicit-any
async function registrarLeitura(supa: any, x: { servicoId: string; escritorioId: string | null; autor: string | null; nomeArquivo: string; formato: string; codificacao: string; leitura: Leitura; pedido: LeituraPedida | null }) {
  try {
    const r = x.leitura.receita;
    let perfilId: string | null = r.origem.startsWith("perfil:") ? r.origem.slice(7) : null;
    const tabular = r.registro === "linha" || r.registro === "planilha";
    if (x.escritorioId && tabular) {
      const agora = new Date().toISOString();
      if (perfilId) {
        const { data: p } = await supa.from("perfis_leitura").select("usos, confirmacoes_sem_edicao").eq("id", perfilId).maybeSingle();
        if (p) await supa.from("perfis_leitura").update({ usos: p.usos + 1, confirmacoes_sem_edicao: p.confirmacoes_sem_edicao + 1, ultimo_uso: agora, updated_at: agora }).eq("id", perfilId);
        else perfilId = null;
      } else if (r.origem !== "padrao") {
        const origem = r.origem.startsWith("ia:") ? "ia" : r.origem === "operador" ? "operador" : "regras";
        const { data: existente } = await supa.from("perfis_leitura").select("id, usos").eq("escritorio_id", x.escritorioId).eq("assinatura", x.leitura.assinatura).maybeSingle();
        const receita = { ...r, origem };
        if (existente) {
          await supa.from("perfis_leitura").update({ receita, origem, usos: existente.usos + 1, ultimo_uso: agora, updated_at: agora }).eq("id", existente.id);
          perfilId = existente.id;
        } else {
          const nome = `${x.formato.replace(/\s*\(.*\)$/, "")} — ${(r.explicacao || "").slice(0, 60) || x.nomeArquivo}`;
          const { data: novo } = await supa.from("perfis_leitura").insert({
            escritorio_id: x.escritorioId, assinatura: x.leitura.assinatura, receita, nome, origem,
            usos: 1, ultimo_uso: agora, criado_por: x.autor,
          }).select("id").single();
          perfilId = novo?.id ?? null;
        }
      }
    }
    await supa.from("leituras_arquivo").insert({
      servico_id: x.servicoId, escritorio_id: x.escritorioId, nome_arquivo: x.nomeArquivo, formato: x.formato,
      codificacao: x.codificacao, assinatura: x.leitura.assinatura, perfil_id: perfilId, origem: r.origem,
      receita: r, criterio_ordem: x.leitura.criterio, avisos: x.leitura.avisos,
      ignoradas: x.leitura.ignoradas.map((i) => ({ linha: i.linha, motivo: i.motivo, tipo: i.tipo })),
      confirmados: x.pedido ? x.leitura.aConfirmar : [], excluidas: (x.pedido?.excluir as number[] | undefined) ?? [],
      criado_por: x.autor,
    });
  } catch (e) {
    console.warn("parse-txt: leitura não registrada:", e);
  }
}

/** Colunas da modalidade vindas da tela (sem elas, o default do banco: completo). */
function camposDaModalidade(c: unknown): Record<string, unknown> {
  if (!c || typeof c !== "object") return {};
  const { modalidade, tem_glebas, divisao } = c as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (modalidade === "completo" || modalidade === "conferencia" || modalidade === "loteamento") out.modalidade = modalidade;
  if (tem_glebas === true) out.tem_glebas = true;
  if (divisao === true) out.divisao = { iguais: true };
  return out;
}

/** Nome de arquivo para o Storage: sem pasta, sem "..", só [letras números . _ - espaço], até 120. */
function nomeSeguro(bruto: string, padrao: string): string {
  const base = bruto.split(/[\\/]/).pop() ?? "";
  const limpo = base.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w.\- ]/g, "_").replace(/\.{2,}/g, "_").replace(/^[.\s]+/, "")
    .slice(0, 120).trim();
  return limpo || padrao;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { nome_arquivo, conteudo, arquivo_base64, leitura: leituraPedida, uf, fuso, certificados, tolerancia_certificados, tolerancia_linha, campos } = await lerJson(req, LIMITE_MB(40));
    const temBytes = typeof arquivo_base64 === "string" && arquivo_base64.length > 0;
    if (!temBytes && (typeof conteudo !== "string" || !conteudo.trim())) return json({ erro: "Conteúdo do TXT ausente" }, 400);
    // o serviço nasce no escritório de quem enviou (null = banco ainda sem escritórios)
    const acesso = await escritorioDoUsuario(clienteDoUsuario(req));
    if (ehRecusa(acesso)) return json({ erro: acesso.erro }, acesso.status);
    const semPermissao = await exigirPermissao(clienteDoUsuario(req), "servicos.criar", "criar serviços");
    if (semPermissao) return json({ erro: semPermissao.erro }, semPermissao.status);
    // quem criou (auditoria, 0026): a gravação abaixo é com a service_role
    const autor = await autorDaChamada(clienteDoUsuario(req));
    // auditoria 04/11/2026: limite de frequência por usuário/empresa (tabela limites_uso, 0038)
    if (!(await dentroDoLimite(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!), `ler:${acesso.escritorioId}`, 40, 300))) return json({ erro: MUITAS_CHAMADAS.erro }, MUITAS_CHAMADAS.status);
    // auditoria 04/11/2026: o nome vira caminho no Storage — sem pasta, sem "..",
    // só caracteres seguros (antes "../<outro>/x" saía da pasta do serviço)
    const nomeArquivo = nomeSeguro(typeof nome_arquivo === "string" ? nome_arquivo : "", "pontos.txt");

    // ---- confrontantes com área certificada (opcional) ----
    const grupos: GrupoCertificado[] = [];
    const csvsBrutos: { nome: string; conteudo: string }[] = [];
    if (Array.isArray(certificados)) {
      if (certificados.length > 30) return json({ erro: "No máximo 30 CSVs de vizinhos por envio." }, 413);
      for (const c of certificados as CertificadoEntrada[]) {
        if (!c || typeof c.conteudo !== "string" || !c.conteudo.trim()) continue;
        if (c.conteudo.length > 5_000_000) return json({ erro: "CSV de vizinho maior que 5 MB." }, 413);
        const nome = nomeSeguro(typeof c.nome === "string" ? c.nome : "", `certificado-${grupos.length + 1}.csv`);
        const parsed = parseCsvSigef(nome, c.conteudo);
        const sel = new Set(Array.isArray(c.selecionados) ? c.selecionados.map(String) : []);
        const vertices = parsed.vertices.filter((v) => sel.has(v.codigo));
        if (vertices.length === 0) return json({ erro: `${nome}: nenhum vértice certificado selecionado` }, 400);
        grupos.push({ nome, vertices, totalNoCsv: parsed.vertices.length });
        csvsBrutos.push({ nome, conteudo: c.conteudo });
      }
    }
    const tolNum = Number(tolerancia_certificados);
    const toleranciaM = Number.isFinite(tolNum) && tolNum >= 0 ? tolNum : 0.5;
    const tolLinhaNum = Number(tolerancia_linha);
    const toleranciaLinhaM = Number.isFinite(tolLinhaNum) && tolLinhaNum >= 0 ? tolLinhaNum : undefined;

    // ---- leitura do arquivo (qualquer formato) ----
    let bytesOriginais: Uint8Array, linhasArquivo: string[], formatoArquivo = "texto", codificacao = "utf-8";
    if (temBytes) {
      bytesOriginais = bytesDeBase64(arquivo_base64);
      if (bytesOriginais.length > 20 * 1024 * 1024) return json({ erro: "Arquivo maior que 20 MB" }, 413);
      const aberto = await abrirArquivo(bytesOriginais, nomeArquivo, { textoDoPdf });
      if (aberto.tipo === "binario") return json({ erro: `${aberto.binario!.formato}: ${aberto.binario!.orientacao}` }, 422);
      linhasArquivo = aberto.linhas; formatoArquivo = aberto.origem; codificacao = aberto.codificacao;
    } else {
      bytesOriginais = new TextEncoder().encode(conteudo);
      linhasArquivo = separarLinhas(conteudo);
    }
    // fuso escolhido na tela vale também para converter lat/lon (se o arquivo for geográfico)
    const fusoTela = ZONAS_BR.includes(Number(fuso)) ? Number(fuso) : null;
    const lido = lerPedido(linhasArquivo, leituraPedida && typeof leituraPedida === "object" ? leituraPedida as LeituraPedida : null, fusoTela);
    if ("erro" in lido) return json({ erro: lido.erro, ...(lido.faltam ? { faltam: lido.faltam } : {}) }, lido.status);
    const leitura = lido.leitura;
    const bloqueios = leitura.avisos.filter((a) => a.nivel === "bloqueio");
    if (bloqueios.length) {
      return json({ erro: bloqueios.map((b) => `${b.mensagem}${b.linhas?.length ? ` (linha${b.linhas.length > 1 ? "s" : ""} ${b.linhas.slice(0, 10).join(", ")})` : ""}`).join(" | ") }, 422);
    }
    // o anel lido, no formato de sempre do motor (PontoTxt), na ordem escolhida
    const pontos: PontoTxt[] = leitura.anel.map((p) => ({ num: p.num, rotulo: p.rotulo, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH }));
    const blocos = leitura.blocos;
    const candidatos = detectZoneCandidates(pontos, proj4);
    if (!candidatos.length) return json({ erro: "Nenhum fuso UTM brasileiro compatível com as coordenadas" }, 422);

    // ---- fuso ----
    let escolhido: CandidatoZona, ambiguo = false, foraDaUf = false, origemFuso: OrigemFuso;
    const avisosFuso: string[] = [];
    // arquivo geográfico: o E/N foi calculado num fuso — o serviço usa o mesmo
    const fusoPedido = fusoTela ?? leitura.fusoGeo ?? NaN;
    if (ZONAS_BR.includes(fusoPedido)) {
      const c = candidatos.find((x) => x.zone === fusoPedido);
      if (!c) {
        return json({ erro: `Fuso ${fusoPedido}S não é compatível com as coordenadas do TXT (candidatos: ${candidatos.map((x) => `${x.zone}S`).join(", ")})` }, 422);
      }
      escolhido = c; origemFuso = fusoTela !== null ? "informado" : "automatico";
    } else {
      const porCert = grupos.length ? fusoPelosCertificados(candidatos, grupos) : null;
      if (porCert && candidatos.length > 1) {
        escolhido = porCert.escolhido; origemFuso = "certificados";
        if (porCert.distanciaGraus > 0.5) avisosFuso.push(`Os vértices certificados ficam a ~${Math.round(porCert.distanciaGraus * 111)} km do levantamento — confira o fuso e os CSVs.`);
      } else {
        const r = escolherZona(candidatos, uf ?? null);
        escolhido = r.escolhido!; ambiguo = r.ambiguo; foraDaUf = r.foraDaUf;
        origemFuso = uf ? "uf" : "automatico";
      }
    }
    const ud = utmDef(escolhido.zone);
    const geoParaUtm = (lon: number, lat: number): [number, number] => proj4(GEO_DEF, ud, [lon, lat]);

    // GMS canônico dos pontos do TXT (o que sempre foi gravado em lat_gms/lon_gms)
    const calcTxt = calcularVertices(
      pontos.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })),
      escolhido.zone, proj4,
    );
    const trechosSug = sugerirTrechos(pontos);
    // união parte a parte (com um bloco só é a união de sempre)
    const uniao = unirEmBlocos(pontos, blocos, grupos, geoParaUtm, {
      toleranciaM, toleranciaLinhaM,
      inicios: new Set(trechosSug.map((t) => t.verticeInicioOrdem)),
    });
    const linhas = montarVerticesUnidos(
      pontos, trechosSug, uniao, grupos,
      (i) => ({ lat: fmtGmsPlanilha(calcTxt[i].latGms, "lat"), lon: fmtGmsPlanilha(calcTxt[i].lonGms, "lon") }),
      geoParaUtm,
    );
    const verticeInicial = linhas.find((l) => l.tipo === "M")?.ordem ?? 0;

    // ---- partes: cada bloco é um anel; o preview soma área e perímetro ----
    const partesLinhas = uniao.blocosAnel.map((pos) => pos.map((k) => linhas[k]));
    let areaHa = 0, perimetroM = 0;
    for (const pl of partesLinhas) {
      const calc = calcularVertices(pl.map(entradaCalc), escolhido.zone, proj4);
      areaHa += calcularAreaHa(calc);
      perimetroM += calcularPerimetroM(calcularSegmentos(calc));
    }
    const emPartes = partesLinhas.length > 1;

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const novo: Record<string, unknown> = {
      status: "rascunho",
      nome_arquivo_txt: nomeArquivo,
      fuso_utm: escolhido.zone,
      vertice_inicial: verticeInicial,
      uf: uf ?? null,
      // a modalidade do cartão escolhido: o crédito do mês (0027) é gasto nela,
      // no momento em que o serviço nasce
      ...camposDaModalidade(campos),
      // várias partes só existem como serviço com glebas: uma aba, uma poligonal
      // e um bloco de identificação por parte
      ...(emPartes ? { tem_glebas: true } : {}),
      ...(acesso.escritorioId ? { escritorio_id: acesso.escritorioId } : {}),
    };
    let { data: servico, error: eServ } = await supa.from("servicos")
      .insert(autor ? { ...novo, criado_por: autor } : novo).select().single();
    // banco ainda sem a 0026 (coluna criado_por): cria sem o autor
    if (eServ && autor) ({ data: servico, error: eServ } = await supa.from("servicos").insert(novo).select().single());
    if (eServ) throw eServ;

    // o arquivo ORIGINAL, byte a byte (qualquer formato), e ao lado a leitura
    // confirmada: é dela que a reunião de certificados e a regressão dos perfis
    // partem — o arquivo de um formato novo não é relido pelo parser antigo
    const up = await supa.storage.from("uploads-txt")
      .upload(`${servico.id}/${nomeArquivo}`, new Blob([bytesOriginais as BlobPart]), { upsert: true, contentType: temBytes ? "application/octet-stream" : "text/plain" });
    if (up.error) throw up.error;
    const leituraGuardada = {
      versao: 1, formato: formatoArquivo, codificacao,
      receita: leitura.receita, criterio: leitura.criterio, blocos: leitura.blocos,
      ordem: lido.pedido?.ordem ?? null, excluir: lido.pedido?.excluir ?? [], sigma_padrao: lido.pedido?.sigma_padrao ?? null,
      // altitudes estimadas pela coordenada (modelo de terreno) dos pontos que vieram sem
      altura_padrao: lido.pedido?.altura_padrao ?? null,
      // ajustes de pontos da prévia (a regressão dos perfis relê com eles)
      incluir: lido.pedido?.incluir ?? [], ligacao: lido.pedido?.ligacao ?? null,
      // a versão dos pontos que entrou (a regressão dos perfis relê com ela)
      versao_pontos: leitura.versoes.escolhida,
      confirmados: lido.pedido ? leitura.aConfirmar : [],
      anel: leitura.anel.map((p) => ({ num: p.num, nome: p.nome, num_sintetico: p.numSintetico, rotulo: p.rotulo, e: p.e, n: p.n, h: p.h, sigma_pos: p.sigmaPos, sigma_h: p.sigmaH, linha: p.linha, sigma_declarado: p.sigmaDeclarado })),
      avisos: leitura.avisos, ignoradas: leitura.ignoradas.map((i) => ({ linha: i.linha, motivo: i.motivo, tipo: i.tipo })),
    };
    const upL = await supa.storage.from("uploads-txt")
      .upload(`${servico.id}/leitura.json`, new Blob([JSON.stringify(leituraGuardada)], { type: "application/json" }), { upsert: true });
    if (upL.error) throw upL.error;
    // os CSVs dos vizinhos ficam ao lado do TXT: são a origem dos códigos
    // publicados, alimentam a reunião quando o fuso muda e servem à correção de
    // sobreposição. Com prefixo numérico: o SIGEF baixa todos como
    // "exportacao.csv", e dois vizinhos com o mesmo nome não podem se sobrescrever.
    for (const [i, c] of csvsBrutos.entries()) {
      const upCsv = await supa.storage.from("uploads-txt")
        .upload(`${servico.id}/certificados/${i + 1}-${c.nome}`, new Blob([c.conteudo], { type: "text/csv" }), { upsert: true });
      if (upCsv.error) throw upCsv.error;
    }

    // a confrontação nasce já no vértice M: um M inicia um trecho, que vai até o
    // próximo M. Ver ARQUITETURA-TRECHOS.md. (montarVerticesUnidos aplica a regra.)
    // procedência de cada vértice lido do arquivo: nome original e linha (0035)
    const linhasVert = linhas.map(({ txt_idx, certificado: _c, ...l }) => {
      const p = txt_idx !== null && txt_idx !== undefined ? leitura.anel[txt_idx] : null;
      return { servico_id: servico.id, ...l, nome_txt: p && p.nome ? p.nome : null, linha_txt: p ? p.linha : null };
    });
    let { data: vertices, error: eVert } = await supa.from("vertices").insert(linhasVert).select().order("ordem");
    // banco ainda sem a 0035: grava sem as colunas de procedência
    if (eVert && /nome_txt|linha_txt/.test(JSON.stringify(eVert))) {
      ({ data: vertices, error: eVert } = await supa.from("vertices")
        .insert(linhasVert.map(({ nome_txt: _n, linha_txt: _l, ...v }) => v)).select().order("ordem"));
    }
    if (eVert) throw eVert;

    // auditoria da leitura e o formato aprendido (0035; sem a migração, segue sem)
    await registrarLeitura(supa, {
      servicoId: servico.id, escritorioId: acesso.escritorioId, autor, nomeArquivo, formato: formatoArquivo, codificacao,
      leitura, pedido: lido.pedido,
    });

    // uma gleba ("PARTE n") por bloco, com o anel em E/N — é o que a conferência,
    // a planilha e a planta usam para tratar cada parte como um anel próprio
    if (emPartes) {
      const { error: eG } = await supa.from("glebas").insert(partesLinhas.map((pl, i) => ({
        servico_id: servico.id, ordem: i, nome: `PARTE ${i + 1}`,
        anel: pl.map((l) => [l.e, l.n]),
      })));
      if (eG) throw eG;
    }

    const trechos = (vertices ?? [])
      .filter((v) => v.tipo === "M")
      .map((v) => ({ vertice_inicio_ordem: v.ordem, apelido_txt: v.apelido_txt, descritivo: "" }));

    const preview = {
      fuso: escolhido.zone,
      epsg: epsgForZone(escolhido.zone),
      candidatos: candidatos.map((c) => c.zone),
      fusoAmbiguo: ambiguo,
      fusoOrigem: origemFuso,
      foraDaUf,
      areaHa,
      perimetroM,
      qtdM: linhas.filter((v) => v.tipo === "M").length,
      qtdP: linhas.filter((v) => v.tipo === "P").length,
      qtdV: linhas.filter((v) => v.tipo === "V").length,
      ...(emPartes ? {
        partes: partesLinhas.map((pl, i) => ({
          nome: `PARTE ${i + 1}`,
          pontos: pl.length,
          numeracao: `${pl.find((l) => l.num_txt !== null)?.num_txt ?? "?"}–${[...pl].reverse().find((l) => l.num_txt !== null)?.num_txt ?? "?"}`,
        })),
      } : {}),
      ...(grupos.length > 0 ? {
        certificados: {
          parcelas: grupos.length,
          total: grupos.reduce((s, g) => s + g.vertices.length, 0),
          igualados: uniao.igualados,
          inseridos: uniao.inseridos,
          removidos: uniao.removidos.map((i) => pontos[i].num),
          avisos: [...avisosFuso, ...uniao.avisos],
          tolerancia: toleranciaM,
        },
      } : {}),
    };
    return json({ servico, vertices, trechos, preview });
  } catch (err) {
    if (err instanceof CorpoInvalido) return json({ erro: err.message }, err.status);
    console.error("parse-txt:", err);
    return json({ erro: mensagemDeErro(err) }, 400);
  }
});
