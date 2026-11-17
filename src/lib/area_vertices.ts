// O que o TXT do levantamento não carrega e o serviço novo precisa: a
// confrontação COMPLETA de cada trecho (descritivo com proprietário, CPF,
// matrícula/CNS, tipo de limite, via, numerado, nome na planta) e o método de
// posicionamento de cada vértice (PG1, PG6…). O rótulo do TXT leva só o NOME do
// confrontante, que basta para o leitor fazer o ponto voltar como M; o resto vai
// ao lado, na área transferida, e é reaplicado por coordenada logo depois que o
// serviço novo é criado (o parse-txt cria os vértices; aqui se completa).
//
// A confrontação é do LADO (ARQUITETURA-TRECHOS.md): o M do arquivo novo abre o
// trecho do lado que sai dele na ordem do TXT. Por isso cada M levado recebe os
// dados do M que, no serviço de origem, abria o trecho DAQUELE lado — que pode
// não ser o mesmo ponto, quando o TXT percorre o anel no sentido contrário ao
// do levantamento original.
import type { Vertice } from "./types";

type XY = [number, number];

/** A confrontação de um trecho, como mora no vértice M. */
export type Confrontacao = Pick<Vertice, "descritivo" | "tipo_limite" | "eh_via" | "cns" | "matricula" | "numerado" | "exibir_planta">;

/** Um vértice da área levada: onde está (E/N no fuso da área) e o que reaplicar nele. */
export interface VerticeLevado {
  e: number;
  n: number;
  metodo?: string | null;
  /** só nos M: a confrontação do trecho que sai deste ponto na ordem do TXT */
  confrontacao?: Confrontacao;
  /**
   * Vértice CERTIFICADO de um vizinho (unido do CSV do SIGEF na origem): volta
   * com o código, o tipo e o GMS do SIGEF — não pode virar vértice nosso, com
   * código novo (o TXT o traria como P, ou como M nosso).
   */
  certificado?: Pick<Vertice, "codigo" | "tipo" | "lat_gms" | "lon_gms">;
}

/**
 * Até onde dois pontos são o mesmo. O anel do TXT sai nas coordenadas CANÔNICAS
 * do memorial (o GMS arredondado a 0,001″ e reprojetado), que se afastam do E/N
 * gravado até ~1,5 cm por eixo (~2,2 cm na diagonal); 5 cm cobre isso com folga
 * e continua longe da distância entre dois vértices de verdade. Entre vários, vale o mais perto.
 */
export const MESMO_PONTO_M = 0.05;

type Origem = Pick<Vertice, "ordem" | "e" | "n" | "tipo" | "metodo">
  & Partial<Confrontacao> & Partial<Pick<Vertice, "codigo" | "codigo_provisorio" | "inserido_manual" | "lat_gms" | "lon_gms">>;

/**
 * Vértice certificado do vizinho: entrou pelo CSV do SIGEF (inserido, com o
 * código de lá desde a criação) e o código não é do nosso credenciado.
 * `prefixoProprio` = prefixo do credenciado da origem ("DSBN"); sem ele, todo
 * inserido com código definitivo conta como do vizinho.
 */
export function ehCertificadoDoVizinho(v: Origem, prefixoProprio: string | null): boolean {
  const c = v.codigo?.trim();
  if (!v.inserido_manual || !c || v.codigo_provisorio || c.startsWith("PROV-") || /^[A-Z]-\d+$/.test(c)) return false;
  return !prefixoProprio || !c.toUpperCase().startsWith(`${prefixoProprio.toUpperCase()}-`);
}

const confrontacaoDe = (v: Origem): Confrontacao => ({
  descritivo: v.descritivo ?? null, tipo_limite: v.tipo_limite ?? null, eh_via: !!v.eh_via,
  cns: v.cns ?? null, matricula: v.matricula ?? null, numerado: !!v.numerado, exibir_planta: v.exibir_planta !== false,
});

/**
 * Os vértices a levar, na ordem dos anéis do TXT (`aneis`, em UTM). `origem` são
 * as linhas de `vertices` do serviço de origem, em qualquer ordem.
 */
