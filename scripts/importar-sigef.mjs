// Importa parcelas certificadas do SIGEF para a base local (tabela
// parcelas_sigef, migration 0018) — é o que alimenta o mapa interativo e a
// verificação automática de sobreposição.
//
// Aceita o shapefile que o INCRA exporta por UF (o .zip inteiro, ou o .shp com
// o .dbf ao lado) e também GeoJSON (FeatureCollection). Vale para
// "Imóvel certificado SIGEF privado/público" e SNCI: os campos são lidos por
// prefixo (parcela_co, nome_area, municipio_, uf_id, status, codigo_imo...).
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/importar-sigef.mjs <arquivo> [--uf GO] [--fonte shapefile]
//
// Onde baixar: https://certificacao.incra.gov.br/csv_shp/export_shp.py (exige
// login gov.br) → "Sigef Privado"/"Sigef Público" por UF, ou o acervo fundiário
// (https://acervofundiario.incra.gov.br). Rode de novo quando baixar uma versão
// mais nova: a gravação é upsert por código de parcela.
import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import * as shapefile from "shapefile";

const args = process.argv.slice(2);
const arquivo = args.find((a) => !a.startsWith("--"));
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const ufFixa = opt("uf")?.toUpperCase();
const fonte = opt("fonte") ?? "shapefile";
const LOTE = Number(opt("lote") ?? 150);

const URL_BASE = process.env.SUPABASE_URL;
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!arquivo || !URL_BASE || !CHAVE) {
  console.error("Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/importar-sigef.mjs <arquivo.zip|.shp|.geojson> [--uf GO] [--fonte shapefile]");
  process.exit(1);
}
const supabase = createClient(URL_BASE, CHAVE, { auth: { persistSession: false } });

// ---- leitura ----
async function lerFeatures(caminho) {
  const ext = extname(caminho).toLowerCase();
  if (ext === ".geojson" || ext === ".json") {
    const fc = JSON.parse(readFileSync(caminho, "utf8"));
    return fc.type === "FeatureCollection" ? fc.features : [fc];
  }
  let shp, dbf, cpg = "latin1";
  if (ext === ".zip") {
    const zip = await JSZip.loadAsync(readFileSync(caminho));
    const achar = (e) => Object.keys(zip.files).find((n) => n.toLowerCase().endsWith(e) && !zip.files[n].dir);
    const nShp = achar(".shp"), nDbf = achar(".dbf"), nCpg = achar(".cpg");
    if (!nShp || !nDbf) throw new Error("o .zip não tem .shp e .dbf");
    shp = await zip.file(nShp).async("nodebuffer");
    dbf = await zip.file(nDbf).async("nodebuffer");
    if (nCpg) cpg = (await zip.file(nCpg).async("string")).trim() || cpg;
  } else if (ext === ".shp") {
    shp = readFileSync(caminho);
    dbf = readFileSync(caminho.slice(0, -4) + ".dbf");
    try { cpg = readFileSync(caminho.slice(0, -4) + ".cpg", "utf8").trim() || cpg; } catch { /* sem .cpg */ }
  } else {
    throw new Error(`extensão não suportada: ${ext}`);
  }
  const enc = /utf-?8/i.test(cpg) ? "utf-8" : "latin1";
  const src = await shapefile.open(shp, dbf, { encoding: enc });
  const out = [];
  for (;;) {
    const r = await src.read();
    if (r.done) break;
    out.push(r.value);
  }
  return out;
}

// ---- campos (por prefixo, porque o DBF trunca nomes em 10 caracteres) ----
function campo(props, ...prefixos) {
  const chaves = Object.keys(props);
  for (const p of prefixos) {
    const k = chaves.find((c) => c.toLowerCase() === p.toLowerCase()) ?? chaves.find((c) => c.toLowerCase().startsWith(p.toLowerCase()));
    if (k !== undefined && props[k] !== null && props[k] !== undefined && String(props[k]).trim() !== "") return String(props[k]).trim();
  }
  return null;
}

function paraParcela(f) {
  const p = f.properties ?? {};
  const g = f.geometry;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
  const codigo = campo(p, "parcela_co", "parcela", "codigo_par", "cod_parcel", "codigo", "id_parcela", "qrcode");
  if (!codigo) return null;
  return {
    codigo,
    nome: campo(p, "nome_area", "nome", "nome_imove", "denominac"),
    uf: ufFixa ?? campo(p, "uf_id", "uf", "sigla_uf"),
    municipio: campo(p, "municipio_", "municipio", "nm_municip"),
    codigo_imovel: campo(p, "codigo_imo", "cod_imovel", "codigo_imovel", "imovel"),
    registro: campo(p, "registro_m", "matricula", "registro"),
    situacao: campo(p, "status", "situacao_i", "situacao"),
    fonte,
    geometria: g,
  };
}

// ---- envio ----
const t0 = Date.now();
const features = await lerFeatures(arquivo);
console.log(`${basename(arquivo)}: ${features.length} feições lidas`);
const parcelas = features.map(paraParcela).filter(Boolean);
console.log(`${parcelas.length} parcelas com código e polígono`);
let gravadas = 0;
for (let i = 0; i < parcelas.length; i += LOTE) {
  const lote = parcelas.slice(i, i + LOTE);
  const { data, error } = await supabase.rpc("sigef_guardar", { parcelas: lote });
  if (error) { console.error(`lote ${i / LOTE + 1}: ${error.message}`); process.exitCode = 1; continue; }
  gravadas += Number(data ?? 0);
  process.stdout.write(`\r${Math.min(i + LOTE, parcelas.length)}/${parcelas.length} enviadas · ${gravadas} gravadas`);
}
console.log(`\nconcluído em ${((Date.now() - t0) / 1000).toFixed(0)} s · ${gravadas} parcelas gravadas/atualizadas`);
