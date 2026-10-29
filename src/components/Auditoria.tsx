// Auditoria: quem fez o quê, para quem administra a empresa (equipe.gerenciar).
//
//   AuditoriaEmpresa — aba "Auditoria" da Equipe: linha do tempo com filtros
//                      por pessoa e por assunto, e "carregar mais".
//   AutoriaServico   — linha no topo do serviço: quem criou e quem mexeu por
//                      último (todos veem); o administrador abre o histórico
//                      só daquele serviço numa gaveta.
//
// Os dados vêm das RPCs da 0026 (listar_atividades, autoria_servicos). Banco sem
// a 0026: a auditoria mostra o que a 0025 registrava e a autoria não aparece.
import { useCallback, useEffect, useState } from "react";
import { autoriaServicos, categoriaAtividade, listarAtividades, rotuloAtividade, rotuloCampo } from "../lib/equipe";
import type { Atividade, Autoria, Membro } from "../lib/equipe";
import { temPermissao } from "../lib/permissoes";
import { rotaParaHash } from "../lib/rota";
import { Gaveta } from "./ui";

const PAGINA = 100;

/** "há 5 min", "ontem às 14:20", "12/10 às 09:03". */
export function quandoFoi(d: string | null | undefined): string {
  if (!d) return "";
  const t = new Date(d);
  const min = Math.round((Date.now() - t.getTime()) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const hora = t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = new Date(t); dia.setHours(0, 0, 0, 0);
  const dias = Math.round((hoje.getTime() - dia.getTime()) / 86_400_000);
  if (dias === 0) return `hoje às ${hora}`;
  if (dias === 1) return `ontem às ${hora}`;
  return `${t.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: dias > 300 ? "numeric" : undefined })} às ${hora}`;
}

/** Uma linha da linha do tempo. */
function Linha({ a, comServico }: { a: Atividade; comServico: boolean }) {
  const campos = Array.isArray(a.detalhe?.campos) ? (a.detalhe!.campos as string[]) : [];
  const ehDoc = a.acao === "documento.gerado";
  const servicoId = a.servico_id ?? (typeof a.detalhe?.servico_id === "string" ? a.detalhe.servico_id : null);
  const linkServico = comServico && servicoId && a.acao !== "servico.excluido";
  // documento no formato da 0025: uma linha por arquivo, com o título no alvo
  const docAntigo = ehDoc && campos.length === 0 && typeof a.detalhe?.servico === "string";
  const alvo = linkServico
    ? <a href={rotaParaHash({ t: "servico", id: servicoId })}><b>{a.alvo}</b></a>
    : <b>{a.alvo}</b>;
  return (
    <li>
      <span className={`eq-ponto ${categoriaAtividade(a.acao)}`} aria-hidden="true" />
      <span className="eq-hora">{new Date(a.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
      <span className="au-texto">
        <span><b>{a.quem}</b> {docAntigo ? <>gerou <b>{a.alvo}</b> em {linkServico
            ? <a href={rotaParaHash({ t: "servico", id: servicoId })}>{String(a.detalhe!.servico)}</a>
            : String(a.detalhe!.servico)}</> : <>{rotuloAtividade(a.acao)} {alvo}</>}
          {!ehDoc && (a.vezes ?? 1) > 1 && <span className="au-vezes" title="gravações seguidas da mesma pessoa, agrupadas"> · {a.vezes} gravações</span>}
          {ehDoc && a.detalhe?.versao != null && <span className="au-vezes"> · versão {String(a.detalhe.versao)}</span>}
        </span>
        {campos.length > 0 && (
          <span className="au-campos">
            {campos.slice(0, 8).map((c) => <span key={c}>{ehDoc ? c : rotuloCampo(c)}</span>)}
            {campos.length > 8 && <span className="mais">+{campos.length - 8}</span>}
          </span>
        )}
      </span>
    </li>
  );
}

function LinhaDoTempo({ itens, comServico }: { itens: Atividade[]; comServico: boolean }) {
  const porDia = new Map<string, Atividade[]>();
  for (const a of itens) {
    const d = new Date(a.created_at).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
    porDia.set(d, [...(porDia.get(d) ?? []), a]);
  }
  return (
    <>
      {[...porDia].map(([dia, as]) => (
        <section key={dia} className="eq-dia">
          <h4>{dia}</h4>
          <ol>{as.map((a) => <Linha key={a.id} a={a} comServico={comServico} />)}</ol>
        </section>
      ))}
    </>
  );
}

type Assunto = "tudo" | ReturnType<typeof categoriaAtividade>;
const ASSUNTOS: [Assunto, string][] = [
  ["tudo", "Tudo"], ["servicos", "Serviços"], ["documentos", "Documentos"], ["clientes", "Clientes"],
  ["cadastros", "Cadastros e empresa"], ["equipe", "Equipe"],
];

/** Aba "Auditoria" da Equipe. */
export function AuditoriaEmpresa({ membros }: { membros: Membro[] | null }) {
  const [itens, setItens] = useState<Atividade[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pessoa, setPessoa] = useState("");
  const [assunto, setAssunto] = useState<Assunto>("tudo");
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async (antes?: string) => {
    setCarregando(true); setErro(null);
    try {
      const novos = await listarAtividades(PAGINA, { user: pessoa || undefined, antes });
      setItens((v) => (antes ? [...(v ?? []), ...novos] : novos));
      setTemMais(novos.length === PAGINA);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    setCarregando(false);
  }, [pessoa]);
  useEffect(() => { setItens(null); carregar(); }, [carregar]);

  const lista = (itens ?? []).filter((a) => assunto === "tudo" || categoriaAtividade(a.acao) === assunto);

  return (
    <div className="eq-hist">
      <div className="au-filtros">
        <div className="eq-filtro" role="group" aria-label="Filtrar por assunto">
          {ASSUNTOS.map(([k, r]) => (
            <button key={k} className={assunto === k ? "ativo" : ""} onClick={() => setAssunto(k)}>{r}</button>
          ))}
        </div>
        <label className="au-pessoa">Pessoa
          <select value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            <option value="">Toda a equipe</option>
            {(membros ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{m.nome || m.email}</option>)}
          </select>
        </label>
      </div>
      {erro ? <div className="eq-aviso">Não foi possível carregar a auditoria: {erro} <button onClick={() => carregar()}>Tentar de novo</button></div>
        : !itens ? <div aria-busy="true"><div className="eq-esqueleto eq-linha" /><div className="eq-esqueleto eq-linha" /></div>
          : lista.length === 0 ? <p className="sub">Nada registrado {pessoa || assunto !== "tudo" ? "com esses filtros" : "ainda"}.</p>
            : <LinhaDoTempo itens={lista} comServico />}
      {itens && temMais && (
        <button className="au-mais" disabled={carregando} onClick={() => carregar(itens[itens.length - 1].created_at)}>
          {carregando ? "Carregando…" : "Carregar mais antigos"}
        </button>
      )}
    </div>
  );
}

/**
 * "Criado por Ana em 12/10 · alterado por Bruno há 5 min" no topo do serviço.
 * `versao` muda a cada autosave: relê a autoria para "alterado por" acompanhar.
 */
export function AutoriaServico({ servicoId, titulo, versao }: { servicoId: string; titulo: string; versao?: unknown }) {
  const [a, setA] = useState<Autoria | null>(null);
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    let vivo = true;
    autoriaServicos([servicoId]).then((r) => { if (vivo) setA(r[servicoId] ?? null); });
    return () => { vivo = false; };
  }, [servicoId, versao]);
  const admin = temPermissao("equipe.gerenciar");
  if (!a) return null;
  const mesmo = a.criado_por && a.criado_por === a.atualizado_por && a.criado_em === a.atualizado_em;
  return (
    <div className="au-autoria">
      <span>Criado {a.criado_por ? <>por <b>{a.criado_por}</b> </> : null}{quandoFoi(a.criado_em)}</span>
      {!mesmo && a.atualizado_em && (
        <span>· Última alteração {a.atualizado_por ? <>por <b>{a.atualizado_por}</b> </> : null}{quandoFoi(a.atualizado_em)}</span>
      )}
      {admin && <button type="button" className="link" onClick={() => setAberto(true)}>Ver histórico</button>}
      {aberto && <HistoricoServico servicoId={servicoId} titulo={titulo} onFechar={() => setAberto(false)} />}
    </div>
  );
}

function HistoricoServico({ servicoId, titulo, onFechar }: { servicoId: string; titulo: string; onFechar: () => void }) {
  const [itens, setItens] = useState<Atividade[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    listarAtividades(300, { servico: servicoId }).then(setItens).catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, [servicoId]);
  return (
    <Gaveta titulo={titulo} olho="Histórico do serviço" onFechar={onFechar}>
      {erro ? <div className="eq-aviso">Não foi possível carregar o histórico: {erro}</div>
        : !itens ? <div aria-busy="true"><div className="eq-esqueleto eq-linha" /></div>
          : itens.length === 0 ? <p className="sub">Nada registrado para este serviço ainda.</p>
            : <div className="eq-hist"><LinhaDoTempo itens={itens} comServico={false} /></div>}
    </Gaveta>
  );
}
