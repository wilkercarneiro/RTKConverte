// Prancheta do loteamento: o desenho que o operador manipula.
//
// SVG puro, sem biblioteca de CAD: a geometria vai num grupo com a matriz
// mundo→tela (y para cima, como na UTM) e os textos são posicionados em pixels
// para não sair espelhados. Tudo o que muda o projeto vira uma ação de
// `acoes.ts`; durante um arraste a mudança é "transiente" (recalcula a cada
// movimento, mas só entra no desfazer quando o botão é solto).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent, WheelEvent as RWheelEvent } from "react";
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import { caixa, centroide, dentroPol, dist, distSegmento, dot, esquerda, sub, unit } from "../../lib/loteamento/geom.ts";
import type { Anel, Poligono, Pt } from "../../lib/loteamento/geom.ts";
import type { Corte, Lote, Quadra, Resultado } from "../../lib/loteamento/calculo.ts";
import { fmt } from "../../lib/loteamento/calculo.ts";
import { paraPlano, paraUtm } from "../../lib/loteamento/plano.ts";
import { cotaEm } from "../../lib/loteamento/terreno.ts";
import type { Projeto } from "../../lib/loteamento/modelo.ts";
import {
  adicionarArea, adicionarRua, chaveDoLote, editarRua, lotesDaSelecao, moverCorte, moverFundo, quadraDe,
} from "../../lib/loteamento/acoes.ts";
import type { Ferramenta, Selecao } from "../../lib/loteamento/acoes.ts";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

export interface OpcoesVista {
  satelite: boolean;
  medidas: boolean;
  cores: "situacao" | "area" | "relevo";
}

interface Props {
  projeto: Projeto;
  res: Resultado;
  fuso: number;
  sel: Selecao;
  onSel: (s: Selecao) => void;
  ferramenta: Ferramenta;
  onFerramenta: (f: Ferramenta) => void;
  /** transiente = durante um arraste (não entra no desfazer) */
  onMudar: (pr: Projeto, transiente?: boolean) => void;
  onFimArraste: () => void;
  vista: OpcoesVista;
  /** pedido externo de foco (comando "ir") */
  focar: { pt: Pt; n: number } | null;
  onMsg: (m: string) => void;
}

interface Vista { cx: number; cy: number; s: number }

type Arraste =
  | { tipo: "pan"; x0: number; y0: number; v0: Vista; moveu: boolean }
  | { tipo: "corte"; corte: Corte; pr0: Projeto; res0: Resultado }
  | { tipo: "fundo"; quadra: Quadra; pr0: Projeto; res0: Resultado }
  | { tipo: "vertice"; rua: string; i: number; pr0: Projeto; inserir: boolean };

const COR_LOTE = "#FFFDF5";

const ultimoPonto = (d: Pt[], q: Pt, tol: number) => d.length > 0 && dist(d[d.length - 1], q) < tol;

function pathPol(p: Poligono): string {
  const r = (a: Anel) => "M" + a.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L") + "Z";
  return r(p.ext) + p.furos.map(r).join("");
}

/** Cor hipsométrica: baixada em azul-esverdeado, alto em terra. */
function corPorCota(h: number, min: number, max: number): string {
  const t = max > min ? Math.max(0, Math.min(1, (h - min) / (max - min))) : 0.5;
  return `hsl(${190 - 160 * t} ${45 + 20 * t}% ${78 - 18 * t}%)`;
}

/** Cor do lote pelo tamanho (do menor ao maior), para enxergar a variação de área. */
function corPorArea(a: number, min: number, max: number): string {
  const t = max > min ? Math.max(0, Math.min(1, (a - min) / (max - min))) : 0.5;
  const h = 48 - 40 * t, l = 92 - 22 * t;
  return `hsl(${h} 85% ${l}%)`;
}

