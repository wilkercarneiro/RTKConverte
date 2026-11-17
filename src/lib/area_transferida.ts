// Área levada de uma ferramenta (Consultar imóvel, Medir no campo) ou de outro
// serviço (Exportar ▾ → "Usar a área em outro serviço") para um serviço novo,
// sem baixar e reenviar arquivo.
//
// Quem leva grava a área aqui e navega para #/novo/<modalidade>. A tela de
// entrada do serviço lê com `pegarAreaTransferida()` — que também apaga — e já
// começa com a área carregada, como se o operador tivesse enviado o arquivo:
//   • o CAR (CarNovo) usa o `perimetro` em lon/lat, como o de um KML;
//   • os serviços GEO (Upload) abrem o `arquivo` (o TXT do levantamento, com
//     altitude, σ e confrontantes) na conferência do TXT; sem `arquivo`, montam
//     um KML do `perimetro`.
//
// sessionStorage: some ao fechar a aba e não vaza para outra conta.

import type { VerticeLevado } from "./area_vertices";

export type LonLat = [number, number];

export interface AreaTransferida {
  /** nome sugerido para o serviço/imóvel */
  nome: string;
  /** anel externo aberto (sem repetir o primeiro ponto), lon/lat SIRGAS 2000 */
  perimetro: LonLat[];
  /** nome de cada vértice, quando houver (pontos medidos no campo: P1, P2…) */
  nomes?: (string | null)[];
  /** de onde veio, para o aviso da tela de entrada ("Área do CAR BA-…", "Medição de campo de 06/11") */
  origem: string;
  uf?: string | null;
  municipio?: string | null;
  /** a área que a tela de origem MOSTROU (todas as partes, motor único): o CarNovo
   *  confronta com o perímetro que chegou e diz o que ficou de fora */
  areaOrigemM2?: number;
  /** quantas partes a área tinha na origem (o CAR leva só a maior) */
  partes?: number;
  /** a frase que a tela de entrada mostra sobre a área ("Área medida no campo hoje às 14:32 (GPS do celular, ±3,3 m)") */
  frase?: string;
  /** o "← Voltar" da tela de entrada leva de volta à ferramenta de origem, não ao Início */
  volta?: VoltaDaArea;
  /** o arquivo de pontos da área (TXT do levantamento): o Upload o abre como se tivesse sido enviado */
  arquivo?: { nome: string; conteudo: string };
  /** fuso UTM das coordenadas do `arquivo` (o serviço novo nasce nele, sem perguntar) */
  fuso?: number | null;
  /** o que o TXT não carrega (confrontação completa dos M, método de cada vértice): reaplicado por coordenada depois de criar */
  vertices?: VerticeLevado[];
}

export interface VoltaDaArea {
  /** "a Consulta", "Pasto da sede" — o texto do "← Voltar para …" */
  rotulo: string;
  /** endereço da ferramenta (#/consulta?q=…, #/campo) */
  hash: string;
  /** a ferramenta só reabre a área se ela for mandada de novo (área de arquivo/desenho na Consulta) */
  reenviar?: boolean;
  /** a medição do Campo que reabre ao voltar */
  medicaoId?: string;
}

const CHAVE = "vertces.area-transferida";

export function transferirArea(a: AreaTransferida): void {
  try { sessionStorage.setItem(CHAVE, JSON.stringify(a)); } catch { /* sem storage: a tela de entrada abre vazia */ }
}

/** Lê e apaga (uma área só entra uma vez). */
export function pegarAreaTransferida(): AreaTransferida | null {
  try {
    const t = sessionStorage.getItem(CHAVE);
    if (!t) return null;
    sessionStorage.removeItem(CHAVE);
    const a = JSON.parse(t) as AreaTransferida;
    return Array.isArray(a?.perimetro) && a.perimetro.length >= 3 ? a : null;
  } catch {
    return null;
  }
}
