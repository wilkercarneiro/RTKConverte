// Maquete 3D do loteamento: tela cheia por cima do serviço. Carregada sob
// demanda (three.js só entra no navegador de quem abre a maquete).
import { useEffect, useMemo, useRef, useState } from "react";
import proj4mod from "proj4";
import { GEO_DEF, utmDef } from "../../../supabase/functions/_shared/geo.ts";
import type { Perimetro, Resultado } from "../../lib/loteamento/calculo.ts";
import { fmt } from "../../lib/loteamento/calculo.ts";
import type { Projeto } from "../../lib/loteamento/modelo.ts";
import type { GradeTerreno } from "../../lib/loteamento/terreno.ts";
import { buscarTerreno, gradeDoPerimetro } from "../../lib/loteamento/terreno.ts";
import type { Cena } from "../../lib/loteamento/cena3d.ts";
import { areaComTalude, cantosDaCena, montarCena } from "../../lib/loteamento/cena3d.ts";
import type { ModoChao } from "../../lib/loteamento/textura3d.ts";
import { desnivelDaGleba, intervaloCurvas, pintarCampo, pintarDivisa, pintarProjeto, pintarSatelite, quadroDaGrade } from "../../lib/loteamento/textura3d.ts";
import type { Quadro } from "../../lib/loteamento/textura3d.ts";
import { paraUtm } from "../../lib/loteamento/plano.ts";
import { Maquete } from "./maquete3d.ts";
import type { Rotulo } from "./maquete3d.ts";
import "./maquete3d.css";

const proj = proj4mod as unknown as (from: string, to: string, c: [number, number]) => [number, number];

interface Props {
  projeto: Projeto;
  res: Resultado;
  perimetro: Perimetro;
  fuso: number;
  onFechar: () => void;
}

type Etapa = { texto: string; feito: boolean };

const MODOS: { modo: ModoChao; rotulo: string; icone: string }[] = [
  { modo: "projeto", rotulo: "Projeto", icone: "M4 4h16v16H4zM4 12h16M12 4v16" },
  { modo: "declividade", rotulo: "Declividade", icone: "M3 20h18L3 6z" },
  { modo: "terraplenagem", rotulo: "Corte e aterro", icone: "M3 15c3-4 6-4 9 0s6 4 9 0M3 9h18" },
  { modo: "curvas", rotulo: "Curvas de nível", icone: "M4 16c4-6 12-6 16 0M7 16c2.5-3 7.5-3 10 0M10 16c1-1 3-1 4 0" },
];

function baixar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const nomeArq = (s: string) => (s || "LOTEAMENTO").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "_").toUpperCase();
/** O "estúdio" atrás da maquete acompanha o sol: azul-ardósia de dia, dourado e lilás no fim da tarde. */
function fundoDaHora(h: number): string {
  const ouro = Math.max(0, Math.min(1, Math.max((7.8 - h) / 1.6, (h - 16.2) / 1.8)));
  const mix = (a: number[], b: number[]) => a.map((v, i) => Math.round(v + (b[i] - v) * ouro)).join(",");
  const c1 = mix([58, 80, 104], [196, 120, 88]), c2 = mix([26, 34, 44], [58, 36, 62]), c3 = mix([16, 21, 27], [20, 16, 28]);
  return `radial-gradient(120% 90% at 50% 18%, rgb(${c1}) 0%, rgb(${c2}) 58%, rgb(${c3}) 100%)`;
}

const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

/** Rótulos das quadras: posicionados direto no DOM (o laço 3D roda a 60 quadros; re-render do React a cada um pesaria). */
function aplicarRotulos(el: HTMLDivElement | null, rs: Rotulo[]): void {
  if (!el) return;
  for (const r of rs) {
    let s = el.querySelector<HTMLSpanElement>(`span[data-q="${CSS.escape(r.texto)}"]`);
    if (!s) {
      s = document.createElement("span");
      s.className = "m3d-quadra";
      s.dataset.q = r.texto;
      s.textContent = r.texto;
      el.appendChild(s);
    }
    s.style.display = r.visivel ? "" : "none";
    s.style.transform = `translate(${r.x}px, ${r.y}px)`;
  }
}

