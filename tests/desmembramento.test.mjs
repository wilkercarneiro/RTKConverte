// DESMEMBRAMENTO na divisão (src/lib/desmembramento.ts): uma ou mais áreas
// saem do imóvel com a área digitada e no nome do adquirente; o resto é a área
// remanescente, do proprietário. E o Memorial Tabular dos dados do sistema
// (_shared/tabular_sistema.ts), que a gerar-documentos emite com `tabular: true`
// para os documentos de cada área.
//
// O que importa: a área digitada vira a fração que o MOTOR corta (a área
// impressa bate); os nomes e o papel seguem a regra; o serviço de cada área sai
// com a denominação e o dono certos; divisão antiga (sem `tipo`) continua
// partilha; "destacar pela frente/fundo/lateral" encosta a área no lado certo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import proj4lib from "proj4";
import { dividir, sugerirDivisoes } from "../src/lib/divisao.ts";
import { aplicarDivisao, entradaDoServico, publicadorUtm, verticesDaParte, ROTULO_DIVISAO } from "../src/lib/divisao_servico.ts";
import * as D from "../src/lib/desmembramento.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { montarDadosPecasDoCalculo } from "../supabase/functions/_shared/pecas_dados.ts";
import { modelosDasPecas, montarTabularDocx, pastaDasPecas } from "../supabase/functions/_shared/tabular_sistema.ts";
import { ANEL, entrada } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const pub = publicadorUtm(24, proj4);
const SID = "00000000-0000-0000-0000-00000000000d";
const servico = {
  id: SID, tipo: "geo", modalidade: "completo", tem_glebas: true, denominacao: "FAZENDA SALGADA VELHA",
  detentor_nome: "ESPÓLIO DE JOSÉ", detentor_cpf: "111.111.111-11", matricula: "1.234", cns: "00.810-2",
  tipo_imovel: "matricula", fuso_utm: 24, municipio: "ARACI", uf: "BA", is_espolio: true, inventariante_nome: "MARIA",
  divisao: { tipo: "desmembramento", iguais: false, remanescente: 1 }, created_at: "x",
};
// vértices como a tela os tem, com a confrontação nos M (a estrada é o lado 3→4)
const vertices = ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
  id: `v${ordem}`, servico_id: SID, ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 360,
  sigma_pos: 0.01, sigma_h: 0.01, tipo, codigo, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "",
  descritivo: tipo === "M" ? (descritivo || `FAZENDA VIZINHA ${ordem}\\JOAO ${ordem}\\CPF:000.000.000-0${ordem % 10}`) : null,
  tipo_limite: tipo === "M" ? (tipoLimite ?? "LA1") : null, eh_via: tipoLimite === "LA3", cns: null, matricula: null,
  apelido_txt: null, numerado: false, exibir_planta: true,
}));
const totalHa = D.areaDoPerimetroM2(vertices, pub) / 10000;

/** Desmembra 0,75 ha para MARIA COMPRADORA, como a prancheta salva. */
function desmembrar(linhas = [
  { nome: "", herdeiro: "MARIA COMPRADORA", cpf: "222.222.222-22", denominacao: "" },
  { nome: "PARTE 2", herdeiro: "NÃO VALE", cpf: "999", denominacao: "NÃO VALE" },
]) {
  const r = D.aplicarAreaDigitada(D.inicioDoDesmembramento(totalHa).areasHa, 0, 0.75, 1, totalHa);
  assert.ok(r.ok);
  const pct = D.percentuais(r.areasHa);
  const div = sugerirDivisoes(entradaDoServico(vertices, pct, false, pub))[0];
  assert.ok(div.ok, div.motivo);
  return { div, pct, ...aplicarDivisao(vertices, div, D.infosDoDesmembramento(linhas, 2, 1), pct, SID) };
}

test("desmembramento · começa com uma área de 10% (arredondada) e a remanescente com o resto", () => {
  const ini = D.inicioDoDesmembramento(totalHa);
  assert.equal(ini.remanescente, 1);
  assert.equal(ini.areasHa[0], Number((totalHa * 0.1).toPrecision(2)), `${ini.areasHa[0]} ha de ${totalHa} ha`);
  assert.ok(Math.abs(ini.areasHa[0] + ini.areasHa[1] - totalHa) < 1e-9, "as duas somam o imóvel");
  assert.equal(D.areaInicialDesmembrada(47.1234), 4.7);
  assert.equal(D.areaInicialDesmembrada(0.37), 0.037);
  assert.equal(D.areaInicialDesmembrada(1234), 120);
});

