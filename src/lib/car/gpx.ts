// Leitura do GPX de entrada do CAR (GPS de mão: eTrex, GPSMAP, celular).
//
// O GPX chega de três jeitos e os três valem:
//   • pontos de passagem (<wpt>) — o técnico anda a divisa e marca um ponto em
//     cada canto (é o caso do eTrex: 218, 219, 220…). O perímetro liga os pontos
//     e fecha no primeiro;
//   • trilha (<trk>/<trkseg>/<trkpt>) — o GPS grava o caminho enquanto se anda a
//     divisa. Trilha que volta perto do começo é o perímetro;
//   • rota (<rte>/<rtept>) — tratada como trilha.
//
// Ordem dos pontos de passagem: o arquivo pode vir na ordem da coleta, na ordem
// do nome ("1, 10, 11, 2…" quando o programa ordena como texto) ou misturado.
// Testamos a ordem do horário, a do número do nome e a do arquivo e ficamos com a
// primeira que fecha um polígono sem se cruzar. Se nenhuma fechar, os pontos são
// ligados em volta do centro e o aviso diz isso.
//
// Trilha de GPS tem um ponto a cada segundo e tremido de metros: vértices a menos
// de 1 m um do outro são o erro 3001 do SICAR ("vértices sobrepostos ou muito
// próximos"). A trilha é simplificada (Douglas-Peucker, 0,5 m) antes de virar perímetro.
//
// Sem DOMParser de propósito, como o KML: o mesmo código roda nos testes do node.
import type { KmlLido, LonLat } from "./kml.ts";

/** Ponto de passagem do GPS. */
export interface PontoGps {
  lon: number;
  lat: number;
  nome: string | null;
  /** horário da marcação (ms), quando o GPS gravou */
  tempo: number | null;
}

export interface GpxLido extends KmlLido {
  /**
   * Os pontos de passagem do arquivo, quando o perímetro saiu deles: a tela deixa
   * tirar um ponto que não é da divisa (a sede, um ponto de outro dia).
   */
  pontos: PontoGps[] | null;
}

/** Distância em metros entre dois pontos em grau (equiretangular: sobra para metros). */
export function metros(a: LonLat, b: LonLat): number {
  const lat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(lat);
  const dy = (b[1] - a[1]) * 110_574;
  return Math.hypot(dx, dy);
}

const desescapar = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&")
  .trim();

