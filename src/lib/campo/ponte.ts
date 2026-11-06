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

/** A medição no formato que as telas de entrada aceitam. Os vértices vão como P1, P2… */
export function areaDaMedicao(m: Medicao, agora: Date = new Date()): AreaTransferida {
  return {
    nome: m.nome,
    perimetro: m.vertices.map((v) => [v.lon, v.lat]),
    nomes: m.vertices.map((_, i) => `P${i + 1}`),
    origem: origemDaMedicao(m, agora),
  };
}
