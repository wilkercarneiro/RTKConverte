// O que o receptor GNSS fala: sentenças NMEA 0183, uma por linha, em ASCII.
// Aqui só a parte pura — juntar os bytes em linhas, conferir o checksum, ler
// GGA/RMC/GST/GSA e virar `Leitura`. Quem traz os bytes (Bluetooth, USB) é o
// receptor.ts; este módulo não conhece navegador nem relógio (o "agora" vem
// de fora), e por isso é testado no Node.
//
// Referência: NMEA 0183 v4.11 e os manuais u-blox/Septentrio/Quectel. Os
// receptores mandam o mesmo formato com outro "talker" na frente: GP (GPS),
// GN (vários sistemas juntos), GL (GLONASS), GA (Galileo), GB/BD (BeiDou),
// GQ (QZSS), GI (NavIC). Todos valem.
import type { Leitura, TipoFix } from "./tipos.ts";

// ---------------------------------------------------------------------------
// Linhas
// ---------------------------------------------------------------------------

/** Linha maior que isso é lixo (binário do receptor, RTCM ecoado): descartada. */
export const MAX_LINHA_NMEA = 512;

/**
 * Junta os pedaços que chegam do receptor em linhas inteiras. O Bluetooth
 * entrega no meio da sentença (20 bytes por vez no BLE): o resto fica guardado
 * até o fim de linha (LF; o CR antes dele sai). Cada linha devolvida começa no
 * último "$" — o que vem antes é lixo de outra coisa (UBX, RTCM).
 */
export function criarMontadorLinhas(maxLinha = MAX_LINHA_NMEA): { empurrar(b: Uint8Array | string): string[]; limpar(): void } {
  let resto = "";
  return {
    empurrar(b) {
      // latin1 byte a byte: binário não quebra a decodificação (NMEA é ASCII)
      let texto = "";
      if (typeof b === "string") texto = b;
      else for (let i = 0; i < b.length; i++) texto += String.fromCharCode(b[i]);
      const saida: string[] = [];
      let ini = 0;
      for (;;) {
        const fim = texto.indexOf("\n", ini);
        if (fim < 0) break;
        const linha = (resto + texto.slice(ini, fim)).replace(/\r+$/, "");
        resto = "";
        ini = fim + 1;
        const d = linha.lastIndexOf("$");
        if (d >= 0 && linha.length - d <= maxLinha) saida.push(linha.slice(d));
      }
      resto += texto.slice(ini);
      // sem fim de linha por tempo demais: é binário; guarda só do último "$" (se couber)
      if (resto.length > maxLinha) {
        const d = resto.lastIndexOf("$");
        resto = d >= 0 && resto.length - d <= maxLinha ? resto.slice(d) : "";
      }
      return saida;
    },
    limpar() { resto = ""; },
  };
}

