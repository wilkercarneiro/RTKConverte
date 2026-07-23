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
