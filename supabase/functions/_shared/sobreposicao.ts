// Correção de sobreposição SIGEF: dado o anel do serviço (coordenadas UTM
// publicadas) e os CSVs das parcelas certificadas que o SIGEF apontou como
// sobrepostas, recorta as invasões com afastamento e devolve o anel corrigido.
//
// Algoritmo (validado contra o caso THEREZA com shapely/pyproj):
//  - o critério de aceite é o anel PUBLICADO: vértices novos arredondados ao
//    GMS canônico (0,001") — exatamente o que o SIGEF verá na planilha;
//  - loop: enquanto o anel publicado sobrepõe alguma parcela, subtrai
//    buffer(residuo, afastamento) + faixa de descolamento (10 cm) das divisas
//    de todas as parcelas próximas ao recorte (evita que o arredondamento
//    de ±2,2 cm devolva pontos de junção para dentro do vizinho);
//  - vértices originais medidos nunca são deslocados: ou permanecem exatos
//    ou são removidos (estavam dentro/colados na parcela alheia);
//  - parcela que cobre >50% da nossa área = provável gleba já certificada
//    (retificação/cancelamento no SIGEF) — não é corrigível por afastamento;
//  - simplificação Douglas-Peucker apenas nas corridas de vértices novos,
//    aceitando a maior tolerância que ainda passa no teste publicado.
//
// Toda a geometria roda em inteiros (décimos de milímetro, relativos a uma
// origem local para os produtos caberem na precisão de double) via clipper-lib.
import ClipperLib from "clipper-lib";
import { degToGmsCanonical, gmsToDeg } from "./geo.ts";

const ESCALA = 10000;              // 1 unidade = 0,1 mm
const EPS_M2 = 1e-4;               // 1 cm²: sobreposição residual tolerada no modelo
const MARGEM_JUNCAO_M = 0.10;
const TOL_MATCH_M = 0.01;
const MAX_ITER = 8;

type Pt = { X: number; Y: number };
type Path = Pt[];
type Paths = Path[];

export interface ParcelaSigef {
  nome: string;
  ringUtm: [number, number][];     // anel externo em UTM (E, N), sem fechamento
}

export interface StatusParcela {
  nome: string;
  areaSobrepostaM2: number;
  status: "corrigida" | "mesma_gleba" | "interna" | "sem_sobreposicao";
}

export interface PontoCorrigido {
  origIdx: number | null;          // índice no anel de entrada (null = vértice novo)
  e: number;                       // UTM publicado (novos: já canônicos)
  n: number;
}

export interface ResultadoCorrecao {
  parcelas: StatusParcela[];
  avisos: string[];
  precisaCorrigir: boolean;
  anel: PontoCorrigido[];          // = entrada quando precisaCorrigir === false
  areaAntesM2: number;
  areaDepoisM2: number;
}

// ---------------------------------------------------------------------------
// Parse do CSV de exportação do SIGEF
// ---------------------------------------------------------------------------

// Cabeçalho esperado: QRCODE;CODIGO;METODO_...;...;LADO;INDICE;X;Y;Z;GEOMETRIA_WKT;
export function parseCsvSigef(nome: string, conteudo: string): { nome: string; pontos: [number, number][] } {
  const linhas = conteudo.replace(/^﻿/, "").split(/\r?\n/);
  const header = linhas[0]?.toUpperCase() ?? "";
  if (!header.includes("GEOMETRIA_WKT") || !header.includes("INDICE")) {
    throw new Error(`${nome}: não parece um CSV de exportação do SIGEF (cabeçalho sem GEOMETRIA_WKT/INDICE)`);
  }
  const cols = header.split(";");
  const iLado = cols.indexOf("LADO");
  const iIdx = cols.indexOf("INDICE");
  const iWkt = cols.indexOf("GEOMETRIA_WKT");
  const pts: { idx: number; lon: number; lat: number }[] = [];
  for (const linha of linhas.slice(1)) {
    if (!linha.trim()) continue;
    const partes = linha.split(";");
    if (partes.length <= iWkt) continue;
    if (iLado >= 0 && partes[iLado].trim().toUpperCase() !== "EXTERNO") continue;
    const m = partes[iWkt].match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
    if (!m) continue;
    pts.push({ idx: parseInt(partes[iIdx], 10) || 0, lon: parseFloat(m[1]), lat: parseFloat(m[2]) });
  }
  if (pts.length < 3) throw new Error(`${nome}: menos de 3 vértices EXTERNO no CSV`);
  pts.sort((a, b) => a.idx - b.idx);
  return { nome, pontos: pts.map((p) => [p.lon, p.lat]) };
}

