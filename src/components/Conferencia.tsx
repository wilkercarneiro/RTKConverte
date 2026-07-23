// Tela de conferência (5.2): Bloco 1 dados do serviço, Bloco 2 confrontantes
// (+ mapa SVG), Bloco 3 vértices, e preview fixo no rodapé. O banco é a fonte
// da verdade; "Gerar documentos" salva e chama a Edge Function gerar-documentos.
import { useEffect, useMemo, useState } from "react";
import { chamarFuncao, supabase } from "../lib/supabase";
import {
  LADOS, METODOS_POSICIONAMENTO, NATUREZAS_AREA, NATUREZAS_SERVICO,
  SITUACOES, TIPOS_LIMITE, TIPOS_PESSOA, UFS,
} from "../lib/domains";
import { calcularPreviewLocal } from "../lib/preview";
import type { Cliente, Credenciado, RT, Servico, Trecho, Vertice } from "../lib/types";
import type { ResultadoParse } from "./Upload";
import { CORES, MapaSVG } from "./MapaSVG";
import { HistoricoDocs } from "./HistoricoDocs";

interface Gerado {
  memorial_docx: string;
  planilha_ods: string;
  resumo: { areaHa: number; perimetroM: number; qtdM: number; qtdP: number; qtdV: number; verticeInicial: string };
}

interface PecasGeradas {
  arquivos: { titulo: string; url: string }[];
  resumo: { areaHa: string; perimetro: string; trt: string; vertices: number; cartas: number; via: string | null };
}

function bufParaBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function Conferencia({ inicial, onVoltar }: { inicial: ResultadoParse; onVoltar: () => void }) {
  const [servico, setServico] = useState<Servico>(inicial.servico);
  const [vertices, setVertices] = useState<Vertice[]>(inicial.vertices);
  const [trechos, setTrechos] = useState<Trecho[]>(inicial.trechos);
  const [credenciados, setCredenciados] = useState<Credenciado[]>([]);
  const [rts, setRts] = useState<RT[]>([]);
  const [detentores, setDetentores] = useState<{ nome: string; cpf: string }[]>([]);
  const [cartorios, setCartorios] = useState<string[]>([]);
  const [novoV, setNovoV] = useState({ aposOrdem: "", codigo: "", lat: "", lon: "", h: "", sigmaH: "0,02" });
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerado, setGerado] = useState<Gerado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [rtExtras, setRtExtras] = useState({ formacao: "", conselho_sigla: "CFTA", conselho_numero: "", identidade: "", cpf: "" });
  const [pecas, setPecas] = useState<PecasGeradas | null>(null);
  const [gerandoPecas, setGerandoPecas] = useState(false);
  const [erroPecas, setErroPecas] = useState<string | null>(null);
  const [plantaUrl, setPlantaUrl] = useState<string | null>(null);
  const [gerandoPlanta, setGerandoPlanta] = useState(false);

  const [clientes, setClientes] = useState<Cliente[]>([]);

  useEffect(() => {
    supabase.from("credenciados").select().then(({ data }) => setCredenciados(data ?? []));
    supabase.from("responsaveis_tecnicos").select().then(({ data }) => setRts(data ?? []));
    supabase.from("clientes").select().order("nome").then(({ data }) => setClientes((data as Cliente[]) ?? []));
    // autocomplete a partir de serviços anteriores
    supabase.from("servicos").select("detentor_nome, detentor_cpf, cns").neq("id", inicial.servico.id)
      .then(({ data }) => {
        const ds = new Map<string, string>();
        const cs = new Set<string>();
        for (const s of data ?? []) {
          if (s.detentor_nome) ds.set(s.detentor_nome, s.detentor_cpf ?? "");
          if (s.cns) cs.add(s.cns);
        }
        setDetentores([...ds.entries()].map(([nome, cpf]) => ({ nome, cpf })));
        setCartorios([...cs]);
      });
  }, [inicial.servico.id]);

  const credenciado = credenciados.find((c) => c.id === servico.credenciado_id) ?? null;
  const rtSel = rts.find((r) => r.id === servico.rt_id) ?? null;

  // carrega extras do RT quando o RT selecionado muda
  useEffect(() => {
    if (rtSel) {
      setRtExtras({
        formacao: rtSel.formacao ?? "", conselho_sigla: rtSel.conselho_sigla ?? "CFTA",
        conselho_numero: rtSel.conselho_numero ?? "", identidade: rtSel.identidade ?? "", cpf: rtSel.cpf ?? "",
      });
    }
  }, [servico.rt_id, rts.length]);
  const verticeInicial = servico.vertice_inicial ?? 0;
  const trechosOrdenados = useMemo(
    () => [...trechos].sort((a, b) => a.vertice_inicio_ordem - b.vertice_inicio_ordem),
    [trechos],
  );

  const preview = useMemo(
    () => calcularPreviewLocal(servico.fuso_utm ?? 24, vertices, trechos, verticeInicial, credenciado),
    [servico.fuso_utm, vertices, trechos, verticeInicial, credenciado],
  );

  const pendencias = useMemo(() => {
    const p: { msg: string; alvo: string }[] = [];
    if (!servico.credenciado_id) p.push({ msg: "selecione o Credenciado", alvo: "campo-credenciado" });
    if (!servico.detentor_nome) p.push({ msg: "informe o Detentor", alvo: "campo-detentor" });
    if (!servico.denominacao) p.push({ msg: "informe a Denominação", alvo: "campo-denominacao" });
    if (!servico.municipio) p.push({ msg: "informe o Município", alvo: "campo-municipio" });
    if (!servico.uf) p.push({ msg: "informe a UF", alvo: "campo-uf" });
    // confrontantes (descritivo/apelido) são opcionais — sem eles o memorial
    // segue sem a cláusula "confrontando com a propriedade de"
    return p;
  }, [servico]);

  const [tentouGerar, setTentouGerar] = useState(false);

  function irParaPendencia(alvo: string) {
    const el = document.getElementById(alvo);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.add("flash");
    setTimeout(() => el?.classList.remove("flash"), 1600);
  }

  // destaca campo obrigatório vazio depois de uma tentativa de geração
  const obg = (v: string | null) => (tentouGerar && !v ? "campo-pendente" : "");

  function campo<K extends keyof Servico>(k: K, v: Servico[K]) {
    setServico((s) => ({ ...s, [k]: v }));
  }

  // ------- Bloco 2: trechos -------
  function setTrecho(t: Trecho, patch: Partial<Trecho>) {
    setTrechos((ts) => ts.map((x) => (x === t ? { ...x, ...patch } : x)));
  }
  function addTrecho(ordem: number) {
    if (trechos.some((t) => t.vertice_inicio_ordem === ordem)) return;
    setTrechos((ts) => [...ts, {
      servico_id: servico.id, vertice_inicio_ordem: ordem, apelido_txt: "",
      descritivo: "", tipo_limite: "LA1", cns: null, matricula: null,
    }]);
    setVertices((vs) => vs.map((v) => (v.ordem === ordem && v.tipo === "P" ? { ...v, tipo: "M" } : v)));
  }
  function removeTrecho(t: Trecho) {
    setTrechos((ts) => ts.filter((x) => x !== t));
    setVertices((vs) => vs.map((v) => (v.ordem === t.vertice_inicio_ordem && v.tipo === "M" ? { ...v, tipo: "P" } : v)));
  }

  // ------- Bloco 3: vértices -------
  function setVertice(ordem: number, patch: Partial<Vertice>) {
    setVertices((vs) => vs.map((v) => (v.ordem === ordem ? { ...v, ...patch } : v)));
  }
  function inserirV() {
    const apos = Number(novoV.aposOrdem);
    if (!novoV.codigo || !novoV.lat || !novoV.lon || Number.isNaN(apos) || novoV.aposOrdem === "") {
      setErro("Preencha posição, código e coordenadas do vértice V");
      return;
    }
    setErro(null);
    setVertices((vs) => {
      const desloc = vs.map((v) => (v.ordem > apos ? { ...v, ordem: v.ordem + 1 } : v));
      return [...desloc, {
        servico_id: servico.id, ordem: apos + 1, num_txt: null, rotulo_txt: null,
        e: null, n: null, h: Number(novoV.h.replace(",", ".")) || 0,
        sigma_pos: 0, sigma_h: Number(novoV.sigmaH.replace(",", ".")) || 0,
        tipo: "V" as const, codigo: novoV.codigo, metodo: "PA1", inserido_manual: true,
        lat_gms: novoV.lat, lon_gms: novoV.lon,
      }].sort((a, b) => a.ordem - b.ordem);
    });
    setTrechos((ts) => ts.map((t) => (t.vertice_inicio_ordem > apos ? { ...t, vertice_inicio_ordem: t.vertice_inicio_ordem + 1 } : t)));
    if (verticeInicial > apos) campo("vertice_inicial", verticeInicial + 1);
    setNovoV({ aposOrdem: "", codigo: "", lat: "", lon: "", h: "", sigmaH: "0,02" });
    setMsg("Vértice V inserido.");
  }
  function removerV(ordem: number) {
    setVertices((vs) => vs.filter((v) => v.ordem !== ordem).map((v) => (v.ordem > ordem ? { ...v, ordem: v.ordem - 1 } : v)));
    setTrechos((ts) => ts.map((t) => (t.vertice_inicio_ordem > ordem ? { ...t, vertice_inicio_ordem: t.vertice_inicio_ordem - 1 } : t)));
    if (verticeInicial > ordem) campo("vertice_inicial", verticeInicial - 1);
  }

  // ------- persistência -------
  async function salvar(): Promise<void> {
    const { id, status, ...campos } = servico;
    const { error: e1 } = await supabase.from("servicos").update(campos).eq("id", id);
    if (e1) throw e1;
    const { error: e2 } = await supabase.from("vertices").delete().eq("servico_id", id);
    if (e2) throw e2;
    const { error: e3 } = await supabase.from("vertices").insert(vertices.map(({ id: _vid, ...v }) => v));
    if (e3) throw e3;
    const { error: e4 } = await supabase.from("trechos_confrontantes").delete().eq("servico_id", id);
    if (e4) throw e4;
    const { error: e5 } = await supabase.from("trechos_confrontantes").insert(trechos.map(({ id: _tid, ...t }) => t));
    if (e5) throw e5;
    if (servico.rt_id) {
      await supabase.from("responsaveis_tecnicos").update(rtExtras).eq("id", servico.rt_id);
    }
  }

  // ------- planta A1 -------
  async function gerarPlanta() {
    setGerandoPlanta(true);
    setErro(null);
    try {
      await salvar();
      const r = await chamarFuncao<{ planta_pdf: string }>("gerar-planta", { servico_id: servico.id });
      setPlantaUrl(r.planta_pdf);
      setMsg("Planta A1 gerada.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setGerandoPlanta(false);
    }
  }

  // ------- peças técnicas -------
  async function gerarPecas(file: File) {
    setGerandoPecas(true);
    setErroPecas(null);
    try {
      await salvar();
      const pdf_base64 = bufParaBase64(await file.arrayBuffer());
      const r = await chamarFuncao<PecasGeradas>("gerar-pecas", { servico_id: servico.id, pdf_base64 });
      setPecas(r);
    } catch (e) {
      setErroPecas(e instanceof Error ? e.message : String(e));
    } finally {
      setGerandoPecas(false);
    }
  }

  async function gerar() {
    if (pendencias.length > 0) {
      setTentouGerar(true);
      setErro(`Para gerar, resolva:\n• ${pendencias.map((p) => p.msg).join("\n• ")}`);
      irParaPendencia(pendencias[0].alvo);
      return;
    }
    setOcupado(true);
    setErro(null);
    setMsg(null);
    try {
      await salvar();
      const r = await chamarFuncao<Gerado>("gerar-documentos", { servico_id: servico.id });
      setGerado(r);
      setMsg("Documentos gerados com sucesso.");
      const { data } = await supabase.from("vertices").select().eq("servico_id", servico.id).order("ordem");
      if (data) setVertices(data as Vertice[]);
      requestAnimationFrame(() => document.querySelector(".gerados")?.scrollIntoView({ behavior: "smooth", block: "center" }));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  async function apenasSalvar() {
    setOcupado(true);
    setErro(null);
    try {
      await salvar();
      setMsg("Rascunho salvo.");
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  const sel = (valor: string | null, opcoes: string[], set: (v: string) => void) => (
    <select value={valor ?? ""} onChange={(e) => set(e.target.value)}>
      <option value="">—</option>
      {opcoes.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
  const nomePonto = (v: Vertice) => v.num_txt ?? v.codigo ?? `V(${v.ordem})`;
  const corDoTrecho = (t: Trecho) => CORES[trechosOrdenados.indexOf(t) % CORES.length];

  return (
    <div className="conferencia">
      <div className="stepper">
        <span className="step feita"><span className="num">✓</span> Upload</span>
        <span className="step-seta">→</span>
        <span className="step ativa"><span className="num">2</span> Conferência</span>
        <span className="step-seta">→</span>
        <span className={`step ${gerado ? "ativa" : ""}`}><span className="num">3</span> Documentos</span>
      </div>

      <header className="topo">
        <button className="fantasma" onClick={onVoltar}>← Dashboard</button>
        <span className="arquivo">📄 {servico.nome_arquivo_txt}</span>
        <span className="esticar" />
        <label>Fuso UTM{" "}
          <select value={servico.fuso_utm ?? 24} onChange={(e) => campo("fuso_utm", Number(e.target.value))}>
            {[18, 19, 20, 21, 22, 23, 24, 25].map((z) => (
              <option key={z} value={z}>{z}S{inicial.preview.candidatos.includes(z) ? " •" : ""}</option>
            ))}
          </select>
        </label>
        {inicial.preview.fusoAmbiguo && <em className="alerta">fuso ambíguo — confirme pelo município</em>}
        {inicial.preview.foraDaUf && <em className="alerta">coordenadas fora da UF informada!</em>}
      </header>

      {/* ---------------- Bloco 1: dados do serviço ---------------- */}
      <section className="bloco">
        <header>
          <span className="num-bloco">1</span>
          <h3>Dados do serviço</h3>
          <span className="desc">identificação SIGEF do detentor e da área</span>
        </header>
        <div className="grade">
          <label>Cliente
            <select value={servico.cliente_id ?? ""} onChange={(e) => {
              const cli = clientes.find((c) => c.id === e.target.value) ?? null;
              setServico((s) => ({
                ...s,
                cliente_id: cli?.id ?? null,
                ...(cli ? {
                  detentor_nome: cli.nome, detentor_cpf: cli.cpf_cnpj,
                  detentor_genero: cli.genero, endereco_detentor: cli.endereco,
                } : {}),
              }));
            }}>
              <option value="">— (sem vínculo)</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </label>
          <label>Credenciado *
            <select id="campo-credenciado" className={obg(servico.credenciado_id)}
              value={servico.credenciado_id ?? ""} onChange={(e) => campo("credenciado_id", e.target.value || null)}>
              <option value="">—</option>
              {credenciados.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.prefixo_vertice})</option>)}
            </select>
          </label>
          <label>Responsável Técnico
            <select value={servico.rt_id ?? ""} onChange={(e) => campo("rt_id", e.target.value || null)}>
              <option value="">—</option>
              {rts.map((r) => <option key={r.id} value={r.id}>{r.nome} — CREA {r.crea}</option>)}
            </select>
          </label>
          <label>Natureza do serviço {sel(servico.natureza_servico, NATUREZAS_SERVICO, (v) => campo("natureza_servico", v))}</label>
          <label>Tipo pessoa {sel(servico.tipo_pessoa, TIPOS_PESSOA, (v) => campo("tipo_pessoa", v))}</label>
          <label>Detentor *
            <input id="campo-detentor" className={obg(servico.detentor_nome)} list="detentores" value={servico.detentor_nome ?? ""} onChange={(e) => {
              campo("detentor_nome", e.target.value);
              const d = detentores.find((x) => x.nome === e.target.value);
              if (d?.cpf) campo("detentor_cpf", d.cpf);
            }} />
            <datalist id="detentores">{detentores.map((d) => <option key={d.nome} value={d.nome} />)}</datalist>
          </label>
          <label>CPF/CNPJ <input value={servico.detentor_cpf ?? ""} onChange={(e) => campo("detentor_cpf", e.target.value)} /></label>
          <label>Denominação * <input id="campo-denominacao" className={obg(servico.denominacao)} value={servico.denominacao ?? ""} onChange={(e) => campo("denominacao", e.target.value)} /></label>
          <label>Situação {sel(servico.situacao, SITUACOES, (v) => campo("situacao", v))}</label>
          <label>Natureza da área {sel(servico.natureza_area, NATUREZAS_AREA, (v) => campo("natureza_area", v))}</label>
          <label>Código SNCR <input value={servico.codigo_sncr ?? ""} onChange={(e) => campo("codigo_sncr", e.target.value)} /></label>
          <label>CNS (cartório)
            <input list="cartorios" value={servico.cns ?? ""} onChange={(e) => campo("cns", e.target.value)} />
            <datalist id="cartorios">{cartorios.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label>Matrícula <input value={servico.matricula ?? ""} onChange={(e) => campo("matricula", e.target.value)} /></label>
          <label>Município * <input id="campo-municipio" className={obg(servico.municipio)} value={servico.municipio ?? ""} onChange={(e) => campo("municipio", e.target.value)} /></label>
          <label>UF *
            <select id="campo-uf" className={obg(servico.uf)} value={servico.uf ?? ""} onChange={(e) => campo("uf", e.target.value)}>
              <option value="">—</option>
              {UFS.map((u) => <option key={u}>{u}</option>)}
            </select>
          </label>
          <label>Denominação da parcela <input value={servico.denominacao_parcela ?? ""} placeholder="Parte 1" onChange={(e) => campo("denominacao_parcela", e.target.value)} /></label>
          <label>Parcela número <input value={servico.parcela_numero ?? ""} placeholder="001" onChange={(e) => campo("parcela_numero", e.target.value)} /></label>
          <label>Lado {sel(servico.lado, LADOS, (v) => campo("lado", v))}</label>
        </div>
      </section>

      {/* ---------------- Bloco 2: confrontantes ---------------- */}
      <section className="bloco" id="bloco-confrontantes">
        <header>
          <span className="num-bloco">2</span>
          <h3>Confrontantes</h3>
          <span className="desc">trechos detectados pelos rótulos do TXT — apelidos editáveis; cores correspondem ao mapa</span>
        </header>
        <div className="confrontantes">
          <div className="trechos">
            {trechosOrdenados.map((t) => {
              const v = vertices.find((x) => x.ordem === t.vertice_inicio_ordem);
              return (
                <div className="trecho" key={`t-${t.vertice_inicio_ordem}`}
                  style={{ ["--cor-trecho" as string]: corDoTrecho(t) }}>
                  <div className="linha">
                    <label>Ponto inicial
                      <select value={t.vertice_inicio_ordem}
                        onChange={(e) => setTrecho(t, { vertice_inicio_ordem: Number(e.target.value) })}>
                        {vertices.map((x) => <option key={x.ordem} value={x.ordem}>{nomePonto(x)}</option>)}
                      </select>
                    </label>
                    <label>Apelido
                      <input value={t.apelido_txt ?? ""} placeholder="ex.: Varguim Serra"
                        style={{ width: 150 }}
                        onChange={(e) => setTrecho(t, { apelido_txt: e.target.value || null })} />
                    </label>
                    <label>Tipo limite
                      <select value={t.tipo_limite} onChange={(e) => setTrecho(t, { tipo_limite: e.target.value })}>
                        {TIPOS_LIMITE.map((l) => <option key={l}>{l}</option>)}
                      </select>
                    </label>
                    <label>CNS <input style={{ width: 110 }} value={t.cns ?? ""} onChange={(e) => setTrecho(t, { cns: e.target.value || null })} /></label>
                    <label>Matrícula <input style={{ width: 100 }} value={t.matricula ?? ""} onChange={(e) => setTrecho(t, { matricula: e.target.value || null })} /></label>
                    <span style={{ flex: 1 }} />
                    <button className="remover" title="Remover trecho" onClick={() => removeTrecho(t)}>✕ remover</button>
                  </div>
                  <textarea
                    placeholder={"Descritivo formal (opcional), ex.: (MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53"}
                    value={t.descritivo} onChange={(e) => setTrecho(t, { descritivo: e.target.value })} />
                  {!t.descritivo && <div className="pendencia" style={{ color: "var(--texto-2)" }}>descritivo vazio — o memorial usará o apelido {t.apelido_txt ? `"${t.apelido_txt}"` : "(vazio: segue sem cláusula de confrontação)"} · inicia no pt {v ? nomePonto(v) : "?"}</div>}
                </div>
              );
            })}
            <div className="add-trecho">
              <span>Nova transição de confrontante no ponto</span>
              <select id="novo-trecho-ordem" defaultValue="">
                <option value="" disabled>—</option>
                {vertices.filter((v) => !trechos.some((t) => t.vertice_inicio_ordem === v.ordem))
                  .map((v) => <option key={v.ordem} value={v.ordem}>{nomePonto(v)}</option>)}
              </select>
              <button onClick={() => {
                const el = document.getElementById("novo-trecho-ordem") as HTMLSelectElement;
                if (el.value !== "") { addTrecho(Number(el.value)); el.value = ""; }
              }}>+ adicionar transição</button>
            </div>
          </div>
          <div className="mapa">
            <MapaSVG vertices={vertices} trechos={trechos} verticeInicial={verticeInicial} />
            <div className="legenda">
              {trechosOrdenados.map((t) => (
                <span className="item" key={`leg-${t.vertice_inicio_ordem}`}>
                  <span className="ponto-cor" style={{ background: corDoTrecho(t) }} />
                  {t.apelido_txt || `pt ${nomePonto(vertices.find((v) => v.ordem === t.vertice_inicio_ordem) ?? vertices[0])}`}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Bloco 3: vértices ---------------- */}
      <section className="bloco">
        <header>
          <span className="num-bloco">3</span>
          <h3>Vértices</h3>
          <span className="desc">códigos definitivos são alocados dos contadores do credenciado na geração</span>
        </header>
        <div className="acoes-vertices">
          <label>Vértice inicial do memorial:{" "}
            <select value={verticeInicial} onChange={(e) => campo("vertice_inicial", Number(e.target.value))}>
              {vertices.filter((v) => v.tipo === "M").map((v) => (
                <option key={v.ordem} value={v.ordem}>{nomePonto(v)}</option>
              ))}
            </select>
          </label>
          <fieldset className="inserir-v">
            <legend>Inserir vértice pré-existente (tipo V · método PA1)</legend>
            <label>após o ponto
              <select value={novoV.aposOrdem} onChange={(e) => setNovoV({ ...novoV, aposOrdem: e.target.value })}>
                <option value="">—</option>
                {vertices.map((v) => <option key={v.ordem} value={v.ordem}>{nomePonto(v)}</option>)}
              </select>
            </label>
            <label>código
              <input placeholder="DSBN-V-0758" value={novoV.codigo} onChange={(e) => setNovoV({ ...novoV, codigo: e.target.value })} />
            </label>
            <label>latitude GMS
              <input placeholder="11 24 30,375 S" value={novoV.lat} onChange={(e) => setNovoV({ ...novoV, lat: e.target.value })} />
            </label>
            <label>longitude GMS
              <input placeholder="39 4 47,198 W" value={novoV.lon} onChange={(e) => setNovoV({ ...novoV, lon: e.target.value })} />
            </label>
            <label>h (m)
              <input placeholder="289,765" style={{ width: 100 }} value={novoV.h} onChange={(e) => setNovoV({ ...novoV, h: e.target.value })} />
            </label>
            <label>sigma h
              <input style={{ width: 80 }} value={novoV.sigmaH} onChange={(e) => setNovoV({ ...novoV, sigmaH: e.target.value })} />
            </label>
            <button onClick={inserirV}>+ inserir</button>
          </fieldset>
        </div>
        <div className="tabela-wrap">
          <table className="tabela-vertices">
            <thead>
              <tr><th>nº TXT</th><th>código</th><th>tipo</th><th>método</th><th>latitude</th><th>longitude</th><th>h (m)</th><th></th></tr>
            </thead>
            <tbody>
              {vertices.map((v) => (
                <tr key={v.ordem} className={v.ordem === verticeInicial ? "inicial" : ""}>
                  <td>{v.num_txt ?? "—"}{v.rotulo_txt ? ` · ${v.rotulo_txt}` : ""}{v.ordem === verticeInicial ? " ★" : ""}</td>
                  <td className="mono">{v.codigo ?? <span style={{ color: "var(--texto-2)" }}>na geração</span>}</td>
                  <td>
                    {v.inserido_manual ? <span className="chip V">V</span> : (
                      <select value={v.tipo} onChange={(e) => setVertice(v.ordem, { tipo: e.target.value as Vertice["tipo"] })}>
                        <option>M</option><option>P</option><option>V</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <select value={v.metodo} onChange={(e) => setVertice(v.ordem, { metodo: e.target.value })}>
                      {METODOS_POSICIONAMENTO.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </td>
                  <td className="mono">{v.lat_gms}</td>
                  <td className="mono">{v.lon_gms}</td>
                  <td className="mono">{String(v.h).replace(".", ",")}</td>
                  <td>{v.inserido_manual && <button className="remover" title="Remover vértice inserido" onClick={() => removerV(v.ordem)}>✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {gerado && (
        <section className="bloco gerados">
          <header>
            <span className="num-bloco">✓</span>
            <h3>Documentos gerados</h3>
            <span className="desc">regeração ilimitada — os arquivos são sobrescritos a cada geração</span>
          </header>
          <div className="downloads">
            <a className="botao-download" href={gerado.memorial_docx} target="_blank" rel="noreferrer">
              <span className="ext">DOCX</span> Memorial Descritivo GEO
            </a>
            <a className="botao-download" href={gerado.planilha_ods} target="_blank" rel="noreferrer">
              <span className="ext">ODS</span> Planilha SIGEF
            </a>
            {plantaUrl ? (
              <a className="botao-download" href={plantaUrl} target="_blank" rel="noreferrer">
                <span className="ext">PDF</span> Planta A1
              </a>
            ) : (
              <button disabled={gerandoPlanta} onClick={gerarPlanta}>
                {gerandoPlanta ? "Gerando planta…" : "🗺 Gerar Planta A1 (PDF)"}
              </button>
            )}
          </div>
          <p style={{ color: "var(--texto-2)" }}>
            Vértice inicial {gerado.resumo.verticeInicial} · M/P/V: {gerado.resumo.qtdM}/{gerado.resumo.qtdP}/{gerado.resumo.qtdV}
          </p>
        </section>
      )}

      {/* ---------------- Bloco 4: peças técnicas ---------------- */}
      <section className="bloco" id="bloco-pecas">
        <header>
          <span className="num-bloco">4</span>
          <h3>Peças técnicas</h3>
          <span className="desc">envie o PDF de prévia do SIGEF e gere as peças (memorial, tabular, cartas, declarações, requerimento)</span>
        </header>
        <div className="grade" style={{ marginBottom: 12 }}>
          <label>Situação do imóvel
            <select value={servico.tipo_imovel ?? "matricula"} onChange={(e) => campo("tipo_imovel", e.target.value as "matricula" | "posse")}>
              <option value="matricula">Matrícula (proprietário)</option>
              <option value="posse">Posse (posseiro)</option>
            </select>
          </label>
          <label>Gênero do detentor
            <select value={servico.detentor_genero ?? "M"} onChange={(e) => campo("detentor_genero", e.target.value as "M" | "F")}>
              <option value="M">Masculino</option><option value="F">Feminino</option>
            </select>
          </label>
          <label>RG do detentor (opcional)
            <input value={servico.detentor_rg ?? ""} onChange={(e) => campo("detentor_rg", e.target.value || null)} />
          </label>
          <label>Requerente 2 (opcional)
            <input value={servico.requerente2_nome ?? ""} onChange={(e) => campo("requerente2_nome", e.target.value || null)} />
          </label>
          <label>CPF do requerente 2
            <input value={servico.requerente2_cpf ?? ""} onChange={(e) => campo("requerente2_cpf", e.target.value || null)} />
          </label>
          <label>Gênero do requerente 2
            <select value={servico.requerente2_genero ?? "M"} onChange={(e) => campo("requerente2_genero", e.target.value as "M" | "F")}>
              <option value="M">Masculino</option><option value="F">Feminino</option>
            </select>
          </label>
          <label style={{ gridColumn: "span 2" }}>Endereço dos requerentes
            <input placeholder="Rua ..., Nº ..., Bairro, Cidade, Estado, CEP:..." value={servico.endereco_detentor ?? ""} onChange={(e) => campo("endereco_detentor", e.target.value || null)} />
          </label>
          <label>Área constante na matrícula (ha)
            <input placeholder="ex.: 86" value={servico.area_matricula_ha ?? ""} onChange={(e) => campo("area_matricula_ha", e.target.value || null)} />
          </label>
          <label>Via da faixa de domínio
            <input placeholder="ex.: BA 408" value={servico.via_dominio ?? ""} onChange={(e) => campo("via_dominio", e.target.value || null)} />
          </label>
          <label>Formação do RT
            <input placeholder="Técnico em Agropecuária" value={rtExtras.formacao} onChange={(e) => setRtExtras({ ...rtExtras, formacao: e.target.value })} />
          </label>
          <label>Conselho (sigla)
            <input placeholder="CFTA / CREA" value={rtExtras.conselho_sigla} onChange={(e) => setRtExtras({ ...rtExtras, conselho_sigla: e.target.value })} />
          </label>
          <label>Conselho (número)
            <input placeholder="0578839458-9" value={rtExtras.conselho_numero} onChange={(e) => setRtExtras({ ...rtExtras, conselho_numero: e.target.value })} />
          </label>
          <label>Identidade do RT
            <input placeholder="00.000.000-00 SSP/BA" value={rtExtras.identidade} onChange={(e) => setRtExtras({ ...rtExtras, identidade: e.target.value })} />
          </label>
          <label>CPF do RT
            <input value={rtExtras.cpf} onChange={(e) => setRtExtras({ ...rtExtras, cpf: e.target.value })} />
          </label>
        </div>
        <label className="dropzone dropzone-pdf" style={{ padding: "26px 20px" }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !gerandoPecas) gerarPecas(f); }}>
          {gerandoPecas ? (
            <><span className="spinner" /> <b>Gerando as 7 peças técnicas…</b><span>lendo o PDF do SIGEF e preenchendo os modelos</span></>
          ) : (
            <><b>📄 Arraste ou clique para enviar o PDF de prévia do SIGEF</b>
              <span>os dados acima + o memorial gerado + o PDF viram as 7 peças prontas</span></>
          )}
          <input type="file" accept=".pdf" hidden disabled={gerandoPecas}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) gerarPecas(f); e.target.value = ""; }} />
        </label>
        {erroPecas && <div className="erro">{erroPecas}</div>}
        {pecas && (
          <div className="gerados" style={{ border: "none", background: "transparent", padding: "12px 0 0" }}>
            <p style={{ color: "var(--texto-2)", margin: "4px 0 8px" }}>
              Área SGL {pecas.resumo.areaHa} ha · perímetro {pecas.resumo.perimetro} m · TRT {pecas.resumo.trt} ·{" "}
              {pecas.resumo.vertices} vértices · {pecas.resumo.cartas} carta(s) de anuência{pecas.resumo.via ? ` · via ${pecas.resumo.via}` : ""}
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

      {/* ---------------- Histórico de documentos ---------------- */}
      <section className="bloco">
        <header><h3>📁 Histórico de documentos deste serviço</h3>
          <span className="desc">cada geração vira uma versão preservada — baixe qualquer uma a qualquer momento</span></header>
        <HistoricoDocs servicoId={servico.id} />
      </section>

      {/* ---------------- Preview (rodapé fixo) ---------------- */}
      <footer className="preview">
        <div className="stats">
          <span className="stat"><span className="rotulo">Fuso</span><span className="valor">{servico.fuso_utm}S · MC-{Math.abs(6 * (servico.fuso_utm ?? 24) - 183)}°W</span></span>
          <span className="stat"><span className="rotulo">Área</span><span className="valor">{preview.areaHa} ha</span></span>
          <span className="stat"><span className="rotulo">Perímetro</span><span className="valor">{preview.perimetroM} m</span></span>
          <span className="stat"><span className="rotulo">M / P / V</span><span className="valor">{preview.qtdM} / {preview.qtdP} / {preview.qtdV}</span></span>
          <span className="acoes">
            <button disabled={ocupado} onClick={apenasSalvar}>Salvar rascunho</button>
            <button disabled={ocupado} className="principal" onClick={gerar}
              title={pendencias.length ? `Pendências: ${pendencias.map((p) => p.msg).join("; ")}` : "Gerar Memorial DOCX + Planilha ODS"}>
              {ocupado ? "Gerando…" : "⚡ Gerar documentos"}
            </button>
          </span>
        </div>
        {pendencias.length > 0 && (
          <div className="pendencias-lista">
            Antes de gerar:{" "}
            {pendencias.map((p, i) => (
              <button key={i} className="link-pendencia" onClick={() => irParaPendencia(p.alvo)}>{p.msg}</button>
            ))}
          </div>
        )}
        {preview.erro
          ? <div className="erro">{preview.erro}</div>
          : <div className="paragrafo">{preview.primeiroParagrafo}</div>}
        {erro && <div className="erro">{erro}</div>}
        {msg && !erro && <div className="ok">{msg}</div>}
      </footer>
    </div>
  );
}
