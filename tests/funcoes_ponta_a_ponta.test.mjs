// Ponta a ponta: as Edge Functions REAIS (ler-arquivo e parse-txt) rodando no
// Node, com um Supabase falso em memória (tests/funcoes/). Prova o fluxo que o
// operador vai viver: enviar → prévia → confirmar → serviço criado → formato
// aprendido → próximo arquivo igual entra sozinho.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
import proj4 from "proj4";

register("./funcoes/ganchos.mjs", import.meta.url);
const { bancoNovo } = await import("./funcoes/supabase-falso.mjs");
const { lerLinhas } = await import("../supabase/functions/_shared/leitor/index.ts");
const { abrir } = await import("../supabase/functions/_shared/leitor/abertura.ts");
const { camposVazios, APOIO_PADRAO } = await import("../supabase/functions/_shared/leitor/receita.ts");

const env = { SUPABASE_URL: "http://falso", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service" };
let capturado;
globalThis.Deno = { serve: (h) => { capturado = h; }, env: { get: (k) => env[k] } };
await import("../supabase/functions/ler-arquivo/index.ts");
const lerArquivo = capturado;
await import("../supabase/functions/parse-txt/index.ts");
const parseTxt = capturado;

const b64 = (x) => Buffer.from(typeof x === "string" ? new TextEncoder().encode(x) : x).toString("base64");
async function chamar(h, corpo) {
  const r = await h(new Request("http://funcao", { method: "POST", headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
  return { status: r.status, corpo: await r.json() };
}
/** O que a tela faz: ler-arquivo → prévia → parse-txt com a receita confirmada. */
async function enviar(nome, bytes, { confirmar = true, extra = {} } = {}) {
  const lida = await chamar(lerArquivo, { nome_arquivo: nome, arquivo_base64: b64(bytes) });
  assert.equal(lida.status, 200, JSON.stringify(lida.corpo));
  const previa = lerLinhas(lida.corpo.linhas, { proj4 }); // só para saber os avisos que a tela pediria
  const { executarReceita } = await import("../supabase/functions/_shared/leitor/index.ts");
  const local = executarReceita(lida.corpo.linhas, lida.corpo.receita, { proj4, ...(extra.sigma_padrao ? { sigmaPadrao: extra.sigma_padrao } : {}) });
  void previa;
  const criado = await chamar(parseTxt, {
    nome_arquivo: nome, arquivo_base64: b64(bytes), uf: "BA",
    leitura: { receita: lida.corpo.receita, confirmados: confirmar ? local.aConfirmar : [], ...extra },
  });
  return { lida: lida.corpo, local, criado };
}

const LARISSA = readFileSync(new URL("../reference/LARISSA.txt", import.meta.url));
const verdade = lerLinhas(abrir(LARISSA).linhas, { proj4 }).anel;
const emlid = (pts) => "Name,Code,Easting,Northing,Elevation,Easting RMS,Northing RMS,Elevation RMS\n" +
  pts.map((p) => `${p.num},,${p.e.toFixed(3)},${p.n.toFixed(3)},${p.h.toFixed(3)},${p.sigmaPos},${p.sigmaPos},${p.sigmaH}`).join("\n") + "\n";

test("formato da equipe: lido sem IA, serviço criado com procedência, original guardado byte a byte", async () => {
  const banco = bancoNovo();
  const { lida, criado } = await enviar("LARISSA.txt", LARISSA);
  assert.equal(lida.receita.origem, "padrao");
  assert.equal(lida.confianca, "alta");
  assert.equal(lida.ia.usada, false);
  assert.equal(criado.status, 200, JSON.stringify(criado.corpo));
  const sid = criado.corpo.servico.id;
  const verts = banco.tabelas.vertices.filter((v) => v.servico_id === sid);
  assert.equal(verts.length, 69);
  assert.equal(verts[0].nome_txt, "1");
  assert.equal(verts[0].linha_txt, 1);
  assert.deepEqual([...banco.storage[`uploads-txt/${sid}/LARISSA.txt`]], [...LARISSA], "o original fica idêntico");
  const lj = JSON.parse(new TextDecoder().decode(banco.storage[`uploads-txt/${sid}/leitura.json`]));
  assert.equal(lj.anel.length, 69);
  assert.equal(lj.receita.origem, "padrao");
  assert.equal(banco.tabelas.leituras_arquivo.length, 1);
  assert.equal((banco.tabelas.perfis_leitura ?? []).length, 0, "o formato padrão não precisa de perfil");
});

test("formato novo (Emlid): lido pelas regras, vira perfil; o segundo arquivo entra pelo perfil", async () => {
  const banco = bancoNovo();
  const a = await enviar("emlid-1.csv", emlid(verdade));
  assert.equal(a.lida.receita.origem, "regras");
  assert.equal(a.criado.status, 200, JSON.stringify(a.criado.corpo));
  assert.equal(banco.tabelas.perfis_leitura.length, 1);
  const perfil = banco.tabelas.perfis_leitura[0];
  assert.equal(perfil.escritorio_id, "esc-1");
  assert.equal(perfil.usos, 1);
  // outro levantamento, mesmo aparelho/configuração
  const outros = verdade.slice(0, 30).map((p) => ({ ...p, e: p.e + 1000, n: p.n - 500 }));
  const b = await enviar("emlid-2.csv", emlid(outros));
  assert.equal(b.lida.receita.origem, `perfil:${perfil.id}`);
  assert.deepEqual(b.lida.perfil, { id: perfil.id, nome: perfil.nome });
  assert.equal(b.criado.status, 200);
  assert.equal(banco.tabelas.perfis_leitura[0].usos, 2);
  assert.equal(banco.tabelas.leituras_arquivo[1].perfil_id, perfil.id);
});

test("ordem do arquivo: sem a confirmação o serviço NÃO nasce; confirmando, nasce na ordem certa", async () => {
  bancoNovo();
  const quadrado = "1;500000;8700000;300,1;0,01;0,02\n3;500100;8700000;300,1;0,01;0,02\n2;500100;8700100;300,1;0,01;0,02\n4;500000;8700100;300,1;0,01;0,02\n";
  const sem = await enviar("cruza.txt", quadrado, { confirmar: false });
  assert.equal(sem.criado.status, 422);
  assert.deepEqual(sem.criado.corpo.faltam, ["ordem_do_arquivo"]);
  const com = await enviar("cruza.txt", quadrado);
  assert.equal(com.criado.status, 200, JSON.stringify(com.criado.corpo));
  assert.deepEqual(com.criado.corpo.vertices.map((v) => v.num_txt).sort((a, b) => a - b), [1, 2, 3, 4]);
  const anel = JSON.parse(new TextDecoder().decode(globalThis.__banco.storage[`uploads-txt/${com.criado.corpo.servico.id}/leitura.json`])).anel.map((p) => p.num);
  assert.deepEqual(anel, [1, 3, 2, 4]);
});

test("arquivo sem σ: bloqueado até a precisão ser declarada na prévia", async () => {
  bancoNovo();
  const semSigma = "P1,500000.000,8700000.000,300.000\nP2,500100.000,8700000.000,300.000\nP3,500100.000,8700100.000,300.000\nP4,500000.000,8700100.000,300.000\n";
  const sem = await enviar("sem-sigma.csv", semSigma);
  assert.equal(sem.criado.status, 422);
  assert.match(sem.criado.corpo.erro, /precisões|precisão/);
  const com = await enviar("sem-sigma.csv", semSigma, { extra: { sigma_padrao: { pos: 0.05, h: 0.08 } } });
  assert.equal(com.criado.status, 200, JSON.stringify(com.criado.corpo));
  assert.ok(com.criado.corpo.vertices.every((v) => Number(v.sigma_pos) === 0.05));
});

test("sem chave da IA: formato duvidoso volta para o operador com o motivo (nunca grava calado)", async () => {
  bancoNovo();
  const dificil = verdade.map((p) => `${p.num} ${p.e.toFixed(3)} ${p.n.toFixed(3)} ${p.h.toFixed(3)} ${p.sigmaPos} ${p.sigmaPos} ${p.sigmaH}`).join("\n");
  const r = await chamar(lerArquivo, { nome_arquivo: "dificil.txt", arquivo_base64: b64(dificil) });
  assert.equal(r.status, 200);
  assert.notEqual(r.corpo.confianca, "alta");
  assert.equal(r.corpo.ia.usada, false);
  assert.equal(r.corpo.ia.motivo, "IA não configurada no servidor");
});

test("com IA: chama a OpenAI, registra o custo, exige confirmação, aprende — o 2º arquivo não chama a IA", async () => {
  const banco = bancoNovo();
  env.OPENAI_API_KEY = "sk-teste";
  const receita = {
    registro: "linha", pular_inicio: 0, ignorar: [], tokenizacao: "espacos", delimitador: null, colunas: 7, excedente_em: null, cortes: null, regex: null,
    decimal: ".", campos: { ...camposVazios(), nome: 0, e: 1, n: 2, h: 3, sigma_n: 4, sigma_e: 5, sigma_h: 6 }, sistema: "utm", fuso: null, hemisferio: "S",
    unidade_sigma: "m", confianca_sigma: "1sigma", nome_formato: "texto", ordem: "auto", apoio: APOIO_PADRAO, explicacao: "Ponto, E, N, cota, σN, σE, σ vertical.", confianca: 0.9,
  };
  let chamadasOpenAI = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("openai")) {
      chamadasOpenAI++;
      assert.match(init.headers.Authorization, /sk-teste/);
      return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(receita) }] }], usage: { input_tokens: 2500, output_tokens: 600 } }));
    }
    return fetchOriginal(url, init);
  };
  try {
    const linha = (pts) => pts.map((p) => `${p.num} ${p.e.toFixed(3)} ${p.n.toFixed(3)} ${p.h.toFixed(3)} ${p.sigmaPos} ${p.sigmaPos} ${p.sigmaH}`).join("\n");
    const a = await enviar("dificil-1.txt", linha(verdade), { confirmar: false });
    assert.equal(chamadasOpenAI, 1);
    assert.equal(a.lida.ia.usada, true);
    assert.equal(a.lida.receita.origem, "ia:gpt-6-luna");
    assert.equal(banco.tabelas.chamadas_ia.length, 1);
    assert.ok(Math.abs(banco.tabelas.chamadas_ia[0].custo_usd - (2500 * 0.1 + 600 * 0.5) / 1e6) < 1e-12);
    assert.equal(a.criado.status, 422, "receita da IA exige o clique do operador");
    assert.ok(a.criado.corpo.faltam.includes("receita_ia"));
    const ok = await chamar(parseTxt, { nome_arquivo: "dificil-1.txt", arquivo_base64: b64(linha(verdade)), uf: "BA", leitura: { receita: a.lida.receita, confirmados: a.local.aConfirmar } });
    assert.equal(ok.status, 200, JSON.stringify(ok.corpo));
    assert.equal(ok.corpo.vertices.length, 69);
    assert.equal(banco.tabelas.perfis_leitura[0].origem, "ia");
    // mesmo aparelho, outro levantamento: perfil, sem IA
    const b = await chamar(lerArquivo, { nome_arquivo: "dificil-2.txt", arquivo_base64: b64(linha(verdade.slice(10))) });
    assert.equal(b.corpo.receita.origem, `perfil:${banco.tabelas.perfis_leitura[0].id}`);
    assert.equal(b.corpo.confianca, "alta");
    assert.equal(chamadasOpenAI, 1, "o segundo arquivo não chamou a IA");
  } finally {
    globalThis.fetch = fetchOriginal;
    delete env.OPENAI_API_KEY;
  }
});

