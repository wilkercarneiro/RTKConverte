// Acervo de mentira para o laboratório (#/lab/imagem): abre sem internet e
// sem a Esri, com a mesma forma das respostas de verdade. Os tiles são
// desenhados na hora (protocolo "vertces-lab://" do MapLibre; miniaturas em
// data: URL): mata nativa → estrada → abertura da área → pasto → sede. As
// coordenadas do desenho são as do mundo, então tiles vizinhos encaixam e a
// abertura cai em cima do imóvel de exemplo.
import maplibregl from "maplibre-gl";
import type { FonteWayback, Tile, VersaoWayback } from "../../lib/imagem_data";

export type CenarioLab = "fixture" | "lento" | "erro" | "vazio" | "metadados-fora";

/** O imóvel de exemplo (São Félix do Xingu/PA): a abertura de 2013 cai dentro dele. */
export const ANEL_LAB: [number, number][] = [
  [-51.908326, -6.602399], [-51.904964, -6.601760], [-51.903248, -6.601902], [-51.901746, -6.602399],
  [-51.901674, -6.603820], [-51.903248, -6.605454], [-51.902390, -6.607373], [-51.904249, -6.607870],
  [-51.904750, -6.606378], [-51.906180, -6.606804], [-51.906896, -6.605383], [-51.907754, -6.604957],
  [-51.908255, -6.603394],
];

/** Estágios da paisagem, do mais velho ao mais novo. */
const ESTAGIOS = [
  { foto: "2011-06-12", nome: "mata", fornecedor: "DigitalGlobe", res: 0.5 },
  { foto: "2013-09-01", nome: "estrada", fornecedor: "DigitalGlobe", res: 0.5 },
  { foto: "2016-08-20", nome: "abertura", fornecedor: "DigitalGlobe", res: 0.5 },
  { foto: "2018-06-17", nome: "pasto", fornecedor: "Maxar", res: 0.5 },
  { foto: "2025-08-09", nome: "sede", fornecedor: "Vantor", res: 0.34 },
];

/** 16 versões do acervo (mais nova primeiro) e o estágio que cada uma mostra. */
const VERSOES: { release: number; data: string; estagio: number }[] = [
  ["2026-10-29", 4], ["2026-05-28", 4], ["2025-12-18", 4], ["2025-02-27", 3], ["2024-05-09", 3], ["2023-04-05", 3],
  ["2022-02-02", 3], ["2020-09-02", 3], ["2020-01-30", 3], ["2018-09-06", 2], ["2017-02-08", 2], ["2016-10-12", 1],
  ["2015-03-18", 1], ["2014-10-29", 0], ["2014-03-26", 0], ["2014-02-20", 0],
].map(([data, estagio], i) => ({ release: 9000 + (16 - i) * 7, data: data as string, estagio: estagio as number }));

/** Versão de onde o tile de cada versão veio (a mais velha com o mesmo estágio, como o tilemap da Esri). */
function origem(i: number): number {
  let j = i;
  while (j + 1 < VERSOES.length && VERSOES[j + 1].estagio === VERSOES[i].estagio) j++;
  return j;
}

const espera = (ms: number, sinal?: AbortSignal) => new Promise<void>((ok, falha) => {
  const t = setTimeout(ok, ms);
  sinal?.addEventListener("abort", () => { clearTimeout(t); falha(Object.assign(new Error("abortado"), { name: "AbortError" })); }, { once: true });
});

// ---- desenho -------------------------------------------------------------------

const mundo = (lon: number, lat: number, z: number): [number, number] => {
  const n = 256 * 2 ** z;
  const la = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(la) + 1 / Math.cos(la)) / Math.PI) / 2) * n];
};

