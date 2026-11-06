// "Imagem: atual ▾" — controle pequeno, dentro do mapa, que troca a imagem de
// satélite pela de outra data (Esri World Imagery Wayback) e compara duas
// datas com uma cortina.
//
// Contrato: ({ mapa, centro }). Ele mesmo cria e troca a fonte raster por
// baixo das camadas do imóvel; quem usa só entrega o mapa e o centro da área.
// Com centro, as datas são procuradas logo (a lista já está pronta quando o
// usuário clica). Sem centro, procura no centro da vista, ao abrir.
//
// Só aparecem as datas em que a foto MUDOU naquele lugar (src/lib/imagem_data.ts),
// com a data real da captura quando a Esri informa.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Map as MapaGl } from "maplibre-gl";
import {
  anoImagem, aoTrocarFonte, citacao, citacaoAtual, dataBr, detalheImagem, fonteEmUso, fotoVelha, gms, idade, imagensDoLugar, PRIMEIRO_ANO,
  rotuloImagem, tileDoPonto,
} from "../../lib/imagem_data";
import type { ImagemLocal, Progresso, ResultadoLugar } from "../../lib/imagem_data";
import { avisar, Dica } from "../ui";
import { aplicarImagem, baixarBlob, capturarComCarimbo, esperarOcioso } from "./camada";
import { CortinaComparacao } from "./CortinaComparacao";
import "./imagem.css";

/** Marco do Código Florestal para área rural consolidada (Lei 12.651/2012, art. 3º, IV: ocupação PREEXISTENTE a esta data). */
const MARCO_2008 = "2008-07-22";

/** Landsat de 1984 até hoje no ponto (Google Earth Timelapse): a prova de 2008 que o acervo da Esri não tem. */
const urlTimelapse = (lon: number, lat: number) => `https://earthengine.google.com/timelapse#v=${lat.toFixed(5)},${lon.toFixed(5)},13,latLng`;
const ATUAL = "atual";

interface Props {
  mapa: MapaGl | null;
  /** centro da área [lon, lat]; null = centro da vista */
  centro: [number, number] | null;
  /** zoom em que a mudança é procurada (o que enquadra a área num tile); padrão 16 */
  zoom?: number;
}

type Estado =
  | { t: "ocioso" }
  | { t: "carregando"; prog: Progresso | null; parcial: ResultadoLugar | null }
  | { t: "pronto"; r: ResultadoLugar }
  | { t: "erro"; msg: string };

interface Lugar { lon: number; lat: number; z: number }

const hojeIso = () => new Date().toISOString().slice(0, 10);

/** Frase para o usuário (nunca a mensagem crua, em inglês): decide pelo tipo do erro. */
function motivo(e: unknown): string {
  console.warn("[imagem] busca das datas:", e);
  const nome = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  const m = e instanceof Error ? e.message : String(e);
  if (nome === "TimeoutError") return "O acervo da Esri demorou demais para responder. Ele costuma voltar em instantes.";
  if (nome === "TypeError" || /failed to fetch|network|load failed/i.test(m)) return "Sem conexão com o acervo da Esri (internet fora ou rede bloqueando o site da Esri).";
  if (/HTTP 5\d\d/.test(m)) return "O acervo da Esri está fora do ar agora.";
  return "O acervo da Esri não respondeu como esperado.";
}

/** Celular: o painel cobre o mapa, então fecha ao escolher para a foto aparecer. */
const telaEstreita = () => { try { return matchMedia("(max-width: 600px)").matches; } catch { return false; } };

async function copiarTexto(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sem permissão ou http */ }
  try {
    const t = document.createElement("textarea");
    t.value = texto; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    const ok = document.execCommand("copy");
    t.remove();
    return ok;
  } catch { return false; }
}

