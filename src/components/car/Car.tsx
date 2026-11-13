// Serviço de CAR: o imóvel do KML/GPX na prancheta, com a reserva legal, a
// vegetação nativa cedida a outro imóvel, a APP dos rios e a área produtiva, e
// os shapefiles para o SICAR (mais o KML da vegetação para a compensação).
//
// O projeto é só intenção e mora em `car_projetos`; as camadas saem de
// `calcularCar` a cada mudança. Tudo roda no navegador.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rotuloCurto } from "../../lib/modalidades";
import { useAutosave } from "../../lib/ux";
import type { Servico } from "../../lib/types";
import {
  FAIXAS_APP, ajustarReserva, ajustarVegetacao, calcularCar, fmtHa, fmtNum, fmtPct, normalizarProjetoCar, projetoNovo, reservaPorLado,
  vegetacaoPorLado,
} from "../../lib/car/motor.ts";
import type { ProjetoCar, ResultadoCar } from "../../lib/car/motor.ts";
import { CAMADAS, nomeArquivo } from "../../lib/car/saidas.ts";
import { baixarEntrega } from "../../lib/entregas";
import type { CamadaCar } from "../../lib/car/saidas.ts";
import { carregarProjetoCar, marcarCarExportado, salvarProjetoCar } from "../../lib/car/persistencia.ts";
import { Dica, GiroMapa, StatusSalvamento } from "../ui";
import { BotaoConcluir, useConclusao } from "../ConcluirServico";
import { ExportarArea } from "../ExportarArea";
import { RestricoesImovel } from "../RestricoesImovel";
import { CarEditor, COR } from "./CarEditor";
import { CartaoSobreposicao, useSobreposicaoCar } from "./SobreposicaoCar";
import { fraseDoAjuste } from "../../lib/car/sobreposicao.ts";
import type { AjusteSobreposicao } from "../../lib/car/sobreposicao.ts";
import { motivosIncompleta } from "../../lib/car/vizinhos.ts";
import type { FonteVizinhos } from "../../lib/car/vizinhos.ts";
import { antiHorario, diferenca } from "../../lib/loteamento/geom.ts";
import { vizinhosNoMapa } from "../../lib/car/mapaVizinhos.ts";
import type { VizinhoNoMapa } from "../../lib/car/mapaVizinhos.ts";
import type { Poligono, Pt } from "../../lib/loteamento/geom.ts";
import { EscolhaBaseArea } from "./BaseArea";
import type { FerramentaCar, SelecaoCar } from "./CarEditor";
import "./car.css";
import { Icone } from "../Icone";

export interface ArmazenamentoCar {
  carregar: (servicoId: string) => Promise<Partial<ProjetoCar> | null>;
  salvar: (servicoId: string, p: ProjetoCar) => Promise<void>;
  marcarExportado?: (servicoId: string) => Promise<void>;
}

const BANCO: ArmazenamentoCar = { carregar: carregarProjetoCar, salvar: salvarProjetoCar, marcarExportado: marcarCarExportado };

interface Historico { passado: ProjetoCar[]; atual: ProjetoCar | null; futuro: ProjetoCar[]; base: ProjetoCar | null }

/** Ícones do trilho recolhido (traço único, viewBox 24). */
const ICO_CAR = {
  abrir: "M11 17l-5-5 5-5M18 17l-5-5 5-5",
  encostar: "M4 4v16M8 6h12v12H8z",
  desenhar: "M12 3l8 6-3 10H7L4 9z",
  ajustar: "M4 12a8 8 0 1 0 8-8M4 4v4h4",
  vegetacao: "M12 3l6 8h-3.5l4 6H5.5l4-6H6zM12 17v4",
  rio: "M3 8c3-3 5 3 8 0s5 3 8 0M3 15c3-3 5 3 8 0s5 3 8 0",
  kml: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  baixar: "M12 3v12M7 10l5 5 5-5M4 21h16",
};

/**
 * Depois que o perímetro muda (ajuste da sobreposição, desfazer), a reserva e a
 * vegetação desenhadas voltam à porcentagem/área pedida sem sair do lugar. O
 * "lado" encostado perde o índice (os lados do anel mudaram), então a faixa
 * fica como polígono desenhado.
 */
function reacomodar(p: ProjetoCar): ProjetoCar {
  let q: ProjetoCar = p;
  if (q.reserva.poligonos.length) {
    try { q = { ...q, reserva: { ...q.reserva, poligonos: ajustarReserva(q), lado: null } }; }
    catch { q = { ...q, reserva: { ...q.reserva, lado: null } }; }
  }
  if (q.vegetacao.poligonos.length) {
    try { q = { ...q, vegetacao: { ...q.vegetacao, poligonos: q.vegetacao.alvoHa ? ajustarVegetacao(q) : q.vegetacao.poligonos, lado: null } }; }
    catch { q = { ...q, vegetacao: { ...q.vegetacao, lado: null } }; }
  }
  return q;
}

/** O projeto com o perímetro (e os nomes dos vértices) trocados. */
function comPerimetro(p: ProjetoCar, perimetro: ProjetoCar["perimetro"], nomes: ProjetoCar["nomesVertices"] | undefined): ProjetoCar {
  const { nomesVertices: _antigos, ...resto } = p;
  return { ...resto, perimetro, ...(nomes && nomes.length === perimetro.length && nomes.some(Boolean) ? { nomesVertices: nomes } : {}) };
}

