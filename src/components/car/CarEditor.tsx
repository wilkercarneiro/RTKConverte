// Prancheta do CAR: o imóvel sobre o satélite, com a reserva legal, a APP e a
// área produtiva coloridas. Desenha no plano de cálculo (metros, Albers do
// imóvel) e grava em grau no projeto.
//
// Ferramentas:
//   mover    — seleciona reserva ou rio, arrasta vértice, arrasta o fundo (pan)
//   lado     — clica num lado do perímetro: a reserva vira a faixa encostada nele
//   reserva  — desenha um polígono de reserva (o que sair do imóvel é cortado)
//   rio      — traça a linha do rio; a APP é a faixa dos dois lados
// Duplo clique numa aresta do item selecionado insere vértice; num vértice, apaga.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent, WheelEvent as RWheelEvent } from "react";
import { caixa, dentroPol, dist, distPolilinha, distSegmento } from "../../lib/loteamento/geom.ts";
import type { Anel, Poligono, Pt } from "../../lib/loteamento/geom.ts";
import type { ProjetoCar, ResultadoCar } from "../../lib/car/motor.ts";
import { fmtNum } from "../../lib/car/motor.ts";
import type { LonLat } from "../../lib/car/kml.ts";

export type FerramentaCar = "mover" | "lado" | "reserva" | "rio";
export type SelecaoCar = { tipo: "reserva"; i: number } | { tipo: "rio"; id: string } | null;

interface Props {
  projeto: ProjetoCar;
  res: ResultadoCar;
  ferramenta: FerramentaCar;
  onFerramenta: (f: FerramentaCar) => void;
  sel: SelecaoCar;
  onSel: (s: SelecaoCar) => void;
  /** transiente = durante o arraste (não entra no desfazer) */
  onMudar: (pr: ProjetoCar, transiente?: boolean) => void;
  onFimArraste: () => void;
  onLado: (lado: number) => void;
  satelite: boolean;
  onMsg: (m: string) => void;
}

interface Vista { cx: number; cy: number; s: number }

type Arraste =
  | { tipo: "pan"; x0: number; y0: number; v0: Vista; moveu: boolean }
  | { tipo: "vertice"; alvo: Alvo; j: number };

/** O que tem vértice editável: um polígono da reserva ou um rio. */
type Alvo = { tipo: "reserva"; i: number } | { tipo: "rio"; id: string };

export const COR = { imovel: "#F5C542", reserva: "#2E9E5B", produtiva: "#E8A33D", app: "#3B8BD9", rio: "#1565C0" };

const TOL = 10; // px

function pathPol(p: Poligono): string {
  const r = (a: Anel) => "M" + a.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L") + "Z";
  return r(p.ext) + p.furos.map(r).join("");
}
const pathLinha = (l: Pt[]) => "M" + l.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L");

