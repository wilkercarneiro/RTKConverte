// Smoke: fluxo Serviço 2 completo — analisar PDF → criar serviço 'pecas' → gerar 7 peças
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const supa = createClient(URL_BASE, ANON);
const { data: auth, error: eAuth } = await supa.auth.signInWithPassword({
  email: "e2e@rtkconverte.local", password: "E2e-teste-123!",
});
if (eAuth) { console.error(eAuth.message); process.exit(1); }

async function fn(body) {
  const r = await fetch(`${URL_BASE}/functions/v1/gerar-pecas`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.session.access_token}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${JSON.stringify(d).slice(0, 300)}`);
  return d;
}

const pdf_base64 = readFileSync(new URL("../reference/PREVIA-FAZENDA-VIBRACAO.pdf", import.meta.url)).toString("base64");

// 1. analisar
const a = await fn({ modo: "analisar", pdf_base64 });
console.log("analisar OK:", a.cabecalho.denominacao, "|", a.vertices, "vértices |", a.trechos.length, "trechos");
console.log("trechos:", a.trechos.map((t) => `${t.codigo}(${t.segmentos})`).join(" "));

// 2. criar serviço tipo 'pecas' (como a UI faz)
const [muni, uf] = a.cabecalho.municipioUf.split("-");
const { data: rt } = await supa.from("responsaveis_tecnicos").select().limit(1).single();
const { data: novo, error: eIns } = await supa.from("servicos").insert({
  tipo: "pecas", status: "rascunho",
  denominacao: a.cabecalho.denominacao.replace(/\s*-\s*Parte \d+$/i, ""),
  detentor_nome: a.cabecalho.proprietario, detentor_cpf: a.cabecalho.cpf, detentor_genero: "M",
  matricula: a.cabecalho.matricula, cns: a.cabecalho.cns, codigo_sncr: a.cabecalho.sncr,
  municipio: muni, uf: uf.trim(), rt_id: rt.id,
  requerente2_nome: "SEGUNDA REQUERENTE", requerente2_cpf: "222.333.444-55", requerente2_genero: "F",
  endereco_detentor: "Av. Central, Nº 1, Centro, Araci, Bahia, CEP:48.760-000",
  area_matricula_ha: "86", nome_arquivo_txt: "PREVIA.pdf",
}).select().single();
if (eIns) throw eIns;
console.log("serviço 'pecas' criado:", novo.id);

// 3. trechos com codigo_inicio (com descritivos completos em 2 deles)
const DESC_COMPLETO = {
  "DSBN-M-3605": "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA\\ CARLOS MATOS DE LIMA\\ CPF:397.521.865-72",
  "DSBN-M-3609": "BA 408",
};
await supa.from("trechos_confrontantes").insert(a.trechos.map((t, i) => ({
  servico_id: novo.id, vertice_inicio_ordem: i, codigo_inicio: t.codigo,
  descritivo: DESC_COMPLETO[t.codigo] ?? t.confrontacao,
  tipo_limite: /\\/.test(t.confrontacao) ? "LA1" : "LA3",
})));

// 4. gerar
const g = await fn({ servico_id: novo.id, pdf_base64 });
console.log("gerar OK:", g.arquivos.length, "arquivos | cartas:", g.resumo.cartas, "| via:", g.resumo.via);
const zip1 = await (await fetch(g.arquivos[0].url)).arrayBuffer();
console.log("download da peça 1:", zip1.byteLength, "bytes");
const { data: fim } = await supa.from("servicos").select("status, tipo").eq("id", novo.id).single();
console.log("status final:", fim.status, "| tipo:", fim.tipo);

// 5. limpeza
await supa.from("servicos").delete().eq("id", novo.id);
console.log("SMOKE SERVIÇO 2: OK (serviço de teste removido)");
