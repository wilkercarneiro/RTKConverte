// Cartão "Restrições do imóvel" (serviço GEO, etapa Confrontantes, e CAR): o
// perímetro cruzado com Terras Indígenas, Unidades de Conservação,
// assentamentos, quilombolas, embargos, faixa de fronteira, áreas militares e
// sítios arqueológicos (src/lib/restricoes.ts), com o relatório em PDF.
//
// Dentro do serviço nada disso cobra crédito: o serviço já pagou. A consulta
// sai sozinha quando o perímetro muda (com atraso, e guardada na aba), e o
// resultado vai também para o mapa interativo (onResultado).
import { useEffect, useRef, useState } from "react";
import proj4lib from "proj4";
import { GEO_DEF, utmDef } from "../../supabase/functions/_shared/geo.ts";
import {
  AVISO_RESTRICOES, consultarRestricoes, fmtData, previaRestricoes, resumoPrevia, resumoRestricoes, ROTULO_CLASSE, textoFonte, textoItem,
} from "../lib/restricoes";
import type { CamadaRestricao, LonLat, ResultadoRestricoes } from "../lib/restricoes";
import type { DadosRelatorioRestricoes } from "../lib/restricoes_pdf";
import { baixarBlob } from "../lib/entregas";
import { Dica } from "./ui";

const proj = proj4lib as unknown as (de: string, para: string, c: [number, number]) => [number, number];

/** Pontos E/N de um fuso para lon/lat (prévia do Novo serviço, antes de haver serviço). */
export function lonLatDeUtm(partes: { e: number; n: number }[][], fuso: number): LonLat[][] {
  const def = utmDef(fuso);
  return partes.map((a) => a.map((p) => proj(def, GEO_DEF, [p.e, p.n]) as LonLat)).filter((a) => a.length >= 3);
}

const chaveDe = (aneis: LonLat[][], fuso: number | null | undefined) =>
  `${fuso ?? ""}|${JSON.stringify(aneis.map((a) => a.map((p) => [Math.round(p[0] * 1e6), Math.round(p[1] * 1e6)])))}`;

// resultados desta aba: trocar de etapa e voltar não consulta tudo de novo
const cache = new Map<string, { em: number; p: Promise<ResultadoRestricoes> }>();
const VALIDADE_MS = 15 * 60 * 1000;

function consultarComCache(aneis: LonLat[][], fuso: number | null | undefined, forcar = false): Promise<ResultadoRestricoes> {
  const k = chaveDe(aneis, fuso);
  const c = cache.get(k);
  if (!forcar && c && Date.now() - c.em < VALIDADE_MS) return c.p;
  const p = consultarRestricoes(aneis, { fuso });
  const entrada = { em: Date.now(), p };
  cache.set(k, entrada);
  // resultado com base fora do ar não fica guardado: ao voltar, consulta de novo
  const largar = () => { if (cache.get(k) === entrada) cache.delete(k); };
  p.then((r) => { if (r.fontes.some((f) => f.classe === "nao_consultado")) largar(); }, largar);
  return p;
}

/** Hook comum ao cartão e à prévia: consulta com atraso quando o perímetro muda. */
function useRestricoes(aneis: LonLat[][], fuso: number | null | undefined, atrasoMs: number) {
  const [estado, setEstado] = useState<{ carregando: boolean; r: ResultadoRestricoes | null; erro: string | null }>({ carregando: false, r: null, erro: null });
  const [versao, setVersao] = useState(0);
  const forcar = useRef(false);
  const validos = aneis.filter((a) => a.length >= 3);
  const chave = chaveDe(validos, fuso);
  useEffect(() => {
    if (!validos.length) { setEstado({ carregando: false, r: null, erro: null }); return; }
    let vivo = true;
    setEstado((s) => ({ ...s, carregando: true, erro: null }));
    const t = setTimeout(() => {
      const f = forcar.current; forcar.current = false;
      consultarComCache(validos, fuso, f)
        .then((r) => { if (vivo) setEstado({ carregando: false, r, erro: null }); })
        .catch((e) => { if (vivo) setEstado({ carregando: false, r: null, erro: e instanceof Error ? e.message : String(e) }); });
    }, atrasoMs);
    return () => { vivo = false; clearTimeout(t); };
  }, [chave, versao]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...estado, deNovo: () => { forcar.current = true; setVersao((v) => v + 1); } };
}

const dataHora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
};

