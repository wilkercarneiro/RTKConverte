// Períodos e parcelas do autocadastro (supabase/functions/_shared/parcelas.ts):
// a conta que a função `cobranca` manda ao Asaas e que a tela mostra antes do
// botão Pagar. Os valores conferem com a tabela da pesquisa do Asaas
// (05/11/2026, Tabela Price a 2,99% a.m.).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cicloDe, configDasRegras, descricaoDaCompra, economia, escolherParcelas, maxParcelas, normalizarRegras, opcoesDeParcelas,
  parcelamento, problemaDasRegras, REGRAS_PADRAO, regrasDe, somarMeses, TEXTO_ADESAO_PADRAO, textoParcelas, totalComAdesao, valorDoPeriodo,
} from "../supabase/functions/_shared/parcelas.ts";

const R = REGRAS_PADRAO;
const soma = (p) => Math.round((p.parcela * (p.n - 1) + p.ultima) * 100) / 100;

test("Tabela Price a 2,99%: os valores da tabela da pesquisa", () => {
  const p7 = parcelamento(299.9, 7, R);
  assert.deepEqual({ parcela: p7.parcela, total: p7.total, juros: p7.juros, campo: p7.campo },
    { parcela: 48.12, total: 336.84, juros: true, campo: "installmentValue" }, "7x de R$ 299,90 = R$ 48,12");
  assert.equal(parcelamento(299.9, 12, R).parcela, 30.11);
  assert.equal(parcelamento(299.9, 12, R).total, 361.32);
  assert.equal(parcelamento(599.9, 7, R).parcela, 96.25);
  assert.equal(parcelamento(999.9, 10, R).parcela, 117.16);
  assert.equal(parcelamento(999.9, 12, R).total, 1204.68);
  for (const n of [7, 8, 9, 10, 11, 12]) {
    const p = parcelamento(299.9, n, R);
    assert.equal(p.ultima, p.parcela, "com juros todas as parcelas são iguais");
    assert.equal(p.total, Math.round(p.parcela * n * 100) / 100, "total = n × parcela");
  }
});

test("sem juros até 6x: o total é o preço e a diferença do arredondamento vai na última", () => {
  for (const n of [2, 3, 4, 5, 6]) {
    const p = parcelamento(299.9, n, R);
    assert.equal(p.juros, false);
    assert.equal(p.campo, "totalValue", "o Asaas recebe o total e divide");
    assert.equal(p.total, 299.9);
    assert.equal(soma(p), 299.9, `${n}x: a soma fecha o total`);
  }
  const p3 = parcelamento(299.9, 3, R);
  assert.deepEqual([p3.parcela, p3.ultima], [99.97, 99.96], "3x: 99,97 + 99,97 + 99,96");
  const p6 = parcelamento(299.9, 6, R);
  assert.deepEqual([p6.parcela, p6.ultima], [49.98, 50], "6x: 5 × 49,98 + 50,00");
  assert.deepEqual(parcelamento(299.9, 1, R), { n: 1, parcela: 299.9, ultima: 299.9, total: 299.9, juros: false, campo: "value" });
  // limite configurável: com 3 sem juros, a 4ª já tem juros
  const r3 = normalizarRegras({ ...R, parcelas_sem_juros: 3 });
  assert.equal(parcelamento(1000, 3, r3).juros, false);
  assert.equal(parcelamento(1000, 4, r3).juros, true);
  // juros zerado: tudo sem juros
  assert.equal(parcelamento(1000, 12, normalizarRegras({ ...R, juros_mes: 0 })).total, 1000);
});

