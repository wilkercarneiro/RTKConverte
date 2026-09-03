// Edge Function reunir-certificados: refaz a união entre o TXT do serviço e os
// vértices certificados dos vizinhos (CSVs guardados em uploads-txt/<id>/certificados/),
// no fuso pedido. Chamada pela conferência quando o operador troca o fuso — a
// ordem dos pontos depende de projetar TXT e CSV no MESMO fuso, e um fuso errado
// na entrada deixa os certificados a centenas de km do levantamento.
//
// Preserva o que o operador já fez na tela: confrontação e tipo dos pontos do
// TXT (por nº), códigos já alocados, vértices V digitados (PA1) e o vértice
// inicial. Ver _shared/certificados.ts.
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import {
  GEO_DEF, ZONAS_BR, calcularVertices, detectZoneCandidates, fmtGmsPlanilha, parseTxt, utmDef,
} from "../_shared/geo.ts";
import type { Proj4 } from "../_shared/geo.ts";
import { sugerirTrechos } from "../_shared/servico.ts";
import { blocosPorNumeracao, montarVerticesUnidos, parseCsvSigef, unirEmBlocos } from "../_shared/certificados.ts";
import type { GrupoCertificado, VerticeUnido } from "../_shared/certificados.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

interface LinhaBanco {
  id: string; servico_id: string; ordem: number; num_txt: number | null; rotulo_txt: string | null;
  e: number | string | null; n: number | string | null; h: number | string; sigma_pos: number | string; sigma_h: number | string;
  tipo: "M" | "P" | "V"; codigo: string | null; codigo_provisorio: boolean; metodo: string; inserido_manual: boolean;
  lat_gms: string; lon_gms: string; descritivo: string | null; tipo_limite: string | null; eh_via: boolean;
  cns: string | null; matricula: string | null; apelido_txt: string | null; numerado: boolean;
}

