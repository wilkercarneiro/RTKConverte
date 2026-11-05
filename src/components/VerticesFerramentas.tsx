// Ferramentas da etapa de vértices: prévia da planilha do SIGEF (com os avisos
// de consistência), renomear em lote e inserir ponto num lado. A regra mora nas
// libs (planilha_sigef, consistencia_sigef, edicao_vertices); aqui é só tela.
import { useMemo, useState } from "react";
import { Dica, Gaveta } from "./ui";
import type { AvisoConsistencia, VerticeApontado } from "../lib/consistencia_sigef";
import { contarNiveis } from "../lib/consistencia_sigef";
import type { PreviaPlanilha } from "../lib/planilha_sigef";
import type { MudancaNome, PadraoNome, PosicaoNoLado } from "../lib/edicao_vertices";
import { avisosDaRenomeacao, previaRenomeacao, tipoHerdado } from "../lib/edicao_vertices";
import type { Vertice } from "../lib/types";

const num = (v: number, d: number) => v.toFixed(d).replace(".", ",");
const ROTULO_NIVEL = { erro: "Erro", alerta: "Alerta", info: "Informação" } as const;

// ---------------------------------------------------------------------------
// Lista de avisos (usada na gaveta e no aviso antes de gerar)
// ---------------------------------------------------------------------------

