// Planta do loteamento editável (09/11/2026): a folha 1 leva a cena embutida,
// como as plantas do GEO, e a edição não perde as folhas do quadro de lotes.
// Os dados do cliente (proprietário, CPF) chegam ao carimbo e à cena.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { perimetro } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo } from "../src/lib/loteamento/modelo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { arquivoDoLoteamento } from "../src/lib/loteamento/entregas.ts";
import { cenaParaPdf, lerCena } from "../supabase/functions/_shared/planta_cena.ts";
import { textoWinAnsi } from "../supabase/functions/_shared/texto.ts";
import { comFolhasSeguintes } from "../src/lib/planta_folhas.ts";

const carimbo = {
  empresa: "EMPRESA TESTE", cnpj: "", desenhista: "", proprietario: "MARIA DA SILVA", cpfProprietario: "123.456.789-00",
  imovel: "GLEBA TESTE", municipio: "Salvador", uf: "BA", matricula: "4321", rt: "RT TESTE", rtRegistro: "CREA: 1", trt: "", fuso: 24, logo: null,
};
const servico = { municipio: "Salvador", uf: "BA", detentor_nome: "MARIA DA SILVA", detentor_cpf: "123.456.789-00", denominacao: "GLEBA TESTE", fuso_utm: 24 };

test("planta do loteamento: cena na folha 1, cliente no carimbo, edição mantém as outras folhas", async () => {
  const pr0 = projetoNovo("TESTE", perimetro.pts.length);
  pr0.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
  const projeto = JSON.parse(JSON.stringify(gerarPropostas(pr0, perimetro, { quantas: 1, estruturar: false })[0].projeto));
  const res = calcular(projeto, perimetro);
  const a = await arquivoDoLoteamento({ saida: "planta", folha: "A3" }, projeto, res, perimetro, servico, carimbo);

  const cena = await lerCena(a.dados);
  assert.ok(cena, "a planta não trouxe a cena: o visualizador não deixaria editar");
  assert.equal(cena.nomeFolha, "A3");
  const textos = cena.itens.filter((i) => i.k === "texto").map((i) => i.t);
  assert.ok(textos.includes("MARIA DA SILVA"), "proprietário fora do carimbo");
  assert.ok(textos.some((t) => t.includes("123.456.789-00")), "CPF fora do carimbo");
  // traçado travado; números dos lotes, carimbo e identificação editáveis
  assert.equal(cena.objetos.terreno?.travado, true);
  for (const id of ["carimbo", "identificacao", "quadro", "legenda", "bussola"]) assert.ok(cena.objetos[id], `sem o objeto ${id}`);
  assert.ok(Object.values(cena.objetos).some((o) => o.cat === "rotulo-lote"), "números dos lotes sem objeto");
  // nada caiu em "Elemento" solto
  assert.equal(Object.values(cena.objetos).filter((o) => o.cat === "desenho").length, 0);

  // editar: troca o nome do proprietário e refaz a folha 1, como o visualizador
  const original = await PDFDocument.load(a.dados);
  const folhas = original.getPageCount();
  assert.ok(folhas >= 2, "esperava a folha do quadro de lotes");
  const editada = { ...cena, itens: cena.itens.map((i) => (i.k === "texto" && i.t === "MARIA DA SILVA" ? { ...i, t: "JOÃO PEREIRA" } : i)) };
  const b = await comFolhasSeguintes(await cenaParaPdf(editada, textoWinAnsi), a.dados);
  const doc = await PDFDocument.load(b);
  assert.equal(doc.getPageCount(), folhas, "a edição perdeu folhas do quadro de lotes");
  const cena2 = await lerCena(b);
  assert.ok(cena2?.itens.some((i) => i.k === "texto" && i.t === "JOÃO PEREIRA"), "a planta editada não continua editável");
});
