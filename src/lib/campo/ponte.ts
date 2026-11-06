// A medição levada para as outras telas, sem baixar e reenviar arquivo.
//
// 1. Criar serviço de CAR com esta área:
//      transferirArea(areaDaMedicao(m)); ir({ t: "novo", chave: "car" })
//    (src/lib/area_transferida.ts — o CarNovo lê com pegarAreaTransferida()).
//
// 2. Consultar/analisar (#/consulta) — CONTRATO com a frente Consulta:
//      quem manda:  areaParaConsulta(areaDaMedicao(m)); ir({ t: "consulta" })
//      quem recebe: const a = pegarAreaParaConsulta();   // lê E apaga
//                   if (a) { …já abre com o perímetro a.perimetro selecionado… }
//    O formato é o mesmo AreaTransferida (nome, perimetro lon/lat SIRGAS 2000
//    aberto — sem repetir o 1º ponto —, nomes dos vértices, origem para o
//    aviso "Área da Medição de campo de 06/11 14:32"). Mora no sessionStorage
//    na chave CHAVE_AREA_CONSULTA: some ao fechar a aba e não vaza para outra
//    conta. Uma área entra uma vez só (a leitura apaga).
import type { AreaTransferida } from "../area_transferida.ts";
import { quando } from "./aparelho.ts";
import { medir, textoPrecisao } from "./geometria.ts";
import type { Medicao } from "./tipos.ts";

export const CHAVE_AREA_CONSULTA = "vertces.area-consulta";

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

function sessao(): Storage | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

/** Grava a área para a Consultar imóvel abrir com ela. false = sem storage (a consulta abre vazia). */
export function areaParaConsulta(a: AreaTransferida): boolean {
  const s = sessao();
  if (!s) return false;
  try { s.setItem(CHAVE_AREA_CONSULTA, JSON.stringify(a)); return true; } catch { return false; }
}

/** Lê e apaga a área deixada para a Consulta (null = nenhuma, ou estragada). */
export function pegarAreaParaConsulta(): AreaTransferida | null {
  const s = sessao();
  if (!s) return null;
  try {
    const t = s.getItem(CHAVE_AREA_CONSULTA);
    if (!t) return null;
    s.removeItem(CHAVE_AREA_CONSULTA);
    const a = JSON.parse(t) as AreaTransferida;
    const ok = Array.isArray(a?.perimetro) && a.perimetro.length >= 3
      && a.perimetro.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
    return ok ? a : null;
  } catch {
    return null;
  }
}
