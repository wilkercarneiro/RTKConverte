// "Clico em Confrontantes e vértices e nada aparece" (2026-11-01).
//
// Causa: o mapa interativo (MapLibre) é criado na etapa Confrontantes e
// vértices; num navegador sem WebGL ele lança "Failed to initialize WebGL", e
// sem barreira de erro o React desmontava a aplicação inteira. Junto veio um
// segundo defeito: abrir o serviço já gravava (vértices regravados, "Última
// alteração por …" e auditoria) porque os extras do RT e as glebas, carregados
// depois do primeiro desenho, contavam como edição.
//
// Aqui: a decisão do autossalvamento (pura), a detecção de WebGL e a
// normalização da resposta do SIGEF. O comportamento na tela foi conferido no
// laboratório #/lab/conferencia (?semwebgl, ?glebas, ?quebrar).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { passoAutosave } from "../src/lib/ux.ts";
import { esquecerWebgl, webglDisponivel } from "../src/lib/webgl.ts";
import { normalizarResultadoSigef } from "../src/lib/sigef_resultado.ts";

const S = (o) => JSON.stringify(o);
const inicio = { gravado: null, visto: null, base: false };

test("autossalvamento: abrir a tela não grava (1º valor = o que veio do banco)", () => {
  const p = passoAutosave(inicio, S({ v: 1, rt: null, glebas: [] }), false);
  assert.equal(p.pendente, false);
  assert.equal(p.gravado, S({ v: 1, rt: null, glebas: [] }));
});

test("autossalvamento: glebas que CHEGAM do banco (base muda) não viram edição", () => {
  let m = passoAutosave(inicio, S({ v: 1, glebas: [] }), false);
  m = passoAutosave(m, S({ v: 1, glebas: ["g1"] }), true);
  assert.equal(m.pendente, false, "carregar não é editar");
  assert.equal(m.gravado, S({ v: 1, glebas: ["g1"] }), "o carregado passa a ser o já gravado");
  // depois disso, uma edição de verdade grava
  const e = passoAutosave(m, S({ v: 2, glebas: ["g1"] }), true);
  assert.equal(e.pendente, true);
});

test("autossalvamento: edição pendente ANTES de as glebas chegarem não é engolida", () => {
  let m = passoAutosave(inicio, S({ trt: "", glebas: [] }), false);
  m = passoAutosave(m, S({ trt: "BR123", glebas: [] }), false); // ex.: TRT preenchido pelo RT
  assert.equal(m.pendente, true);
  m = passoAutosave(m, S({ trt: "BR123", glebas: ["g1"] }), true);
  assert.equal(m.pendente, true, "o TRT preenchido continua para gravar");
  assert.equal(m.gravado, S({ trt: "", glebas: [] }), "o já gravado não pulou para o valor novo");
});

test("autossalvamento: sem `base` (outras telas) o comportamento é o de sempre", () => {
  let m = passoAutosave(inicio, S({ a: 1 }), undefined);
  assert.equal(m.pendente, false);
  m = passoAutosave(m, S({ a: 1 }), undefined);
  assert.equal(m.pendente, false, "valor igual: nada a gravar");
  m = passoAutosave(m, S({ a: 2 }), undefined);
  assert.equal(m.pendente, true);
});

test("conferência: extras do RT só entram no autossalvamento quando o operador edita", () => {
  const src = readFileSync(new URL("../src/components/Conferencia.tsx", import.meta.url), "utf8");
  assert.match(src, /rtExtras: rtExtrasEditado \? rtExtras : null/, "valor do autossave");
  assert.match(src, /if \(servico\.rt_id && rtExtrasEditado\)/, "o cadastro do RT só é regravado se editado");
  assert.match(src, /base: glebasCarregadas/, "as glebas carregadas viram base");
  assert.ok(!/onChange=\{\(e\) => setRtExtras\(/.test(src), "todo campo dos extras passa por editarRtExtras");
});

test("WebGL: detectado, guardado, e falha vira false (sem exceção)", () => {
  const doc = globalThis.document;
  try {
    let pedidos = 0;
    globalThis.document = { createElement: () => ({ getContext: () => { pedidos++; return null; } }) };
    esquecerWebgl();
    assert.equal(webglDisponivel(), false, "sem contexto webgl2 nem webgl");
    assert.equal(pedidos, 2);
    webglDisponivel();
    assert.equal(pedidos, 2, "resultado guardado: não cria canvas de novo");

    let perdeu = false;
    globalThis.document = { createElement: () => ({ getContext: (t) => (t === "webgl2" ? { getExtension: () => ({ loseContext: () => { perdeu = true; } }) } : null) }) };
    esquecerWebgl();
    assert.equal(webglDisponivel(), true);
    assert.equal(perdeu, true, "o contexto de teste é devolvido na hora");

    globalThis.document = { createElement: () => { throw new Error("sem DOM"); } };
    esquecerWebgl();
    assert.equal(webglDisponivel(), false);
  } finally {
    globalThis.document = doc;
    esquecerWebgl();
  }
});

test("mapa: criação protegida e aviso no lugar (nada sobe para apagar a tela)", () => {
  const src = readFileSync(new URL("../src/components/MapaInterativo.tsx", import.meta.url), "utf8");
  assert.match(src, /try \{\s*mapa = new maplibregl\.Map\(/, "new Map dentro de try");
  assert.match(src, /webglcontextlost/, "contexto perdido vira aviso");
  assert.match(src, /webglDisponivel\(\) \? null : MOTIVO_SEM_WEBGL/, "sem WebGL nem tenta criar");
  assert.match(src, /try \{ desenhar\(\); \}/, "dado estranho não derruba o desenho");
  const shell = readFileSync(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<BarreiraErro onde="esta tela"/, "toda tela tem barreira dentro da casca");
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /<BarreiraErro onde="o sistema">/, "última rede na raiz");
});

test("SIGEF: resposta incompleta vira o formato que a tela lê", () => {
  for (const ruim of [null, undefined, [], {}, { parcelas: null }, { parcelas: {} }, { sobreposicoes: "x" }]) {
    const r = normalizarResultadoSigef(ruim);
    assert.deepEqual(r.parcelas, { type: "FeatureCollection", features: [] }, JSON.stringify(ruim));
    assert.deepEqual(r.sobreposicoes, []);
  }
  const bom = { parcelas: { type: "FeatureCollection", features: [{ id: 1 }] }, sobreposicoes: [{ codigo: "a" }], encostos: [], area_imovel_m2: 10, largura_min_m: 0.5 };
  assert.deepEqual(normalizarResultadoSigef(bom), bom, "resposta boa passa igual");
  assert.deepEqual(normalizarResultadoSigef({ ...bom, encostos: null }).encostos, []);
});
