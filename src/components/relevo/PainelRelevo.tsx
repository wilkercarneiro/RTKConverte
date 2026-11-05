// Vista "Relevo" do serviço GEO: curvas de nível sobre o imóvel, troca do
// intervalo, exportação (DXF/KML) e o botão "Ver em 3D".
//
// O cálculo (modelo de terreno + curvas) roda num Web Worker; o relevo de
// fundo vem dos mesmos tiles de elevação do loteamento. Método em
// src/lib/relevo/curvas.ts.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { Vertice } from "../../lib/types";
import type { Curva, GradeCotas, Pt } from "../../lib/relevo/curvas.ts";
import { caixaDe, cotaBilinear, pontosDeRotulo } from "../../lib/relevo/curvas.ts";
import type { ModeloRelevo } from "../../lib/relevo/modelo.ts";
import type { EntradaRelevo } from "../../lib/relevo/modelo.ts";
import { buscarRelevoDeFundo, calcularRelevoEmSegundoPlano, coberturaDoImovel, imovelDosVertices } from "../../lib/relevo/imovel.ts";
import { curvasParaDxf, curvasParaKml } from "../../lib/relevo/exportar.ts";
import { webglDisponivel, MOTIVO_SEM_WEBGL } from "../../lib/webgl";
import { Dica } from "../ui";
import { BotaoTelaCheia } from "../TelaCheia";
import "./relevo.css";

const Relevo3D = lazy(() => import("./Relevo3D"));

// laboratório: o cálculo fica no console para medir tempo num imóvel grande
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as { __relevoLab?: unknown }).__relevoLab = { calcularRelevoEmSegundoPlano, coberturaDoImovel };
}

interface Props {
  vertices: Vertice[];
  /** anéis (por ordem dos vértices): partes ou glebas; null = a sequência inteira */
  aneis: number[][] | null;
  fuso: number;
  nome: string;
  altura?: number;
}

const fmt = (v: number, c = 0) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const OPCOES = [1, 2, 5, 10] as const;

// o relevo de fundo é baixado uma vez por imóvel (trocar de vista e voltar não baixa de novo)
const cacheBase = new Map<string, Promise<EntradaRelevo["base"]>>();

