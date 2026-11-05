// Monografia de marco: uma ficha por vértice M, em lote (um DOCX, uma página
// por marco), montada sobre o modelo da empresa. Dados do PDF real do SIGEF
// (FAZENDA VIBRAÇÃO) + sigmas/método do banco + campos digitados na tela.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import proj4 from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../supabase/functions/_shared/sigef_pdf.ts";
import { GEO_DEF, utmDef } from "../supabase/functions/_shared/geo.ts";
import { aplicarTimbreAutomatico } from "../supabase/functions/_shared/timbre_automatico.ts";
import {
  croquiPng, documentoMonografiaXml, ehCodigoDeMarco, escreverMonografia, fusoDaLongitude, gmsDoGrau, grauDaTabela,
  marcosDosAneis, montarMonografia, normalizarCamposMonografia, rotuloMetodo, secaoDoModelo,
} from "../supabase/functions/_shared/monografia.ts";

const OUT = new URL("./out/monografia/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const pdf = await getDocumentProxy(new Uint8Array(readFileSync(new URL("../reference/PREVIA-FAZENDA-VIBRACAO.pdf", import.meta.url))));
const sigef = parseSigefTexto((await extractText(pdf, { mergePages: true })).text);
const proj = (lon, lat, fuso) => proj4(GEO_DEF, utmDef(fuso), [lon, lat]);

const entrada = (extra = {}) => ({
  aneis: [sigef.linhas],
  vertices: [{ codigo: "DSBN-M-3605", tipo: "M", sigma_pos: "0.012", sigma_h: 0.021, metodo: "PG6" }],
  fuso: 24,
  campos: normalizarCamposMonografia({
    data_levantamento: "12/08/2026", equipamento: "Receptor GNSS RTK",
    marcos: { "DSBN-M-3605": { localizacao: "Junto à cerca, ao lado do mourão de aroeira.", acesso: "Pela BA 408, 3 km após a ponte, entrada à direita." } },
  }),
  imovel: { denominacao: "FAZENDA VIBRAÇÃO", detentor: "FULANO DE TAL", municipio: "Araci", uf: "BA", matricula: "4490", cns: "00.803-7", sncr: "" },
  rt: { nome: "BELTRANO RT", formacao: "Técnico em Agropecuária", conselhoSigla: "CFTA", conselhoNumero: "05788394589" },
  codigoCredenciado: "DSBN", trt: "BR20250804764", dataStr: "05/11/2026",
  proj,
  ...extra,
});

test("códigos de marco: só o tipo M", () => {
  assert.ok(ehCodigoDeMarco("DSBN-M-3605"));
  assert.ok(ehCodigoDeMarco("M-0001"));
  assert.ok(!ehCodigoDeMarco("DSBN-P-13160"));
  assert.ok(!ehCodigoDeMarco("DSBN-V-0758"));
  const ms = marcosDosAneis([sigef.linhas, sigef.linhas]);
  assert.ok(ms.length > 3 && ms.every(ehCodigoDeMarco));
  assert.equal(new Set(ms).size, ms.length, "marco repetido entre glebas sai uma vez");
  assert.equal(ms[0], "DSBN-M-3605");
});

test("coordenadas: GMS, altitude, UTM e meridiano central", () => {
  const m = montarMonografia(entrada());
  const f = m.fichas[0];
  assert.equal(f.codigo, "DSBN-M-3605");
  const l = sigef.linhas[0];
  // o GMS volta ao mesmo valor da tabela do PDF
  assert.ok(Math.abs(grauDaTabela(f.latitude) - grauDaTabela(l.lat)) < 1e-9, `${f.latitude} × ${l.lat}`);
  assert.ok(Math.abs(grauDaTabela(f.longitude) - grauDaTabela(l.lon)) < 1e-9);
  assert.match(f.latitude, /" S$/);
  assert.match(f.longitude, /" W$/);
  assert.equal(f.altitude, Number(l.alt).toFixed(3).replace(".", ","));
  const [e, n] = proj4(GEO_DEF, utmDef(24), [grauDaTabela(l.lon), grauDaTabela(l.lat)]);
  assert.equal(f.e.replace(/\./g, "").replace(",", "."), e.toFixed(3));
  assert.equal(f.n.replace(/\./g, "").replace(",", "."), n.toFixed(3));
  assert.equal(f.fuso, "24 S");
  assert.equal(f.mc, "-39° (W)");
  assert.equal(f.sigmaH, "0,012");
  assert.equal(f.sigmaV, "0,021");
  assert.equal(f.metodo, "PG6 — Relativo RTK convencional");
  assert.equal(f.dataLevantamento, "12/08/2026");
  assert.match(f.seguinte, /^DSBN-M-3605 → .+: azimute 129°10', distância 31,72 m$/);
  assert.match(f.anterior, /→ DSBN-M-3605: azimute/);
  assert.equal(f.localizacao, "Junto à cerca, ao lado do mourão de aroeira.");
  assert.equal(f.anel.length, sigef.linhas.length);
  assert.equal(f.indice, 0);
  assert.ok(f.outrosMarcos.length > 0 && !f.outrosMarcos.includes(0));
  // marco sem dado no banco: campos em branco (a ficha imprime linha para preencher)
  const outro = m.fichas[1];
  assert.equal(outro.sigmaH, "");
  assert.equal(outro.metodo, "");
  assert.equal(outro.localizacao, "");
});

test("escolha dos marcos e fuso pela longitude", () => {
  const todos = marcosDosAneis([sigef.linhas]);
  const m = montarMonografia(entrada({ escolhidos: [todos[2], todos[0], "XXXX-M-9999"], fuso: null }));
  assert.deepEqual(m.fichas.map((f) => f.codigo), [todos[0], todos[2]], "ordem do perímetro, só os escolhidos");
  assert.deepEqual(m.naoEncontrados, ["XXXX-M-9999"]);
  assert.equal(m.fichas[0].fuso, "24 S", "Araci-BA: fuso 24 pela longitude");
  assert.equal(fusoDaLongitude(-39.08), 24);
  assert.equal(fusoDaLongitude(-45.5), 23);
  assert.equal(montarMonografia(entrada({ escolhidos: [] })).fichas.length, todos.length, "vazio = todos");
});

test("campos digitados: normalização tolerante", () => {
  assert.deepEqual(normalizarCamposMonografia(null), {});
  assert.deepEqual(normalizarCamposMonografia([1, 2]), {});
  assert.deepEqual(normalizarCamposMonografia({ equipamento: "  ", marcos: { "M-1": { acesso: "" }, "": { acesso: "x" } } }), {});
  const n = normalizarCamposMonografia({ equipamento: "a".repeat(500), tipo_marco: " concreto ", marcos: { " M-1 ": { localizacao: "x\r\ny", lixo: 1 } } });
  assert.equal(n.equipamento.length, 200);
  assert.equal(n.tipo_marco, "concreto");
  assert.deepEqual(n.marcos, { "M-1": { localizacao: "x\ny" } });
  assert.equal(rotuloMetodo("pg1"), "PG1 — Relativo estático");
  assert.equal(rotuloMetodo("PT3"), "PT3");
  assert.equal(gmsDoGrau(-11.5, "lat"), `-11°30'00,000" S`);
});

test("croqui: PNG válido, marco em vermelho", async () => {
  const f = montarMonografia(entrada()).fichas[0];
  const png = await croquiPng(f.anel, f.indice, f.outrosMarcos, 300);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const dv = new DataView(png.buffer, png.byteOffset);
  assert.equal(dv.getUint32(16), 300);
  assert.equal(dv.getUint32(20), 300);
  // descompacta o IDAT e procura o vermelho do destaque
  const idatLen = dv.getUint32(33);
  assert.equal(String.fromCharCode(...png.subarray(37, 41)), "IDAT");
  const cru = inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(cru.length, (300 * 3 + 1) * 300);
  let vermelhos = 0;
  for (let y = 0; y < 300; y++) for (let x = 0; x < 300; x++) {
    const k = y * 901 + 1 + x * 3;
    if (cru[k] === 200 && cru[k + 1] === 30 && cru[k + 2] === 30) vermelhos++;
  }
  assert.ok(vermelhos > 50, `pixels vermelhos: ${vermelhos}`);
});

test("DOCX: uma página por marco, no modelo da empresa, com croqui e timbre", async () => {
  const m = montarMonografia(entrada());
  const modelo = readFileSync(new URL("./fixtures/modelos-padrao/pecas/1-memorial-descritivo.docx", import.meta.url));
  const zip = await JSZip.loadAsync(modelo);
  const secaoAntes = secaoDoModelo(await zip.file("word/document.xml").async("string"));
  assert.ok(secaoAntes, "o modelo tem seção no fim do corpo");
  await escreverMonografia(zip, m);
  await aplicarTimbreAutomatico(zip, null, { nome: "EMPRESA TESTE LTDA", cnpj: "12.345.678/0001-90", telefone: null, email: null });
  const buf = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(new URL("monografia.docx", OUT), buf);

  const z2 = await JSZip.loadAsync(buf);
  const doc = await z2.file("word/document.xml").async("string");
  const quebras = (doc.match(/<w:pageBreakBefore\/>/g) ?? []).length;
  assert.equal(quebras, m.fichas.length - 1, "uma página por marco");
  assert.equal((doc.match(/MONOGRAFIA DE MARCO/g) ?? []).length, m.fichas.length);
  for (const f of m.fichas) assert.ok(doc.includes(f.codigo));
  assert.ok(doc.includes("Junto à cerca"));
  assert.ok(doc.includes("Código do credenciado INCRA: DSBN"));
  assert.ok(doc.includes('xmlns:wp="') && doc.includes('xmlns:pic="') && doc.includes('xmlns:a="'));
  // a seção do modelo (margens) continua lá; o timbre ligou cabeçalho e rodapé
  assert.ok(doc.includes("<w:pgMar"));
  assert.match(doc, /<w:footerReference/);
  const rels = await z2.file("word/_rels/document.xml.rels").async("string");
  const ct = await z2.file("[Content_Types].xml").async("string");
  assert.match(ct, /Extension="png"/);
  for (let i = 0; i < m.fichas.length; i++) {
    const rid = `rIdMonoCroqui${i + 1}`;
    assert.ok(doc.includes(`r:embed="${rid}"`));
    const alvo = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
    assert.ok(alvo && z2.file(`word/${alvo}`), `croqui ${i + 1} no pacote`);
  }
  // XML bem formado o bastante: cada <w:tbl> fecha
  assert.equal((doc.match(/<w:tbl>/g) ?? []).length, (doc.match(/<\/w:tbl>/g) ?? []).length);
});

test("DOCX com logo no timbre (exemplo para conferir no LibreOffice)", async () => {
  const m = montarMonografia(entrada());
  const zip = await JSZip.loadAsync(readFileSync(new URL("./fixtures/modelos-padrao/pecas/1-memorial-descritivo.docx", import.meta.url)));
  await escreverMonografia(zip, m);
  // logo de mentira, mas PNG de verdade: o próprio croqui do primeiro marco
  const logo = { bytes: await croquiPng(m.fichas[0].anel, 0, [], 240), tipo: "png" };
  await aplicarTimbreAutomatico(zip, logo, { nome: "EMPRESA TESTE LTDA", cnpj: "12345678000190", telefone: "(75) 99999-0000", email: "contato@empresa.com.br" });
  const buf = await zip.generateAsync({ type: "uint8array" });
  writeFileSync(new URL("monografia-com-logo.docx", OUT), buf);
  const doc = await (await JSZip.loadAsync(buf)).file("word/document.xml").async("string");
  assert.equal((doc.match(/MONOGRAFIA DE MARCO/g) ?? []).length, m.fichas.length);
});

test("sem modelo: documento mínimo válido; sem marcos: aviso", () => {
  const xml = documentoMonografiaXml(montarMonografia(entrada({ aneis: [sigef.linhas.filter((l) => !ehCodigoDeMarco(l.codigo))] })));
  assert.match(xml, /Nenhum marco/);
  assert.match(xml, /<w:sectPr><w:pgSz/);
});
