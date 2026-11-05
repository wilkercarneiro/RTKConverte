// Curvas de nível do imóvel (serviço GEO): grade, ajuste aos vértices,
// marching squares, intervalo automático e exportação DXF/KML.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ajustarAosVertices, comprimento, cotaBilinear, curvasDeNivel, dentroDosAneis, ehMestra, intervaloAutomatico, reamostrar,
} from "../src/lib/relevo/curvas.ts";
import { calcularRelevo } from "../src/lib/relevo/modelo.ts";
import { curvasParaDxf, curvasParaKml } from "../src/lib/relevo/exportar.ts";

const E0 = 490000, N0 = 8730000;
function grade(nx, ny, passo, f) {
  const h = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = f(E0 + i * passo, N0 + j * passo);
  return { e0: E0, n0: N0, passo, nx, ny, h };
}
const quadrado = (x0, y0, L) => [[x0, y0], [x0 + L, y0], [x0 + L, y0 + L], [x0, y0 + L]];

test("plano inclinado: curvas retas, paralelas, no espaçamento certo", () => {
  // cota sobe 1 m a cada 10 m para leste (10 %): curva de 1 m a cada 10 m
  const g = grade(101, 101, 5, (e) => 300 + (e - E0) / 10);
  const curvas = curvasDeNivel(g, 1);
  assert.ok(curvas.length >= 49, `poucas curvas: ${curvas.length}`);
  const xs = [];
  for (const c of curvas) {
    assert.equal(c.fechada, false);
    const x = c.pts[0][0];
    // reta norte-sul: todo ponto na mesma abscissa, e a abscissa é a da cota
    for (const p of c.pts) assert.ok(Math.abs(p[0] - x) < 1e-6, "curva não é reta");
    assert.ok(Math.abs(x - (E0 + (c.cota - 300) * 10)) < 1e-6, `curva ${c.cota} fora do lugar`);
    // corre a grade de ponta a ponta (uma polilinha só, simplificada a 2 pontos)
    assert.equal(c.pts.length, 2);
    assert.ok(Math.abs(comprimento(c.pts) - 500) < 1e-6);
    xs.push(x);
  }
  xs.sort((a, b) => a - b);
  for (let k = 1; k < xs.length; k++) assert.ok(Math.abs(xs[k] - xs[k - 1] - 10) < 1e-6, "espaçamento errado");
  // mestras a cada 5 m (305, 310…)
  for (const c of curvas) assert.equal(c.mestra, Math.round(c.cota) % 5 === 0);
});

test("cone: curvas fechadas e circulares no raio certo", () => {
  // cone de 100 m de altura, 1 m de cota a cada 2 m de raio
  const cx = E0 + 200, cy = N0 + 200;
  const g = grade(201, 201, 2, (e, n) => 400 - Math.hypot(e - cx, n - cy) / 2);
  const curvas = curvasDeNivel(g, 5);
  assert.ok(curvas.length >= 15);
  for (const c of curvas) {
    const r = (400 - c.cota) * 2;
    if (r < 6 || r > 190) continue; // ponta e borda da grade
    assert.ok(c.fechada, `curva ${c.cota} deveria fechar`);
    for (const p of c.pts) {
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      assert.ok(Math.abs(d - r) < 0.15, `curva ${c.cota}: raio ${d.toFixed(3)} ≠ ${r}`);
    }
  }
});

test("recorte pelo imóvel: nenhuma curva sai do perímetro", () => {
  const g = grade(101, 101, 5, (e, n) => 300 + (e - E0) / 10 + (n - N0) / 25);
  const anel = [[E0 + 50, N0 + 40], [E0 + 400, N0 + 80], [E0 + 300, N0 + 260], [E0 + 200, N0 + 150], [E0 + 80, N0 + 420]];
  const curvas = curvasDeNivel(g, 1, [anel]);
  assert.ok(curvas.length > 10);
  for (const c of curvas) for (let i = 1; i < c.pts.length; i++) {
    const m = [(c.pts[i][0] + c.pts[i - 1][0]) / 2, (c.pts[i][1] + c.pts[i - 1][1]) / 2];
    assert.ok(dentroDosAneis(m, [anel]), "trecho de curva fora do imóvel");
  }
});

