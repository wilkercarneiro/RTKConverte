// Do conjunto de pontos lidos ao anel do perímetro:
// 1. apoio (base/referência) e a versão de pontos que não foi escolhida
//    (versoes.ts) ficam fora;
// 2. repetidos: mesmo nome e mesma posição → a cópia sai; mesmo nome em lugares
//    diferentes → bloqueio (o operador escolhe);
// 3. ordem: candidatos "id" (número, com blocos por centena = partes) e
//    "arquivo"; vence o que NÃO cruza o desenho. Empate → id (o de sempre).
import type { Aviso, LinhaIgnorada, PontoLido } from "./executor.ts";

type XY = { e: number; n: number };

function orient(a: XY, b: XY, c: XY): number {
  return (b.e - a.e) * (c.n - a.n) - (b.n - a.n) * (c.e - a.e);
}
function cruzaSeg(a: XY, b: XY, c: XY, d: XY): boolean {
  const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Pares de lados (i, j) que se cruzam num anel fechado. */
export function cruzamentos(anel: XY[]): [number, number][] {
  const n = anel.length, out: [number, number][] = [];
  if (n < 4) return out;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (cruzaSeg(anel[i], anel[(i + 1) % n], anel[j], anel[(j + 1) % n])) out.push([i, j]);
    }
  }
  return out;
}

export function perimetro(anel: XY[]): number {
  let s = 0;
  for (let i = 0; i < anel.length; i++) s += Math.hypot(anel[(i + 1) % anel.length].e - anel[i].e, anel[(i + 1) % anel.length].n - anel[i].n);
  return s;
}

/** Mesma sequência cíclica (girada e/ou invertida)? */
export function mesmoCiclo(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  if (!a.length) return true;
  for (const seq of [b, [...b].reverse()]) {
    const ini = seq.indexOf(a[0]);
    if (ini >= 0 && a.every((x, i) => x === seq[(ini + i) % seq.length])) return true;
  }
  return false;
}

export function areaM2(anel: XY[]): number {
  let s = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    s += a.e * b.n - b.e * a.n;
  }
  return Math.abs(s) / 2;
}

/**
 * Blocos de numeração por centena (1–75, 100–123, 200–228): cada bloco é uma
 * parte do imóvel. Mesma regra de `blocosPorNumeracao` (certificados.ts); um
 * número sintético nunca abre bloco.
 */
export function blocosPorCentena(nums: { num: number; sintetico: boolean }[]): number[][] {
  const blocos: number[][] = [];
  nums.forEach((p, i) => {
    const ult = blocos[blocos.length - 1];
    const abre = !ult || (!p.sintetico && p.num % 100 === 0 && p.num - nums[ult[ult.length - 1]].num > 1 && ult.length >= 3);
    if (abre) blocos.push([i]); else ult.push(i);
  });
  if (blocos.length > 1 && blocos[blocos.length - 1].length < 3) {
    const curto = blocos.pop()!;
    blocos[blocos.length - 1].push(...curto);
  }
  return blocos;
}

export interface CandidatoOrdem {
  criterio: "id" | "arquivo" | "ligacao";
  /** Índices (em `pontos`) na ordem do anel. */
  anel: number[];
  /** Posições no anel de cada parte. */
  blocos: number[][];
  /** Por bloco: pares de nomes cujos lados se cruzam. */
  cruzamentos: [string, string][][];
  simples: boolean;
}

/** Cada parte por centena é numeração contínua (saltos de no máximo 5)? */
function blocosContinuos(c: CandidatoOrdem, numeros: Map<number, { num: number }>): boolean {
  return c.blocos.every((b) => b.length >= 3 && b.every((pos, k) => k === 0 || numeros.get(c.anel[pos])!.num - numeros.get(c.anel[b[k - 1]])!.num <= 5));
}

