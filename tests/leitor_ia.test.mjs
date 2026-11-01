// IA intérprete: a cascata com a API simulada (sempre roda) e, quando houver
// OPENAI_API_KEY no .env, um teste AO VIVO com arquivos que as regras não
// resolvem sozinhas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import proj4 from "proj4";
import { interpretarComIA, montarPedido } from "../supabase/functions/_shared/leitor/ia.ts";
import { lerLinhas } from "../supabase/functions/_shared/leitor/index.ts";
import { abrir } from "../supabase/functions/_shared/leitor/abertura.ts";
import { camposVazios, APOIO_PADRAO } from "../supabase/functions/_shared/leitor/receita.ts";

// arquivo sem cabeçalho com σN, σE e σh: as regras não sabem qual é a vertical
const verdade = lerLinhas(abrir(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url))).linhas, { proj4 }).anel;
const linhasDificeis = verdade.map((p) => `${p.num} ${p.e.toFixed(3)} ${p.n.toFixed(3)} ${p.h.toFixed(3)} ${p.sigmaPos} ${p.sigmaPos} ${p.sigmaH}`);

const receitaBoa = {
  registro: "linha", pular_inicio: 0, ignorar: [], tokenizacao: "espacos", delimitador: null, colunas: 7, excedente_em: null,
  cortes: null, regex: null, decimal: ".", campos: { ...camposVazios(), nome: 0, e: 1, n: 2, h: 3, sigma_n: 4, sigma_e: 5, sigma_h: 6 },
  sistema: "utm", fuso: null, hemisferio: "S", unidade_sigma: "m", confianca_sigma: "1sigma", nome_formato: "texto", ordem: "auto",
  apoio: APOIO_PADRAO, explicacao: "Colunas por espaço: ponto, E, N, cota, σN, σE, σ vertical.", confianca: 0.9,
};

function apiFalsa(respostas) {
  const pedidos = [];
  const f = async (_url, init) => {
    const corpo = JSON.parse(init.body);
    pedidos.push(corpo);
    const r = respostas.shift();
    if (typeof r === "number") return new Response(JSON.stringify({ error: { message: r === 400 ? "json_schema is not supported for this model" : "invalid api key" } }), { status: r });
    const texto = typeof r === "string" ? r : JSON.stringify(r);
    return new Response(JSON.stringify({ output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: texto }] }], usage: { input_tokens: 3000, output_tokens: 800 } }), { status: 200 });
  };
  return { f, pedidos };
}

test("IA: regras em dúvida → receita da IA aprovada de primeira, com custo e confirmação do operador", async () => {
  const regras = lerLinhas(linhasDificeis, { proj4 });
  assert.notEqual(regras.confianca, "alta", "as regras não deveriam ter certeza aqui");
  const { f, pedidos } = apiFalsa([receitaBoa]);
  const r = await interpretarComIA(linhasDificeis, "pontos.txt", proj4, { apiKey: "x", fetch: f }, { receita: regras.receita, duvidas: regras.duvidas });
  assert.equal(r.tentativas.length, 1);
  assert.ok(r.tentativas[0].aprovada);
  assert.equal(r.tentativas[0].modelo, "gpt-6-luna");
  assert.ok(Math.abs(r.tentativas[0].custoUsd - (3000 * 0.10 + 800 * 0.50) / 1e6) < 1e-12);
  assert.equal(r.leitura.anel.length, verdade.length);
  r.leitura.anel.forEach((p, i) => { assert.equal(p.e, verdade[i].e); assert.equal(p.n, verdade[i].n); assert.equal(p.sigmaH, verdade[i].sigmaH); });
  assert.ok(r.leitura.aConfirmar.includes("receita_ia"));
  // o pedido leva só uma AMOSTRA e o esquema estrito
  assert.equal(pedidos[0].text.format.type, "json_schema");
  assert.equal(pedidos[0].text.format.strict, true);
  assert.ok(pedidos[0].input[1].content.split("\n").filter((l) => /^\d+\| /.test(l)).length <= 70);
});

test("IA: receita reprovada volta com o motivo e a segunda tentativa corrige", async () => {
  const trocada = { ...receitaBoa, campos: { ...receitaBoa.campos, e: 2, n: 1 } };
  const { f, pedidos } = apiFalsa([trocada, receitaBoa]);
  const r = await interpretarComIA(linhasDificeis, "pontos.txt", proj4, { apiKey: "x", fetch: f }, null);
  assert.equal(r.tentativas.length, 2);
  assert.equal(r.tentativas[0].aprovada, false);
  assert.match(r.tentativas[0].motivo, /fora dos limites/);
  assert.match(pedidos[1].input[1].content, /REPROVADA[\s\S]*fora dos limites/);
  assert.ok(r.tentativas[1].aprovada);
  assert.equal(r.leitura.anel[0].e, verdade[0].e);
});

