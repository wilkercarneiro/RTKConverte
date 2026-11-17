// Configuração do GPS da empresa: o equipamento GNSS de sempre e a precisão
// (σ) que ele entrega no método usado. Mora em `config_empresa` (key/value por
// escritório, sem migração) e serve à conferência do TXT: arquivo que chega sem
// σ (KML, GPX, planilha 2D, DXF…) usa esta precisão com um clique, em vez de a
// pessoa digitar a cada serviço.
import { supabase } from "./supabase";
import { salvarConfigEmpresa } from "./escritorio";

export const CHAVES_GPS = ["gps_equipamento", "gps_sigma_pos", "gps_sigma_h"] as const;

export interface ConfigGps {
  /** "Receptor GNSS RTK CHC i73", livre */
  equipamento: string;
  /** σ horizontal e vertical (m) */
  sigmaPos: number;
  sigmaH: number;
}

/** "0,05" → 0.05; fora de (0, 10] m → null (a mesma faixa que o parse-txt aceita). */
export function lerSigma(t: string | null | undefined): number | null {
  const v = Number(String(t ?? "").trim().replace(",", "."));
  return Number.isFinite(v) && v > 0 && v <= 10 ? v : null;
}

/** 0.05 → "0,05" (até 3 casas, sem zeros sobrando). */
export const fmtSigma = (v: number): string => String(Number(v.toFixed(3))).replace(".", ",");

/** A configuração salva, ou null quando a empresa ainda não informou a precisão. */
export async function carregarConfigGps(): Promise<ConfigGps | null> {
  try {
    const { data, error } = await supabase.from("config_empresa").select("key, value").in("key", [...CHAVES_GPS]);
    if (error) return null;
    const m = new Map(((data ?? []) as { key: string; value: string }[]).map((l) => [l.key, l.value]));
    const sigmaPos = lerSigma(m.get("gps_sigma_pos")), sigmaH = lerSigma(m.get("gps_sigma_h"));
    if (sigmaPos === null || sigmaH === null) return null;
    return { equipamento: (m.get("gps_equipamento") ?? "").trim(), sigmaPos, sigmaH };
  } catch {
    return null;
  }
}

/** Grava a configuração; devolve a mensagem de erro (ou null). */
export function salvarConfigGps(c: ConfigGps): Promise<string | null> {
  return salvarConfigEmpresa([
    { key: "gps_equipamento", value: c.equipamento.trim() },
    { key: "gps_sigma_pos", value: fmtSigma(c.sigmaPos) },
    { key: "gps_sigma_h", value: fmtSigma(c.sigmaH) },
  ]);
}
