// Aba "Créditos extras" da empresa: o que ela COMPRA além do que o plano dá.
//
//   - pedidos aguardando (sem o Asaas, alguém aprova: no topo, porque pede ação)
//   - compras esperando pagamento no Asaas (entram sozinhas; dá para dar baixa
//     se pagou por fora)
//   - saldo de créditos extras de cada carteira e "Dar créditos extras"
//   - histórico e uso por mês
//
// Quanto o plano dá por mês e o preço do extra ficam em "Plano e créditos".
// Regras no banco: 0027 + 0034.
import { useState } from "react";
import { adicionarCreditos, resolverPedidoCredito } from "../../lib/admin";
import type { CreditoExtra, CreditosEmpresa as Dados, Empresa } from "../../lib/admin";
import { fmtPreco } from "../../lib/creditos";
import { FORMA, rotuloPagamento } from "../../lib/cobranca";
import type { DadosAdmin } from "./PainelAdmin";
import { confirmar, Dica, Rotulo } from "../ui";
import { Carregando, fmtData } from "./comum";
import { reais } from "./Faixas";

const ROTULO_STATUS = { pendente: "Aguardando", aprovado: "Liberado", recusado: "Recusado", cancelado: "Cancelado" } as const;
const CLASSE_STATUS = { pendente: "suspenso", aprovado: "ativo", recusado: "cancelado", cancelado: "neutro" } as const;
const ORIGEM = { pedido: "pedido sem pagamento online", manual: "dado por você no painel", compra: "comprado pelo Asaas" } as const;

