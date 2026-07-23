// Smoke: versionamento + histórico + clientes migrados
import { createClient } from "@supabase/supabase-js";

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SID = "5ff8beed-24c8-432a-99d6-0f3f9718fd40";
const supa = createClient(URL_BASE, ANON);
const { data: auth } = await supa.auth.signInWithPassword({ email: "e2e@rtkconverte.local", password: "E2e-teste-123!" });

async function fn(nome, body) {
  const r = await fetch(`${URL_BASE}/functions/v1/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.session.access_token}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${nome}: ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
  return d;
}

// clientes migrados
const { data: clientes } = await supa.from("clientes").select();
console.log("clientes migrados:", clientes.map((c) => c.nome).join(" | "));
const { data: serv } = await supa.from("servicos").select("cliente_id, detentor_nome").eq("id", SID).single();
console.log("serviço vinculado a cliente?", !!serv.cliente_id, `(detentor: ${serv.detentor_nome})`);

// duas gerações → duas versões
const g1 = await fn("gerar-documentos", { servico_id: SID });
const g2 = await fn("gerar-documentos", { servico_id: SID });
console.log("versões geradas:", g1.resumo.versao, "→", g2.resumo.versao);

const { data: docs } = await supa.from("documentos_gerados").select().eq("servico_id", SID).order("versao");
console.log("histórico:", docs.map((d) => `v${d.versao}:${d.tipo}`).join(" "));

// download de versão ANTIGA via URL assinada pelo cliente (policy gerados_select)
const antigo = docs.find((d) => d.versao === g1.resumo.versao && d.tipo === "memorial_docx");
const { data: sig, error } = await supa.storage.from("gerados").createSignedUrl(antigo.path, 300, { download: "teste.docx" });
if (error) throw error;
const resp = await fetch(sig.signedUrl);
console.log("download da versão antiga:", resp.status, (await resp.arrayBuffer()).byteLength, "bytes");

const ok = g2.resumo.versao === g1.resumo.versao + 1 && docs.length >= 4 && resp.status === 200 && !!serv.cliente_id;
console.log(ok ? "SMOKE HISTÓRICO: OK" : "SMOKE HISTÓRICO: FALHA");
process.exit(ok ? 0 : 1);
