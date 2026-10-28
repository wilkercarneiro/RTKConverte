import { Suspense, lazy, useEffect, useState } from "react";
import { configOk, supabase } from "./lib/supabase";
import { Login } from "./components/Login";
import { AppShell } from "./components/AppShell";
import { Inicio } from "./components/Inicio";
import { Clientes } from "./components/Clientes";
import { Servicos } from "./components/Servicos";
import { Upload, type ResultadoParse } from "./components/Upload";
import { Conferencia } from "./components/Conferencia";
import { PecasServico } from "./components/PecasServico";
import { Loteamento } from "./components/loteamento/Loteamento";
import { Laboratorio } from "./components/loteamento/Laboratorio";
import { Car } from "./components/car/Car";
import { CarNovo } from "./components/car/CarNovo";
import { Configuracoes } from "./components/Configuracoes";
import { ClientePage } from "./components/ClientePage";
import { Marca } from "./components/Marca";
import { Cadastro } from "./components/Cadastro";
import { Ajuda } from "./components/Ajuda";
import { PaginaDocumento } from "./components/Documento";
import { Logo } from "./components/Logo";
import termos from "../docs/legal/termos-de-uso.md?raw";
import privacidade from "../docs/legal/politica-de-privacidade.md?raw";
import { CADASTRO_ABERTO } from "./lib/config";
import { carregarEscritorio } from "./lib/escritorio";
import type { EstadoEscritorio } from "./lib/escritorio";
import { definicaoDe } from "./lib/modalidades";
import type { ChaveServico } from "./lib/modalidades";
import { useRota } from "./lib/rota";
import type { Cliente, Servico, Trecho, Vertice } from "./lib/types";

// só no `npm run dev`: fica num pedaço à parte que o build nunca carrega
const LaboratorioPlanta = lazy(() => import("./components/planta/LaboratorioPlanta").then((m) => ({ default: m.LaboratorioPlanta })));
const LaboratorioDivisao = lazy(() => import("./components/LaboratorioDivisao").then((m) => ({ default: m.LaboratorioDivisao })));
const LaboratorioCar = lazy(() => import("./components/car/Laboratorio").then((m) => ({ default: m.LaboratorioCar })));

