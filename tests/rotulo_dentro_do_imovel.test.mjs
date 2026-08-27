// Regressão da FAZENDA RIACHO DA CRUZ: o nome do confrontante (e o número, quando
// o trecho sai numerado) ia parar DENTRO da fazenda.
//
// O trecho do M-4640 tem 6.001 m — o mais longo dos quatro. Seu meio por
// comprimento de arco cai na aresta 26→27, que faz fronteira com uma reentrância
// estreita: andando pela normal externa, a divisa é REENCONTRADA a 279,5 m. O
// afastamento de regra (5,2% da diagonal do polígono) dava 281 m na escala
// 1:10.000 — 1,5 m além do ponto de reentrada, e o rótulo reaparecia no meio do
// imóvel.
//
// Nada rejeitava o candidato: `melhorLivre` só testava cruzamento com segmento, e
// um bloco pousado no vazio interno não cruza linha nenhuma — era o mais barato e
// portanto o primeiro escolhido.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { fmtBR, fmtGmsPlanilha } from "../supabase/functions/_shared/geo.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);

// Recorte do perímetro real (UTM 24S), preservando a reentrância que causa o
// defeito: 24 é o M do trecho, 25/26 formam o corredor estreito e 27..31 seguem
// para o M seguinte. Os demais lados fecham o anel pelo norte.
const PONTOS = [
  [463121.825, 8792820.574], // 0  M — ASSENTAMENTO NOVA VIDA
  [464485.707, 8792162.323], // 1
  [465179.577, 8791511.948], // 2
  [465339.772, 8790912.265], // 3
  [465309.487, 8790675.057], // 4  M — trecho longo começa aqui (o "26")
  [464323.848, 8790490.579], // 5  \_ reentrância estreita
  [464515.868, 8791918.145], // 6  /
  [462839.190, 8789458.071], // 7
  [462576.483, 8789073.198], // 8
  [462511.276, 8788978.615], // 9  M — RIO ITAPICURU
  [462304.867, 8789159.318], // 10
  [462008.295, 8789487.224], // 11
  [461825.033, 8789697.928], // 12
  [461542.524, 8789749.477], // 13 M — LAMEIRO DA BÔA VISTA
];
const MS = { 0: "ASSENTAMENTO NOVA VIDA (PA MARI)\\ CNPJ: 03.299.373/0001-01", 4: "(MATR.473/CNS.13.662-2) FAZENDA RIACHO DA CRUZ\\ RUBEM LOPES DA SILVA\\ CPF:778.854.145-15", 9: "RIO ITAPICURU", 13: "(MATR.37/CNS.13.662-2) FAZENDA LAMEIRO DA BÔA VISTA\\ ANTONIO LOPES DA SILVA SUBRINHO\\ CPF:028.305.745-91" };

function montar(numerarTrechoDoM4640) {
  const vertices = PONTOS.map(([e, n], i) => ({
    ordem: i, numTxt: i + 1, e, n, h: 300, sigmaPos: 0.01, sigmaH: 0.02,
    tipo: MS[i] ? "M" : "P", metodo: "PG6", inserido: false,
    descritivo: MS[i] ?? null,
    tipoLimite: MS[i] ? (i === 9 ? "LN1" : "LA1") : null,
    ehVia: false,
    numerado: numerarTrechoDoM4640 && i === 4,
  }));
  return montarServico({
    fusoUtm: 24, prefixo: "DSBN", contadores: { M: 3605, P: 13130, V: 758 }, vertices,
  }, proj4);
}

async function desenhar(calc) {
  const posDe = new Map(calc.ring.map((v, i) => [v.ordem, i]));
  const diag = { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 };
  await gerarPlantaPdf({
    vertices: calc.ring.map((v, i) => ({
      codigo: v.codigo, e: v.eProj, n: v.nProj,
      lonFmt: fmtGmsPlanilha(v.lonGms, "lon"), latFmt: fmtGmsPlanilha(v.latGms, "lat"),
      alt: String(v.h).replace(".", ","),
      azFmt: calc.segs[i].azimuteFmt, distFmt: calc.segs[i].distFmt,
      vante: calc.ring[(i + 1) % calc.ring.length].codigo,
    })),
    trechos: calc.trechosOrdenados.map((t, k) => {
      const prox = calc.trechosOrdenados[(k + 1) % calc.trechosOrdenados.length];
      return {
        descritivo: t.descritivo,
        isEstrada: t.ehVia && !t.ehRio,
        isRio: t.ehRio,
        numerado: t.numerado,
        inicioIdx: posDe.get(t.verticeInicioOrdem),
        fimIdx: posDe.get(prox.verticeInicioOrdem),
      };
    }),
    denominacao: "FAZENDA RIACHO DA CRUZ",
    proprietarios: [{ nome: "ANTONIO LOPES DA SILVA SUBRINHO", cpf: "028.305.745-91" }],
    matricula: "407", cns: "13.662-2", sncr: "950.025.287.237-5", municipioUf: "CANSANÇÃO-BA",
    areaFmt: fmtBR(calc.areaHa, 4), tarefasFmt: fmtBR(calc.areaHa * 10000 / 4356, 2),
    perimetroFmt: fmtBR(calc.perimetroM, 2),
    mcAbs: 39, fuso: 24, latMediaDeg: -10.93, trt: "000001",
    rt: { nome: "DANIEL NASCIMENTO SANTOS", formacao: "Técnico em Agrimensura", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
    desenhista: "", dataStr: "27/08/2026", logo: null,
  }, diag);
  return diag;
}

test("nenhum nome de confrontante cai dentro da fazenda", async () => {
  const diag = await desenhar(montar(false));
  assert.ok(diag.rotulos.length >= 4, `poucos rótulos: ${diag.rotulos.length}`);
  assert.equal(diag.dentroDoImovel, 0,
    `${diag.dentroDoImovel} rótulo(s) desenhados dentro da poligonal do imóvel`);
  // e a correção não pode ter empurrado nada por cima das linhas
  assert.equal(diag.sobrepostos, 0, `${diag.sobrepostos} rótulo(s) sobre as linhas do terreno`);
});

test("o número do confrontante numerado também fica fora", async () => {
  const diag = await desenhar(montar(true));
  assert.equal(diag.dentroDoImovel, 0,
    `${diag.dentroDoImovel} rótulo(s) dentro da poligonal — o número usa a mesma âncora do bloco`);
  assert.equal(diag.sobrepostos, 0, `${diag.sobrepostos} rótulo(s) sobre as linhas do terreno`);
});
