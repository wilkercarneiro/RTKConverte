// Entregas do loteamento: o que vai para o cliente (planta, memoriais, quadro,
// KML, DXF) e o que vai para a coletora do técnico (arquivo de locação).
// Tudo sai do MESMO resultado que está na tela — os nomes de ponto da locação
// são os mesmos da planta e dos memoriais.
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import { carregarEscritorio, pastaDoEscritorio } from "../../lib/escritorio";
import { fmt } from "../../lib/loteamento/calculo.ts";
import type { Perimetro, Resultado } from "../../lib/loteamento/calculo.ts";
import type { Projeto } from "../../lib/loteamento/modelo.ts";
import {
  FORMATOS, LOCACAO_PADRAO, arquivoLocacao, gerarDxf, gerarKml, memorialDoLote, nomesDosPontos, pontosDeLocacao,
  quadroDeLotesCsv,
} from "../../lib/loteamento/saidas.ts";
import type { FormatoLocacao, OpcoesLocacao } from "../../lib/loteamento/saidas.ts";
import { escalaPara, gerarPlantaPdf } from "../../lib/loteamento/planta.ts";
import type { DadosCarimbo, Folha } from "../../lib/loteamento/planta.ts";
import { gerarDocx } from "../../lib/loteamento/docx.ts";
import { imagemSituacao } from "../../lib/loteamento/situacao.ts";
import type { SecaoDocx } from "../../lib/loteamento/docx.ts";
import { fmtAzimute } from "../../../supabase/functions/_shared/geo.ts";
import { dist } from "../../lib/loteamento/geom.ts";
import type { RT, Servico } from "../../lib/types";
import { Miniatura } from "./Assistente";

interface Props {
  servico: Servico;
  projeto: Projeto;
  res: Resultado;
  perimetro: Perimetro;
  onExportou: () => void;
}

function baixar(dados: BlobPart, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([dados], { type: tipo }));
  const a = document.createElement("a");
  a.href = url; a.download = nome;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const nomeArquivo = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase() || "LOTEAMENTO";

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

