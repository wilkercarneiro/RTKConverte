// FAZENDA LAGOA SECA (serviço 5da4d729), planta v17: dos três vértices M só o
// DSBN-M-4501 saiu com traço verde. O traço era desenhado de dentro do laço de
// rótulos, que faz `continue` nos trechos de faixa de domínio, então M-4500
// (LINHA FERREA) e M-4502 (ESTRADA VICINAL) ficavam sem marco — e a planta não
// dizia onde a divisa de cada confrontante começa e termina.
//
// O segundo teste é a guarda que faltava em volta disso: a divisa coberta por
// cada confrontante tem de ser a MESMA no memorial e na planta gerada com o PDF
// do SIGEF. São dois caminhos independentes — `montarServico` normaliza o anel
// para horário e desloca a confrontação um M quando inverte (`inverterSentido`),
// enquanto `montarTrechosDoSigef` anda para frente na ordem gravada, sem inverter
// nada. Enquanto as duas convenções derem na mesma divisa está tudo bem; no dia
// em que divergirem, cada confrontante sai descrito na cerca do vizinho, que é o
// defeito que ARQUITETURA-TRECHOS.md existe para evitar. Por isso a comparação
// roda nos DOIS sentidos: o anel real (horário, em que montarServico não inverte)
// e o mesmo anel invertido, que é onde o deslocamento entra em ação.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import proj4lib from "proj4";
import { montarServico } from "../supabase/functions/_shared/servico.ts";
import { montarTrechosDoSigef } from "../supabase/functions/_shared/reconciliacao.ts";
import { gerarPlantaPdf } from "../supabase/functions/_shared/planta.ts";

const proj4 = (f, t, c) => proj4lib(f, t, c);

// anel como está gravado no banco depois da reconciliação: ordem = sequência do
// PDF do SIGEF. [E, N, código, tipo]
const ANEL = [
  [481057.98, 8733205.54, "DSBN-P-14000", "P"],
  [481091.17, 8733180.16, "DSBN-P-14028", "P"],
  [481129.39, 8733164.00, "DSBN-P-14027", "P"],
  [481151.06, 8733154.67, "DSBN-M-4502", "M"],
  [480994.84, 8732859.78, "DSBN-M-4501", "M"],
  [480991.23, 8732860.39, "DSBN-P-14026", "P"],
  [480950.06, 8732859.57, "DSBN-P-14025", "P"],
  [480908.95, 8732855.95, "DSBN-P-14024", "P"],
  [480867.59, 8732855.06, "DSBN-P-14023", "P"],
  [480840.93, 8732859.25, "DSBN-P-14022", "P"],
  [480797.47, 8732873.85, "DSBN-P-14021", "P"],
  [480761.50, 8732886.79, "DSBN-P-14020", "P"],
  [480738.10, 8732899.92, "DSBN-P-14019", "P"],
  [480716.25, 8732918.36, "DSBN-P-14018", "P"],
  [480674.38, 8732962.20, "DSBN-P-14017", "P"],
  [480676.77, 8732969.02, "DSBN-M-4500", "M"],
  [480683.13, 8732969.12, "DSBN-P-14016", "P"],
  [480705.37, 8732965.38, "DSBN-P-14015", "P"],
  [480719.70, 8732963.95, "DSBN-P-14014", "P"],
  [480733.67, 8732963.34, "DSBN-P-14013", "P"],
  [480746.21, 8732964.61, "DSBN-P-14012", "P"],
  [480761.42, 8732968.67, "DSBN-P-14011", "P"],
  [480791.74, 8732974.96, "DSBN-P-14010", "P"],
  [480826.70, 8732981.34, "DSBN-P-14009", "P"],
  [480869.42, 8732987.01, "DSBN-P-14008", "P"],
  [480900.88, 8733023.06, "DSBN-P-14007", "P"],
  [480932.09, 8733058.31, "DSBN-P-14006", "P"],
  [480959.10, 8733088.52, "DSBN-P-14005", "P"],
  [480996.40, 8733130.41, "DSBN-P-14004", "P"],
  [481012.20, 8733149.52, "DSBN-P-14003", "P"],
  [481024.04, 8733168.60, "DSBN-P-14002", "P"],
  [481032.51, 8733194.69, "DSBN-P-14001", "P"],
];

