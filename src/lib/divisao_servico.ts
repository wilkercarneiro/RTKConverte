// A divisão em partes aplicada ao SERVIÇO: do resultado do motor (divisao.ts)
// para os vértices e as glebas que o resto do sistema já sabe documentar.
//
// Depois de aplicada, uma divisão É um serviço de glebas: cada parte vira uma
// gleba cujo anel são vértices do levantamento mais os pontos novos das divisas,
// gravados como vértices M do perímetro. A partir daí a planta geral, a planilha,
// o memorial e a A3 de cada parte saem pelo caminho das glebas, sem caso especial.
//
// O que é próprio da partilha mora aqui também: quem recebe cada parte (o
// herdeiro vira o proprietário do GEO individual) e a montagem desses GEOs
// individuais — um serviço completo por parte, com a confrontação certa nas
// divisas internas.
import type { Gleba, Servico, Vertice } from "./types.ts";
import { SEM_CONFRONTACAO, ehRioPorLimite, type Confrontacao } from "./trechos.ts";
import type { EntradaDivisao, ResultadoDivisao } from "./divisao.ts";
import { calcularVertices, type Proj4 } from "../../supabase/functions/_shared/geo.ts";

/**
 * Onde o servidor põe um ponto: projeta, arredonda a 0,001" (como a planilha do
 * SIGEF) e re-projeta — é desse ponto que saem as áreas dos documentos.
 */
export function publicadorUtm(fuso: number, proj4: Proj4): (p: [number, number]) => [number, number] {
  return ([e, n]) => {
    try {
      const v = calcularVertices([{ numTxt: null, e, n, h: 0, sigmaPos: 0, sigmaH: 0 }], fuso, proj4)[0];
      return [v.eProj, v.nProj];
    } catch {
      return [e, n];
    }
  };
}

/** Marca dos vértices criados pela divisão: refazer a divisão apaga só estes. */
export const ROTULO_DIVISAO = "DIVISÃO";

export interface InfoParte {
  nome: string;
  herdeiro: string;
  cpf: string;
  denominacao: string;
}

const temXY = (v: Vertice) => v.e !== null && v.n !== null;
const ordenar = (vs: Vertice[]) => [...vs].sort((a, b) => a.ordem - b.ordem);

/** Os vértices sem os pontos de uma divisão anterior, renumerados. */
export function semDivisaoAnterior(vertices: Vertice[]): Vertice[] {
  return ordenar(vertices).filter((v) => v.rotulo_txt !== ROTULO_DIVISAO).map((v, i) => ({ ...v, ordem: i }));
}

/** Confrontação vigente em cada posição da lista ordenada: a do último M, com volta no anel. */
function confrontacoes(lista: Vertice[]): (Confrontacao & { tipo_limite: string | null })[] {
  const n = lista.length;
  const primeiroM = lista.findIndex((v) => v.tipo === "M");
  const out = new Array(n);
  if (primeiroM < 0) return lista.map(() => ({ ...SEM_CONFRONTACAO }));
  let atual: Confrontacao = SEM_CONFRONTACAO;
  // começa no último M antes do fim, para os vértices antes do primeiro M
  for (let k = n - 1; k >= 0; k--) if (lista[k].tipo === "M") { atual = conf(lista[k]); break; }
  for (let i = 0; i < n; i++) {
    if (lista[i].tipo === "M") atual = conf(lista[i]);
    out[i] = atual;
  }
  return out;
}
const conf = (v: Vertice): Confrontacao => ({
  descritivo: v.descritivo, tipo_limite: v.tipo_limite, eh_via: v.eh_via, cns: v.cns, matricula: v.matricula,
  apelido_txt: v.apelido_txt, numerado: !!v.numerado, exibir_planta: v.exibir_planta !== false,
});

/** O perímetro como o motor quer: anel E/N e quais lados são estrada. */
export function entradaDoServico(
  vertices: Vertice[], fracoes: number[], inverter = false,
  publicar?: (p: [number, number]) => [number, number],
): EntradaDivisao & { base: Vertice[] } {
  const lista = semDivisaoAnterior(vertices);
  const confs = confrontacoes(lista);
  const comXY = lista.map((v, i) => ({ v, c: confs[i] })).filter(({ v }) => temXY(v));
  return {
    base: comXY.map(({ v }) => v),
    // com o publicador, o motor trabalha no plano dos documentos
    anel: comXY.map(({ v }) => (publicar ?? ((q: [number, number]) => q))([Number(v.e), Number(v.n)])),
    // estrada dá acesso; rio (LN1) é faixa de domínio mas não é caminho
    estrada: comXY.map(({ c }) => !!c.eh_via && !ehRioPorLimite(c.tipo_limite)),
    fracoes,
    inverter,
    publicar,
  };
}

