// Medir no campo (src/lib/campo): as partes puras.
//
// O que se prova aqui:
//  • a área e o perímetro saem do MOTOR ÚNICO (UTM no fuso do lugar + Gauss):
//    o mesmo número que areaUtmM2 do restricoes.ts dá, e o mesmo nos dois
//    lados de uma divisa de fuso (a medição usa um fuso só, o do meio);
//  • Caminhar: um vértice a cada 5 m numa reta, um na curva de 90°, nenhum
//    parado no lugar com o GPS "passeando", nenhum com sinal ruim; no trajeto
//    de exemplo a área medida fica perto da área de verdade da cerca;
//  • Marcar ponto: a leitura que pulou longe sai, a média é ponderada pela
//    precisão e a precisão dita é honesta (nunca melhor que a melhor leitura);
//  • o contorno que se cruza é apontado;
//  • o aparelho: grava e lê, sobrevive a dado estragado, só guarda 30 enviadas,
//    junta com a conta pela versão mais nova, e o texto da retomada;
//  • a ponte para o CAR e para a Consulta (lê e apaga, recusa área estragada);
//  • a exportação (KML com as coordenadas, GPX, SHP) e o simulador.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { areaUtmM2, fusoDoLon } from "../src/lib/restricoes.ts";
import { GEO_DEF, utmDef } from "../supabase/functions/_shared/geo.ts";
import {
  circuloLonLat, classePrecisao, deslocar, contornoSeCruza, difAngulo, distanciaM, fusoDaMedicao, medir, rumoGraus,
  textoDistancia, textoHa, textoPrecisao,
} from "../src/lib/campo/geometria.ts";
import { combinarLeituras, leituraUtil, verticeAoCaminhar, verticeDoPonto } from "../src/lib/campo/motor.ts";
import {
  alterar, CHAVE_APARELHO, gravarAparelho, guardarMedicao, juntarListas, lerAparelho, marcarEnviada, medicaoValida,
  nomePadrao, novaMedicao, novoId, pendente, quando, removerMedicao, textoRetomada,
} from "../src/lib/campo/aparelho.ts";
import { areaDaMedicao, areaParaConsulta, CHAVE_AREA_CONSULTA, pegarAreaParaConsulta } from "../src/lib/campo/ponte.ts";
import { arquivoDaMedicao, camadasDaMedicao } from "../src/lib/campo/arquivos.ts";
import { criarSimulador } from "../src/lib/campo/gps.ts";
import { linhaDaMedicao, repositorioMemoria } from "../src/lib/campo/repositorio.ts";
import { CANTOS_EXEMPLO, TRAJETO_EXEMPLO } from "../src/lib/campo/trajeto_exemplo.ts";
import { OPCOES_PADRAO, opcoesValidas } from "../src/lib/campo/tipos.ts";

const proj = (de, para, c) => proj4lib(de, para, c);
/** ponto a (x leste, y norte) metros de uma origem lon/lat */
const desloc = (o, x, y) => deslocar(o, x, y);
const vert = ([lon, lat], extra = {}) => ({ lon, lat, precisao: 3, t: 0, modo: "caminhar", ...extra });
const leit = ([lon, lat], precisao = 3, t = 0) => ({ lon, lat, precisao, t });
const ORIGEM = [-39.1262, -12.6915];
const OP = OPCOES_PADRAO;

// ---------------------------------------------------------------- motor único
test("área e perímetro: o mesmo número do motor único (UTM do fuso + Gauss)", () => {
  // quadrado de 100 m feito EM UTM e levado para lon/lat: 1 ha exato no motor
  const fuso = fusoDoLon(ORIGEM[0]);
  const def = utmDef(fuso);
  const [e0, n0] = proj(GEO_DEF, def, ORIGEM);
  const utm = [[e0, n0], [e0 + 100, n0], [e0 + 100, n0 + 100], [e0, n0 + 100]];
  const vs = utm.map((p) => vert(proj(def, GEO_DEF, p)));
  const md = medir(vs);
  assert.equal(md.fuso, 24);
  assert.ok(Math.abs(md.areaM2 - 10000) < 0.01, `área ${md.areaM2}`);
  assert.ok(Math.abs(md.perimetroM - 400) < 0.001, `perímetro ${md.perimetroM}`);
  assert.equal(md.areaM2, areaUtmM2([vs.map((v) => proj(GEO_DEF, def, [v.lon, v.lat]))]));
  assert.equal(textoHa(md.areaM2), "1,0000 ha");
});

