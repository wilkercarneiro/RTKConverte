// Montagem dos dados de entrada da PLANTA a partir das DUAS fontes possíveis:
//
//   1. cálculo do próprio sistema (montarServico) — é a planta que sai junto com
//      o memorial e a planilha, ANTES de ir ao SIGEF;
//   2. PDF do SIGEF — é a planta oficial, gerada DEPOIS da certificação.
//
// As duas saem no MESMO padrão de folha (gerarPlantaPdf): o que muda é só de
// onde vêm vértices, trechos, área e perímetro. Este módulo existe para que esse
// "mesmo padrão" seja o mesmo código, e não duas cópias que divergem com o tempo.
import { fmtBR, fmtGmsPlanilha } from "./geo.ts";
import type { ServicoCalculado } from "./servico.ts";
import type { DadosPlanta, TrechoPlanta, VerticePlanta } from "./planta.ts";

export interface GeometriaPlanta {
  vertices: VerticePlanta[];
  trechos: TrechoPlanta[];
  areaFmt: string;
  perimetroFmt: string;
  latMediaDeg: number;
}

/** Geometria da planta a partir do anel calculado pelo sistema (fluxo 'geo'). */
export function geometriaDoCalculo(calc: ServicoCalculado): GeometriaPlanta {
  const posDe = new Map(calc.ring.map((v, i) => [v.ordem, i]));
  const vertices: VerticePlanta[] = calc.ring.map((v, i) => ({
    codigo: v.codigo,
    e: v.eProj,
    n: v.nProj,
    lonFmt: fmtGmsPlanilha(v.lonGms, "lon"),
    latFmt: fmtGmsPlanilha(v.latGms, "lat"),
    alt: String(v.h).replace(".", ","),
    azFmt: calc.segs[i].azimuteFmt,
    distFmt: calc.segs[i].distFmt,
    vante: calc.ring[(i + 1) % calc.ring.length].codigo,
  }));
  const trechos: TrechoPlanta[] = calc.trechosOrdenados.map((t, k) => ({
    descritivo: t.descritivo,
    isEstrada: t.ehVia,
    inicioIdx: posDe.get(t.verticeInicioOrdem) ?? 0,
    fimIdx: posDe.get(calc.trechosOrdenados[(k + 1) % calc.trechosOrdenados.length].verticeInicioOrdem) ?? 0,
  }));
  return {
    vertices,
    trechos,
    areaFmt: fmtBR(calc.areaHa, 4),
    perimetroFmt: fmtBR(calc.perimetroM, 2),
    latMediaDeg: calc.ring[0].latDeg,
  };
}

// linhas do serviço/RT/credenciado como chegam do banco (colunas usadas aqui)
export interface ServicoRow {
  denominacao?: string | null;
  detentor_nome?: string | null;
  detentor_cpf?: string | null;
  detentor_rg?: string | null;
  is_espolio?: boolean | null;
  inventariante_nome?: string | null;
  inventariante_cpf?: string | null;
  inventariante_rg?: string | null;
  requerente2_nome?: string | null;
  requerente2_cpf?: string | null;
  tipo_imovel?: string | null;
  matricula?: string | null;
  cns?: string | null;
  codigo_sncr?: string | null;
  municipio?: string | null;
  uf?: string | null;
}
export interface RtRow {
  nome?: string | null;
  formacao?: string | null;
  conselho_sigla?: string | null;
  conselho_numero?: string | null;
}
export interface CredRow {
  prefixo_vertice?: string | null;
}

export interface ContextoPlanta {
  servico: ServicoRow;
  rt: RtRow | null;
  cred: CredRow | null;
  desenhista: string;
  geometria: GeometriaPlanta;
  fuso: number;
  trt: string;
  dataStr: string;
  logo?: DadosPlanta["logo"];
  satelite?: DadosPlanta["satelite"];
}

/** Cabeçalho/carimbo/proprietários — comuns às duas fontes de geometria. */
export function montarDadosPlanta(ctx: ContextoPlanta): DadosPlanta {
  const { servico, rt, cred, geometria: g } = ctx;
  const posse = servico.tipo_imovel === "posse";
  const areaHaNum = parseFloat(g.areaFmt.replace(/\./g, "").replace(",", "."));

  const proprietarios: DadosPlanta["proprietarios"] = [{
    nome: servico.detentor_nome ?? "",
    cpf: servico.detentor_cpf ?? "",
    rg: servico.detentor_rg ?? null,
    isEspolio: !!servico.is_espolio,
    inventarianteNome: servico.inventariante_nome ?? null,
    inventarianteCpf: servico.inventariante_cpf ?? null,
    inventarianteRg: servico.inventariante_rg ?? null,
  }];
  if (servico.requerente2_nome && !posse) {
    proprietarios.push({ nome: servico.requerente2_nome, cpf: servico.requerente2_cpf ?? "" });
  }

  return {
    vertices: g.vertices,
    trechos: g.trechos,
    denominacao: servico.denominacao ?? "",
    proprietarios,
    tipoImovel: posse ? "posse" : "matricula",
    matricula: servico.matricula ?? "",
    cns: servico.cns ?? "",
    sncr: servico.codigo_sncr ?? "",
    municipioUf: `${servico.municipio}-${servico.uf}`,
    areaFmt: g.areaFmt,
    tarefasFmt: fmtBR(areaHaNum * 10000 / 4356, 2),
    perimetroFmt: g.perimetroFmt,
    mcAbs: Math.abs(6 * ctx.fuso - 183),
    fuso: ctx.fuso,
    latMediaDeg: g.latMediaDeg,
    trt: ctx.trt,
    rt: {
      nome: rt?.nome ?? "",
      formacao: rt?.formacao ?? "",
      conselhoSigla: rt?.conselho_sigla ?? "CFTA",
      conselhoNumero: rt?.conselho_numero ?? "",
      codigoCredenciado: cred?.prefixo_vertice ?? servico.codigo_sncr ?? "",
    },
    desenhista: ctx.desenhista,
    dataStr: ctx.dataStr,
    logo: ctx.logo ?? null,
    satelite: ctx.satelite ?? null,
  };
}

export function bytesDeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Data no fuso de Brasília (UTC-3), como sai no carimbo. */
export function dataHojeBR(): string {
  const agora = new Date(Date.now() - 3 * 3600 * 1000);
  const d = String(agora.getUTCDate()).padStart(2, "0");
  const m = String(agora.getUTCMonth() + 1).padStart(2, "0");
  return `${d}/${m}/${agora.getUTCFullYear()}`;
}

interface StorageLike {
  storage: { from: (b: string) => { download: (n: string) => Promise<{ error: unknown; data: Blob | null }> } };
}

/** Logo da empresa em templates/logo-empresa.(png|jpg); null quando não há. */
export async function carregarLogoPlanta(supa: StorageLike): Promise<DadosPlanta["logo"]> {
  for (const [nome, tipo] of [["logo-empresa.png", "png"], ["logo-empresa.jpg", "jpg"]] as const) {
    const dl = await supa.storage.from("templates").download(nome);
    if (!dl.error && dl.data) return { bytes: new Uint8Array(await dl.data.arrayBuffer()), tipo };
  }
  return null;
}
