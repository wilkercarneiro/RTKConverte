// A análise da área selecionada na Consultar imóvel: o estado de cada fonte, a
// frase do topo ("Nenhuma restrição encontrada · 2 avisos" / "Sobrepõe a Terra
// Indígena X em 3,2 ha"), os dados que vão para o laudo e o resumo que fica no
// histórico. Puro: a tela e os testes usam igual.
import { FONTE_POR_TIPO, minusculas, resumoRestricoes, textoFonte, textoItem } from "../restricoes.ts";
import type { ResultadoRestricoes } from "../restricoes.ts";
import type { FeatureParcela, Sobreposicao } from "../sigef.ts";
import { sobreposicaoPequena } from "../restricoes.ts";
import type { Bioma, Clima, Municipio, Solo } from "./ambiente.ts";
import type { FocosDoImovel } from "./focos.ts";
import { textoFocos } from "./focos.ts";
import { fmtAreaCurta, fmtDist, fmtHa, fmtNum } from "./geometria.ts";
import type { Medidas } from "./geometria.ts";
import type { ImovelEncontrado, Resposta } from "./tipos.ts";

export interface VizinhaSigef { codigo: string; nome: string | null; situacao: string | null; areaHa: number | null; distanciaM: number }

export interface SigefDaArea {
  sobreposicoes: Sobreposicao[];
  /** parcelas certificadas que não sobrepõem, a até `raioM` (confrontantes em potencial), da mais perto */
  vizinhas: VizinhaSigef[];
  raioM: number;
  /** as parcelas para o mapa (não vão para o histórico) */
  parcelas?: FeatureParcela[];
  /** "ok" = INCRA consultado agora; "local" = só a cópia da base do sistema */
  online: "ok" | "local" | "sem-uf";
  detalhe?: string;
}

export interface CarSobreposto {
  codigo: string;
  situacao: string | null;
  municipio: string | null;
  areaDeclaradaHa: number | null;
  areaM2: number;
  pct: number;
  distanciaM: number;
  sobreposta: GeoJSON.MultiPolygon | null;
}

export interface CarDaArea {
  itens: CarSobreposto[];
  /** alguma UF devolveu mais de 50 imóveis: pode haver outros CAR sobre a área */
  cortada: boolean;
  /** UFs que não responderam (área na divisa de estados): "CAR de MG não respondeu" */
  falhas?: string[];
}

export interface Laudo { texto: string; modelo: string | null; quando: string }

export interface Analise {
  /** ISO de quando começou */
  quando: string;
  imovel: ImovelEncontrado;
  medidas: Medidas;
  restricoes: Resposta<ResultadoRestricoes>;
  sigef: Resposta<SigefDaArea>;
  car: Resposta<CarDaArea>;
  focos: Resposta<FocosDoImovel>;
  clima: Resposta<Clima>;
  solo: Resposta<Solo>;
  bioma: Resposta<Bioma>;
  municipio: Resposta<Municipio | null>;
  laudo: Laudo | null;
}

export type ChaveFonte = "restricoes" | "sigef" | "car" | "focos" | "clima" | "solo" | "bioma" | "municipio";
export const CHAVES_FONTES: ChaveFonte[] = ["restricoes", "sigef", "car", "focos", "clima", "solo", "bioma", "municipio"];

/** Nome curto de cada fonte, para "não respondeu" e o laudo. */
export const NOME_FONTE: Record<ChaveFonte, string> = {
  restricoes: "bases de restrição (FUNAI, MMA, INCRA, IBAMA, ICMBio, IBGE, IPHAN)",
  sigef: "SIGEF (INCRA)", car: "CAR (SICAR)", focos: "focos de queimada (INPE)",
  clima: "clima (Open-Meteo)", solo: "solo (SoilGrids)", bioma: "bioma (IBGE)", municipio: "município (IBGE)",
};

export type Tom = "neutro" | "ok" | "aviso" | "alerta" | "perigo";

