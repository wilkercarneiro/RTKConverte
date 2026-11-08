// O receptor GNSS externo (RTK) como fonte do Medir no campo. O Vertces, no
// navegador, faz o papel da controladora: lê o NMEA do receptor, mostra o tipo
// de fix e repassa a correção NTRIP para ele pela mesma ligação.
//
// Duas ligações (pesquisa em docs/pesquisa-tecnologias-precisao-gps.md, seção 3):
//  - Web Serial: Bluetooth clássico (SPP/RFCOMM) no Chrome do Android 138+ e
//    porta serial/USB no computador. O Android NÃO avisa quando a porta cai:
//    a queda aparece como erro (ou fim) na leitura.
//  - Web Bluetooth (BLE) com o Nordic UART Service, para receptor só BLE
//    (SparkFun RTK, por exemplo). A escrita vai em pedaços pequenos, um de
//    cada vez (o BLE não aceita pacote grande).
// iPhone não tem nenhuma das duas: lá só o receptor certificado MFi, que entra
// pela localização do sistema (a fonte "celular", gps.ts).
//
// A tela só conhece FonteGps (iniciar/pedirAgora) e o retrato do estado
// (assinar + estado, para o useSyncExternalStore). Os transportes ficam atrás
// da interface Transporte — os testes usam um falso.
import type { ErroGps, FonteGps } from "./gps.ts";
import { criarLeitorNmea, montarGga } from "./nmea.ts";
import type { AbrirNtrip, ConexaoNtrip, ConfigNtrip, EstadoConexaoNtrip } from "./ntrip.ts";
import type { Leitura, TipoFix } from "./tipos.ts";

/** UUID do perfil de porta serial (SPP) do Bluetooth clássico. */
export const UUID_SPP = "00001101-0000-1000-8000-00805f9b34fb";
/** Nordic UART Service (BLE): TX = o receptor notifica, RX = nós escrevemos. */
export const UUID_NUS = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
export const UUID_NUS_TX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
export const UUID_NUS_RX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

export type TipoTransporte = "serial" | "bluetooth";

/** A ligação com o receptor, qualquer que seja. */
export interface Transporte {
  tipo: TipoTransporte;
  nome: string;
  /** começa a ler; `aoCair` uma vez só, quando a ligação acaba (null = fechada por nós) */
  iniciar(aoBytes: (b: Uint8Array) => void, aoCair: (erro: string | null) => void): void;
  escrever(b: Uint8Array): Promise<void>;
  fechar(): Promise<void>;
}

export interface EstadoNtrip {
  estado: "desligado" | "conectando" | "recebendo" | "erro";
  /** bytes de correção recebidos nesta ligação */
  bytes: number;
  mensagem?: string;
}

export interface EstadoReceptor {
  conectado: boolean;
  transporte: TipoTransporte | null;
  nome: string | null;
  ultimaLeitura: Leitura | null;
  /** da última GGA (mesmo sem posição: "sem-fix") */
  fix: TipoFix | null;
  sats: number | null;
  hdop: number | null;
  idadeCorrecaoS: number | null;
  ntrip: EstadoNtrip;
  erro?: string;
}

export interface Receptor extends FonteGps {
  conectarSerial(): Promise<void>;
  conectarBluetooth(op?: { todos?: boolean }): Promise<void>;
  /** liga um transporte já aberto (laboratório e testes) */
  conectar(t: Transporte): void;
  desconectar(): Promise<void>;
  ligarNtrip(cfg: ConfigNtrip): void;
  desligarNtrip(): void;
  estado(): EstadoReceptor;
  assinar(f: () => void): () => void;
}

export interface OpcoesReceptor {
  abrirNtrip: AbrirNtrip;
  /** troca os transportes de verdade (testes, laboratório) */
  abrirSerial?: () => Promise<Transporte>;
  abrirBluetooth?: (op?: { todos?: boolean }) => Promise<Transporte>;
  agora?: () => number;
}

/** GGA ao caster a cada 10 s; a correção espera até 30 s entre tentativas. */
export const INTERVALO_GGA_MS = 10_000;
export const ESPERA_MAX_NTRIP_MS = 30_000;
/** correção que não coube (receptor lento): descarta — RTCM velho não serve */
const MAX_FILA_BYTES = 64 * 1024;

