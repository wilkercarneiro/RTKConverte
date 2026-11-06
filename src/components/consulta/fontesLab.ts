// As fontes do laboratório (#/lab/consulta): as respostas REAIS gravadas em
// Lençóis/BA (tests/fixtures/consulta/lencois.json, por gravar.mjs), tocadas
// pelo MESMO código de produção (car.ts, ambiente.ts, restricoes.ts…) com um
// fetch que responde do arquivo. Sem login e sem internet.
//
// Os CAR e as parcelas do SIGEF gravados formam o "universo" do laboratório:
// clicar em qualquer um deles no mapa acha o imóvel; fora deles, nada.
import fixtureBruta from "../../../tests/fixtures/consulta/lencois.json?raw";
import { consultarRestricoes, cruzarComImovel } from "../../lib/restricoes";
import type { FeatureParcela, Sobreposicao } from "../../lib/sigef";
import { carNaCaixa, carSobreAArea } from "../../lib/consulta/car.ts";
import { consultarBioma, consultarClima, consultarMunicipio, consultarSolo } from "../../lib/consulta/ambiente.ts";
import { classificarFocos } from "../../lib/consulta/focos.ts";
import type { Foco } from "../../lib/consulta/focos.ts";
import { caixaComMargem, fmtHa, fmtNum, pontoEmPoligonos } from "../../lib/consulta/geometria.ts";
import type { LonLat } from "../../lib/consulta/geometria.ts";
import { imovelDoSigef, sigefDaArea } from "../../lib/consulta/sigef_imovel.ts";
import { fraseDaAnalise } from "../../lib/consulta/analise.ts";
import type { Analise } from "../../lib/consulta/analise.ts";
import type { FontesConsulta, RegistroConsulta } from "../../lib/consulta/fontes.ts";
import type { ImovelEncontrado } from "../../lib/consulta/tipos.ts";
import { textoFocos } from "../../lib/consulta/focos.ts";

interface Fixture {
  agora: string;
  ponto: LonLat;
  respostas: Record<string, { status: number; corpo: string }>;
  focos: { todos: Foco[]; referencia: Foco[] };
  sigef: { type: "Feature"; id: string; properties: Record<string, unknown>; geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon }[];
}

export const FIXTURE = JSON.parse(fixtureBruta) as Fixture;
export const AGORA = new Date(FIXTURE.agora);

export type EstadoLab = "normal" | "carregando" | "analisando" | "fora" | "erro" | "semhistorico" | "historico-erro" | "cortada" | "ibge-instavel";

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nunca = <T>() => new Promise<T>(() => {});

/** A resposta gravada da URL; sem ela, a de mesmo host/caminho/camada (o laboratório é só Lençóis). */
function responder(url: string): Response {
  const exata = FIXTURE.respostas[url];
  if (exata) return new Response(exata.corpo, { status: exata.status });
  const u = new URL(url);
  const camada = u.searchParams.get("typeName") ?? u.searchParams.get("typenames") ?? "";
  const parecida = Object.entries(FIXTURE.respostas).find(([k]) => {
    const v = new URL(k);
    return v.host === u.host && v.pathname === u.pathname && (v.searchParams.get("typeName") ?? "") === camada && !/sicar/.test(k);
  });
  if (parecida) return new Response(parecida[1].corpo, { status: parecida[1].status });
  return new Response(JSON.stringify({ erro: "não gravado no laboratório" }), { status: 404 });
}
const replay: typeof fetch = async (u) => { await espera(120 + Math.random() * 500); return responder(String(u)); };
const pertoDaFixture = (lon: number, lat: number) => Math.abs(lon - FIXTURE.ponto[0]) < 0.3 && Math.abs(lat - FIXTURE.ponto[1]) < 0.3;

// o universo: os CAR da vizinhança gravada (o do ponto está entre eles) e as parcelas do SIGEF
let universoCar: Promise<ImovelEncontrado[]> | null = null;
function cars(): Promise<ImovelEncontrado[]> {
  if (!universoCar) {
    const chave = Object.keys(FIXTURE.respostas).filter((k) => k.includes("sicar_imoveis_ba")).sort((a, b) => FIXTURE.respostas[b].corpo.length - FIXTURE.respostas[a].corpo.length)[0];
    const bbox = new URL(chave).searchParams.get("bbox")!.split(",").slice(0, 4).map(Number) as [number, number, number, number];
    universoCar = carNaCaixa(bbox, "BA", { fetch: async () => responder(chave) }).then((r) => r.imoveis);
  }
  return universoCar;
}
const parcelas: FeatureParcela[] = FIXTURE.sigef.map((f, i) => ({
  type: "Feature", id: i + 1,
  properties: {
    codigo: String(f.properties.parcela_codigo), nome: (f.properties.nome_area as string) ?? null, uf: "BA", municipio: "Lençóis",
    situacao: f.properties.status ? String(f.properties.status).toLowerCase().replace(/^./, (c) => c.toUpperCase()) : null,
    area_ha: null, fonte: "incra", centro: [0, 0],
  },
  geometry: f.geometry,
}));
const imoveisSigef = parcelas.map(imovelDoSigef).filter((x): x is ImovelEncontrado => !!x);

