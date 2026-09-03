// Tela de upload: drag-and-drop do TXT → Edge Function parse-txt.
import { useRef, useState } from "react";
import { chamarFuncao } from "../lib/supabase";
import { UFS } from "../lib/domains";
import { guardar, lembrar } from "../lib/ux";
import type { DefinicaoServico } from "../lib/modalidades";
import type { PreviewParse, Servico, Trecho, Vertice } from "../lib/types";
import { Icone, ICONE } from "./Icone";

export interface ResultadoParse {
  servico: Servico;
  vertices: Vertice[];
  trechos: Trecho[];
  preview: PreviewParse;
}

export function Upload({ definicao, onParsed, onVoltar }: {
  definicao: DefinicaoServico;
  onParsed: (r: ResultadoParse) => void;
  onVoltar?: () => void;
}) {
  const [arrastando, setArrastando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // um escritório trabalha quase sempre na mesma UF: a última escolhida já vem
  // marcada, o que na prática resolve o fuso antes de o operador pensar nele
  const [uf, setUf] = useState(() => lembrar("uf") ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  async function processar(file: File) {
    setCarregando(true);
    setErro(null);
    try {
      const conteudo = await file.text();
      const r = await chamarFuncao<ResultadoParse>("parse-txt", {
        nome_arquivo: file.name, conteudo, uf: uf || undefined,
      });
      onParsed(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="upload-tela fade">
      <div className="stepper">
        <span className="step ativa"><span className="num">1</span> Upload do TXT</span>
        <span className="step-seta">→</span>
        <span className="step"><span className="num">2</span> Conferência</span>
        <span className="step-seta">→</span>
        <span className="step"><span className="num">3</span> Documentos</span>
      </div>
      <div className="upload-card">
        {onVoltar && <button className="fantasma" style={{ justifySelf: "start", padding: 0 }} onClick={onVoltar}>← Início</button>}
        <div>
          <h2>{definicao.titulo}</h2>
          <p className="sub">{definicao.resumo}</p>
        </div>
        <p className="sub">Envie o TXT gerado pela máquina de topografia. O sistema detecta o fuso,
          converte as coordenadas e sugere os trechos de confrontantes pelos rótulos.</p>
        <label style={{ display: "grid", gap: 6, width: 200 }}>
          <span>UF do imóvel <span className="sub" style={{ fontSize: 12.5 }}>opcional · resolve o fuso UTM</span></span>
          <select value={uf} onChange={(e) => { setUf(e.target.value); guardar("uf", e.target.value); }}>
            <option value="">—</option>
            {UFS.map((u) => <option key={u}>{u}</option>)}
          </select>
          {uf && lembrar("uf") === uf && <small className="sub" style={{ fontSize: 12 }}>última UF usada</small>}
        </label>
        {/* role/tabIndex/onKeyDown: a zona de arraste era um div com onClick,
            inalcançável por teclado. */}
        <div
          className={`dropzone ${arrastando ? "ativo" : ""}`}
          role="button"
          tabIndex={carregando ? -1 : 0}
          aria-label="Enviar arquivo TXT do levantamento"
          aria-busy={carregando}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            const f = e.dataTransfer.files[0];
            if (f) processar(f);
          }}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); }
          }}
        >
          {carregando ? (
            <>
              <span className="spinner" />
              <b>Processando o levantamento…</b>
              <span>validando pontos, detectando fuso e convertendo coordenadas</span>
            </>
          ) : (
            <>
              <Icone d={ICONE.upload} size={36} traco={1.6} />
              <b style={{ marginTop: 6 }}>Arraste o TXT aqui</b>
              <span>ou clique para escolher o arquivo</span>
              <code style={{ marginTop: 6 }}>ID;E;N;h;σpos;σh</code>
            </>
          )}
          <input ref={inputRef} type="file" accept=".txt" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processar(f); }} />
        </div>
        {erro && <div className="erro">{erro}</div>}
      </div>
    </div>
  );
}