const NTRIP_DESLIGADO: EstadoNtrip = { estado: "desligado", bytes: 0 };

// ---------------------------------------------------------------------------
// Suporte
// ---------------------------------------------------------------------------

type Nav = Navigator & { serial?: unknown; bluetooth?: unknown };

/** O que este navegador consegue: Web Serial, Web Bluetooth, e o motivo quando não. */
export function suporteReceptor(nav: Nav | undefined = typeof navigator !== "undefined" ? navigator : undefined): { serial: boolean; bluetooth: boolean; motivo?: string } {
  if (!nav) return { serial: false, bluetooth: false, motivo: "Sem navegador." };
  const ua = nav.userAgent ?? "";
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  if (ios) {
    return {
      serial: false, bluetooth: false,
      motivo: "No iPhone o navegador não fala direto com o receptor (a Apple não libera Bluetooth nem porta serial para sites). " +
        "Lá só funciona receptor certificado MFi (Emlid Reach RX2, Bad Elf, EOS Arrow…): ligue-o pelo app do fabricante e use a localização do aparelho, que passa a vir do receptor.",
    };
  }
  if (typeof isSecureContext !== "undefined" && !isSecureContext) {
    return { serial: false, bluetooth: false, motivo: "O receptor só liga com o endereço seguro (https). Abra pelo vertces.com.br." };
  }
  const serial = !!nav.serial, bluetooth = !!nav.bluetooth;
  if (!serial && !bluetooth) {
    return {
      serial, bluetooth,
      motivo: /Android/i.test(ua)
        ? "Este navegador não liga o receptor. Use o Chrome atualizado (versão 138 ou mais nova) e pareie o receptor nas configurações de Bluetooth do Android antes."
        : "Este navegador não liga o receptor. Use o Chrome ou o Edge no computador (porta USB ou Bluetooth).",
    };
  }
  return { serial, bluetooth };
}

// ---------------------------------------------------------------------------
// Transportes de verdade
// ---------------------------------------------------------------------------

// O mínimo da Web Serial e da Web Bluetooth (o lib.dom do TypeScript não traz).
interface PortaSerial {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  getInfo(): { usbVendorId?: number; usbProductId?: number; bluetoothServiceClassId?: string | number };
}
interface WebSerial {
  requestPort(o?: { filters?: { bluetoothServiceClassId?: string }[]; allowedBluetoothServiceClassIds?: string[] }): Promise<PortaSerial>;
}
interface Caracteristica extends EventTarget {
  value?: DataView;
  properties: { writeWithoutResponse: boolean; write: boolean };
  startNotifications(): Promise<Caracteristica>;
  writeValueWithoutResponse?(b: Uint8Array): Promise<void>;
  writeValueWithResponse?(b: Uint8Array): Promise<void>;
  writeValue(b: Uint8Array): Promise<void>;
}
interface DispositivoBle extends EventTarget {
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<{ getPrimaryService(u: string): Promise<{ getCharacteristic(u: string): Promise<Caracteristica> }> }>;
    disconnect(): void;
  };
}
interface WebBluetooth {
  requestDevice(o: { filters?: { services: string[] }[]; acceptAllDevices?: boolean; optionalServices?: string[] }): Promise<DispositivoBle>;
}

const msgErro = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Pede a porta ao usuário (a janela do Chrome) e abre. No Android a lista é
 * só de Bluetooth SPP (o receptor precisa estar pareado antes); no computador
 * aparecem as USB/seriais e as Bluetooth. O baud rate só vale para USB
 * (no Bluetooth o RFCOMM ignora); 115200 é o padrão dos receptores atuais.
 */