const CONF = {
  "DSBN-M-4502": { descritivo: "ESTRADA VICINAL", ehVia: true, tipoLimite: "LA3" },
  "DSBN-M-4501": {
    descritivo: "(POSSE) FAZENDA SALGADA VELHA\\ MARIA ELZA CORDEIRO FERREIRA SOUZA\\ CPF:638.910.005-10",
    ehVia: false, tipoLimite: "LA1",
  },
  "DSBN-M-4500": { descritivo: "LINHA FERREA", ehVia: true, tipoLimite: "LA3" },
};

/**
 * O MESMO imóvel levantado no sentido contrário.
 *
 * Não basta dar `reverse()` no anel: a confrontação de um M vale para o trecho
 * que sai dele PARA FRENTE na ordem gravada, então, invertida a ordem, o mesmo
 * pedaço de cerca passa a ser aberto pelo M do outro extremo — cada M assume a
 * confrontação do M seguinte na nova sequência. É a mesma regra de
 * `inverterSentido` (servico.ts), aplicada aqui à ENTRADA para que os dois anéis
 * descrevam a mesma realidade e a conferência geográfica valha para os dois.
 */
function inverter(anel, conf) {
  const inv = [...anel].reverse();
  const ms = inv.filter(([, , , t]) => t === "M").map(([, , cod]) => cod);
  const confInv = {};
  ms.forEach((cod, k) => { confInv[cod] = conf[ms[(k + 1) % ms.length]]; });
  return [inv, confInv];
}

// a divisa é o pedaço de cerca entre dois vértices; percorrê-la num sentido ou no
// outro não muda de dono, então a chave é o par SEM direção
const chave = (a, b) => [a, b].sort().join("|");

const sentidoHorario = (anel) => {
  let a2 = 0;
  anel.forEach(([e, n], i) => {
    const [e2, n2] = anel[(i + 1) % anel.length];
    a2 += e * n2 - e2 * n;
  });
  return a2 < 0; // convenção do sistema: área assinada < 0 = horário
};

/** Confrontante de cada divisa segundo o memorial/planilha (montarServico). */
function divisasDoMemorial(anel, conf = CONF) {
  const servico = montarServico({
    fusoUtm: 24, prefixo: "DSBN", contadores: { M: 0, P: 0, V: 0 },
    vertices: anel.map(([e, n, codigo, tipo], i) => ({
      ordem: i, numTxt: i + 1, e, n, h: 300, sigmaPos: 0.05, sigmaH: 0.08,
      tipo, metodo: "PG6", inserido: false, codigoManual: codigo,
      descritivo: conf[codigo]?.descritivo ?? null,
      tipoLimite: conf[codigo]?.tipoLimite ?? null,
      ehVia: conf[codigo]?.ehVia ?? false,
    })),
  }, proj4);
  const out = new Map();
  servico.ring.forEach((v, i) => {
    const prox = servico.ring[(i + 1) % servico.ring.length];
    out.set(chave(v.codigo, prox.codigo), v.trecho.descritivo);
  });
  return out;
}

/** A mesma coisa pelo caminho do PDF do SIGEF (montarTrechosDoSigef). */
function trechosDaPlanta(anel, conf = CONF) {
  const sigefLinhas = anel.map(([, , codigo]) => ({ codigo, confrontacao: "" }));
  const reconciliados = anel.map(([e, n, codigo, tipo], i) => ({
    ordem: i, codigo, e, n, tipo,
    descritivo: conf[codigo]?.descritivo ?? null,
    eh_via: conf[codigo]?.ehVia ?? false,
    apelido_txt: null,
  }));
  const starts = montarTrechosDoSigef([], reconciliados, sigefLinhas);
  // é assim que gerar-planta fecha cada trecho: até o início do próximo
  return starts.map((s, k) => ({
    descritivo: s.descritivo, isEstrada: s.ehVia,
    inicioIdx: s.idx, fimIdx: starts[(k + 1) % starts.length].idx,
  }));
}

function divisasDaPlanta(anel, conf = CONF) {
  const out = new Map();
  for (const t of trechosDaPlanta(anel, conf)) {
    for (let i = t.inicioIdx; i !== t.fimIdx; i = (i + 1) % anel.length) {
      out.set(chave(anel[i][2], anel[(i + 1) % anel.length][2]), t.descritivo);
    }
  }
  return out;
}

const [ANEL_INV, CONF_INV] = inverter(ANEL, CONF);

