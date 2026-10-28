// Etapa DIVISÃO EM PARTES IGUAIS (partilha): o motor corta o imóvel em partes de
// mesma área (ou na fração de cada herdeiro), o operador confere na prévia, gira
// as divisas se quiser, diz quem recebe cada parte e aplica.
//
// Aplicar grava os pontos novos das divisas como vértices M do perímetro e cada
// parte como uma gleba. A partir daí o serviço segue o caminho das glebas — a
// planta geral com todas as partes, a A3 de cada uma — e, com os códigos
// alocados, cada parte vira um GEO individual no nome do herdeiro.
import { useEffect, useMemo, useRef, useState } from "react";
import proj4 from "proj4";
import type { Gleba, ParametrosDivisao, Servico, Vertice } from "../lib/types";
import { dividir, ladosDaParte, sugerirDivisoes, type ResultadoDivisao } from "../lib/divisao";
import { ROTULO_DIVISAO, aplicarDivisao, denominacaoDaParte, entradaDoServico, medidasDasPartes, pontosLocacaoDivisao, publicadorUtm, type InfoParte } from "../lib/divisao_servico";
import { FORMATOS, arquivoLocacao, type FormatoLocacao } from "../lib/loteamento/saidas";

const CORES_PARTE = ["#2E86AB", "#E07A1F", "#3BA55C", "#A23B72", "#C9A227", "#5B5FC7", "#D1495B", "#1B998B", "#8D6A9F", "#6C8EAD"];
const fmt = (v: number, c = 4) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const fmtM = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const fmtM2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// a divisão só tem pontos: o DXF de linhas do loteamento não se aplica
const FORMATOS_LOCACAO = FORMATOS.filter((f) => f.id !== "dxf");

interface Props {
  servico: Servico;
  vertices: Vertice[];
  glebas: Gleba[];
  /** grava vértices, glebas e os parâmetros da divisão no serviço */
  onAplicar: (r: { vertices: Vertice[]; glebas: Gleba[]; divisao: ParametrosDivisao }) => void;
  /** herdeiro/nome/denominação editados depois de aplicada */
  onGlebas: (g: Gleba[]) => void;
}

function infoDe(g: Gleba | undefined, k: number): InfoParte {
  return {
    nome: g?.nome ?? `PARTE ${k + 1}`,
    herdeiro: g?.detentor_nome ?? "",
    cpf: g?.detentor_cpf ?? "",
    denominacao: g?.denominacao ?? "",
  };
}