test("dois vértices: perímetro é a distância; um vértice: tudo zero", () => {
  const a = vert(ORIGEM), b = vert(desloc(ORIGEM, 30, 40));
  const md = medir([a, b]);
  assert.equal(md.areaM2, 0);
  // 50 m no chão × o fator de escala do UTM (perto do meridiano central, k ≈ 0,9996)
  assert.ok(Math.abs(md.perimetroM - 50) / 50 < 0.0006, `perímetro ${md.perimetroM}`);
  assert.ok(Math.abs(distanciaM(a, b) - 50) < 0.001, "plano tangente no elipsoide");
  assert.deepEqual([medir([a]).areaM2, medir([a]).perimetroM, medir([]).n], [0, 0, 0]);
});

test("na divisa de fuso a medição usa UM fuso (o do meio) e a área não pula", () => {
  // um quadrado de 200 m atravessando o meridiano -42° (divisa 23/24)
  const o = [-42.0009, -12.5];
  const anel = [[0, 0], [200, 0], [200, 200], [0, 200]].map(([x, y]) => vert(desloc(o, x, y)));
  const md = medir(anel);
  assert.equal(md.fuso, fusoDaMedicao(anel));
  assert.ok([23, 24].includes(md.fuso));
  // a área plana em UTM na borda do fuso (k ≈ 1,0010) fica a 0,2% da área no chão
  assert.ok(Math.abs(md.areaM2 - 40000) / 40000 < 0.003, `área ${md.areaM2}`);
  // o mesmo polígono, um pouco para cada lado da divisa, dá áreas no mesmo motor
  const lado23 = medir(anel.map((v) => ({ ...v, lon: v.lon - 0.002 })));
  const lado24 = medir(anel.map((v) => ({ ...v, lon: v.lon + 0.002 })));
  assert.notEqual(lado23.fuso, lado24.fuso);
  assert.ok(Math.abs(lado23.areaM2 - lado24.areaM2) / lado24.areaM2 < 0.002);
});

test("distância, rumo e diferença de ângulo", () => {
  const b = desloc(ORIGEM, 0, 100);
  assert.ok(Math.abs(distanciaM({ lon: ORIGEM[0], lat: ORIGEM[1] }, { lon: b[0], lat: b[1] }) - 100) < 0.01);
  assert.ok(Math.abs(rumoGraus({ lon: ORIGEM[0], lat: ORIGEM[1] }, { lon: b[0], lat: b[1] })) < 0.01);
  const l = desloc(ORIGEM, 100, 0);
  assert.ok(Math.abs(rumoGraus({ lon: ORIGEM[0], lat: ORIGEM[1] }, { lon: l[0], lat: l[1] }) - 90) < 0.01);
  assert.equal(difAngulo(350, 10), 20);
  assert.equal(difAngulo(10, 190), 180);
});

test("textos e cor da precisão", () => {
  assert.equal(textoPrecisao(2.84), "±2,8 m");
  assert.equal(textoPrecisao(12), "±12 m");
  assert.equal(textoPrecisao(null), "à mão");
  assert.equal(textoDistancia(642.4), "642 m");
  assert.equal(textoDistancia(1240), "1,24 km");
  assert.deepEqual([classePrecisao(3), classePrecisao(3.1), classePrecisao(8), classePrecisao(8.1)], ["boa", "media", "media", "ruim"]);
  const c = circuloLonLat(ORIGEM, 10);
  assert.deepEqual(c[0], c[c.length - 1]);
  for (const p of c) assert.ok(Math.abs(distanciaM({ lon: ORIGEM[0], lat: ORIGEM[1] }, { lon: p[0], lat: p[1] }) - 10) < 0.01);
});

