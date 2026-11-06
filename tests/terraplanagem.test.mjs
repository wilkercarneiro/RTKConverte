// Terraplanagem: TIN, volumes por prisma com corte parcial, cota de
// equilíbrio por bisseção e taludes — conferidos contra a geometria de
// resposta conhecida (caixa, plano inclinado, pirâmide, tronco com talude) e
// contra a invariância a rotação.
import { test } from "node:test";
import assert from "node:assert/strict";
import { delaunay, montarTin, IndiceTin } from "../src/lib/terraplanagem/tin.ts";
import { calcularTerraplanagem, positivoNoTriangulo } from "../src/lib/terraplanagem/calculo.ts";
import { projetoNovo } from "../src/lib/terraplanagem/modelo.ts";

const E0 = 512000, N0 = 8590000;

/** Pontos numa grade regular (com um leve deslocamento para não ficar cocircular demais). */
function grade(lx, ly, passo, f, giro = 0, centro = [E0 + lx / 2, N0 + ly / 2]) {
  const pts = [];
  const c = Math.cos((giro * Math.PI) / 180), s = Math.sin((giro * Math.PI) / 180);
  let k = 0;
  for (let y = 0; y <= ly + 1e-9; y += passo) for (let x = 0; x <= lx + 1e-9; x += passo) {
    const z = f(x, y);
    const dx = E0 + x - centro[0], dy = N0 + y - centro[1];
    pts.push({ nome: String(++k), e: centro[0] + c * dx - s * dy, n: centro[1] + s * dx + c * dy, z });
  }
  return pts;
}

function projeto(pontos, ajustes = {}) {
  const p = projetoNovo("teste", pontos, { tipo: "arquivo", arquivo: "teste.txt" });
  return { ...p, ...ajustes, plataforma: { ...p.plataforma, ...(ajustes.plataforma ?? {}) }, cota: { ...p.cota, ...(ajustes.cota ?? {}) }, taludes: { ...p.taludes, ...(ajustes.taludes ?? {}) }, fatores: { ...p.fatores, ...(ajustes.fatores ?? {}) } };
}

const perto = (v, alvo, tolRel, msg) => assert.ok(Math.abs(v - alvo) <= Math.abs(alvo) * tolRel + 1e-6, `${msg}: ${v} ≠ ${alvo}`);

test("Delaunay: quadrado com ponto no meio vira 4 triângulos, todos anti-horários", () => {
  const xs = [0, 10, 10, 0, 5], ys = [0, 0, 10, 10, 5];
  const t = delaunay(xs, ys);
  assert.equal(t.length / 3, 4);
  for (let k = 0; k < t.length; k += 3) {
    const [a, b, c] = [t[k], t[k + 1], t[k + 2]];
    assert.ok((xs[b] - xs[a]) * (ys[c] - ys[a]) - (ys[b] - ys[a]) * (xs[c] - xs[a]) > 0);
  }
});

test("Delaunay: 2000 pontos aleatórios — nenhum ponto dentro do círculo de um triângulo", () => {
  let semente = 7;
  const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
  const xs = [], ys = [];
  for (let i = 0; i < 2000; i++) { xs.push(E0 + rnd() * 300); ys.push(N0 + rnd() * 200); }
  const t = delaunay(xs, ys);
  // Euler: triângulos = 2n − 2 − h (h = pontos no fecho); confere a ordem de grandeza
  assert.ok(t.length / 3 > 3900 && t.length / 3 < 4000, `triângulos: ${t.length / 3}`);
  // amostra de triângulos: círculo vazio
  for (let k = 0; k < t.length; k += 3 * 37) {
    const [a, b, c] = [t[k], t[k + 1], t[k + 2]];
    const ax = xs[a] - E0, ay = ys[a] - N0, bx = xs[b] - E0, by = ys[b] - N0, cx = xs[c] - E0, cy = ys[c] - N0;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const r2 = (ax - ux) ** 2 + (ay - uy) ** 2;
    for (let i = 0; i < xs.length; i++) {
      if (i === a || i === b || i === c) continue;
      assert.ok((xs[i] - E0 - ux) ** 2 + (ys[i] - N0 - uy) ** 2 >= r2 * (1 - 1e-7), "ponto dentro do círculo circunscrito");
    }
  }
});

test("TIN: levantamento em L — a borda não liga as pontas por cima do canto vazio", () => {
  const pts = grade(100, 100, 5, () => 10).filter((p) => !(p.e - E0 > 52 && p.n - N0 > 52));
  const tin = montarTin(pts);
  const idx = new IndiceTin(tin);
  assert.ok(Number.isNaN(idx.cota(E0 + 80, N0 + 80)), "o canto vazio ficou coberto");
  assert.equal(idx.cota(E0 + 20, N0 + 20), 10);
  // área do contorno ≈ área do L (10 000 − 50² = 7 500)
  let a = 0; const c = tin.contorno;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) a += c[j][0] * c[i][1] - c[i][0] * c[j][1];
  perto(Math.abs(a / 2), 100 * 100 - 50 * 50, 0.02, "área do contorno em L");
});

