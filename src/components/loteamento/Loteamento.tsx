// Serviço de loteamento: perguntas → projeto (prancheta) → entregas.
//
// O perímetro é o do TXT (vértices do serviço). O projeto é só intenção e mora
// na tabela `loteamentos`; quadras e lotes são recalculados a cada mudança, e
// é isso que deixa o operador mexer num lote e ver o resto se ajustar.
import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { supabase } from "../../lib/supabase";
import { rotuloCurto } from "../../lib/modalidades";
import { useAutosave } from "../../lib/ux";
import type { Servico, Vertice } from "../../lib/types";
import { calcular, fmt } from "../../lib/loteamento/calculo.ts";
import type { Resultado } from "../../lib/loteamento/calculo.ts";
import type { Projeto } from "../../lib/loteamento/modelo.ts";
import { carregarProjeto, perimetroDoServico, projetoInicial, salvarProjeto } from "../../lib/loteamento/persistencia.ts";
import { COMANDOS, chaveDoLote, contextoDe, executar, lotesDaSelecao } from "../../lib/loteamento/acoes.ts";
import { dentroPol } from "../../lib/loteamento/geom.ts";
import { pontoInterno } from "../../lib/loteamento/auto.ts";
import type { Ferramenta, Selecao } from "../../lib/loteamento/acoes.ts";
import type { Pt } from "../../lib/loteamento/geom.ts";
import { Passos, StatusSalvamento } from "../ui";
import type { Passo } from "../ui";
import { Assistente } from "./Assistente";
import { Editor } from "./Editor";
import type { OpcoesVista } from "./Editor";
import { Painel } from "./Painel";
import { Avisos } from "./Avisos";
import { Entregas } from "./Entregas";
import "./loteamento.css";

// a maquete 3D (three.js) só é baixada por quem a abre
const Visao3D = lazy(() => import("./Visao3D"));

/** Se a maquete não carregar (sem rede, versão nova publicada), o serviço continua de pé. */
class BarreiraMaquete extends Component<{ onFechar: () => void; children: ReactNode }, { erro: string | null }> {
  state = { erro: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { erro: e instanceof Error ? e.message : String(e) }; }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="lot-3d-carregando">
        <div style={{ textAlign: "center", maxWidth: 420, padding: 16 }}>
          <p>Não deu para abrir a maquete 3D. Confira a conexão e tente de novo (se o sistema acabou de ser atualizado, recarregue a página).</p>
          <button className="principal" onClick={this.props.onFechar}>Voltar ao projeto</button>
        </div>
      </div>
    );
  }
}

type Etapa = "perguntas" | "projeto" | "entregas";

interface Historico { passado: Projeto[]; atual: Projeto; futuro: Projeto[]; base: Projeto | null }

/** Desfazer/refazer. Mudança transiente (arraste) não empilha: só o resultado final, ao soltar. */
/** O que a edição pioraria nas regras do lote: o 1º lote que sai delas (ou null) — vira aviso, não bloqueio. */
function violacaoNova(antes: Resultado, depois: Resultado | null): string | null {
  if (!depois) return "o cálculo falhou com essa mudança";
  const conta = (r: Resultado) => r.lotes.reduce((s, l) => s + l.problemas.length, 0);
  if (conta(depois) <= conta(antes)) return null;
  const ja = new Set(antes.lotes.flatMap((l) => l.problemas.map((t) => `${l.id}|${t}`)));
  const l = depois.lotes.find((x) => x.problemas.some((t) => !ja.has(`${x.id}|${t}`))) ?? depois.lotes.find((x) => x.problemas.length);
  if (!l) return "um lote saiu das medidas";
  const t = l.problemas.find((x) => !ja.has(`${l.id}|${x}`)) ?? l.problemas[0];
  return `o lote ${l.id} ficou ${/^sem /.test(t) ? "" : "com "}${t}`;
}

