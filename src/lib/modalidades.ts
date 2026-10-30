// As modalidades de serviço, em UM lugar só.
//
// A tela mostra três (mais uma entrada secundária), mas no banco isso são DUAS
// colunas ortogonais — `modalidade` e `tem_glebas` — e a coluna `tipo`, que é
// outro eixo ainda: de onde vêm os dados. "Serviço com gleba" não é um quarto
// caminho, é o serviço completo com glebas ligadas.
//
// Concentrar o mapeamento aqui é o que impede a tela de virar a autoridade sobre
// o modelo. Antes, cada ponto de entrada novo tinha de ser plugado no Dashboard
// E na página do cliente; agora os dois iteram esta lista.
import type { Modalidade, Servico } from "./types";

/** Chave do cartão na tela — não é coluna do banco. */
export type ChaveServico = "completo" | "conferencia" | "gleba" | "divisao" | "loteamento" | "car" | "pecas";

export interface DefinicaoServico {
  chave: ChaveServico;
  titulo: string;
  /** path SVG (viewBox 24×24, traço 1.8px) — desenhado por <Icone d={…} /> */
  icone: string;
  resumo: string;
  /** O que o operador precisa ter em mãos. */
  requisitos: string[];
  /** O que sai no fim. */
  entrega: string[];
  cta: string;
  /** Colunas gravadas ao criar. `tipo` decide qual pipeline abre. */
  campos: { tipo: "geo" | "pecas"; modalidade: Modalidade; tem_glebas: boolean; divisao?: boolean };
  /** A entrada é o KML (CAR), não o TXT: abre a tela própria em vez do Upload. */
  entradaKml?: boolean;
  /** Cartão principal (topo) ou entrada secundária. */
  principal: boolean;
}

export const SERVICOS: DefinicaoServico[] = [
  {
    chave: "completo",
    titulo: "Serviço completo",
    icone: "M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
    resumo: "Do levantamento à certificação: memorial, planilha e planta, envio ao SIGEF e as peças técnicas.",
    requisitos: ["TXT do levantamento", "documentos do proprietário", "confrontantes", "imagem de satélite"],
    entrega: ["Memorial Descritivo", "Planilha SIGEF", "Planta A1/A3", "Planta oficial do SIGEF", "7 peças técnicas"],
    cta: "Enviar TXT",
    campos: { tipo: "geo", modalidade: "completo", tem_glebas: false },
    principal: true,
  },
  {
    chave: "conferencia",
    titulo: "Conferência de área",
    icone: "M3 21 21 3M3 21h6M3 21v-6M14 4l6 6",
    resumo: "Prévia de área e perímetro, sem passar pelo SIGEF. Os pontos saem numerados P-1, P-2…, sem consumir a numeração oficial do credenciado.",
    requisitos: ["TXT do levantamento", "documentos do proprietário", "confrontantes", "imagem de satélite"],
    entrega: ["Memorial Descritivo timbrado", "Memorial Tabular (opcional)", "Planta A3 (ou A4)"],
    cta: "Enviar TXT",
    campos: { tipo: "geo", modalidade: "conferencia", tem_glebas: false },
    principal: true,
  },
  {
    chave: "gleba",
    titulo: "Serviço com gleba",
    icone: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
    resumo: "O serviço completo com as glebas desenhadas dentro do perímetro. As divisões são montadas na tela antes de gerar a planta.",
    requisitos: ["TXT do levantamento", "documentos do proprietário", "confrontantes", "imagem de satélite"],
    entrega: ["Tudo do serviço completo", "Planta com as glebas e suas áreas"],
    cta: "Enviar TXT",
    campos: { tipo: "geo", modalidade: "completo", tem_glebas: true },
    principal: true,
  },
  {
    chave: "divisao",
    titulo: "Divisão em partes iguais",
    icone: "M3 3h18v18H3zM9 3l-2 18M16 3l-2 18",
    resumo: "Partilha ou herança: o motor divide o imóvel em partes de mesma área (ou na fração de cada herdeiro), com divisas retas e frente para a estrada.",
    requisitos: ["TXT do levantamento", "documentos do proprietário", "nome e CPF de cada herdeiro"],
    entrega: ["GEO do imóvel inteiro com todas as partes", "Planta de cada parte", "Um GEO completo por herdeiro"],
    cta: "Enviar TXT",
    // partilha: o serviço nasce com `servicos.divisao` (o motor de divisão em partes iguais)
    campos: { tipo: "geo", modalidade: "completo", tem_glebas: true, divisao: true },
    principal: true,
  },
  {
    chave: "loteamento",
    titulo: "Loteamento",
    icone: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v6M15 9v6M9 15v6",
    resumo: "Divide a gleba em quadras, lotes, ruas e áreas públicas a partir do perímetro levantado. Ajuste na tela; o resto se recalcula.",
    requisitos: ["TXT do perímetro da gleba", "regras do município (lote mínimo, rua, áreas públicas)"],
    entrega: ["Planta do loteamento", "Arquivo de locação para a coletora", "Memoriais dos lotes", "DXF e KML"],
    cta: "Enviar TXT",
    campos: { tipo: "geo", modalidade: "loteamento", tem_glebas: false },
    principal: true,
  },
  {
    chave: "car",
    titulo: "CAR",
    icone: "M12 22c4-3 7-7 7-11a7 7 0 0 0-14 0c0 4 3 8 7 11zM12 8v8M9 11l3 3 3-3",
    resumo: "Cadastro Ambiental Rural: a partir do KML ou do GPX da área total, marque a reserva legal, a vegetação nativa cedida a outro imóvel e trace os rios da APP. A área produtiva sai do que sobra.",
    requisitos: ["KML ou GPX da área total do imóvel", "porcentagem da reserva legal", "rios do imóvel e a faixa de APP"],
    entrega: ["Shapefile da área total", "Shapefile da reserva legal", "Shapefile da vegetação nativa e KML dela", "Shapefile da área produtiva", "Shapefile da APP"],
    cta: "Enviar KML ou GPX",
    campos: { tipo: "geo", modalidade: "car", tem_glebas: false },
    entradaKml: true,
    principal: true,
  },
  {
    chave: "pecas",
    titulo: "Peças a partir do PDF do SIGEF",
    icone: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
    resumo: "Para quando o imóvel já foi certificado e só faltam as peças. Não precisa do TXT.",
    requisitos: ["PDF de prévia do SIGEF", "documentos do proprietário"],
    entrega: ["7 peças técnicas"],
    cta: "Enviar PDF",
    campos: { tipo: "pecas", modalidade: "completo", tem_glebas: false },
    principal: false,
  },
];

