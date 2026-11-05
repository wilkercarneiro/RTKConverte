// Cadastros reaproveitados pelos serviços: responsáveis técnicos (com o registro
// no conselho — CFTA, CFT ou CREA) e credenciados (nome + código que prefixa os
// vértices). Tudo o que é salvo aqui aparece nos selects do Serviço 1 e do
// Serviço 2 sem nenhum passo extra: eles leem estas mesmas tabelas.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { CONSELHOS } from "../lib/domains";
import { useAvisos } from "../lib/ux";
import { confirmar, Dica, EstadoErro, EstadoVazio, Esqueleto, Rotulo } from "./ui";
import { temPermissao } from "../lib/permissoes";
import { contadoresParaGravar, ultimosDe, ultimoUsado } from "../lib/contadores";
import type { CampoContador, UltimosUsados } from "../lib/contadores";
import type { Credenciado, RT } from "../lib/types";
import { caminhoAssinatura, prepararAssinatura } from "../lib/assinatura";
import { gravarSemColunasAusentes } from "../lib/coluna_ausente";

type NovoRT = Omit<RT, "id">;
/**
 * O formulário do credenciado fala em ÚLTIMO número usado; o banco guarda o
 * PRÓXIMO a usar. A conversão fica em lib/contadores.ts.
 */
type FormCredenciado = { nome: string; prefixo_vertice: string; ultimos: UltimosUsados };

const RT_VAZIO: NovoRT = {
  nome: "", formacao: "", conselho_sigla: "CFTA", conselho_numero: "",
  cpf: "", identidade: "", crea: null, trt: null, assinar_com_imagem: true,
};

/** Imagem da assinatura em edição: a que já está no Storage, uma nova a enviar, ou "remover". */
type EstadoAssinatura =
  | { t: "nenhuma" }
  | { t: "salva"; url: string }
  | { t: "nova"; blob: Blob; url: string }
  | { t: "remover" };

// O banco recusa apagar um registro que já está em uso por algum serviço (FK).
function mensagemErro(e: { code?: string; message: string }, oQue: string): string {
  if (e.code === "23503") return `Não dá para excluir: ${oQue} já está vinculado a um serviço.`;
  return e.message;
}

const ICONE_PESSOA = "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8";
const ICONE_CREDENCIADO = "M12 2 3 7v6c0 5 4 8 9 9 5-1 9-4 9-9V7zM9 12l2 2 4-4";

export function Cadastros({ escritorioId = null }: { escritorioId?: string | null }) {
  return (
    <>
      <CadastroRTs escritorioId={escritorioId} />
      <CadastroCredenciados />
    </>
  );
}

