// Rua aberta pela borda da quadra do operador (27/11/2026). Relato do Wilker: fez a quadra
// pela seleção dos pontos (Gerar quadra; o resto da terra ficou rosa) e abriu a rua clicando
// esses mesmos pontos. A quadra "bugou" (a rua centrada no traço comeu meia largura dos
// lotes) e do outro lado da rua o sistema loteou uma quadra que ninguém definiu.
// O que se prova aqui:
//  - traço pela borda dos lotes: a rua vai para o lado sem lote e a quadra fica como está;
//  - a terra sem lote do outro lado continua livre (rosa), sem lote gerado pelo sistema;
//  - traço por dentro dos lotes ou longe deles continua centrado;
//  - mesmo com a rua centrada cortando os lotes, o pedaço sem lote não é loteado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PARAMETROS_PADRAO, completarFaixas, projetoNovo } from "../src/lib/loteamento/modelo.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { adicionarRua } from "../src/lib/loteamento/acoes.ts";
import { ladoLivreDaRua, manterLotesComRuaNova } from "../src/lib/loteamento/prancheta.ts";
import { areaPol, dentroPol, intersecao } from "../src/lib/loteamento/geom.ts";
import { paraPlano } from "../src/lib/loteamento/plano.ts";

const E0 = 465000, N0 = 8720000;
const U = ([x, y]) => [E0 + x, N0 + y];
const rel = [[0, 0], [60, 0], [60, 140], [0, 140]];
const GLEBA = { pts: rel.map(U), altitudes: rel.map(() => 340), confrontantes: rel.map(() => "VIZINHO") };
const calc = (p) => calcular(p, GLEBA);

/** Rua 01 na beira esquerda, Rua 05 em cima; a quadra do operador tem 2 fileiras de 3 lotes
 * entre y=55 (os pontos P11–P12) e a Rua 05; abaixo de y=55 é área livre (rosa). */
function projeto() {
  const pr = projetoNovo("RUA NA BORDA", 4);
  pr.params = completarFaixas({ ...PARAMETROS_PADRAO, frente: 7, profundidade: 20, areaMin: 125, frenteMin: 5.6, ruaLargura: 10, ruaPista: 7, pctVerdeMin: 0, pctInstitucionalMin: 0, distanciasTerreno: false }, { frente: 7, profundidade: 20 });
  pr.ruas = [
    { id: "r1", nome: "Rua 01", largura: 10, eixo: [U([5, -10]), U([5, 150])] },
    { id: "r5", nome: "Rua 05", largura: 10, eixo: [U([0, 110]), U([65, 110])] },
  ];
  const lotes = [];
  for (const [t0, t1] of [[55, 80], [80, 105]]) for (let k = 0; k < 3; k++) {
    const s0 = 10 + (k * 50) / 3, s1 = 10 + ((k + 1) * 50) / 3;
    lotes.push({ anel: [U([s0, t0]), U([s1, t0]), U([s1, t1]), U([s0, t1])] });
  }
  pr.quadras = [{ ancora: U([30, 70]), ajustes: [], lotes }];
  pr.gerado = true;
  return pr;
}

/** Abre a rua como o Editor: lado "centro" passa pelo ladoLivreDaRua. */
function abrir(pr0, r0, tracoRel, ladoPedido = "centro") {
  const traco = tracoRel.map(U);
  // "fixa" = rua centrada no traço sem a escolha automática do lado
  const lado = ladoPedido === "centro" ? ladoLivreDaRua(r0, traco.map((p) => paraPlano(r0.plano, p)), pr0.params.ruaLargura) : ladoPedido === "fixa" ? undefined : ladoPedido;
  const { pr: pRua } = adicionarRua(pr0, traco, undefined, lado);
  const m = manterLotesComRuaNova(pr0, r0, pRua, calc);
  return { lado, m, r: calc(m.pr) };
}