export default function Visao3D({ projeto: projetoAberto, res: resAberto, perimetro: perimetroAberto, fuso, onFechar }: Props) {
  // o projeto da hora em que a maquete abriu (a cena foi montada com ele)
  const [projeto] = useState(projetoAberto);
  const [res] = useState(resAberto);
  const [perimetro] = useState(perimetroAberto);
  const raiz = useRef<HTMLDivElement>(null);
  const rotulosRef = useRef<HTMLDivElement>(null);
  const bussolaRef = useRef<HTMLDivElement>(null);
  const dicaRef = useRef<HTMLDivElement>(null);
  const [apresentando, setApresentando] = useState(false);
  const [painelAberto, setPainelAberto] = useState(() => typeof window === "undefined" || window.innerWidth >= 760);
  const caixa = useRef<HTMLDivElement>(null);
  const maq = useRef<Maquete | null>(null);
  const telas = useRef<{ projeto: HTMLCanvasElement; antes: HTMLCanvasElement; q: Quadro } | null>(null);
  const [etapas, setEtapas] = useState<Etapa[]>([
    { texto: "Lendo o relevo do terreno (modelo digital de elevação)", feito: false },
    { texto: "Terraplenagem das ruas e simulação das casas", feito: false },
    { texto: "Imagem de satélite da vizinhança", feito: false },
    { texto: "Montando a maquete", feito: false },
  ]);
  const [erro, setErro] = useState<string | null>(null);
  const [cena, setCena] = useState<Cena | null>(null);
  const [pronto, setPronto] = useState(false);
  const [modo, setModo] = useState<ModoChao>("projeto");
  const [camadas, setCamadas] = useState({ casas: true, arvores: true, meioFio: true, sombras: true });
  const [exag, setExag] = useState(1);
  const [hora, setHora] = useState(9.5);
  const [depois, setDepois] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  const [passo, setPasso] = useState<number | null>(null);
  const [anim, setAnim] = useState<{ rodando: boolean; prog: number }>({ rodando: false, prog: 0 });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [satelite, setSatelite] = useState(true);
  const [terrenoFonte, setTerrenoFonte] = useState<GradeTerreno["fonte"] | "plano">("plano");
  const ultimoProg = useRef(0);

  const marcar = (i: number) => setEtapas((e) => e.map((x, k) => (k <= i ? { ...x, feito: true } : x)));

  // ---- carregamento
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        // relevo cobrindo também a margem da maquete (a grade do projeto só vai 60 m além da divisa)
        const cantos = cantosDaCena(res).map((p) => paraUtm(res.plano, p));
        let terreno: GradeTerreno | null = null;
        try {
          const t = await buscarTerreno([...perimetro.pts, ...cantos], [...perimetro.altitudes, NaN, NaN, NaN, NaN], fuso);
          terreno = t?.fonte === "dem" ? t : (projeto.terreno ?? t);
        } catch {
          terreno = projeto.terreno ?? gradeDoPerimetro(perimetro.pts, perimetro.altitudes);
        }
        if (!vivo) return;
        setTerrenoFonte(terreno?.fonte ?? "plano");
        marcar(0);
        await new Promise((r) => setTimeout(r, 30));
        const c = montarCena(res, projeto.params, terreno);
        if (!vivo) return;
        marcar(1);
        await new Promise((r) => setTimeout(r, 30));
        // texturas: o satélite (também é o "antes") e o projeto por cima
        const max = (() => {
          const gl = document.createElement("canvas").getContext("webgl2");
          const m = gl ? (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) : 4096;
          gl?.getExtension("WEBGL_lose_context")?.loseContext();
          return Math.min(4096, m);
        })();
        const q = quadroDaGrade(c.grade, max);
        const qa = quadroDaGrade(c.grade, Math.min(2048, max));
        const antes = Object.assign(document.createElement("canvas"), { width: qa.largura, height: qa.altura });
        const ca = antes.getContext("2d")!;
        ca.fillStyle = "#7d8a64";
        ca.fillRect(0, 0, qa.largura, qa.altura);
        const temSat = await pintarSatelite(ca, qa, res, fuso);
        if (!temSat) pintarCampo(ca, qa, c.grade);
        // a divisa também no "Hoje": o cliente vê onde fica a gleba no mato
        pintarDivisa(ca, qa, res);
        if (!vivo) return;
        setSatelite(temSat);
        marcar(2);
        const tela = Object.assign(document.createElement("canvas"), { width: q.largura, height: q.altura });
        telas.current = { projeto: tela, antes, q };
        pintar(tela, antes, q, c, "projeto");
        await new Promise((r) => setTimeout(r, 30));
        if (!vivo || !caixa.current) return;
        const lat = proj(utmDef(fuso), GEO_DEF, paraUtm(res.plano, c.centro))[1];
        const m = new Maquete(caixa.current, res, c, tela, antes, lat, {
          onPasso: (k) => setPasso(k),
          onClique: (k) => setSel(k),
          onRotulos: (r) => aplicarRotulos(rotulosRef.current, r),
          onBussola: (rumo) => { if (bussolaRef.current) bussolaRef.current.style.transform = `rotate(${-rumo}rad)`; },
          onAnimacao: (rodando, prog) => {
            // estado do React só de vez em quando (o laço roda a 60 quadros)
            const agora = performance.now();
            if (!rodando || prog >= 1 || prog === 0 || agora - ultimoProg.current > 150) {
              ultimoProg.current = agora;
              setAnim({ rodando, prog });
            }
            if (!rodando && !m.gravando) setApresentando(false);
          },
        });
        maq.current = m;
        m.setCartela({
          nome: projeto.nome || "Loteamento",
          linha: `${res.lotes.length} lotes · ${res.quadras.length} quadras · ${fmt(res.quadro.gleba / 1e4, 2)} ha`,
          rodape: "Maquete ilustrativa — ocupação simulada; relevo do modelo digital de elevação",
        });
        // laboratório: a maquete fica acessível no console para inspeção
        if (import.meta.env.DEV) (window as unknown as { __maquete?: Maquete }).__maquete = m;
        setExag(Math.round(m.U.uExag.value * 10) / 10);
        setCena(c);
        marcar(3);
        setPronto(true);
        m.abertura();
      } catch (e) {
        console.error(e);
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { vivo = false; maq.current?.destruir(); maq.current = null; };
    // a maquete é montada uma vez por abertura
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pintar(tela: HTMLCanvasElement, antes: HTMLCanvasElement, q: Quadro, c: Cena, m: ModoChao) {
    const ctx = tela.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(antes, 0, 0, q.largura, q.altura);
    pintarProjeto(ctx, q, { res, cena: c, modo: m });
  }

  // ---- reações aos controles
  useEffect(() => {
    if (!pronto || !telas.current || !cena || !maq.current) return;
    pintar(telas.current.projeto, telas.current.antes, telas.current.q, cena, modo);
    maq.current.atualizarChao();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, pronto]);
  useEffect(() => { maq.current?.setExagero(exag); }, [exag]);
  useEffect(() => { maq.current?.setHora(hora); }, [hora]);
  useEffect(() => { maq.current?.setVisivel("casas", camadas.casas); maq.current?.setVisivel("arvores", camadas.arvores); maq.current?.setVisivel("meioFio", camadas.meioFio); }, [camadas.casas, camadas.arvores, camadas.meioFio]);
  useEffect(() => { maq.current?.setSombras(camadas.sombras); }, [camadas.sombras]);
  useEffect(() => { maq.current?.selecionar(sel); }, [sel]);
  // teclado: a maquete fica com as teclas (na captura, antes do editor que está por trás —
  // senão Esc limpava o desenho, Delete apagava o lote e Ctrl+Z desfazia o projeto)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key !== "Escape") return;
      if (apresentando && ocupado !== "video") { maq.current?.pararAnimacao(); setApresentando(false); }
      else if (sel !== null) setSel(null);
      else if (ocupado !== "video") onFechar();
    };
    addEventListener("keydown", h, true);
    return () => removeEventListener("keydown", h, true);
  }, [sel, onFechar, ocupado, apresentando]);
  // a página por baixo não rola nem alarga a tela (no celular, conteúdo mais largo
  // que a tela esticava a área de layout e a maquete saía cortada)
  useEffect(() => {
    raiz.current?.focus();
    document.documentElement.classList.add("m3d-aberta");
    return () => document.documentElement.classList.remove("m3d-aberta");
  }, []);
  const talude = useMemo(() => (cena && sel !== null ? areaComTalude(cena.grade, sel) : 0), [cena, sel]);
  const gravando = ocupado === "video";

  // ---- números do painel
  const resumo = useMemo(() => {
    if (!cena) return null;
    const g = cena.grade;
    const faixas = [0, 0, 0, 0];
    let nLote = 0;
    for (let k = 0; k < g.lote.length; k++) {
      if (g.lote[k] < 0) continue;
      nLote++;
      const s = g.decl[k];
      faixas[s < 8 ? 0 : s < 15 ? 1 : s < 30 ? 2 : 3]++;
    }
    const pct = faixas.map((f) => (nLote ? (100 * f) / nLote : 0));
    const lotesAcima30 = cena.infoLotes.filter((x) => x.declMedia >= 30).length;
    const dg = desnivelDaGleba(g);
    return { pct, lotesAcima30, intervalo: intervaloCurvas(dg.max - dg.min), desnivel: dg.max - dg.min };
  }, [cena]);

  async function acao(nome: string, f: () => Promise<void>) {
    setOcupado(nome);
    try { await f(); } catch (e) { setErro(e instanceof Error ? e.message : String(e)); } finally { setOcupado(null); }
  }

  const base = nomeArq(projeto.nome);
  const l = sel !== null ? res.lotes[sel] : null;
  const info = sel !== null && cena ? cena.infoLotes[sel] : null;
  const lp = passo !== null ? res.lotes[passo] : null;
  const confr = l ? Object.entries(l.lados.reduce<Record<string, number>>((acc, x) => { acc[x.nome] = (acc[x.nome] ?? 0) + x.comp; return acc; }, {})) : [];
  const classeDecl = (s: number) => (s < 8 ? ["plano", "Plano"] : s < 15 ? ["suave", "Suave"] : s < 30 ? ["forte", "Forte"] : ["proibido", "Acima de 30%"]);

  return (
    <div className={`m3d${apresentando || gravando ? " m3d-apresentando" : ""}`} role="dialog" aria-modal="true" aria-label="Maquete 3D do loteamento" tabIndex={-1} ref={raiz}
      style={{ "--m3d-fundo": fundoDaHora(hora) } as React.CSSProperties}
      onPointerMove={(e) => { const d = dicaRef.current; if (d) d.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 18}px)`; }}>
      <div className="m3d-tela" ref={caixa} />

      {/* rótulos das quadras */}
      <div className="m3d-rotulos" ref={rotulosRef} aria-hidden style={{ visibility: pronto ? "visible" : "hidden" }} />

      {/* topo */}
      <header className="m3d-topo">
        <div className="m3d-titulo">
          <span className="m3d-selo">MAQUETE 3D</span>
          <b>{projeto.nome || "Loteamento"}</b>
          <span className="m3d-chips">
            <i>{res.lotes.length} lotes</i>
            <i>{res.quadras.length} quadras</i>
            <i>{fmt(res.quadro.gleba / 1e4, 2)} ha</i>
            {cena && <i>{cena.casas.length} casas simuladas</i>}
          </span>
        </div>
        <div className="m3d-acoes">
          <button disabled={!pronto || !!ocupado} onClick={() => acao("foto", async () => { const b = await maq.current!.foto(); if (b) baixar(b, `MAQUETE_${base}.png`); })} title="Foto em alta resolução (PNG)">
            <svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg>{ocupado === "foto" ? "Gerando…" : "Foto"}
          </button>
          <button disabled={!pronto || !!ocupado} onClick={() => acao("video", async () => { const r = await maq.current!.gravarVoo(); baixar(r.blob, `VOO_${base}.${r.ext}`); })} title="Vídeo pronto para o cliente (~40 s): nome do empreendimento, o terreno de hoje virando o projeto, voo de drone e os números">
            <svg viewBox="0 0 24 24"><path d="M3 7h12v10H3zM15 10l6-3v10l-6-3z" /></svg>{ocupado === "video" ? "Gravando…" : "Vídeo de apresentação"}
          </button>
          <button disabled={!pronto || !!ocupado} onClick={() => acao("glb", async () => baixar(await maq.current!.exportarGlb(), `MAQUETE_${base}.glb`))} title="Modelo 3D (glTF/GLB) para SketchUp, Blender, Twinmotion, Lumion">
            <svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5" /></svg>{ocupado === "glb" ? "Exportando…" : "Modelo GLB"}
          </button>
          <button className="m3d-fechar" onClick={onFechar} disabled={gravando} title={gravando ? "Gravando o vídeo…" : "Fechar (Esc)"}>✕</button>
        </div>
      </header>

      {/* painel esquerdo */}
      {pronto && cena && resumo && !painelAberto && (
        <button className="m3d-abrir-painel" onClick={() => setPainelAberto(true)}>
          <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /></svg>Visualizar
        </button>
      )}
      {pronto && cena && resumo && painelAberto && (
        <aside className="m3d-painel">
          <button className="m3d-recolher" onClick={() => setPainelAberto(false)} title="Recolher o painel">‹</button>
          <div className="m3d-modos">
            {MODOS.map((m) => (
              <button key={m.modo} className={modo === m.modo ? "ativo" : ""} disabled={!depois} onClick={() => setModo(m.modo)}>
                <svg viewBox="0 0 24 24"><path d={m.icone} /></svg>{m.rotulo}
              </button>
            ))}
          </div>
          {!depois && <p className="m3d-hoje">Mostrando o terreno de hoje. As análises valem para o projeto — clique em <b>Projeto</b>.</p>}
          <div className="m3d-legenda" hidden={!depois}>
            {modo === "projeto" && (
              <ul>
                <li><i style={{ background: "#98b67f" }} />Lotes</li>
                <li><i style={{ background: "#43474d" }} />Pista de rolamento</li>
                <li><i style={{ background: "#d9d3c5" }} />Calçada</li>
                <li><i style={{ background: "#6f9f5c" }} />Área verde / lazer</li>
                <li><i style={{ background: "#e3d4b0" }} />Institucional</li>
                {res.areas.some((a) => a.tipo === "app") && <li><i style={{ background: "#4b7341" }} />APP (mata)</li>}
                <li><i className="linha" style={{ borderColor: "#ffd23f" }} />Divisa da gleba</li>
                {res.faixasRestricao.length > 0 && <li><i className="linha tracejada" style={{ borderColor: "#e04a3a" }} />Faixa non aedificandi</li>}
              </ul>
            )}
            {modo === "declividade" && (
              <>
                <ul>
                  <li><i style={{ background: "#4caf50" }} />0–8% plano<em>{fmt(resumo.pct[0], 0)}%</em></li>
                  <li><i style={{ background: "#9ccc65" }} />8–15% suave<em>{fmt(resumo.pct[1], 0)}%</em></li>
                  <li><i style={{ background: "#ffb300" }} />15–30% forte<em>{fmt(resumo.pct[2], 0)}%</em></li>
                  <li><i style={{ background: "#e53935" }} />≥ 30%<em>{fmt(resumo.pct[3], 0)}%</em></li>
                </ul>
                <p>{resumo.lotesAcima30 ? `${resumo.lotesAcima30} lote(s) com declividade média ≥ 30% — a Lei 6.766 (art. 3º) só permite parcelar com exigências específicas.` : "Nenhum lote com declividade média ≥ 30% (Lei 6.766, art. 3º)."} Percentuais da área dos lotes.</p>
              </>
            )}
            {modo === "terraplenagem" && (
              <>
                <ul>
                  <li><i style={{ background: "#e13c28" }} />Corte<em>{fmt(cena.volumes.corte, 0)} m³</em></li>
                  <li><i style={{ background: "#286ee6" }} />Aterro<em>{fmt(cena.volumes.aterro, 0)} m³</em></li>
                </ul>
                <p>Greide das ruas pelo terreno suavizado (raio ~9 m), taludes 1:1,5 até o terreno natural. Estimativa para estudo — não substitui o projeto geométrico.</p>
              </>
            )}
            {modo === "curvas" && <p>Curvas a cada {fmt(resumo.intervalo, resumo.intervalo < 1 ? 2 : 0)} m (mestras a cada {fmt(resumo.intervalo * 5, resumo.intervalo < 1 ? 2 : 0)} m), do terreno já com as ruas. Desnível na gleba: {fmt(resumo.desnivel, 1)} m.</p>}
          </div>
          <div className="m3d-camadas">
            {([["casas", "Casas"], ["arvores", "Árvores"], ["meioFio", "Meio-fio"], ["sombras", "Sombras"]] as const).map(([k, r]) => (
              <label key={k}><input type="checkbox" checked={camadas[k]} onChange={(e) => setCamadas({ ...camadas, [k]: e.target.checked })} />{r}</label>
            ))}
          </div>
          <label className="m3d-faixa">
            <span>Relevo<b>{fmt(exag, 1)}×</b></span>
            <input type="range" min={1} max={3} step={0.1} value={exag} onChange={(e) => setExag(+e.target.value)} />
            {exag > 1.05 && <small>Altura exagerada para leitura — medidas e cores usam a cota real.</small>}
          </label>
          <label className="m3d-faixa">
            <span>Sol<b>{hhmm(hora)}</b></span>
            <input type="range" min={6} max={18} step={0.1} value={hora} onChange={(e) => setHora(+e.target.value)} />
          </label>
          <p className="m3d-fonte">
            Relevo: {terrenoFonte === "dem" ? "modelo digital de elevação calibrado pelo GNSS" : terrenoFonte === "perimetro" ? "cotas dos marcos do perímetro" : "plano (sem cotas)"}.
            {!satelite && " Sem imagem de satélite (rede)."}
          </p>
        </aside>
      )}

      {/* lote sob o cursor */}
      <div className="m3d-passo" ref={dicaRef} hidden={!lp || passo === sel || apresentando}>
        {lp && <><b>Quadra {lp.quadra} · Lote {lp.numero}</b> {fmt(lp.area)} m²</>}
      </div>

      {/* bússola: o norte da maquete */}
      {pronto && (
        <div className="m3d-bussola" title="Norte" aria-label="Norte">
          <div ref={bussolaRef}><svg viewBox="0 0 40 40"><path d="M20 4l6 16h-12z" fill="#ff5a4a" /><path d="M20 36l-6-16h12z" fill="rgba(255,255,255,0.75)" /></svg><span>N</span></div>
        </div>
      )}

      {/* ficha do lote */}
      {l && info && cena && (
        <aside className="m3d-ficha">
          <button className="m3d-ficha-fechar" onClick={() => setSel(null)} title="Fechar">✕</button>
          <span className="m3d-ficha-sup">Quadra {l.quadra}</span>
          <h3>Lote {l.numero}</h3>
          <div className="m3d-ficha-area"><b>{fmt(l.area)}</b> m²</div>
          <div className="m3d-ficha-grade">
            <div><span>Frente</span><b>{fmt(l.frente)} m</b></div>
            <div><span>Profundidade</span><b>{fmt(l.profundidade)} m</b></div>
            <div><span>Cota</span><b>{fmt(info.cotaMin, 1)}–{fmt(info.cotaMax, 1)}</b></div>
            <div><span>Desnível</span><b>{fmt(info.cotaMax - info.cotaMin, 1)} m</b></div>
          </div>
          <div className={`m3d-decl ${classeDecl(info.declMedia)[0]}`}>
            <span>Declividade média</span><b>{fmt(info.declMedia, 1)}%</b><em>{classeDecl(info.declMedia)[1]}</em>
          </div>
          {projeto.params.precoM2 > 0 && <div className="m3d-preco"><span>Valor estimado</span><b>R$ {fmt(l.area * projeto.params.precoM2, 0)}</b></div>}
          {talude > 1 && <p className="m3d-nota">{fmt(talude, 0)} m² na faixa de talude da rua.</p>}
          <h4 className="m3d-confr-tit">Confrontações</h4>
          <ul className="m3d-confr">
            {confr.map(([n, c]) => <li key={n}><span>{n}</span><b>{fmt(c)} m</b></li>)}
          </ul>
          <button className="m3d-perto" disabled={gravando} onClick={() => maq.current?.focarLote(sel!)}>Ver de perto</button>
        </aside>
      )}

      {/* barra de baixo */}
      {pronto && (
        <div className="m3d-base">
          <div className="m3d-antes">
            <button className={!depois ? "ativo" : ""} disabled={gravando} onClick={() => { setDepois(false); maq.current?.alternarAntes(false); }}>Hoje</button>
            <button className={depois ? "ativo" : ""} disabled={gravando} onClick={() => { setDepois(true); maq.current?.alternarAntes(true); }}>Projeto</button>
          </div>
          <button className="m3d-voo" disabled={!!ocupado} onClick={() => (anim.rodando ? maq.current?.pararAnimacao() : maq.current?.voo())}>
            {anim.rodando ? "■ Parar" : "▶ Voo de drone"}
          </button>
          <button disabled={gravando} onClick={() => maq.current?.visaoGeral()}>Vista geral</button>
          <button disabled={gravando} onClick={() => maq.current?.vistaDeCima()}>De cima</button>
          <button className="m3d-apresentar" disabled={!!ocupado} title="Tela cheia sem painéis: o terreno de hoje vira o projeto e o drone sobrevoa (Esc sai)"
            onClick={() => { setSel(null); setDepois(true); setApresentando(true); maq.current?.apresentacao(() => setApresentando(false)); }}>
            <svg viewBox="0 0 24 24"><path d="M4 5h16v11H4zM12 16v4M8 20h8M10 8l5 2.5-5 2.5z" /></svg>Apresentar
          </button>
        </div>
      )}
      {apresentando && !gravando && <button className="m3d-sair-apresentacao" onClick={() => { maq.current?.pararAnimacao(); setApresentando(false); }}>Sair da apresentação (Esc)</button>}
      {gravando && <div className="m3d-gravando"><i />Gravando o vídeo de apresentação… não feche a maquete</div>}
      {pronto && anim.rodando && <div className="m3d-progresso"><i style={{ width: `${anim.prog * 100}%` }} /></div>}
      {pronto && <p className="m3d-dica">Arraste para girar · botão direito move · roda aproxima · clique num lote</p>}

      {/* carregando */}
      {!pronto && (
        <div className="m3d-carregando">
          <div className="m3d-carregando-caixa">
            <div className="m3d-orbita"><i /><i /><i /></div>
            <h3>Construindo a maquete 3D</h3>
            <ul>
              {etapas.map((e, i) => <li key={i} className={e.feito ? "feito" : i === etapas.findIndex((x) => !x.feito) ? "agora" : ""}>{e.texto}</li>)}
            </ul>
            {erro && <p className="m3d-erro">Não deu para montar a maquete: {erro}</p>}
          </div>
        </div>
      )}
      {pronto && erro && <div className="m3d-aviso" onClick={() => setErro(null)}>{erro}</div>}
    </div>
  );
}