export const definicaoDe = (chave: ChaveServico): DefinicaoServico =>
  SERVICOS.find((s) => s.chave === chave) ?? SERVICOS[0];

/**
 * Qual cartão um serviço gravado representa. É a leitura inversa de `campos`:
 * a tela precisa disso para o chip da lista e para o cabeçalho da conferência.
 */
export function chaveDoServico(s: Pick<Servico, "tipo" | "modalidade" | "tem_glebas">): ChaveServico {
  if (s.tipo === "pecas") return "pecas";
  if (s.modalidade === "conferencia") return "conferencia";
  if (s.modalidade === "loteamento") return "loteamento";
  if (s.modalidade === "car") return "car";
  if ((s as { divisao?: unknown }).divisao) return "divisao";
  return s.tem_glebas ? "gleba" : "completo";
}

/** Rótulo curto para chips de lista. */
export const rotuloCurto: Record<ChaveServico, string> = {
  completo: "Completo",
  conferencia: "Conferência",
  gleba: "Gleba",
  divisao: "Divisão",
  loteamento: "Loteamento",
  car: "CAR",
  pecas: "Peças",
};

/**
 * A conferência para no memorial: não envia ao SIGEF nem gera as 7 peças.
 * Uma função só, usada pela trilha de etapas e pelos blocos da tela, para que
 * não exista uma segunda definição de "até onde vai a conferência".
 */
export const vaiAoSigef = (s: Pick<Servico, "modalidade">): boolean => s.modalidade === "completo";

// ---------------------------------------------------------------------------
// Situação do imóvel na CONFERÊNCIA: matrícula, posse ou ainda sem documento
// ---------------------------------------------------------------------------
//
// Outro mapeamento tela ↔ colunas, e pelo mesmo motivo do resto deste arquivo:
// a pergunta é UMA ("o imóvel tem matrícula, é posse, ou ainda não tem nada?"),
// mas no banco são duas colunas — `tipo_imovel` diz o quê, `conf_exibir_matricula`
// diz se a planta imprime. Espalhar essa tradução pela tela é o caminho para a
// planta sair com "(MATR./CNS.)" em imóvel de posse.
//
// São três estados, não dois: a prévia costuma acontecer antes de o imóvel ter
// documento, e "Matrícula do Imóvel:" em branco na planta parece dado perdido.

export type SituacaoImovel = "matricula" | "posse" | "nao_informar";

/** Qual das três o serviço representa hoje. Matrícula é o padrão: é o que a
 *  planta já assumia com `tipo_imovel` nulo. */
export function situacaoDoImovel(
  s: Pick<Servico, "tipo_imovel" | "conf_exibir_matricula">,
): SituacaoImovel {
  if (s.conf_exibir_matricula === false) return "nao_informar";
  return s.tipo_imovel === "posse" ? "posse" : "matricula";
}

/** As colunas que a escolha grava. `matricula` e `cns` NÃO são apagados aqui:
 *  trocar por engano e voltar não pode custar a redigitação de dois campos. */
export function camposDaSituacao(v: SituacaoImovel): Pick<Servico, "tipo_imovel" | "conf_exibir_matricula"> {
  return {
    tipo_imovel: v === "posse" ? "posse" : "matricula",
    conf_exibir_matricula: v !== "nao_informar",
  };
}

/** A situação pede matrícula e CNS? Só quem tem matrícula — pedir cartório a um
 *  posseiro é pedir um dado que não existe. */
export const pedeMatricula = (v: SituacaoImovel): boolean => v === "matricula";
