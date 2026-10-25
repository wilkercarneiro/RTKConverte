// Loteamento: o motor que divide a gleba e os arquivos que saem dele.
//
// O que se prova aqui é o que erraria calado numa planta: área de lote que não
// soma, vizinho que não se ajusta quando um lote é travado, faixa de APP que
// vira lote, nome de ponto da locação que não bate com o do memorial, e a
// conversão do plano de terreno de volta para UTM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { perimetro } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo } from "../src/lib/loteamento/modelo.ts";
import { calcular, viarioDe } from "../src/lib/loteamento/calculo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { chaveDoLote, executar } from "../src/lib/loteamento/acoes.ts";
import {
  acertarMedida, alcasDoLote, apagarLotes, cfgDe, cortarLotes, definirFrente, desenharLote, dividirLote, ladosRetos, moverDivisa, moverQuina,
  posicaoNoDesenho, unirLotes,
} from "../src/lib/loteamento/edicao.ts";
import { alternarAcesso } from "../src/lib/loteamento/acoes.ts";
import { criarPlano, paraPlano, paraUtm } from "../src/lib/loteamento/plano.ts";
import { areaPol, areaPols, diferenca, quinas, uniao } from "../src/lib/loteamento/geom.ts";
import {
  arquivoLocacao, chavePonto, gerarDxf, gerarKml, ladosNominais, memorialDoLote, nomesDosPontos, pontosDeLocacao,
} from "../src/lib/loteamento/saidas.ts";

function base() {
  const pr = projetoNovo("TESTE", perimetro.pts.length);
  pr.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
  return pr;
}

// a proposta automática é o ponto de partida de quase todos os testes
const proposta = gerarPropostas(base(), perimetro, { quantas: 1 })[0];
const pr0 = proposta.projeto;
const r0 = calcular(pr0, perimetro);

test("proposta automática: lotes válidos e nenhuma pendência de lote", () => {
  assert.ok(r0.lotes.length > 150, `só ${r0.lotes.length} lotes`);
  assert.equal(r0.problemas.filter((p) => p.nivel === "erro").length, 0);
  for (const l of r0.lotes) {
    assert.ok(l.area >= 125 - 0.01, `${l.id} com ${l.area}`);
    assert.ok(l.frente >= 5 - 0.01, `${l.id} com frente ${l.frente}`);
  }
});

test("quadro de áreas fecha na área da gleba", () => {
  const q = r0.quadro;
  const soma = q.lotes.area + q.viario + q.verde + q.institucional + q.lazer + q.app + q.sobras;
  assert.ok(Math.abs(soma - q.gleba) < 0.5, `soma ${soma} × gleba ${q.gleba}`);
  // e o viário por diferença confere com o polígono do viário
  assert.ok(Math.abs(areaPols(viarioDe(r0)) - q.viario) < 1, "viário geométrico diverge do aritmético");
  // metas de áreas públicas cumpridas pela reserva automática
  assert.ok((100 * (q.verde + q.lazer)) / q.gleba >= pr0.params.pctVerdeMin - 0.01);
  assert.ok((100 * q.institucional) / q.gleba >= pr0.params.pctInstitucionalMin - 0.01);
});

test("lotes não se sobrepõem e ficam dentro da gleba", () => {
  const todos = uniao(r0.lotes.map((l) => l.pol));
  assert.ok(Math.abs(areaPols(todos) - r0.quadro.lotes.area) < 0.5, "lotes sobrepostos");
  assert.ok(areaPols(diferenca(todos, [r0.gleba])) < 0.01, "lote fora da gleba");
});

test("lote padrão 10 × 25 sai com 250,00 m² exatos", () => {
  // lotes retangulares de 10 m de frente e 25 m de lado (quadras de fundo raso têm lote menor)
  const meio = r0.lotes.filter((l) => l.lados.length === 4 && l.lados.every((x) => Math.abs(x.comp - 10) < 0.01 || Math.abs(x.comp - 25) < 0.01));
  assert.ok(meio.length > 50);
  for (const l of meio) assert.ok(Math.abs(l.area - 250) < 0.01, `${l.id}: ${l.area}`);
});

test("frente digitada: a divisa lateral desliza, o vizinho cede e a quadra se conserva", () => {
  const q = [...r0.quadras].filter((x) => x.fileiras === 2).sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const alvo = q.lotes.find((l) => !l.esquina && l.problemas.length === 0 && l.numero > 3);
  const ed = acertarMedida(pr0, r0, q, alvo, "frente", alvo.frente + 3);
  assert.ok(ed && ed.sel, ed?.msg);
  const r = calcular(ed.pr, perimetro);
  const l = r.lotes.find((x) => x.quadra === q.nome && x.indice === ed.sel.indices[0]);
  assert.ok(Math.abs(l.frente - (alvo.frente + 3)) < 0.02, `frente ${l.frente}`);
  // a quadra inteira continua coberta, sem sobreposição
  const ls = r.lotes.filter((x) => x.quadra === q.nome);
  const soma = ls.reduce((s2, x) => s2 + x.area, 0);
  assert.ok(Math.abs(soma - q.lotes.reduce((s2, x) => s2 + x.area, 0)) < 0.5, "a quadra perdeu área");
  assert.ok(Math.abs(areaPols(uniao(ls.map((x) => x.pol))) - soma) < 0.5, "lotes sobrepostos");
  assert.equal(ls.length, q.lotes.length);
});

