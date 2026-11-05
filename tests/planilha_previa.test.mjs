// Prévia da planilha SIGEF na tela (src/lib/planilha_sigef.ts): as linhas têm
// de ser EXATAMENTE as que gerar-documentos grava na aba perimetro_1 — mesma
// função (montarServico → linhasOds), mesmo mapeamento das linhas do banco.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { previaDaPlanilha } from "../src/lib/planilha_sigef.ts";
import { conferirPlanilha } from "../src/lib/consistencia_sigef.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { ANEL } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const SID = "s1";
const servico = { id: SID, modalidade: "completo", tem_glebas: false, fuso_utm: 24, vertice_inicial: 0, denominacao: "FAZENDA SALGADA VELHA", denominacao_parcela: null, parcela_numero: null };
const cred = { prefixo_vertice: "DSBN", contador_m: 3700, contador_p: 14300, contador_v: 750 };
const linhas = (comCodigo) => ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
  id: `v${ordem}`, servico_id: SID, ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 360 + ordem / 10,
  sigma_pos: 0.01 + ordem / 1000, sigma_h: 0.02, tipo, codigo: comCodigo ? codigo : null, codigo_provisorio: false, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "",
  descritivo: tipo === "M" ? (descritivo || `VIZINHO ${ordem}`) : null, tipo_limite: tipo === "M" ? (tipoLimite ?? "LA1") : null,
  eh_via: tipoLimite === "LA3", cns: null, matricula: null, apelido_txt: null, numerado: false, exibir_planta: true,
}));

/** O que gerar-documentos monta (bloco `vertices: VerticeServico[]`), sem banco. */
function comoGeracao(vs, contadores, realoca) {
  return montarServico({
    fusoUtm: 24, verticeInicialOrdem: 0, prefixo: "DSBN", contadores, estiloCodigo: "oficial",
    vertices: vs.map((v) => ({
      ordem: v.ordem, numTxt: v.num_txt, e: v.e, n: v.n, latGmsStr: null, lonGmsStr: null, h: v.h, sigmaPos: v.sigma_pos, sigmaH: v.sigma_h,
      tipo: v.tipo, metodo: v.metodo, codigoManual: realoca ? null : v.codigo, inserido: false, descritivo: v.descritivo || v.apelido_txt || "",
      tipoLimite: v.tipo_limite, ehVia: v.eh_via, cns: v.cns, matricula: v.matricula, numerado: v.numerado, exibirPlanta: true,
    })),
  }, proj4);
}

const semExtras = (l) => ({ codigo: l.codigo, lonFmt: l.lonFmt, latFmt: l.latFmt, sigmaPos: l.sigmaPos, h: l.h, sigmaH: l.sigmaH, metodo: l.metodo, tipoLimite: l.tipoLimite, cns: l.cns, matricula: l.matricula, descritivo: l.descritivo });

test("vértices já numerados: a prévia é a aba perimetro_1 da geração, linha a linha", () => {
  const vs = linhas(true);
  const p = previaDaPlanilha({ servico, vertices: vs, credenciado: cred });
  assert.equal(p.erro, null);
  assert.equal(p.abas.length, 1);
  assert.deepEqual(p.abas[0].linhas.map(semExtras), comoGeracao(vs, { M: 1, P: 1, V: 1 }, false).linhasOds);
  assert.ok(p.abas[0].linhas.every((l) => !l.previsto), "nenhum código previsto: todos vêm do banco");
  assert.equal(p.realoca, false);
});

test("sem código: a prévia numera pelos próximos números do credenciado, marcados como previstos", () => {
  const vs = linhas(false);
  const p = previaDaPlanilha({ servico, vertices: vs, credenciado: cred });
  assert.equal(p.realoca, true);
  assert.deepEqual(p.abas[0].linhas.map(semExtras), comoGeracao(vs, { M: 3700, P: 14300, V: 750 }, true).linhasOds);
  assert.ok(p.abas[0].linhas.every((l) => l.previsto));
  assert.equal(p.abas[0].linhas[0].codigo.startsWith("DSBN-"), true);
});

test("ordemDoAnel liga cada linha publicada à linha do banco (ordemBanco)", () => {
  const vs = linhas(true);
  const p = previaDaPlanilha({ servico, vertices: vs, credenciado: cred });
  assert.equal(p.ordemDoAnel.length, vs.length);
  assert.deepEqual([...p.ordemDoAnel].sort((a, b) => a - b), vs.map((v) => v.ordem));
  for (const l of p.abas[0].linhas) assert.equal(vs.find((v) => v.ordem === l.ordemBanco).codigo, l.codigo);
});

test("TXT anti-horário: a planilha sai horária e a prévia diz que inverteu", () => {
  const vs = linhas(true).reverse().map((v, i) => ({ ...v, ordem: i }));
  const p = previaDaPlanilha({ servico, vertices: vs, credenciado: cred });
  const p0 = previaDaPlanilha({ servico, vertices: linhas(true), credenciado: cred });
  assert.notEqual(p.abas[0].invertido, p0.abas[0].invertido);
  const avisos = conferirPlanilha(p.abas, { estilo: "oficial", prefixo: "DSBN" });
  assert.ok(!avisos.some((a) => a.regra === "sentido"), "a planilha publicada está sempre no sentido horário");
});

test("conferência de área: códigos no formato da prévia (P-1), sem contador", () => {
  const vs = linhas(false);
  const p = previaDaPlanilha({ servico: { ...servico, modalidade: "conferencia" }, vertices: vs, credenciado: cred });
  assert.equal(p.estilo, "conferencia");
  assert.ok(p.abas[0].linhas.every((l) => /^[MPV]-\d+$/.test(l.codigo)));
});

test("sem fuso: erro claro, sem quebrar", () => {
  const p = previaDaPlanilha({ servico: { ...servico, fuso_utm: null }, vertices: linhas(true), credenciado: cred });
  assert.match(p.erro, /fuso/);
});
