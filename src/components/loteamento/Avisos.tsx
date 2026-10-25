// Coluna da esquerda: cada lote fora das medidas do projeto, à vista o tempo
// todo. A edição nunca é bloqueada — o que sai das regras aparece aqui (e em
// vermelho no desenho) até o operador acertar. Clique leva ao lote.
import { fmt } from "../../lib/loteamento/calculo.ts";
import type { Lote, Resultado } from "../../lib/loteamento/calculo.ts";
import { centroLote, chaveDoLote } from "../../lib/loteamento/acoes.ts";
import type { Selecao } from "../../lib/loteamento/acoes.ts";
import type { Parametros } from "../../lib/loteamento/modelo.ts";
import type { Pt } from "../../lib/loteamento/geom.ts";

interface Props {
  res: Resultado;
  params: Parametros;
  sel: Selecao;
  onSel: (s: Selecao) => void;
  onFocar: (p: Pt) => void;
  onFechar: () => void;
}

/** "área 603,62 m² acima do máximo de 500,00 m²" → "Área 603,62 m² (máx. 500 m²)" — curto para a coluna. */
function curto(t: string): string {
  const m = t.match(/^(área|frente|profundidade) ([\d.,]+ m²?) (acima|abaixo) do (máximo|mínimo) de ([\d.,]+) (m²?)/);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]} — ${m[3] === "acima" ? "máx." : "mín."} ${m[5].replace(/,00$/, "")} ${m[6]}`;
  return t[0].toUpperCase() + t.slice(1);
}

export function Avisos({ res, params: p, sel, onSel, onFocar, onFechar }: Props) {
  const ruins = res.lotes.filter((l) => l.problemas.length).sort((a, b) => a.quadra.localeCompare(b.quadra) || a.numero - b.numero);
  const outros = res.problemas.filter((x) => !x.alvo?.lote);
  const selecionado = (l: Lote) => sel?.tipo === "lotes" && sel.chaves.some((c) => c.quadra === l.quadra && c.fileira === l.fileira && Math.abs(c.indice - l.indice) < 1e-9);
  return (
    <aside className="lot-avisos" aria-label="Avisos dos lotes">
      <header>
        <span className={`lot-avisos-cont${ruins.length ? " tem" : ""}`}>{ruins.length}</span>
        <div>
          <h3>{ruins.length ? (ruins.length === 1 ? "Lote fora das medidas" : "Lotes fora das medidas") : "Lotes nas medidas"}</h3>
          <p>frente {fmt(p.frenteMin, 0)}–{fmt(p.frenteMax, 0)} m · fundo {fmt(p.profundidadeMin, 0)}–{fmt(p.profundidadeMax, 0)} m · {fmt(p.areaMin, 0)}–{fmt(p.areaMax, 0)} m² · até 4 quinas</p>
        </div>
        <button className="fantasma" onClick={onFechar} title="Esconder a coluna de avisos">«</button>
      </header>
      {!ruins.length && <p className="lot-avisos-ok">Todos os {res.lotes.length} lotes estão dentro das medidas do projeto.</p>}
      <ul>
        {ruins.map((l) => (
          <li key={l.id} className={selecionado(l) ? "sel" : ""} role="button" tabIndex={0}
            onClick={() => { onSel({ tipo: "lotes", chaves: [chaveDoLote(l)] }); onFocar(centroLote(l)); }}
            onKeyDown={(e) => { if (e.key === "Enter") { onSel({ tipo: "lotes", chaves: [chaveDoLote(l)] }); onFocar(centroLote(l)); } }}>
            <b>⚠ Lote {l.id}</b>
            <span className="lot-avisos-med">{l.frente > 0.05 ? `${fmt(l.frente)} m × ${fmt(l.profundidade)} m · ` : "sem frente · "}{fmt(l.area)} m²</span>
            {l.problemas.map((t) => <span key={t} className="lot-avisos-txt">{curto(t)}</span>)}
          </li>
        ))}
      </ul>
      {outros.length > 0 && (
        <details className="lot-avisos-outros">
          <summary>{outros.length} outra{outros.length === 1 ? "" : "s"} pendência{outros.length === 1 ? "" : "s"} (quadras, metas, ruas)</summary>
          <ul>{outros.slice(0, 30).map((x, i) => <li key={i} className={x.nivel}>{x.texto}</li>)}</ul>
        </details>
      )}
    </aside>
  );
}
