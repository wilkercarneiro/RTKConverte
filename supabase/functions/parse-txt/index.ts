// Edge Function parse-txt: recebe o TXT, valida, detecta fuso, converte
// coordenadas, sugere trechos/tipos e cria o serviço em rascunho.
// Toda a lógica de negócio roda server-side; o frontend só envia o arquivo.
//
// Serviço que CONFRONTA com área certificada: o corpo traz também
// `certificados` — um por CSV de exportação do SIGEF do vizinho, com o CSV
// bruto e os códigos dos vértices que o operador escolheu na planta. O CSV é
// reparseado aqui (fonte da verdade é o arquivo, não a tela) e os vértices
// escolhidos são unidos ao levantamento antes de gravar: ponto nosso a menos da
// tolerância de um certificado vira ele; os demais entram no lado mais próximo.
// Ver _shared/certificados.ts.
import { createClient } from "@supabase/supabase-js";
import proj4mod from "proj4";
import {
  GEO_DEF, calcularAreaHa, calcularSegmentos, calcularPerimetroM, calcularVertices,
  detectZoneCandidates, escolherZona, fmtGmsPlanilha, parseGmsPlanilha, parseTxt, utmDef,
} from "../_shared/geo.ts";
import type { EntradaVertice, Proj4 } from "../_shared/geo.ts";
import { sugerirTrechos } from "../_shared/servico.ts";
import { montarVerticesUnidos, parseCsvSigef, unirCertificados } from "../_shared/certificados.ts";
import type { GrupoCertificado } from "../_shared/certificados.ts";

const proj4: Proj4 = (from, to, coords) => (proj4mod as unknown as Proj4)(from, to, coords);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

