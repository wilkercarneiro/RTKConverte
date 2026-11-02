// Linha central (docs/plano-linha-central.md, etapa 1): a quadra de duas fileiras
// gerada da estrutura — fundo com fundo por construção, laterais no esquadro da
// própria rua, áreas iguais, arco da esquina como uma quina e dobra de rua
// recebendo divisa. E o mesmo no projeto: "Ajustar fundo com fundo" grava a
// estrutura, o cálculo gera os lotes e o arranjo se repete igual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { perimetro } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo, normalizarProjeto } from "../src/lib/loteamento/modelo.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { estruturar, montar, montarMelhor, cruzamentos, notaDe } from "../src/lib/loteamento/linhaCentral.ts";
import { fixarEstrutura, pedirEstrutura, voltarAoAutomatico } from "../src/lib/loteamento/edicao.ts";
import { intersecao, areaPols, quinasDetalhe } from "../src/lib/loteamento/geom.ts";

const arco = (c, r, a0, a1, passos) => Array.from({ length: passos + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / passos; return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]; });
function retangulo(w, h, R) {
  return [...arco([w - R, R], R, -Math.PI / 2, 0, 9), ...arco([w - R, h - R], R, 0, Math.PI / 2, 9), ...arco([R, h - R], R, Math.PI / 2, Math.PI, 9), ...arco([R, R], R, Math.PI, 1.5 * Math.PI, 9)];
}
const faixa = (L) => { const a = L.lotes.map((l) => l.area); return [Math.min(...a), Math.max(...a)]; };
const giroMax = (L) => Math.max(0, ...L.lotes.flatMap((l) => l.giroLat.filter(Number.isFinite)));

test("motor: retângulo com esquinas de raio 6 — 40 lotes iguais, laterais no esquadro, fundo com fundo", () => {
  const anel = retangulo(200, 50, 6);
  const L = montar(estruturar(anel, anel.map(() => "rua")), { N: 40, profMin: 15 });
  assert.equal(L.lotes.length, 40);
  const [mn, mx] = faixa(L);
  assert.ok(mx - mn < 0.01, `áreas ${mn}–${mx}`);
  assert.ok(giroMax(L) < 0.5, `giro ${giroMax(L)}`);
  assert.equal(L.juncoes.length, 19, "19 divisas fundo com fundo (20 colunas)");
  assert.equal(cruzamentos(L), 0);
  // o arco da esquina é uma quina: os lotes de esquina têm 4
  for (const l of L.lotes) assert.ok(quinasDetalhe(l.anel).length <= 4);
});

test("motor: ruas que se abrem, rua com dobra de 20° e triângulo com ponta — áreas iguais e nenhuma 5ª quina", () => {
  const casos = [
    { anel: [[0, 0], [220, 0], [220, 70], [0, 40]], N: 44 },
    { anel: [[0, 0], [110, 0], [215, 38], [215, 95], [0, 55]], N: 44 },
    { anel: [[0, 0], [260, 0], [0, 70]], N: 30 },
  ];
  for (const { anel, N } of casos) {
    const L = montarMelhor(estruturar(anel, anel.map(() => "rua")), { N, profMin: 15, profPadrao: 25 });
    const n = notaDe(L, N);
    assert.equal(L.lotes.length, N);
    assert.equal(n.q5, 0, "nenhum lote com 5 quinas");
    assert.equal(cruzamentos(L), 0);
    // miolo exato; a esquina pode absorver a cabeceira inclinada (até 75% a mais)
    assert.ok(n.desvio < 0.75, `desvio ${n.desvio}`);
  }
});

// --- no projeto: a proposta automática do loteamento de teste
function base() {
  const pr = projetoNovo("TESTE", perimetro.pts.length);
  pr.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
  return pr;
}
const pr0 = gerarPropostas(base(), perimetro, { quantas: 1 })[0].projeto;
const r0 = calcular(pr0, perimetro);

