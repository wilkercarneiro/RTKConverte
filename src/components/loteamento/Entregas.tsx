// Entregas do loteamento: o que vai para o cliente (planta, memoriais, quadro,
// KML, DXF), os arquivos de cada lote (EntregasLotes: memorial, planta A4 e
// locação por lote) e o que vai para a coletora do técnico (arquivo de locação).
// Tudo sai do MESMO resultado que está na tela — os nomes de ponto da locação
// são os mesmos da planta e dos memoriais.
import { useEffect, useMemo, useRef, useState } from "react";
import { arquivoDaFuncao, supabase } from "../../lib/supabase";
import { carregarEscritorio, pastaDoEscritorio } from "../../lib/escritorio";
import { fmt } from "../../lib/loteamento/calculo.ts";
import type { Perimetro, Resultado } from "../../lib/loteamento/calculo.ts";
import type { Projeto } from "../../lib/loteamento/modelo.ts";
import { FORMATOS, LOCACAO_PADRAO, arquivoLocacao, pontosDeLocacao } from "../../lib/loteamento/saidas.ts";
import type { FormatoLocacao, OpcoesLocacao } from "../../lib/loteamento/saidas.ts";
import { escalaPara } from "../../lib/loteamento/planta.ts";
import type { DadosCarimbo, Folha } from "../../lib/loteamento/planta.ts";
import { imagemSituacao } from "../../lib/loteamento/situacao.ts";
import { baixarEntrega, carimboParaEnvio } from "../../lib/entregas";
import { abrirPlanta } from "../planta/VisualizadorPlanta";
import { DadosCliente } from "./DadosCliente";
import type { DadosClienteRef } from "./DadosCliente";
import { Dica } from "../ui";
import type { RT, Servico } from "../../lib/types";
import { Miniatura } from "./Assistente";
import { EntregasInfra } from "./EntregasInfra";
import { EntregasLotes } from "./EntregasLotes";
import { nomeArquivo } from "../../lib/loteamento/entregas.ts";
import { calcularInfra } from "../../lib/loteamento/infra/index.ts";
import type { ParametrosInfra } from "../../lib/loteamento/infra/index.ts";
import { pontosDasRedes } from "../../lib/loteamento/infra/saidas.ts";

interface Props {
  servico: Servico;
  projeto: Projeto;
  res: Resultado;
  perimetro: Perimetro;
  onExportou: () => void;
  /** grava o projeto antes de pedir o arquivo: o servidor gera a partir do banco */
  onSalvar: () => Promise<void>;
  /** abre a maquete 3D */
  onAbrir3D?: () => void;
  /** muda os parâmetros dos projetos de infraestrutura */
  onMudarInfra?: (p: Partial<ParametrosInfra>) => void;
  /** dados do cliente/imóvel editados aqui (a tela de cima guarda o serviço) */
  onServico?: (patch: Partial<Servico>) => void;
}

/** Os textos do carimbo que vêm do serviço — sempre os da tela, que o operador acabou de editar. */
const textosDoServico = (s: Servico): Partial<DadosCarimbo> => ({
  proprietario: s.detentor_nome ?? "", cpfProprietario: s.detentor_cpf ?? "", imovel: s.denominacao ?? "",
  municipio: s.municipio ?? "", uf: s.uf ?? "", matricula: s.matricula ?? "", fuso: s.fuso_utm ?? 24,
});

async function carregarCarimbo(s: Servico): Promise<DadosCarimbo> {
  try { return await lerCarimbo(s); } catch {
    // sem rede/sessão: a planta sai com o carimbo do próprio serviço
    return {
      empresa: "", cnpj: "", desenhista: "", proprietario: s.detentor_nome ?? "", cpfProprietario: s.detentor_cpf ?? "",
      imovel: s.denominacao ?? "", municipio: s.municipio ?? "", uf: s.uf ?? "", matricula: s.matricula ?? "",
      rt: "", rtRegistro: "", trt: s.trt ?? "", fuso: s.fuso_utm ?? 24, logo: null,
    };
  }
}

