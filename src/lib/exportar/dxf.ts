// DXF R12 ASCII em UTM (abre em qualquer CAD, no QGIS e na maioria das
// coletoras), no mesmo estilo do DXF do loteamento (loteamento/saidas.ts).
//
// Camadas do CAD com nome que diz o que têm, para o desenhista ligar e
// desligar o que quiser:
//   <camada>           a geometria: polígono = POLYLINE fechada (furo é outra
//                      POLYLINE fechada), linha = POLYLINE aberta, vértice =
//                      POINT com a altitude no Z — PERIMETRO, GLEBAS, VERTICES…
//   ROTULOS_<camada>   o nome de cada feição: ao lado do vértice, no meio do
//                      polígono (ROTULOS_VERTICES, ROTULOS_LOTES…)
//   SEGMENTOS          azimute e distância no meio de cada lado, girados no
//                      sentido do lado, por dentro do polígono
//   CONFRONTANTES      o confrontante de cada trecho, por fora, no maior lado
//                      dele (um texto por confrontante, não um por lado)
// A altura dos textos acompanha o tamanho da área — um imóvel de 2 km com
// letra de 0,6 m não se lê, um lote com letra de 10 m cobre o desenho.
import { fmtAzimute, fmtBR } from "../../../supabase/functions/_shared/geo.ts";
import { centroide, dentroPol, pontoDoRotulo } from "../loteamento/geom.ts";
import { areaAssinada } from "./coordenadas.ts";
import type { CamadaPronta, FeicaoPronta } from "./coordenadas.ts";
import type { XY } from "./tipos.ts";

/** Cores do AutoCAD (ACI) com o RGB de cada uma, para casar com a cor da camada. */
const ACI: [number, number, number, number][] = [
  [1, 255, 0, 0], [2, 255, 255, 0], [3, 0, 255, 0], [4, 0, 255, 255], [5, 0, 0, 255], [6, 255, 0, 255],
  [7, 255, 255, 255], [8, 128, 128, 128], [9, 192, 192, 192], [30, 255, 127, 0], [40, 255, 191, 0],
  [94, 0, 127, 0], [150, 0, 127, 255], [210, 255, 0, 191],
];
const COR_SEGMENTOS = 7;
const COR_CONFRONTANTES = 4;

function aciDe(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return 7;
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16));
  let melhor = 7, dm = Infinity;
  for (const [aci, ar, ag, ab] of ACI) {
    const d = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
    if (d < dm) { dm = d; melhor = aci; }
  }
  return melhor;
}

/** Nome de camada do R12: até 31 caracteres, letra, número, $, - e _. */
export const nomeCamadaDxf = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9$_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 31) || "CAMADA";

/**
 * Texto do R12 é ANSI de uma linha: sem acento e sem quebra. O grau vira o
 * código %%d, que o AutoCAD e o QGIS desenham como "°".
 */
export const textoDxf = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[\r\n]+/g, " ").replace(/[–—]/g, "-").replace(/°/g, "%%d").replace(/º/g, "o").replace(/ª/g, "a").replace(/²/g, "2")
  .replace(/[^\x20-\x7E]/g, "?");

/** Ângulo do texto ao longo de a→b, sempre legível (entre -90° e 90°). */
function anguloLegivel(a: XY, b: XY): number {
  let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (ang > 90) ang -= 180;
  if (ang <= -90) ang += 180;
  return ang;
}

/** Normal unitária que aponta para DENTRO do anel no lado a→b (horário: à direita). */
function normalParaDentro(a: XY, b: XY, horario: boolean): XY {
  const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const d: XY = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  return horario ? [d[1], -d[0]] : [-d[1], d[0]];
}

/** Onde escrever o nome do polígono: o centroide, se cai dentro; senão o ponto mais "fundo". */
function meioDoPoligono(f: FeicaoPronta): XY {
  const pol = { ext: f.utm, furos: f.furosUtm };
  const c = centroide(f.utm) as XY;
  return dentroPol(c, pol) ? c : (pontoDoRotulo(pol) as XY);
}

export interface DesenhoDxf {
  texto: string;
  /** as camadas do desenho, na ordem da tabela LAYER */
  camadas: string[];
}

