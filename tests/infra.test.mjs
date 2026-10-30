// Projetos de infraestrutura do loteamento (src/lib/loteamento/infra): água,
// esgoto, drenagem, energia e iluminação gerados a partir do traçado.
//
// O que se prova aqui é o que um projetista conferiria na planilha: a água
// fecha a continuidade em cada nó e a perda bate com Hazen-Williams; nenhum
// coletor fica sem recobrimento nem abaixo da declividade mínima; a galeria não
// passa da lâmina; nenhum transformador passa do limite nem da queda de tensão;
// todo lote tem ligação de água, esgoto e energia. E que as saídas abrem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { perimetro } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo } from "../src/lib/loteamento/modelo.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { paraUtm } from "../src/lib/loteamento/plano.ts";
import { dist, distSegmento } from "../src/lib/loteamento/geom.ts";
import { calcularInfra, IDF_SALVADOR } from "../src/lib/loteamento/infra/index.ts";
import { intensidade } from "../src/lib/loteamento/infra/parametros.ts";
import { TRAFOS, demandaPorUnidade } from "../src/lib/loteamento/infra/eletrica.ts";
import { DN_AGUA } from "../src/lib/loteamento/infra/agua.ts";
import { dxfRedes, memorialInfra, planilhaAgua, planilhaEsgoto, quantitativos, zipPlanilhas, pontosDasRedes } from "../src/lib/loteamento/infra/saidas.ts";
import { gerarPlantasInfra } from "../src/lib/loteamento/infra/planta.ts";
import { montarCena } from "../src/lib/loteamento/cena3d.ts";

const base = projetoNovo("TESTE", perimetro.pts.length);
base.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
const pr0 = gerarPropostas(base, perimetro, { quantas: 1 })[0].projeto;
const res = calcular(pr0, perimetro);

/** relevo: cai ~5% para leste, com ondulação (há ponto baixo no meio da gleba) */
function relevo(res, f = (i, j) => 330 - 0.05 * i * 8 + 2.5 * Math.sin((i * 8) / 60) * Math.cos((j * 8) / 50)) {
  const pts = res.gleba.ext.map((p) => paraUtm(res.plano, p));
  const e0 = Math.min(...pts.map((p) => p[0])) - 100, n0 = Math.min(...pts.map((p) => p[1])) - 100;
  const nx = 80, ny = 70, h = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h.push(f(i, j));
  return { e0, n0, passo: 8, nx, ny, h, fonte: "dem", calibracao: 0 };
}
const pr = { ...pr0, terreno: relevo(res) };
const t0 = performance.now();
const r = calcularInfra(res, pr);
const ms = performance.now() - t0;

test("grafo das ruas: todo lote ligado a uma rua da rede, e rápido", () => {
  assert.equal(r.grafo.semRede.length, 0, "lote sem rua");
  assert.equal(r.lotes, res.lotes.length);
  assert.ok(r.grafo.nos.length > 5 && r.grafo.arestas.length > 5);
  for (const e of r.grafo.arestas) assert.ok(e.L > 0.5 && e.a !== e.b);
  assert.ok(ms < 3000, `${ms.toFixed(0)} ms`);
  // mesmo resultado sem recalcular (cache por resultado)
  assert.equal(calcularInfra(res, pr), r);
});

test("água: continuidade em cada nó e perda de carga de Hazen-Williams", () => {
  const a = r.agua;
  const R = r.grafo.nos.length;
  const saldo = new Map();
  for (const t of a.tubos) {
    saldo.set(t.de, (saldo.get(t.de) ?? 0) - t.q);
    saldo.set(t.para, (saldo.get(t.para) ?? 0) + t.q);
  }
  for (const n of a.nos) assert.ok(Math.abs((saldo.get(n.no) ?? 0) - n.demanda) < 1e-3, `nó ${n.no}: entra − sai = ${saldo.get(n.no)} × demanda ${n.demanda}`);
  // o reservatório entrega a vazão da hora de maior consumo
  assert.ok(Math.abs(-(saldo.get(R) ?? 0) - a.resumo.qHora) < 1e-3);
  const DI = { 50: 0.0476, 75: 0.0725, 100: 0.0976, 150: 0.1564, 200: 0.2042, 250: 0.2526, 300: 0.3008 };
  for (const t of a.tubos) {
    const q = Math.abs(t.q) / 1000 / (t.dupla ? 2 : 1);
    const hw = (10.67 * t.L * q ** 1.852) / (r.params.cHW ** 1.852 * DI[t.dn] ** 4.87);
    assert.ok(Math.abs(hw - t.hf) < 0.002 + 0.01 * hw, `${t.id}: hf ${t.hf} × HW ${hw}`);
    assert.ok(t.j <= r.params.perdaMax + 1e-6 || t.dn === DN_AGUA[DN_AGUA.length - 1], `${t.id} com ${t.j} m/km`);
    assert.ok(t.dn >= 50);
  }
});

