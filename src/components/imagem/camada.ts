// A imagem por data no MapLibre: põe (ou tira) a camada raster do Wayback por
// BAIXO das camadas do imóvel, esconde a imagem base enquanto ela estiver
// ligada (economiza download) e devolve tudo como era ao voltar para "atual".
// Também monta o estilo do mapa da cortina de comparação e captura o PNG com
// carimbo.
import type { LayerSpecification, Map as MapaGl, StyleSpecification } from "maplibre-gl";

export const FONTE_IMG = "imgdata-wayback";
export const CAMADA_IMG = "imgdata-wayback";

/** As camadas raster de base que escondemos, por mapa (para devolver exatamente). */
const escondidas = new WeakMap<MapaGl, string[]>();

/** Primeira camada que não é imagem: a nossa entra logo antes dela (acima das imagens, abaixo do resto). */
function antesDe(camadas: { id: string; type: string }[]): string | undefined {
  return camadas.find((l) => l.type !== "raster" && l.type !== "background")?.id;
}

/**
 * Liga a imagem (`modelo` = URL com {z}/{y}/{x}) ou volta para a base (`null`).
 * Se o estilo ainda está carregando, espera e aplica o pedido mais recente.
 */
export function aplicarImagem(mapa: MapaGl, modelo: string | null, atribuicao: string): void {
  const m = mapa as MapaGl & { __imgdataPedido?: string | null };
  m.__imgdataPedido = modelo;
  if (!mapa.isStyleLoaded()) {
    mapa.once("idle", () => { if (m.__imgdataPedido === modelo) aplicarImagem(mapa, modelo, atribuicao); });
    return;
  }
  const fonteAtual = mapa.getSource(FONTE_IMG) as { tiles?: string[] } | undefined;
  if (modelo && fonteAtual?.tiles?.[0] === modelo && mapa.getLayer(CAMADA_IMG)) return;
  if (mapa.getLayer(CAMADA_IMG)) mapa.removeLayer(CAMADA_IMG);
  if (mapa.getSource(FONTE_IMG)) mapa.removeSource(FONTE_IMG);

  // devolve a base que estava escondida
  for (const id of escondidas.get(mapa) ?? []) if (mapa.getLayer(id)) mapa.setLayoutProperty(id, "visibility", "visible");
  escondidas.delete(mapa);
  if (!modelo) return;

  const camadas = mapa.getStyle().layers;
  const antes = antesDe(camadas);
  mapa.addSource(FONTE_IMG, { type: "raster", tiles: [modelo], tileSize: 256, maxzoom: 19, attribution: atribuicao });
  mapa.addLayer({ id: CAMADA_IMG, type: "raster", source: FONTE_IMG, paint: { "raster-fade-duration": 150 } }, antes);
  // a imagem base fica por baixo, invisível: esconder poupa os tiles dela
  const fim = antes ? camadas.findIndex((l) => l.id === antes) : camadas.length;
  const base = camadas.slice(0, fim).filter((l) => l.type === "raster" && l.id !== CAMADA_IMG && (l.layout as { visibility?: string } | undefined)?.visibility !== "none").map((l) => l.id);
  for (const id of base) mapa.setLayoutProperty(id, "visibility", "none");
  escondidas.set(mapa, base);
}

/**
 * Estilo do mapa "antes" da cortina: o mesmo do mapa principal (imóvel,
 * vértices, parcelas por cima), com a imagem pedida no lugar da base, sem
 * terreno 3D e sem a imagem que o mapa principal estiver mostrando.
 */
export function estiloComparacao(mapa: MapaGl, modelo: string | null, atribuicao: string): StyleSpecification {
  const st = mapa.getStyle();
  const fontes = { ...st.sources };
  delete fontes[FONTE_IMG];
  let camadas: LayerSpecification[] = st.layers
    .filter((l) => l.id !== CAMADA_IMG)
    .map((l) => (l.type === "raster" ? { ...l, layout: { ...(l.layout ?? {}), visibility: "visible" as const } } : l));
  if (modelo) {
    fontes[FONTE_IMG] = { type: "raster", tiles: [modelo], tileSize: 256, maxzoom: 19, attribution: atribuicao };
    const antes = antesDe(camadas);
    const i = antes ? camadas.findIndex((l) => l.id === antes) : camadas.length;
    camadas = [
      ...camadas.slice(0, i).map((l) => (l.type === "raster" ? { ...l, layout: { ...(l.layout ?? {}), visibility: "none" as const } } : l)),
      { id: CAMADA_IMG, type: "raster", source: FONTE_IMG },
      ...camadas.slice(i),
    ];
  }
  const estilo: StyleSpecification = { version: 8, sources: fontes, layers: camadas };
  if (st.glyphs) estilo.glyphs = st.glyphs;
  if (st.sprite) estilo.sprite = st.sprite;
  return estilo;
}

/** Espera o mapa terminar de desenhar os tiles da vista atual (com prazo). */
export function esperarOcioso(mapa: MapaGl, prazoMs = 12000): Promise<void> {
  return new Promise((ok) => {
    if (mapa.loaded() && mapa.areTilesLoaded()) { ok(); return; }
    const t = setTimeout(ok, prazoMs);
    mapa.once("idle", () => { clearTimeout(t); ok(); });
  });
}

/**
 * PNG da vista com um carimbo embaixo (data da foto, fonte, ponto e quando
 * foi gerado): a prova sai pronta para anexar. O buffer do WebGL só é legível
 * dentro do evento "render" (sem preserveDrawingBuffer).
 */
export async function capturarComCarimbo(mapa: MapaGl, linhas: string[]): Promise<Blob> {
  await esperarOcioso(mapa);
  const canvasMapa = await new Promise<HTMLCanvasElement>((ok, falha) => {
    mapa.once("render", () => {
      try {
        const c = mapa.getCanvas();
        const copia = document.createElement("canvas");
        copia.width = c.width; copia.height = c.height;
        copia.getContext("2d")!.drawImage(c, 0, 0);
        ok(copia);
      } catch (e) { falha(e); }
    });
    mapa.triggerRepaint();
  });
  const escala = Math.max(1, canvasMapa.width / 1100);
  const fonte = Math.round(13 * escala);
  const pad = Math.round(10 * escala);
  const alturaFaixa = pad * 2 + linhas.length * Math.round(fonte * 1.45);
  const out = document.createElement("canvas");
  out.width = canvasMapa.width;
  out.height = canvasMapa.height + alturaFaixa;
  const g = out.getContext("2d")!;
  g.drawImage(canvasMapa, 0, 0);
  g.fillStyle = "#0E3B2B";
  g.fillRect(0, canvasMapa.height, out.width, alturaFaixa);
  g.textBaseline = "top";
  linhas.forEach((l, i) => {
    g.font = `${i === 0 ? 700 : 400} ${fonte}px Figtree, system-ui, sans-serif`;
    g.fillStyle = i === 0 ? "#ffffff" : "#A9CBBA";
    g.fillText(l, pad, canvasMapa.height + pad + i * Math.round(fonte * 1.45), out.width - pad * 2);
  });
  return new Promise((ok, falha) => out.toBlob((b) => (b ? ok(b) : falha(new Error("o navegador não gerou o PNG"))), "image/png"));
}

export function baixarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
