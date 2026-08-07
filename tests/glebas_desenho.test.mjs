// Defeitos visuais relatados na primeira planta com glebas:
//
//   "ao dividir as glebas encavalaram uma na outra, textos um acima do outro"
//   "a estrada do meio entre uma gleba e outra encavalou, ficando uma acima da
//    outra, ficou visualmente ruim"
//
// As duas causas eram a mesma coisa: desenhar gleba por gleba, sem saber o que
// já tinha sido traçado. A divisa entre duas glebas vizinhas saía duas vezes
// (e em cima da linha dupla vermelha, três), e os nomes eram postos no centroide
// sem olhar para o vizinho.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { dadosPlantaDe, entrada } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const geo = () => geometriaDoCalculo(montarServico(entrada(), proj4));

const desenhar = async (glebas) => {
  const diag = {};
  await gerarPlantaPdf(dadosPlantaDe(geo(), { glebas }), diag);
  return diag;
};

// Duas glebas COLADAS: partilham a divisa vertical em E=480900.
const VIZINHAS = [
  {
    nome: "GLEBA 1", areaFmt: "3,0000",
    anel: [
      { e: 480750, n: 8732960 }, { e: 480900, n: 8732960 },
      { e: 480900, n: 8733060 }, { e: 480750, n: 8733060 },
    ],
  },
  {
    nome: "GLEBA 2", areaFmt: "3,0000",
    anel: [
      { e: 480900, n: 8732960 }, { e: 481050, n: 8732960 },
      { e: 481050, n: 8733060 }, { e: 480900, n: 8733060 },
    ],
  },
];

test("a divisa partilhada entre duas glebas é traçada UMA vez", async () => {
  const diag = await desenhar(VIZINHAS);
  // 4 + 4 arestas, menos a partilhada que aparece nas duas = 7
  assert.equal(diag.divisasGleba.length, 7, "divisa comum saiu repetida");

  // e nenhum par de traços coincide (mesmo par de extremos, em qualquer ordem)
  const chave = (s) => {
    const a = `${s.x1.toFixed(2)},${s.y1.toFixed(2)}`, b = `${s.x2.toFixed(2)},${s.y2.toFixed(2)}`;
    return [a, b].sort().join("|");
  };
  const chaves = diag.divisasGleba.map(chave);
  assert.equal(new Set(chaves).size, chaves.length, "há traços de gleba sobrepostos");
});

test("divisa que cai sobre a poligonal não é redesenhada por cima", async () => {
  // Uma gleba cujo contorno usa vértices do próprio perímetro: onde ela encosta
  // na poligonal, quem manda é o traço do perímetro (azul, ou a dupla vermelha
  // da faixa de domínio). Era isso que virava borrão em cima da estrada.
  const g = geo();
  const [a, b, cc] = [g.vertices[0], g.vertices[1], g.vertices[2]];
  const diag = await desenhar([{
    nome: "ENCOSTADA", areaFmt: "1,0000",
    anel: [
      { e: a.e, n: a.n }, { e: b.e, n: b.n }, { e: cc.e, n: cc.n },
      { e: (a.e + cc.e) / 2 - 40, n: (a.n + cc.n) / 2 - 40 },
    ],
  }]);
  // as arestas 0→1 e 1→2 são do perímetro: das 4 do contorno, só 2 saem
  assert.equal(diag.divisasGleba.length, 2, "traçou magenta em cima da poligonal");
});

test("os nomes das glebas não se sobrepõem", async () => {
  const diag = await desenhar(VIZINHAS);
  assert.equal(diag.rotulosGleba.length, 2, "toda gleba tem de sair nomeada");
  const [r1, r2] = diag.rotulosGleba;
  const cruza = r1.x1 < r2.x2 && r1.x2 > r2.x1 && r1.y1 < r2.y2 && r1.y2 > r2.y1;
  assert.equal(cruza, false, "os dois nomes saíram um por cima do outro");
});

test("com muitas glebas coladas, nenhum par de nomes se cruza", async () => {
  // quatro faixas coladas, o caso que produziu o relato
  const faixas = [0, 1, 2, 3].map((k) => ({
    nome: `GLEBA ${k + 1}`, areaFmt: "1,5000",
    anel: [
      { e: 480740 + k * 80, n: 8732960 }, { e: 480820 + k * 80, n: 8732960 },
      { e: 480820 + k * 80, n: 8733060 }, { e: 480740 + k * 80, n: 8733060 },
    ],
  }));
  const diag = await desenhar(faixas);
  assert.equal(diag.rotulosGleba.length, 4);
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const a = diag.rotulosGleba[i], b = diag.rotulosGleba[j];
      const cruza = a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;
      assert.equal(cruza, false, `nomes ${i + 1} e ${j + 1} se sobrepõem`);
    }
  }
});

test("gleba sem glebas continua sem diagnóstico de gleba", async () => {
  const diag = await desenhar(undefined);
  assert.deepEqual(diag.divisasGleba, []);
  assert.deepEqual(diag.rotulosGleba, []);
});
