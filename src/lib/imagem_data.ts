// Imagem por data — acervo Esri World Imagery Wayback.
//
// Para que serve: provar QUANDO uma área foi aberta, construída ou desmatada
// (consolidação no CAR, conferência de posse, conflito de divisa). O mapa base
// mostra só a imagem de hoje; o Wayback guarda cada versão publicada do World
// Imagery desde fevereiro de 2014 (~200 versões). Antes de 2014 não há nada
// aqui: a tela diz isso e não promete 2008.
//
// O problema: das ~200 versões, quase todas repetem a mesma foto num lugar.
// Mostrar a lista crua seria inútil. Então, para o lugar (o tile do centro da
// área, num zoom que enquadra o imóvel):
//   1. o "tilemap" do Wayback diz, para uma versão, de qual versão o tile veio
//      (campo `select`). Andando da mais nova para a mais velha, cada resposta
//      pula direto para a próxima mudança: ~10–20 consultas, não 200;
//   2. se o tilemap não responder, cai na busca binária pelo conteúdo do tile
//      (hash SHA-1), com limite de requisições;
//   3. versões seguidas com o mesmo conteúdo (hash) viram uma só;
//   4. o serviço de metadados de cada versão dá a DATA REAL DA CAPTURA no ponto
//      ("Imagem de 17/06/2018 · Maxar · 0,5 m"); versões seguidas com a mesma
//      captura (reprocessadas, cor corrigida) também viram uma só.
//
// Tudo o que fala com a rede passa por uma `FonteWayback`: a da Esri em
// produção, uma de mentira no laboratório e nos testes (sem rede).
//
// Este arquivo não importa nada do projeto: os testes (node --test) o carregam
// direto, com o TypeScript apagado pelo próprio Node.

export const URL_CONFIG = "https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json";
export const BASE_TILE = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile";
export const BASE_TILEMAP = "https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tilemap";
export const ATRIBUICAO_WAYBACK = "Imagem histórica: © Esri World Imagery Wayback (Maxar, Vantor, Airbus e outros)";
/** Primeira versão do acervo: fevereiro de 2014. */
export const PRIMEIRO_ANO = 2014;
/** Nenhum lugar precisa de mais que isto para achar as mudanças (o acervo tem ~200 versões). */
export const LIMITE_CONSULTAS = 40;

// ---------------------------------------------------------------------------
// Configuração (a lista das versões)
// ---------------------------------------------------------------------------

export interface VersaoWayback {
  /** número da versão na URL do tile (não é cronológico) */
  release: number;
  /** data da publicação da versão, AAAA-MM-DD (não é a data da foto) */
  data: string;
  /** "WB_2019_R12" */
  identificador: string;
  /** serviço de metadados desta versão (data da captura por ponto) */
  metadados: string | null;
}

