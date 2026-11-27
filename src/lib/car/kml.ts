// Leitura do KML de entrada do CAR.
//
// O KML que chega é o da área total do imóvel, exportado do CAD ou do Google
// Earth. O CAD costuma gravar o perímetro como LineString FECHADA (último ponto
// = primeiro), não como Polygon — os dois valem. Linha ABERTA no mesmo arquivo
// é tratada como rio já traçado (vira APP com a faixa padrão, ajustável).
//
// Sem DOMParser de propósito: o mesmo código roda no navegador e nos testes
// do node, e o KML que importa aqui é sempre plano (Placemark → geometria).
import { avisosDosPontos, perimetroDosPontos } from "./gpx.ts";
import type { PontoGps } from "./gpx.ts";

export type LonLat = [number, number];

export interface LinhaKml { nome: string; linha: LonLat[] }

/** Um polígono do arquivo que pode entrar como gleba da área total. */
export interface PoligonoLido {
  nome: string | null;
  /** anel aberto, em grau */
  anel: LonLat[];
  nomes?: (string | null)[];
  /** entra na área total ao abrir (a pessoa liga e desliga na prévia) */
  incluir: boolean;
  /** por que veio desligado ("está dentro da gleba 1") */
  motivo?: string;
}

export interface KmlLido {
  /** nome do documento (ou do placemark do perímetro) */
  nome: string | null;
  /** anel aberto (sem repetir o primeiro ponto), na ordem do arquivo */
  perimetro: LonLat[];
  /** nome de cada vértice do perímetro, quando o arquivo traz (pontos do GPS: 218, 219…) */
  nomes?: (string | null)[];
  rios: LinhaKml[];
  avisos: string[];
  /**
   * Com mais de um polígono no arquivo (glebas): todos, do maior para o menor.
   * `perimetro` continua sendo o maior. Ausente = um polígono só.
   */
  poligonos?: PoligonoLido[];
}

/** Dois pontos iguais em grau: 1e-8° ≈ 1 mm. */
const IGUAL = 1e-8;

// (tirarTags, nomeDe e coordenadas também servem ao loteamento importado, loteamento/importar/kml.ts)
export const tirarTags = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();

export function nomeDe(bloco: string): string | null {
  const m = /<name>([\s\S]*?)<\/name>/i.exec(bloco);
  const n = m ? tirarTags(m[1]) : "";
  return n || null;
}

