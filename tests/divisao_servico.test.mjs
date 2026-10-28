// A divisão aplicada ao serviço (src/lib/divisao_servico.ts), passando pelo
// MESMO cálculo de glebas do servidor (planta_dados.ts → gerar-documentos).
//
// O que importa para a partilha: os pontos novos viram marcos M no perímetro com
// a confrontação do trecho onde caem; cada parte vira gleba; a divisa interna de
// uma parte confronta com o HERDEIRO da vizinha; e o GEO individual de cada
// parte sai com o herdeiro como proprietário e os códigos do imóvel.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { sugerirDivisoes } from "../src/lib/divisao.ts";
import { aplicarDivisao, entradaDoServico, publicadorUtm, servicoDaParte, verticesDaParte, ROTULO_DIVISAO } from "../src/lib/divisao_servico.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { calcularGleba, dadosDasPartes, anelExternoDasGlebas } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { lerCena } from "../supabase/functions/_shared/planta_cena.ts";
import { ANEL, dadosPlantaDe } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const SID = "00000000-0000-0000-0000-00000000000a";
const servico = {
  id: SID, tipo: "geo", modalidade: "completo", tem_glebas: true, denominacao: "FAZENDA SALGADA VELHA",
  detentor_nome: "ESPÓLIO DE JOSÉ", detentor_cpf: "111.111.111-11", matricula: "1.234", cns: "00.810-2",
  tipo_imovel: "matricula", fuso_utm: 24, municipio: "ARACI", uf: "BA", is_espolio: true, inventariante_nome: "MARIA",
};
// vértices como a tela os tem, com a confrontação nos M
const vertices = ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
  id: `v${ordem}`, servico_id: SID, ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 360,
  sigma_pos: 0.01, sigma_h: 0.01, tipo, codigo, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "",
  descritivo: tipo === "M" ? (descritivo || `FAZENDA VIZINHA ${ordem}\\JOAO ${ordem}\\CPF:000.000.000-0${ordem % 10}`) : null,
  tipo_limite: tipo === "M" ? (tipoLimite ?? "LA1") : null, eh_via: tipoLimite === "LA3", cns: null, matricula: null,
  apelido_txt: null, numerado: false, exibir_planta: true,
}));
const HERDEIROS = [
  { nome: "QUINHÃO 1", herdeiro: "ANA SOUZA", cpf: "222.222.222-22", denominacao: "" },
  { nome: "QUINHÃO 2", herdeiro: "BRUNO SOUZA", cpf: "333.333.333-33", denominacao: "SÍTIO BOA VISTA" },
  { nome: "QUINHÃO 3", herdeiro: "CARLA SOUZA", cpf: "444.444.444-44", denominacao: "" },
];

function dividirServico() {
  const fr = [1, 1, 1];
  const ent = entradaDoServico(vertices, fr, false, publicadorUtm(24, proj4));
  const r = sugerirDivisoes(ent)[0];
  return { r, ...aplicarDivisao(vertices, r, HERDEIROS, fr, SID) };
}

/** O que gerar-documentos monta a partir das linhas do banco. */
function calcularComo(servidorVertices, prefixo = "DSBN") {
  return montarServico({
    fusoUtm: 24, prefixo, contadores: { M: 5000, P: 20000, V: 0 },
    vertices: servidorVertices.map((v) => ({
      ordem: v.ordem, numTxt: v.num_txt, e: v.e, n: v.n, latGmsStr: null, lonGmsStr: null, h: v.h,
      sigmaPos: v.sigma_pos, sigmaH: v.sigma_h, tipo: v.tipo, metodo: v.metodo,
      codigoManual: v.codigo, inserido: v.inserido_manual, descritivo: v.descritivo || v.apelido_txt || "",
      tipoLimite: v.tipo_limite, ehVia: v.eh_via, cns: v.cns, matricula: v.matricula, numerado: v.numerado, exibirPlanta: v.exibir_planta !== false,
    })),
  }, proj4);
}