export function CadastroRTs({ escritorioId = null }: { escritorioId?: string | null }) {
  const [rts, setRts] = useState<RT[]>([]);
  // a coluna assinar_com_imagem (migração 0043) existe no banco? null = ainda não
  // se sabe (lista vazia): manda o campo e, se o banco recusar, repete sem ele
  const [temColunaAssinar, setTemColunaAssinar] = useState<boolean | null>(null);
  const [form, setForm] = useState<NovoRT | null>(null); // null = formulário fechado
  const [editId, setEditId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  // ids dos RTs que já têm a imagem da assinatura no Storage
  const [comAssinatura, setComAssinatura] = useState<Set<string>>(new Set());
  const [assinatura, setAssinatura] = useState<EstadoAssinatura>({ t: "nenhuma" });
  const [limpar, setLimpar] = useState(true);
  const [preparando, setPreparando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const { avisar } = useAvisos();
  const pode = temPermissao("cadastros.editar");
  // a imagem mora em templates/, que só quem configura a empresa grava
  const podeAssinatura = pode && !!escritorioId && temPermissao("empresa.configurar");
  const pastaAssinaturas = escritorioId ? `escritorios/${escritorioId}/assinaturas` : null;

  async function recarregar() {
    const { data, error } = await supabase.from("responsaveis_tecnicos").select().order("nome");
    setFalha(error ? error.message : null);
    if (!error) {
      setRts((data as RT[]) ?? []);
      if (data?.length) setTemColunaAssinar("assinar_com_imagem" in (data[0] as object));
    }
    if (pastaAssinaturas) {
      const { data: arqs } = await supabase.storage.from("templates").list(pastaAssinaturas, { limit: 1000 });
      setComAssinatura(new Set((arqs ?? []).map((a) => /^rt-(.+)\.png$/.exec(a.name)?.[1]).filter((x): x is string => !!x)));
    }
    setCarregando(false);
  }

  useEffect(() => { recarregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function campo<K extends keyof NovoRT>(k: K, v: NovoRT[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function trocarAssinatura(a: EstadoAssinatura) {
    setAssinatura((antiga) => { if (antiga.t === "nova") URL.revokeObjectURL(antiga.url); return a; });
  }

  function abrirNovo() {
    setEditId(null);
    setForm({ ...RT_VAZIO });
    trocarAssinatura({ t: "nenhuma" });
    setErro(null);
  }

  async function abrirEdicao(r: RT) {
    const { id, ...campos } = r;
    setEditId(id);
    setForm({ ...campos, conselho_sigla: r.conselho_sigla ?? "CFTA", assinar_com_imagem: r.assinar_com_imagem !== false });
    setErro(null);
    trocarAssinatura({ t: "nenhuma" });
    if (escritorioId && comAssinatura.has(id)) {
      const { data } = await supabase.storage.from("templates").createSignedUrl(caminhoAssinatura(escritorioId, id), 600);
      if (data?.signedUrl) trocarAssinatura({ t: "salva", url: data.signedUrl });
    }
  }

  function fechar() {
    setForm(null);
    setEditId(null);
    setErro(null);
    trocarAssinatura({ t: "nenhuma" });
  }

  async function escolherAssinatura(f: File) {
    setPreparando(true);
    setErro(null);
    try {
      const blob = await prepararAssinatura(f, { limparFundo: limpar });
      trocarAssinatura({ t: "nova", blob, url: URL.createObjectURL(blob) });
      // imagem nova: assinar com ela é o que a pessoa quer
      campo("assinar_com_imagem", true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setPreparando(false);
    }
  }

  async function salvar() {
    if (!form) return;
    if (!form.nome.trim()) { setErro("Informe o nome do responsável técnico."); return; }
    if (!(form.conselho_numero ?? "").trim()) { setErro("Informe o número do registro no conselho."); return; }
    setErro(null);
    setSalvando(true);
    try {
      const dados: Partial<NovoRT> = { ...form, nome: form.nome.trim(), conselho_numero: (form.conselho_numero ?? "").trim() };
      // banco sem a 0043: o campo não vai (senão o cadastro inteiro é recusado)
      if (temColunaAssinar === false) delete dados.assinar_com_imagem;
      const OPCIONAIS = ["assinar_com_imagem"] as const;
      let id = editId;
      if (editId) {
        const { resultado: { error }, omitidas } = await gravarSemColunasAusentes(dados, OPCIONAIS,
          (d) => supabase.from("responsaveis_tecnicos").update(d).eq("id", editId));
        if (omitidas.length) setTemColunaAssinar(false);
        if (error) { setErro(error.message); return; }
      } else {
        const { resultado: { data, error }, omitidas } = await gravarSemColunasAusentes(dados, OPCIONAIS,
          (d) => supabase.from("responsaveis_tecnicos").insert(d).select("id").single());
        if (omitidas.length) setTemColunaAssinar(false);
        if (error) { setErro(error.message); return; }
        id = (data as { id: string }).id;
      }
      // a imagem vai depois do cadastro: o caminho leva o id do RT
      let falhaImagem: string | null = null;
      if (id && escritorioId && assinatura.t === "nova") {
        const { error } = await supabase.storage.from("templates").upload(caminhoAssinatura(escritorioId, id), assinatura.blob, { upsert: true, contentType: "image/png" });
        if (error) falhaImagem = `o cadastro foi salvo, mas a imagem da assinatura não: ${error.message}`;
      } else if (id && escritorioId && assinatura.t === "remover") {
        const { error } = await supabase.storage.from("templates").remove([caminhoAssinatura(escritorioId, id)]);
        if (error) falhaImagem = `o cadastro foi salvo, mas a imagem da assinatura não foi removida: ${error.message}`;
      }
      if (falhaImagem) { setErro(falhaImagem.charAt(0).toUpperCase() + falhaImagem.slice(1)); await recarregar(); return; }
      avisar("ok", editId ? "Responsável técnico atualizado." : "Responsável técnico cadastrado — já disponível nos serviços.");
      fechar();
      await recarregar();
    } finally {
      setSalvando(false);
    }
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
    // a imagem da assinatura vai junto (sem o RT ela não serve para nada)
    if (escritorioId && comAssinatura.has(r.id) && podeAssinatura) {
      await supabase.storage.from("templates").remove([caminhoAssinatura(escritorioId, r.id)]);
    }
    if (editId === r.id) fechar();
    await recarregar();
  }

  return (
    <section className="bloco">
      <header>
        <h3>Responsáveis técnicos<Dica>nome + conselho (CFTA, CFT ou CREA) — aparecem no select "Responsável Técnico" dos serviços</Dica></h3>
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
            <thead><tr><th>Nome</th><th className="col-sec">Formação</th><th>Conselho</th><th className="col-sec">CPF</th>{escritorioId && <th className="col-sec">Assinatura</th>}{pode && <th><span className="sr-only">Ações</span></th>}</tr></thead>
            <tbody>
              {rts.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.nome}</b></td>
                  <td className="col-sec">{r.formacao || "—"}</td>
                  <td className="mono">{(r.conselho_sigla ?? "CREA")} {(r.conselho_numero ?? "").trim() || (r.crea ?? "") || "—"}</td>
                  <td className="mono col-sec">{r.cpf || "—"}</td>
                  {escritorioId && (
                    <td className="col-sec">{comAssinatura.has(r.id)
                      ? (r.assinar_com_imagem === false ? "imagem (desligada)" : "imagem nos documentos")
                      : "—"}</td>
                  )}
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
            <label><Rotulo dica="usado quando o serviço não informa um TRT próprio">TRT padrão (opcional)</Rotulo>
              <input className="mono" value={form.trt ?? ""} onChange={(e) => campo("trt", e.target.value.trim() || null)}
                placeholder="ex.: BR20250804764" />
            </label>
          </div>
          {escritorioId && (
            <div className="assinatura-rt">
              <div className="titulo-campo">Imagem da assinatura
                <Dica>Foto ou escaneamento da assinatura em papel branco. O sistema tira o fundo branco e põe a imagem acima da linha do responsável técnico no memorial, no tabular, nas peças e no carimbo da planta. É só uma IMAGEM da assinatura — não é assinatura digital ICP-Brasil e não substitui o certificado digital.</Dica>
              </div>
              <div className="assinatura-rt-corpo">
                <div className={`assinatura-rt-previa${assinatura.t === "salva" || assinatura.t === "nova" ? " com" : ""}`}>
                  {assinatura.t === "salva" || assinatura.t === "nova"
                    ? <img src={assinatura.url} alt={`Assinatura de ${form.nome || "responsável técnico"}`} />
                    : <span className="sub">{assinatura.t === "remover" ? "A imagem será removida ao salvar." : "Nenhuma imagem enviada."}</span>}
                </div>
                {podeAssinatura ? (
                  <div className="assinatura-rt-acoes">
                    <label className="dropzone linha"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !preparando) escolherAssinatura(f); }}>
                      {preparando ? <><span className="spinner" /> Preparando…</> : <b>{assinatura.t === "salva" || assinatura.t === "nova" ? "Trocar imagem" : "Enviar imagem"} — arraste ou clique</b>}
                      <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={preparando}
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) escolherAssinatura(f); e.target.value = ""; }} />
                    </label>
                    <div className="assinatura-rt-opcoes">
                      <label className="check">
                        <input type="checkbox" checked={limpar} onChange={(e) => setLimpar(e.target.checked)} />
                        <span>Tirar o fundo branco<Dica>desligue se a imagem já for PNG com fundo transparente</Dica></span>
                      </label>
                      {(assinatura.t === "salva" || assinatura.t === "nova") && (
                        <button type="button" className="fantasma" onClick={() => trocarAssinatura(editId && comAssinatura.has(editId) ? { t: "remover" } : { t: "nenhuma" })}>Remover imagem</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="sub">Só quem tem a permissão &quot;Dados da empresa&quot; envia a imagem da assinatura.</p>
                )}
              </div>
              {temColunaAssinar !== false && <label className="check">
                <input type="checkbox" checked={form.assinar_com_imagem !== false}
                  disabled={!(assinatura.t === "salva" || assinatura.t === "nova")}
                  onChange={(e) => campo("assinar_com_imagem", e.target.checked)} />
                <span>Assinar os documentos com a imagem da assinatura</span>
              </label>}
            </div>
          )}
          <div className="rodape-acoes">
            <button className="principal" onClick={salvar} disabled={salvando || preparando}>{salvando ? "Salvando…" : editId ? "Salvar alterações" : "Cadastrar"}</button>
            <button className="fantasma" onClick={fechar}>Cancelar</button>
          </div>
        </fieldset>
      )}

      {erro && <div className="erro">{erro}</div>}
    </section>
  );
}

function CadastroCredenciados() {
  const [creds, setCreds] = useState<Credenciado[]>([]);
  const [form, setForm] = useState<FormCredenciado | null>(null);
  // o credenciado como estava ao abrir a edição: só o contador que mudar vai ao banco
  const [original, setOriginal] = useState<Credenciado | null>(null);
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

  function campo(k: "nome" | "prefixo_vertice", v: string) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  function abrirNovo() {
    setEditId(null);
    setOriginal(null);
    // nenhum número usado ainda: o primeiro vértice sai M-0001
    setForm({ nome: "", prefixo_vertice: "", ultimos: ultimosDe(null) });
    setErro(null);
  }

  function abrirEdicao(c: Credenciado) {
    setEditId(c.id);
    setOriginal(c);
    setForm({ nome: c.nome, prefixo_vertice: c.prefixo_vertice, ultimos: ultimosDe(c) });
    setErro(null);
  }

  function fechar() {
    setForm(null);
    setEditId(null);
    setOriginal(null);
  }

  // Os contadores continuam a numeração do Anexo A do credenciado: o gerador
  // aloca a partir deles, então mexer aqui reescreve a sequência dos vértices.
  // A tela mostra o ÚLTIMO número usado; o banco recebe último + 1.
  function contador(k: CampoContador, v: string) {
    const n = parseInt(v, 10);
    setForm((f) => (f ? { ...f, ultimos: { ...f.ultimos, [k]: Number.isFinite(n) && n >= 0 ? n : 0 } } : f));
  }

  async function salvar() {
    if (!form) return;
    const codigo = form.prefixo_vertice.trim().toUpperCase();
    if (!form.nome.trim()) { setErro("Informe o nome do credenciado."); return; }
    if (!/^[A-Z0-9]{2,8}$/.test(codigo)) { setErro("Código do credenciado: 2 a 8 letras ou números (ex.: DSBN)."); return; }
    setErro(null);
    const dados = {
      nome: form.nome.trim(), prefixo_vertice: codigo,
      ...contadoresParaGravar(editId ? original : null, form.ultimos),
    };
    const { error } = editId
      ? await supabase.from("credenciados").update(dados).eq("id", editId)
      : await supabase.from("credenciados").insert(dados);
    if (error) { setErro(error.message); return; }
    avisar("ok", editId ? "Credenciado atualizado." : "Credenciado cadastrado — já disponível nos serviços.");
    fechar();
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
    if (editId === c.id) fechar();
    await recarregar();
  }

  return (
    <section className="bloco">
      <header>
        <h3>Credenciados<Dica>o código prefixa todo vértice gerado (ex.: <code>DSBN-M-3605</code>); Último M/P/V é o último número já usado de cada tipo — a próxima geração continua do seguinte</Dica></h3>
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
            <thead><tr><th>Nome</th><th>Código</th><th className="col-sec">Último M</th><th className="col-sec">Último P</th><th className="col-sec">Último V</th>{pode && <th><span className="sr-only">Ações</span></th>}</tr></thead>
            <tbody>
              {creds.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.nome}</b></td>
                  <td className="mono">{c.prefixo_vertice}</td>
                  <td className="mono col-sec">{ultimoUsado(c.contador_m)}</td>
                  <td className="mono col-sec">{ultimoUsado(c.contador_p)}</td>
                  <td className="mono col-sec">{ultimoUsado(c.contador_v)}</td>
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
          <legend>{editId ? "Editando credenciado" : "Novo credenciado"}<Dica>
            A numeração do Anexo A continua daqui: informe o último número já usado por este credenciado
            em cada tipo (0 se ainda não usou nenhum — o primeiro vértice sai M-0001). Cada geração
            continua a sequência sozinha; só mexa aqui para acertá-la.
          </Dica></legend>
          <div className="grade">
            <label>Nome do credenciado *
              <input value={form.nome} onChange={(e) => campo("nome", e.target.value)} placeholder="ex.: JOSÉ DA SILVA" />
            </label>
            <label><Rotulo dica="prefixo dos vértices no SIGEF">Código do credenciado *</Rotulo>
              <input className="mono" value={form.prefixo_vertice} maxLength={8}
                onChange={(e) => campo("prefixo_vertice", e.target.value.toUpperCase())}
                placeholder="ex.: DSBN" />
            </label>
            <label>Último M usado
              <input className="mono" type="number" min={0} value={form.ultimos.contador_m}
                onChange={(e) => contador("contador_m", e.target.value)} />
            </label>
            <label>Último P usado
              <input className="mono" type="number" min={0} value={form.ultimos.contador_p}
                onChange={(e) => contador("contador_p", e.target.value)} />
            </label>
            <label>Último V usado
              <input className="mono" type="number" min={0} value={form.ultimos.contador_v}
                onChange={(e) => contador("contador_v", e.target.value)} />
            </label>
          </div>
          <div className="rodape-acoes">
            <button className="principal" onClick={salvar}>{editId ? "Salvar alterações" : "Cadastrar"}</button>
            <button className="fantasma" onClick={() => { fechar(); setErro(null); }}>Cancelar</button>
          </div>
        </fieldset>
      )}

      {erro && <div className="erro">{erro}</div>}
    </section>
  );
}
