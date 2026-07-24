import { readFileSync } from "fs";
import proj4lib from "proj4";
import { parseTxt, fmtBR, fmtGmsPlanilha } from "../supabase/functions/_shared/geo.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { parseSigefTexto } from "../supabase/functions/_shared/sigef_pdf.ts";
import { montarTrechosPecas } from "../supabase/functions/_shared/pecas.ts";
import { extractText, getDocumentProxy } from "unpdf";

const proj4 = (f, t, c) => proj4lib(f, t, c);

async function runE2E() {
  console.log("=== TESTE 1: SERVIÇO GEO (TXT) ===");
  const txt = readFileSync("./reference/LARISSA.txt", "utf8");
  const pontos = parseTxt(txt);
  console.log("Pontos TXT lidos:", pontos.length);

  const verticesGeo = pontos.map((p, i) => ({
    ordem: i, numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
    tipo: [30, 36, 41, 58, 64, 9].includes(p.num) ? "M" : "P", metodo: "PG6", inserido: false,
  }));
  const servicoGeo = montarServico({
    fusoUtm: 24, verticeInicialOrdem: 0, prefixo: "DSBN",
    contadores: { M: 3605, P: 13130, V: 758 }, vertices: verticesGeo,
    trechos: [
      { verticeInicioOrdem: 0, descritivo: "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA\\ CARLOS MATOS\\ CPF:111", tipoLimite: "LA1" },
      { verticeInicioOrdem: 6, descritivo: "(POSSE) FAZENDA LAMEIRO\\ RUDSON PINTO\\ CPF:222", tipoLimite: "LA1" },
      { verticeInicioOrdem: 12, descritivo: "BA 408", tipoLimite: "LA3" },
    ],
  }, proj4);
  console.log("Serviço GEO montado, vértices:", servicoGeo.ring.length);

  console.log("=== TESTE 2: PARSER DO PDF SIGEF ===");
  const pdfBuf = readFileSync("./reference/PREVIA-FAZENDA-VIBRACAO.pdf");
  const proxy = await getDocumentProxy(new Uint8Array(pdfBuf));
  const { text: pdfTxt } = await extractText(proxy, { mergePages: true });
  const sigef = parseSigefTexto(pdfTxt);
  console.log("SIGEF lido: área =", sigef.cabecalho.areaHa, "perímetro =", sigef.cabecalho.perimetroM, "linhas =", sigef.linhas.length);

  console.log("=== TESTE 3: GERAÇÃO DA PLANTA VIA SIGEF ===");
  const lon0 = parseFloat(sigef.linhas[0].lon.replace(/[^\d.-]/g, "")) || -39;
  const verticesPlantaSigef = sigef.linhas.map((l) => ({
    codigo: l.codigo, e: 400000 + (Math.random() * 1000), n: 8700000 + (Math.random() * 1000),
    lonFmt: l.lon, latFmt: l.lat, alt: l.alt, azFmt: l.azimute, distFmt: l.dist, vante: l.vante,
  }));
  const trechosPlantaSigef = [{
    descritivo: sigef.linhas[0].confrontacao,
    isEstrada: false,
    inicioIdx: 0,
    fimIdx: Math.floor(sigef.linhas.length / 2),
  }, {
    descritivo: sigef.linhas[Math.floor(sigef.linhas.length / 2)].confrontacao,
    isEstrada: false,
    inicioIdx: Math.floor(sigef.linhas.length / 2),
    fimIdx: 0,
  }];

  const pdfPlantaSigef = await gerarPlantaPdf({
    vertices: verticesPlantaSigef,
    trechos: trechosPlantaSigef,
    denominacao: sigef.cabecalho.denominacao,
    proprietarios: [{
      nome: sigef.cabecalho.proprietario,
      cpf: sigef.cabecalho.cpf,
      isEspolio: true,
      inventarianteNome: "INVENTARIANTE DE TESTE",
      inventarianteCpf: "123.456.789-00",
    }],
    tipoImovel: "matricula",
    matricula: sigef.cabecalho.matricula,
    cns: sigef.cabecalho.cns,
    sncr: sigef.cabecalho.sncr,
    municipioUf: sigef.cabecalho.municipioUf,
    areaFmt: sigef.cabecalho.areaHa,
    tarefasFmt: "192,98",
    perimetroFmt: sigef.cabecalho.perimetroM,
    mcAbs: 39, fuso: 24, latMediaDeg: -11.4,
    trt: sigef.cabecalho.documentoRt,
    rt: { nome: sigef.cabecalho.rtNome, formacao: sigef.cabecalho.formacao, conselhoSigla: "CFTA", conselhoNumero: sigef.cabecalho.conselho, codigoCredenciado: sigef.cabecalho.codigoCredenciamento },
    desenhista: "JANETE", dataStr: "24/07/2026",
    logo: null, satelite: null,
  });

  console.log("Planta via SIGEF gerada com sucesso! Tamanho:", pdfPlantaSigef.length, "bytes");

  console.log("=== TESTE 4: MONTAR TRECHOS PEÇAS ===");
  const iniciosMap = new Map();
  iniciosMap.set(sigef.linhas[0].codigo, { descritivo: "(MATR.123) TESTE 1\\ CPF:111", tipoLimite: "LA1" });
  iniciosMap.set(sigef.linhas[10].codigo, { descritivo: "BA 408", tipoLimite: "LA3" });
  const resTrechos = montarTrechosPecas(sigef.linhas, iniciosMap);
  console.log("Trechos peças montados:", resTrechos.trechos.length);
  console.log("E2E COMPLETO SEM ERROS.");
}

runE2E().catch(console.error);
