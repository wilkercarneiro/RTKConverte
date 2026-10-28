// Configurações do sistema: logo da empresa (usada no carimbo da planta),
// dados de desenho e os cadastros de responsáveis técnicos e credenciados.
// A logo vai para templates/logo-empresa.png no Storage — ou, num escritório
// novo, para templates/escritorios/{id}/ (ver lib/escritorio.ts). Com
// escritórios, aparecem também a Equipe e os Modelos do escritório.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Cadastros } from "./Cadastros";
import { useAvisos } from "../lib/ux";
import { Avisos } from "./ui";
import { rotuloRT } from "../lib/domains";
import type { Credenciado, RT } from "../lib/types";
import {
  adicionarMembro, listarMembros, pastaDoEscritorio, removerMembro, salvarConfigEmpresa,
} from "../lib/escritorio";
import type { EstadoEscritorio, Membro } from "../lib/escritorio";
import { temRecurso } from "../lib/recursos";
import { TrocarSenhaCartao } from "./TrocarSenha";

/** Chaves gravadas em config_empresa (key/value). `desenhista` é lida pela planta;
 *  `rt_padrao` e `credenciado_padrao` pré-preenchem serviços novos. */
const CHAVES = ["razao_social", "cnpj", "desenhista", "rt_padrao", "credenciado_padrao"] as const;
type Chave = typeof CHAVES[number];
type Config = Record<Chave, string>;
const VAZIA: Config = { razao_social: "", cnpj: "", desenhista: "", rt_padrao: "", credenciado_padrao: "" };

export function Configuracoes({ escritorio = { estado: "legado" } }: { escritorio?: EstadoEscritorio }) {
  const pasta = pastaDoEscritorio(escritorio);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>(VAZIA);
  const [rts, setRts] = useState<RT[]>([]);
  const [credenciados, setCredenciados] = useState<Credenciado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { avisos, avisar, fechar } = useAvisos();

  async function carregarLogo() {
    const { data } = await supabase.storage.from("templates").createSignedUrl(`${pasta}logo-empresa.png`, 600);
    if (data?.signedUrl) { setLogoUrl(data.signedUrl); return; }
    const jpg = await supabase.storage.from("templates").createSignedUrl(`${pasta}logo-empresa.jpg`, 600);
    setLogoUrl(jpg.data?.signedUrl ?? null);
  }

  useEffect(() => {
    carregarLogo();
    supabase.from("config_empresa").select("key, value").in("key", [...CHAVES])
      .then(({ data }) => {
        const c = { ...VAZIA };
        for (const l of (data ?? []) as { key: Chave; value: string }[]) c[l.key] = l.value ?? "";
        setConfig(c);
      });
    supabase.from("responsaveis_tecnicos").select().order("nome").then(({ data }) => setRts((data as RT[]) ?? []));
    supabase.from("credenciados").select().order("nome").then(({ data }) => setCredenciados((data as Credenciado[]) ?? []));
  }, []);

  const campo = (k: Chave, v: string) => setConfig((c) => ({ ...c, [k]: v }));

  async function enviarLogo(file: File) {
    setOcupado(true);
    setErro(null);
    try {
      const ehPng = /png$/i.test(file.type) || /\.png$/i.test(file.name);
      const nome = ehPng ? "logo-empresa.png" : "logo-empresa.jpg";
      if (!ehPng && !/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) {
        setErro("Envie a logo em PNG ou JPG");
        return;
      }
      // remove a variante antiga p/ não sobrar png E jpg ao mesmo tempo
      await supabase.storage.from("templates").remove([`${pasta}${ehPng ? "logo-empresa.jpg" : "logo-empresa.png"}`]);
      const { error } = await supabase.storage.from("templates").upload(`${pasta}${nome}`, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      avisar("ok", "Logo atualizada — será usada automaticamente no carimbo das próximas plantas.");
      await carregarLogo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function salvarConfig() {
    setErro(null);
    const linhas = CHAVES.map((key) => ({ key, value: config[key] ?? "" }));
    const falha = await salvarConfigEmpresa(linhas);
    if (falha) setErro(falha);
    else avisar("ok", "Configurações salvas.");
  }

  return (
    <div className="pagina fade">
      <Avisos avisos={avisos} onFechar={fechar} />
      <div className="pagina-cabeca">
        <div>
          <h1>Configurações</h1>
          <p className="sub">Empresa, responsáveis técnicos e credenciados</p>
        </div>
      </div>

      <section className="bloco">
        <header>
          <h3>Empresa</h3>
          <span className="desc">identidade usada nos documentos gerados</span>
        </header>

        <div>
          <div className="titulo-campo">Carimbo da empresa (logo)</div>
          <p className="sub" style={{ margin: "2px 0 10px" }}>aparece no quadro "Carimbo da Empresa" de todas as plantas geradas (PNG ou JPG, fundo claro)</p>
          {logoUrl && (
            <div className="config-logo">
              <img src={logoUrl} alt="logo da empresa" />
            </div>
          )}
          <label className="dropzone linha"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !ocupado) enviarLogo(f); }}>
            {ocupado ? <><span className="spinner" /> Enviando…</> : <b>{logoUrl ? "Trocar logo" : "Enviar logo"} — arraste ou clique</b>}
            <input type="file" accept="image/png,image/jpeg" hidden disabled={ocupado}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarLogo(f); e.target.value = ""; }} />
          </label>
        </div>

        <div className="grade" style={{ marginTop: 18 }}>
          <label>Razão social
            <input value={config.razao_social} onChange={(e) => campo("razao_social", e.target.value)} placeholder="ex.: GEO TOPOGRAFIA LTDA" />
          </label>
          <label>CNPJ
            <input className="mono" value={config.cnpj} onChange={(e) => campo("cnpj", e.target.value)} placeholder="00.000.000/0001-00" />
          </label>
          <label>Desenhista (rodapé da planta)
            <input value={config.desenhista} onChange={(e) => campo("desenhista", e.target.value)} placeholder="ex.: JANETE OLIVEIRA" />
          </label>
          <label>Responsável técnico padrão
            <select value={config.rt_padrao} onChange={(e) => campo("rt_padrao", e.target.value)}>
              <option value="">—</option>
              {rts.map((r) => <option key={r.id} value={r.id}>{rotuloRT(r)}</option>)}
            </select>
            <small className="sub">já vem selecionado em todo serviço novo</small>
          </label>
          <label>Credenciado padrão
            <select value={config.credenciado_padrao} onChange={(e) => campo("credenciado_padrao", e.target.value)}>
              <option value="">—</option>
              {credenciados.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.prefixo_vertice})</option>)}
            </select>
            <small className="sub">já vem selecionado em todo serviço novo</small>
          </label>
        </div>
        <div className="rodape-bloco">
          <button className="principal" onClick={salvarConfig}>Salvar</button>
        </div>
        {erro && <div className="erro">{erro}</div>}
      </section>

      {escritorio.estado === "ok" && temRecurso("empresa.equipe") && <Equipe souDono={escritorio.escritorio.papel === "dono"} />}

      <TrocarSenhaCartao />

      <Cadastros />

      {escritorio.estado === "ok" && !escritorio.escritorio.modelos_compartilhados && <Modelos pasta={pasta} />}
    </div>
  );
}