function useHistorico(inicial: Projeto | null) {
  const [h, setH] = useState<Historico | null>(inicial ? { passado: [], atual: inicial, futuro: [], base: null } : null);
  const iniciar = useCallback((p: Projeto) => setH({ passado: [], atual: p, futuro: [], base: null }), []);
  const mudar = useCallback((p: Projeto, transiente = false) => setH((e) => {
    if (!e) return { passado: [], atual: p, futuro: [], base: null };
    if (transiente) return { ...e, atual: p, base: e.base ?? e.atual };
    return { passado: [...e.passado.slice(-100), e.base ?? e.atual], atual: p, futuro: [], base: null };
  }), []);
  // arraste que não mudou nada (borda empurrada para fora da quadra): `descartar`
  // volta ao projeto de antes e não vira passo vazio no desfazer
  const fimArraste = useCallback((descartar = false) => setH((e) => (e && e.base
    ? descartar ? { ...e, atual: e.base, base: null } : { passado: [...e.passado.slice(-100), e.base], atual: e.atual, futuro: [], base: null }
    : e)), []);
  const desfazer = useCallback(() => setH((e) => (e && e.passado.length ? { passado: e.passado.slice(0, -1), atual: e.passado[e.passado.length - 1], futuro: [e.atual, ...e.futuro], base: null } : e)), []);
  const refazer = useCallback(() => setH((e) => (e && e.futuro.length ? { passado: [...e.passado, e.atual], atual: e.futuro[0], futuro: e.futuro.slice(1), base: null } : e)), []);
  return { h, iniciar, mudar, fimArraste, desfazer, refazer };
}

/** Onde o projeto é lido e gravado. Padrão: tabela `loteamentos`; o laboratório local usa o navegador. */
export interface Armazenamento {
  carregar: (servicoId: string) => Promise<Partial<Projeto> | null>;
  salvar: (servicoId: string, p: Projeto) => Promise<void>;
  marcarExportado?: (servicoId: string) => Promise<void>;
}

const BANCO: Armazenamento = {
  carregar: carregarProjeto,
  salvar: salvarProjeto,
  marcarExportado: async (id) => { await supabase.from("servicos").update({ status: "gerado" }).eq("id", id); },
};

