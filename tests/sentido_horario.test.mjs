// O SIGEF exige o perímetro descrito no sentido horário, a partir do vértice mais
// ao norte. O TXT do levantamento vem em qualquer sentido, então `montarServico`
// normaliza.
//
// A parte delicada é a confrontação. A invariante do sistema é "o trecho de um M vai
// até o próximo M" — NA ORDEM EM QUE A ENTRADA FOI DIGITADA, que é a ordem que o
// usuário vê na tela e no preview (ver ARQUITETURA-TRECHOS.md). Ao inverter o sentido,
// o mesmo pedaço de divisa passa a ser percorrido a partir do outro extremo, então a
// confrontação tem de andar um M junto. O teste abaixo não confere a aritmética desse
// deslocamento: confere o significado físico — a divisa coberta por cada confrontante
// na SAÍDA tem de ser a mesma que ele cobria na ENTRADA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import { calcularVertices, ehSentidoHorario, parseTxt } from "../supabase/functions/_shared/geo.ts";
import { montarServico } from "../supabase/functions/_shared/servico.ts";

const proj4 = (from, to, coords) => proj4lib(from, to, coords);
const pontos = parseTxt(readFileSync(new URL("../reference/LARISSA.txt", import.meta.url), "utf8"));

const DESCRITIVOS = {
  30: "(MATR.4.403/CNS.00.803-7) FAZENDA TERRA NOVA", 36: "(POSSE) FAZENDA LAMEIRO",
  41: "(MATR.432/CNS.00.770-8) FAZENDA LAMEIRO", 58: "(POSSE) FAZENDA PAU D'ÁGUA",
  64: "BA 408", 9: "CORREDOR",
};
const TIPO_LIMITE = { 30: "LA1", 36: "LA1", 41: "LA1", 58: "LA1", 64: "LA3", 9: "LA3" };
const MS = new Set([30, 36, 41, 58, 64, 9]);

function verticesBase() {
  const vs = pontos.map((p) => ({
    ordem: 0, numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH,
    tipo: MS.has(p.num) ? "M" : "P", metodo: "PG6", inserido: false,
    descritivo: MS.has(p.num) ? DESCRITIVOS[p.num] : null,
    tipoLimite: MS.has(p.num) ? TIPO_LIMITE[p.num] : null,
    ehVia: MS.has(p.num) && /^LA[34567]/.test(TIPO_LIMITE[p.num] ?? ""),
  }));
  vs.forEach((v, i) => { v.ordem = i; });
  return vs;
}

const OPTS = { fusoUtm: 24, prefixo: "DSBN", contadores: { M: 3605, P: 13130, V: 758 } };
const base = verticesBase();
// a MESMA poligonal digitada no sentido oposto (a confrontação de cada M passa a
// valer para o lado oposto — é o que o usuário veria no preview desta entrada)
const invertidas = base.slice().reverse().map((v, i) => ({ ...v, ordem: i }));

const deBase = montarServico({ ...OPTS, vertices: base }, proj4);
const deInvertidas = montarServico({ ...OPTS, vertices: invertidas }, proj4);

// Divisa = par não-ordenado de vértices adjacentes, identificado por numTxt (identidade
// estável entre entrada e saída). Valor = o confrontante que a cobre.
const divisa = (a, b) => [a, b].sort((x, y) => x - y).join("~");

// cobertura DECLARADA na entrada: cada M cobre da sua posição até o próximo M
function coberturaEntrada(vs) {
  const m = new Map();
  let atual = [...vs].reverse().find((v) => v.tipo === "M"); // antes do 1º M vem a volta do anel
  vs.forEach((v, i) => {
    if (v.tipo === "M") atual = v;
    m.set(divisa(v.numTxt, vs[(i + 1) % vs.length].numTxt), atual.descritivo);
  });
  return m;
}

// cobertura EFETIVA na saída: o trecho a que cada vértice pertence cobre o segmento dele
function coberturaSaida(s) {
  return new Map(s.ring.map((v, i) => [
    divisa(v.numTxt, s.ring[(i + 1) % s.ring.length].numTxt), v.trecho.descritivo,
  ]));
}

function conferirCobertura(entrada, saida, rotulo) {
  const esperada = coberturaEntrada(entrada);
  const obtida = coberturaSaida(saida);
  assert.equal(obtida.size, esperada.size, `${rotulo}: nº de divisas mudou`);
  for (const [d, conf] of esperada) {
    assert.equal(obtida.get(d), conf, `${rotulo}: divisa ${d} mudou de confrontante`);
  }
}

test("o anel publicado sai sempre no sentido horário", () => {
  assert.ok(ehSentidoHorario(deBase.ring), "entrada já horária saiu anti-horária");
  assert.ok(ehSentidoHorario(deInvertidas.ring), "entrada anti-horária não foi invertida");
});

test("a entrada histórica (LARISSA.txt) já é horária e passa intacta", () => {
  const calc = calcularVertices(
    base.map((v) => ({ numTxt: v.numTxt, e: v.e, n: v.n, h: v.h, sigmaPos: v.sigmaPos, sigmaH: v.sigmaH, inserido: false })),
    OPTS.fusoUtm, proj4,
  );
  // se isto quebrar, a convenção de sinal inverteu e todo memorial histórico sai do avesso
  assert.ok(ehSentidoHorario(calc));
  // e o anel não foi mexido: mesma sequência de códigos do arquivo histórico
  assert.equal(deBase.ring[0].codigo, "DSBN-M-3605");
  assert.equal(deBase.ring[1].codigo, "DSBN-P-13130");
});

test("a geometria não depende do sentido da entrada", () => {
  // inverter a entrada não pode mover vértice nem mudar azimute/área/perímetro
  assert.deepEqual(
    deInvertidas.ring.map((v) => `${v.numTxt}|${v.latGms}|${v.lonGms}`),
    deBase.ring.map((v) => `${v.numTxt}|${v.latGms}|${v.lonGms}`),
  );
  assert.equal(
    deInvertidas.segs.map((s) => s.azimuteFmt).join(),
    deBase.segs.map((s) => s.azimuteFmt).join(),
  );
  assert.ok(Math.abs(deInvertidas.areaHa - deBase.areaHa) < 1e-9);
  assert.ok(Math.abs(deInvertidas.perimetroM - deBase.perimetroM) < 1e-9);
});

test("cada confrontante sai cobrindo a divisa que cobria na entrada", () => {
  conferirCobertura(base, deBase, "entrada horária");
  conferirCobertura(invertidas, deInvertidas, "entrada anti-horária");
  // os 6 M do levantamento continuam abrindo trecho nos dois casos
  assert.equal(deBase.trechosOrdenados.length, 6);
  assert.equal(deInvertidas.trechosOrdenados.length, 6);
});

test("inverter a entrada realmente exercita a correção de sentido", () => {
  // guarda contra um teste que passaria à toa: as duas entradas declaram divisas
  // diferentes para o mesmo confrontante, então as saídas TÊM de diferir na
  // confrontação — se ficarem iguais, a inversão não está deslocando nada
  const conf = (s) => s.ring.map((v) => v.trecho.descritivo).join("\n");
  assert.notEqual(conf(deInvertidas), conf(deBase));
});
