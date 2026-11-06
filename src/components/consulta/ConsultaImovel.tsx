// Consultar imóvel (#/consulta), no grupo Ferramentas do menu: antes de fechar
// um serviço, o que existe naquele lugar — CAR, SIGEF, terra indígena, UC,
// assentamento, embargo, queimada, bioma, solo, chuva — sem abrir serviço e sem
// gastar crédito. Plano: docs/plano-ferramentas-campo-consulta-terraplanagem.md §1.
//
// Uma caixa só entende código do CAR, código do SIGEF, coordenada (decimal,
// GMS, UTM) e link do Google Maps; também dá para enviar o arquivo, desenhar no
// mapa, usar o GPS ou clicar no mapa. O resultado vira um serviço de CAR com um
// clique (src/lib/area_transferida.ts), sai em KML/SHP/DXF… e em PDF.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Rota } from "../../lib/rota";
import { pegarAreaTransferida, transferirArea } from "../../lib/area_transferida";
import { temPermissao } from "../../lib/permissoes";
import { baixarBlob } from "../../lib/entregas";
import type { CamadaRestricao, TipoRestricao } from "../../lib/restricoes";
import type { FeatureParcela } from "../../lib/sigef";
import { fecharAnel, multiPoligono } from "../../lib/sigef";
import { descreverPonto, interpretarEntrada } from "../../lib/consulta/entrada.ts";
import type { Entrada } from "../../lib/consulta/entrada.ts";
import { areaDoArquivo, textoDoArquivo } from "../../lib/consulta/arquivo.ts";
import { analiseCompleta, analiseVazia, CHAVES_FONTES, ehPropriaArea, fraseDaAnalise, resultadoParaGravar } from "../../lib/consulta/analise.ts";
import type { Analise, ChaveFonte } from "../../lib/consulta/analise.ts";
import { autointersecta, centroDe, circulo, fmtAreaCurta, fmtHa, maiorAnel, medir, pontoEmPoligonos, textoCruzamento } from "../../lib/consulta/geometria.ts";
import type { LonLat } from "../../lib/consulta/geometria.ts";
import { dadosDoPdf, diferencaDeArea, restricoesVazias, resumoEmTexto, textoConfrontantes } from "../../lib/consulta/relatorio.ts";
import { fontesReais } from "../../lib/consulta/fontes.ts";
import { fontesQueEsperavamUf, montarTarefas } from "../../lib/consulta/tarefas.ts";
import type { Tarefas } from "../../lib/consulta/tarefas.ts";
import type { FontesConsulta, RegistroConsulta, TipoEntrada } from "../../lib/consulta/fontes.ts";
import type { ImovelEncontrado, Resposta } from "../../lib/consulta/tipos.ts";
import { imovelDaAreaRecebida, origemParaOCar } from "../../lib/consulta/levada.ts";
import type { Municipio } from "../../lib/consulta/ambiente.ts";
import { MapaInterativo } from "../MapaInterativo";
import type { AlvoClique, InfoClique, PontoMapa } from "../MapaInterativo";
import { BotaoTelaCheia } from "../TelaCheia";
import { avisar, CabecalhoPagina, Dica, EstadoErro, EstadoVazio } from "../ui";
import { ICONE } from "../Icone";
import { BuscaConsulta, useToque } from "./BuscaConsulta";
import type { OrigemBusca } from "./BuscaConsulta";
import { BaixarArea } from "./BaixarArea";
import { PainelAnalise } from "./PainelAnalise";
import { lerLugar } from "../../lib/campo/lugar.ts";
import "./consulta.css";

interface EntradaBusca { texto: string; tipo: TipoEntrada; rotulo: string }
type Etapa = { nome: string; estado: "carregando" | "ok" | "falhou"; texto?: string };

type Busca =
  | { fase: "ocioso" }
  | { fase: "buscando"; entrada: EntradaBusca; ponto: LonLat | null; etapas: Etapa[] }
  | { fase: "resultado"; entrada: EntradaBusca; imoveis: ImovelEncontrado[]; ponto: LonLat | null; falhas: string[]; avisos: string[]; municipio: Municipio | null };

const EXEMPLOS = [
  { rotulo: "CAR de Lençóis/BA", texto: "BA-2919306-4185CFD257C54A4788F5C145A504C5C8" },
  { rotulo: "Coordenada", texto: "-12.40, -41.20" },
  { rotulo: "GMS", texto: "12°24'00\"S 41°12'00\"W" },
  { rotulo: "UTM", texto: "24L 260000 8628000" },
];

const SELO: Record<string, string> = { car: "CAR · declarado", sigef: "SIGEF · certificado", arquivo: "Arquivo", desenho: "Desenho", campo: "Medição de campo" };
const consultavel = (e: Entrada) => e.tipo === "car" || e.tipo === "sigef" || e.tipo === "coordenada";

/** Abaixo deste zoom (o Brasil, o estado) não dá para ver cerca: o desenho aproxima antes de marcar vértice. */
const ZOOM_MIN_DESENHO = 12;
const ZOOM_DESENHO = 15;
const AVISO_APROXIMAR = "Aproxime até ver as cercas: o mapa chegou mais perto para você marcar os vértices.";

type EstadoLaudo = { estado: "pronto" | "gravando" | "escrevendo" | "indisponivel"; motivo?: string };
/** A consulta de antes de "Consultar este vizinho": volta como estava, com a análise pronta. */
interface Retrato { rotulo: string; texto: string; busca: Busca; selId: string | null; analise: Analise | null; registroId: string | null; laudo: EstadoLaudo }

/** O que vai no #/consulta?q= desta busca (só o que a caixa entende de novo: CAR, SIGEF, coordenada). */
function qDaEntrada(ent: { texto: string; tipo: TipoEntrada }): string | null {
  if (ent.tipo !== "car" && ent.tipo !== "sigef" && ent.tipo !== "coordenada") return null;
  const e = interpretarEntrada(ent.texto);
  if (e.tipo === "car" || e.tipo === "sigef") return e.codigo;
  return e.tipo === "coordenada" ? ent.texto.trim() : null;
}

const quando = (iso: string) => {
  const d = new Date(iso), hoje = new Date();
  const h = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoje.toDateString()) return `hoje ${h}`;
  if (d.toDateString() === new Date(hoje.getTime() - 864e5).toDateString()) return `ontem ${h}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${h}`;
};

/** A geometria guardada no histórico → contornos lon/lat. */
const aneisDe = (g: GeoJSON.MultiPolygon | null): LonLat[][] =>
  (g?.coordinates ?? [])
    .map((pol) => (pol[0] ?? []).map((p) => [p[0], p[1]] as LonLat))
    .map((a) => (a.length > 1 && a[0][0] === a[a.length - 1][0] && a[0][1] === a[a.length - 1][1] ? a.slice(0, -1) : a))
    .filter((a) => a.length >= 3);

/** O imóvel do SIGEF como a camada de parcelas do mapa espera. */
function parcelaDoMapa(im: ImovelEncontrado): FeatureParcela {
  const c = centroDe(im.aneis) ?? im.aneis[0][0];
  return {
    type: "Feature", id: 0,
    properties: { codigo: im.codigo ?? im.id, nome: im.titulo, uf: im.uf, municipio: im.municipio, situacao: im.situacao, area_ha: im.areaDeclaradaHa, fonte: "sigef", centro: c },
    geometry: { type: "MultiPolygon", coordinates: im.poligonos.map((pol) => pol.map((a) => fecharAnel(a))) },
  };
}

const rotuloCurto = (im: ImovelEncontrado) => (im.fonte === "car" && im.codigo ? `${im.codigo.slice(0, 17)}…` : im.titulo);

