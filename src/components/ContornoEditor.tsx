// "Ajustar pontos" da etapa Glebas: o contorno como ligações entre pontos.
//
// Clique num ponto para escolher; Ctrl+clique soma à escolha. Com ponto
// escolhido: Excluir (Delete) tira o ponto e liga os dois vizinhos, "Ligar a
// outro ponto" (L) cria a ligação com o próximo ponto clicado, "Tirar as
// ligações" solta o ponto. Clique numa linha para escolher a ligação e
// "Tirar a ligação". As áreas fechadas pelas ligações são as glebas —
// ver src/lib/contorno.ts. Roda do mouse aproxima, arrastar o fundo move.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Vertice } from "../lib/types";
import { desligar, excluirPonto, ligar, type Areas, type Ligacao } from "../lib/contorno";
import { Dica } from "./ui";

const CORES = ["#2E86AB", "#E07A1F", "#3BA55C", "#A23B72", "#C9A227", "#5B5FC7", "#D1495B", "#1B998B"];

interface Props {
  vertices: Vertice[];
  ligacoes: Ligacao[];
  areas: Areas;
  nomes: string[];
  onLigacoes: (ls: Ligacao[]) => void;
  onDesfazer?: () => void;
  podeDesfazer?: boolean;
  onRecomecar: () => void;
}

type Escolha = { tipo: "pontos"; ordens: number[] } | { tipo: "ligacao"; l: Ligacao } | null;