test("arrastar quina e divisa: os vizinhos que têm o ponto se ajustam, a quina da rua corre pela rua", () => {
  const q = [...r0.quadras].filter((x) => x.fileiras === 2).sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const l = q.lotes.find((x) => !x.esquina && x.numero > 3);
  const alcas = alcasDoLote(l, q);
  assert.equal(alcas.filter((a) => a.tipo === "quina").length, 4, "lote retangular: 4 quinas");
  assert.ok(alcas.filter((a) => a.tipo === "divisa").length >= 2, "divisas laterais e fundo");
  const total = q.lotes.reduce((s2, x) => s2 + x.area, 0);
  // quina na rua: o ponto continua sobre a borda da quadra
  const naRua = alcas.find((a) => a.tipo === "quina" && a.naBorda);
  const e1 = moverQuina(pr0, r0, q, naRua.p, [naRua.p[0] + 3, naRua.p[1] + 3]);
  const r1 = calcular(e1.pr, perimetro);
  const ls1 = r1.lotes.filter((x) => x.quadra === q.nome);
  assert.ok(Math.abs(ls1.reduce((s2, x) => s2 + x.area, 0) - total) < 0.5, "quina na rua tirou área da quadra");
  // divisa: o lote cresce exatamente o que o vizinho perde
  const dv = alcas.find((a) => a.tipo === "divisa");
  const e2 = moverDivisa(pr0, r0, q, dv.a, dv.b, 2);
  const r2 = calcular(e2.pr, perimetro);
  const ls2 = r2.lotes.filter((x) => x.quadra === q.nome);
  assert.ok(Math.abs(ls2.reduce((s2, x) => s2 + x.area, 0) - total) < 0.5);
  assert.ok(Math.abs(areaPols(uniao(ls2.map((x) => x.pol))) - total) < 0.5, "lotes sobrepostos");
  assert.ok(ls2.some((x) => Math.abs(x.area - l.area) > 5), "nenhum lote mudou");
});

test("arraste nunca trava: quina puxada por cima do vizinho, alinhada ou pela rua continua com alça e andando", () => {
  const q = [...r0.quadras].filter((x) => x.fileiras === 2).sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const l = q.lotes.find((x) => !x.esquina && x.numero > 3);
  const dentro = alcasDoLote(l, q).find((a) => a.tipo === "quina" && !a.naBorda);
  const fr = l.lados.find((x) => x.tipo === "rua");
  const u = [(fr.b[0] - fr.a[0]) / fr.comp, (fr.b[1] - fr.a[1]) / fr.comp];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let pr = pr0, res = r0, k = posicaoNoDesenho(pr0, r0, l), p = dentro.p;
  // três arrastes em cadeia: 1,6 lote de largura para o lado (passa por cima do
  // vizinho), de volta até alinhar com a divisa e 2 m para dentro
  for (const [dx, dy] of [[u[0] * 16, u[1] * 16], [-u[0] * 15.9, -u[1] * 15.9], [u[1] * 2, -u[0] * 2]]) {
    const qq = res.quadras.find((x) => x.nome === q.nome);
    const para = [p[0] + dx, p[1] + dy];
    const ed = moverQuina(pr, res, qq, p, para, false, Infinity, k);
    assert.ok(ed.sel, "o lote arrastado sumiu da seleção");
    const r = calcular(ed.pr, perimetro);
    const q2 = r.quadras.find((x) => x.nome === q.nome);
    // o que se vê é o que se edita: um contorno guardado para cada lote desenhado
    assert.equal(ed.pr.quadras[cfgDe(ed.pr, q2, r.plano)].lotes.length, q2.lotes.length, "contorno guardado sobrando (alça em ponto que não existe)");
    const l2 = q2.lotes.find((x) => x.indice === ed.sel.indices[0]);
    const nova = l2.pol.ext.reduce((m, v) => (dist(v, para) < dist(m, para) ? v : m), l2.pol.ext[0]);
    assert.ok(dist(nova, para) < 0.05, `a quina não foi aonde o cursor foi (${dist(nova, para).toFixed(2)} m)`);
    const comAlca = q2.lotes.some((o) => alcasDoLote(o, q2).some((a) => a.tipo === "quina" && dist(a.p, nova) < 0.05));
    assert.ok(comAlca, "a quina ficou sem alça (não dá para pegar de novo)");
    pr = ed.pr; res = r; k = ed.sel.indices[0]; p = nova;
  }
});

test("divisa deslizando não abre fresta: fundo que é trecho do lado do vizinho e ponta na quina da rua", () => {
  for (const q of r0.quadras.filter((x) => x.lotes.length >= 4)) {
    const total = q.lotes.reduce((s2, x) => s2 + x.area, 0);
    for (const l of q.lotes.filter((_, i) => i % 3 === 0)) for (const a of alcasDoLote(l, q).filter((x) => x.tipo === "divisa" && !x.naBorda)) {
      for (const d of [-1.5, 1.5]) {
        const ed = moverDivisa(pr0, r0, q, a.a, a.b, d, false, posicaoNoDesenho(pr0, r0, l));
        const ls = calcular(ed.pr, perimetro).lotes.filter((x) => x.quadra === q.nome);
        const soma = ls.reduce((s2, x) => s2 + x.area, 0);
        assert.ok(Math.abs(soma - total) < 0.5, `${l.id}: divisa ${d} m abriu ${(total - soma).toFixed(2)} m² de fresta`);
      }
    }
  }
});

