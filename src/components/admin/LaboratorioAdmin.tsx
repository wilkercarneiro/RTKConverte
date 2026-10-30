// Laboratório do painel do superadmin (só no `npm run dev`, #/lab/admin):
// desenha o painel com dados de exemplo, sem banco. Troca o `rpc`/`from` do
// cliente do Supabase por respostas fixas — nada sai do navegador.
// Abas: #/lab/admin/<aba>[/<id>] — ex.: #/lab/admin/suporte/ch1, #/lab/admin/tutoriais.
import { useState } from "react";
import { supabase } from "../../lib/supabase";
import { RECURSOS } from "../../lib/recursos";
import { hashParaRota, useRota } from "../../lib/rota";
import { PainelAdmin } from "./PainelAdmin";
import type { AbaAdmin } from "./PainelAdmin";
import { MENSAGENS, RPC_SUPORTE, STORAGE_SUPORTE, TUTORIAIS } from "./laboratorioSuporte";
import { definirCobrancaFalsa } from "../../lib/cobranca";
import { mensagemCobranca } from "../../../supabase/functions/_shared/mensagens_cobranca.ts";

const dia = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
// os planos da 0034 (e o Completo de antes, fora do cadastro)
const PLANOS = [
  { id: "p1", nome: "Autônomo", descricao: "Todos os serviços. Por mês: 6 créditos gerais e 12 de CAR.", cor: "#5B6B63", ordem: 10, ativo: true, preco_mensal: 149.9, libera_recursos_novos: true },
  { id: "p2", nome: "Profissional", descricao: "Todos os serviços. Por mês: 12 créditos gerais e 25 de CAR.", cor: "#178552", ordem: 20, ativo: true, preco_mensal: 249.9, libera_recursos_novos: true },
  { id: "p3", nome: "Empresarial", descricao: "Todos os serviços. Por mês: 25 créditos gerais e 50 de CAR.", cor: "#0E3B2B", ordem: 30, ativo: true, preco_mensal: null, libera_recursos_novos: true },
  { id: "p4", nome: "Só CAR", descricao: "Só o serviço de CAR. Por mês: 5 créditos de CAR.", cor: "#C99A12", ordem: 40, ativo: true, preco_mensal: 49.9, libera_recursos_novos: false },
  { id: "p5", nome: "Completo", descricao: "", cor: "#2E4F43", ordem: 50, ativo: false, preco_mensal: null, libera_recursos_novos: true },
];
const TIPOS = [
  { chave: "geral", nome: "Créditos gerais", descricao: "Valem para qualquer serviço. No CAR, só com o seu aceite.", servicos: null, ordem: 10, ativo: true },
  { chave: "car", nome: "Créditos de CAR", descricao: "Valem só para o CAR.", servicos: ["servico.car"], ordem: 20, ativo: true },
];
const POR_MES: [string, string, number | null][] = [
  ["p1", "geral", 6], ["p1", "car", 12], ["p2", "geral", 12], ["p2", "car", 25], ["p3", "geral", 25], ["p3", "car", 50],
  ["p4", "geral", 0], ["p4", "car", 5], ["p5", "geral", null], ["p5", "car", null],
];
const PRECOS: [string, string, number, number][] = [
  ["p1", "geral", 2, 70], ["p1", "car", 2, 9.9], ["p2", "geral", 2, 60], ["p2", "car", 2, 9.9], ["p3", "geral", 2, 50], ["p3", "car", 2, 9.9],
  ["p4", "car", 2, 19.9], ["p4", "car", 10, 15], ["p4", "car", 51, 10],
];
const EMPRESAS = [
  ["D'PROL GEORREFERENCIAMENTO", "p5", "ativo", 6, 214, 38, 0, 0, null],
  ["AGRIMENSURA SERTÃO LTDA", "p2", "ativo", 3, 41, 12, 1, 2, "em_dia"],
  ["TOPO NORTE ENGENHARIA", "p1", "ativo", 2, 9, 0, 22, 25, "atrasada"],
  ["GEO CAMPO FORMOSO", "p2", "suspenso", 1, 17, 0, 40, 41, "cancelada"],
  ["MEDIÇÕES RECÔNCAVO", "p3", "ativo", 4, 63, 19, 0, 1, null],
  ["CAR SERTÃO AMBIENTAL", "p4", "aguardando_pagamento", 1, 0, 0, 0, 0, "aguardando"],
].map(([nome, plano, status, usuarios, servicos, s30, acesso, criado, cobranca], i) => ({
  id: `e${i}`, nome, cnpj: ["11222333000181", "45723174000110", "19131243000197", "33000167000101", "60746948000112", "07526557000100"][i],
  responsavel: ["Daniel Nascimento", "Marta Ribeiro", "Paulo Sena", "Ana Lúcia", "José Carlos", "Rita Prado"][i],
  telefone: "71999990000", email: `contato@empresa${i}.com.br`, status, plano_id: plano,
  plano: PLANOS.find((p) => p.id === plano)?.nome ?? null, observacoes: null, created_at: dia(120 - i * 18 + (criado as number)),
  usuarios, servicos, servicos_30d: s30, ultimo_servico: (s30 as number) ? dia(1 + i) : dia((acesso as number) + 5),
  ultimo_acesso: dia(acesso as number), excecoes: i === 1 ? 1 : 0,
  mensalidade: i === 1 ? 199.9 : PLANOS.find((p) => p.id === plano)?.preco_mensal ?? null,
  cobranca, vencimento: cobranca ? dia(i === 2 ? 6 : -20).slice(0, 10) : null,
}));
const MATRIZ = PLANOS.flatMap((p) => RECURSOS.filter((r) => r.chave !== "sigef.mapa").map((r) => ({
  plano_id: p.id, recurso_chave: r.chave,
  liberado: p.id !== "p4" || ["servico.car", "empresa.equipe", "integracao.gprol"].includes(r.chave),
})));
const BANCO: Record<string, unknown[]> = {
  planos: PLANOS,
  recursos: RECURSOS.map((r) => ({ ...r, ativo: true, criado_em: r.chave === "sigef.mapa" ? dia(1) : dia(90) })),
  plano_recursos: MATRIZ,
  tipos_credito: TIPOS,
  plano_creditos: POR_MES.map(([plano_id, tipo, por_mes]) => ({ plano_id, tipo, por_mes })),
  precos_credito: PRECOS.map(([plano_id, tipo, a_partir_de, preco]) => ({ id: `${plano_id}${tipo}${a_partir_de}`, plano_id, escritorio_id: null, tipo, a_partir_de, preco })),
  contatos_site: [
    { id: "c1", nome: "Fernando Alves", empresa: "Alves Topografia", telefone: "77988887777", email: "fernando@alvestopo.com.br", cidade_uf: "Barreiras/BA", mensagem: "Faço uns 15 georreferenciamentos por mês e quero ver o loteamento.", origem: "site", status: "novo", created_at: dia(0) },
    { id: "c2", nome: "Luciana Mota", empresa: "LM Agrimensura", telefone: "74977776666", email: null, cidade_uf: "Irecê/BA", mensagem: null, origem: "site", status: "novo", created_at: dia(2) },
    { id: "c3", nome: "Roberto Dias", empresa: null, telefone: "71966665555", email: "rdias@gmail.com", cidade_uf: "Salvador/BA", mensagem: "CAR em lote.", origem: "site", status: "reuniao", created_at: dia(5) },
  ],
  saas_config: [{ key: "senha_padrao", value: "SenhaDeExemplo1" }],
};
const RPC: Record<string, (a: Record<string, unknown>) => unknown> = {
  sa_sincronizar_recursos: () => 1,
  sa_empresas: () => EMPRESAS,
  sa_serie_servicos: () => Array.from({ length: 30 }, (_, i) => ({ dia: dia(29 - i).slice(0, 10), total: Math.max(0, Math.round(4 + 3 * Math.sin(i / 3) + (i % 7 === 5 || i % 7 === 6 ? -4 : 0) + i / 6)) })),
  sa_uso_modalidades: () => [
    { chave: "servico.completo", total: 41 }, { chave: "servico.conferencia", total: 17 }, { chave: "servico.car", total: 9 },
    { chave: "servico.loteamento", total: 4 }, { chave: "servico.divisao", total: 3 }, { chave: "servico.pecas", total: 2 },
  ],
  sa_empresa_usuarios: () => [
    { user_id: "u1", email: "contato@empresa1.com.br", papel: "dono", desde: dia(60), ultimo_acesso: dia(1), senha_provisoria: false },
    { user_id: "u2", email: "campo@empresa1.com.br", papel: "membro", desde: dia(20), ultimo_acesso: null, senha_provisoria: true },
  ],
  sa_pedidos_credito_pendentes: () => [
    { id: "pc1", escritorio_id: EMPRESAS[1]?.id, empresa: EMPRESAS[1]?.nome ?? "Empresa", tipo: "geral", quantidade: 4, preco: 240, descricao: "4 créditos gerais", origem: "pedido", link: null, created_at: dia(0) },
    { id: "pc2", escritorio_id: EMPRESAS[2]?.id, empresa: EMPRESAS[2]?.nome ?? "Empresa", tipo: "car", quantidade: 10, preco: 99, descricao: "10 créditos de CAR", origem: "compra", link: "https://sandbox.asaas.com/i/x", created_at: dia(0) },
  ],
  sa_creditos_empresa: (a) => {
    const e = EMPRESAS.find((x) => x.id === a.p_escritorio) ?? EMPRESAS[1];
    const pm = Object.fromEntries(POR_MES.filter(([p]) => p === e.plano_id).map(([, t, n]) => [t, n]));
    const pr = (t: string) => PRECOS.filter(([p, tt]) => p === e.plano_id && tt === t).map(([, , a_partir_de, preco]) => ({ a_partir_de, preco }));
    const proprios = e.id === "e1" ? { car: 30 } : {};
    return {
      periodo: { inicio: "2026-10-25", renova_em: "2026-11-25", dia: 25 },
      carteiras: TIPOS.map((t) => ({ ...t, por_mes: t.chave in proprios ? (proprios as Record<string, number>)[t.chave] : pm[t.chave] ?? 0,
        usado: t.chave === "geral" ? 9 : 14, extra: t.chave === "geral" ? 3 : 0, precos: pr(t.chave) })),
      servicos: {},
      plano: { id: e.plano_id, nome: e.plano, preco_mensal: PLANOS.find((p) => p.id === e.plano_id)?.preco_mensal ?? null,
        por_mes: pm, tem_carteira: { geral: true, car: true }, precos: { geral: pr("geral"), car: pr("car") } },
      empresa: { mensalidade: e.id === "e1" ? 199.9 : null, por_mes: proprios, precos: {} },
      mensalidade: e.mensalidade,
      extras: [
        { id: "x1", tipo: "geral", quantidade: 4, preco: 240, valor_unitario: 60, descricao: "4 créditos gerais", origem: "pedido", status: "pendente", observacao: null, created_at: dia(0), resolvido_em: null, quem: "contato@empresa1.com.br", link: null, pagamento: null, forma: null },
        { id: "x3", tipo: "car", quantidade: 10, preco: 99, valor_unitario: 9.9, descricao: "10 créditos de CAR", origem: "compra", status: "pendente", observacao: null, created_at: dia(0), resolvido_em: null, quem: "contato@empresa1.com.br", link: "https://sandbox.asaas.com/i/x", pagamento: "PENDING", forma: null },
        { id: "x4", tipo: "car", quantidade: 25, preco: 247.5, valor_unitario: 9.9, descricao: "25 créditos de CAR", origem: "compra", status: "aprovado", observacao: "Pago pelo Asaas", created_at: dia(9), resolvido_em: dia(9), quem: "contato@empresa1.com.br", link: null, pagamento: "RECEIVED", forma: "PIX" },
        { id: "x2", tipo: "geral", quantidade: 5, preco: null, valor_unitario: null, descricao: "Cortesia de lançamento", origem: "manual", status: "aprovado", observacao: null, created_at: dia(12), resolvido_em: dia(12), quem: null, link: null, pagamento: null, forma: null },
      ],
      historico: [
        { mes: dia(0).slice(0, 8) + "01", por_tipo: { geral: 9, car: 14 }, total: 23 },
        { mes: dia(35).slice(0, 8) + "01", por_tipo: { geral: 12, car: 19 }, total: 31 },
      ],
    };
  },
  sa_cobranca_empresa: (a) => {
    const e = EMPRESAS.find((x) => x.id === a.p_escritorio) ?? EMPRESAS[1];
    const nova = e.status === "aguardando_pagamento";
    return {
      mensalidade: e.mensalidade, pagamento_online: true,
      assinatura: !e.cobranca ? null : {
        asaas_cliente_id: "cus_000001", asaas_assinatura_id: "sub_000001", valor: e.id === "e1" ? 249.9 : e.mensalidade, situacao: e.cobranca,
        link_pagamento: e.cobranca === "em_dia" ? null : "https://sandbox.asaas.com/i/abc123", proximo_vencimento: e.vencimento,
        ultimo_pagamento_em: nova ? null : dia(5), whatsapp_em: dia(nova ? 0 : 30), whatsapp_erro: null,
      },
      pagamentos: nova
        ? [{ id: "pg0", finalidade: "mensalidade", asaas_id: "pay_1", valor: e.mensalidade, status: "PENDING", forma: null, link: "https://sandbox.asaas.com/i/abc123", vencimento: dia(0).slice(0, 10), pago_em: null, criado_em: dia(0), erro: null, descricao: null }]
        : [
          { id: "pg1", finalidade: "mensalidade", asaas_id: "pay_3", valor: e.mensalidade, status: e.cobranca === "atrasada" ? "OVERDUE" : "PENDING", forma: null, link: "https://sandbox.asaas.com/i/abc123", vencimento: e.vencimento, pago_em: null, criado_em: dia(15), erro: null, descricao: null },
          { id: "pg2", finalidade: "creditos", asaas_id: "pay_2", valor: 247.5, status: "RECEIVED", forma: "PIX", link: null, vencimento: dia(8).slice(0, 10), pago_em: dia(9), criado_em: dia(9), erro: null, descricao: "25 créditos de CAR" },
          { id: "pg3", finalidade: "mensalidade", asaas_id: "pay_1", valor: e.mensalidade, status: "RECEIVED", forma: "BOLETO", link: null, vencimento: dia(36).slice(0, 10), pago_em: dia(34), criado_em: dia(45), erro: null, descricao: null },
        ],
    };
  },
  sa_recursos_empresa: () => RECURSOS.map((r, i) => ({
    chave: r.chave, liberado: i % 4 !== 3, origem: i === 4 ? "excecao" : r.chave === "sigef.mapa" ? "padrao" : "plano", excecao: i === 4 ? true : null,
  })),
};

