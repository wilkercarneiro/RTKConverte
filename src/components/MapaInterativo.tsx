// Mapa interativo (MapLibre GL) com os mesmos fundos do site de referência:
//   - imagem de satélite: Esri World Imagery (tiles públicos, com atribuição);
//   - relevo: AWS Terrain Tiles (Mapzen/Tilezen no Registro de Dados Abertos da
//     AWS, codificação "terrarium"), usado como sombreamento e, no botão 3D,
//     como terreno.
// Por cima: as parcelas certificadas da base local (SIGEF), as interseções com
// o imóvel em vermelho, o anel do imóvel e os vértices numerados.
//
// Rótulos são marcadores HTML (sem servidor de glyphs): funcionam offline e
// herdam o CSS da tela. Os dados chegam já em lon/lat (SIRGAS 2000 ≈ WGS84
// para a escala de um mapa de tela).
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapaGl, StyleSpecification } from "maplibre-gl";
import type { FeatureParcela, LonLat, Sobreposicao } from "../lib/sigef";
import { fecharAnel } from "../lib/sigef";

export const ATRIBUICAO = "© AWS Terrain Tiles | © Esri World Imagery";

export interface PontoMapa {
  lonlat: LonLat;
  rotulo: string;
  titulo?: string;
  cor?: string;
}

interface Props {
  /** anéis lon/lat do imóvel (um por parte/gleba) */
  aneis: LonLat[][];
  /** vértices a rotular */
  pontos?: PontoMapa[];
  /** parcelas certificadas da base, ao redor do imóvel */
  parcelas?: FeatureParcela[];
  /** interseções imóvel × parcela */
  sobreposicoes?: Sobreposicao[];
  /** anéis em destaque (ex.: CSVs do vizinho na etapa de área certificada) */
  destaques?: { codigo: string; nome: string; anel: LonLat[] }[];
  /** código da sobreposição a piscar/enquadrar */
  foco?: string | null;
  altura?: number | string;
  cor?: string;
}

const VAZIO: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function estilo(): StyleSpecification {
  return {
    version: 8,
    sources: {
      esri: {
        type: "raster",
        tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
        tileSize: 256, maxzoom: 19, attribution: ATRIBUICAO,
      },
      relevo: {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        tileSize: 256, maxzoom: 15, encoding: "terrarium",
      },
      parcelas: { type: "geojson", data: VAZIO },
      sobreposicoes: { type: "geojson", data: VAZIO },
      destaques: { type: "geojson", data: VAZIO },
      imovel: { type: "geojson", data: VAZIO },
      vertices: { type: "geojson", data: VAZIO },
    },
    layers: [
      { id: "satelite", type: "raster", source: "esri" },
      { id: "sombra", type: "hillshade", source: "relevo", paint: { "hillshade-exaggeration": 0.35, "hillshade-shadow-color": "#0b1a12" } },
      { id: "parcelas-fill", type: "fill", source: "parcelas", paint: { "fill-color": "#F59E0B", "fill-opacity": 0.18 } },
      { id: "parcelas-line", type: "line", source: "parcelas", paint: { "line-color": "#FBBF24", "line-width": 1.6 } },
      { id: "destaques-fill", type: "fill", source: "destaques", paint: { "fill-color": "#22D3EE", "fill-opacity": 0.15 } },
      { id: "destaques-line", type: "line", source: "destaques", paint: { "line-color": "#22D3EE", "line-width": 2.2 } },
      { id: "sobre-fill", type: "fill", source: "sobreposicoes", paint: { "fill-color": "#EF4444", "fill-opacity": 0.45 } },
      { id: "sobre-line", type: "line", source: "sobreposicoes", paint: { "line-color": "#FCA5A5", "line-width": 2, "line-dasharray": [2, 1.5] } },
      { id: "imovel-fill", type: "fill", source: "imovel", paint: { "fill-color": "#ffffff", "fill-opacity": 0.06 } },
      { id: "imovel-line", type: "line", source: "imovel", paint: { "line-color": "#ffffff", "line-width": 2.6 } },
      { id: "vertices-pt", type: "circle", source: "vertices", paint: { "circle-radius": 3.5, "circle-color": "#0E3B2B", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } },
    ],
  };
}

function poligonos(aneis: LonLat[][], props: Record<string, unknown> = {}): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: aneis.filter((a) => a.length >= 3).map((a) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [fecharAnel(a)] } })),
  };
}

