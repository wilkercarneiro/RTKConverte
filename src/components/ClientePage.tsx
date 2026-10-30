// Página do cliente: cabeçalho com ações rápidas, números, e abas —
// Visão geral (o que está andando, o que falta no cadastro, pedidos do GPROL),
// Cadastro (qualificação completa com autosave e a prévia de como ela sai nos
// documentos), Serviços, Documentos (todas as versões) e Histórico.
//
// O cadastro do cliente vira o DETENTOR dos serviços dele: memorial,
// requerimento e cartas saem com a qualificação daqui.
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { HistoricoDocs } from "./HistoricoDocs";
import { useAutosave } from "../lib/ux";
import { Abas, avisar, BotaoPerigo, Dica, EstadoVazio, Rotulo, Secao, StatusSalvamento } from "./ui";
import { chaveDoServico, rotuloCurto, SERVICOS } from "../lib/modalidades";
import type { ChaveServico } from "../lib/modalidades";
import { servicoLiberado } from "../lib/recursos";
import { temPermissao } from "../lib/permissoes";
import { indexarDocumentos, progressoDe } from "../lib/progresso";
import type { DocsDoServico } from "../lib/progresso";
import type { Cliente, Servico } from "../lib/types";
import { NovoServico } from "./NovoServico";
import { PedidosGprol } from "./gprol/PedidosGprol";
import type { PedidoGprol } from "../lib/gprol";
import { Icone, ICONE } from "./Icone";
import { Avatar, Barrinha, IC, Pontos } from "./clientes/comum";
import { LinhaDoTempoCliente, useHistoricoCliente } from "./clientes/HistoricoCliente";
import {
  avisoDoc, completude, dataCurta, emailValido, ESTADOS_CIVIS, formatarCep, formatarDoc, formatarTelefone, linkWhatsApp,
  mesAno, ORIGENS, qualificacao, qualificacaoTexto, REGIMES, relativo, ROTULO_ESTADO_CIVIL, temConjuge, tipoDe, UFS,
} from "./clientes/qualificacao";
import "./clientes.css";

interface Props {
  clienteId: string;
  onVoltar: () => void;
  onAbrirServico: (s: Servico) => void;
  /** Uma porta só para todas as modalidades: elas saem de SERVICOS, não de props. */
  onNovoServico: (chave: ChaveServico) => void;
  /** executar um pedido do GPROL deste cliente */
  onExecutarPedido?: (p: PedidoGprol, chave: ChaveServico) => void;
}

type Aba = "visao" | "cadastro" | "servicos" | "documentos" | "historico";
type FiltroServ = "andamento" | "concluidos" | "todos";

export function ClientePage(props: Props) {
  const { clienteId, onVoltar } = props;
  const [inicial, setInicial] = useState<Cliente | null>(null);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setErroCarga(null);
    setInicial(null);
    supabase.from("clientes").select().eq("id", clienteId).maybeSingle().then(({ data, error }) => {
      if (!vivo) return;
      if (error) setErroCarga(error.message);
      else if (!data) setErroCarga("Este cliente não existe mais, ou não é da sua empresa.");
      else setInicial(data as Cliente);
    });
    return () => { vivo = false; };
  }, [clienteId, tentativa]);

  if (erroCarga) {
    return (
      <div className="pagina">
        <button className="fantasma voltar cl-voltar" onClick={onVoltar}>← Clientes</button>
        <div className="aviso-erro-pagina" role="alert">
          <span>Não foi possível abrir o cliente. {erroCarga}</span>
          <button onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button>
        </div>
      </div>
    );
  }
  if (!inicial) return <div className="centro"><span className="spinner" />&nbsp; Carregando cliente…</div>;
  // a ficha só monta com o cadastro na mão: o autosave registra como "já
  // gravado" o que veio do banco (montar antes gravaria o cliente ao abrir)
  return <FichaCliente key={`${inicial.id}-${tentativa}`} {...props} inicial={inicial} />;
}

