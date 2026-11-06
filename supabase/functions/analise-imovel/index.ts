// Edge Function analise-imovel (Consultar imóvel, #/consulta). Duas ações:
//
//   { acao: "focos", caixa: [o, s, l, n], desde: "AAAA-MM-DD" }
//     Ponte para os focos de queimada do INPE (o WFS do TerraBrasilis não
//     libera CORS). Só hosts da lista fixa (logica.ts: HOSTS_PONTE); a tela
//     manda caixa e data, nunca URL. Exige login; 30 consultas/min por pessoa.
//
//   { acao: "laudo", analise_id: uuid, refazer?: boolean }
//     O parecer técnico pela IA (OpenAI, a mesma chave do ler-arquivo), SÓ com
//     os dados gravados na consulta (analises_imovel.resultado). A linha é lida
//     com o cliente DO USUÁRIO (RLS: só a da própria empresa); o laudo é gravado
//     pela service_role. Limite: 20 laudos por empresa em 24 h (contados na
//     própria tabela), e no máximo 4 por minuto. A empresa que desligou a IA
//     (escritorios.leitura_ia = false) não recebe laudo. Não gasta crédito.
import { createClient } from "@supabase/supabase-js";
import { ehRecusa, escritorioDoUsuario, exigirUsuario } from "../_shared/acesso.ts";
import type { ClienteUsuario } from "../_shared/acesso.ts";
import { CorpoInvalido, dentroDoLimite, LIMITE_MB, lerJson, MUITAS_CHAMADAS } from "../_shared/limite.ts";
import { buscarFocos, escreverLaudo, LIMITE_LAUDOS_DIA, MODELO_LAUDO_PADRAO, validarCaixa, validarDesde } from "./logica.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const clienteDoUsuario = (req: Request) =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Use POST" }, 405);
  try {
    const corpo = await lerJson(req, LIMITE_MB(1));
    const usuario = clienteDoUsuario(req);
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ---------------------------------------------------------------- focos
    if (corpo?.acao === "focos") {
      const u = await exigirUsuario(usuario as unknown as ClienteUsuario);
      if (ehRecusa(u)) return json({ erro: u.erro }, u.status);
      if (!(await dentroDoLimite(svc, `focos:${u.userId}`, 30, 60))) return json({ erro: MUITAS_CHAMADAS.erro }, MUITAS_CHAMADAS.status);
      let caixa, desde;
      try { caixa = validarCaixa(corpo.caixa); desde = validarDesde(corpo.desde); } catch (e) { return json({ erro: (e as Error).message }, 400); }
      try {
        const r = await buscarFocos(caixa, desde, fetch);
        return json({ ...r, desde, fonte: "INPE — BDQueimadas (TerraBrasilis)" });
      } catch (e) {
        return json({ erro: `Focos de queimada: ${(e as Error).message}` }, 502);
      }
    }

    // ---------------------------------------------------------------- laudo
    if (corpo?.acao === "laudo") {
      const acesso = await escritorioDoUsuario(usuario as unknown as ClienteUsuario);
      if (ehRecusa(acesso)) return json({ erro: acesso.erro }, acesso.status);
      const esc = acesso.escritorioId;
      if (!esc) return json({ erro: "O laudo é só para contas ligadas a uma empresa." }, 403);
      const id = typeof corpo.analise_id === "string" && /^[0-9a-f-]{36}$/i.test(corpo.analise_id) ? corpo.analise_id : null;
      if (!id) return json({ erro: "Consulta não informada." }, 400);

      // RLS: a consulta tem de ser da empresa de quem chama
      const { data: linha, error: eLinha } = await usuario.from("analises_imovel")
        .select("id, escritorio_id, resultado, laudo, laudo_modelo, laudo_em").eq("id", id).maybeSingle();
      if (eLinha || !linha) return json({ erro: "Consulta não encontrada." }, 404);
      if (linha.laudo && corpo.refazer !== true) {
        return json({ laudo: linha.laudo, modelo: linha.laudo_modelo, quando: linha.laudo_em, guardado: true });
      }

      const chave = Deno.env.get("OPENAI_API_KEY");
      if (!chave) return json({ erro: "A IA não está configurada no servidor." }, 503);
      const { data: empresa } = await svc.from("escritorios").select("leitura_ia").eq("id", esc).maybeSingle();
      if (empresa && empresa.leitura_ia === false) return json({ erro: "A IA está desligada nas configurações da empresa." }, 403);

      const limite = Number(Deno.env.get("LAUDOS_LIMITE_DIARIO") ?? LIMITE_LAUDOS_DIA);
      const { count } = await svc.from("analises_imovel").select("id", { count: "exact", head: true })
        .eq("escritorio_id", esc).gte("laudo_em", new Date(Date.now() - 864e5).toISOString());
      if ((count ?? 0) >= limite) return json({ erro: `A empresa já usou os ${limite} laudos de hoje. O limite renova em 24 horas.` }, 429);
      if (!(await dentroDoLimite(svc, `laudo:${esc}`, 4, 60))) return json({ erro: MUITAS_CHAMADAS.erro }, MUITAS_CHAMADAS.status);

      const u = await exigirUsuario(usuario as unknown as ClienteUsuario);
      const autor = ehRecusa(u) ? null : u.userId;
      let r;
      try {
        r = await escreverLaudo({ apiKey: chave, modelo: Deno.env.get("OPENAI_MODELO_LAUDO") ?? MODELO_LAUDO_PADRAO, timeoutMs: 100_000 }, linha.resultado);
      } catch (e) {
        await svc.from("chamadas_ia").insert({
          escritorio_id: esc, user_id: autor, nome_arquivo: "laudo:consulta-imovel", modelo: Deno.env.get("OPENAI_MODELO_LAUDO") ?? MODELO_LAUDO_PADRAO,
          tentativa: 1, tokens_entrada: 0, tokens_saida: 0, custo_usd: null, aprovada: false, motivo: String((e as Error).message).slice(0, 2000), ms: 0,
        }).then(() => {}, () => {});
        return json({ erro: `Não foi possível escrever o laudo agora: ${(e as Error).message}` }, 502);
      }
      const quando = new Date().toISOString();
      const { error: eGrava } = await svc.from("analises_imovel")
        .update({ laudo: r.texto, laudo_modelo: r.modelo, laudo_em: quando, laudo_custo_usd: r.custoUsd })
        .eq("id", id).eq("escritorio_id", esc);
      if (eGrava) return json({ erro: "O laudo foi escrito, mas não deu para gravar. Tente de novo." }, 500);
      await svc.from("chamadas_ia").insert({
        escritorio_id: esc, user_id: autor, nome_arquivo: "laudo:consulta-imovel", modelo: r.modelo, tentativa: 1,
        tokens_entrada: r.tokensEntrada, tokens_saida: r.tokensSaida, custo_usd: r.custoUsd, aprovada: true, motivo: "laudo", ms: r.ms,
      }).then(() => {}, () => {});
      return json({ laudo: r.texto, modelo: r.modelo, quando, restantes: Math.max(0, limite - (count ?? 0) - 1) });
    }

    return json({ erro: "Ação desconhecida." }, 400);
  } catch (err) {
    if (err instanceof CorpoInvalido) return json({ erro: err.message }, err.status);
    console.error("analise-imovel:", err);
    return json({ erro: err instanceof Error ? err.message : String(err) }, 400);
  }
});
