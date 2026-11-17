// A conta do cupom (supabase/functions/_shared/cupons.ts, migração 0052): o
// servidor cobra com ela e a página de cadastro mostra a mesma. Os fluxos com o
// Asaas estão em tests/cobranca.test.mjs; a regra do banco, em tests/rls/cupons.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adesaoComCupom, cupomDe, fimDoDesconto, mensalidadeComCupom, mesesGratis, normalizarCodigo, primeiroPagamento,
  problemasDoCupom, resumoDoCupom, textosDoCupom, vencimentoComIsencao,
} from "../supabase/functions/_shared/cupons.ts";

const cupom = (o) => cupomDe({ codigo: "TESTE", ...o });
const FORM = {
  codigo: "BEMVINDO", adesao_tipo: null, adesao_valor: null, mensalidade_tipo: null, mensalidade_valor: null,
  mensalidade_vezes: null, isencao_meses: null, max_usos: null, valido_ate: null,
};

test("código: maiúsculas, sem acento nem espaço", () => {
  assert.equal(normalizarCodigo(" bem-vindo ção 20 "), "BEM-VINDOCAO20");
  assert.equal(normalizarCodigo(null), "");
  assert.equal(cupomDe({ codigo: "X" }), null, "sem adesão nem mensalidade não é cupom");
  assert.equal(cupomDe(null), null);
});

test("adesão: percentual, valor (nunca negativo) e isenção", () => {
  assert.equal(adesaoComCupom(500, cupom({ adesao_tipo: "percentual", adesao_valor: 30 })), 350);
  assert.equal(adesaoComCupom(500, cupom({ adesao_tipo: "percentual", adesao_valor: 100 })), 0);
  assert.equal(adesaoComCupom(500, cupom({ adesao_tipo: "valor", adesao_valor: 120.5 })), 379.5);
  assert.equal(adesaoComCupom(500, cupom({ adesao_tipo: "valor", adesao_valor: 900 })), 0);
  assert.equal(adesaoComCupom(500, cupom({ adesao_tipo: "isencao" })), 0);
  assert.equal(adesaoComCupom(500, cupom({ mensalidade_tipo: "isencao", isencao_meses: 1 })), 500, "cupom só da mensalidade não mexe na adesão");
  assert.equal(adesaoComCupom(0, cupom({ adesao_tipo: "valor", adesao_valor: 10 })), 0);
});

test("mensalidade: desconto até o fim, cheio depois, nunca abaixo de R$ 5,00 (mínimo do Asaas)", () => {
  const vinte = cupom({ mensalidade_tipo: "percentual", mensalidade_valor: 20, mensalidade_vezes: 3 });
  assert.equal(mensalidadeComCupom(299.9, vinte), 239.92, "antes de começar: com desconto");
  assert.equal(mensalidadeComCupom(299.9, vinte, "2026-12-30", "2027-01-30"), 239.92);
  assert.equal(mensalidadeComCupom(299.9, vinte, "2027-01-30", "2027-01-30"), 299.9, "a cobrança do fim do desconto já é cheia");
  const sempre = cupom({ mensalidade_tipo: "valor", mensalidade_valor: 50, mensalidade_vezes: null });
  assert.equal(mensalidadeComCupom(299.9, sempre, "2030-01-01", "2027-01-01"), 249.9, "em todas: não acaba");
  assert.equal(mensalidadeComCupom(299.9, cupom({ mensalidade_tipo: "valor", mensalidade_valor: 299 })), 5);
  assert.equal(mensalidadeComCupom(299.9, cupom({ mensalidade_tipo: "percentual", mensalidade_valor: 99 })), 5);
  assert.equal(mensalidadeComCupom(299.9, cupom({ mensalidade_tipo: "isencao", isencao_meses: 2 })), 299.9, "isenção não muda o valor: muda o vencimento");
  assert.equal(mensalidadeComCupom(299.9, null), 299.9);
});

test("fim do desconto e vencimento com a isenção, no período da assinatura", () => {
  const dois = cupom({ mensalidade_tipo: "percentual", mensalidade_valor: 10, mensalidade_vezes: 2 });
  assert.equal(fimDoDesconto("2026-10-31", dois, "MONTHLY"), "2026-12-31");
  assert.equal(fimDoDesconto("2026-10-31", dois, "YEARLY"), "2028-10-31", "2 cobranças anuais");
  assert.equal(fimDoDesconto("2026-01-31", cupom({ mensalidade_tipo: "valor", mensalidade_valor: 10, mensalidade_vezes: 1 }), "MONTHLY"), "2026-02-28", "31 → último dia");
  assert.equal(fimDoDesconto("2026-10-31", cupom({ mensalidade_tipo: "valor", mensalidade_valor: 10 }), "MONTHLY"), null, "em todas: sem fim");
  assert.equal(fimDoDesconto("2026-10-31", cupom({ adesao_tipo: "isencao" }), "MONTHLY"), null);
  const tres = cupom({ mensalidade_tipo: "isencao", isencao_meses: 3 });
  assert.equal(mesesGratis(tres), 3);
  assert.equal(vencimentoComIsencao("2026-11-30", tres), "2027-02-28");
  assert.equal(vencimentoComIsencao("2026-11-30", null), "2026-11-30");
  assert.equal(mesesGratis(cupom({ mensalidade_tipo: "isencao", isencao_meses: 99 })), 24, "teto de 24 meses");
});

