export interface Servico {
  id: string;
  status: "rascunho" | "gerado";
  nome_arquivo_txt: string | null;
  fuso_utm: number | null;
  credenciado_id: string | null;
  rt_id: string | null;
  natureza_servico: string | null;
  tipo_pessoa: string | null;
  detentor_nome: string | null;
  detentor_cpf: string | null;
  denominacao: string | null;
  situacao: string | null;
  natureza_area: string | null;
  codigo_sncr: string | null;
  cns: string | null;
  matricula: string | null;
  municipio: string | null;
  uf: string | null;
  vertice_inicial: number | null;
  parcela_numero: string | null;
  lado: string | null;
  denominacao_parcela: string | null;
}

export interface Vertice {
  id?: string;
  servico_id: string;
  ordem: number;
  num_txt: number | null;
  rotulo_txt: string | null;
  e: number | null;
  n: number | null;
  h: number;
  sigma_pos: number;
  sigma_h: number;
  tipo: "M" | "P" | "V";
  codigo: string | null;
  metodo: string;
  inserido_manual: boolean;
  lat_gms: string;
  lon_gms: string;
}

export interface Trecho {
  id?: string;
  servico_id: string;
  vertice_inicio_ordem: number;
  apelido_txt: string | null;
  descritivo: string;
  tipo_limite: string;
  cns: string | null;
  matricula: string | null;
}

export interface Credenciado {
  id: string;
  nome: string;
  prefixo_vertice: string;
  contador_m: number;
  contador_p: number;
  contador_v: number;
}

export interface RT {
  id: string;
  nome: string;
  crea: string | null;
  trt: string | null;
  cpf: string | null;
}

export interface PreviewParse {
  fuso: number;
  epsg: number;
  candidatos: number[];
  fusoAmbiguo: boolean;
  foraDaUf: boolean;
  areaHa: number;
  perimetroM: number;
  qtdM: number;
  qtdP: number;
  qtdV: number;
}
