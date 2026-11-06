// Tipos comuns da Consultar imóvel (src/lib/consulta).
import type { LonLat } from "../restricoes.ts";

export type { LonLat };

/** De onde veio a área: base pública (CAR declarado, SIGEF certificado) ou do próprio usuário. */
export type FonteImovel = "car" | "sigef" | "arquivo" | "desenho" | "campo";

export interface ImovelEncontrado {
  /** "car:BA-…", "sigef:<uuid>", "arquivo:<nome>", "desenho" */
  id: string;
  fonte: FonteImovel;
  titulo: string;
  codigo: string | null;
  /** contornos externos, lon/lat, sem repetir o 1º ponto (um por parte) */
  aneis: LonLat[][];
  /** a geometria como veio ([externo, ...furos] por parte) — para "o ponto está dentro?" */
  poligonos: LonLat[][][];
  /** furos que a área de trabalho ignora (o serviço e a análise usam o contorno externo) */
  furos: number;
  /** a área que a base informa (CAR: declarada; SIGEF: a certificada), ha */
  areaDeclaradaHa: number | null;
  municipio: string | null;
  uf: string | null;
  codMunicipio?: string | null;
  /** AAAA-MM-DD */
  atualizacao: string | null;
  /** "Ativo · Aguardando análise" / "Certificada" */
  situacao: string | null;
  detalhes: string[];
  /** nome de cada vértice, quando a área veio de arquivo de pontos */
  nomes?: (string | null)[];
  car?: { status: string; statusRotulo: string; condicao: string | null; tipo: string; tipoRotulo: string | null; modulosFiscais: number | null };
}

/** Resposta de uma fonte: o que veio ou por que não veio. Nunca derruba as outras. */
export type Resposta<T> =
  | { estado: "carregando" }
  | { estado: "ok"; dados: T; nota?: string }
  | { estado: "falhou"; motivo: string };

export const carregando = <T>(): Resposta<T> => ({ estado: "carregando" });
export const ok = <T>(dados: T, nota?: string): Resposta<T> => ({ estado: "ok", dados, ...(nota ? { nota } : {}) });
export const falhou = <T>(motivo: string): Resposta<T> => ({ estado: "falhou", motivo });
