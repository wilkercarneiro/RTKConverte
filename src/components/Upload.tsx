// Tela de entrada do serviço 'geo': pergunta se confronta com área certificada
// (CSV do SIGEF do vizinho → escolha dos vértices na planta), recebe o arquivo
// do levantamento em QUALQUER formato → Edge Function ler-arquivo (perfil,
// regras, IA) → etapa "Leitura do arquivo" (prévia conferida pelo operador) →
// parse-txt, que reexecuta a leitura confirmada, une os certificados e cria o
// serviço.
import { useRef, useState, type ReactNode } from "react";
import { LeituraArquivo } from "./LeituraArquivo";
import type { LeituraConfirmada, RespostaLeitura } from "./LeituraArquivo";
import { chamarFuncao, supabase } from "../lib/supabase";
import proj4lib from "proj4";
import { detectZoneCandidates, UF_BBOX } from "../../supabase/functions/_shared/geo.ts";
import type { Proj4 } from "../../supabase/functions/_shared/geo.ts";
import { executarReceita } from "../../supabase/functions/_shared/leitor/index.ts";
import { UFS } from "../lib/domains";
import { guardar, lembrar } from "../lib/ux";
import type { DefinicaoServico } from "../lib/modalidades";
import type { PreviewParse, Servico, Trecho, Vertice } from "../lib/types";
import { parseCsvSigef } from "../../supabase/functions/_shared/certificados.ts";
import type { VerticeSigef } from "../../supabase/functions/_shared/certificados.ts";
import { Icone, ICONE } from "./Icone";
import { confirmar, Dica, Passos, Rotulo, type Passo } from "./ui";
import { PlantaCertificada } from "./PlantaCertificada";
import { PainelSigef } from "./PainelSigef";
import { BarreiraErro } from "./BarreiraErro";
import { temRecurso } from "../lib/recursos";
import { guardarParcelasSigef } from "../lib/sigef";
import { loteamentoDisponivel } from "../lib/loteamento/persistencia";
import { carregarCreditos, custoDoServico, textoSemCredito } from "../lib/creditos";
import { fmtArea } from "../lib/esboco";
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

type Fase = "pergunta" | "certificados" | "txt" | "leitura";

/** Extensões aceitas: texto/planilha de coletora, formatos de troca e relatórios. */
const ACEITOS = ".txt,.csv,.dat,.xyz,.pts,.asc,.gsi,.pos,.sum,.jxl,.xml,.kml,.kmz,.gpx,.geojson,.json,.dxf,.xlsx,.ods,.pdf";

