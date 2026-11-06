// O mapa de corte e aterro: arrastar e girar a roda move a vista; com a
// plataforma em retângulo, arrastar por dentro move e os cantos mudam o
// tamanho; "Desenhar" traça uma plataforma nova; "Seção" põe o cruzamento das
// seções onde se clicar. O número de qualquer ponto aparece ao passar o mouse.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ResultadoTerraplanagem } from "../../lib/terraplanagem/calculo.ts";
import { fmtN } from "../../lib/terraplanagem/calculo.ts";
import type { Pt } from "../../lib/terraplanagem/geometria.ts";
import { cantosDoRetangulo, dentro, doAzimute } from "../../lib/terraplanagem/geometria.ts";
import type { Retangulo } from "../../lib/terraplanagem/modelo.ts";
import type { Vista } from "../../lib/terraplanagem/desenho.ts";
import { CORES, desenharMapa, desenharMoldura, enquadrar, paraTela, paraTerreno, telaDaMalha } from "../../lib/terraplanagem/desenho.ts";
import { pontoNoElemento, zoomDaPagina } from "../../lib/zoom";
import { BotaoTelaCheia } from "../TelaCheia";
import { GiroMapa } from "../ui";

export type Ferramenta = "mover" | "desenhar" | "secao";

type Arraste =
  | { tipo: "vista"; x: number; y: number; v: Vista; moveu: boolean }
  | { tipo: "mover"; ini: Pt; r: Retangulo }
  | { tipo: "canto"; oposto: Pt; r: Retangulo }
  | { tipo: "desenho"; ini: Pt; giro: number };

