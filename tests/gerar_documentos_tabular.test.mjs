// gerar-documentos com `tabular: true`, ponta a ponta: a Edge Function REAL
// rodando no Node com o Supabase falso (tests/funcoes/) e os modelos de
// reference/ no "Storage". É o que os documentos de cada área da divisão pedem
// a cada serviço de área: memorial, planilha, planta E o Memorial Tabular.
//
// Prende: o tabular sai na MESMA versão, em v{n}/memorial-tabular.docx, no
// histórico como "Memorial Tabular (DOCX · dados do sistema)" e com URL na
// resposta; sem `tabular`, a geração é exatamente a de antes; sem modelo, aviso
// claro e o resto sai.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { ANEL } from "./fixtures/salgada_velha.mjs";
import { TIPO_TABULAR_SISTEMA, TITULO_TABULAR_SISTEMA, ultimaGeracao } from "../src/lib/historico.ts";
import { indexarDocumentos } from "../src/lib/progresso.ts";

register("./funcoes/ganchos.mjs", import.meta.url);
const { bancoNovo } = await import("./funcoes/supabase-falso.mjs");
const env = { SUPABASE_URL: "http://falso", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
let capturado;
globalThis.Deno = { serve: (h) => { capturado = h; }, env: { get: (k) => env[k] } };
await import("../supabase/functions/gerar-documentos/index.ts");
const gerarDocumentos = capturado;

const SID = "srv-area-desmembrada";
const PECAS = ["1-memorial-descritivo", "2-memorial-tabular", "3-cartas-anuencia", "4-declaracao-tecnico", "5-declaracao-proprietario", "6-requerimento", "7-declaracao-faixa-dominio"];

/** O serviço de uma área desmembrada, como a tela o cria (códigos do imóvel já nos vértices). */
function bancoDaArea() {
  const b = bancoNovo();
  b.rpc.conferir_contorno = { ok: true };
  b.tabelas.servicos = [{
    id: SID, tipo: "geo", modalidade: "completo", tem_glebas: false, status: "rascunho", divisao: null, origem_id: "srv-imovel",
    denominacao: "FAZENDA SALGADA VELHA - ÁREA DESMEMBRADA 01", detentor_nome: "MARIA COMPRADORA", detentor_cpf: "222.222.222-22",
    detentor_genero: "F", municipio: "ARACI", uf: "BA", fuso_utm: 24, credenciado_id: "c1", rt_id: "rt1",
    tipo_imovel: "matricula", matricula: "4.490", cns: "00.810-2", trt: "BR20260601082", vertice_inicial: 0,
  }];
  b.tabelas.vertices = ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
    id: `v${ordem}`, servico_id: SID, ordem, num_txt: ordem + 1, rotulo_txt: null, e, n, h: 360, sigma_pos: 0.01, sigma_h: 0.01,
    tipo, codigo, codigo_provisorio: false, metodo: "PG6", inserido_manual: false, lat_gms: "", lon_gms: "",
    descritivo: tipo === "M" ? (descritivo || `FAZENDA VIZINHA ${ordem}\\JOAO ${ordem}\\CPF:000.000.000-0${ordem % 10}`) : null,
    tipo_limite: tipo === "M" ? (tipoLimite ?? "LA1") : null, eh_via: tipoLimite === "LA3", cns: null, matricula: null,
    apelido_txt: null, numerado: false, exibir_planta: true,
  }));
  b.tabelas.credenciados = [{ id: "c1", nome: "CREDENCIADO", prefixo_vertice: "DSBN" }];
  b.tabelas.responsaveis_tecnicos = [{ id: "rt1", nome: "DANIEL NASCIMENTO SANTOS", formacao: "TÉCNICO EM AGRIMENSURA", conselho_sigla: "CFTA", conselho_numero: "0578839458-9", trt: "BR20260601082" }];
  // escritório legado (sem escritorio_id): os modelos da raiz de `templates`
  for (const arq of PECAS) b.storage[`templates/pecas/${arq}.docx`] = readFileSync(new URL(`../reference/pecas/${arq}.docx`, import.meta.url));
  b.storage["templates/planta-template.ods"] = readFileSync(new URL("../reference/PLANTA.ODS", import.meta.url));
  return b;
}

