// Lista de clientes — destino próprio da barra lateral.
// Criar, listar com contagem de serviços e excluir sem apagar os serviços
// (a FK é 'on delete set null').
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Cliente, Servico } from "../lib/types";
import { Avisos, BotaoPerigo } from "./ui";
import { useAvisos } from "../lib/ux";
import { Icone, ICONE } from "./Icone";

/** Iniciais do primeiro e do último nome, para o avatar da linha. */
export function iniciais(nome: string): string {
  return nome.trim().split(/\s+/).filter((_, i, a) => i === 0 || i === a.length - 1)
    .map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function Clientes({ onAbrir }: { onAbrir: (clienteId: string) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState("");
  const [novo, setNovo] = useState<string | null>(null); // null = formulário fechado
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
    const nome = (novo ?? "").trim();
    if (!nome) return;
    const { data, error } = await supabase.from("clientes").insert({ nome: nome.toUpperCase() }).select().single();
    if (error) { avisar("erro", `Não foi possível criar o cliente: ${error.message}`); return; }
    if (data) { setNovo(null); onAbrir((data as Cliente).id); }
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
    <div className="pagina fade">
      <Avisos avisos={avisos} onFechar={fechar} />
      <div className="pagina-cabeca">
        <div>
          <h1>Clientes</h1>
          <p className="sub">{clientes.length} {clientes.length === 1 ? "cadastrado" : "cadastrados"}</p>
        </div>
        <div className="busca">
          <Icone d={ICONE.busca} size={16} traco={2} className="busca-icone" />
          <input placeholder="Buscar por nome ou CPF/CNPJ" aria-label="Buscar cliente"
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
        <button className="principal" onClick={() => setNovo((n) => (n === null ? "" : n))}>+ Novo cliente</button>
      </div>

      {novo !== null && (
        <div className="novo-inline">
          <input placeholder="Nome do novo cliente" value={novo} autoFocus
            aria-label="Nome do novo cliente"
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") criar(); if (e.key === "Escape") setNovo(null); }} />
          <button className="principal" onClick={criar} disabled={!novo.trim()}>Criar e abrir</button>
          <button className="fantasma" onClick={() => setNovo(null)}>cancelar</button>
        </div>
      )}

      <div className="tabela-wrap">
        {carregando ? <p className="vazio"><span className="spinner" /> Carregando…</p>
          : visiveis.length === 0 ? <p className="vazio">Nenhum cliente {filtro ? "encontrado" : "ainda"}.</p> : (
            <table className="tabela-vertices dash-lista">
              <thead><tr><th>Cliente</th><th>CPF / CNPJ</th><th>Telefone</th><th>Serviços</th><th>Concluídos</th><th></th></tr></thead>
              <tbody>
                {visiveis.map((c) => {
                  const meus = servicos.filter((s) => s.cliente_id === c.id);
                  return (
                    <tr key={c.id} className="linha-servico" tabIndex={0} role="button"
                      onClick={() => onAbrir(c.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(c.id); } }}>
                      <td>
                        <span className="celula-nome">
                          <span className="avatar-cliente" aria-hidden="true">{iniciais(c.nome)}</span>
                          <b>{c.nome}</b>
                        </span>
                      </td>
                      <td className="mono">{c.cpf_cnpj ?? "—"}</td>
                      <td className="sub">{c.telefone ?? "—"}</td>
                      <td>{meus.length}</td>
                      <td className="sub">{meus.filter((s) => s.status === "gerado").length}</td>
                      <td className="acao">
                        <BotaoPerigo titulo={`Excluir cliente "${c.nome}"`}
                          confirmacao={meus.length > 0 ? `excluir e desvincular ${meus.length} serviço(s)` : "excluir mesmo"}
                          onConfirmar={() => excluir(c)}>✕</BotaoPerigo>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
