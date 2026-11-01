// Leitor universal — peças isoladas.
import { test } from "node:test";
import assert from "node:assert/strict";
import proj4 from "proj4";
import { lerAngulo, lerNumero } from "../supabase/functions/_shared/leitor/numeros.ts";
import { abrir, decodificar, separarLinhas } from "../supabase/functions/_shared/leitor/abertura.ts";
import { receitaPadrao, regexPerigosa, validarReceita, esquemaJsonReceita } from "../supabase/functions/_shared/leitor/receita.ts";
import { dividirDelimitado, mapearTabela, tabelaDeLinhas } from "../supabase/functions/_shared/leitor/executor.ts";
import { blocosPorCentena, cruzamentos, mesmoCiclo } from "../supabase/functions/_shared/leitor/ordem.ts";
import { executarReceita, lerLinhas } from "../supabase/functions/_shared/leitor/index.ts";
import { assinatura } from "../supabase/functions/_shared/leitor/assinatura.ts";
import { papelDoCabecalho } from "../supabase/functions/_shared/leitor/detector.ts";
import { sugerirTrechos } from "../supabase/functions/_shared/servico.ts";
import { validar } from "../supabase/functions/_shared/leitor/validador.ts";

const op = { proj4 };

// ---------------------------------------------------------------- números
test("números: decimal vírgula com milhar, ponto, científico, unidade colada", () => {
  assert.equal(lerNumero("8.658.085,635", ","), 8658085.635);
  assert.equal(lerNumero("491199,572", ","), 491199.572);
  assert.equal(lerNumero("497318.611", "."), 497318.611);
  assert.equal(lerNumero("8,658,085.635", "."), 8658085.635);
  assert.equal(lerNumero("1.2E-03", "."), 0.0012);
  assert.equal(lerNumero("497318.611m", "."), 497318.611);
  assert.equal(lerNumero(" \"240.944\" ", "."), 240.944);
  assert.equal(lerNumero("", "."), null);
  // com o decimal errado a leitura FALHA (não vira outro número)
  assert.equal(lerNumero("491199,572", "."), null);
  assert.equal(lerNumero("497318.611", ","), null);
  assert.equal(lerNumero("12abc", "."), null);
});

test("ângulos: decimal, GMS com símbolos/espaços/dois-pontos, letras de hemisfério", () => {
  const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);
  perto(lerAngulo("-15.553038", "lat").graus, -15.553038);
  perto(lerAngulo("15,553038 S", "lat", ",").graus, -15.553038);
  perto(lerAngulo("15°33'18,938\"S", "lat").graus, -(15 + 33 / 60 + 18.938 / 3600));
  perto(lerAngulo("S 15°33'18.938\"", "lat").graus, -(15 + 33 / 60 + 18.938 / 3600));
  perto(lerAngulo("-15 33 18.9380", "lat").graus, -(15 + 33 / 60 + 18.938 / 3600));
  perto(lerAngulo("39:05:04.737W", "lon").graus, -(39 + 5 / 60 + 4.737 / 3600));
  perto(lerAngulo("39:05:04.737O", "lon").graus, -(39 + 5 / 60 + 4.737 / 3600));
  perto(lerAngulo("15d33m18.9s", "lat").graus, 15 + 33 / 60 + 18.9 / 3600);
  assert.equal(lerAngulo("15d33m18.9s", "lat").hemisferioExplicito, false);
  assert.equal(lerAngulo("15°33'18.9\"N", "lon"), null, "N não é letra de longitude");
  assert.equal(lerAngulo("15°75'00\"", "lat"), null, "minuto ≥ 60");
  assert.equal(lerAngulo("123.5", "lat"), null, "latitude > 90");
});

// ---------------------------------------------------------------- abertura
test("abertura: UTF-8 com BOM, UTF-16 com e sem BOM, Windows-1252, CR sozinho", () => {
  const t = "1;Estação José;491199,572;8738840,077\r\n";
  assert.equal(decodificar(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(t)])).texto, t);
  const u16 = new Uint8Array([0xff, 0xfe, ...[...t].flatMap((c) => [c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8])]);
  assert.equal(decodificar(u16).texto, t);
  const u16sem = u16.slice(2);
  assert.equal(decodificar(u16sem).codificacao, "utf-16le");
  assert.equal(decodificar(u16sem).texto, t);
  const cp1252 = new Uint8Array([...t].map((c) => c.charCodeAt(0)));
  const d = decodificar(cp1252);
  assert.equal(d.codificacao, "windows-1252");
  assert.equal(d.texto, t);
  assert.deepEqual(separarLinhas("a\rb\r\nc\n\n"), ["a", "b", "c"]);
});

