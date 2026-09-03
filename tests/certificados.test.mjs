// Confrontante com área certificada na ENTRADA do serviço: parser do CSV de
// exportação do SIGEF (X/Y em UTM) e união dos vértices escolhidos ao TXT.
// Fixtures: tests/fixtures/exportacao_15_confrontante.csv (parcela DJ9, fuso 24S)
//           tests/fixtures/adelson_teste.json (serviço real de 2026-09-03: TXT parcial
//           de 21 pontos + 11 vértices de DUAS parcelas fechando o perímetro).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import {
  GEO_DEF, calcularAreaHa, calcularVertices, degToGmsCanonical, detectZoneCandidates, fmtGmsPlanilha, gmsToDeg,
  parseGmsPlanilha, utmDef,
} from "../supabase/functions/_shared/geo.ts";
import {
  fusoPelosCertificados, lonLatDoVerticeSigef, montarVerticesUnidos, parseCsvSigef, unirCertificados,
} from "../supabase/functions/_shared/certificados.ts";
import { parseCsvSigef as parseViaSobreposicao } from "../supabase/functions/_shared/sobreposicao.ts";
import { sugerirTrechos } from "../supabase/functions/_shared/servico.ts";

const csv = readFileSync(new URL("./fixtures/exportacao_15_confrontante.csv", import.meta.url), "utf8");
const fuso = 24;
const ud = utmDef(fuso);
const proj4 = (f, t, c) => proj4lib(f, t, c);
const geoParaUtm = (lon, lat) => proj4(GEO_DEF, ud, [lon, lat]);

const { vertices: viz, parcela } = parseCsvSigef("exportacao (15).csv", csv);
const utmViz = viz.map((v) => geoParaUtm(...lonLatDoVerticeSigef(v)));

const resumoAnel = (r, txt, grupos) => r.anel.map((x) => {
  if (x.origem === "txt") return `${txt[x.idx].num}${x.igualado ? "=" + grupos[x.igualado.grupo].vertices[x.igualado.idx].codigo : ""}`;
  return `[${grupos[x.grupo].vertices[x.idx].codigo}]`;
});
const gmsDoTxt = (txt) => {
  const calc = calcularVertices(txt.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })), fuso, proj4);
  return (i) => ({ lat: fmtGmsPlanilha(calc[i].latGms, "lat"), lon: fmtGmsPlanilha(calc[i].lonGms, "lon") });
};
const inicios = (txt) => new Set(sugerirTrechos(txt).map((t) => t.verticeInicioOrdem));

test("parser: CSV com X/Y em UTM → 36 vértices EXTERNO, GMS canônico derivado do WKT", () => {
  // identidade da parcela = QRCODE (o nome do arquivo é sempre "exportacao.csv" no SIGEF)
  assert.equal(parcela, "520f84c2-c29e-4d53-9b31-528caf444462");
  assert.equal(viz.length, 36);
  assert.equal(viz[0].codigo, "DJ9-M-2473");
  assert.equal(viz[0].tipo, "M");
  assert.equal(viz[0].metodo, "PG2");
  assert.equal(viz[0].indice, 1);
  assert.equal(viz[35].codigo, "DJ9-M-2472");
  assert.equal(viz[0].sigmaX, 0.146);
  assert.equal(viz[0].sigmaY, 0.132);
  assert.equal(viz[0].sigmaZ, 0.42);
  assert.equal(viz[0].h, 18.43);
  assert.equal(viz[0].latGms, fmtGmsPlanilha(degToGmsCanonical(viz[0].lat), "lat"));
  assert.equal(viz[0].lonGms, fmtGmsPlanilha(degToGmsCanonical(viz[0].lon), "lon"));
  const [lon, lat] = lonLatDoVerticeSigef(viz[0]);
  assert.ok(Math.abs(lon - viz[0].lon) < 2e-7 && Math.abs(lat - viz[0].lat) < 2e-7);
  const [e, n] = geoParaUtm(viz[0].lon, viz[0].lat);
  assert.ok(Math.abs(e - 540251.85) < 0.05, `E ${e}`);
  assert.ok(Math.abs(n - 8607462.57) < 0.05, `N ${n}`);
  assert.equal(parseViaSobreposicao, parseCsvSigef);
});

