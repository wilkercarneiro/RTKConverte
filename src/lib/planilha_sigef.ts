// Prévia da planilha ODS do SIGEF na tela, ANTES de gerar.
//
// Nada de regra própria aqui: a tabela sai das MESMAS funções compartilhadas
// que gerar-documentos usa para preencher a aba `perimetro_N` —
//   linhas do banco → entradaDoServidor (codigos_marcos.ts, o mapeamento do
//   servidor) → montarServico / montarPartes / unidadesDasGlebas (_shared) →
//   `calc.linhasOds` (as linhas que patchOdsContent grava, ods.ts).
// O que muda em relação à geração é só a numeração dos vértices ainda sem
// código: a geração reserva os números no contador do credenciado
// (alocar_contadores); a prévia mostra os PRÓXIMOS números do contador, sem
// reservar nada — por isso essas linhas saem marcadas como "previsto".
import proj4 from "proj4";
import { montarPartes, montarServico } from "../../supabase/functions/_shared/servico.ts";
import type { ServicoCalculado, ServicoInput, VerticeMontado } from "../../supabase/functions/_shared/servico.ts";
import { partesDasGlebas, unidadesDasGlebas } from "../../supabase/functions/_shared/planta_dados.ts";
import type { GlebaRow, ServicoRow } from "../../supabase/functions/_shared/planta_dados.ts";
import type { LinhaVertice } from "../../supabase/functions/_shared/ods.ts";
import type { EstiloCodigo, Proj4 } from "../../supabase/functions/_shared/geo.ts";
import { comoNoServidor, entradaDoServidor } from "./codigos_marcos.ts";
import type { Credenciado, Gleba, Servico, Vertice } from "./types";

const p4: Proj4 = (de, para, c) => proj4(de, para, c) as [number, number];

/** Uma linha da aba de perímetro, como vai para a planilha, com o que a conferência precisa ao lado. */
export interface LinhaPrevia extends LinhaVertice {
  tipo: "M" | "P" | "V";
  /** vértice digitado à mão (V pré-existente, vértice certificado do vizinho) */
  inserido: boolean;
  /** a linha da tabela `vertices` (ordem no banco); null quando não dá para saber */
  ordemBanco: number | null;
  /** código ainda não reservado: a geração tira este número do contador do credenciado */
  previsto: boolean;
  /** este vértice abre uma confrontação (é onde o confrontante muda) */
  iniciaTrecho: boolean;
  eProj: number;
  nProj: number;
  latDeg: number;
  lonDeg: number;
}

export interface AbaPrevia {
  /** perimetro_1, perimetro_2… */
  aba: string;
  denominacao: string;
  parcela: string;
  linhas: LinhaPrevia[];
  /** aba de GLEBA recortada do anel (códigos do imóvel, não seguem sequência própria) */
  deGleba: boolean;
  /** o TXT vinha no sentido anti-horário e o anel foi invertido para o horário */
  invertido: boolean;
  areaHa: number;
  perimetroM: number;
}

export interface PreviaPlanilha {
  abas: AbaPrevia[];
  estilo: EstiloCodigo;
  prefixo: string;
  mcAbs: number;
  hemisferio: "Sul" | "Norte";
  /** algum vértice sem código: a geração vai (re)numerar */
  realoca: boolean;
  /**
   * `ordem` do banco na sequência em que a geração numera (anel começando no
   * ponto mais ao norte, sentido horário; em partes, parte após parte). É a
   * "ordem do anel" da renumeração em lote.
   */
  ordemDoAnel: number[];
  avisos: string[];
  erro: string | null;
}

type ServicoPrevia = Pick<Servico, "modalidade" | "fuso_utm" | "tem_glebas" | "denominacao_parcela" | "parcela_numero"> &
  Partial<Pick<Servico, "vertice_inicial">> & ServicoRow;

/** O anel veio invertido? (o 2º vértice publicado é o ANTERIOR ao 1º na ordem do banco) */
function foiInvertido(ring: VerticeMontado[]): boolean {
  if (ring.length < 3) return false;
  const ordens = ring.map((v) => v.ordemBanco).sort((a, b) => a - b);
  const pos = new Map(ordens.map((o, i) => [o, i]));
  const a = pos.get(ring[0].ordemBanco)!, b = pos.get(ring[1].ordemBanco)!;
  return (a - b + ordens.length) % ordens.length === 1;
}

function linhasDaAba(calc: ServicoCalculado, ordemDe: (v: VerticeMontado) => number | null, temCodigo: (o: number | null, codigo: string) => boolean): LinhaPrevia[] {
  return calc.ring.map((v, i) => {
    const o = ordemDe(v);
    return {
      ...calc.linhasOds[i],
      tipo: v.tipo,
      inserido: v.inserido,
      ordemBanco: o,
      previsto: !temCodigo(o, v.codigo),
      iniciaTrecho: !!v.iniciaTrecho,
      eProj: v.eProj, nProj: v.nProj, latDeg: v.latDeg, lonDeg: v.lonDeg,
    };
  });
}

/**
 * A planilha como a geração vai gravar. `credenciado` dá o prefixo e os
 * próximos números (sem ele a prévia numera "????-P-0001", e avisa).
 */