function baixar(texto: string, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([texto], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const nomeArq = (s: string) => (s || "IMOVEL").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "_").replace(/^_|_$/g, "").toUpperCase();

/** Relevo sombreado + cor por altitude (fundo do desenho), recortado no imóvel com o entorno esmaecido. */
function imagemDoRelevo(g: GradeCotas, aneis: Pt[][], min: number, max: number, caixa: { min: Pt; max: Pt }): string | null {
  if (typeof document === "undefined") return null;
  const W = caixa.max[0] - caixa.min[0], H = caixa.max[1] - caixa.min[1];
  // ~640 px no lado maior (pixels por metro)
  const k = 640 / Math.max(W, H);
  const lw = Math.max(2, Math.round(W * k)), lh = Math.max(2, Math.round(H * k));
  const c = document.createElement("canvas");
  c.width = lw; c.height = lh;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(lw, lh);
  const d = Math.max(g.passo, 1);
  const amp = Math.max(1, max - min);
  // rampa hipsométrica suave: verde baixo → bege → marrom alto
  const rampa: [number, number, number][] = [[196, 222, 182], [226, 230, 178], [236, 214, 160], [214, 178, 132], [184, 146, 112]];
  // dentro/fora por varredura de linha (o teste ponto a ponto num perímetro de centenas de lados travava)
  const arestas: [Pt, Pt][] = [];
  for (const a of aneis) for (let i = 0; i < a.length; i++) arestas.push([a[i], a[(i + 1) % a.length]]);
  const dentroLinha = new Uint8Array(lw);
  for (let y = 0; y < lh; y++) {
    const yy = caixa.max[1] - (y + 0.5) / k;
    const xs: number[] = [];
    for (const [a, b] of arestas) if ((a[1] > yy) !== (b[1] > yy)) xs.push(a[0] + ((yy - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
    xs.sort((u, v) => u - v);
    dentroLinha.fill(0);
    for (let q = 0; q + 1 < xs.length; q += 2) {
      const x0 = Math.max(0, Math.ceil((xs[q] - caixa.min[0]) * k - 0.5)), x1 = Math.min(lw - 1, Math.floor((xs[q + 1] - caixa.min[0]) * k - 0.5));
      for (let x = x0; x <= x1; x++) dentroLinha[x] = 1;
    }
  for (let x = 0; x < lw; x++) {
    const p: Pt = [caixa.min[0] + (x + 0.5) / k, yy];
    const z = cotaBilinear(g, p);
    const dzx = (cotaBilinear(g, [p[0] + d, p[1]]) - cotaBilinear(g, [p[0] - d, p[1]])) / (2 * d);
    const dzy = (cotaBilinear(g, [p[0], p[1] + d]) - cotaBilinear(g, [p[0], p[1] - d])) / (2 * d);
    // luz do noroeste, 45° de altura (exagero 3× para relevo suave aparecer)
    const nx = -dzx * 3, ny = -dzy * 3, nz = 1, nl = Math.hypot(nx, ny, nz);
    const luz = Math.max(0, (nx * -0.5 + ny * 0.5 + nz * 0.7071) / nl);
    const t = Math.max(0, Math.min(1, (z - min) / amp)) * (rampa.length - 1);
    const i0 = Math.floor(Math.min(rampa.length - 2, t)), f = t - i0;
    const s = 0.62 + 0.5 * luz;
    const dentro = dentroLinha[x] === 1;
    const o = (y * lw + x) * 4;
    for (let ch = 0; ch < 3; ch++) {
      const v = (rampa[i0][ch] * (1 - f) + rampa[i0 + 1][ch] * f) * s;
      img.data[o + ch] = dentro ? Math.min(255, v) : Math.min(255, 0.45 * v + 0.55 * 244);
    }
    img.data[o + 3] = 255;
  }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

export function PainelRelevo({ vertices, aneis: aneisOrdens, fuso, nome, altura = 440 }: Props) {
  const im = useMemo(() => imovelDosVertices(vertices, aneisOrdens), [vertices, aneisOrdens]);
  const chave = useMemo(() => `${fuso}|${im.pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(";")}|${im.hs.join(",")}`, [im, fuso]);
  const [intervalo, setIntervalo] = useState<number | null>(null);
  const [estado, setEstado] = useState<"relevo" | "calculo" | "pronto" | "erro">("relevo");
  const [erro, setErro] = useState<string | null>(null);
  const [m, setM] = useState<ModeloRelevo | null>(null);
  const [ver3d, setVer3d] = useState(false);
  const [imagem, setImagem] = useState<string | null>(null);
  const pedido = useRef(0);
  const comAltitude = im.hs.filter((h) => Number.isFinite(h) && h !== 0).length;

  useEffect(() => {
    if (im.aneis.length === 0 || comAltitude < 3) return;
    const n = ++pedido.current;
    let vivo = true;
    (async () => {
      try {
        setEstado(cacheBase.has(chave) ? "calculo" : "relevo");
        let base = cacheBase.get(chave);
        if (!base) {
          base = buscarRelevoDeFundo(im, fuso).catch(() => null);
          cacheBase.set(chave, base);
        }
        const b = await base;
        if (!vivo || n !== pedido.current) return;
        setEstado("calculo");
        const r = await calcularRelevoEmSegundoPlano({ base: b, pts: im.pts, hs: im.hs, aneis: im.aneis, intervalo, cobertura: coberturaDoImovel(im.pts) });
        if (!vivo || n !== pedido.current) return;
        if (!r) { setErro("os vértices não têm altitude suficiente"); setEstado("erro"); return; }
        setM(r);
        setEstado("pronto");
      } catch (e) {
        if (!vivo) return;
        setErro(e instanceof Error ? e.message : String(e));
        setEstado("erro");
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, intervalo]);

  // desenho: caixa do imóvel com folga
  const caixa = useMemo(() => {
    const b = caixaDe(im.aneis.flat());
    const f = Math.max(10, 0.06 * Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]));
    return { min: [b.min[0] - f, b.min[1] - f] as Pt, max: [b.max[0] + f, b.max[1] + f] as Pt };
  }, [im]);
  // a imagem de fundo depende só do modelo (não do intervalo)
  const gradeAtual = m?.grade;
  useEffect(() => {
    if (!gradeAtual || !m) return;
    const t = setTimeout(() => setImagem(imagemDoRelevo(gradeAtual, im.aneis, m.min, m.max, caixa)), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gradeAtual, caixa]);

  if (im.aneis.length === 0) return <p className="sub">Sem perímetro para desenhar o relevo.</p>;
  if (comAltitude < 3) {
    return <p className="sub">Os vértices não têm altitude (h): sem cota não dá para traçar as curvas de nível.</p>;
  }

  const W = caixa.max[0] - caixa.min[0], H = caixa.max[1] - caixa.min[1];
  const lado = Math.max(W, H);
  const X = (p: Pt) => p[0] - caixa.min[0];
  const Y = (p: Pt) => caixa.max[1] - p[1];
  const caminho = (pts: Pt[], fechar = false) => pts.map((p, i) => `${i ? "L" : "M"}${X(p).toFixed(2)} ${Y(p).toFixed(2)}`).join("") + (fechar ? "Z" : "");
  const fs = lado / 52;
  const iv = m?.intervalo ?? 0;
  const txtCota = (z: number) => (iv < 1 ? fmt(z, 1) : fmt(z));
  const exportar = (tipo: "dxf" | "kml") => {
    if (!m) return;
    const dados = { curvas: m.curvas, intervalo: m.intervalo, aneis: im.aneis, marcos: im.marcos, nome: nome || "IMÓVEL", fuso };
    const base = `CURVAS_${String(m.intervalo).replace(".", "_")}M_${nomeArq(nome)}`;
    if (tipo === "dxf") baixar(curvasParaDxf(dados), `${base}.dxf`, "application/dxf");
    else baixar(curvasParaKml(dados), `${base}.kml`, "application/vnd.google-earth.kml+xml");
  };
  const ocupado = estado === "relevo" || estado === "calculo";
  const sem3d = !webglDisponivel();

  return (
    <div className="relevo" data-tela-cheia="">
      <div className="relevo-barra">
        <div className="relevo-intervalo" role="group" aria-label="Intervalo das curvas">
          <span className="relevo-rotulo">Curvas a cada</span>
          <button type="button" className={intervalo === null ? "ativo" : ""} onClick={() => setIntervalo(null)}
            title="Escolhido pelo desnível do imóvel">Automático{m && intervalo === null ? ` (${fmt(m.intervaloAuto)} m)` : ""}</button>
          {OPCOES.map((v) => (
            <button type="button" key={v} className={intervalo === v ? "ativo" : ""} onClick={() => setIntervalo(v)}>{v} m</button>
          ))}
        </div>
        <div className="relevo-acoes">
          <button type="button" disabled={!m || ocupado} onClick={() => exportar("dxf")}
            title="Camadas CURVAS_MESTRAS e CURVAS_INTERMEDIARIAS, com a cota como elevação e escrita nas mestras (UTM)">Baixar DXF</button>
          <button type="button" disabled={!m || ocupado} onClick={() => exportar("kml")}
            title="Para o Google Earth: mestras e intermediárias em pastas separadas">Baixar KML</button>
          <button type="button" className="principal" disabled={!m || ocupado || sem3d} onClick={() => setVer3d(true)}
            title={sem3d ? MOTIVO_SEM_WEBGL : "Terreno do imóvel em 3D, com satélite, curvas e os marcos"}>Ver em 3D</button>
          <BotaoTelaCheia className="relevo-tela-cheia" />
        </div>
      </div>

      <div className="relevo-desenho" style={{ height: altura }}>
        <svg viewBox={`0 0 ${W.toFixed(2)} ${H.toFixed(2)}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Curvas de nível do imóvel">
          {imagem && <image href={imagem} x={0} y={0} width={W} height={H} preserveAspectRatio="none" />}
          {m && (
            <g fill="none" strokeLinejoin="round" strokeLinecap="round">
              {m.curvas.filter((c) => !c.mestra).map((c, i) => (
                <path key={`i${i}`} d={caminho(c.pts, c.fechada)} stroke="#9A6A3A" strokeOpacity={0.75} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
              ))}
              {m.curvas.filter((c) => c.mestra).map((c, i) => (
                <path key={`m${i}`} d={caminho(c.pts, c.fechada)} stroke="#6B3A12" strokeWidth={1.8} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          )}
          <g fill="none" stroke="#0E3B2B" strokeWidth={2.2} vectorEffect="non-scaling-stroke">
            {im.aneis.map((a, i) => <path key={i} d={caminho(a, true)} vectorEffect="non-scaling-stroke" />)}
          </g>
          {m && (
            <g fontSize={fs} fontWeight={700} fontFamily="Figtree, system-ui, sans-serif" textAnchor="middle" dominantBaseline="middle"
              fill="#5A2E0C" stroke="#FFF8EC" strokeWidth={fs * 0.28} paintOrder="stroke">
              {rotulosDasMestras(m.curvas, lado / 3.2).map((r, i) => (
                <text key={i} transform={`translate(${X(r.p).toFixed(2)} ${Y(r.p).toFixed(2)}) rotate(${(-r.ang).toFixed(1)})`}>{txtCota(r.cota)}</text>
              ))}
            </g>
          )}
          <g>
            {im.marcos.map((mk, i) => (
              <g key={i} transform={`translate(${X(mk.p).toFixed(2)} ${Y(mk.p).toFixed(2)})`}>
                <circle r={fs * 0.28} fill="#D8342A" stroke="#fff" strokeWidth={fs * 0.08} />
              </g>
            ))}
          </g>
        </svg>
        {ocupado && (
          <div className="relevo-carregando">
            <span className="relevo-giro" aria-hidden />
            {estado === "relevo" ? "Lendo o relevo do modelo digital de elevação…" : "Calculando o modelo do terreno e as curvas…"}
          </div>
        )}
        {estado === "erro" && <div className="relevo-carregando erro">Não deu para calcular o relevo: {erro}</div>}
      </div>

      {m && (
        <div className="relevo-legenda">
          <span><i className="relevo-l mestra" />Mestra a cada {fmt(m.intervalo * 5, m.intervalo < 1 ? 1 : 0)} m</span>
          <span><i className="relevo-l" />Intermediária a cada {fmt(m.intervalo, m.intervalo < 1 ? 1 : 0)} m</span>
          <span><i className="relevo-ponto" />Marco</span>
          <span>Cotas de <b>{fmt(m.min, 1)}</b> a <b>{fmt(m.max, 1)} m</b> (desnível {fmt(m.max - m.min, 1)} m)</span>
        </div>
      )}
      {m && (
        <p className="relevo-nota">
          {m.fonte === "dem" ? (
            <>
              <b>Nos marcos, a cota é a do levantamento GNSS.</b> No miolo do imóvel, onde não há ponto medido,
              o relevo é do <b>modelo digital de elevação público</b> (~30 m), ajustado para passar nos marcos — serve
              para ver o terreno, não é levantamento planialtimétrico.
              <Dica>
                Como é feito: o modelo público (SRTM/NASADEM pelos tiles de elevação da AWS, os mesmos do loteamento) é
                levado ao nível do levantamento pela mediana da diferença nos marcos (isso absorve a diferença entre a
                altitude elipsoidal do GNSS e a do modelo). Depois, um plano ajustado aos resíduos tira a inclinação do
                modelo e uma correção suave, que perde força a ~{fmt(m.ajuste.raio)} m dos marcos, faz o terreno passar
                exatamente em cada um. Antes do ajuste, o modelo diferia do levantamento {fmt(m.ajuste.rmsAntes, 1)} m em média
                (RMS) e até {fmt(m.ajuste.maxAntes, 1)} m nos {m.ajuste.n} marcos com altitude — é a ordem de grandeza da
                incerteza no miolo. Depois, sobram {fmt(m.ajuste.maxDepois * 100, 0)} cm nos marcos. Em mata fechada o modelo
                mede a copa das árvores.
              </Dica>
            </>
          ) : (
            <>
              <b>Sem o modelo digital público</b> (sem rede): as curvas saem só da interpolação entre as cotas dos marcos —
              o miolo do imóvel não tem informação de relevo.
            </>
          )}
        </p>
      )}

      {ver3d && m && (
        <Suspense fallback={<div className="m3d m3d-carregando"><div className="m3d-carregando-caixa"><div className="m3d-orbita"><i /><i /><i /></div><h3>Abrindo o 3D…</h3></div></div>}>
          <Relevo3D nome={nome} fuso={fuso} grade={m.grade} aneis={im.aneis} marcos={im.marcos} curvas={m.curvas}
            intervalo={m.intervalo} fonte={m.fonte} desnivel={m.max - m.min} onFechar={() => setVer3d(false)} />
        </Suspense>
      )}
    </div>
  );
}

/** Um rótulo de cota a cada `cada` metros de mestra (pelo menos um por curva). */
function rotulosDasMestras(curvas: Curva[], cada: number): { p: Pt; ang: number; cota: number }[] {
  const out: { p: Pt; ang: number; cota: number }[] = [];
  for (const c of curvas) if (c.mestra) for (const r of pontosDeRotulo(c.pts, cada)) out.push({ ...r, cota: c.cota });
  return out;
}
