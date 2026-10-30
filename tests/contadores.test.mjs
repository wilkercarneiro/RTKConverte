// Contadores do credenciado: o banco guarda o PRÓXIMO número a usar, a tela
// fala em ÚLTIMO número usado. Credenciado novo começa em 0001, nunca em 0000,
// e salvar o cadastro sem mexer nos contadores não reescreve a sequência.
import { test } from "node:test";
import assert from "node:assert/strict";
import { contadorDoUltimo, contadoresParaGravar, ultimosDe, ultimoUsado } from "../src/lib/contadores.ts";
import { alocarCodigos } from "../supabase/functions/_shared/geo.ts";

test("último usado = contador − 1; contador 0 (nunca usado) mostra 0", () => {
  assert.equal(ultimoUsado(3611), 3610);
  assert.equal(ultimoUsado(1), 0);
  assert.equal(ultimoUsado(0), 0);
  assert.equal(ultimoUsado(null), 0);
  assert.equal(contadorDoUltimo(3610), 3611);
  assert.equal(contadorDoUltimo(0), 1);
  assert.equal(contadorDoUltimo(-5), 1);
  // ida e volta não muda contador nenhum que já esteja em 1 ou mais
  for (const c of [1, 2, 758, 3605, 14300]) assert.equal(contadorDoUltimo(ultimoUsado(c)), c);
});

test("credenciado novo grava os três contadores em 1: o primeiro vértice sai M-0001", () => {
  const gravar = contadoresParaGravar(null, ultimosDe(null));
  assert.deepEqual(gravar, { contador_m: 1, contador_p: 1, contador_v: 1 });
  // o gerador numera a partir do contador (próximo a usar)
  const cod = alocarCodigos([{ ordem: 0, tipo: "M" }, { ordem: 1, tipo: "P" }], "DSBN",
    { M: gravar.contador_m, P: gravar.contador_p, V: gravar.contador_v });
  assert.equal(cod.get(0), "DSBN-M-0001");
  assert.equal(cod.get(1), "DSBN-P-0001");
});

test("quem digita o último número usado não ganha número repetido", () => {
  // a última planilha foi até DSBN-M-3610: o próximo vértice é o 3611
  const original = { contador_m: 1, contador_p: 1, contador_v: 1 };
  const gravar = contadoresParaGravar(original, { contador_m: 3610, contador_p: 0, contador_v: 0 });
  assert.deepEqual(gravar, { contador_m: 3611 });
  const cod = alocarCodigos([{ ordem: 0, tipo: "M" }], "DSBN", { M: gravar.contador_m, P: 1, V: 1 });
  assert.equal(cod.get(0), "DSBN-M-3611");
});

test("editar o credenciado sem mexer nos contadores não grava contador nenhum", () => {
  // o formulário abriu com M=3611; se uma geração andar o contador enquanto ele
  // está aberto, salvar o nome não pode devolver o 3611 ao banco
  const original = { contador_m: 3611, contador_p: 14300, contador_v: 0 };
  assert.deepEqual(contadoresParaGravar(original, ultimosDe(original)), {});
  // mudar só o P grava só o P
  assert.deepEqual(contadoresParaGravar(original, { ...ultimosDe(original), contador_p: 14310 }), { contador_p: 14311 });
});
