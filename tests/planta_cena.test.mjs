// CENA da planta (planta_cena.ts): o desenho gravado como peças editáveis.
//
// O editor do navegador abre a cena embutida no PDF e, ao concluir, refaz o PDF
// a partir dela. Estes testes lacram as três promessas disso:
//   1. pedir a cena não muda o desenho (o gravador só repassa as chamadas);
//   2. a cena refeita sem edição é a MESMA folha (mesmo tamanho, mesmo texto);
//   3. o traçado do terreno vem marcado como travado, e só ele.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { PDFDocument } from "pdf-lib";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import { cenaParaPdf, lerCena } from "../supabase/functions/_shared/planta_cena.ts";
import { dadosPlantaDe, entrada, ehFolha } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const geo = () => geometriaDoCalculo(montarServico(entrada(), proj4));
// PNG 1×1 transparente: o bastante para exercitar a logo e a situação
const PNG_1PX = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const imagens = { logo: { bytes: PNG_1PX, tipo: "png" }, satelite: { bytes: PNG_1PX, tipo: "png" } };

async function conteudo(bytes) {
  const doc = await PDFDocument.load(bytes);
  const p = doc.getPage(0);
  return { w: p.getWidth(), h: p.getHeight() };
}

test("cena · pedir a cena não muda o desenho da folha", async () => {
  const d = dadosPlantaDe(geo(), { folha: "A1", ...imagens });
  const semCena = await gerarPlantaPdf(d);
  const comCena = await gerarPlantaPdf(d, undefined, { editavel: true });
  assert.equal(await lerCena(semCena), null, "sem a opção, o PDF não leva cena");
  // mesmo fluxo de conteúdo da página: o que muda é só o fluxo extra da cena
  const fluxo = async (b) => {
    const doc = await PDFDocument.load(b);
    const ref = doc.getPage(0).node.Contents();
    return doc.context.lookup(ref).getContents?.() ?? ref.toString();
  };
  assert.deepEqual(await fluxo(comCena), await fluxo(semCena));
});

for (const folha of ["A1", "A3", "A4"]) {
  test(`cena · ${folha}: a cena refeita sai na mesma folha, com as mesmas peças`, async () => {
    const d = dadosPlantaDe(geo(), { folha, ...imagens, ...(folha === "A4" ? { conferencia: true } : {}) });
    const pdf = await gerarPlantaPdf(d, undefined, { editavel: true });
    const cena = await lerCena(pdf);
    assert.ok(cena, "a cena tem de estar no PDF");
    assert.equal(cena.nomeFolha, folha);
    assert.ok(cena.itens.length > 200, `cena com ${cena.itens.length} peças`);
    const refeito = await cenaParaPdf(cena);
    assert.equal(await ehFolha(refeito, folha), true);
    const [a, b] = [await conteudo(pdf), await conteudo(refeito)];
    assert.ok(Math.abs(a.w - b.w) < 0.01 && Math.abs(a.h - b.h) < 0.01);
    // e o refeito continua editável, com a mesma cena
    const cena2 = await lerCena(refeito);
    assert.equal(cena2.itens.length, cena.itens.length);
  });
}

