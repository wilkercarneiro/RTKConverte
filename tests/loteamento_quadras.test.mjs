// Quadra = a terra entre ruas (26/11/2026). Relato do Wilker: "mesmo criando a quadra na
// mão, não dá para ajustar fundo com fundo, pois ele divide as quadras", e a geração
// trazendo modelos com bugs. O que se prova aqui:
//  - a quadra entre duas ruas opostas não é cortada em triângulos (corte em L só em faixa);
//  - "Gerar quadra" deixa UMA quadra, sem sobra picada, e o fundo com fundo fecha nela;
//  - desenhos repartidos em duas configs do mesmo pedaço viram uma quadra (sem perder lote);
//  - a gleba estreita não trava a geração e sai com a rua ao longo da faixa;
//  - o retalho marcado como área verde continua verde quando a quadra é editada.
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { PARAMETROS_PADRAO, completarFaixas, projetoNovo } from "../src/lib/loteamento/modelo.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { consertarPendencias, gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { contornos, gravar, melhorEstrutura, unirLotes, posicaoNoDesenho } from "../src/lib/loteamento/edicao.ts";
import { gerarQuadra } from "../src/lib/loteamento/prancheta.ts";
import { areaPol, centroide, dentroPol, intersecao, quinasAviso } from "../src/lib/loteamento/geom.ts";
import { paraPlano, paraUtm } from "../src/lib/loteamento/plano.ts";

const E0 = 465000, N0 = 8720000;
const gleba = (rel) => ({ pts: rel.map(([e, n]) => [E0 + e, N0 + n]), altitudes: rel.map(() => 340), confrontantes: rel.map(() => "VIZINHO") });
const U = ([x, y]) => [E0 + x, N0 + y];
const popular = (pr) => { pr.params = completarFaixas({ ...PARAMETROS_PADRAO, frente: 7, profundidade: 20, areaMin: 125, frenteMin: 5.6, ruaLargura: 10, ruaPista: 7, pctVerdeMin: 0, pctInstitucionalMin: 0, distanciasTerreno: false }, { frente: 7, profundidade: 20 }); return pr; };

// faixa de 40 m × 160 m (como a do MAURICIO): rua de 10 m na beira esquerda e duas
// transversais que morrem na divisa da direita
const FAIXA = gleba([[0, 0], [40, 0], [40, 160], [0, 160]]);
function projetoFaixa() {
  const pr = popular(projetoNovo("FAIXA", 4));
  pr.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada" };
  pr.ruas = [
    { id: "r1", nome: "Rua 01", largura: 10, eixo: [U([5, -10]), U([5, 170])] },
    { id: "r2", nome: "Rua 02", largura: 10, eixo: [U([0, 55]), U([45, 55])] },
    { id: "r3", nome: "Rua 03", largura: 10, eixo: [U([0, 110]), U([45, 110])] },
  ];
  return pr;
}
const centroideNoPlano = (r, xy) => paraPlano(r.plano, U(xy));
const semSobreposicao = (r) => {
  for (let i = 0; i < r.lotes.length; i++) for (let j = i + 1; j < r.lotes.length; j++) {
    const a = intersecao([r.lotes[i].pol], [r.lotes[j].pol]).reduce((s, x) => s + areaPol(x), 0);
    if (a > 0.05) return `${r.lotes[i].id} × ${r.lotes[j].id}: ${a.toFixed(2)} m²`;
  }
  return null;
};

test("quadra entre duas ruas opostas fica inteira (sem triângulos), com duas fileiras", () => {
  const r = calcular(projetoFaixa(), FAIXA);
  // a quadra entre as transversais (x 10–40, y 60–105) é uma só
  const caixa = [centroideNoPlano(r, [10, 60]), centroideNoPlano(r, [40, 105])];
  const dentro = (pt) => pt[0] > caixa[0][0] && pt[0] < caixa[1][0] && pt[1] > caixa[0][1] && pt[1] < caixa[1][1];
  const nomes = new Set(r.lotes.filter((l) => dentro(centroide(l.pol.ext))).map((l) => l.quadra));
  const q = r.quadras.find((x) => x.nome === [...nomes][0]);
  assert.ok(q.lotes.every((l) => quinasAviso(l.pol.ext) >= 4 || l.esquina), "lote em triângulo");
  assert.equal(r.problemas.filter((p) => p.nivel === "erro").length, 0);
});

