// Vários arquivos num ZIP só, montado no navegador (JSZip) — "Baixar tudo" dos
// documentos do serviço: um clique em vez de um por arquivo (pedido do Wilker
// de 05/11/2026: menos cliques). As URLs são as assinadas do bucket "gerados"
// (valem 1 hora): vencida, o arquivo falha e a mensagem manda gerar de novo.
import { baixarBlob } from "./entregas";

export interface ArquivoZip {
  /** nome do arquivo dentro do ZIP (com a extensão) */
  nome: string;
  url: string;
  /** subpasta dentro do ZIP (ex.: "Plantas A3") */
  pasta?: string;
}

/** Tira o que o Windows não aceita em nome de arquivo. */
export const nomeSeguro = (s: string): string => s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim();

/** Baixa os arquivos, monta o ZIP e entrega ao navegador. Devolve quantos entraram. */
export async function baixarZip(arquivos: ArquivoZip[], nomeZip: string): Promise<number> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  let n = 0;
  for (const a of arquivos) {
    if (!a.url) continue;
    const r = await fetch(a.url);
    if (!r.ok) throw new Error(`${a.nome} não baixou (${r.status}). Gere os documentos de novo para renovar os links.`);
    (a.pasta ? zip.folder(nomeSeguro(a.pasta))! : zip).file(nomeSeguro(a.nome), await r.blob());
    n++;
  }
  if (!n) throw new Error("Nenhum arquivo para baixar: gere os documentos primeiro.");
  baixarBlob(await zip.generateAsync({ type: "blob" }), `${nomeSeguro(nomeZip)}.zip`);
  return n;
}
