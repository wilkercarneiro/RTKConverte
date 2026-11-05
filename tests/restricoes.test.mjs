// Análise de restrições do imóvel (src/lib/restricoes.ts) contra respostas
// GRAVADAS das bases públicas (tests/fixtures/restricoes, gravadas por
// scripts/gravar_fixtures_restricoes.mjs) — sem internet. O que se lacra:
//   - imóvel dentro de TI e de UC conhecidas (Monte Pascoal/BA): nome, área e %;
//   - assentamento e embargo (Guarantã do Norte/MT), sem dado pessoal do embargado;
//   - imóvel livre;
//   - a área do imóvel é a do motor do sistema (UTM do fuso + Gauss);
//   - uma fonte fora do ar, com erro 500 ou lenta não derruba as outras;
//   - "encosta até X m", pontos (sítio arqueológico) e área partida em pedaços;
//   - a prévia grátis só diz tem/não tem;
//   - só hosts das bases públicas, só GET.
// O teste AO VIVO (RESTRICOES_AO_VIVO=1) consulta as bases de verdade.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import proj4 from "proj4";
import {
  AVISO_RESTRICOES, camadasDoResultado, consultarRestricoes, FONTES, HOSTS_RESTRICOES, previaRestricoes, resumoRestricoes, textoFonte, textoItem,
} from "../src/lib/restricoes.ts";
import { calcularAreaHa, GEO_DEF, utmDef } from "../supabase/functions/_shared/geo.ts";

const fixture = (nome) => JSON.parse(fs.readFileSync(new URL(`./fixtures/restricoes/${nome}.json`, import.meta.url), "utf8"));

// a chave da resposta: caminho + camada + tipo de consulta (a ordem dos parâmetros não importa)
const chave = (u) => {
  const x = new URL(u);
  const p = x.searchParams;
  return [x.host, decodeURIComponent(x.pathname), p.get("typeName") ?? "", p.get("spatialRel") ?? "", p.get("returnCountOnly") ?? "", p.get("geometry") ?? p.get("bbox") ?? ""].join("|");
};

function gravado(fx, { falhar = {} } = {}) {
  const mapa = new Map(fx.respostas.map((r) => [chave(r.url), r]));
  const pedidos = [];
  const f = async (url, init) => {
    pedidos.push({ url: String(url), metodo: init?.method ?? "GET" });
    for (const [trecho, modo] of Object.entries(falhar)) {
      if (String(url).includes(trecho)) {
        if (modo === "rede") throw new TypeError("Failed to fetch");
        if (modo === "lento") return new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
        if (typeof modo === "number") return new Response("erro", { status: modo });
      }
    }
    const r = mapa.get(chave(url));
    if (!r || r.corpo === null) throw new TypeError("Failed to fetch");
    return new Response(r.corpo, { status: r.status });
  };
  return { f, pedidos };
}

const AGORA = new Date("2026-11-05T12:00:00Z");
const fonte = (r, tipo) => r.fontes.find((x) => x.tipo === tipo);

