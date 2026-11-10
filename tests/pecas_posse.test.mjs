// Teste das peças de POSSE (cenário ANTONIO): 4 modelos próprios em
// reference/pecas-posse/, confrontantes sem rótulo de imóvel ("NOME\ CPF:...")
// e declaração de faixa de domínio só quando há estrada/corredor/rio.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../supabase/functions/_shared/sigef_pdf.ts";
import { gerarPecasPosseXml, montarTrechosPecas } from "../supabase/functions/_shared/pecas.ts";

const OUT = new URL("./out/pecas-posse/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const pdfBuf = new Uint8Array(readFileSync(new URL("../reference/PREVIA-FAZENDA-VIBRACAO.pdf", import.meta.url)));
const pdf = await getDocumentProxy(pdfBuf);
const { text } = await extractText(pdf, { mergePages: true });
const sigef = parseSigefTexto(text);

// descritivos no formato do caso ANTONIO: pessoa = "NOME\ CPF:...", via = nome da via
const DESCS = {
  "DSBN-M-3605": { descritivo: "MARIA NINA DA SILVA COSTA\\ CPF:666.186.815-53", tipoLimite: "LA1" },
  "DSBN-M-3607": { descritivo: "ROQUE FERREIRA DE SÁ\\ CPF: 087.471.135-53", tipoLimite: "LA1" },
  "DSBN-M-3606": { descritivo: "RUDSON PINTO FERREIRA\\ CPF:791.234.145-53", tipoLimite: "LA1" },
  "DSBN-M-3608": { descritivo: "VALDETE DOS SANTOS\\ CPF:161.770.455-53", tipoLimite: "LA1" },
  "DSBN-M-3609": { descritivo: "ESTRADA VICINAL", tipoLimite: "LA3" },
  "DSBN-M-3610": { descritivo: "CORREDOR", tipoLimite: "LA3" },
};
const { trechos, confrontacaoDe } = montarTrechosPecas(sigef.linhas, new Map(Object.entries(DESCS)));

const dados = {
  requerentes: [{ nome: "ANTONIA DE TESTE COSTA", cpf: "111.222.333-44", genero: "F" }],
  rg: "99.888.777-66",
  endereco: "Estrada da Serra, n° 10, Zona Rural, CEP: 44100-000, Serrinha, Bahia",
  municipio: "Serrinha", uf: "BA",
  denominacao: "FAZENDA BOA VISTA", matricula: "", cns: "",
  sncrFmt: "999.999.999.999-9", sncrNum: "9999999999999",
  areaHa: sigef.cabecalho.areaHa, perimetro: sigef.cabecalho.perimetroM,
  areaMatriculaHa: null, mcAbs: 39,
  trt: "BR20250804764", dataStr: "22/07/2026",
  rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agrimensura", conselhoSigla: "CREA", conselhoNumero: "12345-D", identidade: "11.111.111-11 SSP/BA", cpf: "999.888.777-66" },
  viaDominio: null,
  sigef, trechos, confrontacaoDe,
};

const NOMES = { 1: "1-memorial-descritivo", 2: "2-memorial-tabular", 3: "3-cartas-anuencia", 7: "4-declaracao-faixa-dominio" };
const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

test("trechos do caso ANTONIO: pessoas reconhecidas e vias separadas", () => {
  const pessoas = trechos.filter((t) => !t.ehVia && t.pessoas.length > 0);
  const vias = trechos.filter((t) => t.ehVia);
  assert.equal(pessoas.length, 4, `pessoas: ${pessoas.length}`);
  assert.equal(vias.length, 2, `vias: ${vias.length}`);
  assert.equal(pessoas[0].pessoas[0].nome, "MARIA NINA DA SILVA COSTA");
  assert.equal(pessoas[0].pessoas[0].cpf, "666.186.815-53");
});

const textos = {};
let xmlCartas = "";
test("geração das 4 peças de posse", async () => {
  const tpl = {};
  const zips = {};
  for (const [k, nome] of Object.entries(NOMES)) {
    const zip = await JSZip.loadAsync(readFileSync(new URL(`../reference/pecas-posse/${nome}.docx`, import.meta.url)));
    zips[k] = zip;
    tpl[k] = await zip.file("word/document.xml").async("string");
  }
  const xmls = gerarPecasPosseXml(tpl, dados);
  for (const [k, nome] of Object.entries(NOMES)) {
    assert.ok(xmls[k], `peça ${k} não gerada`);
    zips[k].file("word/document.xml", xmls[k]);
    const buf = await zips[k].generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    writeFileSync(new URL(`${nome}.docx`, OUT), buf);
    const re = await JSZip.loadAsync(buf);
    const xml = await re.file("word/document.xml").async("string");
    textos[k] = dec(xml.replace(/<[^>]+>/g, ""));
    if (k === "3") xmlCartas = xml;
    const semSelf = xml.replace(/<[^<>]*\/>/g, "");
    for (const tag of ["w:p", "w:tbl", "w:tr", "w:tc"]) {
      const abre = (semSelf.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
      const fecha = (semSelf.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      assert.equal(abre, fecha, `peça ${k}: <${tag}> desbalanceado (${abre}/${fecha})`);
    }
  }
});

test("peças de posse: dados de exemplo substituídos", () => {
  for (const k of ["1", "2", "3", "7"]) {
    const t = textos[k];
    assert.ok(!t.includes("ANTONIO DA SILVA COSTA"), `peça ${k} ainda tem ANTONIO`);
    assert.ok(!t.includes("FAZENDA SÃO DOMINGOS"), `peça ${k} ainda tem a fazenda de exemplo`);
    assert.ok(!t.includes("DANIEL NASCIMENTO"), `peça ${k} ainda tem o RT de exemplo`);
    assert.ok(t.includes("ANTONIA DE TESTE COSTA"), `peça ${k} sem a requerente`);
  }
  // 1: gênero, RG e cabeçalho
  assert.ok(textos[1].includes("Posseira: ANTONIA DE TESTE COSTA"), "assinatura de posseira");
  assert.ok(textos[1].includes("99.888.777-66"), "RG no cabeçalho");
  assert.ok(textos[1].includes("POSSE"), "cabeçalho mantém Matrícula: POSSE");
  assert.ok(textos[1].includes("confrontando com a propriedade de MARIA NINA DA SILVA COSTA"), "confrontante no corpo");
  assert.ok(textos[1].includes("confrontando com a faixa de domínio da ESTRADA VICINAL"), "via no corpo");
  // 2: tabela com confrontações
  assert.ok(textos[2].includes("MARIA NINA DA SILVA COSTA"), "tabular com confrontante");
  // 3: uma carta por confrontante-pessoa; sem carta para as vias
  const nCartas = (textos[3].match(/CARTA DE ANUÊNCIA/g) ?? []).length;
  assert.equal(nCartas, 4, `cartas: ${nCartas}`);
  assert.equal((xmlCartas.match(/<w:pageBreakBefore\/>/g) ?? []).length, nCartas - 1, "cada carta em folha nova");
  assert.ok(textos[3].includes("MARIA NINA DA SILVA COSTA"), "carta da MARIA NINA");
  assert.ok(!textos[3].includes("ESTRADA VICINAL"), "via não ganha carta");
  // 7: uma declaração por via, cada uma com a tabela do próprio trecho
  const nDecl = (textos[7].match(/vem à presença de V\. Sa\./g) ?? []).length;
  assert.equal(nDecl, 2, `declarações: ${nDecl}`);
  assert.ok(textos[7].includes("faixa de domínio da ESTRADA VICINAL"), "declaração da estrada");
  assert.ok(textos[7].includes("faixa de domínio do CORREDOR"), "declaração do corredor");
  assert.ok(textos[7].includes("DSBN-M-3609"), "tabela da estrada");
  assert.ok(textos[7].includes("DSBN-M-3610"), "tabela do corredor");
  assert.ok(!textos[7].includes("DSBN-P-13130"), "sem pontos internos de fazenda na declaração");
});

test("sem estrada/corredor/rio → declaração de faixa não é gerada", async () => {
  const tpl = {};
  for (const [k, nome] of Object.entries(NOMES)) {
    const zip = await JSZip.loadAsync(readFileSync(new URL(`../reference/pecas-posse/${nome}.docx`, import.meta.url)));
    tpl[k] = await zip.file("word/document.xml").async("string");
  }
  const xmls = gerarPecasPosseXml(tpl, { ...dados, trechos: trechos.filter((t) => !t.ehVia) });
  assert.equal(xmls["7"], null);
});

test("empresa nova (posse, modelos neutros): nada do RT nem do código de credenciamento da D'Prol", async () => {
  const tpl = {};
  for (const [k, nome] of Object.entries(NOMES)) {
    const zip = await JSZip.loadAsync(readFileSync(new URL(`./fixtures/modelos-padrao/pecas-posse/${nome}.docx`, import.meta.url)));
    tpl[k] = await zip.file("word/document.xml").async("string");
  }
  const xmls = gerarPecasPosseXml(tpl, { ...dados, codigoCredenciado: "XYZW" });
  const proibidos = [/DANIEL NASCIMENTO/i, /0578839458/, /22\.106\.549-04/, /credenciado:\s*DSBN/i, /c[óo]digo\s+DSBN/i, /INCRA\s+DSBN/i, /Credenciamento\s*-\s*DSBN/i, /d.?prol/i];
  const achados = [];
  for (const [k, xml] of Object.entries(xmls)) {
    if (!xml) continue;
    const t = xml.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    for (const p of proibidos) if (p.test(t)) achados.push(`${k}: ${p}`);
  }
  assert.deepEqual(achados, []);
  const t3 = xmls["3"].replace(/<[^>]+>/g, "");
  assert.ok(t3.includes("XYZW"), "a carta cita o código do credenciado do serviço");
});

// Posse de casal (pedido de 2026-11-10): os dois são posseiros — o segundo sai
// no cabeçalho, nas frases (carta e declaração no plural) e assina cada peça
// logo abaixo do primeiro, nos modelos da D'Prol e nos neutros.
const casal = {
  ...dados,
  requerentes: [
    { nome: "ANTONIA DE TESTE COSTA", cpf: "111.222.333-44", genero: "F" },
    { nome: "JOAO MARIDO COSTA", cpf: "555.666.777-88", genero: "M" },
  ],
};
for (const [rotulo, pasta] of [["D'Prol", "../reference/pecas-posse"], ["neutros", "./fixtures/modelos-padrao/pecas-posse"]]) {
  test(`posse com dois posseiros (${rotulo}): cabeçalho, frases e duas assinaturas`, async () => {
    const tpl = {};
    const zips = {};
    for (const [k, nome] of Object.entries(NOMES)) {
      zips[k] = await JSZip.loadAsync(readFileSync(new URL(`${pasta}/${nome}.docx`, import.meta.url)));
      tpl[k] = await zips[k].file("word/document.xml").async("string");
    }
    const xmls = gerarPecasPosseXml(tpl, casal);
    const t = {};
    for (const [k, nome] of Object.entries(NOMES)) {
      t[k] = dec(xmls[k].replace(/<[^>]+>/g, ""));
      const semSelf = xmls[k].replace(/<[^<>]*\/>/g, "");
      assert.equal((semSelf.match(/<w:p[ >]/g) ?? []).length, (semSelf.match(/<\/w:p>/g) ?? []).length, `peça ${k}: <w:p> desbalanceado`);
      if (rotulo === "D'Prol") {
        zips[k].file("word/document.xml", xmls[k]);
        writeFileSync(new URL(`casal-${nome}.docx`, OUT), await zips[k].generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
      }
    }
    const nCartas = (t[3].match(/CARTA DE ANUÊNCIA/g) ?? []).length;
    const nDecl = (t[7].match(/vêm à presença de V\. Sa\./g) ?? []).length;
    const esperadas = { 1: 1, 2: 1, 3: nCartas, 7: nDecl };
    for (const k of ["1", "2", "3", "7"]) {
      assert.ok(!t[k].includes("ANTONIO DA SILVA COSTA"), `peça ${k} ainda tem ANTONIO`);
      assert.ok(!t[k].includes("005.097.695-86"), `peça ${k} ainda tem o CPF de exemplo`);
      assert.equal((t[k].match(/Posseira: ANTONIA DE TESTE COSTA/g) ?? []).length, esperadas[k], `peça ${k}: assinatura da 1ª`);
      assert.equal((t[k].match(/Posseiro: JOAO MARIDO COSTA/g) ?? []).length, esperadas[k], `peça ${k}: assinatura do 2º`);
      assert.ok(t[k].includes("CPF nº:555.666.777-88"), `peça ${k}: CPF do 2º na assinatura`);
    }
    assert.ok(nCartas >= 1 && nDecl >= 1);
    // cabeçalho dos memoriais: os dois nomes e CPFs
    for (const k of ["1", "2"]) {
      assert.ok(t[k].includes("ANTONIA DE TESTE COSTA/ JOAO MARIDO COSTA"), `peça ${k}: nomes no cabeçalho`);
      assert.ok(t[k].includes("111.222.333-44/ 555.666.777-88"), `peça ${k}: CPFs no cabeçalho`);
    }
    assert.ok(t[3].includes("Eu, Posseira ANTONIA DE TESTE COSTA, CPF nº:111.222.333-44, Eu, Posseiro JOAO MARIDO COSTA, CPF nº:555.666.777-88, possuidores do imóvel"), "carta no plural");
    assert.ok(t[7].includes("ANTONIA DE TESTE COSTA, brasileira, maior, capaz, inscrita no CPF nº: 111.222.333-44 e JOAO MARIDO COSTA, brasileiro, maior, capaz, inscrito no CPF nº: 555.666.777-88, residentes e domiciliados na"), "declaração com os dois");
    assert.ok(t[7].includes("legítimos posseiros do imóvel"), "declaração no plural");
  });
}

test("posse de um posseiro só: nada de segundo nem de plural", () => {
  const um = (s) => (s.match(/Posseir[oa]:/g) ?? []).length;
  assert.equal(um(textos[1]), 1);
  assert.ok(textos[7].includes("inscrita no CPF nº: 111.222.333-44, residente e domiciliada na"), "singular, no feminino");
  assert.ok(textos[7].includes("legítima posseira do imóvel"));
});
