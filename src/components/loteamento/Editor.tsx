// Prancheta do loteamento: o desenho que o operador manipula.
//
// SVG puro, sem biblioteca de CAD: a geometria vai num grupo com a matriz
// mundo→tela (y para cima, como na UTM) e os textos são posicionados em pixels
// para não sair espelhados. Tudo o que muda o projeto vira uma ação de
// `acoes.ts`; durante um arraste a mudança é "transiente" (recalcula a cada
// movimento, mas só entra no desfazer quando o botão é solto).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent, ReactNode, WheelEvent as RWheelEvent } from "react";
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import { caixa, centroide, dentroPol, dist, distSegmento, dot, esquerda, pontoDoRotulo, sub, unit } from "../../lib/loteamento/geom.ts";
import type { Anel, Poligono, Pt } from "../../lib/loteamento/geom.ts";
import type { Lote, Quadra, Resultado } from "../../lib/loteamento/calculo.ts";
import { fmt } from "../../lib/loteamento/calculo.ts";
import { paraPlano, paraUtm } from "../../lib/loteamento/plano.ts";
import { cotaEm } from "../../lib/loteamento/terreno.ts";
import type { Projeto } from "../../lib/loteamento/modelo.ts";
import { adicionarArea, adicionarRua, chaveDoLote, editarRua, lotesDaSelecao, quadraDe } from "../../lib/loteamento/acoes.ts";
import type { Ferramenta, Selecao } from "../../lib/loteamento/acoes.ts";
import { alcasDoLote, cortarLotes, definirFrente, desenharLote, ladosRetos, moverDivisa, moverQuina, posicaoNoDesenho } from "../../lib/loteamento/edicao.ts";
import { alternarAcesso } from "../../lib/loteamento/acoes.ts";
import type { Rede, ResultadoInfra } from "../../lib/loteamento/infra/index.ts";
import { DefsRedes, RedesGeo, RedesSimbolos } from "./Redes";

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
  /** controle que flutua sobre o desenho (ex.: o giro das divisas) */
  sobreposto?: ReactNode;
  /** redes de infraestrutura por cima dos lotes (água, esgoto, drenagem, energia, iluminação) */
  redes?: { r: ResultadoInfra; camadas: Set<Rede> } | null;
}

interface Vista { cx: number; cy: number; s: number }

type Arraste =
  | { tipo: "pan"; x0: number; y0: number; v0: Vista; moveu: boolean }
  /** quina do lote: `de` é o ponto (plano) no início do arraste */
  | { tipo: "quina"; de: Pt; quadra: Quadra; lote: Lote; pr0: Projeto; res0: Resultado }
  /** divisa do lote (a→b): desliza paralela, pela distância do cursor à posição inicial */
  | { tipo: "divisa"; a: Pt; b: Pt; p0: Pt; quadra: Quadra; lote: Lote; pr0: Projeto; res0: Resultado }
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