test("água: pressão mínima garantida pelo nível do reservatório; volume de 1/3 do dia", () => {
  const a = r.agua;
  assert.ok(a.resumo.pMin >= r.params.pressaoMin - 0.11, `pMin ${a.resumo.pMin}`);
  const rs = a.reservatorio;
  assert.ok(rs && rs.volume >= (r.populacao * r.params.perCapita * r.params.k1) / 1000 / 3);
  assert.equal(rs.tipo === "elevado", rs.altura > 0);
  assert.equal(a.ligacoes.length, res.lotes.length);
  assert.ok(a.hidrantes.length >= 1);
  // todo lote a menos de 300 m de um hidrante
  for (const e of r.grafo.arestas) for (const fr of e.frentes) assert.ok(a.hidrantes.some((h) => dist(h.p, fr) <= r.params.raioHidrante + 1e-6));
});

test("esgoto: recobrimento, declividade mínima, lâmina e vazões acumuladas até a saída", () => {
  const e = r.esgoto;
  const cob = r.params.recobrimentoEsgoto;
  for (const t of e.trechos) {
    const D = t.dn / 1000, a = e.pvs[t.de], b = e.pvs[t.para];
    assert.ok(a.z - t.fMont - D >= cob - 1e-6, `${t.id} sem recobrimento na montante`);
    assert.ok(b.z - t.fJus - D >= cob - 1e-6, `${t.id} sem recobrimento na jusante`);
    const Imin = Math.max(0.0055 * Math.max(1.5, t.qi) ** -0.47, 0.005);
    assert.ok(t.I >= Imin - 1e-9, `${t.id}: I ${t.I} < ${Imin}`);
    assert.ok(t.lamina <= 0.75 + 1e-6, `${t.id}: y/D ${t.lamina}`);
    assert.ok(t.tensao >= 0.99, `${t.id}: tensão trativa ${t.tensao}`);
    assert.ok(t.qf >= 1.5 && t.dn >= r.params.dnMinEsgoto);
  }
  // cada PV tem uma saída só (rede em árvore), menos o de lançamento
  const saem = new Map();
  for (const t of e.trechos) saem.set(t.de, (saem.get(t.de) ?? 0) + 1);
  for (const [, n] of saem) assert.equal(n, 1);
  assert.ok(!saem.has(e.saida.pv));
  // no lançamento chega o esgoto de todos os lotes
  const qm = (r.populacao * r.params.perCapita * r.params.retorno) / 86400;
  const inf = (r.params.infiltracao * e.trechos.reduce((s, t) => s + t.L, 0)) / 1000;
  assert.ok(Math.abs(e.saida.q - (qm * r.params.k1 * r.params.k2 + inf)) < 0.01, `${e.saida.q}`);
  assert.equal(e.ligacoes.length, res.lotes.length);
  // a estação fica no ponto mais baixo da rede (nada desce para ela subindo)
  assert.ok(e.saida.z <= Math.min(...r.grafo.nos.map((n) => n.z)) + 1e-6);
  assert.ok(e.resumo.profMax < 4, `profundidade ${e.resumo.profMax}`);
});

