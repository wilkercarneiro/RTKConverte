// A mensalidade do Vertces vista pela empresa (migração 0034):
//   AguardandoPagamento — empresa nova que ainda não pagou a 1ª mensalidade: o
//                         link para pagar e a liberação sozinha ao confirmar.
//                         Quem se cadastrou pelo site (0040) escolhe aqui o
//                         período, Pix ou cartão parcelado (PagamentoCadastro)
//   AvisoMensalidade    — faixa no Início quando a mensalidade venceu
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { conferirPagamentos, esperaPrimeiroCredito, minhaCobranca } from "../lib/cobranca";
import type { MinhaCobranca } from "../lib/cobranca";
import { fmtPreco } from "../lib/creditos";
import { dataBr, nomeDaCobranca } from "../../supabase/functions/_shared/mensagens_cobranca.ts";
import { SUPORTE_WHATSAPP } from "../lib/config";
import { Logo } from "./Logo";
import { FormCartao } from "./Cartao";
import { PagamentoCadastro, pagaPeloSite } from "./PagamentoCadastro";

/** "Mensalidade" · "Cobrança semestral" · "Anuidade" (o período da assinatura, 0040) */
const NomeCobranca = (ciclo?: string | null) => { const n = nomeDaCobranca(ciclo); return n.charAt(0).toUpperCase() + n.slice(1); };