test("frente escolhida: lote sem rua ganha frente, esquina escolhe a rua principal, quadra ganha acesso", () => {
  const q = [...r0.quadras].filter((x) => x.fileiras === 2).sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const l = q.lotes.find((x) => !x.esquina && x.numero > 3);
  const fr = l.lados.find((x) => x.tipo === "rua");
  const u = [(fr.b[0] - fr.a[0]) / fr.comp, (fr.b[1] - fr.a[1]) / fr.comp];
  const c = l.pol.ext.reduce((s2, p) => [s2[0] + p[0] / l.pol.ext.length, s2[1] + p[1] / l.pol.ext.length], [0, 0]);
  // corte paralelo à rua: o pedaço de trás fica sem frente
  const h = fr.comp / 2 + 0.5;
  const ct = cortarLotes(pr0, r0, [c[0] - u[0] * h, c[1] - u[1] * h], [c[0] + u[0] * h, c[1] + u[1] * h]);
  const r1 = calcular(ct.pr, perimetro);
  const sf = r1.lotes.find((x) => x.quadra === q.nome && x.problemas.some((t) => /sem frente/.test(t)));
  assert.ok(sf, "o corte não criou o lote sem frente");
  const lado = [...sf.lados].sort((a, b) => b.comp - a.comp).find((x) => x.tipo === "lote");
  const ed = definirFrente(ct.pr, r1, r1.quadras.find((x) => x.nome === q.nome), sf, lado.a, lado.b);
  const r2 = calcular(ed.pr, perimetro);
  const sf2 = r2.lotes.find((x) => x.quadra === q.nome && x.indice === ed.sel.indices[0]);
  assert.ok(!sf2.problemas.some((t) => /sem frente/.test(t)) && sf2.frente > 1, "frente escolhida não valeu");
  assert.ok(sf2.lados.some((x) => x.principal && x.semRua), "o lado escolhido não ficou marcado");
  const mem = memorialDoLote(sf2, r2, nomesDosPontos(pontosDeLocacao(r2, perimetro)), { loteamento: "TESTE", municipio: "X", uf: "BA", proprietario: "", fuso: 24 });
  assert.match(mem.paragrafos.join(" "), /confrontando com Lote/, "memorial: o lado escolhido confronta com o lote vizinho");
  assert.ok(ladosNominais(sf2).frente.some((x) => x.principal), "memorial: a frente nominal é o lado escolhido");
  // a frente acompanha o lado quando ele gira (não pula para o lado oposto)
  const q2 = r2.quadras.find((x) => x.nome === q.nome);
  const ponta = sf2.lados.find((x) => x.principal).a;
  const dd = [lado.b[0] - lado.a[0], lado.b[1] - lado.a[1]], Ld = Math.hypot(...dd);
  const gi = moverQuina(ed.pr, r2, q2, ponta, [ponta[0] - (dd[1] / Ld) * 3, ponta[1] + (dd[0] / Ld) * 3], true, Infinity, ed.sel.indices[0]);
  const sg = calcular(gi.pr, perimetro).lotes.find((x) => x.quadra === q.nome && x.indice === gi.sel.indices[0]);
  const fp = sg.lados.filter((x) => x.principal);
  assert.ok(fp.some((x) => Math.min(...[x.a, x.b].map((p) => Math.hypot(p[0] - ponta[0], p[1] - ponta[1]))) < 4), "a frente pulou de lado");
  // corte depois da escolha: só o pedaço que fica com o lado tem a frente
  const cg = l.pol.ext.reduce((s2, p) => [s2[0] + p[0] / l.pol.ext.length, s2[1] + p[1] / l.pol.ext.length], [0, 0]);
  const ct2 = cortarLotes(ed.pr, r2, [sf2.pol.ext[0][0] - u[0] * 30, sf2.pol.ext[0][1] - u[1] * 30], [cg[0] + u[0] * 30, cg[1] + u[1] * 30]);
  if (ct2) assert.ok(calcular(ct2.pr, perimetro).lotes.filter((x) => x.lados.some((y) => y.principal)).length <= 2, "o corte copiou a frente escolhida para os pedaços");
  // clicar de novo tira
  const ed2 = definirFrente(ed.pr, r2, r2.quadras.find((x) => x.nome === q.nome), sf2, lado.a, lado.b);
  assert.ok(calcular(ed2.pr, perimetro).lotes.find((x) => x.quadra === q.nome && x.indice === ed.sel.indices[0]).problemas.some((t) => /sem frente/.test(t)));
  // esquina: a rua escolhida é a única frente; a outra continua confrontação
  const esq = r0.lotes.find((x) => x.esquina && x.lados.filter((y) => y.tipo === "rua" && y.comp >= 3).length >= 2);
  const rua = esq.lados.filter((y) => y.tipo === "rua" && y.comp >= 3).sort((a, b) => a.comp - b.comp)[0];
  const ee = definirFrente(pr0, r0, r0.quadras.find((x) => x.nome === esq.quadra), esq, rua.a, rua.b);
  const esq2 = calcular(ee.pr, perimetro).lotes.find((x) => x.quadra === esq.quadra && x.indice === ee.sel.indices[0]);
  assert.ok(!esq2.esquina && esq2.frente < rua.comp + 2, `esquina com frente ${esq2.frente}`);
  // acesso da quadra: um lado de divisa da gleba vira frente dos lotes que encostam nele
  const qa = r0.quadras.find((x) => x.lotes.some((y) => y.lados.some((z) => z.tipo === "divisa" && z.comp > 5)));
  const ld = qa.lotes.flatMap((y) => y.lados).filter((z) => z.tipo === "divisa").sort((a, b) => b.comp - a.comp)[0];
  const m = [(ld.a[0] + ld.b[0]) / 2, (ld.a[1] + ld.b[1]) / 2];
  const dl = (s) => { const [a, b] = s; const ab = [b[0] - a[0], b[1] - a[1]]; const t = Math.max(0, Math.min(1, ((m[0] - a[0]) * ab[0] + (m[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2))); return Math.hypot(m[0] - a[0] - ab[0] * t, m[1] - a[1] - ab[1] * t); };
  const lq = ladosRetos(qa.pol).sort((x, y) => dl(x) - dl(y))[0];
  const ac = alternarAcesso(pr0, r0, qa, lq[0], lq[1]);
  const q5 = calcular(ac.pr, perimetro).quadras.find((x) => x.nome === qa.nome);
  assert.equal(q5.acessos?.length, 1);
  assert.ok(q5.lotes.some((y) => y.lados.some((z) => z.definida && !z.principal)), "nenhum lote ganhou frente no acesso");
});

test("apagar, desenhar, unir, dividir e cortar lotes à mão", () => {
  const q = [...r0.quadras].filter((x) => x.fileiras === 2).sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const ord = [...q.lotes].sort((a, b) => a.numero - b.numero);
  const l = ord[5];
  // apagar: a área fica livre (rosa) e o quadro fecha
  const ap = apagarLotes(pr0, r0, q, [posicaoNoDesenho(pr0, r0, l)]);
  const ra = calcular(ap.pr, perimetro);
  assert.equal(ra.lotes.length, r0.lotes.length - 1);
  assert.ok(ra.sobras.some((s2) => Math.abs(areaPols([s2]) - l.area) < 1), "a área do lote apagado não ficou livre");
  const qa = ra.quadro;
  assert.ok(Math.abs(qa.lotes.area + qa.viario + qa.verde + qa.institucional + qa.lazer + qa.app + qa.sobras - qa.gleba) < 0.5);
  // desenhar um contorno maior que o buraco: o lote novo manda e os vizinhos cedem
  const c = l.pol.ext.reduce((a, p) => [a[0] + p[0] / l.pol.ext.length, a[1] + p[1] / l.pol.ext.length], [0, 0]);
  const anel = l.pol.ext.map(([x, y]) => [c[0] + (x - c[0]) * 1.3, c[1] + (y - c[1]) * 1.3]);
  const de = desenharLote(ap.pr, ra, anel);
  const rd = calcular(de.pr, perimetro);
  const novo = rd.lotes.find((x) => x.quadra === q.nome && x.indice === de.sel.indices[0]);
  assert.ok(novo.area > l.area + 10, `lote desenhado com ${novo.area}`);
  const lsd = rd.lotes.filter((x) => x.quadra === q.nome);
  assert.ok(Math.abs(areaPols(uniao(lsd.map((x) => x.pol))) - lsd.reduce((s2, x) => s2 + x.area, 0)) < 0.5, "lote desenhado sobreposto");
  // unir dois vizinhos e dividir em 3 partes iguais
  const un = unirLotes(pr0, r0, q, [posicaoNoDesenho(pr0, r0, ord[7]), posicaoNoDesenho(pr0, r0, ord[8])]);
  assert.ok(un, "não uniu vizinhos");
  const ru = calcular(un.pr, perimetro);
  const u = ru.lotes.find((x) => x.quadra === q.nome && x.indice === un.sel.indices[0]);
  assert.ok(Math.abs(u.area - ord[7].area - ord[8].area) < 0.5);
  assert.ok(!u.problemas.some((t) => /quinas/.test(t)), "a união criou quina a mais");
  const dv = dividirLote(un.pr, ru, ru.quadras.find((x) => x.nome === q.nome), u, 3);
  const rv = calcular(dv.pr, perimetro);
  for (const k of dv.sel.indices) assert.ok(Math.abs(rv.lotes.find((x) => x.quadra === q.nome && x.indice === k).area - u.area / 3) < 1);
  // cortar com uma linha atravessando um lote
  const m = ord[10];
  const cm = m.pol.ext.reduce((a, p) => [a[0] + p[0] / m.pol.ext.length, a[1] + p[1] / m.pol.ext.length], [0, 0]);
  const fr = m.lados.find((x) => x.tipo === "rua");
  const d = [(fr.b[0] - fr.a[0]) / fr.comp, (fr.b[1] - fr.a[1]) / fr.comp];
  const ct = cortarLotes(pr0, r0, [cm[0] - d[0] * 40, cm[1] - d[1] * 40], [cm[0] + d[0] * 40, cm[1] + d[1] * 40]);
  assert.ok(ct, "o corte não pegou lote");
  assert.ok(calcular(ct.pr, perimetro).lotes.length > r0.lotes.length);
});

test("comandos: unir, dividir e virar área verde", () => {
  // lote cujo vizinho da fileira cabe junto com ele na área máxima
  const prox = (x) => r0.lotes.filter((y) => y.quadra === x.quadra && y.fileira === x.fileira && y.indice > x.indice).sort((a, b) => a.indice - b.indice)[0];
  const l = r0.lotes.find((x) => !x.esquina && !x.ajustado && Number.isInteger(x.indice) && prox(x) && Number.isInteger(prox(x).indice)
    && x.area + prox(x).area <= pr0.params.areaMax && x.area / 2 >= pr0.params.areaMin && x.frente / 2 >= pr0.params.frenteMin);
  assert.ok(l, "nenhum par de lotes que caiba junto na área máxima");
  const sel = { tipo: "lotes", chaves: [{ quadra: l.quadra, fileira: l.fileira, indice: l.indice }] };
  const unir = executar("unir", pr0, r0, sel);
  const ru = calcular(unir.pr, perimetro);
  assert.equal(ru.lotes.length, r0.lotes.length - 1);
  const div = executar("dividir 2", pr0, r0, sel);
  const rd = calcular(div.pr, perimetro);
  assert.equal(rd.lotes.length, r0.lotes.length + 1);
  const verde = executar("verde", pr0, r0, sel);
  const rv = calcular(verde.pr, perimetro);
  assert.equal(rv.lotes.length, r0.lotes.length - 1);
  assert.ok(Math.abs(rv.quadro.verde - r0.quadro.verde - l.area) < 0.5);
  assert.match(executar("frentee 3", pr0, r0, sel).msg, /Não conheço/);
});

test("largura da rua: mudar a largura refaz quadras e lotes", () => {
  const s = executar("largura 16", pr0, r0, null);
  const r = calcular(s.pr, perimetro);
  assert.ok(r.quadro.viario > r0.quadro.viario + 1000);
  assert.ok(r.quadro.lotes.area < r0.quadro.lotes.area);
});

test("faixa de APP ao longo de um lado não vira lote", () => {
  const pr = { ...pr0, bordas: pr0.bordas.map((b, i) => (i === 2 ? { tipo: "rio", faixa: 30, nome: "Córrego" } : b)) };
  const r = calcular(pr, perimetro);
  assert.ok(r.quadro.app > 2000, `APP ${r.quadro.app}`);
  const app = r.areas.filter((a) => a.tipo === "app").flatMap((a) => a.pols);
  for (const l of r.lotes) assert.ok(areaPols(diferenca([l.pol], app)) > l.area - 0.01, `${l.id} invade a APP`);
});

test("plano de terreno: ida e volta para UTM é exata e o fator é plausível", () => {
  const pl = criarPlano(perimetro.pts, perimetro.altitudes, true);
  assert.ok(pl.k > 0.9990 && pl.k < 1.0010, `k = ${pl.k}`);
  for (const p of perimetro.pts) {
    const v = paraUtm(pl, paraPlano(pl, p));
    assert.ok(Math.hypot(v[0] - p[0], v[1] - p[1]) < 1e-6);
  }
  // distância de terreno = distância UTM / k
  const a = perimetro.pts[0], b = perimetro.pts[1];
  const dUtm = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pa = paraPlano(pl, a), pb = paraPlano(pl, b);
  assert.ok(Math.abs(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) - dUtm / pl.k) < 1e-6);
});

test("locação: nomes únicos e curtos, coordenadas iguais às do desenho", () => {
  const pts = pontosDeLocacao(r0, perimetro);
  const nomes = pts.map((p) => p.nome);
  assert.equal(new Set(nomes).size, nomes.length, "nome de ponto repetido");
  for (const n of nomes) assert.match(n, /^[A-Z0-9\-_.]{1,16}$/);
  // todo canto de lote (fora os intermediários dos arcos) está na locação
  const k = new Set(pts.map((p) => chavePonto(p.p)));
  const l = r0.lotes[10];
  const intermed = new Set(r0.quadras.flatMap((q) => q.curvas.flatMap((c) => c.intermediarios.map(chavePonto))));
  for (const v of l.pol.ext) if (!intermed.has(chavePonto(v))) assert.ok(k.has(chavePonto(v)), `vértice do ${l.id} fora da locação`);
  // UTM do arquivo = plano × k + centro
  const p = pts[0];
  const u = paraUtm(r0.plano, p.p);
  assert.ok(Math.abs(u[0] - p.e) < 1e-6 && Math.abs(u[1] - p.n) < 1e-6);
  const csv = arquivoLocacao(pts, "csv-nome-e-n").split("\r\n");
  assert.equal(csv[0], "Name,Easting,Northing,Elevation,Code");
  assert.equal(csv[1].split(",").length, 5);
  assert.ok(!/[áéíóúãõç]/i.test(csv.join("")), "acento no arquivo da coletora");
});

test("memorial do lote usa os mesmos nomes de vértice da locação e fecha o perímetro", () => {
  const pts = pontosDeLocacao(r0, perimetro);
  const nomes = nomesDosPontos(pts);
  const l = r0.lotes.find((x) => !x.esquina && x.lados.length === 4);
  const m = memorialDoLote(l, r0, nomes, { loteamento: "TESTE", municipio: "X", uf: "BA", proprietario: "", fuso: 24 });
  const desc = m.paragrafos.find((p) => p.startsWith("Descrição"));
  const citados = [...desc.matchAll(/vértice ([A-Z]+-\d+)/g)].map((x) => x[1]);
  assert.equal(citados[0], citados[citados.length - 1], "não volta ao vértice inicial");
  for (const c of citados) assert.ok(pts.some((p) => p.nome === c), `${c} não existe na locação`);
  const g = ladosNominais(l);
  assert.ok(g.frente.length && g.fundos.length && g.direito.length && g.esquerdo.length);
});

test("DXF e KML bem formados", () => {
  const dxf = gerarDxf(r0, pontosDeLocacao(r0, perimetro));
  assert.ok(dxf.trimEnd().endsWith("EOF"));
  assert.equal((dxf.match(/\r\nPOLYLINE\r\n/g) ?? []).length >= r0.lotes.length, true);
  const kml = gerarKml(r0, 24, "Teste & cia");
  assert.ok(kml.includes("Teste &amp; cia"));
  assert.equal((kml.match(/<Placemark>/g) ?? []).length, r0.lotes.length + r0.publicas.length + r0.ruas.length + 1);
});

test("rua passando sobre um vértice da gleba não gruda duas quadras", () => {
  for (const q of r0.quadras) {
    // anel simples: nenhum vértice repetido
    const vistos = new Set();
    for (const p of q.pol.ext) {
      const k = chavePonto(p);
      assert.ok(!vistos.has(k), `quadra ${q.nome} beliscada em ${k}`);
      vistos.add(k);
    }
  }
});

test("área da gleba no plano de terreno ≈ área UTM / k²", () => {
  const pr = { ...pr0, params: { ...pr0.params, distanciasTerreno: false } };
  const rUtm = calcular(pr, perimetro);
  const k = r0.plano.k;
  assert.ok(Math.abs(areaPol(r0.gleba) - areaPol(rUtm.gleba) / (k * k)) < 0.01);
});

test("modalidade loteamento: cartão e chip", async () => {
  const { chaveDoServico, definicaoDe, vaiAoSigef } = await import("../src/lib/modalidades.ts");
  const s = { tipo: "geo", modalidade: "loteamento", tem_glebas: false };
  assert.equal(chaveDoServico(s), "loteamento");
  assert.equal(definicaoDe("loteamento").campos.modalidade, "loteamento");
  assert.equal(vaiAoSigef(s), false);
});

// ---------------------------------------------------------------------------
// Regras pedidas na revisão (2026-10-23): acesso, fundos alinhados,
// proporção nas pontas e área verde na terra menos valorizada
// ---------------------------------------------------------------------------

const dSeg = (p, a, b) => {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
};

test("rua só chega ao perímetro pela estrada de acesso", () => {
  for (const ru of r0.ruas) {
    for (const ponta of [ru.eixo[0], ru.eixo[ru.eixo.length - 1]]) {
      const perto = r0.ladosGleba.map((l, i) => ({ i, d: dSeg(ponta, l.a, l.b), l })).sort((a, b) => a.d - b.d)[0];
      if (perto.d > ru.largura / 2 + 1) continue; // termina dentro, num cruzamento
      assert.equal(perto.l.tipo, "via", `${ru.nome} termina no lado ${perto.i + 1} (${perto.l.tipo})`);
    }
  }
  assert.equal(r0.problemas.filter((p) => /sem acesso|não chega/.test(p.texto)).length, 0);
});

test("rua desenhada contra a divisa vira aviso", () => {
  const a = perimetro.pts[3], b = perimetro.pts[4];
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const c = [(perimetro.pts[0][0] + perimetro.pts[3][0]) / 2, (perimetro.pts[0][1] + perimetro.pts[3][1]) / 2];
  const pr = { ...pr0, ruas: [...pr0.ruas, { id: "mteste", nome: "Rua Teste", largura: 12, eixo: [c, m] }] };
  const r = calcular(pr, perimetro);
  assert.ok(r.problemas.some((p) => p.texto.startsWith("Rua Teste termina no lado 4")), "faltou o aviso de rua sem acesso");
});

test("quadra de duas fileiras: lotes fundo com fundo alinhados", () => {
  // no miolo da quadra as divisas laterais das duas fileiras se encontram na
  // linha de fundo; nas pontas (ângulo de rua, divisa torta) os lotes podem
  // ser redistribuídos para não ficarem desproporcionais
  let conferidas = 0;
  // (quadra com parte virada área pública fica de fora: ali a fileira foi cortada de propósito)
  const inteira = (q) => Math.abs(q.area - q.lotes.reduce((s, l) => s + l.area, 0)) < 1;
  // só quadra entre ruas paralelas: na quadra triangular o fundo é a bissetriz e
  // as divisas de cada fileira seguem a SUA rua
  const dirFileira = (q, fil) => {
    const ls = q.lotes.filter((l) => l.fileira === fil).flatMap((l) => l.lados.filter((x) => x.tipo === "rua"));
    if (!ls.length) return null;
    const m = ls.reduce((a, b) => (b.comp > a.comp ? b : a), ls[0]);
    const d = [m.b[0] - m.a[0], m.b[1] - m.a[1]], n = Math.hypot(d[0], d[1]);
    return [d[0] / n, d[1] / n];
  };
  const paralelas = (q) => {
    const a = dirFileira(q, 0), b = dirFileira(q, 1);
    // fundo pela bissetriz (ruas que se abrem) não corre paralelo à rua principal
    const f = [q.fundo.b[0] - q.fundo.a[0], q.fundo.b[1] - q.fundo.a[1]], nf = Math.hypot(f[0], f[1]);
    const fundoParalelo = Math.abs((f[0] * q.u[0] + f[1] * q.u[1]) / nf) > 0.985;
    return fundoParalelo && a && b && Math.abs(a[0] * b[0] + a[1] * b[1]) > 0.985;
  };
  for (const q of r0.quadras.filter((x) => x.fileiras === 2 && x.fundo && inteira(x) && paralelas(x))) {
    const L = Math.hypot(q.fundo.b[0] - q.fundo.a[0], q.fundo.b[1] - q.fundo.a[1]);
    const s = (p) => ((p[0] - q.fundo.a[0]) * (q.fundo.b[0] - q.fundo.a[0]) + (p[1] - q.fundo.a[1]) * (q.fundo.b[1] - q.fundo.a[1])) / L;
    const miolo = (p) => s(p) > 3.5 * pr0.params.frente && s(p) < L - 3.5 * pr0.params.frente;
    const naLinha = (fil) => new Set(q.lotes.filter((l) => l.fileira === fil).flatMap((l) => l.pol.ext)
      .filter((p) => dSeg(p, q.fundo.a, q.fundo.b) < 0.02 && miolo(p)).map((p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`));
    const a = naLinha(0), b = naLinha(1);
    if (!a.size || !b.size) continue;
    const comuns = [...a].filter((k) => b.has(k)).length;
    assert.equal(comuns, Math.max(a.size, b.size), `quadra ${q.nome}: ${comuns} de ${Math.max(a.size, b.size)} divisas se encontram no fundo`);
    conferidas++;
  }
  assert.ok(conferidas >= 3);
});

test("fileira com divisa torta: pontas proporcionais, sem lote nanico nem gigante", () => {
  // quadra de uma fileira só com fundo inclinado
  for (const q of r0.quadras) {
    for (const fil of [0, 1]) {
      const ls = q.lotes.filter((l) => l.fileira === fil);
      if (ls.length < 4) continue;
      const areas = ls.map((l) => l.area).sort((a, b) => a - b);
      const med = areas[Math.floor(areas.length / 2)];
      // lote de ponta anexa a sobra da gleba (até 2× a área máxima, como os de borda da equipe)
      for (const l of ls) {
        if (l.ponta) assert.ok(l.area <= pr0.params.areaMax * 1.03 + 0.5, `${l.id} de ponta com ${l.area.toFixed(0)} m²`);
        else assert.ok(l.area < 2.6 * med, `${l.id} com ${l.area.toFixed(0)} m² numa fileira de ${med.toFixed(0)}`);
      }
    }
  }
});

test("área verde: nunca na frente da estrada, e vai para a baixada", async () => {
  const { valorDosLotes } = await import("../src/lib/loteamento/auto.ts");
  const base0 = base();
  // relevo: cai forte para o leste (e > 491300)
  const E0 = 490900, N0 = 8738700, passo = 10, nx = 62, ny = 45, h = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const e = E0 + i * passo;
    h.push(330 - 0.02 * (e - 491000) - (e > 491300 ? (e - 491300) * 0.12 : 0));
  }
  base0.terreno = { e0: E0, n0: N0, passo, nx, ny, h, fonte: "dem", calibracao: 0 };
  const prop = gerarPropostas(base0, perimetro, { quantas: 1 })[0];
  const r = prop.resultado;
  const via = r.ladosGleba[0];
  // nenhuma área verde com lado sobre a estrada
  for (const a of r.areas.filter((x) => x.tipo === "verde")) {
    for (const pol of a.pols) {
      const e = pol.ext;
      for (let i = 0; i < e.length; i++) {
        const p = e[i], q = e[(i + 1) % e.length];
        const sobre = dSeg(p, via.a, via.b) < 0.3 && dSeg(q, via.a, via.b) < 0.3 && Math.hypot(q[0] - p[0], q[1] - p[1]) > 1;
        assert.ok(!sobre, `área verde ${a.nome} encosta na estrada`);
      }
    }
  }
  // lote de frente para a estrada vale "infinito" (não entra na escolha)
  const valor = valorDosLotes(r, prop.projeto, perimetro);
  for (const l of r.lotes.filter((x) => x.lados.some((s) => s.tipo === "via"))) assert.equal(valor.get(l.id), Infinity);
  // a verde (fora os retalhos de canto) fica mais baixa que a média dos lotes
  const { cotaEm } = await import("../src/lib/loteamento/terreno.ts");
  const { centroide } = await import("../src/lib/loteamento/geom.ts");
  const cota = (p) => cotaEm(base0.terreno, paraUtm(r.plano, p));
  const mediaLotes = r.lotes.reduce((s, l) => s + cota(centroide(l.pol.ext)), 0) / r.lotes.length;
  const verdes = r.publicas.filter((a) => a.tipo === "verde").sort((a, b) => b.area - a.area);
  assert.ok(cota(centroide(verdes[0].pol.ext)) < mediaLotes, "a maior área verde não está na parte baixa");
  assert.ok((100 * (r.quadro.verde + r.quadro.lazer)) / r.quadro.gleba >= 10 - 0.01);
});

// ---------------------------------------------------------------------------
// Medidas do lote: mínima · padrão · máxima (frente, profundidade, área)
// ---------------------------------------------------------------------------

test("medidas do lote: projeto antigo ganha faixas derivadas e elas acompanham o padrão", async () => {
  const { normalizarProjeto, mudarLote, faixasDerivadas } = await import("../src/lib/loteamento/modelo.ts");
  // projeto salvo antes das faixas (só frente, profundidade e mínimas)
  const velho = { versao: 1, params: { frente: 12, profundidade: 30, areaMin: 300, frenteMin: 12 } };
  const p = normalizarProjeto(velho, "X", 4).params;
  assert.deepEqual(
    { fmax: p.frenteMax, pmin: p.profundidadeMin, pmax: p.profundidadeMax, a: p.areaPadrao, amax: p.areaMax },
    { fmax: 24, pmin: 18, pmax: 48, a: 360, amax: 720 },
  );
  // faixa automática acompanha o padrão; a digitada fica
  const q = mudarLote({ ...p, areaMax: 900 }, { frente: 15 });
  assert.equal(q.frenteMax, 30);
  assert.equal(q.areaPadrao, 450);
  assert.equal(q.areaMax, 900);
  // o campo digitado manda: mínima acima do padrão leva o padrão junto
  const r = mudarLote(p, { frenteMin: 14 });
  assert.equal(r.frente, 14);
  assert.ok(r.frenteMin <= r.frente && r.frente <= r.frenteMax);
  assert.deepEqual(faixasDerivadas({ frente: 10, profundidade: 25, areaMin: 125, frenteMin: 5 }).areaMax, 500);
});

test("medidas do lote: a proposta automática não deixa lote fora das faixas", async () => {
  const { foraDasFaixas, esquinaDe, limiteFundo } = await import("../src/lib/loteamento/calculo.ts");
  const p = pr0.params;
  for (const l of r0.lotes) {
    const f = 1; // lote de ponta também respeita área e fundo máximos
    assert.ok(l.area <= f * p.areaMax * 1.03 + 0.5, `${l.id} com ${l.area.toFixed(0)} m² (máx. ${p.areaMax})`);
    assert.ok(l.profundidade <= f * limiteFundo(p), `${l.id} com ${l.profundidade.toFixed(1)} m de fundo`);
    // lote de ponta (quadrinha da ponta da gleba virou um lote só) não tem frente máxima
    const esq = l.esquina || esquinaDe(l.lados.filter((x) => x.tipo === "rua" || x.tipo === "via").map((x) => [x.a, x.b]));
    assert.deepEqual(foraDasFaixas(l, p, false, esq, l.ponta ? 0 : l.frente, !!l.ponta), [], l.id);
  }
});

test("medidas do lote: área máxima menor divide o lote grande em vez de deixá-lo inteiro", () => {
  const pr = { ...pr0, params: { ...pr0.params, areaMax: 300, frenteMax: 12 } };
  const r = calcular(pr, perimetro);
  // lote que absorveu retalho (nenhuma sobra de terreno) pode passar — mas sai com aviso
  for (const l of r.lotes.filter((x) => x.retalho)) assert.ok(l.problemas.length > 0, `${l.id} absorveu retalho e está sem aviso`);
  const grandes = r.lotes.filter((l) => l.area > 300 * 1.03 + 0.5 && !l.esquina && !l.ponta && !l.retalho);
  // os de esquina podem passar (frente nas duas ruas); o resto cabe na faixa
  assert.ok(grandes.length <= Math.ceil(0.02 * r.lotes.length), `${grandes.length} lotes acima de 300 m²: ${grandes.slice(0, 5).map((l) => l.id).join(", ")}`);
  assert.ok(r.lotes.length > r0.lotes.length, "dividir os grandes tinha de dar mais lotes");
});

test("edição livre: frente, área, unir, dividir e arrastar fora das faixas são aplicados com aviso", () => {
  const p = pr0.params;
  const q = r0.quadras.find((x) => x.fileiras === 2 && x.lotes.length > 10);
  const l = q.lotes.find((x) => !x.esquina && x.numero > 3);
  const sel = { tipo: "lotes", chaves: [{ quadra: l.quadra, fileira: l.fileira, indice: l.indice }] };
  const f = executar(`frente ${p.frenteMax + 5}`, pr0, r0, sel);
  assert.ok(f.pr && !f.erro, f.msg);
  assert.match(f.msg, /Atenção: .*fora das medidas do projeto/);
  // o lote editado aparece com aviso (não erro) e o desenho é do operador
  const rf = calcular(f.pr, perimetro);
  const lf = rf.lotes.find((x) => x.quadra === f.sel.chaves[0].quadra && x.indice === f.sel.chaves[0].indice);
  assert.ok(lf.problemas.some((t) => /frente .* acima do máximo/.test(t)), lf.problemas.join("; "));
  assert.ok(rf.problemas.filter((x) => x.alvo?.lote === lf.id).every((x) => x.nivel === "aviso"));
  const a = executar(`area ${p.areaMin - 10}`, pr0, r0, sel);
  assert.ok(a.pr && !a.erro, a.msg);
  const sel2 = { tipo: "lotes", chaves: [sel.chaves[0], chaveDoLote(q.lotes.find((x) => x.numero === l.numero + 1))] };
  const apertado = { ...pr0, params: { ...p, areaMax: l.area + 1 } };
  const u = executar("unir", apertado, r0, sel2);
  assert.ok(u.pr && !u.erro, u.msg);
  assert.match(u.msg, /área máxima/);
  const d = executar("dividir 5", pr0, r0, sel);
  assert.ok(d.pr && !d.erro, d.msg);
  // arrastar a divisa para longe: vai aonde o operador soltou
  const dv = alcasDoLote(l, q).find((x) => x.tipo === "divisa");
  const m = moverDivisa(pr0, r0, q, dv.a, dv.b, 15);
  const rm = calcular(m.pr, perimetro);
  assert.ok(rm.lotes.filter((x) => x.quadra === q.nome).some((x) => x.problemas.length), "mover 15 m não deixou aviso");
});

test("geração: lotes com no máximo 4 quinas e quadras entre ruas fundo com fundo", () => {
  const nq = r0.lotes.filter((l) => quinas(l.pol.ext) > 4);
  assert.ok(nq.length <= Math.ceil(0.01 * r0.lotes.length), `${nq.length} lotes com mais de 4 quinas: ${nq.map((l) => l.id).join(", ")}`);
  // quadra de duas fileiras entre ruas de frente: toda divisa que chega na linha de fundo encontra a da outra fileira
  let conferidas = 0;
  for (const q of r0.quadras.filter((x) => x.fileiras === 2 && x.fundo)) {
    const L = Math.hypot(q.fundo.b[0] - q.fundo.a[0], q.fundo.b[1] - q.fundo.a[1]);
    const u = [(q.fundo.b[0] - q.fundo.a[0]) / L, (q.fundo.b[1] - q.fundo.a[1]) / L];
    const naLinha = (fil) => [...new Set(q.lotes.filter((l) => l.fileira === fil).flatMap((l) => l.pol.ext)
      .filter((p) => dSeg(p, q.fundo.a, q.fundo.b) < 0.05).map((p) => Math.round(((p[0] - q.fundo.a[0]) * u[0] + (p[1] - q.fundo.a[1]) * u[1]) * 10)))].sort((a, b) => a - b);
    const a = naLinha(0), b = naLinha(1);
    if (a.length < 4 || b.length < 4) continue;
    const lo = Math.max(a[0], b[0]) + 5, hi = Math.min(a[a.length - 1], b[b.length - 1]) - 5;
    const meio = (xs) => xs.filter((x) => x > lo && x < hi);
    const sem = meio(a).filter((x) => !b.some((y) => Math.abs(y - x) <= 5)).length + meio(b).filter((x) => !a.some((y) => Math.abs(y - x) <= 5)).length;
    assert.ok(sem <= 2, `quadra ${q.nome}: ${sem} divisas sem par no fundo`);
    conferidas++;
  }
  assert.ok(conferidas >= 3, `só ${conferidas} quadras de duas fileiras conferidas`);
});

test("nenhuma sobra de terreno na planta: retalho vira lote ou entra no lote vizinho", () => {
  assert.equal(r0.sobras.length, 0, `${r0.sobras.length} retalhos sem dono`);
  const grandes = r0.canteiros.filter((x) => areaPols([x]) >= 30);
  assert.equal(grandes.length, 0, `canteiros de ${grandes.map((x) => areaPols([x]).toFixed(0)).join(", ")} m²`);
});

test("área verde 0%: nenhum retalho vira área verde nem institucional", () => {
  const b = base();
  b.params = { ...b.params, pctVerdeMin: 0, pctInstitucionalMin: 0 };
  const r = gerarPropostas(b, perimetro, { quantas: 1 })[0].resultado;
  assert.equal(r.quadro.verde, 0, `verde ${r.quadro.verde}`);
  assert.equal(r.quadro.institucional, 0);
  assert.equal(r.areas.filter((x) => x.tipo === "verde" || x.tipo === "institucional").length, 0);
  // o que não vira lote fica como área remanescente (do proprietário)
  const soma = r.quadro.lotes.area + r.quadro.viario + r.quadro.app + r.quadro.sobras;
  assert.ok(Math.abs(soma - r.quadro.gleba) < 0.5);
});


// ---------------------------------------------------------------------------
// Regras de projetista (pesquisa: Lei 9.413/81 SP, Sherburne §11.1, Goiânia PLC 2014)
// ---------------------------------------------------------------------------

test("área verde da proposta é praça de verdade: cabe um círculo de 10 m e não vem picada", async () => {
  const { verdeValida } = await import("../src/lib/loteamento/auto.ts");
  // como sai na planta: as peças encostadas formam uma área só
  const verdes = r0.publicas.filter((a) => a.tipo === "verde");
  assert.ok(verdes.length >= 1);
  // poucas áreas verdes (num perímetro só, ou quase), nenhuma nesga
  assert.ok(verdes.length <= 3, `${verdes.length} áreas verdes separadas`);
  for (const a of verdes) assert.ok(verdeValida([a.pol]), `${a.nome} (${a.area.toFixed(0)} m²) é nesga`);
});

test("retalhos vizinhos saem como um só e encostado em área pública entra nela", () => {
  for (let i = 0; i < r0.sobras.length; i++) {
    for (let j = i + 1; j < r0.sobras.length; j++) {
      const u = uniao([r0.sobras[i]], [r0.sobras[j]]);
      assert.equal(u.length, 2, "dois retalhos encostados não foram unidos");
    }
  }
});

test("quadrinha da ponta vira um lote de ponta, sem triângulos soltos", () => {
  for (const q of r0.quadras.filter((x) => x.lotes.length > 0 && x.lotes.length <= 3)) {
    const tri = q.lotes.filter((l) => l.pol.ext.length === 3);
    assert.ok(tri.length <= 1, `quadra ${q.nome} com ${tri.length} triângulos`);
  }
});

test("configuração ilógica é acertada na hora e o que sobra bloqueia a geração", async () => {
  const { editarMedidas, conferirConfiguracao, normalizarProjeto } = await import("../src/lib/loteamento/modelo.ts");
  const base = normalizarProjeto(null, "X", 4).params;
  // máximo 10 × 20 e área máxima de 1.000 m²: não existe lote assim
  let r = editarMedidas(base, { frenteMax: 10 });
  r = editarMedidas(r.params, { profundidadeMax: 20 });
  assert.ok(r.params.areaMax <= 10 * 20, `área máxima ${r.params.areaMax}`);
  r = editarMedidas(r.params, { areaMax: 1000 });
  assert.ok(r.params.frenteMax * r.params.profundidadeMax >= 1000 - 0.5, "a área máxima digitada tem de ser alcançável");
  assert.ok(r.ajustes.some((x) => /Profundidade máxima ajustada/.test(x)), r.ajustes.join(" | "));
  // área padrão sempre igual a frente × profundidade
  const a = editarMedidas(base, { areaPadrao: 1000 }).params;
  assert.ok(Math.abs(a.frente * a.profundidade - a.areaPadrao) < 0.05 * a.areaPadrao);
  // mínimo federal
  assert.equal(editarMedidas(base, { areaMin: 90 }).params.areaMin, 125);
  // nenhum resultado de edição bloqueia; incoerência injetada bloqueia
  assert.deepEqual(conferirConfiguracao(r.params, 50000).bloqueios, []);
  const ruim = { ...base, areaPadrao: 1000 };
  assert.ok(conferirConfiguracao(ruim, 50000).bloqueios.length > 0);
  // gleba pequena para o lote pedido
  assert.ok(conferirConfiguracao(base, 800).bloqueios.some((x) => /não cabem/.test(x)));
});