export async function abrirSerialDoNavegador(op: { baudRate?: number } = {}): Promise<Transporte> {
  const serial = (navigator as Nav).serial as WebSerial | undefined;
  if (!serial) throw new Error("Este navegador não tem porta serial (Web Serial).");
  const android = /Android/i.test(navigator.userAgent);
  const porta = await serial.requestPort(android
    ? { filters: [{ bluetoothServiceClassId: UUID_SPP }], allowedBluetoothServiceClassIds: [UUID_SPP] }
    : { allowedBluetoothServiceClassIds: [UUID_SPP] });
  await porta.open({ baudRate: op.baudRate ?? 115200 });
  const info = porta.getInfo();
  const nome = info.bluetoothServiceClassId != null ? "Receptor Bluetooth"
    : info.usbVendorId != null ? `Receptor USB (${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")})`
    : "Porta serial";
  let leitor: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let fechando = false;
  return {
    tipo: "serial", nome,
    iniciar(aoBytes, aoCair) {
      void (async () => {
        let erro: string | null = null;
        try {
          if (!porta.readable) throw new Error("a porta não está aberta para leitura");
          leitor = porta.readable.getReader();
          for (;;) {
            const { value, done } = await leitor.read();
            if (done) break;
            if (value?.length) aoBytes(value);
          }
        } catch (e) {
          erro = msgErro(e);
        } finally {
          try { leitor?.releaseLock(); } catch { /* já solto */ }
          leitor = null;
        }
        aoCair(fechando ? null : `A ligação com o receptor caiu${erro ? ` (${erro})` : ""}. Confira se ele está ligado e perto.`);
      })();
    },
    async escrever(b) {
      if (!porta.writable) throw new Error("a porta não está aberta para escrita");
      const w = porta.writable.getWriter();
      try { await w.write(b); } finally { w.releaseLock(); }
    },
    async fechar() {
      fechando = true;
      try { await leitor?.cancel(); } catch { /* já cancelado */ }
      try { await porta.close(); } catch { /* já fechada */ }
    },
  };
}

/**
 * BLE com o Nordic UART Service. `todos` mostra todos os aparelhos por perto
 * (receptor que não anuncia o serviço); o padrão filtra pelo UART.
 */
export async function abrirBluetoothDoNavegador(op: { todos?: boolean } = {}): Promise<Transporte> {
  const bt = (navigator as Nav).bluetooth as WebBluetooth | undefined;
  if (!bt) throw new Error("Este navegador não tem Bluetooth (Web Bluetooth).");
  const disp = await bt.requestDevice(op.todos
    ? { acceptAllDevices: true, optionalServices: [UUID_NUS] }
    : { filters: [{ services: [UUID_NUS] }], optionalServices: [UUID_NUS] });
  if (!disp.gatt) throw new Error("O aparelho escolhido não aceita conexão Bluetooth LE.");
  const servidor = await disp.gatt.connect();
  const servico = await servidor.getPrimaryService(UUID_NUS).catch(() => {
    throw new Error("O aparelho escolhido não tem a porta serial Bluetooth LE (Nordic UART). Confira se é o receptor e se o modo BLE está ligado nele.");
  });
  const tx = await servico.getCharacteristic(UUID_NUS_TX);
  const rx = await servico.getCharacteristic(UUID_NUS_RX);
  let pedaco = 180; // cai para 20 (o mínimo do BLE) se o aparelho recusar
  let fechando = false;
  let aoCairGuardado: ((e: string | null) => void) | null = null;
  const caiu = () => {
    const f = aoCairGuardado; aoCairGuardado = null;
    f?.(fechando ? null : "A ligação Bluetooth com o receptor caiu. Confira se ele está ligado e perto.");
  };
  const escreverUm = (b: Uint8Array) =>
    rx.properties.writeWithoutResponse && rx.writeValueWithoutResponse ? rx.writeValueWithoutResponse(b)
      : rx.writeValueWithResponse ? rx.writeValueWithResponse(b) : rx.writeValue(b);
  return {
    tipo: "bluetooth", nome: disp.name || "Receptor Bluetooth",
    iniciar(aoBytes, aoCair) {
      aoCairGuardado = aoCair;
      disp.addEventListener("gattserverdisconnected", caiu);
      tx.addEventListener("characteristicvaluechanged", () => {
        const v = tx.value;
        if (v && v.byteLength) aoBytes(new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength)));
      });
      tx.startNotifications().catch((e) => { aoCairGuardado = null; aoCair(`O receptor não mandou dados pelo Bluetooth (${msgErro(e)}).`); });
    },
    async escrever(b) {
      for (let i = 0; i < b.length;) {
        const parte = b.subarray(i, i + pedaco);
        try {
          await escreverUm(parte);
          i += parte.length;
        } catch (e) {
          if (pedaco > 20) { pedaco = 20; continue; } // repete o mesmo trecho, menor
          throw e;
        }
      }
    },
    async fechar() {
      fechando = true;
      disp.removeEventListener("gattserverdisconnected", caiu);
      try { if (disp.gatt?.connected) disp.gatt.disconnect(); } catch { /* já desligado */ }
      const f = aoCairGuardado; aoCairGuardado = null; f?.(null);
    },
  };
}

