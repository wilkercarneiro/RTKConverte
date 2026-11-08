// Precisão do Medir no campo (estudo docs/estudo-precisao-gps-campo.md):
//  • a mesma posição repetida (watchPosition + pedirAgora) conta uma vez só;
//  • o piso do Marcar ponto acompanha a precisão (receptor RTK de ±1 cm não perde as leituras);
//  • o tipo de solução do ponto é o pior das leituras;
//  • 95% = 1,62 × o raio de 68%; texto em centímetros abaixo de 1 m;
//  • aquecimento: espera a precisão parar de melhorar; receptor não aquece;
//  • convergência: o ponto médio "parou de andar";
//  • filtro do Caminhar: recusa o salto impossível, segue quem anda;
//  • calibração: deslocamento, interpolação no tempo, refazer pelo bruto, marcos SIGEF;
//  • ajuste da cerca: a área volta perto da verdadeira (o Caminhar corta os cantos).
import { test } from "node:test";
import assert from "node:assert/strict";
import { combinarLeituras, FATOR_95, semRepetidas, verticeAoCaminhar } from "../src/lib/campo/motor.ts";
import { convergencia, criarFiltroCaminhar, estadoAquecimento } from "../src/lib/campo/filtro.ts";
import {
  aplicarCalibracoes, calibrarVertice, correcaoNoTempo, deslocamento, lerCoordenadaMarco, marcosProximos, novaCalibracao, textoDeslocamento,
} from "../src/lib/campo/calibracao.ts";
import { ajustarCerca, valeAjustar } from "../src/lib/campo/ajuste.ts";
import { deslocar, distanciaM, medir, textoPrecisao, textoPrecisao95 } from "../src/lib/campo/geometria.ts";
import { limparLinhaReta, toleranciaPadrao } from "../src/lib/campo/simplificar.ts";
import { OPCOES_PADRAO } from "../src/lib/campo/tipos.ts";
import { arquivoDiagnostico, errosContra, gravarDiagnostico, lerArquivoDiagnostico, lerDiagnostico, MAX_LEITURAS_DIAG } from "../src/lib/campo/diagnostico.ts";

const ORIGEM = [-39.1262, -12.6915];
const P = (x, y) => { const [lon, lat] = deslocar(ORIGEM, x, y); return { lon, lat }; };
const leit = (x, y, precisao = 3, t = 0, extra = {}) => ({ ...P(x, y), precisao, t, ...extra });

/** ruído determinístico (gaussiano, Box–Muller) */
function gerador(semente) {
  let s = semente >>> 0;
  const u = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s + 0.5) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

// ---------------------------------------------------------------- repetidas
test("Marcar ponto: a mesma posição (mesma hora do GPS) conta uma vez só", () => {
  const a = leit(0, 0, 3, 1000, { tGps: 111 });
  const b = leit(2, 0, 3, 1500, { tGps: 222 });
  const lista = [a, { ...a, t: 1100 }, b, { ...b, t: 1600 }, { ...a, t: 1700 }];
  assert.equal(semRepetidas(lista).length, 2);
  const p = combinarLeituras(lista);
  assert.equal(p.usadas + p.descartadas, 2);
  // as duas pesam igual: o ponto fica no meio
  assert.ok(Math.abs(distanciaM(p, P(1, 0))) < 0.01);
  // sem a hora do GPS, posição idêntica também é repetida; diferente não
  assert.equal(semRepetidas([leit(0, 0), leit(0, 0), leit(0, 0.5)]).length, 2);
});

