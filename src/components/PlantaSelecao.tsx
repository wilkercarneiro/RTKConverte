// Planta + tabela para ESCOLHER pontos de um anel.
//
// É um componente só, usado em dois lugares que pedem a mesma coisa:
//   - confrontante com área certificada: marcar, no CSV do vizinho, os vértices
//     da divisa comum (PlantaCertificada);
//   - glebas: marcar, no perímetro do imóvel, os vértices que formam a gleba e
//     apertar "Dividir gleba" (GlebasEditor).
//
// Clique alterna um ponto; Shift + clique marca a sequência do último ponto
// clicado até este, seguindo a ordem do anel. Quem chama decide o que os pontos
// são, o que a tabela mostra e o que se desenha por cima (glebas já feitas,
// prévia da seleção).
import { useMemo, useRef } from "react";
import type { ReactNode } from "react";

export interface PontoSelecao {
  /** identidade estável (código do vértice, ordem…) — é o que vai no Set de selecionados */
  id: string;
  /** coordenadas planas (E, N) — qualquer plano serve, só desenha */
  x: number;
  y: number;
  /** o que aparece ao lado do ponto no desenho (nº, INDICE) */
  rotulo: string;
  tipo?: "M" | "P" | "V";
  /** tooltip do ponto */
  titulo?: string;
  /** células da linha da tabela, na ordem de `colunas` */
  celulas: ReactNode[];
  /** cor de um ponto já usado em outro lugar (ex.: gleba de outra cor) */
  corFundo?: string;
}

export interface PoligonoSelecao {
  pontos: [number, number][];
  cor: string;
  nome?: string;
  tracejado?: boolean;
}

const COR_SEL = "#0E7A4F";
const COR_PONTO = "#33453C";
const COR_LINHA = "#9FBFAF";

