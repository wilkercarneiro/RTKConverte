// Permissões de quem trabalha numa empresa — o catálogo, em UM lugar.
//
// O banco tem a mesma lista (0025_equipe.sql: `v_validas` em definir_membro) e
// trava o que é administrativo ou destrutivo; a tela usa `temPermissao()` para
// não oferecer o que a pessoa não pode fazer. O dono tem todas.
export type ChavePermissao =
  | "servicos.criar" | "servicos.excluir" | "clientes.editar" | "clientes.excluir"
  | "documentos.gerar" | "cadastros.editar" | "empresa.configurar" | "equipe.gerenciar";

export interface Permissao { chave: ChavePermissao; nome: string; descricao: string; grupo: string }

export const PERMISSOES: Permissao[] = [
  { chave: "servicos.criar", grupo: "Serviços", nome: "Criar serviços", descricao: "Enviar TXT, KML ou PDF e abrir serviço novo." },
  { chave: "documentos.gerar", grupo: "Serviços", nome: "Gerar documentos", descricao: "Gerar memorial, planilha, planta e peças." },
  { chave: "servicos.excluir", grupo: "Serviços", nome: "Excluir serviços", descricao: "Apagar um serviço e o que foi gerado nele." },
  { chave: "clientes.editar", grupo: "Clientes", nome: "Cadastrar e editar clientes", descricao: "Criar clientes e alterar os dados deles." },
  { chave: "clientes.excluir", grupo: "Clientes", nome: "Excluir clientes", descricao: "Apagar um cliente do cadastro." },
  { chave: "cadastros.editar", grupo: "Empresa", nome: "Responsáveis técnicos e credenciados", descricao: "Incluir e remover RT e credenciado." },
  { chave: "empresa.configurar", grupo: "Empresa", nome: "Dados da empresa", descricao: "Razão social, logo, desenhista e modelos." },
  { chave: "equipe.gerenciar", grupo: "Empresa", nome: "Gerenciar a equipe", descricao: "Adicionar pessoas, dar e tirar permissões, ver o histórico. Só o dono concede." },
];

/** Perfis prontos para não marcar uma por uma. */
export const PERFIS: { nome: string; descricao: string; permissoes: ChavePermissao[] }[] = [
  { nome: "Operador", descricao: "Faz os serviços do dia a dia", permissoes: ["servicos.criar", "documentos.gerar", "clientes.editar"] },
  { nome: "Projetista", descricao: "Operador que também cuida de RT e credenciados", permissoes: ["servicos.criar", "documentos.gerar", "clientes.editar", "cadastros.editar"] },
  { nome: "Consulta", descricao: "Só vê e baixa o que já foi gerado", permissoes: [] },
  { nome: "Gerente", descricao: "Tudo, inclusive a equipe e os dados da empresa", permissoes: PERMISSOES.map((p) => p.chave) },
];

export const nomePermissao = (c: string): string => PERMISSOES.find((p) => p.chave === c)?.nome ?? c;

// Estado de quem entrou (carregado no App antes da primeira tela).
let minhas: { dono: boolean; lista: Set<string> } | null = null; // null = banco sem permissões: libera

export function definirPermissoes(p: { dono: boolean; lista: string[] } | null): void {
  minhas = p ? { dono: p.dono, lista: new Set(p.lista) } : null;
}

export function temPermissao(chave: ChavePermissao): boolean {
  if (!minhas) return true;
  return minhas.dono || minhas.lista.has(chave);
}
