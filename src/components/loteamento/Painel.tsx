// Painel lateral do editor: o que está selecionado (com os campos que mudam
// o projeto), o quadro de áreas ao vivo e a lista de pendências.
import { useEffect, useState } from "react";
import { fmt } from "../../lib/loteamento/calculo.ts";
import type { Problema, Resultado } from "../../lib/loteamento/calculo.ts";
import {
  ajustarLote, ajustarQuadra, centroLote, chaveDoLote, editarRua, lotesDaSelecao, mudarArea, quadraDe, removerRua,
  renomearArea, restaurarQuadra,
} from "../../lib/loteamento/acoes.ts";
import type { Selecao } from "../../lib/loteamento/acoes.ts";
import { ROTULO_AREA } from "../../lib/loteamento/modelo.ts";
import type { ModoDivisao, Projeto, Sobra, TipoArea } from "../../lib/loteamento/modelo.ts";
import type { Pt } from "../../lib/loteamento/geom.ts";
import { paraUtm } from "../../lib/loteamento/plano.ts";
import { cotaEm, declividadeEm } from "../../lib/loteamento/terreno.ts";

interface Props {
  projeto: Projeto;
  res: Resultado;
  sel: Selecao;
  onSel: (s: Selecao) => void;
  onMudar: (pr: Projeto) => void;
  onFocar: (p: Pt) => void;
  onMsg: (m: string) => void;
}

/** Campo numérico que só aplica ao sair ou dar Enter (não recalcula a cada tecla). */
export function CampoNum({ valor, onAplicar, casas = 2, sufixo, min = 0, desabilitado, titulo }: {
  valor: number | undefined; onAplicar: (v: number | undefined) => void; casas?: number; sufixo?: string; min?: number;
  desabilitado?: boolean; titulo?: string;
}) {
  const formatar = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "" : fmt(v, casas));
  const [txt, setTxt] = useState(formatar(valor));
  useEffect(() => { setTxt(formatar(valor)); }, [valor]); // eslint-disable-line react-hooks/exhaustive-deps
  const aplicar = () => {
    const limpo = txt.trim();
    if (!limpo) { onAplicar(undefined); return; }
    const n = Number(limpo.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(n) || n < min) { setTxt(formatar(valor)); return; }
    if (formatar(n) !== formatar(valor)) onAplicar(n);
  };
  return (
    <span className="lot-num-campo" title={titulo}>
      <input value={txt} disabled={desabilitado} inputMode="decimal" onChange={(e) => setTxt(e.target.value)} onBlur={aplicar}
        onKeyDown={(e) => { if (e.key === "Enter") { aplicar(); (e.target as HTMLInputElement).blur(); } if (e.key === "Escape") setTxt(formatar(valor)); }} />
      {sufixo && <em>{sufixo}</em>}
    </span>
  );
}

const ROT_MODO: Record<ModoDivisao, string> = { frente: "Padronizada (frente fixa)", area: "Áreas iguais", quantidade: "Quantidade fixa" };
const ROT_SOBRA: Record<Sobra, string> = { esquinas: "Lotes de esquina", ultimo: "Último lote", distribuir: "Distribuir entre todos", extra: "Lote extra (se couber)" };

