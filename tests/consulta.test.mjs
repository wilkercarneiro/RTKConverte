// Consultar imóvel (#/consulta): as partes puras, contra as respostas REAIS
// gravadas em Lençóis/BA (tests/fixtures/consulta/lencois.json, gravar.mjs) —
// sem internet. O que se lacra:
//   - a caixa única entende CAR, SIGEF, decimal, GMS, UTM e link do Google Maps,
//     e explica o que não dá (link curto, SNCR);
//   - CAR é "declarado" com a situação; a área sai no motor único (igual à da
//     análise de restrições, inclusive em área que cruza dois fusos);
//   - a frase do topo: sobreposição em vermelho, CAR de assentamento sobre o
//     próprio PA vira identificação, fonte fora do ar nunca vira "livre";
//   - focos dentro × até 1 km; clima, solo (nome brasileiro) e bioma;
//   - a ponte do INPE só monta URL para o host da lista; caixa grande recusada;
//   - o laudo só leva os dados coletados, com a fonte; o PDF sai com as seções.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { interpretarEntrada, normalizarCodigoCar } from "../src/lib/consulta/entrada.ts";
import { carNoPonto, carNaCaixa, carSobreAArea, imovelDoCar, ufsCandidatas } from "../src/lib/consulta/car.ts";
import { consultarClima, consultarSolo, consultarBioma, consultarMunicipio, lerClima, lerSolo, reservaLegalDe } from "../src/lib/consulta/ambiente.ts";
import { classificarFocos, pedidoFocos, textoFocos } from "../src/lib/consulta/focos.ts";
import { areaDoArquivo } from "../src/lib/consulta/arquivo.ts";
import { autointersecta, caixaComMargem, centroDe, medir, textoCruzamento } from "../src/lib/consulta/geometria.ts";
import { analiseVazia, compactarAnalise, dadosParaLaudo, fraseDaAnalise, resultadoParaGravar } from "../src/lib/consulta/analise.ts";
import { dadosDoPdf, resumoEmTexto, restricoesVazias } from "../src/lib/consulta/relatorio.ts";
import { sigefDaArea } from "../src/lib/consulta/sigef_imovel.ts";
import { consultarRestricoes } from "../src/lib/restricoes.ts";
import { gerarPdfRestricoes } from "../src/lib/restricoes_pdf.ts";
import { FOCOS_POR_PAGINA, HOSTS_PONTE, PAGINAS_FOCOS, buscarFocos, camadasFocos, dadosDoLaudo, lerFocos, limparLaudo, montarPedidoLaudo, paginaCheia, urlFocos, validarCaixa, validarDesde, escreverLaudo } from "../supabase/functions/analise-imovel/logica.ts";

const FX = JSON.parse(fs.readFileSync(new URL("./fixtures/consulta/lencois.json", import.meta.url), "utf8"));
const AGORA = new Date(FX.agora);
const pedidos = [];
const replay = async (u) => { pedidos.push(String(u)); const r = FX.respostas[String(u)]; return r ? new Response(r.corpo, { status: r.status }) : new Response("{}", { status: 404 }); };
const COD = "BA-2919306-4185CFD257C54A4788F5C145A504C5C8";

// ---------------------------------------------------------------- caixa única
test("entrada: código do CAR, com e sem os pontos do recibo", () => {
  assert.deepEqual(interpretarEntrada(COD).tipo, "car");
  const e = interpretarEntrada("ba-2919306-4185.CFD2.57C5.4A47.88F5.C145.A504.C5C8");
  assert.equal(e.tipo, "car"); assert.equal(e.codigo, COD); assert.equal(e.uf, "BA");
  assert.equal(normalizarCodigoCar("BA-3519306-4185CFD257C54A4788F5C145A504C5C8"), null, "município de SP com UF BA");
  assert.equal(interpretarEntrada("BA-2919306-4185CF").tipo, "invalida");
});

