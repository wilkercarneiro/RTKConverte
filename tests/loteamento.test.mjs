// Loteamento: o motor que divide a gleba e os arquivos que saem dele.
//
// O que se prova aqui é o que erraria calado numa planta: área de lote que não
// soma, vizinho que não se ajusta quando um lote é travado, faixa de APP que
// vira lote, nome de ponto da locação que não bate com o do memorial, e a
// conversão do plano de terreno de volta para UTM.
import { test } from "node:test";
import assert from "node:assert/strict";
import { perimetro } from "./fixtures/loteamento_gleba.mjs";
import { projetoNovo } from "../src/lib/loteamento/modelo.ts";
import { calcular, viarioDe } from "../src/lib/loteamento/calculo.ts";
import { gerarPropostas } from "../src/lib/loteamento/auto.ts";
import { ajustarLote, executar, moverCorte } from "../src/lib/loteamento/acoes.ts";
import { criarPlano, paraPlano, paraUtm } from "../src/lib/loteamento/plano.ts";
import { areaPol, areaPols, diferenca, uniao } from "../src/lib/loteamento/geom.ts";
import {
  arquivoLocacao, chavePonto, gerarDxf, gerarKml, ladosNominais, memorialDoLote, nomesDosPontos, pontosDeLocacao,
} from "../src/lib/loteamento/saidas.ts";

function base() {
  const pr = projetoNovo("TESTE", perimetro.pts.length);
  pr.bordas[0] = { tipo: "via", faixa: 0, nome: "Estrada BA-001" };
  return pr;
}

// a proposta automática é o ponto de partida de quase todos os testes
const proposta = gerarPropostas(base(), perimetro, { quantas: 1 })[0];
const pr0 = proposta.projeto;
const r0 = calcular(pr0, perimetro);

test("proposta automática: lotes válidos e nenhuma pendência de lote", () => {
  assert.ok(r0.lotes.length > 150, `só ${r0.lotes.length} lotes`);
  assert.equal(r0.problemas.filter((p) => p.nivel === "erro").length, 0);
  for (const l of r0.lotes) {
    assert.ok(l.area >= 125 - 0.01, `${l.id} com ${l.area}`);
    assert.ok(l.frente >= 5 - 0.01, `${l.id} com frente ${l.frente}`);
  }
});

test("quadro de áreas fecha na área da gleba", () => {
  const q = r0.quadro;
  const soma = q.lotes.area + q.viario + q.verde + q.institucional + q.lazer + q.app + q.sobras;
  assert.ok(Math.abs(soma - q.gleba) < 0.5, `soma ${soma} × gleba ${q.gleba}`);
  // e o viário por diferença confere com o polígono do viário
  assert.ok(Math.abs(areaPols(viarioDe(r0)) - q.viario) < 1, "viário geométrico diverge do aritmético");
  // metas de áreas públicas cumpridas pela reserva automática
  assert.ok((100 * (q.verde + q.lazer)) / q.gleba >= pr0.params.pctVerdeMin - 0.01);
  assert.ok((100 * q.institucional) / q.gleba >= pr0.params.pctInstitucionalMin - 0.01);
});

test("lotes não se sobrepõem e ficam dentro da gleba", () => {
  const todos = uniao(r0.lotes.map((l) => l.pol));
  assert.ok(Math.abs(areaPols(todos) - r0.quadro.lotes.area) < 0.5, "lotes sobrepostos");
  assert.ok(areaPols(diferenca(todos, [r0.gleba])) < 0.01, "lote fora da gleba");
});

test("lote padrão 10 × 25 sai com 250,00 m² exatos", () => {
  // lotes retangulares de 10 m de frente e 25 m de lado (quadras de fundo raso têm lote menor)
  const meio = r0.lotes.filter((l) => l.lados.length === 4 && l.lados.every((x) => Math.abs(x.comp - 10) < 0.01 || Math.abs(x.comp - 25) < 0.01));
  assert.ok(meio.length > 50);
  for (const l of meio) assert.ok(Math.abs(l.area - 250) < 0.01, `${l.id}: ${l.area}`);
});