test("abertura: binário de aparelho vira orientação de exportação, não erro mudo", () => {
  const bin = new Uint8Array(2000).map((_, i) => (i * 7) % 256);
  const a = abrir(bin, "levantamento.dbx");
  assert.equal(a.tipo, "binario");
  assert.match(a.binario.formato, /Leica/);
  assert.match(a.binario.orientacao, /Export/);
  assert.equal(abrir(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), "x.xlsx").tipo, "zip");
  assert.equal(abrir(new TextEncoder().encode("%PDF-1.7 ..."), "x.pdf").tipo, "pdf");
});

// ---------------------------------------------------------------- receita
test("receita não confiável: regex perigosa, coluna inválida e falta de coordenada são recusadas", () => {
  assert.ok(regexPerigosa("(a+)+$"));
  assert.ok(regexPerigosa("(\\w*)*x"));
  assert.ok(!regexPerigosa("^(?<nome>\\d+);(?<e>[\\d,]+);(?<n>[\\d,]+)$"));
  const base = receitaPadrao(";");
  assert.ok(validarReceita(base).receita);
  assert.match(validarReceita({ ...base, ignorar: ["(a+)+"] }).erros.join(), /recusada/);
  assert.match(validarReceita({ ...base, campos: { ...base.campos, e: -1 } }).erros.join(), /coluna inválida/);
  assert.match(validarReceita({ ...base, campos: { ...base.campos, e: null, n: null } }).erros.join(), /E e N/);
  assert.match(validarReceita({ ...base, tokenizacao: "regex", regex: "^(?<nome>\\d+)" }).erros.join(), /grupos/);
  assert.match(validarReceita({ ...base, fuso: 30 }).erros.join(), /fuso/);
  assert.equal(validarReceita(null).receita, null);
});

test("esquema JSON da receita é estrito (todas as chaves obrigatórias, sem extras)", () => {
  const s = esquemaJsonReceita();
  assert.equal(s.additionalProperties, false);
  assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
  assert.equal(s.properties.campos.additionalProperties, false);
  assert.deepEqual([...s.properties.campos.required].sort(), Object.keys(s.properties.campos.properties).sort());
});

// ---------------------------------------------------------------- executor
test("executor: aspas, rótulo com o separador dentro, E/N repetidos na linha", () => {
  assert.deepEqual(dividirDelimitado('1,"cerca, lado norte",2', ","), ["1", "cerca, lado norte", "2"]);
  const linhas = [
    "1roque/estrada,497318.611,8658085.635,240.944,0.004200,0.008400",
    "5ramon/faz,caguido,497336.251,8658085.250,240.891,0.005000,0.009000",
    "105V,497341.866,8658112.334,497341.866,8658112.334,240.582,0.00,0.00",
    "7,497348.493,8658144.070,240.363,0.004200,0.008000",
  ];
  const r = receitaPadrao(",");
  const ex = mapearTabela(tabelaDeLinhas(linhas, r), r, proj4);
  assert.equal(ex.pontos.length, 4);
  assert.equal(ex.pontos[1].rotulo, "ramon/faz,caguido");
  assert.equal(ex.pontos[2].num, 105);
  assert.equal(ex.pontos[2].rotulo, "V");
  assert.equal(ex.pontos[2].e, 497341.866);
  assert.ok(ex.avisos.some((a) => a.codigo === "coordenada_repetida_na_linha"));
  // números a mais que NÃO são repetição: a linha não é lida (nunca escolher calado)
  const ex2 = mapearTabela(tabelaDeLinhas(["9,111.1,222.2,497348.493,8658144.070,240.363,0.0042,0.0080"], r), r, proj4);
  assert.equal(ex2.pontos.length, 0);
  assert.match(ex2.ignoradas[0].motivo, /números a mais/);
});

test("executor: geográfica sem E/N vira UTM no fuso da longitude; longitude sem sinal assume Oeste", () => {
  const r = { ...receitaPadrao(","), campos: { ...receitaPadrao(",").campos, e: null, n: null, lat: 1, lon: 2 }, sistema: "geografica" };
  const ex = mapearTabela(tabelaDeLinhas(["1,-11.4038,39.0846,318.4,0.01,0.02", "2,-11.4040,-39.0850,318.4,0.01,0.02", "3,-11.4045,-39.0848,318.4,0.01,0.02"], r), r, proj4);
  assert.equal(ex.fusoGeo, 24);
  assert.ok(ex.pontos[0].e > 400000 && ex.pontos[0].e < 600000);
  assert.ok(ex.pontos[0].n > 8700000);
  assert.ok(ex.avisos.some((a) => a.codigo === "lon_sem_sinal"));
  assert.equal(ex.pontos[0].geo.lon, -39.0846);
});

