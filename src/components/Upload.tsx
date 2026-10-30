// Tela de entrada do serviço 'geo': pergunta se confronta com área certificada
// (CSV do SIGEF do vizinho → escolha dos vértices na planta) e depois recebe o
// TXT → Edge Function parse-txt, que une os dois e cria o serviço.
import { useRef, useState, type ReactNode } from "react";
import { chamarFuncao } from "../lib/supabase";
import { UFS } from "../lib/domains";
import { guardar, lembrar } from "../lib/ux";
import type { DefinicaoServico } from "../lib/modalidades";
import type { PreviewParse, Servico, Trecho, Vertice } from "../lib/types";
import { parseCsvSigef } from "../../supabase/functions/_shared/certificados.ts";
import type { VerticeSigef } from "../../supabase/functions/_shared/certificados.ts";
import { Icone, ICONE } from "./Icone";
import { Dica, Passos, Rotulo, type Passo } from "./ui";
import { PlantaCertificada } from "./PlantaCertificada";
import { PainelSigef } from "./PainelSigef";
import { temRecurso } from "../lib/recursos";
import { guardarParcelasSigef } from "../lib/sigef";
import { loteamentoDisponivel } from "../lib/loteamento/persistencia";
import { textoSemCredito } from "../lib/creditos";
import type { LonLat } from "../lib/sigef";

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