test("Monte Pascoal: dentro da TI Barra Velha do Monte Pascoal e 60% no Parque Nacional", async () => {
  const fx = fixture("monte_pascoal");
  const { f, pedidos } = gravado(fx);
  const r = await consultarRestricoes([fx.anel], { fuso: fx.fuso, fetch: f, agora: AGORA });
  assert.equal(r.fontes.length, FONTES.length, "todas as fontes respondem algo");
  const ti = fonte(r, "ti");
  assert.equal(ti.classe, "sobrepoe");
  assert.equal(ti.servidor, "FUNAI — GeoServer (tis_poligonais)");
  const pascoal = ti.itens.find((i) => i.nome === "TI Barra Velha do Monte Pascoal");
  assert.ok(pascoal, "a TI pelo nome");
  assert.ok(pascoal.pct > 99.99, `imóvel inteiro dentro (${pascoal.pct})`);
  assert.ok(pascoal.detalhes.includes("Fase: Delimitada"));
  assert.equal(ti.atualizacao, "2026-04-14", "a data de atualização vem da FUNAI");
  const uc = fonte(r, "uc");
  assert.equal(uc.classe, "sobrepoe");
  const parna = uc.itens[0];
  assert.equal(parna.nome, "PARQUE NACIONAL E HISTÓRICO DO MONTE PASCOAL");
  assert.ok(Math.abs(parna.pct - 60.17) < 0.05, `UC ${parna.pct}%`);
  assert.ok(Math.abs(parna.areaM2 - 385209) < 50, `UC ${parna.areaM2} m²`);
  assert.ok(parna.sobreposta && parna.geometria, "geometria para o mapa");
  for (const t of ["assentamento", "quilombola", "embargo_ibama", "embargo_icmbio", "fronteira", "militar", "arqueologico"]) {
    assert.equal(fonte(r, t).classe, "livre", t);
  }
  assert.match(resumoRestricoes(r).texto, /^Sobrepõe terra indígena, unidade de conservação\.$/);
  assert.match(textoItem(parna), /^sobrepõe 38,52\d\d ha \(60,1\d% do imóvel\)$/);
  // só as bases públicas, só leitura
  for (const p of pedidos) {
    assert.ok(HOSTS_RESTRICOES.includes(new URL(p.url).host), p.url);
    assert.equal(p.metodo, "GET");
  }
  // camadas do mapa: uma por área encontrada, com a cor do tipo
  const cam = camadasDoResultado(r);
  assert.deepEqual(cam.map((c) => c.tipo).sort(), ["ti", "uc"]);
  assert.equal(cam.find((c) => c.tipo === "ti").cor, FONTES.find((x) => x.tipo === "ti").cor);
});

test("a área do imóvel é a do sistema: UTM do fuso do serviço + Gauss (calcularAreaHa)", async () => {
  const fx = fixture("monte_pascoal");
  const r = await consultarRestricoes([fx.anel], { fuso: 24, fetch: gravado(fx).f, agora: AGORA });
  const utm = fx.anel.map((p) => proj4(GEO_DEF, utmDef(24), p)).map(([e, n]) => ({ eProj: e, nProj: n }));
  assert.ok(Math.abs(r.areaImovelM2 / 10000 - calcularAreaHa(utm)) < 1e-6, `${r.areaImovelM2 / 1e4} × ${calcularAreaHa(utm)}`);
  assert.equal(r.fuso, 24);
  // no fuso 23 a área muda (outra projeção): o fuso do serviço é o que vale
  const r23 = await consultarRestricoes([fx.anel], { fuso: 23, fetch: gravado(fx).f, agora: AGORA, tipos: ["ti"] });
  assert.notEqual(Math.round(r23.areaImovelM2), Math.round(r.areaImovelM2));
});

test("Guarantã do Norte: assentamento inteiro e embargo do IBAMA, sem nome nem CPF do embargado", async () => {
  const fx = fixture("guaranta");
  const r = await consultarRestricoes([fx.anel], { fuso: fx.fuso, fetch: gravado(fx).f, agora: AGORA });
  const pa = fonte(r, "assentamento");
  assert.equal(pa.classe, "sobrepoe");
  assert.equal(pa.itens[0].nome, "PA BRAÇO SUL");
  assert.ok(pa.itens[0].pct > 99.99);
  assert.ok(pa.itens[0].detalhes.includes("Código SIPRA: MT0013000"));
  const emb = fonte(r, "embargo_ibama");
  assert.equal(emb.classe, "sobrepoe");
  assert.equal(emb.itens[0].nome, "Embargo IBAMA nº 447008-C");
  assert.ok(Math.abs(emb.itens[0].areaM2 / 1e4 - 3.127) < 0.01, `${emb.itens[0].areaM2} m²`);
  const texto = JSON.stringify(emb.itens);
  assert.doesNotMatch(texto, /cpf|cnpj|embargado|ROQUE/i, "nada de dado pessoal");
  assert.equal(fonte(r, "ti").classe, "livre");
});

