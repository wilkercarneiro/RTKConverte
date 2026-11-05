// Edge Function cobranca: pagamentos pelo Asaas e avisos no WhatsApp
// (migração 0034). A lógica está em fluxos.ts; aqui só se liga o banco de
// verdade (service_role), o login de quem chama e o Deno.serve.
//
// verify_jwt DESLIGADO (o Asaas não manda JWT): na VPS, a função entra em
// FUNCTIONS_VERIFY_JWT_MAP com false, como a `gprol`. Quem chama:
//   - o Asaas, em POST …/functions/v1/cobranca?origem=asaas, com o token no
//     header asaas-access-token (configurado pelo próprio painel);
//   - a página de cadastro, SEM login (só a chave pública): cadastro_criar, em
//     cadastro.ts (0040);
//   - o site, com o JWT da pessoa: as ações em fluxos.ts.
import { createClient } from "@supabase/supabase-js";
import { tratarAcao, tratarWebhook, ErroUsuario } from "./fluxos.ts";
import { tratarPublico } from "./cadastro.ts";
import { CorpoInvalido, dentroDoLimite, lerJson, lerTexto, LIMITE_MB } from "../_shared/limite.ts";
import type { Banco, CartaoSalvo, Deps, EmpresaCobranca, PedidoCredito, PlanoAVenda, ReservaRecarga, Usuario } from "./fluxos.ts";
import type { CarteiraDoPlano } from "../_shared/mensagens_cobranca.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const servico = () => createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const doUsuario = (req: Request) => createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, {
  global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  auth: { persistSession: false, autoRefreshToken: false },
});
type Svc = ReturnType<typeof servico>;

function falhou(r: { error: { message: string } | null }, onde: string): void {
  if (r.error) throw new Error(`${onde}: ${r.error.message}`);
}

