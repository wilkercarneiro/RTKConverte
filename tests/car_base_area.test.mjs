// Em que área o CAR fala (ProjetoCar.baseArea): o agrimensor escolhe entre a
// UTM (a do SIGEF, do Campo e da Consulta) e a de projeção de área igual.
//  • na base UTM, a área total é a do motor único, igual à que as ferramentas mostram;
//  • as porcentagens e o desenho da reserva não mudam com a base;
//  • a meta da vegetação cedida é cumprida na base escolhida;
//  • serviço antigo (sem baseArea) continua na área igual, sem mudar de número.
import { test } from "node:test";
import assert from "node:assert/strict";
import { medir } from "../src/lib/consulta/geometria.ts";
import { ajustarVegetacao, areasDasBases, calcularCar, normalizarProjetoCar, projetoNovo, reservaPorLado, vegetacaoPorLado } from "../src/lib/car/motor.ts";
import { camadasDoCar } from "../src/lib/exportar/car.ts";

// ~144 ha no oeste da Bahia, longe do meridiano central (a diferença entre as bases aparece)
const anel = [[-45.20, -12.10], [-45.188, -12.10], [-45.188, -12.11], [-45.20, -12.11]];

test("base UTM: a área total é a do motor único; a de área igual continua a de sempre", () => {
  const albers = calcularCar(projetoNovo("I", anel)).area.imovel;
  const utm = calcularCar({ ...projetoNovo("I", anel), baseArea: "utm" }).area.imovel;
  assert.ok(Math.abs(utm - medir([anel]).areaM2) < 1e-6, "UTM ≠ motor único");
  const b = areasDasBases(anel);
  assert.ok(Math.abs(b.utm - utm) < 1e-6 && Math.abs(b.albers - albers) < 1e-6);
  assert.ok(Math.abs(utm - albers) > 1, `as bases deviam diferir aqui (${utm} × ${albers})`);
});

test("trocar a base não muda o desenho nem a porcentagem da reserva", () => {
  const pr = projetoNovo("I", anel);
  pr.reserva.poligonos = reservaPorLado(pr, 0, 0);
  const a = calcularCar(pr);
  const u = calcularCar({ ...pr, baseArea: "utm" });
  assert.ok(a.reservaOk && u.reservaOk);
  assert.ok(Math.abs(a.pctReserva - u.pctReserva) < 1e-9);
  // a reserva gerada na base UTM é a mesma geometria
  const pu = { ...pr, baseArea: "utm" };
  const ru = reservaPorLado(pu, 0, 0);
  assert.deepEqual(ru, pr.reserva.poligonos);
  // o resíduo do recorte (~0,05 m² em 144 ha) é o mesmo nas duas bases: o fator não cria erro
  const resto = (r) => r.area.reserva + r.area.produtiva - r.area.imovel;
  assert.ok(Math.abs(resto(u)) < 0.2 && Math.abs(resto(u) - resto(a) * u.fatorArea) < 1e-3);
});

test("a meta da vegetação cedida é cumprida na base escolhida", () => {
  for (const baseArea of ["utm", "albers"]) {
    const pr = { ...projetoNovo("I", anel), baseArea };
    pr.reserva.poligonos = reservaPorLado(pr, 0, 0);
    pr.vegetacao.alvoHa = 10;
    pr.vegetacao.poligonos = vegetacaoPorLado(pr, 2, 0);
    let r = calcularCar(pr);
    assert.ok(r.vegetacaoOk && r.area.vegetacao < 10e4 + 5, `${baseArea}: ${r.area.vegetacao} m²`);
    pr.vegetacao.alvoHa = 12;
    pr.vegetacao.poligonos = ajustarVegetacao(pr);
    r = calcularCar(pr);
    assert.ok(r.vegetacaoOk && r.area.vegetacao < 12e4 + 5, `${baseArea} ajustada: ${r.area.vegetacao} m²`);
  }
});

test("shapefile: a área de cada camada sai na base escolhida", () => {
  const pr = { ...projetoNovo("I", anel), baseArea: "utm" };
  pr.reserva.poligonos = reservaPorLado(pr, 0, 0);
  const r = calcularCar(pr);
  const cam = Object.fromEntries(camadasDoCar(pr, r).map((c) => [c.nome, c]));
  const soma = (n) => (cam[n]?.feicoes ?? []).reduce((s, f) => s + (f.props?.area_ha ?? 0), 0);
  const imovel = soma(Object.keys(cam).find((n) => /IMOVEL/.test(n)));
  const reserva = soma(Object.keys(cam).find((n) => /RESERVA/.test(n)));
  assert.ok(Math.abs(imovel - r.area.imovel / 1e4) < 1e-4);
  assert.ok(Math.abs(reserva - r.area.reserva / 1e4) < 2e-4, `${reserva} × ${r.area.reserva / 1e4}`);
});

test("serviço antigo sem baseArea fica na área igual; a escolha gravada sobrevive ao banco", () => {
  const base = projetoNovo("I", anel);
  assert.equal(normalizarProjetoCar({ ...base }, base).baseArea, undefined);
  assert.equal(normalizarProjetoCar({ ...base, baseArea: "utm" }, base).baseArea, "utm");
  assert.equal(normalizarProjetoCar({ ...base, baseArea: "xyz" }, base).baseArea, undefined);
});
