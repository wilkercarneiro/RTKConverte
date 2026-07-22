// Smoke: importa THEREZA.txt (rótulos colados + ponto 12 no fim do arquivo)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const supa = createClient(URL_BASE, ANON);
const { data: auth, error: eAuth } = await supa.auth.signInWithPassword({
  email: "e2e@rtkconverte.local", password: "E2e-teste-123!",
});
if (eAuth) { console.error(eAuth.message); process.exit(1); }

const conteudo = readFileSync(new URL("../reference/THEREZA.txt", import.meta.url), "utf8");
const r = await fetch(`${URL_BASE}/functions/v1/parse-txt`, {
  method: "POST",
  headers: { Authorization: `Bearer ${auth.session.access_token}`, apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ nome_arquivo: "THEREZA.txt", conteudo, uf: "BA" }),
});
const d = await r.json();
if (!r.ok) { console.error("ERRO:", r.status, d); process.exit(1); }

console.log("importado OK — servico:", d.servico.id);
console.log("vértices:", d.vertices.length, "(esperado 64)");
console.log("ordem por ID:", d.vertices.every((v, i) => v.num_txt === i + 1) ? "1..64 correta" : "ERRADA");
const rot = d.vertices.filter((v) => v.rotulo_txt).map((v) => `${v.num_txt}:${v.rotulo_txt}`);
console.log("rótulos:", rot.join(" | "));
console.log("trechos sugeridos:", d.trechos.map((t) => t.apelido_txt).join(", "));
console.log("fuso:", d.preview.fuso, "| área:", d.preview.areaHa.toFixed(4), "ha | perímetro:", d.preview.perimetroM.toFixed(2), "m");
console.log("M/P:", d.preview.qtdM, "/", d.preview.qtdP);

await supa.from("servicos").delete().eq("id", d.servico.id);
console.log("SMOKE THEREZA OK (rascunho de teste removido)");
