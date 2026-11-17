// Autocadastro (migração 0040): a ação PÚBLICA da função `cobranca`, chamada
// pela página #/assinar sem login.
//
//   cadastro_criar { empresa, documento, responsavel, email, telefone, senha,
//                    plano_id, ciclo, aceite_termos, versao_termos, site, convite? }
//
// Com `convite` (0049, o token do link /cadastro/?convite=…, gerado pela equipe):
// o plano é o do convite, a empresa nasce ATIVA (origem 'convite') e a cobrança
// só começa no 1º crédito gasto (cobranca_empresas.inicio_no_primeiro_credito).
// O convite é de uso único: reservado no banco antes de criar a conta e
// devolvido se a criação falhar. Vale mesmo com o cadastro pelo site fechado.
//
// Cria a conta e a empresa do mesmo jeito que o superadmin cria (superadmin/
// index.ts → criarEmpresa): conta no Auth já confirmada (a VPS não manda e-mail;
// sem senha provisória, a pessoa escolheu a dela), empresa em
// aguardando_pagamento com origem 'site', dona, razão social e documento em
// Configurações, e a cobrança com o período e o valor escolhidos. O aceite dos
// termos vai nos metadados da conta e o gatilho ao_criar_usuario (0020) grava em
// aceites_termos, como no cadastro antigo. Se um passo falha, desfaz o que foi
// criado. Depois a tela entra com o e-mail e a senha e paga (pagar_cadastro).
//
// Cupom (0052): `cupom` no cadastro_criar é conferido antes de criar a conta e
// reservado (sob trava, contando o limite de usos) logo depois de criar a
// empresa; a foto dele fica na cobrança e o pagamento (pagar_cadastro) faz a
// conta. Cupom que zera o 1º pagamento (meses grátis sem adesão) libera a conta
// na hora. A ação pública cupom_conferir { codigo, plano_id } mostra o desconto
// antes de criar a conta (limitada por IP: ninguém testa códigos no atacado).
//
// Contra abuso (o signup do Auth segue DESLIGADO, auditoria de 04/11/2026):
// campo escondido `site` (robô preenche), limite por IP (5 por hora, 15 por
// dia) e no total (200 por dia), tudo conferido aqui — a tela não decide nada.
// Sem Deno nem supabase-js, como fluxos.ts (tests/cobranca.test.mjs).

import { asaasDe, ErroUsuario, liberarComCupom, urlApp, zapDe } from "./fluxos.ts";
import type { Deps, Resposta } from "./fluxos.ts";
import { codigoValido, cupomDe, MOTIVO_CUPOM, normalizarCodigo, primeiroPagamento, resumoDoCupom } from "../_shared/cupons.ts";
import type { Cupom } from "../_shared/cupons.ts";
import { ErroAsaas } from "../_shared/asaas.ts";
import { formatarDocumento, formatarTelefone, problemasDoCadastro, soDigitos } from "../_shared/cnpj.ts";
import { enviarWhatsApp } from "../_shared/whatsapp.ts";
import {
  mensagemCadastroComCupom, mensagemCadastroConvite, mensagemCadastroCriado, mensagemNovoCadastro, mensagemNovoConvite, textoCreditos,
} from "../_shared/mensagens_cobranca.ts";
import { cicloDe, maxParcelas, NOME_CICLO, regrasDe, valorDoPeriodo } from "../_shared/parcelas.ts";
import { fmtReais } from "../_shared/precos.ts";
import type { Ciclo } from "../_shared/parcelas.ts";

/** Limites do cadastro: [chave, máximo, janela em segundos]. */
/** Tentativas de cupom por IP (conferir + cadastrar): [chave, máximo, janela em segundos]. */
export const LIMITES_CUPOM = (ip: string): [string, number, number][] => [
  [`cupom:ip-hora:${ip}`, 20, 3600],
  [`cupom:ip-dia:${ip}`, 60, 86400],
  // todas as conexões juntas (se o IP vier trocado a cada pedido, ainda há um teto)
  ["cupom:total-dia", 2000, 86400],
];

export const LIMITES_CADASTRO = (ip: string): [string, number, number][] => [
  [`cadastro:ip-hora:${ip}`, 5, 3600],
  [`cadastro:ip-dia:${ip}`, 15, 86400],
  ["cadastro:total-dia", 500, 86400],
];

