// Teste end-to-end (Fase 5): reproduz o serviço real do Anexo A via Edge
// Functions + banco, baixa os arquivos gerados e valida por leitura real.
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, E2E_EMAIL, E2E_PASSWORD
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.E2E_EMAIL ?? "e2e@rtkconverte.local";
const SENHA = process.env.E2E_PASSWORD ?? "E2e-teste-123!";
if (!URL_BASE || !ANON) { console.error("Defina SUPABASE_URL e SUPABASE_ANON_KEY"); process.exit(1); }

const supa = createClient(URL_BASE, ANON);
const falhas = [];
const ok = (cond, msg) => {
  console.log(`${cond ? "✔" : "✖"} ${msg}`);
  if (!cond) falhas.push(msg);
};

// ---------- login ----------
const { data: auth, error: eAuth } = await supa.auth.signInWithPassword({ email: EMAIL, password: SENHA });
if (eAuth) { console.error("login falhou:", eAuth.message); process.exit(1); }
const token = auth.session.access_token;
console.log("login ok:", auth.user.email);

async function fn(nome, body) {
  const resp = await fetch(`${URL_BASE}/functions/v1/${nome}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const dados = await resp.json();
  if (!resp.ok) throw new Error(`${nome} → ${resp.status}: ${JSON.stringify(dados)}`);
  return dados;
}

// ---------- credenciado + RT (contadores do Anexo A) ----------
await supa.from("credenciados").delete().eq("prefixo_vertice", "DSBN");
const { data: cred, error: eCred } = await supa.from("credenciados").insert({
  nome: "Credenciado Teste", prefixo_vertice: "DSBN", contador_m: 3605, contador_p: 13130, contador_v: 758,
}).select().single();
if (eCred) throw eCred;
const { data: rt } = await supa.from("responsaveis_tecnicos").insert({
  nome: "RESPONSAVEL TESTE", crea: "12345-D", trt: "000001", cpf: "111.111.111-11",
}).select().single();

// ---------- parse-txt ----------
const conteudo = readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8");
const parsed = await fn("parse-txt", { nome_arquivo: "LARISSA.txt", conteudo, uf: "BA" });
const sid = parsed.servico.id;
console.log("servico:", sid);
ok(parsed.preview.fuso === 24, `fuso detectado = 24 (obtido ${parsed.preview.fuso})`);
ok(parsed.vertices.length === 69, `69 vértices importados (${parsed.vertices.length})`);
ok(parsed.trechos.length === 5, `5 trechos sugeridos pelos rótulos (${parsed.trechos.length})`);
ok(Math.abs(parsed.preview.areaHa - 83.99) <= 0.011, `área preview ≈ 83,99 ha (${parsed.preview.areaHa.toFixed(4)})`);
ok(Math.abs(parsed.preview.perimetroM - 4075.9) <= 0.5, `perímetro preview ≈ 4.075,9 m (${parsed.preview.perimetroM.toFixed(2)})`);
const v30 = parsed.vertices.find((v) => v.num_txt === 30);
ok(v30.lat_gms === "11 23 44,344 S", `lat canônica do ponto 30 (${v30.lat_gms})`);
ok(v30.lon_gms === "39 5 04,736 W" || v30.lon_gms === "39 5 04,737 W", `lon canônica do ponto 30 (${v30.lon_gms})`);
ok(v30.tipo === "M", "ponto 30 sugerido como M");

// ---------- cadastro (Anexo A) ----------
const { error: eUpd } = await supa.from("servicos").update({
  credenciado_id: cred.id, rt_id: rt?.id,
  natureza_servico: "Particular", tipo_pessoa: "Física",
  detentor_nome: "TESTE DA SILVA", detentor_cpf: "000.000.000-00",
  denominacao: "FAZENDA TESTE", situacao: "Imóvel Registrado", natureza_area: "Particular",
  codigo_sncr: "000.000.000.000-0", cns: "00.803-7", matricula: "4490",
  municipio: "Araci", uf: "BA",
  parcela_numero: "001", lado: "Externo", denominacao_parcela: "Parte 1",
}).eq("id", sid);
if (eUpd) throw eUpd;

// ---------- trechos: descritivos, tipos, transição manual no 41 ----------
const DESC = {
  30: "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA\\ CARLOS MATOS DE LIMA\\ CPF:39752186572\\ DIVALDO JOSE MATOS DE LIMA\\ CPF:18024629534",
  36: "(POSSE) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  41: "(MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53",
  58: "(POSSE) FAZENDA PAU D'ÁGUA\\ VALDETE DOS SANTOS\\ CPF:161.770.455-53",
  64: "BA 408",
  9: "CORREDOR",
};
const LIM = { 30: "LA1", 36: "LA1", 41: "LA1", 58: "LA1", 64: "LA3", 9: "LA3" };
const ordemDe = (numTxt) => parsed.vertices.find((v) => v.num_txt === numTxt).ordem;
for (const t of parsed.trechos) {
  const numTxt = parsed.vertices.find((v) => v.ordem === t.vertice_inicio_ordem).num_txt;
  await supa.from("trechos_confrontantes").update({ descritivo: DESC[numTxt], tipo_limite: LIM[numTxt] }).eq("id", t.id);
}
// transição SEM rótulo no TXT (caso real): adicionar no ponto 41 + vértice vira M
await supa.from("trechos_confrontantes").insert({
  servico_id: sid, vertice_inicio_ordem: ordemDe(41), apelido_txt: "(manual)",
  descritivo: DESC[41], tipo_limite: LIM[41],
});
await supa.from("vertices").update({ tipo: "M" }).eq("servico_id", sid).eq("ordem", ordemDe(41));

// ---------- vértice V pré-existente entre TXT 68 e 69 ----------
const ordem69 = ordemDe(69); // = 68
// desloca 69 para frente (ordem decrescente p/ não violar unique)
const { data: desloc } = await supa.from("vertices").select("ordem").eq("servico_id", sid).gte("ordem", ordem69).order("ordem", { ascending: false });
for (const d of desloc) {
  await supa.from("vertices").update({ ordem: d.ordem + 1 }).eq("servico_id", sid).eq("ordem", d.ordem);
}
await supa.from("vertices").insert({
  servico_id: sid, ordem: ordem69, num_txt: null, tipo: "V", metodo: "PA1",
  codigo: "DSBN-V-0758", inserido_manual: true,
  lat_gms: "11 24 30,375 S", lon_gms: "39 4 47,198 W",
  h: 289.765, sigma_pos: 0, sigma_h: 0.02,
});

// ---------- vértice inicial do memorial = ponto 30 ----------
await supa.from("servicos").update({ vertice_inicial: ordemDe(30) }).eq("id", sid);

// ---------- geração ----------
const ger = await fn("gerar-documentos", { servico_id: sid });
console.log("resumo da geração:", JSON.stringify(ger.resumo));
ok(ger.ok === true, "geração retornou ok");
ok(ger.resumo.verticeInicial === "DSBN-M-3605", `vértice inicial ${ger.resumo.verticeInicial}`);
ok(ger.resumo.qtdM === 6 && ger.resumo.qtdP === 63 && ger.resumo.qtdV === 1, `contagem M/P/V = 6/63/1 (${ger.resumo.qtdM}/${ger.resumo.qtdP}/${ger.resumo.qtdV})`);
ok(Math.abs(ger.resumo.areaHa - 83.9886) <= 0.01, `área final ≈ 83,9886 ha (${ger.resumo.areaHa.toFixed(4)})`);
ok(Math.abs(ger.resumo.perimetroM - 4075.94) <= 0.5, `perímetro final ≈ 4.075,94 m (${ger.resumo.perimetroM.toFixed(2)})`);

// contadores incrementados na geração
const { data: credDepois } = await supa.from("credenciados").select().eq("id", cred.id).single();
ok(credDepois.contador_m === 3611 && credDepois.contador_p === 13193 && credDepois.contador_v === 758,
  `contadores após geração M=3611 P=13193 V=758 (${credDepois.contador_m}/${credDepois.contador_p}/${credDepois.contador_v})`);

// ---------- download + inspeção real dos arquivos ----------
const outDir = new URL("../tests/out/e2e/", import.meta.url);
mkdirSync(outDir, { recursive: true });
const docxBuf = Buffer.from(await (await fetch(ger.memorial_docx)).arrayBuffer());
const odsBuf = Buffer.from(await (await fetch(ger.planilha_ods)).arrayBuffer());
writeFileSync(new URL("memorial.docx", outDir), docxBuf);
writeFileSync(new URL("planilha.ods", outDir), odsBuf);
console.log(`arquivos baixados: memorial.docx (${docxBuf.length} b), planilha.ods (${odsBuf.length} b)`);

const docx = await JSZip.loadAsync(docxBuf);
const docXml = await docx.file("word/document.xml").async("string");
ok(docXml.includes("M E M O R I A L   D E S C R I T I V O  (GEO)"), "DOCX: título");
ok(docXml.includes("MC-39°W"), "DOCX: MC-39 (bug de 45° do legado corrigido)");
ok(!docXml.includes("-45°"), "DOCX: sem longitudes 45°");
ok(/129°46&apos;54&quot; por uma distância de 33,01m/.test(docXml), "DOCX: segmento 32→33 (129°46'54\" / 33,01 m)");
ok(/130°03&apos;37&quot; por uma distância de 43,37m/.test(docXml), "DOCX: segmento 33→34 (130°03'37\" / 43,37 m)");
ok(/130°14&apos;30&quot; por uma distância de 24,62m/.test(docXml), "DOCX: segmento 34→35 (130°14'30\" / 24,62 m)");
ok(docXml.includes("DSBN-V-0758"), "DOCX: vértice V inserido presente");
ok((docXml.match(/Confrontante: _/g) ?? []).length === 6, "DOCX: 6 linhas de assinatura de confrontantes");

const ods = await JSZip.loadAsync(odsBuf);
const mime = await ods.file("mimetype").async("string");
ok(mime === "application/vnd.oasis.opendocument.spreadsheet", "ODS: mimetype preservado");
const xml = await ods.file("content.xml").async("string");
const abas = ["identificacao", "perimetro_1", "sobre", "parametros_controles", "parametros_vertice",
  "parametros_imovel_validacao", "parametros_vertice_validacao", "parametros_vertice_validacao_excecao"];
ok(abas.every((a) => xml.includes(`table:name="${a}"`)), "ODS: todas as 8 abas do template preservadas");
const nLinhas = (xml.match(/<table:table-cell table:style-name="ce106" office:value-type="string"/g) ?? []).length;
ok(nLinhas === 70, `ODS: 70 linhas de vértices (${nLinhas})`);
ok(xml.includes(">DSBN-M-3605</text:p>"), "ODS: DSBN-M-3605");
ok(/>39 5 04,73[67] W<\/text:p>/.test(xml), "ODS: long do ponto 30");
ok(xml.includes(">11 23 44,344 S</text:p>"), "ODS: lat do ponto 30");
ok(xml.includes(">DSBN-V-0758</text:p>") && xml.includes(">PA1</text:p>"), "ODS: vértice V com método PA1");
ok(xml.includes(">TESTE DA SILVA</text:p>") && xml.includes(">Araci-BA</text:p>"), "ODS: identificação preenchida");
ok(xml.includes(">CORREDOR</text:p>") && xml.includes(">LA3</text:p>"), "ODS: trecho LA3/CORREDOR");

// ---------- regeração: contadores NÃO devem re-incrementar ----------
const ger2 = await fn("gerar-documentos", { servico_id: sid });
const { data: credFinal } = await supa.from("credenciados").select().eq("id", cred.id).single();
ok(ger2.ok && credFinal.contador_m === 3611 && credFinal.contador_p === 13193,
  `regeração não re-incrementa contadores (${credFinal.contador_m}/${credFinal.contador_p})`);
const { data: servFinal } = await supa.from("servicos").select("status").eq("id", sid).single();
ok(servFinal.status === "gerado", `status do serviço = gerado (${servFinal.status})`);

console.log(falhas.length === 0 ? "\nE2E: TODOS OS TESTES PASSARAM" : `\nE2E: ${falhas.length} FALHAS`);
process.exit(falhas.length === 0 ? 0 : 1);