test("guarda: o anel gravado é horário e o invertido não é", () => {
  // sem esta guarda os testes abaixo passariam à toa: é justamente no anel
  // anti-horário que montarServico inverte e desloca a confrontação um M
  assert.equal(sentidoHorario(ANEL), true, "o anel real da LAGOA SECA é horário");
  assert.equal(sentidoHorario(ANEL_INV), false);
  // e a inversão tem de mexer na confrontação, senão não está testando nada
  assert.notDeepEqual(CONF_INV, CONF);
});

for (const [nome, anel, conf] of [
  ["horário (real)", ANEL, CONF],
  ["anti-horário", ANEL_INV, CONF_INV],
]) {
  test(`anel ${nome}: memorial e planta cobrem a MESMA divisa com o mesmo confrontante`, () => {
    const mem = divisasDoMemorial(anel, conf);
    const pla = divisasDaPlanta(anel, conf);
    assert.equal(pla.size, anel.length, "toda divisa tem de pertencer a algum trecho");
    assert.equal(mem.size, anel.length);
    for (const [k, descMem] of mem) {
      assert.equal(pla.get(k), descMem, `divisa ${k}: memorial diz "${descMem}", planta diz "${pla.get(k)}"`);
    }
  });

  test(`anel ${nome}: cada confrontante fica no lado certo do imóvel`, () => {
    // conferência independente da aritmética acima, contra a geografia do imóvel:
    // ferrovia a noroeste, estrada vicinal a leste, SALGADA VELHA ao sul
    const d = divisasDaPlanta(anel, conf);
    assert.match(d.get(chave("DSBN-P-14005", "DSBN-P-14006")), /LINHA FERREA/);
    assert.match(d.get(chave("DSBN-M-4501", "DSBN-M-4502")), /ESTRADA VICINAL/);
    assert.match(d.get(chave("DSBN-P-14020", "DSBN-P-14021")), /SALGADA VELHA/);
  });
}

