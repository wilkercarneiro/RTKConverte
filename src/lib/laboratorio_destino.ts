// Laboratórios (só no npm run dev): para onde a tela iria, no laboratório da tela
// de destino — assim o fluxo encadeado (Campo → Consulta → CAR) roda sem login.
import type { Rota } from "./rota";

export function laboratorioDe(r: Rota): string | null {
  if (r.t === "consulta") return "#/lab/consulta";
  if (r.t === "novo" && r.chave === "car") return "#/lab/car/novo";
  return null;
}

/** No laboratório, o endereço de uma ferramenta vira o do laboratório dela (#/consulta?q=… → #/lab/consulta?q=…). Fora dele, null. */
export function hashNoLaboratorio(hash: string): string | null {
  if (typeof location === "undefined" || !location.hash.startsWith("#/lab/")) return null;
  const m = /^#\/(consulta|campo)(\?.*)?$/.exec(hash);
  return m ? `#/lab/${m[1]}${m[2] ?? ""}` : null;
}
