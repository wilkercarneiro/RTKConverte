// Cortina de comparação: duas datas no mesmo mapa, separadas por uma divisa
// que se arrasta (mouse, dedo ou setas do teclado). À direita fica o mapa de
// trabalho mostrando a data "depois"; à esquerda, um segundo mapa sem
// interação, preso à mesma vista, mostrando a data "antes" — com o imóvel, os
// vértices e as parcelas desenhados igual, para a divisa ser lida dos dois lados.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapaGl } from "maplibre-gl";
import { estiloComparacao } from "./camada";

export interface OpcaoData { valor: string; rotulo: string }

/** A câmera inteira do principal, inclusive a altitude do centro (relevo 3D) e o giro. */
function camera(m: MapaGl) {
  return { center: m.getCenter(), zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch(), roll: m.getRoll(), elevation: m.getCenterElevation() };
}

export function CortinaComparacao({ mapa, modeloAntes, atribuicao, rotuloFonte, opcoes, antes, depois, onAntes, onDepois, onFechar }: {
  mapa: MapaGl;
  /** imagem da esquerda (null = a base atual) */
  modeloAntes: string | null;
  atribuicao: string;
  /** de onde vêm as imagens dos dois lados (texto no pé da cortina) */
  rotuloFonte: string;
  opcoes: OpcaoData[];
  antes: string;
  depois: string;
  onAntes: (v: string) => void;
  onDepois: (v: string) => void;
  onFechar: () => void;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const outroRef = useRef<MapaGl | null>(null);
  const [fracao, setFracao] = useState(0.5);
  const [falhou, setFalhou] = useState(false);
  const container = mapa.getContainer();

  // o segundo mapa nasce com a vista e o estilo do principal
  useEffect(() => {
    const div = caixaRef.current;
    if (!div) return;
    let outro: MapaGl;
    try {
      outro = new maplibregl.Map({
        container: div, style: estiloComparacao(mapa, modeloAntes, atribuicao), interactive: false, attributionControl: false,
        ...camera(mapa), maxPitch: 85, fadeDuration: 0,
        // a altitude do centro vem do principal (com relevo 3D, cada mapa calcularia a sua e a câmera ficaria diferente)
        centerClampedToGround: false,
      });
    } catch (e) {
      console.warn("[imagem] mapa da comparação não abriu:", e);
      setFalhou(true);
      return;
    }
    outroRef.current = outro;
    // acesso para os testes por captura (como o __mapa do MapaInterativo)
    (div as HTMLDivElement & { __mapa?: MapaGl }).__mapa = outro;
    const seguir = () => outro.jumpTo(camera(mapa));
    // os desenhos (imóvel, parcelas…) mudam no principal: copia os dados das fontes GeoJSON
    let pendente = 0;
    const copiar = () => {
      pendente = 0;
      if (!outro.isStyleLoaded()) return;
      for (const [id, src] of Object.entries(mapa.getStyle().sources)) {
        if (src.type !== "geojson") continue;
        const alvo = outro.getSource(id) as GeoJSONSource | undefined;
        if (alvo) alvo.setData((src as { data: GeoJSON.GeoJSON }).data);
      }
    };
    const aoMudarDados = (e: { dataType?: string; sourceDataType?: string }) => {
      if (e.dataType === "source" && e.sourceDataType === "content" && !pendente) pendente = requestAnimationFrame(copiar);
    };
    const redimensionar = () => outro.resize();
    // relevo 3D ligado/desligado no principal: o da esquerda acompanha (senão a divisa junta duas geometrias)
    const relevo = () => {
      const t = mapa.getTerrain();
      const aplicar = () => {
        try {
          if (t && !outro.getSource(t.source)) return;
          outro.setTerrain(t ? { ...t } : null);
          seguir();
        } catch (e) { console.warn("[imagem] relevo da comparação:", e); }
      };
      // ("load" só dispara uma vez na vida do mapa: depois de um setStyle, espera o "idle")
      if (outro.isStyleLoaded()) aplicar(); else outro.once("idle", aplicar);
    };
    // com relevo, a altitude do centro do principal muda quando os tiles do terreno chegam, sem "move"
    const altitude = () => { if (Math.abs(outro.getCenterElevation() - mapa.getCenterElevation()) > 0.01) seguir(); };
    mapa.on("move", seguir);
    mapa.on("render", altitude);
    mapa.on("data", aoMudarDados);
    mapa.on("resize", redimensionar);
    mapa.on("terrain", relevo);
    return () => {
      mapa.off("move", seguir);
      mapa.off("render", altitude);
      mapa.off("data", aoMudarDados);
      mapa.off("resize", redimensionar);
      mapa.off("terrain", relevo);
      if (pendente) cancelAnimationFrame(pendente);
      outroRef.current = null;
      try { outro.remove(); } catch { /* contexto já perdido */ }
    };
  }, [mapa]); // eslint-disable-line react-hooks/exhaustive-deps

  // trocou a data da esquerda: troca só a imagem (a vista continua)
  useEffect(() => {
    const outro = outroRef.current;
    if (!outro) return;
    outro.setStyle(estiloComparacao(mapa, modeloAntes, atribuicao), { diff: false });
    // o estilo novo religa o relevo: a câmera volta a ser a do principal
    outro.once("idle", () => { try { outro.jumpTo(camera(mapa)); } catch { /* removido */ } });
  }, [modeloAntes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc fecha a comparação de qualquer lugar (menos de dentro de uma lista aberta)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLSelectElement)) onFechar(); };
    addEventListener("keydown", tecla);
    return () => removeEventListener("keydown", tecla);
  }, [onFechar]);

  // arrastar a divisa: fração da largura (as duas pontas na mesma escala, o zoom .8 não atrapalha)
  function arrastar(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    const alvo = e.currentTarget;
    alvo.setPointerCapture(e.pointerId);
    const mover = (ev: PointerEvent) => {
      const r = container.getBoundingClientRect();
      setFracao(Math.max(0.02, Math.min(0.98, (ev.clientX - r.left) / r.width)));
    };
    const soltar = () => { alvo.removeEventListener("pointermove", mover); alvo.removeEventListener("pointerup", soltar); alvo.removeEventListener("pointercancel", soltar); };
    alvo.addEventListener("pointermove", mover);
    alvo.addEventListener("pointerup", soltar);
    alvo.addEventListener("pointercancel", soltar);
  }
  function teclado(e: React.KeyboardEvent) {
    const passo = e.shiftKey ? 0.1 : 0.03;
    if (e.key === "ArrowLeft") { e.preventDefault(); setFracao((f) => Math.max(0.02, f - passo)); }
    else if (e.key === "ArrowRight") { e.preventDefault(); setFracao((f) => Math.min(0.98, f + passo)); }
    else if (e.key === "Home") { e.preventDefault(); setFracao(0.02); }
    else if (e.key === "End") { e.preventDefault(); setFracao(0.98); }
  }

  const pct = `${(fracao * 100).toFixed(2)}%`;
  return createPortal(
    <>
      <div ref={caixaRef} className="imgdata-cortina-mapa" aria-hidden="true"
        style={{ clipPath: `inset(0 calc(100% - ${pct}) 0 0)` }} />
      {!falhou && (
        <div className="imgdata-cortina-divisa" style={{ left: pct }}>
          <div className="imgdata-cortina-alca" role="slider" tabIndex={0} aria-label="Divisa entre as duas datas"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fracao * 100)}
            aria-valuetext={`${Math.round(fracao * 100)}% para a data da esquerda`}
            onPointerDown={arrastar} onKeyDown={teclado}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </div>
      )}
      <div className="imgdata-cortina-barra" onPointerDown={(e) => e.stopPropagation()}>
        <label className="imgdata-cortina-lado">
          <span>Antes</span>
          <select value={antes} onChange={(e) => onAntes(e.target.value)} aria-label="Data da esquerda">
            {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        </label>
        <button type="button" className="imgdata-cortina-fechar" onClick={onFechar} title="Fechar a comparação (Esc)">Fechar</button>
        <label className="imgdata-cortina-lado direita">
          <span>Depois</span>
          <select value={depois} onChange={(e) => onDepois(e.target.value)} aria-label="Data da direita">
            {opcoes.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
          </select>
        </label>
      </div>
      <div className="imgdata-cortina-fonte">{rotuloFonte}</div>
      {falhou && <div className="imgdata-cortina-falha" role="status">Este navegador não abriu o segundo mapa da comparação. Troque a data pela lista “Depois” ou feche a comparação e use as setas ‹ ›.</div>}
    </>,
    container,
  );
}