export interface ResultadoOrdem {
  /** Pontos do perímetro, na ordem escolhida (índices em `pontos`). */
  anel: number[];
  blocos: number[][];
  /** "ligacao" = a sequência que o operador ligou à mão na prévia. */
  criterio: "id" | "arquivo" | "ligacao";
  candidatos: CandidatoOrdem[];
  /** Número final de cada ponto do anel (sintético quando o nome não é número). */
  numeros: Map<number, { num: number; sintetico: boolean }>;
  ignoradas: LinhaIgnorada[];
  avisos: Aviso[];
}

const POS_IGUAL_M = 0.02;

function candidato(criterio: "id" | "arquivo", ordemIdx: number[], pontos: PontoLido[], numeros: ResultadoOrdem["numeros"], porBloco: boolean): CandidatoOrdem {
  const blocos = porBloco
    ? blocosPorCentena(ordemIdx.map((i) => numeros.get(i)!))
    : [ordemIdx.map((_, k) => k)];
  const cr = blocos.map((b) => {
    const pts = b.map((k) => pontos[ordemIdx[k]]);
    const lado = (i: number) => `${pts[i].nome || "?"}–${pts[(i + 1) % pts.length].nome || "?"}`;
    return cruzamentos(pts).map(([i, j]) => [lado(i), lado(j)] as [string, string]);
  });
  return { criterio, anel: ordemIdx, blocos, cruzamentos: cr, simples: cr.every((x) => x.length === 0) };
}

/** Ajustes de pontos feitos à mão na prévia (além das exclusões). */
export interface AjustesAnel {
  /** Linhas de pontos inativos (apoio, outra versão) que o operador ATIVOU. */
  incluir?: Set<number>;
  /** Ligação manual: cada parte é a sequência de pontos (`idx`) na ordem do
   *  perímetro. Ponto ativo fora dela não entra; null = ordem automática. */
  ligacao?: number[][] | null;
}

/**
 * Monta o anel. `ordemPedida`: "auto" escolhe pela geometria; "id"/"arquivo"
 * obedecem (com aviso se o desenho cruzar). `excluir`: linhas que o operador
 * tirou na prévia. `ajustes.ligacao` (quando há) manda na ordem e nas partes.
 */
