// Primitivas de interface compartilhadas pelas telas.
//
// Divulgação progressiva (Secao), o cartão de próxima ação (ProximaAcao), a
// trilha de etapas navegável (Passos), avisos flutuantes (Avisos), indicador de
// autossalvamento (StatusSalvamento) e confirmação inline (BotaoPerigo).
import { useEffect, useState, type ReactNode } from "react";
import type { AvisoItem, EstadoSalvamento } from "../lib/ux";

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
        <span className="secao-seta" aria-hidden="true">▸</span>
        <span className="secao-titulo">{titulo}</span>
        {selo != null && <span className="secao-selo">{selo}</span>}
        {dica && <span className="secao-dica">{dica}</span>}
      </summary>
      <div className="secao-corpo">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// ProximaAcao — o que fazer agora
// ---------------------------------------------------------------------------

export interface Acao {
  titulo: string;
  detalhe?: string;
  rotuloBotao?: string;
  onClick?: () => void;
  tom?: "neutro" | "pendente" | "pronto";
}

/**
 * Uma tela longa não deve exigir que o operador descubra sozinho em que ponto
 * do processo está. Este cartão responde "e agora?" em uma frase.
 */
export function ProximaAcao({ acao }: { acao: Acao }) {
  return (
    <div className={`proxima-acao ${acao.tom ?? "neutro"}`}>
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
// Passos — trilha de etapas navegável
// ---------------------------------------------------------------------------

export interface Passo {
  rotulo: string;
  estado: "feita" | "ativa" | "futura";
  /** id do elemento a rolar até; ausente = passo não navegável */
  alvo?: string;
}

export function Passos({ passos }: { passos: Passo[] }) {
  return (
    <nav className="stepper" aria-label="Etapas do serviço">
      {passos.map((p, i) => {
        const classe = `step ${p.estado === "feita" ? "feita" : p.estado === "ativa" ? "ativa" : ""}`;
        const num = p.estado === "feita" ? "✓" : String(i + 1);
        return (
          <span key={p.rotulo} style={{ display: "inline-flex", alignItems: "center" }}>
            {i > 0 && <span className="step-seta" aria-hidden="true">→</span>}
            {p.alvo ? (
              <button className={`${classe} step-botao`} onClick={() => irPara(p.alvo!)}
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
          <span aria-hidden="true">{a.tom === "ok" ? "✓" : a.tom === "erro" ? "✕" : "⚠"}</span>
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
    : "alterações salvas automaticamente";
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
export function BotaoPerigo({ titulo, confirmacao, onConfirmar, children }: {
  titulo: string;
  confirmacao: string;
  onConfirmar: () => void;
  children: ReactNode;
}) {
  const [armado, setArmado] = useState(false);
  if (!armado) {
    return (
      <button className="remover" title={titulo}
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
