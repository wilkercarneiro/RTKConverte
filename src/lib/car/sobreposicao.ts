// Sobreposição do CAR com os imóveis vizinhos — e o ajuste automático.
//
// O SICAR (e o SEIA/CEFIR na Bahia) acusa quando o imóvel declarado invade
// outro CAR já inscrito ou uma parcela certificada do SIGEF. O serviço do CAR
// só cruzava o perímetro com as bases de restrição (TI, UC, embargo…) e por
// isso "não acusou" o que o SEIA e a Consulta acusaram (12/11/2026).
//
// Aqui o perímetro é cruzado com os vizinhos (CAR do SICAR + parcelas do
// SIGEF) e, quando invade algum, sai um perímetro NOVO sem a parte do vizinho:
//
//   novo = imóvel − (vizinhos que invade, alargados de FOLGA_M)
//
// A folga (10 cm) garante que o SICAR, que mede em grau e em outra precisão,
// não leia a divisa comum como sobreposição. Depois do corte:
//   - fica o maior pedaço (o resto são lascas soltas pelo corte, informadas);
//   - vértice NOVO a menos de 1 m do vizinho de anel sai (SICAR 3001), desde
//     que tirar não devolva área ao vizinho (os do levantamento não saem);
//   - os vértices originais voltam EXATOS (paraGeo com âncoras).
//
// O que NÃO é cortado sozinho (vai como aviso):
//   - "proprio": o vizinho e o imóvel são quase o mesmo polígono (≥ 80% de um
//     no outro, dos dois lados) — é o CAR deste imóvel já inscrito (retificação)
//     ou a certificação dele no SIGEF;
//   - "grande": cortar levaria mais da metade do imóvel (provável matrícula-mãe
//     ou desenho errado: decisão de gente);
//   - "dentro": o vizinho está inteiro dentro do imóvel (o corte faria um furo,
//     e o imóvel do CAR é um anel só);
//   - "inativo": CAR Cancelado ou Suspenso (ou parcela cancelada) — não tira
//     terreno do cliente sozinho; fica para a pessoa conferir (13/11/2026).
import { antiHorario, areaPol, areaPols, centroide, dentroAnel, diferenca, dist, intersecao, offsetPols, tirarBicos, uniao } from "../loteamento/geom.ts";
import type { Anel, Poligono } from "../loteamento/geom.ts";
import { paraGeo, planoDe, uniaoDasGlebas } from "./motor.ts";
import type { PlanoCar } from "./motor.ts";
import type { LonLat } from "./kml.ts";
import type { PoligonoGeo } from "./shapefile.ts";

/** Um imóvel vizinho: um CAR do SICAR ou uma parcela do SIGEF, em grau. */
export interface VizinhoCar {
  fonte: "car" | "sigef";
  codigo: string;
  /** "CAR BA-2908408-…" / "SIGEF Fazenda Tal" */
  rotulo: string;
  situacao?: string | null;
  /** polígonos [anel externo, ...furos], abertos ou fechados */
  poligonos: LonLat[][][];
}

export type DecisaoSobreposicao = "cortado" | "proprio" | "grande" | "dentro" | "ignorado" | "inativo";

/** Situação que não vale como vizinho para o corte automático (CAR Cancelado/Suspenso, parcela cancelada). */
export function situacaoInativa(situacao: string | null | undefined): boolean {
  const s = (situacao ?? "").normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();
  return /^(cancelad|suspens|inativ)/.test(s);
}

export interface ItemSobreposicao {
  fonte: VizinhoCar["fonte"];
  codigo: string;
  rotulo: string;
  situacao: string | null;
  /** área do imóvel dentro do vizinho (m², plano de área igual) */
  areaM2: number;
  /** % do imóvel dentro do vizinho */
  pctImovel: number;
  /** % do vizinho dentro do imóvel */
  pctVizinho: number;
  decisao: DecisaoSobreposicao;
}

