// Recursos do sistema que um plano libera ou esconde — o catálogo, em UM lugar.
//
// Esta lista é a FONTE. O painel do superadmin manda ela ao banco toda vez que
// abre (sa_sincronizar_recursos), então recurso novo aparece sozinho lá para ser
// ligado ou desligado em cada plano. Até alguém decidir, vale o `padrao`.
//
// Como acrescentar um recurso novo:
//   - modalidade de serviço: basta a entrada em SERVICOS (modalidades.ts) — ela
//     vira `servico.<chave>` aqui sem mais nada;
//   - qualquer outra coisa: uma entrada em EXTRAS e `temRecurso(<chave>)` no
//     ponto da tela que mostra o recurso. A chave é tipada: usar uma que não
//     está aqui não compila (e o tests/recursos.test.mjs confere).
import { SERVICOS } from "./modalidades.ts";
import type { ChaveServico } from "./modalidades";

export interface Recurso {
  chave: string;
  nome: string;
  grupo: string;
  descricao: string;
  /** liberado para quem o plano ainda não decidiu */
  padrao: boolean;
  ordem: number;
}

const EXTRAS = [
  {
    chave: "planta.editor",
    nome: "Editor de planta",
    grupo: "Planta e documentos",
    descricao: "Editar a planta antes de baixar: mover, texto, cor, apagar, acrescentar linha e caixa.",
    padrao: true,
  },
  {
    chave: "loteamento.maquete3d",
    nome: "Maquete 3D do loteamento",
    grupo: "Loteamento",
    descricao: "Terreno com satélite, casas, sol e sombras, voo de drone, vídeo de apresentação e GLB.",
    padrao: true,
  },
  {
    chave: "sigef.mapa",
    nome: "Mapa de parcelas do SIGEF",
    grupo: "SIGEF",
    descricao: "Mostra os imóveis certificados vizinhos ao enviar o TXT.",
    padrao: true,
  },
  {
    chave: "sigef.sobreposicao",
    nome: "Correção de sobreposição",
    grupo: "SIGEF",
    descricao: "Usa os vértices certificados do vizinho para tirar a sobreposição.",
    padrao: true,
  },
  {
    chave: "empresa.equipe",
    nome: "Equipe",
    grupo: "Empresa",
    descricao: "O dono adiciona e remove operadores do escritório.",
    padrao: true,
  },
] as const;

export type ChaveRecurso = `servico.${ChaveServico}` | (typeof EXTRAS)[number]["chave"];

export const RECURSOS: Recurso[] = [
  ...SERVICOS.map((s, i) => ({
    chave: `servico.${s.chave}`,
    nome: s.titulo,
    grupo: "Serviços",
    descricao: s.resumo,
    padrao: true,
    ordem: (i + 1) * 10,
  })),
  ...EXTRAS.map((e, i) => ({ ...e, ordem: 1000 + (i + 1) * 10 })),
];

const POR_CHAVE = new Map(RECURSOS.map((r) => [r.chave, r]));
export const recursoDe = (chave: string): Recurso | undefined => POR_CHAVE.get(chave);

// ---------------------------------------------------------------------------
// O que a empresa logada tem liberado
// ---------------------------------------------------------------------------
//
// Guardado no módulo (não num contexto do React) porque parte das telas abre
// por chamada imperativa (abrirPlanta, a maquete) e precisa perguntar também.
// O App carrega antes de desenhar qualquer tela, então nunca se lê vazio.

let liberados: Record<string, boolean> | null = null; // null = banco sem planos: tudo liberado

export function definirRecursos(mapa: Record<string, boolean> | null): void {
  liberados = mapa;
}

export function temRecurso(chave: ChaveRecurso): boolean {
  if (!liberados) return true;
  // recurso que o código já tem e o banco ainda não sincronizou: vale o padrão
  return liberados[chave] ?? recursoDe(chave)?.padrao ?? true;
}

export const servicoLiberado = (chave: ChaveServico): boolean => temRecurso(`servico.${chave}`);
