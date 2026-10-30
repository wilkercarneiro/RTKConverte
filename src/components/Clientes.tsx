// Lista de clientes — destino próprio da barra lateral.
// Números do cadastro, busca por nome/documento/cidade/telefone, filtros
// rápidos, ordenação e a tabela com contato e andamento dos serviços de cada
// um. Criar abre uma gaveta; excluir não apaga os serviços (a FK é
// 'on delete set null').
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Cliente, Servico } from "../lib/types";
import { avisar, CabecalhoPagina, confirmar, EstadoErro, EstadoVazio, Esqueleto } from "./ui";
import { temPermissao } from "../lib/permissoes";
import { indexarDocumentos, progressoDe } from "../lib/progresso";
import type { DocsDoServico } from "../lib/progresso";
import { useIntegracaoGprol } from "../lib/gprol";
import { Icone, ICONE } from "./Icone";
import { Avatar, Barrinha, IC } from "./clientes/comum";
import { NovoCliente } from "./clientes/NovoCliente";
import { iniciaisDe, linkWhatsApp, relativo, soDigitos, telefoneFmt, tipoDe } from "./clientes/qualificacao";
import "./clientes.css";

/** Iniciais do primeiro e do último nome, para o avatar da linha. */
export const iniciais = iniciaisDe;

type Filtro = "todos" | "andamento" | "sem" | "PF" | "PJ";
type Ordem = "nome" | "recentes" | "servicos" | "ultimo";