function limites(fc: GeoJSON.FeatureCollection): maplibregl.LngLatBounds | null {
  let b: maplibregl.LngLatBounds | null = null;
  const visita = (c: unknown) => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const p: [number, number] = [c[0] as number, c[1] as number];
      b = b ? b.extend(p) : new maplibregl.LngLatBounds(p, p);
    } else if (Array.isArray(c)) c.forEach(visita);
  };
  for (const f of fc.features) visita((f.geometry as GeoJSON.Polygon).coordinates);
  return b;
}

export function MapaInterativo(props: Props) {
  const { altura = 460 } = props;
  const divRef = useRef<HTMLDivElement>(null);
  // `aplicar` lê sempre as props mais recentes: a consulta ao PostGIS costuma
  // responder antes de o mapa terminar de carregar, e o handler de "load" não
  // pode ficar preso às props do primeiro render.
  const propsRef = useRef(props);
  propsRef.current = props;
  const mapaRef = useRef<MapaGl | null>(null);
  const prontoRef = useRef(false);
  const marcadoresRef = useRef<maplibregl.Marker[]>([]);
  const enquadradoRef = useRef<string>("");

  // cria o mapa uma vez
  useEffect(() => {
    if (!divRef.current || mapaRef.current) return;
    const mapa = new maplibregl.Map({
      container: divRef.current, style: estilo(), center: [-47.9, -15.8], zoom: 4,
      attributionControl: false, maxPitch: 70,
    });
    mapa.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: ATRIBUICAO }), "bottom-right");
    mapa.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    mapa.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    // botão 3D: liga o terreno das AWS Terrain Tiles
    const btn3d = document.createElement("button");
    btn3d.type = "button"; btn3d.className = "mapa-btn-3d"; btn3d.textContent = "3D"; btn3d.title = "Relevo em 3D (AWS Terrain Tiles)";
    btn3d.onclick = () => {
      const ligado = Boolean(mapa.getTerrain());
      mapa.setTerrain(ligado ? null : { source: "relevo", exaggeration: 1.4 });
      mapa.easeTo({ pitch: ligado ? 0 : 55, duration: 600 });
      btn3d.classList.toggle("ativo", !ligado);
    };
    const ctl3d = { onAdd: () => { const d = document.createElement("div"); d.className = "maplibregl-ctrl maplibregl-ctrl-group"; d.appendChild(btn3d); return d; }, onRemove: () => btn3d.remove() };
    mapa.addControl(ctl3d, "top-right");
    // tooltip das parcelas
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
    const mostrar = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]; if (!f) return;
      const p = f.properties as Record<string, string | number | null>;
      mapa.getCanvas().style.cursor = "pointer";
      const area = p.area_ha != null ? `${Number(p.area_ha).toFixed(4).replace(".", ",")} ha` : "";
      popup.setLngLat(e.lngLat).setHTML(
        `<b>${p.nome ?? "Parcela certificada"}</b><br><span class="mono">${p.codigo ?? ""}</span>` +
        `${p.municipio ? `<br>${p.municipio}${p.uf ? "/" + p.uf : ""}` : ""}${area ? `<br>${area}` : ""}${p.situacao ? `<br>${p.situacao}` : ""}`,
      ).addTo(mapa);
    };
    const esconder = () => { mapa.getCanvas().style.cursor = ""; popup.remove(); };
    mapa.on("mousemove", "parcelas-fill", mostrar);
    mapa.on("mouseleave", "parcelas-fill", esconder);
    mapa.on("load", () => { prontoRef.current = true; aplicar(); });
    mapa.on("zoom", () => ajustarRotulos());
    mapaRef.current = mapa;
    // acesso para testes automatizados (playwright): document.querySelector(".mapa-interativo").__mapa
    (divRef.current as HTMLDivElement & { __mapa?: MapaGl }).__mapa = mapa;
    return () => { prontoRef.current = false; mapa.remove(); mapaRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Os rótulos HTML dos vértices só aparecem quando o zoom os separa: com
  // centenas de pontos num imóvel grande, no zoom de enquadramento eles se
  // amontoam; os pontinhos (camada circle) ficam sempre.
  const rotulosRef = useRef<HTMLElement[]>([]);
  const zoomRotulosRef = useRef(15);
  function ajustarRotulos() {
    const mapa = mapaRef.current; if (!mapa) return;
    const mostrar = mapa.getZoom() >= zoomRotulosRef.current;
    // display inline: a classe .mapa-vertice (inline-flex) venceria o [hidden]
    for (const el of rotulosRef.current) el.style.display = mostrar ? "" : "none";
  }

  function aplicar() {
    const mapa = mapaRef.current;
    if (!mapa || !prontoRef.current) return;
    const { aneis, pontos, parcelas, sobreposicoes, destaques, foco, cor = "#ffffff" } = propsRef.current;
    const fcImovel = poligonos(aneis);
    (mapa.getSource("imovel") as GeoJSONSource).setData(fcImovel);
    mapa.setPaintProperty("imovel-line", "line-color", cor);
    (mapa.getSource("parcelas") as GeoJSONSource).setData({ type: "FeatureCollection", features: (parcelas ?? []) as GeoJSON.Feature[] });
    (mapa.getSource("sobreposicoes") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (sobreposicoes ?? []).map((s) => ({ type: "Feature", properties: { codigo: s.codigo }, geometry: s.geometria })),
    });
    const fcDest = poligonos((destaques ?? []).map((d) => d.anel));
    (mapa.getSource("destaques") as GeoJSONSource).setData(fcDest);
    mapa.setPaintProperty("sobre-fill", "fill-opacity", foco ? ["case", ["==", ["get", "codigo"], foco], 0.7, 0.3] : 0.45);

    // marcadores: vértices do imóvel e nome das parcelas
    for (const m of marcadoresRef.current) m.remove();
    marcadoresRef.current = [];
    rotulosRef.current = [];
    (mapa.getSource("vertices") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: (pontos ?? []).map((p) => ({ type: "Feature", properties: { rotulo: p.rotulo }, geometry: { type: "Point", coordinates: p.lonlat } })),
    });
    const n = (pontos ?? []).length;
    zoomRotulosRef.current = n <= 40 ? 13 : n <= 120 ? 15 : 16.5;
    for (const p of pontos ?? []) {
      const el = document.createElement("div");
      el.className = "mapa-vertice"; el.textContent = p.rotulo; if (p.titulo) el.title = p.titulo;
      if (p.cor) el.style.borderColor = p.cor;
      rotulosRef.current.push(el);
      marcadoresRef.current.push(new maplibregl.Marker({ element: el }).setLngLat(p.lonlat).addTo(mapa));
    }
    ajustarRotulos();
    for (const f of parcelas ?? []) {
      const el = document.createElement("div");
      el.className = "mapa-parcela-rotulo"; el.textContent = f.properties.nome ?? f.properties.codigo.slice(0, 8);
      el.title = `${f.properties.codigo}${f.properties.area_ha != null ? ` · ${f.properties.area_ha} ha` : ""}`;
      marcadoresRef.current.push(new maplibregl.Marker({ element: el }).setLngLat(f.properties.centro).addTo(mapa));
    }
    for (const d of destaques ?? []) {
      if (d.anel.length < 3) continue;
      const c = d.anel.reduce((s, p) => [s[0] + p[0] / d.anel.length, s[1] + p[1] / d.anel.length], [0, 0] as LonLat);
      const el = document.createElement("div");
      el.className = "mapa-parcela-rotulo destaque"; el.textContent = d.nome; el.title = d.codigo;
      marcadoresRef.current.push(new maplibregl.Marker({ element: el }).setLngLat(c).addTo(mapa));
    }

    // enquadra quando o imóvel (ou os destaques) muda de verdade
    const alvo = fcImovel.features.length ? fcImovel : fcDest;
    const chave = JSON.stringify(alvo.features.map((f) => (f.geometry as GeoJSON.Polygon).coordinates[0][0]).concat([[alvo.features.length]] as unknown as LonLat[]));
    if (chave !== enquadradoRef.current) {
      enquadradoRef.current = chave;
      const b = limites(alvo);
      if (b) mapa.fitBounds(b, { padding: 48, duration: 0, maxZoom: 18 });
    }
    if (foco) {
      const s = (sobreposicoes ?? []).find((x) => x.codigo === foco);
      if (s) {
        const b = limites({ type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: s.geometria }] });
        if (b) mapa.fitBounds(b, { padding: 80, duration: 500, maxZoom: 18 });
      }
    }
  }

  useEffect(() => { aplicar(); }, [props.aneis, props.pontos, props.parcelas, props.sobreposicoes, props.destaques, props.foco, props.cor]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={divRef} className="mapa-interativo" style={{ height: altura }} />;
}
