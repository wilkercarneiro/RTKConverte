// Cobrança pelo Asaas (migração 0034 + edge function `cobranca`): os fluxos
// inteiros da função com um Asaas falso, uma Evolution falsa e um banco em
// memória — compra de créditos, webhook, configuração, mensalidade da empresa
// nova e conferência. As regras do banco têm o teste delas em
// tests/rls/planos_cobranca.sql; o preço por faixa é conferido aqui com os
// mesmos casos de lá.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mesmoToken, somarDias, somarMes, tratarAcao, tratarWebhook } from "../supabase/functions/cobranca/fluxos.ts";
import { tratarPublico } from "../supabase/functions/cobranca/cadastro.ts";
import { somarMeses } from "../supabase/functions/_shared/parcelas.ts";
import { bandeiraDoNumero, cpfValido, lerValidade, luhnValido, problemasDoCartao } from "../supabase/functions/_shared/cartao.ts";
import { cotar, faixasEmTexto, minimoDe, problemaDasFaixas } from "../supabase/functions/_shared/precos.ts";
import { dataBr, mensagemAcessoLiberado, mensagemCobranca, textoCreditos } from "../supabase/functions/_shared/mensagens_cobranca.ts";
import { numeroWhatsApp } from "../supabase/functions/_shared/whatsapp.ts";
import { BASE_ASAAS, mensagemDoAsaas } from "../supabase/functions/_shared/asaas.ts";

// ------------------------------------------------------------------ dublês

function asaasFalso() {
  const s = {
    chamadas: [], clientes: [], cobrancas: new Map(), assinaturas: new Map(), webhooks: [], parcelamentos: [],
    chaveValida: "$aact_boa", falharCobranca: null, seq: 0, statusCartao: null, exigirValue: false,
    // cartão: tokenização bloqueada (403, como a conta real até o Asaas liberar) e recusa da operadora
    tokenizacaoBloqueada: false, recusarCartao: null, tokens: [],
  };
  const recusa = () => resp(400, { errors: [{ code: "invalid_creditCard", description: s.recusarCartao }] });
  const resp = (status, corpo) => new Response(corpo === undefined ? "" : JSON.stringify(corpo), { status });
  s.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const metodo = init.method ?? "GET";
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    if (u.hostname.includes("evolution")) {
      s.chamadas.push({ metodo, caminho: u.pathname, corpo, whatsapp: true });
      if (u.pathname.startsWith("/instance/connectionState")) return resp(200, { instance: { state: s.estadoZap ?? "open" } });
      if (u.pathname.startsWith("/instance/connect/")) return resp(200, { base64: "data:image/png;base64,QR", code: "2@x", count: 1 });
      return resp(201, { key: { id: "m1" }, status: "PENDING" });
    }
    const caminho = u.pathname.replace(/^\/v3/, "") + u.search;
    s.chamadas.push({ metodo, caminho, corpo, base: `${u.origin}/v3`, chave: init.headers?.access_token });
    if (init.headers?.access_token !== s.chaveValida) return resp(401, {});
    const id = (p) => `${p}_${++s.seq}`;
    if (caminho === "/finance/balance") return resp(200, { balance: 1234.5 });
    if (caminho.startsWith("/customers?")) return resp(200, { data: s.clientes.filter((c) => c.cpfCnpj === u.searchParams.get("cpfCnpj")) });
    if (caminho === "/customers" && metodo === "POST") { const c = { id: id("cus"), ...corpo }; s.clientes.push(c); return resp(200, c); }
    if (caminho === "/creditCard/tokenizeCreditCard" && metodo === "POST") {
      if (s.tokenizacaoBloqueada) return resp(403, { errors: [{ code: "forbidden", description: "Você não possui permissão para utilizar este recurso. Entre em contato com seu gerente de contas." }] });
      if (corpo.customer === "cus_000000000000") return resp(400, { errors: [{ code: "invalid_customer", description: "Cliente inexistente." }] });
      if (s.recusarCartao) return recusa();
      const t = { creditCardToken: `tok_${++s.seq}`, creditCardNumber: corpo.creditCard.number.slice(-4), creditCardBrand: "VISA" };
      s.tokens.push({ ...t, customer: corpo.customer });
      return resp(200, t);
    }
    if (caminho === "/payments" && metodo === "POST") {
      if (s.falharCobranca) return resp(400, { errors: [{ code: "invalid", description: s.falharCobranca }] });
      if (corpo.installmentCount) {
        // compra parcelada no cartão (autocadastro): a conta pode exigir `value` (incerteza da pesquisa)
        if (s.exigirValue && corpo.value === undefined) return resp(400, { errors: [{ code: "invalid_value", description: "O campo value deve ser informado." }] });
        if (s.recusarCartao) return recusa();
        const inst = `inst_${++s.seq}`;
        const n = corpo.installmentCount;
        const parcela = corpo.installmentValue ?? Math.round((corpo.totalValue / n) * 100) / 100;
        s.parcelamentos.push({ id: inst, corpo });
        let primeira;
        for (let k = 1; k <= n; k++) {
          const c = { id: id("pay"), status: s.statusCartao ?? "CONFIRMED", installment: inst, installmentNumber: k, value: parcela,
            dueDate: k === 1 ? corpo.dueDate : `parcela-${k}`, billingType: "CREDIT_CARD", invoiceUrl: `https://sandbox.asaas.com/i/${s.seq}` };
          s.cobrancas.set(c.id, c);
          primeira ??= c;
        }
        return resp(200, primeira);
      }
      if (corpo.billingType === "CREDIT_CARD") {
        if (s.recusarCartao) return recusa();
        const c = { id: id("pay"), status: "CONFIRMED", invoiceUrl: `https://sandbox.asaas.com/i/${s.seq}`, ...corpo };
        s.cobrancas.set(c.id, c); return resp(200, c);
      }
      const c = { id: id("pay"), status: "PENDING", invoiceUrl: `https://sandbox.asaas.com/i/${s.seq}`, ...corpo };
      s.cobrancas.set(c.id, c); return resp(200, c);
    }
    let m;
    if ((m = /^\/payments\/([^/]+)\/payWithCreditCard$/.exec(caminho))) {
      if (s.recusarCartao) return recusa();
      const c = s.cobrancas.get(m[1]);
      Object.assign(c, { status: s.statusCartao ?? "CONFIRMED", billingType: "CREDIT_CARD", pagoCom: corpo });
      return resp(200, c);
    }
    if ((m = /^\/payments\/([^/]+)\/pixQrCode$/.exec(caminho))) return resp(200, { encodedImage: "iVBOR", payload: "000201pix", expirationDate: "2026-11-01 23:59:59" });
    if ((m = /^\/payments\/([^/?]+)$/.exec(caminho))) {
      const c = s.cobrancas.get(m[1]);
      if (!c) return resp(404, { errors: [{ description: "não encontrada" }] });
      if (metodo === "DELETE") { c.deleted = true; return resp(200, { deleted: true }); }
      return resp(200, c);
    }
    if (caminho === "/subscriptions" && metodo === "POST") {
      if (corpo.billingType === "CREDIT_CARD" && s.recusarCartao) return recusa();
      const a = { id: id("sub"), ...corpo }; s.assinaturas.set(a.id, a);
      const c = { id: id("pay"), status: "PENDING", subscription: a.id, value: corpo.value, dueDate: corpo.nextDueDate, invoiceUrl: `https://sandbox.asaas.com/i/${s.seq}` };
      s.cobrancas.set(c.id, c); return resp(200, a);
    }
    if ((m = /^\/subscriptions\/([^/]+)\/payments$/.exec(caminho))) return resp(200, { data: [...s.cobrancas.values()].filter((c) => c.subscription === m[1]) });
    if ((m = /^\/subscriptions\/([^/?]+)$/.exec(caminho))) {
      const a = s.assinaturas.get(m[1]);
      if (metodo === "DELETE") {
        // como no Asaas: as faturas em aberto da assinatura saem junto; as pagas ficam
        for (const c of s.cobrancas.values()) if (c.subscription === m[1] && ["PENDING", "OVERDUE"].includes(c.status)) c.deleted = true;
        s.assinaturas.delete(m[1]); return resp(200, { deleted: true });
      }
      Object.assign(a, corpo); return resp(200, a);
    }
    if (caminho.startsWith("/webhooks?")) return resp(200, { data: s.webhooks });
    if (caminho === "/webhooks" && metodo === "POST") { const w = { id: id("wh"), enabled: true, interrupted: false, ...corpo }; s.webhooks.push(w); return resp(200, w); }
    if ((m = /^\/webhooks\/([^/?]+)$/.exec(caminho))) {
      const w = s.webhooks.find((x) => x.id === m[1]);
      if (metodo === "PUT") Object.assign(w, corpo);
      return resp(200, w);
    }
    return resp(404, { errors: [{ description: `rota falsa ausente: ${metodo} ${caminho}` }] });
  };
  return s;
}

