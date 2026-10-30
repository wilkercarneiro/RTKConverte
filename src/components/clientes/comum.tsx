// Peças pequenas da lista e da página do cliente.
import type { Progresso } from "../../lib/progresso";
import { iniciaisDe, tomAvatar } from "./qualificacao";

export const IC = {
  whatsapp: "M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.4A8.4 8.4 0 1 1 21 11.5zM8.5 9.5c.3 2.6 2.4 4.8 5 5.2l1.2-1.3 2 .9-.4 1.6c-3.9.3-8.6-4.3-8.3-8.3l1.6-.4.9 2z",
  email: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM22 7l-10 6.5L2 7",
  copiar: "M9 9h11v11H9zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1",
  mais: "M12 5v14M5 12h14",
  telefone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",
  elo: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  pino: "M12 22s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5",
  ok: "M20 6 9 17l-5-5",
  lixo: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  ir: "M5 12h14M13 6l6 6-6 6",
  baixo: "m6 9 6 6 6-6",
  pessoa: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  predio: "M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h2a2 2 0 0 1 2 2v10M2 21h20M8 7h4M8 11h4M8 15h4",
  historico: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2",
  alerta: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
};

/** Avatar do cliente: iniciais num tom fixo por nome (PJ vira quadrado). */
export function Avatar({ nome, pj, grande }: { nome: string; pj?: boolean; grande?: boolean }) {
  return (
    <span className={`cl-avatar tom-${tomAvatar(nome)}${pj ? " pj" : ""}${grande ? " grande" : ""}`} aria-hidden="true">
      {iniciaisDe(nome) || "?"}
    </span>
  );
}

/** Os pontos de etapa do serviço (mesmo desenho do Início). */
export function Pontos({ p }: { p: Progresso }) {
  return (
    <span className="progresso-servico" title={`${p.etapas.filter(Boolean).length} de ${p.etapas.length} etapas`}>
      {p.etapas.map((f, i) => <i key={i} className={f ? "feito" : i === p.atual ? "atual" : ""} />)}
    </span>
  );
}

/** Barra fina de proporção (concluídos / total). */
export function Barrinha({ valor, total, tom }: { valor: number; total: number; tom?: "alerta" }) {
  const pct = total > 0 ? Math.round((valor / total) * 100) : 0;
  return (
    <span className={`cl-barrinha${tom ? ` ${tom}` : ""}`} role="img" aria-label={`${pct}%`}>
      <i style={{ width: `${pct}%` }} />
    </span>
  );
}