async function chamar(corpo) {
  const r = await gerarDocumentos(new Request("http://funcao", {
    method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify(corpo),
  }));
  return { status: r.status, corpo: await r.json() };
}
const textoDoDocx = async (bytes) => {
  const xml = await (await JSZip.loadAsync(bytes)).file("word/document.xml").async("string");
  return (xml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) ?? []).map((s) => s.replace(/<[^>]+>/g, "")).join(" ").replace(/\s+/g, " ");
};

test("gerar-documentos · tabular: true gera o Memorial Tabular na mesma versão, com URL e no histórico", async () => {
  const b = bancoDaArea();
  const r = await chamar({ servico_id: SID, folha: "A1", metragem: true, tabular: true });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const path = `${SID}/v1/memorial-tabular.docx`;
  assert.equal(r.corpo.tabular_docx, `http://falso/gerados/${path}`);
  assert.ok(r.corpo.memorial_docx && r.corpo.planilha_ods, "os de sempre também saíram");
  const linha = b.tabelas.documentos_gerados.find((d) => d.tipo === TIPO_TABULAR_SISTEMA);
  assert.ok(linha, "no histórico");
  assert.equal(linha.titulo, TITULO_TABULAR_SISTEMA);
  assert.equal(linha.versao, 1);
  assert.equal(linha.path, path);
  // a tela (e a lista das áreas) acha o tabular na última geração
  const ult = ultimaGeracao(b.tabelas.documentos_gerados);
  assert.equal(ult.documentos.versao, 1);
  assert.equal(ult.documentos.tabular.path, path);
  assert.equal(ult.tabular, null, "não é o tabular de prévia da conferência");
  // e o progresso do serviço da área não vira "peças prontas" por causa dele
  assert.deepEqual(indexarDocumentos(b.tabelas.documentos_gerados)[SID], { docs: true, planta: false, pecas: false });
  // o arquivo: vértice inicial e área do cálculo desta geração
  const texto = await textoDoDocx(b.storage[`gerados/${path}`]);
  assert.ok(texto.includes("MEMORIAL TABULAR"));
  assert.equal((texto.match(/DSBN-[MPV]-\d+/g) ?? [])[0], r.corpo.resumo.verticeInicial, "a tabela começa pelo vértice inicial");
  const areaFmt = r.corpo.resumo.areaHa.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4, useGrouping: false });
  assert.ok(texto.includes(`${areaFmt} HA`), `área ${areaFmt} HA no tabular`);
  assert.ok(texto.includes("MARIA COMPRADORA") && texto.includes("ÁREA DESMEMBRADA 01"), "no nome da adquirente, com a denominação da área");
});

test("gerar-documentos · sem `tabular` a geração é a de sempre (nem arquivo, nem histórico, nem campo na resposta)", async () => {
  const b = bancoDaArea();
  const r = await chamar({ servico_id: SID, folha: "A1" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.ok(!("tabular_docx" in r.corpo), "a resposta não ganhou campo");
  assert.deepEqual(b.tabelas.documentos_gerados.map((d) => d.tipo).sort(), ["memorial_docx", "planilha_ods", "planta_pdf_sistema"]);
  assert.ok(!Object.keys(b.storage).some((k) => k.startsWith("gerados/") && k.endsWith("memorial-tabular.docx")), "nenhum tabular gerado");
});

test("gerar-documentos · sem um dos modelos das peças o tabular não sai, com aviso claro — e o resto sai", async () => {
  const b = bancoDaArea();
  delete b.storage["templates/pecas/3-cartas-anuencia.docx"];
  const r = await chamar({ servico_id: SID, tabular: true });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.tabular_docx, null);
  assert.ok(r.corpo.avisos.some((a) => /Memorial tabular não saiu: o modelo pecas\/3-cartas-anuencia\.docx não está no Storage/.test(a)), r.corpo.avisos.join(" | "));
  assert.ok(r.corpo.memorial_docx && r.corpo.planilha_ods, "memorial e planilha saíram");
  assert.ok(!b.tabelas.documentos_gerados.some((d) => d.tipo === TIPO_TABULAR_SISTEMA));
});
