// Planta de situação: imagem de satélite (Esri World Imagery, sem chave) com o
// loteamento desenhado por cima — o quadro "PLANTA DE SITUAÇÃO" das plantas
// da equipe. Montada no navegador (canvas); sem rede, a planta sai sem ela.
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import { caixa } from "./geom.ts";
import type { Anel, Pt } from "./geom.ts";
import type { Resultado } from "./calculo.ts";
import { paraUtm } from "./plano.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

const TILE = (z: number, x: number, y: number) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;

/** PNG da situação (largura × altura em pixels), ou null se não houver rede/canvas. */
export async function imagemSituacao(res: Resultado, fuso: number, largura = 1100, altura = 700): Promise<Uint8Array | null> {
  if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") return null;
  try {
    const ud = utmDef(fuso);
    const ll = (p: Pt) => proj(ud, GEO_DEF, paraUtm(res.plano, p));
    const contorno = res.gleba.ext.map(ll);
    const bb = caixa(contorno);
    // margem de 35% em volta (mostra a vizinhança: estrada, mata, roça)
    const mx = (bb.max[0] - bb.min[0]) * 0.35, my = (bb.max[1] - bb.min[1]) * 0.35;
    const lon0 = bb.min[0] - mx, lon1 = bb.max[0] + mx, lat0 = bb.min[1] - my, lat1 = bb.max[1] + my;
    const px = (lon: number, z: number) => ((lon + 180) / 360) * 256 * 2 ** z;
    const py = (lat: number, z: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 256 * 2 ** z;
    let z = 19;
    while (z > 3 && (px(lon1, z) - px(lon0, z) > largura || py(lat0, z) - py(lat1, z) > altura)) z--;
    const x0 = px(lon0, z), y0 = py(lat1, z);
    const w = Math.ceil(px(lon1, z) - x0), h = Math.ceil(py(lat0, z) - y0);
    // centraliza no quadro pedido
    const ox = (largura - w) / 2, oy = (altura - h) / 2;
    const canvas: HTMLCanvasElement | OffscreenCanvas = typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(largura, altura)
      : Object.assign(document.createElement("canvas"), { width: largura, height: altura });
    const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.fillStyle = "#3a4a3a";
    ctx.fillRect(0, 0, largura, altura);
    const tx0 = Math.floor((x0 - ox) / 256), tx1 = Math.floor((x0 - ox + largura) / 256);
    const ty0 = Math.floor((y0 - oy) / 256), ty1 = Math.floor((y0 - oy + altura) / 256);
    await Promise.all(
      Array.from({ length: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) }, async (_, k) => {
        const tx = tx0 + (k % (tx1 - tx0 + 1)), ty = ty0 + Math.floor(k / (tx1 - tx0 + 1));
        const r = await fetch(TILE(z, tx, ty), { mode: "cors" });
        if (!r.ok) return;
        const img = await createImageBitmap(await r.blob());
        ctx.drawImage(img, tx * 256 - (x0 - ox), ty * 256 - (y0 - oy));
      }),
    );
    const P = (p: Pt): Pt => { const [lon, lat] = ll(p); return [px(lon, z) - x0 + ox, py(lat, z) - y0 + oy]; };
    const caminho = (a: Anel) => { ctx.beginPath(); a.forEach((q, i) => { const [x, y] = P(q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); };
    // ruas em vermelho, lotes em verde, gleba em amarelo (como a imagem da equipe)
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(60,230,60,0.95)";
    for (const l of res.lotes) { caminho(l.pol.ext); ctx.stroke(); }
    ctx.strokeStyle = "rgba(230,60,40,0.95)";
    ctx.lineWidth = 1.6;
    for (const r of res.ruas) {
      ctx.beginPath();
      r.eixo.forEach((q, i) => { const [x, y] = P(q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.strokeStyle = "#ffd400";
    ctx.lineWidth = 2.4;
    caminho(res.gleba.ext); ctx.stroke();
    // retângulo azul: "localização do imóvel na imagem"
    const c = res.gleba.ext.map(P);
    const b2 = caixa(c);
    ctx.strokeStyle = "#2d5bff";
    ctx.lineWidth = 2;
    ctx.strokeRect(b2.min[0] - 8, b2.min[1] - 8, b2.max[0] - b2.min[0] + 16, b2.max[1] - b2.min[1] + 16);
    const blob = canvas instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"))
      : await (canvas as OffscreenCanvas).convertToBlob({ type: "image/png" });
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null; // sem rede ou imagem bloqueada (CORS): a planta sai sem a situação
  }
}
