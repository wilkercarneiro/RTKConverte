// Dashboard: dois fluxos de entrada + lista de serviços existentes.
//   Serviço 1 (geo)   — TXT → Memorial DOCX + Planilha ODS
//   Serviço 2 (pecas) — PDF do SIGEF → 7 peças técnicas
//
// Experiência: o rascunho mais recente vira um atalho "continuar", e cada linha
// mostra em que ponto do processo o serviço está — não só rascunho/gerado.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Cliente, Servico } from "../lib/types";
import { Avisos, BotaoPerigo } from "./ui";
import { useAvisos } from "../lib/ux";

interface Props {
  onNovoGeo: () => void;
  onNovoPecas: () => void;
  onConfig: () => void;
  onAbrir: (s: Servico) => void;
  onAbrirCliente: (clienteId: string) => void;
}

/** Etapas concluídas de um serviço, deduzidas dos documentos já gerados. */
interface Progresso { docs: boolean; planta: boolean; pecas: boolean }

const TIPOS_ETAPA1 = new Set(["memorial_docx", "planilha_ods"]);

export function Dashboard({ onNovoGeo, onNovoPecas, onConfig, onAbrir, onAbrirCliente }: Props) {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [progressos, setProgressos] = useState<Record<string, Progresso>>({});
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [aba, setAba] = useState<"clientes" | "servicos">("clientes");
  const [novoNome, setNovoNome] = useState("");
  const { avisos, avisar, fechar } = useAvisos();

  async function carregar() {
    setCarregando(true);
    const [{ data: ss }, { data: cs }, { data: ds }] = await Promise.all([
      supabase.from("servicos").select().order("created_at", { ascending: false }).limit(200),
      supabase.from("clientes").select().order("nome"),
      supabase.from("documentos_gerados").select("servico_id, tipo"),
    ]);
    setServicos((ss as Servico[]) ?? []);
    setClientes((cs as Cliente[]) ?? []);
    // uma consulta só para todo o painel: por serviço, quais etapas já saíram
    const mapa: Record<string, Progresso> = {};
    for (const d of (ds ?? []) as { servico_id: string; tipo: string }[]) {
      if (!mapa[d.servico_id]) mapa[d.servico_id] = { docs: false, planta: false, pecas: false };
      const p = mapa[d.servico_id];
      if (TIPOS_ETAPA1.has(d.tipo)) p.docs = true;
      else if (d.tipo === "planta_pdf") p.planta = true;
      else p.pecas = true;
    }
    setProgressos(mapa);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function criarCliente() {
    if (!novoNome.trim()) return;
    const { data, error } = await supabase.from("clientes").insert({ nome: novoNome.trim().toUpperCase() }).select().single();
    if (error) { avisar("erro", `Não foi possível criar o cliente: ${error.message}`); return; }
    if (data) { setNovoNome(""); onAbrirCliente((data as Cliente).id); }
  }

  async function excluir(s: Servico) {
    const { error } = await supabase.from("servicos").delete().eq("id", s.id);
    if (error) { avisar("erro", `Não foi possível excluir: ${error.message}`); return; }
    avisar("ok", `Serviço "${nomeServico(s)}" excluído. Os arquivos gerados permanecem no Storage.`);
    carregar();
  }

  const nomeServico = (s: Servico) => s.denominacao ?? s.nome_arquivo_txt ?? s.id.slice(0, 8);

  const filtrados = servicos.filter((s) => {
    const alvo = `${s.denominacao ?? ""} ${s.detentor_nome ?? ""} ${s.nome_arquivo_txt ?? ""} ${s.municipio ?? ""}`.toLowerCase();
    return alvo.includes(filtro.toLowerCase());
  });

  // Preditivo: quem abre o sistema quase sempre volta ao serviço que estava
  // fazendo. O mais recente que ainda não terminou ganha um atalho no topo.
  const retomar = useMemo(() => {
    const inacabado = servicos.find((s) => {
      const p = progressos[s.id];
      return !p || !p.docs || !p.pecas;
    });
    return inacabado ?? null;
  }, [servicos, progressos]);

  const dataFmt = (iso?: string) => {
    const d = new Date((iso as unknown as string) ?? "");
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  /** O que falta neste serviço, em uma frase curta. */
  function faltando(s: Servico): string {
    const p = progressos[s.id];
    if (!p?.docs) return "gerar memorial e planilha";
    if (!p.planta) return "gerar a planta";
    if (!p.pecas) return "gerar as peças técnicas";
    return "concluído";
  }

  function BarraProgresso({ s }: { s: Servico }) {
    const p = progressos[s.id] ?? { docs: false, planta: false, pecas: false };
    const rotulo = `${p.docs ? "documentos" : ""}${p.planta ? " planta" : ""}${p.pecas ? " peças" : ""}`.trim() || "nada gerado";
    return (
      <span className="progresso-servico" title={`Gerado: ${rotulo}`} aria-label={`Gerado: ${rotulo}`}>
        <i className={p.docs ? "feito" : ""} />
        <i className={p.planta ? "feito" : ""} />
        <i className={p.pecas ? "feito" : ""} />
      </span>
    );
  }

  return (
    <div className="dashboard">
      <Avisos avisos={avisos} onFechar={fechar} />
      <header className="dash-topo">
        <div>
          <h1>RTKConverte</h1>
          <p className="sub">Georreferenciamento · Memorial INCRA · Planilha SIGEF · Peças técnicas</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="fantasma" onClick={onConfig}>⚙ Configurações</button>
          <button className="fantasma" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </header>

      {retomar && (
        <div className="retomar">
          <div className="rt-texto">
            <span className="rt-rotulo">Continuar de onde parou</span>
            <b>{nomeServico(retomar)}</b>
            <span className="sub">
              {retomar.municipio ? `${retomar.municipio}-${retomar.uf ?? ""} · ` : ""}
              falta {faltando(retomar)}
            </span>
          </div>
          <button className="principal" onClick={() => onAbrir(retomar)}>Abrir serviço →</button>
        </div>
      )}

      <div className="dash-cards">
        <button className="dash-card" onClick={onNovoGeo}>
          <span className="dash-icone" aria-hidden="true">🛰️</span>
          <span className="dash-num">Serviço 1</span>
          <b>Georreferenciamento</b>
          <span className="dash-desc">TXT da máquina → Memorial Descritivo (DOCX) + Planilha SIGEF (ODS)</span>
          <span className="dash-cta">Enviar TXT →</span>
        </button>
        <button className="dash-card" onClick={onNovoPecas}>
          <span className="dash-icone" aria-hidden="true">📑</span>
          <span className="dash-num">Serviço 2</span>
          <b>Peças técnicas</b>
          <span className="dash-desc">PDF de prévia do SIGEF → 7 peças prontas (memorial, tabular, cartas, declarações…)</span>
          <span className="dash-cta">Enviar PDF do SIGEF →</span>
        </button>
      </div>

      <section className="bloco">
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="abas" role="tablist">
            <button role="tab" aria-selected={aba === "clientes"} className={aba === "clientes" ? "aba ativa" : "aba"} onClick={() => setAba("clientes")}>
              👤 Clientes ({clientes.length})
            </button>
            <button role="tab" aria-selected={aba === "servicos"} className={aba === "servicos" ? "aba ativa" : "aba"} onClick={() => setAba("servicos")}>
              📋 Serviços ({servicos.length})
            </button>
          </div>
          <span style={{ flex: 1 }} />
          <input placeholder="🔎 buscar…" style={{ width: 240 }} aria-label="Buscar cliente ou serviço"
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </header>

        {aba === "clientes" && (
          <>
            <div style={{ display: "flex", gap: 8, margin: "4px 0 12px" }}>
              <input placeholder="nome do novo cliente" value={novoNome} style={{ width: 280 }}
                aria-label="Nome do novo cliente"
                onChange={(e) => setNovoNome(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") criarCliente(); }} />
              <button onClick={criarCliente} disabled={!novoNome.trim()}>+ Novo cliente</button>
            </div>
            {carregando ? <p style={{ color: "var(--texto-2)" }}><span className="spinner" /> Carregando…</p> : (
              <div className="tabela-wrap" style={{ maxHeight: 440 }}>
                <table className="tabela-vertices dash-lista">
                  <thead><tr><th>Cliente</th><th>CPF/CNPJ</th><th>Telefone</th><th>Serviços</th><th>Concluídos</th></tr></thead>
                  <tbody>
                    {clientes
                      .filter((c) => `${c.nome} ${c.cpf_cnpj ?? ""}`.toLowerCase().includes(filtro.toLowerCase()))
                      .map((c) => {
                        const meus = servicos.filter((s) => s.cliente_id === c.id);
                        return (
                          <tr key={c.id} className="linha-servico" tabIndex={0} role="button"
                            onClick={() => onAbrirCliente(c.id)}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrirCliente(c.id); } }}>
                            <td><b>{c.nome}</b></td>
                            <td>{c.cpf_cnpj ?? "—"}</td>
                            <td>{c.telefone ?? "—"}</td>
                            <td>{meus.length}</td>
                            <td>{meus.filter((s) => s.status === "gerado").length}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {aba === "servicos" && (<>
        {carregando ? <p style={{ color: "var(--texto-2)" }}><span className="spinner" /> Carregando…</p> : filtrados.length === 0 ? (
          <p style={{ color: "var(--texto-2)" }}>Nenhum serviço {filtro ? "encontrado para a busca" : "ainda — comece pelos cartões acima"}.</p>
        ) : (
          <div className="tabela-wrap" style={{ maxHeight: 480 }}>
            <table className="tabela-vertices dash-lista">
              <thead>
                <tr><th>Tipo</th><th>Imóvel / arquivo</th><th>Cliente</th><th>Município</th><th>Progresso</th><th>Falta</th><th>Criado em</th><th></th></tr>
              </thead>
              <tbody>
                {filtrados.map((s) => (
                  <tr key={s.id} className="linha-servico" tabIndex={0} role="button"
                    onClick={() => onAbrir(s)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAbrir(s); } }}>
                    <td>
                      {s.tipo === "pecas"
                        ? <span className="chip tipo-pecas">2 · Peças</span>
                        : <span className="chip tipo-geo">1 · Geo</span>}
                    </td>
                    <td><b>{s.denominacao ?? "(sem denominação)"}</b>{s.nome_arquivo_txt ? <span className="mono" style={{ color: "var(--texto-2)" }}> · {s.nome_arquivo_txt}</span> : null}</td>
                    <td>{s.detentor_nome ?? "—"}</td>
                    <td>{s.municipio ? `${s.municipio}-${s.uf ?? ""}` : "—"}</td>
                    <td><BarraProgresso s={s} /></td>
                    <td style={{ color: "var(--texto-2)", fontSize: 12 }}>{faltando(s)}</td>
                    <td style={{ color: "var(--texto-2)" }}>{dataFmt((s as unknown as { created_at: string }).created_at)}</td>
                    <td>
                      <BotaoPerigo titulo={`Excluir "${nomeServico(s)}"`}
                        confirmacao="excluir mesmo"
                        onConfirmar={() => excluir(s)}>✕</BotaoPerigo>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </>)}
      </section>
    </div>
  );
}
