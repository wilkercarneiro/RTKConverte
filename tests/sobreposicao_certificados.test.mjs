// Correção de sobreposição com os vértices certificados do vizinho.
// Fixture: reference/THEREZA.txt (fuso 24S) + ArquivosExemplo/exportacao (n).csv —
// 5 parcelas com invasão real e 1 (CSV 9) que é a própria gleba já certificada.
// Ver PLANO-VERTICES-CERTIFICADOS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import proj4lib from "proj4";
import ClipperLib from "clipper-lib";
import { parseTxt, calcularVertices, GEO_DEF, utmDef, parseGmsPlanilha, gmsToDeg } from "../supabase/functions/_shared/geo.ts";
import { corrigirSobreposicao, lonLatDoVerticeSigef, parseCsvSigef } from "../supabase/functions/_shared/sobreposicao.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);
const fuso = 24;
const ud = utmDef(fuso);
const proj = {
  utmParaGeo: (e, n) => proj4(ud, GEO_DEF, [e, n]),
  geoParaUtm: (lon, lat) => proj4(GEO_DEF, ud, [lon, lat]),
};

const txt = readFileSync(new URL("../reference/THEREZA.txt", import.meta.url), "utf8");
const pontos = parseTxt(txt);
const calc = calcularVertices(
  pontos.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: 0.01, sigmaH: 0.02, inserido: false })),
  fuso, proj4,
);
const ring = calc.map((c) => [c.eProj, c.nProj]);

const dirCsv = new URL("../ArquivosExemplo/", import.meta.url);
const csvs = readdirSync(dirCsv).filter((f) => f.endsWith(".csv")).sort()
  .map((f) => parseCsvSigef(f, readFileSync(new URL(f, dirCsv), "utf8")));
// geometria pelo WKT (o que o SIGEF guarda), como faz a edge function
const parcelas = csvs.map((c) => ({
  nome: c.nome,
  ringUtm: c.pontos.map(([lon, lat]) => proj.geoParaUtm(lon, lat)),
  vertices: c.vertices,
}));

