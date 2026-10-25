// Arquivos que saem do loteamento.
//
//  • LOCAÇÃO (vai para a coletora do técnico de campo): pontos com nome curto,
//    sem acento, em UTM, na ordem em que se anda em volta de cada quadra.
//    O nome do ponto é o MESMO na planta, no memorial e no arquivo — o técnico
//    procura "A-07" na coletora e acha o "A-07" que está no papel.
//  • DXF (prefeitura/CAD), KML (o cliente vê no Google Earth), quadro de lotes.
//
// Coordenadas sempre em UTM SIRGAS 2000 do fuso do serviço: o plano de projeto
// (medidas de terreno) volta para UTM aqui, pelo fator de escala.
import proj4mod from "proj4";
import { GEO_DEF, fmtAzimute, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import { caixa, centroide, dist, dot, esquerda, sub, unit } from "./geom.ts";
import type { Anel, Poligono, Pt } from "./geom.ts";
import { fmt, viarioDe } from "./calculo.ts";
import type { Lado, Lote, Perimetro, Quadra, Resultado } from "./calculo.ts";
import { paraUtm } from "./plano.ts";
import type { Projeto } from "./modelo.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

// ---------------------------------------------------------------------------
// Pontos de locação
// ---------------------------------------------------------------------------

export interface PontoLocacao {
  nome: string;
  /** UTM */
  e: number;
  n: number;
  /** cota estimada (interpolada do perímetro) */
  h: number;
  /** código/descrição curta para a coletora */
  codigo: string;
  /** plano (para desenhar) */
  p: Pt;
  tipo: "lote" | "curva" | "eixo" | "perimetro";
  quadra?: string;
}

export interface OpcoesLocacao {
  lotes: boolean;
  /** PC, PT e meio das curvas de esquina */
  curvas: boolean;
  /** estacas no eixo das ruas */
  eixos: boolean;
  estaca: number;
  perimetro: boolean;
}

export const LOCACAO_PADRAO: OpcoesLocacao = { lotes: true, curvas: true, eixos: true, estaca: 20, perimetro: false };

const chave = (p: Pt) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;
const limparCodigo = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[,;"\t]/g, " ").replace(/\s+/g, " ").trim().toUpperCase();
const limparNome = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9\-_.]/g, "").toUpperCase().slice(0, 16);

/** Cota por inverso da distância ao quadrado aos vértices do perímetro. */
function cotaEstimada(p: Pt, perim: Pt[], hs: number[]): number {
  let sw = 0, sh = 0;
  for (let i = 0; i < perim.length; i++) {
    if (!Number.isFinite(hs[i]) || hs[i] === 0) continue;
    const d = dist(p, perim[i]);
    if (d < 0.01) return hs[i];
    const w = 1 / (d * d);
    sw += w; sh += w * hs[i];
  }
  return sw ? sh / sw : 0;
}

/**
 * Numera os pontos de cada quadra andando em volta dela (sentido horário, a
 * partir do canto noroeste) e depois os pontos internos (linha de fundo).
 * Pontos intermediários dos arcos de esquina saem da locação: o técnico loca
 * PC, PT e o meio da curva.
 */
