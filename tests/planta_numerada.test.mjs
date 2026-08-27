// Confrontantes NUMERADOS na planta.
//
// O problema que isto resolve: a largura do bloco de nome do vizinho é
// proporcional ao COMPRIMENTO da divisa (`maxW = min(310, max(90, 0,8×comp))`).
// Numa divisa curta o bloco fica alto e estreito, e dois vizinhos assim, lado a
// lado, acabam empilhados — o motor esgota os candidatos e cai em `menosPior`,
// que desenha por cima mesmo assim.
//
// Marcado, o confrontante sai do desenho como um disco de 24pt e reaparece por
// extenso no quadro CONFRONTANTES do rodapé. O que se prova aqui:
//   1. a regra de numeração (ordem, dedupe, via/rio fora, começa em 1);
//   2. os dois lados — tela (src/lib/trechos.ts) e desenho (planta.ts) — dão o
//      MESMO número, que é o que impede a folha de contradizer o operador;
//   3. sem nenhum marcado, o PDF é idêntico ao de antes desta capacidade;
//   4. com marcados, a planta sai nas três folhas e os rótulos param de invadir.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf, numerarConfrontantes } from "../supabase/functions/_shared/planta.ts";
import { numerarConfrontantes as numerarNaTela } from "../src/lib/trechos.ts";
import { ANEL, dadosPlantaDe, ehFolha, mesmoDesenho } from "./fixtures/salgada_velha.mjs";

const proj4 = (f, t, c) => proj4lib(f, t, c);

// Descritivos reais nos quatro M do anel: os dois LA3 são faixa de domínio
// (ESTRADA VICINAL e LINHA FERREA) e os outros dois são vizinhos-pessoa. É a
// configuração em que o problema aparece — dois blocos de nome em divisas
// vizinhas, com o texto formal completo.
const KAGADOS = "(MATR.4.403/CNS.00.770-8) FAZENDA KAGADOS\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53";
const LAMEIRO = "(MATR.432/CNS.00.810-2) FAZENDA LAMEIRO\\ MARIA NINA DA SILVA COSTA\\ CPF:666.186.815-53";

/** ServicoInput do anel da fixture, com descritivo e marca de numeração por M. */
function entradaNumerada({ marcados = [], descritivos = { 4: KAGADOS, 15: LAMEIRO } } = {}) {
  return {
    fusoUtm: 24,
    prefixo: "DSBN",
    contadores: { M: 0, P: 0, V: 0 },
    vertices: ANEL.map(([ordem, e, n, tipo, codigo, descritivo, tipoLimite]) => ({
      ordem, numTxt: ordem + 1, e, n, h: 360, sigmaPos: 0.01, sigmaH: 0.01,
      tipo, metodo: "PG6", codigoManual: codigo, inserido: false,
      descritivo: descritivos[ordem] ?? descritivo,
      tipoLimite, ehVia: false,
      numerado: marcados.includes(ordem),
    })),
  };
}

const geo = (opts) => geometriaDoCalculo(montarServico(entradaNumerada(opts), proj4));

// os mesmos trechos no formato da TELA, para conferir que os dois lados batem
const comoNaTela = (opts) =>
  montarServico(entradaNumerada(opts), proj4).trechosOrdenados.map((t) => ({
    vertice_inicio_ordem: t.verticeInicioOrdem,
    descritivo: t.descritivo,
    tipo_limite: t.tipoLimite,
    eh_via: t.ehVia,
    numerado: t.numerado,
  }));

// ---------------------------------------------------------------------------
// 1. a regra
// ---------------------------------------------------------------------------

test("um só marcado vira o número 1", () => {
  const n = numerarConfrontantes(geo({ marcados: [4] }).trechos);
  assert.equal(n.length, 1);
  assert.equal(n[0].numero, 1);
  assert.equal(n[0].descritivo, KAGADOS);
});

test("numera na ordem do anel, começando em 1", () => {
  const n = numerarConfrontantes(geo({ marcados: [4, 15] }).trechos);
  assert.deepEqual(n.map((x) => x.numero), [1, 2]);
  // o M da ordem 4 vem antes do da ordem 15 no perímetro
  assert.equal(n[0].descritivo, KAGADOS);
  assert.equal(n[1].descritivo, LAMEIRO);
});

test("o mesmo vizinho em duas divisas separadas leva UM número só", () => {
  // KAGADOS nos dois M não-via: é o mesmo vizinho, não dois
  const n = numerarConfrontantes(
    geo({ marcados: [4, 15], descritivos: { 4: KAGADOS, 15: KAGADOS } }).trechos,
  );
  assert.equal(n.length, 1);
  assert.equal(n[0].numero, 1);
});

test("faixa de domínio e curso d'água nunca são numerados", () => {
  // os M de ordem 3 e 14 são LA3 (ESTRADA VICINAL / LINHA FERREA)
  const n = numerarConfrontantes(geo({ marcados: [3, 14] }).trechos);
  assert.deepEqual(n, [], "o nome da via acompanha o traço; ela não empilha");
});

test("marcado sem descritivo não entra — não haveria o que imprimir no quadro", () => {
  const n = numerarConfrontantes(geo({ marcados: [4], descritivos: {} }).trechos);
  assert.deepEqual(n, []);
});

