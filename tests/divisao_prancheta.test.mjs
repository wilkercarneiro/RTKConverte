// A divisão na prancheta do loteamento (src/lib/divisao_prancheta.ts): as
// partes do motor entram como lotes desenhados de uma quadra só, o operador
// mexe com as ferramentas do loteamento e os lotes voltam a ser partes — com os
// marcos no perímetro e as áreas fechando o imóvel.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { sugerirDivisoes } from "../src/lib/divisao.ts";
import { aplicarDivisao, entradaDoServico, medidasDasPartes, publicadorUtm, ROTULO_DIVISAO } from "../src/lib/divisao_servico.ts";
import { anelBruto, aneisDosLotes, limparAvisos, perimetroDaDivisao, projetoDaDivisao, resultadoDosLotes } from "../src/lib/divisao_prancheta.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { alcasDoLote, moverDivisa } from "../src/lib/loteamento/edicao.ts";
import { chaveDoLote, executar } from "../src/lib/loteamento/acoes.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { dadosDasPartes, unidadesDasGlebas } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { lerCena } from "../supabase/functions/_shared/planta_cena.ts";
import { ANEL, dadosPlantaDe } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const SID = "00000000-0000-0000-0000-00000000000b";
const vertices = ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tl]) => ({
  id: `v${ordem}`, servico_id: SID, ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 360, sigma_pos: 0.01, sigma_h: 0.01,
  tipo, codigo, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "",
  descritivo: tipo === "M" ? (descritivo || `FAZENDA VIZINHA ${ordem}`) : null,
  tipo_limite: tipo === "M" ? (tl ?? "LA1") : null, eh_via: tl === "LA3", cns: null, matricula: null, apelido_txt: null, numerado: false, exibir_planta: true,
}));

function prancheta(n) {
  const ent = entradaDoServico(vertices, Array(n).fill(1), false, publicadorUtm(24, proj4));
  const r = sugerirDivisoes(ent)[0];
  const per = perimetroDaDivisao(ent);
  const pr = projetoDaDivisao(ent, r.partes.map((p) => anelBruto(ent, p)), "TESTE");
  const res = limparAvisos(calcular(pr, per), true);
  return { ent, r, per, pr, res };
}
const soma = (rd) => rd.partes.reduce((s, p) => s + p.areaM2, 0);

test("prancheta · as partes do motor voltam iguais (mesmos pontos, áreas e marcos), sem aviso de loteamento", () => {
  for (const n of [2, 3, 4]) {
    const { ent, r, res } = prancheta(n);
    assert.equal(res.lotes.length, n);
    assert.deepEqual(res.problemas, [], "sem metas de área pública, quinas ou área livre de arredondamento");
    const rd = resultadoDosLotes(ent, aneisDosLotes(res));
    assert.ok(rd.ok, rd.motivo);
    assert.equal(rd.novos.length, r.novos.length, "mesmos marcos novos");
    assert.equal(rd.divisas.length, n - 1, "nenhuma divisa fantasma por cima do perímetro");
    rd.partes.forEach((p, k) => {
      assert.equal(p.anel.length, r.partes[k].anel.length, `parte ${k + 1}: os vértices limpos pelo loteamento voltam`);
      assert.ok(Math.abs(p.areaM2 - r.partes[k].areaM2) < 0.5, `parte ${k + 1}: ${p.areaM2} × ${r.partes[k].areaM2}`);
    });
  }
});

test("prancheta · arrastar a divisa: a ponta corre pelo perímetro de vértice em vértice e as partes fecham o imóvel", () => {
  const { ent, per, pr, res } = prancheta(3);
  const total = soma(resultadoDosLotes(ent, aneisDosLotes(res)));
  const q = res.quadras[0];
  const l = res.lotes[0];
  const alcas = alcasDoLote(l, q);
  const div = alcas.filter((a) => a.tipo !== "quina" && !a.naBorda);
  assert.ok(div.length >= 1);
  for (const d of [5, -5, 20, -20, 40, -40]) {
    const ed = moverDivisa(pr, res, q, div[0].a, div[0].b, d, false, 0);
    const rd = resultadoDosLotes(ent, aneisDosLotes(limparAvisos(calcular(ed.pr, per), true)));
    assert.ok(rd.ok, `deslocamento ${d}: ${rd.motivo}`);
    assert.ok(Math.abs(soma(rd) - total) < 3, `deslocamento ${d}: soma ${soma(rd)} × ${total}`);
    for (const p of rd.novos) assert.ok(p.novo.aresta >= 0, "marco novo sobre um lado do perímetro");
  }
});

test("prancheta · comando area acerta a cota da parte depois de arrastar", () => {
  const { ent, per, pr, res } = prancheta(2);
  const q = res.quadras[0];
  const div = alcasDoLote(res.lotes[0], q).filter((a) => a.tipo !== "quina" && !a.naBorda);
  for (const d of [-25, -8, 16]) {
    const ed = moverDivisa(pr, res, q, div[0].a, div[0].b, d, false, 0);
    const res1 = limparAvisos(calcular(ed.pr, per), true);
    const total = soma(resultadoDosLotes(ent, aneisDosLotes(res1)));
    const l1 = [...res1.lotes].sort((a, b) => a.numero - b.numero)[0];
    const s = executar(`area ${(total / 2).toFixed(2)}`, ed.pr, res1, { tipo: "lotes", chaves: [chaveDoLote(l1)] });
    assert.ok(s.pr, s.msg);
    const rd = resultadoDosLotes(ent, aneisDosLotes(limparAvisos(calcular(s.pr, per), true)));
    assert.ok(rd.ok, rd.motivo);
    // o que sobra é o arredondamento a 0,001" do SIGEF
    for (const p of rd.partes) assert.ok(Math.abs(p.areaM2 - total / 2) < 2, `deslocamento ${d}: ${p.areaM2} × ${total / 2}`);
  }
});

