// Leitor universal — versões dos mesmos pontos no mesmo arquivo.
//
// Caso real (EDILSON, 2026-11-01): o arquivo trazia o levantamento (1…16, com os
// rótulos dos marcos) e, embaixo, os mesmos marcos pós-processados com o
// prefixo "postp_" — só 12 deles e a ~216 m de distância. O leitor somava os 28
// num perímetro só: desenho cruzado, 8,6 ha em vez de 4,2 ha, sem conserto
// depois de criado o serviço. Regra: entra UMA versão inteira (a mais completa;
// empate → a de melhor σ); o operador pode trocar ou pedir "não separar".
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import proj4 from "proj4";
import { abrir } from "../supabase/functions/_shared/leitor/abertura.ts";
import { executarReceita, lerLinhas } from "../supabase/functions/_shared/leitor/index.ts";
import { VERSAO_TODAS } from "../supabase/functions/_shared/leitor/versoes.ts";
import { areaM2 } from "../supabase/functions/_shared/leitor/ordem.ts";

const op = { proj4 };
const fmt = (x, d = 3) => x.toFixed(d).replace(".", ",");

// polígono sintético de 16 pontos (sem dado de cliente): um "leque" irregular
function levantamento() {
  const pts = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 2 * Math.PI;
    const r = 120 + 25 * Math.sin(3 * a) + 10 * Math.cos(5 * a);
    pts.push({ num: i + 1, e: 500000 + r * Math.cos(a), n: 8700000 + r * Math.sin(a), h: 250 - i });
  }
  return pts;
}
const ROTULOS = new Map([[3, "ana/bruno"], [4, "bruno/estrada"], [16, "estrada/"]]);
const linha = (nome, p, s) => `${nome};${fmt(p.e)};${fmt(p.n)};${fmt(p.h)};${fmt(s, 6)};${fmt(s * 1.8, 6)}`;

/** Levantamento + versão "postp_" deslocada (dx, dy), só com os números `nosPostp`. */
function arquivo({ nosPostp, dx = -145.6, dy = 159.2, sigmaLev = 0.012, sigmaPost = 0.11 }) {
  const lev = levantamento();
  const out = lev.map((p) => linha(`${p.num}${ROTULOS.get(p.num) ?? ""}`, p, sigmaLev));
  out.push(linha("postp_RTCM-Ref 1", { e: 500050, n: 8699500, h: 320 }, 0.4));
  for (const p of lev) {
    if (!nosPostp.includes(p.num)) continue;
    const ruido = ((p.num * 37) % 7 - 3) * 0.3; // a outra solução não é uma cópia exata
    out.push(linha(`postp_${p.num}${ROTULOS.get(p.num) ?? ""}`, { e: p.e + dx + ruido, n: p.n + dy - ruido, h: p.h + 42 }, sigmaPost));
  }
  return out;
}
const INCOMPLETA = [1, 2, 3, 4, 5, 7, 8, 9, 10, 12, 15, 16]; // como no arquivo real: sem 6, 11, 13, 14
const TODOS = Array.from({ length: 16 }, (_, i) => i + 1);

test("versões: o levantamento completo entra; o 'postp_' incompleto fica de fora (nunca mistura)", () => {
  const l = lerLinhas(arquivo({ nosPostp: INCOMPLETA }), op);
  assert.ok(l, "leu");
  assert.equal(l.receita.origem, "padrao");
  assert.deepEqual(l.anel.map((p) => p.num), TODOS);
  assert.ok(l.anel.every((p) => !p.nome.startsWith("postp_")));
  assert.equal(l.anel.find((p) => p.num === 3).rotulo, "ana/bruno");
  assert.equal(l.anel.find((p) => p.num === 16).rotulo, "estrada/");
  assert.equal(l.ignoradas.filter((i) => i.tipo === "versao").length, 12);
  assert.ok(!l.avisos.some((a) => a.codigo === "desenho_cruza"), "o desenho não cruza");
  assert.deepEqual(l.versoes.versoes.map((v) => [v.chave, v.numeros.length]), [["", 16], ["postp_", 12]]);
  assert.deepEqual(l.versoes.versoes[1].faltam, [6, 11, 13, 14]);
  assert.equal(l.versoes.escolhida, "");
  assert.ok(Math.abs(l.versoes.distanciaMediana - 215.6) < 2, `distância ${l.versoes.distanciaMediana}`);
  assert.ok(l.aConfirmar.includes("versoes"), "a escolha pede o 'conferi'");
  assert.ok(l.aConfirmar.includes("apoio_fora"));
  const aviso = l.avisos.find((a) => a.codigo === "versoes").mensagem;
  assert.match(aviso, /o levantamento \(16 pontos\) e “postp_” \(12 pontos, sem os pontos 6, 11, 13 e 14\)/);
  assert.match(aviso, /a do levantamento, que é a mais completa/);
});