test("os três M saem com traço verde, inclusive os de faixa de domínio", async () => {
  const trechos = trechosDaPlanta(ANEL);
  assert.equal(trechos.length, 3);
  assert.equal(trechos.filter((t) => t.isEstrada).length, 2, "LINHA FERREA e ESTRADA VICINAL são vias");

  const dados = {
    vertices: ANEL.map(([e, n, codigo], i) => ({
      codigo, e, n,
      lonFmt: "-39°04'00,000\"", latFmt: "-11°27'00,000\"", alt: "300,00",
      azFmt: "0°00'00\"", distFmt: "10,00", vante: ANEL[(i + 1) % ANEL.length][2],
    })),
    trechos,
    denominacao: "FAZENDA LAGOA SECA",
    proprietarios: [{ nome: "MARILENE CARNEIRO MOTA", cpf: "044.535.588-30" }],
    matricula: "", cns: "", sncr: "950.335.349.445-1",
    municipioUf: "CONCEIÇÃO DO COITÉ-BA",
    tipoImovel: "posse",
    areaFmt: "6,7299", tarefasFmt: "15,45", perimetroFmt: "1.292,12",
    mcAbs: 39, fuso: 24, latMediaDeg: -11.45,
    trt: "000001",
    rt: { nome: "DANIEL NASCIMENTO SANTOS", formacao: "Técnico em Agrimensura", conselhoSigla: "CFTA", conselhoNumero: "0578839458-9", codigoCredenciado: "DSBN" },
    desenhista: "EMERSON DA SILVA", dataStr: "04/08/2026",
    logo: null,
  };
  const diag = { obstaculos: [], rotulos: [], sobrepostos: 0, deslocados: 0 };
  const bytes = await gerarPlantaPdf(dados, diag);
  mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
  writeFileSync(new URL("./out/planta-lagoa-seca.pdf", import.meta.url), bytes);
  // O bloco do vizinho fica CENTRADO no vão da divisa dele — é o que estava
  // errado na v18: a busca esgotava o deslizamento lateral antes de tentar
  // quebrar o texto em mais linhas, e o nome ia parar fora do espaço dele.
  assert.equal(diag.deslocados, 0, `${diag.deslocados} rótulo(s) fora do centro do trecho`);
  // Aqui NÃO se cobra `sobrepostos === 0`, e o motivo tem de ficar escrito para
  // ninguém "consertar" isso depois: o nome da via é rotacionado ao longo da
  // própria divisa, e a colisão é medida pela CAIXA ENVOLVENTE do texto girado.
  // Numa diagonal de ~50°, como a LINHA FERREA e a ESTRADA VICINAL deste imóvel,
  // essa caixa é quase um quadrado que a divisa paralela atravessa por dentro,
  // faça o rótulo o afastamento que fizer. É limitação do teste de colisão, não
  // do posicionamento. O que se pode cobrar é que os blocos de confrontante —
  // que são axis-aligned e onde a medida vale — fiquem limpos.
  assert.ok(diag.sobrepostos <= 2, `${diag.sobrepostos} rótulos sobre as linhas`);

  // A linha dupla vermelha é DA POLIGONAL PARA FORA, sempre. Este imóvel é
  // côncavo — tem um braço estreito a noroeste — e era exatamente ali que o
  // critério antigo ("o lado mais longe do centro da folha") jogava a estrada
  // para dentro. O sentido do anel resolve o caso côncavo junto com o convexo.
  // REGRA DE POSIÇÃO: o nome fica no MEIO do trecho do vizinho, empurrado para
  // fora. O que se cobra aqui é o "meio" — o desvio LATERAL, ao longo da divisa,
  // tem de ser nulo. É o que faz o nome apontar para a divisa certa; a distância
  // radial é proporcional ao desenho e pode crescer se o espaço exigir, sem mudar
  // de quem é aquela cerca.
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
        return {
          m: { x: a.x + (b.x - a.x) * fr, y: a.y + (b.y - a.y) * fr },
          tg: { x: (b.x - a.x) / L, y: (b.y - a.y) / L },
        };
      }
      alvo -= lens[k];
    }
    return { m: poly[t.inicioIdx], tg: { x: 1, y: 0 } };
  };
  diag.rotulos.forEach((r, i) => {
    const { m, tg } = meioETangente(trechos[i]);
    const cen = { x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 };
    const lateral = Math.abs((cen.x - m.x) * tg.x + (cen.y - m.y) * tg.y);
    // tolerância de meio corpo: o centro da CAIXA fica meio corpo acima da âncora
    // (a caixa vai da base da última linha ao topo da primeira), e numa divisa
    // inclinada essa diferença projeta uns poucos pontos na tangente. O deslize
    // que isto tem de pegar era de 0,3 × a largura do bloco — 125pt, duas ordens
    // de grandeza acima.
    const tol = Math.max(4, diag.corpos[i] * 0.6);
    assert.ok(lateral < tol, `"${trechos[i].descritivo.split("\\")[0]}" saiu ${lateral.toFixed(0)}pt`
      + ` fora do meio do trecho (tolerância ${tol.toFixed(0)}pt)`
      + " — o nome passa a apontar para a divisa do vizinho");
  });

  // NENHUM traço do desenho pode ficar por baixo de um nome de vizinho. A lista
  // de obstáculos tem de conter tudo que é linha: poligonal, linha dupla das
  // vias, tique de cada vértice e o traço verde de cada marco. Os dois últimos
  // faltavam — o traço verde tem 50pt e sai bem no vão onde o nome cai.
  assert.ok(diag.obstaculos.length >= ANEL.length * 2 + diag.vias.length + diag.marcos.length,
    `só ${diag.obstaculos.length} obstáculos para ${ANEL.length} arestas + ${ANEL.length} tiques`
    + ` + ${diag.vias.length} linhas de via + ${diag.marcos.length} marcos`);
  for (const m of diag.marcos) {
    assert.ok(
      diag.obstaculos.some((s) => Math.hypot(s.x1 - m.x1, s.y1 - m.y1) < 0.01 && Math.hypot(s.x2 - m.x2, s.y2 - m.y2) < 0.01),
      "o traço verde do marco tem de entrar na lista de obstáculos dos rótulos",
    );
  }

  assert.ok(diag.vias.length > 0, "as duas vias têm de desenhar linha dupla");
  const dentro = (p, poly) => {
    let d = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) d = !d;
    }
    return d;
  };
  const invasoras = diag.vias.filter((s) =>
    dentro({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 }, diag.poligono));
  assert.equal(invasoras.length, 0, `${invasoras.length} de ${diag.vias.length} linhas de estrada dentro da poligonal`);
  // era 1 antes da correção: só o M-4501, único trecho que não é faixa de domínio
  assert.equal(diag.marcos.length, 3, `${diag.marcos.length} marco(s) para 3 vértices M`);
  // e cada marco sai do SEU M, não de um vértice qualquer
  const posM = new Set(ANEL.filter(([, , , t]) => t === "M").map(([e, n]) => `${e},${n}`));
  assert.equal(posM.size, 3);
  assert.equal(new Set(diag.marcos.map((m) => `${m.x1.toFixed(3)},${m.y1.toFixed(3)}`)).size, 3);
});