export function montarAnel(pontos: PontoLido[], ordemPedida: "auto" | "id" | "arquivo", excluir: Set<number> = new Set(), ajustes: AjustesAnel = {}): ResultadoOrdem {
  const ignoradas: LinhaIgnorada[] = [];
  const avisos: Aviso[] = [];
  const incluir = ajustes.incluir ?? new Set<number>();

  // ---- exclusões da tela e apoio ----
  const ativos: number[] = [];
  const apoio: PontoLido[] = [];
  for (const p of pontos) {
    if (excluir.has(p.linha)) { ignoradas.push({ linha: p.linha, texto: p.nome, motivo: "excluído na prévia pelo operador", tipo: "excluido" }); continue; }
    // ponto inativo que o operador ativou na prévia: entra como qualquer outro
    if (incluir.has(p.linha) && (p.apoio || p.foraDaVersao)) { ativos.push(p.idx); continue; }
    if (p.apoio) { apoio.push(p); continue; }
    // outra versão do mesmo ponto (versoes.ts): só uma versão entra no anel
    if (p.foraDaVersao) { ignoradas.push({ linha: p.linha, texto: p.nome, motivo: `outra versão do mesmo ponto (${p.nome}): fora do perímetro`, tipo: "versao" }); continue; }
    ativos.push(p.idx);
  }
  if (apoio.length) {
    avisos.push({
      codigo: "apoio_fora", nivel: "alerta",
      mensagem: `Ponto${apoio.length > 1 ? "s" : ""} de apoio (base/referência) fora do perímetro: ${apoio.map((p) => p.nome).join(", ")}.`,
      linhas: apoio.map((p) => p.linha),
    });
  }

  // ---- repetidos ----
  const porNome = new Map<string, number>();
  const unicos: number[] = [];
  const conflitos: number[] = [];
  for (const i of ativos) {
    const p = pontos[i];
    // sem nome (RTKLIB, polígono de KML/DXF): cada ponto é ele mesmo
    const chave = p.num !== null ? `#${p.num}` : p.nome ? `n:${p.nome}` : `i:${p.idx}`;
    const ant = porNome.get(chave);
    if (ant === undefined) { porNome.set(chave, i); unicos.push(i); continue; }
    const q = pontos[ant];
    if (Math.hypot(p.e - q.e, p.n - q.n) <= POS_IGUAL_M) {
      ignoradas.push({ linha: p.linha, texto: p.nome, motivo: `ponto ${p.nome} repetido (mesma posição da linha ${q.linha})`, tipo: "repetido" });
    } else {
      conflitos.push(q.linha, p.linha);
    }
  }
  if (conflitos.length) {
    avisos.push({
      codigo: "nome_repetido", nivel: "bloqueio",
      mensagem: "O mesmo ponto aparece mais de uma vez com coordenadas diferentes. Exclua na prévia a medição que não vale.",
      linhas: [...new Set(conflitos)].sort((a, b) => a - b),
    });
  }
  // mesma posição com nomes diferentes: aviso (pode ser ponto medido duas vezes)
  for (let a = 0; a < unicos.length; a++) {
    for (let b = a + 1; b < unicos.length; b++) {
      const p = pontos[unicos[a]], q = pontos[unicos[b]];
      if (Math.hypot(p.e - q.e, p.n - q.n) <= POS_IGUAL_M) {
        avisos.push({ codigo: "mesma_posicao", nivel: "alerta", mensagem: `Os pontos ${p.nome} e ${q.nome} estão na mesma posição (menos de 2 cm).`, linhas: [p.linha, q.linha] });
      }
    }
  }

  // ---- números (sintéticos para nomes não numéricos) ----
  const numeros: ResultadoOrdem["numeros"] = new Map();
  const reais = unicos.filter((i) => pontos[i].num !== null);
  let prox = reais.reduce((m, i) => Math.max(m, pontos[i].num!), 0) + 1;
  for (const i of unicos) {
    const p = pontos[i];
    numeros.set(i, p.num !== null ? { num: p.num, sintetico: false } : { num: prox++, sintetico: true });
  }

  // ---- candidatos ----
  const porArquivo = [...unicos];
  const temSintetico = unicos.some((i) => numeros.get(i)!.sintetico);
  // com nome não numérico a "ordem do número" não existe: só a do arquivo
  const porId = temSintetico ? porArquivo : [...unicos].sort((a, b) => numeros.get(a)!.num - numeros.get(b)!.num);
  const cId = temSintetico ? candidato("arquivo", porArquivo, pontos, numeros, false) : candidato("id", porId, pontos, numeros, true);
  const cArq = candidato("arquivo", porArquivo, pontos, numeros, false);
  // a mesma sequência girada ou ao contrário é o MESMO polígono
  const iguais = temSintetico || porId.every((v, k) => v === porArquivo[k])
    || (cId.blocos.length === 1 && mesmoCiclo(porId, porArquivo));
  const candidatos = iguais ? [cId] : [cId, cArq];

  // ---- ligação feita à mão na prévia: manda na ordem e nas partes ----
  const ligada = ligacaoManual(ajustes.ligacao, unicos, pontos);
  if (ligada) {
    for (const i of ligada.fora) {
      const p = pontos[i];
      ignoradas.push({ linha: p.linha, texto: p.nome, motivo: `ponto ${p.nome} ficou fora da ligação feita na prévia`, tipo: "ligacao" });
    }
    if (ligada.fora.length) {
      const nomes = ligada.fora.map((i) => pontos[i].nome || `linha ${pontos[i].linha}`);
      avisos.push({
        codigo: "fora_da_ligacao", nivel: "alerta",
        mensagem: `${ligada.fora.length === 1 ? "1 ponto ativo ficou" : `${ligada.fora.length} pontos ativos ficaram`} fora da ligação e não ${ligada.fora.length === 1 ? "entra" : "entram"} no perímetro: ${nomes.slice(0, 12).join(", ")}${nomes.length > 12 ? "…" : ""}.`,
        linhas: ligada.fora.map((i) => pontos[i].linha),
      });
    }
    const curtas = ligada.c.blocos.filter((b) => b.length < 3).length;
    if (curtas) {
      avisos.push({ codigo: "parte_curta", nivel: "bloqueio", mensagem: `${curtas === 1 ? "Uma parte da ligação tem" : `${curtas} partes da ligação têm`} menos de 3 pontos: ligue ao menos 3 pontos em cada parte.` });
    }
    return finalizar(ligada.c, unicos, pontos, numeros, candidatos, ignoradas, avisos);
  }

  let escolhido: CandidatoOrdem;
  if (ordemPedida === "id" && !temSintetico) escolhido = cId;
  else if (ordemPedida === "arquivo") escolhido = cArq;
  else if (iguais) escolhido = cId;
  else if (cId.simples && cArq.simples) {
    // duas leituras válidas e diferentes: o perímetro verdadeiro é o "natural",
    // sem pontas — o de menor perímetro (conferido contra as correções da equipe)
    if (cId.blocos.length > 1 && blocosContinuos(cId, numeros)) {
      // partes de verdade (1–117 e 200–217, IBERA; 1–75/100–123/200–228, RUY):
      // cada parte é uma sequência contínua — fica como sempre foi
      escolhido = cId;
    } else if (cId.blocos.length > 1) {
      escolhido = cArq;
      avisos.push({
        codigo: "ordem_ambigua", nivel: "alerta",
        mensagem: `Pela numeração seriam ${cId.blocos.length} partes separadas; na ordem do arquivo os pontos formam um perímetro só, sem cruzar. Foi usada a ordem do arquivo — confira no mapa.`,
      });
    } else {
      const pId = perimetro(cId.anel.map((i) => pontos[i])), pArq = perimetro(cArq.anel.map((i) => pontos[i]));
      escolhido = pArq < pId ? cArq : cId;
      avisos.push({
        codigo: "ordem_ambigua", nivel: "alerta",
        mensagem: `A ordem da numeração e a ordem do arquivo formam perímetros diferentes, ambos sem cruzar. Foi usada a de menor perímetro (${escolhido === cArq ? "arquivo" : "numeração"}: ${Math.round(Math.min(pId, pArq))} m contra ${Math.round(Math.max(pId, pArq))} m) — confira no mapa.`,
      });
    }
  } else if (cId.simples) escolhido = cId;
  else if (cArq.simples) {
    escolhido = cArq;
    avisos.push({
      codigo: "ordem_do_arquivo", nivel: "alerta",
      mensagem: "Pela numeração, o desenho se cruzava; a ordem em que os pontos estão no arquivo forma o perímetro sem cruzar, e foi a usada.",
    });
  } else escolhido = cId;
  return finalizar(escolhido, unicos, pontos, numeros, candidatos, ignoradas, avisos);
}

