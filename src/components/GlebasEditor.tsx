// Editor das glebas: sub-polígonos desenhados DENTRO do perímetro.
//
// O contorno é montado NO DESENHO (ver MapaGlebas), não numa fileira de chips:
// montar uma gleba que acompanha 12 vértices dava 12 cliques em botões que não
// diziam onde cada um ficava. A lista de pontos continua aqui ao lado, como
// conferência e como saída de emergência — quem tem a coordenada exata digita —
// mas o caminho normal é apontar na figura.
import { useState } from "react";
import type { Gleba, Trecho, Vertice } from "../lib/types";
import { areaHaDoAnel } from "../lib/glebas";
import { CORES } from "./MapaSVG";
import { MapaGlebas } from "./MapaGlebas";
import { Secao } from "./ui";

export { areaHaDoAnel };

const fmt = (n: number, casas = 4) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

interface Props {
  glebas: Gleba[];
  vertices: Vertice[];
  /** Só para o mapa desenhar as faixas de domínio como saem na planta. */
  trechos: Trecho[];
  /** Área total do imóvel, para conferir quanto das glebas já foi coberto. */
  areaTotalHa: number;
  servicoId: string;
  onChange: (g: Gleba[]) => void;
}

export function GlebasEditor({ glebas, vertices, trechos, areaTotalHa, servicoId, onChange }: Props) {
  const [sel, setSel] = useState(0);
  const [ponto, setPonto] = useState({ e: "", n: "" });

  const ativa = Math.min(sel, Math.max(0, glebas.length - 1));
  const atual = glebas[ativa] ?? null;
  const somaHa = glebas.reduce((s, g) => s + areaHaDoAnel(g.anel), 0);

  function editar(i: number, patch: Partial<Gleba>) {
    onChange(glebas.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  }
  function nova() {
    onChange([...glebas, {
      id: crypto.randomUUID(),
      servico_id: servicoId,
      ordem: glebas.length,
      nome: `GLEBA ${glebas.length + 1}`,
      anel: [],
    }]);
    setSel(glebas.length);
  }
  function remover(i: number) {
    onChange(glebas.filter((_, k) => k !== i).map((g, k) => ({ ...g, ordem: k })));
    setSel(0);
  }

  return (
    <div className="glebas-editor">
      <div className="glebas-lista">
        {glebas.map((g, i) => {
          const ha = areaHaDoAnel(g.anel);
          const fechada = g.anel.length >= 3;
          return (
            <button key={g.id ?? i} className={i === ativa ? "gleba-item ativo" : "gleba-item"} onClick={() => setSel(i)}>
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

      {!atual ? (
        <p className="sub">Crie a primeira gleba para começar a desenhar.</p>
      ) : (
        <div className="gleba-trabalho">
          <MapaGlebas
            vertices={vertices}
            trechos={trechos}
            glebas={glebas}
            ativa={ativa}
            onChange={(anel) => editar(ativa, { anel })}
          />

          <div className="gleba-painel">
            <label>Nome da gleba
              <input value={atual.nome} onChange={(e) => editar(ativa, { nome: e.target.value })} placeholder="GLEBA 1" />
            </label>
            <label>Área calculada
              <input readOnly value={`${fmt(areaHaDoAnel(atual.anel))} ha`} className="mono" />
              <small className="sub">sai do contorno; não se digita</small>
            </label>

            <div className="gleba-acoes">
              <button className="fantasma" disabled={!atual.anel.length}
                onClick={() => editar(ativa, { anel: atual.anel.slice(0, -1) })}>
                ↶ Desfazer último ponto
              </button>
              <button className="fantasma" disabled={!atual.anel.length}
                onClick={() => editar(ativa, { anel: [] })}>
                Limpar contorno
              </button>
              <button className="fantasma" disabled={atual.anel.length < 3}
                onClick={() => editar(ativa, { anel: [...atual.anel].reverse() })}
                title="inverte o sentido do contorno — não muda a área, só a ordem dos pontos">
                ⇄ Inverter sentido
              </button>
            </div>

            <Secao titulo="Pontos do contorno"
              selo={<span className={`secao-selo ${atual.anel.length >= 3 ? "completa" : "vazia"}`}>{atual.anel.length}</span>}
              dica="conferência da lista e entrada por coordenada">
              {atual.anel.length === 0
                ? <p className="sub">Nenhum ponto — clique nos vértices do mapa ao lado.</p>
                : (
                  <ol className="lista-pontos">
                    {atual.anel.map(([e, n], k) => (
                      <li key={k}>
                        <span className="mono">E {fmt(e, 3)} · N {fmt(n, 3)}</span>
                        <button className="fantasma" title="remover ponto"
                          onClick={() => editar(ativa, { anel: atual.anel.filter((_, i) => i !== k) })}>✕</button>
                      </li>
                    ))}
                  </ol>
                )}

              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <input placeholder="E" value={ponto.e} className="mono" style={{ width: 110 }}
                  onChange={(e) => setPonto((p) => ({ ...p, e: e.target.value }))} />
                <input placeholder="N" value={ponto.n} className="mono" style={{ width: 120 }}
                  onChange={(e) => setPonto((p) => ({ ...p, n: e.target.value }))} />
                <button
                  disabled={!ponto.e || !ponto.n}
                  onClick={() => {
                    const e = Number(ponto.e.replace(",", ".")), n = Number(ponto.n.replace(",", "."));
                    if (Number.isFinite(e) && Number.isFinite(n)) {
                      editar(ativa, { anel: [...atual.anel, [e, n]] });
                      setPonto({ e: "", n: "" });
                    }
                  }}>+ por coordenada</button>
              </div>
            </Secao>

            <div style={{ marginTop: 12 }}>
              <button className="perigo-btn" onClick={() => remover(ativa)}>🗑 Excluir esta gleba</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