export function ContornoEditor({ vertices, ligacoes, areas, nomes, onLigacoes, onDesfazer, podeDesfazer, onRecomecar }: Props) {
  const pts = useMemo(() => vertices.filter((v) => v.e !== null && v.n !== null)
    .map((v) => ({ o: v.ordem, e: Number(v.e), n: Number(v.n), rot: String(v.num_txt ?? v.ordem + 1), tipo: v.tipo })), [vertices]);
  const xy = useMemo(() => new Map(pts.map((p) => [p.o, p])), [pts]);
  const caixa = useMemo(() => {
    const es = pts.map((p) => p.e), ns = pts.map((p) => p.n);
    const x0 = Math.min(...es), x1 = Math.max(...es), y0 = Math.min(...ns), y1 = Math.max(...ns);
    const m = Math.max(x1 - x0, y1 - y0) * 0.06 || 10;
    return { x: x0 - m, y: -(y1 + m), w: x1 - x0 + 2 * m, h: y1 - y0 + 2 * m };
  }, [pts]);
  const [vb, setVb] = useState(caixa);
  useEffect(() => setVb(caixa), [caixa]);
  const escala = vb.w / 900; // metros por pixel, aproximado
  const [esc, setEsc] = useState<Escolha>(null);
  const [ligando, setLigando] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const arraste = useRef<{ x: number; y: number; vb: typeof vb; moveu: boolean } | null>(null);

  const emPonto = useMemo(() => {
    const m = new Map<number, number>();
    areas.aneis.forEach((a, k) => a.forEach((o) => { if (!m.has(o)) m.set(o, k); }));
    return m;
  }, [areas]);
  const problema = useMemo(() => new Set([...areas.pontas]), [areas]);

  const escolhidos = esc?.tipo === "pontos" ? esc.ordens : [];
  const um = escolhidos.length === 1 ? escolhidos[0] : null;
  const rot = (o: number) => xy.get(o)?.rot ?? String(o + 1);

  const clicarPonto = (o: number, multi: boolean) => {
    if (ligando && um !== null && o !== um) {
      onLigacoes(ligar(ligacoes, um, o));
      setLigando(false);
      setEsc({ tipo: "pontos", ordens: [o] });
      return;
    }
    setLigando(false);
    if (multi && esc?.tipo === "pontos") {
      setEsc({ tipo: "pontos", ordens: esc.ordens.includes(o) ? esc.ordens.filter((x) => x !== o) : [...esc.ordens, o] });
    } else setEsc({ tipo: "pontos", ordens: [o] });
  };
  const excluir = (unir: boolean) => {
    let ls = ligacoes;
    for (const o of escolhidos) ls = excluirPonto(ls, o, unir);
    onLigacoes(ls);
    setEsc(null);
  };
  const soltar = () => {
    onLigacoes(ligacoes.filter(([a, b]) => !escolhidos.includes(a) && !escolhidos.includes(b)));
    setEsc(null);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (!svgRef.current?.matches(":hover") && !esc) return;
      if (e.key === "Escape") { setLigando(false); setEsc(null); }
      else if (e.key === "Delete" && escolhidos.length) { e.preventDefault(); excluir(true); }
      else if (e.key === "Delete" && esc?.tipo === "ligacao") { e.preventDefault(); onLigacoes(desligar(ligacoes, ...esc.l)); setEsc(null); }
      else if (e.key.toLowerCase() === "l" && um !== null) setLigando(true);
    };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  });

  // roda do mouse aproxima no cursor
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      const f = e.deltaY < 0 ? 0.8 : 1.25;
      setVb((v) => {
        const w = Math.min(caixa.w * 1.5, Math.max(5, v.w * f)), hh = (w / v.w) * v.h;
        return { x: v.x + (v.w - w) * fx, y: v.y + (v.h - hh) * fy, w, h: hh };
      });
    };
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, [caixa]);

  const pr = (o: number) => { const p = xy.get(o)!; return [p.e, -p.n] as const; };
  const raio = 5 * escala;

  return (
    <div className="ct-editor">
      <div className="ct-barra">
        {um !== null && !ligando && <b>Ponto {rot(um)}</b>}
        {escolhidos.length > 1 && <b>{escolhidos.length} pontos</b>}
        {esc?.tipo === "ligacao" && <b>Ligação {rot(esc.l[0])} – {rot(esc.l[1])}</b>}
        {ligando && <b className="ct-ligando">Clique no ponto que vai ligar ao {rot(um!)} (Esc cancela)</b>}
        {escolhidos.length > 0 && !ligando && <>
          <button type="button" onClick={() => excluir(true)} title="Delete">Excluir e unir os vizinhos</button>
          <button type="button" onClick={() => excluir(false)}>Excluir sem unir</button>
          {um !== null && <button type="button" onClick={() => setLigando(true)} title="L">Ligar a outro ponto</button>}
          <button type="button" onClick={soltar}>Tirar as ligações</button>
        </>}
        {esc?.tipo === "ligacao" && <button type="button" onClick={() => { onLigacoes(desligar(ligacoes, ...esc.l)); setEsc(null); }} title="Delete">Tirar a ligação</button>}
        <span className="esticar" />
        <button type="button" className="fantasma" disabled={!podeDesfazer} onClick={onDesfazer} title="Ctrl+Z">↶ Desfazer</button>
        <button type="button" className="fantasma" onClick={() => { onRecomecar(); setEsc(null); setLigando(false); }}>Recomeçar</button>
        <button type="button" className="fantasma" onClick={() => setVb(caixa)}>Enquadrar</button>
        <Dica>Clique num ponto para escolher (Ctrl+clique soma vários). <b>Excluir e unir os vizinhos</b> (Delete) tira o ponto e fecha o contorno ligando os dois pontos do lado; <b>Excluir sem unir</b> deixa aberto para você ligar à mão. <b>Ligar a outro ponto</b> (L) cria a linha até o próximo ponto clicado — uma linha de um lado ao outro do imóvel é a divisa entre duas glebas. Clique numa linha e <b>Tirar a ligação</b> para soltar. Cada área fechada vira uma gleba. Ponto sem ligação sai do serviço ao salvar. Roda do mouse aproxima; arrastar o fundo move.</Dica>
      </div>
      <svg ref={svgRef} className={`ct-svg${ligando ? " ligando" : ""}`} viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid meet"
        onPointerDown={(e) => { arraste.current = { x: e.clientX, y: e.clientY, vb, moveu: false }; }}
        onPointerMove={(e) => {
          const a = arraste.current;
          if (!a || !(e.buttons & 1)) return;
          const r = svgRef.current!.getBoundingClientRect();
          const k = Math.max(a.vb.w / r.width, a.vb.h / r.height);
          const dx = (e.clientX - a.x) * k, dy = (e.clientY - a.y) * k;
          if (Math.abs(e.clientX - a.x) + Math.abs(e.clientY - a.y) > 3) a.moveu = true;
          if (a.moveu) setVb({ ...a.vb, x: a.vb.x - dx, y: a.vb.y - dy });
        }}
        onPointerUp={(e) => {
          const a = arraste.current;
          arraste.current = null;
          if (a && !a.moveu && e.target === svgRef.current) { setEsc(null); setLigando(false); }
        }}>
        {areas.aneis.map((a, k) => {
          const anel = a.map((o) => xy.get(o)!);
          const cx = anel.reduce((s, p) => s + p.e, 0) / anel.length, cy = anel.reduce((s, p) => s + p.n, 0) / anel.length;
          return (
            <g key={k}>
              <polygon points={anel.map((p) => `${p.e},${-p.n}`).join(" ")} fill={CORES[k % CORES.length]} fillOpacity={0.16} stroke="none" />
              <text x={cx} y={-cy} fontSize={14 * escala} textAnchor="middle" className="ct-rotulo-area" strokeWidth={3 * escala}>
                {nomes[k] ?? `PARTE ${k + 1}`}
              </text>
            </g>
          );
        })}
        {ligacoes.map(([a, b]) => {
          if (!xy.has(a) || !xy.has(b)) return null;
          const [x1, y1] = pr(a), [x2, y2] = pr(b);
          const sel = esc?.tipo === "ligacao" && ((esc.l[0] === a && esc.l[1] === b) || (esc.l[0] === b && esc.l[1] === a));
          const cruzada = areas.cruzadas.some(([p, q]) => [p, q].some(([u, v]) => (u === a && v === b) || (u === b && v === a)));
          return (
            <g key={`${a}-${b}`} className="ct-ligacao" onPointerUp={(e) => { const mov = arraste.current?.moveu; arraste.current = null; e.stopPropagation(); if (!mov) { setLigando(false); setEsc({ tipo: "ligacao", l: [a, b] }); } }}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={10 * escala} />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={sel ? "#0E3B2B" : cruzada ? "#D92D20" : "#33413A"} strokeWidth={(sel ? 3.2 : 1.6) * escala}
                strokeDasharray={cruzada ? `${6 * escala} ${4 * escala}` : undefined} />
            </g>
          );
        })}
        {pts.map((p) => {
          const sel = escolhidos.includes(p.o);
          const solto = !ligacoes.some(([a, b]) => a === p.o || b === p.o);
          const k = emPonto.get(p.o);
          return (
            <g key={p.o} className="ct-ponto" onPointerUp={(e) => { const mov = arraste.current?.moveu; arraste.current = null; e.stopPropagation(); if (!mov) { clicarPonto(p.o, e.ctrlKey || e.metaKey || e.shiftKey); } }}>
              <circle cx={p.e} cy={-p.n} r={raio * 2.2} fill="transparent" />
              <circle cx={p.e} cy={-p.n} r={sel ? raio * 1.5 : raio}
                fill={solto ? "#fff" : problema.has(p.o) ? "#D92D20" : k !== undefined ? CORES[k % CORES.length] : "#8A978F"}
                stroke={sel ? "#0E3B2B" : solto ? "#8A978F" : "#fff"} strokeWidth={(sel ? 2.4 : 1.2) * escala} />
              {(vb.w / caixa.w < 0.6 || sel || pts.length <= 60) && (
                <text x={p.e + raio * 1.4} y={-p.n - raio * 1.2} fontSize={11 * escala} className="ct-rotulo">{p.rot}</text>
              )}
            </g>
          );
        })}
      </svg>
      {/* só o que pede atenção: as áreas e os nomes estão na tabela de baixo */}
      {(areas.pontas.length > 0 || areas.cruzadas.length > 0 || areas.soltos.length > 0 || !areas.aneis.length) && (
      <div className="ct-situacao">
        {!areas.aneis.length && <span className="ct-alerta">Nenhuma área fechada: ligue os pontos para fechar o contorno</span>}
        {areas.pontas.length > 0 && <span className="ct-alerta">Contorno aberto nos pontos {areas.pontas.slice(0, 10).map(rot).join(", ")}{areas.pontas.length > 10 ? "…" : ""}: ligue-os ou exclua</span>}
        {areas.cruzadas.length > 0 && <span className="ct-alerta">{areas.cruzadas.length} {areas.cruzadas.length === 1 ? "ligação se cruza" : "ligações se cruzam"} (tracejadas em vermelho)</span>}
        {areas.soltos.length > 0 && <span className="ct-aviso">{areas.soltos.length} {areas.soltos.length === 1 ? "ponto sem ligação sai" : "pontos sem ligação saem"} do serviço ao salvar ({areas.soltos.slice(0, 10).map(rot).join(", ")}{areas.soltos.length > 10 ? "…" : ""})</span>}
      </div>
      )}
    </div>
  );
}
