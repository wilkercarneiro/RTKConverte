// Cadastros reaproveitados pelos serviços: responsáveis técnicos (com o registro
// no conselho — CFTA, CFT ou CREA) e credenciados (nome + código que prefixa os
// vértices). Tudo o que é salvo aqui aparece nos selects do Serviço 1 e do
// Serviço 2 sem nenhum passo extra: eles leem estas mesmas tabelas.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { CONSELHOS } from "../lib/domains";
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
  const [msg, setMsg] = useState<string | null>(null);

  async function recarregar() {
    const { data } = await supabase.from("responsaveis_tecnicos").select().order("nome");
    setRts((data as RT[]) ?? []);
  }

  useEffect(() => { recarregar(); }, []);

  function campo<K extends keyof NovoRT>(k: K, v: NovoRT[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function abrirNovo() {
    setEditId(null);
    setForm({ ...RT_VAZIO });
    setErro(null);
    setMsg(null);
  }

  function abrirEdicao(r: RT) {
    const { id, ...campos } = r;
    setEditId(id);
    setForm({ ...campos, conselho_sigla: r.conselho_sigla ?? "CFTA" });
    setErro(null);
    setMsg(null);
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
    setMsg(editId ? "Responsável técnico atualizado." : "Responsável técnico cadastrado — já disponível nos serviços.");
    setForm(null);
    setEditId(null);
    await recarregar();
  }

  async function remover(r: RT) {
    if (!confirm(`Excluir o responsável técnico "${r.nome}"?`)) return;
    const { error } = await supabase.from("responsaveis_tecnicos").delete().eq("id", r.id);
    if (error) { setErro(mensagemErro(error, "este responsável")); return; }
    setErro(null);
    setMsg("Responsável técnico excluído.");
    if (editId === r.id) { setForm(null); setEditId(null); }
    await recarregar();
  }

  return (
    <section className="bloco">
      <header>
        <span className="num-bloco">👷</span>
        <h3>Responsáveis Técnicos</h3>
        <span className="desc">nome + conselho (CFTA, CFT ou CREA) — aparecem no select "Responsável Técnico" dos serviços</span>
        <span className="esticar" style={{ flex: 1 }} />
        <button onClick={abrirNovo}>+ Novo responsável</button>
      </header>

      {rts.length === 0
        ? <p style={{ color: "var(--texto-2)" }}>Nenhum responsável técnico cadastrado ainda.</p>
        : (
          <table className="tabela-vertices">
            <thead><tr><th>Nome</th><th>Formação</th><th>Conselho</th><th>CPF</th><th /></tr></thead>
            <tbody>
              {rts.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.nome}</b></td>
                  <td>{r.formacao || "—"}</td>
                  <td className="mono">{(r.conselho_sigla ?? "CREA")} {(r.conselho_numero ?? "").trim() || (r.crea ?? "") || "—"}</td>
                  <td className="mono">{r.cpf || "—"}</td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    <button className="fantasma" onClick={() => abrirEdicao(r)}>editar</button>
                    <button className="remover" onClick={() => remover(r)}>excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {form && (
        <fieldset className="inserir-v" style={{ display: "block", marginTop: 14 }}>
          <legend>{editId ? "Editando responsável técnico" : "Novo responsável técnico"}</legend>
          <div className="grade">
            <label>Nome *
              <input value={form.nome} onChange={(e) => campo("nome", e.target.value)} placeholder="ex.: JOSÉ DA SILVA" style={{ width: "100%" }} />
            </label>
            <label>Formação
              <input value={form.formacao ?? ""} onChange={(e) => campo("formacao", e.target.value || null)}
                placeholder="ex.: Técnico em Agrimensura" style={{ width: "100%" }} />
            </label>
            <label>Conselho
              <select value={form.conselho_sigla ?? "CFTA"} onChange={(e) => campo("conselho_sigla", e.target.value)} style={{ width: "100%" }}>
                {CONSELHOS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>Nº do registro *
              <input className="mono" value={form.conselho_numero ?? ""} onChange={(e) => campo("conselho_numero", e.target.value || null)}
                placeholder="ex.: 0578839458-9" style={{ width: "100%" }} />
            </label>
            <label>CPF
              <input className="mono" value={form.cpf ?? ""} onChange={(e) => campo("cpf", e.target.value || null)}
                placeholder="000.000.000-00" style={{ width: "100%" }} />
            </label>
            <label>Identidade (RG)
              <input value={form.identidade ?? ""} onChange={(e) => campo("identidade", e.target.value || null)} style={{ width: "100%" }} />
            </label>
            <label>TRT padrão (opcional)
              <input className="mono" value={form.trt ?? ""} onChange={(e) => campo("trt", e.target.value.trim() || null)}
                placeholder="ex.: BR20250804764" style={{ width: "100%" }} />
              <small className="sub">usado quando o serviço não informa um TRT próprio</small>
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="principal" onClick={salvar}>{editId ? "Salvar alterações" : "Cadastrar"}</button>
            <button className="fantasma" onClick={() => { setForm(null); setEditId(null); setErro(null); }}>Cancelar</button>
          </div>
        </fieldset>
      )}

      {erro && <div className="erro">{erro}</div>}
      {msg && !erro && <div className="ok">{msg}</div>}
    </section>
  );
}

function CadastroCredenciados() {
  const [creds, setCreds] = useState<Credenciado[]>([]);
  const [form, setForm] = useState<NovoCredenciado | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function recarregar() {
    const { data } = await supabase.from("credenciados").select().order("nome");
    setCreds((data as Credenciado[]) ?? []);
  }

  useEffect(() => { recarregar(); }, []);

  function campo<K extends keyof NovoCredenciado>(k: K, v: NovoCredenciado[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function abrirNovo() {
    setEditId(null);
    setForm({ ...CREDENCIADO_VAZIO });
    setErro(null);
    setMsg(null);
  }

  function abrirEdicao(c: Credenciado) {
    const { id, ...campos } = c;
    setEditId(id);
    setForm(campos);
    setErro(null);
    setMsg(null);
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
    setMsg(editId ? "Credenciado atualizado." : "Credenciado cadastrado — já disponível nos serviços.");
    setForm(null);
    setEditId(null);
    await recarregar();
  }

  async function remover(c: Credenciado) {
    if (!confirm(`Excluir o credenciado "${c.nome}" (${c.prefixo_vertice})?`)) return;
    const { error } = await supabase.from("credenciados").delete().eq("id", c.id);
    if (error) { setErro(mensagemErro(error, "este credenciado")); return; }
    setErro(null);
    setMsg("Credenciado excluído.");
    if (editId === c.id) { setForm(null); setEditId(null); }
    await recarregar();
  }

  return (
    <section className="bloco">
      <header>
        <span className="num-bloco">🏷️</span>
        <h3>Credenciados</h3>
        <span className="desc">o código prefixa todo vértice gerado (ex.: <code>DSBN-M-3605</code>)</span>
        <span className="esticar" style={{ flex: 1 }} />
        <button onClick={abrirNovo}>+ Novo credenciado</button>
      </header>

      {creds.length === 0
        ? <p style={{ color: "var(--texto-2)" }}>Nenhum credenciado cadastrado ainda.</p>
        : (
          <table className="tabela-vertices">
            <thead><tr><th>Nome</th><th>Código</th><th>Contador M</th><th>Contador P</th><th>Contador V</th><th /></tr></thead>
            <tbody>
              {creds.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.nome}</b></td>
                  <td className="mono">{c.prefixo_vertice}</td>
                  <td className="mono">{c.contador_m}</td>
                  <td className="mono">{c.contador_p}</td>
                  <td className="mono">{c.contador_v}</td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    <button className="fantasma" onClick={() => abrirEdicao(c)}>editar</button>
                    <button className="remover" onClick={() => remover(c)}>excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      {form && (
        <fieldset className="inserir-v" style={{ display: "block", marginTop: 14 }}>
          <legend>{editId ? "Editando credenciado" : "Novo credenciado"}</legend>
          <div className="grade">
            <label>Nome do credenciado *
              <input value={form.nome} onChange={(e) => campo("nome", e.target.value)} placeholder="ex.: JOSÉ DA SILVA" style={{ width: "100%" }} />
            </label>
            <label>Código do credenciado *
              <input className="mono" value={form.prefixo_vertice} maxLength={8}
                onChange={(e) => campo("prefixo_vertice", e.target.value.toUpperCase())}
                placeholder="ex.: DSBN" style={{ width: "100%" }} />
              <small className="sub">prefixo dos vértices no SIGEF</small>
            </label>
            <label>Contador M
              <input className="mono" type="number" min={0} value={form.contador_m}
                onChange={(e) => contador("contador_m", e.target.value)} style={{ width: "100%" }} />
            </label>
            <label>Contador P
              <input className="mono" type="number" min={0} value={form.contador_p}
                onChange={(e) => contador("contador_p", e.target.value)} style={{ width: "100%" }} />
            </label>
            <label>Contador V
              <input className="mono" type="number" min={0} value={form.contador_v}
                onChange={(e) => contador("contador_v", e.target.value)} style={{ width: "100%" }} />
            </label>
          </div>
          <p className="sub" style={{ margin: "10px 2px 0" }}>
            Os contadores continuam a numeração do Anexo A: informe o último número já usado por este
            credenciado. Cada geração incrementa automaticamente — só mexa aqui para acertar a sequência.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button className="principal" onClick={salvar}>{editId ? "Salvar alterações" : "Cadastrar"}</button>
            <button className="fantasma" onClick={() => { setForm(null); setEditId(null); setErro(null); }}>Cancelar</button>
          </div>
        </fieldset>
      )}

      {erro && <div className="erro">{erro}</div>}
      {msg && !erro && <div className="ok">{msg}</div>}
    </section>
  );
}
