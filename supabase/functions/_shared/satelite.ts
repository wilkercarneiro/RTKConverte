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
