// Edge Function corrigir-sobreposicao: recebe os CSVs de exportação das
// parcelas certificadas que o SIGEF apontou como sobrepostas, recalcula o
// perímetro do serviço e substitui os vértices/trechos no banco. A regeração
// dos documentos (ODS/DOCX) é feita em seguida pelo frontend chamando
// gerar-documentos — os códigos dos vértices mantidos são preservados.
//
// Dois tipos de vértice podem nascer aqui (ver PLANO-VERTICES-CERTIFICADOS.md):
//  - compartilhado: vértice da parcela certificada vizinha, gravado com o CÓDIGO,
//    as coordenadas GMS, o método, o sigma e a altitude do CSV. Vai ao banco como
//    `inserido_manual=true` + código — o canal que gerar-documentos já trata como
//    "código digitado": não realoca, não marca provisório, publica o GMS gravado;
//  - virtual (tipo V, método PA1): ponto calculado no afastamento, com código V
//    alocado dos contadores do credenciado.
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import {
  calcularVertices, codigoVertice, degToGmsCanonical, fmtGmsPlanilha,
  GEO_DEF, parseGmsPlanilha, utmDef,
} from "../_shared/geo.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { corrigirSobreposicao, parseCsvSigef } from "../_shared/sobreposicao.ts";
import type { ParcelaSigef, VerticeSigef } from "../_shared/sobreposicao.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

