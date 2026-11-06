// Seção do terreno: o perfil natural (marrom), o projeto (verde) e, entre os
// dois, o corte (vermelho) e o aterro (azul). Passar o mouse lê as cotas.
import { useEffect, useRef, useState } from "react";
import type { Secao } from "../../lib/terraplanagem/calculo.ts";
import { fmtN } from "../../lib/terraplanagem/calculo.ts";

export function PerfilSecao({ secao, titulo, ativa, onFoco }: { secao: Secao; titulo: string; ativa: boolean; onFoco: (nome: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [mira, setMira] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 168, ex = 44, ey = 22, topo = 10, dir = 10;
  const W = Math.max(10, w - ex - dir), Hh = H - ey - topo;
  const vals = [...secao.terreno, ...secao.projeto].filter((v) => v === v);
  let zmin = Math.min(...vals), zmax = Math.max(...vals);
  const folga = Math.max(0.4, (zmax - zmin) * 0.12);
  zmin -= folga; zmax += folga;
  const smax = secao.s[secao.s.length - 1] || 1;
  const X = (s: number) => ex + (s / smax) * W;
  const Y = (z: number) => topo + Hh - ((z - zmin) / (zmax - zmin)) * Hh;
  const linha = (zs: number[]) => {
    let d = "", aberto = false;
    zs.forEach((z, i) => {
      if (!(z === z)) { aberto = false; return; }
      d += `${aberto ? "L" : "M"}${X(secao.s[i]).toFixed(1)} ${Y(z).toFixed(1)}`;
      aberto = true;
    });
    return d;
  };
  // faixas de corte e aterro (trapézios entre amostras)
  const faixas: { d: string; corte: boolean }[] = [];
  for (let i = 0; i + 1 < secao.s.length; i++) {
    const t0 = secao.terreno[i], t1 = secao.terreno[i + 1], p0 = secao.projeto[i], p1 = secao.projeto[i + 1];
    if (!(t0 === t0 && t1 === t1 && p0 === p0 && p1 === p1)) continue;
    if (Math.abs(t0 - p0) < 1e-3 && Math.abs(t1 - p1) < 1e-3) continue;
    faixas.push({ corte: t0 - p0 + t1 - p1 > 0, d: `M${X(secao.s[i])} ${Y(t0)}L${X(secao.s[i + 1])} ${Y(t1)}L${X(secao.s[i + 1])} ${Y(p1)}L${X(secao.s[i])} ${Y(p0)}Z` });
  }
  const passoZ = [0.25, 0.5, 1, 2, 5, 10, 20, 50].find((p) => (zmax - zmin) / p <= 5) ?? 100;
  const marcasZ: number[] = [];
  for (let z = Math.ceil(zmin / passoZ) * passoZ; z <= zmax; z += passoZ) marcasZ.push(z);
  const passoS = [5, 10, 20, 25, 50, 100, 200, 500].find((p) => smax / p <= Math.max(3, W / 90)) ?? 1000;
  const marcasS: number[] = [];
  for (let s = 0; s <= smax + 1e-9; s += passoS) marcasS.push(s);
  const exag = (Hh / (zmax - zmin)) / (W / smax);

  const i = mira;
  const leitura = i !== null ? { s: secao.s[i], t: secao.terreno[i], p: secao.projeto[i] } : null;

  return (
    <figure className={`tp-perfil${ativa ? " ativa" : ""}`} onMouseEnter={() => onFoco(secao.nome)} onMouseLeave={() => { onFoco(null); setMira(null); }}>
      <figcaption>
        <b><span className="tp-selo-secao">{secao.nome}</span> {titulo}</b>
        <span className="sub">{fmtN(smax, 0)} m · exagero vertical {fmtN(exag, exag < 10 ? 1 : 0)}×</span>
      </figcaption>
      <div ref={ref} className="tp-perfil-area">
        {w > 0 && (
          <svg width={w} height={H} role="img" aria-label={`Seção ${secao.nome}: terreno e projeto`}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const x = ((e.clientX - r.left) / r.width) * w;
              const s = ((x - ex) / W) * smax;
              let melhor = 0;
              for (let k = 1; k < secao.s.length; k++) if (Math.abs(secao.s[k] - s) < Math.abs(secao.s[melhor] - s)) melhor = k;
              setMira(s < 0 || s > smax ? null : melhor);
            }}>
            {marcasZ.map((z) => (
              <g key={z}>
                <line x1={ex} x2={ex + W} y1={Y(z)} y2={Y(z)} className="tp-perfil-grade" />
                <text x={ex - 6} y={Y(z) + 4} textAnchor="end" className="tp-perfil-eixo">{fmtN(z, passoZ < 1 ? 2 : 0)}</text>
              </g>
            ))}
            {marcasS.map((s) => <text key={s} x={X(s)} y={H - 6} textAnchor="middle" className="tp-perfil-eixo">{fmtN(s, 0)}</text>)}
            {faixas.map((f, k) => <path key={k} d={f.d} className={f.corte ? "tp-perfil-corte" : "tp-perfil-aterro"} />)}
            <path d={linha(secao.terreno)} className="tp-perfil-terreno" />
            <path d={linha(secao.projeto)} className="tp-perfil-projeto" />
            <text x={ex + 4} y={topo + 12} className="tp-perfil-ponta">{secao.nome}</text>
            <text x={ex + W - 4} y={topo + 12} textAnchor="end" className="tp-perfil-ponta">{secao.nome}'</text>
            {leitura && (
              <line x1={X(leitura.s)} x2={X(leitura.s)} y1={topo} y2={topo + Hh} className="tp-perfil-mira" />
            )}
          </svg>
        )}
        {leitura && leitura.t === leitura.t && (
          <div className="tp-perfil-leitura" style={{ left: Math.min(X(leitura.s) + 10, w - 190) }}>
            <span>{fmtN(leitura.s, 1)} m</span>
            <span>Terreno {fmtN(leitura.t, 2)} · Projeto {fmtN(leitura.p, 2)}</span>
            <b className={leitura.t - leitura.p > 0.005 ? "corte" : leitura.t - leitura.p < -0.005 ? "aterro" : ""}>
              {Math.abs(leitura.t - leitura.p) < 0.005 ? "no nível" : leitura.t - leitura.p > 0 ? `corte ${fmtN(leitura.t - leitura.p, 2)} m` : `aterro ${fmtN(leitura.p - leitura.t, 2)} m`}
            </b>
          </div>
        )}
      </div>
    </figure>
  );
}