export function AguardandoPagamento({ nome }: { nome: string }) {
  const [c, setC] = useState<MinhaCobranca | null | undefined>(undefined);
  const [conferindo, setConferindo] = useState(false);
  const [nota, setNota] = useState<string | null>(null);
  const [cartao, setCartao] = useState(false);
  // a tela do autocadastro confere sozinha (e mostra "pagamento confirmado" antes de entrar)
  const site = useRef(false);
  const [pagoSite, setPagoSite] = useState(false);

  async function ler(perguntarAoAsaas: boolean) {
    if (perguntarAoAsaas) await conferirPagamentos().catch(() => null);
    const atual = await minhaCobranca();
    site.current = pagaPeloSite(atual);
    setC(atual);
    // pago: a empresa já está ativa — recarrega e entra
    if (atual?.status === "ativo") location.reload();
    return atual;
  }
  useEffect(() => {
    ler(false);
    // pagou em outra aba ou no celular: entra sozinho
    const t = setInterval(() => { if (!site.current) void ler(true); }, 15_000);
    return () => clearInterval(t);
  }, []);

  if (c && pagaPeloSite(c)) {
    return (
      <div className="centro">
        <div className="login-box mens-box mens-site" style={{ textAlign: "left" }}>
          <Logo size={28} />
          <h2 style={{ marginTop: 14 }}>{pagoSite ? "Tudo certo: a conta está liberada" : "Falta o pagamento para liberar o acesso"}</h2>
          {!pagoSite && <p>A conta da <b>{c.empresa ?? nome}</b> está pronta. Pague o primeiro período e entre na hora.</p>}
          <PagamentoCadastro cobranca={c} onConfirmado={() => setPagoSite(true)} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button className="fantasma" onClick={() => supabase.auth.signOut()}>Sair</button>
          </div>
        </div>
      </div>
    );
  }

  async function jaPaguei() {
    setConferindo(true); setNota(null);
    const atual = await ler(true);
    setConferindo(false);
    if (atual?.status !== "ativo") setNota("O pagamento ainda não apareceu. Pix confirma em segundos; boleto pode levar até 3 dias úteis. Esta tela entra sozinha quando confirmar.");
  }

  // vencida = empresa que já usava e foi suspensa; senão, a empresa nova esperando a 1ª
  const vencida = c?.situacao === "atrasada";
  return (
    <div className="centro">
      <div className={`login-box mens-box${c?.pagamento_online && c.sou_dono ? " com-cartao" : ""}`} style={{ textAlign: "left" }}>
        <Logo size={28} />
        <h2 style={{ marginTop: 14 }}>{vencida ? "Acesso suspenso: a mensalidade venceu" : "Falta o pagamento para liberar o acesso"}</h2>
        {c === undefined ? <p className="sub">Carregando a cobrança…</p> : (
          <>
            {vencida
              ? <p>A mensalidade da <b>{c?.empresa ?? nome}</b> não foi paga e o acesso ao Vertces está suspenso. Os seus dados continuam guardados: pagou, o acesso volta na hora.</p>
              : <p>A conta da <b>{c?.empresa ?? nome}</b> está pronta{c?.plano ? <> no plano <b>{c.plano}</b></> : null}. O acesso é liberado assim que a primeira mensalidade for paga.</p>}
            {c?.pagamento_online && c.sou_dono && c.valor ? (
              <div className="mens-formas">
                <div className="mens-forma destaque">
                  <header><b>Cartão de crédito</b><small>{fmtPreco(Number(c.valor))}/mês · libera na hora</small></header>
                  {cartao ? (
                    <FormCartao contato={c.contato} botao={`Pagar ${fmtPreco(Number(c.valor))} no cartão`}
                      rodape={<button type="button" className="fantasma" onClick={() => setCartao(false)}>Voltar</button>}
                      onSalvo={async (r) => {
                        if (r.ativou) { location.reload(); return; }
                        const atual = await ler(true);
                        if (atual?.status !== "ativo") setNota("O cartão foi cadastrado, mas o pagamento ainda não confirmou. Esta tela entra sozinha quando confirmar.");
                      }} />
                  ) : (
                    <>
                      <span className="sub">Paga agora e as próximas mensalidades saem sozinhas. Com o cartão salvo, os créditos também podem ser repostos quando acabarem.</span>
                      <button className="principal" onClick={() => setCartao(true)}>Pagar com cartão</button>
                    </>
                  )}
                </div>
                {c.link && !cartao && (
                  <div className="mens-forma">
                    <header><b>Pix ou boleto</b>{c.vencimento && <small>{vencida ? "venceu" : "vence"} em {dataBr(c.vencimento)}</small>}</header>
                    <span className="sub">Pix confirma em segundos; boleto em até 3 dias úteis.</span>
                    <a className="botao-download" href={c.link} target="_blank" rel="noreferrer">Abrir a página de pagamento</a>
                  </div>
                )}
              </div>
            ) : c?.link ? (
              <div className="mens-cobranca">
                <div><span>{NomeCobranca(c.ciclo)}</span><b>{c.valor !== null ? fmtPreco(Number(c.valor)) : "—"}</b>{c.vencimento && <small>{vencida ? "venceu" : "vence"} em {dataBr(c.vencimento)}</small>}</div>
                <a className="botao-download principal" href={c.link} target="_blank" rel="noreferrer">Pagar agora (Pix, boleto ou cartão)</a>
              </div>
            ) : (
              <p className="nota-permissao">A cobrança ainda não foi gerada. Fale com o suporte do Vertces{SUPORTE_WHATSAPP ? <> pelo <a href={`https://wa.me/${SUPORTE_WHATSAPP}`} target="_blank" rel="noreferrer">WhatsApp</a></> : null}.</p>
            )}
            {nota && <p className="sub">{nota}</p>}
          </>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {c?.link && <button onClick={jaPaguei} disabled={conferindo}>{conferindo ? "Conferindo…" : "Já paguei"}</button>}
          <button className="fantasma" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </div>
    </div>
  );
}

/** Faixa do Início: a mensalidade venceu (ou a 1ª ainda está em aberto). Só para o dono. */
export function AvisoMensalidade({ cobranca }: { cobranca: MinhaCobranca | null }) {
  // 0049: o cliente escolhido ainda não gastou o 1º crédito (a mensalidade não começou)
  if (cobranca?.sou_dono && esperaPrimeiroCredito(cobranca) && !cobranca.primeiro_credito_em) {
    const mensal = Number(cobranca.mensalidade ?? cobranca.valor ?? 0);
    return (
      <div className="mens-aviso combinado" role="status">
        <span>
          <b>Nada a pagar por enquanto.</b>
          {" "}A {nomeDaCobranca(cobranca.ciclo)}{mensal > 0 ? ` (${fmtPreco(mensal)})` : ""} só começa a contar no dia em que você usar o primeiro crédito; nesse dia a cobrança chega no WhatsApp e os créditos passam a renovar na mesma data.
        </span>
      </div>
    );
  }
  if (!cobranca?.sou_dono || !cobranca.link || (cobranca.situacao !== "atrasada" && cobranca.situacao !== "aguardando")) return null;
  const atrasada = cobranca.situacao === "atrasada";
  return (
    <div className={`mens-aviso${atrasada ? " atrasada" : ""}`} role="status">
      <span>
        <b>{NomeCobranca(cobranca.ciclo)} {atrasada ? "vencida" : "em aberto"}</b>
        {" "}{cobranca.valor !== null && fmtPreco(Number(cobranca.valor))}
        {cobranca.vencimento && ` · ${atrasada ? "venceu" : "vence"} em ${dataBr(cobranca.vencimento)}`}
      </span>
      <a href={cobranca.link} target="_blank" rel="noreferrer" className="link">Pagar agora</a>
    </div>
  );
}
