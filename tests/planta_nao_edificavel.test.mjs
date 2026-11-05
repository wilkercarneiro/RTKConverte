// Faixa NÃO EDIFICÁVEL na planta (DadosPlanta.naoEdificavel; regras em
// supabase/functions/_shared/recuo.ts). O serviço do Anexo A (LARISSA) confronta
// com a BA 408 (rodovia estadual: ganha a linha) e com um CORREDOR (estrada
// municipal: não ganha). Lacra-se: sem a opção a planta não muda; com ela, a
// tracejada sai só na rodovia, nenhum rótulo cai sobre ela e a legenda diz a
// largura e a lei; a redução por lei municipal (porVia) muda a largura.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import proj4lib from "proj4";
import { PDFDocument } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import { parseTxt, fmtBR, fmtGmsPlanilha } from "../supabase/functions/_shared/geo.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";

const proj4 = (from, to, c) => proj4lib(from, to, c);
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });

const pontos = parseTxt(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8"));
const DESCS = {
  30: "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA\\ CARLOS MATOS DE LIMA\\ CPF:397.521.865-72",
  36: "(POSSE) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  41: "(MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  58: "(POSSE) FAZENDA PAU D'ÁGUA\\ VALDETE DOS SANTOS\\ CPF:161.770.455-53",
  64: "BA 408",
  9: "CORREDOR",
};
const MS = new Set([30, 36, 41, 58, 64, 9]);
const VIAS = new Set([64, 9]);
const vertices = pontos.map((p, i) => ({
  ordem: i, numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
  tipo: MS.has(p.num) ? "M" : "P", metodo: "PG6", inserido: false,
  descritivo: MS.has(p.num) ? DESCS[p.num] : null,
  tipoLimite: MS.has(p.num) ? (VIAS.has(p.num) ? "LA3" : "LA1") : null,
  ehVia: VIAS.has(p.num),
}));
const ordemDe = (n) => vertices.findIndex((v) => v.numTxt === n);
const servico = montarServico({ fusoUtm: 24, verticeInicialOrdem: ordemDe(30), prefixo: "DSBN", contadores: { M: 3605, P: 13130, V: 758 }, vertices }, proj4);
const ring = servico.ring;
const posDe = new Map(ring.map((v, i) => [v.ordem, i]));
const trechos = servico.trechosOrdenados.map((t, k) => {
  const prox = servico.trechosOrdenados[(k + 1) % servico.trechosOrdenados.length];
  return { descritivo: t.descritivo, isEstrada: t.ehVia, inicioIdx: posDe.get(t.verticeInicioOrdem), fimIdx: posDe.get(prox.verticeInicioOrdem) };
});
const base = {
  vertices: ring.map((v, i) => ({
    codigo: v.codigo, e: v.eProj, n: v.nProj,
    lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
    alt: String(v.h).replace(".", ","), azFmt: servico.segs[i].azimuteFmt, distFmt: servico.segs[i].distFmt,
    vante: ring[(i + 1) % ring.length].codigo,
  })),
  trechos, denominacao: "FAZENDA TESTE",
  proprietarios: [{ nome: "MARIA DE TESTE SILVA", cpf: "111.222.333-44" }],
  matricula: "4.490", cns: "00.803-7", sncr: "312.010.028.860-1", municipioUf: "ARACI-BA",
  areaFmt: fmtBR(servico.areaHa, 4), tarefasFmt: fmtBR(servico.areaHa * 10000 / 4356, 2), perimetroFmt: fmtBR(servico.perimetroM, 2),
  mcAbs: 39, fuso: 24, latMediaDeg: -11.4, trt: "BR20260408910",
  rt: { nome: "TECNICO DE TESTE", formacao: "Técnico em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
  desenhista: "JANETE OLIVEIRA", dataStr: "05/11/2026", logo: null,
};

/** Os traços [7 4] da faixa no conteúdo da página. */
async function tracosNe(bytes) {
  const pg = (await PDFDocument.load(bytes)).getPage(0);
  let n = 0;
  for (const ref of pg.node.normalizedEntries().Contents.asArray()) {
    const bruto = Buffer.from(pg.doc.context.lookup(ref).getContents());
    let txt;
    try { txt = inflateSync(bruto).toString("latin1"); } catch { txt = bruto.toString("latin1"); }
    n += (txt.match(/\[7 4\] 0 d/g) ?? []).length;
  }
  return n;
}
async function textoDa(bytes) {
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
  return text;
}

test("sem a opção, a planta não ganha a faixa (nada muda para quem não pede)", async () => {
  const bytes = await gerarPlantaPdf({ ...base }, { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 });
  assert.equal(await tracosNe(bytes), 0);
  assert.doesNotMatch(await textoDa(bytes), /NÃO EDIFICÁVEL/);
});

test("com a opção: tracejada só na rodovia BA 408, sem rótulo por cima, e a legenda com 15 m e a lei", async () => {
  const diag = { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 };
  const bytes = await gerarPlantaPdf({ ...base, naoEdificavel: { padrao: 15 } }, diag);
  writeFileSync(new URL("./out/planta-nao-edificavel.pdf", import.meta.url), bytes);
  // a linha (1 ou mais segmentos) + a amostra da legenda
  const n = await tracosNe(bytes);
  assert.ok(n >= 2, `traços da faixa: ${n}`);
  assert.equal(diag.sobrepostos, 0, `${diag.sobrepostos} rótulo(s) sobre as linhas`);
  const t = await textoDa(bytes);
  assert.match(t, /FAIXA NÃO EDIFICÁVEL 15 m \(LEI 6\.766\/79\)/);
});

test("redução por lei municipal (porVia) muda a largura da legenda; via municipal não ganha linha", async () => {
  const bytes = await gerarPlantaPdf({ ...base, naoEdificavel: { padrao: 15, porVia: { "BA-408": 8 } } }, { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 });
  assert.match(await textoDa(bytes), /FAIXA NÃO EDIFICÁVEL 8 m/);
  // só o CORREDOR como estrada (municipal): nenhuma faixa
  const soCorredor = { ...base, trechos: trechos.map((t) => (t.descritivo === "BA 408" ? { ...t, isEstrada: false } : t)) };
  const b2 = await gerarPlantaPdf({ ...soCorredor, naoEdificavel: { padrao: 15 } }, { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 });
  assert.equal(await tracosNe(b2), 0);
});