interface Linha {
  c: Cliente;
  total: number;
  andamento: number;
  concluidos: number;
  ultimo: string | null;
  ligado: boolean;
}

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function Clientes({ onAbrir }: { onAbrir: (clienteId: string) => void }) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [docs, setDocs] = useState<Record<string, DocsDoServico>>({});
  const [ligados, setLigados] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [ordem, setOrdem] = useState<Ordem>("nome");
  const [gaveta, setGaveta] = useState(false);
  const podeEditar = temPermissao("clientes.editar");
  const podeExcluir = temPermissao("clientes.excluir");
  const { integracao } = useIntegracaoGprol();

  async function carregar() {
    setCarregando(true);
    setFalha(null);
    const [cs, ss, ds] = await Promise.all([
      supabase.from("clientes").select().order("nome"),
      supabase.from("servicos").select("id, cliente_id, status, tipo, modalidade, tem_glebas, created_at"),
      supabase.from("documentos_gerados").select("servico_id, tipo"),
    ]);
    if (cs.error) { setFalha(cs.error.message); setCarregando(false); return; }
    setClientes((cs.data as Cliente[]) ?? []);
    setServicos((ss.data as Servico[]) ?? []);
    setDocs(indexarDocumentos((ds.data as { servico_id: string; tipo: string }[]) ?? []));
    setCarregando(false);
    // vínculo com o GPROL: só um selo; banco sem a 0028 ou sem permissão = nada
    const { data: vs, error: ve } = await supabase.from("vinculos_externos").select("local_id").eq("entidade", "cliente");
    if (!ve && Array.isArray(vs)) setLigados(new Set((vs as { local_id: string }[]).map((v) => v.local_id)));
  }
  useEffect(() => { void carregar(); }, []);

  const linhas = useMemo<Linha[]>(() => {
    const por = new Map<string, Servico[]>();
    for (const s of servicos) if (s.cliente_id) por.set(s.cliente_id, [...(por.get(s.cliente_id) ?? []), s]);
    return clientes.map((c) => {
      const meus = por.get(c.id) ?? [];
      const concluidos = meus.filter((s) => progressoDe(s, docs[s.id]).concluido).length;
      const ultimo = meus.reduce<string | null>((m, s) => (s.created_at && (!m || s.created_at > m) ? s.created_at : m), null);
      return { c, total: meus.length, concluidos, andamento: meus.length - concluidos, ultimo, ligado: ligados.has(c.id) };
    });
  }, [clientes, servicos, docs, ligados]);

  const inicioMes = useMemo(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString(); }, []);
  const kpi = {
    total: linhas.length,
    andamento: linhas.filter((l) => l.andamento > 0).length,
    novos: linhas.filter((l) => (l.c.created_at ?? "") >= inicioMes).length,
    ligados: linhas.filter((l) => l.ligado).length,
  };
  const mostraGprol = integracao?.status === "ativa" || kpi.ligados > 0;

  const contagem: Record<Filtro, number> = {
    todos: linhas.length,
    andamento: kpi.andamento,
    sem: linhas.filter((l) => l.total === 0).length,
    PF: linhas.filter((l) => tipoDe(l.c) === "PF").length,
    PJ: linhas.filter((l) => tipoDe(l.c) === "PJ").length,
  };

  const visiveis = useMemo(() => {
    const q = normal(busca.trim());
    const qDig = soDigitos(busca);
    const lista = linhas.filter((l) => {
      if (filtro === "andamento" && l.andamento === 0) return false;
      if (filtro === "sem" && l.total > 0) return false;
      if ((filtro === "PF" || filtro === "PJ") && tipoDe(l.c) !== filtro) return false;
      if (!q) return true;
      const texto = normal(`${l.c.nome} ${l.c.cidade ?? ""} ${l.c.uf ?? ""} ${l.c.email ?? ""} ${l.c.cpf_cnpj ?? ""}`);
      if (texto.includes(q)) return true;
      // número: CPF/CNPJ ou telefone, com ou sem máscara
      return qDig.length >= 3 && [l.c.cpf_cnpj, l.c.telefone, l.c.telefone2].some((v) => soDigitos(v ?? "").includes(qDig));
    });
    const cmpNome = (a: Linha, b: Linha) => a.c.nome.localeCompare(b.c.nome, "pt-BR");
    const ord: Record<Ordem, (a: Linha, b: Linha) => number> = {
      nome: cmpNome,
      recentes: (a, b) => (b.c.created_at ?? "").localeCompare(a.c.created_at ?? "") || cmpNome(a, b),
      servicos: (a, b) => b.total - a.total || b.andamento - a.andamento || cmpNome(a, b),
      ultimo: (a, b) => (b.ultimo ?? "").localeCompare(a.ultimo ?? "") || cmpNome(a, b),
    };
    return [...lista].sort(ord[ordem]);
  }, [linhas, busca, filtro, ordem]);

  async function excluir(l: Linha) {
    const { c, total } = l;
    const ok = await confirmar({
      titulo: `Excluir o cliente "${c.nome}"?`,
      texto: total > 0
        ? `${total} serviço(s) dele continuam na lista, só que sem cliente.`
        : "Ele não tem serviços vinculados.",
      confirmar: "Excluir cliente", perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("clientes").delete().eq("id", c.id);
    if (error) { avisar("erro", `Não foi possível excluir o cliente: ${error.message}`); return; }
    avisar("ok", total > 0
      ? `Cliente "${c.nome}" excluído. ${total} serviço(s) continuam na lista, agora sem cliente.`
      : `Cliente "${c.nome}" excluído.`);
    void carregar();
  }

  const FILTROS: [Filtro, string][] = [
    ["todos", "Todos"], ["andamento", "Em andamento"], ["sem", "Sem serviço"], ["PF", "Pessoa física"], ["PJ", "Pessoa jurídica"],
  ];
  const limpar = () => { setBusca(""); setFiltro("todos"); };

  return (
    <div className="pagina fade cl-lista">
      <CabecalhoPagina olho="Cadastro" titulo="Clientes"
        descricao={carregando ? "Carregando…" : "Quem contrata os serviços — e vira o detentor nos documentos."}
        acoes={podeEditar && clientes.length > 0 ? (
          <button className="principal cl-com-icone" onClick={() => setGaveta(true)}><Icone d={IC.mais} size={16} traco={2.4} />Novo cliente</button>
        ) : undefined} />

      {!falha && clientes.length > 0 && (
        <div className="cl-kpis" data-grade>
          <div className="cl-kpi"><span>Clientes</span><b>{kpi.total}</b><small>{contagem.PF} PF · {contagem.PJ} PJ</small></div>
          <div className="cl-kpi"><span>Com serviço aberto</span><b>{kpi.andamento}</b><small>{contagem.sem} sem nenhum serviço</small></div>
          <div className="cl-kpi"><span>Novos no mês</span><b>{kpi.novos}</b><small>{new Date().toLocaleDateString("pt-BR", { month: "long" })}</small></div>
          {mostraGprol && <div className="cl-kpi gprol"><span>Ligados ao GPROL</span><b>{kpi.ligados}</b><small>{kpi.total ? Math.round((kpi.ligados / kpi.total) * 100) : 0}% do cadastro</small></div>}
        </div>
      )}

      {clientes.length > 0 && !falha && (
        <div className="cl-barra">
          <div className="busca">
            <Icone d={ICONE.busca} size={16} traco={2} className="busca-icone" />
            <input type="search" placeholder="Nome, CPF/CNPJ, cidade ou telefone" aria-label="Buscar cliente"
              value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <div className="cl-segmento" role="group" aria-label="Filtrar clientes">
            {FILTROS.map(([k, r]) => (
              <button key={k} type="button" className={filtro === k ? "ativo" : ""} aria-pressed={filtro === k} onClick={() => setFiltro(k)}>
                {r}<span className="cl-conta">{contagem[k]}</span>
              </button>
            ))}
          </div>
          <label className="cl-ordem">
            <span>Ordenar</span>
            <select value={ordem} onChange={(e) => setOrdem(e.target.value as Ordem)} aria-label="Ordenar clientes">
              <option value="nome">Nome (A–Z)</option>
              <option value="recentes">Cadastrados por último</option>
              <option value="servicos">Mais serviços</option>
              <option value="ultimo">Último serviço</option>
            </select>
          </label>
        </div>
      )}

      <div className="tabela-wrap">
        {falha ? <EstadoErro mensagem={falha} onTentar={carregar} titulo="Não foi possível carregar os clientes" />
          : carregando ? <Esqueleto linhas={6} rotulo="Carregando clientes…" />
          : clientes.length === 0 ? (
            <EstadoVazio icone={IC.pessoa} titulo="Nenhum cliente cadastrado"
              texto="Cadastre quem contrata os serviços para juntar tudo o que é dele num lugar só."
              acao={podeEditar ? <button className="principal" onClick={() => setGaveta(true)}>Cadastrar primeiro cliente</button> : undefined} />
          ) : visiveis.length === 0 ? (
            <EstadoVazio icone={ICONE.busca} titulo="Nenhum cliente encontrado"
              texto={busca.trim() ? `Nada com "${busca.trim()}" neste filtro.` : "Nenhum cliente neste filtro."}
              acao={<button type="button" onClick={limpar}>Limpar busca e filtros</button>} />
          ) : (
            <table className="tabela-vertices dash-lista cl-tabela">
              <thead>
                <tr>
                  <th>Cliente</th><th className="col-sec">CPF / CNPJ</th><th className="col-sec">Contato</th>
                  <th>Serviços</th><th className="col-sec">Último serviço</th>
                  {podeExcluir && <th className="acao"><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody>
                {visiveis.map((l) => {
                  const { c } = l;
                  const tipo = tipoDe(c);
                  const wa = linkWhatsApp(c.telefone);
                  const local = [c.cidade, c.uf].filter(Boolean).join("-");
                  return (
                    <tr key={c.id} className="linha-servico" tabIndex={0} role="button"
                      onClick={() => onAbrir(c.id)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onAbrir(c.id); } }}>
                      <td>
                        <span className="cl-quem">
                          <Avatar nome={c.nome} pj={tipo === "PJ"} />
                          <span className="cl-quem-txt">
                            <b>{c.nome}{c.is_espolio && <span className="cl-tag espolio">espólio</span>}{l.ligado && <span className="cl-tag gprol" title="Ligado ao GPROL">GPROL</span>}</b>
                            <small>{tipo === "PJ" ? "Pessoa jurídica" : "Pessoa física"}{local ? ` · ${local}` : ""}</small>
                          </span>
                        </span>
                      </td>
                      <td className="mono col-sec cl-doc">{c.cpf_cnpj || <span className="cl-nada">—</span>}</td>
                      <td className="col-sec">
                        <span className="cl-contato">
                          {c.telefone ? (
                            <span className="cl-tel">
                              {telefoneFmt(c.telefone)}
                              {wa && <a href={wa} target="_blank" rel="noreferrer" className="cl-wa" title="Conversar no WhatsApp" aria-label={`WhatsApp de ${c.nome}`}
                                onClick={(e) => e.stopPropagation()}><Icone d={IC.whatsapp} size={15} /></a>}
                            </span>
                          ) : null}
                          {c.email ? <a href={`mailto:${c.email}`} className="cl-email" onClick={(e) => e.stopPropagation()}>{c.email}</a> : null}
                          {!c.telefone && !c.email && <span className="cl-nada">sem contato</span>}
                        </span>
                      </td>
                      <td>
                        {l.total === 0 ? <span className="cl-nada">nenhum</span> : (
                          <span className="cl-servicos" title={`${l.concluidos} concluído(s) de ${l.total}`}>
                            <span className="cl-servicos-num"><b>{l.total}</b>{l.andamento > 0 && <em>{l.andamento} em andamento</em>}</span>
                            <Barrinha valor={l.concluidos} total={l.total} />
                          </span>
                        )}
                      </td>
                      <td className="sub col-sec" title={l.ultimo ? new Date(l.ultimo).toLocaleDateString("pt-BR") : undefined}>{l.ultimo ? relativo(l.ultimo) : "—"}</td>
                      {podeExcluir && (
                        <td className="acao">
                          <button type="button" className="icone" aria-label={`Excluir cliente "${c.nome}"`} title="Excluir cliente"
                            onClick={(e) => { e.stopPropagation(); void excluir(l); }}
                            onKeyDown={(e) => e.stopPropagation()}><Icone d={IC.lixo} size={16} /></button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
      </div>
      {!carregando && !falha && visiveis.length > 0 && visiveis.length < linhas.length && (
        <p className="cl-rodape-lista">{visiveis.length} de {linhas.length} clientes · <button type="button" className="link" onClick={limpar}>mostrar todos</button></p>
      )}

      {gaveta && (
        <NovoCliente existentes={clientes} onFechar={() => setGaveta(false)}
          onCriado={(id) => { setGaveta(false); onAbrir(id); }}
          onAbrirExistente={(id) => { setGaveta(false); onAbrir(id); }} />
      )}
    </div>
  );
}