test("cena · só o traçado do terreno é travado: poligonal azul e pontos dos vértices", async () => {
  const g = geo();
  const cena = await lerCena(await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A1", ...imagens }), undefined, { editavel: true }));
  const travados = Object.entries(cena.objetos).filter(([, o]) => o.travado).map(([id]) => id);
  assert.deepEqual(travados, ["terreno"]);
  const doTerreno = cena.itens.filter((i) => i.obj === "terreno");
  const n = g.vertices.length;
  assert.equal(doTerreno.filter((i) => i.k === "linha").length, n, "uma aresta azul por vértice");
  assert.equal(doTerreno.filter((i) => i.k === "elipse").length, n, "um ponto por vértice");
  assert.ok(doTerreno.every((i) => i.k !== "texto"), "nenhum texto é travado");
  // o vermelho da estrada e o verde das divisões são editáveis, cada um no seu objeto
  const cat = (i) => cena.objetos[i.obj].cat;
  assert.ok(cena.itens.some((i) => cat(i) === "estrada" && i.k === "linha"));
  assert.equal(cena.itens.filter((i) => cat(i) === "marco").length, g.trechos.length, "um traço verde por M");
  for (const c of ["moldura", "malha", "bussola", "quadro", "situacao", "carimbo", "planimetrico", "rodape", "codigo-vertice", "identificacao"]) {
    assert.ok(cena.itens.some((i) => cat(i) === c), `camada ${c} presente`);
  }
  // nada fica sem objeto marcado
  assert.ok(cena.itens.every((i) => cat(i) !== "desenho"), "toda peça da planta tem objeto próprio");
});

test("cena · a barra lateral da A3 é gravada já ampliada (4/3), igual ao que se imprime", async () => {
  const g = geo();
  const cenaA1 = await lerCena(await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A1" }), undefined, { editavel: true }));
  const cenaA3 = await lerCena(await gerarPlantaPdf(dadosPlantaDe(g, { folha: "A3" }), undefined, { editavel: true }));
  const caixaSituacao = (c) => c.itens.find((i) => i.k === "ret" && c.objetos[i.obj].cat === "situacao");
  const a1 = caixaSituacao(cenaA1), a3 = caixaSituacao(cenaA3);
  assert.ok(a1 && a3);
  // a caixa tem 540 pt nas duas: a barra da A3 é desenhada a 405 e ampliada em 4/3
  assert.ok(Math.abs(a1.w - 540) < 0.01 && Math.abs(a3.w - 540) < 0.01, `largura A1 ${a1.w.toFixed(2)} × A3 ${a3.w.toFixed(2)}`);
  // e os textos dela saem 4/3 maiores na tela da A3 (a redução final os traz a 2/3)
  const tit = (c) => c.itens.find((i) => i.k === "texto" && i.t === "PLANTA DE SITUAÇÃO");
  assert.ok(Math.abs(tit(cenaA3).tam / tit(cenaA1).tam - 4 / 3) < 0.01);
  assert.ok(cenaA3.folha && Math.abs(cenaA3.folha.s - 0.4994) < 0.001);
});

test("cena · edição sobrevive à volta: texto trocado e peça oculta", async () => {
  const cena = await lerCena(await gerarPlantaPdf(dadosPlantaDe(geo(), { folha: "A1" }), undefined, { editavel: true }));
  const titulo = cena.itens.find((i) => i.k === "texto" && i.t === "QUADRO ANALÍTICO");
  titulo.t = "TABELA DE COORDENADAS";
  const malha = cena.itens.filter((i) => cena.objetos[i.obj].cat === "malha");
  for (const m of malha) m.oculto = true;
  const volta = await lerCena(await cenaParaPdf(cena));
  assert.ok(volta.itens.some((i) => i.k === "texto" && i.t === "TABELA DE COORDENADAS"));
  assert.equal(volta.itens.filter((i) => i.oculto).length, malha.length);
});

test("editor · clique, caixa, mover e escalar seguem a peça", async () => {
  const { acerta, caixaDe, escalar, mover, pecaNoPonto, blocoDeTexto } = await import("../src/lib/planta_editor.ts");
  const linha = { id: "a", obj: "o1", k: "linha", x1: 0, y1: 0, x2: 100, y2: 0, esp: 2, cor: [0, 0, 0] };
  assert.ok(acerta(linha, 50, 2, 1) && !acerta(linha, 50, 10, 1));
  const texto = { id: "b", obj: "o2", k: "texto", t: "ABC", x: 10, y: 10, tam: 10, w: 30, cor: [0, 0, 0], rot: 90 };
  // girado 90°: o texto sobe a partir de (10,10)
  assert.ok(acerta(texto, 8, 30, 0) && !acerta(texto, 30, 12, 0));
  const terreno = { ...linha, id: "c", obj: "t" };
  const objs = { o1: { rotulo: "", cat: "marco" }, t: { rotulo: "", cat: "terreno", travado: true } };
  assert.equal(pecaNoPonto([linha, terreno], objs, 50, 0, 1)?.id, "a", "a travada nunca é pega, mesmo por cima");
  assert.equal(pecaNoPonto([terreno], objs, 50, 0, 1), null);
  assert.deepEqual(caixaDe(mover(linha, 5, 5)), { x1: 4, y1: 4, x2: 106, y2: 6 });
  const e = escalar(linha, 2, 0, 0);
  assert.equal(e.x2, 200); assert.equal(e.esp, 4);
  const l1 = { ...texto, id: "1", rot: undefined, y: 100 }, l2 = { ...texto, id: "2", rot: undefined, y: 85 };
  const b = blocoDeTexto([l2, l1]);
  assert.deepEqual(b.linhas.map((l) => l.id), ["1", "2"]);
  assert.equal(b.passo, 15);
});
