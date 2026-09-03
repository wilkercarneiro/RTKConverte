// Casca do sistema: barra lateral fixa + área de conteúdo (redesign Vértice).
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import type { Rota } from "../lib/rota";
import { Logo } from "./Logo";

const ICONES: Record<string, string> = {
  inicio: "M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  servicos: "M9 4h6v3H9zM6 6H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1M8 12h8M8 16h5",
  clientes: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  config: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
};

const ABAS: { t: Rota["t"]; rotulo: string }[] = [
  { t: "inicio", rotulo: "Início" },
  { t: "servicos", rotulo: "Serviços" },
  { t: "clientes", rotulo: "Clientes" },
  { t: "config", rotulo: "Configurações" },
];

export function AppShell({ rota, ir, children, usuario }: {
  rota: Rota; ir: (r: Rota) => void; children: ReactNode;
  /** nome exibido no rodapé da barra (ex.: e-mail ou nome do RT) */
  usuario?: { nome: string; papel?: string };
}) {
  const ativa: Rota["t"] =
    rota.t === "cliente" ? "clientes"
      : rota.t === "servico" || rota.t === "novo" ? "servicos"
        : rota.t;
  const nome = usuario?.nome ?? "Operador";
  const iniciais = nome.split(/\s+/).filter((_, i, a) => i === 0 || i === a.length - 1).map((w) => w[0]?.toUpperCase() ?? "").join("");

  return (
    <div className="app">
      <aside className="barra-lateral">
        <button className="marca" onClick={() => ir({ t: "inicio" })} title="Início">
          <Logo className="marca-icone" />
          <span className="marca-nome">Vértice</span>
        </button>
        <nav className="barra-nav" aria-label="Navegação principal">
          {ABAS.map((a) => (
            <button key={a.t}
              className={ativa === a.t ? "nav-item ativo" : "nav-item"}
              aria-current={ativa === a.t ? "page" : undefined}
              onClick={() => ir({ t: a.t } as Rota)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONES[a.t]} /></svg>
              <span>{a.rotulo}</span>
            </button>
          ))}
        </nav>
        <div className="barra-rodape">
          <div className="avatar" aria-hidden="true">{iniciais}</div>
          <div className="nome">{nome}{usuario?.papel && <div className="papel">{usuario.papel}</div>}</div>
          <button className="sair" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </aside>
      <main className="app-conteudo">{children}</main>
    </div>
  );
}