test("Marcar ponto: receptor RTK (±1 cm) não perde leituras pelo piso de 1,5 m e mantém o centímetro", () => {
  const r = gerador(7);
  const ls = Array.from({ length: 20 }, (_, i) => leit(0.01 * r(), 0.01 * r(), 0.012, i * 1000, { tGps: i, fonte: "receptor", fix: "rtk-fixo" }));
  ls.push(leit(0.6, 0, 0.012, 21000, { tGps: 99, fonte: "receptor", fix: "rtk-fixo" })); // salto de 60 cm
  const p = combinarLeituras(ls);
  assert.equal(p.descartadas, 1, "o salto de 60 cm sai (piso de 3 cm, não 1,5 m)");
  assert.ok(distanciaM(p, P(0, 0)) < 0.01, `ponto a ${distanciaM(p, P(0, 0))} m`);
  assert.ok(p.precisao < 0.03, `precisão ${p.precisao}`);
  assert.equal(p.fix, "rtk-fixo");
  assert.equal(p.fonte, "receptor");
  // uma leitura flutuante no meio: o ponto deixa de ser "fixo"
  const q = combinarLeituras([...ls.slice(0, 5), { ...ls[5], fix: "rtk-flutuante" }]);
  assert.equal(q.fix, "rtk-flutuante");
});

test("textos de precisão: centímetros abaixo de 1 m e o raio de 95%", () => {
  assert.equal(textoPrecisao(0.018), "±2 cm");
  assert.equal(textoPrecisao(0.001), "±1 cm");
  assert.equal(textoPrecisao(3.14), "±3,1 m");
  assert.equal(textoPrecisao95(3), "±3,0 m (até ±4,9 m)");
  assert.ok(Math.abs(FATOR_95 - Math.sqrt(-2 * Math.log(0.05)) / Math.sqrt(-2 * Math.log(0.32))) < 0.01);
});

test("limpeza: com RTK a tolerância desce para centímetros", () => {
  const vs = [0, 1, 2, 3].map((i) => ({ ...P(i * 10, 0), precisao: 0.02, t: 0, modo: "caminhar" }));
  assert.ok(toleranciaPadrao(vs) <= 0.05, `tolerância ${toleranciaPadrao(vs)}`);
  const cel = vs.map((v) => ({ ...v, precisao: 3 }));
  assert.equal(toleranciaPadrao(cel), 0.9);
});

// ---------------------------------------------------------------- aquecimento
test("aquecimento: espera a precisão parar de melhorar; tempo máximo; receptor com fix não espera", () => {
  const caindo = [12, 9, 7, 6, 5, 4.2, 3.6, 3.1, 2.8, 2.6].map((p, i) => leit(0, 0, p, i * 1000));
  const e1 = estadoAquecimento(caindo, 9000);
  assert.equal(e1.pronto, false, "ainda melhorando");
  const estavel = [...caindo, ...[2.6, 2.7, 2.6, 2.6, 2.7, 2.6].map((p, i) => leit(0, 0, p, (10 + i) * 1000))];
  assert.equal(estadoAquecimento(estavel, 15000).pronto, true);
  assert.equal(estadoAquecimento(caindo.slice(0, 3), 2000).pronto, false, "acabou de ligar");
  assert.equal(estadoAquecimento([leit(0, 0, 9, 0), leit(0, 0, 3, 50000)], 50000).pronto, true, "passou do tempo máximo");
  assert.equal(estadoAquecimento([leit(0, 0, 0.02, 0, { fonte: "receptor", fix: "rtk-fixo" })], 0).pronto, true);
  assert.equal(estadoAquecimento([leit(0, 0, 0, 0, { fonte: "receptor", fix: "sem-fix" })], 0).pronto, false);
});

// ---------------------------------------------------------------- convergência
test("convergência: o ponto médio para de andar depois que as leituras assentam", () => {
  const r = gerador(3);
  // 10 s puxando para leste (multicaminho), depois 30 s em volta da origem
  const ls = [
    ...Array.from({ length: 10 }, (_, i) => leit(3 + 0.3 * r(), 0.3 * r(), 3, i * 1000, { tGps: i })),
    ...Array.from({ length: 30 }, (_, i) => leit(0.3 * r(), 0.3 * r(), 3, (10 + i) * 1000, { tGps: 10 + i })),
  ];
  const c = convergencia(ls);
  assert.equal(c.n, 40);
  assert.ok(c.estavelHaS > 3 && c.estavelHaS < 40, `estável há ${c.estavelHaS} s`);
  const curto = convergencia(ls.slice(0, 12));
  assert.ok(curto.estavelHaS < c.estavelHaS);
  assert.equal(convergencia([]), null);
});

