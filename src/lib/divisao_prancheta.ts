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
};

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
    let mv = -1, dv = TOL;
    for (let i = 0; i < nV; i++) { const d = dist(q, P[i]); if (d < dv) { dv = d; mv = i; } }
    if (mv >= 0) return { e: P[mv][0], n: P[mv][1], vertice: mv };
    let melhor: { aresta: number; t: number; d: number } | null = null;
    for (let i = 0; i < nV; i++) {
      const a = P[i], b = P[(i + 1) % nV];
      const L2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
      const t = ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1])) / L2;
      if (t <= 0 || t >= 1) continue;
      const d = dist(q, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      if (d < TOL_LADO && (!melhor || d < melhor.d)) melhor = { aresta: i, t, d };
    }
    if (!melhor) return `a parte ${k + 1} tem um vértice dentro do imóvel (E ${q[0].toFixed(2)}, N ${q[1].toFixed(2)}): toda divisa precisa ir de um lado ao outro do perímetro`;
    const A = P[melhor.aresta], B = P[(melhor.aresta + 1) % nV];
    const e = arred(A[0] + (B[0] - A[0]) * melhor.t), n = arred(A[1] + (B[1] - A[1]) * melhor.t);
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
