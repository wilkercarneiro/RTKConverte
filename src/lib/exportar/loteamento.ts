// Camadas do loteamento, a partir do `Resultado` de `calcular` (o mesmo que a
// tela desenha e que a planta, o DXF e a locação usam):
//
//   GLEBA            o perímetro do serviço (UTM, como o levantamento), com o
//                    confrontante de cada lado (a regra do memorial do loteamento)
//   QUADRAS, LOTES (quadra, número, área), AREAS_PUBLICAS (tipo),
//   VIARIO           o que sobra da gleba fora das quadras e áreas (`viarioDe`)
//   VERTICES_GLEBA   os marcos do perímetro, com o código de cada um
//   VERTICES_LOTES   os pontos de locação dos lotes, com o MESMO nome da
//                    planta, do memorial e do arquivo da coletora ("A-07")
//
// O cálculo é no plano de projeto; as coordenadas voltam a UTM pelo fator de
// escala (`paraUtm`), como em todas as saídas do loteamento. As áreas são as do
// quadro (no plano), as mesmas que o memorial publica. Sem azimute/distância
// no DXF daqui: no plano topográfico a distância do memorial não é a do UTM, e
// o DXF do projeto (Entregas) já traz as cotas dos lotes.
import { viarioDe } from "../loteamento/calculo.ts";
import type { Perimetro, Resultado } from "../loteamento/calculo.ts";
import { areaPol } from "../loteamento/geom.ts";
import type { Poligono, Pt } from "../loteamento/geom.ts";
import { paraUtm } from "../loteamento/plano.ts";
import { chavePonto, LOCACAO_PADRAO, nomesDosPontos, pontosDeLocacao } from "../loteamento/saidas.ts";
import type { PontoLocacao } from "../loteamento/saidas.ts";
import type { Camada, Feicao, Valor, XY } from "./tipos.ts";

const r2 = (v: number) => Math.round(v * 100) / 100;

export const CORES_LOTEAMENTO: Record<string, string> = {
  GLEBA: "#E53935", QUADRAS: "#5E35B1", LOTES: "#FFB300", AREAS_PUBLICAS: "#2E7D32", VIARIO: "#9E9E9E",
  VERTICES_GLEBA: "#E53935", VERTICES_LOTES: "#FB8C00",
};

/**
 * Os vértices dos lotes (e PC/PT/meio das curvas de esquina), sem estacas de
 * eixo nem perímetro: UM ponto por posição. Quadras encostadas (fundo com
 * fundo, sem rua entre elas) dividem vértices, e a locação emite o mesmo ponto
 * por cada uma ("A-16" e "H-02" no mesmo lugar); aqui vale o nome que a planta
 * e o memorial imprimem (`nomesDosPontos`), com a quadra e o código do dono dele.
 */
function verticesDosLotes(res: Resultado, perimetro: Perimetro): PontoLocacao[] {
  const todos = pontosDeLocacao(res, perimetro, { ...LOCACAO_PADRAO, eixos: false, perimetro: false })
    .filter((p) => p.tipo === "lote" || p.tipo === "curva");
  const nomes = nomesDosPontos(todos);
  const porNome = new Map(todos.map((p) => [p.nome, p]));
  const vistos = new Set<string>();
  const out: PontoLocacao[] = [];
  for (const p of todos) {
    const k = chavePonto(p.p);
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(porNome.get(nomes.get(k) ?? p.nome) ?? p);
  }
  return out;
}

export function camadasDoLoteamento(res: Resultado, perimetro: Perimetro): Camada[] {
  const U = (p: Pt): XY => { const u = paraUtm(res.plano, p); return [u[0], u[1]]; };
  const pol = (nome: string, p: Poligono, props: Record<string, Valor>): Feicao => ({
    nome, tipo: "poligono", utm: p.ext.map(U), furosUtm: p.furos.map((f) => f.map(U)), props,
  });

  // confrontante de cada lado da gleba: a estrada do projeto, senão o vizinho do levantamento (memorial geral)
  const n = perimetro.pts.length;
  const confrontantes = perimetro.pts.map((_, i) => {
    const lado = res.ladosGleba.length === n ? res.ladosGleba[i] : undefined;
    return lado?.tipo === "via" ? (lado.nome || "estrada existente") : (perimetro.confrontantes[i] ?? null);
  });
  const altitude = (h: number | undefined) => (typeof h === "number" && Number.isFinite(h) && h !== 0 ? h : null);

  const lotes = [...res.lotes].sort((a, b) => a.quadra.localeCompare(b.quadra, "pt-BR", { numeric: true }) || a.numero - b.numero);
  const viario = viarioDe(res);
  const locacao = verticesDosLotes(res, perimetro);

  const camadas: Camada[] = [
    {
      nome: "GLEBA",
      feicoes: [{
        nome: "GLEBA", tipo: "poligono", utm: perimetro.pts.map((p): XY => [p[0], p[1]]),
        alt: perimetro.pts.map((_, i) => altitude(perimetro.altitudes[i])), confrontantes, props: { area_m2: r2(res.quadro.gleba) },
      }],
    },
    { nome: "QUADRAS", rotulos: 2, feicoes: res.quadras.map((q) => pol(`QUADRA ${q.nome}`, q.pol, { quadra: q.nome, lotes: q.lotes.length, area_m2: r2(q.area) })) },
    { nome: "LOTES", rotulos: 0.8, feicoes: lotes.map((l) => pol(l.id, l.pol, { quadra: l.quadra, numero: l.numero, area_m2: r2(l.area) })) },
    { nome: "AREAS_PUBLICAS", rotulos: 1.2, feicoes: res.publicas.map((a) => pol(a.nome, a.pol, { tipo: a.tipo, area_m2: r2(a.area) })) },
    { nome: "VIARIO", feicoes: viario.map((v, i) => pol(viario.length > 1 ? `SISTEMA VIÁRIO ${i + 1}` : "SISTEMA VIÁRIO", v, { area_m2: r2(areaPol(v)) })) },
    {
      nome: "VERTICES_GLEBA",
      feicoes: perimetro.pts.map((p, i): Feicao => ({
        nome: perimetro.nomes?.[i] || `P${i + 1}`, tipo: "ponto", utm: [[p[0], p[1]]], alt: [altitude(perimetro.altitudes[i])],
      })),
    },
    {
      nome: "VERTICES_LOTES",
      feicoes: locacao.map((p): Feicao => ({
        nome: p.nome, tipo: "ponto", utm: [[p.e, p.n]], alt: [altitude(p.h)],
        props: { quadra: p.quadra ?? null, codigo: p.codigo },
      })),
    },
  ];
  return camadas.map((c) => ({ ...c, cor: CORES_LOTEAMENTO[c.nome] }));
}
