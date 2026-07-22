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

export function Upload({ onParsed }: { onParsed: (r: ResultadoParse) => void }) {
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
      <h2>Novo serviço</h2>
      <label>
        UF do imóvel (ajuda a detectar o fuso UTM):{" "}
        <select value={uf} onChange={(e) => setUf(e.target.value)}>
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
        {carregando ? "Processando..." : "Arraste o TXT da máquina de topografia aqui (ou clique para escolher)"}
        <input ref={inputRef} type="file" accept=".txt" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) processar(f); }} />
      </div>
      {erro && <div className="erro">{erro}</div>}
    </div>
  );
}
