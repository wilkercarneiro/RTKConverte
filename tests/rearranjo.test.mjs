// Rearranjo dos lotes selecionados ("Igualar áreas" e "Ajustar fundo com fundo" com
// vários lotes), a geração já ajustada (quadras fundo com fundo pela linha central)
// e as áreas públicas: verde no ponto mais longe das estradas, institucional no centro.
//
// O que se prova: a terra dos selecionados fica entre eles (os de fora não mudam um
// centímetro), todos com a mesma área, fundo com fundo sem "T" no meio, sem lote quebrado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { perimetro } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo, normalizarProjeto } from "../src/lib/loteamento/modelo.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { chaveDoLote, executar } from "../src/lib/loteamento/acoes.ts";
import { estruturaDeDivisas, fixarEstrutura, normalizar, ordemDoDesenho } from "../src/lib/loteamento/edicao.ts";
import { contornoUniao } from "../src/lib/loteamento/rearranjo.ts";
import { alongamento } from "../src/lib/loteamento/linhaCentral.ts";
import { areaPol, areaPols, centroide, intersecao, quinasAviso, uniao } from "../src/lib/loteamento/geom.ts";

function base() {
  const pr = projetoNovo("TESTE", perimetro.pts.length);
  pr.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
  return pr;
}
const auto0 = gerarPropostas(base(), perimetro, { quantas: 1, estruturar: false })[0].projeto;
const rA = calcular(auto0, perimetro);

// área e centroide de cada lote, comparados com tolerância de 2 cm / 0,02 m² (o texto
// arredondado em 2 casas virava ao recalcular e acusava lote de fora "mudado" à toa)
const assinatura = (l) => ({ a: l.area, c: centroide(l.pol.ext) });
const mesmo = (x, y) => Math.abs(x.a - y.a) < 0.02 && Math.hypot(x.c[0] - y.c[0], x.c[1] - y.c[1]) < 0.02;
const tem = (lista, x) => lista.some((y) => mesmo(x, y));

/** roda o comando com os lotes e confere: iguais, os de fora intactos, planta fechando */
function rearranjar(pr, r0, sel, cmd, per = perimetro) {
  const s = executar(cmd, pr, r0, { tipo: "lotes", chaves: sel.map(chaveDoLote) });
  assert.ok(s.pr && !s.erro, s.msg);
  const r = calcular(s.pr, per);
  const ids = new Set(sel.map((l) => l.id));
  const fora0 = r0.lotes.filter((l) => !ids.has(l.id)).map(assinatura);
  const depois = r.lotes.map(assinatura);
  const mudaram = fora0.filter((x) => !tem(depois, x));
  assert.equal(mudaram.length, 0, `${mudaram.length} lotes de fora da seleção mudaram`);
  assert.equal(r.lotes.length, r0.lotes.length);
  const novos = r.lotes.filter((l) => l.quadra === sel[0].quadra && !tem(fora0, assinatura(l)));
  assert.equal(novos.length, sel.length);
  const soma0 = sel.reduce((s2, l) => s2 + l.area, 0), soma = novos.reduce((s2, l) => s2 + l.area, 0);
  assert.ok(Math.abs(soma - soma0) < 0.05, `a terra dos selecionados mudou: ${soma0} → ${soma}`);
  const q = r.quadro;
  assert.ok(Math.abs(q.lotes.area + q.viario + q.verde + q.institucional + q.lazer + q.app + q.sobras - q.gleba) < 0.5, "quadro não fecha");
  assert.ok(Math.abs(areaPols(uniao(r.lotes.map((l) => l.pol))) - q.lotes.area) < 0.5, "lotes sobrepostos");
  return { s, r, novos };
}

/** junções dentro da seleção: cada uma encontra 4 lotes (fundo com fundo), nenhuma em "T" (3) */
function emT(novos) {
  const borda = contornoUniao(normalizar(novos.map((l) => l.pol.ext)))[0];
  const naBorda = (p) => borda.some((a, i) => { const b = borda[(i + 1) % borda.length]; const ab = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)); return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t) < 0.02; });
  const conta = new Map();
  for (const l of novos) for (const p of new Set(l.pol.ext.map((x) => `${Math.round(x[0] * 50)},${Math.round(x[1] * 50)}`))) conta.set(p, (conta.get(p) ?? 0) + 1);
  let t = 0;
  for (const [k, n] of conta) { const [x, y] = k.split(",").map((v) => Number(v) / 50); if (!naBorda([x, y]) && n === 3) t++; }
  return t;
}

