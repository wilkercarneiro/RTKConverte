// Primitivas de interface compartilhadas pelas telas.
//
// Divulgação progressiva (Secao), a faixa de próxima ação (ProximaAcao), as
// abas de etapa (Passos), avisos flutuantes (AvisosGlobais + avisar), diálogo
// de confirmação (DialogosGlobais + confirmar), cabeçalho de página e estados
// de lista (CabecalhoPagina, EstadoVazio, EstadoErro, Esqueleto), indicador de
// autossalvamento (StatusSalvamento) e confirmação inline (BotaoPerigo).
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { AvisoItem, EstadoSalvamento } from "../lib/ux";
import { assinarAvisos, avisarGlobal, avisosAtuais, fecharAviso } from "../lib/ux";
import { Icone, ICONE } from "./Icone";

// ---------------------------------------------------------------------------
// Secao — grupo de campos recolhível
// ---------------------------------------------------------------------------

/**
 * Usa <details>/<summary> nativos de propósito: teclado, leitor de tela e
 * Ctrl+F do navegador (que expande o conteúdo ao encontrar texto dentro)
 * funcionam sem uma linha de JS.
 *
 * Campos OBRIGATÓRIOS nunca devem morar aqui dentro — eles ficam na área
 * sempre visível, para que a lista de pendências consiga apontar para algo que
 * o operador vê. `abrirEm` cobre o resto: se algo dentro precisa de atenção,
 * a seção já nasce aberta.
 *
 * Várias seções seguidas devem ir dentro de `<div className="secoes">`: viram
 * linhas de uma lista, como no protótipo.
 */