const ok = (corpo: Record<string, unknown> = {}): Resposta => ({ status: 200, corpo: { ok: true, ...corpo } });
const falha = (status: number, erro: string): Resposta => ({ status, corpo: { erro } });

/** A entrada sem login (index.ts manda para cá antes de conferir a sessão). */
export async function tratarPublico(d: Deps, ip: string | null, b: Record<string, unknown>): Promise<Resposta> {
  try {
    if (b.acao === "cadastro_criar") return await cadastroCriar(d, ip, b);
    if (b.acao === "cupom_conferir") return await cupomConferir(d, ip, b);
    return falha(400, "Ação desconhecida.");
  } catch (e) {
    if (e instanceof ErroUsuario) return falha(e.status, e.message);
    if (e instanceof ErroAsaas) return falha(502, e.message);
    // página pública: o detalhe do erro interno não sai daqui
    return falha(500, "Não foi possível concluir o cadastro agora. Tente de novo em instantes.");
  }
}

/**
 * Documento OU e-mail já em uso: a mesma frase para os dois, para a página
 * pública não servir de consulta de quem é cliente (qual CPF/CNPJ ou e-mail).
 */
export const JA_EXISTE = "Não foi possível concluir o cadastro com estes dados. Se você já tem conta no Vertces, entre com ela; se não, fale com o suporte.";

/** Horas sem pagamento para um cadastro do site dar lugar a outro com o mesmo documento ou e-mail. */
export const HORAS_ABANDONO = 24;

async function liberarAbandonados(d: Deps, cfg: Record<string, string>, documento: string, email: string): Promise<void> {
  if (!d.banco.cadastrosAbandonados) return;
  const velhos = await d.banco.cadastrosAbandonados(documento, email, HORAS_ABANDONO).catch(() => []);
  const asaas = asaasDe(cfg, d.fetch);
  for (const v of velhos) {
    try {
      // o Pix/boleto em aberto do cadastro antigo sai do Asaas antes (não pode ser pago depois)
      const e = await d.banco.empresa(v.escritorioId);
      const sub = e?.cobranca?.asaas_assinatura_id;
      if (sub && asaas) {
        try { await asaas.removerAssinatura(sub); } catch (x) { if (!(x instanceof ErroAsaas && x.status === 404)) throw x; }
      }
      // o Pix avulso com a adesão (0044) também sai
      for (const a of (asaas && d.banco.comprasAvulsasAbertas ? await d.banco.comprasAvulsasAbertas(v.escritorioId) : [])) {
        try { await asaas!.removerCobranca(a.asaas_id); } catch (x) { if (!(x instanceof ErroAsaas && x.status === 404)) throw x; }
      }
      await d.banco.removerEmpresa(v.escritorioId);
      for (const c of v.contas) await d.banco.removerConta(c).catch(() => {});
      await d.banco.atividade(v.escritorioId, "empresa.cadastro_abandonado_removido", `${HORAS_ABANDONO} h sem pagamento`, null).catch(() => {});
    } catch { /* não deu para liberar: segue e o cadastro novo cai no "já existe" */ }
  }
}

async function avisarTetoDoDia(d: Deps, cfg: Record<string, string>): Promise<void> {
  const zap = zapDe(cfg);
  if (!zap || !cfg.whatsapp_avisos) return;
  if (d.limite && !(await d.limite("cadastro:aviso-teto", 1, 86400))) return;
  await enviarWhatsApp(zap, cfg.whatsapp_avisos, "Vertces: o cadastro pelo site chegou ao teto do dia (500). Novos cadastros estão barrados até amanhã — confira em Autocadastro se é ataque.", d.fetch);
}

const texto = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

/** Gasta uma tentativa de cupom deste IP; false = passou do limite. */
async function tentativaDeCupom(d: Deps, ip: string | null): Promise<boolean> {
  if (!d.limite) return true;
  for (const [chave, max, janela] of LIMITES_CUPOM(ip ?? "desconhecido")) {
    if (!(await d.limite(chave, max, janela))) return false;
  }
  return true;
}

/**
 * 0052: a página de cadastro confere o cupom antes de criar a conta e mostra o
 * desconto. Só diz se vale e o que dá; o que conta é o cadastro_criar.
 */