test("fundo com fundo nos lotes selecionados (duas fileiras): iguais, alinhados, só eles mudam", () => {
  const q = [...rA.quadras].filter((x) => x.fileiras === 2).sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const lotes = ordemDoDesenho(auto0, q);
  const est = estruturaDeDivisas(normalizar(lotes.map((l) => l.pol.ext)), q);
  const pares = est.comuns.filter((c) => est.ehFundo(c.a, c.b)).map((c) => c.lotes.map((k) => lotes[k]));
  const sel = [...new Set(pares.slice(1, 5).flat())];
  assert.ok(sel.length >= 6, "a quadra de teste tem colunas fundo com fundo");
  for (const cmd of ["fundo com fundo", "igualar"]) {
    const { s, novos } = rearranjar(auto0, rA, sel, cmd);
    assert.match(s.msg, /m² cada — fundo com fundo/, s.msg);
    const ar = novos.map((l) => l.area);
    assert.ok(Math.max(...ar) - Math.min(...ar) < 0.05, `áreas ${ar.map((x) => x.toFixed(2)).join(" ")}`);
    assert.equal(emT(novos), 0, "junção em T: um lote encostou o fundo em dois");
    for (const l of novos) assert.ok(quinasAviso(l.pol.ext) <= 4, `${l.id} com ${quinasAviso(l.pol.ext)} quinas`);
  }
});

test("igualar uma fileira: mesma área, laterais coerentes, a frente toda aproveitada", () => {
  const q = rA.quadras.find((x) => x.fileiras === 1 && x.lotes.length >= 6);
  assert.ok(q, "a gleba de teste tem quadra de uma fileira");
  const ord = [...q.lotes].sort((a, b) => a.numero - b.numero);
  const sel = ord.slice(1, 6);
  const { s, novos } = rearranjar(auto0, rA, sel, "igualar");
  assert.match(s.msg, /5 lotes com .* m² cada/, s.msg);
  const ar = novos.map((l) => l.area);
  assert.ok(Math.max(...ar) - Math.min(...ar) < 0.05);
  for (const l of novos) assert.ok(quinasAviso(l.pol.ext) <= 4 && l.problemas.length === 0, `${l.id}: ${l.problemas.join("; ")}`);
});

test("rearranjo recusa seleção solta e lote de outra quadra, sem mexer em nada", () => {
  const q = [...rA.quadras].filter((x) => x.fileiras === 2).sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const ord = [...q.lotes].sort((a, b) => a.numero - b.numero);
  const solto = executar("fundo com fundo", auto0, rA, { tipo: "lotes", chaves: [ord[1], ord[4]].map(chaveDoLote) });
  assert.ok(solto.erro && !solto.pr, solto.msg);
  const outra = rA.quadras.find((x) => x !== q && x.lotes.length);
  const misto = executar("igualar", auto0, rA, { tipo: "lotes", chaves: [ord[1], outra.lotes[0]].map(chaveDoLote) });
  assert.ok(misto.erro && /mesma quadra/.test(misto.msg));
});

// ---------------------------------------------------------------------------
// Geração já ajustada
// ---------------------------------------------------------------------------
const prop = gerarPropostas(base(), perimetro, { quantas: 1 })[0];
const rG = calcular(prop.projeto, perimetro);

test("geração: quadras de duas fileiras já saem fundo com fundo pela linha central, sem erro", () => {
  const est = rG.quadras.filter((q) => q.estruturada);
  assert.ok(est.length >= 3, `só ${est.length} quadras pela linha central`);
  assert.equal(rG.problemas.filter((p) => p.nivel === "erro").length, 0, rG.problemas.map((p) => p.texto).join("; "));
  for (const q of est) assert.equal(q.estruturada.cruzamentos, 0, `quadra ${q.nome} com divisas cruzadas`);
  // a quadra estruturada é fundo com fundo por construção: nenhuma junção em T
  for (const q of est) assert.equal(emT(q.lotes.filter((l) => !l.esquina)), 0, `quadra ${q.nome} com junção em T`);
  // a forma melhora: lote com 5 quinas não aparece na linha central
  for (const q of est) for (const l of q.lotes) assert.ok(quinasAviso(l.pol.ext) <= 4, `${l.id} com 5 quinas`);
  assert.equal(rG.sobras.length, 0);
});

