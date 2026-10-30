// A divisão em partes na PRANCHETA DO LOTEAMENTO.
//
// O operador mexe nas partes com o mesmo editor do loteamento (arrastar quina e
// divisa, cortar, desenhar, unir, dividir, "area 33619", desfazer). Para isso a
// divisão vira um projeto de loteamento sem ruas: o imóvel inteiro é UMA quadra
// e cada parte é um lote DESENHADO dessa quadra — lote desenhado o motor do
// loteamento respeita como está, só recalcula medidas, confrontações e avisos.
//
// Ida: o motor da divisão (divisao.ts) gera as partes iguais e elas entram como
// lotes desenhados. Volta: os lotes, do jeito que o operador deixou, viram de
// novo um ResultadoDivisao — pontos no perímetro viram marcos novos e o resto do
// caminho (aplicar no serviço, metragem, locação) é o mesmo de sempre.
import type { Gleba, Vertice } from "./types.ts";
import { arestaComum, type Divisa, type EntradaDivisao, type ParteDivisao, type PontoParte, type ResultadoDivisao } from "./divisao.ts";
import { areaAssinada, dist, type Pt } from "./loteamento/geom.ts";
import { projetoNovo, type Parametros, type Projeto } from "./loteamento/modelo.ts";
import type { Perimetro, Resultado } from "./loteamento/calculo.ts";
import { pontoInterno } from "./loteamento/auto.ts";
import { paraUtm } from "./loteamento/plano.ts";
import { acertarAreas } from "./loteamento/acoes.ts";

type Ent = EntradaDivisao & { base: Vertice[]; confrontantes: string[] };

/**
 * Regras do loteamento desligadas para a partilha: parte rural não tem frente,
 * fundo ou área máxima, nem limite de quinas (segue o perímetro), e não há área
 * pública. O desenho é na própria UTM (sem plano topográfico): a área da parte
 * é a mesma que os documentos do SIGEF vão imprimir.
 */
export const PARAMS_DIVISAO: Partial<Parametros> = {
  distanciasTerreno: false,
  frente: 100, profundidade: 100, areaPadrao: 10_000,
  frenteMin: 0, frenteMax: 1e7, profundidadeMin: 0, profundidadeMax: 1e7,
  areaMin: 0, areaMax: 1e12, quinasMax: 0, quadraCompMax: 1e9, bordaFixa: true,
  pctVerdeMin: 0, pctInstitucionalMin: 0, pctPublicasMin: 0,
  // sem curva de esquina: com estrada nos dois lados de uma quina, o loteamento
  // arredondava o bico do imóvel e os pontos do arco caíam dentro dele — a
  // parte do canto não salvava ("vértice dentro do imóvel")
  esquina: "nenhuma", esquinaValor: 0,
};

/** O projeto (guardado ou novo) com as regras da partilha — rascunho antigo vem com as do loteamento. */
export function comRegrasDaDivisao(p: Projeto): Projeto {
  return { ...p, params: { ...p.params, ...PARAMS_DIVISAO } };
}

/** O perímetro do serviço como o loteamento quer (as mesmas coordenadas brutas das glebas). */
export function perimetroDaDivisao(ent: Ent): Perimetro {
  return {
    pts: ent.base.map((v) => [Number(v.e), Number(v.n)] as Pt),
    altitudes: ent.base.map((v) => Number(v.h) || 0),
    confrontantes: ent.confrontantes,
    nomes: ent.base.map((v) => v.codigo ?? (v.num_txt !== null ? String(v.num_txt) : `V${v.ordem + 1}`)),
  };
}

/** O anel de uma parte em coordenadas brutas (vértice existente pelo levantamento, ponto novo como gravado). */
export function anelBruto(ent: Ent, p: ParteDivisao): Pt[] {
  return p.anel.map((q) => (q.vertice !== undefined ? [Number(ent.base[q.vertice].e), Number(ent.base[q.vertice].n)] : [q.e, q.n]));
}

