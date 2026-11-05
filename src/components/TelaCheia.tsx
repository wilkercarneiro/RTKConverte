// Tela cheia das áreas de trabalho com mapa — pedido do Wilker (05/11/2026):
// "possibilidade de abrir em tela cheia o mapa, para melhor visualização e
// trabalho".
//
// O botão mora dentro do mapa, mas o que vai para a tela cheia é a ÁREA DE
// TRABALHO que o contém (ferramentas + desenho + painel + linha de comando):
// sem o painel e as ferramentas, a tela cheia serviria só para olhar. A área é
// o ancestral mais próximo marcado com [data-tela-cheia] — ou, nas pranchetas
// que já existiam, .lot-area-trabalho / .car-area-trabalho.
//
// Como: a área ganha a classe .em-tela-cheia (fixa por cima de tudo, abaixo dos
// diálogos e avisos) e o navegador entra em tela cheia com a PÁGINA inteira
// (document.documentElement), não com a área. Se fosse a área, só ela e o que
// está dentro dela apareceriam (top layer): os diálogos de confirmação, os
// avisos e os menus, que moram no <body>, sumiriam. Sair: o mesmo botão ou Esc
// (o navegador sai da tela cheia e a área volta junto).
import { useCallback, useEffect, useRef, useState } from "react";

const ALVO = "[data-tela-cheia], .lot-area-trabalho, .car-area-trabalho";

/** A área de trabalho em tela cheia agora (uma por vez). */
let ativa: HTMLElement | null = null;
const ouvintes = new Set<() => void>();
const avisar = () => { ouvintes.forEach((f) => f()); };

function sairDoNavegador(): void {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { /* já saiu */ });
}

/**
 * Os ancestrais da área perdem, enquanto ela estiver em tela cheia, o que cria
 * contexto de empilhamento (z-index, transform, filtro, animação, contain): sem
 * isso o z-index da área vale só dentro do ancestral, e o menu lateral, a
 * barra de gerar e cabeçalhos fixos de tabela apareciam POR CIMA do mapa
 * (visto no mapa do SIGEF da etapa Confrontantes).
 */
function marcarAncestrais(el: HTMLElement | null, ligar: boolean): void {
  for (let p = el?.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    p.classList.toggle("tela-cheia-ancestral", ligar);
  }
}

function aplicar(el: HTMLElement | null): void {
  if (ativa === el) return;
  ativa?.classList.remove("em-tela-cheia");
  marcarAncestrais(ativa, false);
  ativa = el;
  marcarAncestrais(ativa, true);
  ativa?.classList.add("em-tela-cheia");
  document.documentElement.classList.toggle("com-tela-cheia", !!ativa);
  // mapas que só se medem no resize da janela (MapLibre) e os que se medem pelo
  // ResizeObserver (pranchetas) acompanham o tamanho novo
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  avisar();
}

// Esc no navegador (ou F11 de volta): a área sai junto
if (typeof document !== "undefined") {
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && ativa?.dataset.telaCheiaNavegador === "1") {
      delete ativa.dataset.telaCheiaNavegador;
      aplicar(null);
    }
  });
}

/** Liga/desliga a tela cheia da área de trabalho que contém `de`. */
export function alternarTelaCheia(de: HTMLElement | null): void {
  const area = de?.closest<HTMLElement>(ALVO) ?? null;
  if (!area) return;
  if (ativa === area) {
    delete area.dataset.telaCheiaNavegador;
    aplicar(null);
    sairDoNavegador();
    return;
  }
  aplicar(area);
  // a tela cheia do navegador é um extra (ganha a barra de endereço e as abas):
  // se ele recusar (permissão, iframe), a área continua cobrindo a página
  const pedido = document.documentElement.requestFullscreen?.({ navigationUI: "hide" });
  if (pedido) {
    area.dataset.telaCheiaNavegador = "1";
    pedido.catch(() => { delete area.dataset.telaCheiaNavegador; });
  }
}

/** Esta área está em tela cheia? (re-renderiza quando muda) */
export function useTelaCheia(ref: React.RefObject<HTMLElement>): boolean {
  const [, setVersao] = useState(0);
  useEffect(() => {
    const f = () => setVersao((v) => v + 1);
    ouvintes.add(f);
    return () => { ouvintes.delete(f); };
  }, []);
  const area = ref.current?.closest(ALVO) ?? null;
  return !!area && area === ativa;
}

// sem Esc do navegador (tela cheia recusada): Esc fora de campo de texto sai.
// Fica no fim da fila (bubble no window) para não roubar o Esc de quem cancela
// um arraste ou um desenho na prancheta: esses chamam preventDefault.
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !ativa || e.defaultPrevented || document.fullscreenElement) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    if (document.querySelector(".dialogo-fundo")) return;
    aplicar(null);
  });
}

/**
 * Botão de tela cheia para pôr nos controles de um mapa. `onAlternar` avisa o
 * mapa antes da troca (a prancheta usa para manter a mesma vista, só maior).
 */
export function BotaoTelaCheia({ className, onAlternar, rotulo = false }: {
  className?: string; onAlternar?: () => void; rotulo?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const cheia = useTelaCheia(ref);
  const clicar = useCallback(() => { onAlternar?.(); alternarTelaCheia(ref.current); }, [onAlternar]);
  // a tela saiu do ar em tela cheia (trocou de rota, fechou o serviço): sem
  // isto a página ficava presa sem rolagem, com a classe no <html>
  useEffect(() => () => {
    queueMicrotask(() => {
      if (ativa && !ativa.isConnected) {
        delete ativa.dataset.telaCheiaNavegador;
        aplicar(null);
        sairDoNavegador();
      }
    });
  }, []);
  const titulo = cheia ? "Sair da tela cheia (Esc)" : "Tela cheia: o mapa, as ferramentas e o painel ocupam a tela toda";
  return (
    <button ref={ref} type="button" className={`botao-tela-cheia${cheia ? " ativa" : ""}${className ? ` ${className}` : ""}`}
      title={titulo} aria-label={titulo} aria-pressed={cheia}
      onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onClick={clicar}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {cheia
          ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
          : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
      </svg>
      {rotulo && <span>{cheia ? "Sair da tela cheia" : "Tela cheia"}</span>}
    </button>
  );
}