/**
 * Aplica a divisão: insere os pontos novos no perímetro (vértices M, com a
 * confrontação do trecho em que caem) e devolve as glebas, uma por parte.
 *
 * Os ids das glebas são reaproveitados por posição: refazer a divisão não cria
 * linhas novas no banco nem perde o vínculo com o GEO individual já criado.
 */
export function aplicarDivisao(
  vertices: Vertice[],
  r: ResultadoDivisao,
  partes: InfoParte[],
  fracoes: number[],
  servicoId: string,
  glebasAntes: Gleba[] = [],
): { vertices: Vertice[]; glebas: Gleba[] } {
  if (!r.ok) throw new Error(r.motivo ?? "divisão inválida");
  const lista = semDivisaoAnterior(vertices);
  const confs = confrontacoes(lista);
  const geo = lista.filter(temXY);
  const posNaLista = new Map(geo.map((v, i) => [i, lista.indexOf(v)]));

  // ponto novo → logo depois do vértice que abre a aresta onde ele cai
  const novosPorPos = new Map<number, typeof r.novos>();
  for (const p of r.novos) {
    const pos = posNaLista.get(p.novo!.aresta)!;
    novosPorPos.set(pos, [...(novosPorPos.get(pos) ?? []), p].sort((a, b) => a.novo!.t - b.novo!.t));
  }
  const saida: Vertice[] = [];
  const idDoNovo = new Map<string, string>();
  lista.forEach((v, i) => {
    saida.push(v);
    for (const p of novosPorPos.get(i) ?? []) {
      const a = geo[p.novo!.aresta], b = geo[(p.novo!.aresta + 1) % geo.length];
      const t = p.novo!.t;
      const id = crypto.randomUUID();
      idDoNovo.set(`${p.e}|${p.n}`, id);
      saida.push({
        id, servico_id: servicoId, ordem: 0, num_txt: null, rotulo_txt: ROTULO_DIVISAO,
        e: p.e, n: p.n,
        h: Math.round((a.h + (b.h - a.h) * t) * 1000) / 1000,
        sigma_pos: Math.max(a.sigma_pos, b.sigma_pos), sigma_h: Math.max(a.sigma_h, b.sigma_h),
        // Marco a implantar no ponto calculado. PA1 = posição por cálculo: depois
        // de implantar e levantar o marco, o técnico troca o método na tabela.
        tipo: "M", codigo: null, codigo_provisorio: false, metodo: "PA1", inserido_manual: false,
        lat_gms: "", lon_gms: "",
        // o ponto cai no meio de uma confrontação: ela continua a mesma depois dele
        ...confs[i],
      });
    }
  });
  const verticesNovos = saida.map((v, i) => ({ ...v, ordem: i }));

  const glebas: Gleba[] = r.partes.map((p, k) => {
    const antes = glebasAntes[k];
    const info = partes[k];
    const nome = (info?.nome ?? "").trim() || `PARTE ${k + 1}`;
    return {
      ...(antes?.id ? { id: antes.id } : {}),
      servico_id: servicoId,
      ordem: k,
      nome,
      // vértice existente vai com o E/N do levantamento (o motor mede no plano
      // arredondado, mas a gleba casa com o vértice pelo dado bruto, como sempre)
      anel: p.anel.map((q) => (q.vertice !== undefined
        ? [Number(geo[q.vertice].e), Number(geo[q.vertice].n)]
        : [q.e, q.n]) as [number, number]),
      confrontante_interno: null,
      denominacao: info?.denominacao.trim() || null,
      detentor_nome: info?.herdeiro.trim() || null,
      detentor_cpf: info?.cpf.trim() || null,
      fracao: fracoes[k] / fracoes.reduce((s, f) => s + f, 0),
      servico_parte_id: antes?.servico_parte_id ?? null,
    };
  });
  return { vertices: verticesNovos, glebas };
}

// ---------------------------------------------------------------------------
// identificação de uma parte — o mesmo texto que o servidor monta
// (identificacaoDaGleba, planta_dados.ts), para a divisa interna do GEO
// individual nomear o vizinho do jeito que a planta geral nomeia
// ---------------------------------------------------------------------------
export function denominacaoDaParte(s: Pick<Servico, "denominacao">, g: Pick<Gleba, "nome" | "denominacao">): string {
  return (g.denominacao ?? "").trim() || `${(s.denominacao ?? "").trim()} - ${g.nome}`.trim();
}

export function descritivoDaParte(s: Servico, g: Gleba): string {
  const l: string[] = [];
  l.push(s.tipo_imovel === "posse" ? "(POSSE)" : `(MATR.${s.matricula ?? ""}/CNS.${s.cns ?? ""})`);
  const head = `${l[0]} ${denominacaoDaParte(s, g).toUpperCase()}`;
  const dono = (g.detentor_nome ?? "").trim() ? g.detentor_nome!.trim() : (s.detentor_nome ?? "");
  const cpf = (g.detentor_nome ?? "").trim() ? (g.detentor_cpf ?? "") : (s.detentor_cpf ?? "");
  return [head, dono.toUpperCase(), ...(cpf ? [`CPF:${cpf}`] : [])].join("\\ ");
}

