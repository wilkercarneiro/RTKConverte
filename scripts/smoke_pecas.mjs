// Smoke: gera as 7 peças técnicas via Edge Function com o PDF real do SIGEF
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SID = "5ff8beed-24c8-432a-99d6-0f3f9718fd40"; // serviço FAZENDA TESTE (E2E)

const supa = createClient(URL_BASE, ANON);
const { data: auth, error: eAuth } = await supa.auth.signInWithPassword({
  email: "e2e@rtkconverte.local", password: "E2e-teste-123!",
});
if (eAuth) { console.error(eAuth.message); process.exit(1); }

// completa os dados de cliente/RT exigidos pelas peças
await supa.from("servicos").update({
  detentor_genero: "F",
  requerente2_nome: "JOSE DE TESTE SILVA", requerente2_cpf: "555.666.777-88", requerente2_genero: "M",
  endereco_detentor: "Rua das Palmeiras, Nº 100, Centro, Serrinha, Bahia, CEP:48.700-000",
  area_matricula_ha: "86", via_dominio: "BA 408",
}).eq("id", SID);
const { data: serv } = await supa.from("servicos").select("rt_id").eq("id", SID).single();
await supa.from("responsaveis_tecnicos").update({
  formacao: "Técnico em Agrimensura", conselho_sigla: "CREA", conselho_numero: "12345-D",
  identidade: "11.111.111-11 SSP/BA", cpf: "999.888.777-66",
}).eq("id", serv.rt_id);

const pdf = readFileSync(new URL("../reference/PREVIA-FAZENDA-VIBRACAO.pdf", import.meta.url));
const resp = await fetch(`${URL_BASE}/functions/v1/gerar-pecas`, {
  method: "POST",
  headers: { Authorization: `Bearer ${auth.session.access_token}`, apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ servico_id: SID, pdf_base64: pdf.toString("base64") }),
});
const d = await resp.json();
if (!resp.ok) { console.error("ERRO:", resp.status, d); process.exit(1); }

console.log("resumo:", JSON.stringify(d.resumo));
console.log("arquivos:", d.arquivos.length);
const outDir = new URL("../tests/out/pecas-e2e/", import.meta.url);
mkdirSync(outDir, { recursive: true });
let falhas = 0;
for (const a of d.arquivos) {
  const buf = Buffer.from(await (await fetch(a.url)).arrayBuffer());
  const nome = a.titulo.replace(/[^\w-]/g, "_") + ".docx";
  writeFileSync(new URL(nome, outDir), buf);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml").async("string");
  const texto = xml.replace(/<[^>]+>/g, "");
  const semExemplo = !texto.includes("LARISSA LIMA") && !texto.includes("GILBERTO GONCALVES") && !texto.includes("FAZENDA VIBRAÇÃO");
  const comDados = texto.includes("TESTE DA SILVA") || texto.includes("JOSE DE TESTE");
  const ok = semExemplo && comDados;
  if (!ok) falhas++;
  console.log(`${ok ? "✔" : "✖"} ${a.titulo} (${buf.length} b) — exemplo removido: ${semExemplo}, dados novos: ${comDados}`);
}
console.log(falhas === 0 ? "\nSMOKE PEÇAS: OK" : `\nSMOKE PEÇAS: ${falhas} FALHAS`);
process.exit(falhas === 0 ? 0 : 1);
