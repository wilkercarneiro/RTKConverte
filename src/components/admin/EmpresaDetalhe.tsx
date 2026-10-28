// Uma empresa: dados do cadastro, plano e situação, recursos (com exceções),
// usuários (adicionar, redefinir senha, remover) e o uso do sistema.
import { useCallback, useEffect, useState } from "react";
import {
  adicionarUsuario, atualizarEmpresa, definirRecursoEmpresa, lerSenhaPadrao, mensagemDeAcesso,
  recursosDaEmpresa, redefinirSenha, removerUsuario, usoModalidades, usuariosDaEmpresa,
} from "../../lib/admin";
import type { Empresa, RecursoEmpresa, StatusEmpresa, UsuarioEmpresa } from "../../lib/admin";
import { recursoDe } from "../../lib/recursos";
import {
  cnpjValido, emailValido, formatarCnpj, formatarTelefone, problemaDaSenha, telefoneValido,
} from "../../../supabase/functions/_shared/cnpj.ts";
import type { DadosAdmin } from "./PainelAdmin";
import {
  Carregando, ICO, Kpi, PlanoTag, StatusPill, Topo, copiar, fmtCnpj, fmtData, fmtNum, fmtTel, iniciais, quando,
} from "./comum";

type Aba = "geral" | "recursos" | "usuarios" | "uso";

export function EmpresaDetalhe({ id, d }: { id: string; d: DadosAdmin }) {
  const e = d.empresas.find((x) => x.id === id);
  const [aba, setAba] = useState<Aba>("geral");
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

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
    if (!confirm(pergunta)) return;
    try {
      await atualizarEmpresa(e!.id, { status });
      await d.recarregar();
      setAviso({ tipo: "ok", texto: status === "ativo" ? "Empresa reativada." : "Acesso bloqueado. Os dados continuam guardados." });
    } catch (err) { setAviso({ tipo: "erro", texto: String(err instanceof Error ? err.message : err) }); }
  }

  return (
    <>
      <Topo olho="Empresa" titulo={e.nome} sub={`${fmtCnpj(e.cnpj)} · cadastrada em ${fmtData(e.created_at)}`}>
        <button onClick={() => d.ir({ t: "admin", aba: "empresas" })}>← Empresas</button>
        {e.status === "ativo"
          ? <button onClick={() => mudarStatus("suspenso")}>Suspender acesso</button>
          : <button className="principal" onClick={() => mudarStatus("ativo")}>Reativar</button>}
      </Topo>

      {aviso && <div className={`sa-aviso ${aviso.tipo}`}>{aviso.texto}</div>}

      <section className="sa-card">
        <div className="sa-cabeca-empresa">
          <span className="av">{iniciais(e.nome)}</span>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <StatusPill status={e.status} /><PlanoTag planoId={e.plano_id} planos={d.planos} />
              {e.excecoes > 0 && <span className="sa-pill neutro">{e.excecoes} exceção(ões) ao plano</span>}
            </div>
            <div className="sub" style={{ marginTop: 6 }}>{e.responsavel ?? "—"} · {fmtTel(e.telefone)} · {e.email ?? "—"}</div>
          </div>
        </div>
      </section>

      <div className="sa-kpis" style={{ marginTop: 18 }}>
        <Kpi rotulo="Usuários" valor={fmtNum(e.usuarios)} icone={ICO.usuarios} tom="escuro" />
        <Kpi rotulo="Serviços (30 dias)" valor={fmtNum(e.servicos_30d)} icone={ICO.servicos} detalhe={`${fmtNum(e.servicos)} no total`} />
        <Kpi rotulo="Último serviço" valor={quando(e.ultimo_servico)} icone={ICO.planos} />
        <Kpi rotulo="Último acesso" valor={quando(e.ultimo_acesso)} icone={ICO.visao} />
      </div>

      <nav className="sa-abas" aria-label="Seções da empresa">
        {([["geral", "Cadastro e plano"], ["recursos", "Recursos"], ["usuarios", "Usuários"], ["uso", "Uso"]] as [Aba, string][]).map(([a, r]) => (
          <button key={a} type="button" className={aba === a ? "ativo" : ""} onClick={() => setAba(a)}>{r}</button>
        ))}
      </nav>

      {aba === "geral" && <Geral e={e} d={d} onSalvo={(t) => setAviso({ tipo: "ok", texto: t })} />}
      {aba === "recursos" && <RecursosEmpresa e={e} d={d} />}
      {aba === "usuarios" && <Usuarios e={e} d={d} />}
      {aba === "uso" && <Uso e={e} />}
    </>
  );
}

