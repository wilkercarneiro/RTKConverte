// Edge Function superadmin: o que o painel do SaaS faz e a RLS não deixa o
// navegador fazer — criar conta no Auth e mexer em senha.
//
// Só quem está em `super_admins` passa (conferido com o cliente do próprio
// usuário: a RPC sou_superadmin lê o auth.uid() do JWT da chamada). O resto usa
// a service_role.
//
// Ações (POST { acao, ... }):
//   criar_empresa      { cnpj, nome, responsavel, telefone, email, senha, plano_id? }
//                      → empresa + conta de login (e-mail da empresa, senha padrão)
//                        como dona, marcada para trocar a senha no 1º acesso
//   adicionar_usuario  { escritorio_id, email, senha, papel? }
//   redefinir_senha    { user_id, senha }   → volta a ser provisória
//   remover_usuario    { user_id }          → apaga a conta do Auth
//
// Se um passo da criação falha, o que já foi criado é desfeito.
import { createClient } from "@supabase/supabase-js";
import {
  cnpjValido, emailValido, problemaDaSenha, soDigitos, telefoneValido,
} from "../_shared/cnpj.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, status = 200) =>
  new Response(JSON.stringify(d), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = () => createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const doUsuario = (req: Request) => createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, {
  global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  auth: { persistSession: false, autoRefreshToken: false },
});

type Svc = ReturnType<typeof admin>;

/** Mensagem do Auth em português para os casos que o painel encontra. */
function erroAuth(msg: string): string {
  if (/already been registered|already registered|already exists/i.test(msg)) return "Já existe uma conta com este e-mail.";
  if (/password/i.test(msg)) return `Senha recusada pelo servidor: ${msg}`;
  return msg;
}

async function criarConta(svc: Svc, email: string, senha: string, nome?: string): Promise<{ id: string } | { erro: string }> {
  const { data, error } = await svc.auth.admin.createUser({
    email, password: senha, email_confirm: true,
    user_metadata: nome ? { nome } : {},
  });
  if (error || !data.user) return { erro: erroAuth(error?.message ?? "Não foi possível criar a conta") };
  return { id: data.user.id };
}

async function criarEmpresa(svc: Svc, b: Record<string, unknown>) {
  const cnpj = soDigitos(String(b.cnpj ?? ""));
  const nome = String(b.nome ?? "").trim();
  const responsavel = String(b.responsavel ?? "").trim();
  const telefone = soDigitos(String(b.telefone ?? ""));
  const email = String(b.email ?? "").trim().toLowerCase();
  const senha = String(b.senha ?? "");
  const planoId = b.plano_id ? String(b.plano_id) : null;

  if (!cnpjValido(cnpj)) return json({ erro: "CNPJ inválido." }, 400);
  if (nome.length < 2) return json({ erro: "Informe o nome da empresa." }, 400);
  if (responsavel.length < 2) return json({ erro: "Informe o nome do responsável." }, 400);
  if (!telefoneValido(telefone)) return json({ erro: "Telefone inválido: use DDD + número." }, 400);
  if (!emailValido(email)) return json({ erro: "E-mail inválido." }, 400);
  const pSenha = problemaDaSenha(senha);
  if (pSenha) return json({ erro: pSenha }, 400);

  const { data: existe } = await svc.from("escritorios").select("id, nome").eq("cnpj", cnpj).maybeSingle();
  if (existe) return json({ erro: `Este CNPJ já está cadastrado (${(existe as { nome: string }).nome}).` }, 409);

  const conta = await criarConta(svc, email, senha, responsavel);
  if ("erro" in conta) return json({ erro: conta.erro }, 409);

  const { data: esc, error: eEsc } = await svc.from("escritorios").insert({
    nome, cnpj, responsavel, telefone, email, plano_id: planoId, status: "ativo",
  }).select("id").single();
  if (eEsc || !esc) {
    await svc.auth.admin.deleteUser(conta.id);
    return json({ erro: `Não foi possível criar a empresa: ${eEsc?.message ?? "erro desconhecido"}` }, 500);
  }
  const escId = (esc as { id: string }).id;
  const { error: eMem } = await svc.from("membros_escritorio").insert({ escritorio_id: escId, user_id: conta.id, papel: "dono" });
  const { error: eProv } = eMem ? { error: null } : await svc.from("senhas_provisorias").insert({ user_id: conta.id });
  // a razão social e o CNPJ também vão para Configurações (memorial e planta leem de lá)
  const { error: eCfg } = eMem || eProv ? { error: null } : await svc.from("config_empresa").insert([
    { escritorio_id: escId, key: "razao_social", value: nome },
    { escritorio_id: escId, key: "cnpj", value: cnpj },
  ]);
  if (eMem || eProv || eCfg) {
    await svc.from("escritorios").delete().eq("id", escId);
    await svc.auth.admin.deleteUser(conta.id);
    return json({ erro: `Não foi possível concluir o cadastro: ${(eMem ?? eProv ?? eCfg)!.message}` }, 500);
  }
  return json({ ok: true, escritorio_id: escId, user_id: conta.id, login: email });
}