function bancoFalso(cfg = {}) {
  const b = {
    cfg: { ...cfg }, eventos: [], aplicados: [], cobrancas: {}, pagamentos: [], cancelados: [], empresas: {}, respostaAplicar: { acao: "atualizado" },
    async config() { return { ...b.cfg }; },
    async gravarConfig(p) { for (const [k, v] of Object.entries(p)) { if (v === null) delete b.cfg[k]; else b.cfg[k] = v; } },
    async esquecerClientesAsaas() { for (const c of Object.values(b.cobrancas)) c.asaas_cliente_id = null; },
    async registrarEvento(e) {
      if (e.evento_id && b.eventos.some((x) => x.evento_id === e.evento_id)) return { repetido: true, id: null };
      b.eventos.push({ ...e, id: b.eventos.length + 1 }); return { repetido: false, id: b.eventos.length };
    },
    async resultadoEvento(id, r) { const e = b.eventos.find((x) => x.id === id); if (e) e.resultado = r; },
    async ultimoEvento() { return b.eventos.at(-1) ?? null; },
    async aplicarPagamento(evento, pagamento) {
      b.aplicados.push({ evento, pagamento });
      if (b.respostaAplicar instanceof Error) throw b.respostaAplicar;
      return typeof b.respostaAplicar === "function" ? b.respostaAplicar(evento, pagamento) : b.respostaAplicar;
    },
    async empresa(id) { const e = b.empresas[id]; return e ? { ...e, cobranca: b.cobrancas[id] ?? null } : null; },
    async atualizarEmpresa(id, campos) { Object.assign(b.empresas[id], campos); },
    async salvarCobranca(id, campos) { b.cobrancas[id] = { situacao: "sem_assinatura", ...(b.cobrancas[id] ?? {}), ...campos }; },
    async inserirPagamento(p) { if (!b.pagamentos.some((x) => x.asaas_id === p.asaas_id)) b.pagamentos.push({ ...p }); },
    async atualizarPagamento(id, campos) { Object.assign(b.pagamentos.find((x) => x.id === id), campos); },
    async pagamentoDaCompra(creditoId) { return b.pagamentos.find((x) => x.credito_id === creditoId) ?? null; },
    async cancelarCompra(creditoId, pagamentoId, motivo) { b.cancelados.push({ creditoId, pagamentoId, motivo }); },
    async pagamentosPendentes() { return b.pagamentos.filter((x) => x.asaas_id && ["PENDING", "OVERDUE", "AWAITING_RISK_ANALYSIS"].includes(x.status)); },
    async descricaoCredito() { return "10 créditos de car"; },
    cartoes: {}, recargas: [], reserva: { pode: false, motivo: "desligada" }, atividades: [],
    async detalheCompra(id) { return b.pagamentos.find((x) => x.credito_id === id) ? { automatica: !!b.pagamentos.find((x) => x.credito_id === id).automatica, valor: 50 } : null; },
    async cartao(id) { return b.cartoes[id] ?? null; },
    async salvarCartao(id, campos) {
      if (campos === null) delete b.cartoes[id];
      else if ("final" in campos) b.cartoes[id] = { ...campos };
      else if (b.cartoes[id]) Object.assign(b.cartoes[id], campos);
    },
    async recargasLigadas() { return b.recargas; },
    async reservarRecarga(esc, tipo) {
      const r = typeof b.reserva === "function" ? b.reserva(tipo) : b.reserva;
      if (r.pode) b.pagamentos.push({ id: r.pagamento_id, credito_id: r.credito_id, status: "CRIANDO", asaas_id: null, automatica: true });
      return r;
    },
    async atividade(esc, acao, alvo, user) { b.atividades.push({ esc, acao, alvo, user }); },
    // ---- autocadastro (0040): o Auth e as tabelas que a service_role escreve
    planos: {}, contas: [], membros: [], configEmpresa: [], removidas: [], falharEm: null,
    async planoParaVenda(id) { return b.planos[id] ?? null; },
    async documentoCadastrado(doc) { return Object.values(b.empresas).some((e) => e.cnpj === doc); },
    async criarConta(email, senha, meta) {
      if (b.contas.some((c) => c.email === email)) return { erro: "A user with this email address has already been registered", duplicado: true };
      const c = { id: `user-${b.contas.length + 1}`, email, senha, meta };
      b.contas.push(c);
      return { id: c.id };
    },
    async removerConta(id) { b.contas = b.contas.filter((c) => c.id !== id); },
    async inserirEmpresa(campos) {
      if (b.falharEm === "empresa-duplicada") throw Object.assign(new Error("empresa: duplicate key"), { codigo: "23505" });
      const id = `esc-site-${Object.keys(b.empresas).length + 1}`;
      b.empresas[id] = { id, ...campos, mensalidade: null, creditos: [], login: campos.email };
      return id;
    },
    async inserirMembro(esc, user, nome) {
      if (b.falharEm === "membro") throw new Error("membro: falhou");
      b.membros.push({ esc, user, nome, papel: "dono" });
    },
    async inserirConfigEmpresa(esc, pares) { b.configEmpresa.push({ esc, ...pares }); },
    async removerEmpresa(esc) { delete b.empresas[esc]; delete b.cobrancas[esc]; b.removidas.push(esc); },
  };
  return b;
}

const EMPRESA = {
  id: "esc-1", nome: "Pagante Topografia", cnpj: "11222333000181", email: "contato@pagante.test", telefone: "71999990000",
  responsavel: "Maria Souza", status: "aguardando_pagamento", plano: "Profissional", mensalidade: 199.9, login: "contato@pagante.test",
  creditos: [{ nome: "Créditos gerais", por_mes: 12 }, { nome: "Créditos de CAR", por_mes: 25 }],
};
const ZAP = { whatsapp_url: "https://evolution.test", whatsapp_chave: "evo", whatsapp_instancia: "vertces" };
const ASAAS_OK = { asaas_api_key: "$aact_boa", asaas_ambiente: "sandbox" };

function cenario({ cfg = {}, superadmin = false, pedido } = {}) {
  const asaas = asaasFalso();
  const banco = bancoFalso(cfg);
  banco.empresas[EMPRESA.id] = { ...EMPRESA };
  const deps = { banco, fetch: asaas.fetch, hoje: () => "2026-10-30", aleatorio: () => "t".repeat(48) };
  const usuario = {
    id: "u1", email: "wilker@vertces.test", superadmin, escritorioId: EMPRESA.id, cancelou: [], souDono: true, ip: "200.10.20.30",
    async pedirCreditos(tipo, quantidade) {
      const p = pedido ?? { credito_id: "cred-1", pagamento_id: "pag-1", escritorio_id: EMPRESA.id, online: true, quantidade, unitario: 15, valor: 15 * quantidade, descricao: `${quantidade} créditos de car` };
      if (p.pagamento_id) banco.pagamentos.push({ id: p.pagamento_id, credito_id: p.credito_id, status: "CRIANDO", asaas_id: null });
      return p;
    },
    async cancelarPedido(id) { usuario.cancelou.push(id); },
    async compraMinha() { return true; },
  };
  return { asaas, banco, deps, usuario };
}

// ------------------------------------------------------------------ compra de créditos

test("comprar créditos: cliente no Asaas, cobrança com o valor da tabela, link e Pix de volta", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  const r = await tratarAcao(deps, usuario, { acao: "comprar_creditos", tipo: "car", quantidade: 10 });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const criada = asaas.chamadas.find((c) => c.caminho === "/payments" && c.metodo === "POST");
  assert.equal(criada.base, BASE_ASAAS.sandbox, "sandbox usa o servidor de sandbox");
  assert.deepEqual({ ...criada.corpo, customer: undefined }, {
    customer: undefined, billingType: "UNDEFINED", value: 150, dueDate: "2026-11-01",
    description: "Vertces: 10 créditos de car", externalReference: "cred-1",
  });
  assert.equal(asaas.clientes[0].cpfCnpj, EMPRESA.cnpj, "cliente do Asaas com o CNPJ da empresa");
  assert.equal(banco.cobrancas[EMPRESA.id].asaas_cliente_id, asaas.clientes[0].id, "o cliente fica guardado");
  const pag = banco.pagamentos.find((p) => p.id === "pag-1");
  assert.equal(pag.status, "PENDING");
  assert.match(pag.asaas_id, /^pay_/);
  assert.equal(r.corpo.link, pag.link);
  assert.equal(r.corpo.pix.payload, "000201pix", "Pix copia e cola para pagar sem sair do sistema");
});

test("comprar créditos de novo reaproveita o cliente do Asaas (nem busca, nem cria outro)", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  banco.cobrancas[EMPRESA.id] = { asaas_cliente_id: "cus_existente", situacao: "sem_assinatura" };
  await tratarAcao(deps, usuario, { acao: "comprar_creditos", tipo: "car", quantidade: 2 });
  assert.equal(asaas.chamadas.filter((c) => c.caminho.startsWith("/customers")).length, 0);
  assert.equal(asaas.chamadas.find((c) => c.caminho === "/payments").corpo.customer, "cus_existente");
});

test("Asaas recusa a cobrança: a compra é cancelada e a mensagem dele chega à tela", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  asaas.falharCobranca = "O valor da cobrança é menor que o mínimo permitido.";
  const r = await tratarAcao(deps, usuario, { acao: "comprar_creditos", tipo: "car", quantidade: 2 });
  assert.equal(r.status, 502);
  assert.equal(r.corpo.erro, asaas.falharCobranca);
  assert.equal(banco.cancelados.length, 1, "a compra não fica pendurada");
  assert.match(banco.cancelados[0].motivo, /mínimo permitido/);
});

test("sem o Asaas configurado, a compra online não começa", async () => {
  const { deps, usuario } = cenario();
  const r = await tratarAcao(deps, usuario, { acao: "comprar_creditos", tipo: "car", quantidade: 2 });
  assert.equal(r.status, 409);
});

test("empresa sem CNPJ: erro claro, compra cancelada", async () => {
  const { banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  banco.empresas[EMPRESA.id].cnpj = null;
  const r = await tratarAcao(deps, usuario, { acao: "comprar_creditos", tipo: "geral", quantidade: 2 });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /CNPJ/);
  assert.equal(banco.cancelados.length, 1);
});

test("cancelar uma compra que acabou de ser paga lança os créditos em vez de cancelar", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  await tratarAcao(deps, usuario, { acao: "comprar_creditos", tipo: "car", quantidade: 10 });
  const pag = banco.pagamentos.find((p) => p.id === "pag-1");
  asaas.cobrancas.get(pag.asaas_id).status = "RECEIVED";
  const r = await tratarAcao(deps, usuario, { acao: "cancelar_compra", credito_id: "cred-1" });
  assert.equal(r.corpo.ja_paga, true);
  assert.equal(usuario.cancelou.length, 0);
  assert.equal(banco.aplicados.at(-1).pagamento.status, "RECEIVED");
});

test("cancelar uma compra em aberto apaga a cobrança no Asaas", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  await tratarAcao(deps, usuario, { acao: "comprar_creditos", tipo: "car", quantidade: 10 });
  const pag = banco.pagamentos.find((p) => p.id === "pag-1");
  await tratarAcao(deps, usuario, { acao: "cancelar_compra", credito_id: "cred-1" });
  assert.equal(asaas.cobrancas.get(pag.asaas_id).deleted, true, "ninguém paga uma compra cancelada");
  assert.deepEqual(usuario.cancelou, ["cred-1"]);
});

// ------------------------------------------------------------------ webhook

test("webhook com token errado: 401 e fica registrado", async () => {
  const { banco, deps } = cenario({ cfg: { ...ASAAS_OK, asaas_webhook_token: "x".repeat(48) } });
  const r = await tratarWebhook(deps, "y".repeat(48), JSON.stringify({ event: "PAYMENT_CONFIRMED", payment: { id: "pay_1" } }));
  assert.equal(r.status, 401);
  assert.equal(banco.eventos[0].evento, "AUTH_FAILED");
  assert.equal(banco.aplicados.length, 0);
});

