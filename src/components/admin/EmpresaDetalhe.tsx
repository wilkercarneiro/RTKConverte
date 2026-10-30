// Uma empresa, por assunto:
//   Plano e créditos   — o que ela usa, quanto e por quanto (plano, mensalidade,
//                        créditos por mês e preço do extra de cada carteira, acesso)
//   Créditos extras    — o que ela compra além do plano (compras, pedidos, saldo)
//   Cobrança           — a assinatura no Asaas, a fatura em aberto e os pagamentos
//   Cadastro           — dados da empresa
//   Usuários, Uso, Histórico
import { useCallback, useEffect, useState } from "react";
import {
  acessosDaEmpresa, adicionarUsuario, atividadesDaEmpresa, atualizarEmpresa, creditosDaEmpresa, lerSenhaPadrao, mensagemDeAcesso,
  redefinirSenha, removerUsuario, usoModalidades, usuariosDaEmpresa,
} from "../../lib/admin";
import type { AcessoEmpresa, AtividadeEmpresa, CreditosEmpresa as DadosCreditos, Empresa, StatusEmpresa, UsuarioEmpresa } from "../../lib/admin";
import { rotuloAtividade } from "../../lib/equipe";
import { recursoDe } from "../../lib/recursos";
import {
  cnpjValido, emailValido, formatarCnpj, formatarTelefone, problemaDaSenha, telefoneValido,
} from "../../../supabase/functions/_shared/cnpj.ts";
import type { DadosAdmin } from "./PainelAdmin";
import { CreditosEmpresa } from "./CreditosEmpresa";
import { CobrancaEmpresa } from "./CobrancaEmpresa";
import { PlanoLimites } from "./PlanoLimites";
import { diaMes, fmtPreco } from "../../lib/creditos";
import { ROTULO_SITUACAO } from "../../lib/cobranca";
import { confirmar, Dica, Rotulo } from "../ui";
import {
  Carregando, ICO, Kpi, PlanoTag, StatusPill, Topo, copiar, duracao, fmtCnpj, fmtData, fmtNum, fmtTel, haQuanto, iniciais, quando,
} from "./comum";

type Aba = "plano" | "creditos" | "cobranca" | "cadastro" | "usuarios" | "uso" | "historico";

