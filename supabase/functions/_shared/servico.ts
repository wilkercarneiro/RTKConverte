// Montagem do serviço: aplica o pipeline geodésico à sequência de vértices,
// aloca códigos, associa trechos de confrontantes e produz as estruturas
// prontas para o memorial (DOCX) e a planilha (ODS).
import {
  alocarCodigos, calcularAreaHa, calcularPerimetroM, calcularSegmentos,
  calcularVertices, fmtGmsPlanilha, parseGmsPlanilha, rotacionarRing,
} from "./geo.ts";
import type { EntradaVertice, Proj4, Segmento, VerticeCalc } from "./geo.ts";
import type { VerticeMemorial } from "./memorial.ts";
import type { LinhaVertice } from "./ods.ts";

export interface VerticeServico {
  ordem: number;                 // posição na sequência do perímetro (0-based, ordem do TXT com inserções)
  numTxt: number | null;
  e?: number | null;
  n?: number | null;
  latGmsStr?: string | null;     // V inserido: "11 24 30,375 S"
  lonGmsStr?: string | null;
  h: number;
  sigmaPos: number;
  sigmaH: number;
  tipo: "M" | "P" | "V";
  metodo: string;                // PG6 default, PA1 p/ V inserido
  codigoManual?: string | null;  // V inserido com código digitado
  inserido: boolean;
}

export interface TrechoServico {
  verticeInicioOrdem: number;
  descritivo: string;
  tipoLimite: string;
  cns?: string | null;
  matricula?: string | null;
}

export interface ServicoInput {
  fusoUtm: number;
  verticeInicialOrdem: number;
  prefixo: string;
  contadores: { M: number; P: number; V: number };
  vertices: VerticeServico[];    // em ordem de perímetro
  trechos: TrechoServico[];
}

export interface VerticeMontado extends VerticeCalc {
  tipo: "M" | "P" | "V";
  metodo: string;
  codigo: string;
  trecho: TrechoServico;         // trecho a que o vértice pertence
  iniciaTrecho: TrechoServico | null;
}

export interface ServicoCalculado {
  ring: VerticeMontado[];        // ordenado a partir do vértice inicial
  segs: Segmento[];
  areaHa: number;
  perimetroM: number;
  mcAbs: number;
  trechosOrdenados: TrechoServico[];
  contadoresFinais: { M: number; P: number; V: number };
  memorialRing: VerticeMemorial[];
  linhasOds: LinhaVertice[];
}

export function montarServico(inp: ServicoInput, proj4: Proj4): ServicoCalculado {
  if (inp.trechos.length === 0) throw new Error("Defina ao menos um trecho de confrontante");
  const entradas: EntradaVertice[] = inp.vertices.map((v) => ({
    numTxt: v.numTxt,
    e: v.e ?? undefined,
    n: v.n ?? undefined,
    latGms: v.latGmsStr ? parseGmsPlanilha(v.latGmsStr) : undefined,
    lonGms: v.lonGmsStr ? parseGmsPlanilha(v.lonGmsStr) : undefined,
    h: v.h, sigmaPos: v.sigmaPos, sigmaH: v.sigmaH, inserido: v.inserido,
  }));
  const calc = calcularVertices(entradas, inp.fusoUtm, proj4);

  // ring rotacionado a partir do vértice inicial
  const juntos = calc.map((c, i) => ({ ...c, tipo: inp.vertices[i].tipo, metodo: inp.vertices[i].metodo, codigoManual: inp.vertices[i].codigoManual ?? null }));
  const ring0 = rotacionarRing(juntos, inp.verticeInicialOrdem);

  // códigos alocados na ordem do memorial
  const codigos = alocarCodigos(ring0, inp.prefixo, inp.contadores);
  const consumo = { M: 0, P: 0, V: 0 };
  for (const v of ring0) if (!v.codigoManual) consumo[v.tipo]++;

  // trechos ordenados pela posição no ring; todo vértice pertence ao trecho
  // iniciado mais recentemente (o vértice que inicia já pertence ao novo trecho)
  const posNoRing = new Map<number, number>(ring0.map((v, i) => [v.ordem, i]));
  for (const t of inp.trechos) {
    if (!posNoRing.has(t.verticeInicioOrdem)) throw new Error(`Trecho aponta para vértice inexistente (ordem=${t.verticeInicioOrdem})`);
  }
  const trechosOrdenados = [...inp.trechos].sort((a, b) => posNoRing.get(a.verticeInicioOrdem)! - posNoRing.get(b.verticeInicioOrdem)!);
  if (posNoRing.get(trechosOrdenados[0].verticeInicioOrdem) !== 0) {
    throw new Error("O vértice inicial do memorial deve iniciar um trecho de confrontante");
  }

  const inicioPorOrdem = new Map<number, TrechoServico>(trechosOrdenados.map((t) => [t.verticeInicioOrdem, t]));
  let trechoAtual = trechosOrdenados[0];
  const ring: VerticeMontado[] = ring0.map((v) => {
    const inicia = inicioPorOrdem.get(v.ordem) ?? null;
    if (inicia) trechoAtual = inicia;
    return { ...v, codigo: codigos.get(v.ordem)!, trecho: trechoAtual, iniciaTrecho: inicia };
  });

  const segs = calcularSegmentos(ring);
  const areaHa = calcularAreaHa(ring);
  const perimetroM = calcularPerimetroM(segs);
  const mcAbs = Math.abs(6 * inp.fusoUtm - 183);

  const memorialRing: VerticeMemorial[] = ring.map((v) => ({
    codigo: v.codigo, latGms: v.latGms, lonGms: v.lonGms, h: v.h,
    iniciaTrechoDescritivo: v.iniciaTrecho ? v.iniciaTrecho.descritivo : null,
  }));

  const linhasOds: LinhaVertice[] = ring.map((v) => ({
    codigo: v.codigo,
    lonFmt: fmtGmsPlanilha(v.lonGms, "lon"),
    latFmt: fmtGmsPlanilha(v.latGms, "lat"),
    sigmaPos: v.sigmaPos, h: v.h, sigmaH: v.sigmaH,
    metodo: v.metodo, tipoLimite: v.trecho.tipoLimite,
    cns: v.trecho.cns ?? null, matricula: v.trecho.matricula ?? null,
    descritivo: v.trecho.descritivo,
  }));

  return {
    ring, segs, areaHa, perimetroM, mcAbs, trechosOrdenados,
    contadoresFinais: {
      M: inp.contadores.M + consumo.M,
      P: inp.contadores.P + consumo.P,
      V: inp.contadores.V + consumo.V,
    },
    memorialRing, linhasOds,
  };
}

// Sugestões pós-parse: tipos (M nos inícios de trecho, P nos demais) e trechos
// derivados dos rótulos do TXT (apelido = parte após "/").
export function sugerirTrechos(pontos: { num: number; rotulo: string | null }[]): { verticeInicioOrdem: number; apelido: string }[] {
  const out: { verticeInicioOrdem: number; apelido: string }[] = [];
  pontos.forEach((p, i) => {
    if (p.rotulo) {
      const partes = p.rotulo.split("/");
      out.push({ verticeInicioOrdem: i, apelido: (partes[1] ?? partes[0]).trim() });
    }
  });
  return out;
}