test("webhook: aplica, avisa no WhatsApp quando os créditos entram, e o mesmo evento duas vezes é ignorado", async () => {
  const { asaas, banco, deps } = cenario({ cfg: { ...ASAAS_OK, ...ZAP, asaas_webhook_token: "x".repeat(48) } });
  banco.respostaAplicar = { acao: "creditos", escritorio_id: EMPRESA.id, credito_id: "cred-1" };
  const evento = JSON.stringify({ id: "evt_1", event: "PAYMENT_CONFIRMED", payment: { id: "pay_1", status: "CONFIRMED" } });
  const r = await tratarWebhook(deps, "x".repeat(48), evento);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.acao, "creditos");
  const zap = asaas.chamadas.find((c) => c.whatsapp);
  assert.equal(zap.caminho, "/message/sendText/vertces");
  assert.equal(zap.corpo.number, "5571999990000");
  assert.match(zap.corpo.text, /10 créditos de car já estão na conta da Pagante Topografia/);
  assert.equal(banco.eventos[0].resultado, "creditos · WhatsApp enviado");
  const r2 = await tratarWebhook(deps, "x".repeat(48), evento);
  assert.equal(r2.corpo.repetido, true);
  assert.equal(banco.aplicados.length, 1, "não aplica de novo");
});

test("webhook: empresa ativada recebe o aviso de acesso liberado", async () => {
  const { asaas, banco, deps } = cenario({ cfg: { ...ASAAS_OK, ...ZAP, asaas_webhook_token: "x".repeat(48) } });
  banco.respostaAplicar = { acao: "ativou", escritorio_id: EMPRESA.id };
  await tratarWebhook(deps, "x".repeat(48), JSON.stringify({ id: "evt_2", event: "PAYMENT_RECEIVED", payment: { id: "pay_m1", subscription: "sub_1" } }));
  const texto = asaas.chamadas.find((c) => c.whatsapp).corpo.text;
  assert.match(texto, /Olá, Maria!/);
  assert.match(texto, /acesso da Pagante Topografia ao Vertces está liberado/);
  assert.match(texto, /12 créditos gerais e 25 créditos de CAR por mês/);
});

test("webhook: mensalidade vencida suspende e o WhatsApp manda o link para pagar", async () => {
  const { asaas, banco, deps } = cenario({ cfg: { ...ASAAS_OK, ...ZAP, asaas_webhook_token: "x".repeat(48) } });
  banco.respostaAplicar = { acao: "suspendeu", escritorio_id: EMPRESA.id };
  await tratarWebhook(deps, "x".repeat(48), JSON.stringify({ id: "evt_5", event: "PAYMENT_OVERDUE",
    payment: { id: "pay_m2", subscription: "sub_1", status: "OVERDUE", value: 599.9, dueDate: "2026-11-30", invoiceUrl: "https://sandbox.asaas.com/i/m2" } }));
  const texto = asaas.chamadas.find((c) => c.whatsapp).corpo.text;
  assert.match(texto, /mensalidade do Vertces da Pagante Topografia \(R\$\s599,90\), com vencimento em 30\/11\/2026, não foi paga e o acesso foi suspenso/);
  assert.ok(texto.includes("https://sandbox.asaas.com/i/m2"));
  assert.equal(banco.eventos[0].resultado, "suspendeu · WhatsApp enviado");
});

test("webhook: erro interno responde 200 (o Asaas não desliga a fila) e fica no registro", async () => {
  const { banco, deps } = cenario({ cfg: { ...ASAAS_OK, asaas_webhook_token: "x".repeat(48) } });
  banco.respostaAplicar = new Error("banco fora do ar");
  const r = await tratarWebhook(deps, "x".repeat(48), JSON.stringify({ id: "evt_3", event: "PAYMENT_CONFIRMED", payment: { id: "pay_9" } }));
  assert.equal(r.status, 200);
  assert.match(banco.eventos[0].resultado, /^erro: banco fora do ar/);
});

test("webhook: evento que não é de cobrança é só registrado", async () => {
  const { banco, deps } = cenario({ cfg: { ...ASAAS_OK, asaas_webhook_token: "x".repeat(48) } });
  const r = await tratarWebhook(deps, "x".repeat(48), JSON.stringify({ id: "evt_4", event: "TRANSFER_DONE", transfer: {} }));
  assert.equal(r.corpo.ignorado, "TRANSFER_DONE");
  assert.equal(banco.aplicados.length, 0);
});

// ------------------------------------------------------------------ configuração

test("salvar a chave: testa no Asaas, cria o webhook com token próprio e guarda tudo", async () => {
  const { asaas, banco, deps } = cenario({ superadmin: true });
  const u = { id: "sa", email: "wilker@vertces.test", superadmin: true, escritorioId: null };
  const r = await tratarAcao(deps, u, {
    acao: "config_salvar", asaas_chave: "$aact_boa", asaas_ambiente: "producao",
    url_webhook: "https://api.vertces.test/functions/v1/cobranca?origem=asaas",
  });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const wh = asaas.webhooks[0];
  assert.equal(wh.url, "https://api.vertces.test/functions/v1/cobranca?origem=asaas");
  assert.equal(wh.authToken, "t".repeat(48));
  assert.equal(wh.sendType, "SEQUENTIALLY");
  assert.ok(wh.events.includes("PAYMENT_RECEIVED") && wh.events.includes("PAYMENT_OVERDUE"));
  assert.equal(asaas.chamadas[0].base, BASE_ASAAS.producao);
  assert.equal(banco.cfg.asaas_webhook_token, "t".repeat(48));
  assert.equal(banco.cfg.asaas_webhook_id, wh.id);
  assert.equal(r.corpo.asaas.saldo, 1234.5);
  assert.equal(r.corpo.asaas.chave_final, "_boa");
  assert.equal(r.corpo.asaas.webhook.ativo, true);

  // salvar de novo na mesma conta: o mesmo webhook, o mesmo token
  deps.aleatorio = () => "z".repeat(48);
  await tratarAcao(deps, u, { acao: "config_salvar", asaas_chave: "$aact_boa", url_webhook: wh.url });
  assert.equal(asaas.webhooks.length, 1);
  assert.equal(banco.cfg.asaas_webhook_token, "t".repeat(48));
});

test("chave recusada pelo Asaas: nada é gravado", async () => {
  const { banco, deps } = cenario();
  const u = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  const r = await tratarAcao(deps, u, { acao: "config_salvar", asaas_chave: "$aact_ruim", url_webhook: "https://x.test/f?origem=asaas" });
  assert.equal(r.status, 502);
  assert.match(r.corpo.erro, /recusou a chave/);
  assert.deepEqual(banco.cfg, {});
});

test("trocar de conta do Asaas esquece os clientes da conta antiga", async () => {
  const { banco, deps } = cenario({ cfg: { asaas_api_key: "$aact_velha", asaas_ambiente: "sandbox", asaas_webhook_token: "v".repeat(48) } });
  banco.cobrancas[EMPRESA.id] = { asaas_cliente_id: "cus_velho" };
  const u = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  await tratarAcao(deps, u, { acao: "config_salvar", asaas_chave: "$aact_boa", asaas_ambiente: "sandbox", url_webhook: "https://x.test/f?origem=asaas" });
  assert.equal(banco.cobrancas[EMPRESA.id].asaas_cliente_id, null);
  assert.equal(banco.cfg.asaas_webhook_token, "t".repeat(48), "conta nova, token novo");
});

test("só o superadmin mexe na configuração e cobra empresas", async () => {
  const { deps, usuario } = cenario({ cfg: ASAAS_OK });
  for (const acao of ["config_status", "config_salvar", "cobrar_empresa", "cancelar_assinatura", "whatsapp_testar", "whatsapp_qrcode", "whatsapp_estado"]) {
    const r = await tratarAcao(deps, usuario, { acao, escritorio_id: EMPRESA.id });
    assert.equal(r.status, 403, acao);
  }
});

test("QR Code do WhatsApp: desconectado devolve a imagem; conectado não gera outro", async () => {
  const { asaas, deps } = cenario({ cfg: { ...ASAAS_OK, ...ZAP } });
  const sa = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  asaas.estadoZap = "close";
  let r = await tratarAcao(deps, sa, { acao: "whatsapp_qrcode" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.qrcode, "data:image/png;base64,QR");
  assert.equal(r.corpo.estado, "close");
  asaas.estadoZap = "open";
  const antes = asaas.chamadas.length;
  r = await tratarAcao(deps, sa, { acao: "whatsapp_qrcode" });
  assert.equal(r.corpo.estado, "open");
  assert.equal(r.corpo.qrcode, undefined);
  assert.ok(!asaas.chamadas.slice(antes).some((c) => c.caminho?.startsWith("/instance/connect/")), "conectado: não chama o connect");
  r = await tratarAcao(deps, sa, { acao: "whatsapp_estado" });
  assert.deepEqual(r.corpo, { ok: true, configurado: true, estado: "open" });
});

test("QR Code sem instância configurada: 409", async () => {
  const { deps } = cenario({ cfg: ASAAS_OK });
  const r = await tratarAcao(deps, { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null }, { acao: "whatsapp_qrcode" });
  assert.equal(r.status, 409);
});

// ------------------------------------------------------------------ mensalidade da empresa nova

test("cobrar empresa nova: assinatura mensal vencendo hoje, link no WhatsApp com os dados de acesso", async () => {
  const { asaas, banco, deps } = cenario({ cfg: { ...ASAAS_OK, ...ZAP } });
  const sa = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  const r = await tratarAcao(deps, sa, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id, senha: "Vt12345678ab" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const sub = asaas.chamadas.find((c) => c.caminho === "/subscriptions" && c.metodo === "POST").corpo;
  assert.equal(sub.cycle, "MONTHLY");
  assert.equal(sub.nextDueDate, "2026-10-30");
  assert.equal(sub.value, 199.9);
  assert.equal(sub.billingType, "UNDEFINED");
  assert.equal(sub.description, "Vertces: plano Profissional");
  assert.equal(banco.cobrancas[EMPRESA.id].situacao, "aguardando");
  assert.equal(banco.cobrancas[EMPRESA.id].link_pagamento, r.corpo.link);
  assert.equal(banco.pagamentos[0].finalidade, "mensalidade");
  assert.equal(banco.empresas[EMPRESA.id].dia_renovacao, 30, "os créditos renovam no dia do vencimento");
  assert.equal(r.corpo.whatsapp.enviado, true);
  const texto = asaas.chamadas.find((c) => c.whatsapp).corpo.text;
  assert.match(texto, /Para liberar o acesso, pague a primeira mensalidade de R\$\s199,90/);
  assert.ok(texto.includes(r.corpo.link));
  assert.match(texto, /Senha provisória: Vt12345678ab/);
  assert.match(texto, /Login: contato@pagante\.test/);
  assert.equal(r.corpo.mensagem, texto, "a tela mostra o mesmo texto");
});

test("cobrar de novo uma empresa com assinatura: manda a mensalidade em aberto, sem criar outra assinatura", async () => {
  const { asaas, banco, deps } = cenario({ cfg: ASAAS_OK });
  const sa = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  await tratarAcao(deps, sa, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id });
  const r = await tratarAcao(deps, sa, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id });
  assert.equal(asaas.assinaturas.size, 1);
  assert.equal(r.corpo.whatsapp.configurado, false, "sem Evolution: a tela oferece copiar e o wa.me");
  assert.doesNotMatch(r.corpo.mensagem, /Senha provisória/, "sem senha: é só a cobrança");
  assert.match(r.corpo.mensagem, /vencimento 30\/10\/2026/);
  assert.equal(banco.pagamentos.length, 1);
});

