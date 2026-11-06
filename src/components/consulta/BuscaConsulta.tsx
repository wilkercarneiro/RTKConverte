// A caixa única da Consultar imóvel. Enquanto a pessoa digita, a linha de baixo
// diz o que o sistema entendeu ("Código do CAR · BA", "Coordenada → −12,40…");
// colar algo que já dá para consultar consulta na hora, sem precisar do botão.
// Ao lado, as outras entradas: arquivo, desenho no mapa e a localização do GPS.
import { useEffect, useRef, useState } from "react";
import { interpretarEntrada, utmParaEntrada } from "../../lib/consulta/entrada.ts";
import type { Entrada } from "../../lib/consulta/entrada.ts";
import { ACEITA_ARQUIVO } from "../../lib/consulta/arquivo.ts";
import { Icone, ICONE } from "../Icone";

const FUSOS = [18, 19, 20, 21, 22, 23, 24, 25];
const consultavel = (e: Entrada) => e.tipo === "car" || e.tipo === "sigef" || e.tipo === "coordenada";

export function BuscaConsulta({ texto, onTexto, onConsultar, onArquivo, desenhando, onDesenhar, onLocalizacao, ocupado, foco }: {
  texto: string;
  onTexto: (t: string) => void;
  /** a entrada já interpretada (o texto original vai junto, para o histórico) */
  onConsultar: (e: Entrada, texto: string) => void;
  onArquivo: (f: File) => void;
  desenhando: boolean;
  onDesenhar: () => void;
  onLocalizacao: () => void;
  ocupado: boolean;
  /** foca a caixa ao abrir (tela vazia) */
  foco?: boolean;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const [colado, setColado] = useState(false);
  const entrada = interpretarEntrada(texto);

  useEffect(() => { if (foco) campo.current?.focus({ preventScroll: true }); }, [foco]);
  // colou algo consultável: consulta sem esperar o Enter
  useEffect(() => {
    if (!colado) return;
    setColado(false);
    if (consultavel(entrada) && !ocupado) onConsultar(entrada, texto);
  }, [colado]); // eslint-disable-line react-hooks/exhaustive-deps

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (consultavel(entrada)) onConsultar(entrada, texto);
    else campo.current?.focus();
  }

  return (
    <form className="cb" onSubmit={enviar} role="search" aria-label="Consultar imóvel">
      <div className="cb-linha">
        <label className="cb-campo">
          <span className="sr-only">Código do CAR, coordenada ou link do Google Maps</span>
          <Icone d={ICONE.busca} size={20} />
          <input ref={campo} value={texto} onChange={(e) => onTexto(e.target.value)} onPaste={() => setColado(true)}
            placeholder="Cole o código do CAR, uma coordenada ou um link do Google Maps"
            autoComplete="off" spellCheck={false} inputMode="text" enterKeyHint="search" />
          {texto && <button type="button" className="cb-limpar" aria-label="Limpar" title="Limpar" onClick={() => { onTexto(""); campo.current?.focus(); }}>✕</button>}
        </label>
        <button type="submit" className="principal" disabled={ocupado || !consultavel(entrada)}>{ocupado ? "Consultando…" : "Consultar"}</button>
      </div>
      <div className="cb-pe">
        <Entendi entrada={entrada} onFuso={(f) => {
          if (entrada.tipo !== "utm_sem_fuso") return;
          const e = utmParaEntrada(entrada.e, entrada.n, f);
          onConsultar(e, `${texto} fuso ${f}`);
        }} />
        <div className="cb-alternativas" role="group" aria-label="Outras formas de informar a área">
          <button type="button" className="cb-alt" onClick={() => arquivo.current?.click()} title="KML, KMZ, GPX ou GeoJSON da área (também dá para arrastar o arquivo para a tela)">
            <Icone d={ICONE.upload} size={15} traco={2} />Enviar arquivo
          </button>
          <button type="button" className={`cb-alt${desenhando ? " ativo" : ""}`} aria-pressed={desenhando} onClick={onDesenhar} title="Clique no mapa para marcar os vértices da área">
            <Icone d="M3 21l3.5-1 11-11-2.5-2.5-11 11zM14 6.5l2.5 2.5" size={15} traco={2} />{desenhando ? "Desenhando…" : "Desenhar no mapa"}
          </button>
          <button type="button" className="cb-alt" onClick={onLocalizacao} title="Consulta o ponto onde você está (GPS do aparelho)">
            <Icone d="M12 2v3M12 19v3M2 12h3M19 12h3M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z" size={15} traco={2} />Onde estou
          </button>
          <input ref={arquivo} type="file" accept={ACEITA_ARQUIVO} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onArquivo(f); e.target.value = ""; }} />
        </div>
      </div>
    </form>
  );
}

function Entendi({ entrada, onFuso }: { entrada: Entrada; onFuso: (f: number) => void }) {
  if (entrada.tipo === "vazio") return <span className="cb-entendi vazio" />;
  if (entrada.tipo === "invalida") {
    return <p className="cb-entendi invalida" role="status"><span className="cb-icone" aria-hidden>!</span><span>{entrada.motivo}</span></p>;
  }
  if (entrada.tipo === "utm_sem_fuso") {
    return (
      <div className="cb-entendi" role="status">
        <span className="cb-icone" aria-hidden>?</span>
        <span><b>{entrada.descricao}</b> · falta o fuso:</span>
        <span className="cb-fusos">{FUSOS.map((f) => <button key={f} type="button" className="cb-fuso" onClick={() => onFuso(f)}>{f}S</button>)}</span>
      </div>
    );
  }
  return (
    <p className="cb-entendi" role="status">
      <span className="cb-icone" aria-hidden>✓</span>
      <span><b>{entrada.descricao}</b>{entrada.tipo === "coordenada" && entrada.aviso ? <span className="cb-aviso"> · {entrada.aviso}</span> : null}</span>
    </p>
  );
}