/** Projeto de loteamento com as partes como lotes desenhados de uma quadra só. */
export function projetoDaDivisao(ent: Ent, aneis: Pt[][], nome: string): Projeto {
  const pr = projetoNovo(nome, ent.base.length);
  pr.params = { ...pr.params, ...PARAMS_DIVISAO };
  pr.bordas = ent.base.map((_, i) => (ent.estrada?.[i]
    ? { tipo: "via" as const, faixa: 0, nome: ent.confrontantes[i] ?? "" }
    : { tipo: "divisa" as const, faixa: 0 }));
  pr.quadras = [{ ancora: pontoInterno({ ext: aneis[0], furos: [] }), ajustes: [], nome: " ", lotes: aneis.map((anel) => ({ anel })) }];
  pr.gerado = true;
  return pr;
}

/** O projeto guardado ainda serve para este perímetro? (o TXT pode ter mudado) */
export function projetoServe(p: Projeto | null | undefined, ent: Ent): p is Projeto {
  return !!p && p.versao === 1 && Array.isArray(p.bordas) && p.bordas.length === ent.base.length && (p.quadras?.[0]?.lotes?.length ?? 0) >= 2;
}

/** Divisão já aplicada (glebas) sem projeto guardado: as glebas viram os lotes. */
export function aneisDasGlebas(glebas: Gleba[]): Pt[][] {
  return glebas.filter((g) => g.anel.length >= 3).map((g) => g.anel.map(([e, n]) => [e, n] as Pt));
}

/** Os lotes do resultado em UTM, na ordem da numeração (parte 1 = lote 1). */
export function aneisDosLotes(res: Resultado): Pt[][] {
  return [...res.lotes].sort((a, b) => a.numero - b.numero).map((l) => l.pol.ext.map((p) => paraUtm(res.plano, p)));
}

/**
 * Avisos do loteamento que fazem sentido numa partilha: os do lote (forma, sem
 * acesso, área livre). Metas de área pública, rua e comprimento de quadra saem;
 * sem estrada no imóvel, "sem frente" também (ninguém tem frente).
 */
export function limparAvisos(res: Resultado, temEstrada: boolean): Resultado {
  const fica = (t: string) => temEstrada || !/sem frente/i.test(t);
  const lotes = res.lotes.map((l) => ({ ...l, problemas: l.problemas.filter(fica) }));
  // área livre de 1–2 m² é só o arredondamento milimétrico dos pontos novos
  const livreDeVerdade = (t: string) => {
    const m = /([\d.,]+) m² sem lote/.exec(t);
    return !m || Number(m[1].replace(/\./g, "").replace(",", ".")) >= 5;
  };
  const problemas = res.problemas.filter((p) => (p.alvo?.lote || (/sem lote/i.test(p.texto) && livreDeVerdade(p.texto))) && fica(p.texto));
  return { ...res, lotes, quadras: res.quadras.map((q) => ({ ...q, lotes: q.lotes.map((l) => lotes.find((x) => x.id === l.id) ?? l) })), problemas };
}

const TOL = 0.02; // ponto a menos de 2 cm de um vértice é o vértice
// A quadra do loteamento é o perímetro sem os vértices quase alinhados, e a quina
// que corre pela borda dela pode ficar uns centímetros fora do perímetro real:
// até 50 cm o ponto é projetado no perímetro (vira marco no lado certo).
const TOL_LADO = 0.5;
const arred = (v: number) => Math.round(v * 1000) / 1000;

type NoPerimetro = { vertice: number } | { aresta: number; t: number; e: number; n: number };

