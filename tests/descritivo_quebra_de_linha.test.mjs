// Regressão do serviço FAZENDA RIACHO DA CRUZ.
//
// O descritivo de um confrontante foi colado de um editor de texto e chegou ao
// banco com quebras de linha DE VERDADE (0x0A) no lugar da contrabarra que o
// sistema usa como separador:
//
//   "(MATR.37/CNS.13.662-2)\nFAZENDA LAMEIRO DA BÔA VISTA\nANTONIO…"
//
// Duas consequências, as duas silenciosas para quem gerou o serviço:
//   1. a PLANTA não saía — `widthOfTextAtSize` do pdf-lib estoura com
//      `WinAnsi cannot encode "\n" (0x000a)`, e `gerar-documentos` transforma
//      isso num aviso: memorial e planilha saíam, a planta não;
//   2. o memorial saía com nome, CPF e imóvel do confrontante grudados numa
//      pessoa só, porque `parseDescritivo` também só quebrava na contrabarra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { parseTxt, fmtBR, fmtGmsPlanilha, parseGmsPlanilha } from "../supabase/functions/_shared/geo.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { parseDescritivo } from "../supabase/functions/_shared/pecas.ts";
import { partesDescritivo, textoWinAnsi } from "../supabase/functions/_shared/texto.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);

// exatamente como está gravado em vertices.descritivo do serviço
const COLADO = "(MATR.37/CNS.13.662-2)\nFAZENDA LAMEIRO DA BÔA VISTA\nANTONIO LOPES DA SILVA SUBRINHO\nCPF:028.305.745-91";
const COM_BARRA = "(MATR.37/CNS.13.662-2)\\ FAZENDA LAMEIRO DA BÔA VISTA\\ ANTONIO LOPES DA SILVA SUBRINHO\\ CPF:028.305.745-91";

test("quebra de linha vale como contrabarra no descritivo", () => {
  assert.deepEqual(partesDescritivo(COLADO), partesDescritivo(COM_BARRA));
  assert.deepEqual(partesDescritivo(COLADO), [
    "(MATR.37/CNS.13.662-2)",
    "FAZENDA LAMEIRO DA BÔA VISTA",
    "ANTONIO LOPES DA SILVA SUBRINHO",
    "CPF:028.305.745-91",
  ]);
  // CRLF do Windows não pode virar duas partes, uma delas vazia
  assert.equal(partesDescritivo(COLADO.replace(/\n/g, "\r\n")).length, 4);
});

test("o confrontante colado é lido como uma pessoa com CPF, não como um blocão", () => {
  const p = parseDescritivo(COLADO);
  // a etiqueta veio sozinha na primeira linha; ela pertence ao imóvel, não é um
  // confrontante chamado "(MATR.37/CNS.13.662-2)"
  assert.equal(p.imovelLabel, "FAZENDA LAMEIRO DA BÔA VISTA (MATR.37/CNS.13.662-2)");
  assert.equal(p.pessoas.length, 1);
  assert.equal(p.pessoas[0].nome, "ANTONIO LOPES DA SILVA SUBRINHO");
  assert.equal(p.pessoas[0].cpf, "028.305.745-91");
  assert.deepEqual(p, parseDescritivo(COM_BARRA));
});

test("textoWinAnsi entrega texto que a fonte padrão do PDF aceita", async () => {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  // sem a limpeza, medir a largura já estoura — era daí que vinha a falha
  assert.throws(() => f.widthOfTextAtSize(COLADO, 8), /WinAnsi cannot encode/);
  for (const bruto of [COLADO, "AÇÃO — “ASPAS” … 100 m²", "NÃO\tQUEBRA AQUI", "Āā Ǧ ☺ 😀"]) {
    const limpo = textoWinAnsi(bruto);
    assert.doesNotThrow(() => f.widthOfTextAtSize(limpo, 8), `falhou em: ${JSON.stringify(bruto)}`);
    assert.doesNotThrow(() => f.encodeText(limpo));
  }
  // acentuação portuguesa é preservada; só o que a tabela não tem é que cai
  assert.equal(textoWinAnsi("FAZENDA LAMEIRO DA BÔA VISTA"), "FAZENDA LAMEIRO DA BÔA VISTA");
  assert.equal(textoWinAnsi("Āā"), "Aa");
});

