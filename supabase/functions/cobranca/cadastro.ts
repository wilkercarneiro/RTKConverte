// Autocadastro (migração 0040): a ação PÚBLICA da função `cobranca`, chamada
// pela página #/assinar sem login.
//
//   cadastro_criar { empresa, documento, responsavel, email, telefone, senha,
//                    plano_id, ciclo, aceite_termos, versao_termos, site }
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
// Contra abuso (o signup do Auth segue DESLIGADO, auditoria de 04/11/2026):
// campo escondido `site` (robô preenche), limite por IP (5 por hora, 15 por
// dia) e no total (200 por dia), tudo conferido aqui — a tela não decide nada.
// Sem Deno nem supabase-js, como fluxos.ts (tests/cobranca.test.mjs).

import { asaasDe, ErroUsuario, urlApp, zapDe } from "./fluxos.ts";
import type { Deps, Resposta } from "./fluxos.ts";
import { ErroAsaas } from "../_shared/asaas.ts";
import { formatarDocumento, formatarTelefone, problemasDoCadastro, soDigitos } from "../_shared/cnpj.ts";
import { enviarWhatsApp } from "../_shared/whatsapp.ts";
import { mensagemCadastroCriado, mensagemNovoCadastro } from "../_shared/mensagens_cobranca.ts";
import { cicloDe, maxParcelas, NOME_CICLO, regrasDe, valorDoPeriodo } from "../_shared/parcelas.ts";
import type { Ciclo } from "../_shared/parcelas.ts";

/** Limites do cadastro: [chave, máximo, janela em segundos]. */
export const LIMITES_CADASTRO = (ip: string): [string, number, number][] => [
  [`cadastro:ip-hora:${ip}`, 5, 3600],
  [`cadastro:ip-dia:${ip}`, 15, 86400],
  ["cadastro:total-dia", 200, 86400],
];

const ok = (corpo: Record<string, unknown> = {}): Resposta => ({ status: 200, corpo: { ok: true, ...corpo } });
const falha = (status: number, erro: string): Resposta => ({ status, corpo: { erro } });

/** A entrada sem login (index.ts manda para cá antes de conferir a sessão). */
export async function tratarPublico(d: Deps, ip: string | null, b: Record<string, unknown>): Promise<Resposta> {
  try {
    if (b.acao === "cadastro_criar") return await cadastroCriar(d, ip, b);
    return falha(400, "Ação desconhecida.");
  } catch (e) {
    if (e instanceof ErroUsuario) return falha(e.status, e.message);
    if (e instanceof ErroAsaas) return falha(502, e.message);
    // página pública: o detalhe do erro interno não sai daqui
    return falha(500, "Não foi possível concluir o cadastro agora. Tente de novo em instantes.");
  }
}

const texto = (v: unknown, max: number) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

