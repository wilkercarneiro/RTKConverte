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

/**
 * O nome da cobrança pelo período da assinatura (0040): "mensalidade",
 * "cobrança semestral" ou "anuidade". Sem período = mensalidade (como antes).
 */
export function nomeDaCobranca(ciclo?: string | null): string {
  return ciclo === "YEARLY" ? "anuidade" : ciclo === "SEMIANNUALLY" ? "cobrança semestral" : "mensalidade";
}

/** Cobrança da mensalidade. Com `senha`, é a conta nova: leva os dados de acesso. */
export function mensagemCobranca(o: {
  responsavel: string | null; empresa: string; plano: string | null; valor: number; link: string;
  vencimento?: string | null; url: string; login?: string | null; senha?: string | null; creditos?: string;
  /** a empresa já entra; o link é só da 1ª mensalidade */
  liberada?: boolean;
  /** período da assinatura (MONTHLY, SEMIANNUALLY, YEARLY) */
  ciclo?: string | null;
}): string {
  const nome = nomeDaCobranca(o.ciclo);
  const linhas = [ola(o.responsavel), ""];
  if (o.senha && o.liberada) {
    linhas.push(
      `A conta da ${o.empresa} no Vertces está criada${o.plano ? ` no plano ${o.plano}` : ""}${o.creditos ? ` (${o.creditos})` : ""} e o acesso já está liberado.`,
      `A primeira ${nome}, de ${fmtReais(o.valor)}${o.vencimento ? `, vence em ${dataBr(o.vencimento)}` : ""}:`,
    );
  } else if (o.senha) {
    linhas.push(
      `A conta da ${o.empresa} no Vertces está criada${o.plano ? ` no plano ${o.plano}` : ""}${o.creditos ? ` (${o.creditos})` : ""}.`,
      `Para liberar o acesso, pague a primeira ${nome} de ${fmtReais(o.valor)}:`,
    );
  } else {
    linhas.push(`Segue a ${nome} do Vertces${o.plano ? ` (plano ${o.plano})` : ""} da ${o.empresa}: ${fmtReais(o.valor)}${o.vencimento ? `, vencimento ${dataBr(o.vencimento)}` : ""}.`);
  }
  linhas.push(o.link, "", "Dá para pagar por Pix, boleto ou cartão.");
  if (o.senha) {
    linhas.push(
      o.liberada
        ? `Se preferir, cadastre o cartão de crédito no primeiro acesso: ele paga esta ${nome} e as próximas sozinho.`
        : "Assim que o pagamento for confirmado, o acesso é liberado na hora e avisamos por aqui. Também dá para pagar com o cartão de crédito direto no sistema, no primeiro acesso.",
      "",
      "Seus dados de acesso:",
      `Endereço: ${o.url}`,
      ...(o.login ? [`Login: ${o.login}`] : []),
      `Senha provisória: ${o.senha}`,
      "No primeiro acesso o sistema pede para você criar a sua senha e cadastrar o cartão para a cobrança automática.",
    );
  }
  return linhas.join("\n");
}

/**
 * 0049: a empresa gastou o 1º crédito e a mensalidade começou (vence no dia do
 * 1º crédito). Vai para o WhatsApp da empresa com o link da fatura.
 */
export function mensagemMensalidadeIniciada(o: {
  responsavel: string | null; empresa: string; plano: string | null; valor: number; link: string | null;
  vencimento: string; url: string; ciclo?: string | null;
  /** o dia do 1º crédito ("aaaa-mm-dd") */
  dia: string;
}): string {
  const nome = nomeDaCobranca(o.ciclo);
  return [
    ola(o.responsavel),
    "",
    `A ${o.empresa} usou o primeiro crédito no Vertces em ${dataBr(o.dia)}: a partir desse dia começa a contar a ${nome}${o.plano ? ` do plano ${o.plano}` : ""}, como combinado.`,
    `A primeira ${nome}, de ${fmtReais(o.valor)}, vence em ${dataBr(o.vencimento)}, um mês depois${o.link ? ". O link já fica aqui:" : "."}`,
    ...(o.link ? [o.link] : []),
    "",
    "Dá para pagar por Pix, boleto ou cartão. Se preferir, cadastre o cartão no sistema (Configurações → Plano e uso): ele paga esta e as próximas sozinho.",
    `As próximas vencem no mesmo dia, a cada ${o.ciclo === "YEARLY" ? "ano" : o.ciclo === "SEMIANNUALLY" ? "semestre" : "mês"}, e os créditos do plano renovam junto. ${o.url}`,
  ].join("\n");
}

/** 0049: conta criada pelo convite. A mensalidade só começa no 1º crédito gasto. */
export function mensagemCadastroConvite(o: {
  responsavel: string | null; empresa: string; plano: string; periodo: string; valor: number; url: string; login: string; creditos?: string;
}): string {
  return [
    ola(o.responsavel),
    "",
    `A conta da ${o.empresa} no Vertces está criada no plano ${o.plano}${o.creditos ? ` (${o.creditos})` : ""} e o acesso já está liberado.`,
    `Como combinado, você não paga nada agora: a ${o.periodo === "mensal" ? "mensalidade" : `cobrança ${o.periodo}`} (${fmtReais(o.valor)}) só começa a contar no dia em que você usar o primeiro crédito, e a primeira vence um mês depois desse dia.`,
    "",
    `Entre em ${o.url} com o login ${o.login} e a senha que você criou.`,
  ].join("\n");
}

