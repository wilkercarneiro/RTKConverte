// Monta a conta de DEMONSTRAÇÃO com dados fictícios: escritório, RT,
// credenciado, cliente e um serviço criado a partir de um TXT sintético
// (scripts/demo/txt-demo.mjs). Idempotente: rodar de novo não duplica.
//
// Pré-requisitos:
//   1. migração de escritórios aplicada (docs/multiescritorio) — sem ela a
//      conta demo enxergaria os dados reais, e o script se recusa a rodar;
//   2. uma conta criada pela tela "Criar conta → Novo escritório" com o nome
//      "Vertces Demonstração" (e e-mail confirmado).
//
// Uso:
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… DEMO_EMAIL=… DEMO_PASSWORD=… node scripts/seed-demo.mjs
import { createClient } from "@supabase/supabase-js";
import { NOME_TXT_DEMO, gerarTxtDemo } from "./demo/txt-demo.mjs";

const { SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_EMAIL, DEMO_PASSWORD } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !DEMO_EMAIL || !DEMO_PASSWORD) {
  console.error("Defina SUPABASE_URL, SUPABASE_ANON_KEY, DEMO_EMAIL e DEMO_PASSWORD.");
  process.exit(1);
}

const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const falhar = (msg) => { console.error(msg); process.exit(1); };
const ok = (r, oque) => { if (r.error) falhar(`${oque}: ${r.error.message}`); return r.data; };

const { data: login, error: eLogin } = await supa.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
if (eLogin) falhar(`login: ${eLogin.message}`);

// trava de segurança: só roda numa conta que é dona de um escritório NOVO
const esc = await supa.rpc("meu_escritorio");
if (esc.error) falhar("A migração de escritórios não está aplicada: a conta demo veria os dados reais. Abortado.");
const e = (esc.data ?? [])[0];
if (!e) falhar("A conta demo não pertence a nenhum escritório. Crie-a pela tela com 'Novo escritório'.");
if (e.modelos_compartilhados) falhar(`"${e.nome}" é o escritório que já usava o sistema (dados reais). Abortado.`);
console.log(`escritório: ${e.nome} (${e.id})`);

async function garantir(tabela, filtro, linha) {
  const [col, val] = Object.entries(filtro)[0];
  const achado = ok(await supa.from(tabela).select("id").eq(col, val).maybeSingle(), `${tabela} (busca)`);
  if (achado) return achado.id;
  return ok(await supa.from(tabela).insert(linha).select("id").single(), `${tabela} (insert)`).id;
}

const rtId = await garantir("responsaveis_tecnicos", { nome: "ANA DEMONSTRAÇÃO SOUZA" }, {
  nome: "ANA DEMONSTRAÇÃO SOUZA", formacao: "Técnica em Agrimensura",
  conselho_sigla: "CFT", conselho_numero: "00000000000", cpf: "000.000.000-00", trt: "DEMO-0001",
});
const credId = await garantir("credenciados", { prefixo_vertice: "DEMO" }, {
  nome: "ANA DEMONSTRAÇÃO SOUZA", prefixo_vertice: "DEMO", contador_m: 0, contador_p: 0, contador_v: 0,
});
const clienteId = await garantir("clientes", { nome: "JOSÉ EXEMPLO DA SILVA" }, {
  nome: "JOSÉ EXEMPLO DA SILVA", cpf_cnpj: "000.000.000-00", genero: "M",
  endereco: "Rua Fictícia, 100, Centro, Feira de Santana/BA", observacoes: "Cliente fictício da demonstração",
});

for (const [key, value] of Object.entries({
  razao_social: "VERTCES DEMONSTRAÇÃO", desenhista: "ANA DEMONSTRAÇÃO", rt_padrao: rtId, credenciado_padrao: credId,
})) {
  const tem = ok(await supa.from("config_empresa").select("key").eq("key", key).maybeSingle(), "config");
  ok(tem ? await supa.from("config_empresa").update({ value }).eq("key", key)
    : await supa.from("config_empresa").insert({ key, value }), `config ${key}`);
}

const existente = ok(await supa.from("servicos").select("id").eq("nome_arquivo_txt", NOME_TXT_DEMO).maybeSingle(), "serviço (busca)");
let servicoId = existente?.id;
if (!servicoId) {
  const resp = await fetch(`${SUPABASE_URL}/functions/v1/parse-txt`, {
    method: "POST",
    headers: { Authorization: `Bearer ${login.session.access_token}`, apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ nome_arquivo: NOME_TXT_DEMO, conteudo: gerarTxtDemo(), uf: "BA" }),
  });
  const corpo = await resp.json();
  if (!resp.ok) falhar(`parse-txt: ${corpo.erro ?? resp.status}`);
  servicoId = corpo.servico.id;
}
ok(await supa.from("servicos").update({
  cliente_id: clienteId, credenciado_id: credId, rt_id: rtId,
  detentor_nome: "JOSÉ EXEMPLO DA SILVA", detentor_cpf: "000.000.000-00", detentor_genero: "M",
  denominacao: "FAZENDA BOA VISTA (DEMONSTRAÇÃO)", municipio: "Feira de Santana", uf: "BA",
  natureza_servico: "Particular", tipo_pessoa: "Física", situacao: "Imóvel Registrado", natureza_area: "Rural",
  matricula: "00.000",
}).eq("id", servicoId), "serviço (dados)");

console.log(`pronto: serviço ${servicoId} — abra #/servico/${servicoId} com a conta demo`);