async function cadastroCriar(d: Deps, ip: string | null, b: Record<string, unknown>): Promise<Resposta> {
  // robô: o campo escondido veio preenchido
  if (String(b.site ?? "").trim()) throw new ErroUsuario("Não foi possível concluir o cadastro. Recarregue a página e tente de novo.");
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
  if (!/^[0-9a-f-]{36}$/i.test(planoId)) throw new ErroUsuario("Escolha um plano.");

  const cfg = await d.banco.config();
  const regras = regrasDe(cfg);
  if (!regras.cadastro_aberto || !asaasDe(cfg, d.fetch)) {
    throw new ErroUsuario("O cadastro pelo site está fechado no momento. Fale com o Vertces para assinar.", 403);
  }
  // por IP e no total: depois da validação (erro de digitação não gasta a vez de ninguém)
  if (d.limite) {
    for (const [chave, max, janela] of LIMITES_CADASTRO(ip ?? "desconhecido")) {
      if (!(await d.limite(chave, max, janela))) throw new ErroUsuario("Muitos cadastros seguidos a partir desta conexão. Tente de novo mais tarde.", 429);
    }
  }
  if (!regras.ciclos[ciclo].ativo) throw new ErroUsuario(`O período ${NOME_CICLO[ciclo].toLowerCase()} não está disponível. Escolha outro.`);
  const plano = await d.banco.planoParaVenda(planoId);
  const mensalidade = Number(plano?.preco_mensal ?? 0);
  if (!plano || !plano.ativo || !plano.vende_no_site || !(mensalidade > 0)) {
    throw new ErroUsuario("Este plano não está disponível para assinatura pelo site. Escolha outro.");
  }
  const tipoDoc = f.documento.length === 11 ? "CPF" : "CNPJ";
  if (await d.banco.documentoCadastrado(f.documento)) {
    throw new ErroUsuario(`Já existe uma conta com este ${tipoDoc}. Entre com ela ou fale com o suporte.`, 409);
  }

  const conta = await d.banco.criarConta(f.email, f.senha, { nome: f.responsavel, termos_versao: versao });
  if ("erro" in conta) {
    if (conta.duplicado) throw new ErroUsuario("Já existe uma conta com este e-mail. Entre com ela.", 409);
    throw new ErroUsuario(/password/i.test(conta.erro) ? "Senha recusada pelo servidor: use uma senha mais forte." : "Não foi possível criar a conta. Confira o e-mail e tente de novo.");
  }
  const valor = valorDoPeriodo(mensalidade, ciclo, regras.ciclos[ciclo].desconto);
  let escId: string | null = null;
  try {
    escId = await d.banco.inserirEmpresa({
      nome: f.empresa, cnpj: f.documento, responsavel: f.responsavel, telefone: f.telefone, email: f.email,
      plano_id: plano.id, status: "aguardando_pagamento", origem: "site",
    });
    await d.banco.inserirMembro(escId, conta.id, f.responsavel);
    // a razão social e o documento também vão para Configurações (memorial e planta leem de lá)
    await d.banco.inserirConfigEmpresa(escId, { razao_social: f.empresa, cnpj: f.documento });
    await d.banco.salvarCobranca(escId, { ciclo, valor, situacao: "sem_assinatura" });
  } catch (e) {
    if (escId) await d.banco.removerEmpresa(escId).catch(() => {});
    await d.banco.removerConta(conta.id).catch(() => {});
    // dois cadastros com o mesmo documento ao mesmo tempo: o índice único segura o segundo
    if ((e as { codigo?: string }).codigo === "23505") {
      throw new ErroUsuario(`Já existe uma conta com este ${tipoDoc}. Entre com ela ou fale com o suporte.`, 409);
    }
    throw e;
  }
  await d.banco.atividade(escId, "empresa.cadastro_site", `${plano.nome} · ${NOME_CICLO[ciclo].toLowerCase()}`, conta.id).catch(() => {});
  const whatsapp = await avisarCadastro(d, cfg, { ...f, plano: plano.nome, ciclo, valor, parcelas: maxParcelas(regras, ciclo) });
  return ok({ escritorio_id: escId, login: f.email, ciclo, valor, whatsapp });
}

/** "Cadastro criado, falta o pagamento" para a pessoa e, se houver, o aviso para o superadmin. Nunca derruba o cadastro. */
async function avisarCadastro(d: Deps, cfg: Record<string, string>, c: {
  empresa: string; documento: string; responsavel: string; email: string; telefone: string; plano: string; ciclo: Ciclo; valor: number; parcelas: number;
}): Promise<boolean> {
  const zap = zapDe(cfg);
  if (!zap) return false;
  const periodo = NOME_CICLO[c.ciclo].toLowerCase();
  const [pessoa] = await Promise.all([
    enviarWhatsApp(zap, c.telefone, mensagemCadastroCriado({
      responsavel: c.responsavel, empresa: c.empresa, plano: c.plano, periodo, valor: c.valor, url: urlApp(cfg), login: c.email, parcelas: c.parcelas,
    }), d.fetch).catch(() => ({ ok: false as const })),
    cfg.whatsapp_avisos
      ? enviarWhatsApp(zap, cfg.whatsapp_avisos, mensagemNovoCadastro({
        empresa: c.empresa, documento: formatarDocumento(c.documento), responsavel: c.responsavel, email: c.email,
        telefone: formatarTelefone(c.telefone), plano: c.plano, periodo, valor: c.valor,
      }), d.fetch).catch(() => null)
      : Promise.resolve(null),
  ]);
  return pessoa.ok;
}
