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
//
// No fim do menu, "Usar a área em outro serviço": a área deste serviço vira a
// entrada de um serviço novo (divisão, loteamento, CAR, conferência…) e a
// pessoa cai direto na etapa de início dele, com os pontos já carregados
// (lib/levarArea.ts). Não baixa arquivo nem fixa o imóvel deste serviço; o
// crédito é o do serviço novo, cobrado só no "Prosseguir" de lá.
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as TeclaReact } from "react";
import { createPortal } from "react-dom";
import { baixarEntrega } from "../lib/entregas";
import { FORMATOS_AREA } from "../lib/exportar/formatos.ts";
import type { FormatoArea } from "../lib/exportar/formatos.ts";
import { temPermissao } from "../lib/permissoes";
import { telaParaCss } from "../lib/zoom";
import { SERVICOS } from "../lib/modalidades";
import type { ChaveServico, DefinicaoServico } from "../lib/modalidades";
import { servicoLiberado } from "../lib/recursos";
import { transferirArea } from "../lib/area_transferida";
import { rotaParaHash } from "../lib/rota";
import { Icone } from "./Icone";
import { avisar, confirmar } from "./ui";
import "./exportar.css";

/** Para onde a área pode ir: todo serviço que começa por um arquivo de pontos ou pela área (as peças começam pelo PDF). */
export const destinosDaArea = (): DefinicaoServico[] => SERVICOS.filter((s) => s.chave !== "pecas" && servicoLiberado(s.chave));

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
  // "Usar a área em outro serviço": a lista abre dentro do menu
  const [outros, setOutros] = useState(false);
  const [levando, setLevando] = useState<ChaveServico | null>(null);
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
    // a rolagem do próprio menu (lista longa, tela baixa) não o fecha
    const rolar = (e: Event) => { if (!menu.current?.contains(e.target as Node)) setPos(null); };
    addEventListener("mousedown", fora);
    addEventListener("keydown", tecla);
    addEventListener("resize", fechar);
    addEventListener("scroll", rolar, true);
    // o primeiro formato recebe o foco: pelo teclado, a lista já está na mão
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => {
      removeEventListener("mousedown", fora);
      removeEventListener("keydown", tecla);
      removeEventListener("resize", fechar);
      removeEventListener("scroll", rolar, true);
    };
  }, [aberto]);

  if (!temPerimetro || !temPermissao("documentos.gerar")) return null;
  const destinos = temPermissao("servicos.criar") ? destinosDaArea() : [];

  function abrir() {
    const r = botao.current?.getBoundingClientRect();
    if (!r) return;
    // alinhado pela direita do botão, sem sair da tela
    const left = Math.max(8, Math.min(telaParaCss(innerWidth) - LARGURA - 8, telaParaCss(r.right) - LARGURA));
    setOutros(false);
    setPos({ left, top: telaParaCss(r.bottom) + 6 });
  }

  /** Leva a área para um serviço novo do tipo `def` e abre a etapa de início dele. */
  async function levar(def: DefinicaoServico) {
    setLevando(def.chave);
    try {
      await antes?.();
      // pedaço à parte: a montagem (CAR, glebas) só baixa quando alguém leva uma área
      const { areaDoServico } = await import("../lib/levarArea");
      const r = await areaDoServico(servicoId);
      setPos(null);
      transferirArea(r.area);
      location.hash = rotaParaHash({ t: "novo", chave: def.chave, ...(r.clienteId ? { clienteId: r.clienteId } : {}) });
    } catch (e) {
      avisar("erro", `Não foi possível levar a área: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLevando(null);
    }
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
          <div className="exportar-titulo" aria-hidden="true">Baixar a área</div>
          {FORMATOS_AREA.map((f) => (
            <button key={f.id} type="button" role="menuitem" onClick={() => exportar(f.id)} disabled={levando !== null}>
              <b>{f.rotulo}</b><small>{f.serve}</small>
            </button>
          ))}
          {destinos.length > 0 && (
            <>
              <div className="exportar-sep" role="separator" />
              <button type="button" role="menuitem" className={`exportar-outro${outros ? " aberto" : ""}`} aria-expanded={outros}
                disabled={levando !== null} onClick={() => setOutros((v) => !v)}>
                <b>Usar a área em outro serviço</b><small>{outros ? "escolha o serviço" : "divisão, loteamento, CAR…"}</small>
                <span className="exportar-seta" aria-hidden="true">{outros ? "▴" : "▾"}</span>
              </button>
              {outros && (
                <div className="exportar-destinos" role="group" aria-label="Serviço novo com esta área">
                  {destinos.map((d) => (
                    <button key={d.chave} type="button" role="menuitem" disabled={levando !== null} onClick={() => void levar(d)}
                      title={d.resumo}>
                      <span className="exportar-icone" aria-hidden="true"><Icone d={d.icone} size={16} /></span>
                      <b>{levando === d.chave ? "Abrindo…" : d.titulo}</b>
                      <small>{d.entradaKml ? "com o perímetro" : "com os pontos"}</small>
                    </button>
                  ))}
                  <p className="exportar-nota">Abre o início do serviço novo com a área já carregada. O crédito é cobrado só ao prosseguir lá.</p>
                </div>
              )}
            </>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
