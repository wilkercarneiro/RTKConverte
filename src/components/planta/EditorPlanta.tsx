// Editor da planta: abre a CENA embutida no PDF (planta_cena.ts) e deixa mudar
// tudo o que está na folha — textos, cores, traços, posições, blocos inteiros —,
// menos o traçado do terreno, que aparece mas não se seleciona.
//
// Interação no padrão dos editores de desenho:
//   clique         seleciona o OBJETO (o bloco do confrontante, a rosa, o quadro…)
//   duplo clique   seleciona só a PEÇA (uma linha de texto dentro do bloco)
//   arrastar       move; a alça do canto amplia/reduz; a ponta da linha estica
//   arrastar no vazio seleciona por janela; roda do mouse = zoom; espaço/botão do meio = mão
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PDFFont } from "pdf-lib";
import { CAMADAS, type Cena, type Cor, type ItemCena, type ObjetoCena } from "../../../supabase/functions/_shared/planta_cena.ts";
import { textoWinAnsi } from "../../../supabase/functions/_shared/texto.ts";
import {
  PALETA, blocoDeTexto, caixaDe, corCss, corHex, deHex, escalar, mesmaCor, mover, pecaNoPonto, uniao, type Caixa,
} from "../../lib/planta_editor";

type Texto = Extract<ItemCena, { k: "texto" }>;
interface Doc { itens: ItemCena[]; objetos: Record<string, ObjetoCena> }
type Ferramenta = "selecionar" | "mao" | "texto" | "linha" | "ret";

// ---------------------------------------------------------------------------
// medida de texto: as MESMAS fontes do PDF, para a largura na tela ser a impressa
// ---------------------------------------------------------------------------
let fontesP: Promise<{ n: PDFFont; b: PDFFont }> | null = null;
function carregarFontes() {
  fontesP ??= (async () => {
    const { PDFDocument, StandardFonts } = await import("pdf-lib");
    const d = await PDFDocument.create();
    return { n: await d.embedFont(StandardFonts.Helvetica), b: await d.embedFont(StandardFonts.HelveticaBold) };
  })();
  return fontesP;
}

