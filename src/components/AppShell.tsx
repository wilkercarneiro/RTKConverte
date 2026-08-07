// Casca do sistema: barra superior fixa + área de conteúdo.
//
// A barra existe porque clientes, serviços e configurações deixaram de ser abas
// dentro do dashboard e viraram destinos de primeiro nível. Antes, chegar a
// "configurações" a partir de um serviço exigia voltar ao dashboard primeiro.
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import type { Rota } from "../lib/rota";

const ABAS: { t: Rota["t"]; rotulo: string; icone: string }[] = [
  { t: "inicio", rotulo: "Início", icone: "⌂" },
  { t: "clientes", rotulo: "Clientes", icone: "👤" },
  { t: "servicos", rotulo: "Serviços", icone: "📋" },
  { t: "config", rotulo: "Configurações", icone: "⚙" },
];

export function AppShell({ rota, ir, children }: { rota: Rota; ir: (r: Rota) => void; children: ReactNode }) {
  // A página de um cliente pertence a "Clientes", e a de um serviço a
  // "Serviços": sem isso a barra não marcaria nada enquanto o operador está
  // justamente dentro do trabalho.
  const ativa: Rota["t"] =
    rota.t === "cliente" ? "clientes"
      : rota.t === "servico" || rota.t === "novo" ? "servicos"
        : rota.t;

  return (
    <div className="app">
      <header className="barra-topo">
        <button className="marca" onClick={() => ir({ t: "inicio" })} title="Início">
          <span className="marca-icone" aria-hidden="true">🛰️</span>
          <span className="marca-nome">RTKConverte</span>
        </button>
        <nav className="barra-nav" aria-label="Navegação principal">
          {ABAS.map((a) => (
            <button
              key={a.t}
              className={ativa === a.t ? "nav-item ativo" : "nav-item"}
              aria-current={ativa === a.t ? "page" : undefined}
              onClick={() => ir({ t: a.t } as Rota)}
            >
              <span aria-hidden="true">{a.icone}</span> {a.rotulo}
            </button>
          ))}
        </nav>
        <span className="esticar" />
        <button className="fantasma" onClick={() => supabase.auth.signOut()}>Sair</button>
      </header>
      <main className="app-conteudo">{children}</main>
    </div>
  );
}
