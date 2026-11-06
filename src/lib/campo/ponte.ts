// A medição levada para as outras telas, sem baixar e reenviar arquivo.
//
// 1. Criar serviço de CAR com esta área:
//      transferirArea(areaDaMedicao(m)); ir({ t: "novo", chave: "car" })
//    (src/lib/area_transferida.ts — o CarNovo lê com pegarAreaTransferida()).
//
// 2. Consultar/analisar (#/consulta): o MESMO canal —
//      transferirArea(areaDaMedicao(m)); ir({ t: "consulta" })
//    A Consulta lê com pegarAreaTransferida() (lê e apaga) e, pela origem
//    "Medição de campo de …", marca a fonte "Medição de campo". Um canal só:
//    nada de uma segunda chave que a outra tela não conhece.
import type { AreaTransferida } from "../area_transferida.ts";
import { quando } from "./aparelho.ts";
import { medir, textoPrecisao } from "./geometria.ts";
import type { Medicao } from "./tipos.ts";

/** "Medição de campo de 06/11 14:32 · GPS do celular ±3,1 m" */
export function origemDaMedicao(m: Medicao, agora: Date = new Date()): string {
  const { precisaoMediaM } = medir(m.vertices);
  const gps = precisaoMediaM == null ? "desenhada à mão" : `GPS do celular ${textoPrecisao(precisaoMediaM)}`;
  return `Medição de campo de ${quando(m.criadaEm, agora)} · ${gps}`;
}

/** "hoje às 14:32", "ontem às 09:10", "em 02/11 às 15:42" */
export function quandoComAs(iso: string, agora: Date = new Date()): string {
  const q = quando(iso, agora);
  return q.replace(/^(hoje|ontem) (\d)/, "$1 às $2").replace(/^(\d\d\/\d\d(?:\/\d{4})?) (\d)/, "em $1 às $2");
}

/** "Área medida no campo hoje às 14:32 (GPS do celular, ±3,3 m)" — a frase do CAR novo. */
export function fraseDaMedicao(m: Medicao, agora: Date = new Date()): string {
  const { precisaoMediaM } = medir(m.vertices);
  return precisaoMediaM == null
    ? `Área desenhada à mão no Medir no campo ${quandoComAs(m.criadaEm, agora)}`
    : `Área medida no campo ${quandoComAs(m.criadaEm, agora)} (GPS do celular, ${textoPrecisao(precisaoMediaM)})`;
}

// "← Voltar para <medição>" do CAR novo: o Campo reabre ESTA medição. sessionStorage
// (some com a aba); lida sem apagar no render e apagada depois de montar (StrictMode).
const CHAVE_ABRIR = "vertces.campo.abrir";
export function pedirAbrirMedicao(id: string): void {
  try { sessionStorage.setItem(CHAVE_ABRIR, id); } catch { /* sem storage: o Campo abre como sempre */ }
}
export function medicaoPedida(): string | null {
  try { return sessionStorage.getItem(CHAVE_ABRIR); } catch { return null; }
}
export function esquecerMedicaoPedida(): void {
  try { sessionStorage.removeItem(CHAVE_ABRIR); } catch { /* sem storage */ }
}

/** A medição no formato que as telas de entrada aceitam. Os vértices vão como P1, P2… */
export function areaDaMedicao(m: Medicao, agora: Date = new Date()): AreaTransferida {
  return {
    nome: m.nome,
    perimetro: m.vertices.map((v) => [v.lon, v.lat]),
    nomes: m.vertices.map((_, i) => `P${i + 1}`),
    origem: origemDaMedicao(m, agora),
    // a área que o Campo mostrou: o CAR mostra a mesma (princípio 4)
    areaOrigemM2: medir(m.vertices).areaM2,
    partes: 1,
    frase: fraseDaMedicao(m, agora),
    volta: { rotulo: m.nome, hash: "#/campo", medicaoId: m.id },
  };
}
