// Planilha SIGEF de um serviço com glebas.
//
// A decisão foi: UM arquivo, uma aba de perímetro por gleba — `perimetro_1`,
// `perimetro_2`… O template oficial traz só `perimetro_1`, então as demais são
// clones dela. Clonar é o único caminho que não inventa layout: construir a aba
// do zero seria adivinhar a planilha que o SIGEF aceita.
//
// Roda contra o template REAL (reference/PLANTA.ODS), não contra um XML de
// mentira: o que este teste precisa provar é que o clone sobrevive ao arquivo
// que o INCRA publica.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { patchOdsContent } from "../supabase/functions/_shared/ods.ts";

const conteudoTemplate = async () => {
  const z = await JSZip.loadAsync(readFileSync(new URL("../reference/PLANTA.ODS", import.meta.url)));
  return z.file("content.xml").async("string");
};

const abas = (xml) => [...xml.matchAll(/<table:table table:name="([^"]+)"/g)].map((m) => m[1]);

const IDENT = {
  natureza: "Particular", tipoPessoa: "Física", nome: "FULANO DE TAL", cpf: "000.000.000-00",
  denominacao: "FAZENDA SALGADA VELHA", situacao: "Imóvel Registrado", naturezaArea: "Particular",
  sncr: "", cns: "00.810-2", matricula: "1.234", municipioUf: "Araci-BA",
};

const linha = (n) => ({
  codigo: `DSBN-P-${14000 + n}`, lonFmt: "39 10 24,104 W", latFmt: "11 27 35,073 S",
  sigmaPos: 0.01, h: 360, sigmaH: 0.01, metodo: "PG6", tipoLimite: "LA1",
  cns: null, matricula: null, descritivo: "",
});

const perimetro = (nome, num, qtd) => ({
  denominacaoParcela: nome, parcelaNumero: num, lado: "Externo",
  mcAbs: 39, hemisferio: "Sul",
  linhas: Array.from({ length: qtd }, (_, i) => linha(i)),
});

test("sem glebas, a planilha continua com uma aba de perímetro só", async () => {
  const out = patchOdsContent(await conteudoTemplate(), IDENT, perimetro("Parte 1", "001", 5));
  const nomes = abas(out);
  assert.deepEqual(nomes.filter((n) => n.startsWith("perimetro")), ["perimetro_1"]);
});

test("a forma antiga (um perímetro solto) e a nova (lista de um) dão o mesmo arquivo", async () => {
  // garante que passar a lista não mudou o comportamento de quem já chamava
  const tpl = await conteudoTemplate();
  const p = perimetro("Parte 1", "001", 4);
  assert.equal(patchOdsContent(tpl, IDENT, p), patchOdsContent(tpl, IDENT, [p]));
});

test("com três glebas saem três abas de perímetro, numeradas", async () => {
  const out = patchOdsContent(await conteudoTemplate(), IDENT, [
    perimetro("GLEBA 1", "001", 5),
    perimetro("GLEBA 2", "002", 4),
    perimetro("GLEBA 3", "003", 6),
  ]);
  assert.deepEqual(
    abas(out).filter((n) => n.startsWith("perimetro")),
    ["perimetro_1", "perimetro_2", "perimetro_3"],
  );
  // as demais abas do template continuam lá, e uma só vez
  const nomes = abas(out);
  assert.equal(nomes.filter((n) => n === "identificacao").length, 1);
  assert.ok(nomes.includes("parametros_vertice_validacao"));
});

test("cada aba recebe a denominação e o número da SUA gleba", async () => {
  const out = patchOdsContent(await conteudoTemplate(), IDENT, [
    perimetro("GLEBA 1", "001", 3),
    perimetro("GLEBA 2", "002", 3),
  ]);
  const corte = out.indexOf('table:name="perimetro_2"');
  const [aba1, aba2] = [out.slice(0, corte), out.slice(corte)];
  assert.ok(aba1.includes("GLEBA 1"), "a primeira aba tem de nomear a GLEBA 1");
  assert.ok(aba2.includes("GLEBA 2"), "a segunda aba tem de nomear a GLEBA 2");
  // e o clone não arrastou os dados da anterior
  assert.equal(aba2.includes("GLEBA 1"), false, "a GLEBA 1 vazou para a aba da GLEBA 2");
});

test("cada aba leva os vértices da sua gleba, e só eles", async () => {
  const g1 = perimetro("GLEBA 1", "001", 3);
  const g2 = { ...perimetro("GLEBA 2", "002", 2), linhas: [linha(90), linha(91)] };
  const out = patchOdsContent(await conteudoTemplate(), IDENT, [g1, g2]);
  const corte = out.indexOf('table:name="perimetro_2"');
  const [aba1, aba2] = [out.slice(0, corte), out.slice(corte)];
  assert.ok(aba1.includes("DSBN-P-14000") && aba1.includes("DSBN-P-14002"));
  assert.equal(aba1.includes("DSBN-P-14090"), false, "vértice da GLEBA 2 caiu na aba da GLEBA 1");
  assert.ok(aba2.includes("DSBN-P-14090") && aba2.includes("DSBN-P-14091"));
  assert.equal(aba2.includes("DSBN-P-14000"), false, "vértice da GLEBA 1 caiu na aba da GLEBA 2");
});

test("planilha sem perímetro nenhum é erro, não arquivo vazio", async () => {
  const tpl = await conteudoTemplate();
  assert.throws(() => patchOdsContent(tpl, IDENT, []), /Nenhum perímetro/);
});