interface CsvEntrada { nome: string; conteudo: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { servico_id, csvs, afastamento, usar_vertices_certificados, tolerancia_igualar } = await req.json() as {
      servico_id?: string; csvs?: CsvEntrada[]; afastamento?: number;
      usar_vertices_certificados?: boolean; tolerancia_igualar?: number;
    };
    if (!servico_id) return json({ erro: "servico_id ausente" }, 400);
    if (!csvs?.length) return json({ erro: "Envie ao menos um CSV de exportação do SIGEF" }, 400);
    const afastamentoM = Number(afastamento) || 0.5;
    // ausente = ligado: a divisa com o vizinho certificado é descrita pelos vértices dele
    const usarCertificados = usar_vertices_certificados !== false;
    const tolIgualarM = Number.isFinite(Number(tolerancia_igualar)) && tolerancia_igualar !== undefined
      ? Number(tolerancia_igualar) : 0.5;

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: servico, error: eS } = await supa.from("servicos").select().eq("id", servico_id).single();
    if (eS || !servico) return json({ erro: "Serviço não encontrado" }, 404);
    if (!servico.fuso_utm) return json({ erro: "Serviço sem fuso UTM definido" }, 422);
    if (!servico.credenciado_id) return json({ erro: "Selecione o Credenciado antes de corrigir (os novos vértices precisam de código)" }, 422);
    const { data: vertRows, error: eV } = await supa.from("vertices").select().eq("servico_id", servico_id).order("ordem");
    if (eV) throw eV;
    if (!vertRows || vertRows.length < 3) return json({ erro: "Serviço com menos de 3 vértices" }, 422);
    // a confrontação vem nos próprios vértices (ver ARQUITETURA-TRECHOS.md)
    const { data: cred, error: eC } = await supa.from("credenciados").select().eq("id", servico.credenciado_id).single();
    if (eC || !cred) return json({ erro: "Credenciado não encontrado" }, 422);

    // anel publicado do serviço (mesmo pipeline canônico da geração)
    const fuso = servico.fuso_utm as number;
    const ud = utmDef(fuso);
    const calc = calcularVertices(
      vertRows.map((v) => ({
        numTxt: v.num_txt,
        e: v.e === null ? undefined : Number(v.e),
        n: v.n === null ? undefined : Number(v.n),
        latGms: v.inserido_manual && v.lat_gms ? parseGmsPlanilha(v.lat_gms) : undefined,
        lonGms: v.inserido_manual && v.lon_gms ? parseGmsPlanilha(v.lon_gms) : undefined,
        h: Number(v.h), sigmaPos: Number(v.sigma_pos), sigmaH: Number(v.sigma_h),
        inserido: v.inserido_manual,
      })),
      fuso, proj4,
    );
    const ring: [number, number][] = calc.map((c) => [c.eProj, c.nProj]);

    const proj = {
      utmParaGeo: (e: number, n: number) => proj4(ud, GEO_DEF, [e, n]),
      geoParaUtm: (lon: number, lat: number) => proj4(GEO_DEF, ud, [lon, lat]),
    };
    // Geometria pelo WKT: é o que o SIGEF guarda e usa no teste de sobreposição
    // (o GMS das colunas X/Y é a exibição a 0,001", até 2 cm de diferença).
    const parcelas: ParcelaSigef[] = csvs.map((c) => {
      const p = parseCsvSigef(c.nome, c.conteudo);
      return {
        nome: p.nome,
        ringUtm: p.pontos.map(([lon, lat]) => proj.geoParaUtm(lon, lat)),
        vertices: usarCertificados ? p.vertices : undefined,
      };
    });

    const r = corrigirSobreposicao(ring, parcelas, afastamentoM, proj, {
      usarVerticesCertificados: usarCertificados,
      toleranciaIgualarM: tolIgualarM,
    });

    const relatorioBase = {
      parcelas: r.parcelas.map((p) => ({ ...p, areaSobrepostaM2: Math.round(p.areaSobrepostaM2 * 100) / 100 })),
      avisos: r.avisos,
      areaAntesHa: Math.round(r.areaAntesM2 / 100) / 100 / 100,
      areaDepoisHa: Math.round(r.areaDepoisM2 / 100) / 100 / 100,
    };
    if (!r.precisaCorrigir) {
      return json({ ok: true, corrigido: false, relatorio: { ...relatorioBase, removidos: [], novos: [], compartilhados: [], igualados: 0 } });
    }

    // aloca códigos V só para os vértices virtuais (compartilhado já tem código)
    const ehVirtual = (p: { origIdx: number | null; certificado?: unknown }) => p.origIdx === null && !p.certificado;
    const qtdNovos = r.anel.filter(ehVirtual).length;
    let baseV = 0;
    if (qtdNovos > 0) {
      const { data: base, error: eA } = await supa.rpc("alocar_contadores", {
        p_credenciado: cred.id, dm: 0, dp: 0, dv: qtdNovos,
      });
      if (eA) throw eA;
      const b = Array.isArray(base) ? base[0] : base;
      baseV = b.base_v;
    }

    const verticeCert = (p: { certificado?: { parcela: number; idx: number } }): VerticeSigef | null =>
      p.certificado ? (parcelas[p.certificado.parcela].vertices?.[p.certificado.idx] ?? null) : null;

    // monta as novas linhas de vértices na ordem do anel corrigido
    const keptNewOrdem = new Map<number, number>(); // origIdx (posição antiga) → nova ordem
    r.anel.forEach((p, i) => {
      if (p.origIdx !== null) keptNewOrdem.set(p.origIdx, i);
    });
    const hInterp = (i: number): number => {
      const n = r.anel.length;
      const busca = (dir: number): number | null => {
        for (let s = 1; s < n; s++) {
          const p = r.anel[(i + dir * s + n * s) % n];
          const vc = verticeCert(p);
          if (vc) return vc.h;
          if (p.origIdx !== null) return Number(vertRows[p.origIdx].h);
        }
        return null;
      };
      const a = busca(-1), b = busca(1);
      if (a !== null && b !== null) return Math.round(((a + b) / 2) * 100) / 100;
      return a ?? b ?? 0;
    };
    let seqV = 0;
    const novosCodigos: string[] = [];
    const compartilhados: string[] = [];
    const linhaVazia = {
      servico_id, num_txt: null, rotulo_txt: null,
      descritivo: null, tipo_limite: null, eh_via: false,
      cns: null, matricula: null, apelido_txt: null,
    };
    const novasLinhas = r.anel.map((p, i) => {
      const vc = verticeCert(p);
      if (vc) {
        // vértice certificado do vizinho: com origIdx é um vértice NOSSO igualado a
        // ele — a linha nossa continua (confrontação, nº TXT, apelido); sem origIdx
        // é um ponto novo do anel
        const base = p.origIdx !== null
          ? (({ id: _id, ...v }) => v)(vertRows[p.origIdx])
          : { ...linhaVazia, tipo: "P", sigma_pos: 0, sigma_h: 0, h: 0 };
        compartilhados.push(vc.codigo);
        const sigmaPos = Math.max(vc.sigmaX, vc.sigmaY) || Number(base.sigma_pos) || 0.05;
        return {
          ...base,
          ordem: i,
          e: Math.round(p.e * 1000) / 1000, n: Math.round(p.n * 1000) / 1000,
          h: vc.h, sigma_pos: sigmaPos, sigma_h: vc.sigmaZ || Number(base.sigma_h) || 0.05,
          // M nosso continua M (a confrontação mora nele); senão o tipo do CSV, e um M
          // do vizinho vira P aqui — M no nosso anel significa "inicia confrontação"
          tipo: base.tipo === "M" ? "M" : (vc.tipo === "M" ? "P" : vc.tipo),
          codigo: vc.codigo, codigo_provisorio: false,
          metodo: vc.metodo || base.metodo || "PG2",
          inserido_manual: true,
          lat_gms: fmtGmsPlanilha(parseGmsPlanilha(vc.latGms), "lat"),
          lon_gms: fmtGmsPlanilha(parseGmsPlanilha(vc.lonGms), "lon"),
        };
      }
      if (p.origIdx !== null) {
        const { id: _id, ...v } = vertRows[p.origIdx];
        return { ...v, ordem: i };
      }
      const [lon, lat] = proj.utmParaGeo(p.e, p.n);
      const codigo = codigoVertice(cred.prefixo_vertice, "V", baseV + seqV++);
      novosCodigos.push(codigo);
      return {
        ...linhaVazia, ordem: i,
        e: Math.round(p.e * 1000) / 1000, n: Math.round(p.n * 1000) / 1000,
        h: hInterp(i), sigma_pos: 0, sigma_h: 0.02,
        tipo: "V", codigo, codigo_provisorio: false, metodo: "PA1", inserido_manual: true,
        lat_gms: fmtGmsPlanilha(degToGmsCanonical(lat), "lat"),
        lon_gms: fmtGmsPlanilha(degToGmsCanonical(lon), "lon"),
      };
    });
    const removidos = vertRows
      .map((v, i) => ({ v, i }))
      .filter(({ i }) => !keptNewOrdem.has(i))
      .map(({ v }) => v.codigo ?? `(ordem ${v.ordem})`);

    // A confrontação viaja junto com o vértice mantido (o spread acima já a leva).
    // Só precisa de tratamento o M que foi REMOVIDO: sua confrontação avança para o
    // próximo vértice mantido, que passa a ser o M daquele trecho.
    // Ver ARQUITETURA-TRECHOS.md.
    const idxPorOrdemAntiga = new Map<number, number>(vertRows.map((v, i) => [v.ordem as number, i]));
    const avancaAteMantido = (idxAntigo: number): number | null => {
      for (let s = 0; s < vertRows.length; s++) {
        const j = (idxAntigo + s) % vertRows.length;
        const novo = keptNewOrdem.get(j);
        if (novo !== undefined) return novo;
      }
      return null;
    };
    const avisos = [...r.avisos];
    vertRows.forEach((v, i) => {
      if (v.tipo !== "M" || keptNewOrdem.has(i)) return;
      const destino = avancaAteMantido(i);
      if (destino === null) return;
      const alvo = novasLinhas[destino];
      const rotulo = v.apelido_txt || v.descritivo || v.codigo || `(ordem ${v.ordem})`;
      if (alvo.descritivo) {
        avisos.push(`confrontante "${rotulo}" foi mesclado ao trecho vizinho (vértice ${v.codigo ?? ""} removido pela correção)`);
        return;
      }
      alvo.tipo = "M";
      alvo.descritivo = v.descritivo;
      alvo.tipo_limite = v.tipo_limite;
      alvo.eh_via = v.eh_via;
      alvo.cns = v.cns;
      alvo.matricula = v.matricula;
      alvo.apelido_txt = v.apelido_txt;
    });

    // remapeia o vértice inicial do memorial (precisa ser tipo M)
    const viAntigo = (servico.vertice_inicial as number | null) ?? 0;
    const viIdx = idxPorOrdemAntiga.get(viAntigo);
    let viNovo = viIdx === undefined ? null : avancaAteMantido(viIdx);
    if (viNovo === null || novasLinhas[viNovo]?.tipo !== "M") {
      const m = novasLinhas.find((v) => v.tipo === "M");
      viNovo = m ? (m.ordem as number) : 0;
      if (viAntigo !== viNovo) avisos.push("vértice inicial do memorial foi reposicionado (o anterior foi removido pela correção)");
    }

    // persiste (banco = fonte da verdade; o frontend recarrega e regera os documentos)
    const { error: e1 } = await supa.from("servicos").update({ vertice_inicial: viNovo, status: "rascunho" }).eq("id", servico_id);
    if (e1) throw e1;
    const { error: e2 } = await supa.from("vertices").delete().eq("servico_id", servico_id);
    if (e2) throw e2;
    const { error: e3 } = await supa.from("vertices").insert(novasLinhas);
    if (e3) throw e3;
    // trechos_confrontantes não é mais usada pelo fluxo 'geo' — a confrontação já
    // foi persistida junto com os vértices acima.

    return json({
      ok: true,
      corrigido: true,
      relatorio: {
        ...relatorioBase,
        avisos,
        totalVertices: r.anel.length,
        mantidos: r.anel.filter((p) => p.origIdx !== null && !p.certificado).length,
        removidos,
        novos: novosCodigos,
        compartilhados,
        igualados: r.igualados,
      },
    });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
