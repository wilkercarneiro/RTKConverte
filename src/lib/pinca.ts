// Pinça no celular: dois dedos aproximam/afastam e arrastam a vista — em
// qualquer prancheta (loteamento, divisão, CAR, glebas, conferência do TXT).
//
// Escuta o elemento na fase de captura (antes dos ouvintes do React, que ficam
// na raiz): quando o segundo dedo encosta, o gesto de um dedo que já começou
// (arrastar uma quina, caixa de seleção, ponto de desenho) é cancelado pelo
// `cancelar` do editor, e daí até o último dedo sair nada mais chega a ele.
// Só toque (pointerType "touch"): mouse e caneta seguem como sempre.
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

export interface Pinca {
  /** aproxima pelo fator `f` (> 1 aproxima) mantendo parado o ponto (x, y) do elemento, em px do CSS */
  zoom: (f: number, x: number, y: number) => void;
  /** arrasta a vista dx, dy px do CSS (o desenho acompanha o dedo) */
  mover: (dx: number, dy: number) => void;
  /** o segundo dedo encostou: desfazer o que o primeiro começou. `recente`: o primeiro tocou há < 300 ms */
  cancelar?: (recente: boolean) => void;
}

export function usePinca(ref: RefObject<Element | null>, p: Pinca): void {
  const atual = useRef(p);
  atual.current = p;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dedos = new Map<number, { x: number; y: number }>();
    let pincando = false;
    let primeiro = 0;
    let fim = 0;
    let antes: { d: number; mx: number; my: number } | null = null;
    // px do CSS dentro do elemento (a página pode estar com zoom — lib/zoom.ts)
    const ponto = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const k = (el as HTMLElement).offsetWidth ? r.width / (el as HTMLElement).offsetWidth : 1;
      const kk = k || 1;
      return { x: (e.clientX - r.left) / kk, y: (e.clientY - r.top) / kk };
    };
    const medir = () => {
      const [a, b] = [...dedos.values()];
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };
    const down = (e: Event) => {
      const ev = e as PointerEvent;
      if (ev.pointerType !== "touch") return;
      dedos.set(ev.pointerId, ponto(ev));
      if (dedos.size === 1) { primeiro = performance.now(); return; }
      if (!pincando && dedos.size === 2) {
        pincando = true;
        atual.current.cancelar?.(performance.now() - primeiro < 300);
        antes = medir();
        try { (el as HTMLElement).setPointerCapture?.(ev.pointerId); } catch { /* sem captura */ }
      }
      if (pincando) { e.stopPropagation(); e.preventDefault(); }
    };
    const move = (e: Event) => {
      const ev = e as PointerEvent;
      if (ev.pointerType !== "touch" || !dedos.has(ev.pointerId)) return;
      dedos.set(ev.pointerId, ponto(ev));
      if (!pincando) return;
      e.stopPropagation(); e.preventDefault();
      if (dedos.size < 2 || !antes) return;
      const agora = medir();
      if (antes.d > 4 && agora.d > 4) atual.current.zoom(agora.d / antes.d, agora.mx, agora.my);
      atual.current.mover(agora.mx - antes.mx, agora.my - antes.my);
      antes = agora;
    };
    const up = (e: Event) => {
      const ev = e as PointerEvent;
      if (ev.pointerType !== "touch" || !dedos.has(ev.pointerId)) return;
      dedos.delete(ev.pointerId);
      if (pincando) {
        e.stopPropagation(); e.preventDefault();
        if (dedos.size < 2) antes = null;
        if (dedos.size === 0) { pincando = false; fim = performance.now(); }
      }
    };
    const opc = { capture: true, passive: false } as AddEventListenerOptions;
    el.addEventListener("pointerdown", down, opc);
    el.addEventListener("pointermove", move, opc);
    el.addEventListener("pointerup", up, opc);
    el.addEventListener("pointercancel", up, opc);
    // o clique que o navegador manda ao soltar não pode selecionar nada
    const clique = (e: Event) => { if (pincando || performance.now() - fim < 400) { e.stopPropagation(); e.preventDefault(); } };
    el.addEventListener("click", clique, opc);
    return () => {
      el.removeEventListener("pointerdown", down, opc);
      el.removeEventListener("pointermove", move, opc);
      el.removeEventListener("pointerup", up, opc);
      el.removeEventListener("pointercancel", up, opc);
      el.removeEventListener("click", clique, opc);
    };
  }, [ref]);
}
