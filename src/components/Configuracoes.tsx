// Configurações do sistema: logo da empresa (usada no carimbo da planta),
// dados de desenho e os cadastros de responsáveis técnicos e credenciados.
// A logo vai para templates/logo-empresa.png no Storage.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Cadastros } from "./Cadastros";
import { useAvisos } from "../lib/ux";
import { Avisos } from "./ui";
import { rotuloRT } from "../lib/domains";
import type { Credenciado, RT } from "../lib/types";

/** Chaves gravadas em config_empresa (key/value). `desenhista` é lida pela planta;
 *  `rt_padrao` e `credenciado_padrao` pré-preenchem serviços novos. */
const CHAVES = ["razao_social", "cnpj", "desenhista", "rt_padrao", "credenciado_padrao"] as const;
type Chave = typeof CHAVES[number];
type Config = Record<Chave, string>;
const VAZIA: Config = { razao_social: "", cnpj: "", desenhista: "", rt_padrao: "", credenciado_padrao: "" };

export function Configuracoes() {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [config, setConfig] = useState<Config>(VAZIA);
  const [rts, setRts] = useState<RT[]>([]);
  const [credenciados, setCredenciados] = useState<Credenciado[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { avisos, avisar, fechar } = useAvisos();

  async function carregarLogo() {
    const { data } = await supabase.storage.from("templates").createSignedUrl("logo-empresa.png", 600);
    if (data?.signedUrl) { setLogoUrl(data.signedUrl); return; }
    const jpg = await supabase.storage.from("templates").createSignedUrl("logo-empresa.jpg", 600);
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
      await supabase.storage.from("templates").remove([ehPng ? "logo-empresa.jpg" : "logo-empresa.png"]);
      const { error } = await supabase.storage.from("templates").upload(nome, file, { upsert: true, contentType: file.type });
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
    const { error } = await supabase.from("config_empresa").upsert(linhas, { onConflict: "key" });
    if (error) setErro(error.message);
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

      <Cadastros />
    </div>
  );
}
