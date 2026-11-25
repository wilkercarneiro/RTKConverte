// Pedidos do Wilker de 25/11/2026 no loteamento: medidas que se recalculam, geração
// harmônica (faixa da borda no esquadro, 3 propostas distintas), rua que não redesenha
// o loteamento e que pode ficar de um lado do traço, giro das divisas, gerar quadra,
// divisa travada no fundo com fundo e pontos de referência.
import { test } from "node:test";
import assert from "node:assert/strict";
import { perimetro } from "./fixtures/loteamento_gleba.mjs";
import { PARAMETROS_PADRAO, editarMedidas, projetoNovo } from "../src/lib/loteamento/modelo.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { adicionarRua, executar } from "../src/lib/loteamento/acoes.ts";
import { alcasDoLote, moverDivisaTravada, posicaoNoDesenho } from "../src/lib/loteamento/edicao.ts";
import { adicionarReferencia, eixosDoLote, gerarQuadra, girarLotes, lotesDaQuadra, manterLotesComRuaNova, pontoNaDistancia, removerReferencia, travarNoEixo } from "../src/lib/loteamento/prancheta.ts";
import { areaPol, centroide, eixoDoTraco, intersecao, quinasDe } from "../src/lib/loteamento/geom.ts";
import { paraUtm } from "../src/lib/loteamento/plano.ts";

const calc = (p) => calcular(p, perimetro);
const base = () => { const pr = projetoNovo("T", perimetro.pts.length); pr.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada" }; return pr; };
const pr0 = gerarPropostas(base(), perimetro, { quantas: 1, estruturar: false })[0].projeto;
const r0 = calc(pr0);
const sobreposicao = (r) => {
  let s = 0;
  for (let i = 0; i < r.lotes.length; i++) for (let j = i + 1; j < r.lotes.length; j++) {
    const a = r.lotes[i], b = r.lotes[j];
    if (Math.abs(a.pol.ext[0][0] - b.pol.ext[0][0]) > 80 || Math.abs(a.pol.ext[0][1] - b.pol.ext[0][1]) > 80) continue;
    s += intersecao([a.pol], [b.pol]).reduce((x, y) => x + areaPol(y), 0);
  }
  return s;
};

test("medidas: frente/profundidade mínimas e máximas recalculam as áreas (sempre, não só no valor derivado)", () => {
  let p = { ...PARAMETROS_PADRAO };
  p = editarMedidas(p, { frenteMin: 9 }).params;
  p = editarMedidas(p, { profundidadeMin: 20 }).params;
  assert.equal(p.areaMin, 180);
  p = editarMedidas(p, { frenteMax: 16 }).params;
  p = editarMedidas(p, { profundidadeMax: 35 }).params;
  assert.equal(p.areaMax, 560);
  p = editarMedidas(p, { frente: 12 }).params;
  assert.equal(p.areaPadrao, 12 * p.profundidade);
  // área digitada à mão manda até a próxima mudança de frente/profundidade
  p = editarMedidas(p, { areaMin: 190 }).params;
  assert.equal(p.areaMin, 190);
  p = editarMedidas(p, { frenteMin: 10 }).params;
  assert.equal(p.areaMin, 200);
});

test("geração: 3 propostas distintas; faixa da borda no esquadro da rua (sem lote em diagonal)", () => {
  const E0 = 491000, N0 = 8738800;
  const rel = [[0, 0], [300, 0], [300, 200], [0, 200]];
  const per = { pts: rel.map(([e, n]) => [E0 + e, N0 + n]), altitudes: rel.map(() => 300), confrontantes: rel.map(() => "V") };
  const pr = projetoNovo("R", 4);
  pr.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada" };
  const ps = gerarPropostas(pr, per, { quantas: 3 });
  assert.equal(ps.length, 3, "três propostas");
  const chaves = new Set(ps.map((x) => `${x.lotes}|${Math.round(x.areaLotes)}`));
  assert.equal(chaves.size, 3, "as três são diferentes");
  for (const x of ps) {
    const tortos = x.resultado.lotes.filter((l) => l.angCorte !== undefined && Math.abs(90 - l.angCorte) > 12).length;
    assert.ok(tortos <= 2, `${x.titulo}: ${tortos} lotes em diagonal`);
    assert.equal(x.resultado.problemas.filter((q) => q.nivel === "erro").length, 0, `${x.titulo} com pendência`);
  }
});

test("rua de um lado só: o eixo sai meia largura para a esquerda/direita do traço", () => {
  const traco = [[0, 0], [100, 0]];
  assert.deepEqual(eixoDoTraco(traco, "esquerda", 12).map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)), [[0, 6], [100, 6]]);
  assert.deepEqual(eixoDoTraco(traco, "direita", 12).map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)), [[0, -6], [100, -6]]);
  assert.equal(eixoDoTraco(traco, undefined, 12), traco);
});