test("integral fechada da parte positiva no triângulo", () => {
  // tudo positivo: média × área
  assert.equal(positivoNoTriangulo(6, 1, 2, 3).v, 12);
  // um vértice positivo: tetraedro
  const r = positivoNoTriangulo(1, 1, -1, -1);
  assert.ok(Math.abs(r.v - 1 / 12) < 1e-12 && Math.abs(r.area - 0.25) < 1e-12);
  // dois positivos: total + parte negativa
  const s = positivoNoTriangulo(1, 1, 1, -1);
  assert.ok(Math.abs(s.v - (1 / 3 + 1 / 12)) < 1e-12);
});

test("caixa conhecida: terreno plano a 10 m, plataforma 40 × 20 m a 12 m, talude a prumo → 1 600 m³ de aterro", () => {
  const pts = grade(100, 80, 4, () => 10);
  const r = calcularTerraplanagem(projeto(pts, {
    plataforma: { modo: "retangulo", retangulo: { centro: [E0 + 50, N0 + 40], largura: 20, comprimento: 40, giro: 90 } },
    cota: { modo: "fixa", valor: 12 }, taludes: { corte: 0, aterro: 0 },
  }));
  perto(r.aterro, 1600, 1e-6, "aterro");
  assert.ok(r.corte < 1e-6, `corte ${r.corte}`);
  perto(r.areaPlataforma, 800, 1e-9, "área");
  perto(r.areaAterro, 800, 1e-6, "área de aterro");
});

test("caixa com talude 1:1,5: plataforma + prismas dos lados + quarto de cone nos cantos", () => {
  const pts = grade(100, 100, 2, () => 10);
  const r = calcularTerraplanagem(projeto(pts, {
    plataforma: { modo: "retangulo", retangulo: { centro: [E0 + 50, N0 + 50], largura: 20, comprimento: 20, giro: 0 } },
    cota: { modo: "fixa", valor: 12 }, taludes: { corte: 1, aterro: 1.5 },
  }));
  // 20×20×2 + perímetro 80 × (½ × 3 × 2) + cone (r 3, h 2)
  const esperado = 800 + 80 * 3 + (Math.PI * 9 * 2) / 3;
  perto(r.aterro, esperado, 0.01, "aterro com talude");
  // o pé do talude fica a 3 m da plataforma
  assert.ok(r.pe.length > 0, "sem linha de pé");
  const ds = r.pe.flat().map((q) => Math.max(Math.abs(q[0] - E0 - 50), Math.abs(q[1] - N0 - 50)) - 10);
  const medio = ds.reduce((s, v) => s + v, 0) / ds.length;
  assert.ok(Math.abs(medio - 3) < 0.4, `pé a ${medio} m`);
});

test("plano inclinado: plataforma com a mesma inclinação não move terra; horizontal no meio equilibra W·s·L²/8", () => {
  // sobe 5 % para o leste: cai para o oeste (azimute 270)
  const f = (x) => 100 + 0.05 * x;
  const pts = grade(120, 80, 4, f);
  const ret = { centro: [E0 + 60, N0 + 40], largura: 30, comprimento: 60, giro: 90 };
  const mesma = calcularTerraplanagem(projeto(pts, {
    plataforma: { modo: "retangulo", retangulo: ret },
    cota: { modo: "fixa", valor: f(60), inclinacao: 5, direcao: 270 }, taludes: { corte: 0, aterro: 0 },
  }));
  assert.ok(mesma.corte < 0.01 && mesma.aterro < 0.01, `moveu terra: ${mesma.corte} / ${mesma.aterro}`);
  const plana = calcularTerraplanagem(projeto(pts, {
    plataforma: { modo: "retangulo", retangulo: ret },
    cota: { modo: "equilibrio" }, taludes: { corte: 0, aterro: 0 },
  }));
  const esperado = (30 * 0.05 * 60 * 60) / 8;
  perto(plana.corte, esperado, 1e-6, "corte");
  perto(plana.aterro, esperado, 1e-6, "aterro");
  perto(plana.cota, f(60), 1e-6, "cota de equilíbrio");
  // linha de passagem: a reta no meio da plataforma
  assert.ok(plana.passagem.length >= 1);
  for (const q of plana.passagem.flat()) assert.ok(Math.abs(q[0] - (E0 + 60)) < 0.05, `passagem fora do meio: ${q[0] - E0}`);
});

