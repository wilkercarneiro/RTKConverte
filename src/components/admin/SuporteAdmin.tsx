// Central de suporte do superadmin (migração 0029): caixa de entrada em duas
// colunas. À esquerda os chamados (filtro, busca, prioridade); à direita a
// conversa, o painel de informações (empresa, autor, contexto da tela) e a
// caixa de resposta — que também grava nota interna, que a empresa não vê.
//
// Escrita só pelas RPCs de lib/suporte.ts; anexos vão antes para o bucket
// `suporte`, na pasta da empresa. A conversa aberta se atualiza a cada 20 s.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LIMITE_ANEXO, MAX_ANEXOS, PRIORIDADES, STATUS_SUPORTE, atualizarChamado, chamadosAdmin, ehImagem, enviarAnexo,
  marcarLido, mensagensDoChamado, responderComoSuporte, rotuloCategoria, rotuloPrioridade, tamanhoLegivel, urlDoAnexo,
} from "../../lib/suporte";
import type { Anexo, ChamadoAdmin, Mensagem, PrioridadeChamado, StatusChamado } from "../../lib/suporte";
import type { DadosAdmin } from "./PainelAdmin";
import { avisar, Dica } from "../ui";
import { Carregando, ICO, Ico, Kpi, Topo, duracao, fmtDataHora, haQuanto, iniciais } from "./comum";

type Filtro = "esperando" | "aguardando" | "resolvidos" | "todos";

/** Esperando o suporte: aberto/em atendimento e a última palavra foi da empresa. */
const espera = (c: ChamadoAdmin) => (c.status === "aberto" || c.status === "em_atendimento") && c.ultima_mensagem_de === "cliente";
const FILTROS: { f: Filtro; rot: string; titulo: string; casa: (c: ChamadoAdmin) => boolean }[] = [
  { f: "esperando", rot: "Esperando", titulo: "Esperando o suporte", casa: espera },
  { f: "aguardando", rot: "Aguardando", titulo: "Aguardando a empresa", casa: (c) => c.status !== "resolvido" && !espera(c) },
  { f: "resolvidos", rot: "Resolvidos", titulo: "Resolvidos", casa: (c) => c.status === "resolvido" },
  { f: "todos", rot: "Todos", titulo: "Todos os chamados", casa: () => true },
];
const PESO: Record<PrioridadeChamado, number> = { urgente: 3, alta: 2, normal: 1, baixa: 0 };
const msgErro = (e: unknown) => String(e instanceof Error ? e.message : e);
/** Função inexistente = banco sem a 0029. */
const faltaMigracao = (e: unknown) => /does not exist|could not find|schema cache|PGRST202|404/i.test(msgErro(e));
const ehLargo = () => typeof matchMedia === "function" && matchMedia("(min-width: 901px)").matches;

/** Rascunho por chamado: trocar de conversa não perde o que estava escrito. */
const rascunhos = new Map<string, string>();

