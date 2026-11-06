// "Baixar ▾" da Consultar imóvel: a área em KML, DXF, SHP, GPX, KMZ, GeoJSON,
// CSV… gerada AQUI, no navegador, pelo mesmo exportarArea dos serviços (a área
// não é de serviço: não há o que conferir no banco). O menu vai para o <body>
// com posição fixa, convertida pelo zoom .8 (lib/zoom.ts), como o ExportarArea.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as TeclaReact } from "react";
import { createPortal } from "react-dom";
import { FORMATOS_AREA } from "../../lib/exportar/formatos.ts";
import type { FormatoArea } from "../../lib/exportar/formatos.ts";
import { baixarBlob } from "../../lib/entregas";
import { telaParaCss } from "../../lib/zoom";
import { camadasDaArea, fusoDaArea } from "../../lib/consulta/geometria.ts";
import type { LonLat } from "../../lib/consulta/geometria.ts";
import { avisar } from "../ui";

const LARGURA = 300;

export function BaixarArea({ nome, aneis, nomes, rotulo = "Baixar a área ▾" }: {
  nome: string; aneis: LonLat[][]; nomes?: (string | null)[]; rotulo?: string;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [gerando, setGerando] = useState<FormatoArea | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const aberto = pos !== null;

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { const t = e.target as Node; if (!menu.current?.contains(t) && !botao.current?.contains(t)) setPos(null); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") { setPos(null); botao.current?.focus(); } };
    const fechar = () => setPos(null);
    addEventListener("mousedown", fora); addEventListener("keydown", tecla); addEventListener("resize", fechar); addEventListener("scroll", fechar, true);
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => { removeEventListener("mousedown", fora); removeEventListener("keydown", tecla); removeEventListener("resize", fechar); removeEventListener("scroll", fechar, true); };
  }, [aberto]);

  function abrir() {
    const r = botao.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(telaParaCss(innerWidth) - LARGURA - 8, telaParaCss(r.left)));
    // sem espaço embaixo (celular, fim da tela): abre para cima
    const altura = FORMATOS_AREA.length * 42 + 12;
    const embaixo = telaParaCss(r.bottom) + 6;
    const top = embaixo + altura > telaParaCss(innerHeight) - 8 ? Math.max(8, telaParaCss(r.top) - altura - 6) : embaixo;
    setPos({ left, top });
  }

  async function baixar(f: FormatoArea) {
    setPos(null);
    setGerando(f);
    try {
      const { exportarArea } = await import("../../lib/exportar/index.ts");
      const arq = await exportarArea(camadasDaArea(nome, aneis, nomes), f, { fuso: fusoDaArea(aneis), nome });
      baixarBlob(new Blob([arq.dados as BlobPart], { type: arq.tipo }), arq.nome);
    } catch (e) {
      avisar("erro", `Não foi possível gerar o arquivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGerando(null);
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
      <button ref={botao} type="button" aria-haspopup="menu" aria-expanded={aberto} disabled={gerando !== null}
        title="A área em KML, DXF, SHP, GPX, GeoJSON… (SIRGAS 2000)" onClick={() => (aberto ? setPos(null) : abrir())}>
        {gerando ? "Gerando…" : rotulo}
      </button>
      {pos && createPortal(
        <div ref={menu} className="cbx-menu" role="menu" aria-label="Baixar a área" style={{ left: pos.left, top: pos.top, width: LARGURA }} onKeyDown={andar}>
          {FORMATOS_AREA.map((f) => (
            <button key={f.id} type="button" role="menuitem" onClick={() => void baixar(f.id)}>
              {f.rotulo}<small>{f.serve}</small>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