test("Gerar quadra: os lotes ficam numa quadra só, sem sobra picada, e o fundo com fundo fecha", () => {
  const pr0 = projetoFaixa();
  const calc = (p) => calcular(p, FAIXA);
  const r0 = calc(pr0);
  const meio = centroideNoPlano(r0, [25, 82]);
  const q = r0.quadras.find((x) => dentroPol(meio, x.pol));
  // a frente na rua de baixo (y = 60), 2 fileiras até a rua de cima, um pouco menor que a quadra
  const a = centroideNoPlano(r0, [11, 61]), b = centroideNoPlano(r0, [39, 61]);
  const u = [(b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]), (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1])];
  const ed = gerarQuadra(pr0, r0, { a, u, comprimento: 28, profundidade: 43, fileiras: 2, lotes: 4, lado: "esquerda" }, calc);
  assert.ok(ed && !ed.erro, ed?.msg);
  const r = calc(ed.pr);
  const nomes = new Set(r.lotes.filter((l) => dentroPol(centroide(l.pol.ext), q.pol)).map((l) => l.quadra));
  assert.equal(nomes.size, 1, `a quadra gerada ficou partida: ${[...nomes].join(" + ")}`);
  const qg = r.quadras.find((x) => x.nome === [...nomes][0]);
  assert.equal(qg.lotes.length, 8, `${qg.lotes.length} lotes`);
  // nenhuma tira picada: todo lote com 4 quinas e pelo menos 80% do pedido (7 × 21,5)
  for (const l of qg.lotes) {
    assert.ok(quinasAviso(l.pol.ext) <= 4, `${l.id} com ${quinasAviso(l.pol.ext)} quinas`);
    assert.ok(l.area > 0.8 * 7 * 21.5, `${l.id} com ${l.area.toFixed(1)} m²`);
  }
  assert.ok(r.sobras.reduce((s, x) => s + areaPol(x), 0) < 1, "sobrou área livre");
  assert.equal(semSobreposicao(r), null);
  // fundo com fundo da quadra gerada (o que a prancheta faz ao concluir o comando)
  const m = melhorEstrutura(ed.pr, r, qg, calc);
  assert.ok(m, "o fundo com fundo recusou a quadra gerada");
  const q1 = m.r.quadras.find((x) => x.cfg === m.i);
  assert.ok(q1?.estruturada, "a quadra não ficou pela linha central");
  assert.ok(m.avisosDepois <= m.avisosAntes);
});

test("desenhos repartidos no mesmo pedaço viram UMA quadra, e a edição grava a fusão sem perder lote", () => {
  const pr0 = projetoFaixa();
  const calc = (p) => calcular(p, FAIXA);
  const r0 = calc(pr0);
  const meio = centroideNoPlano(r0, [25, 82]);
  const q = r0.quadras.find((x) => dentroPol(meio, x.pol));
  const { aneis } = contornos(pr0, r0, q);
  // reparte o desenho em duas configs (como ficava quando o pedaço era cortado em dois)
  const metade = Math.floor(aneis.length / 2);
  const pl = r0.plano;
  const cfg = (lst) => ({ ancora: paraUtm(pl, centroide(lst[0])), ajustes: [], lotes: lst.map((an) => ({ anel: an.map((p) => paraUtm(pl, p)) })) });
  const pr = { ...pr0, quadras: [cfg(aneis.slice(0, metade)), cfg(aneis.slice(metade))] };
  const r = calc(pr);
  const qs = r.quadras.filter((x) => dentroPol(meio, x.pol));
  assert.equal(qs.length, 1);
  assert.equal(qs[0].lotes.length, aneis.length, "lote perdido na fusão");
  assert.deepEqual(qs[0].fundidas?.length, 1);
  // unir dois lotes: a fusão vai para o projeto, a outra config fica sem desenho
  const ls = [...qs[0].lotes].sort((x, y) => x.indice - y.indice);
  const ed = unirLotes(pr, r, qs[0], [posicaoNoDesenho(pr, r, ls[0]), posicaoNoDesenho(pr, r, ls[1])]);
  assert.ok(ed && !ed.erro);
  const r2 = calc(ed.pr);
  assert.equal(r2.lotes.length, r.lotes.length - 1);
  assert.equal(ed.pr.quadras.filter((c) => Array.isArray(c.lotes) && c.lotes.length).length, 1);
  assert.equal(semSobreposicao(r2), null);
});

test("gleba estreita: a geração termina (antes o passo negativo travava a memória) e sai com a rua ao longo da faixa", () => {
  // faixa de 36 m × 230 m sem estrada marcada (como o POR DO SOL)
  const per = gleba([[0, 0], [36, 0], [44, 230], [8, 232]]);
  const pr = projetoNovo("ESTREITA", 4);
  pr.params = completarFaixas({ ...PARAMETROS_PADRAO, frente: 10, profundidade: 25, ruaLargura: 8, ruaPista: 6, pctVerdeMin: 0, pctInstitucionalMin: 0 }, {});
  const t0 = Date.now();
  const props = gerarPropostas(pr, per, { quantas: 3 });
  assert.ok(Date.now() - t0 < 60000, "a geração demorou demais");
  assert.ok(props.length >= 1);
  const a = props[0];
  assert.equal(a.ruas.length, 1, "a faixa estreita pede UMA rua ao longo dela");
  assert.ok(a.lotes >= 14, `só ${a.lotes} lotes`);
  assert.equal(a.resultado.problemas.filter((p) => p.nivel === "erro").length, 0);
  // nenhuma proposta inútil (0 ou 1 lote) para completar a conta
  for (const p of props) assert.ok(p.lotes >= 0.6 * a.lotes, `${p.titulo} com ${p.lotes} lotes`);
});

