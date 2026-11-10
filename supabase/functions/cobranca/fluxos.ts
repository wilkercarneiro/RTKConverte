// O que a edge function `cobranca` faz, sem Deno nem supabase-js: o banco, o
// usuário e o fetch entram por parâmetro (index.ts liga os de verdade;
// tests/cobranca.test.mjs liga falsos e roda os fluxos inteiros).
//
// Webhook do Asaas (sem login; vale o token do header asaas-access-token):
//   registra o evento (o mesmo id duas vezes = ignora), aplica a cobrança no
//   banco (aplicar_pagamento_asaas) e avisa no WhatsApp quando a empresa ativou,
//   foi suspensa (mensalidade vencida) ou os créditos entraram. Responde 200 até para erro interno: o Asaas
//   interrompe a fila depois de falhas seguidas, e a conferência pega o resto.
//
// Ações com login (POST { acao, ... }):
//   empresa:    comprar_creditos { tipo, quantidade } · pix { credito_id }
//               cancelar_compra { credito_id } · conferir
//               pagar_cadastro { forma: pix|cartao, ciclo, parcelas?, cartao?, titular? }
//                 (o dono da empresa do autocadastro paga o 1º período; 0040)
//               iniciar_mensalidade { escritorio_id? (só superadmin) }
//                 (0049: gastou o 1º crédito, a assinatura nasce no Asaas)
//   superadmin: config_status · config_salvar · whatsapp_testar { telefone }
//               cobrar_empresa { escritorio_id, enviar_whatsapp?, login?, senha? }
//               atualizar_assinatura · cancelar_assinatura · conferir { escritorio_id? }
//               autocadastro_salvar { cadastro_aberto, parcelas_sem_juros, parcelas_max, juros_mes, ciclos, whatsapp_avisos? }
//
// Ação pública (sem login): cadastro_criar, em cadastro.ts.
//
// Período da assinatura (0040): a empresa paga por mês, semestre ou ano
// (cobranca_empresas.ciclo); a assinatura no Asaas tem esse ciclo e o valor do
// período (_shared/parcelas.ts). A empresa criada no painel continua mensal.

import { ambienteValido, clienteAsaas, cobrancaPaga, ErroAsaas, EVENTOS_WEBHOOK, garantirWebhook } from "../_shared/asaas.ts";
import type { AssinaturaAsaas, CartaoParaAsaas, ClienteAsaas, CobrancaAsaas } from "../_shared/asaas.ts";
import { bandeiraDoNumero, lerValidade, paraAsaas, problemasDoCartao } from "../_shared/cartao.ts";
import type { CartaoDigitado, TitularDigitado } from "../_shared/cartao.ts";
import { soDigitos, telefoneValido } from "../_shared/cnpj.ts";
import { enviarWhatsApp, estadoWhatsApp, qrcodeWhatsApp, whatsappConfigurado } from "../_shared/whatsapp.ts";
import type { ConfigWhatsApp } from "../_shared/whatsapp.ts";
import {
  dataBr, mensagemAcessoLiberado, mensagemAcessoSuspenso, mensagemCobranca, mensagemCreditosPagos, mensagemEstornoParcela,
  mensagemMensalidadeIniciada, mensagemPagamentoRecusado, mensagemRecargaRecusada, nomeDaCobranca, textoCreditos,
} from "../_shared/mensagens_cobranca.ts";
import { fmtReais } from "../_shared/precos.ts";
import type { CarteiraDoPlano } from "../_shared/mensagens_cobranca.ts";
import {
  cicloDe, configDasRegras, descricaoDaCompra, escolherParcelas, maxParcelas, MESES, NOME_CICLO, normalizarRegras,
  parcelamento, problemaDasRegras, regrasDe, somarMeses, totalComAdesao, valorDoPeriodo,
} from "../_shared/parcelas.ts";
import type { Ciclo, Parcelamento, RegrasPagamento } from "../_shared/parcelas.ts";
import { MUITAS_CHAMADAS } from "../_shared/limite.ts";

export const URL_APP_PADRAO = "https://vertces.com.br/app/";

/** Erro que é culpa do pedido (vira 400 com a mensagem). */
export class ErroUsuario extends Error {
  status: number;
  constructor(mensagem: string, status = 400) {
    super(mensagem);
    this.status = status;
  }
}

export interface EmpresaCobranca {
  id: string; nome: string; cnpj: string | null; email: string | null; telefone: string | null; responsavel: string | null;
  status: string; plano: string | null;
  /** a que vale: a da empresa, senão a do plano */
  mensalidade: number | null;
  /** e-mail do dono (o login) */
  login: string | null;
  creditos: CarteiraDoPlano[];
  /** quando os créditos do plano renovam ("aaaa-mm-dd"): a 1ª mensalidade no cartão de quem já usa */
  renovacao?: string | null;
  /** 'painel' (criada pelo superadmin) ou 'site' (autocadastro, 0040) */
  origem?: string | null;
  cobranca: {
    asaas_cliente_id: string | null; asaas_assinatura_id: string | null; situacao: string;
    link_pagamento: string | null; valor: number | null; proximo_vencimento: string | null;
    /** período da assinatura (0040); ausente = mensal */
    ciclo?: string | null;
    /** 0049: a mensalidade só começa no 1º crédito gasto (cliente escolhido pela equipe) */
    inicio_no_primeiro_credito?: boolean | null;
    /** quando o 1º crédito foi gasto (o gatilho do banco grava) */
    primeiro_credito_em?: string | null;
    /** quando a cobrança foi criada no Asaas (null = ainda não) */
    mensalidade_iniciada_em?: string | null;
  } | null;
}

/** A empresa ainda espera o 1º crédito (0049): nada a cobrar, nem cartão a cadastrar. */
export const esperaPrimeiroCredito = (e: EmpresaCobranca | null | undefined): boolean =>
  !!e?.cobranca?.inicio_no_primeiro_credito && !e.cobranca.mensalidade_iniciada_em;

export interface ResultadoPagamento {
  acao: string; escritorio_id?: string; credito_id?: string | null;
  /** 0040: compra parcelada paga sem assinatura — criar a dos períodos seguintes */
  criar_assinatura?: boolean; ciclo?: string | null; proximo_vencimento?: string | null;
}

/** O plano como o autocadastro confere (0040). */
export interface PlanoAVenda { id: string; nome: string; preco_mensal: number | null; ativo: boolean; vende_no_site: boolean }

export interface Banco {
  config(): Promise<Record<string, string>>;
  /** null apaga a chave */
  gravarConfig(pares: Record<string, string | null>): Promise<void>;
  /** trocou a conta ou o ambiente do Asaas: os clientes de lá não valem mais */
  esquecerClientesAsaas(): Promise<void>;
  registrarEvento(e: { evento_id: string | null; evento: string; pagamento_asaas_id: string | null; corpo: unknown; resultado?: string }):
    Promise<{ repetido: boolean; id: number | null }>;
  resultadoEvento(id: number | null, resultado: string): Promise<void>;
  ultimoEvento(): Promise<{ evento: string; resultado: string | null; recebido_em: string } | null>;
  aplicarPagamento(evento: string, pagamento: unknown): Promise<ResultadoPagamento>;
  empresa(id: string): Promise<EmpresaCobranca | null>;
  atualizarEmpresa(id: string, campos: { dia_renovacao?: number }): Promise<void>;
  salvarCobranca(id: string, campos: Record<string, unknown>): Promise<void>;
  inserirPagamento(p: Record<string, unknown>): Promise<void>;
  atualizarPagamento(id: string, campos: Record<string, unknown>): Promise<void>;
  pagamentoDaCompra(creditoId: string): Promise<{ id: string; asaas_id: string | null; status: string; link: string | null } | null>;
  cancelarCompra(creditoId: string, pagamentoId: string | null, motivo: string): Promise<void>;
  pagamentosPendentes(escritorioId: string | null): Promise<{ asaas_id: string; status: string; forma?: string | null }[]>;
  descricaoCredito(creditoId: string | null | undefined): Promise<string | null>;
  /** a compra foi da recarga automática? (a mensagem do WhatsApp muda) */
  detalheCompra(creditoId: string | null | undefined): Promise<{ automatica: boolean; valor: number | null } | null>;
  cartao(escritorioId: string): Promise<CartaoSalvo | null>;
  /** null apaga o cartão */
  salvarCartao(escritorioId: string, campos: Partial<CartaoSalvo> | null): Promise<void>;
  /** carteiras com a compra automática ligada */
  recargasLigadas(escritorioId: string): Promise<string[]>;
  reservarRecarga(escritorioId: string, tipo: string, userId: string | null): Promise<ReservaRecarga>;
  atividade(escritorioId: string, acao: string, alvo: string, userId: string | null): Promise<void>;
  // ---- autocadastro (0040, cadastro.ts): a conta e a empresa nascem pela service_role
  planoParaVenda(planoId: string): Promise<PlanoAVenda | null>;
  /** já existe empresa com este CPF/CNPJ (só dígitos)? */
  documentoCadastrado(documento: string): Promise<boolean>;
  /** conta no Auth já confirmada (a VPS não manda e-mail); duplicado = o e-mail já tem conta */
  criarConta(email: string, senha: string, metadados: Record<string, string>): Promise<{ id: string } | { erro: string; duplicado: boolean }>;
  removerConta(userId: string): Promise<void>;
  /** devolve o id; CPF/CNPJ repetido (corrida) lança erro com codigo "23505" */
  inserirEmpresa(campos: Record<string, unknown>): Promise<string>;
  inserirMembro(escritorioId: string, userId: string, nome: string): Promise<void>;
  inserirConfigEmpresa(escritorioId: string, pares: Record<string, string>): Promise<void>;
  /** apaga a empresa (membros, configurações e cobrança vão junto) */
  removerEmpresa(escritorioId: string): Promise<void>;
  /**
   * Cadastro do site com este CPF/CNPJ ou e-mail que nunca pagou e tem mais de
   * `horas` horas: pode dar lugar a um cadastro novo (senão quem digitou o
   * documento ou o e-mail de outra pessoa o prenderia para sempre).
   */
  cadastrosAbandonados?(documento: string, email: string, horas: number): Promise<{ escritorioId: string; contas: string[] }[]>;
  /**
   * O Pix avulso do 1º pagamento com adesão (0044) ainda em aberto: pagamentos
   * 'mensalidade' com adesão, no Pix, PENDING/OVERDUE.
   */
  comprasAvulsasAbertas?(escritorioId: string): Promise<{ id: string; asaas_id: string; valor: number; ciclo: string | null; link: string | null }[]>;
  // ---- mensalidade no 1º crédito (0049)
  /** empresas que gastaram o 1º crédito e ainda não têm a cobrança no Asaas */
  mensalidadesAIniciar?(): Promise<string[]>;
  /** reserva o convite de cadastro (uso único); null = não vale (usado, cancelado, vencido, inexistente) */
  reservarConvite?(token: string): Promise<{ id: string; plano_id: string; nome: string | null } | null>;
  /** a conta não foi criada: o convite volta a valer */
  devolverConvite?(id: string): Promise<void>;
  /** o convite virou esta empresa */
  concluirConvite?(id: string, escritorioId: string): Promise<void>;
}

export interface CartaoSalvo {
  asaas_token: string | null; bandeira: string | null; final: string | null; validade: string | null; titular: string | null;
  cadastrado_por?: string | null; cadastrado_em?: string; recusa_em: string | null; recusa_motivo: string | null;
}

export type ReservaRecarga =
  | ({ pode: true } & PedidoCredito)
  | { pode: false; motivo: string; recusa_motivo?: string | null; limite?: number; gasto?: number };

export interface PedidoCredito {
  credito_id: string; pagamento_id: string | null; escritorio_id: string; online: boolean;
  quantidade: number; unitario: number; valor: number; descricao: string;
}

