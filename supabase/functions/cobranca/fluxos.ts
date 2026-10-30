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
//   superadmin: config_status · config_salvar · whatsapp_testar { telefone }
//               cobrar_empresa { escritorio_id, enviar_whatsapp?, login?, senha? }
//               atualizar_assinatura · cancelar_assinatura · conferir { escritorio_id? }

import { ambienteValido, clienteAsaas, cobrancaPaga, ErroAsaas, garantirWebhook } from "../_shared/asaas.ts";
import type { ClienteAsaas, CobrancaAsaas } from "../_shared/asaas.ts";
import { enviarWhatsApp, estadoWhatsApp, whatsappConfigurado } from "../_shared/whatsapp.ts";
import type { ConfigWhatsApp } from "../_shared/whatsapp.ts";
import { mensagemAcessoLiberado, mensagemAcessoSuspenso, mensagemCobranca, mensagemCreditosPagos, textoCreditos } from "../_shared/mensagens_cobranca.ts";
import type { CarteiraDoPlano } from "../_shared/mensagens_cobranca.ts";

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
  cobranca: {
    asaas_cliente_id: string | null; asaas_assinatura_id: string | null; situacao: string;
    link_pagamento: string | null; valor: number | null; proximo_vencimento: string | null;
  } | null;
}

export interface ResultadoPagamento { acao: string; escritorio_id?: string; credito_id?: string | null }

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
  pagamentosPendentes(escritorioId: string | null): Promise<{ asaas_id: string; status: string }[]>;
  descricaoCredito(creditoId: string | null | undefined): Promise<string | null>;
}

export interface PedidoCredito {
  credito_id: string; pagamento_id: string | null; escritorio_id: string; online: boolean;
  quantidade: number; unitario: number; valor: number; descricao: string;
}

export interface Usuario {
  id: string; email: string | null; superadmin: boolean;
  /** a empresa da pessoa, mesmo esperando pagamento */
  escritorioId: string | null;
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

function asaasDe(cfg: Record<string, string>, f: typeof fetch): ClienteAsaas | null {
  if (!cfg.asaas_api_key) return null;
  return clienteAsaas(cfg.asaas_api_key, ambienteValido(cfg.asaas_ambiente) ? cfg.asaas_ambiente : "sandbox", f);
}
function zapDe(cfg: Record<string, string>): ConfigWhatsApp | null {
  const c = { url: cfg.whatsapp_url, chave: cfg.whatsapp_chave, instancia: cfg.whatsapp_instancia };
  return whatsappConfigurado(c) ? c : null;
}
const urlApp = (cfg: Record<string, string>) => cfg.url_app || URL_APP_PADRAO;

// =========================================================================== webhook

export async function tratarWebhook(d: Deps, token: string | null, texto: string): Promise<Resposta> {
  const cfg = await d.banco.config();
  let corpo: { id?: string; event?: string; payment?: CobrancaAsaas } | null = null;
  try { corpo = JSON.parse(texto); } catch { /* corpo inválido */ }
  if (!cfg.asaas_webhook_token || !mesmoToken(token ?? "", cfg.asaas_webhook_token)) {
    // a recusa deixa rastro: sem isto, um token trocado só aparece quando o Asaas desliga a fila
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

/** Aplica a cobrança e manda o WhatsApp do que mudou para a empresa. */
async function aplicarEAvisar(d: Deps, cfg: Record<string, string>, evento: string, pagamento: CobrancaAsaas):
  Promise<ResultadoPagamento & { aviso?: string }> {
  const r = await d.banco.aplicarPagamento(evento, pagamento);
  const zap = zapDe(cfg);
  if (!zap || !r.escritorio_id || (r.acao !== "ativou" && r.acao !== "creditos" && r.acao !== "suspendeu")) return r;
  const e = await d.banco.empresa(r.escritorio_id);
  if (!e?.telefone) return { ...r, aviso: "sem telefone para o WhatsApp" };
  const texto = r.acao === "ativou"
    ? mensagemAcessoLiberado({ responsavel: e.responsavel, empresa: e.nome, url: urlApp(cfg), login: e.login, creditos: textoCreditos(e.creditos) })
    : r.acao === "suspendeu"
      ? mensagemAcessoSuspenso({
        responsavel: e.responsavel, empresa: e.nome, valor: pagamento.value ?? e.cobranca?.valor ?? e.mensalidade,
        link: pagamento.invoiceUrl ?? e.cobranca?.link_pagamento ?? null, vencimento: pagamento.dueDate || e.cobranca?.proximo_vencimento,
      })
      : mensagemCreditosPagos({ responsavel: e.responsavel, empresa: e.nome, descricao: (await d.banco.descricaoCredito(r.credito_id)) ?? "os créditos" });
  const env = await enviarWhatsApp(zap, e.telefone, texto, d.fetch);
  return { ...r, aviso: env.ok ? "WhatsApp enviado" : `WhatsApp: ${env.erro}` };
}

// =========================================================================== ações

export async function tratarAcao(d: Deps, u: Usuario, b: Record<string, unknown>): Promise<Resposta> {
  try {
    const cfg = await d.banco.config();
    const superadmin = (f: () => Promise<Resposta>) => (u.superadmin ? f() : Promise.resolve(falha(403, "Acesso restrito ao administrador do sistema.")));
    switch (b.acao) {
      case "comprar_creditos": return await comprarCreditos(d, cfg, u, b);
      case "pix": return await pixDaCompra(d, cfg, u, b);
      case "cancelar_compra": return await cancelarCompra(d, cfg, u, b);
      case "conferir": return await conferir(d, cfg, u, b);
      case "config_status": return await superadmin(() => configStatus(d, cfg));
      case "config_salvar": return await superadmin(() => configSalvar(d, cfg, u, b));
      case "whatsapp_testar": return await superadmin(() => whatsappTestar(d, cfg, b));
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
  const doc = (e.cnpj ?? "").replace(/\D/g, "");
  if (!doc) throw new ErroUsuario("Cadastre o CNPJ da empresa para gerar a cobrança.");
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
  return ok({ conferidos: pendentes.length, mudancas });
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
        a.webhook = { url: w.url, ativo: w.enabled, interrompido: w.interrupted, penalizados: w.penalizedRequestsCount ?? 0 };
      } catch (e) { a.webhook = { erro: msg(e) }; }
    }
  }
  const zap = zapDe(cfg);
  const w = zap
    ? { configurado: true, url: zap.url, instancia: zap.instancia, estado: await estadoWhatsApp(zap, d.fetch) }
    : { configurado: false };
  return ok({ asaas: a, whatsapp: w, url_app: urlApp(cfg), ultimo_evento: await d.banco.ultimoEvento() });
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
    link: c.invoiceUrl ?? null, vencimento: c.dueDate,
  });
  await d.banco.salvarCobranca(e.id, { link_pagamento: c.invoiceUrl ?? null, proximo_vencimento: c.dueDate });
  return { link: c.invoiceUrl ?? null, vencimento: c.dueDate };
}

