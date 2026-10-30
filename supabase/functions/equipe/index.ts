// Edge Function equipe: o que a página Equipe de uma empresa faz e a RLS não
// deixa o navegador fazer — criar a conta de um funcionário, gerar senha nova,
// apagar a conta.
//
// Quem chama precisa de `equipe.gerenciar` na própria empresa (conferido com o
// cliente do próprio usuário: pode_adicionar_membro / tem_permissao leem o
// auth.uid() do JWT). O resto usa a service_role.
//
// Ações (POST { acao, ... }):
//   criar            { email, nome, cargo, descricao?, telefone?, permissoes[],
//                      senha?, trocar? } → conta nova. Sem `senha`, o sistema
//                    sorteia uma; com `senha`, vale a que o gestor escolheu.
//                    `trocar` (padrão true) obriga a pessoa a criar a própria
//                    senha no primeiro acesso. A senha volta UMA vez, para passar.
//   redefinir_senha  { user_id, senha?, trocar? } → senha nova (sorteada ou a escolhida)
//   remover          { user_id } → apaga a conta (não o dono, não a si mesmo)
//
// Permissão de gerenciar a equipe só o dono concede (o banco também confere).
import { createClient } from "@supabase/supabase-js";
import { emailValido } from "../_shared/cnpj.ts";

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

const VALIDAS = new Set(["servicos.criar", "servicos.excluir", "clientes.editar", "clientes.excluir",
  "documentos.gerar", "cadastros.editar", "empresa.configurar", "equipe.gerenciar"]);

/** Senha escolhida pelo gestor: 8+ caracteres, com letra e número. Devolve o motivo da recusa. */
export function senhaFraca(s: string): string | null {
  if (s.length < 8) return "A senha precisa ter pelo menos 8 caracteres.";
  if (s.length > 72) return "A senha pode ter no máximo 72 caracteres.";
  if (!/[A-Za-zÀ-ÿ]/.test(s) || !/\d/.test(s)) return "A senha precisa ter letras e números.";
  return null;
}

/** `senha` do corpo: a escolhida (validada) ou uma sorteada. */
function senhaDoPedido(b: Record<string, unknown>): { senha: string; erro?: string } {
  const escolhida = typeof b.senha === "string" ? b.senha : "";
  if (!escolhida) return { senha: senhaProvisoria() };
  const erro = senhaFraca(escolhida);
  return erro ? { senha: "", erro } : { senha: escolhida };
}

