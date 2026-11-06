// "Ir para": sem GPS (no computador do escritório), o mapa precisa chegar ao
// imóvel antes de desenhar. Uma caixa só entende o que o agrimensor costuma
// ter na mão (princípio 2 do plano — nada de escolher o tipo de entrada):
//   • decimal: "-12.6915, -39.1262" ou "-12,6915 -39,1262" (lat, lon);
//   • GMS: 12°41'29.4"S 39°07'34.3"W (ou O), em qualquer ordem;
//   • link do Google Maps: …/@-12.6915,-39.1262,17z, ?q=-12.69,-39.12, !3d…!4d….
import type { LonLat } from "./tipos.ts";

const valido = (lat: number, lon: number): LonLat | null =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0) ? [lon, lat] : null;

/** Lê o lugar digitado/colado. null = não entendeu. */
export function lerLugar(texto: string): LonLat | null {
  const t = (texto ?? "").trim();
  if (!t) return null;

  // link do Google Maps
  if (/google\.|goo\.gl|maps\.app/i.test(t)) {
    const d = decodeURIComponent(t);
    const m3d = d.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (m3d) return valido(Number(m3d[1]), Number(m3d[2]));
    const arroba = d.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (arroba) return valido(Number(arroba[1]), Number(arroba[2]));
    const q = d.match(/[?&](?:q|query|ll|center)=(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (q) return valido(Number(q[1]), Number(q[2]));
    return null;
  }

  // GMS: dois grupos com grau e hemisfério
  const gms = [...t.matchAll(/(\d{1,3})\s*[°º]\s*(?:(\d{1,2})\s*['’′]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["”″]|'')\s*)?([NSLOWE])/gi)];
  if (gms.length === 2) {
    let lat: number | null = null, lon: number | null = null;
    for (const g of gms) {
      const v = Number(g[1]) + Number(g[2] ?? 0) / 60 + Number((g[3] ?? "0").replace(",", ".")) / 3600;
      const h = g[4].toUpperCase();
      if (h === "N" || h === "S") lat = h === "S" ? -v : v;
      else lon = h === "W" || h === "O" ? -v : v;
    }
    return lat != null && lon != null ? valido(lat, lon) : null;
  }

  // decimal: lat, lon (vírgula decimal aceita quando separado por espaço ou ;)
  const sep = t.includes(";") || (/\d,\d/.test(t) && !/,\s/.test(t) && /\s/.test(t)) ? /[;\s]+/ : /[,;\s]+/;
  const partes = t.split(sep).map((p) => p.trim()).filter(Boolean);
  if (partes.length === 2) {
    const [a, b] = partes.map((p) => Number(p.replace(",", ".")));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    // a ordem é lat, lon; veio lon, lat (como no KML/GeoJSON)? no Brasil dá para saber
    const ehLonBr = (v: number) => v >= -75 && v <= -28, ehLatBr = (v: number) => v >= -35 && v <= 6;
    const trocado = Math.abs(a) > 90 || (ehLonBr(a) && ehLatBr(b) && Math.abs(a) > Math.abs(b));
    return trocado ? valido(b, a) : valido(a, b);
  }
  return null;
}
