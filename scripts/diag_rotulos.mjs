// Diagnóstico de posicionamento dos rótulos da planta, sem renderizador de PDF.
// Desenha a planta de um anel real e mede, para cada rótulo de confrontante:
// corpo escolhido, distância do meio do trecho, desvio lateral e sobreposição.
//   node --experimental-strip-types scripts/diag_rotulos.mjs [lagoa|monoino]
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";
import proj4lib from "proj4";

const proj4 = (f, t, c) => proj4lib(f, t, c);

// FAZENDA LAGOA SECA, serviço ff198218 — o do PDF com o ADERLÂNDIO por cima da
// linha. [ordem, E, N, código, tipo, descritivo]
const ANEIS = {
  aderlandio: [
    [0, 480793.24, 8718069.64, "DSBN-M-3735", "M", "ESTRADA VICINAL", true],
    [1, 480853.52, 8718045.48, "DSBN-P-13913", "P", "", false],
    [2, 480841.11, 8718024.21, "DSBN-P-13914", "P", "", false],
    [3, 480826.74, 8718002.34, "DSBN-P-13915", "P", "", false],
    [4, 480816.82, 8717981.26, "DSBN-P-13916", "P", "", false],
    [5, 480803.95, 8717936.19, "DSBN-P-13917", "P", "", false],
    [6, 480794.36, 8717916.68, "DSBN-P-13918", "P", "", false],
    [7, 480773.06, 8717897.19, "DSBN-P-13919", "P", "", false],
    [8, 480719.81, 8717856.34, "DSBN-P-13920", "P", "", false],
    [9, 480668.69, 8717812.23, "DSBN-P-13921", "P", "", false],
    [10, 480618.98, 8717746.75, "DSBN-P-13922", "P", "", false],
    [11, 480615.60, 8717735.60, "DSBN-M-3736", "M", "ADELSON BONIFACIO DA MOTA", false],
    [12, 480605.40, 8717765.63, "DSBN-P-13923", "P", "", false],
    [13, 480556.81, 8717750.64, "DSBN-P-13924", "P", "", false],
    [14, 480507.27, 8717746.00, "DSBN-P-13925", "P", "", false],
    [15, 480499.72, 8717758.90, "DSBN-P-13926", "P", "", false],
    [16, 480446.06, 8717857.18, "DSBN-M-3737", "M", "ADERLÂNDIO REIS MOTA\\ CPF: 255.963.145-87", false],
    [17, 480528.55, 8717895.20, "DSBN-P-13927", "P", "", false],
    [18, 480523.23, 8717928.89, "DSBN-P-13928", "P", "", false],
    [19, 480511.60, 8717979.53, "DSBN-M-3738", "M", "EXPEDITO JOAQUIM MOTA\\ CPF: 048.864.455-00", false],
    [20, 480606.32, 8717948.11, "DSBN-M-3739", "M", "MANOEL MOTA", false],
    [21, 480655.67, 8717957.17, "DSBN-P-13929", "P", "", false],
    [22, 480723.61, 8717982.03, "DSBN-M-3740", "M", "ANGELINA ROCHA DE LIMA SANTOS\\ CPF: 916.405.125-00", false],
    [23, 480754.80, 8717990.22, "DSBN-P-13930", "P", "", false],
    [24, 480771.55, 8718024.17, "DSBN-P-13931", "P", "", false],
    [25, 480778.96, 8718041.99, "DSBN-P-13932", "P", "", false],
  ],
};

const anel = ANEIS[process.argv[2] ?? "aderlandio"];

const calc = montarServico({
  fusoUtm: 24, prefixo: "DSBN", contadores: { M: 0, P: 0, V: 0 },
  vertices: anel.map(([ordem, e, n, codigo, tipo, desc, via]) => ({
    ordem, numTxt: ordem + 1, e, n, h: 300, sigmaPos: 0.05, sigmaH: 0.08,
    tipo, metodo: "PG6", inserido: false, codigoManual: codigo,
    descritivo: desc || null, tipoLimite: via ? "LA3" : "LA1", ehVia: !!via,
  })),
}, proj4);
const g = geometriaDoCalculo(calc);