test("rua nova não redesenha o loteamento: só os lotes no caminho mudam e nenhum fica sob a rua", () => {
  const q = [...r0.quadras].sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const l = q.lotes[0];
  const [, v] = eixosDoLote(l, q);
  const c = centroide(q.pol.ext);
  const P = [c[0] - v[0] * 120, c[1] - v[1] * 120], Q = [c[0] + v[0] * 120, c[1] + v[1] * 120];
  const { pr: pr1 } = adicionarRua(pr0, [P, Q].map((x) => paraUtm(r0.plano, x)), undefined, "esquerda");
  const auto = calc(pr1);
  const m = manterLotesComRuaNova(pr0, r0, pr1, calc);
  const r2 = calc(m.pr);
  const assin = (x) => x.pol.ext.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).sort().join(";");
  const s0 = new Set(r0.lotes.map(assin));
  const iguais = (r) => r.lotes.filter((x) => s0.has(assin(x))).length;
  assert.ok(iguais(r2) > iguais(auto), `mantém ${iguais(r2)} lotes (o recálculo automático manteria ${iguais(auto)})`);
  const nova = r2.ruas.find((x) => !r0.ruas.some((y) => y.id === x.id));
  const sob = r2.lotes.reduce((s, x) => s + intersecao([x.pol], nova.pols).reduce((a, b) => a + areaPol(b), 0), 0);
  assert.ok(sob < 0.5, `${sob} m² de lote sob a rua`);
  assert.ok(sobreposicao(r2) < 0.5);
});

test("giro das divisas: área total igual, mesma quantidade de lotes, sem sobreposição", () => {
  let feitos = 0;
  for (const q of r0.quadras.filter((x) => x.lotes.length >= 8).slice(0, 4)) {
    const fil = q.lotes.filter((x) => x.fileira === q.lotes[0].fileira).sort((a, b) => a.indice - b.indice);
    const sel = fil.slice(1, 4);
    for (const g of [6, -6]) {
      const ed = girarLotes(pr0, r0, q, sel, g);
      if (!ed || ed.erro) continue;
      const r1 = calc(ed.pr);
      const area = (r) => r.lotes.reduce((s, x) => s + x.area, 0);
      assert.equal(r1.lotes.length, r0.lotes.length);
      assert.ok(Math.abs(area(r1) - area(r0)) < 0.5, `área mudou ${area(r1) - area(r0)}`);
      assert.ok(sobreposicao(r1) < 0.5);
      feitos++;
    }
  }
  assert.ok(feitos >= 4, `só ${feitos} giros fecharam`);
  // e pelo comando
  const q = r0.quadras.find((x) => x.lotes.length >= 8);
  const l = q.lotes[2];
  const s = executar("girar 5", pr0, r0, { tipo: "lotes", chaves: [{ quadra: l.quadra, fileira: l.fileira, indice: l.indice }] });
  assert.ok(s.pr && !s.erro, s.msg);
});

