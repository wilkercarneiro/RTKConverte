// Casca do sistema: trilho lateral + área de conteúdo.
//
// O trilho fica estreito (só ícones) e cresce por cima do conteúdo quando o
// mouse para nele — a mesma pegada da barra do GPROL: abre depois de ~180 ms
// parado (passar de raspão não abre), fecha na hora ao sair, abre também pelo
// teclado. O conteúdo nunca é empurrado: um espaçador do tamanho do trilho
// fechado segura o layout. No celular vira uma barra no topo com gaveta.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../lib/supabase";
import type { Rota } from "../lib/rota";
import { temRecurso } from "../lib/recursos";
import { Logo } from "./Logo";
import { AvisosGlobais, DialogosGlobais } from "./ui";
import { AvisoCreditoGlobal } from "./Creditos";
import "./casca.css";

const I = {
  inicio: "M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  servicos: "M9 4h6v3H9zM6 6H5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1M8 12h8M8 16h5",
  clientes: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  equipe: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1M19 8v6M22 11h-6",
  config: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  ajuda: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01",
  painel: "M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z",
  sair: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  menu: "M3 6h18M3 12h18M3 18h18",
};

interface Item { t: Rota["t"]; rotulo: string; icone: string; destino?: Rota }

function grupos(superadmin: boolean): { titulo: string; itens: Item[] }[] {
  const g: { titulo: string; itens: Item[] }[] = [
    {
      titulo: "Trabalho",
      itens: [
        { t: "inicio", rotulo: "Início", icone: I.inicio },
        { t: "servicos", rotulo: "Serviços", icone: I.servicos },
        { t: "clientes", rotulo: "Clientes", icone: I.clientes },
      ],
    },
    {
      titulo: "Empresa",
      itens: [
        ...(temRecurso("empresa.equipe") ? [{ t: "equipe" as const, rotulo: "Equipe", icone: I.equipe }] : []),
        { t: "config", rotulo: "Configurações", icone: I.config },
      ],
    },
    {
      titulo: "Suporte",
      itens: [
        { t: "ajuda", rotulo: "Ajuda", icone: I.ajuda },
      ],
    },
  ];
  if (superadmin) g.push({ titulo: "Vertces", itens: [{ t: "admin", rotulo: "Painel SaaS", icone: I.painel, destino: { t: "admin", aba: "visao" } }] });
  return g;
}

const Ico = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export function AppShell({ rota, ir, children, usuario, superadmin }: {
  rota: Rota; ir: (r: Rota) => void; children: ReactNode;
  /** nome exibido no rodapé da barra (ex.: e-mail ou nome do RT) */
  usuario?: { nome: string; papel?: string };
  /** mostra o atalho para o painel do SaaS */
  superadmin?: boolean;
}) {
  // A página de um cliente pertence a "Clientes", e a de um serviço a
  // "Serviços": sem isso a barra não marcaria nada enquanto o operador está
  // justamente dentro do trabalho.
  const ativa: Rota["t"] =
    rota.t === "cliente" ? "clientes"
      : rota.t === "servico" || rota.t === "novo" ? "servicos"
        : rota.t;
  const nome = usuario?.nome ?? "Operador";
  const iniciais = nome.split(/[\s@._-]+/).filter(Boolean).filter((_, i, a) => i === 0 || i === a.length - 1).map((w) => w[0]?.toUpperCase() ?? "").join("");

  const [aberto, setAberto] = useState(false);
  const [gaveta, setGaveta] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const abrir = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAberto(true), 180);
  }, []);
  const fechar = useCallback(() => { window.clearTimeout(timer.current); setAberto(false); }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // trocar de tela fecha a gaveta do celular
  useEffect(() => { setGaveta(false); }, [rota]);

  const ir2 = (it: Item) => { fechar(); ir(it.destino ?? ({ t: it.t } as Rota)); };

  const conteudoTrilho = (
    <>
      <button className="tr-marca" onClick={() => ir({ t: "inicio" })} title="Início">
        <Logo className="tr-logo" />
        <span className="tr-rotulo tr-nome">Vertces</span>
      </button>
      <nav className="tr-nav" aria-label="Navegação principal">
        {grupos(!!superadmin).map((g) => g.itens.length > 0 && (
          <div className="tr-grupo" key={g.titulo}>
            <div className="tr-titulo" aria-hidden="true"><span className="tr-rotulo">{g.titulo}</span></div>
            {g.itens.map((it) => (
              <button key={it.rotulo} className={ativa === it.t ? "tr-item ativo" : "tr-item"}
                aria-current={ativa === it.t ? "page" : undefined}
                aria-label={it.rotulo} data-dica={it.rotulo}
                onClick={() => ir2(it)}>
                <Ico d={it.icone} />
                <span className="tr-rotulo">{it.rotulo}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="tr-pe">
        <div className="tr-quem" title={`${nome}${usuario?.papel ? ` · ${usuario.papel}` : ""}`}>
          <span className="tr-avatar" aria-hidden="true">{iniciais}</span>
          <span className="tr-rotulo tr-quem-tx"><b>{nome}</b>{usuario?.papel && <small>{usuario.papel}</small>}</span>
        </div>
        <button className="tr-item tr-sair" aria-label="Sair" data-dica="Sair" onClick={() => supabase.auth.signOut()}>
          <Ico d={I.sair} /><span className="tr-rotulo">Sair</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="app casca">
      <div className="tr-espaco" aria-hidden="true" />
      <aside className="tr" data-aberto={aberto} onMouseEnter={abrir} onMouseLeave={fechar}
        onFocus={() => setAberto(true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setAberto(false); }}>
        {conteudoTrilho}
      </aside>

      {/* celular: barra no topo + gaveta */}
      <header className="tr-topo">
        <button className="tr-marca" onClick={() => ir({ t: "inicio" })}><Logo className="tr-logo" /><span className="tr-nome">Vertces</span></button>
        <button className="tr-menu" aria-label="Abrir menu" aria-expanded={gaveta} onClick={() => setGaveta(true)}><Ico d={I.menu} /></button>
      </header>
      {gaveta && (
        <>
          <div className="tr-veu" onClick={() => setGaveta(false)} />
          <aside className="tr tr-gaveta" data-aberto="true" role="dialog" aria-modal="true" aria-label="Menu"
            onKeyDown={(e) => { if (e.key === "Escape") setGaveta(false); }}>
            {conteudoTrilho}
          </aside>
        </>
      )}

      <main className="app-conteudo" key={rota.t}>{children}</main>
      <AvisosGlobais />
      <AvisoCreditoGlobal />
      <DialogosGlobais />
    </div>
  );
}
