// Números e ângulos como aparecem nos arquivos de aparelho. Nada aqui "adivinha"
// um valor: o texto casa com um padrão inteiro ou a leitura falha (null).

const RE_VIRGULA = /^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/;
const RE_PONTO = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)$/;
const RE_CIENTIFICO = /^[+-]?\d+(?:[.,]\d+)?[eE][+-]?\d+$/;

/** Limpa aspas e a unidade "m" grudada ("497318.611m"). */
export function limparToken(bruto: string): string {
  let s = bruto.trim();
  if (s.length >= 2 && ((s[0] === "\"" && s.endsWith("\"")) || (s[0] === "'" && s.endsWith("'")))) s = s.slice(1, -1).trim();
  const m = s.match(/^(.*\d)\s*m$/i);
  if (m) s = m[1];
  // rótulo colado ao valor, no estilo chave=valor: "X:491199.572", "N=8658085.635", "PT=1"
  const rot = s.match(/^[A-Za-zÀ-ÿσ_][A-Za-zÀ-ÿσ_ ]{0,14}\s*[:=]\s*(.+)$/);
  if (rot && !/[°'"]/.test(s)) s = rot[1].trim();
  return s;
}

/** Lê um número com o decimal informado. Vazio ou fora do padrão → null. */
export function lerNumero(bruto: string, decimal: "," | "."): number | null {
  const s = limparToken(bruto);
  if (!s) return null;
  let v: number;
  if (RE_CIENTIFICO.test(s)) v = Number(s.replace(",", "."));
  else if (decimal === ",") {
    if (!RE_VIRGULA.test(s)) return null;
    v = Number(s.replace(/\./g, "").replace(",", "."));
  } else {
    if (!RE_PONTO.test(s)) return null;
    v = Number(s.replace(/,/g, ""));
  }
  return Number.isFinite(v) ? v : null;
}

/** O token é um número em algum dos dois decimais? (detector) */
export function pareceNumero(bruto: string): boolean {
  return lerNumero(bruto, ".") !== null || lerNumero(bruto, ",") !== null;
}

export interface Angulo {
  graus: number;            // graus decimais com sinal (S e W negativos)
  hemisferioExplicito: boolean; // veio sinal "-" ou letra S/N/W/O/E/L
  gms: boolean;             // veio em graus/minutos/segundos
}

const RE_GMS = /^(\d{1,3})\s*(?:°|º|d|:|\s)\s*(\d{1,2})\s*(?:'|m|:|\s)\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:"|''|s)?$/i;
const RE_GM = /^(\d{1,3})\s*(?:°|º|d|:|\s)\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:'|m)?$/i;

/**
 * Lê latitude/longitude: "-15.553038", "15,553038 S", "15°33'18,938\"S",
 * "S 15°33'18.938\"", "-15 33 18.9380", "39:05:04.737W", "15d33m18.9s",
 * "15°33.3156'". Letras: N/S para latitude; E/L e W/O para longitude.
 */
export function lerAngulo(bruto: string, eixo: "lat" | "lon", decimal: "," | "." = "."): Angulo | null {
  let s = limparToken(bruto).toUpperCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  // "15D33M18.9S": D, M e S são marcadores de grau/minuto/segundo, não hemisfério
  s = s.replace(/^([+-]?\d{1,3})\s*D\s*(\d{1,2})\s*M\s*(\d{1,2}(?:[.,]\d+)?)\s*S/, "$1°$2'$3\"");
  let neg = false, explicito = false;
  const letras = eixo === "lat" ? { neg: ["S"], pos: ["N"] } : { neg: ["W", "O"], pos: ["E", "L"] };
  const pega = (ch: string): boolean => {
    if (letras.neg.includes(ch)) { neg = true; explicito = true; return true; }
    if (letras.pos.includes(ch)) { explicito = true; return true; }
    return false;
  };
  if (/^[A-Z]/.test(s)) {
    if (!pega(s[0])) return null;
    s = s.slice(1).trim();
  }
  if (/[A-Z]$/.test(s)) {
    if (!pega(s[s.length - 1])) return null;
    s = s.slice(0, -1).trim();
  }
  if (/[A-Z]/.test(s)) return null;
  if (s.startsWith("-")) { neg = true; explicito = true; s = s.slice(1).trim(); }
  else if (s.startsWith("+")) { explicito = true; s = s.slice(1).trim(); }

  let graus: number | null = null, gms = false;
  const g = s.match(RE_GMS);
  if (g) {
    const d = Number(g[1]), m = Number(g[2]), sec = Number(g[3].replace(",", "."));
    if (m >= 60 || sec >= 60) return null;
    graus = d + m / 60 + sec / 3600; gms = true;
  } else {
    const gm = s.match(RE_GM);
    if (gm && /[°º'd:]|\s/i.test(s)) {
      const d = Number(gm[1]), m = Number(gm[2].replace(",", "."));
      if (m >= 60) return null;
      graus = d + m / 60; gms = true;
    } else {
      graus = lerNumero(s, decimal) ?? lerNumero(s, decimal === "." ? "," : ".");
    }
  }
  if (graus === null || !Number.isFinite(graus)) return null;
  if (graus > (eixo === "lat" ? 90 : 180)) return null;
  return { graus: neg ? -graus : graus, hemisferioExplicito: explicito, gms };
}
