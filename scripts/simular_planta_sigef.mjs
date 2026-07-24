import { readFileSync, writeFileSync } from "fs";
import proj4lib from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { parseSigefTexto } from "../supabase/functions/_shared/sigef_pdf.ts";
import { GEO_DEF, utmDef } from "../supabase/functions/_shared/geo.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);

function gmsPdfParaDeg(s) {
  const m = s.match(/(-?)(\d+)°(\d+)'([\d,]+)"/);
  if (!m) throw new Error(`Coordenada inválida no PDF: ${s}`);
  const v = parseInt(m[2], 10) + parseInt(m[3], 10) / 60 + parseFloat(m[4].replace(",", ".")) / 3600;
  return m[1] === "-" ? -v : v;
}

async function simularGeracaoPlanta() {
  const buf = readFileSync("./reference/PREVIA-FAZENDA-VIBRACAO.pdf");
  const proxy = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(proxy, { mergePages: true });
  const sigef = parseSigefTexto(text);

  console.log("=== SIGEF PARSEADO ===");
  console.log(`Linhas: ${sigef.linhas.length}`);
  console.log(`Área: ${sigef.cabecalho.areaHa} ha`);
  console.log(`Perímetro: ${sigef.cabecalho.perimetroM} m`);

  const lon0 = gmsPdfParaDeg(sigef.linhas[0].lon);
  const latMedia = gmsPdfParaDeg(sigef.linhas[0].lat);
  const fuso = Math.floor((Math.abs(lon0) + 180) / 6) + 1;
  // Correção: longitude é negativa (oeste), a fórmula correta é:
  const fusoCorreto = Math.floor((lon0 + 180) / 6) + 1;
  console.log(`\nlon0=${lon0}, latMedia=${latMedia}, fuso calculado=${fuso}, fusoCorreto=${fusoCorreto}`);

  const ud = utmDef(fusoCorreto);
  console.log(`UTM def: ${ud}`);

  // Converter todas as coordenadas
  const vertices = sigef.linhas.map((l, i) => {
    const lonDeg = gmsPdfParaDeg(l.lon);
    const latDeg = gmsPdfParaDeg(l.lat);
    const [e, n] = proj4(GEO_DEF, ud, [lonDeg, latDeg]);
    return { codigo: l.codigo, e, n, lonFmt: l.lon, latFmt: l.lat, alt: l.alt, azFmt: l.azimute, distFmt: l.dist, vante: l.vante };
  });

  console.log("\n=== PRIMEIROS 5 VÉRTICES PROJETADOS ===");
  for (let i = 0; i < 5; i++) {
    console.log(`${vertices[i].codigo}: E=${vertices[i].e.toFixed(3)} N=${vertices[i].n.toFixed(3)}`);
  }

  // Verificar extensão
  const es = vertices.map(v => v.e);
  const ns = vertices.map(v => v.n);
  console.log(`\nExtensão E: ${Math.min(...es).toFixed(1)} a ${Math.max(...es).toFixed(1)} (delta=${(Math.max(...es)-Math.min(...es)).toFixed(1)} m)`);
  console.log(`Extensão N: ${Math.min(...ns).toFixed(1)} a ${Math.max(...ns).toFixed(1)} (delta=${(Math.max(...ns)-Math.min(...ns)).toFixed(1)} m)`);

  // Simular trechos (fallback: mudança de confrontação)
  let starts = [];
  let ultima = "";
  sigef.linhas.forEach((l, i) => {
    if (l.confrontacao !== ultima) {
      ultima = l.confrontacao;
      starts.push({ idx: i, descritivo: l.confrontacao.replace(/\.{3}$/, ""), tipoLimite: "LA1" });
    }
  });
  
  const ehEstrada = (descritivo, tipoLimite) =>
    !descritivo.includes("\\") || /^LA[34567]/.test(tipoLimite);

  const startsUnicos = new Map();
  for (const s of starts) {
    if (!startsUnicos.has(s.idx)) startsUnicos.set(s.idx, s);
  }
  starts = [...startsUnicos.values()].sort((a, b) => a.idx - b.idx);
  
  const trechosPlanta = starts.map((s, k) => ({
    descritivo: s.descritivo,
    isEstrada: ehEstrada(s.descritivo, s.tipoLimite),
    inicioIdx: s.idx,
    fimIdx: starts[(k + 1) % starts.length].idx,
  }));

  console.log(`\n=== TRECHOS ===`);
  trechosPlanta.forEach((t, i) => {
    console.log(`Trecho ${i}: inicioIdx=${t.inicioIdx} fimIdx=${t.fimIdx} estrada=${t.isEstrada} "${t.descritivo.slice(0, 60)}..."`);
  });

  // Gerar o PDF da planta
  const dados = {
    vertices,
    trechos: trechosPlanta,
    denominacao: sigef.cabecalho.denominacao,
    proprietarios: [{ nome: sigef.cabecalho.proprietario, cpf: sigef.cabecalho.cpf }],
    tipoImovel: "matricula",
    matricula: sigef.cabecalho.matricula,
    cns: sigef.cabecalho.cns,
    sncr: sigef.cabecalho.sncr,
    municipioUf: sigef.cabecalho.municipioUf,
    areaFmt: sigef.cabecalho.areaHa,
    tarefasFmt: "192,98",
    perimetroFmt: sigef.cabecalho.perimetroM,
    mcAbs: Math.abs(6 * fusoCorreto - 183),
    fuso: fusoCorreto,
    latMediaDeg: latMedia,
    trt: sigef.cabecalho.documentoRt.split(" ")[0],
    rt: {
      nome: sigef.cabecalho.rtNome,
      formacao: sigef.cabecalho.formacao,
      conselhoSigla: "CFTA",
      conselhoNumero: sigef.cabecalho.conselho,
      codigoCredenciado: sigef.cabecalho.codigoCredenciamento,
    },
    desenhista: "JANETE OLIVEIRA",
    dataStr: "24/07/2026",
    logo: null,
    satelite: null,
  };

  const pdfBytes = await gerarPlantaPdf(dados);
  writeFileSync(new URL("../tests/out/planta-simulada-sigef.pdf", import.meta.url), pdfBytes);
  console.log(`\nPDF gerado com sucesso! ${(pdfBytes.length / 1024).toFixed(0)} KB`);
  console.log("Salvo em tests/out/planta-simulada-sigef.pdf");
}

simularGeracaoPlanta().catch(err => {
  console.error("ERRO:", err);
  console.error(err.stack);
});