test("travar a frente de um lote: a fileira se reorganiza e o comprimento se conserva", () => {
  const q = [...r0.quadras].filter((x) => x.fileiras === 2).sort((a, b) => b.lotes.length - a.lotes.length)[0];
  const fil = (r, nome) => r.quadras.find((x) => x.nome === nome).lotes.filter((l) => l.fileira === 0).sort((a, b) => a.indice - b.indice);
  const antes = fil(r0, q.nome);
  const alvo = antes[4];
  const pr = ajustarLote(pr0, r0, alvo, { frente: 15 });
  const r = calcular(pr, perimetro);
  const depois = fil(r, q.nome);
  const travado = depois.find((l) => l.indice === alvo.indice);
  assert.ok(Math.abs(travado.frente - 15) < 0.01, `frente ${travado.frente}`);
  assert.ok(travado.ajustado);
  const soma = (ls) => ls.reduce((s, l) => s + l.area, 0);
  assert.ok(Math.abs(soma(antes) - soma(depois)) < 0.5, "a fileira perdeu área");
  assert.equal(depois.length, antes.length - 1, "um lote de 10 m a menos (sobra foi para as esquinas)");
});

test("arrastar a divisa trava a frente do lote de trás dela", () => {
  const q = r0.quadras.find((x) => x.cortes.some((c) => c.arrastavel && c.fileira === 0));
  const c = q.cortes.find((x) => x.arrastavel && x.fileira === 0 && x.indice === 3);
  const p = [c.a[0] + c.dir[0] * 2, c.a[1] + c.dir[1] * 2]; // 2 m adiante
  const pr = moverCorte(pr0, r0, c, p);
  const r = calcular(pr, perimetro);
  const l = r.quadras.find((x) => x.nome === q.nome).lotes.find((x) => x.fileira === 0 && x.indice === 3);
  assert.ok(Math.abs(l.travaFrente - (c.s - c.s0 + 2)) < 0.02);
});

test("comandos: unir, dividir e virar área verde", () => {
  const l = r0.lotes.find((x) => !x.esquina && x.quadra === r0.quadras[1].nome);
  const sel = { tipo: "lotes", chaves: [{ quadra: l.quadra, fileira: l.fileira, indice: l.indice }] };
  const unir = executar("unir", pr0, r0, sel);
  const ru = calcular(unir.pr, perimetro);
  assert.equal(ru.lotes.length, r0.lotes.length - 1);
  const div = executar("dividir 2", pr0, r0, sel);
  const rd = calcular(div.pr, perimetro);
  assert.equal(rd.lotes.length, r0.lotes.length + 1);
  const verde = executar("verde", pr0, r0, sel);
  const rv = calcular(verde.pr, perimetro);
  assert.equal(rv.lotes.length, r0.lotes.length - 1);
  assert.ok(Math.abs(rv.quadro.verde - r0.quadro.verde - l.area) < 0.5);
  assert.match(executar("frentee 3", pr0, r0, sel).msg, /Não conheço/);
});

test("largura da rua: mudar a largura refaz quadras e lotes", () => {
  const s = executar("largura 16", pr0, r0, null);
  const r = calcular(s.pr, perimetro);
  assert.ok(r.quadro.viario > r0.quadro.viario + 1000);
  assert.ok(r.quadro.lotes.area < r0.quadro.lotes.area);
});

test("faixa de APP ao longo de um lado não vira lote", () => {
  const pr = { ...pr0, bordas: pr0.bordas.map((b, i) => (i === 2 ? { tipo: "rio", faixa: 30, nome: "Córrego" } : b)) };
  const r = calcular(pr, perimetro);
  assert.ok(r.quadro.app > 2000, `APP ${r.quadro.app}`);
  const app = r.areas.filter((a) => a.tipo === "app").flatMap((a) => a.pols);
  for (const l of r.lotes) assert.ok(areaPols(diferenca([l.pol], app)) > l.area - 0.01, `${l.id} invade a APP`);
});

