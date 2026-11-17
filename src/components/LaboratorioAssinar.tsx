// Laboratório do autocadastro (0040), só no `npm run dev`, sem banco e sem Asaas:
//   #/lab/assinar            — a página pública, passo 1 (Seus dados)
//   #/lab/assinar/plano      — passo 2 (os planos e o período) com o anual escolhido
//   #/lab/assinar/pagamento  — passo 3, conectado como a dona da conta nova
//   #/lab/assinar/pix        — passo 3 com o Pix já gerado
//   #/lab/assinar/convite[-plano|-vencido] — o convite (0049): sem pagamento, cobra no 1º crédito
//   #/lab/assinar/cupom      — passo 2 com o cupom do link (?cupom=FEIRA2026: 50% na adesão + 20% nas 3 primeiras)
//   #/lab/assinar/gratis     — passo 2 com 1MESGRATIS (sem adesão: entra sem pagar)
//   #/lab/assinar/pagamento-cupom — passo 3 com o cupom FEIRA2026 já gravado na conta
// Cupons que existem aqui: BEMVINDO (isenta a adesão), FEIRA2026, 1MESGRATIS, 3MESES (só o Empresarial).
// "Criar conta" e "Pagar" respondem falso: cartão até 6x aprova; acima disso,
// fica em análise.
import { supabase } from "../lib/supabase";
import { definirCobrancaFalsa } from "../lib/cobranca";
import type { MinhaCobranca } from "../lib/cobranca";
import { REGRAS_PADRAO } from "../../supabase/functions/_shared/parcelas.ts";
import { Assinar } from "./Assinar";

const REGRAS = { ...REGRAS_PADRAO, cadastro_aberto: true, ciclos: { ...REGRAS_PADRAO.ciclos, YEARLY: { ativo: true, desconto: 10 } } };
const SEM_ADESAO = { ...REGRAS, adesao: 0 };
// 0052: os cupons do laboratório (a foto que a função devolve)
const CUPOM = { adesao_tipo: null, adesao_valor: null, mensalidade_tipo: null, mensalidade_valor: null, mensalidade_vezes: null, isencao_meses: null };
const CUPONS: Record<string, Record<string, unknown>> = {
  BEMVINDO: { ...CUPOM, codigo: "BEMVINDO", adesao_tipo: "isencao" },
  FEIRA2026: { ...CUPOM, codigo: "FEIRA2026", adesao_tipo: "percentual", adesao_valor: 50, mensalidade_tipo: "percentual", mensalidade_valor: 20, mensalidade_vezes: 3 },
  "1MESGRATIS": { ...CUPOM, codigo: "1MESGRATIS", mensalidade_tipo: "isencao", isencao_meses: 1 },
  "3MESES": { ...CUPOM, codigo: "3MESES", mensalidade_tipo: "isencao", isencao_meses: 3 },
};
// os dois planos da 0050 (11/11/2026)
const PLANOS = [
  { id: "a0000000-0000-4000-8000-000000000002", nome: "Profissional", descricao: "Todos os serviços: 8 créditos para projetos e 16 para CAR por mês.", cor: "#178552", mensalidade: 299.9, limite_usuarios: null,
    escritorios_adicionais: 0, preco_escritorio: null,
    creditos: [{ tipo: "geral", nome: "Créditos gerais", por_mes: 8 }, { tipo: "car", nome: "Créditos de CAR", por_mes: 16 }],
    extra: { geral: [{ a_partir_de: 2, preco: 50 }, { a_partir_de: 6, preco: 40 }], car: [{ a_partir_de: 2, preco: 9.9 }] } },
  { id: "a0000000-0000-4000-8000-000000000003", nome: "Empresarial", descricao: "Créditos ilimitados e até 2 escritórios adicionais.", cor: "#0E3B2B", mensalidade: 1000, limite_usuarios: null,
    escritorios_adicionais: 2, preco_escritorio: 99.9,
    creditos: [{ tipo: "geral", nome: "Créditos gerais", por_mes: null }, { tipo: "car", nome: "Créditos de CAR", por_mes: null }],
    extra: {} },
];
// um QR qualquer (1 pixel): o laboratório não fala com o Asaas
const QR = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function cobranca(o: Partial<MinhaCobranca> = {}): MinhaCobranca {
  return {
    status: "aguardando_pagamento", empresa: "Geo Lima Topografia", plano: "Profissional", valor: 3238.92, situacao: "sem_assinatura",
    link: null, vencimento: null, sou_dono: true, pagamento_online: true, cartao: null, precisa_cartao: true,
    contato: { email: "ana@geolima.com.br", telefone: "71988887777", cnpj: "52998224725", responsavel: "Ana Lima" },
    ciclo: "YEARLY", origem: "site", plano_id: PLANOS[0].id, mensalidade: 299.9, assinatura: false, regras: REGRAS, ultimo_pagamento: null, ...o,
  };
}