test("entrada: decimal, GMS e UTM caem no mesmo ponto", () => {
  for (const t of ["-12.40, -41.20", "-12,40 -41,20", "-12,40, -41,20", "12.4 S 41.2 W", "12°24'00\"S 41°12'00\"W", "S 12°24' W 41°12'", "-12 24 00 -41 12 00", "12°24'S e 41°12'O", "-41.2 -12.4",
    // hemisfério antes do número (a letra do 2º não vira sufixo do 1º) e a altitude do GPS no fim
    "S12.4 W41.2", "S 12.4, W 41.2", "-12.4 -41.2 alt 500", "-12,4; -41,2; altitude: 512,3 m"]) {
    const e = interpretarEntrada(t);
    assert.equal(e.tipo, "coordenada", t);
    assert.ok(Math.abs(e.lat + 12.4) < 1e-9 && Math.abs(e.lon + 41.2) < 1e-9, `${t} → ${e.lat},${e.lon}`);
  }
  const u = interpretarEntrada("24L 260000 8628000");
  assert.equal(u.tipo, "coordenada"); assert.ok(Math.abs(u.lat + 12.402) < 1e-3 && Math.abs(u.lon + 41.2075) < 1e-3);
  assert.equal(interpretarEntrada("E 260000 N 8628000 fuso 24").tipo, "coordenada");
  assert.equal(interpretarEntrada("260000.50 8628000.25").tipo, "utm_sem_fuso", "sem fuso pergunta, não chuta");
  // E e N sem fuso, como vêm da planilha de campo: 13 dígitos sem os espaços, mas NÃO é SNCR
  const sf = interpretarEntrada("260000 8628000");
  assert.equal(sf.tipo, "utm_sem_fuso", JSON.stringify(sf));
  assert.equal(sf.e, 260000); assert.equal(sf.n, 8628000);
  // formato brasileiro: ponto de milhar e vírgula decimal
  const br = interpretarEntrada("260.000,00 8.628.000,00 24S");
  assert.equal(br.tipo, "coordenada", JSON.stringify(br));
  assert.ok(Math.abs(br.lat - u.lat) < 1e-9 && Math.abs(br.lon - u.lon) < 1e-9);
  assert.equal(interpretarEntrada("E 260.000,50 N 8.628.000,25").tipo, "utm_sem_fuso");
  assert.match(interpretarEntrada("E 260000 N 8628000 fuso 18").aviso ?? "", /fora do Brasil/, "fuso errado joga para fora do país");
});

test("entrada: Google Maps (marcador vale mais que a vista), link curto e SNCR explicados", () => {
  const e = interpretarEntrada("https://www.google.com/maps/place/X/@-12.5630,-41.3900,13z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-12.5630556!4d-41.3902778");
  assert.equal(e.tipo, "coordenada"); assert.ok(Math.abs(e.lat + 12.5630556) < 1e-9);
  assert.equal(interpretarEntrada("https://www.google.com/maps?q=-12.4,-41.2").lon, -41.2);
  assert.match(interpretarEntrada("https://maps.app.goo.gl/abc123").motivo, /Link curto/);
  assert.match(interpretarEntrada("123.456.789.012-3").motivo, /SNCR/);
  assert.match(interpretarEntrada("1234567890123").motivo, /SNCR/);
  assert.equal(interpretarEntrada("a1b2c3d4-0000-4000-8000-1234567890ab").tipo, "sigef");
  assert.equal(interpretarEntrada("").tipo, "vazio");
});

// ---------------------------------------------------------------- CAR
test("CAR: declarado, com a situação, e a área no motor único", async () => {
  const [im] = await carNoPonto(-41.2, -12.4, "BA", { fetch: replay });
  assert.equal(im.codigo, COD);
  assert.equal(im.fonte, "car");
  assert.match(im.situacao, /Ativo · Aguardando análise/);
  assert.match(im.detalhes.join(" "), /Assentamento/);
  const m = medir(im.aneis);
  assert.equal(m.fuso, 24);
  assert.ok(Math.abs(m.areaM2 / 1e4 - 743.8531) < 0.01, `área ${m.areaM2 / 1e4}`);
  // a mesma área que a análise de restrições usa
  const r = await consultarRestricoes(im.aneis, { fuso: m.fuso, fetch: replay, agora: AGORA });
  assert.ok(Math.abs(r.areaImovelM2 - m.areaM2) < 0.01);
  assert.deepEqual(ufsCandidatas(-41.2, -12.4), ["BA"]);
});

