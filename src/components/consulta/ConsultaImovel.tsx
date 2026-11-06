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
import { autointersecta, centroDe, circulo, fmtAreaCurta, maiorAnel, medir, pontoEmPoligonos, textoCruzamento } from "../../lib/consulta/geometria.ts";
import type { LonLat } from "../../lib/consulta/geometria.ts";
import { dadosDoPdf, diferencaDeArea, restricoesVazias, resumoEmTexto } from "../../lib/consulta/relatorio.ts";
import { fontesReais } from "../../lib/consulta/fontes.ts";
import type { FontesConsulta, RegistroConsulta, TipoEntrada } from "../../lib/consulta/fontes.ts";
import type { ImovelEncontrado, Resposta } from "../../lib/consulta/tipos.ts";
import type { Municipio } from "../../lib/consulta/ambiente.ts";
import { MapaInterativo } from "../MapaInterativo";
import type { PontoMapa } from "../MapaInterativo";
import { BotaoTelaCheia } from "../TelaCheia";
import { avisar, CabecalhoPagina, Dica, EstadoErro, EstadoVazio } from "../ui";
import { ICONE } from "../Icone";
import { BuscaConsulta } from "./BuscaConsulta";
import { BaixarArea } from "./BaixarArea";
import { PainelAnalise } from "./PainelAnalise";
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
  const [laudo, setLaudo] = useState<{ estado: "pronto" | "gravando" | "escrevendo" | "indisponivel"; motivo?: string }>({ estado: "gravando" });
  const [desenho, setDesenho] = useState<LonLat[] | null>(null);
  const [historico, setHistorico] = useState<Resposta<RegistroConsulta[]>>({ estado: "carregando" });
  const [arrastando, setArrastando] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const corrida = useRef(0);
  /** a busca da vez (código, ponto, GPS, exemplo): a resposta de uma busca velha é descartada */
  const buscaVez = useRef(0);
  const gravadoEm = useRef<string | null>(null);
  /** a linha do histórico de CADA análise (chave: analise.quando), já gravada ou em gravação: o UPDATE
   *  vai sempre para a linha da própria análise, e "tentar de novo" antes do INSERT voltar não duplica */
  const registros = useRef(new Map<string, Promise<string | null>>());
  const tarefasRef = useRef<Record<ChaveFonte, () => Promise<unknown>> | null>(null);

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
    const munP = municipio ? Promise.resolve(municipio) : fontes.municipio(centro[0], centro[1]);
    const ufP = im.uf ? Promise.resolve(im.uf) : munP.then((m) => m?.uf ?? null, () => null);
    const tarefas: Record<ChaveFonte, () => Promise<unknown>> = {
      restricoes: () => fontes.restricoes(im.aneis, medidas.fuso),
      sigef: () => ufP.then((uf) => fontes.sigefNaArea(im.aneis, uf, im.fonte === "sigef" ? im.codigo : null)),
      car: () => ufP.then((uf) => fontes.carNaArea(im.aneis, uf, im.fonte === "car" ? im.codigo : null)),
      focos: () => fontes.focos(im.aneis),
      clima: () => fontes.clima(centro[0], centro[1]),
      solo: () => fontes.solo(centro[0], centro[1]),
      bioma: () => fontes.bioma(centro[0], centro[1]),
      municipio: () => munP,
    };
    tarefasRef.current = tarefas;
    for (const k of CHAVES_FONTES) rodar(k, id, tarefas[k]);
  }

  function tentar(k: ChaveFonte) {
    const t = tarefasRef.current;
    if (!t || !analise) { if (sel) analisar(sel); return; }
    // os dados vão mudar: o laudo antigo deixa de valer (o banco também o apaga ao regravar o resultado)
    setAnalise((a) => (a ? { ...a, [k]: { estado: "carregando" }, laudo: null } : a));
    // o laudo só sai depois que os dados novos forem guardados (e regrava mesmo que a fonte falhe de novo)
    gravadoEm.current = null;
    if (registroId) setLaudo({ estado: "gravando" });
    rodar(k, corrida.current, t[k]);
  }

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

  function aoClicarNoMapa(p: LonLat) {
    if (desenho) { setDesenho([...desenho, p]); return; }
    if (ocupado) return;
    const dentro = imoveis.find((i) => pontoEmPoligonos(p, i.poligonos));
    if (dentro) { selecionar(dentro); return; }
    const t = `${p[1].toFixed(6)}, ${p[0].toFixed(6)}`;
    setTexto(t);
    guardarEndereco(t);
    void consultarPonto(p[0], p[1], { texto: t, tipo: "coordenada", rotulo: `Ponto ${descreverPonto(p[0], p[1])}` });
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
      origem: im.fonte === "car" ? `CAR ${im.codigo} (declarado no SICAR${im.situacao ? `, ${im.situacao.toLowerCase()}` : ""})`
        : im.fonte === "sigef" ? `parcela certificada ${im.codigo} (SIGEF)` : `${im.titulo} (Consultar imóvel)`,
      uf: mun?.uf ?? im.uf ?? null, municipio: mun?.nome ?? im.municipio ?? null,
    });
    if (im.aneis.length > 1) avisar("alerta", `A área tem ${im.aneis.length} partes: o CAR leva a maior.`);
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

  function copiarResumo() {
    if (!analise) return;
    const t = resumoEmTexto(analise);
    (navigator.clipboard?.writeText(t) ?? Promise.reject(new Error("sem área de transferência")))
      .then(() => avisar("ok", "Resumo copiado: cole no WhatsApp ou no e-mail do cliente."), () => avisar("erro", "O navegador não deixou copiar."));
  }

  // ------------------------------------------------------------- ao abrir
  const iniciou = useRef(false);
  useEffect(() => {
    carregarHistorico();
    if (iniciou.current) return;
    iniciou.current = true;
    const vinda = pegarAreaTransferida();
    if (vinda) {
      const campo = /campo/i.test(vinda.origem);
      const im: ImovelEncontrado = {
        id: `vinda:${Date.now()}`, fonte: campo ? "campo" : "arquivo", codigo: null, titulo: vinda.nome || "Área recebida",
        aneis: [vinda.perimetro], poligonos: [[vinda.perimetro]], furos: 0, nomes: vinda.nomes, areaDeclaradaHa: null,
        municipio: vinda.municipio ?? null, uf: vinda.uf ?? null, atualizacao: null, situacao: vinda.origem, detalhes: [],
      };
      mostrar({ texto: vinda.origem, tipo: campo ? "campo" : "arquivo", rotulo: im.titulo }, [im], { avisos: [`Área trazida de: ${vinda.origem}.`] });
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
    // a restrição que é a própria área (CAR de assentamento sobre o PA) fica só no contorno, sem o tom forte
    const camadas: CamadaRestricao[] = analise?.restricoes.estado === "ok"
      ? analise.restricoes.dados.fontes.flatMap((f) => f.itens.map((i) => ({
        tipo: f.tipo, cor: f.cor, nome: i.nome, rotulo: f.singular, geometria: i.geometria,
        sobreposta: ehPropriaArea(analise.imovel, f.tipo, i.pct) ? null : i.sobreposta, pontos: i.pontos,
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
    const sobreposicoes = sig ? sig.sobreposicoes.filter((x) => !x.mesma_parcela) : [];
    return { destaques, parcelas, camadas, pontos, sobreposicoes, aneis: sel?.aneis ?? [] };
  }, [imoveis, selId, sel, busca, analise, desenho]);

  const legenda = [
    sel ? { cor: "#FFFFFF", rotulo: "Área analisada" } : null,
    mapa.destaques.some((d) => d.codigo !== "ponto") ? { cor: "#22D3EE", rotulo: "CAR declarado" } : null,
    mapa.parcelas.length ? { cor: "#FBBF24", rotulo: "SIGEF certificado" } : null,
    ...[...new Map(mapa.camadas.filter((c) => c.tipo !== ("focos" as TipoRestricao) && c.tipo !== ("desenho" as TipoRestricao)).map((c) => [c.tipo, { cor: c.cor, rotulo: c.rotulo }])).values()],
    mapa.camadas.some((c) => c.tipo === ("focos" as TipoRestricao)) ? { cor: "#DC2626", rotulo: "Foco de queimada", ponto: true } : null,
  ].filter(Boolean) as { cor: string; rotulo: string; ponto?: boolean }[];

  // gravata-borboleta: lados que se cruzam dão uma área sem sentido — não deixa fechar
  const cruzamento = desenho && desenho.length >= 4 ? autointersecta(desenho) : null;
  const dicaMapa = desenho
    ? desenho.length < 3 ? `Clique no mapa para marcar os vértices (${desenho.length} de pelo menos 3)`
      : cruzamento ? "Os lados se cruzam: desfaça o último vértice" : "Continue marcando ou feche a área"
    : imoveis.length > 1 && !sel ? "Clique num imóvel para analisar" : "Clique no mapa para consultar um ponto";

  // ------------------------------------------------------------- arrastar arquivo
  const soltar = {
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setArrastando(true); } },
    onDragLeave: (e: React.DragEvent) => { if (!e.relatedTarget || !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setArrastando(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files[0]; if (f) void abrirArquivo(f); },
  };

  const podeCriar = temPermissao("servicos.criar");
  const imAtual = analise?.imovel ?? sel;
  const carregandoAnalise = analise ? fraseDaAnalise(analise).carregando > 0 : false;

  return (
    <div className="pagina consulta" {...soltar}>
      <CabecalhoPagina olho="Ferramentas" titulo={<>Consultar imóvel<Dica>CAR, SIGEF, restrições (TI, UC, assentamento, quilombola, embargo, fronteira, área militar, sítio arqueológico), focos de queimada, bioma, solo e chuva de qualquer lugar — sem abrir serviço e sem gastar crédito. O resultado vira serviço de CAR com um clique e sai em PDF, KML, SHP, DXF…</Dica></>} />
      <BuscaConsulta texto={texto} onTexto={setTexto} onConsultar={(e, t) => void consultar(e, t)} onArquivo={(f) => void abrirArquivo(f)}
        desenhando={!!desenho} onDesenhar={() => { if (desenho) setDesenho(null); else { setDesenho([]); avisar("ok", "Clique no mapa para marcar os vértices da área."); } }}
        onLocalizacao={ondeEstou} ocupado={ocupado} foco={busca.fase === "ocioso"} />

      <div className="consulta-corpo">
        <div className="consulta-painel">
          {busca.fase === "ocioso" && <Inicio historico={historico} onExemplo={consultarTexto} onAbrir={abrirRegistro} onApagar={(r) => void apagarRegistro(r)} onTentar={carregarHistorico} />}
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
                onDesenhar={() => { setDesenho([]); avisar("ok", "Clique no mapa para marcar os vértices da área."); }}
                onEntorno={analisarEntorno} onTentar={() => consultarTexto(busca.entrada.texto)} />
              {imAtual && (
                <div className="ca-acoes">
                  {!analise
                    ? <button type="button" className="principal" onClick={() => analisar(imAtual, busca.municipio)}>Analisar</button>
                    : <button type="button" className="principal" disabled={gerandoPdf || carregandoAnalise} onClick={() => void baixarPdf()} title="Tudo desta consulta, com o croqui, as fontes e o laudo (se houver)">{gerandoPdf ? "Gerando o PDF…" : "Baixar PDF"}</button>}
                  <BaixarArea nome={imAtual.fonte === "car" && imAtual.codigo ? imAtual.codigo : imAtual.titulo} aneis={imAtual.aneis} nomes={imAtual.nomes} />
                  {podeCriar && <button type="button" onClick={criarCar} title="Abre o serviço de CAR já com este perímetro carregado">Criar serviço de CAR com esta área</button>}
                  <span className="esticar" />
                  {analise && (
                    <button type="button" className="fantasma ca-copiar" onClick={copiarResumo} title="Copiar o resumo para o WhatsApp ou o e-mail" aria-label="Copiar resumo">
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
                    </button>
                  )}
                </div>
              )}
              {analise && <PainelAnalise analise={analise} onTentar={tentar} onAtualizar={() => analisar(analise.imovel, busca.municipio)} laudo={{ ...laudo, onEscrever: (r) => void escreverLaudo(r) }} />}
            </>
          )}
        </div>

        <div className={`consulta-mapa${desenho ? " desenhando" : " clicavel"}`} data-tela-cheia="">
          <BotaoTelaCheia className="mapa-cert-tela-cheia" />
          <MapaInterativo aneis={mapa.aneis} pontos={mapa.pontos} parcelas={mapa.parcelas} destaques={mapa.destaques} restricoes={mapa.camadas}
            sobreposicoes={mapa.sobreposicoes} altura={560} aoClicar={aoClicarNoMapa} semMapa="a consulta, a análise e o PDF funcionam sem ele" />
          <span className="cm-dica" aria-hidden>{dicaMapa}</span>
          {legenda.length > 0 && (
            <div className="cm-legenda" aria-label="Legenda do mapa">
              {legenda.map((l) => <span key={l.rotulo}><i className={l.ponto ? "ponto" : ""} style={{ borderColor: l.cor === "#FFFFFF" ? "#33453C" : l.cor, background: l.ponto ? l.cor : `${l.cor}33` }} />{l.rotulo}</span>)}
            </div>
          )}
          {desenho && (
            <div className="cm-desenho" role="toolbar" aria-label="Desenho da área">
              {cruzamento
                ? <span className="cm-conta cruza" role="alert" title={`No desenho, ${textoCruzamento(cruzamento, desenho.length)} (os vértices são P1, P2… no mapa).`}>Os lados se cruzam: desfaça o último vértice</span>
                : <span className="cm-conta">{desenho.length} {desenho.length === 1 ? "vértice" : "vértices"}{desenho.length >= 3 ? ` · ${fmtAreaCurta(medir([desenho]).areaM2)}` : ""}</span>}
              <button type="button" className={cruzamento ? "principal" : ""} disabled={!desenho.length} onClick={() => setDesenho(desenho.slice(0, -1))}>Desfazer</button>
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

function Inicio({ historico, onExemplo, onAbrir, onApagar, onTentar }: {
  historico: Resposta<RegistroConsulta[]>;
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
            texto="Cole um código do CAR ou uma coordenada acima, ou clique em qualquer lugar do mapa. A consulta não gasta crédito e fica guardada aqui para a equipe." />
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
        <b>{fmtAreaCurta(m.areaM2)}</b>
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