// central de suporte, tutoriais e acessos (0029): ver laboratorioSuporte.ts
Object.assign(RPC, RPC_SUPORTE);
BANCO.chamado_mensagens = MENSAGENS;
BANCO.tutoriais = TUTORIAIS;

type Linha = Record<string, unknown>;
/**
 * Resposta que aceita qualquer encadeamento do supabase-js e resolve com a
 * tabela. `eq` filtra, `order` ordena; insert/update/delete mexem na lista em
 * memória (os cadastros do laboratório funcionam até recarregar a página).
 */
function consulta(t: string) {
  const filtros: [string, unknown][] = [];
  const ordem: [string, boolean][] = [];
  let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  let carga: unknown = null;
  let feito: Linha[] | null = null;
  const casa = (l: Linha) => filtros.every(([c, v]) => l[c] === v);
  const executar = (): Linha[] => {
    if (feito) return feito;
    const tab = (BANCO[t] ??= []) as Linha[];
    if (op === "insert") {
      const novas = (Array.isArray(carga) ? carga : [carga]).map((x) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...(x as Linha) }));
      tab.push(...novas);
      return (feito = novas);
    }
    if (op === "update") { tab.filter(casa).forEach((l) => Object.assign(l, carga as Linha)); return (feito = tab.filter(casa)); }
    if (op === "delete") { const fica = tab.filter((l) => !casa(l)); tab.splice(0, tab.length, ...fica); return (feito = []); }
    if (op === "upsert") return (feito = (Array.isArray(carga) ? carga : [carga]) as Linha[]);
    const linhas = tab.filter(casa);
    for (const [c, asc] of [...ordem].reverse()) {
      linhas.sort((a, b) => {
        const x = a[c], y = b[c];
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""));
        return asc ? r : -r;
      });
    }
    return (feito = linhas);
  };
  const cadeia: Record<string, unknown> = {};
  for (const m of ["select", "in", "limit", "not", "is"]) cadeia[m] = () => cadeia;
  cadeia.eq = (c: string, v: unknown) => { filtros.push([c, v]); return cadeia; };
  cadeia.order = (c: string, o?: { ascending?: boolean }) => { ordem.push([c, o?.ascending !== false]); return cadeia; };
  for (const m of ["insert", "update", "upsert"] as const) cadeia[m] = (x: unknown) => { op = m; carga = x; return cadeia; };
  cadeia.delete = () => { op = "delete"; return cadeia; };
  cadeia.single = () => Promise.resolve({ data: executar()[0] ?? null, error: null });
  cadeia.maybeSingle = () => Promise.resolve({ data: executar()[0] ?? null, error: null });
  cadeia.then = (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) =>
    Promise.resolve().then(() => ({ data: executar(), error: null })).then(ok, falha);
  return cadeia;
}