/** Lê o waybackconfig.json. Entradas sem data ou sem número ficam de fora. Mais nova primeiro. */
export function lerConfig(json: unknown): VersaoWayback[] {
  if (!json || typeof json !== "object") return [];
  const vistas = new Set<number>();
  const out: VersaoWayback[] = [];
  for (const [chave, valor] of Object.entries(json as Record<string, unknown>)) {
    const release = Number(chave);
    if (!Number.isInteger(release) || release <= 0 || vistas.has(release)) continue;
    const v = (valor ?? {}) as Record<string, unknown>;
    const m = /(\d{4}-\d{2}-\d{2})/.exec(String(v.itemTitle ?? ""));
    if (!m) continue;
    const meta = typeof v.metadataLayerUrl === "string" && /^https:\/\//.test(v.metadataLayerUrl) ? v.metadataLayerUrl.replace(/\/+$/, "") : null;
    vistas.add(release);
    out.push({ release, data: m[1], identificador: String(v.layerIdentifier ?? ""), metadados: meta });
  }
  return out.sort((a, b) => (a.data === b.data ? b.release - a.release : a.data < b.data ? 1 : -1));
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

export interface Tile { z: number; x: number; y: number }

/** Tile (esquema XYZ/Web Mercator) que contém o ponto. */
export function tileDoPonto(lon: number, lat: number, z: number): Tile {
  const n = 2 ** z;
  const la = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  let x = Math.floor(((lon + 180) / 360) * n);
  let y = Math.floor(((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n);
  x = Math.min(n - 1, Math.max(0, x));
  y = Math.min(n - 1, Math.max(0, y));
  return { z, x, y };
}

/** Zoom de detecção que enquadra a extensão [oeste, sul, leste, norte] num tile, entre 14 e 17. */
export function zoomParaExtensao(ext: [number, number, number, number] | null): number {
  if (!ext) return 16;
  const larg = Math.max(Math.abs(ext[2] - ext[0]), Math.abs(ext[3] - ext[1]) * 1.2, 1e-6);
  const z = Math.floor(Math.log2(360 / larg));
  return Math.max(14, Math.min(17, z));
}

export const modeloTileEsri = (release: number) => `${BASE_TILE}/${release}/{z}/{y}/{x}`;
export const urlTileEsri = (release: number, t: Tile) => `${BASE_TILE}/${release}/${t.z}/${t.y}/${t.x}`;
export const urlTilemapEsri = (release: number, t: Tile) => `${BASE_TILEMAP}/${release}/${t.z}/${t.y}/${t.x}/1/1`;

export interface RespostaTilemap {
  /** a versão tem imagem neste tile */
  tem: boolean;
  /** versão de onde o tile veio de fato (a da última mudança) */
  release: number | null;
  /** tamanho do arquivo do tile, em bytes */
  tamanho: number | null;
}

/** {"data":[1],"select":[10842],"size":[11884],...} */
export function lerTilemap(json: unknown): RespostaTilemap | null {
  if (!json || typeof json !== "object") return null;
  const j = json as { data?: unknown; select?: unknown; size?: unknown };
  if (!Array.isArray(j.data)) return null;
  const sel = Array.isArray(j.select) ? Number(j.select[0]) : NaN;
  const tam = Array.isArray(j.size) ? Number(j.size[0]) : NaN;
  return {
    tem: Number(j.data[0]) === 1,
    release: Number.isInteger(sel) && sel > 0 ? sel : null,
    tamanho: Number.isFinite(tam) && tam > 0 ? tam : null,
  };
}

// ---------------------------------------------------------------------------
// Metadados: a data real da captura
// ---------------------------------------------------------------------------

export interface Captura {
  /** AAAA-MM-DD */
  data: string;
  /** "Maxar", "Vantor", "Airbus"… */
  fornecedor: string | null;
  /** resolução da foto, em metros */
  resolucaoM: number | null;
  /** precisão posicional declarada, em metros */
  precisaoM: number | null;
}

/** As camadas do serviço de metadados vão de 0 (1,9 cm) a 13 (150 m): camada = 23 − zoom. */
export function camadaMetadados(z: number): number {
  return Math.max(0, Math.min(13, Math.round(23 - z)));
}

export function urlMetadadosEsri(servico: string, camada: number, lon: number, lat: number): string {
  const q = new URLSearchParams({
    f: "json", where: "1=1", outFields: "SRC_DATE2,SRC_DATE,NICE_DESC,SRC_RES,SRC_ACC",
    geometry: `${lon},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
    spatialRel: "esriSpatialRelIntersects", returnGeometry: "false",
  });
  return `${servico}/${camada}/query?${q}`;
}

const doisDigitos = (n: number) => String(n).padStart(2, "0");

/** Resposta da consulta de metadados → captura (ou null se não veio data). */
export function lerCaptura(json: unknown): Captura | null {
  const f = (json as { features?: { attributes?: Record<string, unknown> }[] } | null)?.features;
  const a = Array.isArray(f) && f.length ? f[0]?.attributes : null;
  if (!a) return null;
  let data: string | null = null;
  const ms = Number(a.SRC_DATE2);
  if (a.SRC_DATE2 != null && Number.isFinite(ms) && ms > 0) {
    const d = new Date(ms);
    data = `${d.getUTCFullYear()}-${doisDigitos(d.getUTCMonth() + 1)}-${doisDigitos(d.getUTCDate())}`;
  } else {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(a.SRC_DATE ?? ""));
    if (m) data = `${m[1]}-${m[2]}-${m[3]}`;
  }
  if (!data || !/^(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(data)) return null;
  const num = (v: unknown) => { const n = Number(v); return v != null && v !== "" && Number.isFinite(n) && n > 0 ? n : null; };
  const forn = typeof a.NICE_DESC === "string" && a.NICE_DESC.trim() ? a.NICE_DESC.trim() : null;
  return { data, fornecedor: forn, resolucaoM: num(a.SRC_RES), precisaoM: num(a.SRC_ACC) };
}

// ---------------------------------------------------------------------------
// Achar as mudanças
// ---------------------------------------------------------------------------

export interface Candidata {
  /** posição na lista de versões (0 = mais nova) */
  indice: number;
  release: number;
  tamanho: number | null;
  /** faixa de versões [mais nova, mais velha] (índices) que mostram esta mesma foto */
  faixa: [number, number];
}

/**
 * Anda pelas versões com o tilemap: a resposta da versão i diz de qual versão
 * o tile veio (j ≥ i); a próxima consulta é a j + 1. Para quando a versão não
 * tem imagem no tile ou no limite de consultas. `consultar` lança se o serviço
 * não responder (aí quem chama cai na busca por hash).
 */
export async function percorrerVersoes(
  versoes: VersaoWayback[],
  consultar: (release: number) => Promise<RespostaTilemap>,
  limite = LIMITE_CONSULTAS,
): Promise<{ candidatas: Candidata[]; completo: boolean }> {
  const indice = new Map(versoes.map((v, i) => [v.release, i]));
  const candidatas: Candidata[] = [];
  let i = 0;
  let passos = 0;
  while (i < versoes.length) {
    if (passos >= limite) return { candidatas, completo: false };
    passos++;
    const r = await consultar(versoes[i].release);
    if (!r.tem) break;
    let j = r.release != null ? (indice.get(r.release) ?? i) : i;
    if (j < i) j = i; // resposta incoerente: não volta no tempo
    candidatas.push({ indice: j, release: versoes[j].release, tamanho: r.tamanho, faixa: [i, j] });
    i = j + 1;
  }
  return { candidatas, completo: true };
}

/**
 * Busca binária pelas mudanças quando só dá para comparar o conteúdo: as
 * versões vão de 0 (mais nova) a n − 1; `hashDe(i)` é o hash do tile da versão
 * i (null = sem imagem). Se as pontas de um trecho têm o mesmo hash, o trecho
 * inteiro é tido como igual (uma volta A→B→A no meio passaria; é raro e o
 * limite de requisições vale mais). Devolve o índice da versão MAIS NOVA de
 * cada trecho com imagem, em ordem.
 */
export async function buscarMudancas(
  n: number,
  hashDe: (i: number) => Promise<string | null>,
  limite = LIMITE_CONSULTAS,
): Promise<{ indices: number[]; completo: boolean; consultas: number }> {
  if (n <= 0) return { indices: [], completo: true, consultas: 0 };
  const memo = new Map<number, string | null>();
  let completo = true;
  const h = async (i: number) => {
    if (!memo.has(i)) memo.set(i, await hashDe(i));
    return memo.get(i)!;
  };
  // inícios de trecho: 0 e todo i em que hash(i) ≠ hash(i − 1)
  const inicios = new Set<number>([0]);
  const dividir = async (a: number, b: number): Promise<void> => {
    if (b - a < 1) return;
    const [ha, hb] = [await h(a), await h(b)];
    if (ha === hb) return;
    if (b - a === 1) { inicios.add(b); return; }
    if (memo.size >= limite) { completo = false; inicios.add(b); return; }
    const m = Math.floor((a + b) / 2);
    await dividir(a, m);
    await dividir(m, b);
  };
  await dividir(0, n - 1);
  const indices: number[] = [];
  for (const i of [...inicios].sort((x, y) => x - y)) {
    if ((await h(i)) != null) indices.push(i);
  }
  return { indices, completo, consultas: memo.size };
}

/** Junta itens SEGUIDOS em que `igual(anterior, atual)`; cada grupo mantém a ordem. */
export function agruparSeguidos<T>(itens: T[], igual: (a: T, b: T) => boolean): T[][] {
  const grupos: T[][] = [];
  for (const it of itens) {
    const g = grupos[grupos.length - 1];
    if (g && igual(g[g.length - 1], it)) g.push(it);
    else grupos.push([it]);
  }
  return grupos;
}

export interface ImagemLocal {
  /** versão mostrada no mapa (a mais nova do grupo: melhor cor/processamento) */
  release: number;
  versao: VersaoWayback;
  /** todas as versões do acervo que mostram esta mesma foto no lugar (mais nova primeiro) */
  versoes: VersaoWayback[];
  captura: Captura | null;
  hash: string | null;
  tamanho: number | null;
}

/**
 * Versões seguidas que são a mesma foto viram uma: mesmo hash do tile, ou a
 * mesma data de captura no ponto (a Esri republica a mesma foto com cor nova).
 */
export function consolidar(imagens: ImagemLocal[]): ImagemLocal[] {
  const igual = (a: ImagemLocal, b: ImagemLocal) =>
    (a.hash != null && a.hash === b.hash) || (a.captura != null && b.captura != null && a.captura.data === b.captura.data);
  return agruparSeguidos(imagens, igual).map((g) => {
    const comCaptura = g.find((x) => x.captura) ?? g[0];
    return { ...g[0], captura: comCaptura.captura, versoes: g.flatMap((x) => x.versoes) };
  });
}

// ---------------------------------------------------------------------------
// Fonte (rede) e orquestração
// ---------------------------------------------------------------------------

export interface FonteWayback {
  /** chave do cache (troca de fonte = outro cache) */
  nome: string;
  config(sinal?: AbortSignal): Promise<unknown>;
  tilemap(release: number, t: Tile, sinal?: AbortSignal): Promise<unknown>;
  /** bytes do tile (null = não existe) */
  bytes(release: number, t: Tile, sinal?: AbortSignal): Promise<ArrayBuffer | null>;
  metadados(versao: VersaoWayback, camada: number, lon: number, lat: number, sinal?: AbortSignal): Promise<unknown>;
  /** modelo de URL para o MapLibre ({z}/{y}/{x}) */
  modeloTile(release: number): string;
  /** URL de um tile (miniatura da lista) */
  urlTile(release: number, t: Tile): string;
  /** miniatura da imagem de hoje (o mapa base), quando houver */
  urlTileAtual?: (t: Tile) => string;
  atribuicao: string;
}

/** Cada requisição tem prazo: um servidor que trava não pode deixar a lista girando para sempre. */
export const PRAZO_MS = 15000;
function comPrazo(sinal?: AbortSignal): AbortSignal {
  const prazo = AbortSignal.timeout(PRAZO_MS);
  return sinal ? AbortSignal.any([sinal, prazo]) : prazo;
}

async function json(url: string, sinal?: AbortSignal): Promise<unknown> {
  const r = await fetch(url, { signal: comPrazo(sinal) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export const fonteEsri: FonteWayback = {
  nome: "esri",
  config: (sinal) => json(URL_CONFIG, sinal),
  tilemap: (release, t, sinal) => json(urlTilemapEsri(release, t), sinal),
  async bytes(release, t, sinal) {
    const r = await fetch(urlTileEsri(release, t), { signal: comPrazo(sinal) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.arrayBuffer();
  },
  metadados: (v, camada, lon, lat, sinal) => json(urlMetadadosEsri(v.metadados ?? "", camada, lon, lat), sinal),
  modeloTile: modeloTileEsri,
  urlTile: urlTileEsri,
  urlTileAtual: (t) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${t.z}/${t.y}/${t.x}`,
  atribuicao: ATRIBUICAO_WAYBACK,
};

let fonteAtiva: FonteWayback = fonteEsri;
const ouvintesFonte = new Set<() => void>();
/** Troca a fonte (laboratório). null volta para a Esri. */
export function usarFonte(f: FonteWayback | null): void {
  fonteAtiva = f ?? fonteEsri;
  ouvintesFonte.forEach((cb) => cb());
}
export const fonteEmUso = (): FonteWayback => fonteAtiva;
export function aoTrocarFonte(cb: () => void): () => void {
  ouvintesFonte.add(cb);
  return () => { ouvintesFonte.delete(cb); };
}

/** SHA-1 do conteúdo, em hexadecimal. */
export async function hashDosBytes(buf: ArrayBuffer): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-1", buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

// cache: memória (sempre) + sessionStorage (só a fonte de verdade; pode faltar)
const memoria = new Map<string, unknown>();
function lerSessao<T>(chave: string): T | null {
  try { const s = sessionStorage.getItem(chave); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}
function gravarSessao(chave: string, valor: unknown): void {
  try { sessionStorage.setItem(chave, JSON.stringify(valor)); } catch { /* cheio, bloqueado ou fora do navegador */ }
}
function doCache<T>(fonte: FonteWayback, chave: string): T | null {
  const k = `${fonte.nome}:${chave}`;
  if (memoria.has(k)) return memoria.get(k) as T;
  if (fonte !== fonteEsri) return null;
  const s = lerSessao<T>(`vertces:wayback:${chave}`);
  if (s) memoria.set(k, s);
  return s;
}
function paraCache(fonte: FonteWayback, chave: string, valor: unknown): void {
  memoria.set(`${fonte.nome}:${chave}`, valor);
  if (fonte === fonteEsri) gravarSessao(`vertces:wayback:${chave}`, valor);
}
/** Esquece o que foi guardado (laboratório e testes). */
export function limparCache(): void {
  memoria.clear();
}

/** As versões do acervo (lidas uma vez por sessão). */
export async function carregarVersoes(fonte: FonteWayback = fonteAtiva, sinal?: AbortSignal): Promise<VersaoWayback[]> {
  const guardado = doCache<VersaoWayback[]>(fonte, "versoes");
  if (guardado?.length) return guardado;
  const v = lerConfig(await fonte.config(sinal));
  if (!v.length) throw new Error("a lista de versões do acervo veio vazia");
  paraCache(fonte, "versoes", v);
  return v;
}

export interface ResultadoLugar {
  tile: Tile;
  /** mais nova primeiro; vazio = o acervo não tem imagem neste lugar */
  imagens: ImagemLocal[];
  /** "tilemap" (rápido) ou "hash" (o tilemap não respondeu) */
  metodo: "tilemap" | "hash";
  /** o limite de consultas cortou a busca: pode haver mais datas antigas */
  incompleto: boolean;
  /** total de versões do acervo */
  totalVersoes: number;
  /** datas da captura ainda a caminho (a lista já pode ser mostrada) */
  datasPendentes: number;
}

export interface Progresso { etapa: "versoes" | "mudancas" | "datas"; feitas: number; total: number }

/** Roda `fn` sobre os itens com no máximo `n` ao mesmo tempo. */
async function emParalelo<T, R>(itens: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(itens.length);
  let prox = 0;
  const trabalhador = async () => {
    while (prox < itens.length) { const i = prox++; out[i] = await fn(itens[i], i); }
  };
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, trabalhador));
  return out;
}

const abortou = (e: unknown) => e instanceof Error && e.name === "AbortError";

/**
 * As imagens diferentes que o acervo tem para o ponto, com a data da captura.
 * Se o zoom pedido não tem imagem (lugar remoto), tenta 2 níveis abaixo, até 13.
 */
export async function imagensDoLugar(
  lon: number, lat: number, zoom: number,
  opcoes: {
    fonte?: FonteWayback; sinal?: AbortSignal; limite?: number;
    aoProgredir?: (p: Progresso) => void;
    /** a lista já pronta, antes de chegarem as datas da captura (o serviço de metadados da Esri às vezes demora) */
    aoParcial?: (r: ResultadoLugar) => void;
  } = {},
): Promise<ResultadoLugar> {
  const fonte = opcoes.fonte ?? fonteAtiva;
  const limite = opcoes.limite ?? LIMITE_CONSULTAS;
  opcoes.aoProgredir?.({ etapa: "versoes", feitas: 0, total: 1 });
  const versoes = await carregarVersoes(fonte, opcoes.sinal);
  let z = Math.max(13, Math.min(19, Math.round(zoom)));
  for (;;) {
    const t = tileDoPonto(lon, lat, z);
    const chave = `lugar:${t.z}/${t.x}/${t.y}`;
    const guardado = doCache<ResultadoLugar>(fonte, chave);
    if (guardado) return guardado;
    const { resultado, falhas } = await achar(versoes, t, lon, lat, fonte, limite, opcoes);
    if (resultado.imagens.length || z <= 13) {
      // só guarda o que veio inteiro: uma data que falhou agora pode vir na próxima
      if (!falhas && !resultado.incompleto) paraCache(fonte, chave, resultado);
      return resultado;
    }
    z = Math.max(13, z - 2);
  }
}

/** Data efetiva para ordenar: a da foto, ou a da versão quando a da foto não veio. */
const dataEfetiva = (img: ImagemLocal) => img.captura?.data ?? img.versao.data;

/** Mais nova primeiro pela data da FOTO (a ordem das versões nem sempre é a das fotos). Estável. */
export function ordenarPorData(imagens: ImagemLocal[]): ImagemLocal[] {
  return imagens.map((x, i) => ({ x, i }))
    .sort((a, b) => (dataEfetiva(a.x) === dataEfetiva(b.x) ? a.i - b.i : dataEfetiva(a.x) < dataEfetiva(b.x) ? 1 : -1))
    .map((o) => o.x);
}

async function achar(
  versoes: VersaoWayback[], t: Tile, lon: number, lat: number, fonte: FonteWayback, limite: number,
  opcoes: { sinal?: AbortSignal; aoProgredir?: (p: Progresso) => void; aoParcial?: (r: ResultadoLugar) => void },
): Promise<{ resultado: ResultadoLugar; falhas: number }> {
  const { sinal, aoProgredir, aoParcial } = opcoes;
  const hashes = new Map<number, string | null>();
  const hashDe = async (release: number) => {
    if (!hashes.has(release)) {
      const b = await fonte.bytes(release, t, sinal);
      hashes.set(release, b && b.byteLength ? await hashDosBytes(b) : null);
    }
    return hashes.get(release)!;
  };

  // 1. as versões em que o tile mudou
  let candidatas: Candidata[];
  let metodo: ResultadoLugar["metodo"] = "tilemap";
  let incompleto = false;
  try {
    let feitas = 0;
    const r = await percorrerVersoes(versoes, async (release) => {
      aoProgredir?.({ etapa: "mudancas", feitas: ++feitas, total: Math.max(feitas + 1, 12) });
      const resp = lerTilemap(await fonte.tilemap(release, t, sinal));
      if (!resp) throw new Error("tilemap sem resposta legível");
      return resp;
    }, limite);
    candidatas = r.candidatas;
    incompleto = !r.completo;
  } catch (e) {
    if (abortou(e)) throw e;
    metodo = "hash";
    let feitas = 0;
    const r = await buscarMudancas(versoes.length, async (i) => {
      aoProgredir?.({ etapa: "mudancas", feitas: ++feitas, total: Math.max(feitas + 1, 16) });
      return hashDe(versoes[i].release);
    }, limite);
    candidatas = r.indices.map((i, k) => ({
      indice: i, release: versoes[i].release, tamanho: null,
      faixa: [i, k + 1 < r.indices.length ? r.indices[k + 1] - 1 : versoes.length - 1] as [number, number],
    }));
    incompleto = !r.completo;
  }

  // 2. vizinhas com o mesmo tamanho de arquivo: confere o conteúdo (hash)
  if (metodo === "tilemap") {
    for (let k = 1; k < candidatas.length; k++) {
      const [a, b] = [candidatas[k - 1], candidatas[k]];
      if (a.tamanho == null || a.tamanho !== b.tamanho) continue;
      try { await hashDe(a.release); await hashDe(b.release); } catch (e) { if (abortou(e)) throw e; }
    }
  }

  const capturas: (Captura | null)[] = candidatas.map(() => null);
  let pendentes = candidatas.length;
  const montar = (final: boolean): ResultadoLugar => {
    const imagens = consolidar(candidatas.map((c, k) => ({
      release: c.release,
      versao: versoes[c.indice],
      versoes: versoes.slice(c.faixa[0], c.faixa[1] + 1),
      captura: capturas[k],
      hash: hashes.get(c.release) ?? null,
      tamanho: c.tamanho,
    })));
    return { tile: t, imagens: final ? ordenarPorData(imagens) : imagens, metodo, incompleto, totalVersoes: versoes.length, datasPendentes: pendentes };
  };
  if (candidatas.length) aoParcial?.(montar(false));

  // 3. a data real da captura de cada uma (falha = fica a data da versão, não derruba a lista)
  const camada = camadaMetadados(t.z);
  let falhas = 0;
  await emParalelo(candidatas, 6, async (c, k) => {
    const v = versoes[c.indice];
    if (v.metadados) {
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        try { capturas[k] = lerCaptura(await fonte.metadados(v, camada, lon, lat, sinal)); break; } catch (e) {
          if (abortou(e)) throw e;
          // prazo estourado: não insiste (a lista não pode esperar outro prazo inteiro)
          if (tentativa === 1 || (e instanceof Error && e.name === "TimeoutError")) { falhas++; break; }
        }
      }
    }
    pendentes--;
    aoProgredir?.({ etapa: "datas", feitas: candidatas.length - pendentes, total: candidatas.length });
    if (pendentes > 0) aoParcial?.(montar(false));
  });
  return { resultado: montar(true), falhas };
}

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

/** "2018-06-17" → "17/06/2018" */
export function dataBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** "17/06/2018" (captura) ou "versão de 05/08/2026" quando a data da foto não veio. */
export function rotuloImagem(img: ImagemLocal): string {
  return img.captura ? dataBr(img.captura.data) : `versão de ${dataBr(img.versao.data)}`;
}

/** Ano da foto (ou da versão). */
export const anoImagem = (img: ImagemLocal): string => (img.captura?.data ?? img.versao.data).slice(0, 4);

/** "Maxar · 0,5 m" */
export function detalheImagem(img: ImagemLocal): string {
  const partes: string[] = [];
  if (img.captura?.fornecedor) partes.push(img.captura.fornecedor);
  if (img.captura?.resolucaoM) partes.push(`${String(Math.round(img.captura.resolucaoM * 100) / 100).replace(".", ",")} m`);
  if (!img.captura) partes.push("data da foto não informada");
  return partes.join(" · ");
}

/** "há 8 anos", "há 5 meses", "este mês" — a partir de `hoje` (AAAA-MM-DD). */
export function idade(iso: string, hoje: string): string {
  const [a1, m1] = iso.split("-").map(Number);
  const [a2, m2] = hoje.split("-").map(Number);
  const meses = (a2 - a1) * 12 + (m2 - m1);
  if (meses <= 0) return "este mês";
  if (meses < 12) return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? "há 1 ano" : `há ${anos} anos`;
}

/** Coordenada em graus, minutos e segundos: 6°36'17,3" S */
export function gms(v: number, eixo: "lat" | "lon"): string {
  const h = eixo === "lat" ? (v < 0 ? "S" : "N") : (v < 0 ? "W" : "E");
  const a = Math.abs(v);
  let g = Math.floor(a);
  let m = Math.floor((a - g) * 60);
  let s = Math.round(((a - g) * 60 - m) * 600) / 10;
  if (s >= 60) { s = 0; m++; }
  if (m >= 60) { m = 0; g++; }
  return `${g}°${String(m).padStart(2, "0")}'${s.toFixed(1).replace(".", ",").padStart(4, "0")}" ${h}`;
}

/** Texto para colar no laudo ou na declaração do CAR. */
export function citacao(img: ImagemLocal, lon: number, lat: number): string {
  const foto = img.captura
    ? `imagem de satélite capturada em ${dataBr(img.captura.data)}${img.captura.fornecedor ? ` (${img.captura.fornecedor}${img.captura.resolucaoM ? `, resolução ${String(img.captura.resolucaoM).replace(".", ",")} m` : ""})` : ""}`
    : `imagem de satélite da versão de ${dataBr(img.versao.data)} (data da captura não informada pela fonte)`;
  return `Fonte: Esri World Imagery Wayback, versão ${img.versao.identificador || img.release} (publicada em ${dataBr(img.versao.data)}), ${foto}. Ponto consultado: ${gms(lat, "lat")}, ${gms(lon, "lon")}.`;
}