export function desenharDxf(camadas: CamadaPronta[]): DesenhoDxf {
  // as entidades vêm antes: a tabela LAYER só lista as camadas que foram usadas
  const ents: string[] = [];
  const g = (c: number, v: string | number) => { ents.push(String(c), typeof v === "number" ? v.toFixed(4) : v); };
  const usadas = new Map<string, number>();
  const usar = (nome: string, cor: number) => { if (!usadas.has(nome)) usadas.set(nome, cor); return nome; };

  // caixa e altura do texto pelo tamanho do desenho
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of camadas) for (const f of c.feicoes) for (const anel of [f.utm, ...f.furosUtm]) for (const [x, y] of anel) {
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  const altura = Math.min(15, Math.max(0.3, Math.hypot(x1 - x0, y1 - y0) / 250));

  // nomes de camada únicos (dois nomes que limpam igual não se misturam)
  const tomados = new Set<string>();
  const nomes = camadas.map((c) => {
    const base = nomeCamadaDxf(c.nome);
    let n = base;
    for (let i = 2; tomados.has(n); i++) n = `${base.slice(0, 31 - String(i).length - 1)}_${i}`;
    tomados.add(n);
    return n;
  });
  camadas.forEach((c, i) => usar(nomes[i], aciDe(c.cor)));

  const poli = (pts: XY[], camada: string, fechada: boolean) => {
    if (pts.length < 2) return;
    g(0, "POLYLINE"); g(8, camada); g(66, "1"); g(70, fechada ? "1" : "0"); g(10, 0); g(20, 0); g(30, 0);
    for (const [x, y] of pts) { g(0, "VERTEX"); g(8, camada); g(10, x); g(20, y); g(30, 0); }
    g(0, "SEQEND"); g(8, camada);
  };
  /** TEXT; `centro` alinha pelo meio (72=1, 73=2) no próprio ponto. */
  const texto = (camada: string, [x, y]: XY, alt: number, t: string, rot = 0, centro = false) => {
    g(0, "TEXT"); g(8, camada); g(10, x); g(20, y); g(30, 0); g(40, alt); g(1, textoDxf(t));
    if (rot) g(50, rot);
    if (centro) { g(72, "1"); g(73, "2"); g(11, x); g(21, y); g(31, 0); }
  };

  // 1. a geometria, cada uma na sua camada
  camadas.forEach((c, i) => {
    for (const f of c.feicoes) {
      if (f.tipo === "poligono") { poli(f.utm, nomes[i], true); for (const h of f.furosUtm) poli(h, nomes[i], true); continue; }
      if (f.tipo === "linha") { poli(f.utm, nomes[i], false); continue; }
      const [x, y] = f.utm[0];
      g(0, "POINT"); g(8, nomes[i]); g(10, x); g(20, y); g(30, f.alt[0] ?? 0);
    }
  });

  // 2. os nomes: ROTULOS_<camada>
  camadas.forEach((c, i) => {
    if (!c.rotulos) return;
    const camada = usar(nomeCamadaDxf(`ROTULOS_${nomes[i]}`), aciDe(c.cor));
    const alt = altura * c.rotulos;
    for (const f of c.feicoes) {
      if (f.tipo === "ponto") texto(camada, [f.utm[0][0] + alt * 0.5, f.utm[0][1] + alt * 0.5], alt, f.nome);
      else if (f.tipo === "poligono") texto(camada, meioDoPoligono(f), alt, f.nome, 0, true);
      else texto(camada, f.utm[Math.floor((f.utm.length - 1) / 2)], alt, f.nome, anguloLegivel(f.utm[0], f.utm[f.utm.length - 1]), true);
    }
  });

  // 3. azimute e distância de cada lado (uma vez por lado: a gleba e o perímetro dividem lados)
  const hSeg = altura * 0.7;
  const vistos = new Set<string>();
  const chaveLado = (a: XY, b: XY) => {
    const k = (p: XY) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
    return [k(a), k(b)].sort().join("|");
  };
  for (const c of camadas) {
    if (!c.segmentos) continue;
    for (const f of c.feicoes) {
      if (f.tipo !== "poligono") continue;
      const horario = areaAssinada(f.utm) < 0;
      f.utm.forEach((a, k) => {
        const b = f.utm[(k + 1) % f.utm.length];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ch = chaveLado(a, b);
        if (d < 0.005 || vistos.has(ch)) return;
        vistos.add(ch);
        // azimute de quadrícula, no sentido em que o polígono anda (o do memorial no GEO)
        const az = ((Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI + 360) % 360;
        const n = normalParaDentro(a, b, horario);
        const m: XY = [(a[0] + b[0]) / 2 + n[0] * hSeg * 0.9, (a[1] + b[1]) / 2 + n[1] * hSeg * 0.9];
        texto(usar("SEGMENTOS", COR_SEGMENTOS), m, hSeg, `${fmtAzimute(az)} - ${fmtBR(d, 2)} m`, anguloLegivel(a, b), true);
      });
    }
  }

  // 4. confrontantes: um texto por trecho (lados seguidos com o mesmo confrontante), no maior lado, por fora
  const hConf = altura * 0.9;
  for (const c of camadas) {
    for (const f of c.feicoes) {
      const conf = f.confrontantes;
      const n = conf.length;
      if (f.tipo !== "poligono" || !conf.some(Boolean)) continue;
      const horario = areaAssinada(f.utm) < 0;
      // começa num ponto de troca para o trecho que dá a volta no anel não se partir em dois
      let ini = conf.findIndex((t, k) => t !== conf[(k - 1 + n) % n]);
      if (ini < 0) ini = 0;
      for (let k = 0; k < n;) {
        const i = (ini + k) % n;
        const nome = conf[i];
        let fim = k;
        while (fim + 1 < n && conf[(ini + fim + 1) % n] === nome) fim++;
        if (nome) {
          let melhor = i, maior = -1;
          for (let j = k; j <= fim; j++) {
            const s = (ini + j) % n, a = f.utm[s], b = f.utm[(s + 1) % n];
            const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (d > maior) { maior = d; melhor = s; }
          }
          const a = f.utm[melhor], b = f.utm[(melhor + 1) % n];
          const dentro = normalParaDentro(a, b, horario);
          const m: XY = [(a[0] + b[0]) / 2 - dentro[0] * hConf * 1.4, (a[1] + b[1]) / 2 - dentro[1] * hConf * 1.4];
          texto(usar("CONFRONTANTES", COR_CONFRONTANTES), m, hConf, nome, anguloLegivel(a, b), true);
        }
        k = fim + 1;
      }
    }
  }

  const o: string[] = [];
  const h = (c: number, v: string | number) => { o.push(String(c), typeof v === "number" ? v.toFixed(4) : v); };
  h(0, "SECTION"); h(2, "HEADER");
  h(9, "$ACADVER"); h(1, "AC1009");
  h(9, "$EXTMIN"); h(10, x0); h(20, y0); h(30, 0);
  h(9, "$EXTMAX"); h(10, x1); h(20, y1); h(30, 0);
  h(0, "ENDSEC");
  h(0, "SECTION"); h(2, "TABLES");
  h(0, "TABLE"); h(2, "LTYPE"); h(70, "1");
  h(0, "LTYPE"); h(2, "CONTINUOUS"); h(70, "0"); h(3, "Solid line"); h(72, "65"); h(73, "0"); h(40, 0);
  h(0, "ENDTAB");
  h(0, "TABLE"); h(2, "LAYER"); h(70, String(usadas.size));
  for (const [nome, cor] of usadas) { h(0, "LAYER"); h(2, nome); h(70, "0"); h(62, String(cor)); h(6, "CONTINUOUS"); }
  h(0, "ENDTAB");
  h(0, "ENDSEC");
  h(0, "SECTION"); h(2, "ENTITIES");
  // concat, não push(...): num loteamento grande são centenas de milhares de linhas
  const linhas = o.concat(ents, ["0", "ENDSEC", "0", "EOF"]);
  return { texto: linhas.join("\r\n") + "\r\n", camadas: [...usadas.keys()] };
}

export const gerarDxfArea = (camadas: CamadaPronta[]): string => desenharDxf(camadas).texto;
