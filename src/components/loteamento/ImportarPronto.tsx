// "Já tem o loteamento pronto?" — no topo das Perguntas. O operador solta o
// DXF/KML/KMZ/GeoJSON do loteamento já dividido (do CAD, do QGIS, do Google
// Earth), vê a prévia, o resumo e os avisos, e com um clique o projeto passa a
// ser o do arquivo (como "Usar esta proposta"): quadras com os lotes do
// arquivo, áreas públicas e o viário. Tudo continua editável na prancheta.
import { useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { fmt } from "../../lib/loteamento/calculo.ts";
import type { Perimetro, Resultado } from "../../lib/loteamento/calculo.ts";
import type { Projeto } from "../../lib/loteamento/modelo.ts";
import { EXTENSOES_IMPORTACAO, importarEmSegundoPlano } from "../../lib/loteamento/importar/index.ts";
import type { Importacao } from "../../lib/loteamento/importar/index.ts";
import { Dica } from "../ui";

interface Props {
  projeto: Projeto;
  perimetro: Perimetro;
  fuso: number;
  /** aplica o projeto importado e vai para a prancheta (a mensagem vai para a barra de comando) */
  onUsar: (pr: Projeto, msg: string) => void;
  /** o desenho pequeno, o mesmo das propostas (vem do Assistente) */
  previa: (res: Resultado) => ReactNode;
}

const LIMITE_MB = 60;

export function ImportarPronto({ projeto, perimetro, fuso, onUsar, previa }: Props) {
  const [lendo, setLendo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [imp, setImp] = useState<(Importacao & { arquivo: string }) | null>(null);
  const [arrastando, setArrastando] = useState(false);

  async function ler(f: File | undefined) {
    if (!f) return;
    setErro(null);
    setImp(null);
    if (f.size > LIMITE_MB * 1024 * 1024) { setErro(`Arquivo grande demais (${fmt(f.size / 1024 / 1024, 0)} MB; o limite é ${LIMITE_MB} MB).`); return; }
    setLendo(f.name);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const r = await importarEmSegundoPlano({ nome: f.name, bytes }, projeto, perimetro, fuso);
      setImp({ ...r, arquivo: f.name });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setLendo(null);
    }
  }

  const soltar = (e: DragEvent) => { e.preventDefault(); setArrastando(false); void ler(e.dataTransfer.files?.[0]); };
  const r = imp?.resumo;
  const pct = (v: number) => (r && r.gleba > 0 ? `${fmt((100 * v) / r.gleba, 1)}%` : "");
  return (
    <section className={`bloco lot-importar${arrastando ? " arrastando" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setArrastando(true); }} onDragLeave={() => setArrastando(false)} onDrop={soltar}>
      <header>
        <h3>Já tem o loteamento pronto?<Dica>
          Importe o loteamento já dividido — do CAD (DXF), do Google Earth (KML/KMZ) ou do QGIS (GeoJSON) — e ele vira o projeto daqui,
          com os lotes, a numeração e as áreas do arquivo. As coordenadas têm de estar em SIRGAS 2000 (UTM fuso {fuso}S ou latitude/longitude).<br />
          No DXF, os lotes são polilinhas fechadas; a camada diz o que é cada coisa (LOTE, QUADRA, AREA_VERDE, INSTITUCIONAL, APP, EIXO,
          PERIMETRO) e o texto dentro do lote é o número dele. O que não é lote, quadra nem área pública vira o sistema viário.<br />
          Depois de importar, a prancheta edita os lotes como qualquer outro (mover quina, unir, dividir) e as entregas saem lote a lote.
        </Dica></h3>
        <span className="desc">Importe o arquivo (DXF, KML/KMZ ou GeoJSON)</span>
      </header>
      {!imp && (
        <div className="lot-importar-escolha">
          <label className={`lot-importar-botao${lendo ? " desligado" : ""}`}>
            <input type="file" accept={EXTENSOES_IMPORTACAO} disabled={!!lendo} onChange={(e) => { void ler(e.target.files?.[0]); e.target.value = ""; }} />
            {lendo ? <><span className="spinner" /> Lendo {lendo}…</> : "Escolher arquivo"}
          </label>
          <span className="lot-dica">ou arraste o arquivo para cá. O loteamento do arquivo substitui o desenho atual (Ctrl+Z desfaz).</span>
        </div>
      )}
      {erro && <p className="lot-erro" role="alert">{erro}</p>}
      {imp && r && (
        <div className="lot-importar-previa">
          {previa(imp.res)}
          <div className="lot-importar-resumo">
            <b className="lot-importar-arquivo">{imp.arquivo}</b>
            <div className="lot-metricas">
              <div><b>{r.quadras}</b><span>quadras</span></div>
              <div><b>{r.lotes}</b><span>lotes</span></div>
              <div><b>{fmt(r.areaLotes, 0)} m²</b><span>área dos lotes · {pct(r.areaLotes)}</span></div>
              <div><b>{fmt(r.viario, 0)} m²</b><span>viário ({r.ruas} {r.ruas === 1 ? "rua" : "ruas"}) · {pct(r.viario)}</span></div>
              <div><b>{fmt(r.verde + r.institucional + r.app, 0)} m²</b><span>áreas públicas · {pct(r.verde + r.institucional + r.app)}</span></div>
              {r.remanescente > 0.5 && <div><b>{fmt(r.remanescente, 0)} m²</b><span>área livre / remanescente</span></div>}
            </div>
            {r.publicas.length > 0 && (
              <p className="lot-dica">{r.publicas.map((a) => `${a.nome} (${fmt(a.area)} m²)`).join(" · ")}</p>
            )}
            {imp.avisos.length > 0 && (
              <ul className="lot-importar-avisos">{imp.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
            )}
            <div className="lot-importar-acoes">
              <button className="principal" onClick={() => onUsar(imp.projeto,
                `Loteamento importado de ${imp.arquivo}: ${r.lotes} lotes em ${r.quadras} quadras, como no arquivo. Clique num lote para ajustar (mover quina, unir, dividir); Ctrl+Z volta ao projeto de antes.`)}>
                Usar este loteamento →
              </button>
              <button className="fantasma" onClick={() => { setImp(null); setErro(null); }}>Outro arquivo</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
