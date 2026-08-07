// Diagnóstico: dado o anel de um serviço como está no banco, mostra quais
// trechos saem como faixa de domínio e quantas arestas do desenho recebem a
// linha dupla vermelha — com a MESMA varredura de planta.ts.
//
// Serve para separar "o usuário não marcou a via" de "o sistema não desenhou".
// Uso: node scripts/diag_estradas.mjs anel.json
//   anel.json = [[ordem, e, n, tipo, codigo, descritivo, tipoLimite, ehVia], ...]
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const anel = JSON.parse(readFileSync(process.argv[2], "utf8"));

const calc = montarServico({
  fusoUtm: Number(process.argv[3] ?? 24),
  prefixo: "DSBN",
  contadores: { M: 0, P: 0, V: 0 },
  vertices: anel.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite, ehVia]) => ({
    ordem, numTxt: ordem + 1, e, n, h: 360, sigmaPos: 0.01, sigmaH: 0.01,
    tipo, metodo: "PG6", codigoManual: codigo, inserido: false,
    descritivo: descritivo || "", tipoLimite: tipoLimite || null, ehVia: !!ehVia,
  })),
}, proj4);

const g = geometriaDoCalculo(calc);
const trechoDoIdx = (i) => g.trechos.find((t) =>
  t.fimIdx > t.inicioIdx ? i >= t.inicioIdx && i < t.fimIdx : i >= t.inicioIdx || i < t.fimIdx
) ?? g.trechos[g.trechos.length - 1];

console.log("trechos:");
for (const t of g.trechos) {
  console.log(`  [${String(t.inicioIdx).padStart(2)}→${String(t.fimIdx).padStart(2)}] via=${t.isEstrada ? "SIM" : "não"}  ${t.descritivo.slice(0, 45)}`);
}
const vermelhas = [];
g.vertices.forEach((v, i) => {
  if (trechoDoIdx(i).isEstrada) vermelhas.push(`${v.codigo}→${g.vertices[(i + 1) % g.vertices.length].codigo}`);
});
console.log(`\narestas com linha vermelha: ${vermelhas.length}/${g.vertices.length}`);
for (const a of vermelhas) console.log(`  ${a}`);
