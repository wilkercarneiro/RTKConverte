// Entrada do CAR: o KML/KMZ da área total do imóvel ou o GPX do GPS de mão
// (pontos de passagem marcados na divisa, ou a trilha andada). Não passa pelo
// parse-txt — o serviço nasce aqui, com o projeto já gravado.
import { useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { UFS } from "../../lib/domains";
import { guardar, lembrar } from "../../lib/ux";
import type { DefinicaoServico } from "../../lib/modalidades";
import type { Servico } from "../../lib/types";
import { lerKml } from "../../lib/car/kml.ts";
import type { KmlLido } from "../../lib/car/kml.ts";
import { avisosDosPontos, lerGpx, perimetroDosPontos } from "../../lib/car/gpx.ts";
import type { PontoGps } from "../../lib/car/gpx.ts";
import { calcularCar, fmtHa, fmtNum, projetoNovo } from "../../lib/car/motor.ts";
import { criarServicoCar } from "../../lib/car/persistencia.ts";
import { Icone, ICONE } from "../Icone";
import { Dica, Passos } from "../ui";
import { ehAceiteGeral, textoSemCredito } from "../../lib/creditos";
import "./car.css";

async function textoDoArquivo(f: File): Promise<string> {
  if (!/\.kmz$/i.test(f.name)) return f.text();
  const zip = await JSZip.loadAsync(await f.arrayBuffer());
  const kml = Object.values(zip.files).find((x) => !x.dir && /\.kml$/i.test(x.name));
  if (!kml) throw new Error("O KMZ não tem nenhum arquivo .kml dentro.");
  return kml.async("string");
}

/** O que foi lido: o perímetro e, no GPX de pontos, os pontos para ligar/desligar. */
interface Lido { arquivo: string; kml: KmlLido; pontos: PontoGps[] | null }

export function CarNovo({ definicao, clienteId, pedidoId, usarCreditoGeral = false, onCriado, onVoltar, voltarPara = "o Início" }: {
  definicao: DefinicaoServico;
  clienteId?: string;
  pedidoId?: string;
  /** a pessoa já aceitou pagar este CAR com 1 crédito geral */
  usarCreditoGeral?: boolean;
  onCriado: (s: Servico, usouCreditoGeral: boolean) => void;
  onVoltar?: () => void;
  /** para onde o "← Voltar" leva (aberto pela página do cliente, "o cliente") */
  voltarPara?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [lido, setLido] = useState<Lido | null>(null);
  /** pontos do GPS tirados do perímetro (índice em lido.pontos) */
  const [fora, setFora] = useState<Set<number>>(new Set());
  const [nome, setNome] = useState("");
  const [uf, setUf] = useState(() => lembrar("uf") ?? "");
  const [municipio, setMunicipio] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  // os créditos de CAR acabaram entre abrir a tela e criar: o banco pede o aceite
  const [pedeAceite, setPedeAceite] = useState(false);

  async function ler(f: File) {
    setErro(null);
    try {
      const texto = await textoDoArquivo(f);
      const gpx = /\.gpx$/i.test(f.name) || (!/\.km[lz]$/i.test(f.name) && /<gpx[\s>]/i.test(texto));
      const lidoGpx = gpx ? lerGpx(texto) : null;
      const kml: KmlLido = lidoGpx ?? lerKml(texto);
      setLido({ arquivo: f.name, kml, pontos: lidoGpx?.pontos ?? null });
      setFora(new Set());
      setNome((kml.nome ?? f.name).replace(/\.(km[lz]|gpx)$/i, ""));
    } catch (e) {
      setLido(null);
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  /** o perímetro em uso: o do arquivo, ou o refeito sem os pontos tirados */
  const entrada = useMemo((): KmlLido | null => {
    if (!lido) return null;
    if (!lido.pontos || !fora.size) return lido.kml;
    const r = perimetroDosPontos(lido.pontos.filter((_, i) => !fora.has(i)));
    const nomes = lido.pontos.map((p, i) => (fora.has(i) ? p.nome ?? `#${i + 1}` : null)).filter(Boolean).join(", ");
    return { ...lido.kml, perimetro: r.anel, nomes: r.nomes, avisos: [...avisosDosPontos(r, lido.pontos.length - fora.size), `${fora.size} ponto(s) fora do perímetro: ${nomes}.`] };
  }, [lido, fora]);

  const previa = useMemo(() => {
    if (!lido || !entrada || entrada.perimetro.length < 3) return null;
    const pr = projetoNovo(nome, entrada.perimetro, entrada.rios, entrada.nomes);
    const res = calcularCar(pr);
    const pts = res.imovel.ext;
    const todos = [...pts, ...(lido.pontos ?? []).map((p) => res.plano.para([p.lon, p.lat]))];
    const xs = todos.map((p) => p[0]), ys = todos.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = 200 / Math.max(x1 - x0, y1 - y0, 1);
    const xy = (p: [number, number]): [number, number] => [16 + (p[0] - x0) * s, 18 + (y1 - p[1]) * s];
    const tela = (p: [number, number]) => xy(p).map((v) => v.toFixed(1)).join(",");
    return {
      pr, area: res.area.imovel,
      d: "M" + pts.map(tela).join("L") + "Z",
      rios: pr.rios.map((r) => "M" + r.linha.map((g) => tela(res.plano.para(g))).join("L")),
      pontos: (lido.pontos ?? []).map((p) => ({ nome: p.nome, xy: xy(res.plano.para([p.lon, p.lat])) })),
      w: 52 + (x1 - x0) * s, h: 36 + (y1 - y0) * s,
    };
  }, [lido, entrada, nome]);

  function alternarPonto(i: number) {
    if (!lido?.pontos) return;
    const f = new Set(fora);
    if (f.has(i)) f.delete(i);
    else if (lido.pontos.length - f.size > 3) f.add(i);
    else { setErro("O perímetro precisa de pelo menos 3 pontos."); return; }
    setErro(null);
    setFora(f);
  }

  async function criar(comGeral = usarCreditoGeral) {
    if (!lido || !previa) return;
    setCriando(true);
    setErro(null);
    setPedeAceite(false);
    try {
      const s = await criarServicoCar({
        arquivo: lido.arquivo, projeto: { ...previa.pr, nome: nome.trim() || "Imóvel" },
        uf: uf || null, municipio: municipio.trim() || null, clienteId, pedidoId, usarCreditoGeral: comGeral,
      });
      onCriado(s, comGeral);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (ehAceiteGeral(m)) setPedeAceite(true);
      setErro(textoSemCredito(m));
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="upload-tela fade">
      <Passos rotulo="Etapas do CAR" passos={[
        { rotulo: "KML ou GPX da área total", estado: lido ? "feita" : "ativa" },
        { rotulo: "Reserva legal e APP", estado: "futura" },
        { rotulo: "Shapefiles", estado: "futura" },
      ]} />
      <div className="upload-card">
        {onVoltar && <button className="fantasma voltar-para" onClick={onVoltar}>← Voltar para {voltarPara}</button>}
        <div>
          <h2>{definicao.titulo}<Dica>{definicao.resumo}</Dica></h2>
        </div>

        <div
          className={`dropzone ${arrastando ? "ativo" : ""}${lido ? " linha" : ""}`}
          role="button" tabIndex={0} aria-label="Enviar o KML ou o GPX da área total"
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files[0]; if (f) ler(f); }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
        >
          {lido ? (
            <><b>{lido.arquivo}</b><span>clique ou arraste outro arquivo para trocar</span></>
          ) : (
            <>
              <Icone d={ICONE.upload} size={36} traco={1.6} />
              <b className="dz-titulo">Arraste o KML ou o GPX da área total aqui</b>
              <span>ou clique para escolher · .kml, .kmz ou .gpx (pontos ou trilha do GPS)</span>
            </>
          )}
          <input ref={inputRef} type="file" accept=".kml,.kmz,.gpx" hidden onClick={(e) => e.stopPropagation()}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ""; }} />
        </div>

        {lido && entrada && previa && (
          <div className="car-novo-previa">
            <svg width={previa.w} height={previa.h} viewBox={`0 0 ${previa.w} ${previa.h}`} aria-hidden={!lido.pontos}>
              <path d={previa.d} fill="#F5C54233" stroke="#C99A12" strokeWidth={2} />
              {previa.rios.map((d, i) => <path key={i} d={d} fill="none" stroke="#1565C0" strokeWidth={2.5} />)}
              {previa.pontos.map((p, i) => (
                <g key={i} className={`car-ponto${fora.has(i) ? " fora" : ""}`} onClick={() => alternarPonto(i)}>
                  <title>{fora.has(i) ? "Fora do perímetro — clique para pôr de volta" : "Clique para tirar do perímetro"}</title>
                  <circle cx={p.xy[0]} cy={p.xy[1]} r={4.5} fill="#C99A12" stroke="#fff" strokeWidth={1.5} />
                  {p.nome && <text x={p.xy[0] + 6} y={p.xy[1] - 5}>{p.nome}</text>}
                </g>
              ))}
            </svg>
            <div className="car-novo-dados">
              <p><b>{fmtHa(previa.area)}</b> · {fmtNum(previa.area, 2)} m² · {entrada.perimetro.length} vértices
                {entrada.rios.length > 0 && <> · {entrada.rios.length} rio(s) no arquivo</>}</p>
              {entrada.avisos.map((a) => <p key={a} className="car-dica">⚠ {a}</p>)}
              {lido.pontos && <p className="car-dica">Clique num ponto do desenho para tirá-lo do perímetro (a sede, um ponto de outro dia) ou pô-lo de volta.</p>}
              <label className="car-campo">
                <span>Nome do imóvel</span>
                <input value={nome} onChange={(e) => setNome(e.target.value)} />
              </label>
              <div className="car-novo-local">
                <label className="car-campo car-campo-uf">
                  <span>UF <small className="sub">opcional</small></span>
                  <select value={uf} onChange={(e) => { setUf(e.target.value); guardar("uf", e.target.value); }}>
                    <option value="">—</option>
                    {UFS.map((u) => <option key={u}>{u}</option>)}
                  </select>
                </label>
                <label className="car-campo car-campo-municipio">
                  <span>Município <small className="sub">opcional</small></span>
                  <input value={municipio} onChange={(e) => setMunicipio(e.target.value)} />
                </label>
              </div>
              <button className="principal" disabled={criando} onClick={() => criar()}>
                {criando ? "Criando o serviço…" : "Criar o serviço e marcar a reserva →"}
              </button>
              {usarCreditoGeral && <small className="sub">Este CAR usa 1 crédito geral, como você aceitou.</small>}
            </div>
          </div>
        )}
        {erro && <div className="erro" role="alert">{erro}</div>}
        {pedeAceite && (
          <div className="acoes-linha">
            <button className="principal" disabled={criando} onClick={() => criar(true)}>Usar 1 crédito geral e criar</button>
          </div>
        )}
      </div>
    </div>
  );
}
