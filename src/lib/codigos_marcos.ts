// Numeração oficial dos marcos SEM gerar os documentos — para o GEO de cada
// parte da divisão poder nascer antes do "Gerar documentos" (pedido de
// 03/11/2026).
//
// Os GEOs das partes copiam os códigos dos marcos do imóvel (o marco tem o
// mesmo nome nos dois GEOs). Depois de salvar a divisão, os marcos novos estão
// sem código, e a próxima geração renumeraria o imóvel INTEIRO
// (gerar-documentos: um vértice sem código → `precisaAlocar` → todos de novo).
// Por isso o GEO da parte esperava a geração.
//
// Aqui sai a mesma conta do servidor, com as MESMAS funções compartilhadas
// (montarServico + codigosPorLinha, mesma entrada, mesmos contadores reservados
// por alocar_contadores). Gravados os códigos, a geração seguinte encontra
// todos os vértices numerados e os reutiliza — os documentos do imóvel e os
// GEOs das partes saem com os mesmos códigos.
//
// Espelha supabase/functions/gerar-documentos/index.ts (bloco "alocação de
// códigos"). Só cobre o anel único — a divisão: serviço em PARTES disjuntas
// (TXT em blocos) devolve null e continua pedindo a geração.
import proj4 from "proj4";
import { codigosPorLinha, montarServico } from "../../supabase/functions/_shared/servico.ts";
import type { ServicoInput, VerticeServico } from "../../supabase/functions/_shared/servico.ts";
import { ehCodigoDeConferencia } from "../../supabase/functions/_shared/geo.ts";
import type { Servico, Vertice } from "./types";

type Contadores = { M: number; P: number; V: number };

/** Código que não vale para protocolar (mesma regra do servidor): conta como ausente. */
const provisorio = (v: Pick<Vertice, "codigo" | "codigo_provisorio">) =>
  !!v.codigo_provisorio || ehCodigoDeConferencia(v.codigo) || (!!v.codigo && v.codigo.startsWith("PROV-"));

/** Os vértices como o servidor os enxerga ao alocar (código provisório vira ausente). */
function comoNoServidor(vertices: Vertice[]): Vertice[] {
  return [...vertices].sort((a, b) => a.ordem - b.ordem)
    .map((v) => (!v.inserido_manual && provisorio(v) ? { ...v, codigo: null } : v));
}

/** Falta numerar algum marco? (o que faria a geração realocar tudo) */
export const precisaNumerar = (vertices: Vertice[]): boolean =>
  comoNoServidor(vertices).some((v) => !v.codigo && !v.inserido_manual);

/** Quantos números de cada tipo a alocação consome (para alocar_contadores). */
export function consumoDaNumeracao(vertices: Vertice[]): Contadores {
  const c = { M: 0, P: 0, V: 0 };
  for (const v of comoNoServidor(vertices)) if (!v.inserido_manual || !v.codigo) c[v.tipo as keyof Contadores]++;
  return c;
}

/**
 * Código de cada linha do banco (ordem → código) a partir dos contadores
 * reservados — a mesma numeração que gerar-documentos gravaria.
 */
export function numeracaoDosMarcos(servico: Servico, vertices: Vertice[], prefixo: string, contadores: Contadores): Map<number, string> {
  const vs = comoNoServidor(vertices);
  const realocar = vs.some((v) => !v.codigo && !v.inserido_manual);
  const entrada: VerticeServico[] = vs.map((v) => ({
    ordem: v.ordem,
    numTxt: v.num_txt,
    e: v.e === null ? null : Number(v.e),
    n: v.n === null ? null : Number(v.n),
    latGmsStr: v.inserido_manual ? v.lat_gms : null,
    lonGmsStr: v.inserido_manual ? v.lon_gms : null,
    h: Number(v.h),
    sigmaPos: Number(v.sigma_pos),
    sigmaH: Number(v.sigma_h),
    tipo: v.tipo,
    metodo: v.metodo,
    codigoManual: realocar ? (v.inserido_manual ? v.codigo : null) : v.codigo,
    inserido: v.inserido_manual,
    descritivo: v.descritivo || v.apelido_txt || "",
    tipoLimite: v.tipo_limite,
    ehVia: v.eh_via,
    cns: v.cns,
    matricula: v.matricula,
    numerado: v.numerado,
    exibirPlanta: v.exibir_planta !== false,
  }));
  const input: ServicoInput = {
    fusoUtm: servico.fuso_utm!,
    verticeInicialOrdem: servico.vertice_inicial ?? 0,
    prefixo,
    contadores,
    estiloCodigo: "oficial",
    vertices: entrada,
  };
  const p4 = (de: string, para: string, c: [number, number]) => proj4(de, para, c) as [number, number];
  return codigosPorLinha(montarServico(input, p4).ring);
}
