// Peças pequenas do painel do superadmin: ícones, formatação, KPI, status.
import type { ReactNode } from "react";
import type { Empresa, Plano, StatusEmpresa } from "../../lib/admin";
import { formatarCnpj, formatarTelefone } from "../../../supabase/functions/_shared/cnpj.ts";

export const ICO = {
  visao: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z",
  empresas: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01",
  planos: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  recursos: "M4 6h16M4 12h16M4 18h10M18 16l2 2 3-4",
  contatos: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  config: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12h2M3 12h2M12 3v2M12 19v2M17 7l1.5-1.5M5.5 18.5 7 17M17 17l1.5 1.5M5.5 5.5 7 7",
  sistema: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
  usuarios: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  servicos: "M9 4h6v3H9zM6 6H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1M8 12h8M8 16h5",
  alerta: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  pausa: "M10 15V9M14 15V9M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z",
  mais: "M12 5v14M5 12h14",
  marca: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5",
  // central de suporte e tutoriais (0029)
  suporte: "M3 14v-2a9 9 0 0 1 18 0v2M21 14v3a2 2 0 0 1-2 2h-2v-6h4M3 14v3a2 2 0 0 0 2 2h2v-6H3M19 19a3 3 0 0 1-3 3h-3",
  tutoriais: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM10 9.2v5.6l4.6-2.8z",
  caixa: "M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z",
  relogio: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  estrela: "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z",
  anexo: "M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5",
  arquivo: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  baixar: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01",
  cadeado: "M6 11h12a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1zM8 11V7a4 4 0 0 1 8 0v4",
  voltar: "M19 12H5M12 19l-7-7 7-7",
  baixo: "M6 9l6 6 6-6",
  fechar: "M18 6 6 18M6 6l12 12",
  editar: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z",
  lixeira: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6",
  atualizar: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
  enviar: "M22 2 11 13M22 2l-7 20-4-9-9-4z",
  externo: "M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
};

export function Ico({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function Kpi({ rotulo, valor, detalhe, icone, tom, onClick }: {
  rotulo: string; valor: ReactNode; detalhe?: ReactNode; icone: string;
  tom?: "alerta" | "perigo" | "escuro"; onClick?: () => void;
}) {
  const corpo = (
    <>
      <span className="rot">{rotulo}</span>
      <span className="ico"><Ico d={icone} /></span>
      <span className="val">{valor}</span>
      {detalhe && <span className="det">{detalhe}</span>}
    </>
  );
  return onClick
    ? <button type="button" className={`sa-kpi ${tom ?? ""}`} onClick={onClick}>{corpo}</button>
    : <div className={`sa-kpi ${tom ?? ""}`}>{corpo}</div>;
}

export const ROTULO_STATUS: Record<StatusEmpresa, string> = {
  ativo: "Ativa", aguardando_pagamento: "Esperando pagamento", suspenso: "Suspensa", cancelado: "Cancelada",
};
// aguardando_pagamento usa o amarelo do "suspenso": é acesso parado, mas por pagamento
export const StatusPill = ({ status }: { status: StatusEmpresa }) =>
  <span className={`sa-pill ${status === "aguardando_pagamento" ? "suspenso" : status}`}>{ROTULO_STATUS[status]}</span>;

export function PlanoTag({ planoId, planos }: { planoId: string | null; planos: Plano[] }) {
  const p = planos.find((x) => x.id === planoId);
  if (!p) return <span className="sa-pill neutro">Sem plano</span>;
  return <span className="sa-plano"><i style={{ background: p.cor }} />{p.nome}</span>;
}

export const fmtCnpj = (c: string | null) => (c ? formatarCnpj(c) : "—");
export const fmtTel = (t: string | null) => (t ? formatarTelefone(t) : "—");
export const fmtData = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
export const fmtNum = (n: number) => n.toLocaleString("pt-BR");

/** "há 3 dias", "hoje", "nunca". */
export function quando(d: string | null): string {
  if (!d) return "nunca";
  const dias = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  return meses < 12 ? `há ${meses} ${meses === 1 ? "mês" : "meses"}` : `há ${Math.floor(meses / 12)} ano(s)`;
}

/** Relativo e curto, para listas: "agora", "12 min", "3 h", "2 d", "12 de out.". */
export function haQuanto(d: string | null): string {
  if (!d) return "—";
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d`;
  return new Date(d).toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

/** Duração legível: "< 1 min", "35 min", "2 h 10 min", "1 d 4 h". */
export function duracao(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const dd = Math.floor(h / 24), hh = h % 24;
  return hh ? `${dd} d ${hh} h` : `${dd} d`;
}

export const fmtDataHora = (d: string | null) =>
  (d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export const iniciais = (nome: string) =>
  nome.split(/\s+/).filter(Boolean).filter((_, i, a) => i === 0 || i === a.length - 1).map((w) => w[0]?.toUpperCase()).join("") || "?";

/** Empresa ativa sem uso: sem serviço e sem acesso há mais de 14 dias. */
export function semUso(e: Empresa): boolean {
  if (e.status !== "ativo") return false;
  const ref = [e.ultimo_servico, e.ultimo_acesso, e.created_at].filter(Boolean).map((d) => new Date(d!).getTime());
  return Date.now() - Math.max(...ref) > 14 * 86_400_000;
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return <div className="sa-carregando"><span><span className="spinner" />&nbsp; {texto}</span></div>;
}

export async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { return false; }
}

export function Topo({ olho, titulo, sub, children }: { olho: string; titulo: string; sub?: string; children?: ReactNode }) {
  return (
    <header className="sa-topo">
      <div>
        <span className="sa-olho">{olho}</span>
        <h1>{titulo}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="sa-acoes">{children}</div>}
    </header>
  );
}
