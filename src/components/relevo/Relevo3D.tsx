// Maquete 3D do terreno do imóvel (serviço GEO). Reaproveita a maquete do
// loteamento (three.js, céu, satélite como textura, sombras) com um "projeto
// vazio": só a gleba — sem ruas, lotes nem casas. O perímetro vai pintado no
// chão e os marcos M ficam de pé como pinos com o código.
// Carregada sob demanda (three.js só entra no navegador de quem abre).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import type { Resultado } from "../../lib/loteamento/calculo.ts";
import type { GradeTerreno } from "../../lib/loteamento/terreno.ts";
import { montarCena } from "../../lib/loteamento/cena3d.ts";
import type { Cena } from "../../lib/loteamento/cena3d.ts";
import { pintarCampo, pintarSatelite, quadroDaGrade } from "../../lib/loteamento/textura3d.ts";
import type { Quadro } from "../../lib/loteamento/textura3d.ts";
import { criarPlano, paraPlano, paraUtm } from "../../lib/loteamento/plano.ts";
import { PARAMETROS_PADRAO } from "../../lib/loteamento/modelo.ts";
import type { Pt as PtGeom } from "../../lib/loteamento/geom.ts";
import type { Curva, GradeCotas, Pt } from "../../lib/relevo/curvas.ts";
import { caixaDe, pontosDeRotulo } from "../../lib/relevo/curvas.ts";
import { Maquete } from "../loteamento/maquete3d.ts";
import type { Rotulo } from "../loteamento/maquete3d.ts";
import { MOTIVO_SEM_WEBGL, webglDisponivel } from "../../lib/webgl";
import "../loteamento/maquete3d.css";
import "./relevo.css";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

export interface Props {
  nome: string;
  fuso: number;
  grade: GradeCotas;
  aneis: Pt[][];
  marcos: { texto: string; p: Pt }[];
  curvas: Curva[];
  intervalo: number;
  /** "dem": miolo do modelo público; "marcos": só interpolado dos marcos */
  fonte: "dem" | "marcos";
  desnivel: number;
  onFechar: () => void;
}

