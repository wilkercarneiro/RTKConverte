// Serviço de CAR: o imóvel do KML na prancheta, com a reserva legal, a APP dos
// rios e a área produtiva, e os shapefiles para o SICAR.
//
// O projeto é só intenção e mora em `car_projetos`; as camadas saem de
// `calcularCar` a cada mudança. Tudo roda no navegador.
import { useCallback, useEffect, useMemo, useState } from "react";
import { rotuloCurto } from "../../lib/modalidades";
import { useAutosave } from "../../lib/ux";
import type { Servico } from "../../lib/types";
import {
  FAIXAS_APP, ajustarReserva, calcularCar, fmtHa, fmtNum, fmtPct, normalizarProjetoCar, projetoNovo, reservaPorLado,
} from "../../lib/car/motor.ts";
import type { ProjetoCar, ResultadoCar } from "../../lib/car/motor.ts";
import { CAMADAS, baixar, gerarKmlCar, nomeArquivo, zipCompleto, zipDaCamada } from "../../lib/car/saidas.ts";
import type { CamadaCar } from "../../lib/car/saidas.ts";
import { carregarProjetoCar, marcarCarExportado, salvarProjetoCar } from "../../lib/car/persistencia.ts";
import { Dica, StatusSalvamento } from "../ui";
import { CarEditor, COR } from "./CarEditor";
import type { FerramentaCar, SelecaoCar } from "./CarEditor";
import "./car.css";

export interface ArmazenamentoCar {
  carregar: (servicoId: string) => Promise<Partial<ProjetoCar> | null>;
  salvar: (servicoId: string, p: ProjetoCar) => Promise<void>;
  marcarExportado?: (servicoId: string) => Promise<void>;
}

const BANCO: ArmazenamentoCar = { carregar: carregarProjetoCar, salvar: salvarProjetoCar, marcarExportado: marcarCarExportado };

interface Historico { passado: ProjetoCar[]; atual: ProjetoCar | null; futuro: ProjetoCar[]; base: ProjetoCar | null }

