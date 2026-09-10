// Imagem de satélite da PLANTA DE SITUAÇÃO buscada pelas coordenadas.
//
// Até 2026-09 a imagem só entrava por upload do operador (print de tela do
// Google Earth, em geral). Agora o sistema pede a imagem ao Mapbox Static
// Images pela geometria do imóvel (ou da gleba): o polígono vai desenhado por
// cima e o enquadramento é automático. Este módulo é puro — monta a URL e
// prepara a geometria; quem faz o fetch e guarda no Storage é a edge function
// `buscar-satelite`.
//
// Mapbox: https://docs.mapbox.com/api/maps/static-images/
//   - overlay `path-{largura}+{cor}-{opacidade}+{preenchimento}-{opacidade}({polyline})`
//   - posição `auto` enquadra o overlay; `padding` dá a margem em pixels
//   - URL limitada a 8 192 caracteres → o anel é simplificado até caber
//   - a imagem já sai com o logo e os créditos (© Mapbox © OpenStreetMap
//     © Maxar), que os termos exigem manter — por isso nada é desenhado por
//     cima na planta.

export type LonLat = [number, number];

/** Estilo com rodovias e nomes de localidades: é o que situa o imóvel. */
export const ESTILO_PADRAO = "mapbox/satellite-streets-v12";

/**
 * Polyline do Google (precisão 5), que é o que o overlay `path` do Mapbox lê.
 * Recebe [lon, lat] (ordem GeoJSON) e codifica lat antes de lon, como manda o
 * formato.
 */
export function codificarPolyline(pontos: LonLat[]): string {
  let out = "";
  let lat0 = 0, lon0 = 0;
  const num = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    return s + String.fromCharCode(n + 63);
  };
  for (const [lon, lat] of pontos) {
    const la = Math.round(lat * 1e5), lo = Math.round(lon * 1e5);
    out += num(la - lat0) + num(lo - lon0);
    lat0 = la; lon0 = lo;
  }
  return out;
}

/** Distância de um ponto ao segmento ab, no plano (graus — só serve para comparar). */
function distSeg(p: LonLat, a: LonLat, b: LonLat): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const qx = a[0] + t * dx, qy = a[1] + t * dy;
  return Math.hypot(p[0] - qx, p[1] - qy);
}

/** Douglas-Peucker sobre uma linha aberta. */
function dp(pontos: LonLat[], tol: number): LonLat[] {
  if (pontos.length <= 2) return pontos;
  let iMax = 0, dMax = 0;
  const a = pontos[0], b = pontos[pontos.length - 1];
  for (let i = 1; i < pontos.length - 1; i++) {
    const d = distSeg(pontos[i], a, b);
    if (d > dMax) { dMax = d; iMax = i; }
  }
  if (dMax <= tol) return [a, b];
  const esq = dp(pontos.slice(0, iMax + 1), tol);
  const dir = dp(pontos.slice(iMax), tol);
  return esq.slice(0, -1).concat(dir);
}

/**
 * Reduz o anel até que a polyline caiba em `maxChars`. Um anel de 300
 * vértices dá uns 3 000 caracteres — em geral cabe sem tocar; levantamentos
 * com mais de mil vértices (estradas sinuosas) é que precisam afinar. A
 * tolerância cresce em progressão até caber; o desenho perde só o que não se
 * enxerga numa imagem de 2 000 px.
 */
export function simplificarParaCaber(anel: LonLat[], maxChars: number): LonLat[] {
  let atual = anel;
  let tol = 0.00001; // ~1 m
  while (codificarPolyline(atual).length > maxChars && atual.length > 4) {
    atual = dp(anel, tol);
    tol *= 2;
  }
  return atual;
}

/**
 * Anel fechado para o overlay: o último ponto repete o primeiro, senão o
 * Mapbox desenha a linha aberta (o preenchimento fecha, o traço não).
 */
export function fecharAnel(anel: LonLat[]): LonLat[] {
  if (anel.length === 0) return anel;
  const a = anel[0], z = anel[anel.length - 1];
  return a[0] === z[0] && a[1] === z[1] ? anel : [...anel, a];
}

export interface OpcoesImagem {
  token: string;
  /** Pixels lógicos; a URL pede @2x, então a imagem sai com o dobro. Máximo 1280. */
  largura?: number;
  altura?: number;
  estilo?: string;
  /** Margem em pixels entre o polígono e a borda. */
  margem?: number;
}

/**
 * URL da imagem estática com o polígono do imóvel desenhado por cima.
 * Cada anel vem em [lon, lat] (SIRGAS2000 ≈ WGS84 para esta finalidade: a
 * diferença é centimétrica e a imagem tem metros por pixel). Vários anéis =
 * imóvel em partes (glebas separadas por estrada): cada uma vira um overlay e
 * o enquadramento `auto` abraça todas.
 */
