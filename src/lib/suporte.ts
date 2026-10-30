// Central de suporte (migração 0029): a empresa abre e conversa pelo chat do
// sistema (components/suporte/SuporteChat.tsx); o superadmin responde no painel
// (components/admin/SuporteAdmin.tsx). Escrita só pelas RPCs; anexos no bucket
// privado `suporte`, na pasta da empresa ({escritorio}/{chamado ou "novo"}/…).
import { supabase } from "./supabase";

export type StatusChamado = "aberto" | "em_atendimento" | "aguardando_cliente" | "resolvido";
export type CategoriaChamado = "duvida" | "erro" | "sugestao" | "financeiro" | "acesso" | "outro";
export type PrioridadeChamado = "baixa" | "normal" | "alta" | "urgente";

export interface Anexo { path: string; nome: string; tipo: string; tamanho: number }

export interface Chamado {
  id: string; numero: number; assunto: string; categoria: CategoriaChamado; prioridade: PrioridadeChamado;
  status: StatusChamado; criado_em: string; ultima_mensagem_em: string; ultima_mensagem_de: "cliente" | "suporte";
  nao_lidas: number; autor: string; meu: boolean; avaliacao: number | null; previa: string | null;
}

export interface ChamadoAdmin {
  id: string; numero: number; escritorio_id: string; empresa: string; plano: string | null; autor: string; autor_email: string | null;
  assunto: string; categoria: CategoriaChamado; prioridade: PrioridadeChamado; status: StatusChamado;
  criado_em: string; ultima_mensagem_em: string; ultima_mensagem_de: "cliente" | "suporte"; nao_lidas: number;
  primeira_resposta_em: string | null; resolvido_em: string | null; avaliacao: number | null; avaliacao_comentario: string | null;
  mensagens: number; contexto: Record<string, unknown>; previa: string | null;
}

export interface Mensagem {
  id: number; chamado_id: string; autor_id: string | null; autor_tipo: "cliente" | "suporte" | "sistema";
  texto: string; anexos: Anexo[]; interna: boolean; created_at: string;
}

export const CATEGORIAS: { chave: CategoriaChamado; rotulo: string; dica: string }[] = [
  { chave: "duvida", rotulo: "Dúvida", dica: "Como fazer algo no sistema" },
  { chave: "erro", rotulo: "Erro", dica: "Algo não funcionou como deveria" },
  { chave: "acesso", rotulo: "Acesso", dica: "Login, senha, equipe" },
  { chave: "financeiro", rotulo: "Plano e créditos", dica: "Plano, créditos, cobrança" },
  { chave: "sugestao", rotulo: "Sugestão", dica: "Ideia para melhorar" },
  { chave: "outro", rotulo: "Outro", dica: "Qualquer outro assunto" },
];
export const rotuloCategoria = (c: string) => CATEGORIAS.find((x) => x.chave === c)?.rotulo ?? c;

export const PRIORIDADES: { chave: PrioridadeChamado; rotulo: string }[] = [
  { chave: "baixa", rotulo: "Baixa" }, { chave: "normal", rotulo: "Normal" },
  { chave: "alta", rotulo: "Alta" }, { chave: "urgente", rotulo: "Urgente" },
];
export const rotuloPrioridade = (p: string) => PRIORIDADES.find((x) => x.chave === p)?.rotulo ?? p;

/** Como a EMPRESA lê cada status. */
export const STATUS_CLIENTE: Record<StatusChamado, string> = {
  aberto: "Aguardando o suporte", em_atendimento: "Em atendimento",
  aguardando_cliente: "Respondido", resolvido: "Resolvido",
};
/** Como o SUPORTE lê cada status. */
export const STATUS_SUPORTE: Record<StatusChamado, string> = {
  aberto: "Novo", em_atendimento: "Em atendimento",
  aguardando_cliente: "Aguardando a empresa", resolvido: "Resolvido",
};

export const LIMITE_ANEXO = 10 * 1024 * 1024;
export const MAX_ANEXOS = 5;

function ok<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}

/** O banco ainda sem a 0029: a central some em vez de quebrar a tela. */
export const semSuporte = (e: unknown) => /meus_chamados|chamados|does not exist|could not find|schema cache|404/i.test(String(e instanceof Error ? e.message : e));