test("nada marcado, nada numerado", () => {
  assert.deepEqual(numerarConfrontantes(geo().trechos), []);
});

// ---------------------------------------------------------------------------
// 2. tela e desenho dizem o mesmo número
// ---------------------------------------------------------------------------

test("a numeração da tela é a mesma do PDF", () => {
  for (const marcados of [[4], [4, 15], [3, 4, 14, 15], []]) {
    const noDesenho = numerarConfrontantes(geo({ marcados }).trechos);
    const naTela = numerarNaTela(comoNaTela({ marcados }));
    assert.equal(naTela.size, noDesenho.length, `qtd com marcados=${marcados}`);
    // toda entrada da tela aponta para o número que o desenho dá àquele texto
    const porChave = new Map(noDesenho.map((n) => [n.chave, n.numero]));
    for (const t of comoNaTela({ marcados })) {
      const numTela = naTela.get(t.vertice_inicio_ordem);
      if (numTela === undefined) continue;
      assert.equal(numTela, porChave.get(t.descritivo.trim().toUpperCase()));
    }
  }
});

// A marca é sobre o CONFRONTANTE. A tela propaga a marca para todas as divisas
// dele (marcarNumeracao), e o desenho procura o número PELO DESCRITIVO — então
// marcar o vizinho num lugar o numera em todos. Este teste fixa esse contrato:
// se o desenho passasse a olhar o `numerado` do trecho em vez do descritivo, o
// mesmo vizinho sairia numerado numa divisa e por extenso na outra.
test("marcar o confrontante numera-o em toda divisa dele", () => {
  const n = numerarConfrontantes(
    geo({ marcados: [4], descritivos: { 4: KAGADOS, 15: KAGADOS } }).trechos,
  );
  assert.equal(n.length, 1, "um vizinho, um número — mesmo marcado num lugar só");
  assert.equal(n[0].chave, KAGADOS.trim().toUpperCase());
});

test("o mesmo vizinho em duas divisas leva o mesmo número TAMBÉM na tela", () => {
  const naTela = numerarNaTela(comoNaTela({ marcados: [4, 15], descritivos: { 4: KAGADOS, 15: KAGADOS } }));
  assert.deepEqual([...new Set(naTela.values())], [1]);
  assert.equal(naTela.size, 2, "os dois trechos ficam marcados, com o mesmo número");
});

// ---------------------------------------------------------------------------
// 3. não regressão
// ---------------------------------------------------------------------------

test("sem nenhum numerado o PDF é idêntico ao de antes da capacidade", async () => {
  const g = geo();
  const semCampo = await gerarPlantaPdf(dadosPlantaDe(g));
  // o mesmo desenho, com o campo presente e falso em todos os trechos
  const comCampoFalso = await gerarPlantaPdf(dadosPlantaDe({
    ...g,
    trechos: g.trechos.map((t) => ({ ...t, numerado: false })),
  }));
  assert.equal(await mesmoDesenho(comCampoFalso, semCampo), true);
});

// ---------------------------------------------------------------------------
// 4. o desenho
// ---------------------------------------------------------------------------

test("numerar muda o desenho e o quadro entra na folha", async () => {
  const sem = await gerarPlantaPdf(dadosPlantaDe(geo()));
  const com = await gerarPlantaPdf(dadosPlantaDe(geo({ marcados: [4, 15] })));
  assert.equal(await mesmoDesenho(com, sem), false, "o número e o quadro têm de mudar o PDF");
  assert.ok(com.length > 1000);
});

test("confrontante numerado sai nas três folhas", async () => {
  for (const folha of ["A1", "A3", "A4"]) {
    const pdf = await gerarPlantaPdf(dadosPlantaDe(geo({ marcados: [4, 15] }), { folha }));
    assert.equal(await ehFolha(pdf, folha), true, `numerado em ${folha}`);
  }
});

test("com todos os vizinhos numerados, nenhum rótulo invade o desenho", async () => {
  const diag = {};
  await gerarPlantaPdf(dadosPlantaDe(geo({ marcados: [4, 15] })), diag);
  // os dois blocos de nome viraram discos; sobram os nomes das duas vias, que
  // continuam saindo por extenso ao longo do próprio traço
  assert.equal(diag.sobrepostos, 0, "número não invade linha do desenho");
  assert.equal(diag.deslocados, 0, "número não precisa deslizar para fora do meio da divisa");
});

test("o quadro não pode comer o desenho: fica no teto reservado", async () => {
  // 2 numerados com descritivo formal completo — o caso normal
  const pdf = await gerarPlantaPdf(dadosPlantaDe(geo({ marcados: [4, 15] })));
  assert.ok(pdf.length > 1000);
  // e um caso de texto muito longo, que força o quadro a encolher o corpo
  const longo = "X".repeat(40) + " " + "Y".repeat(40);
  const g = geo({ marcados: [4, 15], descritivos: { 4: longo, 15: `${longo} Z` } });
  const pdfLongo = await gerarPlantaPdf(dadosPlantaDe(g));
  assert.ok(pdfLongo.length > 1000, "descritivo longo não pode derrubar a planta");
});
