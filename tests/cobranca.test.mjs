// Cobrança pelo Asaas (migração 0034 + edge function `cobranca`): os fluxos
// inteiros da função com um Asaas falso, uma Evolution falsa e um banco em
// memória — compra de créditos, webhook, configuração, mensalidade da empresa
// nova e conferência. As regras do banco têm o teste delas em
// tests/rls/planos_cobranca.sql; o preço por faixa é conferido aqui com os
// mesmos casos de lá.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mesmoToken, somarDias, tratarAcao, tratarWebhook } from "../supabase/functions/cobranca/fluxos.ts";
import { cotar, faixasEmTexto, minimoDe, problemaDasFaixas } from "../supabase/functions/_shared/precos.ts";
import { dataBr, mensagemAcessoLiberado, mensagemCobranca, textoCreditos } from "../supabase/functions/_shared/mensagens_cobranca.ts";
import { numeroWhatsApp } from "../supabase/functions/_shared/whatsapp.ts";
import { BASE_ASAAS, mensagemDoAsaas } from "../supabase/functions/_shared/asaas.ts";

// ------------------------------------------------------------------ dublês

function asaasFalso() {
  const s = {
    chamadas: [], clientes: [], cobrancas: new Map(), assinaturas: new Map(), webhooks: [],
    chaveValida: "$aact_boa", falharCobranca: null, seq: 0,
  };
  const resp = (status, corpo) => new Response(corpo === undefined ? "" : JSON.stringify(corpo), { status });
  s.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const metodo = init.method ?? "GET";
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    if (u.hostname.includes("evolution")) {
      s.chamadas.push({ metodo, caminho: u.pathname, corpo, whatsapp: true });
      if (u.pathname.startsWith("/instance/connectionState")) return resp(200, { instance: { state: "open" } });
      return resp(201, { key: { id: "m1" }, status: "PENDING" });
    }
    const caminho = u.pathname.replace(/^\/v3/, "") + u.search;
    s.chamadas.push({ metodo, caminho, corpo, base: `${u.origin}/v3`, chave: init.headers?.access_token });
    if (init.headers?.access_token !== s.chaveValida) return resp(401, {});
    const id = (p) => `${p}_${++s.seq}`;
    if (caminho === "/finance/balance") return resp(200, { balance: 1234.5 });
    if (caminho.startsWith("/customers?")) return resp(200, { data: s.clientes.filter((c) => c.cpfCnpj === u.searchParams.get("cpfCnpj")) });
    if (caminho === "/customers" && metodo === "POST") { const c = { id: id("cus"), ...corpo }; s.clientes.push(c); return resp(200, c); }
    if (caminho === "/payments" && metodo === "POST") {
      if (s.falharCobranca) return resp(400, { errors: [{ code: "invalid", description: s.falharCobranca }] });
      const c = { id: id("pay"), status: "PENDING", invoiceUrl: `https://sandbox.asaas.com/i/${s.seq}`, ...corpo };
      s.cobrancas.set(c.id, c); return resp(200, c);
    }
    let m;
    if ((m = /^\/payments\/([^/]+)\/pixQrCode$/.exec(caminho))) return resp(200, { encodedImage: "iVBOR", payload: "000201pix", expirationDate: "2026-11-01 23:59:59" });
    if ((m = /^\/payments\/([^/?]+)$/.exec(caminho))) {
      const c = s.cobrancas.get(m[1]);
      if (!c) return resp(404, { errors: [{ description: "não encontrada" }] });
      if (metodo === "DELETE") { c.deleted = true; return resp(200, { deleted: true }); }
      return resp(200, c);
    }
    if (caminho === "/subscriptions" && metodo === "POST") {
      const a = { id: id("sub"), ...corpo }; s.assinaturas.set(a.id, a);
      const c = { id: id("pay"), status: "PENDING", subscription: a.id, value: corpo.value, dueDate: corpo.nextDueDate, invoiceUrl: `https://sandbox.asaas.com/i/${s.seq}` };
      s.cobrancas.set(c.id, c); return resp(200, a);
    }
    if ((m = /^\/subscriptions\/([^/]+)\/payments$/.exec(caminho))) return resp(200, { data: [...s.cobrancas.values()].filter((c) => c.subscription === m[1]) });
    if ((m = /^\/subscriptions\/([^/?]+)$/.exec(caminho))) {
      const a = s.assinaturas.get(m[1]);
      if (metodo === "DELETE") { s.assinaturas.delete(m[1]); return resp(200, { deleted: true }); }
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
    async pagamentosPendentes() { return b.pagamentos.filter((x) => x.asaas_id && ["PENDING", "OVERDUE"].includes(x.status)); },
    async descricaoCredito() { return "10 créditos de car"; },
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
    id: "u1", email: "wilker@vertces.test", superadmin, escritorioId: EMPRESA.id, cancelou: [],
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
  for (const acao of ["config_status", "config_salvar", "cobrar_empresa", "cancelar_assinatura", "whatsapp_testar"]) {
    const r = await tratarAcao(deps, usuario, { acao, escritorio_id: EMPRESA.id });
    assert.equal(r.status, 403, acao);
  }
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
