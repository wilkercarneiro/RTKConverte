// Serviço 2 — Peças técnicas direto do PDF do SIGEF (sem TXT).
// Fluxo: envia o PDF → o backend analisa e pré-preenche o cadastro → o
// operador completa cliente/RT e os descritivos dos confrontantes → gera as 7 peças.
//
// Experiência: o PDF já preencheu a maior parte, então só o que costuma faltar
// fica à vista; o restante vive em seções recolhíveis com selo de preenchimento.
import { useEffect, useState } from "react";
import { chamarFuncao, supabase } from "../lib/supabase";
import { rotuloRT, TIPOS_LIMITE, UFS } from "../lib/domains";
import { contarPreenchidos, useAutosave, useAvisos } from "../lib/ux";
import { ehViaPorLimite, viasDaPlanta } from "../lib/trechos";
import type { Cliente, Credenciado, RT, Servico } from "../lib/types";
import { HistoricoDocs } from "./HistoricoDocs";
import { Avisos, Passos, ProximaAcao, Secao, StatusSalvamento, irPara, type Acao, type Passo } from "./ui";

interface TrechoPdf { id?: string; codigo_inicio: string; descritivo: string; tipo_limite: string; eh_via: boolean }
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
  const [credenciados, setCredenciados] = useState<Credenciado[]>([]);
  const [rtExtras, setRtExtras] = useState({ formacao: "", conselho_sigla: "CFTA", conselho_numero: "", identidade: "", cpf: "" });
  const [pdfB64, setPdfB64] = useState<string | null>(null);
  const [pdfNome, setPdfNome] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pecas, setPecas] = useState<PecasGeradas | null>(null);
  const [plantaUrl, setPlantaUrl] = useState<string | null>(null);
  const [satelite, setSatelite] = useState<{ b64: string; tipo: "png" | "jpg"; nome: string } | null>(null);
  const { avisos, avisar, fechar } = useAvisos();

  useEffect(() => {
    supabase.from("responsaveis_tecnicos").select().order("nome").then(({ data }) => setRts((data as RT[]) ?? []));
    supabase.from("credenciados").select().order("nome").then(({ data }) => setCredenciados((data as Credenciado[]) ?? []));
    if (servicoId) {
      supabase.from("servicos").select().eq("id", servicoId).single().then(({ data }) => setServico(data as Servico));
      supabase.from("trechos_confrontantes").select().eq("servico_id", servicoId).order("vertice_inicio_ordem")
        .then(({ data }) => setTrechos(((data ?? []) as (TrechoPdf & { codigo_inicio: string | null })[])
          .map((t) => ({ id: (t as { id?: string }).id, codigo_inicio: t.codigo_inicio ?? "", descritivo: t.descritivo ?? "", tipo_limite: t.tipo_limite, eh_via: !!t.eh_via }))));
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

  // Preditivo: o TRT quase sempre é o do RT escolhido — nunca sobrescreve o
  // que já estiver digitado.
  useEffect(() => {
    if (rtSel?.trt && servico && !servico.trt) campo("trt", rtSel.trt);
  }, [rtSel?.id]);

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
      let cli: Cliente | null = null;
      if (clienteId) {
        const { data: c } = await supabase.from("clientes").select().eq("id", clienteId).single();
        cli = c as Cliente;
      }
      const { data: novo, error } = await supabase.from("servicos").insert({
        tipo: "pecas", status: "rascunho",
        cliente_id: cli?.id ?? null,
        tipo_imovel: cab.matricula ? "matricula" : "posse",
        denominacao: (cab.denominacao ?? "").replace(/\s*-\s*Parte \d+$/i, "") || null,
        detentor_nome: cli?.nome ?? (cab.proprietario || null),
        detentor_cpf: cli?.cpf_cnpj ?? (cab.cpf || null),
        detentor_genero: cli?.genero ?? "M",
        endereco_detentor: cli?.endereco ?? null,
        is_espolio: cli?.is_espolio ?? false,
        inventariante_nome: cli?.inventariante_nome ?? null,
        inventariante_cpf: cli?.inventariante_cpf ?? null,
        inventariante_rg: cli?.inventariante_rg ?? null,
        matricula: cab.matricula || null,
        cns: cab.cns || null,
        // TRT não vem do PDF: quem manda é o que se preenche no sistema
        // (campo do serviço ou TRT padrão do RT). Ver gerar-pecas/gerar-planta.
        trt: null,
        codigo_sncr: cab.sncr || null,
        municipio: muni || null,
        uf: (uf ?? "").trim() || null,
        nome_arquivo_txt: file.name,
      }).select().single();
      if (error) throw error;
      // Não inferir faixa de domínio pelo texto: era isso que marcava como estrada
      // todo confrontante sem CPF. O usuário marca no checkbox. Ver ARQUITETURA-TRECHOS.md.
      const linhas = a.trechos.map((t, i) => ({
        servico_id: novo.id, vertice_inicio_ordem: i, codigo_inicio: t.codigo,
        apelido_txt: null, descritivo: t.confrontacao, tipo_limite: "LA1", eh_via: false,
      }));
      await supabase.from("trechos_confrontantes").insert(linhas);
      setServico(novo as Servico);
      setTrechos(linhas.map((l) => ({ codigo_inicio: l.codigo_inicio, descritivo: l.descritivo, tipo_limite: l.tipo_limite, eh_via: l.eh_via })));
      avisar("ok", `PDF lido: ${a.vertices} vértices e ${a.trechos.length} confrontantes detectados. Complete os dados e revise os descritivos.`);
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
      descritivo: t.descritivo, tipo_limite: t.tipo_limite, eh_via: t.eh_via,
    })));
    if (e3) throw e3;
    if (servico.rt_id) await supabase.from("responsaveis_tecnicos").update(rtExtras).eq("id", servico.rt_id);
  }

  // Autossalvamento, suspenso enquanto uma rotina do servidor está no ar —
  // gerar/analisar gravam o serviço e uma escrita concorrente sobrescreveria.
  const auto = useAutosave(
    { servico, trechos, rtExtras },
    async () => { await salvar(); },
    { ativo: !ocupado && servico !== null, atraso: 1500 },
  );

  // ---- passo 2: gerar as peças ----
  async function gerar(fileNovo?: File) {
    if (!servico) return;
    setOcupado("Gerando as peças técnicas…");
    setErro(null);
    try {
      let b64 = pdfB64;
      if (fileNovo) { b64 = bufParaBase64(await fileNovo.arrayBuffer()); setPdfB64(b64); setPdfNome(fileNovo.name); }
      if (!b64) { setErro("Envie o PDF do SIGEF"); return; }
      await salvar();
      const r = await chamarFuncao<PecasGeradas>("gerar-pecas", { servico_id: servico.id, pdf_base64: b64 });
      setPecas(r);
      avisar("ok", "7 peças técnicas geradas.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  async function carregarSatelite(file: File) {
    const ehPng = /png$/i.test(file.type) || /\.png$/i.test(file.name);
    if (!ehPng && !/jpe?g$/i.test(file.type) && !/\.jpe?g$/i.test(file.name)) {
      setErro("Envie a imagem de satélite em PNG ou JPG");
      return;
    }
    setErro(null);
    setSatelite({ b64: bufParaBase64(await file.arrayBuffer()), tipo: ehPng ? "png" : "jpg", nome: file.name });
  }

  async function gerarPlanta() {
    if (!servico) return;
    if (!pdfB64) { setErro("Envie o PDF do SIGEF para gerar a planta"); return; }
    if (!satelite) { setErro("Envie a imagem de satélite para gerar a planta"); return; }
    setOcupado(`Gerando a Planta ${servico.tipo_imovel === "posse" ? "A3" : "A1"}…`);
    setErro(null);
    try {
      await salvar();
      const r = await chamarFuncao<{ planta_pdf: string }>("gerar-planta", {
        servico_id: servico.id, pdf_base64: pdfB64,
        satelite_base64: satelite.b64, satelite_tipo: satelite.tipo,
      });
      setPlantaUrl(r.planta_pdf);
      avisar("ok", `Planta ${servico.tipo_imovel === "posse" ? "A3" : "A1"} gerada.`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  // ---------------- tela de entrada: envio do PDF ----------------
  if (!servico) {
    return (
      <div className="upload-tela">
        <Avisos avisos={avisos} onFechar={fechar} />
        <Passos passos={[
          { rotulo: "PDF do SIGEF", estado: "ativa" },
          { rotulo: "Conferência", estado: "futura" },
          { rotulo: "Peças técnicas", estado: "futura" },
        ]} />
        <div className="upload-card">
          <button className="fantasma" style={{ justifySelf: "start" }} onClick={onVoltar}>← Dashboard</button>
          <h2>Serviço 2 — Peças técnicas</h2>
          <p className="sub">Já tem o memorial do SIGEF em mãos? Envie o PDF de prévia/certificação:
            o sistema lê o imóvel, o proprietário e os confrontantes automaticamente.</p>
          <label className="dropzone" onDragOver={(e) => e.preventDefault()}
            aria-busy={!!ocupado}
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

  // ---------------- conferência e geração ----------------
  const pendencias: { msg: string; alvo: string }[] = [];
  if (!servico.denominacao) pendencias.push({ msg: "informe a Denominação", alvo: "pc-denominacao" });
  if (!servico.municipio) pendencias.push({ msg: "informe o Município", alvo: "pc-municipio" });
  if (!servico.uf) pendencias.push({ msg: "informe a UF", alvo: "pc-uf" });
  if (!servico.detentor_nome) pendencias.push({ msg: "informe o Detentor", alvo: "pc-detentor" });
  if (!servico.rt_id) pendencias.push({ msg: "selecione o Responsável Técnico", alvo: "pc-rt" });

  const semDescritivo = trechos.filter((t) => !t.descritivo.trim()).length;
  // faixas de domínio: identificadas na planta (marca do trecho ou rótulo do
  // confrontante), uma declaração por via — não há campo para digitar
  const vias = viasDaPlanta(trechos);

  const passos: Passo[] = [
    { rotulo: "PDF do SIGEF", estado: "feita" },
    { rotulo: "Conferência", estado: pendencias.length === 0 ? "feita" : "ativa", alvo: "pc-dados" },
    { rotulo: "Peças técnicas", estado: pecas ? "feita" : pendencias.length === 0 ? "ativa" : "futura", alvo: "pc-gerar" },
  ];

  const proxima: Acao = pendencias.length > 0
    ? {
      tom: "pendente",
      titulo: `Faltam ${pendencias.length} ${pendencias.length === 1 ? "campo obrigatório" : "campos obrigatórios"}`,
      detalhe: pendencias.map((p) => p.msg).join(" · "),
      rotuloBotao: "Ir para o primeiro",
      onClick: () => irPara(pendencias[0].alvo, true),
    }
    : !pecas
      ? {
        tom: "neutro",
        titulo: "Pronto para gerar as 7 peças técnicas",
        detalhe: semDescritivo > 0
          ? `${semDescritivo} de ${trechos.length} confrontantes ainda sem descritivo formal`
          : `${trechos.length} confrontantes descritos`,
        rotuloBotao: "⚡ Gerar peças técnicas",
        onClick: () => gerar(),
      }
      : !plantaUrl
        ? {
          tom: "neutro",
          titulo: `Gere a Planta ${servico.tipo_imovel === "posse" ? "A3" : "A1"}`,
          detalhe: satelite ? `imagem ${satelite.nome} carregada` : "requer a imagem de satélite",
          rotuloBotao: "Ir para a planta",
          onClick: () => irPara("pc-gerar"),
        }
        : { tom: "pronto", titulo: "Serviço completo", detalhe: "peças e planta geradas — disponíveis no histórico abaixo" };

  const seloRegistro = contarPreenchidos([servico.matricula, servico.cns, servico.codigo_sncr, servico.area_matricula_ha]);
  const seloRt = contarPreenchidos([rtExtras.formacao, rtExtras.conselho_sigla, rtExtras.conselho_numero, rtExtras.identidade, rtExtras.cpf]);

  return (
    <div className="conferencia" style={{ paddingBottom: 40 }}>
      <Avisos avisos={avisos} onFechar={fechar} />
      <Passos passos={passos} />
      <header className="topo">
        <button className="fantasma" onClick={onVoltar}>← Dashboard</button>
        <span className="arquivo">📑 Serviço 2 · {servico.denominacao ?? "peças técnicas"}{pdfNome ? ` · ${pdfNome}` : ""}</span>
        <StatusSalvamento estado={auto.estado} horaSalvo={auto.horaSalvo} />
      </header>

      <ProximaAcao acao={proxima} />

      <section className="bloco" id="pc-dados">
        <header><span className="num-bloco">1</span><h3>Imóvel e requerentes</h3>
          <span className="desc">pré-preenchido pelo PDF — confira o essencial; o resto abre quando precisar</span></header>

        <div className="grade">
          <label>Situação do imóvel *
            <select value={servico.tipo_imovel ?? "matricula"} onChange={(e) => campo("tipo_imovel", e.target.value as "matricula" | "posse")}>
              <option value="matricula">Matrícula (proprietário)</option>
              <option value="posse">Posse (posseiro)</option>
            </select>
            <small className="sub">define planta A1 ou A3 e o conjunto de peças</small>
          </label>
          <label>Denominação * <input id="pc-denominacao" value={servico.denominacao ?? ""} onChange={(e) => campo("denominacao", e.target.value)} /></label>
          <label>Município * <input id="pc-municipio" value={servico.municipio ?? ""} onChange={(e) => campo("municipio", e.target.value)} /></label>
          <label>UF *
            <select id="pc-uf" value={servico.uf ?? ""} onChange={(e) => campo("uf", e.target.value)}>
              <option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </label>
          <label>Detentor * <input id="pc-detentor" value={servico.detentor_nome ?? ""} onChange={(e) => campo("detentor_nome", e.target.value)} /></label>
          <label>CPF do detentor <input value={servico.detentor_cpf ?? ""} onChange={(e) => campo("detentor_cpf", e.target.value)} /></label>
          <label>Responsável Técnico *
            <select id="pc-rt" value={servico.rt_id ?? ""} onChange={(e) => campo("rt_id", e.target.value || null)}>
              <option value="">—</option>
              {rts.map((r) => <option key={r.id} value={r.id}>{rotuloRT(r)}</option>)}
            </select>
            <small className="sub">cadastre novos em ⚙ Configurações</small>
          </label>
          <label style={{ gridColumn: "span 2" }}>Endereço dos requerentes
            <input placeholder="Rua ..., Nº ..., Bairro, Cidade, Estado, CEP:..." value={servico.endereco_detentor ?? ""} onChange={(e) => campo("endereco_detentor", e.target.value || null)} /></label>
        </div>

        <Secao titulo="Registro, cartório e área"
          selo={<span className={`secao-selo ${seloRegistro === 4 ? "completa" : seloRegistro === 0 ? "vazia" : ""}`}>{seloRegistro} de 4</span>}
          dica="o PDF costuma trazer matrícula, CNS e SNCR prontos">
          <div className="grade">
            <label>Matrícula <input value={servico.matricula ?? ""} onChange={(e) => campo("matricula", e.target.value)} /></label>
            <label>CNS (cartório) <input value={servico.cns ?? ""} onChange={(e) => campo("cns", e.target.value)} /></label>
            <label>Código SNCR <input value={servico.codigo_sncr ?? ""} onChange={(e) => campo("codigo_sncr", e.target.value)} /></label>
            <label>Área constante na matrícula (ha) <input placeholder="ex.: 86" value={servico.area_matricula_ha ?? ""} onChange={(e) => campo("area_matricula_ha", e.target.value || null)} /></label>
            <label style={{ gridColumn: "span 2" }}>Faixas de domínio (detectadas na planta)
              <input readOnly value={vias.length ? vias.join(" · ") : "nenhuma"} />
              <small className="sub">{vias.length
                ? `sai ${vias.length} ${vias.length > 1 ? "declarações" : "declaração"} de faixa de domínio, uma por via`
                : "sem estrada, corredor, linha férrea ou rodovia na confrontação — a declaração não é gerada"}</small>
            </label>
          </div>
        </Secao>

        <Secao titulo="Gênero e segundo requerente"
          selo={<span className={`secao-selo ${servico.requerente2_nome ? "completa" : ""}`}>{servico.requerente2_nome || "só o detentor"}</span>}
          abrirEm={!!servico.requerente2_nome}
          dica="usado na flexão dos textos e nas assinaturas">
          <div className="grade">
            <label>Gênero do detentor
              <select value={servico.detentor_genero ?? "M"} onChange={(e) => campo("detentor_genero", e.target.value as "M" | "F")}>
                <option value="M">Masculino</option><option value="F">Feminino</option>
              </select>
            </label>
            <label>Requerente 2 (opcional{servico.tipo_imovel === "posse" ? " — ignorado na posse" : ""})
              <input value={servico.requerente2_nome ?? ""} onChange={(e) => campo("requerente2_nome", e.target.value || null)} /></label>
            <label>CPF do requerente 2 <input value={servico.requerente2_cpf ?? ""} onChange={(e) => campo("requerente2_cpf", e.target.value || null)} /></label>
            <label>Gênero do requerente 2
              <select value={servico.requerente2_genero ?? "M"} onChange={(e) => campo("requerente2_genero", e.target.value as "M" | "F")}>
                <option value="M">Masculino</option><option value="F">Feminino</option>
              </select>
            </label>
          </div>
        </Secao>

        <Secao titulo="Espólio e inventariante"
          selo={<span className={`secao-selo ${servico.is_espolio ? "completa" : ""}`}>{servico.is_espolio ? "é espólio" : "não"}</span>}
          abrirEm={!!servico.is_espolio}
          dica="proprietário falecido, representado por inventariante">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 10 }}>
            <input type="checkbox" checked={!!servico.is_espolio} onChange={(e) => campo("is_espolio", e.target.checked)} />
            <b>É Espólio? (possuidor/proprietário falecido com inventariante)</b>
          </label>
          {servico.is_espolio && (
            <div className="grade">
              <label>Nome do Inventariante <input value={servico.inventariante_nome ?? ""} onChange={(e) => campo("inventariante_nome", e.target.value || null)} placeholder="Nome do inventariante" /></label>
              <label>CPF do Inventariante <input value={servico.inventariante_cpf ?? ""} onChange={(e) => campo("inventariante_cpf", e.target.value || null)} placeholder="000.000.000-00" /></label>
              <label>RG do Inventariante (opcional) <input value={servico.inventariante_rg ?? ""} onChange={(e) => campo("inventariante_rg", e.target.value || null)} placeholder="00.000.000-00" /></label>
            </div>
          )}
        </Secao>

        <Secao titulo="Credenciado, TRT e dados do RT nas peças"
          selo={<span className={`secao-selo ${seloRt === 5 ? "completa" : seloRt === 0 ? "vazia" : ""}`}>{seloRt} de 5</span>}
          abrirEm={seloRt < 4}
          dica={rtSel ? `salvo no cadastro de ${rtSel.nome}` : "selecione um RT acima"}>
          <div className="grade">
            <label>Credenciado
              <select value={servico.credenciado_id ?? ""} onChange={(e) => campo("credenciado_id", e.target.value || null)}>
                <option value="">—</option>
                {credenciados.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.prefixo_vertice})</option>)}
              </select>
              <small className="sub">o código vai no carimbo da planta</small>
            </label>
            <label>TRT (Termo de Responsabilidade Técnica)
              <input className="mono" placeholder="ex.: BR20250804764" value={servico.trt ?? ""}
                onChange={(e) => campo("trt", e.target.value.trim() || null)} />
              <small className="sub">
                {rtSel?.trt && servico.trt === rtSel.trt
                  ? `preenchido com o TRT padrão de ${rtSel.nome}`
                  : "vai nas peças e na planta; sobrepõe o TRT do PDF do SIGEF"}
              </small>
            </label>
            <label>Formação do RT <input value={rtExtras.formacao} onChange={(e) => setRtExtras({ ...rtExtras, formacao: e.target.value })} /></label>
            <label>Conselho (sigla) <input value={rtExtras.conselho_sigla} onChange={(e) => setRtExtras({ ...rtExtras, conselho_sigla: e.target.value })} /></label>
            <label>Conselho (número) <input value={rtExtras.conselho_numero} onChange={(e) => setRtExtras({ ...rtExtras, conselho_numero: e.target.value })} /></label>
            <label>Identidade do RT <input value={rtExtras.identidade} onChange={(e) => setRtExtras({ ...rtExtras, identidade: e.target.value })} /></label>
            <label>CPF do RT <input value={rtExtras.cpf} onChange={(e) => setRtExtras({ ...rtExtras, cpf: e.target.value })} /></label>
          </div>
        </Secao>
      </section>

      <section className="bloco">
        <header><span className="num-bloco">2</span><h3>Confrontantes</h3>
          <span className="desc">
            {trechos.length} trecho(s){semDescritivo > 0 ? ` · ${semDescritivo} sem descritivo formal` : " · todos descritos"} — o PDF traz o texto truncado
          </span></header>
        {trechos.map((t, i) => (
          <div className="trecho" key={i} style={{ ["--cor-trecho" as string]: t.descritivo.trim() ? "#12b76a" : "#b54708" }}>
            <div className="linha">
              <label>Início no vértice <input className="mono" style={{ width: 140 }} value={t.codigo_inicio}
                onChange={(e) => setTrechos((ts) => ts.map((x, j) => (j === i ? { ...x, codigo_inicio: e.target.value } : x)))} /></label>
              <label>Tipo limite
                <select value={t.tipo_limite} onChange={(e) => setTrechos((ts) => ts.map((x, j) => (j === i ? { ...x, tipo_limite: e.target.value } : x)))}>
                  {TIPOS_LIMITE.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <label title={ehViaPorLimite(t.tipo_limite)
                ? "LA3 é limite de faixa de domínio: sempre via"
                : "Estrada, rodovia, corredor, linha férrea, rio — desenhada na planta como linha dupla vermelha"}>
                <input type="checkbox" checked={t.eh_via || ehViaPorLimite(t.tipo_limite)}
                  disabled={ehViaPorLimite(t.tipo_limite)}
                  onChange={(e) => setTrechos((ts) => ts.map((x, j) => (j === i ? { ...x, eh_via: e.target.checked } : x)))} />
                {" "}faixa de domínio pública{ehViaPorLimite(t.tipo_limite) ? " (LA3)" : ""}
              </label>
              <span style={{ flex: 1 }} />
              <button className="remover" title="Remover trecho" onClick={() => setTrechos((ts) => ts.filter((_, j) => j !== i))}>✕</button>
            </div>
            <textarea value={t.descritivo} className={t.descritivo.trim() ? "" : "pendente"}
              placeholder={"Descritivo formal, ex.: (MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53"}
              onChange={(e) => setTrechos((ts) => ts.map((x, j) => (j === i ? { ...x, descritivo: e.target.value } : x)))} />
          </div>
        ))}
      </section>

      <section className="bloco" id="pc-gerar">
        <header><span className="num-bloco">3</span><h3>Gerar peças e planta</h3></header>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <button disabled={!!ocupado} onClick={async () => {
            try { setErro(null); await salvar(); avisar("ok", "Rascunho salvo."); } catch (e) { setErro(String(e)); }
          }}>Salvar rascunho</button>
          <button className="principal" disabled={!!ocupado} onClick={() => gerar()}>
            {ocupado ? ocupado : "⚡ Gerar peças técnicas"}
          </button>
          {!pdfB64 && (
            <label style={{ cursor: "pointer", color: "var(--primaria)" }}>
              📄 reenviar PDF do SIGEF
              <input type="file" accept=".pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) gerar(f); e.target.value = ""; }} />
            </label>
          )}
        </div>

        {/* A planta depende da imagem de satélite: separada das peças para não
            parecer que o botão ao lado faz a mesma coisa. */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 14, paddingTop: 14, borderTop: "1px dashed var(--borda)" }}>
          <label className="dropzone" style={{ padding: "12px 16px", flex: "1 1 260px" }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) carregarSatelite(f); }}>
            {satelite
              ? <b>🛰 {satelite.nome}</b>
              : <><b>🛰 Imagem de satélite (PNG/JPG)</b><span>obrigatória para a planta</span></>}
            <input type="file" accept="image/png,image/jpeg" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) carregarSatelite(f); e.target.value = ""; }} />
          </label>
          <button disabled={!!ocupado || !satelite} onClick={gerarPlanta}
            title={!satelite ? "Envie a imagem de satélite primeiro" : undefined}>
            🗺 Gerar Planta {servico.tipo_imovel === "posse" ? "A3" : "A1"} (PDF)
          </button>
          {plantaUrl && (
            <a className="botao-download" href={plantaUrl} target="_blank" rel="noreferrer">
              <span className="ext">PDF</span> Planta {servico.tipo_imovel === "posse" ? "A3" : "A1"}
            </a>
          )}
        </div>

        {erro && <div className="erro">{erro}</div>}
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