export function Entregas({ servico, projeto, res, perimetro, onExportou }: Props) {
  const [folha, setFolha] = useState<Folha>("A1");
  const [formato, setFormato] = useState<FormatoLocacao>("csv-nome-e-n");
  const [op, setOp] = useState<OpcoesLocacao>(LOCACAO_PADRAO);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carimbo, setCarimbo] = useState<DadosCarimbo | null>(null);

  useEffect(() => { carregarCarimbo(servico).then(setCarimbo).catch(() => setCarimbo(null)); }, [servico]);

  const fuso = servico.fuso_utm ?? 24;
  const pontos = useMemo(() => pontosDeLocacao(res, perimetro, op), [res, perimetro, op]);
  const nomes = useMemo(() => nomesDosPontos(pontosDeLocacao(res, perimetro, LOCACAO_PADRAO)), [res, perimetro]);
  const base = nomeArquivo(projeto.nome);
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

  const planta = () => fazer("planta", async () => {
    const c = carimbo ?? await carregarCarimbo(servico);
    // planta de situação: satélite com o loteamento por cima (sem rede, sai sem)
    const situacao = await imagemSituacao(res, fuso);
    const bytes = await gerarPlantaPdf(res, projeto, perimetro, { ...c, situacao }, folha);
    baixar(bytes as unknown as BlobPart, `PLANTA_LOTEAMENTO_${base}_${folha}.pdf`, "application/pdf");
  });

  const locacao = () => fazer("locacao", () => {
    const f = FORMATOS.find((x) => x.id === formato)!;
    const sufixo = `SIRGAS2000_UTM${fuso}S`;
    if (formato === "dxf") baixar(gerarDxf(res, pontos), `LOCACAO_${base}_${sufixo}.dxf`, "application/dxf");
    else baixar(arquivoLocacao(pontos, formato), `LOCACAO_${base}_${sufixo}.${f.ext}`, "text/plain;charset=utf-8");
  });

  const memoriais = () => fazer("memoriais", async () => {
    const dados = { loteamento: projeto.nome, municipio: servico.municipio ?? "", uf: servico.uf ?? "", proprietario: servico.detentor_nome ?? "", fuso };
    const secoes: SecaoDocx[] = [];
    for (const q of res.quadras) for (const l of [...q.lotes].sort((a, b) => a.numero - b.numero)) {
      const m = memorialDoLote(l, res, nomes, dados);
      secoes.push({ titulo: "MEMORIAL DESCRITIVO", subtitulo: m.titulo, paragrafos: m.paragrafos, quebraAntes: secoes.length > 0 });
    }
    const blob = await gerarDocx(secoes, `${projeto.nome} — memoriais descritivos dos lotes`);
    baixar(blob, `MEMORIAIS_DOS_LOTES_${base}.docx`, blob.type);
  });

  const memorialGeral = () => fazer("memorial", async () => {
    const q = res.quadro;
    const pct = (v: number) => `${fmt((100 * v) / q.gleba)}%`;
    const p = projeto.params;
    const perimetroM = res.ladosGleba.reduce((s, l) => s + dist(l.a, l.b), 0);
    const c = carimbo ?? await carregarCarimbo(servico);
    const secoes: SecaoDocx[] = [
      {
        titulo: "MEMORIAL DESCRITIVO DO LOTEAMENTO",
        subtitulo: projeto.nome.toUpperCase(),
        paragrafos: [
          `1. IDENTIFICAÇÃO. Loteamento ${projeto.nome}, implantado em gleba${servico.denominacao ? ` denominada ${servico.denominacao}` : ""}${servico.matricula ? `, objeto da matrícula nº ${servico.matricula}` : ""}${servico.municipio ? `, no município de ${servico.municipio}${servico.uf ? `/${servico.uf}` : ""}` : ""}${servico.detentor_nome ? `, de propriedade de ${servico.detentor_nome}${servico.detentor_cpf ? ` (CPF/CNPJ ${servico.detentor_cpf})` : ""}` : ""}, com área total de ${fmt(q.gleba)} m² (${fmt(q.gleba / 1e4, 4)} ha) e perímetro de ${fmt(perimetroM)} m.`,
          `2. DESCRIÇÃO SUCINTA. O loteamento é composto de ${res.quadras.length} quadras e ${q.lotes.qtd} lotes, com lote padrão de ${fmt(p.frente)} m de frente por ${fmt(p.profundidade)} m de profundidade (${fmt(p.frente * p.profundidade)} m²), sistema viário com ${res.ruas.length} vias e ${res.publicas.length} áreas públicas, conforme o quadro de áreas abaixo.`,
        ],
        tabela: [
          ["Especificação", "Área (m²)", "%"],
          [`Lotes (${q.lotes.qtd})`, fmt(q.lotes.area), pct(q.lotes.area)],
          ["Sistema viário", fmt(q.viario), pct(q.viario)],
          ["Áreas verdes", fmt(q.verde + q.lazer), pct(q.verde + q.lazer)],
          ["Área institucional", fmt(q.institucional), pct(q.institucional)],
          ...(q.app > 0 ? [["APP / faixa non aedificandi", fmt(q.app), pct(q.app)]] : []),
          ...(q.sobras > 0 ? [["Remanescente", fmt(q.sobras), pct(q.sobras)]] : []),
          ["Total da gleba", fmt(q.gleba), "100,00%"],
        ],
      },
      {
        titulo: "3. CONDIÇÕES URBANÍSTICAS E RESTRIÇÕES",
        paragrafos: [
          `Lotes entre ${fmt(p.areaMin)} e ${fmt(p.areaMax)} m², com frente de ${fmt(p.frenteMin)} a ${fmt(p.frenteMax)} m e profundidade de ${fmt(p.profundidadeMin)} a ${fmt(p.profundidadeMax)} m (mínimos conforme a Lei Federal 6.766/79, art. 4º, II, observada a legislação municipal).`,
          `Vias com largura total de ${fmt(p.ruaLargura)} m, sendo ${fmt(p.ruaPista)} m de pista de rolamento e ${fmt(Math.max(0, (p.ruaLargura - p.ruaPista) / 2))} m de passeio de cada lado. ${p.esquina === "raio" ? `Esquinas concordadas em curva de raio ${fmt(p.esquinaValor)} m no alinhamento predial.` : p.esquina === "chanfro" ? `Esquinas chanfradas em ${fmt(p.esquinaValor)} m em cada alinhamento.` : ""}`,
          `Quadras com comprimento máximo de ${fmt(p.quadraCompMax, 0)} m.`,
          ...(q.app > 0 ? ["As faixas de preservação permanente e non aedificandi indicadas na planta não integram os lotes."] : []),
        ],
      },
      {
        titulo: "4. QUADRAS",
        paragrafos: [],
        tabela: [["Quadra", "Lotes", "Numeração", "Área dos lotes (m²)"], ...res.quadras.map((qq) => [qq.nome, String(qq.lotes.length), qq.lotes.length ? `01 a ${String(qq.lotes.length).padStart(2, "0")}` : "—", fmt(qq.lotes.reduce((s, l) => s + l.area, 0))])],
      },
      {
        titulo: "5. SISTEMA VIÁRIO",
        paragrafos: [],
        tabela: [["Via", "Largura (m)", "Extensão (m)", "Área (m²)"], ...res.ruas.map((r) => [r.nome, fmt(r.largura), fmt(r.comprimento, 1), fmt(r.area)])],
      },
      {
        titulo: "6. ÁREAS PÚBLICAS",
        paragrafos: ["Passam a integrar o domínio do Município, desde a data de registro do loteamento, as vias, as áreas verdes e as áreas destinadas a equipamentos comunitários abaixo (Lei 6.766/79, art. 22)."],
        tabela: [["Área", "m²", "% da gleba"], ...res.publicas.map((a) => [a.nome, fmt(a.area), pct(a.area)])],
      },
      {
        titulo: "7. PERÍMETRO DA GLEBA",
        paragrafos: res.ladosGleba.map((l, i) => {
          const az = (Math.atan2(l.b[0] - l.a[0], l.b[1] - l.a[1]) * 180) / Math.PI;
          const conf = l.tipo === "via" ? (l.nome || "estrada existente") : (perimetro.confrontantes[i] ?? "—");
          const de = perimetro.nomes?.[i] ?? `P${i + 1}`, ate = perimetro.nomes?.[(i + 1) % res.ladosGleba.length] ?? `P${((i + 1) % res.ladosGleba.length) + 1}`;
          return `Do vértice ${de} ao ${ate}: azimute ${fmtAzimute((az + 360) % 360)}, ${fmt(dist(l.a, l.b))} m, confrontando com ${conf}.`;
        }),
      },
      {
        titulo: "8. RESPONSABILIDADE TÉCNICA",
        paragrafos: [
          `${c.rt || "Responsável técnico"}${c.rtRegistro ? ` — ${c.rtRegistro}` : ""}${c.trt ? ` — ART/TRT ${c.trt}` : ""}.`,
          `Coordenadas no SGR SIRGAS 2000, projeção UTM fuso ${fuso}S; ${res.plano.terreno ? `distâncias e áreas no plano topográfico (fator de escala combinado k = ${res.plano.k.toFixed(8)})` : "distâncias e áreas no plano UTM"}.`,
          `${servico.municipio || ""}${servico.uf ? `/${servico.uf}` : ""}, ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}.`,
        ],
      },
    ];
    const blob = await gerarDocx(secoes, `${projeto.nome} — memorial descritivo do loteamento`);
    baixar(blob, `MEMORIAL_DO_LOTEAMENTO_${base}.docx`, blob.type);
  });

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

      <section className="bloco lot-entrega-cliente">
        <header><h3>Para o cliente e a prefeitura</h3><span className="desc">{res.lotes.length} lotes · {res.quadras.length} quadras · {fmt(res.quadro.gleba / 1e4, 4)} ha</span></header>
        <div className="lot-entrega-grade">
          <div className="lot-entrega-previa"><Miniatura res={res} largura={340} altura={240} /></div>
          <div className="lot-entrega-itens">
            <div className="lot-item">
              <div>
                <b>Planta do loteamento (PDF)</b>
                <span>No padrão das plantas da equipe: legendas, convenções, quadro de áreas, planta de situação com satélite, carimbo com a logo, seção da rua e detalhe de esquina; lotes cotados e quadro de lotes nas folhas seguintes. Escala 1:{den}.</span>
              </div>
              <select value={folha} onChange={(e) => setFolha(e.target.value as Folha)}>
                {(["A0", "A1", "A2", "A3"] as Folha[]).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button className="principal" disabled={!!ocupado} onClick={planta}>{ocupado === "planta" ? "Gerando…" : "Baixar"}</button>
            </div>
            <div className="lot-item">
              <div><b>Memorial descritivo do loteamento (DOCX)</b><span>Identificação, quadro de áreas, quadras, vias, áreas públicas (art. 9º §2º e art. 22 da Lei 6.766).</span></div>
              <button disabled={!!ocupado} onClick={memorialGeral}>{ocupado === "memorial" ? "Gerando…" : "Baixar"}</button>
            </div>
            <div className="lot-item">
              <div><b>Memoriais dos {res.lotes.length} lotes (DOCX)</b><span>Um por página: frente, lados e fundos com os confrontantes, e o perímetro vértice a vértice com coordenadas e azimutes.</span></div>
              <button disabled={!!ocupado} onClick={memoriais}>{ocupado === "memoriais" ? "Gerando…" : "Baixar"}</button>
            </div>
            <div className="lot-item">
              <div><b>Quadro de lotes (planilha)</b><span>Medidas e áreas de todos os lotes{projeto.params.precoM2 > 0 ? ", com o preço de cada um" : ""} — abre no Excel.</span></div>
              <button disabled={!!ocupado} onClick={() => fazer("quadro", () => baixar(quadroDeLotesCsv(res, projeto), `QUADRO_DE_LOTES_${base}.csv`, "text/csv;charset=utf-8"))}>Baixar</button>
            </div>
            <div className="lot-item">
              <div><b>Google Earth (KML)</b><span>O cliente abre no celular e vê os lotes sobre a imagem de satélite.</span></div>
              <button disabled={!!ocupado} onClick={() => fazer("kml", () => baixar(gerarKml(res, fuso, projeto.nome), `${base}.kml`, "application/vnd.google-earth.kml+xml"))}>Baixar</button>
            </div>
            <div className="lot-item">
              <div><b>Projeto em CAD (DXF)</b><span>Camadas separadas (perímetro, quadras, lotes, eixos, áreas, textos e cotas) em coordenadas UTM.</span></div>
              <button disabled={!!ocupado} onClick={() => fazer("dxf", () => baixar(gerarDxf(res, pontos), `PROJETO_${base}.dxf`, "application/dxf"))}>Baixar</button>
            </div>
          </div>
        </div>
      </section>

      <section className="bloco lot-entrega-campo">
        <header><h3>Para o técnico de campo (coletora GNSS)</h3><span className="desc">Pontos em UTM SIRGAS 2000 fuso {fuso}S, com o mesmo nome da planta e dos memoriais.</span></header>
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
            </div>
            <p className="lot-dica">
              <b>{pontos.length} pontos</b> — {pontos.filter((p) => p.tipo === "lote").length} de lote, {pontos.filter((p) => p.tipo === "curva").length} de curva,{" "}
              {pontos.filter((p) => p.tipo === "eixo").length} de eixo. Nome curto, sem acento (A-07 = ponto 7 da quadra A); o código traz os lotes que o ponto divide (QA L03/04).
              Cota estimada pelos marcos do perímetro, só para referência.
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