test("contorno que se cruza (gravata) é apontado; o normal não", () => {
  const q = [[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y]) => vert(desloc(ORIGEM, x, y)));
  assert.equal(contornoSeCruza(q), false);
  const gravata = [q[0], q[2], q[1], q[3]];
  assert.equal(contornoSeCruza(gravata), true);
  assert.equal(contornoSeCruza(q.slice(0, 3)), false);
});

// ---------------------------------------------------------------- Caminhar
test("Caminhar numa reta: um vértice a cada 5 m (nem antes, nem pulando)", () => {
  const vs = [];
  for (let d = 0; d <= 50.2; d += 0.5) {
    const r = verticeAoCaminhar(vs, leit(desloc(ORIGEM, d, 0), 2.5), OP);
    if (r) vs.push(r.vertice);
  }
  // 50 m em passos de meio metro: 9 ou 10 trechos de 5–5,5 m (o arredondamento decide a borda)
  assert.ok(vs.length >= 10 && vs.length <= 11, `${vs.length} vértices`);
  for (let i = 1; i < vs.length; i++) {
    const d = distanciaM(vs[i - 1], vs[i]);
    assert.ok(d >= 5 && d < 5.6, `passo ${d}`);
  }
});

test("Caminhar: a curva de 90° vira vértice antes dos 5 m", () => {
  const vs = [vert(desloc(ORIGEM, 0, 0)), vert(desloc(ORIGEM, 5, 0))];
  // 3 m para o norte a partir do último: não andou 5 m, mas virou 90°
  const r = verticeAoCaminhar(vs, leit(desloc(ORIGEM, 5, 3), 2.5), OP);
  assert.equal(r?.motivo, "direcao");
  // 1 m para o norte: curto demais para confiar no ângulo
  assert.equal(verticeAoCaminhar(vs, leit(desloc(ORIGEM, 5, 1), 2.5), OP), null);
  // seguindo reto 3 m: nada
  assert.equal(verticeAoCaminhar(vs, leit(desloc(ORIGEM, 8, 0), 2.5), OP), null);
});

test("Caminhar parado: o GPS passeando não cria vértice; sinal ruim também não", () => {
  const vs = [vert(ORIGEM, { precisao: 6 })];
  // passeio de até 3,5 m em volta com precisão ±6 m (60% = 3,6 m)
  for (let i = 0; i < 60; i++) {
    const a = i * 0.7;
    const r = verticeAoCaminhar(vs, leit(desloc(ORIGEM, Math.cos(a) * 3.5, Math.sin(a) * 3.5), 6), OP);
    assert.equal(r, null);
  }
  assert.equal(verticeAoCaminhar([], leit(ORIGEM, 15), OP), null, "±15 m não serve (limite 8 m)");
  assert.equal(verticeAoCaminhar([], leit(ORIGEM, null), OP), null, "sem precisão não serve");
  assert.equal(verticeAoCaminhar([], { lon: NaN, lat: 0, precisao: 2, t: 0 }, OP), null);
  assert.equal(verticeAoCaminhar([], leit(ORIGEM, 2), OP)?.motivo, "primeiro");
  assert.equal(leituraUtil(leit(ORIGEM, 8), 8), true);
  assert.equal(leituraUtil(leit([200, 0], 2), 8), false);
});

test("o trajeto de exemplo, andando: a área fica perto da cerca de verdade", () => {
  const vs = [];
  let ruins = 0;
  for (const l of TRAJETO_EXEMPLO) {
    if (!leituraUtil(l, OP.limitePrecisaoM)) ruins++;
    const r = verticeAoCaminhar(vs, l, OP);
    if (r) vs.push(r.vertice);
  }
  const real = medir(CANTOS_EXEMPLO.map((c) => vert(c)));
  const medido = medir(vs);
  assert.ok(real.areaM2 > 25000 && real.areaM2 < 28000, `cerca ${real.areaM2}`);
  assert.ok(Math.abs(medido.areaM2 - real.areaM2) / real.areaM2 < 0.03, `medido ${medido.areaM2} × real ${real.areaM2}`);
  assert.ok(ruins > 10, "o trajeto passa debaixo das árvores (leituras ruins)");
  assert.ok(vs.length > 80 && vs.length < 200, `${vs.length} vértices`);
  assert.equal(contornoSeCruza(vs), false);
  // nenhum vértice com precisão pior que o limite
  assert.ok(vs.every((v) => v.precisao <= OP.limitePrecisaoM));
});

