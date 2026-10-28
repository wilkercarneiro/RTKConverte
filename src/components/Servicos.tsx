// Lista de serviços — destino próprio da barra lateral.
//
// A coluna "Falta" e os pontos de progresso mudam com a modalidade: a
// conferência de área termina na etapa 1, então dizer que "falta gerar as
// peças" a ela seria mentira. Quem decide isso é `progressoDe`
// (src/lib/progresso.ts), a mesma função que o Início usa.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Servico } from "../lib/types";
import { chaveDoServico, rotuloCurto } from "../lib/modalidades";
import type { ChaveServico } from "../lib/modalidades";
import { indexarDocumentos, progressoDe } from "../lib/progresso";
import type { DocsDoServico } from "../lib/progresso";
import { avisar, CabecalhoPagina, confirmar, EstadoErro, EstadoVazio, Esqueleto } from "./ui";
import { guardar, lembrar } from "../lib/ux";
import { temPermissao } from "../lib/permissoes";
import { Icone, ICONE } from "./Icone";

type Andamento = "todos" | "andamento" | "concluidos";
const ANDAMENTOS: { chave: Andamento; rotulo: string }[] = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "andamento", rotulo: "Em andamento" },
  { chave: "concluidos", rotulo: "Concluídos" },
];

export function Servicos({ onAbrir, onNovo }: { onAbrir: (s: Servico) => void; onNovo: () => void }) {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [docs, setDocs] = useState<Record<string, DocsDoServico>>({});
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [modalidade, setModalidade] = useState<ChaveServico | "">(() => (lembrar("servicos.modalidade") as ChaveServico | null) ?? "");
  const [andamento, setAndamento] = useState<Andamento>(() => (lembrar("servicos.andamento") as Andamento | null) ?? "todos");
  const podeCriar = temPermissao("servicos.criar");
  const podeExcluir = temPermissao("servicos.excluir");

  async function carregar() {
    setCarregando(true);
    setFalha(null);
    const [ss, ds] = await Promise.all([
      supabase.from("servicos").select().order("created_at", { ascending: false }).limit(200),
      supabase.from("documentos_gerados").select("servico_id, tipo"),
    ]);
    if (ss.error) { setFalha(ss.error.message); setCarregando(false); return; }
    setServicos((ss.data as Servico[]) ?? []);
    setDocs(indexarDocumentos((ds.data as { servico_id: string; tipo: string }[]) ?? []));
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const nome = (s: Servico) => s.denominacao ?? s.nome_arquivo_txt ?? s.id.slice(0, 8);

  async function excluir(s: Servico) {
    const ok = await confirmar({
      titulo: `Excluir "${nome(s)}"?`,
      texto: "O serviço sai da lista com os vértices e confrontantes. Os arquivos já gerados continuam guardados.",
      confirmar: "Excluir serviço", perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("servicos").delete().eq("id", s.id);
    if (error) { avisar("erro", `Não foi possível excluir: ${error.message}`); return; }
    avisar("ok", `Serviço "${nome(s)}" excluído.`);
    carregar();
  }

  const comProgresso = useMemo(() => servicos.map((s) => ({ s, chave: chaveDoServico(s), p: progressoDe(s, docs[s.id]) })), [servicos, docs]);

  // só as modalidades que existem na lista viram filtro
  const modalidades = useMemo(() => {
    const conta = new Map<ChaveServico, number>();
    for (const { chave } of comProgresso) conta.set(chave, (conta.get(chave) ?? 0) + 1);
    return [...conta.entries()].sort((a, b) => b[1] - a[1]);
  }, [comProgresso]);

  const filtrados = useMemo(() => comProgresso.filter(({ s, chave, p }) => {
    if (modalidade && chave !== modalidade) return false;
    if (andamento === "andamento" && p.concluido) return false;
    if (andamento === "concluidos" && !p.concluido) return false;
    const alvo = `${s.denominacao ?? ""} ${s.detentor_nome ?? ""} ${s.nome_arquivo_txt ?? ""} ${s.municipio ?? ""}`.toLowerCase();
    return alvo.includes(filtro.trim().toLowerCase());
  }), [comProgresso, filtro, modalidade, andamento]);

  const emAndamento = comProgresso.filter(({ p }) => !p.concluido).length;
  const filtrando = Boolean(filtro.trim() || modalidade || andamento !== "todos");

  function trocarModalidade(m: ChaveServico | "") { setModalidade(m); guardar("servicos.modalidade", m || null); }
  function trocarAndamento(a: Andamento) { setAndamento(a); guardar("servicos.andamento", a === "todos" ? null : a); }
  function limpar() { setFiltro(""); trocarModalidade(""); trocarAndamento("todos"); }

  const dataFmt = (iso?: string) => {
    const d = new Date(iso ?? "");
    return isNaN(d.getTime()) ? "—" : `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  return (
    <div className="pagina fade">
      <CabecalhoPagina olho="Acervo" titulo="Serviços"
        descricao={carregando ? "Carregando…" : `${servicos.length} no total · ${emAndamento} em andamento`}
        acoes={podeCriar ? <button className="principal" onClick={onNovo}>+ Novo serviço</button> : undefined} />

      <div className="barra-filtros">
        <div className="busca">
          <Icone d={ICONE.busca} size={16} traco={2} />
          <input type="search" placeholder="Imóvel, cliente ou município" aria-label="Buscar serviço"
            value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
        <div className="pilulas" role="group" aria-label="Filtrar por andamento">
          {ANDAMENTOS.map((a) => (
            <button key={a.chave} type="button" className="pilula" aria-pressed={andamento === a.chave}
              onClick={() => trocarAndamento(a.chave)}>
              {a.rotulo}
              {a.chave === "andamento" && !carregando && <span className="conta">{emAndamento}</span>}
            </button>
          ))}
        </div>
        {modalidades.length > 1 && (
          <select className="filtro" aria-label="Filtrar por modalidade" value={modalidade}
            onChange={(e) => trocarModalidade(e.target.value as ChaveServico | "")}>
            <option value="">Todas as modalidades</option>
            {modalidades.map(([m, n]) => <option key={m} value={m}>{rotuloCurto[m]} ({n})</option>)}
          </select>
        )}
        {filtrando && <button type="button" className="fantasma limpar" onClick={limpar}>Limpar filtros</button>}
      </div>

      <div className="tabela-wrap">
        {falha ? <EstadoErro mensagem={falha} onTentar={carregar} titulo="Não foi possível carregar os serviços" />
          : carregando ? <Esqueleto linhas={6} rotulo="Carregando serviços…" />
          : servicos.length === 0 ? (
            <EstadoVazio icone={ICONE.arquivo} titulo="Nenhum serviço ainda"
              texto="Envie o TXT do levantamento, o KML ou o PDF do SIGEF para abrir o primeiro serviço."
              acao={podeCriar ? <button className="principal" onClick={onNovo}>Abrir o primeiro serviço</button> : undefined} />
          ) : filtrados.length === 0 ? (
            <EstadoVazio icone={ICONE.busca} titulo="Nada encontrado com esses filtros"
              texto="Tente outro termo ou limpe os filtros."
              acao={<button type="button" onClick={limpar}>Limpar filtros</button>} />
          ) : (
            <table className="tabela-vertices dash-lista">
              <thead>
                <tr>
                  <th>Imóvel</th><th className="col-sec">Cliente</th><th className="col-sec">Município</th>
                  <th className="col-sec">Modalidade</th><th>Progresso</th><th className="col-sec">Falta</th>
                  {podeExcluir && <th><span className="sr-only">Ações</span></th>}
                </tr>
              </thead>
              <tbody>
                {filtrados.map(({ s, chave, p }) => (
                  <tr key={s.id} className="linha-servico" tabIndex={0} role="button"
                    title={`criado em ${dataFmt(s.created_at)}`}
                    onClick={() => onAbrir(s)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onAbrir(s); } }}>
                    <td>
                      <b>{s.denominacao ?? "(sem denominação)"}</b>
                      {s.nome_arquivo_txt ? <span className="mono sub col-sec"> · {s.nome_arquivo_txt}</span> : null}
                    </td>
                    <td className="sub col-sec">{s.detentor_nome ?? "—"}</td>
                    <td className="sub col-sec">{s.municipio ? `${s.municipio}-${s.uf ?? ""}` : "—"}</td>
                    <td className="col-sec"><span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span></td>
                    <td>
                      <span className="progresso-servico" title={`${p.etapas.filter(Boolean).length} de ${p.etapas.length} etapas`}
                        aria-label={`${p.etapas.filter(Boolean).length} de ${p.etapas.length} etapas`}>
                        {p.etapas.map((feito, i) => <i key={i} className={feito ? "feito" : i === p.atual ? "atual" : ""} />)}
                      </span>
                    </td>
                    <td className="sub col-sec">{p.falta}</td>
                    {podeExcluir && (
                      <td className="acao">
                        <button type="button" className="icone" aria-label={`Excluir "${nome(s)}"`} title="Excluir serviço"
                          onClick={(e) => { e.stopPropagation(); excluir(s); }}
                          onKeyDown={(e) => e.stopPropagation()}>✕</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}