test("empresa sem mensalidade não gera cobrança", async () => {
  const { banco, deps } = cenario({ cfg: ASAAS_OK });
  banco.empresas[EMPRESA.id].mensalidade = null;
  const r = await tratarAcao(deps, { superadmin: true }, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /não tem mensalidade/);
});

test("conferir: o que foi pago no Asaas e não chegou pelo webhook é aplicado (e avisado)", async () => {
  const { asaas, banco, deps } = cenario({ cfg: { ...ASAAS_OK, ...ZAP } });
  const sa = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  await tratarAcao(deps, sa, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id, enviar_whatsapp: false });
  const pag = banco.pagamentos[0];
  pag.status = "PENDING";
  asaas.cobrancas.get(pag.asaas_id).status = "RECEIVED";
  banco.respostaAplicar = { acao: "ativou", escritorio_id: EMPRESA.id };
  const dono = { id: "d1", email: null, superadmin: false, escritorioId: EMPRESA.id };
  const r = await tratarAcao(deps, dono, { acao: "conferir" });
  assert.deepEqual(r.corpo.mudancas, ["ativou"]);
  assert.equal(banco.aplicados[0].evento, "CONFERENCIA");
  assert.match(asaas.chamadas.filter((c) => c.whatsapp).at(-1).corpo.text, /está liberado/);
});

test("conferir sem mudança no Asaas não reaplica nada", async () => {
  const { banco, deps } = cenario({ cfg: ASAAS_OK });
  const sa = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  await tratarAcao(deps, sa, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id });
  const r = await tratarAcao(deps, sa, { acao: "conferir", escritorio_id: EMPRESA.id });
  assert.equal(r.corpo.conferidos, 1);
  assert.deepEqual(r.corpo.mudancas, []);
});

test("atualizar a assinatura leva a mensalidade nova ao Asaas (e às cobranças em aberto)", async () => {
  const { asaas, banco, deps } = cenario({ cfg: ASAAS_OK });
  const sa = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  await tratarAcao(deps, sa, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id });
  banco.empresas[EMPRESA.id].mensalidade = 149.9;
  await tratarAcao(deps, sa, { acao: "atualizar_assinatura", escritorio_id: EMPRESA.id });
  const put = asaas.chamadas.find((c) => c.metodo === "PUT" && c.caminho.startsWith("/subscriptions/"));
  assert.deepEqual({ value: put.corpo.value, updatePendingPayments: put.corpo.updatePendingPayments }, { value: 149.9, updatePendingPayments: true });
  assert.equal(banco.cobrancas[EMPRESA.id].valor, 149.9);
});

// ------------------------------------------------------------------ peças puras

test("preço por faixa: os mesmos casos do teste do banco", () => {
  const soCar = [{ a_partir_de: 2, preco: 19.9 }, { a_partir_de: 10, preco: 15 }, { a_partir_de: 51, preco: 10 }];
  assert.equal(minimoDe(soCar), 2);
  assert.equal(cotar(soCar, 1), null, "abaixo do mínimo");
  assert.deepEqual(cotar(soCar, 2), { unitario: 19.9, total: 39.8 });
  assert.equal(cotar(soCar, 9).unitario, 19.9);
  assert.deepEqual(cotar(soCar, 10), { unitario: 15, total: 150 });
  assert.equal(cotar(soCar, 50).unitario, 15);
  assert.deepEqual(cotar(soCar, 51), { unitario: 10, total: 510 });
  assert.equal(cotar(soCar, 1001), null, "acima do máximo");
  assert.deepEqual(cotar([{ a_partir_de: 2, preco: 9.9 }], 3), { unitario: 9.9, total: 29.7 });
  assert.equal(cotar([], 5), null, "sem tabela: não está à venda");
  assert.deepEqual(faixasEmTexto(soCar), ["2 a 9: R$ 19,90 cada", "10 a 50: R$ 15,00 cada", "51 ou mais: R$ 10,00 cada"]);
  assert.match(problemaDasFaixas([{ a_partir_de: 2, preco: 1 }, { a_partir_de: 2, preco: 2 }]), /Duas faixas/);
  assert.equal(problemaDasFaixas(soCar), null);
});

test("textos: créditos do plano, data e número do WhatsApp", () => {
  assert.equal(textoCreditos([{ nome: "Créditos gerais", por_mes: 6 }, { nome: "Créditos de CAR", por_mes: 12 }]), "6 créditos gerais e 12 créditos de CAR por mês");
  assert.equal(textoCreditos([{ nome: "Créditos gerais", por_mes: 0 }, { nome: "Créditos de CAR", por_mes: 5 }]), "5 créditos de CAR por mês");
  assert.equal(textoCreditos([{ nome: "Créditos gerais", por_mes: 1 }]), "1 crédito geral por mês");
  assert.equal(textoCreditos([{ nome: "Créditos gerais", por_mes: null }]), "créditos gerais sem limite por mês");
  assert.equal(dataBr("2026-11-30"), "30/11/2026");
  assert.equal(numeroWhatsApp("(71) 99999-0000"), "5571999990000");
  assert.equal(numeroWhatsApp("5571999990000"), "5571999990000");
  assert.equal(numeroWhatsApp("999"), null);
  assert.equal(mensagemDoAsaas({ errors: [{ description: "CPF inválido" }] }, "x"), "CPF inválido");
  assert.ok(mesmoToken("a".repeat(40), "a".repeat(40)) && !mesmoToken("a".repeat(40), "a".repeat(39) + "b") && !mesmoToken("", ""));
  assert.equal(somarDias("2026-12-31", 2), "2027-01-02");
  const nova = mensagemCobranca({ responsavel: "Maria", empresa: "X", plano: "Só CAR", valor: 49.9, link: "https://l", url: "https://u", login: "a@b", senha: "S1" });
  assert.match(nova, /^Olá, Maria!/);
  assert.ok(nova.indexOf("https://l") < nova.indexOf("Senha provisória"), "o link vem antes dos dados de acesso");
  assert.match(mensagemAcessoLiberado({ responsavel: null, empresa: "X", url: "https://u" }), /^Olá!/);
});

// ------------------------------------------------------------------ cartão de crédito (0037)

const CARTAO = { numero: "4111 1111 1111 1111", nome: "Maria Souza", validade: "12/29", cvv: "123" };
const TITULAR = { nome: "Maria Souza", cpf_cnpj: "529.982.247-25", email: "maria@pagante.test", telefone: "(71) 99999-0000", cep: "40000-000", numero_endereco: "10" };
const SA = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };

test("validação do cartão: Luhn, validade, CPF do titular; somarMes no fim do mês", () => {
  assert.equal(luhnValido("4111111111111111"), true);
  assert.equal(luhnValido("4111111111111112"), false);
  assert.deepEqual(lerValidade("12/29", "2026-11-04"), { mes: "12", ano: "2029" });
  assert.equal(lerValidade("10/26", "2026-11-04"), null, "vencido");
  assert.equal(lerValidade("13/27", "2026-11-04"), null);
  assert.equal(cpfValido("529.982.247-25"), true);
  assert.equal(cpfValido("111.111.111-11"), false);
  assert.deepEqual(problemasDoCartao(CARTAO, TITULAR, "2026-11-04"), {});
  assert.ok(problemasDoCartao({ ...CARTAO, numero: "1234" }, TITULAR, "2026-11-04").numero);
  assert.equal(bandeiraDoNumero("5162306219378829"), "Mastercard");
  assert.equal(somarMes("2026-01-31"), "2026-02-28");
  assert.equal(somarMes("2026-10-30"), "2026-11-30");
  assert.equal(somarMes("2026-12-15"), "2027-01-15");
});

test("cartão na empresa que espera a 1ª mensalidade: o cartão paga o link em aberto, libera e a mensalidade vira cartão", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: { ...ASAAS_OK, ...ZAP } });
  await tratarAcao(deps, SA, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id, enviar_whatsapp: false });
  const antiga = banco.cobrancas[EMPRESA.id].asaas_assinatura_id;
  banco.respostaAplicar = (ev, p) => ({ acao: p.status === "CONFIRMED" ? "ativou" : "atualizado", escritorio_id: EMPRESA.id });
  const r = await tratarAcao(deps, usuario, { acao: "cartao_salvar", cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.ativou, true, "pagou a 1ª e liberou na hora");
  assert.equal(r.corpo.reutilizavel, true);
  const tok = asaas.chamadas.find((c) => c.caminho === "/creditCard/tokenizeCreditCard");
  assert.equal(tok.corpo.remoteIp, "200.10.20.30", "o IP é o do navegador");
  const pago = asaas.chamadas.find((c) => /payWithCreditCard$/.test(c.caminho));
  assert.deepEqual(pago.corpo, { creditCardToken: asaas.tokens[0].creditCardToken, remoteIp: "200.10.20.30" }, "paga com o token, sem repetir o número");
  const nova = asaas.chamadas.filter((c) => c.caminho === "/subscriptions" && c.metodo === "POST").at(-1).corpo;
  assert.equal(nova.billingType, "CREDIT_CARD");
  assert.equal(nova.creditCardToken, asaas.tokens[0].creditCardToken);
  assert.equal(nova.nextDueDate, "2026-11-30", "a próxima no cartão é a do mês seguinte");
  assert.ok(asaas.chamadas.some((c) => c.metodo === "DELETE" && c.caminho === `/subscriptions/${antiga}`), "a assinatura de boleto/Pix sai");
  assert.notEqual(banco.cobrancas[EMPRESA.id].asaas_assinatura_id, antiga);
  assert.equal(banco.cobrancas[EMPRESA.id].link_pagamento, null);
  const c = banco.cartoes[EMPRESA.id];
  assert.deepEqual({ final: c.final, validade: c.validade, bandeira: c.bandeira, token: !!c.asaas_token }, { final: "1111", validade: "12/2029", bandeira: "VISA", token: true });
  const tudo = JSON.stringify(banco);
  assert.ok(!tudo.includes("4111111111111111") && !tudo.includes("\"123\""), "número e CVV não ficam gravados");
  assert.equal(banco.atividades[0].acao, "cartao.cadastrado");
});