test("ajuste aos vértices: a grade passa nas cotas dos marcos", () => {
  // modelo "público" com viés inclinado e ruído; o levantamento é a verdade
  const verdade = (e, n) => 250 + 0.02 * (e - E0) + 8 * Math.sin((n - N0) / 180);
  const dem = grade(81, 81, 15, (e, n) => verdade(e, n) - 3 + 0.004 * (e - E0) + 1.2 * Math.sin(e / 37));
  const anel = [[E0 + 100, N0 + 100], [E0 + 1000, N0 + 160], [E0 + 1080, N0 + 900], [E0 + 520, N0 + 1100], [E0 + 140, N0 + 820]];
  // marcos ao longo da divisa (a cada ~40 m)
  const pts = [];
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s < L; s += 40) pts.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]);
  }
  const hs = pts.map((p) => verdade(p[0], p[1]));
  const g = reamostrar(dem, pts, 5);
  const st = ajustarAosVertices(g, pts, hs);
  assert.equal(st.n, pts.length);
  assert.ok(st.rmsAntes > 1, "o modelo de teste devia ter erro antes");
  assert.ok(st.maxDepois < 0.01, `sobrou ${st.maxDepois} m nos marcos`);
  for (let k = 0; k < pts.length; k++) assert.ok(Math.abs(cotaBilinear(g, pts[k]) - hs[k]) < 0.01);
  // e no miolo a correção melhora o modelo (o plano de tendência tira o viés)
  let e1 = 0, e2 = 0, n = 0;
  for (let x = 300; x <= 900; x += 50) for (let y = 300; y <= 900; y += 50) {
    const c = [E0 + x, N0 + y];
    e1 += (cotaBilinear(dem, c) - verdade(...c)) ** 2; e2 += (cotaBilinear(g, c) - verdade(...c)) ** 2; n++;
  }
  // o que sobra é o ruído de 1,2 m de amplitude (RMS 0,85), que nenhum ajuste pelos marcos tira
  assert.ok(Math.sqrt(e2 / n) < Math.sqrt(e1 / n) && Math.sqrt(e2 / n) < 0.95, `miolo: RMS ${Math.sqrt(e2 / n).toFixed(2)} vs ${Math.sqrt(e1 / n).toFixed(2)}`);
});

test("sem modelo público: superfície só dos marcos ainda bate neles", () => {
  const anel = quadrado(E0, N0, 300);
  const hs = [300, 310, 320, 305];
  const r = calcularRelevo({ base: null, pts: anel, hs, aneis: [anel], intervalo: null });
  assert.equal(r.fonte, "marcos");
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(cotaBilinear(r.grade, anel[k]) - hs[k]) < 0.01);
  assert.ok(r.curvas.length > 0);
});

test("intervalo automático e mestras", () => {
  assert.equal(intervaloAutomatico(8), 1);
  assert.equal(intervaloAutomatico(30), 1);
  assert.equal(intervaloAutomatico(36), 2);
  assert.equal(intervaloAutomatico(60), 2);
  assert.equal(intervaloAutomatico(150), 5);
  assert.equal(intervaloAutomatico(600), 10);
  assert.ok(ehMestra(310, 2) && !ehMestra(312, 2) && ehMestra(320, 2));
  assert.ok(ehMestra(305, 1) && !ehMestra(306, 1));
  assert.ok(ehMestra(350, 10) && !ehMestra(360, 10));
});

