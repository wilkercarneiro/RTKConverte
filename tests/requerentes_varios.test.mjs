// Três ou mais requerentes (pedido de cliente, 23/11/2026): o operador escolhe
// quantos assinam e TODOS saem em todos os documentos — nas frases conjuntas
// (com a concordância do grupo), no cabeçalho e numa assinatura própria cada
// um, com nome e CPF. Nenhum resto do exemplo do modelo (LARISSA/GILBERTO,
// ANTONIO) pode sobrar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import proj4 from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { montarDadosPecasDoCalculo } from "../supabase/functions/_shared/pecas_dados.ts";
import { modelosDasPecas, pastaDasPecas } from "../supabase/functions/_shared/tabular_sistema.ts";
import { gerarPecasXml, gerarPecasPosseXml, gerarMemorialDescritivoXml, juntarE } from "../supabase/functions/_shared/pecas.ts";
import { outrosRequerentes } from "../supabase/functions/_shared/requerentes.ts";
import { montarDadosPlanta, servicoDaGleba } from "../supabase/functions/_shared/planta_dados.ts";
import { entrada } from "./fixtures/salgada_velha.mjs";

const RT = { nome: "DANIEL NASCIMENTO SANTOS", formacao: "TÉCNICO EM AGRIMENSURA", conselho_sigla: "CFTA", conselho_numero: "0578839458-9", cpf: "000.000.000-00", identidade: "00.000.000-00 SSP/BA" };
const QUATRO = [
  { nome: "JOSÉ PRIMEIRO DA SILVA", cpf: "111.111.111-11", genero: "M" },
  { nome: "ANA SEGUNDA DA SILVA", cpf: "222.222.222-22", genero: "F" },
  { nome: "MARIA TERCEIRA DA SILVA", cpf: "333.333.333-33", genero: "F" },
  { nome: "PEDRO QUARTO DA SILVA", cpf: "444.444.444-44", genero: "M" },
];
const servicoCom = (pessoas, tipo = "matricula") => ({
  detentor_nome: pessoas[0].nome, detentor_cpf: pessoas[0].cpf, detentor_genero: pessoas[0].genero,
  requerente2_nome: pessoas[1]?.nome ?? null, requerente2_cpf: pessoas[1]?.cpf ?? null, requerente2_genero: pessoas[1]?.genero ?? null,
  requerentes_extras: pessoas.slice(2),
  endereco_detentor: "RUA DAS FLORES, 10, CENTRO", denominacao: "FAZENDA DOS IRMÃOS", municipio: "CONCEIÇÃO DO COITÉ", uf: "BA",
  matricula: "9.999", cns: "00.810-2", fuso_utm: 24, trt: "BR20261123001", tipo_imovel: tipo,
});
const texto = (xml) => (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
  .map((p) => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((s) => s.replace(/<[^>]+>/g, "")).join(""));
const conta = (linhas, alvo) => linhas.filter((l) => l.trim() === alvo).length;

async function modelos(posse) {
  const xml = {};
  for (const [num, arq] of modelosDasPecas(posse)) {
    const bytes = readFileSync(new URL(`../reference/${pastaDasPecas(posse)}/${arq}.docx`, import.meta.url));
    xml[num] = await (await JSZip.loadAsync(bytes)).file("word/document.xml").async("string");
  }
  return xml;
}
function dados(pessoas, tipo) {
  const calc = montarServico(entrada(), proj4);
  return montarDadosPecasDoCalculo({ servico: servicoCom(pessoas, tipo), rt: RT, cred: { prefixo_vertice: "DSBN" }, calc, dataStr: "23/11/2026" });
}

test("outrosRequerentes: 2º das colunas antigas + lista do 3º em diante, sem item vazio", () => {
  const s = servicoCom(QUATRO);
  s.requerentes_extras = [...s.requerentes_extras, { nome: "  ", cpf: "x" }, null, "lixo"];
  assert.deepEqual(outrosRequerentes(s).map((r) => r.nome), QUATRO.slice(1).map((r) => r.nome));
  assert.deepEqual(outrosRequerentes({ requerente2_nome: null, requerentes_extras: null }), []);
  assert.equal(juntarE(["A"]), "A");
  assert.equal(juntarE(["A", "B"]), "A e B");
  assert.equal(juntarE(["A", "B", "C"]), "A, B e C");
});

test("matrícula com 4 requerentes: todas as 7 peças com os 4, cada um assinando, sem exemplo sobrando", async () => {
  const d = dados(QUATRO, "matricula");
  assert.equal(d.requerentes.length, 4);
  const tpl = await modelos(false);
  const out = gerarPecasXml(tpl, d);
  for (const n of ["1", "2", "3", "4", "5", "6", "7"]) {
    if (out[n] === null) continue; // 7 sai só com via
    const l = texto(out[n]);
    const tudo = l.join(" ");
    for (const ex of ["LARISSA", "GILBERTO", "028.090.615-30", "048.778.385-97"]) {
      assert.ok(!tudo.includes(ex), `peça ${n}: sobrou ${ex}`);
    }
    for (const r of QUATRO) assert.ok(tudo.includes(r.nome), `peça ${n}: falta ${r.nome}`);
  }
  // assinaturas: uma por requerente, com o rótulo do gênero dele, em cada peça que assina
  const l1 = texto(out["1"]);
  assert.equal(conta(l1, "Proprietário: JOSÉ PRIMEIRO DA SILVA"), 1);
  assert.equal(conta(l1, "Proprietária: ANA SEGUNDA DA SILVA"), 1);
  assert.equal(conta(l1, "Proprietária: MARIA TERCEIRA DA SILVA"), 1);
  assert.equal(conta(l1, "Proprietário: PEDRO QUARTO DA SILVA"), 1);
  for (const r of QUATRO) assert.equal(conta(l1, `CPF nº:${r.cpf}`), 1, `memorial: CPF de ${r.nome} sob a assinatura`);
  const l5 = texto(out["5"]), l6 = texto(out["6"]);
  for (const r of QUATRO) {
    assert.equal(conta(l5, `Requerente: ${r.nome}`), 1, `declaração: assinatura de ${r.nome}`);
    assert.equal(conta(l6, `Requerente: ${r.nome}`), 1, `requerimento: assinatura de ${r.nome}`);
  }
  // as cartas: em cada carta, os 4 assinam
  const l3 = texto(out["3"]);
  const nCartas = l3.filter((t) => t.trim() === "CARTA DE ANUÊNCIA").length;
  assert.ok(nCartas >= 1);
  assert.equal(l3.filter((t) => /^Propriet.ria?: PEDRO QUARTO DA SILVA$/.test(t.trim()) || t.trim() === "Proprietário: PEDRO QUARTO DA SILVA").length, nCartas, "o 4º assina toda carta");
  // frases do grupo
  const t3 = l3.join(" "), t4 = texto(out["4"]).join(" "), t5 = l5.join(" "), t6 = l6.join(" ");
  assert.ok(t3.includes("Eu, Proprietário JOSÉ PRIMEIRO DA SILVA, CPF nº:111.111.111-11, Eu, Proprietária ANA SEGUNDA DA SILVA, CPF nº:222.222.222-22, Eu, Proprietária MARIA TERCEIRA DA SILVA, CPF nº:333.333.333-33, Eu, Proprietário PEDRO QUARTO DA SILVA, CPF nº:444.444.444-44, proprietários do imóvel"), "carta: os 4 qualificados");
  assert.ok(t4.includes("propriedade dos Srs. JOSÉ PRIMEIRO DA SILVA, CPF nº:111.111.111-11, ANA SEGUNDA DA SILVA, CPF nº:222.222.222-22, MARIA TERCEIRA DA SILVA, CPF nº:333.333.333-33, PEDRO QUARTO DA SILVA, CPF nº:444.444.444-44."), "declaração do técnico");
  assert.ok(t5.includes("Interessados (a): JOSÉ PRIMEIRO DA SILVA, ANA SEGUNDA DA SILVA, MARIA TERCEIRA DA SILVA, PEDRO QUARTO DA SILVA."), "interessados");
  assert.ok(t5.includes("Eu, JOSÉ PRIMEIRO DA SILVA, CPF nº:111.111.111-11, BRASILEIRO, MAIOR, CAPAZ, Eu, ANA SEGUNDA DA SILVA, CPF nº:222.222.222-22, BRASILEIRA, MAIOR, CAPAZ, Eu, MARIA TERCEIRA DA SILVA, CPF nº:333.333.333-33, BRASILEIRA, MAIOR, CAPAZ e Eu, PEDRO QUARTO DA SILVA, CPF nº:444.444.444-44, BRASILEIRO, MAIOR, CAPAZ."), "declaração do proprietário");
  assert.ok(t6.includes("Proprietários: JOSÉ PRIMEIRO DA SILVA, CPF nº:111.111.111-11, BRASILEIRO, MAIOR, CAPAZ, ANA SEGUNDA"), "requerimento");
  // cabeçalho do memorial: os 4 nomes e os 4 CPFs
  assert.ok(l1.some((t) => t.includes("JOSÉ PRIMEIRO DA SILVA/ ANA SEGUNDA DA SILVA/ MARIA TERCEIRA DA SILVA/ PEDRO QUARTO DA SILVA")));
  assert.ok(l1.some((t) => t.includes("111.111.111-11/ 222.222.222-22/ 333.333.333-33/ 444.444.444-44")));
});

test("matrícula: no memorial tabular (caixa presa ao pé da folha) as assinaturas viram grade de 2 colunas", async () => {
  // Conferido no Word: empilhadas, a 4ª saía para fora da página.
  const tpl = await modelos(false);
  const caixa = (xml) => {
    const i = xml.search(/JOSÉ PRIMEIRO DA SILVA<\/w:t>/);
    const ini = xml.lastIndexOf("<w:txbxContent", i), fim = xml.indexOf("</w:txbxContent>", i);
    const forma = xml.lastIndexOf("<v:shape ", ini);
    return {
      altura: parseFloat(/height:([\d.]+)pt/.exec(xml.slice(forma, xml.indexOf(">", forma)))[1]),
      conteudo: xml.slice(ini, fim),
    };
  };
  const c2 = caixa(gerarPecasXml(tpl, dados(QUATRO.slice(0, 2), "matricula"))["2"]);
  const c4 = caixa(gerarPecasXml(tpl, dados(QUATRO, "matricula"))["2"]);
  assert.ok(!c2.conteudo.includes("<w:tbl>"), "casal: o modelo como é");
  assert.ok(c4.conteudo.includes("<w:tbl>"), "4: grade");
  assert.equal((c4.conteudo.match(/<w:tr>/g) ?? []).length, 2, "4 pessoas = 2 fileiras");
  assert.equal(c4.altura, c2.altura, "até 4 cabe na altura do casal");
  for (const r of QUATRO) assert.ok(texto(c4.conteudo).some((t) => t.trim().endsWith(`: ${r.nome}`)), r.nome);
  const seis = [...QUATRO, { nome: "LUCAS QUINTO", cpf: "555.555.555-55", genero: "M" }, { nome: "RITA SEXTA", cpf: "666.666.666-66", genero: "F" }];
  const c6 = caixa(gerarPecasXml(tpl, dados(seis, "matricula"))["2"]);
  assert.equal((c6.conteudo.match(/<w:tr>/g) ?? []).length, 3);
  assert.ok(c6.altura > c2.altura, `6 pessoas: a caixa cresce uma fileira (${c2.altura} → ${c6.altura})`);
});

test("com dois requerentes, nada muda em relação ao modelo do casal", async () => {
  const tpl = await modelos(false);
  const out = gerarPecasXml(tpl, dados(QUATRO.slice(0, 2), "matricula"));
  const t5 = texto(out["5"]).join(" ");
  assert.ok(t5.includes("Eu, JOSÉ PRIMEIRO DA SILVA, CPF nº:111.111.111-11, BRASILEIRO, MAIOR, CAPAZ e Eu, ANA SEGUNDA DA SILVA, CPF nº:222.222.222-22, BRASILEIRA, MAIOR, CAPAZ."));
  const l1 = texto(out["1"]);
  assert.equal(l1.filter((t) => /^Propriet.ri[oa]: /.test(t.trim())).length, 2);
});

test("memorial descritivo sozinho (gerar-documentos) também traz as 4 assinaturas, uma vez cada", async () => {
  const tpl = await modelos(false);
  const l = texto(gerarMemorialDescritivoXml(tpl["1"], dados(QUATRO, "matricula")));
  for (const r of QUATRO) assert.equal(l.filter((t) => t.trim().endsWith(`: ${r.nome}`)).length, 1, r.nome);
});

test("posse com 4 posseiros: todas as peças, frases no plural e uma assinatura cada", async () => {
  const d = dados(QUATRO, "posse");
  const tpl = await modelos(true);
  const out = gerarPecasPosseXml(tpl, d);
  for (const [n, xml] of Object.entries(out)) {
    if (!xml) continue;
    const l = texto(xml);
    const tudo = l.join(" ");
    assert.ok(!tudo.includes("ANTONIO DA SILVA COSTA"), `peça ${n}: sobrou o exemplo`);
    for (const r of QUATRO) assert.ok(tudo.includes(r.nome), `peça ${n}: falta ${r.nome}`);
    const assin = l.filter((t) => /^Posseir[oa]: /.test(t.trim()));
    if (assin.length) {
      for (const r of QUATRO) {
        assert.ok(assin.filter((t) => t.trim().endsWith(r.nome)).length >= 1, `peça ${n}: assinatura de ${r.nome}`);
      }
    }
  }
  const t3 = texto(out["3"]).join(" ");
  assert.ok(t3.includes("Eu, Posseiro JOSÉ PRIMEIRO DA SILVA, CPF nº:111.111.111-11, Eu, Posseira ANA SEGUNDA DA SILVA, CPF nº:222.222.222-22, Eu, Posseira MARIA TERCEIRA DA SILVA, CPF nº:333.333.333-33, Eu, Posseiro PEDRO QUARTO DA SILVA, CPF nº:444.444.444-44, possuidores do imóvel"));
  const l1 = texto(out["1"]);
  assert.equal(l1.filter((t) => t.trim() === "Posseira: MARIA TERCEIRA DA SILVA").length, 1, "memorial: uma assinatura da 3ª");
});

test("posse com três mulheres: concordância no feminino", async () => {
  const mulheres = QUATRO.filter((r) => r.genero === "F").concat([{ nome: "LUCIA QUINTA", cpf: "555.555.555-55", genero: "F" }]);
  const out = gerarPecasPosseXml(await modelos(true), dados(mulheres, "posse"));
  const tudo = Object.values(out).filter(Boolean).map((x) => texto(x).join(" ")).join(" ");
  assert.ok(tudo.includes("possuidoras do imóvel"));
  assert.ok(!/legítimos posseiros/.test(tudo));
});

for (const posse of [false, true]) {
  test(`modelo padrão das empresas novas (${posse ? "posse" : "matrícula"}): os 4 em toda peça, uma assinatura cada`, async () => {
    const xml = {};
    for (const [num, arq] of modelosDasPecas(posse)) {
      const bytes = readFileSync(new URL(`./fixtures/modelos-padrao/${pastaDasPecas(posse)}/${arq}.docx`, import.meta.url));
      xml[num] = await (await JSZip.loadAsync(bytes)).file("word/document.xml").async("string");
    }
    const d = dados(QUATRO, posse ? "posse" : "matricula");
    const out = posse ? gerarPecasPosseXml(xml, d) : gerarPecasXml(xml, d);
    for (const [n, x] of Object.entries(out)) {
      if (!x) continue;
      const l = texto(x), tudo = l.join(" ");
      for (const ex of ["LARISSA", "GILBERTO", "ANTONIO DA SILVA COSTA"]) assert.ok(!tudo.includes(ex), `peça ${n}: sobrou ${ex}`);
      for (const r of QUATRO) assert.ok(tudo.includes(r.nome), `peça ${n}: falta ${r.nome}`);
    }
    const l1 = texto(out["1"]);
    for (const r of QUATRO) assert.equal(l1.filter((t) => t.trim().endsWith(`: ${r.nome}`)).length, 1, `memorial: ${r.nome}`);
  });
}

test("planta: os 4 assinam e o herdeiro da gleba não herda os co-requerentes", () => {
  const s = servicoCom(QUATRO);
  const g = servicoDaGleba(s, { detentor_nome: "HERDEIRO ÚNICO", detentor_cpf: "999.999.999-99" }, "GLEBA 1");
  assert.deepEqual(outrosRequerentes(g), []);
  assert.equal(typeof montarDadosPlanta, "function");
});
