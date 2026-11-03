// As peças (gerar-pecas) andam o anel na ordem do PDF do SIGEF — horária — e
// liam a confrontação direto da linha de cada M no banco. Com o TXT anti-horário
// a planta inverte e cada M abre o trecho do M anterior (`inverterSentido`); as
// peças não, e cada confrontante saía na divisa do vizinho seguinte (FAZENDA
// TRES LAMEIROS, 03/11/2026: planta certa, peças "anti-horárias").
//
// `origemDaConfrontacaoHoraria` tem de dar, para cada M, a MESMA confrontação
// que `montarServico` (planta, planilha, memorial) põe no trecho que ele abre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import { parseTxt } from "../supabase/functions/_shared/geo.ts";
import { montarServico, origemDaConfrontacaoHoraria } from "../supabase/functions/_shared/servico.ts";

const proj4 = (from, to, coords) => proj4lib(from, to, coords);
const pontos = parseTxt(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8"));
const MS = { 30: "TERRA NOVA", 36: "POSSE LAMEIRO", 41: "MATR LAMEIRO", 58: "PAU D'AGUA", 64: "BA 408", 9: "CORREDOR" };

function linhas(inverter) {
  const base = inverter ? pontos.slice().reverse() : pontos;
  return base.map((p, i) => ({
    ordem: i, numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
    tipo: MS[p.num] ? "M" : "P", metodo: "PG6", inserido: false,
    descritivo: MS[p.num] ?? null, tipoLimite: "LA1", ehVia: false,
    codigoManual: `X-${p.num}`,
  }));
}

function confere(inverter) {
  const vs = linhas(inverter);
  const calc = montarServico({ fusoUtm: 24, prefixo: "X", contadores: { M: 0, P: 0, V: 0 }, vertices: vs }, proj4);
  const daPlanta = new Map(calc.ring.filter((v) => v.iniciaTrecho).map((v) => [v.codigo, v.iniciaTrecho.descritivo]));
  const origem = origemDaConfrontacaoHoraria(vs);
  const dasPecas = new Map(vs.flatMap((v, i) => v.tipo === "M" ? [[v.codigoManual, vs[origem.get(i)].descritivo]] : []));
  assert.equal(dasPecas.size, 6);
  assert.deepEqual(dasPecas, daPlanta);
  return dasPecas;
}

test("anel no sentido do TXT: peças e planta dão a mesma confrontação a cada M", () => {
  confere(false);
});

test("anel invertido: peças e planta continuam iguais (cada M abre o trecho do M anterior)", () => {
  const normal = confere(false);
  const invertido = confere(true);
  // a divisa física de cada confrontante é a mesma nos dois sentidos, então ao
  // menos um M muda de confrontação — senão o teste não estaria exercitando nada
  assert.ok([...normal].some(([cod, d]) => invertido.get(cod) !== d));
});

test("sem E/N em alguma linha não decide o sentido: cada M fica com a própria", () => {
  const vs = linhas(true);
  vs[3] = { ...vs[3], e: null };
  const origem = origemDaConfrontacaoHoraria(vs);
  for (const [i, j] of origem) assert.equal(i, j);
});