test("binário de aparelho: orientação de exportação e o arquivo guardado para análise", async () => {
  const banco = bancoNovo();
  const bin = new Uint8Array(3000).map((_, i) => (i * 13) % 256);
  const r = await chamar(lerArquivo, { nome_arquivo: "campo.dbx", arquivo_base64: b64(bin) });
  assert.equal(r.corpo.ok, false);
  assert.match(r.corpo.binario.orientacao, /Export/);
  assert.equal(banco.tabelas.arquivos_recusados.length, 1);
  assert.ok(Object.keys(banco.storage).some((k) => k.startsWith("uploads-recusados/esc-1/")));
});

test("cliente antigo (só o texto): continua funcionando igual", async () => {
  const banco = bancoNovo();
  const r = await chamar(parseTxt, { nome_arquivo: "LARISSA.txt", conteudo: LARISSA.toString("utf8"), uf: "BA" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.vertices.length, 69);
  assert.equal(r.corpo.preview.fuso, 24);
  assert.equal(banco.tabelas.servicos.length, 1);
});

test("sem login: recusa antes de ler qualquer coisa", async () => {
  const banco = bancoNovo();
  banco.usuario = null;
  const r = await chamar(lerArquivo, { nome_arquivo: "x.txt", arquivo_base64: b64("1;2;3") });
  assert.equal(r.status, 401);
  const p = await chamar(parseTxt, { nome_arquivo: "x.txt", conteudo: "1;2;3" });
  assert.equal(p.status, 401);
});
