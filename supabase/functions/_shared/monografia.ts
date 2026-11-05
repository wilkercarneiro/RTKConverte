// Monografia de marco: uma ficha por vértice tipo M do imóvel, em lote.
//
// É a ficha que identifica o marco no campo: código, coordenadas geodésicas
// SIRGAS 2000 (latitude, longitude, altitude elipsoidal), UTM (E, N, fuso, MC),
// precisões, método de posicionamento, data e equipamento do levantamento, a
// amarração com os vértices vizinhos, a descrição da localização e do acesso,
// o croqui do perímetro com o marco em destaque, a foto e o responsável
// técnico (conselho e código de credenciado do INCRA).
//
// Sai num DOCX só, UMA PÁGINA POR MARCO, montado sobre o modelo da empresa (o
// Memorial Descritivo dela): o cabeçalho, o rodapé e as margens são os do
// modelo, e a empresa sem modelo próprio ganha o timbre automático como as
// outras peças.
//
// Módulo SEM dependência de execução de outros _shared — como o
// timbre_automatico.ts: no ar, a pasta da gerar-pecas tem esboços no lugar de
// docx.ts/planta.ts. A projeção UTM chega pronta (proj4 do chamador) e o
// croqui é um PNG desenhado aqui mesmo, sem biblioteca de imagem.
import type JSZip from "jszip";

// ------------------------------------------------------------------ campos digitados
/** O que o sistema não sabe e o operador digita na tela (servicos.monografia, 0042). */
export interface CamposMarco {
  /** Onde o marco está: referência física, cerca, árvore, distância de algo. */
  localizacao?: string;
  /** Como chegar: estrada, entradas, distâncias desde a sede do município. */
  acesso?: string;
}
export interface CamposMonografia {
  /** Data do levantamento, como o operador escreve (ex.: 12/08/2026). */
  data_levantamento?: string;
  /** Receptor/equipamento usado (ex.: GNSS RTK ...). */
  equipamento?: string;
  /** Tipo/material do marco (ex.: marco de concreto com chapa). */
  tipo_marco?: string;
  /** Por código do marco. */
  marcos?: Record<string, CamposMarco>;
}

const MAX_TEXTO = 1200;
const MAX_CURTO = 200;
const MAX_MARCOS = 1000;

const texto = (v: unknown, max: number): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/\r\n?/g, "\n").trim().slice(0, max);
  return t || undefined;
};

/**
 * Lê o jsonb gravado (ou o que veio da tela) e devolve só o que se conhece,
 * aparado. Nunca lança: dado estranho vira campo vazio.
 */
export function normalizarCamposMonografia(raw: unknown): CamposMonografia {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: CamposMonografia = {};
  const data = texto(r.data_levantamento, 40);
  const equip = texto(r.equipamento, MAX_CURTO);
  const tipo = texto(r.tipo_marco, MAX_CURTO);
  if (data) out.data_levantamento = data;
  if (equip) out.equipamento = equip;
  if (tipo) out.tipo_marco = tipo;
  const m = r.marcos;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    const marcos: Record<string, CamposMarco> = {};
    for (const [cod, v] of Object.entries(m as Record<string, unknown>).slice(0, MAX_MARCOS)) {
      const c = cod.trim().slice(0, 40);
      if (!c || !v || typeof v !== "object") continue;
      const vv = v as Record<string, unknown>;
      const loc = texto(vv.localizacao, MAX_TEXTO), ac = texto(vv.acesso, MAX_TEXTO);
      if (loc || ac) marcos[c] = { ...(loc ? { localizacao: loc } : {}), ...(ac ? { acesso: ac } : {}) };
    }
    if (Object.keys(marcos).length) out.marcos = marcos;
  }
  return out;
}

// ------------------------------------------------------------------ dados de cada marco
/** O código é de marco (tipo M): "DSBN-M-3605", "M-0001", "M-3". */
export const ehCodigoDeMarco = (codigo: string | null | undefined): boolean =>
  /(^|-)M-?\d/i.test(String(codigo ?? "").trim());

/** Linha da tabela de coordenadas (mesma forma de LinhaSigef). */
export interface LinhaAnel {
  codigo: string; lon: string; lat: string; alt: string;
  vante: string; azimute: string; dist: string;
}

/** Os códigos M de um ou mais anéis, na ordem do perímetro, sem repetir. */
export function marcosDosAneis(aneis: LinhaAnel[][]): string[] {
  const vistos = new Set<string>();
  for (const anel of aneis) for (const l of anel) if (ehCodigoDeMarco(l.codigo)) vistos.add(l.codigo);
  return [...vistos];
}

