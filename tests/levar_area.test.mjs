// Levar a área de um serviço para outro (Exportar ▾ → "Usar a área em outro
// serviço") e o "TXT do levantamento" (src/lib/exportar/levantamento.ts).
//
// O que se prova aqui:
//  • o TXT do levantamento volta pelo leitor como "Formato da equipe" (confiança
//    alta, sem IA), com os MESMOS pontos, na mesma ordem, com a altitude e as
//    duas precisões de cada vértice — o serviço novo não pede σ nem altitude;
//  • o vértice M volta como M com o nome do confrontante do lado seguinte, e a
//    confrontação lida de volta é a mesma de cada lado; M sem nome volta como
//    M sem nome ("V"); os demais voltam sem rótulo (P);
//  • partes (IBERA) voltam como partes: blocos de centena;
//  • vértice sem altitude/σ sai com a célula vazia e a leitura pede só isso
//    (sem_altura/sem_precisao), que a prévia completa com a configuração do GPS;
//  • rótulo com ";" ou "/" não quebra a coluna nem corta o confrontante;
//  • o canal área_transferida leva o arquivo junto (e a área continua lida pelo CAR).
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4 from "proj4";
import { exportarArea, FORMATOS_AREA, nomeDoArquivo } from "../src/lib/exportar/index.ts";
import { prepararCamadas } from "../src/lib/exportar/coordenadas.ts";
import { camadasDoGeo } from "../src/lib/exportar/geo.ts";
import { gerarTxtLevantamento, rotuloLevantamento } from "../src/lib/exportar/levantamento.ts";
import { lerLinhas, executarReceita } from "../supabase/functions/_shared/leitor/index.ts";
import { ANEL } from "./fixtures/salgada_velha.mjs";
import fs from "node:fs";
import { camadasDoCar, fusoDoCar } from "../src/lib/exportar/car.ts";
import { lerKml } from "../src/lib/car/kml.ts";
import { projetoNovo as projetoCar } from "../src/lib/car/motor.ts";
import { VERTICES as VERTICES_IBERA, GLEBAS as GLEBAS_IBERA } from "./fixtures/ibera.mjs";

const op = { proj4: (a, b, c) => proj4(a, b, c) };
const dec = (u8) => new TextDecoder().decode(u8);

/** As linhas de `vertices` da SALGADA VELHA como vêm do banco, com h e σ de cada vértice. */
const linhasSalgada = (extra = () => ({})) => ANEL.map(([ordem, e, n, tipo, codigo, descritivo], i) => ({
  ordem, num_txt: ordem + 1, e, n, h: 360 + i / 10, tipo, codigo, descritivo: descritivo || null, apelido_txt: null,
  codigo_provisorio: false, inserido_manual: false, lat_gms: "", lon_gms: "",
  sigma_pos: 0.012 + i / 1000, sigma_h: 0.021 + i / 1000, ...extra(i),
}));

async function txtDe(linhas, glebas = [], fuso = 24) {
  const camadas = camadasDoGeo(linhas, glebas, fuso, { nome: "FAZENDA SALGADA VELHA" });
  const arq = await exportarArea(camadas, "levantamento", { fuso, nome: "FAZENDA SALGADA VELHA" });
  return { camadas, arq, texto: dec(arq.dados) };
}

test("menu: o TXT do levantamento vem logo depois do KML, com nome de arquivo próprio", () => {
  assert.deepEqual(FORMATOS_AREA.slice(0, 2).map((f) => f.id), ["kml", "levantamento"]);
  assert.equal(nomeDoArquivo("Fazenda Salgada Velha", "levantamento", 24), "FAZENDA_SALGADA_VELHA_LEVANTAMENTO_SIRGAS2000_UTM24S.txt");
  assert.notEqual(nomeDoArquivo("X", "levantamento", 24), nomeDoArquivo("X", "txt", 24));
});