export function Painel({ projeto, res, sel, onSel, onMudar, onFocar, onMsg }: Props) {
  const lotes = lotesDaSelecao(res, sel);
  const quadra = sel?.tipo === "quadra" ? quadraDe(res, sel.nome) : undefined;
  const rua = sel?.tipo === "rua" ? res.ruas.find((r) => r.id === sel.id) : undefined;
  const area = sel?.tipo === "area" ? res.areas.find((a) => a.id === sel.id) : undefined;
  const p = projeto.params;
  const q = res.quadro;
  const pct = (x: number) => `${fmt((100 * x) / q.gleba, 1)}%`;
  /** largura CSS (ponto decimal, nunca vírgula) */
  const larg = (x: number) => `${((100 * x) / q.gleba).toFixed(2)}%`;

  const erros = res.problemas.filter((x) => x.nivel === "erro");
  const avisos = res.problemas.filter((x) => x.nivel === "aviso");

  function irProblema(pr: Problema) {
    if (pr.alvo?.lote) {
      const l = res.lotes.find((x) => x.id === pr.alvo!.lote);
      if (l) { onSel({ tipo: "lotes", chaves: [chaveDoLote(l)] }); onFocar(centroLote(l)); }
    } else if (pr.alvo?.quadra) {
      const qq = quadraDe(res, pr.alvo.quadra);
      if (qq) { onSel({ tipo: "quadra", nome: qq.nome }); onFocar(qq.centro); }
    } else if (pr.alvo?.ponto) onFocar(pr.alvo.ponto);
  }

  const virarArea = (tipo: TipoArea) => {
    if (lotes.length) {
      let novo = projeto;
      for (const l of lotes) novo = ajustarLote(novo, res, l, { destino: tipo });
      onMudar(novo); onSel(null); onMsg(`${lotes.length === 1 ? "Lote" : `${lotes.length} lotes`} → ${ROTULO_AREA[tipo]}.`);
    } else if (quadra) { onMudar(ajustarQuadra(projeto, res, quadra, { destino: tipo })); onSel(null); onMsg(`Quadra ${quadra.nome} → ${ROTULO_AREA[tipo]}.`); }
  };

  return (
    <aside className="lot-painel">
      {/* ------------------------------------------------ seleção */}
      {lotes.length === 1 && (() => {
        const l = lotes[0];
        const qq = quadraDe(res, l.quadra);
        return (
          <section className="lot-cartao">
            <header><span className="lot-tag">Lote</span><h3>Quadra {l.quadra} · Lote {String(l.numero).padStart(2, "0")}</h3></header>
            <div className="lot-metricas">
              <div><b>{fmt(l.area)}</b><span>m²</span></div>
              <div><b>{fmt(l.frente)}</b><span>m de frente</span></div>
              <div><b>{l.esquina ? "Esquina" : l.naDivisa ? "Divisa" : "Meio"}</b><span>{l.rua || "—"}</span></div>
            </div>
            {l.problemas.map((x) => <p key={x} className="lot-erro">⚠ {x}</p>)}
            {projeto.terreno && (() => {
              const u = paraUtm(res.plano, centroLote(l));
              return <p className="lot-dica">Cota {fmt(cotaEm(projeto.terreno, u), 1)} m · declividade {fmt(declividadeEm(projeto.terreno, u), 1)}%</p>;
            })()}
            <div className="lot-linha">
              <label>Frente</label>
              <CampoNum valor={l.travaFrente ?? (l.travaArea ? undefined : undefined)} sufixo="m" titulo="Trava a frente; os lotes seguintes se ajustam"
                onAplicar={(v) => { onMudar(ajustarLote(projeto, res, l, v === undefined ? { frente: undefined } : { frente: v })); onMsg(v ? `Frente travada em ${fmt(v)} m — a fileira se reorganizou.` : "Frente solta."); }} />
              <span className="lot-dica">{l.travaFrente ? "travada" : `livre (${fmt(qq?.valor ?? p.frente)} m pela quadra)`}</span>
            </div>
            <div className="lot-linha">
              <label>Área</label>
              <CampoNum valor={l.travaArea} sufixo="m²" titulo="Trava a área; a frente é calculada"
                onAplicar={(v) => { onMudar(ajustarLote(projeto, res, l, v === undefined ? { area: undefined } : { area: v })); }} />
              <span className="lot-dica">{l.travaArea ? "travada" : "livre"}</span>
            </div>
            <div className="lot-botoes">
              <button onClick={() => { onMudar(ajustarLote(projeto, res, l, { unir: true })); onMsg(`Lote ${l.id} unido ao seguinte.`); }}>Unir ao seguinte</button>
              <button onClick={() => { onMudar(ajustarLote(projeto, res, l, { dividir: 2 })); onMsg(`Lote ${l.id} dividido em 2.`); }}>Dividir em 2</button>
              {l.ajustado && <button onClick={() => { onMudar(ajustarLote(projeto, res, l, null)); onMsg("Travas removidas."); }}>Soltar travas</button>}
            </div>
            <div className="lot-botoes">
              <button className="verde" onClick={() => virarArea("verde")}>→ Área verde</button>
              <button className="inst" onClick={() => virarArea("institucional")}>→ Institucional</button>
            </div>
            <details className="lot-lados" open>
              <summary>Medidas e confrontações</summary>
              <table>
                <tbody>
                  {l.lados.map((x, i) => (
                    <tr key={i}><td>{fmt(x.comp)} m</td><td className={`t-${x.tipo}`}>{x.nome}</td></tr>
                  ))}
                </tbody>
              </table>
            </details>
            {qq && <button className="fantasma lot-link" onClick={() => onSel({ tipo: "quadra", nome: qq.nome })}>Ver a quadra {qq.nome} →</button>}
          </section>
        );
      })()}

      {lotes.length > 1 && (
        <section className="lot-cartao">
          <header><span className="lot-tag">Lotes</span><h3>{lotes.length} selecionados</h3></header>
          <p className="lot-dica">{lotes.map((l) => l.id).join(", ")} · {fmt(lotes.reduce((s, l) => s + l.area, 0))} m²</p>
          <div className="lot-linha">
            <label>Frente de todos</label>
            <CampoNum valor={undefined} sufixo="m" onAplicar={(v) => {
              if (v === undefined) return;
              let novo = projeto;
              for (const l of lotes) novo = ajustarLote(novo, res, l, { frente: v });
              onMudar(novo);
            }} />
          </div>
          <div className="lot-botoes">
            <button onClick={() => {
              const ord = [...lotes].sort((a, b) => a.fileira - b.fileira || a.indice - b.indice);
              let novo = projeto;
              for (const l of ord.slice(0, -1)) novo = ajustarLote(novo, res, l, { unir: true });
              onMudar(novo); onSel({ tipo: "lotes", chaves: [chaveDoLote(ord[0])] });
            }}>Unir todos</button>
            <button className="verde" onClick={() => virarArea("verde")}>→ Área verde</button>
            <button className="inst" onClick={() => virarArea("institucional")}>→ Institucional</button>
          </div>
        </section>
      )}

      {quadra && (
        <section className="lot-cartao">
          <header><span className="lot-tag">Quadra</span><h3>Quadra {quadra.nome}</h3></header>
          <div className="lot-metricas">
            <div><b>{quadra.lotes.length}</b><span>lotes</span></div>
            <div><b>{fmt(quadra.area)}</b><span>m²</span></div>
            <div><b>{quadra.fileiras}</b><span>fileira{quadra.fileiras === 1 ? "" : "s"}</span></div>
          </div>
          {quadra.problemas.map((x) => <p key={x} className="lot-aviso">{x}</p>)}
          <div className="lot-linha">
            <label>Divisão</label>
            <select value={quadra.modo} onChange={(e) => {
              const modo = e.target.value as ModoDivisao;
              const valor = modo === "frente" ? p.frente : modo === "area" ? p.frente * p.profundidade : Math.max(1, Math.round(quadra.lotes.length / Math.max(1, quadra.fileiras)));
              onMudar(ajustarQuadra(projeto, res, quadra, { modo, valor }));
            }}>
              {(Object.keys(ROT_MODO) as ModoDivisao[]).map((m) => <option key={m} value={m}>{ROT_MODO[m]}</option>)}
            </select>
          </div>
          <div className="lot-linha">
            <label>{quadra.modo === "frente" ? "Frente" : quadra.modo === "area" ? "Área alvo" : "Lotes/fileira"}</label>
            <CampoNum valor={quadra.valor} casas={quadra.modo === "quantidade" ? 0 : 2} sufixo={quadra.modo === "frente" ? "m" : quadra.modo === "area" ? "m²" : ""}
              onAplicar={(v) => v !== undefined && onMudar(ajustarQuadra(projeto, res, quadra, { modo: quadra.modo, valor: v }))} />
          </div>
          {quadra.modo !== "area" && (
            <div className="lot-linha">
              <label>Sobra vai para</label>
              <select value={quadra.sobra} onChange={(e) => onMudar(ajustarQuadra(projeto, res, quadra, { sobra: e.target.value as Sobra }))}>
                {(Object.keys(ROT_SOBRA) as Sobra[]).map((m) => <option key={m} value={m}>{ROT_SOBRA[m]}</option>)}
              </select>
            </div>
          )}
          <div className="lot-linha">
            <label>Fileiras</label>
            <select value={String(projeto.quadras[quadra.cfg]?.fileiras ?? "auto")}
              onChange={(e) => onMudar(ajustarQuadra(projeto, res, quadra, { fileiras: e.target.value === "auto" ? "auto" : (Number(e.target.value) as 1 | 2) }))}>
              <option value="auto">Automático</option><option value="1">Uma (lote de fundo a fundo)</option><option value="2">Duas (costas com costas)</option>
            </select>
          </div>
          {quadra.fundo && (
            <div className="lot-linha">
              <label>Linha de fundo</label>
              <CampoNum valor={quadra.fundo.valor} sufixo="m da rua" onAplicar={(v) => onMudar(ajustarQuadra(projeto, res, quadra, { fundo: v }))} />
            </div>
          )}
          <div className="lot-linha">
            <label>Nome</label>
            <input defaultValue={quadra.nome} key={quadra.nome} onBlur={(e) => {
              const n = e.target.value.trim().toUpperCase();
              if (n && n !== quadra.nome) { onMudar(ajustarQuadra(projeto, res, quadra, { nome: n })); onSel({ tipo: "quadra", nome: n }); }
            }} />
          </div>
          <p className="lot-dica">Arraste as bolinhas verdes para mudar a frente de um lote (os seguintes se ajustam) e o losango para mover o fundo.</p>
          <div className="lot-botoes">
            <button className="verde" onClick={() => virarArea("verde")}>→ Área verde</button>
            <button className="inst" onClick={() => virarArea("institucional")}>→ Institucional</button>
            {quadra.cfg >= 0 && <button onClick={() => { onMudar(restaurarQuadra(projeto, quadra)); onMsg(`Quadra ${quadra.nome} de volta ao padrão.`); }}>Voltar ao padrão</button>}
          </div>
        </section>
      )}

      {rua && (
        <section className="lot-cartao">
          <header><span className="lot-tag">Rua</span><h3>{rua.nome}</h3></header>
          <div className="lot-metricas">
            <div><b>{fmt(rua.comprimento, 1)}</b><span>m de eixo</span></div>
            <div><b>{fmt(rua.area, 0)}</b><span>m² na gleba</span></div>
          </div>
          <div className="lot-linha"><label>Nome</label>
            <input defaultValue={rua.nome} key={rua.id + rua.nome} onBlur={(e) => e.target.value.trim() && e.target.value !== rua.nome && onMudar(editarRua(projeto, rua.id, { nome: e.target.value.trim() }))} />
          </div>
          <div className="lot-linha"><label>Largura total</label>
            <CampoNum valor={rua.largura} sufixo="m" min={3} onAplicar={(v) => v && onMudar(editarRua(projeto, rua.id, { largura: v }))} />
          </div>
          <div className="lot-linha"><label>Balão no fim</label>
            <CampoNum valor={projeto.ruas.find((r) => r.id === rua.id)?.balao} sufixo="m de raio" onAplicar={(v) => onMudar(editarRua(projeto, rua.id, { balao: v || undefined }))} />
          </div>
          <p className="lot-dica">Arraste os quadradinhos para mover o eixo; o "+" no meio de um trecho dobra a rua. Delete apaga.</p>
          <div className="lot-botoes">
            <button className="perigo" onClick={() => { onMudar(removerRua(projeto, rua.id)); onSel(null); onMsg("Rua apagada."); }}>Apagar rua</button>
          </div>
        </section>
      )}

      {area && (
        <section className="lot-cartao">
          <header><span className="lot-tag">Área pública</span><h3>{area.nome}</h3></header>
          <div className="lot-metricas"><div><b>{fmt(area.area)}</b><span>m²</span></div><div><b>{pct(area.area)}</b><span>da gleba</span></div></div>
          {area.origem !== "borda" && (
            <>
              <div className="lot-linha"><label>Tipo</label>
                <select value={area.tipo} onChange={(e) => onMudar(mudarArea(projeto, res, area.id, e.target.value as TipoArea))}>
                  {(["verde", "institucional", "lazer"] as TipoArea[]).map((t) => <option key={t} value={t}>{ROTULO_AREA[t]}</option>)}
                </select>
              </div>
              {area.origem !== "lotes" && (
                <div className="lot-linha"><label>Nome</label>
                  <input defaultValue={area.nome} key={area.id} onBlur={(e) => e.target.value.trim() && onMudar(renomearArea(projeto, res, area.id, e.target.value.trim()))} />
                </div>
              )}
              <div className="lot-botoes">
                <button onClick={() => { onMudar(mudarArea(projeto, res, area.id, null)); onSel(null); onMsg(area.origem === "desenho" ? "Área apagada." : "Voltou a ser loteada."); }}>
                  {area.origem === "desenho" ? "Apagar área" : "Voltar a ser lotes"}
                </button>
              </div>
            </>
          )}
          {area.origem === "borda" && <p className="lot-dica">Faixa definida na pergunta sobre os lados do terreno.</p>}
        </section>
      )}

      {/* ------------------------------------------------ quadro de áreas */}
      <section className="lot-cartao">
        <header><span className="lot-tag">Quadro de áreas</span></header>
        <table className="lot-quadro">
          <tbody>
            <tr><td>Lotes ({q.lotes.qtd})</td><td>{fmt(q.lotes.area)} m²</td><td>{pct(q.lotes.area)}</td></tr>
            <tr><td>Sistema viário</td><td>{fmt(q.viario)} m²</td><td>{pct(q.viario)}</td></tr>
            <tr className={(100 * (q.verde + q.lazer)) / q.gleba < p.pctVerdeMin - 0.005 ? "falta" : ""}><td>Áreas verdes</td><td>{fmt(q.verde + q.lazer)} m²</td><td>{pct(q.verde + q.lazer)}</td></tr>
            <tr className={(100 * q.institucional) / q.gleba < p.pctInstitucionalMin - 0.005 ? "falta" : ""}><td>Institucional</td><td>{fmt(q.institucional)} m²</td><td>{pct(q.institucional)}</td></tr>
            {q.app > 0 && <tr><td>APP / non aedificandi</td><td>{fmt(q.app)} m²</td><td>{pct(q.app)}</td></tr>}
            {q.sobras > 0 && <tr className="falta"><td>Sobras sem destino</td><td>{fmt(q.sobras)} m²</td><td>{pct(q.sobras)}</td></tr>}
            <tr className="total"><td>Gleba</td><td>{fmt(q.gleba)} m²</td><td>{fmt(q.gleba / 1e4, 4)} ha</td></tr>
          </tbody>
        </table>
        <div className="lot-barra" aria-hidden="true">
          <i style={{ width: larg(q.lotes.area), background: "#E9D9A6" }} title="Lotes" />
          <i style={{ width: larg(q.viario), background: "#B9B5AA" }} title="Viário" />
          <i style={{ width: larg(q.verde + q.lazer), background: "#8CCB72" }} title="Áreas verdes" />
          <i style={{ width: larg(q.institucional), background: "#EFB86A" }} title="Institucional" />
          <i style={{ width: larg(q.app), background: "#7FB2E5" }} title="APP" />
        </div>
        <p className="lot-dica">
          Públicas (viário + verde + institucional): <b>{pct(q.publicas)}</b> · meta {fmt(p.pctPublicasMin, 0)}%
          {res.lotes.length > 0 && <> · lote médio {fmt(q.lotes.area / Math.max(1, q.lotes.qtd))} m²</>}
        </p>
        {q.vgv > 0 && <p className="lot-vgv">VGV estimado: <b>R$ {fmt(q.vgv, 0)}</b> <span>({fmt(p.precoM2)} /m², esquina +{fmt(p.acrescimoEsquina, 0)}%)</span></p>}
        {res.plano.terreno && <p className="lot-dica">Medidas de terreno · fator de escala {res.plano.k.toFixed(6).replace(".", ",")} (aplicado na locação)</p>}
      </section>

      {/* ------------------------------------------------ pendências */}
      <section className="lot-cartao">
        <header>
          <span className="lot-tag">{erros.length || avisos.length ? "Pendências" : "Tudo certo"}</span>
          {(erros.length > 0 || avisos.length > 0) && <span className="lot-cont">{erros.length} erro(s) · {avisos.length} aviso(s)</span>}
        </header>
        {!erros.length && !avisos.length && <p className="lot-ok">Todos os lotes atendem área e frente mínimas, as metas de áreas públicas foram cumpridas.</p>}
        <ul className="lot-problemas">
          {[...erros, ...avisos].slice(0, 40).map((x, i) => (
            <li key={i} className={x.nivel} onClick={() => irProblema(x)} role={x.alvo ? "button" : undefined}>{x.texto}</li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
