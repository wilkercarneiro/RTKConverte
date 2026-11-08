// Calibração num ponto conhecido (Medir no campo): o "diferencial do pobre".
//
// O erro do GPS do celular numa medição curta (dezenas de minutos, centenas de
// metros) é quase o MESMO em todo o trajeto: os satélites, a ionosfera e o
// modelo do aparelho mudam devagar. Parado sobre um ponto de coordenada
// conhecida — um vértice certificado do SIGEF do vizinho, um marco do IBGE ou
// um ponto que o agrimensor já levantou de RTK — a diferença entre o que o GPS
// diz e a verdade é esse erro, e ele sai de todos os vértices.
//
// Com duas ou mais calibrações (uma no começo, outra no fim), o deslocamento de
// cada vértice é interpolado no tempo, porque o erro anda devagar. Antes da
// primeira vale a primeira; depois da última, a última.
//
// Os vértices guardam a posição do GPS (`bruto`) e o deslocamento aplicado
// (`correcao`): recalibrar ou tirar a calibração refaz tudo a partir do bruto.
// Desenhado à mão não muda (não veio do GPS). Puro: a tela e os testes usam igual.
import { geoParaUtm, utmParaGeo } from "../exportar/coordenadas.ts";
import { distanciaM, fusoDaMedicao } from "./geometria.ts";
import type { Calibracao, CorrecaoAplicada, LonLat, VerticeCampo } from "./tipos.ts";

/** A calibração é velha demais para confiar (o erro do celular já mudou): 30 min. */
export const CALIBRACAO_VALIDA_MS = 30 * 60 * 1000;

/** Deslocamento verdadeiro − medido, em metros no UTM do lugar. */
export function deslocamento(conhecido: { lon: number; lat: number }, medido: { lon: number; lat: number }): { dE: number; dN: number } {
  const fuso = fusoDaMedicao([conhecido]);
  const a = geoParaUtm([conhecido.lon, conhecido.lat], fuso);
  const b = geoParaUtm([medido.lon, medido.lat], fuso);
  return { dE: a[0] - b[0], dN: a[1] - b[1] };
}

/** Desloca um ponto lon/lat por (dE, dN) metros, no UTM do lugar. */
export function aplicarDeslocamento(p: { lon: number; lat: number }, d: CorrecaoAplicada): { lon: number; lat: number } {
  const fuso = fusoDaMedicao([p]);
  const u = geoParaUtm([p.lon, p.lat], fuso);
  const [lon, lat] = utmParaGeo([u[0] + d.dE, u[1] + d.dN], fuso);
  return { lon, lat };
}

/** O deslocamento que vale no instante t (interpolado entre calibrações). null = sem calibração. */
export function correcaoNoTempo(calibracoes: readonly Calibracao[] | undefined, t: number): CorrecaoAplicada | null {
  if (!calibracoes?.length) return null;
  const cs = [...calibracoes].sort((a, b) => a.t - b.t);
  if (t <= cs[0].t) return { dE: cs[0].dE, dN: cs[0].dN };
  const u = cs[cs.length - 1];
  if (t >= u.t) return { dE: u.dE, dN: u.dN };
  for (let i = 0; i < cs.length - 1; i++) {
    const a = cs[i], b = cs[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
      return { dE: a.dE + f * (b.dE - a.dE), dN: a.dN + f * (b.dN - a.dN) };
    }
  }
  return { dE: u.dE, dN: u.dN };
}

/** A posição como o GPS deu (sem calibração). */
export const brutoDe = (v: VerticeCampo): { lon: number; lat: number } => v.bruto ?? { lon: v.lon, lat: v.lat };

/** Um vértice com as calibrações aplicadas (ou sem nenhuma, voltando ao bruto). À mão não muda. */
export function calibrarVertice(v: VerticeCampo, calibracoes: readonly Calibracao[] | undefined): VerticeCampo {
  if (v.modo === "mao") return v;
  const base = brutoDe(v);
  const c = correcaoNoTempo(calibracoes, v.t);
  const { bruto: _b, correcao: _c, ...resto } = v;
  if (!c) return { ...resto, lon: base.lon, lat: base.lat };
  const p = aplicarDeslocamento(base, c);
  return { ...resto, lon: p.lon, lat: p.lat, bruto: base, correcao: { dE: arred(c.dE), dN: arred(c.dN) } };
}

const arred = (m: number) => Math.round(m * 1000) / 1000;

/** Todos os vértices refeitos com as calibrações. */
export function aplicarCalibracoes(vertices: VerticeCampo[], calibracoes: readonly Calibracao[] | undefined): VerticeCampo[] {
  return vertices.map((v) => calibrarVertice(v, calibracoes));
}

/** Monta a calibração a partir do marco e da média da ocupação. */
export function novaCalibracao(
  rotulo: string, conhecido: { lon: number; lat: number },
  medido: { lon: number; lat: number; precisao: number | null; leituras: number }, t: number,
  id = `cal-${t}-${Math.round(Math.random() * 1e6)}`,
): Calibracao {
  const { dE, dN } = deslocamento(conhecido, medido);
  return { id, rotulo, conhecido: { lon: conhecido.lon, lat: conhecido.lat }, medido, dE: arred(dE), dN: arred(dN), t };
}