export function coordenadas(texto: string): LonLat[] {
  const out: LonLat[] = [];
  for (const tupla of tirarTags(texto).split(/\s+/)) {
    if (!tupla) continue;
    const [lon, lat] = tupla.split(",").map(Number);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  // pontos repetidos em sequência (o CAD às vezes grava o mesmo vértice duas vezes)
  return out.filter((p, i) => i === 0 || Math.abs(p[0] - out[i - 1][0]) > IGUAL || Math.abs(p[1] - out[i - 1][1]) > IGUAL);
}

const fechada = (l: LonLat[]) =>
  l.length >= 4 && Math.abs(l[0][0] - l[l.length - 1][0]) <= IGUAL && Math.abs(l[0][1] - l[l.length - 1][1]) <= IGUAL;

/** Área em grau² (só para escolher o maior anel). */
export function areaGrau(anel: LonLat[]): number {
  let s = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
}

export function lerKml(texto: string): KmlLido {
  const semComentario = texto.replace(/<!--[\s\S]*?-->/g, "");
  const doc = /<Document[^>]*>([\s\S]*)<\/Document>/i.exec(semComentario)?.[1] ?? semComentario;
  const nomeDoc = nomeDe(doc.replace(/<Placemark[\s\S]*?<\/Placemark>/gi, "").replace(/<Folder[\s\S]*?<\/Folder>/gi, ""));

  const aneis: { nome: string | null; anel: LonLat[] }[] = [];
  const linhas: LinhaKml[] = [];
  const placemarks = semComentario.match(/<Placemark[\s\S]*?<\/Placemark>/gi) ?? [];
  for (const pm of placemarks) {
    const nome = nomeDe(pm);
    // Polygon: só o contorno externo (furo em imóvel de CAR não existe na entrada)
    for (const pol of pm.match(/<Polygon[\s\S]*?<\/Polygon>/gi) ?? []) {
      const ext = /<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(pol);
      if (ext) aneis.push({ nome, anel: coordenadas(ext[1]) });
    }
    const semPoligono = pm.replace(/<Polygon[\s\S]*?<\/Polygon>/gi, "");
    for (const m of semPoligono.matchAll(/<(LineString|LinearRing)[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/gi)) {
      const pts = coordenadas(m[2]);
      if (m[1].toLowerCase() === "linearring" || fechada(pts)) aneis.push({ nome, anel: pts });
      else if (pts.length >= 2) linhas.push({ nome: nome ?? `Rio ${linhas.length + 1}`, linha: pts });
    }
  }

  const avisos: string[] = [];
  const validos = aneis
    .map((a) => ({ ...a, anel: fechada(a.anel) ? a.anel.slice(0, -1) : a.anel }))
    .filter((a) => a.anel.length >= 3);
  // KML só de pontos (o GPX dos pontos de passagem aberto no Google Earth e salvo):
  // os pontos marcados na divisa viram o perímetro, como no GPX
  const pontos: PontoGps[] = [];
  if (!validos.length) {
    for (const pm of placemarks) {
      const m = /<Point[^>]*>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i.exec(pm);
      const c = m ? coordenadas(m[1])[0] : undefined;
      if (c) pontos.push({ lon: c[0], lat: c[1], nome: nomeDe(pm), tempo: null });
    }
  }
  if (!validos.length && pontos.length >= 3) {
    const r = perimetroDosPontos(pontos);
    return { nome: nomeDoc, perimetro: r.anel, nomes: r.nomes, rios: linhas, avisos: [...avisosDosPontos(r, pontos.length), ...(linhas.length ? [`${linhas.length} linha(s) aberta(s) entraram como rio — confira a faixa de APP de cada uma.`] : [])] };
  }
  if (!validos.length) {
    throw new Error(linhas.length
      ? "O KML só tem linhas abertas. O perímetro do imóvel precisa ser um polígono (ou uma linha fechada, com o último ponto igual ao primeiro)."
      : "Não achei nenhum polígono no KML. Exporte a área total do imóvel como polígono ou linha fechada.");
  }
  validos.sort((a, b) => areaGrau(b.anel) - areaGrau(a.anel));
  const principal = validos[0];
  // glebas (27/11/2026): os polígonos do arquivo são as glebas da área total — entram todos,
  // menos o que está dentro de outro (reserva desenhada no CAD, divisão interna, cópia repetida)
  const poligonos = validos.length > 1 ? glebasDoArquivo(validos) : undefined;
  if (poligonos) {
    const dentro = poligonos.filter((p) => !p.incluir).length;
    avisos.push(`O arquivo tem ${validos.length} polígonos: ${dentro ? `${validos.length - dentro} entraram` : "entraram todos"} como glebas da área total, num shapefile só. Na lista de poligonais, marque ou desmarque o que é do imóvel.`);
  }
  if (linhas.length) avisos.push(`${linhas.length} linha(s) aberta(s) entraram como rio — confira a faixa de APP de cada uma.`);
  return { nome: nomeDoc ?? principal.nome, perimetro: principal.anel, rios: linhas, avisos, ...(poligonos ? { poligonos } : {}) };
}

/** Ponto dentro do anel (em grau; serve para conferir se um polígono está dentro do outro). */
function dentroGrau(p: LonLat, anel: LonLat[]): boolean {
  let d = false;
  for (let i = 0, j = anel.length - 1; i < anel.length; j = i++) {
    const a = anel[i], b = anel[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) d = !d;
  }
  return d;
}

/** Quase todo o anel `a` cai dentro de `b` (≥ 90% dos vértices e o centro)? */
function dentroDe(a: LonLat[], b: LonLat[]): boolean {
  const n = a.filter((p) => dentroGrau(p, b)).length;
  const cx = a.reduce((s, p) => s + p[0], 0) / a.length, cy = a.reduce((s, p) => s + p[1], 0) / a.length;
  return n >= 0.9 * a.length && dentroGrau([cx, cy], b);
}

/**
 * Os polígonos do arquivo como glebas (do maior para o menor). Entra todo
 * polígono que não está dentro de um maior: o que está dentro vem desligado
 * (é a reserva, uma divisão interna ou o mesmo polígono repetido).
 */
export function glebasDoArquivo(aneis: { nome: string | null; anel: LonLat[]; nomes?: (string | null)[] }[]): PoligonoLido[] {
  const ordenados = [...aneis].sort((a, b) => areaGrau(b.anel) - areaGrau(a.anel));
  return ordenados.map((p, i) => {
    const dono = ordenados.findIndex((q, j) => j < i && dentroDe(p.anel, q.anel));
    return {
      nome: p.nome, anel: p.anel, ...(p.nomes ? { nomes: p.nomes } : {}),
      incluir: dono < 0,
      ...(dono >= 0 ? { motivo: `está dentro do polígono ${dono + 1}${ordenados[dono].nome ? ` (${ordenados[dono].nome})` : ""}` } : {}),
    };
  });
}
