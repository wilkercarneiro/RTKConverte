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

export function CortinaComparacao({ mapa, modeloAntes, atribuicao, opcoes, antes, depois, onAntes, onDepois, onFechar }: {
  mapa: MapaGl;
  /** imagem da esquerda (null = a base atual) */
  modeloAntes: string | null;
  atribuicao: string;
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
        center: mapa.getCenter(), zoom: mapa.getZoom(), bearing: mapa.getBearing(), pitch: mapa.getPitch(), maxPitch: 85,
        fadeDuration: 0,
      });
    } catch (e) {
      console.warn("[imagem] mapa da comparação não abriu:", e);
      setFalhou(true);
      return;
    }
    outroRef.current = outro;
    const seguir = () => outro.jumpTo({ center: mapa.getCenter(), zoom: mapa.getZoom(), bearing: mapa.getBearing(), pitch: mapa.getPitch() });
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
    mapa.on("move", seguir);
    mapa.on("data", aoMudarDados);
    mapa.on("resize", redimensionar);
    return () => {
      mapa.off("move", seguir);
      mapa.off("data", aoMudarDados);
      mapa.off("resize", redimensionar);
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
      <div className="imgdata-cortina-fonte">Imagens: Esri World Imagery Wayback</div>
      {falhou && <div className="imgdata-cortina-falha" role="status">Este navegador não abriu o segundo mapa da comparação. Use as setas ‹ › para alternar as datas.</div>}
    </>,
    container,
  );
}
