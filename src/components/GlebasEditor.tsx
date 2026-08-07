// Editor das glebas: sub-polígonos desenhados DENTRO do perímetro.
//
// O contorno de uma gleba é montado a partir dos vértices que já existem no
// perímetro, mais pontos livres digitados em E/N. Escolher entre os vértices
// existentes é o caminho normal — uma divisão de gleba quase sempre vai de um
// marco a outro — e é o que garante que a divisa da gleba encoste exatamente na
// poligonal, sem folga de centímetros que apareceria como fresta no desenho.
//
// O anel é gravado como jsonb na tabela `glebas` (ver migration 0011): a gleba é
// editada e salva como uma unidade, e não há consulta que pergunte por um ponto
// isolado.
import { useMemo, useState } from "react";
import type { Gleba, Vertice } from "../lib/types";
import { CORES } from "./MapaSVG";
import { Secao } from "./ui";

/** Área do anel em hectares (shoelace no plano UTM), como o motor da planta calcula. */
export function areaHaDoAnel(anel: [number, number][]): number {
  if (anel.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < anel.length; i++) {
    const [ax, ay] = anel[i];
    const [bx, by] = anel[(i + 1) % anel.length];
    s += ax * by - bx * ay;
  }
  return Math.abs(s / 2) / 10000;
}

const fmt = (n: number, casas = 4) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

interface Props {
  glebas: Gleba[];
  vertices: Vertice[];
  /** Área total do imóvel, para conferir quanto das glebas já foi coberto. */
  areaTotalHa: number;
  onChange: (g: Gleba[]) => void;
}

export function GlebasEditor({ glebas, vertices, areaTotalHa, onChange }: Props) {
  const [sel, setSel] = useState(0);
  const [ponto, setPonto] = useState({ e: "", n: "" });

  // só vértices com coordenada plana entram: um V inserido por lat/lon ainda não
  // projetado não tem E/N para fechar polígono
  const disponiveis = useMemo(
    () => vertices.filter((v) => v.e !== null && v.n !== null).sort((a, b) => a.ordem - b.ordem),
    [vertices],
  );

  const atual = glebas[sel] ?? null;
  const somaHa = glebas.reduce((s, g) => s + areaHaDoAnel(g.anel), 0);

  function editar(i: number, patch: Partial<Gleba>) {
    onChange(glebas.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  }
  function nova() {
    onChange([...glebas, {
      id: crypto.randomUUID(),
      servico_id: glebas[0]?.servico_id ?? "",
      ordem: glebas.length,
      nome: `GLEBA ${glebas.length + 1}`,
      anel: [],
    }]);
    setSel(glebas.length);
  }
  function remover(i: number) {
    onChange(glebas.filter((_, k) => k !== i).map((g, k) => ({ ...g, ordem: k })));
    setSel((s) => Math.max(0, Math.min(s, glebas.length - 2)));
  }
  function addPonto(e: number, n: number) {
    if (!atual) return;
    editar(sel, { anel: [...atual.anel, [e, n]] });
  }
  function removerPonto(k: number) {
    if (!atual) return;
    editar(sel, { anel: atual.anel.filter((_, i) => i !== k) });
  }

  return (
    <div className="glebas-editor">
      <div className="glebas-lista">
        {glebas.map((g, i) => {
          const ha = areaHaDoAnel(g.anel);
          const fechada = g.anel.length >= 3;
          return (
            <button key={g.id ?? i} className={i === sel ? "gleba-item ativo" : "gleba-item"} onClick={() => setSel(i)}>
              <span className="gleba-cor" style={{ background: CORES[i % CORES.length] }} aria-hidden="true" />
              <b>{g.nome || `Gleba ${i + 1}`}</b>
              <span className="sub">
                {fechada ? `${fmt(ha)} ha · ${g.anel.length} pontos` : `${g.anel.length} de 3 pontos mínimos`}
              </span>
            </button>
          );
        })}
        <button className="gleba-item novo" onClick={nova}>+ Nova gleba</button>
      </div>

      {glebas.length > 0 && (
        <p className="sub" style={{ margin: "8px 0" }}>
          Soma das glebas: <b>{fmt(somaHa)} ha</b> de {fmt(areaTotalHa)} ha do imóvel
          {somaHa > areaTotalHa * 1.001 && (
            <em className="alerta"> — a soma passou da área total; confira os contornos</em>
          )}
        </p>
      )}

      {atual && (
        <div className="gleba-detalhe">
          <div className="grade">
            <label>Nome da gleba
              <input value={atual.nome} onChange={(e) => editar(sel, { nome: e.target.value })} placeholder="GLEBA 1" />
            </label>
            <label>Área calculada
              <input readOnly value={`${fmt(areaHaDoAnel(atual.anel))} ha`} className="mono" />
              <small className="sub">sai do contorno; não se digita</small>
            </label>
          </div>

          <Secao titulo="Contorno da gleba"
            abrirEm
            selo={<span className={`secao-selo ${atual.anel.length >= 3 ? "completa" : "vazia"}`}>{atual.anel.length} ponto(s)</span>}
            dica="clique nos vértices do perímetro na ordem do contorno, ou digite um ponto livre">
            <div className="gleba-pontos">
              {atual.anel.length === 0 && <p className="sub">Nenhum ponto ainda.</p>}
              <ol className="lista-pontos">
                {atual.anel.map(([e, n], k) => (
                  <li key={k}>
                    <span className="mono">E {fmt(e, 3)} · N {fmt(n, 3)}</span>
                    <button className="fantasma" onClick={() => removerPonto(k)} title="remover ponto">✕</button>
                  </li>
                ))}
              </ol>
            </div>

            <div className="gleba-add">
              <div>
                <b className="sub">Vértices do perímetro</b>
                <div className="chips-vertices">
                  {disponiveis.map((v) => (
                    <button key={v.ordem} className="chip-vertice"
                      onClick={() => addPonto(Number(v.e), Number(v.n))}
                      title={`E ${v.e} · N ${v.n}`}>
                      {v.codigo ?? v.num_txt ?? `#${v.ordem}`}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <b className="sub">Ponto livre (UTM)</b>
                <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                  <input placeholder="E" value={ponto.e} className="mono" style={{ width: 120 }}
                    onChange={(e) => setPonto((p) => ({ ...p, e: e.target.value }))} />
                  <input placeholder="N" value={ponto.n} className="mono" style={{ width: 130 }}
                    onChange={(e) => setPonto((p) => ({ ...p, n: e.target.value }))} />
                  <button
                    disabled={!ponto.e || !ponto.n}
                    onClick={() => {
                      const e = Number(ponto.e.replace(",", ".")), n = Number(ponto.n.replace(",", "."));
                      if (Number.isFinite(e) && Number.isFinite(n)) { addPonto(e, n); setPonto({ e: "", n: "" }); }
                    }}>+ ponto</button>
                </div>
              </div>
            </div>
          </Secao>

          <div style={{ marginTop: 10 }}>
            <button className="perigo-btn" onClick={() => remover(sel)}>🗑 Excluir esta gleba</button>
          </div>
        </div>
      )}
    </div>
  );
}
