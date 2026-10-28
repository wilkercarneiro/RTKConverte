// CNPJ, telefone e e-mail do cadastro de empresa. Usado pelo painel do
// superadmin (validação na hora) e pela edge function `superadmin` (que não
// confia no que a tela mandou). Sem dependências: roda no Node, Deno e navegador.

export const soDigitos = (s: string): string => (s ?? "").replace(/\D/g, "");

/** CNPJ com os dois dígitos verificadores certos. Aceita com ou sem máscara. */
export function cnpjValido(entrada: string): boolean {
  const c = soDigitos(entrada);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string): number => {
    let pesos = base.length - 7;
    let soma = 0;
    for (const ch of base) {
      soma += Number(ch) * pesos--;
      if (pesos < 2) pesos = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(c.slice(0, 12));
  const d2 = dv(c.slice(0, 12) + d1);
  return c.endsWith(`${d1}${d2}`);
}

/** 12345678000190 → 12.345.678/0001-90 (parcial enquanto digita). */
export function formatarCnpj(entrada: string): string {
  const c = soDigitos(entrada).slice(0, 14);
  return c
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/** Telefone brasileiro com DDD: 10 ou 11 dígitos (sem o 55). */
export function telefoneValido(entrada: string): boolean {
  const t = soDigitos(entrada).replace(/^55(?=\d{10,11}$)/, "");
  return t.length === 10 || t.length === 11;
}

/** 71999990000 → (71) 99999-0000 */
export function formatarTelefone(entrada: string): string {
  const t = soDigitos(entrada).replace(/^55(?=\d{10,11}$)/, "").slice(0, 11);
  if (t.length <= 2) return t ? `(${t}` : "";
  if (t.length <= 6) return `(${t.slice(0, 2)}) ${t.slice(2)}`;
  if (t.length <= 10) return `(${t.slice(0, 2)}) ${t.slice(2, 6)}-${t.slice(6)}`;
  return `(${t.slice(0, 2)}) ${t.slice(2, 7)}-${t.slice(7)}`;
}

export const emailValido = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((e ?? "").trim());

/** Senha aceita pelo sistema: 8+ caracteres, com letra e número. */
export function problemaDaSenha(s: string): string | null {
  if ((s ?? "").length < 8) return "A senha precisa de pelo menos 8 caracteres.";
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return "Use letras e números na senha.";
  return null;
}
