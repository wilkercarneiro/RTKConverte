// Edge Function admin-setup: ferramenta de deploy para gravar os templates
// oficiais no bucket privado `templates`. Protegida por segredo armazenado na
// tabela `config_setup` (RLS sem políticas → legível apenas via service role).
// Aceita SOMENTE os dois nomes fixos de template.
import { createClient } from "@supabase/supabase-js";
import { dentroDoLimite } from "../_shared/limite.ts";

/** Compara sem atalho de tempo (não revela quantos caracteres batem). */
function mesmo(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return dif === 0;
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PERMITIDOS: Record<string, string> = {
  "planta-template.ods": "application/vnd.oasis.opendocument.spreadsheet",
  "memorial-template.docx": DOCX,
  "pecas/1-memorial-descritivo.docx": DOCX,
  "pecas/2-memorial-tabular.docx": DOCX,
  "pecas/3-cartas-anuencia.docx": DOCX,
  "pecas/4-declaracao-tecnico.docx": DOCX,
  "pecas/5-declaracao-proprietario.docx": DOCX,
  "pecas/6-requerimento.docx": DOCX,
  "pecas/7-declaracao-faixa-dominio.docx": DOCX,
  "pecas-posse/1-memorial-descritivo.docx": DOCX,
  "pecas-posse/2-memorial-tabular.docx": DOCX,
  "pecas-posse/3-cartas-anuencia.docx": DOCX,
  "pecas-posse/4-declaracao-faixa-dominio.docx": DOCX,
};

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("método inválido", { status: 405 });
    const nome = req.headers.get("x-template-name") ?? "";
    const segredo = req.headers.get("x-setup-secret") ?? "";
    const contentType = PERMITIDOS[nome];
    if (!contentType) return new Response("template não permitido", { status: 400 });

    const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // auditoria 04/11/2026: no máximo 60 chamadas por hora (os 13 modelos cabem;
    // adivinhar o segredo fica inviável) e comparação em tempo constante
    if (!(await dentroDoLimite(supa, "admin-setup", 60, 3600))) return new Response("muitas tentativas", { status: 429 });
    const { data: cfg } = await supa.from("config_setup").select("value").eq("key", "setup_secret").single();
    if (!cfg || !segredo || !mesmo(String(cfg.value), segredo)) return new Response("não autorizado", { status: 401 });

    const corpo = new Uint8Array(await req.arrayBuffer());
    if (corpo.length === 0 || corpo.length > 10_000_000) return new Response("corpo inválido", { status: 400 });
    const up = await supa.storage.from("templates").upload(nome, corpo, { upsert: true, contentType });
    if (up.error) throw up.error;
    return new Response(JSON.stringify({ ok: true, nome, bytes: corpo.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ erro: String(err) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