// ---------------------------------------------------------------- ordem
test("ordem: cruzamento, ciclo igual, blocos por centena", () => {
  const sq = [{ e: 0, n: 0 }, { e: 10, n: 0 }, { e: 10, n: 10 }, { e: 0, n: 10 }];
  assert.equal(cruzamentos(sq).length, 0);
  assert.equal(cruzamentos([sq[0], sq[2], sq[1], sq[3]]).length, 1);
  assert.ok(mesmoCiclo([1, 2, 3, 4], [3, 4, 1, 2]));
  assert.ok(mesmoCiclo([1, 2, 3, 4], [4, 3, 2, 1]));
  assert.ok(!mesmoCiclo([1, 2, 3, 4], [1, 3, 2, 4]));
  const nums = [1, 2, 3, 100, 101, 102].map((num) => ({ num, sintetico: false }));
  assert.deepEqual(blocosPorCentena(nums), [[0, 1, 2], [3, 4, 5]]);
  assert.deepEqual(blocosPorCentena(nums.map((x) => ({ ...x, sintetico: true }))), [[0, 1, 2, 3, 4, 5]]);
});

const quadrado = (ordem, extra = "") => ordem.map((k) => {
  const c = { 1: [500000, 8700000], 2: [500100, 8700000], 3: [500100, 8700100], 4: [500000, 8700100] }[k];
  return `${k}${extra};${String(c[0]).replace(".", ",")};${String(c[1])};300,1;0,01;0,02`;
});

test("leitura: numeração que cruza e arquivo que não cruza → ordem do arquivo, com confirmação", () => {
  // cantos do quadrado na ordem do arquivo, mas numerados 1, 3, 2, 4
  const l = lerLinhas(["1;500000;8700000;300,1;0,01;0,02", "3;500100;8700000;300,1;0,01;0,02", "2;500100;8700100;300,1;0,01;0,02", "4;500000;8700100;300,1;0,01;0,02"], op);
  assert.ok(l.ok);
  assert.equal(l.criterio, "arquivo");
  assert.deepEqual(l.anel.map((p) => p.num), [1, 3, 2, 4]);
  assert.equal(cruzamentos(l.anel).length, 0);
  assert.ok(l.aConfirmar.includes("ordem_do_arquivo"));
  // o operador pode pedir a numeração mesmo assim (e o aviso de cruzamento aparece)
  const forcado = executarReceita(["1;500000;8700000;300,1;0,01;0,02", "3;500100;8700000;300,1;0,01;0,02", "2;500100;8700100;300,1;0,01;0,02", "4;500000;8700100;300,1;0,01;0,02"], l.receita, { ...op, ordem: "id" });
  assert.deepEqual(forcado.anel.map((p) => p.num), [1, 2, 3, 4]);
  assert.ok(forcado.aConfirmar.includes("desenho_cruza"));
});

test("leitura: ponto de base (RTCM) fica fora do perímetro e nome não numérico é aceito", () => {
  const linhas = [...quadrado([1, 2, 3, 4]), "postp_RTCM-Ref 1;500050;8700050;300,0;0,001;0,002", "postp_1;500050;8700000;300,0;0,01;0,02"];
  const l = lerLinhas(linhas, op);
  assert.ok(l, "leu");
  assert.equal(l.anel.length, 5);
  assert.ok(!l.anel.some((p) => /RTCM/.test(p.nome)));
  assert.ok(l.avisos.some((a) => a.codigo === "apoio_fora"));
  assert.ok(l.aConfirmar.includes("apoio_fora"));
  const postp = l.anel.find((p) => p.nome === "postp_1");
  assert.ok(postp.numSintetico);
  assert.equal(postp.num, 5);
});

test("leitura: o mesmo ponto duas vezes na mesma posição sai; em posições diferentes bloqueia", () => {
  const rep = lerLinhas([...quadrado([1, 2, 3, 4]), "2;500100;8700000;300,1;0,01;0,02"], op);
  assert.ok(rep.ok);
  assert.ok(rep.ignoradas.some((i) => i.tipo === "repetido"));
  const conflito = lerLinhas([...quadrado([1, 2, 3, 4]), "2;500150;8700000;300,1;0,01;0,02"], op);
  assert.ok(!conflito.ok);
  assert.ok(conflito.avisos.some((a) => a.codigo === "nome_repetido"));
  // excluir a medição errada na prévia resolve
  const resolvido = executarReceita(conflito.pontos.length ? [...quadrado([1, 2, 3, 4]), "2;500150;8700000;300,1;0,01;0,02"] : [], conflito.receita, { ...op, excluir: [5] });
  assert.ok(resolvido.ok);
});