test("parcelas por período: mensal à vista, semestral até 6x sem juros, anual até 12x", () => {
  assert.equal(maxParcelas(R, "MONTHLY"), 1);
  assert.equal(maxParcelas(R, "SEMIANNUALLY"), 6);
  assert.equal(maxParcelas(R, "YEARLY"), 12);
  assert.equal(maxParcelas(normalizarRegras({ ...R, parcelas_max: 10 }), "YEARLY"), 10, "o máximo configurado manda");
  const semestral = opcoesDeParcelas(valorDoPeriodo(299.9, "SEMIANNUALLY"), "SEMIANNUALLY", R);
  assert.equal(semestral.length, 6);
  assert.ok(semestral.every((p) => !p.juros && p.total === 1799.4), "semestral: tudo sem juros, total R$ 1.799,40");
  const anual = opcoesDeParcelas(valorDoPeriodo(299.9, "YEARLY"), "YEARLY", R);
  assert.equal(anual.length, 12);
  assert.deepEqual(anual.map((p) => p.juros), [false, false, false, false, false, false, true, true, true, true, true, true]);
  assert.equal(anual[11].parcela, 361.33, "anual de R$ 299,90 (R$ 3.598,80) em 12x: R$ 361,33 (12 × a parcela da mensalidade)");
  assert.equal(escolherParcelas(299.9, "MONTHLY", 2, R), null, "mensal não parcela");
  assert.equal(escolherParcelas(3598.8, "YEARLY", 13, R), null);
  assert.equal(escolherParcelas(3598.8, "YEARLY", "7", R).n, 7);
  assert.equal(escolherParcelas(3598.8, "YEARLY", 2.5, R), null);
});

test("valor do período com desconto; o mensal nunca tem desconto", () => {
  assert.equal(valorDoPeriodo(299.9, "MONTHLY"), 299.9);
  assert.equal(valorDoPeriodo(299.9, "YEARLY"), 3598.8);
  assert.equal(valorDoPeriodo(299.9, "YEARLY", 10), 3238.92);
  assert.equal(economia(299.9, "YEARLY", 10), 359.88);
  assert.equal(valorDoPeriodo(199.9, "SEMIANNUALLY", 5), 1139.43);
  const r = normalizarRegras({ ciclos: { MONTHLY: { desconto: 20 }, YEARLY: { desconto: 80, ativo: false } } });
  assert.equal(r.ciclos.MONTHLY.desconto, 0, "desconto no mensal é ignorado");
  assert.equal(r.ciclos.YEARLY.desconto, 50, "desconto acima do limite é cortado");
  assert.equal(r.ciclos.YEARLY.ativo, false);
  assert.equal(r.ciclos.SEMIANNUALLY.ativo, true, "período sem configuração fica à venda");
});

test("regras: padrões, gravadas em cobranca_config e conferidas antes de gravar", () => {
  assert.deepEqual(regrasDe({}), REGRAS_PADRAO, "sem nada gravado: 6 sem juros, 12 no máximo, 2,99% a.m., três períodos");
  const r = normalizarRegras({ cadastro_aberto: true, parcelas_sem_juros: "4", parcelas_max: "10", juros_mes: "1,99",
    ciclos: { SEMIANNUALLY: { ativo: false, desconto: 0 }, YEARLY: { ativo: true, desconto: "12,5" } } });
  assert.deepEqual(regrasDe(configDasRegras(r)), r, "ida e volta pelo banco");
  assert.equal(r.juros_mes, 1.99);
  assert.equal(r.ciclos.YEARLY.desconto, 12.5);
  assert.equal(regrasDe({ ciclos: "{quebrado" }).ciclos.YEARLY.ativo, true, "JSON quebrado: padrão");
  assert.equal(normalizarRegras({ parcelas_max: 4, parcelas_sem_juros: 9 }).parcelas_sem_juros, 4, "sem juros não passa do máximo");
  assert.equal(normalizarRegras({ parcelas_max: 40 }).parcelas_max, 12);
  assert.equal(problemaDasRegras({ ...configDasRegras(R) }), null);
  assert.match(problemaDasRegras({ ...configDasRegras(R), parcelas_max: "13" }), /1 a 12/);
  assert.match(problemaDasRegras({ ...configDasRegras(R), parcelas_sem_juros: "8", parcelas_max: "6" }), /sem juros/);
  assert.match(problemaDasRegras({ ...configDasRegras(R), juros_mes: "-1" }), /juros/);
  assert.match(problemaDasRegras({ ...R, ciclos: { YEARLY: { desconto: 60 } } }), /anual/);
  assert.match(problemaDasRegras({ ...R, cadastro_aberto: true, ciclos: { MONTHLY: { ativo: false }, SEMIANNUALLY: { ativo: false }, YEARLY: { ativo: false } } }),
    /ao menos um período/);
});