export function PlantaSelecao({
  pontos, colunas, selecionados, onChange, poligonos = [], previa, ligarSelecionados = true,
  ariaLabel, dica, acoes,
}: {
  pontos: PontoSelecao[];
  colunas: string[];
  selecionados: Set<string>;
  onChange: (s: Set<string>) => void;
  /** polígonos desenhados por cima do anel (glebas já montadas) */
  poligonos?: PoligonoSelecao[];
  /** polígono tracejado da seleção atual (prévia da gleba) */
  previa?: [number, number][];
  /** liga em traço grosso dois pontos marcados consecutivos no anel (divisa escolhida) */
  ligarSelecionados?: boolean;
  ariaLabel: string;
  dica?: ReactNode;
  /** botões extras ao lado de "Selecionar todos / Limpar" */
  acoes?: ReactNode;
}) {
  // último ponto clicado: âncora do Shift+clique (sequência ao longo do anel)
  const ultimo = useRef<number | null>(null);

  const geo = useMemo(() => {
    const xs = pontos.map((p) => p.x), ys = pontos.map((p) => p.y);
    for (const pg of poligonos) for (const [x, y] of pg.pontos) { xs.push(x); ys.push(y); }
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const W = 520, H = 440, PAD = 34;
    const esc = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1));
    const offX = (W - (maxX - minX) * esc) / 2, offY = (H - (maxY - minY) * esc) / 2;
    const px = (x: number) => offX + (x - minX) * esc;
    const py = (y: number) => H - offY - (y - minY) * esc; // N cresce p/ cima
    return { px, py, W, H };
  }, [pontos, poligonos]);

  const { px, py, W, H } = geo;
  const n = pontos.length;
  if (n < 3) return null;
  const marcado = (i: number) => selecionados.has(pontos[i].id);

  function alternar(i: number, shift: boolean) {
    const novo = new Set(selecionados);
    if (shift && ultimo.current !== null && ultimo.current !== i) {
      // do último clicado até este, no sentido do anel
      let k = ultimo.current;
      for (let passos = 0; passos <= n; passos++) {
        novo.add(pontos[k].id);
        if (k === i) break;
        k = (k + 1) % n;
      }
    } else if (novo.has(pontos[i].id)) {
      novo.delete(pontos[i].id);
    } else {
      novo.add(pontos[i].id);
    }
    ultimo.current = i;
    onChange(novo);
  }

  const caminho = (ps: [number, number][]) => ps.map((p) => `${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join(" ");
  const anelBase = caminho(pontos.map((p) => [p.x, p.y]));

  return (
    <div className="planta-cert">
      <svg viewBox={`0 0 ${W} ${H}`} role="group" aria-label={ariaLabel}>
        <polygon points={anelBase} fill="rgba(14,122,79,0.05)" stroke={COR_LINHA} strokeWidth={1.5} strokeLinejoin="round" />
        {poligonos.map((pg, k) => pg.pontos.length >= 2 && (
          <g key={`pg${k}`} pointerEvents="none">
            <polygon points={caminho(pg.pontos)} fill={pg.cor} fillOpacity={0.14} stroke={pg.cor} strokeWidth={1.6}
              strokeDasharray={pg.tracejado ? "6 4" : undefined} strokeLinejoin="round" />
            {pg.nome && (() => {
              const cx = pg.pontos.reduce((s, p) => s + px(p[0]), 0) / pg.pontos.length;
              const cy = pg.pontos.reduce((s, p) => s + py(p[1]), 0) / pg.pontos.length;
              return <text x={cx} y={cy} fontSize={11} fontWeight={700} fill={pg.cor} textAnchor="middle">{pg.nome}</text>;
            })()}
          </g>
        ))}
        {previa && previa.length >= 3 && (
          <polygon points={caminho(previa)} fill={COR_SEL} fillOpacity={0.12} stroke={COR_SEL} strokeWidth={2}
            strokeDasharray="7 4" strokeLinejoin="round" pointerEvents="none" />
        )}
        {/* lados entre dois pontos marcados consecutivos no anel: a divisa escolhida */}
        {ligarSelecionados && pontos.map((p, i) => {
          const j = (i + 1) % n;
          if (!marcado(i) || !marcado(j)) return null;
          return <line key={`d${i}`} x1={px(p.x)} y1={py(p.y)} x2={px(pontos[j].x)} y2={py(pontos[j].y)} stroke={COR_SEL} strokeWidth={4} strokeLinecap="round" pointerEvents="none" />;
        })}
        {pontos.map((p, i) => {
          const sel = marcado(i);
          return (
            <g key={p.id} className="ponto" role="checkbox" aria-checked={sel} tabIndex={0}
              aria-label={p.titulo ?? p.rotulo}
              onClick={(e) => alternar(i, e.shiftKey)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); alternar(i, e.shiftKey); } }}>
              {p.titulo && <title>{p.titulo}</title>}
              {/* alvo de clique maior que o ponto */}
              <circle cx={px(p.x)} cy={py(p.y)} r={11} fill="transparent" />
              <circle cx={px(p.x)} cy={py(p.y)} r={sel ? 6 : 4}
                fill={sel ? COR_SEL : p.corFundo ?? (p.tipo === "M" ? COR_PONTO : "#fff")}
                stroke={sel ? "#fff" : COR_PONTO} strokeWidth={sel ? 2 : 1.5} />
              <text x={px(p.x) + 8} y={py(p.y) - 6} fontSize={9.5} fill={sel ? COR_SEL : "#5B6B63"}
                fontWeight={sel ? 700 : 400} fontFamily="Fira Code, monospace">{p.rotulo}</text>
            </g>
          );
        })}
      </svg>

      <div className="lado">
        <div className="acoes-linha">
          <button type="button" onClick={() => onChange(new Set(pontos.map((p) => p.id)))}>Selecionar todos</button>
          <button type="button" className="fantasma" onClick={() => { ultimo.current = null; onChange(new Set()); }}>Limpar</button>
          <span className="sub" style={{ fontSize: 13 }}>{selecionados.size} de {n} ponto(s) escolhido(s)</span>
          {acoes}
        </div>
        <p className="dica">
          {dica ?? <>Clique nos pontos, no desenho ou na lista. <b>Shift + clique</b> marca a sequência do último ponto clicado até este, seguindo a ordem do anel.</>}
        </p>
        <div className="tabela-wrap">
          <table className="tabela-vertices">
            <thead>
              <tr><th></th>{colunas.map((c) => <th key={c}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {pontos.map((p, i) => {
                const sel = marcado(i);
                return (
                  <tr key={p.id} className={sel ? "sel" : ""} onClick={(e) => alternar(i, e.shiftKey)}>
                    <td>
                      <input type="checkbox" checked={sel} aria-label={`Usar ${p.rotulo}`}
                        onClick={(e) => { e.stopPropagation(); alternar(i, e.shiftKey); }} onChange={() => { /* onClick decide */ }} />
                    </td>
                    {p.celulas.map((c, k) => <td key={k} className={typeof c === "string" && /^[\d\s,.\-WSNE]+$/.test(c) ? "mono" : undefined}>{c}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