// ---------------------------------------------------------------- filtro do Caminhar
test("filtro do Caminhar: recusa o salto de 20 m em 1 s e segue quem anda", () => {
  const f = criarFiltroCaminhar();
  const r = gerador(11);
  let recusadas = 0;
  const saida = [];
  for (let i = 0; i < 60; i++) {
    const salto = i === 30 ? 20 : 0;
    const l = leit(i * 1.2 + 0.8 * r() + salto, 0.8 * r(), 2, i * 1000);
    const o = f.passar(l);
    if (!o) recusadas++; else saida.push({ o, x: i * 1.2 });
  }
  assert.equal(recusadas, 1, "só o salto");
  // filtrado fica perto do caminho verdadeiro (erro médio menor que o do ruído bruto)
  const erro = saida.slice(5).reduce((s, { o, x }) => s + distanciaM(o, P(x, 0)), 0) / (saida.length - 5);
  assert.ok(erro < 0.9, `erro médio ${erro}`);
  // três saltos seguidos = quem errou foi o filtro: aceita e recomeça
  const g = criarFiltroCaminhar();
  g.passar(leit(0, 0, 2, 0)); g.passar(leit(1, 0, 2, 1000));
  assert.equal(g.passar(leit(50, 0, 2, 2000)), null);
  assert.equal(g.passar(leit(51, 0, 2, 3000)), null);
  assert.equal(g.passar(leit(52, 0, 2, 4000)), null);
  assert.ok(g.passar(leit(53, 0, 2, 5000)));
});

// ---------------------------------------------------------------- calibração
test("calibração: deslocamento verdadeiro − medido e aplicação pelo bruto", () => {
  const conhecido = P(0, 0);
  const medido = P(-2, 1.5); // o GPS do celular estava 2 m a oeste e 1,5 m ao norte
  const d = deslocamento(conhecido, medido);
  assert.ok(Math.abs(d.dE - 2) < 0.005 && Math.abs(d.dN + 1.5) < 0.005, JSON.stringify(d));
  const cal = novaCalibracao("Marco", conhecido, { ...medido, precisao: 3, leituras: 60 }, 1000, "c1");
  const v = { ...P(48, 51.5), precisao: 3, t: 2000, modo: "caminhar" };
  const c = calibrarVertice(v, [cal]);
  assert.ok(distanciaM(c, P(50, 50)) < 0.01, "o vértice anda o mesmo deslocamento");
  assert.deepEqual(c.bruto, { lon: v.lon, lat: v.lat });
  // recalibrar parte do bruto (não acumula)
  const c2 = calibrarVertice(c, [cal]);
  assert.ok(distanciaM(c2, c) < 1e-6);
  // sem calibração volta ao bruto
  const c3 = calibrarVertice(c, []);
  assert.ok(distanciaM(c3, v) < 1e-6);
  assert.equal(c3.bruto, undefined);
  // à mão não muda
  const mao = { ...P(0, 0), precisao: null, t: 0, modo: "mao" };
  assert.equal(calibrarVertice(mao, [cal]), mao);
  assert.match(textoDeslocamento(cal), /^2,5 m para sudeste$/);
});

test("calibração: duas calibrações interpolam no tempo", () => {
  const a = { id: "a", rotulo: "", conhecido: P(0, 0), medido: { ...P(0, 0), precisao: 3, leituras: 1 }, dE: 2, dN: 0, t: 0 };
  const b = { id: "b", rotulo: "", conhecido: P(0, 0), medido: { ...P(0, 0), precisao: 3, leituras: 1 }, dE: 0, dN: 4, t: 1000 };
  assert.deepEqual(correcaoNoTempo([b, a], -5), { dE: 2, dN: 0 });
  assert.deepEqual(correcaoNoTempo([a, b], 500), { dE: 1, dN: 2 });
  assert.deepEqual(correcaoNoTempo([a, b], 9999), { dE: 0, dN: 4 });
  assert.equal(correcaoNoTempo([], 0), null);
  const vs = aplicarCalibracoes([{ ...P(0, 0), precisao: 3, t: 500, modo: "ponto" }], [a, b]);
  assert.ok(distanciaM(vs[0], P(1, 2)) < 0.01);
});

