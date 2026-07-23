// Smoke: gera a Planta A1 nos dois modos (dados internos 'geo' e PDF SIGEF)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SID = "5ff8beed-24c8-432a-99d6-0f3f9718fd40";
const supa = createClient(URL_BASE, ANON);
const { data: auth, error: eAuth } = await supa.auth.signInWithPassword({
  email: "e2e@rtkconverte.local", password: "E2e-teste-123!",
});
if (eAuth) { console.error(eAuth.message); process.exit(1); }

async function fn(body) {
  const r = await fetch(`${URL_BASE}/functions/v1/gerar-planta`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.session.access_token}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(d).slice(0, 400)}`);
  return d;
}

mkdirSync(new URL("../tests/out/", import.meta.url), { recursive: true });

// modo 1: dados internos do serviço geo
const g1 = await fn({ servico_id: SID });
console.log("planta (dados internos):", JSON.stringify(g1.resumo));
const b1 = Buffer.from(await (await fetch(g1.planta_pdf)).arrayBuffer());
writeFileSync(new URL("../tests/out/planta-e2e-geo.pdf", import.meta.url), b1);
console.log("  pdf:", b1.length, "bytes | assinatura:", b1.subarray(0, 5).toString());

// modo 2: mesmos serviço, valores SGL do PDF do SIGEF
const pdf_base64 = readFileSync(new URL("../reference/PREVIA-FAZENDA-VIBRACAO.pdf", import.meta.url)).toString("base64");
const g2 = await fn({ servico_id: SID, pdf_base64 });
console.log("planta (SGL do SIGEF):", JSON.stringify(g2.resumo));
const b2 = Buffer.from(await (await fetch(g2.planta_pdf)).arrayBuffer());
writeFileSync(new URL("../tests/out/planta-e2e-sigef.pdf", import.meta.url), b2);
console.log("  pdf:", b2.length, "bytes | assinatura:", b2.subarray(0, 5).toString());

if (b1.subarray(0, 5).toString() !== "%PDF-" || b2.subarray(0, 5).toString() !== "%PDF-") {
  console.error("SMOKE PLANTA: FALHA (não é PDF)"); process.exit(1);
}
console.log("SMOKE PLANTA: OK");
