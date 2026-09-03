// Confrontante com área certificada na ENTRADA do serviço: parser do CSV de
// exportação do SIGEF (X/Y em UTM) e união dos vértices escolhidos ao TXT.
// Fixture: tests/fixtures/exportacao_15_confrontante.csv (parcela DJ9, fuso 24S).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import proj4lib from "proj4";
import {
  GEO_DEF, calcularAreaHa, calcularVertices, degToGmsCanonical, fmtGmsPlanilha, parseGmsPlanilha, utmDef,
} from "../supabase/functions/_shared/geo.ts";
import {
  lonLatDoVerticeSigef, montarVerticesUnidos, parseCsvSigef, unirCertificados,
} from "../supabase/functions/_shared/certificados.ts";
import { parseCsvSigef as parseViaSobreposicao } from "../supabase/functions/_shared/sobreposicao.ts";
import { sugerirTrechos } from "../supabase/functions/_shared/servico.ts";

const csv = readFileSync(new URL("./fixtures/exportacao_15_confrontante.csv", import.meta.url), "utf8");
const fuso = 24;
const ud = utmDef(fuso);
const proj4 = (f, t, c) => proj4lib(f, t, c);
const geoParaUtm = (lon, lat) => proj4(GEO_DEF, ud, [lon, lat]);

const { vertices: viz } = parseCsvSigef("exportacao (15).csv", csv);
const utmViz = viz.map((v) => geoParaUtm(...lonLatDoVerticeSigef(v)));

