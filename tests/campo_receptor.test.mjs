// Medir no campo com receptor RTK externo: o NMEA, o receptor (com transporte
// e NTRIP falsos), o cliente NTRIP (WebSocket falso) e a parte pura do
// repasse na edge function (anti-SSRF, resposta do caster, chunked, sourcetable).
//
// O que se prova aqui:
//  • checksum NMEA certo e errado; GGA de qualquer talker (GP/GN/GL/GB) com
//    fix 4/5/1 vira Leitura com lat/lon em graus, altitude elipsoidal, sats,
//    HDOP e idade da correção; sem fix não vira posição;
//  • a GGA partida em pedaços de 7 bytes (e CRLF/LF, lixo binário no meio)
//    sai inteira; a GST dá a precisão; sem GST, a estimativa por HDOP;
//  • a data da RMC entra no tGps; sem RMC, o dia do relógio (com a virada);
//  • montarGga → analisarSentenca devolve a mesma posição;
//  • o receptor entrega as leituras, escreve no transporte os bytes do NTRIP,
//    manda a GGA ao caster, tenta de novo com espera crescente (e não tenta
//    quando o erro é definitivo) e avisa quando o receptor cai;
//  • a senha do caster vai na 1ª mensagem do WebSocket, nunca na URL;
//  • o destino do repasse: IP interno, nome interno e DNS que aponta para
//    dentro são recusados.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  analisarSentenca, checksumNmea, conferirChecksum, criarLeitorNmea, criarMontadorLinhas, FATOR_PRECISAO, horaGps, leituraDaGga, montarGga,
  precisaoEstimada,
} from "../src/lib/campo/nmea.ts";
import { criarReceptor, suporteReceptor } from "../src/lib/campo/receptor.ts";
import { abrirNtrip, CASTER_RBMC, listarMontagens, urlWsDaFuncao } from "../src/lib/campo/ntrip.ts";
import {
  criarDesfazChunks, criarLeitorResposta, escolherIp, ggaValida, ipPermitido, ipv4Interno, ipv4ParaNumero, lerTabela, pedidoNtrip, pedidoTabela,
  respostaDaTabela, validarConfig, validarHost,
} from "../supabase/functions/ntrip/rede.ts";