test("quadra da linha central: o comando cai no lote selecionado (o índice dela é por fileira)", () => {
  const q = rG.quadras.find((x) => x.estruturada && x.lotes.filter((l) => l.fileira === 1).length >= 3 && x.lotes.filter((l) => l.fileira === 0).length >= 3);
  assert.ok(q, "a geração tem quadra pela linha central");
  // um lote do meio da SEGUNDA fileira: o índice dele se repete na primeira
  const alvo = q.lotes.filter((l) => l.fileira === 1).sort((a, b) => a.indice - b.indice)[2];
  const s = executar("dividir 2", prop.projeto, rG, { tipo: "lotes", chaves: [chaveDoLote(alvo)] });
  assert.ok(s.pr && !s.erro, s.msg);
  const r = calcular(s.pr, perimetro);
  assert.equal(r.lotes.length, rG.lotes.length + 1);
  // os dois pedaços ficam dentro do lote escolhido; todos os outros lotes continuam iguais
  const dentro = r.lotes.filter((l) => intersecao([l.pol], [alvo.pol]).reduce((s2, x) => s2 + areaPol(x), 0) > 0.5 * l.area);
  assert.equal(dentro.length, 2, "o dividir não caiu no lote selecionado");
  const outros0 = rG.lotes.filter((l) => l !== alvo).map(assinatura), depois = r.lotes.map(assinatura);
  assert.equal(outros0.filter((x) => !tem(depois, x)).length, 0, "outro lote mudou");
});

test("geração: área verde no ponto mais longe das estradas e institucional no centro do terreno", () => {
  const via = rG.ladosGleba.find((l) => l.tipo === "via");
  const dSeg = (p, a, b) => { const ab = [b[0] - a[0], b[1] - a[1]], l2 = ab[0] ** 2 + ab[1] ** 2; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)); return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t); };
  const dV = (p) => dSeg(p, via.a, via.b);
  const dMax = Math.max(...rG.gleba.ext.map(dV));
  const verdes = rG.publicas.filter((a) => a.tipo === "verde");
  assert.ok(verdes.length, "sem área verde");
  for (const v of verdes) assert.ok(dV(centroide(v.pol.ext)) >= 0.5 * dMax, `área verde a ${dV(centroide(v.pol.ext)).toFixed(0)} m da estrada (máx. ${dMax.toFixed(0)} m)`);
  const inst = rG.publicas.filter((a) => a.tipo === "institucional");
  assert.ok(inst.length, "sem área institucional");
  const cg = centroide(rG.gleba.ext);
  const raio = Math.sqrt(rG.quadro.gleba / Math.PI);
  for (const a of inst) { const c = centroide(a.pol.ext); assert.ok(Math.hypot(c[0] - cg[0], c[1] - cg[1]) < 0.3 * raio, `institucional a ${Math.hypot(c[0] - cg[0], c[1] - cg[1]).toFixed(0)} m do centro (raio ${raio.toFixed(0)} m)`); }
  assert.ok((100 * rG.quadro.verde) / rG.quadro.gleba >= prop.projeto.params.pctVerdeMin - 0.01);
  assert.ok((100 * rG.quadro.institucional) / rG.quadro.gleba >= prop.projeto.params.pctInstitucionalMin - 0.01);
});

