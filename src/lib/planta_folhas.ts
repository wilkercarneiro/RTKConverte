// Folhas além da 1ª numa planta editada.
//
// A cena (planta_cena.ts) guarda só a folha 1, que é a que o editor refaz.
import { PDFDocument } from "pdf-lib";

/**
 * A cena é só a folha 1. Planta com folhas seguintes (o quadro de lotes do
 * loteamento) não pode perdê-las ao ser editada: elas voltam, como estavam,
 * depois da folha refeita.
 */
export async function comFolhasSeguintes(editada: Uint8Array, anterior: Uint8Array | null): Promise<Uint8Array> {
  if (!anterior) return editada;
  const ant = await PDFDocument.load(anterior, { updateMetadata: false });
  if (ant.getPageCount() < 2) return editada;
  const nova = await PDFDocument.load(editada, { updateMetadata: false });
  const folhas = await nova.copyPages(ant, ant.getPageIndices().slice(1));
  for (const f of folhas) nova.addPage(f);
  return nova.save();
}