test("partilha · pontos novos entram no perímetro como M, com a confrontação do trecho", () => {
  const { r, vertices: vs } = dividirServico();
  const novos = vs.filter((v) => v.rotulo_txt === ROTULO_DIVISAO);
  assert.equal(novos.length, r.novos.length);
  assert.equal(vs.length, vertices.length + novos.length);
  assert.deepEqual(vs.map((v) => v.ordem), vs.map((_, i) => i), "ordens contínuas");
  for (const nv of novos) {
    assert.equal(nv.tipo, "M");
    assert.equal(nv.metodo, "PA1");
    assert.equal(nv.codigo, null, "o código é alocado na geração");
    // herda a confrontação do M anterior no anel
    const lista = [...vs].sort((a, b) => a.ordem - b.ordem);
    let k = lista.indexOf(nv) - 1;
    while (lista[(k + lista.length) % lista.length].tipo !== "M") k--;
    assert.equal(nv.descritivo, lista[(k + lista.length) % lista.length].descritivo);
  }
  // refazer a divisão não acumula pontos: os da anterior saem
  const fr = [1, 1];
  const r2 = sugerirDivisoes(entradaDoServico(vs, fr))[0];
  const de2 = aplicarDivisao(vs, r2, HERDEIROS, fr, SID);
  assert.equal(de2.vertices.filter((v) => v.rotulo_txt === ROTULO_DIVISAO).length, 2);
  assert.equal(de2.glebas.length, 2);
});

test("partilha · no cálculo do servidor cada parte tem a área certa e confronta com o herdeiro vizinho", () => {
  const { vertices: vs, glebas } = dividirServico();
  const calc = calcularComo(vs);
  const rows = glebas.map((g) => ({ ...g }));
  const base = { fusoUtm: 24, prefixo: "DSBN" };
  const unidades = rows.map((g) => calcularGleba(g, rows, calc, servico, base, proj4));
  const areas = unidades.map((u) => u.calc.areaHa);
  const total = calc.areaHa;
  // com a compensação do arredondamento, as áreas IMPRESSAS (4 casas) são iguais
  const impressas = areas.map((a) => a.toFixed(4));
  assert.ok(Math.max(...areas) - Math.min(...areas) < 0.00011, `áreas impressas ${impressas.join(" / ")}`);
  for (const u of unidades) assert.equal(u.semCodigo, 0, "todo ponto da parte é vértice do serviço");
  // a divisa interna do quinhão do meio cita os dois vizinhos, cada um com o seu herdeiro
  const meio = unidades[1].calc;
  const internos = meio.trechosOrdenados.filter((t) => t.descritivo.includes("QUINHÃO") || t.descritivo.includes("SOUZA"));
  const textos = internos.map((t) => t.descritivo).join(" | ");
  assert.match(textos, /ANA SOUZA/);
  assert.match(textos, /CARLA SOUZA/);
  assert.doesNotMatch(textos, /ESPÓLIO/, "a divisa interna não fala mais do espólio");
  // e o perímetro externo das partes fecha o imóvel
  const ext = anelExternoDasGlebas(unidades.map((u) => u.calc), calc, base, proj4);
  assert.ok(ext, "o perímetro externo fecha");
  assert.ok(Math.abs(ext.areaHa - total) < 0.0005);
});

test("partilha · planta A1 do total: cada parte com o herdeiro e a denominação dela", async () => {
  const { vertices: vs, glebas } = dividirServico();
  const calc = calcularComo(vs);
  const base = { fusoUtm: 24, prefixo: "DSBN" };
  const unidades = glebas.map((g) => ({ nome: g.nome, calc: calcularGleba(g, glebas, calc, servico, base, proj4).calc }));
  const dp = dadosDasPartes(unidades, servico, glebas);
  assert.deepEqual(dp.glebas[1].identificacao.slice(1, 3), ["SÍTIO BOA VISTA", "BRUNO SOUZA"]);
  assert.equal(dp.glebas[0].identificacao[1], "FAZENDA SALGADA VELHA - QUINHÃO 1");
  const pdf = await gerarPlantaPdf(dadosPlantaDe(dp.geometria, { partes: dp.partes, glebas: dp.glebas, folha: "A1" }), undefined, { editavel: true });
  const cena = await lerCena(pdf);
  const textos = cena.itens.filter((i) => i.k === "texto").map((i) => i.t).join("\n");
  for (const h of ["ANA SOUZA", "BRUNO SOUZA", "CARLA SOUZA"]) assert.ok(textos.includes(h), `${h} na planta`);
});