export function Secao({ titulo, dica, selo, abrirEm, children }: {
  titulo: string;
  dica?: string;
  /** resumo do conteúdo: "3 de 7 preenchidos", nome do RT escolhido, etc. */
  selo?: ReactNode;
  abrirEm?: boolean;
  children: ReactNode;
}) {
  // `abrirEm` só ABRE, nunca fecha: fechar por mudança de estado arrancaria a
  // seção de baixo do operador no instante em que ele desmarca um checkbox que
  // vive dentro dela. Depois disso, quem manda é o clique do usuário.
  const [aberta, setAberta] = useState(!!abrirEm);
  useEffect(() => { if (abrirEm) setAberta(true); }, [abrirEm]);

  return (
    <details className="secao" open={aberta}
      onToggle={(e) => setAberta((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className="secao-seta" aria-hidden="true"><Icone d={ICONE.seta} size={14} traco={2.4} /></span>
        <span className="secao-titulo">{titulo}</span>
        {selo != null && <span className="secao-selo">{selo}</span>}
        {dica && <span className="secao-dica">{dica}</span>}
      </summary>
      <div className="secao-corpo">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// ProximaAcao — o que fazer agora (faixa escura)
// ---------------------------------------------------------------------------

export interface Acao {
  titulo: string;
  detalhe?: string;
  rotuloBotao?: string;
  onClick?: () => void;
  tom?: "neutro" | "pendente" | "pronto";
}

/**
 * Um serviço com várias etapas não deve exigir que o operador descubra sozinho
 * em que ponto do processo está. Esta faixa responde "e agora?" em uma frase.
 */
export function ProximaAcao({ acao }: { acao: Acao }) {
  return (
    <div className={`proxima-acao ${acao.tom ?? "neutro"}`}>
      <Icone d={ICONE.relogio} size={18} traco={2} className="pa-icone" />
      <div className="pa-texto">
        <b>{acao.titulo}</b>
        {acao.detalhe && <span className="pa-detalhe">{acao.detalhe}</span>}
      </div>
      {acao.onClick && acao.rotuloBotao && (
        <button className="principal" onClick={acao.onClick}>{acao.rotuloBotao}</button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Passos — abas de etapa
// ---------------------------------------------------------------------------

export interface Passo {
  rotulo: string;
  estado: "feita" | "ativa" | "futura";
  /** id do elemento a rolar até (quando não há `onClick`); ausente = passo não navegável */
  alvo?: string;
}

/**
 * Com `onClick`, cada passo é uma aba que troca a etapa exibida (uma etapa por
 * vez). Sem ele, o passo rola até o `alvo` — o comportamento das telas que
 * ainda mostram tudo numa rolagem só.
 */
export function Passos({ passos, onClick, rotulo = "Etapas do serviço" }: {
  passos: Passo[];
  onClick?: (passo: Passo, indice: number) => void;
  rotulo?: string;
}) {
  return (
    <nav className="stepper" aria-label={rotulo}>
      {passos.map((p, i) => {
        const classe = `step ${p.estado === "feita" ? "feita" : p.estado === "ativa" ? "ativa" : ""}`;
        const num = p.estado === "feita" ? "✓" : String(i + 1);
        const navegavel = onClick ? true : !!p.alvo;
        return (
          <span key={p.rotulo} className="step-item">
            {i > 0 && <span className="step-seta" aria-hidden="true">→</span>}
            {navegavel ? (
              <button className={`${classe} step-botao`}
                onClick={() => (onClick ? onClick(p, i) : irPara(p.alvo!))}
                aria-current={p.estado === "ativa" ? "step" : undefined}>
                <span className="num">{num}</span> {p.rotulo}
              </button>
            ) : (
              <span className={classe} aria-current={p.estado === "ativa" ? "step" : undefined}>
                <span className="num">{num}</span> {p.rotulo}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** Rola até um elemento, abrindo as seções recolhidas que o contêm. */
export function irPara(id: string, piscar = false): void {
  const el = document.getElementById(id);
  if (!el) return;
  // sem isto, apontar para um campo dentro de uma seção fechada rola para o
  // lugar certo e não mostra nada
  let pai = el.closest("details");
  while (pai) {
    pai.open = true;
    pai = pai.parentElement?.closest("details") ?? null;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  if (piscar) {
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 1600);
  }
}

// ---------------------------------------------------------------------------
// Avisos flutuantes
// ---------------------------------------------------------------------------

/**
 * Legado: as telas ainda montam `<Avisos avisos={…}/>`, mas os avisos agora
 * vivem no store global (lib/ux.ts) e quem desenha é o <AvisosGlobais/>.
 * Mantido para não quebrar as chamadas; não desenha nada.
 */
export function Avisos(_: { avisos: AvisoItem[]; onFechar: (id: number) => void }) {
  return null;
}

/** Empilha um aviso flutuante (some sozinho). `tipo`: "ok" | "erro" | "alerta". */
export function avisar(tipo: AvisoItem["tom"], texto: string): void {
  avisarGlobal(tipo, texto);
}

/** Pilha de avisos do sistema inteiro. Montar UMA vez (AppShell). */
export function AvisosGlobais() {
  const avisos = useSyncExternalStore(assinarAvisos, avisosAtuais, avisosAtuais);
  return (
    <div className="avisos avisos-globais" role="status" aria-live="polite" aria-relevant="additions">
      {avisos.map((a) => (
        <div key={a.id} className={`aviso ${a.tom}`} role={a.tom === "erro" ? "alert" : undefined}>
          <span className="aviso-icone" aria-hidden="true">{a.tom === "ok" ? "✓" : a.tom === "erro" ? "✕" : "!"}</span>
          <span className="aviso-texto">{a.texto}</span>
          <button type="button" className="aviso-fechar" onClick={() => fecharAviso(a.id)} aria-label="Fechar aviso">✕</button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Diálogo de confirmação — substitui window.confirm
// ---------------------------------------------------------------------------

export interface PedidoConfirmacao {
  titulo: string;
  texto?: ReactNode;
  /** rótulo do botão que confirma ("Excluir", "Remover"…) */
  confirmar?: string;
  /** rótulo do botão que desiste (padrão "Cancelar") */
  cancelar?: string;
  /** botão de confirmar em vermelho */
  perigo?: boolean;
}

let filaDialogos: { id: number; pedido: PedidoConfirmacao; responder: (ok: boolean) => void }[] = [];
let seqDialogo = 0;
const ouvintesDialogo = new Set<() => void>();
const assinarDialogos = (f: () => void) => { ouvintesDialogo.add(f); return () => { ouvintesDialogo.delete(f); }; };
const dialogosAtuais = () => filaDialogos;

/**
 * Pergunta e espera a resposta: `if (!(await confirmar({ titulo, perigo: true }))) return;`.
 * Desenhado pelo <DialogosGlobais/>; sem ele montado, cai no confirm() nativo.
 */
export function confirmar(pedido: PedidoConfirmacao): Promise<boolean> {
  if (ouvintesDialogo.size === 0) {
    const txt = typeof pedido.texto === "string" ? `\n\n${pedido.texto}` : "";
    return Promise.resolve(window.confirm(`${pedido.titulo}${txt}`));
  }
  return new Promise((resolve) => {
    const id = ++seqDialogo;
    filaDialogos = [...filaDialogos, {
      id, pedido,
      responder: (ok) => {
        filaDialogos = filaDialogos.filter((d) => d.id !== id);
        ouvintesDialogo.forEach((f) => f());
        resolve(ok);
      },
    }];
    ouvintesDialogo.forEach((f) => f());
  });
}

/** Desenha o diálogo de confirmação pendente. Montar UMA vez (AppShell). */
export function DialogosGlobais() {
  const fila = useSyncExternalStore(assinarDialogos, dialogosAtuais, dialogosAtuais);
  const atual = fila[0];
  if (!atual) return null;
  return <DialogoConfirmacao key={atual.id} pedido={atual.pedido} responder={atual.responder} />;
}

function DialogoConfirmacao({ pedido, responder }: { pedido: PedidoConfirmacao; responder: (ok: boolean) => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  const base = useId();
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    // perigo: foco no "Cancelar" — Enter por reflexo não apaga nada
    const alvo = caixa.current?.querySelector<HTMLButtonElement>(pedido.perigo ? "[data-cancelar]" : "[data-confirmar]");
    alvo?.focus();
    return () => { antes?.focus?.(); };
  }, [pedido.perigo]);

  function teclado(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); responder(false); return; }
    if (e.key !== "Tab" || !caixa.current) return;
    const focaveis = Array.from(caixa.current.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
      .filter((el) => !el.hasAttribute("disabled"));
    if (focaveis.length === 0) return;
    const primeiro = focaveis[0], ultimo = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  }

  return (
    <div className="dialogo-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) responder(false); }}>
      <div ref={caixa} className={`dialogo${pedido.perigo ? " perigo" : ""}`} role="alertdialog" aria-modal="true"
        aria-labelledby={`${base}-t`} aria-describedby={pedido.texto ? `${base}-d` : undefined} onKeyDown={teclado}>
        {pedido.perigo && <span className="dialogo-icone" aria-hidden="true">!</span>}
        <h2 id={`${base}-t`}>{pedido.titulo}</h2>
        {pedido.texto && <div id={`${base}-d`} className="dialogo-texto">{pedido.texto}</div>}
        <div className="dialogo-acoes">
          <button type="button" data-cancelar onClick={() => responder(false)}>{pedido.cancelar ?? "Cancelar"}</button>
          <button type="button" data-confirmar className={pedido.perigo ? "perigo" : "principal"} onClick={() => responder(true)}>
            {pedido.confirmar ?? "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cabeçalho de página e estados de lista
// ---------------------------------------------------------------------------

/** Olho (mono, ponto verde), título, descrição e as ações à direita. */
export function CabecalhoPagina({ olho, titulo, descricao, acoes, voltar }: {
  olho?: string;
  titulo: ReactNode;
  descricao?: ReactNode;
  /** botões/busca à direita — no máximo UMA ação `principal` */
  acoes?: ReactNode;
  /** link de volta acima do olho: `{ rotulo: "Serviços", onClick }` vira "← Serviços" */
  voltar?: { rotulo: string; onClick: () => void };
}) {
  return (
    <header className="cabecalho-pagina">
      <div className="cp-texto">
        {voltar && <button type="button" className="fantasma cp-voltar" onClick={voltar.onClick}>← {voltar.rotulo}</button>}
        {olho && <span className="olho">{olho}</span>}
        <h1>{titulo}</h1>
        {descricao && <p className="cp-descricao">{descricao}</p>}
      </div>
      {acoes && <div className="cp-acoes">{acoes}</div>}
    </header>
  );
}

/** Lista sem nada: diz o que é, por que está vazio e o que fazer. */
export function EstadoVazio({ icone, titulo, texto, acao, compacto }: {
  /** path SVG (ICONE.*) */
  icone?: string;
  titulo: string;
  texto?: ReactNode;
  /** normalmente um <button className="principal"> */
  acao?: ReactNode;
  compacto?: boolean;
}) {
  return (
    <div className={`estado-vazio${compacto ? " compacto" : ""}`}>
      {icone && <span className="ev-icone" aria-hidden="true"><Icone d={icone} size={compacto ? 20 : 26} traco={1.8} /></span>}
      <b className="ev-titulo">{titulo}</b>
      {texto && <p className="ev-texto">{texto}</p>}
      {acao && <div className="ev-acao">{acao}</div>}
    </div>
  );
}

/** Falha de carregamento: nunca vira "nenhum registro". */
export function EstadoErro({ mensagem, onTentar, titulo = "Não foi possível carregar" }: {
  mensagem?: string | null;
  onTentar?: () => void;
  titulo?: string;
}) {
  return (
    <div className="estado-vazio erro" role="alert">
      <span className="ev-icone" aria-hidden="true">!</span>
      <b className="ev-titulo">{titulo}</b>
      {mensagem && <p className="ev-texto">{mensagem}</p>}
      {onTentar && <div className="ev-acao"><button type="button" onClick={onTentar}>Tentar de novo</button></div>}
    </div>
  );
}

/** Linhas de carregamento (com aria-busy). */
export function Esqueleto({ linhas = 4, rotulo = "Carregando…" }: { linhas?: number; rotulo?: string }) {
  return (
    <div className="esqueleto" aria-busy="true" aria-live="polite">
      <span className="sr-only">{rotulo}</span>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="esq-linha" aria-hidden="true">
          <i style={{ width: `${[38, 52, 30, 45, 34, 48][i % 6]}%` }} /><i /><i />
        </div>
      ))}
    </div>
  );
}

/** Abas acessíveis (role=tablist). */
export function Abas<T extends string>({ abas, ativa, onTrocar, rotulo }: {
  abas: { chave: T; rotulo: string }[];
  ativa: T;
  onTrocar: (chave: T) => void;
  rotulo: string;
}) {
  const base = useId();
  function teclado(e: React.KeyboardEvent, i: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const prox = abas[(i + delta + abas.length) % abas.length];
    onTrocar(prox.chave);
    (e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-aba="${prox.chave}"]`))?.focus();
  }
  return (
    <div className="abas" role="tablist" aria-label={rotulo}>
      {abas.map((a, i) => (
        <button key={a.chave} type="button" role="tab" data-aba={a.chave} id={`${base}-${a.chave}`}
          aria-selected={a.chave === ativa} tabIndex={a.chave === ativa ? 0 : -1}
          className={a.chave === ativa ? "ativa" : ""}
          onClick={() => onTrocar(a.chave)} onKeyDown={(e) => teclado(e, i)}>
          {a.rotulo}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatusSalvamento
// ---------------------------------------------------------------------------

export function StatusSalvamento({ estado, horaSalvo }: { estado: EstadoSalvamento; horaSalvo: string | null }) {
  const texto = estado === "salvando" ? "salvando…"
    : estado === "erro" ? "não salvo — use Salvar rascunho"
    : estado === "salvo" ? `salvo ${horaSalvo}`
    : "salva automaticamente";
  return (
    <span className={`status-salvo ${estado}`} aria-live="polite">
      <span className="ponto-salvo" aria-hidden="true" />{texto}
    </span>
  );
}

// ---------------------------------------------------------------------------
// BotaoPerigo — confirmação inline, sem window.confirm
// ---------------------------------------------------------------------------

/**
 * `confirm()` nativo bloqueia a aba, não é estilizável e, na dúvida, o operador
 * clica em OK por reflexo. Aqui a confirmação exige um segundo clique num botão
 * que diz exatamente o que vai acontecer.
 */
export function BotaoPerigo({ titulo, confirmacao, onConfirmar, children, className }: {
  titulo: string;
  confirmacao: string;
  onConfirmar: () => void;
  children: ReactNode;
  className?: string;
}) {
  const [armado, setArmado] = useState(false);
  if (!armado) {
    return (
      <button className={className ?? "remover"} title={titulo}
        onClick={(e) => { e.stopPropagation(); setArmado(true); }}>{children}</button>
    );
  }
  return (
    <span className="confirmar-inline" onClick={(e) => e.stopPropagation()}>
      <button className="confirmar-sim" onClick={(e) => { e.stopPropagation(); setArmado(false); onConfirmar(); }}>
        {confirmacao}
      </button>
      <button className="fantasma" onClick={(e) => { e.stopPropagation(); setArmado(false); }}>cancelar</button>
    </span>
  );
}
