// Correção de sobreposição SIGEF: dado o anel do serviço (coordenadas UTM
// publicadas) e os CSVs das parcelas certificadas que o SIGEF apontou como
// sobrepostas, recorta as invasões e devolve o anel corrigido.
//
// Dois modos, escolhidos pelo operador (ver PLANO-VERTICES-CERTIFICADOS.md):
//
//  A) vértices certificados (padrão): a divisa com o vizinho passa a ser descrita
//     pelos PRÓPRIOS vértices dele — mesmo código e mesmas coordenadas do CSV.
//     - igualar: vértice nosso a menos de `toleranciaIgualarM` de um vértice
//       certificado vira aquele vértice (a linha nossa continua: confrontação,
//       nº TXT; mudam código e coordenadas);
//     - encaixar: vértice certificado a menos da tolerância de um lado nosso
//       entra no anel naquele lado;
//     - recorte exato (sem afastamento): os vértices do vizinho que ficam dentro
//       do nosso polígono entram no anel como compartilhados;
//     - transição (cruzamento de lados) ao lado de um compartilhado é descartada
//       quando o triângulo que some fica dentro do nosso polígono e fora de todas
//       as parcelas — o anel vai direto ao vértice certificado;
//     - o que ainda sobrepuser depois disso cai no modo B, só naquele trecho.
//
//  B) afastamento (comportamento original, validado contra o caso THEREZA com
//     shapely/pyproj):
//     - o critério de aceite é o anel PUBLICADO: vértices novos arredondados ao
//       GMS canônico (0,001") — exatamente o que o SIGEF verá na planilha;
//     - loop: enquanto o anel publicado sobrepõe alguma parcela, subtrai
//       buffer(residuo, afastamento) + faixa de descolamento (10 cm) das divisas
//       de todas as parcelas próximas ao recorte (evita que o arredondamento
//       de ±2,2 cm devolva pontos de junção para dentro do vizinho);
//     - vértices originais medidos nunca são deslocados: ou permanecem exatos
//       ou são removidos (estavam dentro/colados na parcela alheia);
//     - parcela que cobre >50% da nossa área = provável gleba já certificada
//       (retificação/cancelamento no SIGEF) — não é corrigível por afastamento;
//     - simplificação Douglas-Peucker apenas nas corridas de vértices novos,
//       aceitando a maior tolerância que ainda passa no teste publicado.
//
// Toda a geometria roda em inteiros (décimos de milímetro, relativos a uma
// origem local para os produtos caberem na precisão de double) via clipper-lib.
import ClipperLib from "clipper-lib";
import { degToGmsCanonical, fmtGmsPlanilha, gmsToDeg, parseGmsPlanilha } from "./geo.ts";

const ESCALA = 10000;              // 1 unidade = 0,1 mm
const EPS_M2 = 1e-4;               // 1 cm²: sobreposição residual tolerada no modelo
const MARGEM_JUNCAO_M = 0.10;
const TOL_MATCH_M = 0.01;
const MAX_ITER = 8;
// Transição (cruzamento do nosso lado com a divisa alheia) recua esta distância
// ao longo do nosso lado, para o arredondamento de 0,001" (±2,2 cm) não a jogar
// para dentro do vizinho.
const MARGEM_TRANSICAO_M = 0.05;
// Uma transição só é descartada se o triângulo que some for desprezível...
const EPS_TRIANGULO_DESCARTE_M2 = 0.5;
// ...e ficar dentro do nosso polígono: 10 cm² fora é ruído, não terra alheia.
const EPS_TRIANGULO_M2 = 1e-3;

type Pt = { X: number; Y: number };
type Path = Pt[];
type Paths = Path[];

/** Um vértice do CSV de exportação do SIGEF, com tudo o que a planilha precisa. */
export interface VerticeSigef {
  codigo: string;
  tipo: "M" | "P" | "V";
  metodo: string;
  sigmaX: number;
  sigmaY: number;
  sigmaZ: number;
  h: number;
  /** Coordenadas GMS como o SIGEF as publica (colunas X/Y): "12 10 30,687 S". */
  latGms: string;
  lonGms: string;
  /** Graus decimais do WKT (o mesmo valor, em outra forma). */
  lon: number;
  lat: number;
}

