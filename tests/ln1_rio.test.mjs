// LN1 = curso d'água: linha dupla AZUL na planta, no lugar da vermelha.
//
// Espelho exato do lacre de LA3 (salgada_velha_la3.test.mjs). Lá a regra é
// "todo trecho LA3 é faixa de domínio, tenha o rótulo que tiver, e sai em
// vermelho"; aqui é "todo trecho LN1 é curso d'água, tenha o rótulo que tiver,
// e sai em azul". Quem esquece o fallback num dos dois caminhos — fluxo 'geo'
// (montarServico) ou reconciliação com o PDF do SIGEF — entrega planta com rio
// desenhado como estrada, que é o erro que estes testes existem para pegar.
//
// A regra de desempate também é lacrada: rio VENCE estrada. Um trecho LN1 nunca
// sai vermelho, nem com o checkbox de faixa de domínio marcado, nem com rótulo
// que o texto reconheceria como via ("RIO ..." casa com RE_VIA). As duas duplas
// na mesma divisa diriam que ali há uma estrada E um rio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import proj4lib from "proj4";
import { PDFDocument } from "pdf-lib";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { montarTrechosDoSigef } from "../supabase/functions/_shared/reconciliacao.ts";
import { segmentosDeRio, segmentosDeVia } from "../src/lib/trechos.ts";
import { ANEL, dadosPlantaDe } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);

// Mesmo anel do lacre de não-regressão, com as confrontações trocadas: o M que
// abria a ESTRADA VICINAL (LA3) passa a abrir o RIO ITAPICURU (LN1); a LINHA
// FERREA (LA3) fica como está, para que a planta tenha as DUAS faixas e o teste
// consiga separar uma cor da outra.
const CONF = {
  "DSBN-M-4542": { descritivo: "RIO ITAPICURU", tipoLimite: "LN1" },
  "DSBN-P-14312": { descritivo: "LINHA FERREA", tipoLimite: "LA3" },
};

function entradaComRio({ ehVia = false } = {}) {
  return {
    fusoUtm: 24,
    prefixo: "DSBN",
    contadores: { M: 0, P: 0, V: 0 },
    vertices: ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
      ordem, numTxt: ordem + 1, e, n, h: 360, sigmaPos: 0.01, sigmaH: 0.01,
      tipo, metodo: "PG6", codigoManual: codigo, inserido: false,
      descritivo: CONF[codigo]?.descritivo ?? descritivo,
      tipoLimite: CONF[codigo]?.tipoLimite ?? tipoLimite,
      // o checkbox de faixa de domínio, para exercitar o desempate
      ehVia: ehVia && CONF[codigo]?.tipoLimite === "LN1",
    })),
  };
}

const trechoDe = (calc, rotulo) => calc.trechosOrdenados.find((t) => t.descritivo === rotulo);

test("fluxo 'geo': LN1 sem checkbox já é curso d'água", () => {
  const calc = montarServico(entradaComRio(), proj4);
  const rio = trechoDe(calc, "RIO ITAPICURU");
  assert.ok(rio, "o trecho do rio tem de existir no anel");
  assert.equal(rio.ehRio, true, "LN1 vale como rio sozinho, como LA3 vale como via");
  assert.equal(trechoDe(calc, "LINHA FERREA").ehRio, false, "LA3 não é rio");
});

test("fluxo 'geo': o rio sai azul e a estrada vermelha, cada uma na sua divisa", () => {
  const g = geometriaDoCalculo(montarServico(entradaComRio(), proj4));
  const rio = g.trechos.find((t) => t.descritivo === "RIO ITAPICURU");
  const ferrea = g.trechos.find((t) => t.descritivo === "LINHA FERREA");
  assert.equal(rio.isRio, true);
  assert.equal(rio.isEstrada, false, "rio vence estrada: a dupla vermelha não é desenhada");
  assert.equal(ferrea.isRio, false);
  assert.equal(ferrea.isEstrada, true, "a faixa de domínio LA3 continua saindo em vermelho");
});

test("rio vence estrada mesmo com 'faixa de domínio pública' marcada", () => {
  // "RIO ITAPICURU" casa com RE_VIA pelo texto E está com o checkbox ligado:
  // é o caso em que as duas duplas sairiam sobrepostas na mesma divisa.
  const calc = montarServico(entradaComRio({ ehVia: true }), proj4);
  const rio = trechoDe(calc, "RIO ITAPICURU");
  assert.equal(rio.ehVia, true, "continua sendo faixa de domínio p/ memorial e declarações");
  assert.equal(rio.ehRio, true);
  const t = geometriaDoCalculo(calc).trechos.find((x) => x.descritivo === "RIO ITAPICURU");
  assert.equal(t.isEstrada, false, "no DESENHO só sai a dupla azul");
  assert.equal(t.isRio, true);
});