test("textos e datas: o que a tela e a fatura do Asaas mostram", () => {
  assert.match(textoParcelas(parcelamento(299.9, 1, R)), /^à vista: R\$\s299,90$/);
  assert.match(textoParcelas(parcelamento(299.9, 6, R)), /^6x de R\$\s49,98 sem juros$/);
  assert.match(textoParcelas(parcelamento(299.9, 7, R)), /^7x de R\$\s48,12 · total R\$\s336,84$/);
  assert.match(descricaoDaCompra("Autônomo", "YEARLY", parcelamento(299.9, 7, R), R), /plano Autônomo \(anual\), 7x de R\$\s48,12 \(total R\$\s336,84; juros de 2,99% a\.m\.\)/);
  assert.equal(cicloDe("anual"), "YEARLY");
  assert.equal(cicloDe(" Semestral "), "SEMIANNUALLY");
  assert.equal(cicloDe("MONTHLY"), "MONTHLY");
  assert.equal(cicloDe("bimestral"), null);
  assert.equal(somarMeses("2026-11-05", 12), "2027-11-05");
  assert.equal(somarMeses("2026-08-31", 6), "2027-02-28");
  assert.equal(somarMeses("2026-01-31", 1), "2026-02-28");
  assert.equal(somarMeses("2026-12-15", 1), "2027-01-15");
});

test("adesão (0044): padrão R$ 500, somada ao 1º pagamento, gravada e conferida", () => {
  assert.equal(regrasDe({}).adesao, 500, "sem nada gravado: R$ 500,00");
  assert.equal(regrasDe({ adesao_valor: "0" }).adesao, 0, "0 = sem adesão");
  assert.equal(regrasDe({ adesao_valor: "quebrado" }).adesao, 500, "valor quebrado: o padrão");
  assert.equal(regrasDe({ adesao_valor: "750.5" }).adesao, 750.5);
  assert.equal(regrasDe({ adesao_texto: "   " }).adesao_texto, TEXTO_ADESAO_PADRAO, "texto vazio: o padrão");
  const r = normalizarRegras({ adesao: "1200,40", adesao_texto: "  Implantação   e treinamento. " });
  assert.equal(r.adesao, 1200.4);
  assert.equal(r.adesao_texto, "Implantação e treinamento.");
  assert.deepEqual(regrasDe(configDasRegras(r)), r, "ida e volta pelo banco com a adesão");
  assert.equal(totalComAdesao(3598.8, 500), 4098.8);
  assert.equal(totalComAdesao(299.9, 0), 299.9);
  // o 1º pagamento parcela com a adesão junto: anual de R$ 299,90 + R$ 500 em 6x sem juros
  const p6 = parcelamento(totalComAdesao(3598.8, 500), 6, R);
  assert.deepEqual([p6.total, p6.juros], [4098.8, false]);
  assert.match(problemaDasRegras({ ...configDasRegras(R), adesao: "-1" }), /adesão vai de/);
  assert.match(problemaDasRegras({ ...configDasRegras(R), adesao: "99999" }), /adesão vai de/);
  assert.match(problemaDasRegras({ ...configDasRegras(R), adesao: "10.555" }), /centavos/);
  assert.match(problemaDasRegras({ ...configDasRegras(R), adesao_texto: "x".repeat(501) }), /no máximo 500/);
  assert.match(descricaoDaCompra("Autônomo", "YEARLY", parcelamento(4098.8, 1, R), R, 500), /plano Autônomo \(anual\) \+ adesão de R\$\s500,00 \(uma vez só\)$/);
});