function FichaCliente({ clienteId, inicial, onVoltar, onAbrirServico, onNovoServico, onExecutarPedido }: Props & { inicial: Cliente }) {
  const [cliente, setCliente] = useState<Cliente>(inicial);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [docs, setDocs] = useState<Record<string, DocsDoServico>>({});
  const [nDocs, setNDocs] = useState<Record<string, number>>({});
  const [ligado, setLigado] = useState(false);
  const [aba, setAba] = useState<Aba>("visao");
  const [filtroServ, setFiltroServ] = useState<FiltroServ>("todos");
  const editar = temPermissao("clientes.editar");
  const criar = temPermissao("servicos.criar");
  const historico = useHistoricoCliente(clienteId);

  useEffect(() => {
    let vivo = true;
    supabase.from("servicos").select().eq("cliente_id", clienteId).order("created_at", { ascending: false })
      .then(async ({ data }) => {
        const ss = (data as Servico[]) ?? [];
        if (!vivo) return;
        setServicos(ss);
        if (!ss.length) return;
        const { data: ds } = await supabase.from("documentos_gerados").select("servico_id, tipo").in("servico_id", ss.map((s) => s.id));
        if (!vivo) return;
        const lista = (ds as { servico_id: string; tipo: string }[]) ?? [];
        setDocs(indexarDocumentos(lista));
        const n: Record<string, number> = {};
        for (const d of lista) n[d.servico_id] = (n[d.servico_id] ?? 0) + 1;
        setNDocs(n);
      });
    // selo "Ligado ao GPROL": silencioso (banco sem a 0028, sem vínculo, sem permissão)
    supabase.from("vinculos_externos").select("externo_id").eq("entidade", "cliente").eq("local_id", clienteId).maybeSingle()
      .then(({ data, error }) => { if (vivo) setLigado(!error && !!data); }, () => {});
    return () => { vivo = false; };
  }, [clienteId]);

  async function gravar(c: Cliente) {
    const { id, created_at, ...campos } = c;
    void created_at;
    const { error } = await supabase.from("clientes").update(campos).eq("id", id);
    if (error) throw error;
  }

  // O cadastro do cliente é a origem dos dados de todos os serviços dele:
  // perder uma correção aqui se propaga. Salva sozinho.
  const auto = useAutosave(cliente, gravar, { ativo: editar, atraso: 1200 });

  const prog = (s: Servico) => progressoDe(s, docs[s.id]);
  const andamento = useMemo(() => servicos.filter((s) => !progressoDe(s, docs[s.id]).concluido), [servicos, docs]);
  const totalDocs = Object.values(nDocs).reduce((a, b) => a + b, 0);

  const c = cliente;
  const tipo = tipoDe(c);
  const pj = tipo === "PJ";
  const comp = completude(c);
  const wa = linkWhatsApp(c.telefone) ?? linkWhatsApp(c.telefone2);
  const local = [c.cidade, c.uf].filter(Boolean).join("-");
  const ultimo = servicos[0]?.created_at ?? null;

  function campo<K extends keyof Cliente>(k: K, v: Cliente[K]) {
    setCliente((x) => (x ? { ...x, [k]: v } : x));
  }
  const txt = (k: keyof Cliente) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    campo(k, (e.target.value || null) as never);

  /** Leva ao campo no formulário (abre a aba Cadastro e pisca o campo). */
  function irAoCampo(nome: string) {
    setAba("cadastro");
    setTimeout(() => {
      const el = document.getElementById(`cl-${nome}`);
      if (!el) return;
      el.closest("details")?.setAttribute("open", "");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      (el as HTMLInputElement).focus?.({ preventScroll: true });
      el.classList.add("cl-piscar");
      setTimeout(() => el.classList.remove("cl-piscar"), 1600);
    }, 60);
  }

  async function salvar() {
    try {
      await gravar(cliente);
      avisar("ok", "Cliente salvo.");
    } catch (e) {
      avisar("erro", e instanceof Error ? e.message : String(e));
    }
  }

  async function copiarQualificacao() {
    try {
      await navigator.clipboard.writeText(qualificacaoTexto(c));
      avisar(comp.faltam.length ? "alerta" : "ok", comp.faltam.length
        ? `Qualificação copiada com ${comp.faltam.length} lacuna(s): ${comp.faltam.map((f) => f.rotulo).join(", ")}.`
        : "Qualificação copiada.");
    } catch {
      avisar("erro", "O navegador não deixou copiar. Selecione o texto na aba Cadastro.");
    }
  }

  // Os serviços do cliente NÃO são apagados junto: a FK é 'on delete set null',
  // eles voltam para a lista sem cliente vinculado.
  async function excluirCliente() {
    const { error } = await supabase.from("clientes").delete().eq("id", clienteId);
    if (error) { avisar("erro", `Não foi possível excluir o cliente: ${error.message}`); return; }
    onVoltar();
  }

  const servFiltrados = servicos.filter((s) => filtroServ === "todos" ? true : filtroServ === "andamento" ? !prog(s).concluido : prog(s).concluido);
  const comDocs = servicos.filter((s) => (nDocs[s.id] ?? 0) > 0);
  const semDocs = servicos.filter((s) => !(nDocs[s.id] ?? 0));
  const n0 = c.nome.trim().split(/\s+/)[0] ?? "";
  // "MARIA" → "Maria"; PJ vira "este cliente" ("AGROPECUÁRIA" leria estranho)
  const primeiroNome = n0.charAt(0) + n0.slice(1).toLocaleLowerCase("pt-BR");
  const deQuem = pj ? "deste cliente" : `de ${primeiroNome}`;

  return (
    <div className="pagina fade cl-pagina">
      <button className="fantasma voltar cl-voltar" onClick={onVoltar}>← Clientes</button>

      <header className="cl-cabeca">
        <Avatar nome={c.nome} pj={pj} grande />
        <div className="cl-cabeca-txt">
          <h1>{c.nome || "(sem nome)"}</h1>
          <div className="cl-chips">
            <span className="cl-chip">{pj ? "Pessoa jurídica" : "Pessoa física"}</span>
            {local && <span className="cl-chip"><Icone d={IC.pino} size={13} traco={2} />{local}</span>}
            {c.cpf_cnpj && <span className="cl-chip mono">{c.cpf_cnpj}</span>}
            {ligado && <span className="cl-chip gprol" title="Este cliente existe também no GPROL"><Icone d={IC.elo} size={13} traco={2} />Ligado ao GPROL</span>}
            {c.is_espolio && <span className="cl-chip espolio">Espólio</span>}
            {editar && auto.estado !== "ocioso" && <StatusSalvamento estado={auto.estado} horaSalvo={auto.horaSalvo} />}
          </div>
        </div>
        <div className="cl-acoes">
          {wa
            ? <a className="cl-botao wa" href={wa} target="_blank" rel="noreferrer"><Icone d={IC.whatsapp} size={16} />WhatsApp</a>
            : <button type="button" className="cl-botao" onClick={() => irAoCampo("telefone")} title="Sem telefone: cadastrar"><Icone d={IC.whatsapp} size={16} />WhatsApp</button>}
          {c.email
            ? <a className="cl-botao" href={`mailto:${c.email}`}><Icone d={IC.email} size={16} />E-mail</a>
            : <button type="button" className="cl-botao" onClick={() => irAoCampo("email")} title="Sem e-mail: cadastrar"><Icone d={IC.email} size={16} />E-mail</button>}
          <button type="button" className="cl-botao" onClick={copiarQualificacao} title="Copia o texto da qualificação, como sai no memorial e no requerimento">
            <Icone d={IC.copiar} size={16} />Copiar qualificação
          </button>
          {criar && <MenuNovoServico onNovo={onNovoServico} />}
        </div>
      </header>

      <div className="cl-kpis" data-grade>
        <div className="cl-kpi"><span>Serviços</span><b>{servicos.length}</b></div>
        <div className="cl-kpi"><span>Em andamento</span><b className={andamento.length ? "cl-num-alerta" : ""}>{andamento.length}</b></div>
        <div className="cl-kpi"><span>Concluídos</span><b>{servicos.length - andamento.length}</b></div>
        <div className="cl-kpi"><span>Documentos gerados</span><b>{totalDocs}</b></div>
        <div className="cl-kpi"><span>Cliente desde</span><b className="menor">{mesAno(c.created_at)}</b></div>
        <div className="cl-kpi"><span>Último serviço</span><b className="menor">{ultimo ? relativo(ultimo) : "—"}</b></div>
      </div>

      <Abas<Aba> rotulo="Seções do cliente" ativa={aba} onTrocar={setAba} abas={[
        { chave: "visao", rotulo: "Visão geral" },
        { chave: "cadastro", rotulo: comp.faltam.length ? `Cadastro · ${comp.pct}%` : "Cadastro" },
        { chave: "servicos", rotulo: `Serviços · ${servicos.length}` },
        { chave: "documentos", rotulo: `Documentos · ${totalDocs}` },
        { chave: "historico", rotulo: "Histórico" },
      ]} />

      {aba === "visao" && (
        <>
          {onExecutarPedido && <PedidosGprol clienteId={clienteId} onExecutar={onExecutarPedido} />}
          <div className="cl-visao">
            <div className="cl-principal">
            <section className="cl-cartao">
              <header className="cl-cartao-cab">
                <h3>Em andamento<span className="cl-conta">{andamento.length}</span></h3>
                {servicos.length > 0 && <button type="button" className="link" onClick={() => setAba("servicos")}>Ver todos os serviços</button>}
              </header>
              {andamento.length === 0 ? (
                <EstadoVazio compacto icone={ICONE.relogio}
                  titulo={servicos.length ? "Nada pendente" : "Nenhum serviço ainda"}
                  texto={servicos.length
                    ? (servicos.length === 1 ? `O único serviço ${deQuem} está concluído.` : `Os ${servicos.length} serviços ${deQuem} estão concluídos.`)
                    : criar ? "Escolha uma modalidade em “Novo serviço” para começar." : "Os serviços deste cliente aparecem aqui."} />
              ) : (
                <ul className="cl-passos">
                  {andamento.slice(0, 6).map((s) => {
                    const p = prog(s);
                    const chave = chaveDoServico(s);
                    return (
                      <li key={s.id}>
                        <button type="button" onClick={() => onAbrirServico(s)}>
                          <span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span>
                          <span className="cl-passo-txt">
                            <b>{s.denominacao ?? s.nome_arquivo_txt ?? "(sem denominação)"}</b>
                            <small>{s.municipio ? `${s.municipio}-${s.uf ?? ""} · ` : ""}criado {relativo(s.created_at)}</small>
                          </span>
                          <span className="cl-passo-prog">
                            <Pontos p={p} />
                            <small>falta {p.falta}</small>
                          </span>
                          <Icone d={IC.ir} size={16} className="cl-seta" />
                        </button>
                      </li>
                    );
                  })}
                  {andamento.length > 6 && <li className="cl-mais"><button type="button" className="link" onClick={() => { setFiltroServ("andamento"); setAba("servicos"); }}>+{andamento.length - 6} em andamento</button></li>}
                </ul>
              )}
            </section>

            <section className="cl-cartao">
              <header className="cl-cartao-cab">
                <h3>Atividade recente</h3>
                {historico && historico.length > 0 && <button type="button" className="link" onClick={() => setAba("historico")}>Ver histórico completo</button>}
              </header>
              {historico === null ? <div className="linha-esqueleto" />
                : historico.length === 0 ? <p className="cl-vazio-curto">Nada registrado ainda.</p>
                  : <LinhaDoTempoCliente itens={historico.slice(0, 4)} compacto />}
            </section>
            </div>

            <aside className="cl-lado">
              <section className="cl-cartao">
                <header className="cl-cartao-cab">
                  <h3>Cadastro<Dica>o que falta aqui sai em branco no memorial, no requerimento e nas cartas</Dica></h3>
                  <span className={`cl-pct${comp.pct === 100 ? " ok" : comp.pct < 60 ? " baixo" : ""}`}>{comp.pct}%</span>
                </header>
                <Barrinha valor={comp.pct} total={100} tom={comp.pct < 100 ? "alerta" : undefined} />
                {comp.faltam.length === 0 ? (
                  <p className="cl-completo"><Icone d={IC.ok} size={16} traco={2.4} />Qualificação completa: os documentos saem sem lacuna.</p>
                ) : (
                  <>
                    <p className="cl-falta-tit">Falta para os documentos saírem completos</p>
                    <div className="cl-faltas">
                      {comp.faltam.map((f) => (
                        <button key={f.campo + f.rotulo} type="button" onClick={() => irAoCampo(f.campo)}>{f.rotulo}</button>
                      ))}
                    </div>
                  </>
                )}
                <dl className="cl-resumo">
                  {!pj && <><dt>Estado civil</dt><dd>{c.estado_civil ? ROTULO_ESTADO_CIVIL[c.estado_civil] ?? c.estado_civil : "—"}</dd></>}
                  {pj && <><dt>Representante</dt><dd>{c.representante_nome || "—"}</dd></>}
                  <dt>Telefone</dt><dd>{c.telefone || "—"}</dd>
                  <dt>Endereço</dt><dd>{[c.endereco, local].filter(Boolean).join(", ") || "—"}</dd>
                </dl>
                <button type="button" className="cl-botao largo" onClick={() => setAba("cadastro")}>{editar ? "Completar cadastro" : "Ver cadastro"}</button>
              </section>
            </aside>
          </div>

          {criar && <NovoServico onNovo={onNovoServico} compacto titulo={pj ? "Novo serviço para este cliente" : `Novo serviço para ${primeiroNome}`} />}
        </>
      )}

      {aba === "cadastro" && (
        <div className="cl-cadastro">
          <section className="bloco cl-form">
            <header>
              <h3>Dados do cliente{editar && <Dica>origem do detentor em todos os serviços deste cliente · salva sozinho</Dica>}</h3>
              <span className="esticar" />
              {/* sem permissão é estado, não instrução: fica à vista */}
              {editar ? <StatusSalvamento estado={auto.estado} horaSalvo={auto.horaSalvo} />
                : <span className="cl-so-leitura">somente leitura: você não tem a permissão de editar clientes</span>}
            </header>
            <fieldset className="sem-borda" disabled={!editar}>
              <div className="cl-sec">
                <h4>Identificação</h4>
                <div className="grade" data-grade>
                  <label className="largo"><Rotulo dica="gravado em MAIÚSCULAS, como sai nos documentos">{pj ? "Razão social" : "Nome completo"}</Rotulo>
                    <input id="cl-nome" className="cl-maiusculo" value={c.nome} onChange={(e) => campo("nome", e.target.value.toUpperCase())} />
                  </label>
                  <label><Rotulo>Tipo de pessoa</Rotulo>
                    <select id="cl-tipo_pessoa" value={tipo} onChange={(e) => {
                      const t = e.target.value as "PF" | "PJ";
                      setCliente((x) => (x ? { ...x, tipo_pessoa: t, cpf_cnpj: x.cpf_cnpj ? formatarDoc(x.cpf_cnpj, t) || x.cpf_cnpj : x.cpf_cnpj } : x));
                    }}>
                      <option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option>
                    </select>
                  </label>
                  <CampoDoc id="cl-cpf_cnpj" rotulo={pj ? "CNPJ" : "CPF"} tipo={tipo} valor={c.cpf_cnpj} onChange={(v) => campo("cpf_cnpj", v)} />
                  {!pj && (
                    <>
                      <label><Rotulo dica="decide brasileiro/brasileira, portador/portadora, inscrito/inscrita nos documentos">Gênero</Rotulo>
                        <select id="cl-genero" value={c.genero} onChange={(e) => campo("genero", e.target.value as "M" | "F")}>
                          <option value="M">Masculino</option><option value="F">Feminino</option>
                        </select>
                      </label>
                      <label><Rotulo>RG</Rotulo><input id="cl-rg" value={c.rg ?? ""} onChange={txt("rg")} placeholder="00.000.000-00" /></label>
                      <label><Rotulo>Órgão emissor</Rotulo>
                        <input id="cl-rg_orgao" value={c.rg_orgao ?? ""} onChange={(e) => campo("rg_orgao", e.target.value.toUpperCase() || null)} placeholder="SSP/BA" />
                      </label>
                    </>
                  )}
                </div>
              </div>

              {!pj && (
                <div className="cl-sec">
                  <h4>Qualificação civil</h4>
                  <div className="grade" data-grade>
                    <label><Rotulo>Data de nascimento</Rotulo>
                      <input id="cl-data_nascimento" type="date" value={c.data_nascimento ?? ""} onChange={txt("data_nascimento")} />
                    </label>
                    <label><Rotulo dica="em branco sai “brasileiro” ou “brasileira”, pelo gênero">Nacionalidade</Rotulo>
                      <input id="cl-nacionalidade" value={c.nacionalidade ?? ""} onChange={txt("nacionalidade")} placeholder="brasileira" />
                    </label>
                    <label><Rotulo>Profissão</Rotulo>
                      <input id="cl-profissao" value={c.profissao ?? ""} onChange={txt("profissao")} placeholder="Ex.: agricultor" />
                    </label>
                    <label><Rotulo>Estado civil</Rotulo>
                      <select id="cl-estado_civil" value={c.estado_civil ?? ""} onChange={txt("estado_civil")}>
                        <option value="">Não informado</option>
                        {ESTADOS_CIVIS.map((e) => <option key={e.chave} value={e.chave}>{ROTULO_ESTADO_CIVIL[e.chave]}</option>)}
                      </select>
                    </label>
                    {temConjuge(c) && (
                      <>
                        <label><Rotulo dica={c.estado_civil === "uniao_estavel" ? "só se houver contrato com regime definido" : undefined}>Regime de bens</Rotulo>
                          <select id="cl-regime_bens" value={c.regime_bens ?? ""} onChange={txt("regime_bens")}>
                            <option value="">Não informado</option>
                            {REGIMES.map((r) => <option key={r.chave} value={r.chave}>{r.rotulo}</option>)}
                          </select>
                        </label>
                        <label><Rotulo>{c.estado_civil === "casado" ? "Cônjuge" : "Companheiro(a)"}</Rotulo>
                          <input id="cl-conjuge_nome" className="cl-maiusculo" value={c.conjuge_nome ?? ""} onChange={(e) => campo("conjuge_nome", e.target.value.toUpperCase() || null)} placeholder="Nome completo" />
                        </label>
                        <CampoDoc id="cl-conjuge_cpf" rotulo={c.estado_civil === "casado" ? "CPF do cônjuge" : "CPF do(a) companheiro(a)"} tipo="PF"
                          valor={c.conjuge_cpf} onChange={(v) => campo("conjuge_cpf", v)} />
                      </>
                    )}
                  </div>
                </div>
              )}

              {pj && (
                <div className="cl-sec">
                  <h4>Representante legal<Dica>quem assina pela empresa nos requerimentos e nas cartas</Dica></h4>
                  <div className="grade" data-grade>
                    <label><Rotulo>Nome do representante</Rotulo>
                      <input id="cl-representante_nome" className="cl-maiusculo" value={c.representante_nome ?? ""} onChange={(e) => campo("representante_nome", e.target.value.toUpperCase() || null)} placeholder="Nome completo" />
                    </label>
                    <CampoDoc id="cl-representante_cpf" rotulo="CPF do representante" tipo="PF" valor={c.representante_cpf} onChange={(v) => campo("representante_cpf", v)} />
                  </div>
                </div>
              )}

              <div className="cl-sec">
                <h4>Contato</h4>
                <div className="grade" data-grade>
                  <label><Rotulo>Telefone / WhatsApp</Rotulo>
                    <input id="cl-telefone" inputMode="tel" value={c.telefone ?? ""} onChange={(e) => campo("telefone", formatarTelefone(e.target.value) || null)} placeholder="(00) 00000-0000" />
                  </label>
                  <label><Rotulo>Segundo telefone</Rotulo>
                    <input id="cl-telefone2" inputMode="tel" value={c.telefone2 ?? ""} onChange={(e) => campo("telefone2", formatarTelefone(e.target.value) || null)} placeholder="(00) 0000-0000" />
                  </label>
                  <label><Rotulo>E-mail</Rotulo>
                    <input id="cl-email" type="email" className={c.email && !emailValido(c.email) ? "cl-invalido" : ""} value={c.email ?? ""} onChange={txt("email")} placeholder="nome@exemplo.com" />
                    {c.email && !emailValido(c.email) && <span className="cl-erro-campo">e-mail incompleto</span>}
                  </label>
                </div>
              </div>

              <div className="cl-sec">
                <h4>{pj ? "Sede" : "Endereço"}</h4>
                <div className="grade" data-grade>
                  <label className="largo"><Rotulo dica="rua, número, bairro ou a fazenda e a zona rural — sem a cidade, que vem do campo abaixo">{pj ? "Endereço da sede" : "Endereço"}</Rotulo>
                    <input id="cl-endereco" value={c.endereco ?? ""} onChange={txt("endereco")} placeholder={pj ? "Rua, número, bairro" : "Rua, número, bairro — ou fazenda, zona rural"} />
                  </label>
                  <label><Rotulo>Cidade</Rotulo>
                    <input id="cl-cidade" value={c.cidade ?? ""} onChange={(e) => campo("cidade", e.target.value.toUpperCase() || null)} placeholder="Ex.: IRECÊ" />
                  </label>
                  <label><Rotulo>UF</Rotulo>
                    <select id="cl-uf" value={c.uf ?? ""} onChange={txt("uf")}>
                      <option value="">—</option>
                      {UFS.map((u) => <option key={u}>{u}</option>)}
                    </select>
                  </label>
                  <label><Rotulo>CEP</Rotulo>
                    <input id="cl-cep" className="mono" inputMode="numeric" value={c.cep ?? ""} onChange={(e) => campo("cep", formatarCep(e.target.value) || null)} placeholder="00000-000" />
                  </label>
                </div>
              </div>

              {(!pj || c.is_espolio) && (
                <div className="secoes cl-sec-espolio">
                  <Secao titulo="Espólio e inventariante"
                    selo={<span className={`secao-selo ${c.is_espolio ? "completa" : ""}`}>{c.is_espolio ? "é espólio" : "não"}</span>}
                    abrirEm={!!c.is_espolio}
                    dica="preenche automaticamente todo serviço criado para este cliente">
                    <label className="linha-check">
                      <input id="cl-is_espolio" type="checkbox" checked={!!c.is_espolio} onChange={(e) => campo("is_espolio", e.target.checked)} />
                      É espólio (possuidor/proprietário falecido com inventariante)
                    </label>
                    {c.is_espolio && (
                      <div className="grade" data-grade>
                        <label><Rotulo>Nome do inventariante</Rotulo><input id="cl-inventariante_nome" className="cl-maiusculo" value={c.inventariante_nome ?? ""} onChange={(e) => campo("inventariante_nome", e.target.value.toUpperCase() || null)} placeholder="Nome completo do inventariante" /></label>
                        <CampoDoc id="cl-inventariante_cpf" rotulo="CPF do inventariante" tipo="PF" valor={c.inventariante_cpf} onChange={(v) => campo("inventariante_cpf", v)} />
                        <label><Rotulo>RG do inventariante</Rotulo><input id="cl-inventariante_rg" value={c.inventariante_rg ?? ""} onChange={txt("inventariante_rg")} placeholder="00.000.000-00" /></label>
                      </div>
                    )}
                  </Secao>
                </div>
              )}

              <div className="cl-sec">
                <h4>Outros</h4>
                <div className="grade" data-grade>
                  <div className="largo cl-origem">
                    <Rotulo dica="como o cliente chegou até a empresa">Origem do cliente</Rotulo>
                    <div className="cl-pilulas" role="radiogroup" aria-label="Origem do cliente">
                      {ORIGENS.map((o) => (
                        <button key={o.chave} type="button" role="radio" aria-checked={c.origem === o.chave}
                          className={c.origem === o.chave ? "ativo" : ""}
                          onClick={() => campo("origem", c.origem === o.chave ? null : o.chave)}>{o.rotulo}</button>
                      ))}
                    </div>
                  </div>
                  <label className="largo"><Rotulo dica="anotações internas — não saem nos documentos">Observações</Rotulo>
                    <textarea id="cl-observacoes" rows={3} value={c.observacoes ?? ""} onChange={txt("observacoes")} placeholder="Ex.: prefere contato à tarde; documentos com o filho" />
                  </label>
                </div>
              </div>
            </fieldset>

            <div className="rodape-bloco">
              {auto.estado === "erro" && <button className="principal" onClick={salvar}>Tentar salvar de novo</button>}
              <span className="esticar" />
              {temPermissao("clientes.excluir") && (
                <>
                  <BotaoPerigo titulo={`Excluir cliente "${c.nome}"`}
                    confirmacao={servicos.length > 0 ? `excluir e desvincular ${servicos.length} serviço(s)` : "excluir mesmo"}
                    onConfirmar={excluirCliente}>Excluir cliente</BotaoPerigo>
                  <Dica>
                    {servicos.length > 0
                      ? `excluir mantém os ${servicos.length} serviço(s), sem cliente vinculado`
                      : "este cliente não tem serviços"}
                  </Dica>
                </>
              )}
            </div>
          </section>

          <aside className="cl-previa">
            <header>
              <h3>Qualificação nos documentos<Dica>como o detentor sai no memorial, no requerimento e nas cartas; as lacunas aparecem marcadas</Dica></h3>
            </header>
            <p className="cl-previa-texto">
              {qualificacao(c).map((t, i) => t.falta ? <mark key={i}>{t.t}</mark> : <span key={i}>{t.t}</span>)}
            </p>
            <div className="cl-previa-pe">
              <span className={`cl-pct${comp.pct === 100 ? " ok" : comp.pct < 60 ? " baixo" : ""}`}>
                {comp.faltam.length ? `${comp.faltam.length} lacuna(s)` : "completa"}
              </span>
              <button type="button" className="cl-botao" onClick={copiarQualificacao}><Icone d={IC.copiar} size={16} />Copiar</button>
            </div>
          </aside>
        </div>
      )}

      {aba === "servicos" && (
        <section className="cl-aba">
          <div className="cl-aba-barra">
            <div className="cl-segmento" role="group" aria-label="Filtrar serviços">
              {([["andamento", "Em andamento", andamento.length], ["concluidos", "Concluídos", servicos.length - andamento.length], ["todos", "Todos", servicos.length]] as const).map(([k, r, n]) => (
                <button key={k} type="button" className={filtroServ === k ? "ativo" : ""} aria-pressed={filtroServ === k} onClick={() => setFiltroServ(k)}>
                  {r}<span className="cl-conta">{n}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="tabela-wrap">
            {servFiltrados.length === 0 ? (
              <EstadoVazio icone={ICONE.arquivo}
                titulo={servicos.length === 0 ? "Nenhum serviço ainda" : filtroServ === "andamento" ? "Nada em andamento" : "Nenhum serviço concluído"}
                texto={servicos.length === 0 ? (criar ? "Use “Novo serviço” no topo para começar o primeiro." : "Os serviços deste cliente aparecem aqui.") : undefined}
                acao={servicos.length > 0 ? <button type="button" onClick={() => setFiltroServ("todos")}>Ver todos</button> : undefined} />
            ) : (
              <table className="tabela-vertices dash-lista cl-tabela">
                <thead><tr><th>Modalidade</th><th>Imóvel</th><th className="col-sec">Município</th><th>Andamento</th><th className="col-sec">Criado em</th><th className="col-sec">Situação</th></tr></thead>
                <tbody>
                  {servFiltrados.map((s) => {
                    const p = prog(s);
                    const chave = chaveDoServico(s);
                    return (
                      <tr key={s.id} className="linha-servico" tabIndex={0} role="button" onClick={() => onAbrirServico(s)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrirServico(s); } }}>
                        <td><span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span></td>
                        <td><b>{s.denominacao ?? s.nome_arquivo_txt ?? "(sem denominação)"}</b></td>
                        <td className="sub col-sec">{s.municipio ? `${s.municipio}-${s.uf ?? ""}` : "—"}</td>
                        <td><span className="andamento"><Pontos p={p} /><span>{p.concluido ? "concluído" : `falta ${p.falta}`}</span></span></td>
                        <td className="sub col-sec">{dataCurta(s.created_at)}</td>
                        <td className="col-sec">{p.concluido ? <span className="chip ok-chip">concluído</span> : s.status === "gerado" ? <span className="chip cl-chip-and">em andamento</span> : <span className="chip P">rascunho</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {aba === "documentos" && (
        <section className="cl-aba">
          {comDocs.length === 0 ? (
            <div className="tabela-wrap">
              <EstadoVazio icone={ICONE.arquivo} titulo="Nenhum documento gerado"
                texto="Memorial, planilha, plantas e peças dos serviços deste cliente ficam guardados aqui, com todas as versões." />
            </div>
          ) : (
            <div className="cl-docs">
              {comDocs.map((s) => {
                const chave = chaveDoServico(s);
                return (
                  <section key={s.id} className="cl-cartao cl-doc-cartao">
                    <header className="cl-cartao-cab">
                      <h3>
                        <span className={`chip mod-${chave}`}>{rotuloCurto[chave]}</span>
                        {s.denominacao ?? s.id.slice(0, 8)}
                        {s.municipio && <small>{s.municipio}-{s.uf ?? ""}</small>}
                      </h3>
                      <button type="button" className="link" onClick={() => onAbrirServico(s)}>Abrir serviço</button>
                    </header>
                    <HistoricoDocs servicoId={s.id} compacto />
                  </section>
                );
              })}
              {semDocs.length > 0 && (
                <p className="cl-sem-docs">Ainda sem documentos: {semDocs.map((s) => s.denominacao ?? "(sem denominação)").join(", ")}</p>
              )}
            </div>
          )}
        </section>
      )}

      {aba === "historico" && (
        <section className="cl-aba">
          {historico === null ? <div className="tabela-wrap" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="linha-esqueleto" />)}</div>
            : historico.length === 0 ? (
              <div className="tabela-wrap">
                <EstadoVazio icone={IC.historico} titulo="Nada registrado ainda"
                  texto="Cada alteração no cadastro e cada passo dos serviços deste cliente — quem fez e quando — aparece aqui." />
              </div>
            ) : <LinhaDoTempoCliente itens={historico} />}
        </section>
      )}
    </div>
  );
}

/** CPF/CNPJ com máscara e o aviso de dígito errado (visível: é aviso, não explicação). */
function CampoDoc({ id, rotulo, tipo, valor, onChange }: {
  id: string; rotulo: string; tipo: "PF" | "PJ"; valor: string | null | undefined; onChange: (v: string | null) => void;
}) {
  const [digitando, setDigitando] = useState(false);
  const aviso = avisoDoc(valor, tipo, digitando);
  return (
    <label>
      <Rotulo>{rotulo}</Rotulo>
      <input id={id} className={`mono${aviso ? " cl-invalido" : ""}`} inputMode="numeric" value={valor ?? ""}
        onChange={(e) => onChange(formatarDoc(e.target.value, tipo) || null)}
        onFocus={() => setDigitando(true)} onBlur={() => setDigitando(false)}
        placeholder={tipo === "PJ" ? "00.000.000/0000-00" : "000.000.000-00"} aria-invalid={!!aviso} />
      {aviso && <span className="cl-erro-campo">{aviso}</span>}
    </label>
  );
}

/** "Novo serviço ▾": as modalidades liberadas pelo plano, numa lista suspensa. */
function MenuNovoServico({ onNovo }: { onNovo: (chave: ChaveServico) => void }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    addEventListener("mousedown", fora);
    addEventListener("keydown", esc);
    return () => { removeEventListener("mousedown", fora); removeEventListener("keydown", esc); };
  }, [aberto]);
  const lista = SERVICOS.filter((s) => servicoLiberado(s.chave));
  return (
    <div className="cl-menu" ref={ref}>
      <button type="button" className="principal cl-com-icone" aria-haspopup="menu" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <Icone d={IC.mais} size={16} traco={2.4} />Novo serviço<Icone d={IC.baixo} size={14} traco={2.4} />
      </button>
      {aberto && (
        <div className="cl-menu-lista" role="menu">
          {lista.map((s) => (
            <button key={s.chave} type="button" role="menuitem" onClick={() => { setAberto(false); onNovo(s.chave); }}>
              <span className="cl-menu-ic"><Icone d={s.icone} size={18} /></span>
              <span><b>{s.titulo}</b><small>{s.resumo}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