export function SuporteAdmin({ d, id }: { d: DadosAdmin; id?: string }) {
  const [lista, setLista] = useState<ChamadoAdmin[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [semBanco, setSemBanco] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("esperando");
  const [busca, setBusca] = useState("");
  const [prio, setPrio] = useState<"" | PrioridadeChamado>("");
  const [sel, setSel] = useState<string | null>(id ?? null);
  const primeira = useRef(true);
  const { recarregarSuporte } = d;

  const carregar = useCallback(async () => {
    try {
      const l = await chamadosAdmin();
      setLista(l);
      setErro(null);
      // primeira abertura sem nada esperando: mostra tudo em vez de uma lista vazia
      if (primeira.current) {
        primeira.current = false;
        if (!l.some(espera) && !id) setFiltro("todos");
      }
    } catch (e) {
      if (faltaMigracao(e)) setSemBanco(true);
      else setErro(msgErro(e));
    }
  }, [id]);
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 30_000);
    return () => clearInterval(t);
  }, [carregar]);
  useEffect(() => { if (id) setSel(id); }, [id]);

  const mudou = useCallback(async () => { await Promise.all([carregar(), recarregarSuporte()]); }, [carregar, recarregarSuporte]);

  const contagem = useMemo(() => Object.fromEntries(FILTROS.map((x) => [x.f, (lista ?? []).filter(x.casa).length])) as Record<Filtro, number>, [lista]);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase().replace(/^#/, "");
    const casa = FILTROS.find((x) => x.f === filtro)!.casa;
    return (lista ?? [])
      .filter(casa)
      .filter((c) => !prio || c.prioridade === prio)
      .filter((c) => !q || String(c.numero) === q
        || [c.assunto, c.empresa, c.autor, c.autor_email ?? "", String(c.numero)].some((t) => t.toLowerCase().includes(q)))
      .sort((a, b) => (filtro === "resolvidos" ? 0 : PESO[b.prioridade] - PESO[a.prioridade]) || b.ultima_mensagem_em.localeCompare(a.ultima_mensagem_em));
  }, [lista, filtro, busca, prio]);

  // no computador a conversa nunca fica vazia: abre o primeiro da lista
  useEffect(() => {
    if (!lista || !ehLargo()) return;
    if (!sel || !lista.some((c) => c.id === sel)) setSel(visiveis[0]?.id ?? null);
  }, [lista, visiveis, sel]);

  const aberto = lista?.find((c) => c.id === sel) ?? null;
  // no celular a conversa toma a tela: volta ao topo da caixa
  const abrir = (x: string | null) => {
    setSel(x);
    if (!ehLargo()) requestAnimationFrame(() => document.querySelector(".sa-cx")?.scrollIntoView({ block: "start" }));
  };

  if (semBanco) {
    return (
      <>
        <Topo olho="Clientes" titulo="Suporte" />
        <section className="sa-card sa-cx-vazio grande">
          <span className="ic"><Ico d={ICO.suporte} /></span>
          <b>A central de suporte precisa da migração 0029</b>
          <p>Aplique <code>supabase/migrations/0029_suporte_equipe_clientes.sql</code> no banco para os chamados das empresas aparecerem aqui.</p>
        </section>
      </>
    );
  }

  // KPIs: média da 1ª resposta e satisfação, dos últimos 30 dias
  const l = lista ?? [];
  const desde = Date.now() - 30 * 86_400_000;
  const respondidos = l.filter((c) => c.primeira_resposta_em && new Date(c.criado_em).getTime() >= desde);
  const mediaResp = respondidos.length
    ? respondidos.reduce((s, c) => s + (new Date(c.primeira_resposta_em!).getTime() - new Date(c.criado_em).getTime()), 0) / respondidos.length
    : null;
  const avaliados = l.filter((c) => c.avaliacao);
  const satisfacao = avaliados.length ? avaliados.reduce((s, c) => s + c.avaliacao!, 0) / avaliados.length : null;
  const esperandoLista = l.filter(espera);
  const maisAntigo = esperandoLista.reduce<string | null>((m, c) => (!m || c.ultima_mensagem_em < m ? c.ultima_mensagem_em : m), null);
  const abertos = l.filter((c) => c.status !== "resolvido");
  const urgentes = abertos.filter((c) => c.prioridade === "urgente" || c.prioridade === "alta").length;

  return (
    <div className={`sa-suporte${aberto ? " com-aberto" : ""}`}>
      <Topo olho="Clientes" titulo="Suporte" sub="Chamados abertos pelas empresas dentro do sistema.">
        <button type="button" onClick={() => { carregar(); recarregarSuporte(); }}><Ico d={ICO.atualizar} />Atualizar</button>
      </Topo>

      <section className="sa-kpis sa-kpis-4" aria-label="Indicadores do suporte">
        <Kpi rotulo="Esperando o suporte" valor={lista ? esperandoLista.length : "—"} icone={ICO.caixa}
          tom={esperandoLista.length ? "alerta" : undefined}
          detalhe={maisAntigo ? `o mais antigo espera há ${haQuanto(maisAntigo)}` : "nenhuma empresa esperando"}
          onClick={() => setFiltro("esperando")} />
        <Kpi rotulo="Abertos" valor={lista ? abertos.length : "—"} icone={ICO.suporte} tom="escuro"
          detalhe={urgentes ? `${urgentes} com prioridade alta ou urgente` : "nenhum urgente"} onClick={() => setFiltro("todos")} />
        <Kpi rotulo="1ª resposta em média" valor={mediaResp === null ? "—" : duracao(mediaResp)} icone={ICO.relogio}
          detalhe={respondidos.length ? `${respondidos.length} chamado(s) nos últimos 30 dias` : "sem respostas nos últimos 30 dias"} />
        <Kpi rotulo="Satisfação" icone={ICO.estrela}
          valor={satisfacao === null ? "—" : <>{satisfacao.toFixed(1).replace(".", ",")}<small className="sa-cx-de5"> / 5</small></>}
          detalhe={avaliados.length ? `${avaliados.length} avaliação(ões) das empresas` : "nenhuma avaliação ainda"} />
      </section>

      <div className={`sa-cx${aberto ? " com-aberto" : ""}`}>
        {/* ------------------------------------------------ lista */}
        <section className="sa-cx-lista" aria-label="Chamados">
          <div className="sa-cx-filtros">
            <div className="sa-cx-abas" role="tablist" aria-label="Situação">
              {FILTROS.map((x) => (
                <button key={x.f} type="button" role="tab" aria-selected={filtro === x.f} title={x.titulo}
                  className={`${filtro === x.f ? "ativo" : ""}${x.f === "esperando" && contagem.esperando ? " pede" : ""}`}
                  onClick={() => setFiltro(x.f)}>
                  <b>{lista ? contagem[x.f] : "–"}</b><span>{x.rot}</span>
                </button>
              ))}
            </div>
            <div className="sa-cx-busca">
              <label className="campo">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" /></svg>
                <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar chamado" aria-label="Buscar chamados" />
              </label>
              <select value={prio} onChange={(e) => setPrio(e.target.value as "" | PrioridadeChamado)} aria-label="Prioridade">
                <option value="">Prioridade</option>
                {[...PRIORIDADES].reverse().map((p) => <option key={p.chave} value={p.chave}>{p.rotulo}</option>)}
              </select>
            </div>
          </div>

          <div className="sa-cx-itens">
            {erro ? (
              <div className="sa-cx-vazio">
                <span className="ic erro"><Ico d={ICO.alerta} /></span>
                <b>Não foi possível carregar os chamados</b>
                <p>{erro}</p>
                <button type="button" onClick={carregar}>Tentar de novo</button>
              </div>
            ) : !lista ? <Carregando /> : visiveis.length === 0 ? (
              <div className="sa-cx-vazio">
                <span className="ic"><Ico d={lista.length ? ICO.caixa : ICO.suporte} /></span>
                {lista.length === 0 ? (
                  <><b>Nenhum chamado ainda</b><p>Quando uma empresa pedir ajuda pelo sistema, a conversa aparece aqui.</p></>
                ) : busca || prio ? (
                  <><b>Nada encontrado</b><p>Nenhum chamado com esses filtros.</p>
                    <button type="button" onClick={() => { setBusca(""); setPrio(""); }}>Limpar filtros</button></>
                ) : filtro === "esperando" ? (
                  <><b>Tudo em dia</b><p>Nenhuma empresa esperando resposta.</p></>
                ) : <><b>Nenhum chamado aqui</b><p>{FILTROS.find((x) => x.f === filtro)!.titulo}: nenhum.</p></>}
              </div>
            ) : visiveis.map((c) => (
              <ItemChamado key={c.id} c={c} ativo={c.id === sel} onClick={() => abrir(c.id)} />
            ))}
          </div>
        </section>

        {/* ------------------------------------------------ conversa */}
        <section className="sa-cx-conversa" aria-label="Conversa">
          {aberto ? (
            <Conversa key={aberto.id} c={aberto} d={d} onMudou={mudou} onVoltar={() => abrir(null)}
              outros={l.filter((x) => x.escritorio_id === aberto.escritorio_id && x.id !== aberto.id)} onAbrir={abrir} />
          ) : (
            <div className="sa-cx-vazio grande">
              <span className="ic"><Ico d={ICO.contatos} /></span>
              <b>{lista && lista.length ? "Escolha um chamado" : "Nenhuma conversa aberta"}</b>
              <p>{lista && lista.length ? "A conversa, os anexos e o contexto da tela aparecem aqui." : "Os chamados das empresas chegam pelo botão de ajuda do sistema."}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ item da lista
function ItemChamado({ c, ativo, onClick }: { c: ChamadoAdmin; ativo: boolean; onClick: () => void }) {
  const naoLido = c.nao_lidas > 0;
  return (
    <button type="button" className={`sa-cx-item p-${c.prioridade}${ativo ? " ativo" : ""}${naoLido ? " nao-lido" : ""}`}
      onClick={onClick} aria-current={ativo ? "true" : undefined}>
      <span className="l1">
        <span className="num">#{c.numero}</span>
        <b className="ass">{c.assunto}</b>
        <time dateTime={c.ultima_mensagem_em} title={fmtDataHora(c.ultima_mensagem_em)}>{haQuanto(c.ultima_mensagem_em)}</time>
      </span>
      <span className="l2">
        <span className="quem">{c.empresa} · {c.autor}</span>
        {naoLido && <span className="sa-badge" title={`${c.nao_lidas} mensagem(ns) não lida(s)`}>{c.nao_lidas}</span>}
      </span>
      {c.previa && <span className="previa">{c.ultima_mensagem_de === "suporte" && <em>Você: </em>}{c.previa}</span>}
      <span className="chips">
        <ChipStatus s={c.status} />
        <span className="sa-cx-chip">{rotuloCategoria(c.categoria)}</span>
        {(c.prioridade === "urgente" || c.prioridade === "alta" || c.prioridade === "baixa") && (
          <span className={`sa-cx-chip pr-${c.prioridade}`}>{rotuloPrioridade(c.prioridade)}</span>
        )}
        {c.avaliacao && <span className="sa-cx-chip nota" title={`Avaliação ${c.avaliacao} de 5`}>★ {c.avaliacao}</span>}
      </span>
    </button>
  );
}

const ChipStatus = ({ s }: { s: StatusChamado }) => <span className={`sa-cx-chip st-${s}`}>{STATUS_SUPORTE[s]}</span>;

// ------------------------------------------------------------------ conversa
function Conversa({ c, d, onMudou, onVoltar, outros, onAbrir }: {
  c: ChamadoAdmin; d: DadosAdmin; onMudou: () => Promise<void>; onVoltar: () => void;
  outros: ChamadoAdmin[]; onAbrir: (id: string) => void;
}) {
  const [msgs, setMsgs] = useState<Mensagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState(() => (typeof innerWidth === "number" ? innerWidth >= 1280 : true) && localStorage.getItem("sa-suporte-info") !== "0");
  const [ampliada, setAmpliada] = useState<{ url: string; nome: string } | null>(null);
  const rolagem = useRef<HTMLDivElement>(null);
  const qtd = useRef(0);

  const carregar = useCallback(async () => {
    try {
      const m = await mensagensDoChamado(c.id);
      setMsgs(m);
      setErro(null);
      // chegou mensagem da empresa com a conversa aberta: já está lida
      if (qtd.current && m.length > qtd.current && m[m.length - 1]?.autor_tipo === "cliente") {
        await marcarLido(c.id);
        onMudou();
      }
      qtd.current = m.length;
    } catch (e) { setErro(msgErro(e)); }
  }, [c.id, onMudou]);

  useEffect(() => {
    carregar();
    marcarLido(c.id).then(() => { if (c.nao_lidas > 0) onMudou(); }).catch(() => {});
    const t = setInterval(carregar, 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.id]);

  // desce até a última mensagem quando chega uma nova
  useEffect(() => {
    const el = rolagem.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs?.length]);

  async function mudar(o: { status?: StatusChamado; prioridade?: PrioridadeChamado }) {
    try {
      await atualizarChamado(c.id, o);
      await Promise.all([carregar(), onMudou()]);
      avisar("ok", o.status ? `Chamado #${c.numero}: ${STATUS_SUPORTE[o.status].toLowerCase()}.` : `Prioridade: ${rotuloPrioridade(o.prioridade!)}.`);
    } catch (e) { avisar("erro", msgErro(e)); }
  }

  function alternarInfo() {
    setInfo((v) => { localStorage.setItem("sa-suporte-info", v ? "0" : "1"); return !v; });
  }

  return (
    <div className={`sa-cx-painel${info ? " com-info" : ""}`}>
      <div className="sa-cx-fio">
        <header className="sa-cx-cabeca">
          <button type="button" className="fantasma sa-cx-voltar" onClick={onVoltar} aria-label="Voltar aos chamados"><Ico d={ICO.voltar} />Chamados</button>
          <div className="linha">
            <span className="num" title={`Chamado nº ${c.numero}`}>#{c.numero}</span>
            <div className="ctl">
              <label className={`sa-cx-sel st-${c.status}`}><span>Status</span>
                <select value={c.status} onChange={(e) => mudar({ status: e.target.value as StatusChamado })}>
                  {(Object.keys(STATUS_SUPORTE) as StatusChamado[]).map((s) => <option key={s} value={s}>{STATUS_SUPORTE[s]}</option>)}
                </select>
              </label>
              <label className={`sa-cx-sel pr-${c.prioridade}`}><span>Prioridade</span>
                <select value={c.prioridade} onChange={(e) => mudar({ prioridade: e.target.value as PrioridadeChamado })}>
                  {PRIORIDADES.map((p) => <option key={p.chave} value={p.chave}>{p.rotulo}</option>)}
                </select>
              </label>
              <button type="button" className={`sa-cx-icone${info ? " on" : ""}`} onClick={alternarInfo} aria-pressed={info}
                title={info ? "Esconder as informações" : "Mostrar as informações"} aria-label="Informações do chamado"><Ico d={ICO.info} /></button>
            </div>
          </div>
          <h2 title={c.assunto}>{c.assunto}</h2>
          <span className="sub"><span className="sa-cx-chip">{rotuloCategoria(c.categoria)}</span>{c.empresa} · {c.autor} · aberto {haQuanto(c.criado_em) === "agora" ? "agora" : `há ${haQuanto(c.criado_em)}`}</span>
        </header>

        <div className="sa-cx-msgs" ref={rolagem}>
          {erro ? (
            <div className="sa-cx-vazio">
              <span className="ic erro"><Ico d={ICO.alerta} /></span><b>Não foi possível carregar a conversa</b><p>{erro}</p>
              <button type="button" onClick={carregar}>Tentar de novo</button>
            </div>
          ) : !msgs ? <Carregando texto="Carregando a conversa…" /> : (
            <>
              {msgs.map((m, i) => <Bolha key={m.id} m={m} ant={msgs[i - 1]} c={c} onAmpliar={setAmpliada} />)}
              {c.avaliacao && <Avaliacao nota={c.avaliacao} comentario={c.avaliacao_comentario} />}
            </>
          )}
        </div>

        <Resposta c={c} onEnviado={async () => { await Promise.all([carregar(), onMudou()]); }} />
      </div>

      {info && <PainelInfo c={c} d={d} outros={outros} onAbrir={onAbrir} onFechar={alternarInfo} />}
      {ampliada && <Ampliada img={ampliada} onFechar={() => setAmpliada(null)} />}
    </div>
  );
}

const rotuloDia = (s: string) => {
  const dt = new Date(s), hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86_400_000);
  if (dt.toDateString() === hoje.toDateString()) return "Hoje";
  if (dt.toDateString() === ontem.toDateString()) return "Ontem";
  return dt.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
};
const hora = (s: string) => new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function Bolha({ m, ant, c, onAmpliar }: { m: Mensagem; ant?: Mensagem; c: ChamadoAdmin; onAmpliar: (x: { url: string; nome: string }) => void }) {
  const novoDia = !ant || new Date(ant.created_at).toDateString() !== new Date(m.created_at).toDateString();
  const dia = novoDia && <div className="sa-cx-dia"><span>{rotuloDia(m.created_at)}</span></div>;
  if (m.autor_tipo === "sistema") {
    return <>{dia}<div className="sa-cx-sistema">{m.texto} · {hora(m.created_at)}</div></>;
  }
  // mensagens seguidas do mesmo lado, em até 5 min, ficam agrupadas
  const seguida = !novoDia && ant && ant.autor_tipo === m.autor_tipo && ant.interna === m.interna
    && new Date(m.created_at).getTime() - new Date(ant.created_at).getTime() < 5 * 60_000;
  const lado = m.autor_tipo === "cliente" ? "cliente" : "suporte";
  const nome = m.interna ? "Nota interna" : lado === "cliente" ? c.autor : "Suporte Vertces";
  return (
    <>
      {dia}
      <div className={`sa-cx-msg ${lado}${m.interna ? " interna" : ""}${seguida ? " seguida" : ""}`}>
        <span className="av" aria-hidden="true">{seguida ? "" : m.interna ? <Ico d={ICO.cadeado} /> : lado === "cliente" ? iniciais(c.autor) : "V"}</span>
        <div className="corpo">
          {!seguida && <div className="meta"><b>{nome}</b><time dateTime={m.created_at} title={fmtDataHora(m.created_at)}>{hora(m.created_at)}</time></div>}
          <div className="sa-cx-balao">
            {m.texto && <div className="tx">{m.texto}</div>}
            {m.anexos?.length > 0 && (
              <div className="anexos">{m.anexos.map((a) => <VistaAnexo key={a.path} a={a} onAmpliar={onAmpliar} />)}</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function VistaAnexo({ a, onAmpliar }: { a: Anexo; onAmpliar: (x: { url: string; nome: string }) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    urlDoAnexo(a.path).then((u) => { if (vivo) setUrl(u); }).catch(() => {});
    return () => { vivo = false; };
  }, [a.path]);
  if (ehImagem(a)) {
    return (
      <button type="button" className="sa-cx-mini" onClick={() => url && onAmpliar({ url, nome: a.nome })} title={`${a.nome} · ${tamanhoLegivel(a.tamanho)}`}
        aria-label={`Ampliar ${a.nome}`}>
        {url ? <img src={url} alt={a.nome} loading="lazy" /> : <span className="spinner" />}
      </button>
    );
  }
  return (
    <a className="sa-cx-arquivo" href={url ?? undefined} download={a.nome} target="_blank" rel="noreferrer" aria-disabled={!url}>
      <span className="ic"><Ico d={ICO.arquivo} /></span>
      <span className="tx"><b>{a.nome}</b><small>{tamanhoLegivel(a.tamanho)}</small></span>
      <Ico d={ICO.baixar} />
    </a>
  );
}

function Ampliada({ img, onFechar }: { img: { url: string; nome: string }; onFechar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [onFechar]);
  return (
    <div className="sa-cx-luz" role="dialog" aria-modal="true" aria-label={img.nome} onClick={onFechar}>
      <figure onClick={(e) => e.stopPropagation()}>
        <img src={img.url} alt={img.nome} />
        <figcaption>
          <span>{img.nome}</span>
          <a href={img.url} download={img.nome} target="_blank" rel="noreferrer"><Ico d={ICO.baixar} />Baixar</a>
          <button type="button" onClick={onFechar}><Ico d={ICO.fechar} />Fechar</button>
        </figcaption>
      </figure>
    </div>
  );
}

function Avaliacao({ nota, comentario }: { nota: number; comentario: string | null }) {
  return (
    <div className="sa-cx-avaliacao">
      <span className="estrelas" aria-label={`${nota} de 5 estrelas`}>
        {[1, 2, 3, 4, 5].map((i) => <span key={i} className={i <= nota ? "on" : ""}>★</span>)}
      </span>
      <b>A empresa avaliou o atendimento com {nota} de 5</b>
      {comentario && <q>{comentario}</q>}
    </div>
  );
}

// ------------------------------------------------------------------ informações
function PainelInfo({ c, d, outros, onAbrir, onFechar }: {
  c: ChamadoAdmin; d: DadosAdmin; outros: ChamadoAdmin[]; onAbrir: (id: string) => void; onFechar: () => void;
}) {
  const plano = d.planos.find((p) => p.nome === c.plano);
  const ctx = c.contexto ?? {};
  const CAMPOS: [string, string][] = [["tela", "Tela"], ["navegador", "Navegador"], ["sistema", "Sistema"], ["tamanho", "Tamanho"], ["ip", "IP"]];
  const conhecidos = new Set([...CAMPOS.map(([k]) => k), "url"]);
  const extras = Object.entries(ctx).filter(([k, v]) => !conhecidos.has(k) && v !== null && v !== "" && typeof v !== "object");
  const url = typeof ctx.url === "string" ? ctx.url : null;
  return (
    <aside className="sa-cx-info" aria-label="Informações do chamado">
      <div className="topo-info">
        <b>Informações</b>
        <button type="button" className="sa-cx-icone" onClick={onFechar} aria-label="Fechar as informações"><Ico d={ICO.fechar} /></button>
      </div>

      <section>
        <h4>Empresa</h4>
        <button type="button" className="sa-cx-empresa" onClick={() => d.ir({ t: "admin", aba: "empresas", id: c.escritorio_id })}>
          <span className="av">{iniciais(c.empresa)}</span>
          <span className="tx"><b>{c.empresa}</b>
            <span className="sa-plano">{plano ? <i style={{ background: plano.cor }} /> : null}{c.plano ?? "Sem plano"}</span>
          </span>
          <Ico d={ICO.externo} />
        </button>
      </section>

      <section>
        <h4>Quem abriu</h4>
        <div className="pessoa"><b>{c.autor}</b>{c.autor_email && <a href={`mailto:${c.autor_email}?subject=${encodeURIComponent(`Chamado #${c.numero}: ${c.assunto}`)}`}>{c.autor_email}</a>}</div>
      </section>

      <section>
        <h4>Atendimento</h4>
        <dl>
          <dt>Aberto em</dt><dd>{fmtDataHora(c.criado_em)}</dd>
          <dt>1ª resposta</dt><dd>{c.primeira_resposta_em ? `em ${duracao(new Date(c.primeira_resposta_em).getTime() - new Date(c.criado_em).getTime())}` : <span className="pede">ainda não respondido</span>}</dd>
          {c.resolvido_em && <><dt>Resolvido em</dt><dd>{fmtDataHora(c.resolvido_em)}</dd></>}
          <dt>Mensagens</dt><dd>{c.mensagens}</dd>
        </dl>
      </section>

      <section>
        <h4>Contexto<Dica>capturado na tela em que a pessoa abriu o chamado — para reproduzir o problema</Dica></h4>
        <dl>
          {CAMPOS.map(([k, r]) => <FragmentoCampo key={k} r={r} v={ctx[k]} mono={k === "ip" || k === "tamanho" || k === "tela"} />)}
          {extras.map(([k, v]) => <FragmentoCampo key={k} r={k} v={v} />)}
        </dl>
        {url && <a className="sa-cx-url" href={url} target="_blank" rel="noreferrer" title={url}><Ico d={ICO.externo} />{url.replace(/^https?:\/\//, "")}</a>}
      </section>

      {outros.length > 0 && (
        <section>
          <h4>Outros chamados da empresa</h4>
          <div className="outros">
            {outros.slice(0, 5).map((o) => (
              <button key={o.id} type="button" onClick={() => onAbrir(o.id)}>
                <span className="num">#{o.numero}</span><span className="ass">{o.assunto}</span><ChipStatus s={o.status} />
              </button>
            ))}
          </div>
        </section>
      )}
    </aside>
  );
}

function FragmentoCampo({ r, v, mono }: { r: string; v: unknown; mono?: boolean }) {
  return <><dt>{r}</dt><dd className={mono ? "mono" : undefined}>{v === null || v === undefined || v === "" ? "—" : String(v)}</dd></>;
}

// ------------------------------------------------------------------ resposta
function Resposta({ c, onEnviado }: { c: ChamadoAdmin; onEnviado: () => Promise<void> }) {
  const [texto, setTexto] = useState(() => rascunhos.get(c.id) ?? "");
  const [interna, setInterna] = useState(false);
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [menu, setMenu] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  const caixaMenu = useRef<HTMLDivElement>(null);

  // a caixa cresce com o texto, até 220 px
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(220, el.scrollHeight + 2)}px`;
    if (texto) rascunhos.set(c.id, texto); else rascunhos.delete(c.id);
  }, [texto, c.id]);

  useEffect(() => {
    if (!menu) return;
    const fora = (e: MouseEvent) => { if (!caixaMenu.current?.contains(e.target as Node)) setMenu(false); };
    addEventListener("mousedown", fora);
    return () => removeEventListener("mousedown", fora);
  }, [menu]);

  function adicionar(lista: FileList | File[] | null) {
    const novos = Array.from(lista ?? []);
    if (!novos.length) return;
    const grandes = novos.filter((f) => f.size > LIMITE_ANEXO);
    if (grandes.length) avisar("erro", `${grandes.map((f) => f.name).join(", ")}: passa de 10 MB.`);
    const cabem = novos.filter((f) => f.size <= LIMITE_ANEXO);
    setArquivos((a) => {
      const junto = [...a, ...cabem];
      if (junto.length > MAX_ANEXOS) avisar("alerta", `Até ${MAX_ANEXOS} arquivos por mensagem.`);
      return junto.slice(0, MAX_ANEXOS);
    });
  }

  const vazio = !texto.trim() && arquivos.length === 0;

  async function enviar(status?: StatusChamado) {
    if (vazio || enviando) return;
    setEnviando(true);
    setMenu(false);
    try {
      const anexos = await Promise.all(arquivos.map((f) => enviarAnexo(c.escritorio_id, c.id, f)));
      await responderComoSuporte(c.id, texto.trim(), { anexos, interna, status: interna ? null : status ?? null });
      setTexto("");
      setArquivos([]);
      rascunhos.delete(c.id);
      await onEnviado();
      avisar("ok", interna ? "Nota interna salva." : status === "resolvido" ? "Resposta enviada e chamado resolvido."
        : status === "em_atendimento" ? "Resposta enviada; o chamado segue em atendimento." : "Resposta enviada à empresa.");
      ta.current?.focus();
    } catch (e) { avisar("erro", msgErro(e)); }
    finally { setEnviando(false); }
  }

  return (
    <div className={`sa-cx-resposta${interna ? " interna" : ""}${arrastando ? " arrastando" : ""}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setArrastando(true); } }}
      onDragLeave={() => setArrastando(false)}
      onDrop={(e) => { e.preventDefault(); setArrastando(false); adicionar(e.dataTransfer.files); }}>
      <div className="modo">
        <div className="sa-cx-modo" role="group" aria-label="Tipo de mensagem">
          <button type="button" className={!interna ? "ativo" : ""} aria-pressed={!interna} onClick={() => setInterna(false)}>Responder à empresa</button>
          <button type="button" className={interna ? "ativo int" : ""} aria-pressed={interna} onClick={() => setInterna(true)}><Ico d={ICO.cadeado} />Nota interna</button>
        </div>
        <span className="sa-cx-atalho"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> envia</span>
      </div>

      <textarea ref={ta} value={texto} rows={2} onChange={(e) => setTexto(e.target.value)}
        placeholder={interna ? "Anotação que só o suporte vê…" : `Responder a ${c.autor.split(/[\s@]/)[0] || "empresa"}…`}
        aria-label={interna ? "Nota interna" : "Resposta"}
        onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); adicionar(fs); } }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar(); } }} />

      {arquivos.length > 0 && (
        <div className="sa-cx-fila">
          {arquivos.map((f, i) => (
            <span key={`${f.name}-${i}`} className="sa-cx-fila-item">
              <Ico d={f.type.startsWith("image/") ? ICO.anexo : ICO.arquivo} />
              <span className="nome" title={f.name}>{f.name}</span><small>{tamanhoLegivel(f.size)}</small>
              <button type="button" className="x" onClick={() => setArquivos((a) => a.filter((_, j) => j !== i))} aria-label={`Tirar ${f.name}`}><Ico d={ICO.fechar} /></button>
            </span>
          ))}
        </div>
      )}

      <div className="acoes">
        <input ref={seletor} type="file" multiple hidden onChange={(e) => { adicionar(e.target.files); e.target.value = ""; }} />
        <button type="button" className="sa-cx-anexar" onClick={() => seletor.current?.click()} disabled={arquivos.length >= MAX_ANEXOS}
          title={`Anexar arquivos (até ${MAX_ANEXOS}, 10 MB cada) — também dá para colar ou arrastar`}>
          <Ico d={ICO.anexo} />Anexar{arquivos.length > 0 && <span className="n">{arquivos.length}/{MAX_ANEXOS}</span>}
        </button>
        <span className="espaco" />
        {interna ? (
          <button type="button" className="principal sa-cx-nota" disabled={vazio || enviando} onClick={() => enviar()}>
            <Ico d={ICO.cadeado} />{enviando ? "Salvando…" : "Salvar nota"}
          </button>
        ) : (
          <div className="sa-cx-split" ref={caixaMenu}>
            <button type="button" className="principal" disabled={vazio || enviando} onClick={() => enviar()}>
              <Ico d={ICO.enviar} />{enviando ? "Enviando…" : "Responder"}
            </button>
            <button type="button" className="principal seta" disabled={vazio || enviando} aria-haspopup="menu" aria-expanded={menu}
              aria-label="Outras formas de responder" onClick={() => setMenu((v) => !v)}><Ico d={ICO.baixo} /></button>
            {menu && (
              <div className="sa-cx-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => enviar("resolvido")}>
                  <b>Responder e resolver</b><small>a empresa recebe a resposta e o chamado fecha</small>
                </button>
                <button type="button" role="menuitem" onClick={() => enviar("em_atendimento")}>
                  <b>Responder e manter em atendimento</b><small>quando o suporte ainda vai voltar com novidade</small>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
