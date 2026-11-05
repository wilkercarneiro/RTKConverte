// Camadas do serviço GEO (completo, conferência, partilha/glebas — tudo que não
// é CAR nem loteamento), a partir das linhas de `vertices` e `glebas` do banco.
//
//   PERIMETRO — o anel do imóvel, o que o memorial geral descreve:
//                 sem glebas, a sequência dos vértices;
//                 com PARTES (anéis disjuntos, o TXT em blocos), cada parte;
//                 com GLEBAS (divisa comum), o anel EXTERNO — as arestas que só
//                 uma gleba tem (a regra de anelExternoDasGlebas); se ele não
//                 fecha num anel só, cada gleba, como o memorial faz.
//   GLEBAS / PARTES — um polígono por gleba, pela MESMA regra da tela
//                 (glebas.ts): as glebas mandam no desenho.
//   VERTICES  — um ponto por vértice, com o código definitivo (ou o número do
//               TXT, enquanto não há código). Vértice fora de gleba fica fora,
//               como fica fora dos documentos.
//
// Coordenadas: as CANÔNICAS do memorial e da planilha (_shared/geo.ts,
// calcularVertices) — o GMS arredondado a 0,001" e o E/N reprojetado dele, com
// o GMS mandando no vértice inserido à mão, como em gerar-documentos. Assim o
// DXF bate com a planilha ao milímetro. Cada anel sai na ordem do memorial:
// sentido horário, começando no vértice mais ao norte (montarServico).
//
// Confrontação (ARQUITETURA-TRECHOS.md): cada M abre um trecho que vai até o
// próximo M na sequência do levantamento. Ela é do LADO físico, então vale em
// qualquer sentido em que o anel seja percorrido; lado que não é vizinho na
// sequência (divisa interna, salto do levantamento gleba por gleba) fica sem.
import proj4mod from "proj4";
import {
  calcularAreaHa, calcularPerimetroM, calcularSegmentos, calcularVertices, ehCodigoDeConferencia,
  ehSentidoHorario, ordemMaisAoNorte, parseGmsPlanilha, rotacionarRing,
} from "../../../supabase/functions/_shared/geo.ts";
import type { Proj4 } from "../../../supabase/functions/_shared/geo.ts";
import { glebasCobremTodos, ordensDasGlebas, partesDasGlebas } from "../glebas.ts";
import type { PontoAnel } from "../glebas.ts";
import type { Vertice } from "../types.ts";
import type { Camada, Feicao, XY } from "./tipos.ts";

const proj4: Proj4 = (de, para, c) => (proj4mod as unknown as Proj4)(de, para, c);

/** O que a montagem lê de cada linha de `vertices` (o resto da linha é ignorado). */
export type VerticeArea = Pick<Vertice, "ordem" | "num_txt" | "e" | "n" | "tipo" | "codigo">
  & Partial<Pick<Vertice, "h" | "codigo_provisorio" | "inserido_manual" | "lat_gms" | "lon_gms" | "descritivo" | "apelido_txt">>;

/** O que a montagem lê de cada linha de `glebas`. */
export interface GlebaArea { nome?: string | null; anel: PontoAnel[] }

export const COR_PERIMETRO = "#F5C542";
export const COR_GLEBAS = "#1E88E5";
export const COR_VERTICES = "#E53935";

interface Coordenada { ordem: number; utm: XY; geo: XY; latDeg: number; lonDeg: number }

const numero = (v: unknown): number | null => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Coordenada canônica do vértice (a do memorial); null quando ele não tem coordenada legível. */
function coordenadaCanonica(v: VerticeArea, fuso: number): Coordenada | null {
  const e = numero(v.e), n = numero(v.n);
  const gms = () => {
    try {
      return v.lat_gms?.trim() && v.lon_gms?.trim() ? { lat: parseGmsPlanilha(v.lat_gms), lon: parseGmsPlanilha(v.lon_gms) } : null;
    } catch { return null; }
  };
  // a regra de gerar-documentos: o GMS digitado manda no vértice inserido; o resto sai do E/N
  const g = v.inserido_manual || e === null || n === null ? gms() : null;
  if (!g && (e === null || n === null)) return null;
  try {
    const [c] = calcularVertices([{
      numTxt: v.num_txt ?? null,
      ...(g ? { latGms: g.lat, lonGms: g.lon } : { e: e!, n: n! }),
      h: numero(v.h) ?? 0, sigmaPos: 0, sigmaH: 0, inserido: !!v.inserido_manual,
    }], fuso, proj4);
    return { ordem: v.ordem, utm: [c.eProj, c.nProj], geo: [c.lonDeg, c.latDeg], latDeg: c.latDeg, lonDeg: c.lonDeg };
  } catch {
    return null; // fora dos limites do SIGEF: o documento também recusaria
  }
}

