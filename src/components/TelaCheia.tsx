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
import "./telacheia.css";

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
// a lista dos marcados: desmarcar por ela, não subindo de novo pela área — a
// área pode já ter saído da página (trocou de tela em tela cheia) e aí não tem
// mais pais, e .app/#root ficavam marcados para sempre
let marcados: HTMLElement[] = [];
function marcarAncestrais(el: HTMLElement | null, ligar: boolean): void {
  if (!ligar) {
    for (const p of marcados) p.classList.remove("tela-cheia-ancestral");
    marcados = [];
    return;
  }
  for (let p = el?.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    p.classList.add("tela-cheia-ancestral");
    marcados.push(p);
  }
}

// ---------------------------------------------------------------------------
// Celular e tablet (até 900 px) — pedido do Wilker (06/11): "clicou na área,
// fica em tela cheia para manusear pelo celular… botão de X para fechar".
//  - fora da tela cheia a área é só uma PRÉVIA: um véu (::after, casca.css)
//    recebe o toque — o mapa não rouba a rolagem da página e nada é mexido sem
//    querer; tocar abre a tela cheia;
//  - na tela cheia, uma barra própria no alto (fora do React, no <body>): ✕,
//    o nome do que se ajusta e "Pronto";
//  - o voltar do Android fecha a tela cheia em vez de sair do serviço (uma
//    entrada no histórico, sem trocar o endereço).
// Áreas com [data-sem-toque] (o Medir no campo, que já é a tela inteira) ficam fora.
// ---------------------------------------------------------------------------
const CELULAR = "(max-width: 900px)";
export const ehCelular = (): boolean => typeof window !== "undefined" && window.matchMedia(CELULAR).matches;

const TITULOS: [string, string][] = [
  [".lot-area-trabalho.dv-prancheta", "Prancheta"],
  [".lot-area-trabalho", "Prancheta do loteamento"],
  [".car-area-trabalho", "Mapa do CAR"],
  [".tp-trabalho", "Terraplanagem"],
  [".ct-editor", "Pontos e ligações"],
  [".lt-mapa", "Ajustar pontos"],
  [".mapa-cert", "Mapa"],
  [".planta-cert", "Planta certificada"],
  [".relevo", "Relevo"],
  [".consulta-mapa", "Mapa da consulta"],
];
function tituloDe(el: HTMLElement): string {
  return el.dataset.tituloTelaCheia || TITULOS.find(([sel]) => el.matches(sel))?.[1] || "Tela cheia";
}

let barra: HTMLDivElement | null = null;
function mostrarBarra(el: HTMLElement | null): void {
  if (!el || el.matches("[data-sem-toque]")) { barra?.remove(); barra = null; return; }
  if (!barra) {
    barra = document.createElement("div");
    barra.className = "tc-barra";
    barra.setAttribute("role", "toolbar");
    barra.innerHTML = '<button type="button" class="tc-fechar" aria-label="Fechar a tela cheia">'
      + '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>'
      + '<b class="tc-titulo"></b><button type="button" class="tc-pronto">Pronto</button>';
    barra.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => fecharTelaCheia()));
    document.body.appendChild(barra);
  }
  barra.querySelector(".tc-titulo")!.textContent = tituloDe(el);
}

/** Fecha a tela cheia ativa (o ✕ e o "Pronto" da barra do celular). */
export function fecharTelaCheia(): void {
  if (!ativa) return;
  delete ativa.dataset.telaCheiaNavegador;
  aplicar(null);
  sairDoNavegador();
}

