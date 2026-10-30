// Textos que a cobrança manda no WhatsApp. Puros: a edge function `cobranca`
// envia, e o painel mostra o mesmo texto para copiar quando o WhatsApp não
// está configurado (tests/cobranca.test.mjs).

import { fmtReais } from "./precos.ts";

export interface CarteiraDoPlano { nome: string; por_mes: number | null }

const primeiroNome = (nome: string | null | undefined) => (nome ?? "").trim().split(/\s+/)[0] || "";
const ola = (nome: string | null | undefined) => (primeiroNome(nome) ? `Olá, ${primeiroNome(nome)}!` : "Olá!");

/** "dd/mm/aaaa" de uma data "aaaa-mm-dd" (sem passar por fuso). */
export function dataBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

/** "6 créditos gerais e 12 créditos de CAR por mês" (carteira sem limite: "créditos gerais sem limite"). */
export function textoCreditos(carteiras: CarteiraDoPlano[]): string {
  const partes = carteiras
    .filter((c) => c.por_mes === null || c.por_mes > 0)
    .map((c) => {
      const nome = c.nome.replace(/^Créditos\s+/i, "créditos ");
      return c.por_mes === null ? `${nome} sem limite` : `${c.por_mes} ${c.por_mes === 1 ? nome.replace(/^créditos/, "crédito").replace(/gerais$/, "geral") : nome}`;
    });
  if (!partes.length) return "";
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}`;
  return `${lista} por mês`;
}

/** Cobrança da mensalidade. Com `senha`, é a conta nova: leva os dados de acesso. */
export function mensagemCobranca(o: {
  responsavel: string | null; empresa: string; plano: string | null; valor: number; link: string;
  vencimento?: string | null; url: string; login?: string | null; senha?: string | null; creditos?: string;
}): string {
  const linhas = [ola(o.responsavel), ""];
  if (o.senha) {
    linhas.push(
      `A conta da ${o.empresa} no Vertces está criada${o.plano ? ` no plano ${o.plano}` : ""}${o.creditos ? ` (${o.creditos})` : ""}.`,
      `Para liberar o acesso, pague a primeira mensalidade de ${fmtReais(o.valor)}:`,
    );
  } else {
    linhas.push(`Segue a mensalidade do Vertces${o.plano ? ` (plano ${o.plano})` : ""} da ${o.empresa}: ${fmtReais(o.valor)}${o.vencimento ? `, vencimento ${dataBr(o.vencimento)}` : ""}.`);
  }
  linhas.push(o.link, "", "Dá para pagar por Pix, boleto ou cartão.");
  if (o.senha) {
    linhas.push(
      "Assim que o pagamento for confirmado, o acesso é liberado na hora e avisamos por aqui.",
      "",
      "Seus dados de acesso:",
      `Endereço: ${o.url}`,
      ...(o.login ? [`Login: ${o.login}`] : []),
      `Senha provisória: ${o.senha}`,
      "No primeiro acesso o sistema pede para você criar a sua senha.",
    );
  }
  return linhas.join("\n");
}

export function mensagemAcessoLiberado(o: { responsavel: string | null; empresa: string; url: string; login?: string | null; creditos?: string }): string {
  return [
    ola(o.responsavel),
    "",
    `Pagamento confirmado ✅ O acesso da ${o.empresa} ao Vertces está liberado.`,
    "",
    `Entre em ${o.url}${o.login ? ` com o login ${o.login}` : ""}.`,
    ...(o.creditos ? [`Seu plano inclui ${o.creditos}.`] : []),
  ].join("\n");
}

export function mensagemCreditosPagos(o: { responsavel: string | null; descricao: string; empresa: string }): string {
  return [
    ola(o.responsavel),
    "",
    `Pagamento confirmado ✅ ${o.descricao.charAt(0).toUpperCase()}${o.descricao.slice(1)} já estão na conta da ${o.empresa} no Vertces.`,
  ].join("\n");
}
