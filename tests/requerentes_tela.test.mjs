// A lista de requerentes da tela ↔ colunas do banco (src/lib/requerentes.ts) e a
// planta com todos assinando (pedido de cliente, 23/11/2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { extractText, getDocumentProxy } from "unpdf";
import { camposDasLinhas, comQuantidade, linhasDoServico, quemSaiAoReduzir, totalQueAssina, MAX_REQUERENTES } from "../src/lib/requerentes.ts";
import { outrosRequerentes } from "../supabase/functions/_shared/requerentes.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo, montarDadosPlanta } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { entrada } from "./fixtures/salgada_velha.mjs";

const vazio = { requerente2_nome: null, requerente2_cpf: null, requerente2_genero: null, requerentes_extras: [] };

test("tela: escolher 3 abre duas linhas; digitar grava o 2º nas colunas e o 3º na lista", () => {
  assert.deepEqual(linhasDoServico(vazio), []);
  let linhas = comQuantidade([], 3);
  assert.equal(linhas.length, 2);
  linhas = [{ nome: "ANA", cpf: "2", genero: "F" }, { nome: "BIA", cpf: "3", genero: "F" }];
  const c = camposDasLinhas(linhas);
  assert.equal(c.requerente2_nome, "ANA");
  assert.deepEqual(c.requerentes_extras, [{ nome: "BIA", cpf: "3", genero: "F" }]);
  // ida e volta: o que a tela grava, a tela lê igual — e o servidor também
  const salvo = { ...vazio, ...c };
  assert.deepEqual(linhasDoServico(salvo), linhas);
  assert.deepEqual(outrosRequerentes(salvo).map((r) => r.nome), ["ANA", "BIA"]);
  assert.equal(totalQueAssina(linhas), 3);
});

test("tela: a 3ª linha vazia fica guardada (a quantidade volta igual ao reabrir) e o servidor a ignora", () => {
  const c = camposDasLinhas([{ nome: "ANA", cpf: "", genero: "F" }, { nome: "", cpf: "", genero: "M" }]);
  const salvo = { ...vazio, ...c };
  assert.equal(linhasDoServico(salvo).length, 2);
  assert.deepEqual(outrosRequerentes(salvo).map((r) => r.nome), ["ANA"]);
});

test("tela: reduzir avisa quem sai e corta a lista; 1 = só o detentor", () => {
  const linhas = [{ nome: "ANA", cpf: "", genero: "F" }, { nome: "BIA", cpf: "", genero: "F" }, { nome: "", cpf: "", genero: "M" }];
  assert.deepEqual(quemSaiAoReduzir(linhas, 2), ["BIA"]);
  assert.deepEqual(quemSaiAoReduzir(linhas, 1), ["ANA", "BIA"]);
  assert.deepEqual(camposDasLinhas(comQuantidade(linhas, 1)), { requerente2_nome: null, requerente2_cpf: null, requerente2_genero: null, requerentes_extras: [] });
  assert.equal(comQuantidade(linhas, 99).length, MAX_REQUERENTES - 1, "teto de 12 no total");
});

const proj4 = (f, t, c) => proj4lib(f, t, c);
const g = geometriaDoCalculo(montarServico(entrada(), proj4));
const CINCO = ["JOSE UM", "ANA DOIS", "BIA TRES", "CAIO QUATRO", "DUDA CINCO"];
async function planta(folha, n) {
  const servico = {
    denominacao: "FAZENDA TESTE", detentor_nome: CINCO[0], detentor_cpf: "100",
    ...camposDasLinhas(CINCO.slice(1, n).map((nome, i) => ({ nome, cpf: `${i + 2}00`, genero: "M" }))),
    tipo_imovel: "matricula", matricula: "1", cns: "2", codigo_sncr: "", municipio: "ARACI", uf: "BA",
  };
  const d = montarDadosPlanta({ servico, rt: { nome: "RT", formacao: "Téc", conselho_sigla: "CFT", conselho_numero: "1" },
    cred: { prefixo_vertice: "DSBN" }, desenhista: "", geometria: g, fuso: 24, trt: "BR1", dataStr: "23/11/2026", folha });
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(await gerarPlantaPdf(d))), { mergePages: true });
  return text;
}
const vezes = (t, s) => t.split(s).length - 1;