export function SeletorImagemData({ mapa, centro, zoom = 16 }: Props) {
  const [fonte, setFonte] = useState(fonteEmUso);
  useEffect(() => aoTrocarFonte(() => setFonte(fonteEmUso())), []);
  const [estado, setEstado] = useState<Estado>({ t: "ocioso" });
  const [lugar, setLugar] = useState<Lugar | null>(null);
  const [aberto, setAberto] = useState(false);
  const [escolha, setEscolha] = useState<number | null>(null);
  const [comparar, setComparar] = useState<{ antes: string; depois: string } | null>(null);
  const [baixando, setBaixando] = useState(false);
  // "Ver a evolução": passa as fotos da mais antiga até hoje, sozinho
  const [tocando, setTocando] = useState(false);
  const [longe, setLonge] = useState(false);
  const raizRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  // ---- procurar as datas -------------------------------------------------------
  const chaveCentro = centro ? `${centro[0].toFixed(6)},${centro[1].toFixed(6)},${zoom}` : "";
  const buscar = useCallback((l: Lugar) => {
    setLugar(l);
    setLonge(false);
  }, []);

  // com centro: procura logo (sem esperar o clique), um pouco depois de o mapa abrir
  useEffect(() => {
    if (!centro) return;
    const t = setTimeout(() => buscar({ lon: centro[0], lat: centro[1], z: zoom }), 700);
    return () => clearTimeout(t);
  }, [chaveCentro, fonte]); // eslint-disable-line react-hooks/exhaustive-deps

  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!lugar) return;
    const ctl = new AbortController();
    setEstado({ t: "carregando", prog: null, parcial: null });
    imagensDoLugar(lugar.lon, lugar.lat, lugar.z, {
      fonte, sinal: ctl.signal,
      aoProgredir: (p) => { if (!ctl.signal.aborted) setEstado((e) => (e.t === "carregando" ? { ...e, prog: p } : e)); },
      aoParcial: (r) => { if (!ctl.signal.aborted) setEstado((e) => ({ t: "carregando", prog: e.t === "carregando" ? e.prog : null, parcial: r })); },
      // uma data que estourou o prazo chegou depois: a lista se completa sozinha
      aoAtualizar: (r) => { if (!ctl.signal.aborted) setEstado((e) => (e.t === "pronto" ? { t: "pronto", r } : e)); },
    })
      .then((r) => { if (!ctl.signal.aborted) setEstado({ t: "pronto", r }); })
      .catch((e) => { if (!ctl.signal.aborted) setEstado({ t: "erro", msg: motivo(e) }); });
    return () => ctl.abort();
  }, [lugar, fonte, tentativa]);

  // sem centro: o usuário pode ter ido para outro lugar desde a busca
  useEffect(() => {
    if (!mapa || centro) return;
    const conferir = () => {
      if (!lugar) return;
      const c = mapa.getCenter();
      const a = tileDoPonto(c.lng, c.lat, lugar.z);
      const b = tileDoPonto(lugar.lon, lugar.lat, lugar.z);
      setLonge(Math.abs(a.x - b.x) > 1 || Math.abs(a.y - b.y) > 1);
    };
    mapa.on("moveend", conferir);
    return () => { mapa.off("moveend", conferir); };
  }, [mapa, centro, lugar]);

  function abrir() {
    setAberto((a) => !a);
    if (!lugar && mapa) {
      const c = mapa.getCenter();
      buscar({ lon: c.lng, lat: c.lat, z: Math.max(14, Math.min(17, Math.round(mapa.getZoom()))) });
    }
  }
  function buscarAqui() {
    if (!mapa) return;
    const c = mapa.getCenter();
    buscar({ lon: c.lng, lat: c.lat, z: Math.max(14, Math.min(17, Math.round(mapa.getZoom()))) });
  }

  const resultado = estado.t === "pronto" ? estado.r : estado.t === "carregando" ? estado.parcial : null;
  const todas = useMemo(() => resultado?.imagens ?? [], [resultado]);
  // A foto do mapa base de hoje, quando o tile é idêntico ao de uma versão: a
  // "Atual" ganha a data dela e some da lista como item repetido.
  const fotoHoje = resultado?.atualIgual != null ? todas.find((i) => i.release === resultado.atualIgual) ?? null : null;
  // as datas para ESCOLHER (a de hoje é o item "Atual")
  const imagens = useMemo(() => (fotoHoje ? todas.filter((i) => i !== fotoHoje) : todas), [todas, fotoHoje]);
  const atual = escolha == null ? null : imagens.find((i) => i.release === escolha || i.versoes.some((v) => v.release === escolha)) ?? null;
  const pos = atual ? imagens.indexOf(atual) : -1;
  /** o que está no mapa agora: a data escolhida ou, sem escolha, a foto de hoje (se confirmada) */
  const exibida = atual ?? fotoHoje;

  // ---- aplicar no mapa ---------------------------------------------------------
  const modeloDe = useCallback((valor: string) => (valor === ATUAL ? null : fonte.modeloTile(Number(valor))), [fonte]);
  useEffect(() => {
    if (!mapa) return;
    const modelo = comparar ? modeloDe(comparar.depois) : escolha != null ? fonte.modeloTile(escolha) : null;
    try { aplicarImagem(mapa, modelo, fonte.atribuicao); } catch (e) { console.warn("[imagem] não aplicou:", e); }
  }, [mapa, escolha, comparar, fonte, modeloDe]);
  // ao sair (o mapa continua), volta para a imagem de hoje
  useEffect(() => () => { if (mapa) try { aplicarImagem(mapa, null, ""); } catch { /* mapa já removido */ } }, [mapa]);
  // trocou de lugar e a data escolhida não existe aqui: volta para atual
  useEffect(() => { if (estado.t === "pronto" && escolha != null && !atual) setEscolha(null); }, [estado, escolha, atual]);

  useEffect(() => {
    if (!tocando || !mapa) return;
    const seq: (number | null)[] = [...imagens].reverse().map((i) => i.release);
    seq.push(null);
    let vivo = true;
    (async () => {
      for (const r of seq) {
        if (!vivo) return;
        setEscolha(r);
        // só passa para a próxima depois de a foto aparecer inteira (e ficar um pouco na tela)
        await new Promise((ok) => setTimeout(ok, 120));
        await esperarOcioso(mapa, 6000);
        await new Promise((ok) => setTimeout(ok, 1300));
      }
      if (vivo) setTocando(false);
    })();
    return () => { vivo = false; };
  }, [tocando]); // eslint-disable-line react-hooks/exhaustive-deps

  // marca o contêiner (CSS da cortina e do controle em tela cheia)
  useEffect(() => {
    if (!mapa) return;
    const c = mapa.getContainer();
    c.classList.toggle("imgdata-comparando", !!comparar);
    return () => c.classList.remove("imgdata-comparando");
  }, [mapa, comparar]);

  // ao abrir o painel, a data que está no mapa fica à vista (a lista rola)
  useEffect(() => {
    if (!aberto) return;
    // rola só a lista (scrollIntoView rolaria a página junto)
    const ul = listaRef.current;
    const el = ul?.querySelector<HTMLElement>(".imgdata-item.ativo")?.parentElement;
    if (!ul || !el) return;
    // a lista é position: relative (imagem.css): offsetTop é medido dentro dela
    const [topo, pe] = [el.offsetTop, el.offsetTop + el.offsetHeight];
    if (topo < ul.scrollTop) ul.scrollTop = topo;
    else if (pe > ul.scrollTop + ul.clientHeight) ul.scrollTop = pe - ul.clientHeight;
  }, [aberto, escolha]);

  // fechar o painel com Esc ou clique fora
  useEffect(() => {
    if (!aberto) return;
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    const fora = (e: PointerEvent) => { if (raizRef.current && !raizRef.current.contains(e.target as Node)) setAberto(false); };
    addEventListener("keydown", tecla);
    addEventListener("pointerdown", fora, true);
    return () => { removeEventListener("keydown", tecla); removeEventListener("pointerdown", fora, true); };
  }, [aberto]);

  if (!mapa) return null;
  const container = mapa.getContainer();
  const hoje = hojeIso();

  // ---- ações -------------------------------------------------------------------
  const ponto = (): [number, number] => {
    if (lugar) return [lugar.lon, lugar.lat];
    const c = mapa.getCenter();
    return [c.lng, c.lat];
  };
  function escolher(img: ImagemLocal | null, fechar = false) {
    setTocando(false);
    setEscolha(img ? img.release : null);
    // no celular o painel cobre o mapa: fecha para a foto escolhida aparecer (as setas ‹ › seguem na pílula)
    if (fechar && telaEstreita()) setAberto(false);
  }
  function passo(dir: 1 | -1) {
    // 1 = mais antiga, -1 = mais nova
    if (!imagens.length) return;
    if (pos < 0) { if (dir === 1) escolher(imagens[0]); return; }
    const novo = pos + dir;
    if (novo < 0) escolher(null);
    else if (novo < imagens.length) escolher(imagens[novo]);
  }
  function abrirComparacao() {
    if (!imagens.length) return;
    // antes = a foto mais antiga; depois = a data que está na tela (ou a de hoje)
    const maisAntiga = imagens[imagens.length - 1];
    setTocando(false);
    setComparar({ antes: String(maisAntiga.release), depois: atual && atual !== maisAntiga ? String(atual.release) : ATUAL });
    setAberto(false);
  }
  async function baixar() {
    const [lon, lat] = ponto();
    const e = exibida;
    const titulo = e
      ? `Imagem de satélite de ${rotuloImagem(e)}${e.captura ? ` (${detalheImagem(e)})` : ""}${e === fotoHoje ? " · a mesma do mapa de hoje" : ""}`
      : "Imagem de satélite atual (Esri World Imagery; data da foto não confirmada)";
    const agora = new Date();
    const linhas = [
      titulo,
      e
        ? `Fonte: Esri World Imagery Wayback, versão ${e.versao.identificador || e.release} (publicada em ${dataBr(e.versao.data)})`
        : "Fonte: Esri World Imagery (mapa base de hoje)",
      `Ponto: ${gms(lat, "lat")}, ${gms(lon, "lon")} (WGS 84) · gerado no Vertces em ${agora.toLocaleDateString("pt-BR")} às ${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`,
    ];
    setBaixando(true);
    try {
      const blob = await capturarComCarimbo(mapa!, linhas);
      const nome = e ? `imagem-${(e.captura?.data ?? e.versao.data)}.png` : `imagem-atual-${hoje}.png`;
      baixarBlob(blob, nome);
      avisar("ok", "Imagem baixada com a data e a fonte no rodapé.");
    } catch (e) {
      console.warn("[imagem] captura:", e);
      avisar("erro", "Não deu para gerar a imagem agora. Espere o mapa terminar de carregar e tente de novo.");
    } finally {
      setBaixando(false);
    }
  }
  async function copiar() {
    const [lon, lat] = ponto();
    const z = lugar?.z ?? Math.round(mapa!.getZoom());
    const ok = await copiarTexto(exibida ? citacao(exibida, lon, lat, hoje, z) : citacaoAtual(lon, lat, hoje));
    avisar(ok ? "ok" : "erro", ok ? "Fonte copiada. Cole no laudo, no memorial ou na declaração do CAR." : "O navegador não deixou copiar.");
  }

  // ---- textos do controle ------------------------------------------------------
  const carregando = estado.t === "carregando";
  const nDatas = imagens.length;
  const maisAntiga = imagens.length ? imagens[imagens.length - 1] : null;
  const anoMaisAntigo = maisAntiga ? anoImagem(maisAntiga) : null;
  const antesDoMarco = todas.find((i) => i.captura && i.captura.data < MARCO_2008);
  const datasPendentes = resultado?.datasPendentes ?? 0;
  const semDataExata = todas.filter((i) => !i.captura);
  const nFotos = todas.length;
  // a foto do mapa de hoje tem mais de 3 anos: não é "atual", é a mais recente que o acervo tem ali
  const velha = fotoVelha(fotoHoje, hoje);
  const rotuloHoje = velha ? "Mais recente disponível" : "Atual";
  const opcoes = [
    { valor: ATUAL, rotulo: fotoHoje ? `${rotuloHoje} · ${rotuloImagem(fotoHoje)}` : "Atual (hoje)" },
    ...imagens.map((i) => ({ valor: String(i.release), rotulo: rotuloImagem(i) })),
  ];
  const [lonP, latP] = lugar ? [lugar.lon, lugar.lat] : [mapa.getCenter().lng, mapa.getCenter().lat];

  const pilula = (
    <div className={`imgdata-pilula${atual ? " com-data" : ""}${!atual && velha ? " velha" : ""}`}>
      {tocando && (
        <button type="button" className="imgdata-seta parar" onClick={() => setTocando(false)} title="Parar a evolução" aria-label="Parar a evolução">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" /></svg>
        </button>
      )}
      {atual && !tocando && (
        <button type="button" className="imgdata-seta" onClick={() => passo(1)} disabled={pos >= imagens.length - 1}
          title="Imagem mais antiga" aria-label="Imagem mais antiga">‹</button>
      )}
      <button type="button" className="imgdata-botao" onClick={abrir} aria-expanded={aberto} aria-haspopup="dialog"
        title={velha && !atual && fotoHoje ? `A foto mais recente deste lugar é de ${rotuloImagem(fotoHoje)} (${idade(fotoHoje.captura!.data, hoje)}). Ver outras datas` : "Ver a imagem de satélite de outras datas"}>
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="imgdata-botao-texto">
          {atual ? <><small>{atual.captura ? "Imagem de" : "Imagem"}</small><b>{rotuloImagem(atual)}</b></>
            : fotoHoje ? <><small>{velha ? "Mais recente disponível ·" : "Imagem atual · de"}</small><b>{rotuloImagem(fotoHoje)}</b></>
              : <><small>Imagem</small><b>atual</b></>}
        </span>
        {!atual && nFotos > 1 && <em className="imgdata-contagem">{nFotos} datas</em>}
        {!atual && carregando && <i className="imgdata-girando" aria-label="procurando datas" />}
        {estado.t === "erro" && <em className="imgdata-contagem erro" title={estado.msg}>sem datas</em>}
        <span className="imgdata-v" aria-hidden="true">▾</span>
      </button>
      {atual && !tocando && (
        <button type="button" className="imgdata-seta" onClick={() => passo(-1)} title={pos === 0 ? "Voltar para a imagem de hoje" : "Imagem mais nova"}
          aria-label={pos === 0 ? "Voltar para a imagem de hoje" : "Imagem mais nova"}>›</button>
      )}
    </div>
  );

  const lista = (
    <div className="imgdata-painel" role="dialog" aria-label="Imagens de satélite deste lugar">
      <header>
        <b>Imagens deste lugar</b>
        <Dica lado="baixo">
          Acervo Esri World Imagery Wayback: cada versão publicada do mapa de satélite desde fevereiro de {PRIMEIRO_ANO}.
          Aqui aparecem só as datas em que a foto mudou no centro da área. A data é a da captura da foto, informada pela Esri;
          quando ela não informa, vale a data da versão.
        </Dica>
        <button type="button" className="imgdata-fechar" onClick={() => setAberto(false)} aria-label="Fechar">×</button>
      </header>

      {longe && (
        <button type="button" className="imgdata-aqui" onClick={buscarAqui}>Você saiu do lugar da busca. Procurar as datas aqui</button>
      )}

      {estado.t === "erro" ? (
        <div className="imgdata-estado erro" role="alert">
          <b>Não foi possível ver as datas</b>
          <p>{estado.msg}</p>
          <button type="button" onClick={() => setTentativa((n) => n + 1)}>Tentar de novo</button>
        </div>
      ) : estado.t === "pronto" && !nFotos ? (
        <div className="imgdata-estado">
          <b>Sem imagem antiga deste lugar</b>
          <p>O acervo da Esri não tem outras fotos aqui. Fica a imagem de hoje.</p>
        </div>
      ) : !nFotos ? (
        <div className="imgdata-estado carregando" aria-busy="true" aria-live="polite">
          <p>
            {estado.t === "carregando" && estado.prog?.etapa === "mudancas"
              ? `Procurando quando a foto mudou… (${estado.prog.feitas} ${estado.prog.feitas === 1 ? "versão conferida" : "versões conferidas"})`
              : estado.t === "carregando" && estado.prog?.etapa === "datas"
                ? `Lendo a data de cada foto… (${estado.prog.feitas} de ${estado.prog.total})`
                : "Abrindo o acervo de imagens…"}
          </p>
          {[0, 1, 2].map((i) => <div key={i} className="imgdata-esq" aria-hidden="true"><i /><span><i /><i /></span></div>)}
        </div>
      ) : (
        <>
          <div className="imgdata-resumo">
            <p>
              <b>{nFotos === 1 ? "1 foto" : `${nFotos} fotos diferentes`}{datasPendentes > 0 ? " até agora" : ""}</b>
              {resultado ? ` em ${resultado.totalVersoes} versões do acervo` : ""}
              {maisAntiga && nFotos > 1 ? (
                <>
                  {". A mais antiga: "}
                  <button type="button" className="imgdata-link" onClick={() => escolher(maisAntiga, true)}
                    title="Mostrar a foto mais antiga no mapa">{rotuloImagem(maisAntiga)} →</button>
                </>
              ) : anoMaisAntigo ? `, de ${anoMaisAntigo}.` : "."}
            </p>
            {nDatas >= 1 && (
              <button type="button" className="imgdata-tocar" onClick={() => { setAberto(false); setTocando(true); }}
                title="Passa as fotos da mais antiga até hoje, no mapa">
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor" /></svg>
                Ver a evolução
              </button>
            )}
          </div>
          <ul className="imgdata-lista" ref={listaRef}>
            <li>
              <button type="button" className={`imgdata-item${!atual ? " ativo" : ""}`} onClick={() => escolher(null, true)} aria-pressed={!atual}>
                <span className="imgdata-mini atual" aria-hidden="true">
                  {fonte.urlTileAtual && resultado ? <img src={fonte.urlTileAtual(resultado.tile)} alt="" loading="lazy" /> : null}
                </span>
                <span className="imgdata-item-texto">
                  <b className={velha ? "velha" : undefined}>{fotoHoje ? <>{rotuloHoje} · {rotuloImagem(fotoHoje)}</> : "Atual"}</b>
                  <small className={fotoHoje ? (velha ? "velha" : undefined) : "pendente"}>
                    {fotoHoje ? `${detalheImagem(fotoHoje)}${fotoHoje.captura ? ` · ${idade(fotoHoje.captura.data, hoje)}` : ""}` : datasPendentes || carregando ? "mapa base de hoje" : "mapa base de hoje · data não confirmada"}
                  </small>
                </span>
              </button>
            </li>
            {imagens.map((img) => {
              const ativo = atual === img;
              return (
                <li key={img.release}>
                  <button type="button" className={`imgdata-item${ativo ? " ativo" : ""}`} onClick={() => escolher(img, true)} aria-pressed={ativo}>
                    <span className="imgdata-mini" aria-hidden="true">
                      {resultado && <img src={fonte.urlTile(img.release, resultado.tile)} alt="" loading="lazy" />}
                    </span>
                    <span className="imgdata-item-texto">
                      <b>{rotuloImagem(img)}</b>
                      <small>{detalheImagem(img)}</small>
                    </span>
                    <span className="imgdata-idade">{img.captura ? idade(img.captura.data, hoje) : ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className={`imgdata-marco${antesDoMarco ? " ok" : ""}`}>
            {antesDoMarco
              ? <>Há foto anterior a 22/07/2008 ({rotuloImagem(antesDoMarco)}, no centro da área): pode servir de prova de área consolidada no CAR.{" "}
                  <button type="button" className="imgdata-link" onClick={() => escolher(antesDoMarco === fotoHoje ? null : antesDoMarco, true)}>Ver no mapa →</button></>
              : datasPendentes
                ? "Conferindo se há foto anterior a 22/07/2008…"
                : semDataExata.length
                  ? `A Esri não informou a data exata ${semDataExata.length === 1 ? `da foto ${rotuloImagem(semDataExata[0])}` : `de ${semDataExata.length} fotos`}: não dá para afirmar se alguma é anterior a 22/07/2008.`
                  : <>Sem foto da Esri anterior a 22/07/2008 (marco do CAR) aqui. Para a área consolidada, veja este ponto nas imagens Landsat (1984 até hoje) e clique em 2008:{" "}
                      <a className="imgdata-link" href={urlTimelapse(lonP, latP)} target="_blank" rel="noreferrer"
                        title="Google Earth Timelapse (Landsat), já no ponto do imóvel. Abre numa aba nova.">abrir o Landsat aqui →</a></>}
          </p>
          {datasPendentes > 0 && <p className="imgdata-nota" aria-live="polite">Lendo a data {datasPendentes === 1 ? "de mais 1 foto" : `de mais ${datasPendentes} fotos`}… a lista se completa sozinha.</p>}
          {resultado?.lento && !datasPendentes && <p className="imgdata-nota">O acervo da Esri está lento agora e a data de alguma foto não veio. Abra de novo daqui a pouco.</p>}
          {resultado?.incompleto && (
            <p className="imgdata-nota">
              Pode haver mais datas:{" "}
              {resultado.corte === "tempo" ? "o acervo demorou e a busca parou no limite de tempo."
                : resultado.corte === "falha" ? "o acervo falhou em parte das versões."
                  : "a busca parou no limite de consultas."}{" "}
              <button type="button" className="imgdata-link" onClick={() => setTentativa((n) => n + 1)}>Procurar de novo</button>
            </p>
          )}
        </>
      )}

      <footer>
        <button type="button" onClick={abrirComparacao} disabled={!nDatas} title="Duas datas no mesmo mapa, com uma divisa para arrastar">Comparar</button>
        <button type="button" onClick={baixar} disabled={baixando} title="PNG da vista com a data e a fonte no rodapé">{baixando ? "Gerando…" : <><span className="rot-longo">Baixar PNG</span><span className="rot-curto">PNG</span></>}</button>
        <button type="button" onClick={copiar} title={exibida ? `Fonte da imagem de ${rotuloImagem(exibida)} para o laudo ou o CAR` : "Fonte da imagem de hoje (data da foto não confirmada)"}><span className="rot-longo">Copiar fonte</span><span className="rot-curto">Fonte</span></button>
      </footer>
    </div>
  );

  return createPortal(
    <>
      {!comparar && (
        <div ref={raizRef} className="imgdata-controle">
          {pilula}
          {aberto && lista}
        </div>
      )}
      {comparar && (
        <CortinaComparacao
          mapa={mapa}
          modeloAntes={modeloDe(comparar.antes)}
          atribuicao={fonte.atribuicao}
          rotuloFonte={comparar.antes === ATUAL && comparar.depois === ATUAL ? "Imagem: © Esri World Imagery (hoje)" : fonte.atribuicao}
          opcoes={opcoes}
          antes={comparar.antes}
          depois={comparar.depois}
          onAntes={(v) => setComparar((c) => (c ? { ...c, antes: v } : c))}
          onDepois={(v) => setComparar((c) => (c ? { ...c, depois: v } : c))}
          onFechar={() => {
            // a data da direita continua no mapa: é a que o usuário estava olhando
            setEscolha(comparar.depois === ATUAL ? null : Number(comparar.depois));
            setComparar(null);
          }}
        />
      )}
    </>,
    container,
  );
}