export function urlImagemSatelite(aneis: LonLat[][], o: OpcoesImagem): string {
  const validos = aneis.filter((a) => a.length >= 3);
  if (validos.length === 0) throw new Error("O polígono precisa de pelo menos 3 vértices");
  const largura = Math.min(1280, o.largura ?? 1000);
  const altura = Math.min(1280, o.altura ?? 750);
  const estilo = o.estilo ?? ESTILO_PADRAO;
  const margem = o.margem ?? 70;
  // orçamento da URL: 8 192 no total; a parte fixa fica em ~250 e o overlay
  // ainda passa por encodeURIComponent (cada caractere especial vira 3)
  const porAnel = Math.floor(2400 / validos.length);
  // traço amarelo, preenchimento leve — a imagem embaixo é o que importa
  const overlay = validos
    .map((a) => `path-4+ffd800-1+ffd800-0.12(${encodeURIComponent(codificarPolyline(fecharAnel(simplificarParaCaber(a, porAnel))))})`)
    .join(",");
  return `https://api.mapbox.com/styles/v1/${estilo}/static/${overlay}/auto/${largura}x${altura}@2x` +
    `?padding=${margem}&access_token=${encodeURIComponent(o.token)}`;
}

// ---------------------------------------------------------------------------
// Garantia da imagem na geração
//
// A planta não depende mais de upload: quem gera (gerar-planta,
// gerar-documentos) chama `garantirImagemSatelite` com o anel do imóvel ou da
// gleba. Se a imagem já está em `entrada/`, é ela; senão o Mapbox é chamado e
// o resultado fica guardado para as gerações seguintes (e para a prévia da
// tela). Falha vira aviso, nunca planta perdida: o quadro sai vazio e o
// operador é avisado.

export interface ImagemSatelite { bytes: Uint8Array; tipo: "png" | "jpg" }

/** O mínimo do Storage que estas funções usam — evita casar com os genéricos do supabase-js. */
export interface StorageMinimo {
  from: (bucket: string) => {
    download: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
    upload: (path: string, bytes: Uint8Array, opts: { upsert: boolean; contentType: string }) => Promise<{ error: { message: string } | null }>;
    remove: (paths: string[]) => Promise<unknown>;
  };
}

