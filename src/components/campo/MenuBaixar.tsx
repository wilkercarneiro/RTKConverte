// "Baixar ▾" da medição: os mesmos formatos da Exportar a área, gerados no
// próprio aparelho (sem rede, sem serviço, sem crédito). O menu usa o estilo
// do exportar.css e vai para o <body> com position: fixed (zoom .8 da raiz →
// lib/zoom.ts). No celular ele abre para CIMA quando o botão está embaixo.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as TeclaReact } from "react";
import { createPortal } from "react-dom";
import { FORMATOS_AREA } from "../../lib/exportar/formatos.ts";
import type { FormatoArea } from "../../lib/exportar/formatos.ts";
import { baixarBlob } from "../../lib/entregas";
import { arquivoDaMedicao } from "../../lib/campo/arquivos.ts";
import type { Medicao } from "../../lib/campo/tipos.ts";
import { telaParaCss } from "../../lib/zoom";
import { avisar } from "../ui";
import "../exportar.css";

const LARGURA = 300;

export function MenuBaixar({ medicao, className }: { medicao: Medicao; className?: string }) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const [gerando, setGerando] = useState(false);
  const botao = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const aberto = pos !== null;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!menu.current?.contains(alvo) && !botao.current?.contains(alvo)) setPos(null);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setPos(null); botao.current?.focus(); } };
    const fechar = () => setPos(null);
    addEventListener("pointerdown", fora);
    addEventListener("keydown", tecla);
    addEventListener("resize", fechar);
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => {
      removeEventListener("pointerdown", fora);
      removeEventListener("keydown", tecla);
      removeEventListener("resize", fechar);
    };
  }, [aberto]);

  function abrir() {
    const r = botao.current?.getBoundingClientRect();
    if (!r) return;
    const largura = telaParaCss(innerWidth), altura = telaParaCss(innerHeight);
    const left = Math.max(8, Math.min(largura - LARGURA - 8, telaParaCss(r.left)));
    // metade de baixo da tela: abre para cima
    if (telaParaCss(r.top) > altura / 2) setPos({ left, bottom: altura - telaParaCss(r.top) + 6 });
    else setPos({ left, top: telaParaCss(r.bottom) + 6 });
  }

  async function baixar(f: FormatoArea) {
    setPos(null);
    setGerando(true);
    try {
      const a = await arquivoDaMedicao(medicao, f);
      baixarBlob(new Blob([a.dados as BlobPart], { type: a.tipo }), a.nome);
    } catch (e) {
      avisar("erro", `Não foi possível gerar o arquivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGerando(false);
    }
  }

  function andar(e: TeclaReact<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const itens = [...(menu.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    itens[(i + (e.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length]?.focus({ preventScroll: true });
  }

  return (
    <>
      <button ref={botao} type="button" className={className} aria-haspopup="menu" aria-expanded={aberto}
        disabled={gerando || medicao.vertices.length === 0} onClick={() => (aberto ? setPos(null) : abrir())}>
        {gerando ? "Gerando…" : "Baixar ▾"}
      </button>
      {pos && createPortal(
        <div ref={menu} className="exportar-menu campo-menu-baixar" role="menu" aria-label="Baixar a medição"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: LARGURA }} onKeyDown={andar}>
          {FORMATOS_AREA.map((f) => (
            <button key={f.id} type="button" role="menuitem" onClick={() => baixar(f.id)}>
              <b>{f.rotulo}</b><small>{f.serve}</small>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