// ---------------------------------------------------------------- Marcar ponto
test("Marcar ponto: a leitura que pulou longe sai; precisão honesta", () => {
  const leituras = [
    leit(desloc(ORIGEM, 0.3, 0.1), 3.2), leit(desloc(ORIGEM, -0.2, 0.4), 2.9), leit(desloc(ORIGEM, 0.1, -0.3), 3.0),
    leit(desloc(ORIGEM, 0, 0.2), 3.1), leit(desloc(ORIGEM, 25, 18), 9), // reflexo no telhado
  ];
  const p = combinarLeituras(leituras);
  assert.equal(p.usadas, 4);
  assert.equal(p.descartadas, 1);
  assert.ok(distanciaM(p, { lon: ORIGEM[0], lat: ORIGEM[1] }) < 0.5);
  // nunca melhor que a melhor leitura (2,9)
  assert.ok(p.precisao >= 2.9 && p.precisao < 3.3, `precisão ${p.precisao}`);
  const v = verticeDoPonto(p, 123);
  assert.deepEqual([v.modo, v.leituras, v.t], ["ponto", 4, 123]);
});

test("Marcar ponto: espalhamento grande pesa mais que a precisão informada", () => {
  const l = [leit(desloc(ORIGEM, -6, 0), 2), leit(desloc(ORIGEM, 6, 0), 2), leit(desloc(ORIGEM, 0, -6), 2), leit(desloc(ORIGEM, 0, 6), 2)];
  const p = combinarLeituras(l);
  assert.equal(p.usadas, 4);
  assert.ok(p.precisao > 5, `o espalhamento de 6 m vence o ±2 m informado (${p.precisao})`);
});

test("Marcar ponto: a média pondera pela precisão; nada válido → null", () => {
  const p = combinarLeituras([leit(desloc(ORIGEM, 0, 0), 1), leit(desloc(ORIGEM, 1, 0), 4)]);
  // peso 1 × 1/16: fica a 1/17 m da boa
  assert.ok(Math.abs(distanciaM(p, { lon: ORIGEM[0], lat: ORIGEM[1] }) - 1 / 17) < 0.01);
  assert.equal(combinarLeituras([]), null);
  assert.equal(combinarLeituras([{ lon: NaN, lat: 1, precisao: 1, t: 0 }]), null);
  assert.equal(combinarLeituras([leit(ORIGEM, null)]).precisao, null);
});

// ---------------------------------------------------------------- aparelho
const armazem = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};

test("aparelho: grava e lê; a medição em andamento é a da retomada", () => {
  const arm = armazem();
  const m = alterar(novaMedicao(new Date(2026, 10, 6, 14, 32)), { vertices: [vert(ORIGEM), vert(desloc(ORIGEM, 5, 0))] }, new Date(2026, 10, 6, 14, 40));
  const e = guardarMedicao({ atualId: null, registros: {} }, m, true);
  assert.equal(gravarAparelho(arm, e), true);
  const lido = lerAparelho(arm);
  assert.equal(lido.atualId, m.id);
  assert.deepEqual(lido.registros[m.id].medicao, m);
  assert.equal(pendente(lido.registros[m.id]), true);
  const enviado = marcarEnviada(lido, m.id, m.atualizadaEm);
  assert.equal(pendente(enviado.registros[m.id]), false);
  // mudou de novo: volta a ficar pendente
  const m2 = alterar(m, { nome: "Pasto" }, new Date(2026, 10, 6, 14, 41));
  assert.equal(pendente(guardarMedicao(enviado, m2, true).registros[m.id]), true);
  // fechar tira da retomada
  assert.equal(guardarMedicao(enviado, { ...m2, fechada: true }, false).atualId, null);
  assert.equal(removerMedicao(enviado, m.id).atualId, null);
});