test("partilha · GEO individual: herdeiro como proprietário, códigos do imóvel, divisa interna com o vizinho", () => {
  const { vertices: vs, glebas } = dividirServico();
  // o imóvel já gerado: todo vértice com código
  const calc = calcularComo(vs);
  const codigoDe = new Map(calc.ring.map((v) => [v.conf.ordem, v.codigo]));
  const comCodigos = vs.map((v) => ({ ...v, codigo: v.codigo ?? codigoDe.get(v.ordem) }));
  const sv = { ...servico, divisao: {}, created_at: "x" };
  for (const [k, g] of glebas.entries()) {
    const cab = servicoDaParte(sv, g);
    assert.equal(cab.detentor_nome, HERDEIROS[k].herdeiro);
    assert.equal(cab.is_espolio, false);
    assert.equal(cab.tem_glebas, false);
    assert.equal(cab.divisao, null);
    assert.ok(!("id" in cab) && !("created_at" in cab));
    const vp = verticesDaParte(sv, comCodigos, glebas, k, "novo");
    assert.ok(vp.every((v) => v.codigo), "todo vértice com o código do imóvel");
    assert.ok(vp.every((v) => v.servico_id === "novo"));
    // o GEO da parte calcula sozinho, com a mesma área da parte no total
    const calcP = calcularComo(vp);
    assert.ok(Math.abs(calcP.areaHa - calc.areaHa / 3) < 0.0005);
    const internos = vp.filter((v) => v.tipo === "M" && v.tipo_limite === "LA1" && /SOUZA/.test(v.descritivo ?? ""));
    assert.ok(internos.length >= 1, "divisa da partilha confronta com herdeiro");
    assert.ok(internos.every((v) => !v.descritivo.includes(HERDEIROS[k].herdeiro)), "não confronta consigo mesma");
  }
  assert.equal(denominacaoEsperada(glebas[1]), "SÍTIO BOA VISTA");
});
const denominacaoEsperada = (g) => servicoDaParte({ ...servico, created_at: "x" }, g).denominacao;

test("partilha · BA/rodovia pelo nome do confrontante conta como estrada (frente)", async () => {
  const { ehEstrada } = await import("../src/lib/trechos.ts");
  const c = (descritivo, extra = {}) => ({ descritivo, apelido_txt: null, tipo_limite: "LA1", eh_via: false, ...extra });
  for (const d of ["BA", "BA-120", "BA 093", "RODOVIA BA", "RODOVIA ESTADUAL BA-084", "BR-116", "ESTRADA VICINAL", "SE-200"]) {
    assert.ok(ehEstrada(c(d)), d);
  }
  for (const d of ["FAZENDA BARRA\JOSE BATISTA\CPF:000.000.000-00", "(MATR.1/CNS.2) FAZENDA BA", "JOAO DA SILVA", "SE", "RIACHO SECO"]) {
    assert.ok(!ehEstrada(c(d)), d);
  }
  assert.ok(ehEstrada(c("QUALQUER", { eh_via: true })), "marcado como via");
  assert.ok(!ehEstrada(c("BA-120", { tipo_limite: "LN1" })), "rio vence");
  assert.ok(!ehEstrada(c("LINHA FERREA", { tipo_limite: "LA3", eh_via: true })), "ferrovia não dá acesso");
  // o lado que começa num M "BA-120" sem a caixa marcada vira estrada na entrada do motor
  const vs = vertices.map((v) => (v.descritivo === "ESTRADA VICINAL" ? { ...v, descritivo: "BA-120", tipo_limite: "LA1", eh_via: false } : v));
  // (antes da correção só a caixa "faixa de domínio" contava: aqui daria zero lados)
  const antes = entradaDoServico(vertices, [1, 1]).estrada;
  const depois = entradaDoServico(vs, [1, 1]).estrada;
  assert.ok(depois.some(Boolean));
  assert.deepEqual(depois, antes, "os mesmos lados que com LA3 marcado");
});

