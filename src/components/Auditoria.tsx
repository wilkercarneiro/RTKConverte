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
import { useCallback, useEffect, useMemo, useState } from "react";
import { autoriaServicos, categoriaAtividade, listarAtividades, rotuloAtividade, rotuloCampo } from "../lib/equipe";
import type { Atividade, Autoria, Membro } from "../lib/equipe";
import { baixarCsv, duracao, listarAcessos, rotuloTela, usoDaEquipe } from "../lib/acessos";
import type { Sessao, UsoPessoa } from "../lib/acessos";
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

  function exportar() {
    baixarCsv(`auditoria-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Data", "Hora", "Pessoa", "Ação", "Alvo", "Campos", "Vezes"],
      lista.map((a) => {
        const d = new Date(a.created_at);
        const campos = Array.isArray(a.detalhe?.campos) ? (a.detalhe!.campos as string[]).map(rotuloCampo).join(", ") : "";
        return [d.toLocaleDateString("pt-BR"), d.toLocaleTimeString("pt-BR"), a.quem, rotuloAtividade(a.acao), a.alvo, campos, a.vezes ?? 1];
      }));
  }

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
        <button type="button" className="au-exportar" onClick={exportar} disabled={lista.length === 0}>Exportar CSV</button>
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

const PERIODOS: [number, string][] = [[7, "7 dias"], [30, "30 dias"], [90, "90 dias"]];
const BANCO_SEM_0029 = /listar_acessos|uso_da_equipe|does not exist|could not find|schema cache/i;

/** Aba "Uso da equipe": quanto cada pessoa usou o sistema e o que produziu no período. */
export function UsoEquipe() {
  const [dias, setDias] = useState(30);
  const [uso, setUso] = useState<UsoPessoa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    setUso(null); setErro(null);
    usoDaEquipe(dias).then((u) => { if (vivo) setUso(u); }).catch((e: Error) => { if (vivo) setErro(e.message); });
    return () => { vivo = false; };
  }, [dias]);

  const total = useMemo(() => (uso ?? []).reduce((t, u) => ({
    sessoes: t.sessoes + u.sessoes, minutos: t.minutos + u.minutos, servicos: t.servicos + u.servicos_criados,
    documentos: t.documentos + u.documentos, ativos: t.ativos + (u.sessoes > 0 ? 1 : 0),
  }), { sessoes: 0, minutos: 0, servicos: 0, documentos: 0, ativos: 0 }), [uso]);
  const maxMin = Math.max(1, ...(uso ?? []).map((u) => u.minutos));

  function exportar() {
    baixarCsv(`uso-da-equipe-${dias}d.csv`,
      ["Pessoa", "E-mail", "Sessões", "Tempo (min)", "Último acesso", "Serviços criados", "Documentos gerados", "Alterações", "Clientes cadastrados"],
      (uso ?? []).map((u) => [u.nome, u.email, u.sessoes, u.minutos, u.ultimo_acesso ? new Date(u.ultimo_acesso).toLocaleString("pt-BR") : "",
        u.servicos_criados, u.documentos, u.alteracoes, u.clientes]));
  }

  if (erro) return <div className="eq-aviso">{BANCO_SEM_0029.test(erro) ? "O uso da equipe aparece depois da atualização do banco (migração 0029)." : `Não foi possível carregar o uso: ${erro}`}</div>;
  return (
    <div className="au-uso">
      <div className="au-filtros">
        <div className="eq-filtro" role="group" aria-label="Período">
          {PERIODOS.map(([d, r]) => <button key={d} className={dias === d ? "ativo" : ""} onClick={() => setDias(d)}>{r}</button>)}
        </div>
        <button type="button" className="au-exportar" onClick={exportar} disabled={!uso?.length}>Exportar CSV</button>
      </div>
      <div className="au-kpis">
        <div><b>{uso ? `${total.ativos} de ${uso.length}` : "–"}</b><span>pessoas usaram</span></div>
        <div><b>{uso ? total.sessoes : "–"}</b><span>sessões</span></div>
        <div><b>{uso ? duracao(total.minutos) : "–"}</b><span>de uso somado</span></div>
        <div><b>{uso ? total.servicos : "–"}</b><span>serviços criados</span></div>
        <div><b>{uso ? total.documentos : "–"}</b><span>gerações de documentos</span></div>
      </div>
      {!uso ? <div aria-busy="true"><div className="eq-esqueleto eq-linha" /><div className="eq-esqueleto eq-linha" /></div> : (
        <div className="tabela-wrap">
          <table className="tabela-vertices au-tabela">
            <thead>
              <tr><th>Pessoa</th><th>Tempo de uso</th><th className="num">Sessões</th><th className="num">Serviços</th>
                <th className="num">Documentos</th><th className="num col-sec">Alterações</th><th className="num col-sec">Clientes</th><th>Último acesso</th></tr>
            </thead>
            <tbody>
              {uso.map((u) => (
                <tr key={u.user_id} className={u.ativo ? "" : "au-inativo"}>
                  <td><b>{u.nome}</b>{!u.ativo && <span className="eq-selo off au-selo">desativado</span>}</td>
                  <td>
                    <span className="au-barra"><i style={{ width: `${(u.minutos / maxMin) * 100}%` }} /></span>
                    <span className="au-barra-tx">{u.minutos ? duracao(u.minutos) : "sem uso"}</span>
                  </td>
                  <td className="num">{u.sessoes}</td>
                  <td className="num">{u.servicos_criados}</td>
                  <td className="num">{u.documentos}</td>
                  <td className="num col-sec">{u.alteracoes}</td>
                  <td className="num col-sec">{u.clientes}</td>
                  <td className="sub">{u.ultimo_acesso ? quandoFoi(u.ultimo_acesso) : "nunca"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="sub au-nota">O tempo conta do início ao último sinal de cada sessão (o sistema avisa a cada 5 minutos com a tela aberta).</p>
    </div>
  );
}

/** Aba "Acessos": cada sessão, com IP, aparelho, duração e onde parou. */
export function AcessosEquipe({ membros }: { membros: Membro[] | null }) {
  const [pessoa, setPessoa] = useState("");
  const [itens, setItens] = useState<Sessao[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [temMais, setTemMais] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const carregar = useCallback(async (antes?: string) => {
    setCarregando(true); setErro(null);
    try {
      const novos = await listarAcessos(PAGINA, { user: pessoa || undefined, antes });
      setItens((v) => (antes ? [...(v ?? []), ...novos] : novos));
      setTemMais(novos.length === PAGINA);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    setCarregando(false);
  }, [pessoa]);
  useEffect(() => { setItens(null); carregar(); }, [carregar]);

  function exportar() {
    baixarCsv(`acessos-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Pessoa", "Início", "Último sinal", "Duração (min)", "IP", "Navegador", "Sistema", "Aparelho", "Telas", "Última tela"],
      (itens ?? []).map((a) => [a.quem, new Date(a.em).toLocaleString("pt-BR"), new Date(a.ultimo_em).toLocaleString("pt-BR"),
        Math.max(1, Math.round((+new Date(a.ultimo_em) - +new Date(a.em)) / 60_000)), a.ip, a.navegador, a.sistema, a.dispositivo, a.telas, rotuloTela(a.ultima_tela)]));
  }

  const agora = Date.now();
  if (erro) return <div className="eq-aviso">{BANCO_SEM_0029.test(erro) ? "Os acessos aparecem depois da atualização do banco (migração 0029)." : `Não foi possível carregar os acessos: ${erro}`} <button onClick={() => carregar()}>Tentar de novo</button></div>;
  return (
    <div className="au-acessos">
      <div className="au-filtros">
        <label className="au-pessoa">Pessoa
          <select value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            <option value="">Toda a equipe</option>
            {(membros ?? []).map((m) => <option key={m.user_id} value={m.user_id}>{m.nome || m.email}</option>)}
          </select>
        </label>
        <button type="button" className="au-exportar" onClick={exportar} disabled={!itens?.length}>Exportar CSV</button>
      </div>
      {!itens ? <div aria-busy="true"><div className="eq-esqueleto eq-linha" /><div className="eq-esqueleto eq-linha" /></div>
        : itens.length === 0 ? <p className="sub">Nenhum acesso registrado {pessoa ? "para esta pessoa" : "ainda"}.</p> : (
          <div className="tabela-wrap">
            <table className="tabela-vertices au-tabela">
              <thead><tr><th>Pessoa</th><th>Quando</th><th>Duração</th><th>Aparelho</th><th className="col-sec">IP</th><th className="num col-sec">Telas</th><th className="col-sec">Última tela</th></tr></thead>
              <tbody>
                {itens.map((a) => {
                  const min = Math.max(1, Math.round((+new Date(a.ultimo_em) - +new Date(a.em)) / 60_000));
                  const online = agora - +new Date(a.ultimo_em) < 6 * 60_000;
                  return (
                    <tr key={a.id}>
                      <td><b>{a.quem}</b></td>
                      <td>{quandoFoi(a.em)}</td>
                      <td>{online ? <span className="au-online"><i />agora</span> : duracao(min)}</td>
                      <td><span className="au-aparelho">{a.navegador ?? "—"}</span><span className="sub"> · {a.sistema ?? "—"}</span>{a.dispositivo && <span className={`au-disp ${a.dispositivo}`}>{a.dispositivo}</span>}</td>
                      <td className="mono col-sec">{a.ip ?? "—"}</td>
                      <td className="num col-sec">{a.telas}</td>
                      <td className="sub col-sec">{rotuloTela(a.ultima_tela)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {itens && temMais && (
        <button className="au-mais" disabled={carregando} onClick={() => carregar(itens[itens.length - 1].em)}>
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