const fmt = (v: number, c = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

/** Área com sinal (positiva no anti-horário). */
const areaPol = (a: Pt[]) => a.reduce((s, p, i) => { const q = a[(i + 1) % a.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;

/** O imóvel como um "loteamento vazio": a gleba e nada mais. */
function resultadoDoImovel(aneis: Pt[][], pts: Pt[], hs: number[]): Resultado {
  const plano = criarPlano(pts, hs, false);
  const pl = (a: Pt[]) => a.map((p) => paraPlano(plano, p as PtGeom));
  // a maquete enquadra a gleba: com várias partes/glebas, a caixa de todas
  const maior = [...aneis].sort((a, b) => Math.abs(areaPol(pl(b))) - Math.abs(areaPol(pl(a))))[0];
  let ext = pl(maior);
  if (aneis.length > 1) {
    const b = caixaDe(aneis.flat());
    ext = pl([b.min, [b.max[0], b.min[1]], b.max, [b.min[0], b.max[1]]]);
  }
  if (areaPol(ext) < 0) ext = [...ext].reverse();
  const vazio = {
    plano, gleba: { ext, furos: [] }, ladosGleba: [], ruas: [], quadras: [], quadrasVazias: [], lotes: [], areas: [],
    faixasRestricao: [], publicas: [], sobras: [], canteiros: [], problemas: [], desarmonicos: 0, ms: 0,
    quadro: { gleba: Math.abs(areaPol(ext)) },
  };
  return vazio as unknown as Resultado;
}

/** Curvas e perímetro no chão (por cima do satélite). */
function pintarRelevo(ctx: CanvasRenderingContext2D, q: Quadro, res: Resultado, aneis: Pt[][], curvas: Curva[], intervalo: number, comCurvas: boolean): void {
  const k = q.largura / q.W;
  const px = (p: Pt): [number, number] => {
    const [x, y] = paraPlano(res.plano, p as PtGeom);
    return [((x - q.x0) / q.W) * q.largura, (1 - (y - q.y0) / q.H) * q.altura];
  };
  const caminho = (pts: Pt[], fechar: boolean) => {
    ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = px(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    if (fechar) ctx.closePath();
  };
  if (comCurvas) {
    // véu claro dentro do imóvel: as curvas leem melhor sobre o satélite
    ctx.save();
    ctx.beginPath();
    for (const a of aneis) a.forEach((p, i) => { const [x, y] = px(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = "rgba(255,248,232,0.18)";
    ctx.fill("evenodd");
    ctx.restore();
    ctx.lineJoin = ctx.lineCap = "round";
    // sobre o satélite: traço claro com contorno escuro (lê em mata e em solo exposto)
    const larg = (mestra: boolean) => Math.max(mestra ? 2.2 : 1.2, (mestra ? 0.9 : 0.42) * k * Math.max(1, q.W / 900));
    for (const halo of [true, false]) for (const mestra of [false, true]) for (const c of curvas) {
      if (c.mestra !== mestra) continue;
      ctx.strokeStyle = halo ? "rgba(40,20,4,0.45)" : mestra ? "rgba(255,196,96,1)" : "rgba(255,240,214,0.85)";
      ctx.lineWidth = larg(mestra) * (halo ? 2.2 : 1);
      caminho(c.pts, c.fechada);
      ctx.stroke();
    }
    const fs = Math.max(11, Math.round(Math.min(q.largura, q.altura) / 70));
    ctx.font = `700 ${fs}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const c of curvas) {
      if (!c.mestra) continue;
      for (const r of pontosDeRotulo(c.pts, (fs * 18) / k)) {
        const [x, y] = px(r.p);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((-r.ang * Math.PI) / 180);
        const t = intervalo < 1 ? fmt(c.cota, 1) : fmt(c.cota);
        ctx.lineWidth = fs * 0.28;
        ctx.strokeStyle = "rgba(255,250,240,0.95)";
        ctx.strokeText(t, 0, 0);
        ctx.fillStyle = "rgba(100,40,4,1)";
        ctx.fillText(t, 0, 0);
        ctx.restore();
      }
    }
  }
  // divisa do imóvel, amarela
  ctx.save();
  ctx.strokeStyle = "#ffd23f";
  ctx.lineWidth = Math.max(2.5, 0.9 * k * Math.max(1, q.W / 700));
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 4;
  for (const a of aneis) { caminho(a, true); ctx.stroke(); }
  ctx.restore();
}

function aplicarRotulos(el: HTMLDivElement | null, rs: Rotulo[]): void {
  if (!el) return;
  for (const r of rs) {
    let s = el.querySelector<HTMLSpanElement>(`span[data-q="${CSS.escape(r.chave)}"]`);
    if (!s) {
      s = document.createElement("span");
      s.className = r.tipo === "marco" ? "m3d-marco" : "m3d-quadra";
      s.dataset.q = r.chave; // por id/índice: dois marcos com o mesmo texto são dois rótulos
      s.textContent = r.texto;
      el.appendChild(s);
    }
    if (s.textContent !== r.texto) s.textContent = r.texto;
    s.style.display = r.visivel ? "" : "none";
    s.style.transform = `translate(${r.x}px, ${r.y}px)`;
  }
  // rótulo que não veio nesta leva (cena montada de novo com menos itens) some
  const chaves = new Set(rs.map((r) => r.chave));
  for (const s of el.querySelectorAll<HTMLSpanElement>("span[data-q]")) if (!chaves.has(s.dataset.q ?? "")) s.style.display = "none";
}

export default function Relevo3D({ nome, fuso, grade, aneis, marcos, curvas, intervalo, fonte, desnivel, onFechar }: Props) {
  const raiz = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const rotulosRef = useRef<HTMLDivElement>(null);
  const bussolaRef = useRef<HTMLDivElement>(null);
  const maq = useRef<Maquete | null>(null);
  const telas = useRef<{ tela: HTMLCanvasElement; antes: HTMLCanvasElement; q: Quadro; res: Resultado } | null>(null);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [etapa, setEtapa] = useState(0);
  const [satelite, setSatelite] = useState(true);
  const [comCurvas, setComCurvas] = useState(true);
  const [comMarcos, setComMarcos] = useState(true);
  const [paisagem, setPaisagem] = useState(true);
  const [exag, setExag] = useState(1);
  const [hora, setHora] = useState(9.5);
  const [cheia, setCheia] = useState(false);
  const cenaRef = useRef<Cena | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        if (!webglDisponivel()) { setErro(MOTIVO_SEM_WEBGL); return; }
        const pts = aneis.flat();
        const res = resultadoDoImovel(aneis, pts, pts.map(() => NaN));
        // a grade do relevo (UTM) no formato da maquete
        const terreno: GradeTerreno = { e0: grade.e0, n0: grade.n0, passo: grade.passo, nx: grade.nx, ny: grade.ny, h: Array.from(grade.h), fonte: "dem", calibracao: 0 };
        const c = montarCena(res, PARAMETROS_PADRAO, terreno, {});
        cenaRef.current = c;
        if (!vivo) return;
        setEtapa(1);
        await new Promise((r) => setTimeout(r, 30));
        const max = (() => {
          const gl = document.createElement("canvas").getContext("webgl2");
          const m = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096;
          gl?.getExtension("WEBGL_lose_context")?.loseContext();
          return Math.min(4096, m);
        })();
        const q = quadroDaGrade(c.grade, max);
        const antes = Object.assign(document.createElement("canvas"), { width: q.largura, height: q.altura });
        const ca = antes.getContext("2d")!;
        ca.fillStyle = "#7d8a64";
        ca.fillRect(0, 0, q.largura, q.altura);
        const temSat = await pintarSatelite(ca, q, res, fuso);
        if (!temSat) pintarCampo(ca, q, c.grade);
        if (!vivo) return;
        setSatelite(temSat);
        setEtapa(2);
        const tela = Object.assign(document.createElement("canvas"), { width: q.largura, height: q.altura });
        telas.current = { tela, antes, q, res };
        const tx = tela.getContext("2d")!;
        tx.drawImage(antes, 0, 0);
        pintarRelevo(tx, q, res, aneis, curvas, intervalo, true);
        // o "antes" também com a divisa (é o que aparece sem as curvas)
        pintarRelevo(ca, q, res, aneis, curvas, intervalo, false);
        if (!vivo || !caixa.current) return;
        const lat = proj(utmDef(fuso), GEO_DEF, paraUtm(res.plano, c.centro))[1];
        const m = new Maquete(caixa.current, res, c, tela, antes, lat, {
          onRotulos: (r) => aplicarRotulos(rotulosRef.current, r),
          onBussola: (rumo) => { if (bussolaRef.current) bussolaRef.current.style.transform = `rotate(${-rumo}rad)`; },
          onHora: (h) => setHora(Math.round(h * 10) / 10),
        });
        maq.current = m;
        m.setMarcos(marcos.map((x) => ({ texto: x.texto, p: paraPlano(res.plano, x.p as PtGeom) })));
        if (import.meta.env.DEV) (window as unknown as { __relevo3d?: Maquete }).__relevo3d = m;
        setExag(Math.round(m.U.uExag.value * 10) / 10);
        // vizinhança por satélite até o horizonte (não segura a abertura)
        void (async () => {
          const g = c.grade, cx = g.x0 + ((g.nx - 1) * g.passo) / 2, cy = g.y0 + ((g.ny - 1) * g.passo) / 2;
          const S = Math.max(60, c.raio) * 9.6;
          const qe: Quadro = { largura: 2048, altura: 2048, x0: cx - S, y0: cy - S, W: 2 * S, H: 2 * S };
          const ce = Object.assign(document.createElement("canvas"), { width: qe.largura, height: qe.altura });
          const cx2 = ce.getContext("2d")!;
          cx2.fillStyle = "#7d8a64";
          cx2.fillRect(0, 0, qe.largura, qe.altura);
          if (!(await pintarSatelite(cx2, qe, res, fuso))) pintarCampo(cx2, qe, c.grade);
          if (vivo) m.setEntorno(ce, qe);
        })();
        setEtapa(3);
        setPronto(true);
      } catch (e) {
        console.error(e);
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { vivo = false; maq.current?.destruir(); maq.current = null; };
    // a maquete é montada uma vez por abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // curvas ligadas/desligadas: o chão mostra o satélite com curvas ou só com a divisa
  useEffect(() => {
    const t = telas.current, m = maq.current;
    if (!pronto || !t || !m) return;
    const ctx = t.tela.getContext("2d")!;
    ctx.drawImage(t.antes, 0, 0);
    if (comCurvas) pintarRelevo(ctx, t.q, t.res, aneis, curvas, intervalo, true);
    m.atualizarChao();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comCurvas, pronto]);
  useEffect(() => { maq.current?.setVisivelMarcos(comMarcos); }, [comMarcos]);
  useEffect(() => { maq.current?.setExagero(exag); }, [exag]);
  useEffect(() => { maq.current?.setHora(hora); }, [hora]);
  useEffect(() => { if (pronto) maq.current?.setPaisagem(paisagem); }, [paisagem, pronto]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape" && !document.fullscreenElement) onFechar();
    };
    addEventListener("keydown", h, true);
    return () => removeEventListener("keydown", h, true);
  }, [onFechar]);
  useEffect(() => {
    raiz.current?.focus();
    document.documentElement.classList.add("m3d-aberta");
    const fs = () => setCheia(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fs);
    return () => {
      document.documentElement.classList.remove("m3d-aberta");
      document.removeEventListener("fullscreenchange", fs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);

  const alternarCheia = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void raiz.current?.requestFullscreen?.().catch(() => {});
  };
  const foto = async () => {
    const b = await maq.current?.foto();
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = Object.assign(document.createElement("a"), { href: url, download: `RELEVO_3D_${(nome || "IMOVEL").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "_").toUpperCase()}.png` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const etapas = [
    "Montando o terreno pelo modelo de relevo do imóvel",
    "Imagem de satélite da vizinhança",
    "Desenhando curvas, divisa e marcos",
  ];

  // no body: por cima do menu, das etapas e do rodapé do serviço (tela cheia de verdade)
  return createPortal(
    <div className="m3d rl3d" role="dialog" aria-modal="true" aria-label="Relevo do imóvel em 3D" tabIndex={-1} ref={raiz}>
      <div className="m3d-tela" ref={caixa} />
      <div className="m3d-rotulos" ref={rotulosRef} aria-hidden style={{ visibility: pronto ? "visible" : "hidden" }} />

      <header className="m3d-topo">
        <div className="m3d-titulo">
          <span className="m3d-selo">RELEVO 3D</span>
          <b>{nome || "Imóvel"}</b>
          <span className="m3d-chips">
            <i>desnível {fmt(desnivel, 1)} m</i>
            <i>curvas de {fmt(intervalo, intervalo < 1 ? 1 : 0)} m</i>
            <i>{marcos.length} marcos</i>
          </span>
        </div>
        <div className="m3d-acoes">
          <button disabled={!pronto} onClick={() => void foto()} title="Foto em alta resolução (PNG)">
            <svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg>Foto
          </button>
          <button onClick={alternarCheia} title={cheia ? "Sair da tela cheia" : "Tela cheia"} aria-pressed={cheia}>
            <svg viewBox="0 0 24 24"><path d={cheia ? "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" : "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"} /></svg>{cheia ? "Sair da tela cheia" : "Tela cheia"}
          </button>
          <button className="m3d-fechar" onClick={onFechar} title="Fechar (Esc)">✕</button>
        </div>
      </header>

      {pronto && (
        <aside className="m3d-painel rl3d-painel">
          <div className="m3d-camadas">
            <label><input type="checkbox" checked={comCurvas} onChange={(e) => setComCurvas(e.target.checked)} />Curvas de nível</label>
            <label><input type="checkbox" checked={comMarcos} onChange={(e) => setComMarcos(e.target.checked)} />Marcos</label>
            <label title="Céu, a vizinhança por satélite até o horizonte e névoa de distância"><input type="checkbox" checked={paisagem} onChange={(e) => setPaisagem(e.target.checked)} />Paisagem</label>
          </div>
          <label className="m3d-faixa">
            <span>Relevo<b>{fmt(exag, 1)}×</b></span>
            <input type="range" min={1} max={4} step={0.1} value={exag} onChange={(e) => setExag(+e.target.value)} />
            {exag > 1.05 && <small>Altura exagerada para leitura — as cotas são as reais.</small>}
          </label>
          <label className="m3d-faixa">
            <span>Sol<b>{hhmm(hora)}</b></span>
            <input type="range" min={6} max={18} step={0.1} value={hora} onChange={(e) => setHora(+e.target.value)} />
          </label>
          <p className="m3d-fonte">
            {fonte === "dem"
              ? "Cotas dos marcos: levantamento GNSS. Miolo do imóvel: modelo digital de elevação público (~30 m), ajustado aos marcos — indicativo, não é levantamento."
              : "Sem o modelo digital público (rede): o terreno é só interpolado entre os marcos."}
            {!satelite && " Sem imagem de satélite (rede)."}
          </p>
        </aside>
      )}

      {pronto && (
        <div className="m3d-bussola" title="Norte" aria-label="Norte">
          <div ref={bussolaRef}><svg viewBox="0 0 40 40"><path d="M20 4l6 16h-12z" fill="#ff5a4a" /><path d="M20 36l-6-16h12z" fill="rgba(255,255,255,0.75)" /></svg><span>N</span></div>
        </div>
      )}

      {pronto && (
        <div className="m3d-base">
          <button onClick={() => maq.current?.visaoGeral()}>Vista geral</button>
          <button onClick={() => maq.current?.vistaDeCima()}>De cima</button>
        </div>
      )}
      {pronto && <p className="m3d-dica">Arraste para girar · botão direito move · roda aproxima</p>}

      {!pronto && (
        <div className="m3d-carregando">
          <div className="m3d-carregando-caixa">
            <div className="m3d-orbita"><i /><i /><i /></div>
            <h3>Montando o relevo em 3D</h3>
            <ul>
              {etapas.map((t, i) => <li key={i} className={i < etapa ? "feito" : i === etapa ? "agora" : ""}>{t}</li>)}
            </ul>
            {erro && <p className="m3d-erro">Não deu para montar o 3D: {erro}</p>}
            {erro && <button className="rl3d-voltar" onClick={onFechar}>Voltar</button>}
          </div>
        </div>
      )}
      {pronto && erro && <div className="m3d-aviso" onClick={() => setErro(null)}>{erro}</div>}
    </div>,
    document.body,
  );
}
