// Laboratório do cartão de crédito (0037), só no `npm run dev`, sem banco e
// sem Asaas:
//   #/lab/cartao/tela        — tela cheia ao entrar ("Cadastre o cartão…")
//   #/lab/cartao/aviso       — a faixa do Início
//   #/lab/cartao/painel      — Configurações → Plano e uso, cartão que compra créditos
//   #/lab/cartao/painel-mensal — cartão sem token (Asaas sem tokenização): só mensalidade
//   #/lab/cartao/pagamento   — "Falta o pagamento" com o cartão
//   #/lab/cartao/comprar     — gaveta de compra com o cartão salvo
//   #/lab/cartao/semcredito  — créditos acabaram e a compra automática está comprando
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { definirCobrancaFalsa } from "../lib/cobranca";
import type { MinhaCobranca, RecargaCarteira } from "../lib/cobranca";
import type { Creditos } from "../lib/creditos";
import { definicaoDe } from "../lib/modalidades";
import { creditosDeExemplo } from "./laboratorioCreditos";
import { AvisoCartao, PainelCartao, TelaCartao } from "./Cartao";
import { AguardandoPagamento } from "./Mensalidade";
import { ComprarCreditos, SemCreditos } from "./Creditos";
import "./config/config.css";

const CONTATO = { email: "contato@dprol.com.br", telefone: "75999990000", cnpj: "54658343000177", responsavel: "Daniel Nascimento" };
const CARTAO = { bandeira: "VISA", final: "4242", validade: "08/2030", titular: "DANIEL NASCIMENTO", reutilizavel: true, cadastrado_em: "2026-11-04T15:00:00Z", recusa_em: null, recusa_motivo: null };

function cobranca(o: Partial<MinhaCobranca> = {}): MinhaCobranca {
  return {
    status: "ativo", empresa: "D'Prol Georreferenciamento", plano: "Profissional", valor: 599.9, situacao: "em_dia",
    link: null, vencimento: "2026-11-25", sou_dono: true, pagamento_online: true, cartao: null, precisa_cartao: true, contato: CONTATO, ...o,
  };
}

let instalado = false;
function instalar(tela: string) {
  if (instalado) return;
  instalado = true;
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  definirCobrancaFalsa(async (b) => {
    await espera(900);
    if (b.acao === "cartao_salvar") {
      const c = b.cartao as { numero: string };
      return { reutilizavel: tela !== "painel-mensal", bandeira: "VISA", final: c.numero.replace(/\D/g, "").slice(-4), pagas: tela === "pagamento" ? 1 : 0, ativou: false, assinatura: "sub_lab" };
    }
    if (b.acao === "definir_recarga") return { [String(b.tipo)]: { ativo: b.ativo, quantidade: b.quantidade, limite_periodo: b.limite, gasto_periodo: 0 } };
    if (b.acao === "comprar_creditos" && b.forma === "cartao") return { credito_id: "lab", valor: 99, descricao: `${b.quantidade} créditos de CAR`, link: null, pix: null, pago: true };
    if (b.acao === "recarga_automatica") { await espera(2500); return { compras: [{ tipo: "car", descricao: "10 créditos de CAR", valor: 99, ok: true }], motivos: {} }; }
    if (b.acao === "conferir") return { conferidos: 0, mudancas: [] };
    return { ok: true };
  });
  // "Falta o pagamento" lê a cobrança direto do banco
  const s = supabase as unknown as Record<string, unknown>;
  s.rpc = (nome: string) => Promise.resolve({
    data: nome === "minha_cobranca"
      ? cobranca({ status: "aguardando_pagamento", situacao: "aguardando", link: "https://www.asaas.com/i/exemplo", vencimento: "2026-11-04" })
      : null,
    error: null,
  });
  (supabase.auth as unknown as Record<string, unknown>).signOut = () => Promise.resolve({ error: null });
}

function creditosComCartao(o: { recarga?: Record<string, RecargaCarteira>; reutilizavel?: boolean; carEsgotado?: boolean } = {}): Creditos {
  const c = creditosDeExemplo({ carEsgotado: o.carEsgotado, geralEsgotado: o.carEsgotado });
  return {
    ...c,
    cartao: { ...CARTAO, reutilizavel: o.reutilizavel ?? true },
    recarga: o.recarga ?? { car: { ativo: true, quantidade: 10, limite_periodo: 300, gasto_periodo: 99 } },
  };
}

export function LaboratorioCartao() {
  const tela = location.hash.replace(/^#\/lab\/cartao\/?/, "").split("?")[0] || "tela";
  instalar(tela);
  const [, forcar] = useState(0);
  const recarregar = () => forcar((n) => n + 1);
  const pagina = (filhos: React.ReactNode) => <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 20px" }}>{filhos}</div>;

  if (tela === "tela") {
    return <TelaCartao cobranca={cobranca()} carteirasVenda={creditosDeExemplo().carteiras} onPronto={recarregar} onAdiar={recarregar} />;
  }
  if (tela === "aviso") {
    return pagina(<>
      <h1 style={{ marginTop: 0 }}>Boa tarde, Daniel.</h1>
      <AvisoCartao cobranca={cobranca()} creditos={creditosDeExemplo()} onCadastrado={recarregar} />
    </>);
  }
  if (tela === "painel" || tela === "painel-mensal") {
    const reut = tela === "painel";
    return pagina(<PainelCartao cobranca={cobranca({ precisa_cartao: false, cartao: { ...CARTAO, reutilizavel: reut } })}
      creditos={creditosComCartao({ reutilizavel: reut })} onMudou={recarregar} />);
  }
  if (tela === "pagamento") return <AguardandoPagamento nome="D'Prol Georreferenciamento" />;
  if (tela === "comprar") {
    return pagina(<ComprarCreditos creditos={creditosComCartao()} tipo="car" onFechar={recarregar} onPedido={recarregar} />);
  }
  if (tela === "semcredito") {
    return <SemCreditos def={definicaoDe("car")} creditos={creditosComCartao({ carEsgotado: true })} onVoltar={recarregar} onAtualizar={recarregar} />;
  }
  return pagina(<p>Tela desconhecida: {tela}</p>);
}
