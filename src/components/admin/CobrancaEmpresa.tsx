// Aba "Cobrança" da empresa (0034): a assinatura no Asaas, a fatura em aberto,
// o WhatsApp e todos os pagamentos (mensalidades e créditos).
//
// Gerar a cobrança cria a assinatura mensal no Asaas (vence hoje) e manda o link
// no WhatsApp da empresa; pago, o webhook ativa a empresa sozinho. "Conferir no
// Asaas" é a rede de segurança: pergunta pelo que está em aberto e aplica.
import { useCallback, useEffect, useState } from "react";
import { atualizarEmpresa, cobrancaDaEmpresa } from "../../lib/admin";
import type { CobrancaEmpresa as Dados, Empresa } from "../../lib/admin";
import {
  atualizarAssinatura, cancelarAssinatura, cobrarEmpresa, conferirPagamentos, FORMA, iniciarMensalidadeDaEmpresa, ROTULO_SITUACAO, rotuloPagamento,
} from "../../lib/cobranca";
import type { ResultadoCobranca } from "../../lib/cobranca";
import { fmtPreco } from "../../lib/creditos";
import { dataBr, nomeDaCobranca } from "../../../supabase/functions/_shared/mensagens_cobranca.ts";
import { soDigitos } from "../../../supabase/functions/_shared/cnpj.ts";
import { cicloDe, NOME_CICLO } from "../../../supabase/functions/_shared/parcelas.ts";
import type { PagamentoEmpresa } from "../../lib/admin";
import type { DadosAdmin } from "./PainelAdmin";
import { confirmar, Dica } from "../ui";
import { Carregando, copiar, fmtData } from "./comum";

const CLASSE: Record<string, string> = { sem_assinatura: "neutro", aguardando: "suspenso", em_dia: "ativo", atrasada: "cancelado", cancelada: "neutro" };
const PAGO = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);