export function MapaTerraplanagem({ resultado, pontos, focoNaPlataforma = false, retangulo, editavel, ferramenta, onFerramenta, onRetangulo, onSecao, ocupado, secaoAtiva }: {
  resultado: ResultadoTerraplanagem | null;
  pontos: Pt[];
  /** enquadra a plataforma e o talude (retângulo, KML) em vez do levantamento inteiro */
  focoNaPlataforma?: boolean;
  /** retângulo da plataforma (o desenho segue o dedo antes do cálculo voltar) */
  retangulo: Retangulo | null;
  /** a plataforma é um retângulo que dá para arrastar */
  editavel: boolean;
  ferramenta: Ferramenta;
  onFerramenta: (f: Ferramenta) => void;
  onRetangulo: (r: Retangulo, fim: boolean) => void;
  onSecao: (centro: Pt) => void;
  ocupado: boolean;
  secaoAtiva: string | null;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tam, setTam] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const vista = useRef<Vista | null>(null);
  const [, redesenhar] = useState(0);
  const arraste = useRef<Arraste | null>(null);
  const [leitura, setLeitura] = useState<{ x: number; y: number; texto: string[] } | null>(null);
  const tela = useMemo(() => (resultado ? telaDaMalha(resultado) : null), [resultado]);

  // tamanho
  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // enquadra quando o terreno muda (outro levantamento) ou o tamanho muda muito
  const chaveContorno = resultado ? `${resultado.contorno.length}:${resultado.contorno[0]?.join(",")}:${focoNaPlataforma}` : "";
  const enquadrarAgora = useCallback((tudo = false) => {
    if (!resultado || !tam.w || !tam.h) return;
    let alvo = resultado.contorno;
    if (focoNaPlataforma && !tudo) {
      // a plataforma, o talude e uma folga de vizinhança (metade do tamanho dela)
      const pts = [...resultado.plataforma, ...resultado.crista.flat(), ...resultado.pe.flat()];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const f = Math.max(10, 0.22 * Math.max(x1 - x0, y1 - y0));
      alvo = [[x0 - f, y0 - f], [x1 + f, y1 + f]];
    }
    vista.current = enquadrar(alvo, tam.w, tam.h, Math.min(48, tam.w * 0.06));
    redesenhar((n) => n + 1);
  }, [resultado, tam.w, tam.h, focoNaPlataforma]);
  useEffect(() => { enquadrarAgora(); }, [chaveContorno, tam.w, tam.h]); // eslint-disable-line react-hooks/exhaustive-deps

  // desenho
  useEffect(() => {
    const c = canvasRef.current, v = vista.current;
    if (!c || !tam.w || !tam.h) return;
    const k = (window.devicePixelRatio || 1) * zoomDaPagina();
    if (c.width !== Math.round(tam.w * k) || c.height !== Math.round(tam.h * k)) { c.width = Math.round(tam.w * k); c.height = Math.round(tam.h * k); }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    if (!resultado || !v) { ctx.clearRect(0, 0, tam.w, tam.h); return; }
    desenharMapa(ctx, resultado, v, tam.w, tam.h, pontos, { secaoAtiva }, tela ?? undefined);
    // a plataforma que está sendo arrastada (o cálculo ainda não voltou)
    if (retangulo && editavel) {
      const cantos = cantosDoRetangulo(retangulo.centro, retangulo.largura, retangulo.comprimento, retangulo.giro);
      const iguais = resultado.plataforma.length === 4 && cantos.every((q) => resultado.plataforma.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.01));
      ctx.save();
      ctx.lineWidth = 2; ctx.strokeStyle = CORES.plataforma; ctx.setLineDash(iguais ? [] : [6, 4]);
      ctx.fillStyle = iguais ? "transparent" : "rgba(14, 59, 43, 0.08)";
      ctx.beginPath();
      cantos.forEach((q, i) => { const [x, y] = paraTela(v, q); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.setLineDash([]);
      for (const q of cantos) {
        const [x, y] = paraTela(v, q);
        ctx.fillStyle = "#fff"; ctx.strokeStyle = CORES.plataforma; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(x - 6, y - 6, 12, 12); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }
    desenharMoldura(ctx, v, tam.w, tam.h);
  });

  const noMundo = (e: { clientX: number; clientY: number }): { tela: Pt; mundo: Pt } | null => {
    const c = canvasRef.current, v = vista.current;
    if (!c || !v) return null;
    const q = pontoNoElemento(c, e) as Pt;
    return { tela: q, mundo: paraTerreno(v, q) };
  };

  const cantos = retangulo ? cantosDoRetangulo(retangulo.centro, retangulo.largura, retangulo.comprimento, retangulo.giro) : null;

  const baixar = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const m = noMundo(e);
    const v = vista.current;
    if (!m || !v) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (ferramenta === "desenhar") {
      arraste.current = { tipo: "desenho", ini: m.mundo, giro: retangulo?.giro ?? resultado?.retangulo.giro ?? 0 };
      return;
    }
    if (ferramenta === "secao") { onSecao(m.mundo); onFerramenta("mover"); return; }
    if (editavel && retangulo && cantos) {
      const i = cantos.findIndex((q) => { const [x, y] = paraTela(v, q); return Math.hypot(x - m.tela[0], y - m.tela[1]) < 14; });
      if (i >= 0) { arraste.current = { tipo: "canto", oposto: cantos[(i + 2) % 4], r: retangulo }; return; }
      if (dentro(m.mundo, cantos)) { arraste.current = { tipo: "mover", ini: m.mundo, r: retangulo }; return; }
    }
    arraste.current = { tipo: "vista", x: m.tela[0], y: m.tela[1], v: { ...v }, moveu: false };
  };

  const retDe = (a: Pt, b: Pt, giro: number): Retangulo => {
    const u = doAzimute(giro), w: Pt = [-u[1], u[0]];
    const du = (b[0] - a[0]) * u[0] + (b[1] - a[1]) * u[1], dv = (b[0] - a[0]) * w[0] + (b[1] - a[1]) * w[1];
    const comprimento = Math.max(2, Math.abs(du)), largura = Math.max(2, Math.abs(dv));
    const su = du < 0 ? -1 : 1, sv = dv < 0 ? -1 : 1;
    return { centro: [a[0] + u[0] * su * comprimento / 2 + w[0] * sv * largura / 2, a[1] + u[1] * su * comprimento / 2 + w[1] * sv * largura / 2], comprimento, largura, giro };
  };
  const arred = (r: Retangulo): Retangulo => ({ ...r, largura: Math.round(r.largura * 10) / 10, comprimento: Math.round(r.comprimento * 10) / 10, centro: [Math.round(r.centro[0] * 100) / 100, Math.round(r.centro[1] * 100) / 100] });

  const mover = (e: React.PointerEvent) => {
    const m = noMundo(e);
    if (!m) return;
    const a = arraste.current;
    if (!a) { mostrarLeitura(m); return; }
    if (a.tipo === "vista") {
      const dx = m.tela[0] - a.x, dy = m.tela[1] - a.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) a.moveu = true;
      vista.current = { ...a.v, e: a.v.e - dx / a.v.escala, n: a.v.n + dy / a.v.escala };
      redesenhar((n) => n + 1);
      return;
    }
    if (a.tipo === "mover") {
      const r = { ...a.r, centro: [a.r.centro[0] + m.mundo[0] - a.ini[0], a.r.centro[1] + m.mundo[1] - a.ini[1]] as Pt };
      onRetangulo(arred(r), false);
      return;
    }
    if (a.tipo === "canto") { onRetangulo(arred(retDe(a.oposto, m.mundo, a.r.giro)), false); return; }
    if (a.tipo === "desenho") onRetangulo(arred(retDe(a.ini, m.mundo, a.giro)), false);
  };

  const soltar = (e: React.PointerEvent) => {
    const a = arraste.current;
    arraste.current = null;
    const m = noMundo(e);
    if (!a || !m) return;
    if (a.tipo === "mover" || a.tipo === "canto") onRetangulo(arred(retangulo ?? a.r), true);
    if (a.tipo === "desenho") {
      const r = retDe(a.ini, m.mundo, a.giro);
      if (r.comprimento > 2.5 && r.largura > 2.5) onRetangulo(arred(r), true);
      onFerramenta("mover");
    }
  };

  const mostrarLeitura = (m: { tela: Pt; mundo: Pt }) => {
    if (!resultado) return;
    const { e0, n0, passo, nx, ny, terreno, projeto, altura } = resultado.malha;
    const i = Math.round((m.mundo[0] - e0) / passo), j = Math.round((m.mundo[1] - n0) / passo);
    if (i < 0 || j < 0 || i >= nx || j >= ny) { setLeitura(null); return; }
    const k = j * nx + i, t = terreno[k];
    if (!(t === t)) { setLeitura(null); return; }
    const h = altura[k];
    setLeitura({
      x: m.tela[0], y: m.tela[1],
      texto: [
        `Terreno ${fmtN(t, 2)} m · Projeto ${fmtN(projeto[k], 2)} m`,
        Math.abs(h) < 0.005 ? "Sem obra" : h > 0 ? `Corte ${fmtN(h, 2)} m` : `Aterro ${fmtN(-h, 2)} m`,
      ],
    });
  };

  // roda: aproxima em volta do cursor (listener nativo para poder impedir a rolagem da página)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const roda = (e: WheelEvent) => {
      const v = vista.current;
      if (!v) return;
      e.preventDefault();
      const q = pontoNoElemento(c, e) as Pt;
      const antes = paraTerreno(v, q);
      const f = Math.exp(-e.deltaY * 0.0015);
      const escala = Math.max(0.05, Math.min(80, v.escala * f));
      vista.current = { escala, e: antes[0] - q[0] / escala, n: antes[1] + q[1] / escala };
      redesenhar((n) => n + 1);
    };
    c.addEventListener("wheel", roda, { passive: false });
    return () => c.removeEventListener("wheel", roda);
  }, []);

  const cursor = ferramenta !== "mover" ? "crosshair" : arraste.current?.tipo === "vista" ? "grabbing" : "grab";

  return (
    <div className="tp-mapa" ref={caixaRef}>
      <canvas ref={canvasRef} style={{ cursor, touchAction: "none" }} aria-label="Mapa de corte e aterro"
        onPointerDown={baixar} onPointerMove={mover} onPointerUp={soltar} onPointerCancel={() => { arraste.current = null; }}
        onPointerLeave={() => setLeitura(null)} onDoubleClick={() => enquadrarAgora()} />
      <div className="tp-mapa-ferramentas" role="toolbar" aria-label="Ferramentas do mapa">
        <button type="button" className={ferramenta === "mover" ? "ativa" : ""} onClick={() => onFerramenta("mover")} title="Arraste para mover o mapa; roda do mouse aproxima">Mover</button>
        <button type="button" className={ferramenta === "desenhar" ? "ativa" : ""} onClick={() => onFerramenta(ferramenta === "desenhar" ? "mover" : "desenhar")}
          title="Arraste no mapa para desenhar a plataforma (retângulo)">Desenhar plataforma</button>
        <button type="button" className={ferramenta === "secao" ? "ativa" : ""} onClick={() => onFerramenta(ferramenta === "secao" ? "mover" : "secao")}
          title="Clique no mapa para passar as seções por ali">Seção aqui</button>
        <button type="button" onClick={() => enquadrarAgora(true)} title="Ver o levantamento inteiro (dois cliques no mapa voltam para a plataforma)">Ver tudo</button>
        <BotaoTelaCheia onAlternar={() => setTimeout(() => enquadrarAgora(), 120)} />
      </div>
      {ferramenta !== "mover" && (
        <div className="tp-mapa-dica" role="status">
          {ferramenta === "desenhar" ? "Arraste no mapa do canto ao canto oposto da plataforma." : "Clique onde as seções devem se cruzar."}
          <button type="button" className="fantasma" onClick={() => onFerramenta("mover")}>cancelar</button>
        </div>
      )}
      {editavel && retangulo && (
        <div className="tp-mapa-giro">
          <GiroMapa rotulo="Giro" valor={retangulo.giro} min={0} max={180} passo={0.5}
            onGiro={(g) => onRetangulo({ ...retangulo, giro: g }, false)} onFim={() => onRetangulo(retangulo, true)} />
        </div>
      )}
      <ul className="tp-legenda" aria-label="Legenda">
        <li><i className="faixa corte" />Corte</li>
        <li><i className="faixa aterro" />Aterro</li>
        <li><i className="linha plataforma" />Plataforma</li>
        <li><i className="linha crista" />Crista</li>
        <li><i className="linha pe" />Pé</li>
        <li><i className="linha passagem" />Passagem</li>
      </ul>
      {ocupado && <span className="tp-mapa-calc" role="status"><span className="spinner" /> calculando…</span>}
      {leitura && !arraste.current && (
        <div className="tp-leitura" style={{ left: Math.min(leitura.x + 14, tam.w - 230), top: Math.max(8, leitura.y - 54) }}>
          {leitura.texto.map((t) => <span key={t}>{t}</span>)}
        </div>
      )}
    </div>
  );
}
