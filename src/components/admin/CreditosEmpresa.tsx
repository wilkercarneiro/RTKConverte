// Aba "Créditos extras e pacotes" da empresa: o que ela COMPRA além do limite.
//
//   - pedidos aguardando (no topo: é o que pede ação)
//   - saldo de créditos extras e "Dar créditos extras" (cortesia, venda por fora)
//   - pacotes que ela vê em "Comprar mais créditos" (nome, serviço, quantidade, preço)
//   - histórico de pedidos e uso por mês
//
// O limite do mês (do plano ou só desta empresa) fica na aba "Plano e limites".
// Regras no banco: supabase/migrations/0027_creditos.sql.
import { useState } from "react";
import {
  adicionarCreditos, definirLimiteEmpresa, excluirPacote, resolverPedidoCredito, salvarPacote,
} from "../../lib/admin";
import type { CreditoExtra, CreditosEmpresa as Dados, Empresa, PacoteCredito } from "../../lib/admin";
import { fmtPreco, nomeDaChave } from "../../lib/creditos";
import { RECURSOS } from "../../lib/recursos";
import { confirmar, Dica, Rotulo } from "../ui";
import { Carregando, fmtData } from "./comum";

const ROTULO_STATUS = { pendente: "Aguardando", aprovado: "Aprovado", recusado: "Recusado", cancelado: "Cancelado pela empresa" } as const;
const CLASSE_STATUS = { pendente: "suspenso", aprovado: "ativo", recusado: "cancelado", cancelado: "neutro" } as const;

