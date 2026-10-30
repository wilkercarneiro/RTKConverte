// Entrada do CAR: o KML (ou KMZ) da área total do imóvel. Não passa pelo
// parse-txt — o serviço nasce aqui, com o projeto já gravado.
import { useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import { UFS } from "../../lib/domains";
import { guardar, lembrar } from "../../lib/ux";
import type { DefinicaoServico } from "../../lib/modalidades";
import type { Servico } from "../../lib/types";
import { lerKml } from "../../lib/car/kml.ts";
import type { KmlLido } from "../../lib/car/kml.ts";
import { calcularCar, fmtHa, fmtNum, projetoNovo } from "../../lib/car/motor.ts";
import { criarServicoCar } from "../../lib/car/persistencia.ts";
import { Icone, ICONE } from "../Icone";
import { Dica, Passos } from "../ui";
import { textoSemCredito } from "../../lib/creditos";
import "./car.css";

async function textoDoArquivo(f: File): Promise<string> {
  if (!/\.kmz$/i.test(f.name)) return f.text();
  const zip = await JSZip.loadAsync(await f.arrayBuffer());
  const kml = Object.values(zip.files).find((x) => !x.dir && /\.kml$/i.test(x.name));
  if (!kml) throw new Error("O KMZ não tem nenhum arquivo .kml dentro.");
  return kml.async("string");
}

export function CarNovo({ definicao, clienteId, pedidoId, onCriado, onVoltar, voltarPara = "o Início" }: {
  definicao: DefinicaoServico;
  clienteId?: string;
  pedidoId?: string;
  onCriado: (s: Servico) => void;
  onVoltar?: () => void;
  /** para onde o "← Voltar" leva (aberto pela página do cliente, "o cliente") */
  voltarPara?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);
  const [lido, setLido] = useState<{ arquivo: string; kml: KmlLido } | null>(null);
  const [nome, setNome] = useState("");
  const [uf, setUf] = useState(() => lembrar("uf") ?? "");
  const [municipio, setMunicipio] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);

  async function ler(f: File) {
    setErro(null);
    try {
      const kml = lerKml(await textoDoArquivo(f));
      setLido({ arquivo: f.name, kml });
      setNome((kml.nome ?? f.name).replace(/\.km[lz]$/i, ""));
    } catch (e) {
      setLido(null);
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  const previa = useMemo(() => {
    if (!lido) return null;
    const pr = projetoNovo(nome, lido.kml.perimetro, lido.kml.rios);
    const res = calcularCar(pr);
    const pts = res.imovel.ext;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = 200 / Math.max(x1 - x0, y1 - y0, 1);
    const tela = (p: [number, number]) => `${(10 + (p[0] - x0) * s).toFixed(1)},${(10 + (y1 - p[1]) * s).toFixed(1)}`;
    return {
      pr, area: res.area.imovel,
      d: "M" + pts.map(tela).join("L") + "Z",
      rios: pr.rios.map((r) => "M" + r.linha.map((g) => tela(res.plano.para(g))).join("L")),
      w: 20 + (x1 - x0) * s, h: 20 + (y1 - y0) * s,
    };
  }, [lido, nome]);

  async function criar() {
    if (!lido || !previa) return;
    setCriando(true);
    setErro(null);
    try {
      const s = await criarServicoCar({
        arquivo: lido.arquivo, projeto: { ...previa.pr, nome: nome.trim() || "Imóvel" },
        uf: uf || null, municipio: municipio.trim() || null, clienteId, pedidoId,
      });
      onCriado(s);
    } catch (e) {
      setErro(textoSemCredito(e instanceof Error ? e.message : String(e)));
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="upload-tela fade">
      <Passos rotulo="Etapas do CAR" passos={[
        { rotulo: "KML da área total", estado: lido ? "feita" : "ativa" },
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
          role="button" tabIndex={0} aria-label="Enviar o KML da área total"
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
              <b className="dz-titulo">Arraste o KML da área total aqui</b>
              <span>ou clique para escolher · .kml ou .kmz · polígono ou linha fechada</span>
            </>
          )}
          <input ref={inputRef} type="file" accept=".kml,.kmz" hidden onClick={(e) => e.stopPropagation()}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) ler(f); e.target.value = ""; }} />
        </div>

        {lido && previa && (
          <div className="car-novo-previa">
            <svg width={previa.w} height={previa.h} viewBox={`0 0 ${previa.w} ${previa.h}`} aria-hidden="true">
              <path d={previa.d} fill="#F5C54233" stroke="#C99A12" strokeWidth={2} />
              {previa.rios.map((d, i) => <path key={i} d={d} fill="none" stroke="#1565C0" strokeWidth={2.5} />)}
            </svg>
            <div className="car-novo-dados">
              <p><b>{fmtHa(previa.area)}</b> · {fmtNum(previa.area, 2)} m² · {lido.kml.perimetro.length} vértices
                {lido.kml.rios.length > 0 && <> · {lido.kml.rios.length} rio(s) no arquivo</>}</p>
              {lido.kml.avisos.map((a) => <p key={a} className="car-dica">⚠ {a}</p>)}
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
              <button className="principal" disabled={criando} onClick={criar}>
                {criando ? "Criando o serviço…" : "Criar o serviço e marcar a reserva →"}
              </button>
            </div>
          </div>
        )}
        {erro && <div className="erro" role="alert">{erro}</div>}
      </div>
    </div>
  );
}
