// O sistema roda a 80% em tela de computador (pedido de 03/11/2026: "diminuir a
// proporção em uns 20%"): `zoom` na raiz, em styles.css, como o zoom de 80% do
// navegador. No Chrome (128+) e no Firefox (126+) o zoom é o padronizado:
//   * getBoundingClientRect, clientX/clientY e innerWidth vêm na escala da TELA;
//   * offsetWidth/clientWidth, left/top/transform do CSS e o viewBox seguem em px
//     do CSS (a escala da página).
// Quem mistura os dois (posição do clique × tamanho da caixa, balão com
// position: fixed) converte por aqui. Conta por razão (fração da largura) não
// precisa: as duas pontas estão na mesma escala.

/** Zoom do CSS na raiz da página (1 quando não há). */
export function zoomDaPagina(): number {
  if (typeof document === "undefined") return 1;
  const z = parseFloat(getComputedStyle(document.documentElement).zoom);
  return z > 0 && Number.isFinite(z) ? z : 1;
}

/** Escala tela ÷ CSS de um elemento (pega também transform: scale de um ancestral). */
export function escalaDe(el: Element): number {
  const r = el.getBoundingClientRect();
  const w = el instanceof HTMLElement ? el.offsetWidth : (el as SVGSVGElement).clientWidth;
  const k = w > 0 ? r.width / w : zoomDaPagina();
  return k > 0 && Number.isFinite(k) ? k : 1;
}

/** Ponto do evento em px do CSS, a partir do canto do elemento. */
export function pontoNoElemento(el: Element, e: { clientX: number; clientY: number }): [number, number] {
  const r = el.getBoundingClientRect();
  const k = escalaDe(el);
  return [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
}

/** Coordenada da tela (clientX, getBoundingClientRect, innerWidth) → px do CSS para position: fixed. */
export const telaParaCss = (v: number): number => v / zoomDaPagina();
