// As redes de infraestrutura desenhadas na prancheta do loteamento: água,
// esgoto, drenagem, energia e iluminação pública, por cima dos lotes.
//
// `RedesGeo` vai dentro do grupo com a matriz mundo→tela (traço que não escala);
// `RedesSimbolos` desenha em pixels (PV, hidrante, poste, transformador…), com
// a ficha de cada peça no <title> (passar o mouse mostra).
import type { ReactNode } from "react";
import type { Pt } from "../../lib/loteamento/geom.ts";
import { REDES } from "../../lib/loteamento/infra/index.ts";
import type { Rede, ResultadoInfra } from "../../lib/loteamento/infra/index.ts";

export const COR_REDE: Record<Rede, string> = Object.fromEntries(REDES.map((r) => [r.id, r.cor])) as Record<Rede, string>;

const f = (v: number, c = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const d = (pts: Pt[]) => "M" + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join("L");
const espDn = (dn: number) => (dn <= 50 ? 1.6 : dn <= 75 ? 2.2 : dn <= 100 ? 2.8 : dn <= 150 ? 3.6 : 4.4);

export function RedesGeo({ r, camadas, s }: { r: ResultadoInfra; camadas: Set<Rede>; s: number }) {
  const out: ReactNode[] = [];
  if (camadas.has("iluminacao")) {
    // poça de luz de cada luminária (raio ~ meio vão)
    for (const p of r.eletrica.postes) out.push(<circle key={`ip${p.id}`} cx={p.p[0] + p.dir[0] * 1.6} cy={p.p[1] + p.dir[1] * 1.6} r={14} fill="url(#lot-luz)" stroke="none" />);
  }
  if (camadas.has("drenagem")) {
    const c = COR_REDE.drenagem;
    for (const sj of r.drenagem.sarjetas) out.push(<path key={`sj${out.length}`} d={d(sj.linha)} fill="none" stroke={c} strokeOpacity={0.35} strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />);
    for (const rm of r.drenagem.ramais) out.push(<path key={`rm${out.length}`} d={d([rm.de, rm.ate])} fill="none" stroke={c} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />);
    for (const t of r.drenagem.trechos) out.push(
      <path key={t.id} d={d(t.linha)} fill="none" stroke={c} strokeWidth={t.dn >= 800 ? 4 : t.dn >= 600 ? 3.2 : 2.4} strokeDasharray="9 4" vectorEffect="non-scaling-stroke">
        <title>{`Galeria ${t.id} · Ø${t.dn} · ${f(t.L, 1)} m · i = ${f(t.I * 100)}% · Q = ${f(t.q, 0)} L/s · v = ${f(t.v)} m/s · y/D = ${f(t.lamina)}`}</title>
      </path>,
    );
  }
  if (camadas.has("esgoto")) {
    const c = COR_REDE.esgoto;
    if (s > 1.2) for (const lg of r.esgoto.ligacoes) out.push(<path key={`le${out.length}`} d={d([lg.de, lg.ate])} fill="none" stroke={c} strokeOpacity={0.5} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />);
    const ee = r.esgoto.elevatoria;
    if (ee) out.push(<path key="recalque" d={d(ee.recalque)} fill="none" stroke={c} strokeWidth={2.2} strokeDasharray="2 4" strokeLinecap="round" vectorEffect="non-scaling-stroke"><title>{`Linha de recalque · ${f(ee.L, 0)} m · desnível ${f(ee.altura, 1)} m`}</title></path>);
    for (const t of r.esgoto.trechos) out.push(
      <path key={t.id} d={d(t.linha)} fill="none" stroke={c} strokeWidth={t.dn >= 200 ? 3.2 : 2.4} markerMid="url(#lot-seta-esgoto)" markerEnd="url(#lot-seta-esgoto)" vectorEffect="non-scaling-stroke">
        <title>{`Coletor ${t.id} · DN ${t.dn} · ${f(t.L, 1)} m · i = ${f(t.I * 100)}% · Qf = ${f(t.qf)} L/s · y/D = ${f(t.lamina)} · v = ${f(t.v)} m/s · tensão trativa ${f(t.tensao)} Pa`}</title>
      </path>,
    );
  }
  if (camadas.has("agua")) {
    const c = COR_REDE.agua;
    if (s > 1.2) for (const lg of r.agua.ligacoes) out.push(<path key={`la${out.length}`} d={d([lg.de, lg.ate])} fill="none" stroke={c} strokeOpacity={0.5} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />);
    for (const t of r.agua.tubos) for (const l of [t.linha, ...(t.linha2 ? [t.linha2] : [])]) out.push(
      <path key={`${t.id}${l === t.linha ? "" : "b"}`} d={d(l)} fill="none" stroke={c} strokeWidth={espDn(t.dn)} strokeLinecap="round" vectorEffect="non-scaling-stroke" strokeDasharray={t.adutora ? "7 3" : undefined}>
        <title>{`${t.adutora ? "Adutora do reservatório" : `Tubo ${t.id}${t.dupla ? " (rede dupla)" : ""}`} · DN ${t.dn} · ${f(t.L, 1)} m · Q = ${f(Math.abs(t.q))} L/s · v = ${f(t.v)} m/s · perda ${f(t.j, 1)} m/km`}</title>
      </path>,
    );
  }
  if (camadas.has("energia")) {
    const e = r.eletrica;
    for (const v of e.vaos) {
      if (!v.mt && !v.bt) continue;
      const a = e.postes[v.a].p, b = e.postes[v.b].p;
      if (v.bt) out.push(<path key={`bt${v.a}-${v.b}`} d={d([a, b])} fill="none" stroke="#F08A24" strokeWidth={v.cabo === "3x1x120+70" ? 2.4 : 1.6} vectorEffect="non-scaling-stroke"><title>{`Baixa tensão · multiplexado ${v.cabo} · ${f(v.L, 1)} m`}</title></path>);
      if (v.mt) out.push(<path key={`mt${v.a}-${v.b}`} d={d([a, b])} fill="none" stroke={COR_REDE.energia} strokeWidth={v.bt ? 1.4 : 2.2} strokeDasharray={v.bt ? "5 3" : undefined} vectorEffect="non-scaling-stroke"><title>{`Média tensão · rede compacta 15 kV · ${f(v.L, 1)} m`}</title></path>);
    }
    if (s > 1.2) for (const rm of e.ramais) out.push(<path key={`re${out.length}`} d={d([rm.de, rm.ate])} fill="none" stroke="#F08A24" strokeOpacity={0.45} strokeWidth={0.7} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />);
  }
  return <g pointerEvents="visibleStroke">{out}</g>;
}

/** Símbolos em pixels, por cima de tudo. `tela` converte do plano para a tela. */
export function RedesSimbolos({ r, camadas, tela, s, dentro }: {
  r: ResultadoInfra; camadas: Set<Rede>; tela: (p: Pt) => Pt; s: number; dentro: (p: Pt) => boolean;
}) {
  const out: ReactNode[] = [];
  const no = (p: Pt) => { const t = tela(p); return dentro(t) ? t : null; };
  const k = Math.max(0.7, Math.min(1.3, s / 2));
  if (camadas.has("drenagem")) {
    for (const b of r.drenagem.bocas) {
      const t = no(b.p);
      if (!t || s < 0.9) continue;
      const ang = (Math.atan2(-b.dir[1], b.dir[0]) * 180) / Math.PI;
      out.push(<rect key={b.id} x={t[0] - 4 * k} y={t[1] - 2 * k} width={8 * k} height={4 * k} transform={`rotate(${ang} ${t[0]} ${t[1]})`} className="lot-rede-bl"><title>{`${b.id} · boca de lobo · ${f(b.q, 0)} L/s`}</title></rect>);
    }
    for (const pv of r.drenagem.pvs) {
      const t = no(pv.p);
      if (!t) continue;
      out.push(<circle key={pv.id} cx={t[0]} cy={t[1]} r={3.6 * k} className="lot-rede-pvd"><title>{`${pv.id} · tampa ${f(pv.z)} m · fundo ${f(pv.fundo)} m · profundidade ${f(pv.prof)} m`}</title></circle>);
    }
    const l = r.drenagem.lancamento;
    const t = l && r.drenagem.trechos.length ? no(l.p) : null;
    if (l && t) out.push(<g key="lanc" className="lot-rede-saida drenagem"><path d={`M${t[0] - 7} ${t[1] - 7}l7 14l7-14z`} /><title>{`Lançamento pluvial${l.rio ? " no rio" : ""} · ${f(l.q / 1000)} m³/s · dissipador de energia`}</title></g>);
  }
  if (camadas.has("esgoto")) {
    for (const pv of r.esgoto.pvs) {
      const t = no(pv.p);
      if (!t) continue;
      const titulo = `${pv.id} · tampa ${f(pv.z)} m · fundo ${f(pv.fundo)} m · profundidade ${f(pv.prof)} m${pv.queda >= 0.5 ? ` · tubo de queda ${f(pv.queda)} m` : ""}`;
      out.push(pv.tipo === "TIL"
        ? <rect key={pv.id} x={t[0] - 3 * k} y={t[1] - 3 * k} width={6 * k} height={6 * k} className="lot-rede-til"><title>{titulo}</title></rect>
        : <circle key={pv.id} cx={t[0]} cy={t[1]} r={(pv.saida ? 6 : 4) * k} className={`lot-rede-pv${pv.saida ? " saida" : ""}`}><title>{titulo}</title></circle>);
    }
    const sd = r.esgoto.saida, ee = r.esgoto.elevatoria;
    const caixa = (k: string, p: Pt, rot: string, titulo: string) => {
      const t = no(p);
      if (t) out.push(<g key={k} className="lot-rede-saida esgoto"><rect x={t[0] + 8} y={t[1] - 9} width={34} height={18} rx={4} /><text x={t[0] + 25} y={t[1] + 4}>{rot}</text><title>{titulo}</title></g>);
    };
    if (sd && ee) {
      caixa("ee", sd.p, "EE", `Estação elevatória de esgoto · ${f(sd.q)} L/s · recalque de ${f(ee.L, 0)} m e ${f(ee.altura, 1)} m de desnível`);
      caixa("rede", ee.destino, "REDE", "Ligação na rede pública (chegada do recalque)");
    } else if (sd) caixa("ete", sd.p, sd.destino === "ete" ? "ETE" : "REDE", sd.destino === "ete" ? `Estação de tratamento compacta · ${f(sd.q)} L/s` : `Ligação na rede pública · ${f(sd.q)} L/s`);
  }
  if (camadas.has("agua")) {
    const a = r.agua;
    for (const rg of a.registros) { const t = no(rg.p); if (t && s > 0.8) out.push(<path key={`rg${out.length}`} d={`M${t[0] - 4} ${t[1] - 3}L${t[0] + 4} ${t[1] + 3}L${t[0] + 4} ${t[1] - 3}L${t[0] - 4} ${t[1] + 3}Z`} className="lot-rede-reg"><title>Registro de manobra</title></path>); }
    for (const ds of a.descargas) { const t = no(ds.p); if (t) out.push(<path key={`ds${ds.no}`} d={`M${t[0] - 4} ${t[1] + 6}l4 6l4-6z`} className="lot-rede-desc"><title>Descarga (ponto baixo / ponta seca)</title></path>); }
    for (const v of a.ventosas) { const t = no(v.p); if (t) out.push(<path key={`vt${v.no}`} d={`M${t[0]} ${t[1] - 12}l4 5l-4 5l-4-5z`} className="lot-rede-vent"><title>Ventosa (ponto alto)</title></path>); }
    for (const v of a.vrps) { const t = no(v.p); if (t) out.push(<g key={`vrp${v.tubo}`} className="lot-rede-vrp"><rect x={t[0] - 11} y={t[1] - 7} width={22} height={14} rx={3} /><text x={t[0]} y={t[1] + 3}>VRP</text><title>Válvula redutora de pressão</title></g>); }
    for (const h of a.hidrantes) { const t = no(h.p); if (t) out.push(<g key={`hd${h.no}`} className="lot-rede-hid"><circle cx={t[0] + 9} cy={t[1] - 9} r={6} /><text x={t[0] + 9} y={t[1] - 6}>H</text><title>Hidrante de coluna DN 100</title></g>); }
    const pressoes = new Map(a.nos.map((n) => [n.no, n]));
    if (s > 1.6) for (const n of r.grafo.nos) {
      const pn = pressoes.get(n.id);
      const t = no(n.p);
      if (!pn || !t) continue;
      out.push(<text key={`pr${n.id}`} x={t[0] + 6} y={t[1] + 14} className="lot-rede-pressao">{f(pn.pDin, 1)} mca</text>);
    }
    const rs = a.reservatorio;
    const t = rs ? no(rs.p) : null;
    if (rs && t) out.push(
      <g key="res" className="lot-rede-res">
        <circle cx={t[0]} cy={t[1]} r={11} /><text x={t[0]} y={t[1] + 4}>R</text>
        <text x={t[0]} y={t[1] + 25} className="rot">{`${rs.volume} m³${rs.tipo === "elevado" ? ` · ${rs.altura} m` : ""}`}</text>
        <title>{`Reservatório ${rs.tipo} · ${rs.volume} m³ · N.A. mínimo ${f(rs.na)} m${rs.tipo === "elevado" ? ` · torre de ${rs.altura} m` : ""}${rs.area ? ` · ${rs.area}` : ""}`}</title>
      </g>,
    );
  }
  if (camadas.has("energia") || camadas.has("iluminacao")) {
    const e = r.eletrica;
    const soIp = !camadas.has("energia");
    for (const p of e.postes) {
      const t = no(p.p);
      if (!t) continue;
      const tr = p.trafo !== null ? e.trafos[p.trafo] : null;
      const titulo = `Poste ${p.id} · ${p.altura} m / ${p.esforco} daN${p.mt ? " · média tensão" : ""} · luminária LED ${p.luminaria} W${p.equipamentos.length ? ` · ${p.equipamentos.join(", ")}` : ""}`;
      if (tr && !soIp) {
        out.push(
          <g key={`tr${p.id}`} className="lot-rede-trafo">
            <path d={`M${t[0]} ${t[1] - 10}l9 15h-18z`} />
            <text x={t[0] + 12} y={t[1] + 4}>{`${tr.id} · ${tr.kva.toLocaleString("pt-BR")} kVA`}</text>
            <title>{`${tr.id} · ${tr.kva.toLocaleString("pt-BR")} kVA · demanda ${f(tr.demanda, 1)} kVA · ${tr.lotes} lotes · circuito até ${f(tr.alcance, 0)} m · queda ${f(tr.queda)}%`}</title>
          </g>,
        );
      } else {
        out.push(<circle key={`po${p.id}`} cx={t[0]} cy={t[1]} r={(p.mt && !soIp ? 3.2 : 2.6) * k} className={`lot-rede-poste${p.mt && !soIp ? " mt" : ""}${soIp ? " ip" : ""}`}><title>{titulo}</title></circle>);
      }
    }
    const en = e.entrada;
    const te = en && !soIp ? no(en.p) : null;
    if (te) out.push(<g key="entrada" className="lot-rede-entrada"><path d={`M${te[0] - 6} ${te[1] + 8}l6-16l6 16z`} /><text x={te[0]} y={te[1] + 22}>COELBA</text><title>Entrada de energia: derivação da rede da distribuidora</title></g>);
  }
  return <g>{out}</g>;
}

/** Definições (seta do esgoto, poça de luz) — vão no <defs> do SVG da prancheta. */
export function DefsRedes() {
  return (
    <>
      <marker id="lot-seta-esgoto" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
        <path d="M0 0L10 5L0 10z" fill={COR_REDE.esgoto} />
      </marker>
      <radialGradient id="lot-luz">
        <stop offset="0" stopColor="#FFD54A" stopOpacity="0.55" />
        <stop offset="1" stopColor="#FFD54A" stopOpacity="0" />
      </radialGradient>
    </>
  );
}

/** Painel flutuante: liga/desliga cada rede e mostra os números principais. */
export function PainelRedes({ r, camadas, onCamadas, onFechar, onParametros }: {
  r: ResultadoInfra | null; camadas: Set<Rede>; onCamadas: (c: Set<Rede>) => void; onFechar: () => void; onParametros?: () => void;
}) {
  const alternar = (id: Rede) => { const c = new Set(camadas); if (c.has(id)) c.delete(id); else c.add(id); onCamadas(c); };
  const ext = (o: Record<number, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  const linhas: Record<Rede, string> = r ? {
    agua: `${f(ext(r.agua.resumo.extensao), 0)} m · reservatório ${r.agua.reservatorio?.volume ?? 0} m³ · ${f(r.agua.resumo.pMin, 1)}–${f(r.agua.resumo.pMax, 1)} mca`,
    esgoto: `${f(ext(r.esgoto.resumo.extensao), 0)} m · ${r.esgoto.resumo.nPv} PV + ${r.esgoto.resumo.nTil} TIL · até ${f(r.esgoto.resumo.profMax)} m`,
    drenagem: `${f(ext(r.drenagem.resumo.extensao), 0)} m de galeria · ${r.drenagem.resumo.nBocas} bocas de lobo · ${f(r.drenagem.resumo.qLancamento / 1000)} m³/s`,
    energia: `${r.eletrica.resumo.nPostes} postes · ${r.eletrica.trafos.length} trafos (${f(r.eletrica.resumo.kvaInstalado, 1)} kVA) · queda ${f(r.eletrica.resumo.quedaMax)}%`,
    iluminacao: `${r.eletrica.ip.quantidade} LED de ${r.eletrica.ip.potencia} W · ${f(r.eletrica.ip.eMedia, 1)} lux (${r.eletrica.ip.classe})`,
  } : { agua: "", esgoto: "", drenagem: "", energia: "", iluminacao: "" };
  const avisos = r ? [...r.agua.avisos, ...r.esgoto.avisos, ...r.drenagem.avisos, ...r.eletrica.avisos] : [];
  return (
    <div className="lot-redes" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <header>
        <b>Redes de infraestrutura</b>
        {r && <span className="lot-redes-pop">{r.lotes} lotes · {r.populacao.toLocaleString("pt-BR")} hab.</span>}
        <button className="fantasma" onClick={onFechar} aria-label="Fechar as redes">×</button>
      </header>
      {!r && <p className="lot-redes-calc"><span className="spinner" /> Calculando as redes…</p>}
      {REDES.map((x) => (
        <label key={x.id} className={`lot-redes-item${camadas.has(x.id) ? " ativo" : ""}`}>
          <input type="checkbox" checked={camadas.has(x.id)} onChange={() => alternar(x.id)} />
          <i style={{ background: x.cor }} />
          <span><b>{x.nome}</b><small>{linhas[x.id]}</small></span>
        </label>
      ))}
      {avisos.length > 0 && (
        <details className="lot-redes-avisos">
          <summary>{avisos.length} observação(ões) do projeto</summary>
          {avisos.map((a) => <p key={a}>{a}</p>)}
        </details>
      )}
      <footer>
        <span>Passe o mouse numa peça para ver o cálculo</span>
        {onParametros && <button onClick={onParametros}>Parâmetros e pranchas →</button>}
      </footer>
    </div>
  );
}