/** "$corpo*HH" com o checksum certo */
const s = (corpo) => `$${corpo}*${checksumNmea(corpo)}`;
const bytes = (t) => new Uint8Array([...t].map((c) => c.charCodeAt(0)));
const quase = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} ${a} ≠ ${b}`);
const tique = () => new Promise((r) => setImmediate(r));

// 12:35:19 UTC, 48°07.038'N 11°31.000'E (o exemplo clássico do NMEA)
const GGA_CLASSICA = "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47";
const LAT_C = 48 + 7.038 / 60, LON_C = 11 + 31 / 60;
// Brasília (S/W), RTK fixo, correção de 1,2 s da estação 0123
const GGA_FIXO = s("GNGGA,143015.00,1557.01234,S,04752.98765,W,4,24,0.6,1112.345,M,-10.123,M,1.2,0123");
const LAT_F = -(15 + 57.01234 / 60), LON_F = -(47 + 52.98765 / 60);

// ---------------------------------------------------------------- checksum
test("checksum: a GGA clássica (*47) confere; um dígito trocado ou sem checksum, não", () => {
  assert.equal(conferirChecksum(GGA_CLASSICA), true);
  assert.equal(conferirChecksum(GGA_CLASSICA.replace("545.4", "545.5")), false);
  assert.equal(conferirChecksum(GGA_CLASSICA.slice(0, GGA_CLASSICA.indexOf("*"))), false);
  assert.equal(conferirChecksum(GGA_CLASSICA.replace("*47", "*48")), false);
  assert.equal(analisarSentenca(GGA_CLASSICA.replace("545.4", "545.5")), null);
  assert.equal(checksumNmea("GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,"), "47");
});

// ---------------------------------------------------------------- GGA
test("GGA: fix 4/5/1, qualquer talker, graus decimais, altitude elipsoidal, sats, HDOP e idade", () => {
  const c = analisarSentenca(GGA_CLASSICA);
  assert.equal(c.tipo, "GGA");
  assert.equal(c.talker, "GP");
  quase(c.lat, LAT_C, 1e-12); quase(c.lon, LON_C, 1e-12);
  assert.equal(c.fix, "autonomo");
  assert.equal(c.sats, 8); assert.equal(c.hdop, 0.9);
  assert.equal(c.segundosDia, 12 * 3600 + 35 * 60 + 19);

  const f = analisarSentenca(GGA_FIXO);
  assert.equal(f.talker, "GN"); assert.equal(f.fix, "rtk-fixo");
  quase(f.lat, LAT_F, 1e-12); quase(f.lon, LON_F, 1e-12);
  assert.equal(f.idadeCorrecaoS, 1.2); assert.equal(f.estacao, "0123");
  const l = leituraDaGga(f, { agora: Date.UTC(2026, 10, 8, 14, 30, 16) });
  assert.equal(l.fonte, "receptor"); assert.equal(l.fix, "rtk-fixo");
  quase(l.alt, 1112.345 - 10.123, 1e-9, "altitude = MSL + separação");
  assert.equal(l.sats, 24); assert.equal(l.hdop, 0.6); assert.equal(l.idadeCorrecaoS, 1.2);

  for (const [talker, q, fix] of [["GL", 5, "rtk-flutuante"], ["GA", 2, "dgps"], ["GB", 9, "dgps"], ["BD", 6, "autonomo"], ["GQ", 0, "sem-fix"]]) {
    const g = analisarSentenca(s(`${talker}GGA,010203.5,0130.0000,N,04500.0000,W,${q},10,1.1,10.0,M,,M,,`));
    assert.equal(g.talker, talker); assert.equal(g.fix, fix, `${talker} q=${q}`);
  }
  // sem separação geoidal: fica a altitude dada; sem fix: nenhuma posição
  const semSep = analisarSentenca(s("GPGGA,010203.5,0130.0000,N,04500.0000,W,1,10,1.1,10.0,M,,M,,"));
  assert.equal(leituraDaGga(semSep, { agora: 0 }).alt, 10);
  assert.equal(leituraDaGga(analisarSentenca(s("GPGGA,010203.5,,,,,0,00,99.9,,M,,M,,")), { agora: 0 }), null);
  assert.equal(leituraDaGga(analisarSentenca(s("GPGGA,010203.5,0130.0000,N,04500.0000,W,0,03,9.9,10,M,,M,,")), { agora: 0 }), null);
});

test("GGA partida em pedaços de 7 bytes, com CRLF, LF e lixo binário no meio, sai inteira", () => {
  const leitor = criarLeitorNmea({ agora: () => Date.UTC(2026, 10, 8, 14, 30, 16) });
  const fluxo = "\xd3\x00\x13\x3e\xd0\x00\x03" + GGA_FIXO + "\r\n" + s("GNGSA,A,3,01,02,03,,,,,,,,,,1.2,0.6,1.0") + "\n" + GGA_CLASSICA + "\r\n";
  const b = bytes(fluxo);
  const epocas = [];
  for (let i = 0; i < b.length; i += 7) epocas.push(...leitor.empurrar(b.subarray(i, i + 7)));
  assert.equal(epocas.length, 2);
  assert.equal(epocas[0].gga.fix, "rtk-fixo");
  quase(epocas[0].leitura.lat, LAT_F, 1e-12);
  assert.equal(epocas[1].gga.fix, "autonomo");

  // o montador sozinho: pedaço sem fim de linha fica guardado; linha gigante de lixo não trava
  const m = criarMontadorLinhas();
  assert.deepEqual(m.empurrar("$GPGGA,1"), []);
  assert.deepEqual(m.empurrar("23\r"), []);
  assert.deepEqual(m.empurrar("\nxx$GPRMC,1\n"), ["$GPGGA,123", "$GPRMC,1"]);
  assert.deepEqual(m.empurrar("\x00".repeat(5000)), []);
  assert.deepEqual(m.empurrar(GGA_CLASSICA + "\n"), [GGA_CLASSICA]);
});

// ---------------------------------------------------------------- precisão
test("precisão: da GST da mesma época (√(σlat²+σlon²)); sem GST, HDOP × fator do fix", () => {
  const leitor = criarLeitorNmea({ agora: () => Date.UTC(2026, 10, 8, 14, 30, 16) });
  leitor.linha(s("GNGST,143015.00,0.020,0.015,0.010,45.0,0.012,0.009,0.025"));
  const e = leitor.linha(GGA_FIXO);
  quase(e.leitura.precisao, Math.sqrt(0.012 ** 2 + 0.009 ** 2), 1e-12, "GST");
  quase(e.leitura.precisao, 0.015, 1e-12);

  // GST de outra época (10 s antes) não vale: estimativa
  const l2 = criarLeitorNmea({ agora: () => 0 });
  l2.linha(s("GNGST,143005.00,0.020,0.015,0.010,45.0,0.012,0.009,0.025"));
  quase(l2.linha(GGA_FIXO).leitura.precisao, 0.6 * FATOR_PRECISAO["rtk-fixo"], 1e-12, "estimativa");

  assert.equal(precisaoEstimada("rtk-flutuante", 2), 0.5);
  assert.equal(precisaoEstimada("autonomo", null), 2.5); // sem HDOP: 1
  assert.equal(precisaoEstimada("sem-fix", 1), null);
  // GGA sem HDOP usa o da GSA
  const l3 = criarLeitorNmea({ agora: () => 0 });
  l3.linha(s("GPGSA,A,3,01,02,03,04,,,,,,,,,1.8,1.4,1.1"));
  const e3 = l3.linha(s("GPGGA,010203.5,0130.0000,N,04500.0000,W,2,10,,10.0,M,,M,,"));
  assert.equal(e3.leitura.hdop, 1.4);
  quase(e3.leitura.precisao, 1.4 * 0.7, 1e-12);
});

// ---------------------------------------------------------------- hora
test("tGps: hora da GGA + data da RMC; sem RMC, o dia do relógio (com a virada da meia-noite)", () => {
  const leitor = criarLeitorNmea({ agora: () => Date.UTC(2030, 0, 1, 0, 0, 0) });
  const rmc = analisarSentenca(s("GNRMC,143015.00,A,1557.01234,S,04752.98765,W,0.01,0.0,081126,,,R"));
  assert.equal(rmc.tipo, "RMC"); assert.equal(rmc.valido, true);
  assert.deepEqual(rmc.data, { ano: 2026, mes: 11, dia: 8 });
  leitor.linha(s("GNRMC,143015.00,A,1557.01234,S,04752.98765,W,0.01,0.0,081126,,,R"));
  assert.equal(leitor.linha(GGA_FIXO).leitura.tGps, Date.UTC(2026, 10, 8, 14, 30, 15));

  // sem RMC: o dia de hoje (UTC)
  assert.equal(horaGps(3600, null, Date.UTC(2026, 10, 8, 1, 0, 2)), Date.UTC(2026, 10, 8, 1, 0, 0));
  // GGA de 23:59:59 lida 00:00:01 do dia seguinte: é do dia anterior
  assert.equal(horaGps(86399, null, Date.UTC(2026, 10, 9, 0, 0, 1)), Date.UTC(2026, 10, 8, 23, 59, 59));
  // RMC de 23:59:59 e GGA de 00:00:00: o dia vira
  assert.equal(horaGps(0, { data: { ano: 2026, mes: 11, dia: 8 }, segundosDia: 86399 }, 0), Date.UTC(2026, 10, 9, 0, 0, 0));
});

// ---------------------------------------------------------------- GGA de volta
test("montarGga: checksum certo e ida e volta com a mesma posição (S/W e N/E)", () => {
  for (const [lat, lon, fix] of [[LAT_F, LON_F, "rtk-fixo"], [LAT_C, LON_C, "dgps"], [-0.000001, -179.9999999, "rtk-flutuante"], [-12.99999999, -38.5, null]]) {
    const t = Date.UTC(2026, 10, 8, 9, 5, 7, 250);
    const linha = montarGga({ lat, lon, t, tGps: t, fix, sats: 17, hdop: 0.7, alt: 1102.2 });
    assert.equal(conferirChecksum(linha), true, linha);
    assert.ok(linha.length <= 82, `${linha.length} caracteres`);
    assert.ok(ggaValida(linha), "a função aceita a GGA que o navegador monta");
    const g = analisarSentenca(linha);
    quase(g.lat, lat, 1e-7, "lat"); quase(g.lon, lon, 1e-7, "lon");
    assert.equal(g.segundosDia, 9 * 3600 + 5 * 60 + 7.25);
    assert.equal(g.fix, fix ?? "autonomo");
    assert.equal(g.sats, 17);
  }
});

// ---------------------------------------------------------------- receptor
function transporteFalso() {
  const t = {
    tipo: "bluetooth", nome: "Receptor de teste", escritos: [], fechado: false,
    iniciar(aoBytes, aoCair) { t.mandar = aoBytes; t.cair = aoCair; },
    async escrever(b) { t.escritos.push(...b); },
    async fechar() { t.fechado = true; },
  };
  return t;
}

function ntripFalso() {
  const n = { aberturas: [], ultima: null };
  n.abrir = (cfg, aoDados, aoEstado) => {
    const c = { cfg, aoDados, aoEstado, ggas: [], fechada: false, enviarGga(x) { c.ggas.push(x); }, fechar() { c.fechada = true; } };
    n.aberturas.push(c); n.ultima = c;
    return c;
  };
  return n;
}

const CFG = { host: CASTER_RBMC.host, porta: CASTER_RBMC.porta, montagem: "BRAZ1", usuario: "joao", senha: "segredo", enviarGga: true };

test("receptor: transporte falso entrega leituras; bytes do NTRIP vão ao receptor; GGA vai ao caster", async () => {
  const n = ntripFalso();
  const r = criarReceptor({ abrirNtrip: n.abrir });
  const leituras = [];
  let redesenhos = 0;
  r.assinar(() => redesenhos++);
  r.iniciar((l) => leituras.push(l), () => {});
  const t = transporteFalso();
  r.conectar(t);
  assert.equal(r.estado().conectado, true);
  assert.equal(r.estado().transporte, "bluetooth");
  const antes = r.estado();
  assert.equal(r.estado(), antes, "retrato estável enquanto nada muda");

  const b = bytes(GGA_FIXO + "\r\n");
  t.mandar(b.subarray(0, 30)); t.mandar(b.subarray(30));
  assert.equal(leituras.length, 1);
  assert.equal(leituras[0].fonte, "receptor"); assert.equal(leituras[0].fix, "rtk-fixo");
  assert.ok(Math.abs(leituras[0].t - Date.now()) < 5000, "t = hora em que chegou");
  assert.equal(r.estado().fix, "rtk-fixo"); assert.equal(r.estado().sats, 24);
  assert.notEqual(r.estado(), antes);
  assert.ok(redesenhos > 0);

  r.ligarNtrip(CFG);
  assert.equal(n.aberturas.length, 1);
  assert.equal(r.estado().ntrip.estado, "conectando");
  assert.equal(n.ultima.ggas.length, 1, "GGA na hora (a leitura já existe)");
  assert.equal(analisarSentenca(n.ultima.ggas[0]).fix, "rtk-fixo");
  n.ultima.aoEstado({ estado: "recebendo" });
  const rtcm = new Uint8Array([0xd3, 0x00, 0x04, 0x3e, 0xd0, 0x00, 0x00, 0x11, 0x22, 0x33]);
  n.ultima.aoDados(rtcm.subarray(0, 4)); n.ultima.aoDados(rtcm.subarray(4));
  await tique(); await tique();
  assert.deepEqual(t.escritos, [...rtcm], "os bytes da correção foram escritos no receptor, na ordem");
  assert.equal(r.estado().ntrip.estado, "recebendo");
  assert.equal(r.estado().ntrip.bytes, rtcm.length);

  // sem fix: estado muda, nenhuma leitura nova
  t.mandar(bytes(s("GNGGA,143016.00,,,,,0,00,99.9,,M,,M,,") + "\n"));
  assert.equal(leituras.length, 1);
  assert.equal(r.estado().fix, "sem-fix");

  r.desligarNtrip();
  assert.equal(n.ultima.fechada, true);
  assert.equal(r.estado().ntrip.estado, "desligado");
  await r.desconectar();
  assert.equal(t.fechado, true);
  assert.equal(r.estado().conectado, false);
});

test("receptor: GGA a cada 10 s, reconexão com espera crescente até 30 s, erro definitivo não insiste", () => {
  mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: Date.UTC(2026, 10, 8, 14, 30, 16) });
  try {
    const n = ntripFalso();
    const r = criarReceptor({ abrirNtrip: n.abrir });
    const t = transporteFalso();
    r.conectar(t);
    t.mandar(bytes(GGA_FIXO + "\n"));
    r.ligarNtrip(CFG);
    assert.equal(n.ultima.ggas.length, 1);
    mock.timers.tick(10_000);
    t.mandar(bytes(GGA_FIXO + "\n")); // a leitura continua chegando
    mock.timers.tick(10_000);
    assert.equal(n.ultima.ggas.length, 3);

    // quedas seguidas: 1, 2, 4, 8, 16, 30, 30 s
    const esperas = [];
    for (let i = 0; i < 7; i++) {
      const antes = n.aberturas.length;
      n.ultima.aoEstado({ estado: "erro", mensagem: "Caiu.", definitivo: false });
      assert.equal(r.estado().ntrip.estado, "erro");
      assert.match(r.estado().ntrip.mensagem, /Tentando de novo/);
      let ms = 0;
      while (n.aberturas.length === antes && ms < 60_000) { mock.timers.tick(1000); ms += 1000; }
      esperas.push(ms);
    }
    assert.deepEqual(esperas, [1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    // recebeu: zera a espera
    n.ultima.aoEstado({ estado: "recebendo" });
    n.ultima.aoEstado({ estado: "erro", mensagem: "Caiu.", definitivo: false });
    const antes = n.aberturas.length;
    mock.timers.tick(1000);
    assert.equal(n.aberturas.length, antes + 1);

    // senha errada: para de tentar
    n.ultima.aoEstado({ estado: "erro", mensagem: "O caster recusou o usuário ou a senha.", definitivo: true });
    const fim = n.aberturas.length;
    mock.timers.tick(120_000);
    assert.equal(n.aberturas.length, fim);
    assert.equal(r.estado().ntrip.mensagem, "O caster recusou o usuário ou a senha.");
    r.desligarNtrip();
  } finally {
    mock.timers.reset();
  }
});

test("receptor: a queda do transporte avisa a tela (aoErrar) e desmarca o conectado", () => {
  const r = criarReceptor({ abrirNtrip: ntripFalso().abrir });
  const erros = [];
  r.iniciar(() => {}, (e) => erros.push(e));
  const t = transporteFalso();
  r.conectar(t);
  t.cair("A ligação Bluetooth com o receptor caiu.");
  assert.equal(r.estado().conectado, false);
  assert.match(r.estado().erro, /caiu/);
  assert.equal(erros.length, 1);
  assert.equal(erros[0].tipo, "sem-sinal");
  // fechar de propósito (motivo null) não é erro
  const t2 = transporteFalso();
  r.conectar(t2);
  t2.cair(null);
  assert.equal(erros.length, 1);
});

test("suporteReceptor: iPhone explica o MFi; Android sem Web Serial pede o Chrome 138+; computador com serial passa", () => {
  const iphone = suporteReceptor({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", maxTouchPoints: 5 });
  assert.equal(iphone.serial, false); assert.equal(iphone.bluetooth, false);
  assert.match(iphone.motivo, /MFi/);
  const ipad = suporteReceptor({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", maxTouchPoints: 5 });
  assert.match(ipad.motivo, /iPhone/);
  const android = suporteReceptor({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120", maxTouchPoints: 5 });
  assert.match(android.motivo, /138/);
  const pc = suporteReceptor({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/140", maxTouchPoints: 0, serial: {}, bluetooth: {} });
  assert.deepEqual(pc, { serial: true, bluetooth: true });
});

// ---------------------------------------------------------------- cliente NTRIP
function wsFalso() {
  const criados = [];
  class W {
    constructor(url) { this.url = url; this.readyState = 0; this.enviados = []; criados.push(this); }
    send(x) { this.enviados.push(x); }
    close() { this.readyState = 3; this.fechouPorNos = true; }
    abrir() { this.readyState = 1; this.onopen?.(); }
    msg(data) { this.onmessage?.({ data }); }
    cair() { this.readyState = 3; this.onclose?.({ code: 4000 }); }
  }
  return { W, criados };
}

test("abrirNtrip: senha só na 1ª mensagem (nunca na URL), GGA guardada até abrir, RTCM repassado, erro no fim", async () => {
  const { W, criados } = wsFalso();
  const estados = [], dados = [];
  const c = abrirNtrip(CFG, (b) => dados.push(...b), (e) => estados.push(e), {
    url: "wss://exemplo/functions/v1/ntrip", WebSocket: W, credenciais: async () => ({ token: "jwt.do.usuario", apikey: "anon" }),
  });
  c.enviarGga("$GPGGA,antes");
  await tique();
  const w = criados[0];
  assert.ok(w.url.startsWith("wss://exemplo/functions/v1/ntrip?access_token=jwt.do.usuario&apikey=anon"));
  assert.ok(!w.url.includes("segredo") && !w.url.includes("joao"), "nem usuário nem senha na URL");
  w.abrir();
  const cfg = JSON.parse(w.enviados[0]);
  assert.deepEqual(cfg, { tipo: "abrir", host: CFG.host, porta: 2101, montagem: "BRAZ1", usuario: "joao", senha: "segredo" });
  assert.equal(w.enviados[1], "$GPGGA,antes");
  c.enviarGga("$GPGGA,depois");
  assert.equal(w.enviados[2], "$GPGGA,depois");
  w.msg(JSON.stringify({ tipo: "estado", estado: "recebendo" }));
  w.msg(new Uint8Array([0xd3, 1, 2]).buffer);
  assert.deepEqual(dados, [0xd3, 1, 2]);
  w.msg(JSON.stringify({ tipo: "erro", mensagem: "Esse ponto de montagem não existe no caster.", definitivo: true }));
  assert.equal(estados.at(-1).estado, "recebendo", "o erro só fecha quando a conexão fecha");
  w.cair();
  assert.deepEqual(estados.map((e) => e.estado), ["conectando", "recebendo", "erro"]);
  assert.deepEqual(estados.at(-1), { estado: "erro", mensagem: "Esse ponto de montagem não existe no caster.", definitivo: true });

  // queda sem explicação: não definitiva; sessão recusada: renova
  let renovou = 0;
  const est2 = [];
  abrirNtrip(CFG, () => {}, (e) => est2.push(e), { url: "wss://x/ntrip", WebSocket: W, credenciais: async () => ({ token: "t", apikey: "a" }), renovarSessao: async () => { renovou++; } });
  await tique();
  criados[1].abrir();
  criados[1].msg(JSON.stringify({ tipo: "erro", mensagem: "Sessão inválida ou expirada. Entre de novo.", definitivo: false, codigo: "sessao" }));
  criados[1].cair();
  assert.equal(est2.at(-1).definitivo, false);
  assert.equal(renovou, 1);

  // fechar por nós: nada mais é avisado
  const est3 = [];
  const c3 = abrirNtrip(CFG, () => {}, (e) => est3.push(e), { url: "wss://x/ntrip", WebSocket: W, credenciais: async () => ({ token: "t", apikey: "a" }) });
  await tique();
  c3.fechar();
  criados[2].cair();
  assert.deepEqual(est3.map((e) => e.estado), ["conectando"]);

  // sem login: erro definitivo sem abrir WebSocket
  const est4 = [];
  abrirNtrip(CFG, () => {}, (e) => est4.push(e), { url: "wss://x/ntrip", WebSocket: W, credenciais: async () => null });
  await tique();
  assert.equal(criados.length, 3);
  assert.equal(est4.at(-1).definitivo, true);

  assert.equal(urlWsDaFuncao("https://abc.supabase.co/"), "wss://abc.supabase.co/functions/v1/ntrip");
  assert.equal(urlWsDaFuncao("http://localhost:54321"), "ws://localhost:54321/functions/v1/ntrip");
});

test("listarMontagens: pede a tabela pela função com a ação certa", async () => {
  let pedido;
  const r = await listarMontagens({ host: " gps-ntrip.ibge.gov.br ", porta: 2101 }, { chamar: async (nome, corpo) => { pedido = { nome, corpo }; return { montagens: [{ nome: "BRAZ1" }] }; } });
  assert.deepEqual(pedido, { nome: "ntrip", corpo: { acao: "tabela", host: "gps-ntrip.ibge.gov.br", porta: 2101, usuario: "", senha: "" } });
  assert.deepEqual(r, [{ nome: "BRAZ1" }]);
});

// ---------------------------------------------------------------- função: sourcetable
// linhas como a RBMC devolveu em 08/11/2026 (BKG Caster 2.0.37)
const TABELA = [
  "SOURCETABLE 200 OK",
  "Server: NTRIP BKG Caster 2.0.37/2.0",
  "Content-Type: text/plain",
  "",
  "CAS;gps-ntrip.ibge.gov.br;2101;Ntrip_Prof_1.5.8;IBGE;0;BRA;-22.91;-43.22;http://www.ibge.gov.br/english",
  "NET;RBMC-IP;IBGE;B;N;http://www.ibge.gov.br/home/geociencias/geodesia/rbmc/rbmc.shtm;https://gps-ntrip.ibge.gov.br/skl/;http://www.ibge.gov.br;none",
  "STR;BRAZ1;Brasilia;RTCM 3.0;1004(1),1006(1),1008(10),1012(1),1013(10),1019(10),1020(10),1033(10);2;GPS+GLO+SBAS;RBMC-IP;BRA;-15.95;-47.88;0;0;LEICA GR50;none;B;N;1500;RBMC-BRAZ",
  "STR;VRSX0;Rede;RTCM 3.2;1074(1),1084(1);2;GPS+GLO;REDE;BRA;-12.97;-38.51;1;1;sNTRIP;none;B;N;3000;",
  "ENDSOURCETABLE",
  "",
].join("\r\n");

test("sourcetable: linhas STR viram montagens (nmea, solução, lat/lon); 401 e lixo dão o motivo", () => {
  const ms = lerTabela(TABELA);
  assert.equal(ms.length, 2);
  assert.deepEqual(ms[0], {
    nome: "BRAZ1", identificador: "Brasilia", formato: "RTCM 3.0",
    detalhesFormato: "1004(1),1006(1),1008(10),1012(1),1013(10),1019(10),1020(10),1033(10)",
    navegacao: "GPS+GLO+SBAS", rede: "RBMC-IP", pais: "BRA", lat: -15.95, lon: -47.88, nmea: false, solucao: "base", gerador: "LEICA GR50", autenticacao: "B",
  });
  assert.equal(ms[1].nmea, true); assert.equal(ms[1].solucao, "rede");
  assert.equal(respostaDaTabela(bytes(TABELA)).montagens.length, 2);
  assert.equal(respostaDaTabela(bytes(TABELA.replace("SOURCETABLE 200 OK", "HTTP/1.1 200 OK"))).montagens.length, 2);
  assert.match(respostaDaTabela(bytes("HTTP/1.1 401 Unauthorized\r\n\r\n")).erro, /senha/);
  assert.match(respostaDaTabela(bytes("SSH-2.0-OpenSSH_9.6\r\n")).erro, /não devolveu/);
});

// ---------------------------------------------------------------- função: resposta do caster
test("resposta do caster: ICY 200 (Rev1), HTTP 200 em pedaços, 401, 404, SOURCETABLE e lixo", () => {
  const r1 = criarLeitorResposta().empurrar(new Uint8Array([...bytes("ICY 200 OK\r\n"), 0xd3, 0, 1]));
  assert.equal(r1.tipo, "ok"); assert.deepEqual([...r1.resto], [0xd3, 0, 1]); assert.equal(r1.chunked, false);
  const r1b = criarLeitorResposta().empurrar(new Uint8Array([...bytes("ICY 200 OK\r\n\r\n"), 0xd3]));
  assert.deepEqual([...r1b.resto], [0xd3]);

  const l = criarLeitorResposta();
  assert.equal(l.empurrar(bytes("HT")).tipo, "incompleto");
  assert.equal(l.empurrar(bytes("TP/1.1 200 OK\r\nNtrip-Version: Ntrip/2.0\r\nTransfer-Enc")).tipo, "incompleto");
  const r2 = l.empurrar(new Uint8Array([...bytes("oding: chunked\r\n\r\n3\r\n"), 0xd3, 0, 2]));
  assert.equal(r2.tipo, "ok"); assert.equal(r2.chunked, true);
  assert.deepEqual([...criarDesfazChunks().empurrar(r2.resto)], [0xd3, 0, 2]);

  // as respostas que a RBMC deu de verdade (08/11/2026)
  const e401 = criarLeitorResposta().empurrar(bytes("HTTP/1.1 401 Unauthorized\r\nNtrip-Version: Ntrip/2.0\r\nWWW-Authenticate: Basic realm=\"/NAUS0\"\r\nConnection: close\r\n\r\n"));
  assert.equal(e401.tipo, "erro"); assert.match(e401.mensagem, /usuário ou a senha/); assert.equal(e401.definitivo, true);
  const e404 = criarLeitorResposta().empurrar(bytes("HTTP/1.1 404 Not Found\r\nNtrip-Version: Ntrip/2.0\r\n\r\n"));
  assert.match(e404.mensagem, /ponto de montagem não existe/);
  assert.match(criarLeitorResposta().empurrar(bytes("SOURCETABLE 200 OK\r\nServer: x\r\n")).mensagem, /não existe/);
  assert.match(criarLeitorResposta().empurrar(bytes("HTTP/1.1 200 OK\r\nContent-Type: gnss/sourcetable\r\n\r\nSTR;")).mensagem, /não existe/);
  const e503 = criarLeitorResposta().empurrar(bytes("HTTP/1.1 503 Service Unavailable\r\n\r\n"));
  assert.equal(e503.definitivo, false);
  assert.equal(criarLeitorResposta().empurrar(bytes("SSH-2.0-OpenSSH\r\n")).tipo, "erro");
});

test("chunked: desfeito mesmo com os pedaços do TCP cortando em qualquer lugar", () => {
  const corpo = "4\r\nabcd\r\nA;ext=1\r\n0123456789\r\n0\r\n\r\n";
  for (let corte = 1; corte < corpo.length; corte++) {
    const d = criarDesfazChunks();
    const out = [...d.empurrar(bytes(corpo.slice(0, corte))), ...d.empurrar(bytes(corpo.slice(corte)))];
    assert.equal(String.fromCharCode(...out), "abcd0123456789", `corte em ${corte}`);
    assert.equal(d.acabou(), true);
  }
});

test("pedido ao caster: HTTP/1.0, Ntrip-Version 2, Basic certo; tabela sem Ntrip-Version", () => {
  const p = pedidoNtrip({ host: "gps-ntrip.ibge.gov.br", porta: 2101, montagem: "BRAZ1", usuario: "joão", senha: "s:e" });
  assert.match(p, /^GET \/BRAZ1 HTTP\/1\.0\r\n/);
  assert.match(p, /\r\nUser-Agent: NTRIP VertcesNtrip\/1\.0\r\n/);
  assert.match(p, /\r\nNtrip-Version: Ntrip\/2\.0\r\n/);
  assert.ok(p.includes(`Authorization: Basic ${Buffer.from("joão:s:e", "utf8").toString("base64")}\r\n`));
  assert.ok(p.endsWith("\r\n\r\n"));
  const t = pedidoTabela({ host: "h.com", porta: 2101, usuario: "", senha: "" });
  assert.match(t, /^GET \/ HTTP\/1\.0\r\n/);
  assert.ok(!t.includes("Ntrip-Version") && !t.includes("Authorization"));
});

// ---------------------------------------------------------------- função: anti-SSRF
test("anti-SSRF: IP interno, reservado e da própria VPS recusados; público passa", () => {
  for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.255.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.254",
    "192.0.0.8", "192.0.2.1", "192.168.0.10", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "239.1.1.1", "240.0.0.1", "255.255.255.255"]) {
    assert.equal(ipv4Interno(ip), true, ip);
    assert.equal(ipPermitido(ip), false, ip);
  }
  for (const ip of ["200.160.2.3", "8.8.8.8", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.0", "11.0.0.1", "223.255.255.255"]) {
    assert.equal(ipPermitido(ip), true, ip);
  }
  assert.equal(ipPermitido("31.97.85.119"), false, "a própria VPS");
  assert.equal(ipPermitido("8.8.8.8", ["8.8.8.8"]), false, "lista extra (NTRIP_IPS_BLOQUEADOS)");
  // formas disfarçadas: zero à esquerda (octal), número solto, fora de faixa
  for (const ip of ["010.0.0.1", "0177.0.0.1", "2130706433", "1.2.3.256", "1.2.3", "::1", ""]) assert.equal(ipv4ParaNumero(ip), null, ip);
});

test("anti-SSRF: nomes internos e do docker recusados; DNS que aponta para dentro recusado", () => {
  for (const h of ["localhost", "LOCALHOST", "db", "kong", "rest", "sb_rtkconverte_db", "tasks.sb_rtkconverte_db", "functions.internal", "x.local", "a.localhost",
    "host.docker.internal", "kubernetes.default.svc", "minha.lan", "127.0.0.1", "10.0.0.2", "[::1]", "::ffff:10.0.0.1", "1.2.3.4.5", "-ruim.com", "a..b", "x".repeat(254)]) {
    assert.throws(() => validarHost(h), undefined, h);
  }
  assert.deepEqual(validarHost(" GPS-NTRIP.IBGE.gov.br. "), { tipo: "nome", valor: "gps-ntrip.ibge.gov.br" });
  assert.deepEqual(validarHost("200.160.2.3"), { tipo: "ip", valor: "200.160.2.3" });
  assert.equal(escolherIp(["200.160.2.3", "200.160.2.4"]), "200.160.2.3");
  assert.throws(() => escolherIp(["200.160.2.3", "10.0.0.1"]), /rede interna/, "um interno basta para recusar");
  assert.throws(() => escolherIp(["127.0.0.1"]), /rede interna/);
  assert.throws(() => escolherIp([]), /não tem IPv4/);

  // config: porta, montagem e caracteres que quebrariam o pedido
  assert.deepEqual(validarConfig({ host: "gps-ntrip.ibge.gov.br", porta: "2101", montagem: "/BRAZ1", usuario: "u", senha: "p" }),
    { host: "gps-ntrip.ibge.gov.br", porta: 2101, montagem: "BRAZ1", usuario: "u", senha: "p" });
  for (const ruim of [{ porta: 0 }, { porta: 65536 }, { porta: 21.5 }, { montagem: "a b" }, { montagem: "x\r\nHost: db" }, { usuario: "a:b" }, { senha: "x\r\n" }, { host: "db" }]) {
    assert.throws(() => validarConfig({ host: "gps-ntrip.ibge.gov.br", porta: 2101, montagem: "BRAZ1", ...ruim }), undefined, JSON.stringify(ruim));
  }
  // só GGA passa do navegador para o caster
  assert.equal(ggaValida("$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47"), "$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47");
  assert.equal(ggaValida("GET / HTTP/1.0"), null);
  assert.equal(ggaValida("$GPRMC,1,2,3,4,5,6,7,8,9"), null);
  assert.equal(ggaValida("$GPGGA,1,2,3\r\nGET /x HTTP/1.0"), null);
});