export function pontosDeLocacao(res: Resultado, perimetro: Perimetro, op: OpcoesLocacao = LOCACAO_PADRAO): PontoLocacao[] {
  const out: PontoLocacao[] = [];
  const glebaPl = res.gleba.ext;
  const hsPl = perimetro.altitudes;
  const perimPl = perimetro.pts.map((q) => [(q[0] - res.plano.centro[0]) / res.plano.k, (q[1] - res.plano.centro[1]) / res.plano.k] as Pt);
  void glebaPl;
  const add = (p: Pt, nome: string, codigo: string, tipo: PontoLocacao["tipo"], quadra?: string) => {
    const u = paraUtm(res.plano, p);
    out.push({ nome: limparNome(nome), e: u[0], n: u[1], h: cotaEstimada(p, perimPl, hsPl), codigo: limparCodigo(codigo), p, tipo, quadra });
  };

  if (op.lotes || op.curvas) {
    for (const q of res.quadras) {
      const intermed = new Set(q.curvas.flatMap((c) => c.intermediarios.map(chave)));
      const pcs = new Map<string, string>();
      q.curvas.forEach((c, i) => {
        pcs.set(chave(c.pc), `PC${i + 1}`); pcs.set(chave(c.pt), `PT${i + 1}`);
        if (c.meio) pcs.set(chave(c.meio), `MC${i + 1}`);
      });
      // quem usa cada vértice
      const usos = new Map<string, { p: Pt; lotes: Set<number> }>();
      for (const l of q.lotes) for (const v of l.pol.ext) {
        const k = chave(v);
        if (intermed.has(k)) continue;
        const u = usos.get(k) ?? { p: v, lotes: new Set<number>() };
        u.lotes.add(l.numero);
        usos.set(k, u);
      }
      // ordem: primeiro o contorno da quadra (horário a partir do noroeste), depois os internos
      const borda = q.pol.ext;
      const bb = caixa(borda);
      const no: Pt = [bb.min[0], bb.max[1]];
      const anelH = [...borda].reverse();
      let ini = 0, dm = Infinity;
      anelH.forEach((v, i) => { const d = dist(v, no); if (d < dm) { dm = d; ini = i; } });
      const ordem: Pt[] = [...anelH.slice(ini), ...anelH.slice(0, ini)];
      // vértices de lote que caem SOBRE o contorno, na ordem do caminho
      const naBorda: { p: Pt; s: number }[] = [];
      let acum = 0;
      const internos: Pt[] = [];
      const vistos = new Set<string>();
      for (const [k, u] of usos) {
        let melhorS = -1, dm2 = 0.02;
        acum = 0;
        for (let i = 0; i < ordem.length; i++) {
          const a = ordem[i], b = ordem[(i + 1) % ordem.length];
          const l = dist(a, b);
          const dd = distPontoSeg(u.p, a, b);
          if (dd.d < dm2) { dm2 = dd.d; melhorS = acum + dd.t * l; }
          acum += l;
        }
        if (melhorS >= 0) naBorda.push({ p: u.p, s: melhorS });
        else internos.push(u.p);
        vistos.add(k);
      }
      naBorda.sort((a, b) => a.s - b.s);
      const meioFundo = q.fundo ? [(q.fundo.a[0] + q.fundo.b[0]) / 2, (q.fundo.a[1] + q.fundo.b[1]) / 2] as Pt : q.centro;
      internos.sort((a, b) => dot(sub(a, meioFundo), q.u) - dot(sub(b, meioFundo), q.u));
      let n = 0;
      for (const { p } of [...naBorda, ...internos.map((p) => ({ p }))]) {
        const k = chave(p);
        const pc = pcs.get(k);
        const ehCurva = !!pc;
        if (ehCurva ? !op.curvas : !op.lotes) continue;
        n++;
        const lotes = [...(usos.get(k)?.lotes ?? [])].sort((a, b) => a - b);
        const cod = `Q${q.nome} ${pc ? `${pc} ` : ""}${lotes.length ? `L${lotes.map((x) => String(x).padStart(2, "0")).join("/")}` : ""}`;
        add(p, `${q.nome}-${String(n).padStart(2, "0")}`, cod, ehCurva ? "curva" : "lote", q.nome);
      }
    }
  }

  if (op.eixos) {
    for (const [ri, r] of res.ruas.entries()) {
      // só o trecho do eixo dentro da gleba
      const nomeRua = `R${String(ri + 1).padStart(2, "0")}`;
      let s = 0, est = 0;
      const total = r.eixo.reduce((acc, _, i) => (i ? acc + dist(r.eixo[i - 1], r.eixo[i]) : 0), 0);
      for (let d = 0; d <= total + 1e-6; d += op.estaca) {
        const p = pontoNaLinha(r.eixo, d);
        if (dentroGleba(p, res)) {
          add(p, `${nomeRua}-E${String(est).padStart(2, "0")}`, `EIXO ${r.nome} EST ${est}`, "eixo");
        }
        est++;
        s = d;
      }
      void s;
      // vértices do eixo (dobras) também
      r.eixo.slice(1, -1).forEach((p, i) => { if (dentroGleba(p, res)) add(p, `${nomeRua}-V${i + 1}`, `EIXO ${r.nome} DOBRA`, "eixo"); });
    }
  }

  if (op.perimetro) {
    perimetro.pts.forEach((q, i) => {
      const p: Pt = [(q[0] - res.plano.centro[0]) / res.plano.k, (q[1] - res.plano.centro[1]) / res.plano.k];
      out.push({
        nome: limparNome(perimetro.nomes?.[i] ?? `P${i + 1}`), e: q[0], n: q[1], h: perimetro.altitudes[i] || 0,
        codigo: "PERIMETRO", p, tipo: "perimetro",
      });
    });
  }
  return out;
}

