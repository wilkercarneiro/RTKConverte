// A área levada de uma ferramenta para o CAR novo (src/lib/car/area_levada.ts).
//
// Princípio 4 do plano: o MESMO polígono mostra o MESMO número em todas as
// telas. O que se prova aqui:
//  • a medição do Campo chega ao CarNovo com a área que o Campo mostrou;
//  • o CAR de Lençóis (várias partes) chega com a área da maior parte no motor
//    único, e a tela diz quanto ficou de fora (de 743,85 ha);
//  • o número do motor do CAR (projeção de área igual) aparece com o rótulo.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { medir as medirCampo, textoHa } from "../src/lib/campo/geometria.ts";
import { novaMedicao } from "../src/lib/campo/aparelho.ts";
import { areaDaMedicao } from "../src/lib/campo/ponte.ts";
import { CANTOS_EXEMPLO } from "../src/lib/campo/trajeto_exemplo.ts";
import { carNoPonto } from "../src/lib/consulta/car.ts";
import { fmtHa, maiorAnel, medir } from "../src/lib/consulta/geometria.ts";
import { calcularCar, projetoNovo } from "../src/lib/car/motor.ts";
import { textosDaAreaLevada } from "../src/lib/car/area_levada.ts";
import { imovelDaAreaRecebida, origemParaOCar } from "../src/lib/consulta/levada.ts";

const vert = ([lon, lat], i) => ({ lon, lat, precisao: 3, t: i, modo: "ponto" });

test("Campo → CAR: o CarNovo mostra a área que o Campo mostrou", () => {
  const m = { ...novaMedicao(new Date(2026, 10, 6, 14, 32)), nome: "Pasto da sede", fechada: true, vertices: CANTOS_EXEMPLO.map(vert) };
  const a = areaDaMedicao(m);
  const noCampo = medirCampo(m.vertices).areaM2;
  assert.equal(a.areaOrigemM2, noCampo);
  const car = calcularCar(projetoNovo(a.nome, a.perimetro, [], a.nomes)).area.imovel;
  const t = textosDaAreaLevada(a.perimetro, car, a);
  assert.ok(Math.abs(t.areaM2 - noCampo) < 1e-6, `CarNovo ${t.areaM2} × Campo ${noCampo}`);
  // o texto da cabeça é o mesmo (4 casas em ha, como o Campo)
  assert.equal(fmtHa(t.areaM2).replace(/\s*ha$/, ""), textoHa(noCampo).replace(/\s*ha.*$/, ""));
  assert.equal(t.linhaPartes, null, "uma parte só: nada ficou de fora");
  if (Math.abs(car - noCampo) >= 0.5) assert.match(t.linhaCar, /^No módulo do CAR \(projeção de área igual\): /);
});

test("Consulta (CAR de Lençóis) → CAR: a cabeça é a da Consulta e a do módulo do CAR vem rotulada", async () => {
  const FX = JSON.parse(fs.readFileSync(new URL("./fixtures/consulta/lencois.json", import.meta.url), "utf8"));
  const replay = async (u) => { const r = FX.respostas[String(u)]; return r ? new Response(r.corpo, { status: r.status }) : new Response("{}", { status: 404 }); };
  const [im] = await carNoPonto(-41.2, -12.4, "BA", { fetch: replay });
  const total = medir(im.aneis).areaM2;
  assert.ok(Math.abs(total / 1e4 - 743.8531) < 0.01);
  const anel = maiorAnel(im.aneis);
  const car = calcularCar(projetoNovo("Imóvel", anel, [])).area.imovel;
  const t = textosDaAreaLevada(anel, car, { areaOrigemM2: total, partes: im.aneis.length });
  assert.ok(Math.abs(t.areaM2 - medir([anel]).areaM2) < 1e-6, "a cabeça é a do motor único");
  assert.equal(im.aneis.length, 1, "o CAR de Lençóis é uma parte só");
  assert.equal(t.linhaPartes, null);
  // a cabeça do CarNovo é a mesma da Consulta e da declarada no SICAR (743,8531)
  assert.equal(fmtHa(t.areaM2), "743,8531 ha");
  // e o número do módulo do CAR vem rotulado (a diferença é só a projeção)
  assert.match(t.linhaCar, /^No módulo do CAR \(projeção de área igual\): 743,4215 ha, [\d.]+ m² a menos só pela projeção\./);
});

test("área de várias partes → CAR: diz quanto ficou de fora", () => {
  const q = (lon, lat, d) => [[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d]];
  const grande = q(-41.2, -12.4, 0.01), pequena = q(-41.15, -12.4, 0.002);
  const total = medir([grande, pequena]).areaM2;
  const t = textosDaAreaLevada(grande, calcularCar(projetoNovo("I", grande, [])).area.imovel, { areaOrigemM2: total, partes: 2 });
  assert.match(t.linhaPartes, /^Levada a maior parte: 120,\d\d ha de 125,\d\d ha\. O CAR é um polígono só; a outra parte \([\d,]+ ha\) ficou de fora\.$/);
});

test("Campo → Consulta → CAR → Voltar → CAR (duas vezes): a frase é a do caminho direto e nada se acumula", () => {
  const agora = new Date(2026, 10, 6, 15, 0);
  const m = { ...novaMedicao(new Date(2026, 10, 6, 14, 32)), nome: "Pasto da sede", fechada: true, vertices: CANTOS_EXEMPLO.map(vert) };
  const direto = areaDaMedicao(m, agora);
  assert.match(direto.frase, /^Área medida no campo hoje às 14:32 \(GPS do celular, ±3(,0)? m\)$/);
  // Campo → Consulta
  let vinda = direto;
  for (let volta = 0; volta < 3; volta++) {
    const im = imovelDaAreaRecebida(vinda, "vinda:t");
    assert.equal(im.fonte, "campo");
    assert.equal(im.situacao, direto.origem, `volta ${volta}: a linha do cartão não acumula sufixo`);
    // Consulta → CAR: a mesma origem e a mesma frase do caminho direto
    const paraCar = { ...vinda, ...origemParaOCar(im), volta: { rotulo: "a Consulta", hash: "#/consulta", reenviar: true } };
    assert.equal(paraCar.origem, direto.origem);
    assert.equal(paraCar.frase, direto.frase);
    assert.doesNotMatch(paraCar.origem, /consultada no Vertces/);
    // CAR → "← Voltar para a Consulta" (reenviar): manda a mesma área de volta
    vinda = { ...paraCar, volta: undefined };
  }
});

test("a Consulta repassa ao CAR a origem do CAR/SIGEF/arquivo como antes", () => {
  const base = { id: "x", titulo: "Gleba", aneis: [], poligonos: [], furos: 0, areaDeclaradaHa: null, municipio: null, uf: null, atualizacao: null, detalhes: [] };
  assert.deepEqual(origemParaOCar({ ...base, fonte: "car", codigo: "BA-1", situacao: "Ativo" }), { origem: "CAR BA-1 (declarado no SICAR, ativo)" });
  assert.deepEqual(origemParaOCar({ ...base, fonte: "sigef", codigo: "abc", situacao: null }), { origem: "parcela certificada abc (SIGEF)" });
  assert.deepEqual(origemParaOCar({ ...base, fonte: "desenho", codigo: null, situacao: null }), { origem: "Gleba (Consultar imóvel)" });
});