export function previaDaPlanilha(p: {
  servico: ServicoPrevia;
  vertices: Vertice[];
  glebas?: Pick<Gleba, "nome" | "ordem" | "anel" | "confrontante_interno" | "denominacao" | "detentor_nome" | "detentor_cpf">[];
  credenciado?: Pick<Credenciado, "prefixo_vertice" | "contador_m" | "contador_p" | "contador_v"> | null;
}): PreviaPlanilha {
  const { servico, credenciado } = p;
  const conferencia = servico.modalidade === "conferencia";
  const estilo: EstiloCodigo = conferencia ? "conferencia" : "oficial";
  const prefixo = credenciado?.prefixo_vertice ?? "????";
  const vazio = (erro: string): PreviaPlanilha => ({
    abas: [], estilo, prefixo, mcAbs: 0, hemisferio: "Sul", realoca: false, ordemDoAnel: [], avisos: [], erro,
  });
  if (!servico.fuso_utm) return vazio("Defina o fuso UTM do serviço para ver a planilha.");
  if (p.vertices.length < 3) return vazio("A planilha precisa de pelo menos 3 vértices.");
  const avisos: string[] = [];
  try {
    const vs = comoNoServidor(p.vertices, conferencia);
    const glebaRows: GlebaRow[] = servico.tem_glebas ? (p.glebas ?? []) : [];
    // mesmas decisões de gerar-documentos: partes (anéis disjuntos) antes da alocação
    const partesOrdens = partesDasGlebas(glebaRows, vs);
    const numeradas = partesOrdens ? new Set(partesOrdens.flatMap((pt) => pt.ordens)) : null;
    const recebe = (v: Vertice) => !numeradas || numeradas.has(v.ordem);
    const realoca = vs.some((v) => recebe(v) && !v.codigo && !v.inserido_manual);
    if (realoca && !conferencia && !credenciado) avisos.push("Sem credenciado escolhido: os códigos da prévia saem como ????. Escolha o credenciado em Dados.");
    // o contador guarda o PRÓXIMO número; 0 vale como 1 (0031_contador_proximo_numero.sql)
    const contadores = realoca && !conferencia && credenciado
      ? { M: Math.max(1, credenciado.contador_m), P: Math.max(1, credenciado.contador_p), V: Math.max(1, credenciado.contador_v) }
      : { M: 1, P: 1, V: 1 };
    const input: ServicoInput = {
      fusoUtm: servico.fuso_utm,
      verticeInicialOrdem: servico.vertice_inicial ?? 0,
      prefixo, contadores, estiloCodigo: estilo,
      vertices: entradaDoServidor(vs, realoca),
    };
    const calcPartes = partesOrdens ? montarPartes(input, partesOrdens, p4) : null;
    const calc = calcPartes ? calcPartes.partes[0].calc : montarServico(input, p4);
    const ringTodos = calcPartes ? calcPartes.partes.flatMap((pt) => pt.calc.ring) : calc.ring;

    const codigoNoBanco = new Map(vs.map((v) => [v.ordem, v.codigo]));
    const temCodigo = (o: number | null, codigo: string) => o !== null && codigoNoBanco.get(o) === codigo;
    // na aba de gleba a ordem é local; o vértice é achado pelo código (o mesmo do imóvel)
    const ordemPorCodigo = new Map(ringTodos.map((v) => [v.codigo, v.ordemBanco]));

    let unidades: { nome: string; calc: ServicoCalculado }[] = [];
    let deGleba = false;
    if (calcPartes) unidades = calcPartes.partes;
    else if (servico.tem_glebas && glebaRows.length) {
      const u = unidadesDasGlebas(glebaRows, vs, input, calc, servico, { fusoUtm: servico.fuso_utm, prefixo, estiloCodigo: estilo }, p4);
      unidades = u.unidades;
      deGleba = unidades.length > 0;
      avisos.push(...u.avisos);
    }
    const abas: AbaPrevia[] = unidades.length
      ? unidades.map((u, i) => ({
        aba: `perimetro_${i + 1}`,
        denominacao: u.nome,
        parcela: String(i + 1).padStart(3, "0"),
        linhas: deGleba
          ? linhasDaAba(u.calc, (v) => ordemPorCodigo.get(v.codigo) ?? null, temCodigo)
          : linhasDaAba(u.calc, (v) => v.ordemBanco, temCodigo),
        deGleba,
        invertido: !deGleba && foiInvertido(u.calc.ring),
        areaHa: u.calc.areaHa, perimetroM: u.calc.perimetroM,
      }))
      : [{
        aba: "perimetro_1",
        denominacao: servico.denominacao_parcela ?? "Parte 1",
        parcela: servico.parcela_numero ?? "001",
        linhas: linhasDaAba(calc, (v) => v.ordemBanco, temCodigo),
        deGleba: false,
        invertido: foiInvertido(calc.ring),
        areaHa: calc.areaHa, perimetroM: calc.perimetroM,
      }];
    return {
      abas, estilo, prefixo, mcAbs: calc.mcAbs,
      hemisferio: calc.ring[0].latDeg < 0 ? "Sul" : "Norte",
      realoca, ordemDoAnel: ringTodos.map((v) => v.ordemBanco), avisos, erro: null,
    };
  } catch (e) {
    return vazio(e instanceof Error ? e.message : String(e));
  }
}