test("aparelho: dado estragado não derruba; vértice inválido fica de fora", () => {
  const arm = armazem();
  arm.setItem(CHAVE_APARELHO, "{não é json");
  assert.deepEqual(lerAparelho(arm), { atualId: null, registros: {} });
  arm.setItem(CHAVE_APARELHO, JSON.stringify({ atualId: "x", registros: { x: { medicao: { id: "x", nome: "", vertices: [vert(ORIGEM), { lon: "a" }], fechada: true } } } }));
  const e = lerAparelho(arm);
  assert.equal(e.registros.x.medicao.vertices.length, 1);
  assert.equal(e.registros.x.medicao.nome, "Medição");
  assert.equal(e.registros.x.medicao.fechada, false, "fechada com menos de 3 vértices não vale");
  assert.equal(lerAparelho(null).atualId, null);
  assert.equal(gravarAparelho({ getItem: () => null, setItem: () => { throw new Error("cheio"); }, removeItem() {} }, e), false);
  assert.equal(medicaoValida(null), null);
});

test("aparelho: guarda só as 30 enviadas mais novas; pendente e a atual nunca saem", () => {
  const arm = armazem();
  let e = { atualId: null, registros: {} };
  for (let i = 0; i < 40; i++) {
    const m = { ...novaMedicao(new Date(2026, 9, 1 + i)), vertices: [vert(ORIGEM)] };
    e = guardarMedicao(e, m, false);
    if (i < 35) e = marcarEnviada(e, m.id, m.atualizadaEm);
  }
  gravarAparelho(arm, e);
  const lido = Object.values(lerAparelho(arm).registros);
  assert.equal(lido.filter((r) => !pendente(r)).length, 30);
  assert.equal(lido.filter(pendente).length, 5);
});

test("lista: aparelho e conta juntos pela versão mais nova", () => {
  const base = { ...novaMedicao(new Date(2026, 10, 6, 10)), vertices: [vert(ORIGEM)] };
  const local = alterar(base, { nome: "local mais nova" }, new Date(2026, 10, 6, 11));
  const naConta = alterar(base, { nome: "conta" }, new Date(2026, 10, 6, 10, 30));
  const soConta = { ...novaMedicao(new Date(2026, 10, 5)), vertices: [vert(ORIGEM)] };
  const e = guardarMedicao({ atualId: null, registros: {} }, local, false);
  let l = juntarListas(e, [naConta, soConta]);
  assert.deepEqual(l.map((i) => [i.medicao.nome, i.onde]), [["local mais nova", "aparelho"], [soConta.nome, "conta"]]);
  // a conta tem versão mais nova (outro aparelho renomeou): vale a da conta
  const contaNova = alterar(base, { nome: "renomeada no escritório" }, new Date(2026, 10, 6, 12));
  l = juntarListas(e, [contaNova]);
  assert.deepEqual(l.map((i) => [i.medicao.nome, i.onde]), [["renomeada no escritório", "conta"]]);
  // mesma versão nos dois: conta
  assert.equal(juntarListas(e, [local])[0].onde, "conta");
});

