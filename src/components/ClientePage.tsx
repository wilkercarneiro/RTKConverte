// Página do cliente: dados cadastrais, serviços do cliente e histórico
// completo de documentos gerados (todas as versões, download a qualquer hora).
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { HistoricoDocs } from "./HistoricoDocs";
import { useAutosave, useAvisos } from "../lib/ux";
import { Avisos, BotaoPerigo, Secao, StatusSalvamento } from "./ui";
import { SERVICOS, chaveDoServico, rotuloCurto } from "../lib/modalidades";
import type { ChaveServico } from "../lib/modalidades";
import type { Cliente, Servico } from "../lib/types";
import { Icone } from "./Icone";
import { iniciais } from "./Clientes";

interface Props {
  clienteId: string;
  onVoltar: () => void;
  onAbrirServico: (s: Servico) => void;
  /** Uma porta só para todas as modalidades: elas saem de SERVICOS, não de props. */
  onNovoServico: (chave: ChaveServico) => void;
}

export function ClientePage({ clienteId, onVoltar, onAbrirServico, onNovoServico }: Props) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const { avisos, avisar, fechar } = useAvisos();

  useEffect(() => {
    supabase.from("clientes").select().eq("id", clienteId).single().then(({ data }) => setCliente(data as Cliente));
    supabase.from("servicos").select().eq("cliente_id", clienteId).order("created_at", { ascending: false })
      .then(({ data }) => setServicos((data as Servico[]) ?? []));
  }, [clienteId]);

  async function gravar(c: Cliente | null) {
    if (!c) return;
    const { id, created_at, ...campos } = c;
    const { error } = await supabase.from("clientes").update(campos).eq("id", id);
    if (error) throw error;
  }

  // O cadastro do cliente é a origem dos dados de todos os serviços dele:
  // perder uma correção aqui se propaga. Salva sozinho.
  const auto = useAutosave(cliente, gravar, { ativo: cliente !== null, atraso: 1200 });

  if (!cliente) return <div className="centro"><span className="spinner" />&nbsp; Carregando cliente…</div>;

  function campo<K extends keyof Cliente>(k: K, v: Cliente[K]) {
    setCliente((c) => (c ? { ...c, [k]: v } : c));
  }

  async function salvar() {
    try {
      await gravar(cliente);
      avisar("ok", "Cliente salvo.");
    } catch (e) {
      avisar("erro", e instanceof Error ? e.message : String(e));
    }
  }

  // Os serviços do cliente NÃO são apagados junto: a FK é 'on delete set null',
  // eles voltam para a lista sem cliente vinculado.
  async function excluirCliente() {
    const { error } = await supabase.from("clientes").delete().eq("id", clienteId);
    if (error) { avisar("erro", `Não foi possível excluir o cliente: ${error.message}`); return; }
    onVoltar();
  }

  const dataFmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

  return (
    <div className="pagina fade">
      <Avisos avisos={avisos} onFechar={fechar} />
      <div className="pagina-cabeca">
        <div>
          <button className="fantasma voltar" onClick={onVoltar}>← Clientes</button>
          <div className="celula-nome">
            <span className="avatar-cliente" aria-hidden="true">{iniciais(cliente.nome)}</span>
            <h1 className="titulo-cliente" style={{ margin: 0 }}>{cliente.nome}</h1>
          </div>
          <p className="sub" style={{ marginTop: 6, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {cliente.cpf_cnpj && <span className="mono">{cliente.cpf_cnpj}</span>}
            <span>{servicos.length} {servicos.length === 1 ? "serviço" : "serviços"}</span>
            <StatusSalvamento estado={auto.estado} horaSalvo={auto.horaSalvo} />
          </p>
        </div>
        {/* Um botão por modalidade, direto de SERVICOS: acrescentar uma
            modalidade não exige mais tocar nesta tela. */}
        <div className="acoes">
          {SERVICOS.map((d) => (
            <button key={d.chave} onClick={() => onNovoServico(d.chave)} title={d.resumo}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icone d={d.icone} size={16} /> {d.titulo}
            </button>
          ))}
        </div>
      </div>

      <section className="bloco">
        <header><h3>Dados do cliente</h3><span className="desc">origem do detentor em todos os serviços deste cliente</span></header>
        <div className="grade">
          <label>Nome <input value={cliente.nome} onChange={(e) => campo("nome", e.target.value)} /></label>
          <label>CPF/CNPJ <input className="mono" value={cliente.cpf_cnpj ?? ""} onChange={(e) => campo("cpf_cnpj", e.target.value || null)} /></label>
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

        <div className="secoes" style={{ marginTop: 22 }}>
          <Secao titulo="Espólio e inventariante"
            selo={<span className={`secao-selo ${cliente.is_espolio ? "completa" : ""}`}>{cliente.is_espolio ? "é espólio" : "não"}</span>}
            abrirEm={!!cliente.is_espolio}
            dica="preenche automaticamente todo serviço criado para este cliente">
            <label className="linha-check">
              <input type="checkbox" checked={!!cliente.is_espolio} onChange={(e) => campo("is_espolio", e.target.checked)} />
              É espólio (possuidor/proprietário falecido com inventariante)
            </label>
            {cliente.is_espolio && (
              <div className="grade">
                <label>Nome do inventariante <input value={cliente.inventariante_nome ?? ""} onChange={(e) => campo("inventariante_nome", e.target.value || null)} placeholder="Nome completo do inventariante" /></label>
                <label>CPF do inventariante <input className="mono" value={cliente.inventariante_cpf ?? ""} onChange={(e) => campo("inventariante_cpf", e.target.value || null)} placeholder="000.000.000-00" /></label>
                <label>RG do inventariante (opcional) <input value={cliente.inventariante_rg ?? ""} onChange={(e) => campo("inventariante_rg", e.target.value || null)} placeholder="00.000.000-00" /></label>
              </div>
            )}
          </Secao>
        </div>

        <div className="rodape-bloco">
          <button className="principal" onClick={salvar}>Salvar cliente</button>
          <span className="esticar" />
          <span className="sub" style={{ fontSize: 12.5 }}>
            {servicos.length > 0
              ? `excluir mantém os ${servicos.length} serviço(s), sem cliente vinculado`
              : "este cliente não tem serviços"}
          </span>
          <BotaoPerigo titulo={`Excluir cliente "${cliente.nome}"`}
            confirmacao={servicos.length > 0 ? `excluir e desvincular ${servicos.length} serviço(s)` : "excluir mesmo"}
            onConfirmar={excluirCliente}>Excluir cliente</BotaoPerigo>
        </div>
      </section>

      <section className="bloco lista">
        <header><h3>Serviços deste cliente</h3><span className="desc">{servicos.length} serviço(s)</span></header>
        {servicos.length === 0 ? <p className="vazio">Nenhum serviço ainda — crie pelos botões acima.</p> : (
          <table className="tabela-vertices dash-lista">
            <thead><tr><th>Modalidade</th><th>Imóvel</th><th>Status</th><th>Criado em</th></tr></thead>
            <tbody>
              {servicos.map((s) => (
                <tr key={s.id} className="linha-servico" tabIndex={0} role="button" onClick={() => onAbrirServico(s)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAbrirServico(s); } }}>
                  <td><span className={`chip mod-${chaveDoServico(s)}`}>{rotuloCurto[chaveDoServico(s)]}</span></td>
                  <td><b>{s.denominacao ?? "(sem denominação)"}</b> <span className="sub">{s.municipio ? `· ${s.municipio}-${s.uf}` : ""}</span></td>
                  <td>{s.status === "gerado" ? <span className="chip ok-chip">gerado</span> : <span className="chip P">rascunho</span>}</td>
                  <td className="sub">{dataFmt(s.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="bloco">
        <header><h3>Histórico de documentos</h3>
          <span className="desc">todas as versões geradas, com download a qualquer momento</span></header>
        {servicos.length === 0 ? <p className="sub" style={{ margin: 0 }}>—</p> : servicos.map((s) => (
          <div key={s.id} style={{ marginBottom: 14 }}>
            <b style={{ fontSize: 13 }}>{s.denominacao ?? s.id.slice(0, 8)}</b>
            <span className={`chip mod-${chaveDoServico(s)}`} style={{ marginLeft: 8 }}>{rotuloCurto[chaveDoServico(s)]}</span>
            <HistoricoDocs servicoId={s.id} compacto />
          </div>
        ))}
      </section>
    </div>
  );
}
