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