export function ConsultaImovel({ ir, fontes = fontesReais, inicial, atualizarEndereco = true }: {
  ir: (r: Rota) => void;
  /** troca das fontes (o laboratório usa respostas gravadas) */
  fontes?: FontesConsulta;
  /** consulta já ao abrir (#/consulta?q=…) */
  inicial?: string;
  /** grava a consulta no endereço (#/consulta?q=…), para voltar ou mandar o link */
  atualizarEndereco?: boolean;
}) {
  const [texto, setTexto] = useState(inicial ?? "");
  const [busca, setBusca] = useState<Busca>({ fase: "ocioso" });
  const [selId, setSelId] = useState<string | null>(null);
  const [analise, setAnalise] = useState<Analise | null>(null);
  const [registroId, setRegistroId] = useState<string | null>(null);
  const [laudo, setLaudo] = useState<EstadoLaudo>({ estado: "gravando" });
  const [desenho, setDesenho] = useState<LonLat[] | null>(null);
  /** clique fora do imóvel com uma análise aberta: pergunta antes de trocar a tela */
  const [pontoPend, setPontoPend] = useState<LonLat | null>(null);
  /** desenhar sem lugar nenhum no mapa (o Brasil inteiro): primeiro "Onde fica o imóvel?" */
  const [ondeDesenhar, setOndeDesenhar] = useState(false);
  /** leva o mapa ao lugar digitado ou ao "Onde estou" do desenho */
  const [irPara, setIrPara] = useState<{ lonlat: LonLat; zoom: number; chave: number } | null>(null);
  const [historico, setHistorico] = useState<Resposta<RegistroConsulta[]>>({ estado: "carregando" });
  const [arrastando, setArrastando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  /** o vizinho tocado no mapa (CAR ou parcela do SIGEF): o balão "Consultar este vizinho" */
  const [vizinho, setVizinho] = useState<(AlvoClique & { ponto: LonLat }) | null>(null);
  /** as consultas de antes dos vizinhos: "← Voltar para …" */
  const [pilha, setPilha] = useState<Retrato[]>([]);
  /** a vista do mapa (centro, zoom): o desenho não marca vértice na escala do Brasil */
  const vistaRef = useRef<{ centro: LonLat; zoom: number } | null>(null);
  // começa "perto": sem WebGL o mapa não abre e a dica do desenho não pode ficar presa em "Aproxime…"
  const [longe, setLonge] = useState(false);
  const toque = useToque();
  const verbo = toque ? "Toque" : "Clique";
  const corrida = useRef(0);
  /** a busca da vez (código, ponto, GPS, exemplo): a resposta de uma busca velha é descartada */
  const buscaVez = useRef(0);
  const gravadoEm = useRef<string | null>(null);
  /** a linha do histórico de CADA análise (chave: analise.quando), já gravada ou em gravação: o UPDATE
   *  vai sempre para a linha da própria análise, e "tentar de novo" antes do INSERT voltar não duplica */
  const registros = useRef(new Map<string, Promise<string | null>>());
  const tarefasRef = useRef<Tarefas | null>(null);

  const imoveis = busca.fase === "resultado" ? busca.imoveis : [];
  const sel = imoveis.find((i) => i.id === selId) ?? null;
  const ocupado = busca.fase === "buscando";

  const carregarHistorico = useCallback(() => {
    fontes.historico.listar().then(
      (xs) => setHistorico({ estado: "ok", dados: xs }),
      (e) => setHistorico({ estado: "falhou", motivo: e instanceof Error ? e.message : String(e) }),
    );
  }, [fontes]);

  // ------------------------------------------------------------- análise
  function rodar(k: ChaveFonte, id: number, tarefa: () => Promise<unknown>) {
    tarefa().then(
      (d) => { if (corrida.current === id) setAnalise((a) => (a ? { ...a, [k]: { estado: "ok", dados: d } } : a)); },
      (e) => { if (corrida.current === id) setAnalise((a) => (a ? { ...a, [k]: { estado: "falhou", motivo: e instanceof Error ? e.message : String(e) } } : a)); },
    );
  }

  function analisar(im: ImovelEncontrado, municipio: Municipio | null = null) {
    const id = ++corrida.current;
    const medidas = medir(im.aneis);
    const centro = centroDe(im.aneis)!;
    gravadoEm.current = null;
    setRegistroId(null);
    setLaudo({ estado: "gravando" });
    setAnalise(analiseVazia(im, medidas));
    const tarefas = montarTarefas(fontes, im, medidas, centro, municipio);
    tarefasRef.current = tarefas;
    for (const k of CHAVES_FONTES) rodar(k, id, tarefas[k]);
  }

  function tentar(k: ChaveFonte) {
    const t = tarefasRef.current;
    // a IA está escrevendo o laudo sobre os dados de agora: não troca os dados por baixo dela
    if (laudo.estado === "escrevendo") { avisar("alerta", "Espere o laudo terminar de ser escrito para consultar de novo."); return; }
    if (!t || !analise) { if (sel) analisar(sel); return; }
    // os dados vão mudar: o laudo antigo deixa de valer (o banco também o apaga ao regravar o resultado)
    setAnalise((a) => (a ? { ...a, [k]: { estado: "carregando" }, laudo: null } : a));
    // o laudo só sai depois que os dados novos forem guardados (e regrava mesmo que a fonte falhe de novo)
    gravadoEm.current = null;
    if (registroId) setLaudo({ estado: "gravando" });
    rodar(k, corrida.current, t[k]);
  }

  // outra busca ou outro imóvel: a pergunta "consultar este ponto?" deixa de valer
  useEffect(() => { setPontoPend(null); setVizinho(null); }, [busca.fase, selId]);

  // o Município voltou a responder (tentar de novo): o SIGEF que rodou sem a UF é refeito com ela
  useEffect(() => {
    if (!analise || laudo.estado === "escrevendo") return;
    for (const k of fontesQueEsperavamUf(analise)) tentar(k);
  }, [analise?.quando, analise?.municipio.estado]); // eslint-disable-line react-hooks/exhaustive-deps

  // terminou (ou terminou de novo, depois de "tentar de novo"): grava no histórico
  useEffect(() => {
    if (!analise || !analiseCompleta(analise)) return;
    const assinatura = `${analise.quando}|${CHAVES_FONTES.map((k) => analise[k].estado).join(",")}`;
    if (gravadoEm.current === assinatura) return;
    gravadoEm.current = assinatura;
    const f = fraseDaAnalise(analise);
    const ent = busca.fase === "resultado" ? busca.entrada : { texto: analise.imovel.titulo, tipo: "arquivo" as TipoEntrada, rotulo: analise.imovel.titulo };
    const mun = analise.municipio.estado === "ok" ? analise.municipio.dados : null;
    setLaudo((l) => (l.estado === "escrevendo" ? l : { estado: "gravando" }));
    const vez = corrida.current;
    const chave = analise.quando;
    const novo = {
      entrada: ent.texto, tipo: ent.tipo, rotulo: analise.imovel.titulo, codigo: analise.imovel.codigo,
      uf: mun?.uf ?? analise.imovel.uf, municipio: mun?.nome ?? analise.imovel.municipio,
      areaHa: Math.round(analise.medidas.areaM2) / 10_000, geometria: multiPoligono(analise.imovel.aneis),
      resumo: f.texto, tom: f.tom, resultado: resultadoParaGravar(analise),
    };
    // em fila, por análise: o 2º gravar (depois de "tentar de novo") espera o 1º e faz UPDATE na MESMA linha
    const anterior = registros.current.get(chave) ?? Promise.resolve(null);
    const p = anterior.catch(() => null).then((id) => fontes.historico.gravar(novo, id));
    registros.current.set(chave, p);
    p.then((id) => {
      carregarHistorico();
      if (corrida.current !== vez) return; // o usuário já foi para outra área: não mexe na tela dela
      if (id) { setRegistroId(id); setLaudo((l) => (l.estado === "escrevendo" ? l : { estado: "pronto" })); }
      else setLaudo({ estado: "indisponivel", motivo: "O histórico e o laudo chegam com a atualização do banco (0045). A consulta ficou guardada neste navegador." });
    }, (e) => {
      if (corrida.current !== vez) return;
      setLaudo({ estado: "indisponivel", motivo: `A consulta não foi guardada (${e instanceof Error ? e.message : String(e)}), então o laudo não pode ser escrito agora.` });
    });
  }, [analise]); // eslint-disable-line react-hooks/exhaustive-deps

  async function escreverLaudo(refazer = false) {
    if (!registroId || !analise) return;
    const vez = corrida.current;
    setLaudo({ estado: "escrevendo" });
    try {
      const l = await fontes.laudo(registroId, refazer);
      carregarHistorico();
      if (corrida.current !== vez) return;
      setAnalise((a) => (a ? { ...a, laudo: l } : a));
      setLaudo({ estado: "pronto" });
    } catch (e) {
      if (corrida.current !== vez) return;
      setLaudo({ estado: "pronto" });
      avisar("erro", e instanceof Error ? e.message : String(e));
    }
  }

  // ------------------------------------------------------------- busca
  function mostrar(entrada: EntradaBusca, achados: ImovelEncontrado[], extra: { ponto?: LonLat | null; falhas?: string[]; avisos?: string[]; municipio?: Municipio | null } = {}) {
    setBusca({ fase: "resultado", entrada, imoveis: achados, ponto: extra.ponto ?? null, falhas: extra.falhas ?? [], avisos: extra.avisos ?? [], municipio: extra.municipio ?? null });
    setDesenho(null);
    if (achados.length === 1) { setSelId(achados[0].id); analisar(achados[0], extra.municipio ?? null); }
    else { setSelId(null); setAnalise(null); corrida.current++; }
  }

  function guardarEndereco(t: string) {
    if (!atualizarEndereco) return;
    try { history.replaceState(null, "", `#/consulta?q=${encodeURIComponent(t)}`); } catch { /* sem history: segue */ }
  }

  async function consultar(e: Entrada, original: string) {
    if (e.tipo === "car") {
      const vez = ++buscaVez.current;
      const entrada: EntradaBusca = { texto: original, tipo: "car", rotulo: `CAR ${e.codigo}` };
      guardarEndereco(e.codigo);
      setBusca({ fase: "buscando", entrada, ponto: null, etapas: [{ nome: "CAR (SICAR)", estado: "carregando" }] });
      try {
        const achados = await fontes.carPorCodigo(e.codigo);
        if (buscaVez.current !== vez) return;
        mostrar(entrada, achados, achados.length ? {} : { avisos: [`O SICAR não tem o código ${e.codigo} publicado. Confira o código no recibo; imóvel cancelado ou recém-inscrito pode não aparecer na base pública.`] });
      } catch (err) {
        if (buscaVez.current !== vez) return;
        mostrar(entrada, [], { falhas: [`O SICAR não respondeu (${err instanceof Error ? err.message : String(err)}).`] });
      }
      return;
    }
    if (e.tipo === "sigef") {
      const vez = ++buscaVez.current;
      const entrada: EntradaBusca = { texto: original, tipo: "sigef", rotulo: `Parcela SIGEF ${e.codigo.slice(0, 8)}…` };
      guardarEndereco(e.codigo);
      setBusca({ fase: "buscando", entrada, ponto: null, etapas: [{ nome: "SIGEF (base do sistema)", estado: "carregando" }] });
      try {
        const im = await fontes.sigefPorCodigo(e.codigo);
        if (buscaVez.current !== vez) return;
        mostrar(entrada, im ? [im] : [], im ? {} : { avisos: ["A base do sistema não tem esta parcela. Se ela foi certificada há pouco, consulte pela coordenada de um vértice: o INCRA é consultado na hora."] });
      } catch (err) {
        if (buscaVez.current !== vez) return;
        mostrar(entrada, [], { falhas: [`A busca no SIGEF falhou (${err instanceof Error ? err.message : String(err)}).`] });
      }
      return;
    }
    if (e.tipo === "coordenada") {
      guardarEndereco(original.trim());
      await consultarPonto(e.lon, e.lat, { texto: original, tipo: "coordenada", rotulo: `Ponto ${descreverPonto(e.lon, e.lat)}` }, e.aviso);
    }
  }

  async function consultarPonto(lon: number, lat: number, entrada: EntradaBusca, aviso?: string) {
    const vez = ++buscaVez.current;
    const ponto: LonLat = [lon, lat];
    const etapas: Etapa[] = [{ nome: "Município (IBGE)", estado: "carregando" }, { nome: "CAR (SICAR)", estado: "carregando" }, { nome: "SIGEF (INCRA)", estado: "carregando" }];
    const marcar = (i: number, estado: Etapa["estado"], t?: string) => {
      if (buscaVez.current !== vez) return; // etapa de uma busca velha não pinta a nova
      setBusca((b) => (b.fase === "buscando" ? { ...b, etapas: b.etapas.map((x, j) => (j === i ? { ...x, estado, texto: t } : x)) } : b));
    };
    setBusca({ fase: "buscando", entrada, ponto, etapas });
    setSelId(null); setAnalise(null); corrida.current++;
    let municipio: Municipio | null = null;
    try { municipio = await fontes.municipio(lon, lat); marcar(0, "ok", municipio ? `${municipio.nome}/${municipio.uf}` : "fora de município"); }
    catch { marcar(0, "falhou", "não respondeu"); }
    if (buscaVez.current !== vez) return;
    const uf = municipio?.uf ?? null;
    const [car, sig] = await Promise.allSettled([
      fontes.carNoPonto(lon, lat, uf).then((x) => { marcar(1, "ok", x.length ? `${x.length} imóvel(is)` : "nenhum imóvel"); return x; }, (e) => { marcar(1, "falhou", "não respondeu"); throw e; }),
      fontes.sigefNoPonto(lon, lat, uf).then((x) => { marcar(2, "ok", x.imoveis.length ? `${x.imoveis.length} parcela(s)` : "nenhuma parcela"); return x; }, (e) => { marcar(2, "falhou", "não respondeu"); throw e; }),
    ]);
    if (buscaVez.current !== vez) return; // o usuário já pediu outra coisa (GPS, exemplo, outro ponto)
    const achados: ImovelEncontrado[] = [];
    const falhas: string[] = [];
    const avisos: string[] = aviso ? [aviso] : [];
    if (car.status === "fulfilled") achados.push(...car.value);
    else falhas.push(`O CAR (SICAR) não respondeu: ${car.reason instanceof Error ? car.reason.message : String(car.reason)}.`);
    if (sig.status === "fulfilled") {
      achados.push(...sig.value.imoveis);
      if (sig.value.online !== "ok" && !sig.value.imoveis.length) avisos.push(sig.value.online === "sem-uf" ? "SIGEF: só a base do sistema (falta a UF)." : "SIGEF: o INCRA não respondeu agora; valeu a base do sistema.");
    } else falhas.push(`O SIGEF não respondeu: ${sig.reason instanceof Error ? sig.reason.message : String(sig.reason)}.`);
    if (car.status === "fulfilled" && car.value.length > 1) avisos.push(`${car.value.length} CAR declarados contêm este ponto — sobreposição de declarações no SICAR.`);
    mostrar(entrada, achados, { ponto, falhas, avisos, municipio });
  }

  function consultarTexto(t: string) {
    setTexto(t);
    const e = interpretarEntrada(t);
    if (consultavel(e)) void consultar(e, t);
  }

  async function abrirArquivo(f: File) {
    if (f.size > 25 * 1024 * 1024) { avisar("erro", "Arquivo maior que 25 MB."); return; }
    try {
      const t = await textoDoArquivo(f.name, await f.arrayBuffer());
      const { imovel, avisos } = areaDoArquivo(f.name, t);
      setTexto("");
      buscaVez.current++;
      mostrar({ texto: f.name, tipo: "arquivo", rotulo: imovel.titulo }, [imovel], { avisos });
    } catch (e) {
      avisar("erro", `Não deu para ler ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function concluirDesenho() {
    if (!desenho || desenho.length < 3 || autointersecta(desenho)) return;
    const im: ImovelEncontrado = {
      id: `desenho:${Date.now()}`, fonte: "desenho", codigo: null, titulo: "Área desenhada", aneis: [desenho], poligonos: [[desenho]], furos: 0,
      areaDeclaradaHa: null, municipio: null, uf: null, atualizacao: null, situacao: `${desenho.length} vértices marcados no mapa`, detalhes: [],
    };
    const ha = medir([desenho]).areaM2 / 10_000;
    buscaVez.current++;
    mostrar({ texto: "desenho no mapa", tipo: "desenho", rotulo: "Área desenhada" }, [im],
      ha > 100_000 ? { avisos: [`Área de ${fmtAreaCurta(ha * 10_000)}: grande demais para um imóvel. Aproxime o mapa e desenhe pela divisa — algumas bases cortam a resposta em áreas assim.`] } : {});
  }

  function analisarEntorno(ponto: LonLat) {
    const anel = circulo(ponto, Math.sqrt(50_000 / Math.PI), 36);
    const im: ImovelEncontrado = {
      id: `entorno:${ponto.join(",")}`, fonte: "desenho", codigo: null, titulo: `Entorno do ponto ${descreverPonto(ponto[0], ponto[1])}`, aneis: [anel], poligonos: [[anel]], furos: 0,
      areaDeclaradaHa: null, municipio: null, uf: null, atualizacao: null, situacao: "Círculo de 5 ha em volta do ponto consultado", detalhes: [],
    };
    const ent = busca.fase === "resultado" ? busca.entrada : { texto: descreverPonto(ponto[0], ponto[1]), tipo: "coordenada" as TipoEntrada, rotulo: im.titulo };
    buscaVez.current++;
    mostrar(ent, [im], { ponto, municipio: busca.fase === "resultado" ? busca.municipio : null });
  }

  function ondeEstou() {
    if (!("geolocation" in navigator)) { avisar("erro", "Este navegador não dá a localização. Digite a coordenada ou clique no mapa."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => void consultarPonto(p.coords.longitude, p.coords.latitude,
        { texto: `${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`, tipo: "coordenada", rotulo: "Onde estou" },
        `Localização do aparelho (±${Math.round(p.coords.accuracy)} m).`),
      (e) => avisar("erro", e.code === e.PERMISSION_DENIED
        ? "O navegador bloqueou a localização. Libere em Configurações do site → Localização e tente de novo."
        : "Não deu para pegar a localização agora. Tente ao ar livre ou digite a coordenada."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }

  function selecionar(im: ImovelEncontrado) {
    if (im.id === selId) return;
    setSelId(im.id);
    setAnalise(null); corrida.current++;
  }

  /** O mapa vai para mais perto (zoom de ver cerca) no ponto, com o aviso. */
  function aproximar(p: LonLat) {
    setIrPara({ lonlat: p, zoom: ZOOM_DESENHO, chave: Date.now() });
    avisar("alerta", AVISO_APROXIMAR);
  }

  function aoClicarNoMapa(p: LonLat, info?: InfoClique) {
    if (desenho) {
      // na escala do Brasil/estado, um vértice cairia a quilômetros da cerca: aproxima primeiro
      if ((info?.zoom ?? vistaRef.current?.zoom ?? 99) < ZOOM_MIN_DESENHO) { setOndeDesenhar(false); aproximar(p); return; }
      setOndeDesenhar(false); setDesenho([...desenho, p]); return;
    }
    if (ocupado) return;
    // um vizinho (CAR ou parcela do SIGEF que não está na lista de resultados): o balão "Consultar este vizinho"
    // a parcela do SIGEF que é a própria área consultada (mesma_parcela) não é vizinho: o clique seleciona o imóvel
    const alvo = info?.alvo && !ehMesmaParcela(info.alvo.codigo) ? info.alvo : undefined;
    if (alvo && !imoveis.some((i) => i.codigo === alvo.codigo)) { setPontoPend(null); setVizinho({ ...alvo, ponto: p }); return; }
    setVizinho(null);
    const dentro = imoveis.find((i) => pontoEmPoligonos(p, i.poligonos));
    if (dentro) { setPontoPend(null); selecionar(dentro); return; }
    // com uma análise aberta, um clique para ler um rótulo (foco, restrição) não derruba a tela
    if (analise) { setPontoPend(p); return; }
    consultarAqui(p);
  }

  function ehMesmaParcela(codigo: string): boolean {
    return analise?.sigef.estado === "ok" && analise.sigef.dados.sobreposicoes.some((x) => x.mesma_parcela && x.codigo === codigo);
  }

  function consultarAqui(p: LonLat) {
    setPontoPend(null);
    const t = `${p[1].toFixed(6)}, ${p[0].toFixed(6)}`;
    setTexto(t);
    guardarEndereco(t);
    void consultarPonto(p[0], p[1], { texto: t, tipo: "coordenada", rotulo: `Ponto ${descreverPonto(p[0], p[1])}` });
  }

  /** Troca a consulta para o vizinho tocado no mapa; a de agora fica guardada para o "← Voltar". */
  function consultarVizinho(v: AlvoClique & { ponto: LonLat }) {
    setVizinho(null);
    if (busca.fase === "resultado") {
      const atual = analise?.imovel ?? sel;
      setPilha((ps) => [...ps.slice(-4), { rotulo: atual ? rotuloCurto(atual) : busca.entrada.rotulo, texto, busca, selId, analise, registroId, laudo }]);
    }
    const e = interpretarEntrada(v.codigo);
    if (consultavel(e)) { setTexto(v.codigo); void consultar(e, v.codigo); }
    else consultarAqui(v.ponto);
  }

  function voltarConsulta() {
    const r = pilha[pilha.length - 1];
    if (!r) return;
    setPilha(pilha.slice(0, -1));
    corrida.current++; buscaVez.current++;
    setTexto(r.texto); setBusca(r.busca); setSelId(r.selId);
    setDesenho(null); setPontoPend(null); setVizinho(null);
    if (r.busca.fase === "resultado") { const q = qDaEntrada(r.busca.entrada); if (q) guardarEndereco(q); }
    const im = r.analise?.imovel ?? (r.busca.fase === "resultado" ? r.busca.imoveis.find((i) => i.id === r.selId) : null) ?? null;
    if (r.analise && analiseCompleta(r.analise)) {
      // pronta: volta como estava, sem consultar de novo nem regravar o histórico
      const a = r.analise;
      gravadoEm.current = `${a.quando}|${CHAVES_FONTES.map((k) => a[k].estado).join(",")}`;
      tarefasRef.current = null;
      setAnalise(a); setRegistroId(r.registroId); setLaudo(r.laudo.estado === "escrevendo" ? { estado: "pronto" } : r.laudo);
    } else if (im) analisar(im, r.busca.fase === "resultado" ? r.busca.municipio : null);
    else setAnalise(null);
  }

  function limparTudo() {
    corrida.current++; buscaVez.current++;
    setBusca({ fase: "ocioso" }); setSelId(null); setAnalise(null); setDesenho(null); setPontoPend(null); setVizinho(null); setPilha([]); setTexto("");
    if (atualizarEndereco) { try { history.replaceState(null, "", "#/consulta"); } catch { /* segue */ } }
  }

  function abrirRegistro(r: RegistroConsulta) {
    const aneis = aneisDe(r.geometria);
    if (!aneis.length) { if (r.entrada) consultarTexto(r.entrada); return; }
    const base = r.resultado?.imovel;
    const im = {
      ...(base ?? { id: `hist:${r.id}`, fonte: r.tipo === "car" ? "car" : r.tipo === "sigef" ? "sigef" : "arquivo", codigo: r.codigo, titulo: r.rotulo, furos: 0, areaDeclaradaHa: null, municipio: r.municipio, uf: r.uf, atualizacao: null, situacao: null, detalhes: [] }),
      aneis, poligonos: aneis.map((a) => [a]),
    } as ImovelEncontrado;
    corrida.current++; buscaVez.current++;
    setTexto(r.tipo === "car" || r.tipo === "coordenada" || r.tipo === "sigef" ? r.entrada : "");
    setBusca({ fase: "resultado", entrada: { texto: r.entrada, tipo: r.tipo, rotulo: r.rotulo }, imoveis: [im], ponto: null, falhas: [], avisos: [], municipio: null });
    setSelId(im.id);
    setDesenho(null);
    if (r.resultado) {
      const res = r.resultado;
      const local = r.id.startsWith("local-");
      // consulta guardada antes do para_laudo (sem laudo ainda): regrava ao abrir, e o laudo fica disponível
      const semParaLaudo = !local && !r.laudo && !("para_laudo" in res);
      gravadoEm.current = semParaLaudo ? null : `${res.quando}|${CHAVES_FONTES.map((k) => res[k].estado).join(",")}`;
      registros.current.set(res.quando, Promise.resolve(local ? null : r.id));
      setAnalise({ ...res, imovel: im, laudo: r.laudo });
      setRegistroId(local ? null : r.id);
      setLaudo(local ? { estado: "indisponivel", motivo: "Consulta guardada só neste navegador: o laudo precisa da atualização do banco (0045)." } : { estado: "pronto" });
      tarefasRef.current = null;
    } else analisar(im);
  }

  async function apagarRegistro(r: RegistroConsulta) {
    try { await fontes.historico.apagar(r.id); carregarHistorico(); } catch (e) { avisar("erro", e instanceof Error ? e.message : String(e)); }
  }

  function criarCar() {
    const im = analise?.imovel ?? sel;
    if (!im) return;
    const anel = maiorAnel(im.aneis);
    if (!anel) return;
    const mun = analise?.municipio.estado === "ok" ? analise.municipio.dados : busca.fase === "resultado" ? busca.municipio : null;
    transferirArea({
      nome: im.fonte === "car" ? (mun?.nome ? `Imóvel em ${mun.nome}` : "Imóvel") : im.titulo,
      perimetro: anel, nomes: im.aneis.length === 1 ? im.nomes : undefined,
      // a medição de campo segue com a origem e a frase dela: o CAR diz o mesmo que no caminho direto do Campo
      ...origemParaOCar(im),
      uf: mun?.uf ?? im.uf ?? null, municipio: mun?.nome ?? im.municipio ?? null,
      // a área que a Consulta mostrou (todas as partes): o CAR diz o que ficou de fora
      areaOrigemM2: medir(im.aneis).areaM2, partes: im.aneis.length,
      // "← Voltar para a Consulta": pelo código/coordenada, ou mandando a área de novo (arquivo, desenho, campo)
      volta: (() => {
        const q = busca.fase === "resultado" ? qDaEntrada(busca.entrada) : null;
        return q ? { rotulo: "a Consulta", hash: `#/consulta?q=${encodeURIComponent(q)}` } : { rotulo: "a Consulta", hash: "#/consulta", reenviar: true };
      })(),
    });
    ir({ t: "novo", chave: "car" });
  }

  async function baixarPdf() {
    if (!analise) return;
    setGerandoPdf(true);
    try {
      const { gerarPdfRestricoes, nomeArquivoRestricoes } = await import("../../lib/restricoes_pdf");
      const r = analise.restricoes.estado === "ok" ? analise.restricoes.dados : restricoesVazias(analise);
      const bytes = await gerarPdfRestricoes(r, analise.imovel.aneis, dadosDoPdf(analise));
      baixarBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), nomeArquivoRestricoes(r, analise.imovel.codigo ?? analise.imovel.titulo, "consulta-imovel"));
    } catch (e) {
      avisar("erro", `PDF não gerado: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGerandoPdf(false);
    }
  }

  function copiar(t: string, ok: string) {
    (navigator.clipboard?.writeText(t) ?? Promise.reject(new Error("sem área de transferência")))
      .then(() => avisar("ok", ok), () => avisar("erro", "O navegador não deixou copiar."));
  }
  function copiarResumo() {
    if (!analise) return;
    copiar(resumoEmTexto(analise), "Copiado: o resumo, para colar no WhatsApp ou no e-mail do cliente.");
  }
  function copiarConfrontantes() {
    if (!analise) return;
    const { texto: t, total } = textoConfrontantes(analise);
    copiar(t, total ? `Copiado: ${total} confrontante${total > 1 ? "s" : ""} em potencial (SIGEF e CAR), pronto para o memorial ou a carta de anuência.`
      : "Copiado: nenhum confrontante certificado nem CAR encostando na área — o texto diz o que foi consultado.");
  }
  const qLink = busca.fase === "resultado" ? qDaEntrada(busca.entrada) : null;
  function copiarLink() {
    if (!qLink) return;
    const base = typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "";
    copiar(`${base}#/consulta?q=${encodeURIComponent(qLink)}`, "Copiado: o link desta consulta. Quem abrir (com login na empresa) vê a mesma área analisada.");
  }

  // ao começar o desenho, o mapa inteiro (com a barra Desfazer / Fechar a área) entra na vista
  const mapaCaixaRef = useRef<HTMLDivElement>(null);
  function rolarMapaParaVista() {
    // no celular o mapa fica abaixo da busca: "nearest" achava que já estava à vista e não rolava
    const celular = typeof window !== "undefined" && window.matchMedia?.("(max-width: 900px)").matches;
    requestAnimationFrame(() => {
      const el = mapaCaixaRef.current;
      if (!el) return;
      try {
        if (!celular) { el.scrollIntoView({ block: "nearest", behavior: "smooth" }); return; }
        // o alto do mapa logo abaixo da barra fixa do celular (com ela por cima, a tela cheia e a imagem por data sumiam)
        const topo = Math.max(0, document.querySelector<HTMLElement>(".tr-topo")?.getBoundingClientRect().bottom ?? 0);
        window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - topo - 8), behavior: "smooth" });
      } catch { /* navegador antigo */ }
    });
  }

  /** Começa o desenho. Sem nada no mapa (o Brasil inteiro), pergunta onde fica o imóvel antes. */
  function comecarDesenho() {
    setPontoPend(null);
    setDesenho([]);
    const temLugar = !!sel || imoveis.length > 0 || (busca.fase !== "ocioso" && !!busca.ponto) || !!irPara;
    setOndeDesenhar(!temLugar);
    rolarMapaParaVista();
  }
  function irParaDesenho(p: LonLat) {
    setIrPara({ lonlat: p, zoom: 16, chave: Date.now() });
    setOndeDesenhar(false);
  }
  function ondeEstouDesenho() {
    if (!("geolocation" in navigator)) { avisar("erro", "Este navegador não dá a localização. Cole a coordenada ou o link do imóvel."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => irParaDesenho([p.coords.longitude, p.coords.latitude]),
      (e) => avisar("erro", e.code === e.PERMISSION_DENIED
        ? "O navegador bloqueou a localização. Libere em Configurações do site → Localização, ou cole a coordenada."
        : "Não deu para pegar a localização agora. Cole a coordenada ou o link do imóvel."),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );
  }

  // ------------------------------------------------------------- ao abrir
  const iniciou = useRef(false);
  useEffect(() => {
    carregarHistorico();
    if (iniciou.current) return;
    iniciou.current = true;
    const vinda = pegarAreaTransferida();
    if (vinda) {
      const im = imovelDaAreaRecebida(vinda);
      // a origem já vai no selo do cartão (situacao): sem repetir numa linha "Área trazida de"
      mostrar({ texto: vinda.origem, tipo: im.fonte === "campo" ? "campo" : "arquivo", rotulo: im.titulo }, [im]);
      return;
    }
    const q = inicial ?? new URLSearchParams(location.hash.split("?")[1] ?? "").get("q");
    if (q) consultarTexto(q);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------- mapa
  const mapa = useMemo(() => {
    const outros = imoveis.filter((i) => i.id !== selId);
    const destaques = outros.filter((i) => i.fonte !== "sigef").flatMap((i) => i.aneis.map((anel) => ({ codigo: i.codigo ?? i.id, nome: rotuloCurto(i), anel })));
    const pontoBusca = busca.fase !== "ocioso" ? busca.ponto : null;
    if (pontoBusca && !imoveis.length) destaques.push({ codigo: "ponto", nome: "Ponto consultado", anel: circulo(pontoBusca, 400, 40) });
    const parcelas: FeatureParcela[] = outros.filter((i) => i.fonte === "sigef").map(parcelaDoMapa);
    const sig = analise?.sigef.estado === "ok" ? analise.sigef.dados : null;
    if (sig?.parcelas) parcelas.push(...sig.parcelas.filter((p) => p.properties.codigo !== sel?.codigo && !parcelas.some((q) => q.properties.codigo === p.properties.codigo)));
    // a restrição que é a própria área (CAR de assentamento sobre o PA) não pinta o mapa: o imóvel
    // inteiro colorido parece todo sobreposto. Ela já está escrita na identificação, no painel.
    const camadas: CamadaRestricao[] = analise?.restricoes.estado === "ok"
      ? analise.restricoes.dados.fontes.flatMap((f) => f.itens.filter((i) => !ehPropriaArea(analise.imovel, f.tipo, i.pct)).map((i) => ({
        tipo: f.tipo, cor: f.cor, nome: i.nome, rotulo: f.singular, geometria: i.geometria, sobreposta: i.sobreposta, pontos: i.pontos,
      })))
      : [];
    if (analise?.car.estado === "ok") {
      for (const c of analise.car.dados.itens.filter((x) => x.sobreposta)) {
        camadas.push({ tipo: "car" as TipoRestricao, cor: "#06B6D4", nome: `CAR ${c.codigo}`, rotulo: "CAR sobreposto", geometria: null, sobreposta: c.sobreposta, pontos: [] });
      }
    }
    if (analise?.focos.estado === "ok") {
      for (const x of [...analise.focos.dados.dentro, ...analise.focos.dados.perto]) {
        camadas.push({
          tipo: "focos" as TipoRestricao, cor: x.distanciaM === 0 ? "#DC2626" : "#F97316",
          nome: `Foco de queimada · ${x.quando.slice(0, 10).split("-").reverse().join("/")}`,
          rotulo: `${x.satelite ?? "satélite"}${x.distanciaM > 0 ? ` · a ${Math.round(x.distanciaM)} m` : " · dentro"}`,
          geometria: null, sobreposta: null, pontos: [[x.lon, x.lat]],
        });
      }
    }
    if (desenho && desenho.length >= 3) {
      camadas.push({ tipo: "desenho" as TipoRestricao, cor: "#FFFFFF", nome: "Área sendo desenhada", rotulo: `${desenho.length} vértices`, geometria: { type: "MultiPolygon", coordinates: [[fecharAnel(desenho)]] }, sobreposta: null, pontos: [] });
    }
    const pontos: PontoMapa[] = desenho ? desenho.map((p, i) => ({ lonlat: p, rotulo: `P${i + 1}` })) : pontoBusca ? [{ lonlat: pontoBusca, rotulo: "Ponto consultado" }] : [];
    if (pontoPend && !desenho) pontos.push({ lonlat: pontoPend, rotulo: "Consultar aqui?" });
    const sobreposicoes = sig ? sig.sobreposicoes.filter((x) => !x.mesma_parcela) : [];
    return { destaques, parcelas, camadas, pontos, sobreposicoes, aneis: sel?.aneis ?? [] };
  }, [imoveis, selId, sel, busca, analise, desenho, pontoPend]);

  const legenda = [
    sel ? { cor: "#FFFFFF", rotulo: "Área analisada" } : null,
    mapa.destaques.some((d) => d.codigo !== "ponto") ? { cor: "#22D3EE", rotulo: "CAR declarado" } : null,
    mapa.parcelas.length ? { cor: "#FBBF24", rotulo: "SIGEF certificado" } : null,
    ...[...new Map(mapa.camadas.filter((c) => c.tipo !== ("focos" as TipoRestricao) && c.tipo !== ("desenho" as TipoRestricao)).map((c) => [c.tipo, { cor: c.cor, rotulo: c.rotulo }])).values()],
    mapa.camadas.some((c) => c.tipo === ("focos" as TipoRestricao)) ? { cor: "#DC2626", rotulo: "Foco de queimada", ponto: true } : null,
  ].filter(Boolean) as { cor: string; rotulo: string; ponto?: boolean }[];

  // gravata-borboleta: lados que se cruzam dão uma área sem sentido — não deixa fechar
  // os lados já marcados se cruzam (desfazer é o caminho) × só o lado de fechamento provisório cruza
  // (num traçado côncavo isso passa ao continuar marcando)
  const cruzaMarcado = desenho && desenho.length >= 4 ? autointersecta(desenho, undefined, true) : null;
  const cruzamento = cruzaMarcado ?? (desenho && desenho.length >= 4 ? autointersecta(desenho) : null);
  const soFecho = !!cruzamento && !cruzaMarcado;
  const avisoCruza = soFecho ? "Fechando agora, os lados se cruzariam: continue marcando ou desfaça o último vértice" : "Os lados se cruzam: desfaça o último vértice";
  // há vizinho clicável no mapa (CAR em destaque, parcela do SIGEF por perto, CAR sobreposto)?
  const temVizinho = mapa.destaques.some((d) => d.codigo !== "ponto")
    || (analise?.sigef.estado === "ok" && (analise.sigef.dados.vizinhas.length > 0 || analise.sigef.dados.sobreposicoes.some((x) => !x.mesma_parcela)))
    || (analise?.car.estado === "ok" && analise.car.dados.itens.some((c) => c.sobreposta));
  const dicaMapa = desenho
    ? longe ? "Aproxime até ver as cercas para marcar os vértices"
      : desenho.length < 3 ? `${verbo} no mapa para marcar os vértices (${desenho.length} de pelo menos 3)`
        : cruzamento ? avisoCruza : "Continue marcando ou feche a área"
    : imoveis.length > 1 && !sel ? `${verbo} num imóvel para analisar`
      : temVizinho ? `${verbo} num vizinho para consultá-lo`
        : `${verbo} no mapa para consultar um ponto`;

  // ------------------------------------------------------------- arrastar arquivo
  const soltar = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setArrastando(true); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.relatedTarget || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setArrastando(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files[0]; if (f) void abrirArquivo(f); },
  };

  // a área veio de fora da caixa (Medir no campo, arquivo): a linha de situação da busca diz qual é
  const origemBusca: OrigemBusca | null = busca.fase === "resultado" && (busca.entrada.tipo === "campo" || busca.entrada.tipo === "arquivo") && imoveis.length === 1
    ? { texto: <><b>{SELO[imoveis[0].fonte] ?? "Área"}</b> · {imoveis[0].titulo} ({fmtHa(analise?.imovel.id === imoveis[0].id ? analise.medidas.areaM2 : medir(imoveis[0].aneis).areaM2)})</>, onLimpar: limparTudo }
    : null;

  const podeCriar = temPermissao("servicos.criar");
  const imAtual = analise?.imovel ?? sel;
  const carregandoAnalise = analise ? fraseDaAnalise(analise).carregando > 0 : false;

  return (
    <div className="pagina consulta" {...soltar}>
      <CabecalhoPagina olho="Ferramentas" titulo={<>Consultar imóvel<Dica>CAR, SIGEF, restrições (TI, UC, assentamento, quilombola, embargo, fronteira, área militar, sítio arqueológico), focos de queimada, bioma, solo e chuva de qualquer lugar — sem abrir serviço e sem gastar crédito. O resultado vira serviço de CAR com um clique e sai em PDF, KML, SHP, DXF…</Dica></>} />
      <BuscaConsulta texto={texto} onTexto={setTexto} onConsultar={(e, t) => void consultar(e, t)} onArquivo={(f) => void abrirArquivo(f)}
        desenhando={!!desenho} onDesenhar={() => { if (desenho) setDesenho(null); else comecarDesenho(); }}
        onLocalizacao={ondeEstou} ocupado={ocupado} foco={busca.fase === "ocioso"} origem={origemBusca} />

      {/* acima do mapa (no celular o mapa vem antes do painel): quem trocou de imóvel vê logo como voltar */}
      {busca.fase === "resultado" && pilha.length > 0 && (
        <button type="button" className="cr-voltar" onClick={voltarConsulta}>← Voltar para <b>{pilha[pilha.length - 1].rotulo}</b></button>
      )}

      <div className="consulta-corpo">
        <div className="consulta-painel">
          {busca.fase === "ocioso" && <Inicio historico={historico} onExemplo={consultarTexto} onAbrir={abrirRegistro} onApagar={(r) => void apagarRegistro(r)} onTentar={carregarHistorico} verbo={verbo} />}
          {busca.fase === "buscando" && (
            <section className="cp-bloco" aria-busy="true">
              <h2><span className="spinner" aria-hidden /> Procurando {busca.entrada.rotulo}…</h2>
              <ul className="cb-fontes">
                {busca.etapas.map((e) => <li key={e.nome} className={e.estado}><span className="marca">{e.estado === "ok" ? "✓" : e.estado === "falhou" ? "!" : "·"}</span>{e.nome}{e.texto ? ` — ${e.texto}` : "…"}</li>)}
              </ul>
            </section>
          )}
          {busca.fase === "resultado" && (
            <>
              <Resultados busca={busca} selId={selId} onSelecionar={selecionar}
                onDesenhar={comecarDesenho}
                onEntorno={analisarEntorno} onTentar={() => consultarTexto(busca.entrada.texto)} />
              {imAtual && (
                <div className="ca-acoes">
                  {!analise
                    ? <button type="button" className="principal" onClick={() => analisar(imAtual, busca.municipio)}>Analisar</button>
                    : <button type="button" className="principal" disabled={gerandoPdf || carregandoAnalise} onClick={() => void baixarPdf()} title="Tudo desta consulta, com o croqui, as fontes e o laudo (se houver)">{gerandoPdf ? "Gerando o PDF…" : "Baixar PDF"}</button>}
                  <BaixarArea nome={imAtual.fonte === "car" && imAtual.codigo ? imAtual.codigo : imAtual.titulo} aneis={imAtual.aneis} nomes={imAtual.nomes} />
                  {podeCriar && <button type="button" onClick={criarCar} title="Abre o serviço de CAR já com este perímetro carregado">Criar serviço de CAR com esta área</button>}
                </div>
              )}
              {imAtual && (analise || qLink) && (
                <div className="ca-copiar-linha" role="group" aria-label="Copiar">
                  <span className="ca-copiar-rot"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>Copiar</span>
                  {analise && <button type="button" className="cb-alt" onClick={copiarResumo} title="O resumo da análise, para o WhatsApp ou o e-mail do cliente">Resumo</button>}
                  {analise && (
                    <button type="button" className="cb-alt" onClick={copiarConfrontantes} disabled={analise.sigef.estado === "carregando" || analise.car.estado === "carregando"}
                      title="As parcelas do SIGEF e os CAR que sobrepõem ou encostam na área, com código, nome, situação e distância — para o memorial ou a carta de anuência">Confrontantes</button>
                  )}
                  {qLink && <button type="button" className="cb-alt" onClick={copiarLink} title="O link desta consulta (#/consulta?q=…), para mandar a alguém da equipe"><span className="rot-longo">Link desta consulta</span><span className="rot-curto">Link</span></button>}
                </div>
              )}
              {analise && <PainelAnalise analise={analise} onTentar={tentar} onAtualizar={() => analisar(analise.imovel, busca.municipio)} laudo={{ ...laudo, onEscrever: (r) => void escreverLaudo(r) }} />}
            </>
          )}
        </div>

        <div ref={mapaCaixaRef} className={`consulta-mapa${desenho ? " desenhando" : " clicavel"}`} data-tela-cheia="">
          <BotaoTelaCheia className="mapa-cert-tela-cheia" />
          <MapaInterativo aneis={mapa.aneis} pontos={mapa.pontos} parcelas={mapa.parcelas} destaques={mapa.destaques} restricoes={mapa.camadas}
            sobreposicoes={mapa.sobreposicoes} altura={560} aoClicar={aoClicarNoMapa} irPara={irPara} semMapa="a consulta, a análise e o PDF funcionam sem ele"
            aoMudarVista={(v) => { vistaRef.current = v; setLonge(v.zoom < ZOOM_MIN_DESENHO); }} />
          {!(desenho && ondeDesenhar) && <span className="cm-dica" aria-hidden>{dicaMapa}</span>}
          {legenda.length > 0 && (
            <div className="cm-legenda" aria-label="Legenda do mapa">
              {legenda.map((l) => <span key={l.rotulo}><i className={l.ponto ? "ponto" : ""} style={{ borderColor: l.cor === "#FFFFFF" ? "#33453C" : l.cor, background: l.ponto ? l.cor : `${l.cor}33` }} />{l.rotulo}</span>)}
            </div>
          )}
          {pontoPend && !desenho && (
            <div className="cm-desenho cm-pergunta" role="dialog" aria-label="Consultar outro ponto">
              <span className="cm-conta">Consultar este ponto? <small>{descreverPonto(pontoPend[0], pontoPend[1])}</small></span>
              <button type="button" onClick={() => setPontoPend(null)}>Ficar nesta área</button>
              <button type="button" className="principal" autoFocus onClick={() => consultarAqui(pontoPend)}>Consultar o ponto</button>
            </div>
          )}
          {vizinho && !desenho && !pontoPend && (
            <div className="cm-desenho cm-pergunta cm-vizinho" role="dialog" aria-label="Vizinho no mapa">
              <span className="cm-conta">
                <span className={`cr-selo ${vizinho.tipo}`}>{vizinho.tipo === "car" ? "CAR · declarado" : "SIGEF · certificado"}</span>
                <b>{vizinho.nome?.trim() && !vizinho.nome.startsWith(vizinho.codigo.slice(0, 12)) ? vizinho.nome : vizinho.tipo === "car" ? `${vizinho.codigo.slice(0, 17)}…` : `Parcela ${vizinho.codigo.slice(0, 8)}`}</b>
                {vizinho.situacao && <small>{vizinho.situacao}</small>}
              </span>
              <button type="button" onClick={() => setVizinho(null)}>Fechar</button>
              <button type="button" className="principal" autoFocus onClick={() => consultarVizinho(vizinho)}>Consultar este vizinho</button>
            </div>
          )}
          {desenho && ondeDesenhar && (
            <LugarDoDesenho onIr={irParaDesenho} onOndeEstou={ondeEstouDesenho} onCancelar={() => { setOndeDesenhar(false); setDesenho(null); }}
              onAqui={() => {
                setOndeDesenhar(false);
                // "desenhar onde o mapa estiver" com o Brasil inteiro na tela: aproxima no centro da vista
                const v = vistaRef.current;
                if (!v || v.zoom < ZOOM_MIN_DESENHO) aproximar(v?.centro ?? [-47.9, -15.8]);
              }} />
          )}
          {desenho && !ondeDesenhar && (
            <div className="cm-desenho" role="toolbar" aria-label="Desenho da área">
              {cruzamento
                ? <span className="cm-conta cruza" role="alert" title={`No desenho, ${textoCruzamento(cruzamento, desenho.length, "P")}${soFecho ? " (o lado de fechamento ainda é provisório)" : ""}.`}>{avisoCruza}</span>
                : <span className="cm-conta">{desenho.length} {desenho.length === 1 ? "vértice" : "vértices"}{desenho.length >= 3 ? ` · ${fmtAreaCurta(medir([desenho]).areaM2)}` : ""}</span>}
              <button type="button" className={cruzaMarcado ? "principal" : ""} disabled={!desenho.length} onClick={() => setDesenho(desenho.slice(0, -1))}>Desfazer</button>
              <button type="button" onClick={() => setDesenho(null)}>Cancelar</button>
              <button type="button" className={cruzamento ? "" : "principal"} disabled={desenho.length < 3 || !!cruzamento} onClick={concluirDesenho}
                title={cruzamento ? "Os lados se cruzam: a área não teria sentido" : undefined}>Fechar a área</button>
            </div>
          )}
        </div>
      </div>

      {arrastando && <div className="consulta-soltar" aria-hidden><div><b>Solte o arquivo para consultar</b>KML, KMZ, GPX ou GeoJSON da área</div></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** "Onde fica o imóvel?" antes de desenhar com o mapa no Brasil inteiro (como o Medir no campo). */
function LugarDoDesenho({ onIr, onOndeEstou, onAqui, onCancelar }: { onIr: (p: LonLat) => void; onOndeEstou: () => void; onAqui: () => void; onCancelar: () => void }) {
  const [t, setT] = useState("");
  const [erro, setErro] = useState(false);
  const ir = () => { const p = lerLugar(t); setErro(!p); if (p) onIr(p); };
  return (
    <div className="cm-desenho cm-onde" role="dialog" aria-label="Onde fica o imóvel?">
      <b>Onde fica o imóvel?</b>
      <form className="cm-onde-linha" onSubmit={(e) => { e.preventDefault(); ir(); }}>
        <input value={t} onChange={(e) => { setT(e.target.value); setErro(false); }} placeholder="Coordenada, UTM ou link do Google Maps"
          aria-label="Coordenada, UTM ou link do Google Maps" aria-invalid={erro || undefined} autoComplete="off" />
        <button type="submit" className="principal" disabled={!t.trim()}>Ir</button>
      </form>
      {erro && <span className="cm-onde-erro" role="alert">Não entendi esse lugar. Cole a coordenada (lat, lon), a UTM com o fuso ou o link do Google Maps.</span>}
      <div className="cm-onde-acoes">
        <button type="button" onClick={onOndeEstou}>Onde estou</button>
        <button type="button" className="fantasma" onClick={onAqui}><span className="rot-longo">Desenhar onde o mapa estiver</span><span className="rot-curto">Desenhar aqui</span></button>
        <button type="button" className="fantasma" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}

function Inicio({ historico, onExemplo, onAbrir, onApagar, onTentar, verbo }: {
  historico: Resposta<RegistroConsulta[]>;
  verbo: string;
  onExemplo: (t: string) => void;
  onAbrir: (r: RegistroConsulta) => void;
  onApagar: (r: RegistroConsulta) => void;
  onTentar: () => void;
}) {
  const lista = historico.estado === "ok" ? historico.dados : [];
  return (
    <>
      <section className="cp-bloco">
        <h2>Consultas recentes<span className="esticar" />{lista.length > 0 && <span className="sub">da empresa</span>}</h2>
        {historico.estado === "carregando" && <><div className="ca-esq" style={{ width: "80%" }} /><div className="ca-esq" style={{ width: "55%" }} /></>}
        {historico.estado === "falhou" && <EstadoErro titulo="Não deu para carregar as consultas recentes" mensagem={historico.motivo} onTentar={onTentar} />}
        {historico.estado === "ok" && !lista.length && (
          <EstadoVazio compacto icone={ICONE.busca} titulo="Nenhuma consulta ainda"
            texto={`Cole um código do CAR ou uma coordenada acima, ou ${verbo.toLowerCase()} em qualquer lugar do mapa. A consulta não gasta crédito e fica guardada aqui para a equipe.`} />
        )}
        {lista.length > 0 && (
          <ul className="ci-recentes">
            {lista.map((r) => (
              <li key={r.id}>
                <div className="ci-recente" role="button" tabIndex={0} onClick={() => onAbrir(r)} onKeyDown={(e) => { if (e.key === "Enter") onAbrir(r); }}>
                  <span className={`ci-ponto ${r.tom ?? ""}`} aria-hidden />
                  <span className="ci-texto">
                    <b>{r.rotulo}</b>
                    <span>{[r.areaHa != null ? fmtAreaCurta(r.areaHa * 10_000) : null, r.municipio ? `${r.municipio}${r.uf ? `/${r.uf}` : ""}` : null, r.resumo].filter(Boolean).join(" · ")}</span>
                  </span>
                  {r.laudo ? <span className="ci-laudo">laudo</span> : <span />}
                  <span className="ci-quando">{quando(r.criado)}
                    <button type="button" className="fantasma" style={{ marginLeft: 4 }} aria-label={`Tirar ${r.rotulo} da lista`} title="Tirar da lista"
                      onClick={(e) => { e.stopPropagation(); onApagar(r); }}>✕</button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="cp-bloco">
        <h2>Experimente<Dica>A caixa entende sozinha: código do CAR (com ou sem os pontos do recibo), coordenada decimal, GMS ou UTM (com o fuso), link do Google Maps e código de parcela do SIGEF. Também dá para arrastar um KML/KMZ/GPX/GeoJSON para a tela.</Dica></h2>
        <div className="ci-exemplos">
          {EXEMPLOS.map((x) => <button key={x.texto} type="button" className="ci-exemplo" onClick={() => onExemplo(x.texto)} title={x.texto}>{x.rotulo}: <code>{x.texto.length > 22 ? `${x.texto.slice(0, 20)}…` : x.texto}</code></button>)}
        </div>
      </section>
    </>
  );
}

function Resultados({ busca, selId, onSelecionar, onDesenhar, onEntorno, onTentar }: {
  busca: Extract<Busca, { fase: "resultado" }>;
  selId: string | null;
  onSelecionar: (im: ImovelEncontrado) => void;
  onDesenhar: () => void;
  onEntorno: (p: LonLat) => void;
  onTentar: () => void;
}) {
  const { imoveis, falhas, avisos, ponto, municipio } = busca;
  if (!imoveis.length) {
    if (falhas.length && !ponto) {
      return <section className="cp-bloco"><EstadoErro titulo="A consulta não foi concluída" mensagem={[...falhas, ...avisos].join(" ")} onTentar={onTentar} /></section>;
    }
    return (
      <section className="cp-bloco">
        <EstadoVazio icone={ICONE.busca}
          titulo={falhas.length ? "Não deu para confirmar o que existe neste ponto" : ponto ? "Nenhum imóvel declarado (CAR) nem certificado (SIGEF) contém este ponto" : "Nada encontrado"}
          texto={<>{ponto && municipio ? `O ponto fica em ${municipio.nome}/${municipio.uf}. ` : ""}{avisos.join(" ")}{falhas.length ? ` ${falhas.join(" ")}` : ""}{ponto ? " Dá para analisar o entorno ou desenhar a área." : ""}</>}
          acao={ponto ? (
            <div className="cr-vazio-acoes">
              {falhas.length > 0 && <button type="button" className="principal" onClick={onTentar}>Tentar de novo</button>}
              <button type="button" className={falhas.length ? "" : "principal"} onClick={() => onEntorno(ponto)}>Analisar o entorno (5 ha)</button>
              <button type="button" onClick={onDesenhar}>Desenhar a área</button>
            </div>
          ) : undefined} />
      </section>
    );
  }
  return (
    <section className="cp-bloco">
      <h2>
        {imoveis.length === 1 ? (imoveis[0].fonte === "car" || imoveis[0].fonte === "sigef" ? "Imóvel encontrado" : "Área") : `${imoveis.length} imóveis neste ponto`}
        <span className="esticar" />
        {municipio && <span className="sub">{municipio.nome}/{municipio.uf}</span>}
      </h2>
      {(avisos.length > 0 || falhas.length > 0) && (
        <ul className="cb-fontes">
          {falhas.map((t) => <li key={t} className="falhou"><span className="marca">!</span><span>{t} <button type="button" className="link" onClick={onTentar}>tentar de novo</button></span></li>)}
          {avisos.map((t) => <li key={t}><span className="marca">i</span>{t}</li>)}
        </ul>
      )}
      <div className="cr-lista" role={imoveis.length > 1 ? "listbox" : undefined} aria-label="Imóveis encontrados">
        {imoveis.map((im) => <CartaoImovel key={im.id} im={im} ativo={im.id === selId} onClick={() => onSelecionar(im)} varios={imoveis.length > 1} />)}
      </div>
    </section>
  );
}

function CartaoImovel({ im, ativo, onClick, varios }: { im: ImovelEncontrado; ativo: boolean; onClick: () => void; varios: boolean }) {
  const m = medir(im.aneis);
  const dif = diferencaDeArea(m.areaM2, im.areaDeclaradaHa);
  const condicaoAlerta = !!im.car && /suspens|cancel|pendente/i.test(im.situacao ?? "");
  const [copiado, setCopiado] = useState(false);
  const conteudo = (
    <>
      <span className="cr-topo">
        <span className={`cr-selo ${im.fonte}`}>{SELO[im.fonte] ?? im.fonte}</span>
        {im.situacao && <span className={`cr-situacao${condicaoAlerta ? " alerta" : ""}`}>{im.situacao}</span>}
      </span>
      <span className={`cr-titulo${im.fonte === "car" ? " mono" : ""}`}>
        {im.fonte === "car" ? im.codigo : im.titulo}
        {im.codigo && (
          <button type="button" className="cr-copiar" aria-label={`Copiar o código ${im.codigo}`}
            onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(im.codigo!).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1400); }); }}
            onKeyDown={(e) => e.stopPropagation()}>
            {copiado ? "copiado ✓" : "copiar"}
          </button>
        )}
      </span>
      <span className="cr-area">
        <b>{im.fonte === "campo" ? fmtHa(m.areaM2) : fmtAreaCurta(m.areaM2)}</b>
        <span>calculada{im.areaDeclaradaHa != null ? ` · ${im.fonte === "sigef" ? "certificada" : "declarada"} ${im.areaDeclaradaHa.toLocaleString("pt-BR", { maximumFractionDigits: 4 })} ha` : ""}{dif && <span className="dif"> ({dif})</span>}</span>
        <Dica>Área calculada pelo Vertces em UTM SIRGAS 2000, fuso {m.fuso}S (fórmula de Gauss) — a mesma conta de todo o sistema. {m.vertices} vértices{m.partes > 1 ? ` em ${m.partes} partes` : ""}{im.furos ? `; ${im.furos} furo(s) não entram (vale o contorno externo)` : ""}.</Dica>
      </span>
      <span className="cr-sub">{[im.municipio ? `${im.municipio}${im.uf ? `/${im.uf}` : ""}` : null, im.atualizacao ? `atualizado em ${im.atualizacao.split("-").reverse().join("/")}` : null, ...im.detalhes.slice(0, 1)].filter(Boolean).join(" · ")}</span>
    </>
  );
  if (!varios) return <div className="cr-imovel ativo">{conteudo}</div>;
  // div (não <button>): o cartão tem botões dentro (copiar, a dica "?"), e botão dentro de botão é HTML inválido
  return (
    <div role="option" tabIndex={0} aria-selected={ativo} className={`cr-imovel clicavel${ativo ? " ativo" : ""}`} onClick={onClick}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}>
      {conteudo}
    </div>
  );
}
