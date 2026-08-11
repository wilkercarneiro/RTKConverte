// Montagem dos dados de entrada da PLANTA a partir das DUAS fontes possíveis:
//
//   1. cálculo do próprio sistema (montarServico) — é a planta que sai junto com
//      o memorial e a planilha, ANTES de ir ao SIGEF;
//   2. PDF do SIGEF — é a planta oficial, gerada DEPOIS da certificação.
//
// As duas saem no MESMO padrão de folha (gerarPlantaPdf): o que muda é só de
// onde vêm vértices, trechos, área e perímetro. Este módulo existe para que esse
// "mesmo padrão" seja o mesmo código, e não duas cópias que divergem com o tempo.
import { areaAssinadaM2, calcularPerimetroM, calcularSegmentos, fmtBR, fmtGmsPlanilha } from "./geo.ts";
import type { ServicoCalculado } from "./servico.ts";
import type { DadosPlanta, Folha, GlebaPlanta, TrechoPlanta, VerticePlanta } from "./planta.ts";
import type { DadosSigef } from "./sigef_pdf.ts";

/** Linha da tabela `glebas` como vem do banco. */
export interface GlebaRow {
  nome?: string | null;
  ordem?: number | null;
  anel?: [number, number][] | null;
}

/**
 * Glebas do banco no formato do desenho.
 *
 * Uma gleba NÃO é um contorno decorativo: na planta ela é uma poligonal com
 * quadro analítico, área e perímetro próprios. Por isso cada ponto do anel é
 * casado com o vértice correspondente do levantamento — é de lá que saem código,
 * latitude, longitude e altitude — e azimute e distância são recalculados sobre
 * o anel DA GLEBA, não copiados do perímetro: a gleba fecha por dentro, e o lado
 * que fecha não existe no perímetro.
 *
 * Ponto que não casa com vértice nenhum entra sem código (é um ponto livre
 * digitado na tela); ele desenha, mas sai em branco no quadro analítico, o que
 * é o sinal visível de que falta levantar aquele canto.
 */
export function glebasParaPlanta(
  rows: GlebaRow[],
  calc: ServicoCalculado,
  servico: ServicoRow,
): GlebaPlanta[] {
  // índice por coordenada arredondada ao milímetro
  const chave = (e: number, n: number) => `${e.toFixed(3)}|${n.toFixed(3)}`;
  const porCoord = new Map(calc.ring.map((v) => [chave(v.eProj, v.nProj), v]));

  return rows
    .filter((g) => (g.anel?.length ?? 0) >= 3)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
    .map((g, gi) => {
      const nome = (g.nome ?? "").trim() || `GLEBA ${gi + 1}`;
      const casados = g.anel!.map(([e, n]) => ({ e, n, v: porCoord.get(chave(e, n)) ?? null }));

      // segmentos do anel da gleba, no mesmo plano re-projetado do perímetro
      const anelCalc = casados.map((p, i) => ({ ordem: i, eProj: p.e, nProj: p.n }));
      const segs = calcularSegmentos(anelCalc);
      const m2 = Math.abs(areaAssinadaM2(anelCalc));
      const areaHa = m2 / 10000;

      const vertices: VerticePlanta[] = casados.map((p, i) => ({
        codigo: p.v?.codigo ?? "",
        e: p.e, n: p.n,
        lonFmt: p.v ? fmtGmsPlanilha(p.v.lonGms, "lon") : "",
        latFmt: p.v ? fmtGmsPlanilha(p.v.latGms, "lat") : "",
        alt: p.v ? String(p.v.h).replace(".", ",") : "",
        azFmt: segs[i].azimuteFmt,
        distFmt: segs[i].distFmt,
        vante: casados[(i + 1) % casados.length].v?.codigo ?? "",
      }));

      // Aresta de faixa de domínio: a que SAI de um vértice cujo trecho é via.
      // A estrada que separa duas glebas encosta nas duas, e cada uma leva a sua
      // linha dupla — é o que faltava quando a via só era desenhada no perímetro.
      const viasIdx = casados.flatMap((p, i) => (p.v?.trecho.ehVia ? [i] : []));

      return {
        nome,
        areaFmt: fmtBR(areaHa, 4),
        tarefasFmt: fmtBR(areaHa * 10000 / 4356, 2),
        perimetroFmt: fmtBR(calcularPerimetroM(segs), 2),
        identificacao: identificacaoDaGleba(servico, nome),
        vertices,
        viasIdx,
      };
    });
}