function aplicar(el: HTMLElement | null): void {
  if (ativa === el) return;
  // avisa as áreas que vão mudar de tamanho ANTES da troca (o BotaoTelaCheia de
  // cada uma chama o onAlternar: a prancheta guarda a vista para reescalar)
  for (const a of [ativa, el]) a?.dispatchEvent(new CustomEvent("telacheia-antes"));
  ativa?.classList.remove("em-tela-cheia");
  marcarAncestrais(ativa, false);
  ativa = el;
  marcarAncestrais(ativa, true);
  ativa?.classList.add("em-tela-cheia");
  document.documentElement.classList.toggle("com-tela-cheia", !!ativa);
  document.documentElement.classList.toggle("com-tela-cheia-celular", !!ativa && ehCelular() && !ativa.matches("[data-sem-toque]"));
  mostrarBarra(ativa && ehCelular() ? ativa : null);
  // voltar do Android: entra uma entrada no histórico (mesmo endereço); sair
  // pelo ✕ consome essa entrada para o próximo voltar não ficar "morto"
  if (ativa && ehCelular() && !(history.state as { telaCheia?: boolean } | null)?.telaCheia) {
    history.pushState({ ...(history.state ?? {}), telaCheia: true }, "");
  } else if (!ativa && (history.state as { telaCheia?: boolean } | null)?.telaCheia) {
    voltandoPelaTelaCheia = true;
    history.back();
  }
  // mapas que só se medem no resize da janela (MapLibre) e os que se medem pelo
  // ResizeObserver (pranchetas) acompanham o tamanho novo
  requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
  avisar();
}

let voltandoPelaTelaCheia = false;
if (typeof window !== "undefined") {
  // o voltar do Android (ou do navegador) com a tela cheia aberta: só fecha
  window.addEventListener("popstate", () => {
    if (voltandoPelaTelaCheia) { voltandoPelaTelaCheia = false; return; }
    if (ativa) { delete ativa.dataset.telaCheiaNavegador; aplicar(null); sairDoNavegador(); }
  });
  // toque na prévia (celular): abre a tela cheia em vez de mexer no desenho.
  // Fase de captura: chega antes de qualquer ouvinte do mapa ou da prancheta.
  const abrirPeloToque = (e: Event) => {
    if (!ehCelular()) return;
    const alvo = e.target as HTMLElement | null;
    const area = alvo?.closest?.<HTMLElement>(ALVO);
    if (!area || area === ativa || area.matches("[data-sem-toque]") || area.closest(".em-tela-cheia")) return;
    // área com formulário e mapa juntos (Terraplanagem): só o toque no mapa abre
    if (area.matches("[data-toque-parcial]") && !alvo?.closest("[data-alvo-toque]")) return;
    // nada chega ao mapa/prancheta; o arrastar continua rolando a PÁGINA
    // (sem preventDefault: o véu da prévia tem touch-action: pan-y)
    e.stopPropagation();
    if (e.type === "click") { e.preventDefault(); alternarTelaCheia(area); }
  };
  for (const tipo of ["pointerdown", "mousedown", "touchstart", "click"]) {
    window.addEventListener(tipo, abrirPeloToque, { capture: true });
  }
  // girou o aparelho / mudou de tamanho: a barra acompanha
  window.matchMedia(CELULAR).addEventListener?.("change", () => {
    mostrarBarra(ativa && ehCelular() ? ativa : null);
    document.documentElement.classList.toggle("com-tela-cheia-celular", !!ativa && ehCelular() && !ativa.matches("[data-sem-toque]"));
  });
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
  const clicar = useCallback(() => { alternarTelaCheia(ref.current); }, []);
  // entrar/sair por qualquer caminho (este botão, o toque na prévia do celular,
  // o ✕, o Esc, o voltar do Android): a área avisa antes de mudar de tamanho
  const alternou = useRef(onAlternar);
  alternou.current = onAlternar;
  useEffect(() => {
    const area = ref.current?.closest<HTMLElement>(ALVO);
    if (!area) return;
    const f = () => alternou.current?.();
    area.addEventListener("telacheia-antes", f);
    return () => area.removeEventListener("telacheia-antes", f);
  }, []);
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
          ? (ehCelular() ? <path d="M18 6 6 18M6 6l12 12" /> : <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />)
          : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
      </svg>
      {rotulo && <span>{cheia ? "Sair da tela cheia" : "Tela cheia"}</span>}
    </button>
  );
}
