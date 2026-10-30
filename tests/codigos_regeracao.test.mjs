// Gerar de novo, sem editar nada, tem de dar o MESMO resultado: mesmo vértice
// inicial, mesmos códigos em cada linha e nenhum número novo do credenciado.
//
// O defeito: num TXT anti-horário o anel é invertido e cada M passa a carregar a
// confrontação do M seguinte (`inverterSentido`). A geração gravava o código de
// cada ponto na linha `conf.ordem` — a linha do M VIZINHO. A 1ª geração saía
// certa (códigos da memória) e a 2ª, lendo do banco, saía com os M trocados: o
// vértice inicial M-0006 virava M-0011 no serviço completo e M-1 virava M-3 na
// conferência. Aqui a "ida ao banco" é `codigosPorLinha`, exatamente o que
// gerar-documentos grava; a volta é o `codigoManual` que ele lê na 2ª geração.
//
// Também: o aviso "sem CPF" de `validarConfrontacoes` aceita CNPJ e não cobra
// documento de faixa de domínio, estrada (LA3) nem rio (LN1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import { calcularVertices, ehSentidoHorario, parseTxt } from "../supabase/functions/_shared/geo.ts";
import { codigosPorLinha, montarPartes, montarServico, validarConfrontacoes } from "../supabase/functions/_shared/servico.ts";
import { entrada } from "./fixtures/salgada_velha.mjs";

