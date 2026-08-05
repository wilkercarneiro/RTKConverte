// Regra única de "a que trecho pertence cada vértice/segmento".
// Um vértice M inicia uma confrontação, que vai até o próximo M — a mesma decisão
// que planta.ts usa para desenhar. Isolada aqui para o preview mostrar exatamente
// o que sairá no PDF, e para ser testável. Ver ARQUITETURA-TRECHOS.md.

/** Trecho vigente num vértice: o último início <= ordem, com volta no anel. */
export function trechoDoVertice<T extends { vertice_inicio_ordem: number }>(
  trechosOrdenados: T[],
  ordem: number,
): T | null {
  if (trechosOrdenados.length === 0) return null;
  let idx = -1;
  for (let i = 0; i < trechosOrdenados.length; i++) {
    if (trechosOrdenados[i].vertice_inicio_ordem <= ordem) idx = i;
  }
  // antes do primeiro início → pertence ao último trecho, dando a volta no perímetro
  if (idx < 0) idx = trechosOrdenados.length - 1;
  return trechosOrdenados[idx];
}

/** Colunas de confrontação de um vértice M — zeradas quando ele deixa de ser M. */
export interface Confrontacao {
  descritivo: string | null;
  tipo_limite: string | null;
  eh_via: boolean;
  cns: string | null;
  matricula: string | null;
  apelido_txt: string | null;
}

export const SEM_CONFRONTACAO: Confrontacao = {
  descritivo: null, tipo_limite: null, eh_via: false,
  cns: null, matricula: null, apelido_txt: null,
};

// Faixa de domínio pública reconhecida pelo rótulo do trecho. Espelha RE_VIA de
// supabase/functions/_shared/pecas.ts — as duas precisam andar juntas, senão a
// prévia da tela mostra faixas diferentes das que saem nas peças.
const RE_VIA =
  /\b(ESTRADA|RODOVIA|CORREDOR|SERVID[ÃA]O|LINHA\s+F[ÉE]RREA|FERROVIA|FERROVI[ÁA]RI[AO]|LEITO\s+FERROVI[ÁA]RIO|RIO|RIACHO|C[ÓO]RREGO|LAGOA?|A[ÇC]UDE|FAIXA\s+DE\s+DOM[ÍI]NIO|(?:BR|BA|AL|SE|PE|PB|RN|CE|PI|MA|TO|GO|MG|ES|RJ|SP|PR|SC|RS|MS|MT|DF|RO|AC|AM|RR|PA|AP)[-\s]?\d{2,3})\b/i;

/**
 * Faixas de domínio da planta: trecho marcado como via, ou cujo rótulo é uma
 * (CORREDOR, ESTRADA, LINHA FÉRREA, BA 408, BR 116…). Sai uma declaração de
 * faixa de domínio por via distinta — não há campo para digitar a via.
 */
export function viasDaPlanta(
  trechos: { descritivo?: string | null; apelido_txt?: string | null; eh_via?: boolean | null }[],
): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const t of trechos) {
    const rotulo = (t.descritivo || t.apelido_txt || "").split("\\")[0].trim();
    if (!rotulo) continue;
    // "(MATR.4.403/CNS...) FAZENDA RIO CLARO" é imóvel, não via — o rótulo com
    // etiqueta entre parênteses e o descritivo com CPF nunca viram faixa sozinhos
    const ehImovel = /^\([^)]*\)/.test(rotulo) || /CPF\s*:/i.test(t.descritivo ?? "");
    const ehVia = !!t.eh_via || (!ehImovel && RE_VIA.test(rotulo));
    if (!ehVia) continue;
    const k = rotulo.toUpperCase();
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(rotulo);
  }
  return out;
}

/**
 * Move a confrontação de um vértice M para outro vértice do perímetro, levando
 * junto descritivo, apelido, tipo de limite, faixa de domínio, CNS e matrícula.
 *
 * O ponto de início costuma vir errado do TXT — remover e recriar o trecho
 * custaria redigitar tudo, então mover é uma operação de primeira classe.
 *
 * Regras: o destino vira M; a origem volta ao tipo que tinha antes (V se foi
 * inserido à mão, P caso contrário) e fica sem confrontação. Movimento inválido
 * (origem que não é M, destino inexistente ou que já é M) devolve a lista
 * intacta — quem chama decide o que dizer ao operador.
 */
export function moverConfrontacao<
  T extends Confrontacao & { ordem: number; tipo: "M" | "P" | "V"; inserido_manual: boolean },
>(vertices: T[], deOrdem: number, paraOrdem: number): T[] {
  if (deOrdem === paraOrdem) return vertices;
  const origem = vertices.find((v) => v.ordem === deOrdem);
  const destino = vertices.find((v) => v.ordem === paraOrdem);
  if (!origem || origem.tipo !== "M" || !destino || destino.tipo === "M") return vertices;
  const conf: Confrontacao = {
    descritivo: origem.descritivo, tipo_limite: origem.tipo_limite, eh_via: origem.eh_via,
    cns: origem.cns, matricula: origem.matricula, apelido_txt: origem.apelido_txt,
  };
  return vertices.map((v) => {
    if (v.ordem === deOrdem) return { ...v, tipo: v.inserido_manual ? "V" as const : "P" as const, ...SEM_CONFRONTACAO };
    if (v.ordem === paraOrdem) return { ...v, ...conf, tipo: "M" as const };
    return v;
  });
}

/**
 * Índices dos segmentos (do vértice i ao i+1, no anel) que saem como faixa de
 * domínio pública — linha dupla vermelha na planta. Um segmento é via quando o
 * trecho do seu vértice INICIAL é via, que é como planta.ts decide.
 */
export function segmentosDeVia(
  verticesOrdenados: { ordem: number }[],
  trechosOrdenados: { vertice_inicio_ordem: number; eh_via: boolean }[],
): number[] {
  const out: number[] = [];
  verticesOrdenados.forEach((v, i) => {
    if (trechoDoVertice(trechosOrdenados, v.ordem)?.eh_via) out.push(i);
  });
  return out;
}