test("parseGmsPlanilha aceita o GMS do PDF do SIGEF e o da planilha", () => {
  // formato da planilha (canônico, o que fmtGmsPlanilha grava)
  assert.deepEqual(parseGmsPlanilha("11 24 30,375 S"), { neg: true, d: 11, m: 24, sMil: 30375 });
  assert.deepEqual(parseGmsPlanilha("39 5 04,737 W"), { neg: true, d: 39, m: 5, sMil: 4737 });
  // formato do PDF do SIGEF — é o que a reconciliação gravou nos 50 vértices da
  // FAZENDA RIACHO DA CRUZ e o que quebrava a prévia da tela
  assert.deepEqual(parseGmsPlanilha("-10°55'12,815\""), { neg: true, d: 10, m: 55, sMil: 12815 });
  assert.deepEqual(parseGmsPlanilha("-39°20'14,944\""), { neg: true, d: 39, m: 20, sMil: 14944 });
  // formato do memorial, com sinal E hemisfério
  assert.deepEqual(parseGmsPlanilha("-11°23'44,344\" S"), { neg: true, d: 11, m: 23, sMil: 44344 });
  // norte/leste continuam positivos
  assert.equal(parseGmsPlanilha("11 24 30,375 N").neg, false);
  assert.equal(parseGmsPlanilha("10°55'12,815\"").neg, false);
  // lixo continua sendo erro, e sinal brigando com hemisfério é ambíguo
  assert.throws(() => parseGmsPlanilha("11 24 S"), /inválida/);
  assert.throws(() => parseGmsPlanilha(""), /inválida/);
  assert.throws(() => parseGmsPlanilha("-11 24 30,375 N"), /ambígua/);
});

test("a planta sai com o descritivo colado do editor de texto", async () => {
  const pontos = parseTxt(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8"));
  const MS = new Set([30, 41, 64]);
  const vertices = pontos.map((p, i) => ({
    ordem: i, numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
    tipo: MS.has(p.num) ? "M" : "P", metodo: "PG6", inserido: false,
    // o M 41 leva o descritivo colado; os outros, o formato de sempre
    descritivo: p.num === 41 ? COLADO : MS.has(p.num) ? "(POSSE) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA" : null,
    tipoLimite: MS.has(p.num) ? "LA1" : null,
    ehVia: false,
  }));
  const s = montarServico({
    fusoUtm: 24, prefixo: "DSBN", contadores: { M: 3605, P: 13130, V: 758 }, vertices,
  }, proj4);
  const posDe = new Map(s.ring.map((v, i) => [v.ordem, i]));
  const bytes = await gerarPlantaPdf({
    vertices: s.ring.map((v, i) => ({
      codigo: v.codigo, e: v.eProj, n: v.nProj,
      lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
      alt: String(v.h).replace(".", ","),
      azFmt: s.segs[i].azimuteFmt, distFmt: s.segs[i].distFmt,
      vante: s.ring[(i + 1) % s.ring.length].codigo,
    })),
    trechos: s.trechosOrdenados.map((t, k) => {
      const prox = s.trechosOrdenados[(k + 1) % s.trechosOrdenados.length];
      return {
        descritivo: t.descritivo, isEstrada: t.ehVia,
        inicioIdx: posDe.get(t.verticeInicioOrdem), fimIdx: posDe.get(prox.verticeInicioOrdem),
      };
    }),
    // a denominação também chega colada, com um travessão que o Word insere
    denominacao: "FAZENDA RIACHO DA CRUZ — PARTE 1",
    proprietarios: [{ nome: "RUBEM LOPES DA SILVA", cpf: "778.854.145-15" }],
    matricula: "407", cns: "13.662-2", sncr: "312.010.028.860-1", municipioUf: "ARACI-BA",
    areaFmt: fmtBR(s.areaHa, 4), tarefasFmt: fmtBR(s.areaHa * 10000 / 4356, 2),
    perimetroFmt: fmtBR(s.perimetroM, 2),
    mcAbs: 39, fuso: 24, latMediaDeg: -11.4, trt: "BR20260408910",
    rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
    desenhista: "JANETE OLIVEIRA", dataStr: "27/08/2026", logo: null,
  });
  assert.ok(bytes.length > 20000, `PDF pequeno demais: ${bytes.length}`);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
});