function banco(svc: Svc): Banco {
  return {
    async config() {
      const r = await svc.from("cobranca_config").select("key, value");
      falhou(r, "config");
      return Object.fromEntries((r.data ?? []).map((x: { key: string; value: string }) => [x.key, x.value]));
    },
    async gravarConfig(pares) {
      const apagar = Object.keys(pares).filter((k) => pares[k] === null);
      const gravar = Object.entries(pares).filter(([, v]) => v !== null).map(([key, value]) => ({ key, value, atualizado_em: new Date().toISOString() }));
      if (apagar.length) falhou(await svc.from("cobranca_config").delete().in("key", apagar), "config");
      if (gravar.length) falhou(await svc.from("cobranca_config").upsert(gravar), "config");
    },
    async esquecerClientesAsaas() {
      falhou(await svc.from("cobranca_empresas").update({ asaas_cliente_id: null }).not("asaas_cliente_id", "is", null), "clientes");
    },
    async registrarEvento(e) {
      const r = await svc.from("asaas_eventos").insert(e).select("id").single();
      if (r.error?.code === "23505") return { repetido: true, id: null };
      falhou(r, "evento");
      return { repetido: false, id: (r.data as { id: number }).id };
    },
    async resultadoEvento(id, resultado) {
      if (id !== null) falhou(await svc.from("asaas_eventos").update({ resultado: resultado.slice(0, 500) }).eq("id", id), "evento");
    },
    async ultimoEvento() {
      const r = await svc.from("asaas_eventos").select("evento, resultado, recebido_em").order("id", { ascending: false }).limit(1).maybeSingle();
      return (r.data as { evento: string; resultado: string | null; recebido_em: string } | null) ?? null;
    },
    async aplicarPagamento(evento, pagamento) {
      const r = await svc.rpc("aplicar_pagamento_asaas", { p_evento: evento, p_pagamento: pagamento });
      falhou(r, "aplicar_pagamento_asaas");
      return r.data;
    },
    async empresa(id) {
      const r = await svc.from("escritorios")
        .select("id, nome, cnpj, email, telefone, responsavel, status, mensalidade, origem, plano:planos(nome, preco_mensal)")
        .eq("id", id).maybeSingle();
      falhou(r, "empresa");
      if (!r.data) return null;
      const e = r.data as unknown as {
        id: string; nome: string; cnpj: string | null; email: string | null; telefone: string | null; responsavel: string | null;
        status: string; mensalidade: number | null; origem: string | null; plano: { nome: string; preco_mensal: number | null } | null;
      };
      const [cob, dono, sit, renova] = await Promise.all([
        svc.from("cobranca_empresas").select("asaas_cliente_id, asaas_assinatura_id, situacao, link_pagamento, valor, proximo_vencimento, ciclo")
          .eq("escritorio_id", id).maybeSingle(),
        svc.from("membros_escritorio").select("user_id").eq("escritorio_id", id).eq("papel", "dono").order("created_at").limit(1).maybeSingle(),
        svc.rpc("situacao_creditos", { p_escritorio: id }),
        svc.rpc("renovacao_periodo", { p_escritorio: id }),
      ]);
      let login: string | null = null;
      const donoId = (dono.data as { user_id: string } | null)?.user_id;
      if (donoId) login = (await svc.auth.admin.getUserById(donoId)).data.user?.email ?? null;
      const creditos = ((sit.data as { carteiras?: CarteiraDoPlano[] } | null)?.carteiras ?? []).map((c) => ({ nome: c.nome, por_mes: c.por_mes }));
      return {
        id: e.id, nome: e.nome, cnpj: e.cnpj, email: e.email, telefone: e.telefone, responsavel: e.responsavel, status: e.status,
        plano: e.plano?.nome ?? null,
        mensalidade: e.mensalidade ?? e.plano?.preco_mensal ?? null,
        login, creditos, origem: e.origem,
        renovacao: typeof renova.data === "string" ? renova.data : null,
        cobranca: (cob.data as EmpresaCobranca["cobranca"]) ?? null,
      };
    },
    async atualizarEmpresa(id, campos) {
      falhou(await svc.from("escritorios").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", id), "empresa");
    },
    async salvarCobranca(id, campos) {
      falhou(await svc.from("cobranca_empresas").upsert({ escritorio_id: id, ...campos, atualizado_em: new Date().toISOString() }), "cobrança");
    },
    async inserirPagamento(p) {
      falhou(await svc.from("pagamentos").upsert(p, { onConflict: "asaas_id", ignoreDuplicates: true }), "pagamento");
    },
    async atualizarPagamento(id, campos) {
      falhou(await svc.from("pagamentos").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", id), "pagamento");
    },
    async pagamentoDaCompra(creditoId) {
      const r = await svc.from("pagamentos").select("id, asaas_id, status, link").eq("credito_id", creditoId)
        .order("criado_em", { ascending: false }).limit(1).maybeSingle();
      return (r.data as { id: string; asaas_id: string | null; status: string; link: string | null } | null) ?? null;
    },
    async cancelarCompra(creditoId, pagamentoId, motivo) {
      await svc.from("creditos_extras").update({ status: "cancelado", resolvido_em: new Date().toISOString(), observacao: motivo.slice(0, 300) })
        .eq("id", creditoId).eq("status", "pendente");
      if (pagamentoId) await svc.from("pagamentos").update({ status: "CANCELADO", erro: motivo.slice(0, 300), atualizado_em: new Date().toISOString() }).eq("id", pagamentoId);
    },
    async pagamentosPendentes(escritorioId) {
      let q = svc.from("pagamentos").select("asaas_id, status").not("asaas_id", "is", null)
        .in("status", ["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"]).order("criado_em", { ascending: false }).limit(40);
      if (escritorioId) q = q.eq("escritorio_id", escritorioId);
      const r = await q;
      falhou(r, "pendentes");
      return (r.data ?? []) as { asaas_id: string; status: string }[];
    },
    async descricaoCredito(creditoId) {
      if (!creditoId) return null;
      const r = await svc.from("creditos_extras").select("descricao").eq("id", creditoId).maybeSingle();
      return (r.data as { descricao: string | null } | null)?.descricao ?? null;
    },
    async detalheCompra(creditoId) {
      if (!creditoId) return null;
      const r = await svc.from("pagamentos").select("automatica, valor").eq("credito_id", creditoId)
        .order("criado_em", { ascending: false }).limit(1).maybeSingle();
      const p = r.data as { automatica: boolean; valor: number | null } | null;
      return p ? { automatica: !!p.automatica, valor: p.valor === null ? null : Number(p.valor) } : null;
    },
    async cartao(escritorioId) {
      const r = await svc.from("cobranca_cartoes").select("*").eq("escritorio_id", escritorioId).maybeSingle();
      falhou(r, "cartão");
      return (r.data as CartaoSalvo | null) ?? null;
    },
    async salvarCartao(escritorioId, campos) {
      if (campos === null) {
        falhou(await svc.from("cobranca_cartoes").delete().eq("escritorio_id", escritorioId), "cartão");
        return;
      }
      // cartão novo (com o final) grava a linha inteira; o resto (recusa) só atualiza a que existe
      if ("final" in campos) falhou(await svc.from("cobranca_cartoes").upsert({ escritorio_id: escritorioId, ...campos }), "cartão");
      else falhou(await svc.from("cobranca_cartoes").update(campos).eq("escritorio_id", escritorioId), "cartão");
    },
    async recargasLigadas(escritorioId) {
      const r = await svc.from("recarga_automatica").select("tipo").eq("escritorio_id", escritorioId).eq("ativo", true);
      falhou(r, "recarga");
      return ((r.data ?? []) as { tipo: string }[]).map((x) => x.tipo);
    },
    async reservarRecarga(escritorioId, tipo, userId) {
      const r = await svc.rpc("reservar_recarga_automatica", { p_escritorio: escritorioId, p_tipo: tipo, p_user: userId });
      if (r.error) return { pode: false, motivo: `erro: ${r.error.message}` };
      return r.data as ReservaRecarga;
    },
    async atividade(escritorioId, acao, alvo, userId) {
      await svc.from("atividades").insert({ escritorio_id: escritorioId, user_id: userId, acao, alvo: alvo.slice(0, 200) });
    },
    // ---- autocadastro (0040)
    async planoParaVenda(id) {
      const r = await svc.from("planos").select("id, nome, preco_mensal, ativo, vende_no_site").eq("id", id).maybeSingle();
      falhou(r, "plano");
      return (r.data as PlanoAVenda | null) ?? null;
    },
    async documentoCadastrado(documento) {
      const r = await svc.from("escritorios").select("id").eq("cnpj", documento).limit(1);
      falhou(r, "empresa");
      return (r.data ?? []).length > 0;
    },
    async criarConta(email, senha, metadados) {
      // o mesmo do superadmin: e-mail já confirmado (a VPS não manda e-mail de confirmação)
      const { data, error } = await svc.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: metadados });
      if (error || !data.user) {
        const m = error?.message ?? "Não foi possível criar a conta";
        return { erro: m, duplicado: /already been registered|already registered|already exists/i.test(m) };
      }
      return { id: data.user.id };
    },
    async removerConta(userId) {
      await svc.auth.admin.deleteUser(userId);
    },
    async inserirEmpresa(campos) {
      const r = await svc.from("escritorios").insert(campos).select("id").single();
      if (r.error) throw Object.assign(new Error(`empresa: ${r.error.message}`), { codigo: r.error.code });
      return (r.data as { id: string }).id;
    },
    async inserirMembro(escritorioId, userId, nome) {
      falhou(await svc.from("membros_escritorio").insert({ escritorio_id: escritorioId, user_id: userId, papel: "dono", nome }), "membro");
    },
    async inserirConfigEmpresa(escritorioId, pares) {
      falhou(await svc.from("config_empresa").insert(Object.entries(pares).map(([key, value]) => ({ escritorio_id: escritorioId, key, value }))), "configurações");
    },
    async removerEmpresa(escritorioId) {
      falhou(await svc.from("escritorios").delete().eq("id", escritorioId), "empresa");
    },
  };
}

