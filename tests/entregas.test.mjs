// Entregas no servidor (auditoria 04/11/2026, itens 4 e 5): os arquivos do CAR
// e do loteamento saem da função `entregar`, que usa estes módulos, e toda
// geração confere o contorno do imóvel (0039, _shared/contorno.ts).
//
// O que se prova aqui: cada arquivo que a tela oferecia continua saindo, no
// formato certo, a partir só do projeto (o que o servidor lê do banco); e o
// contorno chega ao banco como um GeoJSON fechado.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { perimetro } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo as projetoLot } from "../src/lib/loteamento/modelo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { calcular } from "../src/lib/loteamento/calculo.ts";
import { arquivoDoLoteamento, SAIDAS_LOTEAMENTO } from "../src/lib/loteamento/entregas.ts";
import { lerKml } from "../src/lib/car/kml.ts";
import { ajustarReserva, projetoNovo as projetoCar } from "../src/lib/car/motor.ts";
import { arquivoDoCar, projetoCarDoBanco, SAIDAS_CAR } from "../src/lib/car/entregas.ts";
import { anelDoSigef, geojsonDosAneis, grauDoPdf } from "../supabase/functions/_shared/contorno.ts";

const inicio = (u8, n = 4) => new TextDecoder().decode(u8.slice(0, n));
const carimbo = {
  empresa: "EMPRESA TESTE", cnpj: "00.000.000/0001-00", desenhista: "", proprietario: "FULANO", cpfProprietario: "",
  imovel: "GLEBA TESTE", municipio: "Salvador", uf: "BA", matricula: "", rt: "RT TESTE", rtRegistro: "CREA: 1", trt: "", fuso: 24, logo: null,
};
const servico = { municipio: "Salvador", uf: "BA", detentor_nome: "FULANO", denominacao: "GLEBA TESTE", fuso_utm: 24 };

test("loteamento: todo arquivo da tela sai do módulo do servidor, no formato certo", async () => {
  const pr0 = projetoLot("TESTE", perimetro.pts.length);
  pr0.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
  const projeto = gerarPropostas(pr0, perimetro, { quantas: 1, estruturar: false })[0].projeto;
  // o servidor lê o projeto do banco: passa por JSON como a tabela `loteamentos`
  const doBanco = JSON.parse(JSON.stringify(projeto));
  const res = calcular(doBanco, perimetro);
  assert.ok(res.lotes.length > 0);
  const esperado = {
    planta: "%PDF", "infra-pranchas": "%PDF", memorial: "PK", memoriais: "PK", "infra-memorial": "PK", "infra-planilhas": "PK",
  };
  for (const saida of SAIDAS_LOTEAMENTO) {
    const a = await arquivoDoLoteamento({ saida, folha: "A3" }, doBanco, res, perimetro, servico, carimbo);
    assert.ok(a.dados.length > 100, `${saida}: arquivo vazio`);
    assert.ok(a.nome.includes("TESTE"), `${saida}: nome ${a.nome}`);
    if (esperado[saida]) assert.equal(inicio(a.dados, esperado[saida].length), esperado[saida], saida);
    if (saida === "kml") assert.match(new TextDecoder().decode(a.dados), /<kml/);
    if (saida === "dxf" || saida === "infra-dxf") assert.match(new TextDecoder().decode(a.dados), /SECTION/);
  }
  // locação nos formatos da coletora, com a estaca pedida
  const csv = await arquivoDoLoteamento({ saida: "locacao", formato: "csv-nome-e-n", op: { lotes: true, curvas: true, eixos: true, estaca: 20, perimetro: false } }, doBanco, res, perimetro, servico, carimbo);
  assert.match(csv.nome, /^LOCACAO_TESTE_SIRGAS2000_UTM24S\.csv$/);
  // formato desconhecido cai no padrão em vez de quebrar
  const dflt = await arquivoDoLoteamento({ saida: "locacao", formato: "inventado" }, doBanco, res, perimetro, servico, carimbo);
  assert.match(dflt.nome, /\.csv$/);
});

test("CAR: shapefiles do SICAR e KML saem do projeto gravado", async () => {
  const kml = lerKml(fs.readFileSync(new URL("./fixtures/car/PLANTA.kml", import.meta.url), "utf8"));
  const p = projetoCar("FAZENDA DEMO", kml.perimetro);
  p.reserva.poligonos = ajustarReserva(p);
  // como vem da tabela car_projetos
  const projeto = projetoCarDoBanco(JSON.parse(JSON.stringify(p)), "FAZENDA DEMO");
  const saiu = [];
  for (const saida of SAIDAS_CAR) {
    let a;
    try { a = await arquivoDoCar(saida, projeto, { municipio: "Salvador", uf: "BA", proprietario: "FULANO" }); }
    catch (e) { assert.match(String(e), /vazia|Não há vegetação/, saida); continue; } // camada sem polígono (sem rio, sem vegetação…)
    saiu.push(saida);
    assert.ok(a.dados.length > 100, saida);
    if (saida.startsWith("kml")) assert.match(new TextDecoder().decode(a.dados), /<kml/);
    else assert.equal(inicio(a.dados, 2), "PK", saida);
  }
  for (const s of ["imovel", "produtiva", "tudo", "kml"]) assert.ok(saiu.includes(s), `${s} não saiu`);
  await assert.rejects(arquivoDoCar("tudo", projetoCarDoBanco(null, "X"), {}), /perímetro/);
});

test("contorno: anéis viram MultiPolygon fechado; anel curto sai; grau do PDF do SIGEF", () => {
  const g = geojsonDosAneis([[[-38.5, -12.9], [-38.49, -12.9], [-38.49, -12.91]], [[0, 0], [1, 1]]]);
  assert.equal(g.type, "MultiPolygon");
  assert.equal(g.coordinates.length, 1);
  const anel = g.coordinates[0][0];
  assert.deepEqual(anel[0], anel[anel.length - 1]);
  assert.equal(geojsonDosAneis([[[0, 0], [1, 1]]]), null);
  assert.equal(geojsonDosAneis([[[NaN, 0], [1, 1], [2, 2]]]), null);
  assert.ok(Math.abs(grauDoPdf("-39°05'04,737\"") - -(39 + 5 / 60 + 4.737 / 3600)) < 1e-12);
  assert.ok(Number.isNaN(grauDoPdf("lixo")));
  assert.deepEqual(anelDoSigef([{ lon: "-39°00'00,000\"", lat: "-12°30'00,000\"" }]), [[-39, -12.5]]);
});