export function DivisaoEditor({ servico, vertices, glebas, onAplicar, onGlebas }: Props) {
  const aplicadaAntes = vertices.some((v) => v.rotulo_txt === ROTULO_DIVISAO) && glebas.length >= 2;
  const [n, setN] = useState(() => (aplicadaAntes ? glebas.length : 2));
  const [iguais, setIguais] = useState(servico.divisao?.iguais ?? !glebas.some((g) => g.fracao && Math.abs(g.fracao - 1 / glebas.length) > 1e-6));
  const [pct, setPct] = useState<number[]>(() => glebas.length >= 2 && glebas.every((g) => g.fracao) ? glebas.map((g) => Math.round(g.fracao! * 10000) / 100) : []);
  const [azManual, setAzManual] = useState<number | null>(servico.divisao?.azimute ?? null);
  const [inverter, setInverter] = useState(!!servico.divisao?.inverter);
  const [linhas, setLinhas] = useState<InfoParte[]>(() => Array.from({ length: Math.max(n, glebas.length) }, (_, k) => infoDe(glebas[k], k)));

  const publicar = useMemo(() => publicadorUtm(servico.fuso_utm ?? 24, (f, t, c) => proj4(f, t, c)), [servico.fuso_utm]);
  const fracoes = useMemo(() => {
    if (iguais) return Array(n).fill(1);
    const base = Array.from({ length: n }, (_, k) => pct[k] ?? 100 / n);
    return base.map((v) => Math.max(0.01, v));
  }, [iguais, n, pct]);
  const somaPct = fracoes.reduce((s, f) => s + f, 0);
  const ent = useMemo(() => entradaDoServico(vertices, fracoes, inverter, publicar), [vertices, fracoes, inverter, publicar]);
  const sugestoes = useMemo(() => (ent.anel.length >= 3 ? sugerirDivisoes(ent) : []), [ent]);
  const az = azManual ?? sugestoes[0]?.azimute ?? 0;
  const r: ResultadoDivisao = useMemo(() => dividir(ent, az), [ent, az]);
  const temEstrada = !!ent.estrada?.some(Boolean);
  const comCodigo = vertices.some((v) => v.codigo && !v.codigo_provisorio);
  const nomesPartes = linhas.slice(0, n).map((l, i) => l.nome.trim() || `PARTE ${i + 1}`);
  const medidas = useMemo(() => medidasDasPartes(ent, r, nomesPartes), [ent, r, nomesPartes.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const [formato, setFormato] = useState<Exclude<FormatoLocacao, "dxf">>("penzd");
  const baixarLocacao = () => {
    const pontos = pontosLocacaoDivisao(ent, r, vertices);
    if (!pontos.length) return;
    const f = FORMATOS.find((x) => x.id === formato)!;
    const nome = (servico.denominacao ?? "IMOVEL").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toUpperCase();
    const blob = new Blob([arquivoLocacao(pontos, formato)], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `LOCACAO_DIVISAO_${nome || "IMOVEL"}_SIRGAS2000_UTM${servico.fuso_utm ?? 24}S.${f.ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  // a divisão aplicada ainda é a da prévia?
  const igualAplicada = aplicadaAntes && r.ok && glebas.length === r.partes.length && r.partes.every((p, k) =>
    p.anel.length === glebas[k].anel.length && p.anel.every((q, j) => {
      const e = q.vertice !== undefined ? Number(ent.base[q.vertice].e) : q.e;
      const nn = q.vertice !== undefined ? Number(ent.base[q.vertice].n) : q.n;
      return Math.hypot(e - glebas[k].anel[j][0], nn - glebas[k].anel[j][1]) < 0.002;
    }));

  const mudarN = (v: number) => {
    const novo = Math.max(2, Math.min(30, Math.round(v) || 2));
    setN(novo);
    setLinhas((ls) => Array.from({ length: Math.max(novo, ls.length) }, (_, k) => ls[k] ?? infoDe(undefined, k)));
    setPct([]);
  };
  const editarLinha = (k: number, patch: Partial<InfoParte>) => {
    const ls = linhas.map((l, i) => (i === k ? { ...l, ...patch } : l));
    setLinhas(ls);
    // aplicada: herdeiro, nome e denominação vão direto para a gleba (a geometria não muda)
    if (aplicadaAntes && glebas[k]) {
      onGlebas(glebas.map((g, i) => (i !== k ? g : {
        ...g,
        nome: ls[k].nome.trim() || `PARTE ${k + 1}`,
        detentor_nome: ls[k].herdeiro.trim() || null,
        detentor_cpf: ls[k].cpf.trim() || null,
        denominacao: ls[k].denominacao.trim() || null,
      })));
    }
  };
  const aplicar = () => {
    if (!r.ok) return;
    const res = aplicarDivisao(vertices, r, linhas.slice(0, n), fracoes, servico.id, glebas);
    onAplicar({ ...res, divisao: { azimute: azManual, inverter, iguais } });
  };

  // ---------------- prévia ----------------
  const svgRef = useRef<SVGSVGElement>(null);
  // arrasto no mapa: gira as divisas ou move a vista; sem mexer, é clique (seleciona a parte)
  const arrasto = useRef<{ x: number; y: number; moveu: boolean; a0: number; az0: number; c0: [number, number]; escala: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [foco, setFoco] = useState<[number, number] | null>(null);
  const [modo, setModo] = useState<"girar" | "mover">("girar");
  const [sel, setSel] = useState<number | null>(null);
  const [todasMedidas, setTodasMedidas] = useState(false);
  const vista = useMemo(() => {
    const xs = ent.anel.map((p) => p[0]), ys = ent.anel.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const lado = Math.max(x1 - x0, y1 - y0) || 1;
    const pad = lado * 0.08;
    return { x0: x0 - pad, y1: y1 + pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad, lado, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }, [ent.anel]);
  const X = (e: number) => e - vista.x0, Y = (nn: number) => vista.y1 - nn;
  // a janela visível: o desenho inteiro dividido pelo zoom, em volta do foco
  const [fx, fy] = foco ?? [vista.w / 2, vista.h / 2];
  const vw = vista.w / zoom, vh = vista.h / zoom;
  const k = vista.lado / 600 / zoom; // unidades por "pixel" de referência: texto e traço não crescem com o zoom
  const centro = (pts: { e: number; n: number }[]) => {
    // centroide da área (cai fora só em parte muito côncava)
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      const c = p.e * q.n - q.e * p.n;
      a += c; cx += (p.e + q.e) * c; cy += (p.n + q.n) * c;
    }
    return Math.abs(a) < 1e-9 ? pts[0] : { e: cx / (3 * a), n: cy / (3 * a) };
  };
  const paraSvg = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current, m = svg?.getScreenCTM();
    if (!svg || !m) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const q = pt.matrixTransform(m.inverse());
    return [q.x, q.y];
  };
  const anguloEm = (clientX: number, clientY: number) => {
    const [px, py] = paraSvg(clientX, clientY);
    return (Math.atan2(px - X(vista.cx), -(py - Y(vista.cy))) * 180) / Math.PI;
  };
  const ampliar = (fator: number, em?: [number, number]) => {
    const z = Math.min(60, Math.max(1, zoom * fator));
    const f = z / zoom;
    if (f === 1) return;
    // o ponto sob o cursor (ou o centro) fica parado
    const [ax, ay] = em ?? [fx, fy];
    setZoom(z);
    setFoco(z === 1 ? null : [ax + (fx - ax) / f, ay + (fy - ay) / f]);
  };
  // roda do mouse amplia em volta do cursor (listener nativo: o do React é
  // passivo e não impede a página de rolar junto)
  const ampliarRef = useRef(ampliar);
  ampliarRef.current = ampliar;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const roda = (ev: WheelEvent) => {
      ev.preventDefault();
      const m = svg.getScreenCTM();
      const pt = svg.createSVGPoint();
      pt.x = ev.clientX; pt.y = ev.clientY;
      const q = m ? pt.matrixTransform(m.inverse()) : null;
      ampliarRef.current(ev.deltaY < 0 ? 1.25 : 1 / 1.25, q ? [q.x, q.y] : undefined);
    };
    svg.addEventListener("wheel", roda, { passive: false });
    return () => svg.removeEventListener("wheel", roda);
  }, []);
  useEffect(() => { if (sel !== null && sel >= n) setSel(null); }, [n, sel]);
  const parteNoPonto = (x: number, y: number): number | null => {
    if (!r.ok) return null;
    const e = x + vista.x0, nn = vista.y1 - y;
    const i = r.partes.findIndex((p) => {
      let dentro = false;
      for (let a = 0, b = p.anel.length - 1; a < p.anel.length; b = a++) {
        const A = p.anel[a], B = p.anel[b];
        if ((A.n > nn) !== (B.n > nn) && e < ((B.e - A.e) * (nn - A.n)) / (B.n - A.n) + A.e) dentro = !dentro;
      }
      return dentro;
    });
    return i >= 0 ? i : null;
  };
  // lados de cada parte com a medida e o confrontante, na ordem do contorno
  const chaveNomes = nomesPartes.join("|");
  const ladosPartes = useMemo(() => !r.ok ? [] : r.partes.map((_, i) => ladosDaParte(r, i, ent.anel.length).map((l) => ({
    ...l,
    confrontante: l.aresta !== null
      ? (ent.confrontantes[l.aresta] ?? "")
      : `divisa com ${(l.vizinha !== null ? chaveNomes.split("|")[l.vizinha] : null) ?? "a parte vizinha"}`,
    estrada: l.aresta !== null && !!ent.estrada?.[l.aresta],
  }))), [r, ent, chaveNomes]);
  /** Medida escrita ao longo do lado, por fora da parte; lado curto na tela leva só o número (ver a tabela). */
  const rotuloLado = (l: { de: { e: number; n: number }; ate: { e: number; n: number }; comprimentoM: number }, j: number, c: { e: number; n: number }, cor: string) => {
    const x1 = X(l.de.e), y1 = Y(l.de.n), x2 = X(l.ate.e), y2 = Y(l.ate.n);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    let nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
    if (nx * (mx - X(c.e)) + ny * (my - Y(c.n)) < 0) { nx = -nx; ny = -ny; }
    let ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    if (ang > 90) ang -= 180; else if (ang < -90) ang += 180;
    const tx = mx - nx * 8 * k, ty = my - ny * 8 * k; // por dentro: a parte vizinha escreve do outro lado
    return L / k > 64 ? (
      <text key={j} x={tx} y={ty} transform={`rotate(${ang} ${tx} ${ty})`} fontSize={10.5 * k} textAnchor="middle" dominantBaseline="middle"
        fill={cor} stroke="#fff" strokeWidth={3 * k} paintOrder="stroke" fontWeight={600}>{fmtM2(l.comprimentoM)} m</text>
    ) : (
      <g key={j}>
        <circle cx={tx} cy={ty} r={6 * k} fill="#fff" stroke={cor} strokeWidth={1.2 * k} />
        <text x={tx} y={ty} fontSize={7.5 * k} textAnchor="middle" dominantBaseline="central" fill={cor} fontWeight={700}>{j + 1}</text>
      </g>
    );
  };

  return (
    <section className="bloco" id="bloco-divisao">
      <header>
        <h3>Divisão em partes iguais</h3>
        <span className="desc">
          partilha ou herança: o imóvel é cortado por divisas retas em partes de mesma área (ou na fração de cada um) —
          sai o GEO do imóvel inteiro e, depois, um GEO para cada parte
        </span>
      </header>

      <div className="dv">
        <div className="dv-mapa">
          <div className="dv-zoom">
            <button type="button" onClick={() => ampliar(1.5)} title="Ampliar" aria-label="Ampliar">+</button>
            <button type="button" onClick={() => ampliar(1 / 1.5)} disabled={zoom <= 1} title="Diminuir" aria-label="Diminuir">−</button>
            <button type="button" onClick={() => { setZoom(1); setFoco(null); }} disabled={zoom <= 1} title="Ver o imóvel inteiro">Inteiro</button>
            <span className="dv-zoom-sep" />
            <button type="button" className={modo === "girar" ? "ativa" : ""} onClick={() => setModo("girar")} title="Arrastar gira as divisas">Girar divisas</button>
            <button type="button" className={modo === "mover" ? "ativa" : ""} onClick={() => setModo("mover")} title="Arrastar move o mapa">Mover mapa</button>
            <label className="dv-zoom-check"><input type="checkbox" checked={todasMedidas} onChange={(e) => setTodasMedidas(e.target.checked)} /> Medidas de todas as partes</label>
          </div>
          <svg ref={svgRef} viewBox={`${fx - vw / 2} ${fy - vh / 2} ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet"
            className={modo === "mover" ? "dv-mover" : ""}
            onPointerDown={(ev) => {
              (ev.currentTarget as SVGSVGElement).setPointerCapture(ev.pointerId);
              const m = svgRef.current?.getScreenCTM();
              arrasto.current = { x: ev.clientX, y: ev.clientY, moveu: false, a0: anguloEm(ev.clientX, ev.clientY), az0: az, c0: [fx, fy], escala: m ? 1 / m.a : 1 };
            }}
            onPointerMove={(ev) => {
              const g = arrasto.current;
              if (!g) return;
              // até 4 px é clique, não arrasto (antes um clique já arredondava o azimute)
              if (!g.moveu && Math.hypot(ev.clientX - g.x, ev.clientY - g.y) < 4) return;
              g.moveu = true;
              if (modo === "mover") {
                setFoco([g.c0[0] - (ev.clientX - g.x) * g.escala, g.c0[1] - (ev.clientY - g.y) * g.escala]);
              } else {
                const d = anguloEm(ev.clientX, ev.clientY) - g.a0;
                setAzManual(Math.round((((g.az0 + d) % 180) + 180) % 180));
              }
            }}
            onPointerUp={(ev) => {
              const g = arrasto.current;
              arrasto.current = null;
              if (g && !g.moveu) {
                const i = parteNoPonto(...paraSvg(ev.clientX, ev.clientY));
                setSel(i === sel ? null : i);
              }
            }}>
            {/* imóvel */}
            <polygon points={ent.anel.map((p) => `${X(p[0])},${Y(p[1])}`).join(" ")} fill="#F3F6F4" stroke="#0033D9" strokeWidth={3 * k} />
            {r.ok && r.partes.map((p, i) => (
              <polygon key={i} points={p.anel.map((q) => `${X(q.e)},${Y(q.n)}`).join(" ")}
                fill={CORES_PARTE[i % CORES_PARTE.length]} fillOpacity={sel === null ? 0.22 : sel === i ? 0.4 : 0.1} stroke="#0033D9" strokeWidth={2.4 * k} />
            ))}
            {/* estrada */}
            {ent.anel.map((p, i) => {
              if (!ent.estrada?.[i]) return null;
              const q = ent.anel[(i + 1) % ent.anel.length];
              return <line key={`e${i}`} x1={X(p[0])} y1={Y(p[1])} x2={X(q[0])} y2={Y(q[1])} stroke="#D90D0D" strokeWidth={2.4 * k} />;
            })}
            {/* divisas novas */}
            {r.ok && r.divisas.map((d, i) => {
              const mx = (d.a.e + d.b.e) / 2, my = (d.a.n + d.b.n) / 2;
              return (
                <g key={`d${i}`}>
                  <line x1={X(d.a.e)} y1={Y(d.a.n)} x2={X(d.b.e)} y2={Y(d.b.n)} stroke="#0E3B2B" strokeWidth={2.2 * k} strokeDasharray={`${9 * k} ${5 * k}`} />
                  {!todasMedidas && sel === null && <text x={X(mx)} y={Y(my) - 6 * k} fontSize={11 * k} textAnchor="middle" fill="#0E3B2B" stroke="#fff" strokeWidth={3 * k} paintOrder="stroke">{fmtM(d.comprimentoM)} m</text>}
                </g>
              );
            })}
            {r.ok && r.novos.map((p, i) => (
              <circle key={`n${i}`} cx={X(p.e)} cy={Y(p.n)} r={5 * k} fill="#fff" stroke="#E07A1F" strokeWidth={2.4 * k} />
            ))}
            {/* parte selecionada: contorno em destaque e os vértices */}
            {r.ok && sel !== null && r.partes[sel] && (
              <g pointerEvents="none">
                <polygon points={r.partes[sel].anel.map((q) => `${X(q.e)},${Y(q.n)}`).join(" ")} fill="none" stroke={CORES_PARTE[sel % CORES_PARTE.length]} strokeWidth={4 * k} />
                {r.partes[sel].anel.map((q, j) => <circle key={j} cx={X(q.e)} cy={Y(q.n)} r={2.6 * k} fill="#12201A" />)}
              </g>
            )}
            {/* a medida de cada lado: da parte clicada, ou de todas */}
            {r.ok && r.partes.map((p, i) => (todasMedidas || sel === i) && (
              <g key={`m${i}`} pointerEvents="none">
                {(ladosPartes[i] ?? []).map((l, j) => rotuloLado(l, j, centro(p.anel), sel === i ? "#0E3B2B" : "#33413A"))}
              </g>
            ))}
            {/* rótulos das partes */}
            {r.ok && r.partes.map((p, i) => {
              const c = centro(p.anel);
              const l = linhas[i] ?? infoDe(undefined, i);
              return (
                <g key={`l${i}`} fontSize={13 * k} textAnchor="middle" fill="#12201A" stroke="#fff" strokeWidth={3.5 * k} paintOrder="stroke">
                  <text x={X(c.e)} y={Y(c.n) - 8 * k} fontWeight={700}>{l.nome || `PARTE ${i + 1}`}</text>
                  <text x={X(c.e)} y={Y(c.n) + 9 * k}>{fmt(p.areaM2 / 10000)} ha</text>
                  <text x={X(c.e)} y={Y(c.n) + 24 * k} fontSize={10.5 * k} fill="#33413A">{fmtM2(p.areaM2)} m²</text>
                  {l.herdeiro && <text x={X(c.e)} y={Y(c.n) + 39 * k} fontSize={11 * k} fill="#5B6B63">{l.herdeiro}</text>}
                </g>
              );
            })}
            {/* norte */}
            <g transform={`translate(${fx + vw / 2 - 26 * k} ${fy - vh / 2 + 30 * k})`} pointerEvents="none">
              <path d={`M0 ${-16 * k} L${7 * k} ${8 * k} L0 ${3 * k} L${-7 * k} ${8 * k} Z`} fill="#12201A" />
              <text y={22 * k} fontSize={11 * k} textAnchor="middle" fontWeight={700}>N</text>
            </g>
          </svg>
          <p className="dv-dica">
            Clique numa parte para ver a medida de cada lado · roda do mouse ou + / − para ampliar ·
            {modo === "girar" ? " arraste para girar as divisas" : " arraste para mover o mapa"} · tracejado = divisa nova, círculo laranja = marco a implantar
          </p>
          {r.ok && sel !== null && r.partes[sel] && (
            <div className="dv-detalhe">
              <div className="dv-detalhe-tit">
                <span className="dv-cor" style={{ background: CORES_PARTE[sel % CORES_PARTE.length] }} />
                <b>{nomesPartes[sel]}</b>
                {linhas[sel]?.herdeiro && <span className="sub">{linhas[sel].herdeiro}</span>}
                <button type="button" className="dv-fechar" onClick={() => setSel(null)} aria-label="Fechar">×</button>
              </div>
              <div className="dv-detalhe-totais">
                <div><span>Área total</span><b className="mono">{fmtM2(r.partes[sel].areaM2)} m²</b><small className="mono">{fmt(r.partes[sel].areaM2 / 10000)} ha</small></div>
                <div><span>Perímetro</span><b className="mono">{fmtM2(r.partes[sel].perimetroM)} m</b><small>{ladosPartes[sel]?.length ?? 0} lados</small></div>
                {temEstrada && <div><span>Frente p/ estrada</span><b className="mono">{fmtM2(r.partes[sel].frenteEstradaM)} m</b></div>}
              </div>
              <table>
                <thead><tr><th>Lado</th><th>Medida</th><th>Confronta com</th></tr></thead>
                <tbody>
                  {(ladosPartes[sel] ?? []).map((l, j) => (
                    <tr key={j} className={l.estrada ? "dv-m-estrada" : l.vizinha !== null ? "dv-m-divisa" : ""}>
                      <td className="mono">{j + 1}</td>
                      <td className="mono">{fmtM2(l.comprimentoM)} m</td>
                      <td>{l.confrontante}{l.estrada && " (estrada)"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="dv-controles">
          <label className="dv-campo">Quantas partes
            <div className="dv-contador">
              <button type="button" onClick={() => mudarN(n - 1)} disabled={n <= 2} aria-label="Menos uma parte">−</button>
              <input type="number" min={2} max={30} value={n} onChange={(e) => mudarN(Number(e.target.value))} />
              <button type="button" onClick={() => mudarN(n + 1)} disabled={n >= 30} aria-label="Mais uma parte">+</button>
            </div>
          </label>

          <div className="dv-campo">
            <span>Área de cada parte</span>
            <div className="dv-opcoes">
              <label><input type="radio" checked={iguais} onChange={() => setIguais(true)} /> Partes iguais</label>
              <label><input type="radio" checked={!iguais} onChange={() => setIguais(false)} /> Frações diferentes (meação, quinhões desiguais)</label>
            </div>
          </div>

          <div className="dv-campo">
            <span>Direção das divisas</span>
            <div className="dv-sugestoes">
              {sugestoes.map((s, i) => (
                <button type="button" key={i} className={Math.abs(s.azimute - az) < 0.05 ? "ativa" : ""}
                  onClick={() => setAzManual(i === 0 ? null : s.azimute)}
                  title={`${s.divisas.length} divisa(s), ${fmtM(s.divisas.reduce((a, d) => a + d.comprimentoM, 0))} m de cerca nova`}>
                  {i === 0 ? "Recomendada" : `Opção ${i + 1}`} · {fmtM(s.azimute)}°
                  {temEstrada && <small>{s.partes.every((p) => p.frenteEstradaM >= 5) ? "todas com frente" : "sem frente p/ alguma"}</small>}
                </button>
              ))}
            </div>
            <div className="dv-giro">
              <input type="range" min={0} max={179.9} step={0.5} value={az} onChange={(e) => setAzManual(Number(e.target.value))} aria-label="Azimute das divisas" />
              <input type="number" min={0} max={179.9} step={0.1} value={Math.round(az * 10) / 10} onChange={(e) => setAzManual(Number(e.target.value))} />
              <span>°</span>
            </div>
            <label className="dv-check"><input type="checkbox" checked={inverter} onChange={(e) => setInverter(e.target.checked)} /> Começar a numeração pelo outro lado</label>
          </div>

          {r.ok ? (
            <div className="dv-resumo">
              <div><b>{r.divisas.length}</b> divisa{r.divisas.length > 1 ? "s" : ""} nova{r.divisas.length > 1 ? "s" : ""} · <b>{fmtM(r.divisas.reduce((s, d) => s + d.comprimentoM, 0))} m</b> de cerca</div>
              <div><b>{r.novos.length}</b> marcos a implantar no perímetro</div>
              <div>Diferença de área entre o pedido e cada parte: <b>{r.erroAreaM2 < 0.05 ? "menos de 0,1 m²" : `até ${fmtM(r.erroAreaM2)} m²`}</b>, já medida nas coordenadas arredondadas que o SIGEF vai usar</div>
              {temEstrada && r.partes.some((p) => p.frenteEstradaM < 5) && (
                <div className="dv-alerta">Nesta direção há parte sem frente para a estrada. Escolha a recomendada ou gire as divisas.</div>
              )}
            </div>
          ) : (
            <div className="dv-alerta">Não dá para dividir nesta direção: {r.motivo}. Gire as divisas ou escolha uma sugestão.</div>
          )}
        </div>
      </div>

      <div className="tabela-scroll">
        <table className="dv-tabela">
          <thead>
            <tr><th></th><th>Parte</th><th>Herdeiro / quem recebe</th><th>CPF</th><th>Denominação do GEO da parte</th><th>Fração</th><th>Área (ha)</th><th>Área (m²)</th><th>Perímetro (m)</th>{temEstrada && <th>Frente p/ estrada</th>}</tr>
          </thead>
          <tbody>
            {Array.from({ length: n }, (_, i) => {
              const l = linhas[i] ?? infoDe(undefined, i);
              const p = r.ok ? r.partes[i] : null;
              return (
                <tr key={i}>
                  <td><span className="dv-cor" style={{ background: CORES_PARTE[i % CORES_PARTE.length] }} /></td>
                  <td><input value={l.nome} onChange={(e) => editarLinha(i, { nome: e.target.value })} placeholder={`PARTE ${i + 1}`} /></td>
                  <td><input value={l.herdeiro} onChange={(e) => editarLinha(i, { herdeiro: e.target.value.toUpperCase() })} placeholder={servico.detentor_nome ?? "nome completo"} /></td>
                  <td><input value={l.cpf} onChange={(e) => editarLinha(i, { cpf: e.target.value })} placeholder="000.000.000-00" className="mono" /></td>
                  <td><input value={l.denominacao} onChange={(e) => editarLinha(i, { denominacao: e.target.value.toUpperCase() })}
                    placeholder={denominacaoDaParte(servico, { nome: l.nome || `PARTE ${i + 1}`, denominacao: null }).toUpperCase()} /></td>
                  <td>
                    {iguais ? <span className="mono">1/{n}</span> : (
                      <span className="dv-pct">
                        <input type="number" min={0.01} step={0.01} value={Math.round((fracoes[i] ?? 0) * 100) / 100}
                          onChange={(e) => setPct(Array.from({ length: n }, (_, j) => (j === i ? Number(e.target.value) : fracoes[j])))} />%
                      </span>
                    )}
                  </td>
                  <td className="mono">{p ? fmt(p.areaM2 / 10000) : "—"}</td>
                  <td className="mono">{p ? fmtM2(p.areaM2) : "—"}</td>
                  <td className="mono">{p ? fmtM2(p.perimetroM) : "—"}</td>
                  {temEstrada && <td className={`mono${p && p.frenteEstradaM < 5 ? " dv-sem" : ""}`}>{p ? `${fmtM(p.frenteEstradaM)} m` : "—"}</td>}
                </tr>
              );
            })}
          </tbody>
          {!iguais && (
            <tfoot><tr><td colSpan={5} style={{ textAlign: "right" }}>soma das frações</td><td className={`mono${Math.abs(somaPct - 100) > 0.01 ? " dv-sem" : ""}`}>{fmt(somaPct, 2)}%</td><td colSpan={4} className="sub">{Math.abs(somaPct - 100) > 0.01 ? "as frações são proporcionais: a soma não precisa dar 100" : ""}</td></tr></tfoot>
          )}
        </table>
      </div>

      {r.ok && medidas.length > 0 && (
        <div className="dv-medidas">
          <h4>Metragem de cada parte</h4>
          <div className="dv-medidas-grade">
            {r.partes.map((p, i) => (
              <div key={i} className="dv-medida">
                <div className="dv-medida-tit">
                  <span className="dv-cor" style={{ background: CORES_PARTE[i % CORES_PARTE.length] }} />
                  <b>{nomesPartes[i]}</b>
                  <span className="mono">{fmtM2(p.areaM2)} m² · {fmt(p.areaM2 / 10000)} ha</span>
                </div>
                <table>
                  <tbody>
                    {medidas[i].map((m, j) => (
                      <tr key={j} className={m.estrada ? "dv-m-estrada" : m.divisa ? "dv-m-divisa" : ""}>
                        <td>{m.divisa ? `divisa com ${m.confrontante}` : m.confrontante}{m.estrada && " (estrada)"}</td>
                        <td className="mono">{fmtM2(m.comprimentoM)} m</td>
                      </tr>
                    ))}
                    <tr className="dv-m-total"><td>perímetro</td><td className="mono">{fmtM2(p.perimetroM)} m</td></tr>
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      )}

      {r.ok && r.novos.length > 0 && (
        <div className="acoes-linha dv-locacao">
          <button type="button" onClick={baixarLocacao}>Baixar arquivo de locação ({r.novos.length} marcos)</button>
          <select value={formato} onChange={(e) => setFormato(e.target.value as Exclude<FormatoLocacao, "dxf">)} aria-label="Formato do arquivo de locação">
            {FORMATOS_LOCACAO.map((f) => <option key={f.id} value={f.id}>{f.nome} — {f.serve}</option>)}
          </select>
          <span className="sub">
            Os pontos novos das divisas em UTM SIRGAS 2000 fuso {servico.fuso_utm ?? 24}S, para importar na coletora e implantar os marcos.
            {comCodigo && igualAplicada ? " Saem com o código do marco." : " Saem como DIV-01, DIV-02… (com os códigos alocados, saem com o código do marco)."}
          </span>
        </div>
      )}

      <div className="acoes-linha dv-acoes">
        <button type="button" className="principal" disabled={!r.ok || igualAplicada} onClick={aplicar}>
          {igualAplicada ? "Divisão aplicada" : aplicadaAntes ? "Aplicar a nova divisão" : `Aplicar a divisão em ${n} partes`}
        </button>
        <span className="sub">
          {igualAplicada
            ? "As partes já estão no serviço. Herdeiro, nome e denominação podem ser mudados aqui a qualquer momento."
            : <>Grava os {r.ok ? r.novos.length : "—"} pontos novos como marcos <b>M</b> no perímetro (método PA1 até a implantação) e as {n} partes como glebas.
              {comCodigo && " Os códigos do imóvel serão realocados na próxima geração, por causa dos marcos novos."}
              {aplicadaAntes && " A divisão anterior é substituída."}</>}
        </span>
      </div>
    </section>
  );
}
