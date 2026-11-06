// O mapa do Medir no campo (MapLibre): satélite Esri, o ponto azul do GPS com
// o círculo de precisão, o contorno sendo medido (linha + o fecho tracejado
// até o 1º vértice) e os vértices com a cor da precisão.
//
// No modo "Desenhar no mapa" cada toque põe um vértice e os vértices viram
// marcadores arrastáveis. Fora dele o mapa só mostra (arrastar o mapa no
// campo não pode mexer em vértice medido).
//
// Imagem por data (frente 3 do plano): `controleImagem` recebe o mapa e o
// centro e desenha o SeletorImagemData por cima — o integrador liga em
// Campo.tsx; aqui só existe o lugar.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapaGl, StyleSpecification } from "maplibre-gl";
import { esquecerWebgl, MOTIVO_SEM_WEBGL, webglDisponivel } from "../../lib/webgl";
import { ATRIBUICAO, motivoDaFalhaDoMapa } from "../MapaInterativo";
import { classePrecisao, circuloLonLat } from "../../lib/campo/geometria.ts";
import type { Leitura, LonLat, VerticeCampo } from "../../lib/campo/tipos.ts";
import { BotaoTelaCheia } from "../TelaCheia";

export interface ControleImagemProps {
  mapa: MapaGl | null;
  centro: LonLat | null;
}

interface Props {
  vertices: VerticeCampo[];
  fechada: boolean;
  posicao: Leitura | null;
  /** o mapa acompanha o ponto azul */
  seguir: boolean;
  onParouDeSeguir: () => void;
  onSeguir: () => void;
  desenhando: boolean;
  onToque: (p: LonLat) => void;
  onMoverVertice: (i: number, p: LonLat) => void;
  /** muda → enquadra a medição (abriu outra, fechou a área) */
  enquadrar: string;
  /** "Ir para": voa até o ponto (k muda a cada pedido) */
  voarPara?: { p: LonLat; k: number } | null;
  controleImagem?: (p: ControleImagemProps) => ReactNode;
  /** por cima do mapa, no canto de cima (status, botões) */
  children?: ReactNode;
}

const VAZIO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const COR = { boa: "#22C55E", media: "#F59E0B", ruim: "#EF4444", mao: "#FFFFFF" };

function estilo(): StyleSpecification {
  return {
    version: 8,
    sources: {
      esri: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        // no interior a Esri quase nunca tem o nível 19 ("Map data not yet available"):
        // do 18 em diante a imagem é ampliada, nunca some
        tileSize: 256, maxzoom: 18, attribution: ATRIBUICAO,
      },
      area: { type: "geojson", data: VAZIO },
      linha: { type: "geojson", data: VAZIO },
      fecho: { type: "geojson", data: VAZIO },
      vertices: { type: "geojson", data: VAZIO },
      precisao: { type: "geojson", data: VAZIO },
    },
    layers: [
      { id: "satelite", type: "raster", source: "esri" },
      { id: "area-fill", type: "fill", source: "area", paint: { "fill-color": "#22C55E", "fill-opacity": ["case", ["get", "fechada"], 0.24, 0.1] } },
      { id: "linha-halo", type: "line", source: "linha", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#0E3B2B", "line-width": 6, "line-opacity": 0.55 } },
      { id: "linha", type: "line", source: "linha", layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#FFFFFF", "line-width": 3 } },
      { id: "fecho", type: "line", source: "fecho", paint: { "line-color": "#FFFFFF", "line-width": 2, "line-dasharray": [2, 2], "line-opacity": 0.85 } },
      { id: "precisao-fill", type: "fill", source: "precisao", paint: { "fill-color": "#3B82F6", "fill-opacity": 0.16 } },
      { id: "precisao-line", type: "line", source: "precisao", paint: { "line-color": "#60A5FA", "line-width": 1.2 } },
      {
        id: "vertices", type: "circle", source: "vertices",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, 2.5, 18, 5],
          "circle-color": ["match", ["get", "classe"], "boa", COR.boa, "media", COR.media, "ruim", COR.ruim, COR.mao],
          "circle-stroke-color": "#0E3B2B", "circle-stroke-width": 1.4,
        },
      },
    ],
  };
}

const anelFechado = (pts: LonLat[]): LonLat[] => (pts.length ? [...pts, pts[0]] : pts);