async function cobrarEmpresa(d: Deps, cfg: Record<string, string>, b: Record<string, unknown>): Promise<Resposta> {
  const asaas = exigirAsaas(d, cfg);
  const id = String(b.escritorio_id ?? "");
  let e = await d.banco.empresa(id);
  if (!e) throw new ErroUsuario("Empresa não encontrada.", 404);
  const valor = Number(e.mensalidade ?? 0);
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
    const sub = await asaas.criarAssinatura({
      customer: cliente, billingType: "UNDEFINED", value: valor, nextDueDate: hoje, cycle: "MONTHLY",
      description: e.plano ? `Vertces: plano ${e.plano}` : "Vertces: mensalidade", externalReference: e.id,
    });
    const primeira = (await asaas.cobrancasDaAssinatura(sub.id)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
    if (!primeira) {
      await asaas.removerAssinatura(sub.id).catch(() => null);
      throw new ErroAsaas("O Asaas não gerou a primeira cobrança da assinatura. Tente de novo em instantes.", 502);
    }
    await d.banco.inserirPagamento({
      escritorio_id: e.id, finalidade: "mensalidade", asaas_id: primeira.id, valor: primeira.value ?? valor,
      status: primeira.status || "PENDING", link: primeira.invoiceUrl ?? null, vencimento: primeira.dueDate,
    });
    await d.banco.salvarCobranca(e.id, {
      asaas_cliente_id: cliente, asaas_assinatura_id: sub.id, valor, situacao: "aguardando",
      link_pagamento: primeira.invoiceUrl ?? null, proximo_vencimento: primeira.dueDate,
    });
    // empresa nova: o mês do crédito começa no dia do vencimento da mensalidade
    if (e.status === "aguardando_pagamento") await d.banco.atualizarEmpresa(e.id, { dia_renovacao: Number(hoje.slice(8, 10)) });
    link = primeira.invoiceUrl ?? null;
    vencimento = primeira.dueDate;
  }
  if (!link) throw new ErroAsaas("O Asaas não devolveu o link da cobrança.", 502);
  e = (await d.banco.empresa(id)) ?? e;
  const texto = mensagemCobranca({
    responsavel: e.responsavel, empresa: e.nome, plano: e.plano, valor, link, vencimento, url: urlApp(cfg),
    login: typeof b.login === "string" && b.login ? b.login : e.login,
    senha: typeof b.senha === "string" && b.senha ? b.senha : null,
    creditos: textoCreditos(e.creditos),
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
  const valor = Number(e.mensalidade ?? 0);
  if (!(valor > 0)) throw new ErroUsuario("A mensalidade da empresa está zerada: cancele a assinatura em vez de atualizar.");
  await asaas.atualizarAssinatura(e.cobranca.asaas_assinatura_id, {
    value: valor, updatePendingPayments: true, description: e.plano ? `Vertces: plano ${e.plano}` : undefined,
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