test("calibração: marcos SIGEF perto, sem repetir a divisa; coordenada digitada", () => {
  const anel = (pts) => [...pts, pts[0]].map(({ lon, lat }) => [lon, lat]);
  const parcelas = { features: [
    { properties: { codigo: "abc", nome: "FAZENDA A" }, geometry: { type: "Polygon", coordinates: [anel([P(10, 0), P(100, 0), P(100, 100), P(10, 100)])] } },
    { properties: { codigo: "def", nome: "FAZENDA B" }, geometry: { type: "MultiPolygon", coordinates: [[anel([P(100, 0), P(200, 0), P(200, 100), P(100, 100)])]] } },
  ] };
  const m = marcosProximos(parcelas, P(0, 0), 150);
  assert.equal(m[0].rotulo, "SIGEF · FAZENDA A · vértice 1");
  assert.ok(Math.abs(m[0].distM - 10) < 0.05);
  // (100,0) e (100,100) são das duas: aparecem uma vez
  assert.equal(m.filter((x) => distanciaM(x, P(100, 0)) < 0.1).length, 1);
  assert.ok(m.every((x) => x.distM <= 150));
  const c = lerCoordenadaMarco("-12,6915, -39,1262");
  assert.ok(distanciaM(c, { lon: -39.1262, lat: -12.6915 }) < 0.01);
  assert.ok("lon" in lerCoordenadaMarco("-12.6915 -39.1262"));
  assert.ok("erro" in lerCoordenadaMarco("48.85, 2.35"), "fora do Brasil");
  const u = lerCoordenadaMarco("512345,67 8634567,89 24");
  assert.ok("lon" in u && u.lon < -38 && u.lon > -40);
  assert.ok("erro" in lerCoordenadaMarco("abc"));
});