/** O laudo do laboratório: montado dos dados (sem IA), no formato que a IA devolve. */
function laudoDeExemplo(a: Analise): string {
  const f = fraseDaAnalise(a);
  const im = a.imovel;
  const l: string[] = [];
  l.push("1. Identificação");
  l.push(`- ${im.titulo}: ${fmtHa(a.medidas.areaM2)} calculados pelo sistema [Vertces]${im.areaDeclaradaHa != null ? `; área declarada ${fmtNum(im.areaDeclaradaHa, 4)} ha [SICAR]` : ""}.`);
  if (a.municipio.estado === "ok" && a.municipio.dados) l.push(`- Município de ${a.municipio.dados.nome}/${a.municipio.dados.uf} [IBGE].`);
  l.push("2. Situação fundiária");
  if (im.situacao) l.push(`- ${im.fonte === "car" ? "CAR declarado pelo proprietário" : "Área"}, situação: ${im.situacao.toLowerCase()} [SICAR].`);
  for (const t of f.identificacao) l.push(`- ${t} [INCRA].`);
  if (a.car.estado === "ok") { const s = a.car.dados.itens.filter((x) => x.areaM2 > 0); l.push(s.length ? `- ${s.length} outro(s) CAR declarado(s) sobrepõe(m) a área, o maior em ${fmtHa(s[0].areaM2)} [SICAR].` : "- Nenhum outro CAR declarado sobrepõe a área [SICAR]."); }
  if (a.sigef.estado === "ok") l.push(a.sigef.dados.sobreposicoes.some((x) => !x.mesma_parcela) ? "- Há sobreposição com parcela certificada [SIGEF/INCRA]." : `- Nenhuma parcela certificada sobrepõe a área; ${a.sigef.dados.vizinhas.length} a até ${a.sigef.dados.raioM} m [SIGEF/INCRA].`);
  l.push("3. Restrições");
  for (const t of f.sobreposicoes) l.push(`- Sobrepõe ${t} [INCRA].`);
  if (!f.sobreposicoes.length) l.push("- Nenhuma sobreposição nas bases de restrição consultadas [FUNAI, MMA/CNUC, INCRA, IBAMA, ICMBio, IBGE, IPHAN].");
  for (const t of f.pendentes) l.push(`- Pendência: ${t}; consultar de novo.`);
  l.push("4. Ambiente");
  if (a.bioma.estado === "ok") l.push(`- Bioma ${a.bioma.dados.bioma}. ${a.bioma.dados.reservaLegal} [IBGE]`);
  if (a.solo.estado === "ok") l.push(`- Solo provável: ${a.solo.dados.nome}, estimativa de modelo [SoilGrids].`);
  if (a.clima.estado === "ok") l.push(`- Chuva de ${fmtNum(a.clima.dados.chuva12mMm, 0)} mm em 12 meses [Open-Meteo].`);
  if (a.focos.estado === "ok") l.push(`- ${textoFocos(a.focos.dados)} [INPE].`);
  l.push("5. Conclusão e próximos passos");
  l.push("- Conferir em campo as divisas onde há sobreposição com outros CAR e com o assentamento vizinho.");
  l.push("- Pedir ao cliente o recibo do CAR e a documentação do assentamento (INCRA).");
  l.push("- Refazer a consulta antes de protocolar, para as bases que não responderam.");
  return `(Exemplo do laboratório: texto montado com os dados, sem IA.)\n\n${l.join("\n")}`;
}