// ------------------------------------------------------------------ empresa
export const meusChamados = async (): Promise<Chamado[]> => ok(await supabase.rpc("meus_chamados")) ?? [];

export async function mensagensDoChamado(id: string): Promise<Mensagem[]> {
  return ok(await supabase.from("chamado_mensagens").select().eq("chamado_id", id).order("created_at")) as Mensagem[] ?? [];
}

export async function abrirChamado(d: {
  assunto: string; texto: string; categoria: CategoriaChamado; prioridade: PrioridadeChamado; anexos: Anexo[];
  contexto: Record<string, unknown>;
}): Promise<string> {
  return ok(await supabase.rpc("abrir_chamado", {
    p_assunto: d.assunto, p_texto: d.texto, p_categoria: d.categoria, p_prioridade: d.prioridade,
    p_anexos: d.anexos, p_contexto: d.contexto,
  })) as string;
}

export async function responderChamado(id: string, texto: string, anexos: Anexo[] = []): Promise<void> {
  ok(await supabase.rpc("responder_chamado", { p_chamado: id, p_texto: texto, p_anexos: anexos }));
}
export async function marcarLido(id: string): Promise<void> {
  await supabase.rpc("marcar_chamado_lido", { p_chamado: id });
}
export async function encerrarChamado(id: string, nota?: number | null, comentario?: string): Promise<void> {
  ok(await supabase.rpc("encerrar_chamado", { p_chamado: id, p_nota: nota ?? null, p_comentario: comentario ?? null }));
}

