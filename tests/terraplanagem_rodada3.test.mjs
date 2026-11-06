// Terraplanagem, rodada 3 da revisão: arquivo sem altitude (cotas 0,000) é
// recusado e terreno sem desnível nunca vira "pronto"; KML no fuso vizinho dos
// pontos; nenhum caminhão para volume nulo e sem "-0,00"; e a gravação: projeto
// apagado em outro aparelho some deste, navegador cheio não apaga o que só
// existe aqui, e as gravações na conta vão em fila (a última vale).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import proj4 from "proj4";
import { calcularTerraplanagem, fmtN } from "../src/lib/terraplanagem/calculo.ts";
import { ERRO_KML_LONGE, lerArquivoDePontos, poligonoDoKml, pontosParaFuso } from "../src/lib/terraplanagem/entrada.ts";
import { filtrarCotasZero, lerPontos, MSG_SEM_ALTITUDE, MSG_SEM_DESNIVEL } from "../src/lib/terraplanagem/pontos.ts";
import { projetoNovo } from "../src/lib/terraplanagem/modelo.ts";
import { estadoDaEntrega, textoCaminhoes } from "../src/lib/terraplanagem/textos.ts";
import { GEO_DEF, utmDef } from "../supabase/functions/_shared/geo.ts";

const fixture = fs.readFileSync(new URL("./fixtures/terraplanagem/levantamento-declive.txt", import.meta.url), "utf8");

/** levantamento em grade, "nome;E;N;cota" com vírgula decimal */
function arquivo(n, cota) {
  const linhas = ["PONTO;E;N;COTA"];
  for (let i = 0; i < n; i++) {
    const x = (i % 20) * 3, y = Math.floor(i / 20) * 3;
    linhas.push(`${i + 1};${(487300 + x).toFixed(3).replace(".", ",")};${(8634100 + y).toFixed(3).replace(".", ",")};${cota(i, x, y).toFixed(3).replace(".", ",")}`);
  }
  return linhas.join("\n");
}

// ---------------------------------------------------------------- sem altitude
test("cotas 0,000: todas → recusa com a frase de exportar com altitude", () => {
  const l = lerPontos(arquivo(400, () => 0));
  assert.equal(l.pontos.length, 0);
  assert.deepEqual(l.avisos, [MSG_SEM_ALTITUDE]);
});

test("cotas 0,000: 30% dos pontos → recusa (não inventa 1,2 milhão de m³)", () => {
  const l = lerPontos(arquivo(400, (i, x, y) => (i % 10 < 3 ? 0 : 300 + 0.05 * x + 0.02 * y)));
  assert.equal(l.pontos.length, 0);
  assert.deepEqual(l.avisos, [MSG_SEM_ALTITUDE]);
});

test("cotas 0,000: 10% dos pontos → os zeros saem com aviso, o resto fica", () => {
  const l = lerPontos(arquivo(400, (i, x, y) => (i % 10 === 0 ? 0 : 300 + 0.05 * x + 0.02 * y)));
  assert.equal(l.pontos.length, 360);
  assert.ok(l.pontos.every((p) => p.z !== 0));
  assert.ok(l.avisos.some((a) => /40 ponto\(s\) com cota 0,000 ficaram de fora/.test(a)), l.avisos.join(" | "));
});

test("leitor do navegador: arquivo sem altitude não passa pelo leitor universal", async () => {
  const f = new File([arquivo(120, () => 0)], "coletora.txt", { type: "text/plain" });
  const l = await lerArquivoDePontos(f);
  assert.equal(l.pontos.length, 0);
  assert.deepEqual(l.avisos, [MSG_SEM_ALTITUDE]);
});

test("a regra das cotas zero é uma só (leitor próprio e universal usam filtrarCotasZero)", () => {
  const pts = (n, zeros) => Array.from({ length: n }, (_, i) => ({ z: i < zeros ? 0 : 100 + i * 0.1 }));
  assert.equal(filtrarCotasZero(pts(10, 2)).recusa, MSG_SEM_ALTITUDE);
  assert.equal(filtrarCotasZero(pts(10, 1)).recusa, null);
  assert.equal(filtrarCotasZero(pts(10, 1)).pontos.length, 9);
  assert.equal(filtrarCotasZero(pts(10, 0)).avisos.length, 0);
});

