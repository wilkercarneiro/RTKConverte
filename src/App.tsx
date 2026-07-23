import { useEffect, useState } from "react";
import { configOk, supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { Dashboard } from "./components/Dashboard";
import { Upload, type ResultadoParse } from "./components/Upload";
import { Conferencia } from "./components/Conferencia";
import { PecasServico } from "./components/PecasServico";
import { Configuracoes } from "./components/Configuracoes";
import { ClientePage } from "./components/ClientePage";
import type { Cliente, Servico, Trecho, Vertice } from "./lib/types";

type Tela =
  | { t: "dashboard" }
  | { t: "upload"; clienteId?: string }
  | { t: "conferencia"; parse: ResultadoParse }
  | { t: "pecas"; servicoId: string | null; clienteId?: string }
  | { t: "config" }
  | { t: "cliente"; clienteId: string };

export default function App() {
  const [logado, setLogado] = useState<boolean | null>(null);
  const [tela, setTela] = useState<Tela>({ t: "dashboard" });
  const [abrindo, setAbrindo] = useState(false);

  useEffect(() => {
    if (!configOk) return;
    supabase.auth.getSession().then(({ data }) => setLogado(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setLogado(!!sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  // reabre um serviço existente do dashboard
  async function abrir(s: Servico) {
    if (s.tipo === "pecas") {
      setTela({ t: "pecas", servicoId: s.id });
      return;
    }
    setAbrindo(true);
    try {
      const [{ data: vertices }, { data: trechos }] = await Promise.all([
        supabase.from("vertices").select().eq("servico_id", s.id).order("ordem"),
        supabase.from("trechos_confrontantes").select().eq("servico_id", s.id).order("vertice_inicio_ordem"),
      ]);
      setTela({
        t: "conferencia",
        parse: {
          servico: s,
          vertices: (vertices as Vertice[]) ?? [],
          trechos: (trechos as Trecho[]) ?? [],
          preview: {
            fuso: s.fuso_utm ?? 24, epsg: 31960 + (s.fuso_utm ?? 24),
            candidatos: [s.fuso_utm ?? 24], fusoAmbiguo: false, foraDaUf: false,
            areaHa: 0, perimetroM: 0, qtdM: 0, qtdP: 0, qtdV: 0,
          },
        },
      });
    } finally {
      setAbrindo(false);
    }
  }

  if (!configOk) {
    return (
      <div className="centro">
        <div>
          <h2>Configuração ausente</h2>
          <p>Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no
            arquivo <code>.env</code> (ver <code>.env.example</code>) e reinicie o <code>npm run dev</code>.</p>
        </div>
      </div>
    );
  }
  if (logado === null) return <div className="centro">Carregando...</div>;
  if (!logado) return <Login onOk={() => setLogado(true)} />;
  if (abrindo) return <div className="centro"><span className="spinner" />&nbsp; Abrindo serviço…</div>;

  // Serviço 1 criado a partir de um cliente: vincula e pré-preenche o detentor
  async function vincularCliente(parse: ResultadoParse, clienteId?: string): Promise<ResultadoParse> {
    if (!clienteId) return parse;
    const { data: c } = await supabase.from("clientes").select().eq("id", clienteId).single();
    if (!c) return parse;
    const cli = c as Cliente;
    const patch = {
      cliente_id: cli.id,
      detentor_nome: cli.nome,
      detentor_cpf: cli.cpf_cnpj,
      detentor_genero: cli.genero,
      endereco_detentor: cli.endereco,
    };
    await supabase.from("servicos").update(patch).eq("id", parse.servico.id);
    return { ...parse, servico: { ...parse.servico, ...patch } };
  }

  switch (tela.t) {
    case "upload":
      return <Upload
        onParsed={async (parse) => setTela({ t: "conferencia", parse: await vincularCliente(parse, tela.clienteId) })}
        onVoltar={() => setTela({ t: "dashboard" })} />;
    case "conferencia":
      return <Conferencia inicial={tela.parse} onVoltar={() => setTela({ t: "dashboard" })} />;
    case "pecas":
      return <PecasServico servicoId={tela.servicoId} clienteId={tela.clienteId} onVoltar={() => setTela({ t: "dashboard" })} />;
    case "config":
      return <Configuracoes onVoltar={() => setTela({ t: "dashboard" })} />;
    case "cliente":
      return (
        <ClientePage
          clienteId={tela.clienteId}
          onVoltar={() => setTela({ t: "dashboard" })}
          onAbrirServico={abrir}
          onNovoGeo={(cid) => setTela({ t: "upload", clienteId: cid })}
          onNovoPecas={(cid) => setTela({ t: "pecas", servicoId: null, clienteId: cid })}
        />
      );
    default:
      return (
        <Dashboard
          onNovoGeo={() => setTela({ t: "upload" })}
          onNovoPecas={() => setTela({ t: "pecas", servicoId: null })}
          onConfig={() => setTela({ t: "config" })}
          onAbrir={abrir}
          onAbrirCliente={(clienteId) => setTela({ t: "cliente", clienteId })}
        />
      );
  }
}
