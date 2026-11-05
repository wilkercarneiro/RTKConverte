// CNPJ, CPF, telefone e e-mail do cadastro de empresa. Usado pelo painel do
// superadmin e pelo autocadastro (validação na hora) e pelas edge functions
// `superadmin` e `cobranca` (que não confiam no que a tela mandou). Sem
// dependências: roda no Node, Deno e navegador.

export const soDigitos = (s: string): string => (s ?? "").replace(/\D/g, "");

/** CPF com os dois dígitos verificadores certos. Aceita com ou sem máscara. */
export function cpfValido(entrada: string): boolean {
  const d = soDigitos(entrada);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** CPF (11 dígitos) ou CNPJ (14), com o dígito certo: o documento de quem assina o Vertces. */
export function documentoValido(entrada: string): boolean {
  const d = soDigitos(entrada);
  return d.length === 11 ? cpfValido(d) : cnpjValido(d);
}

/** 52998224725 → 529.982.247-25 (parcial enquanto digita). */
export function formatarCpf(entrada: string): string {
  const d = soDigitos(entrada).slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2");
}

/** Até 11 dígitos é CPF; daí em diante, CNPJ. */
export const formatarDocumento = (entrada: string): string =>
  (soDigitos(entrada).length > 11 ? formatarCnpj(entrada) : formatarCpf(entrada));

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
  // o Auth guarda a senha com bcrypt, que só lê os primeiros 72 bytes
  if (new TextEncoder().encode(s).length > 72) return "A senha pode ter no máximo 72 caracteres.";
  return null;
}

/** O que a pessoa digita no autocadastro (a tela e a função `cobranca` conferem igual). */
export interface DadosDoCadastro {
  empresa: string; documento: string; responsavel: string; email: string; telefone: string; senha: string; aceite_termos: boolean;
}

/** Problemas campo a campo (vazio = pode criar a conta). */
export function problemasDoCadastro(f: DadosDoCadastro): Record<string, string> {
  const p: Record<string, string> = {};
  const empresa = (f.empresa ?? "").trim();
  const responsavel = (f.responsavel ?? "").trim();
  if (empresa.length < 2 || empresa.length > 120) p.empresa = "Informe o nome da empresa (ou o seu, se trabalha por conta própria).";
  if (!documentoValido(f.documento)) p.documento = "CPF ou CNPJ inválido (confira os dígitos).";
  if (responsavel.length < 2 || responsavel.length > 120) p.responsavel = "Informe o nome do responsável.";
  if (!emailValido(f.email) || (f.email ?? "").trim().length > 254) p.email = "E-mail inválido.";
  if (!telefoneValido(f.telefone)) p.telefone = "WhatsApp com DDD.";
  const senha = problemaDaSenha(f.senha);
  if (senha) p.senha = senha;
  if (f.aceite_termos !== true) p.aceite_termos = "Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.";
  return p;
}
