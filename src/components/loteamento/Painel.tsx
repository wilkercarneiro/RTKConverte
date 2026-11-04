// Painel lateral do editor: o que está selecionado (com os campos que mudam
// o projeto), o quadro de áreas ao vivo e a lista de pendências.
import { useEffect, useState } from "react";
import { fmt } from "../../lib/loteamento/calculo.ts";
import type { Problema, Resultado } from "../../lib/loteamento/calculo.ts";
import {
  ajustarQuadra, centroLote, chaveDoLote, conferirMedida, editarRua, lotesDaSelecao, mudarArea, quadraDe, removerRua,
  renomearArea, restaurarQuadra,
} from "../../lib/loteamento/acoes.ts";
import { definirFrente, quadraDesenhada } from "../../lib/loteamento/edicao.ts";
import type { Ferramenta } from "../../lib/loteamento/acoes.ts";
import type { Selecao } from "../../lib/loteamento/acoes.ts";
import { ROTULO_AREA } from "../../lib/loteamento/modelo.ts";
import type { ModoDivisao, Projeto, Sobra, TipoArea } from "../../lib/loteamento/modelo.ts";
import type { Pt } from "../../lib/loteamento/geom.ts";
import { paraUtm } from "../../lib/loteamento/plano.ts";
import { cotaEm, declividadeEm } from "../../lib/loteamento/terreno.ts";
import { Dica } from "../ui";
import { Icone } from "../Icone";

interface Props {
  projeto: Projeto;
  res: Resultado;
  sel: Selecao;
  onSel: (s: Selecao) => void;
  /** false: a mudança tirava lote das regras e não entrou (o editor já avisou) */
  onMudar: (pr: Projeto) => boolean | void;
  onFocar: (p: Pt) => void;
  onMsg: (m: string, erro?: boolean) => void;
  /** roda um comando da linha de comando (o painel e o teclado fazem a mesma coisa) */
  onComando: (texto: string) => void;
  onFerramenta: (f: Ferramenta) => void;
  /** recolhe o painel num trilho de ações rápidas */
  onRecolher?: () => void;
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

/** Os pedacinhos do arco da esquina (mesma rua, menos de 2 m cada) viram uma linha só. */
type LadoLinha = { comp: number; tipo: string; nome: string; ref?: string; curva?: boolean; definida?: boolean; principal?: boolean; a: Pt; b: Pt };
function agruparArcos(lados: Resultado["lotes"][number]["lados"]): LadoLinha[] {
  const out: LadoLinha[] = [];
  for (const x of lados) {
    const ult = out[out.length - 1];
    if (ult && x.comp < 2 && ult.tipo === x.tipo && ult.ref === x.ref && (ult.curva || ult.comp < 2)) { ult.comp += x.comp; ult.curva = true; ult.b = x.b; continue; }
    out.push({ comp: x.comp, tipo: x.tipo, nome: x.nome, ref: x.ref, definida: x.definida, principal: x.principal, a: x.a, b: x.b });
  }
  return out;
}

/** Edição livre: o que sai das medidas do projeto é aplicado e vira aviso na mensagem. */
const comAviso = (m: string, aviso: string | null | undefined) => (aviso ? `${m} Atenção: ${aviso}` : m);

export function Painel({ projeto, res, sel, onSel, onMudar, onFocar, onMsg, onComando, onFerramenta, onRecolher }: Props) {
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
    if (lotes.length) onComando(tipo);
    else if (quadra) { onMudar(ajustarQuadra(projeto, res, quadra, { destino: tipo })); onSel(null); onMsg(`Quadra ${quadra.nome} → ${ROTULO_AREA[tipo]}.`); }
  };

