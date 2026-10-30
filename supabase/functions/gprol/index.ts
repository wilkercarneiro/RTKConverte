// Edge Function gprol: integração com o GPROL (CRM do mesmo ramo).
//
// O Vertces é o motor do sincronismo: empurra a fila `integracao_saida` (estado
// dos pedidos, serviços feitos aqui, clientes ligados) e puxa as mudanças do
// GPROL (serviços enviados para cá viram pedidos; clientes com documento).
// Roda ao agir e ao abrir as telas (o front chama `sincronizar`).
//
// Ações da tela (JWT do membro):
//   status, conectar_iniciar, conectar_concluir, sincronizar, desconectar,
//   entregar, descartar, reabrir, servicos_gprol, vincular, tentar_de_novo
// Ações do GPROL (header x-integracao-chave = a chave de retorno):
//   documentos, documento, revogado
//
// verify_jwt desligado no gateway (o GPROL chama sem usuário): cada ação de
// tela confere o usuário aqui dentro. A chave do GPROL só a service_role lê.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  camposClienteParaGprol, chaveDoServico, esperaDaTentativa, localParaGprol, nomeParaGprol, notaDoCard,
  rotuloDoServico, ultimasVersoes, urlDeAutorizacao,
} from "../_shared/gprol.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-integracao-chave",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const erro = (mensagem: string, status = 400) => json({ erro: mensagem }, status);

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = () => createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const doUsuario = (req: Request) => createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, {
  global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  auth: { persistSession: false, autoRefreshToken: false },
});

// Função `vertces` do GPROL e a chave pública dele; app onde o admin autoriza.
const GPROL_FUNCAO = Deno.env.get("GPROL_FUNCTIONS_URL") ??
  "https://egdlthvoeqjtrkgkmmhu.supabase.agenteselevex.top/functions/v1/vertces";
