// Configurações do sistema, em abas: Empresa (logo usada no carimbo da planta,
// dados de desenho e padrões), Responsáveis e credenciados, Modelos do
// escritório e Minha senha. A logo vai para templates/logo-empresa.png no
// Storage — ou, num escritório novo, para templates/escritorios/{id}/ (ver
// lib/escritorio.ts). A Equipe tem página própria.
//
// Sem a permissão `empresa.configurar`, Empresa e Modelos aparecem só para
// leitura (o banco também recusa a gravação).
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Cadastros } from "./Cadastros";
import { guardar, lembrar } from "../lib/ux";
import { Abas, avisar, CabecalhoPagina, Dica, EstadoErro, Esqueleto, Rotulo } from "./ui";
import { rotuloRT } from "../lib/domains";
import type { Credenciado, RT } from "../lib/types";
import { pastaDoEscritorio, salvarConfigEmpresa } from "../lib/escritorio";
import type { EstadoEscritorio } from "../lib/escritorio";
import { temPermissao } from "../lib/permissoes";
import { TrocarSenhaCartao } from "./TrocarSenha";

/** Chaves gravadas em config_empresa (key/value). `desenhista` é lida pela planta;
 *  `rt_padrao` e `credenciado_padrao` pré-preenchem serviços novos. */
const CHAVES = ["razao_social", "cnpj", "desenhista", "rt_padrao", "credenciado_padrao"] as const;
type Chave = typeof CHAVES[number];
type Config = Record<Chave, string>;
const VAZIA: Config = { razao_social: "", cnpj: "", desenhista: "", rt_padrao: "", credenciado_padrao: "" };

type Aba = "empresa" | "cadastros" | "modelos" | "senha";
const SEM_PERMISSAO = "Só quem tem a permissão \"Dados da empresa\" altera isto.";

/** A aba vem do endereço (`/app/?aba=modelos#/configuracoes`) ou da última visita. */
function abaInicial(validas: Aba[]): Aba {
  let pedida: string | null = null;
  try { pedida = new URLSearchParams(location.search).get("aba"); } catch { /* sem URL */ }
  const escolha = (pedida ?? lembrar("config.aba")) as Aba | null;
  return escolha && validas.includes(escolha) ? escolha : "empresa";
}

export function Configuracoes({ escritorio = { estado: "legado" } }: { escritorio?: EstadoEscritorio }) {
  const temModelos = escritorio.estado === "ok" && !escritorio.escritorio.modelos_compartilhados;
  const abas: { chave: Aba; rotulo: string }[] = [
    { chave: "empresa", rotulo: "Empresa" },
    { chave: "cadastros", rotulo: "Responsáveis e credenciados" },
    ...(temModelos ? [{ chave: "modelos" as const, rotulo: "Modelos" }] : []),
    { chave: "senha", rotulo: "Minha senha" },
  ];
  const [aba, setAba] = useState<Aba>(() => abaInicial(abas.map((a) => a.chave)));
  const pasta = pastaDoEscritorio(escritorio);

  function trocar(a: Aba) {
    setAba(a);
    guardar("config.aba", a);
  }

  return (
    <div className="pagina fade">
      <CabecalhoPagina olho="Sistema" titulo="Configurações"
        descricao="Identidade da empresa, quem assina os serviços, modelos dos documentos e a sua senha" />
      <Abas rotulo="Seções das configurações" abas={abas} ativa={aba} onTrocar={trocar} />
      <div role="tabpanel" aria-label={abas.find((a) => a.chave === aba)?.rotulo} className="painel-aba">
        {aba === "empresa" && <Empresa pasta={pasta} />}
        {aba === "cadastros" && <Cadastros />}
        {aba === "modelos" && temModelos && <Modelos pasta={pasta} />}
        {aba === "senha" && <TrocarSenhaCartao />}
      </div>
    </div>
  );
}

