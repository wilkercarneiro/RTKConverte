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

export const OPCOES_PADRAO: OpcoesCampo = { passoM: 5, anguloGraus: 15, limitePrecisaoM: 8, segundosMarcar: 5 };

/** Os limites de cada ajuste (a tela e a leitura do aparelho usam os mesmos). */
export const LIMITES_OPCOES: Record<keyof OpcoesCampo, [number, number]> = {
  passoM: [1, 100],
  anguloGraus: [5, 90],
  limitePrecisaoM: [1, 50],
  segundosMarcar: [1, 60],
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
