// "Nome na planta" por confrontante/estrada (2026-09-08): desmarcado, a divisa
// continua traçada mas o rótulo não sai — nem o número no quadro do rodapé.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf, numerarConfrontantes } from "../supabase/functions/_shared/planta.ts";
import { entrada, dadosPlantaDe } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);

test("exibirPlanta=false no vértice M vira semRotulo no trecho e some do desenho, sem mexer nas linhas", async () => {
  const inp = entrada();
  const ms = inp.vertices.filter((v) => v.tipo === "M");
  assert.ok(ms.length >= 2);
  const calcTodos = montarServico(inp, proj4);
  const gTodos = geometriaDoCalculo(calcTodos);
  const diagTodos = {};
  await gerarPlantaPdf(dadosPlantaDe(gTodos), diagTodos);

  ms[0].exibirPlanta = false;
  const calc = montarServico(inp, proj4);
  const oculto = calc.trechosOrdenados.find((t) => t.verticeInicioOrdem === ms[0].ordem);
  assert.equal(oculto.semRotulo, true);
  assert.equal(calc.trechosOrdenados.filter((t) => t.semRotulo).length, 1);
  const g = geometriaDoCalculo(calc);
  assert.equal(g.trechos.filter((t) => t.semRotulo).length, 1);
  const diag = {};
  await gerarPlantaPdf(dadosPlantaDe(g), diag);
  assert.equal(diag.rotulos.length, diagTodos.rotulos.length - 1, "um rótulo a menos no desenho");
  assert.equal(diag.obstaculos.length, diagTodos.obstaculos.length, "as linhas do desenho não mudam");
  // memorial e planilha continuam descrevendo o confrontante
  assert.equal(calc.linhasOds.length, calcTodos.linhasOds.length);
  assert.equal(calc.memorialRing.length, calcTodos.memorialRing.length);
});

test("confrontante oculto não ganha número no quadro do rodapé", () => {
  const trechos = [
    { descritivo: "FAZENDA A", numerado: true, inicioIdx: 0 },
    { descritivo: "FAZENDA B", numerado: true, semRotulo: true, inicioIdx: 3 },
    { descritivo: "FAZENDA C", numerado: true, inicioIdx: 5 },
  ];
  assert.deepEqual(numerarConfrontantes(trechos).map((n) => [n.numero, n.descritivo]), [[1, "FAZENDA A"], [2, "FAZENDA C"]]);
});