test("desmembramento · a área digitada vira a fração e o motor corta exatamente ela (área impressa)", () => {
  const ini = D.inicioDoDesmembramento(totalHa);
  const r = D.aplicarAreaDigitada(ini.areasHa, 0, D.lerHectares("0,75"), 1, totalHa);
  assert.ok(r.ok);
  assert.equal(r.areasHa[0], 0.75);
  assert.ok(Math.abs(r.areasHa[1] - (totalHa - 0.75)) < 1e-9, "a remanescente fica com o resto");
  const pct = D.percentuais(r.areasHa);
  assert.ok(Math.abs(pct.reduce((s, p) => s + p, 0) - 100) < 1e-9, "frações em % somando 100");
  D.areasDasFracoes(pct, totalHa).forEach((a, i) => assert.ok(Math.abs(a - r.areasHa[i]) < 1e-9, "ida e volta fração ↔ área"));
  const div = sugerirDivisoes(entradaDoServico(vertices, pct, false, pub))[0];
  assert.ok(div.ok, div.motivo);
  // as áreas do motor são as que os documentos imprimem (pontos a 0,001")
  assert.ok(Math.abs(div.partes[0].areaM2 - 7500) < 1, `área desmembrada ${div.partes[0].areaM2.toFixed(2)} m²`);
  assert.ok(Math.abs(div.partes[0].areaM2 + div.partes[1].areaM2 - totalHa * 10000) < 5, "as duas fecham o imóvel");
});

test("desmembramento · o que não cabe é recusado dizendo por quê; sem remanescente a diferença sai da maior", () => {
  const nao = D.aplicarAreaDigitada([1, 9], 0, 10, 1, 10);
  assert.equal(nao.ok, false);
  assert.match(nao.erro, /não sobraria área remanescente/);
  assert.equal(D.aplicarAreaDigitada([1, 9], 0, 0, 1, 10).ok, false);
  assert.match(D.aplicarAreaDigitada([1, 9], 1, 3, 1, 10).erro, /remanescente fica com o que sobra/);
  const sem = D.aplicarAreaDigitada([5, 5], 0, 6, null, 10);
  assert.ok(sem.ok);
  assert.deepEqual(sem.areasHa, [6, 4]);
  assert.equal(sem.ajustada, 1);
  assert.equal(D.lerHectares("2,5"), 2.5);
  assert.equal(D.lerHectares("2.5"), 2.5);
  assert.equal(D.lerHectares("1.234,5678"), 1234.5678);
  assert.equal(D.lerHectares("2,5 ha"), 2.5);
  assert.ok(Number.isNaN(D.lerHectares("dois")));
});

test("desmembramento · mais uma área sai da remanescente (e entra antes dela); menos uma volta para ela", () => {
  let m = D.acrescentarArea([1, 9], 1, 10);
  assert.deepEqual(m, { areasHa: [1, 1, 8], remanescente: 2, pos: 1 });
  m = D.retirarArea(m.areasHa, m.remanescente, 10);
  assert.deepEqual(m, { areasHa: [1, 9], remanescente: 1, pos: 1 });
  assert.equal(D.retirarArea([1, 9], 1, 10), null, "duas áreas é o mínimo");
  // sem remanescente: a nova sai da maior
  assert.deepEqual(D.acrescentarArea([3, 7], null, 10), { areasHa: [3, 6, 1], remanescente: null, pos: 2 });
  // remanescente quase sem área: não há de onde tirar
  assert.equal(D.acrescentarArea([9.99995, 0.00005], 1, 10), null);
});

test("desmembramento · nomes automáticos pelo papel, até a pessoa digitar outro", () => {
  assert.deepEqual(D.nomesAutomaticos(2, 1), ["ÁREA DESMEMBRADA 01", "ÁREA REMANESCENTE"]);
  assert.deepEqual(D.nomesAutomaticos(3, 1), ["ÁREA DESMEMBRADA 01", "ÁREA REMANESCENTE", "ÁREA DESMEMBRADA 02"]);
  assert.deepEqual(D.nomesAutomaticos(2, null), ["ÁREA DESMEMBRADA 01", "ÁREA DESMEMBRADA 02"]);
  for (const n of ["", "  ", "PARTE 3", "ÁREA REMANESCENTE", "área desmembrada 07", "AREA DESMEMBRADA 2"]) assert.ok(D.ehNomeAutomatico(n), n);
  for (const n of ["SÍTIO DO JOÃO", "ÁREA DO POSTO", "LOTE 1"]) assert.ok(!D.ehNomeAutomatico(n), n);
  assert.equal(D.nomeDaArea("PARTE 1", 0, 2, 0), "ÁREA REMANESCENTE");
  assert.equal(D.nomeDaArea(" sítio novo ", 0, 2, 0), "sítio novo");
});

