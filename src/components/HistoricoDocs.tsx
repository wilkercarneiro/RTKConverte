// Histórico de documentos gerados de um serviço: cada geração é uma versão
// preservada — o download assina a URL na hora (funciona a qualquer momento).
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { DocumentoGerado } from "../lib/types";
import { Icone, ICONE } from "./Icone";

export function HistoricoDocs({ servicoId, compacto }: { servicoId: string; compacto?: boolean }) {
  const [docs, setDocs] = useState<DocumentoGerado[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("documentos_gerados").select().eq("servico_id", servicoId)
      .order("versao", { ascending: false }).order("tipo")
      .then(({ data }) => setDocs((data as DocumentoGerado[]) ?? []));
  }, [servicoId]);

  async function baixar(d: DocumentoGerado) {
    const ext = d.path.split(".").pop();
    const { data, error } = await supabase.storage.from("gerados")
      .createSignedUrl(d.path, 600, { download: `${d.titulo} (v${d.versao}).${ext}` });
    if (error || !data?.signedUrl) { setErro("Não foi possível assinar o download: " + (error?.message ?? "")); return; }
    setErro(null);
    window.open(data.signedUrl, "_blank");
  }

  if (docs.length === 0) {
    return compacto ? null : <p className="sub" style={{ margin: 0 }}>Nenhum documento gerado ainda.</p>;
  }

  const versoes = [...new Set(docs.map((d) => d.versao))];
  const dataFmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }).replace(",", " ·");

  return (
    <div className="historico">
      {versoes.map((v) => {
        const dv = docs.filter((d) => d.versao === v);
        return (
          <div className="historico-versao" key={v}>
            <div className="historico-cab">
              <span className="chip">v{v}</span>
              <span style={{ color: "var(--texto-2)", fontSize: 13 }}>{dataFmt(dv[0].created_at)}</span>
            </div>
            <div className="historico-itens">
              {dv.map((d) => (
                <button key={d.id} className="historico-doc" onClick={() => baixar(d)} title="Baixar">
                  <Icone d={ICONE.download} size={13} traco={2.2} /> {d.titulo}
                </button>
              ))}
            </div>
          </div>
        );
      })}
      {erro && <div className="erro">{erro}</div>}
    </div>
  );
}
