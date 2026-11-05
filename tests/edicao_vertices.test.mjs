// Edição de vértices em lote (src/lib/edicao_vertices.ts): renomear com padrão
// (na ordem da tabela ou do anel publicado) e inserir ponto num lado.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarRenomeacao, avisosDaRenomeacao, desfazerRenomeacao, ehCodigoOficial, inserirNoLado, previaRenomeacao, tipoHerdado,
} from "../src/lib/edicao_vertices.ts";
import { previaDaPlanilha } from "../src/lib/planilha_sigef.ts";
import { conferirPlanilha } from "../src/lib/consistencia_sigef.ts";
import { ANEL } from "./fixtures/salgada_velha.mjs";

const SID = "s1";
const servico = { id: SID, modalidade: "completo", tem_glebas: false, fuso_utm: 24, vertice_inicial: 0, denominacao_parcela: null, parcela_numero: null };
const cred = { prefixo_vertice: "DSBN", contador_m: 3700, contador_p: 14300, contador_v: 750 };
const base = () => ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
  id: `v${ordem}`, servico_id: SID, ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 360 + ordem,
  sigma_pos: 0.01 + ordem / 1000, sigma_h: 0.02 + ordem / 1000, tipo, codigo, codigo_provisorio: false, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "",
  descritivo: tipo === "M" ? (descritivo || `VIZINHO ${ordem}`) : null, tipo_limite: tipo === "M" ? (tipoLimite ?? "LA1") : null,
  eh_via: tipoLimite === "LA3", cns: null, matricula: null, apelido_txt: null, numerado: false, exibir_planta: true,
}));

test("a fixture real só acusa o que está errado de fato: o M que guardou código de P", () => {
  // SALGADA VELHA, ordem 14: virou M (LINHA FERREA) depois de numerado, e
  // ficou com DSBN-P-14312 — a letra do código não bate com o tipo
  const p = previaDaPlanilha({ servico, vertices: base(), credenciado: cred });
  const erros = conferirPlanilha(p.abas, { estilo: "oficial", prefixo: "DSBN" }).filter((a) => a.nivel === "erro");
  assert.deepEqual(erros.map((e) => e.regra), ["codigo_tipo"]);
  assert.deepEqual(erros[0].vertices.map((v) => v.codigo), ["DSBN-P-14312"]);
  assert.equal(erros[0].vertices[0].ordemBanco, 14);
});

test("renomear os P na ordem da tabela: prefixo + início + passo + dígitos", () => {
  const vs = base();
  const r = previaRenomeacao(vs, (v) => v.tipo === "P", { prefixo: "DSBN-P-", inicio: 100, passo: 2, digitos: 4, ordem: "tabela" });
  const ps = vs.filter((v) => v.tipo === "P");
  assert.equal(r.mudancas.length, ps.length);
  assert.deepEqual(r.mudancas.slice(0, 3).map((m) => m.depois), ["DSBN-P-0100", "DSBN-P-0102", "DSBN-P-0104"]);
  assert.equal(r.mudancas[0].ordem, ps[0].ordem);
  assert.deepEqual(r.conflitos, []);
});

test("{T} numera cada tipo separado", () => {
  const vs = base();
  const r = previaRenomeacao(vs, () => true, { prefixo: "X-{T}-", inicio: 1, passo: 1, digitos: 2, ordem: "tabela" });
  const m = r.mudancas.filter((x) => x.tipo === "M").map((x) => x.depois);
  assert.equal(m[0], "X-M-01");
  assert.equal(m[1], "X-M-02");
  assert.equal(r.mudancas.find((x) => x.tipo === "P").depois, "X-P-01");
});