test("desmembramento · papel: no máximo uma remanescente, num clique", () => {
  const d = { tipo: "desmembramento", remanescente: 1 };
  assert.equal(D.papelDaArea(d, 1), "remanescente");
  assert.equal(D.papelDaArea(d, 0), "desmembrada");
  assert.equal(D.trocarPapel(1, 0, "remanescente"), 0, "marcar outra troca a remanescente");
  assert.equal(D.trocarPapel(1, 1, "desmembrada"), null, "desmarcar a remanescente: todas saem do imóvel");
  assert.equal(D.trocarPapel(1, 0, "desmembrada"), 1, "desmembrar quem já é desmembrada não muda nada");
  assert.equal(D.ROTULO_PAPEL.remanescente, "Remanescente");
});

test("desmembramento · compatibilidade: divisão sem `tipo` (tudo o que já foi salvo) é partilha", () => {
  assert.equal(D.ehDesmembramento({ iguais: true }), false);
  assert.equal(D.ehDesmembramento(null), false);
  assert.equal(D.ehDesmembramento(undefined), false);
  assert.equal(D.ehDesmembramento({ tipo: "partilha", remanescente: 0 }), false);
  assert.equal(D.papelDaArea({ iguais: true }, 0), "parte");
  assert.equal(D.papelDaArea({ tipo: "partilha", remanescente: 0 }, 0), "parte");
  assert.equal(D.papelDaArea(undefined, 2), "parte");
  // na partilha o serviço de cada parte é o mesmo de sempre (servicoDaParte)
  const g = { servico_id: SID, ordem: 0, nome: "QUINHÃO 1", anel: [], detentor_nome: "ANA", detentor_cpf: "1", denominacao: null };
  const cab = D.servicoDaArea({ ...servico, divisao: { iguais: true } }, g, "parte");
  assert.equal(cab.denominacao, "FAZENDA SALGADA VELHA - QUINHÃO 1");
  assert.equal(cab.detentor_nome, "ANA");
});

test("desmembramento · salvo: nomes, adquirente, fração; a remanescente fica com o proprietário", () => {
  const { glebas, vertices: vs, div, pct } = desmembrar();
  assert.equal(vs.filter((v) => v.rotulo_txt === ROTULO_DIVISAO).length, div.novos.length, "marcos novos da divisa");
  assert.equal(glebas.length, 2);
  assert.equal(glebas[0].nome, "ÁREA DESMEMBRADA 01");
  assert.equal(glebas[0].detentor_nome, "MARIA COMPRADORA");
  assert.equal(glebas[1].nome, "ÁREA REMANESCENTE", "o nome automático vale no lugar de PARTE 2");
  assert.equal(glebas[1].detentor_nome, null, "a remanescente não tem adquirente");
  assert.equal(glebas[1].denominacao, null, "nem denominação própria");
  glebas.forEach((g, i) => assert.ok(Math.abs(g.fracao - pct[i] / 100) < 1e-12, "fração = área digitada / total"));
});

