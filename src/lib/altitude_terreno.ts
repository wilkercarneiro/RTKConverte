// Altitude pela coordenada: quando o arquivo de pontos não traz a altitude (KML
// do Google Earth, planilha só com E/N, DXF 2D…), o sistema estima a de cada
// ponto no modelo digital de elevação público — os mesmos tiles "terrarium" da
// AWS do relevo do mapa interativo e do loteamento (~30 m de resolução de origem).
//
// Se parte dos pontos tem altitude medida, o modelo é calibrado por eles
// (mediana da diferença): o desnível vem do modelo, o nível absoluto do GNSS.
// Isso também absorve a diferença geoide × elipsoide quando o arquivo traz h
// elipsoidal. Sem nenhum ponto medido, sai a cota do modelo (≈ ortométrica).
//
// Navegador apenas (fetch + createImageBitmap + OffscreenCanvas).
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../supabase/functions/_shared/geo.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];
const URL_TILE = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const MAX_TILES = 40;

export interface PontoAltitude {
  /** chave do ponto (idx do leitor) */
  idx: number;
  e: number;
  n: number;
  /** geográfica lida do arquivo, quando havia (dispensa o fuso) */
  geo?: { lat: number; lon: number } | null;
  /** altitude medida (null = a estimar) */
  h: number | null;
}

export interface AltitudesEstimadas {
  /** idx → altitude estimada (m, 3 casas), só dos pontos sem altitude medida */
  valores: Record<number, number>;
  /** deslocamento aplicado ao modelo (m); null = sem ponto medido para calibrar */
  calibracao: number | null;
}

const tx = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const ty = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};

/**
 * Estima a altitude dos pontos sem `h`. Lança erro se a rede falhar ou faltar
 * fuso para ponto em UTM — a tela mostra e o bloqueio "sem altitude" continua.
 */
export async function estimarAltitudes(pontos: PontoAltitude[], fuso: number | null): Promise<AltitudesEstimadas> {
  const ud = fuso ? utmDef(fuso) : null;
  const ll = pontos.map((p) => {
    if (p.geo) return { p, lon: p.geo.lon, lat: p.geo.lat };
    if (!ud) throw new Error("Escolha o fuso UTM para o sistema achar o imóvel e buscar a altitude.");
    const [lon, lat] = proj(ud, GEO_DEF, [p.e, p.n]);
    return { p, lon, lat };
  });
  if (!ll.some((x) => x.p.h === null)) return { valores: {}, calibracao: null };

  // maior zoom que caiba no limite de tiles (imóvel grande desce o zoom)
  const tilesEm = (z: number) => new Set(ll.map((x) => `${Math.floor(tx(x.lon, z))}/${Math.floor(ty(x.lat, z))}`));
  let z = 14;
  while (z > 8 && tilesEm(z).size > MAX_TILES) z--;
  const lista = [...tilesEm(z)];
  // vizinhos à direita/abaixo para a interpolação na borda do tile
  for (const k of [...lista]) {
    const [x, y] = k.split("/").map(Number);
    for (const v of [`${x + 1}/${y}`, `${x}/${y + 1}`, `${x + 1}/${y + 1}`]) if (!lista.includes(v) && lista.length < MAX_TILES * 4) lista.push(v);
  }

  const tiles = new Map<string, Uint8ClampedArray>();
  const ctl = new AbortController();
  const prazo = setTimeout(() => ctl.abort(), 15000);
  try {
    await Promise.all(lista.map((k) => {
      const [x, y] = k.split("/").map(Number);
      return fetch(URL_TILE(z, x, y), { signal: ctl.signal })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? createImageBitmap(b) : null))
        .then((img) => {
          if (!img) return;
          const c = new OffscreenCanvas(256, 256);
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          tiles.set(k, ctx.getImageData(0, 0, 256, 256).data);
        })
        .catch(() => undefined);
    }));
  } finally {
    clearTimeout(prazo);
  }

  const px = (gx: number, gy: number): number => {
    const x = Math.floor(gx / 256), y = Math.floor(gy / 256);
    const d = tiles.get(`${x}/${y}`);
    if (!d) return NaN;
    const o = ((gy - y * 256) * 256 + (gx - x * 256)) * 4;
    return d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
  };
  // interpolação bilinear entre os quatro pixels vizinhos
  const cota = (lon: number, lat: number): number => {
    const fx = tx(lon, z) * 256 - 0.5, fy = ty(lat, z) * 256 - 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), d = px(x0 + 1, y0 + 1);
    if (![a, b, c, d].every(Number.isFinite)) return Number.isFinite(a) ? a : NaN;
    return a * (1 - ax) * (1 - ay) + b * ax * (1 - ay) + c * (1 - ax) * ay + d * ax * ay;
  };

  const dem = ll.map((x) => ({ ...x, c: cota(x.lon, x.lat) }));
  const faltando = dem.filter((x) => x.p.h === null && !Number.isFinite(x.c));
  if (faltando.length) throw new Error("Não foi possível baixar o modelo de terreno agora (rede). Tente de novo.");
  const difs = dem.filter((x) => x.p.h !== null && Number.isFinite(x.c)).map((x) => (x.p.h as number) - x.c).sort((a, b) => a - b);
  const calibracao = difs.length ? difs[Math.floor(difs.length / 2)] : null;
  const valores: Record<number, number> = {};
  for (const x of dem) {
    if (x.p.h !== null) continue;
    valores[x.p.idx] = Math.round((x.c + (calibracao ?? 0)) * 1000) / 1000;
  }
  return { valores, calibracao: calibracao === null ? null : Math.round(calibracao * 100) / 100 };
}