test("esgoto para a rede pública: ponto baixo abaixo da estrada pede estação elevatória", () => {
  const r2 = calcularInfra(res, { ...pr, infra: { destinoEsgoto: "rede" } });
  const e = r2.esgoto;
  const zEstrada = Math.min(...r2.grafo.nos.filter((n) => n.arestas.some((ei) => r2.grafo.arestas[ei].tipo === "acesso") || n.naDivisa).map((n) => n.z));
  if (Math.min(...r2.grafo.nos.map((n) => n.z)) < zEstrada - 1) {
    assert.ok(e.elevatoria, "faltou a elevatória");
    assert.ok(e.elevatoria.L > 0 && e.elevatoria.altura > 1);
    assert.match(e.avisos.join(" "), /elevatória/);
  }
});

test("drenagem: chuva de Salvador, galeria dentro da lâmina e o lançamento leva tudo", () => {
  // conferência da equação do SGB: T = 10 anos, 10 min → 120,3 mm/h
  assert.ok(Math.abs(intensidade(IDF_SALVADOR, 10, 10) - 120.3) < 0.2);
  const d = r.drenagem;
  assert.ok(d.bocas.length > 0 && d.trechos.length > 0);
  for (const t of d.trechos) {
    assert.ok(t.lamina <= 0.85 + 1e-6 || t.dn === 1500, `${t.id}: y/D ${t.lamina}`);
    assert.ok(t.dn >= 400);
    const D = t.dn / 1000;
    assert.ok(d.pvs[t.de].z - t.fMont - D >= 1 - 1e-6, `${t.id} sem recobrimento`);
  }
  // toda boca de lobo tem ramal curto até um PV
  assert.equal(d.ramais.length, d.bocas.length);
  for (const rm of d.ramais) assert.ok(dist(rm.de, rm.ate) < 15, `ramal de ${dist(rm.de, rm.ate)} m`);
  // vazão de lançamento coerente com o método racional da área toda (tc maior → i menor)
  const qMax = (d.resumo.areaDrenada * d.resumo.cMedio * d.resumo.i10) / 3.6e6 * 1000;
  assert.ok(d.resumo.qLancamento > 0.3 * qMax && d.resumo.qLancamento <= qMax * 1.01, `${d.resumo.qLancamento} × ${qMax}`);
});

test("energia: trafo nunca acima do limite, queda e alcance dentro da norma, média tensão chega a todos", () => {
  const e = r.eletrica;
  assert.ok(e.trafos.length >= 1);
  for (const t of e.trafos) {
    const lim = TRAFOS.find((x) => x.kva === t.kva).limite;
    assert.ok(t.demanda <= lim + 1e-6, `${t.id}: ${t.demanda} kVA num de ${t.kva}`);
    assert.ok(t.queda <= r.params.quedaMax + 1e-6, `${t.id}: queda ${t.queda}%`);
    assert.ok(t.alcance <= 200 + 1e-6, `${t.id}: alcance ${t.alcance} m`);
    assert.ok(e.postes[t.poste].mt, "trafo fora da média tensão");
  }
  // todo lote com ramal; nenhum ramal acima de 40 m
  assert.equal(e.ramais.length, res.lotes.length);
  for (const rm of e.ramais) assert.ok(rm.L <= 40, `ramal de ${rm.L} m`);
  // a média tensão liga a entrada a cada transformador
  const adj = new Map();
  for (const v of e.vaos) if (v.mt) { adj.set(v.a, [...(adj.get(v.a) ?? []), v.b]); adj.set(v.b, [...(adj.get(v.b) ?? []), v.a]); }
  const visto = new Set([e.entrada.poste]), pilha = [e.entrada.poste];
  while (pilha.length) for (const v of adj.get(pilha.pop()) ?? []) if (!visto.has(v)) { visto.add(v); pilha.push(v); }
  for (const t of e.trafos) assert.ok(visto.has(t.poste), `${t.id} sem média tensão`);
  // vão básico: nenhum poste da mesma rua a mais de 45 m do vizinho
  assert.ok(e.vaos.filter((v) => v.L > 45).length <= 2);
  // Tab. 17: demanda cai com o número de unidades
  assert.equal(demandaPorUnidade("B", 3), 3.08);
  assert.equal(demandaPorUnidade("B", 80), 1.25);
  assert.ok(demandaPorUnidade("B", 20) < 3.08 && demandaPorUnidade("B", 20) > 1.25);
  // iluminação atinge a classe
  assert.ok(e.ip.eMedia >= e.ip.alvo);
  // 380/220 V alcança mais longe: no máximo o mesmo número de trafos
  const r380 = calcularInfra(res, { ...pr, infra: { tensaoBT: "380/220" } });
  assert.ok(r380.eletrica.trafos.length <= e.trafos.length);
});