test("versões: o operador escolhe o 'postp_' — números e rótulos vêm do nome sem o prefixo", () => {
  const linhas = arquivo({ nosPostp: INCOMPLETA });
  const auto = lerLinhas(linhas, op);
  const l = executarReceita(linhas, auto.receita, { ...op, versao: "postp_" });
  assert.deepEqual(l.anel.map((p) => p.num), INCOMPLETA);
  assert.ok(l.anel.every((p) => p.nome.startsWith("postp_")), "o nome original fica (procedência)");
  assert.equal(l.anel.find((p) => p.num === 4).rotulo, "bruno/estrada");
  assert.ok(l.anel.every((p) => !p.numSintetico));
  assert.ok(l.aConfirmar.includes("versao_incompleta"));
  assert.match(l.avisos.find((a) => a.codigo === "versao_incompleta").mensagem, /6, 11, 13 e 14/);
});

test("versões: as duas completas — vence a de melhor precisão", () => {
  const linhas = arquivo({ nosPostp: TODOS, sigmaLev: 0.25, sigmaPost: 0.008 });
  const l = lerLinhas(linhas, op);
  assert.equal(l.versoes.escolhida, "postp_");
  assert.deepEqual(l.anel.map((p) => p.num), TODOS);
  assert.match(l.avisos.find((a) => a.codigo === "versoes").mensagem, /melhor precisão/);
  // empate de σ → o levantamento
  const empate = lerLinhas(arquivo({ nosPostp: TODOS, sigmaLev: 0.02, sigmaPost: 0.02 }), op);
  assert.equal(empate.versoes.escolhida, "");
});

test("versões: 'não separar' devolve o comportamento antigo (todos os pontos), com alerta", () => {
  const linhas = arquivo({ nosPostp: INCOMPLETA });
  const auto = lerLinhas(linhas, op);
  const l = executarReceita(linhas, auto.receita, { ...op, versao: VERSAO_TODAS });
  assert.equal(l.anel.length, 28);
  assert.equal(l.versoes.escolhida, VERSAO_TODAS);
  assert.ok(l.aConfirmar.includes("versoes"));
});

test("versões: sem falso positivo — tipos M-/P- com contadores próprios, ponto avulso, versão de 1 ponto", () => {
  // M-01, P-02… (sem nenhum nome que comece por número): nada a separar
  const lev = levantamento();
  const mp = lev.map((p, i) => linha(`${i % 3 === 0 ? "M" : "P"}-${String(p.num).padStart(2, "0")}`, p, 0.01));
  const a = lerLinhas(mp, op);
  assert.equal(a.versoes.versoes.length, 0);
  assert.equal(a.anel.length, 16);
  // levantamento numerado + UM ponto com prefixo: não é versão (precisa repetir ≥ 2)
  const avulso = [...lev.map((p) => linha(String(p.num), p, 0.01)), linha("casa1", { e: 500010, n: 8700010, h: 250 }, 0.01)];
  const b = lerLinhas(avulso, op);
  assert.equal(b.versoes.versoes.length, 0);
  assert.equal(b.anel.length, 17, "o ponto avulso segue como antes (o operador exclui na prévia)");
  // o arquivo de sempre: nenhuma mudança
  const c = lerLinhas(lev.map((p) => linha(`${p.num}${ROTULOS.get(p.num) ?? ""}`, p, 0.01)), op);
  assert.equal(c.versoes.versoes.length, 0);
  assert.ok(!c.aConfirmar.includes("versoes"));
});

const REAL = new URL("./corpus-real/edilson/Arquivo_de_Coordenadas_Formatado.txt", import.meta.url);
test("versões: o arquivo real do EDILSON sai com os 16 pontos do levantamento (o que segue a estrada)", { skip: !existsSync(REAL) && "sem o corpus real" }, () => {
  const l = lerLinhas(abrir(readFileSync(REAL)).linhas, op);
  assert.deepEqual(l.anel.map((p) => p.num), TODOS);
  assert.equal((areaM2(l.anel) / 1e4).toFixed(4), "4.2438", "antes: 8,5950 ha com 28 lados");
  assert.deepEqual(l.anel.filter((p) => p.rotulo).map((p) => [p.num, p.rotulo]), [[3, "jorge/davino"], [4, "davino/estrada"], [16, "estrada/"]]);
  assert.ok(!l.avisos.some((a) => a.codigo === "desenho_cruza"));
  assert.deepEqual(l.versoes.versoes[1].faltam, [6, 11, 13, 14]);
});
