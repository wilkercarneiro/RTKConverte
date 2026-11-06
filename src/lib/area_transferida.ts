// Área levada de uma ferramenta (Consultar imóvel, Medir no campo) para um
// serviço novo, sem baixar e reenviar arquivo.
//
// A ferramenta grava a área aqui e navega para #/novo/car (ou outra
// modalidade que aceite área pronta). A tela de entrada do serviço lê com
// `pegarAreaTransferida()` — que também apaga — e já começa com o perímetro
// carregado, como se o operador tivesse enviado o KML.
//
// sessionStorage: some ao fechar a aba e não vaza para outra conta.

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