test("desmembramento · serviço de cada área: denominação e dono certos; a divisa interna fala da vizinha", () => {
  const { glebas, vertices: vs } = desmembrar();
  const [gD, gR] = glebas;
  const cabD = D.servicoDaArea(servico, gD, "desmembrada");
  assert.equal(cabD.denominacao, "FAZENDA SALGADA VELHA - ÁREA DESMEMBRADA 01");
  assert.equal(cabD.detentor_nome, "MARIA COMPRADORA");
  assert.equal(cabD.detentor_cpf, "222.222.222-22");
  assert.equal(cabD.is_espolio, false, "a compradora não é o espólio");
  assert.equal(cabD.divisao, null);
  assert.equal(cabD.tem_glebas, false);
  assert.equal(cabD.origem_id, SID);
  // denominação digitada vale
  assert.equal(D.servicoDaArea(servico, { ...gD, denominacao: "SÍTIO NOVO" }, "desmembrada").denominacao, "SÍTIO NOVO");
  // a remanescente é do proprietário, mesmo que a gleba traga outro nome por engano
  const cabR = D.servicoDaArea(servico, { ...gR, detentor_nome: "INTRUSO", denominacao: "OUTRA" }, "remanescente");
  assert.equal(cabR.denominacao, "FAZENDA SALGADA VELHA - ÁREA REMANESCENTE");
  assert.equal(cabR.detentor_nome, "ESPÓLIO DE JOSÉ");
  assert.equal(cabR.is_espolio, true, "o espólio continua com o inventariante");
  assert.equal(D.quemRecebe(servico, gD, "desmembrada"), "MARIA COMPRADORA");
  assert.equal(D.quemRecebe(servico, { ...gR, detentor_nome: "INTRUSO" }, "remanescente"), "ESPÓLIO DE JOSÉ");
  // os vértices do serviço da área desmembrada: a divisa interna confronta com a remanescente, do proprietário
  const vizinhas = glebas.map((g, i) => D.glebaComPapel(g, D.papelDaArea(servico.divisao, i)));
  const vp = verticesDaParte(servico, vs, vizinhas, 0, "novo");
  const internos = vp.filter((v) => v.tipo === "M" && /REMANESCENTE/.test(v.descritivo ?? ""));
  assert.ok(internos.length >= 1, "a divisa interna confronta com a ÁREA REMANESCENTE");
  assert.ok(internos.every((v) => v.descritivo.includes("ESPÓLIO DE JOSÉ")), internos.map((v) => v.descritivo).join(" | "));
  // e o serviço da área calcula sozinho, com a área desmembrada
  const calcD = montarServico({
    fusoUtm: 24, prefixo: "DSBN", contadores: { M: 1, P: 1, V: 1 },
    vertices: vp.map((v) => ({
      ordem: v.ordem, numTxt: v.num_txt, e: v.e, n: v.n, latGmsStr: null, lonGmsStr: null, h: v.h, sigmaPos: v.sigma_pos, sigmaH: v.sigma_h,
      tipo: v.tipo, metodo: v.metodo, codigoManual: v.codigo, inserido: v.inserido_manual, descritivo: v.descritivo || "",
      tipoLimite: v.tipo_limite, ehVia: v.eh_via, cns: v.cns, matricula: v.matricula, numerado: v.numerado, exibirPlanta: true,
    })),
  }, proj4);
  assert.ok(Math.abs(calcD.areaHa - 0.75) < 0.0002, `área do serviço da área: ${calcD.areaHa} ha`);
});

