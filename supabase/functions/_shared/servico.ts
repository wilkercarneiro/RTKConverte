// Montagem do serviço: aplica o pipeline geodésico à sequência de vértices,
// aloca códigos, associa trechos de confrontantes e produz as estruturas
// prontas para o memorial (DOCX) e a planilha (ODS).
import {
  alocarCodigos, calcularAreaHa, calcularPerimetroM, calcularSegmentos,
  calcularVertices, ehSentidoHorario, fmtGmsPlanilha, ordemMaisAoNorte, parseGmsPlanilha,
  rotacionarRing,
} from "./geo.ts";
import type { EntradaVertice, EstiloCodigo, Proj4, Segmento, VerticeCalc } from "./geo.ts";
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
  // Confrontação: preenchida SÓ quando tipo === "M". O trecho vai deste M até o
  // próximo M do anel. Ver ARQUITETURA-TRECHOS.md.
  descritivo?: string | null;
  tipoLimite?: string | null;
  ehVia?: boolean | null;        // faixa de domínio pública (estrada, rio, corredor)
  cns?: string | null;
  matricula?: string | null;
  /** Sai numerado na planta (ver TrechoServico.numerado). */
  numerado?: boolean | null;
}

export interface TrechoServico {
  verticeInicioOrdem: number;
  descritivo: string;
  tipoLimite: string;
  ehVia: boolean;
  /** LN1: curso d'água — linha dupla AZUL na planta, no lugar da vermelha. */
  ehRio: boolean;
  /**
   * Confrontante NUMERADO: na planta sai só o número no meio da divisa, e o
   * texto vai ao quadro CONFRONTANTES do rodapé. É a saída para divisa curta,
   * onde o bloco de nome não cabe no vão do vizinho e acaba empilhado sobre o
   * do vizinho seguinte. Ver PLANO-CONFRONTANTES-NUMERADOS.md.
   */
  numerado: boolean;
  cns?: string | null;
  matricula?: string | null;
}