export function Car({ servico: servicoInicial, onVoltar, armazenamento = BANCO, fonteVizinhos }: {
  servico: Servico; onVoltar: () => void; armazenamento?: ArmazenamentoCar;
  /** de onde vêm os vizinhos (CAR/SIGEF) da sobreposição; o laboratório passa respostas gravadas */
  fonteVizinhos?: FonteVizinhos;
}) {
  const [servico, setServico] = useState(servicoInicial);
  // pronto para concluir = os shapefiles já foram baixados (status "gerado")
  const conclusao = useConclusao(servico, {
    pronto: servico.status === "gerado", falta: "baixar os shapefiles do SICAR",
    onMudou: (em) => setServico((s) => ({ ...s, concluido_em: em })),
  });
  const [h, setH] = useState<Historico>({ passado: [], atual: null, futuro: [], base: null });
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [ferramenta, setFerramenta] = useState<FerramentaCar>("mover");
  // painel da direita recolhido num trilho de ações rápidas (lembrado neste navegador)
  const [recolhido, setRecolhido] = useState(() => { try { return localStorage.getItem("vertces.car.painelRecolhido") === "1"; } catch { return false; } });
  const recolher = (v: boolean) => { setRecolhido(v); try { localStorage.setItem("vertces.car.painelRecolhido", v ? "1" : "0"); } catch { /* sem armazenamento */ } };
  /** o que a ferramenta "lado" encosta: a reserva ou a vegetação nativa */
  const [alvoLado, setAlvoLado] = useState<"reserva" | "vegetacao">("reserva");
  const [sel, setSel] = useState<SelecaoCar>(null);
  const [satelite, setSatelite] = useState(true);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const projeto = h.atual;

  useEffect(() => {
    let cancelado = false;
    armazenamento.carregar(servico.id).then((salvo) => {
      if (cancelado) return;
      const p = normalizarProjetoCar(salvo, projetoNovo(servico.denominacao ?? "Imóvel", []));
      if (p.perimetro.length < 3) { setErroCarga("O projeto deste serviço não tem o perímetro do imóvel."); return; }
      setH({ passado: [], atual: p, futuro: [], base: null });
    }).catch((e) => !cancelado && setErroCarga(e instanceof Error ? e.message : String(e)));
    return () => { cancelado = true; };
  }, [servico.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // `base`: o projeto que CHEGA do armazenamento é o já gravado — abrir o CAR
  // não pode regravar o projeto nem deixar "car.alterado" na auditoria
  const auto = useAutosave(projeto, async (p) => { if (p) await armazenamento.salvar(servico.id, p); }, { ativo: !!projeto, base: projeto !== null });

  const res: ResultadoCar | null = useMemo(() => {
    if (!projeto) return null;
    try { return calcularCar(projeto); } catch { return null; }
  }, [projeto]);
  // o perímetro do CAR (lon/lat do KML) para o cartão de restrições; muda só quando o perímetro muda
  const perimetroCar = projeto?.perimetro;
  const aneisRestricoes = useMemo(() => (perimetroCar && perimetroCar.length >= 3 ? [perimetroCar as [number, number][]] : []), [perimetroCar]);

  const mostrar = useCallback((t: string, erro = false) => setMsg({ t, erro }), []);

  // ---------------- sobreposição com os vizinhos (CAR/SIGEF) ----------------
  const sob = useSobreposicaoCar(projeto, servico.uf ?? null, fonteVizinhos);
  // trava de segurança: o ajuste não pode ficar se repetindo (cada um muda o perímetro)
  const ajustesSeguidos = useRef(0);
  function aplicarAjuste(p: ProjetoCar, a: AjusteSobreposicao) {
    if (!a.perimetro) return;
    const reg = p.sobreposicao;
    const cortados = a.itens.filter((i) => i.decisao === "cortado");
    const cortes = new Map((reg?.original ? reg.cortes : []).map((c) => [`${c.fonte}:${c.codigo}`, c]));
    for (const i of cortados) {
      const k = `${i.fonte}:${i.codigo}`;
      const ja = cortes.get(k);
      cortes.set(k, { fonte: i.fonte, codigo: i.codigo, rotulo: i.rotulo, areaM2: (ja?.areaM2 ?? 0) + i.areaM2 });
    }
    const novo = reacomodar({
      ...comPerimetro(p, a.perimetro, a.nomesVertices),
      sobreposicao: {
        original: reg?.original ?? p.perimetro,
        ...(reg?.original ? (reg.nomesOriginais ? { nomesOriginais: reg.nomesOriginais } : {}) : (p.nomesVertices ? { nomesOriginais: p.nomesVertices } : {})),
        cortes: [...cortes.values()],
        antesM2: reg?.original ? reg.antesM2 : a.antesM2,
        depoisM2: a.depoisM2,
        em: new Date().toISOString(),
        ignorar: reg?.ignorar ?? [],
        forcar: reg?.forcar ?? [],
      },
    });
    mudar(novo);
    setSel(null);
    const k = res?.fatorArea ?? 1;
    mostrar(fraseDoAjuste(a, (m2) => fmtHa(m2 * k), (m2) => `${fmtNum(m2 * k, m2 * k < 10 ? 2 : 0)} m²`));
  }
  useEffect(() => {
    const a = sob.ajuste;
    if (!projeto || !a?.perimetro || h.base) return;
    // CAR já exportado: não mexe no terreno sozinho (o shapefile entregue ficaria diferente); o cartão oferece o botão
    if (servico.status === "gerado") return;
    // o corte não resolveu (geometria estranha): não mexe no terreno; o cartão mostra
    if (a.restanteM2 > 0.01 || ajustesSeguidos.current >= 3) return;
    ajustesSeguidos.current++;
    aplicarAjuste(projeto, a);
  }, [sob.ajuste]); // eslint-disable-line react-hooks/exhaustive-deps

  function desfazerAjuste() {
    const reg = projeto?.sobreposicao;
    if (!projeto || !reg?.original) return;
    const ignorar = [...new Set([...reg.ignorar, ...reg.cortes.map((c) => c.codigo)])];
    mudar(reacomodar({
      ...comPerimetro(projeto, reg.original, reg.nomesOriginais),
      sobreposicao: { ...reg, original: null, nomesOriginais: undefined, cortes: [], depoisM2: reg.antesM2, ignorar, forcar: reg.forcar.filter((c) => !ignorar.includes(c)) },
    }));
    ajustesSeguidos.current = 0;
    mostrar("Ajuste desfeito: o terreno voltou ao perímetro do arquivo, com a sobreposição. O SEIA/SICAR vai acusar.");
  }
  function recortarTambem(codigo: string) {
    if (!projeto) return;
    const reg = projeto.sobreposicao;
    ajustesSeguidos.current = 0;
    mudar({
      ...projeto,
      sobreposicao: {
        original: reg?.original ?? null, ...(reg?.nomesOriginais ? { nomesOriginais: reg.nomesOriginais } : {}),
        cortes: reg?.cortes ?? [], antesM2: reg?.antesM2 ?? 0, depoisM2: reg?.depoisM2 ?? 0, em: reg?.em ?? "",
        ignorar: (reg?.ignorar ?? []).filter((c) => c !== codigo), forcar: [...new Set([...(reg?.forcar ?? []), codigo])],
      },
    });
  }
  // no mapa: os vizinhos em volta (vermelho = ainda invade, laranja = ajustado, branco = conferido) e o pedaço tirado
  const desenhoSob = useMemo(() => {
    if (!res || !projeto) return { vizinhos: [] as VizinhoNoMapa[], recorte: [] as Poligono[] };
    const pl = res.plano;
    const vizinhos = vizinhosNoMapa(res.imovel.ext, sob.dados?.vizinhos ?? [], pl.para, sob.ajuste?.itens ?? [],
      projeto.sobreposicao?.original ? projeto.sobreposicao.cortes : []);
    const orig = projeto.sobreposicao?.original;
    let recorte: Poligono[] = [];
    if (orig && orig.length >= 3) {
      try { recorte = diferenca([{ ext: antiHorario(orig.map(pl.para)), furos: [] }], [res.imovel]).filter((p) => Math.abs(p.ext.length) >= 3); } catch { /* sem desenho */ }
    }
    return { vizinhos, recorte };
  }, [res, projeto, sob.dados, sob.ajuste]);

  /** transiente = arraste em andamento: só o estado antes dele vai para o desfazer */
  const mudar = useCallback((p: ProjetoCar, transiente = false) => {
    setH((x) => {
      if (!x.atual) return x;
      if (transiente) return { ...x, atual: p, base: x.base ?? x.atual };
      return { passado: [...x.passado, x.base ?? x.atual].slice(-60), atual: p, futuro: [], base: null };
    });
  }, []);
  const fimArraste = useCallback(() => {
    setH((x) => (x.base && x.atual ? { passado: [...x.passado, x.base].slice(-60), atual: x.atual, futuro: [], base: null } : x));
  }, []);
  const desfazer = useCallback(() => setH((x) => (x.passado.length && x.atual
    ? { passado: x.passado.slice(0, -1), atual: x.passado[x.passado.length - 1], futuro: [x.atual, ...x.futuro], base: null } : x)), []);
  const refazer = useCallback(() => setH((x) => (x.futuro.length && x.atual
    ? { passado: [...x.passado, x.atual], atual: x.futuro[0], futuro: x.futuro.slice(1), base: null } : x)), []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); setSel(null); if (e.shiftKey) refazer(); else desfazer(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); setSel(null); refazer(); }
      else if (e.key === "Delete" && sel) { e.preventDefault(); apagarSelecionado(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  // ---------------- ações da reserva ----------------
  function porLado(lado: number) {
    if (alvoLado === "vegetacao") vegetacaoNoLado(lado);
    else reservaNoLado(lado);
  }
  function reservaNoLado(lado: number, giro = projeto?.reserva.giro ?? 0) {
    if (!projeto) return;
    try {
      const poligonos = reservaPorLado(projeto, lado, giro);
      mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos, lado, giro } });
      setSel(null);
      setFerramenta("mover");
      mostrar(`Reserva encostada no lado ${lado + 1}, com ${fmtPct(projeto.reserva.pct)} do imóvel. Gire a divisa ou arraste os vértices para ajustar.`);
    } catch (e) { mostrar(e instanceof Error ? e.message : String(e), true); }
  }
  function ajustar() {
    if (!projeto) return;
    try {
      const poligonos = ajustarReserva(projeto);
      mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos } });
      setSel(null);
      mostrar(`Reserva ajustada a ${fmtPct(projeto.reserva.pct)} sem sair do lugar (a borda de dentro andou por igual).`);
    } catch (e) { mostrar(e instanceof Error ? e.message : String(e), true); }
  }
  function mudarPct(pct: number) {
    if (!projeto || !Number.isFinite(pct)) return;
    const p = { ...projeto, reserva: { ...projeto.reserva, pct: Math.max(0, Math.min(100, pct)) } };
    // faixa automática acompanha a porcentagem; desenho à mão espera o "Ajustar"
    if (p.reserva.lado !== null && p.reserva.poligonos.length) {
      try { p.reserva.poligonos = reservaPorLado(p, p.reserva.lado, p.reserva.giro); } catch { /* fica como estava */ }
    }
    mudar(p);
  }
  // ---------------- ações da vegetação nativa ----------------
  function vegetacaoNoLado(lado: number, giro = projeto?.vegetacao.giro ?? 0) {
    if (!projeto) return;
    try {
      const poligonos = vegetacaoPorLado(projeto, lado, giro);
      mudar({ ...projeto, vegetacao: { ...projeto.vegetacao, poligonos, lado, giro } });
      setSel(null);
      setFerramenta("mover");
      mostrar(`Vegetação nativa encostada no lado ${lado + 1}, com ${fmtHa((projeto.vegetacao.alvoHa ?? 0) * 1e4)}, fora da reserva. Gire a divisa ou arraste os vértices para ajustar.`);
    } catch (e) { mostrar(e instanceof Error ? e.message : String(e), true); }
  }
  function ajustarVeg() {
    if (!projeto) return;
    try {
      const poligonos = ajustarVegetacao(projeto);
      mudar({ ...projeto, vegetacao: { ...projeto.vegetacao, poligonos } });
      setSel(null);
      mostrar(`Vegetação nativa ajustada a ${fmtHa((projeto.vegetacao.alvoHa ?? 0) * 1e4)} sem sair do lugar.`);
    } catch (e) { mostrar(e instanceof Error ? e.message : String(e), true); }
  }
  function mudarAlvoVeg(ha: number) {
    if (!projeto) return;
    const p = { ...projeto, vegetacao: { ...projeto.vegetacao, alvoHa: Number.isFinite(ha) && ha > 0 ? ha : null } };
    // faixa automática acompanha a área; desenho à mão espera o "Ajustar"
    if (p.vegetacao.alvoHa && p.vegetacao.lado !== null && p.vegetacao.poligonos.length) {
      try { p.vegetacao.poligonos = vegetacaoPorLado(p, p.vegetacao.lado, p.vegetacao.giro); } catch { /* fica como estava */ }
    }
    mudar(p);
  }
  const mudarBeneficiado = (patch: Partial<ProjetoCar["vegetacao"]["beneficiado"]>) => projeto &&
    mudar({ ...projeto, vegetacao: { ...projeto.vegetacao, beneficiado: { ...projeto.vegetacao.beneficiado, ...patch } } });
  function encostar(alvo: "reserva" | "vegetacao") {
    if (alvo === "vegetacao" && !projeto?.vegetacao.alvoHa) { mostrar("Informe primeiro a área a ceder (ha) — é o que o imóvel beneficiado precisa compensar.", true); return; }
    setAlvoLado(alvo);
    setFerramenta("lado");
  }

  function apagarSelecionado() {
    if (!projeto || !sel) return;
    if (sel.tipo === "reserva") {
      mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos: projeto.reserva.poligonos.filter((_, i) => i !== sel.i), lado: null } });
    } else if (sel.tipo === "vegetacao") {
      mudar({ ...projeto, vegetacao: { ...projeto.vegetacao, poligonos: projeto.vegetacao.poligonos.filter((_, i) => i !== sel.i), lado: null } });
    } else {
      mudar({ ...projeto, rios: projeto.rios.filter((r) => r.id !== sel.id) });
    }
    setSel(null);
  }
  const mudarRio = (id: string, patch: Partial<ProjetoCar["rios"][number]>) => projeto &&
    mudar({ ...projeto, rios: projeto.rios.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  // ---------------- downloads ----------------
  async function exportar(qual: CamadaCar | "tudo" | "kml" | "kml-vegetacao") {
    if (!projeto || !res) return;
    setBaixando(qual);
    try {
      // o servidor gera a partir do projeto GRAVADO (e confere o imóvel do
      // serviço, 0039): grava antes de pedir
      await armazenamento.salvar(servico.id, projeto);
      await baixarEntrega({ servico_id: servico.id, saida: qual });
      if (servico.status !== "gerado") {
        await armazenamento.marcarExportado?.(servico.id);
        setServico({ ...servico, status: "gerado" });
      }
    } catch (e) { mostrar(e instanceof Error ? e.message : String(e), true); }
    finally { setBaixando(null); }
  }

  if (erroCarga) {
    return (
      <div className="centro"><div><h2>Não foi possível abrir o CAR</h2><p>{erroCarga}</p>
        <p className="car-dica">Se a mensagem fala da tabela <code>car_projetos</code>, falta aplicar a migração 0023 no banco.</p>
        <button onClick={onVoltar}>← Serviços</button></div></div>
    );
  }
  if (!projeto || !res) return <div className="centro"><span className="spinner" />&nbsp; Abrindo o CAR…</div>;

  const a = res.area;
  const vazia: Record<CamadaCar, boolean> = { imovel: false, reserva: !res.reserva.length, vegetacao: !res.vegetacao.length, produtiva: !res.produtiva.length, app: !res.app.length };
  const ferramentas: [FerramentaCar, string, string][] = [
    ["mover", "↖", "Selecionar e mover (arraste vértices; o fundo move o mapa)"],
    ["lado", "⊟", "Reserva encostada num lado do imóvel, na porcentagem exata"],
    ["reserva", "⬠", "Desenhar a reserva à mão"],
    ["vegetacao", "🌳", "Desenhar a vegetação nativa cedida a outro imóvel"],
    ["rio", "〰", "Traçar um rio (APP dos dois lados)"],
  ];
  const veg = projeto.vegetacao;
  // a régua do giro fica com quem foi encostado por último
  const giroDe: "reserva" | "vegetacao" | null = alvoLado === "vegetacao" && veg.lado !== null && veg.poligonos.length ? "vegetacao"
    : projeto.reserva.lado !== null && projeto.reserva.poligonos.length ? "reserva"
    : veg.lado !== null && veg.poligonos.length ? "vegetacao" : null;
  const rioSel = sel?.tipo === "rio" ? projeto.rios.find((r) => r.id === sel.id) : undefined;
  const travadoSob = servico.status === "gerado";
  const sobDestaque = !!(projeto.sobreposicao?.original && projeto.sobreposicao.cortes.length)
    || !!sob.ajuste?.itens.some((i) => i.decisao !== "proprio" && (i.decisao !== "cortado" || (travadoSob && !!sob.ajuste?.perimetro)))
    || motivosIncompleta(sob.dados).length > 0;
  const cartaoSob = (
    <CartaoSobreposicao estado={sob} ajuste={sob.ajuste} projeto={projeto} fator={res.fatorArea}
      onDesfazer={desfazerAjuste} onRecortar={recortarTambem} onDeNovo={sob.deNovo}
      travado={travadoSob} onAplicar={() => { if (sob.ajuste?.perimetro && sob.ajuste.restanteM2 <= 0.01) aplicarAjuste(projeto, sob.ajuste); }} />
  );

  return (
    <div className="conferencia car-pagina tela-cheia">
      <header className="topo">
        <button className="fantasma voltar voltar-pagina" onClick={onVoltar}>← Serviços</button>
        <span className="sep" aria-hidden="true">/</span>
        <h1 className="titulo">{projeto.nome}</h1>
        <span className="chip mod-car">{rotuloCurto.car}</span>
        {servico.nome_arquivo_txt && <span className="arquivo">{servico.nome_arquivo_txt}</span>}
        <StatusSalvamento estado={auto.estado} horaSalvo={auto.horaSalvo} />
        <span className="esticar" />
        <ExportarArea servicoId={servico.id} temPerimetro={projeto.perimetro.length >= 3} antes={auto.agora} />
        <BotaoConcluir servico={servico} conclusao={conclusao} pronto={servico.status === "gerado"} />
        <span className="car-resumo-topo">
          <b>{fmtHa(a.imovel)}</b> · reserva <b className={res.reservaOk ? "" : "car-falta"}>{fmtPct(res.pctReserva)}</b>
        </span>
      </header>

      <div className={`car-area-trabalho${recolhido ? " painel-recolhido" : ""}`}>
        <nav className="car-ferramentas" aria-label="Ferramentas">
          {ferramentas.map(([f, i, t]) => (
            <button key={f} title={t} aria-label={t} className={ferramenta === f && (f !== "lado" || alvoLado === "reserva") ? "ativo" : ""}
              onClick={() => (f === "lado" ? encostar("reserva") : setFerramenta(f))}>{i}</button>
          ))}
          <span className="sep" />
          <button title="Desfazer (Ctrl+Z)" aria-label="Desfazer" disabled={!h.passado.length} onClick={desfazer}>↶</button>
          <button title="Refazer (Ctrl+Y)" aria-label="Refazer" disabled={!h.futuro.length} onClick={refazer}>↷</button>
          <span className="sep" />
          <button title="Imagem de satélite" aria-label="Imagem de satélite" className={satelite ? "ativo" : ""} onClick={() => setSatelite(!satelite)}>🛰</button>
        </nav>

        <div className="car-centro">
          <CarEditor projeto={projeto} res={res} ferramenta={ferramenta} onFerramenta={setFerramenta} sel={sel} onSel={setSel}
            onMudar={mudar} onFimArraste={fimArraste} onLado={(l) => porLado(l)} alvoLado={alvoLado} satelite={satelite} onMsg={(t) => mostrar(t)}
            vizinhos={desenhoSob.vizinhos} recorte={desenhoSob.recorte}
            sobreposto={giroDe === "reserva" ? (
              // o giro da divisa da reserva mexe no desenho: a régua fica nele
              <GiroMapa rotulo="Giro da reserva" valor={projeto.reserva.giro} min={-60} max={60} passo={1} onFim={fimArraste}
                onGiro={(giro) => {
                  try {
                    const poligonos = reservaPorLado(projeto, projeto.reserva.lado!, giro);
                    mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos, giro } }, true);
                  } catch { /* giro sem solução: fica o anterior */ }
                }} />
            ) : giroDe === "vegetacao" ? (
              <GiroMapa rotulo="Giro da vegetação" valor={veg.giro} min={-60} max={60} passo={1} onFim={fimArraste}
                onGiro={(giro) => {
                  try {
                    const poligonos = vegetacaoPorLado(projeto, veg.lado!, giro);
                    mudar({ ...projeto, vegetacao: { ...veg, poligonos, giro } }, true);
                  } catch { /* giro sem solução: fica o anterior */ }
                }} />
            ) : null} />
          {msg && (
            <div className={`car-msg${msg.erro ? " erro" : ""}`} role="status">
              <span>{msg.t}</span>
              <button className="fantasma" onClick={() => setMsg(null)} aria-label="Fechar">×</button>
            </div>
          )}
        </div>

        {recolhido ? (
          <aside className="rapido car-rapido" aria-label="Ações rápidas">
            <button className="rapido-abrir" onClick={() => recolher(false)} title="Abrir o painel (quadro de áreas, reserva, vegetação, rios, arquivos)"><Icone d={ICO_CAR.abrir} size={18} /></button>
            <span className={`rapido-sel${res.reservaOk ? "" : " falta"}`} title={`Reserva legal: ${fmtPct(res.pctReserva)} (pedido ${fmtPct(projeto.reserva.pct)})`}>RL {fmtPct(res.pctReserva)}</span>
            <button className={ferramenta === "lado" && alvoLado === "reserva" ? "ativo" : ""} onClick={() => encostar("reserva")} title="Encostar a reserva num lado do imóvel"><Icone d={ICO_CAR.encostar} size={18} /><span>Encostar</span></button>
            <button className={ferramenta === "reserva" ? "ativo" : ""} onClick={() => setFerramenta("reserva")} title="Desenhar a reserva à mão"><Icone d={ICO_CAR.desenhar} size={18} /><span>Desenhar</span></button>
            {projeto.reserva.poligonos.length > 0 && (
              <button className="forte" onClick={ajustar} disabled={res.reservaOk && Math.abs(res.pctReserva - projeto.reserva.pct) < 0.01} title={`Ajustar a reserva a ${fmtPct(projeto.reserva.pct)}`}>
                <Icone d={ICO_CAR.ajustar} size={18} /><span>Ajustar</span>
              </button>
            )}
            <button className={ferramenta === "vegetacao" ? "ativo" : ""} onClick={() => setFerramenta("vegetacao")} title="Desenhar a vegetação nativa à mão"><Icone d={ICO_CAR.vegetacao} size={18} /><span>Vegetação</span></button>
            <button className={ferramenta === "rio" ? "ativo" : ""} onClick={() => setFerramenta("rio")} title="Traçar um rio (APP)"><Icone d={ICO_CAR.rio} size={18} /><span>Rio</span></button>
            <span className="rapido-esticar" />
            <button onClick={() => exportar("kml")} disabled={!!baixando} title="KML de conferência"><Icone d={ICO_CAR.kml} size={18} /><span>KML</span></button>
            <button className="principal" disabled={!!baixando} onClick={() => exportar("tudo")} title="Baixar tudo para o SICAR (zip)"><Icone d={ICO_CAR.baixar} size={18} /><span>{baixando === "tudo" ? "Gerando…" : "SICAR"}</span></button>
          </aside>
        ) : (
        <aside className="car-painel">
          <div className="painel-barra">
            <span>Projeto do CAR</span>
            <button className="fantasma" onClick={() => recolher(true)} title="Recolher o painel: o mapa fica maior e as ações rápidas continuam à mão">Recolher <b aria-hidden="true">»</b></button>
          </div>
          {/* teve ajuste ou há o que conferir: o cartão sobe para o topo */}
          {sobDestaque && cartaoSob}
          <section className="car-cartao">
            <header><h3>Quadro de áreas</h3></header>
            <table className="car-quadro">
              <tbody>
                <tr><td><i style={{ background: COR.imovel }} />Área total</td><td>{fmtHa(a.imovel)}</td><td>100%</td></tr>
                <tr><td><i style={{ background: COR.reserva }} />Reserva legal</td><td>{fmtHa(a.reserva)}</td>
                  <td className={res.reservaOk ? "" : "car-falta"}>{fmtPct(res.pctReserva)}</td></tr>
                {(veg.poligonos.length > 0 || a.vegetacao > 0) && (
                  <tr><td><i style={{ background: COR.vegetacao }} />Vegetação nativa</td><td>{fmtHa(a.vegetacao)}</td><td>{fmtPct((100 * a.vegetacao) / a.imovel)}</td></tr>
                )}
                <tr><td><i style={{ background: COR.produtiva }} />Área produtiva</td><td>{fmtHa(a.produtiva)}</td><td>{fmtPct((100 * a.produtiva) / a.imovel)}</td></tr>
                <tr><td><i style={{ background: COR.app }} />APP</td><td>{fmtHa(a.app)}</td><td>{fmtPct((100 * a.app) / a.imovel)}</td></tr>
              </tbody>
            </table>
            {a.appNaReserva > 0.01 && <p className="car-dica">{fmtHa(a.appNaReserva)} da APP estão dentro da reserva legal.</p>}
            {/* serviço antigo (sem a escolha gravada) segue na área igual, como sempre foi */}
            <EscolhaBaseArea compacta perimetro={projeto.perimetro} valor={projeto.baseArea ?? "albers"}
              onMudar={(b) => mudar({ ...projeto, baseArea: b })} />
            <label className="car-check">
              <input type="checkbox" checked={projeto.produtivaSemApp} onChange={(e) => mudar({ ...projeto, produtivaSemApp: e.target.checked })} />
              <span>Tirar a APP da área produtiva<Dica>Padrão: produtiva = total − reserva − vegetação nativa cedida.</Dica></span>
            </label>
          </section>

          <section className="car-cartao">
            <header><h3>Reserva legal<Dica>A porcentagem exigida é 20% fora da Amazônia Legal; 35% no cerrado e 80% na floresta dentro dela — confirme a regra do imóvel. "Encostar" põe a reserva junto de um lado do imóvel (clique no lado; o giro fica no mapa); "Desenhar" é à mão, clicando os vértices.</Dica></h3>{res.reservaOk ? <span className="car-ok">✓ ok</span> : <span className="car-falta">abaixo do pedido</span>}</header>
            {/* porcentagem e as duas formas de desenhar numa linha só */}
            <div className="car-reserva-linha">
              <label className="car-entrada car-pct" title="Porcentagem exigida da reserva legal">
                <input type="number" min={0} max={100} step={1} value={projeto.reserva.pct}
                  onChange={(e) => mudarPct(Number(e.target.value))} aria-label="Porcentagem da reserva legal" />
                <span>%</span>
              </label>
              <button className={ferramenta === "lado" && alvoLado === "reserva" ? "ativo" : ""} onClick={() => encostar("reserva")} title="Encostar a reserva num lado do imóvel">⊟ Encostar</button>
              <button className={ferramenta === "reserva" ? "ativo" : ""} onClick={() => setFerramenta("reserva")} title="Desenhar a reserva à mão">⬠ Desenhar</button>
            </div>
            {projeto.reserva.poligonos.length > 0 && (
              <div className="car-botoes">
                <button className="principal" onClick={ajustar} disabled={res.reservaOk && Math.abs(res.pctReserva - projeto.reserva.pct) < 0.01}>
                  Ajustar a {fmtPct(projeto.reserva.pct)}
                </button>
                <button onClick={() => { mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos: [], lado: null } }); setSel(null); }}>Apagar reserva</button>
              </div>
            )}
            {sel?.tipo === "reserva" && (
              <p className="car-dica">Polígono {sel.i + 1} selecionado · arraste os vértices · Delete apaga só este polígono.</p>
            )}
          </section>

          <section className="car-cartao car-vegetacao">
            <header>
              <h3>Vegetação nativa<Dica>Mata excedente deste imóvel que vai servir de reserva legal de OUTRO imóvel (compensação, Código Florestal art. 66, §5º, IV — mesmo bioma). Só pode ser excedente: o que cair na reserva legal deste imóvel fica de fora. Sai num shapefile próprio (VEGETACAO_NATIVA) e num KML com a área e o imóvel beneficiado.</Dica></h3>
              {veg.poligonos.length > 0 && (res.vegetacaoOk ? <span className="car-ok">✓ {fmtHa(a.vegetacao)}</span> : <span className="car-falta">abaixo da área</span>)}
            </header>
            <div className="car-reserva-linha">
              <label className="car-entrada car-ha" title="Área que o imóvel beneficiado precisa compensar">
                <input type="number" min={0} step={0.01} value={veg.alvoHa ?? ""} placeholder="0,00"
                  onChange={(e) => mudarAlvoVeg(e.target.value === "" ? NaN : Number(e.target.value))} aria-label="Área a ceder em hectares" />
                <span>ha</span>
              </label>
              <button className={ferramenta === "lado" && alvoLado === "vegetacao" ? "ativo" : ""} onClick={() => encostar("vegetacao")} title="Encostar a vegetação num lado do imóvel, com a área pedida, fora da reserva">⊟ Encostar</button>
              <button className={ferramenta === "vegetacao" ? "ativo" : ""} onClick={() => setFerramenta("vegetacao")} title="Desenhar a vegetação à mão">⬠ Desenhar</button>
            </div>
            <div className="car-beneficiado">
              <label className="car-campo"><span>Imóvel beneficiado</span>
                <input value={veg.beneficiado.nome} placeholder="Fazenda que vai usar a área" onChange={(e) => mudarBeneficiado({ nome: e.target.value })} />
              </label>
              <label className="car-campo"><span>CAR do beneficiado</span>
                <input value={veg.beneficiado.car} placeholder="BA-0000000-…" onChange={(e) => mudarBeneficiado({ car: e.target.value })} />
              </label>
            </div>
            {veg.poligonos.length > 0 && (
              <div className="car-botoes">
                <button className="principal" onClick={ajustarVeg} disabled={!veg.alvoHa || (res.vegetacaoOk && Math.abs(a.vegetacao - veg.alvoHa * 1e4) < 2)}
                  title={veg.alvoHa ? undefined : "Informe a área a ceder"}>
                  {veg.alvoHa ? `Ajustar a ${fmtHa(veg.alvoHa * 1e4)}` : "Ajustar à área"}
                </button>
                <button onClick={() => exportar("kml-vegetacao")} disabled={!res.vegetacao.length || !!baixando}>{baixando === "kml-vegetacao" ? "…" : "KML da vegetação"}</button>
                <button className="fantasma" onClick={() => { mudar({ ...projeto, vegetacao: { ...veg, poligonos: [], lado: null } }); setSel(null); }}>Apagar</button>
              </div>
            )}
            {sel?.tipo === "vegetacao" && (
              <p className="car-dica">Polígono {sel.i + 1} selecionado · arraste os vértices · Delete apaga só este polígono.</p>
            )}
          </section>

          <section className="car-cartao">
            <header><h3>Rios e APP<Dica>Trace o rio pela linha do leito e informe a faixa de APP, em metros, medida da linha para cada margem.</Dica></h3><span className="car-cont">{projeto.rios.length}</span></header>
            <button className={ferramenta === "rio" ? "ativo" : ""} onClick={() => setFerramenta("rio")}>〰 Traçar rio</button>
            {projeto.rios.map((r) => (
              <div key={r.id} className={`car-rio${rioSel?.id === r.id ? " sel" : ""}`} onClick={() => setSel({ tipo: "rio", id: r.id })}>
                <input className="car-rio-nome" value={r.nome} onChange={(e) => mudarRio(r.id, { nome: e.target.value })} aria-label="Nome do rio" />
                <span className="car-entrada">
                  <input type="number" min={1} step={1} value={r.faixa} onChange={(e) => mudarRio(r.id, { faixa: Math.max(0, Number(e.target.value)) })} aria-label="Faixa de APP em metros" />
                  <span>m</span>
                </span>
                <select value={FAIXAS_APP.some((f) => f.faixa === r.faixa) ? r.faixa : ""} onChange={(e) => e.target.value && mudarRio(r.id, { faixa: Number(e.target.value) })}
                  aria-label="Faixa pela largura do rio" title="Faixa mínima da Lei 12.651/2012, art. 4º">
                  <option value="">pela lei…</option>
                  {FAIXAS_APP.map((f) => <option key={f.faixa} value={f.faixa}>{f.faixa} m · {f.leito}</option>)}
                </select>
                <button className="fantasma" title="Apagar o rio" aria-label="Apagar o rio"
                  onClick={(e) => { e.stopPropagation(); mudar({ ...projeto, rios: projeto.rios.filter((x) => x.id !== r.id) }); setSel(null); }}>×</button>
              </div>
            ))}
          </section>

          {!sobDestaque && cartaoSob}
          {/* restrições do imóvel (TI, UC, assentamento, embargo…): o CAR já pagou, não cobra */}
          <RestricoesImovel aneisLonLat={aneisRestricoes} fuso={null} classe="car-cartao restricoes compacto" id="car-restricoes"
            dados={{ imovel: projeto.nome || servico.denominacao, municipio: servico.municipio, uf: servico.uf }} />

          {res.avisos.length > 0 && (
            <section className="car-cartao car-avisos">
              {res.avisos.map((t) => <p key={t}>⚠ {t}</p>)}
            </section>
          )}

          <section className="car-cartao">
            <header><h3>Arquivos para o SICAR<Dica>Cada camada sai num zip com SHP, SHX, DBF e PRJ (SIRGAS 2000, em grau).</Dica></h3></header>
            {CAMADAS.map((c) => (
              <div key={c.id} className="car-baixar">
                <i style={{ background: c.cor }} />
                <span>{c.titulo}<small>{c.arquivo}.shp</small></span>
                <button disabled={vazia[c.id] || !!baixando} onClick={() => exportar(c.id)}>{baixando === c.id ? "…" : "Baixar"}</button>
              </div>
            ))}
            <div className="car-botoes">
              <button className="principal" disabled={!!baixando} onClick={() => exportar("tudo")}>{baixando === "tudo" ? "Gerando…" : "Baixar tudo (zip)"}</button>
              <button disabled={!!baixando} onClick={() => exportar("kml")}>KML de conferência</button>
            </div>
            {res.vegetacao.length > 0 && (
              <div className="car-baixar">
                <i style={{ background: COR.vegetacao }} />
                <span>KML da vegetação nativa<small>{nomeArquivo(projeto.nome)}_VEGETACAO_NATIVA.kml</small></span>
                <button disabled={!!baixando} onClick={() => exportar("kml-vegetacao")}>{baixando === "kml-vegetacao" ? "…" : "Baixar"}</button>
              </div>
            )}
            {!res.reservaOk && <p className="car-falta" style={{ fontSize: 12.5, margin: 0 }}>A reserva ainda não chega a {fmtPct(projeto.reserva.pct)} — o SICAR vai acusar.</p>}
            <p className="car-dica">Área total {fmtNum(a.imovel, 2)} m² · reserva {fmtNum(a.reserva, 2)} m²{a.vegetacao > 0 ? ` · vegetação nativa ${fmtNum(a.vegetacao, 2)} m²` : ""} · produtiva {fmtNum(a.produtiva, 2)} m² · APP {fmtNum(a.app, 2)} m²</p>
          </section>
        </aside>
        )}
      </div>
    </div>
  );
}
