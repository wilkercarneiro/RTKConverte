// Teste dos geradores (Fase 4/5): monta o serviço do Anexo A a partir do
// LARISSA.txt, gera DOCX + ODS reais e valida por leitura (unzip + inspeção).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import proj4lib from "proj4";
import JSZip from "jszip";
import { parseTxt } from "../supabase/functions/_shared/geo.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { corpoMemorial } from "../supabase/functions/_shared/memorial.ts";
import { buildDocumentXml, buildDocxSkeleton } from "../supabase/functions/_shared/docx.ts";
import { patchOdsContent } from "../supabase/functions/_shared/ods.ts";

const proj4 = (from, to, coords) => proj4lib(from, to, coords);
const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// --- Montagem do serviço do Anexo A -----------------------------------------
const pontos = parseTxt(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8"));
const DESCRITIVOS = {
  30: "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA\\ CARLOS MATOS DE LIMA\\ CPF:39752186572\\ DIVALDO JOSE MATOS DE LIMA\\ CPF:18024629534",
  36: "(POSSE) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  41: "(MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  58: "(POSSE) FAZENDA PAU D'ÁGUA\\ VALDETE DOS SANTOS\\ CPF:161.770.455-53",
  64: "BA 408",
  9: "CORREDOR",
};
const TIPO_LIMITE = { 30: "LA1", 36: "LA1", 41: "LA1", 58: "LA1", 64: "LA3", 9: "LA3" };
const MS = new Set([30, 36, 41, 58, 64, 9]);

const vertices = [];
for (const p of pontos) {
  if (p.num === 69) {
    // vértice V pré-existente inserido entre os pontos TXT 68 e 69
    vertices.push({
      ordem: 0, numTxt: null, latGmsStr: "11 24 30,375 S", lonGmsStr: "39 4 47,198 W",
      h: 289.765, sigmaPos: 0, sigmaH: 0.02, tipo: "V", metodo: "PA1",
      codigoManual: "DSBN-V-0758", inserido: true,
    });
  }
  vertices.push({
    ordem: 0, numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
    tipo: MS.has(p.num) ? "M" : "P", metodo: "PG6", inserido: false,
  });
}
vertices.forEach((v, i) => { v.ordem = i; });
const ordemDe = (numTxt) => vertices.findIndex((v) => v.numTxt === numTxt);

const servico = montarServico({
  fusoUtm: 24,
  verticeInicialOrdem: ordemDe(30),
  prefixo: "DSBN",
  contadores: { M: 3605, P: 13130, V: 758 },
  vertices,
  trechos: [30, 36, 41, 58, 64, 9].map((n) => ({
    verticeInicioOrdem: ordemDe(n), descritivo: DESCRITIVOS[n], tipoLimite: TIPO_LIMITE[n],
  })),
}, proj4);

test("montagem: 70 vértices, códigos e contadores", () => {
  assert.equal(servico.ring.length, 70);
  assert.equal(servico.ring[0].codigo, "DSBN-M-3605");
  assert.equal(servico.ring[0].numTxt, 30);
  assert.equal(servico.ring[1].codigo, "DSBN-P-13130"); // confere com o histórico
  const v = servico.ring.find((x) => x.tipo === "V");
  assert.equal(v.codigo, "DSBN-V-0758");
  assert.equal(v.metodo, "PA1");
  assert.deepEqual(servico.contadoresFinais, { M: 3611, P: 13193, V: 758 }); // 6 M, 63 P, V manual não consome
});

test("montagem: área/perímetro compatíveis com o arquivo histórico", () => {
  console.log(`    área: ${servico.areaHa.toFixed(4)} ha | perímetro: ${servico.perimetroM.toFixed(2)} m`);
  assert.ok(Math.abs(servico.areaHa - 83.9886) <= 0.01, `área ${servico.areaHa}`);
  assert.ok(Math.abs(servico.perimetroM - 4075.94) <= 0.5, `perímetro ${servico.perimetroM}`);
});

const dadosMemorial = {
  imovel: "FAZENDA TESTE", proprietario: "TESTE DA SILVA", cpfProprietario: "000.000.000-00",
  municipio: "Araci", uf: "BA", matricula: "4490", comarca: "", codigoCredenciamento: "",
  areaHa: servico.areaHa, perimetroM: servico.perimetroM, mcAbs: servico.mcAbs,
  dataStr: "22/07/2026", rtNome: "", rtCrea: "", rtTrt: "",
  ring: servico.memorialRing, segs: servico.segs,
  confrontantesDescritivos: servico.trechosOrdenados.map((t) => t.descritivo),
};

test("memorial: abertura, MC real e segmentos históricos", () => {
  const texto = corpoMemorial(dadosMemorial).map((r) => r.text).join("");
  assert.ok(texto.startsWith("Inicia-se a descrição deste perímetro no vértice DSBN-M-3605, georreferenciado no Sistema Geodésico Brasileiro, DATUM - SIRGAS2000, MC-39°W, de coordenadas -11°23'44,344\" S e "));
  assert.ok(/-39°05'04,73[67]" W de altitude 300,05 m; deste segue confrontando com a propriedade de \(MATR\.4\.403/.test(texto), "abertura com MC-39 (bug do legado corrigido)");
  // segmentos de aceitação (3.2) — códigos idênticos aos do arquivo histórico
  assert.ok(texto.includes(`129°46'54" por uma distância de 33,01m até o vértice DSBN-P-13132`), "segmento 32→33");
  assert.ok(texto.includes(`130°03'37" por uma distância de 43,37m até o vértice DSBN-P-13133`), "segmento 33→34");
  assert.ok(texto.includes(`130°14'30" por uma distância de 24,62m até o vértice DSBN-P-13134`), "segmento 34→35");
  assert.ok(!texto.includes("-45°"), "não pode reproduzir o bug de 45° do legado");
  assert.ok(texto.trimEnd().endsWith(`ponto inicial da descrição deste perímetro de ${texto.includes("4.075,") ? texto.match(/perímetro de ([\d.,]+) m\.$/)[1] : "?"} m.`));
});

test("DOCX: pacote gerado, XML bem formado, negritos presentes", async () => {
  const zip = new JSZip();
  for (const [path, content] of buildDocxSkeleton()) zip.file(path, content);
  zip.file("word/document.xml", buildDocumentXml(dadosMemorial));
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  writeFileSync(new URL("memorial-teste.docx", OUT), buf);
  // leitura real: reabrir e inspecionar
  const re = await JSZip.loadAsync(buf);
  const doc = await re.file("word/document.xml").async("string");
  assert.ok(doc.includes("<w:b/></w:rPr><w:t xml:space=\"preserve\">DSBN-M-3605</w:t>"), "código em negrito");
  assert.match(doc, /<w:b\/><\/w:rPr><w:t xml:space="preserve">-11°23&apos;44,344&quot; S<\/w:t>/, "coordenada em negrito");
  const abre = (doc.match(/<w:p>/g) ?? []).length, fecha = (doc.match(/<\/w:p>/g) ?? []).length;
  assert.equal(abre, fecha, "XML balanceado");
  assert.equal((doc.match(/Confrontante: _/g) ?? []).length, 6, "6 linhas de confrontante");
});

test("ODS: abas preservadas, 70 linhas de vértices, valores conferem", async () => {
  const template = readFileSync(new URL("../reference/PLANTA.ODS", import.meta.url));
  const zipIn = await JSZip.loadAsync(template);
  const contentXml = await zipIn.file("content.xml").async("string");
  const patched = patchOdsContent(contentXml, {
    natureza: "Particular", tipoPessoa: "Física", nome: "TESTE DA SILVA", cpf: "000.000.000-00",
    denominacao: "FAZENDA TESTE", situacao: "Imóvel Registrado", naturezaArea: "Particular",
    sncr: "312.010.028.860-1", cns: "00.803-7", matricula: "4490", municipioUf: "Araci-BA",
  }, {
    denominacaoParcela: "Parte 1", parcelaNumero: "001", lado: "Externo",
    mcAbs: servico.mcAbs, hemisferio: "Sul", linhas: servico.linhasOds,
  });
  // remonta o zip preservando todos os demais arquivos; mimetype sem compressão
  const zipOut = new JSZip();
  zipOut.file("mimetype", await zipIn.file("mimetype").async("uint8array"), { compression: "STORE" });
  for (const name of Object.keys(zipIn.files)) {
    if (name === "mimetype" || name === "content.xml" || zipIn.files[name].dir) continue;
    zipOut.file(name, await zipIn.file(name).async("uint8array"), { compression: "DEFLATE" });
  }
  zipOut.file("content.xml", patched, { compression: "DEFLATE" });
  const buf = await zipOut.generateAsync({ type: "nodebuffer" });
  writeFileSync(new URL("planta-teste.ods", OUT), buf);

  // leitura real
  const re = await JSZip.loadAsync(buf);
  const xml = await re.file("content.xml").async("string");
  for (const aba of ["identificacao", "perimetro_1", "sobre", "parametros_controles", "parametros_vertice", "parametros_imovel_validacao", "parametros_vertice_validacao", "parametros_vertice_validacao_excecao"]) {
    assert.ok(xml.includes(`table:name="${aba}"`), `aba ${aba} preservada`);
  }
  assert.ok(xml.includes(">TESTE DA SILVA</text:p>"), "nome do detentor");
  assert.ok(xml.includes(">FAZENDA TESTE</text:p>"), "denominação");
  assert.ok(xml.includes(">Araci-BA</text:p>"), "município");
  const linhas = xml.match(/<table:table-cell table:style-name="ce106" office:value-type="string"[^>]*><text:p>DSBN-/g) ?? [];
  assert.equal(linhas.length, 70, "70 linhas de vértices");
  assert.ok(xml.includes(">DSBN-M-3605</text:p>"));
  assert.ok(/>39 5 04,73[67] W<\/text:p>/.test(xml), "long do ponto 30");
  assert.ok(xml.includes(">11 23 44,344 S</text:p>"), "lat do ponto 30");
  assert.ok(xml.includes(">DSBN-V-0758</text:p>"), "vértice V inserido");
  assert.ok(xml.includes(">11 24 30,375 S</text:p>"), "coordenada digitada do V");
  assert.ok(xml.includes(">PA1</text:p>"), "método PA1 do V");
  assert.ok(!xml.includes("GILBERTO"), "dados do template substituídos");
  assert.ok(!xml.includes("FAZENDA VIBRAÇÃO"), "denominação do template substituída");
  // integridade básica de pares de tags de linha
  const abre = (xml.match(/<table:table-row/g)).length, fecha = (xml.match(/<\/table:table-row>/g)).length;
  assert.equal(abre, fecha, "linhas balanceadas");
});
