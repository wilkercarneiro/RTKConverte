// Chaves de publicação lidas do ambiente (Vercel → Settings → Environment
// Variables; local: .env). Nenhuma é segredo: vão para o navegador.
//
// O cadastro self-service (VITE_CADASTRO_ABERTO + auth.signUp) saiu em
// 05/11/2026: o signup do Auth está desligado desde a auditoria de 04/11 e quem
// cria a conta agora é o autocadastro com pagamento (#/assinar, migração 0040),
// aberto e fechado pelo superadmin em Configurações → Autocadastro.

/** Canal oficial de suporte exibido em "Ajuda" (vazio = não mostra). */
export const SUPORTE_EMAIL = (import.meta.env.VITE_SUPORTE_EMAIL as string | undefined)?.trim() ?? "";
/** WhatsApp com DDI+DDD, só dígitos (ex.: 5571999999999). */
export const SUPORTE_WHATSAPP = ((import.meta.env.VITE_SUPORTE_WHATSAPP as string | undefined) ?? "").replace(/\D/g, "");
/** Horário/prazo de resposta combinado (ex.: "dias úteis, 8h–18h; resposta em até 4h úteis"). */
export const SUPORTE_PRAZO = (import.meta.env.VITE_SUPORTE_PRAZO as string | undefined)?.trim() ?? "";

/**
 * Versão dos termos aceita no cadastro (gravada em aceites_termos). Troque ao
 * publicar texto novo. Enquanto terminar em "-minuta" (texto ainda sem revisão
 * jurídica), as páginas #/termos e #/privacidade abrem para revisão, mas não
 * são linkadas na entrada nem na Ajuda.
 */
export const VERSAO_TERMOS = "2026-10-08-minuta";
export const TERMOS_PUBLICADOS = !VERSAO_TERMOS.endsWith("-minuta");
