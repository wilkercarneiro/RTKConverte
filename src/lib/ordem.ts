// Reordenação dos vértices do perímetro.
//
// A ORDEM é a sequência do anel: dela saem o desenho, os trechos (um M inicia
// uma confrontação que vai até o próximo M), a numeração dos códigos e todos os
// documentos. Quando os pontos foram coletados fora de ordem, corrigir aqui
// corrige tudo — não há outra cópia da sequência para sair de sincronia.
//
// O operador seleciona vários pontos e move o BLOCO: para cima/baixo um passo,
// para o início, para o fim, ou para logo depois de um ponto escolhido. A ordem
// relativa dos selecionados é preservada (ou invertida, se pedido). Tudo o que
// o vértice carrega — confrontação, código, método — viaja com ele.

export type DestinoOrdem =
  | { tipo: "cima" }
  | { tipo: "baixo" }
  | { tipo: "inicio" }
  | { tipo: "fim" }
  /** logo depois do vértice de `ordem` (que não pode estar selecionado) */
  | { tipo: "depois"; ordem: number }
  /** inverte a sequência dos selecionados, mantendo as posições que ocupam */
  | { tipo: "inverter" };

/**
 * Devolve a lista com as ordens refeitas (0..n-1). Nunca perde nem duplica
 * vértice; com seleção vazia devolve a mesma sequência.
 */
export function reordenarVertices<T extends { ordem: number }>(
  vertices: T[],
  ehSelecionado: (v: T) => boolean,
  destino: DestinoOrdem,
): T[] {
  const vs = [...vertices].sort((a, b) => a.ordem - b.ordem);
  const sel = vs.map(ehSelecionado);
  const n = vs.length;
  if (!sel.some(Boolean)) return vs.map((v, i) => ({ ...v, ordem: i }));

  let out: T[];
  switch (destino.tipo) {
    case "cima": {
      out = [...vs];
      const s = [...sel];
      for (let i = 1; i < n; i++) {
        if (s[i] && !s[i - 1]) {
          [out[i - 1], out[i]] = [out[i], out[i - 1]];
          [s[i - 1], s[i]] = [s[i], s[i - 1]];
        }
      }
      break;
    }
    case "baixo": {
      out = [...vs];
      const s = [...sel];
      for (let i = n - 2; i >= 0; i--) {
        if (s[i] && !s[i + 1]) {
          [out[i], out[i + 1]] = [out[i + 1], out[i]];
          [s[i], s[i + 1]] = [s[i + 1], s[i]];
        }
      }
      break;
    }
    case "inicio":
      out = [...vs.filter((_, i) => sel[i]), ...vs.filter((_, i) => !sel[i])];
      break;
    case "fim":
      out = [...vs.filter((_, i) => !sel[i]), ...vs.filter((_, i) => sel[i])];
      break;
    case "depois": {
      const alvo = vs.findIndex((v) => v.ordem === destino.ordem);
      if (alvo < 0 || sel[alvo]) { out = vs; break; }
      const bloco = vs.filter((_, i) => sel[i]);
      out = [];
      vs.forEach((v, i) => {
        if (sel[i]) return;
        out.push(v);
        if (i === alvo) out.push(...bloco);
      });
      break;
    }
    case "inverter": {
      const bloco = vs.filter((_, i) => sel[i]).reverse();
      let k = 0;
      out = vs.map((v, i) => (sel[i] ? bloco[k++] : v));
      break;
    }
  }
  return out.map((v, i) => ({ ...v, ordem: i }));
}