test("CAR: os outros declarados sobre a área (sem contar o próprio)", async () => {
  const [im] = await carNoPonto(-41.2, -12.4, "BA", { fetch: replay });
  const { imoveis } = await carNaCaixa(caixaComMargem(im.aneis, 100), "BA", { fetch: replay });
  const s = carSobreAArea(im.aneis, imoveis, im.codigo);
  assert.ok(!s.some((x) => x.codigo === COD));
  assert.equal(s.filter((x) => x.areaM2 > 0).length, 3);
  assert.ok(Math.abs(s[0].areaM2 / 1e4 - 4.175) < 0.01);
});

test("CAR: feição sem geometria ou sem código não vira imóvel", () => {
  assert.equal(imovelDoCar({ properties: { cod_imovel: COD }, geometry: null }), null);
  assert.equal(imovelDoCar({ properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } }), null);
});

// ---------------------------------------------------------------- área em dois fusos
test("área que cruza dois fusos: a lista, a análise e o fuso batem", async () => {
  // um retângulo sobre o meridiano de -42° (limite 23/24)
  const anel = [[-42.01, -12.4], [-41.97, -12.4], [-41.97, -12.43], [-42.01, -12.43]];
  const m = medir([anel]);
  const r = await consultarRestricoes([anel], { fuso: m.fuso, fetch: async () => new Response("{}", { status: 503 }), agora: AGORA });
  assert.equal(r.fuso, m.fuso);
  assert.ok(Math.abs(r.areaImovelM2 - m.areaM2) < 0.01);
});

// ---------------------------------------------------------------- ambiente
test("ambiente: clima, solo com nome brasileiro, bioma e reserva legal", async () => {
  const [im] = await carNoPonto(-41.2, -12.4, "BA", { fetch: replay });
  const c = centroDe(im.aneis);
  const clima = await consultarClima(c[0], c[1], { fetch: replay, agora: AGORA });
  assert.equal(clima.chuva12mMm, 1028);
  assert.equal(clima.meses.length, 12);
  const solo = await consultarSolo(c[0], c[1], { fetch: replay });
  assert.equal(solo.wrb, "Ferralsols"); assert.equal(solo.nome, "Latossolos");
  assert.throws(() => lerSolo({ wrb_class_name: null }), /sem classe/);
  const b = await consultarBioma(c[0], c[1], { fetch: replay });
  assert.equal(b.bioma, "Caatinga"); assert.equal(b.amazoniaLegal, false); assert.match(b.reservaLegal, /20%/);
  assert.match(reservaLegalDe("Cerrado", true), /35%/);
  assert.match(reservaLegalDe("Amazônia", true), /80%/);
  const mun = await consultarMunicipio(-41.2, -12.4, { fetch: replay });
  assert.equal(mun.nome, "Lençóis"); assert.equal(mun.uf, "BA"); assert.equal(mun.regiaoImediata, "Seabra");
});

// ---------------------------------------------------------------- focos
test("focos: dentro × até 1 km, no motor de área", async () => {
  const [im] = await carNoPonto(-41.2, -12.4, "BA", { fetch: replay });
  const p = pedidoFocos(im.aneis, AGORA);
  assert.equal(p.desde, "2025-11-06");
  const f = classificarFocos(FX.focos, im.aneis, p.desde);
  assert.equal(f.dentro.length, 0); assert.equal(f.perto.length, 1);
  assert.match(textoFocos(f), /Nenhum foco dentro do imóvel · 1 a até 1 km · último em 24\/08\/2026/);
  // um foco no meio do imóvel conta "dentro"
  const meio = centroDe(im.aneis);
  const g = classificarFocos({ todos: [{ lon: meio[0], lat: meio[1], quando: "2026-09-01T12:00:00", satelite: "AQUA_M-T", frp: 1, municipio: null }], referencia: [] }, im.aneis, p.desde);
  assert.equal(g.dentro.length, 1);
});

