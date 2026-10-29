// Empresas clientes: busca, filtro por status e cadastro de empresa nova.
import { useEffect, useMemo, useState } from "react";
import { criarEmpresa, lerSenhaPadrao, mensagemDeAcesso } from "../../lib/admin";
import { CampoCreditosMes, gravarCreditosMes } from "./CreditosEmpresa";
import type { CreditosMes } from "./CreditosEmpresa";
import type { StatusEmpresa } from "../../lib/admin";
import {
  cnpjValido, emailValido, formatarCnpj, formatarTelefone, problemaDaSenha, soDigitos, telefoneValido,
} from "../../../supabase/functions/_shared/cnpj.ts";
import type { DadosAdmin } from "./PainelAdmin";
import { Rotulo } from "../ui";
import {
  ICO, Ico, PlanoTag, StatusPill, Topo, copiar, fmtCnpj, fmtNum, quando, semUso,
} from "./comum";

type Filtro = "todas" | StatusEmpresa | "sem-uso";

export function Empresas({ d }: { d: DadosAdmin }) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [plano, setPlano] = useState<string>("");
  const [nova, setNova] = useState(false);

  const contagem = useMemo(() => ({
    todas: d.empresas.length,
    ativo: d.empresas.filter((e) => e.status === "ativo").length,
    suspenso: d.empresas.filter((e) => e.status === "suspenso").length,
    cancelado: d.empresas.filter((e) => e.status === "cancelado").length,
    "sem-uso": d.empresas.filter(semUso).length,
  }), [d.empresas]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const qd = soDigitos(q);
    return d.empresas.filter((e) => {
      if (filtro === "sem-uso" ? !semUso(e) : filtro !== "todas" && e.status !== filtro) return false;
      if (plano && (plano === "-" ? e.plano_id : e.plano_id !== plano)) return false;
      if (!q) return true;
      return [e.nome, e.responsavel, e.email].some((x) => x?.toLowerCase().includes(q))
        || (qd.length >= 3 && [e.cnpj, e.telefone].some((x) => x?.includes(qd)));
    });
  }, [d.empresas, busca, filtro, plano]);

  const FILTROS: { f: Filtro; rot: string }[] = [
    { f: "todas", rot: "Todas" }, { f: "ativo", rot: "Ativas" }, { f: "sem-uso", rot: "Sem uso" },
    { f: "suspenso", rot: "Suspensas" }, { f: "cancelado", rot: "Canceladas" },
  ];

  return (
    <>
      <Topo olho="Clientes" titulo="Empresas" sub="Cada empresa é um escritório isolado, com a sua equipe, os seus dados e o seu plano.">
        <button className="principal" onClick={() => setNova(true)}><Ico d={ICO.mais} /> Nova empresa</button>
      </Topo>

      <div className="sa-filtros">
        <input type="search" placeholder="Buscar por nome, CNPJ, responsável, e-mail ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar empresa" />
        <div className="sa-segmento" role="group" aria-label="Filtrar por situação">
          {FILTROS.map((x) => (
            <button key={x.f} type="button" className={filtro === x.f ? "ativo" : ""} onClick={() => setFiltro(x.f)}>
              {x.rot}<span className="n">{contagem[x.f]}</span>
            </button>
          ))}
        </div>
        <select value={plano} onChange={(e) => setPlano(e.target.value)} aria-label="Filtrar por plano" style={{ height: 38 }}>
          <option value="">Todos os planos</option>
          {d.planos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          <option value="-">Sem plano</option>
        </select>
      </div>

      <section className="sa-card" style={{ padding: "14px 10px" }}>
        <div className="sa-tabela-wrap">
          <table className="sa-tabela">
            <thead>
              <tr>
                <th>Empresa</th><th>Responsável</th><th>Plano</th><th>Situação</th>
                <th className="num">Usuários</th><th className="num">Serviços (30 d)</th><th>Último acesso</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} className="clicavel" tabIndex={0}
                  onClick={() => d.ir({ t: "admin", aba: "empresas", id: e.id })}
                  onKeyDown={(k) => { if (k.key === "Enter") d.ir({ t: "admin", aba: "empresas", id: e.id }); }}>
                  <td className="empresa"><b>{e.nome}</b><span>{fmtCnpj(e.cnpj)}</span></td>
                  <td>{e.responsavel ?? "—"}<div className="sub" style={{ fontSize: 12 }}>{e.email ?? ""}</div></td>
                  <td><PlanoTag planoId={e.plano_id} planos={d.planos} />{e.excecoes > 0 && <div className="sub" style={{ fontSize: 12 }}>+{e.excecoes} exceção(ões)</div>}</td>
                  <td><StatusPill status={e.status} /></td>
                  <td className="num">{fmtNum(e.usuarios)}</td>
                  <td className="num">{fmtNum(e.servicos_30d)}<div className="sub" style={{ fontSize: 12 }}>{fmtNum(e.servicos)} no total</div></td>
                  <td>{quando(e.ultimo_acesso)}</td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr><td colSpan={7} className="sa-vazio">{d.empresas.length ? "Nenhuma empresa com esse filtro." : "Nenhuma empresa cadastrada ainda. Clique em “Nova empresa”."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {nova && <NovaEmpresa d={d} onFechar={() => setNova(false)} />}
    </>
  );
}

