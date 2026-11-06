// A terraplanagem numa tela só: à esquerda as quatro perguntas (pontos,
// plataforma, cota, taludes); no meio, o resultado ao vivo — números, mapa de
// corte e aterro e as duas seções. Qualquer mudança recalcula (Web Worker,
// só o último pedido vale) e grava sozinha.
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ResultadoTerraplanagem } from "../../lib/terraplanagem/calculo.ts";
import { fmtN } from "../../lib/terraplanagem/calculo.ts";
import { Calculadora } from "../../lib/terraplanagem/segundo_plano.ts";
import type { Pt } from "../../lib/terraplanagem/geometria.ts";
import type { ModoCota, ModoPlataforma, ProjetoTerraplanagem, Retangulo } from "../../lib/terraplanagem/modelo.ts";
import { lerPoligonoKml } from "../../lib/terraplanagem/entrada.ts";
import { terraplanagemParaDxf, malhaParaCsv, nomeDoArquivo } from "../../lib/terraplanagem/saidas.ts";
import { rumo, textoCaminhoes, textoSaldo } from "../../lib/terraplanagem/textos.ts";
import { pngDoMapa } from "../../lib/terraplanagem/desenho.ts";
import { baixarBlob } from "../../lib/entregas";
import { avisar, Dica, ProximaAcao, Rotulo, Secao } from "../ui";
import { MapaTerraplanagem } from "./MapaTerraplanagem";
import type { Ferramenta } from "./MapaTerraplanagem";
import { PerfilSecao } from "./PerfilSecao";

export type EstadoGravacao = { estado: "ocioso" | "salvando" | "conta" | "aparelho"; hora: string | null };

const lerNum = (s: string): number => {
  const t = s.trim().replace(/\s/g, "").replace(/%$/, "");
  if (!t) return NaN;
  return Number(/,/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t);
};

/** Campo de número em português: digita à vontade, vale ao sair do campo ou no Enter. */
function CampoNumero({ valor, onValor, casas = 2, min = -Infinity, max = Infinity, passo = 1, sufixo, placeholder, rotulo, desabilitado }: {
  valor: number | null; onValor: (v: number | null) => void; casas?: number; min?: number; max?: number; passo?: number;
  sufixo?: string; placeholder?: string; rotulo: string; desabilitado?: boolean;
}) {
  const fmt = (v: number | null) => (v == null || !Number.isFinite(v) ? "" : fmtN(v, casas));
  const [texto, setTexto] = useState(fmt(valor));
  const [foco, setFoco] = useState(false);
  useEffect(() => { if (!foco) setTexto(fmt(valor)); }, [valor, foco]); // eslint-disable-line react-hooks/exhaustive-deps
  const aplicar = (t: string) => {
    if (!t.trim()) { if (placeholder) onValor(null); else setTexto(fmt(valor)); return; }
    const v = lerNum(t);
    if (!Number.isFinite(v)) { setTexto(fmt(valor)); return; }
    onValor(Math.min(max, Math.max(min, v)));
  };
  return (
    <span className={`tp-numero${sufixo ? " com-sufixo" : ""}`}>
      <input inputMode="decimal" className="mono" aria-label={rotulo} value={texto} placeholder={placeholder} disabled={desabilitado}
        onFocus={() => setFoco(true)}
        onChange={(e) => setTexto(e.target.value)}
        onBlur={(e) => { setFoco(false); aplicar(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const atual = lerNum(texto);
            const base = Number.isFinite(atual) ? atual : valor ?? 0;
            const v = Math.min(max, Math.max(min, Math.round((base + (e.key === "ArrowUp" ? passo : -passo)) / passo) * passo));
            setTexto(fmtN(v, casas)); onValor(v);
          }
        }} />
      {sufixo && <span className="tp-sufixo" aria-hidden="true">{sufixo}</span>}
    </span>
  );
}

function Segmento<T extends string>({ opcoes, valor, onValor, rotulo }: { opcoes: { v: T; r: string }[]; valor: T; onValor: (v: T) => void; rotulo: string }) {
  return (
    <div className="tp-segmento" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={o.v === valor} className={o.v === valor ? "ativo" : ""} onClick={() => onValor(o.v)}>{o.r}</button>
      ))}
    </div>
  );
}

