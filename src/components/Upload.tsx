// Tela de entrada do serviço 'geo': pergunta se confronta com área certificada
// (CSV do SIGEF do vizinho → escolha dos vértices na planta) e depois recebe o
// TXT → Edge Function parse-txt, que une os dois e cria o serviço.
import { useRef, useState } from "react";
import { chamarFuncao } from "../lib/supabase";
import { UFS } from "../lib/domains";
import { guardar, lembrar } from "../lib/ux";
import type { DefinicaoServico } from "../lib/modalidades";
import type { PreviewParse, Servico, Trecho, Vertice } from "../lib/types";
import { parseCsvSigef } from "../../supabase/functions/_shared/certificados.ts";
import type { VerticeSigef } from "../../supabase/functions/_shared/certificados.ts";
import { Icone, ICONE } from "./Icone";
import { PlantaCertificada } from "./PlantaCertificada";

export interface ResultadoParse {
  servico: Servico;
  vertices: Vertice[];
  trechos: Trecho[];
  preview: PreviewParse;
}

/** Um CSV de exportação do SIGEF já lido, com os vértices escolhidos pelo operador. */
interface GrupoCsv {
  /** identidade na tela — NÃO é o nome do arquivo: o SIGEF baixa todos como "exportacao.csv" */
  id: string;
  /** QRCODE do CSV (id da parcela no SIGEF); é o que diz se dois arquivos são o mesmo vizinho */
  parcela: string | null;
  nome: string;
  conteudo: string;
  vertices: VerticeSigef[];
  selecionados: Set<string>;
}

type Fase = "pergunta" | "certificados" | "txt";