function distPontoSeg(p: Pt, a: Pt, b: Pt): { d: number; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return { d: dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]), t };
}

function pontoNaLinha(l: Pt[], s: number): Pt {
  let acc = 0;
  for (let i = 0; i + 1 < l.length; i++) {
    const d = dist(l[i], l[i + 1]);
    if (acc + d >= s - 1e-9) {
      const t = d < 1e-9 ? 0 : (s - acc) / d;
      return [l[i][0] + (l[i + 1][0] - l[i][0]) * t, l[i][1] + (l[i + 1][1] - l[i][1]) * t];
    }
    acc += d;
  }
  return l[l.length - 1];
}

function dentroGleba(p: Pt, res: Resultado): boolean {
  const a = res.gleba.ext;
  let dentro = false;
  for (let i = 0, j = a.length - 1; i < a.length; j = i++) {
    if ((a[i][1] > p[1]) !== (a[j][1] > p[1]) && p[0] < ((a[j][0] - a[i][0]) * (p[1] - a[i][1])) / (a[j][1] - a[i][1]) + a[i][0]) dentro = !dentro;
  }
  return dentro;
}

/** Mapa vértice (plano) → nome do ponto de locação, para planta e memorial usarem o mesmo nome. */
export function nomesDosPontos(pontos: PontoLocacao[]): Map<string, string> {
  return new Map(pontos.filter((p) => p.tipo === "lote" || p.tipo === "curva").map((p) => [chave(p.p), p.nome]));
}
export const chavePonto = chave;

// ---------------------------------------------------------------------------
// Formatos de coletora
// ---------------------------------------------------------------------------

export type FormatoLocacao = "csv-nome-e-n" | "csv-nome-n-e" | "penzd" | "pnezd" | "chines" | "dxf";

export const FORMATOS: { id: FormatoLocacao; nome: string; serve: string; ext: string }[] = [
  { id: "csv-nome-e-n", nome: "CSV universal (Name, Easting, Northing, Elevation, Code)", serve: "Emlid Flow, Trimble Access, CHC LandStar, SurvCE e a maioria", ext: "csv" },
  { id: "csv-nome-n-e", nome: "CSV com Norte antes de Este (Name, Northing, Easting, Elevation, Code)", serve: "Stonex Cube-a, Trimble (variante N-E)", ext: "csv" },
  { id: "chines", nome: "CSV Name, Code, N, E, Z", serve: "Hi-Target, South, Comnav, Tersus e afins", ext: "csv" },
  { id: "penzd", nome: "TXT sem cabeçalho P,E,N,Z,D", serve: "importação genérica PENZD", ext: "txt" },
  { id: "pnezd", nome: "TXT sem cabeçalho P,N,E,Z,D", serve: "Civil 3D, Topcon Magnet, Carlson", ext: "txt" },
  { id: "dxf", nome: "DXF de linhas (lotes, quadras e eixos)", serve: "locação de linhas na coletora (stakeout line)", ext: "dxf" },
];

const n3 = (v: number) => v.toFixed(3);