test("cartão sem tokenização liberada no Asaas: a mensalidade vai para o cartão com os dados, mas não compra créditos", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  asaas.tokenizacaoBloqueada = true;
  banco.empresas[EMPRESA.id].status = "ativo";
  banco.empresas[EMPRESA.id].renovacao = "2026-11-15";
  const r = await tratarAcao(deps, usuario, { acao: "cartao_salvar", cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.reutilizavel, false);
  assert.equal(banco.cfg.asaas_tokenizacao, "bloqueada");
  const sub = asaas.chamadas.find((c) => c.caminho === "/subscriptions" && c.metodo === "POST").corpo;
  assert.equal(sub.creditCard.number, "4111111111111111", "sem token, o cartão vai direto na assinatura");
  assert.equal(sub.creditCardHolderInfo.cpfCnpj, "52998224725");
  assert.equal(sub.nextDueDate, "2026-11-15", "quem já usa começa a pagar na renovação dos créditos");
  assert.equal(banco.cobrancas[EMPRESA.id].situacao, "em_dia");
  assert.equal(banco.cartoes[EMPRESA.id].asaas_token, null);
});

test("empresa nova sem cobrança gerada: a 1ª é cobrada no cartão já; recusado, nada fica pendurado", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  banco.respostaAplicar = { acao: "ativou", escritorio_id: EMPRESA.id };
  const r = await tratarAcao(deps, usuario, { acao: "cartao_salvar", cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.ativou, true);
  assert.equal(asaas.chamadas.find((c) => c.caminho === "/subscriptions" && c.metodo === "POST").corpo.nextDueDate, "2026-10-31",
    "vence amanhã (o Asaas não cobra sozinho na criação) e o sistema paga a 1ª agora");
  assert.equal(asaas.chamadas.filter((c) => /payWithCreditCard$/.test(c.caminho)).length, 1, "uma cobrança só");
  assert.equal(banco.empresas[EMPRESA.id].dia_renovacao, 31, "o mês do crédito começa no vencimento");

  const s2 = cenario({ cfg: ASAAS_OK });
  s2.asaas.tokenizacaoBloqueada = true;
  const rotas = s2.asaas.fetch;
  // a operadora recusa na hora de cobrar (a assinatura nasce, a cobrança não passa)
  const recusando = async (url, init = {}) => (/payWithCreditCard$/.test(String(url))
    ? new Response(JSON.stringify({ errors: [{ description: "Transação não autorizada." }] }), { status: 400 }) : rotas(url, init));
  const r2 = await tratarAcao({ ...s2.deps, fetch: recusando }, s2.usuario, { acao: "cartao_salvar", cartao: CARTAO, titular: TITULAR });
  assert.equal(r2.status, 400);
  assert.match(r2.corpo.erro, /O cartão não foi aceito: Transação não autorizada/);
  assert.equal(s2.banco.cobrancas[EMPRESA.id].asaas_assinatura_id, null, "a assinatura recusada sai");
  assert.equal(s2.asaas.assinaturas.size, 0);
  assert.equal(s2.banco.cartoes[EMPRESA.id], undefined, "cartão recusado não fica salvo");
});

test("cartão: só o dono cadastra; dado inválido nem chega ao Asaas; recusa na tokenização vira mensagem clara", async () => {
  const { asaas, deps, usuario } = cenario({ cfg: ASAAS_OK });
  let r = await tratarAcao(deps, { ...usuario, souDono: false }, { acao: "cartao_salvar", cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 403);
  r = await tratarAcao(deps, usuario, { acao: "cartao_salvar", cartao: { ...CARTAO, numero: "4111 1111 1111 1112" }, titular: TITULAR });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /Número do cartão inválido/);
  assert.equal(asaas.chamadas.length, 0);
  asaas.recusarCartao = "Cartão sem limite.";
  r = await tratarAcao(deps, usuario, { acao: "cartao_salvar", cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, "O cartão não foi aceito: Cartão sem limite.");
});

test("comprar créditos no cartão salvo: cobra com o token e os créditos entram na hora", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  banco.cartoes[EMPRESA.id] = { asaas_token: "tok_salvo", final: "1111" };
  banco.respostaAplicar = { acao: "creditos", escritorio_id: EMPRESA.id, credito_id: "cred-1" };
  const r = await tratarAcao(deps, usuario, { acao: "comprar_creditos", tipo: "car", quantidade: 10, forma: "cartao" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.pago, true);
  const cob = asaas.chamadas.find((c) => c.caminho === "/payments" && c.metodo === "POST").corpo;
  assert.deepEqual({ b: cob.billingType, t: cob.creditCardToken, v: cob.value, ip: cob.remoteIp }, { b: "CREDIT_CARD", t: "tok_salvo", v: 150, ip: "200.10.20.30" });
  assert.equal(banco.pagamentos.find((p) => p.id === "pag-1").forma, "CREDIT_CARD");
  assert.equal(banco.aplicados.at(-1).pagamento.status, "CONFIRMED");
  asaas.recusarCartao = "Saldo insuficiente.";
  const r2 = await tratarAcao(deps, usuario, { acao: "comprar_creditos", tipo: "car", quantidade: 10, forma: "cartao" });
  assert.equal(r2.status, 400);
  assert.equal(banco.cancelados.length, 1, "recusado: a compra é cancelada");
});

test("compra automática: carteira zerada compra no cartão e avisa no WhatsApp; recusa segura e avisa", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: { ...ASAAS_OK, ...ZAP } });
  banco.cartoes[EMPRESA.id] = { asaas_token: "tok_salvo", final: "4242" };
  banco.recargas = ["car", "geral"];
  banco.reserva = (tipo) => (tipo === "car"
    ? { pode: true, credito_id: "cred-auto", pagamento_id: "pag-auto", escritorio_id: EMPRESA.id, online: true, quantidade: 10, unitario: 15, valor: 150, descricao: "10 créditos de CAR" }
    : { pode: false, motivo: "tem_saldo" });
  banco.respostaAplicar = { acao: "creditos", escritorio_id: EMPRESA.id, credito_id: "cred-auto" };
  const r = await tratarAcao(deps, usuario, { acao: "recarga_automatica" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(r.corpo.compras, [{ tipo: "car", descricao: "10 créditos de CAR", valor: 150, ok: true }]);
  assert.deepEqual(r.corpo.motivos, { geral: "tem_saldo" });
  const cob = asaas.chamadas.find((c) => c.caminho === "/payments" && c.metodo === "POST").corpo;
  assert.equal(cob.creditCardToken, "tok_salvo");
  assert.match(cob.description, /compra automática/);
  const zap = asaas.chamadas.filter((c) => c.whatsapp && c.metodo === "POST").at(-1).corpo.text;
  assert.match(zap, /compra automática repôs: 10 créditos de car \(R\$\s50,00\), no cartão final 4242/);

  asaas.recusarCartao = "Cartão bloqueado.";
  const r2 = await tratarAcao(deps, usuario, { acao: "recarga_automatica", tipo: "car" });
  assert.equal(r2.corpo.compras[0].ok, false);
  assert.ok(banco.cartoes[EMPRESA.id].recusa_em, "a recusa fica marcada (segura novas tentativas)");
  assert.equal(banco.cartoes[EMPRESA.id].recusa_motivo, "Cartão bloqueado.");
  assert.equal(banco.cancelados.at(-1).creditoId, "cred-auto");
  assert.match(asaas.chamadas.filter((c) => c.whatsapp && c.metodo === "POST").at(-1).corpo.text, /foi recusada no cartão final 4242: Cartão bloqueado/);
});