export default function App() {
  const [logado, setLogado] = useState<boolean | null>(null);
  // e-mail do operador: vai ao rodapé da barra lateral e à saudação do Início
  const [usuario, setUsuario] = useState<string | null>(null);
  const { rota, ir, substituir } = useRota();
  // serviço aberto (carregado sob demanda pela rota #/servico/:id)
  const [aberto, setAberto] = useState<ResultadoParse | null>(null);
  const [carregandoServico, setCarregandoServico] = useState(false);
  const [erroServico, setErroServico] = useState<string | null>(null);
  // escritório do usuário (null = carregando). Ver lib/escritorio.ts.
  const [escritorio, setEscritorio] = useState<EstadoEscritorio | null>(null);

  useEffect(() => {
    if (!configOk) return;
    supabase.auth.getSession().then(({ data }) => { setLogado(!!data.session); setUsuario(data.session?.user.email ?? null); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => { setLogado(!!sess); setUsuario(sess?.user.email ?? null); });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!logado) { setEscritorio(null); return; }
    let cancelado = false;
    carregarEscritorio().then((e) => { if (!cancelado) setEscritorio(e); });
    return () => { cancelado = true; };
  }, [logado, usuario]);

  // A rota é a fonte da verdade da navegação: o serviço da URL é carregado aqui,
  // e não empurrado por quem clicou. É isso que faz atualizar a página (F5) e o
  // botão voltar do navegador continuarem funcionando dentro de um serviço.
  const servicoIdRota = rota.t === "servico" ? rota.id : null;
  useEffect(() => {
    if (!servicoIdRota || !logado) { setAberto(null); return; }
    if (aberto?.servico.id === servicoIdRota) return;
    let cancelado = false;
    setCarregandoServico(true);
    setErroServico(null);
    (async () => {
      const { data: s } = await supabase.from("servicos").select().eq("id", servicoIdRota).single();
      if (cancelado) return;
      if (!s) { setErroServico("Serviço não encontrado."); setCarregandoServico(false); return; }
      const servico = s as Servico;
      // peças e CAR não têm vértices: o CAR guarda o perímetro do KML no próprio projeto
      if (servico.tipo === "pecas" || servico.modalidade === "car") { setAberto({ servico, vertices: [], trechos: [], preview: previewVazio(servico) }); setCarregandoServico(false); return; }
      const [{ data: vertices }, { data: trechos }] = await Promise.all([
        supabase.from("vertices").select().eq("servico_id", servico.id).order("ordem"),
        supabase.from("trechos_confrontantes").select().eq("servico_id", servico.id).order("vertice_inicio_ordem"),
      ]);
      if (cancelado) return;
      setAberto({
        servico,
        vertices: (vertices as Vertice[]) ?? [],
        trechos: (trechos as Trecho[]) ?? [],
        preview: previewVazio(servico),
      });
      setCarregandoServico(false);
    })();
    return () => { cancelado = true; };
  }, [servicoIdRota, logado]);

  // Laboratório do loteamento: só no servidor de desenvolvimento (some do build).
  if (import.meta.env.DEV && location.hash.startsWith("#/lab/loteamento")) return <Laboratorio />;
  if (import.meta.env.DEV && location.hash.startsWith("#/lab/planta")) return <Suspense fallback={null}><LaboratorioPlanta /></Suspense>;
  if (import.meta.env.DEV && location.hash.startsWith("#/lab/divisao")) return <Suspense fallback={null}><LaboratorioDivisao /></Suspense>;
  if (import.meta.env.DEV && location.hash.startsWith("#/lab/car")) return <Suspense fallback={null}><LaboratorioCar /></Suspense>;

  // Páginas públicas: abrem com ou sem login (o link vai no cadastro e no site).
  if (rota.t === "termos") return <PaginaDocumento texto={termos} voltar={{ rotulo: "Vértice", href: "#/" }} />;
  if (rota.t === "privacidade") return <PaginaDocumento texto={privacidade} voltar={{ rotulo: "Vértice", href: "#/" }} />;

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
  if (!logado) {
    if (rota.t === "cadastro" && CADASTRO_ABERTO) return <Cadastro />;
    return <Login onOk={() => setLogado(true)} cadastroAberto={CADASTRO_ABERTO} />;
  }
  if (escritorio === null) return <div className="centro">Carregando...</div>;
  if (escritorio.estado === "sem-escritorio") return <SemEscritorio email={usuario} />;

  /** Serviço criado a partir de um cliente: vincula e pré-preenche o detentor. */
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
      is_espolio: cli.is_espolio ?? false,
      inventariante_nome: cli.inventariante_nome ?? null,
      inventariante_cpf: cli.inventariante_cpf ?? null,
      inventariante_rg: cli.inventariante_rg ?? null,
    };
    await supabase.from("servicos").update(patch).eq("id", parse.servico.id);
    return { ...parse, servico: { ...parse.servico, ...patch } as Servico };
  }

  /**
   * Grava a modalidade escolhida no cartão. O `parse-txt` cria o serviço com os
   * defaults do banco ('completo', sem glebas); quem escolheu outra coisa
   * carimba aqui, uma vez só, antes de a tela de conferência abrir.
   */
  async function aplicarModalidade(parse: ResultadoParse, chave: ChaveServico): Promise<ResultadoParse> {
    const def = definicaoDe(chave);
    const campos = def.campos;
    const patch = { modalidade: campos.modalidade, tem_glebas: campos.tem_glebas };
    await supabase.from("servicos").update(patch).eq("id", parse.servico.id);
    // A partilha grava à parte: se a coluna ainda não existir no banco, o serviço
    // continua de glebas (e o motor fica no "Dividir automaticamente" da etapa).
    if (campos.divisao) {
      const { error } = await supabase.from("servicos").update({ divisao: { iguais: true } }).eq("id", parse.servico.id);
      if (!error) return { ...parse, servico: { ...parse.servico, ...patch, divisao: { iguais: true } } };
    }
    return { ...parse, servico: { ...parse.servico, ...patch } };
  }

  const abrirServico = (s: Servico) => ir({ t: "servico", id: s.id });
  const papel = escritorio.estado === "ok"
    ? `${escritorio.escritorio.papel === "dono" ? "Dono" : "Operador"} · ${escritorio.escritorio.nome}`
    : "Operador";
  const casca = { rota, ir, usuario: usuario ? { nome: usuario, papel } : undefined };

  switch (rota.t) {
    case "novo": {
      const def = definicaoDe(rota.chave as ChaveServico);
      if (def.campos.tipo === "pecas") {
        return (
          <AppShell {...casca}>
            <PecasServico servicoId={null} clienteId={rota.clienteId} onVoltar={() => ir({ t: "inicio" })} />
          </AppShell>
        );
      }
      if (def.entradaKml) {
        return (
          <AppShell {...casca}>
            <CarNovo definicao={def} clienteId={rota.clienteId} onVoltar={() => ir({ t: "inicio" })}
              onCriado={(servico) => {
                setAberto({ servico, vertices: [], trechos: [], preview: previewVazio(servico) });
                substituir({ t: "servico", id: servico.id });
              }} />
          </AppShell>
        );
      }
      return (
        <AppShell {...casca}>
          <Upload
            definicao={def}
            onParsed={async (parse) => {
              const comCliente = await vincularCliente(parse, rota.clienteId);
              const pronto = await aplicarModalidade(comCliente, def.chave);
              setAberto(pronto);
              // replace: voltar não pode retornar à tela de upload de um TXT
              // que já foi consumido e virou serviço.
              substituir({ t: "servico", id: pronto.servico.id });
            }}
            onVoltar={() => ir({ t: "inicio" })}
          />
        </AppShell>
      );
    }

    case "servico": {
      if (carregandoServico) return <AppShell {...casca}><div className="centro"><span className="spinner" />&nbsp; Abrindo serviço…</div></AppShell>;
      if (erroServico || !aberto) {
        return (
          <AppShell {...casca}>
            <div className="centro">
              <div>
                <h2>{erroServico ?? "Serviço não encontrado"}</h2>
                <button className="principal" onClick={() => ir({ t: "servicos" })}>Ver todos os serviços</button>
              </div>
            </div>
          </AppShell>
        );
      }
      return (
        <AppShell {...casca}>
          {aberto.servico.tipo === "pecas"
            ? <PecasServico servicoId={aberto.servico.id} onVoltar={() => ir({ t: "servicos" })} />
            : aberto.servico.modalidade === "loteamento"
              ? <Loteamento key={aberto.servico.id} servico={aberto.servico} vertices={aberto.vertices} onVoltar={() => ir({ t: "servicos" })} />
              : aberto.servico.modalidade === "car"
                ? <Car key={aberto.servico.id} servico={aberto.servico} onVoltar={() => ir({ t: "servicos" })} />
                : <Conferencia inicial={aberto} onVoltar={() => ir({ t: "servicos" })} />}
        </AppShell>
      );
    }

    case "cliente":
      return (
        <AppShell {...casca}>
          <ClientePage
            clienteId={rota.id}
            onVoltar={() => ir({ t: "clientes" })}
            onAbrirServico={abrirServico}
            onNovoServico={(chave) => ir({ t: "novo", chave, clienteId: rota.id })}
          />
        </AppShell>
      );

    case "clientes":
      return <AppShell {...casca}><Clientes onAbrir={(id) => ir({ t: "cliente", id })} /></AppShell>;

    case "servicos":
      return <AppShell {...casca}><Servicos onAbrir={abrirServico} onNovo={() => ir({ t: "inicio" })} /></AppShell>;

    case "config":
      return <AppShell {...casca}><Configuracoes escritorio={escritorio} /></AppShell>;

    case "marca":
      return <AppShell {...casca}><Marca /></AppShell>;

    case "ajuda":
      return <AppShell {...casca}><Ajuda /></AppShell>;

    default:
      return (
        <AppShell {...casca}>
          <Inicio onNovo={(chave) => ir({ t: "novo", chave })} onAbrir={abrirServico}
            onVerServicos={() => ir({ t: "servicos" })} nome={usuario ?? undefined} />
        </AppShell>
      );
  }
}