test("textos: retomada, quando e nome padrão", () => {
  const agora = new Date(2026, 10, 6, 18, 0);
  const m = { ...novaMedicao(new Date(2026, 10, 6, 14, 32)), vertices: Array.from({ length: 23 }, () => vert(ORIGEM)) };
  assert.equal(textoRetomada(m, agora), "Continuar a medição de hoje 14:32 (23 vértices)?");
  assert.equal(textoRetomada({ ...m, vertices: [vert(ORIGEM)] }, agora), "Continuar a medição de hoje 14:32 (1 vértice)?");
  assert.equal(quando(new Date(2026, 10, 5, 9, 10).toISOString(), agora), "ontem 09:10");
  assert.equal(quando(new Date(2026, 10, 3, 8, 5).toISOString(), agora), "03/11 08:05");
  assert.equal(quando(new Date(2025, 10, 3, 8, 5).toISOString(), agora), "03/11/2025 08:05");
  assert.equal(nomePadrao(new Date(2026, 10, 6, 14, 32)), "Medição 06/11 14:32");
  assert.match(novoId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  // a hora da versão nunca anda para trás (dois toques no mesmo milissegundo)
  const t = new Date(2026, 10, 6, 15);
  const a = alterar(m, { nome: "a" }, t), b = alterar(a, { nome: "b" }, t);
  assert.ok(b.atualizadaEm > a.atualizadaEm);
});

test("ajustes: o que não serve vira o padrão; fora do limite é cortado", () => {
  assert.deepEqual(opcoesValidas(null), OPCOES_PADRAO);
  assert.deepEqual(opcoesValidas({ passoM: "abc", anguloGraus: 500, limitePrecisaoM: 0, segundosMarcar: 10 }),
    { passoM: 5, anguloGraus: 90, limitePrecisaoM: 1, segundosMarcar: 10 });
});

// ---------------------------------------------------------------- ponte e arquivos
const fechadaExemplo = () => ({
  ...novaMedicao(new Date(2026, 10, 6, 14, 32)), nome: "Pasto da sede", fechada: true,
  vertices: CANTOS_EXEMPLO.map((c, i) => vert(c, { precisao: 2.5 + i * 0.2, t: Date.UTC(2026, 10, 6, 17, 32 + i), alt: 410 + i })),
});

test("ponte: a área para o CAR e para a Consulta (lê e apaga)", () => {
  const m = fechadaExemplo();
  const a = areaDaMedicao(m, new Date(2026, 10, 6, 18));
  assert.equal(a.nome, "Pasto da sede");
  assert.equal(a.perimetro.length, 6);
  assert.deepEqual(a.nomes, ["P1", "P2", "P3", "P4", "P5", "P6"]);
  assert.match(a.origem, /^Medição de campo de hoje 14:32 · GPS do celular ±3,0 m$/);
  const mem = new Map();
  globalThis.sessionStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  try {
    assert.equal(areaParaConsulta(a), true);
    assert.ok(mem.has(CHAVE_AREA_CONSULTA));
    assert.deepEqual(pegarAreaParaConsulta(), a);
    assert.equal(pegarAreaParaConsulta(), null, "entra uma vez só");
    mem.set(CHAVE_AREA_CONSULTA, JSON.stringify({ ...a, perimetro: [[1, 2], [3, "x"], [5, 6]] }));
    assert.equal(pegarAreaParaConsulta(), null, "área estragada é recusada");
    mem.set(CHAVE_AREA_CONSULTA, "{");
    assert.equal(pegarAreaParaConsulta(), null);
  } finally {
    delete globalThis.sessionStorage;
  }
  assert.equal(pegarAreaParaConsulta(), null, "sem sessionStorage não quebra");
});

test("arquivos: KML com as coordenadas, GPX com waypoints, SHP; aberta sai como trajeto", async () => {
  const m = fechadaExemplo();
  const cam = camadasDaMedicao(m);
  assert.deepEqual(cam.map((c) => c.nome), ["AREA", "VERTICES"]);
  const kml = await arquivoDaMedicao(m, "kml");
  const txt = new TextDecoder().decode(kml.dados);
  assert.equal(kml.nome, "PASTO_DA_SEDE.kml");
  assert.match(txt, /<Polygon>/);
  assert.ok(txt.includes(CANTOS_EXEMPLO[0][0].toFixed(6).slice(0, 8)), "longitude do P1 no KML");
  assert.match(txt, /P6/);
  const gpx = new TextDecoder().decode((await arquivoDaMedicao(m, "gpx")).dados);
  assert.equal((gpx.match(/<wpt /g) ?? []).length, 6);
  const shp = await arquivoDaMedicao(m, "shp");
  assert.equal(shp.nome, "PASTO_DA_SEDE_SHP_SIRGAS2000.zip");
  const dxf = await arquivoDaMedicao(m, "dxf");
  assert.equal(dxf.nome, "PASTO_DA_SEDE_SIRGAS2000_UTM24S.dxf");
  const aberta = camadasDaMedicao({ ...m, fechada: false });
  assert.deepEqual(aberta.map((c) => c.nome), ["TRAJETO", "VERTICES"]);
  await assert.rejects(arquivoDaMedicao({ ...m, vertices: [] }, "kml"), /não tem vértices/);
});

test("linha da conta: números do motor único e a origem", () => {
  const m = fechadaExemplo();
  const l = linhaDaMedicao(m);
  const md = medir(m.vertices);
  assert.equal(l.area_m2, Math.round(md.areaM2 * 100) / 100);
  assert.equal(l.fuso, 24);
  assert.equal(l.n_vertices, 6);
  assert.equal(l.origem, "gps");
  assert.equal(linhaDaMedicao({ ...m, vertices: [...m.vertices, { ...m.vertices[0], modo: "mao", precisao: null }] }).origem, "misto");
  assert.equal(linhaDaMedicao({ ...m, nome: "   " }).nome, "Medição");
});

test("conta de mentira: grava, lista a mais nova primeiro, falha sob comando", async () => {
  let falha = null;
  const repo = repositorioMemoria([], { falha: () => falha, demoraMs: 0 });
  const a = fechadaExemplo(), b = alterar(fechadaExemplo(), { nome: "b" }, new Date(2030, 0, 1));
  await repo.salvar(a); await repo.salvar(b);
  assert.deepEqual((await repo.listar()).map((m) => m.nome), ["b", "Pasto da sede"]);
  falha = "sem-rede";
  await assert.rejects(repo.salvar(a), (e) => e.tipo === "sem-rede");
  falha = null;
  await repo.excluir(a.id);
  assert.equal((await repo.listar()).length, 1);
});

// ---------------------------------------------------------------- simulador
test("simulador: toca o trajeto em ordem, piora o sinal, para no fim", () => {
  const sim = criarSimulador(TRAJETO_EXEMPLO, 1000);
  const lidas = [];
  const parar = sim.iniciar((l) => lidas.push(l), () => {});
  sim.avancar(5);
  assert.equal(lidas.length, 5);
  assert.equal(lidas[4].lon, TRAJETO_EXEMPLO[5].lon);
  const antes = sim.estado();
  assert.equal(sim.estado(), antes, "o retrato não muda sem mudança (useSyncExternalStore)");
  sim.piorar(4);
  assert.notEqual(sim.estado(), antes);
  assert.equal(lidas.at(-1).precisao, TRAJETO_EXEMPLO[5].precisao * 4);
  sim.irPara(TRAJETO_EXEMPLO.length + 50);
  assert.equal(sim.estado().indice, TRAJETO_EXEMPLO.length - 1);
  parar();
  sim.avancar(1);
  const n = lidas.length;
  sim.avancar(1);
  assert.equal(lidas.length, n, "parado de ouvir, não recebe mais");
});

// ---------------------------------------------------------------- Ir para (sem GPS)
test("Ir para: decimal, GMS e link do Google Maps", async () => {
  const { lerLugar } = await import("../src/lib/campo/lugar.ts");
  const perto = (p, lon, lat) => p && Math.abs(p[0] - lon) < 1e-4 && Math.abs(p[1] - lat) < 1e-4;
  assert.ok(perto(lerLugar("-12.6915, -39.1262"), -39.1262, -12.6915));
  assert.ok(perto(lerLugar("-12,6915 -39,1262"), -39.1262, -12.6915));
  assert.ok(perto(lerLugar("-39.1262, -12.6915"), -39.1262, -12.6915), "lon, lat trocado é desvirado");
  assert.ok(perto(lerLugar(`12°41'29.4"S 39°07'34.3"W`), -39.12619, -12.69150));
  assert.ok(perto(lerLugar(`39°07'34,3" O 12°41'29,4" S`), -39.12619, -12.69150));
  assert.ok(perto(lerLugar("https://www.google.com/maps/@-12.6915,-39.1262,17z"), -39.1262, -12.6915));
  assert.ok(perto(lerLugar("https://maps.google.com/?q=-12.6915,-39.1262"), -39.1262, -12.6915));
  assert.ok(perto(lerLugar("https://www.google.com/maps/place/X/@-12.7,-39.1,15z/data=!3d-12.6915!4d-39.1262"), -39.1262, -12.6915));
  for (const ruim of ["", "fazenda boa vista", "100, 200", "0, 0", "https://www.google.com/maps/search/fazenda"]) assert.equal(lerLugar(ruim), null, ruim);
});
