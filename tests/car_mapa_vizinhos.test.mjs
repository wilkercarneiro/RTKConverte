// CAR: os vizinhos no mapa (13/11/2026). O Wilker não via os terrenos dos lados:
// estavam em cinza fino, sem nome, e o filtro "algum vértice perto" escondia o
// vizinho grande de divisa colada. Aqui: todos os vizinhos perto aparecem, com
// estado (invade / ajustado / encosta) e nome posto perto do imóvel.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lerKml } from "../src/lib/car/kml.ts";
import { planoDe } from "../src/lib/car/motor.ts";
import { ajustarSobreposicao } from "../src/lib/car/sobreposicao.ts";
import { nomeCurtoVizinho, vizinhosNoMapa } from "../src/lib/car/mapaVizinhos.ts";

const dir = new URL("./fixtures/car/", import.meta.url);
const kml = lerKml(fs.readFileSync(new URL("PLANTA.kml", dir), "utf8"));
const vizinhos = JSON.parse(fs.readFileSync(new URL("sicar_vizinhos_planta.json", dir), "utf8"));
const PROPRIO = "BA-2908408-F6EEB7AE67DA44FB8C9DFD0B8FA0E7CB";
const INVADIDOS = ["BA-2908408-FD770354245847D39D33F40DCEE28BBA", "BA-2908408-C7BEDDDED3E7499D95B32DC48E2E8D09"];

test("antes do ajuste: os 13 vizinhos aparecem (o próprio não), os 2 invadidos em 'invade', todos com nome", () => {
  const pl = planoDe(kml.perimetro);
  const a = ajustarSobreposicao(kml.perimetro, vizinhos);
  const m = vizinhosNoMapa(kml.perimetro.map(pl.para), vizinhos, pl.para, a.itens, []);
  assert.equal(m.length, vizinhos.length - 1, "inclusive o vizinho grande que o filtro por vértice escondia (…4363DB)");
  assert.ok(!m.some((v) => v.chave === `car:${PROPRIO}`));
  assert.deepEqual(m.filter((v) => v.estado === "invade").map((v) => v.chave.slice(4)).sort(), [...INVADIDOS].sort());
  assert.ok(m.every((v) => v.rotulo), "todo vizinho perto tem onde pôr o nome");
  assert.equal(m.at(-1).estado, "invade", "os importantes desenham por cima");
});

test("depois do ajuste: os 2 cortados ficam 'ajustado' (não somem no meio dos outros)", () => {
  const a0 = ajustarSobreposicao(kml.perimetro, vizinhos);
  const novo = a0.perimetro;
  const pl = planoDe(novo);
  const a = ajustarSobreposicao(novo, vizinhos);
  const cortes = a0.itens.filter((i) => i.decisao === "cortado").map((i) => ({ fonte: i.fonte, codigo: i.codigo }));
  const m = vizinhosNoMapa(novo.map(pl.para), vizinhos, pl.para, a.itens, cortes);
  assert.deepEqual(m.filter((v) => v.estado === "ajustado").map((v) => v.chave.slice(4)).sort(), [...INVADIDOS].sort());
  assert.ok(!m.some((v) => v.estado === "invade"));
});

test("vizinho longe (fora dos 300 m) não entra; nome curto do CAR e do SIGEF", () => {
  const pl = planoDe(kml.perimetro);
  const [x, y] = kml.perimetro[0];
  const longe = { fonte: "car", codigo: "BA-1-LONGE", rotulo: "CAR BA-1-LONGE", poligonos: [[[[x + 0.05, y], [x + 0.06, y], [x + 0.06, y + 0.01]]]] };
  assert.equal(vizinhosNoMapa(kml.perimetro.map(pl.para), [longe], pl.para, [], []).length, 0);
  assert.equal(nomeCurtoVizinho({ fonte: "car", codigo: INVADIDOS[0], rotulo: "" }), "CAR FD77…8BBA");
  assert.equal(nomeCurtoVizinho({ fonte: "sigef", codigo: "x", rotulo: "SIGEF Fazenda Boa Vista" }), "SIGEF Fazenda Boa Vista");
});