/** Conta confirmada, mas fora de qualquer escritório: espera o dono adicioná-la. */
function SemEscritorio({ email }: { email: string | null }) {
  return (
    <div className="centro">
      <div className="login-box" style={{ textAlign: "left" }}>
        <Logo size={28} />
        <h2 style={{ marginTop: 14 }}>Falta entrar num escritório</h2>
        <p>Sua conta{email ? <> (<b>{email}</b>)</> : null} está ativa, mas ainda não faz parte de nenhum escritório.</p>
        <p>Peça ao dono do escritório para adicionar este e-mail em <b>Configurações → Equipe</b> e depois clique em “Já fui adicionado”.</p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="principal" onClick={() => location.reload()}>Já fui adicionado</button>
          <button onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </div>
    </div>
  );
}

/**
 * O preview real é recalculado dentro da Conferencia a partir dos vértices; o
 * que vai aqui é só o fuso, que a tela precisa antes do primeiro cálculo.
 */
function previewVazio(s: Servico): ResultadoParse["preview"] {
  const fuso = s.fuso_utm ?? 24;
  return {
    fuso, epsg: 31960 + fuso, candidatos: [fuso], fusoAmbiguo: false, foraDaUf: false,
    areaHa: 0, perimetroM: 0, qtdM: 0, qtdP: 0, qtdV: 0,
  };
}
