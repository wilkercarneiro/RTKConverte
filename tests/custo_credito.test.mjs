// A pergunta do "Prosseguir" (conferência do TXT): quanto crédito sai, de onde e
// quanto sobra. Segue a ordem do banco (fonte_credito): a carteira indicada para
// o serviço; nela, primeiro o crédito do mês, depois o extra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { custoDoServico } from "../src/lib/creditos_regras.ts";

const geral = (o = {}) => ({ chave: "geral", nome: "Créditos gerais", descricao: null, servicos: null, por_mes: 50, usado: 10, extra: 0, precos: [], ...o });
const car = (o = {}) => ({ chave: "car", nome: "Créditos de CAR", descricao: null, servicos: ["servico.car"], por_mes: 5, usado: 0, extra: 0, precos: [], ...o });
const situacao = (carteiras, servicos) => ({
  periodo: { inicio: "2026-11-01", renova_em: "2026-12-01", dia: 1 },
  carteiras, servicos, sou_dono: true, pagamento_online: false, compras: [],
});

test("crédito do mês: diz quanto sobra depois e quando renova", () => {
  const c = situacao([geral(), car()], { "servico.completo": { disponivel: true, carteira: "geral", precisa_aceite: false } });
  const r = custoDoServico(c, "completo");
  assert.equal(r.disponivel, true);
  assert.equal(r.credito, "1 crédito geral");
  assert.match(r.detalhe, /sobram 39 de 50/);
  assert.match(r.detalhe, /renova em 1 de dezembro/);
});

test("último crédito do mês: 'não sobra nenhum' e lembra dos extras guardados", () => {
  const c = situacao([geral({ usado: 49, extra: 3 })], { "servico.completo": { disponivel: true, carteira: "geral", precisa_aceite: false } });
  const r = custoDoServico(c, "completo");
  assert.match(r.detalhe, /não sobra nenhum de 50/);
  assert.match(r.detalhe, /3 extras guardados/);
});

test("mês esgotado: sai do extra comprado", () => {
  const c = situacao([geral({ usado: 50, extra: 2 })], { "servico.completo": { disponivel: true, carteira: "geral", precisa_aceite: false } });
  const r = custoDoServico(c, "completo");
  assert.match(r.detalhe, /sai dos extras comprados/);
  assert.match(r.detalhe, /sobra 1 extra/);
});

test("plano sem limite: avisa que não há limite (e ainda é 1 crédito)", () => {
  const c = situacao([geral({ por_mes: null })], { "servico.completo": { disponivel: true, carteira: "geral", precisa_aceite: false } });
  const r = custoDoServico(c, "completo");
  assert.equal(r.credito, "1 crédito geral");
  assert.match(r.detalhe, /não tem limite/);
});

test("sem crédito: não pergunta — avisa e a conferência fica aberta", () => {
  const c = situacao([geral({ usado: 50 })], { "servico.completo": { disponivel: false, carteira: null, precisa_aceite: false } });
  const r = custoDoServico(c, "completo");
  assert.equal(r.disponivel, false);
  assert.match(r.detalhe, /acabaram/);
  assert.match(r.detalhe, /conferência fica aberta/);
});

test("banco sem a 0034 (sem retrato dos créditos): texto genérico, não bloqueia", () => {
  const r = custoDoServico(null, "completo");
  assert.equal(r.disponivel, true);
  assert.equal(r.credito, "1 crédito");
});

test("usa a carteira que o banco indicou (CAR gasta CAR)", () => {
  const c = situacao([geral(), car({ usado: 1 })], { "servico.car": { disponivel: true, carteira: "car", precisa_aceite: false } });
  const r = custoDoServico(c, "car");
  assert.equal(r.credito, "1 crédito de CAR");
  assert.match(r.detalhe, /sobram 3 de 5/);
});

// GEO de cada parte da divisão: 1 crédito por parte selecionada
import { custoDeVarios } from "../src/lib/creditos_regras.ts";

test("GEO das partes: n créditos, do mês e depois dos extras", () => {
  const c = situacao([geral({ usado: 48, extra: 5 })], { "servico.completo": { disponivel: true, carteira: "geral", precisa_aceite: false } });
  const r = custoDeVarios(c, "completo", 4);
  assert.equal(r.disponivel, true);
  assert.equal(r.credito, "4 créditos gerais");
  assert.match(r.detalhe, /2 dos créditos do mês e 2 dos extras comprados/);
  assert.match(r.detalhe, /sobram 3/);
});

test("GEO das partes: sem crédito para todas, não deixa começar", () => {
  const c = situacao([geral({ usado: 49, extra: 1 })], { "servico.completo": { disponivel: true, carteira: "geral", precisa_aceite: false } });
  const r = custoDeVarios(c, "completo", 3);
  assert.equal(r.disponivel, false);
  assert.match(r.detalhe, /2 créditos gerais e são 3 partes/);
});

test("GEO das partes: plano sem limite e uma parte só", () => {
  const c = situacao([geral({ por_mes: null })], { "servico.completo": { disponivel: true, carteira: "geral", precisa_aceite: false } });
  assert.match(custoDeVarios(c, "completo", 3).detalhe, /sem limite|não tem limite/);
  assert.equal(custoDeVarios(c, "completo", 1).credito, "1 crédito geral");
  assert.equal(custoDeVarios(null, "completo", 2).credito, "2 créditos");
});