test("remover o cartão: a mensalidade volta para boleto/Pix no mesmo vencimento", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  banco.empresas[EMPRESA.id].status = "ativo";
  banco.empresas[EMPRESA.id].renovacao = "2026-11-15";
  await tratarAcao(deps, usuario, { acao: "cartao_salvar", cartao: CARTAO, titular: TITULAR });
  const noCartao = banco.cobrancas[EMPRESA.id].asaas_assinatura_id;
  const r = await tratarAcao(deps, usuario, { acao: "cartao_remover" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const nova = asaas.chamadas.filter((c) => c.caminho === "/subscriptions" && c.metodo === "POST").at(-1).corpo;
  assert.deepEqual({ b: nova.billingType, v: nova.nextDueDate }, { b: "UNDEFINED", v: "2026-11-15" });
  assert.ok(asaas.chamadas.some((c) => c.metodo === "DELETE" && c.caminho === `/subscriptions/${noCartao}`));
  assert.equal(banco.cartoes[EMPRESA.id], undefined);
});

test("empresa criada já liberada: 1ª mensalidade vence em 3 dias e a mensagem diz que o acesso está liberado", async () => {
  const { asaas, banco, deps } = cenario({ cfg: { ...ASAAS_OK, ...ZAP } });
  banco.empresas[EMPRESA.id].status = "ativo";
  const r = await tratarAcao(deps, SA, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id, liberada: true, senha: "Vt12345678ab" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(asaas.chamadas.find((c) => c.caminho === "/subscriptions").corpo.nextDueDate, "2026-11-02");
  assert.match(r.corpo.mensagem, /e o acesso já está liberado/);
  assert.match(r.corpo.mensagem, /vence em 02\/11\/2026/);
  assert.match(r.corpo.mensagem, /cadastre o cartão de crédito no primeiro acesso/);
});

test("painel: mostra se a conta do Asaas guarda cartões (tokenização)", async () => {
  const { asaas, banco, deps } = cenario({ cfg: ASAAS_OK });
  asaas.tokenizacaoBloqueada = true;
  let r = await tratarAcao(deps, SA, { acao: "config_status" });
  assert.equal(r.corpo.asaas.tokenizacao, "bloqueada");
  asaas.tokenizacaoBloqueada = false;
  r = await tratarAcao(deps, SA, { acao: "config_status" });
  assert.equal(r.corpo.asaas.tokenizacao, "liberada");
  assert.equal(banco.cfg.asaas_tokenizacao, "liberada");
  const antes = asaas.chamadas.length;
  await tratarAcao(deps, SA, { acao: "config_status" });
  assert.ok(!asaas.chamadas.slice(antes).some((c) => c.caminho.includes("tokenize")), "liberada uma vez, não pergunta mais");
});

// ------------------------------------------------------------------ autocadastro (0040)

const PLANO = { id: "1f0c8a2e-1111-4a1b-9c3d-0123456789ab", nome: "Autônomo", preco_mensal: 299.9, ativo: true, vende_no_site: true };
const ABERTO = { ...ASAAS_OK, cadastro_aberto: "true" };
const DADOS = {
  acao: "cadastro_criar", empresa: "Geo  Lima ", documento: "529.982.247-25", responsavel: "Ana Lima", email: "Ana@GeoLima.test",
  telefone: "(71) 98888-7777", senha: "Senha1234", plano_id: PLANO.id, ciclo: "anual", aceite_termos: true,
  versao_termos: "2026-10-08-minuta", site: "",
};
/** a trava de frequência da função (dentroDoLimite), contando de verdade */
function limiteFalso() {
  const usos = new Map();
  const f = async (chave, max) => { const n = (usos.get(chave) ?? 0) + 1; usos.set(chave, n); return n <= max; };
  f.usos = usos;
  return f;
}
function cenarioCadastro(cfg = ABERTO) {
  const c = cenario({ cfg });
  c.banco.planos[PLANO.id] = { ...PLANO };
  c.deps.limite = limiteFalso();
  return c;
}

test("autocadastro: conta confirmada, empresa do site esperando o pagamento, dona, configurações e o período", async () => {
  const { asaas, banco, deps } = cenarioCadastro({ ...ABERTO, ...ZAP, whatsapp_avisos: "71977776666" });
  const r = await tratarPublico(deps, "200.1.2.3", DADOS);
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual(banco.contas.map((c) => [c.email, c.senha]), [["ana@geolima.test", "Senha1234"]], "e-mail em minúsculas, a senha que a pessoa escolheu");
  assert.deepEqual(banco.contas[0].meta, { nome: "Ana Lima", termos_versao: "2026-10-08-minuta" }, "o aceite dos termos vai como no cadastro antigo (gatilho grava em aceites_termos)");
  const e = banco.empresas[r.corpo.escritorio_id];
  assert.deepEqual({ nome: e.nome, cnpj: e.cnpj, tel: e.telefone, status: e.status, origem: e.origem, plano: e.plano_id },
    { nome: "Geo Lima", cnpj: "52998224725", tel: "71988887777", status: "aguardando_pagamento", origem: "site", plano: PLANO.id });
  assert.deepEqual(banco.membros, [{ esc: e.id, user: banco.contas[0].id, nome: "Ana Lima", papel: "dono" }]);
  assert.deepEqual(banco.configEmpresa, [{ esc: e.id, razao_social: "Geo Lima", cnpj: "52998224725" }]);
  assert.deepEqual(banco.cobrancas[e.id], { situacao: "sem_assinatura", ciclo: "YEARLY", valor: 3598.8 }, "anual = 12 × R$ 299,90, calculado no servidor");
  assert.equal(r.corpo.login, "ana@geolima.test");
  assert.equal(banco.atividades.at(-1).acao, "empresa.cadastro_site");
  const zaps = asaas.chamadas.filter((c) => c.whatsapp);
  assert.equal(zaps.length, 2, "a pessoa e o superadmin");
  assert.match(zaps.find((z) => z.corpo.number === "5571988887777").corpo.text, /Falta só o pagamento.*Pix ou no cartão em até 12x/s);
  assert.match(zaps.find((z) => z.corpo.number === "5571977776666").corpo.text, /Novo cadastro pelo site.*Geo Lima \(529\.982\.247-25\)/s);
  assert.ok(!JSON.stringify(banco.cobrancas).includes("Senha1234"), "a senha não vai para tabela nenhuma");
});

test("autocadastro: tudo é conferido no servidor (dados, plano, período, cadastro fechado, robô)", async () => {
  const casos = [
    [{ documento: "529.982.247-26" }, 400, /CPF ou CNPJ inválido/],
    [{ senha: "12345678" }, 400, /letras e números/],
    [{ aceite_termos: false }, 400, /aceite os Termos/],
    [{ email: "ana@" }, 400, /E-mail inválido/],
    [{ telefone: "9999" }, 400, /WhatsApp com DDD/],
    [{ empresa: "x" }, 400, /nome da empresa/],
    [{ ciclo: "bimestral" }, 400, /período/],
    [{ versao_termos: "<script>" }, 400, /termos/],
    [{ plano_id: "nao-e-uuid" }, 400, /plano/],
    [{ site: "https://spam.test" }, 400, /Recarregue a página/],
  ];
  for (const [mudar, status, erro] of casos) {
    const { banco, deps } = cenarioCadastro();
    const r = await tratarPublico(deps, "200.1.2.3", { ...DADOS, ...mudar });
    assert.equal(r.status, status, JSON.stringify(mudar));
    assert.match(r.corpo.erro, erro, JSON.stringify(mudar));
    assert.equal(banco.contas.length, 0, "nada é criado");
  }
  // plano fora do autocadastro, inativo ou sem mensalidade
  for (const plano of [{ vende_no_site: false }, { ativo: false }, { preco_mensal: 0 }]) {
    const { banco, deps } = cenarioCadastro();
    Object.assign(banco.planos[PLANO.id], plano);
    const r = await tratarPublico(deps, "200.1.2.3", DADOS);
    assert.equal(r.status, 400, JSON.stringify(plano));
    assert.match(r.corpo.erro, /não está disponível para assinatura pelo site/);
  }
  // período desligado pelo superadmin
  let c = cenarioCadastro({ ...ABERTO, ciclos: JSON.stringify({ YEARLY: { ativo: false } }) });
  let r = await tratarPublico(c.deps, "200.1.2.3", DADOS);
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /anual não está disponível/);
  // cadastro fechado, ou aberto mas sem o Asaas (não haveria como pagar)
  for (const cfg of [ASAAS_OK, { cadastro_aberto: "true" }]) {
    c = cenarioCadastro(cfg);
    r = await tratarPublico(c.deps, "200.1.2.3", DADOS);
    assert.equal(r.status, 403);
    assert.match(r.corpo.erro, /fechado/);
  }
  r = await tratarPublico(cenarioCadastro().deps, "200.1.2.3", { acao: "outra" });
  assert.equal(r.status, 400);
});

test("autocadastro: limite por IP (5 por hora, contando as tentativas) e no total do dia", async () => {
  const { banco, deps } = cenarioCadastro();
  delete banco.planos[PLANO.id]; // toda tentativa passa da trava e falha depois: conta do mesmo jeito
  for (let i = 0; i < 5; i++) assert.equal((await tratarPublico(deps, "200.1.2.3", DADOS)).status, 400);
  const r = await tratarPublico(deps, "200.1.2.3", DADOS);
  assert.equal(r.status, 429);
  assert.match(r.corpo.erro, /Muitos cadastros seguidos/);
  assert.equal((await tratarPublico(deps, "200.9.9.9", DADOS)).status, 400, "outra conexão continua podendo");
  const errado = await tratarPublico(deps, "200.1.2.3", { ...DADOS, senha: "curta" });
  assert.equal(errado.status, 400, "erro de digitação é respondido antes da trava (não gasta a vez)");
  assert.ok(deps.limite.usos.get("cadastro:total-dia") <= 200);
  const c = cenarioCadastro();
  c.deps.limite.usos.set("cadastro:total-dia", 200);
  assert.equal((await tratarPublico(c.deps, "200.7.7.7", DADOS)).status, 429, "200 cadastros no dia: fecha até amanhã");
});

test("autocadastro: e-mail ou documento já cadastrados dão 409 com a mensagem; falha no meio desfaz tudo", async () => {
  let c = cenarioCadastro();
  let r = await tratarPublico(c.deps, "200.1.2.3", { ...DADOS, documento: "11.222.333/0001-81" });
  assert.equal(r.status, 409);
  assert.equal(r.corpo.erro, "Já existe uma conta com este CNPJ. Entre com ela ou fale com o suporte.");
  assert.equal(c.banco.contas.length, 0);
  c.banco.contas.push({ id: "user-antigo", email: "ana@geolima.test" });
  r = await tratarPublico(c.deps, "200.1.2.3", DADOS);
  assert.equal(r.status, 409);
  assert.equal(r.corpo.erro, "Já existe uma conta com este e-mail. Entre com ela.");

  c = cenarioCadastro();
  c.banco.falharEm = "membro";
  r = await tratarPublico(c.deps, "200.1.2.3", DADOS);
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.corpo.erro, /membro/, "a página pública não vê o erro interno");
  assert.equal(c.banco.contas.length, 0, "a conta criada sai");
  assert.equal(c.banco.removidas.length, 1, "e a empresa também");
  assert.ok(!Object.values(c.banco.empresas).some((e) => e.origem === "site"));

  c = cenarioCadastro();
  c.banco.falharEm = "empresa-duplicada"; // dois cadastros do mesmo CPF ao mesmo tempo
  r = await tratarPublico(c.deps, "200.1.2.3", DADOS);
  assert.equal(r.status, 409);
  assert.match(r.corpo.erro, /Já existe uma conta com este CPF/);
  assert.equal(c.banco.contas.length, 0);
});

// a empresa que acabou de se cadastrar pelo site (anual, ainda sem cobrança)
const SITE = {
  id: "esc-site", nome: "Geo Lima", cnpj: "52998224725", email: "ana@geolima.test", telefone: "71988887777", responsavel: "Ana Lima",
  status: "aguardando_pagamento", plano: "Autônomo", mensalidade: 299.9, login: "ana@geolima.test", origem: "site",
  creditos: [{ nome: "Créditos gerais", por_mes: 6 }],
};
function cenarioPagamento(cfg = ABERTO, ciclo = "YEARLY", valor = 3598.8) {
  const c = cenario({ cfg });
  c.banco.empresas[SITE.id] = { ...SITE };
  c.banco.cobrancas[SITE.id] = { situacao: "sem_assinatura", ciclo, valor };
  c.usuario.escritorioId = SITE.id;
  return c;
}
const posts = (asaas, caminho) => asaas.chamadas.filter((c) => c.metodo === "POST" && c.caminho === caminho);
/** o que o banco faz ao aplicar (aplicar_pagamento_asaas, testado em tests/rls/autocadastro.sql) */
function bancoQueAtiva(banco, meses) {
  return (evento, p) => {
    if (p.status === "AWAITING_RISK_ANALYSIS") return { acao: "em_analise", escritorio_id: SITE.id };
    const cob = banco.cobrancas[SITE.id];
    const primeiraVez = banco.empresas[SITE.id].status === "aguardando_pagamento";
    banco.empresas[SITE.id].status = "ativo";
    cob.situacao = "em_dia";
    cob.proximo_vencimento = somarMeses(p.dueDate, meses);
    return primeiraVez
      ? { acao: "ativou", escritorio_id: SITE.id, ...(p.installment && !cob.asaas_assinatura_id ? { criar_assinatura: true, ciclo: cob.ciclo, proximo_vencimento: cob.proximo_vencimento } : {}) }
      : { acao: "renovou", escritorio_id: SITE.id };
  };
}