export function CreditosEmpresa({ e, c, onMudou }: { e: Empresa; c: Dados | null; onMudou: () => Promise<void> }) {
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  async function agir(f: () => Promise<void>, ok?: string) {
    setMsg(null);
    try { await f(); await onMudou(); if (ok) setMsg({ tipo: "ok", texto: ok }); }
    catch (x) { setMsg({ tipo: "erro", texto: String(x instanceof Error ? x.message : x) }); }
  }

  if (!c) return <Carregando />;

  const pendentes = c.extras.filter((x) => x.status === "pendente");
  const historico = c.extras.filter((x) => x.status !== "pendente");
  const saldos = [["total", c.total.extra] as const, ...Object.entries(c.servicos).map(([k, s]) => [k, s.extra] as const)].filter(([, n]) => n > 0);

  return (
    <div className="sa-grade">
      {msg && <div className={`sa-aviso ${msg.tipo}`}>{msg.texto}</div>}

      {pendentes.length > 0 && (
        <section className="sa-card sa-destaque">
          <header><h3>Pedidos aguardando sua aprovação<Dica>combine o pagamento com a empresa antes de aprovar. Aprovado, o crédito vale na hora.</Dica></h3></header>
          <TabelaPedidos itens={pendentes} acoes={(x) => <>
            <button type="button" className="principal" onClick={() => agir(() => resolverPedidoCredito(x.id, true), `Aprovado: ${x.quantidade} crédito(s) já valem para a empresa.`)}>Aprovar</button>{" "}
            <button type="button" className="fantasma" onClick={async () => {
              if (await confirmar({ titulo: "Recusar o pedido?", texto: "A empresa vê o pedido como recusado. Nenhum crédito entra.", confirmar: "Recusar", perigo: true })) {
                await agir(() => resolverPedidoCredito(x.id, false), "Pedido recusado.");
              }
            }}>Recusar</button>
          </>} />
        </section>
      )}

      <section className="sa-card">
        <header><h3>Saldo de créditos extras<Dica>créditos comprados ou dados. São usados só depois que o limite do mês acaba e não vencem.</Dica></h3></header>
        {saldos.length === 0
          ? <p className="sub" style={{ marginTop: 0 }}>A empresa não tem créditos extras. Quando o limite do mês acabar, ela não abre serviço novo até comprar mais ou o mês virar.</p>
          : (
            <div className="sa-saldos">
              {saldos.map(([k, n]) => <div key={k}><b>{n}</b><span>{nomeDaChave(k)}</span></div>)}
            </div>
          )}
        <AdicionarCreditos onAdicionar={(chave, qtd, desc, preco) => agir(() => adicionarCreditos(e.id, chave, qtd, desc, preco), `${qtd} crédito(s) extra(s) dado(s) à empresa.`)} />
      </section>

      <Pacotes e={e} pacotes={c.pacotes} agir={agir} />

      <section className="sa-card">
        <header><h3>Histórico de pedidos e créditos dados</h3></header>
        {historico.length === 0 ? <div className="sa-vazio">Nada ainda.</div> : <TabelaPedidos itens={historico} />}
      </section>

      {c.historico.length > 0 && (
        <section className="sa-card">
          <header><h3>Créditos usados por mês<Dica>serviços abertos no mês, contando os pagos com crédito extra</Dica></h3></header>
          <div className="sa-barras">
            {c.historico.map((h) => (
              <div className="sa-barra" key={h.mes}>
                <span>{new Date(`${h.mes}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}</span>
                <span className="trilho"><i style={{ width: `${(h.total / Math.max(1, ...c.historico.map((x) => x.total))) * 100}%` }} /></span>
                <b>{h.total}</b>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TabelaPedidos({ itens, acoes }: { itens: CreditoExtra[]; acoes?: (x: CreditoExtra) => React.ReactNode }) {
  return (
    <div className="sa-tabela-wrap">
      <table className="sa-tabela">
        <thead><tr><th>Quando</th><th>Créditos</th><th>Valor</th><th>Situação</th>{acoes && <th />}</tr></thead>
        <tbody>
          {itens.map((x) => (
            <tr key={x.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtData(x.created_at)}<div className="sub" style={{ fontSize: 12 }}>{x.origem === "manual" ? "dado por você no painel" : `pedido por ${x.quem ?? "a empresa"}`}</div></td>
              <td><b>{x.quantidade} · {nomeDaChave(x.chave)}</b><div className="sub" style={{ fontSize: 12 }}>{x.descricao}{x.observacao ? ` — ${x.observacao}` : ""}</div></td>
              <td>{fmtPreco(x.preco)}</td>
              <td><span className={`sa-pill ${CLASSE_STATUS[x.status]}`}>{ROTULO_STATUS[x.status]}</span></td>
              {acoes && <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{acoes(x)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Créditos por mês da empresa no cadastro: segue o plano ou vale o número fechado com ela (vazio = sem limite). */
export interface CreditosMes { modo: "plano" | "empresa"; limite: string }
export const creditosMesDe = (negociado: Record<string, number | null> | undefined): CreditosMes =>
  negociado && "total" in negociado ? { modo: "empresa", limite: negociado.total === null ? "" : String(negociado.total) } : { modo: "plano", limite: "" };

/** Grava o total do mês da empresa (só se mudou). */
export async function gravarCreditosMes(id: string, v: CreditosMes, antes?: CreditosMes): Promise<void> {
  if (antes && antes.modo === v.modo && (v.modo === "plano" || antes.limite === v.limite)) return;
  if (v.modo === "plano") { if (antes?.modo === "empresa") await definirLimiteEmpresa(id, "total", null, true); return; }
  await definirLimiteEmpresa(id, "total", v.limite === "" ? null : Math.max(0, Math.floor(Number(v.limite))));
}

export function CampoCreditosMes({ valor, onChange, planoTotal }: {
  valor: CreditosMes; onChange: (v: CreditosMes) => void;
  /** teto total do plano escolhido (undefined = sem plano) */
  planoTotal: number | null | undefined;
}) {
  const doPlano = planoTotal === undefined ? "sem plano" : planoTotal === null ? "sem limite" : `${planoTotal} por mês`;
  return (
    <>
      <label><Rotulo dica="quantos serviços a empresa pode abrir por mês, somando todos (1 crédito = 1 arquivo enviado). O limite de cada serviço fica em Plano e limites.">Créditos por mês</Rotulo>
        <select value={valor.modo} onChange={(x) => onChange({ ...valor, modo: x.target.value as CreditosMes["modo"] })}>
          <option value="plano">Seguir o plano ({doPlano})</option>
          <option value="empresa">Definir para esta empresa</option>
        </select>
      </label>
      {valor.modo === "empresa" && (
        <label><Rotulo dica="vazio = sem limite">Créditos fechados com a empresa</Rotulo>
          <input type="number" min={0} placeholder="sem limite" value={valor.limite}
            onChange={(x) => onChange({ ...valor, limite: x.target.value })} />
        </label>
      )}
    </>
  );
}

function Pacotes({ e, pacotes, agir }: { e: Empresa; pacotes: PacoteCredito[]; agir: (f: () => Promise<void>, ok?: string) => Promise<void> }) {
  const vazio = { nome: "", chave: "total", quantidade: "10", preco: "" };
  const [f, setF] = useState<{ id?: string } & typeof vazio>(vazio);
  const servicos = useServicosDoCatalogo();

  async function gravar(ev: React.FormEvent) {
    ev.preventDefault();
    await agir(() => salvarPacote({
      id: f.id, escritorio_id: e.id, nome: f.nome, chave: f.chave, quantidade: Math.max(1, Number(f.quantidade)),
      preco: f.preco === "" ? null : Number(f.preco.replace(",", ".")),
    }), f.id ? "Pacote atualizado." : "Pacote criado. A empresa já vê na tela de compra.");
    setF(vazio);
  }

  return (
    <section className="sa-card">
      <header><h3>Pacotes à venda para esta empresa<Dica>o que ela vê em “Comprar mais créditos”. Comprar um pacote gera um pedido que você aprova nesta aba. Sem pacote, ela pede uma quantidade e o valor é combinado.</Dica></h3></header>
      {pacotes.length > 0 && (
        <div className="sa-tabela-wrap" style={{ marginBottom: 14 }}>
          <table className="sa-tabela">
            <thead><tr><th>Pacote</th><th>Serviço</th><th>Créditos</th><th>Preço</th><th /></tr></thead>
            <tbody>
              {pacotes.map((p) => (
                <tr key={p.id} style={p.ativo ? undefined : { opacity: 0.55 }}>
                  <td><b>{p.nome}</b>{!p.ativo && <span className="sa-pill neutro" style={{ marginLeft: 6 }}>oculto</span>}</td>
                  <td>{nomeDaChave(p.chave)}</td>
                  <td>{p.quantidade}</td>
                  <td>{fmtPreco(p.preco)}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" onClick={() => setF({ id: p.id, nome: p.nome, chave: p.chave, quantidade: String(p.quantidade), preco: p.preco === null ? "" : String(p.preco) })}>Editar</button>{" "}
                    <button type="button" onClick={() => agir(() => salvarPacote({ ...p, ativo: !p.ativo }))}>{p.ativo ? "Ocultar" : "Mostrar"}</button>{" "}
                    <button type="button" className="fantasma" onClick={async () => {
                      if (await confirmar({ titulo: `Excluir ${p.nome}?`, texto: "Pedidos já feitos com ele continuam no histórico.", confirmar: "Excluir", perigo: true })) await agir(() => excluirPacote(p.id));
                    }}>Excluir</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form onSubmit={gravar} className="sa-campos" style={{ alignItems: "end" }}>
        <label>Nome do pacote<input value={f.nome} onChange={(x) => setF({ ...f, nome: x.target.value })} placeholder="Ex.: 10 serviços extras" required /></label>
        <label>Serviço
          <select value={f.chave} onChange={(x) => setF({ ...f, chave: x.target.value })}>
            <option value="total">Qualquer serviço</option>
            {servicos.map((r) => <option key={r.chave} value={r.chave}>{r.nome}</option>)}
          </select>
        </label>
        <label>Créditos<input type="number" min={1} value={f.quantidade} onChange={(x) => setF({ ...f, quantidade: x.target.value })} required /></label>
        <label><Rotulo dica="vazio = a combinar">Preço (R$)</Rotulo><input inputMode="decimal" value={f.preco} onChange={(x) => setF({ ...f, preco: x.target.value })} placeholder="a combinar" /></label>
        <div className="sa-rodape-form" style={{ gridColumn: "1 / -1", marginTop: 0 }}>
          {f.id && <button type="button" onClick={() => setF(vazio)}>Cancelar edição</button>}
          <button type="submit" className="principal">{f.id ? "Salvar pacote" : "Criar pacote"}</button>
        </div>
      </form>
    </section>
  );
}

function AdicionarCreditos({ onAdicionar }: { onAdicionar: (chave: string, qtd: number, descricao: string, preco: number | null) => Promise<void> }) {
  const [f, setF] = useState({ chave: "total", quantidade: "", descricao: "", preco: "" });
  const servicos = useServicosDoCatalogo();
  return (
    <form className="sa-campos" style={{ alignItems: "end", marginTop: 16 }} onSubmit={async (ev) => {
      ev.preventDefault();
      await onAdicionar(f.chave, Math.max(1, Number(f.quantidade)), f.descricao, f.preco === "" ? null : Number(f.preco.replace(",", ".")));
      setF({ chave: "total", quantidade: "", descricao: "", preco: "" });
    }}>
      <label><Rotulo dica="entra aprovado na hora, sem pedido da empresa">Dar créditos extras para</Rotulo>
        <select value={f.chave} onChange={(x) => setF({ ...f, chave: x.target.value })}>
          <option value="total">Qualquer serviço</option>
          {servicos.map((r) => <option key={r.chave} value={r.chave}>{r.nome}</option>)}
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

const SERVICOS = RECURSOS.filter((r) => r.chave.startsWith("servico."));
const useServicosDoCatalogo = () => SERVICOS;