/**
 * A ligação pedida, limpa: só pontos ativos e únicos (repetido, excluído ou
 * desconhecido sai), cada ponto uma vez só. Null = sem ligação manual.
 */
function ligacaoManual(pedida: number[][] | null | undefined, unicos: number[], pontos: PontoLido[]): { c: CandidatoOrdem; fora: number[] } | null {
  if (!Array.isArray(pedida) || !pedida.length) return null;
  const validos = new Set(unicos);
  const vistos = new Set<number>();
  const partes: number[][] = [];
  for (const parte of pedida) {
    if (!Array.isArray(parte)) continue;
    const limpa: number[] = [];
    for (const i of parte) {
      if (!Number.isInteger(i) || !validos.has(i) || vistos.has(i)) continue;
      vistos.add(i);
      limpa.push(i);
    }
    if (limpa.length) partes.push(limpa);
  }
  if (!partes.length) return null;
  const anel = partes.flat();
  let pos = 0;
  const blocos = partes.map((p) => p.map(() => pos++));
  const cr = blocos.map((b) => {
    const pts = b.map((k) => pontos[anel[k]]);
    const lado = (i: number) => `${pts[i].nome || "?"}–${pts[(i + 1) % pts.length].nome || "?"}`;
    return cruzamentos(pts).map(([i, j]) => [lado(i), lado(j)] as [string, string]);
  });
  return {
    c: { criterio: "ligacao", anel, blocos, cruzamentos: cr, simples: cr.every((x) => x.length === 0) },
    fora: unicos.filter((i) => !vistos.has(i)),
  };
}