export interface ParcelaSigef {
  nome: string;
  ringUtm: [number, number][];     // anel externo em UTM (E, N), sem fechamento
  /** Alinhado a `ringUtm` por índice. Ausente = só a geometria (modo afastamento). */
  vertices?: VerticeSigef[];
}

export interface StatusParcela {
  nome: string;
  areaSobrepostaM2: number;
  status: "corrigida" | "mesma_gleba" | "interna" | "sem_sobreposicao";
}

export interface RefCertificado {
  parcela: number;                 // índice em `parcelas`
  idx: number;                     // índice em `parcelas[parcela].vertices`
}

export interface PontoCorrigido {
  origIdx: number | null;          // índice no anel de entrada (null = vértice novo)
  e: number;                       // UTM publicado (novos: já canônicos)
  n: number;
  /**
   * Vértice de parcela certificada: publica-se com o código e as coordenadas
   * dele. Com `origIdx` ≠ null é um vértice NOSSO igualado ao dele.
   */
  certificado?: RefCertificado;
}

export interface ResultadoCorrecao {
  parcelas: StatusParcela[];
  avisos: string[];
  precisaCorrigir: boolean;
  anel: PontoCorrigido[];          // = entrada quando precisaCorrigir === false
  areaAntesM2: number;
  areaDepoisM2: number;
  /** Quantos pontos do anel são vértices certificados do vizinho. */
  compartilhados: number;
  /** Vértices nossos igualados a um certificado (subconjunto de `compartilhados`). */
  igualados: number;
}

export interface OpcoesCorrecao {
  /** Descrever a divisa pelos vértices certificados do vizinho (modo A). */
  usarVerticesCertificados?: boolean;
  /** Distância até a qual um vértice/lado nosso é igualado ao vértice certificado. */
  toleranciaIgualarM?: number;
}

// ---------------------------------------------------------------------------
// Parse do CSV de exportação do SIGEF
// ---------------------------------------------------------------------------

