// Configurações do sistema: logo da empresa (usada no carimbo da planta) e
// dados de desenho. A logo vai para templates/logo-empresa.png no Storage.
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function Configuracoes({ onVoltar }: { onVoltar: () => void }) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [desenhista, setDesenhista] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function carregarLogo() {
    const { data } = await supabase.storage.from("templates").createSignedUrl("logo-empresa.png", 600);
    if (data?.signedUrl) { setLogoUrl(data.signedUrl); return; }
    const jpg = await supabase.storage.from("templates").createSignedUrl("logo-empresa.jpg", 600);
    setLogoUrl(jpg.data?.signedUrl ?? null);
  }

  useEffect(() => {
    carregarLogo();
    supabase.from("config_empresa").select("value").eq("key", "desenhista").maybeSingle()
      .then(({ data }) => setDesenhista(data?.value ?? ""));
  }, []);

  async function enviarLogo(file: File) {
    setOcupado(true);
    setErro(null);
    setMsg(null);
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
      setMsg("Logo atualizada — será usada automaticamente no carimbo das próximas plantas.");
      await carregarLogo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function salvarDesenhista() {
    setErro(null);
    const { error } = await supabase.from("config_empresa").upsert({ key: "desenhista", value: desenhista });
    if (error) setErro(error.message);
    else setMsg("Configurações salvas.");
  }

  return (
    <div className="upload-tela">
      <div className="upload-card">
        <button className="fantasma" style={{ justifySelf: "start" }} onClick={onVoltar}>← Dashboard</button>
        <h2>⚙ Configurações</h2>
        <p className="sub">Identidade da empresa usada nos documentos gerados.</p>

        <div>
          <b>Logo da empresa</b>
          <p className="sub" style={{ margin: "2px 0 8px" }}>aparece no "Carimbo da Empresa" da planta (PNG ou JPG, fundo claro)</p>
          {logoUrl && (
            <div style={{ border: "1px solid var(--borda)", borderRadius: 10, padding: 14, marginBottom: 10, textAlign: "center", background: "#fff" }}>
              <img src={logoUrl} alt="logo da empresa" style={{ maxHeight: 90, maxWidth: "80%" }} />
            </div>
          )}
          <label className="dropzone" style={{ padding: "22px 16px" }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !ocupado) enviarLogo(f); }}>
            {ocupado ? <><span className="spinner" /> Enviando…</> : <b>{logoUrl ? "Trocar logo" : "Enviar logo"} — arraste ou clique</b>}
            <input type="file" accept="image/png,image/jpeg" hidden disabled={ocupado}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarLogo(f); e.target.value = ""; }} />
          </label>
        </div>

        <label>Desenhista (rodapé da planta)
          <input value={desenhista} onChange={(e) => setDesenhista(e.target.value)} placeholder="ex.: JANETE OLIVEIRA" />
        </label>
        <button className="principal" style={{ justifySelf: "start" }} onClick={salvarDesenhista}>Salvar</button>
        {erro && <div className="erro">{erro}</div>}
        {msg && !erro && <div className="ok">{msg}</div>}
      </div>
    </div>
  );
}