test("na ordem do anel: o 1º número vai ao vértice mais ao norte, pela linha do banco (ordemBanco)", () => {
  // o TXT invertido: a ordem da tabela é o contrário da planilha
  const vs = base().reverse().map((v, i) => ({ ...v, ordem: i }));
  const p = previaDaPlanilha({ servico, vertices: vs, credenciado: cred });
  const r = previaRenomeacao(vs, () => true, { prefixo: "Z-", inicio: 1, passo: 1, digitos: 3, ordem: "anel" }, { ordemDoAnel: p.ordemDoAnel });
  const novos = aplicarRenomeacao(vs, r.mudancas);
  const depois = previaDaPlanilha({ servico, vertices: novos, credenciado: cred });
  // a planilha publicada sai Z-001, Z-002, … na ordem das linhas
  assert.deepEqual(depois.abas[0].linhas.map((l) => l.codigo), vs.map((_, i) => `Z-${String(i + 1).padStart(3, "0")}`));
});

test("conflito: nome novo já usado fora da seleção, ou repetido no próprio lote", () => {
  const vs = base();
  const um = vs.find((v) => v.tipo === "P" && v.codigo);
  // renumerar os outros P a partir do número de um P que ficou de fora: colide com ele
  const r2 = previaRenomeacao(vs, (v) => v.ordem !== um.ordem && v.tipo === "P", { prefixo: um.codigo.slice(0, -4), inicio: Number(um.codigo.slice(-4)), passo: 1, digitos: 4, ordem: "tabela" });
  assert.ok(r2.conflitos.includes(um.codigo));
  const r3 = previaRenomeacao(vs, (v) => v.tipo === "P", { prefixo: "MESMO", inicio: 1, passo: 0, digitos: 0, ordem: "tabela" });
  assert.equal(r3.mudancas[1].depois, "MESMO2", "passo 0 vale como 1");
});

test("código oficial: marcado na mudança e avisado; desfazer volta o código e a marca de prévia", () => {
  const vs = base().map((v, i) => (i === 0 ? { ...v, codigo_provisorio: true } : v));
  assert.equal(ehCodigoOficial(vs[1]), true);
  assert.equal(ehCodigoOficial(vs[0]), false);
  assert.equal(ehCodigoOficial({ codigo: "P-1", codigo_provisorio: false, inserido_manual: false }), false);
  const r = previaRenomeacao(vs, (v) => v.ordem <= 1, { prefixo: "NOVO-", inicio: 1, passo: 1, digitos: 1, ordem: "tabela" });
  assert.deepEqual(r.mudancas.map((m) => m.oficial), [false, true]);
  const av = avisosDaRenomeacao(vs, r, { conferencia: false, prefixo: "DSBN", contadores: { M: 3700, P: 14300, V: 750 } });
  assert.ok(av.some((a) => /código oficial/.test(a)));
  const aplicado = aplicarRenomeacao(vs, r.mudancas);
  assert.equal(aplicado[0].codigo, "NOVO-1");
  assert.equal(aplicado[0].codigo_provisorio, false);
  const volta = desfazerRenomeacao(aplicado, r.mudancas);
  assert.deepEqual(volta, vs);
});

test("avisos: vértice sem código faz a geração renumerar tudo; número do credenciado fora do reservado", () => {
  const vs = base().map((v, i) => (i === 3 ? { ...v, codigo: null } : v));
  const r = previaRenomeacao(vs, (v) => v.ordem === 0, { prefixo: "DSBN-M-", inicio: 9000, passo: 1, digitos: 4, ordem: "tabela" });
  const av = avisosDaRenomeacao(vs, r, { conferencia: false, prefixo: "DSBN", contadores: { M: 3700, P: 14300, V: 750 } });
  assert.ok(av.some((a) => /renumera TODOS/.test(a)));
  assert.ok(av.some((a) => /ainda não reservou/.test(a)));
  const r2 = previaRenomeacao(vs, (v) => v.ordem === 0, { prefixo: "DSBN-M-", inicio: 12, passo: 1, digitos: 4, ordem: "tabela" });
  assert.ok(avisosDaRenomeacao(vs, r2, { conferencia: false, prefixo: "DSBN", contadores: { M: 3700, P: 14300, V: 750 } }).some((a) => /já passado/.test(a)));
  const conf = avisosDaRenomeacao(vs, r, { conferencia: true, prefixo: null });
  assert.ok(conf.some((a) => /formato da prévia/.test(a)));
});