export function RestricoesImovel({ aneisLonLat, fuso, dados, onResultado, id = "bloco-restricoes", classe = "bloco restricoes" }: {
  /** o imóvel em lon/lat (um anel por parte/gleba) */
  aneisLonLat: LonLat[][];
  /** fuso UTM do serviço (a área sai nele) */
  fuso: number | null | undefined;
  /** identificação para o PDF */
  dados?: DadosRelatorioRestricoes;
  /** o resultado também vai para o mapa */
  onResultado?: (r: ResultadoRestricoes | null) => void;
  id?: string;
  /** classes do cartão (o CAR usa "car-cartao restricoes compacto", no painel estreito) */
  classe?: string;
}) {
  const { carregando, r, erro, deNovo } = useRestricoes(aneisLonLat, fuso, 900);
  const [gerando, setGerando] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const [abertas, setAbertas] = useState(false);
  useEffect(() => { onResultado?.(r); }, [r]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!aneisLonLat.some((a) => a.length >= 3)) return null;
  const resumo = r ? resumoRestricoes(r) : null;
  // verde só com TODAS as bases completas e livres (resumoRestricoes.estado)
  const classeGeral = resumo ? resumo.estado : "";
  const semResposta = resumo ? resumo.naoConsultadas.length + resumo.incompletas.length : 0;
  // livres ficam recolhidas: o que importa aparece primeiro
  const comAlgo = r ? r.fontes.filter((f) => f.classe !== "livre") : [];
  const livres = r ? r.fontes.filter((f) => f.classe === "livre") : [];

  async function baixarPdf() {
    if (!r) return;
    setGerando(true); setErroPdf(null);
    try {
      const { gerarPdfRestricoes, nomeArquivoRestricoes } = await import("../lib/restricoes_pdf");
      const bytes = await gerarPdfRestricoes(r, aneisLonLat.filter((a) => a.length >= 3), dados ?? {});
      baixarBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), nomeArquivoRestricoes(r, dados?.imovel));
    } catch (e) {
      setErroPdf(e instanceof Error ? e.message : String(e));
    } finally {
      setGerando(false);
    }
  }

  return (
    <section className={`${classe} ${classeGeral}`} id={id}>
      <header>
        <h3>Restrições do imóvel<Dica>
          O perímetro é cruzado, na hora, com as bases públicas de Terras Indígenas (FUNAI), Unidades de Conservação (CNUC/MMA),
          assentamentos e territórios quilombolas (INCRA), áreas embargadas (IBAMA e ICMBio), faixa de fronteira (IBGE),
          áreas militares e sítios arqueológicos (IPHAN). “Sobrepõe” mostra a área e o percentual do imóvel dentro de cada uma;
          “encosta”, a distância quando está a até {r ? r.encostaM : 300} m. As áreas saem em UTM no fuso do serviço, como a área do imóvel.
          Não gasta crédito.
        </Dica></h3>
        <span className="desc">{carregando ? "consultando as bases públicas…" : resumo ? resumo.texto : erro ?? ""}</span>
        <span className="esticar" />
        <button type="button" className="fantasma" disabled={carregando} onClick={deNovo} title="Consulta todas as bases de novo">Consultar de novo</button>
        <button type="button" disabled={!r || gerando || carregando} onClick={() => void baixarPdf()}
          title="Relatório com croqui, resultado por base, data da consulta e as fontes">{gerando ? "Gerando…" : "Baixar PDF"}</button>
      </header>
      {carregando && !r && <div className="restricoes-carregando"><span className="spinner" /> FUNAI, MMA, INCRA, IBAMA, ICMBio, IBGE e IPHAN…</div>}
      {r && (
        <div className="restricoes-lista">
          {comAlgo.map((f) => (
            <article key={f.tipo} className={`restricao-fonte ${f.classe}`}>
              <div className="restricao-cabeca">
                <span className="restricao-cor" style={{ background: f.cor }} aria-hidden />
                <span className={`restricao-selo ${f.classe}`}>{ROTULO_CLASSE[f.classe]}</span>
                <b>{f.rotulo}</b>
                <span className="sub">{f.orgao}</span>
                <Dica>{f.nota}{f.servidor ? ` Servidor: ${f.servidor}.` : ""}{f.atualizacao ? ` Registro mais recente atualizado em ${fmtData(f.atualizacao)}.` : ""}</Dica>
              </div>
              <p className="restricao-texto">{textoFonte(f, r.encostaM)}{f.cortada && f.classe !== "incompleta" ? " (há mais áreas na vizinhança do que as listadas)" : ""}</p>
              {f.itens.length > 0 && (
                <ul className="restricao-itens">
                  {f.itens.map((it) => (
                    <li key={it.id} className={it.classe}>
                      <span><b>{it.nome}</b> — {textoItem(it)}</span>
                      {it.detalhes.length > 0 && <small>{it.detalhes.join(" · ")}</small>}
                    </li>
                  ))}
                </ul>
              )}
              {f.motivo && f.classe !== "nao_consultado" && <p className="sub pequeno">{f.motivo}</p>}
            </article>
          ))}
          {livres.length > 0 && (
            <div className="restricoes-livres">
              <button type="button" className="link" onClick={() => setAbertas((v) => !v)} aria-expanded={abertas}>
                {abertas ? "▾" : "▸"} {livres.length === r.fontes.length ? "Todas as bases" : `${livres.length} base(s)`} sem nada a menos de {r.encostaM} m
              </button>
              {abertas
                ? <ul>{livres.map((f) => <li key={f.tipo} title={f.servidor ?? undefined}><span className="restricao-cor" style={{ background: f.cor }} aria-hidden /> {f.rotulo} <span className="sub">· {f.orgao}</span></li>)}</ul>
                : <span className="sub"> {livres.map((f) => f.singular).join(", ")}</span>}
              {semResposta > 0 && (
                <p className="restricoes-aviso-incompleta" role="note">
                  Consulta incompleta: {semResposta} de {r.fontes.length} base(s) sem resposta completa (listadas acima). Nelas não dá para dizer que o imóvel está livre.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {erroPdf && <div className="erro" role="alert">PDF não gerado: {erroPdf}</div>}
      {r && (
        <p className="restricoes-rodape sub">
          Consulta em {dataHora(r.quando)} · não substitui certidão<Dica>{AVISO_RESTRICOES}</Dica>
        </p>
      )}
    </section>
  );
}

/** Legenda das camadas de restrição no mapa (cor por tipo). */
export function LegendaRestricoes({ camadas }: { camadas: CamadaRestricao[] }) {
  const tipos = [...new Map(camadas.map((c) => [c.tipo, c])).values()];
  if (!tipos.length) return null;
  return (
    <div className="legenda-restricoes" aria-label="Legenda das restrições no mapa">
      {tipos.map((c) => <span key={c.tipo}><i style={{ background: c.cor }} aria-hidden />{c.rotulo}</span>)}
      <span className="sub">tom forte = parte do imóvel dentro</span>
    </div>
  );
}

/**
 * A PRÉVIA GRÁTIS do Novo serviço (antes de gastar crédito): por tipo, só
 * "tem / não tem sobreposição". Nome, área, % e o PDF ficam para o serviço.
 */
export function PreviaRestricoes({ aneisLonLat, fuso }: { aneisLonLat: LonLat[][]; fuso: number | null }) {
  const { carregando, r, deNovo } = useRestricoes(aneisLonLat, fuso, 1500);
  if (!aneisLonLat.some((a) => a.length >= 3)) return null;
  const previa = r ? previaRestricoes(r) : [];
  const resumo = resumoPrevia(previa);
  return (
    <div className="lt-bloco previa-restricoes">
      <h4>Áreas protegidas e especiais <span className="previa-gratis">prévia grátis</span><Dica lado="baixo">
        Antes de criar o serviço, o sistema confere se o perímetro sobrepõe Terra Indígena, Unidade de Conservação,
        assentamento, território quilombola, área embargada, faixa de fronteira, área militar ou sítio arqueológico.
        No serviço aparecem o nome de cada área, a área sobreposta, o percentual e o relatório em PDF — sem crédito extra.
      </Dica></h4>
      {carregando && !r && <p className="sub"><span className="spinner" /> consultando as bases públicas…</p>}
      {r && (
        <>
          <p className={`previa-resumo ${resumo.classe}`}>{resumo.texto}</p>
          <ul className="previa-chips">
            {previa.map((p) => (
              <li key={p.tipo} className={p.incompleta ? "incompleta" : p.tem === null ? "nulo" : p.tem ? "tem" : "nao"}>
                <i style={{ background: p.cor }} aria-hidden /><span>{p.rotulo}</span><b>{p.incompleta ? "incompleta" : p.tem === null ? "não consultado" : p.tem ? "tem sobreposição" : "não tem"}</b>
              </li>
            ))}
          </ul>
          <p className="sub pequeno">
            Nome das áreas, hectares, % e o PDF ficam no serviço.
            {previa.some((p) => p.tem === null) && <> <button type="button" className="link" onClick={deNovo}>consultar de novo</button></>}
          </p>
        </>
      )}
    </div>
  );
}

