// Painel do superadmin: empresas, planos, recursos e pedidos de reunião.
//
// Ao abrir, manda o catálogo de recursos do código ao banco
// (sincronizarRecursos): é assim que todo recurso novo do sistema aparece aqui
// sem ninguém cadastrar à mão. Ver src/lib/recursos.ts.
import { useCallback, useEffect, useState } from "react";
import "./admin.css";
import { supabase } from "../../lib/supabase";
import {
  listarContatos, listarEmpresas, listarPlanos, listarRecursos, sincronizarRecursos,
} from "../../lib/admin";
import type { Contato, Empresa, Plano, RecursoBanco } from "../../lib/admin";
import type { Rota } from "../../lib/rota";
import { Logo } from "../Logo";
import { Carregando, ICO, Ico } from "./comum";
import { VisaoGeral } from "./VisaoGeral";
import { Empresas } from "./Empresas";
import { EmpresaDetalhe } from "./EmpresaDetalhe";
import { Planos } from "./Planos";
import { RecursosAdmin } from "./RecursosAdmin";
import { Contatos } from "./Contatos";
import { ConfigAdmin } from "./ConfigAdmin";
import { SuporteAdmin } from "./SuporteAdmin";
import { TutoriaisAdmin } from "./TutoriaisAdmin";
import { Marca } from "../Marca";
import { AvisosGlobais, DialogosGlobais } from "../ui";
import { contagemSuporte } from "../../lib/suporte";
import type { ContagemSuporte } from "../../lib/suporte";

export type AbaAdmin = "visao" | "empresas" | "suporte" | "planos" | "recursos" | "tutoriais" | "contatos" | "config" | "marca";

export interface DadosAdmin {
  empresas: Empresa[];
  planos: Plano[];
  recursos: RecursoBanco[];
  contatos: Contato[];
  /** recursos que entraram no catálogo nesta abertura do painel */
  novosRecursos: number;
  /** central de suporte (0029); null = banco sem a migração */
  suporte: ContagemSuporte | null;
  recarregarSuporte: () => Promise<void>;
  recarregar: () => Promise<void>;
  ir: (r: Rota) => void;
}

const MENU: { secao: string; itens: { aba: AbaAdmin; rotulo: string; icone: string }[] }[] = [
  { secao: "Visão geral", itens: [{ aba: "visao", rotulo: "Painel", icone: ICO.visao }] },
  {
    secao: "Clientes",
    itens: [
      { aba: "empresas", rotulo: "Empresas", icone: ICO.empresas },
      { aba: "suporte", rotulo: "Suporte", icone: ICO.suporte },
      { aba: "contatos", rotulo: "Pedidos de reunião", icone: ICO.contatos },
    ],
  },
  {
    secao: "Catálogo",
    itens: [
      { aba: "planos", rotulo: "Planos", icone: ICO.planos },
      { aba: "recursos", rotulo: "Recursos", icone: ICO.recursos },
      { aba: "tutoriais", rotulo: "Tutoriais", icone: ICO.tutoriais },
    ],
  },
  {
    secao: "Sistema",
    itens: [
      { aba: "config", rotulo: "Configurações", icone: ICO.config },
      // só o superadmin: o guia da marca do Vertces não é assunto das empresas
      { aba: "marca", rotulo: "Guia da marca", icone: ICO.marca },
    ],
  },
];