for (const folha of ["A1", "A3"]) {
  test(`planta ${folha} com 5 donos: todos no planimétrico e na assinatura, 6 selos do cartório`, async () => {
    const t = await planta(folha, 5);
    for (const nome of CINCO) assert.ok(vezes(t, nome) >= 2, `${nome}: planimétrico + assinatura (${vezes(t, nome)})`);
    assert.equal(vezes(t, "SELO DE RECONHECIMENTO"), 6);
  });
}

// Geometria, não só texto: com muitos donos a barra lateral se sobrepunha (na A3
// a partir de 9, na A1 com 12 — revisão de 23/11). Dois textos da barra cujas
// caixas se cruzam = sobreposição; rótulo encostado no valor ("Denominação:")
// é do desenho e não conta.
const DOZE = [...CINCO, ...Array.from({ length: 7 }, (_, k) => `HERDEIRO NUMERO ${k + 6} DOS SANTOS PEREIRA`)];
async function sobreposicoes(folha, n, extra = {}) {
  const servico = {
    denominacao: "FAZENDA TESTE", detentor_nome: DOZE[0], detentor_cpf: "100",
    ...camposDasLinhas(DOZE.slice(1, n).map((nome, i) => ({ nome, cpf: `${i + 2}00.000.000-00`, genero: "M" }))),
    tipo_imovel: "matricula", matricula: "1", cns: "2", codigo_sncr: "", municipio: "ARACI", uf: "BA", ...extra,
  };
  const d = montarDadosPlanta({ servico, rt: { nome: "RT", formacao: "Téc", conselho_sigla: "CFT", conselho_numero: "1" },
    cred: { prefixo_vertice: "DSBN" }, desenhista: "", geometria: g, fuso: 24, trt: "BR1", dataStr: "23/11/2026", folha });
  const pdf = await getDocumentProxy(new Uint8Array(await gerarPlantaPdf(d)));
  const pg = await pdf.getPage(1);
  const { width } = pg.getViewport({ scale: 1 });
  const itens = (await pg.getTextContent()).items
    .filter((it) => it.str.trim() && it.transform[4] > width * 0.7)
    .map((it) => ({ t: it.str.trim(), x0: it.transform[4], y0: it.transform[5], x1: it.transform[4] + it.width, y1: it.transform[5] + it.height * 0.8 }));
  const ruins = [];
  for (let i = 0; i < itens.length; i++) for (let j = i + 1; j < itens.length; j++) {
    const a = itens[i], b = itens[j];
    if (a.t.endsWith(":") || b.t.endsWith(":")) continue;
    const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (w > 1 && h > 1) ruins.push(`${a.t} × ${b.t}`);
  }
  // a planta de situação (acima do planimétrico) nunca pode ser engolida
  const { height } = pg.getViewport({ scale: 1 });
  const yDe = (t) => itens.find((i) => i.t.startsWith(t))?.y0 ?? NaN;
  const situacao = yDe("PLANTA DE SITUA") - yDe("PLANIM");
  if (!(situacao >= height * 0.08)) ruins.push(`planta de situação com ${situacao.toFixed(0)} pt`);
  return { ruins, texto: itens.map((i) => i.t).join(" ") };
}
for (const folha of ["A1", "A3"]) {
  for (const n of [4, 8, 12]) {
    test(`planta ${folha} com ${n} donos: nada da barra lateral por cima de nada, todos presentes`, async () => {
      const { ruins, texto } = await sobreposicoes(folha, n);
      assert.deepEqual(ruins, []);
      for (const nome of DOZE.slice(0, n)) assert.ok(texto.includes(nome.split(" ")[0]), nome);
      assert.equal(vezes(texto, "SELO DE RECONHECIMENTO"), n + 1);
    });
  }
}
test("planta A3 com 12 posseiros e espólio: nada sobreposto", async () => {
  const { ruins } = await sobreposicoes("A3", 12, { tipo_imovel: "posse", is_espolio: true, inventariante_nome: "INVENTARIANTE DE TAL", inventariante_cpf: "9" });
  assert.deepEqual(ruins, []);
});

test("planta A4 com 4 donos: todos no selo", async () => {
  const t = await planta("A4", 4);
  assert.ok(t.includes("JOSE UM, ANA DOIS, BIA TRES E CAIO QUATRO"));
});