/** O IP de quem chamou (o 1º do X-Forwarded-For, que o proxy da VPS preenche). */
function ipDoPedido(req: Request): string | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip")?.trim() || "";
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

async function usuario(req: Request, svc: Svc): Promise<Usuario | null> {
  const cli = doUsuario(req);
  const { data: u } = await cli.auth.getUser();
  if (!u?.user) return null;
  const [{ data: sou }, { data: mem }] = await Promise.all([
    cli.rpc("sou_superadmin"),
    // auditoria 04/11/2026: membro desativado não compra nem dispara cobrança no cartão
    svc.from("membros_escritorio").select("escritorio_id, papel").eq("user_id", u.user.id).eq("ativo", true).maybeSingle(),
  ]);
  const membro = mem as { escritorio_id: string; papel: string } | null;
  return {
    id: u.user.id, email: u.user.email ?? null, superadmin: sou === true,
    escritorioId: membro?.escritorio_id ?? null,
    souDono: membro?.papel === "dono",
    ip: ipDoPedido(req),
    async pedirCreditos(tipo, quantidade) {
      const r = await cli.rpc("pedir_creditos", { p_tipo: tipo, p_quantidade: quantidade });
      if (r.error) throw new ErroUsuario(r.error.message);
      return r.data as PedidoCredito;
    },
    async cancelarPedido(creditoId) {
      const r = await cli.rpc("cancelar_pedido_credito", { p_id: creditoId });
      if (r.error) throw new ErroUsuario(r.error.message);
    },
    async compraMinha(creditoId) {
      const r = await cli.from("creditos_extras").select("id").eq("id", creditoId).maybeSingle();
      return !!r.data;
    },
  };
}

const hojeBrasil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
function tokenNovo(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método inválido" }, 405);
  try {
    const svc = servico();
    const deps: Deps = {
      banco: banco(svc), fetch, hoje: hojeBrasil, aleatorio: tokenNovo,
      limite: (chave, max, janelaS) => dentroDoLimite(svc, chave, max, janelaS),
    };
    const doAsaas = new URL(req.url).searchParams.get("origem") === "asaas" || req.headers.has("asaas-access-token");
    if (doAsaas) {
      const r = await tratarWebhook(deps, req.headers.get("asaas-access-token"), await lerTexto(req, 256 * 1024));
      return json(r.corpo, r.status);
    }
    const b = await lerJson(req, LIMITE_MB(1)).catch((e) => { if (e instanceof CorpoInvalido && e.status === 413) throw e; return {}; }) as Record<string, unknown>;
    // a página de cadastro (sem login): a função confere e limita tudo sozinha
    if (b.acao === "cadastro_criar") {
      const r = await tratarPublico(deps, ipDoPedido(req), b);
      return json(r.corpo, r.status);
    }
    const u = await usuario(req, svc);
    if (!u) return json({ erro: "Sessão inválida ou expirada. Entre de novo." }, 401);
    const r = await tratarAcao(deps, u, b);
    return json(r.corpo, r.status);
  } catch (err) {
    if (err instanceof CorpoInvalido) return json({ erro: err.message }, err.status);
    return json({ erro: String(err instanceof Error ? err.message : err) }, 500);
  }
});