test("pagar o cadastro no Pix: assinatura do período vencendo hoje, QR e copia e cola; de novo reaproveita; outro período troca", async () => {
  const { asaas, banco, deps, usuario } = cenarioPagamento({ ...ABERTO, ciclos: JSON.stringify({ YEARLY: { ativo: true, desconto: 10 } }) }, "YEARLY", 3238.92);
  const r = await tratarAcao(deps, usuario, { acao: "pagar_cadastro", forma: "pix", ciclo: "YEARLY", valor: 1 });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const sub = posts(asaas, "/subscriptions")[0].corpo;
  assert.deepEqual({ b: sub.billingType, c: sub.cycle, v: sub.value, d: sub.nextDueDate }, { b: "UNDEFINED", c: "YEARLY", v: 3238.92, d: "2026-10-30" },
    "anual com 10% de desconto, vencendo hoje — o valor que o navegador mandou é ignorado");
  assert.match(sub.description, /plano Autônomo \(anual\)/);
  assert.equal(asaas.clientes[0].cpfCnpj, "52998224725", "o Asaas aceita o CPF");
  assert.equal(r.corpo.pix.payload, "000201pix");
  assert.equal(r.corpo.valor, 3238.92);
  assert.deepEqual({ s: banco.cobrancas[SITE.id].situacao, c: banco.cobrancas[SITE.id].ciclo, l: !!banco.cobrancas[SITE.id].link_pagamento },
    { s: "aguardando", c: "YEARLY", l: true });
  assert.deepEqual({ f: banco.pagamentos[0].finalidade, c: banco.pagamentos[0].ciclo, v: banco.pagamentos[0].valor },
    { f: "mensalidade", c: "YEARLY", v: 3238.92 });
  assert.equal(banco.empresas[SITE.id].dia_renovacao, 30, "os créditos renovam no dia do pagamento");

  // voltou à tela: o mesmo Pix, sem outra assinatura
  const r2 = await tratarAcao(deps, usuario, { acao: "pagar_cadastro", forma: "pix", ciclo: "anual" });
  assert.equal(r2.status, 200);
  assert.equal(posts(asaas, "/subscriptions").length, 1);
  assert.equal(r2.corpo.link, r.corpo.link);
  // trocou para o mensal: a assinatura anual sai, nasce a mensal
  const antiga = banco.cobrancas[SITE.id].asaas_assinatura_id;
  const r3 = await tratarAcao(deps, usuario, { acao: "pagar_cadastro", forma: "pix", ciclo: "MONTHLY" });
  assert.equal(r3.status, 200, JSON.stringify(r3.corpo));
  assert.ok(asaas.chamadas.some((c) => c.metodo === "DELETE" && c.caminho === `/subscriptions/${antiga}`));
  assert.deepEqual({ c: posts(asaas, "/subscriptions")[1].corpo.cycle, v: posts(asaas, "/subscriptions")[1].corpo.value }, { c: "MONTHLY", v: 299.9 });
  assert.equal(banco.cobrancas[SITE.id].ciclo, "MONTHLY");
});