export interface Frase {
  texto: string;
  tom: Tom;
  /** "consultando 3 fontes…" enquanto falta resposta */
  detalhe: string | null;
  sobreposicoes: string[];
  /** o que a consulta reconheceu sobre a própria área ("é o próprio assentamento PA X") */
  identificacao: string[];
  avisos: string[];
  /** fontes que não responderam (ou responderam incompletas) */
  pendentes: string[];
  carregando: number;
}

/**
 * A restrição é a própria área? CAR de assentamento (AST) sobre o PA, ou de povo
 * tradicional (PCT) sobre o território: identificação, não restrição.
 */
export function ehPropriaArea(im: ImovelEncontrado, tipo: string, pct: number): boolean {
  const t = im.car?.tipo ?? "";
  return pct >= 80 && ((t === "AST" && tipo === "assentamento") || (t === "PCT" && (tipo === "quilombola" || tipo === "ti")));
}

const pronta = <T>(r: Resposta<T>): r is { estado: "ok"; dados: T } => r.estado === "ok";

/** Artigo da frase: "a Terra Indígena", "o Território quilombola". */
const artigo = (singular: string) => (/^(Terra|Unidade|Área|Faixa)/.test(singular) ? "a" : "o");

export function fraseDaAnalise(a: Analise): Frase {
  const carregando = CHAVES_FONTES.filter((k) => a[k].estado === "carregando").length;
  const sobre: { texto: string; area: number; pequena?: boolean; curto?: string }[] = [];
  const identificacao: string[] = [];
  const avisos: string[] = [];
  const pendentes: string[] = [];
  const tipoCar = a.imovel.car?.tipo ?? "";

  if (pronta(a.restricoes)) {
    const r = a.restricoes.dados;
    for (const f of r.fontes) {
      if (f.classe === "nao_consultado") pendentes.push(`${f.singular} (${f.orgao}) não respondeu`);
      if (f.classe === "incompleta") pendentes.push(`${f.singular} (${f.orgao}) com resposta incompleta`);
      for (const it of f.itens) {
        if (it.classe === "sobrepoe") {
          // o CAR de assentamento (AST) sobre o próprio PA, ou de povo tradicional (PCT) sobre o próprio
          // território: é a identificação da área, não restrição
          if (ehPropriaArea(a.imovel, f.tipo, it.pct)) {
            identificacao.push(`É ${artigo(f.singular)} ${minusculas(f.singular)} ${it.nome} (${fmtNum(it.pct, 0)}% da área) — o CAR é ${tipoCar === "AST" ? "de assentamento" : "de povo ou comunidade tradicional"}`);
            continue;
          }
          const quanto = it.pct >= 99.995 ? "no imóvel inteiro" : it.areaM2 > 0 ? `em ${fmtAreaCurta(it.areaM2)}` : "com ponto cadastrado dentro";
          const pequena = sobreposicaoPequena(it);
          if (pequena) avisos.push(`A sobreposição com ${minusculas(f.singular)} ${it.nome} é pequena (${fmtAreaCurta(it.areaM2)}, ${fmtNum(it.pct, 2)}% da área): pode ser só a escala da base pública — confira em campo`);
          sobre.push({ texto: `${artigo(f.singular)} ${minusculas(f.singular)} ${it.nome} ${quanto}`, area: it.areaM2, pequena, curto: `${minusculas(f.singular)} ${it.nome} (${fmtAreaCurta(it.areaM2)}, provável diferença de escala)` });
        } else {
          avisos.push(`Encosta em ${minusculas(f.singular)} ${it.nome} (a ${fmtDist(it.distanciaM)})`);
        }
      }
    }
  } else if (a.restricoes.estado === "falhou") pendentes.push(`${NOME_FONTE.restricoes} não responderam`);

  if (pronta(a.sigef)) {
    for (const s of a.sigef.dados.sobreposicoes.filter((x) => !x.mesma_parcela)) {
      sobre.push({ texto: `a parcela certificada ${s.nome ?? s.codigo.slice(0, 8)} (SIGEF) em ${fmtAreaCurta(s.area_m2)}`, area: s.area_m2 });
    }
    if (a.sigef.dados.online !== "ok" && !a.sigef.dados.sobreposicoes.some((x) => !x.mesma_parcela)) {
      pendentes.push(a.sigef.dados.online === "sem-uf" ? "SIGEF só na base local (falta a UF)" : "SIGEF só na base local (o INCRA não respondeu agora)");
    }
  } else if (a.sigef.estado === "falhou") pendentes.push(`${NOME_FONTE.sigef} não respondeu`);

  if (pronta(a.car)) {
    for (const c of a.car.dados.itens.filter((x) => x.areaM2 > 0)) {
      avisos.push(`Sobrepõe outro CAR declarado (${c.codigo.slice(0, 17)}…) em ${fmtAreaCurta(c.areaM2)}`);
    }
    if (a.car.dados.cortada) pendentes.push("CAR com resposta cortada (mais de 50 imóveis declarados por perto)");
    for (const t of a.car.dados.falhas ?? []) pendentes.push(t);
  } else if (a.car.estado === "falhou") pendentes.push(`${NOME_FONTE.car} não respondeu`);

  if (pronta(a.focos)) {
    const f = a.focos.dados;
    if (f.dentro.length) avisos.push(`${f.dentro.length} ${f.dentro.length === 1 ? "foco de queimada" : "focos de queimada"} dentro do imóvel em 12 meses${f.cortada ? " (pode haver mais)" : ""}`);
    if (f.cortada) pendentes.push("focos de queimada (INPE) com resposta incompleta");
  } else if (a.focos.estado === "falhou") pendentes.push(`${NOME_FONTE.focos} não respondeu`);

  const ordenadas = sobre.sort((x, y) => y.area - x.area);
  const detalhe = carregando ? `consultando ${carregando} ${carregando === 1 ? "fonte" : "fontes"}…` : null;

  let texto: string, tom: Tom;
  if (ordenadas.length && ordenadas.every((x) => x.pequena)) {
    // só sobreposições pequenas em % E em área: provável escala da base, não restrição afirmada
    texto = `Encosta ${ordenadas.length === 1 ? `em ${ordenadas[0].curto}` : `em ${ordenadas.length} áreas, todas com sobreposição pequena (provável diferença de escala)`}`;
    tom = "aviso";
  } else if (ordenadas.length) {
    texto = `Sobrepõe ${ordenadas[0].texto}${ordenadas.length > 1 ? ` e mais ${ordenadas.length - 1} ${ordenadas.length === 2 ? "área" : "áreas"}` : ""}`;
    tom = "perigo";
  } else if (carregando && a.restricoes.estado === "carregando") {
    texto = "Analisando a área…"; tom = "neutro";
  } else if (pendentes.length) {
    texto = "Nenhuma restrição nas bases que responderam"; tom = "alerta";
  } else if (avisos.length) {
    texto = `Nenhuma restrição encontrada · ${avisos.length} ${avisos.length === 1 ? "aviso" : "avisos"}`; tom = "aviso";
  } else {
    texto = "Nenhuma restrição encontrada"; tom = carregando ? "neutro" : "ok";
  }
  return { texto, tom, detalhe, sobreposicoes: ordenadas.map((s) => s.texto), identificacao, avisos, pendentes, carregando };
}