export function Loteamento({ servico: servicoInicial, vertices, onVoltar, armazenamento = BANCO }: {
  servico: Servico; vertices: Vertice[]; onVoltar: () => void; armazenamento?: Armazenamento;
}) {
  const [servico, setServico] = useState(servicoInicial);
  const fuso = servico.fuso_utm ?? 24;
  const perimetro = useMemo(() => perimetroDoServico(vertices, fuso), [vertices, fuso]);
  const [ver3d, setVer3d] = useState(false);
  const hist = useHistorico(null);
  const projeto = hist.h?.atual ?? null;
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [etapa, setEtapa] = useState<Etapa>("perguntas");
  const [sel, setSel] = useState<Selecao>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("selecionar");
  const [vista, setVista] = useState<OpcoesVista>({ satelite: true, medidas: true, cores: "situacao" });
  const [focar, setFocar] = useState<{ pt: Pt; n: number } | null>(null);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [cmd, setCmd] = useState("");
  const [historicoCmd, setHistoricoCmd] = useState<string[]>([]);
  const [ajuda, setAjuda] = useState(false);
  const [verAvisos, setVerAvisos] = useState(true);
  const cmdRef = useRef<HTMLInputElement>(null);

  // carga
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const salvo = await armazenamento.carregar(servico.id);
        if (cancelado) return;
        const p = projetoInicial(salvo, servico, perimetro);
        hist.iniciar(p);
        setEtapa(p.gerado ? "projeto" : "perguntas");
      } catch (e) {
        if (!cancelado) setErroCarga(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelado = true; };
  }, [servico.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const auto = useAutosave(projeto, async (p) => { if (p) await armazenamento.salvar(servico.id, p); }, { ativo: !!projeto, atraso: 1500 });

  // um cálculo por versão do projeto: a conferência das regras na edição e o
  // desenho usam o mesmo resultado
  const cache = useRef(new WeakMap<Projeto, Resultado | null>());
  const calc = useCallback((p: Projeto): Resultado | null => {
    if (perimetro.pts.length < 3) return null;
    if (cache.current.has(p)) return cache.current.get(p)!;
    let r: Resultado | null = null;
    try { r = calcular(p, perimetro); } catch (e) { console.error(e); }
    cache.current.set(p, r);
    return r;
  }, [perimetro]);
  const res: Resultado | null = useMemo(() => (projeto ? calc(projeto) : null), [projeto, calc]);

  // aviso da última edição: a mensagem de sucesso que o painel mostra logo em
  // seguida o leva junto (e ele vale só para essa edição)
  const avisoRef = useRef<string | null>(null);
  const mostrar = useCallback((t: string, erro = false) => {
    const a = avisoRef.current;
    setMsg({ t: a && !t.includes(a) && !t.includes("Atenção:") ? `${t} Atenção: ${a}` : t, erro });
  }, []);
  // Edição livre: o operador mexe em lote, divisa e quadra à vontade. O que
  // sair das medidas do projeto (frente, profundidade, área, forma) é aplicado
  // e aparece como aviso — o lote fica marcado na planta até ser acertado.
  const baseArraste = useRef<Resultado | null>(null);
  // (só quando há o que desfazer/refazer: senão o res não muda e a lembrança ficaria pendurada)
  const lembrarSelecao = useCallback((sentido: "desfazer" | "refazer" = "desfazer") => {
    const tem = sentido === "desfazer" ? hist.h?.passado.length : hist.h?.futuro.length;
    if (!res || sel?.tipo !== "lotes" || !tem) return;
    selPorLugar.current = lotesDaSelecao(res, sel).map((l) => ({ pt: pontoInterno(l.pol), chave: chaveDoLote(l) }));
  }, [res, sel, hist.h]);
  const ultimoArraste = useRef<Projeto | null>(null);
  const mudar = useCallback((p: Projeto, transiente = false): boolean => {
    const r0 = transiente ? (baseArraste.current ??= res) : baseArraste.current ?? res;
    const r1 = r0 ? calc(p) : null;
    const viola = r0 ? violacaoNova(r0, r1) : null;
    if (!r1 && r0) { if (!transiente) mostrar("Essa mudança não fecha o cálculo (geometria impossível) — não aplicada.", true); return false; }
    if (transiente) ultimoArraste.current = p;
    if (!transiente) {
      baseArraste.current = null;
      ultimoArraste.current = null;
      avisoRef.current = viola;
      if (viola) mostrar(`Aplicado. Atenção: ${viola} — fora das medidas do projeto; ajuste se quiser.`);
      setTimeout(() => { avisoRef.current = null; }, 0);
    }
    hist.mudar(p, transiente);
    return true;
  }, [hist, res, calc, mostrar]);
  const fimArraste = useCallback(() => {
    const r0 = baseArraste.current, final = ultimoArraste.current;
    baseArraste.current = null;
    ultimoArraste.current = null;
    const r1 = r0 && final ? calc(final) : null;
    // nada mudou no desenho (o projeto regravado difere só no arredondamento)
    const forma = (r: Resultado) => r.lotes.map((l) => `${l.quadra}|${l.pol.ext.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).sort().join(";")}`).sort().join("/");
    const nada = !!r0 && !!r1 && forma(r0) === forma(r1);
    hist.fimArraste(nada);
    if (nada) { mostrar("Nada mudou: a alça voltou ao lugar ou foi empurrada para fora da quadra (a borda é a rua — puxe para dentro para recuar o lote)."); return; }
    if (r0 && final) {
      const viola = violacaoNova(r0, r1);
      // arraste exagerado pode esmagar um lote até sumir: isso tem de ser dito
      const sumiram = r1 ? r0.quadras.flatMap((q) => {
        const depois = r1.quadras.find((x) => x.nome === q.nome);
        return depois && depois.lotes.length < q.lotes.length ? [`${q.lotes.length - depois.lotes.length} lote(s) da quadra ${q.nome} ficaram sem área e sumiram`] : [];
      }) : [];
      // área pública que o arraste mudou (a institucional/verde da quadra encosta no lote)
      const pub = (r: Resultado) => r.quadro.verde + r.quadro.institucional + r.quadro.lazer;
      const dPub = r1 ? pub(r1) - pub(r0) : 0;
      const avPub = r1 && Math.abs(dPub) > 1 ? ` A área pública ${dPub < 0 ? "diminuiu" : "aumentou"} ${fmt(Math.abs(dPub))} m² (verde ${fmt((100 * (r1.quadro.verde + r1.quadro.lazer)) / r1.quadro.gleba, 1)}%, institucional ${fmt((100 * r1.quadro.institucional) / r1.quadro.gleba, 1)}%).` : "";
      if (sumiram.length) mostrar(`Atenção: ${sumiram.join("; ")} — Ctrl+Z desfaz.${viola ? ` Também: ${viola}.` : ""}${avPub}`, true);
      else if (viola) mostrar(`Atenção: ${viola} — fora das medidas do projeto. A edição foi aplicada; ajuste se quiser.${avPub}`);
      else if (avPub) mostrar(`Atenção:${avPub} Ctrl+Z desfaz.`, true);
      else mostrar("Pronto — os lotes vizinhos se ajustaram (Ctrl+Z desfaz).");
    }
  }, [hist, calc, mostrar]);

  // atalhos globais: desfazer/refazer e "/" para a linha de comando
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      const digitando = alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT");
      // no campo de comando vazio o Ctrl+Z também desfaz (logo depois de um comando o foco fica lá)
      const vazio = digitando && alvo === cmdRef.current && !cmdRef.current?.value;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && (!digitando || vazio)) { e.preventDefault(); lembrarSelecao(e.shiftKey ? "refazer" : "desfazer"); if (e.shiftKey) hist.refazer(); else hist.desfazer(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && (!digitando || vazio)) { e.preventDefault(); lembrarSelecao("refazer"); hist.refazer(); }
      else if (etapa === "projeto" && !digitando && (e.key === "/" || e.key === ":")) { e.preventDefault(); cmdRef.current?.focus(); }
      else if (etapa === "projeto" && !digitando && (e.key === "Delete") && res && projeto) {
        const s = executar("excluir", projeto, res, sel);
        if (s.pr) { mudar(s.pr); setSel(null); mostrar(s.msg); }
        else if (s.msg) mostrar(s.msg, s.erro);
      }
    };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [hist, etapa, res, projeto, sel, mudar, mostrar, lembrarSelecao]);

  // Desfazer/refazer: a posição do lote na quadra muda quando ela é (des)congelada;
  // a seleção segue o LUGAR do lote (o ponto no meio dele), não a posição
  const selPorLugar = useRef<{ pt: Pt; chave: ReturnType<typeof chaveDoLote> }[] | null>(null);
  useEffect(() => {
    const pts = selPorLugar.current;
    selPorLugar.current = null;
    if (!pts || !res) return;
    // o lote que está no lugar; se ali não tem lote (o arraste o levou para
    // longe), o mesmo lote da quadra; sem repetir (as partes de um lote
    // dividido voltam ao mesmo lote)
    const achar = ({ pt, chave }: (typeof pts)[number]) => res.lotes.find((l) => dentroPol(pt, l.pol))
      ?? res.lotes.find((l) => l.quadra === chave.quadra && l.fileira === chave.fileira && l.indice === chave.indice);
    const achados = [...new Set(pts.map(achar).filter((l): l is NonNullable<typeof l> => !!l))];
    setSel(achados.length ? { tipo: "lotes", chaves: achados.map(chaveDoLote) } : null);
  }, [res]);

  async function marcarExportado() {
    if (servico.status === "gerado") return;
    await armazenamento.marcarExportado?.(servico.id);
    setServico({ ...servico, status: "gerado" });
  }

  function rodarComando(texto: string) {
    if (!projeto || !res) return;
    const s = executar(texto, projeto, res, sel);
    if (s.desfazer) { lembrarSelecao(); hist.desfazer(); }
    if (s.refazer) { lembrarSelecao("refazer"); hist.refazer(); }
    if (s.ajuda) setAjuda(true);
    const aceito = s.pr ? mudar(s.pr) : true;
    if (aceito && s.sel !== undefined) setSel(s.sel);
    if (s.ferramenta) setFerramenta(s.ferramenta);
    if (s.focar) setFocar({ pt: s.focar, n: Date.now() });
    if (aceito && s.msg) mostrar(s.msg, s.erro);
    if (texto.trim()) setHistoricoCmd((h) => [texto, ...h.filter((x) => x !== texto)].slice(0, 30));
  }

  if (erroCarga) {
    return (
      <div className="centro"><div><h2>Não foi possível abrir o loteamento</h2><p>{erroCarga}</p>
        <p className="lot-dica">Se a mensagem fala da tabela <code>loteamentos</code>, falta aplicar a migração 0021 no banco.</p>
        <button onClick={onVoltar}>← Serviços</button></div></div>
    );
  }
  if (!projeto) return <div className="centro"><span className="spinner" />&nbsp; Abrindo o loteamento…</div>;
  if (perimetro.pts.length < 3) return <div className="centro"><div><h2>O perímetro tem menos de 3 pontos</h2><button onClick={onVoltar}>← Serviços</button></div></div>;

  const etapas: { chave: Etapa; rotulo: string; feita: boolean }[] = [
    { chave: "perguntas", rotulo: "Perguntas", feita: projeto.gerado },
    { chave: "projeto", rotulo: "Projeto", feita: projeto.gerado && !!res && res.lotes.length > 0 },
    { chave: "entregas", rotulo: "Entregas", feita: servico.status === "gerado" },
  ];
  const passos: Passo[] = etapas.map((e) => ({ rotulo: e.rotulo, estado: e.chave === etapa ? "ativa" : e.feita ? "feita" : "futura" }));
  const contexto = contextoDe(sel);
  const sugestoes = COMANDOS.filter((c) => c.contexto.includes(contexto)).slice(0, 8);
  const qtdSel = lotesDaSelecao(res ?? ({ lotes: [] } as unknown as Resultado), sel).length;

  return (
    <div className={`conferencia lot-pagina etapa-${etapa}`}>
      <header className="topo">
        <button className="fantasma voltar" onClick={onVoltar}>← Serviços</button>
        <span className="sep" aria-hidden="true">/</span>
        <h1 className="titulo">{projeto.nome}</h1>
        <span className="chip mod-loteamento">{rotuloCurto.loteamento}</span>
        {servico.nome_arquivo_txt && <span className="arquivo">{servico.nome_arquivo_txt}</span>}
        <StatusSalvamento estado={auto.estado} horaSalvo={auto.horaSalvo} />
        <span className="esticar" />
        {res && projeto.gerado && (
          <span className="lot-resumo-topo">
            <b>{res.lotes.length}</b> lotes · <b>{res.quadras.length}</b> quadras · {fmt((100 * res.quadro.lotes.area) / res.quadro.gleba, 1)}% vendável
          </span>
        )}
        <Passos passos={passos} onClick={(_, i) => setEtapa(etapas[i].chave)} />
      </header>

      {etapa === "perguntas" && (
        <div className="conferencia-corpo fade">
          <Assistente projeto={projeto} perimetro={perimetro} fuso={fuso} onMudar={(p) => mudar(p)}
            onPronto={(p) => { mudar({ ...p, gerado: true }); setSel(null); setEtapa("projeto"); mostrar("Proposta aplicada. Clique num lote para ajustar; duplo clique seleciona a quadra; digite comandos aqui embaixo."); }} />
        </div>
      )}

      {etapa === "projeto" && res && (
        <div className={`lot-area-trabalho${verAvisos ? " com-avisos" : ""}`}>
          <nav className="lot-ferramentas" aria-label="Ferramentas">
            {([
              ["selecionar", "Selecionar e arrastar (S)", "M5 3l14 9-6 1.5L10 20z"],
              ["rua", "Desenhar rua (R)", "M4 20 10 4M14 4l6 16M12 6v2M12 11v2M12 16v2"],
              ["lote", "Desenhar lote (L) — clique as quinas, Enter fecha; duplo clique na área livre rosa vira lote", "M4 4h16v16H4zM4 12h16M12 4v16"],
              ["cortar", "Cortar lotes com uma linha (C)", "M6 6a2 2 0 1 0 0 .01M6 18a2 2 0 1 0 0 .01M8 7l12 10M8 17l12-10"],
              ["frente", "Escolher a frente (T): com um lote selecionado, clique no lado que é a frente dele; sem lote, no lado da quadra que é o acesso", "M4 20h16M7 20V9l5-5 5 5v11M10 20v-5h4v5"],
              ["area", "Desenhar área pública (A)", "M4 6l7-3 9 5-2 11-10 2-5-6z"],
              ["medir", "Medir (M)", "M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2"],
            ] as [Ferramenta, string, string][]).map(([f, t, d]) => (
              <button key={f} title={t} className={ferramenta === f ? "ativo" : ""} onClick={() => setFerramenta(f)}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d={d} /></svg>
              </button>
            ))}
            <span className="sep" />
            <button title="Desfazer (Ctrl+Z)" disabled={!hist.h?.passado.length} onClick={() => { lembrarSelecao(); hist.desfazer(); }}>↶</button>
            <button title="Refazer (Ctrl+Y)" disabled={!hist.h?.futuro.length} onClick={() => { lembrarSelecao("refazer"); hist.refazer(); }}>↷</button>
            <span className="sep" />
            <button title="Imagem de satélite" className={vista.satelite ? "ativo" : ""} onClick={() => setVista({ ...vista, satelite: !vista.satelite })}>🛰</button>
            <button title="Medidas dos lados" className={vista.medidas ? "ativo" : ""} onClick={() => setVista({ ...vista, medidas: !vista.medidas })}>↔</button>
            <button title="Colorir pelo tamanho do lote" className={vista.cores === "area" ? "ativo" : ""} onClick={() => setVista({ ...vista, cores: vista.cores === "area" ? "situacao" : "area" })}>▦</button>
            <button title="Maquete 3D: o loteamento no relevo real, com casas, árvores e voo de drone" className="lot-btn-3d" onClick={() => setVer3d(true)}>3D</button>
            <button title={projeto.terreno ? "Colorir pelo relevo (cota)" : "Relevo ainda não lido (gere pelas Perguntas)"} disabled={!projeto.terreno}
              className={vista.cores === "relevo" ? "ativo" : ""} onClick={() => setVista({ ...vista, cores: vista.cores === "relevo" ? "situacao" : "relevo" })}>⛰</button>
            <span className="sep" />
            <button title={verAvisos ? "Esconder os avisos dos lotes" : "Mostrar os avisos dos lotes"} className={`lot-btn-avisos${verAvisos ? " ativo" : ""}`} onClick={() => setVerAvisos(!verAvisos)}>
              ⚠{res.lotes.some((l) => l.problemas.length) && <i>{res.lotes.filter((l) => l.problemas.length).length}</i>}
            </button>
            <button title="Ver comandos e atalhos" onClick={() => setAjuda(true)}>?</button>
          </nav>

          {verAvisos && <Avisos res={res} params={projeto.params} sel={sel} onSel={setSel} onFocar={(p) => setFocar({ pt: p, n: Date.now() })} onFechar={() => setVerAvisos(false)} />}

          <div className="lot-centro">
            <Editor projeto={projeto} res={res} fuso={fuso} sel={sel} onSel={setSel} ferramenta={ferramenta} onFerramenta={setFerramenta}
              onMudar={mudar} onFimArraste={fimArraste} vista={vista} focar={focar} onMsg={(m) => mostrar(m)} />
            <form className="lot-comando" onSubmit={(e) => { e.preventDefault(); rodarComando(cmd); setCmd(""); }}>
              <div className="lot-cmd-linha">
                <span className="lot-cmd-prompt">Comando{sel && (sel.tipo !== "lotes" || qtdSel) ? ` · ${sel.tipo === "lotes" ? (qtdSel > 1 ? `${qtdSel} lotes` : `lote ${lotesDaSelecao(res, sel)[0]?.id ?? ""}`) : sel.tipo === "quadra" ? `quadra ${sel.nome}` : sel.tipo}` : ""}:</span>
                <input ref={cmdRef} value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="ex.: frente 12 · unir · verde · largura 14 · ir A-12 · ajuda"
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" && historicoCmd.length) { e.preventDefault(); setCmd(historicoCmd[0]); setHistoricoCmd((h) => [...h.slice(1), h[0]]); }
                    if (e.key === "Escape") { setCmd(""); (e.target as HTMLInputElement).blur(); }
                  }} />
                <button type="submit" className="principal">Executar</button>
              </div>
              <div className="lot-cmd-sugestoes">
                {msg && <span className={`lot-cmd-msg${msg.erro ? " erro" : ""}`}>{msg.t}</span>}
                {!msg && sugestoes.map((c) => (
                  <button type="button" key={c.cmd} title={c.desc} onClick={() => { const temNum = /\d/.test(c.exemplo); if (temNum) { setCmd(c.exemplo.replace(/\d+.*$/, "")); cmdRef.current?.focus(); } else rodarComando(c.exemplo); }}>{c.exemplo}</button>
                ))}
                {msg && <button type="button" className="fantasma" onClick={() => setMsg(null)}>×</button>}
              </div>
            </form>
          </div>

          <Painel projeto={projeto} res={res} sel={sel} onSel={setSel} onMudar={(p) => mudar(p)}
            onFocar={(p) => setFocar({ pt: p, n: Date.now() })} onMsg={mostrar} onComando={rodarComando} onFerramenta={setFerramenta} />

          <div className="lot-rodape-etapa">
            <button onClick={() => setEtapa("perguntas")}>← Rever as perguntas</button>
            <button className="principal" onClick={() => setEtapa("entregas")}>Entregas: planta e locação →</button>
          </div>
        </div>
      )}

      {etapa === "entregas" && res && (
        <div className="conferencia-corpo fade">
          <Entregas servico={servico} projeto={projeto} res={res} perimetro={perimetro} onExportou={marcarExportado} onAbrir3D={() => setVer3d(true)} />
          <div><button onClick={() => setEtapa("projeto")}>← Voltar ao projeto</button></div>
        </div>
      )}

      {ajuda && (
        <div className="lot-modal" onClick={() => setAjuda(false)}>
          <div className="lot-modal-caixa" onClick={(e) => e.stopPropagation()}>
            <header><h3>Comandos e atalhos</h3><button className="fantasma" onClick={() => setAjuda(false)}>×</button></header>
            <div className="lot-ajuda-grade">
              <div>
                <h4>No desenho</h4>
                <ul>
                  <li><b>Clique</b> seleciona o lote · <b>Shift+clique</b> soma lotes · <b>duplo clique</b> seleciona a quadra</li>
                  <li><b>Arrastar o fundo</b> move o desenho · <b>roda do mouse</b> aproxima</li>
                  <li><b>Lote selecionado</b>: arraste as <b>quinas</b> (quadrados) e as <b>divisas</b> (barras verdes). A quina na rua ou na divisa da gleba corre por ela; os lotes vizinhos se ajustam. <b>Alt</b> solta a quina da borda</li>
                  <li>Nada é bloqueado: o lote que sair das medidas fica vermelho e aparece na coluna de avisos, à esquerda</li>
                  <li><b>T</b> escolhe a frente: com um lote selecionado, clique no lado que é a frente dele (servidão, área verde, outro lote); sem lote, clique no lado da quadra que é o acesso dela. Na lista de confrontações do lote, ☆ faz o mesmo</li>
                  <li><b>L</b> desenha um lote (clique as quinas; ele se ajusta aos vizinhos) · duplo clique numa área livre rosa vira lote · <b>C</b> corta lotes com uma linha · <b>Delete</b> apaga o lote</li>
                  <li><b>Rua selecionada</b>: arraste os pontos do eixo; o "+" dobra a rua</li>
                  <li><b>R</b> rua · <b>A</b> área · <b>M</b> medir · <b>S</b> selecionar · <b>F</b> enquadrar</li>
                  <li><b>Enter</b> termina o desenho · <b>Backspace</b> tira o último ponto · <b>Esc</b> cancela</li>
                  <li><b>Shift</b> trava o ângulo da rua (90°/45° da malha) · os pontos grudam nos vértices e eixos</li>
                  <li><b>Ctrl+Z / Ctrl+Y</b> desfazer e refazer · <b>Delete</b> apaga a rua/área · <b>/</b> vai para o comando</li>
                </ul>
              </div>
              <div>
                <h4>Linha de comando</h4>
                <table><tbody>
                  {COMANDOS.map((c) => <tr key={c.cmd}><td><code>{c.exemplo}</code></td><td>{c.desc}</td></tr>)}
                </tbody></table>
              </div>
            </div>
          </div>
        </div>
      )}
      {ver3d && res && projeto && (
        <BarreiraMaquete onFechar={() => setVer3d(false)}>
          <Suspense fallback={<div className="lot-3d-carregando">Abrindo a maquete 3D…</div>}>
            <Visao3D projeto={projeto} res={res} perimetro={perimetro} fuso={fuso} onFechar={() => setVer3d(false)} />
          </Suspense>
        </BarreiraMaquete>
      )}
    </div>
  );
}