  return (
    <aside className="lot-painel">
      {onRecolher && (
        <div className="painel-barra">
          <span>{lotes.length > 1 ? `${lotes.length} lotes selecionados` : lotes.length === 1 ? `Lote ${lotes[0].id}` : quadra ? `Quadra ${quadra.nome}` : rua ? "Rua" : area ? "Área pública" : "Projeto"}</span>
          <button className="fantasma" onClick={onRecolher} title="Recolher o painel: o desenho fica maior e as ações rápidas continuam à mão">Recolher <b aria-hidden="true">»</b></button>
        </div>
      )}
      {/* ------------------------------------------------ seleção */}
      {lotes.length === 1 && (() => {
        const l = lotes[0];
        const qq = quadraDe(res, l.quadra);
        return (
          <section className="lot-cartao">
            <header><span className="lot-tag">Lote</span><h3>Quadra {l.quadra} · Lote {String(l.numero).padStart(2, "0")}<Dica>Arraste no desenho as quinas (quadrados) e as divisas (barras verdes). A quina na rua corre pela rua; os vizinhos se ajustam.</Dica></h3></header>
            <div className="lot-metricas">
              <div><b>{fmt(l.area)}</b><span>m²</span></div>
              <div><b>{fmt(l.testada ?? l.frente)}</b><span>m de frente</span></div>
              <div><b>{fmt(l.fundo ?? l.profundidade)}</b><span>m de fundo</span></div>
              <div><b>{l.esquina ? "Esquina" : l.naDivisa ? "Divisa" : "Meio"}</b><span>{l.rua || "—"}</span></div>
            </div>
            {l.problemas.map((x) => <p key={x} className="lot-erro">⚠ {x}</p>)}
            {(l.esquina || l.ponta) && !l.problemas.length && (
              <p className="lot-dica">
                {l.esquina ? "Lote de esquina: a frente é a rua principal medida até o ponto em que as duas ruas se cruzariam (o arco da esquina conta como uma quina); a outra rua é a lateral. A frente máxima e o fundo mínimo não valem para ele." : "Lote de ponta (onde a quadra afina): ajusta a linha da propriedade — a frente máxima não vale para ele."}
              </p>
            )}
            <p className="lot-dica">
              Faixas do projeto: frente {fmt(p.frenteMin)}–{fmt(p.frenteMax)} m · fundo {fmt(p.profundidadeMin)}–{fmt(p.profundidadeMax)} m · área {fmt(p.areaMin, 0)}–{fmt(p.areaMax, 0)} m².
            </p>
            {projeto.terreno && (() => {
              const u = paraUtm(res.plano, centroLote(l));
              return <p className="lot-dica">Cota {fmt(cotaEm(projeto.terreno, u), 1)} m · declividade {fmt(declividadeEm(projeto.terreno, u), 1)}%</p>;
            })()}
            <div className="lot-linha">
              <label>Frente</label>
              <CampoNum valor={l.frente} sufixo="m" titulo="Digite a frente: a divisa lateral desliza e o vizinho se ajusta"
                onAplicar={(v) => { if (v !== undefined) onComando(`frente ${String(v).replace(".", ",")}`); }} />
            </div>
            <div className="lot-linha">
              <label>Área</label>
              <CampoNum valor={l.area} sufixo="m²" titulo="Digite a área: a divisa lateral desliza e o vizinho se ajusta"
                onAplicar={(v) => { if (v !== undefined) onComando(`area ${String(v).replace(".", ",")}`); }} />
            </div>
            <div className="lot-botoes lot-botoes-4">
              <button onClick={() => onComando("unir")} title="Une com o vizinho de maior divisa em comum">Unir</button>
              <button className="perigo" onClick={() => onComando("apagar")} title="A área fica livre para desenhar outro lote (Delete)">Apagar</button>
              <button className="verde" onClick={() => virarArea("verde")} title="O lote vira área verde">Área verde</button>
              <button className="inst" onClick={() => virarArea("institucional")} title="O lote vira área institucional">Institucional</button>
            </div>
            <div className="lot-botoes lot-botoes-2">
              <button onClick={() => onComando("dividir 2")}>Dividir em 2</button>
              <button onClick={() => onComando("dividir 3")}>Dividir em 3</button>
            </div>
            <details className="lot-lados" open>
              <summary>Medidas e confrontações<Dica>☆ escolhe a frente do lote: o lado que dá para a servidão ou área verde (lote sem rua) ou a rua principal da esquina. Só o lado escolhido conta como frente. Ou use a ferramenta Frente (T) e clique no lado.</Dica></summary>
              <table>
                <tbody>
                  {agruparArcos(l.lados).map((x, i) => {
                    const rua = x.tipo === "rua" || (x.tipo === "via" && !x.definida);
                    return (
                      <tr key={i}>
                        <td>{fmt(x.comp)} m</td>
                        <td className={`t-${x.definida ? "definida" : x.tipo}`}>{x.nome}{x.curva ? " (curva da esquina)" : ""}{x.principal ? " — frente escolhida" : x.definida ? " — acesso da quadra" : ""}</td>
                        <td>
                          {!x.curva && x.comp >= 1.5 && qq && (
                            <button className={`lot-estrela${x.principal ? " ativa" : ""}`}
                              title={x.principal ? "Tirar a escolha: a frente volta a ser a rua" : rua ? "Esta rua é a frente do lote (as outras ficam como confrontação)" : "Este lado é a frente do lote (servidão, área verde, outro lote)"}
                              onClick={() => { const ed = definirFrente(projeto, res, qq, l, x.a, x.b); if (ed) { onMudar(ed.pr); if (ed.sel) onSel({ tipo: "lotes", chaves: [{ quadra: ed.sel.quadra, fileira: 0, indice: ed.sel.indices[0] }] }); onMsg(ed.msg); } }}>
                              {x.principal ? "★" : "☆"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
          {(() => {
            const umaQuadra = new Set(lotes.map((l) => l.quadra)).size === 1;
            const media = lotes.reduce((s, l) => s + l.area, 0) / lotes.length;
            return (
              <>
                <div className="lot-acoes-2">
                <button className="principal lot-acao" disabled={!umaQuadra} onClick={() => onComando("igualar")}
                  title={umaQuadra ? `Todos ficam com ${fmt(media)} m² (a soma dividida por igual). A terra dos selecionados é redividida só entre eles, com as laterais no esquadro da rua (ou acompanhando as pontas) e o fundo com fundo alinhado — os lotes de fora não mudam (Ctrl+Z desfaz).` : "Selecione lotes de uma quadra só"}>
                  <b>Igualar áreas</b><small>{fmt(media)} m² cada</small>
                </button>
                <button className="lot-acao" disabled={!umaQuadra} onClick={() => onComando("fundo com fundo")}
                  title={umaQuadra ? "Só os lotes selecionados: a área total deles é redividida entre eles, fundo com fundo pela linha central, laterais no esquadro da rua e a mesma área. Os outros lotes da quadra não mudam (Ctrl+Z desfaz). Para a quadra inteira, selecione a quadra (duplo clique)." : "Selecione lotes de uma quadra só"}>
                  <b>Fundo com fundo</b><small>ajustar {lotes.length} lotes</small>
                </button>
                </div>
              </>
            );
          })()}
          <div className="lot-linha">
            <label>Frente de todos</label>
            <CampoNum valor={undefined} sufixo="m" onAplicar={(v) => { if (v !== undefined) onComando(`frente ${String(v).replace(".", ",")}`); }} />
          </div>
          <div className="lot-botoes lot-botoes-4">
            <button onClick={() => onComando("unir")} title="Os selecionados viram um lote só">Unir lotes</button>
            <button className="perigo" onClick={() => onComando("apagar")} title="A área fica livre para desenhar outros lotes (Delete)">Apagar</button>
            <button className="verde" onClick={() => virarArea("verde")} title="Os selecionados viram área verde">Área verde</button>
            <button className="inst" onClick={() => virarArea("institucional")} title="Os selecionados viram área institucional">Institucional</button>
          </div>
        </section>
      )}

      {quadra && (
        <section className="lot-cartao">
          <header><span className="lot-tag">Quadra</span><h3>Quadra {quadra.nome}<Dica>Clique num lote para arrastar as quinas e as divisas dele. L desenha um lote, C corta lotes com uma linha. Com duas fileiras (fundo com fundo), a linha de fundo aparece em laranja: a barra move a linha inteira e os losangos dobram a linha num ponto — as junções correm pelas divisas.</Dica></h3></header>
          <div className="lot-metricas">
            <div><b>{quadra.lotes.length}</b><span>lotes</span></div>
            <div><b>{fmt(quadra.area)}</b><span>m²</span></div>
            <div><b>{quadra.fileiras}</b><span>fileira{quadra.fileiras === 1 ? "" : "s"}</span></div>
          </div>
          {quadra.problemas.map((x) => <p key={x} className="lot-aviso">{x}</p>)}
          {quadra.estruturada ? (() => {
            const e = quadra.estruturada;
            const nomeCab: Record<string, string> = { direta: "esquina", ponta: "ponta de fileira única", testa: "lotes de frente para a rua da ponta" };
            const cfgQ = projeto.quadras[quadra.cfg]?.estrutura;
            const iguais = Math.abs(e.T1 - e.T2) < 0.01;
            return (
              <>
                <p className="lot-dica">
                  <b>Linha central</b> (em laranja): fundo com fundo numa linha reta e {e.laterais === "leque" || e.laterais === "meio" ? <>laterais acompanhando a inclinação das divisas das pontas.</> : <>laterais no esquadro da rua — até {fmt(e.giroMax, 1)}°.</>}
                  {" "}{iguais ? `Lotes de ${fmt(e.T1)} m²` : `Fileiras com ${fmt(e.T1)} e ${fmt(e.T2)} m²`}; cabeceiras: {e.cabeceiras.map((c) => nomeCab[c] ?? c).join(" e ")}.
                  <Dica>Arraste os losangos laranja para dobrar a linha central; a ponta da linha corre pela rua da cabeceira. Ao soltar, a linha só desliza de lado até as áreas empatarem — os ângulos ficam os seus. Mexer à mão num lote (quina ou divisa) volta a quadra para o desenho livre.</Dica>
                </p>
                <div className="lot-linha">
                  <label>Lotes na quadra</label>
                  <div className="lot-botoes">
                    <button onClick={() => onComando(`fundo com fundo ${quadra.lotes.length - 2}`)} title="Dois lotes a menos (um em cada fileira)">−2</button>
                    <button onClick={() => onComando(`fundo com fundo ${quadra.lotes.length + 2}`)} title="Dois lotes a mais (um em cada fileira)">+2</button>
                  </div>
                </div>
                <div className="lot-linha">
                  <label>Cabeceira inclinada</label>
                  <select value={cfgQ?.esquinas ?? "absorver"} onChange={(ev) => onComando(`fundo com fundo ${quadra.lotes.length} ${ev.target.value === "iguais" ? "iguais" : "absorver"}`)}>
                    <option value="absorver">a esquina absorve (laterais no esquadro)</option>
                    <option value="iguais">todos iguais (laterais giram um pouco)</option>
                  </select>
                </div>
                <div className="lot-botoes lot-botoes-2">
                  <button onClick={() => onComando("fundo com fundo")} title="Recalcula a linha central automática (equidistante das ruas, empatando as fileiras)">Linha automática</button>
                  <button onClick={() => onComando("automatico")} title="A quadra volta a ser dividida pelo gerador">Voltar ao automático</button>
                </div>
              </>
            );
          })() : null}
          {!quadra.estruturada && (
            <div className="lot-botoes lot-botoes-1">
              <button className="principal" onClick={() => onComando("fundo com fundo")}
                title="Refaz a quadra pela linha central: fundo com fundo alinhado, laterais no esquadro da rua e todos os lotes com a mesma área. Vale também para a quadra desenhada à mão (Ctrl+Z desfaz).">
                Ajustar fundo com fundo
              </button>
            </div>
          )}
          {quadraDesenhada(projeto, quadra, res.plano) && (
            <>
              <p className="lot-dica"><b>Quadra desenhada à mão</b> — o sistema não a redivide. Mudar a divisão abaixo (ou "Voltar ao automático") descarta o desenho.</p>
              <div className="lot-botoes">
                {quadra.problemas.some((x) => /sem lote/.test(x)) && <button onClick={() => onComando("preencher")} title="Cada área livre da quadra vira um lote">Preencher área livre</button>}
                <button onClick={() => onComando("automatico")}>Voltar ao automático</button>
              </div>
            </>
          )}
          {/* divisão automática: não vale para a quadra estruturada pela linha central */}
          {!quadra.estruturada && (<>
          <div className="lot-linha">
            <label>Divisão</label>
            <select value={quadra.modo} onChange={(e) => {
              const modo = e.target.value as ModoDivisao;
              const valor = modo === "frente" ? p.frente : modo === "area" ? p.areaPadrao : Math.max(1, Math.round(quadra.lotes.length / Math.max(1, quadra.fileiras)));
              onMudar(ajustarQuadra(projeto, res, quadra, { modo, valor }));
            }}>
              {(Object.keys(ROT_MODO) as ModoDivisao[]).map((m) => <option key={m} value={m}>{ROT_MODO[m]}</option>)}
            </select>
          </div>
          <div className="lot-linha">
            <label>{quadra.modo === "frente" ? "Frente" : quadra.modo === "area" ? "Área alvo" : "Lotes/fileira"}</label>
            <CampoNum valor={quadra.valor} casas={quadra.modo === "quantidade" ? 0 : 2} sufixo={quadra.modo === "frente" ? "m" : quadra.modo === "area" ? "m²" : ""}
              onAplicar={(v) => {
                if (v === undefined) return;
                const e = quadra.modo === "quantidade" ? null : conferirMedida(p, quadra.modo === "frente" ? "frente" : "area", v);
                if (onMudar(ajustarQuadra(projeto, res, quadra, { modo: quadra.modo, valor: v })) !== false && e) onMsg(comAviso(`Quadra ${quadra.nome} ajustada.`, e));
              }} />
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
          </>)}
          <div className="lot-linha">
            <label>Nome</label>
            <input defaultValue={quadra.nome} key={quadra.nome} onBlur={(e) => {
              const n = e.target.value.trim().toUpperCase();
              if (n && n !== quadra.nome) { onMudar(ajustarQuadra(projeto, res, quadra, { nome: n })); onSel({ tipo: "quadra", nome: n }); }
            }} />
          </div>
          <div className="lot-botoes">
            <button onClick={() => { onFerramenta("frente"); onMsg(`Clique no lado da quadra ${quadra.nome} que é o acesso (frente) dela — servidão, área verde, divisa com saída. Clicar de novo tira.`); }}
              title="Para quadra sem rua (ou com acesso por outro lado): o lado marcado conta como frente dos lotes">Escolher o acesso (frente) da quadra</button>
          </div>
          {(quadra.acessos?.length ?? 0) > 0 && <p className="lot-dica">{quadra.acessos!.length} lado(s) marcados como acesso — traço laranja no desenho.</p>}
          <div className={`lot-botoes ${quadra.cfg >= 0 ? "lot-botoes-3" : "lot-botoes-2"}`}>
            <button className="verde" onClick={() => virarArea("verde")} title="A quadra inteira vira área verde">Área verde</button>
            <button className="inst" onClick={() => virarArea("institucional")} title="A quadra inteira vira área institucional">Institucional</button>
            {quadra.cfg >= 0 && <button onClick={() => { onMudar(restaurarQuadra(projeto, quadra)); onMsg(`Quadra ${quadra.nome} de volta ao padrão.`); }}>Voltar ao padrão</button>}
          </div>
        </section>
      )}

      {rua && (
        <section className="lot-cartao">
          <header><span className="lot-tag">Rua</span><h3>{rua.nome}<Dica>Arraste os quadradinhos para mover o eixo; o "+" no meio de um trecho dobra a rua. Delete apaga.</Dica></h3></header>
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

      {/* ------------------------------------------------ fundo com fundo no projeto inteiro */}
      {!lotes.length && !quadra && res.quadras.some((q) => !q.estruturada && q.lotes.length >= 4) && (
        <section className="lot-cartao">
          <header><span className="lot-tag">Fundo com fundo</span></header>
          <p className="lot-dica">Refaz pela linha central cada quadra de duas fileiras: fundo com fundo alinhado, laterais no esquadro da rua e lotes com a mesma área. Só fica a quadra que melhora (as outras não mudam).</p>
          <button className="principal" onClick={() => onComando("fundo com fundo todas")}>Ajustar fundo com fundo em todas as quadras</button>
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
            {q.sobras > 0 && (p.pctVerdeMin > 0
              ? <tr className="falta"><td>Sobras sem destino</td><td>{fmt(q.sobras)} m²</td><td>{pct(q.sobras)}</td></tr>
              : <tr><td>Área remanescente</td><td>{fmt(q.sobras)} m²</td><td>{pct(q.sobras)}</td></tr>)}
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

// ------------------------------------------------------------------ painel recolhido
// O painel da direita fecha num trilho estreito: o desenho ganha a largura e
// ficam à mão só as ações do que está selecionado (igualar, fundo com fundo,
// unir, apagar, área verde, institucional) e a ida/volta entre as etapas.

const ICO: Record<string, string> = {
  igualar: "M5 9h14M5 15h14",
  fundo: "M3 12h18M4 5h16v14H4zM9 5v14M15 5v14",
  unir: "M4 5h16v14H4zM12 9v6M9 12h6",
  dividir: "M4 5h16v14H4zM12 5v14",
  apagar: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
  verde: "M12 3l6 8h-3.5l4 6H5.5l4-6H6zM12 17v4",
  inst: "M3 21h18M5 21V10l7-5 7 5v11M10 21v-5h4v5",
  todas: "M3 4h8v7H3zM13 4h8v7h-8zM3 13h8v7H3zM13 13h8v7h-8zM3 7.5h8M13 7.5h8M3 16.5h8M13 16.5h8",
  voltar: "M15 18l-6-6 6-6",
  ir: "M9 18l6-6-6-6",
  abrir: "M11 17l-5-5 5-5M18 17l-5-5 5-5",
};
const Ico = ({ d }: { d: string }) => <Icone d={d} size={18} />;

export function PainelRapido({ projeto, res, sel, onSel, onMudar, onMsg, onComando, onAbrir, onPerguntas, onEntregas }: Omit<Props, "onFocar" | "onFerramenta"> & {
  onAbrir: () => void; onPerguntas: () => void; onEntregas: () => void;
}) {
  const lotes = lotesDaSelecao(res, sel);
  const quadra = sel?.tipo === "quadra" ? quadraDe(res, sel.nome) : undefined;
  const umaQuadra = lotes.length > 0 && new Set(lotes.map((l) => l.quadra)).size === 1;
  const virarArea = (tipo: TipoArea) => {
    if (lotes.length) onComando(tipo);
    else if (quadra) { onMudar(ajustarQuadra(projeto, res, quadra, { destino: tipo })); onSel(null); onMsg(`Quadra ${quadra.nome} → ${ROTULO_AREA[tipo]}.`); }
  };
  type Acao = { rot: string; ico: string; titulo: string; fazer: () => void; cls?: string; desab?: boolean };
  const acoes: Acao[] = [];
  if (lotes.length > 1) {
    const media = lotes.reduce((s, l) => s + l.area, 0) / lotes.length;
    acoes.push({ rot: "Igualar", ico: ICO.igualar, cls: "forte", desab: !umaQuadra, fazer: () => onComando("igualar"), titulo: umaQuadra ? `Igualar áreas: todos com ${fmt(media)} m²` : "Selecione lotes de uma quadra só" });
    acoes.push({ rot: "Fundo c/ fundo", ico: ICO.fundo, desab: !umaQuadra, fazer: () => onComando("fundo com fundo"), titulo: `Ajustar fundo com fundo nos ${lotes.length} lotes` });
  }
  if (lotes.length === 1) acoes.push({ rot: "Dividir", ico: ICO.dividir, fazer: () => onComando("dividir 2"), titulo: "Dividir o lote em 2" });
  if (lotes.length) {
    acoes.push({ rot: lotes.length > 1 ? "Unir" : "Unir", ico: ICO.unir, fazer: () => onComando("unir"), titulo: lotes.length > 1 ? "Os selecionados viram um lote só" : "Une com o vizinho de maior divisa em comum" });
    acoes.push({ rot: "Apagar", ico: ICO.apagar, cls: "perigo", fazer: () => onComando("apagar"), titulo: "Apagar (Delete): a área fica livre" });
  }
  if (quadra) acoes.push({ rot: "Fundo c/ fundo", ico: ICO.fundo, cls: "forte", fazer: () => onComando("fundo com fundo"), titulo: `Ajustar fundo com fundo na quadra ${quadra.nome}` });
  if (lotes.length || quadra) {
    acoes.push({ rot: "Á. verde", ico: ICO.verde, cls: "verde", fazer: () => virarArea("verde"), titulo: "Vira área verde" });
    acoes.push({ rot: "Instituc.", ico: ICO.inst, cls: "inst", fazer: () => virarArea("institucional"), titulo: "Vira área institucional" });
  }
  if (!lotes.length && !quadra && res.quadras.some((q) => !q.estruturada && q.lotes.length >= 4)) {
    acoes.push({ rot: "Todas f. c/ f.", ico: ICO.todas, fazer: () => onComando("fundo com fundo todas"), titulo: "Ajustar fundo com fundo em todas as quadras" });
  }
  const oQue = lotes.length > 1 ? `${lotes.length} lotes` : lotes.length === 1 ? lotes[0].id : quadra ? `Q. ${quadra.nome}` : null;
  return (
    <aside className="rapido lot-rapido" aria-label="Ações rápidas">
      <button className="rapido-abrir" onClick={onAbrir} title="Abrir o painel (quadro de áreas, medidas, pendências)"><Ico d={ICO.abrir} /></button>
      {oQue && <span className="rapido-sel" title="Seleção">{oQue}</span>}
      {acoes.map((a) => (
        <button key={a.rot + a.ico} className={a.cls} disabled={a.desab} onClick={a.fazer} title={a.titulo}>
          <Ico d={a.ico} /><span>{a.rot}</span>
        </button>
      ))}
      {!acoes.length && <span className="rapido-vazio">Selecione lotes ou uma quadra</span>}
      <span className="rapido-esticar" />
      <button onClick={onPerguntas} title="Rever as perguntas"><Ico d={ICO.voltar} /><span>Perguntas</span></button>
      <button className="principal" onClick={onEntregas} title="Entregas: planta e locação"><Ico d={ICO.ir} /><span>Entregas</span></button>
    </aside>
  );
}