test("inserir no meio do lado: E/N no meio, h interpolada, σ do pior, PA1, ordens seguintes deslocadas", () => {
  const vs = base();
  const a = vs[1], b = vs[2];
  const { vertices, novo, ladoM, distanciaM } = inserirNoLado(vs, { ordem: 1, posicao: { modo: "meio" }, servicoId: SID });
  assert.equal(vertices.length, vs.length + 1);
  assert.equal(novo.ordem, 2);
  assert.deepEqual(vertices.map((v) => v.ordem), vertices.map((_, i) => i), "ordens contínuas 0..n");
  assert.ok(Math.abs(novo.e - (a.e + b.e) / 2) < 0.001 && Math.abs(novo.n - (a.n + b.n) / 2) < 0.001);
  assert.equal(novo.h, Math.round(((a.h + b.h) / 2) * 1000) / 1000);
  assert.equal(novo.sigma_pos, Math.max(a.sigma_pos, b.sigma_pos));
  assert.equal(novo.sigma_h, Math.max(a.sigma_h, b.sigma_h));
  assert.equal(novo.metodo, "PA1");
  assert.ok(Math.abs(distanciaM - ladoM / 2) < 1e-9);
  // os vértices de depois mantêm id, código e confrontação; só a ordem anda
  const antes = vs.find((v) => v.ordem === 2), agora = vertices.find((v) => v.id === antes.id);
  assert.equal(agora.ordem, 3);
  assert.equal(agora.codigo, antes.codigo);
});

test("inserir a uma distância; fora do lado → erro claro", () => {
  const vs = base();
  const r = inserirNoLado(vs, { ordem: 0, posicao: { modo: "distancia", metros: 1.5 }, servicoId: SID });
  const a = vs[0];
  assert.ok(Math.abs(Math.hypot(r.novo.e - a.e, r.novo.n - a.n) - 1.5) < 0.002);
  assert.throws(() => inserirNoLado(vs, { ordem: 0, posicao: { modo: "distancia", metros: r.ladoM + 1 }, servicoId: SID }), /comprimento do lado/);
  // o último vértice abre o lado que fecha o anel (último → primeiro)
  const ult = vs[vs.length - 1];
  const f = inserirNoLado(vs, { ordem: ult.ordem, posicao: { modo: "meio" }, servicoId: SID });
  assert.equal(f.novo.ordem, vs.length);
});

test("reserva de número: código já usado no serviço → reserva o próximo; 5 repetidos → recusa clara", async () => {
  const { reservarCodigoLivre } = await import("../src/lib/edicao_vertices.ts");
  const usados = ["DSBN-P-0100", "DSBN-P-0101", null, "DSBN-M-0001"];
  let n = 100;
  const pedidos = [];
  const reservar = async () => { pedidos.push(n); return `DSBN-P-${String(n++).padStart(4, "0")}`; };
  assert.equal(await reservarCodigoLivre(reservar, usados), "DSBN-P-0102");
  assert.deepEqual(pedidos, [100, 101, 102]);
  // contador muito atrás: depois de 5 tentativas recusa (sem inserir código repetido)
  const todos = Array.from({ length: 10 }, (_, i) => `DSBN-P-${String(200 + i).padStart(4, "0")}`);
  n = 200;
  await assert.rejects(reservarCodigoLivre(reservar, todos), /5 números que já estão neste serviço.*credenciado/);
  assert.equal(n, 205, "cinco reservas, nenhuma a mais");
});