export interface Usuario {
  id: string; email: string | null; superadmin: boolean;
  /** a empresa da pessoa, mesmo esperando pagamento */
  escritorioId: string | null;
  /** dono da empresa (só ele mexe no cartão) */
  souDono?: boolean;
  /** IP do navegador (o Asaas pede o do pagador, não o do servidor) */
  ip?: string | null;
  pedirCreditos(tipo: string, quantidade: number): Promise<PedidoCredito>;
  cancelarPedido(creditoId: string): Promise<void>;
  /** a compra é da empresa da pessoa (a RLS diz) */
  compraMinha(creditoId: string): Promise<boolean>;
}

export interface Deps {
  banco: Banco;
  fetch: typeof fetch;
  /** "aaaa-mm-dd" no Brasil */
  hoje: () => string;
  /** token novo do webhook */
  aleatorio: () => string;
  /** trava de frequência (auditoria 04/11/2026); ausente = sem trava */
  limite?: (chave: string, max: number, janelaS: number) => Promise<boolean>;
}

export interface Resposta { status: number; corpo: Record<string, unknown> }
const ok = (corpo: Record<string, unknown> = {}): Resposta => ({ status: 200, corpo: { ok: true, ...corpo } });
const falha = (status: number, erro: string): Resposta => ({ status, corpo: { erro } });
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function somarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/** Comparação sem atalho (o tempo não diz quantos caracteres bateram). */
export function mesmoToken(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

export function asaasDe(cfg: Record<string, string>, f: typeof fetch): ClienteAsaas | null {
  if (!cfg.asaas_api_key) return null;
  return clienteAsaas(cfg.asaas_api_key, ambienteValido(cfg.asaas_ambiente) ? cfg.asaas_ambiente : "sandbox", f);
}
export function zapDe(cfg: Record<string, string>): ConfigWhatsApp | null {
  const c = { url: cfg.whatsapp_url, chave: cfg.whatsapp_chave, instancia: cfg.whatsapp_instancia };
  return whatsappConfigurado(c) ? c : null;
}
export const urlApp = (cfg: Record<string, string>) => cfg.url_app || URL_APP_PADRAO;

/**
 * O período e o valor da assinatura da empresa (0040). Mensal = a mensalidade
 * (como sempre foi); semestral e anual = mensalidade × meses com o desconto que
 * vale hoje em Configurações → Autocadastro.
 */
export function cobrancaDaEmpresa(cfg: Record<string, string>, e: EmpresaCobranca): { ciclo: Ciclo; valor: number; mensalidade: number } {
  const ciclo = cicloDe(e.cobranca?.ciclo) ?? "MONTHLY";
  const mensalidade = Number(e.mensalidade ?? 0);
  const valor = ciclo === "MONTHLY" ? mensalidade : valorDoPeriodo(mensalidade, ciclo, regrasDe(cfg).ciclos[ciclo].desconto);
  return { ciclo, valor, mensalidade };
}

/** "Vertces: plano X" (+ o período, se não for mensal): a descrição da assinatura no Asaas. */
function descricaoAssinatura(e: EmpresaCobranca, ciclo: Ciclo): string {
  const base = e.plano ? `Vertces: plano ${e.plano}` : "Vertces: mensalidade";
  return ciclo === "MONTHLY" ? base : `${base} (${NOME_CICLO[ciclo].toLowerCase()})`;
}

/** O WhatsApp do superadmin que recebe os avisos (chave whatsapp_avisos), se houver. */
async function avisarSuperadmin(d: Deps, cfg: Record<string, string>, texto: string): Promise<void> {
  const zap = zapDe(cfg);
  if (!zap || !cfg.whatsapp_avisos) return;
  await enviarWhatsApp(zap, cfg.whatsapp_avisos, texto, d.fetch).catch(() => null);
}

// =========================================================================== webhook

export async function tratarWebhook(d: Deps, token: string | null, texto: string): Promise<Resposta> {
  const cfg = await d.banco.config();
  let corpo: { id?: string; event?: string; payment?: CobrancaAsaas } | null = null;
  try { corpo = JSON.parse(texto); } catch { /* corpo inválido */ }
  if (!cfg.asaas_webhook_token || !mesmoToken(token ?? "", cfg.asaas_webhook_token)) {
    // a recusa deixa rastro: sem isto, um token trocado só aparece quando o Asaas desliga a fila.
    // Auditoria 04/11/2026: no máximo 30 rastros por hora — sem teto, qualquer um enchia a tabela
    if (d.limite && !(await d.limite("webhook-asaas-falha", 30, 3600))) return falha(401, "Token do webhook inválido.");
    await d.banco.registrarEvento({
      evento_id: null, evento: "AUTH_FAILED", pagamento_asaas_id: corpo?.payment?.id ?? null,
      corpo: corpo ?? { texto: texto.slice(0, 2000) }, resultado: "token inválido",
    }).catch(() => {});
    return falha(401, "Token do webhook inválido.");
  }
  const evento = typeof corpo?.event === "string" ? corpo.event : null;
  if (!corpo || !evento) return ok({ ignorado: "sem evento" });
  const reg = await d.banco.registrarEvento({
    evento_id: corpo.id ?? null, evento, pagamento_asaas_id: corpo.payment?.id ?? null, corpo,
  });
  if (reg.repetido) return ok({ repetido: true });
  if (!evento.startsWith("PAYMENT_") || !corpo.payment?.id) {
    await d.banco.resultadoEvento(reg.id, "ignorado");
    return ok({ ignorado: evento });
  }
  try {
    const r = await aplicarEAvisar(d, cfg, evento, corpo.payment);
    await d.banco.resultadoEvento(reg.id, r.acao + (r.aviso ? ` · ${r.aviso}` : ""));
    return ok({ acao: r.acao });
  } catch (e) {
    await d.banco.resultadoEvento(reg.id, `erro: ${msg(e)}`).catch(() => {});
    return ok({ erro_interno: msg(e) });
  }
}

/**
 * Aplica a cobrança e manda o WhatsApp do que mudou para a empresa. Compra
 * parcelada paga pela 1ª vez (o banco devolve criar_assinatura, uma vez só):
 * cria a assinatura dos períodos seguintes antes de avisar.
 */
async function aplicarEAvisar(d: Deps, cfg: Record<string, string>, evento: string, pagamento: CobrancaAsaas):
  Promise<ResultadoPagamento & { aviso?: string; assinatura?: string | null }> {
  const r: ResultadoPagamento & { aviso?: string; assinatura?: string | null } = await d.banco.aplicarPagamento(evento, pagamento);
  const avisos: string[] = [];
  if (r.criar_assinatura && r.escritorio_id) {
    try {
      r.assinatura = await criarAssinaturaDoPeriodo(d, cfg, r.escritorio_id, r.proximo_vencimento ?? null);
      if (r.assinatura) avisos.push(`assinatura ${r.assinatura} criada`);
    } catch (e) {
      // o período está pago e a empresa ativa: falta só a cobrança do próximo; o superadmin resolve
      avisos.push(`assinatura do próximo período NÃO criada: ${msg(e)}`);
      const emp = await d.banco.empresa(r.escritorio_id).catch(() => null);
      await avisarSuperadmin(d, cfg, `Vertces: a ${emp?.nome ?? "empresa"} pagou o período parcelado, mas a assinatura dos períodos seguintes não foi criada no Asaas (${msg(e)}). Gere a cobrança em Painel → Empresas → Cobrança.`);
    }
  }
  const comAvisos = (extra?: string) => {
    const tudo = [...avisos, ...(extra ? [extra] : [])];
    return tudo.length ? { ...r, aviso: tudo.join(" · ") } : r;
  };
  const zap = zapDe(cfg);
  if (r.acao === "estorno_parcela" && r.escritorio_id) {
    const emp = await d.banco.empresa(r.escritorio_id).catch(() => null);
    await avisarSuperadmin(d, cfg, mensagemEstornoParcela({
      empresa: emp?.nome ?? r.escritorio_id,
      parcela: pagamento.installmentNumber ? `a parcela ${pagamento.installmentNumber} (cobrança ${pagamento.id})` : `a parcela da cobrança ${pagamento.id}`,
      situacao: pagamento.status,
    }));
    return comAvisos();
  }
  const avisaEmpresa = r.acao === "ativou" || r.acao === "creditos" || r.acao === "suspendeu" || (r.acao === "recusado" && evento === "PAYMENT_REPROVED_BY_RISK_ANALYSIS");
  if (!zap || !r.escritorio_id || !avisaEmpresa) return comAvisos();
  const e = await d.banco.empresa(r.escritorio_id);
  if (!e?.telefone) return comAvisos("sem telefone para o WhatsApp");
  // a recusa só interessa a quem ainda está esperando para entrar
  if (r.acao === "recusado" && e.status !== "aguardando_pagamento") return comAvisos();
  const texto = r.acao === "ativou"
    ? mensagemAcessoLiberado({ responsavel: e.responsavel, empresa: e.nome, url: urlApp(cfg), login: e.login, creditos: textoCreditos(e.creditos) })
    : r.acao === "suspendeu"
      ? mensagemAcessoSuspenso({
        responsavel: e.responsavel, empresa: e.nome, valor: pagamento.value ?? e.cobranca?.valor ?? e.mensalidade,
        link: pagamento.invoiceUrl ?? e.cobranca?.link_pagamento ?? null, vencimento: pagamento.dueDate || e.cobranca?.proximo_vencimento,
        ciclo: e.cobranca?.ciclo,
      })
      : r.acao === "recusado"
        ? mensagemPagamentoRecusado({ responsavel: e.responsavel, empresa: e.nome, url: urlApp(cfg) })
        : await textoCreditosPagos(d, e, r.credito_id);
  const env = await enviarWhatsApp(zap, e.telefone, texto, d.fetch);
  return comAvisos(env.ok ? "WhatsApp enviado" : `WhatsApp: ${env.erro}`);
}

/**
 * A assinatura dos períodos seguintes de quem pagou o 1º período parcelado
 * (0040): boleto/Pix/cartão na fatura (UNDEFINED), no ciclo da empresa, vencendo
 * quando o período pago acaba. Sem cobrança em dobro: o 1º período foi a compra.
 */
async function criarAssinaturaDoPeriodo(d: Deps, cfg: Record<string, string>, escritorioId: string, vencimento: string | null): Promise<string | null> {
  const asaas = asaasDe(cfg, d.fetch);
  if (!asaas) throw new Error("o Asaas não está configurado");
  const e = await d.banco.empresa(escritorioId);
  if (!e) throw new Error("empresa não encontrada");
  // já tem (outra chamada criou): não cria outra
  if (e.cobranca?.asaas_assinatura_id && e.cobranca.situacao !== "cancelada") return null;
  const { ciclo, valor } = cobrancaDaEmpresa(cfg, e);
  if (!(valor > 0)) throw new Error("a empresa está sem mensalidade");
  const proximo = vencimento ?? e.cobranca?.proximo_vencimento ?? somarMeses(d.hoje(), MESES[ciclo]);
  const cliente = await garantirCliente(d, asaas, e.id);
  const sub = await asaas.criarAssinatura({
    customer: cliente, billingType: "UNDEFINED", value: valor, nextDueDate: proximo, cycle: ciclo,
    description: descricaoAssinatura(e, ciclo), externalReference: e.id,
  });
  await d.banco.salvarCobranca(e.id, { asaas_assinatura_id: sub.id, valor, ciclo, proximo_vencimento: proximo });
  return sub.id;
}

async function textoCreditosPagos(d: Deps, e: EmpresaCobranca, creditoId: string | null | undefined): Promise<string> {
  const descricao = (await d.banco.descricaoCredito(creditoId)) ?? "os créditos";
  const det = await d.banco.detalheCompra(creditoId).catch(() => null);
  const cartao = det?.automatica ? await d.banco.cartao(e.id).catch(() => null) : null;
  return mensagemCreditosPagos({
    responsavel: e.responsavel, empresa: e.nome, descricao, automatica: !!det?.automatica, final: cartao?.final ?? null, valor: det?.valor ?? null,
  });
}

// =========================================================================== ações

export async function tratarAcao(d: Deps, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  try {
    const cfg = await d.banco.config();
    const superadmin = (f: () => Promise<Resposta>) => (u.superadmin ? f() : Promise.resolve(falha(403, "Acesso restrito ao administrador do sistema.")));
    switch (b.acao) {
      case "comprar_creditos": return await comprarCreditos(d, cfg, u, b);
      case "cartao_salvar": return await cartaoSalvar(d, cfg, u, b);
      case "cartao_remover": return await cartaoRemover(d, cfg, u);
      case "recarga_automatica": return await recargaAutomatica(d, cfg, u, b);
      case "pix": return await pixDaCompra(d, cfg, u, b);
      case "cancelar_compra": return await cancelarCompra(d, cfg, u, b);
      case "conferir": return await conferir(d, cfg, u, b);
      case "pagar_cadastro": return await pagarCadastro(d, cfg, u, b);
      case "iniciar_mensalidade": {
        // a tela da empresa chama quando minha_cobranca() diz mensalidade_a_iniciar; o superadmin, por empresa
        const alvo = u.superadmin && b.escritorio_id ? String(b.escritorio_id) : u.escritorioId;
        if (!alvo) throw new ErroUsuario("Sua conta não está ligada a uma empresa.", 403);
        return ok(await iniciarMensalidade(d, cfg, alvo));
      }
      case "autocadastro_salvar": return await superadmin(() => autocadastroSalvar(d, cfg, b));
      case "config_status": return await superadmin(() => configStatus(d, cfg));
      case "config_salvar": return await superadmin(() => configSalvar(d, cfg, u, b));
      case "whatsapp_testar": return await superadmin(() => whatsappTestar(d, cfg, b));
      case "whatsapp_qrcode": return await superadmin(() => whatsappQrcode(d, cfg));
      case "whatsapp_estado": return await superadmin(() => whatsappEstado(d, cfg));
      case "cobrar_empresa": return await superadmin(() => cobrarEmpresa(d, cfg, b));
      case "atualizar_assinatura": return await superadmin(() => atualizarAssinatura(d, cfg, b));
      case "cancelar_assinatura": return await superadmin(() => cancelarAssinatura(d, cfg, b));
      default: return falha(400, "Ação desconhecida.");
    }
  } catch (e) {
    if (e instanceof ErroUsuario) return falha(e.status, e.message);
    if (e instanceof ErroAsaas) return falha(502, e.message);
    return falha(500, msg(e));
  }
}

function exigirAsaas(d: Deps, cfg: Record<string, string>): ClienteAsaas {
  const a = asaasDe(cfg, d.fetch);
  if (!a) throw new ErroUsuario("O pagamento online ainda não está configurado (Painel → Configurações → Pagamentos).", 409);
  return a;
}

async function garantirCliente(d: Deps, asaas: ClienteAsaas, escritorioId: string): Promise<string> {
  const e = await d.banco.empresa(escritorioId);
  if (!e) throw new ErroUsuario("Empresa não encontrada.", 404);
  if (e.cobranca?.asaas_cliente_id) return e.cobranca.asaas_cliente_id;
  // o Asaas aceita CPF ou CNPJ: o autocadastro (0040) também vende para quem trabalha como pessoa física
  const doc = soDigitos(e.cnpj ?? "");
  if (doc.length !== 11 && doc.length !== 14) throw new ErroUsuario("Cadastre o CNPJ (ou o CPF) da empresa para gerar a cobrança.");
  const existente = await asaas.buscarCliente(doc);
  const id = existente?.id ?? (await asaas.criarCliente({
    name: e.nome, cpfCnpj: doc, email: e.email, mobilePhone: e.telefone, externalReference: e.id,
  })).id;
  await d.banco.salvarCobranca(e.id, { asaas_cliente_id: id });
  return id;
}

// ---------------------------------------------------------------- empresa: compra de créditos

async function comprarCreditos(d: Deps, cfg: Record<string, string>, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  const asaas = exigirAsaas(d, cfg);
  if (b.forma === "cartao") return comprarNoCartao(d, cfg, asaas, u, b);
  const ped = await u.pedirCreditos(String(b.tipo ?? ""), Math.floor(Number(b.quantidade)));
  if (!ped.online || !ped.pagamento_id) return ok({ pedido: ped });
  try {
    const cliente = await garantirCliente(d, asaas, ped.escritorio_id);
    const cob = await asaas.criarCobranca({
      customer: cliente, billingType: "UNDEFINED", value: ped.valor, dueDate: somarDias(d.hoje(), 2),
      description: `Vertces: ${ped.descricao}`, externalReference: ped.credito_id,
    });
    await d.banco.atualizarPagamento(ped.pagamento_id, {
      asaas_id: cob.id, status: cob.status || "PENDING", link: cob.invoiceUrl ?? null, vencimento: cob.dueDate ?? null,
    });
    const pix = await asaas.pix(cob.id).catch(() => null);
    return ok({ credito_id: ped.credito_id, valor: ped.valor, descricao: ped.descricao, link: cob.invoiceUrl ?? null, pix });
  } catch (e) {
    // sem cobrança no Asaas, a compra não fica pendurada esperando
    await d.banco.cancelarCompra(ped.credito_id, ped.pagamento_id, `Falha ao gerar a cobrança: ${msg(e)}`);
    throw e;
  }
}

async function pixDaCompra(d: Deps, cfg: Record<string, string>, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  const asaas = exigirAsaas(d, cfg);
  const id = String(b.credito_id ?? "");
  if (!(await u.compraMinha(id))) throw new ErroUsuario("Compra não encontrada.", 404);
  const p = await d.banco.pagamentoDaCompra(id);
  if (!p?.asaas_id) throw new ErroUsuario("Esta compra não tem cobrança no Asaas.", 404);
  const pix = await asaas.pix(p.asaas_id).catch(() => null);
  return ok({ pix, link: p.link });
}

async function cancelarCompra(d: Deps, cfg: Record<string, string>, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  const id = String(b.credito_id ?? "");
  if (!(await u.compraMinha(id))) throw new ErroUsuario("Compra não encontrada.", 404);
  const p = await d.banco.pagamentoDaCompra(id);
  const asaas = asaasDe(cfg, d.fetch);
  if (asaas && p?.asaas_id) {
    // pagou enquanto decidia cancelar: lança os créditos em vez de cancelar
    const cob = await asaas.cobranca(p.asaas_id).catch(() => null);
    if (cob && cobrancaPaga(cob.status)) {
      await aplicarEAvisar(d, cfg, "CONFERENCIA", cob);
      return ok({ ja_paga: true });
    }
    await asaas.removerCobranca(p.asaas_id).catch(() => null);
  }
  await u.cancelarPedido(id);
  return ok();
}

/** Pergunta ao Asaas pelas cobranças em aberto e aplica o que mudou (a rede de segurança do webhook). */
async function conferir(d: Deps, cfg: Record<string, string>, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  const alvo = u.superadmin ? (b.escritorio_id ? String(b.escritorio_id) : null) : u.escritorioId;
  if (!u.superadmin && !alvo) throw new ErroUsuario("Sua conta não está ligada a uma empresa.", 403);
  const asaas = asaasDe(cfg, d.fetch);
  if (!asaas) return ok({ conferidos: 0, mudancas: [] });
  const pendentes = await d.banco.pagamentosPendentes(alvo);
  const mudancas: string[] = [];
  for (const p of pendentes) {
    let cob: CobrancaAsaas | null = null;
    try { cob = await asaas.cobranca(p.asaas_id); } catch (e) {
      if (e instanceof ErroAsaas && e.status === 404) cob = { id: p.asaas_id, status: p.status, value: 0, dueDate: "", deleted: true };
      else continue;
    }
    if (!cob.deleted && cob.status === p.status) continue;
    const r = await aplicarEAvisar(d, cfg, cob.deleted ? "PAYMENT_DELETED" : "CONFERENCIA", cob);
    mudancas.push(r.acao);
  }
  // 0049: a conferência do superadmin também gera a mensalidade de quem gastou o
  // 1º crédito e ficou sem a cobrança (a tela não chegou a chamar, o Asaas falhou…)
  if (u.superadmin) {
    const ids = alvo ? [alvo] : ((await d.banco.mensalidadesAIniciar?.().catch(() => [])) ?? []);
    for (const id of ids) {
      try {
        const r = await iniciarMensalidade(d, cfg, id);
        if (r.acao === "iniciada") mudancas.push("mensalidade iniciada");
      } catch { /* segue para a próxima: a empresa continua na lista */ }
    }
  }
  return ok({ conferidos: pendentes.length, mudancas });
}

// ---------------------------------------------------------------- a mensalidade que começa no 1º crédito (0049)
//
// A empresa escolhida pela equipe entra sem pagar. O banco marca o dia do 1º
// crédito gasto (gatilho marcar_primeiro_credito) e muda o mês dos créditos para
// começar nele; aqui nasce a assinatura no Asaas, com a 1ª mensalidade vencendo
// nesse dia (ou hoje, se a cobrança sair depois), e o aviso no WhatsApp. Daí
// para frente é a cobrança de sempre: vence no mesmo dia a cada período,
// vencida suspende, paga reativa. Quem chama: a tela (minha_cobranca diz
// mensalidade_a_iniciar), o cadastro do cartão e a conferência do superadmin.

/** "aaaa-mm-dd" do instante no horário de Brasília. */
export function diaBrasil(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

export type InicioMensalidade = {
  /** iniciada · esperando (sem o 1º crédito) · sem_condicao · ja_iniciada · sem_asaas · sem_mensalidade · em_andamento */
  acao: string;
  link?: string | null; valor?: number; vencimento?: string | null; whatsapp?: boolean;
};

export async function iniciarMensalidade(d: Deps, cfg: Record<string, string>, escritorioId: string): Promise<InicioMensalidade> {
  const e = await d.banco.empresa(escritorioId);
  if (!e) throw new ErroUsuario("Empresa não encontrada.", 404);
  const c = e.cobranca;
  if (!c?.inicio_no_primeiro_credito) return { acao: "sem_condicao" };
  if (c.mensalidade_iniciada_em) return { acao: "ja_iniciada" };
  if (!c.primeiro_credito_em) return { acao: "esperando" };
  const asaas = asaasDe(cfg, d.fetch);
  if (!asaas) return { acao: "sem_asaas" };
  const { ciclo, valor } = cobrancaDaEmpresa(cfg, e);
  if (!(valor > 0)) return { acao: "sem_mensalidade" };
  // duas abas (ou a tela e o painel) ao mesmo tempo criariam duas assinaturas
  if (d.limite && !(await d.limite(`iniciar-mensalidade:${e.id}`, 1, 30))) return { acao: "em_andamento" };
  const agora = new Date().toISOString();
  // já tem assinatura viva (gerada à mão no painel): só fecha a condição
  if (c.asaas_assinatura_id && c.situacao !== "cancelada") {
    await d.banco.salvarCobranca(e.id, { mensalidade_iniciada_em: agora });
    return { acao: "ja_iniciada" };
  }
  const hoje = d.hoje();
  const dia = diaBrasil(c.primeiro_credito_em);
  // o Asaas não aceita vencimento no passado: cobrança que sai depois vence hoje
  const vencimento = dia > hoje ? dia : hoje;
  const cliente = await garantirCliente(d, asaas, e.id);
  const sub = await asaas.criarAssinatura({
    customer: cliente, billingType: "UNDEFINED", value: valor, nextDueDate: vencimento, cycle: ciclo,
    description: descricaoAssinatura(e, ciclo), externalReference: e.id,
  });
  // a assinatura existe: daqui para frente a condição está cumprida (mesmo se o resto falhar)
  await d.banco.salvarCobranca(e.id, {
    asaas_cliente_id: cliente, asaas_assinatura_id: sub.id, valor, ciclo, situacao: "aguardando",
    proximo_vencimento: vencimento, mensalidade_iniciada_em: agora,
  });
  const primeira = (await asaas.cobrancasDaAssinatura(sub.id).catch((): CobrancaAsaas[] => [])).filter((x) => !x.deleted).sort(porVencimento)[0];
  let link: string | null = null;
  if (primeira) {
    await d.banco.inserirPagamento({
      escritorio_id: e.id, finalidade: "mensalidade", asaas_id: primeira.id, valor: primeira.value ?? valor,
      status: primeira.status || "PENDING", link: primeira.invoiceUrl ?? null, vencimento: primeira.dueDate, ciclo,
    });
    link = primeira.invoiceUrl ?? null;
    await d.banco.salvarCobranca(e.id, { link_pagamento: link, proximo_vencimento: primeira.dueDate || vencimento });
  }
  const venc = primeira?.dueDate || vencimento;
  await d.banco.atividade(e.id, "cobranca.iniciada", `1º crédito em ${dataBr(dia)}: ${nomeDaCobranca(ciclo)} de ${fmtReais(valor)} vence ${dataBr(venc)}`, null).catch(() => {});
  const texto = mensagemMensalidadeIniciada({
    responsavel: e.responsavel, empresa: e.nome, plano: e.plano, valor, link, vencimento: venc, url: urlApp(cfg), ciclo, dia,
  });
  const zap = await avisarEmpresa(d, cfg, e, texto, true).catch(() => ({ enviado: false }));
  await avisarSuperadmin(d, cfg, `Vertces: a ${e.nome} gastou o 1º crédito em ${dataBr(dia)}. A ${nomeDaCobranca(ciclo)} de ${fmtReais(valor)} começou e vence ${dataBr(venc)}.`);
  return { acao: "iniciada", link, valor, vencimento: venc, whatsapp: zap.enviado };
}

// ---------------------------------------------------------------- superadmin: configuração

async function configStatus(d: Deps, cfg: Record<string, string>): Promise<Resposta> {
  const asaas = asaasDe(cfg, d.fetch);
  let a: Record<string, unknown> = { configurado: false };
  if (asaas) {
    a = {
      configurado: true, ambiente: ambienteValido(cfg.asaas_ambiente) ? cfg.asaas_ambiente : "sandbox",
      chave_final: cfg.asaas_api_key.slice(-4), saldo: null, erro: null, webhook: null,
    };
    try { a.saldo = (await asaas.saldo()).balance; } catch (e) { a.erro = msg(e); }
    if (cfg.asaas_webhook_id && !a.erro) {
      try {
        const w = await asaas.webhook(cfg.asaas_webhook_id);
        a.webhook = {
          url: w.url, ativo: w.enabled, interrompido: w.interrupted, penalizados: w.penalizedRequestsCount ?? 0,
          // eventos que o código escuta e o Asaas ainda não manda (lista nova): pede "Religar o webhook"
          faltando: Array.isArray(w.events) ? EVENTOS_WEBHOOK.filter((ev) => !w.events!.includes(ev)).length : null,
        };
      } catch (e) { a.webhook = { erro: msg(e) }; }
    }
  }
  if (asaas && !a.erro) a.tokenizacao = await tokenizacaoLiberada(d, cfg, asaas);
  const zap = zapDe(cfg);
  const w = zap
    ? { configurado: true, url: zap.url, instancia: zap.instancia, estado: await estadoWhatsApp(zap, d.fetch) }
    : { configurado: false };
  return ok({
    asaas: a, whatsapp: w, url_app: urlApp(cfg), ultimo_evento: await d.banco.ultimoEvento(),
    autocadastro: { ...regrasDe(cfg), whatsapp_avisos: cfg.whatsapp_avisos ?? null, parcelado_value: cfg.asaas_parcelado_value === "enviar" },
  });
}

/** Configurações → Autocadastro: abrir/fechar, períodos e descontos, parcelas e juros, o WhatsApp dos avisos. */
async function autocadastroSalvar(d: Deps, cfg: Record<string, string>, b: Record<string, unknown>): Promise<Resposta> {
  const atual = regrasDe(cfg);
  const pedido = {
    cadastro_aberto: b.cadastro_aberto ?? atual.cadastro_aberto,
    parcelas_sem_juros: b.parcelas_sem_juros ?? atual.parcelas_sem_juros,
    parcelas_max: b.parcelas_max ?? atual.parcelas_max,
    juros_mes: b.juros_mes ?? atual.juros_mes,
    ciclos: b.ciclos ?? atual.ciclos,
    adesao: b.adesao ?? atual.adesao,
    adesao_texto: b.adesao_texto ?? atual.adesao_texto,
  };
  const problema = problemaDasRegras(pedido);
  if (problema) throw new ErroUsuario(problema);
  const novo: Record<string, string | null> = configDasRegras(normalizarRegras(pedido));
  if (b.whatsapp_avisos !== undefined) {
    const tel = soDigitos(String(b.whatsapp_avisos ?? ""));
    if (tel && !telefoneValido(tel)) throw new ErroUsuario("WhatsApp dos avisos inválido: use DDD + número.");
    novo.whatsapp_avisos = tel || null;
  }
  // avançado: mandar `value` na compra parcelada (ver cobrarParcelado)
  if (typeof b.parcelado_value === "boolean") novo.asaas_parcelado_value = b.parcelado_value ? "enviar" : null;
  await d.banco.gravarConfig(novo);
  const cfgNovo = await d.banco.config();
  return ok({
    autocadastro: { ...regrasDe(cfgNovo), whatsapp_avisos: cfgNovo.whatsapp_avisos ?? null, parcelado_value: cfgNovo.asaas_parcelado_value === "enviar" },
  });
}

async function configSalvar(d: Deps, cfg: Record<string, string>, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  const novo: Record<string, string | null> = {};
  let trocouConta = false;
  const chaveNova = typeof b.asaas_chave === "string" ? b.asaas_chave.trim() : "";
  const ambNovo = ambienteValido(b.asaas_ambiente) ? b.asaas_ambiente : null;

  if (b.remover_asaas) {
    Object.assign(novo, { asaas_api_key: null, asaas_ambiente: null, asaas_webhook_id: null, asaas_webhook_token: null, asaas_webhook_url: null });
    trocouConta = true;
  } else if (chaveNova || (ambNovo && ambNovo !== cfg.asaas_ambiente) || (b.religar_webhook && cfg.asaas_api_key)) {
    const chave = chaveNova || cfg.asaas_api_key;
    if (!chave) throw new ErroUsuario("Cole a chave da API do Asaas.");
    const amb = ambNovo ?? (ambienteValido(cfg.asaas_ambiente) ? cfg.asaas_ambiente : "sandbox");
    const urlWebhook = String(b.url_webhook ?? cfg.asaas_webhook_url ?? "");
    if (!/^https:\/\/\S+$/.test(urlWebhook)) throw new ErroUsuario("Endereço do webhook inválido (precisa ser https).");
    const asaas = clienteAsaas(chave, amb, d.fetch);
    await asaas.saldo(); // a chave vale neste ambiente?
    trocouConta = chave !== cfg.asaas_api_key || amb !== cfg.asaas_ambiente;
    const token = (!trocouConta && cfg.asaas_webhook_token) || d.aleatorio();
    const wh = await garantirWebhook(asaas, {
      url: urlWebhook, token, email: u.email ?? "", idAtual: trocouConta ? null : cfg.asaas_webhook_id,
    });
    Object.assign(novo, { asaas_api_key: chave, asaas_ambiente: amb, asaas_webhook_id: wh.id, asaas_webhook_token: token, asaas_webhook_url: urlWebhook });
  }

  if (b.remover_whatsapp) {
    Object.assign(novo, { whatsapp_url: null, whatsapp_chave: null, whatsapp_instancia: null });
  } else if (b.whatsapp_url !== undefined || b.whatsapp_instancia !== undefined || b.whatsapp_chave) {
    const url = String(b.whatsapp_url ?? cfg.whatsapp_url ?? "").trim().replace(/\/+$/, "");
    const instancia = String(b.whatsapp_instancia ?? cfg.whatsapp_instancia ?? "").trim();
    const chave = String(b.whatsapp_chave || cfg.whatsapp_chave || "").trim();
    if (!/^https?:\/\/\S+$/.test(url)) throw new ErroUsuario("Endereço da Evolution API inválido.");
    if (!instancia || !chave) throw new ErroUsuario("Informe a instância e a chave da Evolution API.");
    Object.assign(novo, { whatsapp_url: url, whatsapp_instancia: instancia, whatsapp_chave: chave });
  }
  if (typeof b.url_app === "string" && /^https:\/\/\S+$/.test(b.url_app.trim())) novo.url_app = b.url_app.trim();

  await d.banco.gravarConfig(novo);
  if (trocouConta && cfg.asaas_api_key) await d.banco.esquecerClientesAsaas();
  return configStatus(d, await d.banco.config());
}

async function whatsappTestar(d: Deps, cfg: Record<string, string>, b: Record<string, unknown>): Promise<Resposta> {
  const zap = zapDe(cfg);
  if (!zap) throw new ErroUsuario("Configure o WhatsApp antes de testar.", 409);
  const r = await enviarWhatsApp(zap, String(b.telefone ?? ""), "Teste do Vertces ✅ O WhatsApp da cobrança está funcionando.", d.fetch);
  return r.ok ? ok() : falha(502, r.erro);
}

/** O QR Code para ler no celular. Já conectada, não gera outro (não derruba a sessão). */
async function whatsappQrcode(d: Deps, cfg: Record<string, string>): Promise<Resposta> {
  const zap = zapDe(cfg);
  if (!zap) throw new ErroUsuario("A instância do WhatsApp não está configurada no servidor.", 409);
  const estado = await estadoWhatsApp(zap, d.fetch);
  if (estado === "open") return ok({ estado });
  const qrcode = await qrcodeWhatsApp(zap, d.fetch);
  if (!qrcode) throw new ErroUsuario("A Evolution não devolveu o QR Code. Tente de novo em instantes.", 502);
  return ok({ estado, qrcode });
}

async function whatsappEstado(d: Deps, cfg: Record<string, string>): Promise<Resposta> {
  const zap = zapDe(cfg);
  return ok({ configurado: !!zap, estado: zap ? await estadoWhatsApp(zap, d.fetch) : null });
}

// ---------------------------------------------------------------- superadmin: mensalidade da empresa

/** A mensalidade em aberto de uma assinatura (a que vence primeiro). */
async function faturaAberta(d: Deps, asaas: ClienteAsaas, e: EmpresaCobranca): Promise<{ link: string | null; vencimento: string | null }> {
  const cobs = (await asaas.cobrancasDaAssinatura(e.cobranca!.asaas_assinatura_id!))
    .filter((c) => !c.deleted && (c.status === "PENDING" || c.status === "OVERDUE"))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const c = cobs[0];
  if (!c) throw new ErroUsuario("A assinatura não tem mensalidade em aberto: está tudo pago.");
  await d.banco.inserirPagamento({
    escritorio_id: e.id, finalidade: "mensalidade", asaas_id: c.id, valor: c.value, status: c.status,
    link: c.invoiceUrl ?? null, vencimento: c.dueDate, ciclo: cicloDe(e.cobranca?.ciclo) ?? "MONTHLY",
  });
  await d.banco.salvarCobranca(e.id, { link_pagamento: c.invoiceUrl ?? null, proximo_vencimento: c.dueDate });
  return { link: c.invoiceUrl ?? null, vencimento: c.dueDate };
}

async function cobrarEmpresa(d: Deps, cfg: Record<string, string>, b: Record<string, unknown>): Promise<Resposta> {
  const asaas = exigirAsaas(d, cfg);
  const id = String(b.escritorio_id ?? "");
  let e = await d.banco.empresa(id);
  if (!e) throw new ErroUsuario("Empresa não encontrada.", 404);
  // o valor do período da empresa (mensal = a mensalidade; autocadastro semestral/anual = o do período)
  const { ciclo, valor } = cobrancaDaEmpresa(cfg, e);
  if (!(valor > 0)) {
    throw new ErroUsuario("Esta empresa não tem mensalidade. Defina o preço do plano em Planos (ou só para ela, na aba Plano e créditos).");
  }
  let link: string | null;
  let vencimento: string | null;
  if (e.cobranca?.asaas_assinatura_id && e.cobranca.situacao !== "cancelada") {
    ({ link, vencimento } = await faturaAberta(d, asaas, e));
  } else {
    const cliente = await garantirCliente(d, asaas, e.id);
    const hoje = d.hoje();
    // liberada agora: a 1ª vence em 3 dias (vencida, suspende como qualquer outra). Em dia
    // com o período já pago (o parcelado do autocadastro que ficou sem assinatura): começa
    // quando o período pago acaba, sem cobrar de novo agora
    const pagoAte = e.cobranca?.situacao === "em_dia" && e.cobranca.proximo_vencimento && e.cobranca.proximo_vencimento > hoje
      ? e.cobranca.proximo_vencimento : null;
    const primeiroVencimento = pagoAte ?? (b.liberada ? somarDias(hoje, 3) : hoje);
    const sub = await asaas.criarAssinatura({
      customer: cliente, billingType: "UNDEFINED", value: valor, nextDueDate: primeiroVencimento, cycle: ciclo,
      description: descricaoAssinatura(e, ciclo), externalReference: e.id,
    });
    const primeira = (await asaas.cobrancasDaAssinatura(sub.id)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (!primeira) {
      await asaas.removerAssinatura(sub.id).catch(() => null);
      throw new ErroAsaas("O Asaas não gerou a primeira cobrança da assinatura. Tente de novo em instantes.", 502);
    }
    await d.banco.inserirPagamento({
      escritorio_id: e.id, finalidade: "mensalidade", asaas_id: primeira.id, valor: primeira.value ?? valor,
      status: primeira.status || "PENDING", link: primeira.invoiceUrl ?? null, vencimento: primeira.dueDate, ciclo,
    });
    await d.banco.salvarCobranca(e.id, {
      asaas_cliente_id: cliente, asaas_assinatura_id: sub.id, valor, ciclo, situacao: pagoAte ? "em_dia" : "aguardando",
      link_pagamento: primeira.invoiceUrl ?? null, proximo_vencimento: primeira.dueDate,
    });
    // empresa nova: o mês do crédito começa no dia do vencimento da mensalidade
    if (e.status === "aguardando_pagamento") await d.banco.atualizarEmpresa(e.id, { dia_renovacao: Number(primeiroVencimento.slice(8, 10)) });
    link = primeira.invoiceUrl ?? null;
    vencimento = primeira.dueDate;
  }
  if (!link) throw new ErroAsaas("O Asaas não devolveu o link da cobrança.", 502);
  // 0049: a equipe cobrou à mão a empresa que esperava o 1º crédito: a condição acaba aqui
  // (sem isto, o 1º crédito criaria uma segunda assinatura)
  if (esperaPrimeiroCredito(e)) await d.banco.salvarCobranca(e.id, { mensalidade_iniciada_em: new Date().toISOString() });
  e = (await d.banco.empresa(id)) ?? e;
  const texto = mensagemCobranca({
    responsavel: e.responsavel, empresa: e.nome, plano: e.plano, valor, link, vencimento, url: urlApp(cfg),
    login: typeof b.login === "string" && b.login ? b.login : e.login,
    senha: typeof b.senha === "string" && b.senha ? b.senha : null,
    creditos: textoCreditos(e.creditos),
    liberada: e.status === "ativo",
    ciclo,
  });
  const whatsapp = await avisarEmpresa(d, cfg, e, texto, b.enviar_whatsapp !== false);
  return ok({ link, valor, vencimento, mensagem: texto, whatsapp });
}

async function avisarEmpresa(d: Deps, cfg: Record<string, string>, e: EmpresaCobranca, texto: string, querEnviar: boolean):
  Promise<{ configurado: boolean; enviado: boolean; erro?: string }> {
  const zap = zapDe(cfg);
  if (!zap) return { configurado: false, enviado: false };
  if (!querEnviar) return { configurado: true, enviado: false };
  const r = await enviarWhatsApp(zap, e.telefone, texto, d.fetch);
  await d.banco.salvarCobranca(e.id, r.ok
    ? { whatsapp_em: new Date().toISOString(), whatsapp_erro: null }
    : { whatsapp_erro: r.erro });
  return r.ok ? { configurado: true, enviado: true } : { configurado: true, enviado: false, erro: r.erro };
}

async function atualizarAssinatura(d: Deps, cfg: Record<string, string>, b: Record<string, unknown>): Promise<Resposta> {
  const asaas = exigirAsaas(d, cfg);
  const e = await d.banco.empresa(String(b.escritorio_id ?? ""));
  if (!e?.cobranca?.asaas_assinatura_id || e.cobranca.situacao === "cancelada") throw new ErroUsuario("A empresa não tem assinatura ativa no Asaas.");
  // semestral/anual: o valor do período (com o desconto de hoje), não a mensalidade
  const { ciclo, valor } = cobrancaDaEmpresa(cfg, e);
  if (!(valor > 0)) throw new ErroUsuario("A mensalidade da empresa está zerada: cancele a assinatura em vez de atualizar.");
  await asaas.atualizarAssinatura(e.cobranca.asaas_assinatura_id, {
    value: valor, updatePendingPayments: true, description: e.plano ? descricaoAssinatura(e, ciclo) : undefined,
  });
  await d.banco.salvarCobranca(e.id, { valor });
  return ok({ valor });
}

async function cancelarAssinatura(d: Deps, cfg: Record<string, string>, b: Record<string, unknown>): Promise<Resposta> {
  const asaas = exigirAsaas(d, cfg);
  const e = await d.banco.empresa(String(b.escritorio_id ?? ""));
  if (!e?.cobranca?.asaas_assinatura_id || e.cobranca.situacao === "cancelada") throw new ErroUsuario("A empresa não tem assinatura ativa no Asaas.");
  await asaas.removerAssinatura(e.cobranca.asaas_assinatura_id);
  await d.banco.salvarCobranca(e.id, { situacao: "cancelada", link_pagamento: null });
  return ok();
}

// ---------------------------------------------------------------- empresa: o cartão de crédito
//
// O dono cadastra o cartão no sistema; os dados passam por aqui só nesta
// chamada (vão ao Asaas e não são gravados). Com a tokenização liberada no
// Asaas, guarda-se o token e o cartão também compra créditos (na hora ou sozinho,
// quando a carteira zera). Sem ela, o cartão fica só na assinatura (mensalidade).

const pendente = (c: CobrancaAsaas) => !c.deleted && (c.status === "PENDING" || c.status === "OVERDUE");
const porVencimento = (a: CobrancaAsaas, b: CobrancaAsaas) => a.dueDate.localeCompare(b.dueDate);

/** O mesmo dia no mês seguinte (31 → último dia do mês). */
export function somarMes(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  const ultimo = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(a, m, Math.min(d, ultimo))).toISOString().slice(0, 10);
}

/** Recusa do cartão (4xx do Asaas) vira mensagem para a pessoa; o resto segue como erro do Asaas. */
function cartaoRecusado(e: unknown): unknown {
  if (e instanceof ErroAsaas && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403) {
    return new ErroUsuario(`O cartão não foi aceito: ${e.message}`);
  }
  return e;
}

function exigirDono(u: Usuario): string {
  if (!u.escritorioId) throw new ErroUsuario("Sua conta não está ligada a uma empresa.", 403);
  if (!u.souDono) throw new ErroUsuario("Só o dono da empresa cadastra o cartão.", 403);
  return u.escritorioId;
}

function ipDe(u: Usuario): string {
  if (!u.ip) throw new ErroUsuario("Não foi possível identificar a sua conexão. Recarregue a página e tente de novo.");
  return u.ip;
}

/** A conta do Asaas guarda cartões (tokenização)? Pergunta uma vez e lembra o "sim". */
async function tokenizacaoLiberada(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas): Promise<"liberada" | "bloqueada" | null> {
  if (cfg.asaas_tokenizacao === "liberada") return "liberada";
  try {
    // cliente que não existe: nada é guardado nem cobrado; só a permissão responde diferente
    await asaas.tokenizar({
      customer: "cus_000000000000", remoteIp: "127.0.0.1",
      creditCard: { holderName: "TESTE", number: "0", expiryMonth: "01", expiryYear: "2000", ccv: "000" },
      creditCardHolderInfo: { name: "TESTE", email: "teste@vertces.com.br", cpfCnpj: "0", postalCode: "0", addressNumber: "0", phone: "0", mobilePhone: "0" },
    });
  } catch (e) {
    if (!(e instanceof ErroAsaas) || e.status === 0 || e.status >= 500) return (cfg.asaas_tokenizacao as "bloqueada") ?? null;
    const v = e.status === 403 ? "bloqueada" : "liberada";
    if (cfg.asaas_tokenizacao !== v) await d.banco.gravarConfig({ asaas_tokenizacao: v });
    return v;
  }
  return "liberada";
}

interface ResultadoMensalidade {
  pagas: number; ativou: boolean; assinatura: string | null; token: string | null; bandeira: string | null;
  /** o Asaas segurou a cobrança para análise de risco do cartão (a liberação vem pelo webhook) */
  emAnalise: boolean;
}

function lembrarCartao(r: ResultadoMensalidade, c: { creditCard?: { creditCardToken?: string | null; creditCardBrand?: string } | null } | null | undefined) {
  if (c?.creditCard?.creditCardToken && !r.token) r.token = c.creditCard.creditCardToken;
  if (c?.creditCard?.creditCardBrand && !r.bandeira) r.bandeira = c.creditCard.creditCardBrand;
}

/**
 * A mensalidade passa para o cartão. O que já venceu (ou vence hoje) é pago
 * agora com ele; a assinatura de boleto/Pix dá lugar a uma no cartão, que
 * começa no próximo vencimento. Empresa nova sem assinatura: a 1ª é cobrada já.
 * No período da empresa (0040): semestral e anual cobram o valor do período.
 */
async function mensalidadeNoCartao(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas, esc: string, cliente: string,
  meio: CartaoParaAsaas, ip: string): Promise<ResultadoMensalidade> {
  const res: ResultadoMensalidade = { pagas: 0, ativou: false, assinatura: null, token: null, bandeira: null, emAnalise: false };
  const e = await d.banco.empresa(esc);
  if (!e) throw new ErroUsuario("Empresa não encontrada.", 404);
  const { ciclo, valor } = cobrancaDaEmpresa(cfg, e);
  if (!(valor > 0)) return res;
  const hoje = d.hoje();
  const antiga = e.cobranca?.asaas_assinatura_id && e.cobranca.situacao !== "cancelada" ? e.cobranca.asaas_assinatura_id : null;
  const pagar = async (c: CobrancaAsaas) => {
    let paga: CobrancaAsaas;
    try { paga = await asaas.pagarComCartao(c.id, { ...meio, remoteIp: ip }); } catch (x) { throw cartaoRecusado(x); }
    lembrarCartao(res, paga);
    if (cobrancaPaga(paga.status)) {
      const r = await aplicarEAvisar(d, cfg, "CONFERENCIA", { ...c, ...paga });
      res.pagas++;
      if (r.acao === "ativou") res.ativou = true;
    } else if (paga.status === "AWAITING_RISK_ANALYSIS") {
      // registra a análise (a conferência e o webhook acompanham daqui)
      await aplicarEAvisar(d, cfg, "CONFERENCIA", { ...c, ...paga });
      res.emAnalise = true;
    }
  };

  let proximo: string;
  let cobrarJa = false;
  if (antiga) {
    const [sub, cobs] = await Promise.all([asaas.assinatura(antiga).catch((): AssinaturaAsaas | null => null), asaas.cobrancasDaAssinatura(antiga)]);
    const abertas = cobs.filter(pendente).sort(porVencimento);
    // vencida ou vencendo hoje: o cartão paga agora (a empresa suspensa volta na hora)
    for (const c of abertas.filter((x) => x.dueDate <= hoje)) await pagar(c);
    const futura = abertas.find((x) => x.dueDate > hoje);
    proximo = futura?.dueDate ?? (sub?.nextDueDate && sub.nextDueDate > hoje ? sub.nextDueDate : somarMeses(hoje, MESES[ciclo]));
    if (sub?.billingType === "CREDIT_CARD" && !abertas.length && sub.nextDueDate && sub.nextDueDate > hoje) proximo = sub.nextDueDate;
  } else if (e.status === "aguardando_pagamento") {
    // vence amanhã e o sistema paga a 1ª agora, uma vez, com resposta na hora. Vencendo
    // hoje, o próprio Asaas também cobraria o cartão na criação: as duas cobranças se
    // cruzariam e uma "recusa" desfaria uma assinatura paga.
    proximo = somarDias(hoje, 1);
    cobrarJa = true;
  } else {
    // já usa e não tem assinatura (cortesia que passou a pagar): começa na renovação dos créditos
    proximo = e.renovacao && e.renovacao > hoje ? e.renovacao : somarMes(hoje);
  }

  let nova: AssinaturaAsaas;
  try {
    nova = await asaas.criarAssinaturaNoCartao({
      customer: cliente, value: valor, nextDueDate: proximo, cycle: ciclo,
      description: descricaoAssinatura(e, ciclo), externalReference: e.id, remoteIp: ip, ...meio,
    });
  } catch (x) { throw cartaoRecusado(x); }
  lembrarCartao(res, nova);
  res.assinatura = nova.id;
  await d.banco.salvarCobranca(e.id, {
    asaas_cliente_id: cliente, asaas_assinatura_id: nova.id, valor, ciclo, link_pagamento: null, proximo_vencimento: proximo,
    ...(antiga ? {} : { situacao: cobrarJa ? "aguardando" : "em_dia" }),
  });
  // a antiga sai e leva as faturas de boleto/Pix que ainda não venceram (as pagas ficam)
  if (antiga) await asaas.removerAssinatura(antiga).catch(() => null);

  if (cobrarJa) {
    await d.banco.atualizarEmpresa(e.id, { dia_renovacao: Number(proximo.slice(8, 10)) });
    const cobs = (await asaas.cobrancasDaAssinatura(nova.id)).sort(porVencimento);
    for (const c of cobs) {
      await d.banco.inserirPagamento({
        escritorio_id: e.id, finalidade: "mensalidade", asaas_id: c.id, valor: c.value ?? valor, status: c.status || "PENDING",
        link: c.invoiceUrl ?? null, vencimento: c.dueDate, ciclo,
      });
      if (cobrancaPaga(c.status)) {
        const r = await aplicarEAvisar(d, cfg, "CONFERENCIA", c);
        res.pagas++;
        if (r.acao === "ativou") res.ativou = true;
      } else if (pendente(c)) {
        try { await pagar(c); } catch (x) {
          // recusou: a empresa continua esperando o pagamento, sem assinatura pendurada
          await asaas.removerAssinatura(nova.id).catch(() => null);
          await d.banco.salvarCobranca(e.id, { asaas_assinatura_id: null, situacao: "sem_assinatura", proximo_vencimento: null });
          throw x;
        }
      }
    }
  }
  return res;
}

async function cartaoSalvar(d: Deps, cfg: Record<string, string>, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  const esc = exigirDono(u);
  const asaas = exigirAsaas(d, cfg);
  const cartao = (b.cartao ?? {}) as CartaoDigitado;
  const titular = (b.titular ?? {}) as TitularDigitado;
  const problema = Object.values(problemasDoCartao(cartao, titular, d.hoje()))[0];
  if (problema) throw new ErroUsuario(problema);
  const r = await cadastrarCartao(d, cfg, asaas, u, esc, cartao, titular);
  return ok({ reutilizavel: r.reutilizavel, bandeira: r.bandeira, final: r.final, pagas: r.pagas, ativou: r.ativou, assinatura: r.assinatura });
}

/**
 * O cartão (já validado) vira o meio da mensalidade da empresa: guarda o token
 * (se o Asaas deixa), passa a assinatura para o cartão e paga o que está em
 * aberto. Usado pelo "Cadastrar cartão" e pelo cartão 1x do autocadastro.
 */
async function cadastrarCartao(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas, u: Usuario, esc: string,
  cartao: CartaoDigitado, titular: TitularDigitado): Promise<ResultadoMensalidade & { reutilizavel: boolean; final: string }> {
  const hoje = d.hoje();
  const ip = ipDe(u);
  const dados = paraAsaas(cartao, titular, hoje);
  // 0049: a mensalidade que começa no 1º crédito. Gastou e a cobrança ainda não
  // saiu: sai agora (e o cartão paga). Ainda não gastou: o cartão criaria a
  // assinatura antes da hora — fica para depois.
  const antes = await d.banco.empresa(esc);
  if (esperaPrimeiroCredito(antes)) {
    if (!antes!.cobranca!.primeiro_credito_em) {
      throw new ErroUsuario("A mensalidade da sua conta só começa no dia em que você usar o primeiro crédito. Cadastre o cartão a partir daí: ele paga a primeira mensalidade e as próximas.", 409);
    }
    const r = await iniciarMensalidade(d, cfg, esc);
    if (r.acao !== "iniciada" && r.acao !== "ja_iniciada") {
      throw new ErroUsuario("A primeira mensalidade da sua conta está sendo gerada. Tente de novo em alguns segundos.", 409);
    }
  }
  const cliente = await garantirCliente(d, asaas, esc);

  // 1. o cartão fica guardado no Asaas (token), sem cobrar nada
  let token: string | null = null;
  let bandeira: string | null = null;
  try {
    const t = await asaas.tokenizar({ customer: cliente, remoteIp: ip, ...dados });
    token = t.creditCardToken;
    bandeira = t.creditCardBrand ?? null;
    if (cfg.asaas_tokenizacao !== "liberada") await d.banco.gravarConfig({ asaas_tokenizacao: "liberada" });
  } catch (e) {
    // 403 = a conta do Asaas não liberou a tokenização: segue só com a mensalidade
    if (!(e instanceof ErroAsaas && e.status === 403)) throw cartaoRecusado(e);
    if (cfg.asaas_tokenizacao !== "bloqueada") await d.banco.gravarConfig({ asaas_tokenizacao: "bloqueada" });
  }
  const meio: CartaoParaAsaas = token ? { creditCardToken: token } : dados;

  // 2. a mensalidade passa para o cartão (e o que está em aberto é pago agora)
  const m = await mensalidadeNoCartao(d, cfg, asaas, esc, cliente, meio, ip);
  token = token ?? m.token;
  bandeira = bandeira ?? m.bandeira ?? bandeiraDoNumero(dados.creditCard.number);

  const v = lerValidade(cartao.validade, hoje)!;
  const final = dados.creditCard.number.slice(-4);
  await d.banco.salvarCartao(esc, {
    asaas_token: token, bandeira, final, validade: `${v.mes}/${v.ano}`, titular: dados.creditCard.holderName,
    cadastrado_por: u.id, cadastrado_em: new Date().toISOString(), recusa_em: null, recusa_motivo: null,
  });
  await d.banco.atividade(esc, "cartao.cadastrado", `${bandeira ?? "cartão"} final ${final}`, u.id).catch(() => {});
  return { ...m, token, bandeira, reutilizavel: !!token, final };
}

async function cartaoRemover(d: Deps, cfg: Record<string, string>, u: Usuario): Promise<Resposta> {
  const esc = exigirDono(u);
  const e = await d.banco.empresa(esc);
  const asaas = asaasDe(cfg, d.fetch);
  const sub = e?.cobranca?.asaas_assinatura_id && e.cobranca.situacao !== "cancelada" ? e.cobranca.asaas_assinatura_id : null;
  if (asaas && e && sub && e.cobranca?.asaas_cliente_id) {
    const atual = await asaas.assinatura(sub);
    if (atual.billingType === "CREDIT_CARD") {
      // a mensalidade volta para boleto/Pix, no mesmo vencimento e no mesmo período
      const hoje = d.hoje();
      const { ciclo, valor } = cobrancaDaEmpresa(cfg, e);
      const nova = await asaas.criarAssinatura({
        customer: e.cobranca.asaas_cliente_id, billingType: "UNDEFINED", value: valor > 0 ? valor : Number(atual.value ?? 0),
        nextDueDate: atual.nextDueDate && atual.nextDueDate > hoje ? atual.nextDueDate : hoje, cycle: ciclo,
        description: descricaoAssinatura(e, ciclo), externalReference: e.id,
      });
      await d.banco.salvarCobranca(e.id, { asaas_assinatura_id: nova.id });
      await asaas.removerAssinatura(sub).catch(() => null);
    }
  }
  await d.banco.salvarCartao(esc, null);
  await d.banco.atividade(esc, "cartao.removido", "", u.id).catch(() => {});
  return ok();
}

/** Compra de créditos paga na hora com o cartão salvo. */
async function comprarNoCartao(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  if (!u.escritorioId) throw new ErroUsuario("Sua conta não está ligada a uma empresa.", 403);
  const cartao = await d.banco.cartao(u.escritorioId);
  if (!cartao?.asaas_token) throw new ErroUsuario("Não há cartão salvo para compras. Cadastre o cartão ou pague por Pix.", 409);
  const ip = ipDe(u);
  const ped = await u.pedirCreditos(String(b.tipo ?? ""), Math.floor(Number(b.quantidade)));
  if (!ped.online || !ped.pagamento_id) return ok({ pedido: ped });
  let cob: CobrancaAsaas;
  try {
    const cliente = await garantirCliente(d, asaas, ped.escritorio_id);
    cob = await asaas.cobrarNoCartao({
      customer: cliente, value: ped.valor, dueDate: d.hoje(), description: `Vertces: ${ped.descricao}`,
      externalReference: ped.credito_id, remoteIp: ip, creditCardToken: cartao.asaas_token,
    });
  } catch (e) {
    await d.banco.cancelarCompra(ped.credito_id, ped.pagamento_id, `Cartão recusado: ${msg(e)}`);
    throw cartaoRecusado(e);
  }
  await d.banco.atualizarPagamento(ped.pagamento_id, {
    asaas_id: cob.id, status: cob.status || "PENDING", link: cob.invoiceUrl ?? null, vencimento: cob.dueDate ?? null, forma: "CREDIT_CARD",
  });
  if (cobrancaPaga(cob.status)) await aplicarEAvisar(d, cfg, "CONFERENCIA", cob);
  return ok({ credito_id: ped.credito_id, valor: ped.valor, descricao: ped.descricao, pago: cobrancaPaga(cob.status), link: cob.invoiceUrl ?? null, pix: null });
}

// ---------------------------------------------------------------- compra automática
//
// Quem chama é a tela (ao ver a carteira zerada, ao abrir um serviço sem
// crédito). O banco decide se pode (reservar_recarga_automatica: carteira
// zerada, cartão com token, teto do período, nenhuma em curso, sem recusa
// recente) e cria o pedido; aqui só se cobra o cartão.

export interface CompraAutomatica { tipo: string; descricao: string; valor: number; ok: boolean; erro?: string }

async function recargaAutomatica(d: Deps, cfg: Record<string, string>, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  const esc = u.escritorioId;
  if (!esc) throw new ErroUsuario("Sua conta não está ligada a uma empresa.", 403);
  const asaas = asaasDe(cfg, d.fetch);
  if (!asaas || !u.ip) return ok({ compras: [], motivos: {} });
  const tipos = typeof b.tipo === "string" && b.tipo ? [b.tipo] : await d.banco.recargasLigadas(esc);
  const compras: CompraAutomatica[] = [];
  const motivos: Record<string, string> = {};
  for (const tipo of tipos) {
    const r = await d.banco.reservarRecarga(esc, tipo, u.id);
    if (!r.pode) { motivos[tipo] = r.motivo; continue; }
    compras.push(await cobrarRecarga(d, cfg, asaas, u.ip, tipo, r));
  }
  return ok({ compras, motivos });
}

async function cobrarRecarga(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas, ip: string, tipo: string, r: PedidoCredito): Promise<CompraAutomatica> {
  const cartao = await d.banco.cartao(r.escritorio_id);
  try {
    if (!cartao?.asaas_token) throw new ErroUsuario("sem cartão salvo");
    const cliente = await garantirCliente(d, asaas, r.escritorio_id);
    const cob = await asaas.cobrarNoCartao({
      customer: cliente, value: r.valor, dueDate: d.hoje(), description: `Vertces: ${r.descricao} (compra automática)`,
      externalReference: r.credito_id, remoteIp: ip, creditCardToken: cartao.asaas_token,
    });
    await d.banco.atualizarPagamento(r.pagamento_id!, {
      asaas_id: cob.id, status: cob.status || "PENDING", link: cob.invoiceUrl ?? null, vencimento: cob.dueDate ?? null, forma: "CREDIT_CARD",
    });
    if (cobrancaPaga(cob.status)) await aplicarEAvisar(d, cfg, "CONFERENCIA", cob);
    return { tipo, descricao: r.descricao, valor: r.valor, ok: cobrancaPaga(cob.status) };
  } catch (e) {
    const motivo = msg(e);
    await d.banco.cancelarCompra(r.credito_id, r.pagamento_id, `Compra automática recusada: ${motivo}`);
    // segura novas tentativas por umas horas (não insistir num cartão recusado)
    await d.banco.salvarCartao(r.escritorio_id, { recusa_em: new Date().toISOString(), recusa_motivo: motivo.slice(0, 300) });
    const zap = zapDe(cfg);
    const emp = zap ? await d.banco.empresa(r.escritorio_id) : null;
    if (zap && emp?.telefone) {
      await enviarWhatsApp(zap, emp.telefone, mensagemRecargaRecusada({
        responsavel: emp.responsavel, empresa: emp.nome, descricao: r.descricao, final: cartao?.final ?? null, motivo, url: urlApp(cfg),
      }), d.fetch).catch(() => null);
    }
    return { tipo, descricao: r.descricao, valor: r.valor, ok: false, erro: motivo };
  }
}

// ---------------------------------------------------------------- autocadastro: o 1º período (0040)
//
// A empresa que se cadastrou pelo site (origem 'site') paga aqui, logada como
// dona, o 1º período que escolheu (mensal, semestral ou anual):
//   Pix      — a assinatura do período vencendo hoje; a tela mostra o QR e entra
//              sozinha quando o webhook (ou a conferência) confirmar;
//   cartão 1x — a assinatura no cartão, como "Cadastrar cartão" (mensalidadeNoCartao);
//   cartão 2x a 12x — uma compra parcelada no Asaas (a assinatura não parcela); paga,
//              a empresa ativa e a assinatura dos períodos seguintes nasce em
//              aplicarEAvisar, vencendo quando o período pago acaba (sem cobrar em dobro).
// O valor e as parcelas são recalculados aqui (_shared/parcelas.ts): o que vem do
// navegador é só a escolha.

async function pagarCadastro(d: Deps, cfg: Record<string, string>, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  if (!u.escritorioId) throw new ErroUsuario("Sua conta não está ligada a uma empresa.", 403);
  if (!u.souDono) throw new ErroUsuario("Só o dono da conta faz o pagamento.", 403);
  const asaas = exigirAsaas(d, cfg);
  const e = await d.banco.empresa(u.escritorioId);
  if (!e) throw new ErroUsuario("Empresa não encontrada.", 404);
  if (e.status === "ativo") return ok({ ja_ativa: true });
  if (e.status !== "aguardando_pagamento" || e.origem !== "site") {
    throw new ErroUsuario("O pagamento desta conta é pelo link que o Vertces enviou. Fale com o suporte se precisar de ajuda.", 409);
  }
  const situacao = e.cobranca?.situacao ?? "sem_assinatura";
  if (situacao !== "sem_assinatura" && situacao !== "aguardando") {
    throw new ErroUsuario("Esta conta não está esperando o primeiro pagamento. Fale com o suporte.", 409);
  }
  // dois cliques ou duas abas ao mesmo tempo cobrariam duas vezes: um pedido
  // por empresa a cada 15 s (o pagamento no cartão leva poucos segundos)
  if (d.limite && !(await d.limite(`pagar-cadastro-trava:${e.id}`, 1, 15))) {
    throw new ErroUsuario("Já há um pagamento desta conta sendo processado. Aguarde alguns segundos e veja se a conta foi liberada antes de tentar de novo.", 429);
  }
  // cartão é alvo de teste de número roubado: poucas tentativas por empresa e por IP
  if (d.limite && !(await d.limite(`pagar-cadastro:${e.id}`, 20, 3600))) throw new ErroUsuario(MUITAS_CHAMADAS.erro, MUITAS_CHAMADAS.status);
  if (b.forma === "cartao" && d.limite && !(await d.limite(`pagar-cadastro-ip:${ipDe(u)}`, 10, 3600))) throw new ErroUsuario(MUITAS_CHAMADAS.erro, MUITAS_CHAMADAS.status);

  const regras = regrasDe(cfg);
  const ciclo = cicloDe(b.ciclo) ?? cicloDe(e.cobranca?.ciclo) ?? "MONTHLY";
  if (!regras.ciclos[ciclo].ativo) throw new ErroUsuario(`O período ${NOME_CICLO[ciclo].toLowerCase()} não está disponível. Escolha outro.`);
  const mensalidade = Number(e.mensalidade ?? 0);
  if (!(mensalidade > 0)) throw new ErroUsuario("O plano desta conta está sem mensalidade. Fale com o suporte.", 409);
  const valor = valorDoPeriodo(mensalidade, ciclo, regras.ciclos[ciclo].desconto);
  // a adesão (0044) vem junto do 1º pagamento: uma compra avulsa (período + adesão)
  // e a assinatura das renovações nasce depois de pago, só com o plano
  const adesao = regras.adesao;
  const total = totalComAdesao(valor, adesao);
  // dois cartões aprovados cobrariam duas vezes: o que está em análise decide primeiro
  const pendentesAntes = await d.banco.pagamentosPendentes(e.id);
  if (pendentesAntes.some((p) => p.status === "AWAITING_RISK_ANALYSIS")) {
    throw new ErroUsuario("O pagamento anterior no cartão está em análise pelo Asaas. Aguarde a resposta (em geral alguns minutos, no máximo 48 horas) antes de tentar de novo.", 409);
  }
  // compra no cartão em aberto (o Asaas não aprovou na hora e não deu para cancelar): ela decide primeiro
  if (pendentesAntes.some((p) => p.forma === "CREDIT_CARD")) {
    throw new ErroUsuario("Há uma compra no cartão desta conta esperando a resposta do Asaas. Aguarde alguns minutos ou fale com o suporte antes de pagar de novo.", 409);
  }

  if (b.forma === "pix") {
    return adesao > 0
      ? await pagarCadastroPixComAdesao(d, cfg, asaas, e, ciclo, valor, adesao)
      : await pagarCadastroPix(d, cfg, asaas, e, ciclo, valor);
  }
  if (b.forma !== "cartao") throw new ErroUsuario("Escolha Pix ou cartão.");
  const p = escolherParcelas(total, ciclo, b.parcelas ?? 1, regras);
  if (!p) throw new ErroUsuario(`No período ${NOME_CICLO[ciclo].toLowerCase()}, o cartão aceita de 1 a ${maxParcelas(regras, ciclo)} parcela(s).`);
  const cartao = (b.cartao ?? {}) as CartaoDigitado;
  const titular = (b.titular ?? {}) as TitularDigitado;
  const problema = Object.values(problemasDoCartao(cartao, titular, d.hoje()))[0];
  if (problema) throw new ErroUsuario(problema);
  ipDe(u);
  // a tentativa anterior (o Pix gerado antes): paga, vale ela; senão sai, para não cobrar duas vezes
  const jaPaga = await limparTentativa(d, cfg, asaas, e);
  if (jaPaga) return ok({ forma: "pix", ciclo: cicloDe(e.cobranca?.ciclo) ?? ciclo, ...jaPaga });
  if (p.n === 1 && !(adesao > 0)) {
    await d.banco.salvarCobranca(e.id, { ciclo, valor });
    const r = await cadastrarCartao(d, cfg, asaas, u, e.id, cartao, titular);
    return ok({ forma: "cartao", ciclo, valor, parcelas: 1, parcela: valor, final: r.final, pago: r.pagas > 0, ativou: r.ativou, em_analise: r.emAnalise });
  }
  return await pagarCadastroParcelado(d, cfg, asaas, u, e, ciclo, p, regras, cartao, titular, adesao);
}

/**
 * O Pix do 1º pagamento com adesão (0044): uma cobrança avulsa de período +
 * adesão (a assinatura não tem como cobrar a adesão só na 1ª fatura). Paga, o
 * banco devolve criar_assinatura e a assinatura das renovações nasce vencendo
 * quando o período pago acaba, só com o valor do plano.
 */
async function pagarCadastroPixComAdesao(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas, e: EmpresaCobranca,
  ciclo: Ciclo, valor: number, adesao: number): Promise<Resposta> {
  const total = totalComAdesao(valor, adesao);
  const base = { forma: "pix", ciclo, valor: total, periodo: valor, adesao };
  // o mesmo Pix já gerado (mesmo período e mesmo total): devolve ele, sem criar outro
  const abertas = (await d.banco.comprasAvulsasAbertas?.(e.id)) ?? [];
  const mesma = abertas.find((a) => (cicloDe(a.ciclo) ?? "MONTHLY") === ciclo && Number(a.valor) === total);
  if (mesma && !e.cobranca?.asaas_assinatura_id) {
    const cob = await asaas.cobranca(mesma.asaas_id);
    if (cobrancaPaga(cob.status)) {
      const r = await aplicarEAvisar(d, cfg, "CONFERENCIA", cob);
      return ok({ ...base, ja_pago: true, pago: true, ativou: r.acao === "ativou" });
    }
    if (!cob.deleted && pendente(cob)) {
      return ok({ ...base, link: cob.invoiceUrl ?? mesma.link ?? null, vencimento: cob.dueDate, pix: await asaas.pix(cob.id).catch(() => null) });
    }
  }
  const jaPaga = await limparTentativa(d, cfg, asaas, e);
  if (jaPaga) return ok({ forma: "pix", ciclo: cicloDe(e.cobranca?.ciclo) ?? ciclo, ...jaPaga });
  const cliente = await garantirCliente(d, asaas, e.id);
  const hoje = d.hoje();
  const cob = await asaas.criarCobranca({
    customer: cliente, billingType: "PIX", value: total, dueDate: hoje,
    description: descricaoDaCompra(e.plano, ciclo, parcelamento(total, 1, regrasDe(cfg)), regrasDe(cfg), adesao),
    externalReference: e.id,
  });
  await d.banco.inserirPagamento({
    escritorio_id: e.id, finalidade: "mensalidade", asaas_id: cob.id, valor: total, status: cob.status || "PENDING", forma: "PIX",
    link: cob.invoiceUrl ?? null, vencimento: cob.dueDate || hoje, parcelas: 1, ciclo, adesao,
  });
  await d.banco.salvarCobranca(e.id, {
    asaas_cliente_id: cliente, valor, ciclo, situacao: "aguardando", link_pagamento: cob.invoiceUrl ?? null, proximo_vencimento: cob.dueDate || hoje,
  });
  // o mês do crédito começa no dia do pagamento
  await d.banco.atualizarEmpresa(e.id, { dia_renovacao: Number(hoje.slice(8, 10)) });
  const pix = await asaas.pix(cob.id).catch(() => null);
  return ok({ ...base, link: cob.invoiceUrl ?? null, vencimento: cob.dueDate || hoje, pix });
}

/**
 * A assinatura que uma tentativa anterior deixou (o Pix de outro período, ou de
 * quem trocou para o cartão). Já paga: aplica e devolve o resultado (nada mais é
 * cobrado). Em aberto: sai do Asaas com as faturas dela.
 */
async function limparTentativa(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas, e: EmpresaCobranca):
  Promise<{ ja_pago: true; pago: true; ativou: boolean; valor: number } | null> {
  // o Pix avulso (período + adesão, 0044) de uma tentativa anterior: pago vale; senão sai
  for (const a of (await d.banco.comprasAvulsasAbertas?.(e.id)) ?? []) {
    let cob: CobrancaAsaas | null = null;
    try { cob = await asaas.cobranca(a.asaas_id); } catch (x) { if (!(x instanceof ErroAsaas && x.status === 404)) throw x; }
    if (cob && !cob.deleted && cobrancaPaga(cob.status)) {
      const r = await aplicarEAvisar(d, cfg, "CONFERENCIA", cob);
      return { ja_pago: true, pago: true, ativou: r.acao === "ativou", valor: Number(a.valor ?? cob.value ?? 0) };
    }
    if (cob && !cob.deleted) {
      try { await asaas.removerCobranca(a.asaas_id); } catch (x) { if (!(x instanceof ErroAsaas && x.status === 404)) throw x; }
    }
    await d.banco.atualizarPagamento(a.id, { status: "DELETED" });
    await d.banco.salvarCobranca(e.id, { link_pagamento: null });
  }
  const sub = e.cobranca?.asaas_assinatura_id;
  if (!sub) return null;
  const cobs = await asaas.cobrancasDaAssinatura(sub);
  const paga = cobs.find((c) => !c.deleted && cobrancaPaga(c.status));
  if (paga) {
    const r = await aplicarEAvisar(d, cfg, "CONFERENCIA", paga);
    return { ja_pago: true, pago: true, ativou: r.acao === "ativou", valor: Number(paga.value ?? e.cobranca?.valor ?? 0) };
  }
  try { await asaas.removerAssinatura(sub); } catch (x) {
    // já não existe: segue; outro erro: para (a fatura antiga ainda poderia ser paga)
    if (!(x instanceof ErroAsaas && x.status === 404)) throw x;
  }
  await d.banco.salvarCobranca(e.id, { asaas_assinatura_id: null, link_pagamento: null, situacao: "sem_assinatura", proximo_vencimento: null });
  return null;
}

async function pagarCadastroPix(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas, e: EmpresaCobranca, ciclo: Ciclo, valor: number): Promise<Resposta> {
  const atual = e.cobranca;
  // o mesmo período já gerado: devolve a fatura em aberto (não cria outra)
  if (atual?.asaas_assinatura_id && (cicloDe(atual.ciclo) ?? "MONTHLY") === ciclo && Number(atual.valor) === valor) {
    const cobs = (await asaas.cobrancasDaAssinatura(atual.asaas_assinatura_id)).filter((c) => !c.deleted).sort(porVencimento);
    const paga = cobs.find((c) => cobrancaPaga(c.status));
    if (paga) {
      const r = await aplicarEAvisar(d, cfg, "CONFERENCIA", paga);
      return ok({ forma: "pix", ciclo, valor, ja_pago: true, pago: true, ativou: r.acao === "ativou" });
    }
    const aberta = cobs.find(pendente);
    if (aberta) {
      return ok({ forma: "pix", ciclo, valor, link: aberta.invoiceUrl ?? null, vencimento: aberta.dueDate, pix: await asaas.pix(aberta.id).catch(() => null) });
    }
  }
  const jaPaga = await limparTentativa(d, cfg, asaas, e);
  if (jaPaga) return ok({ forma: "pix", ciclo: cicloDe(atual?.ciclo) ?? ciclo, ...jaPaga });
  const cliente = await garantirCliente(d, asaas, e.id);
  const hoje = d.hoje();
  const sub = await asaas.criarAssinatura({
    customer: cliente, billingType: "UNDEFINED", value: valor, nextDueDate: hoje, cycle: ciclo,
    description: descricaoAssinatura(e, ciclo), externalReference: e.id,
  });
  const primeira = (await asaas.cobrancasDaAssinatura(sub.id)).sort(porVencimento)[0];
  if (!primeira) {
    await asaas.removerAssinatura(sub.id).catch(() => null);
    throw new ErroAsaas("O Asaas não gerou a cobrança. Tente de novo em instantes.", 502);
  }
  await d.banco.inserirPagamento({
    escritorio_id: e.id, finalidade: "mensalidade", asaas_id: primeira.id, valor: primeira.value ?? valor, status: primeira.status || "PENDING",
    link: primeira.invoiceUrl ?? null, vencimento: primeira.dueDate, ciclo,
  });
  await d.banco.salvarCobranca(e.id, {
    asaas_cliente_id: cliente, asaas_assinatura_id: sub.id, valor, ciclo, situacao: "aguardando",
    link_pagamento: primeira.invoiceUrl ?? null, proximo_vencimento: primeira.dueDate,
  });
  // o mês do crédito começa no dia do pagamento
  await d.banco.atualizarEmpresa(e.id, { dia_renovacao: Number(hoje.slice(8, 10)) });
  const pix = await asaas.pix(primeira.id).catch(() => null);
  return ok({ forma: "pix", ciclo, valor, link: primeira.invoiceUrl ?? null, vencimento: primeira.dueDate, pix });
}

async function pagarCadastroParcelado(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas, u: Usuario, e: EmpresaCobranca,
  ciclo: Ciclo, p: Parcelamento, regras: RegrasPagamento, cartao: CartaoDigitado, titular: TitularDigitado, adesao = 0): Promise<Resposta> {
  const hoje = d.hoje();
  const ip = ipDe(u);
  const dados = paraAsaas(cartao, titular, hoje);
  const cliente = await garantirCliente(d, asaas, e.id);
  const descricao = descricaoDaCompra(e.plano, ciclo, p, regras, adesao);
  let cob: CobrancaAsaas;
  try {
    // 1x só acontece aqui com adesão (0044): uma cobrança avulsa no cartão, à vista
    cob = p.n === 1
      ? await asaas.cobrarNoCartao({ customer: cliente, value: p.total, dueDate: hoje, description: descricao, externalReference: e.id, remoteIp: ip, ...dados })
      : await cobrarParcelado(d, cfg, asaas, {
        customer: cliente, dueDate: hoje, installmentCount: p.n,
        ...(p.juros ? { installmentValue: p.parcela } : { totalValue: p.total }),
        description: descricao, externalReference: e.id, remoteIp: ip, ...dados,
      }, p.parcela);
  } catch (x) { throw cartaoRecusado(x); }
  // nem pago nem em análise: não fica uma compra em aberto que o Asaas ainda
  // poderia cobrar enquanto a pessoa paga de outro jeito — cancela e diz
  if (!cobrancaPaga(cob.status) && cob.status !== "AWAITING_RISK_ANALYSIS") {
    let cancelou = false;
    try {
      if (cob.installment) await asaas.removerParcelamento(cob.installment); else await asaas.removerCobranca(cob.id);
      cancelou = true;
    } catch { /* fica registrada abaixo como pendente: o pré-teste barra nova tentativa até resolver */ }
    if (cancelou) throw new ErroUsuario("O cartão não foi aprovado na hora e a compra foi cancelada (nada foi cobrado). Confira os dados ou use outro cartão ou o Pix.", 402);
  }
  // a 1ª parcela guarda o TOTAL, o nº de parcelas e o parcelamento (as outras chegam pelo webhook)
  await d.banco.inserirPagamento({
    escritorio_id: e.id, finalidade: "mensalidade", asaas_id: cob.id, valor: p.total, status: cob.status || "PENDING", forma: "CREDIT_CARD",
    link: cob.invoiceUrl ?? null, vencimento: cob.dueDate || hoje, parcelas: p.n, asaas_parcelamento: cob.installment ?? null, ciclo,
    ...(adesao > 0 ? { adesao } : {}),
  });
  await d.banco.salvarCobranca(e.id, { asaas_cliente_id: cliente, valor: valorDoPeriodo(Number(e.mensalidade ?? 0), ciclo, regras.ciclos[ciclo].desconto), ciclo, situacao: "aguardando", link_pagamento: null });
  await d.banco.atualizarEmpresa(e.id, { dia_renovacao: Number(hoje.slice(8, 10)) });
  const final = dados.creditCard.number.slice(-4);
  await d.banco.atividade(e.id, "pagamento.parcelado", `${p.n}x (${NOME_CICLO[ciclo].toLowerCase()}) no cartão final ${final}`, u.id).catch(() => {});
  const base = { forma: "cartao", ciclo, valor: p.total, parcelas: p.n, parcela: p.parcela, final, ...(adesao > 0 ? { adesao } : {}) };
  if (cobrancaPaga(cob.status)) {
    const r = await aplicarEAvisar(d, cfg, "CONFERENCIA", cob);
    return ok({ ...base, pago: true, ativou: r.acao === "ativou", assinatura: r.assinatura ?? null });
  }
  if (cob.status === "AWAITING_RISK_ANALYSIS") {
    await aplicarEAvisar(d, cfg, "CONFERENCIA", cob);
    return ok({ ...base, em_analise: true });
  }
  return ok({ ...base, pendente: true });
}

/**
 * A compra parcelada no Asaas. A referência marca `value` como obrigatório, mas
 * os exemplos de parcelamento não o mandam (incerteza da pesquisa de 05/11/2026).
 * Vai sem `value`; se a conta recusar por causa DELE (400 sobre o campo value —
 * numa recusa nada é cobrado nem gravado), repete uma vez com `value` = a parcela
 * e lembra (cobranca_config.asaas_parcelado_value = "enviar", que o superadmin
 * também liga à mão em Autocadastro → Avançado). Recusa do cartão não repete.
 */
async function cobrarParcelado(d: Deps, cfg: Record<string, string>, asaas: ClienteAsaas,
  corpo: Parameters<ClienteAsaas["cobrarParcelado"]>[0], parcela: number): Promise<CobrancaAsaas> {
  const comValue = { ...corpo, value: parcela };
  if (cfg.asaas_parcelado_value === "enviar") return await asaas.cobrarParcelado(comValue);
  try {
    return await asaas.cobrarParcelado(corpo);
  } catch (x) {
    const pedeValue = x instanceof ErroAsaas && x.status === 400 && (/(^|_)value$/i.test(x.codigo ?? "") || /\bvalue\b/i.test(x.message));
    if (!pedeValue) throw x;
    const cob = await asaas.cobrarParcelado(comValue);
    await d.banco.gravarConfig({ asaas_parcelado_value: "enviar" }).catch(() => {});
    return cob;
  }
}