// ---------------------------------------------------------------------------
// ícones (traço 1.8, viewBox 24)
// ---------------------------------------------------------------------------
const IC = {
  cursor: "M5 3l13 7-6 2-2 6z",
  mao: "M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-7a1.5 1.5 0 0 1 3 0V12M14 11.5V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3l-2-3.6a1.5 1.5 0 0 1 2.6-1.5L8 15",
  texto: "M5 6V4h14v2M12 4v16M9 20h6",
  linha: "M5 19L19 5",
  ret: "M4 6h16v12H4z",
  desfazer: "M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3",
  refazer: "M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3",
  menos: "M5 12h14",
  mais: "M12 5v14M5 12h14",
  ajustar: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  olho: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  olhoFechado: "M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2",
  cadeado: "M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11",
  lixeira: "M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3",
  copiar: "M9 9h11v11H9zM5 15H4V4h11v1",
  frente: "M8 8h12v12H8zM4 16V4h12",
  tras: "M4 4h12v12H4zM20 8v12H8",
  voltar: "M15 18l-6-6 6-6",
  restaurar: "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5",
};
function Ic({ d, s = 17 }: { d: string; s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// uma peça da cena em SVG (tela do navegador: y para baixo)
// ---------------------------------------------------------------------------
const FONTE = "Helvetica, Arial, 'Liberation Sans', sans-serif";
const ItemSvg = memo(function ItemSvg({ it, H, imgs }: { it: ItemCena; H: number; imgs: Record<string, string> }) {
  switch (it.k) {
    case "texto":
      return (
        <text transform={`translate(${it.x} ${H - it.y})${it.rot ? ` rotate(${-it.rot})` : ""}`} fontSize={it.tam} fontFamily={FONTE}
          fontWeight={it.negrito ? 700 : 400} fill={corCss(it.cor)} opacity={it.opac} xmlSpace="preserve"
          textLength={it.w > 0 && it.t.trim() ? it.w : undefined} lengthAdjust="spacingAndGlyphs">{it.t}</text>
      );
    case "linha":
      return <line x1={it.x1} y1={H - it.y1} x2={it.x2} y2={H - it.y2} stroke={corCss(it.cor)} strokeWidth={it.esp} strokeDasharray={it.tracejado?.join(" ")} opacity={it.opac} />;
    case "ret": {
      const b = caixaDe({ ...it, esp: 0 });
      return <rect x={b.x1} y={H - b.y2} width={b.x2 - b.x1} height={b.y2 - b.y1} fill={it.fundo ? corCss(it.fundo) : "none"} stroke={it.borda ? corCss(it.borda) : "none"} strokeWidth={it.esp} opacity={it.opac} />;
    }
    case "elipse":
      return <ellipse cx={it.x} cy={H - it.y} rx={it.rx} ry={it.ry} fill={it.fundo ? corCss(it.fundo) : "none"} stroke={it.borda ? corCss(it.borda) : "none"} strokeWidth={it.esp} opacity={it.opac} />;
    case "caminho":
      return <path d={it.d} transform={`translate(${it.x} ${H - it.y}) scale(${it.esc})`} fill={it.fundo ? corCss(it.fundo) : "none"}
        stroke={it.borda ? corCss(it.borda) : "none"} strokeWidth={it.esp && it.esp > 0 ? it.esp : 0.3 / it.esc} strokeLinejoin="miter" opacity={it.opac} />;
    case "imagem":
      return imgs[it.img] ? <image href={imgs[it.img]} x={it.x} y={H - it.y - it.h} width={it.w} height={it.h} preserveAspectRatio="none" /> : null;
  }
});

// ---------------------------------------------------------------------------
// seletor de cor: a paleta da planta + qualquer outra
// ---------------------------------------------------------------------------
function Cores({ valor, nenhuma, onEscolher }: { valor: Cor | null | undefined; nenhuma?: boolean; onEscolher: (c: Cor | null) => void }) {
  return (
    <div className="ep-cores">
      {nenhuma && (
        <button type="button" className={`ep-cor nenhuma${valor === null ? " ativa" : ""}`} title="Sem cor" onClick={() => onEscolher(null)} />
      )}
      {PALETA.map((p) => (
        <button type="button" key={p.nome} title={p.nome} className={`ep-cor${valor && mesmaCor(valor, p.cor) ? " ativa" : ""}`}
          style={{ background: corCss(p.cor) }} onClick={() => onEscolher(p.cor)} />
      ))}
      <label className="ep-cor outra" title="Outra cor">
        <input type="color" value={valor ? corHex(valor) : "#000000"} onChange={(e) => onEscolher(deHex(e.target.value))} />
      </label>
    </div>
  );
}

/** Valor comum a todas, ou `undefined` se divergem. */
function comum<T>(vals: T[], igual: (a: T, b: T) => boolean = (a, b) => a === b): T | undefined {
  if (!vals.length) return undefined;
  return vals.every((v) => igual(v, vals[0])) ? vals[0] : undefined;
}
const quase = (a: number, b: number) => Math.abs(a - b) < 0.01;
const arred = (v: number | undefined, casas = 1) => (v === undefined ? "" : String(Math.round(v * 10 ** casas) / 10 ** casas));

let seqNovo = 0;
const novoId = (p: string) => `${p}${Date.now().toString(36)}${(seqNovo++).toString(36)}`;

// ---------------------------------------------------------------------------
// editor
// ---------------------------------------------------------------------------
export function EditorPlanta({ cena, original, chaveRascunho, onConcluir, onVoltar }: {
  /** a cena que abre (a última editada, ou a do PDF) */
  cena: Cena;
  /** a cena como saiu do sistema, para "restaurar original" */
  original: Cena;
  chaveRascunho?: string;
  onConcluir: (c: Cena) => void;
  onVoltar: () => void;
}) {
  const W = cena.tela.w, H = cena.tela.h;
  const [doc, setDocState] = useState<Doc>(() => ({ itens: cena.itens, objetos: cena.objetos }));
  const docRef = useRef(doc);
  const setDoc = (d: Doc) => { docRef.current = d; setDocState(d); };
  const hist = useRef<{ passado: Doc[]; futuro: Doc[]; chave?: string; t: number }>({ passado: [], futuro: [], t: 0 });
  const [, forcar] = useState(0);

  const [sel, setSelState] = useState<string[]>([]);
  const selRef = useRef(sel);
  const setSel = (s: string[]) => { selRef.current = s; setSelState(s); };
  const selSet = useMemo(() => new Set(sel), [sel]);

  const [ferramenta, setFerramenta] = useState<Ferramenta>("selecionar");
  const [vista, setVista] = useState({ z: 0.5, px: 0, py: 0 });
  const vistaRef = useRef(vista);
  vistaRef.current = vista;
  const [previa, setPrevia] = useState<Record<string, ItemCena> | null>(null);
  const [janela, setJanela] = useState<Caixa | null>(null);
  const [criando, setCriando] = useState<ItemCena | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [dicaTravado, setDicaTravado] = useState<{ x: number; y: number } | null>(null);
  const [corNova, setCorNova] = useState<Cor>([0, 0, 0]);
  const [rascunho, setRascunho] = useState<{ doc: Doc; t: number } | null>(null);
  const [fontes, setFontes] = useState<{ n: PDFFont; b: PDFFont } | null>(null);
  const telaRef = useRef<HTMLDivElement>(null);
  const textoRef = useRef<HTMLTextAreaElement>(null);
  const espaco = useRef(false);
  const area = useRef<{ clip: Doc["itens"]; objs: Doc["objetos"] } | null>(null);
  type Arrasto =
    | { t: "pan"; sx: number; sy: number; px0: number; py0: number }
    | { t: "mover"; x0: number; y0: number; ids: string[]; moveu: boolean }
    | { t: "janela"; x0: number; y0: number; somar: boolean }
    | { t: "ponta"; id: string; qual: 1 | 2 }
    | { t: "escala"; ax: number; ay: number; cx: number; cy: number; ids: string[] }
    | { t: "criar"; f: "linha" | "ret"; x0: number; y0: number };
  const arrasto = useRef<Arrasto | null>(null);

  useEffect(() => { carregarFontes().then(setFontes).catch(() => setFontes(null)); }, []);

  const medir = useCallback((t: string, tam: number, negrito?: boolean) => {
    const limpo = textoWinAnsi(t);
    try { if (fontes) return (negrito ? fontes.b : fontes.n).widthOfTextAtSize(limpo, tam); } catch { /* fonte ainda não carregou */ }
    return limpo.length * tam * (negrito ? 0.6 : 0.55);
  }, [fontes]);

  const imgs = useMemo(() => Object.fromEntries(Object.entries(cena.imagens).map(([id, im]) =>
    [id, `data:image/${im.tipo === "png" ? "png" : "jpeg"};base64,${im.b64}`])), [cena.imagens]);

  // ---------------- histórico ----------------
  /** Aplica uma mudança. Mudanças seguidas com a mesma `chave` viram um passo só no desfazer. */
  const aplicar = useCallback((novo: Doc, chave?: string) => {
    const h = hist.current;
    const agora = Date.now();
    if (!(chave && h.chave === chave && agora - h.t < 1500)) {
      h.passado.push(docRef.current);
      if (h.passado.length > 150) h.passado.shift();
    }
    h.futuro = [];
    h.chave = chave;
    h.t = agora;
    setDoc(novo);
    forcar((n) => n + 1);
  }, []);
  const desfazer = useCallback(() => {
    const h = hist.current;
    const ant = h.passado.pop();
    if (!ant) return;
    h.futuro.push(docRef.current);
    h.chave = undefined;
    setDoc(ant);
    const ids = new Set(ant.itens.map((i) => i.id));
    setSel(selRef.current.filter((id) => ids.has(id)));
    forcar((n) => n + 1);
  }, []);
  const refazer = useCallback(() => {
    const h = hist.current;
    const prox = h.futuro.pop();
    if (!prox) return;
    h.passado.push(docRef.current);
    h.chave = undefined;
    setDoc(prox);
    const ids = new Set(prox.itens.map((i) => i.id));
    setSel(selRef.current.filter((id) => ids.has(id)));
    forcar((n) => n + 1);
  }, []);

  /** Troca as peças selecionadas pelo resultado de `fn` (null apaga). */
  const alterarSel = useCallback((fn: (it: ItemCena) => ItemCena | null, chave?: string) => {
    const s = new Set(selRef.current);
    const d = docRef.current;
    const itens: ItemCena[] = [];
    for (const it of d.itens) {
      if (!s.has(it.id)) { itens.push(it); continue; }
      const n = fn(it);
      if (n) itens.push(n);
    }
    aplicar({ ...d, itens }, chave);
  }, [aplicar]);

  // ---------------- rascunho ----------------
  useEffect(() => {
    if (!chaveRascunho) return;
    try {
      const r = JSON.parse(localStorage.getItem(chaveRascunho) ?? "null");
      if (r?.doc?.itens && JSON.stringify(r.doc.itens) !== JSON.stringify(cena.itens)) setRascunho(r);
    } catch { /* sem armazenamento */ }
  }, [chaveRascunho, cena.itens]);
  useEffect(() => {
    if (!chaveRascunho || hist.current.passado.length === 0) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(chaveRascunho, JSON.stringify({ doc, t: Date.now() })); } catch { /* cheio: segue sem rascunho */ }
    }, 700);
    return () => clearTimeout(t);
  }, [doc, chaveRascunho]);

  // ---------------- vista ----------------
  const ajustar = useCallback(() => {
    const el = telaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const z = Math.min((r.width - 48) / W, (r.height - 48) / H);
    setVista({ z, px: (r.width - W * z) / 2, py: (r.height - H * z) / 2 });
  }, [W, H]);
  useEffect(() => { ajustar(); }, [ajustar]);
  const zoomEm = useCallback((fator: number, cx?: number, cy?: number) => {
    const el = telaRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const v = vistaRef.current;
    const x = cx ?? r.width / 2, y = cy ?? r.height / 2;
    const z = Math.max(0.05, Math.min(12, v.z * fator));
    const k = z / v.z;
    setVista({ z, px: x - (x - v.px) * k, py: y - (y - v.py) * k });
  }, []);
  useEffect(() => {
    const el = telaRef.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || !e.shiftKey) zoomEm(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
      else setVista((v) => ({ ...v, px: v.px - e.deltaY }));
    };
    el.addEventListener("wheel", roda, { passive: false });
    return () => el.removeEventListener("wheel", roda);
  }, [zoomEm]);

  /** ponto do evento → coordenadas da planta (pontos, y para cima) */
  const ptPlanta = (e: { clientX: number; clientY: number }) => {
    const r = telaRef.current!.getBoundingClientRect();
    const v = vistaRef.current;
    return { x: (e.clientX - r.left - v.px) / v.z, y: H - (e.clientY - r.top - v.py) / v.z, sx: e.clientX - r.left, sy: e.clientY - r.top };
  };

  // ---------------- seleção ----------------
  const itensDoObjeto = (obj: string) => docRef.current.itens.filter((i) => i.obj === obj && !i.oculto).map((i) => i.id);
  const selItens = useMemo(() => doc.itens.filter((i) => selSet.has(i.id)), [doc.itens, selSet]);
  const caixaSel = useMemo(() => uniao(selItens.map((i) => caixaDe(previa?.[i.id] ?? i))), [selItens, previa]);
  const umaLinha = selItens.length === 1 && selItens[0].k === "linha" ? (previa?.[selItens[0].id] ?? selItens[0]) as Extract<ItemCena, { k: "linha" }> : null;

  // ---------------- criar ----------------
  const criarTexto = (x: number, y: number) => {
    const obj = novoId("a");
    const it: Texto = { id: novoId("n"), obj, k: "texto", t: "TEXTO", x, y, tam: 14, cor: corNova, w: medir("TEXTO", 14) };
    aplicar({ itens: [...docRef.current.itens, it], objetos: { ...docRef.current.objetos, [obj]: { rotulo: "Texto", cat: "anotacao" } } });
    setSel([it.id]);
    setFerramenta("selecionar");
    setTimeout(() => { textoRef.current?.focus(); textoRef.current?.select(); }, 30);
  };

  // ---------------- ponteiro ----------------
  const tolerancia = () => 5 / vistaRef.current.z;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const p = ptPlanta(e);
    const v = vistaRef.current;
    setDicaTravado(null);
    if (e.button === 1 || espaco.current || ferramenta === "mao") {
      arrasto.current = { t: "pan", sx: e.clientX, sy: e.clientY, px0: v.px, py0: v.py };
      return;
    }
    if (ferramenta === "texto") { criarTexto(p.x, p.y); return; }
    if (ferramenta === "linha" || ferramenta === "ret") {
      arrasto.current = { t: "criar", f: ferramenta, x0: p.x, y0: p.y };
      return;
    }
    // alças (em pixels de tela)
    const perto = (x: number, y: number) => Math.hypot((x * v.z + v.px) - p.sx, ((H - y) * v.z + v.py) - p.sy) <= 8;
    if (umaLinha) {
      if (perto(umaLinha.x1, umaLinha.y1)) { arrasto.current = { t: "ponta", id: umaLinha.id, qual: 1 }; return; }
      if (perto(umaLinha.x2, umaLinha.y2)) { arrasto.current = { t: "ponta", id: umaLinha.id, qual: 2 }; return; }
    } else if (caixaSel && perto(caixaSel.x2, caixaSel.y1)) {
      arrasto.current = { t: "escala", ax: caixaSel.x1, ay: caixaSel.y2, cx: caixaSel.x2, cy: caixaSel.y1, ids: selRef.current };
      return;
    }
    const d = docRef.current;
    const alvo = pecaNoPonto(d.itens, d.objetos, p.x, p.y, tolerancia());
    if (alvo) {
      let ids: string[];
      if (e.detail >= 2) {
        // duplo clique: só a peça (e, se for texto, direto para a edição)
        ids = [alvo.id];
        setSel(ids);
        if (alvo.k === "texto") setTimeout(() => { textoRef.current?.focus(); textoRef.current?.select(); }, 30);
      } else if (e.shiftKey) {
        const doObj = itensDoObjeto(alvo.obj);
        const s = new Set(selRef.current);
        const tem = doObj.every((id) => s.has(id));
        for (const id of doObj) { if (tem) s.delete(id); else s.add(id); }
        ids = [...s];
        setSel(ids);
      } else if (selRef.current.includes(alvo.id)) {
        ids = selRef.current;
      } else {
        ids = itensDoObjeto(alvo.obj);
        setSel(ids);
      }
      arrasto.current = { t: "mover", x0: p.x, y0: p.y, ids, moveu: false };
      return;
    }
    if (!e.shiftKey) setSel([]);
    arrasto.current = { t: "janela", x0: p.x, y0: p.y, somar: e.shiftKey };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = arrasto.current;
    const p = ptPlanta(e);
    if (!a) {
      if (ferramenta !== "selecionar") { setHover(null); return; }
      const d = docRef.current;
      const alvo = pecaNoPonto(d.itens, d.objetos, p.x, p.y, tolerancia());
      setHover(alvo ? alvo.obj : null);
      if (!alvo && pecaNoPonto(d.itens, d.objetos, p.x, p.y, tolerancia(), true)) setDicaTravado({ x: p.sx, y: p.sy });
      else setDicaTravado(null);
      return;
    }
    const base = new Map(docRef.current.itens.map((i) => [i.id, i]));
    switch (a.t) {
      case "pan":
        setVista((v) => ({ ...v, px: a.px0 + e.clientX - a.sx, py: a.py0 + e.clientY - a.sy }));
        break;
      case "mover": {
        let dx = p.x - a.x0, dy = p.y - a.y0;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        if (!a.moveu && Math.hypot(dx, dy) * vistaRef.current.z < 3) return;
        a.moveu = true;
        const m: Record<string, ItemCena> = {};
        for (const id of a.ids) { const it = base.get(id); if (it) m[id] = mover(it, dx, dy); }
        setPrevia(m);
        setHover(null);
        break;
      }
      case "janela":
        setJanela({ x1: Math.min(a.x0, p.x), y1: Math.min(a.y0, p.y), x2: Math.max(a.x0, p.x), y2: Math.max(a.y0, p.y) });
        break;
      case "ponta": {
        const it = base.get(a.id);
        if (it?.k !== "linha") return;
        let { x, y } = p;
        if (e.shiftKey) {
          const ox = a.qual === 1 ? it.x2 : it.x1, oy = a.qual === 1 ? it.y2 : it.y1;
          const ang = Math.round(Math.atan2(y - oy, x - ox) / (Math.PI / 4)) * (Math.PI / 4);
          const r = Math.hypot(x - ox, y - oy);
          x = ox + r * Math.cos(ang); y = oy + r * Math.sin(ang);
        }
        setPrevia({ [a.id]: a.qual === 1 ? { ...it, x1: x, y1: y } : { ...it, x2: x, y2: y } });
        break;
      }
      case "escala": {
        const vx = a.cx - a.ax, vy = a.cy - a.ay;
        const s = Math.max(0.05, ((p.x - a.ax) * vx + (p.y - a.ay) * vy) / (vx * vx + vy * vy || 1));
        const m: Record<string, ItemCena> = {};
        for (const id of a.ids) { const it = base.get(id); if (it) m[id] = escalar(it, s, a.ax, a.ay); }
        setPrevia(m);
        break;
      }
      case "criar": {
        let { x, y } = p;
        if (a.f === "linha" && e.shiftKey) {
          const ang = Math.round(Math.atan2(y - a.y0, x - a.x0) / (Math.PI / 4)) * (Math.PI / 4);
          const r = Math.hypot(x - a.x0, y - a.y0);
          x = a.x0 + r * Math.cos(ang); y = a.y0 + r * Math.sin(ang);
        }
        setCriando(a.f === "linha"
          ? { id: "_", obj: "_", k: "linha", x1: a.x0, y1: a.y0, x2: x, y2: y, esp: 2, cor: corNova }
          : { id: "_", obj: "_", k: "ret", x: Math.min(a.x0, x), y: Math.min(a.y0, y), w: Math.abs(x - a.x0), h: Math.abs(y - a.y0), borda: corNova, esp: 1.2 });
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = arrasto.current;
    arrasto.current = null;
    if (!a) return;
    const d = docRef.current;
    if ((a.t === "mover" && a.moveu) || a.t === "ponta" || a.t === "escala") {
      if (previa) aplicar({ ...d, itens: d.itens.map((i) => previa[i.id] ?? i) });
      setPrevia(null);
    } else if (a.t === "janela") {
      const j = janela;
      setJanela(null);
      if (j && (j.x2 - j.x1) * vistaRef.current.z > 4) {
        // entra o OBJETO que coube inteiro na janela — como num programa de desenho
        const porObj = new Map<string, ItemCena[]>();
        for (const it of d.itens) {
          if (it.oculto || d.objetos[it.obj]?.travado) continue;
          porObj.set(it.obj, [...(porObj.get(it.obj) ?? []), it]);
        }
        const ids = new Set(a.somar ? selRef.current : []);
        for (const its of porObj.values()) {
          const b = uniao(its.map(caixaDe))!;
          if (b.x1 >= j.x1 && b.x2 <= j.x2 && b.y1 >= j.y1 && b.y2 <= j.y2) for (const it of its) ids.add(it.id);
        }
        setSel([...ids]);
      }
    } else if (a.t === "criar") {
      const p = ptPlanta(e);
      const obj = novoId("a");
      let it = criando;
      const pequeno = !it || Math.hypot(p.x - a.x0, p.y - a.y0) * vistaRef.current.z < 6;
      if (pequeno) {
        it = a.f === "linha"
          ? { id: "_", obj: "_", k: "linha", x1: a.x0, y1: a.y0, x2: a.x0 + 120, y2: a.y0, esp: 2, cor: corNova }
          : { id: "_", obj: "_", k: "ret", x: a.x0, y: a.y0 - 60, w: 160, h: 60, borda: corNova, esp: 1.2 };
      }
      const novo = { ...it!, id: novoId("n"), obj } as ItemCena;
      aplicar({
        itens: [...d.itens, novo],
        objetos: { ...d.objetos, [obj]: { rotulo: a.f === "linha" ? "Linha" : "Caixa", cat: "anotacao" } },
      });
      setCriando(null);
      setSel([novo.id]);
      setFerramenta("selecionar");
    }
  };

  // ---------------- ações ----------------
  const apagar = useCallback(() => { if (selRef.current.length) { alterarSel(() => null); setSel([]); } }, [alterarSel]);
  const colar = useCallback((origem: ItemCena[], objs: Record<string, ObjetoCena>, desloc = 14) => {
    const d = docRef.current;
    const mapa = new Map<string, string>();
    const objetos = { ...d.objetos };
    const novos = origem.map((it) => {
      if (!mapa.has(it.obj)) {
        const n = novoId("c");
        mapa.set(it.obj, n);
        const o = objs[it.obj] ?? { rotulo: "Elemento", cat: "anotacao" };
        objetos[n] = { rotulo: `${o.rotulo} (cópia)`, cat: o.cat === "terreno" ? "anotacao" : o.cat };
      }
      return { ...mover(it, desloc, -desloc), id: novoId("n"), obj: mapa.get(it.obj)! } as ItemCena;
    });
    aplicar({ itens: [...d.itens, ...novos], objetos });
    setSel(novos.map((i) => i.id));
  }, [aplicar]);
  const duplicar = useCallback(() => {
    const s = new Set(selRef.current);
    const origem = docRef.current.itens.filter((i) => s.has(i.id));
    if (origem.length) colar(origem, docRef.current.objetos);
  }, [colar]);
  const reordenar = useCallback((frente: boolean) => {
    const s = new Set(selRef.current);
    const d = docRef.current;
    const dentro = d.itens.filter((i) => s.has(i.id)), fora = d.itens.filter((i) => !s.has(i.id));
    aplicar({ ...d, itens: frente ? [...fora, ...dentro] : [...dentro, ...fora] });
  }, [aplicar]);
  const restaurar = () => {
    aplicar({ itens: original.itens, objetos: original.objetos });
    setSel([]);
    if (chaveRascunho) try { localStorage.removeItem(chaveRascunho); } catch { /* sem armazenamento */ }
  };

  // ---------------- teclado ----------------
  useEffect(() => {
    const digitando = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    const baixo = (e: KeyboardEvent) => {
      if (digitando(e.target)) {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === " ") { espaco.current = true; e.preventDefault(); return; }
      if (ctrl && k === "z" && !e.shiftKey) { e.preventDefault(); desfazer(); return; }
      if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); refazer(); return; }
      if (ctrl && k === "d") { e.preventDefault(); duplicar(); return; }
      if (ctrl && k === "c") {
        const s = new Set(selRef.current);
        area.current = { clip: docRef.current.itens.filter((i) => s.has(i.id)), objs: docRef.current.objetos };
        return;
      }
      if (ctrl && k === "v") { if (area.current?.clip.length) { e.preventDefault(); colar(area.current.clip, area.current.objs, 20); } return; }
      if (ctrl && k === "a") {
        e.preventDefault();
        const d = docRef.current;
        setSel(d.itens.filter((i) => !i.oculto && !d.objetos[i.obj]?.travado).map((i) => i.id));
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); apagar(); return; }
      if (e.key === "Escape") { setSel([]); setFerramenta("selecionar"); setCriando(null); arrasto.current = null; setPrevia(null); return; }
      if (e.key.startsWith("Arrow") && selRef.current.length) {
        e.preventDefault();
        const passo = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -passo : e.key === "ArrowRight" ? passo : 0;
        const dy = e.key === "ArrowDown" ? -passo : e.key === "ArrowUp" ? passo : 0;
        alterarSel((it) => mover(it, dx, dy), "setas");
        return;
      }
      if (ctrl) return;
      if (k === "v") setFerramenta("selecionar");
      else if (k === "h") setFerramenta("mao");
      else if (k === "t") setFerramenta("texto");
      else if (k === "l") setFerramenta("linha");
      else if (k === "r") setFerramenta("ret");
      else if (e.key === "+" || e.key === "=") zoomEm(1.25);
      else if (e.key === "-") zoomEm(0.8);
      else if (e.key === "0") ajustar();
    };
    const cima = (e: KeyboardEvent) => { if (e.key === " ") espaco.current = false; };
    window.addEventListener("keydown", baixo);
    window.addEventListener("keyup", cima);
    return () => { window.removeEventListener("keydown", baixo); window.removeEventListener("keyup", cima); };
  }, [desfazer, refazer, duplicar, colar, apagar, alterarSel, zoomEm, ajustar]);

  // ---------------- painel: propriedades ----------------
  const textos = selItens.filter((i): i is Texto => i.k === "texto");
  const linhas = selItens.filter((i): i is Extract<ItemCena, { k: "linha" }> => i.k === "linha");
  const formas = selItens.filter((i): i is Extract<ItemCena, { k: "ret" | "elipse" | "caminho" }> => i.k === "ret" || i.k === "elipse" || i.k === "caminho");
  const bloco = textos.length === 1 && selItens.length === 1 ? { linhas: [textos[0]], passo: textos[0].tam * 1.25 } : blocoDeTexto(selItens);
  const objsSel = [...new Set(selItens.map((i) => i.obj))];
  const tituloSel = objsSel.length === 1 ? doc.objetos[objsSel[0]]?.rotulo ?? "Elemento" : `${objsSel.length} objetos`;
  const camadaSel = objsSel.length === 1 ? CAMADAS[doc.objetos[objsSel[0]]?.cat] ?? "" : "";
  const objInteiro = objsSel.length === 1 && doc.itens.filter((i) => i.obj === objsSel[0] && !i.oculto).length === selItens.length;

  const remedir = (t: Texto): Texto => ({ ...t, w: medir(t.t, t.tam, t.negrito) });
  const editarBloco = (valor: string) => {
    if (!bloco) return;
    const novas = valor.split("\n");
    const [primeira] = bloco.linhas;
    const d = docRef.current;
    const porId = new Map<string, ItemCena | null>();
    bloco.linhas.forEach((l, i) => porId.set(l.id, i < novas.length ? remedir({ ...l, t: novas[i] }) : null));
    const extras: ItemCena[] = novas.slice(bloco.linhas.length).map((t, k) => remedir({
      ...bloco.linhas[bloco.linhas.length - 1], id: novoId("n"), t,
      y: primeira.y - (bloco.linhas.length + k) * bloco.passo, negrito: false,
    }));
    const itens: ItemCena[] = [];
    let ultimo = -1;
    d.itens.forEach((it) => {
      if (porId.has(it.id)) { const n = porId.get(it.id); if (n) itens.push(n); ultimo = itens.length; } else itens.push(it);
    });
    itens.splice(ultimo < 0 ? itens.length : ultimo, 0, ...extras);
    aplicar({ ...d, itens }, `texto:${primeira.id}`);
    if (extras.length) setSel([...selRef.current.filter((id) => porId.get(id) !== null), ...extras.map((x) => x.id)]);
    else if (novas.length < bloco.linhas.length) setSel(selRef.current.filter((id) => porId.get(id) !== null));
  };
  const mudarTam = (tam: number) => {
    if (!(tam > 0)) return;
    if (bloco && bloco.linhas.length > 1) {
      const k = tam / bloco.linhas[0].tam;
      const topo = bloco.linhas[0].y;
      const ordem = new Map(bloco.linhas.map((l, i) => [l.id, i]));
      alterarSel((it) => it.k === "texto" ? remedir({ ...it, tam: it.tam * k, y: topo - (ordem.get(it.id) ?? 0) * bloco.passo * k }) : it, "tam");
    } else {
      alterarSel((it) => it.k === "texto" ? remedir({ ...it, tam }) : it, "tam");
    }
  };

  const textoBloco = bloco ? bloco.linhas.map((l) => l.t).join("\n") : "";
  const tamComum = comum(textos.map((t) => t.tam), quase);
  const negritoComum = comum(textos.map((t) => !!t.negrito));
  const rotComum = comum(textos.map((t) => t.rot ?? 0), quase);
  const corTexto = comum(textos.map((t) => t.cor), mesmaCor);
  const corLinha = comum(linhas.map((l) => l.cor), mesmaCor);
  const espLinha = comum(linhas.map((l) => l.esp), quase);
  const tracejado = comum(linhas.map((l) => !!l.tracejado?.length));
  const bordaForma = comum(formas.map((f) => f.borda ?? null), (a, b) => (a === null || b === null ? a === b : mesmaCor(a, b)));
  const fundoForma = comum(formas.map((f) => f.fundo ?? null), (a, b) => (a === null || b === null ? a === b : mesmaCor(a, b)));
  const espForma = comum(formas.map((f) => f.esp ?? 0), quase);

  // ---------------- painel: camadas ----------------
  const camadas = useMemo(() => {
    const m = new Map<string, { objs: Set<string>; ocultos: number; total: number; travada: boolean }>();
    for (const it of doc.itens) {
      const o = doc.objetos[it.obj];
      const cat = o?.cat ?? "desenho";
      const c = m.get(cat) ?? { objs: new Set(), ocultos: 0, total: 0, travada: !!o?.travado };
      c.objs.add(it.obj); c.total++; if (it.oculto) c.ocultos++;
      m.set(cat, c);
    }
    return [...m.entries()];
  }, [doc]);
  const alternarCamada = (cat: string, ocultar: boolean) => {
    const d = docRef.current;
    aplicar({ ...d, itens: d.itens.map((i) => (d.objetos[i.obj]?.cat === cat && !d.objetos[i.obj]?.travado ? { ...i, oculto: ocultar || undefined } : i)) });
    if (ocultar) setSel([]);
  };
  const selecionarCamada = (cat: string) => {
    const d = docRef.current;
    setSel(d.itens.filter((i) => !i.oculto && d.objetos[i.obj]?.cat === cat && !d.objetos[i.obj]?.travado).map((i) => i.id));
  };

  // ---------------- desenho ----------------
  const visiveis = useMemo(() => doc.itens.filter((i) => !i.oculto), [doc.itens]);
  const camadaSvg = useMemo(
    () => visiveis.map((it) => <ItemSvg key={it.id} it={previa?.[it.id] ?? it} H={H} imgs={imgs} />),
    [visiveis, previa, H, imgs],
  );
  const z = vista.z;
  const caixaHover = useMemo(() => {
    if (!hover || sel.length) return null;
    return uniao(doc.itens.filter((i) => i.obj === hover && !i.oculto).map(caixaDe));
  }, [hover, sel.length, doc.itens]);
  const ret = (b: Caixa, folga = 0) => ({ x: b.x1 - folga, y: H - b.y2 - folga, width: b.x2 - b.x1 + 2 * folga, height: b.y2 - b.y1 + 2 * folga });
  const mudou = hist.current.passado.length > 0;
  const cursor = ferramenta === "mao" || espaco.current ? "grab" : ferramenta === "texto" ? "text" : ferramenta === "selecionar" ? (hover ? "move" : "default") : "crosshair";

  const botaoF = (f: Ferramenta, d: string, rotulo: string, tecla: string) => (
    <button type="button" className={`ep-ferr${ferramenta === f ? " ativa" : ""}`} title={`${rotulo} (${tecla})`} onClick={() => setFerramenta(f)}>
      <Ic d={d} /><span>{rotulo}</span>
    </button>
  );

  return (
    <div className="ep">
      <div className="ep-barra">
        <button type="button" className="fantasma ep-voltar" onClick={onVoltar} title="Voltar ao visualizador (a edição fica guardada)">
          <Ic d={IC.voltar} /> Visualizador
        </button>
        <div className="ep-grupo">
          {botaoF("selecionar", IC.cursor, "Selecionar", "V")}
          {botaoF("mao", IC.mao, "Mão", "H")}
          {botaoF("texto", IC.texto, "Texto", "T")}
          {botaoF("linha", IC.linha, "Linha", "L")}
          {botaoF("ret", IC.ret, "Caixa", "R")}
        </div>
        <div className="ep-grupo">
          <button type="button" className="ep-icone" title="Desfazer (Ctrl+Z)" disabled={!hist.current.passado.length} onClick={desfazer}><Ic d={IC.desfazer} /></button>
          <button type="button" className="ep-icone" title="Refazer (Ctrl+Y)" disabled={!hist.current.futuro.length} onClick={refazer}><Ic d={IC.refazer} /></button>
        </div>
        <div className="ep-grupo">
          <button type="button" className="ep-icone" title="Afastar (−)" onClick={() => zoomEm(0.8)}><Ic d={IC.menos} /></button>
          <button type="button" className="ep-zoom" title="Ajustar à tela (0)" onClick={ajustar}>{Math.round(z * 100)}%</button>
          <button type="button" className="ep-icone" title="Aproximar (+)" onClick={() => zoomEm(1.25)}><Ic d={IC.mais} /></button>
          <button type="button" className="ep-icone" title="Ajustar à tela (0)" onClick={ajustar}><Ic d={IC.ajustar} /></button>
        </div>
        <span className="ep-espaco" />
        <button type="button" className="fantasma" title="Volta a planta ao que o sistema gerou (dá para desfazer)" onClick={restaurar} disabled={doc.itens === original.itens}>
          <Ic d={IC.restaurar} s={15} /> Restaurar original
        </button>
        <button type="button" className="principal" onClick={() => onConcluir({ ...cena, itens: doc.itens, objetos: doc.objetos })}>
          Concluir e gerar PDF
        </button>
      </div>

      {rascunho && (
        <div className="ep-aviso">
          Há uma edição desta planta de {new Date(rascunho.t).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} que não virou PDF.
          <button type="button" onClick={() => { aplicar(rascunho.doc); setRascunho(null); setSel([]); }}>Retomar a edição</button>
          <button type="button" className="fantasma" onClick={() => setRascunho(null)}>Começar desta planta</button>
        </div>
      )}

      <div className="ep-corpo">
        <div className="ep-tela" ref={telaRef} style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
          onPointerLeave={() => { setHover(null); setDicaTravado(null); }} onContextMenu={(e) => e.preventDefault()}>
          <svg width="100%" height="100%">
            <defs>
              <filter id="ep-sombra" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy={2 / z} stdDeviation={6 / z} floodOpacity="0.18" /></filter>
            </defs>
            <g transform={`translate(${vista.px} ${vista.py}) scale(${z})`}>
              <rect x={0} y={0} width={W} height={H} fill="#fff" filter="url(#ep-sombra)" />
              <g style={{ pointerEvents: "none" }}>{camadaSvg}</g>
              {criando && <ItemSvg it={criando} H={H} imgs={imgs} />}
              {caixaHover && <rect {...ret(caixaHover, 3 / z)} fill="none" stroke="#178552" strokeOpacity={0.55} strokeWidth={1 / z} strokeDasharray={`${4 / z} ${3 / z}`} />}
              {caixaSel && !umaLinha && (
                <>
                  <rect {...ret(caixaSel, 3 / z)} fill="rgb(23 133 82 / 4%)" stroke="#178552" strokeWidth={1.4 / z} />
                  <rect x={caixaSel.x2 + 3 / z - 5 / z} y={H - caixaSel.y1 + 3 / z - 5 / z} width={10 / z} height={10 / z} fill="#fff" stroke="#178552" strokeWidth={1.6 / z} style={{ cursor: "nwse-resize" }} />
                </>
              )}
              {umaLinha && [[umaLinha.x1, umaLinha.y1], [umaLinha.x2, umaLinha.y2]].map(([x, y], i) => (
                <circle key={i} cx={x} cy={H - y} r={5 / z} fill="#fff" stroke="#178552" strokeWidth={1.6 / z} />
              ))}
              {janela && <rect {...ret(janela)} fill="rgb(23 133 82 / 8%)" stroke="#178552" strokeWidth={1 / z} strokeDasharray={`${5 / z} ${3 / z}`} />}
            </g>
          </svg>
          {dicaTravado && (
            <div className="ep-dica" style={{ left: dicaTravado.x + 14, top: dicaTravado.y + 14 }}>
              <Ic d={IC.cadeado} s={13} /> Traçado do terreno — não pode ser alterado
            </div>
          )}
          <div className="ep-status">
            Folha {cena.nomeFolha ?? "A1"} · {selItens.length ? `${selItens.length} peça${selItens.length > 1 ? "s" : ""} selecionada${selItens.length > 1 ? "s" : ""}` : "clique para selecionar · duplo clique pega só a peça · roda do mouse = zoom · espaço + arrastar = mão"}
          </div>
        </div>

        <aside className="ep-painel">
          {selItens.length === 0 ? (
            <>
              <h4>Camadas</h4>
              <p className="ep-sub">Clique no nome para selecionar a camada inteira; o olho tira ela do PDF.</p>
              <ul className="ep-camadas">
                {camadas.map(([cat, c]) => (
                  <li key={cat} className={c.ocultos === c.total ? "oculta" : ""}>
                    {c.travada
                      ? <span className="ep-trava" title="O traçado do terreno não se altera"><Ic d={IC.cadeado} s={15} /></span>
                      : (
                        <button type="button" className="ep-icone pequeno" title={c.ocultos === c.total ? "Mostrar" : "Esconder do PDF"} onClick={() => alternarCamada(cat, c.ocultos !== c.total)}>
                          <Ic d={c.ocultos === c.total ? IC.olhoFechado : IC.olho} s={15} />
                        </button>
                      )}
                    <button type="button" className="ep-camada-nome" disabled={c.travada} onClick={() => selecionarCamada(cat)}>
                      {CAMADAS[cat] ?? cat}
                    </button>
                    <span className="ep-qtd">{c.objs.size}</span>
                  </li>
                ))}
              </ul>
              <h4>Para novos traços e textos</h4>
              <Cores valor={corNova} onEscolher={(c) => c && setCorNova(c)} />
              <h4>Atalhos</h4>
              <dl className="ep-atalhos">
                <dt>Duplo clique</dt><dd>só a peça (uma linha do bloco)</dd>
                <dt>Shift + clique</dt><dd>soma à seleção</dd>
                <dt>Setas</dt><dd>empurra 1 pt (Shift: 10 pt)</dd>
                <dt>Ctrl+D</dt><dd>duplica</dd>
                <dt>Ctrl+C / Ctrl+V</dt><dd>copia e cola</dd>
                <dt>Delete</dt><dd>apaga</dd>
                <dt>Ctrl+Z / Ctrl+Y</dt><dd>desfaz / refaz</dd>
              </dl>
            </>
          ) : (
            <>
              <h4 className="ep-titulo-sel">{tituloSel}</h4>
              <p className="ep-sub">
                {camadaSel && <>{camadaSel} · </>}{selItens.length} peça{selItens.length > 1 ? "s" : ""}
                {objsSel.length === 1 && !objInteiro && (
                  <> · <button type="button" className="ep-link" onClick={() => setSel(itensDoObjeto(objsSel[0]))}>objeto inteiro</button></>
                )}
              </p>

              {textos.length > 0 && (
                <section className="ep-secao">
                  <h5>Texto</h5>
                  {bloco && (
                    <textarea ref={textoRef} className="ep-textarea" rows={Math.min(8, Math.max(2, bloco.linhas.length + 1))} value={textoBloco}
                      spellCheck={false} onChange={(e) => editarBloco(e.target.value)} />
                  )}
                  {!bloco && <p className="ep-sub">{textos.length} textos — clique duas vezes num deles para editar o conteúdo.</p>}
                  <div className="ep-campos">
                    <label>Tamanho (pt)
                      <input type="number" min={1} step={0.5} value={arred(tamComum)} placeholder="vários" onChange={(e) => mudarTam(Number(e.target.value))} />
                    </label>
                    <label>Giro (°)
                      <input type="number" step={1} value={arred(rotComum, 0)} placeholder="vários"
                        onChange={(e) => { const r = Number(e.target.value); alterarSel((it) => it.k === "texto" ? { ...it, rot: r || undefined } : it, "rot"); }} />
                    </label>
                    <label className="ep-check">
                      <input type="checkbox" checked={!!negritoComum} onChange={(e) => alterarSel((it) => it.k === "texto" ? remedir({ ...it, negrito: e.target.checked || undefined }) : it)} />
                      Negrito
                    </label>
                  </div>
                  <Cores valor={corTexto} onEscolher={(c) => c && alterarSel((it) => (it.k === "texto" ? { ...it, cor: c } : it))} />
                </section>
              )}

              {linhas.length > 0 && (
                <section className="ep-secao">
                  <h5>Traço</h5>
                  <Cores valor={corLinha} onEscolher={(c) => c && alterarSel((it) => (it.k === "linha" ? { ...it, cor: c } : it))} />
                  <div className="ep-campos">
                    <label>Espessura (pt)
                      <input type="number" min={0.1} step={0.1} value={arred(espLinha)} placeholder="várias"
                        onChange={(e) => { const v = Number(e.target.value); if (v > 0) alterarSel((it) => it.k === "linha" ? { ...it, esp: v } : it, "esp"); }} />
                    </label>
                    <label className="ep-check">
                      <input type="checkbox" checked={!!tracejado} onChange={(e) => alterarSel((it) => it.k === "linha" ? { ...it, tracejado: e.target.checked ? [6, 4] : undefined } : it)} />
                      Tracejado
                    </label>
                  </div>
                </section>
              )}

              {formas.length > 0 && (
                <section className="ep-secao">
                  <h5>Contorno</h5>
                  <Cores valor={bordaForma} nenhuma onEscolher={(c) => alterarSel((it) => (it.k === "ret" || it.k === "elipse" || it.k === "caminho")
                    ? { ...it, borda: c ?? undefined, esp: c ? (it.esp || (it.k === "caminho" ? 0.6 : 1)) : it.esp } : it)} />
                  {bordaForma !== null && (
                    <div className="ep-campos">
                      <label>Espessura (pt)
                        <input type="number" min={0.1} step={0.1} value={arred(espForma)} placeholder="várias"
                          onChange={(e) => { const v = Number(e.target.value); if (v > 0) alterarSel((it) => (it.k === "ret" || it.k === "elipse" || it.k === "caminho") ? { ...it, esp: v } : it, "espf"); }} />
                      </label>
                    </div>
                  )}
                  <h5>Preenchimento</h5>
                  <Cores valor={fundoForma} nenhuma onEscolher={(c) => alterarSel((it) => (it.k === "ret" || it.k === "elipse" || it.k === "caminho") ? { ...it, fundo: c ?? undefined } : it)} />
                </section>
              )}

              <section className="ep-secao ep-acoes">
                <button type="button" onClick={duplicar} title="Ctrl+D"><Ic d={IC.copiar} s={15} /> Duplicar</button>
                <button type="button" onClick={() => reordenar(true)} title="Desenha por cima dos outros"><Ic d={IC.frente} s={15} /> Para frente</button>
                <button type="button" onClick={() => reordenar(false)} title="Desenha por baixo dos outros"><Ic d={IC.tras} s={15} /> Para trás</button>
                <button type="button" className="ep-perigo" onClick={apagar} title="Delete"><Ic d={IC.lixeira} s={15} /> Apagar</button>
              </section>
              <p className="ep-sub">Arraste para mover · a alça do canto amplia ou reduz{umaLinha ? " · arraste as pontas para esticar (Shift trava em 45°)" : ""}.</p>
            </>
          )}
          {mudou && <p className="ep-sub ep-guardado">Edição guardada neste navegador enquanto não vira PDF.</p>}
        </aside>
      </div>
    </div>
  );
}