test("imóvel livre: nenhuma restrição, nenhuma base fora", async () => {
  const fx = fixture("livre");
  const r = await consultarRestricoes([fx.anel], { fuso: fx.fuso, fetch: gravado(fx).f, agora: AGORA });
  assert.ok(r.fontes.every((x) => x.classe === "livre"), r.fontes.map((x) => `${x.tipo}:${x.classe}`).join(" "));
  assert.equal(resumoRestricoes(r).texto, "Nenhuma restrição encontrada nas bases consultadas.");
  assert.equal(textoFonte(fonte(r, "ti"), r.encostaM), "nenhuma área a menos de 300 m do imóvel");
  assert.ok(previaRestricoes(r).every((p) => p.tem === false));
});

test("fonte fora do ar não derruba as outras; a cópia assume quando o principal cai", async () => {
  const fx = fixture("monte_pascoal");
  const { f } = gravado(fx, { falhar: {
    "geoserver.funai.gov.br": "rede", // FUNAI fora: a cópia do PAMGIA (não gravada) também falha
    "geoservicos.inde.gov.br": 503, // CNUC com 503: tenta de novo e cai na cópia do PAMGIA, também fora
    "lim_uso_militar_a": 500, // 500 duas vezes
    "lim_quilombos_incra_a": "lento", // não responde: tempo esgotado, e a cópia do IBGE (não gravada) falha
  } });
  const r = await consultarRestricoes([fx.anel], { fuso: fx.fuso, fetch: f, agora: AGORA, timeoutMs: 80 });
  assert.equal(fonte(r, "ti").classe, "nao_consultado");
  assert.match(fonte(r, "ti").motivo, /fora do ar/);
  assert.equal(fonte(r, "uc").classe, "nao_consultado");
  assert.match(fonte(r, "uc").motivo, /503/);
  assert.equal(fonte(r, "militar").classe, "nao_consultado");
  assert.match(fonte(r, "militar").motivo, /respondeu 500/);
  assert.equal(fonte(r, "quilombola").classe, "nao_consultado");
  assert.match(fonte(r, "quilombola").motivo, /tempo esgotado/);
  // as outras seguem com a resposta normal
  assert.equal(fonte(r, "assentamento").classe, "livre");
  assert.equal(fonte(r, "fronteira").classe, "livre");
  assert.match(textoFonte(fonte(r, "militar"), r.encostaM), /^não consultado: /);
  const resumo = resumoRestricoes(r);
  assert.equal(resumo.naoConsultadas.length, 4);
  assert.match(resumo.texto, /4 base\(s\) não consultada\(s\)/);
  assert.equal(resumo.texto, "Nenhuma restrição encontrada nas bases consultadas; 4 base(s) não consultada(s).", "sem todas as bases, o resumo diz quais faltaram");
  assert.deepEqual(previaRestricoes(r).find((p) => p.tipo === "ti"), { tipo: "ti", rotulo: "Terras Indígenas", cor: FONTES[0].cor, tem: null });
});

