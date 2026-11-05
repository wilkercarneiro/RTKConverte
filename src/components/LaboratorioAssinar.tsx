// Laboratório do autocadastro (0040), só no `npm run dev`, sem banco e sem Asaas:
//   #/lab/assinar            — a página pública, passo 1 (Seus dados)
//   #/lab/assinar/plano      — passo 2 (os planos e o período) com o anual escolhido
//   #/lab/assinar/pagamento  — passo 3, conectado como a dona da conta nova
//   #/lab/assinar/pix        — passo 3 com o Pix já gerado
// "Criar conta" e "Pagar" respondem falso: cartão até 6x aprova; acima disso,
// fica em análise.
import { supabase } from "../lib/supabase";
import { definirCobrancaFalsa } from "../lib/cobranca";
import type { MinhaCobranca } from "../lib/cobranca";
import { REGRAS_PADRAO } from "../../supabase/functions/_shared/parcelas.ts";
import { Assinar } from "./Assinar";

const REGRAS = { ...REGRAS_PADRAO, cadastro_aberto: true, ciclos: { ...REGRAS_PADRAO.ciclos, YEARLY: { ativo: true, desconto: 10 } } };
const PLANOS = [
  { id: "a0000000-0000-4000-8000-000000000001", nome: "Autônomo", descricao: "Todos os serviços, para quem trabalha sozinho.", cor: "#5B6B63", mensalidade: 299.9, limite_usuarios: 1,
    creditos: [{ tipo: "geral", nome: "Créditos gerais", por_mes: 6 }, { tipo: "car", nome: "Créditos de CAR", por_mes: 12 }],
    extra: { geral: [{ a_partir_de: 1, preco: 70 }], car: [{ a_partir_de: 2, preco: 9.9 }] } },
  { id: "a0000000-0000-4000-8000-000000000002", nome: "Profissional", descricao: "Todos os serviços, para o escritório que cresce.", cor: "#178552", mensalidade: 599.9, limite_usuarios: 5,
    creditos: [{ tipo: "geral", nome: "Créditos gerais", por_mes: 12 }, { tipo: "car", nome: "Créditos de CAR", por_mes: 25 }],
    extra: { geral: [{ a_partir_de: 1, preco: 60 }], car: [{ a_partir_de: 2, preco: 9.9 }] } },
  { id: "a0000000-0000-4000-8000-000000000003", nome: "Empresarial", descricao: "Todos os serviços, para o escritório de volume alto.", cor: "#0E3B2B", mensalidade: 999.9, limite_usuarios: null,
    creditos: [{ tipo: "geral", nome: "Créditos gerais", por_mes: 25 }, { tipo: "car", nome: "Créditos de CAR", por_mes: 50 }],
    extra: { geral: [{ a_partir_de: 1, preco: 50 }], car: [{ a_partir_de: 2, preco: 9.9 }] } },
];
// um QR qualquer (1 pixel): o laboratório não fala com o Asaas
const QR = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function cobranca(o: Partial<MinhaCobranca> = {}): MinhaCobranca {
  return {
    status: "aguardando_pagamento", empresa: "Geo Lima Topografia", plano: "Profissional", valor: 6478.92, situacao: "sem_assinatura",
    link: null, vencimento: null, sou_dono: true, pagamento_online: true, cartao: null, precisa_cartao: true,
    contato: { email: "ana@geolima.com.br", telefone: "71988887777", cnpj: "52998224725", responsavel: "Ana Lima" },
    ciclo: "YEARLY", origem: "site", plano_id: PLANOS[1].id, mensalidade: 599.9, assinatura: false, regras: REGRAS, ultimo_pagamento: null, ...o,
  };
}

let instalado = false;
function instalar(tela: string) {
  if (instalado) return;
  instalado = true;
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const conectado = tela === "pagamento" || tela === "pix";
  definirCobrancaFalsa(async (b) => {
    if (b.acao === "cadastro_planos") return { aberto: true, regras: REGRAS, planos: PLANOS };
    await espera(700);
    if (b.acao === "cadastro_criar") return { escritorio_id: "lab", login: b.email };
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
      ? cobranca(tela === "pix" ? { situacao: "aguardando", assinatura: true, link: "https://www.asaas.com/i/exemplo" } : {})
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
  if (tela === "plano") {
    try { sessionStorage.setItem("vertces.assinar", JSON.stringify({ empresa: "Geo Lima Topografia", documento: "529.982.247-25", responsavel: "Ana Lima", telefone: "(71) 98888-7777", email: "ana@geolima.com.br" })); } catch { /* nada */ }
  }
  return <Assinar plano={tela === "dados" ? undefined : PLANOS[1].id} ciclo={tela === "dados" ? undefined : "anual"} passoInicial={tela === "plano" ? 2 : undefined} />;
}