function Passo({ n, titulo, dica, resumo, children }: { n: number; titulo: string; dica?: string; resumo?: ReactNode; children: ReactNode }) {
  return (
    <section className="tp-passo" aria-labelledby={`tp-passo-${n}`}>
      <header>
        <span className="tp-num" aria-hidden="true">{n}</span>
        <h3 id={`tp-passo-${n}`}>{titulo}{dica && <Dica>{dica}</Dica>}</h3>
        {resumo && <span className="tp-resumo">{resumo}</span>}
      </header>
      {children}
    </section>
  );
}

const RUMOS = [0, 45, 90, 135, 180, 225, 270, 315];
const m3 = (v: number) => `${fmtN(v, v >= 1000 ? 0 : 1)}`;

export function EditorTerraplanagem({ projeto, onProjeto, onResultado, onTrocarPontos, gravacao, avisosLeitura, emitente, topo }: {
  projeto: ProjetoTerraplanagem;
  onProjeto: (p: ProjetoTerraplanagem) => void;
  onResultado?: (r: ResultadoTerraplanagem | null) => void;
  /** volta à tela de entrada para trocar o arquivo */
  onTrocarPontos: () => void;
  gravacao: EstadoGravacao;
  avisosLeitura: string[];
  emitente?: string | null;
  /** cabeçalho da página (voltar, nome) */
  topo: ReactNode;
}) {
  const calc = useRef<Calculadora | null>(null);
  const [resultado, setResultado] = useState<ResultadoTerraplanagem | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("mover");
  const [foco, setFoco] = useState<string | null>(null);
  const [baixando, setBaixando] = useState<string | null>(null);
  const kmlRef = useRef<HTMLInputElement>(null);

  useEffect(() => { calc.current = new Calculadora(); return () => calc.current?.encerrar(); }, []);

  // o que entra na conta (nome e hora de gravação não recalculam)
  const chave = useMemo(() => JSON.stringify([projeto.plataforma, projeto.cota, projeto.taludes, projeto.fatores, projeto.secao]), [projeto.plataforma, projeto.cota, projeto.taludes, projeto.fatores, projeto.secao]);
  useEffect(() => {
    let vivo = true;
    setOcupado(true);
    (calc.current ?? new Calculadora()).calcular(projeto).then((r) => {
      if (!vivo || !r) return;
      setOcupado(false);
      if (r.ok) { setResultado(r.r); setErro(null); onResultado?.(r.r); }
      else { setErro(r.doUsuario ? r.erro : `Não deu para calcular: ${r.erro}`); }
    });
    return () => { vivo = false; };
  }, [chave, projeto.pontos]); // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (patch: Partial<ProjetoTerraplanagem>) => onProjeto({ ...projeto, ...patch });
  const plat = projeto.plataforma;
  const mudarPlat = (p: Partial<ProjetoTerraplanagem["plataforma"]>) => mudar({ plataforma: { ...plat, ...p } });
  const mudarCota = (p: Partial<ProjetoTerraplanagem["cota"]>) => mudar({ cota: { ...projeto.cota, ...p } });

  const pontosXY = useMemo(() => projeto.pontos.map((p) => [p.e, p.n] as Pt), [projeto.pontos]);
  const desnivel = useMemo(() => {
    let a = Infinity, b = -Infinity;
    for (const p of projeto.pontos) { if (p.z < a) a = p.z; if (p.z > b) b = p.z; }
    return b - a;
  }, [projeto.pontos]);

  const retanguloInicial = (): Retangulo => {
    const r = resultado?.retangulo;
    if (!r) {
      const xs = pontosXY.map((p) => p[0]), ys = pontosXY.map((p) => p[1]);
      const c: Pt = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      return { centro: c, largura: 20, comprimento: 30, giro: 0 };
    }
    const k = plat.modo === "contorno" ? 0.8 : 1;
    return { centro: r.centro, largura: Math.round(r.largura * k), comprimento: Math.round(r.comprimento * k), giro: Math.round(r.giro * 2) / 2 };
  };

  const trocarModo = (m: ModoPlataforma) => {
    if (m === "poligono" && !plat.poligono) { kmlRef.current?.click(); return; }
    if (m === "retangulo") { mudarPlat({ modo: m, retangulo: plat.retangulo ?? retanguloInicial() }); return; }
    mudarPlat({ modo: m });
  };

  const aoRetangulo = (r: Retangulo) => {
    // arrastar/desenhar vale na hora: o cálculo segue o dedo (a fila descarta os passos do meio)
    mudarPlat({ modo: "retangulo", retangulo: r });
  };

  const trocarCota = (m: ModoCota) => {
    if (m === "fixa") mudarCota({ modo: m, valor: projeto.cota.valor ?? (resultado ? Math.round(resultado.cota * 100) / 100 : null) });
    else mudarCota({ modo: m });
  };

  const abrirKml = async (f: File) => {
    try {
      const k = await lerPoligonoKml(f, projeto.fuso);
      mudar({ fuso: projeto.fuso ?? k.fuso, plataforma: { ...plat, modo: "poligono", poligono: k.utm, nomePoligono: k.nome ?? f.name } });
      avisar("ok", `Plataforma do KML: ${k.nome ?? f.name}${projeto.fuso ? "" : ` (fuso ${k.fuso})`}.`);
    } catch (e) {
      avisar("erro", e instanceof Error ? e.message : String(e));
    }
  };

  const baixar = async (tipo: "pdf" | "dxf" | "csv") => {
    if (!resultado) return;
    setBaixando(tipo);
    try {
      if (tipo === "pdf") {
        // o pdf-lib só é baixado por quem pede o relatório
        const { gerarPdfTerraplanagem } = await import("../../lib/terraplanagem/pdf.ts");
        const png = await pngDoMapa(resultado, pontosXY);
        const bytes = await gerarPdfTerraplanagem(resultado, projeto, png, { emitente });
        baixarBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), nomeDoArquivo(projeto.nome, "pdf"));
      } else if (tipo === "dxf") {
        baixarBlob(new Blob([terraplanagemParaDxf(resultado, projeto)], { type: "application/dxf" }), nomeDoArquivo(projeto.nome, "dxf"));
      } else {
        baixarBlob(new Blob([malhaParaCsv(resultado)], { type: "text/csv;charset=utf-8" }), nomeDoArquivo(projeto.nome, "csv"));
      }
    } catch (e) {
      avisar("erro", `Não deu para gerar o arquivo: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setBaixando(null); }
  };

  const r = resultado;
  const fontePontos = projeto.fonte.tipo === "arquivo" ? projeto.fonte.arquivo || "arquivo de pontos" : projeto.fonte.descricao;
  const saldoTxt = r ? textoSaldo(r) : "";
  const equilibrado = r?.caminhoes.para === "interno";

  const status = gravacao.estado === "salvando" ? "salvando…"
    : gravacao.estado === "conta" ? `salvo na conta${gravacao.hora ? ` às ${gravacao.hora}` : ""}`
    : gravacao.estado === "aparelho" ? `salvo neste aparelho${gravacao.hora ? ` às ${gravacao.hora}` : ""}`
    : "salva sozinho";

  return (
    <div className="tp-tela tela-cheia">
      <header className="tp-topo">
        {topo}
        <span className={`tp-gravacao ${gravacao.estado}`} aria-live="polite" title={gravacao.estado === "aparelho" ? "Sem conexão com a conta agora: o projeto está guardado neste navegador e vai para a conta na próxima mudança." : undefined}>
          <span className="ponto-salvo" aria-hidden="true" />{status}
        </span>
        <div className="tp-topo-acoes">
          <button type="button" disabled={!r || !!baixando} onClick={() => baixar("dxf")} title="Terreno, curvas, plataforma, taludes e mapa de corte/aterro em camadas (UTM)">
            {baixando === "dxf" ? <span className="spinner" /> : null}DXF para o CAD
          </button>
          <button type="button" disabled={!r || !!baixando} onClick={() => baixar("csv")} title="Cada nó da malha: E, N, terreno, projeto, corte e aterro (abre no Excel)">
            {baixando === "csv" ? <span className="spinner" /> : null}CSV da malha
          </button>
        </div>
      </header>

      <div className="tp-trabalho" data-tela-cheia>
        <aside className="tp-painel" aria-label="Dados do projeto">
          {[...avisosLeitura, ...(r?.avisos ?? [])].map((a) => <p key={a} className="tp-aviso" role="note">{a}</p>)}

          <Passo n={1} titulo="Pontos com cota" resumo={<button type="button" className="link" onClick={onTrocarPontos}>trocar</button>}
            dica="O terreno é a triangulação (TIN) dos pontos: entre três pontos vizinhos vale o plano que passa por eles, como no CAD.">
            <p className="tp-linha-info">
              <b>{fmtN(projeto.pontos.length, 0)} pontos</b> · {fontePontos}
            </p>
            <p className="tp-linha-info sub">
              desnível {fmtN(desnivel, 2)} m{r ? ` · espaçamento típico ${fmtN(r.espacamento, 1)} m · malha de ${fmtN(r.malha.passo, 2)} m` : ""}
            </p>
            {projeto.fonte.tipo === "relevo" && <p className="tp-aviso" role="note">Relevo público (modelo de ~30 m): estimativa para conversa com o cliente, não substitui o levantamento.</p>}
          </Passo>

          <Passo n={2} titulo="Plataforma" dica="Contorno dos pontos: a plataforma ocupa o levantamento inteiro, recuada da borda o bastante para o talude caber. Retângulo: arraste no mapa, puxe os cantos e gire. KML: a área desenhada no Google Earth."
            resumo={r ? `${fmtN(r.areaPlataforma, 0)} m²` : null}>
            <Segmento rotulo="Plataforma" valor={plat.modo} onValor={trocarModo}
              opcoes={[{ v: "contorno", r: "Contorno dos pontos" }, { v: "retangulo", r: "Retângulo" }, { v: "poligono", r: "KML" }]} />
            <input ref={kmlRef} type="file" accept=".kml,.kmz" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void abrirKml(f); }} />
            {plat.modo === "contorno" && (
              <div className="grade-2 tp-campos">
                <label><Rotulo dica="Distância entre a borda do levantamento e a plataforma. Vazio = automático: o maior recuo em que o talude ainda cabe nos pontos.">{plat.folga == null ? "Recuo (automático)" : "Recuo da borda"}</Rotulo>
                  <CampoNumero rotulo="Recuo da borda (m)" valor={plat.folga} placeholder={r?.folga != null ? fmtN(r.folga, 1) : "auto"} casas={1} min={0} max={500} sufixo="m"
                    onValor={(v) => mudarPlat({ folga: v })} />
                </label>
                <label><span>Medidas</span>
                  <span className="tp-valor-fixo">{r ? `${fmtN(r.retangulo.comprimento, 1)} × ${fmtN(r.retangulo.largura, 1)} m` : "—"}</span>
                </label>
              </div>
            )}
            {plat.modo === "retangulo" && plat.retangulo && (
              <>
                <div className="grade-3 tp-campos">
                  <label><span>Comprimento</span>
                    <CampoNumero rotulo="Comprimento (m)" valor={plat.retangulo.comprimento} casas={1} min={2} max={5000} sufixo="m"
                      onValor={(v) => v != null && mudarPlat({ retangulo: { ...plat.retangulo!, comprimento: v } })} />
                  </label>
                  <label><span>Largura</span>
                    <CampoNumero rotulo="Largura (m)" valor={plat.retangulo.largura} casas={1} min={2} max={5000} sufixo="m"
                      onValor={(v) => v != null && mudarPlat({ retangulo: { ...plat.retangulo!, largura: v } })} />
                  </label>
                  <label><Rotulo dica="Azimute do lado comprido (0° = norte). Também dá para girar pela régua no mapa.">Giro</Rotulo>
                    <CampoNumero rotulo="Giro (graus)" valor={plat.retangulo.giro} casas={1} min={0} max={180} passo={1} sufixo="°"
                      onValor={(v) => v != null && mudarPlat({ retangulo: { ...plat.retangulo!, giro: v } })} />
                  </label>
                </div>
                <p className="tp-linha-info sub">Arraste a plataforma no mapa; puxe um canto para mudar o tamanho.</p>
              </>
            )}
            {plat.modo === "poligono" && plat.poligono && (
              <p className="tp-linha-info">
                <b>{plat.nomePoligono || "Polígono"}</b> · {plat.poligono.length} vértices
                <button type="button" className="link" onClick={() => kmlRef.current?.click()}>outro KML</button>
              </p>
            )}
          </Passo>

          <Passo n={3} titulo="Cota da plataforma" dica="Equilibrar: o sistema acha a cota em que o corte cobre o aterro (vezes a compactação), sem trazer nem tirar terra. A cota vale no centro da plataforma."
            resumo={r ? `${fmtN(r.cota, 2)} m` : null}>
            <Segmento rotulo="Cota" valor={projeto.cota.modo} onValor={trocarCota}
              opcoes={[{ v: "equilibrio", r: "Equilibrar corte e aterro" }, { v: "fixa", r: "Digitar a cota" }]} />
            <div className="grade-2 tp-campos">
              <label className="largo"><span>Cota no centro</span>
                {projeto.cota.modo === "fixa"
                  ? <CampoNumero rotulo="Cota da plataforma (m)" valor={projeto.cota.valor} casas={2} passo={0.1} min={-100} max={6000} sufixo="m" onValor={(v) => v != null && mudarCota({ valor: v })} />
                  : <span className="tp-valor-fixo destaque">{r ? `${fmtN(r.cota, 3)} m` : "…"}</span>}
              </label>
              <label><Rotulo dica="Caimento da plataforma para a água escorrer (0 = plana). 1% a 2% é o comum em pátio e galpão.">Caimento</Rotulo>
                <CampoNumero rotulo="Caimento (%)" valor={projeto.cota.inclinacao} casas={1} passo={0.5} min={0} max={30} sufixo="%" onValor={(v) => mudarCota({ inclinacao: v ?? 0 })} />
              </label>
              <label><span>Escoa para</span>
                <select value={String(RUMOS.includes(projeto.cota.direcao) ? projeto.cota.direcao : 180)} disabled={!(projeto.cota.inclinacao > 0)}
                  onChange={(e) => mudarCota({ direcao: Number(e.target.value) })}>
                  {RUMOS.map((a) => <option key={a} value={a}>{rumo(a)}</option>)}
                </select>
              </label>
            </div>
          </Passo>

          <Passo n={4} titulo="Taludes" dica="Quantos metros na horizontal para cada metro na vertical. Corte 1:1 e aterro 1:1,5 é o usual em solo comum; 0 = a prumo (só com muro de arrimo)."
            resumo={`1:${fmtN(projeto.taludes.corte, 1)} · 1:${fmtN(projeto.taludes.aterro, 1)}`}>
            <div className="grade-2 tp-campos">
              <label><span>Corte (V:H)</span>
                <span className="tp-razao"><span>1 :</span><CampoNumero rotulo="Talude de corte (horizontal por 1 m)" valor={projeto.taludes.corte} casas={2} passo={0.25} min={0} max={20} onValor={(v) => v != null && mudar({ taludes: { ...projeto.taludes, corte: v } })} /></span>
              </label>
              <label><span>Aterro (V:H)</span>
                <span className="tp-razao"><span>1 :</span><CampoNumero rotulo="Talude de aterro (horizontal por 1 m)" valor={projeto.taludes.aterro} casas={2} passo={0.25} min={0} max={20} onValor={(v) => v != null && mudar({ taludes: { ...projeto.taludes, aterro: v } })} /></span>
              </label>
            </div>
          </Passo>

          <div className="secoes">
            <Secao titulo="Caminhão e solo" dica="Empolamento: quanto a terra cresce ao ser cavada (1 m³ no chão vira 1,25 m³ no caminhão). Compactação: quanto de corte cada m³ de aterro compactado consome."
              selo={`${fmtN(projeto.fatores.caminhao, 0)} m³ · ${fmtN(projeto.fatores.empolamento, 0)}%`}>
              <div className="grade-3 tp-campos">
                <label><span>Caçamba</span>
                  <CampoNumero rotulo="Caçamba do caminhão (m³)" valor={projeto.fatores.caminhao} casas={0} min={1} max={100} sufixo="m³" onValor={(v) => v != null && mudar({ fatores: { ...projeto.fatores, caminhao: v } })} />
                </label>
                <label><span>Empolamento</span>
                  <CampoNumero rotulo="Empolamento (%)" valor={projeto.fatores.empolamento} casas={0} min={0} max={200} passo={5} sufixo="%" onValor={(v) => v != null && mudar({ fatores: { ...projeto.fatores, empolamento: v } })} />
                </label>
                <label><span>Compactação</span>
                  <CampoNumero rotulo="Compactação (m³ de corte por m³ de aterro)" valor={projeto.fatores.compactacao} casas={2} min={0.5} max={2} passo={0.05} sufixo="×" onValor={(v) => v != null && mudar({ fatores: { ...projeto.fatores, compactacao: v } })} />
                </label>
              </div>
            </Secao>
          </div>

          <ProximaAcao acao={r ? {
            tom: "pronto", titulo: "Pronto para o cliente",
            detalhe: "Relatório em PDF com os números, o mapa, as duas seções e o método.",
            rotuloBotao: baixando === "pdf" ? "Gerando…" : "Baixar relatório", onClick: baixando ? undefined : () => void baixar("pdf"),
          } : { tom: "pendente", titulo: erro ? "Ajuste a plataforma" : "Calculando…", detalhe: erro ?? "Montando o terreno e a cota de equilíbrio." }} />
        </aside>

        <section className="tp-centro" aria-label="Resultado">
          <div className={`tp-kpis${ocupado && r ? " recalculando" : ""}`} aria-live="polite">
            <div className="tp-kpi corte">
              <span className="tp-kpi-rot">Corte</span>
              <b>{r ? m3(r.corte) : "…"}<small> m³</small></b>
              <span className="sub">{r ? `em ${fmtN(r.areaCorte, 0)} m² · até ${fmtN(r.maxCorte, 2)} m` : ""}</span>
            </div>
            <div className="tp-kpi aterro">
              <span className="tp-kpi-rot">Aterro</span>
              <b>{r ? m3(r.aterro) : "…"}<small> m³</small></b>
              <span className="sub">{r ? `em ${fmtN(r.areaAterro, 0)} m² · até ${fmtN(r.maxAterro, 2)} m` : ""}</span>
            </div>
            <div className={`tp-kpi saldo${equilibrado ? " equilibrado" : ""}`}>
              <span className="tp-kpi-rot">Saldo</span>
              <b>{r ? (equilibrado ? "equilibrado" : <>{m3(Math.abs(r.saldo))}<small> m³</small></>) : "…"}</b>
              <span className="sub">{saldoTxt}</span>
            </div>
            <div className="tp-kpi caminhoes">
              <span className="tp-kpi-rot">Caminhões</span>
              <b>{r ? <>≈ {fmtN(r.caminhoes.quantidade, 0)}</> : "…"}</b>
              <span className="sub">{r ? textoCaminhoes(r, projeto) : ""}</span>
            </div>
            <div className="tp-kpi cota">
              <span className="tp-kpi-rot">Cota da plataforma</span>
              <b>{r ? fmtN(r.cota, 2) : "…"}<small> m</small></b>
              <span className="sub">{r ? (r.equilibrio ? "equilibra corte e aterro" : "digitada") + (projeto.cota.inclinacao > 0 ? ` · ${fmtN(projeto.cota.inclinacao, 1)}% para ${rumo(projeto.cota.direcao)}` : "") : ""}</span>
            </div>
          </div>

          <div className="tp-mapa-caixa">
            <MapaTerraplanagem resultado={r} pontos={pontosXY} focoNaPlataforma={plat.modo !== "contorno"} retangulo={plat.modo === "retangulo" ? plat.retangulo : null}
              editavel={plat.modo === "retangulo"} ferramenta={ferramenta} onFerramenta={setFerramenta}
              onRetangulo={(rr) => aoRetangulo(rr)} onSecao={(c) => mudar({ secao: { ...projeto.secao, centro: c } })}
              ocupado={ocupado} secaoAtiva={foco} />
            {erro && (
              <div className="tp-erro-mapa" role="alert">
                <b>Não deu para calcular</b>
                <span>{erro}</span>
                {plat.modo !== "contorno" && <button type="button" onClick={() => mudarPlat({ modo: "contorno" })}>Voltar ao contorno dos pontos</button>}
              </div>
            )}
            {!r && !erro && <div className="tp-carregando-mapa"><span className="spinner" /> Montando o terreno…</div>}
          </div>

          {r && r.secoes.length > 0 && (
            <div className="tp-secoes">
              {r.secoes.map((s) => (
                <PerfilSecao key={s.nome} secao={s} titulo={s.nome === "A" ? "longitudinal" : "transversal"} ativa={foco === s.nome} onFoco={setFoco} />
              ))}
              {projeto.secao.centro && (
                <button type="button" className="link tp-secoes-reset" onClick={() => mudar({ secao: { centro: null, giro: null } })}>seções pelo meio da plataforma</button>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
