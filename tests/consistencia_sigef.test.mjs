// Avisos de consistência da planilha do SIGEF (src/lib/consistencia_sigef.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { conferirPlanilha, contarNiveis, SIGMA_MAX_ARTIFICIAL_M } from "../src/lib/consistencia_sigef.ts";

const CTX = { estilo: "oficial", prefixo: "DSBN" };

/** Quadrado 100 × 100 m, sentido horário, começando no canto NO (o mais ao norte, empatado com NE: o 1º). */
function quadrado(over = {}) {
  const cantos = [[500000, 8800100], [500100, 8800100], [500100, 8800000], [500000, 8800000]];
  return cantos.map(([e, n], i) => ({
    codigo: `DSBN-${i === 0 || i === 2 ? "M" : "P"}-${String(i < 2 ? 10 + i : 9 + i).padStart(4, "0")}`,
    tipo: i === 0 || i === 2 ? "M" : "P",
    inserido: false, ordemBanco: i,
    sigmaPos: 0.01 + i / 1000, sigmaH: 0.02 + i / 1000, h: 300 + i,
    metodo: "PG6", tipoLimite: "LA1", descritivo: "VIZINHO", iniciaTrecho: i === 0 || i === 2,
    eProj: e, nProj: n, latDeg: -10 - (8800100 - n) / 111000, lonDeg: -39 + (e - 500000) / 111000,
    ...(typeof over === "function" ? over(i) : over),
  }));
}
// códigos sequenciais por tipo: M-0010, P-0011? não — numera por tipo
function codigos(ls) {
  const c = { M: 1, P: 1, V: 1 };
  return ls.map((l) => ({ ...l, codigo: `DSBN-${l.tipo}-${String(c[l.tipo]++).padStart(4, "0")}` }));
}
const regras = (ls, extra = {}) => conferirPlanilha([{ aba: "perimetro_1", linhas: ls, ...extra }], CTX).map((a) => a.regra);

test("planilha boa: nenhum erro nem alerta", () => {
  const av = conferirPlanilha([{ aba: "perimetro_1", linhas: codigos(quadrado()) }], CTX);
  assert.deepEqual(av, []);
});

test("todos M → alerta; nenhum M → alerta", () => {
  assert.ok(regras(codigos(quadrado(() => ({ tipo: "M", iniciaTrecho: true })))).includes("todos_m"));
  assert.ok(regras(codigos(quadrado(() => ({ tipo: "P", iniciaTrecho: false })))).includes("sem_m"));
});

test("sigma igual em todos → alerta; sigma acima de 0,50 m em limite artificial → erro no vértice", () => {
  assert.ok(regras(codigos(quadrado({ sigmaPos: 0.015, sigmaH: 0.03 }))).includes("sigma_igual"));
  const ls = codigos(quadrado((i) => (i === 1 ? { sigmaPos: SIGMA_MAX_ARTIFICIAL_M + 0.01 } : {})));
  const av = conferirPlanilha([{ aba: "perimetro_1", linhas: ls }], CTX).find((a) => a.regra === "sigma_acima");
  assert.equal(av.nivel, "erro");
  assert.deepEqual(av.vertices.map((v) => v.linha), [1]);
  assert.equal(av.vertices[0].codigo, ls[1].codigo);
});

test("limite natural (LN) aceita até 3,00 m; vértice entre LA e LN usa o mais exigente", () => {
  // todos os lados naturais: 2 m passa
  const nat = codigos(quadrado((i) => ({ tipoLimite: "LN1", ...(i === 1 ? { sigmaPos: 2 } : {}) })));
  assert.ok(!regras(nat).includes("sigma_acima"));
  // vértice 2 recebe lado LA1 (do 1) e sai em LN1: vale 0,50
  const misto = codigos(quadrado((i) => ({ tipoLimite: i >= 2 ? "LN1" : "LA1", ...(i === 2 ? { sigmaPos: 2 } : {}) })));
  assert.ok(regras(misto).includes("sigma_acima"));
});

test("método ausente ou inválido → erro", () => {
  assert.ok(regras(codigos(quadrado((i) => (i === 3 ? { metodo: "" } : {})))).includes("metodo_invalido"));
  assert.ok(regras(codigos(quadrado((i) => (i === 3 ? { metodo: "RTK" } : {})))).includes("metodo_invalido"));
});

