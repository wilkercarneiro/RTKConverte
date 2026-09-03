// Editor das glebas: sub-polígonos desenhados DENTRO do perímetro.
//
// O caminho normal é o mesmo da escolha de confrontantes certificados: marcar
// na planta (ou na lista) os vértices do perímetro que formam a gleba e apertar
// "Dividir gleba". A gleba é o polígono desses vértices percorridos na ordem do
// perímetro, fechado pela reta entre o último e o primeiro — a divisa interna.
// Repete-se para a próxima gleba; vértices podem pertencer a mais de uma (os da
// divisa interna pertencem às duas).
//
// O mapa de ajuste fino (arrastar alça, ponto livre por coordenada, alt+clique)
// continua disponível, recolhido, para o caso que a seleção não resolve.
import { useEffect, useMemo, useState } from "react";
import type { Gleba, Trecho, Vertice } from "../lib/types";
import { anelDaSelecao, areaHaDoAnel, mesmoPonto, ordenarNoAnel } from "../lib/glebas";
import { trechoDoVertice } from "../lib/trechos";
import { CORES } from "./MapaSVG";
import { MapaGlebas } from "./MapaGlebas";
import { PlantaSelecao } from "./PlantaSelecao";
import type { PoligonoSelecao, PontoSelecao } from "./PlantaSelecao";
import { Secao } from "./ui";

export { areaHaDoAnel };

const fmt = (n: number, casas = 4) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

