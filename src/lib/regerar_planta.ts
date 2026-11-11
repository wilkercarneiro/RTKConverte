// Gerar de novo uma planta aberta no visualizador.
//
// Planta gerada antes do editor (27/10/2026) não traz a cena e não abre no
// editor; o aviso mandava "gerar de novo", mas o botão de gerar fica em outra
// etapa do serviço (e no rodapé vira "Resolver pendências"). Aqui a mesma
// planta é refeita direto do visualizador, pela função que a gerou da primeira
// vez — o tipo vem da linha dela em documentos_gerados:
//
//   planta_pdf          → gerar-planta (planta do SIGEF; precisa do PDF dele)
//   planta_pdf_sistema  → gerar-documentos (memorial + planilha + planta)
//   gleba_planta_pdf    → gerar-documentos, e abre a A3 da mesma gleba
//
// Gerar de novo não consome crédito (o crédito é do imóvel, 0039).
import { chamarFuncao, supabase } from "./supabase";
import { avisarHistoricoAtualizado, folhaDoTitulo, type ComoRegerar, type DocHistorico } from "./historico";
export { caminhoDaPlanta, comoRegerar, type ComoRegerar } from "./historico";

export interface PlantaDoHistorico extends DocHistorico {
  /** folha da planta do imóvel na mesma versão (para refazer a de uma gleba) */
  folhaDoImovel: "A1" | "A3" | null;
}

/** A linha do histórico desta planta (tipo, título, versão). */
export async function plantaDoHistorico(servicoId: string, path: string): Promise<PlantaDoHistorico | null> {
  const { data } = await supabase.from("documentos_gerados").select("versao, tipo, titulo, path")
    .eq("servico_id", servicoId).eq("path", path).limit(1);
  const doc = data?.[0] as DocHistorico | undefined;
  if (!doc) return null;
  let folhaDoImovel: "A1" | "A3" | null = null;
  if (doc.tipo === "gleba_planta_pdf") {
    const { data: irmas } = await supabase.from("documentos_gerados").select("titulo")
      .eq("servico_id", servicoId).eq("versao", doc.versao).eq("tipo", "planta_pdf_sistema").limit(1);
    folhaDoImovel = folhaDoTitulo((irmas?.[0]?.titulo as string | undefined) ?? "");
  }
  return { ...doc, folhaDoImovel };
}

function base64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

async function pdfDoSigef(servicoId: string): Promise<string | null> {
  const dl = await supabase.storage.from("gerados").download(`${servicoId}/entrada/sigef.pdf`);
  if (dl.error || !dl.data) return null;
  return base64(await dl.data.arrayBuffer());
}

/** Refaz a planta e devolve a URL assinada da nova (já editável). */
export async function regerarPlanta(servicoId: string, como: ComoRegerar, metragem: boolean): Promise<string> {
  const sigef = await pdfDoSigef(servicoId);
  let url: string | null | undefined;
  if (como.funcao === "gerar-planta") {
    if (!sigef) throw new Error("O PDF do SIGEF deste serviço não está guardado. Envie-o de novo na etapa do SIGEF e gere a planta por lá.");
    const r = await chamarFuncao<{ planta_pdf: string }>("gerar-planta", { servico_id: servicoId, pdf_base64: sigef, folha: como.folha, metragem });
    url = r.planta_pdf;
  } else {
    const r = await chamarFuncao<{ planta_pdf?: string | null; glebas?: { nome: string; planta_pdf: string | null }[] }>("gerar-documentos", {
      servico_id: servicoId, metragem,
      ...(como.folha ? { folha: como.folha } : {}),
      ...(sigef ? { pdf_base64: sigef } : {}),
    });
    url = como.gleba
      ? r.glebas?.find((g) => g.nome.trim().toUpperCase() === como.gleba!.toUpperCase())?.planta_pdf
      : r.planta_pdf;
    if (!url) throw new Error(como.gleba ? `Os documentos foram gerados de novo, mas a planta da ${como.gleba} não veio — abra-a pelo histórico.` : "Os documentos foram gerados de novo, mas sem a planta.");
  }
  avisarHistoricoAtualizado();
  return url;
}
