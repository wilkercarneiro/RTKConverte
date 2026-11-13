// CAR: sobreposição com os imóveis vizinhos e o ajuste automático do terreno.
//
// Caso real (12/11/2026): um CAR enviado pelo sistema "não acusou sobreposição",
// mas o SEIA e a Consultar imóvel acusaram — o serviço do CAR só cruzava o
// perímetro com as bases de restrição (TI, UC, embargo…), nunca com os outros
// CAR do SICAR nem com o SIGEF. O KML de exemplo do escritório
// (tests/fixtures/car/PLANTA.kml) invade dois vizinhos no SICAR; a resposta do
// GeoServer do SICAR daquele dia está gravada em sicar_vizinhos_planta.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { lerKml } from "../src/lib/car/kml.ts";
import { calcularCar, normalizarProjetoCar, projetoNovo, reservaPorLado, ajustarReserva } from "../src/lib/car/motor.ts";
import { ajustarSobreposicao, FOLGA_M, fraseDoAjuste } from "../src/lib/car/sobreposicao.ts";
import { carSobreAArea } from "../src/lib/consulta/car.ts";
import { metros } from "../src/lib/car/gpx.ts";

const dir = new URL("./fixtures/car/", import.meta.url);
const kml = lerKml(fs.readFileSync(new URL("PLANTA.kml", dir), "utf8"));
const vizinhos = JSON.parse(fs.readFileSync(new URL("sicar_vizinhos_planta.json", dir), "utf8"));
const PROPRIO = "BA-2908408-F6EEB7AE67DA44FB8C9DFD0B8FA0E7CB";
const INVADIDOS = ["BA-2908408-FD770354245847D39D33F40DCEE28BBA", "BA-2908408-C7BEDDDED3E7499D95B32DC48E2E8D09"];

/** O motor da Consultar imóvel (UTM, independente do CAR) medindo a sobreposição. */
const sobreposicoesNaConsulta = (perimetro) =>
  carSobreAArea([perimetro], vizinhos.map((v) => ({ codigo: v.codigo, situacao: v.situacao, poligonos: v.poligonos })), PROPRIO)
    .filter((x) => x.areaM2 > 0);

test("caso real: o perímetro do arquivo invade dois CAR vizinhos (o que o SEIA acusou)", () => {
  const s = sobreposicoesNaConsulta(kml.perimetro);
  assert.deepEqual(s.map((x) => x.codigo).sort(), [...INVADIDOS].sort());
  assert.ok(s[0].areaM2 > 1000, `a maior sobreposição tem ${s[0].areaM2} m²`);
});

test("ajuste: corta os dois vizinhos, reconhece o próprio CAR e a Consulta não acha mais sobreposição", () => {
  const a = ajustarSobreposicao(kml.perimetro, vizinhos);
  const por = Object.fromEntries(a.itens.map((i) => [i.codigo, i.decisao]));
  assert.equal(por[PROPRIO], "proprio", "o CAR do próprio imóvel (100% × 100%) não é recortado");
  for (const c of INVADIDOS) assert.equal(por[c], "cortado");
  assert.ok(a.perimetro, "saiu um perímetro novo");
  assert.equal(a.restanteM2, 0);
  assert.deepEqual(sobreposicoesNaConsulta(a.perimetro), [], "conferência independente: nada sobrepõe depois");
  // saiu só a sobreposição (+ a folga de 10 cm na divisa nova), não um pedaço a mais
  const sobreposto = a.itens.filter((i) => i.decisao === "cortado").reduce((s, i) => s + i.areaM2, 0);
  const tirado = a.antesM2 - a.depoisM2;
  assert.ok(tirado >= sobreposto && tirado < sobreposto + 40, `tirou ${tirado.toFixed(1)} m² para ${sobreposto.toFixed(1)} m² de sobreposição`);
  assert.equal(a.lascasM2, 0);
  // e o texto do aviso fala do ajuste
  assert.match(fraseDoAjuste(a, (m) => `${(m / 1e4).toFixed(4)} ha`, (m) => `${m.toFixed(0)} m²`), /Deu sobreposição .* mas ajustamos o terreno/);
});