function tag(bloco: string, nome: string): string | null {
  const m = new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`, "i").exec(bloco);
  const v = m ? desescapar(m[1]) : "";
  return v || null;
}

/** Atributo numérico lat/lon de um <wpt>/<trkpt>/<rtept>. */
function coord(abertura: string, nome: "lat" | "lon"): number {
  const m = new RegExp(`\\b${nome}\\s*=\\s*["']([^"']+)["']`, "i").exec(abertura);
  return m ? Number(m[1]) : NaN;
}

/** Pontos de um tipo (wpt, trkpt, rtept) dentro do bloco, na ordem do arquivo. */
function pontosDe(bloco: string, el: "wpt" | "trkpt" | "rtept"): PontoGps[] {
  const out: PontoGps[] = [];
  // <wpt lat=".." lon=".."/> (vazio) ou <wpt ...>...</wpt>
  const re = new RegExp(`<${el}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${el}>)`, "gi");
  for (const m of bloco.matchAll(re)) {
    const lat = coord(m[1], "lat"), lon = coord(m[1], "lon");
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const corpo = m[2] ?? "";
    const t = tag(corpo, "time");
    const tempo = t ? Date.parse(t) : NaN;
    out.push({ lon, lat, nome: tag(corpo, "name"), tempo: Number.isFinite(tempo) ? tempo : null });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Geometria em grau (só o necessário para escolher a ordem)
// ---------------------------------------------------------------------------

/** Os segmentos p1p2 e p3p4 se cruzam (sem contar o toque nas pontas)? */
function cruzam(p1: LonLat, p2: LonLat, p3: LonLat, p4: LonLat): boolean {
  const o = (a: LonLat, b: LonLat, c: LonLat) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = o(p3, p4, p1), d2 = o(p3, p4, p2), d3 = o(p1, p2, p3), d4 = o(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** O anel fechado não se cruza? (O(n²): os perímetros do CAR têm de dezenas a poucas centenas de vértices.) */
export function anelSimples(anel: LonLat[]): boolean {
  const n = anel.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = anel[i], b = anel[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // lados vizinhos pelo fechamento
      if (cruzam(a, b, anel[j], anel[(j + 1) % n])) return false;
    }
  }
  return true;
}

function areaGrau(anel: LonLat[]): number {
  let s = 0;
  for (let i = 0; i < anel.length; i++) {
    const a = anel[i], b = anel[(i + 1) % anel.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s / 2);
}

/** Tira vértice repetido em sequência (a menos de `min` metros do anterior), inclusive no fechamento. */
function semColados<T>(pts: T[], pos: (p: T) => LonLat, min: number): T[] {
  const out: T[] = [];
  for (const p of pts) if (!out.length || metros(pos(out[out.length - 1]), pos(p)) >= min) out.push(p);
  while (out.length > 3 && metros(pos(out[out.length - 1]), pos(out[0])) < min) out.pop();
  return out;
}

/** Douglas-Peucker em metros (projeção local). Mantém a 1ª e a última posição. */
export function simplificar(linha: LonLat[], tol: number): LonLat[] {
  if (linha.length < 3) return linha;
  const lat0 = (linha.reduce((s, p) => s + p[1], 0) / linha.length) * (Math.PI / 180);
  const xy = linha.map((p) => [p[0] * 111_320 * Math.cos(lat0), p[1] * 110_574] as const);
  const manter = new Uint8Array(linha.length);
  manter[0] = manter[linha.length - 1] = 1;
  const pilha: [number, number][] = [[0, linha.length - 1]];
  while (pilha.length) {
    const [i, j] = pilha.pop()!;
    const [ax, ay] = xy[i], [bx, by] = xy[j];
    const L = Math.hypot(bx - ax, by - ay);
    let dm = -1, km = -1;
    for (let k = i + 1; k < j; k++) {
      const [px, py] = xy[k];
      const d = L < 1e-9 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L;
      if (d > dm) { dm = d; km = k; }
    }
    if (dm > tol && km > 0) { manter[km] = 1; pilha.push([i, km], [km, j]); }
  }
  return linha.filter((_, k) => manter[k]);
}

// ---------------------------------------------------------------------------
// Perímetro a partir dos pontos de passagem
// ---------------------------------------------------------------------------

export interface PerimetroDePontos {
  anel: LonLat[];
  nomes: (string | null)[];
  /** a ordem que valeu ("ordem do horário da coleta", "ordem do número do ponto", "ordem do arquivo", "em volta do centro") */
  criterio: string;
  /** false = nenhuma ordem fechou sem cruzar; foi ligado em volta do centro */
  simples: boolean;
  /** pontos colados (a menos de 1 m) que saíram */
  colados: number;
}

const numeroDoNome = (n: string | null) => {
  const m = n ? /-?\d+(?:[.,]\d+)?/.exec(n) : null;
  return m ? Number(m[0].replace(",", ".")) : NaN;
};

export function perimetroDosPontos(pontos: PontoGps[]): PerimetroDePontos {
  const pos = (p: PontoGps): LonLat => [p.lon, p.lat];
  const limpos = semColados(pontos, pos, 1);
  const colados = pontos.length - limpos.length;
  const ordens: { criterio: string; pts: PontoGps[] }[] = [];
  if (limpos.every((p) => p.tempo !== null)) {
    ordens.push({ criterio: "ordem do horário da coleta", pts: [...limpos].sort((a, b) => a.tempo! - b.tempo!) });
  }
  if (limpos.every((p) => Number.isFinite(numeroDoNome(p.nome)))) {
    ordens.push({ criterio: "ordem do número do ponto", pts: [...limpos].sort((a, b) => numeroDoNome(a.nome) - numeroDoNome(b.nome)) });
  }
  ordens.push({ criterio: "ordem do arquivo", pts: limpos });
  for (const o of ordens) {
    const anel = o.pts.map(pos);
    if (anelSimples(anel)) return { anel, nomes: o.pts.map((p) => p.nome), criterio: o.criterio, simples: true, colados };
  }
  // nenhuma ordem fecha sem cruzar: liga em volta do centro (vale para divisa sem reentrância funda)
  const cx = limpos.reduce((s, p) => s + p.lon, 0) / Math.max(1, limpos.length);
  const cy = limpos.reduce((s, p) => s + p.lat, 0) / Math.max(1, limpos.length);
  const pts = [...limpos].sort((a, b) => Math.atan2(a.lat - cy, a.lon - cx) - Math.atan2(b.lat - cy, b.lon - cx));
  return { anel: pts.map(pos), nomes: pts.map((p) => p.nome), criterio: "em volta do centro", simples: anelSimples(pts.map(pos)), colados };
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Trilha que volta a até 30 m (ou 5% do comprimento) do começo é um contorno fechado. */
function fechaSozinha(l: LonLat[]): boolean {
  if (l.length < 4) return false;
  let comp = 0;
  for (let i = 1; i < l.length; i++) comp += metros(l[i - 1], l[i]);
  return metros(l[0], l[l.length - 1]) <= Math.max(30, 0.05 * comp);
}

export function lerGpx(texto: string): GpxLido {
  const doc = texto.replace(/<!--[\s\S]*?-->/g, "");
  if (!/<gpx[\s>]/i.test(doc)) throw new Error("O arquivo não é um GPX (falta a marca <gpx>).");
  const nomeMeta = tag(/<metadata[\s\S]*?<\/metadata>/i.exec(doc)?.[0] ?? "", "name");

  // trilhas e rotas: cada segmento é uma linha
  const linhas: { nome: string | null; linha: LonLat[] }[] = [];
  for (const trk of doc.match(/<trk\b[\s\S]*?<\/trk>/gi) ?? []) {
    const nome = tag(trk.replace(/<trkseg[\s\S]*?<\/trkseg>/gi, ""), "name");
    for (const seg of trk.match(/<trkseg\b[\s\S]*?<\/trkseg>/gi) ?? []) {
      const l = pontosDe(seg, "trkpt").map((p): LonLat => [p.lon, p.lat]);
      if (l.length >= 2) linhas.push({ nome, linha: l });
    }
  }
  for (const rte of doc.match(/<rte\b[\s\S]*?<\/rte>/gi) ?? []) {
    const nome = tag(rte.replace(/<rtept[\s\S]*?<\/rtept>/gi, ""), "name");
    const l = pontosDe(rte, "rtept").map((p): LonLat => [p.lon, p.lat]);
    if (l.length >= 2) linhas.push({ nome, linha: l });
  }
  // pontos de passagem soltos (fora de rota e trilha)
  const wpts = pontosDe(doc.replace(/<rte\b[\s\S]*?<\/rte>/gi, "").replace(/<trk\b[\s\S]*?<\/trk>/gi, ""), "wpt");

  const avisos: string[] = [];
  const fechadas = linhas.filter((l) => fechaSozinha(l.linha));

  // 1) trilha fechada: o caminho andado é o perímetro
  if (fechadas.length) {
    const prep = fechadas.map((l) => {
      const semRepetir = semColados(l.linha, (p) => p, 1);
      return { nome: l.nome, anel: simplificar([...semRepetir, semRepetir[0]], 0.5).slice(0, -1), bruto: l.linha.length };
    }).filter((x) => x.anel.length >= 3).sort((a, b) => areaGrau(b.anel) - areaGrau(a.anel));
    if (prep.length) {
      const p = prep[0];
      if (prep.length > 1) avisos.push(`O GPX tem ${prep.length} trilhas fechadas; usei a maior${p.nome ? ` (${p.nome})` : ""} como área total do imóvel.`);
      if (p.bruto > p.anel.length + 2) avisos.push(`Trilha de ${p.bruto} pontos simplificada para ${p.anel.length} vértices (tolerância de 0,5 m; o SICAR recusa vértice colado no outro).`);
      if (!anelSimples(p.anel)) avisos.push("A trilha se cruza em algum ponto — confira o desenho antes de seguir.");
      if (wpts.length) avisos.push(`${wpts.length} ponto(s) de passagem do arquivo ficaram de fora: o perímetro veio da trilha.`);
      const abertas = linhas.length - fechadas.length;
      if (abertas) avisos.push(`${abertas} trilha(s) aberta(s) ficaram de fora (não fecham o contorno).`);
      return { nome: nomeMeta ?? p.nome, perimetro: p.anel, nomes: undefined, rios: [], avisos, pontos: null };
    }
  }

  // 2) pontos de passagem: a divisa marcada canto a canto
  if (wpts.length >= 3) {
    const r = perimetroDosPontos(wpts);
    if (r.anel.length < 3) throw new Error("Os pontos de passagem do GPX estão todos no mesmo lugar.");
    avisos.push(...avisosDosPontos(r, wpts.length));
    if (linhas.length) avisos.push(`${linhas.length} trilha(s) aberta(s) do arquivo ficaram de fora: o perímetro veio dos pontos de passagem.`);
    return { nome: nomeMeta, perimetro: r.anel, nomes: r.nomes, rios: [], avisos, pontos: wpts };
  }

  // 3) só trilha aberta: a mais longa, fechada no começo
  if (linhas.length) {
    const l = [...linhas].sort((a, b) => b.linha.length - a.linha.length)[0];
    const anel = simplificar(semColados(l.linha, (p) => p, 1), 0.5);
    if (anel.length >= 3) {
      avisos.push(`O GPX só tem trilha aberta: fechei a${l.nome ? ` "${l.nome}"` : " mais longa"} ligando o último ponto ao primeiro (${Math.round(metros(l.linha[l.linha.length - 1], l.linha[0]))} m). Confira se é mesmo a divisa.`);
      if (!anelSimples(anel)) avisos.push("O contorno se cruza em algum ponto — confira o desenho antes de seguir.");
      return { nome: nomeMeta ?? l.nome, perimetro: anel, nomes: undefined, rios: [], avisos, pontos: null };
    }
  }
  throw new Error(wpts.length
    ? `O GPX tem só ${wpts.length} ponto(s) de passagem; o perímetro precisa de pelo menos 3.`
    : "Não achei pontos de passagem nem trilha no GPX.");
}

/** Os avisos de um perímetro montado com pontos de passagem. */
export function avisosDosPontos(r: PerimetroDePontos, total: number): string[] {
  const avisos: string[] = [];
  const primeiro = r.nomes[0], ultimo = r.nomes[r.nomes.length - 1];
  const faixa = primeiro && ultimo ? ` (${primeiro} → ${ultimo})` : "";
  if (!r.simples) avisos.push(`Os ${total} pontos não fecham um polígono sem cruzar em nenhuma ordem; liguei em volta do centro. Tire os pontos que não são da divisa.`);
  else if (r.criterio === "em volta do centro") avisos.push(`Liguei os pontos em volta do centro${faixa}: as ordens do arquivo cruzavam o contorno.`);
  else avisos.push(`Perímetro com ${r.anel.length} pontos de passagem, ligados pela ${r.criterio}${faixa} e fechado no primeiro.`);
  if (r.colados) avisos.push(`${r.colados} ponto(s) repetido(s) a menos de 1 m do anterior saíram (o SICAR recusa vértice colado).`);
  return avisos;
}
