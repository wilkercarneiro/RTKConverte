// "Não deve invadir nada com os nomes dos vizinhos."
//
// Caso real: FAZENDA LAGOA SECA, serviço ff198218. O bloco do ADERLÂNDIO REIS
// MOTA saía POR CIMA da poligonal. A divisa dele fica no fundo de um "V" côncavo
// na face oeste: a normal do meio do trecho aponta para dentro da própria
// reentrância, e a aresta vizinha atravessa o raio inteiro. Afastar não resolvia
// (passado o limite da área de desenho, o bloco é grampeado na borda e volta a
// bater), encolher não resolvia (o obstáculo é uma linha cruzando a região, não
// falta de espaço), e a busca terminava em `menosPior`, que aceita sobreposição.
//
// A saída foi devolver o deslize lateral como ÚLTIMO recurso, com dois limites:
// custo alto o bastante para nunca vencer enquanto houver posição centrada livre,
// e teto de 0,4 × o comprimento da divisa, para o nome não alcançar o vão do
// vizinho de baixo. Ver ARQUITETURA-TRECHOS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { geometriaDoCalculo } from "../supabase/functions/_shared/planta_dados.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);

// [E, N, código, tipo, descritivo, ehVia]
const ANEL = [
  [480793.24, 8718069.64, "DSBN-M-3735", "M", "ESTRADA VICINAL", true],
  [480853.52, 8718045.48, "DSBN-P-13913", "P", "", false],
  [480841.11, 8718024.21, "DSBN-P-13914", "P", "", false],
  [480826.74, 8718002.34, "DSBN-P-13915", "P", "", false],
  [480816.82, 8717981.26, "DSBN-P-13916", "P", "", false],
  [480803.95, 8717936.19, "DSBN-P-13917", "P", "", false],
  [480794.36, 8717916.68, "DSBN-P-13918", "P", "", false],
  [480773.06, 8717897.19, "DSBN-P-13919", "P", "", false],
  [480719.81, 8717856.34, "DSBN-P-13920", "P", "", false],
  [480668.69, 8717812.23, "DSBN-P-13921", "P", "", false],
  [480618.98, 8717746.75, "DSBN-P-13922", "P", "", false],
  [480615.60, 8717735.60, "DSBN-M-3736", "M", "ADELSON BONIFACIO DA MOTA", false],
  [480605.40, 8717765.63, "DSBN-P-13923", "P", "", false],
  [480556.81, 8717750.64, "DSBN-P-13924", "P", "", false],
  [480507.27, 8717746.00, "DSBN-P-13925", "P", "", false],
  [480499.72, 8717758.90, "DSBN-P-13926", "P", "", false],
  [480446.06, 8717857.18, "DSBN-M-3737", "M", "ADERLÂNDIO REIS MOTA\\ CPF: 255.963.145-87", false],
  [480528.55, 8717895.20, "DSBN-P-13927", "P", "", false],
  [480523.23, 8717928.89, "DSBN-P-13928", "P", "", false],
  [480511.60, 8717979.53, "DSBN-M-3738", "M", "EXPEDITO JOAQUIM MOTA\\ CPF: 048.864.455-00", false],
  [480606.32, 8717948.11, "DSBN-M-3739", "M", "MANOEL MOTA", false],
  [480655.67, 8717957.17, "DSBN-P-13929", "P", "", false],
  [480723.61, 8717982.03, "DSBN-M-3740", "M", "ANGELINA ROCHA DE LIMA SANTOS\\ CPF: 916.405.125-00", false],
  [480754.80, 8717990.22, "DSBN-P-13930", "P", "", false],
  [480771.55, 8718024.17, "DSBN-P-13931", "P", "", false],
  [480778.96, 8718041.99, "DSBN-P-13932", "P", "", false],
];

const calc = montarServico({
  fusoUtm: 24, prefixo: "DSBN", contadores: { M: 0, P: 0, V: 0 },
  vertices: ANEL.map(([e, n, codigo, tipo, desc, via], i) => ({
    ordem: i, numTxt: i + 1, e, n, h: 300, sigmaPos: 0.05, sigmaH: 0.08,
    tipo, metodo: "PG6", inserido: false, codigoManual: codigo,
    descritivo: desc || null, tipoLimite: via ? "LA3" : "LA1", ehVia: via,
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

test("nenhum nome de vizinho por cima de linha do desenho", () => {
  // era 1 — o ADERLÂNDIO, sobre a poligonal. Conta traço a traço: poligonal,
  // linha dupla das vias, tique de cada vértice e traço verde de cada marco.
  assert.equal(diag.sobrepostos, 0, `${diag.sobrepostos} rótulo(s) sobre as linhas do terreno`);
  assert.equal(diag.rotulos.length, 6, "seis confrontantes, seis rótulos");
});

test("o deslize de último recurso não sai do espaço do próprio vizinho", () => {
  const poly = diag.poligono;
  // no máximo UM rótulo precisa deslizar nesta planta; os outros ficam no meio
  assert.ok(diag.deslocados <= 1, `${diag.deslocados} rótulos fora do meio do trecho`);
  g.trechos.forEach((t, i) => {
    const idxs = [];
    for (let k = t.inicioIdx; k !== t.fimIdx; k = (k + 1) % poly.length) idxs.push(k);
    const lens = idxs.map((k) => Math.hypot(
      poly[(k + 1) % poly.length].x - poly[k].x, poly[(k + 1) % poly.length].y - poly[k].y));
    const comp = lens.reduce((s, l) => s + l, 0);
    let alvo = comp / 2, m = poly[t.inicioIdx], tg = { x: 1, y: 0 };
    for (const [k, idx] of idxs.entries()) {
      if (alvo <= lens[k] || k === idxs.length - 1) {
        const a = poly[idx], b = poly[(idx + 1) % poly.length];
        const fr = lens[k] > 0 ? alvo / lens[k] : 0, L = lens[k] || 1;
        m = { x: a.x + (b.x - a.x) * fr, y: a.y + (b.y - a.y) * fr };
        tg = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
        break;
      }
      alvo -= lens[k];
    }
    const r = diag.rotulos[i];
    const cen = { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 };
    const lateral = Math.abs((cen.x - m.x) * tg.x + (cen.y - m.y) * tg.y);
    // teto do deslize (0,4 · comprimento da divisa) + meio corpo de folga, que é
    // a diferença entre o centro da CAIXA e a âncora numa divisa inclinada
    const tetoLateral = 0.4 * comp + diag.corpos[i] * 0.6;
    assert.ok(lateral <= tetoLateral,
      `"${t.descritivo.split("\\")[0]}" saiu ${lateral.toFixed(0)}pt do meio, teto ${tetoLateral.toFixed(0)}pt`
      + " — nome perto demais da divisa do vizinho de baixo");
  });
});