/** XOR de tudo entre "$" e "*", em 2 dígitos hexadecimais maiúsculos. */
export function checksumNmea(corpo: string): string {
  let x = 0;
  for (let i = 0; i < corpo.length; i++) x ^= corpo.charCodeAt(i) & 0xff;
  return x.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * A linha tem "$corpo*HH" e o HH bate. Sentença sem checksum é recusada: todo
 * receptor manda, e linha sem ele quase sempre é linha cortada.
 */
export function conferirChecksum(linha: string): boolean {
  const m = /^\$([^*$]*)\*([0-9A-Fa-f]{2})\s*$/.exec(linha);
  return !!m && checksumNmea(m[1]) === m[2].toUpperCase();
}

// ---------------------------------------------------------------------------
// Sentenças
// ---------------------------------------------------------------------------

export interface Gga {
  tipo: "GGA";
  talker: string;
  /** hora UTC do GPS em segundos desde a meia-noite (null = em branco) */
  segundosDia: number | null;
  lat: number | null;
  lon: number | null;
  /** campo de qualidade cru (0–9) */
  qualidade: number;
  fix: TipoFix;
  sats: number | null;
  hdop: number | null;
  /** altitude acima do geoide (MSL), metros */
  altMsl: number | null;
  /** separação geoidal (elipsoide − geoide), metros */
  separacao: number | null;
  idadeCorrecaoS: number | null;
  estacao: string | null;
}

export interface DataUtc { ano: number; mes: number; dia: number }

export interface Rmc {
  tipo: "RMC";
  talker: string;
  segundosDia: number | null;
  /** status A (válido) ou V (aviso) */
  valido: boolean;
  lat: number | null;
  lon: number | null;
  data: DataUtc | null;
  velocidadeNos: number | null;
  rumoGraus: number | null;
}

export interface Gst {
  tipo: "GST";
  talker: string;
  segundosDia: number | null;
  rms: number | null;
  /** desvio-padrão (1σ), metros */
  desvioLat: number | null;
  desvioLon: number | null;
  desvioAlt: number | null;
}

export interface Gsa {
  tipo: "GSA";
  talker: string;
  /** 1 = sem posição, 2 = 2D, 3 = 3D */
  modo: number | null;
  sats: number;
  pdop: number | null;
  hdop: number | null;
  vdop: number | null;
}

export type Sentenca = Gga | Rmc | Gst | Gsa;

/** Qualidade da GGA → tipo de fix. 6 é "estimado" (dead reckoning): conta como autônomo. */
export function fixDaQualidade(q: number): TipoFix {
  switch (q) {
    case 4: return "rtk-fixo";
    case 5: return "rtk-flutuante";
    case 2: case 9: return "dgps";
    case 1: case 3: case 6: case 7: case 8: return "autonomo";
    default: return "sem-fix";
  }
}

/** O caminho de volta (GGA que mandamos ao caster). */
export function qualidadeDoFix(f: TipoFix | null | undefined): number {
  switch (f) {
    case "rtk-fixo": return 4;
    case "rtk-flutuante": return 5;
    case "dgps": return 2;
    case "sem-fix": return 0;
    default: return 1;
  }
}

const num = (s: string | undefined): number | null => {
  if (s == null || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** "hhmmss.ss" → segundos do dia. */
function hora(s: string | undefined): number | null {
  if (!s || !/^\d{6}(\.\d+)?$/.test(s)) return null;
  const h = Number(s.slice(0, 2)), m = Number(s.slice(2, 4)), seg = Number(s.slice(4));
  if (h > 23 || m > 59 || seg >= 61) return null;
  return h * 3600 + m * 60 + seg;
}

/** "ddmm.mmmm" + hemisfério → graus decimais (graus = 2 dígitos na latitude, 3 na longitude). */
function coordenada(v: string | undefined, hemi: string | undefined, digitosGraus: 2 | 3): number | null {
  if (!v || !hemi) return null;
  const re = digitosGraus === 2 ? /^(\d{2})(\d{2}(?:\.\d+)?)$/ : /^(\d{3})(\d{2}(?:\.\d+)?)$/;
  const m = re.exec(v);
  if (!m) return null;
  const min = Number(m[2]);
  if (min >= 60) return null;
  const g = Number(m[1]) + min / 60;
  const sinal = hemi === "S" || hemi === "W" ? -1 : hemi === "N" || hemi === "E" ? 1 : 0;
  if (!sinal) return null;
  const lim = digitosGraus === 2 ? 90 : 180;
  return g > lim ? null : sinal * g;
}

function data(s: string | undefined): DataUtc | null {
  if (!s || !/^\d{6}$/.test(s)) return null;
  const dia = Number(s.slice(0, 2)), mes = Number(s.slice(2, 4)), aa = Number(s.slice(4, 6));
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  // NMEA só dá 2 dígitos do ano: 80–99 = 19xx (receptor antigo com o rollover), o resto 20xx
  return { ano: aa >= 80 ? 1900 + aa : 2000 + aa, mes, dia };
}

/**
 * Lê uma linha NMEA (com o checksum certo). Devolve null para checksum errado,
 * sentença que não é GGA/RMC/GST/GSA ou campos estragados.
 */
export function analisarSentenca(linha: string): Sentenca | null {
  const s = linha.trim();
  if (!conferirChecksum(s)) return null;
  const campos = s.slice(1, s.lastIndexOf("*")).split(",");
  const m = /^([A-Z]{2})(GGA|RMC|GST|GSA)$/.exec(campos[0]);
  if (!m) return null;
  const talker = m[1];
  const c = campos;
  switch (m[2]) {
    case "GGA": {
      if (c.length < 10) return null;
      const qualidade = num(c[6]) ?? 0;
      return {
        tipo: "GGA", talker,
        segundosDia: hora(c[1]),
        lat: coordenada(c[2], c[3], 2),
        lon: coordenada(c[4], c[5], 3),
        qualidade, fix: fixDaQualidade(qualidade),
        sats: num(c[7]),
        hdop: num(c[8]),
        altMsl: num(c[9]),
        separacao: num(c[11]),
        idadeCorrecaoS: num(c[13]),
        estacao: c[14]?.trim() ? c[14].trim() : null,
      };
    }
    case "RMC": {
      if (c.length < 10) return null;
      return {
        tipo: "RMC", talker,
        segundosDia: hora(c[1]),
        valido: c[2] === "A",
        lat: coordenada(c[3], c[4], 2),
        lon: coordenada(c[5], c[6], 3),
        velocidadeNos: num(c[7]),
        rumoGraus: num(c[8]),
        data: data(c[9]),
      };
    }
    case "GST": {
      if (c.length < 9) return null;
      return {
        tipo: "GST", talker,
        segundosDia: hora(c[1]),
        rms: num(c[2]),
        desvioLat: num(c[6]),
        desvioLon: num(c[7]),
        desvioAlt: num(c[8]),
      };
    }
    case "GSA": {
      if (c.length < 17) return null;
      let sats = 0;
      for (let i = 3; i <= 14; i++) if (c[i]?.trim()) sats++;
      return { tipo: "GSA", talker, modo: num(c[2]), sats, pdop: num(c[15]), hdop: num(c[16]), vdop: num(c[17]) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Precisão e Leitura
// ---------------------------------------------------------------------------

/**
 * ESTIMATIVA do raio de 68% (m) quando o receptor não manda GST: HDOP × um
 * fator típico de cada solução. Não é medida — é a ordem de grandeza que os
 * fabricantes publicam (RTK fixo ~1–2 cm, flutuante decímetros, DGPS/SBAS
 * ~0,5–1 m, autônomo 2–3 m) para a tela não chamar de "ótimo" um ponto que não
 * é. Receptor de topografia de verdade manda GST; aí vale a GST.
 */
export const FATOR_PRECISAO: Record<Exclude<TipoFix, "sem-fix">, number> = {
  "rtk-fixo": 0.015,
  "rtk-flutuante": 0.25,
  dgps: 0.7,
  autonomo: 2.5,
};

/** Sem HDOP na GGA nem na GSA, considera 1 (céu bom) na estimativa. */
export function precisaoEstimada(fix: TipoFix, hdop: number | null): number | null {
  if (fix === "sem-fix") return null;
  const h = hdop != null && Number.isFinite(hdop) && hdop > 0 ? hdop : 1;
  return h * FATOR_PRECISAO[fix];
}

/** Raio de 68% pela GST: √(σlat² + σlon²). null se a GST não trouxe os dois. */
export function precisaoDaGst(g: Gst | null | undefined): number | null {
  if (!g || g.desvioLat == null || g.desvioLon == null) return null;
  return Math.sqrt(g.desvioLat ** 2 + g.desvioLon ** 2);
}

const DIA_MS = 86_400_000;

/**
 * Hora do GPS em ms (UTC). A GGA só tem a hora: o dia vem da RMC mais recente
 * ou, sem RMC, do relógio do aparelho — corrigido na virada da meia-noite
 * (diferença de mais de 12 h para a referência = dia vizinho).
 */
export function horaGps(segundosDia: number, dataRmc: { data: DataUtc; segundosDia: number | null } | null, agora: number): number {
  let base: number, ref: number;
  if (dataRmc) {
    base = Date.UTC(dataRmc.data.ano, dataRmc.data.mes - 1, dataRmc.data.dia);
    ref = base + (dataRmc.segundosDia ?? segundosDia) * 1000;
  } else {
    const d = new Date(agora);
    base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    ref = agora;
  }
  let t = base + Math.round(segundosDia * 1000);
  if (t - ref > DIA_MS / 2) t -= DIA_MS;
  else if (ref - t > DIA_MS / 2) t += DIA_MS;
  return t;
}

/** Diferença de hora do dia, dando a volta na meia-noite. */
function difSegundos(a: number, b: number): number {
  const d = Math.abs(a - b) % 86400;
  return Math.min(d, 86400 - d);
}

export interface ContextoLeitura {
  /** a RMC mais recente (só a data e a hora dela importam) */
  rmc?: { data: DataUtc; segundosDia: number | null } | null;
  /** a GST da mesma época (até 1,5 s de diferença da GGA) */
  gst?: Gst | null;
  /** HDOP da GSA, se a GGA veio sem */
  hdopGsa?: number | null;
  /** ms desde 1970 (Date.now()) */
  agora: number;
}

/**
 * A GGA vira Leitura (fonte "receptor"). Sem latitude/longitude ou sem fix:
 * null — não há posição para usar.
 * - alt: altitude MSL + separação geoidal = elipsoidal; sem a separação, fica
 *   a altitude que o receptor deu.
 * - precisao: GST da mesma época; senão a estimativa por HDOP (precisaoEstimada).
 */
export function leituraDaGga(g: Gga, ctx: ContextoLeitura): Leitura | null {
  if (g.lat == null || g.lon == null || g.fix === "sem-fix") return null;
  const hdop = g.hdop ?? ctx.hdopGsa ?? null;
  const gst = ctx.gst && g.segundosDia != null && ctx.gst.segundosDia != null && difSegundos(ctx.gst.segundosDia, g.segundosDia) <= 1.5 ? ctx.gst : null;
  const precisao = precisaoDaGst(gst) ?? precisaoEstimada(g.fix, hdop);
  const alt = g.altMsl == null ? null : g.altMsl + (g.separacao ?? 0);
  return {
    lon: g.lon, lat: g.lat,
    precisao,
    alt,
    t: ctx.agora,
    tGps: g.segundosDia == null ? null : horaGps(g.segundosDia, ctx.rmc ?? null, ctx.agora),
    fonte: "receptor",
    fix: g.fix,
    sats: g.sats,
    hdop,
    idadeCorrecaoS: g.idadeCorrecaoS,
  };
}

/** Uma época do receptor: a GGA e, se havia posição, a Leitura dela. */
export interface EpocaNmea {
  gga: Gga;
  leitura: Leitura | null;
}

/**
 * Leitor com memória: guarda a última RMC (data), GST (precisão) e GSA (HDOP)
 * e, a cada GGA, devolve a época. `agora` é o relógio (testes passam o deles).
 */
export function criarLeitorNmea(op: { agora?: () => number } = {}) {
  const agora = op.agora ?? (() => Date.now());
  const montador = criarMontadorLinhas();
  let rmc: { data: DataUtc; segundosDia: number | null } | null = null;
  let gst: Gst | null = null;
  let hdopGsa: number | null = null;
  const linha = (texto: string): EpocaNmea | null => {
    const s = analisarSentenca(texto);
    if (!s) return null;
    switch (s.tipo) {
      case "RMC": if (s.data) rmc = { data: s.data, segundosDia: s.segundosDia }; return null;
      case "GST": gst = s; return null;
      case "GSA": if (s.hdop != null) hdopGsa = s.hdop; return null;
      case "GGA": return { gga: s, leitura: leituraDaGga(s, { rmc, gst, hdopGsa, agora: agora() }) };
    }
  };
  return {
    linha,
    /** bytes crus do receptor → as épocas completas que eles fecharam */
    empurrar(b: Uint8Array | string): EpocaNmea[] {
      const saida: EpocaNmea[] = [];
      for (const l of montador.empurrar(b)) { const e = linha(l); if (e) saida.push(e); }
      return saida;
    },
    limpar() { montador.limpar(); rmc = null; gst = null; hdopGsa = null; },
  };
}

// ---------------------------------------------------------------------------
// GGA de volta (para o caster)
// ---------------------------------------------------------------------------

function grausMinutos(v: number, digitosGraus: 2 | 3): string {
  const a = Math.abs(v);
  let g = Math.floor(a);
  // 5 casas no minuto ≈ 2 cm: sobra para o caster e a linha fica abaixo dos 82 caracteres do NMEA
  let min = Number(((a - g) * 60).toFixed(5));
  if (min >= 60) { g += 1; min -= 60; }
  return String(g).padStart(digitosGraus, "0") + min.toFixed(5).padStart(8, "0");
}

/**
 * Monta a GGA da posição para o caster (rede VRS/MAC só manda correção depois
 * de saber onde o receptor está). Hora = tGps (ou t), talker GP, que todo
 * caster aceita. A altitude vai como está, com separação 0 — o caster só usa a
 * posição aproximada.
 */
export function montarGga(l: Pick<Leitura, "lat" | "lon" | "t"> & Partial<Leitura>): string {
  const d = new Date(l.tGps ?? l.t);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = (d.getUTCSeconds() + d.getUTCMilliseconds() / 1000).toFixed(2).padStart(5, "0");
  const q = qualidadeDoFix(l.fix ?? "autonomo") || 1;
  const sats = l.sats != null && Number.isFinite(l.sats) ? String(Math.max(0, Math.min(99, Math.round(l.sats)))).padStart(2, "0") : "08";
  const hdop = l.hdop != null && Number.isFinite(l.hdop) ? l.hdop.toFixed(1) : "1.0";
  const alt = l.alt != null && Number.isFinite(l.alt) ? l.alt.toFixed(3) : "0.000";
  const corpo = [
    "GPGGA", `${hh}${mm}${ss}`,
    grausMinutos(l.lat, 2), l.lat < 0 ? "S" : "N",
    grausMinutos(l.lon, 3), l.lon < 0 ? "W" : "E",
    String(q), sats, hdop, alt, "M", "0.0", "M", "", "",
  ].join(",");
  return `$${corpo}*${checksumNmea(corpo)}`;
}