test("ajuste: os vértices do levantamento ficam exatos; vértice novo não nasce colado em outro", () => {
  const a = ajustarSobreposicao(kml.perimetro, vizinhos);
  const originais = new Set(kml.perimetro.map((p) => p.join(",")));
  const novos = a.perimetro.filter((p) => !originais.has(p.join(",")));
  assert.ok(novos.length > 0 && novos.length < a.perimetro.length);
  for (const p of novos) {
    const i = a.perimetro.indexOf(p);
    const ant = a.perimetro[(i - 1 + a.perimetro.length) % a.perimetro.length], prox = a.perimetro[(i + 1) % a.perimetro.length];
    const d = Math.min(metros(p, ant), metros(p, prox));
    assert.ok(d > 0.5, `vértice novo a ${d.toFixed(2)} m do vizinho de anel`);
  }
});

test("ajuste: a divisa nova fica fora do vizinho com a folga (não em cima)", () => {
  const a = ajustarSobreposicao(kml.perimetro, vizinhos);
  // alargar o vizinho um pouco menos que a folga ainda não pode tocar o imóvel
  const quase = ajustarSobreposicao(a.perimetro, vizinhos.filter((v) => INVADIDOS.includes(v.codigo)));
  assert.equal(quase.itens.length, 0);
  assert.ok(FOLGA_M >= 0.05);
});

test("ajuste: o CAR completo continua fechando no perímetro novo (reserva na porcentagem)", () => {
  const a = ajustarSobreposicao(kml.perimetro, vizinhos);
  // reserva desenhada ANTES do ajuste: depois do corte volta à % sem sair do lugar
  const antes = projetoNovo("X", kml.perimetro);
  antes.reserva.poligonos = reservaPorLado(antes, 2);
  const depois = { ...antes, perimetro: a.perimetro };
  depois.reserva = { ...depois.reserva, poligonos: ajustarReserva(depois), lado: null };
  const r = calcularCar(depois);
  assert.ok(r.reservaOk, `reserva ${r.pctReserva}`);
  const soma = r.area.reserva + r.area.produtiva;
  assert.ok(Math.abs(soma - r.area.imovel) < 0.05, "reserva + produtiva fecham o imóvel");
});

test("ignorar (Desfazer ajuste) e forçar (Recortar este também)", () => {
  const ign = ajustarSobreposicao(kml.perimetro, vizinhos, { ignorar: INVADIDOS });
  assert.equal(ign.perimetro, null, "com os dois ignorados não há o que cortar");
  assert.deepEqual(ign.itens.filter((i) => i.decisao === "ignorado").map((i) => i.codigo).sort(), [...INVADIDOS].sort());
  // forçar o próprio: cortaria tudo — o imóvel some, nada é aplicado
  const forc = ajustarSobreposicao(kml.perimetro, vizinhos, { forcar: [PROPRIO] });
  assert.equal(forc.perimetro, null);
});

// ---------------------------------------------------------------------------
// casos de geometria (quadrados de ~111 m perto do equador)
// ---------------------------------------------------------------------------
const q = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const IMOVEL = q(-40, -10, -39.999, -9.999); // ~110 × 111 m
const viz = (codigo, anel, fonte = "car") => ({ fonte, codigo, rotulo: `${fonte.toUpperCase()} ${codigo}`, poligonos: [[anel]] });

test("vizinho que só encosta não é sobreposição", () => {
  const a = ajustarSobreposicao(IMOVEL, [viz("A", q(-39.999, -10, -39.998, -9.999))]);
  assert.equal(a.itens.length, 0);
  assert.equal(a.perimetro, null);
});

test("vizinho no canto: corta e fica um anel só, menor", () => {
  const a = ajustarSobreposicao(IMOVEL, [viz("A", q(-39.9993, -10.0005, -39.998, -9.9997))]);
  assert.equal(a.itens[0].decisao, "cortado");
  assert.ok(a.perimetro.length >= 5);
  assert.ok(a.depoisM2 < a.antesM2);
  assert.equal(a.restanteM2, 0);
});