async function cupomConferir(d: Deps, ip: string | null, b: Record<string, unknown>): Promise<Resposta> {
  const codigo = normalizarCodigo(b.codigo);
  if (!codigoValido(codigo)) return ok({ valido: false, motivo: "inexistente", mensagem: MOTIVO_CUPOM.inexistente });
  if (!d.banco.conferirCupom) return ok({ valido: false, motivo: "inexistente", mensagem: MOTIVO_CUPOM.inexistente });
  if (!(await tentativaDeCupom(d, ip))) return falha(429, MOTIVO_CUPOM.muitas);
  const plano = String(b.plano_id ?? "");
  const r = await d.banco.conferirCupom(codigo, /^[0-9a-f-]{36}$/i.test(plano) ? plano : null);
  if (!r.valido) return ok({ valido: false, motivo: r.motivo, mensagem: MOTIVO_CUPOM[r.motivo] ?? MOTIVO_CUPOM.inexistente });
  return ok({ valido: true, cupom: cupomDe(r.cupom) });
}

/** O convite (0049) não vale: usado, cancelado, vencido ou desconhecido. */
export const CONVITE_INVALIDO = "Este convite não vale mais: já foi usado, foi cancelado ou venceu. Peça um novo à equipe do Vertces.";

async function cadastroCriar(d: Deps, ip: string | null, b: Record<string, unknown>): Promise<Resposta> {
  // robô: o campo escondido veio preenchido
  if (String(b.site ?? "").trim()) throw new ErroUsuario("Não foi possível concluir o cadastro. Recarregue a página e tente de novo.");
  // 0049: o convite (link com token, gerado pela equipe) libera já e cobra só a partir do 1º crédito gasto
  const token = String(b.convite ?? "").trim().toLowerCase();
  const porConvite = token !== "";
  if (porConvite && (!/^[0-9a-f]{64}$/.test(token) || !d.banco.reservarConvite)) throw new ErroUsuario(CONVITE_INVALIDO, 410);
  const f = {
    empresa: texto(b.empresa, 200), documento: soDigitos(String(b.documento ?? "")), responsavel: texto(b.responsavel, 200),
    email: String(b.email ?? "").trim().toLowerCase(), telefone: soDigitos(String(b.telefone ?? "")).replace(/^55(?=\d{10,11}$)/, ""),
    senha: String(b.senha ?? ""), aceite_termos: b.aceite_termos === true,
  };
  const problema = Object.values(problemasDoCadastro(f))[0];
  if (problema) throw new ErroUsuario(problema);
  const versao = String(b.versao_termos ?? "");
  if (!/^[\w.-]{1,40}$/.test(versao)) throw new ErroUsuario("Versão dos termos inválida. Recarregue a página e tente de novo.");
  const ciclo = cicloDe(b.ciclo);
  if (!ciclo) throw new ErroUsuario("Escolha o período: mensal, semestral ou anual.");
  const planoId = String(b.plano_id ?? "");
  if (!porConvite && !/^[0-9a-f-]{36}$/i.test(planoId)) throw new ErroUsuario("Escolha um plano.");

  const cfg = await d.banco.config();
  const regras = regrasDe(cfg);
  // o convite vale mesmo com o cadastro pelo site fechado: foi a equipe que mandou
  if (!porConvite && (!regras.cadastro_aberto || !asaasDe(cfg, d.fetch))) {
    throw new ErroUsuario("O cadastro pelo site está fechado no momento. Fale com o Vertces para assinar.", 403);
  }
  // por IP e no total: depois da validação (erro de digitação não gasta a vez de ninguém)
  if (d.limite) {
    for (const [chave, max, janela] of LIMITES_CADASTRO(ip ?? "desconhecido")) {
      if (await d.limite(chave, max, janela)) continue;
      // o teto do dia (todas as conexões): pode ser ataque — o superadmin fica sabendo, uma vez por dia
      if (chave === "cadastro:total-dia") await avisarTetoDoDia(d, cfg).catch(() => {});
      throw new ErroUsuario("Muitos cadastros seguidos a partir desta conexão. Tente de novo mais tarde.", 429);
    }
  }
  if (!regras.ciclos[ciclo].ativo) throw new ErroUsuario(`O período ${NOME_CICLO[ciclo].toLowerCase()} não está disponível. Escolha outro.`);
  // 0052: o cupom digitado (vazio = sem cupom); a conferência de verdade é na reserva, depois da empresa
  const codigoCupom = normalizarCodigo(b.cupom);
  if (String(b.cupom ?? "").trim() && !codigoValido(codigoCupom)) throw new ErroUsuario(MOTIVO_CUPOM.inexistente, 422);
  if (codigoCupom) {
    if (!d.banco.conferirCupom || !d.banco.reservarCupom) throw new ErroUsuario(MOTIVO_CUPOM.inexistente, 422);
    if (!(await tentativaDeCupom(d, ip))) throw new ErroUsuario(MOTIVO_CUPOM.muitas, 429);
    // sem o plano do convite ainda: confere sem plano só se não for convite (o do convite é conferido na reserva)
    if (!porConvite) {
      const r = await d.banco.conferirCupom(codigoCupom, planoId);
      if (!r.valido) throw new ErroUsuario(MOTIVO_CUPOM[r.motivo] ?? MOTIVO_CUPOM.inexistente, 422);
    }
  }
  // o convite é de uso único: reservado aqui (sob trava no banco) e devolvido se a conta não sair
  const convite = porConvite ? await d.banco.reservarConvite!(token) : null;
  if (porConvite && !convite) throw new ErroUsuario(CONVITE_INVALIDO, 410);
  try {
    return await criarContaEEmpresa(d, cfg, regras, f, versao, ciclo, convite ? convite.plano_id : planoId, convite, codigoCupom || null);
  } catch (e) {
    if (convite) await d.banco.devolverConvite?.(convite.id).catch(() => {});
    throw e;
  }
}