export function CreditosEmpresa({ e, d, c, onMudou }: { e: Empresa; d: DadosAdmin; c: Dados | null; onMudou: () => Promise<void> }) {
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function agir(f: () => Promise<void>, ok?: string) {
    setMsg(null);
    try { await f(); await onMudou(); if (ok) setMsg({ tipo: "ok", texto: ok }); }
    catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  if (!c) return <Carregando />;

  const nomeTipo = (t: string) => d.tipos.find((x) => x.chave === t)?.nome ?? t;
  const pedidos = c.extras.filter((x) => x.status === "pendente" && x.origem !== "compra");
  const pagando = c.extras.filter((x) => x.status === "pendente" && x.origem === "compra");
  const historico = c.extras.filter((x) => x.status !== "pendente");
  const saldos = c.carteiras.filter((k) => k.extra > 0);

  return (
    <div className="sa-grade">
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}

      {pedidos.length > 0 && (
        <section className="sa-card sa-destaque">
          <header><h3>Pedidos aguardando sua aprovação<Dica>feitos enquanto o pagamento online não estava ligado: combine o pagamento antes de aprovar. Aprovado, o crédito vale na hora.</Dica></h3></header>
          <TabelaCreditos itens={pedidos} nomeTipo={nomeTipo} acoes={(x) => <>
            <button type="button" className="principal" onClick={() => agir(() => resolverPedidoCredito(x.id, true), `Aprovado: ${x.quantidade} crédito(s) já valem para a empresa.`)}>Aprovar</button>{" "}
            <button type="button" className="fantasma" onClick={async () => {
              if (await confirmar({ titulo: "Recusar o pedido?", texto: "A empresa vê o pedido como recusado. Nenhum crédito entra.", confirmar: "Recusar", perigo: true })) {
                await agir(() => resolverPedidoCredito(x.id, false), "Pedido recusado.");
              }
            }}>Recusar</button>
          </>} />
        </section>
      )}

      {pagando.length > 0 && (
        <section className="sa-card">
          <header><h3>Compras esperando pagamento<Dica>cobranças no Asaas. Pagas, os créditos entram sozinhos. Se a empresa pagou por fora, dê baixa.</Dica></h3></header>
          <TabelaCreditos itens={pagando} nomeTipo={nomeTipo} acoes={(x) => <>
            {x.link && <a className="sa-link" href={x.link} target="_blank" rel="noreferrer">Fatura</a>}{" "}
            <button type="button" onClick={async () => {
              if (await confirmar({ titulo: "Dar baixa na compra?", texto: `Os ${x.quantidade} crédito(s) entram agora, sem esperar o Asaas. Use só se o pagamento foi feito por fora.`, confirmar: "Dar baixa" })) {
                await agir(() => resolverPedidoCredito(x.id, true, "Baixa manual no painel"), "Baixa feita: os créditos já valem.");
              }
            }}>Dar baixa</button>
          </>} />
        </section>
      )}

      <section className="sa-card">
        <header><h3>Saldo de créditos extras<Dica>comprados ou dados. São usados depois dos créditos do mês e não vencem.</Dica></h3></header>
        {saldos.length === 0
          ? <p className="sub" style={{ marginTop: 0 }}>A empresa não tem créditos extras. Quando os do mês acabarem, ela compra mais ou espera renovar.</p>
          : (
            <div className="sa-saldos">
              {saldos.map((k) => <div key={k.chave}><b>{k.extra}</b><span>{k.nome}</span></div>)}
            </div>
          )}
        <AdicionarCreditos d={d} onAdicionar={(tipo, qtd, desc, preco) => agir(() => adicionarCreditos(e.id, tipo, qtd, desc, preco), `${qtd} crédito(s) dado(s) à empresa.`)} />
      </section>

      <section className="sa-card">
        <header><h3>Histórico de compras e créditos dados</h3></header>
        {historico.length === 0 ? <div className="sa-vazio">Nada ainda.</div> : <TabelaCreditos itens={historico} nomeTipo={nomeTipo} />}
      </section>

      {c.historico.length > 0 && (
        <section className="sa-card">
          <header><h3>Créditos usados por mês<Dica>serviços abertos no mês do calendário, de todas as origens (do mês e extras)</Dica></h3></header>
          <div className="sa-barras">
            {c.historico.map((h) => (
              <div className="sa-barra" key={h.mes}>
                <span>{new Date(`${h.mes}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}</span>
                <span className="trilho"><i style={{ width: `${(h.total / Math.max(1, ...c.historico.map((x) => x.total))) * 100}%` }} /></span>
                <b title={Object.entries(h.por_tipo).map(([t, n]) => `${nomeTipo(t)}: ${n}`).join(" · ")}>{h.total}</b>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TabelaCreditos({ itens, nomeTipo, acoes }: { itens: CreditoExtra[]; nomeTipo: (t: string) => string; acoes?: (x: CreditoExtra) => React.ReactNode }) {
  return (
    <div className="sa-tabela-wrap">
      <table className="sa-tabela">
        <thead><tr><th>Quando</th><th>Créditos</th><th>Valor</th><th>Situação</th>{acoes && <th />}</tr></thead>
        <tbody>
          {itens.map((x) => (
            <tr key={x.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtData(x.created_at)}<div className="sub" style={{ fontSize: 12 }}>{ORIGEM[x.origem]}{x.origem !== "manual" && x.quem ? ` · ${x.quem}` : ""}</div></td>
              <td><b>{x.quantidade} · {nomeTipo(x.tipo)}</b><div className="sub" style={{ fontSize: 12 }}>{x.descricao}{x.observacao ? ` — ${x.observacao}` : ""}</div></td>
              <td>{fmtPreco(x.preco)}{x.valor_unitario !== null && <div className="sub" style={{ fontSize: 12 }}>{fmtPreco(x.valor_unitario)} cada{x.forma ? ` · ${FORMA[x.forma] ?? x.forma}` : ""}</div>}</td>
              <td><span className={`sa-pill ${CLASSE_STATUS[x.status]}`}>{x.origem === "compra" && x.status === "pendente" ? rotuloPagamento(x.pagamento) : ROTULO_STATUS[x.status]}</span></td>
              {acoes && <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{acoes(x)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdicionarCreditos({ d, onAdicionar }: { d: DadosAdmin; onAdicionar: (tipo: string, qtd: number, descricao: string, preco: number | null) => Promise<void> }) {
  const vazio = { tipo: d.tipos[0]?.chave ?? "geral", quantidade: "", descricao: "", preco: "" };
  const [f, setF] = useState(vazio);
  return (
    <form className="sa-campos" style={{ alignItems: "end", marginTop: 16 }} onSubmit={async (ev) => {
      ev.preventDefault();
      await onAdicionar(f.tipo, Math.max(1, Number(f.quantidade)), f.descricao, f.preco === "" ? null : reais(f.preco));
      setF(vazio);
    }}>
      <label><Rotulo dica="entram na hora, sem pagamento">Dar créditos extras</Rotulo>
        <select value={f.tipo} onChange={(x) => setF({ ...f, tipo: x.target.value })}>
          {d.tipos.map((t) => <option key={t.chave} value={t.chave}>{t.nome}</option>)}
        </select>
      </label>
      <label>Quantidade<input type="number" min={1} value={f.quantidade} onChange={(x) => setF({ ...f, quantidade: x.target.value })} required /></label>
      <label>Motivo<input value={f.descricao} onChange={(x) => setF({ ...f, descricao: x.target.value })} placeholder="Cortesia, venda por fora…" /></label>
      <label><Rotulo dica="opcional, só para registro">Valor (R$)</Rotulo><input inputMode="decimal" value={f.preco} onChange={(x) => setF({ ...f, preco: x.target.value })} /></label>
      <div className="sa-rodape-form" style={{ gridColumn: "1 / -1", marginTop: 0 }}>
        <button type="submit" disabled={!(Number(f.quantidade) > 0)}>Dar créditos extras</button>
      </div>
    </form>
  );
}