interface Criada { empresa: string; responsavel: string; login: string; senha: string; id: string }

function NovaEmpresa({ d, onFechar }: { d: DadosAdmin; onFechar: () => void }) {
  const planoPadrao = d.planos.find((p) => p.ativo)?.id ?? "";
  const [f, setF] = useState({ cnpj: "", nome: "", responsavel: "", telefone: "", email: "", senha: "", plano_id: planoPadrao });
  const [tocado, setTocado] = useState<Record<string, boolean>>({});
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criada, setCriada] = useState<Criada | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [creditos, setCreditos] = useState<CreditosMes>({ modo: "plano", limite: "" });

  useEffect(() => { lerSenhaPadrao().then((s) => setF((x) => (x.senha ? x : { ...x, senha: s }))).catch(() => {}); }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !enviando) onFechar(); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [enviando, onFechar]);

  const problemas: Record<string, string | null> = {
    cnpj: cnpjValido(f.cnpj) ? null : "CNPJ inválido (confira os dígitos).",
    nome: f.nome.trim().length >= 2 ? null : "Informe o nome da empresa.",
    responsavel: f.responsavel.trim().length >= 2 ? null : "Informe o nome do responsável.",
    telefone: telefoneValido(f.telefone) ? null : "Use DDD + número.",
    email: emailValido(f.email) ? null : "E-mail inválido.",
    senha: problemaDaSenha(f.senha),
  };
  const valido = Object.values(problemas).every((p) => !p);
  const campo = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const msg = (k: string) => tocado[k] && problemas[k] ? <span className="erro-campo">{problemas[k]}</span> : null;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setTocado({ cnpj: true, nome: true, responsavel: true, telefone: true, email: true, senha: true });
    if (!valido) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await criarEmpresa({ ...f, plano_id: f.plano_id || null });
      // o combinado com a empresa (a conta já existe: se falhar aqui, ajusta-se na página dela)
      try { await gravarCreditosMes(r.escritorio_id, creditos); }
      catch (err) { setErro(`Empresa criada, mas os créditos por mês não foram gravados: ${err instanceof Error ? err.message : err}. Ajuste na aba Créditos da empresa.`); }
      setCriada({ empresa: f.nome.trim(), responsavel: f.responsavel.trim(), login: r.login, senha: f.senha, id: r.escritorio_id });
      await d.recarregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  }

  const url = `${location.origin}/app/`;
  const texto = criada ? mensagemDeAcesso({ ...criada, url }) : "";

  return (
    <>
      <div className="sa-veu" onClick={() => !enviando && onFechar()} />
      <aside className="sa-gaveta" role="dialog" aria-modal="true" aria-label="Nova empresa">
        <header>
          <span className="sa-olho">{criada ? "Cadastro concluído" : "Clientes"}</span>
          <h2>{criada ? "Acesso criado" : "Nova empresa"}</h2>
        </header>
        {criada ? (
          <>
            <div className="corpo">
              {erro && <div className="sa-aviso erro">{erro}</div>}
              <p style={{ marginTop: 0 }}>A <b>{criada.empresa}</b> já pode entrar. Mande os dados abaixo ao responsável: no primeiro acesso o sistema pede uma senha nova.</p>
              <div className="sa-credenciais">
                <div className="linha"><span>Endereço</span><b>{url}</b></div>
                <div className="linha"><span>Login</span><b>{criada.login}</b></div>
                <div className="linha"><span>Senha provisória</span><b>{criada.senha}</b></div>
                <pre>{texto}</pre>
              </div>
            </div>
            <footer>
              <button type="button" onClick={async () => setCopiado(await copiar(texto))}>{copiado ? "Copiado ✓" : "Copiar mensagem"}</button>
              {f.telefone && (
                <button type="button" onClick={() => open(`https://wa.me/55${soDigitos(f.telefone)}?text=${encodeURIComponent(texto)}`, "_blank", "noopener")}>
                  Enviar no WhatsApp
                </button>
              )}
              <button type="button" className="principal" onClick={() => { onFechar(); d.ir({ t: "admin", aba: "empresas", id: criada.id }); }}>Abrir a empresa</button>
            </footer>
          </>
        ) : (
          <form onSubmit={salvar} style={{ display: "contents" }} noValidate>
            <div className="corpo">
              {erro && <div className="sa-aviso erro">{erro}</div>}
              <div className="sa-campos">
                <label>CNPJ
                  <input className="mono" inputMode="numeric" value={f.cnpj} placeholder="00.000.000/0000-00" autoFocus
                    onChange={(e) => campo("cnpj", formatarCnpj(e.target.value))} onBlur={() => setTocado({ ...tocado, cnpj: true })} />
                  {msg("cnpj")}
                </label>
                <label>Nome da empresa
                  <input value={f.nome} onChange={(e) => campo("nome", e.target.value)} onBlur={() => setTocado({ ...tocado, nome: true })} />
                  {msg("nome")}
                </label>
                <label className="largo">Nome do responsável
                  <input value={f.responsavel} onChange={(e) => campo("responsavel", e.target.value)} onBlur={() => setTocado({ ...tocado, responsavel: true })} />
                  {msg("responsavel")}
                </label>
                <label>Telefone / WhatsApp
                  <input inputMode="tel" value={f.telefone} placeholder="(71) 99999-0000"
                    onChange={(e) => campo("telefone", formatarTelefone(e.target.value))} onBlur={() => setTocado({ ...tocado, telefone: true })} />
                  {msg("telefone")}
                </label>
                <label><Rotulo dica="é o login de acesso">E-mail da empresa</Rotulo>
                  <input type="email" value={f.email} placeholder="contato@empresa.com.br"
                    onChange={(e) => campo("email", e.target.value)} onBlur={() => setTocado({ ...tocado, email: true })} />
                  {msg("email")}
                </label>
                <label><Rotulo dica="a senha padrão; o cliente troca no 1º acesso">Senha provisória</Rotulo>
                  <input className="mono" value={f.senha} onChange={(e) => campo("senha", e.target.value)} onBlur={() => setTocado({ ...tocado, senha: true })} />
                  {msg("senha")}
                </label>
                <label>Plano
                  <select value={f.plano_id} onChange={(e) => campo("plano_id", e.target.value)}>
                    {d.planos.filter((p) => p.ativo).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                    <option value="">Sem plano (segue o padrão de cada recurso)</option>
                  </select>
                </label>
                <CampoCreditosMes valor={creditos} onChange={setCreditos}
                  planoTotal={f.plano_id ? d.planos.find((p) => p.id === f.plano_id)?.limite_servicos_mes ?? null : undefined} />
              </div>
            </div>
            <footer>
              <button type="button" onClick={onFechar} disabled={enviando}>Cancelar</button>
              <button type="submit" className="principal" disabled={enviando}>{enviando ? "Cadastrando…" : "Cadastrar empresa"}</button>
            </footer>
          </form>
        )}
      </aside>
    </>
  );
}
