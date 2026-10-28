// Cadastros reaproveitados pelos serviços: responsáveis técnicos (com o registro
// no conselho — CFTA, CFT ou CREA) e credenciados (nome + código que prefixa os
// vértices). Tudo o que é salvo aqui aparece nos selects do Serviço 1 e do
// Serviço 2 sem nenhum passo extra: eles leem estas mesmas tabelas.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { CONSELHOS } from "../lib/domains";
import { useAvisos } from "../lib/ux";
import { confirmar, EstadoErro, EstadoVazio, Esqueleto } from "./ui";
import { temPermissao } from "../lib/permissoes";
import type { Credenciado, RT } from "../lib/types";

type NovoRT = Omit<RT, "id">;
type NovoCredenciado = Omit<Credenciado, "id">;

const RT_VAZIO: NovoRT = {
  nome: "", formacao: "", conselho_sigla: "CFTA", conselho_numero: "",
  cpf: "", identidade: "", crea: null, trt: null,
};

const CREDENCIADO_VAZIO: NovoCredenciado = {
  nome: "", prefixo_vertice: "", contador_m: 0, contador_p: 0, contador_v: 0,
};

// O banco recusa apagar um registro que já está em uso por algum serviço (FK).
function mensagemErro(e: { code?: string; message: string }, oQue: string): string {
  if (e.code === "23503") return `Não dá para excluir: ${oQue} já está vinculado a um serviço.`;
  return e.message;
}

const ICONE_PESSOA = "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8";
const ICONE_CREDENCIADO = "M12 2 3 7v6c0 5 4 8 9 9 5-1 9-4 9-9V7zM9 12l2 2 4-4";

export function Cadastros() {
  return (
    <>
      <CadastroRTs />
      <CadastroCredenciados />
    </>
  );
}