async function adicionarUsuario(svc: Svc, b: Record<string, unknown>) {
  const escId = String(b.escritorio_id ?? "");
  const email = String(b.email ?? "").trim().toLowerCase();
  const senha = String(b.senha ?? "");
  const papel = b.papel === "dono" ? "dono" : "membro";
  if (!emailValido(email)) return json({ erro: "E-mail inválido." }, 400);
  const pSenha = problemaDaSenha(senha);
  if (pSenha) return json({ erro: pSenha }, 400);
  const { data: esc } = await svc.from("escritorios").select("id").eq("id", escId).maybeSingle();
  if (!esc) return json({ erro: "Empresa não encontrada." }, 404);

  const conta = await criarConta(svc, email, senha);
  if ("erro" in conta) return json({ erro: conta.erro }, 409);
  const { error } = await svc.from("membros_escritorio").insert({ escritorio_id: escId, user_id: conta.id, papel });
  if (error) {
    await svc.auth.admin.deleteUser(conta.id);
    return json({ erro: error.message }, 500);
  }
  await svc.from("senhas_provisorias").insert({ user_id: conta.id });
  return json({ ok: true, user_id: conta.id, login: email });
}

async function redefinirSenha(svc: Svc, b: Record<string, unknown>) {
  const userId = String(b.user_id ?? "");
  const senha = String(b.senha ?? "");
  const pSenha = problemaDaSenha(senha);
  if (pSenha) return json({ erro: pSenha }, 400);
  const { error } = await svc.auth.admin.updateUserById(userId, { password: senha });
  if (error) return json({ erro: erroAuth(error.message) }, 400);
  await svc.from("senhas_provisorias").upsert({ user_id: userId, definida_em: new Date().toISOString() });
  return json({ ok: true });
}

async function removerUsuario(svc: Svc, b: Record<string, unknown>, quem: string) {
  const userId = String(b.user_id ?? "");
  if (userId === quem) return json({ erro: "Você não pode remover a sua própria conta por aqui." }, 400);
  const { data: sa } = await svc.from("super_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (sa) return json({ erro: "Esta conta é de um administrador do sistema." }, 400);
  const { error } = await svc.auth.admin.deleteUser(userId);
  if (error) return json({ erro: error.message }, 400);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método inválido" }, 405);
  try {
    const cli = doUsuario(req);
    const { data: u } = await cli.auth.getUser();
    if (!u?.user) return json({ erro: "Sessão inválida ou expirada. Entre de novo." }, 401);
    const { data: sou, error: eSou } = await cli.rpc("sou_superadmin");
    if (eSou || sou !== true) return json({ erro: "Acesso restrito ao administrador do sistema." }, 403);

    const b = await req.json() as Record<string, unknown>;
    const svc = admin();
    switch (b.acao) {
      case "criar_empresa": return await criarEmpresa(svc, b);
      case "adicionar_usuario": return await adicionarUsuario(svc, b);
      case "redefinir_senha": return await redefinirSenha(svc, b);
      case "remover_usuario": return await removerUsuario(svc, b, u.user.id);
      default: return json({ erro: "Ação desconhecida" }, 400);
    }
  } catch (err) {
    return json({ erro: String(err instanceof Error ? err.message : err) }, 500);
  }
});
