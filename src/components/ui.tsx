// Primitivas de interface compartilhadas pelas telas.
//
// Divulgação progressiva (Secao), a faixa de próxima ação (ProximaAcao), as
// abas de etapa (Passos), avisos flutuantes (Avisos), indicador de
// autossalvamento (StatusSalvamento) e confirmação inline (BotaoPerigo).
import { useEffect, useState, type ReactNode } from "react";
import type { AvisoItem, EstadoSalvamento } from "../lib/ux";
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
export function Passos({ passos, onClick }: { passos: Passo[]; onClick?: (passo: Passo, indice: number) => void }) {
  return (
    <nav className="stepper" aria-label="Etapas do serviço">
      {passos.map((p, i) => {
        const classe = `step ${p.estado === "feita" ? "feita" : p.estado === "ativa" ? "ativa" : ""}`;
        const num = p.estado === "feita" ? "✓" : String(i + 1);
        const navegavel = onClick ? true : !!p.alvo;
        return (
          <span key={p.rotulo} style={{ display: "inline-flex", alignItems: "center" }}>
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

export function Avisos({ avisos, onFechar }: { avisos: AvisoItem[]; onFechar: (id: number) => void }) {
  if (avisos.length === 0) return null;
  return (
    <div className="avisos" role="status" aria-live="polite">
      {avisos.map((a) => (
        <div key={a.id} className={`aviso ${a.tom}`}>
          <span aria-hidden="true">{a.tom === "ok" ? "✓" : a.tom === "erro" ? "✕" : "!"}</span>
          <span className="aviso-texto">{a.texto}</span>
          <button className="aviso-fechar" onClick={() => onFechar(a.id)} aria-label="Fechar aviso">✕</button>
        </div>
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