/** "Mensalidade" · "Anuidade · 12x no cartão" · "Parcela 3" · a descrição da compra de créditos */
function oQue(p: PagamentoEmpresa): string {
  if (p.finalidade === "parcela") return `Parcela ${p.parcela ?? ""}`.trim();
  if (p.finalidade !== "mensalidade") return p.descricao ?? "Créditos";
  const nome = nomeDaCobranca(p.ciclo);
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}${(p.parcelas ?? 1) > 1 ? ` · ${p.parcelas}x no cartão` : ""}`;
}

export function CobrancaEmpresa({ e, d, onMudou }: { e: Empresa; d: DadosAdmin; onMudou: (texto: string) => Promise<void> }) {
  const [c, setC] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoCobranca | null>(null);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => { setC(await cobrancaDaEmpresa(e.id)); }, [e.id]);
  useEffect(() => { carregar().catch((x) => setErro(String(x.message ?? x))); }, [carregar]);

  async function agir(nome: string, f: () => Promise<string | void>) {
    setOcupado(nome); setErro(null);
    try {
      const texto = await f();
      await carregar();
      await d.recarregar();
      if (texto) await onMudou(texto);
    } catch (x) { setErro(String(x instanceof Error ? x.message : x)); }
    finally { setOcupado(null); }
  }

  if (!c) return erro ? <div className="sa-aviso erro">{erro}</div> : <Carregando />;

  const a = c.assinatura;
  const viva = !!a?.asaas_assinatura_id && a.situacao !== "cancelada";
  // semestral/anual (autocadastro): o Asaas cobra o período, não a mensalidade
  const ciclo = cicloDe(a?.ciclo) ?? "MONTHLY";
  const valorDiferente = ciclo === "MONTHLY" && viva && a!.valor !== null && c.mensalidade !== null && Number(a!.valor) !== Number(c.mensalidade);
  const semMensalidade = !(Number(c.mensalidade ?? 0) > 0);
  // 0049: a mensalidade que começa no 1º crédito gasto
  const esperando = !!a?.inicio_no_primeiro_credito && !a.mensalidade_iniciada_em;
  const aIniciar = esperando && !!a?.primeiro_credito_em;

  const gerar = () => agir("gerar", async () => {
    const r = await cobrarEmpresa({ escritorio_id: e.id });
    setResultado(r);
    return r.whatsapp.enviado ? "Cobrança enviada no WhatsApp da empresa." : "Cobrança gerada. Copie a mensagem ou abra o WhatsApp para mandar.";
  });

  return (
    <div className="sa-grade">
      {erro && <div className="sa-aviso erro">{erro}</div>}
      {!c.pagamento_online && (
        <div className="sa-aviso info">O pagamento online ainda não está ligado. Configure o Asaas em <b>Configurações → Pagamentos</b> para gerar cobranças.</div>
      )}

      <section className="sa-card">
        <header>
          <h3>Mensalidade<Dica>a assinatura mensal no Asaas: Pix, boleto ou cartão. Paga a 1ª, a empresa é liberada sozinha.</Dica></h3>
          <span className={`sa-pill ${esperando ? (aIniciar ? "suspenso" : "ativo") : CLASSE[a?.situacao ?? "sem_assinatura"]}`} style={{ marginLeft: "auto" }}>
            {esperando ? (aIniciar ? "1º crédito gasto" : "Começa no 1º crédito") : ROTULO_SITUACAO[a?.situacao ?? "sem_assinatura"]}</span>
        </header>
        <div className="sa-cobranca">
          <div><span>Mensalidade que vale</span><b>{c.mensalidade === null ? "não definida" : fmtPreco(Number(c.mensalidade))}</b></div>
          {ciclo !== "MONTHLY" && <div><span>Período</span><b>{NOME_CICLO[ciclo]}</b>{a?.valor != null && <small className="sub">{fmtPreco(Number(a.valor))} por período</small>}</div>}
          {viva && <div><span>Valor no Asaas</span><b>{a!.valor === null ? "—" : fmtPreco(Number(a!.valor))}</b></div>}
          {a?.proximo_vencimento && <div><span>{a.situacao === "em_dia" ? "Próximo vencimento" : "Vencimento"}</span><b>{dataBr(a.proximo_vencimento)}</b></div>}
          {a?.ultimo_pagamento_em && <div><span>Último pagamento</span><b>{fmtData(a.ultimo_pagamento_em)}</b></div>}
          {a?.whatsapp_em && <div><span>WhatsApp</span><b>enviado {fmtData(a.whatsapp_em)}</b></div>}
          <div><span>Cartão</span><b>{c.cartao ? `${c.cartao.bandeira ?? "Cartão"} •••• ${c.cartao.final}` : "não cadastrado"}</b>
            {c.cartao && <small className="sub">{c.cartao.reutilizavel ? "mensalidade e créditos" : "só mensalidade (sem token)"} · validade {c.cartao.validade}</small>}</div>
          {c.recarga && Object.entries(c.recarga).filter(([, r]) => r.ativo).map(([tipo, r]) => (
            <div key={tipo}><span>Compra automática · {tipo === "car" ? "CAR" : tipo}</span><b>{r.quantidade} por vez</b>
              <small className="sub">{r.limite_periodo ? `limite ${fmtPreco(Number(r.limite_periodo))}/mês · ` : ""}gasto {fmtPreco(Number(r.gasto_periodo))}</small></div>
          ))}
        </div>
        {a?.inicio_no_primeiro_credito && (
          <div className={`sa-aviso ${a.primeiro_credito_em && !a.mensalidade_iniciada_em ? "erro" : "info"}`} style={{ marginTop: 12 }}>
            {a.mensalidade_iniciada_em
              ? <>Cliente que paga a partir do 1º crédito: {a.primeiro_credito_em ? <>gastou o 1º crédito em <b>{fmtData(a.primeiro_credito_em)}</b> e </> : null}a mensalidade começou em <b>{fmtData(a.mensalidade_iniciada_em)}</b>. Daqui para frente, cobrança normal.</>
              : a.primeiro_credito_em
                ? <>Gastou o 1º crédito em <b>{fmtData(a.primeiro_credito_em)}</b>, mas a mensalidade ainda não foi gerada no Asaas. Use “Gerar a mensalidade agora”.</>
                : <>A mensalidade começa no dia em que a empresa gastar o 1º crédito. Até lá ela usa o sistema sem pagar; a contagem começa nesse dia e a 1ª mensalidade vence um mês depois (o link vai no WhatsApp dela no dia do 1º crédito).</>}
          </div>
        )}
        {c.cartao?.recusa_em &&<div className="sa-aviso erro" style={{ marginTop: 12 }}>Compra automática recusada em {fmtData(c.cartao.recusa_em)}: {c.cartao.recusa_motivo}</div>}
        {a?.whatsapp_erro && <div className="sa-aviso erro" style={{ marginTop: 12 }}>Último envio no WhatsApp falhou: {a.whatsapp_erro}</div>}
        {valorDiferente && (
          <div className="sa-aviso info" style={{ marginTop: 12 }}>
            A mensalidade mudou para {fmtPreco(Number(c.mensalidade))}, mas o Asaas ainda cobra {fmtPreco(Number(a!.valor))}.
          </div>
        )}
        {a?.link_pagamento && (
          <div className="sa-fatura">
            <span>Fatura em aberto</span>
            <a href={a.link_pagamento} target="_blank" rel="noreferrer">{a.link_pagamento}</a>
            <button type="button" onClick={async () => setCopiado(await copiar(a.link_pagamento!))}>{copiado ? "Copiado ✓" : "Copiar link"}</button>
          </div>
        )}
        <div className="sa-rodape-form">
          {e.status === "aguardando_pagamento" && (
            <button type="button" className="fantasma" style={{ marginRight: "auto" }} disabled={!!ocupado} onClick={async () => {
              if (await confirmar({ titulo: "Liberar sem pagamento?", texto: `A ${e.nome} passa a acessar o sistema agora. A cobrança no Asaas continua em aberto (cancele-a se for cortesia).`, confirmar: "Liberar" })) {
                await agir("ativar", async () => { await atualizarEmpresa(e.id, { status: "ativo" }); return "Empresa liberada sem pagamento."; });
              }
            }}>Liberar sem pagamento</button>
          )}
          {viva && (
            <button type="button" className="fantasma" disabled={!!ocupado} onClick={async () => {
              if (await confirmar({ titulo: "Cancelar a assinatura?", texto: "O Asaas para de gerar mensalidades. O acesso da empresa não muda (suspenda à parte, se for o caso).", confirmar: "Cancelar assinatura", perigo: true })) {
                await agir("cancelar", async () => { await cancelarAssinatura(e.id); return "Assinatura cancelada no Asaas."; });
              }
            }}>Cancelar assinatura</button>
          )}
          {c.pagamento_online && (
            <button type="button" disabled={!!ocupado} onClick={() => agir("conferir", async () => {
              const r = await conferirPagamentos(e.id);
              return r.mudancas.length ? `Conferido no Asaas: ${r.mudancas.join(", ")}.` : `Conferido no Asaas: nada mudou (${r.conferidos} em aberto).`;
            })}>{ocupado === "conferir" ? "Conferindo…" : "Conferir no Asaas"}</button>
          )}
          {valorDiferente && (
            <button type="button" disabled={!!ocupado} onClick={() => agir("valor", async () => {
              const r = await atualizarAssinatura(e.id);
              return `Assinatura atualizada para ${fmtPreco(r.valor)} (as mensalidades em aberto também).`;
            })}>Atualizar valor no Asaas</button>
          )}
          {c.pagamento_online && aIniciar && (
            <button type="button" className="principal" disabled={!!ocupado} onClick={() => agir("iniciar", async () => {
              const r = await iniciarMensalidadeDaEmpresa(e.id);
              return r.acao === "iniciada" ? `Mensalidade gerada${r.vencimento ? `, vence em ${dataBr(r.vencimento)}` : ""}${r.whatsapp ? " e enviada no WhatsApp" : ""}.`
                : r.acao === "ja_iniciada" ? "A mensalidade já tinha sido gerada." : `Não gerou: ${r.acao}.`;
            })}>{ocupado === "iniciar" ? "Gerando…" : "Gerar a mensalidade agora"}</button>
          )}
          {c.pagamento_online && !aIniciar && (
            <button type="button" className="principal" disabled={!!ocupado || semMensalidade} title={semMensalidade ? "Defina a mensalidade do plano ou desta empresa" : undefined}
              onClick={async () => {
                if (esperando && !(await confirmar({ titulo: "Cobrar sem esperar o 1º crédito?", texto: `A ${e.nome} ainda não gastou o 1º crédito. Gerar a cobrança agora encerra a condição combinada: a mensalidade começa hoje.`, confirmar: "Cobrar agora" }))) return;
                gerar();
              }}>
              {ocupado === "gerar" ? "Gerando…" : viva ? "Reenviar a fatura no WhatsApp" : esperando ? "Cobrar já (sem esperar o 1º crédito)" : "Gerar cobrança e enviar no WhatsApp"}
            </button>
          )}
        </div>
      </section>

      {resultado && <MensagemCobranca r={resultado} telefone={e.telefone} />}

      <section className="sa-card">
        <header><h3>Pagamentos<Dica>mensalidades e compras de crédito desta empresa no Asaas</Dica></h3></header>
        {c.pagamentos.length === 0 ? <div className="sa-vazio">Nenhum pagamento ainda.</div> : (
          <div className="sa-tabela-wrap">
            <table className="sa-tabela">
              <thead><tr><th>Criado</th><th>O quê</th><th>Valor</th><th>Vencimento</th><th>Situação</th><th /></tr></thead>
              <tbody>
                {c.pagamentos.map((p) => (
                  <tr key={p.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{fmtData(p.criado_em)}</td>
                    <td>{oQue(p)}{p.erro && <div className="sub" style={{ fontSize: 12 }}>{p.erro}</div>}</td>
                    <td>{fmtPreco(Number(p.valor))}{p.forma && <div className="sub" style={{ fontSize: 12 }}>{FORMA[p.forma] ?? p.forma}</div>}</td>
                    <td>{p.vencimento ? dataBr(p.vencimento) : "—"}</td>
                    <td><span className={`sa-pill ${PAGO.has(p.status) ? "ativo" : p.status === "OVERDUE" ? "cancelado" : p.status === "PENDING" ? "suspenso" : "neutro"}`}>{rotuloPagamento(p.status)}</span>
                      {p.pago_em && <div className="sub" style={{ fontSize: 12 }}>pago {fmtData(p.pago_em)}</div>}</td>
                    <td style={{ textAlign: "right" }}>{p.link && <a className="sa-link" href={p.link} target="_blank" rel="noreferrer">Fatura</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** A mensagem que foi (ou não) no WhatsApp: copiar e abrir no wa.me. */
export function MensagemCobranca({ r, telefone }: { r: ResultadoCobranca; telefone: string | null }) {
  const [copiado, setCopiado] = useState(false);
  const tel = soDigitos(telefone ?? "");
  return (
    <section className="sa-card sa-msg-cobranca">
      <header>
        <h3>{r.whatsapp.enviado ? "Mensagem enviada no WhatsApp" : "Mensagem para a empresa"}</h3>
        <span className={`sa-pill ${r.whatsapp.enviado ? "ativo" : "suspenso"}`} style={{ marginLeft: "auto" }}>
          {r.whatsapp.enviado ? "WhatsApp enviado" : !r.whatsapp.configurado ? "WhatsApp não configurado" : "WhatsApp falhou"}
        </span>
      </header>
      {r.whatsapp.erro && <div className="sa-aviso erro">{r.whatsapp.erro}</div>}
      <pre className="sa-pre">{r.mensagem}</pre>
      <div className="sa-rodape-form">
        <button type="button" onClick={async () => setCopiado(await copiar(r.mensagem))}>{copiado ? "Copiado ✓" : "Copiar mensagem"}</button>
        {!r.whatsapp.enviado && tel && (
          <button type="button" className="principal" onClick={() => open(`https://wa.me/55${tel}?text=${encodeURIComponent(r.mensagem)}`, "_blank", "noopener")}>Abrir no WhatsApp</button>
        )}
      </div>
    </section>
  );
}