export function EmpresaDetalhe({ id, d }: { id: string; d: DadosAdmin }) {
  const e = d.empresas.find((x) => x.id === id);
  const [aba, setAba] = useState<Aba>("plano");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  // créditos do mês: o topo, "Plano e limites" e "Créditos extras" leem daqui (null = carregando ou banco sem a 0027)
  const [cred, setCred] = useState<DadosCreditos | null>(null);
  const recarregarCred = useCallback(async () => { if (id) setCred(await creditosDaEmpresa(id).catch(() => null)); }, [id]);
  useEffect(() => { recarregarCred(); }, [recarregarCred]);

  if (!e) {
    return (
      <>
        <Topo olho="Clientes" titulo="Empresa não encontrada" />
        <button onClick={() => d.ir({ t: "admin", aba: "empresas" })}>Voltar para as empresas</button>
      </>
    );
  }

  async function mudarStatus(status: StatusEmpresa) {
    const pergunta = status === "ativo"
      ? `Reativar ${e!.nome}? A equipe volta a acessar tudo.`
      : `${status === "suspenso" ? "Suspender" : "Cancelar"} ${e!.nome}? A equipe perde o acesso aos dados até ser reativada (nada é apagado).`;
    if (!(await confirmar({ titulo: status === "ativo" ? "Reativar a empresa?" : status === "suspenso" ? "Suspender o acesso?" : "Cancelar a empresa?",
      texto: pergunta, confirmar: status === "ativo" ? "Reativar" : "Suspender", perigo: status !== "ativo" }))) return;
    try {
      await atualizarEmpresa(e!.id, { status });
      await d.recarregar();
      setAviso({ tipo: "ok", texto: status === "ativo" ? "Empresa reativada." : "Acesso bloqueado. Os dados continuam guardados." });
    } catch (err) { setAviso({ tipo: "erro", texto: String(err instanceof Error ? err.message : err) }); }
  }

  // pedidos sem o Asaas pedem aprovação; compras pelo Asaas só esperam o pagamento
  const pendentes = cred?.extras.filter((x) => x.status === "pendente" && x.origem !== "compra").length ?? 0;
  const extras = cred ? cred.carteiras.reduce((s, k) => s + k.extra, 0) : 0;
  const ajustes = e.excecoes + (cred
    ? Object.keys(cred.empresa.por_mes).length + Object.keys(cred.empresa.precos).length + (cred.empresa.mensalidade !== null ? 1 : 0)
    : 0);
  const comMes = cred?.carteiras.filter((k) => k.por_mes !== 0) ?? [];

  return (
    <>
      <Topo olho="Empresa" titulo={e.nome} sub={`${fmtCnpj(e.cnpj)} · cadastrada em ${fmtData(e.created_at)}`}>
        <button onClick={() => d.ir({ t: "admin", aba: "empresas" })}>← Empresas</button>
        {e.status === "ativo"
          ? <button onClick={() => mudarStatus("suspenso")}>Suspender acesso</button>
          : e.status === "aguardando_pagamento"
            ? <button className="principal" onClick={() => setAba("cobranca")}>Ver a cobrança</button>
            : <button className="principal" onClick={() => mudarStatus("ativo")}>Reativar</button>}
      </Topo>

      {aviso && <div className={`sa-aviso ${aviso.tipo}`}>{aviso.texto}</div>}

      <section className="sa-card">
        <div className="sa-cabeca-empresa">
          <span className="av">{iniciais(e.nome)}</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusPill status={e.status} /><PlanoTag planoId={e.plano_id} planos={d.planos} />
              {ajustes > 0 && (
                <button type="button" className="sa-pill neutro sa-pill-botao" onClick={() => setAba("plano")}
                  title="Acessos, créditos, preços ou mensalidade que valem só para esta empresa, diferentes do plano">
                  {ajustes} ajuste(s) só desta empresa
                </button>
              )}
            </div>
            <div className="sub" style={{ marginTop: 6 }}>{e.responsavel ?? "—"} · {fmtTel(e.telefone)} · {e.email ?? "—"}</div>
          </div>
        </div>
      </section>

      <div className="sa-kpis" style={{ marginTop: 18 }}>
        <Kpi rotulo="Créditos do mês restantes" icone={ICO.servicos} tom="escuro"
          valor={!cred ? "—" : comMes.length === 0 ? "0" : comMes.some((k) => k.por_mes === null) ? "∞"
            : fmtNum(comMes.reduce((s, k) => s + Math.max(0, (k.por_mes ?? 0) - k.usado), 0))}
          detalhe={!cred ? "" : `${comMes.map((k) => `${k.nome.replace(/^Créditos\s*(de\s+)?/i, "")} ${k.por_mes === null ? "∞" : `${Math.max(0, k.por_mes - k.usado)}/${k.por_mes}`}`).join(" · ")} · renovam em ${diaMes(cred.periodo.renova_em)}`}
          onClick={() => setAba("plano")} />
        <Kpi rotulo="Créditos extras" valor={fmtNum(extras)} icone={ICO.planos} detalhe={pendentes ? `${pendentes} pedido(s) para aprovar` : "usados depois dos do mês"}
          tom={pendentes ? "alerta" : undefined} onClick={() => setAba("creditos")} />
        <Kpi rotulo="Mensalidade" icone={ICO.contatos} tom={e.cobranca === "atrasada" || e.status === "aguardando_pagamento" ? "alerta" : undefined}
          valor={e.mensalidade == null ? "—" : fmtPreco(Number(e.mensalidade))}
          detalhe={e.status === "aguardando_pagamento" ? "esperando a 1ª mensalidade" : e.cobranca ? ROTULO_SITUACAO[e.cobranca] : "sem cobrança no Asaas"}
          onClick={() => setAba("cobranca")} />
        <Kpi rotulo="Usuários" valor={fmtNum(e.usuarios)} icone={ICO.usuarios} detalhe={`último acesso: ${quando(e.ultimo_acesso)}`} onClick={() => setAba("usuarios")} />
      </div>

      <nav className="sa-abas" aria-label="Seções da empresa">
        {([["plano", "Plano e créditos"], ["creditos", "Créditos extras"], ["cobranca", "Cobrança"], ["cadastro", "Cadastro"], ["usuarios", "Usuários"], ["uso", "Uso"], ["historico", "Histórico"]] as [Aba, string][]).map(([a, r]) => (
          <button key={a} type="button" className={aba === a ? "ativo" : ""} onClick={() => setAba(a)}>
            {r}{a === "creditos" && pendentes > 0 && <span className="sa-badge" style={{ marginLeft: 6 }}>{pendentes}</span>}
            {a === "cobranca" && (e.cobranca === "atrasada" || e.status === "aguardando_pagamento") && <span className="sa-badge" style={{ marginLeft: 6 }}>!</span>}
          </button>
        ))}
      </nav>

      {aba === "plano" && <PlanoLimites e={e} d={d} cred={cred}
        onSalvo={async (t) => { await Promise.all([d.recarregar(), recarregarCred()]); setAviso({ tipo: "ok", texto: t }); }} />}
      {aba === "creditos" && <CreditosEmpresa e={e} d={d} c={cred} onMudou={recarregarCred} />}
      {aba === "cobranca" && <CobrancaEmpresa e={e} d={d} onMudou={async (t) => { await recarregarCred(); setAviso({ tipo: "ok", texto: t }); }} />}
      {aba === "cadastro" && <Cadastro e={e} d={d} cred={cred} irPlano={() => setAba("plano")} onSalvo={(t) => setAviso({ tipo: "ok", texto: t })} />}
      {aba === "usuarios" && <Usuarios e={e} d={d} />}
      {aba === "uso" && <Uso e={e} />}
      {aba === "historico" && <Historico e={e} />}
    </>
  );
}