test("pagar o cadastro no cartão 1x: assinatura no cartão no período escolhido, a 1ª paga agora e libera", async () => {
  const { asaas, banco, deps, usuario } = cenarioPagamento();
  banco.respostaAplicar = bancoQueAtiva(banco, 12);
  const r = await tratarAcao(deps, usuario, { acao: "pagar_cadastro", forma: "cartao", ciclo: "YEARLY", parcelas: 1, cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.ativou, true);
  const sub = posts(asaas, "/subscriptions")[0].corpo;
  assert.deepEqual({ b: sub.billingType, c: sub.cycle, v: sub.value, d: sub.nextDueDate }, { b: "CREDIT_CARD", c: "YEARLY", v: 3598.8, d: "2026-10-31" },
    "vence amanhã (o Asaas não cobra sozinho) e o sistema paga a 1ª agora");
  assert.equal(asaas.chamadas.filter((c) => /payWithCreditCard$/.test(c.caminho)).length, 1, "uma cobrança só");
  assert.equal(posts(asaas, "/payments").length, 0, "nada de compra parcelada no 1x");
  assert.equal(banco.cartoes[SITE.id].final, "1111", "o cartão fica salvo, como no Cadastrar cartão");
});

test("pagar o cadastro em 6x sem juros: totalValue sem value, o total gravado; aprovado, ativa e cria a assinatura do período seguinte", async () => {
  const { asaas, banco, deps, usuario } = cenarioPagamento(ABERTO, "SEMIANNUALLY", 1799.4);
  banco.respostaAplicar = bancoQueAtiva(banco, 6);
  const r = await tratarAcao(deps, usuario, { acao: "pagar_cadastro", forma: "cartao", ciclo: "SEMIANNUALLY", parcelas: 6, cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const compra = posts(asaas, "/payments");
  assert.equal(compra.length, 1, "uma compra só");
  const c = compra[0].corpo;
  assert.deepEqual({ b: c.billingType, n: c.installmentCount, t: c.totalValue, iv: c.installmentValue, v: c.value, ip: c.remoteIp, d: c.dueDate },
    { b: "CREDIT_CARD", n: 6, t: 1799.4, iv: undefined, v: undefined, ip: "200.10.20.30", d: "2026-10-30" });
  assert.equal(c.creditCard.number, "4111111111111111");
  assert.equal(c.creditCardHolderInfo.cpfCnpj, "52998224725");
  assert.match(c.description, /6x de R\$\s299,90 sem juros/);
  const pag = banco.pagamentos[0];
  assert.deepEqual({ v: pag.valor, n: pag.parcelas, i: pag.asaas_parcelamento, c: pag.ciclo, f: pag.forma },
    { v: 1799.4, n: 6, i: asaas.parcelamentos[0].id, c: "SEMIANNUALLY", f: "CREDIT_CARD" }, "a 1ª parcela guarda o TOTAL e o parcelamento");
  assert.deepEqual({ a: r.corpo.ativou, n: r.corpo.parcelas, p: r.corpo.parcela, v: r.corpo.valor }, { a: true, n: 6, p: 299.9, v: 1799.4 });
  const sub = posts(asaas, "/subscriptions");
  assert.equal(sub.length, 1, "a assinatura dos semestres seguintes");
  assert.deepEqual({ b: sub[0].corpo.billingType, c: sub[0].corpo.cycle, v: sub[0].corpo.value, d: sub[0].corpo.nextDueDate },
    { b: "UNDEFINED", c: "SEMIANNUALLY", v: 1799.4, d: "2027-04-30" }, "começa quando o semestre pago acaba: sem cobrança em dobro");
  assert.equal(banco.cobrancas[SITE.id].asaas_assinatura_id, r.corpo.assinatura);
  assert.equal(asaas.chamadas.filter((x) => /payWithCreditCard$/.test(x.caminho)).length, 0);
  const tudo = JSON.stringify(banco);
  assert.ok(!tudo.includes("4111111111111111") && !tudo.includes("\"123\""), "número e CVV não ficam gravados");
});

test("pagar o cadastro em 12x: installmentValue pela Tabela Price; a parcela e o total voltam para a tela", async () => {
  const { asaas, banco, deps, usuario } = cenarioPagamento();
  banco.respostaAplicar = bancoQueAtiva(banco, 12);
  const r = await tratarAcao(deps, usuario, { acao: "pagar_cadastro", forma: "cartao", ciclo: "YEARLY", parcelas: 12, cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const c = posts(asaas, "/payments")[0].corpo;
  assert.deepEqual({ n: c.installmentCount, iv: c.installmentValue, t: c.totalValue, v: c.value }, { n: 12, iv: 361.33, t: undefined, v: undefined });
  assert.match(c.description, /12x de R\$\s361,33 \(total R\$\s4\.335,96; juros de 2,99% a\.m\.\)/, "o total e os juros estão na fatura");
  assert.deepEqual({ p: r.corpo.parcela, v: r.corpo.valor, n: r.corpo.parcelas }, { p: 361.33, v: 4335.96, n: 12 });
  assert.equal(banco.pagamentos[0].valor, 4335.96);
  assert.equal(banco.cobrancas[SITE.id].valor, 3598.8, "a assinatura dos anos seguintes é o valor do ano, sem os juros");
  assert.deepEqual({ c: posts(asaas, "/subscriptions")[0].corpo.cycle, v: posts(asaas, "/subscriptions")[0].corpo.value, d: posts(asaas, "/subscriptions")[0].corpo.nextDueDate },
    { c: "YEARLY", v: 3598.8, d: "2027-10-30" });
});

test("pagar o cadastro: em análise de risco devolve 'em análise' e espera; outra tentativa é barrada; aprovada pelo webhook, ativa e cria a assinatura", async () => {
  const { asaas, banco, deps, usuario } = cenarioPagamento({ ...ABERTO, asaas_webhook_token: "x".repeat(48) });
  banco.respostaAplicar = bancoQueAtiva(banco, 12);
  asaas.statusCartao = "AWAITING_RISK_ANALYSIS";
  const r = await tratarAcao(deps, usuario, { acao: "pagar_cadastro", forma: "cartao", ciclo: "YEARLY", parcelas: 8, cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.em_analise, true);
  assert.equal(r.corpo.ativou, undefined);
  assert.equal(banco.empresas[SITE.id].status, "aguardando_pagamento");
  assert.equal(posts(asaas, "/subscriptions").length, 0, "nada de assinatura antes da aprovação");
  const outra = await tratarAcao(deps, usuario, { acao: "pagar_cadastro", forma: "pix", ciclo: "YEARLY" });
  assert.equal(outra.status, 409, "dois cartões aprovados cobrariam duas vezes");
  assert.match(outra.corpo.erro, /em análise/);
  // o Asaas aprova
  const pag = banco.pagamentos[0];
  const w = await tratarWebhook(deps, "x".repeat(48), JSON.stringify({ id: "evt_ok", event: "PAYMENT_APPROVED_BY_RISK_ANALYSIS",
    payment: { id: pag.asaas_id, status: "CONFIRMED", value: 0, dueDate: "2026-10-30", installment: pag.asaas_parcelamento } }));
  assert.equal(w.corpo.acao, "ativou");
  assert.equal(banco.empresas[SITE.id].status, "ativo");
  assert.equal(posts(asaas, "/subscriptions")[0].corpo.nextDueDate, "2027-10-30", "a assinatura nasce na aprovação");
  assert.match(banco.eventos.at(-1).resultado, /assinatura sub_\d+ criada/);
});

test("pagar o cadastro: cartão recusado devolve a mensagem do Asaas e nada fica gravado; conta que exige value repete uma vez", async () => {
  let c = cenarioPagamento();
  c.asaas.recusarCartao = "Transação não autorizada. Verifique os dados do cartão de crédito e tente novamente.";
  let r = await tratarAcao(c.deps, c.usuario, { acao: "pagar_cadastro", forma: "cartao", ciclo: "YEARLY", parcelas: 3, cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, "O cartão não foi aceito: Transação não autorizada. Verifique os dados do cartão de crédito e tente novamente.");
  assert.equal(c.banco.pagamentos.length, 0);
  assert.equal(c.banco.cobrancas[SITE.id].situacao, "sem_assinatura");
  assert.equal(posts(c.asaas, "/payments").length, 1, "recusa do cartão não repete");

  c = cenarioPagamento();
  c.asaas.exigirValue = true;
  c.banco.respostaAplicar = bancoQueAtiva(c.banco, 12);
  r = await tratarAcao(c.deps, c.usuario, { acao: "pagar_cadastro", forma: "cartao", ciclo: "YEARLY", parcelas: 4, cartao: CARTAO, titular: TITULAR });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const tentativas = posts(c.asaas, "/payments").map((x) => x.corpo.value);
  assert.deepEqual(tentativas, [undefined, 899.7], "sem value; a conta pediu; de novo com value = a parcela");
  assert.equal(c.banco.cfg.asaas_parcelado_value, "enviar", "lembra para as próximas");
  r = await tratarAcao(c.deps, { ...c.usuario }, { acao: "pagar_cadastro", forma: "cartao", ciclo: "YEARLY", parcelas: 4, cartao: CARTAO, titular: TITULAR });
  assert.equal(r.corpo.ja_ativa, true, "já paga: não cobra de novo");
});

test("pagar o cadastro: as regras valem no servidor (parcelas, período, dono, empresa do painel, Pix já pago)", async () => {
  const c = cenarioPagamento(ABERTO, "SEMIANNUALLY", 1799.4);
  const pagar = (b, u = c.usuario) => tratarAcao(c.deps, u, { acao: "pagar_cadastro", forma: "cartao", cartao: CARTAO, titular: TITULAR, ...b });
  let r = await pagar({ ciclo: "SEMIANNUALLY", parcelas: 7 });
  assert.equal(r.status, 400);
  assert.match(r.corpo.erro, /de 1 a 6 parcela/);
  r = await pagar({ ciclo: "MONTHLY", parcelas: 2 });
  assert.match(r.corpo.erro, /de 1 a 1 parcela/, "mensal só à vista");
  r = await pagar({ ciclo: "YEARLY", parcelas: 1, cartao: { ...CARTAO, numero: "4111 1111 1111 1112" } });
  assert.match(r.corpo.erro, /Número do cartão inválido/);
  r = await pagar({ ciclo: "YEARLY", parcelas: 1 }, { ...c.usuario, souDono: false });
  assert.equal(r.status, 403);
  assert.equal(c.asaas.chamadas.filter((x) => !x.whatsapp).length, 0, "nada disso chega ao Asaas");
  c.banco.cfg.ciclos = JSON.stringify({ YEARLY: { ativo: false } });
  r = await pagar({ ciclo: "YEARLY", parcelas: 1 });
  assert.match(r.corpo.erro, /anual não está disponível/);
  c.banco.empresas[SITE.id].origem = "painel";
  r = await pagar({ ciclo: "SEMIANNUALLY", parcelas: 1 });
  assert.equal(r.status, 409, "empresa do painel paga pelo link que o Vertces mandou");
  c.banco.empresas[SITE.id].origem = "site";

  // gerou o Pix, pagou e voltou para pagar no cartão: vale o Pix, o cartão não é cobrado
  c.banco.respostaAplicar = bancoQueAtiva(c.banco, 6);
  await tratarAcao(c.deps, c.usuario, { acao: "pagar_cadastro", forma: "pix", ciclo: "SEMIANNUALLY" });
  for (const cob of c.asaas.cobrancas.values()) cob.status = "RECEIVED";
  r = await pagar({ ciclo: "SEMIANNUALLY", parcelas: 6 });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.ja_pago, true);
  assert.equal(r.corpo.ativou, true);
  assert.equal(posts(c.asaas, "/payments").length, 0, "o cartão não foi cobrado");
});

test("webhook: parcela 2..N vai ao banco com o parcelamento; estorno de parcela avisa o superadmin e não a empresa", async () => {
  const { asaas, banco, deps } = cenario({ cfg: { ...ASAAS_OK, ...ZAP, asaas_webhook_token: "x".repeat(48), whatsapp_avisos: "71977776666" } });
  banco.respostaAplicar = (ev) => ({ acao: ev === "PAYMENT_CHARGEBACK_REQUESTED" ? "estorno_parcela" : "parcela", escritorio_id: EMPRESA.id });
  const r = await tratarWebhook(deps, "x".repeat(48), JSON.stringify({ id: "evt_p2", event: "PAYMENT_CONFIRMED",
    payment: { id: "pay_p2", status: "CONFIRMED", value: 300, installment: "inst_9", installmentNumber: 2 } }));
  assert.equal(r.corpo.acao, "parcela");
  assert.equal(banco.aplicados[0].pagamento.installment, "inst_9", "o banco casa pelo parcelamento (tests/rls/autocadastro.sql)");
  assert.equal(asaas.chamadas.filter((c) => c.whatsapp).length, 0, "parcela paga não avisa ninguém");
  await tratarWebhook(deps, "x".repeat(48), JSON.stringify({ id: "evt_cb", event: "PAYMENT_CHARGEBACK_REQUESTED",
    payment: { id: "pay_p2", status: "CHARGEBACK_REQUESTED", installment: "inst_9", installmentNumber: 2 } }));
  const zap = asaas.chamadas.filter((c) => c.whatsapp);
  assert.equal(zap.length, 1);
  assert.equal(zap[0].corpo.number, "5571977776666", "só o superadmin");
  assert.match(zap[0].corpo.text, /Pagante Topografia: a parcela 2 \(cobrança pay_p2\) ficou "CHARGEBACK_REQUESTED"/);
});

test("webhook: reprovado na análise avisa quem espera para entrar; os eventos novos estão no webhook", async () => {
  const { asaas, banco, deps } = cenario({ cfg: { ...ASAAS_OK, ...ZAP, asaas_webhook_token: "x".repeat(48) } });
  banco.respostaAplicar = { acao: "recusado", escritorio_id: EMPRESA.id };
  await tratarWebhook(deps, "x".repeat(48), JSON.stringify({ id: "evt_r", event: "PAYMENT_REPROVED_BY_RISK_ANALYSIS", payment: { id: "pay_r", status: "AWAITING_RISK_ANALYSIS" } }));
  assert.match(asaas.chamadas.find((c) => c.whatsapp).corpo.text, /não foi aprovado na análise do Asaas.*Pix ou com outro cartão/s);
  const sa = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  await tratarAcao(deps, sa, { acao: "config_salvar", asaas_chave: "$aact_boa", url_webhook: "https://x.test/f?origem=asaas" });
  const eventos = asaas.webhooks[0].events;
  for (const ev of ["PAYMENT_AWAITING_RISK_ANALYSIS", "PAYMENT_APPROVED_BY_RISK_ANALYSIS", "PAYMENT_REPROVED_BY_RISK_ANALYSIS", "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"]) {
    assert.ok(eventos.includes(ev), ev);
  }
});

test("painel: autocadastro_salvar confere e grava as regras; só o superadmin; empresa anual cobrada e atualizada pelo período", async () => {
  const { asaas, banco, deps, usuario } = cenario({ cfg: ASAAS_OK });
  const sa = { id: "sa", email: "w@v.test", superadmin: true, escritorioId: null };
  assert.equal((await tratarAcao(deps, usuario, { acao: "autocadastro_salvar", cadastro_aberto: true })).status, 403);
  let r = await tratarAcao(deps, sa, { acao: "autocadastro_salvar", parcelas_max: 13 });
  assert.equal(r.status, 400);
  r = await tratarAcao(deps, sa, { acao: "autocadastro_salvar", cadastro_aberto: true, parcelas_sem_juros: 4, parcelas_max: 10, juros_mes: "1,99",
    ciclos: { MONTHLY: { ativo: true }, SEMIANNUALLY: { ativo: false, desconto: 0 }, YEARLY: { ativo: true, desconto: 15 } }, whatsapp_avisos: "(71) 97777-6666" });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  assert.deepEqual({ a: banco.cfg.cadastro_aberto, s: banco.cfg.parcelas_sem_juros, m: banco.cfg.parcelas_max, j: banco.cfg.juros_mes, w: banco.cfg.whatsapp_avisos },
    { a: "true", s: "4", m: "10", j: "1.99", w: "71977776666" });
  assert.equal(JSON.parse(banco.cfg.ciclos).YEARLY.desconto, 15);
  r = await tratarAcao(deps, sa, { acao: "config_status" });
  assert.equal(r.corpo.autocadastro.ciclos.SEMIANNUALLY.ativo, false);
  assert.equal(r.corpo.autocadastro.whatsapp_avisos, "71977776666");
  r = await tratarAcao(deps, sa, { acao: "autocadastro_salvar", whatsapp_avisos: "" });
  assert.equal(banco.cfg.whatsapp_avisos, undefined, "vazio apaga");

  // empresa anual (15% de desconto agora): a cobrança do painel e a atualização usam o valor do ano
  banco.cobrancas[EMPRESA.id] = { situacao: "sem_assinatura", ciclo: "YEARLY" };
  r = await tratarAcao(deps, sa, { acao: "cobrar_empresa", escritorio_id: EMPRESA.id, enviar_whatsapp: false });
  assert.equal(r.status, 200, JSON.stringify(r.corpo));
  const sub = posts(asaas, "/subscriptions")[0].corpo;
  assert.deepEqual({ c: sub.cycle, v: sub.value }, { c: "YEARLY", v: 2038.98 }, "12 × 199,90 − 15%");
  assert.match(r.corpo.mensagem, /Segue a anuidade do Vertces \(plano Profissional\) da Pagante Topografia: R\$\s2\.038,98/);
  banco.empresas[EMPRESA.id].mensalidade = 249.9;
  await tratarAcao(deps, sa, { acao: "atualizar_assinatura", escritorio_id: EMPRESA.id });
  assert.equal(asaas.chamadas.find((c) => c.metodo === "PUT" && c.caminho.startsWith("/subscriptions/")).corpo.value, 2548.98);
});