async function paraBase64(f: File): Promise<string> {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Fusos em que o arquivo lido cabe dentro da UF. Com E/N (UTM) a longitude é a mesma
 * distância ao meridiano central em qualquer fuso — só a UF separa, e a Bahia, Minas,
 * Pará… atravessam dois. Arquivo em lat/lon já traz o fuso (lista vazia).
 */
function fusosNaUf(linhas: string[], l: LeituraConfirmada, uf: string): { zone: number; lon: number }[] {
  const proj4 = proj4lib as unknown as Proj4;
  try {
    const lt = executarReceita(linhas, l.receita, { proj4, ordem: l.ordem, excluir: l.excluir, sigmaPadrao: l.sigma_padrao ?? undefined, versao: l.versao ?? undefined, incluir: l.incluir, ligacao: l.ligacao });
    if (lt.fusoGeo || lt.anel.length < 3) return [];
    const bb = uf ? UF_BBOX[uf] : undefined;
    return detectZoneCandidates(lt.anel.map((p) => ({ e: p.e, n: p.n })), proj4)
      .filter((c) => !bb || (c.lonCentroide >= bb[0] && c.lonCentroide <= bb[1] && c.latCentroide >= bb[2] && c.latCentroide <= bb[3]))
      .map((c) => ({ zone: c.zone, lon: c.lonCentroide }));
  } catch { return []; }
}

/** O fuso que a empresa mais usou nos serviços desta UF (sugestão; null se não há histórico). */
async function fusoMaisUsado(uf: string, opcoes: number[]): Promise<number | null> {
  try {
    let q = supabase.from("servicos").select("fuso_utm").order("created_at", { ascending: false }).limit(60);
    if (uf) q = q.eq("uf", uf);
    const { data } = await q;
    const conta = new Map<number, number>();
    for (const s of (data ?? []) as { fuso_utm: number | null }[]) if (s.fuso_utm && opcoes.includes(s.fuso_utm)) conta.set(s.fuso_utm, (conta.get(s.fuso_utm) ?? 0) + 1);
    const [melhor] = [...conta].sort((a, b) => b[1] - a[1]);
    return melhor ? melhor[0] : null;
  } catch { return null; }
}

const fmtLon = (lon: number) => { const a = Math.abs(lon); const g = Math.floor(a); return `${g}°${String(Math.round((a - g) * 60)).padStart(2, "0")}′ ${lon < 0 ? "O" : "L"}`; };

/** A função ler-arquivo ainda não publicada (ou fora do ar): cai no caminho antigo. */
const leituraIndisponivel = (msg: string) => /^Erro \d{3}$/.test(msg) || /interrompeu o processamento|function not found|worker/i.test(msg);

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
  // etapa "Leitura do arquivo"
  const [previa, setPrevia] = useState<{ arquivo: File; b64: string; resposta: RespostaLeitura } | null>(null);
  const [criando, setCriando] = useState(false);
  const [erroCriacao, setErroCriacao] = useState<string | null>(null);
  // o arquivo cabe em mais de um fuso dentro da UF: o operador escolhe antes de criar
  const [perguntaFuso, setPerguntaFuso] = useState<{ l: LeituraConfirmada; opcoes: { zone: number; lon: number }[]; sugerido: number | null } | null>(null);

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
      const b64 = await paraBase64(file);
      let resposta: RespostaLeitura;
      try {
        resposta = await chamarFuncao<RespostaLeitura>("ler-arquivo", { nome_arquivo: file.name, arquivo_base64: b64 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!leituraIndisponivel(msg)) throw e;
        // servidor ainda sem a leitura universal: o caminho de sempre — mas o
        // crédito só sai com o "sim" de quem envia, como no Prosseguir
        if (!(await confirmarCredito(null))) return;
        onParsed(await chamarFuncao<ResultadoParse>("parse-txt", { ...corpoServico(), nome_arquivo: file.name, conteudo: await file.text() }));
        return;
      }
      if (resposta.binario) {
        setErro(`${resposta.binario.formato}: ${resposta.binario.orientacao}`);
        return;
      }
      setErroCriacao(null);
      setPrevia({ arquivo: file, b64, resposta });
      setFase("leitura");
    } catch (e) {
      setErro(textoSemCredito(e instanceof Error ? e.message : String(e)));
    } finally {
      setCarregando(false);
    }
  }

  /** O que o serviço leva além do arquivo: UF, fuso, modalidade e certificados. */
  function corpoServico() {
    return {
      uf: uf || undefined,
      // o serviço nasce já com a modalidade: é nela que o crédito do mês é gasto
      campos: definicao.campos,
      fuso: fuso ? Number(fuso) : undefined,
      ...(usaCertificados ? {
        certificados: gruposValidos.map((g) => ({ nome: g.nome, conteudo: g.conteudo, selecionados: [...g.selecionados] })),
        tolerancia_certificados: Number(tolerancia.replace(",", ".")) || 0.5,
      } : {}),
    };
  }

  /**
   * A pergunta do Prosseguir: quanto crédito sai e de onde. O saldo é lido na
   * hora (outra pessoa da equipe pode ter gasto enquanto esta conferia). Sem
   * crédito, não pergunta: avisa e a conferência fica aberta.
   */
  async function confirmarCredito(l: LeituraConfirmada | null): Promise<boolean> {
    const custo = custoDoServico(await carregarCreditos().catch(() => null), definicao.chave);
    if (!custo.disponivel) { setErroCriacao(custo.detalhe); setErro(custo.detalhe); return false; }
    const r = l?.resumo;
    return confirmar({
      titulo: `Prosseguir vai consumir ${custo.credito}`,
      texto: (
        <>
          <p>{custo.detalhe}</p>
          {r && (
            <p className="sub">
              O serviço será criado com {r.pontos} ponto{r.pontos === 1 ? "" : "s"}{r.partes > 1 ? ` em ${r.partes} partes` : ""}
              {r.areaHa !== null ? ` · ${fmtArea(r.areaHa)}` : ""}. Até aqui, conferir os pontos e gerar o esboço não custaram nada.
            </p>
          )}
        </>
      ),
      confirmar: `Prosseguir e usar ${custo.credito}`,
      cancelar: "Voltar à conferência",
    });
  }

  /**
   * Confirmação da prévia: o parse-txt reexecuta a leitura sobre o arquivo e cria o serviço.
   * Fuso no automático e o arquivo cabendo em mais de um fuso dentro da UF (a Bahia
   * atravessa 23S e 24S; com E/N só, qualquer fuso serve): pergunta antes de criar —
   * o desempate "mais perto do centro da UF" punha o leste baiano no 23S, e memoriais,
   * KML e planta de situação saíam a 600 km do imóvel.
   */
  async function criar(l: LeituraConfirmada, fusoEscolhido?: number) {
    if (!previa) return;
    if (fusoEscolhido === undefined && !fuso && !usaCertificados) {
      const opcoes = fusosNaUf(previa.resposta.linhas, l, uf);
      if (opcoes.length > 1) {
        setPerguntaFuso({ l, opcoes, sugerido: await fusoMaisUsado(uf, opcoes.map((o) => o.zone)) });
        return;
      }
    }
    setPerguntaFuso(null);
    setErroCriacao(null);
    // o crédito é gasto aqui, ao criar o serviço: pergunta antes
    if (!(await confirmarCredito(l))) return;
    setCriando(true);
    try {
      onParsed(await chamarFuncao<ResultadoParse>("parse-txt", {
        ...corpoServico(), ...(fusoEscolhido !== undefined ? { fuso: fusoEscolhido } : {}), nome_arquivo: previa.arquivo.name, arquivo_base64: previa.b64, leitura: l,
      }));
    } catch (e) {
      setErroCriacao(textoSemCredito(e instanceof Error ? e.message : String(e)));
    } finally {
      setCriando(false);
    }
  }

  // ---- trilha de etapas ----
  const passos: Passo[] = [
    ...(perguntaCabe ? [{ rotulo: "Área certificada", estado: fase === "txt" || fase === "leitura" ? "feita" as const : "ativa" as const }] : []),
    { rotulo: "Arquivo do levantamento", estado: fase === "txt" ? "ativa" : fase === "leitura" ? "feita" : "futura" },
    { rotulo: "Conferência do TXT", estado: fase === "leitura" ? "ativa" : "futura" },
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
              {/* falha do mapa fica no mapa: a escolha dos vértices acima continua */}
              <BarreiraErro onde="o mapa das parcelas" compacta>
                <PainelSigef modo="vizinhanca" destaques={destaquesSigef} ignorar={destaquesSigef.map((d) => d.codigo)} uf={uf || null} altura={420}
                  semMapa="a escolha dos vértices nas plantas acima não depende dele" />
              </BarreiraErro>
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

  // ---- 4) Leitura do arquivo (prévia conferida) ----
  if (fase === "leitura" && previa) {
    return (
      <div className="upload-tela fade">
        {stepper}
        <div className="upload-card leitura">
          {cabecalhoCom(<>Confira e ajuste os pontos antes de criar o serviço: desative, ative um ponto inativo,
            ligue os pontos na ordem do perímetro ou encaixe um ponto em outro lado. “Gerar imagem” monta o esboço
            sobre o satélite com as medidas, para baixar. Nada disso gasta crédito: ele só é usado no “Prosseguir”.
            O desenho, a tabela e os avisos vêm do mesmo código que grava o serviço: o que está aqui é o que vai ser
            gravado.</>)}
          {perguntaFuso && (
            <div className="aviso-fuso" role="alertdialog" aria-label="Escolha o fuso UTM">
              <strong>Em qual fuso UTM o levantamento foi feito?</strong>
              <p className="sub">
                As coordenadas do arquivo (E/N) servem para {perguntaFuso.opcoes.length} fusos dentro {uf ? `da ${uf}` : "do Brasil"} — cada um põe o imóvel num lugar diferente.
                O fuso decide as coordenadas geográficas do memorial, o KML e a planta de situação.
                {perguntaFuso.sugerido ? " Sugerido: o fuso que a empresa mais usa nesta UF." : ""}
              </p>
              <div className="aviso-fuso-opcoes">
                {perguntaFuso.opcoes.map((o) => (
                  <button key={o.zone} className={o.zone === perguntaFuso.sugerido ? "principal" : ""} disabled={criando}
                    onClick={() => { setFuso(String(o.zone)); guardar("fuso", String(o.zone)); void criar(perguntaFuso.l, o.zone); }}>
                    Fuso {o.zone}S — imóvel em {fmtLon(o.lon)}{o.zone === perguntaFuso.sugerido ? " (sugerido)" : ""}
                  </button>
                ))}
                <button className="fantasma" onClick={() => setPerguntaFuso(null)} disabled={criando}>Voltar</button>
              </div>
            </div>
          )}
          <LeituraArquivo
            nomeArquivo={previa.arquivo.name}
            resposta={previa.resposta}
            criando={criando}
            erro={erroCriacao}
            onConfirmar={criar}
            onTrocarArquivo={() => { setPrevia(null); setErroCriacao(null); setFase("txt"); }}
            uf={uf}
            fuso={fuso ? Number(fuso) : null}
            onEscolherFuso={(z) => { setFuso(String(z)); guardar("fuso", String(z)); }}
          />
        </div>
      </div>
    );
  }

  // ---- 3) Arquivo do levantamento ----
  return (
    <div className="upload-tela fade">
      {stepper}
      <div className="upload-card">
        {cabecalhoCom(<>Envie o arquivo de pontos exportado pela coletora ou pelo software de
          processamento — TXT/CSV de qualquer aparelho, planilha, GSI, KML/GPX, LandXML/JobXML, DXF ou o
          relatório do IBGE-PPP. Na próxima tela você confere como ele foi lido. O sistema detecta o fuso,
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
          aria-label="Enviar o arquivo de pontos do levantamento"
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
              <b>Lendo o arquivo…</b>
              <span>reconhecendo o formato, as colunas e a ordem dos pontos — formatos novos podem levar alguns segundos a mais</span>
            </>
          ) : (
            <>
              <Icone d={ICONE.upload} size={36} traco={1.6} />
              <b className="dz-titulo">Arraste o arquivo do levantamento aqui</b>
              <span>ou clique para escolher — qualquer aparelho, qualquer organização de colunas</span>
              <code className="dz-formato">TXT · CSV · planilha · GSI · KML/GPX · XML · DXF · PPP</code>
            </>
          )}
          <input ref={inputRef} type="file" accept={ACEITOS} hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) processar(f); }} />
        </div>
        {erro && <div className="erro" role="alert">{erro}</div>}
      </div>
    </div>
  );
}
