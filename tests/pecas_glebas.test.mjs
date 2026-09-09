// Peças técnicas de um serviço de GLEBAS, a partir da prévia do SIGEF com vários
// memoriais (PREVIA TOTAL.pdf) e dos 7 modelos reais.
//
// O que se prova aqui: o Memorial Descritivo do IMÓVEL descreve uma gleba por
// bloco — cada uma abrindo no seu vértice inicial e fechando no perímetro DELA —
// em vez de percorrer os três anéis emendados como se fossem um só, inventando
// um lado entre a última divisa de uma gleba e o primeiro vértice da outra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import JSZip from "jszip";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefBlocos } from "../supabase/functions/_shared/sigef_pdf.ts";
import { areaTotalHa } from "../supabase/functions/_shared/sigef_glebas.ts";
import { gerarPecasXml, montarTrechosPecas } from "../supabase/functions/_shared/pecas.ts";
import { fmtBR } from "../supabase/functions/_shared/geo.ts";

const OUT = new URL("./out/pecas-glebas/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const NOMES = ["1-memorial-descritivo", "2-memorial-tabular", "3-cartas-anuencia", "4-declaracao-tecnico", "5-declaracao-proprietario", "6-requerimento", "7-declaracao-faixa-dominio"];

const { text } = await extractText(
  await getDocumentProxy(new Uint8Array(readFileSync(new URL("../PREVIA TOTAL.pdf", import.meta.url)))),
  { mergePages: true },
);
const blocos = parseSigefBlocos(text);

// confrontação vinda do banco: aqui basta a do próprio PDF (é o fallback real
// quando o serviço não tem trechos cadastrados)
const iniciosDe = (linhas) => {
  const m = new Map();
  let ultima = "";
  for (const l of linhas) {
    if (l.confrontacao !== ultima) {
      ultima = l.confrontacao;
      m.set(l.codigo, { descritivo: l.confrontacao.replace(/\.{3}$/, ""), tipoLimite: "LA1", ehVia: false });
    }
  }
  return m;
};
const inicios = iniciosDe(blocos.flatMap((b) => b.linhas));

const unidades = blocos.map((b, i) => {
  const t = montarTrechosPecas(b.linhas, inicios);
  return {
    nome: `GLEBA ${i + 1}`, sigef: b, trechos: t.trechos,
    perimetro: b.cabecalho.perimetroM, confrontacaoDe: t.confrontacaoDe,
  };
});

const sigefImovel = {
  cabecalho: { ...blocos[0].cabecalho, areaHa: fmtBR(areaTotalHa(blocos), 4) },
  linhas: blocos.flatMap((b) => b.linhas),
};
const doImovel = montarTrechosPecas(sigefImovel.linhas, inicios);

const base = {
  requerentes: [{ nome: "ANTONIO LOPES DA SILVA SOBRINHO", cpf: "028.305.745-91", genero: "M" }],
  rg: null, endereco: "CANSANÇÃO-BA", municipio: "Cansanção", uf: "BA",
  denominacao: "FAZENDA LAMEIRO DA BOA VISTA", matricula: "37", cns: "13.662-2",
  sncrFmt: "3181831082351", sncrNum: "3181831082351",
  areaHa: sigefImovel.cabecalho.areaHa, perimetro: blocos[0].cabecalho.perimetroM,
  areaMatriculaHa: null, mcAbs: 39, trt: "BR20250303979", dataStr: "09/09/2026",
  rt: { nome: "DANIEL NASCIMENTO SANTOS", formacao: "Técnico(a) em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "05788394589", identidade: "", cpf: "" },
  sigef: sigefImovel, trechos: doImovel.trechos, confrontacaoDe: doImovel.confrontacaoDe,
};

const tpl = {};
for (let i = 1; i <= 7; i++) {
  const zip = await JSZip.loadAsync(readFileSync(new URL(`../reference/pecas/${NOMES[i - 1]}.docx`, import.meta.url)));
  tpl[String(i)] = await zip.file("word/document.xml").async("string");
}
const textoDe = (xml) => xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("Memorial Descritivo do imóvel: um bloco por gleba, cada um no seu perímetro", () => {
  const xmls = gerarPecasXml(tpl, { ...base, unidades });
  const t = textoDe(xmls["1"]);

  // uma abertura por gleba, no vértice inicial de cada memorial
  for (const b of blocos) {
    assert.ok(
      t.includes(`Inicia-se a descrição deste perímetro no vértice ${b.linhas[0].codigo}`),
      `falta a abertura da gleba que começa em ${b.linhas[0].codigo}`,
    );
    // e cada bloco fecha no perímetro DAQUELA gleba, não num total somado
    assert.ok(
      t.includes(`deste perímetro de ${b.cabecalho.perimetroM} m.`),
      `falta o fechamento no perímetro ${b.cabecalho.perimetroM}`,
    );
  }
  assert.ok(t.includes("GLEBA 1") && t.includes("GLEBA 2") && t.includes("GLEBA 3"));
  // a soma dos perímetros NÃO aparece em lugar nenhum
  assert.ok(!t.includes("27.961,08"));
  writeFileSync(new URL("memorial-imovel.xml", OUT), xmls["1"]);
});

test("o Memorial Tabular do imóvel lista os vértices das três glebas", () => {
  const xmls = gerarPecasXml(tpl, { ...base, unidades });
  const t = textoDe(xmls["2"]);
  assert.equal(sigefImovel.linhas.length, 176);
  // um vértice de cada gleba, para provar que a tabela não parou na primeira
  for (const b of blocos) assert.ok(t.includes(b.linhas[0].codigo), `falta ${b.linhas[0].codigo}`);
});

test("o jogo de cada gleba descreve UM anel só", () => {
  for (const [i, u] of unidades.entries()) {
    const xmls = gerarPecasXml(tpl, {
      ...base,
      denominacao: `FAZENDA LAMEIRO DA BOA VISTA - ${u.nome}`,
      areaHa: u.sigef.cabecalho.areaHa, perimetro: u.perimetro,
      sigef: u.sigef, trechos: u.trechos, confrontacaoDe: u.confrontacaoDe,
      unidades: undefined,
    });
    const t = textoDe(xmls["1"]);
    const aberturas = t.match(/Inicia-se a descrição deste perímetro/g) ?? [];
    assert.equal(aberturas.length, 1, `${u.nome} deveria abrir uma vez só`);
    assert.ok(t.includes(`no vértice ${u.sigef.linhas[0].codigo}`));
    assert.ok(t.includes(`deste perímetro de ${u.perimetro} m.`));
    // nenhuma menção ao vértice inicial das irmãs
    for (const [j, outra] of unidades.entries()) {
      if (j === i) continue;
      assert.ok(!t.includes(`Inicia-se a descrição deste perímetro no vértice ${outra.sigef.linhas[0].codigo}`));
    }
  }
});

test("sem unidades, o memorial sai exatamente como sempre saiu", () => {
  // imóvel de anel único: um memorial, uma abertura, o perímetro do cabeçalho
  const um = montarTrechosPecas(blocos[0].linhas, inicios);
  const xmls = gerarPecasXml(tpl, {
    ...base, areaHa: blocos[0].cabecalho.areaHa, perimetro: blocos[0].cabecalho.perimetroM,
    sigef: blocos[0], trechos: um.trechos, confrontacaoDe: um.confrontacaoDe,
  });
  const t = textoDe(xmls["1"]);
  assert.equal((t.match(/Inicia-se a descrição deste perímetro/g) ?? []).length, 1);
  assert.ok(t.includes("deste perímetro de 11.753,39 m."));
});