test("imóvel grande (500 ha): modelo + curvas em tempo aceitável", () => {
  // 2,24 km × 2,24 km, 400 marcos na divisa, relevo ondulado
  const L = 2236;
  const anel = quadrado(E0, N0, L);
  const f = (e, n) => 280 + 40 * Math.sin((e - E0) / 400) * Math.cos((n - N0) / 520) + (e - E0) / 60;
  const dem = grade(Math.ceil((L + 200) / 30) + 1, Math.ceil((L + 200) / 30) + 1, 30, (e, n) => f(e - 100, n - 100) + 2);
  dem.e0 -= 100; dem.n0 -= 100;
  const pts = [];
  for (let i = 0; i < 4; i++) {
    const a = anel[i], b = anel[(i + 1) % 4];
    for (let s = 0; s < 100; s++) pts.push([a[0] + ((b[0] - a[0]) * s) / 100, a[1] + ((b[1] - a[1]) * s) / 100]);
  }
  const hs = pts.map((p) => f(p[0], p[1]));
  const t0 = performance.now();
  const r = calcularRelevo({ base: dem, pts, hs, aneis: [anel], intervalo: null });
  const ms = performance.now() - t0;
  console.log(`500 ha: grade ${r.grade.nx}×${r.grade.ny} (passo ${r.grade.passo} m), ${r.curvas.length} curvas de ${r.intervalo} m, modelo ${r.ms.modelo} ms + curvas ${r.ms.curvas} ms = ${ms.toFixed(0)} ms`);
  assert.ok(r.ajuste.maxDepois < 0.02);
  assert.ok(ms < 8000, `lento demais: ${ms} ms`);
});

test("DXF: camadas de mestras e intermediárias com a cota como elevação e texto", () => {
  const g = grade(41, 41, 5, (e) => 300 + (e - E0) / 10);
  const anel = quadrado(E0 + 10, N0 + 10, 180);
  const curvas = curvasDeNivel(g, 1, [anel]);
  const dxf = curvasParaDxf({ curvas, intervalo: 1, aneis: [anel], nome: "FAZENDA TESTE", fuso: 24, marcos: [{ texto: "XXXX-M-0001", p: anel[0], h: 301 }] });
  const linhas = dxf.split("\r\n");
  // tabela de camadas
  assert.ok(dxf.includes("\r\n2\r\nCURVAS_MESTRAS\r\n") && dxf.includes("\r\n2\r\nCURVAS_INTERMEDIARIAS\r\n"));
  // POLYLINE da curva 305 na camada de mestras, elevação 305
  const polis = [];
  for (let i = 0; i < linhas.length - 1; i += 2) if (linhas[i] === "0" && linhas[i + 1] === "POLYLINE") polis.push(i);
  let achou305 = false, achou303 = false;
  for (const i of polis) {
    const camada = linhas[i + 3], z = Number(linhas[i + 13]);
    if (camada === "CURVAS_MESTRAS" && z === 305) achou305 = true;
    if (camada === "CURVAS_INTERMEDIARIAS" && z === 303) achou303 = true;
  }
  assert.ok(achou305, "mestra 305 com elevação");
  assert.ok(achou303, "intermediária 303 com elevação");
  // a cota escrita nas mestras
  assert.match(dxf, /\r\nTEXT\r\n8\r\nCURVAS_MESTRAS\r\n[\s\S]*?\r\n1\r\n305\r\n/);
  assert.ok(dxf.trimEnd().endsWith("EOF"));
  assert.ok(dxf.includes("NOTA_RELEVO") && dxf.includes("modelo digital de elevacao publico"));
});

test("KML: pastas de mestras e intermediárias, coordenadas geográficas com a cota", () => {
  const g = grade(41, 41, 5, (e) => 300 + (e - E0) / 10);
  const anel = quadrado(E0 + 10, N0 + 10, 180);
  const curvas = curvasDeNivel(g, 1, [anel]);
  const kml = curvasParaKml({ curvas, intervalo: 1, aneis: [anel], nome: "FAZENDA TESTE", fuso: 24 });
  assert.ok(kml.startsWith("<?xml") && kml.trimEnd().endsWith("</kml>"));
  assert.ok(kml.includes("<name>Curvas mestras</name>") && kml.includes("<name>Curvas intermediárias</name>"));
  assert.ok(kml.includes("<name>305 m</name>"));
  const m = kml.match(/<coordinates>([-\d.]+),([-\d.]+),305\.00/);
  assert.ok(m, "coordenada com a cota 305");
  const lon = Number(m[1]), lat = Number(m[2]);
  // fuso 24 S: longitude perto de −39°, latitude ~ −11°
  assert.ok(lon > -42 && lon < -36 && lat > -13 && lat < -10, `${lon}, ${lat}`);
  assert.ok(kml.includes("não é levantamento planialtimétrico"));
});