test("desfazer a inserção pelo id: tira o ponto, devolve as ordens e guarda as edições de depois", async () => {
  const { desfazerInsercao } = await import("../src/lib/edicao_vertices.ts");
  const vs = base();
  const r = inserirNoLado(vs, { ordem: 3, posicao: { modo: "meio" }, servicoId: SID });
  // depois da inserção, a pessoa edita outro vértice (antes e depois do ponto)
  const editados = r.vertices.map((v) => (v.id === "v1" ? { ...v, descritivo: "VIZINHO NOVO" } : v.id === "v8" ? { ...v, h: 999 } : v));
  const d = desfazerInsercao(editados, r.novo);
  assert.equal(d.ok, true);
  assert.equal(d.vertices.length, vs.length);
  assert.ok(!d.vertices.some((v) => v.id === r.novo.id));
  assert.deepEqual([...d.vertices].sort((a, b) => a.ordem - b.ordem).map((v) => v.id), vs.map((v) => v.id), "cada um volta à sua ordem");
  assert.equal(d.vertices.find((v) => v.id === "v1").descritivo, "VIZINHO NOVO", "edição anterior preservada");
  assert.equal(d.vertices.find((v) => v.id === "v8").h, 999, "edição posterior ao ponto preservada");
  // ponto apagado ou alterado: não desfaz
  assert.deepEqual(desfazerInsercao(editados.filter((v) => v.id !== r.novo.id), r.novo), { ok: false, motivo: "apagado" });
  const mexido = editados.map((v) => (v.id === r.novo.id ? { ...v, e: v.e + 1 } : v));
  assert.deepEqual(desfazerInsercao(mexido, r.novo), { ok: false, motivo: "alterado" });
});

test("tipo e confrontação herdados do lado: P sem confrontação; M copia o trecho e a planilha não muda de confrontante", () => {
  const vs = base();
  assert.equal(tipoHerdado({ tipo: "M" }, { tipo: "M" }), "P");
  assert.equal(tipoHerdado({ tipo: "M" }, { tipo: "V" }), "V");
  assert.equal(tipoHerdado({ tipo: "P" }, { tipo: "M" }), "P");
  const iM = vs.findIndex((v) => v.tipo === "M");
  const p = inserirNoLado(vs, { ordem: vs[iM].ordem, posicao: { modo: "meio" }, servicoId: SID });
  assert.equal(p.novo.tipo, tipoHerdado(vs[iM], vs[iM + 1]));
  if (p.novo.tipo !== "M") assert.equal(p.novo.descritivo, null);
  const m = inserirNoLado(vs, { ordem: vs[iM].ordem, posicao: { modo: "meio" }, tipo: "M", servicoId: SID });
  assert.equal(m.novo.descritivo, vs[iM].descritivo);
  assert.equal(m.novo.tipo_limite, vs[iM].tipo_limite);
  // a planilha: o ponto novo sai com o mesmo confrontante e tipo de limite do lado
  const prev = previaDaPlanilha({ servico, vertices: m.vertices, credenciado: cred });
  const linha = prev.abas[0].linhas.find((l) => l.ordemBanco === m.novo.ordem);
  assert.equal(linha.descritivo, vs[iM].descritivo);
  assert.equal(linha.tipoLimite, vs[iM].tipo_limite);
});

test("vértice sem E/N (V digitado): usa o conversor de quem chama; sem ele, erro", () => {
  const vs = base().map((v, i) => (i === 1 ? { ...v, e: null, n: null } : v));
  assert.throws(() => inserirNoLado(vs, { ordem: 1, posicao: { modo: "meio" }, servicoId: SID }), /UTM/);
  const orig = base()[1];
  const r = inserirNoLado(vs, { ordem: 1, posicao: { modo: "meio" }, servicoId: SID, utmDe: (v) => (v.ordem === 1 ? [orig.e, orig.n] : null) });
  assert.ok(Number.isFinite(r.novo.e));
});