export function Editor({ projeto, res, fuso, sel, onSel, ferramenta, onFerramenta, onMudar, onFimArraste, vista, focar, onMsg, sobreposto, redes }: Props) {
  // divisão de imóvel: o contorno não recua (ver Parametros.bordaFixa)
  const bordaFixa = !!projeto.params.bordaFixa;
  const caixaRef = useRef<HTMLDivElement>(null);
  const [tam, setTam] = useState({ w: 900, h: 600 });
  const [v, setV] = useState<Vista | null>(null);
  const [mouse, setMouse] = useState<Pt | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [desenho, setDesenho] = useState<Pt[]>([]);
  const [snap, setSnap] = useState<Pt | null>(null);
  /** ferramenta Frente: o lado sob o cursor (de um lote ou da quadra) */
  const [ladoFrente, setLadoFrente] = useState<{ a: Pt; b: Pt } | null>(null);
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
  const encaixar = useCallback((p: Pt, ancora?: Pt, ignorar?: Pt): Pt => {
    const tolM = 10 / vv.s;
    let melhor: Pt | null = null, dm = tolM;
    // o ponto que está sendo arrastado não puxa a si mesmo
    const testar = (q: Pt) => { if (ignorar && dist(q, ignorar) < 0.05) return; const d = dist(p, q); if (d < dm) { dm = d; melhor = q; } };
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
    } else if (ferramenta === "lote" && desenho.length > 0 && desenho.length < 3) {
      onMsg("O lote precisa de pelo menos 3 quinas — continue clicando (ou duplo clique numa área livre rosa).");
      return;
    } else if (ferramenta === "lote" && desenho.length >= 3) {
      const ed = desenharLote(projeto, res, desenho);
      if (!ed) onMsg("O contorno não pega nenhuma quadra — desenhe o lote dentro de uma quadra.");
      else {
        onMudar(ed.pr);
        if (ed.sel) onSel({ tipo: "lotes", chaves: ed.sel.indices.map((indice) => ({ quadra: ed.sel!.quadra, fileira: 0, indice })) });
        onMsg(ed.msg);
      }
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
        else if (k === "l") onFerramenta("lote");
        else if (k === "c") onFerramenta("cortar");
        else if (k === "t") onFerramenta("frente");
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
    const out: { x: number; y: number; acao: Arraste; titulo: string; forma: "quina" | "divisa" | "vertice" | "mais"; ang?: number; borda?: boolean }[] = [];
    if (!v) return out;
    // lote selecionado: uma alça em cada quina e uma no meio de cada divisa
    // (a borda da quadra — rua, divisa da gleba — não anda: a quina desliza nela)
    if (lotesSel.length === 1 && quadraAtiva) {
      const l = lotesSel[0];
      for (const a of alcasDoLote(l, quadraAtiva)) {
        const pt = tela(a.p);
        if (a.tipo === "quina") {
          out.push({
            x: pt[0], y: pt[1], forma: "quina", acao: { tipo: "quina", de: a.p, quadra: quadraAtiva, lote: l, pr0: projeto, res0: res },
            titulo: a.naBorda ? "Arraste a quina — ela corre pela rua/divisa; os vizinhos se ajustam (Alt solta da borda)" : "Arraste a quina — os lotes vizinhos se ajustam",
          });
        } else if (!(bordaFixa && a.naBorda)) {
          const d = sub(tela(a.b!), tela(a.a!));
          out.push({
            x: pt[0], y: pt[1], forma: "divisa", ang: (Math.atan2(d[1], d[0]) * 180) / Math.PI,
            acao: { tipo: "divisa", a: a.a!, b: a.b!, p0: a.p, quadra: quadraAtiva, lote: l, pr0: projeto, res0: res }, borda: a.naBorda,
            titulo: a.naBorda ? "Lado na rua/divisa: arraste para dentro para recuar o lote (fica área livre)" : "Arraste a divisa — o lote fica mais largo/fundo e o vizinho se ajusta",
          });
        }
      }
    }
    // lote estreito na tela (zoom afastado): alça de divisa colada em outra alça
    // pegava a divisa errada — some até aproximar; as quinas ficam
    for (let k = out.length - 1; k >= 0; k--) {
      const h = out[k];
      if (h.forma === "divisa" && out.some((o, j) => j !== k && Math.hypot(o.x - h.x, o.y - h.y) < 16)) out.splice(k, 1);
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
  }, [v, quadraAtiva, lotesSel, sel, res, projeto, tela]);

  /**
   * Ferramenta Frente: o lado mais perto do cursor — do lote selecionado (a
   * frente dele) ou, sem lote selecionado, da quadra sob o cursor (o acesso dela).
   */
  function ladoDaFrente(p: Pt): { a: Pt; b: Pt; lote?: Lote; quadra: Quadra } | null {
    const tol = 14 / vv.s;
    const perto = (pol: { ext: Pt[]; furos: Pt[][] }) => {
      let m: [Pt, Pt] | null = null, dm = tol;
      for (const [a, b] of ladosRetos(pol)) { const d = distSegmento(p, a, b).d; if (d < dm) { dm = d; m = [a, b]; } }
      return m;
    };
    if (lotesSel.length === 1 && quadraAtiva) {
      const m = perto(lotesSel[0].pol);
      return m ? { a: m[0], b: m[1], lote: lotesSel[0], quadra: quadraAtiva } : null;
    }
    const todas = [...res.quadras, ...(res.quadrasVazias ?? [])];
    const q = (sel?.tipo === "quadra" ? todas.find((x) => x.nome === sel.nome) : undefined) ?? todas.find((x) => dentroPol(p, x.pol))
      ?? todas.find((x) => x.pol.ext.some((a, i) => distSegmento(p, a, x.pol.ext[(i + 1) % x.pol.ext.length]).d < tol));
    if (!q) return null;
    const m = perto(q.pol);
    return m ? { a: m[0], b: m[1], quadra: q } : null;
  }

  function onDown(e: RPointerEvent) {
    if (!v) return;
    // captura no contêiner: o elemento da alça é refeito a cada quadro do arraste
    // (capturar nele perdia os movimentos e o soltar — a alça "travava")
    caixaRef.current?.setPointerCapture?.(e.pointerId);
    const [x, y] = pos(e);
    const p = mundo(x, y);
    if (e.button === 1 || e.button === 2) { arraste.current = { tipo: "pan", x0: x, y0: y, v0: vv, moveu: true }; setArrastando(true); return; }
    if (ferramenta === "rua" || ferramenta === "area" || ferramenta === "lote") {
      const q = encaixar(p, desenho[desenho.length - 1]);
      // o 2º clique do duplo clique repete o ponto: quem termina é o onDoubleClick
      if (ultimoPonto(desenho, q, 3 / vv.s)) return;
      setDesenho((d) => [...d, q]);
      return;
    }
    if (ferramenta === "frente") {
      const alvo = ladoDaFrente(p);
      if (!alvo) { onMsg(lotesSel.length === 1 ? "Clique perto de um lado do lote selecionado." : "Clique perto de um lado da quadra (ou selecione um lote para escolher a frente dele)."); return; }
      if (alvo.lote) {
        const ed = definirFrente(projeto, res, alvo.quadra, alvo.lote, alvo.a, alvo.b);
        if (ed) { onMudar(ed.pr); if (ed.sel) onSel({ tipo: "lotes", chaves: [{ quadra: ed.sel.quadra, fileira: 0, indice: ed.sel.indices[0] }] }); onMsg(ed.msg); }
      } else {
        const r2 = alternarAcesso(projeto, res, alvo.quadra, alvo.a, alvo.b);
        onMudar(r2.pr);
        onMsg(r2.msg);
      }
      setLadoFrente(null);
      onFerramenta("selecionar");
      return;
    }
    if (ferramenta === "cortar") {
      const q = encaixar(p, desenho[0]);
      if (!desenho.length) { setDesenho([q]); return; }
      const ed = cortarLotes(projeto, res, desenho[0], q);
      setDesenho([]);
      if (!ed) { onMsg("A linha não atravessa nenhum lote de lado a lado."); return; }
      onMudar(ed.pr);
      onSel(null);
      onMsg(ed.msg);
      // um corte por vez: o clique seguinte já seleciona (como no T)
      onFerramenta("selecionar");
      return;
    }
    if (ferramenta === "medir") {
      const q = encaixar(p);
      setDesenho((d) => (d.length >= 2 ? [q] : [...d, q]));
      return;
    }
    // a quina ganha da divisa quando as duas estão perto do clique
    const alca = alcas.filter((a) => Math.hypot(a.x - x, a.y - y) <= 13).sort((a, b) => (a.forma === "quina" ? 0 : 1) - (b.forma === "quina" ? 0 : 1) || Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
    if (alca) {
      arraste.current = alca.acao;
      movido.current = false;
      setArrastando(true);
      return;
    }
    arraste.current = { tipo: "pan", x0: x, y0: y, v0: vv, moveu: false };
  }

  const raf = useRef(0);
  const pendente = useRef<(() => void) | null>(null);
  /** o arraste já mexeu no projeto (clique sem arrastar não muda nada, nem a seleção) */
  const movido = useRef(false);
  /** posição do lote arrastado no desenho, no último quadro (a seleção só muda quando ela muda) */
  const selDoArraste = useRef(-1);
  /** ímã do arraste de quina: só nas quinas do desenho de ANTES do arraste (a quina não puxa a si mesma) */
  const imaDeQuina = (p: Pt, base: Resultado, de: Pt): Pt => {
    const tol = 8 / vv.s;
    let melhor: Pt | null = null, dm = tol;
    // só puxa para um ponto mais perto do cursor do que a posição de onde a quina saiu
    const testar = (q: Pt) => { if (dist(q, de) < 0.05) return; const d = dist(p, q); if (d < dm && d < dist(p, de)) { dm = d; melhor = q; } };
    const perto = (e: Pt[]) => e.some((q) => Math.abs(q[0] - p[0]) < 60 && Math.abs(q[1] - p[1]) < 60);
    base.gleba.ext.forEach(testar);
    for (const l of base.lotes) if (perto(l.pol.ext)) l.pol.ext.forEach(testar);
    for (const q of base.quadras) if (perto(q.pol.ext)) q.pol.ext.forEach(testar);
    setSnap(melhor);
    return melhor ?? p;
  };
  function onMove(e: RPointerEvent) {
    if (!v) return;
    shift.current = e.shiftKey;
    const [x, y] = pos(e);
    const p = mundo(x, y);
    setMouse(p);
    const a = arraste.current;
    if (!a) {
      if (ferramenta === "frente") { setLadoFrente(ladoDaFrente(p)); return; }
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
    const alt = e.altKey;
    // a última mudança do arraste fica pendente até o próximo quadro; ao soltar
    // ela é aplicada antes de fechar o arraste (soltar rápido não a perde)
    pendente.current = () => {
      if (a.tipo === "quina" || a.tipo === "divisa") {
        // o lote arrastado tem a vez quando invade o vizinho; a seleção vai com
        // ele (a quadra passa a ser desenhada e um lote engolido muda as posições)
        const dono = posicaoNoDesenho(a.pr0, a.res0, a.lote);
        // a borda da quadra é ímã (14 px): perto dela a quina corre pela rua; longe, vai aonde o cursor for
        const ed = a.tipo === "quina"
          ? bordaFixa
            ? moverQuina(a.pr0, a.res0, a.quadra, a.de, p, false, Infinity, dono)
            : moverQuina(a.pr0, a.res0, a.quadra, a.de, alt ? p : imaDeQuina(p, a.res0, a.de), alt, 14 / vv.s, dono)
          : moverDivisa(a.pr0, a.res0, a.quadra, a.a, a.b, dot(sub(p, a.p0), esquerda(unit(sub(a.b, a.a)))), alt, dono);
        const k = ed.sel?.indices[0];
        if (k !== undefined && (!movido.current || k !== selDoArraste.current)) {
          onSel({ tipo: "lotes", chaves: [{ quadra: a.lote.quadra, fileira: 0, indice: k }] });
          selDoArraste.current = k;
        }
        movido.current = true;
        onMudar(ed.pr, true);
      } else if (a.tipo === "vertice") {
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
    if (ferramenta === "rua" || ferramenta === "area" || ferramenta === "lote") {
      if (desenho.length >= (ferramenta === "rua" ? 2 : 3)) { terminar(); return; }
      // duplo clique numa área livre (rosa) com a ferramenta Lote: vira um lote inteiro
      if (ferramenta === "lote") {
        const [x, y] = pos(e);
        const pm = mundo(x, y);
        const livre = res.sobras.find((sb) => dentroPol(pm, sb));
        if (!livre) onMsg("Duplo clique dentro de uma área livre (rosa) vira lote; para um lote novo, clique as quinas e tecle Enter.");
        if (livre) {
          const ed = desenharLote(projeto, res, livre.ext);
          setDesenho([]);
          if (ed) {
            onMudar(ed.pr);
            if (ed.sel) onSel({ tipo: "lotes", chaves: ed.sel.indices.map((indice) => ({ quadra: ed.sel!.quadra, fileira: 0, indice })) });
            onMsg(ed.msg);
            onFerramenta("selecionar");
          }
        }
      }
      return;
    }
    if (ferramenta !== "selecionar") return;
    const [x, y] = pos(e);
    const pm = mundo(x, y);
    const alvo = alvoNoPonto(pm);
    if (alvo?.tipo === "lote") onSel({ tipo: "quadra", nome: alvo.l.quadra });
    else {
      // área livre de uma quadra (inclusive a desenhada que ficou sem lote): seleciona a quadra
      const q = [...res.quadras, ...(res.quadrasVazias ?? [])].find((x2) => dentroPol(pm, x2.pol));
      if (q) onSel({ tipo: "quadra", nome: q.nome });
    }
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

  // nome das áreas públicas: dentro da própria área (numa faixa em L o
  // centroide cai fora, em cima dos lotes); a proporção é a do rótulo de 2 linhas
  const pontosAreas = useMemo(() => new Map(res.publicas.map((a) => {
    const largura = Math.max(a.nome.length, `${fmt(a.area)} m²`.length) * 0.62;
    return [a, pontoDoRotulo(a.pol, largura / 2.4)] as const;
  })), [res.publicas]);

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
        {redes && <defs><DefsRedes /></defs>}
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
            // lote fora das medidas: vermelho e contorno grosso — salta aos olhos
            const ruim = l.problemas.length > 0;
            return (
              <path key={l.id} d={d} fill={fill} fillOpacity={vista.satelite && !selecionado ? 0.85 : 1}
                stroke={selecionado ? "#126B42" : ruim ? "#C0262D" : "#4A5650"} strokeWidth={selecionado ? 2.2 : ruim ? 1.8 : hover === l.id ? 1.6 : 0.7}
                vectorEffect="non-scaling-stroke" />
            );
          })}
          {quadraAtiva && <path d={pathPol(quadraAtiva.pol)} fill="none" stroke="#178552" strokeWidth={2.2} strokeDasharray="8 4" vectorEffect="non-scaling-stroke" />}
          {/* frente escolhida pelo operador (lote) e acesso marcado na quadra */}
          {res.lotes.flatMap((l) => l.lados.filter((x) => x.definida).map((x, i) => (
            <line key={`fd${l.id}${i}`} x1={x.a[0]} y1={x.a[1]} x2={x.b[0]} y2={x.b[1]} stroke="#D97706" strokeWidth={4} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          )))}
          {[...res.quadras, ...(res.quadrasVazias ?? [])].flatMap((q) => (q.acessos ?? []).map(([a2, b2], i) => (
            <line key={`ac${q.nome}${i}`} x1={a2[0]} y1={a2[1]} x2={b2[0]} y2={b2[1]} stroke="#D97706" strokeWidth={3} strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />
          )))}
          {ferramenta === "frente" && ladoFrente && (
            <line x1={ladoFrente.a[0]} y1={ladoFrente.a[1]} x2={ladoFrente.b[0]} y2={ladoFrente.b[1]} stroke="#D97706" strokeWidth={7} strokeOpacity={0.55} vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          )}
          {/* perímetro: vias em vermelho, rio em azul */}
          {res.ladosGleba.map((l, i) => (
            <line key={i} x1={l.a[0]} y1={l.a[1]} x2={l.b[0]} y2={l.b[1]}
              stroke={l.tipo === "via" ? "#C0262D" : l.tipo === "rio" ? "#1D5FD1" : l.tipo === "divisa" ? "#12201A" : "#8A4B00"}
              strokeWidth={l.tipo === "divisa" ? 2 : 3.5} vectorEffect="non-scaling-stroke" />
          ))}
          {/* redes por cima dos lotes: os lotes ficam de fundo, mais claros */}
          {redes && <path d={pathPol(res.gleba)} fill="#FFFFFF" fillOpacity={0.38} stroke="none" pointerEvents="none" />}
          {redes && <RedesGeo r={redes.r} camadas={redes.camadas} s={vv.s} />}
        </g>

        {/* nomes das quadras (zoom afastado) */}
        {res.quadras.map((q) => {
          const c = tela(q.centro);
          if (!dentroTela(c)) return null;
          return <text key={q.nome} x={c[0]} y={c[1]} className="lot-q-nome" style={{ fontSize: Math.max(14, Math.min(46, 9 * vv.s)), opacity: verArea ? 0.18 : 0.55 }}>{q.nome}</text>;
        })}
        {res.publicas.map((a, i) => {
          const c = tela(pontosAreas.get(a) ?? centroide(a.pol.ext));
          if (!dentroTela(c) || Math.abs(c[0]) > 1e5 || a.area < 100) return null;
          return (
            <text key={i} x={c[0]} y={c[1]} className="lot-area-nome">
              <tspan x={c[0]} dy="-0.2em">{a.nome}</tspan>
              <tspan x={c[0]} dy="1.25em">{fmt(a.area)} m²</tspan>
            </text>
          );
        })}
        {textosLotes.map(({ l, c }) => (
          <text key={l.id} x={c[0]} y={c[1]} className={`lot-num${l.problemas.length ? " ruim" : ""}`}>
            <tspan x={c[0]} dy={verArea ? "-0.25em" : "0.35em"}>{l.problemas.length ? "⚠ " : ""}{l.numero}</tspan>
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

        {redes && <RedesSimbolos r={redes.r} camadas={redes.camadas} tela={tela} s={vv.s} dentro={dentroTela} />}

        {/* alças */}
        {/* divisas primeiro: a quina fica por cima */}
        {alcas.filter((a) => a.forma === "divisa").map((a, i) => (
          <rect key={`d${i}`} x={a.x - 9} y={a.y - 3.5} width={18} height={7} rx={3.5} transform={`rotate(${a.ang ?? 0} ${a.x} ${a.y})`} className={`lot-alca divisa${a.borda ? " borda" : ""}`}><title>{a.titulo}</title></rect>
        ))}
        {alcas.filter((a) => a.forma !== "divisa").map((a, i) => a.forma === "quina"
          ? <rect key={i} x={a.x - 6} y={a.y - 6} width={12} height={12} rx={2} className="lot-alca quina"><title>{a.titulo}</title></rect>
          : a.forma === "vertice"
            ? <rect key={i} x={a.x - 5} y={a.y - 5} width={10} height={10} className="lot-alca vert"><title>{a.titulo}</title></rect>
            : <circle key={i} cx={a.x} cy={a.y} r={4.5} className="lot-alca mais"><title>{a.titulo}</title></circle>)}
        {/* medidas do lote durante o arraste */}
        {arrastando && mouse && lotesSel.length === 1 && (() => {
          const l = lotesSel[0];
          const q = tela(mouse);
          return (
            <g pointerEvents="none">
              <rect x={q[0] + 14} y={q[1] + 10} width={l.problemas.length ? 236 : 176} height={l.problemas.length ? 40 : 24} rx={6} fill="rgba(255,255,255,0.95)" stroke={l.problemas.length ? "#C0262D" : "#178552"} />
              <text x={q[0] + 22} y={q[1] + 26} className="lot-medir">{fmt(l.frente)} m · {fmt(l.area)} m²</text>
              {l.problemas.length > 0 && <text x={q[0] + 22} y={q[1] + 42} className="lot-medir ruim">⚠ {l.problemas[0].slice(0, 34)}</text>}
            </g>
          );
        })()}

        {/* prévia das ferramentas */}
        {desenho.length > 0 && (() => {
          const pts = [...desenho, ...(alvoPrevia && ferramenta !== "medir" ? [alvoPrevia] : [])].map(tela);
          const fechado = ferramenta === "area" || ferramenta === "lote";
          return (
            <g>
              {fechado && pts.length >= 3 && <polygon points={pts.map((q) => q.join(",")).join(" ")} fill="rgba(23,133,82,0.15)" />}
              <polyline points={pts.map((q) => q.join(",")).join(" ")} fill="none" stroke="#178552" strokeWidth={ferramenta === "rua" ? Math.max(2, projeto.params.ruaLargura * vv.s) : 2}
                strokeOpacity={ferramenta === "rua" ? 0.35 : 1} strokeLinejoin="round" />
              <polyline points={pts.map((q) => q.join(",")).join(" ")} fill="none" stroke={ferramenta === "cortar" ? "#C0262D" : "#126B42"} strokeWidth={ferramenta === "cortar" ? 2.5 : 1.5} strokeDasharray="6 4" />
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
      {sobreposto}

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
      {/* os botões não começam arraste nem tiram a seleção */}
      <div className="lot-zoom" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <button onClick={() => setV({ ...vv, s: vv.s * 1.4 })} title="Aproximar">+</button>
        <button onClick={() => setV({ ...vv, s: vv.s / 1.4 })} title="Afastar">−</button>
        <button onClick={() => enquadrar(res.gleba.ext)} title="Enquadrar tudo (F)">⤢</button>
      </div>
    </div>
  );
}