test("ida e volta: o leitor reconhece como formato da equipe e lê pontos, altitude e σ iguais", async () => {
  const { texto, camadas } = await txtDe(linhasSalgada());
  const linhas = texto.split(/\r?\n/).filter(Boolean);
  assert.equal(linhas.length, ANEL.length);
  const l = lerLinhas(texto.split(/\r?\n/), op);
  assert.ok(l, "o leitor não leu");
  assert.equal(l.receita.origem, "padrao", "tem de ser o formato da equipe (sem IA)");
  assert.equal(l.confianca, "alta");
  assert.ok(l.ok, `bloqueios: ${l.avisos.filter((a) => a.nivel === "bloqueio").map((a) => a.codigo)}`);
  assert.equal(l.anel.length, ANEL.length);
  assert.equal(l.blocos.length, 1);
  assert.ok(!l.avisos.some((a) => a.codigo === "sem_precisao" || a.codigo === "sem_altura"));

  // cada ponto do perímetro exportado (ordem do memorial) volta com a mesma coordenada, h e σ
  const perim = prepararCamadas(camadas, 24).find((c) => c.nome === "PERIMETRO").feicoes[0];
  const porCoord = new Map(linhasSalgada().map((v) => [`${Math.round(v.e)},${Math.round(v.n)}`, v]));
  perim.utm.forEach((u, i) => {
    const p = l.anel.find((x) => Math.abs(x.e - u[0]) < 0.0006 && Math.abs(x.n - u[1]) < 0.0006);
    assert.ok(p, `ponto ${i} não voltou`);
    const v = porCoord.get(`${Math.round(u[0])},${Math.round(u[1])}`);
    assert.ok(v, `vértice de origem ${i}`);
    assert.ok(Math.abs(p.h - v.h) < 0.0006, `h ${p.h} × ${v.h}`);
    assert.ok(Math.abs(p.sigmaPos - v.sigma_pos) < 0.0006 && Math.abs(p.sigmaH - v.sigma_h) < 0.0006, "σ");
  });
});

test("confrontantes: M volta como M com o nome do lado seguinte; M sem nome volta com 'V'; P sem rótulo", async () => {
  const { texto } = await txtDe(linhasSalgada());
  const linhas = texto.split(/\r\n/).filter(Boolean);
  const comRotulo = linhas.filter((s) => /^\d+ /.test(s)).map((s) => s.split(";")[0].replace(/^\d+ /, ""));
  // quatro M na SALGADA: dois com nome (ESTRADA VICINAL, LINHA FERREA) e dois que fecham a faixa
  assert.equal(comRotulo.length, ANEL.filter((a) => a[3] === "M").length);
  assert.ok(comRotulo.includes("ESTRADA VICINAL"));
  assert.ok(comRotulo.includes("LINHA FERREA"));
  // relido: o rótulo do ponto é o confrontante (o que vira trecho no parse-txt)
  const l = lerLinhas(texto.split(/\r?\n/), op);
  const rotulos = l.anel.map((p) => p.rotulo).filter(Boolean);
  assert.deepEqual([...rotulos].sort(), [...comRotulo].sort());

  // lado a lado: cada M abre o trecho até o próximo M (a regra do parse-txt); "V" = M sem nome
  const n = l.anel.length;
  const ms = l.anel.map((p, i) => (p.rotulo ? i : -1)).filter((i) => i >= 0);
  let atual = l.anel[ms[ms.length - 1]].rotulo;
  const relido = new Map();
  const k = (a, b) => [a, b].map((p) => `${Math.round(p.e * 1000)},${Math.round(p.n * 1000)}`).sort().join("|");
  l.anel.forEach((p, i) => {
    if (p.rotulo) atual = p.rotulo;
    relido.set(k(p, l.anel[(i + 1) % n]), atual === "V" ? null : atual);
  });
  const perim = prepararCamadas(camadasDoGeo(linhasSalgada(), [], 24), 24).find((c) => c.nome === "PERIMETRO").feicoes[0];
  let conferidos = 0;
  perim.utm.forEach((u, i) => {
    const w = perim.utm[(i + 1) % perim.utm.length];
    const chave = k({ e: u[0], n: u[1] }, { e: w[0], n: w[1] });
    assert.ok(relido.has(chave), `lado ${i} sumiu`);
    assert.equal(relido.get(chave), perim.confrontantes[i] ?? null, `lado ${i}`);
    conferidos++;
  });
  assert.equal(conferidos, ANEL.length);
});

test("partes (IBERA): cada parte num bloco de centena, e o leitor devolve as mesmas partes", async () => {
  const linhas = VERTICES_IBERA.map(([ordem, num, tipo, e, n]) => ({ ordem, num_txt: num, e, n, h: 500, tipo, codigo: null, sigma_pos: 0.02, sigma_h: 0.03 }));
  const camadas = camadasDoGeo(linhas, GLEBAS_IBERA, 24, { nome: "IBERA" });
  const partes = camadas.find((c) => c.nome === "PERIMETRO").feicoes.length;
  assert.ok(partes > 1, "a IBERA tem partes");
  const texto = dec((await exportarArea(camadas, "levantamento", { fuso: 24, nome: "IBERA" })).dados);
  const nums = texto.split(/\r\n/).filter(Boolean).map((s) => parseInt(s, 10));
  assert.equal(nums[0], 1);
  assert.ok(nums.some((n) => n % 100 === 0 && n >= 100), "a 2ª parte abre numa centena");
  const l = lerLinhas(texto.split(/\r?\n/), op);
  assert.ok(l.ok, `bloqueios: ${l.avisos.filter((a) => a.nivel === "bloqueio").map((a) => a.mensagem)}`);
  assert.equal(l.blocos.length, partes);
  assert.equal(l.anel.length, nums.length);
});