test("parser: CSV com X/Y em UTM → 36 vértices EXTERNO, GMS canônico derivado do WKT", () => {
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
  // X/Y não são GMS → GMS canônico do WKT
  assert.equal(viz[0].latGms, fmtGmsPlanilha(degToGmsCanonical(viz[0].lat), "lat"));
  assert.equal(viz[0].lonGms, fmtGmsPlanilha(degToGmsCanonical(viz[0].lon), "lon"));
  const [lon, lat] = lonLatDoVerticeSigef(viz[0]);
  assert.ok(Math.abs(lon - viz[0].lon) < 2e-7 && Math.abs(lat - viz[0].lat) < 2e-7);
  // as colunas X/Y do CSV são o E/N no fuso 24: a projeção do WKT bate a centímetros
  const [e, n] = geoParaUtm(viz[0].lon, viz[0].lat);
  assert.ok(Math.abs(e - 540251.85) < 0.05, `E ${e}`);
  assert.ok(Math.abs(n - 8607462.57) < 0.05, `N ${n}`);
  // sobreposicao.ts continua expondo o mesmo parser
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
const escolhidos = () => [{ nome: "exportacao (15).csv", vertices: viz.slice(13, 18) }];

test("união: extremos igualados, os do meio inseridos na ordem da divisa", () => {
  const txt = txtSintetico();
  const r = unirCertificados(txt, escolhidos(), geoParaUtm, 0.5);
  assert.deepEqual(r.avisos, []);
  assert.equal(r.igualados, 2);
  assert.equal(r.inseridos, 3);
  const resumo = r.anel.map((x) => (x.origem === "txt" ? `T${x.idx}${x.igualado ? `=${x.igualado.idx}` : ""}` : `C${x.idx}`));
  assert.deepEqual(resumo, ["T0=0", "C1", "C2", "C3", "T1=4", "T2", "T3"]);
  assert.ok(r.anel[0].igualado.distM < 0.3);
});

test("união: TXT no sentido contrário → os inseridos saem na ordem inversa", () => {
  const txt = txtSintetico().reverse();
  const r = unirCertificados(txt, escolhidos(), geoParaUtm, 0.5);
  const resumo = r.anel.map((x) => (x.origem === "txt" ? `T${x.idx}${x.igualado ? `=${x.igualado.idx}` : ""}` : `C${x.idx}`));
  assert.deepEqual(resumo, ["T0", "T1", "T2=4", "C3", "C2", "C1", "T3=0"]);
});

test("união: tolerância decide entre igualar e inserir", () => {
  const txt = txtSintetico(0.5); // ~0,71 m dos vértices certificados
  const r05 = unirCertificados(txt, escolhidos(), geoParaUtm, 0.5);
  assert.equal(r05.igualados, 0);
  assert.equal(r05.inseridos, 5);
  const r10 = unirCertificados(txt, escolhidos(), geoParaUtm, 1.0);
  assert.equal(r10.igualados, 2);
  assert.equal(r10.inseridos, 3);
});

test("união: código repetido em dois CSVs entra uma vez e avisa; vértice longe do perímetro avisa", () => {
  const txt = txtSintetico();
  const grupos = [
    { nome: "a.csv", vertices: viz.slice(13, 18) },
    { nome: "b.csv", vertices: [viz[15], viz[0]] }, // 15 repetido; 0 fica a ~1 km
  ];
  const r = unirCertificados(txt, grupos, geoParaUtm, 0.5);
  assert.equal(r.igualados, 2);
  assert.equal(r.inseridos, 4);
  assert.equal(r.avisos.length, 2);
  assert.match(r.avisos[0], /DJ9-P-0531 aparece mais de uma vez/);
  assert.match(r.avisos[1], /DJ9-M-2473 está a \d+,\d m do perímetro/);
});

test("linhas: igualado mantém a linha do TXT (nº, rótulo, M) com código/GMS/σ/Z do vizinho; inserido é do vizinho", () => {
  const txt = txtSintetico();
  const sug = sugerirTrechos(txt);
  const uniao = unirCertificados(txt, escolhidos(), geoParaUtm, 0.5);
  const calcTxt = calcularVertices(txt.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })), fuso, proj4);
  const gmsTxt = (i) => ({ lat: fmtGmsPlanilha(calcTxt[i].latGms, "lat"), lon: fmtGmsPlanilha(calcTxt[i].lonGms, "lon") });
  const linhas = montarVerticesUnidos(txt, sug, uniao, escolhidos(), gmsTxt, geoParaUtm);
  assert.equal(linhas.length, 7);
  assert.deepEqual(linhas.map((l) => l.ordem), [0, 1, 2, 3, 4, 5, 6]);

  const ig = linhas[0];                       // T0 igualado ao DJ9-M-2457 (índice 14)
  assert.equal(ig.num_txt, 1);
  assert.equal(ig.rotulo_txt, "Fulano/Vizinho Cert");
  assert.equal(ig.tipo, "M");                 // início de trecho continua M
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

  // o anel unido passa no motor geodésico pelo mesmo caminho de gerar-documentos
  const calc = calcularVertices(linhas.map((l) => l.inserido_manual
    ? { numTxt: l.num_txt, latGms: parseGmsPlanilha(l.lat_gms), lonGms: parseGmsPlanilha(l.lon_gms), h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h, inserido: true }
    : { numTxt: l.num_txt, e: l.e, n: l.n, h: l.h, sigmaPos: l.sigma_pos, sigmaH: l.sigma_h }), fuso, proj4);
  assert.ok(calcularAreaHa(calc) > 10);
});

test("linhas: sem certificados o resultado é o de sempre (M nos rótulos, P no resto, nada inserido)", () => {
  const txt = txtSintetico();
  const sug = sugerirTrechos(txt);
  const uniao = unirCertificados(txt, [], geoParaUtm, 0.5);
  assert.equal(uniao.igualados + uniao.inseridos, 0);
  const calcTxt = calcularVertices(txt.map((p) => ({ numTxt: p.num, e: p.e, n: p.n, h: p.h, sigmaPos: p.sigmaPos, sigmaH: p.sigmaH })), fuso, proj4);
  const linhas = montarVerticesUnidos(txt, sug, uniao, [], (i) => ({ lat: fmtGmsPlanilha(calcTxt[i].latGms, "lat"), lon: fmtGmsPlanilha(calcTxt[i].lonGms, "lon") }), geoParaUtm);
  assert.deepEqual(linhas.map((l) => [l.num_txt, l.tipo, l.codigo, l.inserido_manual, l.metodo]), [
    [1, "M", null, false, "PG6"], [2, "P", null, false, "PG6"], [3, "M", null, false, "PG6"], [4, "P", null, false, "PG6"],
  ]);
  assert.equal(linhas[0].lat_gms, fmtGmsPlanilha(calcTxt[0].latGms, "lat"));
  assert.equal(linhas[2].apelido_txt, "Beltrano");
});
