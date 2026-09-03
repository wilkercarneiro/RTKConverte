// Smoke pós-reestruturação, contra a produção.
//
// Cria DOIS serviços descartáveis com o mesmo anel — um `completo`, um
// `conferencia` — gera os documentos dos dois, compara e apaga. Os testes
// unitários lacram o motor; isto lacra o que só aparece em runtime: as colunas
// novas, a leitura da tabela `glebas` e, principalmente, a RPC de contadores.
//
// Nenhum serviço real é tocado. Uso: node scripts/smoke_modalidades.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { ANEL } from "../tests/fixtures/salgada_velha.mjs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const URL_BASE = process.env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;

const supa = createClient(URL_BASE, ANON);
const { data: auth, error: eAuth } = await supa.auth.signInWithPassword({
  email: process.env.SMOKE_EMAIL ?? process.env.E2E_EMAIL,
  password: process.env.SMOKE_SENHA ?? process.env.E2E_PASSWORD,
});
if (eAuth) { console.error("login falhou:", eAuth.message); process.exit(1); }

const fn = async (nome, body) => {
  const r = await fetch(`${URL_BASE}/functions/v1/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${auth.session.access_token}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${nome} ${r.status}: ${JSON.stringify(d).slice(0, 500)}`);
  return d;
};

const { data: cred } = await supa.from("credenciados").select().limit(1).single();
const { data: rt } = await supa.from("responsaveis_tecnicos").select().limit(1).single();
const lerContadores = async () => {
  const { data } = await supa.from("credenciados").select("contador_m, contador_p, contador_v").eq("id", cred.id).single();
  return data;
};

const contadoresIniciais = await lerContadores();
// preenchido quando o teste do serviço completo roda, para a devolução saber
// exatamente o que esperar encontrar
let esperadoDepois = null;
const criados = [];
async function criarServico(modalidade, tem_glebas) {
  const { data: s, error } = await supa.from("servicos").insert({
    tipo: "geo", modalidade, tem_glebas, status: "rascunho",
    nome_arquivo_txt: "SMOKE.txt", fuso_utm: 24,
    credenciado_id: cred.id, rt_id: rt?.id ?? null,
    detentor_nome: "SMOKE TESTE", denominacao: "SMOKE SALGADA VELHA",
    municipio: "Araci", uf: "BA", tipo_imovel: "matricula",
  }).select().single();
  if (error) throw error;
  criados.push(s.id);
  const linhas = ANEL.map(([ordem, e, n, tipo, _cod, descritivo, tipoLimite]) => ({
    servico_id: s.id, ordem, num_txt: ordem + 1, e, n, h: 360,
    sigma_pos: 0.01, sigma_h: 0.01, tipo, metodo: "PG6",
    codigo: null, inserido_manual: false, lat_gms: "", lon_gms: "",
    descritivo: descritivo || null, tipo_limite: tipoLimite, eh_via: false,
  }));
  const { error: eV } = await supa.from("vertices").insert(linhas);
  if (eV) throw eV;
  return s.id;
}