test("IA: JSON inválido e regex perigosa são recusados; o modelo forte é a última tentativa", async () => {
  const perigosa = { ...receitaBoa, tokenizacao: "regex", regex: "^(?<nome>(\\d+)+) (?<e>\\S+) (?<n>\\S+)$" };
  const { f, pedidos } = apiFalsa(["{nao é json", perigosa, receitaBoa]);
  const r = await interpretarComIA(linhasDificeis, "pontos.txt", proj4, { apiKey: "x", fetch: f }, null);
  assert.deepEqual(r.tentativas.map((t) => t.modelo), ["gpt-6-luna", "gpt-6-luna", "gpt-6.1-sol"]);
  assert.match(r.tentativas[0].motivo, /JSON inválido/);
  assert.match(r.tentativas[1].motivo, /recusada/);
  assert.ok(r.tentativas[2].aprovada);
  assert.equal(pedidos[2].model, "gpt-6.1-sol");
});

test("IA: modelo sem esquema estrito cai para json_object; chave inválida para na hora", async () => {
  const a = apiFalsa([400, 400, receitaBoa]);
  const r = await interpretarComIA(linhasDificeis, "p.txt", proj4, { apiKey: "x", fetch: a.f }, null);
  assert.equal(a.pedidos[2].text.format.type, "json_object");
  assert.ok(r.leitura && r.tentativas[0].aprovada);
  const b = apiFalsa([401, receitaBoa, receitaBoa]);
  const r2 = await interpretarComIA(linhasDificeis, "p.txt", proj4, { apiKey: "x", fetch: b.f }, null);
  assert.equal(r2.tentativas.length, 1);
  assert.match(r2.erro, /401/);
  assert.equal(r2.leitura, null);
});

test("pedido à IA: amostra numerada com omissões marcadas e a pista das regras", () => {
  const muitas = Array.from({ length: 300 }, (_, i) => `${i + 1} 500000.${i} 8700000.${i} 300 0.01 0.01 0.02`);
  const p = montarPedido(muitas, "x.txt", null, null);
  assert.match(p.entrada, /^1\| /m);
  assert.match(p.entrada, /^300\| /m);
  assert.match(p.entrada, /omitida/);
  assert.match(p.instrucoes, /NUNCA copia nem calcula coordenadas/);
});

// ---------------------------------------------------------------- AO VIVO
function chave() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  const env = new URL("../.env", import.meta.url);
  if (!existsSync(env)) return null;
  const m = readFileSync(env, "utf8").match(/^OPENAI_API_KEY\s*=\s*"?([^"\r\n]+)"?/m);
  return m ? m[1].trim() : null;
}
const KEY = chave();

test("conferência da IA: número do ponto posto no 'código' é reprovado e volta explicado", async () => {
  const comPrefixo = verdade.map((p) => `CP,${p.num * 3 + 100},${p.n.toFixed(3)},${p.e.toFixed(3)},${p.h.toFixed(3)},${p.sigmaPos},${p.sigmaH}`);
  const errada = { ...receitaBoa, tokenizacao: "delimitado", delimitador: ",", colunas: 7, campos: { ...camposVazios(), codigo: 1, n: 2, e: 3, h: 4, sigma_pos: 5, sigma_h: 6 }, nome_formato: "texto" };
  const certa = { ...errada, campos: { ...errada.campos, codigo: null, nome: 1 } };
  const { f, pedidos } = apiFalsa([errada, certa]);
  const r = await interpretarComIA(comPrefixo, "cp.txt", proj4, { apiKey: "x", fetch: f }, null);
  assert.equal(r.tentativas[0].aprovada, false);
  assert.match(r.tentativas[0].motivo, /identificador do ponto/);
  assert.match(pedidos[1].input[1].content, /Como a sua receita leu as primeiras linhas/);
  assert.ok(r.tentativas[1].aprovada);
  assert.equal(r.leitura.anel[0].num, verdade[0].num * 3 + 100);
  assert.ok(r.leitura.anel.every((p) => !p.numSintetico));
});

test("conferência da IA: σ no lugar errado (coluna numérica sobrando) é reprovado, não vira 'arquivo sem σ'", async () => {
  const sigmaTrocado = { ...receitaBoa, campos: { ...receitaBoa.campos, sigma_n: null, sigma_e: null, sigma_pos: 6, sigma_h: null } };
  const { f, pedidos } = apiFalsa([sigmaTrocado, receitaBoa]);
  const r = await interpretarComIA(linhasDificeis, "p.txt", proj4, { apiKey: "x", fetch: f }, null);
  assert.equal(r.tentativas[0].aprovada, false);
  assert.match(r.tentativas[0].motivo, /coluna\(s\) numérica\(s\) sem papel: coluna 4/);
  assert.match(pedidos[1].input[1].content, /sem papel/);
  assert.ok(r.tentativas[1].aprovada);
  assert.equal(r.leitura.anel[0].sigmaH, verdade[0].sigmaH);
});

