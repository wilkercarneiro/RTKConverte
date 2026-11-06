// Laboratórios (só no npm run dev): para onde a tela iria, no laboratório da tela
// de destino — assim o fluxo encadeado (Campo → Consulta → CAR) roda sem login.
import type { Rota } from "./rota";

export function laboratorioDe(r: Rota): string | null {
  if (r.t === "consulta") return "#/lab/consulta";
  if (r.t === "novo" && r.chave === "car") return "#/lab/car/novo";
  return null;
}