async function criarContaEEmpresa(d: Deps, cfg: Record<string, string>, regras: ReturnType<typeof regrasDe>,
  f: { empresa: string; documento: string; responsavel: string; email: string; telefone: string; senha: string },
  versao: string, ciclo: Ciclo, planoId: string, convite: { id: string; nome: string | null } | null, codigoCupom: string | null = null): Promise<Resposta> {
  const plano = await d.banco.planoParaVenda(planoId);
  const mensalidade = Number(plano?.preco_mensal ?? 0);
  // pelo convite vale qualquer plano ativo com mensalidade (a equipe escolheu); pelo site, só os à venda
  if (!plano || !plano.ativo || (!convite && !plano.vende_no_site) || !(mensalidade > 0)) {
    throw new ErroUsuario(convite ? "O plano deste convite não está mais disponível. Peça um novo à equipe do Vertces." : "Este plano não está disponível para assinatura pelo site. Escolha outro.");
  }
  // cadastro antigo com este documento ou e-mail que nunca pagou: dá lugar a este
  await liberarAbandonados(d, cfg, f.documento, f.email);
  if (await d.banco.documentoCadastrado(f.documento)) throw new ErroUsuario(JA_EXISTE, 409);

  const conta = await d.banco.criarConta(f.email, f.senha, { nome: f.responsavel, termos_versao: versao });
  if ("erro" in conta) {
    if (conta.duplicado) throw new ErroUsuario(JA_EXISTE, 409);
    throw new ErroUsuario(/password/i.test(conta.erro) ? "Senha recusada pelo servidor: use uma senha mais forte." : "Não foi possível criar a conta. Confira o e-mail e tente de novo.");
  }
  const valor = valorDoPeriodo(mensalidade, ciclo, regras.ciclos[ciclo].desconto);
  let escId: string | null = null;
  let cupom: Cupom | null = null;
  try {
    escId = await d.banco.inserirEmpresa({
      nome: f.empresa, cnpj: f.documento, responsavel: f.responsavel, telefone: f.telefone, email: f.email,
      plano_id: plano.id,
      // pelo convite (0049) entra já; a cobrança nasce no 1º crédito gasto
      status: convite ? "ativo" : "aguardando_pagamento", origem: convite ? "convite" : "site",
    });
    await d.banco.inserirMembro(escId, conta.id, f.responsavel);
    // a razão social e o documento também vão para Configurações (memorial e planta leem de lá)
    await d.banco.inserirConfigEmpresa(escId, { razao_social: f.empresa, cnpj: f.documento });
    await d.banco.salvarCobranca(escId, { ciclo, valor, situacao: "sem_assinatura", ...(convite ? { inicio_no_primeiro_credito: true } : {}) });
    // 0052: o uso do cupom (sob trava: o limite não estoura) e a foto dele na cobrança
    if (codigoCupom) {
      const r = await d.banco.reservarCupom!(codigoCupom, plano.id, escId);
      if (!r.valido) throw new ErroUsuario(MOTIVO_CUPOM[r.motivo] ?? MOTIVO_CUPOM.inexistente, 422);
      cupom = cupomDe(r.cupom);
    }
    if (convite) await d.banco.concluirConvite?.(convite.id, escId);
  } catch (e) {
    if (escId) await d.banco.removerEmpresa(escId).catch(() => {});
    await d.banco.removerConta(conta.id).catch(() => {});
    // dois cadastros com o mesmo documento ao mesmo tempo: o índice único segura o segundo
    if ((e as { codigo?: string }).codigo === "23505") throw new ErroUsuario(JA_EXISTE, 409);
    throw e;
  }
  const comCupom = cupom ? ` · cupom ${cupom.codigo}` : "";
  if (convite) {
    await d.banco.atividade(escId, "empresa.cadastro_convite", `${plano.nome} · ${NOME_CICLO[ciclo].toLowerCase()} · cobra a partir do 1º crédito${comCupom}`, conta.id).catch(() => {});
    const whatsapp = await avisarConvite(d, cfg, { ...f, plano: plano.nome, ciclo, valor, convite: convite.nome, escritorioId: escId, cupom });
    return ok({ escritorio_id: escId, login: f.email, ciclo, valor, adesao: 0, liberada: true, inicio_no_primeiro_credito: true, whatsapp, ...(cupom ? { cupom } : {}) });
  }
  await d.banco.atividade(escId, "empresa.cadastro_site", `${plano.nome} · ${NOME_CICLO[ciclo].toLowerCase()}${comCupom}`, conta.id).catch(() => {});
  const pp = primeiroPagamento(valor, regras.adesao, cupom);
  // 0052: o cupom zerou o 1º pagamento (meses grátis, sem adesão a pagar): a conta entra já
  // (se o banco falhar aqui, a conta fica esperando e a tela de pagamento libera: pagar_cadastro faz o mesmo)
  const lib = cupom && !(pp.total > 0) ? await liberarComCupom(d, cfg, escId, ciclo).catch(() => null) : null;
  if (cupom && lib) {
    const whatsapp = await avisarLiberadaPorCupom(d, cfg, { ...f, plano: plano.nome, ciclo, valor, escritorioId: escId, cupom, vencimento: lib.vencimento });
    return ok({ escritorio_id: escId, login: f.email, ciclo, valor, adesao: 0, liberada: true, cupom, primeira_mensalidade: lib.vencimento, whatsapp });
  }
  const whatsapp = await avisarCadastro(d, cfg, {
    ...f, plano: plano.nome, ciclo, valor, adesao: regras.adesao, parcelas: maxParcelas(regras, ciclo),
    cupom: cupom ? { codigo: cupom.codigo, resumo: resumoDoCupom(cupom), total: pp.total } : null,
  });
  return ok({ escritorio_id: escId, login: f.email, ciclo, valor, adesao: pp.adesao, total: pp.total, whatsapp, ...(cupom ? { cupom } : {}) });
}

