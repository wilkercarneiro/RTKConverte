// Medir no campo (#/campo): os tipos que a tela, o laboratório, os testes e a
// gravação (aparelho e conta) compartilham.
//
// Plano: docs/plano-ferramentas-campo-consulta-terraplanagem.md, seção 2.
// Coordenadas sempre em lon/lat SIRGAS 2000 (≈ WGS84 do GPS na escala do
// celular). Área e perímetro saem em UTM pelo motor único (geometria.ts).

export type LonLat = [number, number];

/** Uma posição do GPS, como chega do aparelho (ou do simulador do laboratório). */
export interface Leitura {
  lon: number;
  lat: number;
  /** raio de precisão informado pelo aparelho, em metros (null = não informado) */
  precisao: number | null;
  /** altitude elipsoidal (o GPS do celular é ruim nela; só vai para o GPX) */
  alt?: number | null;
  /** quando foi lida (ms desde 1970) */
  t: number;
  /** a hora da posição segundo o próprio GPS (coords.timestamp / hora da GGA): reconhece a mesma posição repetida */
  tGps?: number | null;
  /** de onde veio: o GPS do celular (geolocalização do navegador) ou um receptor externo (NMEA) */
  fonte?: FonteLeitura;
  /** tipo de solução do receptor (só a fonte "receptor" sabe; o celular não diz) */
  fix?: TipoFix | null;
  /** satélites usados (receptor) */
  sats?: number | null;
  /** HDOP (receptor) */
  hdop?: number | null;
  /** idade da correção diferencial, em segundos (receptor com RTK/DGPS) */
  idadeCorrecaoS?: number | null;
}

export type FonteLeitura = "celular" | "receptor";

/** GGA: 4 = RTK fixo, 5 = RTK flutuante, 2 = DGPS/SBAS, 1 = autônomo, 0 = sem posição. */
export type TipoFix = "rtk-fixo" | "rtk-flutuante" | "dgps" | "autonomo" | "sem-fix";

/** Deslocamento aplicado por calibração num ponto conhecido (metros em UTM, leste/norte). */
export interface CorrecaoAplicada {
  dE: number;
  dN: number;
}

/** Uma calibração: o GPS ocupou um ponto de coordenada conhecida (marco SIGEF, IBGE ou digitado). */
export interface Calibracao {
  id: string;
  /** "SIGEF BA-1234… vértice 7", "Marco digitado" */
  rotulo: string;
  /** a coordenada verdadeira do marco */
  conhecido: { lon: number; lat: number };
  /** o que o GPS mediu sobre ele (média da ocupação, SEM correção) */
  medido: { lon: number; lat: number; precisao: number | null; leituras: number };
  /** deslocamento verdadeiro − medido, em metros (UTM do lugar) */
  dE: number;
  dN: number;
  /** quando a ocupação terminou (ms) */
  t: number;
}

/** Como o vértice entrou: andando, parado juntando leituras ou tocando no mapa. */
export type ModoVertice = "caminhar" | "ponto" | "mao";

export interface VerticeCampo {
  lon: number;
  lat: number;
  /** precisão do vértice em metros; null = desenhado à mão */
  precisao: number | null;
  t: number;
  modo: ModoVertice;
  /** quantas leituras formaram o ponto (Marcar ponto aqui) */
  leituras?: number;
  alt?: number | null;
  /** fonte e tipo de solução de quando foi medido */
  fonte?: FonteLeitura;
  fix?: TipoFix | null;
  /** a posição como o GPS deu, antes da calibração (lon/lat ficam com a corrigida) */
  bruto?: { lon: number; lat: number };
  /** o deslocamento da calibração aplicado neste vértice */
  correcao?: CorrecaoAplicada;
  /** canto recolocado pelo ajuste de retas (a posição antes fica em `bruto`) */
  ajustado?: boolean;
}

export interface Medicao {
  /** gerado no aparelho (uuid): a mesma medição no celular e na conta */
  id: string;
  nome: string;
  /** ISO 8601 */
  criadaEm: string;
  atualizadaEm: string;
  vertices: VerticeCampo[];
  /** "Fechar a área": o contorno está pronto para virar serviço ou arquivo */
  fechada: boolean;
  /** calibrações em pontos conhecidos (a correção de cada vértice sai delas, interpolada no tempo) */
  calibracoes?: Calibracao[];
}

/** Ajustes do medidor (Ajustes ⚙ na tela; ficam no aparelho). */
export interface OpcoesCampo {
  /** Caminhar: um vértice a cada N metros */
  passoM: number;
  /** Caminhar: ou quando a direção muda mais que isso */
  anguloGraus: number;
  /** precisão máxima aceita sem perguntar (Marcar ponto) e para andar (Caminhar) */
  limitePrecisaoM: number;
  /** Marcar ponto: quanto tempo junta leituras */
  segundosMarcar: number;
}

// Marcar ponto: 20 s (eram 5). O erro do GPS do celular muda devagar — o reflexo
// leva centenas de segundos para mudar — e 5 s de média valiam quase uma leitura só.
export const OPCOES_PADRAO: OpcoesCampo = { passoM: 5, anguloGraus: 15, limitePrecisaoM: 8, segundosMarcar: 20 };

/** Os limites de cada ajuste (a tela e a leitura do aparelho usam os mesmos). */
export const LIMITES_OPCOES: Record<keyof OpcoesCampo, [number, number]> = {
  passoM: [1, 100],
  anguloGraus: [5, 90],
  limitePrecisaoM: [1, 50],
  segundosMarcar: [1, 300],
};

/** Ajustes lidos de qualquer lugar (aparelho, URL) voltam válidos: o que não serve vira o padrão. */
export function opcoesValidas(v: unknown): OpcoesCampo {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof OpcoesCampo, unknown>>;
  const saida = { ...OPCOES_PADRAO };
  for (const k of Object.keys(OPCOES_PADRAO) as (keyof OpcoesCampo)[]) {
    const n = Number(o[k]);
    const [min, max] = LIMITES_OPCOES[k];
    if (o[k] != null && o[k] !== "" && Number.isFinite(n)) saida[k] = Math.min(max, Math.max(min, n));
  }
  return saida;
}

/** O valor digitado conferido com os limites: o número que vale e, se mudou, por quê. */
export function conferirAjuste(k: keyof OpcoesCampo, texto: string, atual: number): { valor: number; nota: string | null } {
  const [min, max] = LIMITES_OPCOES[k];
  const bruto = texto.trim().replace(",", ".");
  const n = Number(bruto);
  if (!bruto || !Number.isFinite(n)) return { valor: atual, nota: `Use um número de ${min} a ${max}: ficou ${atual}.` };
  if (n < min) return { valor: min, nota: `O mínimo é ${min}: ficou ${min}.` };
  if (n > max) return { valor: max, nota: `O máximo é ${max}: ficou ${max}.` };
  return { valor: n, nota: null };
}