/**
 * As linhas do bloco de identificação de uma gleba, no formato da planta de
 * referência: matrícula/CNS (ou POSSE), denominação com o nome da gleba,
 * proprietário e CPF, e o inventariante quando é espólio.
 */
function identificacaoDaGleba(s: ServicoRow, nomeGleba: string): string[] {
  const linhas: string[] = [];
  linhas.push(s.tipo_imovel === "posse" ? "(POSSE)" : `(MATR.${s.matricula ?? ""}/CNS.${s.cns ?? ""})`);
  linhas.push(`${(s.denominacao ?? "").toUpperCase()} - ${nomeGleba}`);
  linhas.push((s.detentor_nome ?? "").toUpperCase());
  if (s.detentor_cpf) linhas.push(`CPF:${s.detentor_cpf}`);
  if (s.is_espolio && s.inventariante_nome) {
    linhas.push(`INVENTARIANTE:${s.inventariante_nome.toUpperCase()}`);
    if (s.inventariante_cpf) linhas.push(`CPF:${s.inventariante_cpf}`);
  }
  return linhas;
}

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
  modalidade?: string | null;
  tem_glebas?: boolean | null;
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
  /** Folha de entrega. Ausente = regra histórica (posse → A3, resto → A1). */
  folha?: Folha;
  /** Prévia de conferência: tira os códigos dos vértices do desenho. */
  conferencia?: boolean;
  /** Campos que a prévia pode omitir. Ausente = a planta sai completa. */
  exibir?: DadosPlanta["exibir"];
  /** Sub-polígonos internos. Ausente/vazio = a planta sai como sempre saiu. */
  glebas?: GlebaPlanta[];
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
    // Repassados só quando existem: `undefined` é o que faz a planta do serviço
    // completo continuar idêntica à de antes destes dois campos existirem.
    folha: ctx.folha,
    conferencia: ctx.conferencia,
    exibir: ctx.exibir,
    glebas: ctx.glebas?.length ? ctx.glebas : undefined,
  };
}

/**
 * `DadosSigef` sintético a partir do cálculo do próprio sistema.
 *
 * Existe para a CONFERÊNCIA DE ÁREA, que precisa do Memorial Tabular (peça 2)
 * mas não tem PDF do SIGEF — a conferência é justamente o que se faz ANTES de
 * mandar ao SIGEF. `LinhaSigef` tem correspondência 1:1 com o que
 * `geometriaDoCalculo` já produz para a planta, então isto é uma tradução, não
 * um segundo gerador: as peças continuam saindo de um caminho só.
 *
 * RESSALVA que precisa acompanhar o documento gerado: azimutes e distâncias aqui
 * vêm de `calcularSegmentos`, no plano re-projetado do sistema — a mesma fonte
 * do Memorial Descritivo que já emitimos. NÃO são os valores SGL que o SIGEF
 * devolve depois de certificar. Por isso o tabular da conferência sai carimbado
 * como prévia, e o fluxo completo continua regerando a partir do PDF.
 */
export function sigefDoCalculo(
  g: GeometriaPlanta,
  ctx: { servico: ServicoRow; rt: RtRow | null; cred: CredRow | null; trt: string; confrontacaoDe: (codigo: string) => string },
): DadosSigef {
  return {
    cabecalho: {
      denominacao: ctx.servico.denominacao ?? "",
      proprietario: ctx.servico.detentor_nome ?? "",
      matricula: ctx.servico.matricula ?? "",
      municipioUf: `${ctx.servico.municipio ?? ""}-${ctx.servico.uf ?? ""}`,
      rtNome: ctx.rt?.nome ?? "",
      formacao: ctx.rt?.formacao ?? "",
      codigoCredenciamento: ctx.cred?.prefixo_vertice ?? "",
      areaHa: g.areaFmt,
      naturezaArea: "",
      cpf: ctx.servico.detentor_cpf ?? "",
      sncr: ctx.servico.codigo_sncr ?? "",
      cns: ctx.servico.cns ?? "",
      cartorioLocal: `${ctx.servico.municipio ?? ""} - ${ctx.servico.uf ?? ""}`,
      conselho: `${ctx.rt?.conselho_numero ?? ""}/${ctx.servico.uf ?? ""}`,
      documentoRt: ctx.trt,
      perimetroM: g.perimetroFmt,
      dataGeracao: null,
    },
    linhas: g.vertices.map((v) => ({
      codigo: v.codigo,
      lon: v.lonFmt,
      lat: v.latFmt,
      alt: v.alt,
      vante: v.vante,
      azimute: v.azFmt,
      dist: v.distFmt,
      confrontacao: ctx.confrontacaoDe(v.codigo),
    })),
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