// ---------------------------------------------------------------- ajuste da cerca
/** anda o retângulo (cantos em metros) com ruído, pelo modo Caminhar, e devolve os vértices */
function andar(cantos, { sigma = 1, semente = 5, passoLeitura = 1 } = {}) {
  const r = gerador(semente);
  const vs = [];
  let t = 0;
  // erro de multicaminho que anda devagar (comum a leituras próximas) + ruído branco
  let bx = 0, by = 0;
  const volta = [...cantos, cantos[0]];
  for (let k = 0; k < cantos.length; k++) {
    const [x0, y0] = volta[k], [x1, y1] = volta[k + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    for (let d = 0; d < L; d += passoLeitura) {
      bx = 0.98 * bx + 0.2 * sigma * r(); by = 0.98 * by + 0.2 * sigma * r();
      const f = d / L;
      const l = leit(x0 + (x1 - x0) * f + bx + 0.5 * sigma * r(), y0 + (y1 - y0) * f + by + 0.5 * sigma * r(), 2.5 * sigma, (t += 1000));
      const res = verticeAoCaminhar(vs, l, OPCOES_PADRAO);
      if (res) vs.push(res.vertice);
    }
  }
  return vs;
}

test("ajuste da cerca: a cerca de 4 lados volta com 4 cantos; com sinal bom o canto fica 2× mais perto", () => {
  const cantos = [[0, 0], [150, 0], [150, 100], [0, 100]];
  const verdade = 15000;
  // erro de canto: a distância do canto verdadeiro ao vértice mais perto
  const erroCantos = (vs) => cantos.reduce((s, [x, y]) => s + Math.min(...vs.map((v) => distanciaM(v, P(x, y)))), 0) / cantos.length;
  const N = 12;
  for (const sigma of [0.3, 1]) {
    let cantoBruto = 0, cantoAjust = 0, areaBruta = 0, areaAjust = 0;
    for (let s = 1; s <= N; s++) {
      const vs = andar(cantos, { semente: s, sigma });
      const aj = ajustarCerca(vs);
      assert.equal(aj.depois, 4, `sigma ${sigma}, semente ${s}: ${aj.depois} vértices`);
      cantoBruto += erroCantos(vs); cantoAjust += erroCantos(aj.vertices);
      areaBruta += Math.abs(medir(vs).areaM2 - verdade); areaAjust += Math.abs(aj.areaDepoisM2 - verdade);
    }
    // a área não piora (≤ 15% a mais de erro que a andada)
    assert.ok(areaAjust <= areaBruta * 1.15, `sigma ${sigma}: área andada ${(areaBruta / N).toFixed(0)} m², ajustada ${(areaAjust / N).toFixed(0)} m²`);
    // sinal bom: o canto ajustado fica bem mais perto que o vértice andado mais perto do canto
    if (sigma < 0.5) assert.ok(cantoAjust < 0.7 * cantoBruto, `canto: andado ${(cantoBruto / N).toFixed(2)} m, ajustado ${(cantoAjust / N).toFixed(2)} m`);
  }
});

test("ajuste da cerca: canto marcado de propósito não sai do lugar; sem Caminhar não mexe", () => {
  const vs = andar([[0, 0], [120, 0], [120, 80], [0, 80]], { semente: 9 });
  const fixo = { ...P(120, 0), precisao: 2, t: 1, modo: "ponto" };
  // põe o ponto marcado no lugar do vértice mais perto do canto (120, 0)
  let k = 0, dmin = Infinity;
  vs.forEach((v, i) => { const d = distanciaM(v, P(120, 0)); if (d < dmin) { dmin = d; k = i; } });
  vs[k] = fixo;
  const aj = ajustarCerca(vs);
  assert.ok(aj.vertices.includes(fixo), "o ponto marcado continua igual");
  assert.ok(valeAjustar(aj));
  const mao = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)].map((p) => ({ ...p, precisao: null, t: 0, modo: "mao" }));
  assert.equal(ajustarCerca(mao).vertices, mao);
});

test("ajuste da cerca: canto calibrado leva o bruto junto", () => {
  const vs = andar([[0, 0], [100, 0], [100, 100], [0, 100]], { semente: 4 })
    .map((v) => ({ ...v, bruto: { lon: v.lon, lat: v.lat }, correcao: { dE: 0, dN: 0 } }));
  const aj = ajustarCerca(vs);
  const movido = aj.vertices.find((v) => v.ajustado);
  assert.ok(movido, "algum canto foi recolocado");
  assert.ok(distanciaM(movido.bruto, movido) < 1e-6, "com deslocamento zero, bruto = canto novo");
});

// ---------------------------------------------------------------- diagnóstico
test("diagnóstico: grava, lê, tem teto e volta do arquivo", () => {
  const m = new Map();
  const arm = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  assert.equal(gravarDiagnostico(arm, [leit(0, 0, 3, 1, { tGps: 1, extra: "x" })]), 1);
  assert.equal(lerDiagnostico(arm)[0].extra, undefined, "só os campos que importam");
  const muitas = Array.from({ length: MAX_LEITURAS_DIAG + 10 }, (_, i) => leit(0, 0, 3, i));
  assert.equal(gravarDiagnostico(arm, muitas), MAX_LEITURAS_DIAG);
  const arq = arquivoDiagnostico(lerDiagnostico(arm).slice(0, 3), "teste");
  assert.equal(lerArquivoDiagnostico(JSON.stringify(arq)).length, 3);
  assert.equal(lerArquivoDiagnostico("[]"), null);
  assert.equal(lerArquivoDiagnostico("lixo"), null);
  const e = errosContra([leit(1, 0), leit(2, 0), leit(3, 0), leit(4, 0)], P(0, 0), distanciaM);
  assert.equal(e.n, 4);
  assert.ok(Math.abs(e.mediaM - 2.5) < 0.01);
});
