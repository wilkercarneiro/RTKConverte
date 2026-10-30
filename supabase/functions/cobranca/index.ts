// Edge Function cobranca: pagamentos pelo Asaas e avisos no WhatsApp
// (migração 0034). A lógica está em fluxos.ts; aqui só se liga o banco de
// verdade (service_role), o login de quem chama e o Deno.serve.
//
// verify_jwt DESLIGADO (o Asaas não manda JWT): na VPS, a função entra em
// FUNCTIONS_VERIFY_JWT_MAP com false, como a `gprol`. Quem chama:
//   - o Asaas, em POST …/functions/v1/cobranca?origem=asaas, com o token no
//     header asaas-access-token (configurado pelo próprio painel);
//   - o site, com o JWT da pessoa: as ações em fluxos.ts.
import { createClient } from "@supabase/supabase-js";
import { tratarAcao, tratarWebhook, ErroUsuario } from "./fluxos.ts";
import type { Banco, Deps, EmpresaCobranca, PedidoCredito, Usuario } from "./fluxos.ts";
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
        .select("id, nome, cnpj, email, telefone, responsavel, status, mensalidade, plano:planos(nome, preco_mensal)")
        .eq("id", id).maybeSingle();
      falhou(r, "empresa");
      if (!r.data) return null;
      const e = r.data as unknown as {
        id: string; nome: string; cnpj: string | null; email: string | null; telefone: string | null; responsavel: string | null;
        status: string; mensalidade: number | null; plano: { nome: string; preco_mensal: number | null } | null;
      };
      const [cob, dono, sit] = await Promise.all([
        svc.from("cobranca_empresas").select("asaas_cliente_id, asaas_assinatura_id, situacao, link_pagamento, valor, proximo_vencimento")
          .eq("escritorio_id", id).maybeSingle(),
        svc.from("membros_escritorio").select("user_id").eq("escritorio_id", id).eq("papel", "dono").order("created_at").limit(1).maybeSingle(),
        svc.rpc("situacao_creditos", { p_escritorio: id }),
      ]);
      let login: string | null = null;
      const donoId = (dono.data as { user_id: string } | null)?.user_id;
      if (donoId) login = (await svc.auth.admin.getUserById(donoId)).data.user?.email ?? null;
      const creditos = ((sit.data as { carteiras?: CarteiraDoPlano[] } | null)?.carteiras ?? []).map((c) => ({ nome: c.nome, por_mes: c.por_mes }));
      return {
        id: e.id, nome: e.nome, cnpj: e.cnpj, email: e.email, telefone: e.telefone, responsavel: e.responsavel, status: e.status,
        plano: e.plano?.nome ?? null,
        mensalidade: e.mensalidade ?? e.plano?.preco_mensal ?? null,
        login, creditos,
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
  };
}

async function usuario(req: Request, svc: Svc): Promise<Usuario | null> {
  const cli = doUsuario(req);
  const { data: u } = await cli.auth.getUser();
  if (!u?.user) return null;
  const [{ data: sou }, { data: mem }] = await Promise.all([
    cli.rpc("sou_superadmin"),
    svc.from("membros_escritorio").select("escritorio_id").eq("user_id", u.user.id).maybeSingle(),
  ]);
  return {
    id: u.user.id, email: u.user.email ?? null, superadmin: sou === true,
    escritorioId: (mem as { escritorio_id: string } | null)?.escritorio_id ?? null,
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
    const deps: Deps = { banco: banco(svc), fetch, hoje: hojeBrasil, aleatorio: tokenNovo };
    const doAsaas = new URL(req.url).searchParams.get("origem") === "asaas" || req.headers.has("asaas-access-token");
    if (doAsaas) {
      const r = await tratarWebhook(deps, req.headers.get("asaas-access-token"), await req.text());
      return json(r.corpo, r.status);
    }
    const u = await usuario(req, svc);
    if (!u) return json({ erro: "Sessão inválida ou expirada. Entre de novo." }, 401);
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const r = await tratarAcao(deps, u, b);
    return json(r.corpo, r.status);
  } catch (err) {
    return json({ erro: String(err instanceof Error ? err.message : err) }, 500);
  }
});
