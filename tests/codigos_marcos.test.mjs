// GEO da parte antes do "Gerar documentos": a tela numera os marcos com a
// MESMA conta do gerar-documentos (src/lib/codigos_marcos.ts). Depois disso a
// geração encontra todos numerados e reaproveita — os documentos do imóvel e os
// GEOs das partes saem com os mesmos códigos.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { sugerirDivisoes } from "../src/lib/divisao.ts";
import { aplicarDivisao, entradaDoServico, publicadorUtm, verticesDaParte } from "../src/lib/divisao_servico.ts";
import { consumoDaNumeracao, numeracaoDosMarcos, precisaNumerar } from "../src/lib/codigos_marcos.ts";
import { codigosPorLinha, montarServico } from "../supabase/functions/_shared/servico.ts";
import { ANEL } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const SID = "00000000-0000-0000-0000-00000000000b";
const servico = { id: SID, tipo: "geo", modalidade: "completo", tem_glebas: true, fuso_utm: 24, vertice_inicial: 0, denominacao: "FAZENDA SALGADA VELHA", detentor_nome: "ESPÓLIO", divisao: { iguais: true } };
const base = ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
  id: `v${ordem}`, servico_id: SID, ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 360,
  sigma_pos: 0.01, sigma_h: 0.01, tipo, codigo, codigo_provisorio: false, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "",
  descritivo: tipo === "M" ? (descritivo || `FAZENDA VIZINHA ${ordem}\JOAO ${ordem}\CPF:000.000.000-0${ordem % 10}`) : null,
  tipo_limite: tipo === "M" ? (tipoLimite ?? "LA1") : null, eh_via: tipoLimite === "LA3", cns: null, matricula: null,
  apelido_txt: null, numerado: false, exibir_planta: true,
}));
const HERDEIROS = [
  { nome: "PARTE 1", herdeiro: "ANA", cpf: "222.222.222-22", denominacao: "" },
  { nome: "PARTE 2", herdeiro: "BRUNO", cpf: "333.333.333-33", denominacao: "" },
];

function divididos() {
  const fr = [1, 1];
  const r = sugerirDivisoes(entradaDoServico(base, fr, false, publicadorUtm(24, proj4)))[0];
  return aplicarDivisao(base, r, HERDEIROS, fr, SID);
}

/** O que gerar-documentos faria com as linhas do banco (sem alocar: todos numerados). */
function geracaoReaproveita(vs) {
  const calc = montarServico({
    fusoUtm: 24, verticeInicialOrdem: 0, prefixo: "DSBN", contadores: { M: 1, P: 1, V: 1 }, estiloCodigo: "oficial",
    vertices: vs.map((v) => ({
      ordem: v.ordem, numTxt: v.num_txt, e: v.e, n: v.n, latGmsStr: null, lonGmsStr: null, h: v.h, sigmaPos: v.sigma_pos, sigmaH: v.sigma_h,
      tipo: v.tipo, metodo: v.metodo, codigoManual: v.codigo, inserido: v.inserido_manual, descritivo: v.descritivo || "",
      tipoLimite: v.tipo_limite, ehVia: v.eh_via, cns: null, matricula: null, numerado: false, exibirPlanta: true,
    })),
  }, proj4);
  return codigosPorLinha(calc.ring);
}

test("divisão salva: marcos novos sem código → precisa numerar; consumo é o do servidor", () => {
  const { vertices } = divididos();
  assert.equal(precisaNumerar(vertices), true);
  const c = consumoDaNumeracao(vertices);
  assert.equal(c.M + c.P + c.V, vertices.length, "o servidor renumera todos os vértices não manuais");
  assert.equal(c.M, vertices.filter((v) => v.tipo === "M").length);
});

test("numeração na tela = a da geração: todos os vértices, sem repetir, a partir do contador", () => {
  const { vertices } = divididos();
  const cod = numeracaoDosMarcos(servico, vertices, "DSBN", { M: 5000, P: 20000, V: 300 });
  assert.equal(cod.size, vertices.length);
  assert.equal(new Set(cod.values()).size, vertices.length, "nenhum código repetido");
  const ms = [...cod.values()].filter((x) => x.startsWith("DSBN-M-")).map((x) => Number(x.slice(7))).sort((a, b) => a - b);
  assert.equal(ms[0], 5000);
  assert.equal(ms.at(-1), 5000 + ms.length - 1, "M em sequência, sem buraco");
  // gravados, a geração seguinte não realoca e devolve os mesmos códigos
  const gravados = vertices.map((v) => ({ ...v, codigo: cod.get(v.ordem), codigo_provisorio: false }));
  assert.equal(precisaNumerar(gravados), false);
  assert.deepEqual(geracaoReaproveita(gravados), cod);
  assert.deepEqual(numeracaoDosMarcos(servico, gravados, "DSBN", { M: 9, P: 9, V: 9 }), cod, "sem marco novo, nada muda");
});

test("GEO da parte criado depois da numeração leva os códigos do imóvel", () => {
  const { vertices, glebas } = divididos();
  const cod = numeracaoDosMarcos(servico, vertices, "DSBN", { M: 5000, P: 20000, V: 300 });
  const gravados = vertices.map((v) => ({ ...v, codigo: cod.get(v.ordem), codigo_provisorio: false }));
  const partes = glebas.filter((g) => g.anel.length >= 3);
  const linhas = verticesDaParte(servico, gravados, partes, 0, "parte-1");
  assert.ok(linhas.length >= 3);
  const doImovel = new Set(gravados.map((v) => v.codigo));
  for (const l of linhas) assert.ok(l.codigo && doImovel.has(l.codigo), `vértice da parte sem o código do imóvel: ${l.codigo}`);
});

test("código provisório (prévia) conta como ausente, como no servidor", () => {
  const vs = base.map((v) => ({ ...v, codigo: `DSBN-${v.tipo}-${v.ordem + 1}`, codigo_provisorio: v.ordem === 3 }));
  assert.equal(precisaNumerar(vs), true);
  assert.equal(precisaNumerar(vs.map((v) => ({ ...v, codigo_provisorio: false }))), false);
});