/** "-39°05'04,737\"" → grau decimal (NaN se não ler). */
export function grauDaTabela(s: string): number {
  const m = String(s ?? "").match(/(-?)\s*(\d+)\s*°\s*(\d+)\s*'\s*([\d,.]+)\s*"?\s*([NSEWO])?/i);
  if (!m) return NaN;
  const v = parseInt(m[2], 10) + parseInt(m[3], 10) / 60 + parseFloat(m[4].replace(",", ".")) / 3600;
  const hemiNeg = /[SWO]/i.test(m[5] ?? "");
  return m[1] === "-" || hemiNeg ? -v : v;
}

/** Número pt-BR com casas fixas (milhar com ponto). */
export function numBR(v: number, casas: number): string {
  if (!Number.isFinite(v)) return "";
  const neg = v < 0;
  const esc = Math.pow(10, casas);
  const n = Math.round(Math.abs(v) * esc);
  const int = String(Math.floor(n / esc)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = casas > 0 ? "," + String(n % esc).padStart(casas, "0") : "";
  return (neg ? "-" : "") + int + frac;
}

/** Grau decimal → `-11°23'44,344" S` (o formato do memorial). */
export function gmsDoGrau(deg: number, tipo: "lat" | "lon"): string {
  const neg = deg < 0;
  const mas = Math.round(Math.abs(deg) * 3600000);
  const d = Math.floor(mas / 3600000), resto = mas % 3600000;
  const mi = Math.floor(resto / 60000), sMil = resto % 60000;
  const s = `${String(Math.floor(sMil / 1000)).padStart(2, "0")},${String(sMil % 1000).padStart(3, "0")}`;
  const hemi = tipo === "lat" ? (neg ? "S" : "N") : (neg ? "W" : "E");
  return `${neg ? "-" : ""}${d}°${String(mi).padStart(2, "0")}'${s}" ${hemi}`;
}

export const fusoDaLongitude = (lonDeg: number): number => Math.floor((lonDeg + 180) / 6) + 1;

/** Métodos de posicionamento do Manual Técnico do INCRA que o texto reconhece. */
const METODOS: Record<string, string> = {
  PG1: "Relativo estático",
  PG2: "Relativo estático-rápido",
  PG3: "Relativo semicinemático",
  PG4: "Relativo cinemático",
  PG6: "Relativo RTK convencional",
  PG7: "Relativo RTK em rede",
  PG8: "Posicionamento por Ponto Preciso (PPP)",
};
export function rotuloMetodo(m: string | null | undefined): string {
  const c = String(m ?? "").trim().toUpperCase();
  if (!c) return "";
  return METODOS[c] ? `${c} — ${METODOS[c]}` : c;
}

/** Vértice do banco (o que interessa à monografia). */
export interface VerticeBanco {
  codigo: string | null; tipo?: string | null;
  sigma_pos?: number | string | null; sigma_h?: number | string | null; metodo?: string | null;
  /** vértice que veio de área certificada vizinha (certificados.ts): o marco é DELE */
  inserido_manual?: boolean | null;
}

/**
 * O marco é do próprio credenciado do serviço? A monografia descreve os marcos
 * que NÓS implantamos: o marco do vizinho certificado (entra no anel com o
 * código e o GMS dele, `inserido_manual=true`) e o de outro credenciado
 * (prefixo diferente) ficam de fora. Sem prefixo conhecido, vale só a marca de
 * inserido.
 */
export function marcoDoCredenciado(codigo: string, prefixo: string | null | undefined, vertice?: VerticeBanco | null): boolean {
  if (vertice?.inserido_manual) return false;
  const p = String(prefixo ?? "").trim().toUpperCase();
  if (!p) return true;
  return String(codigo).trim().toUpperCase().startsWith(`${p}-`);
}

/**
 * Separa os marcos do próprio credenciado (prefixo do código igual ao dele) dos
 * de fora: o do vizinho certificado (`deVizinho`: vértices inseridos de área
 * certificada) e o de outro prefixo. A monografia só descreve os nossos — a
 * mesma regra do servidor (`marcoDoCredenciado`).
 */
export function separarMarcos(marcos: readonly string[], prefixo: string | null | undefined, deVizinho: readonly (string | null | undefined)[] = []): { proprios: string[]; deFora: string[] } {
  const vizinho = new Set(deVizinho.map((c) => (c ?? "").trim()).filter(Boolean));
  const proprios: string[] = [], deFora: string[] = [];
  for (const m of marcos) (marcoDoCredenciado(m, prefixo, { codigo: m, inserido_manual: vizinho.has(m) }) ? proprios : deFora).push(m);
  return { proprios, deFora };
}

export type Proj = (lonDeg: number, latDeg: number, fuso: number) => [number, number];

export interface EntradaMonografia {
  /** Um anel por gleba (imóvel simples: um só). */
  aneis: LinhaAnel[][];
  /** Linhas da tabela `vertices` do serviço, para sigmas e método (podem faltar). */
  vertices?: VerticeBanco[];
  /** Fuso do serviço; sem ele, o do centro do imóvel. */
  fuso?: number | null;
  /** Códigos escolhidos na tela; vazio/ausente = todos os marcos do credenciado. */
  escolhidos?: string[] | null;
  campos?: CamposMonografia;
  imovel: {
    denominacao: string; detentor: string; municipio: string; uf: string;
    matricula?: string | null; cns?: string | null; sncr?: string | null;
  };
  rt: { nome: string; formacao?: string; conselhoSigla?: string; conselhoNumero?: string; cpf?: string };
  codigoCredenciado?: string;
  trt?: string;
  dataStr: string;
  proj: Proj;
}

export interface FichaMarco {
  codigo: string;
  /** "Marco (M)" + o tipo/material digitado. */
  tipo: string;
  latitude: string; longitude: string; altitude: string;
  e: string; n: string; fuso: string; mc: string;
  sigmaH: string; sigmaV: string; metodo: string;
  dataLevantamento: string; equipamento: string;
  anterior: string; seguinte: string;
  localizacao: string; acesso: string;
  /** Perímetro (E, N) do anel do marco e a posição dele, para o croqui. */
  anel: [number, number][];
  indice: number;
  /** Os outros marcos do anel (índices em `anel`), desenhados menores. */
  outrosMarcos: number[];
}

export interface Monografia {
  fichas: FichaMarco[];
  imovel: EntradaMonografia["imovel"];
  rt: EntradaMonografia["rt"];
  codigoCredenciado: string;
  trt: string;
  dataStr: string;
  /** Códigos pedidos que não estão no perímetro (aviso para a tela). */
  naoEncontrados: string[];
  /** Marcos do perímetro que não são do credenciado (vizinho certificado, outro prefixo). */
  deFora: string[];
}

const numDe = (v: unknown): number => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

/** Monta as fichas — pura: sem banco, sem arquivo. */
export function montarMonografia(ent: EntradaMonografia): Monografia {
  const campos = ent.campos ?? {};
  const porCodigo = new Map<string, VerticeBanco>();
  for (const v of ent.vertices ?? []) if (v.codigo) porCodigo.set(String(v.codigo).trim(), v);

  // fuso: o do serviço; sem ele, o do centro de todos os pontos
  const lons = ent.aneis.flat().map((l) => grauDaTabela(l.lon)).filter(Number.isFinite);
  const fuso = ent.fuso && ent.fuso > 0
    ? ent.fuso
    : lons.length ? fusoDaLongitude(lons.reduce((s, x) => s + x, 0) / lons.length) : 24;
  const mc = 6 * fuso - 183;

  const noPerimetro = marcosDosAneis(ent.aneis);
  // só os marcos do próprio credenciado (nem o do vizinho certificado, nem outro prefixo)
  const todos = noPerimetro.filter((c) => marcoDoCredenciado(c, ent.codigoCredenciado, porCodigo.get(c)));
  const deFora = noPerimetro.filter((c) => !todos.includes(c));
  const pedidos = (ent.escolhidos ?? []).map((c) => c.trim()).filter(Boolean);
  const alvo = pedidos.length ? todos.filter((c) => pedidos.includes(c)) : todos;
  const naoEncontrados = pedidos.filter((c) => !noPerimetro.includes(c));

  const fichas: FichaMarco[] = [];
  for (const codigo of alvo) {
    const anel = ent.aneis.find((a) => a.some((l) => l.codigo === codigo))!;
    const i = anel.findIndex((l) => l.codigo === codigo);
    const l = anel[i];
    const lat = grauDaTabela(l.lat), lon = grauDaTabela(l.lon);
    const [e, n] = Number.isFinite(lat) && Number.isFinite(lon) ? ent.proj(lon, lat, fuso) : [NaN, NaN];
    // altitude: "300.051" (PDF do SIGEF, ponto decimal) ou "1.300,051" (pt-BR)
    const altTxt = String(l.alt ?? "").trim();
    const alt = numDe(altTxt.includes(",") ? altTxt.replace(/\./g, "") : altTxt);
    const banco = porCodigo.get(codigo);
    const sh = numDe(banco?.sigma_pos), sv = numDe(banco?.sigma_h);
    const ant = anel.find((x) => x.vante === codigo);
    const extra = campos.marcos?.[codigo] ?? {};
    const xy = anel.map((x): [number, number] => {
      const la = grauDaTabela(x.lat), lo = grauDaTabela(x.lon);
      return Number.isFinite(la) && Number.isFinite(lo) ? ent.proj(lo, la, fuso) : [NaN, NaN];
    });
    fichas.push({
      codigo,
      tipo: ["Marco (M)", campos.tipo_marco].filter(Boolean).join(" — "),
      latitude: Number.isFinite(lat) ? gmsDoGrau(lat, "lat") : l.lat,
      longitude: Number.isFinite(lon) ? gmsDoGrau(lon, "lon") : l.lon,
      altitude: Number.isFinite(alt) ? numBR(alt, 3) : String(l.alt ?? ""),
      e: numBR(e, 3), n: numBR(n, 3),
      fuso: `${fuso} ${lat < 0 ? "S" : "N"}`,
      mc: `${mc < 0 ? "-" : ""}${Math.abs(mc)}° (${mc < 0 ? "W" : "E"})`,
      sigmaH: Number.isFinite(sh) ? numBR(sh, 3) : "",
      sigmaV: Number.isFinite(sv) ? numBR(sv, 3) : "",
      metodo: rotuloMetodo(banco?.metodo),
      dataLevantamento: campos.data_levantamento ?? "",
      equipamento: campos.equipamento ?? "",
      anterior: ant ? `${ant.codigo} → ${codigo}: azimute ${ant.azimute}, distância ${ant.dist} m` : "",
      seguinte: l.vante ? `${codigo} → ${l.vante}: azimute ${l.azimute}, distância ${l.dist} m` : "",
      localizacao: extra.localizacao ?? "",
      acesso: extra.acesso ?? "",
      anel: xy,
      indice: i,
      outrosMarcos: anel.map((x, k) => (k !== i && ehCodigoDeMarco(x.codigo) ? k : -1)).filter((k) => k >= 0),
    });
  }
  return {
    fichas, imovel: ent.imovel, rt: ent.rt,
    codigoCredenciado: ent.codigoCredenciado ?? "", trt: ent.trt ?? "", dataStr: ent.dataStr,
    naoEncontrados, deFora,
  };
}

// ------------------------------------------------------------------ croqui (PNG)
type RGB = [number, number, number];

const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TAB[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(tipo: string, dados: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + dados.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, dados.length);
  for (let i = 0; i < 4; i++) out[4 + i] = tipo.charCodeAt(i);
  out.set(dados, 8);
  dv.setUint32(8 + dados.length, crc32(out.subarray(4, 8 + dados.length)));
  return out;
}
async function zlib(bytes: Uint8Array): Promise<Uint8Array> {
  // "deflate" do CompressionStream é o formato zlib (com cabeçalho e adler32) que o PNG pede
  const cs = new CompressionStream("deflate");
  const buf = await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}
async function pngRgb(w: number, h: number, px: Uint8Array): Promise<Uint8Array> {
  const cru = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    cru[y * (w * 3 + 1)] = 0; // filtro "nenhum"
    cru.set(px.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
  const partes = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", await zlib(cru)), chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of partes) { out.set(p, o); o += p.length; }
  return out;
}

class Tela {
  px: Uint8Array;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number, fundo: RGB) {
    this.w = w; this.h = h;
    this.px = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.px.set(fundo, i * 3);
  }
  /** Mistura `cor` com cobertura 0..1 em cada pixel da máscara. */
  compor(masc: Float32Array, cor: RGB) {
    for (let i = 0; i < masc.length; i++) {
      const a = masc[i];
      if (a <= 0) continue;
      const k = i * 3;
      for (let c = 0; c < 3; c++) this.px[k + c] = Math.round(this.px[k + c] * (1 - a) + cor[c] * a);
    }
  }
  mascara() { return new Float32Array(this.w * this.h); }
  /** Disco suavizado (borda de 1 px) na máscara, guardando a maior cobertura. */
  disco(m: Float32Array, cx: number, cy: number, r: number) {
    const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(this.w - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(this.h - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const a = Math.max(0, Math.min(1, r + 0.5 - d));
        const i = y * this.w + x;
        if (a > m[i]) m[i] = a;
      }
    }
  }
  /** Traço de espessura `esp`, por discos a cada meio pixel. */
  linha(m: Float32Array, ax: number, ay: number, bx: number, by: number, esp: number) {
    const passos = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
    for (let s = 0; s <= passos; s++) {
      const t = s / passos;
      this.disco(m, ax + (bx - ax) * t, ay + (by - ay) * t, esp / 2);
    }
  }
  /** Preenchimento par-ímpar por varredura (centro do pixel). */
  poligono(m: Float32Array, pts: [number, number][]) {
    for (let y = 0; y < this.h; y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(this.w - 1, Math.floor(xs[k + 1] - 0.5)); x++) m[y * this.w + x] = 1;
      }
    }
  }
}

