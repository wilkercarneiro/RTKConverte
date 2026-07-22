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
import type { Credenciado, RT, Servico, Trecho, Vertice } from "../lib/types";
import type { ResultadoParse } from "./Upload";
import { MapaSVG } from "./MapaSVG";

interface Gerado {
  memorial_docx: string;
  planilha_ods: string;
  resumo: { areaHa: number; perimetroM: number; qtdM: number; qtdP: number; qtdV: number; verticeInicial: string };
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

  useEffect(() => {
    supabase.from("credenciados").select().then(({ data }) => setCredenciados(data ?? []));
    supabase.from("responsaveis_tecnicos").select().then(({ data }) => setRts(data ?? []));
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
  const verticeInicial = servico.vertice_inicial ?? 0;

  const preview = useMemo(
    () => calcularPreviewLocal(servico.fuso_utm ?? 24, vertices, trechos, verticeInicial, credenciado),
    [servico.fuso_utm, vertices, trechos, verticeInicial, credenciado],
  );

  function campo<K extends keyof Servico>(k: K, v: Servico[K]) {
    setServico((s) => ({ ...s, [k]: v }));
  }

  // ------- Bloco 2: trechos -------
  function setTrecho(i: number, patch: Partial<Trecho>) {
    setTrechos((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  }
  function addTrecho(ordem: number) {
    if (trechos.some((t) => t.vertice_inicio_ordem === ordem)) return;
    setTrechos((ts) => [...ts, {
      servico_id: servico.id, vertice_inicio_ordem: ordem, apelido_txt: "(manual)",
      descritivo: "", tipo_limite: "LA1", cns: null, matricula: null,
    }].sort((a, b) => a.vertice_inicio_ordem - b.vertice_inicio_ordem));
    setVertices((vs) => vs.map((v) => (v.ordem === ordem && v.tipo === "P" ? { ...v, tipo: "M" } : v)));
  }
  function removeTrecho(i: number) {
    const t = trechos[i];
    setTrechos((ts) => ts.filter((_, j) => j !== i));
    setVertices((vs) => vs.map((v) => (v.ordem === t.vertice_inicio_ordem && v.tipo === "M" ? { ...v, tipo: "P" } : v)));
  }

  // ------- Bloco 3: vértices -------
  function setVertice(ordem: number, patch: Partial<Vertice>) {
    setVertices((vs) => vs.map((v) => (v.ordem === ordem ? { ...v, ...patch } : v)));
  }
  function inserirV() {
    const apos = Number(novoV.aposOrdem);
    if (!novoV.codigo || !novoV.lat || !novoV.lon || Number.isNaN(apos)) {
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
  }

  async function gerar() {
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

  return (
    <div className="conferencia">
      <header className="topo">
        <button onClick={onVoltar}>← Novo upload</button>
        <span>{servico.nome_arquivo_txt} — fuso {servico.fuso_utm}S</span>
        <span>
          Fuso UTM:{" "}
          <select value={servico.fuso_utm ?? 24} onChange={(e) => campo("fuso_utm", Number(e.target.value))}>
            {[18, 19, 20, 21, 22, 23, 24, 25].map((z) => <option key={z} value={z}>{z}S {inicial.preview.candidatos.includes(z) ? "•" : ""}</option>)}
          </select>
          {inicial.preview.fusoAmbiguo && <em className="alerta"> fuso ambíguo — confirme pelo município</em>}
          {inicial.preview.foraDaUf && <em className="alerta"> coordenadas fora da UF informada!</em>}
        </span>
      </header>

      {/* ---------------- Bloco 1: dados do serviço ---------------- */}
      <section className="bloco">
        <h3>1. Dados do serviço</h3>
        <div className="grade">
          <label>Credenciado
            <select value={servico.credenciado_id ?? ""} onChange={(e) => campo("credenciado_id", e.target.value || null)}>
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
          <label>Detentor
            <input list="detentores" value={servico.detentor_nome ?? ""} onChange={(e) => {
              campo("detentor_nome", e.target.value);
              const d = detentores.find((x) => x.nome === e.target.value);
              if (d?.cpf) campo("detentor_cpf", d.cpf);
            }} />
            <datalist id="detentores">{detentores.map((d) => <option key={d.nome} value={d.nome} />)}</datalist>
          </label>
          <label>CPF/CNPJ <input value={servico.detentor_cpf ?? ""} onChange={(e) => campo("detentor_cpf", e.target.value)} /></label>
          <label>Denominação <input value={servico.denominacao ?? ""} onChange={(e) => campo("denominacao", e.target.value)} /></label>
          <label>Situação {sel(servico.situacao, SITUACOES, (v) => campo("situacao", v))}</label>
          <label>Natureza da área {sel(servico.natureza_area, NATUREZAS_AREA, (v) => campo("natureza_area", v))}</label>
          <label>Código SNCR <input value={servico.codigo_sncr ?? ""} onChange={(e) => campo("codigo_sncr", e.target.value)} /></label>
          <label>CNS (cartório)
            <input list="cartorios" value={servico.cns ?? ""} onChange={(e) => campo("cns", e.target.value)} />
            <datalist id="cartorios">{cartorios.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label>Matrícula <input value={servico.matricula ?? ""} onChange={(e) => campo("matricula", e.target.value)} /></label>
          <label>Município <input value={servico.municipio ?? ""} onChange={(e) => campo("municipio", e.target.value)} /></label>
          <label>UF {sel(servico.uf, UFS, (v) => campo("uf", v))}</label>
          <label>Denominação da parcela <input value={servico.denominacao_parcela ?? ""} placeholder="Parte 1" onChange={(e) => campo("denominacao_parcela", e.target.value)} /></label>
          <label>Parcela número <input value={servico.parcela_numero ?? ""} placeholder="001" onChange={(e) => campo("parcela_numero", e.target.value)} /></label>
          <label>Lado {sel(servico.lado, LADOS, (v) => campo("lado", v))}</label>
        </div>
      </section>

      {/* ---------------- Bloco 2: confrontantes ---------------- */}
      <section className="bloco">
        <h3>2. Confrontantes</h3>
        <div className="confrontantes">
          <div className="trechos">
            {trechos.map((t, i) => {
              const v = vertices.find((x) => x.ordem === t.vertice_inicio_ordem);
              return (
                <div className="trecho" key={`${t.vertice_inicio_ordem}-${i}`}>
                  <div className="linha">
                    <label>Ponto inicial
                      <select value={t.vertice_inicio_ordem}
                        onChange={(e) => setTrecho(i, { vertice_inicio_ordem: Number(e.target.value) })}>
                        {vertices.map((x) => <option key={x.ordem} value={x.ordem}>{x.num_txt ?? `V(${x.ordem})`}</option>)}
                      </select>
                    </label>
                    <span className="apelido">apelido: <b>{t.apelido_txt ?? "—"}</b> {v ? `(pt ${v.num_txt ?? "V"})` : ""}</span>
                    <label>Tipo limite
                      <select value={t.tipo_limite} onChange={(e) => setTrecho(i, { tipo_limite: e.target.value })}>
                        {TIPOS_LIMITE.map((l) => <option key={l}>{l}</option>)}
                      </select>
                    </label>
                    <label>CNS <input value={t.cns ?? ""} onChange={(e) => setTrecho(i, { cns: e.target.value || null })} /></label>
                    <label>Matrícula <input value={t.matricula ?? ""} onChange={(e) => setTrecho(i, { matricula: e.target.value || null })} /></label>
                    <button onClick={() => removeTrecho(i)}>remover</button>
                  </div>
                  <textarea placeholder={"Descritivo formal, ex.: (MATR.432/CNS.00.770-8) FAZENDA LAMEIRO\\ RUDSON PINTO FERREIRA\\ CPF:791.234.145-53"}
                    value={t.descritivo} onChange={(e) => setTrecho(i, { descritivo: e.target.value })} />
                </div>
              );
            })}
            <div className="add-trecho">
              Adicionar transição no ponto:{" "}
              <select id="novo-trecho-ordem" defaultValue="">
                <option value="" disabled>—</option>
                {vertices.filter((v) => !trechos.some((t) => t.vertice_inicio_ordem === v.ordem))
                  .map((v) => <option key={v.ordem} value={v.ordem}>{v.num_txt ?? `V(${v.ordem})`}</option>)}
              </select>{" "}
              <button onClick={() => {
                const el = document.getElementById("novo-trecho-ordem") as HTMLSelectElement;
                if (el.value !== "") addTrecho(Number(el.value));
              }}>adicionar transição</button>
            </div>
          </div>
          <div className="mapa">
            <MapaSVG vertices={vertices} trechos={trechos} verticeInicial={verticeInicial} />
          </div>
        </div>
      </section>

      {/* ---------------- Bloco 3: vértices ---------------- */}
      <section className="bloco">
        <h3>3. Vértices</h3>
        <div className="acoes-vertices">
          <label>Vértice inicial do memorial:{" "}
            <select value={verticeInicial} onChange={(e) => campo("vertice_inicial", Number(e.target.value))}>
              {vertices.filter((v) => v.tipo === "M").map((v) => (
                <option key={v.ordem} value={v.ordem}>{v.num_txt ?? `V(${v.ordem})`}</option>
              ))}
            </select>
          </label>
          <fieldset className="inserir-v">
            <legend>Inserir vértice pré-existente (tipo V, método PA1)</legend>
            <label>após o ponto
              <select value={novoV.aposOrdem} onChange={(e) => setNovoV({ ...novoV, aposOrdem: e.target.value })}>
                <option value="">—</option>
                {vertices.map((v) => <option key={v.ordem} value={v.ordem}>{v.num_txt ?? `V(${v.ordem})`}</option>)}
              </select>
            </label>
            <input placeholder="código (ex.: DSBN-V-0758)" value={novoV.codigo} onChange={(e) => setNovoV({ ...novoV, codigo: e.target.value })} />
            <input placeholder='lat GMS (ex.: 11 24 30,375 S)' value={novoV.lat} onChange={(e) => setNovoV({ ...novoV, lat: e.target.value })} />
            <input placeholder='lon GMS (ex.: 39 4 47,198 W)' value={novoV.lon} onChange={(e) => setNovoV({ ...novoV, lon: e.target.value })} />
            <input placeholder="h (m)" value={novoV.h} onChange={(e) => setNovoV({ ...novoV, h: e.target.value })} />
            <input placeholder="sigma h" value={novoV.sigmaH} onChange={(e) => setNovoV({ ...novoV, sigmaH: e.target.value })} />
            <button onClick={inserirV}>inserir</button>
          </fieldset>
        </div>
        <table className="tabela-vertices">
          <thead>
            <tr><th>nº TXT</th><th>código</th><th>tipo</th><th>método</th><th>lat (GMS)</th><th>lon (GMS)</th><th>h</th><th></th></tr>
          </thead>
          <tbody>
            {vertices.map((v) => (
              <tr key={v.ordem} className={v.ordem === verticeInicial ? "inicial" : ""}>
                <td>{v.num_txt ?? "—"}{v.rotulo_txt ? ` (${v.rotulo_txt})` : ""}</td>
                <td>{v.codigo ?? "(alocado na geração)"}</td>
                <td>
                  {v.inserido_manual ? "V" : (
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
                <td>{v.lat_gms}</td>
                <td>{v.lon_gms}</td>
                <td>{String(v.h).replace(".", ",")}</td>
                <td>{v.inserido_manual && <button onClick={() => removerV(v.ordem)}>×</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {gerado && (
        <section className="bloco gerados">
          <h3>Documentos gerados</h3>
          <p>
            <a href={gerado.memorial_docx} target="_blank" rel="noreferrer">⬇ Memorial Descritivo (DOCX)</a>{" — "}
            <a href={gerado.planilha_ods} target="_blank" rel="noreferrer">⬇ Planilha SIGEF (ODS)</a>
          </p>
          <p>Vértice inicial {gerado.resumo.verticeInicial} — M/P/V: {gerado.resumo.qtdM}/{gerado.resumo.qtdP}/{gerado.resumo.qtdV}.
            Regeração ilimitada: os arquivos são sobrescritos a cada geração.</p>
        </section>
      )}

      {/* ---------------- Preview (rodapé fixo) ---------------- */}
      <footer className="preview">
        <div className="stats">
          <span><b>Fuso:</b> {servico.fuso_utm}S (MC-{Math.abs(6 * (servico.fuso_utm ?? 24) - 183)}°W)</span>
          <span><b>Área:</b> {preview.areaHa} ha</span>
          <span><b>Perímetro:</b> {preview.perimetroM} m</span>
          <span><b>M/P/V:</b> {preview.qtdM}/{preview.qtdP}/{preview.qtdV}</span>
          <button disabled={ocupado} onClick={apenasSalvar}>Salvar rascunho</button>
          <button disabled={ocupado} className="principal" onClick={gerar}>
            {ocupado ? "Gerando..." : "Gerar documentos"}
          </button>
        </div>
        {preview.erro
          ? <div className="erro">{preview.erro}</div>
          : <div className="paragrafo">{preview.primeiroParagrafo}</div>}
        {erro && <div className="erro">{erro}</div>}
        {msg && !erro && <div className="ok">{msg}</div>}
      </footer>
    </div>
  );
}