const COLUNAS = ["Nº", "Código", "Tipo", "Confrontação", "Gleba(s)"];

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
  // vértices marcados para a PRÓXIMA gleba (chave = ordem do vértice)
  const [marcados, setMarcados] = useState<Set<string>>(() => new Set());
  // Intervalo por número do TXT: o técnico levanta gleba por gleba, cada uma
  // começando onde a anterior terminou (1–29, 29–121, 121–230). "de" já vem
  // com o fim da gleba anterior; basta digitar "até".
  const [intervalo, setIntervalo] = useState({ de: "", ate: "" });

  // Pilha de desfazer sobre a lista INTEIRA de glebas, não sobre o contorno da
  // ativa: assim Ctrl+Z também desfaz criar e excluir gleba, e não só cliques.
  const [historico, setHistorico] = useState<Gleba[][]>([]);
  const guardar = () => setHistorico((h) => [...h.slice(-49), glebas]);
  const aplicar = (novo: Gleba[]) => { guardar(); onChange(novo); };
  const desfazer = () => {
    if (!historico.length) return;
    onChange(historico[historico.length - 1]);
    setHistorico((h) => h.slice(0, -1));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      e.preventDefault();
      desfazer();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [historico, glebas]);

  const ativa = Math.min(sel, Math.max(0, glebas.length - 1));
  const atual = glebas[ativa] ?? null;
  const somaHa = glebas.reduce((s, g) => s + areaHaDoAnel(g.anel), 0);
  const restanteHa = Math.max(0, areaTotalHa - somaHa);

  // ---- perímetro como pontos de seleção ----
  const perimetroVs = useMemo(
    () => vertices.filter((v) => v.e !== null && v.n !== null).sort((a, b) => a.ordem - b.ordem),
    [vertices],
  );
  const perimetro = useMemo(() => perimetroVs.map((v) => [Number(v.e), Number(v.n)] as [number, number]), [perimetroVs]);
  const trechosOrd = useMemo(() => [...trechos].sort((a, b) => a.vertice_inicio_ordem - b.vertice_inicio_ordem), [trechos]);
  const glebasDoPonto = (p: [number, number]) => glebas.flatMap((g, i) => (g.anel.some((q) => mesmoPonto(q, p)) ? [i] : []));

  const pontos = useMemo<PontoSelecao[]>(() => perimetroVs.map((v, i) => {
    const p = perimetro[i];
    const t = trechoDoVertice(trechosOrd, v.ordem);
    const donas = glebasDoPonto(p);
    return {
      id: String(v.ordem), x: p[0], y: p[1],
      rotulo: String(v.num_txt ?? v.codigo ?? v.ordem), tipo: v.tipo,
      titulo: `${v.codigo ?? `ponto ${v.num_txt ?? v.ordem}`}${t?.apelido_txt || t?.descritivo ? ` · ${t.descritivo || t.apelido_txt}` : ""}`,
      corFundo: donas.length ? CORES[donas[0] % CORES.length] : undefined,
      celulas: [
        String(v.num_txt ?? "—"),
        v.codigo ?? <span className="sub">na geração</span>,
        <span className={`chip ${v.tipo}`}>{v.tipo}</span>,
        t ? (t.descritivo?.split("\\")[0] || t.apelido_txt || "") : "",
        donas.length ? donas.map((i) => glebas[i].nome || `Gleba ${i + 1}`).join(", ") : <span className="sub">—</span>,
      ],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [perimetroVs, perimetro, trechosOrd, glebas]);

  const indicesMarcados = useMemo(() => {
    const porOrdem = new Map(perimetroVs.map((v, i) => [String(v.ordem), i]));
    return [...marcados].map((id) => porOrdem.get(id)).filter((i): i is number => i !== undefined);
  }, [marcados, perimetroVs]);
  const previa = indicesMarcados.length >= 3 ? anelDaSelecao(perimetro, indicesMarcados) : undefined;
  const areaPrevia = previa ? areaHaDoAnel(previa) : 0;

  /** Índices do perímetro entre dois números do TXT (inclusive), andando para a frente no anel. */
  function indicesDoIntervalo(de: string, ate: string): number[] | null {
    const nDe = Number(de.replace(",", ".")), nAte = Number(ate.replace(",", "."));
    const iDe = perimetroVs.findIndex((v) => v.num_txt === nDe);
    const iAte = perimetroVs.findIndex((v) => v.num_txt === nAte);
    if (iDe < 0 || iAte < 0) return null;
    const total = perimetroVs.length;
    const out: number[] = [];
    for (let k = iDe; ; k = (k + 1) % total) { out.push(k); if (k === iAte || out.length > total) break; }
    return out;
  }
  const intervaloIdx = intervalo.de && intervalo.ate ? indicesDoIntervalo(intervalo.de, intervalo.ate) : null;
  /** Marca o intervalo digitado (substitui a seleção): a prévia e o botão "Dividir" fazem o resto. */
  function marcarIntervalo() {
    if (!intervaloIdx) return;
    setMarcados(new Set(intervaloIdx.map((i) => String(perimetroVs[i].ordem))));
  }
  const ultimoNum = (idxs: number[]) => perimetroVs[idxs[idxs.length - 1]]?.num_txt;

  const poligonos: PoligonoSelecao[] = glebas
    .filter((g) => g.anel.length >= 2)
    .map((g, i) => ({ pontos: g.anel, cor: CORES[glebas.indexOf(g) % CORES.length], nome: g.nome || `GLEBA ${i + 1}`, tracejado: glebas.indexOf(g) !== ativa }));

  /** Muda sem registrar: o mapa já registrou pelo `onSnapshot` antes de mexer. */
  function editar(i: number, patch: Partial<Gleba>) {
    onChange(glebas.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  }
  function editarComDesfazer(i: number, patch: Partial<Gleba>) {
    aplicar(glebas.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  }
  function dividir() {
    if (!previa) return;
    aplicar([...glebas, {
      id: crypto.randomUUID(),
      servico_id: servicoId,
      ordem: glebas.length,
      nome: `GLEBA ${glebas.length + 1}`,
      anel: previa,
      confrontante_interno: null,
    }]);
    setSel(glebas.length);
    setMarcados(new Set());
    // a próxima gleba começa onde esta terminou (o ponto final é compartilhado)
    const fim = ultimoNum(ordenarNoAnel(indicesMarcados, perimetro.length));
    setIntervalo({ de: fim !== undefined && fim !== null ? String(fim) : "", ate: "" });
  }
  /** Marca o que ainda não pertence a gleba nenhuma — o "resto" do imóvel. */
  function marcarRestante() {
    setMarcados(new Set(perimetroVs.filter((_, i) => glebasDoPonto(perimetro[i]).length === 0).map((v) => String(v.ordem))));
  }
  function nova() {
    aplicar([...glebas, { id: crypto.randomUUID(), servico_id: servicoId, ordem: glebas.length, nome: `GLEBA ${glebas.length + 1}`, anel: [], confrontante_interno: null }]);
    setSel(glebas.length);
  }
  function remover(i: number) {
    aplicar(glebas.filter((_, k) => k !== i).map((g, k) => ({ ...g, ordem: k })));
    setSel(0);
  }

  return (
    <div className="glebas-editor">
      {/* ------- dividir: seleção na planta ------- */}
      <section className="dividir-gleba">
        <header>
          <b>Dividir gleba</b>
          <span className="sub">
            marque os vértices do perímetro que formam a gleba — a divisa interna é a reta entre o último e o primeiro marcado
          </span>
        </header>
        <div className="acoes-linha intervalo-gleba">
          <b style={{ fontSize: 13 }}>Por intervalo do TXT</b>
          <label>de <input className="mono" style={{ width: 70 }} value={intervalo.de} placeholder={String(perimetroVs[0]?.num_txt ?? "")}
            onChange={(e) => setIntervalo((i) => ({ ...i, de: e.target.value }))} /></label>
          <label>até <input className="mono" style={{ width: 70 }} value={intervalo.ate} placeholder="29"
            onChange={(e) => setIntervalo((i) => ({ ...i, ate: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") marcarIntervalo(); }} /></label>
          <button type="button" disabled={!intervaloIdx} onClick={marcarIntervalo}>Marcar intervalo</button>
          <span className="sub" style={{ fontSize: 12.5 }}>
            {intervalo.de && intervalo.ate
              ? (intervaloIdx ? `${intervaloIdx.length} vértices, fechando por dentro de ${intervalo.ate} a ${intervalo.de}` : "número não encontrado no TXT")
              : "a próxima gleba começa onde a anterior terminou; digite só o \"até\" e confira a prévia"}
          </span>
        </div>
        <PlantaSelecao
          pontos={pontos} colunas={COLUNAS} selecionados={marcados} onChange={setMarcados}
          poligonos={poligonos} previa={previa} ligarSelecionados={false}
          ariaLabel="Planta do imóvel — marque os vértices da gleba"
          acoes={<button type="button" className="fantasma" onClick={marcarRestante} disabled={!glebas.length}>Marcar o restante</button>}
          dica={<>Clique no primeiro vértice da gleba e depois no último: todos os que estão entre eles ficam marcados, pelo caminho mais curto do perímetro (o 1 e depois o 20 marcam 1 a 20). <b>Shift + clique</b> força o caminho para a frente; clicar num marcado desmarca só ele. Vértices da divisa interna entram nas duas glebas — pode marcar de novo.</>}
        />
        <div className="rodape-cert">
          <span className="sub">
            {previa
              ? <>Seleção: <b>{indicesMarcados.length} vértices · {fmt(areaPrevia)} ha</b></>
              : <>marque ao menos 3 vértices</>}
            {glebas.length > 0 && <> · glebas: {fmt(somaHa)} ha de {fmt(areaTotalHa)} ha · restante {fmt(restanteHa)} ha</>}
          </span>
          <span className="esticar" />
          <button className="principal" disabled={!previa} onClick={dividir}>
            Dividir gleba{previa ? ` (GLEBA ${glebas.length + 1} · ${fmt(areaPrevia)} ha)` : ""}
          </button>
        </div>
      </section>

      {/* ------- glebas já feitas ------- */}
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
        <button className="gleba-item novo" onClick={nova} title="gleba vazia, para montar no ajuste fino">+ Gleba vazia</button>
      </div>

      {glebas.length > 0 && somaHa > areaTotalHa * 1.001 && (
        <p className="sub" style={{ margin: "8px 0" }}>
          <em className="alerta">a soma das glebas ({fmt(somaHa)} ha) passou da área total ({fmt(areaTotalHa)} ha); confira os contornos</em>
        </p>
      )}

      {atual && (
        <div className="gleba-painel" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          <label>Nome da gleba
            <input value={atual.nome} onChange={(e) => editar(ativa, { nome: e.target.value })} placeholder="GLEBA 1" />
            <small className="sub">é a denominação da aba desta gleba na planilha SIGEF</small>
          </label>
          <label>Área calculada
            <input readOnly value={`${fmt(areaHaDoAnel(atual.anel))} ha`} className="mono" />
            <small className="sub">sai do contorno; não se digita</small>
          </label>
          <label>Confrontante da divisa interna
            <input value={atual.confrontante_interno ?? ""} placeholder="automático: a gleba vizinha, mesmo proprietário"
              onChange={(e) => editar(ativa, { confrontante_interno: e.target.value || null })} />
            <small className="sub">
              descritivo do lado que fecha a gleba por dentro; em branco sai "(MATR./CNS.) IMÓVEL - GLEBA VIZINHA\ PROPRIETÁRIO\ CPF"
            </small>
          </label>
          <div style={{ alignSelf: "end" }}>
            <button className="perigo-btn" onClick={() => remover(ativa)}>Excluir esta gleba</button>
          </div>
        </div>
      )}

      {atual && (
        <Secao titulo={`Ajuste fino do contorno — ${atual.nome || `Gleba ${ativa + 1}`}`}
          selo={<span className={`secao-selo ${atual.anel.length >= 3 ? "completa" : "vazia"}`}>{atual.anel.length} pontos</span>}
          dica="arrastar alças, ligar em reta, ponto livre por coordenada">
          <div className="gleba-trabalho">
            <MapaGlebas
              vertices={vertices}
              trechos={trechos}
              glebas={glebas}
              ativa={ativa}
              onChange={(anel) => editar(ativa, { anel })}
              onSnapshot={guardar}
            />
            <div className="gleba-painel">
              <div className="gleba-acoes">
                <button className="fantasma" disabled={!atual.anel.length}
                  onClick={() => editarComDesfazer(ativa, { anel: atual.anel.slice(0, -1) })}>
                  Desfazer último ponto
                </button>
                <button className="fantasma" disabled={!atual.anel.length}
                  onClick={() => editarComDesfazer(ativa, { anel: [] })}>
                  Limpar contorno
                </button>
                <button className="fantasma" disabled={atual.anel.length < 3}
                  onClick={() => editarComDesfazer(ativa, { anel: [...atual.anel].reverse() })}
                  title="inverte o sentido do contorno — não muda a área, só a ordem dos pontos">
                  Inverter sentido
                </button>
              </div>
              {atual.anel.length === 0
                ? <p className="sub">Nenhum ponto — use "Dividir gleba" acima ou clique nos vértices do mapa ao lado.</p>
                : (
                  <ol className="lista-pontos">
                    {atual.anel.map(([e, n], k) => (
                      <li key={k}>
                        <span className="mono">E {fmt(e, 3)} · N {fmt(n, 3)}</span>
                        <button className="fantasma" title="remover ponto"
                          onClick={() => editarComDesfazer(ativa, { anel: atual.anel.filter((_, i) => i !== k) })}>✕</button>
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
                      editarComDesfazer(ativa, { anel: [...atual.anel, [e, n]] });
                      setPonto({ e: "", n: "" });
                    }
                  }}>+ por coordenada</button>
              </div>
            </div>
          </div>
        </Secao>
      )}
    </div>
  );
}