// ------------------------------------------------------------------ anexos
/** Sobe um arquivo para a pasta da empresa. `pasta` = id do chamado (ou "novo"). */
export async function enviarAnexo(escritorioId: string, pasta: string, f: File): Promise<Anexo> {
  if (f.size > LIMITE_ANEXO) throw new Error(`"${f.name}" passa de 10 MB.`);
  const limpo = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${escritorioId}/${pasta}/${crypto.randomUUID().slice(0, 8)}-${limpo}`;
  const { error } = await supabase.storage.from("suporte").upload(path, f, { contentType: f.type || undefined });
  if (error) throw new Error(`Não foi possível enviar "${f.name}": ${error.message}`);
  return { path, nome: f.name, tipo: f.type, tamanho: f.size };
}

const urls = new Map<string, { url: string; ate: number }>();
export async function urlDoAnexo(path: string): Promise<string | null> {
  const c = urls.get(path);
  if (c && c.ate > Date.now()) return c.url;
  const { data } = await supabase.storage.from("suporte").createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  urls.set(path, { url: data.signedUrl, ate: Date.now() + 3_000_000 });
  return data.signedUrl;
}

export const ehImagem = (a: Anexo) => /^image\//.test(a.tipo) || /\.(png|jpe?g|gif|webp)$/i.test(a.nome);
export const tamanhoLegivel = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;

/** Onde a pessoa estava e com o quê: vai junto do chamado, para o suporte reproduzir. */
export function contextoDaTela(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const ua = navigator.userAgent;
  return {
    tela: location.hash.replace(/^#\/?/, "") || "inicio",
    url: location.href.split("?")[0],
    navegador: descreverNavegador(ua).navegador,
    sistema: descreverNavegador(ua).sistema,
    tamanho: `${innerWidth}×${innerHeight}`,
    ...extra,
  };
}

/** "Chrome 130", "Windows", "computador" a partir do user agent. */
export function descreverNavegador(ua: string): { navegador: string; sistema: string; dispositivo: string } {
  const v = (re: RegExp) => ua.match(re)?.[1]?.split(".")[0];
  const navegador = /Edg\//.test(ua) ? `Edge ${v(/Edg\/([\d.]+)/) ?? ""}`
    : /OPR\//.test(ua) ? `Opera ${v(/OPR\/([\d.]+)/) ?? ""}`
      : /Firefox\//.test(ua) ? `Firefox ${v(/Firefox\/([\d.]+)/) ?? ""}`
        : /Chrome\//.test(ua) ? `Chrome ${v(/Chrome\/([\d.]+)/) ?? ""}`
          : /Safari\//.test(ua) ? `Safari ${v(/Version\/([\d.]+)/) ?? ""}` : "Outro";
  const sistema = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Outro";
  const dispositivo = /iPad|Tablet/.test(ua) ? "tablet" : /Mobi|Android|iPhone/.test(ua) ? "celular" : "computador";
  return { navegador: navegador.trim(), sistema, dispositivo };
}

// ------------------------------------------------------------------ superadmin
export const chamadosAdmin = async (): Promise<ChamadoAdmin[]> => ok(await supabase.rpc("sa_chamados")) ?? [];
export async function responderComoSuporte(id: string, texto: string, o: { anexos?: Anexo[]; interna?: boolean; status?: StatusChamado | null } = {}): Promise<void> {
  ok(await supabase.rpc("sa_responder_chamado", {
    p_chamado: id, p_texto: texto, p_anexos: o.anexos ?? [], p_interna: o.interna ?? false, p_status: o.status ?? null,
  }));
}
export async function atualizarChamado(id: string, o: { status?: StatusChamado; prioridade?: PrioridadeChamado }): Promise<void> {
  ok(await supabase.rpc("sa_atualizar_chamado", { p_chamado: id, p_status: o.status ?? null, p_prioridade: o.prioridade ?? null }));
}
export interface ContagemSuporte { esperando: number; abertos: number; nao_lidas: number }
export async function contagemSuporte(): Promise<ContagemSuporte | null> {
  const { data, error } = await supabase.rpc("sa_contagem_suporte");
  return error ? null : (data as ContagemSuporte);
}

// ------------------------------------------------------------------ tutoriais
export interface Tutorial {
  id: string; modulo: string; titulo: string; descricao: string | null; video_url: string | null;
  duracao: string | null; ordem: number; publicado: boolean;
}
export const MODULOS: { chave: string; rotulo: string }[] = [
  { chave: "inicio", rotulo: "Primeiros passos" },
  { chave: "servicos", rotulo: "Serviços e georreferenciamento" },
  { chave: "documentos", rotulo: "Documentos e plantas" },
  { chave: "loteamento", rotulo: "Loteamento e divisão" },
  { chave: "car", rotulo: "CAR" },
  { chave: "clientes", rotulo: "Clientes" },
  { chave: "equipe", rotulo: "Equipe e auditoria" },
  { chave: "config", rotulo: "Configurações e integrações" },
];
export const rotuloModulo = (m: string) => MODULOS.find((x) => x.chave === m)?.rotulo ?? m;

export async function listarTutoriais(): Promise<Tutorial[]> {
  const { data, error } = await supabase.from("tutoriais").select().order("modulo").order("ordem").order("titulo");
  if (error) throw new Error(error.message);
  return (data as Tutorial[]) ?? [];
}
export async function salvarTutorial(t: Partial<Tutorial> & { modulo: string; titulo: string }): Promise<void> {
  const campos = { ...t, atualizado_em: new Date().toISOString() };
  const r = t.id ? await supabase.from("tutoriais").update(campos).eq("id", t.id) : await supabase.from("tutoriais").insert(campos);
  if (r.error) throw new Error(r.error.message);
}
export async function excluirTutorial(id: string): Promise<void> {
  const { error } = await supabase.from("tutoriais").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Link de vídeo (YouTube, Vimeo, Loom, Drive) → endereço para o <iframe>. */
/** Vídeo tocado direto no <video> (os tutoriais gravados moram no próprio site, em /tutoriais/NN.mp4,
 *  com a capa .jpg ao lado). */
export function videoDireto(url: string | null): { src: string; capa: string | null } | null {
  const src = url?.trim();
  if (!src || !/\.(mp4|webm)(\?.*)?$/i.test(src)) return null;
  return { src, capa: src.startsWith("/tutoriais/") ? src.replace(/\.(mp4|webm)$/i, ".jpg") : null };
}

export function videoEmbutido(url: string | null): string | null {
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0`;
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  const loom = url.match(/loom\.com\/(?:share|embed)\/(\w+)/);
  if (loom) return `https://www.loom.com/embed/${loom[1]}`;
  const drive = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (drive) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  return null;
}
