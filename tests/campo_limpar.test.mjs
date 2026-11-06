// "Limpar vértices em linha reta" (Medir no campo, src/lib/campo/simplificar.ts):
// Douglas–Peucker em metros UTM, tolerância da ordem da precisão (~1 m).
//  • o trajeto do laboratório (121 vértices do Caminhar, GPS ±3,3 m) fica com
//    bem menos vértices e a área muda menos que a incerteza do próprio GPS;
//  • cerca reta com 5 m entre vértices vira os 4 cantos, a área não muda;
//  • vértice marcado de propósito ("Marcar ponto aqui", tocado no mapa) fica;
//  • nunca menos de 3 vértices; tolerância inválida não mexe em nada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verticeAoCaminhar } from "../src/lib/campo/motor.ts";
import { TRAJETO_EXEMPLO } from "../src/lib/campo/trajeto_exemplo.ts";
import { OPCOES_PADRAO } from "../src/lib/campo/tipos.ts";
import { deslocar, medir } from "../src/lib/campo/geometria.ts";
import { limparLinhaReta, toleranciaPadrao, valeLimpar } from "../src/lib/campo/simplificar.ts";

const ORIGEM = [-41.39, -12.56];
const v = (p, modo = "caminhar", precisao = 2) => ({ lon: p[0], lat: p[1], precisao, t: 0, modo });

/** quadrado de `lado` m com um vértice a cada `passo` m, andando no sentido anti-horário */
function quadradoAndado(lado, passo, ruido = () => 0) {
  const cantos = [[0, 0], [lado, 0], [lado, lado], [0, lado]];
  const vs = [];
  for (let k = 0; k < 4; k++) {
    const [x0, y0] = cantos[k], [x1, y1] = cantos[(k + 1) % 4];
    for (let d = 0; d < lado; d += passo) {
      const t = d / lado;
      vs.push(v(deslocar(ORIGEM, x0 + (x1 - x0) * t + ruido(), y0 + (y1 - y0) * t + ruido())));
    }
  }
  return vs;
}

test("trajeto do laboratório: 121 vértices do Caminhar viram poucos, e a área muda menos que o erro do GPS", () => {
  const vs = [];
  for (const l of TRAJETO_EXEMPLO) { const r = verticeAoCaminhar(vs, l, OPCOES_PADRAO); if (r) vs.push(r.vertice); }
  assert.equal(vs.length, 121);
  const tol = toleranciaPadrao(vs);
  assert.ok(tol >= 0.5 && tol <= 1.5, `tolerância ${tol} m (cerca de 1 m)`);
  const l = limparLinhaReta(vs);
  assert.ok(l.depois <= 30 && l.depois >= 4, `${l.antes} → ${l.depois}`);
  assert.ok(valeLimpar(l));
  const dif = Math.abs(l.areaDepoisM2 - l.areaAntesM2);
  assert.ok(dif / l.areaAntesM2 < 0.003, `área mudou ${dif.toFixed(1)} m² (${((dif / l.areaAntesM2) * 100).toFixed(2)}%)`);
  assert.ok(l.incertezaM2 > dif * 10, `a diferença (${dif.toFixed(0)} m²) fica muito abaixo da incerteza do GPS (${l.incertezaM2.toFixed(0)} m²)`);
  // os vértices que ficam são os medidos (nenhum inventado), na mesma ordem
  let j = 0;
  for (const x of l.vertices) { while (vs[j] !== x) j++; assert.ok(j < vs.length); }
});

test("cerca reta: o quadrado andado de 5 em 5 m vira os 4 cantos, com a mesma área", () => {
  const vs = quadradoAndado(100, 5);
  assert.equal(vs.length, 80);
  const l = limparLinhaReta(vs, 1);
  assert.equal(l.depois, 4);
  assert.ok(Math.abs(l.areaDepoisM2 - l.areaAntesM2) < 0.01, `${l.areaAntesM2} → ${l.areaDepoisM2}`);
  assert.ok(Math.abs(l.areaDepoisM2 - 10_000) < 50, `100 m × 100 m (o deslocar é por metros/grau, não UTM): ${l.areaDepoisM2}`);
});

test("vértice marcado de propósito nunca sai; o resto da cerca reta sai", () => {
  const vs = quadradoAndado(100, 5);
  vs[7] = { ...vs[7], modo: "ponto", leituras: 12 }; // um marco no meio da 1ª cerca
  vs[50] = { ...vs[50], modo: "mao", precisao: null }; // tocado no mapa
  const l = limparLinhaReta(vs, 1);
  assert.ok(l.vertices.includes(vs[7]) && l.vertices.includes(vs[50]));
  assert.equal(l.depois, 6, "4 cantos + os 2 marcados");
});

test("nunca menos de 3 vértices; poucos vértices ou tolerância inválida não mexem", () => {
  const tri = [v(ORIGEM), v(deslocar(ORIGEM, 50, 0)), v(deslocar(ORIGEM, 0, 50))];
  assert.equal(limparLinhaReta(tri, 5).depois, 3);
  const vs = quadradoAndado(100, 5);
  assert.equal(limparLinhaReta(vs, 0).depois, vs.length);
  assert.equal(limparLinhaReta(vs, Number.NaN).depois, vs.length);
  // linha quase reta (lasca): os 3 que sobram ainda formam o contorno
  const lasca = [0, 10, 20, 30, 40].map((x) => v(deslocar(ORIGEM, x, x === 20 ? 0.2 : 0)));
  assert.ok(limparLinhaReta(lasca, 1).depois >= 3);
  // à mão: sem incerteza do GPS
  const mao = quadradoAndado(100, 5).map((x) => ({ ...x, precisao: null }));
  assert.equal(limparLinhaReta(mao, 1).incertezaM2, null);
  assert.equal(medir(limparLinhaReta(mao, 1).vertices).n, 4);
});