// ---------------------------------------------------------------------------
// O receptor
// ---------------------------------------------------------------------------

/**
 * Cria o receptor. As leituras saem com fonte "receptor" e t = Date.now() (a
 * hora em que chegaram); tGps é a hora da GGA. A correção NTRIP fica ligada
 * mesmo se o receptor cair (os bytes dessa hora se perdem; RTCM velho não serve)
 * e é retomada com espera crescente quando a conexão cai.
 */
export function criarReceptor(op: OpcoesReceptor): Receptor {
  const agora = op.agora ?? (() => Date.now());
  const leitores = new Set<(l: Leitura) => void>();
  const errantes = new Set<(e: ErroGps) => void>();
  const ouvintes = new Set<() => void>();
  const nmea = criarLeitorNmea({ agora });

  let transporte: Transporte | null = null;
  let ultimaLeitura: Leitura | null = null;
  let fix: TipoFix | null = null, sats: number | null = null, hdop: number | null = null, idade: number | null = null;
  let erro: string | undefined;
  let ntrip: EstadoNtrip = NTRIP_DESLIGADO;

  let cfgNtrip: ConfigNtrip | null = null;
  let conexao: ConexaoNtrip | null = null;
  let tentativas = 0;
  let timerReabrir: ReturnType<typeof setTimeout> | null = null;
  let timerGga: ReturnType<typeof setInterval> | null = null;
  let ggaEnviadaNestaConexao = false;

  let retrato: EstadoReceptor = montar();
  function montar(): EstadoReceptor {
    return {
      conectado: !!transporte, transporte: transporte?.tipo ?? null, nome: transporte?.nome ?? null,
      ultimaLeitura, fix, sats, hdop, idadeCorrecaoS: idade, ntrip, ...(erro ? { erro } : {}),
    };
  }
  const mudou = () => { retrato = montar(); ouvintes.forEach((f) => f()); };

  // ----- escrita no receptor: uma de cada vez, na ordem
  let fila: Promise<void> = Promise.resolve();
  let naFila = 0;
  const escrever = (b: Uint8Array) => {
    const t = transporte;
    if (!t || !b.length) return;
    if (naFila + b.length > MAX_FILA_BYTES) return;
    naFila += b.length;
    fila = fila.then(() => (transporte === t ? t.escrever(b) : undefined)).catch(() => { /* a queda aparece na leitura */ }).finally(() => { naFila -= b.length; });
  };

  // ----- leitura
  const aoBytes = (b: Uint8Array) => {
    let algo = false;
    for (const ep of nmea.empurrar(b)) {
      algo = true;
      fix = ep.gga.fix; sats = ep.gga.sats; hdop = ep.gga.hdop; idade = ep.gga.idadeCorrecaoS;
      if (ep.leitura) {
        ultimaLeitura = ep.leitura;
        leitores.forEach((f) => f(ep.leitura!));
        if (conexao && cfgNtrip?.enviarGga && !ggaEnviadaNestaConexao) mandarGga();
      }
    }
    if (algo) mudou();
  };

  const ligarTransporte = (t: Transporte) => {
    if (transporte) void transporte.fechar();
    transporte = t;
    erro = undefined;
    nmea.limpar();
    t.iniciar(
      (b) => { if (transporte === t) aoBytes(b); },
      (motivo) => {
        if (transporte !== t) return;
        transporte = null;
        fix = null;
        if (motivo) {
          erro = motivo;
          errantes.forEach((f) => f({ tipo: "sem-sinal", mensagem: motivo }));
        }
        mudou();
      },
    );
    mudou();
  };

  const conectarCom = async (abrir: () => Promise<Transporte>) => {
    try {
      ligarTransporte(await abrir());
    } catch (e) {
      // fechar a janela de escolha não é erro para mostrar
      const nome = e instanceof Error ? e.name : "";
      if (nome === "NotFoundError" || nome === "AbortError") return;
      erro = `Não deu para ligar o receptor: ${msgErro(e)}`;
      mudou();
      throw e;
    }
  };

  // ----- NTRIP
  const mandarGga = () => {
    const l = ultimaLeitura;
    if (!conexao || !l || agora() - l.t > 30_000) return;
    conexao.enviarGga(montarGga(l));
    ggaEnviadaNestaConexao = true;
  };

  const pararTimers = () => {
    if (timerReabrir) { clearTimeout(timerReabrir); timerReabrir = null; }
    if (timerGga) { clearInterval(timerGga); timerGga = null; }
  };

  const abrirConexao = () => {
    const cfg = cfgNtrip;
    if (!cfg) return;
    ggaEnviadaNestaConexao = false;
    ntrip = { estado: "conectando", bytes: 0 };
    mudou();
    let esta: ConexaoNtrip | null = null;
    const aoEstado = (e: EstadoConexaoNtrip) => {
      if (conexao !== esta || cfgNtrip !== cfg) return;
      if (e.estado === "conectando") { ntrip = { ...ntrip, estado: "conectando", mensagem: undefined }; mudou(); return; }
      if (e.estado === "recebendo") { tentativas = 0; ntrip = { ...ntrip, estado: "recebendo", mensagem: undefined }; mudou(); return; }
      // erro: a conexão acabou
      conexao = null;
      if (timerGga) { clearInterval(timerGga); timerGga = null; }
      if (e.definitivo) {
        ntrip = { ...ntrip, estado: "erro", mensagem: e.mensagem };
      } else {
        const espera = Math.min(ESPERA_MAX_NTRIP_MS, 1000 * 2 ** tentativas);
        tentativas++;
        ntrip = { ...ntrip, estado: "erro", mensagem: `${e.mensagem} Tentando de novo em ${Math.round(espera / 1000)} s.` };
        timerReabrir = setTimeout(() => { timerReabrir = null; if (cfgNtrip === cfg) abrirConexao(); }, espera);
      }
      mudou();
    };
    const aoDados = (b: Uint8Array) => {
      if (conexao !== esta) return;
      escrever(b);
      ntrip = { ...ntrip, estado: "recebendo", bytes: ntrip.bytes + b.length, mensagem: undefined };
      mudou();
    };
    esta = op.abrirNtrip(cfg, aoDados, aoEstado);
    // o abrirNtrip pode já ter avisado erro (síncrono) antes de devolver a conexão
    if (cfgNtrip !== cfg || ntrip.estado === "erro") { if (ntrip.estado === "erro") esta.fechar(); return; }
    conexao = esta;
    if (cfg.enviarGga) {
      mandarGga();
      timerGga = setInterval(mandarGga, INTERVALO_GGA_MS);
    }
  };

  const desligarNtrip = () => {
    cfgNtrip = null;
    pararTimers();
    const c = conexao;
    conexao = null;
    c?.fechar();
    if (ntrip !== NTRIP_DESLIGADO) { ntrip = NTRIP_DESLIGADO; mudou(); }
  };

  return {
    iniciar(aoLer, aoErrar) {
      leitores.add(aoLer);
      errantes.add(aoErrar);
      return () => { leitores.delete(aoLer); errantes.delete(aoErrar); };
    },
    // o receptor manda a posição sozinho (1 a 10 por segundo): não há o que pedir
    pedirAgora() {},
    conectarSerial: () => conectarCom(op.abrirSerial ?? (() => abrirSerialDoNavegador())),
    conectarBluetooth: (o) => conectarCom(() => (op.abrirBluetooth ?? abrirBluetoothDoNavegador)(o)),
    conectar: ligarTransporte,
    async desconectar() {
      const t = transporte;
      transporte = null;
      fix = null;
      erro = undefined;
      mudou();
      if (t) await t.fechar().catch(() => {});
    },
    ligarNtrip(cfg) {
      desligarNtrip();
      cfgNtrip = { ...cfg };
      tentativas = 0;
      abrirConexao();
    },
    desligarNtrip,
    estado: () => retrato,
    assinar(f) { ouvintes.add(f); return () => { ouvintes.delete(f); }; },
  };
}
