// Diagnóstico: lê a aba perimetro_1 de uma planilha ODS e informa o sentido de
// percurso e o vértice inicial — as duas exigências do SIGEF ("[ERRO] A parcela
// Parte N tem seus vértices em sentido anti-horário").
//   node scripts/checar_sentido_ods.mjs ArquivosExemplo/THEREZA.ODS [...]
import { readFileSync } from "node:fs";
import JSZip from "jszip";

const CELL_RE = /<table:(?:covered-)?table-cell[^>]*(?:\/>|>[\s\S]*?<\/table:(?:covered-)?table-cell>)/g;
const texto = (cell) => [...cell.matchAll(/<text:p>([\s\S]*?)<\/text:p>/g)].map((m) => m[1]).join("")
  .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

// "39 5 04,737 W" -> graus decimais com sinal
function gms(s) {
  const m = s.match(/^(\d+)\s+(\d+)\s+([\d,.]+)\s*([NSEW])$/i);
  if (!m) return null;
  const dec = +m[1] + +m[2] / 60 + parseFloat(m[3].replace(",", ".")) / 3600;
  return /[SW]/i.test(m[4]) ? -dec : dec;
}

async function vertices(caminho) {
  const zip = await JSZip.loadAsync(readFileSync(caminho));
  const xml = await zip.file("content.xml").async("string");
  const i = xml.search(/<table:table\s[^>]*table:name="perimetro_1"/);
  if (i < 0) throw new Error("aba perimetro_1 não encontrada");
  const fim = xml.indexOf("<table:table ", i + 10);
  const aba = xml.slice(i, fim < 0 ? undefined : fim);
  const out = [];
  for (const linha of aba.split(/(?=<table:table-row)/g)) {
    const c = linha.match(CELL_RE) ?? [];
    if (c.length < 4) continue;
    const cod = texto(c[0]), lon = gms(texto(c[1])), lat = gms(texto(c[3]));
    if (cod && lon !== null && lat !== null) out.push({ cod, lon, lat });
  }
  return out;
}

// shoelace em (lon, lat): plano destro, soma > 0 = anti-horário
const areaAssinada = (vs) => vs.reduce((s, a, i) => {
  const b = vs[(i + 1) % vs.length];
  return s + (a.lon * b.lat - b.lon * a.lat);
}, 0) / 2;

for (const arq of process.argv.slice(2)) {
  try {
    const vs = await vertices(arq);
    if (vs.length < 3) { console.log(`${arq}: só ${vs.length} vértice(s) — nada a conferir`); continue; }
    const a = areaAssinada(vs);
    const norte = vs.reduce((m, v) => (v.lat > m.lat ? v : m), vs[0]);
    console.log(
      `${arq}\n  ${vs.length} vértices | ${a < 0 ? "HORÁRIO ✓" : "ANTI-HORÁRIO ✗"} (área assinada ${a.toExponential(3)})\n` +
      `  1º = ${vs[0].cod} | mais ao norte = ${norte.cod} ${vs[0].cod === norte.cod ? "✓" : "✗ (o SIGEF exige começar nele)"}`,
    );
  } catch (e) {
    console.log(`${arq}: ${e.message}`);
  }
}