test("projeto: \"Ajustar fundo com fundo\" estrutura a quadra, grava a linha e o recálculo dá o mesmo arranjo", () => {
  // uma quadra de duas fileiras da proposta
  const q = r0.quadras.find((x) => x.fileiras === 2 && x.lotes.length >= 12);
  assert.ok(q, "a proposta tem quadra de duas fileiras");
  const { pr: pr1, i } = pedirEstrutura(pr0, r0, q);
  const r1 = calcular(pr1, perimetro);
  const q1 = r1.quadras.find((x) => x.cfg === i);
  assert.ok(q1?.estruturada, `a quadra virou estruturada: ${q1?.problemas.join("; ")}`);
  assert.equal(q1.lotes.length, q.lotes.length, "mesma quantidade de lotes");
  // nada se sobrepõe e a área loteada da quadra fecha
  for (let a = 0; a < q1.lotes.length; a++) for (let b = a + 1; b < q1.lotes.length; b++) {
    const s = areaPols(intersecao([q1.lotes[a].pol], [q1.lotes[b].pol]));
    assert.ok(s < 0.05, `${q1.lotes[a].id} × ${q1.lotes[b].id}: ${s}`);
  }
  // a linha gravada repete o arranjo
  const pr2 = fixarEstrutura(pr1, r1, i);
  assert.ok(pr2.quadras[i].estrutura?.linhaCentral?.length >= 2, "linha central gravada em UTM");
  const r2 = calcular(pr2, perimetro);
  const q2 = r2.quadras.find((x) => x.cfg === i);
  const areas = (qq) => qq.lotes.map((l) => l.area.toFixed(2)).sort().join(",");
  assert.equal(areas(q2), areas(q1));
  // nenhuma quina a mais e o fundo com fundo: os pares dividem o fundo
  for (const l of q2.lotes) assert.ok(!l.problemas.some((p) => p.includes("quinas")), `${l.id}: ${l.problemas}`);
  // "Voltar ao automático" desfaz a estrutura
  const pr3 = voltarAoAutomatico(pr2, q2, r2.plano);
  assert.equal(pr3.quadras[i].estrutura, undefined);
});

// --- o projeto real do EDILSON (estado de produção de 2026-11-01, fora do Git)
const EDILSON = new URL("./corpus-real/edilson/", import.meta.url);
const temEdilson = existsSync(new URL("atual_2026-11-01.json", EDILSON)) && existsSync(new URL("Arquivo_de_Coordenadas_Formatado.txt", EDILSON));

test("EDILSON real: quadras A, C e D estruturadas — sem avisos de lote", { skip: !temEdilson && "sem o corpus local do EDILSON" }, () => {
  const linhas = readFileSync(new URL("Arquivo_de_Coordenadas_Formatado.txt", EDILSON), "utf8").split(/\r?\n/).filter((l) => /^\d/.test(l));
  const num = (s) => Number(s.replace(",", "."));
  const per = {
    pts: linhas.map((l) => { const c = l.split(";"); return [num(c[1]), num(c[2])]; }),
    altitudes: linhas.map((l) => num(l.split(";")[3])),
    confrontantes: linhas.map((_, k) => (k >= 3 && k <= 14 ? "ESTRADA" : "DIVISA")),
  };
  const bruto = JSON.parse(readFileSync(new URL("atual_2026-11-01.json", EDILSON), "utf8"));
  let pr = normalizarProjeto(bruto, bruto.nome, per.pts.length);
  let res = calcular(pr, per);
  const avisosAntes = res.problemas.filter((p) => p.texto.startsWith("Lote")).length;
  assert.equal(avisosAntes, 4, "estado de produção: A-16, A-19, A-26, D-28");
  for (const nome of ["A", "C", "D"]) {
    const q = res.quadras.find((x) => x.nome === nome);
    const n = q.lotes.length;
    const { pr: p1, i } = pedirEstrutura(pr, res, q);
    const r1 = calcular(p1, per);
    pr = fixarEstrutura(p1, r1, i);
    res = calcular(pr, per);
    const q2 = res.quadras.find((x) => x.cfg === i);
    assert.ok(q2?.estruturada, `${nome} estruturada`);
    assert.equal(q2.lotes.length, n, `${nome}: mesma quantidade de lotes`);
    assert.deepEqual(q2.lotes.filter((l) => l.problemas.length).map((l) => `${l.id}: ${l.problemas}`), [], `${nome} sem avisos`);
  }
  assert.equal(res.problemas.filter((p) => p.texto.startsWith("Lote")).length, 0, "o projeto fica sem avisos de lote");
  assert.equal(res.lotes.length, 136);
  assert.ok(res.quadro.sobras < 0.01, "nenhuma sobra rosa");
});