let instalado = false;
function instalar() {
  if (instalado) return;
  instalado = true;
  const s = supabase as unknown as Record<string, unknown>;
  s.rpc = (nome: string, args: Record<string, unknown>) => Promise.resolve({ data: RPC[nome]?.(args ?? {}) ?? null, error: null });
  s.from = (t: string) => consulta(t);
  // `storage` é getter no supabase-js: sobrescreve na própria instância
  Object.defineProperty(supabase, "storage", { value: STORAGE_SUPORTE, configurable: true });
  // a função `superadmin` (criar empresa) responde daqui
  const auth = supabase.auth as unknown as Record<string, unknown>;
  auth.getSession = () => Promise.resolve({ data: { session: { access_token: "lab" } }, error: null });
  const fetchReal = window.fetch.bind(window);
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const u = String(entrada instanceof Request ? entrada.url : entrada);
    if (!u.includes("/functions/v1/superadmin")) return fetchReal(entrada, init);
    const b = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
    return new Response(JSON.stringify({ ok: true, escritorio_id: "e5", user_id: "u9", login: b.email ?? "contato@empresa.com.br" }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  };
  // a função `cobranca` (Asaas + WhatsApp) responde daqui
  definirCobrancaFalsa(async (b) => {
    const status = {
      asaas: { configurado: true, ambiente: "sandbox", chave_final: "9f3a", saldo: 1840.35, erro: null,
        webhook: { url: "https://api.exemplo/functions/v1/cobranca?origem=asaas", ativo: true, interrompido: false, penalizados: 0 } },
      whatsapp: { configurado: true, url: "https://evolution.exemplo.com.br", instancia: "vertces", estado: "open" },
      url_app: "https://vertces.com.br/app/",
      ultimo_evento: { evento: "PAYMENT_RECEIVED", resultado: "creditos · WhatsApp enviado", recebido_em: dia(0.05) },
    };
    if (b.acao === "config_status" || b.acao === "config_salvar") return status;
    if (b.acao === "cobrar_empresa") {
      const e = EMPRESAS.find((x) => x.id === b.escritorio_id);
      const link = "https://sandbox.asaas.com/i/abc123";
      return {
        link, valor: e?.mensalidade ?? 249.9, vencimento: dia(0).slice(0, 10), whatsapp: { configurado: true, enviado: true },
        mensagem: mensagemCobranca({ responsavel: String(e?.responsavel ?? "Rita Prado"), empresa: String(e?.nome ?? "Empresa nova"), plano: String(e?.plano ?? "Profissional"),
          valor: Number(e?.mensalidade ?? 249.9), link, url: "https://vertces.com.br/app/", login: e?.email ?? "contato@empresa.com.br",
          senha: b.senha ? String(b.senha) : null, creditos: "12 créditos gerais e 25 créditos de CAR por mês", vencimento: dia(0).slice(0, 10) }),
      };
    }
    if (b.acao === "conferir") return { conferidos: 2, mudancas: [] };
    if (b.acao === "atualizar_assinatura") return { valor: 199.9 };
    return { ok: true };
  });
}

export function LaboratorioAdmin() {
  instalar();
  const { rota, ir } = useRota();
  const [, forcar] = useState(0);
  // o lab vive em #/lab/admin/<aba>/<id>: traduz para a rota do painel
  const r = hashParaRota(location.hash.replace("#/lab/", "#/"));
  const irLab = (x: Parameters<typeof ir>[0]) => {
    location.hash = x.t === "admin" ? `#/lab/admin/${x.aba}${x.id ? `/${x.id}` : ""}` : "#/lab/admin";
    forcar((n) => n + 1);
  };
  void rota;
  return (
    <PainelAdmin aba={(r.t === "admin" ? r.aba : "visao") as AbaAdmin} id={r.t === "admin" ? r.id : undefined}
      ir={irLab} email="wilker@vertice.app" temEscritorio />
  );
}