const GPROL_ANON = Deno.env.get("GPROL_ANON_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnZGx0aHZvZXFqdHJrZ2ttbWh1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM2MDkzMTUsImV4cCI6MjA3OTE4NTMxNX0.n1AdXBeJ6AWtC3agu11w_oY40DyTCJ--DwJlCYVHZnQ";
const GPROL_APP = Deno.env.get("GPROL_APP_URL") ?? "https://app.gprol.com.br";
const VERTCES_APP = "https://vertces.com.br/app/";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

async function sha256(texto: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}
function aleatorio(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

class ErroGprol extends Error {
  constructor(msg: string, readonly status: number) { super(msg); }
}

/** Chama a função do GPROL. Sem chave: só a troca do código. */
async function gprol(acao: string, corpo: Record<string, unknown>, chave?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json", apikey: GPROL_ANON, Authorization: `Bearer ${GPROL_ANON}`,
  };
  if (chave) headers["x-integracao-chave"] = chave;
  let r: Response;
  try {
    r = await fetch(GPROL_FUNCAO, {
      method: "POST", headers, body: JSON.stringify({ ...corpo, acao }), signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    throw new ErroGprol(`GPROL fora do ar (${(e as Error).message})`, 503);
  }
  const dados = await r.json().catch(() => ({})) as Record<string, unknown>;
  if (!r.ok) throw new ErroGprol(String(dados.erro ?? `GPROL respondeu ${r.status}`), r.status);
  return dados;
}

async function rpc<T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

type Servico = {
  id: string; escritorio_id: string; pedido_externo_id: string | null; origem_id: string | null;
  cliente_id: string | null; status: string; tipo: string | null; modalidade: string | null; tem_glebas: boolean | null;
  divisao: unknown; denominacao: string | null; detentor_nome: string | null; detentor_cpf: string | null;
  endereco_detentor: string | null; nome_arquivo_txt: string | null; municipio: string | null; uf: string | null;
  criado_por: string | null;
};
type Pedido = { id: string; escritorio_id: string; externo_id: string; status: string; origem: string; cliente_id: string | null };

// ================================================================== motor do sincronismo
class Motor {
  constructor(readonly db: SupabaseClient, readonly esc: string, readonly chave: string) {}

  g(acao: string, corpo: Record<string, unknown> = {}) { return gprol(acao, corpo, this.chave); }

  async nomeDe(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const { data } = await this.db.from("membros_escritorio").select("nome").eq("user_id", userId).maybeSingle();
    return (data as { nome: string | null } | null)?.nome ?? null;
  }

  /** Estado do pedido → marcos no GPROL (o card anda só para frente lá). */
  async enviarPedido(pedidoId: string) {
    const { data } = await this.db.from("pedidos_externos").select("*").eq("id", pedidoId).eq("escritorio_id", this.esc).maybeSingle();
    const p = data as Pedido | null;
    if (!p || p.status === "cancelado" || p.status === "descartado") return;
    const marcos = await rpc<string[]>(this.db, "integracao_marcos_do_pedido", { p_pedido: p.id });
    if (!marcos?.length) return;
    // quem fez por último: a última geração; sem documento, quem criou o serviço
    const { data: svs } = await this.db.from("servicos").select("id, criado_por, created_at").eq("pedido_externo_id", p.id)
      .order("created_at", { ascending: false });
    const ids = (svs ?? []).map((s: { id: string }) => s.id);
    let autor: string | null = (svs?.[0] as { criado_por: string | null } | undefined)?.criado_por ?? null;
    if (ids.length) {
      const { data: doc } = await this.db.from("documentos_gerados").select("gerado_por").in("servico_id", ids)
        .not("gerado_por", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      autor = (doc as { gerado_por: string } | null)?.gerado_por ?? autor;
    }
    const r = await this.g("marco", { servico_gprol_id: p.externo_id, marcos, nota: notaDoCard(marcos, await this.nomeDe(autor)) });
    if (typeof r.stage_name === "string") {
      await this.db.from("pedidos_externos").update({ etapa: r.stage_name, atualizado_em: new Date().toISOString() }).eq("id", p.id);
    }
  }

  /** Cliente daqui no GPROL: devolve o id de lá (cria/casa e liga quando preciso). */
  async clienteNoGprol(clienteId: string): Promise<string | null> {
    const { data: v } = await this.db.from("vinculos_externos").select("externo_id")
      .eq("escritorio_id", this.esc).eq("entidade", "cliente").eq("local_id", clienteId).maybeSingle();
    if (v) return (v as { externo_id: string }).externo_id;
    const { data: c } = await this.db.from("clientes").select("*").eq("id", clienteId).maybeSingle();
    if (!c) return null;
    const r = await this.g("cliente_salvar", { vertces_id: clienteId, campos: camposClienteParaGprol(c as Record<string, unknown>) });
    const ext = r.client_id as string;
    // dois clientes daqui com o mesmo CPF casam com o mesmo de lá: vale o último (o GPROL faz igual)
    await this.db.from("vinculos_externos").delete().eq("escritorio_id", this.esc).eq("entidade", "cliente")
      .eq("externo_id", ext).neq("local_id", clienteId);
    await this.db.from("vinculos_externos").upsert({
      escritorio_id: this.esc, provedor: "gprol", entidade: "cliente", local_id: clienteId, externo_id: ext,
    }, { onConflict: "escritorio_id,provedor,entidade,local_id" });
    return ext;
  }

  /** Serviço daqui: pertence a um pedido (manda o estado) ou nasce no GPROL ao gerar os primeiros documentos. */
  async enviarServico(servicoId: string, profundidade = 0): Promise<void> {
    const { data } = await this.db.from("servicos").select("*").eq("id", servicoId).eq("escritorio_id", this.esc).maybeSingle();
    const s = data as Servico | null;
    if (!s) return;
    if (s.pedido_externo_id) return this.enviarPedido(s.pedido_externo_id);
    if (s.origem_id && profundidade < 5) {
      // gleba/parte de um serviço que ainda não está no GPROL: quem vai é o de origem
      return this.enviarServico(s.origem_id, profundidade + 1);
    }
    const { count } = await this.db.from("documentos_gerados").select("id", { count: "exact", head: true }).eq("servico_id", s.id);
    if (!count && s.status !== "gerado") return; // rascunho: ainda não vai (pode ser abandonado)

    let clienteGprol: string | null = null;
    if (s.cliente_id) clienteGprol = await this.clienteNoGprol(s.cliente_id);
    else if ((s.detentor_nome ?? "").trim()) {
      const r = await this.g("cliente_salvar", {
        campos: { full_name: s.detentor_nome, cpf_cnpj: s.detentor_cpf ?? "", address: s.endereco_detentor ?? "" },
      });
      clienteGprol = r.client_id as string;
    }
    const chave = chaveDoServico(s);
    const r = await this.g("servico_criar", {
      vertces_ref: s.id, cliente_gprol_id: clienteGprol, nome: nomeParaGprol(s, chave),
      fazenda: s.denominacao, local: localParaGprol(s.municipio, s.uf), modalidades: [chave],
    });
    if (r.ignorado) return; // a empresa escolheu não receber serviços feitos aqui
    const aplicado = await rpc<{ pedido_id: string }>(this.db, "gprol_aplicar_servico", { p_escritorio: this.esc, p: r.servico });
    await rpc(this.db, "integracao_definir_pedido", { p_servico: s.id, p_pedido: aplicado.pedido_id });
    await this.enviarPedido(aplicado.pedido_id);
  }

  async enviarCliente(clienteId: string, campos: string[]) {
    const { data: v } = await this.db.from("vinculos_externos").select("externo_id")
      .eq("escritorio_id", this.esc).eq("entidade", "cliente").eq("local_id", clienteId).maybeSingle();
    if (!v) return;
    const { data: c } = await this.db.from("clientes").select("*").eq("id", clienteId).maybeSingle();
    if (!c) return;
    await this.g("cliente_salvar", {
      cliente_gprol_id: (v as { externo_id: string }).externo_id, vertces_id: clienteId,
      campos: camposClienteParaGprol(c as Record<string, unknown>, campos),
    });
  }

  /** Esvazia a fila de saída. Erro de um item não para os outros; 401 para tudo. */
  async empurrar(): Promise<{ enviados: number; falhas: number }> {
    let enviados = 0, falhas = 0;
    const { data } = await this.db.from("integracao_saida").select("*").eq("escritorio_id", this.esc)
      .is("enviado_em", null).lte("proxima_tentativa", new Date().toISOString()).order("id").limit(40);
    for (const it of (data ?? []) as { id: number; tipo: string; ref_id: string; campos: string[]; versao: number; tentativas: number }[]) {
      try {
        if (it.tipo === "pedido") await this.enviarPedido(it.ref_id);
        else if (it.tipo === "servico") await this.enviarServico(it.ref_id);
        else if (it.tipo === "cliente") await this.enviarCliente(it.ref_id, it.campos ?? []);
        // dá baixa só na versão enviada: mudança que chegou no meio continua na fila
        const { data: baixa } = await this.db.from("integracao_saida")
          .update({ enviado_em: new Date().toISOString(), erro: null }).eq("id", it.id).eq("versao", it.versao).select("id");
        if (!baixa?.length) {
          await this.db.from("integracao_saida").update({ tentativas: 0, proxima_tentativa: new Date().toISOString() }).eq("id", it.id);
        }
        enviados++;
      } catch (e) {
        if (e instanceof ErroGprol && e.status === 401) throw e;
        falhas++;
        const t = it.tentativas + 1;
        await this.db.from("integracao_saida").update({
          tentativas: t, erro: (e as Error).message.slice(0, 500),
          proxima_tentativa: new Date(Date.now() + esperaDaTentativa(t)).toISOString(),
        }).eq("id", it.id);
        // GPROL fora do ar (rede/5xx): o resto espera a próxima rodada; recusa de um item (4xx) não para os outros
        if (e instanceof ErroGprol && e.status >= 500) break;
      }
    }
    return { enviados, falhas };
  }

  /** Aplica um item que veio do GPROL. Devolve o vínculo de cliente a informar (se houver). */
  async aplicar(item: { kind: string; fields?: string[]; data: Record<string, unknown> }) {
    const vinculos: { client_id: string; external_id: string }[] = [];
    if (item.kind === "service") {
      const r = await rpc<{ cliente_id?: string | null }>(this.db, "gprol_aplicar_servico", { p_escritorio: this.esc, p: item.data });
      const cli = item.data.client as { id?: string } | null;
      if (r?.cliente_id && cli?.id) vinculos.push({ client_id: cli.id, external_id: r.cliente_id });
    } else if (item.kind === "client") {
      const id = await rpc<string | null>(this.db, "gprol_aplicar_cliente", {
        p_escritorio: this.esc, p: { ...item.data, fields: item.fields ?? [] }, p_forcar: false,
      });
      if (id) vinculos.push({ client_id: String(item.data.id), external_id: id });
    }
    return vinculos;
  }

  async puxar(): Promise<{ recebidos: number; falhas: number }> {
    let recebidos = 0, falhas = 0;
    for (let pagina = 0; pagina < 5; pagina++) {
      const r = await this.g("mudancas", { limite: 100 });
      const itens = (r.itens ?? []) as { id: number; v: number; kind: string; fields?: string[]; data: Record<string, unknown> }[];
      if (!itens.length) break;
      const acks: { id: number; v: number }[] = [];
      const vinculos: { client_id: string; external_id: string }[] = [];
      for (const it of itens) {
        try {
          vinculos.push(...await this.aplicar(it));
          acks.push({ id: it.id, v: it.v });
          recebidos++;
        } catch (e) {
          falhas++;
          console.error("[gprol] aplicar", it.kind, (e as Error).message);
        }
      }
      if (acks.length || vinculos.length) await this.g("confirmar", { itens: acks, vinculos });
      if (itens.length < 100 || !acks.length) break;
    }
    return { recebidos, falhas };
  }

  /** Importação da conexão: clientes do GPROL com CPF/CNPJ. */
  async importarClientes(): Promise<number> {
    let depois: string | null = null, n = 0;
    for (let pagina = 0; pagina < 100; pagina++) {
      const r = await this.g("clientes", { depois_de: depois, limite: 200 });
      const itens = (r.itens ?? []) as Record<string, unknown>[];
      const vinculos: { client_id: string; external_id: string }[] = [];
      for (const c of itens) {
        const id = await rpc<string | null>(this.db, "gprol_aplicar_cliente", { p_escritorio: this.esc, p: c, p_forcar: false });
        if (id) { vinculos.push({ client_id: String(c.id), external_id: id }); n++; }
      }
      if (vinculos.length) await this.g("confirmar", { itens: [], vinculos });
      if (r.fim || !itens.length) break;
      depois = String(itens[itens.length - 1].id);
    }
    return n;
  }
}

/** Uma rodada completa (trava por escritório; outra rodada em curso → só avisa). */
async function sincronizar(db: SupabaseClient, esc: string) {
  const { data: seg } = await db.from("integracoes_segredos").select("segredo").eq("escritorio_id", esc).eq("provedor", "gprol").maybeSingle();
  const { data: integ } = await db.from("integracoes").select("status").eq("escritorio_id", esc).eq("provedor", "gprol").maybeSingle();
  if (!seg || (integ as { status: string } | null)?.status !== "ativa") return { conectado: false };
  const travou = await rpc<boolean>(db, "integracao_travar", { p_escritorio: esc, p_segundos: 90 });
  if (!travou) return { conectado: true, ocupado: true };
  const motor = new Motor(db, esc, (seg as { segredo: string }).segredo);
  let resultado: Record<string, unknown> = { conectado: true };
  let ultimoErro: string | null = null;
  try {
    const saida = await motor.empurrar();
    const entrada = await motor.puxar();
    resultado = { ...resultado, ...saida, ...entrada };
    if (saida.falhas || entrada.falhas) {
      const { data: e } = await db.from("integracao_saida").select("erro").eq("escritorio_id", esc).is("enviado_em", null)
        .not("erro", "is", null).order("atualizado_em", { ascending: false }).limit(1).maybeSingle();
      ultimoErro = (e as { erro: string } | null)?.erro ?? "Algumas mudanças não foram aplicadas.";
    }
  } catch (e) {
    ultimoErro = (e as Error).message;
    if (e instanceof ErroGprol && e.status === 401) {
      // o GPROL desfez a conexão
      await db.from("integracoes").update({ status: "desconectada", desconectado_em: new Date().toISOString() })
        .eq("escritorio_id", esc).eq("provedor", "gprol");
      await db.from("integracoes_segredos").delete().eq("escritorio_id", esc);
      resultado = { conectado: false };
    } else {
      resultado = { ...resultado, erro: ultimoErro };
    }
  } finally {
    await db.from("integracoes").update({
      travado_ate: null, ultima_sincronizacao: new Date().toISOString(), ultimo_erro: ultimoErro,
    }).eq("escritorio_id", esc).eq("provedor", "gprol");
  }
  return resultado;
}

// ================================================================== ações do GPROL (chave de retorno)
async function acaoDoGprol(db: SupabaseClient, esc: string, acao: string, b: Record<string, unknown>) {
  if (acao === "revogado") {
    await db.from("integracoes").update({ status: "desconectada", desconectado_em: new Date().toISOString(), travado_ate: null })
      .eq("escritorio_id", esc).eq("provedor", "gprol");
    await db.from("integracoes_segredos").delete().eq("escritorio_id", esc);
    return json({ ok: true });
  }
  if (acao !== "documentos" && acao !== "documento") return erro("Ação desconhecida.");
  if (!ehUuid(b.servico_gprol_id)) return erro("Serviço inválido.");
  const { data: ped } = await db.from("pedidos_externos").select("id, status, titulo")
    .eq("escritorio_id", esc).eq("provedor", "gprol").eq("externo_id", b.servico_gprol_id).maybeSingle();
  if (!ped) return json({ servicos: [] });
  const p = ped as { id: string; status: string; titulo: string | null };
  const { data: svs } = await db.from("servicos")
    .select("id, denominacao, detentor_nome, nome_arquivo_txt, modalidade, tipo, tem_glebas, divisao, status, origem_id, created_at")
    .eq("pedido_externo_id", p.id).order("created_at");
  const servicos = (svs ?? []) as (Servico & { created_at: string })[];
  const ids = servicos.map((s) => s.id);
  const { data: docs } = ids.length
    ? await db.from("documentos_gerados").select("id, servico_id, tipo, titulo, versao, path, created_at").in("servico_id", ids)
      .order("versao", { ascending: false }).order("created_at", { ascending: false })
    : { data: [] };
  const todos = (docs ?? []) as { id: string; servico_id: string; tipo: string; titulo: string; versao: number; path: string; created_at: string }[];

  if (acao === "documento") {
    const d = todos.find((x) => x.id === b.documento_id);
    if (!d) return erro("Documento não encontrado.", 404);
    const { data: assinada, error } = await db.storage.from("gerados").createSignedUrl(d.path, 300);
    if (error || !assinada) return erro("Não foi possível abrir o arquivo agora.", 500);
    return json({ url: assinada.signedUrl, titulo: d.titulo, expira_em_s: 300 });
  }

  return json({
    pedido: { status: p.status, titulo: p.titulo },
    servicos: servicos.map((s) => {
      const chave = chaveDoServico(s);
      const meus = ultimasVersoes(todos.filter((d) => d.servico_id === s.id));
      return {
        id: s.id, chave, rotulo: rotuloDoServico(chave), nome: s.denominacao || s.detentor_nome || s.nome_arquivo_txt,
        derivado: !!s.origem_id, status: s.status, criado_em: s.created_at,
        abrir_no_vertces: `${VERTCES_APP}#/servico/${s.id}`,
        documentos: meus.map((d) => ({ id: d.id, tipo: d.tipo, titulo: d.titulo, versao: d.versao, criado_em: d.created_at })),
      };
    }),
  });
}

// ================================================================== ações da tela
async function acaoDaTela(req: Request, db: SupabaseClient, acao: string, b: Record<string, unknown>) {
  const cli = doUsuario(req);
  const { data: u } = await cli.auth.getUser();
  if (!u?.user) return erro("Sessão inválida ou expirada. Entre de novo.", 401);
  const eu = u.user.id;
  const { data: m } = await db.from("membros_escritorio").select("escritorio_id, papel, nome, ativo").eq("user_id", eu).maybeSingle();
  const membro = m as { escritorio_id: string; papel: string; nome: string | null; ativo: boolean } | null;
  if (!membro || membro.ativo === false) return erro("Sua conta não está ligada a uma empresa.", 403);
  const esc = membro.escritorio_id;
  const { data: escRow } = await db.from("escritorios").select("nome, status").eq("id", esc).maybeSingle();
  const escritorio = escRow as { nome: string; status: string } | null;
  if (escritorio?.status !== "ativo") return erro("Empresa suspensa.", 403);
  const podeConfigurar = async () => (await cli.rpc("tem_permissao", { p: "empresa.configurar" })).data === true;
  const liberado = async () => rpc<boolean>(db, "recurso_liberado", { p_escritorio: esc, p_chave: "integracao.gprol" });
  const pedidoDoEscritorio = async (id: unknown) => {
    if (!ehUuid(id)) return null;
    const { data } = await db.from("pedidos_externos").select("*").eq("id", id).eq("escritorio_id", esc).maybeSingle();
    return data as Pedido | null;
  };

  switch (acao) {
    case "status": {
      const [{ data: integ }, { count: pendentes }, { data: erros }, { count: aExecutar }] = await Promise.all([
        db.from("integracoes").select("status, empresa_externa_nome, conectado_em, ultima_sincronizacao, ultimo_erro, resumo")
          .eq("escritorio_id", esc).eq("provedor", "gprol").maybeSingle(),
        db.from("integracao_saida").select("id", { count: "exact", head: true }).eq("escritorio_id", esc).is("enviado_em", null),
        db.from("integracao_saida").select("id, tipo, ref_id, erro, tentativas, atualizado_em").eq("escritorio_id", esc)
          .is("enviado_em", null).gt("tentativas", 0).order("atualizado_em", { ascending: false }).limit(10),
        db.from("pedidos_externos").select("id", { count: "exact", head: true }).eq("escritorio_id", esc).eq("status", "pendente"),
      ]);
      return json({
        liberado: await liberado(), pode_configurar: await podeConfigurar(),
        integracao: integ ?? null, pendentes: pendentes ?? 0, erros: erros ?? [], pedidos_pendentes: aExecutar ?? 0,
      });
    }

    case "conectar_iniciar": {
      if (!(await podeConfigurar())) return erro("Só quem configura a empresa pode conectar o GPROL.", 403);
      if (!(await liberado())) return erro("A integração com o GPROL não está no plano da sua empresa.", 403);
      const state = aleatorio(32);
      await db.from("integracao_estados").delete().lt("expira_em", new Date().toISOString());
      const { error } = await db.from("integracao_estados").insert({
        state, escritorio_id: esc, user_id: eu, expira_em: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      if (error) return erro(error.message, 500);
      return json({ url: urlDeAutorizacao(GPROL_APP, state, esc, escritorio?.nome ?? "") });
    }

    case "conectar_concluir": {
      if (!(await podeConfigurar())) return erro("Só quem configura a empresa pode conectar o GPROL.", 403);
      const state = String(b.state ?? ""), code = String(b.code ?? "");
      const { data: est } = await db.from("integracao_estados").select("*").eq("state", state).maybeSingle();
      const e = est as { escritorio_id: string; user_id: string; expira_em: string } | null;
      if (!e || e.escritorio_id !== esc || e.user_id !== eu || new Date(e.expira_em) < new Date()) {
        return erro("Este link de conexão venceu ou não é seu. Clique em Conectar de novo.", 400);
      }
      await db.from("integracao_estados").delete().eq("state", state);
      let t: Record<string, unknown>;
      try {
        t = await gprol("token", { code, state, escritorio_id: esc, escritorio_nome: escritorio?.nome ?? "" });
      } catch (err) {
        return erro((err as Error).message, err instanceof ErroGprol && err.status < 500 ? 400 : 502);
      }
      const agora = new Date().toISOString();
      const { error: e1 } = await db.from("integracoes").upsert({
        escritorio_id: esc, provedor: "gprol", status: "ativa", empresa_externa_id: String(t.empresa_id),
        empresa_externa_nome: String(t.empresa_nome ?? ""), conectado_por: eu, conectado_em: agora,
        desconectado_em: null, ultimo_erro: null, travado_ate: null,
      }, { onConflict: "escritorio_id,provedor" });
      if (e1) return erro(e1.message, 500);
      const { error: e2 } = await db.from("integracoes_segredos").upsert({
        escritorio_id: esc, provedor: "gprol", segredo: String(t.chave), retorno_hash: await sha256(String(t.chave_retorno)),
      }, { onConflict: "escritorio_id,provedor" });
      if (e2) return erro(e2.message, 500);
      await db.from("atividades").insert({ escritorio_id: esc, user_id: eu, acao: "integracao.conectada", alvo: `GPROL · ${t.empresa_nome ?? ""}` });

      // importação: clientes com documento e o que o GPROL já mandou
      const motor = new Motor(db, esc, String(t.chave));
      const inicio = new Date().toISOString();
      let clientes = 0;
      let aviso: string | null = null;
      try { clientes = await motor.importarClientes(); } catch (err) { aviso = (err as Error).message; }
      const sinc = await sincronizar(db, esc);
      const { count: criados } = await db.from("clientes").select("id", { count: "exact", head: true })
        .eq("escritorio_id", esc).gte("created_at", inicio);
      const { count: pedidos } = await db.from("pedidos_externos").select("id", { count: "exact", head: true })
        .eq("escritorio_id", esc).in("status", ["pendente", "em_execucao"]);
      const resumo = { clientes_ligados: clientes, clientes_criados: criados ?? 0, pedidos: pedidos ?? 0, em: inicio, aviso };
      await db.from("integracoes").update({ resumo }).eq("escritorio_id", esc).eq("provedor", "gprol");
      return json({ ok: true, empresa: t.empresa_nome, resumo, sincronizacao: sinc });
    }

    case "sincronizar":
      return json(await sincronizar(db, esc));

    case "tentar_de_novo": {
      await db.from("integracao_saida").update({ proxima_tentativa: new Date().toISOString() })
        .eq("escritorio_id", esc).is("enviado_em", null);
      return json(await sincronizar(db, esc));
    }

    case "desconectar": {
      if (!(await podeConfigurar())) return erro("Só quem configura a empresa pode desconectar o GPROL.", 403);
      const { data: seg } = await db.from("integracoes_segredos").select("segredo").eq("escritorio_id", esc).maybeSingle();
      if (seg) { try { await gprol("desconectar", {}, (seg as { segredo: string }).segredo); } catch { /* sem travar */ } }
      await db.from("integracoes").update({ status: "desconectada", desconectado_em: new Date().toISOString(), travado_ate: null })
        .eq("escritorio_id", esc).eq("provedor", "gprol");
      await db.from("integracoes_segredos").delete().eq("escritorio_id", esc);
      await db.from("integracao_saida").delete().eq("escritorio_id", esc).is("enviado_em", null);
      await db.from("atividades").insert({ escritorio_id: esc, user_id: eu, acao: "integracao.desconectada", alvo: "GPROL" });
      return json({ ok: true });
    }

    case "entregar": {
      const p = await pedidoDoEscritorio(b.pedido_id);
      if (!p) return erro("Pedido não encontrado.", 404);
      if (p.status !== "em_execucao" && p.status !== "pendente") return erro("Este pedido não está em execução.", 409);
      await db.from("pedidos_externos").update({ status: "entregue", entregue_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq("id", p.id);
      // entregar o pedido conclui os serviços principais dele (0033): somem de
      // "Em andamento" e o histórico registra quem concluiu
      await db.from("servicos").update({ concluido_em: new Date().toISOString(), concluido_por: eu })
        .eq("pedido_externo_id", p.id).is("origem_id", null).is("concluido_em", null);
      await rpc(db, "integracao_enfileirar", { p_escritorio: esc, p_tipo: "pedido", p_ref: p.id, p_campos: [] });
      return json({ ok: true, sincronizacao: await sincronizar(db, esc) });
    }

    case "descartar":
    case "reabrir": {
      const p = await pedidoDoEscritorio(b.pedido_id);
      if (!p) return erro("Pedido não encontrado.", 404);
      if (acao === "descartar") {
        if (p.status !== "pendente") return erro("Só um pedido ainda não executado pode ser descartado.", 409);
        await db.from("pedidos_externos").update({ status: "descartado", atualizado_em: new Date().toISOString() }).eq("id", p.id);
      } else {
        if (p.status !== "descartado" && p.status !== "entregue") return erro("Este pedido já está aberto.", 409);
        const { count } = await db.from("servicos").select("id", { count: "exact", head: true }).eq("pedido_externo_id", p.id);
        await db.from("pedidos_externos").update({ status: count ? "em_execucao" : "pendente", entregue_em: null, atualizado_em: new Date().toISOString() }).eq("id", p.id);
        // reabrir um pedido entregue reabre os serviços dele (o inverso de "entregar")
        if (p.status === "entregue") {
          await db.from("servicos").update({ concluido_em: null }).eq("pedido_externo_id", p.id).is("origem_id", null);
        }
      }
      return json({ ok: true });
    }

    case "servicos_gprol": {
      if (!ehUuid(b.cliente_id)) return erro("Cliente inválido.");
      const { data: v } = await db.from("vinculos_externos").select("externo_id")
        .eq("escritorio_id", esc).eq("entidade", "cliente").eq("local_id", b.cliente_id).maybeSingle();
      const { data: seg } = await db.from("integracoes_segredos").select("segredo").eq("escritorio_id", esc).maybeSingle();
      if (!seg) return erro("O escritório não está conectado ao GPROL.", 409);
      if (!v) return json({ itens: [], cliente_ligado: false });
      const r = await gprol("servicos_do_cliente", { cliente_gprol_id: (v as { externo_id: string }).externo_id }, (seg as { segredo: string }).segredo);
      return json({ ...r, cliente_ligado: true });
    }

    case "vincular": {
      if (!ehUuid(b.servico_id) || !ehUuid(b.servico_gprol_id)) return erro("Pedido incompleto.");
      // o membro precisa enxergar o serviço (RLS dele)
      const { data: visivel } = await cli.from("servicos").select("id").eq("id", b.servico_id).maybeSingle();
      if (!visivel) return erro("Serviço não encontrado.", 404);
      const { data: sv } = await db.from("servicos").select("*").eq("id", b.servico_id).maybeSingle();
      const s = sv as Servico;
      if (s.pedido_externo_id) return erro("Este serviço já está ligado a um serviço do GPROL.", 409);
      const { data: seg } = await db.from("integracoes_segredos").select("segredo").eq("escritorio_id", esc).maybeSingle();
      if (!seg) return erro("O escritório não está conectado ao GPROL.", 409);
      let r: Record<string, unknown>;
      try {
        r = await gprol("vincular_servico", { servico_gprol_id: b.servico_gprol_id, modalidades: [chaveDoServico(s)] }, (seg as { segredo: string }).segredo);
      } catch (err) {
        return erro((err as Error).message, 502);
      }
      const aplicado = await rpc<{ pedido_id: string }>(db, "gprol_aplicar_servico", { p_escritorio: esc, p: r.servico });
      await rpc(db, "integracao_definir_pedido", { p_servico: s.id, p_pedido: aplicado.pedido_id });
      await rpc(db, "integracao_enfileirar", { p_escritorio: esc, p_tipo: "pedido", p_ref: aplicado.pedido_id, p_campos: [] });
      return json({ ok: true, pedido_id: aplicado.pedido_id, sincronizacao: await sincronizar(db, esc) });
    }

    default:
      return erro("Ação desconhecida.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return erro("Método inválido", 405);
  const db = admin();
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return erro("Corpo inválido."); }
  const acao = String(b.acao ?? "");
  try {
    const chave = req.headers.get("x-integracao-chave");
    if (chave) {
      const { data } = await db.from("integracoes_segredos").select("escritorio_id").eq("retorno_hash", await sha256(chave)).maybeSingle();
      if (!data) return erro("Conexão com o Vertces desfeita.", 401);
      const esc = (data as { escritorio_id: string }).escritorio_id;
      const { data: integ } = await db.from("integracoes").select("status").eq("escritorio_id", esc).eq("provedor", "gprol").maybeSingle();
      if ((integ as { status: string } | null)?.status !== "ativa") return erro("Conexão com o Vertces desfeita.", 401);
      return await acaoDoGprol(db, esc, acao, b);
    }
    return await acaoDaTela(req, db, acao, b);
  } catch (e) {
    console.error("[gprol]", acao, e);
    return erro((e as Error).message || "Erro inesperado.", e instanceof ErroGprol ? 502 : 500);
  }
});