function Empresa({ pasta }: { pasta: string }) {
  const pode = temPermissao("empresa.configurar");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>(VAZIA);
  const [rts, setRts] = useState<RT[]>([]);
  const [credenciados, setCredenciados] = useState<Credenciado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [falha, setFalha] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function carregarLogo() {
    const { data } = await supabase.storage.from("templates").createSignedUrl(`${pasta}logo-empresa.png`, 600);
    if (data?.signedUrl) { setLogoUrl(data.signedUrl); return; }
    const jpg = await supabase.storage.from("templates").createSignedUrl(`${pasta}logo-empresa.jpg`, 600);
    setLogoUrl(jpg.data?.signedUrl ?? null);
  }

  async function carregar() {
    setCarregando(true);
    setFalha(null);
    carregarLogo();
    const [cfg, r, c] = await Promise.all([
      supabase.from("config_empresa").select("key, value").in("key", [...CHAVES]),
      supabase.from("responsaveis_tecnicos").select().order("nome"),
      supabase.from("credenciados").select().order("nome"),
    ]);
    if (cfg.error) { setFalha(cfg.error.message); setCarregando(false); return; }
    const nova = { ...VAZIA };
    for (const l of (cfg.data ?? []) as { key: Chave; value: string }[]) nova[l.key] = l.value ?? "";
    setConfig(nova);
    setRts((r.data as RT[]) ?? []);
    setCredenciados((c.data as Credenciado[]) ?? []);
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

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

  async function salvarConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!pode) return;
    setErro(null);
    setSalvando(true);
    const linhas = CHAVES.map((key) => ({ key, value: config[key] ?? "" }));
    const falhou = await salvarConfigEmpresa(linhas);
    setSalvando(false);
    if (falhou) setErro(falhou);
    else avisar("ok", "Configurações salvas.");
  }

  if (falha) return <section className="bloco"><EstadoErro mensagem={falha} onTentar={carregar} titulo="Não foi possível carregar os dados da empresa" /></section>;
  if (carregando) return <section className="bloco"><Esqueleto linhas={4} rotulo="Carregando os dados da empresa…" /></section>;

  return (
    <section className="bloco">
      <header>
        <h3>Empresa<Dica>identidade usada nos documentos gerados</Dica></h3>
      </header>

      {!pode && <p className="modo-leitura">Modo leitura. {SEM_PERMISSAO}</p>}

      <div className="config-logo-area">
        <div className="titulo-campo">Carimbo da empresa (logo)<Dica>aparece no quadro "Carimbo da Empresa" de todas as plantas geradas (PNG ou JPG, fundo claro)</Dica></div>
        {logoUrl ? (
          <div className="config-logo"><img src={logoUrl} alt="Logo da empresa" /></div>
        ) : !pode && <p className="sub">Nenhuma logo enviada.</p>}
        {pode && (
          <label className="dropzone linha"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !ocupado) enviarLogo(f); }}>
            {ocupado ? <><span className="spinner" /> Enviando…</> : <b>{logoUrl ? "Trocar logo" : "Enviar logo"} — arraste ou clique</b>}
            <input type="file" accept="image/png,image/jpeg" hidden disabled={ocupado}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarLogo(f); e.target.value = ""; }} />
          </label>
        )}
      </div>

      <form onSubmit={salvarConfig}>
        <fieldset className="sem-borda" disabled={!pode}>
          <div className="grade config-grade">
            <label>Razão social
              <input value={config.razao_social} onChange={(e) => campo("razao_social", e.target.value)} placeholder="ex.: GEO TOPOGRAFIA LTDA" />
            </label>
            <label>CNPJ
              <input className="mono" value={config.cnpj} onChange={(e) => campo("cnpj", e.target.value)} placeholder="00.000.000/0001-00" />
            </label>
            <label>Desenhista (rodapé da planta)
              <input value={config.desenhista} onChange={(e) => campo("desenhista", e.target.value)} placeholder="ex.: JANETE OLIVEIRA" />
            </label>
            <label><Rotulo dica="já vem selecionado em todo serviço novo">Responsável técnico padrão</Rotulo>
              <select value={config.rt_padrao} onChange={(e) => campo("rt_padrao", e.target.value)}>
                <option value="">—</option>
                {rts.map((r) => <option key={r.id} value={r.id}>{rotuloRT(r)}</option>)}
              </select>
            </label>
            <label><Rotulo dica="já vem selecionado em todo serviço novo">Credenciado padrão</Rotulo>
              <select value={config.credenciado_padrao} onChange={(e) => campo("credenciado_padrao", e.target.value)}>
                <option value="">—</option>
                {credenciados.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.prefixo_vertice})</option>)}
              </select>
            </label>
          </div>
        </fieldset>
        {pode && (
          <div className="rodape-bloco">
            <button type="submit" className="principal" disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</button>
          </div>
        )}
      </form>
      {erro && <div className="erro" role="alert">{erro}</div>}
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
  const pode = temPermissao("empresa.configurar");
  const [existe, setExiste] = useState<Record<string, boolean> | null>(null);
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
    else { avisar("ok", "Modelo enviado — vale para os próximos documentos."); conferir(); }
  }

  const proprios = existe ? MODELOS.filter((m) => existe[m.arquivo]).length : 0;

  return (
    <section className="bloco">
      <header>
        <h3>Modelos do escritório<Dica>
          Timbre e texto dos documentos gerados (DOCX). Sem modelo próprio, o documento sai do modelo padrão do Vertces.
          Os campos do modelo seguem os mesmos marcadores do padrão — peça o pacote de modelos ao suporte para partir dele.
        </Dica></h3>
        {existe && <span className="desc">{proprios} de {MODELOS.length} próprios</span>}
      </header>
      {!pode && <p className="modo-leitura">Modo leitura. {SEM_PERMISSAO}</p>}
      <div className="tabela-wrap">
        {!existe ? <Esqueleto linhas={5} rotulo="Conferindo os modelos…" /> : (
          <table className="tabela-vertices">
            <thead><tr><th>Documento</th><th>Situação</th>{pode && <th><span className="sr-only">Ações</span></th>}</tr></thead>
            <tbody>
              {MODELOS.map((m) => (
                <tr key={m.arquivo}>
                  <td>{m.titulo}<div className="sub mono col-sec">{m.arquivo}</div></td>
                  <td>{existe[m.arquivo] ? <span className="chip mod-completo">próprio</span> : <span className="sub">padrão do Vertces</span>}</td>
                  {pode && (
                    <td className="acao">
                      <label className="botao-download botao-arquivo">
                        {enviando === m.arquivo ? "Enviando…" : existe[m.arquivo] ? "Trocar" : "Enviar"}
                        <input type="file" hidden accept=".docx" disabled={!!enviando}
                          aria-label={`Enviar modelo: ${m.titulo}`}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) enviar(m.arquivo, f); e.target.value = ""; }} />
                      </label>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {erro && <div className="erro" role="alert">{erro}</div>}
    </section>
  );
}
