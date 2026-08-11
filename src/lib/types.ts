export interface Cliente {
  id: string;
  created_at?: string;
  nome: string;
  cpf_cnpj: string | null;
  genero: "M" | "F";
  endereco: string | null;
  telefone: string | null;
  email: string | null;
  observacoes: string | null;
  is_espolio?: boolean | null;
  inventariante_nome?: string | null;
  inventariante_cpf?: string | null;
  inventariante_rg?: string | null;
}

export interface DocumentoGerado {
  id: string;
  servico_id: string;
  versao: number;
  tipo: string;
  titulo: string;
  path: string;
  created_at: string;
}

/**
 * O que o cliente contratou. Eixo INDEPENDENTE de `Servico.tipo`, que diz de
 * onde vêm os dados (TXT do levantamento × PDF do SIGEF).
 *
 *   completo    — memorial + planilha + planta → SIGEF → planta oficial + peças
 *   conferencia — prévia de área: memorial (códigos provisórios), tabular e
 *                 planta opcionais, sem SIGEF e sem peças
 */
export type Modalidade = "completo" | "conferencia";

/** Folha da planta. `undefined` mantém a regra histórica: posse → A3, resto → A1. */
export type Folha = "A1" | "A3" | "A4";

/**
 * Sub-polígono desenhado DENTRO do perímetro, na mesma planta.
 * `anel` em coordenadas UTM do fuso do serviço: [[E, N], ...].
 */
export interface Gleba {
  id?: string;
  servico_id: string;
  ordem: number;
  nome: string;
  anel: [number, number][];
}

export interface Servico {
  id: string;
  created_at?: string;
  tipo: "geo" | "pecas";
  /** O que foi contratado. Serviços antigos são 'completo' pelo default da coluna. */
  modalidade: Modalidade;
  /** Serviço com glebas: liga o editor e o desenho dos sub-polígonos. */
  tem_glebas: boolean;
  /**
   * Folha da planta da conferência (o operador escolhe). Nulo = A4.
   * Não se aplica ao serviço completo, que segue posse → A3 / matrícula → A1.
   */
  folha_conferencia: Folha | null;
  /**
   * Campos que a planta da CONFERÊNCIA pode omitir — a prévia acontece antes de
   * o imóvel ter documento, nome ou TRT. Não têm efeito fora da conferência.
   */
  conf_exibir_matricula: boolean;
  conf_exibir_denominacao: boolean;
  conf_exibir_trt: boolean;
  cliente_id?: string | null;
  status: "rascunho" | "gerado";
  nome_arquivo_txt: string | null;
  fuso_utm: number | null;
  credenciado_id: string | null;
  rt_id: string | null;
  trt: string | null;
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
  // peças técnicas
  tipo_imovel: "matricula" | "posse" | null;
  detentor_rg: string | null;
  detentor_genero: "M" | "F" | null;
  requerente2_nome: string | null;
  requerente2_cpf: string | null;
  requerente2_genero: "M" | "F" | null;
  endereco_detentor: string | null;
  area_matricula_ha: string | null;
  // obsoleto: as faixas de domínio saem dos trechos da planta (uma declaração
  // por via). A coluna continua no banco só por causa dos serviços antigos.
  via_dominio: string | null;
  is_espolio?: boolean | null;
  inventariante_nome?: string | null;
  inventariante_cpf?: string | null;
  inventariante_rg?: string | null;
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
  /**
   * Código exibido na prévia da conferência: tem o prefixo do credenciado, mas
   * não foi alocado nos contadores. É refeito ao promover o serviço a completo.
   */
  codigo_provisorio?: boolean;
  metodo: string;
  inserido_manual: boolean;
  lat_gms: string;
  lon_gms: string;
  // Confrontação: preenchida SÓ quando tipo === "M". O trecho vai deste M até o
  // próximo M do perímetro. Ver ARQUITETURA-TRECHOS.md.
  descritivo: string | null;
  tipo_limite: string | null;
  eh_via: boolean;
  cns: string | null;
  matricula: string | null;
  apelido_txt: string | null;
}

/**
 * Trechos do fluxo `pecas` (peças a partir do PDF do SIGEF), ancorados por
 * `codigo_inicio` — o código do vértice no SIGEF, estável por construção.
 * O fluxo `geo` NÃO usa esta tabela: lá a confrontação vive no vértice M.
 * Ver ARQUITETURA-TRECHOS.md.
 */
export interface Trecho {
  id?: string;
  servico_id: string;
  vertice_inicio_ordem: number;
  codigo_inicio?: string | null;
  apelido_txt: string | null;
  descritivo: string;
  tipo_limite: string;
  eh_via: boolean;
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
  formacao: string | null;
  conselho_sigla: string | null;
  conselho_numero: string | null;
  identidade: string | null;
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