function ruido(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function desenhar(g: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, estagio: number, t: Tile): void {
  const ox = t.x * 256, oy = t.y * 256;
  const p = (lon: number, lat: number): [number, number] => { const [x, y] = mundo(lon, lat, t.z); return [x - ox, y - oy]; };
  // mata: verde escuro com copas
  g.fillStyle = "#1f3d26"; g.fillRect(0, 0, 256, 256);
  const passo = Math.max(3, Math.min(10, 2 ** (t.z - 13)));
  for (let y = 0; y < 256; y += passo) for (let x = 0; x < 256; x += passo) {
    const r = ruido(Math.floor((ox + x) / passo), Math.floor((oy + y) / passo));
    g.fillStyle = r > 0.6 ? "#2c5634" : r > 0.3 ? "#25492d" : "#1a3321";
    g.fillRect(x, y, passo, passo);
  }
  const poligono = (pts: [number, number][], cor: string) => {
    g.beginPath(); pts.forEach(([lon, lat], i) => { const [x, y] = p(lon, lat); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.closePath();
    g.fillStyle = cor; g.fill();
  };
  if (estagio >= 1) {
    // estrada de terra cortando a vizinhança
    g.strokeStyle = "#b9895c"; g.lineWidth = Math.max(2, 2 ** (t.z - 15) * 3);
    g.beginPath(); const a = p(-51.93, -6.597), b = p(-51.88, -6.6015); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  }
  if (estagio === 2) poligono(ANEL_LAB, "#c99a83");
  if (estagio >= 3) poligono(ANEL_LAB, "#7d9a4f");
  if (estagio >= 4) {
    poligono([[-51.9046, -6.6031], [-51.9040, -6.6031], [-51.9040, -6.6036], [-51.9046, -6.6036]], "#e9e2d0");
    poligono([[-51.9062, -6.6046], [-51.9050, -6.6046], [-51.9050, -6.6052], [-51.9062, -6.6052]], "#4c7fa3");
  }
  // marca d'água: é desenho de laboratório, não foto
  g.fillStyle = "rgb(255 255 255 / 55%)"; g.font = "600 11px system-ui, sans-serif";
  g.fillText(`LAB · ${ESTAGIOS[estagio].foto.slice(0, 4)}`, 6, 16);
}

const cacheMini = new Map<string, string>();
function miniatura(estagio: number, t: Tile): string {
  const k = `${estagio}/${t.z}/${t.x}/${t.y}`;
  let url = cacheMini.get(k);
  if (!url) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    desenhar(c.getContext("2d")!, estagio, t);
    url = c.toDataURL("image/jpeg", 0.8);
    cacheMini.set(k, url);
  }
  return url;
}

let protocoloRegistrado = false;
function registrarProtocolo(): void {
  if (protocoloRegistrado) return;
  protocoloRegistrado = true;
  maplibregl.addProtocol("vertces-lab", async (params) => {
    const m = /vertces-lab:\/\/(\d+)\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error("tile de laboratório inválido");
    const release = Number(m[1]);
    const t = { z: Number(m[2]), y: Number(m[3]), x: Number(m[4]) };
    const v = VERSOES.find((x) => x.release === release);
    const c = new OffscreenCanvas(256, 256);
    desenhar(c.getContext("2d")!, v ? v.estagio : 0, t);
    const blob = await c.convertToBlob({ type: "image/png" });
    return { data: await blob.arrayBuffer() };
  });
}

/** O acervo de mentira, no cenário pedido. */
export function fonteLaboratorio(cenario: CenarioLab): FonteWayback {
  registrarProtocolo();
  const lento = cenario === "lento" ? 900 : 120;
  const indice = (release: number) => VERSOES.findIndex((v) => v.release === release);
  return {
    nome: `lab-${cenario}-${Date.now()}`,
    atribuicao: "Imagens de laboratório (desenho, não é foto)",
    async config(sinal) {
      await espera(lento, sinal);
      if (cenario === "erro") throw new Error("Failed to fetch");
      return Object.fromEntries(VERSOES.map((v, i) => [String(v.release), {
        itemTitle: `World Imagery (Wayback ${v.data})`, layerIdentifier: `WB_${v.data.slice(0, 4)}_R${String(16 - i).padStart(2, "0")}`,
        metadataLayerUrl: `https://lab.invalido/meta/${v.release}/MapServer`,
      }]));
    },
    async tilemap(release, _t, sinal) {
      await espera(lento / 3, sinal);
      const i = indice(release);
      if (cenario === "vazio" || i < 0) return { data: [0], valid: true };
      const o = origem(i);
      return { data: [1], select: [VERSOES[o].release], size: [10000 + VERSOES[o].estagio], valid: true };
    },
    async bytes(release, _t, sinal) {
      await espera(lento / 3, sinal);
      const i = indice(release);
      if (cenario === "vazio" || i < 0) return null;
      return new TextEncoder().encode(`estagio-${VERSOES[i].estagio}`).buffer as ArrayBuffer;
    },
    async metadados(v: VersaoWayback, _camada, _lon, _lat, sinal) {
      // as datas chegam aos poucos, como na Esri
      await espera(lento * 2 + Math.random() * 1200, sinal);
      if (cenario === "metadados-fora") throw new Error("HTTP 502");
      const e = ESTAGIOS[VERSOES[indice(v.release)]?.estagio ?? 0];
      return { features: [{ attributes: { SRC_DATE: Number(e.foto.replaceAll("-", "")), NICE_DESC: e.fornecedor, SRC_RES: e.res, SRC_ACC: 5 } }] };
    },
    modeloTile: (release) => `vertces-lab://${release}/{z}/{y}/{x}`,
    urlTile: (release, t) => miniatura(VERSOES[indice(release)]?.estagio ?? 0, t),
    urlTileAtual: (t) => miniatura(4, t),
  };
}
