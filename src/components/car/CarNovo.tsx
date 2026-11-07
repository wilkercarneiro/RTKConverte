// Entrada do CAR: o KML/KMZ da área total do imóvel ou o GPX do GPS de mão
// (pontos de passagem marcados na divisa, ou a trilha andada). Não passa pelo
// parse-txt — o serviço nasce aqui, com o projeto já gravado.
import { useEffect, useMemo, useRef, useState } from "react";
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
import type { BaseAreaCar, ProjetoCar } from "../../lib/car/motor.ts";
import { EscolhaBaseArea } from "./BaseArea";
import { criarServicoCar } from "../../lib/car/persistencia.ts";
import { Icone, ICONE } from "../Icone";
import { Dica, Passos } from "../ui";
import { ehAceiteGeral, textoSemCredito } from "../../lib/creditos";
import { pegarAreaTransferida, transferirArea } from "../../lib/area_transferida";
import type { AreaTransferida } from "../../lib/area_transferida";
import { pedirAbrirMedicao } from "../../lib/campo/ponte.ts";
import { hashNoLaboratorio } from "../../lib/laboratorio_destino";
import { textosDaAreaLevada } from "../../lib/car/area_levada.ts";
import { consultarMunicipio } from "../../lib/consulta/ambiente.ts";
import "./car.css";

async function textoDoArquivo(f: File): Promise<string> {
  if (!/\.kmz$/i.test(f.name)) return f.text();
  const zip = await JSZip.loadAsync(await f.arrayBuffer());
  const kml = Object.values(zip.files).find((x) => !x.dir && /\.kml$/i.test(x.name));
  if (!kml) throw new Error("O KMZ não tem nenhum arquivo .kml dentro.");
  return kml.async("string");
}

