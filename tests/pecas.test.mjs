// Teste das peças técnicas: PDF real do SIGEF + 7 modelos reais → 7 DOCX
// gerados em tests/out/pecas/, validados por leitura (unzip + texto).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../supabase/functions/_shared/sigef_pdf.ts";
import {
  gerarPecasXml, montarTrechosPecas, parseDescritivo, areaPorExtenso,
} from "../supabase/functions/_shared/pecas.ts";

const OUT = new URL("./out/pecas/", import.meta.url);
mkdirSync(OUT, { recursive: true });

// ---------- PDF ----------
const pdfBuf = new Uint8Array(readFileSync(new URL("../reference/PREVIA-FAZENDA-VIBRACAO.pdf", import.meta.url)));
const pdf = await getDocumentProxy(pdfBuf);
const { text } = await extractText(pdf, { mergePages: true });
const sigef = parseSigefTexto(text);

test("parser do PDF SIGEF: cabeçalho e 70 linhas", () => {
  assert.equal(sigef.cabecalho.denominacao, "FAZENDA VIBRAÇÃO - Parte 1");
  assert.equal(sigef.cabecalho.areaHa, "84,0638");
  assert.equal(sigef.cabecalho.perimetroM, "4.077,80");
  assert.equal(sigef.cabecalho.matricula, "4490");
  assert.equal(sigef.cabecalho.municipioUf, "Araci-BA");
  assert.equal(sigef.cabecalho.codigoCredenciamento, "DSBN");
  assert.ok(sigef.cabecalho.documentoRt.startsWith("BR20250804764"));
  assert.equal(sigef.linhas.length, 70, `linhas: ${sigef.linhas.length}`);
  assert.equal(sigef.linhas[0].codigo, "DSBN-M-3605");
  assert.equal(sigef.linhas[0].azimute, "129°10'");
  assert.equal(sigef.linhas[0].dist, "31,72");
  assert.equal(sigef.linhas[69].vante, "DSBN-M-3605"); // fechamento
});

// ---------- trechos (como viriam do banco) ----------
const DESCS = {
  "DSBN-M-3605": { descritivo: "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA\\ CARLOS MATOS DE LIMA\\ CPF:397.521.865-72\\ DIVALDO JOSE MATOS DE LIMA\\ CPF:180.246.295-34", tipoLimite: "LA1" },
  "DSBN-M-3607": { descritivo: "(POSSE) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53", tipoLimite: "LA1" },
  "DSBN-M-3606": { descritivo: "(MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53", tipoLimite: "LA1" },
  "DSBN-M-3608": { descritivo: "(POSSE) FAZENDA PAU D'ÁGUA\\ VALDETE DOS SANTOS\\ CPF:161.770.455-53", tipoLimite: "LA1" },
  "DSBN-M-3609": { descritivo: "BA 408", tipoLimite: "LA3" },
  "DSBN-M-3610": { descritivo: "CORREDOR", tipoLimite: "LA3" },
};
const { trechos, confrontacaoDe } = montarTrechosPecas(sigef.linhas, new Map(Object.entries(DESCS)));

test("montagem dos trechos a partir do PDF", () => {
  assert.equal(trechos.length, 6);
  assert.equal(trechos[0].linhas.length, 6);   // TERRA NOVA: 3605..3607
  assert.equal(trechos[0].pessoas.length, 2);
  assert.equal(trechos[0].imovelLabel, "FAZENDA TERRA NOVA (MATR.4.403/CNS.00.803-7)");
  assert.equal(trechos[1].pessoas[0].nome, "RUDSON PINTO FERREIRA");
  // BA 408: trecho do pt 64 ao pt 9 (dando a volta no anel) = 15 segmentos
  const via = trechos.find((t) => t.descritivo === "BA 408");
  assert.ok(via && via.pessoas.length === 0 && via.linhas.length === 15, `via: ${via?.linhas.length}`);
  assert.equal(confrontacaoDe("DSBN-P-13160"), "BA 408");
  assert.equal(confrontacaoDe("DSBN-V-0758"), "BA 408");
});

test("parseDescritivo e área por extenso", () => {
  const p = parseDescritivo(DESCS["DSBN-M-3608"].descritivo);
  assert.equal(p.posse, true);
  assert.equal(p.ehVia, false);
  assert.equal(p.imovelLabel, "FAZENDA PAU D'ÁGUA (POSSE)");
  assert.equal(areaPorExtenso("84,0638"), "oitenta e quatro hectares e seis ares e trinta e oito centiares");
  assert.equal(areaPorExtenso("86"), "oitenta e seis hectares");
});

