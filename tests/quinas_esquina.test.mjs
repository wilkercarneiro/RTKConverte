// Etapa 0 do plano da linha central: o arco (e o chanfro) da esquina é UMA quina,
// a esquina é decidida pelo encontro de duas ruas, a testada vai até o PI e o
// memorial separa a curva. (docs/plano-linha-central.md)
import { test } from "node:test";
import assert from "node:assert/strict";
import { quinasDetalhe, quinas, quinasAviso } from "../src/lib/loteamento/geom.ts";
import { frenteDoLote } from "../src/lib/loteamento/calculo.ts";
import { ladosRetos } from "../src/lib/loteamento/edicao.ts";
import { ladosNominais, resumoLote } from "../src/lib/loteamento/saidas.ts";

const arco = (c, r, a0, a1, passos) => Array.from({ length: passos + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / passos; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
/** lote 12 × 25 de esquina (frente em y = 0, rua lateral em x = 0), canto arredondado com raio R */
function loteEsquina(R, passos, w = 12, h = 25) {
  return [...arco([R, R], R, Math.PI, 1.5 * Math.PI, passos), [w, 0], [w, h], [0, h]];
}

test("quinas: arco de esquina conta UMA quina, com o PI no cruzamento das tangentes", () => {
  for (const [R, passos] of [[6, 9], [15, 6], [9, 3]]) {
    const q = quinasDetalhe(R > 10 ? loteEsquina(R, passos, 30, 40) : loteEsquina(R, passos));
    assert.equal(q.length, 4, `raio ${R} com ${passos} cordas`);
    const a = q.find((x) => x.arco);
    assert.ok(a, "achou o arco");
    assert.ok(Math.abs(Math.abs(a.giro) - 90) < 0.5, `giro ${a.giro}`);
    assert.ok(Math.hypot(a.pi[0], a.pi[1]) < 1e-6, `PI em (0,0): ${a.pi}`);
    assert.ok(Math.abs(a.raio - R) < 0.15 * R, `raio ${a.raio} ≈ ${R}`);
  }
  // a regra antiga errava no arco de cordas longas (raio 15, cordas de 3,9 m): cada vértice do arco virava quina
  assert.equal(quinas(loteEsquina(15, 6, 30, 40)), 8);
});

test("quinas: chanfro é uma quina; canto com dobra vizinha são duas; curva aberta não é quina", () => {
  // chanfro de 3 m (dois cantos de 45°)
  const chanfro = [[0, 3], [3, 0], [12, 0], [12, 25], [0, 25]];
  assert.equal(quinasDetalhe(chanfro).length, 4);
  assert.equal(quinas(chanfro), 5, "a regra antiga contava duas");
  assert.equal(quinasAviso(chanfro), 4, "o aviso não acusa mais 5 quinas no chanfro");
  // canto de 90° e, a 3 m dele, a rua dobra 20°: são duas quinas (o lote tem 5)
  const r = 3 / Math.tan((20 * Math.PI) / 180);
  void r;
  const dobra = [[0, 0], [3, 0], [3 + 9 * Math.cos((20 * Math.PI) / 180), 9 * Math.sin((20 * Math.PI) / 180)], [12, 25], [0, 25]];
  assert.equal(quinasDetalhe(dobra).length, 5);
  // frente numa estrada que faz curva longa (raio 200 m, pontos a 1,9 m): nenhuma quina na frente
  const curva = arco([6, 200], 200, -Math.PI / 2 - 0.03, -Math.PI / 2 + 0.03, 6).map(([x, y]) => [x, y]);
  const lote = [...curva, [curva[curva.length - 1][0], 25], [curva[0][0], 25]];
  assert.equal(quinasDetalhe(lote).length, 4);
});

test("esquina: duas ruas que se encontram numa quina; estrada que dobra e lote de rua a rua não são", () => {
  const esq = loteEsquina(6, 9);
  const n = esq.length;
  // frentes: o arco + o lado de baixo (y = 0) e o lado da esquerda (x = 0)
  const ruas = [];
  for (let i = 0; i < n; i++) { const a = esq[i], b = esq[(i + 1) % n]; if (Math.abs(a[1]) < 1e-6 && Math.abs(b[1]) < 1e-6) ruas.push({ a, b }); else if (Math.abs(a[0]) < 1e-6 && Math.abs(b[0]) < 1e-6) ruas.push({ a, b }); else if (i < 9) ruas.push({ a, b }); }
  const f = frenteDoLote({ ext: esq, furos: [] }, ruas);
  assert.equal(f.esquina, true);
  // testada: a corrida maior (lado da esquerda, de 6 a 25 = 19 m) + 6 m até o PI
  assert.ok(Math.abs(f.testada - 25) < 0.01, `testada ${f.testada}`);
  // estrada que dobra 20° no meio da frente: não é esquina
  const est = [[0, 0], [6, 0], [12, 12 * Math.tan((20 * Math.PI) / 180) - 6 * Math.tan((20 * Math.PI) / 180)], [12, 25], [0, 25]];
  assert.equal(frenteDoLote({ ext: est, furos: [] }, [{ a: est[0], b: est[1] }, { a: est[1], b: est[2] }]).esquina, false);
  // lote de rua a rua (frente embaixo, fundo para outra rua em cima): não é esquina; testada é a frente
  const rr = [[0, 0], [12, 0], [12, 30], [0, 30]];
  const g = frenteDoLote({ ext: rr, furos: [] }, [{ a: rr[0], b: rr[1] }, { a: rr[2], b: rr[3] }]);
  assert.equal(g.esquina, false);
  assert.ok(Math.abs(g.testada - 12) < 1e-9);
});

test("ferramenta Frente: no lote de esquina, as duas ruas do lado do arco são lados clicáveis", () => {
  const esq = loteEsquina(6, 9);
  const ls = ladosRetos({ ext: esq, furos: [] });
  const tem = (a, b) => ls.some(([p, q]) => (Math.hypot(p[0] - a[0], p[1] - a[1]) < 1e-6 && Math.hypot(q[0] - b[0], q[1] - b[1]) < 1e-6) || (Math.hypot(p[0] - b[0], p[1] - b[1]) < 1e-6 && Math.hypot(q[0] - a[0], q[1] - a[1]) < 1e-6));
  assert.ok(tem([6, 0], [12, 0]), "rua de baixo, do PT do arco até a divisa");
  assert.ok(tem([0, 25], [0, 6]), "rua da esquerda, até o PC do arco");
  assert.equal(ls.length, 4);
});

test("memorial: o lote de esquina é frente, laterais e fundos; a curva sai à parte", () => {
  const esq = loteEsquina(6, 9);
  const n = esq.length;
  const lados = [];
  for (let i = 0; i < n; i++) {
    const a = esq[i], b = esq[(i + 1) % n];
    const naRuaB = Math.abs(a[1]) < 1e-6 && Math.abs(b[1]) < 1e-6;
    const naRuaE = Math.abs(a[0]) < 1e-6 && Math.abs(b[0]) < 1e-6;
    const tipo = naRuaB || naRuaE || i < 9 ? "rua" : "lote";
    lados.push({ a, b, comp: Math.hypot(b[0] - a[0], b[1] - a[1]), tipo, ref: naRuaE ? "r2" : "r1", nome: naRuaE || (i < 9 && i >= 0 && !naRuaB && a[0] < 1) ? "Rua 2" : tipo === "rua" ? "Rua 1" : "Lote 2" });
  }
  // a frente principal é a rua da esquerda (a mais longa)
  const l = { lados, pol: { ext: esq, furos: [] } };
  const g = ladosNominais(l);
  assert.equal(g.curva.length, 9, "as 9 cordas do arco");
  for (const k of ["frente", "direito", "fundos", "esquerdo"]) assert.equal(g[k].length, 1, k);
  assert.ok(Math.abs(g.frente[0].comp - 19) < 1e-6, "frente sem o arco");
  const r = resumoLote(l);
  assert.match(r.curva, /desenvolvimento/);
  assert.ok(Math.abs(r.medidas[0] - 19) < 1e-6);
});