test("partilha · metragem de cada parte fecha o perímetro e a locação traz todos os marcos novos", async () => {
  const { medidasDasPartes, pontosLocacaoDivisao } = await import("../src/lib/divisao_servico.ts");
  const { arquivoLocacao } = await import("../src/lib/loteamento/saidas.ts");
  const fr = [1, 1, 1];
  const ent = entradaDoServico(vertices, fr, false, publicadorUtm(24, proj4));
  const r = sugerirDivisoes(ent)[0];
  const med = medidasDasPartes(ent, r, ["Q1", "Q2", "Q3"]);
  assert.equal(med.length, 3);
  med.forEach((m, k) => {
    const soma = m.reduce((s, t) => s + t.comprimentoM, 0);
    assert.ok(Math.abs(soma - r.partes[k].perimetroM) < 1e-6, `parte ${k + 1}: ${soma} × ${r.partes[k].perimetroM}`);
    assert.ok(m.some((t) => t.divisa), "toda parte tem divisa com outra");
  });
  // a parte do meio confronta com as duas vizinhas
  assert.deepEqual(med[1].filter((t) => t.divisa).map((t) => t.confrontante).sort(), ["Q1", "Q3"]);

  const pts = pontosLocacaoDivisao(ent, r, vertices);
  assert.equal(pts.length, r.novos.length);
  assert.deepEqual(pts.map((p) => p.nome), pts.map((_, i) => `DIV-${String(i + 1).padStart(2, "0")}`));
  pts.forEach((p) => assert.ok(Math.abs(p.h - 360) < 1e-9, "cota interpolada"));
  const txt = arquivoLocacao(pts, "penzd").trim().split(/\r?\n/);
  assert.equal(txt.length, pts.length, "TXT P,E,N,Z,D sem cabeçalho, uma linha por marco");
  assert.match(txt[0], /^DIV-01,\d+\.\d{3},\d+\.\d{3},360\.000,DIVISA\d$/);

  // aplicada e com código alocado, o nome é o código do marco
  const ap = aplicarDivisao(vertices, r, HERDEIROS, fr, SID);
  const comCod = ap.vertices.map((v, i) => (v.rotulo_txt === ROTULO_DIVISAO ? { ...v, codigo: `DSBN-M-${9000 + i}`, codigo_provisorio: false } : v));
  const r2 = sugerirDivisoes(entradaDoServico(comCod, fr, false, publicadorUtm(24, proj4)))[0];
  const pts2 = pontosLocacaoDivisao(entradaDoServico(comCod, fr, false, publicadorUtm(24, proj4)), r2, comCod);
  assert.ok(pts2.every((p) => /^DSBN-M-9\d{3}$/.test(p.nome)), pts2.map((p) => p.nome).join(","));
});

test("partilha · planta com metragem: cada lado das partes sai medido, sem repetir a divisa; sem a opção, nada", async () => {
  const { vertices: vs, glebas } = dividirServico();
  const calc = calcularComo(vs);
  const base = { fusoUtm: 24, prefixo: "DSBN" };
  const unidades = glebas.map((g) => ({ nome: g.nome, calc: calcularGleba(g, glebas, calc, servico, base, proj4).calc }));
  const dp = dadosDasPartes(unidades, servico, glebas);
  const gerar = async (metragem) => lerCena(await gerarPlantaPdf(
    dadosPlantaDe(dp.geometria, { partes: dp.partes, glebas: dp.glebas, folha: "A1", metragem }), undefined, { editavel: true }));
  const medidas = (cena) => Object.entries(cena.objetos).filter(([, o]) => o.cat === "metragem");

  assert.equal(medidas(await gerar(false)).length, 0);
  const com = await gerar(true);
  const m = medidas(com);
  // lados distintos: soma dos lados das glebas menos as divisas internas (cada uma conta 2×)
  const chave = (v) => `${v.e.toFixed(2)},${v.n.toFixed(2)}`;
  const lados = new Set(dp.glebas.flatMap((g) => g.vertices.map((v, i) => [chave(v), chave(g.vertices[(i + 1) % g.vertices.length])].sort().join("|"))));
  assert.ok(m.length > 0 && m.length <= lados.size, `${m.length} medidas para ${lados.size} lados`);
  // a maioria cabe (lado curto ou vizinho de rótulo cede)
  assert.ok(m.length >= lados.size * 0.6, `só ${m.length} de ${lados.size} lados medidos`);
  const textos = com.itens.filter((i) => i.k === "texto").map((i) => i.t);
  assert.ok(textos.some((t) => /^\d{1,3}(\.\d{3})*,\d{2} m$/.test(t)), "texto no formato 123,45 m");
});