// sobreposição do anel publicado com uma parcela, medida de forma independente
function sobreposicaoM2(anel, parcela) {
  const ESC = 10000;
  const e0 = Math.floor(Math.min(...anel.map((p) => p.e))), n0 = Math.floor(Math.min(...anel.map((p) => p.n)));
  const toPath = (pts) => pts.map(([e, n]) => ({ X: Math.round((e - e0) * ESC), Y: Math.round((n - n0) * ESC) }));
  const c = new ClipperLib.Clipper();
  c.AddPath(toPath(anel.map((p) => [p.e, p.n])), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(toPath(parcela.ringUtm), ClipperLib.PolyType.ptClip, true);
  const sol = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol.reduce((a, p) => a + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (ESC * ESC);
}

test("parseCsvSigef: devolve código, GMS e método de cada vértice, coerentes com o WKT", () => {
  const c = csvs.find((x) => x.nome === "exportacao (6).csv");
  assert.equal(c.vertices.length, c.pontos.length);
  assert.equal(c.vertices[0].codigo, "FHT-P-2339");
  assert.equal(c.vertices[0].metodo, "PG2");
  assert.equal(c.vertices[0].tipo, "P");
  assert.equal(c.vertices[0].lonGms, "39 16 33,106 W");
  assert.equal(c.vertices[0].latGms, "12 10 30,687 S");
  assert.equal(c.vertices[0].sigmaX, 0.022);
  assert.equal(c.vertices[0].h, 234.053);
  assert.equal(c.vertices.find((v) => v.codigo === "FHT-M-1447").tipo, "M");
  // o GMS exibido é o WKT arredondado a 0,001" (≈ 3 cm): tem de bater nessa resolução
  for (const v of c.vertices) {
    const [lon, lat] = lonLatDoVerticeSigef(v);
    assert.ok(Math.abs(lon - v.lon) < 5e-7 && Math.abs(lat - v.lat) < 5e-7, `${v.codigo}: GMS ≠ WKT`);
    assert.equal(gmsToDeg(parseGmsPlanilha(v.lonGms)), lon);
  }
});

test("modo afastamento (opção desligada) reproduz a linha de base de 2026-09-03", () => {
  const r = corrigirSobreposicao(ring, parcelas, 0.5, proj);
  assert.equal(r.precisaCorrigir, true);
  assert.equal(r.parcelas.filter((p) => p.status === "corrigida").length, 5);
  assert.equal(r.parcelas.find((p) => p.nome === "exportacao (9).csv").status, "mesma_gleba");
  assert.equal(r.anel.length, 68);
  assert.equal(r.anel.filter((p) => p.origIdx === null).length, 23);
  assert.equal(r.anel.filter((p) => p.origIdx !== null).length, 45);
  assert.equal(r.compartilhados, 0);
  assert.ok(Math.abs(r.areaDepoisM2 - 2352692.99) < 0.05, `área ${r.areaDepoisM2}`);
  for (const par of parcelas) {
    if (r.parcelas.find((p) => p.nome === par.nome).status !== "corrigida") continue;
    assert.ok(sobreposicaoM2(r.anel, par) <= 1e-4, `${par.nome} ainda sobrepõe`);
  }
});

test("modo vértices certificados: divisa descrita pelos vértices do vizinho, sem sobreposição", () => {
  const r = corrigirSobreposicao(ring, parcelas, 0.5, proj, { usarVerticesCertificados: true, toleranciaIgualarM: 0.5 });
  assert.equal(r.precisaCorrigir, true);
  const novos = r.anel.filter((p) => p.origIdx === null && !p.certificado);
  const compartilhados = r.anel.filter((p) => p.certificado);
  console.log(`    THEREZA certificados: anel ${r.anel.length} · compartilhados ${compartilhados.length} (igualados ${r.igualados}) · virtuais ${novos.length} · área ${(r.areaDepoisM2 / 1e4).toFixed(4)} ha`);
  assert.equal(r.compartilhados, compartilhados.length);
  assert.ok(compartilhados.length >= 5, "esperava vértices certificados no anel");
  assert.ok(novos.length < 23, "esperava menos pontos virtuais do que no modo afastamento");

  // cada compartilhado publica EXATAMENTE a coordenada do CSV
  for (const p of compartilhados) {
    const par = parcelas[p.certificado.parcela];
    const [e, n] = par.ringUtm[p.certificado.idx];
    assert.ok(Math.hypot(e - p.e, n - p.n) < 1e-3, `${par.vertices[p.certificado.idx].codigo} deslocado`);
    assert.equal(r.parcelas[p.certificado.parcela].status !== "mesma_gleba", true, "vértice da própria gleba não pode entrar");
  }
  // vértices nossos mantidos (não igualados) continuam no lugar (0,1 mm do modelo)
  for (const p of r.anel) {
    if (p.origIdx === null || p.certificado) continue;
    assert.ok(Math.hypot(p.e - ring[p.origIdx][0], p.n - ring[p.origIdx][1]) < 1e-4, `vértice ${p.origIdx} deslocado`);
  }
  // anel publicado não sobrepõe nenhuma parcela corrigida (medida independente)
  for (const par of parcelas) {
    if (r.parcelas.find((p) => p.nome === par.nome).status !== "corrigida") continue;
    assert.ok(sobreposicaoM2(r.anel, par) <= 1e-4, `${par.nome} ainda sobrepõe`);
  }
  // não ganhou terra: área depois ≤ área antes + tolerância de igualação
  assert.ok(r.areaDepoisM2 <= r.areaAntesM2 + 50, "área cresceu além do esperado");
  // e cede pouco além das invasões reais (o modo afastamento cedia ~850 m² a mais)
  const invadido = r.parcelas.filter((p) => p.status === "corrigida").reduce((s, p) => s + p.areaSobrepostaM2, 0);
  assert.ok(r.areaAntesM2 - r.areaDepoisM2 - invadido < 150, `cedeu ${(r.areaAntesM2 - r.areaDepoisM2 - invadido).toFixed(1)} m² além da invasão`);
  // anel simples e no mesmo sentido do original
  const orient = (pts) => Math.sign(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + (q[0] - p[0]) * (q[1] + p[1]); }, 0));
  assert.equal(orient(r.anel.map((p) => [p.e, p.n])), orient(ring));
});

test("sem parcelas corrigíveis e sem vértice a igualar: nada muda", () => {
  const longe = parcelas.map((p) => ({ ...p, ringUtm: p.ringUtm.map(([e, n]) => [e + 5000, n + 5000]) }));
  const r = corrigirSobreposicao(ring, longe, 0.5, proj, { usarVerticesCertificados: true });
  assert.equal(r.precisaCorrigir, false);
  assert.equal(r.anel.length, ring.length);
  assert.equal(r.compartilhados, 0);
});