// ---------------------------------------------------------------------------
// Laudo: os fatos, com a fonte de cada um (a IA só vê isto)
// ---------------------------------------------------------------------------

const resp = <T, R>(r: Resposta<T>, f: (d: T) => R): R | { situacao: "não respondeu"; motivo: string } | null =>
  r.estado === "ok" ? f(r.dados) : r.estado === "falhou" ? { situacao: "não respondeu", motivo: r.motivo } : null;

const ROTULO_FONTE: Record<string, string> = { car: "SICAR", sigef: "SIGEF/INCRA", arquivo: "Vertces", desenho: "Vertces", campo: "Vertces" };

export function dadosParaLaudo(a: Analise): Record<string, unknown> {
  const im = a.imovel;
  const f = fraseDaAnalise(a);
  return {
    consulta_em: a.quando,
    leitura_do_sistema: { fonte: "Vertces", frase: f.texto, identificacao: f.identificacao, sobreposicoes: f.sobreposicoes, avisos: f.avisos, sem_resposta: f.pendentes },
    identificacao: {
      fonte: ROTULO_FONTE[im.fonte] ?? "Vertces",
      natureza: im.fonte === "car" ? "CAR — declarado pelo proprietário" : im.fonte === "sigef" ? "SIGEF — parcela certificada pelo INCRA" : im.fonte === "campo" ? "medição de campo com GPS de celular (±3 a 10 m)" : "área enviada/desenhada pelo usuário",
      titulo: im.titulo, codigo: im.codigo, situacao: im.situacao, municipio: im.municipio, uf: im.uf, atualizado_em: im.atualizacao,
      detalhes: im.detalhes,
      area_calculada_ha: fmtNum(a.medidas.areaM2 / 10_000, 4),
      calculo: `UTM SIRGAS 2000, fuso ${a.medidas.fuso}S [Vertces]`,
      area_declarada_ha: im.areaDeclaradaHa != null ? fmtNum(im.areaDeclaradaHa, 4) : null,
      perimetro_m: fmtNum(a.medidas.perimetroM, 1),
      furos_ignorados: im.furos || undefined,
    },
    restricoes: resp(a.restricoes, (r) => ({
      fonte_geral: "bases públicas (alerta, não certidão)",
      resumo: resumoRestricoes(r).texto,
      bases: r.fontes.map((f) => ({
        fonte: FONTE_POR_TIPO[f.tipo]?.orgao ?? f.orgao, tema: f.rotulo, resultado: f.classe, texto: textoFonte(f, r.encostaM),
        itens: f.itens.map((i) => ({ nome: i.nome, texto: textoItem(i), detalhes: i.detalhes })),
      })),
    })),
    sigef: resp(a.sigef, (s) => ({
      fonte: "SIGEF/INCRA",
      consultado_agora: s.online === "ok",
      [`parcelas_certificadas_vizinhas_ate_${s.raioM}m`]: s.vizinhas.map((v) => ({ codigo: v.codigo, nome: v.nome, situacao: v.situacao, distancia_m: Math.round(v.distanciaM) })),
      sobreposicoes: s.sobreposicoes.map((x) => ({
        codigo: x.codigo, nome: x.nome, situacao: x.situacao, area_sobreposta: fmtHa(x.area_m2),
        percentual_do_imovel: `${fmtNum(x.percentual_imovel, 2)}%`, e_o_proprio_imovel: !!x.mesma_parcela,
      })),
    })),
    car_sobre_a_area: resp(a.car, (c) => ({
      fonte: "SICAR", natureza: "declarações de outros imóveis no CAR",
      resposta_cortada: c.cortada,
      sem_resposta: c.falhas?.length ? c.falhas : undefined,
      sobrepostos: c.itens.filter((x) => x.areaM2 > 0).map((x) => ({ codigo: x.codigo, situacao: x.situacao, area_sobreposta: fmtHa(x.areaM2), percentual_do_imovel: `${fmtNum(x.pct, 2)}%` })),
      vizinhos_a_menos_de_100m: c.itens.filter((x) => x.areaM2 === 0).length,
    })),
    focos_de_queimada: resp(a.focos, (f) => ({
      fonte: "INPE", periodo_desde: f.desde, resumo: textoFocos(f),
      resposta_incompleta: f.cortada ? "sim — o INPE tem mais focos na região do que a consulta trouxe; não afirmar que não houve foco dentro" : undefined,
      dentro_todos_os_satelites: f.dentro.length, ate_1km_todos_os_satelites: f.perto.length,
      dentro_satelite_referencia: f.referenciaDentro, ate_1km_satelite_referencia: f.referenciaPerto, ultimo: f.ultimo,
    })),
    clima: resp(a.clima, (c) => ({
      fonte: "Open-Meteo", natureza: "reanálise ERA5 (não é estação)", de: c.de, ate: c.ate,
      chuva_12_meses_mm: c.chuva12mMm, chuva_30_dias_mm: c.chuva30dMm, temperatura_media_c: c.tempMediaC,
      mes_mais_chuvoso: c.maisChuvoso, mes_mais_seco: c.maisSeco, altitude_modelo_m: c.altitudeM,
    })),
    solo: resp(a.solo, (s) => ({ fonte: "SoilGrids", natureza: "modelo global de 250 m (estimativa)", wrb: s.wrb, classe_brasileira_aproximada: s.nome, probabilidade_pct: s.probabilidade, explicacao: s.explicacao })),
    bioma: resp(a.bioma, (b) => ({ fonte: "IBGE", bioma: b.bioma, amazonia_legal: b.amazoniaLegal, reserva_legal_referencia: b.reservaLegal })),
    municipio: resp(a.municipio, (m) => (m ? { fonte: "IBGE", nome: m.nome, uf: m.uf, regiao_imediata: m.regiaoImediata } : null)),
  };
}