export interface AjusteSobreposicao {
  /** só os vizinhos que o imóvel invade (os que só encostam não entram) */
  itens: ItemSobreposicao[];
  /** perímetro sem as sobreposições cortadas; null = nada a cortar */
  perimetro: LonLat[] | null;
  /** nome de cada vértice do perímetro novo (os do original continuam com o nome) */
  nomesVertices?: (string | null)[];
  /** com glebas: as OUTRAS glebas depois do corte (a que o corte não tocou volta igual) */
  outras?: LonLat[][];
  /** os nomes dos vértices de cada uma das outras glebas */
  nomesOutras?: ((string | null)[] | undefined)[];
  antesM2: number;
  depoisM2: number;
  /** o que saiu do imóvel (para o mapa) */
  recorte: PoligonoGeo[];
  /** lascas que o corte soltou do imóvel e ficaram de fora (m²) */
  lascasM2: number;
  /** sobreposição que sobrou com os vizinhos cortados, medida no perímetro novo (m²; esperado 0) */
  restanteM2: number;
}

/** Abaixo disto é ruído de ponto flutuante numa divisa comum, não sobreposição (m²). */
export const SOBREPOSICAO_MIN_M2 = 0.01;
/** Folga do corte: a divisa nova fica a 10 cm do vizinho, nunca em cima dele. */
export const FOLGA_M = 0.1;
/** Vértice novo mais perto que isto do vizinho de anel sai (o SICAR recusa vértice colado, 3001; a mesma régua do GPX). */
export const VERTICE_MIN_M = 1;

const fechoFora = (a: LonLat[]): LonLat[] =>
  a.length > 1 && a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1] ? a.slice(0, -1) : a;

function vizinhoNoPlano(pl: PlanoCar, v: VizinhoCar): Poligono[] {
  const pols = v.poligonos
    .map((pol) => pol.map(fechoFora).filter((a) => a.length >= 3))
    .filter((pol) => pol.length)
    .map((pol): Poligono => ({ ext: antiHorario(pol[0].map(pl.para)), furos: pol.slice(1).map((f) => antiHorario(f.map(pl.para)).reverse()) }));
  // normaliza (anel torto, pedaços que se sobrepõem): a união do próprio vizinho
  return pols.length ? uniao(pols) : [];
}

/**
 * Tira vértice NOVO (criado pelo corte) colado no vizinho de anel
 * (< VERTICE_MIN_M), sem devolver área aos vizinhos cortados: sai o vértice
 * novo cuja remoção não aumenta a sobreposição com `proibido`. Os vértices do
 * levantamento (`originais`) nunca saem.
 */
function semVerticesColados(anel: Anel, proibido: Poligono[], originais: Anel): Anel {
  let pts = anel.slice();
  const ehOriginal = (p: Anel[number]) => originais.some((o) => dist(o, p) < 0.005);
  const invade = (a: Anel) => (proibido.length ? areaPols(intersecao([{ ext: a, furos: [] }], proibido)) : 0);
  let base = invade(pts);
  for (let volta = 0; volta < 4; volta++) {
    let mudou = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const j = (i + 1) % pts.length;
      if (dist(pts[i], pts[j]) >= VERTICE_MIN_M) continue;
      for (const k of [j, i].filter((n) => !ehOriginal(pts[n]))) {
        const sem = pts.filter((_, n) => n !== k);
        const s = invade(sem);
        if (s <= base + 1e-4) { pts = sem; base = s; mudou = true; break; }
      }
    }
    if (!mudou) break;
  }
  return pts;
}

/**
 * Cruza o perímetro com os vizinhos e monta o perímetro sem as sobreposições.
 * `ignorar`: códigos que a pessoa mandou deixar como estão (desfez o ajuste);
 * `forcar`: códigos que a pessoa mandou cortar mesmo sendo "grande"/"proprio".
 */