/** Pessoas do escritório. Só o dono adiciona e remove (as RPCs conferem no banco). */
function Equipe({ souDono }: { souDono: boolean }) {
  const [membros, setMembros] = useState<Membro[]>([]);
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { avisos, avisar, fechar } = useAvisos();

  const recarregar = () => listarMembros().then(setMembros);
  useEffect(() => { recarregar(); }, []);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setOcupado(true);
    const falha = await adicionarMembro(email.trim());
    setOcupado(false);
    if (falha) { setErro(falha); return; }
    avisar("ok", `${email.trim()} agora faz parte do escritório.`);
    setEmail("");
    recarregar();
  }

  async function remover(m: Membro) {
    if (!confirm(`Tirar ${m.email} do escritório? A conta continua existindo, mas perde o acesso aos dados.`)) return;
    const falha = await removerMembro(m.user_id);
    if (falha) setErro(falha);
    else recarregar();
  }

  return (
    <section className="bloco">
      <Avisos avisos={avisos} onFechar={fechar} />
      <header>
        <h3>Equipe</h3>
        <span className="desc">quem acessa os dados deste escritório</span>
      </header>
      <div className="tabela-wrap">
        <table className="tabela-vertices">
          <thead><tr><th>E-mail</th><th>Papel</th><th /></tr></thead>
          <tbody>
            {membros.map((m) => (
              <tr key={m.user_id}>
                <td>{m.email}</td>
                <td>{m.papel === "dono" ? "Dono" : "Operador"}</td>
                <td className="acao">{souDono && m.papel !== "dono" && <button className="remover" onClick={() => remover(m)}>remover</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {souDono ? (
        <form className="grade" style={{ marginTop: 16, alignItems: "end" }} onSubmit={adicionar}>
          <label>Adicionar pessoa (e-mail de uma conta já criada)
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="colega@escritorio.com.br" />
            <small className="sub">a pessoa cria a conta em "Criar conta → Vou entrar na equipe" e confirma o e-mail</small>
          </label>
          <div><button className="principal" disabled={ocupado}>{ocupado ? "Adicionando…" : "Adicionar"}</button></div>
        </form>
      ) : (
        <p className="sub" style={{ marginTop: 12 }}>Só o dono do escritório adiciona ou remove pessoas.</p>
      )}
      {erro && <div className="erro">{erro}</div>}
    </section>
  );
}

/** Modelos DOCX/ODS que os documentos do escritório usam. Ver supabase/functions/_shared/modelos.ts. */
const MODELOS: { arquivo: string; titulo: string }[] = [
  { arquivo: "pecas/1-memorial-descritivo.docx", titulo: "Memorial descritivo (matrícula)" },
  { arquivo: "pecas/2-memorial-tabular.docx", titulo: "Memorial tabular (matrícula)" },
  { arquivo: "pecas/3-cartas-anuencia.docx", titulo: "Cartas de anuência (matrícula)" },
  { arquivo: "pecas/4-declaracao-tecnico.docx", titulo: "Declaração do técnico" },
  { arquivo: "pecas/5-declaracao-proprietario.docx", titulo: "Declaração do proprietário" },
  { arquivo: "pecas/6-requerimento.docx", titulo: "Requerimento" },
  { arquivo: "pecas/7-declaracao-faixa-dominio.docx", titulo: "Declaração de faixa de domínio (matrícula)" },
  { arquivo: "pecas-posse/1-memorial-descritivo.docx", titulo: "Memorial descritivo (posse)" },
  { arquivo: "pecas-posse/2-memorial-tabular.docx", titulo: "Memorial tabular (posse)" },
  { arquivo: "pecas-posse/3-cartas-anuencia.docx", titulo: "Cartas de anuência (posse)" },
  { arquivo: "pecas-posse/4-declaracao-faixa-dominio.docx", titulo: "Declaração de faixa de domínio (posse)" },
  { arquivo: "memorial-template.docx", titulo: "Timbre do memorial em partes/glebas" },
];

function Modelos({ pasta }: { pasta: string }) {
  const [existe, setExiste] = useState<Record<string, boolean>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function conferir() {
    const r: Record<string, boolean> = {};
    await Promise.all(MODELOS.map(async (m) => {
      const { data } = await supabase.storage.from("templates").createSignedUrl(`${pasta}${m.arquivo}`, 60);
      r[m.arquivo] = Boolean(data?.signedUrl);
    }));
    setExiste(r);
  }
  useEffect(() => { conferir(); }, [pasta]);

  async function enviar(arquivo: string, file: File) {
    setErro(null);
    if (!/\.docx$/i.test(file.name)) { setErro("Envie o modelo em DOCX (Word)."); return; }
    setEnviando(arquivo);
    const { error } = await supabase.storage.from("templates").upload(`${pasta}${arquivo}`, file, {
      upsert: true, contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    setEnviando(null);
    if (error) setErro(error.message);
    else conferir();
  }

  return (
    <section className="bloco">
      <header>
        <h3>Modelos do escritório</h3>
        <span className="desc">timbre e texto dos documentos gerados (DOCX)</span>
      </header>
      <p className="sub" style={{ margin: "0 0 12px" }}>
        Sem modelo próprio, o documento sai do modelo padrão do Vértice. Os campos do modelo seguem os mesmos marcadores do padrão — peça o pacote de modelos ao suporte para partir dele.
      </p>
      <div className="tabela-wrap">
        <table className="tabela-vertices">
          <thead><tr><th>Documento</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {MODELOS.map((m) => (
              <tr key={m.arquivo}>
                <td>{m.titulo}<div className="sub mono">{m.arquivo}</div></td>
                <td>{existe[m.arquivo] ? "modelo próprio" : "padrão do Vértice"}</td>
                <td className="acao">
                  <label className="botao-download" style={{ cursor: "pointer" }}>
                    {enviando === m.arquivo ? "Enviando…" : existe[m.arquivo] ? "Trocar" : "Enviar"}
                    <input type="file" hidden accept=".docx" disabled={!!enviando}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) enviar(m.arquivo, f); e.target.value = ""; }} />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {erro && <div className="erro">{erro}</div>}
    </section>
  );
}