test("códigos: repetido, sem código, formato, tipo trocado, prefixo de outro credenciado, fora da sequência", () => {
  const base = codigos(quadrado());
  assert.ok(regras(base.map((l, i) => (i === 3 ? { ...l, codigo: base[1].codigo } : l))).includes("codigo_repetido"));
  assert.ok(regras(base.map((l, i) => (i === 3 ? { ...l, codigo: "" } : l))).includes("sem_codigo"));
  assert.ok(regras(base.map((l, i) => (i === 3 ? { ...l, codigo: "PONTO 4" } : l))).includes("codigo_formato"));
  assert.ok(regras(base.map((l, i) => (i === 0 ? { ...l, codigo: "DSBN-P-0099" } : l))).includes("codigo_tipo"));
  assert.ok(regras(base.map((l, i) => (i === 3 ? { ...l, codigo: "ABCD-P-0002" } : l))).includes("codigo_prefixo"));
  assert.ok(regras(base.map((l, i) => (i === 3 ? { ...l, codigo: "DSBN-P-0007" } : l))).includes("codigo_sequencia"));
  // aba de gleba usa os códigos do imóvel: a sequência não é cobrada
  assert.ok(!regras(base.map((l, i) => (i === 3 ? { ...l, codigo: "DSBN-P-0007" } : l)), { deGleba: true }).includes("codigo_sequencia"));
  // vértice certificado do vizinho (inserido) com outro prefixo é normal
  assert.ok(!regras(base.map((l, i) => (i === 3 ? { ...l, codigo: "ABCD-V-0758", tipo: "V", inserido: true, metodo: "PA1" } : l))).includes("codigo_prefixo"));
});

test("confrontação: sem tipo de limite → erro; trecho sem confrontante → alerta no M que o abre", () => {
  assert.ok(regras(codigos(quadrado((i) => (i === 1 ? { tipoLimite: "" } : {})))).includes("sem_tipo_limite"));
  const av = conferirPlanilha([{ aba: "perimetro_1", linhas: codigos(quadrado((i) => (i >= 2 ? { descritivo: "" } : {}))) }], CTX)
    .find((a) => a.regra === "sem_confrontante");
  assert.deepEqual(av.vertices.map((v) => v.linha), [2]);
});

test("geometria: fechamento repetido, ponto duplicado, lado curto, polígono que cruza", () => {
  const q = codigos(quadrado());
  const fechado = codigos([...quadrado(), { ...quadrado()[0], tipo: "P", iniciaTrecho: false }]);
  assert.ok(regras(fechado).includes("fechamento_repetido"));
  const dup = codigos([q[0], q[1], { ...q[1], ordemBanco: 9, tipo: "P", iniciaTrecho: false }, q[2], q[3]]);
  assert.ok(regras(dup).includes("ponto_duplicado"));
  const curto = codigos([q[0], { ...q[1], eProj: q[1].eProj - 0.2 }, { ...q[1], ordemBanco: 9 }, q[2], q[3]]);
  assert.ok(regras(curto).includes("lado_curto"));
  // laço: troca a ordem de dois cantos
  const laco = codigos([q[0], q[2], q[1], q[3]]);
  assert.ok(regras(laco).includes("poligono_cruza"));
});

test("sentido anti-horário → erro; invertido na montagem → só informação", () => {
  const q = codigos(quadrado());
  const anti = [q[0], q[3], q[2], q[1]];
  assert.ok(regras(anti).includes("sentido"));
  const av = conferirPlanilha([{ aba: "perimetro_1", linhas: q, invertido: true }], CTX);
  assert.equal(av.find((a) => a.regra === "sentido_invertido").nivel, "info");
  assert.equal(contarNiveis(av).erros, 0);
});

test("erros vêm antes dos alertas", () => {
  const ls = codigos(quadrado((i) => ({ tipo: "M", iniciaTrecho: true, ...(i === 1 ? { metodo: "" } : {}) })));
  const av = conferirPlanilha([{ aba: "perimetro_1", linhas: ls }], CTX);
  const niveis = av.map((a) => a.nivel);
  assert.deepEqual(niveis, [...niveis].sort((a, b) => ["erro", "alerta", "info"].indexOf(a) - ["erro", "alerta", "info"].indexOf(b)));
});