/**
 * Croqui do perímetro com o marco em destaque (vermelho), os outros marcos em
 * pontos escuros e a seta do norte. Sem escala: o desenho cabe no quadro.
 */
export async function croquiPng(anel: [number, number][], destaque: number, outros: number[] = [], lado = 720): Promise<Uint8Array> {
  const tela = new Tela(lado, lado, [255, 255, 255]);
  const val = anel.filter(([e, n]) => Number.isFinite(e) && Number.isFinite(n));
  if (val.length >= 2) {
    const es = val.map((p) => p[0]), ns = val.map((p) => p[1]);
    const eMin = Math.min(...es), eMax = Math.max(...es), nMin = Math.min(...ns), nMax = Math.max(...ns);
    const margem = lado * 0.12;
    const k = (lado - 2 * margem) / Math.max(eMax - eMin, nMax - nMin, 1e-6);
    const ox = (lado - (eMax - eMin) * k) / 2, oy = (lado - (nMax - nMin) * k) / 2;
    const xy = (p: [number, number]): [number, number] => [ox + (p[0] - eMin) * k, lado - (oy + (p[1] - nMin) * k)];
    const pts = anel.map((p) => (Number.isFinite(p[0]) && Number.isFinite(p[1]) ? xy(p) : null));
    const anelPx = pts.filter((p): p is [number, number] => !!p);

    const fundo = tela.mascara();
    tela.poligono(fundo, anelPx);
    tela.compor(fundo, [226, 239, 222]);
    const contorno = tela.mascara();
    for (let i = 0; i < anelPx.length; i++) {
      const a = anelPx[i], b = anelPx[(i + 1) % anelPx.length];
      tela.linha(contorno, a[0], a[1], b[0], b[1], 3.2);
    }
    tela.compor(contorno, [40, 52, 40]);
    const pontos = tela.mascara();
    for (const o of outros) { const p = pts[o]; if (p) tela.disco(pontos, p[0], p[1], 5.5); }
    tela.compor(pontos, [60, 60, 60]);
    const p = pts[destaque];
    if (p) {
      const anelM = tela.mascara();
      for (let s = 0; s < 360; s += 2) {
        const t = (s * Math.PI) / 180;
        tela.disco(anelM, p[0] + Math.cos(t) * 24, p[1] + Math.sin(t) * 24, 2.2);
      }
      tela.compor(anelM, [200, 30, 30]);
      const miolo = tela.mascara();
      tela.disco(miolo, p[0], p[1], 11);
      tela.compor(miolo, [200, 30, 30]);
      const centro = tela.mascara();
      tela.disco(centro, p[0], p[1], 3.5);
      tela.compor(centro, [255, 255, 255]);
    }
  }
  // seta do norte (canto superior direito) e a letra N em traços
  const cx = lado - 52, topo = 26;
  const seta = tela.mascara();
  tela.poligono(seta, [[cx, topo], [cx + 14, topo + 44], [cx, topo + 34], [cx - 14, topo + 44]]);
  tela.compor(seta, [30, 30, 30]);
  const letra = tela.mascara();
  const ly = topo + 56, lh = 22, lw = 14;
  tela.linha(letra, cx - lw / 2, ly + lh, cx - lw / 2, ly, 3);
  tela.linha(letra, cx - lw / 2, ly, cx + lw / 2, ly + lh, 3);
  tela.linha(letra, cx + lw / 2, ly + lh, cx + lw / 2, ly, 3);
  tela.compor(letra, [30, 30, 30]);
  // moldura
  const mold = tela.mascara();
  tela.linha(mold, 1, 1, lado - 2, 1, 2); tela.linha(mold, lado - 2, 1, lado - 2, lado - 2, 2);
  tela.linha(mold, lado - 2, lado - 2, 1, lado - 2, 2); tela.linha(mold, 1, lado - 2, 1, 1, 2);
  tela.compor(mold, [150, 150, 150]);
  return await pngRgb(lado, lado, tela.px);
}