const numBR = (s: string | undefined): number => {
  const v = parseFloat((s ?? "").trim().replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

// Cabeçalho esperado: QRCODE;CODIGO;METODO_...;TIPO_VERTICE;SIGMA_X;SIGMA_Y;SIGMA_Z;LADO;INDICE;X;Y;Z;GEOMETRIA_WKT;
export function parseCsvSigef(
  nome: string,
  conteudo: string,
): { nome: string; pontos: [number, number][]; vertices: VerticeSigef[] } {
  const linhas = conteudo.replace(/^﻿/, "").split(/\r?\n/);
  const header = linhas[0]?.toUpperCase() ?? "";
  if (!header.includes("GEOMETRIA_WKT") || !header.includes("INDICE")) {
    throw new Error(`${nome}: não parece um CSV de exportação do SIGEF (cabeçalho sem GEOMETRIA_WKT/INDICE)`);
  }
  const cols = header.split(";").map((c) => c.trim());
  const col = (n: string) => cols.indexOf(n);
  const iLado = col("LADO"), iIdx = col("INDICE"), iWkt = col("GEOMETRIA_WKT");
  const iCod = col("CODIGO"), iMet = col("METODO_POSICIONAMENTO"), iTipo = col("TIPO_VERTICE");
  const iSx = col("SIGMA_X"), iSy = col("SIGMA_Y"), iSz = col("SIGMA_Z");
  const iX = col("X"), iY = col("Y"), iZ = col("Z");
  const pts: { idx: number; v: VerticeSigef }[] = [];
  for (const linha of linhas.slice(1)) {
    if (!linha.trim()) continue;
    const partes = linha.split(";");
    if (partes.length <= iWkt) continue;
    if (iLado >= 0 && partes[iLado].trim().toUpperCase() !== "EXTERNO") continue;
    const m = partes[iWkt].match(/POINT\s*\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/i);
    if (!m) continue;
    const lon = parseFloat(m[1]), lat = parseFloat(m[2]);
    const codigo = iCod >= 0 ? partes[iCod].trim() : "";
    const letra = (iTipo >= 0 ? partes[iTipo].trim().toUpperCase() : "") || (codigo.match(/-([MPV])-/)?.[1] ?? "P");
    const tipo: "M" | "P" | "V" = letra === "M" || letra === "V" ? letra : "P";
    // GMS das colunas X/Y é o que o SIGEF publica; se faltar, deriva do WKT no
    // formato canônico da planilha (mesmo arredondamento de 0,001").
    const lonGmsCsv = iX >= 0 ? partes[iX].trim() : "";
    const latGmsCsv = iY >= 0 ? partes[iY].trim() : "";
    const lonGms = ehGmsValido(lonGmsCsv) ? lonGmsCsv : gmsCanonicoStr(lon, "lon");
    const latGms = ehGmsValido(latGmsCsv) ? latGmsCsv : gmsCanonicoStr(lat, "lat");
    const sx = numBR(partes[iSx]), sy = numBR(partes[iSy]), sz = numBR(partes[iSz]);
    pts.push({
      idx: parseInt(partes[iIdx], 10) || 0,
      v: {
        codigo, tipo,
        metodo: (iMet >= 0 ? partes[iMet].trim() : "") || "PG2",
        sigmaX: Number.isFinite(sx) ? sx : 0, sigmaY: Number.isFinite(sy) ? sy : 0, sigmaZ: Number.isFinite(sz) ? sz : 0,
        h: Number.isFinite(numBR(partes[iZ])) ? numBR(partes[iZ]) : 0,
        latGms, lonGms, lon, lat,
      },
    });
  }
  if (pts.length < 3) throw new Error(`${nome}: menos de 3 vértices EXTERNO no CSV`);
  pts.sort((a, b) => a.idx - b.idx);
  return { nome, pontos: pts.map((p) => [p.v.lon, p.v.lat]), vertices: pts.map((p) => p.v) };
}

function ehGmsValido(s: string): boolean {
  if (!s) return false;
  try { parseGmsPlanilha(s); return true; } catch { return false; }
}

const gmsCanonicoStr = (deg: number, kind: "lat" | "lon"): string => fmtGmsPlanilha(degToGmsCanonical(deg), kind);

/** Graus decimais do vértice certificado, a partir do GMS publicado (fonte da verdade). */
export function lonLatDoVerticeSigef(v: VerticeSigef): [number, number] {
  try {
    return [gmsToDeg(parseGmsPlanilha(v.lonGms)), gmsToDeg(parseGmsPlanilha(v.latGms))];
  } catch {
    return [v.lon, v.lat];
  }
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

const dist = (a: Pt, b: Pt) => Math.hypot(a.X - b.X, a.Y - b.Y);

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
  opcoes: OpcoesCorrecao = {},
): ResultadoCorrecao {
  if (ringUtm.length < 3) throw new Error("serviço com menos de 3 vértices");
  if (!(afastamentoM >= 0.05 && afastamentoM <= 10)) throw new Error("afastamento deve estar entre 0,05 m e 10 m");
  const tolIgualarM = opcoes.toleranciaIgualarM ?? 0.5;
  if (!(tolIgualarM >= 0 && tolIgualarM <= 5)) throw new Error("tolerância para igualar vértices deve estar entre 0 e 5 m");

  const org: Origem = {
    e0: Math.floor(Math.min(...ringUtm.map((p) => p[0]))),
    n0: Math.floor(Math.min(...ringUtm.map((p) => p[1]))),
  };
  const nosso: Paths = [toPath(ringUtm, org)];
  const orientOrig = ClipperLib.Clipper.Orientation(nosso[0]);
  const areaAntesM2 = areaAbsM2(nosso);
  const ptDe = (p: { e: number; n: number }): Pt => ({ X: Math.round((p.e - org.e0) * ESCALA), Y: Math.round((p.n - org.n0) * ESCALA) });
  const utmDe = (p: Pt): { e: number; n: number } => ({ e: p.X / ESCALA + org.e0, n: p.Y / ESCALA + org.n0 });

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
  const subtrair: { nome: string; path: Paths; parcela: number }[] = [];
  const parcelasVizinhas = new Set<number>(); // corrigidas ou encostadas: fornecem vértices certificados
  parcelas.forEach((par, pi) => {
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
      parcelasVizinhas.add(pi);
    } else {
      status.push({ nome: par.nome, areaSobrepostaM2: inter, status: "corrigida" });
      subtrair.push({ nome: par.nome, path, parcela: pi });
      parcelasVizinhas.add(pi);
    }
  });

  // -------------------------------------------------------------------------
  // Modo A: vértices certificados
  // -------------------------------------------------------------------------
  interface Cert { ref: RefCertificado; pt: Pt }
  const certs: Cert[] = [];
  if (opcoes.usarVerticesCertificados) {
    for (const pi of parcelasVizinhas) {
      const par = parcelas[pi];
      if (!par.vertices?.length) continue;
      par.ringUtm.forEach(([e, n], idx) => {
        if (par.vertices![idx]?.codigo) certs.push({ ref: { parcela: pi, idx }, pt: ptDe({ e, n }) });
      });
    }
  }
  const usarCert = certs.length > 0;
  const tolIgualar = tolIgualarM * ESCALA;
  const tolMm = TOL_MATCH_M * ESCALA;

  // anel base: o nosso, com vértices igualados e certificados encaixados
  let anelBase: PontoCorrigido[] = ringUtm.map(([e, n], i) => ({ origIdx: i, e, n }));
  let igualados = 0;
  if (usarCert && tolIgualar > 0) {
    // igualar: pares (nosso, certificado) por distância crescente, cada lado uma vez
    const pares: { i: number; c: number; d: number }[] = [];
    nosso[0].forEach((p, i) => certs.forEach((c, ci) => {
      const d = dist(p, c.pt);
      if (d <= tolIgualar) pares.push({ i, c: ci, d });
    }));
    pares.sort((a, b) => a.d - b.d);
    const usadoNosso = new Set<number>(), usadoCert = new Set<number>();
    for (const par of pares) {
      if (usadoNosso.has(par.i) || usadoCert.has(par.c)) continue;
      usadoNosso.add(par.i); usadoCert.add(par.c);
      const c = certs[par.c];
      anelBase[par.i] = { origIdx: par.i, ...utmDe(c.pt), certificado: c.ref };
      igualados++;
    }
    // encaixar: certificado a menos da tolerância de um lado nosso entra naquele lado
    const inserir = new Map<number, { t: number; p: PontoCorrigido }[]>(); // índice do lado → inserções
    certs.forEach((c, ci) => {
      if (usadoCert.has(ci)) return;
      let melhor: { lado: number; t: number; d: number } | null = null;
      const n = anelBase.length;
      for (let k = 0; k < n; k++) {
        const a = ptDe(anelBase[k]), b = ptDe(anelBase[(k + 1) % n]);
        const L2 = (b.X - a.X) ** 2 + (b.Y - a.Y) ** 2;
        if (L2 === 0) continue;
        const t = ((c.pt.X - a.X) * (b.X - a.X) + (c.pt.Y - a.Y) * (b.Y - a.Y)) / L2;
        if (t <= 0 || t >= 1) continue;
        const proj = { X: a.X + t * (b.X - a.X), Y: a.Y + t * (b.Y - a.Y) };
        const d = dist(c.pt, proj);
        if (d > tolIgualar) continue;
        if (dist(c.pt, a) <= tolMm || dist(c.pt, b) <= tolMm) continue; // já é um vértice do anel
        if (!melhor || d < melhor.d) melhor = { lado: k, t, d };
      }
      if (!melhor) return;
      usadoCert.add(ci);
      const lista = inserir.get(melhor.lado) ?? [];
      lista.push({ t: melhor.t, p: { origIdx: null, ...utmDe(c.pt), certificado: c.ref } });
      inserir.set(melhor.lado, lista);
    });
    if (inserir.size > 0) {
      const out: PontoCorrigido[] = [];
      anelBase.forEach((p, k) => {
        out.push(p);
        const lista = inserir.get(k);
        if (lista) for (const ins of lista.sort((a, b) => a.t - b.t)) out.push(ins.p);
      });
      anelBase = out;
    }
  }
  const houveIgualacao = anelBase.some((p) => p.certificado);

  if (subtrair.length === 0 && !houveIgualacao) {
    return {
      parcelas: status, avisos, precisaCorrigir: false,
      anel: ringUtm.map(([e, n], i) => ({ origIdx: i, e, n })),
      areaAntesM2, areaDepoisM2: areaAntesM2,
      compartilhados: 0, igualados: 0,
    };
  }

  // polígono de partida do recorte: o anel base (nosso, já com os certificados)
  const base0 = maiorParte(uniao([anelBase.map(ptDe)]));
  if (base0.descartadaM2 > 0.01) {
    avisos.push(`correção dividiu o perímetro; mantida a maior parte (descartados ${base0.descartadaM2.toFixed(1)} m²)`);
  }
  const nossoBase: Paths = [base0.anel];

  // reconstrução: casa pontos do anel com o anel base (tol 1 cm) — que carrega
  // origIdx e certificado — e depois com os vértices certificados soltos
  function reconstruir(anelPath: Path): PontoCorrigido[] {
    let pts = anelPath;
    if (ClipperLib.Clipper.Orientation(pts) !== orientOrig) pts = pts.slice().reverse();
    const basePts = anelBase.map(ptDe);
    const out: PontoCorrigido[] = pts.map((p) => {
      for (let i = 0; i < basePts.length; i++) {
        const q = basePts[i];
        if (Math.abs(p.X - q.X) <= tolMm && Math.abs(p.Y - q.Y) <= tolMm && dist(p, q) <= tolMm) {
          // certificado publica a coordenada DELE, nunca a saída do clipper
          return anelBase[i].certificado ? { ...anelBase[i] } : { ...anelBase[i], ...utmDe(p) };
        }
      }
      for (const c of certs) {
        if (Math.abs(p.X - c.pt.X) <= tolMm && Math.abs(p.Y - c.pt.Y) <= tolMm && dist(p, c.pt) <= tolMm) {
          return { origIdx: null, ...utmDe(c.pt), certificado: c.ref };
        }
      }
      return { origIdx: null, ...utmDe(p) };
    });
    // rotaciona para começar no vértice original mantido de menor índice
    let k0 = -1, menor = Infinity;
    out.forEach((p, k) => {
      if (p.origIdx !== null && p.origIdx < menor) { menor = p.origIdx; k0 = k; }
    });
    return k0 > 0 ? [...out.slice(k0), ...out.slice(0, k0)] : out;
  }

  const ehAncora = (p: PontoCorrigido) => p.origIdx !== null || !!p.certificado;

  function pathPublicado(anel: PontoCorrigido[]): Path {
    return anel.map((p) => (ehAncora(p) ? ptDe(p) : canonico(ptDe(p))));
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

  // ---- modo A: recorte exato + tratamento das transições ao lado de certificados
  let corrigido: Paths = nossoBase;
  let anel: PontoCorrigido[] = [];
  let convergiu = false;
  // transições recuadas: pontos novos que a simplificação não pode remover — a
  // corda direta ao certificado entregaria o triângulo inteiro
  const fixos = new Set<PontoCorrigido>();
  if (usarCert) {
    const alheio = uniao(subtrair.flatMap((s) => s.path));
    const rec = subtrair.length ? diferenca(nossoBase, alheio) : nossoBase;
    if (rec.length === 0) throw new Error("correção removeu todo o perímetro — verifique as parcelas enviadas");
    const { anel: maior, descartadaM2 } = maiorParte(uniao(rec));
    if (descartadaM2 > 0.01) {
      avisos.push(`correção dividiu o perímetro; mantida a maior parte (descartados ${descartadaM2.toFixed(1)} m²)`);
    }
    anel = reconstruir(maior);

    // Transição = ponto que não é nosso nem certificado: o cruzamento do nosso lado
    // com o lado do vizinho. Publicado em cima da divisa alheia, o arredondamento
    // de 0,001" pode jogá-lo 2 cm para dentro dela e reabrir a sobreposição; por
    // isso ele recua MARGEM ao longo do NOSSO lado (rumo ao vértice não
    // certificado) — nunca ganha terra, e a faixa que cede é de centímetros. Só
    // some de vez quando o triângulo que desaparece é desprezível: descartar uma
    // transição longe do certificado entregava o triângulo inteiro (centenas de
    // m² no THEREZA).
    const triOk = (a: PontoCorrigido, t: PontoCorrigido, b: PontoCorrigido): boolean => {
      const tri: Paths = [[ptDe(a), ptDe(t), ptDe(b)]];
      const area = areaAbsM2(tri);
      if (area === 0) return true;
      if (area > EPS_TRIANGULO_DESCARTE_M2) return false;
      if (areaAbsM2(diferenca(tri, nossoBase)) > EPS_TRIANGULO_M2) return false;
      for (const s of subtrair) if (areaAbsM2(intersecao(tri, s.path)) > epsM2) return false;
      return true;
    };
    const margem = MARGEM_TRANSICAO_M * ESCALA;
    for (let guarda = 0; guarda < anel.length * 2; guarda++) {
      const n = anel.length;
      if (n < 4) break;
      let mudou = false;
      for (let k = 0; k < n; k++) {
        const t = anel[k];
        if (ehAncora(t) || fixos.has(t)) continue;
        const a = anel[(k - 1 + n) % n], b = anel[(k + 1) % n];
        if (!a.certificado && !b.certificado) continue;      // corrida sem certificado: laço de afastamento
        if (triOk(a, t, b)) { anel.splice(k, 1); mudou = true; break; }
        if (a.certificado && b.certificado) continue;        // preso entre dois certificados: laço de afastamento
        const s = a.certificado ? a : b, q = a.certificado ? b : a;
        const pt = ptDe(t), ps = ptDe(s), pq = ptDe(q);
        const Ls = dist(pt, ps), Lq = dist(pt, pq);
        if (Ls === 0 || Lq === 0) continue;
        // seno do ângulo entre a divisa alheia (t→s) e o nosso lado (t→q)
        const sen = Math.abs((ps.X - pt.X) * (pq.Y - pt.Y) - (ps.Y - pt.Y) * (pq.X - pt.X)) / (Ls * Lq);
        if (sen < 1e-6) continue;                            // paralelos: não há para onde recuar
        const u = margem / (Lq * sen);
        if (u >= 1) continue;                                // o lado inteiro cabe na margem: deixa ao laço
        const novo: PontoCorrigido = { origIdx: null, ...utmDe({ X: Math.round(pt.X + u * (pq.X - pt.X)), Y: Math.round(pt.Y + u * (pq.Y - pt.Y)) }) };
        anel[k] = novo;
        fixos.add(novo);
        mudou = true;
        break;
      }
      if (!mudou) break;
    }
    corrigido = [anel.map(ptDe)];
    if (residuoPublicado(anel) <= epsM2) convergiu = true;
  }

  // ---- modo B (ou fallback do A): loop dirigido pelo anel publicado
  if (!convergiu) {
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
    const keeps = base.map((p, k) => (ehAncora(p) || fixos.has(p) ? k : -1)).filter((k) => k >= 0);
    if (keeps.length === 0) return base;
    const out: PontoCorrigido[] = [];
    for (let ki = 0; ki < keeps.length; ki++) {
      const i0 = keeps[ki], i1 = keeps[(ki + 1) % keeps.length];
      const seg: number[] = [i0];
      for (let j = i0; j !== i1;) { j = (j + 1) % n; seg.push(j); }
      const pts = seg.map((j) => ptDe(base[j]));
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
    if (ehAncora(p)) return p;
    const c = canonico(ptDe(p));
    return { origIdx: null, ...utmDe(c) };
  });

  return {
    parcelas: status, avisos, precisaCorrigir: true, anel: final,
    areaAntesM2, areaDepoisM2: areaAbsM2([pathPublicado(final)]),
    compartilhados: final.filter((p) => p.certificado).length,
    igualados: final.filter((p) => p.certificado && p.origIdx !== null).length,
  };
}