/** Avisos do desenho escolhido (poucos pontos, cruzamento, área zero, nomes) e o resultado. */
function finalizar(escolhido: CandidatoOrdem, unicos: number[], pontos: PontoLido[], numeros: ResultadoOrdem["numeros"], candidatos: CandidatoOrdem[], ignoradas: LinhaIgnorada[], avisos: Aviso[]): ResultadoOrdem {
  if (unicos.length < 3) {
    avisos.push({ codigo: "poucos_pontos", nivel: "bloqueio", mensagem: `O perímetro precisa de pelo menos 3 pontos (lidos: ${unicos.length}).` });
  }
  escolhido.blocos.forEach((b, k) => {
    const cr = escolhido.cruzamentos[k];
    if (cr.length) {
      avisos.push({
        codigo: "desenho_cruza", nivel: "alerta",
        mensagem: `O desenho${escolhido.blocos.length > 1 ? ` da parte ${k + 1}` : ""} se cruza: o lado ${cr.slice(0, 3).map(([a, c]) => `${a} corta o lado ${c}`).join("; o lado ")}${cr.length > 3 ? ` (e mais ${cr.length - 3})` : ""}. Pode haver ponto de dentro do imóvel ou fora de ordem: exclua ou ajuste antes de seguir.`,
        linhas: b.map((pos) => pontos[escolhido.anel[pos]].linha),
      });
    }
    const pts = b.map((pos) => pontos[escolhido.anel[pos]]);
    if (pts.length >= 3 && areaM2(pts) < 1) {
      avisos.push({ codigo: "area_zero", nivel: "bloqueio", mensagem: `A área${escolhido.blocos.length > 1 ? ` da parte ${k + 1}` : ""} é praticamente zero: os pontos estão alinhados ou repetidos.` });
    }
  });
  if ([...numeros.values()].some((x) => x.sintetico)) {
    const sint = unicos.filter((i) => numeros.get(i)!.sintetico).map((i) => pontos[i]);
    avisos.push({
      codigo: "nome_nao_numerico", nivel: "info",
      mensagem: `Ponto${sint.length > 1 ? "s" : ""} com nome que não é número (${sint.slice(0, 5).map((p) => p.nome).join(", ")}${sint.length > 5 ? "…" : ""}): recebe${sint.length > 1 ? "m" : ""} número de sequência; o nome original fica guardado.`,
      linhas: sint.map((p) => p.linha),
    });
  }
  return { anel: escolhido.anel, blocos: escolhido.blocos, criterio: escolhido.criterio, candidatos, numeros, ignoradas, avisos };
}

/** Classifica pontos de apoio pelos padrões da receita (nome; rótulo só se for só a palavra). */
export function marcarApoio(pontos: PontoLido[], padroes: string[]): void {
  const res = padroes.map((p) => new RegExp(p, "i"));
  const rotuloSo = /^(base|ref|refer[eê]ncia|rtcm|esta[cç][aã]o)$/i;
  for (const p of pontos) {
    p.apoio = res.some((r) => r.test(p.nome)) || (p.rotulo !== null && rotuloSo.test(p.rotulo.trim()));
  }
}