test("SIGEF também conta (parcela certificada)", () => {
  const a = ajustarSobreposicao(IMOVEL, [viz("S1", q(-40.0005, -10.0005, -39.9995, -9.9995), "sigef")]);
  assert.equal(a.itens[0].fonte, "sigef");
  assert.equal(a.itens[0].decisao, "cortado");
});

test("vizinho que levaria mais da metade não é recortado sozinho", () => {
  const a = ajustarSobreposicao(IMOVEL, [viz("G", q(-40.001, -10.001, -39.9993, -9.998))]);
  assert.equal(a.itens[0].decisao, "grande");
  assert.equal(a.perimetro, null);
});

test("vizinho inteiro dentro do imóvel: não faz furo, fica para conferir", () => {
  const a = ajustarSobreposicao(IMOVEL, [viz("D", q(-39.9996, -9.9996, -39.9994, -9.9994))]);
  assert.equal(a.itens[0].decisao, "dentro");
  assert.equal(a.perimetro, null);
});

test("corte que solta uma lasca: fica o maior pedaço e a lasca é informada", () => {
  // faixa vizinha atravessando perto de uma ponta: separa uma tira de ~10 m
  const a = ajustarSobreposicao(IMOVEL, [viz("F", q(-40.001, -9.99915, -39.998, -9.9991))]);
  assert.equal(a.itens[0].decisao, "cortado");
  assert.ok(a.lascasM2 > 100, `lasca de ${a.lascasM2} m²`);
  assert.equal(a.restanteM2, 0);
});

test("o registro do ajuste sobrevive à gravação (normalizarProjetoCar)", () => {
  const base = projetoNovo("X", IMOVEL);
  const reg = { original: IMOVEL, cortes: [{ fonte: "car", codigo: "A", rotulo: "CAR A", areaM2: 12 }], antesM2: 1, depoisM2: 0.9, em: "2026-11-12T10:00:00Z", ignorar: ["B"], forcar: [] };
  const p = normalizarProjetoCar(JSON.parse(JSON.stringify({ ...base, sobreposicao: reg })), base);
  assert.deepEqual(p.sobreposicao.cortes, reg.cortes);
  assert.deepEqual(p.sobreposicao.ignorar, ["B"]);
  assert.deepEqual(normalizarProjetoCar(JSON.parse(JSON.stringify(base)), base).sobreposicao, undefined);
});

// ---------------- correções da auditoria de 13/11/2026 ----------------
// 1) CAR Cancelado/Suspenso não tira terreno do cliente sozinho;
// 2) resposta parcial do SICAR e falha/atraso do SIGEF aparecem (não vira "sem sobreposição");
// 3) CAR já exportado não é recortado sozinho ao abrir.
import { situacaoInativa } from "../src/lib/car/sobreposicao.ts";
import { consultarVizinhos, motivosIncompleta } from "../src/lib/car/vizinhos.ts";

const CANTO = q(-39.9992, -10.0002, -39.9988, -9.9998); // pega uma quina do IMOVEL
const vizS = (codigo, situacao) => ({ ...viz(codigo, CANTO), situacao });

test("situacaoInativa: Cancelado/Suspenso (com ou sem condição) sim; Ativo/Pendente não", () => {
  for (const s of ["Cancelado", "Suspenso · Aguardando análise", "cancelada", "SUSPENSO", "Inativo"]) assert.ok(situacaoInativa(s), s);
  for (const s of ["Ativo · Aguardando análise", "Pendente", "Certificada", "", null, undefined]) assert.ok(!situacaoInativa(s), String(s));
});