test("terreno sem desnível: aviso na leitura e a faixa fica pendente (nunca 'pronto')", () => {
  const l = lerPontos(arquivo(200, () => 150));
  assert.equal(l.pontos.length, 200);
  assert.ok(l.avisos.includes(MSG_SEM_DESNIVEL));
  const pr = projetoNovo("plano", l.pontos, { tipo: "arquivo", arquivo: "x.txt" }, 24);
  const r = calcularTerraplanagem(pr);
  const e = estadoDaEntrega({ r, erro: null, ocupado: false, modo: "contorno", folga: null, desnivel: 0 });
  assert.equal(e.tom, "pendente");
  assert.notEqual(e.titulo, "Pronto para o cliente");
  // com desnível de verdade continua "pronto"
  assert.equal(estadoDaEntrega({ r, erro: null, ocupado: false, modo: "contorno", folga: null, desnivel: 3.2 }).tom, "pronto");
});

// ---------------------------------------------------------------- caminhões e zero
test("terreno plano na cota: nenhum caminhão e nenhum '-0'", () => {
  const l = lerPontos(arquivo(200, () => 150));
  const r = calcularTerraplanagem(projetoNovo("plano", l.pontos, { tipo: "arquivo", arquivo: "x.txt" }, 24));
  assert.equal(r.caminhoes.quantidade, 0);
  assert.equal(r.caminhoes.volumeSolto, 0);
  const pr = projetoNovo("plano", l.pontos, { tipo: "arquivo", arquivo: "x.txt" }, 24);
  assert.match(textoCaminhoes(r, pr), /nenhum caminhão/);
  assert.equal(fmtN(-0.0004, 2), "0,00");
  assert.equal(fmtN(-0.0004, 3), "0,000");
  assert.equal(fmtN(-0, 1), "0,0");
  assert.equal(fmtN(-1.5, 1), "-1,5");
});

test("caminhões: volume solto arredondado a 0,1 m³ antes de contar", () => {
  const pr = projetoNovo("Galpão", lerPontos(fixture).pontos, { tipo: "arquivo", arquivo: "x.txt" }, 24);
  const r = calcularTerraplanagem(pr);
  assert.equal(Math.round(r.caminhoes.volumeSolto * 10) / 10, r.caminhoes.volumeSolto);
  assert.equal(r.caminhoes.quantidade, Math.ceil(r.caminhoes.volumeSolto / pr.fatores.caminhao - 1e-9));
});