/** 0049: aviso para o número do superadmin quando o convite vira conta. */
export function mensagemNovoConvite(o: {
  empresa: string; documento: string; responsavel: string; email: string; telefone: string; plano: string; periodo: string; valor: number; convite: string | null;
}): string {
  return [
    "Novo cadastro pelo convite do Vertces 🆕",
    "",
    `${o.empresa} (${o.documento})${o.convite ? ` · convite: ${o.convite}` : ""}`,
    `Responsável: ${o.responsavel} · ${o.telefone} · ${o.email}`,
    `Plano ${o.plano}, ${o.periodo}: ${fmtReais(o.valor)}`,
    "",
    "O acesso já está liberado; a cobrança começa no 1º crédito gasto.",
  ].join("\n");
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

export function mensagemAcessoSuspenso(o: {
  responsavel: string | null; empresa: string; valor: number | null; link: string | null; vencimento?: string | null; ciclo?: string | null;
}): string {
  const nome = nomeDaCobranca(o.ciclo);
  return [
    ola(o.responsavel),
    "",
    `A ${nome} do Vertces da ${o.empresa}${o.valor ? ` (${fmtReais(o.valor)})` : ""}${o.vencimento ? `, com vencimento em ${dataBr(o.vencimento)},` : ""} não foi paga e o acesso foi suspenso.`,
    ...(o.link ? ["", "Pague por Pix, boleto ou cartão para liberar na hora:", o.link] : []),
    "",
    "Os seus dados continuam guardados.",
  ].join("\n");
}

/** Autocadastro (0040): a conta nasceu e falta o pagamento. Vai para o WhatsApp de quem se cadastrou. */
export function mensagemCadastroCriado(o: {
  responsavel: string | null; empresa: string; plano: string; periodo: string; valor: number; url: string; login: string; parcelas: number;
  /** taxa de adesão (0044), somada só ao 1º pagamento */
  adesao?: number;
}): string {
  const adesao = o.adesao && o.adesao > 0
    ? ` O primeiro pagamento leva também a adesão de ${fmtReais(o.adesao)}, cobrada uma vez só: total de ${fmtReais(o.valor + o.adesao)}.`
    : "";
  return [
    ola(o.responsavel),
    "",
    `A conta da ${o.empresa} no Vertces está criada no plano ${o.plano} (${o.periodo}, ${fmtReais(o.valor)}).${adesao}`,
    `Falta só o pagamento para liberar o acesso: entre em ${o.url} com o login ${o.login} e pague por Pix${o.parcelas > 1 ? ` ou no cartão em até ${o.parcelas}x` : " ou cartão"}.`,
    "",
    "Assim que o pagamento confirmar, o acesso é liberado na hora e avisamos por aqui.",
  ].join("\n");
}

/** Autocadastro (0040): aviso para o número do superadmin (chave whatsapp_avisos). */
export function mensagemNovoCadastro(o: {
  empresa: string; documento: string; responsavel: string; email: string; telefone: string; plano: string; periodo: string; valor: number;
  adesao?: number;
}): string {
  return [
    "Novo cadastro pelo site do Vertces 🆕",
    "",
    `${o.empresa} (${o.documento})`,
    `Responsável: ${o.responsavel} · ${o.telefone} · ${o.email}`,
    `Plano ${o.plano}, ${o.periodo}: ${fmtReais(o.valor)}${o.adesao && o.adesao > 0 ? ` + adesão ${fmtReais(o.adesao)}` : ""}`,
    "",
    "A conta espera o pagamento (Pix ou cartão) para liberar o acesso.",
  ].join("\n");
}

/** O cartão não passou na análise de risco do Asaas (o acesso continua esperando o pagamento). */
export function mensagemPagamentoRecusado(o: { responsavel: string | null; empresa: string; url: string }): string {
  return [
    ola(o.responsavel),
    "",
    `O pagamento no cartão da ${o.empresa} não foi aprovado na análise do Asaas e não foi cobrado.`,
    "",
    `Entre em ${o.url} e pague por Pix ou com outro cartão para liberar o acesso.`,
  ].join("\n");
}

/** Para o superadmin: uma parcela de uma compra parcelada foi estornada ou contestada. */
export function mensagemEstornoParcela(o: { empresa: string; parcela: string; situacao: string }): string {
  return [
    "Atenção: estorno/contestação de parcela no Vertces",
    "",
    `${o.empresa}: ${o.parcela} ficou "${o.situacao}" no Asaas.`,
    "O acesso da empresa não mudou. Confira em Painel → Empresas → Cobrança e decida.",
  ].join("\n");
}

/** A compra automática não passou no cartão. */
export function mensagemRecargaRecusada(o: { responsavel: string | null; empresa: string; descricao: string; final?: string | null; motivo: string; url: string }): string {
  return [
    ola(o.responsavel),
    "",
    `Os créditos da ${o.empresa} acabaram, mas a compra automática (${o.descricao}) foi recusada no cartão${o.final ? ` final ${o.final}` : ""}: ${o.motivo}`,
    "",
    `Atualize o cartão ou compre os créditos por Pix em ${o.url} (Créditos).`,
  ].join("\n");
}

export function mensagemCreditosPagos(o: {
  responsavel: string | null; descricao: string; empresa: string; automatica?: boolean; final?: string | null; valor?: number | null;
}): string {
  if (o.automatica) {
    return [
      ola(o.responsavel),
      "",
      `Os créditos da ${o.empresa} acabaram e a compra automática repôs: ${o.descricao}${o.valor ? ` (${fmtReais(o.valor)})` : ""}, no cartão${o.final ? ` final ${o.final}` : ""} ✅`,
      "",
      "Para mudar a quantidade ou desligar: Créditos → Compra automática, no Vertces.",
    ].join("\n");
  }
  return [
    ola(o.responsavel),
    "",
    `Pagamento confirmado ✅ ${o.descricao.charAt(0).toUpperCase()}${o.descricao.slice(1)} já estão na conta da ${o.empresa} no Vertces.`,
  ].join("\n");
}