const CONFRONTACAO = ["descritivo", "tipo_limite", "eh_via", "cns", "matricula", "apelido_txt", "numerado"] as const;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { servico_id, fuso, tolerancia, tolerancia_linha } = await req.json();
    if (typeof servico_id !== "string" || !servico_id) return json({ erro: "servico_id ausente" }, 400);
    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: servico, error: eS } = await supa.from("servicos").select().eq("id", servico_id).single();
    if (eS || !servico) return json({ erro: "Serviço não encontrado" }, 404);
    const { data: atuaisRaw, error: eV } = await supa.from("vertices").select().eq("servico_id", servico_id).order("ordem");
    if (eV) throw eV;
    const atuais = (atuaisRaw ?? []) as LinhaBanco[];

    // ---- TXT e CSVs guardados na entrada do serviço ----
    if (!servico.nome_arquivo_txt) return json({ erro: "Serviço sem TXT guardado" }, 422);
    const dl = await supa.storage.from("uploads-txt").download(`${servico_id}/${servico.nome_arquivo_txt}`);
    if (dl.error || !dl.data) return json({ erro: `TXT não encontrado no Storage: ${dl.error?.message ?? ""}` }, 422);
    const pontos = parseTxt(await dl.data.text());

    const lista = await supa.storage.from("uploads-txt").list(`${servico_id}/certificados`);
    if (lista.error) throw lista.error;
    const csvs = (lista.data ?? []).filter((o) => /\.csv$/i.test(o.name)).sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true }));
    if (!csvs.length) return json({ erro: "Este serviço não tem CSVs de confrontantes certificados guardados" }, 422);

    // os vértices escolhidos são os que estão no anel hoje com código do vizinho
    // (inseridos ou igualados). Um V digitado (PA1) não é vizinho.
    const escolhidos = new Set(atuais.filter((v) => v.inserido_manual && v.codigo && v.metodo !== "PA1").map((v) => v.codigo as string));
    const grupos: GrupoCertificado[] = [];
    for (const o of csvs) {
      const d = await supa.storage.from("uploads-txt").download(`${servico_id}/certificados/${o.name}`);
      if (d.error || !d.data) throw new Error(`CSV ${o.name}: ${d.error?.message ?? "não baixou"}`);
      const parsed = parseCsvSigef(o.name, await d.data.text());
      const vertices = parsed.vertices.filter((v) => escolhidos.has(v.codigo));
      if (vertices.length) grupos.push({ nome: o.name, vertices, totalNoCsv: parsed.vertices.length });
    }
    if (!grupos.length) return json({ erro: "Nenhum vértice certificado do anel atual foi encontrado nos CSVs guardados" }, 422);

    // ---- fuso ----
    const zonaPedida = Number(fuso);
    const zone: number = ZONAS_BR.includes(zonaPedida) ? zonaPedida : Number(servico.fuso_utm);
    const candidatos = detectZoneCandidates(pontos, proj4);
    if (!candidatos.some((c) => c.zone === zone)) {
      return json({ erro: `Fuso ${zone}S não é compatível com as coordenadas do TXT (candidatos: ${candidatos.map((c) => `${c.zone}S`).join(", ")})` }, 422);
    }
    const ud = utmDef(zone);
    const geoParaUtm = (lon: number, lat: number): [number, number] => proj4(GEO_DEF, ud, [lon, lat]);
    const tolNum = Number(tolerancia);
    const tolLinhaNum = Number(tolerancia_linha);

    // ---- união ----
    const calcTxt = calcularVertices(
      pontos.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })),
      zone, proj4,
    );
    const trechosSug = sugerirTrechos(pontos);
    // TXT em partes (blocos de numeração): a união roda parte a parte
    const blocos = blocosPorNumeracao(pontos);
    const uniao = unirEmBlocos(pontos, blocos, grupos, geoParaUtm, {
      toleranciaM: Number.isFinite(tolNum) && tolNum >= 0 ? tolNum : 0.5,
      toleranciaLinhaM: Number.isFinite(tolLinhaNum) && tolLinhaNum >= 0 ? tolLinhaNum : undefined,
      inicios: new Set(trechosSug.map((t) => t.verticeInicioOrdem)),
    });
    const linhas = montarVerticesUnidos(
      pontos, trechosSug, uniao, grupos,
      (i) => ({ lat: fmtGmsPlanilha(calcTxt[i].latGms, "lat"), lon: fmtGmsPlanilha(calcTxt[i].lonGms, "lon") }),
      geoParaUtm,
    );

    // ---- preserva o trabalho da tela ----
    const porNum = new Map(atuais.filter((v) => v.num_txt !== null).map((v) => [v.num_txt as number, v]));
    const porCodigo = new Map(atuais.filter((v) => v.codigo).map((v) => [v.codigo as string, v]));
    type Nova = VerticeUnido & { numerado: boolean; cns: string | null; matricula: string | null };
    const novas: Nova[] = linhas.map((l) => {
      const nova: Nova = { ...l, numerado: false, cns: null, matricula: null };
      const atual = l.num_txt !== null ? porNum.get(l.num_txt) : (l.codigo ? porCodigo.get(l.codigo) : undefined);
      if (!atual) return nova;
      // a confrontação da tela vence a sugestão do rótulo
      if (atual.tipo === "M") {
        nova.tipo = "M";
        for (const k of CONFRONTACAO) (nova as unknown as Record<string, unknown>)[k] = atual[k];
        if (nova.descritivo === null) nova.descritivo = "";
        if (!nova.tipo_limite) nova.tipo_limite = "LA1";
      }
      if (l.num_txt !== null && !l.certificado) {
        // ponto nosso: código já alocado e método escolhido continuam
        nova.codigo = atual.codigo;
        nova.codigo_provisorio = atual.codigo_provisorio;
        nova.metodo = atual.metodo || nova.metodo;
      }
      return nova;
    });

    // vértices V digitados à mão: voltam logo depois do ponto que os antecedia
    const avisos = [...uniao.avisos];
    const manuais = atuais.filter((v) => v.inserido_manual && v.metodo === "PA1");
    for (const m of manuais) {
      let pos = -1;
      for (let i = atuais.indexOf(m) - 1; i >= 0 && pos < 0; i--) {
        const ant = atuais[i];
        pos = novas.findIndex((x) => (ant.num_txt !== null && x.num_txt === ant.num_txt) || (!!ant.codigo && x.codigo === ant.codigo));
      }
      if (pos < 0) { avisos.push(`Vértice ${m.codigo ?? "V"} digitado à mão não pôde ser reposicionado — insira de novo.`); continue; }
      const { id: _id, servico_id: _s, ordem: _o, ...resto } = m;
      novas.splice(pos + 1, 0, {
        ...(resto as unknown as Nova), e: Number(m.e ?? 0), n: Number(m.n ?? 0), h: Number(m.h), sigma_pos: Number(m.sigma_pos), sigma_h: Number(m.sigma_h),
        txt_idx: null, certificado: null, ordem: 0,
      });
    }
    novas.forEach((x, i) => { x.ordem = i; });

    // vértice inicial: o mesmo ponto, na nova posição
    const iniAtual = atuais.find((v) => v.ordem === servico.vertice_inicial);
    const novoInicial = iniAtual
      ? novas.find((x) => (iniAtual.num_txt !== null && x.num_txt === iniAtual.num_txt) || (!!iniAtual.codigo && x.codigo === iniAtual.codigo))?.ordem
      : undefined;

    // ---- grava ----
    const linhasVert = novas.map(({ txt_idx: _i, certificado: _c, ...l }) => ({
      servico_id, ...l,
      e: l.e === null || l.e === undefined ? null : l.e, n: l.n === null || l.n === undefined ? null : l.n,
    }));
    const { error: eDel } = await supa.from("vertices").delete().eq("servico_id", servico_id);
    if (eDel) throw eDel;
    const { data: vertices, error: eIns } = await supa.from("vertices").insert(linhasVert).select().order("ordem");
    if (eIns) throw eIns;
    // as PARTES (uma gleba por bloco) acompanham o anel novo: mesmos nomes e
    // confrontantes internos, anel refeito com os E/N atuais
    if (blocos.length > 1) {
      const partesLinhas = uniao.blocosAnel.map((pos) => pos.map((k) => linhas[k]));
      const { data: gAtuais } = await supa.from("glebas").select().eq("servico_id", servico_id).order("ordem");
      const atuaisG = gAtuais ?? [];
      if (atuaisG.length === partesLinhas.length) {
        for (const [i, pl] of partesLinhas.entries()) {
          const { error: eG } = await supa.from("glebas").update({ anel: pl.map((l) => [l.e, l.n]) }).eq("id", atuaisG[i].id);
          if (eG) throw eG;
        }
      } else {
        await supa.from("glebas").delete().eq("servico_id", servico_id);
        const { error: eG } = await supa.from("glebas").insert(partesLinhas.map((pl, i) => ({
          servico_id, ordem: i, nome: `PARTE ${i + 1}`, anel: pl.map((l) => [l.e, l.n]),
        })));
        if (eG) throw eG;
      }
    }

    const { error: eUp } = await supa.from("servicos")
      .update({ fuso_utm: zone, vertice_inicial: novoInicial ?? (novas.find((x) => x.tipo === "M")?.ordem ?? 0), ...(blocos.length > 1 ? { tem_glebas: true } : {}) })
      .eq("id", servico_id);
    if (eUp) throw eUp;

    return json({
      ok: true,
      vertices,
      resumo: {
        fuso: zone,
        parcelas: grupos.length,
        total: grupos.reduce((s, g) => s + g.vertices.length, 0),
        igualados: uniao.igualados,
        inseridos: uniao.inseridos,
        removidos: uniao.removidos.map((i) => pontos[i].num),
        avisos,
      },
    });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
