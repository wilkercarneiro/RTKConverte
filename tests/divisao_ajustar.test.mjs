// "Ajustar lotes" da prancheta da divisão (DivisaoEditor.ajustarLotes): depois
// que o operador arrasta as divisas à mão, um clique deixa todas as partes do
// mesmo tamanho SEM refazer o desenho — o comando "area" do loteamento com
// todas as partes menos a última selecionadas (a última fica com o resto).
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { sugerirDivisoes } from "../src/lib/divisao.ts";
import { entradaDoServico, publicadorUtm } from "../src/lib/divisao_servico.ts";
import { anelBruto, limparAvisos, perimetroDaDivisao, projetoDaDivisao } from "../src/lib/divisao_prancheta.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { alcasDoLote, moverDivisa } from "../src/lib/loteamento/edicao.ts";
import { chaveDoLote, executar } from "../src/lib/loteamento/acoes.ts";
import { linhasBalanceadas } from "../src/lib/grade.ts";
import { ANEL } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const vertices = ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tl]) => ({
  id: `v${ordem}`, servico_id: "s", ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 360, sigma_pos: 0.01, sigma_h: 0.01,
  tipo, codigo, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "",
  descritivo: tipo === "M" ? (descritivo || `FAZENDA VIZINHA ${ordem}`) : null,
  tipo_limite: tipo === "M" ? (tl ?? "LA1") : null, eh_via: tl === "LA3", cns: null, matricula: null, apelido_txt: null, numerado: false, exibir_planta: true,
}));

for (const n of [3, 4]) {
  test(`ajustar lotes · ${n} partes desiguais à mão voltam ao mesmo tamanho (desenho mantido ou motor)`, () => {
    const ent = entradaDoServico(vertices, Array(n).fill(1), false, publicadorUtm(24, proj4));
    const per = perimetroDaDivisao(ent);
    const r = sugerirDivisoes(ent)[0];
    let pr = projetoDaDivisao(ent, r.partes.map((p) => anelBruto(ent, p)), "TESTE");
    let res = limparAvisos(calcular(pr, per), true);
    // bagunça: arrasta a primeira divisa 25 m
    const q = res.quadras[0];
    const div = alcasDoLote(res.lotes[0], q).filter((a) => a.tipo !== "quina" && !a.naBorda);
    pr = moverDivisa(pr, res, q, div[0].a, div[0].b, 25, false, 0).pr;
    res = limparAvisos(calcular(pr, per), true);
    const ls = [...res.lotes].sort((a, b) => a.numero - b.numero);
    const total = ls.reduce((s, l) => s + l.area, 0);
    const alvo = total / n;
    assert.ok(Math.max(...ls.map((l) => Math.abs(l.area - alvo))) > 50, "o arraste deixou as partes desiguais");

    // 1º caminho (mantém o desenho): o "area" do loteamento. Sem frente para
    // estrada ele nem sempre fecha — a tela só aceita com diferença < 1 m².
    const s = executar(`area ${alvo.toFixed(2)}`, pr, res, { tipo: "lotes", chaves: ls.slice(0, -1).map(chaveDoLote) });
    const r2 = s.pr ? limparAvisos(calcular(s.pr, per), true) : null;
    const pior = r2 ? Math.max(...r2.lotes.map((l) => Math.abs(l.area - alvo))) : Infinity;
    if (pior < 1) return;
    // 2º caminho: o motor na mesma direção — sempre iguais
    const de = sugerirDivisoes(ent).find((x) => Math.abs(x.azimute - r.azimute) < 1e-6) ?? r;
    const pr3 = projetoDaDivisao(ent, de.partes.map((p) => anelBruto(ent, p)), "TESTE");
    const r3 = limparAvisos(calcular(pr3, per), true);
    const total3 = r3.lotes.reduce((a, l) => a + l.area, 0);
    const pior3 = Math.max(...r3.lotes.map((l) => Math.abs(l.area - total3 / n)));
    assert.ok(pior3 < 1, `motor: maior diferença ${pior3} m²`);
  });
}

test("grade balanceada · nenhuma linha com um campo sozinho", () => {
  assert.deepEqual(linhasBalanceadas(7, 6), [4, 3]); // Dados do serviço: o UF não fica sozinho
  assert.deepEqual(linhasBalanceadas(7, 3), [3, 2, 2]);
  assert.deepEqual(linhasBalanceadas(6, 4), [3, 3]);
  assert.deepEqual(linhasBalanceadas(5, 2), [2, 2, 1]); // 2 colunas e ímpar: o último é inevitável
  assert.deepEqual(linhasBalanceadas(3, 6), [3]);
  for (let n = 2; n <= 12; n++) for (let m = 3; m <= 6; m++) {
    const l = linhasBalanceadas(n, m);
    assert.equal(l.reduce((a, b) => a + b, 0), n);
    assert.ok(Math.max(...l) - Math.min(...l) <= 1, `${n} em ${m}: ${l}`);
    if (n > 1 && m >= 3) assert.ok(Math.min(...l) >= 2 || l.length === 1 || n <= 3, `${n} em ${m}: linha com um só (${l})`);
  }
});