/** O que foi lido: o perímetro e, no GPX de pontos, os pontos para ligar/desligar. */
interface Lido { arquivo: string; kml: KmlLido; pontos: PontoGps[] | null; /** veio de uma ferramenta (Consultar imóvel, Medir no campo), não de arquivo */ origem?: string; /** a área e as partes que a origem mostrou */ levada?: { areaOrigemM2?: number; partes?: number }; /** a frase da origem ("Área medida no campo hoje às 14:32 (GPS do celular, ±3,3 m)") */ frase?: string }

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
  /** UF e município vieram do IBGE pelo lugar da área (diz embaixo do campo) */
  const [municipioAuto, setMunicipioAuto] = useState(false);
  /** a pessoa já escolheu UF/município: a resposta do IBGE não passa por cima */
  const mexeuNoLocal = useRef(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  // os créditos de CAR acabaram entre abrir a tela e criar: o banco pede o aceite
  const [pedeAceite, setPedeAceite] = useState(false);
  /** a área veio de uma ferramenta: o "← Voltar" volta para ela (a Consulta, a medição do Campo) */
  const [veio, setVeio] = useState<AreaTransferida | null>(null);
  /** em que área o CAR fala: a pessoa escolhe; começa na UTM (a do SIGEF, do Campo e da Consulta) ou na última escolhida */
  const [base, setBase] = useState<BaseAreaCar>(() => (lembrar("car-base-area") === "albers" ? "albers" : "utm"));

  // área levada de uma ferramenta (Consultar imóvel, Medir no campo): já abre
  // com o perímetro, como se o KML tivesse sido enviado. pegarAreaTransferida()
  // lê e apaga: no StrictMode a 2ª passada do efeito acha nada e não mexe.
  useEffect(() => {
    const a = pegarAreaTransferida();
    if (!a) return;
    const nomeArq = `${(a.nome || "area").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\w-]+/g, "_").slice(0, 60) || "area"}.kml`;
    setLido({ arquivo: nomeArq, kml: { nome: a.nome, perimetro: a.perimetro, nomes: a.nomes, rios: [], avisos: [] }, pontos: null, origem: a.origem,
      levada: { areaOrigemM2: a.areaOrigemM2, partes: a.partes }, frase: a.frase });
    if (a.volta) setVeio(a);
    setFora(new Set());
    setNome(a.nome);
    if (a.uf) { setUf(a.uf); guardar("uf", a.uf); }
    if (a.municipio) setMunicipio(a.municipio);
    if (a.uf && a.municipio) return;
    // a medição de campo não sabe onde está: o IBGE diz (a mesma consulta do "Município" da Consulta).
    // Só preenche o que a pessoa ainda não escreveu; sem internet, os campos ficam como estão.
    const n = a.perimetro.length;
    const lon = a.perimetro.reduce((t, p) => t + p[0], 0) / n, lat = a.perimetro.reduce((t, p) => t + p[1], 0) / n;
    // (sem cancelar na limpeza: no StrictMode a 2ª passada não acha mais a área e não refaz a busca)
    consultarMunicipio(lon, lat, { timeoutMs: 8_000 }).then((m) => {
      if (mexeuNoLocal.current || !m?.nome || !/^[A-Z]{2}$/.test(m.uf)) return;
      setUf(m.uf); guardar("uf", m.uf);
      setMunicipio(m.nome);
      setMunicipioAuto(true);
    }).catch(() => { /* sem IBGE: a pessoa preenche */ });
  }, []);

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
    const pr: ProjetoCar = { ...projetoNovo(nome, entrada.perimetro, entrada.rios, entrada.nomes), baseArea: base };
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
      levada: lido.origem ? textosDaAreaLevada(entrada.perimetro, res.area.imovel, lido.levada) : null,
      d: "M" + pts.map(tela).join("L") + "Z",
      rios: pr.rios.map((r) => "M" + r.linha.map((g) => tela(res.plano.para(g))).join("L")),
      pontos: (lido.pontos ?? []).map((p) => ({ nome: p.nome, xy: xy(res.plano.para([p.lon, p.lat])) })),
      w: 52 + (x1 - x0) * s, h: 36 + (y1 - y0) * s,
    };
  }, [lido, entrada, nome, base]);

  function alternarPonto(i: number) {
    if (!lido?.pontos) return;
    const f = new Set(fora);
    if (f.has(i)) f.delete(i);
    else if (lido.pontos.length - f.size > 3) f.add(i);
    else { setErro("O perímetro precisa de pelo menos 3 pontos."); return; }
    setErro(null);
    setFora(f);
  }

  /** "← Voltar para a Consulta" / "← Voltar para Pasto da sede": a ferramenta reabre com a mesma área */
  function voltarParaOrigem() {
    const v = veio?.volta;
    if (!v) { onVoltar?.(); return; }
    if (v.reenviar) transferirArea({ ...veio, volta: undefined });
    if (v.medicaoId) pedirAbrirMedicao(v.medicaoId);
    const lab = hashNoLaboratorio(v.hash);
    // no laboratório troca o endereço SEM o hashchange (a tela montaria antes do reload e gastaria o pedido)
    if (lab) { history.replaceState(null, "", lab); location.reload(); return; }
    location.hash = v.hash;
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
        {veio?.volta
          ? <button className="fantasma voltar-para voltar-pagina" onClick={voltarParaOrigem}>← Voltar para {veio.volta.rotulo}</button>
          : onVoltar && <button className="fantasma voltar-para voltar-pagina" onClick={onVoltar}>← Voltar para {voltarPara}</button>}
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
            <><b>{lido.origem ? "Área já carregada" : lido.arquivo}</b><span>{lido.origem ? "clique ou arraste um KML/GPX para trocar" : "clique ou arraste outro arquivo para trocar"}</span></>
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
              <p className="car-novo-area"><b>{fmtHa(previa.area)}</b>
                {" "}· {fmtNum(previa.area, 2)} m² · {entrada.perimetro.length} vértices
                {entrada.rios.length > 0 && <> · {entrada.rios.length} rio(s) no arquivo</>}</p>
              {/* a mesma área da origem só na base UTM; na de área igual a frase diria uma coisa falsa */}
              {lido.origem && (base === "utm"
                ? <p className="car-dica car-novo-veio" role="note">{lido.frase ?? `Área de ${lido.origem}`} — a mesma que você viu lá.</p>
                : <p className="car-dica" role="note">{lido.frase ?? `Área de ${lido.origem}`}. Lá ela aparece em UTM; aqui, na projeção de área igual que você escolheu.</p>)}
              <EscolhaBaseArea perimetro={entrada.perimetro} valor={base} onMudar={(b) => { setBase(b); guardar("car-base-area", b); }} />
              {previa.levada?.linhaPartes && <p className="car-dica" role="note">⚠ {previa.levada.linhaPartes}</p>}
              {entrada.avisos.map((a) => <p key={a} className="car-dica">⚠ {a}</p>)}
              {lido.pontos && <p className="car-dica">Clique num ponto do desenho para tirá-lo do perímetro (a sede, um ponto de outro dia) ou pô-lo de volta.</p>}
              <label className="car-campo">
                <span>Nome do imóvel</span>
                <input value={nome} onChange={(e) => setNome(e.target.value)} />
              </label>
              <div className="car-novo-local">
                <label className="car-campo car-campo-uf">
                  <span>UF <small className="sub">opcional</small></span>
                  <select value={uf} onChange={(e) => { mexeuNoLocal.current = true; setUf(e.target.value); guardar("uf", e.target.value); setMunicipioAuto(false); }}>
                    <option value="">—</option>
                    {UFS.map((u) => <option key={u}>{u}</option>)}
                  </select>
                </label>
                <label className="car-campo car-campo-municipio">
                  <span>Município <small className="sub">opcional</small></span>
                  <input value={municipio} onChange={(e) => { mexeuNoLocal.current = true; setMunicipio(e.target.value); setMunicipioAuto(false); }} />
                </label>
              </div>
              {municipioAuto && <small className="sub">UF e município achados pelo lugar da área (IBGE). Pode trocar.</small>}
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