/** "2,1 m para nordeste" — o tamanho e o rumo do deslocamento, para a tela. */
export function textoDeslocamento(c: { dE: number; dN: number }): string {
  const d = Math.hypot(c.dE, c.dN);
  const rumos = ["norte", "nordeste", "leste", "sudeste", "sul", "sudoeste", "oeste", "noroeste"];
  const az = (Math.atan2(c.dE, c.dN) * 180 / Math.PI + 360) % 360;
  const r = rumos[Math.round(az / 45) % 8];
  const m = d < 1 ? `${Math.round(d * 100)} cm` : `${d.toFixed(1).replace(".", ",")} m`;
  return `${m} para ${r}`;
}

/** Calibração suspeita: deslocamento maior que 15 m (marco errado, ou o GPS estava sem sinal). */
export const calibracaoSuspeita = (c: { dE: number; dN: number }): boolean => Math.hypot(c.dE, c.dN) > 15;

// ---------------------------------------------------------------- marcos SIGEF

export interface MarcoProximo {
  lon: number;
  lat: number;
  distM: number;
  /** "SIGEF · FAZENDA X · vértice 7" */
  rotulo: string;
  codigo: string | null;
}

/**
 * Os vértices das parcelas certificadas (SIGEF) perto do ponto, do mais perto ao
 * mais longe, sem repetir o vértice que é divisa de duas parcelas (raio de 5 cm).
 * `parcelas` é o FeatureCollection da base (sigef_consultar).
 */
export function marcosProximos(
  parcelas: { features: readonly { properties?: unknown; geometry?: { type: string; coordinates: unknown } | null }[] },
  ponto: { lon: number; lat: number }, raioM = 500, max = 40,
): MarcoProximo[] {
  const saida: MarcoProximo[] = [];
  for (const f of parcelas.features ?? []) {
    const g = f.geometry;
    if (!g) continue;
    const props = (f.properties ?? {}) as Record<string, unknown>;
    const codigo = typeof props.codigo === "string" ? props.codigo : null;
    const nome = typeof props.nome === "string" && props.nome.trim() ? props.nome.trim() : null;
    const poligonos: LonLat[][][] = g.type === "Polygon" ? [g.coordinates as LonLat[][]] : g.type === "MultiPolygon" ? (g.coordinates as LonLat[][][]) : [];
    for (const pol of poligonos) {
      for (const anel of pol) {
        const n = anel.length > 1 && anel[0][0] === anel[anel.length - 1][0] && anel[0][1] === anel[anel.length - 1][1] ? anel.length - 1 : anel.length;
        for (let i = 0; i < n; i++) {
          const [lon, lat] = anel[i];
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
          const distM = distanciaM(ponto, { lon, lat });
          if (distM > raioM) continue;
          if (saida.some((m) => distanciaM(m, { lon, lat }) < 0.05)) continue;
          saida.push({ lon, lat, distM, codigo, rotulo: `SIGEF · ${nome ?? codigo ?? "parcela certificada"} · vértice ${i + 1}` });
        }
      }
    }
  }
  return saida.sort((a, b) => a.distM - b.distM).slice(0, max);
}

/**
 * Coordenada digitada do marco: "-12,345678 -38,123456" / "-12.345678, -38.123456"
 * (lat, lon em graus decimais) ou UTM "E N fuso" ("512345,67 8634567,89 24").
 * Devolve lon/lat ou o motivo de não servir.
 */
export function lerCoordenadaMarco(texto: string): { lon: number; lat: number } | { erro: string } {
  const limpo = texto.trim().replace(/[;\t]/g, " ");
  // números com vírgula decimal: "−12,3456" → troca a vírgula decimal (seguida de dígitos) por ponto
  const nums = limpo.match(/-?\d+(?:[.,]\d+)?/g)?.map((n) => Number(n.replace(",", "."))) ?? [];
  if (nums.length === 2) {
    const [lat, lon] = nums;
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      if (lat > 10 || lon > -25 || lon < -75) return { erro: "A coordenada não fica no Brasil. Use latitude e longitude em graus (ex.: -12.345678, -38.123456)." };
      return { lon, lat };
    }
  }
  if (nums.length === 3) {
    const [e, n, fuso] = nums;
    if (e > 100000 && e < 900000 && n > 0 && n < 10000000 && fuso >= 18 && fuso <= 25 && Number.isInteger(fuso)) {
      const [lon, lat] = utmParaGeo([e, n], fuso);
      return { lon, lat };
    }
    return { erro: "Em UTM, digite E, N e o fuso (ex.: 512345,67 8634567,89 24), hemisfério sul." };
  }
  return { erro: "Digite latitude e longitude (ex.: -12.345678, -38.123456) ou E N fuso em UTM." };
}