// ---------------------------------------------------------------------------
// GEO individual: um serviço completo por parte
// ---------------------------------------------------------------------------
const RAIO = 0.1;

/**
 * Os vértices do GEO de uma parte, com a confrontação de cada lado:
 *   - lado que acompanha o perímetro do imóvel → o confrontante do imóvel ali;
 *   - lado que fecha por dentro (divisa da partilha) → a parte vizinha, com o
 *     herdeiro dela, no mesmo formato dos outros confrontantes.
 * Os códigos são os do imóvel: o marco tem o mesmo nome no GEO geral e no da
 * parte. Por isso o imóvel precisa ter os códigos alocados antes.
 */
export function verticesDaParte(servico: Servico, vertices: Vertice[], glebas: Gleba[], k: number, novoServicoId: string): Vertice[] {
  const lista = ordenar(vertices);
  const confs = confrontacoes(lista);
  const geo = lista.map((v, i) => ({ v, i })).filter(({ v }) => temXY(v));
  const posGeo = new Map(geo.map(({ v }, gi) => [v, gi]));
  const casar = (e: number, n: number) => {
    let melhor: { v: Vertice; i: number } | null = null, dm = RAIO;
    for (const x of geo) {
      const d = Math.hypot(Number(x.v.e) - e, Number(x.v.n) - n);
      if (d < dm) { dm = d; melhor = x; }
    }
    return melhor;
  };
  const anelDe = (g: Gleba) => g.anel.map(([e, n]) => casar(e, n)).filter((x): x is { v: Vertice; i: number } => !!x);
  const aneis = glebas.map(anelDe);
  const anel = aneis[k];
  if (anel.length < 3) throw new Error(`${glebas[k].nome}: menos de 3 vértices casados com o levantamento`);
  const nG = geo.length;
  const vizinhos = (a: Vertice, b: Vertice) => {
    const pa = posGeo.get(a)!, pb = posGeo.get(b)!;
    return (pa + 1) % nG === pb || (pb + 1) % nG === pa;
  };
  const outraParte = (a: Vertice, b: Vertice) =>
    glebas.findIndex((_, j) => j !== k && aneis[j].some((x) => x.v === a) && aneis[j].some((x) => x.v === b));

  return anel.map(({ v, i }, j) => {
    const prox = anel[(j + 1) % anel.length].v;
    let lado: Confrontacao;
    if (vizinhos(v, prox)) {
      // seguindo o perímetro no sentido da parte: o lado é o da aresta entre os
      // dois, cuja confrontação é a do vértice que ABRE a aresta no imóvel
      const abre = (posGeo.get(v)! + 1) % nG === posGeo.get(prox)! ? i : geo[posGeo.get(prox)!].i;
      lado = confs[abre];
    } else {
      const viz = outraParte(v, prox);
      lado = {
        ...SEM_CONFRONTACAO,
        descritivo: viz >= 0 ? descritivoDaParte(servico, glebas[viz]) : "",
        tipo_limite: "LA1",
        apelido_txt: viz >= 0 ? glebas[viz].nome : null,
      };
    }
    return {
      ...v,
      id: crypto.randomUUID(),
      servico_id: novoServicoId,
      ordem: j,
      // confrontação só mora no M; os outros vértices vão limpos
      ...(v.tipo === "M" ? lado : SEM_CONFRONTACAO),
    };
  });
}

/** O cabeçalho do GEO individual: o imóvel de origem com o herdeiro como proprietário. */
export function servicoDaParte(servico: Servico, g: Gleba): Partial<Servico> {
  const { id: _id, created_at: _c, ...campos } = servico;
  return {
    ...campos,
    tem_glebas: false,
    divisao: null,
    status: "rascunho",
    denominacao: denominacaoDaParte(servico, g),
    denominacao_parcela: null,
    detentor_nome: (g.detentor_nome ?? "").trim() || servico.detentor_nome,
    detentor_cpf: (g.detentor_nome ?? "").trim() ? (g.detentor_cpf ?? null) : servico.detentor_cpf,
    // o resto da pessoa é do herdeiro, não do espólio: fica para preencher
    ...((g.detentor_nome ?? "").trim() ? {
      detentor_rg: null, detentor_genero: null, endereco_detentor: null,
      requerente2_nome: null, requerente2_cpf: null, requerente2_genero: null,
      is_espolio: false, inventariante_nome: null, inventariante_cpf: null, inventariante_rg: null,
    } : {}),
    area_matricula_ha: null,
  };
}