export function fontesDoLaboratorio(estado: EstadoLab): FontesConsulta {
  const fora = estado === "fora";
  const travar = estado === "carregando";
  const analisando = estado === "analisando";
  // região em queimada / muito CAR: o INPE e o SICAR respondem, mas cortados (nunca vira "nenhum foco" verde)
  const cortada = estado === "cortada";
  // o IBGE falha na primeira vez e responde depois (o "tentar de novo" do Município tem de funcionar,
  // e o SIGEF que rodou sem a UF é refeito com ela)
  let ibgeFalhas = estado === "ibge-instavel" ? 1 : 0;
  const foraDoAr = async () => { await espera(900); throw new Error("servidor fora do ar ou inacessível"); };
  const registros: RegistroConsulta[] = [];
  let seq = 0;
  return {
    async carPorCodigo(codigo) {
      if (travar) return nunca();
      if (estado === "erro" || fora) return foraDoAr();
      await espera(500);
      return (await cars()).filter((x) => x.codigo === codigo);
    },
    async carNoPonto(lon, lat) {
      if (travar) return nunca();
      if (fora) return foraDoAr();
      await espera(600);
      return (await cars()).filter((x) => pontoEmPoligonos([lon, lat], x.poligonos));
    },
    async carNaArea(aneis, _uf, proprio) {
      if (analisando) return nunca();
      if (fora) return foraDoAr();
      await espera(700);
      const todos = await cars();
      const cx = caixaComMargem(aneis, 100);
      const naCaixa = todos.filter((x) => x.aneis.flat().some((p) => p[0] >= cx[0] && p[0] <= cx[2] && p[1] >= cx[1] && p[1] <= cx[3]));
      return { itens: carSobreAArea(aneis, naCaixa, proprio), cortada, ...(cortada ? { falhas: ["CAR de MG (SICAR) não respondeu"] } : {}) };
    },
    async sigefPorCodigo(codigo) {
      if (travar) return nunca();
      await espera(400);
      return imoveisSigef.find((x) => x.codigo === codigo) ?? null;
    },
    async sigefNoPonto(lon, lat) {
      if (travar) return nunca();
      await espera(800);
      return { imoveis: imoveisSigef.filter((x) => pontoEmPoligonos([lon, lat], x.poligonos)), online: "ok" };
    },
    async sigefNaArea(aneis, _uf, proprio) {
      if (analisando) return nunca();
      await espera(1100);
      // o que o PostGIS faria (sigef_consultar): interseção com cada parcela a até 500 m
      const sobre: Sobreposicao[] = [];
      for (const p of parcelas) {
        const im = imovelDoSigef(p);
        if (!im) continue;
        const c = cruzarComImovel(aneis, im.poligonos);
        if (c.areaM2 > 0) sobre.push({ codigo: p.properties.codigo, nome: p.properties.nome, municipio: "Lençóis", uf: "BA", situacao: p.properties.situacao, area_ha: null, area_m2: c.areaM2, percentual_imovel: c.pct, geometria: c.sobreposta!, mesma_parcela: c.pct > 98 && p.properties.codigo === proprio });
      }
      return { ...sigefDaArea(aneis, parcelas, sobre, proprio), online: estado === "ibge-instavel" && !_uf ? "sem-uf" : "ok" };
    },
    async municipio(lon, lat) {
      if (travar) return nunca();
      if (ibgeFalhas > 0) { ibgeFalhas--; await espera(600); throw new Error("o IBGE não respondeu (exemplo do laboratório)"); }
      if (!pertoDaFixture(lon, lat)) throw new Error("ponto fora da área gravada no laboratório");
      return consultarMunicipio(lon, lat, { fetch: replay });
    },
    async restricoes(aneis, fuso) {
      if (analisando) return nunca();
      return consultarRestricoes(aneis, { fuso, fetch: replay, agora: AGORA });
    },
    async clima(lon, lat) { if (analisando) return nunca(); return consultarClima(lon, lat, { fetch: replay, agora: AGORA }); },
    async solo(lon, lat) {
      if (analisando) return nunca();
      // em 06/11/2026 o SoilGrids estava mesmo fora do ar (503): é o caso "fonte fora do ar"
      if (fora) { await espera(1500); throw new Error("SoilGrids respondeu 503"); }
      return consultarSolo(lon, lat, { fetch: replay });
    },
    async bioma(lon, lat) { if (analisando) return nunca(); return consultarBioma(lon, lat, { fetch: replay }); },
    async focos(aneis) {
      if (analisando) return nunca();
      if (fora) { await espera(1200); throw new Error("o INPE não respondeu a tempo"); }
      await espera(900);
      return classificarFocos({ ...FIXTURE.focos, cortada }, aneis, new Date(AGORA.getTime() - 365 * 864e5).toISOString().slice(0, 10));
    },
    async laudo(id) {
      await espera(1800);
      const r = registros.find((x) => x.id === id);
      if (!r?.resultado) throw new Error("Consulta não encontrada.");
      const laudo = { texto: laudoDeExemplo(r.resultado), modelo: "exemplo do laboratório", quando: new Date().toISOString() };
      r.laudo = laudo;
      return laudo;
    },
    historico: {
      async listar() {
        await espera(350);
        if (estado === "historico-erro") throw new Error("o banco não respondeu (exemplo do laboratório)");
        return estado === "semhistorico" ? [] : [...registros];
      },
      async gravar(r, id) {
        const novoId = id ?? `lab-${++seq}`;
        const i = registros.findIndex((x) => x.id === novoId);
        const reg: RegistroConsulta = { ...r, id: novoId, criado: i >= 0 ? registros[i].criado : new Date().toISOString(), laudo: i >= 0 ? registros[i].laudo : null };
        if (i >= 0) registros[i] = reg; else registros.unshift(reg);
        return novoId;
      },
      async apagar(id) { const i = registros.findIndex((x) => x.id === id); if (i >= 0) registros.splice(i, 1); },
    },
  };
}
