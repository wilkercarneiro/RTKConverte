// Simula a PLANTA de um serviço de GLEBAS a partir da prévia do SIGEF com
// vários memoriais (PREVIA TOTAL.pdf), sem passar pelo Supabase: parser →
// casamento por geometria → partes/glebas → PDF. É o caminho que a Edge
// Function gerar-planta percorre no fluxo de glebas.
//
//   node --import tsx scripts/simular_planta_glebas_sigef.mjs [caminho.pdf]
import { readFileSync, writeFileSync } from "fs";
import proj4lib from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefBlocos } from "../supabase/functions/_shared/sigef_pdf.ts";
import { areaTotalHa, anelDoBloco, avisosDoCasamento, casarBlocosComGlebas, gmsPdfParaDeg } from "../supabase/functions/_shared/sigef_glebas.ts";
import { fmtBR } from "../supabase/functions/_shared/geo.ts";
import { identificacaoDaGleba } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const arquivo = process.argv[2] ?? "./PREVIA TOTAL.pdf";

const { text } = await extractText(await getDocumentProxy(new Uint8Array(readFileSync(arquivo))), { mergePages: true });
const blocos = parseSigefBlocos(text);
console.log(`=== ${blocos.length} memorial(is) no PDF ===`);
for (const b of blocos) {
  console.log(`  ${b.cabecalho.denominacao} · ${b.cabecalho.areaHa} ha · ${b.cabecalho.perimetroM} m · ${b.linhas.length} vértices`);
}

const denominacao = blocos[0].cabecalho.denominacao.replace(/\s*-\s*GLEBA.*$/i, "");
const fuso = Math.floor((gmsPdfParaDeg(blocos[0].linhas[0].lon) + 180) / 6) + 1;
const latMedia = gmsPdfParaDeg(blocos[0].linhas[0].lat);

// Glebas "do sistema": os próprios anéis do PDF, embaralhados e renomeados, para
// provar que o casamento é pela GEOMETRIA e não pelo nome nem pela ordem.
const glebaRows = blocos
  .map((b, i) => ({ nome: `GLEBA ${blocos.length - i} (renomeada)`, ordem: i, anel: anelDoBloco(b.linhas, fuso, proj4) }))
  .reverse();

const casados = casarBlocosComGlebas(blocos, glebaRows, denominacao, fuso, proj4);
console.log("\n=== CASAMENTO POR GEOMETRIA ===");
for (const c of casados) {
  console.log(`  bloco ${c.indiceBloco} (${c.bloco.cabecalho.denominacao}) → ${c.nome} · gleba ${c.numeroGleba} · cobertura ${(c.cobertura * 100).toFixed(0)}%`);
}
const avisos = avisosDoCasamento(casados, glebaRows);
console.log(avisos.length ? `\nAVISOS:\n  ${avisos.join("\n  ")}` : "\nSem avisos.");

const servico = {
  tipo_imovel: "matricula", matricula: blocos[0].cabecalho.matricula, cns: blocos[0].cabecalho.cns,
  denominacao, detentor_nome: blocos[0].cabecalho.proprietario, detentor_cpf: blocos[0].cabecalho.cpf,
};

const vertices = [], trechos = [], partes = [], glebas = [];
for (const c of casados) {
  const anel = anelDoBloco(c.bloco.linhas, fuso, proj4);
  const vg = c.bloco.linhas.map((l, i) => ({
    codigo: l.codigo, e: anel[i][0], n: anel[i][1],
    lonFmt: l.lon, latFmt: l.lat, alt: l.alt, azFmt: l.azimute, distFmt: l.dist, vante: l.vante,
  }));
  // trechos pela mudança de confrontação (é o que o PDF sozinho permite)
  const starts = [];
  let ultima = "";
  c.bloco.linhas.forEach((l, i) => {
    if (l.confrontacao !== ultima) { ultima = l.confrontacao; starts.push(i); }
  });
  const tg = starts.map((idx, k) => ({
    descritivo: c.bloco.linhas[idx].confrontacao.replace(/\.{3}$/, ""),
    isEstrada: false, isRio: false, numerado: false, semRotulo: false,
    inicioIdx: idx, fimIdx: starts[(k + 1) % starts.length],
  }));
  const off = vertices.length;
  vertices.push(...vg);
  trechos.push(...tg.map((t) => ({ ...t, inicioIdx: t.inicioIdx + off, fimIdx: t.fimIdx + off })));
  partes.push({ nome: c.nome, vertices: vg, trechos: tg });
  const ha = parseFloat(c.bloco.cabecalho.areaHa.replace(/\./g, "").replace(",", ".")) || 0;
  glebas.push({
    nome: c.nome, areaFmt: c.bloco.cabecalho.areaHa, tarefasFmt: fmtBR(ha * 10000 / 4356, 2),
    perimetroFmt: c.bloco.cabecalho.perimetroM, identificacao: identificacaoDaGleba(servico, c.nome), vertices: vg,
  });
}

const areaFmt = fmtBR(areaTotalHa(blocos), 4);
console.log(`\nÁREA TOTAL (soma): ${areaFmt} ha · ${vertices.length} vértices no desenho`);
console.log(`PERÍMETROS (individuais, não somados): ${glebas.map((g) => `${g.nome}=${g.perimetroFmt} m`).join(" · ")}`);

const pdfBytes = await gerarPlantaPdf({
  vertices, trechos, denominacao,
  proprietarios: [{ nome: blocos[0].cabecalho.proprietario, cpf: blocos[0].cabecalho.cpf }],
  tipoImovel: "matricula", matricula: blocos[0].cabecalho.matricula, cns: blocos[0].cabecalho.cns,
  sncr: blocos[0].cabecalho.sncr, municipioUf: blocos[0].cabecalho.municipioUf,
  areaFmt, tarefasFmt: fmtBR(areaTotalHa(blocos) * 10000 / 4356, 2),
  perimetroFmt: "", mcAbs: Math.abs(6 * fuso - 183), fuso, latMediaDeg: latMedia,
  trt: blocos[0].cabecalho.documentoRt.split(" ")[0],
  rt: {
    nome: blocos[0].cabecalho.rtNome, formacao: blocos[0].cabecalho.formacao,
    conselhoSigla: "CFTA", conselhoNumero: blocos[0].cabecalho.conselho,
    codigoCredenciado: blocos[0].cabecalho.codigoCredenciamento,
  },
  desenhista: "", dataStr: "09/09/2026", logo: null, satelite: null,
  folha: "A1", partes, glebas,
});
writeFileSync(new URL("../tests/out/planta-glebas-sigef.pdf", import.meta.url), pdfBytes);
console.log(`\nPDF: tests/out/planta-glebas-sigef.pdf (${(pdfBytes.length / 1024).toFixed(0)} KB)`);