/** Onde um ponto do desenho cai no perímetro: um vértice (a menos de 2 cm) ou um ponto do lado, projetado nele e arredondado ao milímetro (null = dentro do imóvel). */
function noPerimetro(P: Pt[], q: Pt): NoPerimetro | null {
  const nV = P.length;
  let mv = -1, dv = TOL;
  for (let i = 0; i < nV; i++) { const d = dist(q, P[i]); if (d < dv) { dv = d; mv = i; } }
  if (mv >= 0) return { vertice: mv };
  let melhor: { aresta: number; t: number; d: number } | null = null;
  for (let i = 0; i < nV; i++) {
    const a = P[i], b = P[(i + 1) % nV];
    const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
    const t = ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / L2;
    if (t <= 0 || t >= 1) continue;
    const d = dist(q, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    if (d < TOL_LADO && (!melhor || d < melhor.d)) melhor = { aresta: i, t, d };
  }
  if (!melhor) return null;
  const A = P[melhor.aresta], B = P[(melhor.aresta + 1) % nV];
  return { aresta: melhor.aresta, t: melhor.t, e: arred(A[0] + (B[0] - A[0]) * melhor.t), n: arred(A[1] + (B[1] - A[1]) * melhor.t) };
}

/**
 * Os lotes (UTM, como o operador deixou) de volta a um ResultadoDivisao.
 * Ponto sobre um vértice do levantamento é esse vértice; sobre um lado do
 * perímetro é marco novo; dentro do imóvel não é aceito — a parte vira gleba
 * do serviço e todo vértice dela precisa estar no perímetro.
 */
export function resultadoDosLotes(ent: Ent, aneis: Pt[][], fracoes?: number[], azimute = 0): ResultadoDivisao {
  const P = ent.base.map((v) => [Number(v.e), Number(v.n)] as Pt);
  const nV = P.length;
  const pub = ent.publicar;
  const vazio = (motivo: string): ResultadoDivisao => ({ ok: false, azimute, divisas: [], partes: [], novos: [], motivo, custo: Infinity, erroAreaM2: Infinity });
  if (aneis.length < 2) return vazio("são precisas pelo menos 2 partes");

  const novosPorChave = new Map<string, PontoParte>();
  const casar = (q: Pt, k: number): PontoParte | string => {
    const c = noPerimetro(P, q);
    if (!c) return `a parte ${k + 1} tem um vértice dentro do imóvel (E ${q[0].toFixed(2)}, N ${q[1].toFixed(2)}): toda divisa precisa ir de um lado ao outro do perímetro`;
    if ("vertice" in c) return { e: P[c.vertice][0], n: P[c.vertice][1], vertice: c.vertice };
    const melhor = c, e = c.e, n = c.n;
    const chave = `${melhor.aresta}|${e}|${n}`;
    let pt = novosPorChave.get(chave);
    if (!pt) { pt = { e, n, novo: { divisa: -1, aresta: melhor.aresta, t: melhor.t } }; novosPorChave.set(chave, pt); }
    return pt;
  };

  // O loteamento limpa vértice quase alinhado do contorno do lote: entre dois
  // pontos do perímetro que não são vizinhos, os vértices pulados (a poucos cm
  // da reta) voltam — senão o lado viraria uma "divisa" por cima do perímetro.
  const distSeg = (q: Pt, a: PontoParte, b: PontoParte) => {
    const L2 = (b.e - a.e) ** 2 + (b.n - a.n) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a.e) * (b.e - a.e) + (q[1] - a.n) * (b.n - a.n)) / L2));
    return dist(q, [a.e + (b.e - a.e) * t, a.n + (b.n - a.n) * t]);
  };
  const mod = (i: number) => ((i % nV) + nV) % nV;
  const pulados = (a: PontoParte, b: PontoParte): PontoParte[] | null => {
    // para a frente: vértices depois de a até o vértice antes de b (ou o que abre o lado de b)
    // para trás: o mesmo no outro sentido
    for (const sentido of [1, -1] as const) {
      const out: PontoParte[] = [];
      let idx = sentido > 0
        ? mod((a.vertice ?? a.novo!.aresta) + 1)
        : mod(a.vertice !== undefined ? a.vertice - 1 : a.novo!.aresta);
      for (let passo = 0; passo < 8; passo++) {
        if (idx === b.vertice) return out.length ? out : null;
        if (distSeg(P[idx], a, b) > 0.05) break;
        out.push({ e: P[idx][0], n: P[idx][1], vertice: idx });
        if (b.novo && idx === (sentido > 0 ? b.novo.aresta : mod(b.novo.aresta + 1))) return out;
        idx = mod(idx + sentido);
      }
    }
    return null;
  };
  const repor = (anel: PontoParte[]): PontoParte[] => {
    const out: PontoParte[] = [];
    for (let j = 0; j < anel.length; j++) {
      const a = anel[j], b = anel[(j + 1) % anel.length];
      out.push(a);
      if (arestaComum(a, b, nV) === null) out.push(...(pulados(a, b) ?? []));
    }
    return out;
  };

  const aneisP: PontoParte[][] = [];
  for (const [k, anel] of aneis.entries()) {
    const out: PontoParte[] = [];
    for (const q of anel) {
      const c = casar(q, k);
      if (typeof c === "string") return vazio(c);
      const ult = out[out.length - 1];
      if (!ult || ult.e !== c.e || ult.n !== c.n) out.push(c);
    }
    while (out.length > 1 && out[0].e === out[out.length - 1].e && out[0].n === out[out.length - 1].n) out.pop();
    if (out.length < 3) return vazio(`a parte ${k + 1} ficou sem área`);
    aneisP.push(repor(out));
  }

  // divisas: lados que não correm sobre o perímetro (uma por par de pontos)
  const chaveP = (p: PontoParte) => `${p.e}|${p.n}`;
  const divisas: Divisa[] = [];
  const vistas = new Set<string>();
  for (const anel of aneisP) {
    for (let j = 0; j < anel.length; j++) {
      const a = anel[j], b = anel[(j + 1) % anel.length];
      if (arestaComum(a, b, nV) !== null) continue;
      const ch = [chaveP(a), chaveP(b)].sort().join("/");
      if (vistas.has(ch)) continue;
      vistas.add(ch);
      divisas.push({ a, b, comprimentoM: dist([a.e, a.n], [b.e, b.n]) });
    }
  }
  divisas.forEach((d, i) => { for (const p of [d.a, d.b]) if (p.novo && p.novo.divisa < 0) p.novo.divisa = i; });
  // ponto novo que não é ponta de divisa está no meio de um lado reto: sai (não é marco)
  const aneisF = aneisP.map((anel) => anel.filter((p) => !p.novo || p.novo.divisa >= 0));
  const novos = [...novosPorChave.values()].filter((p) => p.novo!.divisa >= 0)
    .sort((a, b) => a.novo!.aresta - b.novo!.aresta || a.novo!.t - b.novo!.t);

  const ver = (p: PontoParte): Pt => (pub ? pub([p.e, p.n]) : [p.e, p.n]);
  const partes: ParteDivisao[] = aneisF.map((anel) => {
    let perimetroM = 0, frenteEstradaM = 0;
    for (let j = 0; j < anel.length; j++) {
      const a = anel[j], b = anel[(j + 1) % anel.length];
      const l = dist([a.e, a.n], [b.e, b.n]);
      perimetroM += l;
      const ar = arestaComum(a, b, nV);
      if (ar !== null && ent.estrada?.[ar]) frenteEstradaM += l;
    }
    return { anel, areaM2: Math.abs(areaAssinada(anel.map(ver))), perimetroM, frenteEstradaM };
  });

  const soma = partes.reduce((s, p) => s + p.areaM2, 0);
  const total = Math.abs(areaAssinada(pub ? P.map((p) => pub(p)) : P));
  if (Math.abs(soma - total) > Math.max(5, total * 1e-4)) {
    return vazio(soma < total
      ? `${(total - soma).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m² do imóvel estão fora das partes (área livre): desenhe uma parte nela ou mova as divisas`
      : "há partes sobrepostas: as áreas somam mais que o imóvel");
  }
  const fr = fracoes && fracoes.length === partes.length ? fracoes : partes.map(() => 1);
  const sf = fr.reduce((s, f) => s + f, 0);
  const erroAreaM2 = Math.max(...partes.map((p, k) => Math.abs(p.areaM2 - (fr[k] / sf) * soma)));
  return { ok: true, azimute, divisas, partes, novos, custo: 0, erroAreaM2 };
}