/** Senha provisória legível: sem 0/O/1/l/I, com letras e números (12 caracteres). */
export function senhaProvisoria(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const todos = letras + numeros;
  const b = crypto.getRandomValues(new Uint32Array(12));
  const s = Array.from(b, (x) => todos[x % todos.length]);
  s[0] = letras[b[0] % letras.length];
  s[11] = numeros[b[11] % numeros.length];
  return s.join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método inválido" }, 405);
  try {
    const cli = doUsuario(req);
    const { data: u } = await cli.auth.getUser();
    if (!u?.user) return json({ erro: "Sessão inválida ou expirada. Entre de novo." }, 401);
    const eu = u.user.id;
    const b = await req.json() as Record<string, unknown>;
    const svc = admin();

    // empresa de quem chama, e se pode gerenciar a equipe
    const { data: pode, error: ePode } = await cli.rpc("pode_adicionar_membro");
    if (ePode) return json({ erro: "Não foi possível conferir a sua permissão." }, 500);
    const p = pode as { ok: boolean; motivo?: string; escritorio_id?: string; sou_dono?: boolean };
    const { data: gerencia } = await cli.rpc("tem_permissao", { p: "equipe.gerenciar" });
    if (gerencia !== true) return json({ erro: "Você não tem permissão para gerenciar a equipe." }, 403);
    const { data: meu } = await svc.from("membros_escritorio").select("escritorio_id, papel").eq("user_id", eu).maybeSingle();
    const escId = (meu as { escritorio_id: string } | null)?.escritorio_id;
    if (!escId) return json({ erro: "Sua conta não está ligada a uma empresa." }, 403);
    const souDono = (meu as { papel: string }).papel === "dono";

    const registrar = (acao: string, alvo: string) =>
      svc.from("atividades").insert({ escritorio_id: escId, user_id: eu, acao, alvo });

    // o alvo precisa ser da MESMA empresa (e nunca o dono)
    async function alvoDaEquipe(userId: string) {
      const { data } = await svc.from("membros_escritorio").select("user_id, papel, nome, escritorio_id")
        .eq("user_id", userId).maybeSingle();
      const m = data as { user_id: string; papel: string; nome: string | null; escritorio_id: string } | null;
      if (!m || m.escritorio_id !== escId) return null;
      return m;
    }

    switch (b.acao) {
      case "criar": {
        if (!p.ok) return json({ erro: p.motivo ?? "Não é possível adicionar agora." }, 403);
        const email = String(b.email ?? "").trim().toLowerCase();
        const nome = String(b.nome ?? "").trim();
        const cargo = String(b.cargo ?? "").trim();
        const descricao = String(b.descricao ?? "").trim().slice(0, 500);
        const telefone = String(b.telefone ?? "").trim().slice(0, 30);
        const trocar = b.trocar !== false;
        let permissoes = (Array.isArray(b.permissoes) ? b.permissoes : []).map(String).filter((x) => VALIDAS.has(x));
        if (!souDono) permissoes = permissoes.filter((x) => x !== "equipe.gerenciar");
        if (!emailValido(email)) return json({ erro: "E-mail inválido." }, 400);
        if (nome.length < 2) return json({ erro: "Informe o nome da pessoa." }, 400);

        const { senha, erro: eSenha } = senhaDoPedido(b);
        if (eSenha) return json({ erro: eSenha }, 400);
        const { data: criado, error } = await svc.auth.admin.createUser({
          email, password: senha, email_confirm: true, user_metadata: { nome },
        });
        if (error || !criado.user) {
          const msg = /already|registered|exists/i.test(error?.message ?? "")
            ? "Já existe uma conta com este e-mail no Vertces. Use outro e-mail."
            : (error?.message ?? "Não foi possível criar a conta.");
          return json({ erro: msg }, 409);
        }
        const novo = criado.user.id;
        const { error: eMem } = await svc.from("membros_escritorio").insert({
          escritorio_id: escId, user_id: novo, papel: "membro", nome, cargo: cargo || null, permissoes,
          descricao: descricao || null, telefone: telefone || null,
        });
        if (eMem) {
          await svc.auth.admin.deleteUser(novo);
          const msg = /limite|permite/i.test(eMem.message) ? eMem.message : `Não foi possível adicionar: ${eMem.message}`;
          return json({ erro: msg }, 409);
        }
        if (trocar) await svc.from("senhas_provisorias").insert({ user_id: novo });
        await registrar("membro.adicionado", nome);
        return json({ ok: true, user_id: novo, login: email, senha, trocar });
      }

      case "redefinir_senha": {
        const m = await alvoDaEquipe(String(b.user_id ?? ""));
        if (!m) return json({ erro: "Pessoa não encontrada na sua equipe." }, 404);
        if (m.papel === "dono" && m.user_id !== eu) return json({ erro: "A senha do dono só ele mesmo troca." }, 403);
        const { senha, erro: eSenha } = senhaDoPedido(b);
        if (eSenha) return json({ erro: eSenha }, 400);
        const trocar = b.trocar !== false;
        const { data: au } = await svc.auth.admin.getUserById(m.user_id);
        const { error } = await svc.auth.admin.updateUserById(m.user_id, { password: senha });
        if (error) return json({ erro: error.message }, 400);
        if (trocar) await svc.from("senhas_provisorias").upsert({ user_id: m.user_id, definida_em: new Date().toISOString() });
        else await svc.from("senhas_provisorias").delete().eq("user_id", m.user_id);
        await registrar("membro.senha", m.nome ?? au?.user?.email ?? "");
        return json({ ok: true, login: au?.user?.email ?? "", senha, trocar });
      }

      case "remover": {
        const m = await alvoDaEquipe(String(b.user_id ?? ""));
        if (!m) return json({ erro: "Pessoa não encontrada na sua equipe." }, 404);
        if (m.papel === "dono") return json({ erro: "O dono não pode ser removido." }, 403);
        if (m.user_id === eu) return json({ erro: "Você não pode remover a si mesmo." }, 403);
        const { data: sa } = await svc.from("super_admins").select("user_id").eq("user_id", m.user_id).maybeSingle();
        const { data: au } = await svc.auth.admin.getUserById(m.user_id);
        if (sa) {
          // conta de administrador do sistema: só sai da equipe
          await svc.from("membros_escritorio").delete().eq("user_id", m.user_id).eq("escritorio_id", escId);
        } else {
          const { error } = await svc.auth.admin.deleteUser(m.user_id);
          if (error) return json({ erro: error.message }, 400);
        }
        await registrar("membro.removido", m.nome ?? au?.user?.email ?? "");
        return json({ ok: true });
      }

      default:
        return json({ erro: "Ação desconhecida" }, 400);
    }
  } catch (err) {
    return json({ erro: String(err instanceof Error ? err.message : err) }, 500);
  }
});