test("sem altitude e sem σ na origem: células vazias, e a leitura pede só isso — que a prévia completa", async () => {
  const { texto } = await txtDe(linhasSalgada(() => ({ h: null, sigma_pos: null, sigma_h: null })));
  const primeira = texto.split(/\r\n/)[0].split(";");
  assert.equal(primeira.length, 6);
  assert.deepEqual(primeira.slice(3), ["", "", ""]);
  const l = lerLinhas(texto.split(/\r?\n/), op);
  assert.equal(l.receita.origem, "padrao");
  const bloqueios = l.avisos.filter((a) => a.nivel === "bloqueio").map((a) => a.codigo).sort();
  assert.deepEqual(bloqueios, ["sem_altura", "sem_precisao"]);
  // a configuração do GPS (σ) + altitude pelo relevo: segue
  const alturaPadrao = Object.fromEntries(l.pontos.map((p) => [p.idx, 400]));
  const ok = executarReceita(texto.split(/\r?\n/), l.receita, { ...op, sigmaPadrao: { pos: 0.05, h: 0.08 }, alturaPadrao });
  assert.ok(ok.ok);
  assert.deepEqual(ok.aConfirmar, ["altura_estimada"]);
  assert.ok(ok.anel.every((p) => p.sigmaPos === 0.05 && p.sigmaH === 0.08 && p.h === 400));
});

test("rótulo: ';' e '/' não quebram a coluna nem cortam o confrontante; nome que começa com número continua inteiro", async () => {
  assert.equal(rotuloLevantamento("JOSÉ / MARIA; ESPÓLIO"), "JOSÉ - MARIA - ESPÓLIO");
  assert.equal(rotuloLevantamento("  "), "");
  const { texto } = await txtDe(linhasSalgada((i) => (ANEL[i][5] === "ESTRADA VICINAL" ? { descritivo: "123 AGRO LTDA / MATR. 45" } : {})));
  const l = lerLinhas(texto.split(/\r?\n/), op);
  assert.ok(l.ok);
  assert.ok(l.anel.some((p) => p.rotulo === "123 AGRO LTDA - MATR. 45"), l.anel.map((p) => p.rotulo).filter(Boolean).join(" | "));
});

test("CAR → serviço GEO: o perímetro do imóvel sai no fuso do meio, sem rótulo, e o leitor pede só σ e altitude", async () => {
  const kml = lerKml(fs.readFileSync(new URL("./fixtures/car/PLANTA.kml", import.meta.url), "utf8"));
  const pr = projetoCar("FAZENDA DEMO", kml.perimetro);
  const camadas = camadasDoCar(pr);
  const fuso = fusoDoCar(pr);
  const r = gerarTxtLevantamento(prepararCamadas(camadas, fuso));
  assert.equal(r.pontos, pr.perimetro.length);
  assert.equal(r.semAltura, r.pontos);
  assert.equal(r.semSigma, r.pontos);
  const l = lerLinhas(r.texto.split(/\r?\n/), op);
  assert.equal(l.receita.origem, "padrao");
  assert.equal(l.anel.length, pr.perimetro.length);
  assert.ok(l.anel.every((p) => !p.rotulo), "CAR não tem M: nenhum rótulo");
  assert.deepEqual(l.avisos.filter((a) => a.nivel === "bloqueio").map((a) => a.codigo).sort(), ["sem_altura", "sem_precisao"]);
});

test("gerarTxtLevantamento conta o que falta (a tela avisa antes de levar)", () => {
  const camadas = prepararCamadas(camadasDoGeo(linhasSalgada((i) => (i < 3 ? { h: null, sigma_pos: null } : {})), [], 24), 24);
  const r = gerarTxtLevantamento(camadas);
  assert.equal(r.pontos, ANEL.length);
  assert.equal(r.partes, 1);
  assert.equal(r.semAltura, 3);
  assert.equal(r.semSigma, 3);
});