export function MapaCampo(props: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const mapaRef = useRef<MapaGl | null>(null);
  const prontoRef = useRef(false);
  const gpsRef = useRef<maplibregl.Marker | null>(null);
  const rotulosRef = useRef<maplibregl.Marker[]>([]);
  const arrastaveisRef = useRef<maplibregl.Marker[]>([]);
  const enquadradoRef = useRef("");
  const primeiroFixRef = useRef(true);
  const [mapa, setMapa] = useState<MapaGl | null>(null);
  const [falha, setFalha] = useState<string | null>(() => (webglDisponivel() ? null : MOTIVO_SEM_WEBGL));
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (falha || !divRef.current || mapaRef.current) return;
    let m: MapaGl;
    try {
      m = new maplibregl.Map({
        container: divRef.current, style: estilo(), center: [-47.9, -15.8], zoom: 3.6,
        attributionControl: false, maxZoom: 20.5, dragRotate: false, pitchWithRotate: false,
      });
    } catch (e) {
      setFalha(motivoDaFalhaDoMapa(e));
      return;
    }
    m.touchZoomRotate.disableRotation();
    m.on("webglcontextlost", () => setFalha("O navegador interrompeu o desenho do mapa. A medição continua gravando; toque em \"Tentar de novo\"."));
    m.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: ATRIBUICAO }), "bottom-right");
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    // o usuário arrastou o mapa: para de seguir o ponto azul (o botão "centralizar" aparece)
    m.on("dragstart", () => propsRef.current.onParouDeSeguir());
    // desenhando, o toque duplo não dá zoom nem põe dois vértices (o zoom fica no pinça e nos botões)
    let ultimoToque = { t: 0, x: 0, y: 0 };
    m.on("click", (e) => {
      if (!propsRef.current.desenhando) return;
      const ev = e.originalEvent as MouseEvent | undefined;
      if (ev && ev.detail > 1) return;
      const agora = Date.now();
      if (agora - ultimoToque.t < 350 && Math.hypot(e.point.x - ultimoToque.x, e.point.y - ultimoToque.y) < 12) return;
      ultimoToque = { t: agora, x: e.point.x, y: e.point.y };
      propsRef.current.onToque([e.lngLat.lng, e.lngLat.lat]);
    });
    m.on("load", () => { prontoRef.current = true; desenhar(); posicionar(); });
    mapaRef.current = m;
    setMapa(m);
    (divRef.current as HTMLDivElement & { __mapa?: MapaGl }).__mapa = m;
    return () => {
      prontoRef.current = false; mapaRef.current = null; enquadradoRef.current = ""; primeiroFixRef.current = true;
      gpsRef.current?.remove(); gpsRef.current = null;
      for (const x of [...rotulosRef.current, ...arrastaveisRef.current]) x.remove();
      rotulosRef.current = []; arrastaveisRef.current = [];
      setMapa(null);
      try { m.remove(); } catch { /* contexto já perdido */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [falha, tentativa]);

  function desenhar() {
    const m = mapaRef.current;
    if (!m || !prontoRef.current) return;
    try {
      const { vertices, fechada, desenhando, enquadrar } = propsRef.current;
      const pts = vertices.map((v) => [v.lon, v.lat] as LonLat);
      (m.getSource("area") as GeoJSONSource).setData(pts.length >= 3
        ? { type: "Feature", properties: { fechada }, geometry: { type: "Polygon", coordinates: [anelFechado(pts)] } }
        : VAZIO);
      (m.getSource("linha") as GeoJSONSource).setData(pts.length >= 2
        ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: fechada ? anelFechado(pts) : pts } }
        : VAZIO);
      (m.getSource("fecho") as GeoJSONSource).setData(!fechada && pts.length >= 3
        ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [pts[pts.length - 1], pts[0]] } }
        : VAZIO);
      (m.getSource("vertices") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: vertices.map((v, i) => ({
          type: "Feature", properties: { i, classe: v.precisao == null ? "mao" : classePrecisao(v.precisao) },
          geometry: { type: "Point", coordinates: [v.lon, v.lat] },
        })),
      });
      // rótulos: o 1º e o último (centenas de vértices andando não cabem rotulados)
      for (const x of rotulosRef.current) x.remove();
      rotulosRef.current = [];
      const rotular = (i: number, extra = "") => {
        const el = document.createElement("div");
        el.className = `campo-rotulo${extra}`;
        el.textContent = `P${i + 1}`;
        rotulosRef.current.push(new maplibregl.Marker({ element: el, anchor: "bottom", offset: [0, -8] }).setLngLat(pts[i]).addTo(m));
      };
      if (pts.length && !desenhando) { rotular(0, " primeiro"); if (pts.length > 1) rotular(pts.length - 1); }
      // desenhando: cada vértice vira um marcador arrastável
      for (const x of arrastaveisRef.current) x.remove();
      arrastaveisRef.current = [];
      if (desenhando && pts.length <= 400) {
        pts.forEach((p, i) => {
          const el = document.createElement("div");
          el.className = "campo-vertice-mao";
          el.textContent = String(i + 1);
          el.title = `P${i + 1}: arraste para ajustar`;
          // tocar no vértice não põe outro vértice embaixo dele
          el.addEventListener("click", (e) => e.stopPropagation());
          const mk = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(p).addTo(m);
          mk.on("dragend", () => { const ll = mk.getLngLat(); propsRef.current.onMoverVertice(i, [ll.lng, ll.lat]); });
          arrastaveisRef.current.push(mk);
        });
      }
      m.getCanvas().style.cursor = desenhando ? "crosshair" : "";
      if (desenhando) m.doubleClickZoom.disable(); else m.doubleClickZoom.enable();
      // enquadra quando pedido (abriu outra medição, fechou a área)
      if (enquadrar !== enquadradoRef.current && pts.length >= 2) {
        enquadradoRef.current = enquadrar;
        const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
        // em cima moram os selos e (no celular) o aviso do GPS: a área não fica embaixo deles
        const estreito = m.getContainer().clientWidth < 600;
        m.fitBounds(b, { padding: { top: estreito ? 128 : 64, bottom: 40, left: 40, right: estreito ? 56 : 64 }, duration: 0, maxZoom: 19 });
      } else if (enquadrar !== enquadradoRef.current && pts.length === 1) {
        enquadradoRef.current = enquadrar;
        m.jumpTo({ center: pts[0], zoom: Math.max(m.getZoom(), 18) });
      }
    } catch (e) {
      console.warn("[campo] mapa não desenhado:", e);
    }
  }

  function posicionar() {
    const m = mapaRef.current;
    if (!m || !prontoRef.current) return;
    const { posicao, seguir } = propsRef.current;
    if (!posicao) {
      gpsRef.current?.remove(); gpsRef.current = null;
      (m.getSource("precisao") as GeoJSONSource).setData(VAZIO);
      return;
    }
    const p: LonLat = [posicao.lon, posicao.lat];
    if (!gpsRef.current) {
      const el = document.createElement("div");
      el.className = "campo-gps";
      el.setAttribute("aria-label", "Você está aqui");
      gpsRef.current = new maplibregl.Marker({ element: el }).setLngLat(p).addTo(m);
    } else gpsRef.current.setLngLat(p);
    gpsRef.current.getElement().dataset.classe = posicao.precisao == null ? "ruim" : classePrecisao(posicao.precisao);
    (m.getSource("precisao") as GeoJSONSource).setData(posicao.precisao != null && posicao.precisao > 0.5
      ? { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circuloLonLat(p, Math.min(posicao.precisao, 5000))] } }
      : VAZIO);
    if (seguir) {
      if (primeiroFixRef.current) { primeiroFixRef.current = false; m.jumpTo({ center: p, zoom: Math.max(m.getZoom(), 17.5) }); }
      else m.easeTo({ center: p, duration: 400 });
    }
  }

  useEffect(() => { desenhar(); }, [props.vertices, props.fechada, props.desenhando, props.enquadrar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { posicionar(); }, [props.posicao, props.seguir]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const m = mapaRef.current, v = props.voarPara;
    if (m && v) m.flyTo({ center: v.p, zoom: 17, duration: 900 });
  }, [props.voarPara]);
  // o mapa se mede de novo quando o painel muda de tamanho (celular girando, tela cheia)
  useEffect(() => {
    const el = divRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => mapaRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [falha]);

  const centro: LonLat | null = props.vertices.length
    ? [props.vertices[0].lon, props.vertices[0].lat]
    : props.posicao ? [props.posicao.lon, props.posicao.lat] : null;

  return (
    <div className="campo-mapa" data-desenhando={props.desenhando || undefined}>
      <div ref={divRef} className="campo-mapa-gl" style={{ display: falha ? "none" : undefined }} />
      {falha && (
        <div className="campo-sem-mapa" role="status">
          <b>Mapa indisponível</b>
          <p>{falha}</p>
          <p className="sub">A medição continua: os vértices, a área e o perímetro seguem aqui embaixo.</p>
          <button type="button" onClick={() => {
            esquecerWebgl();
            if (!webglDisponivel()) { setFalha(MOTIVO_SEM_WEBGL); return; }
            setFalha(null); setTentativa((t) => t + 1);
          }}>Tentar de novo</button>
        </div>
      )}
      <div className="campo-mapa-topo">{props.children}</div>
      <div className="campo-mapa-lado">
        <BotaoTelaCheia className="campo-btn-mapa" />
        {props.posicao && !props.seguir && !falha && (
          <button type="button" className="campo-btn-mapa campo-centralizar" onClick={props.onSeguir}
            title="Voltar para a minha posição" aria-label="Voltar para a minha posição">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
        )}
      </div>
      {/* Imagem por data (SeletorImagemData): o integrador passa `controleImagem` em Campo.tsx */}
      {props.controleImagem && !falha && <div className="campo-mapa-imagem">{props.controleImagem({ mapa, centro })}</div>}
      {props.desenhando && !falha && <div className="campo-dica-mao" role="status">Toque no mapa para pôr cada vértice. Arraste um vértice para ajustar.</div>}
    </div>
  );
}