export function Upload({ definicao, onParsed, onVoltar }: {
  definicao: DefinicaoServico;
  onParsed: (r: ResultadoParse) => void;
  onVoltar?: () => void;
}) {
  // A pergunta cabe ao serviço que vai ao SIGEF (completo e com glebas). A
  // conferência de área é prévia sem certificação: segue direto para o TXT.
  const perguntaCabe = definicao.chave !== "conferencia";
  const [fase, setFase] = useState<Fase>(perguntaCabe ? "pergunta" : "txt");
  const [confronta, setConfronta] = useState<boolean | null>(null);
  const [grupos, setGrupos] = useState<GrupoCsv[]>([]);
  const [tolerancia, setTolerancia] = useState("0,50");
  const [erroCsv, setErroCsv] = useState<string | null>(null);
  const [arrastandoCsv, setArrastandoCsv] = useState(false);
  const inputCsvRef = useRef<HTMLInputElement>(null);

  const [arrastando, setArrastando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // um escritório trabalha quase sempre na mesma UF: a última escolhida já vem
  // marcada, o que na prática resolve o fuso antes de o operador pensar nele
  const [uf, setUf] = useState(() => lembrar("uf") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  const gruposValidos = grupos.filter((g) => g.selecionados.size > 0);
  const totalSelecionados = gruposValidos.reduce((s, g) => s + g.selecionados.size, 0);
  const usaCertificados = perguntaCabe && confronta === true && totalSelecionados > 0;

  async function carregarCsvs(files: FileList | File[]) {
    const lista = [...files].filter((f) => /\.csv$/i.test(f.name));
    if (!lista.length) { setErroCsv("Envie o arquivo CSV exportado pelo SIGEF (exportacao (n).csv)"); return; }
    const erros: string[] = [];
    const lidos: GrupoCsv[] = [];
    for (const f of lista) {
      const conteudo = await f.text();
      try {
        const { vertices, parcela } = parseCsvSigef(f.name, conteudo);
        lidos.push({ id: crypto.randomUUID(), parcela, nome: f.name, conteudo, vertices, selecionados: new Set() });
      } catch (e) {
        erros.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (lidos.length) {
      // Todo CSV novo é ACRESCENTADO. A única substituição é a mesma parcela
      // enviada de novo (mesmo QRCODE) — e aí a escolha de vértices é preservada.
      setGrupos((prev) => {
        const out = [...prev];
        for (const g of lidos) {
          const i = g.parcela ? out.findIndex((x) => x.parcela === g.parcela) : -1;
          if (i >= 0) {
            const codigos = new Set(g.vertices.map((v) => v.codigo));
            out[i] = { ...g, id: out[i].id, selecionados: new Set([...out[i].selecionados].filter((c) => codigos.has(c))) };
            erros.push(`${g.nome}: a parcela ${g.parcela!.slice(0, 8)}… já estava na lista — arquivo substituído, seleção mantida.`);
          } else {
            out.push(g);
          }
        }
        return out;
      });
    }
    setErroCsv(erros.length ? erros.join("\n") : null);
  }
  function setSelecao(id: string, sel: Set<string>) {
    setGrupos((gs) => gs.map((g) => (g.id === id ? { ...g, selecionados: sel } : g)));
  }
  function removerGrupo(id: string) {
    setGrupos((gs) => gs.filter((g) => g.id !== id));
  }

  async function processar(file: File) {
    setCarregando(true);
    setErro(null);
    try {
      const conteudo = await file.text();
      const r = await chamarFuncao<ResultadoParse>("parse-txt", {
        nome_arquivo: file.name, conteudo, uf: uf || undefined,
        ...(usaCertificados ? {
          certificados: gruposValidos.map((g) => ({ nome: g.nome, conteudo: g.conteudo, selecionados: [...g.selecionados] })),
          tolerancia_certificados: Number(tolerancia.replace(",", ".")) || 0.5,
        } : {}),
      });
      onParsed(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  // ---- trilha de etapas ----
  const passos: { rotulo: string; estado: "feita" | "ativa" | "" }[] = [
    ...(perguntaCabe ? [{ rotulo: "Área certificada", estado: fase === "txt" ? "feita" as const : "ativa" as const }] : []),
    { rotulo: "Upload do TXT", estado: fase === "txt" ? "ativa" : "" },
    { rotulo: "Conferência", estado: "" },
    { rotulo: "Documentos", estado: "" },
  ];
  const stepper = (
    <div className="stepper">
      {passos.map((p, i) => (
        <span key={p.rotulo} style={{ display: "contents" }}>
          {i > 0 && <span className="step-seta">→</span>}
          <span className={`step ${p.estado}`}><span className="num">{i + 1}</span> {p.rotulo}</span>
        </span>
      ))}
    </div>
  );
  const cabecalho = (
    <>
      {onVoltar && <button className="fantasma" style={{ justifySelf: "start", padding: 0 }} onClick={onVoltar}>← Início</button>}
      <div>
        <h2>{definicao.titulo}</h2>
        <p className="sub">{definicao.resumo}</p>
      </div>
    </>
  );

  // ---- 1) Confronta com área certificada? ----
  if (fase === "pergunta") {
    return (
      <div className="upload-tela fade">
        {stepper}
        <div className="upload-card">
          {cabecalho}
          <div className="pergunta-cert">
            <b>Confronta com área certificada?</b>
            <p className="sub">
              Se algum vizinho já tem parcela certificada no SIGEF, envie o CSV de exportação dele antes do
              TXT. A divisa comum sai com os <b>vértices certificados</b> (mesmo código, mesmas coordenadas,
              método e precisão do SIGEF) e o levantamento chega à conferência já unido a eles.
            </p>
            <div className="acoes-linha">
              <button className="principal" onClick={() => { setConfronta(true); setFase("certificados"); }}>
                Sim, tenho o CSV do vizinho
              </button>
              <button onClick={() => { setConfronta(false); setFase("txt"); }}>Não, seguir para o TXT</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- 2) CSVs dos vizinhos e escolha dos vértices ----
  if (fase === "certificados") {
    return (
      <div className="upload-tela fade">
        {stepper}
        <div className="upload-card" style={{ width: "min(100%, 1400px)" }}>
          {cabecalho}
          <div>
            <h3 style={{ margin: "0 0 6px" }}>Confrontantes com área certificada</h3>
            <p className="sub">
              Envie o CSV de exportação do SIGEF de cada vizinho certificado (um arquivo por parcela). Na
              planta, marque os vértices que fazem divisa com o imóvel levantado — só esses entram no
              serviço. Pode adicionar quantas parcelas precisar.
            </p>
          </div>
          <div
            className={`dropzone linha ${arrastandoCsv ? "ativo" : ""}`}
            role="button" tabIndex={0}
            aria-label="Enviar CSV de exportação do SIGEF"
            onDragOver={(e) => { e.preventDefault(); setArrastandoCsv(true); }}
            onDragLeave={() => setArrastandoCsv(false)}
            onDrop={(e) => { e.preventDefault(); setArrastandoCsv(false); if (e.dataTransfer.files?.length) carregarCsvs(e.dataTransfer.files); }}
            onClick={() => inputCsvRef.current?.click()}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputCsvRef.current?.click(); } }}
          >
            <b>{grupos.length ? `Adicionar outro confrontante (${grupos.length} na lista)` : "Arraste o CSV do SIGEF aqui"}</b>
            <span>exportacao (n).csv — pode selecionar vários de uma vez; cada arquivo é um vizinho e todos ficam na lista</span>
            <input ref={inputCsvRef} type="file" accept=".csv" multiple hidden onClick={(e) => e.stopPropagation()}
              onChange={(e) => { if (e.target.files?.length) carregarCsvs(e.target.files); e.target.value = ""; }} />
          </div>
          {erroCsv && <div className="erro">{erroCsv}</div>}

          {grupos.map((g, i) => (
            <section className="cert-grupo" key={g.id}>
              <header>
                <span className="nome">Confrontante {i + 1} · {g.nome}</span>
                <span className="sub" style={{ fontSize: 13 }}>
                  {g.vertices[0]?.codigo.split("-")[0]}{g.parcela ? ` · parcela ${g.parcela.slice(0, 8)}…` : ""} · {g.vertices.length} vértices no CSV ·{" "}
                  {g.selecionados.size > 0
                    ? `${g.selecionados.size} escolhido(s)`
                    : <em className="alerta">nenhum vértice escolhido — esta parcela não entra no serviço</em>}
                </span>
                <span className="esticar" />
                <button type="button" className="remover" onClick={() => removerGrupo(g.id)}>remover parcela</button>
              </header>
              <PlantaCertificada vertices={g.vertices} selecionados={g.selecionados} onChange={(s) => setSelecao(g.id, s)} />
            </section>
          ))}

          {grupos.length > 0 && (
            <label style={{ display: "grid", gap: 4, width: 260 }}>
              <span>Tolerância para igualar (m)</span>
              <input className="mono" style={{ width: 90 }} value={tolerancia} onChange={(e) => setTolerancia(e.target.value)} />
              <small className="sub" style={{ fontSize: 12 }}>
                ponto do TXT a menos disso de um vértice certificado vira ele; os demais são inseridos entre os pontos do TXT
              </small>
            </label>
          )}

          <div className="rodape-cert">
            <button className="fantasma" style={{ padding: 0 }} onClick={() => setFase("pergunta")}>← Voltar</button>
            <span className="esticar" />
            {grupos.length > 0 && totalSelecionados === 0 && <span className="sub" style={{ fontSize: 13 }}>escolha ao menos um vértice para continuar</span>}
            <button className="principal" disabled={totalSelecionados === 0} onClick={() => setFase("txt")}>
              Continuar para o TXT →
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- 3) TXT do levantamento ----
  return (
    <div className="upload-tela fade">
      {stepper}
      <div className="upload-card">
        {cabecalho}
        {perguntaCabe && (
          <div className="resumo-cert">
            {usaCertificados ? (
              <span>
                <b>Confronta com área certificada:</b> {gruposValidos.length} parcela(s) · {totalSelecionados} vértice(s)
                certificado(s) serão unidos ao levantamento · tolerância {tolerancia} m
              </span>
            ) : (
              <span><b>Confronta com área certificada:</b> não</span>
            )}
            <button className="fantasma" onClick={() => setFase(confronta ? "certificados" : "pergunta")}>alterar</button>
          </div>
        )}
        <p className="sub">Envie o TXT gerado pela máquina de topografia. O sistema detecta o fuso,
          converte as coordenadas e sugere os trechos de confrontantes pelos rótulos.
          {usaCertificados && " Na próxima tela o perímetro já aparece com os vértices do vizinho encaixados."}</p>
        <label style={{ display: "grid", gap: 6, width: 200 }}>
          <span>UF do imóvel <span className="sub" style={{ fontSize: 12.5 }}>opcional · resolve o fuso UTM</span></span>
          <select value={uf} onChange={(e) => { setUf(e.target.value); guardar("uf", e.target.value); }}>
            <option value="">—</option>
            {UFS.map((u) => <option key={u}>{u}</option>)}
          </select>
          {uf && lembrar("uf") === uf && <small className="sub" style={{ fontSize: 12 }}>última UF usada</small>}
        </label>
        {/* role/tabIndex/onKeyDown: a zona de arraste era um div com onClick,
            inalcançável por teclado. */}
        <div
          className={`dropzone ${arrastando ? "ativo" : ""}`}
          role="button"
          tabIndex={carregando ? -1 : 0}
          aria-label="Enviar arquivo TXT do levantamento"
          aria-busy={carregando}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            const f = e.dataTransfer.files[0];
            if (f) processar(f);
          }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); }
          }}
        >
          {carregando ? (
            <>
              <span className="spinner" />
              <b>Processando o levantamento…</b>
              <span>validando pontos, detectando fuso e convertendo coordenadas{usaCertificados ? ", unindo os vértices certificados" : ""}</span>
            </>
          ) : (
            <>
              <Icone d={ICONE.upload} size={36} traco={1.6} />
              <b style={{ marginTop: 6 }}>Arraste o TXT aqui</b>
              <span>ou clique para escolher o arquivo</span>
              <code style={{ marginTop: 6 }}>ID;E;N;h;σpos;σh</code>
            </>
          )}
          <input ref={inputRef} type="file" accept=".txt" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processar(f); }} />
        </div>
        {erro && <div className="erro">{erro}</div>}
      </div>
    </div>
  );
}