function CadastroRTs() {
  const [rts, setRts] = useState<RT[]>([]);
  const [form, setForm] = useState<NovoRT | null>(null); // null = formulário fechado
  const [editId, setEditId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const { avisar } = useAvisos();
  const pode = temPermissao("cadastros.editar");

  async function recarregar() {
    const { data, error } = await supabase.from("responsaveis_tecnicos").select().order("nome");
    setFalha(error ? error.message : null);
    if (!error) setRts((data as RT[]) ?? []);
    setCarregando(false);
  }

  useEffect(() => { recarregar(); }, []);

  function campo<K extends keyof NovoRT>(k: K, v: NovoRT[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function abrirNovo() {
    setEditId(null);
    setForm({ ...RT_VAZIO });
    setErro(null);
  }

  function abrirEdicao(r: RT) {
    const { id, ...campos } = r;
    setEditId(id);
    setForm({ ...campos, conselho_sigla: r.conselho_sigla ?? "CFTA" });
    setErro(null);
  }

  async function salvar() {
    if (!form) return;
    if (!form.nome.trim()) { setErro("Informe o nome do responsável técnico."); return; }
    if (!(form.conselho_numero ?? "").trim()) { setErro("Informe o número do registro no conselho."); return; }
    setErro(null);
    const dados = { ...form, nome: form.nome.trim(), conselho_numero: (form.conselho_numero ?? "").trim() };
    const { error } = editId
      ? await supabase.from("responsaveis_tecnicos").update(dados).eq("id", editId)
      : await supabase.from("responsaveis_tecnicos").insert(dados);
    if (error) { setErro(error.message); return; }
    avisar("ok", editId ? "Responsável técnico atualizado." : "Responsável técnico cadastrado — já disponível nos serviços.");
    setForm(null);
    setEditId(null);
    await recarregar();
  }

  async function remover(r: RT) {
    const ok = await confirmar({
      titulo: `Excluir o responsável técnico "${r.nome}"?`,
      texto: "Ele deixa de aparecer nos serviços novos. Se já estiver num serviço, o sistema não deixa excluir.",
      confirmar: "Excluir", perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("responsaveis_tecnicos").delete().eq("id", r.id);
    if (error) { setErro(mensagemErro(error, "este responsável")); return; }
    setErro(null);
    avisar("ok", `Responsável técnico "${r.nome}" excluído.`);
    if (editId === r.id) { setForm(null); setEditId(null); }
    await recarregar();
  }

  return (
    <section className="bloco">
      <header>
        <h3>Responsáveis técnicos</h3>
        <span className="desc">nome + conselho (CFTA, CFT ou CREA) — aparecem no select "Responsável Técnico" dos serviços</span>
        <span className="esticar" />
        {pode && !form && rts.length > 0 && <button onClick={abrirNovo}>+ Novo responsável</button>}
      </header>

      {falha ? <EstadoErro mensagem={falha} onTentar={recarregar} titulo="Não foi possível carregar os responsáveis" />
        : carregando ? <Esqueleto linhas={2} />
        : rts.length === 0 ? (
          <EstadoVazio compacto icone={ICONE_PESSOA} titulo="Nenhum responsável técnico cadastrado"
            texto={pode ? "Cadastre quem assina os serviços: ele aparece no select de todo serviço." : "Peça a quem administra a empresa para cadastrar."}
            acao={pode && !form ? <button className="principal" onClick={abrirNovo}>Cadastrar responsável</button> : undefined} />
        ) : (
          <div className="tabela-wrap"><table className="tabela-vertices">
            <thead><tr><th>Nome</th><th className="col-sec">Formação</th><th>Conselho</th><th className="col-sec">CPF</th>{pode && <th><span className="sr-only">Ações</span></th>}</tr></thead>
            <tbody>
              {rts.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.nome}</b></td>
                  <td className="col-sec">{r.formacao || "—"}</td>
                  <td className="mono">{(r.conselho_sigla ?? "CREA")} {(r.conselho_numero ?? "").trim() || (r.crea ?? "") || "—"}</td>
                  <td className="mono col-sec">{r.cpf || "—"}</td>
                  {pode && (
                    <td className="acao">
                      <button className="fantasma" onClick={() => abrirEdicao(r)} aria-label={`Editar ${r.nome}`}>Editar</button>
                      <button className="icone" onClick={() => remover(r)} aria-label={`Excluir o responsável técnico ${r.nome}`} title="Excluir">✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}

      {form && (
        <fieldset className="inserir-v cadastro-form">
          <legend>{editId ? "Editando responsável técnico" : "Novo responsável técnico"}</legend>
          <div className="grade">
            <label>Nome *
              <input value={form.nome} onChange={(e) => campo("nome", e.target.value)} placeholder="ex.: JOSÉ DA SILVA" />
            </label>
            <label>Formação
              <input value={form.formacao ?? ""} onChange={(e) => campo("formacao", e.target.value || null)}
                placeholder="ex.: Técnico em Agrimensura" />
            </label>
            <label>Conselho
              <select value={form.conselho_sigla ?? "CFTA"} onChange={(e) => campo("conselho_sigla", e.target.value)}>
                {CONSELHOS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>Nº do registro *
              <input className="mono" value={form.conselho_numero ?? ""} onChange={(e) => campo("conselho_numero", e.target.value || null)}
                placeholder="ex.: 0578839458-9" />
            </label>
            <label>CPF
              <input className="mono" value={form.cpf ?? ""} onChange={(e) => campo("cpf", e.target.value || null)}
                placeholder="000.000.000-00" />
            </label>
            <label>Identidade (RG)
              <input value={form.identidade ?? ""} onChange={(e) => campo("identidade", e.target.value || null)} />
            </label>
            <label>TRT padrão (opcional)
              <input className="mono" value={form.trt ?? ""} onChange={(e) => campo("trt", e.target.value.trim() || null)}
                placeholder="ex.: BR20250804764" />
              <small className="sub">usado quando o serviço não informa um TRT próprio</small>
            </label>
          </div>
          <div className="rodape-acoes">
            <button className="principal" onClick={salvar}>{editId ? "Salvar alterações" : "Cadastrar"}</button>
            <button className="fantasma" onClick={() => { setForm(null); setEditId(null); setErro(null); }}>Cancelar</button>
          </div>
        </fieldset>
      )}

      {erro && <div className="erro">{erro}</div>}
    </section>
  );
}

function CadastroCredenciados() {
  const [creds, setCreds] = useState<Credenciado[]>([]);
  const [form, setForm] = useState<NovoCredenciado | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const { avisar } = useAvisos();
  const pode = temPermissao("cadastros.editar");

  async function recarregar() {
    const { data, error } = await supabase.from("credenciados").select().order("nome");
    setFalha(error ? error.message : null);
    if (!error) setCreds((data as Credenciado[]) ?? []);
    setCarregando(false);
  }

  useEffect(() => { recarregar(); }, []);

  function campo<K extends keyof NovoCredenciado>(k: K, v: NovoCredenciado[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function abrirNovo() {
    setEditId(null);
    setForm({ ...CREDENCIADO_VAZIO });
    setErro(null);
  }

  function abrirEdicao(c: Credenciado) {
    const { id, ...campos } = c;
    setEditId(id);
    setForm(campos);
    setErro(null);
  }

  // Os contadores continuam a numeração do Anexo A do credenciado: o gerador
  // aloca a partir deles, então mexer aqui reescreve a sequência dos vértices.
  function contador(k: "contador_m" | "contador_p" | "contador_v", v: string) {
    const n = parseInt(v, 10);
    campo(k, Number.isFinite(n) && n >= 0 ? n : 0);
  }

  async function salvar() {
    if (!form) return;
    const codigo = form.prefixo_vertice.trim().toUpperCase();
    if (!form.nome.trim()) { setErro("Informe o nome do credenciado."); return; }
    if (!/^[A-Z0-9]{2,8}$/.test(codigo)) { setErro("Código do credenciado: 2 a 8 letras ou números (ex.: DSBN)."); return; }
    setErro(null);
    const dados = { ...form, nome: form.nome.trim(), prefixo_vertice: codigo };
    const { error } = editId
      ? await supabase.from("credenciados").update(dados).eq("id", editId)
      : await supabase.from("credenciados").insert(dados);
    if (error) { setErro(error.message); return; }
    avisar("ok", editId ? "Credenciado atualizado." : "Credenciado cadastrado — já disponível nos serviços.");
    setForm(null);
    setEditId(null);
    await recarregar();
  }

  async function remover(c: Credenciado) {
    const ok = await confirmar({
      titulo: `Excluir o credenciado "${c.nome}" (${c.prefixo_vertice})?`,
      texto: "Ele deixa de aparecer nos serviços novos. Se já estiver num serviço, o sistema não deixa excluir.",
      confirmar: "Excluir", perigo: true,
    });
    if (!ok) return;
    const { error } = await supabase.from("credenciados").delete().eq("id", c.id);
    if (error) { setErro(mensagemErro(error, "este credenciado")); return; }
    setErro(null);
    avisar("ok", `Credenciado "${c.nome}" excluído.`);
    if (editId === c.id) { setForm(null); setEditId(null); }
    await recarregar();
  }

  return (
    <section className="bloco">
      <header>
        <h3>Credenciados</h3>
        <span className="desc">o código prefixa todo vértice gerado (ex.: <code>DSBN-M-3605</code>)</span>
        <span className="esticar" />
        {pode && !form && creds.length > 0 && <button onClick={abrirNovo}>+ Novo credenciado</button>}
      </header>

      {falha ? <EstadoErro mensagem={falha} onTentar={recarregar} titulo="Não foi possível carregar os credenciados" />
        : carregando ? <Esqueleto linhas={2} />
        : creds.length === 0 ? (
          <EstadoVazio compacto icone={ICONE_CREDENCIADO} titulo="Nenhum credenciado cadastrado"
            texto={pode ? "O código do credenciado prefixa os vértices que vão ao SIGEF." : "Peça a quem administra a empresa para cadastrar."}
            acao={pode && !form ? <button className="principal" onClick={abrirNovo}>Cadastrar credenciado</button> : undefined} />
        ) : (
          <div className="tabela-wrap"><table className="tabela-vertices">
            <thead><tr><th>Nome</th><th>Código</th><th className="col-sec">Contador M</th><th className="col-sec">Contador P</th><th className="col-sec">Contador V</th>{pode && <th><span className="sr-only">Ações</span></th>}</tr></thead>
            <tbody>
              {creds.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.nome}</b></td>
                  <td className="mono">{c.prefixo_vertice}</td>
                  <td className="mono col-sec">{c.contador_m}</td>
                  <td className="mono col-sec">{c.contador_p}</td>
                  <td className="mono col-sec">{c.contador_v}</td>
                  {pode && (
                    <td className="acao">
                      <button className="fantasma" onClick={() => abrirEdicao(c)} aria-label={`Editar ${c.nome}`}>Editar</button>
                      <button className="icone" onClick={() => remover(c)} aria-label={`Excluir o credenciado ${c.nome}`} title="Excluir">✕</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}

      {form && (
        <fieldset className="inserir-v cadastro-form">
          <legend>{editId ? "Editando credenciado" : "Novo credenciado"}</legend>
          <div className="grade">
            <label>Nome do credenciado *
              <input value={form.nome} onChange={(e) => campo("nome", e.target.value)} placeholder="ex.: JOSÉ DA SILVA" />
            </label>
            <label>Código do credenciado *
              <input className="mono" value={form.prefixo_vertice} maxLength={8}
                onChange={(e) => campo("prefixo_vertice", e.target.value.toUpperCase())}
                placeholder="ex.: DSBN" />
              <small className="sub">prefixo dos vértices no SIGEF</small>
            </label>
            <label>Contador M
              <input className="mono" type="number" min={0} value={form.contador_m}
                onChange={(e) => contador("contador_m", e.target.value)} />
            </label>
            <label>Contador P
              <input className="mono" type="number" min={0} value={form.contador_p}
                onChange={(e) => contador("contador_p", e.target.value)} />
            </label>
            <label>Contador V
              <input className="mono" type="number" min={0} value={form.contador_v}
                onChange={(e) => contador("contador_v", e.target.value)} />
            </label>
          </div>
          <p className="sub contadores-nota">
            Os contadores continuam a numeração do Anexo A: informe o último número já usado por este
            credenciado. Cada geração incrementa automaticamente — só mexa aqui para acertar a sequência.
          </p>
          <div className="rodape-acoes">
            <button className="principal" onClick={salvar}>{editId ? "Salvar alterações" : "Cadastrar"}</button>
            <button className="fantasma" onClick={() => { setForm(null); setEditId(null); setErro(null); }}>Cancelar</button>
          </div>
        </fieldset>
      )}

      {erro && <div className="erro">{erro}</div>}
    </section>
  );
}