test("ponte do INPE: só o host da lista, caixa e data validadas", () => {
  assert.deepEqual([...HOSTS_PONTE], ["terrabrasilis.dpi.inpe.br"]);
  const u = new URL(urlFocos("dados_abertos:focos_ano_atual_br_todosats", [-41.3, -12.5, -41.1, -12.3]));
  assert.equal(u.host, "terrabrasilis.dpi.inpe.br");
  assert.equal(u.searchParams.get("bbox"), "-12.5,-41.3,-12.3,-41.1,urn:ogc:def:crs:EPSG::4326");
  assert.throws(() => urlFocos("outra:camada", [-41.3, -12.5, -41.1, -12.3]), /fora da lista/);
  assert.throws(() => validarCaixa([-50, -20, -40, -10]), /grande demais/);
  assert.throws(() => validarCaixa([10, 40, 11, 41]), /Brasil/);
  assert.throws(() => validarCaixa("x"), /inválida/);
  assert.throws(() => validarDesde("2020-01-01", AGORA), /intervalo/);
  assert.deepEqual(camadasFocos("2025-11-06", AGORA), ["dados_abertos:focos_ano_atual_br_todosats", "dados_abertos:focos_2025_br_todosats"]);
  const fs2 = lerFocos({ type: "FeatureCollection", features: [
    { geometry: { type: "Point", coordinates: [-41.2, -12.4] }, properties: { data_hora_gmt: "2026-01-02T10:00:00Z", satelite: "X" } },
    { geometry: { type: "Point", coordinates: [-41.2, -12.4] }, properties: { data_hora_gmt: "2026-01-02T10:00:00Z", satelite: "X" } },
    { geometry: { type: "Point", coordinates: [-41.2, -12.4] }, properties: { data_hora_gmt: "2025-01-02T10:00:00Z", satelite: "X" } },
  ] }, "2025-11-06");
  assert.equal(fs2.length, 1, "repetido e antigo saem");
  assert.throws(() => lerFocos({ erro: 1 }, "2025-11-06"), /inesperada/);
});

// ---------------------------------------------------------------- análise completa
async function analiseDeLencois({ falhar = [] } = {}) {
  const [im] = await carNoPonto(-41.2, -12.4, "BA", { fetch: replay });
  const m = medir(im.aneis);
  const c = centroDe(im.aneis);
  const a = analiseVazia(im, m, AGORA);
  const ok = (dados) => ({ estado: "ok", dados });
  const { imoveis } = await carNaCaixa(caixaComMargem(im.aneis, 100), "BA", { fetch: replay });
  a.restricoes = ok(await consultarRestricoes(im.aneis, { fuso: m.fuso, fetch: replay, agora: AGORA }));
  a.car = ok({ itens: carSobreAArea(im.aneis, imoveis, im.codigo), cortada: false });
  a.sigef = ok({ ...sigefDaArea(im.aneis, [], [], null), online: "ok" });
  a.focos = ok(classificarFocos(FX.focos, im.aneis, "2025-11-06"));
  a.clima = ok(await consultarClima(c[0], c[1], { fetch: replay, agora: AGORA }));
  a.solo = ok(await consultarSolo(c[0], c[1], { fetch: replay }));
  a.bioma = ok(await consultarBioma(c[0], c[1], { fetch: replay }));
  a.municipio = ok(await consultarMunicipio(c[0], c[1], { fetch: replay }));
  for (const k of falhar) a[k] = { estado: "falhou", motivo: "servidor fora do ar ou inacessível" };
  return a;
}