export function Upload({ definicao, onParsed, onVoltar, voltarPara = "o Início" }: {
  definicao: DefinicaoServico;
  onParsed: (r: ResultadoParse) => void;
  onVoltar?: () => void;
  /** para onde o "voltar" leva — aparece no botão */
  voltarPara?: string;
}) {
  // A pergunta cabe ao serviço que vai ao SIGEF (completo e com glebas). A
  // conferência de área é prévia sem certificação: segue direto para o TXT.
  const perguntaCabe = definicao.chave !== "conferencia" && definicao.chave !== "loteamento";
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
  // Fuso UTM: "" = automático (pelo TXT e, se houver, pelos CSVs dos vizinhos).
  // Perto de E = 500 km o TXT sozinho é ambíguo e a UF não decide (a Bahia
  // atravessa 23S e 24S) — por isso o operador pode fixar aqui, antes de tudo.
  const [fuso, setFuso] = useState(() => lembrar("fuso") ?? "");
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
    // A parcela do vizinho entra na base local de parcelas certificadas, só para
    // esta empresa: é ela que o mapa e a verificação de sobreposição da
    // conferência consultam (as outras empresas não a veem — migration 0030).
    if (lidos.length) {
      guardarParcelasSigef(lidos.map((g) => ({
        codigo: codigoParcela(g), nome: nomeParcela(g), uf: uf || null,
        geometria: { type: "Polygon", coordinates: [[...g.vertices.map((v) => [v.lon, v.lat] as LonLat), [g.vertices[0].lon, g.vertices[0].lat]]] },
      }))).catch((e) => console.warn("parcela do CSV não foi guardada na base SIGEF:", e));
    }
  }
  const codigoParcela = (g: GrupoCsv) => g.parcela ?? `csv:${g.vertices[0]?.codigo.split("-")[0] ?? g.nome}`;
  const nomeParcela = (g: GrupoCsv) => g.vertices[0]?.codigo.split("-")[0] ?? g.nome;
  const destaquesSigef = grupos.map((g) => ({ codigo: codigoParcela(g), nome: nomeParcela(g), anel: g.vertices.map((v) => [v.lon, v.lat] as LonLat) }));
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
      // o loteamento grava o projeto numa tabela própria (migração 0021): sem
      // ela, o serviço seria criado e a tela não teria onde salvar o desenho
      if (definicao.chave === "loteamento" && !(await loteamentoDisponivel())) {
        throw new Error("O banco ainda não tem a atualização do loteamento (migração 0021_loteamento). Peça para aplicá-la e tente de novo.");
      }
      const conteudo = await file.text();
      const r = await chamarFuncao<ResultadoParse>("parse-txt", {
        nome_arquivo: file.name, conteudo, uf: uf || undefined,
        // o serviço nasce já com a modalidade: é nela que o crédito do mês é gasto
        campos: definicao.campos,
        fuso: fuso ? Number(fuso) : undefined,
        ...(usaCertificados ? {
          certificados: gruposValidos.map((g) => ({ nome: g.nome, conteudo: g.conteudo, selecionados: [...g.selecionados] })),
          tolerancia_certificados: Number(tolerancia.replace(",", ".")) || 0.5,
        } : {}),
      });
      onParsed(r);
    } catch (e) {
      setErro(textoSemCredito(e instanceof Error ? e.message : String(e)));
    } finally {
      setCarregando(false);
    }
  }

  // ---- trilha de etapas ----
  const passos: Passo[] = [
    ...(perguntaCabe ? [{ rotulo: "Área certificada", estado: fase === "txt" ? "feita" as const : "ativa" as const }] : []),
    { rotulo: "Upload do TXT", estado: fase === "txt" ? "ativa" : "futura" },
    ...(definicao.chave === "loteamento"
      ? [{ rotulo: "Perguntas", estado: "futura" as const }, { rotulo: "Projeto", estado: "futura" as const }, { rotulo: "Entregas", estado: "futura" as const }]
      : [{ rotulo: "Conferência", estado: "futura" as const }, { rotulo: "Documentos", estado: "futura" as const }]),
  ];
  const stepper = <Passos passos={passos} rotulo="Etapas do novo serviço" />;
  // `dica`: explicação de uso da fase, no "?" ao lado do título
  const cabecalhoCom = (dica?: ReactNode) => (
    <>
      {onVoltar && <button className="fantasma voltar-para" onClick={onVoltar}>← Voltar para {voltarPara}</button>}
      <div>
        <h2>{definicao.titulo}{dica && <Dica>{dica}</Dica>}</h2>
        <p className="sub">{definicao.resumo}</p>
      </div>
    </>
  );
  const cabecalho = cabecalhoCom();

  // ---- 1) Confronta com área certificada? ----
  if (fase === "pergunta") {
    return (
      <div className="upload-tela fade">
        {stepper}
        <div className="upload-card">
          {cabecalho}
          <div className="pergunta-cert">
            <b>Confronta com área certificada?<Dica>
              Se algum vizinho já tem parcela certificada no SIGEF, envie o CSV de exportação dele antes do
              TXT. A divisa comum sai com os <b>vértices certificados</b> (mesmo código, mesmas coordenadas,
              método e precisão do SIGEF) e o levantamento chega à conferência já unido a eles.
            </Dica></b>
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
        <div className="upload-card largo">
          {cabecalho}
          <div>
            <h3 className="titulo-etapa">Confrontantes com área certificada<Dica>
              Envie o CSV de exportação do SIGEF de cada vizinho certificado (um arquivo por parcela). Na
              planta, marque os vértices que fazem divisa com o imóvel levantado — só esses entram no
              serviço. Pode adicionar quantas parcelas precisar.
            </Dica></h3>
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
          {erroCsv && <div className="erro" role="alert">{erroCsv}</div>}

          {grupos.map((g, i) => (
            <section className="cert-grupo" key={g.id}>
              <header>
                <span className="nome">Confrontante {i + 1} · {g.nome}</span>
                <span className="sub pequeno">
                  {g.vertices[0]?.codigo.split("-")[0]}{g.parcela ? ` · parcela ${g.parcela.slice(0, 8)}…` : ""} · {g.vertices.length} vértices no CSV ·{" "}
                  {g.selecionados.size > 0
                    ? `${g.selecionados.size} escolhido(s)`
                    : <em className="alerta">nenhum vértice escolhido — esta parcela não entra no serviço</em>}
                </span>
                <span className="esticar" />
                <button type="button" className="remover" onClick={() => removerGrupo(g.id)} aria-label={`Remover a parcela ${g.nome}`}>remover parcela</button>
              </header>
              <PlantaCertificada vertices={g.vertices} selecionados={g.selecionados} onChange={(s) => setSelecao(g.id, s)} />
            </section>
          ))}

          {grupos.length > 0 && temRecurso("sigef.mapa") && (
            <section className="cert-grupo">
              <header>
                <span className="nome">Mapa das parcelas<Dica>satélite Esri + relevo AWS · em azul os CSVs enviados, em amarelo as parcelas certificadas já na base</Dica></span>
              </header>
              <PainelSigef modo="vizinhanca" destaques={destaquesSigef} ignorar={destaquesSigef.map((d) => d.codigo)} uf={uf || null} altura={420} />
            </section>
          )}

          {grupos.length > 0 && (
            <label className="campo-tolerancia">
              <Rotulo dica="ponto do TXT a menos disso de um vértice certificado vira ele; os demais são inseridos entre os pontos do TXT">
                Tolerância para igualar (m)
              </Rotulo>
              <input className="mono" inputMode="decimal" value={tolerancia} onChange={(e) => setTolerancia(e.target.value)} />
            </label>
          )}

          <div className="rodape-cert">
            <button className="fantasma voltar-para" onClick={() => setFase("pergunta")}>← Voltar à pergunta</button>
            <span className="esticar" />
            {grupos.length > 0 && totalSelecionados === 0 && <span className="sub pequeno">escolha ao menos um vértice para continuar</span>}
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
        {cabecalhoCom(<>Envie o TXT gerado pela máquina de topografia. O sistema detecta o fuso,
          converte as coordenadas e sugere os trechos de confrontantes pelos rótulos.
          {usaCertificados && " Na próxima tela o perímetro já aparece com os vértices do vizinho encaixados."}</>)}
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
        <div className="acoes-linha upload-campos">
          <label className="campo-uf">
            <span>UF do imóvel <span className="sub opcional">opcional</span></span>
            <select value={uf} onChange={(e) => { setUf(e.target.value); guardar("uf", e.target.value); }}>
              <option value="">—</option>
              {UFS.map((u) => <option key={u}>{u}</option>)}
            </select>
            {uf && lembrar("uf") === uf && <small className="sub">última UF usada</small>}
          </label>
          <label className="campo-fuso">
            <Rotulo dica="define a projeção do serviço; no automático, pode ser ajustado na conferência">Fuso UTM</Rotulo>
            <select value={fuso} onChange={(e) => { setFuso(e.target.value); guardar("fuso", e.target.value); }}>
              <option value="">automático{usaCertificados ? " (pelos CSVs dos vizinhos)" : " (pelo TXT)"}</option>
              {[18, 19, 20, 21, 22, 23, 24, 25].map((z) => <option key={z} value={z}>{z}S · MC {6 * z - 183}°</option>)}
            </select>
            {fuso && (
              <small className="sub">
                {lembrar("fuso") === fuso ? "último fuso usado — confira para este imóvel" : "fuso fixado para este serviço"}
              </small>
            )}
          </label>
        </div>
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
              <b className="dz-titulo">Arraste o TXT aqui</b>
              <span>ou clique para escolher o arquivo</span>
              <code className="dz-formato">ID;E;N;h;σpos;σh</code>
            </>
          )}
          <input ref={inputRef} type="file" accept=".txt" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processar(f); }} />
        </div>
        {erro && <div className="erro" role="alert">{erro}</div>}
      </div>
    </div>
  );
}