// Divisa comum: vértices 14..18 do vizinho (índices 13..17). O nosso TXT tem um
// ponto a ~0,28 m do 14, outro a ~0,28 m do 18 e dois pontos 800 m a oeste.
function txtSintetico(desvio = 0.2) {
  const a = utmViz[13], b = utmViz[17];
  return [
    { num: 1, rotulo: "Fulano/Vizinho Cert", e: a[0] + desvio, n: a[1] + desvio, h: 20, sigmaPos: 0.01, sigmaH: 0.02 },
    { num: 2, rotulo: null, e: b[0] - desvio, n: b[1] + desvio, h: 21, sigmaPos: 0.01, sigmaH: 0.02 },
    { num: 3, rotulo: "Beltrano", e: b[0] - 800, n: b[1], h: 22, sigmaPos: 0.01, sigmaH: 0.02 },
    { num: 4, rotulo: null, e: a[0] - 800, n: a[1], h: 23, sigmaPos: 0.01, sigmaH: 0.02 },
  ];
}
const escolhidos = () => [{ nome: "exportacao (15).csv", vertices: viz.slice(13, 18), totalNoCsv: viz.length }];

test("união: extremos igualados, os do meio inseridos na ordem da divisa", () => {
  const txt = txtSintetico();
  const r = unirCertificados(txt, escolhidos(), geoParaUtm, 0.5);
  assert.deepEqual(r.avisos, []);
  assert.equal(r.igualados, 2);
  assert.equal(r.inseridos, 3);
  assert.deepEqual(r.removidos, []);
  assert.deepEqual(resumoAnel(r, txt, escolhidos()), ["1=DJ9-M-2457", "[DJ9-P-0530]", "[DJ9-P-0531]", "[DJ9-P-0532]", "2=DJ9-P-0533", "3", "4"]);
  assert.ok(r.anel[0].igualado.distM < 0.3);
});

test("união: TXT no sentido contrário → os inseridos saem na ordem inversa", () => {
  const txt = txtSintetico().reverse();
  const r = unirCertificados(txt, escolhidos(), geoParaUtm, 0.5);
  assert.deepEqual(resumoAnel(r, txt, escolhidos()), ["4", "3", "2=DJ9-P-0533", "[DJ9-P-0532]", "[DJ9-P-0531]", "[DJ9-P-0530]", "1=DJ9-M-2457"]);
});

test("união: tolerância decide entre igualar e inserir; sem âncora a cadeia entra inteira", () => {
  const txt = txtSintetico(0.5); // ~0,71 m dos vértices certificados
  const r05 = unirCertificados(txt, escolhidos(), geoParaUtm, 0.5);
  assert.equal(r05.igualados, 0);
  assert.equal(r05.inseridos, 5);
  assert.deepEqual(resumoAnel(r05, txt, escolhidos()), ["1", "[DJ9-M-2457]", "[DJ9-P-0530]", "[DJ9-P-0531]", "[DJ9-P-0532]", "[DJ9-P-0533]", "2", "3", "4"]);
  const r10 = unirCertificados(txt, escolhidos(), geoParaUtm, 1.0);
  assert.equal(r10.igualados, 2);
  assert.equal(r10.inseridos, 3);
});

test("união: código repetido em dois CSVs entra uma vez e avisa", () => {
  const txt = txtSintetico();
  const grupos = [
    { nome: "a.csv", vertices: viz.slice(13, 18), totalNoCsv: viz.length },
    { nome: "b.csv", vertices: [viz[15], viz[0]], totalNoCsv: viz.length }, // 15 repetido; 0 fica a ~1 km
  ];
  const r = unirCertificados(txt, grupos, geoParaUtm, 0.5);
  assert.equal(r.igualados, 2);
  assert.equal(r.inseridos, 4);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /DJ9-P-0531 aparece mais de uma vez/);
});

test("união: escolha que dá a volta no anel do vizinho (35, 36, 1, 2) vira uma cadeia contígua", () => {
  // TXT ancorado no 35 e no 2; entre eles a divisa passa por 36 e 1
  const a = utmViz[34], b = utmViz[1];
  const txt = [
    { num: 1, rotulo: null, e: a[0] + 0.1, n: a[1] + 0.1, h: 0, sigmaPos: 0.01, sigmaH: 0.02 },
    { num: 2, rotulo: null, e: b[0] + 0.1, n: b[1] + 0.1, h: 0, sigmaPos: 0.01, sigmaH: 0.02 },
    { num: 3, rotulo: null, e: b[0] + 900, n: b[1] - 900, h: 0, sigmaPos: 0.01, sigmaH: 0.02 },
    { num: 4, rotulo: null, e: a[0] + 900, n: a[1] - 900, h: 0, sigmaPos: 0.01, sigmaH: 0.02 },
  ];
  // escolhidos fora de ordem de propósito (a tela manda um Set)
  const grupos = [{ nome: "v.csv", vertices: [viz[0], viz[1], viz[34], viz[35]], totalNoCsv: viz.length }];
  const r = unirCertificados(txt, grupos, geoParaUtm, 0.5);
  assert.deepEqual(resumoAnel(r, txt, grupos), ["1=DJ9-M-2471", "[DJ9-M-2472]", "[DJ9-M-2473]", "2=DJ9-M-2486", "3", "4"]);
});

