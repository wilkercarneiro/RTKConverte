// "Exportar ▾" no cabeçalho de todo serviço (GEO, loteamento, CAR): a área em
// KML, DXF, pacote CAD, GPX, SHP, KMZ, GeoJSON, CSV de pontos ou TXT para a
// coletora.
//
// O arquivo sai do SERVIDOR (função `entregar`, saída "area"), que lê o serviço
// do banco e confere o imóvel (contorno assinado, 0039): a tela só escolhe o
// formato e baixa. Antes de pedir, grava o que estiver pendente (`antes`) —
// senão o arquivo sairia com o desenho do último autossalvamento.
//
// O menu vai para o <body> com position: fixed: o cabeçalho é sticky, e com o
// zoom .8 da raiz a posição do botão (getBoundingClientRect, na escala da tela)
// passa por lib/zoom.ts antes de virar left/top do CSS.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as TeclaReact } from "react";
import { createPortal } from "react-dom";
import { baixarEntrega } from "../lib/entregas";
import { FORMATOS_AREA } from "../lib/exportar/formatos.ts";
import type { FormatoArea } from "../lib/exportar/formatos.ts";
import { temPermissao } from "../lib/permissoes";
import { telaParaCss } from "../lib/zoom";
import { avisar, confirmar } from "./ui";
import "./exportar.css";

/** Largura do menu em px do CSS (cabe "Pacote CAD (.zip)" com o "para que serve" ao lado). */
const LARGURA = 330;

export function ExportarArea({ servicoId, temPerimetro, antes }: {
  servicoId: string;
  /** sem perímetro (menos de 3 vértices, projeto sem imóvel) o botão não aparece */
  temPerimetro: boolean;
  /** grava o que a tela tem pendente antes de pedir o arquivo */
  antes?: () => Promise<unknown>;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [gerando, setGerando] = useState<FormatoArea | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const aberto = pos !== null;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!menu.current?.contains(alvo) && !botao.current?.contains(alvo)) setPos(null);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPos(null);
      botao.current?.focus();
    };
    // a posição foi tirada do botão: rolar ou redimensionar a deixaria solta na tela
    const fechar = () => setPos(null);
    addEventListener("mousedown", fora);
    addEventListener("keydown", tecla);
    addEventListener("resize", fechar);
    addEventListener("scroll", fechar, true);
    // o primeiro formato recebe o foco: pelo teclado, a lista já está na mão
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => {
      removeEventListener("mousedown", fora);
      removeEventListener("keydown", tecla);
      removeEventListener("resize", fechar);
      removeEventListener("scroll", fechar, true);
    };
  }, [aberto]);

  if (!temPerimetro || !temPermissao("documentos.gerar")) return null;

  function abrir() {
    const r = botao.current?.getBoundingClientRect();
    if (!r) return;
    // alinhado pela direita do botão, sem sair da tela
    const left = Math.max(8, Math.min(telaParaCss(innerWidth) - LARGURA - 8, telaParaCss(r.right) - LARGURA));
    setPos({ left, top: telaParaCss(r.bottom) + 6 });
  }

  async function exportar(f: FormatoArea) {
    setPos(null);
    // o primeiro arquivo do serviço (exportar ou gerar) fixa o imóvel dele
    // (0039: 1 crédito = 1 imóvel). Exportar para "conferir" com o fuso ou os
    // pontos errados prendia o serviço ao desenho errado — avisa uma vez.
    const chave = `vertces.exportou.${servicoId}`;
    let jaAvisou = false;
    try { jaAvisou = localStorage.getItem(chave) === "1"; } catch { /* sem armazenamento: avisa */ }
    if (!jaAvisou) {
      const ok = await confirmar({
        titulo: "Exportar fixa o imóvel deste serviço",
        texto: "O primeiro arquivo do serviço — exportado ou gerado — amarra o serviço a este desenho (1 crédito = 1 imóvel). Depois dá para corrigir pontos, mas não trocar de imóvel. Confira o fuso e o perímetro antes.",
        confirmar: "Está certo, exportar",
        cancelar: "Voltar e conferir",
      });
      if (!ok) return;
      try { localStorage.setItem(chave, "1"); } catch { /* segue */ }
    }
    setGerando(f);
    try {
      await antes?.();
      await baixarEntrega({ servico_id: servicoId, saida: "area", formato: f });
    } catch (e) {
      avisar("erro", `Não foi possível exportar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGerando(null);
    }
  }

  /** Setas andam pela lista (dá a volta nas pontas). */
  function andar(e: TeclaReact<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const itens = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    itens[(i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length]?.focus({ preventScroll: true });
  }

  return (
    <>
      <button ref={botao} type="button" className="exportar-btn" aria-haspopup="menu" aria-expanded={aberto}
        disabled={gerando !== null} title="A área do serviço em outros formatos"
        onClick={() => (aberto ? setPos(null) : abrir())}>
        {gerando ? "Gerando…" : "Exportar ▾"}
      </button>
      {pos && createPortal(
        <div ref={menu} className="exportar-menu" role="menu" aria-label="Exportar a área"
          style={{ left: pos.left, top: pos.top, width: LARGURA }} onKeyDown={andar}>
          {FORMATOS_AREA.map((f) => (
            <button key={f.id} type="button" role="menuitem" onClick={() => exportar(f.id)}>
              <b>{f.rotulo}</b><small>{f.serve}</small>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
