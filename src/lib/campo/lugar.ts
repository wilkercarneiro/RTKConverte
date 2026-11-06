// "Ir para": sem GPS (no computador do escritório), o mapa precisa chegar ao
// imóvel antes de desenhar. Uma caixa só entende o que o agrimensor costuma
// ter na mão (princípio 2 do plano — nada de escolher o tipo de entrada):
//   • decimal: "-12.6915, -39.1262", "-12,6915 -39,1262" ou "-12,6915, -39,1262" (lat, lon);
//   • GMS: 12°41'29.4"S 39°07'34.3"W (ou O), em qualquer ordem; minutos
//     decimais também (12°41,5'S 39°7,57'W);
//   • UTM: "24L 500000 8600000", "E 500000 N 8600000 fuso 24" (SIRGAS 2000,
//     hemisfério sul, as mesmas definições do motor geodésico);
//   • link do Google Maps: …/@-12.6915,-39.1262,17z, ?q=-12.69,-39.12, !3d…!4d….
import { utmParaGeo } from "../exportar/coordenadas.ts";
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

  // GMS: dois grupos com grau e hemisfério (segundos opcionais; minutos podem ter decimal)
  const gms = [...t.matchAll(/(\d{1,3}(?:[.,]\d+)?)\s*[°º]\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['’′]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:["”″]|'')\s*)?([NSLOWE])/gi)];
  if (gms.length === 2) {
    let lat: number | null = null, lon: number | null = null;
    const n = (x: string | undefined) => Number((x ?? "0").replace(",", "."));
    for (const g of gms) {
      const v = n(g[1]) + n(g[2]) / 60 + n(g[3]) / 3600;
      const h = g[4].toUpperCase();
      if (h === "N" || h === "S") lat = h === "S" ? -v : v;
      else lon = h === "W" || h === "O" ? -v : v;
    }
    return lat != null && lon != null ? valido(lat, lon) : null;
  }

  // UTM: E de 6 dígitos, N de 7 e o fuso (18 a 25, com ou sem a letra da banda)
  const utm = lerUtm(t);
  if (utm) return utm;

  // decimal: lat, lon. Vírgula decimal: "-12,69 -39,12", "-12,69; -39,12" ou "-12,69, -39,12"
  let partes: string[];
  const virgulaDecimal = /\d,\d/.test(t);
  if (t.includes(";")) partes = t.split(";");
  else if (virgulaDecimal && /,\s/.test(t)) partes = t.split(/,\s+/);
  else if (virgulaDecimal && /\s/.test(t)) partes = t.split(/\s+/);
  else partes = t.split(/[,\s]+/);
  partes = partes.map((p) => p.trim()).filter(Boolean);
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

function lerUtm(t: string): LonLat | null {
  const s = t.replace(/\d{1,3}(?:\.\d{3}){2,}/g, (m) => m.replace(/\./g, "")); // "8.600.000"
  const nums = [...s.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(",", ".")));
  const e = nums.find((v) => v >= 100_000 && v < 1_000_000);
  const n = nums.find((v) => v >= 1_000_000 && v <= 10_000_000);
  if (e == null || n == null) return null;
  const mf = s.match(/(?:fuso|zona|zone|utm|mc)\s*[:=]?\s*(1[89]|2[0-5])\s*[a-z]?\b/i) ?? s.match(/\b(1[89]|2[0-5])\s*[c-hj-np-x]\b/i);
  const fuso = mf ? Number(mf[1]) : nums.find((v) => Number.isInteger(v) && v >= 18 && v <= 25) ?? null;
  if (fuso == null) return null;
  const [lon, lat] = utmParaGeo([e, n], fuso);
  return valido(lat, lon);
}