// ------------------------------------------------------------------ DOCX
export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
};
const VAZIO = "____________________";
/** Lado do croqui e da caixa da foto no documento (cm). */
const LADO_CM = 6.4;
const EMU_CM = 360000;
const TWIP_CM = 567;

interface Run { t: string; b?: boolean; sz?: number; cor?: string }
function runs(rs: Run[]): string {
  return rs.map((r) => {
    const pr = [r.b ? "<w:b/>" : "", r.cor ? `<w:color w:val="${r.cor}"/>` : "", r.sz ? `<w:sz w:val="${r.sz}"/><w:szCs w:val="${r.sz}"/>` : ""].join("");
    // quebra de linha digitada vira <w:br/>
    const partes = r.t.split("\n").map((p) => `<w:t xml:space="preserve">${xmlEscape(p)}</w:t>`).join("<w:br/>");
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ""}${partes}</w:r>`;
  }).join("");
}
function p(rs: Run[], o: { jc?: "center" | "right" | "both"; antes?: number; depois?: number; quebra?: boolean } = {}): string {
  return `<w:p><w:pPr>${o.quebra ? "<w:pageBreakBefore/>" : ""}<w:spacing w:before="${o.antes ?? 0}" w:after="${o.depois ?? 0}" w:line="240" w:lineRule="auto"/>${o.jc ? `<w:jc w:val="${o.jc}"/>` : ""}</w:pPr>${runs(rs)}</w:p>`;
}
const SZ = 18; // 9 pt
const rot = (t: string): Run => ({ t, b: true, sz: 15, cor: "444444" });
const val = (t: string): Run => ({ t: t || VAZIO, sz: SZ });

function celula(conteudo: string, o: { larg?: number; span?: number; fundo?: string } = {}): string {
  return `<w:tc><w:tcPr>${o.larg ? `<w:tcW w:w="${o.larg}" w:type="pct"/>` : ""}${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ""}${o.fundo ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fundo}"/>` : ""}<w:tcMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/></w:tcMar></w:tcPr>${conteudo}</w:tc>`;
}
/** Célula de campo: rótulo pequeno em cima, valor embaixo. */
const campo = (r: string, v: string, larg?: number, span?: number) => celula(p([rot(r)]) + p([val(v)]), { larg, span });
function tabela(linhas: string[], colunas: number): string {
  const borda = (l: string) => `<w:${l} w:val="single" w:sz="4" w:space="0" w:color="888888"/>`;
  const grade = Array.from({ length: colunas }, () => `<w:gridCol w:w="${Math.floor(9600 / colunas)}"/>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map(borda).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grade}</w:tblGrid>${linhas.map((l) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${l}</w:tr>`).join("")}</w:tbl>`;
}
const titulo = (t: string) => p([{ t, b: true, sz: 17, cor: "FFFFFF" }]);
const faixa = (t: string, colunas: number) => celula(titulo(t), { span: colunas, fundo: "3F5A3F" });

function imagem(rid: string, id: number, nome: string): string {
  const cx = Math.round(LADO_CM * EMU_CM);
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cx}"/><wp:docPr id="${id}" name="${xmlEscape(nome)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="${NS.pic}"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${xmlEscape(nome)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cx}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

/** rId do croqui da ficha `i` em word/_rels/document.xml.rels. */
export const ridCroqui = (i: number) => `rIdMonoCroqui${i + 1}`;

/** Corpo de uma página (uma ficha). `rid` = relação da imagem do croqui. */
export function paginaDaFicha(m: Monografia, f: FichaMarco, i: number, rid = ridCroqui(i)): string {
  const im = m.imovel;
  const partes: string[] = [];
  partes.push(p([{ t: "MONOGRAFIA DE MARCO", b: true, sz: 28 }], { jc: "center", quebra: i > 0 }));
  partes.push(p([{ t: "Vértice de limite de imóvel rural · georreferenciamento (INCRA/SIGEF) · SIRGAS 2000", sz: 15, cor: "555555" }], { jc: "center", depois: 100 }));

  const cols = 4;
  partes.push(tabela([
    faixa("IDENTIFICAÇÃO DO MARCO E DO IMÓVEL", cols),
    campo("Código do marco", f.codigo, 1250) + campo("Tipo", f.tipo, 1250) + campo("Imóvel", im.denominacao, 2500, 2),
    campo("Proprietário / detentor", im.detentor, 2500, 2) + campo("Município / UF", `${im.municipio}${im.uf ? ` - ${im.uf}` : ""}`, 1250) + campo("Matrícula / CNS", [im.matricula, im.cns ? `CNS ${im.cns}` : ""].filter(Boolean).join(" · "), 1250),
    faixa("COORDENADAS GEODÉSICAS — SIRGAS 2000", cols),
    campo("Latitude", f.latitude, 1250) + campo("Longitude", f.longitude, 1250) + campo("Altitude elipsoidal (m)", f.altitude, 1250) + campo("Código SNCR", im.sncr ?? "", 1250),
    faixa("COORDENADAS UTM — SIRGAS 2000", cols),
    campo("E (m)", f.e, 1250) + campo("N (m)", f.n, 1250) + campo("Fuso", f.fuso, 1250) + campo("Meridiano central", f.mc, 1250),
    faixa("PRECISÃO E LEVANTAMENTO", cols),
    campo("σ horizontal (m)", f.sigmaH, 1250) + campo("σ altura (m)", f.sigmaV, 1250) + campo("Método de posicionamento", f.metodo, 2500, 2),
    campo("Data do levantamento", f.dataLevantamento, 1250) + campo("Equipamento / receptor", f.equipamento, 3750, 3),
    faixa("AMARRAÇÃO NO PERÍMETRO", cols),
    campo("Vértice anterior", f.anterior, 2500, 2) + campo("Vértice seguinte", f.seguinte, 2500, 2),
    faixa("DESCRIÇÃO DA LOCALIZAÇÃO", cols),
    celula(p([val(f.localizacao || `${VAZIO}${VAZIO}${VAZIO}\n${VAZIO}${VAZIO}${VAZIO}`)]), { span: cols }),
    faixa("ITINERÁRIO DE ACESSO", cols),
    celula(p([val(f.acesso || `${VAZIO}${VAZIO}${VAZIO}\n${VAZIO}${VAZIO}${VAZIO}`)]), { span: cols }),
  ], cols));

  // croqui | foto
  const altura = Math.round(LADO_CM * TWIP_CM) + 120;
  const croqui = p([rot("CROQUI DE LOCALIZAÇÃO NO PERÍMETRO (sem escala)")], { jc: "center" })
    + `<w:p><w:pPr><w:spacing w:before="40" w:after="0"/><w:jc w:val="center"/></w:pPr>${imagem(rid, 90001 + i, `Croqui ${f.codigo}`)}</w:p>`
    + p([{ t: `● ${f.codigo} em vermelho · demais marcos em cinza · N para cima`, sz: 14, cor: "555555" }], { jc: "center" });
  const foto = p([rot("FOTO DO MARCO")], { jc: "center" })
    + p([{ t: "(colar a foto aqui)", sz: 14, cor: "999999" }], { jc: "center", antes: Math.round(altura / 2) - 200 });
  partes.push(p([], { depois: 80 }));
  partes.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${["top", "left", "bottom", "right", "insideV"].map((l) => `<w:${l} w:val="single" w:sz="4" w:space="0" w:color="888888"/>`).join("")}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4800"/><w:gridCol w:w="4800"/></w:tblGrid><w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${altura + 250}" w:hRule="atLeast"/></w:trPr>${celula(croqui, { larg: 2500 })}${celula(foto, { larg: 2500 })}</w:tr></w:tbl>`);

  // responsável técnico
  const rt = m.rt;
  const conselho = [rt.conselhoSigla, rt.conselhoNumero].filter(Boolean).join(" ");
  partes.push(p([{ t: `${im.municipio}${im.uf ? ` - ${im.uf}` : ""}, ${m.dataStr}`, sz: SZ }], { jc: "right", antes: 100, depois: 240 }));
  partes.push(p([{ t: "_".repeat(52), sz: SZ }], { jc: "center" }));
  partes.push(p([{ t: rt.nome, b: true, sz: SZ }, { t: "  ·  Responsável técnico", sz: 15, cor: "555555" }], { jc: "center" }));
  const linhaRt = [rt.formacao, conselho ? `${conselho}` : "", m.codigoCredenciado ? `Código do credenciado INCRA: ${m.codigoCredenciado}` : "", m.trt ? `TRT: ${m.trt}` : ""].filter(Boolean).join(" · ");
  partes.push(p([{ t: linhaRt || VAZIO, sz: 15 }], { jc: "center" }));
  return partes.join("");
}