test("1º pagamento do cadastro: período + adesão com o cupom; meses grátis cobram só a adesão; adesão < R$ 5 sozinha vira isenta", () => {
  assert.deepEqual(primeiroPagamento(3598.8, 500, null), { periodo: 3598.8, adesao: 500, total: 4098.8, meses_gratis: 0, periodo_cheio: 3598.8, adesao_cheia: 500 });
  const combo = cupom({ adesao_tipo: "percentual", adesao_valor: 50, mensalidade_tipo: "valor", mensalidade_valor: 50 });
  assert.equal(primeiroPagamento(3598.8, 500, combo).total, 3798.8);
  const gratis = cupom({ mensalidade_tipo: "isencao", isencao_meses: 1 });
  assert.deepEqual(primeiroPagamento(299.9, 500, gratis), { periodo: 0, adesao: 500, total: 500, meses_gratis: 1, periodo_cheio: 299.9, adesao_cheia: 500 });
  assert.equal(primeiroPagamento(299.9, 0, gratis).total, 0, "sem adesão: nada a pagar agora");
  const quase = cupom({ adesao_tipo: "valor", adesao_valor: 497, mensalidade_tipo: "isencao", isencao_meses: 1 });
  assert.equal(primeiroPagamento(299.9, 500, quase).total, 0, "R$ 3,00 de adesão sozinha: o Asaas não cobra, fica isenta");
  const soAdesaoBaixa = cupom({ adesao_tipo: "valor", adesao_valor: 497 });
  assert.equal(primeiroPagamento(299.9, 500, soAdesaoBaixa).total, 302.9, "somada ao período, os R$ 3,00 vão junto");
});

test("o cupom em frases", () => {
  assert.deepEqual(textosDoCupom(cupom({ adesao_tipo: "isencao" })), ["Isenção da taxa de adesão"]);
  assert.deepEqual(textosDoCupom(cupom({ adesao_tipo: "percentual", adesao_valor: 25.5 })), ["25,5% de desconto na taxa de adesão"]);
  assert.match(textosDoCupom(cupom({ adesao_tipo: "valor", adesao_valor: 200 }))[0], /^R\$\s200,00 de desconto na taxa de adesão$/);
  assert.deepEqual(textosDoCupom(cupom({ mensalidade_tipo: "isencao", isencao_meses: 1 })), ["1º mês sem mensalidade"]);
  assert.deepEqual(textosDoCupom(cupom({ mensalidade_tipo: "isencao", isencao_meses: 3 })), ["3 primeiros meses sem mensalidade"]);
  assert.deepEqual(textosDoCupom(cupom({ mensalidade_tipo: "percentual", mensalidade_valor: 20, mensalidade_vezes: 1 })), ["20% de desconto na primeira cobrança da mensalidade"]);
  assert.deepEqual(textosDoCupom(cupom({ mensalidade_tipo: "percentual", mensalidade_valor: 20, mensalidade_vezes: 6 })), ["20% de desconto nas 6 primeiras cobranças da mensalidade"]);
  assert.match(resumoDoCupom(cupom({ adesao_tipo: "isencao", mensalidade_tipo: "valor", mensalidade_valor: 30 })),
    /^Isenção da taxa de adesão · R\$\s30,00 de desconto em todas as cobranças da mensalidade$/);
});

test("formulário do painel: o que falta ou passa do limite", () => {
  assert.deepEqual(Object.keys(problemasDoCupom(FORM)), ["alvo"]);
  assert.deepEqual(problemasDoCupom({ ...FORM, adesao_tipo: "isencao" }), {});
  assert.ok(problemasDoCupom({ ...FORM, codigo: "x", adesao_tipo: "isencao" }).codigo);
  assert.ok(problemasDoCupom({ ...FORM, adesao_tipo: "percentual", adesao_valor: 101 }).adesao_valor);
  assert.ok(problemasDoCupom({ ...FORM, mensalidade_tipo: "percentual", mensalidade_valor: 100 }).mensalidade_valor, "100% na mensalidade é isenção");
  assert.ok(problemasDoCupom({ ...FORM, mensalidade_tipo: "valor", mensalidade_valor: 10, mensalidade_vezes: 0 }).mensalidade_vezes);
  assert.deepEqual(problemasDoCupom({ ...FORM, mensalidade_tipo: "valor", mensalidade_valor: 10, mensalidade_vezes: null }), {});
  assert.ok(problemasDoCupom({ ...FORM, mensalidade_tipo: "isencao", isencao_meses: 25 }).isencao_meses);
  assert.ok(problemasDoCupom({ ...FORM, adesao_tipo: "isencao", max_usos: 0 }).max_usos);
  assert.ok(problemasDoCupom({ ...FORM, adesao_tipo: "isencao", valido_ate: "31/12/2026" }).valido_ate);
});