// ---------------------------------------------------------------------------
// "Ajustar lotes": as áreas IMPRESSAS iguais, não as do desenho
// ---------------------------------------------------------------------------

/** Ponto novo de divisa (no lado `aresta`, hoje em `de`) e o lugar novo dele (`para`; sem `para`, fica). */
export interface TrocaDePonto { aresta: number; de: Pt; para?: Pt }

/**
 * Acabamento das áreas como os documentos imprimem. O documento mede cada ponto
 * arredondado a 0,001" (~3 cm) e a área da parte anda em degraus de alguns m²
 * conforme a divisa desliza: igualar a área do desenho deixava as impressas até
 * 7 m² longe uma da outra. Como no motor (divisao.ts), cada ponta de divisa é
 * escolhida à parte entre as posições do próprio lado perto de onde está, e o
 * par que deixa as partes mais perto da cota fica. A janela só cresce (30 cm,
 * 1 m, 2 m) enquanto a maior diferença não chega ao centésimo de m². O limite
 * é o próprio arredondamento: um passo da grade numa ponta muda a parte em
 * ~0,5 × divisa × 3 cm, e o par das duas pontas chega a centésimos, não a zero.
 * Devolve todos os pontos novos; os que mudam de lugar vêm com `para`.
 */
export function afinarImpressas(ent: Ent, aneis: Pt[][], fracoes?: number[], janelas = [0.3, 1, 2]): TrocaDePonto[] {
  const pub = ent.publicar;
  const rd = resultadoDosLotes(ent, aneis, fracoes);
  if (!pub || !rd.ok || !rd.novos.length) return [];
  const P = ent.base.map((v) => [Number(v.e), Number(v.n)] as Pt);
  const nV = P.length;
  const nP = rd.partes.length;
  const fr = fracoes && fracoes.length === nP ? fracoes : rd.partes.map(() => 1);
  const sf = fr.reduce((s, f) => s + f, 0);
  const cota = fr.map((f) => f / sf);
  const iguais = fr.every((f) => Math.abs(f - fr[0]) < 1e-9);
  // o lado de dentro do imóvel (o ponto gravado fica 2 mm para dentro: o
  // loteamento recorta pelo perímetro o que passa de fora, e o recorte, na
  // reta da divisa, levaria o ponto para o lado — e o documento veria outro)
  const anti = areaAssinada(P) > 0;
  const dentro = (ar: number): Pt => {
    const A = P[ar], B = P[(ar + 1) % nV], L = dist(A, B) || 1;
    const u: Pt = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    return anti ? [-u[1], u[0]] : [u[1], -u[0]];
  };

  // o anel de cada parte: ponto fixo (já como o documento vê) ou o índice de um ponto novo
  const vars = rd.novos;
  const idx = new Map(vars.map((p, i) => [p, i]));
  const aneisP: (number | Pt)[][] = rd.partes.map((pt) => pt.anel.map((q) => idx.get(q) ?? pub([q.e, q.n])));
  const partesDe = vars.map((_, i) => aneisP.flatMap((a, k) => (a.includes(i) ? [k] : [])));
  const ver: Pt[] = vars.map((p) => pub([p.e, p.n]));
  const ver0 = ver.slice();
  const gravado: Pt[] = vars.map((p) => [p.e, p.n]);

  // posições possíveis de cada ponto novo: o lado do perímetro de cm em cm,
  // gravadas como o desenho grava e vistas como o documento vê (o mesmo
  // caminho de resultadoDosLotes: projeta no lado, mm, 0,001")
  const cache = new Map<string, { para: Pt; ver: Pt } | null>();
  const posicao = (i: number, m: number) => {
    const ch = `${i}|${m}`;
    if (cache.has(ch)) return cache.get(ch)!;
    const p = vars[i], ar = p.novo!.aresta;
    const A = P[ar], B = P[(ar + 1) % nV];
    const t = p.novo!.t + (m * 0.01) / (dist(A, B) || 1);
    let r: { para: Pt; ver: Pt } | null = null;
    if (t > 0 && t < 1) {
      const c = noPerimetro(P, [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]);
      if (c && !("vertice" in c) && c.aresta === ar) {
        const n = dentro(ar);
        const para: Pt = [c.e + 0.002 * n[0], c.n + 0.002 * n[1]];
        const visto = noPerimetro(P, para);
        if (visto && !("vertice" in visto) && visto.aresta === ar) r = { para, ver: pub([visto.e, visto.n]) };
      }
    }
    cache.set(ch, r);
    return r;
  };
  const opcoes = (i: number, janela: number) => {
    const out = [{ para: gravado[i], ver: ver0[i] }];
    const vistos = new Set([`${ver0[i][0]}|${ver0[i][1]}`]);
    for (let m = 1; m <= Math.round(janela * 100); m++) {
      for (const s of [m, -m]) {
        const c = posicao(i, s);
        if (!c || vistos.has(`${c.ver[0]}|${c.ver[1]}`)) continue;
        vistos.add(`${c.ver[0]}|${c.ver[1]}`);
        out.push(c);
      }
    }
    return out;
  };

  const ponto = (s: number | Pt): Pt => (typeof s === "number" ? ver[s] : s);
  const areaDa = (k: number) => {
    const a = aneisP[k];
    let s = 0;
    for (let j = 0; j < a.length; j++) {
      const p = ponto(a[j]), q = ponto(a[(j + 1) % a.length]);
      s += p[0] * q[1] - p[1] * q[0];
    }
    return Math.abs(s) / 2;
  };
  const areas = rd.partes.map((_, k) => areaDa(k));
  // Duas réguas, uma depois da outra: a soma dos quadrados das diferenças p/ a
  // cota (cada divisa equilibra as duas partes dela; só a maior diferença
  // travava a busca na parte de longe) e depois a maior diferença (ao milésimo
  // de m²). Já perto (< 0,1 m²), vem antes que partes iguais saiam com o mesmo
  // número nos documentos (ha com 4 casas = m² inteiro).
  type Nota = { doc: number; max: number; sq: number };
  const nota = (as: number[]): Nota => {
    let T = 0;
    for (let k = 0; k < nP; k++) T += as[k];
    let max = 0, sq = 0;
    for (let k = 0; k < nP; k++) { const e = as[k] - cota[k] * T; max = Math.max(max, Math.abs(e)); sq += e * e; }
    // (o número dos documentos só importa já perto)
    return { doc: iguais && max < 0.1 ? new Set(as.map((a) => Math.round(a))).size - 1 : 0, max, sq };
  };
  const doc = (a: Nota, b: Nota) => a.max < 0.1 && b.max < 0.1 && a.doc !== b.doc;
  const porQuadrados = (a: Nota, b: Nota) => (doc(a, b) ? a.doc < b.doc : a.sq < b.sq * (1 - 1e-9) - 1e-12);
  const porMaior = (a: Nota, b: Nota) => {
    if (doc(a, b)) return a.doc < b.doc;
    const ma = Math.round(a.max * 1000), mb = Math.round(b.max * 1000);
    return ma < mb || (ma === mb && a.sq < b.sq * (1 - 1e-9) - 1e-12);
  };

  let atual = nota(areas);
  // cada divisa: as duas pontas juntas (só a que é ponto novo, se a outra é vértice)
  const grupos = rd.divisas.map((d) => [d.a, d.b].map((p) => idx.get(p)).filter((i): i is number => i !== undefined)).filter((g) => g.length);
  const descer = (janela: number, melhorQue: (a: Nota, b: Nota) => boolean) => {
    for (let passada = 0; passada < 8; passada++) {
      let mudou = false;
      for (const g of grupos) {
        const afetadas = [...new Set(g.flatMap((i) => partesDe[i]))];
        const listas = g.map((i) => opcoes(i, janela));
        const antes = g.map((i) => ver[i]);
        let melhor: Pt[] | null = null, nMelhor = atual;
        const as = areas.slice();
        const tenta = (escolha: Pt[]) => {
          g.forEach((i, j) => { ver[i] = escolha[j]; });
          for (const k of afetadas) as[k] = areaDa(k);
          const nt = nota(as);
          if (melhorQue(nt, nMelhor)) { nMelhor = nt; melhor = escolha.slice(); }
        };
        if (g.length === 1) for (const c of listas[0]) tenta([c.ver]);
        else for (const c0 of listas[0]) for (const c1 of listas[1]) tenta([c0.ver, c1.ver]);
        const fica: Pt[] = melhor ?? antes;
        g.forEach((i, j) => { ver[i] = fica[j]; });
        if (melhor) {
          for (const k of afetadas) areas[k] = areaDa(k);
          atual = nota(areas);
          mudou = true;
        }
      }
      if (!mudou) break;
    }
  };
  // a melhor situação vista (pela maior diferença) é a que fica
  let guardado = { ver: ver.slice(), nota: atual };
  for (const janela of janelas) {
    descer(janela, porQuadrados);
    descer(janela, porMaior);
    if (porMaior(atual, guardado.nota)) guardado = { ver: ver.slice(), nota: atual };
    if (guardado.nota.max < 0.01 && !guardado.nota.doc) break;
  }
  guardado.ver.forEach((v, i) => { ver[i] = v; });

  // de volta ao desenho: a posição gravada que dá o ponto escolhido
  return vars.map((p, i) => {
    const t: TrocaDePonto = { aresta: p.novo!.aresta, de: gravado[i] };
    if (ver[i][0] === ver0[i][0] && ver[i][1] === ver0[i][1]) return t;
    const c = opcoes(i, Math.max(...janelas)).find((x) => x.ver[0] === ver[i][0] && x.ver[1] === ver[i][1]);
    return c ? { ...t, para: c.para } : t;
  });
}