export function CarEditor({ projeto, res, ferramenta, onFerramenta, sel, onSel, onMudar, onFimArraste, onLado, satelite, onMsg }: Props) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ w: 900, h: 600 });
  const [v, setV] = useState<Vista | null>(null);
  const [mouse, setMouse] = useState<Pt | null>(null);
  const [desenho, setDesenho] = useState<Pt[]>([]);
  const [ladoHover, setLadoHover] = useState<number | null>(null);
  const arraste = useRef<Arraste | null>(null);
  const shift = useRef(false);
  const pl = res.plano;

  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setTam({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const enquadrar = useCallback(() => {
    const { min, max } = caixa(res.imovel.ext);
    const m = 0.1;
    const s = Math.min(tam.w / ((max[0] - min[0]) * (1 + 2 * m) || 1), tam.h / ((max[1] - min[1]) * (1 + 2 * m) || 1));
    setV({ cx: (min[0] + max[0]) / 2, cy: (min[1] + max[1]) / 2, s });
  }, [tam, res.imovel]);
  useEffect(() => { if (!v && tam.w > 50) enquadrar(); }, [tam, v, enquadrar]);
  useEffect(() => { setDesenho([]); }, [ferramenta]);

  const vv = v ?? { cx: 0, cy: 0, s: 1 };
  const W = tam.w, H = tam.h;
  const tela = useCallback((p: Pt): Pt => [(p[0] - vv.cx) * vv.s + W / 2, H / 2 - (p[1] - vv.cy) * vv.s], [vv.cx, vv.cy, vv.s, W, H]);
  const mundo = useCallback((x: number, y: number): Pt => [(x - W / 2) / vv.s + vv.cx, (H / 2 - y) / vv.s + vv.cy], [vv.cx, vv.cy, vv.s, W, H]);
  const matriz = `matrix(${vv.s} 0 0 ${-vv.s} ${W / 2 - vv.cx * vv.s} ${H / 2 + vv.cy * vv.s})`;

  // ---------------- satélite (tiles da Esri, sem chave) ----------------
  const tiles = useMemo(() => {
    if (!satelite || !v) return [];
    const [, lat0] = pl.de([vv.cx, vv.cy]);
    // 18 é o último nível com imagem em quase todo o interior do Brasil
    const z = Math.max(3, Math.min(18, Math.round(Math.log2(156543.03 * Math.cos((lat0 * Math.PI) / 180) * vv.s))));
    const n = 2 ** z;
    const tx = (lon: number) => ((lon + 180) / 360) * n;
    const ty = (lat: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    const cantos = [mundo(0, 0), mundo(W, 0), mundo(0, H), mundo(W, H)].map(pl.de);
    const xs = cantos.map((c) => tx(c[0])), ys = cantos.map((c) => ty(c[1]));
    const x0 = Math.floor(Math.min(...xs)), x1 = Math.floor(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.floor(Math.max(...ys));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) return [];
    const lonDe = (x: number) => (x / n) * 360 - 180;
    const latDe = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const out: { k: string; href: string; m: string }[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const no = tela(pl.para([lonDe(x), latDe(y)])), ne = tela(pl.para([lonDe(x + 1), latDe(y)])), so = tela(pl.para([lonDe(x), latDe(y + 1)]));
      out.push({
        k: `${z}/${x}/${y}`,
        href: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        m: `matrix(${ne[0] - no[0]} ${ne[1] - no[1]} ${so[0] - no[0]} ${so[1] - no[1]} ${no[0]} ${no[1]})`,
      });
    }
    return out;
  }, [satelite, v, vv.cx, vv.cy, vv.s, W, H, pl, tela, mundo]);

  // ---------------- geometria editável no plano ----------------
  const reservasPlano = useMemo(() => projeto.reserva.poligonos.map((p) => p.ext.map(pl.para)), [projeto.reserva.poligonos, pl]);
  const riosPlano = useMemo(() => projeto.rios.map((r) => ({ id: r.id, nome: r.nome, faixa: r.faixa, l: r.linha.map(pl.para) })), [projeto.rios, pl]);

  const pontosDe = useCallback((a: Alvo): Pt[] =>
    a.tipo === "reserva" ? reservasPlano[a.i] ?? [] : riosPlano.find((r) => r.id === a.id)?.l ?? [], [reservasPlano, riosPlano]);
  const fechadoDe = (a: Alvo) => a.tipo === "reserva";

  /** grava os pontos (plano) de volta no projeto, em grau */
  const gravar = useCallback((a: Alvo, pts: Pt[], transiente = false) => {
    const geo = pts.map(pl.de) as LonLat[];
    if (a.tipo === "reserva") {
      const poligonos = projeto.reserva.poligonos.map((p, i) => (i === a.i ? { ext: geo, furos: [] } : p));
      onMudar({ ...projeto, reserva: { ...projeto.reserva, poligonos, lado: null } }, transiente);
    } else {
      onMudar({ ...projeto, rios: projeto.rios.map((r) => (r.id === a.id ? { ...r, linha: geo } : r)) }, transiente);
    }
  }, [projeto, onMudar, pl]);

  // ---------------- encaixe ----------------
  const encaixar = useCallback((p: Pt, ignorar?: Pt): Pt => {
    if (shift.current) return p;
    const tolM = TOL / vv.s;
    let melhor: Pt | null = null, dm = tolM;
    const testar = (q: Pt) => { if (ignorar && dist(q, ignorar) < 1e-6) return; const d = dist(p, q); if (d < dm) { dm = d; melhor = q; } };
    for (const q of res.imovel.ext) testar(q);
    for (const r of reservasPlano) for (const q of r) testar(q);
    for (const r of riosPlano) for (const q of r.l) testar(q);
    for (const q of desenho) testar(q);
    if (melhor) return melhor;
    // sobre o lado do perímetro
    const anel = res.imovel.ext;
    let lado: Pt | null = null, dl = tolM * 0.8;
    for (let i = 0; i < anel.length; i++) {
      const a = anel[i], b = anel[(i + 1) % anel.length];
      const { d, t } = distSegmento(p, a, b);
      if (d < dl) { dl = d; lado = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
    }
    return lado ?? p;
  }, [vv.s, res.imovel, reservasPlano, riosPlano, desenho]);

  const ladoPerto = useCallback((p: Pt): number | null => {
    const anel = res.imovel.ext;
    let melhor: number | null = null, dm = (TOL * 1.4) / vv.s;
    for (let i = 0; i < anel.length; i++) {
      const d = distSegmento(p, anel[i], anel[(i + 1) % anel.length]).d;
      if (d < dm) { dm = d; melhor = i; }
    }
    return melhor;
  }, [res.imovel, vv.s]);

  /** vértice do item selecionado sob o cursor */
  const verticePerto = useCallback((p: Pt): { alvo: Alvo; j: number } | null => {
    if (!sel) return null;
    const pts = pontosDe(sel);
    const tolM = TOL / vv.s;
    let j = -1, dm = tolM;
    pts.forEach((q, k) => { const d = dist(p, q); if (d < dm) { dm = d; j = k; } });
    return j >= 0 ? { alvo: sel, j } : null;
  }, [sel, pontosDe, vv.s]);

  const itemEm = useCallback((p: Pt): SelecaoCar => {
    const tolM = TOL / vv.s;
    for (const r of riosPlano) if (r.l.length >= 2 && distPolilinha(p, r.l) < tolM) return { tipo: "rio", id: r.id };
    for (let i = reservasPlano.length - 1; i >= 0; i--) {
      if (reservasPlano[i].length >= 3 && dentroPol(p, { ext: reservasPlano[i], furos: [] })) return { tipo: "reserva", i };
    }
    return null;
  }, [riosPlano, reservasPlano, vv.s]);

  // ---------------- desenho ----------------
  const concluir = useCallback((brutos: Pt[]) => {
    // o duplo clique que conclui marca o mesmo ponto duas vezes
    const pts = brutos.filter((q, k) => k === 0 || dist(q, brutos[k - 1]) > 2 / vv.s);
    if (ferramenta === "reserva") {
      if (pts.length < 3) { onMsg("A reserva precisa de ao menos 3 pontos."); return; }
      const poligonos = [...projeto.reserva.poligonos, { ext: pts.map(pl.de) as LonLat[], furos: [] }];
      onMudar({ ...projeto, reserva: { ...projeto.reserva, poligonos, lado: null } });
      onSel({ tipo: "reserva", i: poligonos.length - 1 });
      onMsg("Reserva desenhada. O que passou do imóvel foi cortado. Use “Ajustar à %” para chegar à porcentagem exata.");
    } else if (ferramenta === "rio") {
      if (pts.length < 2) { onMsg("O rio precisa de ao menos 2 pontos."); return; }
      const n = projeto.rios.length + 1;
      const id = `rio-${Date.now().toString(36)}`;
      onMudar({ ...projeto, rios: [...projeto.rios, { id, nome: `Rio ${n}`, linha: pts.map(pl.de) as LonLat[], faixa: 30 }] });
      onSel({ tipo: "rio", id });
      onMsg("Rio traçado com APP de 30 m de cada margem. Ajuste a faixa no painel ao lado.");
    }
    setDesenho([]);
    onFerramenta("mover");
  }, [ferramenta, projeto, onMudar, onSel, onMsg, onFerramenta, pl, vv.s]);

  useEffect(() => {
    const baixo = (e: KeyboardEvent) => {
      if (e.key === "Shift") shift.current = true;
      const alvo = e.target as HTMLElement;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT")) return;
      if (e.key === "Escape") { setDesenho([]); if (ferramenta !== "mover") onFerramenta("mover"); else onSel(null); }
      else if (e.key === "Enter" && desenho.length) { e.preventDefault(); concluir(desenho); }
      else if (e.key === "Backspace" && desenho.length) { e.preventDefault(); setDesenho(desenho.slice(0, -1)); }
    };
    const cima = (e: KeyboardEvent) => { if (e.key === "Shift") shift.current = false; };
    addEventListener("keydown", baixo);
    addEventListener("keyup", cima);
    return () => { removeEventListener("keydown", baixo); removeEventListener("keyup", cima); };
  }, [desenho, ferramenta, concluir, onFerramenta, onSel]);

  // ---------------- ponteiro ----------------
  const pos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = caixaRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function onDown(e: RPointerEvent) {
    const [x, y] = pos(e);
    const p = mundo(x, y);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (e.button === 1 || e.button === 2) { arraste.current = { tipo: "pan", x0: x, y0: y, v0: vv, moveu: false }; return; }
    if (ferramenta === "reserva" || ferramenta === "rio") {
      const q = encaixar(p);
      // clicar no 1º ponto fecha o polígono da reserva
      if (ferramenta === "reserva" && desenho.length >= 3 && dist(q, desenho[0]) < TOL / vv.s) { concluir(desenho); return; }
      setDesenho([...desenho, q]);
      return;
    }
    if (ferramenta === "lado") {
      const l = ladoPerto(p);
      if (l !== null) onLado(l);
      else onMsg("Clique perto de um lado do perímetro (a linha amarela).");
      return;
    }
    const vt = verticePerto(p);
    if (vt) { arraste.current = { tipo: "vertice", alvo: vt.alvo, j: vt.j }; return; }
    arraste.current = { tipo: "pan", x0: x, y0: y, v0: vv, moveu: false };
  }

  function onMove(e: RPointerEvent) {
    const [x, y] = pos(e);
    const p = mundo(x, y);
    setMouse(p);
    if (ferramenta === "lado") setLadoHover(ladoPerto(p));
    const a = arraste.current;
    if (!a) return;
    if (a.tipo === "pan") {
      const dx = x - a.x0, dy = y - a.y0;
      if (Math.abs(dx) + Math.abs(dy) > 3) a.moveu = true;
      setV({ ...a.v0, cx: a.v0.cx - dx / a.v0.s, cy: a.v0.cy + dy / a.v0.s });
    } else {
      const pts = [...pontosDe(a.alvo)];
      pts[a.j] = encaixar(p, pts[a.j]);
      gravar(a.alvo, pts, true);
    }
  }

  function onUp(e: RPointerEvent) {
    const a = arraste.current;
    arraste.current = null;
    if (!a) return;
    if (a.tipo === "vertice") { onFimArraste(); return; }
    if (!a.moveu && ferramenta === "mover" && e.button === 0) onSel(itemEm(mundo(...pos(e))));
  }

  function onDbl(e: React.MouseEvent) {
    const p = mundo(...pos(e));
    if (ferramenta === "reserva" || ferramenta === "rio") {
      // os dois cliques do duplo clique já marcaram o ponto uma vez
      concluir(desenho);
      return;
    }
    if (ferramenta !== "mover" || !sel) return;
    const pts = pontosDe(sel);
    const vt = verticePerto(p);
    if (vt) {
      if (pts.length <= (fechadoDe(sel) ? 3 : 2)) { onMsg("Com menos pontos o item deixa de existir — apague-o pelo painel."); return; }
      gravar(sel, pts.filter((_, k) => k !== vt.j));
      return;
    }
    const n = fechadoDe(sel) ? pts.length : pts.length - 1;
    let melhor = -1, dm = TOL / vv.s;
    for (let k = 0; k < n; k++) {
      const d = distSegmento(p, pts[k], pts[(k + 1) % pts.length]).d;
      if (d < dm) { dm = d; melhor = k; }
    }
    if (melhor >= 0) gravar(sel, [...pts.slice(0, melhor + 1), p, ...pts.slice(melhor + 1)]);
  }

  function onWheel(e: RWheelEvent) {
    const [x, y] = pos(e);
    const p = mundo(x, y);
    const k = Math.exp(-e.deltaY * 0.0015);
    const s = Math.max(0.005, Math.min(400, vv.s * k));
    // o ponto sob o cursor fica parado
    setV({ s, cx: p[0] - (x - W / 2) / s, cy: p[1] + (y - H / 2) / s });
  }

  // ---------------- desenho do SVG ----------------
  const selPts = sel ? pontosDe(sel) : [];
  const cursor = ferramenta === "mover" ? (arraste.current?.tipo === "pan" ? "grabbing" : "default") : "crosshair";
  const previa = desenho.length && mouse ? [...desenho, encaixar(mouse)] : desenho;
  const anel = res.imovel.ext;

  return (
    <div className="car-prancheta" ref={caixaRef} style={{ cursor }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onDbl}
      onWheel={onWheel} onContextMenu={(e) => e.preventDefault()} onPointerLeave={() => setMouse(null)}>
      <svg width={W} height={H}>
        {tiles.map((t) => <image key={t.k} href={t.href} width={1} height={1} preserveAspectRatio="none" transform={t.m} />)}
        <g transform={matriz}>
          <path d={pathPol(res.imovel)} fill={satelite ? "rgba(255,255,255,0.06)" : "#F3F1EA"} stroke="none" />
          {res.produtiva.map((p, i) => <path key={`p${i}`} d={pathPol(p)} fill={COR.produtiva} fillOpacity={0.28} stroke="none" />)}
          {res.reserva.map((p, i) => <path key={`r${i}`} d={pathPol(p)} fill={COR.reserva} fillOpacity={0.5} stroke={COR.reserva} strokeWidth={2} vectorEffect="non-scaling-stroke" />)}
          {res.app.map((p, i) => <path key={`a${i}`} d={pathPol(p)} fill={COR.app} fillOpacity={0.45} stroke={COR.app} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
          <path d={pathPol(res.imovel)} fill="none" stroke={COR.imovel} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          {/* contorno dos polígonos de reserva como foram desenhados (podem passar do imóvel) */}
          {reservasPlano.map((r, i) => r.length >= 3 && (
            <path key={`rd${i}`} d={pathLinha(r) + "Z"} fill="none" stroke={sel?.tipo === "reserva" && sel.i === i ? "#fff" : COR.reserva}
              strokeDasharray="6 4" strokeWidth={sel?.tipo === "reserva" && sel.i === i ? 2 : 1} vectorEffect="non-scaling-stroke" opacity={0.9} />
          ))}
          {riosPlano.map((r) => r.l.length >= 2 && (
            <path key={r.id} d={pathLinha(r.l)} fill="none" stroke={sel?.tipo === "rio" && sel.id === r.id ? "#fff" : COR.rio}
              strokeWidth={sel?.tipo === "rio" && sel.id === r.id ? 4 : 3} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          ))}
          {ferramenta === "lado" && ladoHover !== null && (
            <path d={pathLinha([anel[ladoHover], anel[(ladoHover + 1) % anel.length]])} stroke="#fff" strokeWidth={6} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          )}
          {previa.length > 0 && (
            <path d={pathLinha(previa) + (ferramenta === "reserva" && previa.length > 2 ? "Z" : "")}
              fill={ferramenta === "reserva" ? COR.reserva : "none"} fillOpacity={0.25}
              stroke={ferramenta === "reserva" ? "#fff" : COR.rio} strokeWidth={ferramenta === "rio" ? 3 : 2} strokeDasharray={ferramenta === "reserva" ? "5 4" : undefined}
              vectorEffect="non-scaling-stroke" />
          )}
        </g>
        {/* nomes e alças em coordenadas de tela (tamanho fixo) */}
        {riosPlano.map((r) => {
          if (r.l.length < 2) return null;
          const m = tela(r.l[Math.floor((r.l.length - 1) / 2)]);
          return <text key={`t${r.id}`} x={m[0]} y={m[1] - 8} className="car-rotulo">{r.nome} · APP {fmtNum(r.faixa, 0)} m</text>;
        })}
        {selPts.map((q, k) => { const t = tela(q); return <circle key={k} cx={t[0]} cy={t[1]} r={5} className="car-alca" />; })}
        {desenho.map((q, k) => { const t = tela(q); return <circle key={`d${k}`} cx={t[0]} cy={t[1]} r={k === 0 ? 6 : 4} className="car-alca desenho" />; })}
      </svg>
      <div className="car-escala">
        {ferramenta === "reserva" && "Clique para marcar os pontos da reserva · clique no 1º ponto, Enter ou duplo clique fecha · Backspace volta · Shift solta o encaixe"}
        {ferramenta === "rio" && "Clique ao longo do rio · Enter ou duplo clique termina · Backspace volta · Esc cancela"}
        {ferramenta === "lado" && "Clique no lado do imóvel onde a reserva vai encostar"}
        {ferramenta === "mover" && (sel ? "Arraste os vértices · duplo clique na linha insere vértice, no vértice apaga" : "Clique na reserva ou num rio para editar · arraste para mover o mapa · roda do mouse aproxima")}
      </div>
      <button className="car-enquadrar" title="Enquadrar o imóvel" onPointerDown={(e) => e.stopPropagation()} onClick={enquadrar}>⤢</button>
    </div>
  );
}
