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
  const editada = { ...cena, itens: cena.itens.map((i) => (i.k === "texto" && i.t === "MARIA DA SILVA" ? { ...i, t: "JOÃO PEREIRA" } : i)) };
  const b = await comFolhasSeguintes(await cenaParaPdf(editada, textoWinAnsi), a.dados);
  const doc = await PDFDocument.load(b);
  assert.equal(doc.getPageCount(), folhas, "a edição perdeu folhas");
  const cena2 = await lerCena(b);
  assert.ok(cena2?.itens.some((i) => i.k === "texto" && i.t === "JOÃO PEREIRA"), "a planta editada não continua editável");
});

// Quadro de lotes na planta (25/11/2026): antes ia em folhas à parte; agora fica
// na folha única, à esquerda do desenho, como um objeto que o editor arrasta.
const caixaDe = (itens) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const i of itens) {
    const xs = i.k === "linha" ? [i.x1, i.x2] : i.k === "texto" ? [i.x, i.x + i.w] : i.k === "ret" ? [i.x, i.x + i.w] : [i.x];
    const ys = i.k === "linha" ? [i.y1, i.y2] : i.k === "texto" ? [i.y, i.y - i.tam] : i.k === "ret" ? [i.y, i.y + i.h] : [i.y];
    x0 = Math.min(x0, ...xs); x1 = Math.max(x1, ...xs); y0 = Math.min(y0, ...ys); y1 = Math.max(y1, ...ys);
  }
  return { x0, y0, x1, y1 };
};

for (const folha of ["A1", "A3"]) {
  test(`quadro de lotes na própria planta, à esquerda e móvel (${folha})`, async () => {
    const pr0 = projetoNovo("TESTE", perimetro.pts.length);
    pr0.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
    const projeto = JSON.parse(JSON.stringify(gerarPropostas(pr0, perimetro, { quantas: 1, estruturar: false })[0].projeto));
    const res = calcular(projeto, perimetro);
    assert.ok(res.lotes.length > 20, "poucos lotes para o teste");
    const a = await arquivoDoLoteamento({ saida: "planta", folha }, projeto, res, perimetro, servico, carimbo);
    assert.equal((await PDFDocument.load(a.dados)).getPageCount(), 1, "o quadro de lotes ainda foi para outra folha");

    const cena = await lerCena(a.dados);
    assert.equal(cena.objetos["quadro-lotes"]?.rotulo, "Quadro de lotes");
    assert.notEqual(cena.objetos["quadro-lotes"]?.travado, true, "o quadro de lotes tem de ser editável");
    const doQuadro = cena.itens.filter((i) => i.obj === "quadro-lotes");
    const textos = new Set(doQuadro.filter((i) => i.k === "texto").map((i) => i.t));
    // todo lote está no quadro (número com 2 dígitos e a área)
    for (const l of res.lotes) assert.ok(textos.has(String(l.numero).padStart(2, "0")), `lote ${l.numero} fora do quadro`);
    for (const q of res.quadras) assert.ok(textos.has(`QUADRA ${q.nome}`), `quadra ${q.nome} fora do quadro`);

    // à esquerda do traçado e sem encostar nele; dentro da moldura
    const cq = caixaDe(doQuadro);
    const ct = caixaDe(cena.itens.filter((i) => cena.objetos[i.obj]?.cat === "terreno"));
    assert.ok(cq.x1 < ct.x0, `quadro (até x=${cq.x1.toFixed(0)}) invade o traçado (de x=${ct.x0.toFixed(0)})`);
    const H = cena.altura ?? cena.h ?? cena.alt;
    if (typeof H === "number") assert.ok(cq.y0 > 0 && cq.y1 < H, "quadro fora da folha");
    assert.ok(cq.x0 > 25 * 72 / 25.4, "quadro fora da moldura");

    // mover no editor: desloca as peças do objeto e regera o PDF
    const movida = { ...cena, itens: cena.itens.map((i) => {
      if (i.obj !== "quadro-lotes") return i;
      if (i.k === "linha") return { ...i, x1: i.x1 + 40, x2: i.x2 + 40, y1: i.y1 + 20, y2: i.y2 + 20 };
      return { ...i, x: i.x + 40, y: i.y + 20 };
    }) };
    const b = await cenaParaPdf(movida, textoWinAnsi);
    const cena2 = await lerCena(b);
    const cq2 = caixaDe(cena2.itens.filter((i) => i.obj === "quadro-lotes"));
    assert.ok(Math.abs(cq2.x0 - cq.x0 - 40) < 0.5 && Math.abs(cq2.y0 - cq.y0 - 20) < 0.5, "o quadro não ficou onde foi posto");
  });
}