test("parseDescritivo: confrontante sem rótulo de imóvel e faixa de domínio", () => {
  // caso ANTONIO: o descritivo é só "NOME\ CPF:..." (sem "(MATR...) FAZENDA")
  const pessoa = parseDescritivo("MARIA NINA DA SILVA COSTA\\ CPF:666.186.815-53");
  assert.equal(pessoa.ehVia, false);
  assert.equal(pessoa.pessoas.length, 1);
  assert.equal(pessoa.pessoas[0].nome, "MARIA NINA DA SILVA COSTA");
  assert.equal(pessoa.pessoas[0].cpf, "666.186.815-53");
  // vias: reconhecidas por palavra-chave (estrada, corredor, rio, BR/BA nnn…)
  for (const via of ["ESTRADA VICINAL", "BA 408", "CORREDOR", "RIO ITAPICURU"]) {
    const v = parseDescritivo(via);
    assert.equal(v.ehVia, true, `${via} deveria ser via`);
    assert.equal(v.pessoas.length, 0);
  }
  // nome de pessoa sem CPF não vira via
  const semCpf = parseDescritivo("VALDETE DOS SANTOS");
  assert.equal(semCpf.ehVia, false);
  assert.equal(semCpf.pessoas.length, 1);
});

// ---------- geração das 7 peças ----------
const NOMES = ["1-memorial-descritivo", "2-memorial-tabular", "3-cartas-anuencia", "4-declaracao-tecnico", "5-declaracao-proprietario", "6-requerimento", "7-declaracao-faixa-dominio"];
const dados = {
  requerentes: [
    { nome: "MARIA DE TESTE SILVA", cpf: "111.222.333-44", genero: "F" },
    { nome: "JOSE DE TESTE SILVA", cpf: "555.666.777-88", genero: "M" },
  ],
  rg: null,
  endereco: "Rua das Palmeiras, Nº 100, Centro, Serrinha, Bahia, CEP:48.700-000",
  municipio: "Araci", uf: "BA",
  denominacao: "FAZENDA TESTE", matricula: "9.999", cns: "01.234-5",
  sncrFmt: "999.999.999.999-9", sncrNum: "9999999999999",
  areaHa: sigef.cabecalho.areaHa, perimetro: sigef.cabecalho.perimetroM,
  areaMatriculaHa: "86", mcAbs: 39,
  trt: "BR20250804764", dataStr: "22/07/2026",
  rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agrimensura", conselhoSigla: "CREA", conselhoNumero: "12345-D", identidade: "11.111.111-11 SSP/BA", cpf: "999.888.777-66" },
  viaDominio: "BA 408",
  sigef, trechos, confrontacaoDe,
};
const dec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");

const zips = {};
const textos = {};
test("geração das 7 peças (arquivos reais gravados e relidos)", async () => {
  const tpl = {};
  for (let i = 1; i <= 7; i++) {
    const zip = await JSZip.loadAsync(readFileSync(new URL(`../reference/pecas/${NOMES[i - 1]}.docx`, import.meta.url)));
    tpl[String(i)] = { zip, xml: await zip.file("word/document.xml").async("string") };
  }
  const xmls = gerarPecasXml(Object.fromEntries(Object.entries(tpl).map(([k, v]) => [k, v.xml])), dados);
  for (let i = 1; i <= 7; i++) {
    const { zip } = tpl[String(i)];
    zip.file("word/document.xml", xmls[String(i)]);
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    writeFileSync(new URL(`${NOMES[i - 1]}.docx`, OUT), buf);
    // releitura real
    const re = await JSZip.loadAsync(buf);
    const xml = await re.file("word/document.xml").async("string");
    assert.ok(xml.length > 1000, `peça ${i} vazia`);
    zips[i] = re;
    textos[i] = dec(xml.replace(/<[^>]+>/g, ""));
    // XML balanceado (ignorando tags auto-fechadas, ex.: <w:p/>)
    const semSelf = xml.replace(/<[^<>]*\/>/g, "");
    for (const tag of ["w:p", "w:tbl", "w:tr", "w:tc"]) {
      const abre = (semSelf.match(new RegExp(`<${tag}[ >]`, "g")) ?? []).length;
      const fecha = (semSelf.match(new RegExp(`</${tag}>`, "g")) ?? []).length;
      assert.equal(abre, fecha, `peça ${i}: <${tag}> desbalanceado (${abre}/${fecha})`);
    }
  }
});