test("plano de terreno: ida e volta para UTM é exata e o fator é plausível", () => {
  const pl = criarPlano(perimetro.pts, perimetro.altitudes, true);
  assert.ok(pl.k > 0.9990 && pl.k < 1.0010, `k = ${pl.k}`);
  for (const p of perimetro.pts) {
    const v = paraUtm(pl, paraPlano(pl, p));
    assert.ok(Math.hypot(v[0] - p[0], v[1] - p[1]) < 1e-6);
  }
  // distância de terreno = distância UTM / k
  const a = perimetro.pts[0], b = perimetro.pts[1];
  const dUtm = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const pa = paraPlano(pl, a), pb = paraPlano(pl, b);
  assert.ok(Math.abs(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) - dUtm / pl.k) < 1e-6);
});

test("locação: nomes únicos e curtos, coordenadas iguais às do desenho", () => {
  const pts = pontosDeLocacao(r0, perimetro);
  const nomes = pts.map((p) => p.nome);
  assert.equal(new Set(nomes).size, nomes.length, "nome de ponto repetido");
  for (const n of nomes) assert.match(n, /^[A-Z0-9\-_.]{1,16}$/);
  // todo canto de lote (fora os intermediários dos arcos) está na locação
  const k = new Set(pts.map((p) => chavePonto(p.p)));
  const l = r0.lotes[10];
  const intermed = new Set(r0.quadras.flatMap((q) => q.curvas.flatMap((c) => c.intermediarios.map(chavePonto))));
  for (const v of l.pol.ext) if (!intermed.has(chavePonto(v))) assert.ok(k.has(chavePonto(v)), `vértice do ${l.id} fora da locação`);
  // UTM do arquivo = plano × k + centro
  const p = pts[0];
  const u = paraUtm(r0.plano, p.p);
  assert.ok(Math.abs(u[0] - p.e) < 1e-6 && Math.abs(u[1] - p.n) < 1e-6);
  const csv = arquivoLocacao(pts, "csv-nome-e-n").split("\r\n");
  assert.equal(csv[0], "Name,Easting,Northing,Elevation,Code");
  assert.equal(csv[1].split(",").length, 5);
  assert.ok(!/[áéíóúãõç]/i.test(csv.join("")), "acento no arquivo da coletora");
});

test("memorial do lote usa os mesmos nomes de vértice da locação e fecha o perímetro", () => {
  const pts = pontosDeLocacao(r0, perimetro);
  const nomes = nomesDosPontos(pts);
  const l = r0.lotes.find((x) => !x.esquina && x.lados.length === 4);
  const m = memorialDoLote(l, r0, nomes, { loteamento: "TESTE", municipio: "X", uf: "BA", proprietario: "", fuso: 24 });
  const desc = m.paragrafos.find((p) => p.startsWith("Descrição"));
  const citados = [...desc.matchAll(/vértice ([A-Z]+-\d+)/g)].map((x) => x[1]);
  assert.equal(citados[0], citados[citados.length - 1], "não volta ao vértice inicial");
  for (const c of citados) assert.ok(pts.some((p) => p.nome === c), `${c} não existe na locação`);
  const g = ladosNominais(l);
  assert.ok(g.frente.length && g.fundos.length && g.direito.length && g.esquerdo.length);
});

test("DXF e KML bem formados", () => {
  const dxf = gerarDxf(r0, pontosDeLocacao(r0, perimetro));
  assert.ok(dxf.trimEnd().endsWith("EOF"));
  assert.equal((dxf.match(/\r\nPOLYLINE\r\n/g) ?? []).length >= r0.lotes.length, true);
  const kml = gerarKml(r0, 24, "Teste & cia");
  assert.ok(kml.includes("Teste &amp; cia"));
  assert.equal((kml.match(/<Placemark>/g) ?? []).length, r0.lotes.length + r0.publicas.length + r0.ruas.length + 1);
});