export function verticesLevados(origem: Origem[], aneis: XY[][], prefixoProprio: string | null = null): VerticeLevado[] {
  const seq = origem.filter((v) => Number.isFinite(Number(v.e)) && Number.isFinite(Number(v.n))).sort((a, b) => a.ordem - b.ordem);
  if (!seq.length) return [];
  // dono de cada lado: o M que abre o trecho, na sequência do levantamento, dando a
  // volta DENTRO do anel (a regra de geo.ts): um anel só = a sequência inteira
  // (glebas com divisa comum incluídas); PARTES = cada parte por si — o trecho
  // não passa de uma parte para a outra, e o lado que fecha a parte é dela.
  const chave = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const dono = new Map<string, Origem>();
  const darVolta = (s: Origem[]) => {
    const ms = s.filter((v) => v.tipo === "M");
    let atual: Origem | null = ms[ms.length - 1] ?? null;
    s.forEach((v, i) => {
      if (v.tipo === "M") atual = v;
      if (atual) dono.set(chave(v.ordem, s[(i + 1) % s.length].ordem), atual);
    });
  };
  const perto = (u: XY): Origem | null => {
    let melhor: Origem | null = null, d = MESMO_PONTO_M;
    for (const v of seq) {
      const dv = Math.hypot(Number(v.e) - u[0], Number(v.n) - u[1]);
      if (dv <= d) { d = dv; melhor = v; }
    }
    return melhor;
  };
  const porAnel = aneis.map((anel) => anel.map(perto));
  if (aneis.length <= 1) darVolta(seq);
  else for (const vs of porAnel) darVolta([...new Set(vs.filter((v): v is Origem => v !== null))].sort((a, b) => a.ordem - b.ordem));
  const out: VerticeLevado[] = [];
  aneis.forEach((anel, k) => {
    const vs = porAnel[k];
    anel.forEach((u, i) => {
      const v = vs[i];
      if (!v) return;
      const item: VerticeLevado = { e: u[0], n: u[1], metodo: v.metodo ?? null };
      if (ehCertificadoDoVizinho(v, prefixoProprio)) {
        item.certificado = { codigo: v.codigo!, tipo: v.tipo, lat_gms: v.lat_gms ?? "", lon_gms: v.lon_gms ?? "" };
      }
      const prox = vs[(i + 1) % anel.length];
      if (v.tipo === "M" && prox) {
        const d = dono.get(chave(v.ordem, prox.ordem));
        if (d) item.confrontacao = confrontacaoDe(d);
      }
      out.push(item);
    });
  });
  return out;
}

/** Uma gravação em `vertices`: os mesmos campos para vários ids. */
export interface Remendo { ids: string[]; campos: Partial<Vertice> }

/**
 * O que gravar nos vértices do serviço NOVO (já criados pelo parse-txt): o
 * método em todos que casam com um levado; a confrontação nos M. Remendos
 * iguais saem juntos (um UPDATE … IN para o método de quase todos).
 */
export function remendosDosVertices(novos: Pick<Vertice, "id" | "e" | "n" | "tipo" | "metodo">[], levados: VerticeLevado[]): Remendo[] {
  const grupos = new Map<string, Remendo>();
  for (const v of novos) {
    if (!v.id || !Number.isFinite(Number(v.e)) || !Number.isFinite(Number(v.n))) continue;
    let l: VerticeLevado | null = null, d = MESMO_PONTO_M;
    for (const x of levados) {
      const dx = Math.hypot(x.e - Number(v.e), x.n - Number(v.n));
      if (dx <= d) { d = dx; l = x; }
    }
    if (!l) continue;
    const campos: Partial<Vertice> = {};
    if (l.metodo && l.metodo !== v.metodo) campos.metodo = l.metodo;
    if (v.tipo === "M" && l.confrontacao) Object.assign(campos, l.confrontacao);
    // certificado do vizinho: o código, o tipo (V/P; M só se ele abre trecho aqui) e o GMS do SIGEF mandam
    if (l.certificado) {
      Object.assign(campos, {
        codigo: l.certificado.codigo, codigo_provisorio: false, inserido_manual: true,
        lat_gms: l.certificado.lat_gms, lon_gms: l.certificado.lon_gms,
        ...(v.tipo !== "M" && l.certificado.tipo !== "M" ? { tipo: l.certificado.tipo } : {}),
      });
    }
    if (!Object.keys(campos).length) continue;
    const k = JSON.stringify(campos);
    const g = grupos.get(k) ?? { ids: [], campos };
    g.ids.push(v.id);
    grupos.set(k, g);
  }
  return [...grupos.values()];
}