test("cópia do PAMGIA quando a FUNAI cai: o resultado diz qual servidor respondeu", async () => {
  const mLon = 1 / (111320 * Math.cos(16.9 * Math.PI / 180)), mLat = 1 / 110574;
  const O = [-39.35, -16.9];
  const q = (x0, y0, x1, y1) => [[O[0] + x0 * mLon, O[1] + y0 * mLat], [O[0] + x1 * mLon, O[1] + y0 * mLat], [O[0] + x1 * mLon, O[1] + y1 * mLat], [O[0] + x0 * mLon, O[1] + y1 * mLat], [O[0] + x0 * mLon, O[1] + y0 * mLat]];
  const f = async (url) => {
    const u = String(url);
    if (u.includes("funai")) throw new TypeError("Failed to fetch");
    if (u.includes("lim_terra_indigena_a")) {
      return new Response(JSON.stringify({ type: "FeatureCollection", features: [{ properties: { terrai_cod: 1, terrai_nom: "Teste", fase_ti: "Declarada", data_atual: "14/11/2017" }, geometry: { type: "Polygon", coordinates: [q(-1000, -1000, 100, 1000)] } }] }));
    }
    return new Response(JSON.stringify({ type: "FeatureCollection", features: [] }));
  };
  const imovel = q(0, 0, 200, 100).slice(0, 4); // 200 × 100 m; 100 × 100 m dentro da TI
  const r = await consultarRestricoes([imovel], { fuso: 24, fetch: f, tipos: ["ti"], agora: AGORA });
  const ti = r.fontes[0];
  assert.equal(ti.classe, "sobrepoe");
  assert.equal(ti.servidor, "IBAMA/PAMGIA — cópia da base da FUNAI");
  assert.match(ti.motivo, /servidor principal indisponível/);
  assert.ok(Math.abs(ti.itens[0].pct - 50) < 0.5, `${ti.itens[0].pct}%`);
  assert.equal(ti.atualizacao, "2017-11-14");
});

test("encosta até X m, ponto de sítio arqueológico e área partida em pedaços", async () => {
  const mLon = 1 / (111320 * Math.cos(12 * Math.PI / 180)), mLat = 1 / 110574;
  const O = [-39.0, -12.0];
  const P = (x, y) => [O[0] + x * mLon, O[1] + y * mLat];
  const q = (x0, y0, x1, y1) => [P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0)];
  const fc = (features) => new Response(JSON.stringify({ type: "FeatureCollection", features }));
  const f = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes("lim_assentamentos_incra_a")) {
      // assentamento a 120 m do imóvel (lado leste do imóvel em x = 200)
      return fc([{ properties: { cd_sipra: "BA1", nome_proje: "PA Vizinho" }, geometry: { type: "Polygon", coordinates: [q(320, 0, 900, 100)] } }]);
    }
    if (u.includes("lim_quilombos_incra_a")) {
      // o mesmo território em dois pedaços, cada um com 50 × 100 m dentro do imóvel
      return fc([
        { properties: { cd_quilomb: 7, nm_comunid: "Dois Pedaços" }, geometry: { type: "Polygon", coordinates: [q(-100, 0, 50, 100)] } },
        { properties: { cd_quilomb: 7, nm_comunid: "Dois Pedaços" }, geometry: { type: "Polygon", coordinates: [q(150, 0, 300, 100)] } },
      ]);
    }
    if (u.includes("loc_sitios_arqueologicos_iphan_p")) {
      return fc([
        { properties: { co_iphan: "BA-1", identifica: "Sítio de dentro" }, geometry: { type: "Point", coordinates: P(100, 50) } },
        { properties: { co_iphan: "BA-2", identifica: "Sítio perto" }, geometry: { type: "Point", coordinates: P(100, 300) } },
        { properties: { co_iphan: "BA-3", identifica: "Sítio longe" }, geometry: { type: "Point", coordinates: P(100, 900) } },
      ]);
    }
    if (u.includes("returnCountOnly")) return new Response(JSON.stringify({ count: 0 }));
    return fc([]);
  };
  const imovel = q(0, 0, 200, 100).slice(0, 4);
  const r = await consultarRestricoes([imovel], { fuso: 24, fetch: f, agora: AGORA, encostaM: 300 });
  const pa = fonte(r, "assentamento");
  assert.equal(pa.classe, "encosta");
  assert.ok(Math.abs(pa.itens[0].distanciaM - 120) < 1, `${pa.itens[0].distanciaM} m`);
  assert.match(textoItem(pa.itens[0]), /^a 120 m do perímetro, sem sobreposição$/);
  const qui = fonte(r, "quilombola");
  assert.equal(qui.itens.length, 1, "os dois pedaços viram uma área só");
  assert.ok(Math.abs(qui.itens[0].pct - 50) < 0.5, `${qui.itens[0].pct}%`);
  const arq = fonte(r, "arqueologico");
  assert.equal(arq.classe, "sobrepoe");
  assert.deepEqual(arq.itens.map((i) => [i.nome, i.classe]), [["Sítio de dentro", "sobrepoe"], ["Sítio perto", "encosta"]]);
  assert.equal(textoItem(arq.itens[0]), "ponto cadastrado dentro do imóvel");
  assert.equal(textoFonte(arq, r.encostaM), "1 registro dentro do imóvel");
  // com encosta de 100 m o assentamento a 120 m some
  const r2 = await consultarRestricoes([imovel], { fuso: 24, fetch: f, agora: AGORA, encostaM: 100, tipos: ["assentamento"] });
  assert.equal(r2.fontes[0].classe, "livre");
});

