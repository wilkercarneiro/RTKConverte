// Smoke: importa ANTONIO.txt (separador vírgula + decimal ponto)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const supa = createClient(URL_BASE, ANON);
const { data: auth, error: eAuth } = await supa.auth.signInWithPassword({
  email: "e2e@rtkconverte.local", password: "E2e-teste-123!",
});
if (eAuth) { console.error(eAuth.message); process.exit(1); }

const conteudo = readFileSync(new URL("../reference/ANTONIO.txt", import.meta.url), "utf8");
const r = await fetch(`${URL_BASE}/functions/v1/parse-txt`, {
  method: "POST",
  headers: { Authorization: `Bearer ${auth.session.access_token}`, apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ nome_arquivo: "ANTONIO.txt", conteudo, uf: "BA" }),
});
const d = await r.json();
if (!r.ok) { console.error("ERRO:", r.status, d); process.exit(1); }

console.log("importado OK — servico:", d.servico.id);
console.log("vértices:", d.vertices.length, "(esperado 5)");
console.log("coords do pt 1:", d.vertices[0].e, "/", d.vertices[0].n, "(esperado 497318.611 / 8658085.635)");
console.log("GMS pt 1:", d.vertices[0].lat_gms, "|", d.vertices[0].lon_gms);
console.log("rótulos:", d.vertices.filter((v) => v.rotulo_txt).map((v) => `${v.num_txt}:${v.rotulo_txt}`).join(" | "));
console.log("trechos:", d.trechos.map((t) => t.apelido_txt).join(", "));
console.log("fuso:", d.preview.fuso, "| área:", d.preview.areaHa.toFixed(4), "ha | perímetro:", d.preview.perimetroM.toFixed(2), "m");

await supa.from("servicos").delete().eq("id", d.servico.id);
console.log("SMOKE ANTONIO OK (rascunho de teste removido)");