test("pirâmide: volume de corte = base × altura / 3", () => {
  const pts = [
    { nome: "1", e: E0, n: N0, z: 0 }, { nome: "2", e: E0 + 60, n: N0, z: 0 },
    { nome: "3", e: E0 + 60, n: N0 + 60, z: 0 }, { nome: "4", e: E0, n: N0 + 60, z: 0 },
    { nome: "5", e: E0 + 30, n: N0 + 30, z: 9 },
  ];
  const r = calcularTerraplanagem(projeto(pts, {
    plataforma: { modo: "poligono", poligono: [[E0, N0], [E0 + 60, N0], [E0 + 60, N0 + 60], [E0, N0 + 60]] },
    cota: { modo: "fixa", valor: 0 }, taludes: { corte: 1, aterro: 1.5 },
  }));
  perto(r.corte, (60 * 60 * 9) / 3, 1e-6, "volume da pirâmide");
  assert.ok(r.aterro < 1e-6);
});

test("invariância a rotação: girar o levantamento e a plataforma não muda o volume", () => {
  const f = (x, y) => 50 + 0.04 * x - 0.03 * y + 1.5 * Math.sin(x / 17) * Math.cos(y / 13);
  const base = (giro) => {
    const centro = [E0 + 70, N0 + 50];
    const pts = grade(140, 100, 3, f, giro, centro);
    return calcularTerraplanagem(projeto(pts, {
      plataforma: { modo: "retangulo", retangulo: { centro, largura: 36, comprimento: 64, giro: 90 - giro } },
      cota: { modo: "fixa", valor: 52 }, taludes: { corte: 1, aterro: 1.5 },
    }));
  };
  const r0 = base(0);
  for (const g of [17, 33, 61]) {
    const r = base(g);
    perto(r.corte, r0.corte, 0.01, `corte girado ${g}°`);
    perto(r.aterro, r0.aterro, 0.01, `aterro girado ${g}°`);
  }
  assert.ok(r0.corte > 100 && r0.aterro > 100, "o teste precisa de corte e aterro");
});

test("equilíbrio: corte = aterro × compactação, e a cota sobe quando a compactação pede mais corte", () => {
  const f = (x, y) => 80 + 0.06 * x + 0.02 * y;
  const pts = grade(120, 90, 4, f);
  const ret = { centro: [E0 + 60, N0 + 45], largura: 40, comprimento: 60, giro: 90 };
  const r1 = calcularTerraplanagem(projeto(pts, { plataforma: { modo: "retangulo", retangulo: ret } }));
  perto(r1.corte, r1.aterro, 1e-3, "corte × aterro");
  assert.equal(r1.equilibrio, true);
  const r2 = calcularTerraplanagem(projeto(pts, { plataforma: { modo: "retangulo", retangulo: ret }, fatores: { compactacao: 1.2 } }));
  perto(r2.corte, r2.aterro * 1.2, 1e-3, "corte × aterro × 1,2");
  assert.ok(r2.cota < r1.cota, "mais corte pede plataforma mais baixa");
  assert.equal(r1.caminhoes.para, "interno");
});

test("caminhões: saldo com empolamento de 25 % em caçambas de 12 m³", () => {
  const pts = grade(100, 80, 4, () => 10);
  const r = calcularTerraplanagem(projeto(pts, {
    plataforma: { modo: "retangulo", retangulo: { centro: [E0 + 50, N0 + 40], largura: 20, comprimento: 40, giro: 90 } },
    cota: { modo: "fixa", valor: 9 }, taludes: { corte: 0, aterro: 0 },
  }));
  // 800 m³ de corte que sobram → 1 000 m³ soltos → 84 caminhões
  perto(r.corte, 800, 1e-6, "corte");
  assert.equal(r.caminhoes.para, "bota-fora");
  assert.equal(r.caminhoes.quantidade, Math.ceil(1000 / 12));
});

test("contorno automático: o talude cabe dentro do levantamento (sem aviso de borda)", () => {
  const f = (x, y) => 120 + 0.08 * x + 0.03 * y;
  const pts = grade(150, 110, 5, f);
  const r = calcularTerraplanagem(projeto(pts));
  assert.ok(r.folga > 0, "sem afastamento");
  assert.ok(!r.avisos.some((a) => a.includes("borda do levantamento")), r.avisos.join(" | "));
  assert.ok(r.areaPlataforma > 0.3 * 150 * 110, `plataforma pequena demais: ${r.areaPlataforma}`);
  perto(r.corte, r.aterro, 2e-3, "equilíbrio no contorno");
  assert.equal(r.secoes.length, 2);
});

test("plataforma fora dos pontos: erro claro, sem número inventado", () => {
  const pts = grade(50, 50, 5, () => 10);
  assert.throws(() => calcularTerraplanagem(projeto(pts, {
    plataforma: { modo: "retangulo", retangulo: { centro: [E0 + 500, N0 + 500], largura: 10, comprimento: 10, giro: 0 } },
  })), /fora da área levantada/);
});
