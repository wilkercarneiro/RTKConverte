// Envia os templates oficiais para o bucket `templates` via Edge Function
// admin-setup. Requer: SUPABASE_URL, SUPABASE_ANON_KEY, SETUP_SECRET no env.
import { readFileSync } from "node:fs";

const URL_BASE = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SECRET = process.env.SETUP_SECRET;
if (!URL_BASE || !SECRET) { console.error("Defina SUPABASE_URL e SETUP_SECRET"); process.exit(1); }

async function enviar(nome, caminho) {
  const corpo = readFileSync(new URL(caminho, import.meta.url));
  const resp = await fetch(`${URL_BASE}/functions/v1/admin-setup`, {
    method: "POST",
    headers: {
      "x-template-name": nome,
      "x-setup-secret": SECRET,
      ...(ANON ? { apikey: ANON, Authorization: `Bearer ${ANON}` } : {}),
      "Content-Type": "application/octet-stream",
    },
    body: corpo,
  });
  const texto = await resp.text();
  console.log(nome, "→", resp.status, texto);
  if (!resp.ok) process.exit(1);
}

await enviar("planta-template.ods", "../reference/PLANTA.ODS");
await enviar("memorial-template.docx", "../reference/memorial-template.docx");