const proj4 = (from, to, coords) => proj4lib(from, to, coords);
const pontos = parseTxt(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8"));
const MS = new Set([30, 36, 41, 58, 64, 9]);

/** LARISSA.txt como o banco guarda: linha `ordem` 0..n-1, sem código ainda. */
function linhas(inverter) {
  const base = pontos.map((p) => ({
    numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
    tipo: MS.has(p.num) ? "M" : "P", metodo: "PG6", inserido: false, codigoManual: null,
    descritivo: MS.has(p.num) ? `CONFRONTANTE DO PONTO ${p.num}\\ CPF: 000.000.000-00` : null,
    tipoLimite: MS.has(p.num) ? "LA1" : null, ehVia: false,
  }));
  return (inverter ? base.reverse() : base).map((v, i) => ({ ...v, ordem: i }));
}

/**
 * Duas gerações seguidas do mesmo serviço, como gerar-documentos faz: a 1ª aloca
 * (contadores do credenciado) e grava por linha; a 2ª lê os códigos gravados e
 * não aloca nada (contadores zerados, porque `precisaAlocar` dá falso).
 */
function duasGeracoes(vertices, estiloCodigo, contadores) {
  const inp = { fusoUtm: 24, prefixo: "DSBN", estiloCodigo, vertices };
  const g1 = montarServico({ ...inp, contadores }, proj4);
  const banco = codigosPorLinha(g1.ring);
  assert.equal(banco.size, vertices.length, "toda linha recebe código na 1ª geração");
  const relidos = vertices.map((v) => ({ ...v, codigoManual: banco.get(v.ordem) ?? null }));
  const g2 = montarServico({ ...inp, contadores: { M: 0, P: 0, V: 0 }, vertices: relidos }, proj4);
  return { g1, g2, banco };
}

test("a entrada invertida é de fato anti-horária (exercita a inversão do anel)", () => {
  const calc = (vs) => calcularVertices(vs, 24, proj4);
  assert.ok(ehSentidoHorario(calc(linhas(false))));
  assert.ok(!ehSentidoHorario(calc(linhas(true))));
});

for (const inverter of [false, true]) {
  const sentido = inverter ? "anti-horário" : "horário";

  test(`serviço completo, TXT ${sentido}: a 2ª geração repete o vértice inicial e todos os códigos`, () => {
    const contadores = { M: 6, P: 14300, V: 758 };
    const { g1, g2 } = duasGeracoes(linhas(inverter), "oficial", contadores);
    assert.match(g1.ring[0].codigo, /^DSBN-M-0006$/, "o vértice mais ao norte é M e abre a numeração");
    assert.equal(g2.ring[0].codigo, g1.ring[0].codigo, "vértice inicial mudou entre a 1ª e a 2ª geração");
    assert.deepEqual(g2.ring.map((v) => v.codigo), g1.ring.map((v) => v.codigo));
    // cada ponto físico mantém o seu código (não só a sequência impressa)
    assert.deepEqual(g2.ring.map((v) => v.numTxt), g1.ring.map((v) => v.numTxt));
    // nenhum número novo: a 2ª geração não consome contador algum
    assert.deepEqual(g2.contadoresFinais, { M: 0, P: 0, V: 0 });
    // os M saem em sequência a partir do inicial, sem pular nem repetir
    const ms = g1.ring.filter((v) => v.tipo === "M").map((v) => v.codigo);
    assert.deepEqual(ms, ms.map((_, k) => `DSBN-M-${String(6 + k).padStart(4, "0")}`));
  });

  test(`conferência, TXT ${sentido}: a prévia regerada continua começando em M-1`, () => {
    const { g1, g2 } = duasGeracoes(linhas(inverter), "conferencia", { M: 0, P: 0, V: 0 });
    assert.equal(g1.ring[0].codigo, "M-1");
    assert.equal(g2.ring[0].codigo, "M-1");
    assert.deepEqual(g2.ring.map((v) => v.codigo), g1.ring.map((v) => v.codigo));
  });

  test(`TXT ${sentido}: o código gravado em cada linha é o do próprio ponto`, () => {
    const vs = linhas(inverter);
    const g = montarServico({ fusoUtm: 24, prefixo: "DSBN", contadores: { M: 1, P: 1, V: 1 }, vertices: vs }, proj4);
    const banco = codigosPorLinha(g.ring);
    for (const v of g.ring) {
      const linha = vs.find((x) => x.ordem === v.ordemBanco);
      assert.equal(linha.numTxt, v.numTxt, `linha ${v.ordemBanco} recebeu o código do ponto ${v.numTxt}`);
      assert.equal(linha.tipo, v.tipo);
      assert.equal(banco.get(linha.ordem), v.codigo);
    }
  });
}

test("serviço em partes (uma delas anti-horária): regerar não troca código de linha nenhuma", () => {
  const base = entrada({ comCodigo: false });
  const n = base.vertices.length;
  // a 2ª parte é a mesma fazenda 2 km a leste, digitada no sentido contrário
  const copia = base.vertices.slice().reverse().map((v, i) => ({ ...v, ordem: n + i, numTxt: 101 + i, e: v.e + 2000 }));
  const vertices = [...base.vertices, ...copia];
  const partes = [
    { nome: "PARTE A", ordens: base.vertices.map((v) => v.ordem) },
    { nome: "PARTE B", ordens: copia.map((v) => v.ordem) },
  ];
  const inp = { ...base, vertices, contadores: { M: 6, P: 100, V: 1 } };
  const g1 = montarPartes(inp, partes, proj4);
  const banco = codigosPorLinha(g1.partes.flatMap((pt) => pt.calc.ring));
  assert.equal(banco.size, vertices.length);
  const relidos = vertices.map((v) => ({ ...v, codigoManual: banco.get(v.ordem) }));
  const g2 = montarPartes({ ...inp, contadores: { M: 0, P: 0, V: 0 }, vertices: relidos }, partes, proj4);
  for (let k = 0; k < 2; k++) {
    assert.deepEqual(g2.partes[k].calc.ring.map((v) => v.codigo), g1.partes[k].calc.ring.map((v) => v.codigo));
  }
  assert.deepEqual(g2.contadoresFinais, { M: 0, P: 0, V: 0 });
  // nenhum código repetido entre as linhas
  assert.equal(new Set(banco.values()).size, banco.size);
});

// ---------------------------------------------------------------------------
// aviso de documento do confrontante
// ---------------------------------------------------------------------------
const avisosDe = (v) => validarConfrontacoes([{ tipo: "M", codigo: "DSBN-M-0001", ...v }]).avisos;
const semDoc = (avisos) => avisos.filter((a) => /sem CPF/.test(a));

test("confrontante com CPF ou CNPJ não gera aviso de documento", () => {
  assert.deepEqual(semDoc(avisosDe({ descritivo: "MARIA NINA DA SILVA COSTA\\ CPF:666.186.815-53" })), []);
  assert.deepEqual(semDoc(avisosDe({ descritivo: "ASSOCIAÇÃO DOS PEQUENOS PRODUTORES\\ CNPJ: 12.345.678/0001-95" })), []);
});

test("estrada, rio e faixa de domínio não precisam de CPF/CNPJ", () => {
  // marcada como faixa de domínio pela tela
  assert.deepEqual(semDoc(avisosDe({ descritivo: "ESTRADA VICINAL", eh_via: true, tipo_limite: "LA1" })), []);
  // LA3 vale como via sozinho, mesmo sem a marca
  assert.deepEqual(semDoc(avisosDe({ descritivo: "BA 408", eh_via: false, tipo_limite: "LA3" })), []);
  // LN1 é curso d'água
  assert.deepEqual(semDoc(avisosDe({ descritivo: "RIO ITAPICURU", eh_via: false, tipo_limite: "LN1" })), []);
});

test("pessoa sem CPF/CNPJ continua avisada, com o texto novo", () => {
  const a = semDoc(avisosDe({ descritivo: "(POSSE) FAZENDA LAMEIRO\\ JOSÉ DA SILVA", eh_via: false, tipo_limite: "LA1" }));
  assert.equal(a.length, 1);
  assert.match(a[0], /DSBN-M-0001/);
  assert.match(a[0], /está sem CPF\/CNPJ/);
  // linha crua do banco sem as colunas novas (dado legado) também avisa
  assert.equal(semDoc(avisosDe({ descritivo: "JOÃO SEM DOCUMENTO" })).length, 1);
});
