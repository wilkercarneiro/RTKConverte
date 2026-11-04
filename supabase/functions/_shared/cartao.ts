// O cartão de crédito como a tela pede e a função `cobranca` confere, antes de
// ir ao Asaas. Sem Deno nem DOM: a tela importa daqui para validar enquanto a
// pessoa digita, e a função confere de novo (o navegador não é confiável).
//
// Nada daqui grava o número: a função manda ao Asaas e guarda só bandeira,
// final e validade (e o token, quando o Asaas libera a tokenização).
import { cnpjValido, emailValido, soDigitos, telefoneValido } from "./cnpj.ts";

export interface CartaoDigitado {
  numero: string; nome: string;
  /** "MM/AA" ou "MM/AAAA" */
  validade: string;
  cvv: string;
}
export interface TitularDigitado {
  nome: string; cpf_cnpj: string; email: string; telefone: string; cep: string; numero_endereco: string;
}

/** Os objetos que o Asaas pede (creditCard + creditCardHolderInfo). */
export interface CartaoAsaas { holderName: string; number: string; expiryMonth: string; expiryYear: string; ccv: string }
export interface TitularAsaas {
  name: string; email: string; cpfCnpj: string; postalCode: string; addressNumber: string; phone: string; mobilePhone: string;
}

/** Dígito verificador do cartão (Luhn). */
export function luhnValido(numero: string): boolean {
  const d = soDigitos(numero);
  if (d.length < 13 || d.length > 19) return false;
  let soma = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    soma += n;
  }
  return soma % 10 === 0;
}

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

const cpfOuCnpj = (s: string) => (soDigitos(s).length === 11 ? cpfValido(s) : cnpjValido(s));

/** Bandeira pelo começo do número (só para mostrar; quem decide é o Asaas). */
export function bandeiraDoNumero(numero: string): string | null {
  const d = soDigitos(numero);
  if (/^4/.test(d)) return "Visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return "Mastercard";
  if (/^3[47]/.test(d)) return "Amex";
  if (/^(4011|4312|4389|4514|4576|5041|5066|5067|509|6277|6362|6363|650|6516|6550)/.test(d)) return "Elo";
  if (/^(606282|3841)/.test(d)) return "Hipercard";
  if (/^3(0[0-5]|[68])/.test(d)) return "Diners";
  return null;
}

/** "4111 1111 1111 1111" enquanto digita. */
export function formatarNumeroCartao(entrada: string): string {
  return soDigitos(entrada).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ");
}
export function formatarValidade(entrada: string): string {
  const d = soDigitos(entrada).slice(0, 6);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
}
export function formatarCep(entrada: string): string {
  const d = soDigitos(entrada).slice(0, 8);
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`;
}

/** {mes, ano(4)} da validade, ou null. `hoje` = "aaaa-mm-dd". */
export function lerValidade(v: string, hoje: string): { mes: string; ano: string } | null {
  const m = /^(\d{2})\s*\/?\s*(\d{2}|\d{4})$/.exec((v ?? "").trim());
  if (!m) return null;
  const mes = Number(m[1]);
  const ano = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  const [ha, hm] = hoje.split("-").map(Number);
  if (ano < ha || (ano === ha && mes < hm) || ano > ha + 20) return null;
  return { mes: String(mes).padStart(2, "0"), ano: String(ano) };
}

/** Problemas campo a campo (vazio = pode enviar). */
export function problemasDoCartao(c: CartaoDigitado, t: TitularDigitado, hoje: string): Record<string, string> {
  const p: Record<string, string> = {};
  if (!luhnValido(c.numero)) p.numero = "Número do cartão inválido.";
  if ((c.nome ?? "").trim().length < 3) p.nome = "Escreva o nome como está no cartão.";
  if (!lerValidade(c.validade, hoje)) p.validade = "Validade inválida ou vencida (MM/AA).";
  const cvv = soDigitos(c.cvv);
  if (cvv.length < 3 || cvv.length > 4) p.cvv = "Código de segurança inválido.";
  if ((t.nome ?? "").trim().length < 3) p.titular_nome = "Informe o nome do titular.";
  if (!cpfOuCnpj(t.cpf_cnpj)) p.cpf_cnpj = "CPF ou CNPJ do titular inválido.";
  if (!emailValido(t.email)) p.email = "E-mail inválido.";
  if (!telefoneValido(t.telefone)) p.telefone = "Telefone com DDD.";
  if (soDigitos(t.cep).length !== 8) p.cep = "CEP com 8 dígitos.";
  if (!(t.numero_endereco ?? "").trim()) p.numero_endereco = "Número do endereço (ou S/N).";
  return p;
}

/** Os objetos do Asaas, a partir do que foi digitado (já validado). */
export function paraAsaas(c: CartaoDigitado, t: TitularDigitado, hoje: string): { creditCard: CartaoAsaas; creditCardHolderInfo: TitularAsaas } {
  const v = lerValidade(c.validade, hoje)!;
  const tel = soDigitos(t.telefone);
  return {
    creditCard: { holderName: c.nome.trim().toUpperCase(), number: soDigitos(c.numero), expiryMonth: v.mes, expiryYear: v.ano, ccv: soDigitos(c.cvv) },
    creditCardHolderInfo: {
      name: t.nome.trim(), email: t.email.trim(), cpfCnpj: soDigitos(t.cpf_cnpj), postalCode: soDigitos(t.cep),
      addressNumber: t.numero_endereco.trim(), phone: tel, mobilePhone: tel,
    },
  };
}
