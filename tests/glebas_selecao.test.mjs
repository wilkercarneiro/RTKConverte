// Seleção de pontos do contorno da gleba.
//
// É a parte que erra calado: um trecho que anda para o lado errado do perímetro
// produz uma gleba com a forma de tudo menos o que se queria, e isso só apareceria
// na planta impressa. Por isso a decisão de QUAIS pontos entram mora em
// src/lib/glebas.ts, fora do componente, e é provada aqui.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acrescentarSemRepetir, areaHaDoAnel, grudarNoPerimetro, indiceNoPerimetro,
  mesmoPonto, sentidoDoContorno, trechoDoPerimetro,
} from "../src/lib/glebas.ts";

test("trecho anda para frente quando esse é o caminho curto", () => {
  // perímetro de 10 vértices: de 2 até 5 são 3 passos para frente, 7 para trás
  assert.deepEqual(trechoDoPerimetro(10, 2, 5), [3, 4, 5]);
});

test("trecho anda para trás quando esse é o caminho curto", () => {
  // de 8 até 6 são 2 passos para trás e 8 para frente
  assert.deepEqual(trechoDoPerimetro(10, 8, 6), [7, 6]);
});

test("trecho dá a volta no anel quando é mais curto por ali", () => {
  // de 1 até 9: para trás são 2 passos (0, 9); para frente seriam 8
  assert.deepEqual(trechoDoPerimetro(10, 1, 9), [0, 9]);
});

test("empate exato resolve para a frente, a ordem em que o anel é publicado", () => {
  assert.deepEqual(trechoDoPerimetro(8, 0, 4), [1, 2, 3, 4]);
});

test("trecho de um vértice para ele mesmo não acrescenta nada", () => {
  assert.deepEqual(trechoDoPerimetro(10, 3, 3), []);
});

test("perímetro vazio ou índice inválido não quebra", () => {
  assert.deepEqual(trechoDoPerimetro(0, 0, 0), []);
  assert.deepEqual(trechoDoPerimetro(10, -1, 5), []);
});

test("selecionar a mesma área duas vezes não duplica o contorno", () => {
  // sem isso a shoelace devolveria área errada com o anel repetido
  const anel = [[10, 10], [20, 10]];
  const novos = [[20, 10], [20, 20]];
  assert.deepEqual(acrescentarSemRepetir(anel, novos), [[10, 10], [20, 10], [20, 20]]);
});

test("pontos a menos de 1 mm são o mesmo ponto", () => {
  assert.equal(mesmoPonto([480000.0001, 8730000], [480000, 8730000]), true);
  assert.equal(mesmoPonto([480000.01, 8730000], [480000, 8730000]), false);
});

test("indiceNoPerimetro acha o vértice e devolve -1 para ponto livre", () => {
  const per = [[10, 10], [20, 10], [20, 20]];
  assert.equal(indiceNoPerimetro(per, [20, 10]), 1);
  assert.equal(indiceNoPerimetro(per, [15, 15]), -1);
});

test("o ímã gruda no vértice mais próximo, e só dentro do raio", () => {
  const per = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  assert.deepEqual(grudarNoPerimetro(per, { x: 105, y: 103 }, 12), { x: 100, y: 100 });
  // 30 px de distância com raio 12: não gruda, o ponto fica onde foi solto
  assert.equal(grudarNoPerimetro(per, { x: 130, y: 100 }, 12), null);
});

test("área do contorno bate com a shoelace, em hectares", () => {
  // quadrado de 100 m de lado = 10.000 m² = 1 ha
  const quadrado = [[0, 0], [100, 0], [100, 100], [0, 100]];
  assert.equal(areaHaDoAnel(quadrado).toFixed(4), "1.0000");
  // sentido invertido dá a MESMA área: o operador pode desenhar em qualquer sentido
  assert.equal(areaHaDoAnel([...quadrado].reverse()).toFixed(4), "1.0000");
  // contorno que não fecha polígono não tem área
  assert.equal(areaHaDoAnel([[0, 0], [100, 0]]), 0);
});

// ---- direção do contorno: o que impedia o anel de sair cruzado ----
//
// Clicar salteado ligava dois vértices por uma corda que atravessava o imóvel.
// Com o clique seguindo o perímetro, sobra decidir PARA QUE LADO andar — e o
// "caminho mais curto" inverte assim que o contorno passa da metade do anel,
// que era exatamente quando o desenho saía embolado.

test("o rumo sai dos dois últimos vértices do contorno", () => {
  const per = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
  assert.equal(sentidoDoContorno(per, [[1, 0], [2, 0]]), 1, "1→2 é para a frente");
  assert.equal(sentidoDoContorno(per, [[4, 0], [3, 0]]), -1, "4→3 é para trás");
});

test("o rumo dá a volta no anel", () => {
  const per = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
  // 5 → 0 é um passo para a frente (fechando o anel), não cinco para trás
  assert.equal(sentidoDoContorno(per, [[5, 0], [0, 0]]), 1);
});

test("sem dois vértices do perímetro consecutivos, não há rumo a inferir", () => {
  const per = [[0, 0], [1, 0], [2, 0], [3, 0]];
  assert.equal(sentidoDoContorno(per, [[1, 0]]), null, "um ponto só");
  assert.equal(sentidoDoContorno(per, [[9, 9], [8, 8]]), null, "pontos livres");
});

test("mantido o rumo, o trecho NÃO inverte depois da metade do anel", () => {
  // é o caso que embolava: de 2 para 7 num anel de 10, o caminho curto é para
  // trás (5 passos) e o longo para a frente (5)... em 12 fica explícito:
  const total = 12;
  // curto seria voltar (de 2 para 9 são 5 passos para trás, 7 para a frente)
  assert.deepEqual(trechoDoPerimetro(total, 2, 9), [1, 0, 11, 10, 9], "sem rumo: caminho curto");
  // mas se o contorno já vinha para a FRENTE, tem de continuar para a frente
  assert.deepEqual(trechoDoPerimetro(total, 2, 9, 1), [3, 4, 5, 6, 7, 8, 9]);
});

test("rumo para trás percorre o outro lado", () => {
  assert.deepEqual(trechoDoPerimetro(10, 8, 5, -1), [7, 6, 5]);
  assert.deepEqual(trechoDoPerimetro(10, 8, 5, 1), [9, 0, 1, 2, 3, 4, 5]);
});

test("trecho longo de perímetro entra de uma vez só", () => {
  // o caso que motivou o editor visual: uma gleba que acompanha 12 vértices
  // saía a 12 cliques; com shift+clique é um só.
  const idx = trechoDoPerimetro(40, 5, 17);
  assert.equal(idx.length, 12);
  assert.deepEqual(idx, [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
});
