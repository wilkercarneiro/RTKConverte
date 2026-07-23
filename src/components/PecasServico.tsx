// Serviço 2 — Peças técnicas direto do PDF do SIGEF (sem TXT).
// Fluxo: envia o PDF → o backend analisa e pré-preenche o cadastro → o
// operador completa cliente/RT e os descritivos dos confrontantes → gera as 7 peças.
import { useEffect, useState } from "react";
import { chamarFuncao, supabase } from "../lib/supabase";
import { TIPOS_LIMITE, UFS } from "../lib/domains";
import type { RT, Servico } from "../lib/types";
import { HistoricoDocs } from "./HistoricoDocs";

interface TrechoPdf { id?: string; codigo_inicio: string; descritivo: string; tipo_limite: string }
interface Analise {
  cabecalho: Record<string, string | null>;
  trechos: { codigo: string; confrontacao: string; segmentos: number }[];
  vertices: number;
}
interface PecasGeradas {
  arquivos: { titulo: string; url: string }[];
  resumo: { areaHa: string; perimetro: string; trt: string; vertices: number; cartas: number; via: string | null };
}

function bufParaBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function PecasServico({ servicoId, clienteId, onVoltar }: { servicoId: string | null; clienteId?: string; onVoltar: () => void }) {
  const [servico, setServico] = useState<Servico | null>(null);
  const [trechos, setTrechos] = useState<TrechoPdf[]>([]);
  const [rts, setRts] = useState<RT[]>([]);
  const [rtExtras, setRtExtras] = useState({ formacao: "", conselho_sigla: "CFTA", conselho_numero: "", identidade: "", cpf: "" });
  const [pdfB64, setPdfB64] = useState<string | null>(null);
  const [pdfNome, setPdfNome] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pecas, setPecas] = useState<PecasGeradas | null>(null);
  const [plantaUrl, setPlantaUrl] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("responsaveis_tecnicos").select().then(({ data }) => setRts((data as RT[]) ?? []));
    if (servicoId) {
      supabase.from("servicos").select().eq("id", servicoId).single().then(({ data }) => setServico(data as Servico));
      supabase.from("trechos_confrontantes").select().eq("servico_id", servicoId).order("vertice_inicio_ordem")
        .then(({ data }) => setTrechos(((data ?? []) as (TrechoPdf & { codigo_inicio: string | null })[])
          .map((t) => ({ id: (t as { id?: string }).id, codigo_inicio: t.codigo_inicio ?? "", descritivo: t.descritivo ?? "", tipo_limite: t.tipo_limite }))));
    }
  }, [servicoId]);

  const rtSel = rts.find((r) => r.id === servico?.rt_id) ?? null;
  useEffect(() => {
    if (rtSel) {
      setRtExtras({
        formacao: rtSel.formacao ?? "", conselho_sigla: rtSel.conselho_sigla ?? "CFTA",
        conselho_numero: rtSel.conselho_numero ?? "", identidade: rtSel.identidade ?? "", cpf: rtSel.cpf ?? "",
      });
    }
  }, [servico?.rt_id, rts.length]);

  function campo<K extends keyof Servico>(k: K, v: Servico[K]) {
    setServico((s) => (s ? { ...s, [k]: v } : s));
  }

  // ---- passo 1: analisar o PDF e criar o serviço pré-preenchido ----
  async function analisar(file: File) {
    setOcupado("Lendo o PDF do SIGEF…");
    setErro(null);
    try {
      const b64 = bufParaBase64(await file.arrayBuffer());
      const a = await chamarFuncao<Analise>("gerar-pecas", { pdf_base64: b64, modo: "analisar" });
      setPdfB64(b64);
      setPdfNome(file.name);
      const cab = a.cabecalho;
      const [muni, uf] = (cab.municipioUf ?? "-").split("-");
      // se veio da página do cliente, vincula e usa os dados dele como detentor
      let cli: { id: string; nome: string; cpf_cnpj: string | null; genero: string; endereco: string | null } | null = null;
      if (clienteId) {
        const { data: c } = await supabase.from("clientes").select().eq("id", clienteId).single();
        cli = c;
      }
      const { data: novo, error } = await supabase.from("servicos").insert({
        tipo: "pecas", status: "rascunho",
        cliente_id: cli?.id ?? null,
        denominacao: (cab.denominacao ?? "").replace(/\s*-\s*Parte \d+$/i, "") || null,
        detentor_nome: cli?.nome ?? (cab.proprietario || null),
        detentor_cpf: cli?.cpf_cnpj ?? (cab.cpf || null),
        detentor_genero: cli?.genero ?? "M",
        endereco_detentor: cli?.endereco ?? null,
        matricula: cab.matricula || null,
        cns: cab.cns || null,
        codigo_sncr: cab.sncr || null,
        municipio: muni || null,
        uf: (uf ?? "").trim() || null,
        nome_arquivo_txt: file.name,
      }).select().single();
      if (error) throw error;
      const linhas = a.trechos.map((t, i) => ({
        servico_id: novo.id, vertice_inicio_ordem: i, codigo_inicio: t.codigo,
        apelido_txt: null, descritivo: t.confrontacao, tipo_limite: /\\/.test(t.confrontacao) ? "LA1" : "LA3",
      }));
      await supabase.from("trechos_confrontantes").insert(linhas);
      setServico(novo as Servico);
      setTrechos(linhas.map((l) => ({ codigo_inicio: l.codigo_inicio, descritivo: l.descritivo, tipo_limite: l.tipo_limite })));
      setMsg(`PDF lido: ${a.vertices} vértices, ${a.trechos.length} confrontantes detectados. Complete os dados e revise os descritivos.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  async function salvar() {
    if (!servico) return;
    const { id, status, ...campos } = servico;
    const { error: e1 } = await supabase.from("servicos").update(campos).eq("id", id);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("trechos_confrontantes").delete().eq("servico_id", id);
    if (e2) throw e2;
    const { error: e3 } = await supabase.from("trechos_confrontantes").insert(trechos.map((t, i) => ({
      servico_id: id, vertice_inicio_ordem: i, codigo_inicio: t.codigo_inicio,
      descritivo: t.descritivo, tipo_limite: t.tipo_limite,
    })));
    if (e3) throw e3;
    if (servico.rt_id) await supabase.from("responsaveis_tecnicos").update(rtExtras).eq("id", servico.rt_id);
  }

  // ---- passo 2: gerar as peças ----
  async function gerar(fileNovo?: File) {
    if (!servico) return;
    setOcupado("Gerando as 7 peças técnicas…");
    setErro(null);
    setMsg(null);
    try {
      let b64 = pdfB64;
      if (fileNovo) { b64 = bufParaBase64(await fileNovo.arrayBuffer()); setPdfB64(b64); setPdfNome(fileNovo.name); }
      if (!b64) { setErro("Envie o PDF do SIGEF"); return; }
      await salvar();
      const r = await chamarFuncao<PecasGeradas>("gerar-pecas", { servico_id: servico.id, pdf_base64: b64 });
      setPecas(r);
      setMsg("Peças geradas com sucesso.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  async function gerarPlanta() {
    if (!servico) return;
    if (!pdfB64) { setErro("Envie o PDF do SIGEF para gerar a planta"); return; }
    setOcupado("Gerando a Planta A1…");
    setErro(null);
    try {
      await salvar();
      const r = await chamarFuncao<{ planta_pdf: string }>("gerar-planta", { servico_id: servico.id, pdf_base64: pdfB64 });
      setPlantaUrl(r.planta_pdf);
      setMsg("Planta A1 gerada.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  // ---------------- telas ----------------
  if (!servico) {
    return (
      <div className="upload-tela">
        <div className="stepper">
          <span className="step ativa"><span className="num">1</span> PDF do SIGEF</span>
          <span className="step-seta">→</span>
          <span className="step"><span className="num">2</span> Conferência</span>
          <span className="step-seta">→</span>
          <span className="step"><span className="num">3</span> Peças técnicas</span>
        </div>
        <div className="upload-card">
          <button className="fantasma" style={{ justifySelf: "start" }} onClick={onVoltar}>← Dashboard</button>
          <h2>Serviço 2 — Peças técnicas</h2>
          <p className="sub">Já tem o memorial do SIGEF em mãos? Envie o PDF de prévia/certificação:
            o sistema lê o imóvel, o proprietário e os confrontantes automaticamente.</p>
          <label className="dropzone" onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !ocupado) analisar(f); }}>
            {ocupado ? (<><span className="spinner" /> <b>{ocupado}</b></>) : (
              <><b>📄 Arraste o PDF do SIGEF aqui</b><span>ou clique para escolher o arquivo</span></>
            )}
            <input type="file" accept=".pdf" hidden disabled={!!ocupado}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) analisar(f); e.target.value = ""; }} />
          </label>
          {erro && <div className="erro">{erro}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="conferencia" style={{ paddingBottom: 40 }}>
      <div className="stepper">
        <span className="step feita"><span className="num">✓</span> PDF do SIGEF</span>
        <span className="step-seta">→</span>
        <span className="step ativa"><span className="num">2</span> Conferência</span>
        <span className="step-seta">→</span>
        <span className={`step ${pecas ? "ativa" : ""}`}><span className="num">3</span> Peças técnicas</span>
      </div>
      <header className="topo">
        <button className="fantasma" onClick={onVoltar}>← Dashboard</button>
        <span className="arquivo">📑 Serviço 2 · {servico.denominacao ?? "peças técnicas"}{pdfNome ? ` · ${pdfNome}` : ""}</span>
      </header>

      <section className="bloco">
        <header><span className="num-bloco">1</span><h3>Imóvel e requerentes</h3>
          <span className="desc">pré-preenchido pelo PDF — confira e complete</span></header>
        <div className="grade">
          <label>Denominação * <input value={servico.denominacao ?? ""} onChange={(e) => campo("denominacao", e.target.value)} /></label>
          <label>Município * <input value={servico.municipio ?? ""} onChange={(e) => campo("municipio", e.target.value)} /></label>
          <label>UF *
            <select value={servico.uf ?? ""} onChange={(e) => campo("uf", e.target.value)}>
              <option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </label>
          <label>Matrícula <input value={servico.matricula ?? ""} onChange={(e) => campo("matricula", e.target.value)} /></label>
          <label>CNS (cartório) <input value={servico.cns ?? ""} onChange={(e) => campo("cns", e.target.value)} /></label>
          <label>Código SNCR <input value={servico.codigo_sncr ?? ""} onChange={(e) => campo("codigo_sncr", e.target.value)} /></label>
          <label>Detentor * <input value={servico.detentor_nome ?? ""} onChange={(e) => campo("detentor_nome", e.target.value)} /></label>
          <label>CPF do detentor <input value={servico.detentor_cpf ?? ""} onChange={(e) => campo("detentor_cpf", e.target.value)} /></label>
          <label>Gênero do detentor
            <select value={servico.detentor_genero ?? "M"} onChange={(e) => campo("detentor_genero", e.target.value as "M" | "F")}>
              <option value="M">Masculino</option><option value="F">Feminino</option>
            </select>
          </label>
          <label>Requerente 2 (opcional) <input value={servico.requerente2_nome ?? ""} onChange={(e) => campo("requerente2_nome", e.target.value || null)} /></label>
          <label>CPF do requerente 2 <input value={servico.requerente2_cpf ?? ""} onChange={(e) => campo("requerente2_cpf", e.target.value || null)} /></label>
          <label>Gênero do requerente 2
            <select value={servico.requerente2_genero ?? "M"} onChange={(e) => campo("requerente2_genero", e.target.value as "M" | "F")}>
              <option value="M">Masculino</option><option value="F">Feminino</option>
            </select>
          </label>
          <label style={{ gridColumn: "span 2" }}>Endereço dos requerentes
            <input placeholder="Rua ..., Nº ..., Bairro, Cidade, Estado, CEP:..." value={servico.endereco_detentor ?? ""} onChange={(e) => campo("endereco_detentor", e.target.value || null)} /></label>
          <label>Área constante na matrícula (ha) <input placeholder="ex.: 86" value={servico.area_matricula_ha ?? ""} onChange={(e) => campo("area_matricula_ha", e.target.value || null)} /></label>
          <label>Via da faixa de domínio <input placeholder="ex.: BA 408" value={servico.via_dominio ?? ""} onChange={(e) => campo("via_dominio", e.target.value || null)} /></label>
          <label>Responsável Técnico *
            <select value={servico.rt_id ?? ""} onChange={(e) => campo("rt_id", e.target.value || null)}>
              <option value="">—</option>
              {rts.map((r) => <option key={r.id} value={r.id}>{r.nome}</option>)}
            </select>
          </label>
          <label>Formação do RT <input value={rtExtras.formacao} onChange={(e) => setRtExtras({ ...rtExtras, formacao: e.target.value })} /></label>
          <label>Conselho (sigla) <input value={rtExtras.conselho_sigla} onChange={(e) => setRtExtras({ ...rtExtras, conselho_sigla: e.target.value })} /></label>
          <label>Conselho (número) <input value={rtExtras.conselho_numero} onChange={(e) => setRtExtras({ ...rtExtras, conselho_numero: e.target.value })} /></label>
          <label>Identidade do RT <input value={rtExtras.identidade} onChange={(e) => setRtExtras({ ...rtExtras, identidade: e.target.value })} /></label>
          <label>CPF do RT <input value={rtExtras.cpf} onChange={(e) => setRtExtras({ ...rtExtras, cpf: e.target.value })} /></label>
        </div>
      </section>

      <section className="bloco">
        <header><span className="num-bloco">2</span><h3>Confrontantes</h3>
          <span className="desc">o PDF traz o texto truncado — complete o descritivo formal de cada trecho</span></header>
        {trechos.map((t, i) => (
          <div className="trecho" key={i} style={{ ["--cor-trecho" as string]: "#888" }}>
            <div className="linha">
              <label>Início no vértice <input className="mono" style={{ width: 140 }} value={t.codigo_inicio}
                onChange={(e) => setTrechos((ts) => ts.map((x, j) => (j === i ? { ...x, codigo_inicio: e.target.value } : x)))} /></label>
              <label>Tipo limite
                <select value={t.tipo_limite} onChange={(e) => setTrechos((ts) => ts.map((x, j) => (j === i ? { ...x, tipo_limite: e.target.value } : x)))}>
                  {TIPOS_LIMITE.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <span style={{ flex: 1 }} />
              <button className="remover" onClick={() => setTrechos((ts) => ts.filter((_, j) => j !== i))}>✕</button>
            </div>
            <textarea value={t.descritivo}
              placeholder={"Descritivo formal, ex.: (MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53"}
              onChange={(e) => setTrechos((ts) => ts.map((x, j) => (j === i ? { ...x, descritivo: e.target.value } : x)))} />
          </div>
        ))}
      </section>

      <section className="bloco">
        <header><span className="num-bloco">3</span><h3>Gerar peças técnicas</h3></header>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button disabled={!!ocupado} onClick={async () => { try { setErro(null); await salvar(); setMsg("Rascunho salvo."); } catch (e) { setErro(String(e)); } }}>Salvar rascunho</button>
          <button className="principal" disabled={!!ocupado} onClick={() => gerar()}>
            {ocupado ? "Gerando…" : "⚡ Gerar as 7 peças"}
          </button>
          <button disabled={!!ocupado} onClick={gerarPlanta}>🗺 Gerar Planta A1 (PDF)</button>
          {plantaUrl && (
            <a className="botao-download" href={plantaUrl} target="_blank" rel="noreferrer">
              <span className="ext">PDF</span> Planta A1
            </a>
          )}
          {!pdfB64 && (
            <label style={{ cursor: "pointer", color: "var(--primaria)" }}>
              📄 reenviar PDF do SIGEF
              <input type="file" accept=".pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) gerar(f); e.target.value = ""; }} />
            </label>
          )}
        </div>
        {erro && <div className="erro">{erro}</div>}
        {msg && !erro && <div className="ok">{msg}</div>}
        {pecas && (
          <div style={{ marginTop: 12 }}>
            <p style={{ color: "var(--texto-2)" }}>
              Área SGL {pecas.resumo.areaHa} ha · perímetro {pecas.resumo.perimetro} m · TRT {pecas.resumo.trt} ·{" "}
              {pecas.resumo.vertices} vértices · {pecas.resumo.cartas} carta(s){pecas.resumo.via ? ` · via ${pecas.resumo.via}` : ""}
            </p>
            <div className="downloads">
              {pecas.arquivos.map((a) => (
                <a key={a.titulo} className="botao-download" href={a.url} target="_blank" rel="noreferrer">
                  <span className="ext">DOCX</span> {a.titulo}
                </a>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="bloco">
        <header><h3>📁 Histórico de documentos deste serviço</h3></header>
        <HistoricoDocs servicoId={servico.id} />
      </section>
    </div>
  );
}