test("sem relevo: tudo calculado no plano, com aviso", () => {
  const r0 = calcularInfra(res, pr0);
  assert.equal(r0.grafo.temRelevo, false);
  assert.match(r0.esgoto.avisos.join(" "), /plano/);
  for (const t of r0.esgoto.trechos) assert.ok(t.I >= 0.005 - 1e-9);
});

test("maquete: os postes do projeto entram na cena, com fios, hidrantes e tampas, e sem árvore sob os fios", () => {
  const c = montarCena(res, pr.params, pr.terreno, { infra: r });
  assert.equal(c.postes.length, r.eletrica.postes.length);
  assert.ok(c.postes.every((p) => p.altura === 9 || p.altura === 12));
  assert.ok(c.infra.fios.length > r.eletrica.vaos.length);
  assert.equal(c.infra.hidrantes.length, r.agua.hidrantes.length);
  assert.equal(c.infra.tampas.length, r.esgoto.pvs.length + r.drenagem.pvs.length);
  assert.ok(c.infra.reservatorio);
  const e = r.eletrica;
  for (const a of c.arvores) for (const v of e.vaos) if (v.mt || v.bt) assert.ok(distSegmento(a.p, e.postes[v.a].p, e.postes[v.b].p).d >= 2.4 - 1e-6);
  // o prédio institucional não passa pelo reservatório
  const rs = r.agua.reservatorio;
  for (const casa of c.casas.filter((x) => x.lote < 0)) assert.ok(dist(casa.c, rs.p) > Math.min(casa.larg, casa.prof) / 2);
});

test("saídas: planilhas, quantitativos, memorial, DXF, pranchas PDF e locação", async () => {
  const pa = planilhaAgua(r).split("\r\n").filter(Boolean);
  assert.equal(pa.length, r.agua.tubos.length + 1);
  assert.match(pa[0], /Trecho;Rua;Nó montante/);
  assert.equal(planilhaEsgoto(r).split("\r\n").filter(Boolean).length, r.esgoto.trechos.length + 1);
  const zip = await JSZip.loadAsync(await (await zipPlanilhas(res, r, "TESTE")).arrayBuffer());
  assert.equal(Object.keys(zip.files).length, 5);
  const q = quantitativos(r);
  for (const rede of ["Água", "Esgoto", "Drenagem", "Energia", "Iluminação"]) assert.ok(q.some((x) => x.rede === rede), rede);
  // condutores com 4% de sobra
  const mt = q.find((x) => x.item.startsWith("Cabo coberto"));
  assert.ok(Math.abs(mt.qtd - r.eletrica.resumo.extensaoMT * 1.04) < 0.01);
  const mem = memorialInfra(res, pr, r, { municipio: "Vitória da Conquista", uf: "BA", rt: "X", rtRegistro: "CREA 1", trt: "" });
  assert.equal(mem.length, 8);
  assert.match(mem.map((s) => s.paragrafos.join(" ")).join(" "), /NBR 12218/);
  const dxf = dxfRedes(res, r);
  assert.ok(dxf.startsWith("0\r\nSECTION") && dxf.trimEnd().endsWith("EOF"));
  for (const c of ["AGUA_REDE", "ESGOTO_PV", "DRENAGEM_GALERIA", "ENERGIA_MT"]) assert.ok(dxf.includes(c), c);
  const carimbo = { empresa: "", cnpj: "", desenhista: "", proprietario: "", cpfProprietario: "", imovel: "", municipio: "", uf: "", matricula: "", rt: "", rtRegistro: "", trt: "", fuso: 24, logo: null };
  const pdf = await PDFDocument.load(await gerarPlantasInfra(res, pr, r, carimbo, "A3"));
  assert.equal(pdf.getPageCount(), 4);
  const loc = pontosDasRedes(res, r);
  assert.ok(loc.some((p) => p.nome.startsWith("PV-")) && loc.some((p) => p.nome.startsWith("P")) && loc.every((p) => p.e > 400000 && p.n > 8_000_000));
});