test("validador: V1 recusa número que não está no arquivo; V2 aponta linha sem explicação", () => {
  const linhas = quadrado([1, 2, 3, 4]);
  const l = lerLinhas(linhas, op);
  assert.ok(l.ok);
  // adultera um valor depois de lido: a procedência denuncia
  const r = l.receita;
  const adulterada = executarReceita(linhas, r, op);
  adulterada.pontos[0].e += 1;
  const av = validar({ linhas, receita: r, pontos: adulterada.pontos, anel: [0, 1, 2, 3], ignoradas: [], proj4 });
  assert.ok(av.some((a) => a.codigo === "V1_procedencia" && a.nivel === "bloqueio"));
  const av2 = validar({ linhas: [...linhas, "linha perdida"], receita: r, pontos: l.pontos, anel: [0, 1, 2, 3], ignoradas: [], proj4 });
  assert.ok(av2.some((a) => a.codigo === "V2_cobertura" && a.linhas.includes(5)));
});

test("validador: σ ausente bloqueia até a precisão ser declarada; σ absurdo bloqueia", () => {
  const sem = ["P1,500000,8700000,300", "P2,500100,8700000,300", "P3,500100,8700100,300", "P4,500000,8700100,300"];
  const l = lerLinhas(sem, op);
  assert.ok(l && !l.ok);
  assert.ok(l.avisos.some((a) => a.codigo === "sem_precisao"));
  const comSigma = executarReceita(sem, l.receita, { ...op, sigmaPadrao: { pos: 0.05, h: 0.1 } });
  assert.ok(comSigma.ok, comSigma.avisos.map((a) => a.mensagem).join());
  assert.equal(comSigma.anel[0].sigmaPos, 0.05);
  assert.ok(comSigma.anel[0].sigmaDeclarado);
  const absurdo = lerLinhas(quadrado([1, 2, 3, 4]).map((x) => x.replace(";0,01;", ";221;")), op);
  assert.ok(absurdo.avisos.some((a) => a.codigo === "V3_sigma_unidade" && a.nivel === "bloqueio"));
});

test("cabeçalho: sinônimos em PT/EN/ZH e colunas a ignorar", () => {
  assert.equal(papelDoCabecalho("Easting"), "e");
  assert.equal(papelDoCabecalho("Northing (m)"), "n");
  assert.equal(papelDoCabecalho("Ellipsoidal height"), "h");
  assert.equal(papelDoCabecalho("Antenna height"), "ignorar");
  assert.equal(papelDoCabecalho("Easting RMS"), "sigma_e");
  assert.equal(papelDoCabecalho("Lateral RMS"), "sigma_pos");
  assert.equal(papelDoCabecalho("sdu(m)"), "sigma_h");
  assert.equal(papelDoCabecalho("Código"), "codigo");
  assert.equal(papelDoCabecalho("点名"), "nome");
  assert.equal(papelDoCabecalho("高程"), "h");
  assert.equal(papelDoCabecalho("PDOP"), "ignorar");
  assert.equal(papelDoCabecalho("xyz qualquer"), null);
});

test("assinatura: mesmo aparelho com pontos diferentes dá a mesma; formato diferente não", () => {
  const r = receitaPadrao(";");
  const a = assinatura(quadrado([1, 2, 3, 4]), r);
  const b = assinatura(quadrado([1, 2, 3, 4], "joao/maria"), r);
  assert.equal(a, b, "rótulo colado não muda o formato");
  const pnezd = assinatura(["1;8700000;500000;300,1;0,01;0,02", "2;8700000;500100;300,1;0,01;0,02", "3;8700100;500100;300,1;0,01;0,02"], r);
  assert.notEqual(a, pnezd, "N antes de E é outro formato");
});

test("rótulo 'V' continua abrindo trecho (M) mas não vira nome de confrontante", () => {
  const sug = sugerirTrechos([{ num: 1, rotulo: "V" }, { num: 2, rotulo: null }, { num: 3, rotulo: "virtual" }, { num: 4, rotulo: "joao/estrada" }, { num: 5, rotulo: "estrada" }]);
  assert.deepEqual(sug.map((s) => s.verticeInicioOrdem), [0, 2, 3, 4]);
  assert.equal(sug[0].apelido, null);
  assert.equal(sug[1].apelido, null);
  assert.equal(sug[2].apelido, "estrada");
  assert.equal(sug[2].ehVia, true);
  assert.equal(sug[3].apelido, "estrada", "palavra solta continua como hoje (decisão do Wilker)");
});