export function ListaAvisosSigef({ avisos, onVertice, max }: {
  avisos: AvisoConsistencia[];
  onVertice?: (v: VerticeApontado) => void;
  max?: number;
}) {
  const lista = max ? avisos.slice(0, max) : avisos;
  return (
    <ul className="sigef-avisos">
      {lista.map((a, i) => (
        <li key={`${a.regra}-${i}`} className={`sigef-aviso ${a.nivel}`}>
          <span className="nivel">{ROTULO_NIVEL[a.nivel]}</span>
          <div>
            <p>{a.mensagem}</p>
            {a.vertices.length > 0 && (
              <div className="sigef-pontos">
                {a.vertices.slice(0, 14).map((v, k) => (
                  onVertice
                    ? <button type="button" key={k} className="mono" onClick={() => onVertice(v)} title={`linha ${v.linha + 1} da ${v.aba}`}>{v.codigo || `linha ${v.linha + 1}`}</button>
                    : <span key={k} className="mono">{v.codigo || `linha ${v.linha + 1}`}</span>
                ))}
                {a.vertices.length > 14 && <span className="sub">+{a.vertices.length - 14}</span>}
              </div>
            )}
          </div>
        </li>
      ))}
      {max && avisos.length > max && <li className="sub">… e mais {avisos.length - max}. Veja todos na prévia da planilha.</li>}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Prévia da planilha
// ---------------------------------------------------------------------------

export function PreviaPlanilhaSigef({ previa, avisos, onFechar, onIrVertice }: {
  previa: PreviaPlanilha;
  avisos: AvisoConsistencia[];
  onFechar: () => void;
  /** leva à linha da tabela de vértices (ordem no banco) */
  onIrVertice?: (ordemBanco: number) => void;
}) {
  const [aba, setAba] = useState(0);
  const [marcado, setMarcado] = useState<{ aba: string; linha: number } | null>(null);
  const atual = previa.abas[Math.min(aba, previa.abas.length - 1)];
  const { erros, alertas } = contarNiveis(avisos);
  // linha → nível mais grave apontado nela (pinta a linha)
  const nivelDaLinha = useMemo(() => {
    const m = new Map<string, "erro" | "alerta">();
    for (const a of avisos) {
      if (a.nivel === "info") continue;
      for (const v of a.vertices) {
        const k = `${v.aba}#${v.linha}`;
        if (a.nivel === "erro" || !m.has(k)) m.set(k, a.nivel);
      }
    }
    return m;
  }, [avisos]);
  function apontar(v: VerticeApontado) {
    const i = previa.abas.findIndex((a) => a.aba === v.aba);
    if (i >= 0) setAba(i);
    setMarcado({ aba: v.aba, linha: v.linha });
    requestAnimationFrame(() => document.getElementById(`sigef-l-${v.aba}-${v.linha}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }
  return (
    <Gaveta larga olho="Planilha ODS do SIGEF" titulo="Prévia da planilha" onFechar={onFechar}
      rodape={<button className="principal" onClick={onFechar}>Fechar</button>}>
      {previa.erro ? <div className="erro">{previa.erro}</div> : (
        <>
          <div className="sigef-resumo">
            <span className={`selo ${erros ? "erro" : alertas ? "alerta" : "ok"}`}>
              {erros ? `${erros} erro(s)` : alertas ? "sem erros" : "tudo certo"}{alertas ? ` · ${alertas} alerta(s)` : ""}
            </span>
            <span className="sub">
              Coordenadas geográficas · MC-{previa.mcAbs}° · hemisfério {previa.hemisferio}
              {previa.realoca && <> · <b>códigos previstos</b><Dica lado="baixo">Os vértices sem código recebem o próximo número do credenciado só ao gerar. Os números em itálico são uma previsão: se outro serviço gerar antes, eles andam.</Dica></>}
            </span>
          </div>
          {previa.avisos.map((t, i) => <div key={i} className="nota-alerta">{t}</div>)}
          {avisos.length > 0 && <ListaAvisosSigef avisos={avisos} onVertice={apontar} />}
          {previa.abas.length > 1 && (
            <div className="abas-mini" role="tablist" aria-label="Abas da planilha">
              {previa.abas.map((a, i) => (
                <button key={a.aba} role="tab" aria-selected={i === aba} className={i === aba ? "ativo" : ""} onClick={() => setAba(i)}>
                  {a.aba} · {a.denominacao}
                </button>
              ))}
            </div>
          )}
          {atual && (
            <>
              <div className="sub">
                Aba <b className="mono">{atual.aba}</b> · {atual.denominacao} · parcela {atual.parcela} · {atual.linhas.length} vértices · {num(atual.areaHa, 4)} ha · {num(atual.perimetroM, 2)} m
              </div>
              <div className="tabela-wrap sigef-tabela">
                <table className="tabela-vertices compacta">
                  <thead>
                    <tr>
                      <th>Vértice</th><th>Longitude</th><th>σ long. (m)</th><th>Latitude</th><th>σ lat. (m)</th>
                      <th>Altitude (m)</th><th>σ h (m)</th><th>Método</th><th>Limite</th><th>CNS</th><th>Matrícula</th><th>Confrontante</th>
                    </tr>
                  </thead>
                  <tbody>
                    {atual.linhas.map((l, i) => {
                      const nivel = nivelDaLinha.get(`${atual.aba}#${i}`);
                      const sel = marcado?.aba === atual.aba && marcado.linha === i;
                      return (
                        <tr key={i} id={`sigef-l-${atual.aba}-${i}`} className={`${nivel ? `n-${nivel}` : ""} ${sel ? "sel" : ""}`}
                          onDoubleClick={() => l.ordemBanco !== null && onIrVertice?.(l.ordemBanco)}
                          title={l.ordemBanco !== null && onIrVertice ? "dois cliques: ir ao vértice na tabela" : undefined}>
                          <td className={`mono ${l.previsto ? "previsto" : ""}`}><span className={`chip ${l.tipo}`}>{l.tipo}</span> {l.codigo}</td>
                          <td className="mono">{l.lonFmt}</td>
                          <td className="mono">{num(l.sigmaPos, 3)}</td>
                          <td className="mono">{l.latFmt}</td>
                          <td className="mono">{num(l.sigmaPos, 3)}</td>
                          <td className="mono">{num(l.h, 3)}</td>
                          <td className="mono">{num(l.sigmaH, 3)}</td>
                          <td className="mono">{l.metodo}</td>
                          <td className="mono">{l.tipoLimite}</td>
                          <td className="mono">{l.cns ?? ""}</td>
                          <td className="mono">{l.matricula ?? ""}</td>
                          <td className="confrontante" title={l.descritivo}>{l.descritivo}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="sub" style={{ margin: 0 }}>
                A tabela é a mesma que a geração grava na planilha: começa no vértice mais ao norte, no sentido horário, e cada linha leva a confrontação do lado que sai dela.
              </p>
            </>
          )}
        </>
      )}
    </Gaveta>
  );
}

// ---------------------------------------------------------------------------
// Renomear em lote
// ---------------------------------------------------------------------------

export function RenomearVertices({ vertices, selecionado, ordemDoAnel, conferencia, prefixoCredenciado, contadores, onAplicar, onFechar }: {
  vertices: Vertice[];
  /** chaves (id ou o<ordem>) marcadas na tabela */
  selecionado: Set<string>;
  ordemDoAnel: number[];
  conferencia: boolean;
  prefixoCredenciado: string | null;
  contadores: { M: number; P: number; V: number } | null;
  onAplicar: (mudancas: MudancaNome[], comOficiais: boolean) => void;
  onFechar: () => void;
}) {
  const chave = (v: Vertice) => v.id ?? `o${v.ordem}`;
  const [alvo, setAlvo] = useState<"selecionados" | "M" | "P" | "V" | "todos">(selecionado.size ? "selecionados" : "P");
  const sugestao = conferencia ? "{T}-" : prefixoCredenciado ? `${prefixoCredenciado}-{T}-` : "{T}-";
  const [padrao, setPadrao] = useState<PadraoNome>({ prefixo: sugestao, inicio: 1, passo: 1, digitos: conferencia ? 0 : 4, ordem: "anel" });
  const filtro = (v: Vertice) =>
    alvo === "todos" ? true : alvo === "selecionados" ? selecionado.has(chave(v)) : v.tipo === alvo;
  const previa = useMemo(
    () => previaRenomeacao(vertices, filtro, padrao, { ordemDoAnel, conferencia }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vertices, alvo, padrao, ordemDoAnel, conferencia, selecionado],
  );
  const avisos = useMemo(() => avisosDaRenomeacao(vertices, previa, { conferencia, prefixo: prefixoCredenciado, contadores }), [vertices, previa, conferencia, prefixoCredenciado, contadores]);
  const oficiais = previa.mudancas.filter((m) => m.oficial && m.antes !== m.depois).length;
  const mudam = previa.mudancas.filter((m) => m.antes !== m.depois).length;
  const nomeDe = (o: number) => {
    const v = vertices.find((x) => x.ordem === o);
    return v?.num_txt ?? `${o + 1}º`;
  };
  const numero = (s: string, min: number) => { const n = Number(s.replace(",", ".")); return Number.isFinite(n) ? Math.max(min, Math.trunc(n)) : min; };
  return (
    <fieldset className="painel ferramenta-vertices">
      <legend>Renomear vértices em lote<Dica>Troca o CÓDIGO dos vértices escolhidos por um padrão. Use <b>{"{T}"}</b> no prefixo para a letra do tipo (M/P/V) — com ele cada tipo conta separado. Nada muda até você aplicar, e dá para desfazer.</Dica></legend>
      <div className="grade">
        <label>Quais vértices
          <select value={alvo} onChange={(e) => setAlvo(e.target.value as typeof alvo)}>
            <option value="selecionados" disabled={!selecionado.size}>os marcados na tabela ({selecionado.size})</option>
            <option value="M">todos os M</option>
            <option value="P">todos os P</option>
            <option value="V">todos os V</option>
            <option value="todos">todos</option>
          </select>
        </label>
        <label>Prefixo
          <input className="mono" value={padrao.prefixo} onChange={(e) => setPadrao({ ...padrao, prefixo: e.target.value })} placeholder="DSBN-{T}-" />
        </label>
        <label>Número inicial
          <input className="mono" inputMode="numeric" value={padrao.inicio} onChange={(e) => setPadrao({ ...padrao, inicio: numero(e.target.value, 0) })} />
        </label>
        <label>Passo
          <input className="mono" inputMode="numeric" value={padrao.passo} onChange={(e) => setPadrao({ ...padrao, passo: numero(e.target.value, 1) })} />
        </label>
        <label>Dígitos
          <select value={padrao.digitos} onChange={(e) => setPadrao({ ...padrao, digitos: Number(e.target.value) })}>
            {[0, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d === 0 ? "sem zeros" : `${d} (${"0".repeat(d - 1)}1)`}</option>)}
          </select>
        </label>
        <label>Na ordem
          <select value={padrao.ordem} onChange={(e) => setPadrao({ ...padrao, ordem: e.target.value as PadraoNome["ordem"] })}>
            <option value="anel">do perímetro (como na planilha)</option>
            <option value="tabela">da tabela</option>
          </select>
        </label>
      </div>
      {previa.mudancas.length === 0 ? <p className="sub">Nenhum vértice nessa escolha.</p> : (
        <div className="tabela-wrap renomear-previa">
          <table className="tabela-vertices compacta">
            <thead><tr><th>Ponto</th><th>Tipo</th><th>Antes</th><th></th><th>Depois</th></tr></thead>
            <tbody>
              {previa.mudancas.map((m) => (
                <tr key={m.chave} className={previa.conflitos.includes(m.depois) ? "n-erro" : m.oficial && m.antes !== m.depois ? "n-alerta" : ""}>
                  <td>{nomeDe(m.ordem)}</td>
                  <td><span className={`chip ${m.tipo}`}>{m.tipo}</span></td>
                  <td className="mono">{m.antes ?? <span className="sub">sem código</span>}{m.oficial && <span className="selo-mini" title="código oficial: já pode estar no SIGEF">oficial</span>}</td>
                  <td aria-hidden="true">→</td>
                  <td className="mono"><b>{m.depois}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {previa.conflitos.length > 0 && <div className="erro">Código repetido: {previa.conflitos.slice(0, 6).join(", ")}{previa.conflitos.length > 6 ? "…" : ""}. Mude o número inicial ou o prefixo.</div>}
      {avisos.map((a, i) => <div key={i} className="nota-alerta">{a}</div>)}
      <div className="acoes-linha">
        <span className="sub">{mudam} de {previa.mudancas.length} mudam{oficiais ? ` · ${oficiais} com código oficial` : ""}</span>
        <span style={{ flex: 1 }} />
        <button className="fantasma" onClick={onFechar}>cancelar</button>
        <button className="principal" disabled={!mudam || previa.conflitos.length > 0} onClick={() => onAplicar(previa.mudancas, oficiais > 0)}>
          Aplicar a {mudam} vértice(s)
        </button>
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Inserir ponto num lado
// ---------------------------------------------------------------------------

export interface PedidoInsercaoTela {
  ordem: number;
  posicao: PosicaoNoLado;
  tipo: "M" | "P" | "V" | null;
  codigo: string;
  /** reservar o próximo número do credenciado para o ponto novo */
  reservar: boolean;
}

export function InserirPontoNoLado({ vertices, nomePonto, comCodigosOficiais, conferencia, ladoM, onInserir, onFechar }: {
  vertices: Vertice[];
  nomePonto: (v: Vertice) => string | number;
  /** o serviço já tem todos os vértices com código oficial: ponto sem código renumeraria tudo */
  comCodigosOficiais: boolean;
  conferencia: boolean;
  /** comprimento do lado que sai do vértice (para dizer o limite da distância) */
  ladoM: (ordem: number) => number | null;
  onInserir: (p: PedidoInsercaoTela) => void;
  onFechar: () => void;
}) {
  const lista = useMemo(() => [...vertices].sort((a, b) => a.ordem - b.ordem), [vertices]);
  const [ordem, setOrdem] = useState<number | "">("");
  const [modo, setModo] = useState<"meio" | "distancia">("meio");
  const [metros, setMetros] = useState("");
  const [tipo, setTipo] = useState<"" | "M" | "P" | "V">("");
  const [codigo, setCodigo] = useState("");
  const [reservar, setReservar] = useState(comCodigosOficiais);
  const i = ordem === "" ? -1 : lista.findIndex((v) => v.ordem === ordem);
  const a = i >= 0 ? lista[i] : null, b = i >= 0 ? lista[(i + 1) % lista.length] : null;
  const lado = ordem === "" ? null : ladoM(ordem);
  const herdado = a && b ? tipoHerdado(a, b) : null;
  const m = Number(metros.replace(",", "."));
  const pronto = a && b && (modo === "meio" || (m > 0 && (lado === null || m < lado)));
  return (
    <fieldset className="painel ferramenta-vertices">
      <legend>Inserir ponto num lado<Dica>O ponto novo entra entre dois vértices seguidos da tabela, no meio ou a uma distância do primeiro. Altitude interpolada, precisão do pior dos dois, método PA1 (posição calculada) e a confrontação do lado onde cai.</Dica></legend>
      <div className="grade">
        <label>No lado que sai de
          <select value={ordem} onChange={(e) => setOrdem(e.target.value === "" ? "" : Number(e.target.value))}>
            <option value="">—</option>
            {lista.map((v, k) => (
              <option key={v.id ?? v.ordem} value={v.ordem}>{v.ordem + 1}º · {nomePonto(v)} → {nomePonto(lista[(k + 1) % lista.length])}</option>
            ))}
          </select>
        </label>
        <label>Onde
          <select value={modo} onChange={(e) => setModo(e.target.value as typeof modo)}>
            <option value="meio">no meio do lado</option>
            <option value="distancia">a uma distância do 1º ponto</option>
          </select>
        </label>
        {modo === "distancia" && (
          <label>Distância do 1º ponto (m)
            <input className="mono" inputMode="decimal" value={metros} onChange={(e) => setMetros(e.target.value)} placeholder="12,50" />
          </label>
        )}
        <label>Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="">do lado{herdado ? ` (${herdado})` : ""}</option>
            <option value="P">P · ponto</option>
            <option value="V">V · virtual</option>
            <option value="M">M · marco (continua a mesma confrontação)</option>
          </select>
        </label>
        <label>{conferencia ? "Código (a prévia numera)" : "Código (opcional)"}
          <input className="mono" value={codigo} disabled={reservar} onChange={(e) => setCodigo(e.target.value)} placeholder={reservar ? "reservado ao inserir" : "DSBN-P-0000"} />
        </label>
      </div>
      {comCodigosOficiais && !conferencia && (
        <label className="marcador">
          <input type="checkbox" checked={reservar} onChange={(e) => setReservar(e.target.checked)} />
          Reservar agora o próximo número do credenciado para este ponto
          <Dica>Os outros vértices já têm código oficial. Um ponto sem código faz a próxima geração renumerar o imóvel inteiro; reservando, só ele ganha número novo.</Dica>
        </label>
      )}
      <div className="acoes-linha">
        {a && b && <span className="sub">entre <b>{nomePonto(a)}</b> e <b>{nomePonto(b)}</b>{lado !== null ? ` · lado de ${num(lado, 3)} m` : ""}</span>}
        <span style={{ flex: 1 }} />
        <button className="fantasma" onClick={onFechar}>cancelar</button>
        <button className="principal" disabled={!pronto} onClick={() => ordem !== "" && onInserir({
          ordem, posicao: modo === "meio" ? { modo: "meio" } : { modo: "distancia", metros: m }, tipo: tipo || null, codigo, reservar: reservar && comCodigosOficiais && !conferencia,
        })}>Inserir ponto</button>
      </div>
    </fieldset>
  );
}