/** Código que já é o oficial: nem a prévia da conferência ("P-1") nem o provisório ("PROV-…"). */
export const codigoDefinitivo = (v: Pick<VerticeArea, "codigo" | "codigo_provisorio">): boolean =>
  !!v.codigo && !v.codigo_provisorio && !ehCodigoDeConferencia(v.codigo) && !v.codigo.startsWith("PROV-");

/** Nome do vértice: o código definitivo; senão o número do TXT; senão o código da prévia. */
export function nomeDoVertice(v: VerticeArea): string {
  if (codigoDefinitivo(v)) return v.codigo!;
  if (v.num_txt !== null && v.num_txt !== undefined) return String(v.num_txt);
  return v.codigo || `V${v.ordem + 1}`;
}

/** O nome do confrontante para o desenho: a 1ª linha do descritivo, sem a etiqueta "(MATR…)". */
export function textoConfrontante(v: Pick<VerticeArea, "descritivo" | "apelido_txt">): string | null {
  const primeira = String(v.descritivo || v.apelido_txt || "").split("\\").map((s) => s.trim()).find(Boolean) ?? "";
  return primeira.replace(/^\([^)]*\)\s*/, "").trim() || primeira || null;
}

const chaveLado = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Confrontante de cada lado do anel, na sequência dele: cada M abre o trecho até o próximo M (dando a volta). */
function confrontacao(ordens: number[], porOrdem: Map<number, VerticeArea>, destino = new Map<string, string>()): Map<string, string> {
  const ms = ordens.filter((o) => porOrdem.get(o)?.tipo === "M");
  if (!ms.length) return destino;
  let atual = textoConfrontante(porOrdem.get(ms[ms.length - 1])!);
  ordens.forEach((o, i) => {
    const v = porOrdem.get(o)!;
    if (v.tipo === "M") atual = textoConfrontante(v);
    if (atual) destino.set(chaveLado(o, ordens[(i + 1) % ordens.length]), atual);
  });
  return destino;
}

/**
 * O anel externo das glebas: as arestas que só UMA gleba tem, encadeadas (a
 * regra de anelExternoDasGlebas, por ordem de vértice). null quando elas não
 * fecham um anel simples (divisa interna que não coincide ponto a ponto, buraco).
 */
export function anelExterno(glebas: number[][]): number[] | null {
  const arestas = new Map<string, { a: number; b: number; n: number }>();
  for (const g of glebas) {
    g.forEach((a, i) => {
      const b = g[(i + 1) % g.length];
      if (a === b) return;
      const k = chaveLado(a, b);
      const x = arestas.get(k);
      if (x) x.n++; else arestas.set(k, { a, b, n: 1 });
    });
  }
  const externas = [...arestas.values()].filter((x) => x.n === 1);
  if (externas.length < 3) return null;
  const viz = new Map<number, number[]>();
  for (const { a, b } of externas) {
    viz.set(a, [...(viz.get(a) ?? []), b]);
    viz.set(b, [...(viz.get(b) ?? []), a]);
  }
  if ([...viz.values()].some((l) => l.length !== 2)) return null;
  const inicio = externas[0].a;
  const anel = [inicio];
  let ant = Number.NaN, atual = inicio;
  for (let passos = 0; passos < viz.size; passos++) {
    const [p, q] = viz.get(atual)!;
    const prox = p === ant ? q : p;
    if (prox === inicio) break;
    anel.push(prox);
    ant = atual; atual = prox;
  }
  return anel.length === viz.size ? anel : null;
}

/** Anel na ordem do memorial: horário, a partir do vértice mais ao norte (montarServico). */
function ordemDoMemorial(pts: Coordenada[]): Coordenada[] {
  const comPlano = pts.map((p) => ({ ...p, eProj: p.utm[0], nProj: p.utm[1] }));
  const inicial = ordemMaisAoNorte(comPlano);
  const sentido = ehSentidoHorario(comPlano) ? comPlano : [...comPlano].reverse();
  return rotacionarRing(sentido, inicial);
}

export interface OpcoesGeo {
  /** nome do polígono quando o imóvel é um anel só (a denominação) */
  nome?: string | null;
}