export function PainelAdmin({ aba, id, ir, email, temEscritorio }: {
  aba: AbaAdmin; id?: string; ir: (r: Rota) => void; email: string | null;
  /** o superadmin também trabalha numa empresa: mostra o atalho de volta */
  temEscritorio: boolean;
}) {
  const [dados, setDados] = useState<Omit<DadosAdmin, "recarregar" | "ir" | "suporte" | "recarregarSuporte"> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [suporte, setSuporte] = useState<ContagemSuporte | null>(null);

  // chamados esperando o suporte (badge do menu): ao trocar de aba e a cada minuto
  const recarregarSuporte = useCallback(async () => { setSuporte(await contagemSuporte().catch(() => null)); }, []);
  useEffect(() => { recarregarSuporte(); }, [aba, recarregarSuporte]);
  useEffect(() => {
    const t = setInterval(recarregarSuporte, 60_000);
    return () => clearInterval(t);
  }, [recarregarSuporte]);

  const recarregar = useCallback(async () => {
    try {
      const [empresas, planos, recursos, contatos] = await Promise.all([listarEmpresas(), listarPlanos(), listarRecursos(), listarContatos()]);
      setDados((d) => ({ empresas, planos, recursos, contatos, novosRecursos: d?.novosRecursos ?? 0 }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    (async () => {
      let novos = 0;
      try { novos = await sincronizarRecursos(); } catch (e) { setErro(`Não foi possível sincronizar os recursos: ${e instanceof Error ? e.message : e}`); }
      try {
        const [empresas, planos, recursos, contatos] = await Promise.all([listarEmpresas(), listarPlanos(), listarRecursos(), listarContatos()]);
        setDados({ empresas, planos, recursos, contatos, novosRecursos: novos });
      } catch (e) {
        setErro(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const contatosNovos = dados?.contatos.filter((c) => c.status === "novo").length ?? 0;
  const esperando = suporte?.esperando ?? 0;
  const ctx: DadosAdmin | null = dados ? { ...dados, suporte, recarregarSuporte, recarregar, ir } : null;
  const irAba = (a: AbaAdmin) => ir({ t: "admin", aba: a });

  let pagina = <Carregando />;
  if (ctx) {
    switch (aba) {
      case "empresas":
        pagina = id ? <EmpresaDetalhe key={id} id={id} d={ctx} /> : <Empresas d={ctx} />;
        break;
      case "suporte": pagina = <SuporteAdmin d={ctx} id={id} />; break;
      case "planos": pagina = <Planos d={ctx} />; break;
      case "recursos": pagina = <RecursosAdmin d={ctx} />; break;
      case "tutoriais": pagina = <TutoriaisAdmin />; break;
      case "contatos": pagina = <Contatos d={ctx} />; break;
      case "config": pagina = <ConfigAdmin />; break;
      case "marca": pagina = <Marca />; break;
      default: pagina = <VisaoGeral d={ctx} />;
    }
  }

  return (
    <div className="sa">
      <aside className="sa-lateral" aria-label="Menu do painel">
        <div className="sa-marca">
          <Logo size={26} />
          <div><b>Vertces</b><small>Painel SaaS</small></div>
        </div>
        {MENU.map((g) => (
          <div key={g.secao} style={{ display: "contents" }}>
            <div className="sa-secao">{g.secao}</div>
            {g.itens.map((it) => (
              <button key={it.aba} type="button" className={aba === it.aba ? "sa-nav ativo" : "sa-nav"}
                aria-current={aba === it.aba ? "page" : undefined} onClick={() => irAba(it.aba)}>
                <Ico d={it.icone} />{it.rotulo}
                {it.aba === "contatos" && contatosNovos > 0 && <span className="sa-badge">{contatosNovos}</span>}
                {it.aba === "suporte" && esperando > 0 && (
                  <span className="sa-badge" title={`${esperando} chamado(s) esperando o suporte`}>{esperando}</span>
                )}
                {it.aba === "recursos" && (dados?.novosRecursos ?? 0) > 0 && <span className="sa-badge">{dados!.novosRecursos}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="sa-lateral-fim">
          {temEscritorio && (
            <button type="button" className="sa-nav" onClick={() => ir({ t: "inicio" })}><Ico d={ICO.sistema} />Abrir o sistema</button>
          )}
          <div className="quem" title={email ?? undefined}>{email}</div>
          <button type="button" className="sa-nav" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </aside>
      <main className="sa-main">
        {erro && <div className="sa-aviso erro" style={{ marginTop: 20 }}>{erro}</div>}
        {pagina}
      </main>
      <AvisosGlobais />
      <DialogosGlobais />
    </div>
  );
}