/** Seção do modelo: a última `<w:sectPr>` do corpo (cabeçalho, rodapé, margens). */
export function secaoDoModelo(documentXml: string): string | null {
  const m = documentXml.match(/<w:sectPr\b(?:[^>]*\/>|[\s\S]*?<\/w:sectPr>)\s*<\/w:body>/);
  return m ? m[0].replace(/\s*<\/w:body>$/, "") : null;
}

const SECAO_PADRAO = `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1418" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>`;

/**
 * document.xml da monografia sobre o do modelo: mantém a abertura (namespaces
 * do modelo, mais os de imagem que faltarem) e a seção; troca só o corpo.
 */
export function documentoMonografiaXml(m: Monografia, modeloXml?: string | null, rids?: string[]): string {
  let abertura = modeloXml?.match(/<w:document\b[^>]*>/)?.[0] ?? `<w:document xmlns:w="${NS.w}">`;
  for (const [pre, uri] of Object.entries(NS)) {
    if (!new RegExp(`\\sxmlns:${pre}="`).test(abertura)) abertura = abertura.replace(/>$/, ` xmlns:${pre}="${uri}">`);
  }
  const secao = (modeloXml && secaoDoModelo(modeloXml)) || SECAO_PADRAO;
  const corpo = m.fichas.length
    ? m.fichas.map((f, i) => paginaDaFicha(m, f, i, rids?.[i])).join("")
    : p([{ t: "Nenhum marco (vértice tipo M) no perímetro.", sz: SZ }]);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${abertura}<w:body>${corpo}${secao}</w:body></w:document>`;
}

/**
 * Escreve a monografia no pacote do modelo: document.xml novo, um PNG de
 * croqui por ficha em word/media, as relações e o tipo png. O resto do pacote
 * (estilos, cabeçalho, rodapé, timbre) fica como está.
 */
export async function escreverMonografia(zip: JSZip, m: Monografia): Promise<void> {
  const docPath = "word/document.xml", relsPath = "word/_rels/document.xml.rels";
  const modeloXml = zip.file(docPath) ? await zip.file(docPath)!.async("string") : null;
  let rels = zip.file(relsPath) ? await zip.file(relsPath)!.async("string")
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  // Nada do modelo é sobrescrito nem removido: os rIds e os nomes de mídia do
  // croqui fogem de TODOS os que o pacote já usa (documento, cabeçalhos,
  // rodapés — o modelo próprio da empresa pode ter logo no cabeçalho).
  const idsUsados = new Set<string>();
  for (const nome of Object.keys(zip.files)) {
    if (!nome.endsWith(".rels")) continue;
    const xml = await zip.file(nome)!.async("string");
    for (const mm of xml.matchAll(/\bId="([^"]+)"/g)) idsUsados.add(mm[1]);
  }
  const livre = (base: string, usado: (s: string) => boolean) => {
    let k = 1;
    while (usado(`${base}${k}`)) k++;
    return `${base}${k}`;
  };
  const rids: string[] = [];
  for (let i = 0; i < m.fichas.length; i++) {
    const f = m.fichas[i];
    const png = await croquiPng(f.anel, f.indice, f.outrosMarcos);
    const nomeMidia = livre("monografia-croqui-", (s) => !!zip.file(`word/media/${s}.png`));
    const alvo = `media/${nomeMidia}.png`;
    zip.file(`word/${alvo}`, png);
    const id = livre("rIdMonoCroqui", (s) => idsUsados.has(s));
    idsUsados.add(id);
    rids.push(id);
    rels = rels.replace("</Relationships>", `<Relationship Id="${id}" Type="${NS.r}/image" Target="${alvo}"/></Relationships>`);
  }
  zip.file(docPath, documentoMonografiaXml(m, modeloXml, rids));
  zip.file(relsPath, rels);
  const ctPath = "[Content_Types].xml";
  let ct = zip.file(ctPath) ? await zip.file(ctPath)!.async("string") : "";
  if (ct && !/<Default[^>]+Extension="png"/i.test(ct)) ct = ct.replace("</Types>", `<Default Extension="png" ContentType="image/png"/></Types>`);
  if (ct) zip.file(ctPath, ct);
}