test("gerar quadra: N lotes por fileira, 1 ou 2 fileiras, sem sobreposição", () => {
  const pedido = { a: [0, 0], u: [1, 0], comprimento: 60, profundidade: 50, fileiras: 2, lotes: 6, lado: "esquerda" };
  const aneis = lotesDaQuadra(pedido);
  assert.equal(aneis.length, 12);
  for (const a of aneis) assert.ok(Math.abs(areaPol({ ext: a, furos: [] }) - 250) < 1e-6);
  const q = [...r0.quadras].sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const l = q.lotes[1];
  const [u] = eixosDoLote(l, q);
  const a = l.lados.find((x) => x.tipo === "rua")?.a ?? l.pol.ext[0];
  const ed = gerarQuadra(pr0, r0, { ...pedido, a, u }, calc);
  assert.ok(ed && !ed.erro, ed?.msg);
  const r1 = calc(ed.pr);
  assert.ok(sobreposicao(r1) < 0.5);
});

test("divisa travada no fundo com fundo: a junção anda junto e nenhum lote ganha quina", () => {
  const pr = gerarPropostas(base(), perimetro, { quantas: 1 })[0].projeto;
  let r = calc(pr), p = pr;
  const q0 = [...r.quadras].filter((x) => x.fileiras >= 2 && x.lotes.length >= 10).sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const alvo = q0.lotes.filter((x) => x.fileira === 0).sort((a, b) => a.indice - b.indice)[4];
  let novas = 0;
  for (const d of [1.5, -2.2, 1.1, -0.8, 2]) {
    const l = r.lotes.find((x) => Math.hypot(centroide(x.pol.ext)[0] - centroide(alvo.pol.ext)[0], centroide(x.pol.ext)[1] - centroide(alvo.pol.ext)[1]) < 15 && x.quadra === alvo.quadra) ?? alvo;
    const q = r.quadras.find((x) => x.nome === l.quadra);
    const dv = alcasDoLote(l, q).find((a) => a.tipo === "divisa" && !a.naBorda);
    if (!dv) continue;
    const antes = new Map(r.lotes.filter((x) => x.quadra === q.nome).map((x) => [x.id, quinasDe(x.pol.ext).length]));
    const ed = moverDivisaTravada(p, r, q, dv.a, dv.b, d, posicaoNoDesenho(p, r, l));
    p = ed.pr; r = calc(p);
    novas += r.lotes.filter((x) => x.quadra === q.nome && antes.has(x.id) && quinasDe(x.pol.ext).length > Math.max(4, antes.get(x.id))).length;
  }
  assert.equal(novas, 0, `${novas} lotes ganharam quina`);
});

test("trava, distância digitada e pontos de referência", () => {
  assert.deepEqual(travarNoEixo([0, 0], [5, 1], [[1, 0], [0, 1]]), [5, 0]);
  assert.deepEqual(travarNoEixo([0, 0], [1, -7], [[1, 0], [0, 1]]), [0, -7]);
  const q = pontoNaDistancia([0, 0], [3, 4], 25);
  assert.ok(Math.abs(q[0] - 15) < 1e-9 && Math.abs(q[1] - 20) < 1e-9);
  let p = adicionarReferencia(pr0, [1, 2]).pr;
  p = adicionarReferencia(p, [3, 4]).pr;
  assert.deepEqual(p.referencias.map((r) => r.nome), ["P1", "P2"]);
  p = removerReferencia(p, p.referencias[0].id);
  assert.equal(adicionarReferencia(p, [5, 6]).ref.nome, "P1");
});

test("dividir em quantas partes quiser (comando aceita 2 a 60)", () => {
  const l = r0.lotes.find((x) => x.area > 240 && !x.esquina);
  const s = executar("dividir 7", pr0, r0, { tipo: "lotes", chaves: [{ quadra: l.quadra, fileira: l.fileira, indice: l.indice }] });
  assert.ok(s.pr, s.msg);
  const r1 = calc(s.pr);
  assert.equal(r1.lotes.length, r0.lotes.length + 6);
  assert.equal(s.sel.chaves.length, 7, "as 7 partes ficam selecionadas");
});
