// Teste da planta A1: monta o serviço do Anexo A e gera o PDF real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import proj4lib from "proj4";
import { PDFDocument } from "pdf-lib";
import { parseTxt, fmtBR, fmtGmsPlanilha } from "../supabase/functions/_shared/geo.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });

// serviço do Anexo A (igual ao gerador.test)
const pontos = parseTxt(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8"));
const DESCS = {
  30: "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA\\ CARLOS MATOS DE LIMA\\ CPF:397.521.865-72\\ DIVALDO JOSE MATOS DE LIMA\\ CPF:180.246.295-34",
  36: "(POSSE) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  41: "(MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  58: "(POSSE) FAZENDA PAU D'ÁGUA\\ VALDETE DOS SANTOS\\ CPF:161.770.455-53",
  64: "BA 408",
  9: "CORREDOR",
};
const MS = new Set([30, 36, 41, 58, 64, 9]);
const vertices = pontos.map((p, i) => ({
  ordem: i, numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
  tipo: MS.has(p.num) ? "M" : "P", metodo: "PG6", inserido: false,
}));
const ordemDe = (n) => vertices.findIndex((v) => v.numTxt === n);
const servico = montarServico({
  fusoUtm: 24, verticeInicialOrdem: ordemDe(30), prefixo: "DSBN",
  contadores: { M: 3605, P: 13130, V: 758 }, vertices,
  trechos: [30, 36, 41, 58, 64, 9].map((n) => ({
    verticeInicioOrdem: ordemDe(n), descritivo: DESCS[n], tipoLimite: [64, 9].includes(n) ? "LA3" : "LA1",
  })),
}, proj4);

test("planta A1: PDF gerado com dimensões e conteúdo", async () => {
  const ring = servico.ring;
  const posDe = new Map(ring.map((v, i) => [v.ordem, i]));
  const trechosPlanta = servico.trechosOrdenados.map((t, k) => {
    const prox = servico.trechosOrdenados[(k + 1) % servico.trechosOrdenados.length];
    return {
      descritivo: t.descritivo,
      isEstrada: t.tipoLimite.startsWith("LA3") || !t.descritivo.includes("\\"),
      inicioIdx: posDe.get(t.verticeInicioOrdem),
      fimIdx: posDe.get(prox.verticeInicioOrdem),
    };
  });
  const dados = {
    vertices: ring.map((v, i) => ({
      codigo: v.codigo, e: v.eProj, n: v.nProj,
      lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
      alt: String(v.h).replace(".", ","),
      azFmt: servico.segs[i].azimuteFmt, distFmt: servico.segs[i].distFmt,
      vante: ring[(i + 1) % ring.length].codigo,
    })),
    trechos: trechosPlanta,
    denominacao: "FAZENDA TESTE",
    proprietarios: [
      { nome: "MARIA DE TESTE SILVA", cpf: "111.222.333-44" },
      { nome: "JOSE DE TESTE SILVA", cpf: "555.666.777-88" },
    ],
    matricula: "4.490", cns: "00.803-7", sncr: "312.010.028.860-1",
    municipioUf: "ARACI-BA",
    areaFmt: fmtBR(servico.areaHa, 4), tarefasFmt: fmtBR(servico.areaHa * 10000 / 4356, 2),
    perimetroFmt: fmtBR(servico.perimetroM, 2),
    mcAbs: 39, fuso: 24, latMediaDeg: -11.4,
    trt: "BR20260408910",
    rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
    desenhista: "JANETE OLIVEIRA", dataStr: "22/07/2026",
    logo: null,
  };
  const bytes = await gerarPlantaPdf(dados);
  writeFileSync(new URL("./out/planta-teste.pdf", import.meta.url), bytes);
  assert.ok(bytes.length > 20000, `PDF pequeno demais: ${bytes.length}`);

  // leitura real
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 1);
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 841 * 2.834645669) < 1, `largura ${width}`);
  assert.ok(Math.abs(height - 594 * 2.834645669) < 1, `altura ${height}`);
  console.log(`    planta-teste.pdf: ${(bytes.length / 1024).toFixed(0)} KB, A1 paisagem OK`);
});