test("linhas: igualado mantém a linha do TXT (nº, rótulo, M) com código/GMS/σ/Z do vizinho; inserido é do vizinho", () => {
  const txt = txtSintetico();
  const sug = sugerirTrechos(txt);
  const uniao = unirCertificados(txt, escolhidos(), geoParaUtm, { toleranciaM: 0.5, inicios: inicios(txt) });
  const linhas = montarVerticesUnidos(txt, sug, uniao, escolhidos(), gmsDoTxt(txt), geoParaUtm);
  assert.equal(linhas.length, 7);
  assert.deepEqual(linhas.map((l) => l.ordem), [0, 1, 2, 3, 4, 5, 6]);

  const ig = linhas[0];                       // T0 igualado ao DJ9-M-2457 (índice 14)
  assert.equal(ig.num_txt, 1);
  assert.equal(ig.rotulo_txt, "Fulano/Vizinho Cert");
  assert.equal(ig.tipo, "M");
  assert.equal(ig.apelido_txt, "Vizinho Cert");
  assert.equal(ig.descritivo, "");
  assert.equal(ig.tipo_limite, "LA1");
  assert.equal(ig.codigo, "DJ9-M-2457");
  assert.equal(ig.inserido_manual, true);
  assert.equal(ig.metodo, "PG2");
  assert.equal(ig.sigma_pos, Math.max(viz[13].sigmaX, viz[13].sigmaY));
  assert.equal(ig.sigma_h, viz[13].sigmaZ);
  assert.equal(ig.h, viz[13].h);
  assert.equal(ig.lat_gms, fmtGmsPlanilha(parseGmsPlanilha(viz[13].latGms), "lat"));
  assert.ok(Math.abs(ig.e - utmViz[13][0]) < 0.002 && Math.abs(ig.n - utmViz[13][1]) < 0.002);

  for (const [k, cod] of [[1, "DJ9-P-0530"], [2, "DJ9-P-0531"], [3, "DJ9-P-0532"]]) {
    const l = linhas[k];
    assert.equal(l.codigo, cod);
    assert.equal(l.tipo, "P");
    assert.equal(l.num_txt, null);
    assert.equal(l.rotulo_txt, null);
    assert.equal(l.inserido_manual, true);
    assert.equal(l.descritivo, null);
    assert.equal(l.tipo_limite, null);
    assert.equal(l.txt_idx, null);
    assert.equal(l.certificado, cod);
  }
  const ig2 = linhas[4];                      // T1 (P) igualado ao DJ9-P-0533
  assert.equal(ig2.num_txt, 2);
  assert.equal(ig2.tipo, "P");
  assert.equal(ig2.codigo, "DJ9-P-0533");
  assert.equal(linhas[5].tipo, "M");          // Beltrano
  assert.equal(linhas[5].codigo, null);
  assert.equal(linhas[5].inserido_manual, false);
  assert.equal(linhas[6].tipo, "P");

  const calc = calcularVertices(linhas.map((l) => l.inserido_manual
    ? { numTxt: l.num_txt, latGms: parseGmsPlanilha(l.lat_gms), lonGms: parseGmsPlanilha(l.lon_gms), h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h, inserido: true }
    : { numTxt: l.num_txt, e: l.e, n: l.n, h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h }), fuso, proj4);
  assert.ok(calcularAreaHa(calc) > 10);
});

test("linhas: sem certificados o resultado é o de sempre (M nos rótulos, P no resto, nada inserido)", () => {
  const txt = txtSintetico();
  const sug = sugerirTrechos(txt);
  const uniao = unirCertificados(txt, [], geoParaUtm, 0.5);
  assert.equal(uniao.igualados + uniao.inseridos + uniao.removidos.length, 0);
  const linhas = montarVerticesUnidos(txt, sug, uniao, [], gmsDoTxt(txt), geoParaUtm);
  assert.deepEqual(linhas.map((l) => [l.num_txt, l.tipo, l.codigo, l.inserido_manual, l.metodo]), [
    [1, "M", null, false, "PG6"], [2, "P", null, false, "PG6"], [3, "M", null, false, "PG6"], [4, "P", null, false, "PG6"],
  ]);
  assert.equal(linhas[2].apelido_txt, "Beltrano");
});