test("frase: o CAR de assentamento sobre o próprio PA é identificação; o outro PA é sobreposição", async () => {
  const a = await analiseDeLencois();
  const f = fraseDaAnalise(a);
  assert.equal(f.tom, "perigo");
  assert.equal(f.texto, "Sobrepõe o assentamento PA PIABAS em 2,07 ha");
  assert.match(f.identificacao[0], /PA NOVO HORIZONTE \(98% da área\)/);
  assert.ok(f.avisos.some((x) => /pequena \(0,28%/.test(x)));
  assert.equal(f.avisos.filter((x) => /outro CAR/.test(x)).length, 3);
  assert.equal(f.pendentes.length, 0);
});

test("frase: fonte fora do ar nunca vira 'nenhuma restrição' verde", async () => {
  const a = await analiseDeLencois({ falhar: ["restricoes"] });
  const f = fraseDaAnalise(a);
  assert.notEqual(f.tom, "ok");
  assert.equal(f.texto, "Nenhuma restrição nas bases que responderam");
  assert.ok(f.pendentes.some((x) => /não responderam/.test(x)));
  const vazia = analiseVazia(a.imovel, a.medidas, AGORA);
  assert.equal(fraseDaAnalise(vazia).texto, "Analisando a área…");
});

test("laudo: só os dados coletados, com a fonte e a natureza de cada uma", async () => {
  const a = await analiseDeLencois({ falhar: ["solo"] });
  // o MESMO caminho da produção: a tela grava resultadoParaGravar(analise) em analises_imovel.resultado
  // (passando pelo JSON do banco), e a função manda à IA só dadosDoLaudo(linha.resultado)
  const gravado = JSON.parse(JSON.stringify(resultadoParaGravar(a)));
  const d = dadosDoLaudo(gravado);
  assert.ok(d, "o resultado gravado leva o para_laudo");
  assert.deepEqual(d, JSON.parse(JSON.stringify(dadosParaLaudo(a))), "o para_laudo é o dadosParaLaudo da análise");
  assert.equal(dadosDoLaudo(compactarAnalise(a)), null, "consulta antiga (sem para_laudo) é recusada, não vai inteira para a IA");
  assert.equal(dadosDoLaudo(null), null);
  const ped0 = montarPedidoLaudo(d);
  assert.ok(!/"sobreposta"|"coordinates"/.test(ped0.entrada), "nenhuma geometria vai para a IA");
  assert.ok(ped0.entrada.length < 12_000, `pedido de ${ped0.entrada.length} caracteres`);
  // toda seção com dado diz a fonte
  for (const k of ["identificacao", "restricoes", "sigef", "car_sobre_a_area", "focos_de_queimada", "clima", "bioma", "municipio"]) {
    assert.ok(/"fonte(_geral)?":"/.test(JSON.stringify(d[k])), `${k} sem fonte`);
  }
  assert.equal(d.identificacao.natureza, "CAR — declarado pelo proprietário");
  assert.equal(d.identificacao.area_calculada_ha, "743,8531");
  assert.deepEqual(d.solo, { situacao: "não respondeu", motivo: "servidor fora do ar ou inacessível" });
  assert.equal(d.leitura_do_sistema.fonte, "Vertces");
  const ped = montarPedidoLaudo(d);
  assert.match(ped.instrucoes, /SOMENTE os dados/);
  assert.match(ped.instrucoes, /DECLARAÇÃO/);
  assert.ok(ped.entrada.includes("743,8531"));
  assert.throws(() => montarPedidoLaudo({ x: "a".repeat(70_000) }), /grandes demais/);
  assert.equal(limparLaudo("## 1. Título\n**negrito**\n\n\n\nfim"), "1. Título\nnegrito\n\nfim");
  // a chamada à IA (simulada): sem markdown, com custo
  let corpo;
  const r = await escreverLaudo({ apiKey: "k", fetch: async (_u, init) => { corpo = JSON.parse(init.body); return new Response(JSON.stringify({ output_text: "1. Identificação\n- " + "x".repeat(100), usage: { input_tokens: 1000, output_tokens: 500 } }), { status: 200 }); } }, d);
  assert.equal(corpo.model, "gpt-6.1-terra");
  assert.match(r.texto, /^1\. Identificação/);
  assert.ok(r.custoUsd > 0);
});

test("histórico: a análise gravada não leva a geometria grande das bases", async () => {
  const a = await analiseDeLencois();
  const c = compactarAnalise(a);
  assert.ok(c.restricoes.dados.fontes.every((f) => f.itens.every((i) => i.geometria === null)));
  assert.deepEqual(c.imovel.aneis, []);
  assert.ok(JSON.stringify(c).length < 400_000, `${JSON.stringify(c).length} bytes`);
});

test("PDF e resumo: saem com as seções, inclusive sem as restrições", async () => {
  const a = await analiseDeLencois();
  const dados = dadosDoPdf(a);
  assert.deepEqual(dados.secoes.map((s) => s.titulo), ["Identificação", "SIGEF — parcelas certificadas", "CAR — outros imóveis declarados sobre a área", "Focos de queimada (INPE)", "Ambiente"]);
  const bytes = await gerarPdfRestricoes(a.restricoes.dados, a.imovel.aneis, { ...dados, laudo: { texto: "1. Identificação\n- teste [SICAR]", modelo: "x", quando: AGORA.toISOString() } });
  assert.ok(bytes.length > 5000);
  const b2 = await gerarPdfRestricoes(restricoesVazias(a), a.imovel.aneis, dados);
  assert.ok(b2.length > 3000);
  const t = resumoEmTexto(a);
  assert.match(t, /\*CAR BA-2919306/);
  assert.match(t, /alerta, não certidão/);
});

test("arquivo: KML, GeoJSON (em grau) e GeoJSON em UTM recusado", () => {
  const kml = `<kml><Document><name>Sitio</name><Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>-41.2,-12.4 -41.19,-12.4 -41.19,-12.41 -41.2,-12.4</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
  const k = areaDoArquivo("sitio.kml", kml);
  assert.equal(k.imovel.aneis[0].length, 3);
  const gj = areaDoArquivo("a.geojson", JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { nome: "Lote 1" }, geometry: { type: "Polygon", coordinates: [[[-41.2, -12.4], [-41.19, -12.4], [-41.19, -12.41], [-41.2, -12.4]], [[-41.199, -12.401], [-41.198, -12.401], [-41.198, -12.402], [-41.199, -12.401]]] } }] }));
  assert.equal(gj.imovel.titulo, "Lote 1");
  assert.equal(gj.imovel.furos, 1);
  assert.throws(() => areaDoArquivo("u.geojson", JSON.stringify({ type: "Polygon", coordinates: [[[260000, 8628000], [261000, 8628000], [261000, 8629000], [260000, 8628000]]] })), /metros/);
  assert.throws(() => areaDoArquivo("x.geojson", "{oops"), /GeoJSON válido/);
  // gravata-borboleta no arquivo: recusada, dizendo onde cruza
  const gravata = JSON.stringify({ type: "Polygon", coordinates: [[[-41.2, -12.4], [-41.19, -12.41], [-41.19, -12.4], [-41.2, -12.41], [-41.2, -12.4]]] });
  assert.throws(() => areaDoArquivo("g.geojson", gravata), /se cruzam — o lado V1–V2 cruza o lado V3–V4/);
});

test("desenho: lados que se cruzam (gravata-borboleta) são detectados; o quadrado não", () => {
  const quadrado = [[-41.2, -12.4], [-41.19, -12.4], [-41.19, -12.41], [-41.2, -12.41]];
  const gravata = [[-41.2, -12.4], [-41.19, -12.41], [-41.19, -12.4], [-41.2, -12.41]];
  assert.equal(autointersecta(quadrado), null);
  assert.deepEqual(autointersecta(gravata), [0, 2]);
  assert.match(textoCruzamento([0, 2], 4), /V1–V2 cruza o lado V3–V4/);
  // a área da gravata não tem sentido (é por isso que não deixa fechar)
  assert.ok(medir([gravata]).areaM2 < medir([quadrado]).areaM2 / 1000, `${medir([gravata]).areaM2} × ${medir([quadrado]).areaM2}`);
  // triângulo, côncavo em "L" e vértice encostado no lado: não é cruzamento
  assert.equal(autointersecta(quadrado.slice(0, 3)), null);
  assert.equal(autointersecta([[-41.2, -12.4], [-41.18, -12.4], [-41.18, -12.405], [-41.19, -12.405], [-41.19, -12.41], [-41.2, -12.41]]), null);
  assert.equal(autointersecta([...quadrado, [-41.2, -12.4]]), null, "anel com o fecho repetido");
  // 5 vértices com o último clique voltando por dentro
  assert.ok(autointersecta([...quadrado, [-41.185, -12.405]]));
});

test("focos: resposta cortada do INPE nunca vira 'nenhum foco' verde", async () => {
  const [im] = await carNoPonto(-41.2, -12.4, "BA", { fetch: replay });
  const f = classificarFocos({ todos: [], referencia: [], cortada: true }, im.aneis, "2025-11-06");
  assert.equal(f.cortada, true);
  assert.match(textoFocos(f), /^Não deu para confirmar se houve foco dentro do imóvel/);
  const a = await analiseDeLencois();
  a.focos = { estado: "ok", dados: f };
  const fr = fraseDaAnalise(a);
  assert.ok(fr.pendentes.some((x) => /focos de queimada \(INPE\) com resposta incompleta/.test(x)));
  assert.match(dadosParaLaudo(a).focos_de_queimada.resposta_incompleta, /não afirmar/);
  // e o CAR cortado em 50, ou uma UF da divisa fora do ar, também vão para os pendentes
  a.car = { estado: "ok", dados: { ...a.car.dados, cortada: true, falhas: ["CAR de MG (SICAR) não respondeu"] } };
  const fc = fraseDaAnalise(a);
  assert.ok(fc.pendentes.some((x) => /CAR com resposta cortada/.test(x)));
  assert.ok(fc.pendentes.includes("CAR de MG (SICAR) não respondeu"));
});

test("ponte do INPE: pagina e marca 'cortada' quando a última página ainda vem cheia", async () => {
  const foco = (i) => ({ type: "Feature", geometry: { type: "Point", coordinates: [-41.2 + i * 1e-4, -12.4] }, properties: { data_hora_gmt: "2026-08-01T10:00:00Z", satelite: "S" } });
  const pagina = (n, total) => JSON.stringify({ type: "FeatureCollection", numberMatched: total, features: Array.from({ length: n }, (_, i) => foco(i)) });
  const urls = [];
  // camada do ano atual com 2.500 focos (2 páginas), as outras vazias
  const f1 = async (u) => {
    urls.push(String(u));
    const q = new URL(String(u)).searchParams;
    if (!/ano_atual/.test(q.get("typeNames"))) return new Response(pagina(0, 0));
    const ini = Number(q.get("startIndex") ?? 0);
    return new Response(ini === 0 ? pagina(FOCOS_POR_PAGINA, 2500) : pagina(500, 2500));
  };
  const r1 = await buscarFocos([-41.3, -12.5, -41.1, -12.3], "2025-11-06", f1, AGORA);
  assert.equal(r1.cortada, false, "2.500 cabem em 2 páginas");
  assert.ok(urls.some((u) => /startIndex=2000/.test(u)));
  // região em queimada: toda página volta cheia → cortada
  const f2 = async (u) => new Response(/ano_atual/.test(new URL(String(u)).searchParams.get("typeNames")) ? pagina(FOCOS_POR_PAGINA, 99_999) : pagina(0, 0));
  const r2 = await buscarFocos([-41.3, -12.5, -41.1, -12.3], "2025-11-06", f2, AGORA);
  assert.equal(r2.cortada, true);
  assert.equal(paginaCheia({ features: [1, 2] }, 2), true, "sem numberMatched, página cheia = pode haver mais");
  assert.equal(paginaCheia({ features: [1], numberMatched: 1 }, 2), false);
  assert.ok(PAGINAS_FOCOS >= 2);
});

test("clima: as barras não mostram o mês cortado da ponta como se fosse seco", async () => {
  const dias = [];
  for (let d = new Date("2025-11-27T00:00:00Z"); d <= new Date("2026-02-03T00:00:00Z"); d = new Date(d.getTime() + 864e5)) dias.push(d.toISOString().slice(0, 10));
  const c = lerClima({ daily: { time: dias, precipitation_sum: dias.map(() => 5), temperature_2m_mean: dias.map(() => 25) } });
  assert.deepEqual(c.meses.map((m) => [m.mes, m.inteiro]), [["2025-11", false], ["2025-12", true], ["2026-01", true], ["2026-02", false]]);
});

test("só os hosts das bases públicas foram chamados", () => {
  const hosts = new Set(pedidos.map((u) => new URL(u).host));
  for (const h of hosts) assert.ok(["geoserver.car.gov.br", "pamgia.ibama.gov.br", "geoserver.funai.gov.br", "geoservicos.inde.gov.br", "geoservicos.ibge.gov.br", "archive-api.open-meteo.com", "rest.isric.org", "servicodados.ibge.gov.br"].includes(h), h);
});