// ---------------------------------------------------------------------------
// Utilidades clipper
// ---------------------------------------------------------------------------

interface Origem { e0: number; n0: number }

function toPath(ring: [number, number][], org: Origem): Path {
  return ring.map(([e, n]) => ({ X: Math.round((e - org.e0) * ESCALA), Y: Math.round((n - org.n0) * ESCALA) }));
}

function areaAbsM2(paths: Paths): number {
  let a = 0;
  for (const p of paths) a += Math.abs(ClipperLib.Clipper.Area(p));
  return a / (ESCALA * ESCALA);
}

function boolOp(op: number, subj: Paths, clip: Paths): Paths {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const sol: Paths = [];
  c.Execute(op, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return sol;
}
const intersecao = (s: Paths, c: Paths) => boolOp(ClipperLib.ClipType.ctIntersection, s, c);
const diferenca = (s: Paths, c: Paths) => boolOp(ClipperLib.ClipType.ctDifference, s, c);
const uniao = (s: Paths) => boolOp(ClipperLib.ClipType.ctUnion, s, []);

function offset(paths: Paths, deltaM: number): Paths {
  const co = new ClipperLib.ClipperOffset(3, 0.25 * ESCALA);
  co.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const sol: Paths = [];
  co.Execute(sol, deltaM * ESCALA);
  return sol;
}

// maior componente externa; furos e partes menores são descartados
function maiorParte(paths: Paths): { anel: Path; descartadaM2: number } {
  let melhor: Path | null = null;
  let melhorArea = -1;
  let total = 0;
  for (const p of paths) {
    const a = ClipperLib.Clipper.Area(p);
    if (a <= 0) continue; // furo
    total += a;
    if (a > melhorArea) { melhorArea = a; melhor = p; }
  }
  if (!melhor) throw new Error("correção removeu todo o perímetro — verifique as parcelas enviadas");
  return { anel: melhor, descartadaM2: (total - melhorArea) / (ESCALA * ESCALA) };
}

// ---------------------------------------------------------------------------
// Correção
// ---------------------------------------------------------------------------

export interface ProjecaoLocal {
  utmParaGeo: (e: number, n: number) => [number, number]; // → [lonDeg, latDeg]
  geoParaUtm: (lon: number, lat: number) => [number, number];
}

export function corrigirSobreposicao(
  ringUtm: [number, number][],           // anel publicado do serviço, em ordem de perímetro
  parcelas: ParcelaSigef[],
  afastamentoM: number,
  proj: ProjecaoLocal,
): ResultadoCorrecao {
  if (ringUtm.length < 3) throw new Error("serviço com menos de 3 vértices");
  if (!(afastamentoM >= 0.05 && afastamentoM <= 10)) throw new Error("afastamento deve estar entre 0,05 m e 10 m");

  const org: Origem = {
    e0: Math.floor(Math.min(...ringUtm.map((p) => p[0]))),
    n0: Math.floor(Math.min(...ringUtm.map((p) => p[1]))),
  };
  const nosso: Paths = [toPath(ringUtm, org)];
  const orientOrig = ClipperLib.Clipper.Orientation(nosso[0]);
  const areaAntesM2 = areaAbsM2(nosso);

  // arredondamento canônico (0,001") de um ponto novo — o que a planilha publicará
  function canonico(p: Pt): Pt {
    const [lon, lat] = proj.utmParaGeo(p.X / ESCALA + org.e0, p.Y / ESCALA + org.n0);
    const lonC = gmsToDeg(degToGmsCanonical(lon));
    const latC = gmsToDeg(degToGmsCanonical(lat));
    const [e, n] = proj.geoParaUtm(lonC, latC);
    return { X: Math.round((e - org.e0) * ESCALA), Y: Math.round((n - org.n0) * ESCALA) };
  }

  // classifica as parcelas
  const status: StatusParcela[] = [];
  const avisos: string[] = [];
  const subtrair: { nome: string; path: Paths }[] = [];
  for (const par of parcelas) {
    const path: Paths = [toPath(par.ringUtm, org)];
    if (!ClipperLib.Clipper.Orientation(path[0])) path[0] = path[0].slice().reverse();
    const inter = areaAbsM2(intersecao(nosso, path));
    const ratio = inter / areaAntesM2;
    if (ratio > 0.5) {
      status.push({ nome: par.nome, areaSobrepostaM2: inter, status: "mesma_gleba" });
      avisos.push(
        `${par.nome}: sobrepõe ${(ratio * 100).toFixed(1)}% da área do serviço — provavelmente é a própria gleba já certificada. ` +
        `Afastamento não resolve: é preciso retificar/cancelar a parcela antiga no SIGEF. Parcela IGNORADA na correção.`,
      );
    } else if (areaAbsM2(diferenca(path, nosso)) < 1e-4) {
      status.push({ nome: par.nome, areaSobrepostaM2: inter, status: "interna" });
      avisos.push(`${par.nome}: parcela totalmente interna ao serviço — exigiria anel interno (Lado Interno); parcela IGNORADA na correção.`);
    } else if (inter < 1e-4) {
      status.push({ nome: par.nome, areaSobrepostaM2: 0, status: "sem_sobreposicao" });
    } else {
      status.push({ nome: par.nome, areaSobrepostaM2: inter, status: "corrigida" });
      subtrair.push({ nome: par.nome, path });
    }
  }

  if (subtrair.length === 0) {
    return {
      parcelas: status, avisos, precisaCorrigir: false,
      anel: ringUtm.map(([e, n], i) => ({ origIdx: i, e, n })),
      areaAntesM2, areaDepoisM2: areaAntesM2,
    };
  }

  // reconstrução: casa pontos do anel com os vértices originais (tol 1 cm)
  const tolMm = TOL_MATCH_M * ESCALA;
  function reconstruir(anelPath: Path): PontoCorrigido[] {
    let pts = anelPath;
    if (ClipperLib.Clipper.Orientation(pts) !== orientOrig) pts = pts.slice().reverse();
    const out: PontoCorrigido[] = pts.map((p) => {
      let orig: number | null = null;
      for (let i = 0; i < nosso[0].length; i++) {
        const q = nosso[0][i];
        if (Math.abs(p.X - q.X) <= tolMm && Math.abs(p.Y - q.Y) <= tolMm &&
            Math.hypot(p.X - q.X, p.Y - q.Y) <= tolMm) {
          orig = i;
          break;
        }
      }
      return { origIdx: orig, e: p.X / ESCALA + org.e0, n: p.Y / ESCALA + org.n0 };
    });
    // rotaciona para começar no vértice original mantido de menor índice
    let k0 = -1, menor = Infinity;
    out.forEach((p, k) => {
      if (p.origIdx !== null && p.origIdx < menor) { menor = p.origIdx; k0 = k; }
    });
    return k0 > 0 ? [...out.slice(k0), ...out.slice(0, k0)] : out;
  }

  function pathPublicado(anel: PontoCorrigido[]): Path {
    return anel.map((p) => {
      const pt = { X: Math.round((p.e - org.e0) * ESCALA), Y: Math.round((p.n - org.n0) * ESCALA) };
      return p.origIdx !== null ? pt : canonico(pt);
    });
  }

  function residuoPublicado(anel: PontoCorrigido[]): number {
    const pub = pathPublicado(anel);
    let pior = 0;
    for (const s of subtrair) {
      pior = Math.max(pior, areaAbsM2(intersecao([pub], s.path)));
    }
    return pior;
  }

  const epsM2 = EPS_M2;

  // loop principal dirigido pelo anel publicado
  let corrigido: Paths = nosso;
  let anel: PontoCorrigido[] = [];
  let convergiu = false;
  for (let it = 0; it < MAX_ITER; it++) {
    const { anel: maior, descartadaM2 } = maiorParte(uniao(corrigido));
    if (descartadaM2 > 0.01 && !avisos.some((a) => a.startsWith("correção dividiu"))) {
      avisos.push(`correção dividiu o perímetro; mantida a maior parte (descartados ${descartadaM2.toFixed(1)} m²)`);
    }
    corrigido = [maior];
    anel = reconstruir(maior);
    const pub = pathPublicado(anel);
    let pior = 0;
    const partes: Paths = [];
    for (const s of subtrair) {
      const resid = intersecao([pub], s.path);
      const aResid = areaAbsM2(resid);
      pior = Math.max(pior, aResid);
      if (aResid <= epsM2) continue;
      for (const p of offset(resid, afastamentoM)) partes.push(p);
      const zona = offset(resid, afastamentoM + 0.5);
      for (const q of subtrair) {
        // faixa de descolamento: anel de ±10 cm em torno da divisa de q, limitado à zona
        const anelDivisa = diferenca(offset(q.path, MARGEM_JUNCAO_M), offset(q.path, -MARGEM_JUNCAO_M));
        for (const f of intersecao(anelDivisa, zona)) partes.push(f);
      }
    }
    if (pior <= epsM2) { convergiu = true; break; }
    corrigido = diferenca(corrigido, uniao(partes));
    if (corrigido.length === 0) throw new Error("correção removeu todo o perímetro — verifique as parcelas enviadas");
  }
  if (!convergiu) {
    throw new Error(`não convergiu em ${MAX_ITER} iterações — tente um afastamento maior`);
  }

  // simplificação DP apenas nas corridas de vértices novos
  function dp(pts: Pt[], tolMmDp: number): Pt[] {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const L = Math.hypot(b.X - a.X, b.Y - a.Y);
    let dmax = -1, imax = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const d = L > 0
        ? Math.abs((b.X - a.X) * (a.Y - p.Y) - (a.X - p.X) * (b.Y - a.Y)) / L
        : Math.hypot(p.X - a.X, p.Y - a.Y);
      if (d > dmax) { dmax = d; imax = i; }
    }
    if (dmax <= tolMmDp) return [a, b];
    return [...dp(pts.slice(0, imax + 1), tolMmDp).slice(0, -1), ...dp(pts.slice(imax), tolMmDp)];
  }

  function simplificar(base: PontoCorrigido[], tolM: number): PontoCorrigido[] {
    const n = base.length;
    const keeps = base.map((p, k) => (p.origIdx !== null ? k : -1)).filter((k) => k >= 0);
    if (keeps.length === 0) return base;
    const out: PontoCorrigido[] = [];
    for (let ki = 0; ki < keeps.length; ki++) {
      const i0 = keeps[ki], i1 = keeps[(ki + 1) % keeps.length];
      const seg: number[] = [i0];
      for (let j = i0; j !== i1;) { j = (j + 1) % n; seg.push(j); }
      const pts = seg.map((j) => ({ X: Math.round((base[j].e - org.e0) * ESCALA), Y: Math.round((base[j].n - org.n0) * ESCALA) }));
      const sobra = new Set(dp(pts, tolM * ESCALA).slice(1, -1).map((p) => `${p.X},${p.Y}`));
      out.push(base[i0]);
      for (let s = 1; s < seg.length - 1; s++) {
        const p = pts[s];
        if (sobra.has(`${p.X},${p.Y}`)) out.push(base[seg[s]]);
      }
    }
    return out;
  }

  for (const tolM of [0.45, 0.30, 0.15]) {
    const cand = simplificar(anel, tolM);
    if (cand.length < anel.length && residuoPublicado(cand) <= epsM2) {
      anel = cand;
      break;
    }
  }

  // coordenadas finais publicadas dos vértices novos
  const final: PontoCorrigido[] = anel.map((p) => {
    if (p.origIdx !== null) return p;
    const c = canonico({ X: Math.round((p.e - org.e0) * ESCALA), Y: Math.round((p.n - org.n0) * ESCALA) });
    return { origIdx: null, e: c.X / ESCALA + org.e0, n: c.Y / ESCALA + org.n0 };
  });

  return {
    parcelas: status, avisos, precisaCorrigir: true, anel: final,
    areaAntesM2, areaDepoisM2: areaAbsM2([pathPublicado(final)]),
  };
}