try {
  console.log("== CONFERÊNCIA DE ÁREA (não pode consumir numeração) ==");
  const antesC = await lerContadores();
  const idConf = await criarServico("conferencia", false);
  const rc = await fn("gerar-documentos", { servico_id: idConf });
  const depoisC = await lerContadores();
  const { data: vc } = await supa.from("vertices").select("codigo").eq("servico_id", idConf).order("ordem").limit(2);
  console.log("  folha:", rc.folha, "| provisorio:", rc.provisorio, "| área:", rc.resumo.areaHa.toFixed(4));
  console.log("  códigos:", vc.map((v) => v.codigo).join(" "));
  console.log("  contadores:", JSON.stringify(antesC), "->", JSON.stringify(depoisC));
  if (JSON.stringify(antesC) !== JSON.stringify(depoisC)) throw new Error("FALHOU: conferência consumiu numeração oficial");
  if (rc.folha !== "A3") throw new Error(`FALHOU: conferência deveria sair em A3, veio ${rc.folha}`);
  // prévia numera P-1, P-2… — sem o prefixo do credenciado, que faria a peça
  // parecer oficial para quem a recebe (ver codigoConferencia em geo.ts)
  if (!vc.every((v) => /^[MPV]-\d+$/.test(v.codigo ?? ""))) {
    throw new Error(`FALHOU: códigos da prévia fora do formato TIPO-N: ${vc.map((v) => v.codigo).join(" ")}`);
  }
  if (vc.some((v) => (v.codigo ?? "").includes(cred.prefixo_vertice))) {
    throw new Error("FALHOU: o prefixo do credenciado vazou para a prévia");
  }

  // Não aborta o smoke: um problema aqui não invalida o que vem depois, e o
  // valor de um smoke é reportar TUDO que encontrou, não parar no primeiro.
  console.log("  Memorial Tabular sem PDF do SIGEF…");
  let falhas = 0;
  try {
    const tab = await fn("gerar-pecas", { servico_id: idConf, origem: "calculo", apenas: ["2"] });
    console.log("  peças:", tab.arquivos.map((a) => a.titulo).join(", "), "| vértices:", tab.resumo.vertices);
    if (tab.arquivos.length !== 1) throw new Error("deveria sair só o Memorial Tabular");
  } catch (e) {
    falhas++;
    console.error("  FALHOU (tabular):", e.message.slice(0, 200));
  }

  console.log("== SERVIÇO COMPLETO (tem de consumir e sair em A1) ==");
  const antesK = await lerContadores();
  const idComp = await criarServico("completo", false);
  const rk = await fn("gerar-documentos", { servico_id: idComp });
  const depoisK = await lerContadores();
  const { data: vk } = await supa.from("vertices").select("codigo").eq("servico_id", idComp).order("ordem").limit(2);
  console.log("  folha:", rk.folha, "| provisorio:", rk.provisorio, "| área:", rk.resumo.areaHa.toFixed(4));
  console.log("  códigos:", vk.map((v) => v.codigo).join(" "));
  console.log("  contadores:", JSON.stringify(antesK), "->", JSON.stringify(depoisK));
  if (rk.folha !== "A1") throw new Error(`FALHOU: completo deveria sair em A1, veio ${rk.folha}`);
  if (rk.provisorio) throw new Error("FALHOU: completo marcado como provisório");
  if (depoisK.contador_m !== antesK.contador_m + 4) throw new Error("FALHOU: completo não consumiu os 4 M");
  if (!vk.every((v) => v.codigo.startsWith(`${cred.prefixo_vertice}-`))) throw new Error("FALHOU: códigos não são oficiais");
  if (rc.resumo.areaHa.toFixed(4) !== rk.resumo.areaHa.toFixed(4)) throw new Error("FALHOU: a área mudou entre as modalidades");

  console.log("== SERVIÇO COM GLEBA (duas poligonais, duas abas na planilha) ==");
  try {
    const idGl = await criarServico("completo", true);
    // duas glebas montadas de vértices do próprio levantamento, como a tela faz
    const { data: vgs } = await supa.from("vertices").select("ordem, e, n").eq("servico_id", idGl).order("ordem");
    const anelDe = (idx) => idx.map((i) => [Number(vgs[i].e), Number(vgs[i].n)]);
    const { error: eG } = await supa.from("glebas").insert([
      { servico_id: idGl, ordem: 0, nome: "GLEBA 1", anel: anelDe([0, 1, 2, 3]) },
      { servico_id: idGl, ordem: 1, nome: "GLEBA 2", anel: anelDe([10, 11, 12, 13, 14]) },
    ]);
    if (eG) throw eG;

    const rg = await fn("gerar-documentos", { servico_id: idGl });
    console.log("  folha:", rg.folha, "| área do imóvel:", rg.resumo.areaHa.toFixed(4));

    // a planilha tem de sair com uma aba de perímetro por gleba
    const JSZip = (await import("jszip")).default;
    const ods = await (await fetch(rg.planilha_ods)).arrayBuffer();
    const xml = await (await JSZip.loadAsync(ods)).file("content.xml").async("string");
    const abas = [...xml.matchAll(/<table:table table:name="([^"]+)"/g)].map((m) => m[1])
      .filter((n) => n.startsWith("perimetro"));
    console.log("  abas de perímetro:", JSON.stringify(abas));
    if (abas.length !== 2) throw new Error(`esperava perimetro_1 e perimetro_2, veio ${JSON.stringify(abas)}`);
    if (!xml.includes("GLEBA 1") || !xml.includes("GLEBA 2")) throw new Error("as abas não nomeiam as glebas");
    if (!rg.planta_pdf) throw new Error("a planta com glebas não saiu");
    console.log("  planta com glebas gerada");
  } catch (e) {
    falhas++;
    console.error("  FALHOU (gleba):", e.message.slice(0, 250));
  }

  // O serviço com gleba TAMBÉM é `completo` e também passa pela RPC: a foto para
  // a devolução só pode ser tirada aqui, depois do último consumo. Tirada logo
  // após o serviço completo, ela ficava desatualizada e a devolução se recusava
  // a acontecer — o smoke queimava a numeração que se propunha a devolver.
  esperadoDepois = await lerContadores();

  if (falhas) {
    console.error(`\n${falhas} verificação(ões) falharam.`);
    process.exitCode = 1;
  } else {
    console.log("\nOK — conferência não queima numeração, completo continua consumindo, mesma geometria.");
  }
} finally {
  for (const id of criados) await supa.from("servicos").delete().eq("id", id);

  // DEVOLVE a numeração consumida pelo teste.
  //
  // O serviço 'completo' do smoke passa pela RPC alocar_contadores de verdade —
  // é isso que se está provando — e isso queima códigos do Anexo A que nenhum
  // imóvel vai usar. Só restaura se os contadores ainda estiverem exatamente
  // onde o teste os deixou: se algo real avançou no meio, o certo é não mexer.
  const agora = await lerContadores();
  const mexeuSo = JSON.stringify(agora) === JSON.stringify(esperadoDepois);
  if (esperadoDepois && mexeuSo) {
    await supa.from("credenciados").update(contadoresIniciais).eq("id", cred.id);
    console.log("numeração devolvida:", JSON.stringify(agora), "->", JSON.stringify(contadoresIniciais));
  } else if (JSON.stringify(agora) !== JSON.stringify(contadoresIniciais)) {
    // Não mexe por conta própria: pode ter havido geração real no meio. Mas diz
    // exatamente o que ficou para trás — número do Anexo A queimado em silêncio
    // é pior do que número queimado com aviso.
    console.warn("ATENÇÃO: a numeração do smoke NÃO foi devolvida automaticamente.");
    console.warn("  antes do smoke:", JSON.stringify(contadoresIniciais));
    console.warn("  agora:         ", JSON.stringify(agora));
    console.warn(`  para devolver à mão: update credenciados set contador_m=${contadoresIniciais.contador_m}, ` +
      `contador_p=${contadoresIniciais.contador_p}, contador_v=${contadoresIniciais.contador_v} where id='${cred.id}';`);
  }
  console.log(`limpeza: ${criados.length} serviço(s) de teste removidos`);
}
