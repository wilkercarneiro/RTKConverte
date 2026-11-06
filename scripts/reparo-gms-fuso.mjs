// Reparo do GMS gravado no fuso errado (FAZENDA SALGADINHO e cia., 06/11/2026).
//
//   node scripts/reparo-gms-fuso.mjs <vertices.psv> <saida.sql>
//
// Entrada: `id|servico_id|fuso_utm|e|n|lat_gms|lon_gms|inserido_manual` (psql -At -F'|').
// Para cada vértice com E/N e GMS, refaz o GMS a partir do E/N no fuso do
// serviço — a mesma conta do parse-txt (calcularVertices → fmtGmsPlanilha) —
// e grava UPDATE só onde o GMS gravado se afasta mais de 1e-4° (~11 m).
// Vértice inserido à mão (GMS é a verdade) só é relatado, nunca alterado.
// Cada UPDATE confere o valor antigo: rodar duas vezes não estraga nada.
import fs from "node:fs";
import proj4 from "proj4";
import { degToGmsCanonical, fmtGmsPlanilha, GEO_DEF, gmsToDeg, parseGmsPlanilha, utmDef } from "../supabase/functions/_shared/geo.ts";

const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) { console.error("uso: node scripts/reparo-gms-fuso.mjs <vertices.psv> <saida.sql>"); process.exit(2); }
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const porServico = new Map();
const manuais = [];
let sql = "begin;\n", total = 0;
for (const linha of fs.readFileSync(entrada, "utf8").split(/\r?\n/)) {
  if (!linha.trim()) continue;
  const [id, sid, fuso, e, n, lat, lon, manual] = linha.split("|");
  if (!fuso || !e || !n || !lat || !lon) continue;
  let latG, lonG;
  try { latG = gmsToDeg(parseGmsPlanilha(lat)); lonG = gmsToDeg(parseGmsPlanilha(lon)); } catch { continue; }
  const [lonEN, latEN] = proj4(utmDef(Number(fuso)), GEO_DEF, [Number(e), Number(n)]);
  if (Math.abs(lonEN - lonG) <= 1e-4 && Math.abs(latEN - latG) <= 1e-4) continue;
  if (manual === "t") { manuais.push(`${sid} ${id}`); continue; }
  const novoLat = fmtGmsPlanilha(degToGmsCanonical(latEN), "lat");
  const novoLon = fmtGmsPlanilha(degToGmsCanonical(lonEN), "lon");
  sql += `update vertices set lat_gms=${q(novoLat)}, lon_gms=${q(novoLon)} where id=${q(id)} and lat_gms=${q(lat)} and lon_gms=${q(lon)};\n`;
  const r = porServico.get(sid) ?? { n: 0, dlon: lonEN - lonG };
  r.n++;
  porServico.set(sid, r);
  total++;
}
sql += "commit;\n";
fs.writeFileSync(saida, sql);
for (const [sid, r] of porServico) console.log(`   ${sid}: ${r.n} vértice(s), longitude deslocada ${r.dlon.toFixed(4)}°`);
if (manuais.length) console.log(`   ATENÇÃO: ${manuais.length} vértice(s) inserido(s) à mão desencontrados — NÃO alterados:\n     ${manuais.join("\n     ")}`);
console.log(`   ${total} UPDATE(s) em ${saida}`);