test("rua passando sobre um vértice da gleba não gruda duas quadras", () => {
  for (const q of r0.quadras) {
    // anel simples: nenhum vértice repetido
    const vistos = new Set();
    for (const p of q.pol.ext) {
      const k = chavePonto(p);
      assert.ok(!vistos.has(k), `quadra ${q.nome} beliscada em ${k}`);
      vistos.add(k);
    }
  }
});

test("área da gleba no plano de terreno ≈ área UTM / k²", () => {
  const pr = { ...pr0, params: { ...pr0.params, distanciasTerreno: false } };
  const rUtm = calcular(pr, perimetro);
  const k = r0.plano.k;
  assert.ok(Math.abs(areaPol(r0.gleba) - areaPol(rUtm.gleba) / (k * k)) < 0.01);
});

test("modalidade loteamento: cartão e chip", async () => {
  const { chaveDoServico, definicaoDe, vaiAoSigef } = await import("../src/lib/modalidades.ts");
  const s = { tipo: "geo", modalidade: "loteamento", tem_glebas: false };
  assert.equal(chaveDoServico(s), "loteamento");
  assert.equal(definicaoDe("loteamento").campos.modalidade, "loteamento");
  assert.equal(vaiAoSigef(s), false);
});

// ---------------------------------------------------------------------------
// Regras pedidas na revisão (2026-10-23): acesso, fundos alinhados,
// proporção nas pontas e área verde na terra menos valorizada
// ---------------------------------------------------------------------------

const dSeg = (p, a, b) => {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
};

test("rua só chega ao perímetro pela estrada de acesso", () => {
  for (const ru of r0.ruas) {
    for (const ponta of [ru.eixo[0], ru.eixo[ru.eixo.length - 1]]) {
      const perto = r0.ladosGleba.map((l, i) => ({ i, d: dSeg(ponta, l.a, l.b), l })).sort((a, b) => a.d - b.d)[0];
      if (perto.d > ru.largura / 2 + 1) continue; // termina dentro, num cruzamento
      assert.equal(perto.l.tipo, "via", `${ru.nome} termina no lado ${perto.i + 1} (${perto.l.tipo})`);
    }
  }
  assert.equal(r0.problemas.filter((p) => /sem acesso|não chega/.test(p.texto)).length, 0);
});

test("rua desenhada contra a divisa vira aviso", () => {
  const a = perimetro.pts[3], b = perimetro.pts[4];
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const c = [(perimetro.pts[0][0] + perimetro.pts[3][0]) / 2, (perimetro.pts[0][1] + perimetro.pts[3][1]) / 2];
  const pr = { ...pr0, ruas: [...pr0.ruas, { id: "mteste", nome: "Rua Teste", largura: 12, eixo: [c, m] }] };
  const r = calcular(pr, perimetro);
  assert.ok(r.problemas.some((p) => p.texto.startsWith("Rua Teste termina no lado 4")), "faltou o aviso de rua sem acesso");
});