/**
 * Leva os pontos trocados para o lugar novo em todos os anéis (UTM) que os têm.
 * O ponto do desenho é o ponto novo mais perto no mesmo lado: o recorte do
 * loteamento pode tê-lo deixado uns centímetros longe de onde o projeto guarda.
 */
export function trocarPontos(ent: Ent, aneis: Pt[][], trocas: TrocaDePonto[]): Pt[][] {
  if (!trocas.some((x) => x.para)) return aneis;
  const P = ent.base.map((v) => [Number(v.e), Number(v.n)] as Pt);
  return aneis.map((anel) => anel.map((q) => {
    const c = noPerimetro(P, q);
    if (!c || "vertice" in c) return q;
    let t: TrocaDePonto | null = null, dm = TOL_LADO;
    for (const x of trocas) {
      const d = x.aresta === c.aresta ? dist(x.de, [c.e, c.n]) : Infinity;
      if (d < dm) { dm = d; t = x; }
    }
    return t?.para ?? q;
  }));
}

/** O projeto da prancheta com os pontos trocados (o mesmo ponto em todas as partes que o dividem). */
export function trocarNoProjeto(pr: Projeto, ent: Ent, trocas: TrocaDePonto[]): Projeto {
  if (!trocas.some((x) => x.para)) return pr;
  return {
    ...pr,
    quadras: pr.quadras.map((q) => (q.lotes ? {
      ...q,
      lotes: q.lotes.map((l) => ({
        ...l,
        anel: trocarPontos(ent, [l.anel], trocas)[0],
        ...(l.frente ? { frente: trocarPontos(ent, [l.frente], trocas)[0] as [Pt, Pt] } : {}),
      })),
    } : q)),
  };
}