test("CAR Cancelado ou Suspenso: não corta sozinho, fica para conferir; Ativo corta", () => {
  for (const sit of ["Cancelado", "Suspenso · Aguardando análise"]) {
    const a = ajustarSobreposicao(IMOVEL, [vizS("X", sit)]);
    assert.equal(a.itens[0].decisao, "inativo", sit);
    assert.equal(a.perimetro, null, `${sit}: o terreno não muda`);
  }
  assert.equal(ajustarSobreposicao(IMOVEL, [vizS("X", "Ativo · Aguardando análise")]).itens[0].decisao, "cortado");
  // "Recortar este também" continua valendo
  const f = ajustarSobreposicao(IMOVEL, [vizS("X", "Cancelado")], { forcar: ["X"] });
  assert.equal(f.itens[0].decisao, "cortado");
  assert.ok(f.perimetro);
});

test("caso real com os dois invadidos Cancelados: nenhum corte", () => {
  const cancelados = vizinhos.map((v) => (INVADIDOS.includes(v.codigo) ? { ...v, situacao: "Cancelado" } : v));
  const a = ajustarSobreposicao(kml.perimetro, cancelados);
  assert.equal(a.perimetro, null);
  for (const c of INVADIDOS) assert.equal(a.itens.find((i) => i.codigo === c).decisao, "inativo");
});

const bases = (o = {}) => ({
  carNaCaixa: async () => ({ imoveis: [], cortada: false }),
  consultarSigef: async () => ({ parcelas: { type: "FeatureCollection", features: [] }, sobreposicoes: [] }),
  sincronizarSigef: async (_a, uf) => ({ ok: true, uf, camadas: [], guardadas: 0, removidas: 0, avisos: [] }),
  ...o,
});

test("consulta completa: nenhum motivo (pode dizer 'sem sobreposição')", async () => {
  const d = await consultarVizinhos(IMOVEL, "BA", bases());
  assert.deepEqual(motivosIncompleta(d), []);
});

test("SICAR devolveu só parte dos imóveis: a consulta é incompleta", async () => {
  const d = await consultarVizinhos(IMOVEL, "BA", bases({ carNaCaixa: async () => ({ imoveis: [], cortada: true }) }));
  assert.ok(d.cortada);
  assert.ok(motivosIncompleta(d).some((m) => /SICAR devolveu só parte/.test(m)));
});

test("INCRA fora do ar (sincronizar falha ou responde ok:false): aparece, não é engolido", async () => {
  const caiu = await consultarVizinhos(IMOVEL, "BA", bases({ sincronizarSigef: async () => { throw new Error("timeout"); } }));
  assert.ok(motivosIncompleta(caiu).some((m) => /SIGEF: o INCRA não respondeu \(timeout\)/.test(m)));
  const naoOk = await consultarVizinhos(IMOVEL, "BA", bases({ sincronizarSigef: async (_a, uf) => ({ ok: false, uf, camadas: [], guardadas: 0, removidas: 0, avisos: ["503"] }) }));
  assert.ok(motivosIncompleta(naoOk).some((m) => /INCRA não respondeu \(503\)/.test(m)));
  const semUf = await consultarVizinhos(IMOVEL, null, bases());
  assert.ok(motivosIncompleta(semUf).some((m) => /UF do imóvel desconhecida/.test(m)));
});

test("base do SIGEF ou SICAR sem resposta: falha listada", async () => {
  const d = await consultarVizinhos(IMOVEL, "BA", bases({
    consultarSigef: async () => { throw new Error("rpc caiu"); },
    carNaCaixa: async () => { throw new Error("GeoServer 502"); },
  }));
  const m = motivosIncompleta(d).join(" | ");
  assert.match(m, /SIGEF: rpc caiu/);
  assert.match(m, /SICAR\): GeoServer 502/);
});

test("CAR já exportado (status gerado) não é recortado sozinho ao abrir", () => {
  const src = fs.readFileSync(new URL("../src/components/car/Car.tsx", import.meta.url), "utf8");
  const efeito = src.slice(src.indexOf("const a = sob.ajuste;"), src.indexOf("aplicarAjuste(projeto, a);"));
  assert.match(efeito, /servico\.status === "gerado"\) return/);
  assert.match(src, /travado=\{travadoSob\}/);
});