/** 0052: a conta entrou pelo cupom sem pagar nada agora. Nunca derruba o cadastro. */
async function avisarLiberadaPorCupom(d: Deps, cfg: Record<string, string>, c: {
  empresa: string; documento: string; responsavel: string; email: string; telefone: string; plano: string; ciclo: Ciclo; valor: number;
  escritorioId: string; cupom: Cupom; vencimento: string;
}): Promise<boolean> {
  const zap = zapDe(cfg);
  if (!zap) return false;
  const periodo = NOME_CICLO[c.ciclo].toLowerCase();
  const emp = await d.banco.empresa(c.escritorioId).catch(() => null);
  const resumo = resumoDoCupom(c.cupom);
  const [pessoa] = await Promise.all([
    enviarWhatsApp(zap, c.telefone, mensagemCadastroComCupom({
      responsavel: c.responsavel, empresa: c.empresa, plano: c.plano, periodo, valor: c.valor, url: urlApp(cfg), login: c.email,
      codigo: c.cupom.codigo, resumo, vencimento: c.vencimento, creditos: emp ? textoCreditos(emp.creditos) : undefined,
    }), d.fetch).catch(() => ({ ok: false as const })),
    cfg.whatsapp_avisos
      ? enviarWhatsApp(zap, cfg.whatsapp_avisos, mensagemNovoCadastro({
        empresa: c.empresa, documento: formatarDocumento(c.documento), responsavel: c.responsavel, email: c.email,
        telefone: formatarTelefone(c.telefone), plano: c.plano, periodo, valor: c.valor, cupom: `${c.cupom.codigo} (${resumo})`, liberada: true,
      }), d.fetch).catch(() => null)
      : Promise.resolve(null),
  ]);
  return pessoa.ok;
}