let instalado = false;
function instalar(tela: string) {
  if (instalado) return;
  instalado = true;
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const conectado = tela === "pagamento" || tela === "pix" || tela === "pagamento-cupom";
  definirCobrancaFalsa(async (b) => {
    if (b.acao === "cadastro_planos") return { aberto: true, regras: tela === "gratis" ? SEM_ADESAO : REGRAS, planos: PLANOS };
    if (b.acao === "cupom_conferir") {
      await espera(400);
      const c = CUPONS[String(b.codigo)];
      if (!c) return { valido: false, motivo: "inexistente", mensagem: "Cupom não encontrado. Confira as letras e os números." };
      if (b.codigo === "3MESES" && b.plano_id !== PLANOS[1].id) return { valido: false, motivo: "plano", mensagem: "Este cupom não vale para o plano escolhido." };
      return { valido: true, cupom: c };
    }
    // 0049: o convite (vencido em #/lab/assinar/convite-vencido)
    if (b.acao === "convite_cadastro") return tela === "convite-vencido" ? { valido: false, motivo: "expirado" } : { valido: true, expira_em: "2026-12-10T12:00:00Z", plano: PLANOS[1], regras: REGRAS };
    await espera(700);
    if (b.acao === "cadastro_criar") return { escritorio_id: "lab", login: b.email, ...(b.convite || b.cupom === "1MESGRATIS" ? { liberada: true } : {}) };
    if (b.acao === "pagar_cadastro" && b.forma === "pix") {
      return { forma: "pix", ciclo: b.ciclo, valor: 6478.92, link: "https://www.asaas.com/i/exemplo", vencimento: "2026-11-05",
        pix: { encodedImage: QR, payload: "00020101021226820014br.gov.bcb.pix2560qrpix.asaas.com/qr/cobv/exemplo5204000053039865406478.925802BR" } };
    }
    if (b.acao === "pagar_cadastro") return Number(b.parcelas) > 6 ? { forma: "cartao", em_analise: true } : { forma: "cartao", ativou: true, pago: true };
    if (b.acao === "conferir") return { conferidos: 0, mudancas: [] };
    return { ok: true };
  });
  const s = supabase as unknown as Record<string, unknown>;
  s.rpc = (nome: string) => Promise.resolve({
    data: nome === "minha_cobranca"
      ? cobranca(tela === "pix" ? { situacao: "aguardando", assinatura: true, link: "https://www.asaas.com/i/exemplo" }
        : tela === "pagamento-cupom" ? { ciclo: "MONTHLY", cupom: CUPONS.FEIRA2026 as unknown as MinhaCobranca["cupom"] } : {})
      : null,
    error: null,
  });
  const auth = supabase.auth as unknown as Record<string, unknown>;
  let sessao = conectado;
  auth.getSession = () => Promise.resolve({ data: { session: sessao ? { user: { email: "ana@geolima.com.br" }, access_token: "lab" } : null }, error: null });
  auth.signInWithPassword = () => { sessao = true; return Promise.resolve({ data: {}, error: null }); };
  auth.signOut = () => { sessao = false; return Promise.resolve({ error: null }); };
}

export function LaboratorioAssinar() {
  const tela = location.hash.replace(/^#\/lab\/assinar\/?/, "").split("?")[0] || "dados";
  instalar(tela);
  if (tela === "plano" || tela === "convite-plano" || tela === "cupom" || tela === "gratis") {
    try { sessionStorage.setItem("vertces.assinar", JSON.stringify({ empresa: "Geo Lima Topografia", documento: "529.982.247-25", responsavel: "Ana Lima", telefone: "(71) 98888-7777", email: "ana@geolima.com.br" })); } catch { /* nada */ }
  }
  // 0049: #/lab/assinar/convite (passo 1), convite-plano (passo 2), convite-vencido
  if (tela.startsWith("convite")) {
    return <Assinar convite={"3f9a".repeat(16)} passoInicial={tela === "convite-plano" ? 2 : undefined} />;
  }
  // 0052: o cupom do link
  if (tela === "cupom" || tela === "gratis") {
    return <Assinar plano={PLANOS[0].id} ciclo="mensal" cupom={tela === "cupom" ? "FEIRA2026" : "1MESGRATIS"} passoInicial={2} />;
  }
  return <Assinar plano={tela === "dados" ? undefined : PLANOS[0].id} ciclo={tela === "dados" ? undefined : "anual"} passoInicial={tela === "plano" ? 2 : undefined} />;
}
