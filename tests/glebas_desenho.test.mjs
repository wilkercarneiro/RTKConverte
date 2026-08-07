// Como a gleba tem de sair na planta.
//
// A referência é a planta FAZENDA MAURICÉIA-A1 da própria empresa, e ela
// desmentiu a primeira implementação: gleba NÃO é divisa interna tracejada com
// um nome no meio. É uma POLIGONAL — mesmo azul, mesma espessura da poligonal do
// terreno —, com bloco de identificação completo, tabela própria no quadro
// analítico e área/perímetro próprios no rodapé. A legenda não ganha entrada
// nova, porque gleba não é um tipo de traço: é o imóvel, dividido.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { dadosPlantaDe, entrada, glebaDe } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const geo = () => geometriaDoCalculo(montarServico(entrada(), proj4));

const desenhar = async (glebas) => {
  const diag = {};
  await gerarPlantaPdf(dadosPlantaDe(geo(), { glebas }), diag);
  return diag;
};

test("cada aresta da gleba vira um traço da poligonal", async () => {
  const g = geo();
  const gl = glebaDe(g, [0, 1, 2, 3, 4], "GLEBA 1");
  const diag = await desenhar([gl]);
  assert.equal(diag.divisasGleba.length, 5, "um traço por aresta do anel da gleba");
});

test("duas glebas desenham as duas poligonais", async () => {
  const g = geo();
  const diag = await desenhar([
    glebaDe(g, [0, 1, 2, 3], "GLEBA 1"),
    glebaDe(g, [10, 11, 12, 13, 14], "GLEBA 2"),
  ]);
  assert.equal(diag.divisasGleba.length, 4 + 5);
});

test("a faixa de domínio da gleba sai em linha dupla, como no perímetro", async () => {
  const g = geo();
  const semVia = await desenhar([glebaDe(g, [0, 1, 2, 3], "GLEBA 1")]);
  // a aresta 1 da gleba é estrada: entram DOIS traços vermelhos (a linha dupla)
  const comVia = await desenhar([glebaDe(g, [0, 1, 2, 3], "GLEBA 1", { viasIdx: [1] })]);
  assert.equal(comVia.vias.length, semVia.vias.length + 2, "a via da gleba tem de sair em dupla");
});

test("cada gleba ganha o seu bloco de identificação", async () => {
  const g = geo();
  const diag = await desenhar([
    glebaDe(g, [0, 1, 2, 3], "GLEBA 1"),
    glebaDe(g, [10, 11, 12, 13, 14], "GLEBA 2"),
  ]);
  assert.equal(diag.rotulosGleba.length, 2, "toda gleba tem de sair identificada");
  const [a, b] = diag.rotulosGleba;
  const cruza = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
  assert.equal(cruza, false, "os dois blocos saíram um por cima do outro");
});

test("com quatro glebas, nenhum par de blocos se cruza", async () => {
  const g = geo();
  const glebas = [
    glebaDe(g, [0, 1, 2, 3], "GLEBA 1"),
    glebaDe(g, [8, 9, 10, 11], "GLEBA 2"),
    glebaDe(g, [16, 17, 18, 19], "GLEBA 3"),
    glebaDe(g, [24, 25, 26, 27], "GLEBA 4"),
  ];
  const diag = await desenhar(glebas);
  assert.equal(diag.rotulosGleba.length, 4);
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const a = diag.rotulosGleba[i], b = diag.rotulosGleba[j];
      const cruza = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
      assert.equal(cruza, false, `blocos ${i + 1} e ${j + 1} se sobrepõem`);
    }
  }
});

test("o bloco da gleba não cobre traço nenhum do desenho", async () => {
  // mesma regra dos nomes de confrontante: nome não invade linha
  const g = geo();
  const diag = await desenhar([glebaDe(g, [0, 1, 2, 3, 4, 5], "GLEBA 1")]);
  const cruzaSeg = (s, r) => {
    const dentro = (x, y) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
    return dentro(s.x1, s.y1) || dentro(s.x2, s.y2);
  };
  const invadidos = diag.rotulosGleba.filter((r) => diag.obstaculos.some((s) => cruzaSeg(s, r)));
  assert.equal(invadidos.length, 0, "bloco de gleba caiu por cima de uma linha");
});

test("gleba de menos de 3 pontos é ignorada sem derrubar a planta", async () => {
  const g = geo();
  const gl = glebaDe(g, [0, 1], "X");
  const diag = await desenhar([gl]);
  assert.deepEqual(diag.divisasGleba, []);
  assert.deepEqual(diag.rotulosGleba, []);
});

test("sem glebas o diagnóstico de gleba fica vazio", async () => {
  const diag = await desenhar(undefined);
  assert.deepEqual(diag.divisasGleba, []);
  assert.deepEqual(diag.rotulosGleba, []);
});
