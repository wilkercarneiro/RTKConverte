// Recuo legal ao longo de rodovias (src/lib/recuo.ts).
//
// O que se lacra: o tipo de via sai do nome do confrontante como o técnico
// escreve no campo; o padrão de cada tipo é o da pesquisa (BR 40 m por lado,
// BA 30 m, municipal sem padrão, não edificável 15 m); a não edificável só cai
// com a lei municipal e nunca abaixo de 5 m; com a divisa no eixo, a faixa de
// domínio inteira sai da terra útil; e a largura do padrão pede confirmação.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classificarVia, confrontanteDaVia, notaRecuo, recuoDaVia, resumoRecuo } from "../src/lib/recuo.ts";

test("classificarVia: federal, estadual, municipal e ferrovia pelo nome do confrontante", () => {
  assert.deepEqual(classificarVia("RODOVIA BR-116"), { tipo: "federal", sigla: "BR-116", uf: null });
  assert.deepEqual(classificarVia("BR 324"), { tipo: "federal", sigla: "BR-324", uf: null });
  assert.deepEqual(classificarVia("br116"), { tipo: "federal", sigla: "BR-116", uf: null });
  assert.deepEqual(classificarVia("BA-120"), { tipo: "estadual", sigla: "BA-120", uf: "BA" });
  assert.deepEqual(classificarVia("RODOVIA BA 52"), { tipo: "estadual", sigla: "BA-052", uf: "BA" });
  assert.deepEqual(classificarVia("Rodovia Estadual"), { tipo: "estadual", sigla: null, uf: null });
  assert.deepEqual(classificarVia("BA"), { tipo: "estadual", sigla: null, uf: "BA" });
  assert.deepEqual(classificarVia("RODOVIA BA"), { tipo: "estadual", sigla: null, uf: "BA" });
  assert.equal(classificarVia("ESTRADA VICINAL")?.tipo, "municipal");
  assert.equal(classificarVia("Estrada Municipal BA-001")?.tipo, "municipal", "municipal por extenso manda mesmo com código");
  assert.equal(classificarVia("ESTRADA")?.tipo, "municipal");
  assert.equal(classificarVia("LINHA FÉRREA")?.tipo, "ferrovia");
  assert.deepEqual(classificarVia("FERROVIA EF-025"), { tipo: "ferrovia", sigla: "EF-025", uf: null });
});

test("classificarVia: imóvel, pessoa e rio não são via", () => {
  assert.equal(classificarVia("(MATR. 4.490/CNS. 00.803-7) FAZENDA VIBRAÇÃO\\ JOÃO\\ CPF: 000"), null);
  assert.equal(classificarVia("JOSÉ DOS SANTOS\\ CPF: 123.456.789-00"), null);
  assert.equal(classificarVia("RIO JACUÍPE"), null);
  assert.equal(classificarVia(""), null);
  assert.equal(classificarVia(null), null);
});

test("recuoDaVia: padrões da pesquisa, com a largura do padrão pedindo confirmação", () => {
  const br = recuoDaVia(classificarVia("BR-116"));
  assert.equal(br.dominio, 40);
  assert.equal(br.naoEdificavel, 15);
  assert.equal(br.origemDominio, "padrao");
  assert.equal(br.confirmar, true);
  assert.equal(br.recuoDaDivisa, 0, "divisa na cerca: nada sai da terra");
  assert.equal(br.restricaoDaDivisa, 15);
  const ba = recuoDaVia(classificarVia("BA-408"));
  assert.equal(ba.dominio, 30);
  const mun = recuoDaVia(classificarVia("ESTRADA VICINAL"));
  assert.equal(mun.dominio, null);
  assert.equal(mun.naoEdificavel, 0);
  assert.equal(mun.confirmar, false);
});

test("recuoDaVia: divisa no eixo tira a faixa de domínio inteira e a restrição vem depois dela", () => {
  const r = recuoDaVia(classificarVia("BA-120"), { divisaNoEixo: true });
  assert.equal(r.recuoDaDivisa, 30);
  assert.equal(r.restricaoDaDivisa, 45);
  const inf = recuoDaVia(classificarVia("BR-242"), { divisaNoEixo: true, dominio: 20 });
  assert.equal(inf.origemDominio, "informada");
  assert.equal(inf.confirmar, false);
  assert.equal(inf.recuoDaDivisa, 20);
  assert.equal(inf.restricaoDaDivisa, 35);
  const semRegra = recuoDaVia(classificarVia("ESTRADA MUNICIPAL"), { divisaNoEixo: true });
  assert.equal(semRegra.recuoDaDivisa, 0);
  assert.match(semRegra.avisos[0], /largura/);
});

test("recuoDaVia: não edificável só reduz com lei municipal e nunca abaixo de 5 m", () => {
  const semLei = recuoDaVia(classificarVia("BR-116"), { naoEdificavel: 5 });
  assert.equal(semLei.naoEdificavel, 15);
  assert.match(semLei.avisos[0], /lei municipal/);
  const comLei = recuoDaVia(classificarVia("BR-116"), { naoEdificavel: 8, leiMunicipal: "Lei 1.234/2020" });
  assert.equal(comLei.naoEdificavel, 8);
  assert.equal(comLei.reduzida, true);
  const abaixo = recuoDaVia(classificarVia("BA-120"), { naoEdificavel: 2, leiMunicipal: "Lei 9/2021" });
  assert.equal(abaixo.naoEdificavel, 5);
  const ferro = recuoDaVia(classificarVia("FERROVIA"), { naoEdificavel: 5, leiMunicipal: "Lei 1" });
  assert.equal(ferro.naoEdificavel, 15, "ferrovia: 15 m sem redução (art. 4º, III-A)");
});

test("textos: confrontante no padrão do INCRA, resumo e nota com a fonte", () => {
  assert.equal(confrontanteDaVia(classificarVia("BR-116")), "RODOVIA BR-116 - FAIXA DE DOMÍNIO (DNIT)");
  assert.equal(confrontanteDaVia(classificarVia("BA-120")), "RODOVIA BA-120 - FAIXA DE DOMÍNIO (SEINFRA/SIT)");
  const r = recuoDaVia(classificarVia("BA-120"));
  assert.match(resumoRecuo(r), /30 m do eixo \(padrão SEINFRA\/SIT — confirme\) · não edificável 15 m/);
  const nota = notaRecuo(r);
  assert.match(nota, /RODOVIA BA-120/);
  assert.match(nota, /Lei 6\.766\/1979, art\. 4º, III/);
  const red = recuoDaVia(classificarVia("BR-116"), { dominio: 35, naoEdificavel: 10, leiMunicipal: "Lei 77/2019" });
  assert.match(notaRecuo(red, { leiMunicipal: "Lei 77/2019" }), /informada pelo responsável técnico.*reduzida pela lei municipal Lei 77\/2019/);
});