function Geral({ e, d, onSalvo }: { e: Empresa; d: DadosAdmin; onSalvo: (t: string) => void }) {
  const [f, setF] = useState({
    nome: e.nome, cnpj: formatarCnpj(e.cnpj ?? ""), responsavel: e.responsavel ?? "", telefone: formatarTelefone(e.telefone ?? ""),
    email: e.email ?? "", plano_id: e.plano_id ?? "", observacoes: e.observacoes ?? "",
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
      await atualizarEmpresa(e.id, { ...f, plano_id: f.plano_id || null });
      await d.recarregar();
      onSalvo("Cadastro salvo.");
    } catch (err) { setErro(String(err instanceof Error ? err.message : err)); }
    finally { setSalvando(false); }
  }

  return (
    <form className="sa-card" onSubmit={salvar}>
      <div className="sa-campos">
        <label>Nome da empresa<input value={f.nome} onChange={(x) => setF({ ...f, nome: x.target.value })} required /></label>
        <label>CNPJ<input className="mono" value={f.cnpj} onChange={(x) => setF({ ...f, cnpj: formatarCnpj(x.target.value) })} /></label>
        <label>Responsável<input value={f.responsavel} onChange={(x) => setF({ ...f, responsavel: x.target.value })} /></label>
        <label>Telefone / WhatsApp<input value={f.telefone} onChange={(x) => setF({ ...f, telefone: formatarTelefone(x.target.value) })} /></label>
        <label>E-mail da empresa<input type="email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} />
          <small className="sub" style={{ fontWeight: 400 }}>contato; o login de cada pessoa fica em Usuários</small></label>
        <label>Plano
          <select value={f.plano_id} onChange={(x) => setF({ ...f, plano_id: x.target.value })}>
            {d.planos.map((p) => <option key={p.id} value={p.id}>{p.nome}{p.ativo ? "" : " (inativo)"}</option>)}
            <option value="">Sem plano</option>
          </select>
        </label>
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

function RecursosEmpresa({ e, d }: { e: Empresa; d: DadosAdmin }) {
  const [linhas, setLinhas] = useState<RecursoEmpresa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => recursosDaEmpresa(e.id).then(setLinhas).catch((x) => setErro(String(x.message ?? x))), [e.id]);
  useEffect(() => { carregar(); }, [carregar]);

  async function definir(chave: string, valor: boolean | null) {
    setErro(null);
    try {
      await definirRecursoEmpresa(e.id, chave, valor);
      await Promise.all([carregar(), d.recarregar()]);
    } catch (x) { setErro(String(x instanceof Error ? x.message : x)); }
  }

  if (!linhas) return <Carregando />;
  const porChave = new Map(d.recursos.map((r) => [r.chave, r]));
  const grupos = new Map<string, RecursoEmpresa[]>();
  for (const l of linhas) {
    const g = porChave.get(l.chave)?.grupo ?? "Geral";
    grupos.set(g, [...(grupos.get(g) ?? []), l]);
  }
  const plano = d.planos.find((p) => p.id === e.plano_id);

  return (
    <section className="sa-card">
      <header><h3>O que esta empresa acessa</h3><span className="sub">“Plano” segue {plano ? `o ${plano.nome}` : "o padrão de cada recurso"}; liberar ou bloquear cria uma exceção só para ela.</span></header>
      {erro && <div className="sa-aviso erro">{erro}</div>}
      {[...grupos].map(([g, itens]) => (
        <div className="sa-grupo-rec" key={g}>
          <h4>{g}</h4>
          {itens.map((l) => {
            const r = porChave.get(l.chave);
            const nome = r?.nome ?? recursoDe(l.chave)?.nome ?? l.chave;
            return (
              <div className="sa-rec" key={l.chave}>
                <div className="tx">
                  <b>{nome}</b> <span className={l.liberado ? "sa-pill ativo" : "sa-pill cancelado"} style={{ marginLeft: 6 }}>{l.liberado ? "Liberado" : "Bloqueado"}</span>
                  {r?.descricao && <p>{r.descricao}</p>}
                </div>
                <span className="origem">{l.origem === "excecao" ? "exceção" : l.origem === "plano" ? "pelo plano" : "padrão"}</span>
                <div className="sa-tri" role="group" aria-label={`Acesso a ${nome}`}>
                  <button type="button" className={l.excecao === null ? "on" : ""} onClick={() => definir(l.chave, null)}>Plano</button>
                  <button type="button" className={l.excecao === true ? "on lib" : ""} onClick={() => definir(l.chave, true)}>Liberar</button>
                  <button type="button" className={l.excecao === false ? "on blo" : ""} onClick={() => definir(l.chave, false)}>Bloquear</button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </section>
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
    if (!confirm(`Voltar a senha de ${u.email} para a senha padrão? A pessoa terá de criar uma nova no próximo acesso.`)) return;
    try {
      await redefinirSenha(u.user_id, senhaPadrao);
      setMsg({ tipo: "ok", texto: `Senha de ${u.email} redefinida para a padrão.`, copiar: textoAcesso(u.email) });
      await carregar();
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  async function remover(u: UsuarioEmpresa) {
    if (!confirm(`Apagar a conta ${u.email}? Ela deixa de existir (os serviços da empresa continuam).`)) return;
    try {
      await removerUsuario(u.user_id);
      setMsg({ tipo: "ok", texto: `${u.email} removido.` });
      await Promise.all([carregar(), d.recarregar()]);
    } catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  return (
    <section className="sa-card">
      <header><h3>Usuários</h3><span className="sub">contas novas entram com a senha padrão e trocam no 1º acesso</span></header>
      {msg && (
        <div className={`sa-aviso ${msg.tipo}`} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ flex: 1 }}>{msg.texto}</span>
          {msg.copiar && <button type="button" onClick={() => copiar(msg.copiar!)}>Copiar mensagem de acesso</button>}
        </div>
      )}
      {!lista ? <Carregando /> : (
        <div className="sa-tabela-wrap">
          <table className="sa-tabela">
            <thead><tr><th>Login</th><th>Papel</th><th>Desde</th><th>Último acesso</th><th>Senha</th><th /></tr></thead>
            <tbody>
              {lista.map((u) => (
                <tr key={u.user_id}>
                  <td><b>{u.email}</b></td>
                  <td>{u.papel === "dono" ? "Dono" : "Operador"}</td>
                  <td>{fmtData(u.desde)}</td>
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
    <section className="sa-card">
      <header>
        <h3>Serviços criados por tipo</h3>
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
  );
}