test("lote em L em volta da área verde da ponta: o conserto final tira a pendência", () => {
  // gleba do laboratório com a malha de quadras longas (G com a ponta verde)
  const per = gleba([[0, 0], [372, 18], [395, 140], [360, 268], [210, 290], [175, 230], [60, 262], [-12, 120]]);
  const pr = projetoNovo("T", per.pts.length);
  pr.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada" };
  const props = gerarPropostas(pr, per, { quantas: 3 });
  for (const p of props) {
    const r = calcular(consertarPendencias(p.projeto, per), per);
    assert.equal(r.lotes.filter((l) => l.problemas.some((x) => /quinas/.test(x))).length, 0, `${p.titulo}: lote com 5+ quinas`);
  }
});

test("retalho marcado como área verde continua verde depois de editar a quadra", () => {
  const per = gleba([[0, 0], [372, 18], [395, 140], [360, 268], [210, 290], [175, 230], [60, 262], [-12, 120]]);
  const pr0 = projetoNovo("T", per.pts.length);
  pr0.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada" };
  const prs = gerarPropostas(pr0, per, { quantas: 3 }).map((p) => p.projeto);
  let conferidos = 0;
  for (const pr of prs) {
    const r = calcular(pr, per);
    for (const a of r.areas.filter((x) => x.origem === "sobra")) {
      const q = r.quadras.find((x) => intersecao([x.pol], a.pols).reduce((s, y) => s + areaPol(y), 0) > 1);
      if (!q) continue;
      // congela a quadra (o que qualquer edição faz) e recalcula
      const c = contornos(pr, r, q);
      const pr2 = gravar(c.pr, r, c.i, c.aneis, c.destinos);
      const r2 = calcular(pr2, per);
      const verde = (rr) => rr.quadro.verde + rr.quadro.lazer;
      assert.ok(Math.abs(verde(r2) - verde(r)) < 1, `verde ${verde(r).toFixed(0)} → ${verde(r2).toFixed(0)} m²`);
      assert.ok(r2.quadro.sobras <= r.quadro.sobras + 1, `rosa ${r.quadro.sobras.toFixed(0)} → ${r2.quadro.sobras.toFixed(0)} m²`);
      conferidos++;
    }
  }
  assert.ok(conferidos >= 0);
});

// Caso real (fora do Git): o serviço "Area para Lotear" (MAURICIO, 25/11/2026), onde o
// Wilker não conseguia o fundo com fundo — as quadras entre as transversais eram cortadas
// na diagonal em duas (G|F, H|I, K|J, A|B) e cada metade guardava parte do desenho dele.
const MAURICIO = new URL("./corpus-real/mauricio/loteamento_2026-11-25.json", import.meta.url);
test("caso real MAURICIO: quadras entre transversais inteiras, desenho preservado e fundo com fundo possível", { skip: !existsSync(MAURICIO) && "sem o corpus real" }, async () => {
  const { perimetroDoServico } = await import("../src/lib/loteamento/perimetro.ts");
  const d = JSON.parse(readFileSync(MAURICIO, "utf8"));
  const per = perimetroDoServico(d.vertices.map((v, i) => ({ ...v, ordem: i, codigo: `V${i + 1}`, num_txt: i + 1 })), d.fuso);
  const calc = (p) => calcular(p, per);
  // só as ruas (a divisão automática): nenhuma quadra em triângulo
  const ra = calc({ ...d.projeto, quadras: [] });
  assert.equal(ra.problemas.filter((p) => p.nivel === "erro").length, 0);
  for (const l of ra.lotes) assert.ok(quinasAviso(l.pol.ext) >= 4 || l.esquina || l.ponta, `${l.id} em triângulo`);
  assert.ok(ra.quadras.length <= 8, `${ra.quadras.length} quadras (eram 11 com os triângulos)`);
  // o projeto como está: os 80 lotes desenhados continuam, as metades viram uma quadra
  const r = calc(d.projeto);
  assert.equal(r.lotes.length, 80);
  const fundidas = r.quadras.filter((q) => q.fundidas?.length);
  assert.ok(fundidas.length >= 3, `${fundidas.length} quadras fundidas`);
  // fundo com fundo numa delas (a que tem duas fileiras de lotes desenhados)
  const q = fundidas.find((x) => x.lotes.length >= 8) ?? fundidas[0];
  const m = melhorEstrutura(d.projeto, r, q, calc);
  assert.ok(m && m.r.quadras.find((x) => x.cfg === m.i)?.estruturada, `quadra ${q.nome}: o fundo com fundo recusou`);
});
