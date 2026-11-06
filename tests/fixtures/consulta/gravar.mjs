// Grava a fixture da Consultar imóvel (tests/fixtures/consulta/lencois.json):
// as respostas REAIS das bases públicas para o ponto de Lençóis/BA (-12,40 /
// -41,20), usadas pelo laboratório (#/lab/consulta) e pelos testes, sem rede.
//
//   node tests/fixtures/consulta/gravar.mjs
//
// Grava: o CAR que contém o ponto (SICAR), o município (IBGE), e para a área
// desse CAR: restrições (as 9 bases), CAR vizinhos, clima, solo, bioma,
// Amazônia Legal, focos do INPE (as camadas que a função analise-imovel lê) e
// as parcelas do SIGEF em volta (Geoportal do INCRA).
import fs from "node:fs";
import { carNaCaixa, carNoPonto } from "../../../src/lib/consulta/car.ts";
import { consultarBioma, consultarClima, consultarMunicipio, consultarSolo } from "../../../src/lib/consulta/ambiente.ts";
import { consultarRestricoes } from "../../../src/lib/restricoes.ts";
import { buscarFocos } from "../../../supabase/functions/analise-imovel/logica.ts";
import { pedidoFocos } from "../../../src/lib/consulta/focos.ts";
import { caixaComMargem, centroDe, fusoDaArea } from "../../../src/lib/consulta/geometria.ts";

const AGORA = new Date(process.env.AGORA ?? "2026-11-06T12:00:00Z");
const PONTO = [-41.2, -12.4];
const respostas = {};
const gravar = async (url, init) => {
  const r = await fetch(url, init);
  const corpo = await r.text();
  respostas[String(url)] = { status: r.status, corpo };
  return new Response(corpo, { status: r.status, headers: { "content-type": r.headers.get("content-type") ?? "application/json" } });
};

const car = await carNoPonto(PONTO[0], PONTO[1], "BA", { fetch: gravar });
if (!car.length) throw new Error("nenhum CAR no ponto");
const area = car[0];
console.log("CAR:", area.codigo, area.areaDeclaradaHa, "ha");
const mun = await consultarMunicipio(PONTO[0], PONTO[1], { fetch: gravar });
console.log("município:", mun?.nome);
const fuso = fusoDaArea(area.aneis);
const centro = centroDe(area.aneis);
const lidos = await Promise.allSettled([
  consultarRestricoes(area.aneis, { fuso, fetch: gravar, agora: AGORA }),
  consultarClima(centro[0], centro[1], { fetch: gravar, agora: AGORA }),
  consultarSolo(centro[0], centro[1], { fetch: gravar }),
  consultarBioma(centro[0], centro[1], { fetch: gravar }),
  carNaCaixa(caixaComMargem(area.aneis, 100), "BA", { fetch: gravar }),
  consultarMunicipio(centro[0], centro[1], { fetch: gravar }),
]);
for (const [i, x] of lidos.entries()) if (x.status === "rejected") console.log("FALHOU", ["restrições", "clima", "solo", "bioma", "vizinhos", "município do centro"][i], x.reason?.message);
const [restr, clima, solo, bioma, viz, munC] = lidos.map((x) => (x.status === "fulfilled" ? x.value : null));
// SoilGrids fora do ar (503/tempo esgotado): vale a resposta real anterior, se houver (SOLO_JSON='{...}')
if (!solo && process.env.SOLO_JSON) respostas[`https://rest.isric.org/soilgrids/v2.0/classification/query?lon=${centro[0].toFixed(5)}&lat=${centro[1].toFixed(5)}&number_classes=3`] = { status: 200, corpo: process.env.SOLO_JSON, nota: process.env.SOLO_NOTA ?? null };
console.log("restrições:", restr?.fontes.map((f) => `${f.tipo}:${f.classe}`).join(" "));
console.log("clima:", clima?.chuva12mMm, "mm; solo:", solo?.wrb, "; bioma:", bioma?.bioma, bioma?.amazoniaLegal, "; vizinhos:", viz?.imoveis.length, "; mun centro:", munC?.nome);

// focos: o que a função analise-imovel devolveria
const pf = pedidoFocos(area.aneis, AGORA);
const focos = await buscarFocos(pf.caixa, pf.desde, fetch, AGORA);
console.log("focos:", focos.todos.length, "todos;", focos.referencia.length, "referência");

// SIGEF: as parcelas do Geoportal em volta (o que a base do sistema teria)
const cx = caixaComMargem(area.aneis, 300);
const q = new URLSearchParams({ service: "WFS", version: "1.0.0", request: "GetFeature", typename: "geonode:sigef_geo", outputFormat: "application/json", bbox: cx.map((v) => v.toFixed(8)).join(","), maxFeatures: "300" });
let sigef = [];
try {
  const r = await fetch(`https://geoportal.incra.gov.br/geoserver/ows?${q}`, { signal: AbortSignal.timeout(40000) });
  const j = await r.json();
  sigef = (j.features ?? []).map((f) => ({ type: "Feature", id: f.id, properties: f.properties, geometry: f.geometry }));
} catch (e) { console.log("SIGEF não respondeu:", e.message); }
console.log("SIGEF:", sigef.length, "parcelas");

const saida = new URL("./lencois.json", import.meta.url);
fs.writeFileSync(saida, JSON.stringify({ gravado_em: new Date().toISOString(), agora: AGORA.toISOString(), ponto: PONTO, respostas, focos, sigef }));
console.log("gravado:", saida.pathname, Math.round(fs.statSync(saida).size / 1024), "KB");