export function camadasDoGeo(vertices: VerticeArea[], glebas: GlebaArea[], fuso: number, op: OpcoesGeo = {}): Camada[] {
  const vs = [...vertices].sort((a, b) => a.ordem - b.ordem);
  const porOrdem = new Map(vs.map((v) => [v.ordem, v]));
  const coords = new Map<number, Coordenada>();
  for (const v of vs) {
    const c = coordenadaCanonica(v, fuso);
    if (c) coords.set(v.ordem, c);
  }
  const nomeImovel = String(op.nome ?? "").trim() || "PERÍMETRO";

  /** Polígono de uma lista de ordens, na ordem do memorial, com área, perímetro e confrontantes. */
  const poligono = (nome: string, ordens: number[], conf?: Map<string, string>): Feicao | null => {
    const pts = ordens.map((o) => coords.get(o)).filter((c): c is Coordenada => !!c);
    if (pts.length < 3) return null;
    const anel = ordemDoMemorial(pts);
    const plano = anel.map((p) => ({ ordem: p.ordem, eProj: p.utm[0], nProj: p.utm[1] }));
    return {
      nome, tipo: "poligono",
      utm: anel.map((p) => p.utm),
      geo: anel.map((p) => p.geo),
      alt: anel.map((p) => numero(porOrdem.get(p.ordem)?.h)),
      props: {
        area_ha: Number(calcularAreaHa(plano).toFixed(4)),
        perim_m: Number(calcularPerimetroM(calcularSegmentos(plano)).toFixed(2)),
        vertices: anel.length,
      },
      ...(conf ? { confrontantes: anel.map((p, i) => conf.get(chaveLado(p.ordem, anel[(i + 1) % anel.length].ordem)) ?? null) } : {}),
    };
  };

  // as glebas mandam no desenho (Conferencia.tsx): uma por anel, com o nome de cada
  const xy = vs.map((v) => ({ ordem: v.ordem, e: v.e, n: v.n }));
  const fechadas = (glebas ?? []).filter((g) => Array.isArray(g.anel) && g.anel.length >= 3);
  const porGleba = fechadas
    .map((g, i) => ({ nome: String(g.nome ?? "").trim() || `GLEBA ${i + 1}`, ordens: ordensDasGlebas([g], xy)[0] ?? [] }))
    .filter((g) => g.ordens.length >= 3);
  // anéis disjuntos = PARTES (o TXT em blocos); com vértice em comum = GLEBAS de um perímetro
  const emPartes = porGleba.length > 0 && partesDasGlebas(fechadas, xy) !== null;
  const sequencia = vs.map((v) => v.ordem);

  const perimetro: Feicao[] = [];
  const unidades: Feicao[] = [];
  if (!porGleba.length) {
    const f = poligono(nomeImovel, sequencia, confrontacao(sequencia, porOrdem));
    if (f) perimetro.push(f);
  } else if (emPartes) {
    // cada parte é um anel do levantamento: a confrontação dá a volta dentro dela
    const conf = new Map<string, string>();
    for (const p of porGleba) confrontacao(p.ordens, porOrdem, conf);
    for (const p of porGleba) {
      const f = poligono(p.nome, p.ordens, conf);
      if (f) { perimetro.push(f); unidades.push({ ...f, confrontantes: undefined }); }
    }
  } else {
    const conf = confrontacao(sequencia, porOrdem);
    const externo = anelExterno(porGleba.map((g) => g.ordens));
    const f = externo ? poligono(nomeImovel, externo, conf) : null;
    for (const g of porGleba) {
      const u = poligono(g.nome, g.ordens);
      if (!u) continue;
      unidades.push(u);
      if (!f) perimetro.push({ ...u, confrontantes: poligono(g.nome, g.ordens, conf)?.confrontantes });
    }
    if (f) perimetro.unshift(f);
  }

  // vértice fora de gleba fica fora dos documentos (Conferencia.tsx): fica fora daqui também
  const cobre = !porGleba.length || glebasCobremTodos(porGleba.map((g) => g.ordens), xy);
  const noDesenho = new Set(porGleba.flatMap((g) => g.ordens));
  const pontos: Feicao[] = vs
    .filter((v) => coords.has(v.ordem) && (cobre || noDesenho.has(v.ordem)))
    .map((v) => {
      const c = coords.get(v.ordem)!;
      return {
        nome: nomeDoVertice(v), tipo: "ponto", utm: [c.utm], geo: [c.geo], alt: [numero(v.h)],
        props: { tipo: v.tipo, codigo: v.codigo ?? null, num_txt: v.num_txt ?? null },
      };
    });

  return [
    { nome: "PERIMETRO", cor: COR_PERIMETRO, feicoes: perimetro, segmentos: true },
    ...(unidades.length ? [{ nome: emPartes ? "PARTES" : "GLEBAS", cor: COR_GLEBAS, feicoes: unidades, segmentos: true, rotulos: 1.5 }] : []),
    { nome: "VERTICES", cor: COR_VERTICES, feicoes: pontos, rotulos: 1 },
  ];
}

/** Os anéis lon/lat dos polígonos de uma camada. */
export const contornoDasCamadas = (camadas: Camada[], nome = "PERIMETRO"): XY[][] =>
  (camadas.find((c) => c.nome === nome)?.feicoes ?? [])
    .filter((f) => f.tipo === "poligono" && (f.geo?.length ?? 0) >= 3)
    .map((f) => f.geo!);

/**
 * O contorno que a função `entregar` confere (0039): com glebas, os anéis
 * delas (como a planta); sem, o perímetro.
 */
export function contornoDoGeo(camadas: Camada[]): XY[][] {
  const unidades = [...contornoDasCamadas(camadas, "GLEBAS"), ...contornoDasCamadas(camadas, "PARTES")];
  return unidades.length ? unidades : contornoDasCamadas(camadas, "PERIMETRO");
}
