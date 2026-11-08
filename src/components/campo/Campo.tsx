// Medir no campo (#/campo), pensada para o celular.
//
// Plano: docs/plano-ferramentas-campo-consulta-terraplanagem.md, seção 2.
// O agrimensor, na visita ao imóvel, quer o contorno sem levar o GNSS:
//   • Caminhar: um vértice sozinho a cada 5 m ou a cada curva de 15°;
//   • Marcar ponto aqui: junta as leituras por alguns segundos ("±2,8 m");
//   • Desenhar no mapa: sem GPS (computador, permissão negada).
// Área e perímetro ao vivo no motor único (lib/campo/geometria.ts). Nada se
// perde: cada vértice vai para o aparelho na hora (lib/campo/aparelho.ts) e a
// medição sobe sozinha para a conta quando há internet (0047). Fechada a área,
// a próxima ação está à mão: criar o serviço de CAR, consultar, baixar.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Rota } from "../../lib/rota";
import { transferirArea } from "../../lib/area_transferida";
import {
  alterar, armazemDoUsuario, enviadasAgora, excluidasNaConta, gravarAparelho, guardarMedicao, juntarListas, lerAparelho, novaMedicao, paraEnviar,
  pendente, quando, removerMedicao, textoRetomada, textoUltimoVertice, textoVertices,
} from "../../lib/campo/aparelho.ts";
import type { Armazem, EstadoAparelho, ItemLista } from "../../lib/campo/aparelho.ts";
import { areaSignificativa, classePrecisao, contornoSeCruza, medir, textoDistancia, textoHa, textoM2, textoPrecisao, textoPrecisao95 } from "../../lib/campo/geometria.ts";
import { combinarLeituras, leituraUtil, verticeAoCaminhar, verticeDoPonto } from "../../lib/campo/motor.ts";
import type { PontoCombinado } from "../../lib/campo/motor.ts";
import { convergencia, criarFiltroCaminhar, estadoAquecimento } from "../../lib/campo/filtro.ts";
import type { Convergencia, EstadoAquecimento } from "../../lib/campo/filtro.ts";
import { aplicarCalibracoes, calibrarVertice, novaCalibracao, textoDeslocamento } from "../../lib/campo/calibracao.ts";
import type { MarcoProximo } from "../../lib/campo/calibracao.ts";
import { ajustarCerca, valeAjustar } from "../../lib/campo/ajuste.ts";
import type { AjusteCerca } from "../../lib/campo/ajuste.ts";
import { apagarDiagnostico, arquivoDiagnostico, gravarDiagnostico, lerDiagnostico } from "../../lib/campo/diagnostico.ts";
import { PainelPrecisao } from "./Precisao";
import { PainelReceptor } from "./Receptor";
import { criarReceptor } from "../../lib/campo/receptor.ts";
import { abrirNtrip } from "../../lib/campo/ntrip.ts";
import type { AbaPrecisao } from "./Precisao";
import { fonteDoNavegador } from "../../lib/campo/gps.ts";
import type { ErroGps, FonteGps } from "../../lib/campo/gps.ts";
import { areaDaMedicao, esquecerMedicaoPedida, medicaoPedida } from "../../lib/campo/ponte.ts";
import { enviarPendentes } from "../../lib/campo/fila.ts";
import type { Fila } from "../../lib/campo/fila.ts";
import { pedirArmazenamentoPersistente, registrarTela, usuarioAtual } from "../../lib/campo/envio.ts";
import { lerLugar } from "../../lib/campo/lugar.ts";
import { ErroConta, LIMITE_LISTA } from "../../lib/campo/repositorio.ts";
import type { RepositorioMedicoes, TipoErroConta } from "../../lib/campo/repositorio.ts";
import { repositorioSupabase } from "../../lib/campo/conta.ts";
import { conferirAjuste, LIMITES_OPCOES, OPCOES_PADRAO, opcoesValidas } from "../../lib/campo/tipos.ts";
import { limpezaAindaVale, limparLinhaReta, valeLimpar } from "../../lib/campo/simplificar.ts";
import type { Limpeza } from "../../lib/campo/simplificar.ts";
import type { Calibracao, Leitura, LonLat, Medicao, OpcoesCampo, TipoFix, VerticeCampo } from "../../lib/campo/tipos.ts";
import { avisar, confirmar, Dica, EstadoErro, EstadoVazio, Esqueleto, Gaveta, Rotulo } from "../ui";
import { MapaCampo } from "./MapaCampo";
import type { ControleImagemProps } from "./MapaCampo";
import { MenuBaixar } from "./MenuBaixar";
import { SeletorImagemData } from "../imagem/SeletorImagemData";
import { zoomParaExtensao } from "../../lib/imagem_data";
import "./campo.css";

export interface PropsCampo {
  ir: (r: Rota) => void;
  /** abre esta medição quando a lista da conta chegar (o "← Voltar" do CAR, se ela não está no aparelho) */
  abrirId?: string;
  /** de onde vêm as posições (padrão: o GPS do aparelho; o laboratório passa o simulador) */
  fonte?: FonteGps;
  /** liga o GPS ao abrir (padrão: sim no celular; no computador espera o botão) */
  ligarGps?: boolean;
  /** onde ficam as medições na conta (padrão: a tabela medicoes_campo) */
  repositorio?: RepositorioMedicoes;
  /** onde o aparelho grava (padrão: localStorage) */
  armazem?: Armazem | null;
  /** abre direto nesta medição (laboratório) */
  abrir?: Medicao;
  /**
   * Imagem por data (frente 3): o que desenhar por cima do mapa para trocar a
   * foto de satélite pela de outra data. Padrão: o SeletorImagemData, já ligado
   * (centro e zoom da medição). `null` tira o controle.
   */
  controleImagem?: ((p: ControleImagemProps) => ReactNode) | null;
}

type EstadoGps =
  | { tipo: "desligado" }
  | { tipo: "procurando" }
  | { tipo: "ok" }
  | { tipo: "erro"; erro: ErroGps };

type EstadoEnvio = "ocioso" | "enviando" | "enviado" | TipoErroConta;

const CHAVE_OPCOES = "vertces.campo.opcoes";
const CHAVE_DIAG_LIGADO = "vertces.campo.diag.ligado";
const CHAVE_EXIGIR_FIXO = "vertces.campo.exigirFixo";
export const AVISO_GPS = "GPS do celular: ±3 a 10 m. Serve para croqui, orçamento e CAR, não para georreferenciamento SIGEF (para isso, ligue um receptor RTK em Precisão).";

/** A oferta do fim da medição andada: ajustar a cerca (retas e cantos) ou só limpar os vértices em linha reta. */
type OfertaCerca = (AjusteCerca & { tipo: "ajuste" }) | (Limpeza & { tipo: "limpeza" });

const NOME_FIX: Record<TipoFix, string> = {
  "rtk-fixo": "RTK fixo", "rtk-flutuante": "RTK flutuante", dgps: "DGPS", autonomo: "Autônomo", "sem-fix": "Sem solução",
};

/** O que está sendo juntado no Marcar ponto: um vértice, ou a ocupação de um marco (calibração). */
interface Marcando { inicio: number; fim: number; calibrar?: { lon: number; lat: number; rotulo: string } }

/** Imagem por data no mapa do campo: as datas são procuradas no lugar da medição. */
function controleImagemPadrao(p: ControleImagemProps): ReactNode {
  return <SeletorImagemData mapa={p.mapa} centro={p.centro} zoom={p.zoom} />;
}

function armazemPadrao(): Armazem | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}
const ehCelular = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

/** Tela estreita (celular, ≤ 900 px): o painel vira a folha de baixo do mapa. */
function useEstreita(): boolean {
  const consulta = "(max-width: 900px)";
  const [v, setV] = useState(() => typeof matchMedia !== "undefined" && matchMedia(consulta).matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia(consulta);
    const f = () => setV(mq.matches);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, []);
  return v;
}
const horaCurta = (d = new Date()) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * A tela. Sem `armazem` (o sistema de verdade), as medições ficam numa chave
 * do aparelho POR USUÁRIO: quem entra depois no mesmo navegador (outra pessoa,
 * outra empresa) não vê nem envia as medições de quem saiu.
 */
export function Campo(props: PropsCampo) {
  const doUsuario = props.armazem === undefined;
  const [usuario, setUsuario] = useState<string | null | undefined>(doUsuario ? undefined : null);
  useEffect(() => {
    if (!doUsuario) return;
    let vivo = true;
    void usuarioAtual().then((u) => { if (vivo) setUsuario(u); });
    return () => { vivo = false; };
  }, [doUsuario]);
  const arm = useMemo(() => {
    if (!doUsuario) return props.armazem ?? null;
    const base = armazemPadrao();
    return base && usuario ? armazemDoUsuario(base, usuario) : null;
  }, [doUsuario, props.armazem, usuario]);
  // "← Voltar para <medição>" do CAR novo: reabre a medição pedida (se ela está neste aparelho)
  const [pedida] = useState(() => medicaoPedida());
  useEffect(() => { if (pedida) esquecerMedicaoPedida(); }, [pedida]);
  const abrirPedida = useMemo(() => {
    if (props.abrir || !pedida || !arm) return undefined;
    return lerAparelho(arm).registros[pedida]?.medicao ?? undefined;
  }, [props.abrir, pedida, arm]);
  // a sessão sai do aparelho em milissegundos: espera para não abrir o aparelho errado
  if (doUsuario && usuario === undefined) return <div className="campo tela-cheia" data-tela-cheia data-sem-toque aria-busy="true" />;
  return <CampoTela key={usuario ?? "-"} {...props} abrir={props.abrir ?? abrirPedida} abrirId={!props.abrir && !abrirPedida && pedida ? pedida : undefined} armazem={arm} />;
}