test("reconciliação com o PDF do SIGEF: LN1 continua sendo rio", () => {
  // fluxo 'pecas': a confrontação vem de trechos_confrontantes, ancorada pelo
  // código do SIGEF. Sem o fallback aqui, a planta oficial sairia sem o azul.
  const sigefLinhas = ANEL.map(([, , , , codigo]) => ({ codigo, confrontacao: "" }));
  const trechos = montarTrechosDoSigef(
    [
      { codigo_inicio: "DSBN-M-4542", vertice_inicio_ordem: 3, descritivo: "RIO ITAPICURU", tipo_limite: "LN1", eh_via: false },
      { codigo_inicio: "DSBN-P-14312", vertice_inicio_ordem: 14, descritivo: "LINHA FERREA", tipo_limite: "LA3", eh_via: false },
    ],
    [], sigefLinhas,
  );
  const rio = trechos.find((t) => t.descritivo === "RIO ITAPICURU");
  assert.equal(rio.ehRio, true, "LN1 é rio também no caminho do SIGEF");
  assert.equal(trechos.find((t) => t.descritivo === "LINHA FERREA").ehRio, false);
});

test("prévia da tela separa os segmentos de rio dos de via", () => {
  // src/lib/trechos.ts é a cópia que o preview usa; se ela discordar do motor,
  // o operador vê azul na tela e vermelho no PDF (ou o contrário).
  const vertices = [0, 1, 2, 3, 4, 5].map((ordem) => ({ ordem }));
  const trechos = [
    { vertice_inicio_ordem: 0, eh_via: false, tipo_limite: "LA1" },
    { vertice_inicio_ordem: 2, eh_via: true, tipo_limite: "LA3" },
    { vertice_inicio_ordem: 4, eh_via: true, tipo_limite: "LN1" },
  ];
  assert.deepEqual(segmentosDeVia(vertices, trechos), [2, 3], "só a LA3 é dupla vermelha");
  assert.deepEqual(segmentosDeRio(vertices, trechos), [4, 5], "a LN1 é dupla azul");
});

// operadores de cor de traço do content stream: "r g b RG"
async function coresDeTraco(bytes) {
  const pg = (await PDFDocument.load(bytes)).getPage(0);
  const doc = pg.doc;
  const out = new Set();
  for (const ref of pg.node.normalizedEntries().Contents.asArray()) {
    const bruto = Buffer.from(doc.context.lookup(ref).getContents());
    let txt;
    try { txt = inflateSync(bruto).toString("latin1"); } catch { txt = bruto.toString("latin1"); }
    for (const m of txt.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) RG/g)) {
      out.add(m.slice(1, 4).map(Number).join(","));
    }
  }
  return out;
}

test("planta: o PDF sai com o traço azul do rio e a legenda o explica", async () => {
  const g = geometriaDoCalculo(montarServico(entradaComRio(), proj4));
  const cores = await coresDeTraco(await gerarPlantaPdf(dadosPlantaDe(g)));
  assert.ok(cores.has("0.05,0.6,0.9"), `AZUL_RIO ausente do desenho; cores: ${[...cores]}`);
  assert.ok(cores.has("0.85,0.05,0.05"), "a LA3 continua vermelha na mesma planta");
});

test("planta sem rio nenhum não ganha traço azul de rio nem linha na legenda", async () => {
  // O lacre no outro sentido: quem não tem LN1 entrega a planta de sempre.
  // A legenda cresce uma linha SÓ quando há rio — listar um traço que não está
  // na folha é pior que não listar.
  const semRio = {
    ...entradaComRio(),
    vertices: entradaComRio().vertices.map((v) => (
      v.tipoLimite === "LN1" ? { ...v, descritivo: "ESTRADA VICINAL", tipoLimite: "LA3" } : v
    )),
  };
  const g = geometriaDoCalculo(montarServico(semRio, proj4));
  assert.equal(g.trechos.some((t) => t.isRio), false);
  const cores = await coresDeTraco(await gerarPlantaPdf(dadosPlantaDe(g)));
  assert.equal(cores.has("0.05,0.6,0.9"), false, "sem LN1, nenhum traço AZUL_RIO na folha");
});