test("desmembramento · o serviço da área acompanha a divisão: cabeçalho e desenho", () => {
  const { glebas, vertices: vs } = desmembrar();
  const esperado = D.servicoDaArea(servico, glebas[0], "desmembrada");
  const igual = { denominacao: esperado.denominacao, detentor_nome: esperado.detentor_nome, detentor_cpf: esperado.detentor_cpf };
  assert.equal(D.diferencasNoCabecalho(igual, esperado), null, "nada mudou, nada a gravar");
  const den = D.diferencasNoCabecalho({ ...igual, denominacao: "VELHA" }, esperado);
  assert.deepEqual(den.patch, { denominacao: esperado.denominacao });
  assert.equal(den.trocaPessoa, false);
  assert.match(den.linhas[0], /VELHA →/);
  // nome completado no serviço da área: a mesma pessoa, nada a levar (o RG e o endereço de lá ficam)
  assert.equal(D.diferencasNoCabecalho({ ...igual, detentor_nome: "Maria Compradora de Souza" }, esperado), null);
  // a divisão sem CPF ou sem denominação não apaga o que foi preenchido lá
  assert.equal(D.diferencasNoCabecalho(igual, { ...esperado, detentor_cpf: null, denominacao: "" }), null);
  assert.equal(D.diferencasNoCabecalho({ ...igual, detentor_cpf: "111.222.333-44" }, { ...esperado, detentor_cpf: null }), null);
  // trocou quem recebe: vai a pessoa inteira (o RG e o espólio do dono antigo não servem ao novo) — e a tela pergunta
  const d = D.diferencasNoCabecalho({ ...igual, detentor_nome: "ESPÓLIO DE JOSÉ" }, esperado);
  assert.equal(d.trocaPessoa, true);
  const p = d.patch;
  assert.equal(p.detentor_nome, "MARIA COMPRADORA");
  assert.equal(p.is_espolio, false);
  assert.equal(p.inventariante_nome, null);
  assert.equal(p.detentor_rg, null);
  assert.ok(D.mesmaPessoa("JOSÉ", "jose da silva"));
  assert.ok(!D.mesmaPessoa("JOSÉ", "JOSEFA"));
  const vizinhas = glebas.map((g, i) => D.glebaComPapel(g, D.papelDaArea(servico.divisao, i)));
  const vp = verticesDaParte(servico, vs, vizinhas, 0, "s");
  assert.ok(D.mesmoDesenho(vp, vp.map((v) => ({ ...v, descritivo: "descrito no serviço da área" }))), "a confrontação descrita lá fica");
  assert.ok(!D.mesmoDesenho(vp, vp.map((v, i) => (i === 2 ? { ...v, e: v.e + 0.01 } : v))), "a divisa andou 1 cm");
  assert.ok(!D.mesmoDesenho(vp, vp.map((v, i) => (i === 0 ? { ...v, codigo: "DSBN-M-9999" } : v))), "o imóvel foi renumerado");
  assert.ok(!D.mesmoDesenho(vp, vp.slice(1)));
  // trocou o desenho: o vértice que ficou no lugar mantém a confrontação descrita lá; o que andou vem da divisão
  const descritos = vp.map((v) => ({ ...v, descritivo: "VIZINHO DESCRITO LÁ", matricula: "999" }));
  const novos = vp.map((v, i) => (i === 2 ? { ...v, e: v.e + 5 } : v));
  const m = D.manterConfrontacao(novos, descritos);
  assert.equal(m[0].descritivo, "VIZINHO DESCRITO LÁ");
  assert.equal(m[0].matricula, "999");
  assert.equal(m[2].descritivo, vp[2].descritivo);
});

test("desmembramento · destacar a área pela frente, fundo e laterais: encostada no lado, com a área exata", () => {
  const ent0 = entradaDoServico(vertices, [1, 1], false, pub);
  const nF = D.normalDaFrente(ent0.anel, ent0.estrada);
  assert.ok(nF, "a estrada (lado 3→4) dá a frente");
  const centro = (pts) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  const meioEstrada = centro([ent0.anel[3], ent0.anel[4]]);
  const c = centro(ent0.anel);
  assert.ok((meioEstrada[0] - c[0]) * nF[0] + (meioEstrada[1] - c[1]) * nF[1] > 0, "a normal da frente aponta para a estrada");
  const esq = [nF[1], -nF[0]];               // à esquerda de quem entra pela estrada (dentro = −nF)
  const eixo = { frente: nF, fundo: [-nF[0], -nF[1]], esquerda: esq, direita: [-esq[0], -esq[1]] };
  const fr = D.percentuais([totalHa * 0.1, totalHa * 0.9]);
  const centroide = (parte) => centro(parte.anel.map((q) => [q.e, q.n]));
  for (const lado of ["frente", "fundo", "esquerda", "direita"]) {
    const achou = D.escolherDirecao(nF, lado, (d) => {
      const r = dividir(entradaDoServico(vertices, fr, d.inverter, pub), d.azimute);
      return { ok: r.ok, motivo: r.motivo, frenteEstradaM: r.partes[0]?.frenteEstradaM, r };
    });
    assert.ok(achou.ok, `${lado}: ${achou.motivo}`);
    const [p0, p1] = achou.t.r.partes;
    assert.ok(Math.abs(p0.areaM2 - totalHa * 1000) < 1, `${lado}: ${p0.areaM2.toFixed(2)} m² (a área exata)`);
    const c0 = centroide(p0), c1 = centroide(p1);
    const v = (c0[0] - c1[0]) * eixo[lado][0] + (c0[1] - c1[1]) * eixo[lado][1];
    assert.ok(v > 0, `${lado}: a área fica do lado escolhido (${v.toFixed(1)})`);
    if (lado === "frente") assert.ok(p0.frenteEstradaM > 0, "pela frente, com frente para a estrada");
    if (lado === "fundo") assert.equal(p0.frenteEstradaM, 0, "pelo fundo, longe da estrada");
  }
  // a direção ideal: divisas paralelas ao lado, a 1ª faixa nascendo nele
  const dF = D.direcaoParaLado([0, -1], "frente"); // estrada ao sul
  assert.deepEqual(dF, { azimute: 90, inverter: true });
  assert.deepEqual(D.direcaoParaLado([0, -1], "fundo"), { azimute: 90, inverter: false });
  assert.equal(D.normalDaFrente(ent0.anel, ent0.anel.map(() => false)), null, "sem estrada, sem frente");
  assert.deepEqual(D.ordemParaDestacar(3, 2, 1), [2, 0, 1], "a escolhida primeiro, a remanescente por último");
  assert.deepEqual(D.ordemParaDestacar(3, 1, null), [1, 0, 2]);
});