export interface ServicoInput {
  fusoUtm: number;
  /** @deprecated ignorado: o SIGEF exige que a sequência comece no vértice mais ao norte. */
  verticeInicialOrdem?: number;
  prefixo: string;
  contadores: { M: number; P: number; V: number };
  /**
   * Formato do código alocado. Ausente = "oficial" (`DSBN-P-14300`), o de sempre.
   * "conferencia" numera a prévia como `P-1`, `P-2` — sem prefixo de credenciado,
   * porque a prévia não reserva numeração e não pode passar por definitiva.
   */
  estiloCodigo?: EstiloCodigo;
  vertices: VerticeServico[];    // em ordem de perímetro; os M carregam a confrontação
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

/**
 * Inverte o sentido de percurso do anel levando a confrontação junto.
 *
 * A invariante é "o trecho de um M vai até o próximo M" (ARQUITETURA-TRECHOS.md).
 * Invertendo o percurso, o mesmo pedaço físico de divisa passa a ser percorrido a
 * partir do outro extremo: o que ia de M_a a M_b agora vai de M_b a M_a. A
 * confrontação, portanto, tem de andar um M na nova sequência — sem isso cada
 * confrontante sairia descrito na divisa do vizinho, que é exatamente o defeito
 * que a arquitetura de trechos existe para evitar.
 *
 * Quais vértices são M não muda: os cantos onde o confrontante troca são os mesmos
 * pontos, ande-se o perímetro para um lado ou para o outro. Só muda qual deles
 * abre cada trecho.
 */
function inverterSentido<T extends { tipo: "M" | "P" | "V"; conf: VerticeServico }>(vs: T[]): T[] {
  const invertido = vs.slice().reverse();
  const idxM: number[] = [];
  invertido.forEach((v, i) => { if (v.tipo === "M") idxM.push(i); });
  const out = invertido.slice();
  for (let k = 0; k < idxM.length; k++) {
    // o M na posição k assume a confrontação do M seguinte (dando a volta no anel)
    out[idxM[k]] = { ...invertido[idxM[k]], conf: invertido[idxM[(k + 1) % idxM.length]].conf };
  }
  return out;
}

export function montarServico(inp: ServicoInput, proj4: Proj4): ServicoCalculado {
  const entradas: EntradaVertice[] = inp.vertices.map((v) => ({
    numTxt: v.numTxt,
    e: v.e ?? undefined,
    n: v.n ?? undefined,
    latGms: v.latGmsStr ? parseGmsPlanilha(v.latGmsStr) : undefined,
    lonGms: v.lonGmsStr ? parseGmsPlanilha(v.lonGmsStr) : undefined,
    h: v.h, sigmaPos: v.sigmaPos, sigmaH: v.sigmaH, inserido: v.inserido,
  }));
  const calc = calcularVertices(entradas, inp.fusoUtm, proj4);

  // O SIGEF exige que a listagem do perímetro comece pelo vértice mais ao norte;
  // isso vale para a planilha ODS e, por coerência, para memorial e planta, que
  // saem todos deste mesmo anel.
  const ordemInicial = ordemMaisAoNorte(calc);

  // ring no sentido horário, rotacionado a partir do vértice inicial
  const juntos = calc.map((c, i) => ({ ...c, tipo: inp.vertices[i].tipo, metodo: inp.vertices[i].metodo, codigoManual: inp.vertices[i].codigoManual ?? null, conf: inp.vertices[i] }));
  // O SIGEF exige o perímetro descrito no sentido horário. O TXT do levantamento
  // vem em qualquer sentido, então normalizamos aqui — antes de alocar códigos,
  // para que a numeração acompanhe a sequência que vai ser publicada.
  const anel = ehSentidoHorario(juntos) ? juntos : inverterSentido(juntos);
  const ring0 = rotacionarRing(anel, ordemInicial);

  // códigos alocados na ordem do memorial
  const codigos = alocarCodigos(ring0, inp.prefixo, inp.contadores, inp.estiloCodigo ?? "oficial");
  const consumo = { M: 0, P: 0, V: 0 };
  for (const v of ring0) if (!v.codigoManual) consumo[v.tipo]++;

  // Um vértice M inicia uma confrontação, que vai até o próximo M. Os trechos são
  // DERIVADOS do anel, nunca armazenados — não há âncora posicional para desalinhar,
  // que era a causa da estrada desenhada em trecho errado. Ver ARQUITETURA-TRECHOS.md.
  let trechosOrdenados: TrechoServico[] = ring0
    .filter((v) => v.tipo === "M")
    .map((v) => ({
      verticeInicioOrdem: v.ordem,
      descritivo: v.conf.descritivo ?? "",
      tipoLimite: v.conf.tipoLimite ?? "LA1",
      // LA3 é o limite artificial de faixa de domínio: vale como via sozinho,
      // sem depender da marca nem do rótulo. Mesma regra das peças (pecas.ts).
      ehVia: (v.conf.ehVia ?? false) || ehViaPorLimite(v.conf.tipoLimite),
      // LN1 é o limite natural de curso d'água: vale como rio sozinho, do mesmo
      // jeito. Não mexe em ehVia — o memorial e as declarações continuam
      // tratando o rio como faixa de domínio pública; o que muda é a COR do
      // traço na planta (ver ehRioPorLimite).
      ehRio: ehRioPorLimite(v.conf.tipoLimite),
      numerado: v.conf.numerado ?? false,
      cns: v.conf.cns ?? null,
      matricula: v.conf.matricula ?? null,
    }));
  // Confrontantes são opcionais: sem nenhum M, todo o perímetro pertence a um
  // trecho sintético vazio (LA1, sem descritivo).
  if (trechosOrdenados.length === 0) {
    trechosOrdenados = [{ verticeInicioOrdem: ordemInicial, descritivo: "", tipoLimite: "LA1", ehVia: false, ehRio: false, numerado: false }];
  }

  const inicioPorOrdem = new Map<number, TrechoServico>(trechosOrdenados.map((t) => [t.verticeInicioOrdem, t]));
  // se nenhum trecho inicia exatamente no vértice inicial, o começo do anel
  // pertence ao último trecho (continuação, dando a volta no perímetro)
  let trechoAtual = trechosOrdenados[trechosOrdenados.length - 1];
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

/** O serviço dividido em PARTES: cada uma é um anel completo, calculado por si. */
export interface ServicoEmPartes {
  partes: { nome: string; calc: ServicoCalculado }[];
  areaHa: number;
  perimetroM: number;
  contadoresFinais: { M: number; P: number; V: number };
}

/**
 * Um imóvel cortado por estradas (ou levantado em glebas fechadas) chega como
 * VÁRIOS anéis no mesmo TXT — a FAZ COIXO tem três, numerados 1–75, 100–123 e
 * 200–228. Costurar tudo num anel só produz um perímetro que cruza a si mesmo e
 * erra área, vértice inicial, trechos e códigos.
 *
 * Aqui cada parte passa pelo MESMO pipeline do anel único (`montarServico`):
 * início no vértice mais ao norte DA PARTE, sentido horário, trecho de M até o
 * próximo M dentro da parte, códigos em sequência — a parte 2 continua a
 * numeração onde a parte 1 parou. `ordens[i]` são as ordens (da tabela
 * `vertices`) que compõem a parte i, na sequência do anel dela.
 */
export function montarPartes(
  inp: ServicoInput,
  partes: { nome: string; ordens: number[] }[],
  proj4: Proj4,
): ServicoEmPartes {
  const porOrdem = new Map(inp.vertices.map((v) => [v.ordem, v]));
  let contadores = { ...inp.contadores };
  const out: { nome: string; calc: ServicoCalculado }[] = [];
  for (const p of partes) {
    const vertices = p.ordens.map((o) => porOrdem.get(o)).filter((v): v is VerticeServico => !!v);
    if (vertices.length < 3) throw new Error(`Parte "${p.nome}" tem menos de 3 vértices`);
    const calc = montarServico({ ...inp, contadores, vertices }, proj4);
    contadores = calc.contadoresFinais;
    out.push({ nome: p.nome, calc });
  }
  return {
    partes: out,
    areaHa: out.reduce((s, p) => s + p.calc.areaHa, 0),
    perimetroM: Math.round(out.reduce((s, p) => s + p.calc.perimetroM, 0) * 100) / 100,
    contadoresFinais: contadores,
  };
}

/**
 * Confere a invariante "confrontação só no vértice M" sobre as linhas cruas do
 * banco. Cita sempre o CÓDIGO: o usuário raciocina em "DSBN-M-3704", nunca em
 * "ordem 2". Ver ARQUITETURA-TRECHOS.md.
 *
 * Só é ERRO o que indica corrupção estrutural — dado de confrontação preso a um
 * vértice que não é M. Pela tela isso é impossível; sobra como defesa contra
 * dados legados e escrita direta no banco. Descritivo vazio NÃO é erro: o
 * memorial cai no apelido, e sem os dois segue sem cláusula de confrontação,
 * comportamento suportado desde sempre — por isso vira aviso.
 */
export function validarConfrontacoes(
  vertices: { tipo: string; codigo?: string | null; descritivo?: string | null; apelido_txt?: string | null }[],
): { erros: string[]; avisos: string[] } {
  const erros: string[] = [];
  const avisos: string[] = [];
  const nome = (v: { codigo?: string | null }) => v.codigo || "(vértice sem código)";
  for (const v of vertices) {
    const desc = (v.descritivo ?? "").trim();
    const apelido = (v.apelido_txt ?? "").trim();
    if (v.tipo !== "M") {
      if (desc) erros.push(`${nome(v)} não é vértice M mas carrega confrontante "${desc.split("\\")[0]}".`);
      continue;
    }
    if (!desc && !apelido) {
      avisos.push(`${nome(v)} inicia uma confrontação sem confrontante nem apelido — o memorial seguirá sem a cláusula de confrontação nesse trecho.`);
    } else if (desc && !/CPF/i.test(desc)) {
      avisos.push(`Confrontante de ${nome(v)} ("${desc.split("\\")[0].trim()}") está sem CPF. Se for estrada, rio ou corredor, marque "faixa de domínio pública".`);
    }
  }
  if (!vertices.some((v) => v.tipo === "M")) {
    avisos.push("O perímetro não tem nenhum vértice M — nenhuma confrontação será descrita.");
  }
  return { erros, avisos };
}

/**
 * Apelidos do TXT que indicam faixa de domínio pública.
 *
 * Isto é uma SUGESTÃO da importação, que aparece no checkbox da tela e na linha
 * dupla do preview antes de virar PDF. É diferente da heurística que foi removida:
 * aquela decidia no momento de DESENHAR, sem o usuário ver nem poder discordar.
 * LAGOA fica de fora de propósito — é nome comum de fazenda na região.
 */
/** LA3 = limite artificial de faixa de domínio: é sempre via. */
export const ehViaPorLimite = (tipoLimite?: string | null): boolean =>
  /^LA3\b/i.test((tipoLimite ?? "").trim());

/**
 * LN1 = limite natural de curso d'água: é sempre RIO.
 *
 * Espelho exato do LA3. Assim como todo trecho LA3 sai na planta com a linha
 * dupla VERMELHA da faixa de domínio — tenha o rótulo que tiver —, todo trecho
 * LN1 sai com a linha dupla AZUL do curso d'água, tenha ele o nome que tiver
 * ("RIO ITAPICURU", "CÓRREGO SECO", o nome da bacia ou nada disso). Vale
 * sozinho, sem depender da marca de faixa de domínio nem do texto.
 *
 * Rio VENCE estrada: um trecho LN1 nunca sai vermelho, mesmo que o rótulo
 * ("RIO ...") case com RE_VIA ou que o operador tenha marcado o checkbox de
 * faixa de domínio. As duas linhas juntas na mesma divisa diriam que ali há
 * uma estrada E um rio.
 */
export const ehRioPorLimite = (tipoLimite?: string | null): boolean =>
  /^LN1\b/i.test((tipoLimite ?? "").trim());

const RE_VIA_APELIDO =
  /\b(ESTRADA|RODOVIA|CORREDOR|SERVID[ÃA]O|LINHA\s+F[ÉE]RREA|FERROVIA|FERROVI[ÁA]RI[AO]|LEITO\s+FERROVI[ÁA]RIO|RIO|RIACHO|C[ÓO]RREGO|A[ÇC]UDE|FAIXA\s+DE\s+DOM[ÍI]NIO|(?:BR|BA|AL|SE|PE|PB|RN|CE|PI|MA|TO|GO|MG|ES|RJ|SP|PR|SC|RS|MS|MT|DF|RO|AC|AM|RR|PA|AP)[-\s]?\d{2,3})\b/i;

// Sugestões pós-parse: tipos (M nos inícios de trecho, P nos demais) e trechos
// derivados dos rótulos do TXT (apelido = parte após "/").
export function sugerirTrechos(pontos: { num: number; rotulo: string | null }[]): { verticeInicioOrdem: number; apelido: string; ehVia: boolean }[] {
  const out: { verticeInicioOrdem: number; apelido: string; ehVia: boolean }[] = [];
  pontos.forEach((p, i) => {
    if (p.rotulo) {
      const partes = p.rotulo.split("/");
      const apelido = (partes[1] ?? partes[0]).trim();
      out.push({ verticeInicioOrdem: i, apelido, ehVia: RE_VIA_APELIDO.test(apelido) });
    }
  });
  return out;
}
