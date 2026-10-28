// Lista de clientes — destino próprio da barra lateral.
// Criar, listar com contagem de serviços e excluir sem apagar os serviços
// (a FK é 'on delete set null').
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Cliente, Servico } from "../lib/types";
import { avisar, CabecalhoPagina, confirmar, EstadoErro, EstadoVazio, Esqueleto } from "./ui";
import { temPermissao } from "../lib/permissoes";
import { Icone, ICONE } from "./Icone";

/** Iniciais do primeiro e do último nome, para o avatar da linha. */
export function iniciais(nome: string): string {
  return nome.trim().split(/\s+/).filter((_, i, a) => i === 0 || i === a.length - 1)
    .map((w) => w[0]?.toUpperCase() ?? "").join("");
}

const ICONE_PESSOA = "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8";

export function Clientes({ onAbrir }: { onAbrir: (clienteId: string) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [novo, setNovo] = useState<string | null>(null); // null = formulário fechado
  const [criando, setCriando] = useState(false);
  const podeEditar = temPermissao("clientes.editar");
  const podeExcluir = temPermissao("clientes.excluir");

  async function carregar() {
    setCarregando(true);
    setFalha(null);
    const [cs, ss] = await Promise.all([
      supabase.from("clientes").select().order("nome"),
      supabase.from("servicos").select("id, cliente_id, status"),
    ]);
    if (cs.error) { setFalha(cs.error.message); setCarregando(false); return; }
    setClientes((cs.data as Cliente[]) ?? []);
    setServicos((ss.data as Servico[]) ?? []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  async function criar() {
    const nome = (novo ?? "").trim();
    if (!nome || criando) return;
    setCriando(true);
    const { data, error } = await supabase.from("clientes").insert({ nome: nome.toUpperCase() }).select().single();
    setCriando(false);
    if (error) { avisar("erro", `Não foi possível criar o cliente: ${error.message}`); return; }
    if (data) { setNovo(null); onAbrir((data as Cliente).id); }
  }

  const porCliente = useMemo(() => {
    const m = new Map<string, Servico[]>();
    for (const s of servicos) if (s.cliente_id) m.set(s.cliente_id, [...(m.get(s.cliente_id) ?? []), s]);
    return m;
  }, [servicos]);

  async function excluir(c: Cliente) {
    const meus = porCliente.get(c.id)?.length ?? 0;
    const ok = await confirmar({
      titulo: `Excluir o cliente "${c.nome}"?`,
      texto: meus > 0
        ? `${meus} serviço(s) dele continuam na lista, só que sem cliente.`
        : "Ele não tem serviços vinculados.",
      confirmar: "Excluir cliente", perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("clientes").delete().eq("id", c.id);
    if (error) { avisar("erro", `Não foi possível excluir o cliente: ${error.message}`); return; }
    avisar("ok", meus > 0
      ? `Cliente "${c.nome}" excluído. ${meus} serviço(s) continuam na lista, agora sem cliente.`
      : `Cliente "${c.nome}" excluído.`);
    carregar();
  }

  const visiveis = clientes.filter((c) => `${c.nome} ${c.cpf_cnpj ?? ""}`.toLowerCase().includes(filtro.trim().toLowerCase()));
  const abrirNovo = () => setNovo((n) => (n === null ? "" : n));

  return (
    <div className="pagina fade">
      <CabecalhoPagina olho="Cadastro" titulo="Clientes"
        descricao={carregando ? "Carregando…" : `${clientes.length} ${clientes.length === 1 ? "cadastrado" : "cadastrados"}`}
        acoes={podeEditar && clientes.length > 0 ? <button className="principal" onClick={abrirNovo}>+ Novo cliente</button> : undefined} />

      {novo !== null && (
        <form className="novo-inline" onSubmit={(e) => { e.preventDefault(); criar(); }}>
          <label className="sr-only" htmlFor="novo-cliente">Nome do novo cliente</label>
          <input id="novo-cliente" placeholder="Nome do novo cliente" value={novo} autoFocus
            aria-describedby="novo-cliente-dica"
            onChange={(e) => setNovo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setNovo(null); }} />
          <button type="submit" className="principal" disabled={!novo.trim() || criando}>{criando ? "Criando…" : "Criar e abrir"}</button>
          <button type="button" className="fantasma" onClick={() => setNovo(null)}>Cancelar</button>
          <span id="novo-cliente-dica" className="dica-campo">O nome é gravado em MAIÚSCULAS, como sai nos documentos.</span>
        </form>
      )}

      {clientes.length > 0 && !falha && (
        <div className="barra-filtros">
          <div className="busca">
            <Icone d={ICONE.busca} size={16} traco={2} className="busca-icone" />
            <input type="search" placeholder="Buscar por nome ou CPF/CNPJ" aria-label="Buscar cliente"
              value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          </div>
        </div>
      )}

      <div className="tabela-wrap">
        {falha ? <EstadoErro mensagem={falha} onTentar={carregar} titulo="Não foi possível carregar os clientes" />
          : carregando ? <Esqueleto linhas={5} rotulo="Carregando clientes…" />
          : clientes.length === 0 ? (
            <EstadoVazio icone={ICONE_PESSOA} titulo="Nenhum cliente cadastrado"
              texto="Cadastre quem contrata os serviços para juntar tudo o que é dele num lugar só."
              acao={podeEditar && novo === null ? <button className="principal" onClick={abrirNovo}>Cadastrar primeiro cliente</button> : undefined} />
          ) : visiveis.length === 0 ? (
            <EstadoVazio icone={ICONE.busca} titulo="Nenhum cliente encontrado" texto={`Nada com "${filtro.trim()}".`}
              acao={<button type="button" onClick={() => setFiltro("")}>Limpar busca</button>} />
          ) : (
            <table className="tabela-vertices dash-lista">
              <thead>
                <tr>
                  <th>Cliente</th><th className="col-sec">CPF / CNPJ</th><th className="col-sec">Telefone</th>
                  <th>Serviços</th><th className="col-sec">Concluídos</th>
                  {podeExcluir && <th><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((c) => {
                  const meus = porCliente.get(c.id) ?? [];
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
                      <td className="mono col-sec">{c.cpf_cnpj ?? "—"}</td>
                      <td className="sub col-sec">{c.telefone ?? "—"}</td>
                      <td>{meus.length}</td>
                      <td className="sub col-sec">{meus.filter((s) => s.status === "gerado").length}</td>
                      {podeExcluir && (
                        <td className="acao">
                          <button type="button" className="icone" aria-label={`Excluir cliente "${c.nome}"`} title="Excluir cliente"
                            onClick={(e) => { e.stopPropagation(); excluir(c); }}
                            onKeyDown={(e) => e.stopPropagation()}>✕</button>
                        </td>
                      )}
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