function CampoTela(props: PropsCampo & { armazem: Armazem | null }) {
  const { ir } = props;
  // o receptor RTK (Bluetooth) vive enquanto a tela está aberta; ligado, ele é a fonte
  const receptor = useMemo(() => criarReceptor({ abrirNtrip }), []);
  useEffect(() => () => { void receptor.desconectar(); }, [receptor]);
  const receptorLigado = useSyncExternalStore(receptor.assinar, () => receptor.estado().conectado, () => false);
  const navegador = useMemo(() => fonteDoNavegador(), []);
  const fonte = props.fonte ?? (receptorLigado ? receptor : navegador);
  const repo = useMemo(() => props.repositorio ?? repositorioSupabase(), [props.repositorio]);
  const arm = props.armazem;

  // ------------------------------------------------------------ aparelho
  const [aparelho, setAparelho] = useState<EstadoAparelho>(() => lerAparelho(arm));
  const aparelhoRef = useRef(aparelho);
  const avisouGravacao = useRef(false);
  const persistir = useCallback((e: EstadoAparelho) => {
    aparelhoRef.current = e;
    setAparelho(e);
    if (!gravarAparelho(arm, e) && !avisouGravacao.current) {
      avisouGravacao.current = true;
      avisar("erro", "Este aparelho não está deixando gravar (modo anônimo ou memória cheia). Não feche a página antes de a medição ir para a conta.");
    }
  }, [arm]);

  // ------------------------------------------------------------ envio para a conta (declarado cedo: mudar() agenda)
  const timerEnvio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enviarRef = useRef<() => Promise<void>>(async () => {});
  const agendarEnvio = useCallback((ms = 2500) => {
    if (timerEnvio.current) clearTimeout(timerEnvio.current);
    timerEnvio.current = setTimeout(() => { timerEnvio.current = null; void enviarRef.current(); }, ms);
  }, []);

  // ------------------------------------------------------------ a medição na tela
  const [medicao, setMedicaoEstado] = useState<Medicao | null>(() => props.abrir ?? null);
  const medicaoRef = useRef(medicao);
  const [enquadrar, setEnquadrar] = useState(() => props.abrir?.id ?? "");
  const mudar = useCallback((m: Medicao) => {
    medicaoRef.current = m;
    setMedicaoEstado(m);
    persistir(guardarMedicao(aparelhoRef.current, m, !m.fechada));
    // o Safari do iPhone apaga o site sem uso por 7 dias: pede para guardar de vez
    if (m.vertices.length) pedirArmazenamentoPersistente();
    agendarEnvio();
  }, [persistir, agendarEnvio]);
  const mostrar = useCallback((m: Medicao | null) => {
    medicaoRef.current = m;
    setMedicaoEstado(m);
    if (m) setEnquadrar(`${m.id}:${Date.now()}`);
  }, []);
  useEffect(() => { if (props.abrir) persistir(guardarMedicao(aparelhoRef.current, props.abrir, !props.abrir.fechada)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // a retomada: a medição em andamento que ficou no aparelho
  const [oferta, setOferta] = useState<Medicao | null>(() => {
    if (props.abrir) return null;
    const e = aparelhoRef.current;
    const m = e.atualId ? e.registros[e.atualId]?.medicao : null;
    return m && m.vertices.length > 0 && !m.fechada ? m : null;
  });

  // ------------------------------------------------------------ ajustes
  const [opcoes, setOpcoesEstado] = useState<OpcoesCampo>(() => {
    try { return opcoesValidas(JSON.parse(arm?.getItem(CHAVE_OPCOES) ?? "null")); } catch { return OPCOES_PADRAO; }
  });
  const opcoesRef = useRef(opcoes);
  opcoesRef.current = opcoes;
  const setOpcoes = (o: OpcoesCampo) => {
    setOpcoesEstado(o);
    try { arm?.setItem(CHAVE_OPCOES, JSON.stringify(o)); } catch { /* fica só nesta visita */ }
  };
  // receptor RTK: só aceitar vértice com solução RTK fixa (o "ponto de SIGEF")
  const [exigirFixo, setExigirFixoEstado] = useState(() => { try { return arm?.getItem(CHAVE_EXIGIR_FIXO) === "1"; } catch { return false; } });
  const exigirFixoRef = useRef(exigirFixo);
  exigirFixoRef.current = exigirFixo;
  const setExigirFixo = (v: boolean) => {
    setExigirFixoEstado(v);
    try { if (v) arm?.setItem(CHAVE_EXIGIR_FIXO, "1"); else arm?.removeItem(CHAVE_EXIGIR_FIXO); } catch { /* só nesta visita */ }
  };

  // ------------------------------------------------------------ GPS
  const [gpsLigado, setGpsLigado] = useState(() => props.ligarGps ?? (!!props.fonte || ehCelular()));
  const [gps, setGps] = useState<EstadoGps>({ tipo: "desligado" });
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const leituraRef = useRef<Leitura | null>(null);
  // aberta já fechada (laboratório, link): mostra a área inteira, não o ponto azul
  const [seguir, setSeguir] = useState(() => !props.abrir?.fechada);
  const [caminhando, setCaminhandoEstado] = useState(false);
  const caminhandoRef = useRef(false);
  const setCaminhando = (v: boolean) => { caminhandoRef.current = v; setCaminhandoEstado(v); };
  const [desenhando, setDesenhando] = useState(false);
  const [marcando, setMarcandoEstado] = useState<Marcando | null>(null);
  const marcandoInfoRef = useRef<Marcando | null>(null);
  const setMarcando = (m: Marcando | null) => { marcandoInfoRef.current = m; setMarcandoEstado(m); };
  const marcandoRef = useRef<Leitura[] | null>(null);
  const [pontoRuim, setPontoRuim] = useState<PontoCombinado | null>(null);
  const [, setTique] = useState(0);

  const gpsDescansa = !!medicao?.fechada;

  // o vértice novo do GPS já entra com a calibração da medição (à mão não muda)
  const adicionar = useCallback((v: VerticeCampo) => {
    const m = medicaoRef.current;
    if (!m || m.fechada) return;
    mudar(alterar(m, { vertices: [...m.vertices, m.calibracoes?.length ? calibrarVertice(v, m.calibracoes) : v] }));
  }, [mudar]);

  // ------------------------------------------------------------ precisão: aquecimento, filtro, diagnóstico
  const historicoRef = useRef<Leitura[]>([]);
  const filtroRef = useRef(criarFiltroCaminhar());
  const [aquecimento, setAquecimento] = useState<EstadoAquecimento>({ pronto: false, segundos: 0, motivo: null });
  const aquecidoRef = useRef(false);
  const [diagLigado, setDiagLigadoEstado] = useState(() => { try { return arm?.getItem(CHAVE_DIAG_LIGADO) === "1"; } catch { return false; } });
  const diagLigadoRef = useRef(diagLigado);
  const diagBuffer = useRef<Leitura[]>([]);
  const [diagQtd, setDiagQtd] = useState(() => lerDiagnostico(arm).length);
  const setDiagLigado = (v: boolean) => {
    diagLigadoRef.current = v; setDiagLigadoEstado(v);
    try { if (v) arm?.setItem(CHAVE_DIAG_LIGADO, "1"); else arm?.removeItem(CHAVE_DIAG_LIGADO); } catch { /* só nesta visita */ }
  };
  useEffect(() => {
    // o diagnóstico grava em lotes (a cada 5 s), não a cada leitura
    const t = setInterval(() => {
      if (!diagBuffer.current.length) return;
      const lote = diagBuffer.current; diagBuffer.current = [];
      setDiagQtd(gravarDiagnostico(arm, lote));
    }, 5000);
    return () => clearInterval(t);
  }, [arm]);

  useEffect(() => {
    // área fechada e nada em andamento: o GPS descansa (bateria); volta em Continuar medindo / Nova
    if (!gpsLigado || gpsDescansa) { setGps({ tipo: "desligado" }); return; }
    setGps({ tipo: "procurando" });
    historicoRef.current = [];
    aquecidoRef.current = false;
    filtroRef.current.zerar();
    setAquecimento({ pronto: false, segundos: 0, motivo: null });
    const parar = fonte.iniciar(
      (l) => {
        leituraRef.current = l;
        setLeitura(l);
        setGps({ tipo: "ok" });
        if (diagLigadoRef.current) diagBuffer.current.push(l);
        // aquecimento: até o GPS assentar, a posição não vira o 1º vértice andando
        const h = historicoRef.current;
        h.push(l);
        if (h.length > 120) h.splice(0, h.length - 120);
        if (!aquecidoRef.current || l.fonte === "receptor") {
          const e = estadoAquecimento(h, l.t);
          aquecidoRef.current = e.pronto;
          setAquecimento(e);
        }
        if (marcandoRef.current) marcandoRef.current.push(l);
        const m = medicaoRef.current;
        if (caminhandoRef.current && m && !m.fechada) {
          // o filtro recusa o salto impossível a pé (reflexo); o resto segue suavizado
          const f = filtroRef.current.passar(l);
          if (!f) return;
          if (!m.vertices.length && !aquecidoRef.current) return;
          if (exigirFixoRef.current && l.fonte === "receptor" && l.fix !== "rtk-fixo") return;
          const r = verticeAoCaminhar(m.vertices, f, opcoesRef.current);
          if (r) adicionar(r.vertice);
        }
      },
      (erro) => {
        // perdeu o sinal no meio: a última posição continua no mapa, o status diz
        setGps({ tipo: "erro", erro });
        if (erro.tipo !== "sem-sinal") { leituraRef.current = null; setLeitura(null); setCaminhando(false); }
      },
    );
    return parar;
  }, [gpsLigado, gpsDescansa, fonte, adicionar]);

  function registrarPonto(p: PontoCombinado) {
    const m = medicaoRef.current;
    if (!m || m.fechada) return;
    adicionar(verticeDoPonto(p, Date.now()));
    avisar("ok", `P${m.vertices.length + 1} marcado · ${textoPrecisao(p.precisao)}${p.descartadas ? ` · ${p.descartadas} leitura(s) que pularam longe ficaram de fora` : ""}`);
  }

  /** Termina o Marcar ponto (no fim do tempo ou no "Pronto"): vira vértice ou calibração. */
  function terminarMarcar() {
    const info = marcandoInfoRef.current;
    let leituras = marcandoRef.current ?? [];
    marcandoRef.current = null;
    setMarcando(null);
    if (!info) return;
    // nada chegou na janela, mas o GPS respondeu há pouco e a pessoa está parada: vale a última
    const ultima = leituraRef.current;
    if (!leituras.length && ultima && Date.now() - ultima.t < 20_000) leituras = [ultima];
    const p = combinarLeituras(leituras);
    if (!p) { avisar("alerta", "O GPS não mandou nenhuma posição nesses segundos. Vá para um lugar aberto e tente de novo."); return; }
    if (info.calibrar) { registrarCalibracao(info.calibrar, p); return; }
    if (exigirFixoRef.current && p.fonte === "receptor" && p.fix !== "rtk-fixo") { setPontoRuim(p); return; }
    if (p.precisao == null || p.precisao > opcoesRef.current.limitePrecisaoM) { setPontoRuim(p); return; }
    registrarPonto(p);
  }
  const terminarRef = useRef(terminarMarcar);
  terminarRef.current = terminarMarcar;

  // Marcar ponto aqui: conta regressiva (o fim pode mudar: "+1 min")
  const [conv, setConv] = useState<Convergencia | null>(null);
  useEffect(() => {
    if (!marcando) { setConv(null); return; }
    let n = 0;
    const tique = setInterval(() => {
      setTique((t) => t + 1);
      // a convergência a cada segundo (reconta o ponto médio: não precisa a cada 200 ms)
      if (++n % 5 === 0) setConv(convergencia(marcandoRef.current ?? []));
    }, 200);
    // parado no canto, o celular pode não mandar posição nova sozinho: pede uma por segundo
    fonte.pedirAgora?.();
    const pede = setInterval(() => fonte.pedirAgora?.(), 1000);
    const fim = setTimeout(() => terminarRef.current(), Math.max(0, marcando.fim - Date.now()));
    return () => { clearInterval(tique); clearInterval(pede); clearTimeout(fim); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marcando]);

  // ------------------------------------------------------------ calibração
  const [marcos, setMarcos] = useState<MarcoProximo[]>([]);
  const [marcoEscolhido, setMarcoEscolhido] = useState<number | null>(null);
  const [abaPrecisao, setAbaPrecisao] = useState<AbaPrecisao | null>(null);

  function registrarCalibracao(marco: { lon: number; lat: number; rotulo: string }, p: PontoCombinado) {
    const m = medicaoRef.current;
    if (!m || m.fechada) { avisar("alerta", "Abra uma medição para calibrar."); return; }
    // a média medida SEM correção (a calibração compara o GPS cru com o marco)
    const cal = novaCalibracao(marco.rotulo, marco, { lon: p.lon, lat: p.lat, precisao: p.precisao, leituras: p.usadas }, Date.now());
    const calibracoes = [...(m.calibracoes ?? []), cal];
    mudar(alterar(m, { calibracoes, vertices: aplicarCalibracoes(m.vertices, calibracoes) }));
    avisar("ok", `Calibrado em ${marco.rotulo}: o GPS estava ${textoDeslocamento({ dE: -cal.dE, dN: -cal.dN })}. Os vértices foram corrigidos.`);
    setAbaPrecisao("calibrar");
  }
  function removerCalibracao(id: string) {
    const m = medicaoRef.current;
    if (!m) return;
    const calibracoes = (m.calibracoes ?? []).filter((c) => c.id !== id);
    mudar(alterar(m, { calibracoes, vertices: aplicarCalibracoes(m.vertices, calibracoes) }));
  }
  function calibrarNoMarco(marco: { lon: number; lat: number; rotulo: string }) {
    if (!gpsLigado) setGpsLigado(true);
    garantirMedicao();
    setDesenhando(false); setCaminhando(false); setPontoRuim(null);
    setAbaPrecisao(null);
    const l = leituraRef.current;
    marcandoRef.current = l && Date.now() - l.t < 1500 ? [l] : [];
    const agora = Date.now();
    // a ocupação do marco é longa: pelo menos 60 s (ou o tempo do Marcar ponto, se for maior)
    setMarcando({ inicio: agora, fim: agora + Math.max(60, opcoesRef.current.segundosMarcar) * 1000, calibrar: marco });
  }
  function maisTempo() {
    const mc = marcandoInfoRef.current;
    if (mc) setMarcando({ ...mc, fim: mc.fim + 60_000 });
  }
  function baixarDiagnostico() {
    const lista = [...lerDiagnostico(arm), ...diagBuffer.current];
    const arq = arquivoDiagnostico(lista, typeof navigator !== "undefined" ? navigator.userAgent : "");
    const url = URL.createObjectURL(new Blob([JSON.stringify(arq)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `vertces-leituras-gps-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ------------------------------------------------------------ tela acordada (Wake Lock)
  const medindo = !!medicao && !medicao.fechada && (caminhando || !!marcando || (gps.tipo === "ok" && medicao.vertices.length > 0));
  const [acordada, setAcordada] = useState(false);
  useEffect(() => {
    type Trava = { release(): Promise<void>; addEventListener(t: string, f: () => void): void };
    const wl = (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<Trava> } }).wakeLock;
    if (!medindo || !wl) { setAcordada(false); return; }
    let trava: Trava | null = null;
    let vivo = true;
    const pedir = () => {
      if (document.visibilityState !== "visible") return;
      wl.request("screen").then((t) => {
        if (!vivo) { void t.release(); return; }
        trava = t; setAcordada(true);
        t.addEventListener("release", () => { if (vivo) setAcordada(false); });
      }).catch(() => setAcordada(false));
    };
    pedir();
    // o navegador solta a trava quando a aba some; volta a pedir ao voltar
    document.addEventListener("visibilitychange", pedir);
    return () => { vivo = false; document.removeEventListener("visibilitychange", pedir); void trava?.release().catch(() => {}); setAcordada(false); };
  }, [medindo]);

  // ------------------------------------------------------------ conta (lista + envio)
  const [conta, setConta] = useState<{ estado: "carregando" | "ok" | "erro"; itens: Medicao[]; erro?: ErroConta }>({ estado: "carregando", itens: [] });
  const carregarConta = useCallback(async () => {
    setConta((c) => ({ ...c, estado: "carregando" }));
    try {
      const antes = enviadasAgora(aparelhoRef.current);
      const itens = await repo.listar();
      // excluída na conta por outro aparelho (o computador do escritório): sai deste também,
      // senão a lista mostra "na conta" o que não existe mais e mexer nela a recriava
      const sumiram = excluidasNaConta(aparelhoRef.current, itens, antes, LIMITE_LISTA);
      if (sumiram.length) {
        let e = aparelhoRef.current;
        for (const id of sumiram) e = removerMedicao(e, id);
        persistir(e);
        if (medicaoRef.current && sumiram.includes(medicaoRef.current.id)) mostrar(null);
      }
      setConta({ estado: "ok", itens });
    } catch (e) {
      const erro = e instanceof ErroConta ? e : new ErroConta("outro", e instanceof Error ? e.message : String(e));
      setConta({ estado: "erro", itens: [], erro });
    }
  }, [repo, persistir, mostrar]);
  useEffect(() => { void carregarConta(); }, [carregarConta]);
  // o "← Voltar para <medição>" do CAR: a medição não estava no aparelho, mas está na conta
  const abriuPedida = useRef(false);
  useEffect(() => {
    if (abriuPedida.current || !props.abrirId || conta.estado !== "ok") return;
    abriuPedida.current = true;
    const m = conta.itens.find((x) => x.id === props.abrirId);
    if (m && !medicaoRef.current) abrirMedicao(m);
  }, [conta, props.abrirId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [envio, setEnvio] = useState<{ estado: EstadoEnvio; hora: string | null }>({ estado: "ocioso", hora: null });
  const travadoRef = useRef(false); // sem a 0047 no banco: não adianta tentar até recarregar

  // a fila mora em lib/campo/fila.ts (a casca também envia, sem esta tela aberta);
  // aqui ela fala com o estado da tela
  const filaRef = useRef<() => Fila>(() => ({ repo, ler: () => aparelhoRef.current, gravar: persistir }));
  filaRef.current = () => ({
    repo,
    ler: () => aparelhoRef.current,
    gravar: persistir,
    aoEnviar: (m) => setConta((c) => ({ ...c, itens: [m, ...c.itens.filter((x) => x.id !== m.id)] })),
    // a medição na tela virou a cópia: a tela passa a mostrar (e a gravar) a cópia já
    aoCopiar: (de, copia) => {
      if (medicaoRef.current?.id !== de) return;
      const nova = aparelhoRef.current.registros[copia.id]?.medicao ?? copia;
      medicaoRef.current = nova; setMedicaoEstado(nova);
    },
  });

  enviarRef.current = async () => {
    if (travadoRef.current) return;
    if (!Object.values(aparelhoRef.current.registros).some(paraEnviar)) return;
    setEnvio((e) => ({ ...e, estado: "enviando" }));
    const r = await enviarPendentes(filaRef.current());
    if (r.parou === "sem-tabela") travadoRef.current = true;
    for (const { copia: c, motivo } of r.copias) {
      avisar("alerta", motivo === "outra-conta"
        ? `Esta medição tinha ido para a conta de outra empresa. Ela foi enviada para a sua como "${c.nome}".`
        : `A conta já tinha uma versão mais nova desta medição (mexida em outro aparelho). A deste aparelho foi guardada à parte como "${c.nome}".`);
    }
    if (r.recusadas.length) {
      const um = r.recusadas.length === 1;
      avisar("erro", `A conta não deixou gravar ${um ? `"${r.recusadas[0].nome}"` : `${r.recusadas.length} medições`}. ${um ? "Continua" : "Continuam"} neste aparelho: use Baixar (KML) para não depender dele.`);
    }
    if (r.parou) { const tipo = r.parou; setEnvio((x) => ({ ...x, estado: tipo })); }
    else if (r.falhas) setEnvio((x) => ({ ...x, estado: "outro" }));
    else if (r.recusadas.length && !r.enviadas) setEnvio((x) => ({ ...x, estado: "outra-conta" }));
    else setEnvio({ estado: "enviado", hora: horaCurta() });
  };

  // ao abrir, quando a internet volta e de tempos em tempos: o que ficou no aparelho sobe
  const real = !props.repositorio; // o laboratório usa a conta de mentira: não toma a fila da casca
  useEffect(() => {
    // A casca (AppShell) pode ter começado a enviar antes de esta tela abrir (ela é
    // carregada depois): o que a casca já gravou no aparelho vem para a memória da
    // tela ANTES de a tela assumir a fila, para o próximo vértice não passar por cima.
    if (real && arm && !avisouGravacao.current) {
      const disco = lerAparelho(arm);
      if (JSON.stringify(disco) !== JSON.stringify(aparelhoRef.current)) {
        aparelhoRef.current = disco; setAparelho(disco);
        const daCasca = disco.atualId ? disco.registros[disco.atualId].medicao : null;
        const m = medicaoRef.current;
        if (m && !disco.registros[m.id]) mostrar(daCasca);
        setOferta((o) => (!o || disco.registros[o.id] ? o : daCasca && daCasca.vertices.length && !daCasca.fechada ? daCasca : null));
      }
    }
    const solta = real ? registrarTela(() => filaRef.current()) : () => {};
    agendarEnvio(600);
    const online = () => agendarEnvio(300);
    // a aba vai sumir (trocou de app, apagou a tela): tenta enviar já. Se o navegador
    // cortar a requisição, nada se perde: está no aparelho e sobe na próxima abertura.
    const vis = () => {
      if (document.visibilityState !== "hidden") { agendarEnvio(300); return; }
      if (timerEnvio.current) { clearTimeout(timerEnvio.current); timerEnvio.current = null; }
      void enviarRef.current();
    };
    addEventListener("online", online);
    document.addEventListener("visibilitychange", vis);
    const t = setInterval(() => agendarEnvio(0), 30_000);
    return () => {
      removeEventListener("online", online);
      document.removeEventListener("visibilitychange", vis);
      clearInterval(t);
      solta();
      // saiu da tela (Criar serviço de CAR, outro menu) antes do tempo: o que esperava sobe já
      if (timerEnvio.current) { clearTimeout(timerEnvio.current); timerEnvio.current = null; }
      if (!travadoRef.current && Object.values(aparelhoRef.current.registros).some(paraEnviar)) void enviarPendentes(filaRef.current());
    };
  }, [agendarEnvio, repo]); // eslint-disable-line react-hooks/exhaustive-deps

  const lista: ItemLista[] = useMemo(
    () => juntarListas(aparelho, conta.itens).filter((i) => i.medicao.vertices.length > 0),
    [aparelho, conta.itens],
  );

  // ------------------------------------------------------------ ações
  function garantirMedicao(): Medicao {
    const m = medicaoRef.current;
    if (m && !m.fechada) return m;
    const nova = novaMedicao();
    setOferta(null);
    mudar(nova);
    setEnquadrar(nova.id);
    return nova;
  }

  function caminhar() {
    if (!gpsLigado) setGpsLigado(true);
    const m = garantirMedicao();
    setDesenhando(false);
    setSeguir(true);
    setCaminhando(true);
    // a posição de agora já vira o 1º vértice (ou o próximo, se andou)
    // (parado, o celular pode estar sem mandar posição: a última de até 20 s vale, e pede uma nova)
    const l = leituraRef.current;
    if (l && Date.now() - l.t < 20_000) {
      const r = verticeAoCaminhar(m.vertices, l, opcoesRef.current);
      if (r) adicionar(r.vertice);
    }
    fonte.pedirAgora?.();
  }

  function marcarPonto() {
    if (!gpsLigado) setGpsLigado(true);
    garantirMedicao();
    setDesenhando(false);
    setPontoRuim(null);
    const l = leituraRef.current;
    marcandoRef.current = l && Date.now() - l.t < 1500 ? [l] : [];
    const agora = Date.now();
    setMarcando({ inicio: agora, fim: agora + opcoesRef.current.segundosMarcar * 1000 });
  }

  function cancelarMarcar() { marcandoRef.current = null; setMarcando(null); }

  function desenharNoMapa() {
    garantirMedicao();
    setCaminhando(false);
    setDesenhando(true);
    setSeguir(false);
  }

  function desfazer() {
    const m = medicaoRef.current;
    if (!m || m.fechada || !m.vertices.length) return;
    mudar(alterar(m, { vertices: m.vertices.slice(0, -1) }));
  }

  function fecharArea() {
    const m = medicaoRef.current;
    if (!m || m.vertices.length < 3) return;
    setCaminhando(false); setDesenhando(false); cancelarMarcar(); setPontoRuim(null);
    const f = alterar(m, { fechada: true });
    mudar(f);
    setSeguir(false);
    setEnquadrar(`${f.id}:fechada`);
    agendarEnvio(200);
  }

  function continuarMedindo() {
    const m = medicaoRef.current;
    if (!m) return;
    // reaberta, a limpeza feita deixa de valer: o Desfazer dela jogaria fora o que for editado agora
    setLimpou(null);
    mudar(alterar(m, { fechada: false }));
  }

  function novaMedicaoLimpa() {
    setCaminhando(false); setDesenhando(false); cancelarMarcar(); setPontoRuim(null);
    const m = medicaoRef.current;
    if (m && m.vertices.length) avisar("ok", `"${m.nome}" ficou em Medições salvas.`);
    if (m && !m.vertices.length) persistir(removerMedicao(aparelhoRef.current, m.id));
    else if (m && !m.fechada) persistir({ ...aparelhoRef.current, atualId: null });
    mostrar(null);
    setSeguir(true);
  }

  const [voarPara, setVoarPara] = useState<{ p: LonLat; k: number } | null>(null);
  const [gavetaLista, setGavetaLista] = useState(false);
  const [gavetaAjustes, setGavetaAjustes] = useState(false);

  function abrirMedicao(m: Medicao) {
    setCaminhando(false); setDesenhando(false); cancelarMarcar(); setPontoRuim(null);
    setOferta(null);
    setGavetaLista(false);
    const atual = medicaoRef.current;
    if (atual && !atual.vertices.length) persistir(removerMedicao(aparelhoRef.current, atual.id));
    // a aberta passa a ser a "em andamento" do aparelho só se não estiver fechada;
    // veio da conta como está: já conta como enviada (não pisca "só no aparelho" nem sobe de novo)
    const local = aparelhoRef.current.registros[m.id];
    const daConta = (!local || !pendente(local)) && conta.itens.some((x) => x.id === m.id && x.atualizadaEm === m.atualizadaEm);
    persistir(guardarMedicao(aparelhoRef.current, m, !m.fechada, daConta));
    mostrar(m);
    setSeguir(false);
  }

  async function excluir(m: Medicao) {
    const ok = await confirmar({
      titulo: `Excluir "${m.nome}"?`,
      texto: `${textoVertices(m.vertices.length)} medidos ${quando(m.criadaEm)}. Sai deste aparelho e da conta da empresa.`,
      confirmar: "Excluir", perigo: true,
    });
    if (!ok) return;
    const naConta = conta.itens.some((x) => x.id === m.id) || !!aparelhoRef.current.registros[m.id]?.enviadaVersao;
    if (naConta) {
      try { await repo.excluir(m.id); } catch (e) {
        avisar("erro", `Não deu para excluir da conta agora (${e instanceof Error ? e.message : String(e)}). Tente com internet.`);
        return;
      }
    }
    persistir(removerMedicao(aparelhoRef.current, m.id));
    setConta((c) => ({ ...c, itens: c.itens.filter((x) => x.id !== m.id) }));
    if (medicaoRef.current?.id === m.id) mostrar(null);
    setOferta((o) => (o?.id === m.id ? null : o));
    avisar("ok", `"${m.nome}" foi excluída.`);
  }

  /** Contorno cruzado (gravata): a área de Gauss sai errada. Pergunta antes de levar adiante. */
  async function levarMesmoCruzado(m: Medicao): Promise<boolean> {
    if (!contornoSeCruza(m.vertices, true)) return true;
    return confirmar({
      titulo: "O contorno se cruza",
      texto: `Com as linhas cruzadas, a área de ${textoHa(medir(m.vertices).areaM2)} pode estar errada. Para corrigir, toque em "Continuar medindo" e desfaça os vértices do cruzamento.`,
      confirmar: "Levar assim mesmo",
    });
  }
  async function criarCar(m: Medicao) {
    if (!(await levarMesmoCruzado(m))) return;
    transferirArea(areaDaMedicao(m));
    ir({ t: "novo", chave: "car" });
  }
  async function consultar(m: Medicao) {
    if (!(await levarMesmoCruzado(m))) return;
    // o mesmo canal do CAR: a Consulta lê com pegarAreaTransferida() e marca a fonte "Medição de campo"
    transferirArea(areaDaMedicao(m));
    ir({ t: "consulta" });
  }

  const nomeRef = useRef<HTMLInputElement>(null);

  // ------------------------------------------------------------ derivados
  const vertices = useMemo(() => medicao?.vertices ?? [], [medicao]);
  // na pergunta da retomada, o mapa já mostra o que ficou medido
  const verticesMapa = !medicao && oferta ? oferta.vertices : vertices;
  useEffect(() => { if (oferta && !medicao) { setSeguir(false); setEnquadrar(`${oferta.id}:oferta`); } }, [oferta, medicao]);
  const md = useMemo(() => medir(vertices), [vertices]);
  // aberta: só o caminho feito (o lado de fecho por cima do caminho dava alarme falso)
  const fechadaAgora = !!medicao?.fechada;
  const cruza = useMemo(() => vertices.length >= 4 && contornoSeCruza(vertices, fechadaAgora), [vertices, fechadaAgora]);

  // "Limpar vértices em linha reta": fechada a área andada (Caminhar), a cerca reta não precisa de um vértice a cada 5 m
  const [semLimpeza, setSemLimpeza] = useState<ReadonlySet<string>>(() => new Set());
  const [limpou, setLimpou] = useState<{ id: string; antes: VerticeCampo[]; l: OfertaCerca } | null>(null);
  // a limpeza feita só vale enquanto o contorno for exatamente o que ela deixou
  const limpezaFeita = limpou && medicao?.fechada && limpou.id === medicao.id && limpezaAindaVale(limpou.l, medicao.vertices) ? limpou.l : null;
  // a oferta: "Ajustar a cerca" (retas médias por lado, cantos no cruzamento) quando
  // ela vale; senão a limpeza simples (só tira os vértices em linha reta)
  const limpeza = useMemo((): OfertaCerca | null => {
    if (!medicao?.fechada || semLimpeza.has(medicao.id) || limpezaFeita) return null;
    if (!medicao.vertices.some((v) => v.modo === "caminhar")) return null;
    const a = ajustarCerca(medicao.vertices);
    if (valeAjustar(a)) return { ...a, tipo: "ajuste" };
    const l = limparLinhaReta(medicao.vertices);
    return valeLimpar(l) ? { ...l, tipo: "limpeza" } : null;
  }, [medicao, semLimpeza, limpezaFeita]);
  function aplicarLimpeza() {
    const m = medicaoRef.current;
    if (!m || !limpeza) return;
    setLimpou({ id: m.id, antes: m.vertices, l: limpeza });
    mudar(alterar(m, { vertices: limpeza.vertices }));
    agendarEnvio(400);
  }
  function desfazerLimpeza() {
    const m = medicaoRef.current;
    if (!m || !limpou || limpou.id !== m.id || !limpezaAindaVale(limpou.l, m.vertices)) { setLimpou(null); return; }
    mudar(alterar(m, { vertices: limpou.antes }));
    setLimpou(null);
    // a oferta volta: quem desfez para comparar pode limpar de novo (ou "Deixar como está")
    agendarEnvio(400);
  }
  const registroAtual = medicao ? aparelho.registros[medicao.id] : undefined;
  const sinalFraco = !!leitura && !leituraUtil(leitura, opcoes.limitePrecisaoM);
  const estreita = useEstreita();
  const statusEnvio = textoEnvio(medicao, registroAtual ? pendente(registroAtual) : true, envio, conta.estado === "erro" ? conta.erro?.tipo ?? null : null);
  // no celular, medindo (ou para começar): a barra de três botões com o do meio saltado
  const comDoca = estreita && !(oferta && !medicao);

  // o painel do receptor RTK (Bluetooth + correção NTRIP) entra na aba Receptor
  const painelReceptor: ReactNode = (
    <PainelReceptor receptor={receptor} arm={arm} leitura={leitura} exigirFixo={exigirFixo} onExigirFixo={setExigirFixo} />
  );

  const painel = (
    <PainelControle
      doca={comDoca}
      medicao={medicao} oferta={oferta} md={md} cruza={cruza}
      limpeza={limpeza} limpezaFeita={limpezaFeita} onLimpar={aplicarLimpeza} onDesfazerLimpeza={desfazerLimpeza}
      onDispensarLimpeza={() => { const id = medicaoRef.current?.id; if (id) setSemLimpeza((s) => new Set(s).add(id)); }}
      gps={gps} gpsLigado={gpsLigado} leitura={leitura} sinalFraco={sinalFraco}
      caminhando={caminhando} desenhando={desenhando} marcando={marcando} pontoRuim={pontoRuim}
      opcoes={opcoes} acordada={acordada} nomeRef={nomeRef}
      aquecimento={aquecimento} conv={conv} exigirFixo={exigirFixo}
      onPronto={() => terminarRef.current()} onMaisTempo={maisTempo}
      onLigarGps={() => setGpsLigado(true)}
      onContinuarOferta={() => { if (oferta) { persistir(guardarMedicao(aparelhoRef.current, oferta, true)); mostrar(oferta); setOferta(null); setSeguir(true); } }}
      onOutraOferta={() => { persistir({ ...aparelhoRef.current, atualId: null }); setOferta(null); setSeguir(true); }}
      onDescartarOferta={() => { if (oferta) void excluir(oferta); }}
      onCaminhar={caminhar} onPausar={() => setCaminhando(false)} onMarcar={marcarPonto} onCancelarMarcar={cancelarMarcar}
      onPontoAssimMesmo={() => { if (pontoRuim) registrarPonto(pontoRuim); setPontoRuim(null); }}
      onPontoDeNovo={() => { setPontoRuim(null); marcarPonto(); }}
      onPontoCancelar={() => setPontoRuim(null)}
      onDesenhar={desenharNoMapa} onPararDesenho={() => setDesenhando(false)}
      onIrPara={(p) => { setSeguir(false); setVoarPara({ p, k: Date.now() }); }}
      onDesfazer={desfazer} onFechar={fecharArea}
      onRenomear={(nome) => { const m = medicaoRef.current; if (m) mudar(alterar(m, { nome })); }}
      onCriarCar={() => { if (medicao) void criarCar(medicao); }}
      onConsultar={() => { if (medicao) void consultar(medicao); }}
      onContinuarMedindo={continuarMedindo}
      onNova={novaMedicaoLimpa}
    />
  );

  const listaEl = (
    <ListaMedicoes itens={lista} carregando={conta.estado === "carregando" && !lista.length} erroConta={conta.estado === "erro" ? conta.erro ?? null : null}
      atualId={medicao?.id ?? null} onAbrir={abrirMedicao} onExcluir={excluir} onTentar={() => void carregarConta()} />
  );

  return (
    <div className="campo tela-cheia" data-tela-cheia data-sem-toque>
      <div className="campo-palco">
        <MapaCampo
          vertices={verticesMapa} fechada={!!medicao?.fechada} posicao={leitura}
          seguir={seguir} onParouDeSeguir={() => setSeguir(false)} onSeguir={() => setSeguir(true)}
          desenhando={desenhando}
          onToque={(p: LonLat) => adicionar({ lon: p[0], lat: p[1], precisao: null, t: Date.now(), modo: "mao" })}
          onMoverVertice={(i, p) => {
            const m = medicaoRef.current;
            if (!m) return;
            mudar(alterar(m, { vertices: m.vertices.map((v, k) => (k === i ? { ...v, lon: p[0], lat: p[1], modo: "mao" as const, precisao: null } : v)) }));
          }}
          marcos={abaPrecisao === "calibrar" || marcando?.calibrar ? marcos.slice(0, 8).map((m, i) => ({ ...m, escolhido: i === marcoEscolhido })) : undefined}
          onEscolherMarco={(i) => { setMarcoEscolhido(i); if (!abaPrecisao) setAbaPrecisao("calibrar"); }}
          enquadrar={enquadrar} voarPara={voarPara} controleImagem={props.controleImagem === undefined ? controleImagemPadrao : props.controleImagem ?? undefined}>
          <div className="campo-topo-linha">
            <SeloGps gps={gps} leitura={leitura} descansa={gpsDescansa && gpsLigado} aquecendo={!aquecimento.pronto && gps.tipo === "ok"} />
            <span className={`campo-salvo ${statusEnvio.tom}`} title={statusEnvio.dica}>
              <i aria-hidden="true" />{statusEnvio.texto}
            </span>
            <span className="campo-topo-acoes">
              {estreita && (
                <button type="button" className="campo-btn-mapa campo-btn-salvas" onClick={() => setGavetaLista(true)} aria-label="Medições salvas">
                  Salvas{lista.length ? <b>{lista.length}</b> : null}
                </button>
              )}
              <button type="button" className={`campo-btn-mapa campo-btn-precisao${medicao?.calibracoes?.length ? " calibrado" : ""}`} onClick={() => setAbaPrecisao("calibrar")}
                aria-label="Precisão do GPS: calibrar, receptor RTK, dicas" title="Precisão do GPS: calibrar num marco, receptor RTK, dicas">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="2" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
                <span className="campo-so-largo">Precisão</span>
              </button>
              <button type="button" className="campo-btn-mapa" onClick={() => setGavetaAjustes(true)} aria-label="Ajustes do medidor" title="Ajustes do medidor">
                <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
              </button>
            </span>
          </div>
          {estreita && <p className="campo-aviso">{AVISO_GPS}</p>}
        </MapaCampo>
        {estreita && (
          <div className={`campo-folha${comDoca ? " com-doca" : ""}`}>
            {/* o fundo branco com o recorte do botão do meio (máscara) e a sombra que segue o recorte */}
            {comDoca && <div className="campo-folha-fundo" aria-hidden="true"><i /></div>}
            {painel}
          </div>
        )}
      </div>

      {!estreita && (
        <aside className="campo-lado" aria-label="Medição">
          <header className="campo-lado-cabeca">
            <h1 className="sr-only">Medir no campo</h1>
            <p className="campo-aviso">{AVISO_GPS}</p>
          </header>
          <div className="campo-lado-painel">{painel}</div>
          <section className="campo-lado-lista">
            <h2>Medições salvas{lista.length ? <span className="campo-conta">{lista.length}</span> : null}
              <Dica>As medições feitas no celular aparecem aqui e no computador do escritório. Sem internet, ficam no aparelho e sobem sozinhas quando a rede voltar.</Dica>
            </h2>
            {listaEl}
          </section>
        </aside>
      )}

      {gavetaLista && estreita && <Gaveta olho="Medir no campo" titulo="Medições salvas" onFechar={() => setGavetaLista(false)}>{listaEl}</Gaveta>}
      {gavetaAjustes && <Ajustes opcoes={opcoes} onMudar={setOpcoes} onFechar={() => setGavetaAjustes(false)} />}
      {abaPrecisao && (
        <PainelPrecisao aba={abaPrecisao} onAba={setAbaPrecisao} onFechar={() => setAbaPrecisao(null)}
          leitura={leitura} temMedicao={!medicao?.fechada}
          calibracoes={medicao?.calibracoes ?? []}
          marcos={marcos} onMarcos={setMarcos} escolhido={marcoEscolhido} onEscolher={setMarcoEscolhido}
          onCalibrar={calibrarNoMarco} onRemoverCalibracao={removerCalibracao}
          segundosCalibrar={Math.max(60, opcoes.segundosMarcar)}
          diagnostico={{ ligado: diagLigado, leituras: diagQtd }} onDiagnostico={setDiagLigado}
          onBaixarDiagnostico={baixarDiagnostico} onApagarDiagnostico={() => { apagarDiagnostico(arm); diagBuffer.current = []; setDiagQtd(0); }}
          receptor={painelReceptor} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function textoEnvio(m: Medicao | null, pend: boolean, envio: { estado: EstadoEnvio; hora: string | null }, erroLista: TipoErroConta | null): { texto: string; tom: string; dica: string } {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  if (!m || !m.vertices.length) {
    if (erroLista === "sem-tabela") return { texto: "Grava no aparelho", tom: "aparelho", dica: "O sistema ainda não foi atualizado para guardar medições na conta: elas ficam neste aparelho." };
    return { texto: "Grava sozinho", tom: "ocioso", dica: "Cada vértice é gravado na hora no aparelho e sobe para a conta quando há internet." };
  }
  if (!pend) return { texto: `Na conta${envio.hora ? ` ${envio.hora}` : ""}`, tom: "conta", dica: "Salva na conta da empresa: aparece no computador do escritório." };
  if (envio.estado === "enviando") return { texto: "Enviando…", tom: "enviando", dica: "Salvo no aparelho; subindo para a conta." };
  if (envio.estado === "sem-tabela") return { texto: "No aparelho", tom: "aparelho", dica: "Salvo no aparelho. O sistema ainda não foi atualizado para guardar medições na conta." };
  if (envio.estado === "outra-conta") return { texto: "No aparelho", tom: "alerta", dica: "Uma medição deste aparelho é de outra conta e não sobe para a sua." };
  if (envio.estado === "sem-login") return { texto: "No aparelho · entre de novo", tom: "alerta", dica: "Salvo no aparelho. A sessão expirou: entre de novo para enviar para a conta." };
  if (offline || envio.estado === "sem-rede") return { texto: "No aparelho · sem internet", tom: "aparelho", dica: "Salvo no aparelho. Sobe sozinho para a conta quando a internet voltar." };
  if (envio.estado === "outro") return { texto: "No aparelho · tentando enviar", tom: "alerta", dica: "Salvo no aparelho. A conta não respondeu; o sistema tenta de novo sozinho." };
  return { texto: "Salvo no aparelho", tom: "aparelho", dica: "Salvo no aparelho; sobe para a conta em instantes." };
}

function SeloGps({ gps, leitura, descansa, aquecendo }: { gps: EstadoGps; leitura: Leitura | null; descansa: boolean; aquecendo?: boolean }) {
  if (descansa) return <span className="campo-gps-selo desligado" title="Área fechada: o GPS descansa para poupar a bateria. Volta em Continuar medindo ou Nova medição.">GPS em pausa</span>;
  if (gps.tipo === "desligado") return <span className="campo-gps-selo desligado">GPS desligado</span>;
  if (gps.tipo === "procurando") return <span className="campo-gps-selo procurando"><i aria-hidden="true" />Procurando o GPS…</span>;
  if (gps.tipo === "erro" && (gps.erro.tipo !== "sem-sinal" || !leitura)) {
    // computador sem GPS é o normal (desenho à mão), não erro: selo neutro
    if (gps.erro.tipo === "indisponivel") return <span className="campo-gps-selo desligado" title={gps.erro.mensagem}>Sem GPS<span className="campo-so-largo"> · desenho à mão</span></span>;
    const t = gps.erro.tipo === "sem-permissao" ? "GPS bloqueado" : "Sem sinal do GPS";
    return <span className={`campo-gps-selo ${gps.erro.tipo === "sem-permissao" ? "media" : "ruim"}`} title={gps.erro.mensagem}>{t}</span>;
  }
  const p = leitura?.precisao ?? null;
  if (leitura?.fonte === "receptor") {
    const fix = leitura.fix ?? "sem-fix";
    const classe = fix === "rtk-fixo" ? "boa rtk" : fix === "rtk-flutuante" || fix === "dgps" ? "media" : "ruim";
    return (
      <span className={`campo-gps-selo ${classe}`} title={`Receptor externo · ${NOME_FIX[fix]}${leitura.sats != null ? ` · ${leitura.sats} satélites` : ""}${leitura.idadeCorrecaoS != null ? ` · correção de ${leitura.idadeCorrecaoS.toFixed(0)} s` : ""}. Até ${textoPrecisao(p == null ? null : p * 1.62)} em 95% das leituras.`}>
        <i aria-hidden="true" />{NOME_FIX[fix]} {textoPrecisao(p)}{gps.tipo === "erro" ? " · sinal perdido" : ""}
      </span>
    );
  }
  return (
    <span className={`campo-gps-selo ${p == null ? "ruim" : classePrecisao(p)}${aquecendo ? " procurando" : ""}`}
      title={`Precisão informada pelo GPS do aparelho agora: 2 de cada 3 leituras ficam dentro de ${textoPrecisao(p)}; 95% até ${textoPrecisao(p == null ? null : p * 1.62)}.${aquecendo ? " O GPS acabou de ligar e ainda está assentando." : ""}`}>
      <i aria-hidden="true" />{aquecendo ? "Aquecendo · " : "GPS "}{textoPrecisao(p)}{gps.tipo === "erro" ? " · sinal perdido" : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// O painel de controle (folha de baixo no celular, coluna no computador)
// ---------------------------------------------------------------------------

interface PropsPainel {
  /** celular: a barra Marcar · Desenhar · Caminhar (PainelDoca) no lugar dos botões grandes */
  doca?: boolean;
  medicao: Medicao | null;
  oferta: Medicao | null;
  md: ReturnType<typeof medir>;
  cruza: boolean;
  /** oferta de "Ajustar a cerca" / "Limpar vértices em linha reta" (área fechada andando) */
  limpeza: OfertaCerca | null;
  /** o ajuste/limpeza aplicado agora (com o Desfazer) */
  limpezaFeita: OfertaCerca | null;
  onLimpar: () => void;
  onDesfazerLimpeza: () => void;
  onDispensarLimpeza: () => void;
  gps: EstadoGps;
  gpsLigado: boolean;
  leitura: Leitura | null;
  sinalFraco: boolean;
  caminhando: boolean;
  desenhando: boolean;
  marcando: Marcando | null;
  pontoRuim: PontoCombinado | null;
  opcoes: OpcoesCampo;
  acordada: boolean;
  nomeRef: React.RefObject<HTMLInputElement>;
  aquecimento: EstadoAquecimento;
  /** como o ponto do Marcar ponto está assentando */
  conv: Convergencia | null;
  exigirFixo: boolean;
  onPronto: () => void;
  onMaisTempo: () => void;
  onLigarGps: () => void;
  onContinuarOferta: () => void;
  onOutraOferta: () => void;
  onDescartarOferta: () => void;
  onCaminhar: () => void;
  onPausar: () => void;
  onMarcar: () => void;
  onCancelarMarcar: () => void;
  onPontoAssimMesmo: () => void;
  onPontoDeNovo: () => void;
  onPontoCancelar: () => void;
  onDesenhar: () => void;
  onPararDesenho: () => void;
  onIrPara: (p: LonLat) => void;
  onDesfazer: () => void;
  onFechar: () => void;
  onRenomear: (nome: string) => void;
  onCriarCar: () => void;
  onConsultar: () => void;
  onContinuarMedindo: () => void;
  onNova: () => void;
}

const Ic = ({ d, tam = 20 }: { d: string; tam?: number }) => (
  <svg viewBox="0 0 24 24" width={tam} height={tam} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const ICO = {
  andar: "M13 4a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM9 21l2-6 2.5 2.5V22M7 12l2.5-4 3.5 1 2.5 3.5M9.5 8 8 14",
  pausar: "M8 5v14M16 5v14",
  ponto: "M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  desfazer: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  fechar: "M5 5h14v14H5zM5 5l3 3M19 5l-3 3M5 19l3-3M19 19l-3-3",
  mao: "M3 17l6-12 4 8 3-4 5 8M3 21h18",
  car: "M12 3l8 4v6c0 4.5-3.4 7.4-8 8-4.6-.6-8-3.5-8-8V7l8-4z",
  lupa: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  lapis: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z",
  baixar: "M12 4v11M7 10l5 5 5-5M5 20h14",
};

/** "Ir para": sem GPS, o mapa chega ao imóvel por coordenada ou link do Google Maps. */
function IrPara({ onIr, principal = false, focar = false }: { onIr: (p: LonLat) => void; principal?: boolean; focar?: boolean }) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState(false);
  const ir = () => {
    const p = lerLugar(texto);
    setErro(!p);
    if (p) onIr(p);
  };
  return (
    <form className="campo-ir" onSubmit={(e) => { e.preventDefault(); ir(); }}>
      <label className="campo-ir-campo">
        <Rotulo dica={`Decimal (-12,6915, -39,1262), GMS (12°41'29"S 39°07'34"W), UTM com o fuso (24L 500000 8600000) ou o link do Google Maps do imóvel.`}>{principal ? "Coordenada ou link do imóvel" : "Ir para o imóvel"}</Rotulo>
        <span className="campo-ir-linha">
          <input value={texto} onChange={(e) => { setTexto(e.target.value); setErro(false); }} placeholder="Coordenada ou link do Google Maps"
            aria-invalid={erro || undefined} inputMode="text" autoComplete="off" autoFocus={focar} />
          <button type="submit" className={principal ? "principal" : undefined} disabled={!texto.trim()}>Ir</button>
        </span>
      </label>
      {erro && <span className="campo-ir-erro" role="alert">Não entendi esse lugar. Cole a coordenada (lat, lon), a UTM com o fuso ou o link do Google Maps.</span>}
    </form>
  );
}

function Numeros({ md, aberta }: { md: ReturnType<typeof medir>; aberta: boolean }) {
  // andando, a área só aparece quando já é uma área (em linha reta é uma lasca sem sentido)
  const temArea = aberta ? areaSignificativa(md) : md.n >= 3;
  return (
    <dl className="campo-numeros">
      <div className="campo-num-area">
        <dt>Área{aberta && temArea ? <small> · fechando agora</small> : null}</dt>
        <dd>{temArea ? textoHa(md.areaM2) : "—"}{temArea ? <small>{textoM2(md.areaM2)}</small> : aberta && md.n >= 2 ? <small>aparece ao virar a cerca</small> : null}</dd>
      </div>
      <div><dt>Perímetro</dt><dd>{md.n >= 2 ? textoDistancia(md.perimetroM) : "—"}</dd></div>
      <div><dt>Vértices</dt><dd>{md.n}</dd></div>
    </dl>
  );
}

/**
 * "121 → 4 vértices · 2,7511 → 2,7546 ha": a cerca reta com um vértice só em
 * cada canto. O ajuste também recoloca os cantos no cruzamento das retas médias.
 */
function OfertaLimpeza({ l, onLimpar, onDispensar }: { l: OfertaCerca; onLimpar: () => void; onDispensar: () => void }) {
  const dif = l.areaDepoisM2 - l.areaAntesM2;
  const pct = l.areaAntesM2 > 0 ? (Math.abs(dif) / l.areaAntesM2) * 100 : 0;
  const ajuste = l.tipo === "ajuste";
  return (
    <div className="campo-limpar" role="region" aria-label={ajuste ? "Ajustar a cerca" : "Limpar vértices em linha reta"}>
      <div className="campo-limpar-texto">
        <b>{ajuste ? "Ajustar a cerca" : "Limpar vértices em linha reta"}
          <Dica>
            {l.tipo === "ajuste" ? (
              <>
                Andando, o celular pôs um vértice a cada poucos metros, cada um com o erro de uma leitura, e o canto de verdade ficou
                cortado (o vértice nasce depois da esquina). O ajuste traça uma reta média por lado, com todos os vértices dele,
                e põe cada canto no cruzamento das retas{l.cantosAjustados ? ` (${l.cantosAjustados} canto${l.cantosAjustados > 1 ? "s" : ""}; o que mais andou: ${textoDistancia(l.deslocMaxM)})` : ""}.
                Os pontos que você marcou parado ou tocou no mapa não saem do lugar. A área muda {textoM2(Math.abs(dif))} ({pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%).
              </>
            ) : (
              <>
                Andando, o celular pôs um vértice a cada poucos metros. Na cerca reta, os do meio sobram: saem os que ficam a menos de{" "}
                {textoDistancia(l.toleranciaM)} da linha entre os vizinhos (Douglas–Peucker em UTM, da ordem da precisão do GPS). Os pontos que você marcou
                parado ou tocou no mapa ficam sempre. A área muda {textoM2(Math.abs(dif))} ({pct.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%)
                {l.incertezaM2 != null ? `, bem menos que a incerteza do próprio GPS (±${textoM2(l.incertezaM2)})` : ""}.
              </>
            )}
          </Dica>
        </b>
        <span className="campo-limpar-num">
          <span><s>{l.antes}</s> → <b>{l.depois}</b> vértices</span>
          <span>{textoHa(l.areaAntesM2)} → <b>{textoHa(l.areaDepoisM2)}</b></span>
        </span>
      </div>
      <div className="campo-acoes-linha">
        <button type="button" className="campo-btn-medio campo-limpar-sim" onClick={onLimpar}>{ajuste ? "Ajustar" : "Limpar"}</button>
        <button type="button" className="campo-btn-medio" onClick={onDispensar}>Deixar como está</button>
      </div>
    </div>
  );
}

/** Marcar ponto em andamento: o tempo, a precisão de agora, o ponto assentando e o "Pronto". */
function TextoMarcando({ p, segundos }: { p: PropsPainel; segundos: number }) {
  const c = p.conv;
  const mc = p.marcando;
  const passou = mc ? (Date.now() - mc.inicio) / 1000 : 0;
  const assentou = !!c && c.n >= 5 && passou >= 10 && c.estavelHaS >= 8;
  return (
    <>
      <span>
        <b>{mc?.calibrar ? "Calibrando no marco" : "Fique parado"}</b> · {segundos} s
        {c ? <> · {c.n} leituras · ponto {textoPrecisao(c.precisao)}{assentou ? " · assentou" : ""}</> : <> · agora {textoPrecisao(p.leitura?.precisao ?? null)}</>}
      </span>
      <span className="campo-marcando-acoes">
        <button type="button" className="campo-btn-mini" onClick={p.onMaisTempo} title="Juntar leituras por mais 1 minuto">+1 min</button>
        {assentou && <button type="button" className="campo-btn-mini principal" onClick={p.onPronto} title="O ponto parou de andar: terminar agora">Pronto</button>}
      </span>
    </>
  );
}

function PainelControle(p: PropsPainel) {
  const m = p.medicao;

  // 1) a retomada: uma pergunta por vez
  if (p.oferta && !m) {
    return (
      <div className="campo-painel campo-retomar" role="region" aria-label="Retomar a medição">
        <b className="campo-pergunta">{textoRetomada(p.oferta)}</b>
        <span className="campo-sub">"{p.oferta.nome}" ficou gravada neste aparelho · {textoUltimoVertice(p.oferta)}.</span>
        <div className="campo-acoes-linha">
          <button type="button" className="principal campo-btn-grande" onClick={p.onContinuarOferta}>Continuar</button>
          <button type="button" className="campo-btn-grande" onClick={p.onOutraOferta}>Começar outra</button>
        </div>
        <div className="campo-acoes-rodape">
          <button type="button" className="fantasma campo-link-perigo" onClick={p.onDescartarOferta}>Descartar esta medição</button>
        </div>
      </div>
    );
  }

  // 2) fechada: o resultado e a próxima ação
  if (m && m.fechada && p.doca) {
    // celular: a mesma barra, agora Consultar · Criar CAR (o botão verde) · Baixar
    return (
      <div className="campo-painel campo-painel-doca campo-resultado" role="region" aria-label="Área medida">
        <div className="campo-doca" role="toolbar" aria-label="O que fazer com a área">
          <button type="button" className="campo-doca-lado" onClick={p.onConsultar}><Ic d={ICO.lupa} tam={22} /><span>Consultar</span></button>
          <span className="campo-doca-meio com-rotulo">
            <button type="button" className="campo-doca-fab" onClick={p.onCriarCar} aria-label="Criar serviço de CAR com esta área" title="Criar serviço de CAR com esta área">
              <Ic d={ICO.car} tam={26} />
            </button>
            <span className="campo-doca-rotulo" aria-hidden="true">Criar CAR</span>
          </span>
          <MenuBaixar medicao={m} className="campo-doca-lado"><Ic d={ICO.baixar} tam={22} /><span>Baixar</span></MenuBaixar>
        </div>
        <label className="campo-nome campo-nome-doca">
          <span className="sr-only">Nome</span>
          <Ic d={ICO.lapis} tam={16} />
          <input ref={p.nomeRef} value={m.nome} maxLength={200} onChange={(e) => p.onRenomear(e.target.value)}
            onBlur={(e) => { if (!e.target.value.trim()) p.onRenomear("Medição"); }} aria-label="Nome da medição" />
        </label>
        <Numeros md={p.md} aberta={false} />
        <p className="campo-detalhe">
          {p.md.precisaoMediaM == null ? "Desenhada à mão" : `Precisão ${textoPrecisao95(p.md.precisaoMediaM)}`}{textoCalibrada(m)}{textoFixos(m)} · {quando(m.criadaEm)} · fuso {p.md.fuso}
        </p>
        {p.cruza && <p className="campo-alerta" role="alert">O contorno se cruza: a área pode estar errada. Use "Continuar medindo" e desfaça os vértices do cruzamento.</p>}
        {p.limpeza && <OfertaLimpeza l={p.limpeza} onLimpar={p.onLimpar} onDispensar={p.onDispensarLimpeza} />}
        {p.limpezaFeita && (
          <p className="campo-limpo" role="status">
            <span><b>{p.limpezaFeita.tipo === "ajuste" ? "Cerca ajustada:" : "Cerca limpa:"}</b> {p.limpezaFeita.antes} → {p.limpezaFeita.depois} vértices · {textoHa(p.limpezaFeita.areaDepoisM2)}</span>
            <button type="button" className="link" onClick={p.onDesfazerLimpeza}>Desfazer</button>
          </p>
        )}
        <div className="campo-acoes-rodape">
          <button type="button" className="fantasma" onClick={p.onContinuarMedindo}>Continuar medindo</button>
          <button type="button" className="fantasma" onClick={p.onNova}>Nova medição</button>
        </div>
      </div>
    );
  }
  if (m && m.fechada) {
    return (
      <div className="campo-painel campo-resultado" role="region" aria-label="Área medida">
        <label className="campo-nome">
          <Rotulo>Nome</Rotulo>
          <input ref={p.nomeRef} value={m.nome} maxLength={200} onChange={(e) => p.onRenomear(e.target.value)}
            onBlur={(e) => { if (!e.target.value.trim()) p.onRenomear("Medição"); }} aria-label="Nome da medição" />
        </label>
        <Numeros md={p.md} aberta={false} />
        <p className="campo-detalhe">
          {p.md.precisaoMediaM == null ? "Desenhada à mão" : `Precisão média ${textoPrecisao95(p.md.precisaoMediaM)}`}{textoCalibrada(m)}{textoFixos(m)} · medida {quando(m.criadaEm)} · fuso {p.md.fuso}
        </p>
        {p.cruza && <p className="campo-alerta" role="alert">O contorno se cruza: a área pode estar errada. Use "Continuar medindo" e desfaça os vértices do cruzamento.</p>}
        {p.limpeza && <OfertaLimpeza l={p.limpeza} onLimpar={p.onLimpar} onDispensar={p.onDispensarLimpeza} />}
        {p.limpezaFeita && (
          <p className="campo-limpo" role="status">
            <span><b>{p.limpezaFeita.tipo === "ajuste" ? "Cerca ajustada:" : "Cerca limpa:"}</b> {p.limpezaFeita.antes} → {p.limpezaFeita.depois} vértices · {textoHa(p.limpezaFeita.areaDepoisM2)}</span>
            <button type="button" className="link" onClick={p.onDesfazerLimpeza}>Desfazer</button>
          </p>
        )}
        <button type="button" className="principal campo-btn-grande campo-largo" onClick={p.onCriarCar}>
          <Ic d={ICO.car} />Criar serviço de CAR com esta área
        </button>
        <div className="campo-acoes-linha tres">
          <button type="button" className="campo-btn-medio" onClick={p.onConsultar}><Ic d={ICO.lupa} tam={17} />Consultar</button>
          <MenuBaixar medicao={m} className="campo-btn-medio" />
          {/* o campo Nome acima já renomeia: aqui, a ação que faltava à mão */}
          <button type="button" className="campo-btn-medio campo-btn-quebra" onClick={p.onContinuarMedindo}><Ic d={ICO.andar} tam={16} />Continuar medindo</button>
        </div>
        <div className="campo-acoes-rodape">
          <button type="button" className="fantasma" onClick={p.onNova}>Nova medição</button>
        </div>
      </div>
    );
  }

  // celular: a barra de três botões
  if (p.doca) return <PainelDoca {...p} />;

  const semGps = p.gps.tipo === "erro" && p.gps.erro.tipo !== "sem-sinal";
  const n = m?.vertices.length ?? 0;

  // Marcar ponto: juntando leituras
  const marcandoEl = p.marcando && (() => {
    const total = p.marcando.fim - p.marcando.inicio;
    const falta = Math.max(0, p.marcando.fim - Date.now());
    return (
      <div className="campo-marcando" role="status" aria-live="polite">
        <div className="campo-marcando-texto">
          <TextoMarcando p={p} segundos={Math.ceil(falta / 1000)} />
        </div>
        <div className="campo-barra" aria-hidden="true"><i style={{ width: `${100 - (falta / total) * 100}%` }} /></div>
        <button type="button" onClick={p.onCancelarMarcar}>Cancelar</button>
      </div>
    );
  })();

  const pontoRuimEl = p.pontoRuim && (
    <div className="campo-ponto-ruim" role="alertdialog" aria-label="Precisão pior que o limite">
      <b>{p.exigirFixo && p.pontoRuim.fonte === "receptor" && p.pontoRuim.fix !== "rtk-fixo" ? `O receptor não estava em RTK fixo (${NOME_FIX[p.pontoRuim.fix ?? "sem-fix"]})` : `A precisão ficou em ${textoPrecisao(p.pontoRuim.precisao)}`}</b>
      <span>O limite é ±{p.opcoes.limitePrecisaoM} m. Debaixo de árvore ou perto de parede o GPS piora: dois passos para o aberto costumam resolver.</span>
      <div className="campo-acoes-linha tres">
        <button type="button" className="principal" onClick={p.onPontoDeNovo}>Tentar de novo</button>
        <button type="button" onClick={p.onPontoAssimMesmo}>Marcar assim</button>
        <button type="button" className="fantasma" onClick={p.onPontoCancelar}>Cancelar</button>
      </div>
    </div>
  );

  // 3) começo: nada medido ainda
  if (!m || n === 0) {
    // No computador do escritório (sem toque) o GPS fica desligado: lá o normal é
    // chegar ao imóvel pela coordenada e desenhar. Se ligou e o navegador não deu a
    // posição (POSITION_UNAVAILABLE), é o computador sem GPS, não "falta céu aberto".
    const computadorSemPosicao = !ehCelular() && p.gps.tipo === "erro" && p.gps.erro.tipo === "sem-sinal" && !p.leitura;
    const escritorio = !ehCelular() && !semGps && (!p.gpsLigado || computadorSemPosicao);
    const ondeFica = semGps || escritorio;
    const textoOnde = semGps && p.gps.tipo === "erro"
      ? p.gps.erro.tipo === "sem-permissao"
        ? "A localização está bloqueada neste navegador. Cole a coordenada e desenhe o contorno tocando no mapa."
        : "Este aparelho não tem GPS. Cole a coordenada ou o link do Google Maps: o mapa vai até lá e você desenha o contorno tocando nos cantos."
      : computadorSemPosicao
        ? "Este computador não informou a posição (computador não tem GPS). Cole a coordenada ou o link do Google Maps: o mapa vai até lá e você desenha o contorno clicando nos cantos."
        : "No computador, comece pelo lugar: cole a coordenada (decimal, GMS ou UTM) ou o link do Google Maps. O mapa vai até lá e você desenha o contorno clicando nos cantos.";
    return (
      <div className="campo-painel campo-comeco" role="region" aria-label="Começar a medir">
        {p.gps.tipo === "erro" && !semGps && !escritorio && <p className="campo-alerta" role="alert">{p.gps.erro.mensagem}</p>}
        {marcandoEl || pontoRuimEl || (
          <>
            {!ondeFica && !p.desenhando && (
              <div className="campo-acoes-linha">
                <button type="button" className="principal campo-btn-grande" onClick={p.onCaminhar}><Ic d={ICO.andar} />Caminhar</button>
                <button type="button" className="campo-btn-grande" onClick={p.onMarcar}><Ic d={ICO.ponto} />Marcar ponto aqui</button>
              </div>
            )}
            {p.desenhando
              ? (
                <>
                  <div className="campo-acoes-linha campo-linha-estado">
                    <p className="campo-estado mao" role="status"><i aria-hidden="true" />Toque no mapa para pôr o 1º vértice</p>
                    {!semGps && <button type="button" onClick={p.onPararDesenho}>Usar o GPS</button>}
                  </div>
                  {!p.leitura && <IrPara onIr={p.onIrPara} />}
                </>
              )
              : ondeFica
                ? (
                  // sem GPS (o computador do escritório): primeiro chegar ao imóvel, depois desenhar
                  <div className="campo-onde">
                    <b className="campo-pergunta">Onde fica o imóvel?</b>
                    <span className="campo-sub">{textoOnde}</span>
                    <IrPara onIr={(lugar) => { p.onIrPara(lugar); p.onDesenhar(); }} principal focar={!ehCelular()} />
                    <div className="campo-acoes-rodape">
                      <button type="button" className="fantasma" onClick={p.onDesenhar}><Ic d={ICO.mao} tam={16} />Desenhar onde o mapa estiver</button>
                      {escritorio && !p.gpsLigado && <button type="button" className="fantasma" onClick={p.onLigarGps}>Usar a localização deste computador</button>}
                    </div>
                    {p.gps.tipo === "erro" && p.gps.erro.tipo === "sem-permissao" && (
                      <details className="campo-como">
                        <summary>Como liberar a localização</summary>
                        <p>{p.gps.erro.mensagem}</p>
                      </details>
                    )}
                  </div>
                )
                : (
                  <div className="campo-acoes-rodape">
                    <button type="button" className="fantasma" onClick={p.onDesenhar}>Sem GPS? Desenhar no mapa</button>
                    {!p.gpsLigado && <button type="button" className="fantasma" onClick={p.onLigarGps}>Usar o GPS deste aparelho</button>}
                  </div>
                )}
            {!p.desenhando && !ondeFica && (
              <p className="campo-sub campo-explica">
                <b>Caminhar</b> põe um vértice sozinho a cada {p.opcoes.passoM} m ou a cada curva. <b>Marcar ponto</b>: pare no canto e espere {p.opcoes.segundosMarcar} s.
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  // 4) medindo
  return (
    <div className="campo-painel campo-medindo" role="region" aria-label="Medindo">
      <Numeros md={p.md} aberta />
      {p.caminhando && (
        <p className={`campo-estado${p.sinalFraco || !p.leitura ? " fraco" : ""}`} role="status" aria-live="polite">
          <i aria-hidden="true" />
          {!p.leitura ? "Esperando o sinal do GPS…"
            : !p.aquecimento.pronto && !n ? `Aquecendo o GPS (${p.aquecimento.motivo ?? "assentando"}): o 1º vértice sai quando a precisão parar de melhorar`
            : p.sinalFraco ? `Sinal fraco (${textoPrecisao(p.leitura.precisao)}): esperando melhorar para pôr vértice`
              : `Caminhando · vértice a cada ${p.opcoes.passoM} m ou curva de ${p.opcoes.anguloGraus}°`}
          {p.acordada && <span className="campo-acordada" title="A tela não apaga enquanto mede">tela acordada</span>}
        </p>
      )}
      {p.desenhando && <p className="campo-estado mao" role="status"><i aria-hidden="true" />Desenhando: toque no mapa para cada vértice</p>}
      {p.cruza && <p className="campo-alerta" role="alert">O contorno está se cruzando. Desfaça os últimos vértices se não for isso.</p>}
      {marcandoEl || pontoRuimEl || (
        <div className="campo-grade-botoes">
          {p.desenhando ? null : p.caminhando ? (
            <button type="button" className="campo-btn-grande ativo" onClick={p.onPausar}><Ic d={ICO.pausar} />Pausar</button>
          ) : (
            <button type="button" className="principal campo-btn-grande" onClick={p.onCaminhar} disabled={semGps}><Ic d={ICO.andar} />Caminhar</button>
          )}
          {!p.desenhando && <button type="button" className="campo-btn-grande" onClick={p.onMarcar} disabled={semGps}><Ic d={ICO.ponto} />Marcar ponto</button>}
          <button type="button" className="campo-btn-grande" onClick={p.onDesfazer} disabled={!n}><Ic d={ICO.desfazer} />Desfazer</button>
          <button type="button" className={`campo-btn-grande${n >= 3 ? " fechar" : ""}`} onClick={p.onFechar} disabled={n < 3}
            title={n < 3 ? "Precisa de pelo menos 3 vértices" : "Liga o último vértice ao primeiro"}>
            <Ic d={ICO.fechar} />Fechar a área
          </button>
        </div>
      )}
      {!p.marcando && !p.pontoRuim && (
        <div className="campo-acoes-rodape">
          {p.desenhando
            ? !semGps && <button type="button" className="fantasma" onClick={p.onPararDesenho}>Voltar a medir com o GPS</button>
            : <button type="button" className="fantasma" onClick={p.onDesenhar}>Pôr vértice à mão no mapa</button>}
        </div>
      )}
    </div>
  );
}

/** O anel da contagem do Marcar ponto, dentro do próprio botão. */
function AnelMarcar({ prog, s }: { prog: number; s: number }) {
  const c = 2 * Math.PI * 11;
  return (
    <span className="campo-anel" aria-hidden="true">
      <svg viewBox="0 0 26 26" width="26" height="26">
        <circle cx="13" cy="13" r="11" className="trilho" />
        <circle cx="13" cy="13" r="11" className="feito" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, prog)))} />
      </svg>
      <b>{s}</b>
    </span>
  );
}

/**
 * Celular: Marcar ponto · Desenhar (redondo, verde, saltado da borda) · Caminhar.
 * Sem texto de explicação de saída: o que cada modo faz aparece na linha de estado,
 * com o "?", quando ele é escolhido. Embaixo, só o que a medição pede (números,
 * Desfazer, Fechar a área).
 */
function PainelDoca(p: PropsPainel) {
  const m = p.medicao;
  const n = m?.vertices.length ?? 0;
  const semGps = p.gps.tipo === "erro" && p.gps.erro.tipo !== "sem-sinal";
  const decidindo = !!p.pontoRuim;
  const falta = p.marcando ? Math.max(0, p.marcando.fim - Date.now()) : 0;
  const total = p.marcando ? Math.max(1, p.marcando.fim - p.marcando.inicio) : 1;
  const segundos = Math.ceil(falta / 1000);

  const doca = (
    <div className="campo-doca" role="toolbar" aria-label="Como pôr os vértices">
      <button type="button" className={`campo-doca-lado${p.marcando ? " ativo marcando" : ""}`}
        onClick={p.marcando ? p.onCancelarMarcar : p.onMarcar} disabled={semGps || decidindo}
        aria-label={p.marcando ? "Cancelar o Marcar ponto" : "Marcar ponto aqui"}>
        {p.marcando ? <AnelMarcar prog={1 - falta / total} s={segundos} /> : <Ic d={ICO.ponto} tam={22} />}
        <span>{p.marcando ? "Cancelar" : "Marcar ponto"}</span>
      </button>
      <span className="campo-doca-meio">
        <button type="button" className={`campo-doca-fab${p.desenhando ? " ativo" : ""}`}
          onClick={p.desenhando ? () => { if (!semGps) p.onPararDesenho(); } : p.onDesenhar}
          disabled={!!p.marcando || decidindo} aria-pressed={p.desenhando}
          aria-label={p.desenhando ? (semGps ? "Desenhando no mapa" : "Parar de desenhar e voltar ao GPS") : "Desenhar no mapa"}
          title={p.desenhando ? (semGps ? "Desenhando no mapa" : "Voltar ao GPS") : "Desenhar no mapa"}>
          <Ic d={ICO.lapis} tam={26} />
        </button>
      </span>
      <button type="button" className={`campo-doca-lado${p.caminhando ? " ativo pausar" : ""}`}
        onClick={p.caminhando ? p.onPausar : p.onCaminhar} disabled={semGps || !!p.marcando || decidindo}
        aria-label={p.caminhando ? "Pausar a caminhada" : "Caminhar"}>
        <Ic d={p.caminhando ? ICO.pausar : ICO.andar} tam={22} />
        <span>{p.caminhando ? "Pausar" : "Caminhar"}</span>
      </button>
    </div>
  );

  // a linha de estado: o que o botão escolhido está fazendo, com o "?" explicando
  let estado: ReactNode = null;
  if (p.marcando) {
    estado = (
      <p className="campo-estado marcando" role="status" aria-live="polite">
        <i aria-hidden="true" />
        <TextoMarcando p={p} segundos={segundos} />
        <Dica>Parado no canto, o celular junta as leituras e tira a média; as que pulam longe ficam de fora. O erro do celular muda devagar: quanto mais tempo parado, melhor (+1 min estende). "Pronto" aparece quando o ponto parou de andar. Cancelar desiste.</Dica>
      </p>
    );
  } else if (p.caminhando) {
    estado = (
      <p className={`campo-estado${p.sinalFraco || !p.leitura ? " fraco" : ""}`} role="status" aria-live="polite">
        <i aria-hidden="true" />
        <span>{!p.leitura ? "Esperando o sinal do GPS…"
          : !p.aquecimento.pronto && !n ? <><b>Aquecendo o GPS</b> · {textoPrecisao(p.leitura.precisao)} · {Math.round(p.aquecimento.segundos)} s</>
          : p.sinalFraco ? <><b>Sinal fraco</b> · {textoPrecisao(p.leitura.precisao)} · esperando</>
            : <><b>Caminhando</b> · vértice a cada {p.opcoes.passoM} m</>}</span>
        <Dica>Ande rente à cerca: o celular põe um vértice sozinho a cada {p.opcoes.passoM} m ou a cada curva de {p.opcoes.anguloGraus}°. Com o sinal pior que ±{p.opcoes.limitePrecisaoM} m, ele espera melhorar. Pausar para quando precisar sair da linha.{p.acordada ? " A tela fica acordada enquanto mede." : ""}</Dica>
      </p>
    );
  } else if (p.desenhando) {
    estado = (
      <p className="campo-estado mao" role="status">
        <i aria-hidden="true" />
        <span><b>Desenhando</b> · toque no mapa {n ? "para cada vértice" : "para pôr o 1º vértice"}</span>
        <Dica>Toque no mapa em cada canto do imóvel; arraste um vértice para ajustar.{semGps ? "" : " Para voltar ao GPS, toque de novo no botão verde ou escolha Caminhar ou Marcar ponto."}</Dica>
      </p>
    );
  } else if (semGps && p.gps.tipo === "erro") {
    estado = (
      <p className="campo-estado fraco" role="status">
        <i aria-hidden="true" />
        <span><b>{p.gps.erro.tipo === "sem-permissao" ? "Localização bloqueada" : "Sem GPS neste aparelho"}</b> · desenhe no mapa</span>
        <Dica>{p.gps.erro.tipo === "sem-permissao" ? p.gps.erro.mensagem : "Cole a coordenada ou o link do Google Maps: o mapa vai até lá e você desenha o contorno tocando nos cantos (botão verde)."}</Dica>
      </p>
    );
  }

  return (
    <div className={`campo-painel campo-painel-doca${n ? " medindo" : ""}`} role="region" aria-label={n ? "Medindo" : "Começar a medir"}>
      {doca}
      {estado}
      {p.gps.tipo === "erro" && !semGps && !p.caminhando && !p.marcando && <p className="campo-alerta" role="alert">{p.gps.erro.mensagem}</p>}
      {!n && !p.leitura && (p.desenhando || semGps) && <IrPara onIr={(lugar) => { p.onIrPara(lugar); if (!p.desenhando) p.onDesenhar(); }} />}
      {p.pontoRuim && (
        <div className="campo-ponto-ruim" role="alertdialog" aria-label="Precisão pior que o limite">
          <b>{p.exigirFixo && p.pontoRuim.fonte === "receptor" && p.pontoRuim.fix !== "rtk-fixo" ? `Sem RTK fixo (${NOME_FIX[p.pontoRuim.fix ?? "sem-fix"]}) · o ponto de SIGEF pede fixo` : <>Precisão de {textoPrecisao(p.pontoRuim.precisao)} · o limite é ±{p.opcoes.limitePrecisaoM} m</>}
            <Dica>Debaixo de árvore ou perto de parede o GPS piora: dois passos para o aberto costumam resolver. Marcar assim põe o vértice com essa precisão.</Dica>
          </b>
          <div className="campo-acoes-linha">
            <button type="button" className="principal" onClick={p.onPontoDeNovo}>Tentar de novo</button>
            <button type="button" onClick={p.onPontoAssimMesmo}>Marcar assim</button>
            <button type="button" className="fantasma" onClick={p.onPontoCancelar}>Cancelar</button>
          </div>
        </div>
      )}
      {n > 0 && (
        <>
          <Numeros md={p.md} aberta />
          {p.cruza && <p className="campo-alerta" role="alert">O contorno está se cruzando. Desfaça os últimos vértices se não for isso.</p>}
          <div className="campo-acoes-linha campo-doca-acoes">
            <button type="button" className="campo-btn-medio" onClick={p.onDesfazer}><Ic d={ICO.desfazer} tam={18} />Desfazer</button>
            <button type="button" className={`campo-btn-medio${n >= 3 ? " fechar" : ""}`} onClick={p.onFechar} disabled={n < 3}
              title={n < 3 ? "Precisa de pelo menos 3 vértices" : "Liga o último vértice ao primeiro"}>
              <Ic d={ICO.fechar} tam={18} />{n < 3 ? `Fechar (faltam ${3 - n})` : "Fechar a área"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Medições salvas
// ---------------------------------------------------------------------------

function ListaMedicoes({ itens, carregando, erroConta, atualId, onAbrir, onExcluir, onTentar }: {
  itens: ItemLista[];
  carregando: boolean;
  erroConta: ErroConta | null;
  atualId: string | null;
  onAbrir: (m: Medicao) => void;
  onExcluir: (m: Medicao) => void;
  onTentar: () => void;
}) {
  if (carregando) return <Esqueleto linhas={3} rotulo="Carregando as medições…" />;
  const aviso = erroConta && (
    erroConta.tipo === "sem-rede" ? <p className="campo-nota">Sem internet: mostrando as medições deste aparelho.</p>
      : erroConta.tipo === "sem-tabela" ? <p className="campo-nota">O sistema ainda não foi atualizado para guardar medições na conta: mostrando as deste aparelho.</p>
        : null
  );
  if (erroConta && !aviso && !itens.length) return <EstadoErro titulo="Não deu para carregar as medições" mensagem={erroConta.message} onTentar={onTentar} />;
  if (!itens.length) {
    return (
      <>
        {aviso}
        <EstadoVazio titulo="Nenhuma medição ainda"
          texto="Meça no celular, andando ou marcando os cantos: a medição aparece aqui e no computador do escritório." />
      </>
    );
  }
  return (
    <>
      {aviso}
      {erroConta && !aviso && <p className="campo-nota erro">A conta não respondeu ({erroConta.message}). <button type="button" className="fantasma" onClick={onTentar}>Tentar de novo</button></p>}
      <ul className="campo-lista">
        {itens.map(({ medicao: m, onde }) => {
          const md = medir(m.vertices);
          return (
            <li key={m.id} className={m.id === atualId ? "atual" : ""}>
              <button type="button" className="campo-item" onClick={() => onAbrir(m)} aria-current={m.id === atualId || undefined}>
                <span className="campo-item-nome">{m.nome}</span>
                <span className="campo-item-num">{md.n >= 3 ? textoHa(md.areaM2) : "—"}</span>
                <span className="campo-item-sub">
                  {quando(m.atualizadaEm)} · {textoVertices(md.n)}{m.fechada ? "" : " · em andamento"}
                </span>
                <span className={`campo-item-onde ${onde}`}>{onde === "conta" ? "na conta" : "só no aparelho"}</span>
              </button>
              <button type="button" className="remover campo-item-x" onClick={() => onExcluir(m)} aria-label={`Excluir ${m.nome}`} title="Excluir">✕</button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

type TextosOpcoes = Record<keyof OpcoesCampo, string>;
const textosDe = (o: OpcoesCampo): TextosOpcoes => ({
  passoM: String(o.passoM), anguloGraus: String(o.anguloGraus), limitePrecisaoM: String(o.limitePrecisaoM), segundosMarcar: String(o.segundosMarcar),
});

function Ajustes({ opcoes, onMudar, onFechar }: { opcoes: OpcoesCampo; onMudar: (o: OpcoesCampo) => void; onFechar: () => void }) {
  // o texto digitado fica aqui e o limite só vale ao sair do campo (ou no Pronto):
  // aplicar a cada tecla fazia "20" virar "50" no ângulo (o "2" subia para o mínimo 5)
  const [textos, setTextos] = useState<TextosOpcoes>(() => textosDe(opcoes));
  const [notas, setNotas] = useState<Partial<Record<keyof OpcoesCampo, string>>>({});
  const conferirTudo = (): OpcoesCampo => {
    const o = { ...opcoes };
    const n: Partial<Record<keyof OpcoesCampo, string>> = {};
    for (const k of Object.keys(textos) as (keyof OpcoesCampo)[]) {
      const r = conferirAjuste(k, textos[k], opcoes[k]);
      o[k] = r.valor;
      if (r.nota) n[k] = r.nota;
    }
    setNotas(n);
    setTextos(textosDe(o));
    return o;
  };
  const sair = (k: keyof OpcoesCampo) => {
    const r = conferirAjuste(k, textos[k], opcoes[k]);
    setNotas((x) => ({ ...x, [k]: r.nota ?? undefined }));
    setTextos((x) => ({ ...x, [k]: String(r.valor) }));
    if (r.valor !== opcoes[k]) onMudar({ ...opcoes, [k]: r.valor });
  };
  const campo = (k: keyof OpcoesCampo, rotulo: string, unidade: string, dica: string) => {
    const [min, max] = LIMITES_OPCOES[k];
    return (
      <label>
        <Rotulo dica={`${dica} Vale de ${min} a ${max} ${unidade}.`}>{rotulo}</Rotulo>
        <span className="campo-unidade">
          <input type="number" inputMode="decimal" value={textos[k]} min={min} max={max} step="any"
            aria-invalid={notas[k] ? true : undefined}
            onChange={(e) => { const v = e.target.value; setTextos((x) => ({ ...x, [k]: v })); setNotas((x) => ({ ...x, [k]: undefined })); }}
            onBlur={() => sair(k)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sair(k); } }} />
          <i>{unidade}</i>
        </span>
        {notas[k] && <small className="campo-ajuste-nota" role="status">{notas[k]}</small>}
      </label>
    );
  };
  const padrao = JSON.stringify(opcoes) === JSON.stringify(OPCOES_PADRAO) && JSON.stringify(textos) === JSON.stringify(textosDe(OPCOES_PADRAO));
  const pronto = () => { const o = conferirTudo(); if (JSON.stringify(o) !== JSON.stringify(opcoes)) onMudar(o); onFechar(); };
  return (
    <Gaveta olho="Medir no campo" titulo="Ajustes do medidor" onFechar={pronto}
      rodape={(
        <div className="campo-acoes-linha">
          <button type="button" disabled={padrao} onClick={() => { setNotas({}); setTextos(textosDe(OPCOES_PADRAO)); onMudar(OPCOES_PADRAO); }}>Voltar ao padrão</button>
          <button type="button" className="principal" onClick={pronto}>Pronto</button>
        </div>
      )}>
      <div className="grade grade-2">
        {campo("passoM", "Caminhar: vértice a cada", "m", "Andando, o sistema põe um vértice sozinho cada vez que você anda esta distância desde o último.")}
        {campo("anguloGraus", "Ou na curva de mais de", "°", "Também põe vértice quando a direção muda mais que isso: é o canto da cerca.")}
        {campo("limitePrecisaoM", "Precisão aceita até", "m", "Leitura pior que isso não vira vértice andando; no Marcar ponto, o sistema pergunta antes.")}
        {campo("segundosMarcar", "Marcar ponto: juntar por", "s", "Quanto tempo o Marcar ponto aqui fica juntando leituras para tirar a média.")}
      </div>
      <p className="campo-nota">Os ajustes ficam neste aparelho.</p>
    </Gaveta>
  );
}

/** " · calibrada em 2 marcos" */
function textoCalibrada(m: Medicao): string {
  const n = m.calibracoes?.length ?? 0;
  return n ? ` · calibrada em ${n === 1 ? "1 marco" : `${n} marcos`}` : "";
}

/** " · 12 de 14 vértices em RTK fixo" (só com receptor) */
function textoFixos(m: Medicao): string {
  const doReceptor = m.vertices.filter((v) => v.fonte === "receptor");
  if (!doReceptor.length) return "";
  const fixos = doReceptor.filter((v) => v.fix === "rtk-fixo").length;
  return ` · ${fixos} de ${m.vertices.length} vértices em RTK fixo`;
}