export function Car({ servico: servicoInicial, onVoltar, armazenamento = BANCO }: {
  servico: Servico; onVoltar: () => void; armazenamento?: ArmazenamentoCar;
}) {
  const [servico, setServico] = useState(servicoInicial);
  const [h, setH] = useState<Historico>({ passado: [], atual: null, futuro: [], base: null });
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [ferramenta, setFerramenta] = useState<FerramentaCar>("mover");
  const [sel, setSel] = useState<SelecaoCar>(null);
  const [satelite, setSatelite] = useState(true);
  const [msg, setMsg] = useState<{ t: string; erro?: boolean } | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const projeto = h.atual;

  useEffect(() => {
    let cancelado = false;
    armazenamento.carregar(servico.id).then((salvo) => {
      if (cancelado) return;
      const p = normalizarProjetoCar(salvo, projetoNovo(servico.denominacao ?? "Imóvel", []));
      if (p.perimetro.length < 3) { setErroCarga("O projeto deste serviço não tem o perímetro do imóvel."); return; }
      setH({ passado: [], atual: p, futuro: [], base: null });
    }).catch((e) => !cancelado && setErroCarga(e instanceof Error ? e.message : String(e)));
    return () => { cancelado = true; };
  }, [servico.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const auto = useAutosave(projeto, async (p) => { if (p) await armazenamento.salvar(servico.id, p); }, { ativo: !!projeto });

  const res: ResultadoCar | null = useMemo(() => {
    if (!projeto) return null;
    try { return calcularCar(projeto); } catch { return null; }
  }, [projeto]);

  const mostrar = useCallback((t: string, erro = false) => setMsg({ t, erro }), []);

  /** transiente = arraste em andamento: só o estado antes dele vai para o desfazer */
  const mudar = useCallback((p: ProjetoCar, transiente = false) => {
    setH((x) => {
      if (!x.atual) return x;
      if (transiente) return { ...x, atual: p, base: x.base ?? x.atual };
      return { passado: [...x.passado, x.base ?? x.atual].slice(-60), atual: p, futuro: [], base: null };
    });
  }, []);
  const fimArraste = useCallback(() => {
    setH((x) => (x.base && x.atual ? { passado: [...x.passado, x.base].slice(-60), atual: x.atual, futuro: [], base: null } : x));
  }, []);
  const desfazer = useCallback(() => setH((x) => (x.passado.length && x.atual
    ? { passado: x.passado.slice(0, -1), atual: x.passado[x.passado.length - 1], futuro: [x.atual, ...x.futuro], base: null } : x)), []);
  const refazer = useCallback(() => setH((x) => (x.futuro.length && x.atual
    ? { passado: [...x.passado, x.atual], atual: x.futuro[0], futuro: x.futuro.slice(1), base: null } : x)), []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); setSel(null); if (e.shiftKey) refazer(); else desfazer(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); setSel(null); refazer(); }
      else if (e.key === "Delete" && sel) { e.preventDefault(); apagarSelecionado(); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  });

  // ---------------- ações da reserva ----------------
  function porLado(lado: number, giro = projeto?.reserva.giro ?? 0) {
    if (!projeto) return;
    try {
      const poligonos = reservaPorLado(projeto, lado, giro);
      mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos, lado, giro } });
      setSel(null);
      setFerramenta("mover");
      mostrar(`Reserva encostada no lado ${lado + 1}, com ${fmtPct(projeto.reserva.pct)} do imóvel. Gire a divisa ou arraste os vértices para ajustar.`);
    } catch (e) { mostrar(e instanceof Error ? e.message : String(e), true); }
  }
  function ajustar() {
    if (!projeto) return;
    try {
      const poligonos = ajustarReserva(projeto);
      mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos } });
      setSel(null);
      mostrar(`Reserva ajustada a ${fmtPct(projeto.reserva.pct)} sem sair do lugar (a borda de dentro andou por igual).`);
    } catch (e) { mostrar(e instanceof Error ? e.message : String(e), true); }
  }
  function mudarPct(pct: number) {
    if (!projeto || !Number.isFinite(pct)) return;
    const p = { ...projeto, reserva: { ...projeto.reserva, pct: Math.max(0, Math.min(100, pct)) } };
    // faixa automática acompanha a porcentagem; desenho à mão espera o "Ajustar"
    if (p.reserva.lado !== null && p.reserva.poligonos.length) {
      try { p.reserva.poligonos = reservaPorLado(p, p.reserva.lado, p.reserva.giro); } catch { /* fica como estava */ }
    }
    mudar(p);
  }
  function apagarSelecionado() {
    if (!projeto || !sel) return;
    if (sel.tipo === "reserva") {
      mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos: projeto.reserva.poligonos.filter((_, i) => i !== sel.i), lado: null } });
    } else {
      mudar({ ...projeto, rios: projeto.rios.filter((r) => r.id !== sel.id) });
    }
    setSel(null);
  }
  const mudarRio = (id: string, patch: Partial<ProjetoCar["rios"][number]>) => projeto &&
    mudar({ ...projeto, rios: projeto.rios.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  // ---------------- downloads ----------------
  async function exportar(qual: CamadaCar | "tudo" | "kml") {
    if (!projeto || !res) return;
    setBaixando(qual);
    try {
      const base = nomeArquivo(projeto.nome);
      if (qual === "kml") baixar(gerarKmlCar(projeto, res), `${base}_CAR.kml`, "application/vnd.google-earth.kml+xml");
      else if (qual === "tudo") baixar(await zipCompleto(projeto, res), `${base}_CAR.zip`);
      else baixar(await zipDaCamada(projeto, res, qual), `${base}_${CAMADAS.find((c) => c.id === qual)!.arquivo}.zip`);
      if (servico.status !== "gerado") {
        await armazenamento.marcarExportado?.(servico.id);
        setServico({ ...servico, status: "gerado" });
      }
    } catch (e) { mostrar(e instanceof Error ? e.message : String(e), true); }
    finally { setBaixando(null); }
  }

  if (erroCarga) {
    return (
      <div className="centro"><div><h2>Não foi possível abrir o CAR</h2><p>{erroCarga}</p>
        <p className="car-dica">Se a mensagem fala da tabela <code>car_projetos</code>, falta aplicar a migração 0023 no banco.</p>
        <button onClick={onVoltar}>← Serviços</button></div></div>
    );
  }
  if (!projeto || !res) return <div className="centro"><span className="spinner" />&nbsp; Abrindo o CAR…</div>;

  const a = res.area;
  const vazia: Record<CamadaCar, boolean> = { imovel: false, reserva: !res.reserva.length, produtiva: !res.produtiva.length, app: !res.app.length };
  const ferramentas: [FerramentaCar, string, string][] = [
    ["mover", "↖", "Selecionar e mover (arraste vértices; o fundo move o mapa)"],
    ["lado", "⊟", "Reserva encostada num lado do imóvel, na porcentagem exata"],
    ["reserva", "⬠", "Desenhar a reserva à mão"],
    ["rio", "〰", "Traçar um rio (APP dos dois lados)"],
  ];
  const rioSel = sel?.tipo === "rio" ? projeto.rios.find((r) => r.id === sel.id) : undefined;

  return (
    <div className="conferencia car-pagina">
      <header className="topo">
        <button className="fantasma voltar" onClick={onVoltar}>← Serviços</button>
        <span className="sep" aria-hidden="true">/</span>
        <h1 className="titulo">{projeto.nome}</h1>
        <span className="chip mod-car">{rotuloCurto.car}</span>
        {servico.nome_arquivo_txt && <span className="arquivo">{servico.nome_arquivo_txt}</span>}
        <StatusSalvamento estado={auto.estado} horaSalvo={auto.horaSalvo} />
        <span className="esticar" />
        <span className="car-resumo-topo">
          <b>{fmtHa(a.imovel)}</b> · reserva <b className={res.reservaOk ? "" : "car-falta"}>{fmtPct(res.pctReserva)}</b>
        </span>
      </header>

      <div className="car-area-trabalho">
        <nav className="car-ferramentas" aria-label="Ferramentas">
          {ferramentas.map(([f, i, t]) => (
            <button key={f} title={t} aria-label={t} className={ferramenta === f ? "ativo" : ""} onClick={() => setFerramenta(f)}>{i}</button>
          ))}
          <span className="sep" />
          <button title="Desfazer (Ctrl+Z)" aria-label="Desfazer" disabled={!h.passado.length} onClick={desfazer}>↶</button>
          <button title="Refazer (Ctrl+Y)" aria-label="Refazer" disabled={!h.futuro.length} onClick={refazer}>↷</button>
          <span className="sep" />
          <button title="Imagem de satélite" aria-label="Imagem de satélite" className={satelite ? "ativo" : ""} onClick={() => setSatelite(!satelite)}>🛰</button>
        </nav>

        <div className="car-centro">
          <CarEditor projeto={projeto} res={res} ferramenta={ferramenta} onFerramenta={setFerramenta} sel={sel} onSel={setSel}
            onMudar={mudar} onFimArraste={fimArraste} onLado={(l) => porLado(l)} satelite={satelite} onMsg={(t) => mostrar(t)} />
          {msg && (
            <div className={`car-msg${msg.erro ? " erro" : ""}`} role="status">
              <span>{msg.t}</span>
              <button className="fantasma" onClick={() => setMsg(null)} aria-label="Fechar">×</button>
            </div>
          )}
        </div>

        <aside className="car-painel">
          <section className="car-cartao">
            <header><h3>Quadro de áreas</h3></header>
            <table className="car-quadro">
              <tbody>
                <tr><td><i style={{ background: COR.imovel }} />Área total</td><td>{fmtHa(a.imovel)}</td><td>100%</td></tr>
                <tr><td><i style={{ background: COR.reserva }} />Reserva legal</td><td>{fmtHa(a.reserva)}</td>
                  <td className={res.reservaOk ? "" : "car-falta"}>{fmtPct(res.pctReserva)}</td></tr>
                <tr><td><i style={{ background: COR.produtiva }} />Área produtiva</td><td>{fmtHa(a.produtiva)}</td><td>{fmtPct((100 * a.produtiva) / a.imovel)}</td></tr>
                <tr><td><i style={{ background: COR.app }} />APP</td><td>{fmtHa(a.app)}</td><td>{fmtPct((100 * a.app) / a.imovel)}</td></tr>
              </tbody>
            </table>
            {a.appNaReserva > 0.01 && <p className="car-dica">{fmtHa(a.appNaReserva)} da APP estão dentro da reserva legal.</p>}
            <label className="car-check">
              <input type="checkbox" checked={projeto.produtivaSemApp} onChange={(e) => mudar({ ...projeto, produtivaSemApp: e.target.checked })} />
              <span>Tirar a APP da área produtiva<Dica>Padrão: produtiva = total − reserva.</Dica></span>
            </label>
          </section>

          <section className="car-cartao">
            <header><h3>Reserva legal</h3>{res.reservaOk ? <span className="car-ok">✓ ok</span> : <span className="car-falta">abaixo do pedido</span>}</header>
            <label className="car-campo">
              <span>Porcentagem exigida<Dica>20% fora da Amazônia Legal; 35% no cerrado e 80% na floresta dentro dela. Confirme a regra do imóvel.</Dica></span>
              <span className="car-entrada">
                <input type="number" min={0} max={100} step={1} value={projeto.reserva.pct}
                  onChange={(e) => mudarPct(Number(e.target.value))} aria-label="Porcentagem da reserva legal" />
                <span>%</span>
              </span>
            </label>
            <div className="car-botoes">
              <button className={ferramenta === "lado" ? "ativo" : ""} onClick={() => setFerramenta("lado")}>⊟ Encostar num lado</button>
              <button className={ferramenta === "reserva" ? "ativo" : ""} onClick={() => setFerramenta("reserva")}>⬠ Desenhar à mão</button>
            </div>
            {projeto.reserva.lado !== null && projeto.reserva.poligonos.length > 0 && (
              <label className="car-campo">
                <span>Giro da divisa: {projeto.reserva.giro}°</span>
                <input type="range" min={-60} max={60} step={1} value={projeto.reserva.giro}
                  onChange={(e) => {
                    const giro = Number(e.target.value);
                    try {
                      const poligonos = reservaPorLado(projeto, projeto.reserva.lado!, giro);
                      mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos, giro } }, true);
                    } catch { /* giro sem solução: fica o anterior */ }
                  }}
                  onPointerUp={fimArraste} onKeyUp={fimArraste} />
              </label>
            )}
            {projeto.reserva.poligonos.length > 0 && (
              <div className="car-botoes">
                <button className="principal" onClick={ajustar} disabled={res.reservaOk && Math.abs(res.pctReserva - projeto.reserva.pct) < 0.01}>
                  Ajustar a {fmtPct(projeto.reserva.pct)}
                </button>
                <button onClick={() => { mudar({ ...projeto, reserva: { ...projeto.reserva, poligonos: [], lado: null } }); setSel(null); }}>Apagar reserva</button>
              </div>
            )}
            {sel?.tipo === "reserva" && (
              <p className="car-dica">Polígono {sel.i + 1} selecionado · arraste os vértices · Delete apaga só este polígono.</p>
            )}
          </section>

          <section className="car-cartao">
            <header><h3>Rios e APP<Dica>Trace o rio pela linha do leito e informe a faixa de APP, em metros, medida da linha para cada margem.</Dica></h3><span className="car-cont">{projeto.rios.length}</span></header>
            <button className={ferramenta === "rio" ? "ativo" : ""} onClick={() => setFerramenta("rio")}>〰 Traçar rio</button>
            {projeto.rios.map((r) => (
              <div key={r.id} className={`car-rio${rioSel?.id === r.id ? " sel" : ""}`} onClick={() => setSel({ tipo: "rio", id: r.id })}>
                <input className="car-rio-nome" value={r.nome} onChange={(e) => mudarRio(r.id, { nome: e.target.value })} aria-label="Nome do rio" />
                <span className="car-entrada">
                  <input type="number" min={1} step={1} value={r.faixa} onChange={(e) => mudarRio(r.id, { faixa: Math.max(0, Number(e.target.value)) })} aria-label="Faixa de APP em metros" />
                  <span>m</span>
                </span>
                <select value={FAIXAS_APP.some((f) => f.faixa === r.faixa) ? r.faixa : ""} onChange={(e) => e.target.value && mudarRio(r.id, { faixa: Number(e.target.value) })}
                  aria-label="Faixa pela largura do rio" title="Faixa mínima da Lei 12.651/2012, art. 4º">
                  <option value="">pela lei…</option>
                  {FAIXAS_APP.map((f) => <option key={f.faixa} value={f.faixa}>{f.faixa} m · {f.leito}</option>)}
                </select>
                <button className="fantasma" title="Apagar o rio" aria-label="Apagar o rio"
                  onClick={(e) => { e.stopPropagation(); mudar({ ...projeto, rios: projeto.rios.filter((x) => x.id !== r.id) }); setSel(null); }}>×</button>
              </div>
            ))}
          </section>

          {res.avisos.length > 0 && (
            <section className="car-cartao car-avisos">
              {res.avisos.map((t) => <p key={t}>⚠ {t}</p>)}
            </section>
          )}

          <section className="car-cartao">
            <header><h3>Arquivos para o SICAR<Dica>Cada camada sai num zip com SHP, SHX, DBF e PRJ (SIRGAS 2000, em grau).</Dica></h3></header>
            {CAMADAS.map((c) => (
              <div key={c.id} className="car-baixar">
                <i style={{ background: c.cor }} />
                <span>{c.titulo}<small>{c.arquivo}.shp</small></span>
                <button disabled={vazia[c.id] || !!baixando} onClick={() => exportar(c.id)}>{baixando === c.id ? "…" : "Baixar"}</button>
              </div>
            ))}
            <div className="car-botoes">
              <button className="principal" disabled={!!baixando} onClick={() => exportar("tudo")}>{baixando === "tudo" ? "Gerando…" : "Baixar tudo (zip)"}</button>
              <button disabled={!!baixando} onClick={() => exportar("kml")}>KML de conferência</button>
            </div>
            {!res.reservaOk && <p className="car-falta" style={{ fontSize: 12.5, margin: 0 }}>A reserva ainda não chega a {fmtPct(projeto.reserva.pct)} — o SICAR vai acusar.</p>}
            <p className="car-dica">Área total {fmtNum(a.imovel, 2)} m² · reserva {fmtNum(a.reserva, 2)} m² · produtiva {fmtNum(a.produtiva, 2)} m² · APP {fmtNum(a.app, 2)} m²</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
