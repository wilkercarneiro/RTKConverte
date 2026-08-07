// Lista de clientes — antes era uma aba do dashboard, agora é destino próprio.
// A lógica é a mesma: criar, listar com contagem de serviços e excluir sem
// apagar os serviços (a FK é 'on delete set null').
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Cliente, Servico } from "../lib/types";
import { Avisos, BotaoPerigo } from "./ui";
import { useAvisos } from "../lib/ux";

export function Clientes({ onAbrir }: { onAbrir: (clienteId: string) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const { avisos, avisar, fechar } = useAvisos();

  async function carregar() {
    setCarregando(true);
    const [{ data: cs }, { data: ss }] = await Promise.all([
      supabase.from("clientes").select().order("nome"),
      supabase.from("servicos").select("id, cliente_id, status"),
    ]);
    setClientes((cs as Cliente[]) ?? []);
    setServicos((ss as Servico[]) ?? []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function criar() {
    if (!novoNome.trim()) return;
    const { data, error } = await supabase.from("clientes").insert({ nome: novoNome.trim().toUpperCase() }).select().single();
    if (error) { avisar("erro", `Não foi possível criar o cliente: ${error.message}`); return; }
    if (data) { setNovoNome(""); onAbrir((data as Cliente).id); }
  }

  async function excluir(c: Cliente) {
    const meus = servicos.filter((s) => s.cliente_id === c.id).length;
    const { error } = await supabase.from("clientes").delete().eq("id", c.id);
    if (error) { avisar("erro", `Não foi possível excluir o cliente: ${error.message}`); return; }
    avisar("ok", meus > 0
      ? `Cliente "${c.nome}" excluído. ${meus} serviço(s) continuam na lista, agora sem cliente.`
      : `Cliente "${c.nome}" excluído.`);
    carregar();
  }

  const visiveis = clientes.filter((c) => `${c.nome} ${c.cpf_cnpj ?? ""}`.toLowerCase().includes(filtro.toLowerCase()));

  return (
    <div className="pagina">
      <Avisos avisos={avisos} onFechar={fechar} />
      <section className="bloco">
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h3>👤 Clientes</h3>
          <span className="desc">{clientes.length} cadastrado(s)</span>
          <span className="esticar" style={{ flex: 1 }} />
          <input placeholder="🔎 buscar…" style={{ width: 240 }} aria-label="Buscar cliente"
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </header>

        <div style={{ display: "flex", gap: 8, margin: "4px 0 12px" }}>
          <input placeholder="nome do novo cliente" value={novoNome} style={{ width: 280 }}
            aria-label="Nome do novo cliente"
            onChange={(e) => setNovoNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") criar(); }} />
          <button onClick={criar} disabled={!novoNome.trim()}>+ Novo cliente</button>
        </div>

        {carregando ? <p style={{ color: "var(--texto-2)" }}><span className="spinner" /> Carregando…</p>
          : visiveis.length === 0 ? <p style={{ color: "var(--texto-2)" }}>Nenhum cliente {filtro ? "encontrado" : "ainda"}.</p> : (
            <div className="tabela-wrap" style={{ maxHeight: 520 }}>
              <table className="tabela-vertices dash-lista">
                <thead><tr><th>Cliente</th><th>CPF/CNPJ</th><th>Telefone</th><th>Serviços</th><th>Concluídos</th><th></th></tr></thead>
                <tbody>
                  {visiveis.map((c) => {
                    const meus = servicos.filter((s) => s.cliente_id === c.id);
                    return (
                      <tr key={c.id} className="linha-servico" tabIndex={0} role="button"
                        onClick={() => onAbrir(c.id)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(c.id); } }}>
                        <td><b>{c.nome}</b></td>
                        <td>{c.cpf_cnpj ?? "—"}</td>
                        <td>{c.telefone ?? "—"}</td>
                        <td>{meus.length}</td>
                        <td>{meus.filter((s) => s.status === "gerado").length}</td>
                        <td>
                          <BotaoPerigo titulo={`Excluir cliente "${c.nome}"`}
                            confirmacao={meus.length > 0 ? `excluir e desvincular ${meus.length} serviço(s)` : "excluir mesmo"}
                            onConfirmar={() => excluir(c)}>✕</BotaoPerigo>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </section>
    </div>
  );
}