test("prancheta · aplicar o que veio da prancheta: marcos M no perímetro, glebas e metragem com a vizinha certa", () => {
  const { ent, per, pr, res } = prancheta(3);
  const q = res.quadras[0];
  const div = alcasDoLote(res.lotes[0], q).filter((a) => a.tipo !== "quina" && !a.naBorda);
  const ed = moverDivisa(pr, res, q, div[0].a, div[0].b, 12, false, 0);
  const rd = resultadoDosLotes(ent, aneisDosLotes(limparAvisos(calcular(ed.pr, per), true)));
  assert.ok(rd.ok, rd.motivo);
  const infos = ["A", "B", "C"].map((x) => ({ nome: `QUINHÃO ${x}`, herdeiro: `HERDEIRO ${x}`, cpf: "", denominacao: "" }));
  const ap = aplicarDivisao(vertices, rd, infos, [1, 1, 1], SID);
  assert.equal(ap.vertices.filter((v) => v.rotulo_txt === ROTULO_DIVISAO).length, rd.novos.length);
  assert.equal(ap.glebas.length, 3);
  const med = medidasDasPartes(ent, rd, infos.map((x) => x.nome));
  med.forEach((m, k) => assert.ok(Math.abs(m.reduce((s, t) => s + t.comprimentoM, 0) - rd.partes[k].perimetroM) < 1e-6));
  // a parte do meio confronta com as outras duas
  const vizinhas = med.map((m) => m.filter((t) => t.divisa).map((t) => t.confrontante).sort().join(","));
  assert.ok(vizinhas.some((v) => v === "QUINHÃO A,QUINHÃO C"), vizinhas.join(" | "));
});

test("prancheta · vértice no meio do imóvel não vira gleba: a volta recusa com o motivo", () => {
  const { ent, res } = prancheta(2);
  const an = aneisDosLotes(res);
  // empurra um ponto de divisa 20 m para dentro
  const k = an[0].findIndex((p) => !ent.base.some((v) => Math.hypot(Number(v.e) - p[0], Number(v.n) - p[1]) < 0.05));
  an[0] = an[0].map((p, j) => (j === k ? [p[0] + 20, p[1] + 20] : p));
  const rd = resultadoDosLotes(ent, an);
  assert.equal(rd.ok, false);
  assert.match(rd.motivo, /dentro do imóvel/);
});

test("prancheta · divisão salva: a planta A1 do SIGEF (gerar-planta) desenha as partes, não o imóvel inteiro", async () => {
  const { ent, per, pr, res } = prancheta(3);
  const q = res.quadras[0];
  const div = alcasDoLote(res.lotes[0], q).filter((a) => a.tipo !== "quina" && !a.naBorda);
  const ed = moverDivisa(pr, res, q, div[0].a, div[0].b, 12, false, 0);
  const rd = resultadoDosLotes(ent, aneisDosLotes(limparAvisos(calcular(ed.pr, per), true)));
  const infos = ["A", "B", "C"].map((x) => ({ nome: `QUINHÃO ${x}`, herdeiro: `HERDEIRO ${x}`, cpf: "", denominacao: "" }));
  const ap = aplicarDivisao(vertices, rd, infos, [1, 1, 1], SID);
  // como o banco fica depois de "Gerar documentos": todo vértice com código
  const entrada = (vs, contadores) => ({
    fusoUtm: 24, verticeInicialOrdem: 0, prefixo: "DSBN", contadores,
    vertices: vs.map((v) => ({
      ordem: v.ordem, numTxt: v.num_txt, e: v.e, n: v.n, latGmsStr: null, lonGmsStr: null, h: v.h,
      sigmaPos: v.sigma_pos, sigmaH: v.sigma_h, tipo: v.tipo, metodo: v.metodo, codigoManual: v.codigo, inserido: false,
      descritivo: v.descritivo || "", tipoLimite: v.tipo_limite, ehVia: v.eh_via, cns: null, matricula: null, numerado: false, exibirPlanta: true,
    })),
  });
  const codigoDe = new Map(montarServico(entrada(ap.vertices, { M: 5000, P: 20000, V: 0 }), proj4).ring.map((v) => [v.conf.ordem, v.codigo]));
  const banco = ap.vertices.map((v) => ({ ...v, codigo: v.codigo ?? codigoDe.get(v.ordem) }));
  // o caminho de gerar-planta: contadores zerados, códigos manuais
  const input = entrada(banco, { M: 0, P: 0, V: 0 });
  const calc = montarServico(input, proj4);
  const servico = { id: SID, tipo: "geo", tem_glebas: true, divisao: {}, denominacao: "FAZENDA SALGADA VELHA", detentor_nome: "ESPÓLIO", fuso_utm: 24 };
  const { unidades, avisos } = unidadesDasGlebas(ap.glebas, banco, input, calc, servico, { fusoUtm: 24, prefixo: "DSBN", estiloCodigo: "oficial" }, proj4);
  assert.deepEqual(avisos, []);
  assert.equal(unidades.length, 3, "uma unidade por parte salva");
  const dp = dadosDasPartes(unidades, servico, ap.glebas);
  assert.equal(dp.partes.length, 3);
  const pdf = await gerarPlantaPdf(dadosPlantaDe(dp.geometria, { partes: dp.partes, glebas: dp.glebas, folha: "A1" }), undefined, { editavel: true });
  const textos = (await lerCena(pdf)).itens.filter((i) => i.k === "texto").map((i) => i.t).join("\n");
  for (const h of ["HERDEIRO A", "HERDEIRO B", "HERDEIRO C"]) assert.ok(textos.includes(h), `${h} na planta`);
});