// ---------------------------------------------------------------------------
// Caso real: ADELSON TESTE (2026-09-03). TXT parcial de 21 pontos; a parcela ONDE
// cobre o trecho 16→21 (nossos 17..20 estão sobre a divisa dela) e a parcela DJ9
// fecha o perímetro de 21 de volta ao 1 — 7 vértices a 350–850 m da corda 21→1.
// ---------------------------------------------------------------------------
const fx = JSON.parse(readFileSync(new URL("./fixtures/adelson_teste.json", import.meta.url), "utf8"));
for (const g of fx.grupos) for (const v of g.vertices) { v.lon = gmsToDeg(parseGmsPlanilha(v.lonGms)); v.lat = gmsToDeg(parseGmsPlanilha(v.latGms)); }
const gruposAdelson = () => fx.grupos.map((g) => ({ ...g, vertices: g.vertices.map((v) => ({ ...v })), totalNoCsv: 36 }));
const ESPERADO_ADELSON = [
  "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
  "16=ONDE-M-25932", "[ONDE-P-33448]", "21=ONDE-P-33447", "[ONDE-P-33446]",
  "[DJ9-M-2490]", "[DJ9-M-2491]", "[DJ9-M-2492]", "[DJ9-M-2493]", "[DJ9-M-2494]", "[DJ9-M-2495]", "[DJ9-M-2455]",
];

test("ADELSON: cadeias na ordem do vizinho fecham o perímetro; pontos do TXT sobre a divisa ONDE saem", () => {
  const txt = fx.txt;
  const r = unirCertificados(txt, gruposAdelson(), geoParaUtm, { toleranciaM: 0.5, inicios: inicios(txt) });
  assert.deepEqual(resumoAnel(r, txt, gruposAdelson()), ESPERADO_ADELSON);
  assert.equal(r.igualados, 2);
  assert.equal(r.inseridos, 9);
  assert.deepEqual(r.removidos.map((i) => txt[i].num), [17, 18, 19, 20]);
  assert.deepEqual(r.avisos, []);
});

test("ADELSON: com o fuso errado os certificados caem longe — fusoPelosCertificados escolhe o 24", () => {
  const cands = detectZoneCandidates(fx.txt, proj4);
  // E ≈ 540 km: vários fusos são plausíveis (19S a 24S), e a UF (BA) não decide entre 23S e 24S
  assert.ok(cands.length > 1 && cands.some((c) => c.zone === 23) && cands.some((c) => c.zone === 24), JSON.stringify(cands.map((c) => c.zone)));
  const r = fusoPelosCertificados(cands, gruposAdelson());
  assert.equal(r.escolhido.zone, 24);
  assert.ok(r.distanciaGraus < 0.02);
});

test("ADELSON: linhas — igualado 16 continua M 'obs'; um M descartado passa a confrontação ao próximo mantido", () => {
  const txt = fx.txt.map((p) => (p.num === 18 ? { ...p, rotulo: "x/Cercado" } : p));
  const sug = sugerirTrechos(txt);
  const uniao = unirCertificados(txt, gruposAdelson(), geoParaUtm, { toleranciaM: 0.5, inicios: inicios(txt) });
  assert.deepEqual(uniao.removidos.map((i) => txt[i].num), [17, 18, 19, 20]);
  const linhas = montarVerticesUnidos(txt, sug, uniao, gruposAdelson(), gmsDoTxt(txt), geoParaUtm);
  assert.equal(linhas.length, 26);
  const l16 = linhas.find((l) => l.num_txt === 16);
  assert.equal(l16.tipo, "M");
  assert.equal(l16.codigo, "ONDE-M-25932");
  assert.equal(l16.apelido_txt, "obs");
  // o M do ponto 18 (descartado) foi para o próximo mantido: 21 = ONDE-P-33447
  const l21 = linhas.find((l) => l.num_txt === 21);
  assert.equal(l21.codigo, "ONDE-P-33447");
  assert.equal(l21.tipo, "M");
  assert.equal(l21.apelido_txt, "Cercado");
  assert.equal(l21.descritivo, "");
  // os do DJ9 são P do vizinho, sem confrontação
  const dj = linhas.filter((l) => l.codigo?.startsWith("DJ9"));
  assert.equal(dj.length, 7);
  assert.ok(dj.every((l) => l.tipo === "P" && l.num_txt === null && l.inserido_manual));
  // anel unido calcula sem erro e no fuso certo
  const calc = calcularVertices(linhas.map((l) => l.inserido_manual
    ? { numTxt: l.num_txt, latGms: parseGmsPlanilha(l.lat_gms), lonGms: parseGmsPlanilha(l.lon_gms), h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h, inserido: true }
    : { numTxt: l.num_txt, e: l.e, n: l.n, h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h }), fuso, proj4);
  assert.ok(calcularAreaHa(calc) > 20);
});