test("IA: regex no estilo de outras linguagens ((?i), /x/i) é normalizada, não reprovada", async () => {
  const comFlags = { ...receitaBoa, apoio: ["(?i)^base", "/rtcm/i"], ignorar: ["(?i)^#"] };
  const { f } = apiFalsa([comFlags]);
  const r = await interpretarComIA(linhasDificeis, "p.txt", proj4, { apiKey: "x", fetch: f }, null);
  assert.ok(r.tentativas[0].aprovada, r.tentativas[0].motivo);
  assert.deepEqual(r.leitura.receita.apoio, ["^base", "rtcm"]);
});

test("AO VIVO: a IA de verdade lê formatos que as regras não resolvem", { skip: (!KEY && "sem OPENAI_API_KEY no .env") || (!process.env.IA_AO_VIVO && "só em npm run test:ia"), timeout: 900_000 }, async () => {
  // números NÃO sequenciais: um número perdido não se disfarça de sequência
  const pts = verdade.map((p) => ({ ...p, num: p.num * 3 + 100 }));
  const casos = {
    "sem cabeçalho, σN σE σh": pts.map((p) => `${p.num} ${p.e.toFixed(3)} ${p.n.toFixed(3)} ${p.h.toFixed(3)} ${p.sigmaPos} ${p.sigmaPos} ${p.sigmaH}`),
    "colunas fixas sem separador": pts.map((p) => `${String(p.num).padStart(5)}${p.e.toFixed(3).padStart(12)}${p.n.toFixed(3).padStart(13)}${p.h.toFixed(3).padStart(9)}${p.sigmaPos.toFixed(4).padStart(8)}${p.sigmaH.toFixed(4).padStart(8)}`),
    "Nikon-like CP registros": ["CO,Projeto Fazenda", "CO,Unidades: metros", ...pts.flatMap((p) => [`CP,${p.num},${p.n.toFixed(3)},${p.e.toFixed(3)},${p.h.toFixed(3)},MARCO,${p.sigmaPos},${p.sigmaH}`, `SS,${p.num},1.800,0.0000,90.0000,10.000`])],
    "relatório com rótulos por linha": ["RELATORIO DE PONTOS - FAZENDA BOA VISTA", "Sistema: SIRGAS2000 UTM 24S", "", ...pts.map((p) => `Ponto ${p.num}  Este=${p.e.toFixed(3)}m  Norte=${p.n.toFixed(3)}m  Elev=${p.h.toFixed(3)}m  PrecH=${(p.sigmaPos * 100).toFixed(2)}cm  PrecV=${(p.sigmaH * 100).toFixed(2)}cm`), "", "Fim do relatório"],
  };
  for (const [nome, linhas] of Object.entries(casos)) {
    const regras = lerLinhas(linhas, { proj4 });
    const r = await interpretarComIA(linhas, `${nome}.txt`, proj4, { apiKey: KEY, timeoutMs: 180_000 }, regras ? { receita: regras.receita, duvidas: regras.duvidas } : null);
    console.log(`\n[IA ao vivo] ${nome}:`, r.tentativas.map((t) => `${t.modelo} #${t.tentativa} ${t.aprovada ? "APROVADA" : "reprovada"} ${t.ms} ms US$ ${t.custoUsd?.toFixed(5)} — ${t.motivo.slice(0, 160)}`).join(" | "), "\n   explicação:", r.leitura?.receita.explicacao);
    assert.ok(r.leitura, `${nome}: sem leitura (${r.erro})`);
    assert.ok(r.tentativas.some((t) => t.aprovada), `${nome}: nenhuma receita aprovada`);
    const final = r.tentativas.some((t) => t.aprovada) ? r.leitura : null;
    assert.equal(final.anel.length, pts.length, `${nome}: nº de pontos`);
    assert.ok(final.anel.every((p) => !p.numSintetico), `${nome}: o número real dos pontos se perdeu`);
    const porNum = new Map(pts.map((p) => [p.num, p]));
    for (const p of final.anel) {
      const v = porNum.get(p.num);
      assert.ok(v, `${nome}: ponto ${p.nome}`);
      assert.equal(p.e, v.e); assert.equal(p.n, v.n); assert.equal(p.h, v.h);
      assert.ok(Math.abs(p.sigmaPos - v.sigmaPos) < 1e-9 && Math.abs(p.sigmaH - v.sigmaH) < 1e-9, `${nome}: σ do ponto ${p.num}: ${p.sigmaPos}/${p.sigmaH} ≠ ${v.sigmaPos}/${v.sigmaH}`);
    }
  }
});