function Cadastro({ e, d, cred, irPlano, onSalvo }: { e: Empresa; d: DadosAdmin; cred: DadosCreditos | null; irPlano: () => void; onSalvo: (t: string) => void }) {
  const [f, setF] = useState({
    nome: e.nome, cnpj: formatarCnpj(e.cnpj ?? ""), responsavel: e.responsavel ?? "", telefone: formatarTelefone(e.telefone ?? ""),
    email: e.email ?? "", observacoes: e.observacoes ?? "",
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(null);
    if (f.cnpj && !cnpjValido(f.cnpj)) { setErro("CNPJ inválido."); return; }
    if (f.telefone && !telefoneValido(f.telefone)) { setErro("Telefone inválido."); return; }
    if (f.email && !emailValido(f.email)) { setErro("E-mail inválido."); return; }
    setSalvando(true);
    try {
      await atualizarEmpresa(e.id, f);
      await d.recarregar();
      onSalvo("Cadastro salvo.");
    } catch (err) { setErro(String(err instanceof Error ? err.message : err)); }
    finally { setSalvando(false); }
  }

  const plano = d.planos.find((p) => p.id === e.plano_id);
  const creditos = cred?.carteiras.filter((k) => k.por_mes !== 0)
    .map((k) => `${k.por_mes === null ? "sem limite de" : k.por_mes} ${k.nome.toLowerCase()}${cred.empresa.por_mes[k.chave] !== undefined ? " (só desta empresa)" : ""}`)
    .join(" · ");

  return (
    <form className="sa-card" onSubmit={salvar}>
      <div className="sa-resumo-plano">
        <span>Plano <b>{plano?.nome ?? "sem plano"}</b>
          {e.mensalidade != null && <> · <b>{fmtPreco(Number(e.mensalidade))}</b>/mês</>}
          {" · "}{creditos === undefined ? "créditos —" : creditos || "sem créditos no mês"}</span>
        <button type="button" className="link" onClick={irPlano}>Alterar em Plano e créditos</button>
      </div>
      <div className="sa-campos">
        <label>Nome da empresa<input value={f.nome} onChange={(x) => setF({ ...f, nome: x.target.value })} required /></label>
        <label>CNPJ<input className="mono" value={f.cnpj} onChange={(x) => setF({ ...f, cnpj: formatarCnpj(x.target.value) })} /></label>
        <label>Responsável<input value={f.responsavel} onChange={(x) => setF({ ...f, responsavel: x.target.value })} /></label>
        <label>Telefone / WhatsApp<input value={f.telefone} onChange={(x) => setF({ ...f, telefone: formatarTelefone(x.target.value) })} /></label>
        <label className="largo"><Rotulo dica="só contato; o login de cada pessoa fica em Usuários">E-mail da empresa</Rotulo><input type="email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} /></label>
        <label className="largo">Observações internas
          <textarea value={f.observacoes} onChange={(x) => setF({ ...f, observacoes: x.target.value })} placeholder="Condições combinadas na reunião, contatos, próximos passos…" />
        </label>
      </div>
      <div className="sa-rodape-form">
        {erro && <span className="erro" style={{ margin: 0 }}>{erro}</span>}
        <button type="submit" className="principal" disabled={salvando}>{salvando ? "Salvando…" : "Salvar cadastro"}</button>
      </div>
    </form>
  );
}

function Usuarios({ e, d }: { e: Empresa; d: DadosAdmin }) {
  const [lista, setLista] = useState<UsuarioEmpresa[] | null>(null);
  const [email, setEmail] = useState("");
  const [papel, setPapel] = useState<"membro" | "dono">("membro");
  const [senhaPadrao, setSenhaPadrao] = useState("");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string; copiar?: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(() => usuariosDaEmpresa(e.id).then(setLista).catch((x) => setMsg({ tipo: "erro", texto: String(x.message ?? x) })), [e.id]);
  useEffect(() => { carregar(); lerSenhaPadrao().then(setSenhaPadrao).catch(() => {}); }, [carregar]);

  const textoAcesso = (login: string) => mensagemDeAcesso({
    responsavel: e.responsavel ?? "", empresa: e.nome, login, senha: senhaPadrao, url: `${location.origin}/app/`,
  });

  async function adicionar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!emailValido(email)) { setMsg({ tipo: "erro", texto: "E-mail inválido." }); return; }
    const p = problemaDaSenha(senhaPadrao);
    if (p) { setMsg({ tipo: "erro", texto: `Senha padrão inválida (${p}). Ajuste em Configurações.` }); return; }
    setOcupado(true); setMsg(null);
    try {
      const r = await adicionarUsuario(e.id, email, senhaPadrao, papel);
      setMsg({ tipo: "ok", texto: `${r.login} criado com a senha padrão.`, copiar: textoAcesso(r.login) });
      setEmail("");
      await Promise.all([carregar(), d.recarregar()]);
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
    finally { setOcupado(false); }
  }

  async function resetar(u: UsuarioEmpresa) {
    if (!(await confirmar({ titulo: "Redefinir a senha?", texto: `A senha de ${u.email} volta a ser a senha padrão, e a pessoa cria uma nova no próximo acesso.`, confirmar: "Redefinir" }))) return;
    try {
      await redefinirSenha(u.user_id, senhaPadrao);
      setMsg({ tipo: "ok", texto: `Senha de ${u.email} redefinida para a padrão.`, copiar: textoAcesso(u.email) });
      await carregar();
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  async function remover(u: UsuarioEmpresa) {
    if (!(await confirmar({ titulo: "Apagar a conta?", texto: `A conta ${u.email} deixa de existir. Os serviços da empresa continuam.`, confirmar: "Apagar", perigo: true }))) return;
    try {
      await removerUsuario(u.user_id);
      setMsg({ tipo: "ok", texto: `${u.email} removido.` });
      await Promise.all([carregar(), d.recarregar()]);
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  return (
    <section className="sa-card">
      <header><h3>Usuários<Dica>contas novas entram com a senha padrão e trocam no 1º acesso</Dica></h3></header>
      {msg && (
        <div className={`sa-aviso ${msg.tipo}`} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>{msg.texto}</span>
          {msg.copiar && <button type="button" onClick={() => copiar(msg.copiar!)}>Copiar mensagem de acesso</button>}
        </div>
      )}
      {!lista ? <Carregando /> : (
        <div className="sa-tabela-wrap">
          <table className="sa-tabela">
            <thead><tr><th>Pessoa</th><th>Papel</th><th>Permissões</th><th>Último acesso</th><th>Senha</th><th /></tr></thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.user_id}>
                  <td><b>{u.nome || u.email}</b>{u.nome && <div className="sub" style={{ fontSize: 12 }}>{u.email}</div>}
                    {u.ativo === false && <span className="sa-pill cancelado" style={{ marginTop: 4 }}>Desativado</span>}</td>
                  <td>{u.papel === "dono" ? "Dono" : "Equipe"}<div className="sub" style={{ fontSize: 12 }}>desde {fmtData(u.desde)}</div></td>
                  <td>{u.papel === "dono" ? "todas" : u.permissoes ? `${u.permissoes.length} de 8` : "—"}</td>
                  <td>{quando(u.ultimo_acesso)}</td>
                  <td>{u.senha_provisoria ? <span className="sa-pill suspenso">Provisória</span> : <span className="sa-pill ativo">Própria</span>}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" onClick={() => resetar(u)}>Redefinir senha</button>{" "}
                    <button type="button" className="fantasma" onClick={() => remover(u)}>Remover</button>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && <tr><td colSpan={6} className="sa-vazio">Nenhum usuário nesta empresa.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={adicionar} className="sa-campos" style={{ marginTop: 18, alignItems: "end", gridTemplateColumns: "2fr 1fr auto" }}>
        <label>Adicionar usuário (e-mail de login)<input type="email" value={email} onChange={(x) => setEmail(x.target.value)} placeholder="operador@empresa.com.br" /></label>
        <label>Papel
          <select value={papel} onChange={(x) => setPapel(x.target.value as "membro" | "dono")}>
            <option value="membro">Operador</option><option value="dono">Dono</option>
          </select>
        </label>
        <button type="submit" className="principal" disabled={ocupado || !email}>{ocupado ? "Criando…" : "Adicionar"}</button>
      </form>
    </section>
  );
}

function Uso({ e }: { e: Empresa }) {
  const [dias, setDias] = useState(30);
  const [uso, setUso] = useState<{ chave: string; total: number }[] | null>(null);
  useEffect(() => { setUso(null); usoModalidades(e.id, dias).then(setUso).catch(() => setUso([])); }, [e.id, dias]);
  const max = Math.max(1, ...(uso ?? []).map((u) => u.total));
  return (
    <>
      <section className="sa-card">
        <header>
          <h3>Serviços abertos por tipo<Dica>{fmtNum(e.servicos)} no total · último em {quando(e.ultimo_servico)}</Dica></h3>
          <div className="sa-segmento" style={{ marginLeft: "auto" }}>
            {[30, 90, 365].map((n) => <button key={n} type="button" className={dias === n ? "ativo" : ""} onClick={() => setDias(n)}>{n === 365 ? "12 meses" : `${n} dias`}</button>)}
          </div>
        </header>
        {!uso ? <Carregando /> : uso.length === 0 ? <div className="sa-vazio">Nenhum serviço no período.</div> : (
          <div className="sa-barras">
            {uso.map((u) => (
              <div className="sa-barra" key={u.chave}>
                <span>{recursoDe(u.chave)?.nome ?? u.chave}</span>
                <span className="trilho" title={`${u.total}`}><i style={{ width: `${(u.total / max) * 100}%` }} /></span>
                <b>{u.total}</b>
              </div>
            ))}
          </div>
        )}
      </section>
      <AcessosRecentes e={e} />
    </>
  );
}

/** Sessões de uso (0029). Banco sem a migração: a seção não aparece. */
function AcessosRecentes({ e }: { e: Empresa }) {
  const [itens, setItens] = useState<AcessoEmpresa[] | null | undefined>(undefined);
  useEffect(() => { acessosDaEmpresa(e.id).then(setItens).catch(() => setItens(null)); }, [e.id]);
  if (itens === null) return null;
  const pessoas = new Set((itens ?? []).map((a) => a.user_id)).size;
  const dataHora = (s: string) => new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <section className="sa-card" style={{ marginTop: 18 }}>
      <header>
        <h3>Acessos recentes<Dica>cada linha é uma sessão: começa ao entrar e fecha depois de 30 min sem atividade</Dica></h3>
        {itens && itens.length > 0 && <span className="sub">{itens.length} sessão(ões) · {pessoas} pessoa(s)</span>}
      </header>
      {itens === undefined ? <Carregando /> : itens.length === 0 ? (
        <div className="sa-vazio">Nenhum acesso registrado ainda.</div>
      ) : (
        <div className="sa-tabela-wrap">
          <table className="sa-tabela sa-acessos">
            <thead><tr><th>Pessoa</th><th>Início</th><th>Último sinal</th><th>IP</th><th>Navegador · sistema</th><th>Dispositivo</th><th className="num">Telas</th></tr></thead>
            <tbody>
              {itens.map((a) => (
                <tr key={a.id}>
                  <td><b>{a.quem}</b>{a.ultima_tela && <div className="sub mono" style={{ fontSize: 11.5 }} title="última tela aberta">{a.ultima_tela}</div>}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{dataHora(a.em)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{haQuanto(a.ultimo_em) === "agora" ? "agora" : `há ${haQuanto(a.ultimo_em)}`}
                    <div className="sub" style={{ fontSize: 12 }}>{duracao(new Date(a.ultimo_em).getTime() - new Date(a.em).getTime())} de uso</div></td>
                  <td className="mono" style={{ fontSize: 12.5 }}>{a.ip ?? "—"}</td>
                  <td>{[a.navegador, a.sistema].filter(Boolean).join(" · ") || "—"}</td>
                  <td style={{ textTransform: "capitalize" }}>{a.dispositivo ?? "—"}</td>
                  <td className="num">{a.telas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Historico({ e }: { e: Empresa }) {
  const [itens, setItens] = useState<AtividadeEmpresa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { atividadesDaEmpresa(e.id).then(setItens).catch((x) => setErro(String(x.message ?? x))); }, [e.id]);
  return (
    <section className="sa-card">
      <header><h3>Histórico da empresa<Dica>serviços, documentos, clientes e equipe (últimos 200)</Dica></h3></header>
      {erro ? <div className="sa-aviso erro">{erro}</div> : !itens ? <Carregando /> : itens.length === 0 ? (
        <div className="sa-vazio">Nada registrado ainda. O histórico conta a partir da ativação da equipe.</div>
      ) : (
        <div className="sa-tabela-wrap">
          <table className="sa-tabela">
            <thead><tr><th>Quando</th><th>Quem</th><th>O quê</th></tr></thead>
            <tbody>
              {itens.map((a) => (
                <tr key={a.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{new Date(a.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                  <td>{a.quem}</td>
                  <td>{rotuloAtividade(a.acao)} <b>{a.alvo}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
