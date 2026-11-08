// Modo diagnóstico do Medir no campo: grava TODAS as leituras do GPS (como
// chegaram, antes de qualquer filtro) para medir a precisão de verdade.
//
// Protocolo (docs/estudo-precisao-gps-campo.md, seção 6): parar 10 min sobre um
// marco SIGEF conhecido e andar o contorno de uma área já certificada. O arquivo
// baixado volta no laboratório (#/lab/campo, "Carregar trajeto") e no
// `scripts/avaliar-gps.mjs`, que compara o bruto com cada melhoria.
//
// Fica só no aparelho (localStorage), com teto de leituras: o diagnóstico não
// pode encher o armazenamento e derrubar a gravação da medição.
import type { Leitura } from "./tipos.ts";

export const CHAVE_DIAGNOSTICO = "vertces.campo.diag.v1";
export const MAX_LEITURAS_DIAG = 12000;

interface Armazem { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export interface ArquivoDiagnostico {
  formato: "vertces-campo-leituras";
  versao: 1;
  aparelho: string;
  inicio: string | null;
  leituras: Leitura[];
}

export function lerDiagnostico(arm: Armazem | null): Leitura[] {
  if (!arm) return [];
  try {
    const t = arm.getItem(CHAVE_DIAGNOSTICO);
    const v = t ? (JSON.parse(t) as unknown) : [];
    return Array.isArray(v) ? (v as Leitura[]).filter((l) => l && Number.isFinite(l.lon) && Number.isFinite(l.lat) && Number.isFinite(l.t)) : [];
  } catch {
    return [];
  }
}

/** Grava as leituras novas (devolve quantas há). Cheio, as mais velhas saem. */
export function gravarDiagnostico(arm: Armazem | null, novas: Leitura[]): number {
  if (!arm || !novas.length) return lerDiagnostico(arm).length;
  const todas = [...lerDiagnostico(arm), ...novas.map(enxuta)].slice(-MAX_LEITURAS_DIAG);
  try {
    arm.setItem(CHAVE_DIAGNOSTICO, JSON.stringify(todas));
  } catch {
    // armazenamento cheio: guarda a metade mais nova
    try { arm.setItem(CHAVE_DIAGNOSTICO, JSON.stringify(todas.slice(-Math.floor(todas.length / 2)))); } catch { /* sem espaço */ }
  }
  return todas.length;
}

export function apagarDiagnostico(arm: Armazem | null): void {
  try { arm?.removeItem(CHAVE_DIAGNOSTICO); } catch { /* nada */ }
}

/** Só os campos que importam (sem undefined), arredondados ao que o GPS sabe. */
function enxuta(l: Leitura): Leitura {
  const r = (x: number, c: number) => Math.round(x * 10 ** c) / 10 ** c;
  const o: Leitura = { lon: r(l.lon, 9), lat: r(l.lat, 9), precisao: l.precisao == null ? null : r(l.precisao, 3), t: l.t };
  if (l.alt != null) o.alt = r(l.alt, 2);
  if (l.tGps != null) o.tGps = l.tGps;
  if (l.fonte) o.fonte = l.fonte;
  if (l.fix) o.fix = l.fix;
  if (l.sats != null) o.sats = l.sats;
  if (l.hdop != null) o.hdop = l.hdop;
  if (l.idadeCorrecaoS != null) o.idadeCorrecaoS = l.idadeCorrecaoS;
  return o;
}

export function arquivoDiagnostico(leituras: Leitura[], aparelho: string): ArquivoDiagnostico {
  return {
    formato: "vertces-campo-leituras", versao: 1, aparelho,
    inicio: leituras.length ? new Date(leituras[0].t).toISOString() : null,
    leituras,
  };
}

/** Lê um arquivo do diagnóstico (ou um JSON que seja só a lista). null = não é. */
export function lerArquivoDiagnostico(texto: string): Leitura[] | null {
  try {
    const v = JSON.parse(texto) as unknown;
    const lista = Array.isArray(v) ? v : (v as ArquivoDiagnostico)?.leituras;
    if (!Array.isArray(lista)) return null;
    const ok = (lista as Leitura[]).filter((l) => l && Number.isFinite(l.lon) && Number.isFinite(l.lat) && Number.isFinite(l.t));
    return ok.length ? ok : null;
  } catch {
    return null;
  }
}

/** Erro horizontal das leituras contra um ponto conhecido: média, 68% e 95% (m). */
export function errosContra(leituras: Leitura[], conhecido: { lon: number; lat: number }, distancia: (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => number) {
  const e = leituras.map((l) => distancia(l, conhecido)).sort((a, b) => a - b);
  const q = (p: number) => (e.length ? e[Math.min(e.length - 1, Math.floor(p * e.length))] : NaN);
  return { n: e.length, mediaM: e.reduce((s, x) => s + x, 0) / (e.length || 1), p68M: q(0.68), p95M: q(0.95), maxM: e[e.length - 1] ?? NaN };
}
