// A mensalidade do Vertces vista pela empresa (migração 0034):
//   AguardandoPagamento — empresa nova que ainda não pagou a 1ª mensalidade: o
//                         link para pagar e a liberação sozinha ao confirmar
//   AvisoMensalidade    — faixa no Início quando a mensalidade venceu
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { conferirPagamentos, minhaCobranca } from "../lib/cobranca";
import type { MinhaCobranca } from "../lib/cobranca";
import { fmtPreco } from "../lib/creditos";
import { dataBr } from "../../supabase/functions/_shared/mensagens_cobranca.ts";
import { SUPORTE_WHATSAPP } from "../lib/config";
import { Logo } from "./Logo";

export function AguardandoPagamento({ nome }: { nome: string }) {
  const [c, setC] = useState<MinhaCobranca | null | undefined>(undefined);
  const [conferindo, setConferindo] = useState(false);
  const [nota, setNota] = useState<string | null>(null);

  async function ler(perguntarAoAsaas: boolean) {
    if (perguntarAoAsaas) await conferirPagamentos().catch(() => null);
    const atual = await minhaCobranca();
    setC(atual);
    // pago: a empresa já está ativa — recarrega e entra
    if (atual?.status === "ativo") location.reload();
    return atual;
  }
  useEffect(() => {
    ler(false);
    // pagou em outra aba ou no celular: entra sozinho
    const t = setInterval(() => ler(true), 15_000);
    return () => clearInterval(t);
  }, []);

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
      <div className="login-box mens-box" style={{ textAlign: "left" }}>
        <Logo size={28} />
        <h2 style={{ marginTop: 14 }}>{vencida ? "Acesso suspenso: a mensalidade venceu" : "Falta o pagamento para liberar o acesso"}</h2>
        {c === undefined ? <p className="sub">Carregando a cobrança…</p> : (
          <>
            {vencida
              ? <p>A mensalidade da <b>{c?.empresa ?? nome}</b> não foi paga e o acesso ao Vertces está suspenso. Os seus dados continuam guardados: pagou, o acesso volta na hora.</p>
              : <p>A conta da <b>{c?.empresa ?? nome}</b> está pronta{c?.plano ? <> no plano <b>{c.plano}</b></> : null}. O acesso é liberado assim que a primeira mensalidade for paga.</p>}
            {c?.link ? (
              <div className="mens-cobranca">
                <div><span>Mensalidade</span><b>{c.valor !== null ? fmtPreco(Number(c.valor)) : "—"}</b>{c.vencimento && <small>{vencida ? "venceu" : "vence"} em {dataBr(c.vencimento)}</small>}</div>
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
  if (!cobranca?.sou_dono || !cobranca.link || (cobranca.situacao !== "atrasada" && cobranca.situacao !== "aguardando")) return null;
  const atrasada = cobranca.situacao === "atrasada";
  return (
    <div className={`mens-aviso${atrasada ? " atrasada" : ""}`} role="status">
      <span>
        <b>{atrasada ? "Mensalidade vencida" : "Mensalidade em aberto"}</b>
        {" "}{cobranca.valor !== null && fmtPreco(Number(cobranca.valor))}
        {cobranca.vencimento && ` · ${atrasada ? "venceu" : "vence"} em ${dataBr(cobranca.vencimento)}`}
      </span>
      <a href={cobranca.link} target="_blank" rel="noreferrer" className="link">Pagar agora</a>
    </div>
  );
}