export function Editor({ projeto, res, fuso, sel, onSel, ferramenta, onFerramenta, onMudar, onFimArraste, vista, focar, onMsg }: Props) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ w: 900, h: 600 });
  const [v, setV] = useState<Vista | null>(null);
  const [mouse, setMouse] = useState<Pt | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [desenho, setDesenho] = useState<Pt[]>([]);
  const [snap, setSnap] = useState<Pt | null>(null);
  const arraste = useRef<Arraste | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const shift = useRef(false);

  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTam({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setTam({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const enquadrar = useCallback((pts: Pt[], margem = 0.08) => {
    const { min, max } = caixa(pts);
    const s = Math.min(tam.w / ((max[0] - min[0]) * (1 + 2 * margem) || 1), tam.h / ((max[1] - min[1]) * (1 + 2 * margem) || 1));
    setV({ cx: (min[0] + max[0]) / 2, cy: (min[1] + max[1]) / 2, s });
  }, [tam]);

  // primeira vista: a gleba inteira
  useEffect(() => { if (!v && tam.w > 50) enquadrar(res.gleba.ext); }, [tam, v, res.gleba, enquadrar]);
  useEffect(() => {
    if (!focar || !v) return;
    setV({ cx: focar.pt[0], cy: focar.pt[1], s: Math.max(v.s, 4) });
  }, [focar]); // eslint-disable-line react-hooks/exhaustive-deps

  // ferramenta trocada: o desenho em andamento é descartado
  useEffect(() => { setDesenho([]); }, [ferramenta]);

  const vv = v ?? { cx: 0, cy: 0, s: 1 };
  const W = tam.w, H = tam.h;
  const tela = useCallback((p: Pt): Pt => [(p[0] - vv.cx) * vv.s + W / 2, H / 2 - (p[1] - vv.cy) * vv.s], [vv.cx, vv.cy, vv.s, W, H]);
  const mundo = useCallback((x: number, y: number): Pt => [(x - W / 2) / vv.s + vv.cx, (H / 2 - y) / vv.s + vv.cy], [vv.cx, vv.cy, vv.s, W, H]);
  const matriz = `matrix(${vv.s} 0 0 ${-vv.s} ${W / 2 - vv.cx * vv.s} ${H / 2 + vv.cy * vv.s})`;

  // ---------------- dados derivados para o desenho ----------------
  const lotesSel = useMemo(() => lotesDaSelecao(res, sel), [res, sel]);
  const idsSel = useMemo(() => new Set(lotesSel.map((l) => l.id)), [lotesSel]);
  const quadraAtiva: Quadra | undefined = sel?.tipo === "quadra" ? quadraDe(res, sel.nome)
    : lotesSel.length ? quadraDe(res, lotesSel[0].quadra) : undefined;
  const faixaArea = useMemo(() => {
    const as = res.lotes.map((l) => l.area);
    return { min: Math.min(...as), max: Math.max(...as) };
  }, [res.lotes]);
  const pathsLotes = useMemo(() => res.lotes.map((l) => ({ l, d: pathPol(l.pol) })), [res.lotes]);
  // cota no centro de cada lote (relevo do projeto), para a vista "relevo"
  const cotas = useMemo(() => {
    const g = projeto.terreno;
    if (!g || vista.cores !== "relevo") return null;
    const m = new Map<string, number>();
    for (const l of res.lotes) m.set(l.id, cotaEm(g, paraUtm(res.plano, centroide(l.pol.ext))));
    const vs = [...m.values()];
    return { m, min: Math.min(...vs), max: Math.max(...vs) };
  }, [projeto.terreno, vista.cores, res.lotes, res.plano]);

  // ---------------- satélite (tiles da Esri, sem chave) ----------------
  const tiles = useMemo(() => {
    if (!vista.satelite || !v) return [];
    const ud = utmDef(fuso);
    const P2G = (p: Pt) => proj(ud, GEO_DEF, paraUtm(res.plano, p));
    const G2P = (lon: number, lat: number) => paraPlano(res.plano, proj(GEO_DEF, ud, [lon, lat]));
    const [lon0, lat0] = P2G([vv.cx, vv.cy]);
    // 18 é o último nível com imagem em quase todo o interior do Brasil; acima disso a Esri devolve "sem dados"
    const z = Math.max(3, Math.min(18, Math.round(Math.log2(156543.03 * Math.cos((lat0 * Math.PI) / 180) * vv.s))));
    const n = 2 ** z;
    const tx = (lon: number) => ((lon + 180) / 360) * n;
    const ty = (lat: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
    const cantos = [mundo(0, 0), mundo(W, 0), mundo(0, H), mundo(W, H)].map(P2G);
    const xs = cantos.map((c) => tx(c[0])), ys = cantos.map((c) => ty(c[1]));
    const x0 = Math.floor(Math.min(...xs)), x1 = Math.floor(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.floor(Math.max(...ys));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 80) return [];
    const lonDe = (x: number) => (x / n) * 360 - 180;
    const latDe = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const out: { k: string; href: string; m: string }[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const no = tela(G2P(lonDe(x), latDe(y))), ne = tela(G2P(lonDe(x + 1), latDe(y))), so = tela(G2P(lonDe(x), latDe(y + 1)));
      out.push({
        k: `${z}/${x}/${y}`,
        href: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        m: `matrix(${ne[0] - no[0]} ${ne[1] - no[1]} ${so[0] - no[0]} ${so[1] - no[1]} ${no[0]} ${no[1]})`,
      });
    }
    return out;
  }, [vista.satelite, v, vv.cx, vv.cy, vv.s, W, H, fuso, res.plano, tela, mundo]);

  // ---------------- encaixe (snap) ----------------
  const encaixar = useCallback((p: Pt, ancora?: Pt): Pt => {
    const tolM = 10 / vv.s;
    let melhor: Pt | null = null, dm = tolM;
    const testar = (q: Pt) => { const d = dist(p, q); if (d < dm) { dm = d; melhor = q; } };
    // perto do cursor (caixa da tolerância) — quinas de tudo o que já está traçado
    const caixaM = Math.max(60, 2 * tolM);
    const perto = (pol: { ext: Pt[] }) => pol.ext.some((q) => Math.abs(q[0] - p[0]) < caixaM && Math.abs(q[1] - p[1]) < caixaM);
    res.gleba.ext.forEach(testar);
    for (const r of res.ruas) { r.eixo.forEach(testar); for (const pg of r.pols) if (perto(pg)) pg.ext.forEach(testar); }
    for (const l of res.lotes) if (perto(l.pol)) l.pol.ext.forEach(testar);
    for (const q of res.quadras) if (perto(q.pol)) q.pol.ext.forEach(testar);
    for (const a of res.areas) for (const pg of a.pols) if (perto(pg)) pg.ext.forEach(testar);
    if (melhor) { setSnap(melhor); return melhor; }
    // ortogonal à direção principal (Shift)
    if (shift.current && ancora) {
      const u: Pt = [Math.cos(res.ms), Math.sin(res.ms)];
      const w = esquerda(u);
      const d = sub(p, ancora);
      const cands: Pt[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        cands.push(unit([u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a)]));
      }
      const dir = cands.reduce((m, c) => (dot(c, d) > dot(m, d) ? c : m), cands[0]);
      const q: Pt = [ancora[0] + dir[0] * dot(dir, d), ancora[1] + dir[1] * dot(dir, d)];
      setSnap(null);
      return q;
    }
    // sobre um eixo ou a divisa
    const tolL = 7 / vv.s;
    let proj2: Pt | null = null, dl = tolL;
    const fechar = (e: Pt[]) => [...e, e[0]];
    // caixa do polígono (com a tolerância) contém o cursor: a linha pode passar por ele
    const pertoL = (e: Pt[]) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const q of e) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); } return p[0] >= x0 - tolL && p[0] <= x1 + tolL && p[1] >= y0 - tolL && p[1] <= y1 + tolL; };
    const linhas: Pt[][] = [
      ...res.ruas.map((r) => r.eixo), fechar(res.gleba.ext),
      // divisas dos lotes e bordas das quadras e áreas: o ponto cai sobre a linha
      ...res.lotes.filter((l) => pertoL(l.pol.ext)).map((l) => fechar(l.pol.ext)),
      ...res.quadras.filter((q) => pertoL(q.pol.ext)).map((q) => fechar(q.pol.ext)),
      ...res.areas.flatMap((a) => a.pols).filter((pg) => pertoL(pg.ext)).map((pg) => fechar(pg.ext)),
    ];
    for (const l of linhas) for (let i = 0; i + 1 < l.length; i++) {
      const { d, t } = distSegmento(p, l[i], l[i + 1]);
      if (d < dl) { dl = d; proj2 = [l[i][0] + (l[i + 1][0] - l[i][0]) * t, l[i][1] + (l[i + 1][1] - l[i][1]) * t]; }
    }
    setSnap(proj2);
    return proj2 ?? p;
  }, [res, vv.s]);

  // ---------------- teclado ----------------
  const terminar = useCallback(() => {
    if (ferramenta === "rua" && desenho.length >= 2) {
      const { pr, id } = adicionarRua(projeto, desenho.map((q) => paraUtm(res.plano, q)));
      onMudar(pr);
      onSel({ tipo: "rua", id });
      onMsg("Rua criada — quadras e lotes refeitos. Arraste os pontos do eixo para ajustar.");
    } else if (ferramenta === "area" && desenho.length >= 3) {
      const { pr, id } = adicionarArea(projeto, desenho.map((q) => paraUtm(res.plano, q)), "verde");
      onMudar(pr);
      onSel({ tipo: "area", id });
      onMsg("Área verde criada. Mude o tipo no painel ou digite: institucional / lazer.");
    }
    setDesenho([]);
    onFerramenta("selecionar");
  }, [ferramenta, desenho, projeto, res.plano, onMudar, onSel, onMsg, onFerramenta]);

  useEffect(() => {
    const dn = (e: KeyboardEvent) => {
      shift.current = e.shiftKey;
      const alvo = e.target as HTMLElement;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT")) return;
      if (e.key === "Enter" && desenho.length) { e.preventDefault(); terminar(); }
      else if (e.key === "Escape") { setDesenho([]); onFerramenta("selecionar"); onSel(null); }
      else if (e.key === "Backspace" && desenho.length) { e.preventDefault(); setDesenho((d) => d.slice(0, -1)); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "r") onFerramenta("rua");
        else if (k === "a") onFerramenta("area");
        else if (k === "m") onFerramenta("medir");
        else if (k === "s" || k === "v") onFerramenta("selecionar");
        else if (k === "f") enquadrar(res.gleba.ext);
      }
    };
    const up = (e: KeyboardEvent) => { shift.current = e.shiftKey; };
    addEventListener("keydown", dn);
    addEventListener("keyup", up);
    return () => { removeEventListener("keydown", dn); removeEventListener("keyup", up); };
  }, [desenho, terminar, onFerramenta, onSel, enquadrar, res.gleba]);

  // ---------------- ponteiro ----------------
  const pos = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = caixaRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  function alvoNoPonto(p: Pt): { tipo: "lote"; l: Lote } | { tipo: "area"; id: string } | { tipo: "rua"; id: string } | null {
    for (const l of res.lotes) {
      const b = l.pol.ext;
      if (dentroPol(p, l.pol) && b.length) return { tipo: "lote", l };
    }
    for (const a of res.areas) if (a.pols.some((x) => dentroPol(p, x))) return { tipo: "area", id: a.id };
    let rua: string | null = null, dm = Infinity;
    for (const r of res.ruas) {
      if (!r.pols.some((x) => dentroPol(p, x))) continue;
      for (let i = 0; i + 1 < r.eixo.length; i++) {
        const d = distSegmento(p, r.eixo[i], r.eixo[i + 1]).d;
        if (d < dm) { dm = d; rua = r.id; }
      }
    }
    return rua ? { tipo: "rua", id: rua } : null;
  }

  /** Alças ativas (em coordenadas de tela) para o clique/arraste. */
  const alcas = useMemo(() => {
    const out: { x: number; y: number; acao: Arraste; titulo: string; forma: "corte" | "fundo" | "vertice" | "mais" }[] = [];
    if (!v) return out;
    if (quadraAtiva) {
      for (const c of quadraAtiva.cortes) {
        if (!c.arrastavel) continue;
        const m: Pt = [(c.a[0] + c.b[0]) / 2, (c.a[1] + c.b[1]) / 2];
        // a alça fica na metade do corte que toca a rua (onde o operador olha a frente)
        const alvo: Pt = dot(sub(c.a, quadraAtiva.origem), quadraAtiva.v) < dot(sub(c.b, quadraAtiva.origem), quadraAtiva.v) === (c.fileira === 0) ? c.a : c.b;
        const pt = tela([(m[0] * 2 + alvo[0]) / 3, (m[1] * 2 + alvo[1]) / 3]);
        out.push({ x: pt[0], y: pt[1], acao: { tipo: "corte", corte: c, pr0: projeto, res0: res }, titulo: "Arraste para mudar a frente — os lotes seguintes se ajustam", forma: "corte" });
      }
      if (quadraAtiva.fundo) {
        const f = quadraAtiva.fundo;
        const pt = tela([(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2]);
        out.push({ x: pt[0], y: pt[1], acao: { tipo: "fundo", quadra: quadraAtiva, pr0: projeto, res0: res }, titulo: "Arraste para mover a linha de fundo", forma: "fundo" });
      }
    }
    if (sel?.tipo === "rua") {
      const r = res.ruas.find((x) => x.id === sel.id);
      if (r) {
        r.eixo.forEach((q, i) => { const pt = tela(q); out.push({ x: pt[0], y: pt[1], acao: { tipo: "vertice", rua: r.id, i, pr0: projeto, inserir: false }, titulo: "Arraste o ponto do eixo", forma: "vertice" }); });
        for (let i = 0; i + 1 < r.eixo.length; i++) {
          const pt = tela([(r.eixo[i][0] + r.eixo[i + 1][0]) / 2, (r.eixo[i][1] + r.eixo[i + 1][1]) / 2]);
          out.push({ x: pt[0], y: pt[1], acao: { tipo: "vertice", rua: r.id, i: i + 1, pr0: projeto, inserir: true }, titulo: "Arraste para dobrar a rua", forma: "mais" });
        }
      }
    }
    return out;
  }, [v, quadraAtiva, sel, res, projeto, tela]);

  function onDown(e: RPointerEvent) {
    if (!v) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const [x, y] = pos(e);
    const p = mundo(x, y);
    if (e.button === 1 || e.button === 2) { arraste.current = { tipo: "pan", x0: x, y0: y, v0: vv, moveu: true }; setArrastando(true); return; }
    if (ferramenta === "rua" || ferramenta === "area") {
      const q = encaixar(p, desenho[desenho.length - 1]);
      // o 2º clique do duplo clique repete o ponto: quem termina é o onDoubleClick
      if (ultimoPonto(desenho, q, 3 / vv.s)) return;
      setDesenho((d) => [...d, q]);
      return;
    }
    if (ferramenta === "medir") {
      const q = encaixar(p);
      setDesenho((d) => (d.length >= 2 ? [q] : [...d, q]));
      return;
    }
    const alca = alcas.find((a) => Math.hypot(a.x - x, a.y - y) <= 9);
    if (alca) { arraste.current = alca.acao; setArrastando(true); return; }
    arraste.current = { tipo: "pan", x0: x, y0: y, v0: vv, moveu: false };
  }

  const raf = useRef(0);
  const pendente = useRef<(() => void) | null>(null);
  function onMove(e: RPointerEvent) {
    if (!v) return;
    shift.current = e.shiftKey;
    const [x, y] = pos(e);
    const p = mundo(x, y);
    setMouse(p);
    const a = arraste.current;
    if (!a) {
      if (ferramenta !== "selecionar") encaixar(p, desenho[desenho.length - 1]);
      else {
        const alvo = alvoNoPonto(p);
        setHover(alvo?.tipo === "lote" ? alvo.l.id : alvo?.tipo === "area" || alvo?.tipo === "rua" ? alvo.id : null);
      }
      return;
    }
    if (a.tipo === "pan") {
      if (Math.hypot(x - a.x0, y - a.y0) > 3) a.moveu = true;
      if (a.moveu) setV({ ...a.v0, cx: a.v0.cx - (x - a.x0) / a.v0.s, cy: a.v0.cy + (y - a.y0) / a.v0.s });
      return;
    }
    cancelAnimationFrame(raf.current);
    // a última mudança do arraste fica pendente até o próximo quadro; ao soltar
    // ela é aplicada antes de fechar o arraste (soltar rápido não a perde)
    pendente.current = () => {
      if (a.tipo === "corte") onMudar(moverCorte(a.pr0, a.res0, a.corte, p), true);
      else if (a.tipo === "fundo") onMudar(moverFundo(a.pr0, a.res0, a.quadra, p), true);
      else if (a.tipo === "vertice") {
        const r = a.pr0.ruas.find((x2) => x2.id === a.rua);
        if (!r) return;
        const q = paraUtm(res.plano, encaixar(p));
        const eixo = r.eixo.slice();
        if (a.inserir) eixo.splice(a.i, 0, q); else eixo[a.i] = q;
        onMudar(editarRua(a.pr0, a.rua, { eixo }), true);
      }
    };
    raf.current = requestAnimationFrame(() => { pendente.current?.(); pendente.current = null; });
  }

  function onUp(e: RPointerEvent) {
    const a = arraste.current;
    arraste.current = null;
    setArrastando(false);
    setSnap(null);
    if (!a) return;
    if (a.tipo !== "pan") {
      cancelAnimationFrame(raf.current);
      pendente.current?.();
      pendente.current = null;
    }
    if (a.tipo === "pan") {
      if (a.moveu) return;
      // clique simples: seleção
      const [x, y] = pos(e);
      const alvo = alvoNoPonto(mundo(x, y));
      if (!alvo) { onSel(null); return; }
      if (alvo.tipo === "lote") {
        if (e.shiftKey && sel?.tipo === "lotes") {
          const ja = sel.chaves.some((c) => c.quadra === alvo.l.quadra && c.fileira === alvo.l.fileira && c.indice === alvo.l.indice);
          onSel({ tipo: "lotes", chaves: ja ? sel.chaves.filter((c) => !(c.quadra === alvo.l.quadra && c.fileira === alvo.l.fileira && c.indice === alvo.l.indice)) : [...sel.chaves, chaveDoLote(alvo.l)] });
        } else onSel({ tipo: "lotes", chaves: [chaveDoLote(alvo.l)] });
      } else onSel({ tipo: alvo.tipo, id: alvo.id });
      return;
    }
    onFimArraste();
  }

  function onDuplo(e: React.MouseEvent) {
    if (ferramenta === "rua" || ferramenta === "area") {
      if (desenho.length >= (ferramenta === "rua" ? 2 : 3)) terminar();
      return;
    }
    if (ferramenta !== "selecionar") return;
    const [x, y] = pos(e);
    const alvo = alvoNoPonto(mundo(x, y));
    if (alvo?.tipo === "lote") onSel({ tipo: "quadra", nome: alvo.l.quadra });
  }

  function onWheel(e: RWheelEvent) {
    if (!v) return;
    const [x, y] = pos(e);
    const p = mundo(x, y);
    const f = Math.exp(-e.deltaY * 0.0015);
    const s = Math.max(0.05, Math.min(80, vv.s * f));
    // o ponto sob o cursor fica parado
    setV({ s, cx: p[0] - (x - W / 2) / s, cy: p[1] + (y - H / 2) / s });
  }

  // impede o scroll da página com a roda sobre o desenho
  useEffect(() => {
    const el = caixaRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  // ---------------- textos ----------------
  const pxLote = projeto.params.frente * vv.s; // largura típica de um lote em pixels
  const verNumero = pxLote >= 13;
  const verArea = pxLote >= 46;
  const verMedidas = vista.medidas && pxLote >= 52;
  const dentroTela = (p: Pt) => p[0] > -40 && p[0] < W + 40 && p[1] > -40 && p[1] < H + 40;

  const textosLotes = useMemo(() => {
    if (!verNumero) return [];
    return res.lotes.map((l) => {
      const c = tela(centroide(l.pol.ext));
      return dentroTela(c) ? { l, c } : null;
    }).filter((x): x is { l: Lote; c: Pt } => !!x);
  }, [res.lotes, verNumero, tela, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  const medidas = useMemo(() => {
    if (!verMedidas) return [];
    const out: { x: number; y: number; ang: number; t: string; k: string }[] = [];
    const vistos = new Set<string>();
    for (const l of res.lotes) {
      for (const lado of l.lados) {
        if (lado.comp < 0.5) continue;
        const k = [lado.a, lado.b].map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).sort().join("|");
        if (vistos.has(k)) continue;
        vistos.add(k);
        const a = tela(lado.a), b = tela(lado.b);
        const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        if (!dentroTela(m) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 34) continue;
        let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
        out.push({ x: m[0], y: m[1], ang, t: fmt(lado.comp), k });
      }
    }
    return out.slice(0, 1500);
  }, [res.lotes, verMedidas, tela, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  const corArea: Record<string, string> = { verde: "#B9E3A4", institucional: "#F6D3A0", lazer: "#BFE3F2", app: "#A9CFEF" };
  const cursor = ferramenta === "selecionar" ? (arrastando ? "grabbing" : hover ? "pointer" : "grab") : "crosshair";

  // prévia da ferramenta
  const ultimo = desenho[desenho.length - 1];
  const alvoPrevia = snap ?? mouse;
  const comprimentoPrevia = ultimo && alvoPrevia ? dist(ultimo, alvoPrevia) : 0;

  return (
    <div className="lot-prancheta" ref={caixaRef} style={{ cursor }}
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onWheel={onWheel} onDoubleClick={onDuplo}
      onContextMenu={(e) => e.preventDefault()} onPointerLeave={() => { setMouse(null); setHover(null); }}>
      <svg width={W} height={H}>
        {tiles.map((t) => <image key={t.k} href={t.href} width={1} height={1} preserveAspectRatio="none" transform={t.m} opacity={0.9} />)}
        <g transform={matriz}>
          {/* a gleba inteira na cor da rua: o que sobra entre quadras e áreas É o viário */}
          <path d={pathPol(res.gleba)} fill={vista.satelite ? "rgba(70,70,70,0.55)" : "#D9D6CF"} stroke="none" />
          {res.ruas.map((r) => (
            <path key={r.id} d={"M" + r.eixo.map((q) => `${q[0]} ${q[1]}`).join("L")} fill="none"
              stroke={sel?.tipo === "rua" && sel.id === r.id ? "#178552" : hover === r.id ? "#555" : "#9A958A"}
              strokeWidth={sel?.tipo === "rua" && sel.id === r.id ? 2.5 : 1} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
          ))}
          {res.areas.map((a) => a.pols.map((p, i) => (
            <path key={a.id + i} d={pathPol(p)} fill={corArea[a.tipo]} fillOpacity={vista.satelite ? 0.75 : 1}
              stroke={sel?.tipo === "area" && sel.id === a.id ? "#178552" : "#6B8F5B"} strokeWidth={sel?.tipo === "area" && sel.id === a.id ? 2.5 : 0.8}
              vectorEffect="non-scaling-stroke" />
          )))}
          {res.sobras.map((p, i) => <path key={i} d={pathPol(p)} fill="#F6C6E8" stroke="#B24C93" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />)}
          {pathsLotes.map(({ l, d }) => {
            const selecionado = idsSel.has(l.id);
            const fill = selecionado ? "#BFEBD2"
              : l.problemas.length ? "#FFD3D3"
              : vista.cores === "area" ? corPorArea(l.area, faixaArea.min, faixaArea.max)
              : vista.cores === "relevo" && cotas ? corPorCota(cotas.m.get(l.id) ?? cotas.min, cotas.min, cotas.max)
              : l.ajustado ? "#FFF0BF" : COR_LOTE;
            return (
              <path key={l.id} d={d} fill={fill} fillOpacity={vista.satelite && !selecionado ? 0.8 : 1}
                stroke={selecionado ? "#126B42" : "#4A5650"} strokeWidth={selecionado ? 2 : hover === l.id ? 1.6 : 0.7}
                vectorEffect="non-scaling-stroke" />
            );
          })}
          {quadraAtiva && <path d={pathPol(quadraAtiva.pol)} fill="none" stroke="#178552" strokeWidth={2.2} strokeDasharray="8 4" vectorEffect="non-scaling-stroke" />}
          {quadraAtiva?.fundo && (
            <line x1={quadraAtiva.fundo.a[0]} y1={quadraAtiva.fundo.a[1]} x2={quadraAtiva.fundo.b[0]} y2={quadraAtiva.fundo.b[1]}
              stroke="#B7791F" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
          )}
          {/* perímetro: vias em vermelho, rio em azul */}
          {res.ladosGleba.map((l, i) => (
            <line key={i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]}
              stroke={l.tipo === "via" ? "#C0262D" : l.tipo === "rio" ? "#1D5FD1" : l.tipo === "divisa" ? "#12201A" : "#8A4B00"}
              strokeWidth={l.tipo === "divisa" ? 2 : 3.5} vectorEffect="non-scaling-stroke" />
          ))}
        </g>

        {/* nomes das quadras (zoom afastado) */}
        {res.quadras.map((q) => {
          const c = tela(q.centro);
          if (!dentroTela(c)) return null;
          return <text key={q.nome} x={c[0]} y={c[1]} className="lot-q-nome" style={{ fontSize: Math.max(14, Math.min(46, 9 * vv.s)), opacity: verArea ? 0.18 : 0.55 }}>{q.nome}</text>;
        })}
        {res.publicas.map((a, i) => {
          const c = tela(centroide(a.pol.ext));
          if (!dentroTela(c) || Math.abs(c[0]) > 1e5 || a.area < 100) return null;
          return (
            <text key={i} x={c[0]} y={c[1]} className="lot-area-nome">
              <tspan x={c[0]} dy="-0.2em">{a.nome}</tspan>
              <tspan x={c[0]} dy="1.25em">{fmt(a.area)} m²</tspan>
            </text>
          );
        })}
        {textosLotes.map(({ l, c }) => (
          <text key={l.id} x={c[0]} y={c[1]} className="lot-num">
            <tspan x={c[0]} dy={verArea ? "-0.25em" : "0.35em"}>{l.numero}</tspan>
            {verArea && <tspan x={c[0]} dy="1.25em" className="lot-num-area">{fmt(l.area)} m²</tspan>}
          </text>
        ))}
        {medidas.map((m) => (
          <text key={m.k} x={m.x} y={m.y} transform={`rotate(${m.ang} ${m.x} ${m.y})`} className="lot-medida" dy="-0.3em">{m.t}</text>
        ))}
        {/* nomes das ruas ao longo do eixo */}
        {res.ruas.map((r) => {
          let melhor = 0, mi = 0;
          for (let i = 0; i + 1 < r.eixo.length; i++) { const d = dist(r.eixo[i], r.eixo[i + 1]); if (d > melhor) { melhor = d; mi = i; } }
          if (melhor * vv.s < 90) return null;
          const a = tela(r.eixo[mi]), b = tela(r.eixo[mi + 1]);
          const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          if (!dentroTela(m)) return null;
          let ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
          return <text key={r.id} x={m[0]} y={m[1]} transform={`rotate(${ang} ${m[0]} ${m[1]})`} className="lot-rua-nome" dy="0.35em">{r.nome} · {fmt(r.largura, r.largura % 1 ? 2 : 0)} m</text>;
        })}

        {/* alças */}
        {alcas.map((a, i) => a.forma === "corte"
          ? <circle key={i} cx={a.x} cy={a.y} r={6.5} className="lot-alca"><title>{a.titulo}</title></circle>
          : a.forma === "fundo"
            ? <rect key={i} x={a.x - 6} y={a.y - 6} width={12} height={12} transform={`rotate(45 ${a.x} ${a.y})`} className="lot-alca fundo"><title>{a.titulo}</title></rect>
            : a.forma === "vertice"
              ? <rect key={i} x={a.x - 5} y={a.y - 5} width={10} height={10} className="lot-alca vert"><title>{a.titulo}</title></rect>
              : <circle key={i} cx={a.x} cy={a.y} r={4.5} className="lot-alca mais"><title>{a.titulo}</title></circle>)}

        {/* prévia das ferramentas */}
        {desenho.length > 0 && (() => {
          const pts = [...desenho, ...(alvoPrevia && ferramenta !== "medir" ? [alvoPrevia] : [])].map(tela);
          const fechado = ferramenta === "area";
          return (
            <g>
              {fechado && pts.length >= 3 && <polygon points={pts.map((q) => q.join(",")).join(" ")} fill="rgba(23,133,82,0.15)" />}
              <polyline points={pts.map((q) => q.join(",")).join(" ")} fill="none" stroke="#178552" strokeWidth={ferramenta === "rua" ? Math.max(2, projeto.params.ruaLargura * vv.s) : 2}
                strokeOpacity={ferramenta === "rua" ? 0.35 : 1} strokeLinejoin="round" />
              <polyline points={pts.map((q) => q.join(",")).join(" ")} fill="none" stroke="#126B42" strokeWidth={1.5} strokeDasharray="6 4" />
              {pts.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r={3.5} fill="#126B42" />)}
            </g>
          );
        })()}
        {ferramenta === "medir" && desenho.length === 2 && (() => {
          const a = tela(desenho[0]), b = tela(desenho[1]);
          const d = dist(desenho[0], desenho[1]);
          const az = ((Math.atan2(desenho[1][0] - desenho[0][0], desenho[1][1] - desenho[0][1]) * 180) / Math.PI + 360) % 360;
          return (
            <g>
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#7C3AED" strokeWidth={2} />
              <text x={(a[0] + b[0]) / 2} y={(a[1] + b[1]) / 2 - 8} className="lot-medir">{fmt(d)} m · az {fmt(az, 1)}°</text>
            </g>
          );
        })()}
        {ultimo && alvoPrevia && ferramenta !== "selecionar" && ferramenta !== "medir" && (() => {
          const q = tela(alvoPrevia);
          return <text x={q[0] + 12} y={q[1] - 10} className="lot-medir">{fmt(comprimentoPrevia)} m</text>;
        })()}
        {snap && ferramenta !== "selecionar" && (() => { const q = tela(snap); return <rect x={q[0] - 6} y={q[1] - 6} width={12} height={12} fill="none" stroke="#E11D48" strokeWidth={2} />; })()}
      </svg>

      <div className="lot-escala">
        {(() => {
          const alvo = 120 / vv.s;
          const pot = 10 ** Math.floor(Math.log10(alvo));
          const passo = [1, 2, 5, 10].map((k) => k * pot).find((x) => x >= alvo * 0.6) ?? pot;
          return <><span style={{ width: passo * vv.s }} />{fmt(passo, passo < 1 ? 1 : 0)} m</>;
        })()}
      </div>
      {mouse && <div className="lot-coord">{(() => { const u = paraUtm(res.plano, mouse); return `E ${fmt(u[0], 2)} · N ${fmt(u[1], 2)}`; })()}</div>}
      <div className="lot-norte" title="Norte da quadrícula UTM">N<span>▲</span></div>
      {cotas && (
        <div className="lot-legenda-relevo">
          <span>{fmt(cotas.min, 1)} m</span>
          <i />
          <span>{fmt(cotas.max, 1)} m</span>
        </div>
      )}
      <div className="lot-zoom">
        <button onClick={() => setV({ ...vv, s: vv.s * 1.4 })} title="Aproximar">+</button>
        <button onClick={() => setV({ ...vv, s: vv.s / 1.4 })} title="Afastar">−</button>
        <button onClick={() => enquadrar(res.gleba.ext)} title="Enquadrar tudo (F)">⤢</button>
      </div>
    </div>
  );
}
