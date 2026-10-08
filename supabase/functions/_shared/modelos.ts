// Modelos (DOCX/ODS) e logo de cada escritório no bucket `templates`.
//
// Onde o servidor procura um arquivo, em ordem:
//   1. templates/escritorios/{id}/{nome} — o modelo que o próprio escritório enviou
//   2. escritório legado (`modelos_compartilhados`): templates/{nome}, a raiz —
//      é onde estão os modelos de hoje, e ele continua exatamente como era
//   3. escritório novo: templates/padrao/{nome} — modelo neutro, sem timbre de
//      ninguém (o dono do sistema publica lá)
//   4. arquivos de formato oficial, iguais para todos (planta-template.ods,
//      a planilha do SIGEF): a raiz
// Logo nunca cai no padrão: escritório sem logo própria gera sem logo.
//
// Antes da migração de escritórios o serviço não tem `escritorio_id`: tudo
// resolve na raiz, como sempre.

/** Arquivos de formato oficial, sem marca de escritório: valem para todos. */
export const MODELOS_DE_FORMATO_OFICIAL = new Set(["planta-template.ods"]);

export interface EscritorioModelos {
  /** null = banco ainda sem escritórios (antes da migração 0020) */
  id: string | null;
  /** true = escritório legado, usa a raiz de `templates` */
  compartilhados: boolean;
}

export const SEM_ESCRITORIO: EscritorioModelos = { id: null, compartilhados: true };

/** Caminhos candidatos de um modelo, do mais específico ao mais geral. */
export function caminhosDoModelo(esc: EscritorioModelos, nome: string): string[] {
  const caminhos: string[] = [];
  if (esc.id) caminhos.push(`escritorios/${esc.id}/${nome}`);
  if (esc.compartilhados) caminhos.push(nome);
  else {
    caminhos.push(`padrao/${nome}`);
    if (MODELOS_DE_FORMATO_OFICIAL.has(nome)) caminhos.push(nome);
  }
  return caminhos;
}

/** Caminhos candidatos da logo (png antes de jpg). Sem fallback para o padrão. */
export function caminhosDaLogo(esc: EscritorioModelos): { caminho: string; tipo: "png" | "jpg" }[] {
  const base = esc.id && !esc.compartilhados ? `escritorios/${esc.id}/` : "";
  return [
    { caminho: `${base}logo-empresa.png`, tipo: "png" },
    { caminho: `${base}logo-empresa.jpg`, tipo: "jpg" },
  ];
}

interface Baixavel {
  storage: { from: (b: string) => { download: (n: string) => Promise<{ error: unknown; data: Blob | null }> } };
}
interface Consultavel {
  from: (t: string) => {
    select: (c: string) => {
      eq: (c: string, v: string) => { maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
}

/** Escritório do serviço, para escolher modelos. Lido com a service_role. */
export async function escritorioDoServico(
  // `unknown` + cast: casar o cliente do supabase-js com a interface estoura o
  // limite de instanciação de tipos do checker do Deno (TS2589)
  supa: unknown, servico: { escritorio_id?: string | null },
): Promise<EscritorioModelos> {
  const id = servico.escritorio_id ?? null;
  if (!id) return SEM_ESCRITORIO;
  const { data } = await (supa as Consultavel).from("escritorios").select("modelos_compartilhados").eq("id", id).maybeSingle();
  return { id, compartilhados: Boolean((data as { modelos_compartilhados?: boolean } | null)?.modelos_compartilhados) };
}

/** Baixa o primeiro candidato que existir. `caminho` diz de onde veio. */
export async function baixarModelo(
  supa: Baixavel, esc: EscritorioModelos, nome: string,
): Promise<{ data: Blob | null; caminho: string | null }> {
  for (const caminho of caminhosDoModelo(esc, nome)) {
    const dl = await supa.storage.from("templates").download(caminho);
    if (!dl.error && dl.data) return { data: dl.data, caminho };
  }
  return { data: null, caminho: null };
}