// ---------------------------------------------------------------- KML em dois fusos
const kmlEm = (coords) => `<?xml version="1.0"?><kml><Document><Placemark><name>Galpão</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords.map(([lo, la]) => `${lo},${la},0`).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;

test("KML perto da divisa: pontos em UTM do fuso 24, KML com longitude do 23 → fuso 24 deduzido", () => {
  // pontos do levantamento em UTM 24S em volta de -42,002 / -12,5 (oeste da divisa de -42°)
  const [e0, n0] = proj4(GEO_DEF, utmDef(24), [-42.002, -12.5]);
  const pontos = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) pontos.push([e0 - 300 + i * 60, n0 - 300 + j * 60]);
  const kml = kmlEm([[-42.004, -12.501], [-41.9995, -12.501], [-41.9995, -12.499], [-42.004, -12.499], [-42.004, -12.501]]);
  // sem os pontos, o fuso sai da longitude do KML (23) — a centenas de km
  assert.equal(poligonoDoKml(kml, null).fuso, 23);
  const k = poligonoDoKml(kml, null, pontos);
  assert.equal(k.fuso, 24);
  assert.equal(k.fusoDeduzido, true);
  const cx = k.utm.reduce((s, p) => s + p[0], 0) / k.utm.length;
  assert.ok(Math.abs(cx - e0) < 400, `E do KML ${cx} longe dos pontos ${e0}`);
  // com o fuso do projeto conhecido, ele manda (não deduz)
  assert.equal(poligonoDoKml(kml, 24, pontos).fusoDeduzido, false);
});

test("KML de outra região: frase específica, não 'fora da área levantada'", () => {
  const [e0, n0] = proj4(GEO_DEF, utmDef(24), [-39, -12.5]);
  const pontos = [[e0, n0], [e0 + 100, n0], [e0 + 100, n0 + 100], [e0, n0 + 100]];
  const kml = kmlEm([[-48.001, -15.8], [-48, -15.8], [-48, -15.799], [-48.001, -15.799], [-48.001, -15.8]]);
  assert.throws(() => poligonoDoKml(kml, null, pontos), (e) => e.message === ERRO_KML_LONGE);
});

test("trocar pontos noutro fuso: os pontos vão para o fuso do projeto", () => {
  const ll = [-42.001, -12.5];
  const a = proj4(GEO_DEF, utmDef(23), ll), b = proj4(GEO_DEF, utmDef(24), ll);
  const [p] = pontosParaFuso([{ nome: "1", e: a[0], n: a[1], z: 10 }], 23, 24);
  assert.ok(Math.abs(p.e - b[0]) < 0.01 && Math.abs(p.n - b[1]) < 0.01);
  assert.equal(p.z, 10);
});

// ---------------------------------------------------------------- gravação
function storageFalso(limiteBytes = Infinity) {
  const m = new Map();
  const usado = () => [...m.values()].reduce((s, v) => s + v.length, 0);
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const antes = m.get(k)?.length ?? 0;
      if (usado() - antes + String(v).length > limiteBytes) throw new Error("QuotaExceededError");
      m.set(k, String(v));
    },
    removeItem: (k) => { m.delete(k); },
    _m: m,
  };
}

/** cliente falso do Supabase: tabela em memória, com atraso por chamada para testar a fila */
function clienteFalso({ atrasos = [] } = {}) {
  const linhas = new Map();
  const ordemChegada = [];
  let n = 0;
  const espera = () => new Promise((ok) => setTimeout(ok, atrasos[n++] ?? 0));
  const tabela = {
    select() {
      return {
        order: () => ({ limit: async () => ({ data: [...linhas.values()].map((l) => ({ id: l.id, nome: l.nome, updated_at: l.updated_at, resumo: l.resumo })), error: null }) }),
        eq: (_c, id) => ({ maybeSingle: async () => ({ data: linhas.has(id) ? { projeto: linhas.get(id).projeto, updated_at: linhas.get(id).updated_at } : null, error: null }) }),
      };
    },
    async upsert(l) { await espera(); ordemChegada.push(l.projeto.atualizadoEm); linhas.set(l.id, l); return { error: null }; },
    delete() { return { eq: async (_c, id) => { linhas.delete(id); return { error: null }; } }; },
  };
  return { cliente: { from: () => tabela }, linhas, ordemChegada };
}

const resumo = (p) => ({ id: p.id, nome: p.nome, atualizadoEm: p.atualizadoEm, nPontos: p.pontos.length, corte: 1, aterro: 1, cota: 100 });
const versao = (p, iso) => ({ ...p, atualizadoEm: iso });
const pts3 = [{ nome: "1", e: 500000, n: 8600000, z: 1 }, { nome: "2", e: 500010, n: 8600000, z: 2 }, { nome: "3", e: 500000, n: 8600010, z: 3 }];

test("gravação: apagado em outro aparelho some deste; o que nunca foi para a conta fica", async () => {
  globalThis.localStorage = storageFalso();
  const { criarArmazenamentoConta, armazenamentoLocal } = await import("../src/lib/terraplanagem/persistencia.ts");
  const { cliente, linhas } = clienteFalso();
  const conta = criarArmazenamentoConta(async () => cliente);
  const a = versao(projetoNovo("A", pts3, { tipo: "arquivo", arquivo: "a.txt" }), "2026-11-06T10:00:00.000Z");
  const b = versao(projetoNovo("B", pts3, { tipo: "arquivo", arquivo: "b.txt" }), "2026-11-06T10:01:00.000Z");
  assert.equal((await conta.salvar(a, resumo(a))).naConta, true);
  // B foi feito sem rede: só no aparelho
  await armazenamentoLocal.salvar(b, resumo(b));
  // outro aparelho apaga A na conta
  linhas.delete(a.id);
  const l = await conta.listar();
  assert.deepEqual(l.itens.map((x) => x.nome), ["B"]);
  assert.equal(await conta.carregar(a.id), null);
  // e A não volta na lista do aparelho
  assert.deepEqual((await armazenamentoLocal.listar()).itens.map((x) => x.nome), ["B"]);
});

test("gravação: abrir um projeto apagado em outro aparelho devolve null (a tela avisa)", async () => {
  globalThis.localStorage = storageFalso();
  const { criarArmazenamentoConta } = await import("../src/lib/terraplanagem/persistencia.ts");
  const { cliente, linhas } = clienteFalso();
  const conta = criarArmazenamentoConta(async () => cliente);
  const a = versao(projetoNovo("A", pts3, { tipo: "arquivo", arquivo: "a.txt" }), "2026-11-06T10:00:00.000Z");
  await conta.salvar(a, resumo(a));
  linhas.delete(a.id);
  assert.equal(await conta.carregar(a.id), null);
});

test("gravação: mudança feita aqui depois da sincronia não é apagada (volta para a conta)", async () => {
  globalThis.localStorage = storageFalso();
  const { criarArmazenamentoConta, armazenamentoLocal } = await import("../src/lib/terraplanagem/persistencia.ts");
  const { cliente, linhas } = clienteFalso();
  const conta = criarArmazenamentoConta(async () => cliente);
  const a = versao(projetoNovo("A", pts3, { tipo: "arquivo", arquivo: "a.txt" }), "2026-11-06T10:00:00.000Z");
  await conta.salvar(a, resumo(a));
  const a2 = versao({ ...a, nome: "A editado sem rede" }, "2026-11-06T11:00:00.000Z");
  await armazenamentoLocal.salvar(a2, resumo(a2));
  linhas.delete(a.id);
  assert.deepEqual((await conta.listar()).itens.map((x) => x.nome), ["A editado sem rede"]);
  assert.equal((await conta.carregar(a.id))?.nome, "A editado sem rede");
});

test("gravação: navegador cheio despeja só o que já está na conta; o que só existe aqui nunca", async () => {
  // cabe uns 3 projetos (de 200 pontos cada)
  const pts200 = Array.from({ length: 200 }, (_, i) => ({ nome: String(i + 1), e: 500000 + i, n: 8600000 + (i % 7), z: 100 + i * 0.01 }));
  const { criarArmazenamentoConta, armazenamentoLocal, tamanhoGravado } = await import("../src/lib/terraplanagem/persistencia.ts");
  const um = tamanhoGravado(projetoNovo("só aqui 1", pts200, { tipo: "arquivo", arquivo: "x.txt" }));
  globalThis.localStorage = storageFalso(um * 3 + 1500);
  const { cliente } = clienteFalso();
  const conta = criarArmazenamentoConta(async () => cliente);
  const naConta = versao(projetoNovo("na conta", pts200, { tipo: "arquivo", arquivo: "a.txt" }), "2026-11-06T09:00:00.000Z");
  await conta.salvar(naConta, resumo(naConta));
  const so1 = versao(projetoNovo("só aqui 1", pts200, { tipo: "arquivo", arquivo: "b.txt" }), "2026-11-06T09:10:00.000Z");
  const so2 = versao(projetoNovo("só aqui 2", pts200, { tipo: "arquivo", arquivo: "c.txt" }), "2026-11-06T09:20:00.000Z");
  assert.equal((await armazenamentoLocal.salvar(so1, resumo(so1))).noAparelho, true);
  assert.equal((await armazenamentoLocal.salvar(so2, resumo(so2))).noAparelho, true);
  // o quarto não cabe: sai o que já está na conta
  const novo = versao(projetoNovo("novo", pts200, { tipo: "arquivo", arquivo: "d.txt" }), "2026-11-06T09:30:00.000Z");
  const g = await armazenamentoLocal.salvar(novo, resumo(novo));
  assert.equal(g.noAparelho, true);
  const nomes = (await armazenamentoLocal.listar()).itens.map((x) => x.nome).sort();
  assert.deepEqual(nomes, ["novo", "só aqui 1", "só aqui 2"]);
  // o quinto não cabe e só sobram os que não estão na conta: nada é apagado, vem o motivo
  const mais = versao(projetoNovo("mais um", pts200, { tipo: "arquivo", arquivo: "e.txt" }), "2026-11-06T09:40:00.000Z");
  const g2 = await armazenamentoLocal.salvar(mais, resumo(mais));
  assert.equal(g2.noAparelho, false);
  assert.match(g2.motivo, /navegador está cheio/);
  assert.deepEqual((await armazenamentoLocal.listar()).itens.map((x) => x.nome).sort(), ["novo", "só aqui 1", "só aqui 2"]);
  assert.ok(await armazenamentoLocal.carregar(so1.id), "o projeto que só existe aqui continua inteiro");
});

test("gravação: na conta vai uma de cada vez e a última versão vence (rede lenta)", async () => {
  globalThis.localStorage = storageFalso();
  const { criarArmazenamentoConta } = await import("../src/lib/terraplanagem/persistencia.ts");
  // a primeira gravação demora 80 ms, a segunda 0 — sem fila, a velha chegaria por último
  const { cliente, linhas, ordemChegada } = clienteFalso({ atrasos: [80, 0, 0] });
  const conta = criarArmazenamentoConta(async () => cliente);
  const p = projetoNovo("A", pts3, { tipo: "arquivo", arquivo: "a.txt" });
  const v1 = versao(p, "2026-11-06T10:00:00.000Z"), v2 = versao({ ...p, nome: "A2" }, "2026-11-06T10:00:01.000Z"), v3 = versao({ ...p, nome: "A3" }, "2026-11-06T10:00:02.000Z");
  const primeira = conta.salvar(v1, resumo(v1));
  await new Promise((ok) => setTimeout(ok, 15)); // a v1 está no ar
  const g = await Promise.all([primeira, conta.salvar(v2, resumo(v2)), conta.salvar(v3, resumo(v3))]);
  assert.ok(g.every((x) => x.naConta));
  assert.equal(linhas.get(p.id).nome, "A3");
  // a v1 foi; a v2 nem saiu (a v3 já estava na fila quando chegou a vez)
  assert.deepEqual(ordemChegada, [v1.atualizadoEm, v3.atualizadoEm]);
});