interface CertificadoEntrada { nome?: unknown; conteudo?: unknown; selecionados?: unknown }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { nome_arquivo, conteudo, uf, certificados, tolerancia_certificados } = await req.json();
    if (typeof conteudo !== "string" || !conteudo.trim()) return json({ erro: "Conteúdo do TXT ausente" }, 400);
    const nomeArquivo = typeof nome_arquivo === "string" && nome_arquivo ? nome_arquivo : "pontos.txt";

    // ---- confrontantes com área certificada (opcional) ----
    const grupos: GrupoCertificado[] = [];
    const csvsBrutos: { nome: string; conteudo: string }[] = [];
    if (Array.isArray(certificados)) {
      for (const c of certificados as CertificadoEntrada[]) {
        if (!c || typeof c.conteudo !== "string" || !c.conteudo.trim()) continue;
        const nome = typeof c.nome === "string" && c.nome ? c.nome : `certificado-${grupos.length + 1}.csv`;
        const parsed = parseCsvSigef(nome, c.conteudo);
        const sel = new Set(Array.isArray(c.selecionados) ? c.selecionados.map(String) : []);
        const vertices = parsed.vertices.filter((v) => sel.has(v.codigo));
        if (vertices.length === 0) return json({ erro: `${nome}: nenhum vértice certificado selecionado` }, 400);
        grupos.push({ nome, vertices });
        csvsBrutos.push({ nome, conteudo: c.conteudo });
      }
    }
    const tolNum = Number(tolerancia_certificados);
    const toleranciaM = Number.isFinite(tolNum) && tolNum >= 0 ? tolNum : 0.5;

    const pontos = parseTxt(conteudo);
    const candidatos = detectZoneCandidates(pontos, proj4);
    const { escolhido, ambiguo, foraDaUf } = escolherZona(candidatos, uf ?? null);
    if (!escolhido) return json({ erro: "Nenhum fuso UTM brasileiro compatível com as coordenadas" }, 422);
    const ud = utmDef(escolhido.zone);
    const geoParaUtm = (lon: number, lat: number): [number, number] => proj4(GEO_DEF, ud, [lon, lat]);

    // GMS canônico dos pontos do TXT (o que sempre foi gravado em lat_gms/lon_gms)
    const calcTxt = calcularVertices(
      pontos.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })),
      escolhido.zone, proj4,
    );
    const trechosSug = sugerirTrechos(pontos);
    const uniao = unirCertificados(pontos, grupos, geoParaUtm, toleranciaM);
    const linhas = montarVerticesUnidos(
      pontos, trechosSug, uniao, grupos,
      (i) => ({ lat: fmtGmsPlanilha(calcTxt[i].latGms, "lat"), lon: fmtGmsPlanilha(calcTxt[i].lonGms, "lon") }),
      geoParaUtm,
    );
    // o vértice inicial sugerido continua sendo o 1º início de trecho do TXT — na
    // sua NOVA posição, já que os certificados inseridos deslocam as ordens
    const primeiroInicio = trechosSug.length > 0 ? trechosSug[0].verticeInicioOrdem : null;
    const verticeInicial = primeiroInicio === null ? 0 : (linhas.find((l) => l.txt_idx === primeiroInicio)?.ordem ?? 0);

    // anel unido no motor geodésico: os certificados entram pelo GMS gravado, como
    // gerar-documentos fará depois — o preview mostra o que vai ser publicado
    const calc = calcularVertices(
      linhas.map((l): EntradaVertice => l.inserido_manual
        ? { numTxt: l.num_txt, latGms: parseGmsPlanilha(l.lat_gms), lonGms: parseGmsPlanilha(l.lon_gms), h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h, inserido: true }
        : { numTxt: l.num_txt, e: l.e, n: l.n, h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h }),
      escolhido.zone, proj4,
    );

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: servico, error: eServ } = await supa.from("servicos").insert({
      status: "rascunho",
      nome_arquivo_txt: nomeArquivo,
      fuso_utm: escolhido.zone,
      vertice_inicial: verticeInicial,
      uf: uf ?? null,
    }).select().single();
    if (eServ) throw eServ;

    const up = await supa.storage.from("uploads-txt")
      .upload(`${servico.id}/${nomeArquivo}`, new Blob([conteudo], { type: "text/plain" }), { upsert: true });
    if (up.error) throw up.error;
    // os CSVs dos vizinhos ficam ao lado do TXT: são a origem dos códigos
    // publicados e servem à correção de sobreposição, se o SIGEF acusar
    for (const c of csvsBrutos) {
      const upCsv = await supa.storage.from("uploads-txt")
        .upload(`${servico.id}/certificados/${c.nome}`, new Blob([c.conteudo], { type: "text/csv" }), { upsert: true });
      if (upCsv.error) throw upCsv.error;
    }

    // a confrontação nasce já no vértice M: um M inicia um trecho, que vai até o
    // próximo M. Ver ARQUITETURA-TRECHOS.md. (montarVerticesUnidos aplica a regra.)
    const linhasVert = linhas.map(({ txt_idx: _i, certificado: _c, ...l }) => ({ servico_id: servico.id, ...l }));
    const { data: vertices, error: eVert } = await supa.from("vertices").insert(linhasVert).select().order("ordem");
    if (eVert) throw eVert;

    const trechos = (vertices ?? [])
      .filter((v) => v.tipo === "M")
      .map((v) => ({ vertice_inicio_ordem: v.ordem, apelido_txt: v.apelido_txt, descritivo: "" }));

    const segs = calcularSegmentos(calc);
    const preview = {
      fuso: escolhido.zone,
      epsg: escolhido.epsg,
      candidatos: candidatos.map((c) => c.zone),
      fusoAmbiguo: ambiguo,
      foraDaUf,
      areaHa: calcularAreaHa(calc),
      perimetroM: calcularPerimetroM(segs),
      qtdM: linhas.filter((v) => v.tipo === "M").length,
      qtdP: linhas.filter((v) => v.tipo === "P").length,
      qtdV: linhas.filter((v) => v.tipo === "V").length,
      ...(grupos.length > 0 ? {
        certificados: {
          parcelas: grupos.length,
          total: grupos.reduce((s, g) => s + g.vertices.length, 0),
          igualados: uniao.igualados,
          inseridos: uniao.inseridos,
          avisos: uniao.avisos,
          tolerancia: toleranciaM,
        },
      } : {}),
    };
    return json({ servico, vertices, trechos, preview });
  } catch (err) {
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