test("peças: substituições aplicadas e dados de exemplo removidos", () => {
  for (const i of [1, 2, 3, 4, 5, 6, 7]) {
    const t = textos[i];
    assert.ok(!t.includes("LARISSA LIMA"), `peça ${i} ainda tem LARISSA`);
    assert.ok(!t.includes("GILBERTO GONCALVES"), `peça ${i} ainda tem GILBERTO`);
    assert.ok(!t.includes("FAZENDA VIBRAÇÃO"), `peça ${i} ainda tem FAZENDA VIBRAÇÃO`);
    assert.ok(!t.includes("DANIEL NASCIMENTO"), `peça ${i} ainda tem RT de exemplo`);
    assert.ok(t.includes("MARIA DE TESTE SILVA"), `peça ${i} sem requerente 1`);
  }
  // 1: corpo com azimute SGL do PDF e perímetro SIGEF
  assert.ok(textos[1].includes("129°10' por uma distância de 31,72m"), "corpo com azimute do SIGEF");
  assert.ok(textos[1].includes("4.077,80"), "perímetro do SIGEF");
  assert.ok(textos[1].includes("84,0638 HA/ 192,98 TAREFAS"), "área + tarefas");
  // 2: tabela completa com descritivo cheio do banco
  assert.ok(textos[2].includes("DSBN-V-0758"), "tabular sem o V");
  assert.ok(textos[2].includes("CPF:397.521.865-72"), "tabular sem descritivo completo");
  // 3: uma carta por confrontante-pessoa (4 trechos com pessoas)
  const nCartas = (textos[3].match(/CARTA DE ANUÊNCIA/g) ?? []).length;
  assert.equal(nCartas, 4, `cartas: ${nCartas}`);
  assert.ok(textos[3].includes("VALDETE DOS SANTOS"), "carta da PAU D'ÁGUA");
  assert.ok(textos[3].includes("FAZENDA PAU D'ÁGUA (POSSE)"), "imóvel da carta");
  // 4/5: tabela de confrontantes reconstruída
  assert.ok(textos[4].includes("RUDSON PINTO FERREIRA") && textos[5].includes("RUDSON PINTO FERREIRA"));
  // 6: áreas por extenso
  assert.ok(textos[6].includes("86 ha (oitenta e seis hectares)"), "área da matrícula");
  assert.ok(textos[6].includes("oitenta e quatro hectares e seis ares e trinta e oito centiares"), "área nova por extenso");
  // 1: vias citadas como faixa de domínio no corpo do memorial
  assert.ok(textos[1].includes("confrontando com a faixa de domínio do BA 408"), "memorial cita a faixa BA 408");
  assert.ok(textos[1].includes("confrontando com a faixa de domínio do CORREDOR"), "memorial cita o corredor");
  // 7: uma declaração POR VIA (BA 408 e CORREDOR), cada uma com sua tabela
  assert.ok(textos[7].includes("faixa de domínio do BA 408"), "via de domínio");
  assert.ok(textos[7].includes("faixa de domínio do CORREDOR"), "declaração do corredor");
  const nDecl = (textos[7].match(/vem à presença de V\. Sa\./g) ?? []).length;
  assert.equal(nDecl, 2, `declarações: ${nDecl}`);
  assert.ok(textos[7].includes("DSBN-M-3609"), "tabela da faixa BA 408");
  assert.ok(textos[7].includes("DSBN-V-0758"), "V dentro da faixa");
  assert.ok(textos[7].includes("DSBN-M-3610"), "tabela do corredor");
  // vértice interno do trecho TERRA NOVA não pode aparecer na faixa
  // (o M-3605 aparece só como vante do fechamento do anel, o que é correto)
  assert.ok(!textos[7].includes("DSBN-P-13130"), "faixa não deve ter trecho de fazenda");
});

// ---------- 1 requerente: frases no singular e sem assinaturas do 2º ----------
test("peças com um único requerente", async () => {
  const tpl = {};
  for (let i = 1; i <= 7; i++) {
    const zip = await JSZip.loadAsync(readFileSync(new URL(`../reference/pecas/${NOMES[i - 1]}.docx`, import.meta.url)));
    tpl[String(i)] = await zip.file("word/document.xml").async("string");
  }
  const xmls = gerarPecasXml(tpl, { ...dados, requerentes: [dados.requerentes[0]], rg: "11.222.333-4" });
  for (const i of [1, 2, 3, 4, 5, 6, 7]) {
    const t = dec((xmls[String(i)] ?? "").replace(/<[^>]+>/g, ""));
    assert.ok(!t.includes("GILBERTO GONCALVES"), `peça ${i} ainda tem o 2º proprietário de exemplo`);
    assert.ok(!t.includes("JOSE DE TESTE"), `peça ${i} não deveria ter 2º requerente`);
  }
  const t7 = dec(xmls["7"].replace(/<[^>]+>/g, ""));
  assert.ok(t7.includes("residente e domiciliada"), "qualificação no singular");
  assert.ok(!t7.includes("residentes e domiciliados"), "não deve sobrar plural");
  assert.ok(t7.includes("legítima proprietária"), "proprietária no singular");
  const t3 = dec(xmls["3"].replace(/<[^>]+>/g, ""));
  assert.ok(t3.includes("proprietária do imóvel rural denominado FAZENDA TESTE"), "carta no singular");
  const t1 = dec(xmls["1"].replace(/<[^>]+>/g, ""));
  assert.ok(t1.includes("– RG: 11.222.333-4"), "RG opcional no cabeçalho");
});