export function arquivoLocacao(pontos: PontoLocacao[], formato: Exclude<FormatoLocacao, "dxf">): string {
  const linhas: string[] = [];
  if (formato === "csv-nome-e-n") linhas.push("Name,Easting,Northing,Elevation,Code");
  if (formato === "csv-nome-n-e") linhas.push("Name,Northing,Easting,Elevation,Code");
  if (formato === "chines") linhas.push("Name,Code,N,E,Z");
  for (const p of pontos) {
    const z = n3(p.h);
    switch (formato) {
      case "csv-nome-e-n": linhas.push(`${p.nome},${n3(p.e)},${n3(p.n)},${z},${p.codigo}`); break;
      case "csv-nome-n-e": linhas.push(`${p.nome},${n3(p.n)},${n3(p.e)},${z},${p.codigo}`); break;
      case "chines": linhas.push(`${p.nome},${p.codigo},${n3(p.n)},${n3(p.e)},${z}`); break;
      case "penzd": linhas.push(`${p.nome},${n3(p.e)},${n3(p.n)},${z},${p.codigo}`); break;
      case "pnezd": linhas.push(`${p.nome},${n3(p.n)},${n3(p.e)},${z},${p.codigo}`); break;
    }
  }
  return linhas.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// DXF (R12 ASCII — abre em qualquer CAD, no QGIS e na maioria das coletoras)
// ---------------------------------------------------------------------------

const CAMADAS: [string, number][] = [
  ["PERIMETRO", 7], ["RUA_EIXO", 1], ["RUA_ALINHAMENTO", 8], ["QUADRA", 5], ["LOTE", 7], ["AREA_VERDE", 3],
  ["AREA_INSTITUCIONAL", 30], ["AREA_LAZER", 4], ["APP", 4], ["TEXTO_LOTE", 2], ["TEXTO_QUADRA", 5], ["TEXTO_RUA", 1],
  ["COTA", 9], ["PONTO_LOCACAO", 6], ["NOME_PONTO", 6],
];

export function gerarDxf(res: Resultado, pontos: PontoLocacao[], op: { textos: boolean } = { textos: true }): string {
  const U = (p: Pt) => paraUtm(res.plano, p);
  const o: string[] = [];
  const g = (c: number, v: string | number) => { o.push(String(c), typeof v === "number" ? v.toFixed(4) : v); };
  const bb = caixa(res.gleba.ext.map(U));
  g(0, "SECTION"); g(2, "HEADER");
  g(9, "$ACADVER"); g(1, "AC1009");
  g(9, "$EXTMIN"); g(10, bb.min[0]); g(20, bb.min[1]);
  g(9, "$EXTMAX"); g(10, bb.max[0]); g(20, bb.max[1]);
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "TABLES");
  g(0, "TABLE"); g(2, "LTYPE"); g(70, "1");
  g(0, "LTYPE"); g(2, "CONTINUOUS"); g(70, "0"); g(3, "Solid line"); g(72, "65"); g(73, "0"); g(40, 0);
  g(0, "ENDTAB");
  g(0, "TABLE"); g(2, "LAYER"); g(70, String(CAMADAS.length));
  for (const [nome, cor] of CAMADAS) { g(0, "LAYER"); g(2, nome); g(70, "0"); g(62, String(cor)); g(6, "CONTINUOUS"); }
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION"); g(2, "ENTITIES");
  const poli = (pts: Pt[], camada: string, fechada: boolean) => {
    if (pts.length < 2) return;
    g(0, "POLYLINE"); g(8, camada); g(66, "1"); g(70, fechada ? "1" : "0"); g(10, 0); g(20, 0); g(30, 0);
    for (const p of pts) { const u = U(p); g(0, "VERTEX"); g(8, camada); g(10, u[0]); g(20, u[1]); g(30, 0); }
    g(0, "SEQEND"); g(8, camada);
  };
  const texto = (p: Pt, t: string, alt: number, camada: string, rot = 0) => {
    const u = U(p);
    g(0, "TEXT"); g(8, camada); g(10, u[0]); g(20, u[1]); g(30, 0); g(40, alt); g(1, t.normalize("NFD").replace(/[̀-ͯ]/g, ""));
    if (rot) g(50, rot);
    g(72, "1"); g(73, "2"); g(11, u[0]); g(21, u[1]); g(31, 0);
  };
  const anel = (pol: Poligono, camada: string) => { poli(pol.ext, camada, true); for (const f of pol.furos) poli(f, camada, true); };

  anel(res.gleba, "PERIMETRO");
  for (const v of viarioDe(res)) anel(v, "RUA_ALINHAMENTO");
  for (const r of res.ruas) poli(r.eixo, "RUA_EIXO", false);
  for (const q of res.quadras) anel(q.pol, "QUADRA");
  for (const l of res.lotes) anel(l.pol, "LOTE");
  const camadaArea: Record<string, string> = { verde: "AREA_VERDE", institucional: "AREA_INSTITUCIONAL", lazer: "AREA_LAZER", app: "APP" };
  for (const a of res.publicas) anel(a.pol, camadaArea[a.tipo]);
  for (const p of pontos) {
    const u = U(p.p);
    g(0, "POINT"); g(8, "PONTO_LOCACAO"); g(10, u[0]); g(20, u[1]); g(30, 0);
    if (op.textos) texto([p.p[0] + 0.6, p.p[1] + 0.6], p.nome, 0.6, "NOME_PONTO");
  }
  if (op.textos) {
    for (const l of res.lotes) {
      const c = centroide(l.pol.ext);
      texto(c, String(l.numero).padStart(2, "0"), 1.6, "TEXTO_LOTE");
      texto([c[0], c[1] - 2.2], `${fmt(l.area)} m2`, 0.9, "TEXTO_LOTE");
      for (const lado of l.lados) {
        if (lado.comp < 1) continue;
        const m: Pt = [(lado.a[0] + lado.b[0]) / 2, (lado.a[1] + lado.b[1]) / 2];
        const d = unit(sub(lado.b, lado.a));
        const dentro = esquerda(d);
        let ang = (Math.atan2(d[1], d[0]) * 180) / Math.PI;
        if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
        texto([m[0] + dentro[0] * 0.8, m[1] + dentro[1] * 0.8], fmt(lado.comp), 0.7, "COTA", ang);
      }
    }
    for (const q of res.quadras) texto(q.centro, `QUADRA ${q.nome}`, 4, "TEXTO_QUADRA");
    for (const r of res.ruas) {
      let mi = 0, ml = 0;
      for (let i = 0; i + 1 < r.eixo.length; i++) { const d = dist(r.eixo[i], r.eixo[i + 1]); if (d > ml) { ml = d; mi = i; } }
      const a = r.eixo[mi], b = r.eixo[mi + 1];
      let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180; if (ang <= -90) ang += 180;
      texto([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], `${r.nome.toUpperCase()} (${fmt(r.largura, 2)} m)`, 2.2, "TEXTO_RUA", ang);
    }
    for (const a of res.publicas) texto(centroide(a.pol.ext), `${a.nome} - ${fmt(a.area)} m2`, 2.5, camadaArea[a.tipo]);
  }
  g(0, "ENDSEC"); g(0, "EOF");
  return o.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// KML (Google Earth)
// ---------------------------------------------------------------------------

export function gerarKml(res: Resultado, fuso: number, nome: string): string {
  const ud = utmDef(fuso);
  const ll = (p: Pt) => { const [lon, lat] = proj(ud, GEO_DEF, paraUtm(res.plano, p)); return `${lon.toFixed(8)},${lat.toFixed(8)},0`; };
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const anel = (a: Anel) => [...a, a[0]].map(ll).join(" ");
  const pol = (p: Poligono) => `<Polygon><outerBoundaryIs><LinearRing><coordinates>${anel(p.ext)}</coordinates></LinearRing></outerBoundaryIs>${p.furos.map((f) => `<innerBoundaryIs><LinearRing><coordinates>${anel(f)}</coordinates></LinearRing></innerBoundaryIs>`).join("")}</Polygon>`;
  const estilo = (id: string, linha: string, fundo: string) => `<Style id="${id}"><LineStyle><color>${linha}</color><width>1.5</width></LineStyle><PolyStyle><color>${fundo}</color></PolyStyle></Style>`;
  const partes: string[] = [];
  partes.push(`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(nome)}</name>`);
  partes.push(estilo("lote", "ff2b2b2b", "66f5f0e1"), estilo("esquina", "ff2b2b2b", "66c8e6f5"), estilo("verde", "ff2e7d32", "8858c472"),
    estilo("institucional", "ff0060c0", "8866b8ef"), estilo("app", "ffc07000", "88e0b070"), estilo("lazer", "ffc0a000", "88f0d080"),
    estilo("perimetro", "ff0000ff", "00000000"), `<Style id="eixo"><LineStyle><color>ff2020d0</color><width>2</width></LineStyle></Style>`);
  partes.push(`<Placemark><name>Perímetro da gleba</name><styleUrl>#perimetro</styleUrl>${pol(res.gleba)}</Placemark>`);
  for (const q of res.quadras) {
    partes.push(`<Folder><name>Quadra ${esc(q.nome)} (${q.lotes.length} lotes)</name>`);
    for (const l of q.lotes) {
      partes.push(`<Placemark><name>${esc(l.id)}</name><description>${esc(`Lote ${l.numero} da Quadra ${l.quadra} — ${fmt(l.area)} m², frente ${fmt(l.frente)} m para ${l.rua}`)}</description><styleUrl>#${l.esquina ? "esquina" : "lote"}</styleUrl>${pol(l.pol)}</Placemark>`);
    }
    partes.push("</Folder>");
  }
  partes.push("<Folder><name>Áreas públicas</name>");
  for (const a of res.publicas) partes.push(`<Placemark><name>${esc(a.nome)}</name><description>${fmt(a.area)} m²</description><styleUrl>#${a.tipo}</styleUrl>${pol(a.pol)}</Placemark>`);
  partes.push("</Folder><Folder><name>Ruas</name>");
  for (const r of res.ruas) partes.push(`<Placemark><name>${esc(r.nome)}</name><description>${fmt(r.largura)} m de largura</description><styleUrl>#eixo</styleUrl><LineString><coordinates>${r.eixo.map(ll).join(" ")}</coordinates></LineString></Placemark>`);
  partes.push("</Folder></Document></kml>");
  return partes.join("\n");
}

// ---------------------------------------------------------------------------
// Medidas nominais do lote: frente, lado direito, fundos, lado esquerdo
// ---------------------------------------------------------------------------

export interface LadosNominais {
  frente: Lado[];
  direito: Lado[];
  fundos: Lado[];
  esquerdo: Lado[];
}

/**
 * Agrupa os lados como o cartório lê: de quem está na rua olhando o lote, a
 * frente, o lado direito, os fundos e o lado esquerdo. A referência é o lado
 * de frente mais longo; cada lado vai para o grupo da direção mais próxima.
 */
export function ladosNominais(l: Lote): LadosNominais {
  const out: LadosNominais = { frente: [], direito: [], fundos: [], esquerdo: [] };
  // a frente escolhida pelo operador é a referência; senão, a rua mais longa
  const principal = l.lados.filter((x) => x.principal);
  const fr = (principal.length ? principal : l.lados.filter((x) => x.tipo === "rua" || x.tipo === "via")).sort((a, b) => b.comp - a.comp)[0] ?? l.lados[0];
  if (!fr) return out;
  // quadrilátero (o caso comum): a ordem do anel decide, mesmo com fundo torto de divisa
  if (l.lados.length === 4) {
    const i = l.lados.indexOf(fr);
    const em = (k: number) => l.lados[(i + k) % 4];
    return { frente: [em(0)], direito: [em(1)], fundos: [em(2)], esquerdo: [em(3)] };
  }
  const u = unit(sub(fr.b, fr.a)), v = esquerda(u);
  for (const x of l.lados) {
    const d = unit(sub(x.b, x.a));
    const cu = dot(d, u), cv = dot(d, v);
    if (Math.abs(cu) >= Math.abs(cv)) (cu > 0 ? out.frente : out.fundos).push(x);
    else (cv > 0 ? out.direito : out.esquerdo).push(x);
  }
  return out;
}

const somaComp = (ls: Lado[]) => ls.reduce((s, x) => s + x.comp, 0);
const confr = (ls: Lado[]) => [...new Set(ls.map((x) => x.nome))].join(" e ");

export function resumoLote(l: Lote): { frente: string; direito: string; fundos: string; esquerdo: string; medidas: [number, number, number, number] } {
  const g = ladosNominais(l);
  const t = (ls: Lado[]) => (ls.length ? `${fmt(somaComp(ls))} m — ${confr(ls)}` : "—");
  return { frente: t(g.frente), direito: t(g.direito), fundos: t(g.fundos), esquerdo: t(g.esquerdo), medidas: [somaComp(g.frente), somaComp(g.direito), somaComp(g.fundos), somaComp(g.esquerdo)] };
}

// ---------------------------------------------------------------------------
// Quadro de lotes (planilha para vendas e cartório)
// ---------------------------------------------------------------------------

export function quadroDeLotesCsv(res: Resultado, pr: Projeto): string {
  const p = pr.params;
  const cab = ["Quadra", "Lote", "Área (m²)", "Frente (m)", "Lado direito (m)", "Fundos (m)", "Lado esquerdo (m)", "Rua", "Esquina", "Confrontações"];
  if (p.precoM2 > 0) cab.push("Preço (R$)");
  const linhas = [cab.join(";")];
  for (const q of res.quadras) for (const l of [...q.lotes].sort((a, b) => a.numero - b.numero)) {
    const r = resumoLote(l);
    const preco = l.area * p.precoM2 * (l.esquina ? 1 + p.acrescimoEsquina / 100 : 1);
    const cel = [q.nome, String(l.numero).padStart(2, "0"), fmt(l.area), fmt(r.medidas[0]), fmt(r.medidas[1]), fmt(r.medidas[2]), fmt(r.medidas[3]),
      l.rua, l.esquina ? "sim" : "não", `Frente: ${r.frente} | Direito: ${r.direito} | Fundos: ${r.fundos} | Esquerdo: ${r.esquerdo}`];
    if (p.precoM2 > 0) cel.push(fmt(preco));
    linhas.push(cel.map((c) => (/[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";"));
  }
  return "﻿" + linhas.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Memorial descritivo do lote (texto)
// ---------------------------------------------------------------------------

export interface DadosMemorialLote {
  loteamento: string;
  municipio: string;
  uf: string;
  proprietario: string;
  fuso: number;
}

/**
 * Parágrafos do memorial de um lote: identificação, medidas nominais e a
 * descrição do perímetro vértice a vértice (coordenadas UTM, azimute de
 * quadrícula e distância de terreno), com os MESMOS nomes de ponto da locação.
 */
export function memorialDoLote(l: Lote, res: Resultado, nomes: Map<string, string>, d: DadosMemorialLote): { titulo: string; paragrafos: string[] } {
  const r = resumoLote(l);
  const nomeV = (p: Pt) => nomes.get(chave(p)) ?? `${l.quadra}-?`;
  const U = (p: Pt) => paraUtm(res.plano, p);
  const coord = (p: Pt) => { const u = U(p); return `E ${fmt(u[0], 3)} m e N ${fmt(u[1], 3)} m`; };
  // começa no 1º vértice do lado de frente principal
  const fr = ladosNominais(l).frente.sort((a, b) => b.comp - a.comp)[0] ?? l.lados[0];
  const i0 = Math.max(0, l.lados.indexOf(fr));
  const seq = [...l.lados.slice(i0), ...l.lados.slice(0, i0)];
  const trechos = seq.map((x) => {
    const az = (Math.atan2(x.b[0] - x.a[0], x.b[1] - x.a[1]) * 180) / Math.PI;
    // frente escolhida pelo operador (servidão, área verde, lote): confronta com quem está do outro lado
    const conf = (x.tipo === "rua" || x.tipo === "via") && !x.semRua ? `confrontando com a ${x.nome}` : `confrontando com ${x.nome}`;
    return `deste segue ${conf}, com azimute de ${fmtAzimute((az + 360) % 360)} e distância de ${fmt(x.comp)} m, até o vértice ${nomeV(x.b)}, de coordenadas ${coord(x.b)}`;
  });
  const perim = l.lados.reduce((s, x) => s + x.comp, 0);
  const num = String(l.numero).padStart(2, "0");
  return {
    titulo: `LOTE ${num} DA QUADRA ${l.quadra}`,
    paragrafos: [
      `Imóvel: Lote ${num} da Quadra ${l.quadra} do loteamento ${d.loteamento}${d.municipio ? `, município de ${d.municipio}${d.uf ? `/${d.uf}` : ""}` : ""}.`,
      ...(d.proprietario ? [`Proprietário: ${d.proprietario}.`] : []),
      `Área: ${fmt(l.area)} m² · Perímetro: ${fmt(perim)} m${l.esquina ? " · lote de esquina" : ""}.`,
      `Frente: ${r.frente}. Lado direito (de quem da rua olha o imóvel): ${r.direito}. Fundos: ${r.fundos}. Lado esquerdo: ${r.esquerdo}.`,
      `Descrição do perímetro: inicia-se no vértice ${nomeV(seq[0].a)}, de coordenadas ${coord(seq[0].a)}, situado no alinhamento da ${fr.nome}; ${trechos.join("; ")}, ponto inicial da descrição deste perímetro.`,
      `Coordenadas no sistema geodésico SIRGAS 2000, projeção UTM, fuso ${d.fuso}S. Azimutes de quadrícula; distâncias e área ${res.plano.terreno ? "no plano topográfico (medidas de terreno)" : "no plano UTM"}.`,
    ],
  };
}