/** Convite (0049): "conta criada, nada a pagar agora" para a pessoa e o aviso para o superadmin. Nunca derruba o cadastro. */
async function avisarConvite(d: Deps, cfg: Record<string, string>, c: {
  empresa: string; documento: string; responsavel: string; email: string; telefone: string; plano: string; ciclo: Ciclo; valor: number;
  convite: string | null; escritorioId: string; cupom?: Cupom | null;
}): Promise<boolean> {
  const zap = zapDe(cfg);
  if (!zap) return false;
  const periodo = NOME_CICLO[c.ciclo].toLowerCase();
  const emp = await d.banco.empresa(c.escritorioId).catch(() => null);
  const [pessoa] = await Promise.all([
    enviarWhatsApp(zap, c.telefone, mensagemCadastroConvite({
      responsavel: c.responsavel, empresa: c.empresa, plano: c.plano, periodo, valor: c.valor, url: urlApp(cfg), login: c.email,
      creditos: emp ? textoCreditos(emp.creditos) : undefined,
    }), d.fetch).catch(() => ({ ok: false as const })),
    cfg.whatsapp_avisos
      ? enviarWhatsApp(zap, cfg.whatsapp_avisos, mensagemNovoConvite({
        empresa: c.empresa, documento: formatarDocumento(c.documento), responsavel: c.responsavel, email: c.email,
        telefone: formatarTelefone(c.telefone), plano: c.plano, periodo, valor: c.valor, convite: c.convite,
        cupom: c.cupom ? `${c.cupom.codigo} (${resumoDoCupom(c.cupom)})` : null,
      }), d.fetch).catch(() => null)
      : Promise.resolve(null),
  ]);
  return pessoa.ok;
}

/** "Cadastro criado, falta o pagamento" para a pessoa e, se houver, o aviso para o superadmin. Nunca derruba o cadastro. */
async function avisarCadastro(d: Deps, cfg: Record<string, string>, c: {
  empresa: string; documento: string; responsavel: string; email: string; telefone: string; plano: string; ciclo: Ciclo; valor: number; adesao: number; parcelas: number;
  cupom?: { codigo: string; resumo: string; total: number } | null;
}): Promise<boolean> {
  const zap = zapDe(cfg);
  if (!zap) return false;
  const periodo = NOME_CICLO[c.ciclo].toLowerCase();
  const [pessoa] = await Promise.all([
    enviarWhatsApp(zap, c.telefone, mensagemCadastroCriado({
      responsavel: c.responsavel, empresa: c.empresa, plano: c.plano, periodo, valor: c.valor, adesao: c.adesao, url: urlApp(cfg), login: c.email, parcelas: c.parcelas,
      cupom: c.cupom ?? null,
    }), d.fetch).catch(() => ({ ok: false as const })),
    cfg.whatsapp_avisos
      ? enviarWhatsApp(zap, cfg.whatsapp_avisos, mensagemNovoCadastro({
        empresa: c.empresa, documento: formatarDocumento(c.documento), responsavel: c.responsavel, email: c.email,
        telefone: formatarTelefone(c.telefone), plano: c.plano, periodo, valor: c.valor, adesao: c.adesao,
        cupom: c.cupom ? `${c.cupom.codigo} (${c.cupom.resumo}) · 1º pagamento ${fmtReais(c.cupom.total)}` : null,
      }), d.fetch).catch(() => null)
      : Promise.resolve(null),
  ]);
  return pessoa.ok;
}
