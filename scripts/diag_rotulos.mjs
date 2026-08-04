// Diagnóstico de posicionamento dos rótulos da planta, sem renderizador de PDF.
// Desenha a planta de um anel real e mede, para cada rótulo de confrontante:
// onde ele caiu, a que distância do meio do trecho dele, e se invadiu a área do
// imóvel ou o espaço de outro trecho.
//   node --experimental-strip-types scripts/diag_rotulos.mjs
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";

const ANEL = [
  [481057.98, 8733205.54, "DSBN-P-14000", "P"], [481091.17, 8733180.16, "DSBN-P-14028", "P"],
  [481129.39, 8733164.00, "DSBN-P-14027", "P"], [481151.06, 8733154.67, "DSBN-M-4502", "M"],
  [480994.84, 8732859.78, "DSBN-M-4501", "M"], [480991.23, 8732860.39, "DSBN-P-14026", "P"],
  [480950.06, 8732859.57, "DSBN-P-14025", "P"], [480908.95, 8732855.95, "DSBN-P-14024", "P"],
  [480867.59, 8732855.06, "DSBN-P-14023", "P"], [480840.93, 8732859.25, "DSBN-P-14022", "P"],
  [480797.47, 8732873.85, "DSBN-P-14021", "P"], [480761.50, 8732886.79, "DSBN-P-14020", "P"],
  [480738.10, 8732899.92, "DSBN-P-14019", "P"], [480716.25, 8732918.36, "DSBN-P-14018", "P"],
  [480674.38, 8732962.20, "DSBN-P-14017", "P"], [480676.77, 8732969.02, "DSBN-M-4500", "M"],
  [480683.13, 8732969.12, "DSBN-P-14016", "P"], [480705.37, 8732965.38, "DSBN-P-14015", "P"],
  [480719.70, 8732963.95, "DSBN-P-14014", "P"], [480733.67, 8732963.34, "DSBN-P-14013", "P"],
  [480746.21, 8732964.61, "DSBN-P-14012", "P"], [480761.42, 8732968.67, "DSBN-P-14011", "P"],
  [480791.74, 8732974.96, "DSBN-P-14010", "P"], [480826.70, 8732981.34, "DSBN-P-14009", "P"],
  [480869.42, 8732987.01, "DSBN-P-14008", "P"], [480900.88, 8733023.06, "DSBN-P-14007", "P"],
  [480932.09, 8733058.31, "DSBN-P-14006", "P"], [480959.10, 8733088.52, "DSBN-P-14005", "P"],
  [480996.40, 8733130.41, "DSBN-P-14004", "P"], [481012.20, 8733149.52, "DSBN-P-14003", "P"],
  [481024.04, 8733168.60, "DSBN-P-14002", "P"], [481032.51, 8733194.69, "DSBN-P-14001", "P"],
];

const TRECHOS = [
  { descritivo: "ESTRADA VICINAL", isEstrada: true, inicioIdx: 3, fimIdx: 4 },
  {
    descritivo: "(POSSE) FAZENDA SALGADA VELHA\\ MARIA ELZA CORDEIRO FERREIRA SOUZA\\ CPF:638.910.005-10",
    isEstrada: false, inicioIdx: 4, fimIdx: 15,
  },
  { descritivo: "LINHA FERREA", isEstrada: true, inicioIdx: 15, fimIdx: 3 },
];

const dados = {
  vertices: ANEL.map(([e, n, codigo], i) => ({
    codigo, e, n, lonFmt: "-39°04'00,000\"", latFmt: "-11°27'00,000\"", alt: "300,00",
    azFmt: "0°00'00\"", distFmt: "10,00", vante: ANEL[(i + 1) % ANEL.length][2],
  })),
  trechos: TRECHOS,
  denominacao: "FAZENDA LAGOA SECA",
  proprietarios: [{ nome: "MARILENE CARNEIRO MOTA", cpf: "044.535.588-30" }],
  matricula: "", cns: "", sncr: "950.335.349.445-1",
  municipioUf: "CONCEIÇÃO DO COITÉ-BA", tipoImovel: "posse",
  areaFmt: "6,7299", tarefasFmt: "15,45", perimetroFmt: "1.292,12",
  mcAbs: 39, fuso: 24, latMediaDeg: -11.45, trt: "000001",
  rt: { nome: "DANIEL NASCIMENTO SANTOS", formacao: "Técnico em Agrimensura", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
  desenhista: "EMERSON DA SILVA", dataStr: "04/08/2026", logo: null,
};

const diag = { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 };
await gerarPlantaPdf(dados, diag);

const poly = diag.poligono;
const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
const bbox = { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
const dentro = (p) => {
  let d = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) d = !d;
  }
  return d;
};
// meio geométrico de cada trecho, na mesma conta que planta.ts usa
const meioDoTrecho = (t) => {
  const idxs = [];
  for (let i = t.inicioIdx; i !== t.fimIdx; i = (i + 1) % poly.length) idxs.push(i);
  const lens = idxs.map((i) => Math.hypot(poly[(i + 1) % poly.length].x - poly[i].x, poly[(i + 1) % poly.length].y - poly[i].y));
  let alvo = lens.reduce((s, l) => s + l, 0) / 2;
  for (const [k, i] of idxs.entries()) {
    if (alvo <= lens[k] || k === idxs.length - 1) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const fr = lens[k] > 0 ? alvo / lens[k] : 0;
      return { x: a.x + (b.x - a.x) * fr, y: a.y + (b.y - a.y) * fr };
    }
    alvo -= lens[k];
  }
  return poly[t.inicioIdx];
};

console.log(`polígono: ${(bbox.x2 - bbox.x1).toFixed(0)} × ${(bbox.y2 - bbox.y1).toFixed(0)} pt`);
console.log(`sobrepostos=${diag.sobrepostos} deslocados=${diag.deslocados} marcos=${diag.marcos.length}`);
diag.rotulos.forEach((r, i) => {
  const t = TRECHOS[i];
  const c = { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 };
  const m = meioDoTrecho(t);
  console.log(
    `${(t?.descritivo ?? "?").split("\\")[0].padEnd(22)} ` +
    `caixa ${(r.x2 - r.x1).toFixed(0)}×${(r.y2 - r.y1).toFixed(0)}pt ` +
    `corpo ${diag.corpos[i].toFixed(1)}pt ` +
    `dist do meio do trecho ${Math.hypot(c.x - m.x, c.y - m.y).toFixed(0)}pt ` +
    `${dentro(c) ? "DENTRO DO IMÓVEL" : "fora"}`,
  );
});
