// Dashboard: dois fluxos de entrada + lista de serviços existentes.
//   Serviço 1 (geo)   — TXT → Memorial DOCX + Planilha ODS
//   Serviço 2 (pecas) — PDF do SIGEF → 7 peças técnicas
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Cliente, Servico } from "../lib/types";

interface Props {
  onNovoGeo: () => void;
  onNovoPecas: () => void;
  onConfig: () => void;
  onAbrir: (s: Servico) => void;
  onAbrirCliente: (clienteId: string) => void;
}

export function Dashboard({ onNovoGeo, onNovoPecas, onConfig, onAbrir, onAbrirCliente }: Props) {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [aba, setAba] = useState<"clientes" | "servicos">("clientes");
  const [novoNome, setNovoNome] = useState("");

  async function carregar() {
    setCarregando(true);
    const [{ data: ss }, { data: cs }] = await Promise.all([
      supabase.from("servicos").select().order("created_at", { ascending: false }).limit(200),
      supabase.from("clientes").select().order("nome"),
    ]);
    setServicos((ss as Servico[]) ?? []);
    setClientes((cs as Cliente[]) ?? []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function criarCliente() {
    if (!novoNome.trim()) return;
    const { data, error } = await supabase.from("clientes").insert({ nome: novoNome.trim().toUpperCase() }).select().single();
    if (!error && data) { setNovoNome(""); onAbrirCliente((data as Cliente).id); }
  }

  async function excluir(s: Servico) {
    if (!confirm(`Excluir o serviço "${s.denominacao ?? s.nome_arquivo_txt ?? s.id.slice(0, 8)}"? Os arquivos gerados permanecem no Storage.`)) return;
    await supabase.from("servicos").delete().eq("id", s.id);
    carregar();
  }

  const filtrados = servicos.filter((s) => {
    const alvo = `${s.denominacao ?? ""} ${s.detentor_nome ?? ""} ${s.nome_arquivo_txt ?? ""} ${s.municipio ?? ""}`.toLowerCase();
    return alvo.includes(filtro.toLowerCase());
  });

  const dataFmt = (iso?: string) => {
    const d = new Date((iso as unknown as string) ?? "");
    return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="dashboard">
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

      <div className="dash-cards">
        <button className="dash-card" onClick={onNovoGeo}>
          <span className="dash-icone">🛰️</span>
          <span className="dash-num">Serviço 1</span>
          <b>Georreferenciamento</b>
          <span className="dash-desc">TXT da máquina → Memorial Descritivo (DOCX) + Planilha SIGEF (ODS)</span>
          <span className="dash-cta">Enviar TXT →</span>
        </button>
        <button className="dash-card" onClick={onNovoPecas}>
          <span className="dash-icone">📑</span>
          <span className="dash-num">Serviço 2</span>
          <b>Peças técnicas</b>
          <span className="dash-desc">PDF de prévia do SIGEF → 7 peças prontas (memorial, tabular, cartas, declarações…)</span>
          <span className="dash-cta">Enviar PDF do SIGEF →</span>
        </button>
      </div>

      <section className="bloco">
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="abas">
            <button className={aba === "clientes" ? "aba ativa" : "aba"} onClick={() => setAba("clientes")}>
              👤 Clientes ({clientes.length})
            </button>
            <button className={aba === "servicos" ? "aba ativa" : "aba"} onClick={() => setAba("servicos")}>
              📋 Serviços ({servicos.length})
            </button>
          </div>
          <span style={{ flex: 1 }} />
          <input placeholder="🔎 buscar…" style={{ width: 240 }}
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </header>

        {aba === "clientes" && (
          <>
            <div style={{ display: "flex", gap: 8, margin: "4px 0 12px" }}>
              <input placeholder="nome do novo cliente" value={novoNome} style={{ width: 280 }}
                onChange={(e) => setNovoNome(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") criarCliente(); }} />
              <button onClick={criarCliente}>+ Novo cliente</button>
            </div>
            {carregando ? <p style={{ color: "var(--texto-2)" }}>Carregando…</p> : (
              <div className="tabela-wrap" style={{ maxHeight: 440 }}>
                <table className="tabela-vertices dash-lista">
                  <thead><tr><th>Cliente</th><th>CPF/CNPJ</th><th>Telefone</th><th>Serviços</th><th>Gerados</th></tr></thead>
                  <tbody>
                    {clientes
                      .filter((c) => `${c.nome} ${c.cpf_cnpj ?? ""}`.toLowerCase().includes(filtro.toLowerCase()))
                      .map((c) => {
                        const meus = servicos.filter((s) => s.cliente_id === c.id);
                        return (
                          <tr key={c.id} className="linha-servico" onClick={() => onAbrirCliente(c.id)}>
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
        {carregando ? <p style={{ color: "var(--texto-2)" }}>Carregando…</p> : filtrados.length === 0 ? (
          <p style={{ color: "var(--texto-2)" }}>Nenhum serviço {filtro ? "encontrado para a busca" : "ainda — comece pelos cartões acima"}.</p>
        ) : (
          <div className="tabela-wrap" style={{ maxHeight: 480 }}>
            <table className="tabela-vertices dash-lista">
              <thead>
                <tr><th>Tipo</th><th>Imóvel / arquivo</th><th>Cliente</th><th>Município</th><th>Status</th><th>Criado em</th><th></th></tr>
              </thead>
              <tbody>
                {filtrados.map((s) => (
                  <tr key={s.id} className="linha-servico" onClick={() => onAbrir(s)}>
                    <td>
                      {s.tipo === "pecas"
                        ? <span className="chip tipo-pecas">2 · Peças</span>
                        : <span className="chip tipo-geo">1 · Geo</span>}
                    </td>
                    <td><b>{s.denominacao ?? "(sem denominação)"}</b>{s.nome_arquivo_txt ? <span className="mono" style={{ color: "var(--texto-2)" }}> · {s.nome_arquivo_txt}</span> : null}</td>
                    <td>{s.detentor_nome ?? "—"}</td>
                    <td>{s.municipio ? `${s.municipio}-${s.uf ?? ""}` : "—"}</td>
                    <td>{s.status === "gerado" ? <span className="chip ok-chip">gerado</span> : <span className="chip P">rascunho</span>}</td>
                    <td style={{ color: "var(--texto-2)" }}>{dataFmt((s as unknown as { created_at: string }).created_at)}</td>
                    <td><button className="remover" onClick={(e) => { e.stopPropagation(); excluir(s); }}>✕</button></td>
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