const lotesAbaixo = (r, y) => r.lotes.filter((l) => {
  const c = l.pol.ext.reduce((s, p) => [s[0] + p[0] / l.pol.ext.length, s[1] + p[1] / l.pol.ext.length], [0, 0]);
  return c[1] < paraPlano(r.plano, U([30, y]))[1];
});
const debaixoDaRua = (r, id) => {
  const rua = r.ruas.find((x) => x.id === id);
  return r.lotes.reduce((s, l) => s + intersecao([l.pol], rua.pols).reduce((a, x) => a + areaPol(x), 0), 0);
};

test("rua traçada pelos pontos da borda da quadra: vai para o lado livre e a quadra fica", () => {
  const pr0 = projeto();
  const r0 = calc(pr0);
  assert.equal(lotesAbaixo(r0, 55).length, 0, "antes da rua, abaixo dos pontos é área livre");
  const antes = r0.quadras.find((q) => q.cfg === 0).lotes.map((l) => l.area).sort((a, b) => a - b);
  // o traço sai da Rua 01 e corre exatamente por y=55 (a frente dos lotes de baixo)
  const { lado, m, r } = abrir(pr0, r0, [[0, 55], [65, 55]]);
  assert.equal(lado, "direita", "a rua devia ir para o lado sem lote");
  assert.ok(debaixoDaRua(r, r.ruas[r.ruas.length - 1].id) < 0.05, "a rua comeu lote");
  // a quadra do operador continua com os mesmos 6 lotes (só a esquina nova com a Rua 01 arredonda)
  const q = r.quadras.find((x) => x.lotes.some((l) => dentroPol(paraPlano(r.plano, U([30, 70])), l.pol)));
  assert.equal(q.lotes.length, 6);
  const depois = q.lotes.map((l) => l.area).sort((a, b) => a - b);
  antes.forEach((a, i) => assert.ok(Math.abs(a - depois[i]) < 10, `lote mudou de ${a.toFixed(1)} para ${depois[i].toFixed(1)} m²`));
  assert.equal(r.problemas.filter((p) => /5 quinas|sobrepos/.test(p.texto)).length, 0);
  // do outro lado: nenhum lote gerado, a terra fica livre (rosa)
  assert.equal(lotesAbaixo(r, 45).length, 0, "o sistema loteou a terra que o operador não definiu como quadra");
  assert.equal(m.vazias, 1);
  const rosa = r.sobras.filter((s) => dentroPol(paraPlano(r.plano, U([30, 20])), s));
  assert.equal(rosa.length, 1, "o pedaço de baixo devia aparecer como área livre");
});

test("rua de propósito por dentro dos lotes ou longe deles continua centrada", () => {
  const pr0 = projeto();
  const r0 = calc(pr0);
  const pl = (xs) => xs.map((p) => paraPlano(r0.plano, U(p)));
  // pela divisa entre as duas fileiras: os dois lados pegam lote
  assert.equal(ladoLivreDaRua(r0, pl([[0, 80], [65, 80]]), 10), undefined);
  // no meio da área livre, longe dos lotes
  assert.equal(ladoLivreDaRua(r0, pl([[0, 25], [65, 25]]), 10), undefined);
  // pela frente dos lotes de baixo, na outra direção: lado esquerdo
  assert.equal(ladoLivreDaRua(r0, pl([[65, 55], [0, 55]]), 10), "esquerda");
});

test("rua centrada cortando os lotes: o pedaço sem lote do outro lado também fica livre", () => {
  const pr0 = projeto();
  const r0 = calc(pr0);
  const { m, r } = abrir(pr0, r0, [[0, 55], [65, 55]], "fixa");
  assert.ok(m.cortados >= 3, "a rua centrada corta os lotes de baixo");
  assert.equal(lotesAbaixo(r, 45).length, 0, "o sistema loteou a terra que o operador não definiu como quadra");
  assert.equal(r.lotes.filter((l) => dentroPol(paraPlano(r.plano, U([30, 70])), l.pol) || dentroPol(paraPlano(r.plano, U([30, 95])), l.pol)).length, 2);
});