// ---------------------------------------------------------------------------
// Projeto real do EDILSON (corpus local, fora do Git)
// ---------------------------------------------------------------------------
const EDILSON = new URL("./corpus-real/edilson/", import.meta.url);
const temEdilson = existsSync(new URL("atual_2026-11-01.json", EDILSON));
function edilson() {
  const txt = readFileSync(new URL("Arquivo_de_Coordenadas_Formatado.txt", EDILSON), "utf8").split(/\r?\n/).filter((l) => /^\d/.test(l));
  const n = (s2) => Number(s2.replace(",", "."));
  const per = { pts: txt.map((l) => [n(l.split(";")[1]), n(l.split(";")[2])]), altitudes: txt.map((l) => n(l.split(";")[3])), confrontantes: txt.map((_, i) => (i >= 3 && i <= 14 ? "ESTRADA" : "DIVISA")) };
  const b = JSON.parse(readFileSync(new URL("atual_2026-11-01.json", EDILSON), "utf8"));
  return { per, pr: normalizarProjeto(b, b.nome, per.pts.length) };
}

test("EDILSON: duas fileiras com as pontas inclinadas (quadra C) — iguais e fundo com fundo, os outros 14 intactos", { skip: !temEdilson && "sem o corpus real" }, () => {
  const { per, pr } = edilson();
  const r0 = calcular(pr, per);
  const sel = [15, 14, 13, 12, 11, 16, 17, 18, 19, 20].map((x) => r0.lotes.find((l) => l.quadra === "C" && l.numero === x));
  // as fileiras da C são desencontradas: a seleção tem degrau nas duas pontas. Fundo com
  // fundo fica na linha de fundo atual (os degraus sobre ela): cada fileira por igual,
  // divisas de rua a rua, nenhum lote quebrado (antes o lote da ponta saía com 6 quinas)
  const ff = rearranjar(pr, r0, sel, "fundo com fundo", per);
  assert.equal(emT(ff.novos), 0, "fundo com fundo: junção em T");
  for (const l of ff.novos) assert.ok(quinasAviso(l.pol.ext) <= 4, `fundo com fundo: ${l.id} com ${quinasAviso(l.pol.ext)} quinas`);
  const ar = ff.novos.map((l) => l.area).sort((a, b) => a - b);
  assert.ok(ar[4] - ar[0] < 0.05 && ar[9] - ar[5] < 0.05, `cada fileira por igual: ${ar.map((x) => x.toFixed(2)).join(" ")}`);
  assert.match(ff.s.msg, /cada fileira por igual/);
  // igualar: as fileiras se igualam por dentro, a linha de fundo e os de fora ficam
  const ig = rearranjar(pr, r0, sel, "igualar", per);
  for (const l of ig.novos) assert.ok(quinasAviso(l.pol.ext) <= 4, `igualar: ${l.id} com ${quinasAviso(l.pol.ext)} quinas`);
});

test("EDILSON: uma fileira (quadra C, frente de baixo) — laterais no esquadro, iguais", { skip: !temEdilson && "sem o corpus real" }, () => {
  const { per, pr } = edilson();
  const r0 = calcular(pr, per);
  const sel = [16, 17, 18, 19, 20, 21, 22].map((x) => r0.lotes.find((l) => l.quadra === "C" && l.numero === x));
  const { s, novos } = rearranjar(pr, r0, sel, "igualar", per);
  assert.match(s.msg, /7 lotes com .* m² cada/);
  assert.ok(novos.every((l) => quinasAviso(l.pol.ext) <= 4));
});

test("EDILSON: fundo com fundo da quadra inteira não faz lote-tira na cabeceira (D)", { skip: !temEdilson && "sem o corpus real" }, () => {
  const { per, pr } = edilson();
  const r0 = calcular(pr, per);
  const s = executar("fundo com fundo", pr, r0, { tipo: "quadra", nome: "D" });
  assert.ok(s.pr && s.estruturar !== undefined, s.msg);
  const r1 = calcular(s.pr, per);
  const r2 = calcular(fixarEstrutura(s.pr, r1, s.estruturar), per);
  const q = r2.quadras.find((x) => x.cfg === s.estruturar);
  assert.ok(q.estruturada, "D não ficou pela linha central");
  for (const l of q.lotes) assert.ok(alongamento(l.pol.ext) < 4, `${l.id} comprido demais (${alongamento(l.pol.ext).toFixed(1)}× a largura)`);
  for (const l of q.lotes) assert.ok(quinasAviso(l.pol.ext) <= 4, `${l.id} com 5 quinas`);
});