export function ajustarSobreposicao(
  perimetro: LonLat[],
  vizinhos: VizinhoCar[],
  op: {
    ignorar?: string[]; forcar?: string[]; nomesVertices?: (string | null)[];
    /** as outras glebas da área total (o imóvel é a união de todas) */
    outras?: LonLat[][];
    nomesOutras?: ((string | null)[] | undefined)[];
  } = {},
): AjusteSobreposicao {
  // cada gleba é cortada à parte (a gleba que o corte não toca volta igual); a área total é a união
  // os nomes andam com o anel (o filtro não desalinha um do outro)
  const outrasOk = (op.outras ?? []).map((anel, i) => ({ anel, nomes: op.nomesOutras?.[i] })).filter((x) => x.anel.length >= 3);
  const aneisGeo = [perimetro, ...outrasOk.map((x) => x.anel)];
  const nomesGeo = [op.nomesVertices, ...outrasOk.map((x) => x.nomes)];
  const todos = aneisGeo.flat();
  const pl = planoDe(todos);
  const glebas: Poligono[] = aneisGeo.map((a) => ({ ext: antiHorario(a.map(pl.para)), furos: [] }));
  const imovel = uniaoDasGlebas(glebas.map((g) => g.ext)).imovel;
  const antesM2 = areaPols(imovel);
  const ignorar = new Set(op.ignorar ?? []);
  const forcar = new Set(op.forcar ?? []);
  const vazio: AjusteSobreposicao = { itens: [], perimetro: null, antesM2, depoisM2: antesM2, recorte: [], lascasM2: 0, restanteM2: 0 };
  if (perimetro.length < 3 || !(antesM2 > 0)) return vazio;

  // o mesmo vizinho pode vir duas vezes (UFs vizinhas, SIGEF repetido)
  const unicos = [...new Map(vizinhos.map((v) => [`${v.fonte}:${v.codigo}`, v])).values()];
  const comCorte: { item: ItemSobreposicao; pol: Poligono[] }[] = [];
  for (const v of unicos) {
    const pol = vizinhoNoPlano(pl, v);
    if (!pol.length) continue;
    const area = areaPols(intersecao(imovel, pol));
    if (area < SOBREPOSICAO_MIN_M2) continue;
    const areaViz = areaPols(pol);
    const pctImovel = (100 * area) / antesM2;
    const pctVizinho = areaViz > 0 ? (100 * area) / areaViz : 0;
    // com glebas, a certificação (ou o CAR) de UMA gleba também é o próprio imóvel:
    // sem isto a gleba vizinha seria cortada a 10 cm da outra
    const daGleba = glebas.length > 1 && glebas.some((g) => {
      const ag = areaPol(g), ai = areaPols(intersecao([g], pol));
      return ag > 0 && areaViz > 0 && ai / ag >= 0.8 && ai / areaViz >= 0.8;
    });
    let decisao: DecisaoSobreposicao = "cortado";
    if (ignorar.has(v.codigo)) decisao = "ignorado";
    else if (!forcar.has(v.codigo)) {
      if (situacaoInativa(v.situacao)) decisao = "inativo";
      else if ((pctImovel >= 80 && pctVizinho >= 80) || daGleba) decisao = "proprio";
      else if (pctImovel > 50) decisao = "grande";
    }
    comCorte.push({ item: { fonte: v.fonte, codigo: v.codigo, rotulo: v.rotulo, situacao: v.situacao ?? null, areaM2: area, pctImovel, pctVizinho, decisao }, pol });
  }
  const itensOrdenados = () => comCorte.map((c) => c.item).sort((a, b) => b.areaM2 - a.areaM2);
  if (!comCorte.some((c) => c.item.decisao === "cortado")) return { ...vazio, itens: itensOrdenados() };

  // corta cada gleba; vizinho inteiro dentro (o corte vira furo) sai da lista e o corte é refeito;
  // gleba que sumiria inteira: os vizinhos dela voltam a "grande" (decisão de gente) e o corte é refeito
  let cortes: ({ maior: Poligono; lascas: Poligono[] } | null)[] = [];
  for (let tentativa = 0; tentativa <= comCorte.length + glebas.length; tentativa++) {
    const cortar = comCorte.filter((c) => c.item.decisao === "cortado");
    if (!cortar.length) return { ...vazio, itens: itensOrdenados() };
    const faca = uniao(cortar.flatMap((c) => offsetPols(c.pol, FOLGA_M)));
    let refazer = false;
    cortes = [];
    for (const g of glebas) {
      if (areaPols(intersecao([g], faca)) < 1e-6) { cortes.push(null); continue; }
      const pedacos = diferenca([g], faca).sort((a, b) => areaPol(b) - areaPol(a));
      const maior = pedacos[0];
      if (!maior || maior.ext.length < 3) {
        for (const c of cortar) if (areaPols(intersecao([g], c.pol)) >= SOBREPOSICAO_MIN_M2) c.item.decisao = "grande";
        refazer = true;
        break;
      }
      if (maior.furos.length) {
        let marcou = false;
        for (const f of maior.furos) {
          const ce = centroide(f);
          const dono = cortar.find((x) => x.pol.some((p) => dentroAnel(ce, p.ext)));
          if (dono) { dono.item.decisao = "dentro"; marcou = true; }
        }
        if (marcou) { refazer = true; break; }
      }
      cortes.push({ maior: { ext: maior.ext, furos: [] }, lascas: pedacos.slice(1) });
    }
    if (!refazer) break;
    if (tentativa === comCorte.length + glebas.length) return { ...vazio, itens: itensOrdenados() };
  }
  if (!cortes.some(Boolean)) return { ...vazio, itens: itensOrdenados() };

  const cortados = comCorte.filter((c) => c.item.decisao === "cortado");
  const proibido = uniao(cortados.flatMap((c) => c.pol));
  const novosPlano: Poligono[] = glebas.map((g, i) => {
    const c = cortes[i];
    return c ? { ext: semVerticesColados(tirarBicos(antiHorario(c.maior.ext)), proibido, g.ext), furos: [] } : g;
  });
  const novos = novosPlano.map((g, i) => (cortes[i] ? paraGeo(pl, [g], todos)[0].ext : aneisGeo[i]));

  // nomes: o vértice que é o mesmo do original (paraGeo devolve o ponto exato) leva o nome
  const nomesNovos = novos.map((novo, i) => {
    const nomes = nomesGeo[i], orig = aneisGeo[i];
    if (!cortes[i]) return nomes;
    if (nomes?.length !== orig.length) return undefined;
    const nomePor = new Map(orig.map((p, k) => [`${p[0]},${p[1]}`, nomes[k]]));
    return novo.map((p) => nomePor.get(`${p[0]},${p[1]}`) ?? null);
  });

  // conferência nas glebas que vão ser gravadas (já em grau e de volta)
  const pl2 = planoDe(novos.flat());
  const imovel2 = uniaoDasGlebas(novos.map((a) => antiHorario(a.map(pl2.para)))).imovel;
  const restanteM2 = cortados.reduce((s, c) => {
    const v = unicos.find((x) => x.codigo === c.item.codigo && x.fonte === c.item.fonte)!;
    return s + areaPols(intersecao(imovel2, vizinhoNoPlano(pl2, v)));
  }, 0);

  const depoisM2 = areaPols(imovel2);
  const recorte = paraGeo(pl, diferenca(imovel, uniaoDasGlebas(novosPlano.map((g) => g.ext)).imovel), todos);
  const lascasM2 = cortes.reduce((s, c) => s + (c ? areaPols(c.lascas) : 0), 0);
  return {
    itens: itensOrdenados(),
    perimetro: novos[0], ...(nomesNovos[0] ? { nomesVertices: nomesNovos[0] } : {}),
    ...(glebas.length > 1 ? { outras: novos.slice(1), nomesOutras: nomesNovos.slice(1) } : {}),
    antesM2, depoisM2, recorte, lascasM2, restanteM2,
  };
}

/** Frase curta do que foi feito, para o aviso do topo. */
export function fraseDoAjuste(a: AjusteSobreposicao, fmtHa: (m2: number) => string, fmtArea: (m2: number) => string): string {
  const cortados = a.itens.filter((i) => i.decisao === "cortado");
  const quem = cortados.map((i) => `${i.rotulo} (${fmtArea(i.areaM2)})`).join(", ");
  return `Deu sobreposição com ${cortados.length === 1 ? "o imóvel vizinho" : `${cortados.length} imóveis vizinhos`} — ${quem} —, mas ajustamos o terreno: `
    + `a divisa agora passa por fora deles e a área foi de ${fmtHa(a.antesM2)} para ${fmtHa(a.depoisM2)}.`;
}