/** [lon, lat] a partir das coordenadas planas do desenho (E/N no fuso do serviço). */
export function anelLonLatDeEN(
  pontos: { e: number | string | null; n: number | string | null }[],
  fuso: number,
  proj4: (from: string, to: string, c: [number, number]) => [number, number],
): LonLat[] {
  const utm = `+proj=utm +zone=${fuso} +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  const geo = "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs";
  const out: LonLat[] = [];
  for (const p of pontos) {
    if (p.e == null || p.n == null) continue;
    const e = Number(p.e), n = Number(p.n);
    if (!Number.isFinite(e) || !Number.isFinite(n) || (e === 0 && n === 0)) continue;
    out.push(proj4(utm, geo, [e, n]));
  }
  return out;
}

/** A imagem guardada em `entrada/{nome}.png|jpg`, ou null. */
export async function baixarImagemGuardada(storage: StorageMinimo, servicoId: string, nome: string): Promise<ImagemSatelite | null> {
  for (const tipo of ["png", "jpg"] as const) {
    const dl = await storage.from("gerados").download(`${servicoId}/entrada/${nome}.${tipo}`);
    if (dl.error || !dl.data) continue;
    return { bytes: new Uint8Array(await dl.data.arrayBuffer()), tipo };
  }
  return null;
}

/** Pede a imagem ao Mapbox. Lança em qualquer falha (status, rede). */
export async function buscarImagemMapbox(aneis: LonLat[][], token: string, opcoes?: Omit<OpcoesImagem, "token">): Promise<ImagemSatelite> {
  const resp = await fetch(urlImagemSatelite(aneis, { token, ...(opcoes ?? {}) }));
  if (!resp.ok) {
    const corpo = await resp.text().catch(() => "");
    throw new Error(`Mapbox respondeu ${resp.status}: ${corpo.slice(0, 200)}`);
  }
  const ct = resp.headers.get("content-type") ?? "";
  return { bytes: new Uint8Array(await resp.arrayBuffer()), tipo: /jpe?g/i.test(ct) ? "jpg" : "png" };
}

/** Guarda em `entrada/{nome}.{tipo}` e apaga a outra extensão, para sobrar uma só. */
export async function guardarImagem(storage: StorageMinimo, servicoId: string, nome: string, img: ImagemSatelite): Promise<void> {
  const pasta = `${servicoId}/entrada`;
  const up = await storage.from("gerados").upload(`${pasta}/${nome}.${img.tipo}`, img.bytes,
    { upsert: true, contentType: img.tipo === "png" ? "image/png" : "image/jpeg" });
  if (up.error) throw new Error(`não ficou guardada no Storage: ${up.error.message}`);
  await storage.from("gerados").remove([`${pasta}/${nome}.${img.tipo === "png" ? "jpg" : "png"}`]);
}

/**
 * A imagem para a planta: a guardada, ou a buscada agora (e guardada). `aviso`
 * explica por que veio null — e é o que a geração devolve ao operador.
 */
export async function garantirImagemSatelite(
  storage: StorageMinimo,
  servicoId: string,
  nome: string,
  aneis: LonLat[][],
  token: string | undefined,
  rotulo: string,
): Promise<{ imagem: ImagemSatelite | null; aviso: string | null }> {
  const guardada = await baixarImagemGuardada(storage, servicoId, nome);
  if (guardada) return { imagem: guardada, aviso: null };
  if (!token) return { imagem: null, aviso: `${rotulo}: MAPBOX_TOKEN não configurado no servidor — a planta saiu sem imagem de satélite.` };
  try {
    const img = await buscarImagemMapbox(aneis, token);
    try { await guardarImagem(storage, servicoId, nome, img); } catch { /* a planta desta geração sai mesmo assim */ }
    return { imagem: img, aviso: null };
  } catch (e) {
    return { imagem: null, aviso: `${rotulo}: a imagem de satélite não pôde ser buscada (${e instanceof Error ? e.message : String(e)}) — o quadro PLANTA DE SITUAÇÃO saiu vazio.` };
  }
}

// ---------------------------------------------------------------------------
// Mapa da TELA (conferência de vértices e confrontantes)
//
// Para desenhar os pontos por cima da imagem é preciso saber onde cada
// coordenada cai nela. O enquadramento `auto` do Mapbox não diz; por isso o
// mapa da tela é pedido com centro e zoom EXPLÍCITOS (Web Mercator, tiles de
// 512 px), sem overlay — os pontos e as divisas são do SVG. A imagem fica em
// `entrada/mapa.jpg` e a georreferência em `entrada/mapa.json`.

export interface GeorefMapa {
  /** centro da imagem */
  lon: number;
  lat: number;
  /** zoom Web Mercator (fracionário) */
  zoom: number;
  /** tamanho LÓGICO em pixels (a imagem @2x tem o dobro) */
  largura: number;
  altura: number;
}

/** Pixel Web Mercator global (origem no canto NW do mundo) para o zoom dado, tiles de 512 px. */
export function mercatorPx(lon: number, lat: number, zoom: number): [number, number] {
  const mundo = 512 * Math.pow(2, zoom);
  const x = ((lon + 180) / 360) * mundo;
  const fi = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(fi) + 1 / Math.cos(fi)) / Math.PI) / 2) * mundo;
  return [x, y];
}

/**
 * Centro e zoom que enquadram todos os anéis numa imagem largura×altura com
 * `margem` px de folga. O zoom sai fracionário, como o Mapbox aceita.
 */
export function enquadrar(aneis: LonLat[][], largura: number, altura: number, margem: number): GeorefMapa {
  const pts = aneis.flat();
  if (pts.length === 0) throw new Error("Nada para enquadrar");
  // extremos no zoom 0 e escala necessária
  const px0 = pts.map(([lon, lat]) => mercatorPx(lon, lat, 0));
  const minX = Math.min(...px0.map((p) => p[0])), maxX = Math.max(...px0.map((p) => p[0]));
  const minY = Math.min(...px0.map((p) => p[1])), maxY = Math.max(...px0.map((p) => p[1]));
  const dx = Math.max(maxX - minX, 1e-9), dy = Math.max(maxY - minY, 1e-9);
  const escala = Math.min((largura - 2 * margem) / dx, (altura - 2 * margem) / dy);
  let zoom = Math.log2(escala);
  zoom = Math.max(0, Math.min(20, Math.round(zoom * 1000) / 1000));
  // centro: desfaz o Mercator no ponto médio
  const mundo = 512;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const lon = (cx / mundo) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * cy) / mundo;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lon, lat, zoom, largura, altura };
}

/** Posição (px) de uma coordenada DENTRO da imagem descrita por `g`, em pixels lógicos. */
export function pontoNoMapa(lon: number, lat: number, g: GeorefMapa): [number, number] {
  const [x, y] = mercatorPx(lon, lat, g.zoom);
  const [cx, cy] = mercatorPx(g.lon, g.lat, g.zoom);
  return [x - cx + g.largura / 2, y - cy + g.altura / 2];
}

/** URL da imagem LIMPA (sem overlay) no enquadramento dado. */
export function urlMapaSatelite(g: GeorefMapa, token: string, estilo = ESTILO_PADRAO): string {
  return `https://api.mapbox.com/styles/v1/${estilo}/static/${g.lon.toFixed(6)},${g.lat.toFixed(6)},${g.zoom},0/` +
    `${g.largura}x${g.altura}@2x?access_token=${encodeURIComponent(token)}`;
}