test("quadra de duas fileiras: lotes fundo com fundo alinhados", () => {
  // no miolo da quadra as divisas laterais das duas fileiras se encontram na
  // linha de fundo; nas pontas (ângulo de rua, divisa torta) os lotes podem
  // ser redistribuídos para não ficarem desproporcionais
  let conferidas = 0;
  for (const q of r0.quadras.filter((x) => x.fileiras === 2 && x.fundo)) {
    const L = Math.hypot(q.fundo.b[0] - q.fundo.a[0], q.fundo.b[1] - q.fundo.a[1]);
    const s = (p) => ((p[0] - q.fundo.a[0]) * (q.fundo.b[0] - q.fundo.a[0]) + (p[1] - q.fundo.a[1]) * (q.fundo.b[1] - q.fundo.a[1])) / L;
    const miolo = (p) => s(p) > 3.5 * pr0.params.frente && s(p) < L - 3.5 * pr0.params.frente;
    const naLinha = (fil) => new Set(q.lotes.filter((l) => l.fileira === fil).flatMap((l) => l.pol.ext)
      .filter((p) => dSeg(p, q.fundo.a, q.fundo.b) < 0.02 && miolo(p)).map((p) => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`));
    const a = naLinha(0), b = naLinha(1);
    if (!a.size || !b.size) continue;
    const comuns = [...a].filter((k) => b.has(k)).length;
    assert.equal(comuns, Math.max(a.size, b.size), `quadra ${q.nome}: ${comuns} de ${Math.max(a.size, b.size)} divisas se encontram no fundo`);
    conferidas++;
  }
  assert.ok(conferidas >= 3);
});

test("fileira com divisa torta: pontas proporcionais, sem lote nanico nem gigante", () => {
  // quadra de uma fileira só com fundo inclinado
  for (const q of r0.quadras) {
    for (const fil of [0, 1]) {
      const ls = q.lotes.filter((l) => l.fileira === fil);
      if (ls.length < 4) continue;
      const areas = ls.map((l) => l.area).sort((a, b) => a - b);
      const med = areas[Math.floor(areas.length / 2)];
      for (const l of ls) assert.ok(l.area < 2.6 * med, `${l.id} com ${l.area.toFixed(0)} m² numa fileira de ${med.toFixed(0)}`);
    }
  }
});

test("área verde: nunca na frente da estrada, e vai para a baixada", async () => {
  const { valorDosLotes } = await import("../src/lib/loteamento/auto.ts");
  const base0 = base();
  // relevo: cai forte para o leste (e > 491300)
  const E0 = 490900, N0 = 8738700, passo = 10, nx = 62, ny = 45, h = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const e = E0 + i * passo;
    h.push(330 - 0.02 * (e - 491000) - (e > 491300 ? (e - 491300) * 0.12 : 0));
  }
  base0.terreno = { e0: E0, n0: N0, passo, nx, ny, h, fonte: "dem", calibracao: 0 };
  const prop = gerarPropostas(base0, perimetro, { quantas: 1 })[0];
  const r = prop.resultado;
  const via = r.ladosGleba[0];
  // nenhuma área verde com lado sobre a estrada
  for (const a of r.areas.filter((x) => x.tipo === "verde")) {
    for (const pol of a.pols) {
      const e = pol.ext;
      for (let i = 0; i < e.length; i++) {
        const p = e[i], q = e[(i + 1) % e.length];
        const sobre = dSeg(p, via.a, via.b) < 0.3 && dSeg(q, via.a, via.b) < 0.3 && Math.hypot(q[0] - p[0], q[1] - p[1]) > 1;
        assert.ok(!sobre, `área verde ${a.nome} encosta na estrada`);
      }
    }
  }
  // lote de frente para a estrada vale "infinito" (não entra na escolha)
  const valor = valorDosLotes(r, prop.projeto, perimetro);
  for (const l of r.lotes.filter((x) => x.lados.some((s) => s.tipo === "via"))) assert.equal(valor.get(l.id), Infinity);
  // a verde (fora os retalhos de canto) fica mais baixa que a média dos lotes
  const { cotaEm } = await import("../src/lib/loteamento/terreno.ts");
  const { centroide } = await import("../src/lib/loteamento/geom.ts");
  const cota = (p) => cotaEm(base0.terreno, paraUtm(r.plano, p));
  const mediaLotes = r.lotes.reduce((s, l) => s + cota(centroide(l.pol.ext)), 0) / r.lotes.length;
  const verdes = r.publicas.filter((a) => a.tipo === "verde").sort((a, b) => b.area - a.area);
  assert.ok(cota(centroide(verdes[0].pol.ext)) < mediaLotes, "a maior área verde não está na parte baixa");
  assert.ok((100 * (r.quadro.verde + r.quadro.lazer)) / r.quadro.gleba >= 10 - 0.01);
});