async function lerCarimbo(s: Servico): Promise<DadosCarimbo> {
  const [{ data: cfg }, rt, esc, cred] = await Promise.all([
    supabase.from("config_empresa").select("key, value").in("key", ["razao_social", "cnpj", "desenhista"]),
    s.rt_id ? supabase.from("responsaveis_tecnicos").select().eq("id", s.rt_id).maybeSingle() : Promise.resolve({ data: null }),
    carregarEscritorio(),
    s.credenciado_id ? supabase.from("credenciados").select("prefixo_vertice").eq("id", s.credenciado_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const c = Object.fromEntries(((cfg ?? []) as { key: string; value: string }[]).map((x) => [x.key, x.value]));
  const r = (rt as { data: RT | null }).data;
  let logo: DadosCarimbo["logo"] = null;
  const pasta = pastaDoEscritorio(esc);
  for (const tipo of ["png", "jpg"] as const) {
    const { data } = await supabase.storage.from("templates").download(`${pasta}logo-empresa.${tipo}`);
    if (data) { logo = { bytes: new Uint8Array(await data.arrayBuffer()), tipo }; break; }
  }
  return {
    empresa: c.razao_social ?? "", cnpj: c.cnpj ?? "", desenhista: c.desenhista ?? "",
    proprietario: s.detentor_nome ?? "", cpfProprietario: s.detentor_cpf ?? "",
    imovel: s.denominacao ?? "", municipio: s.municipio ?? "", uf: s.uf ?? "", matricula: s.matricula ?? "",
    rt: r?.nome ?? "", rtTitulo: (r?.formacao ?? "").toUpperCase(),
    rtRegistro: r ? [r.conselho_sigla || "CREA", r.conselho_numero || r.crea].filter(Boolean).join(": ") : "",
    credenciado: (cred as { data: { prefixo_vertice: string } | null }).data?.prefixo_vertice ?? "",
    trt: s.trt ?? r?.trt ?? "", fuso: s.fuso_utm ?? 24, logo,
  };
}

export function Entregas({ servico, projeto, res, perimetro, onExportou, onSalvar, onAbrir3D, onMudarInfra, onServico }: Props) {
  const [folha, setFolha] = useState<Folha>("A1");
  const [formato, setFormato] = useState<FormatoLocacao>("csv-nome-e-n");
  const [op, setOp] = useState<OpcoesLocacao>(LOCACAO_PADRAO);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carimbo, setCarimbo] = useState<DadosCarimbo | null>(null);

  const dadosRef = useRef<DadosClienteRef>(null);
  // empresa, logo e RT: relidos quando muda o RT ou o credenciado (os textos do
  // cliente entram na hora do pedido, de `textosDoServico`)
  useEffect(() => { carregarCarimbo(servico).then(setCarimbo).catch(() => setCarimbo(null)); }, [servico.id, servico.rt_id, servico.credenciado_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fuso = servico.fuso_utm ?? 24;
  // PVs, postes, hidrantes e o reservatório também vão para a coletora, se pedido
  const [locarRedes, setLocarRedes] = useState(false);
  // só para a contagem e a amostra na tela: o arquivo sai do servidor
  const pontos = useMemo(() => {
    const base0 = pontosDeLocacao(res, perimetro, op);
    if (!locarRedes) return base0;
    try { return [...base0, ...pontosDasRedes(res, calcularInfra(res, projeto))]; } catch { return base0; }
  }, [res, perimetro, op, locarRedes, projeto]);
  const erros = res.problemas.filter((p) => p.nivel === "erro").length;
  const den = escalaPara(res, folha);

  async function fazer(rotulo: string, f: () => Promise<void> | void) {
    setErro(null);
    setOcupado(rotulo);
    try {
      await new Promise((r) => setTimeout(r, 20));
      await f();
      onExportou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  /** Grava o projeto e pede o arquivo ao servidor (que gera a partir do banco). */
  async function antesDoServidor() {
    await dadosRef.current?.salvar();
    await onSalvar();
  }
  async function doServidor(saida: string, extra: Record<string, unknown> = {}) {
    await antesDoServidor();
    await baixarEntrega({ servico_id: servico.id, saida, ...extra });
  }
  const comCarimbo = async (situacao = false) => {
    const c = { ...(carimbo ?? await carregarCarimbo(servico)), ...textosDoServico(servico) };
    // planta de situação: satélite com o loteamento por cima (sem rede, sai sem)
    return carimboParaEnvio(situacao ? { ...c, situacao: await imagemSituacao(res, fuso) } : c);
  };

  // a planta abre no visualizador do sistema: dali se baixa, edita e salva no histórico
  const planta = () => fazer("planta", async () => {
    const corpo = { servico_id: servico.id, saida: "planta", folha, carimbo: await comCarimbo(true) };
    await antesDoServidor();
    const { blob, nome } = await arquivoDaFuncao("entregar", corpo);
    const base = nome.replace(/\.pdf$/i, "");
    abrirPlanta({ bytes: new Uint8Array(await blob.arrayBuffer()), nome: base, titulo: `Planta do loteamento · ${projeto.nome} · ${folha}`, servicoId: servico.id });
  });
  const locacao = () => fazer("locacao", () => doServidor("locacao", { formato, op, locarRedes }));
  const memoriais = () => fazer("memoriais", () => doServidor("memoriais"));
  const memorialGeral = () => fazer("memorial", async () => doServidor("memorial", { carimbo: await comCarimbo() }));

  const formatoAtual = FORMATOS.find((f) => f.id === formato)!;
  const amostra = formato === "dxf" ? "" : arquivoLocacao(pontos.slice(0, 6), formato);

  return (
    <div className="lot-entregas">
      {erros > 0 && (
        <div className="lot-alerta">
          {erros} pendência(s) em lotes (área ou frente abaixo do mínimo, lote sem frente). Dá para exportar, mas confira na etapa Projeto antes de enviar ao cliente.
        </div>
      )}
      {erro && <div className="lot-alerta erro">{erro}</div>}

      <DadosCliente ref={dadosRef} servico={servico} onMudar={(p) => onServico?.(p)} />

      {onAbrir3D && (
        <section className="lot-3d-chamada" onClick={onAbrir3D} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir3D(); } }}>
          <div className="lot-3d-chamada-texto">
            <span className="lot-3d-selo">NOVO · MAQUETE 3D</span>
            <h3>Veja o loteamento pronto, no relevo real</h3>
            <p>O terreno de hoje vira o projeto: ruas terraplenadas, {res.lotes.length} lotes com casas simuladas, áreas verdes arborizadas, a rede elétrica com postes, fios e transformadores, hidrantes, PVs e o reservatório. Declividade, corte e aterro, curvas de nível, as redes enterradas, voo de drone em vídeo e modelo 3D para Twinmotion/SketchUp.</p>
            <span className="lot-3d-botao">Abrir a maquete 3D →</span>
          </div>
          <div className="lot-3d-chamada-arte" aria-hidden>
            <svg viewBox="0 0 220 140">
              <defs>
                <linearGradient id="m3dceu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#ffd98a" /><stop offset="1" stopColor="#ff9f5a" /></linearGradient>
                <linearGradient id="m3dsolo" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8a5a33" /><stop offset="1" stopColor="#c28d5c" /></linearGradient>
              </defs>
              <circle cx="176" cy="28" r="14" fill="url(#m3dceu)" />
              <path d="M18 78 L110 40 L202 78 L110 116 Z" fill="#9cc283" />
              <path d="M18 78 L110 116 L110 132 L18 94 Z" fill="url(#m3dsolo)" />
              <path d="M202 78 L110 116 L110 132 L202 94 Z" fill="#6e4628" />
              <path d="M60 61 L152 99" stroke="#43474d" strokeWidth="7" />
              <path d="M98 45 L190 83" stroke="#43474d" strokeWidth="6" opacity="0.9" />
              {[[72, 74], [92, 82], [112, 90], [132, 98], [104, 56], [124, 64], [144, 72], [164, 80]].map(([x, y], i) => (
                <g key={i}><path d={`M${x} ${y} l7 -3 l7 3 l-7 3 z`} fill="#b36540" /><path d={`M${x} ${y} l0 5 l7 3 l0 -5 z`} fill="#f2e8dc" /><path d={`M${x + 14} ${y} l0 5 l-7 3 l0 -5 z`} fill="#d9cbb4" /></g>
              ))}
              {[[40, 80], [48, 84], [182, 82], [174, 86]].map(([x, y], i) => <circle key={i} cx={x} cy={y - 6} r="6" fill={i === 1 ? "#f2c230" : "#3f7d3a"} />)}
            </svg>
          </div>
        </section>
      )}

      <section className="bloco lot-entrega-cliente">
        <header><h3>Para o cliente e a prefeitura</h3><span className="desc">{res.lotes.length} lotes · {res.quadras.length} quadras · {fmt(res.quadro.gleba / 1e4, 4)} ha</span></header>
        <div className="lot-entrega-grade">
          <div className="lot-entrega-previa"><Miniatura res={res} largura={340} altura={240} /></div>
          <div className="lot-entrega-itens">
            <div className="lot-item">
              <div>
                <b>Planta do loteamento (PDF)<Dica>No padrão das plantas da equipe: legendas, convenções, quadro de áreas, planta de situação com satélite, carimbo com a logo, seção da rua e detalhe de esquina; lotes cotados e quadro de lotes nas folhas seguintes. Abre no visualizador: lá tem Editar planta (mover e trocar textos, quadros e carimbo), Baixar PDF e Salvar no histórico.</Dica></b>
                <span>Escala 1:{den}</span>
              </div>
              <select value={folha} onChange={(e) => setFolha(e.target.value as Folha)}>
                {(["A0", "A1", "A2", "A3"] as Folha[]).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button className="principal" disabled={!!ocupado} onClick={planta}>{ocupado === "planta" ? "Gerando…" : "Abrir"}</button>
            </div>
            <div className="lot-item">
              <div><b>Memorial descritivo do loteamento (DOCX)<Dica>Identificação, quadro de áreas, quadras, vias, áreas públicas (art. 9º §2º e art. 22 da Lei 6.766).</Dica></b></div>
              <button disabled={!!ocupado} onClick={memorialGeral}>{ocupado === "memorial" ? "Gerando…" : "Baixar"}</button>
            </div>
            <div className="lot-item">
              <div><b>Memoriais dos {res.lotes.length} lotes (DOCX)<Dica>Um por página: frente, lados e fundos com os confrontantes, e o perímetro vértice a vértice com coordenadas e azimutes.</Dica></b></div>
              <button disabled={!!ocupado} onClick={memoriais}>{ocupado === "memoriais" ? "Gerando…" : "Baixar"}</button>
            </div>
            <div className="lot-item">
              <div><b>Quadro de lotes (planilha)<Dica>Medidas e áreas de todos os lotes{projeto.params.precoM2 > 0 ? ", com o preço de cada um" : ""} — abre no Excel.</Dica></b></div>
              <button disabled={!!ocupado} onClick={() => fazer("quadro", () => doServidor("quadro"))}>Baixar</button>
            </div>
            <div className="lot-item">
              <div><b>Google Earth (KML)<Dica>O cliente abre no celular e vê os lotes sobre a imagem de satélite.</Dica></b></div>
              <button disabled={!!ocupado} onClick={() => fazer("kml", () => doServidor("kml"))}>Baixar</button>
            </div>
            <div className="lot-item">
              <div><b>Projeto em CAD (DXF)<Dica>Camadas separadas (perímetro, quadras, lotes, eixos, áreas, textos e cotas) em coordenadas UTM.</Dica></b></div>
              <button disabled={!!ocupado} onClick={() => fazer("dxf", () => doServidor("dxf", { op, locarRedes }))}>Baixar</button>
            </div>
          </div>
        </div>
      </section>

      <EntregasLotes servicoId={servico.id} res={res} base={nomeArquivo(projeto.nome)} onSalvar={antesDoServidor} carimbo={() => comCarimbo()} onExportou={onExportou} />

      <EntregasInfra projeto={projeto} res={res} onExportou={onExportou} onMudarInfra={onMudarInfra}
        pedir={async (saida, extra) => doServidor(saida, { ...extra, carimbo: await comCarimbo() })} />

      <section className="bloco lot-entrega-campo">
        <header><h3>Para o técnico de campo (coletora GNSS)<Dica>Pontos em UTM SIRGAS 2000 fuso {fuso}S, com o mesmo nome da planta e dos memoriais.</Dica></h3></header>
        <div className="lot-campo-grade">
          <div>
            <label className="lot-rotulo">Aparelho / formato</label>
            <div className="lot-formatos">
              {FORMATOS.map((f) => (
                <label key={f.id} className={formato === f.id ? "ativo" : ""}>
                  <input type="radio" checked={formato === f.id} onChange={() => setFormato(f.id)} />
                  <b>{f.nome}</b><span>{f.serve}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="lot-rotulo">O que locar</label>
            <div className="lot-checks">
              <label><input type="checkbox" checked={op.lotes} onChange={(e) => setOp({ ...op, lotes: e.target.checked })} /> Cantos dos lotes e das quadras</label>
              <label><input type="checkbox" checked={op.curvas} onChange={(e) => setOp({ ...op, curvas: e.target.checked })} /> Curvas de esquina (PC, meio e PT)</label>
              <label><input type="checkbox" checked={op.eixos} onChange={(e) => setOp({ ...op, eixos: e.target.checked })} /> Eixo das ruas, estaca a cada
                <input type="number" className="lot-estaca" value={op.estaca} min={5} step={5} onChange={(e) => setOp({ ...op, estaca: Math.max(5, Number(e.target.value) || 20) })} /> m</label>
              <label><input type="checkbox" checked={op.perimetro} onChange={(e) => setOp({ ...op, perimetro: e.target.checked })} /> Marcos do perímetro (conferência)</label>
              <label><input type="checkbox" checked={locarRedes} onChange={(e) => setLocarRedes(e.target.checked)} /> PVs, bocas de lobo, postes, hidrantes e reservatório (redes)</label>
            </div>
            <p className="lot-dica">
              <b>{pontos.length} pontos</b> — {pontos.filter((p) => p.tipo === "lote").length} de lote, {pontos.filter((p) => p.tipo === "curva").length} de curva,{" "}
              {pontos.filter((p) => p.tipo === "eixo").length} de eixo
              <Dica>Nome curto, sem acento (A-07 = ponto 7 da quadra A); o código traz os lotes que o ponto divide (QA L03/04). Cota estimada pelos marcos do perímetro, só para referência.</Dica>
            </p>
            {amostra && <pre className="lot-amostra">{amostra}{pontos.length > 6 ? "…" : ""}</pre>}
            <button className="principal grande" disabled={!!ocupado || !pontos.length} onClick={locacao}>
              {ocupado === "locacao" ? "Gerando…" : `Baixar arquivo de locação (.${formatoAtual.ext})`}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

