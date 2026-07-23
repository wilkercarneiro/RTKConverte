// Página do cliente: dados cadastrais, serviços do cliente e histórico
// completo de documentos gerados (todas as versões, download a qualquer hora).
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { HistoricoDocs } from "./HistoricoDocs";
import type { Cliente, Servico } from "../lib/types";

interface Props {
  clienteId: string;
  onVoltar: () => void;
  onAbrirServico: (s: Servico) => void;
  onNovoGeo: (clienteId: string) => void;
  onNovoPecas: (clienteId: string) => void;
}

export function ClientePage({ clienteId, onVoltar, onAbrirServico, onNovoGeo, onNovoPecas }: Props) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("clientes").select().eq("id", clienteId).single().then(({ data }) => setCliente(data as Cliente));
    supabase.from("servicos").select().eq("cliente_id", clienteId).order("created_at", { ascending: false })
      .then(({ data }) => setServicos((data as Servico[]) ?? []));
  }, [clienteId]);

  if (!cliente) return <div className="centro">Carregando cliente…</div>;

  function campo<K extends keyof Cliente>(k: K, v: Cliente[K]) {
    setCliente((c) => (c ? { ...c, [k]: v } : c));
  }

  async function salvar() {
    if (!cliente) return;
    const { id, created_at, ...campos } = cliente;
    const { error } = await supabase.from("clientes").update(campos).eq("id", id);
    setMsg(error ? error.message : "Cliente salvo.");
  }

  const dataFmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

  return (
    <div className="conferencia" style={{ paddingBottom: 40 }}>
      <header className="topo">
        <button className="fantasma" onClick={onVoltar}>← Dashboard</button>
        <span className="arquivo">👤 {cliente.nome}</span>
        <span className="esticar" />
        <button onClick={() => onNovoGeo(clienteId)}>+ Serviço 1 (TXT)</button>
        <button onClick={() => onNovoPecas(clienteId)}>+ Serviço 2 (PDF SIGEF)</button>
      </header>

      <section className="bloco">
        <header><span className="num-bloco">👤</span><h3>Dados do cliente</h3></header>
        <div className="grade">
          <label>Nome <input value={cliente.nome} onChange={(e) => campo("nome", e.target.value)} /></label>
          <label>CPF/CNPJ <input value={cliente.cpf_cnpj ?? ""} onChange={(e) => campo("cpf_cnpj", e.target.value || null)} /></label>
          <label>Gênero
            <select value={cliente.genero} onChange={(e) => campo("genero", e.target.value as "M" | "F")}>
              <option value="M">Masculino</option><option value="F">Feminino</option>
            </select>
          </label>
          <label>Telefone <input value={cliente.telefone ?? ""} onChange={(e) => campo("telefone", e.target.value || null)} /></label>
          <label>E-mail <input value={cliente.email ?? ""} onChange={(e) => campo("email", e.target.value || null)} /></label>
          <label style={{ gridColumn: "span 2" }}>Endereço <input value={cliente.endereco ?? ""} onChange={(e) => campo("endereco", e.target.value || null)} /></label>
          <label style={{ gridColumn: "span 2" }}>Observações <input value={cliente.observacoes ?? ""} onChange={(e) => campo("observacoes", e.target.value || null)} /></label>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="principal" onClick={salvar}>Salvar cliente</button>
          {msg && <span className="ok" style={{ marginLeft: 10 }}>{msg}</span>}
        </div>
      </section>

      <section className="bloco">
        <header><h3>Serviços deste cliente</h3><span className="desc">{servicos.length} serviço(s)</span></header>
        {servicos.length === 0 ? <p style={{ color: "var(--texto-2)" }}>Nenhum serviço ainda — crie pelos botões acima.</p> : (
          <table className="tabela-vertices dash-lista">
            <thead><tr><th>Tipo</th><th>Imóvel</th><th>Status</th><th>Criado em</th></tr></thead>
            <tbody>
              {servicos.map((s) => (
                <tr key={s.id} className="linha-servico" onClick={() => onAbrirServico(s)}>
                  <td>{s.tipo === "pecas" ? <span className="chip tipo-pecas">2 · Peças</span> : <span className="chip tipo-geo">1 · Geo</span>}</td>
                  <td><b>{s.denominacao ?? "(sem denominação)"}</b> {s.municipio ? `· ${s.municipio}-${s.uf}` : ""}</td>
                  <td>{s.status === "gerado" ? <span className="chip ok-chip">gerado</span> : <span className="chip P">rascunho</span>}</td>
                  <td style={{ color: "var(--texto-2)" }}>{dataFmt(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bloco">
        <header><h3>📁 Histórico de documentos</h3>
          <span className="desc">todas as versões geradas, com download a qualquer momento</span></header>
        {servicos.length === 0 ? <p style={{ color: "var(--texto-2)" }}>—</p> : servicos.map((s) => (
          <div key={s.id} style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13 }}>{s.tipo === "pecas" ? "📑" : "🛰️"} {s.denominacao ?? s.id.slice(0, 8)}</b>
            <HistoricoDocs servicoId={s.id} compacto />
          </div>
        ))}
      </section>
    </div>
  );
}
