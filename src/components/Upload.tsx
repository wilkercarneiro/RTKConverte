// Tela de upload (5.1): drag-and-drop do TXT → Edge Function parse-txt.
import { useRef, useState } from "react";
import { chamarFuncao } from "../lib/supabase";
import { UFS } from "../lib/domains";
import type { PreviewParse, Servico, Trecho, Vertice } from "../lib/types";

export interface ResultadoParse {
  servico: Servico;
  vertices: Vertice[];
  trechos: Trecho[];
  preview: PreviewParse;
}

export function Upload({ onParsed, onVoltar }: { onParsed: (r: ResultadoParse) => void; onVoltar?: () => void }) {
  const [arrastando, setArrastando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [uf, setUf] = useState("");
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
    <div className="upload-tela">
      <div className="stepper">
        <span className="step ativa"><span className="num">1</span> Upload do TXT</span>
        <span className="step-seta">→</span>
        <span className="step"><span className="num">2</span> Conferência</span>
        <span className="step-seta">→</span>
        <span className="step"><span className="num">3</span> Documentos</span>
      </div>
      <div className="upload-card">
        {onVoltar && <button className="fantasma" style={{ justifySelf: "start" }} onClick={onVoltar}>← Dashboard</button>}
        <h2>Serviço 1 — Georreferenciamento</h2>
        <p className="sub">Envie o TXT gerado pela máquina de topografia. O sistema detecta o fuso,
          converte as coordenadas e sugere os trechos de confrontantes pelos rótulos.</p>
        <label>
          UF do imóvel <span style={{ fontWeight: 400 }}>(opcional — ajuda a resolver o fuso UTM)</span><br />
          <select value={uf} onChange={(e) => setUf(e.target.value)} style={{ marginTop: 4, width: 120 }}>
            <option value="">—</option>
            {UFS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <div
          className={`dropzone ${arrastando ? "ativo" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastando(false);
            const f = e.dataTransfer.files[0];
            if (f) processar(f);
          }}
          onClick={() => inputRef.current?.click()}
        >
          {carregando ? (
            <>
              <span className="spinner" />
              <b>Processando o levantamento…</b>
              <span>validando pontos, detectando fuso e convertendo coordenadas</span>
            </>
          ) : (
            <>
              <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#0e7a4d" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <b>Arraste o TXT aqui</b>
              <span>ou clique para escolher o arquivo · formato: <code>ID;E;N;h;σpos;σh</code></span>
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