const dados = {
  vertices: g.vertices, trechos: g.trechos,
  denominacao: "FAZENDA LAGOA SECA",
  proprietarios: [{ nome: "MARILENE CARNEIRO MOTA", cpf: "044.535.588-30" }],
  matricula: "", cns: "", sncr: "950.335.349.445-1",
  municipioUf: "CONCEIÇÃO DO COITÉ-BA", tipoImovel: "posse",
  areaFmt: g.areaFmt, tarefasFmt: "12,77", perimetroFmt: g.perimetroFmt,
  mcAbs: 39, fuso: 24, latMediaDeg: g.latMediaDeg, trt: "BR20260800648",
  rt: { nome: "DANIEL NASCIMENTO SANTOS", formacao: "Técnico em Agrimensura", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
  desenhista: "EMERSON DA SILVA", dataStr: "04/08/2026", logo: null,
};

const diag = { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 };
await gerarPlantaPdf(dados, diag);

const poly = diag.poligono;
const meioETangente = (t) => {
  const idxs = [];
  for (let i = t.inicioIdx; i !== t.fimIdx; i = (i + 1) % poly.length) idxs.push(i);
  const lens = idxs.map((i) => Math.hypot(
    poly[(i + 1) % poly.length].x - poly[i].x, poly[(i + 1) % poly.length].y - poly[i].y));
  let alvo = lens.reduce((s, l) => s + l, 0) / 2;
  for (const [k, i] of idxs.entries()) {
    if (alvo <= lens[k] || k === idxs.length - 1) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const fr = lens[k] > 0 ? alvo / lens[k] : 0;
      const L = lens[k] || 1;
      return { m: { x: a.x + (b.x - a.x) * fr, y: a.y + (b.y - a.y) * fr }, tg: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } };
    }
    alvo -= lens[k];
  }
  return { m: poly[t.inicioIdx], tg: { x: 1, y: 0 } };
};

console.log(`sobrepostos=${diag.sobrepostos} deslocados=${diag.deslocados} marcos=${diag.marcos.length} obstáculos=${diag.obstaculos.length}`);
diag.rotulos.forEach((r, i) => {
  const t = g.trechos[i];
  const cen = { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 };
  const { m, tg } = meioETangente(t);
  const lateral = Math.abs((cen.x - m.x) * tg.x + (cen.y - m.y) * tg.y);
  // segmento × retângulo de verdade, como planta.ts mede — a caixa envolvente
  // do segmento reprovaria linha que só passa perto na diagonal
  const ccw = (ax, ay, bx, by, cx2, cy2) => (by - ay) * (cx2 - ax) - (bx - ax) * (cy2 - ay);
  const segSeg = (a, b, c2, d2) => {
    const d1 = ccw(c2.x, c2.y, d2.x, d2.y, a.x, a.y), dd = ccw(c2.x, c2.y, d2.x, d2.y, b.x, b.y);
    const d3 = ccw(a.x, a.y, b.x, b.y, c2.x, c2.y), d4 = ccw(a.x, a.y, b.x, b.y, d2.x, d2.y);
    return (d1 > 0) !== (dd > 0) && (d3 > 0) !== (d4 > 0);
  };
  const cruzou = diag.obstaculos.filter((s) => {
    const dentroR = (x, y) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
    if (dentroR(s.x1, s.y1) || dentroR(s.x2, s.y2)) return true;
    const cs = [{ x: r.x1, y: r.y1 }, { x: r.x2, y: r.y1 }, { x: r.x2, y: r.y2 }, { x: r.x1, y: r.y2 }];
    return cs.some((p, k) => segSeg({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, p, cs[(k + 1) % 4]));
  }).length;
  console.log(
    `${(t?.descritivo ?? "?").split("\\")[0].slice(0, 24).padEnd(25)} ` +
    `corpo ${diag.corpos[i].toFixed(1)}pt  caixa ${(r.x2 - r.x1).toFixed(0)}×${(r.y2 - r.y1).toFixed(0)}  ` +
    `dist ${Math.hypot(cen.x - m.x, cen.y - m.y).toFixed(0)}pt  lateral ${lateral.toFixed(0)}pt  ` +
    `${cruzou ? `CRUZA ~${cruzou}` : "limpo"}`,
  );
});
