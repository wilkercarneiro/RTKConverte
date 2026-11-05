// A geometria de qualquer serviço (GEO, loteamento, CAR) descrita do mesmo
// jeito, para que cada formato tenha UM gerador só. A montagem de cada
// modalidade (geo.ts, loteamento.ts, car.ts) produz camadas; os geradores
// (kml.ts, dxf.ts…) só leem camadas.

/** Par de coordenadas: (E, N) em UTM ou (lon, lat) em grau. */
export type XY = [number, number];

export type Valor = string | number | null;

export interface Feicao {
  nome: string;
  tipo: "poligono" | "linha" | "ponto";
  /**
   * UTM (E, N) no fuso informado à exportação. Polígono = anel SEM repetir o
   * 1º ponto. Basta um dos dois sistemas: o outro é convertido (SIRGAS 2000).
   */
  utm?: XY[];
  /** lon, lat em grau (o CAR guarda assim) */
  geo?: XY[];
  /** furos do polígono, no mesmo sistema da borda (o CAR tem: a produtiva em volta da reserva) */
  furosUtm?: XY[][];
  furosGeo?: XY[][];
  /** altitude de cada ponto (null = sem altitude) */
  alt?: (number | null)[];
  props?: Record<string, Valor>;
  /**
   * Confrontante de cada lado do polígono (lado i: ponto i → i+1), quando o
   * serviço tem. No DXF vira o texto da camada CONFRONTANTES.
   */
  confrontantes?: (string | null)[];
}

export interface Camada {
  nome: string;
  feicoes: Feicao[];
  /** cor "#RRGGBB" (KML e DXF) */
  cor?: string;
  /** DXF: azimute e distância no meio de cada lado dos polígonos (camada SEGMENTOS) */
  segmentos?: boolean;
  /**
   * DXF: o nome de cada feição na camada ROTULOS_<camada>, com esta altura
   * relativa (1 = a do nome do vértice). Ponto tem rótulo por padrão (1);
   * polígono e linha só quando pedido.
   */
  rotulos?: number;
}