test("faixa de fronteira: imóvel dentro sem baixar o polígono do país", async () => {
  const pedidos = [];
  const f = async (url) => {
    const u = new URL(String(url));
    pedidos.push(u.searchParams.get("spatialRel"));
    if (u.pathname.includes("lim_faixa_fronteira_ibge_a")) {
      assert.equal(u.searchParams.get("returnCountOnly"), "true", "só contagem");
      return new Response(JSON.stringify({ count: 1 }));
    }
    return new Response(JSON.stringify({ type: "FeatureCollection", features: [] }));
  };
  const imovel = [[-57.61, -19.01], [-57.6, -19.01], [-57.6, -19.0], [-57.61, -19.0]];
  const r = await consultarRestricoes([imovel], { fuso: 21, fetch: f, tipos: ["fronteira"], agora: AGORA });
  assert.equal(r.fontes[0].classe, "sobrepoe");
  assert.equal(r.fontes[0].itens[0].pct, 100);
  assert.deepEqual(pedidos, ["esriSpatialRelIntersects", "esriSpatialRelWithin"]);
});

test("sem perímetro não consulta nada; o aviso diz que não substitui certidão", async () => {
  let n = 0;
  const r = await consultarRestricoes([[]], { fetch: async () => { n++; return new Response("{}"); } });
  assert.equal(n, 0);
  assert.equal(r.fontes.length, 0);
  assert.match(AVISO_RESTRICOES, /não substitui certidão/);
});

test("PDF: croqui, tabela por base, data da consulta, fontes fora e o aviso", async () => {
  const { gerarPdfRestricoes, nomeArquivoRestricoes } = await import("../src/lib/restricoes_pdf.ts");
  const { PDFDocument } = await import("pdf-lib");
  const fx = fixture("monte_pascoal");
  const { f } = gravado(fx, { falhar: { "lim_uso_militar_a": 500 } });
  const r = await consultarRestricoes([fx.anel], { fuso: fx.fuso, fetch: f, agora: AGORA });
  const bytes = await gerarPdfRestricoes(r, [fx.anel], { imovel: "Fazenda Teste", municipio: "Porto Seguro", uf: "BA" });
  assert.ok(bytes.length > 3000);
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getTitle(), "Análise de restrições do imóvel");
  if (process.env.RESTRICOES_PDF) fs.writeFileSync(process.env.RESTRICOES_PDF, bytes);
  assert.equal(nomeArquivoRestricoes(r, "Fazenda São João"), "analise-restricoes-Fazenda_Sao_Joao-2026-11-05.pdf");
});

test("AO VIVO: as bases públicas de verdade (Monte Pascoal)", { skip: !process.env.RESTRICOES_AO_VIVO && "só com RESTRICOES_AO_VIVO=1", timeout: 120_000 }, async () => {
  const fx = fixture("monte_pascoal");
  const r = await consultarRestricoes([fx.anel], { fuso: 24 });
  const fora = r.fontes.filter((x) => x.classe === "nao_consultado").map((x) => `${x.tipo}: ${x.motivo}`);
  console.log(resumoRestricoes(r).texto, fora.length ? `\nnão consultadas: ${fora.join(" | ")}` : "");
  assert.equal(fonte(r, "ti").classe, "sobrepoe");
  assert.equal(fonte(r, "uc").classe, "sobrepoe");
});