// ---------------------------------------------------------------------------
// Histórico: o que fica gravado (sem as geometrias grandes das bases)
// ---------------------------------------------------------------------------

/** A análise para gravar: tira a geometria das áreas das bases (fica só o pedaço dentro do imóvel). */
export function compactarAnalise(a: Analise): Analise {
  const r = a.restricoes.estado === "ok"
    ? { ...a.restricoes, dados: { ...a.restricoes.dados, fontes: a.restricoes.dados.fontes.map((f) => ({ ...f, itens: f.itens.map((i) => ({ ...i, geometria: null })) })) } }
    : a.restricoes;
  const s = a.sigef.estado === "ok"
    ? { ...a.sigef, dados: { ...a.sigef.dados, parcelas: undefined, sobreposicoes: a.sigef.dados.sobreposicoes.map((x) => ({ ...x, geometria: { type: "MultiPolygon", coordinates: [] } as GeoJSON.MultiPolygon })) } }
    : a.sigef;
  // a área: a geometria vai na coluna própria; aqui só os metadados
  const im = { ...a.imovel, poligonos: [], aneis: [] };
  const fechar = <T>(x: Resposta<T>): Resposta<T> => (x.estado === "carregando" ? { estado: "falhou", motivo: "a consulta foi interrompida" } : x);
  return {
    ...a, imovel: im, restricoes: fechar(r), sigef: fechar(s), car: fechar(a.car), focos: fechar(a.focos),
    clima: fechar(a.clima), solo: fechar(a.solo), bioma: fechar(a.bioma), municipio: fechar(a.municipio),
  };
}

/** O que vai para analises_imovel.resultado: a análise compacta (para reabrir) + `para_laudo`, os
 *  fatos com a fonte e a natureza de cada um (dadosParaLaudo). A função analise-imovel manda à IA
 *  SÓ o `para_laudo` — nada de geometria nem lista de focos. */
export type AnaliseGravada = Analise & { para_laudo: Record<string, unknown> };

export function resultadoParaGravar(a: Analise): AnaliseGravada {
  const c = compactarAnalise(a);
  const { para_laudo: _velho, ...resto } = c as AnaliseGravada;
  return { ...resto, para_laudo: dadosParaLaudo(c) };
}

/** Todas as fontes já responderam (ou falharam)? */
export const analiseCompleta = (a: Analise): boolean => CHAVES_FONTES.every((k) => a[k].estado !== "carregando");

export function analiseVazia(imovel: ImovelEncontrado, medidas: Medidas, agora = new Date()): Analise {
  const c = { estado: "carregando" as const };
  return { quando: agora.toISOString(), imovel, medidas, restricoes: c, sigef: c, car: c, focos: c, clima: c, solo: c, bioma: c, municipio: c, laudo: null };
}