/** Maior diferença p/ a cota aceita sem dividir de novo (o painel mostra "< 0,1" abaixo de 0,05). */
export const TOL_AJUSTE_M2 = 0.05;

export interface AjustePartes {
  pr: Projeto;
  /** as partes como o painel mostra e os documentos imprimem */
  rd: ResultadoDivisao;
  /** true = as divisas deslizaram (desenho mantido); false = o motor dividiu de novo */
  manteve: boolean;
}

/**
 * "Ajustar lotes" da prancheta: todas as partes com a mesma área IMPRESSA (ou na
 * fração de cada uma) — a que o painel mostra e os documentos imprimem, medida
 * nos pontos arredondados a 0,001", não a área do desenho.
 *  1. as divisas deslizam (o "area" do loteamento), com o alvo de cada parte
 *     corrigido pela diferença entre a área impressa e a do desenho; a relação
 *     não é linear (degraus do arredondamento), então repete enquanto melhora;
 *  2. acabamento: cada ponta de divisa vai para o ponto do lado que deixa as
 *     áreas impressas mais perto da cota (afinarImpressas);
 *  3. se o desenho não deixar (sem frente para deslizar, ou sobra diferença),
 *     o motor divide de novo na direção atual, com o mesmo acabamento.
 */
export function ajustarPartes(
  pr0: Projeto, entrada: Ent, calc: (p: Projeto) => Resultado | null, fracoes: number[] | undefined, motor: () => Projeto | null,
): AjustePartes | null {
  // o mesmo ponto é publicado muitas vezes nas rodadas: guarda (proj4 é o mais caro)
  const pub = entrada.publicar;
  const publicados = new Map<string, Pt>();
  const ent: Ent = pub ? {
    ...entrada,
    publicar: (q: Pt) => {
      const k = `${q[0]}|${q[1]}`;
      let v = publicados.get(k);
      if (!v) { v = pub(q); publicados.set(k, v); }
      return v;
    },
  } : entrada;
  type Medida = { p: Projeto; r: Resultado; d: ResultadoDivisao; fr?: number[] };
  // melhor para quem recebe: partes iguais com o mesmo número nos documentos
  // (ha com 4 casas = m² inteiro); depois, a menor diferença p/ a cota
  const iguais = !fracoes || fracoes.every((f) => Math.abs(f - fracoes[0]) < 1e-9);
  const noDoc = (d: ResultadoDivisao) => (iguais ? new Set(d.partes.map((p) => Math.round(p.areaM2))).size : 0);
  const melhorAjuste = (a: ResultadoDivisao, b: ResultadoDivisao) =>
    noDoc(a) < noDoc(b) || (noDoc(a) === noDoc(b) && a.erroAreaM2 < b.erroAreaM2 - 1e-6);
  const medir = (p: Projeto): Medida | null => {
    const r = calc(p);
    if (!r || r.lotes.length < 2) return null;
    const fr = fracoes && fracoes.length === r.lotes.length ? fracoes : undefined;
    const d = resultadoDosLotes(ent, aneisDosLotes(r), fr);
    return d.ok ? { p, r, d, fr } : null;
  };
  // o acabamento roda de novo sobre o que o loteamento devolveu (o recorte
  // pode mexer um ponto alguns milímetros), enquanto melhora
  const acabar = (m: Medida): Medida => {
    for (let rodada = 0; rodada < 3; rodada++) {
      const trocas = afinarImpressas(ent, aneisDosLotes(m.r), m.fr);
      const m2 = trocas.some((x) => x.para) ? medir(trocarNoProjeto(m.p, ent, trocas)) : null;
      if (!m2 || !melhorAjuste(m2.d, m.d)) break;
      m = m2;
    }
    return m;
  };

  let m = medir(pr0);
  if (m) {
    for (let it = 0; it < 4 && m.d.erroAreaM2 > 0.5; it++) {
      const ls = [...m.r.lotes].sort((a, b) => a.numero - b.numero);
      const soma = m.d.partes.reduce((s, p) => s + p.areaM2, 0);
      const fr = m.fr ?? ls.map(() => 1);
      const sf = fr.reduce((s, f) => s + f, 0);
      const d = m.d;
      const alvos = ls.map((l, k) => l.area + (fr[k] / sf) * soma - d.partes[k].areaM2);
      const ed = acertarAreas(m.p, m.r, ls.slice(0, -1), alvos.slice(0, -1));
      if (!ed || ed.erro) break;
      const m2 = medir(ed.pr);
      if (!m2 || m2.d.erroAreaM2 >= m.d.erroAreaM2) break;
      m = m2;
    }
    m = acabar(m);
    if (m.d.erroAreaM2 <= TOL_AJUSTE_M2 && noDoc(m.d) <= 1) return { pr: m.p, rd: m.d, manteve: true };
  }
  const g = motor();
  const mg = g ? medir(g) : null;
  const mf = mg ? acabar(mg) : null;
  if (mf && (!m || melhorAjuste(mf.d, m.d))) return { pr: mf.p, rd: mf.d, manteve: false };
  return m ? { pr: m.p, rd: m.d, manteve: true } : null;
}