// ---------------------------------------------------------------------------
// Memorial Tabular dos dados do sistema (modelo da peça 2)
// ---------------------------------------------------------------------------
const SERVICO_TAB = {
  detentor_nome: "MARIA COMPRADORA", detentor_cpf: "222.222.222-22", detentor_genero: "F", endereco_detentor: "ZONA RURAL",
  denominacao: "FAZENDA SALGADA VELHA - ÁREA DESMEMBRADA 01", municipio: "CONCEIÇÃO DO COITÉ", uf: "BA", matricula: "4.490",
  cns: "00.810-2", codigo_sncr: "312.010.028.860-1", fuso_utm: 24, tipo_imovel: "matricula", trt: "BR20260601082",
};
const RT = { nome: "DANIEL NASCIMENTO SANTOS", formacao: "TÉCNICO EM AGRIMENSURA", conselho_sigla: "CFTA", conselho_numero: "0578839458-9" };
const textoDoXml = (xml) => (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((s) => s.replace(/<[^>]+>/g, "")).join(" ").replace(/\s+/g, " ")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

async function tabular(servicoTab, posse = false) {
  const modelos = {};
  for (const [num, arq] of modelosDasPecas(posse)) modelos[num] = readFileSync(new URL(`../reference/${pastaDasPecas(posse)}/${arq}.docx`, import.meta.url));
  const calc = montarServico(entrada(), proj4);
  const ctx = { servico: servicoTab, rt: RT, cred: { prefixo_vertice: "DSBN" }, calc, dataStr: "05/11/2026" };
  const zip = await montarTabularDocx(modelos, ctx, posse);
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml").async("string");
  return { calc, dados: montarDadosPecasDoCalculo(ctx), texto: textoDoXml(xml), xml };
}

test("tabular dos dados do sistema · DOCX pelo modelo da peça 2: vértice inicial, área e o imóvel da área", async () => {
  const { calc, dados, texto, xml } = await tabular(SERVICO_TAB);
  assert.ok(texto.includes("MEMORIAL TABULAR"), "é o modelo do tabular");
  assert.ok(texto.includes(`${dados.areaHa} HA`), `área ${dados.areaHa} HA no cabeçalho`);
  assert.ok(texto.includes("FAZENDA SALGADA VELHA - ÁREA DESMEMBRADA 01"), "denominação da área");
  assert.ok(texto.includes("MARIA COMPRADORA"), "no nome da adquirente");
  // a tabela começa pelo vértice inicial do cálculo (o mesmo do memorial e da planilha)
  const codigos = texto.match(/DSBN-[MPV]-\d+/g) ?? [];
  assert.equal(codigos[0], calc.ring[0].codigo, `1º código da tabela: ${codigos[0]}`);
  for (const v of calc.ring) assert.ok(codigos.includes(v.codigo), `${v.codigo} na tabela`);
  for (const ex of ["LARISSA", "GILBERTO", "FAZENDA VIBRAÇÃO", "DSBN-M-3605"]) assert.ok(!texto.includes(ex), `sem o exemplo do modelo: ${ex}`);
  // XML equilibrado (o Word abre)
  const semAuto = xml.replace(/<[^<>]*\/>/g, "");
  for (const tag of ["w:p", "w:tbl", "w:tr", "w:tc"]) {
    assert.equal((semAuto.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length, (semAuto.match(new RegExp(`</${tag}>`, "g")) ?? []).length, `<${tag}>`);
  }
});

test("tabular dos dados do sistema · posse sai pelos modelos de posse", async () => {
  const { calc, dados, texto } = await tabular({ ...SERVICO_TAB, tipo_imovel: "posse", matricula: null }, true);
  assert.ok(texto.includes(`${dados.areaHa}`), "área");
  assert.equal((texto.match(/DSBN-[MPV]-\d+/g) ?? [])[0], calc.ring[0].codigo);
});
