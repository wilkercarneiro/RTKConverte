// Amostra visual dos confrontantes NUMERADOS (uso manual, não é teste):
//
//   node scripts/amostra_numerada.mjs   →  tests/out/numerada-{sem,com}.pdf
//
// A mesma planta com e sem numeração, para olhar lado a lado o que muda: os
// dois blocos de nome do vizinho viram discos com "1" e "2", o desenho ganha
// altura porque a faixa do quadro é descontada antes da escala, e o texto
// completo reaparece no quadro CONFRONTANTES do rodapé.
import { writeFileSync } from "node:fs";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { ANEL, dadosPlantaDe } from "../tests/fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const K = "(MATR.4.403/CNS.00.770-8) FAZENDA KAGADOS\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53";
const L = "(MATR.432/CNS.00.810-2) FAZENDA LAMEIRO\\ MARIA NINA DA SILVA COSTA\\ CPF:666.186.815-53";

const geo = (marcados) => geometriaDoCalculo(montarServico({
  fusoUtm: 24, prefixo: "DSBN", contadores: { M: 0, P: 0, V: 0 },
  vertices: ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
    ordem, numTxt: ordem + 1, e, n, h: 360, sigmaPos: 0.01, sigmaH: 0.01,
    tipo, metodo: "PG6", codigoManual: codigo, inserido: false,
    descritivo: ordem === 4 ? K : ordem === 15 ? L : descritivo,
    tipoLimite, ehVia: false, numerado: marcados.includes(ordem),
  })),
}, proj4));

for (const [nome, marcados] of [["sem", []], ["com", [4, 15]]]) {
  const diag = {};
  const pdf = await gerarPlantaPdf(dadosPlantaDe(geo(marcados), { folha: "A3" }), diag);
  writeFileSync(`tests/out/numerada-${nome}.pdf`, pdf);
  console.log(
    `tests/out/numerada-${nome}.pdf  ${pdf.length} bytes` +
    `  · rótulos sobrepostos: ${diag.sobrepostos}  · deslocados: ${diag.deslocados}`,
  );
}
